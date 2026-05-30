'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  AI Trainer — Simulation Worker
//
//  Runs entirely off the main thread. No DOM, no Three.js.
//  Receives track data and config via postMessage, runs physics + neural AI +
//  genetic training at full CPU speed, and posts frame snapshots back.
// ─────────────────────────────────────────────────────────────────────────────

// ── Track state (populated on 'init') ────────────────────────────────────────
let trkPts       = [];   // [{x,y,z}] spaced centerline points
let trkWallLeft  = [];   // [{x0,z0,x1,z1}] left barrier segments
let trkWallRight = [];   // [{x0,z0,x1,z1}] right barrier segments
let trkData      = null; // {wp:[[x,0,z],...], rw, laps}
let gravelProfile = null;// {pts, leftRunoff, rightRunoff, rw}

// ── Simulation config (live-updateable) ──────────────────────────────────────
let cfg = {
  popSize: 8,
  genDuration: 35,
  speedMult: 1,
  mutRate: 0.15,
  mutStrength: 0.35,
  onTrackRewardRate: 0.10,
  stuckPenaltyRate: 5.0,
  gravelPenaltyBase: 0.5,
  gravelGrowthRate: 0.30,
  offTrackMult: 10,
  offTrackDQTime: 3.0,
  dqPenalty: 200,
  hiddenLayers: 1,
  nodesPerLayer: 5,
  eliteCloneMode: false,
  singleCarMode: false,
  lapMode: false,
};

// ── Runtime state ─────────────────────────────────────────────────────────────
let running = false;
let cars    = [];
let ais     = [];
let trainer = null;
let simTime = 0;
let lastTickMs = 0;

const FIXED_DT = 1 / 60;
const POST_HZ  = 30;          // send frame snapshot at most this often
let lastPostMs = 0;
let tickHandle = null;

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

// ─────────────────────────────────────────────────────────────────────────────
//  Pure-physics car (no Three.js, no mesh)
// ─────────────────────────────────────────────────────────────────────────────

class SimCar {
  constructor(carData, pos, hdg) {
    this.data = carData;                          // {accel,maxSpd,brake,hdl,aiSpd}
    this.pos  = { x: pos.x, y: pos.y, z: pos.z };
    this.hdg  = hdg;
    this.spd  = 0;
    this.gear = 1;
    this.isReversing  = false;
    this.revSpd       = 0;
    this.reverseTimer = 0;
    this.onGravel     = false;
    this.stuckTimer   = 0;
    this.aiAgg        = 1.0;

    // Race progress
    this.lap       = 0;
    this.lastCP    = 0;
    this.cpPassed  = 0;
    this.totalProg = 0;
    this.finished  = false;
    this.lapStart  = 0;
    this.lapTimes  = [];

    // Training fitness
    this._fitPenalty   = 0;
    this._onTrackTime  = 0;
    this._offTrackTime = 0;
    this._gravelTime   = 0;
    this._offTrack     = false;
    this._fitness      = 0;
    this._lapCompleted = false;
    this._lapTime      = 0;
    this._trainPrevStuck = 0;
    this._peakRawProg  = 0;
  }

  reset(pos, hdg) {
    this.pos.x = pos.x; this.pos.y = pos.y; this.pos.z = pos.z;
    this.hdg = hdg; this.spd = 0; this.gear = 1;
    this.isReversing = false; this.revSpd = 0; this.reverseTimer = 0;
    this.onGravel = false; this.stuckTimer = 0;
    this.lap = 0; this.lastCP = 0; this.cpPassed = 0;
    this.totalProg = 0; this.finished = false; this.lapStart = 0; this.lapTimes = [];
    this._fitPenalty = 0; this._onTrackTime = 0; this._offTrackTime = 0;
    this._gravelTime = 0; this._offTrack = false; this._fitness = 0;
    this._lapCompleted = false; this._lapTime = 0; this._trainPrevStuck = 0;
    this._peakRawProg = 0;
  }

