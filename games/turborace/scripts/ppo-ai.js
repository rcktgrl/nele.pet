'use strict';
import { state } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
//  ppo-ai.js — race-opponent driver for models trained in the AI Trainer.
//
//  Supports both AI Trainer export flavours:
//    • 'ppo'      feed-forward actor — 40 inputs (11 track-edge rays, 7 wall
//                 rays, 6 state scalars, 6 centerline probes × 2, 4 memory
//                 cells), 6 outputs (steer, throttle, 4 memory deltas).
//    • 'ppo-gru'  recurrent actor — 36 inputs (same layout WITHOUT the 4
//                 memory cells; the GRU hidden state replaces them), 2 outputs
//                 (steer, throttle).
//
//  The observation layout mirrors ai-trainer/scripts/sim-worker.js exactly and
//  the actor network runs deterministically (mean action, no exploration noise)
//  on a real race Car.
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
const MEM_RATE    = 0.1;
const ACTION_REPEAT = 2; // physics ticks per decision, same as training

// Shared observation prefix (indices 0..35) common to both algorithms.
const BASE_OBS = 24 + PROBE_DISTS.length * 2; // 36

// Feed-forward PPO: 4 external memory cells appended → obs 40, act 6.
const FF_MEM_DIM = 4;
const FF_OBS_DIM = BASE_OBS + FF_MEM_DIM; // 40
const FF_ACT_DIM = 2 + FF_MEM_DIM;        // 6

// Recurrent PPO-GRU: GRU hidden state replaces the memory cells → obs 36, act 2.
const GRU_OBS_DIM = BASE_OBS; // 36
const GRU_ACT_DIM = 2;        // 2

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function wrapPi(a) { return a - 2 * Math.PI * Math.round(a / (2 * Math.PI)); }

