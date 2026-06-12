'use strict';
import { state } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
//  ppo-ai.js — race-opponent driver for models trained in the AI Trainer.
//
//  Reproduces the exact observation layout of ai-trainer/scripts/sim-worker.js
//  (40 inputs: 11 track-edge rays, 7 wall rays, 6 state scalars, 6 centerline
//  probes × 2, 4 memory cells) and runs the exported PPO actor network
//  deterministically (mean action, no exploration noise) on a real race Car.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'turborace_trained_ai_model';

// ── Sensor / observation constants — must match sim-worker.js ────────────────
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
const PROBE_DISTS = [10, 20, 35, 55, 100, 200];
const SLOPE_NORM  = 0.30;
const MEM_DIM  = 4;
const MEM_RATE = 0.1;
const OBS_DIM  = 24 + PROBE_DISTS.length * 2 + MEM_DIM; // 40
const ACT_DIM  = 2 + MEM_DIM;                           // 6
const ACTION_REPEAT = 2; // physics ticks per decision, same as training

function wrapPi(a) { return a - 2 * Math.PI * Math.round(a / (2 * Math.PI)); }

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

// ── Model storage ─────────────────────────────────────────────────────────────

/** Throws with a human-readable message if the model can't drive here. */
export function validateTrainedModel(model) {
  if (!model || model.algo !== 'ppo' || !model.actor || !Array.isArray(model.actor.sizes) || !Array.isArray(model.actor.flat)) {
    throw new Error('Not an AI Trainer PPO export');
  }
  const sizes = model.actor.sizes;
  if (model.obsDim !== OBS_DIM || sizes[0] !== OBS_DIM || sizes[sizes.length - 1] !== ACT_DIM) {
    throw new Error(`incompatible model: obs ${model.obsDim}/act ${sizes[sizes.length - 1]}, ` +
                    `the game expects obs ${OBS_DIM}/act ${ACT_DIM} — retrain and re-export in the AI Trainer`);
  }
  let n = 0;
  for (let l = 0; l < sizes.length - 1; l++) n += (sizes[l] + 1) * sizes[l + 1];
  if (model.actor.flat.length !== n) throw new Error('actor weight count does not match its layer sizes');
  return model;
}

export function saveTrainedModel(model) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    name: model.name || 'AI Trainer PPO Export',
    algo: model.algo,
    obsDim: model.obsDim,
    actDim: model.actDim,
    actor: model.actor,
    iteration: model.iteration,
    totalSteps: model.totalSteps,
    bestLap: model.bestLap,
  }));
}

export function loadTrainedModel() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateTrainedModel(JSON.parse(raw));
  } catch { return null; }
}

export function clearTrainedModel() { localStorage.removeItem(STORAGE_KEY); }

// ─────────────────────────────────────────────────────────────────────────────
//  PPOAI — drives one Car with an imported actor network
// ─────────────────────────────────────────────────────────────────────────────
export class PPOAI {
  /**
   * @param {object}   car      - Car instance
   * @param {object}   model    - validated AI Trainer PPO export
   * @param {function} context  - returns {trackPoints, cityAiPoints, trackData} each frame
   */
  constructor(car, model, context) {
    this.car = car;
    this.context = context;
    this._unpackActor(model.actor);
    this.mem = new Float64Array(MEM_DIM);
    this.curAct = new Float64Array(ACT_DIM);
    this.repCount = 0;
    this._arcReady = false;
    this._arcHint = -1;
  }

  // Flat layout per layer (nn-core.js Net.flat): nOut×nIn weights, then biases.
  _unpackActor(actor) {
    this.sizes = actor.sizes;
    this.W = []; this.b = [];
    let k = 0;
    const flat = actor.flat;
    for (let l = 0; l < this.sizes.length - 1; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const W = new Float64Array(nOut * nIn);
      for (let i = 0; i < W.length; i++) W[i] = flat[k++];
      const b = new Float64Array(nOut);
      for (let i = 0; i < nOut; i++) b[i] = flat[k++];
      this.W.push(W); this.b.push(b);
    }
  }