  update(inp, dt) {
    if (this.finished) return;
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
    this.progress();
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
        const wrapPi  = a => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
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
      const wrapPi = a => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
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

  progress() {
    if (!trkData) return;
    const wps = trkData.wp, n = wps.length;
    for (let i = 0; i < n; i++) {
      const w    = wps[i];
      const prev = wps[(i - 1 + n) % n], next = wps[(i + 1) % n];
      const tx   = next[0] - prev[0], tz = next[2] - prev[2];
      const tl   = Math.sqrt(tx * tx + tz * tz) || 1;
      const dx   = this.pos.x - w[0], dz = this.pos.z - w[2];
      const longDist = Math.abs(dx * (tx / tl) + dz * (tz / tl));
      if (longDist < 12 && i !== this.lastCP) {
        const exp = (this.lastCP + 1 + n) % n;
        if (i === exp) {
          this.lastCP = i; this.cpPassed++;
          if (i === 0 && this.cpPassed >= n) {
            this.cpPassed = 0; this.lap++;
            const lt = simTime - this.lapStart; this.lapStart = simTime;
            this.lapTimes.push(lt);
            if (this.lap >= (trkData.laps || 3)) {
              this.finished = true; this.finTime = simTime;
              if (cfg.lapMode) { this._lapCompleted = true; this._lapTime = lt; }
            }
          }
        }
      }
    }
    const ni  = (this.lastCP + 1 + n) % n;
    const nw  = wps[ni], pw = wps[this.lastCP];
    const sx  = nw[0] - pw[0], sz = nw[2] - pw[2];
    const seg2 = sx * sx + sz * sz || 1;
    const cx  = this.pos.x - pw[0], cz = this.pos.z - pw[2];
    const t   = Math.max(0, Math.min(1, (cx * sx + cz * sz) / seg2));
    this.totalProg = this.lap * n + this.cpPassed + t;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Neural AI (adapted from neural-ai.js — no state global, receives track data
//  via closure over module-level variables)
// ─────────────────────────────────────────────────────────────────────────────

const RAY_ANGLES = [
  -Math.PI / 2, -Math.PI / 3, -Math.PI / 6,
  -Math.PI / 18, -Math.PI / 36,
  0,
  Math.PI / 36, Math.PI / 18,
  Math.PI / 6, Math.PI / 3, Math.PI / 2,
];
const RAY_DIST  = 200;
const EDGE_RAY_ANGLES = [
  -Math.PI / 2, -Math.PI / 4, -Math.PI / 18,
  0,
  Math.PI / 18, Math.PI / 4, Math.PI / 2,
];
const EDGE_RAY_DIST = 35;

function castRays(car) {
  const ox = car.pos.x, oz = car.pos.z;
  const rr = RAY_DIST * RAY_DIST * 1.5;
  const near = [];
  for (const segs of [trkWallLeft, trkWallRight]) {
    for (const w of segs) {
      const cx = (w.x0 + w.x1) * 0.5 - ox, cz = (w.z0 + w.z1) * 0.5 - oz;
      if (cx * cx + cz * cz < rr) near.push(w);
    }
  }
  return RAY_ANGLES.map(a => {
    const angle = car.hdg + a;
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let minT = RAY_DIST;
    for (const w of near) {
      const t = raySegment(ox, oz, dx, dz, w.x0, w.z0, w.x1, w.z1);
      if (t > 0 && t < minT) minT = t;
    }
    return Math.sqrt(minT / RAY_DIST);
  });
}

function castEdgeRays(car) {
  const ox = car.pos.x, oz = car.pos.z;
  const rr = EDGE_RAY_DIST * EDGE_RAY_DIST * 1.5;
  const near = [];
  for (const segs of [trkWallLeft, trkWallRight]) {
    for (const e of segs) {
      const cx = (e.x0 + e.x1) * 0.5 - ox, cz = (e.z0 + e.z1) * 0.5 - oz;
      if (cx * cx + cz * cz < rr) near.push(e);
    }
  }
  return EDGE_RAY_ANGLES.map(a => {
    const angle = car.hdg + a;
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let minT = EDGE_RAY_DIST;
    for (const e of near) {
      const t = raySegment(ox, oz, dx, dz, e.x0, e.z0, e.x1, e.z1);
      if (t > 0 && t < minT) minT = t;
    }
    return minT / EDGE_RAY_DIST;
  });
}

function nnForward(inputs, weights) {
  let x = inputs;
  for (let l = 0; l < weights.length - 1; l++) {
    const { W, b } = weights[l];
    x = W.map((row, i) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], 0) + b[i]));
  }
  const last = weights[weights.length - 1];
  return last.W.map((row, i) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], 0) + last.b[i]));
}

