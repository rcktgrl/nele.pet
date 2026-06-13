'use strict';

import { Net, gauss, LOG_2PI, accumulatePPOGrads } from './nn-core.js';

// ─────────────────────────────────────────────────────────────────────────────
//  AI Trainer — Simulation Worker (PPO + optional mods)
//
//  Runs entirely off the main thread. No DOM, no Three.js.
//  Implements Proximal Policy Optimization with:
//    · actor-critic MLPs (tanh hidden, linear output) with manual backprop
//    · Adam optimizer
//    · GAE(λ) advantage estimation
//    · clipped surrogate objective + entropy bonus
//    · N parallel environments sharing one policy
//
//  Optional PPO mods (cfg flags, see each section):
//    · groupSize    — GRPO-style agent groups: members spawn together, the
//                     advantage is each member's return relative to the group
//                     average (no critic / GAE needed)
//    · mirror       — left↔right symmetry augmentation: every transition is
//                     also trained mirrored, doubling data per physics step
//    · klStop       — stop update epochs early once the policy has moved a
//                     KL-threshold away from the data (saves wasted epochs)
//    · neuronRepair — periodically recycle dead hidden neurons and split
//                     dominant ones into a useless slot (function-preserving)
//    · failRate     — fraction of actor weights that are "defect" (zeroed)
//                     for each agent's own acting copy during collection;
//                     the real network trains unmasked
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
  hiddenLayers: 1,       // restart required
  backend: 'auto',       // 'auto' | 'gpu' | 'wasm' | 'js' — restart required
  threads: 0,            // gradient worker count, 0 = auto (cores − 2, max 6)
  // PPO mods
  groupSize: 1,          // >1: GRPO-style agent groups (restart required)
  mirror: false,         // left↔right symmetry augmentation (live)
  klStop: true,          // KL-based early stop of update epochs (live)
  klLimit: 0.025,        // KL movement allowed per update before stopping
  neuronRepair: false,   // periodic dead-neuron recycle + dominant split (live)
  failRate: 0,           // fraction of "defect" actor weights per agent (live)
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

// ─────────────────────────────────────────────────────────────────────────────
//  Wall spatial index — uniform grid over packed segment arrays. The wall
//  set is static per track, but the previous code scanned EVERY segment on
//  every physics tick (boundary nearest-wall) and every decision (ray fans),
//  which dominated the whole simulation on dense tracks. The grid turns both
//  into local queries.
// ─────────────────────────────────────────────────────────────────────────────

const WALL_CELL = 16;      // metres per grid cell

let wallIdx = { left: null, right: null, all: null };

function packWallSide(walls) {
  const n = walls ? walls.length : 0;
  const segs = new Float64Array(n * 4);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const w = walls[i];
    segs[i * 4] = w.x0; segs[i * 4 + 1] = w.z0;
    segs[i * 4 + 2] = w.x1; segs[i * 4 + 3] = w.z1;
    minX = Math.min(minX, w.x0, w.x1); maxX = Math.max(maxX, w.x0, w.x1);
    minZ = Math.min(minZ, w.z0, w.z1); maxZ = Math.max(maxZ, w.z0, w.z1);
  }
  if (!n) return { n, segs, minX: 0, minZ: 0, gw: 1, gh: 1, cells: [null], scratch: new Int32Array(0), stamp: new Int32Array(0), gen: 0, span: 0 };
  const gw = Math.max(1, Math.ceil((maxX - minX) / WALL_CELL) + 1);
  const gh = Math.max(1, Math.ceil((maxZ - minZ) / WALL_CELL) + 1);
  const cells = new Array(gw * gh).fill(null);
  for (let i = 0; i < n; i++) {
    // insert into every cell the segment's bbox overlaps — exact superset
    // guarantee for circle queries regardless of segment length
    const cx0 = ((Math.min(segs[i * 4], segs[i * 4 + 2]) - minX) / WALL_CELL) | 0;
    const cx1 = ((Math.max(segs[i * 4], segs[i * 4 + 2]) - minX) / WALL_CELL) | 0;
    const cz0 = ((Math.min(segs[i * 4 + 1], segs[i * 4 + 3]) - minZ) / WALL_CELL) | 0;
    const cz1 = ((Math.max(segs[i * 4 + 1], segs[i * 4 + 3]) - minZ) / WALL_CELL) | 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * gw + cx;
        (cells[c] || (cells[c] = [])).push(i);
      }
    }
  }
  return {
    n, segs, minX, minZ, gw, gh, cells,
    scratch: new Int32Array(n),   // query result buffer (segment indices)
    stamp: new Int32Array(n),     // dedupe marker, compared against gen
    gen: 0,
    span: Math.max(gw, gh) * WALL_CELL,  // radius that covers the whole grid
  };
}

function buildWallIndex() {
  wallIdx = {
    left: packWallSide(trkWallLeft),
    right: packWallSide(trkWallRight),
    // combined index for the ray fans — rays don't care about sides
    all: packWallSide([...(trkWallLeft || []), ...(trkWallRight || [])]),
  };
}

