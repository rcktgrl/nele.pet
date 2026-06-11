'use strict';

import {
  Net, gauss, LOG_2PI, accumulatePPOGrads, accumulateSACGrads,
  SAC_LOGSTD_MIN, SAC_LOGSTD_MAX,
} from './nn-core.js';

// ─────────────────────────────────────────────────────────────────────────────
//  AI Trainer — Simulation Worker (PPO / SAC)
//
//  Runs entirely off the main thread. No DOM, no Three.js.
//  Two selectable algorithms (cfg.algo, restart required):
//    · PPO — on-policy: GAE(λ), clipped surrogate + entropy bonus, one big
//      update per filled horizon. Compute-cheap; strongest at high speed
//      multipliers where data is nearly free.
//    · SAC — off-policy: replay buffer, squashed-Gaussian actor, twin Q
//      critics with polyak targets, learned entropy temperature α. Far more
//      sample-efficient and self-tuning, so it learns faster in wall-clock
//      terms when collection (not gradient compute) is the bottleneck.
//  Both share the actor MLP shape (tanh hidden, linear output), manual
//  backprop with Adam, and N parallel environments feeding one policy.
//
//  Observations include fixed centerline look-ahead probes (relative angle +
//  slope at several distances ahead), so the policy can anticipate corners
//  and elevation changes without any controllable sensor.
// ─────────────────────────────────────────────────────────────────────────────

// ── Track state (populated on 'init') ────────────────────────────────────────
let trkPts       = [];   // [{x,y,z}] spaced centerline points
let trkWallLeft  = [];   // [{x0,z0,x1,z1}] left barrier segments
let trkWallRight = [];   // [{x0,z0,x1,z1}] right barrier segments
let trkData      = null; // {wp:[[x,0,z],...], rw, laps}
let gravelProfile = null;// {pts, leftRunoff, rightRunoff, rw}
let cityCorridors = null;// [{x,z,hw,hd}] axis-aligned driveable rects (city tracks)
let cityAiPts     = null;// {pts:[{x,z}...]} city navigation waypoints

// Centerline arc-length tables (built on init) — used for progress reward and
// look-ahead probes. For city tracks the nav grid points are used (y = 0).
let navPts   = [];       // [{x,y,z}]
let arcLen   = [];       // cumulative arc length at navPts[i]
let trackLen = 1;

// ── Config (live-updateable unless noted) ─────────────────────────────────────
let cfg = {
  // environment
  numEnvs: 8,            // restart required
  speedMult: 1,
  episodeLen: 60,        // seconds before truncation
  randomSpawn: true,     // spawn each episode at a random centerline point
  actionRepeat: 2,       // physics ticks per agent decision (restart required)
  // algorithm
  algo: 'ppo',           // 'ppo' | 'sac' — restart required
  // shared hyperparameters
  lr: 3e-4,
  gamma: 0.99,
  minibatch: 256,        // PPO minibatch / SAC batch size
  hiddenSize: 64,        // restart required
  hiddenLayers: 1,       // restart required
  backend: 'auto',       // 'auto' | 'gpu' | 'wasm' | 'js' — restart required
  threads: 0,            // gradient worker count, 0 = auto (cores − 2, max 6)
  // PPO hyperparameters
  lam: 0.95,
  clip: 0.2,
  entropyCoef: 0.003,
  vfCoef: 0.5,
  horizon: 512,          // agent steps per env per update (restart required)
  epochs: 6,
  // SAC hyperparameters
  tau: 0.005,            // polyak averaging rate for the target critics
  utd: 1.0,              // gradient steps per collected transition (live)
  bufferSize: 150000,    // replay capacity in transitions (restart required)
  // reward shaping
  progressReward: 0.2,   // per metre of forward progress along the centerline
  gravelPenalty: 1.0,    // per second on gravel
  wallPenalty: 2.0,      // per second of wall contact
  terminalPenalty: 10,   // on off-track / stuck termination
  lapBonus: 20,          // on lap completion
};

const FIXED_DT = 1 / 60;
const POST_HZ  = 30;

let running    = false;
let simTime    = 0;
let lastTickMs = 0;
let lastPostMs = 0;
let tickHandle = null;
let carSpec    = null;

// ─────────────────────────────────────────────────────────────────────────────
//  Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

function nearestPointOnSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const apx = px - ax, apz = pz - az;
  const ab2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
  return { x: ax + abx * t, z: az + abz * t };
}

function nearestWallPoint(px, pz, walls) {
  if (!walls || !walls.length) return null;
  let best = null, bestD2 = Infinity;
  for (const w of walls) {
    const pt = nearestPointOnSegment(px, pz, w.x0, w.z0, w.x1, w.z1);
    const d2 = (px - pt.x) ** 2 + (pz - pt.z) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = pt; }
  }
  return best;
}

function raySegment(ox, oz, dx, dz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const det = dx * ez - dz * ex;
  if (Math.abs(det) < 1e-8) return -1;
  const fx = ax - ox, fz = az - oz;
  const t = (fx * ez - fz * ex) / det;
  const s = (dz * fx - dx * fz) / det;
  if (t >= 0 && s >= 0 && s <= 1) return t;
  return -1;
}

// Wrap to (-π, π]. Valid for ANY input magnitude — the previous formula
// ((a + 3π) % 2π) − π silently returned values < −π once its argument
// dropped below −3π, which happens when car.hdg accumulates +2π per lap
// on counterclockwise tracks. That inverted every angle observation on
// lap 2+ and made the policy steer hard into the wall at a fixed spot.
function wrapPi(a) { return a - 2 * Math.PI * Math.round(a / (2 * Math.PI)); }

function buildArcTable() {
  const useCity = !!(cityAiPts && cityAiPts.pts && cityAiPts.pts.length);
  navPts = useCity
    ? cityAiPts.pts.map(p => ({ x: p.x, y: 0, z: p.z }))
    : trkPts;
  const n = navPts.length;
  arcLen = new Float64Array(n);
  let s = 0;
  for (let i = 1; i < n; i++) {
    s += Math.hypot(navPts[i].x - navPts[i - 1].x, navPts[i].z - navPts[i - 1].z);
    arcLen[i] = s;
  }
  trackLen = s + Math.hypot(navPts[0].x - navPts[n - 1].x, navPts[0].z - navPts[n - 1].z);
  if (trackLen < 1) trackLen = 1;
}

// Hint-based nearest point search. When `hint` is a valid previous index the
// scan is restricted to a window around it — this keeps the matched position
// CONTINUOUS along the route even where the track passes close to itself
// (city routes legitimately cross the same intersection several times), and
// turns an O(n) scan into O(win). Falls back to a global scan when the local
// match is implausibly far (respawn, teleport, first call).
const RESEED_D2 = 30 * 30;

function nearestIdx(px, pz, pts, hint, win) {
  const n = pts.length;
  let md = Infinity, ni = 0;
  if (hint >= 0 && hint < n) {
    for (let k = -win; k <= win; k++) {
      const i = ((hint + k) % n + n) % n;
      const d = (px - pts[i].x) ** 2 + (pz - pts[i].z) ** 2;
      if (d < md) { md = d; ni = i; }
    }
    if (md <= RESEED_D2) return { idx: ni, d2: md };
  }
  md = Infinity; ni = 0;
  for (let i = 0; i < n; i++) {
    const d = (px - pts[i].x) ** 2 + (pz - pts[i].z) ** 2;
    if (d < md) { md = d; ni = i; }
  }
  return { idx: ni, d2: md };
}

// Continuous arc position (metres along centerline) of a world point.
function arcPosition(px, pz, hint = -1) {
  const n = navPts.length;
  const r = nearestIdx(px, pz, navPts, hint, 25);
  const ni = r.idx, md = r.d2;
  const a = navPts[ni], b = navPts[(ni + 1) % n];
  const abx = b.x - a.x, abz = b.z - a.z;
  const ab2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * abx + (pz - a.z) * abz) / ab2));
  const segLen = Math.sqrt(ab2);
  return { s: (arcLen[ni] + t * segLen) % trackLen, nearestIdx: ni, nearestD2: md };
}

// Point + elevation at arc distance s (wrapped).
function pointAtArc(s) {
  const n = navPts.length;
  s = ((s % trackLen) + trackLen) % trackLen;
  // binary search the cumulative table
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arcLen[mid] <= s) lo = mid; else hi = mid - 1;
  }
  const a = navPts[lo], b = navPts[(lo + 1) % n];
  const segLen = (lo + 1 < n ? arcLen[lo + 1] : trackLen) - arcLen[lo] || 1;
  const t = Math.min(1, (s - arcLen[lo]) / segLen);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pure-physics car — faithful port of car.js (no Three.js, no mesh)
// ─────────────────────────────────────────────────────────────────────────────

class SimCar {
  constructor(carData, pos, hdg) {
    this.data = carData;
    this.pos  = { x: pos.x, y: pos.y, z: pos.z };
    this.hdg  = hdg;
    this.spd  = 0;
    this.isReversing  = false;
    this.revSpd       = 0;
    this.reverseTimer = 0;
    this.onGravel     = false;
    this.stuckTimer   = 0;
    this.lap          = 0;
    this.lapTimes     = [];
    // nearest-point hints (−1 = unknown → global search on next lookup)
    this.arcHint    = -1;   // into navPts
    this.trkHint    = -1;   // into trkPts
    this.gravelHint = -1;   // into gravelProfile.pts
    // policy-writable memory register (fed back as observations)
    this.mem = new Float64Array(4);
  }

  reset(pos, hdg) {
    this.pos.x = pos.x; this.pos.y = pos.y; this.pos.z = pos.z;
    this.hdg = hdg; this.spd = 0;
    this.isReversing = false; this.revSpd = 0; this.reverseTimer = 0;
    this.onGravel = false; this.stuckTimer = 0;
    this.lap = 0; this.lapTimes = [];
    this.arcHint = -1; this.trkHint = -1; this.gravelHint = -1;
    this.mem.fill(0);
  }