// Parameter count for a single-layer GRU [I, H, O] — must match nn-core.js GRUNet:
//   Wz Wr Wh (H×I) · Uz Ur Uh (H×H) · bz br bh (H) · Wy (O×H) · by (O)
function gruParamCount([I, H, O]) {
  return 3 * H * I + 3 * H * H + 3 * H + O * H + O;
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

// ── Model storage ─────────────────────────────────────────────────────────────

/** Throws with a human-readable message if the model can't drive here. */
export function validateTrainedModel(model) {
  if (!model || !model.actor || !Array.isArray(model.actor.sizes) || !Array.isArray(model.actor.flat)) {
    throw new Error('Not an AI Trainer PPO export');
  }
  const sizes = model.actor.sizes;
  const outDim = sizes[sizes.length - 1];

  if (model.algo === 'ppo-gru') {
    // Recurrent actor: a single GRU layer + linear head → sizes is [I, H, O].
    if (sizes.length !== 3) {
      throw new Error('incompatible recurrent model: actor must be a single GRU layer [in, hidden, out] — retrain and re-export in the AI Trainer');
    }
    if (model.obsDim !== GRU_OBS_DIM || sizes[0] !== GRU_OBS_DIM || outDim !== GRU_ACT_DIM) {
      throw new Error(`incompatible model: obs ${model.obsDim}/act ${outDim}, ` +
                      `the game expects obs ${GRU_OBS_DIM}/act ${GRU_ACT_DIM} for a GRU policy — retrain and re-export in the AI Trainer`);
    }
    if (model.actor.flat.length !== gruParamCount(sizes)) {
      throw new Error('actor weight count does not match its GRU layer sizes');
    }
    return model;
  }

  if (model.algo === 'ppo') {
    // Feed-forward actor: sizes is [in, ...hidden, out].
    if (model.obsDim !== FF_OBS_DIM || sizes[0] !== FF_OBS_DIM || outDim !== FF_ACT_DIM) {
      throw new Error(`incompatible model: obs ${model.obsDim}/act ${outDim}, ` +
                      `the game expects obs ${FF_OBS_DIM}/act ${FF_ACT_DIM} — retrain and re-export in the AI Trainer`);
    }
    let n = 0;
    for (let l = 0; l < sizes.length - 1; l++) n += (sizes[l] + 1) * sizes[l + 1];
    if (model.actor.flat.length !== n) throw new Error('actor weight count does not match its layer sizes');
    return model;
  }

  throw new Error('Not an AI Trainer PPO export (expected algo "ppo" or "ppo-gru")');
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
    // Which car the model was trained with (CARS id). Used by the race so the
    // AI drives the car it learned on; falls back to the red car when absent.
    carId: model.carId,
    carName: model.carName,
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
//  PPOAI — drives one Car with an imported actor network (feed-forward or GRU)
// ─────────────────────────────────────────────────────────────────────────────
export class PPOAI {
  /**
   * @param {object}   car      - Car instance
   * @param {object}   model    - validated AI Trainer PPO export ('ppo' or 'ppo-gru')
   * @param {function} context  - returns {trackPoints, cityAiPoints, trackData} each frame
   */
  constructor(car, model, context) {
    this.car = car;
    this.context = context;

    this.recurrent = model.algo === 'ppo-gru';
    this.obsDim = this.recurrent ? GRU_OBS_DIM : FF_OBS_DIM;
    this.actDim = this.recurrent ? GRU_ACT_DIM : FF_ACT_DIM;
    this.memDim = this.recurrent ? 0 : FF_MEM_DIM;

    if (this.recurrent) this._unpackGRU(model.actor);
    else                this._unpackActor(model.actor);

    this.mem = new Float64Array(this.memDim);
    this.curAct = new Float64Array(this.actDim);
    this.repCount = 0;
    this._arcReady = false;
    this._arcHint = -1;
  }

  // ── Feed-forward actor (nn-core.js Net.flat: per layer nOut×nIn weights, then biases) ──
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

  _forwardFF(x) {
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

  // ── Recurrent actor (nn-core.js GRUNet) ─────────────────────────────────────
  // Flat layout: Wz Wr Wh (H×I) · Uz Ur Uh (H×H) · bz br bh (H) · Wy (O×H) · by (O)
  _unpackGRU(actor) {
    const [I, H, O] = actor.sizes;
    this.sizes = actor.sizes;
    this.gI = I; this.gH = H; this.gO = O;
    const f = actor.flat;
    let k = 0;
    const take = (n) => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = f[k++]; return a; };
    this.Wz = take(H * I); this.Wr = take(H * I); this.Wh = take(H * I);
    this.Uz = take(H * H); this.Ur = take(H * H); this.Uh = take(H * H);
    this.bz = take(H); this.br = take(H); this.bh = take(H);
    this.Wy = take(O * H); this.by = take(O);
    this.h = new Float64Array(H); // recurrent hidden state, carried across decisions
  }

  // One GRU step — advances the hidden state and returns the linear output.
  _forwardGRU(x) {
    const I = this.gI, H = this.gH, O = this.gO;
    const hPrev = this.h;
    const z = new Float64Array(H), r = new Float64Array(H);
    const hh = new Float64Array(H), rh = new Float64Array(H), hOut = new Float64Array(H);
    for (let j = 0; j < H; j++) {
      let sz = this.bz[j], sr = this.br[j];
      const xo = j * I, ho = j * H;
      for (let i = 0; i < I; i++) { sz += this.Wz[xo + i] * x[i]; sr += this.Wr[xo + i] * x[i]; }
      for (let k = 0; k < H; k++) { sz += this.Uz[ho + k] * hPrev[k]; sr += this.Ur[ho + k] * hPrev[k]; }
      z[j] = sigmoid(sz); r[j] = sigmoid(sr);
    }
    for (let k = 0; k < H; k++) rh[k] = r[k] * hPrev[k];
    for (let j = 0; j < H; j++) {
      let sh = this.bh[j];
      const xo = j * I, ho = j * H;
      for (let i = 0; i < I; i++) sh += this.Wh[xo + i] * x[i];
      for (let k = 0; k < H; k++) sh += this.Uh[ho + k] * rh[k];
      hh[j] = Math.tanh(sh);
      hOut[j] = (1 - z[j]) * hPrev[j] + z[j] * hh[j];
    }
    const y = new Float64Array(O);
    for (let o = 0; o < O; o++) {
      let s = this.by[o];
      const off = o * H;
      for (let j = 0; j < H; j++) s += this.Wy[off + j] * hOut[j];
      y[o] = s;
    }
    this.h = hOut;
    return y;
  }

  _forward(x) { return this.recurrent ? this._forwardGRU(x) : this._forwardFF(x); }

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

  // Observation layout — see sim-worker.js buildObs.
  // Fills the shared 36-element prefix (indices 0..35); for feed-forward models
  // the 4 memory cells are appended at 36..39.
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
    // Feed-forward only: external memory cells (the GRU has no memory inputs).
    for (let d = 0; d < this.memDim; d++) out[BASE_OBS + d] = this.mem[d];
  }

  // ── Main update (called every physics tick) ──────────────────────────────────

  update(dt) {
    const { trackPoints } = this.context();
    if (!trackPoints || !trackPoints.length || this.car.finished) return;
    if (!this._arcReady) this._buildArcTable();

    if (this.repCount <= 0) {
      const obs = new Float64Array(this.obsDim);
      this._buildObs(obs);
      const mean = this._forward(obs);
      for (let d = 0; d < this.actDim; d++) this.curAct[d] = mean[d];
      this.repCount = ACTION_REPEAT;
      // Feed-forward memory write (no-op for GRU: memDim = 0).
      for (let d = 0; d < this.memDim; d++) {
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