  _forward(x) {
    let a = x;
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
    }
    return a;
  }

  // ── Centerline arc table (same construction as sim-worker buildArcTable) ────

  _buildArcTable() {
    const { trackPoints, cityAiPoints } = this.context();
    const useCity = !!(cityAiPoints && cityAiPoints.pts && cityAiPoints.pts.length);
    this.navPts = useCity
      ? cityAiPoints.pts.map(p => ({ x: p.x, y: 0, z: p.z }))
      : trackPoints;
    this.useCity = useCity;
    const n = this.navPts.length;
    this.arcLen = new Float64Array(n);
    let s = 0;
    for (let i = 1; i < n; i++) {
      s += Math.hypot(this.navPts[i].x - this.navPts[i - 1].x, this.navPts[i].z - this.navPts[i - 1].z);
      this.arcLen[i] = s;
    }
    this.trackLen = s + Math.hypot(this.navPts[0].x - this.navPts[n - 1].x, this.navPts[0].z - this.navPts[n - 1].z);
    if (this.trackLen < 1) this.trackLen = 1;
    this._arcReady = true;
  }

  _nearestIdx(px, pz, hint, win) {
    const pts = this.navPts, n = pts.length;
    let md = Infinity, ni = 0;
    if (hint >= 0 && hint < n) {
      for (let k = -win; k <= win; k++) {
        const i = ((hint + k) % n + n) % n;
        const d = (px - pts[i].x) ** 2 + (pz - pts[i].z) ** 2;
        if (d < md) { md = d; ni = i; }
      }
      if (md <= 30 * 30) return { idx: ni, d2: md };
    }
    md = Infinity; ni = 0;
    for (let i = 0; i < n; i++) {
      const d = (px - pts[i].x) ** 2 + (pz - pts[i].z) ** 2;
      if (d < md) { md = d; ni = i; }
    }
    return { idx: ni, d2: md };
  }

  _arcPosition(px, pz) {
    const n = this.navPts.length;
    const r = this._nearestIdx(px, pz, this._arcHint, 25);
    this._arcHint = r.idx;
    const a = this.navPts[r.idx], b = this.navPts[(r.idx + 1) % n];
    const abx = b.x - a.x, abz = b.z - a.z;
    const ab2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * abx + (pz - a.z) * abz) / ab2));
    return { s: (this.arcLen[r.idx] + t * Math.sqrt(ab2)) % this.trackLen, nearestD2: r.d2 };
  }

  _pointAtArc(s) {
    const n = this.navPts.length;
    s = ((s % this.trackLen) + this.trackLen) % this.trackLen;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.arcLen[mid] <= s) lo = mid; else hi = mid - 1;
    }
    const a = this.navPts[lo], b = this.navPts[(lo + 1) % n];
    const segLen = (lo + 1 < n ? this.arcLen[lo + 1] : this.trackLen) - this.arcLen[lo] || 1;
    const t = Math.min(1, (s - this.arcLen[lo]) / segLen);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  // ── Sensors ──────────────────────────────────────────────────────────────────

  _castRayFan(angles, maxDist, out, offset) {
    const c = this.car;
    const ox = c.pos.x, oz = c.pos.z;
    const rr = maxDist * maxDist * 1.5;
    const near = [];
    for (const segs of [state.trkWallLeft || [], state.trkWallRight || []]) {
      for (const w of segs) {
        const cx = (w.x0 + w.x1) * 0.5 - ox, cz = (w.z0 + w.z1) * 0.5 - oz;
        const e0x = w.x0 - ox, e0z = w.z0 - oz;
        const e1x = w.x1 - ox, e1z = w.z1 - oz;
        if (cx * cx + cz * cz < rr ||
            e0x * e0x + e0z * e0z < rr ||
            e1x * e1x + e1z * e1z < rr) near.push(w);
      }
    }
    for (let k = 0; k < angles.length; k++) {
      const angle = c.hdg + angles[k];
      const dx = Math.sin(angle), dz = Math.cos(angle);
      let minT = maxDist;
      for (const w of near) {
        const t = raySegment(ox, oz, dx, dz, w.x0, w.z0, w.x1, w.z1);
        if (t > 0 && t < minT) minT = t;
      }
      out[offset + k] = minT / maxDist;
    }
  }

  // Observation layout — see sim-worker.js buildObs
  _buildObs(out) {
    const c = this.car;
    const { trackData } = this.context();

    this._castRayFan(RAY_ANGLES, RAY_DIST, out, 0);
    for (let k = 0; k < RAY_ANGLES.length; k++) out[k] = Math.sqrt(out[k]);
    this._castRayFan(EDGE_RAY_ANGLES, EDGE_RAY_DIST, out, 11);

    const ap = this._arcPosition(c.pos.x, c.pos.z);
    const speedFrac = c.spd / c.data.maxSpd;
    const lookM = this.useCity ? 8 + speedFrac * 25 : 12 + speedFrac * 45;
    const tgt = this._pointAtArc(ap.s + lookM);
    const he  = wrapPi(Math.atan2(tgt.x - c.pos.x, tgt.z - c.pos.z) - c.hdg);

    const halfW = trackData ? trackData.rw * 0.5 : 10;
    out[18] = speedFrac;
    out[19] = Math.max(-1, Math.min(1, he / Math.PI));
    out[20] = Math.min(1, Math.sqrt(ap.nearestD2) / Math.max(1, halfW));
    out[21] = c.onGravel ? 1 : 0;
    out[22] = c.isReversing ? 1 : 0;

    let prevY = this._pointAtArc(ap.s).y;
    const hereAhead = this._pointAtArc(ap.s + 4);
    out[23] = Math.max(-1, Math.min(1, (hereAhead.y - prevY) / 4 / SLOPE_NORM));

    let prevD = 0;
    for (let k = 0; k < PROBE_DISTS.length; k++) {
      const d = PROBE_DISTS[k];
      const p = this._pointAtArc(ap.s + d);
      const ang = wrapPi(Math.atan2(p.x - c.pos.x, p.z - c.pos.z) - c.hdg);
      const slope = (p.y - prevY) / (d - prevD);
      out[24 + k * 2]     = Math.max(-1, Math.min(1, ang / Math.PI));
      out[24 + k * 2 + 1] = Math.max(-1, Math.min(1, slope / SLOPE_NORM));
      prevY = p.y; prevD = d;
    }
    for (let d = 0; d < MEM_DIM; d++) out[24 + PROBE_DISTS.length * 2 + d] = this.mem[d];
  }

  // ── Main update (called every physics tick) ──────────────────────────────────

  update(dt) {
    const { trackPoints } = this.context();
    if (!trackPoints || !trackPoints.length || this.car.finished) return;
    if (!this._arcReady) this._buildArcTable();

    if (this.repCount <= 0) {
      const obs = new Float64Array(OBS_DIM);
      this._buildObs(obs);
      const mean = this._forward(obs);
      for (let d = 0; d < ACT_DIM; d++) this.curAct[d] = mean[d];
      this.repCount = ACTION_REPEAT;
      for (let d = 0; d < MEM_DIM; d++) {
        const a = Math.max(-1, Math.min(1, this.curAct[2 + d]));
        this.mem[d] = Math.max(-1, Math.min(1, this.mem[d] + MEM_RATE * a));
      }
    }
    this.repCount--;

    const str = Math.max(-1, Math.min(1, this.curAct[0]));
    const a1  = Math.max(-1, Math.min(1, this.curAct[1]));
    const thr = a1 > 0 ? a1 : 0;
    const brk = a1 < 0 ? -a1 : 0;
    this.car.update({ thr, brk, str }, dt);
  }
}