// First wall hit along a ray — Amanatides–Woo grid marching. Each ray only
// visits the cells it passes through and stops as soon as no closer hit is
// possible, instead of testing every wall segment on the track (the previous
// behavior whenever the fan radius covered the whole track).
function rayThroughGrid(g, ox, oz, dx, dz, maxT) {
  if (!g || !g.n) return maxT;
  const cs = WALL_CELL;
  const gx0 = g.minX, gz0 = g.minZ;
  const gx1 = gx0 + g.gw * cs, gz1 = gz0 + g.gh * cs;
  // clip the ray to the grid bbox
  let t0 = 0, t1 = maxT;
  if (dx !== 0) {
    const ta = (gx0 - ox) / dx, tb = (gx1 - ox) / dx;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  } else if (ox < gx0 || ox > gx1) return maxT;
  if (dz !== 0) {
    const ta = (gz0 - oz) / dz, tb = (gz1 - oz) / dz;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  } else if (oz < gz0 || oz > gz1) return maxT;
  if (t0 > t1) return maxT;

  // entry cell (nudged inside the bbox)
  const ex = ox + dx * (t0 + 1e-9), ez = oz + dz * (t0 + 1e-9);
  let cx = ((ex - gx0) / cs) | 0, cz = ((ez - gz0) / cs) | 0;
  if (cx < 0) cx = 0; else if (cx >= g.gw) cx = g.gw - 1;
  if (cz < 0) cz = 0; else if (cz >= g.gh) cz = g.gh - 1;
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  let tMaxX = dx !== 0 ? ((gx0 + (cx + (dx > 0 ? 1 : 0)) * cs) - ox) / dx : Infinity;
  let tMaxZ = dz !== 0 ? ((gz0 + (cz + (dz > 0 ? 1 : 0)) * cs) - oz) / dz : Infinity;
  const tDx = dx !== 0 ? cs / Math.abs(dx) : Infinity;
  const tDz = dz !== 0 ? cs / Math.abs(dz) : Infinity;

  const { cells, segs, stamp, gw, gh } = g;
  const gen = ++g.gen;
  let bestT = maxT;
  for (;;) {
    const cell = cells[cz * gw + cx];
    if (cell) {
      for (let k = 0; k < cell.length; k++) {
        const i = cell[k];
        if (stamp[i] === gen) continue;
        stamp[i] = gen;
        const t = raySegment(ox, oz, dx, dz,
                             segs[i * 4], segs[i * 4 + 1], segs[i * 4 + 2], segs[i * 4 + 3]);
        if (t > 0 && t < bestT) bestT = t;
      }
    }
    // a hit at t < tNext would lie in an already-visited cell (segments are
    // registered in every cell their bbox overlaps), so stopping is exact
    const tNext = Math.min(tMaxX, tMaxZ);
    if (tNext > bestT || tNext > t1) break;
    if (tMaxX < tMaxZ) { tMaxX += tDx; cx += stepX; if (cx < 0 || cx >= gw) break; }
    else               { tMaxZ += tDz; cz += stepZ; if (cz < 0 || cz >= gh) break; }
  }
  return bestT;
}

// Collect unique segment indices whose cells overlap the circle bbox.
function gatherWallSegs(side, px, pz, r) {
  const { minX, minZ, gw, gh, cells, scratch, stamp } = side;
  const gen = ++side.gen;
  let cx0 = ((px - r - minX) / WALL_CELL) | 0;
  let cx1 = ((px + r - minX) / WALL_CELL) | 0;
  let cz0 = ((pz - r - minZ) / WALL_CELL) | 0;
  let cz1 = ((pz + r - minZ) / WALL_CELL) | 0;
  if (cx1 < 0 || cz1 < 0 || cx0 >= gw || cz0 >= gh) return 0;
  if (cx0 < 0) cx0 = 0; if (cz0 < 0) cz0 = 0;
  if (cx1 >= gw) cx1 = gw - 1; if (cz1 >= gh) cz1 = gh - 1;
  let cnt = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cell = cells[cz * gw + cx];
      if (!cell) continue;
      for (let k = 0; k < cell.length; k++) {
        const i = cell[k];
        if (stamp[i] !== gen) { stamp[i] = gen; scratch[cnt++] = i; }
      }
    }
  }
  return cnt;
}

// Nearest point on any wall segment of one side. Expanding-radius search:
// a candidate found at distance d is only accepted once d ≤ search radius
// (nothing outside the gathered cells can be closer), so the result is
// EXACTLY the global nearest — the old full scan, minus the full scan.
function nearestWallPoint(px, pz, side) {
  if (!side || !side.n) return null;
  const segs = side.segs;
  // cars sit within a road half-width of a wall almost always — one cell
  // usually suffices, and the radius-acceptance rule keeps expansion exact
  for (let r = WALL_CELL; ; r *= 4) {
    const all = r >= side.span;
    const m = all ? side.n : gatherWallSegs(side, px, pz, r);
    let bestI = -1, bestT = 0, bestD2 = Infinity;
    for (let k = 0; k < m; k++) {
      const i = all ? k : side.scratch[k];
      const ax = segs[i * 4], az = segs[i * 4 + 1];
      const abx = segs[i * 4 + 2] - ax, abz = segs[i * 4 + 3] - az;
      const ab2 = abx * abx + abz * abz || 1;
      let t = ((px - ax) * abx + (pz - az) * abz) / ab2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestI = i; bestT = t; }
    }
    if (bestI >= 0 && (all || bestD2 <= r * r)) {
      return {
        x: segs[bestI * 4] + (segs[bestI * 4 + 2] - segs[bestI * 4]) * bestT,
        z: segs[bestI * 4 + 1] + (segs[bestI * 4 + 3] - segs[bestI * 4 + 1]) * bestT,
      };
    }
    if (all) return null;  // unreachable while side.n > 0 — kept for safety
  }
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
    const wallPt = nearestWallPoint(this.pos.x, this.pos.z,
                                    sideSign > 0 ? wallIdx.right : wallIdx.left);

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

