'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  AI Trainer — Simulation Worker (PPO)
//
//  Runs entirely off the main thread. No DOM, no Three.js.
//  Implements Proximal Policy Optimization with:
//    · actor-critic MLPs (tanh hidden, linear output) with manual backprop
//    · Adam optimizer
//    · GAE(λ) advantage estimation
//    · clipped surrogate objective + entropy bonus
//    · N parallel environments sharing one policy
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
  // PPO hyperparameters
  lr: 3e-4,
  gamma: 0.99,
  lam: 0.95,
  clip: 0.2,
  entropyCoef: 0.003,
  vfCoef: 0.5,
  horizon: 512,          // agent steps per env per update (restart required)
  epochs: 6,
  minibatch: 256,
  hiddenSize: 64,        // restart required
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

function wrapPi(a) { return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; }

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

// Continuous arc position (metres along centerline) of a world point.
function arcPosition(px, pz) {
  const n = navPts.length;
  let md = Infinity, ni = 0;
  for (let i = 0; i < n; i++) {
    const d = (px - navPts[i].x) ** 2 + (pz - navPts[i].z) ** 2;
    if (d < md) { md = d; ni = i; }
  }
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
  }

  reset(pos, hdg) {
    this.pos.x = pos.x; this.pos.y = pos.y; this.pos.z = pos.z;
    this.hdg = hdg; this.spd = 0;
    this.isReversing = false; this.revSpd = 0; this.reverseTimer = 0;
    this.onGravel = false; this.stuckTimer = 0;
    this.lap = 0; this.lapTimes = [];
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

    this.pos.y = this._groundY();
    this.boundary(dt);
    this.checkGravel();
  }

  _groundY() {
    if (!trkPts.length) return 0;
    let md = Infinity, ny = 0;
    for (const p of trkPts) {
      const d = (this.pos.x - p.x) ** 2 + (this.pos.z - p.z) ** 2;
      if (d < md) { md = d; ny = p.y; }
    }
    return ny;
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

    let md = Infinity, ni = 0;
    for (let i = 0; i < trkPts.length; i++) {
      const d = (this.pos.x - trkPts[i].x) ** 2 + (this.pos.z - trkPts[i].z) ** 2;
      if (d < md) { md = d; ni = i; }
    }
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
    let md = Infinity, ni = 0;
    for (let i = 0; i < n; i++) {
      const d = (this.pos.x - pts[i].x) ** 2 + (this.pos.z - pts[i].z) ** 2;
      if (d < md) { md = d; ni = i; }
    }
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
      const cx = (w.x0 + w.x1) * 0.5 - ox, cz = (w.z0 + w.z1) * 0.5 - oz;
      if (cx * cx + cz * cz < rr) near.push(w);
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
const PROBE_DISTS = [10, 20, 35, 55, 80, 120];
const SLOPE_NORM  = 0.30;   // |Δy/Δs| considered "max steep"

// Observation layout:
//  [0..10]  11 track-edge rays (sqrt-normalised, like the original AI)
//  [11..17] 7 short wall rays
//  [18] speed fraction      [19] heading error to dynamic look-ahead waypoint
//  [20] edge proximity      [21] on-gravel flag
//  [22] reversing flag      [23] slope at the car
//  [24..35] 6 probes × (relative angle, slope between probes)
const OBS_DIM = 24 + PROBE_DISTS.length * 2;

function buildObs(car, out) {
  castRayFan(car, RAY_ANGLES, RAY_DIST, out, 0);
  for (let k = 0; k < RAY_ANGLES.length; k++) out[k] = Math.sqrt(out[k]);
  castRayFan(car, EDGE_RAY_ANGLES, EDGE_RAY_DIST, out, 11);

  const ap = arcPosition(car.pos.x, car.pos.z);
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
  return ap; // caller reuses arc position for reward
}

// ─────────────────────────────────────────────────────────────────────────────
//  Neural network with manual backprop + Adam
// ─────────────────────────────────────────────────────────────────────────────

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class Net {
  // sizes e.g. [36, 64, 2]; tanh hidden layers, linear output.
  constructor(sizes, finalScale = 1) {
    this.sizes = sizes;
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      const lim = Math.sqrt(6 / (nIn + nOut)) * (l === sizes.length - 2 ? finalScale : 1);
      const W = new Float64Array(nOut * nIn);
      for (let k = 0; k < W.length; k++) W[k] = (Math.random() * 2 - 1) * lim;
      this.W.push(W);
      this.b.push(new Float64Array(nOut));
    }
    this.gW = this.W.map(w => new Float64Array(w.length));
    this.gb = this.b.map(b => new Float64Array(b.length));
    this.mW = this.W.map(w => new Float64Array(w.length));
    this.vW = this.W.map(w => new Float64Array(w.length));
    this.mb = this.b.map(b => new Float64Array(b.length));
    this.vb = this.b.map(b => new Float64Array(b.length));
    this.t  = 0;
  }

  forward(x, cache = null) {
    let a = x;
    if (cache) cache.acts = [x];
    for (let l = 0; l < this.W.length; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const W = this.W[l], b = this.b[l];
      const out = new Float64Array(nOut);
      const isLast = l === this.W.length - 1;
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        const off = j * nIn;
        for (let i = 0; i < nIn; i++) s += W[off + i] * a[i];
        out[j] = isLast ? s : Math.tanh(s);
      }
      a = out;
      if (cache) cache.acts.push(out);
    }
    return a;
  }

  // Accumulates gradients; dOut = dLoss/dOutput for the cached forward pass.
  backward(cache, dOut) {
    let delta = dOut;
    for (let l = this.W.length - 1; l >= 0; l--) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const aIn = cache.acts[l];
      const W = this.W[l], gW = this.gW[l], gb = this.gb[l];
      const dPrev = l > 0 ? new Float64Array(nIn) : null;
      for (let j = 0; j < nOut; j++) {
        const d = delta[j];
        if (d === 0) continue;
        gb[j] += d;
        const off = j * nIn;
        for (let i = 0; i < nIn; i++) {
          gW[off + i] += d * aIn[i];
          if (dPrev) dPrev[i] += d * W[off + i];
        }
      }
      if (dPrev) {
        for (let i = 0; i < nIn; i++) dPrev[i] *= (1 - aIn[i] * aIn[i]);
        delta = dPrev;
      }
    }
  }

  zeroGrad() {
    for (const g of this.gW) g.fill(0);
    for (const g of this.gb) g.fill(0);
  }

  adamStep(lr, scale) {
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const bc1 = 1 - Math.pow(b1, this.t), bc2 = 1 - Math.pow(b2, this.t);
    const upd = (P, G, M, V) => {
      for (let k = 0; k < P.length; k++) {
        const g = G[k] * scale;
        M[k] = b1 * M[k] + (1 - b1) * g;
        V[k] = b2 * V[k] + (1 - b2) * g * g;
        P[k] -= lr * (M[k] / bc1) / (Math.sqrt(V[k] / bc2) + eps);
      }
    };
    for (let l = 0; l < this.W.length; l++) {
      upd(this.W[l], this.gW[l], this.mW[l], this.vW[l]);
      upd(this.b[l], this.gb[l], this.mb[l], this.vb[l]);
    }
  }

  flat() {
    const out = [];
    for (let l = 0; l < this.W.length; l++) {
      for (const w of this.W[l]) out.push(w);
      for (const b of this.b[l]) out.push(b);
    }
    return out;
  }

  loadFlat(arr) {
    let k = 0;
    for (let l = 0; l < this.W.length; l++) {
      for (let i = 0; i < this.W[l].length; i++) this.W[l][i] = arr[k++];
      for (let i = 0; i < this.b[l].length; i++) this.b[l][i] = arr[k++];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PPO agent
// ─────────────────────────────────────────────────────────────────────────────

const ACT_DIM = 2;          // [steer, throttle/brake]
const LOG_2PI = Math.log(2 * Math.PI);

let actor  = null;          // Net [OBS_DIM, h, ACT_DIM] → action means
let critic = null;          // Net [OBS_DIM, h, 1] → state value
let logStd = null;          // Float64Array(ACT_DIM), learnable
let lsM = null, lsV = null; // Adam moments for logStd
let lsT = 0;

function initAgent(modelOverride) {
  const h = cfg.hiddenSize;
  actor  = new Net([OBS_DIM, h, ACT_DIM], 0.01); // small final layer → near-zero initial actions
  critic = new Net([OBS_DIM, h, 1], 1);
  logStd = new Float64Array(ACT_DIM).fill(-0.5);
  lsM = new Float64Array(ACT_DIM);
  lsV = new Float64Array(ACT_DIM);
  lsT = 0;
  if (modelOverride && modelOverride.algo === 'ppo') {
    try {
      actor  = new Net(modelOverride.actor.sizes, 1);
      actor.loadFlat(modelOverride.actor.flat);
      critic = new Net(modelOverride.critic.sizes, 1);
      critic.loadFlat(modelOverride.critic.flat);
      logStd = Float64Array.from(modelOverride.logStd);
      lsM = new Float64Array(ACT_DIM);
      lsV = new Float64Array(ACT_DIM);
      lsT = 0;
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

// ─────────────────────────────────────────────────────────────────────────────
//  Environments
// ─────────────────────────────────────────────────────────────────────────────

let envs = [];              // per-env state
let iteration   = 0;        // PPO update count
let totalSteps  = 0;        // total physics steps across envs
let agentSteps  = 0;        // transitions collected since last update
let recentReturns = [];     // last completed episode returns
let bestLap = Infinity;
let lastLoss = { pi: 0, v: 0, ent: 0 };

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
    prevS: arcPosition(car.pos.x, car.pos.z).s,
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
  env.prevS = arcPosition(env.car.pos.x, env.car.pos.z).s;
  env.lapAcc = 0; env.lapTime = 0;
  env.epTime = 0; env.epReturn = 0;
  env.offTrackTime = 0; env.noProgTime = 0; env.prevStuck = 0;
  env.repCount = 0;
  env.pendObs = null; env.rewAcc = 0;
}

function initSim(modelOverride) {
  buildArcTable();
  initAgent(modelOverride || null);
  envs = Array.from({ length: cfg.numEnvs }, (_, i) => makeEnv(i));
  iteration = 0; totalSteps = 0; agentSteps = 0;
  recentReturns = []; bestLap = Infinity;
  simTime = 0;
  lastLoss = { pi: 0, v: 0, ent: 0 };
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
  if (truncated && env.pendObs) {
    // bootstrap the value of the post-step state so truncation isn't
    // mistaken for a real terminal
    const obs = new Float64Array(OBS_DIM);
    buildObs(env.car, obs);
    env.rewAcc += cfg.gamma * critic.forward(obs)[0];
  }
  commitTransition(env, true);
  recentReturns.push(env.epReturn);
  if (recentReturns.length > 50) recentReturns.shift();
  resetEnv(env, i);
}

// One physics tick for every env (dt = FIXED_DT).
function stepOnce(dt) {
  simTime += dt;
  for (let i = 0; i < envs.length; i++) {
    const env = envs[i];
    const car = env.car;

    // ── New agent decision at the start of each repeat window ──
    if (env.repCount <= 0) {
      commitTransition(env, false); // finalize previous window (non-terminal)
      const obs = new Float64Array(OBS_DIM);
      buildObs(car, obs);
      const mean = actor.forward(obs);
      for (let d = 0; d < ACT_DIM; d++) {
        env.curAct[d] = mean[d] + Math.exp(logStd[d]) * gauss();
      }
      env.pendObs  = obs;
      env.pendLogp = logProb(env.curAct, mean);
      env.pendVal  = critic.forward(obs)[0];
      env.repCount = cfg.actionRepeat;
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
    const ap = arcPosition(car.pos.x, car.pos.z);
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

  // ── PPO update when enough transitions are collected ──
  if (agentSteps >= cfg.horizon * cfg.numEnvs) {
    ppoUpdate();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PPO update — GAE + clipped surrogate, minibatch Adam
// ─────────────────────────────────────────────────────────────────────────────

function ppoUpdate() {
  // Flush any open repeat windows so chains end cleanly, and force a fresh
  // decision on the next tick (the flushed action's window is over)
  for (const env of envs) { commitTransition(env, false); env.repCount = 0; }

  // Gather all transitions; compute GAE per env chain
  const OBS = [], ACT = [], LOGP = [], ADV = [], RET = [];
  for (const env of envs) {
    const b = env.buf, T = b.obs.length;
    if (!T) continue;
    // bootstrap with the value of the env's current state unless terminal
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
  agentSteps = 0;
  const N = OBS.length;
  if (N < 8) return;

  // Normalize advantages
  let mean = 0; for (const a of ADV) mean += a; mean /= N;
  let varr = 0; for (const a of ADV) varr += (a - mean) ** 2;
  const std = Math.sqrt(varr / N) + 1e-8;
  for (let k = 0; k < N; k++) ADV[k] = (ADV[k] - mean) / std;

  const idx = Array.from({ length: N }, (_, k) => k);
  let sumPi = 0, sumV = 0, sumEnt = 0, nMB = 0;

  for (let ep = 0; ep < cfg.epochs; ep++) {
    // Fisher-Yates shuffle
    for (let k = N - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      const tmp = idx[k]; idx[k] = idx[j]; idx[j] = tmp;
    }
    for (let start = 0; start < N; start += cfg.minibatch) {
      const end = Math.min(N, start + cfg.minibatch);
      const bs = end - start;
      actor.zeroGrad(); critic.zeroGrad();
      const gLs = new Float64Array(ACT_DIM);
      let mbPi = 0, mbV = 0, mbEnt = 0;

      for (let k = start; k < end; k++) {
        const s = idx[k];
        const obs = OBS[s], act = ACT[s], A = ADV[s], ret = RET[s];

        // ── Actor ──
        const aCache = {};
        const mu = actor.forward(obs, aCache);
        let lp = 0;
        for (let d = 0; d < ACT_DIM; d++) {
          const sd = Math.exp(logStd[d]);
          const z = (act[d] - mu[d]) / sd;
          lp += -0.5 * z * z - logStd[d] - 0.5 * LOG_2PI;
        }
        const ratio = Math.exp(Math.min(20, lp - LOGP[s]));
        const clipped = Math.max(1 - cfg.clip, Math.min(1 + cfg.clip, ratio));
        const surr1 = ratio * A, surr2 = clipped * A;
        mbPi += -Math.min(surr1, surr2);
        // gradient flows only through the unclipped branch when it's the min
        const coef = surr1 <= surr2 ? -A * ratio : 0;
        if (coef !== 0) {
          const dMu = new Float64Array(ACT_DIM);
          for (let d = 0; d < ACT_DIM; d++) {
            const sd2 = Math.exp(2 * logStd[d]);
            dMu[d] = coef * (act[d] - mu[d]) / sd2;
            gLs[d] += coef * (((act[d] - mu[d]) ** 2) / sd2 - 1);
          }
          actor.backward(aCache, dMu);
        }
        // entropy bonus: H = Σ(logσ + ½log(2πe)) → dH/dlogσ = 1
        for (let d = 0; d < ACT_DIM; d++) {
          gLs[d] += -cfg.entropyCoef;
          mbEnt += logStd[d] + 0.5 * (LOG_2PI + 1);
        }

        // ── Critic ──
        const cCache = {};
        const v = critic.forward(obs, cCache)[0];
        const dv = cfg.vfCoef * (v - ret);
        mbV += 0.5 * (v - ret) ** 2;
        critic.backward(cCache, Float64Array.of(dv));
      }

      actor.adamStep(cfg.lr, 1 / bs);
      critic.adamStep(cfg.lr, 1 / bs);
      // Adam step for logStd
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
  const snap = {
    type: 'frame',
    cars: carData,
    iteration,
    totalSteps,
    bufferFill: Math.min(1, agentSteps / (cfg.horizon * cfg.numEnvs)),
    avgReturn,
    bestLap: Number.isFinite(bestLap) ? bestLap : null,
    episodes: recentReturns.length,
    loss: lastLoss,
    sigma: logStd ? [Math.exp(logStd[0]), Math.exp(logStd[1])] : null,
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
    initSim(model || null);
    postMessage({ type: 'ready', obsDim: OBS_DIM, hiddenSize: actor.sizes[1], numEnvs: cfg.numEnvs });
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
    return;
  }

  if (type === 'setConfig') {
    Object.assign(cfg, e.data.config);
    return;
  }

  if (type === 'getSnapshot') {
    if (actor) postMessage(buildSnapshot());
    return;
  }

  if (type === 'exportModel') {
    if (!actor) return;
    postMessage({
      type: 'modelExport',
      model: {
        id: 'ai-trainer-ppo',
        name: 'AI Trainer PPO Export',
        version: 2,
        algo: 'ppo',
        obsDim: OBS_DIM,
        actor:  { sizes: actor.sizes,  flat: actor.flat()  },
        critic: { sizes: critic.sizes, flat: critic.flat() },
        logStd: Array.from(logStd),
        iteration,
        totalSteps,
        bestLap: Number.isFinite(bestLap) ? bestLap : null,
      },
    });
    return;
  }
};