function unpackGenome(g, layers) {
  const weights = [];
  let idx = 0;
  for (let l = 0; l < layers.length - 1; l++) {
    const rows = layers[l + 1], cols = layers[l];
    const W = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => g[idx++])
    );
    const b = Array.from({ length: rows }, () => g[idx++]);
    weights.push({ W, b });
  }
  return weights;
}

class SimNeuralAI {
  constructor(car, layers, genome) {
    this.car = car;
    this.layers = layers;
    this.weights = unpackGenome(genome, layers);
    this.slowTimer  = 0;
    this.prevPos    = null;
    this.stuckCount = 0;
    this.revMode    = 'none';
    this.revTimer   = 0;
    this.revSteer   = 0;
    this._graceTimer = 0;
  }

  setGenome(genome) {
    this.weights = unpackGenome(genome, this.layers);
    this.slowTimer = 0; this.prevPos = null; this.stuckCount = 0;
    this.revMode = 'none'; this.revTimer = 0; this._graceTimer = 0;
  }

  update(dt) {
    if (!trkPts.length || this.car.finished) return;
    const c = this.car;

    // Stuck detection
    this._graceTimer += dt;
    if (!this.prevPos) this.prevPos = { x: c.pos.x, z: c.pos.z };
    const moved = Math.sqrt((c.pos.x - this.prevPos.x) ** 2 + (c.pos.z - this.prevPos.z) ** 2);
    this.prevPos.x = c.pos.x; this.prevPos.z = c.pos.z;
    if (this._graceTimer > 3 && moved < 0.015 * dt * 60) this.slowTimer += dt;
    else { this.slowTimer = Math.max(0, this.slowTimer - dt * 3); if (this.revMode === 'none') this.stuckCount = 0; }

    if (this.revMode === 'braking') {
      this.revTimer += dt;
      c.update({ thr: 0, brk: 1, str: 0 }, dt);
      if (c.spd < 0.15 || this.revTimer > 0.8) { this.revMode = 'reversing'; this.revTimer = 0; }
      return;
    }
    if (this.revMode === 'reversing') {
      this.revTimer += dt;
      c.update({ thr: 0, brk: 0.9, str: this.revSteer }, dt);
      if (this.revTimer > 1.8) { this.revMode = 'none'; this.slowTimer = 0; this.stuckCount++; }
      return;
    }
    if (this.slowTimer > 1.5 && this.revMode === 'none') {
      this.revMode = 'braking'; this.revTimer = 0;
      this.revSteer = (Math.random() > 0.5 ? 1 : -1) * 0.9;
      c.stuckTimer = 0;
      return;
    }

    // Waypoint navigation
    let md = Infinity, ci = 0;
    for (let i = 0; i < trkPts.length; i++) {
      const d = (c.pos.x - trkPts[i].x) ** 2 + (c.pos.z - trkPts[i].z) ** 2;
      if (d < md) { md = d; ci = i; }
    }
    const n = trkPts.length;
    const speedFrac = c.spd / c.data.maxSpd;
    const look = Math.round(6 + speedFrac * 22);
    const ti   = (ci + look) % n;
    const dh   = Math.atan2(trkPts[ti].x - c.pos.x, trkPts[ti].z - c.pos.z);
    const he   = ((dh - c.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

    const sensors     = castRays(c);
    const edgeSensors = castEdgeRays(c);
    const halfW    = trkData ? trkData.rw * 0.5 : 999;
    const edgeProx = Math.min(1, Math.sqrt(md) / Math.max(1, halfW));
    const gravelFlag = c.onGravel ? 1.0 : 0.0;
    const extra6   = [
      speedFrac,
      Math.max(-1, Math.min(1, he / Math.PI)),
      edgeProx,
      gravelFlag,
      c.data.hdl,
      Math.min(1, c.data.accel / 12),
    ];

    let inputs;
    if (this.layers[0] >= 24) {
      inputs = [...sensors, ...edgeSensors, ...extra6];          // 24
    } else if (this.layers[0] >= 17) {
      inputs = [...sensors, ...extra6];                          // 17
    } else if (this.layers[0] >= 13) {
      inputs = [...sensors.slice(1, 10), speedFrac, Math.max(-1, Math.min(1, he / Math.PI)), edgeProx, gravelFlag]; // 13
    } else {
      inputs = [...sensors.slice(1, 10), speedFrac, Math.max(-1, Math.min(1, he / Math.PI))]; // 11
    }

    const out      = nnForward(inputs, this.weights);
    const nnSteer  = out[0], thrMod = out[1];
    const nnBrake  = thrMod < 0 ? -thrMod : 0;
    let str = Math.max(-1, Math.min(1, nnSteer));
    let thr = thrMod > 0 ? thrMod : 0;
    let brk = nnBrake;
    thr *= 0.85 + thrMod * 0.25;
    if (c.onGravel) thr = Math.min(thr, 0.7);
    thr *= c.data.aiSpd * c.aiAgg * 1.15;
    thr = Math.min(1, Math.max(0, thr));
    c.update({ thr, brk: Math.min(1, brk), str }, dt);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Genome utilities
// ─────────────────────────────────────────────────────────────────────────────

function computeGenomeSize(layers) {
  let s = 0;
  for (let i = 0; i < layers.length - 1; i++) s += layers[i + 1] * (layers[i] + 1);
  return s;
}

function xavierGenome(layers) {
  const genome = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const nIn = layers[l], nOut = layers[l + 1];
    const std = Math.sqrt(2 / (nIn + nOut)) * 3;
    for (let j = 0; j < nOut * nIn; j++) genome.push((Math.random() * 2 - 1) * std);
    for (let j = 0; j < nOut; j++) genome.push(0);
  }
  return genome;
}

// Hand-designed seed for [24,5,2]
const SEED_GENOME_24_5_2 = [
  -2.0,-2.5,-3.0,-2.0,-1.0,-0.5, 0.0, 0.3, 0.5, 0.3, 0.0,-1.0,-1.5,-0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8, 0.5, 0.0, 0.0,
   0.0, 0.3, 0.5, 0.0, 0.3,-0.5,-1.0,-2.0,-3.0,-2.5,-2.0, 0.0, 0.0, 0.0, 0.0,-0.5,-1.5,-1.0, 0.0, 0.0, 0.8, 0.5, 0.0, 0.0,
   0.0, 0.0,-0.5,-1.0,-2.0,-3.0,-2.0,-1.0,-0.5, 0.0, 0.0,-0.3,-0.8,-1.5,-3.0,-1.5,-0.8,-0.3, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0,
   0.8, 0.8, 0.8, 0.6, 0.5, 1.5, 0.5, 0.6, 0.8, 0.8, 0.8, 0.5, 0.8, 0.8, 1.0, 0.8, 0.8, 0.5, 1.5, 0.0,-1.5,-1.0, 0.0, 0.0,
   0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0,
  2.0, 2.0, 2.0,-6.0, 0.0,
   1.2,-1.2, 0.0, 0.0, 1.5,
  -0.3,-0.3,-1.5, 1.5, 0.0,
  0.0, 0.5,
];

function buildDefaultGenome(layers) {
  if (JSON.stringify(layers) === '[24,5,2]') return [...SEED_GENOME_24_5_2];
  return xavierGenome(layers);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fitness calculation
// ─────────────────────────────────────────────────────────────────────────────

function computeFitness(car) {
  const onTrackRate = cfg.onTrackRewardRate;
  const penalty     = car._fitPenalty || 0;
  const rawProg     = car.totalProg * (1 + (car._onTrackTime || 0) * onTrackRate);
  const effectiveRaw = Math.max(car._peakRawProg, rawProg);
  let fit = effectiveRaw - penalty;
  if (cfg.lapMode && car._lapCompleted && car._lapTime > 0) {
    fit += 1000 / car._lapTime;
  }
  return fit;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fitness penalties (called every physics tick)
// ─────────────────────────────────────────────────────────────────────────────

function updateFitnessPenalties(car, dt) {
  if (car._offTrack) return;

  // Gravel penalty (accumulates while on gravel)
  if (car.onGravel) {
    car._gravelTime += dt;
    car._fitPenalty += (cfg.gravelPenaltyBase + car._gravelTime * cfg.gravelGrowthRate) * dt;
  } else {
    car._gravelTime = Math.max(0, car._gravelTime - dt * 0.5);
  }

  // Stuck penalty
  const stuckInc = car.stuckTimer - (car._trainPrevStuck || 0);
  if (stuckInc > 0) car._fitPenalty += stuckInc * cfg.stuckPenaltyRate;
  car._trainPrevStuck = car.stuckTimer;

  // Off-track DQ check
  if (!trkData) return;
  let md = Infinity;
  for (const p of trkPts) {
    const d = (car.pos.x - p.x) ** 2 + (car.pos.z - p.z) ** 2;
    if (d < md) md = d;
  }
  const halfW = trkData.rw * 0.5;
  const offTrack = Math.sqrt(md) > halfW + 3;

  if (offTrack) {
    car._offTrackTime += dt;
    car._fitPenalty += cfg.gravelPenaltyBase * cfg.offTrackMult * dt;
    if (car._offTrackTime >= cfg.offTrackDQTime) {
      car._fitPenalty += cfg.dqPenalty;
      car._offTrack = true;
    }
  } else {
    car._offTrackTime = Math.max(0, car._offTrackTime - dt);
    car._onTrackTime += dt;
  }

  // Update peak raw progress
  if (!car._offTrack) {
    const rawProg = car.totalProg * (1 + (car._onTrackTime || 0) * cfg.onTrackRewardRate);
    if (rawProg > car._peakRawProg) car._peakRawProg = rawProg;
  }

  car._fitness = computeFitness(car);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Genetic trainer (self-contained, no global state)
// ─────────────────────────────────────────────────────────────────────────────

class GeneticTrainer {
  constructor(layers) {
    this.layers    = layers;
    this.genomeSize = computeGenomeSize(layers);
    this.generation = 0;
    this.genTime    = 0;
    this.population = [];
    this.bestGenome  = null;
    this.bestFitness = -Infinity;
    this.avgFitness  = 0;
  }

  initPopulation(seedGenome = null, forceRandom = false) {
    if (forceRandom) { this.bestGenome = null; this.bestFitness = -Infinity; }

    let seed;
    if (!forceRandom && seedGenome && seedGenome.length === this.genomeSize) {
      seed = seedGenome;
    } else if (!forceRandom) {
      seed = buildDefaultGenome(this.layers);
    } else {
      seed = null;
    }

    this.population = Array.from({ length: cfg.popSize }, (_, i) => {
      let genome;
      if (seed) {
        genome = [...seed];
        if (i > 0) this._mutate(genome, 0.4, 0.8);
      } else {
        genome = xavierGenome(this.layers);
      }
      return { genome, fitness: 0 };
    });
    this.generation = 0;
    this.genTime    = 0;
  }

  evolve() {
    this.population.sort((a, b) => b.fitness - a.fitness);
    const best = this.population[0];

    if (this.bestFitness > 0 && best.fitness < 0) this.bestFitness = -Infinity;
    if (best.fitness > this.bestFitness) {
      this.bestFitness = best.fitness;
      this.bestGenome  = [...best.genome];
    }
    this.avgFitness = this.population.reduce((s, p) => s + p.fitness, 0) / this.population.length;

    const champion = this.bestGenome || best.genome;
    const next = [{ genome: [...champion], fitness: 0 }];
    while (next.length < cfg.popSize) {
      const child = [...champion];
      this._mutate(child, cfg.mutRate, cfg.mutStrength);
      next.push({ genome: child, fitness: 0 });
    }
    this.population = next;
    this.generation++;
    this.genTime = 0;
  }

  _mutate(genome, rate, strength) {
    for (let i = 0; i < genome.length; i++) {
      if (Math.random() < rate) genome[i] += (Math.random() * 2 - 1) * strength;
    }
  }

  exportModel() {
    if (!this.bestGenome) return null;
    return {
      id: 'ai-trainer-export',
      name: 'AI Trainer Export',
      version: 1,
      layers: this.layers,
      genome: this.bestGenome,
      fitness: this.bestFitness,
      generation: this.generation,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Grid placement
// ─────────────────────────────────────────────────────────────────────────────

function buildGrid(count) {
  const n = trkPts.length;
  if (!n) return Array(count).fill({ pos: { x: 0, y: 0, z: 0 }, hdg: 0 });
  const COLS = 4, COL_GAP = 3.5, ROW_STEP = 8;
  const grid = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / COLS), col = i % COLS;
    const colOff = (col - (COLS - 1) / 2) * COL_GAP;
    const idx  = ((n - row * ROW_STEP) % n + n) % n;
    const pt   = trkPts[idx], ptF = trkPts[(idx + 5) % n];
    const hdg  = Math.atan2(ptF.x - pt.x, ptF.z - pt.z);
    const rx   = Math.cos(hdg), rz = -Math.sin(hdg);
    grid.push({ pos: { x: pt.x + rx * colOff, y: pt.y, z: pt.z + rz * colOff }, hdg });
  }
  return grid;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Simulation initialisation
// ─────────────────────────────────────────────────────────────────────────────

function initSim(carData, layers, seedGenome, forceRandom) {
  trainer = new GeneticTrainer(layers);
  trainer.initPopulation(seedGenome, forceRandom);

  const grid = buildGrid(cfg.popSize);
  cars = [];
  ais  = [];

  for (let i = 0; i < cfg.popSize; i++) {
    const g   = grid[i] || grid[0];
    const car = new SimCar(carData, g.pos, g.hdg);
    car.aiAgg = 0.9 + i * 0.01;
    const genome = trainer.population[i].genome;
    const ai = new SimNeuralAI(car, layers, genome);
    cars.push(car);
    ais.push(ai);
  }
  simTime = 0;
}

function restartGeneration() {
  const grid = buildGrid(cfg.popSize);
  for (let i = 0; i < cars.length; i++) {
    const g = grid[i] || grid[0];
    cars[i].reset(g.pos, g.hdg);
    ais[i].setGenome(trainer.population[i].genome);
  }
  simTime = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Single physics step
// ─────────────────────────────────────────────────────────────────────────────

function stepOnce(dt) {
  simTime += dt;
  trainer.genTime += dt;

  for (let i = 0; i < ais.length; i++) {
    if (!cars[i]._offTrack) {
      ais[i].update(dt);
    }
    updateFitnessPenalties(cars[i], dt);
    trainer.population[i].fitness = cars[i]._fitness;
  }

  // Resolve car-to-car collisions (N² but N is small)
  const CAR_R = 1.8, MIN_D = CAR_R * 2;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= MIN_D || dist < 0.01) continue;
      const nx = dx / dist, nz = dz / dist;
      const ov = (MIN_D - dist) * 0.5;
      a.pos.x -= nx * ov; a.pos.z -= nz * ov;
      b.pos.x += nx * ov; b.pos.z += nz * ov;
      const vAx = a.spd * Math.sin(a.hdg), vAz = a.spd * Math.cos(a.hdg);
      const vBx = b.spd * Math.sin(b.hdg), vBz = b.spd * Math.cos(b.hdg);
      const relVn = (vBx - vAx) * nx + (vBz - vAz) * nz;
      if (relVn >= 0) continue;
      const imp = -(1 + 0.35) * relVn * 0.5;
      const nAx = vAx - imp * nx, nAz = vAz - imp * nz;
      const nBx = vBx + imp * nx, nBz = vBz + imp * nz;
      const sA = Math.sqrt(nAx * nAx + nAz * nAz);
      const sB = Math.sqrt(nBx * nBx + nBz * nBz);
      if (sA > 0.3) { const h = Math.atan2(nAx, nAz); const d = ((h - a.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI; a.hdg += Math.max(-0.35, Math.min(0.35, d)); }
      if (sB > 0.3) { const h = Math.atan2(nBx, nBz); const d = ((h - b.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI; b.hdg += Math.max(-0.35, Math.min(0.35, d)); }
      a.spd = Math.min(a.data.maxSpd, sA);
      b.spd = Math.min(b.data.maxSpd, sB);
    }
  }

  // Check if generation is over
  const allDone = cfg.lapMode
    ? cars.every(c => c._lapCompleted || c._offTrack || c.finished)
    : trainer.genTime >= cfg.genDuration;

  if (allDone) {
    trainer.evolve();
    restartGeneration();
    return true; // generation ended
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Frame snapshot for postMessage
// ─────────────────────────────────────────────────────────────────────────────

function buildSnapshot() {
  const carData = cars.map(c => ({
    x: c.pos.x, y: c.pos.y, z: c.pos.z,
    hdg: c.hdg,
    spd: c.spd,
    fitness: c._fitness,
    totalProg: c.totalProg,
    lap: c.lap,
    onGravel: c.onGravel,
    offTrack: c._offTrack,
    finished: c.finished,
  }));
  return {
    type: 'frame',
    cars: carData,
    generation: trainer.generation,
    genTime: trainer.genTime,
    genDuration: cfg.genDuration,
    bestFitness: trainer.bestFitness,
    avgFitness: trainer.avgFitness,
    bestGenome: trainer.bestGenome,
    layers: trainer.layers,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Simulation loop
// ─────────────────────────────────────────────────────────────────────────────

function simLoop() {
  if (!running || !trainer) { tickHandle = null; return; }

  const steps = Math.max(1, cfg.speedMult);
  for (let s = 0; s < steps; s++) {
    stepOnce(FIXED_DT);
    if (!running) break;
  }

  const now = performance.now();
  if (now - lastPostMs >= 1000 / POST_HZ) {
    postMessage(buildSnapshot());
    lastPostMs = now;
  }

  tickHandle = setTimeout(simLoop, 0);
}

function startLoop() {
  if (tickHandle !== null) return;
  lastPostMs = performance.now();
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
    const { track, carData, config, seedGenome, forceRandom } = e.data;
    trkPts       = track.pts;
    trkWallLeft  = track.wallLeft;
    trkWallRight = track.wallRight;
    trkData      = track.data;
    gravelProfile = track.gravelProfile || null;

    if (config) Object.assign(cfg, config);

    const hiddenCount = cfg.hiddenLayers;
    const nodesCount  = cfg.nodesPerLayer;
    const inSize      = 24;
    const layers = [inSize, ...Array(hiddenCount).fill(nodesCount), 2];

    running = false;
    stopLoop();
    initSim(carData, layers, seedGenome || null, forceRandom || false);
    postMessage({ type: 'ready', layers });
    return;
  }

  if (type === 'start') {
    if (!trainer) return;
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
    if (!trainer) return;
    trainer.initPopulation(null, true);
    restartGeneration();
    return;
  }

  if (type === 'setConfig') {
    Object.assign(cfg, e.data.config);
    return;
  }

  if (type === 'loadGenome') {
    const { genome, layers } = e.data;
    if (!trainer) return;
    running = false;
    stopLoop();
    const newLayers = layers || trainer.layers;
    initSim(cars[0]?.data || { accel: 9, maxSpd: 61, brake: 21, hdl: 0.84, aiSpd: 1.0 }, newLayers, genome, false);
    postMessage({ type: 'ready', layers: newLayers });
    return;
  }

  if (type === 'getSnapshot') {
    if (trainer) postMessage(buildSnapshot());
    return;
  }

  if (type === 'exportModel') {
    if (!trainer) return;
    const model = trainer.exportModel();
    postMessage({ type: 'modelExport', model });
    return;
  }
};