export function castRayFan(car, angles, maxDist, out, offset) {
  const ox = car.pos.x, oz = car.pos.z;
  for (let k = 0; k < angles.length; k++) {
    const angle = car.hdg + angles[k];
    out[offset + k] = rayThroughGrid(wallIdx.all, ox, oz,
                                     Math.sin(angle), Math.cos(angle), maxDist) / maxDist;
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
//  Mirror augmentation (cfg.mirror) — the track problem is left↔right
//  symmetric, so every real transition has an equally valid mirror twin:
//  reflect the observation, negate the steering. Trained alongside the
//  original it doubles the data per physics step and bakes the symmetry
//  into the policy instead of waiting for it to be learned twice.
//
//  Index map (must match the buildObs layout above):
//    0..10   long rays    — symmetric fan → reverse
//    11..17  edge rays    — symmetric fan → reverse
//    18 speed · 20 |centerline dist| · 21 gravel · 22 reversing · 23 slope — keep
//    19      heading error — negate
//    24+2k   probe angle   — negate;  25+2k probe slope — keep
//    36..39  memory cells  — keep (no spatial meaning; their actions are
//            kept too, so the mirrored pair stays self-consistent)
// ─────────────────────────────────────────────────────────────────────────────

export function mirrorObsInto(src, dst) {
  for (let k = 0; k <= 10; k++) dst[k] = src[10 - k];
  for (let k = 11; k <= 17; k++) dst[k] = src[28 - k];
  dst[18] = src[18];
  dst[19] = -src[19];
  dst[20] = src[20];
  dst[21] = src[21];
  dst[22] = src[22];
  dst[23] = src[23];
  for (let p = 0; p < PROBE_DISTS.length; p++) {
    dst[24 + 2 * p] = -src[24 + 2 * p];
    dst[25 + 2 * p] = src[25 + 2 * p];
  }
  for (let d = 0; d < MEM_DIM; d++) dst[MEM_OBS + d] = src[MEM_OBS + d];
  return dst;
}

export function mirrorActInto(src, dst) {
  dst[0] = -src[0];                                   // steer flips
  for (let d = 1; d < ACT_DIM; d++) dst[d] = src[d];  // throttle + memory keep
  return dst;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PPO agent
// ─────────────────────────────────────────────────────────────────────────────

const ACT_DIM = 2 + MEM_DIM; // [steer, throttle/brake, 4 memory-cell deltas]

let actor  = null;          // Net [OBS_DIM, h, ACT_DIM] → action means
let critic = null;          // Net [OBS_DIM, h, 1] → state value
let logStd = null;          // Float64Array(ACT_DIM), learnable
let lsM = null, lsV = null; // Adam moments for logStd
let lsT = 0;

function initAgent(modelOverride) {
  const h = cfg.hiddenSize, nl = Math.max(1, cfg.hiddenLayers | 0);
  const actSizes  = [OBS_DIM, ...Array(nl).fill(h), ACT_DIM];
  const critSizes = [OBS_DIM, ...Array(nl).fill(h), 1];
  actor  = new Net(actSizes,  0.01);
  critic = new Net(critSizes, 1);
  logStd = new Float64Array(ACT_DIM).fill(-0.5);
  lsM = new Float64Array(ACT_DIM);
  lsV = new Float64Array(ACT_DIM);
  lsT = 0;
  if (modelOverride && modelOverride.algo === 'ppo') {
    try {
      const mSizes = modelOverride.actor.sizes;
      if (modelOverride.obsDim !== OBS_DIM || mSizes[mSizes.length - 1] !== ACT_DIM) {
        throw new Error(`incompatible model: expects obs ${modelOverride.obsDim}/act ${mSizes[mSizes.length - 1]}, ` +
                        `current layout is obs ${OBS_DIM}/act ${ACT_DIM} (memory cells added)`);
      }
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
//  Weight-failure mode (cfg.failRate) — each agent acts through its own copy
//  of the actor in which a random fraction of weights is "defect" (zeroed).
//  The defects last for the agent's current episode; the REAL network is
//  trained unmasked (PPO's importance ratio absorbs the behavior mismatch,
//  since the stored log-prob comes from the masked acting copy). Forces the
//  policy not to rely on any single connection — like dropout, but in the
//  world instead of the optimizer.
// ─────────────────────────────────────────────────────────────────────────────

function rollFailMask(env) {
  const P = actor.paramCount();
  if (!env.failMask || env.failMask.length !== P) env.failMask = new Uint8Array(P);
  else env.failMask.fill(0);
  const p = Math.min(0.5, cfg.failRate);
  for (let k = 0; k < P; k++) if (Math.random() < p) env.failMask[k] = 1;
  applyFailMask(env);
}

// (Re)build the agent's acting copy from the CURRENT weights + its mask.
function applyFailMask(env) {
  const flat = actor.flatF64();
  for (let k = 0; k < flat.length; k++) if (env.failMask[k]) flat[k] = 0;
  if (!env.actNet || env.actNet.paramCount() !== flat.length) env.actNet = new Net(actor.sizes, 1);
  env.actNet.loadFlat(flat);
}

// Weights changed (update / repair / restore) → defect copies must follow.
function refreshFailNets() {
  for (const env of envs) {
    if (cfg.failRate > 0 && env.failMask) applyFailMask(env);
    else env.actNet = null;
  }
}

// The policy network an env ACTS with (true actor unless failure mode is on).
function actingNet(env) {
  if (cfg.failRate > 0) {
    if (!env.actNet) rollFailMask(env);
    return env.actNet;
  }
  return actor;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Neuron repair (cfg.neuronRepair) — every REPAIR_EVERY updates:
//   1. Score each hidden neuron by influence = std(activation) × ‖W_out‖₁,
//      measured over a reservoir of recently seen observations.
//   2. DEAD neurons (≈ no influence — constant output or unused downstream)
//      are recycled ReDo-style: fresh random incoming weights, outgoing
//      zeroed. Output is unchanged, but gradient can regrow the slot.
//   3. The most OVERTUNED neuron (influence ≫ layer mean) is split into the
//      most useless slot: the clone gets the same incoming weights and both
//      get half the outgoing weights — the summed output is identical, so
//      nothing breaks, but the dominant feature gains redundancy and its
//      per-neuron gradient pressure halves. Stabilizes top-heavy networks.
// ─────────────────────────────────────────────────────────────────────────────

const REPAIR_EVERY   = 10;    // updates between repair passes
const REPAIR_RES_CAP = 256;   // observation reservoir size
const DEAD_FRAC      = 0.05;  // dead if influence < 5 % of the layer mean
const OVER_FRAC      = 3.0;   // overtuned if influence > 3× the layer mean
const RECYCLE_CAP    = 0.25;  // recycle at most a quarter of a layer per pass

let repairObs   = [];         // reservoir of Float64Array observations
let repairSeen  = 0;          // total observations offered to the reservoir
let repairStats = { recycled: 0, splits: 0 };
let _repairPending = false;   // requested while an update was in flight

function reservoirOffer(obs) {
  repairSeen++;
  if (repairObs.length < REPAIR_RES_CAP) {
    repairObs.push(Float64Array.from(obs));
  } else if (Math.random() < REPAIR_RES_CAP / repairSeen) {
    repairObs[(Math.random() * REPAIR_RES_CAP) | 0] = Float64Array.from(obs);
  }
}

function repairPass() {
  if (repairObs.length < 32) return;  // not enough data to judge neurons

  // activation statistics per hidden layer over the reservoir
  const L = actor.W.length;            // weight-layer count; hidden layers L−1
  const sums = [], sqs = [];
  for (let l = 0; l < L - 1; l++) {
    sums.push(new Float64Array(actor.sizes[l + 1]));
    sqs.push(new Float64Array(actor.sizes[l + 1]));
  }
  const cache = {};
  for (const o of repairObs) {
    actor.forward(o, cache);
    for (let l = 0; l < L - 1; l++) {
      const a = cache.acts[l + 1];
      for (let j = 0; j < a.length; j++) { sums[l][j] += a[j]; sqs[l][j] += a[j] * a[j]; }
    }
  }

  for (let l = 0; l < L - 1; l++) {
    const nH = actor.sizes[l + 1];           // neurons in this hidden layer
    const nIn = actor.sizes[l], nOut = actor.sizes[l + 2];
    const Win = actor.W[l], bIn = actor.b[l], Wout = actor.W[l + 1];

    const score = new Float64Array(nH);
    let mean = 0;
    for (let j = 0; j < nH; j++) {
      const m = sums[l][j] / repairObs.length;
      const v = Math.max(0, sqs[l][j] / repairObs.length - m * m);
      let outNorm = 0;
      for (let o = 0; o < nOut; o++) outNorm += Math.abs(Wout[o * nH + j]);
      score[j] = Math.sqrt(v) * outNorm;
      mean += score[j] / nH;
    }
    if (!(mean > 0)) continue;  // layer entirely silent — nothing to rank

    const zeroAdam = j => {
      for (let i = 0; i < nIn; i++) {
        actor.mW[l][j * nIn + i] = 0; actor.vW[l][j * nIn + i] = 0;
      }
      actor.mb[l][j] = 0; actor.vb[l][j] = 0;
      for (let o = 0; o < nOut; o++) {
        actor.mW[l + 1][o * nH + j] = 0; actor.vW[l + 1][o * nH + j] = 0;
      }
    };

    // ── recycle dead neurons ──
    const lim = Math.sqrt(6 / (nIn + nH));
    let recycled = 0;
    for (let j = 0; j < nH && recycled < Math.max(1, nH * RECYCLE_CAP); j++) {
      if (score[j] >= mean * DEAD_FRAC) continue;
      for (let i = 0; i < nIn; i++) Win[j * nIn + i] = (Math.random() * 2 - 1) * lim;
      bIn[j] = 0;
      for (let o = 0; o < nOut; o++) Wout[o * nH + j] = 0;
      zeroAdam(j);
      score[j] = mean;  // freshly recycled — don't pick it as the split target
      recycled++;
      repairStats.recycled++;
    }

    // ── split the most overtuned neuron into the most useless slot ──
    let jMax = 0, jMin = 0;
    for (let j = 1; j < nH; j++) {
      if (score[j] > score[jMax]) jMax = j;
      if (score[j] < score[jMin]) jMin = j;
    }
    if (jMax !== jMin && score[jMax] > mean * OVER_FRAC && score[jMin] < mean) {
      for (let i = 0; i < nIn; i++) {
        // tiny jitter so the twins don't stay numerically identical forever
        Win[jMin * nIn + i] = Win[jMax * nIn + i] * (1 + (Math.random() * 2 - 1) * 0.01);
      }
      bIn[jMin] = bIn[jMax];
      for (let o = 0; o < nOut; o++) {
        const half = Wout[o * nH + jMax] * 0.5;
        Wout[o * nH + jMax] = half;
        Wout[o * nH + jMin] = half;
      }
      zeroAdam(jMax);
      zeroAdam(jMin);
      repairStats.splits++;
    }
  }

  refreshFailNets();   // acting copies must see the repaired weights
  sendTfWeights();     // keep the GPU backend's resident weights in sync
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
let lastEpochs = 0;         // epochs the last update actually ran (KL stop)
let lastKl = 0;             // KL movement of the last update

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
    // mirror twin of the pending transition (cfg.mirror)
    pendObsM: null, pendActM: null, pendLogpM: 0, pendValM: 0,
    // per-env rollout chains (M = mirrored twin; shares rew/done values)
    buf:  { obs: [], act: [], logp: [], val: [], rew: [], done: [] },
    bufM: { obs: [], act: [], logp: [], val: [], rew: [], done: [] },
    // weight-failure mode
    failMask: null, actNet: null,
    // agent groups
    gDone: false, gFit: 0,
  };
}

function clearChains(env) {
  for (const b of [env.buf, env.bufM]) {
    b.obs.length = 0; b.act.length = 0; b.logp.length = 0;
    b.val.length = 0; b.rew.length = 0; b.done.length = 0;
  }
}

function resetEnv(env, i, pose = null) {
  const sp = pose || spawnPose(i);
  env.car.reset(sp.pos, sp.hdg);
  env.prevS = carArc(env.car).s;
  env.lapAcc = 0; env.lapTime = 0;
  env.epTime = 0; env.epReturn = 0;
  env.offTrackTime = 0; env.noProgTime = 0; env.prevStuck = 0;
  env.repCount = 0;
  env.pendObs = null; env.pendObsM = null; env.rewAcc = 0;
  env.gDone = false; env.gFit = 0;
  // fresh episode → fresh defects
  if (cfg.failRate > 0) rollFailMask(env);
  else env.actNet = null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agent groups (cfg.groupSize > 1) — GRPO-style baseline. Every group of G
//  agents spawns at the SAME pose and runs the same shared policy with
//  independent noise. When the whole group has finished, each member's
//  advantage is its episode return relative to the group: the group average
//  IS the baseline, so no critic / GAE is involved. Finished members park
//  until the slowest one is done.
// ─────────────────────────────────────────────────────────────────────────────

const groupOn = () => (cfg.groupSize | 0) > 1;

// Episode-complete transitions waiting for the next group-mode update.
let readyBatch = { OBS: [], ACT: [], LOGP: [], ADV: [], RET: [] };

function groupMembers(g) {
  const G = cfg.groupSize | 0;
  return envs.slice(g * G, Math.min(envs.length, (g + 1) * G));
}

function respawnGroup(g) {
  const members = groupMembers(g);
  if (!members.length) return;
  const pose = spawnPose(g * (cfg.groupSize | 0));
  for (let m = 0; m < members.length; m++) {
    resetEnv(members[m], 0, pose);
    clearChains(members[m]);
  }
}

// All members done → group-relative advantages → ready buffer → respawn.
function finalizeGroup(g) {
  const members = groupMembers(g);
  const n = members.length;
  let mean = 0;
  for (const m of members) mean += m.gFit / n;
  let varr = 0;
  for (const m of members) varr += (m.gFit - mean) ** 2;
  const std = Math.sqrt(varr / n) + 1e-6;
  for (const m of members) {
    const adv = (m.gFit - mean) / std;
    for (const b of [m.buf, m.bufM]) {
      for (let t = 0; t < b.obs.length; t++) {
        readyBatch.OBS.push(b.obs[t]);
        readyBatch.ACT.push(b.act[t]);
        readyBatch.LOGP.push(b.logp[t]);
        readyBatch.ADV.push(adv);
        readyBatch.RET.push(m.gFit);  // unused for learning (vfCoef forced 0)
      }
    }
  }
  respawnGroup(g);
}

// Node test harness access — nearest-wall queries against the spatial index.
export function nearestWallForTest(px, pz, sideName) {
  return nearestWallPoint(px, pz, wallIdx[sideName]);
}

function initSim(modelOverride) {
  buildArcTable();
  buildWallIndex();
  initAgent(modelOverride || null);
  envs = Array.from({ length: cfg.numEnvs }, (_, i) => makeEnv(i));
  iteration = 0; totalSteps = 0; agentSteps = 0;
  recentReturns = []; bestLap = Infinity;
  simTime = 0;
  lastLoss = { pi: 0, v: 0, ent: 0 };
  best = null; curAvg = null; _loadBestPending = false;
  readyBatch = { OBS: [], ACT: [], LOGP: [], ADV: [], RET: [] };
  repairObs = []; repairSeen = 0;
  repairStats = { recycled: 0, splits: 0 };
  _repairPending = false;
  lastEpochs = 0; lastKl = 0;
  if (groupOn()) {
    const nGroups = Math.ceil(envs.length / (cfg.groupSize | 0));
    for (let g = 0; g < nGroups; g++) respawnGroup(g);
  } else if (cfg.failRate > 0) {
    for (const env of envs) rollFailMask(env);
  }
}

// Finalize the pending transition of an env into its rollout chain.
// extra / extraM: bootstrap value added to this transition's reward only
// (the mirrored twin bootstraps from the mirrored terminal observation).
function commitTransition(env, done, extra = 0, extraM = 0) {
  if (!env.pendObs) return;
  env.buf.obs.push(env.pendObs);
  env.buf.act.push(Float64Array.from(env.curAct));
  env.buf.logp.push(env.pendLogp);
  env.buf.val.push(env.pendVal);
  env.buf.rew.push(env.rewAcc + extra);
  env.buf.done.push(done ? 1 : 0);
  if (env.pendObsM) {
    env.bufM.obs.push(env.pendObsM);
    env.bufM.act.push(env.pendActM);
    env.bufM.logp.push(env.pendLogpM);
    env.bufM.val.push(env.pendValM);
    env.bufM.rew.push(env.rewAcc + extraM);
    env.bufM.done.push(done ? 1 : 0);
  }
  env.pendObs = null;
  env.pendObsM = null;
  env.rewAcc = 0;
  agentSteps++;
}

function terminateEnv(env, i, penalty, truncated) {
  // per-tick rewards are already in epReturn; only the penalty/bootstrap
  // terms are added to the stored transition reward here
  if (penalty) env.rewAcc -= penalty;
  let boot = 0, bootM = 0;
  if (truncated && env.pendObs && !groupOn()) {
    // bootstrap the value of the post-step state so truncation isn't
    // mistaken for a real terminal (groups skip this — no critic there)
    const obs = new Float64Array(OBS_DIM);
    buildObs(env.car, obs);
    boot = cfg.gamma * critic.forwardScratch(obs)[0];
    if (env.pendObsM) {
      const obsM = mirrorObsInto(obs, new Float64Array(OBS_DIM));
      bootM = cfg.gamma * critic.forwardScratch(obsM)[0];
    }
  }
  commitTransition(env, true, boot, bootM);
  recentReturns.push(env.epReturn);
  if (recentReturns.length > 50) recentReturns.shift();
  if (groupOn()) {
    // park; the group respawns together once its last member finishes
    env.gFit = env.epReturn;
    env.gDone = true;
    const g = (i / (cfg.groupSize | 0)) | 0;
    if (groupMembers(g).every(m => m.gDone)) finalizeGroup(g);
    return;
  }
  resetEnv(env, i);
}

// One physics tick for every env (dt = FIXED_DT).
function stepOnce(dt) {
  // Back-pressure: if an update is in flight and the next batch is already
  // twice the horizon, pause collection so batches can't grow without bound
  // at high speed multipliers.
  if (_ppoRunning && agentSteps >= cfg.horizon * cfg.numEnvs * 2) return;

  simTime += dt;
  for (let i = 0; i < envs.length; i++) {
    const env = envs[i];
    if (env.gDone) continue;  // parked until its group's last member finishes
    const car = env.car;

    // ── New agent decision at the start of each repeat window ──
    if (env.repCount <= 0) {
      commitTransition(env, false); // finalize previous window (non-terminal)
      const obs = new Float64Array(OBS_DIM);
      buildObs(car, obs);
      const pol = actingNet(env);   // true actor, or the defect-masked copy
      const mean = pol.forwardScratch(obs);
      for (let d = 0; d < ACT_DIM; d++) {
        env.curAct[d] = mean[d] + Math.exp(logStd[d]) * gauss();
      }
      env.pendObs  = obs;
      env.pendLogp = logProb(env.curAct, mean);
      env.pendVal  = groupOn() ? 0 : critic.forwardScratch(obs)[0];
      if (cfg.mirror) {
        // synthetic twin: mirrored observation + mirrored action, with its
        // own behavior log-prob/value so PPO's ratio and GAE stay exact
        // (forwardScratch reuses pol's buffer — `mean` is consumed above)
        const obsM = mirrorObsInto(obs, new Float64Array(OBS_DIM));
        const actM = mirrorActInto(env.curAct, new Float64Array(ACT_DIM));
        env.pendObsM  = obsM;
        env.pendActM  = actM;
        env.pendLogpM = logProb(actM, pol.forwardScratch(obsM));
        env.pendValM  = groupOn() ? 0 : critic.forwardScratch(obsM)[0];
      }
      if (cfg.neuronRepair && (totalSteps & 31) === 0) reservoirOffer(obs);
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

  // ── Trigger async PPO update when the rollout buffer is full ──
  if (groupOn()) {
    // group mode: only whole finished groups are trainable
    if (readyBatch.OBS.length >= cfg.horizon * cfg.numEnvs && !_ppoRunning) {
      _ppoRunning = true;
      const batch = { ...readyBatch, N: readyBatch.OBS.length, grouped: true };
      readyBatch = { OBS: [], ACT: [], LOGP: [], ADV: [], RET: [] };
      agentSteps = 0;
      _runPPO(batch);
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
  tfWorker.postMessage({
    type: 'setWeights',
    actorFlat:  Float32Array.from(actor.flatF64()),
    criticFlat: Float32Array.from(critic.flatF64()),
    logStd:     Float32Array.from(logStd),
  });
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
    tfWorker.postMessage({
      type: 'init',
      actorSizes: actor.sizes, criticSizes: critic.sizes,
      actorFlat:  Float32Array.from(actor.flatF64()),
      criticFlat: Float32Array.from(critic.flatF64()),
      logStd:     Float32Array.from(logStd),
      lr: cfg.lr,
    });
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

  // GAE over one rollout chain; nextVal bootstraps an unfinished tail.
  const flushChain = (b, nextVal) => {
    const T = b.obs.length;
    if (!T) return;
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
  };

  for (const env of envs) {
    let nextVal = 0, nextValM = 0;
    const open = env.buf.obs.length && !env.buf.done[env.buf.obs.length - 1];
    if (open) {
      const obs = new Float64Array(OBS_DIM);
      buildObs(env.car, obs);
      nextVal = critic.forwardScratch(obs)[0];
      if (env.bufM.obs.length) {
        const obsM = mirrorObsInto(obs, new Float64Array(OBS_DIM));
        nextValM = critic.forwardScratch(obsM)[0];
      }
    }
    flushChain(env.buf, nextVal);
    flushChain(env.bufM, nextValM);
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

// ─────────────────────────────────────────────────────────────────────────────
//  Best-network snapshot (by average return across all agents)
// ─────────────────────────────────────────────────────────────────────────────

function updateBestSnapshot() {
  const tail = recentReturns.slice(-BEST_WINDOW);
  if (tail.length < BEST_MIN_EPS) { curAvg = null; return; }
  let avg = 0; for (const r of tail) avg += r; avg /= tail.length;
  curAvg = avg;
  if (!best || avg > best.avg) {
    best = {
      aFlat: actor.flatF64(), cFlat: critic.flatF64(),
      logStd: Float64Array.from(logStd),
      avg, iter: iteration,
    };
  }
}

// Restore the best snapshot. Only call between PPO updates (weights must not
// change while gradient tasks are in flight).
function loadBestSnapshot() {
  if (!best) return;
  actor.loadFlat(best.aFlat);
  critic.loadFlat(best.cFlat);
  logStd.set(best.logStd);
  actor.resetAdam();
  critic.resetAdam();
  lsM.fill(0); lsV.fill(0); lsT = 0;
  // Re-open exploration a little: the abandoned direction was a dead end, so
  // the restored policy needs noise to find a DIFFERENT improvement.
  for (let d = 0; d < ACT_DIM; d++) logStd[d] = Math.min(0.3, logStd[d] + 0.25);
  // Drop rollouts and episode stats gathered under the abandoned policy —
  // stale transitions would train the restored weights toward it again.
  for (const env of envs) {
    clearChains(env);
    env.pendObs = null; env.pendObsM = null; env.rewAcc = 0; env.repCount = 0;
  }
  readyBatch = { OBS: [], ACT: [], LOGP: [], ADV: [], RET: [] };
  agentSteps = 0;
  recentReturns = [];
  curAvg = null;
  sendTfWeights();  // keep the GPU backend's resident weights in sync
  refreshFailNets();  // defect copies must act with the restored weights
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
  const hp = {
    clip: cfg.clip, entropyCoef: cfg.entropyCoef,
    // group mode has no critic to train — advantages came from the group
    vfCoef: batch.grouped ? 0 : cfg.vfCoef,
    klStop: !!cfg.klStop, klLimit: cfg.klLimit,
  };
  let sumPi = 0, sumV = 0, sumEnt = 0, nMB = 0;
  let gpuDone = false;

  // KL movement estimate (k3, always ≥ 0) of the live actor vs the stored
  // behavior log-probs, on a fixed subsample. Used to stop epochs early once
  // the policy has drifted klLimit past where it started this update.
  const klSample = Math.min(512, N);
  const klEstimate = () => {
    let kl = 0;
    for (let t = 0; t < klSample; t++) {
      const s = ((t * 2654435761) >>> 0) % N;  // fixed quasi-random subsample
      const d = Math.min(20, logProb(ACT[s], actor.forwardScratch(OBS[s])) - LOGP[s]);
      kl += (Math.exp(d) - 1) - d;
    }
    return kl / klSample;
  };
  const kl0 = cfg.klStop ? klEstimate() : 0;
  let epochsRan = 0;

  // ── GPU path: the COMPLETE update (all epochs, shuffling, Adam) runs on the
  //    TF.js worker; the new weights come back in one message ────────────────
  if (gpuState === 'ready' && tfWorker) {
    try {
      // Truncate to a whole number of minibatches. Constant tensor shapes
      // are what lets the WebGL backend REUSE its textures — per-update
      // shape jitter made every update allocate fresh GPU memory instead.
      const mbs = Math.max(8, cfg.minibatch | 0);
      const nGpu = N >= mbs ? (N / mbs | 0) * mbs : N;
      const obs  = new Float32Array(nGpu * OBS_DIM);
      const act  = new Float32Array(nGpu * ACT_DIM);
      const logp = new Float32Array(nGpu);
      const adv  = new Float32Array(nGpu);
      const ret  = new Float32Array(nGpu);
      for (let k = 0; k < nGpu; k++) {
        obs.set(OBS[k], k * OBS_DIM);
        act.set(ACT[k], k * ACT_DIM);
        logp[k] = LOGP[k]; adv[k] = ADV[k]; ret[k] = RET[k];
      }
      const r = await new Promise((resolve, reject) => {
        _tfPending = {
          resolve, reject,
          timer: setTimeout(() => {
            _tfPending = null;
            reject(new Error('GPU update timeout (>60s)'));
          }, 60000),
        };
        tfWorker.postMessage({
          type: 'update', n: nGpu, obs, act, logp, adv, ret,
          hp: { ...hp, lr: cfg.lr },
          epochs: cfg.epochs, minibatch: mbs,
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
      lastEpochs = r.epochs || cfg.epochs;
      lastKl = r.kl || 0;
      if (r.mem) {
        // live VRAM telemetry — a leak shows up here long before the OS chokes
        gpuInfo = `TF.js GPU active · ${r.mem.numTensors} tensors · ` +
                  `${(r.mem.numBytesInGPU / 1048576).toFixed(0)} MB GPU` +
                  ` (${r.epochs}/${cfg.epochs} epochs, ${r.ms | 0} ms)`;
      }
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

    epochsRan = ep + 1;
    if (cfg.klStop) {
      const kl = klEstimate() - kl0;
      lastKl = kl;
      if (kl > cfg.klLimit) break;  // policy moved far enough — extra epochs
                                    // would only overfit this batch
    }
  }
  if (!gpuDone) lastEpochs = epochsRan;

  if (nMB) lastLoss = { pi: sumPi / nMB, v: sumV / nMB, ent: sumEnt / nMB };
  iteration++;
  if (_loadBestPending) { _loadBestPending = false; loadBestSnapshot(); }
  else updateBestSnapshot();
  if (_repairPending || (cfg.neuronRepair && iteration % REPAIR_EVERY === 0)) {
    _repairPending = false;
    repairPass();
  }
  if (cfg.failRate > 0) refreshFailNets();  // defect copies track new weights
  _ppoRunning = false;
  if (_poolRebuild) { _poolRebuild = false; initGradPool(true); }
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
    bufferFill: Math.min(1, (groupOn() ? readyBatch.OBS.length : agentSteps) /
                            (cfg.horizon * cfg.numEnvs)),
    phase: _ppoRunning ? 'updating' : 'collecting',
    // PPO-mod status for the HUD
    mods: {
      groupSize: cfg.groupSize | 0,
      mirror: !!cfg.mirror,
      klStop: !!cfg.klStop,
      epochs: lastEpochs,
      epochsMax: cfg.epochs,
      kl: lastKl,
      repair: cfg.neuronRepair ? { ...repairStats } : null,
      masked: cfg.failRate > 0 ? envs.filter(e => e.actNet).length : 0,
    },
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
    sigma: logStd ? [Math.exp(logStd[0]), Math.exp(logStd[1])] : null,
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
    const prevFail = cfg.failRate;
    Object.assign(cfg, e.data.config);
    if (gradPool !== null && desiredThreads() !== prevThreads) {
      // resize the pool — deferred while an update has tasks in flight
      if (_ppoRunning) _poolRebuild = true;
      else initGradPool(true);
    }
    // failure rate flipped — apply to the live agents right away
    if (cfg.failRate > 0 && prevFail === 0 && envs.length) {
      for (const env of envs) rollFailMask(env);
    } else if (cfg.failRate === 0 && prevFail > 0) {
      for (const env of envs) env.actNet = null;
    }
    return;
  }

  if (type === 'repairNow') {
    // manual repair pass; deferred while gradient tasks hold the weights
    if (_ppoRunning) _repairPending = true;
    else repairPass();
    return;
  }

  if (type === 'getSnapshot') {
    if (actor) postMessage(buildSnapshot());
    return;
  }

  if (type === 'loadBest') {
    if (!best) return;
    if (_ppoRunning) _loadBestPending = true;  // applied when the update finishes
    else loadBestSnapshot();
    return;
  }

  if (type === 'exportModel') {
    if (!actor) return;
    // Default: export the best-average snapshot when one exists — the live
    // weights may have drifted past their peak. { which: 'current' } forces
    // the live weights.
    const useBest = !!best && e.data.which !== 'current';
    postMessage({
      type: 'modelExport',
      model: {
        id: 'ai-trainer-ppo',
        name: 'AI Trainer PPO Export',
        version: 3,
        algo: 'ppo',
        obsDim: OBS_DIM,
        actDim: ACT_DIM,
        actor:  { sizes: actor.sizes,  flat: useBest ? Array.from(best.aFlat) : actor.flat()  },
        critic: { sizes: critic.sizes, flat: useBest ? Array.from(best.cFlat) : critic.flat() },
        logStd: Array.from(useBest ? best.logStd : logStd),
        iteration: useBest ? best.iter : iteration,
        totalSteps,
        bestLap: Number.isFinite(bestLap) ? bestLap : null,
        snapshot: useBest ? 'best-average' : 'current',
        avgReturn: useBest ? best.avg : curAvg,
      },
    });
    return;
  }
};