  update(inp, dt) {
    const { thr, brk, str } = inp;

    if (this.spd < 0.3 && brk > 0.5 && thr < 0.1 && !this.isReversing) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.3) this.isReversing = true;
    } else if (thr > 0.1) {
      this.isReversing = false; this.reverseTimer = 0;
    }
    if (this.isReversing && this.spd < 0.3 && brk < 0.1) this.isReversing = false;

    if (this.isReversing) {
      const revAccel = brk * this.data.accel * 0.4;
      const revDrag  = this.revSpd * this.revSpd * 0.01 + this.revSpd * 0.2;
      this.revSpd = Math.max(0, Math.min(8, this.revSpd + (revAccel - revDrag) * dt));
      if (thr > 0.1) this.revSpd = Math.max(0, this.revSpd - this.data.brake * 0.5 * dt);
      this.spd = 0;
      const sf = Math.max(0.5, 1 - this.revSpd / 8 * 0.4);
      if (this.revSpd > 0.3) this.hdg -= str * this.data.hdl * 1.8 * sf * dt;
      this.pos.x -= Math.sin(this.hdg) * this.revSpd * dt;
      this.pos.z -= Math.cos(this.hdg) * this.revSpd * dt;
    } else {
      this.revSpd = 0;
      const thrust    = (brk > 0.05 ? 0 : thr) * this.data.accel;
      const rollCoeff = 0.08;
      const dragCoeff = (this.data.accel - this.data.maxSpd * rollCoeff) / (this.data.maxSpd ** 2);
      const drag  = this.spd * this.spd * dragCoeff;
      const roll  = this.spd * rollCoeff;
      const bForce = brk * this.data.brake * (this.onGravel ? 0.5 : 1.0);
      this.spd = Math.max(0, Math.min(this.data.maxSpd, this.spd + (thrust - drag - roll - bForce) * dt));
      if (this.onGravel && this.spd > 22.2) this.spd = Math.max(22.2, this.spd - 18 * dt);
      const spdKph = this.spd * 3.6;
      const sfHigh = Math.max(0.28, 1 - this.spd / this.data.maxSpd * 0.60);
      const boost  = spdKph < 100 ? 1 + 0.5 * (1 - spdKph / 100) : 1.0;
      const ramp   = Math.min(1, spdKph);
      const sf     = sfHigh * boost * ramp;
      const hdlMult = this.onGravel ? 0.5 : 1.0;
      if (this.spd > 0) this.hdg += str * this.data.hdl * hdlMult * 2.2 * sf * dt;
      this.pos.x += Math.sin(this.hdg) * this.spd * dt;
      this.pos.z += Math.cos(this.hdg) * this.spd * dt;
    }

    // keep hdg bounded — it would otherwise grow ±2π per lap forever
    if (this.hdg > Math.PI || this.hdg < -Math.PI) this.hdg = wrapPi(this.hdg);

    this.pos.y = this._groundY();
    this.boundary(dt);
    this.checkGravel();
  }

  _groundY() {
    if (!trkPts.length) return 0;
    const r = nearestIdx(this.pos.x, this.pos.z, trkPts, this.trkHint, 25);
    this.trkHint = r.idx;
    return trkPts[r.idx].y;
  }

  boundary(dt) {
    if (!trkPts.length) return;

    if (cityCorridors && cityCorridors.length) {
      const px = this.pos.x, pz = this.pos.z;
      let inside = false;
      for (const c of cityCorridors) {
        if (px > c.x - c.hw && px < c.x + c.hw && pz > c.z - c.hd && pz < c.z + c.hd) { inside = true; break; }
      }
      if (!inside) {
        let bestDist = Infinity, bestPx = px, bestPz = pz;
        for (const c of cityCorridors) {
          const cx = Math.max(c.x - c.hw, Math.min(c.x + c.hw, px));
          const cz = Math.max(c.z - c.hd, Math.min(c.z + c.hd, pz));
          const d = (px - cx) ** 2 + (pz - cz) ** 2;
          if (d < bestDist) { bestDist = d; bestPx = cx; bestPz = cz; }
        }
        this.pos.x = bestPx; this.pos.z = bestPz;
        this.spd *= 0.82;
        if (this.isReversing) this.revSpd *= 0.7;
        this.stuckTimer += dt;
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - 0.04);
      }
      return;
    }

    const near = nearestIdx(this.pos.x, this.pos.z, trkPts, this.trkHint, 25);
    const ni = near.idx, md = near.d2;
    this.trkHint = ni;
    const np  = trkPts[ni];
    const nxt = trkPts[(ni + 1) % trkPts.length];
    const prv = trkPts[(ni + trkPts.length - 1) % trkPts.length];
    const tx = nxt.x - prv.x, tz = nxt.z - prv.z;
    const tLen = Math.hypot(tx, tz) || 1;
    const nx = -tz / tLen, nz = tx / tLen;
    const sideSign = ((this.pos.x - np.x) * nx + (this.pos.z - np.z) * nz) >= 0 ? 1 : -1;
    const targetWalls = sideSign > 0 ? trkWallRight : trkWallLeft;
    const wallPt = nearestWallPoint(this.pos.x, this.pos.z, targetWalls);

    if (wallPt) {
      const toWallX = wallPt.x - this.pos.x;
      const toWallZ = wallPt.z - this.pos.z;
      const wallDist = Math.hypot(toWallX, toWallZ);
      const WALL_STOP = 1.2;
      if (wallDist < WALL_STOP) {
        const pushLen  = wallDist || 1;
        const pushBack = WALL_STOP - wallDist;
        this.pos.x -= (toWallX / pushLen) * pushBack;
        this.pos.z -= (toWallZ / pushLen) * pushBack;
        this.spd *= 0.82;
        if (this.isReversing) this.revSpd *= 0.7;
        const trkHdg  = Math.atan2(tx, tz);
        const targetHdg = this.isReversing ? trkHdg + Math.PI : trkHdg;
        const hdgErr  = wrapPi(targetHdg - this.hdg);
        this.hdg += Math.max(-Math.PI / 16, Math.min(Math.PI / 16, hdgErr * 0.8));
        this.stuckTimer += dt;
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - 0.032);
      }
      return;
    }

    const dist = Math.sqrt(md), maxD = (trkData ? trkData.rw * 0.5 : 8) + 1.0;
    if (dist > maxD) {
      const px = np.x - this.pos.x, pz = np.z - this.pos.z;
      const pl = Math.sqrt(px * px + pz * pz) || 1;
      this.pos.x += px / pl * (dist - maxD + 0.5);
      this.pos.z += pz / pl * (dist - maxD + 0.5);
      this.spd *= 0.85;
      const trkHdg = Math.atan2(tx, tz);
      const targetHdg = this.isReversing ? trkHdg + Math.PI : trkHdg;
      const hdgErr = wrapPi(targetHdg - this.hdg);
      this.hdg += Math.max(-Math.PI / 18, Math.min(Math.PI / 18, hdgErr * 0.75));
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - 0.032);
    }
  }

  checkGravel() {
    const profile = gravelProfile;
    if (!profile) { this.onGravel = false; return; }
    const { pts, leftRunoff, rightRunoff, rw } = profile;
    const n = pts.length;
    const near = nearestIdx(this.pos.x, this.pos.z, pts, this.gravelHint, 40);
    const ni = near.idx;
    this.gravelHint = ni;
    const p   = pts[ni];
    const nxt = pts[(ni + 1) % n], prv = pts[(ni + n - 1) % n];
    const tx  = nxt.x - prv.x, tz = nxt.z - prv.z;
    const tl  = Math.hypot(tx, tz) || 1;
    const nx  = -tz / tl, nz = tx / tl;
    const lat = (this.pos.x - p.x) * nx + (this.pos.z - p.z) * nz;
    const latAbs = Math.abs(lat);
    const inner  = rw / 2 + 1.75;
    const ri     = Math.min(ni, rightRunoff.length - 1);
    const gravelW = lat >= 0 ? (rightRunoff[ri] || 0) : (leftRunoff[ri] || 0);
    this.onGravel = latAbs > inner && latAbs < inner + gravelW;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sensors
// ─────────────────────────────────────────────────────────────────────────────

const RAY_ANGLES = [
  -Math.PI / 2, -Math.PI / 3, -Math.PI / 6,
  -Math.PI / 18, -Math.PI / 36,
  0,
  Math.PI / 36, Math.PI / 18,
  Math.PI / 6, Math.PI / 3, Math.PI / 2,
];
const RAY_DIST = 200;
const EDGE_RAY_ANGLES = [
  -Math.PI / 2, -Math.PI / 4, -Math.PI / 18,
  0,
  Math.PI / 18, Math.PI / 4, Math.PI / 2,
];
const EDGE_RAY_DIST = 35;

function castRayFan(car, angles, maxDist, out, offset) {
  const ox = car.pos.x, oz = car.pos.z;
  const rr = maxDist * maxDist * 1.5;
  const near = [];
  for (const segs of [trkWallLeft, trkWallRight]) {
    for (const w of segs) {
      // Check midpoint AND both endpoints: midpoint-only misses wall segments
      // where the car is near one end but the segment midpoint is far away.
      const cx = (w.x0 + w.x1) * 0.5 - ox, cz = (w.z0 + w.z1) * 0.5 - oz;
      const e0x = w.x0 - ox, e0z = w.z0 - oz;
      const e1x = w.x1 - ox, e1z = w.z1 - oz;
      if (cx * cx + cz * cz < rr ||
          e0x * e0x + e0z * e0z < rr ||
          e1x * e1x + e1z * e1z < rr) near.push(w);
    }
  }
  for (let k = 0; k < angles.length; k++) {
    const angle = car.hdg + angles[k];
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let minT = maxDist;
    for (const w of near) {
      const t = raySegment(ox, oz, dx, dz, w.x0, w.z0, w.x1, w.z1);
      if (t > 0 && t < minT) minT = t;
    }
    out[offset + k] = minT / maxDist;
  }
}

// Look-ahead probes: fixed distances ahead along the centerline.
// Replaces the "controllable sensor ball" idea — the policy sees relative
// angle AND slope at every probe simultaneously, with a stationary
// observation distribution (no extra action needed).
// Probe distances extended: Jeff has a 122 m straight ending in a 90° turn.
// With the old 120 m max, the corner was invisible until the car was already on it.
// 200 m gives ~80 m of advance warning — enough for a full braking event.
const PROBE_DISTS = [10, 20, 35, 55, 100, 200];
const SLOPE_NORM  = 0.30;   // |Δy/Δs| considered "max steep"

// Memory cells: the policy gets MEM_DIM extra action outputs that write a
// rate-limited delta into a persistent per-car register, which is fed back
// as extra observations on the next decision. PPO treats the register as
// part of the environment state (stored in the observation), so no
// backprop-through-time is needed — this is the standard "external memory
// as action" recurrence. The delta limit keeps the register stable under
// the Gaussian exploration noise on the memory actions.
const MEM_DIM  = 4;
const MEM_RATE = 0.1;  // max register change per decision (≈5 % of range per tick)

// Observation layout:
//  [0..10]  11 track-edge rays (sqrt-normalised, like the original AI)
//  [11..17] 7 short wall rays
//  [18] speed fraction      [19] heading error to dynamic look-ahead waypoint
//  [20] edge proximity      [21] on-gravel flag
//  [22] reversing flag      [23] slope at the car
//  [24..35] 6 probes × (relative angle, slope between probes)
//  [36..39] 4 memory cells (written by the policy's memory actions)
const OBS_DIM = 24 + PROBE_DISTS.length * 2 + MEM_DIM;
const MEM_OBS = 24 + PROBE_DISTS.length * 2;   // base index of memory cells

// Arc position of a car, using and updating its locality hint.
function carArc(car) {
  const ap = arcPosition(car.pos.x, car.pos.z, car.arcHint);
  car.arcHint = ap.nearestIdx;
  return ap;
}

function buildObs(car, out) {
  castRayFan(car, RAY_ANGLES, RAY_DIST, out, 0);
  for (let k = 0; k < RAY_ANGLES.length; k++) out[k] = Math.sqrt(out[k]);
  castRayFan(car, EDGE_RAY_ANGLES, EDGE_RAY_DIST, out, 11);

  const ap = carArc(car);
  const speedFrac = car.spd / car.data.maxSpd;

  // Dynamic look-ahead waypoint heading error (same idea as the original AI)
  const useCity = !!(cityAiPts && cityAiPts.pts && cityAiPts.pts.length);
  const lookM = useCity ? 8 + speedFrac * 25 : 12 + speedFrac * 45;
  const tgt = pointAtArc(ap.s + lookM);
  const he  = wrapPi(Math.atan2(tgt.x - car.pos.x, tgt.z - car.pos.z) - car.hdg);

  const halfW = trkData ? trkData.rw * 0.5 : 10;
  out[18] = speedFrac;
  out[19] = Math.max(-1, Math.min(1, he / Math.PI));
  out[20] = Math.min(1, Math.sqrt(ap.nearestD2) / Math.max(1, halfW));
  out[21] = car.onGravel ? 1 : 0;
  out[22] = car.isReversing ? 1 : 0;

  // Slope at the car (immediate grade) + probes ahead
  let prevY = pointAtArc(ap.s).y;
  const hereAhead = pointAtArc(ap.s + 4);
  out[23] = Math.max(-1, Math.min(1, (hereAhead.y - prevY) / 4 / SLOPE_NORM));

  let prevD = 0;
  for (let k = 0; k < PROBE_DISTS.length; k++) {
    const d = PROBE_DISTS[k];
    const p = pointAtArc(ap.s + d);
    const ang = wrapPi(Math.atan2(p.x - car.pos.x, p.z - car.pos.z) - car.hdg);
    const slope = (p.y - prevY) / (d - prevD);
    out[24 + k * 2]     = Math.max(-1, Math.min(1, ang / Math.PI));
    out[24 + k * 2 + 1] = Math.max(-1, Math.min(1, slope / SLOPE_NORM));
    prevY = p.y; prevD = d;
  }
  for (let d = 0; d < MEM_DIM; d++) out[MEM_OBS + d] = car.mem[d];
  return ap; // caller reuses arc position for reward
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent (PPO actor-critic, or SAC actor + twin critics)
// ─────────────────────────────────────────────────────────────────────────────

const ACT_DIM = 2 + MEM_DIM; // [steer, throttle/brake, 4 memory-cell deltas]

let actor  = null;          // PPO: [OBS,h,ACT] → means · SAC: [OBS,h,2·ACT] → mean+logStd
let critic = null;          // PPO only: Net [OBS_DIM, h, 1] → state value
let logStd = null;          // PPO only: Float64Array(ACT_DIM), learnable
let lsM = null, lsV = null; // Adam moments for logStd
let lsT = 0;

// SAC networks + temperature
let q1 = null, q2 = null;   // twin critics, Net [OBS+ACT, h, 1]
let tq1 = null, tq2 = null; // polyak-averaged target critics
let logAlpha = 0;           // learned entropy temperature (log α)
let laM = 0, laV = 0, laT = 0; // Adam state for logAlpha
const TARGET_ENTROPY = -ACT_DIM;
const SAC_INIT_ALPHA = 0.2;
const SAC_WARMUP     = 2000;  // transitions before gradient steps start

const isSAC = () => cfg.algo === 'sac';

function cloneNet(src) {
  const n = new Net(src.sizes, 1);
  n.loadFlat(src.flatF64());
  return n;
}

function initAgent(modelOverride) {
  const h = cfg.hiddenSize, nl = Math.max(1, cfg.hiddenLayers | 0);
  if (isSAC()) {
    const actSizes = [OBS_DIM, ...Array(nl).fill(h), 2 * ACT_DIM];
    const qSizes   = [OBS_DIM + ACT_DIM, ...Array(nl).fill(h), 1];
    actor = new Net(actSizes, 0.01);
    // logStd head starts at −0.5 (σ≈0.6) — same starting noise as PPO
    const lb = actor.b[actor.b.length - 1];
    for (let d = 0; d < ACT_DIM; d++) lb[ACT_DIM + d] = -0.5;
    q1 = new Net(qSizes, 1);
    q2 = new Net(qSizes, 1);
    tq1 = cloneNet(q1);
    tq2 = cloneNet(q2);
    logAlpha = Math.log(SAC_INIT_ALPHA);
    laM = 0; laV = 0; laT = 0;
    critic = null; logStd = null;
  } else {
    const actSizes  = [OBS_DIM, ...Array(nl).fill(h), ACT_DIM];
    const critSizes = [OBS_DIM, ...Array(nl).fill(h), 1];
    actor  = new Net(actSizes,  0.01);
    critic = new Net(critSizes, 1);
    logStd = new Float64Array(ACT_DIM).fill(-0.5);
    lsM = new Float64Array(ACT_DIM);
    lsV = new Float64Array(ACT_DIM);
    lsT = 0;
    q1 = q2 = tq1 = tq2 = null;
  }
  if (modelOverride) {
    try {
      if (modelOverride.algo !== cfg.algo) {
        throw new Error(`model is ${modelOverride.algo || 'unknown'} but the trainer is set to ${cfg.algo}`);
      }
      const mSizes = modelOverride.actor.sizes;
      const wantOut = isSAC() ? 2 * ACT_DIM : ACT_DIM;
      if (modelOverride.obsDim !== OBS_DIM || mSizes[mSizes.length - 1] !== wantOut) {
        throw new Error(`incompatible model: expects obs ${modelOverride.obsDim}/act-out ${mSizes[mSizes.length - 1]}, ` +
                        `current layout is obs ${OBS_DIM}/act-out ${wantOut}`);
      }
      actor = new Net(modelOverride.actor.sizes, 1);
      actor.loadFlat(modelOverride.actor.flat);
      if (isSAC()) {
        q1 = new Net(modelOverride.q1.sizes, 1);
        q1.loadFlat(modelOverride.q1.flat);
        q2 = new Net(modelOverride.q2.sizes, 1);
        q2.loadFlat(modelOverride.q2.flat);
        tq1 = modelOverride.tq1 ? new Net(modelOverride.tq1.sizes, 1) : cloneNet(q1);
        if (modelOverride.tq1) tq1.loadFlat(modelOverride.tq1.flat);
        tq2 = modelOverride.tq2 ? new Net(modelOverride.tq2.sizes, 1) : cloneNet(q2);
        if (modelOverride.tq2) tq2.loadFlat(modelOverride.tq2.flat);
        logAlpha = Number.isFinite(modelOverride.logAlpha)
          ? modelOverride.logAlpha : Math.log(SAC_INIT_ALPHA);
        laM = 0; laV = 0; laT = 0;
      } else {
        critic = new Net(modelOverride.critic.sizes, 1);
        critic.loadFlat(modelOverride.critic.flat);
        logStd = Float64Array.from(modelOverride.logStd);
        lsM = new Float64Array(ACT_DIM);
        lsV = new Float64Array(ACT_DIM);
        lsT = 0;
      }
    } catch (err) {
      postMessage({ type: 'error', message: 'Model import failed: ' + err.message });
    }
  }
}

function logProb(act, mean) {
  let lp = 0;
  for (let d = 0; d < ACT_DIM; d++) {
    const sd = Math.exp(logStd[d]);
    const z = (act[d] - mean[d]) / sd;
    lp += -0.5 * z * z - logStd[d] - 0.5 * LOG_2PI;
  }
  return lp;
}

// SAC action: a = tanh(μ + σ·ε) — bounded by construction.
function sacSampleAction(obs, out) {
  const v = actor.forward(obs);
  for (let d = 0; d < ACT_DIM; d++) {
    const ls = Math.max(SAC_LOGSTD_MIN, Math.min(SAC_LOGSTD_MAX, v[ACT_DIM + d]));
    out[d] = Math.tanh(v[d] + Math.exp(ls) * gauss());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SAC replay buffer — Float32 ring buffer in this worker (the canonical
//  store; GPU rounds ship pre-sampled minibatches, never the whole buffer)
// ─────────────────────────────────────────────────────────────────────────────

let rb = null;

function initReplay() {
  const cap = Math.max(10000, cfg.bufferSize | 0);
  rb = {
    cap, size: 0, idx: 0,
    obs:  new Float32Array(cap * OBS_DIM),
    act:  new Float32Array(cap * ACT_DIM),
    rew:  new Float32Array(cap),
    obs2: new Float32Array(cap * OBS_DIM),
    done: new Uint8Array(cap),
  };
}

function rbPush(obs, act, rew, obs2, done) {
  const i = rb.idx;
  rb.obs.set(obs, i * OBS_DIM);
  rb.act.set(act, i * ACT_DIM);
  rb.rew[i] = rew;
  rb.obs2.set(obs2, i * OBS_DIM);
  rb.done[i] = done;
  rb.idx = (i + 1) % rb.cap;
  if (rb.size < rb.cap) rb.size++;
  sacNewSamples++;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Environments
// ─────────────────────────────────────────────────────────────────────────────

let envs = [];              // per-env state
let iteration   = 0;        // PPO update count / SAC gradient-step count
let totalSteps  = 0;        // total physics steps across envs
let agentSteps  = 0;        // PPO transitions collected since last update
let recentReturns = [];     // last completed episode returns
let bestLap = Infinity;
let lastLoss = { pi: 0, v: 0, ent: 0 };

// SAC scheduling: rounds of G async gradient steps, G ≈ new transitions × UTD
let sacNewSamples = 0;      // transitions since the last round was launched
let _sacRunning   = false;
let lastSacStats  = null;   // { alpha, std } for the HUD
const SAC_MIN_ROUND = 8;    // don't launch a round for fewer steps than this
const SAC_MAX_ROUND = 128;  // cap per round so weights stay fresh-ish

// ── Best-network snapshot ────────────────────────────────────────────────────
// A network is judged by the AVERAGE return over the recent episodes of ALL
// parallel agents — one lucky agent or one lucky episode is not enough. The
// best-average snapshot is what 'exportModel' saves by default, and training
// can be manually reset to it ('loadBest') after the policy drifts somewhere
// worse (PPO is on-policy and has no built-in way back out of a bad local
// optimum once exploration noise has shrunk).
let best = null;            // { aFlat, cFlat, logStd, avg, iter }
let curAvg = null;          // average return of the current window
let _loadBestPending = false; // manual restore requested while an update runs

const BEST_WINDOW  = 20;    // episodes in the scoring window
const BEST_MIN_EPS = 12;    // minimum episodes before scoring

function spawnPose(envIdx) {
  const n = trkPts.length;
  if (!n) return { pos: { x: 0, y: 0, z: 0 }, hdg: 0 };
  let idx;
  if (cfg.randomSpawn) {
    idx = Math.floor(Math.random() * n);
  } else {
    // grid behind the start line, one row per env
    const ROW_STEP = 8;
    idx = ((n - Math.floor(envIdx / 2) * ROW_STEP) % n + n) % n;
  }
  const pt  = trkPts[idx], ptF = trkPts[(idx + 5) % n];
  const hdg = Math.atan2(ptF.x - pt.x, ptF.z - pt.z);
  // small lateral jitter for diversity
  const rx = Math.cos(hdg), rz = -Math.sin(hdg);
  const off = cfg.randomSpawn ? (Math.random() * 2 - 1) * Math.min(3, (trkData ? trkData.rw : 12) * 0.2) : 0;
  return { pos: { x: pt.x + rx * off, y: pt.y, z: pt.z + rz * off }, hdg };
}

function makeEnv(i) {
  const sp = spawnPose(i);
  const car = new SimCar(carSpec, sp.pos, sp.hdg);
  return {
    car,
    // arc tracking for progress reward + lap detection
    prevS: carArc(car).s,
    lapAcc: 0,            // accumulated forward metres this lap
    lapTime: 0,
    epTime: 0,
    epReturn: 0,
    offTrackTime: 0,
    noProgTime: 0,
    prevStuck: 0,
    // action-repeat bookkeeping
    repCount: 0,
    curAct: new Float64Array(ACT_DIM),
    // pending transition (written to buffer when the repeat window closes)
    pendObs: null, pendLogp: 0, pendVal: 0, rewAcc: 0,
    // per-env rollout chain
    buf: { obs: [], act: [], logp: [], val: [], rew: [], done: [] },
  };
}

function resetEnv(env, i) {
  const sp = spawnPose(i);
  env.car.reset(sp.pos, sp.hdg);
  env.prevS = carArc(env.car).s;
  env.lapAcc = 0; env.lapTime = 0;
  env.epTime = 0; env.epReturn = 0;
  env.offTrackTime = 0; env.noProgTime = 0; env.prevStuck = 0;
  env.repCount = 0;
  env.pendObs = null; env.rewAcc = 0;
}

function initSim(modelOverride) {
  buildArcTable();
  initAgent(modelOverride || null);
  if (isSAC()) initReplay(); else rb = null;
  envs = Array.from({ length: cfg.numEnvs }, (_, i) => makeEnv(i));
  iteration = 0; totalSteps = 0; agentSteps = 0;
  // NOTE: _sacRunning is NOT reset here — an in-flight round clears it when
  // it finishes (its weight writes are discarded via the myActor guard), and
  // resetting early would let a new round race it on the gradient pool.
  sacNewSamples = 0; lastSacStats = null;
  recentReturns = []; bestLap = Infinity;
  simTime = 0;
  lastLoss = { pi: 0, v: 0, ent: 0 };
  best = null; curAvg = null; _loadBestPending = false;
}

// Finalize the pending transition of an env into its rollout chain.
function commitTransition(env, done) {
  if (!env.pendObs) return;
  env.buf.obs.push(env.pendObs);
  env.buf.act.push(Float64Array.from(env.curAct));
  env.buf.logp.push(env.pendLogp);
  env.buf.val.push(env.pendVal);
  env.buf.rew.push(env.rewAcc);
  env.buf.done.push(done ? 1 : 0);
  env.pendObs = null;
  env.rewAcc = 0;
  agentSteps++;
}

function terminateEnv(env, i, penalty, truncated) {
  // per-tick rewards are already in epReturn; only the penalty/bootstrap
  // terms are added to the stored transition reward here
  if (penalty) env.rewAcc -= penalty;
  if (isSAC()) {
    if (env.pendObs) {
      // store the post-step observation; truncation keeps done=0 so the
      // critic bootstraps through the time limit (no value estimate needed
      // at collection time — the replayed target handles it)
      const obs2 = new Float64Array(OBS_DIM);
      buildObs(env.car, obs2);
      rbPush(env.pendObs, env.curAct, env.rewAcc, obs2, truncated ? 0 : 1);
      env.pendObs = null;
      env.rewAcc = 0;
    }
  } else {
    if (truncated && env.pendObs) {
      // bootstrap the value of the post-step state so truncation isn't
      // mistaken for a real terminal
      const obs = new Float64Array(OBS_DIM);
      buildObs(env.car, obs);
      env.rewAcc += cfg.gamma * critic.forward(obs)[0];
    }
    commitTransition(env, true);
  }
  recentReturns.push(env.epReturn);
  if (recentReturns.length > 50) recentReturns.shift();
  resetEnv(env, i);
}

// One physics tick for every env (dt = FIXED_DT).
function stepOnce(dt) {
  // Back-pressure (PPO only): if an update is in flight and the next batch is
  // already twice the horizon, pause collection so batches can't grow without
  // bound at high speed multipliers. SAC never pauses — off-policy data stays
  // valid, and the round size cap bounds the gradient-step backlog instead.
  if (!isSAC() && _ppoRunning && agentSteps >= cfg.horizon * cfg.numEnvs * 2) return;

  simTime += dt;
  for (let i = 0; i < envs.length; i++) {
    const env = envs[i];
    const car = env.car;

    // ── New agent decision at the start of each repeat window ──
    if (env.repCount <= 0) {
      const obs = new Float64Array(OBS_DIM);
      buildObs(car, obs);
      if (isSAC()) {
        // close the previous transition with this obs as its successor state
        if (env.pendObs) {
          rbPush(env.pendObs, env.curAct, env.rewAcc, obs, 0);
          env.rewAcc = 0;
        }
        sacSampleAction(obs, env.curAct);
        env.pendObs = obs;
      } else {
        commitTransition(env, false); // finalize previous window (non-terminal)
        const mean = actor.forward(obs);
        for (let d = 0; d < ACT_DIM; d++) {
          env.curAct[d] = mean[d] + Math.exp(logStd[d]) * gauss();
        }
        env.pendObs  = obs;
        env.pendLogp = logProb(env.curAct, mean);
        env.pendVal  = critic.forward(obs)[0];
      }
      env.repCount = cfg.actionRepeat;
      // Memory write: rate-limited delta from the memory actions. Applied
      // after the observation snapshot, so the new value appears in the
      // NEXT decision's observation.
      for (let d = 0; d < MEM_DIM; d++) {
        const a = Math.max(-1, Math.min(1, env.curAct[2 + d]));
        car.mem[d] = Math.max(-1, Math.min(1, car.mem[d] + MEM_RATE * a));
      }
    }
    env.repCount--;

    // ── Apply action ──
    const str = Math.max(-1, Math.min(1, env.curAct[0]));
    const a1  = Math.max(-1, Math.min(1, env.curAct[1]));
    const thr = a1 > 0 ? a1 : 0;
    const brk = a1 < 0 ? -a1 : 0;
    car.update({ thr, brk, str }, dt);
    totalSteps++;

    // ── Reward ──
    const ap = carArc(car);
    let ds = ap.s - env.prevS;
    if (ds >  trackLen / 2) ds -= trackLen;
    if (ds < -trackLen / 2) ds += trackLen;
    env.prevS = ap.s;
    let r = ds * cfg.progressReward;

    // Lap detection via accumulated forward arc distance
    env.lapAcc += ds;
    env.lapTime += dt;
    if (env.lapAcc >= trackLen) {
      env.lapAcc -= trackLen;
      car.lap++;
      car.lapTimes.push(env.lapTime);
      if (env.lapTime < bestLap) bestLap = env.lapTime;
      env.lapTime = 0;
      r += cfg.lapBonus;
    }

    if (car.onGravel) r -= cfg.gravelPenalty * dt;
    const stuckInc = car.stuckTimer - env.prevStuck;
    if (stuckInc > 0) r -= cfg.wallPenalty * stuckInc;
    env.prevStuck = car.stuckTimer;

    env.rewAcc  += r;
    env.epReturn += r;
    env.epTime  += dt;

    // ── Termination checks ──
    // off-track: not on gravel and beyond the road + margin (circuit only;
    // city corridors hard-clamp position so they can't leave the track)
    let terminated = false;
    if (trkData && !(cityCorridors && cityCorridors.length)) {
      const halfW = trkData.rw * 0.5;
      const off = !car.onGravel && Math.sqrt(ap.nearestD2) > halfW + 2;
      if (off) {
        env.offTrackTime += dt;
        if (env.offTrackTime > 1.0) terminated = true;
      } else {
        env.offTrackTime = Math.max(0, env.offTrackTime - dt);
      }
    }
    // stuck: under 1 m of net progress in a 4 s window (after 5 s of grace)
    if (Math.abs(ds) < 0.02 * dt * 60) env.noProgTime += dt;
    else env.noProgTime = 0;
    if (env.epTime > 5 && env.noProgTime > 4) terminated = true;

    if (terminated) {
      env.epReturn -= cfg.terminalPenalty;
      terminateEnv(env, i, cfg.terminalPenalty, false);
    } else if (env.epTime >= cfg.episodeLen) {
      terminateEnv(env, i, 0, true);
    }
  }

  // ── Trigger async updates ──
  if (isSAC()) {
    // a round of ≈ newTransitions × UTD gradient steps, whenever the
    // previous round has finished and enough fresh data arrived
    if (!_sacRunning && rb && rb.size >= SAC_WARMUP &&
        Math.round(sacNewSamples * cfg.utd) >= SAC_MIN_ROUND) {
      const G = Math.min(SAC_MAX_ROUND, Math.round(sacNewSamples * cfg.utd));
      sacNewSamples = 0;
      _sacRunning = true;
      _runSAC(G);
    }
  } else if (agentSteps >= cfg.horizon * cfg.numEnvs && !_ppoRunning) {
    _ppoRunning = true;
    const batch = _flushBatch();   // sync: GAE + clear env bufs
    agentSteps = 0;
    if (batch.N >= 8) _runPPO(batch); else _ppoRunning = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Gradient worker pool — distributes minibatch gradient computation across
//  CPU cores. Each minibatch is split into slices; every grad worker computes
//  gradient sums over its slice with the current weights, the results are
//  reduced here and a single Adam step is applied. While the pool is busy
//  this worker's event loop is free, so the simulation keeps ticking.
// ─────────────────────────────────────────────────────────────────────────────

let gradPool = null;   // Worker[] — empty array means "fall back to local compute"
let _wasmOk  = false;  // a grad-worker confirmed its WASM module loaded
let _wasmErr = '';     // last WASM load/runtime error reported by a grad-worker

// GPU backend (cfg.backend === 'gpu') — TensorFlow.js WebGL in a nested
// worker (tf-worker.js). The hand-written WebGPU kernel was removed from the
// trainer: Firefox drives WebGPU buffer mapping from a 100 ms polling timer
// (Bugzilla #1870699 / wgpu #6660) and its WebGPU process is crash-prone
// under sustained compute, which lagged the whole system and crashed the
// browser. The tf worker runs the COMPLETE update (all epochs) and sends the
// new weights back — one message round-trip per update.
let tfWorker   = null;
let gpuState   = 'off';    // 'off' | 'init' | 'ready' | 'failed'
let gpuInfo    = '';
let _tfPending = null;     // { resolve, reject, timer } of the in-flight update

function desiredThreads() {
  const t = cfg.threads | 0;
  if (t > 0) return Math.max(1, Math.min(64, t));
  const hc = (self.navigator && self.navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(6, hc - 2)); // leave cores for sim + render
}

let _poolRebuild = false; // thread count changed mid-update → rebuild when idle

function initGradPool(force) {
  if (gradPool !== null && !force) return;
  if (gradPool) for (const x of gradPool) { try { x.terminate(); } catch (_) { /* dead */ } }
  gradPool = [];
  try {
    const n = desiredThreads();
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./grad-worker.js', import.meta.url), { type: 'module' });
      w.onerror = () => { // nested workers unsupported / failed → local fallback
        for (const x of gradPool) { try { x.terminate(); } catch (_) { /* already dead */ } }
        gradPool = [];
      };
      // persistent status listener — independent of per-task onmessage
      w.addEventListener('message', e => {
        const d = e.data;
        if (d && d.type === 'wasmStatus') {
          if (d.ok) _wasmOk = true;
          else if (d.error) _wasmErr = d.error;
        }
      });
      gradPool.push(w);
    }
  } catch (err) {
    gradPool = [];
  }
}

function _tfFail(msg) {
  gpuState = 'failed';
  gpuInfo = 'GPU unavailable: ' + msg;
  if (_tfPending) {
    clearTimeout(_tfPending.timer);
    const p = _tfPending; _tfPending = null;
    p.reject(new Error(msg));
  }
  if (tfWorker) { try { tfWorker.terminate(); } catch (_) { /* dead */ } tfWorker = null; }
}

// Push the JS-side weights to the tf worker — required whenever they change
// outside a GPU update (CPU-path updates during init, reset, load-best).
function sendTfWeights() {
  if (!tfWorker || gpuState !== 'ready' || !actor) return;
  if (isSAC()) {
    tfWorker.postMessage({
      type: 'setWeights',
      actorFlat: Float32Array.from(actor.flatF64()),
      q1Flat:    Float32Array.from(q1.flatF64()),
      q2Flat:    Float32Array.from(q2.flatF64()),
      tq1Flat:   Float32Array.from(tq1.flatF64()),
      tq2Flat:   Float32Array.from(tq2.flatF64()),
      logAlpha,
    });
  } else {
    tfWorker.postMessage({
      type: 'setWeights',
      actorFlat:  Float32Array.from(actor.flatF64()),
      criticFlat: Float32Array.from(critic.flatF64()),
      logStd:     Float32Array.from(logStd),
    });
  }
}

function initGpu() {
  if (tfWorker) { try { tfWorker.terminate(); } catch (_) { /* dead */ } tfWorker = null; }
  if (_tfPending) { clearTimeout(_tfPending.timer); _tfPending = null; }
  if (cfg.backend !== 'gpu') { gpuState = 'off'; gpuInfo = ''; return; }
  gpuState = 'init'; gpuInfo = 'GPU (TF.js WebGL) initializing…';
  try {
    // classic worker — tf.min.js is a UMD bundle loaded via importScripts
    tfWorker = new Worker(new URL('./tf-worker.js', import.meta.url));
    tfWorker.onerror = e => _tfFail((e && e.message) || 'tf-worker failed to load');
    tfWorker.onmessage = e => {
      const d = e.data;
      if (d.type === 'ready') {
        gpuState = 'ready';
        gpuInfo = 'TF.js GPU active (' + d.backend + ')';
        sendTfWeights();  // CPU-path updates may have run while tf initialized
        return;
      }
      if (d.type === 'fail') { _tfFail(d.error); return; }
      if (d.type === 'updated' && _tfPending) {
        clearTimeout(_tfPending.timer);
        const p = _tfPending; _tfPending = null;
        p.resolve(d);
        return;
      }
      if (d.type === 'error') {
        if (_tfPending) {
          clearTimeout(_tfPending.timer);
          const p = _tfPending; _tfPending = null;
          p.reject(new Error(d.error));
        } else {
          _tfFail(d.error);
        }
      }
    };
    if (isSAC()) {
      tfWorker.postMessage({
        type: 'init', algo: 'sac',
        actorSizes: actor.sizes, qSizes: q1.sizes,
        actorFlat: Float32Array.from(actor.flatF64()),
        q1Flat:    Float32Array.from(q1.flatF64()),
        q2Flat:    Float32Array.from(q2.flatF64()),
        tq1Flat:   Float32Array.from(tq1.flatF64()),
        tq2Flat:   Float32Array.from(tq2.flatF64()),
        logAlpha,
        lr: cfg.lr, gamma: cfg.gamma,
        targetEntropy: TARGET_ENTROPY, tau: cfg.tau,
      });
    } else {
      tfWorker.postMessage({
        type: 'init',
        actorSizes: actor.sizes, criticSizes: critic.sizes,
        actorFlat:  Float32Array.from(actor.flatF64()),
        criticFlat: Float32Array.from(critic.flatF64()),
        logStd:     Float32Array.from(logStd),
        lr: cfg.lr,
      });
    }
  } catch (err) {
    _tfFail(String(err && err.message || err));
  }
}

function gradTask(w, msg, transfers) {
  return new Promise((resolve, reject) => {
    w.onmessage = e => {
      if (e.data && e.data.type === 'gradResult') resolve(e.data);
      // ignore status messages — handled by the persistent listener
    };
    w.onerror = e => reject(e);
    w.postMessage(msg, transfers);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PPO batch preparation (synchronous — runs once per horizon fill)
// ─────────────────────────────────────────────────────────────────────────────

let _ppoRunning = false;

function _flushBatch() {
  // Close any open repeat windows; envs get fresh decisions next tick.
  for (const env of envs) { commitTransition(env, false); env.repCount = 0; }

  const OBS = [], ACT = [], LOGP = [], ADV = [], RET = [];
  for (const env of envs) {
    const b = env.buf, T = b.obs.length;
    if (!T) continue;
    let nextVal = 0;
    if (!b.done[T - 1]) {
      const obs = new Float64Array(OBS_DIM);
      buildObs(env.car, obs);
      nextVal = critic.forward(obs)[0];
    }
    let gae = 0;
    const adv = new Float64Array(T);
    for (let t = T - 1; t >= 0; t--) {
      const nonTerm = 1 - b.done[t];
      const nextV = t === T - 1 ? nextVal : b.val[t + 1];
      const delta = b.rew[t] + cfg.gamma * nextV * nonTerm - b.val[t];
      gae = delta + cfg.gamma * cfg.lam * nonTerm * gae;
      adv[t] = gae;
    }
    for (let t = 0; t < T; t++) {
      OBS.push(b.obs[t]); ACT.push(b.act[t]); LOGP.push(b.logp[t]);
      ADV.push(adv[t]); RET.push(adv[t] + b.val[t]);
    }
    b.obs.length = 0; b.act.length = 0; b.logp.length = 0;
    b.val.length = 0; b.rew.length = 0; b.done.length = 0;
  }
  return { OBS, ACT, LOGP, ADV, RET, N: OBS.length };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PPO gradient update — asynchronous and multi-core.
//
//  Each minibatch is split across the gradient worker pool; while the pool
//  computes, this worker awaits — its event loop is free, so simLoop keeps
//  ticking and the cars never freeze. Falls back to local computation
//  (yielding between minibatches) if nested workers are unavailable.
// ─────────────────────────────────────────────────────────────────────────────

function packSlice(OBS, ACT, LOGP, ADV, RET, idx, s0, s1) {
  const n = s1 - s0;
  const obs  = new Float64Array(n * OBS_DIM);
  const act  = new Float64Array(n * ACT_DIM);
  const logp = new Float64Array(n);
  const adv  = new Float64Array(n);
  const ret  = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const s = idx[s0 + k];
    obs.set(OBS[s], k * OBS_DIM);
    act.set(ACT[s], k * ACT_DIM);
    logp[k] = LOGP[s]; adv[k] = ADV[s]; ret[k] = RET[s];
  }
  return { n, obsDim: OBS_DIM, actDim: ACT_DIM, obs, act, logp, adv, ret };
}

// Pack an entire shuffled epoch into flat Float64Arrays for computeEpoch().
function packEpochData(OBS, ACT, LOGP, ADV, RET, idx, N) {
  const obs  = new Float64Array(N * OBS_DIM);
  const act  = new Float64Array(N * ACT_DIM);
  const logp = new Float64Array(N);
  const adv  = new Float64Array(N);
  const ret  = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const s = idx[k];
    obs.set(OBS[s], k * OBS_DIM);
    act.set(ACT[s], k * ACT_DIM);
    logp[k] = LOGP[s]; adv[k] = ADV[s]; ret[k] = RET[s];
  }
  return { N, obs, act, logp, adv, ret };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Best-network snapshot (by average return across all agents)
// ─────────────────────────────────────────────────────────────────────────────

function updateBestSnapshot() {
  const tail = recentReturns.slice(-BEST_WINDOW);
  if (tail.length < BEST_MIN_EPS) { curAvg = null; return; }
  let avg = 0; for (const r of tail) avg += r; avg /= tail.length;
  curAvg = avg;
  if (!best || avg > best.avg) {
    best = isSAC()
      ? {
        algo: 'sac',
        aFlat: actor.flatF64(),
        q1Flat: q1.flatF64(), q2Flat: q2.flatF64(),
        tq1Flat: tq1.flatF64(), tq2Flat: tq2.flatF64(),
        logAlpha,
        avg, iter: iteration,
      }
      : {
        algo: 'ppo',
        aFlat: actor.flatF64(), cFlat: critic.flatF64(),
        logStd: Float64Array.from(logStd),
        avg, iter: iteration,
      };
  }
}

// Restore the best snapshot. Only call between updates (weights must not
// change while gradient tasks are in flight).
function loadBestSnapshot() {
  if (!best) return;
  actor.loadFlat(best.aFlat);
  actor.resetAdam();
  if (isSAC()) {
    q1.loadFlat(best.q1Flat);   q1.resetAdam();
    q2.loadFlat(best.q2Flat);   q2.resetAdam();
    tq1.loadFlat(best.tq1Flat);
    tq2.loadFlat(best.tq2Flat);
    logAlpha = best.logAlpha;
    laM = 0; laV = 0; laT = 0;
    // The replay buffer is KEPT — off-policy data stays valid for the
    // restored policy, and α re-opens exploration on its own if needed.
    for (const env of envs) { env.pendObs = null; env.rewAcc = 0; env.repCount = 0; }
    sacNewSamples = 0;
  } else {
    critic.loadFlat(best.cFlat);
    logStd.set(best.logStd);
    critic.resetAdam();
    lsM.fill(0); lsV.fill(0); lsT = 0;
    // Re-open exploration a little: the abandoned direction was a dead end, so
    // the restored policy needs noise to find a DIFFERENT improvement.
    for (let d = 0; d < ACT_DIM; d++) logStd[d] = Math.min(0.3, logStd[d] + 0.25);
    // Drop rollouts and episode stats gathered under the abandoned policy —
    // stale transitions would train the restored weights toward it again.
    for (const env of envs) {
      const b = env.buf;
      b.obs.length = 0; b.act.length = 0; b.logp.length = 0;
      b.val.length = 0; b.rew.length = 0; b.done.length = 0;
      env.pendObs = null; env.rewAcc = 0; env.repCount = 0;
    }
    agentSteps = 0;
  }
  recentReturns = [];
  curAvg = null;
  sendTfWeights();  // keep the GPU backend's resident weights in sync
}

async function _runPPO(batch) {
  const { OBS, ACT, LOGP, ADV, RET } = batch;
  const N = OBS.length;

  // Normalize advantages
  let mean = 0; for (const a of ADV) mean += a; mean /= N;
  let varr = 0; for (const a of ADV) varr += (a - mean) ** 2;
  const std = Math.sqrt(varr / N) + 1e-8;
  for (let k = 0; k < N; k++) ADV[k] = (ADV[k] - mean) / std;

  const idx = Array.from({ length: N }, (_, k) => k);
  const hp = { clip: cfg.clip, entropyCoef: cfg.entropyCoef, vfCoef: cfg.vfCoef };
  let sumPi = 0, sumV = 0, sumEnt = 0, nMB = 0;
  let gpuDone = false;

  // ── GPU path: the COMPLETE update (all epochs, shuffling, Adam) runs on the
  //    TF.js worker; the new weights come back in one message ────────────────
  if (gpuState === 'ready' && tfWorker) {
    try {
      const data = packEpochData(OBS, ACT, LOGP, ADV, RET, idx, N);  // natural order
      const r = await new Promise((resolve, reject) => {
        _tfPending = {
          resolve, reject,
          timer: setTimeout(() => {
            _tfPending = null;
            reject(new Error('GPU update timeout (>60s)'));
          }, 60000),
        };
        const obs  = Float32Array.from(data.obs),  act = Float32Array.from(data.act);
        const logp = Float32Array.from(data.logp), adv = Float32Array.from(data.adv);
        const ret  = Float32Array.from(data.ret);
        tfWorker.postMessage({
          type: 'update', n: N, obs, act, logp, adv, ret,
          hp: { ...hp, lr: cfg.lr },
          epochs: cfg.epochs, minibatch: cfg.minibatch,
        }, [obs.buffer, act.buffer, logp.buffer, adv.buffer, ret.buffer]);
      });
      // sanity: never load NaN/Inf weights into the live policy
      let finite = Number.isFinite(r.loss.pi) && Number.isFinite(r.loss.v);
      for (let k = 0; finite && k < r.actorFlat.length; k += 97) {
        finite = Number.isFinite(r.actorFlat[k]);
      }
      if (!finite) throw new Error('non-finite weights returned');
      actor.loadFlat(r.actorFlat);
      critic.loadFlat(r.criticFlat);
      for (let d2 = 0; d2 < ACT_DIM; d2++) logStd[d2] = r.logStd[d2];
      lastLoss = r.loss;
      gpuDone = true;
    } catch (err) {
      _tfFail(String(err && err.message || err));
      // fall through to the CPU path for this batch
    }
  }

  for (let ep = 0; ep < cfg.epochs && !gpuDone; ep++) {
    // Fisher-Yates shuffle
    for (let k = N - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      const tmp = idx[k]; idx[k] = idx[j]; idx[j] = tmp;
    }

    // ── CPU path (pool or local): per-minibatch ──────────────────────────────
    for (let start = 0; start < N; start += cfg.minibatch) {
      const end = Math.min(N, start + cfg.minibatch);
      const bs = end - start;
      let gLs, mbPi, mbV, mbEnt;

      const pool = gradPool && gradPool.length ? gradPool : null;
      if (pool) {
        // ── Parallel: split the minibatch across the pool ──
        const K = Math.min(pool.length, Math.max(1, Math.floor(bs / 32)));
        const per = Math.ceil(bs / K);
        const aFlat = actor.flatF64(), cFlat = critic.flatF64();
        const lsArr = Array.from(logStd);
        const tasks = [];
        for (let c = 0; c < K; c++) {
          const s0 = start + c * per, s1 = Math.min(end, s0 + per);
          if (s0 >= s1) break;
          const slice = packSlice(OBS, ACT, LOGP, ADV, RET, idx, s0, s1);
          tasks.push(gradTask(pool[c], {
            type: 'grad',
            force: cfg.backend === 'js' ? 'js' : 'auto',
            actorSizes: actor.sizes, criticSizes: critic.sizes,
            actorFlat: aFlat, criticFlat: cFlat, logStd: lsArr,
            hp, ...slice,
          }, [slice.obs.buffer, slice.act.buffer, slice.logp.buffer, slice.adv.buffer, slice.ret.buffer]));
        }
        let results;
        try {
          results = await Promise.all(tasks);
        } catch (err) {
          // pool died mid-update (e.g. nested workers unsupported) → disable
          for (const x of gradPool) { try { x.terminate(); } catch (_) { /* dead */ } }
          gradPool = [];
          start -= cfg.minibatch; // redo this minibatch locally
          continue;
        }
        const aG = new Float64Array(aFlat.length);
        const cG = new Float64Array(cFlat.length);
        gLs = new Float64Array(ACT_DIM);
        mbPi = 0; mbV = 0; mbEnt = 0;
        for (const r of results) {
          for (let k = 0; k < aG.length; k++) aG[k] += r.aG[k];
          for (let k = 0; k < cG.length; k++) cG[k] += r.cG[k];
          for (let d = 0; d < ACT_DIM; d++) gLs[d] += r.gLs[d];
          mbPi += r.pi; mbV += r.v; mbEnt += r.ent;
          if (r.mode === 'wasm') _wasmOk = true;
        }
        actor.loadGradFlat(aG);
        critic.loadGradFlat(cG);
      } else {
        // ── Local fallback: single-threaded gradient computation ──
        actor.zeroGrad(); critic.zeroGrad();
        const slice = packSlice(OBS, ACT, LOGP, ADV, RET, idx, start, end);
        const r = accumulatePPOGrads(actor, critic, logStd, hp, slice);
        gLs = r.gLs; mbPi = r.pi; mbV = r.v; mbEnt = r.ent;
        // yield so simLoop can tick between minibatches
        await new Promise(res => setTimeout(res, 0));
      }

      actor.adamStep(cfg.lr, 1 / bs);
      critic.adamStep(cfg.lr, 1 / bs);
      lsT++;
      const b1 = 0.9, b2 = 0.999, eps = 1e-8;
      const bc1 = 1 - Math.pow(b1, lsT), bc2 = 1 - Math.pow(b2, lsT);
      for (let d = 0; d < ACT_DIM; d++) {
        const g = gLs[d] / bs;
        lsM[d] = b1 * lsM[d] + (1 - b1) * g;
        lsV[d] = b2 * lsV[d] + (1 - b2) * g * g;
        logStd[d] -= cfg.lr * (lsM[d] / bc1) / (Math.sqrt(lsV[d] / bc2) + eps);
        logStd[d] = Math.max(-2.5, Math.min(0.3, logStd[d]));
      }

      sumPi += mbPi / bs; sumV += mbV / bs; sumEnt += mbEnt / bs; nMB++;
    }
  }

  if (nMB) lastLoss = { pi: sumPi / nMB, v: sumV / nMB, ent: sumEnt / nMB };
  iteration++;
  if (_loadBestPending) { _loadBestPending = false; loadBestSnapshot(); }
  else updateBestSnapshot();
  _ppoRunning = false;
  if (_poolRebuild) { _poolRebuild = false; initGradPool(true); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SAC update rounds — asynchronous, G sequential gradient steps per round.
//
//  GPU path: all G minibatches are sampled up-front (uniform replay sampling
//  does not depend on the weights, so pre-sampling is exact) and shipped in
//  ONE message; the tf worker runs the whole round and returns the weights.
//  CPU path: each step's minibatch is split across the gradient worker pool,
//  Adam + polyak run here between steps. Falls back to local single-thread
//  computation when nested workers are unavailable.
// ─────────────────────────────────────────────────────────────────────────────

// Fill flat batch arrays (Float32 or Float64) with `count` uniformly sampled
// replay transitions starting at row `off`.
function fillSacBatch(obs, act, rew, obs2, done, off, count) {
  for (let k = 0; k < count; k++) {
    const j = Math.floor(Math.random() * rb.size);
    const r = off + k;
    obs.set(rb.obs.subarray(j * OBS_DIM, (j + 1) * OBS_DIM), r * OBS_DIM);
    act.set(rb.act.subarray(j * ACT_DIM, (j + 1) * ACT_DIM), r * ACT_DIM);
    rew[r] = rb.rew[j];
    obs2.set(rb.obs2.subarray(j * OBS_DIM, (j + 1) * OBS_DIM), r * OBS_DIM);
    done[r] = rb.done[j];
  }
}

function polyakInto(tq, q, tau) {
  for (let l = 0; l < q.W.length; l++) {
    const tW = tq.W[l], qW = q.W[l];
    for (let i = 0; i < qW.length; i++) tW[i] += tau * (qW[i] - tW[i]);
    const tb = tq.b[l], qb = q.b[l];
    for (let i = 0; i < qb.length; i++) tb[i] += tau * (qb[i] - tb[i]);
  }
}

function logAlphaAdamStep(g) {
  laT++;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  laM = b1 * laM + (1 - b1) * g;
  laV = b2 * laV + (1 - b2) * g * g;
  logAlpha -= cfg.lr * (laM / (1 - Math.pow(b1, laT))) /
              (Math.sqrt(laV / (1 - Math.pow(b2, laT))) + eps);
  logAlpha = Math.max(-8, Math.min(1, logAlpha));
}

// One CPU gradient step. `myActor` guards against the agent being re-created
// (reset / re-init) while a task is in flight. Returns loss sums or null.
async function sacCpuStep(B, myActor) {
  const obs  = new Float64Array(B * OBS_DIM);
  const act  = new Float64Array(B * ACT_DIM);
  const rew  = new Float64Array(B);
  const obs2 = new Float64Array(B * OBS_DIM);
  const done = new Float64Array(B);
  fillSacBatch(obs, act, rew, obs2, done, 0, B);
  const hp = { gamma: cfg.gamma, targetEntropy: TARGET_ENTROPY };

  let stats;
  const pool = gradPool && gradPool.length ? gradPool : null;
  if (pool) {
    const K = Math.min(pool.length, Math.max(1, Math.floor(B / 64)));
    const per = Math.ceil(B / K);
    const aFlat = actor.flatF64();
    const q1F = q1.flatF64(), q2F = q2.flatF64();
    const t1F = tq1.flatF64(), t2F = tq2.flatF64();
    const tasks = [];
    for (let c = 0; c < K; c++) {
      const s0 = c * per, s1 = Math.min(B, s0 + per);
      if (s0 >= s1) break;
      const slice = {
        n: s1 - s0, obsDim: OBS_DIM, actDim: ACT_DIM,
        obs:  obs.slice(s0 * OBS_DIM, s1 * OBS_DIM),
        act:  act.slice(s0 * ACT_DIM, s1 * ACT_DIM),
        rew:  rew.slice(s0, s1),
        obs2: obs2.slice(s0 * OBS_DIM, s1 * OBS_DIM),
        done: done.slice(s0, s1),
      };
      tasks.push(gradTask(pool[c], {
        type: 'sacGrad',
        force: cfg.backend === 'js' ? 'js' : 'auto',
        actorSizes: actor.sizes, qSizes: q1.sizes,
        actorFlat: aFlat, q1Flat: q1F, q2Flat: q2F, tq1Flat: t1F, tq2Flat: t2F,
        logAlpha, hp, ...slice,
      }, [slice.obs.buffer, slice.act.buffer, slice.rew.buffer, slice.obs2.buffer, slice.done.buffer]));
    }
    let results;
    try {
      results = await Promise.all(tasks);
    } catch {
      // pool died mid-update (e.g. nested workers unsupported) → disable
      for (const x of gradPool) { try { x.terminate(); } catch { /* dead */ } }
      gradPool = [];
      return actor === myActor ? sacCpuStep(B, myActor) : null;
    }
    if (actor !== myActor) return null;
    const aG  = new Float64Array(aFlat.length);
    const q1G = new Float64Array(q1F.length);
    const q2G = new Float64Array(q2F.length);
    stats = { gLa: 0, q: 0, pi: 0, ent: 0, std: 0 };
    for (const r of results) {
      for (let k = 0; k < aG.length; k++) aG[k] += r.aG[k];
      for (let k = 0; k < q1G.length; k++) q1G[k] += r.q1G[k];
      for (let k = 0; k < q2G.length; k++) q2G[k] += r.q2G[k];
      stats.gLa += r.gLa; stats.q += r.q; stats.pi += r.pi;
      stats.ent += r.ent; stats.std += r.std;
      if (r.mode === 'wasm') _wasmOk = true;
    }
    actor.loadGradFlat(aG);
    q1.loadGradFlat(q1G);
    q2.loadGradFlat(q2G);
  } else {
    // ── Local fallback: single-threaded gradient computation ──
    actor.zeroGrad(); q1.zeroGrad(); q2.zeroGrad();
    const noise  = new Float64Array(B * ACT_DIM);
    const noise2 = new Float64Array(B * ACT_DIM);
    for (let i = 0; i < noise.length; i++) { noise[i] = gauss(); noise2[i] = gauss(); }
    stats = accumulateSACGrads(
      { actor, q1, q2, tq1, tq2 },
      { gamma: cfg.gamma, logAlpha, targetEntropy: TARGET_ENTROPY },
      { n: B, obsDim: OBS_DIM, actDim: ACT_DIM, obs, act, rew, obs2, done, noise, noise2 },
    );
    // yield so simLoop can tick between steps
    await new Promise(res => setTimeout(res, 0));
    if (actor !== myActor) return null;
  }

  actor.adamStep(cfg.lr, 1 / B);
  q1.adamStep(cfg.lr, 1 / B);
  q2.adamStep(cfg.lr, 1 / B);
  logAlphaAdamStep(stats.gLa / B);
  polyakInto(tq1, q1, cfg.tau);
  polyakInto(tq2, q2, cfg.tau);
  return stats;
}

async function _runSAC(G) {
  const myActor = actor;
  const B = Math.max(32, cfg.minibatch | 0);
  try {
    if (gpuState === 'ready' && tfWorker) {
      // ── GPU round: G pre-sampled minibatches in one message ──
      const n = G * B;
      const obs  = new Float32Array(n * OBS_DIM);
      const act  = new Float32Array(n * ACT_DIM);
      const rew  = new Float32Array(n);
      const obs2 = new Float32Array(n * OBS_DIM);
      const done = new Float32Array(n);
      fillSacBatch(obs, act, rew, obs2, done, 0, n);
      const r = await new Promise((resolve, reject) => {
        _tfPending = {
          resolve, reject,
          timer: setTimeout(() => {
            _tfPending = null;
            reject(new Error('GPU update timeout (>60s)'));
          }, 60000),
        };
        tfWorker.postMessage(
          { type: 'update', steps: G, batchSize: B, obs, act, rew, obs2, done, lr: cfg.lr },
          [obs.buffer, act.buffer, rew.buffer, obs2.buffer, done.buffer],
        );
      });
      // sanity: never load NaN/Inf weights into the live policy
      let finite = Number.isFinite(r.loss.q) && Number.isFinite(r.loss.pi) &&
                   Number.isFinite(r.logAlpha);
      for (let k = 0; finite && k < r.actorFlat.length; k += 97) {
        finite = Number.isFinite(r.actorFlat[k]);
      }
      if (!finite) throw new Error('non-finite weights returned');
      if (actor === myActor) {
        actor.loadFlat(r.actorFlat);
        q1.loadFlat(r.q1Flat);
        q2.loadFlat(r.q2Flat);
        tq1.loadFlat(r.tq1Flat);
        tq2.loadFlat(r.tq2Flat);
        logAlpha = r.logAlpha;
        lastLoss = { pi: r.loss.pi, v: r.loss.q, ent: r.loss.ent };
        lastSacStats = { alpha: Math.exp(logAlpha), std: r.loss.std };
        iteration += G;
      }
    } else {
      // ── CPU round: sequential steps, pool-parallel within each ──
      let sq = 0, spi = 0, sent = 0, sstd = 0, nS = 0;
      for (let g = 0; g < G && actor === myActor; g++) {
        const s = await sacCpuStep(B, myActor);
        if (!s) break;
        sq += s.q / B; spi += s.pi / B; sent += s.ent / B; sstd += s.std / B;
        nS++;
        iteration++;
      }
      if (nS && actor === myActor) {
        lastLoss = { pi: spi / nS, v: sq / nS, ent: sent / nS };
        lastSacStats = { alpha: Math.exp(logAlpha), std: sstd / nS };
      }
    }
  } catch (err) {
    // GPU round failed — record it and let the CPU path take the next round
    _tfFail(String(err && err.message || err));
  }
  if (actor === myActor) {
    if (_loadBestPending) { _loadBestPending = false; loadBestSnapshot(); }
    else updateBestSnapshot();
  }
  _sacRunning = false;
  if (_poolRebuild && !_ppoRunning) { _poolRebuild = false; initGradPool(true); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Snapshots
// ─────────────────────────────────────────────────────────────────────────────

let vizCounter = 0;

function buildSnapshot() {
  const carData = envs.map(env => ({
    x: env.car.pos.x, y: env.car.pos.y, z: env.car.pos.z,
    hdg: env.car.hdg,
    spd: env.car.spd,
    ret: env.epReturn,
    lap: env.car.lap,
    onGravel: env.car.onGravel,
  }));
  let avgReturn = 0;
  if (recentReturns.length) {
    const tail = recentReturns.slice(-20);
    avgReturn = tail.reduce((s, v) => s + v, 0) / tail.length;
  }
  const sac = isSAC();
  const snap = {
    type: 'frame',
    cars: carData,
    algo: cfg.algo,
    iteration,
    totalSteps,
    bufferFill: sac
      ? (rb ? (rb.size < SAC_WARMUP ? rb.size / SAC_WARMUP : rb.size / rb.cap) : 0)
      : Math.min(1, agentSteps / (cfg.horizon * cfg.numEnvs)),
    phase: sac
      ? (rb && rb.size >= SAC_WARMUP ? 'training' : 'collecting')
      : (_ppoRunning ? 'updating' : 'collecting'),
    gradThreads: gradPool ? gradPool.length : 0,
    backend: gpuState === 'ready'  ? 'gpu'
           : gpuState === 'init'   ? 'gpu-init'
           : gpuState === 'failed' ? 'gpu-failed'
           : (gradPool && gradPool.length && _wasmOk && cfg.backend !== 'js') ? 'wasm'
           : 'js',
    backendInfo: gpuState === 'failed' ? gpuInfo
               : gpuState === 'init'   ? gpuInfo
               : gpuState === 'ready'  ? gpuInfo
               : _wasmErr ? 'WASM unavailable: ' + _wasmErr
               : '',
    avgReturn,
    bestLap: Number.isFinite(bestLap) ? bestLap : null,
    episodes: recentReturns.length,
    loss: lastLoss,
    sigma: sac
      ? (lastSacStats ? [lastSacStats.std, lastSacStats.std] : null)
      : (logStd ? [Math.exp(logStd[0]), Math.exp(logStd[1])] : null),
    alpha: sac ? Math.exp(logAlpha) : null,
    best: best ? { avg: best.avg, iter: best.iter, cur: curAvg } : null,
  };
  // actor weights for the visualiser — heavy, send ~once per second
  if (vizCounter++ % POST_HZ === 0 && actor) {
    snap.actorFlat = actor.flat();
    snap.actorSizes = actor.sizes;
  }
  return snap;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Simulation loop — wall-clock accumulator pacing
// ─────────────────────────────────────────────────────────────────────────────

let _accum = 0;

function simLoop() {
  if (!running || !actor) { tickHandle = null; return; }

  const now = performance.now();
  const elapsed = Math.min(0.25, (now - lastTickMs) / 1000);
  lastTickMs = now;
  _accum += elapsed * Math.max(1, cfg.speedMult);

  let steps = Math.floor(_accum / FIXED_DT);
  const MAX_STEPS_PER_TICK = 2000;
  if (steps > MAX_STEPS_PER_TICK) { steps = MAX_STEPS_PER_TICK; _accum = 0; }
  else _accum -= steps * FIXED_DT;

  for (let s = 0; s < steps; s++) {
    stepOnce(FIXED_DT);
    if (!running) break;
  }

  if (now - lastPostMs >= 1000 / POST_HZ) {
    postMessage(buildSnapshot());
    lastPostMs = now;
  }

  tickHandle = setTimeout(simLoop, 0);
}

function startLoop() {
  if (tickHandle !== null) return;
  lastPostMs = performance.now();
  lastTickMs = performance.now();
  _accum = 0;
  tickHandle = setTimeout(simLoop, 0);
}

function stopLoop() {
  if (tickHandle !== null) { clearTimeout(tickHandle); tickHandle = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Message handler
// ─────────────────────────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const { type } = e.data;

  if (type === 'init') {
    const { track, carData, config, model } = e.data;
    trkPts        = track.pts;
    trkWallLeft   = track.wallLeft;
    trkWallRight  = track.wallRight;
    trkData       = track.data;
    gravelProfile = track.gravelProfile || null;
    cityCorridors = track.cityCorridors || null;
    cityAiPts     = track.cityAiPts || null;
    carSpec       = carData;

    if (config) Object.assign(cfg, config);

    running = false;
    stopLoop();
    initGradPool();
    initSim(model || null);
    initGpu();
    postMessage({
      type: 'ready', obsDim: OBS_DIM, actorSizes: actor.sizes,
      numEnvs: cfg.numEnvs, gradThreads: gradPool ? gradPool.length : 0,
    });
    return;
  }

  if (type === 'start') {
    if (!actor) return;
    running = true;
    startLoop();
    return;
  }

  if (type === 'stop') {
    running = false;
    stopLoop();
    return;
  }

  if (type === 'reset') {
    running = false;
    stopLoop();
    if (!carSpec) return;
    initSim(null);
    sendTfWeights();  // fresh random weights must replace the tf-resident ones
    return;
  }

  if (type === 'setConfig') {
    const prevThreads = desiredThreads();
    Object.assign(cfg, e.data.config);
    if (gradPool !== null && desiredThreads() !== prevThreads) {
      // resize the pool — deferred while an update has tasks in flight
      if (_ppoRunning) _poolRebuild = true;
      else initGradPool(true);
    }
    return;
  }

  if (type === 'getSnapshot') {
    if (actor) postMessage(buildSnapshot());
    return;
  }

  if (type === 'loadBest') {
    if (!best) return;
    if (_ppoRunning || _sacRunning) _loadBestPending = true;  // applied when the update finishes
    else loadBestSnapshot();
    return;
  }

  if (type === 'exportModel') {
    if (!actor) return;
    // Default: export the best-average snapshot when one exists — the live
    // weights may have drifted past their peak. { which: 'current' } forces
    // the live weights.
    const useBest = !!best && e.data.which !== 'current';
    const common = {
      version: 3,
      obsDim: OBS_DIM,
      actDim: ACT_DIM,
      actor: { sizes: actor.sizes, flat: useBest ? Array.from(best.aFlat) : actor.flat() },
      iteration: useBest ? best.iter : iteration,
      totalSteps,
      bestLap: Number.isFinite(bestLap) ? bestLap : null,
      snapshot: useBest ? 'best-average' : 'current',
      avgReturn: useBest ? best.avg : curAvg,
    };
    const model = isSAC()
      ? {
        id: 'ai-trainer-sac',
        name: 'AI Trainer SAC Export',
        algo: 'sac',
        ...common,
        q1:  { sizes: q1.sizes,  flat: useBest ? Array.from(best.q1Flat)  : q1.flat()  },
        q2:  { sizes: q2.sizes,  flat: useBest ? Array.from(best.q2Flat)  : q2.flat()  },
        tq1: { sizes: tq1.sizes, flat: useBest ? Array.from(best.tq1Flat) : tq1.flat() },
        tq2: { sizes: tq2.sizes, flat: useBest ? Array.from(best.tq2Flat) : tq2.flat() },
        logAlpha: useBest ? best.logAlpha : logAlpha,
      }
      : {
        id: 'ai-trainer-ppo',
        name: 'AI Trainer PPO Export',
        algo: 'ppo',
        ...common,
        critic: { sizes: critic.sizes, flat: useBest ? Array.from(best.cFlat) : critic.flat() },
        logStd: Array.from(useBest ? best.logStd : logStd),
      };
    postMessage({ type: 'modelExport', model });
    return;
  }
};
