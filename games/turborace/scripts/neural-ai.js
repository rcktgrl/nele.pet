'use strict';
import { state } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Repo model pre-fetch — loaded at module init, used as fallback in constructor
// ─────────────────────────────────────────────────────────────────────────────
let _repoGenome = null;
(async () => {
  try {
    const idx = await fetch('./models/index.json').then(r => r.json());
    const defaultId = idx.default;
    if (defaultId) {
      const model = await fetch(`./models/${defaultId}.json`).then(r => r.json());
      if (Array.isArray(model.genome) && model.genome.length > 0) {
        _repoGenome = model.genome;
      }
    }
  } catch (_) { /* silently fall back to hand-designed defaults */ }
})();

// ─────────────────────────────────────────────────────────────────────────────
//  Default hand-designed weights for [24, 5, 2] architecture
//  Inputs: 11 track-edge sensors (-90,-60,-30,-10,-5,0,+5,+10,+30,+60,+90)
//        + 7 wall sensors (-90,-45,-10,0,+10,+45,+90)
//        + speed, waypointErr, edgeProximity, gravelFlag, grip, accel
//  Outputs: steer, throttle (negative value = brake)
// ─────────────────────────────────────────────────────────────────────────────
const _DEFAULT_LAYERS = [24, 5, 2];
//                    t-90  t-60  t-30  t-10   t-5    t0   t+5  t+10  t+30  t+60  t+90 | w-90  w-45  w-10    w0  w+10  w+45  w+90 | spd   wpt  edge  grav  grip   acl
const _W1 = [
  [-2.0, -2.5, -3.0, -2.0, -1.0, -0.5,  0.0,  0.3,  0.5,  0.3,  0.0, -1.0, -1.5, -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.8,  0.5,  0.0,  0.0], // H0 danger-left
  [ 0.0,  0.3,  0.5,  0.0,  0.3, -0.5, -1.0, -2.0, -3.0, -2.5, -2.0,  0.0,  0.0,  0.0,  0.0, -0.5, -1.5, -1.0,  0.0,  0.0,  0.8,  0.5,  0.0,  0.0], // H1 danger-right
  [ 0.0,  0.0, -0.5, -1.0, -2.0, -3.0, -2.0, -1.0, -0.5,  0.0,  0.0, -0.3, -0.8, -1.5, -3.0, -1.5, -0.8, -0.3,  0.0,  0.0,  0.5,  0.5,  0.0,  0.0], // H2 danger-ahead
  [ 0.8,  0.8,  0.8,  0.6,  0.5,  1.5,  0.5,  0.6,  0.8,  0.8,  0.8,  0.5,  0.8,  0.8,  1.0,  0.8,  0.8,  0.5,  1.5,  0.0, -1.5, -1.0,  0.0,  0.0], // H3 open-track
  [ 0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  2.0,  0.0,  0.0,  0.0,  0.0], // H4 waypoint-err
];
const _b1 = [2.0, 2.0, 2.0, -6.0, 0.0];
const _W2 = [
  [ 1.2, -1.2,  0.0,  0.0,  1.5], // steer
  [-0.3, -0.3, -1.5,  1.5,  0.0], // throttle (negative = brake)
];
const _b2 = [0.0, 0.5];

// ─────────────────────────────────────────────────────────────────────────────
//  Ray-segment intersection
// ─────────────────────────────────────────────────────────────────────────────
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

// 11 track-edge rays: ±90°, ±60°, ±30°, ±10°, ±5°, 0° — cast against track-edge segments
const RAY_ANGLES = [
  -Math.PI / 2, -Math.PI / 3, -Math.PI / 6,
  -Math.PI / 18, -Math.PI / 36,
  0,
  Math.PI / 36, Math.PI / 18,
  Math.PI / 6, Math.PI / 3, Math.PI / 2,
];
const RAY_DIST = 200;

// 7 wall rays: ±90°, ±45°, ±10°, 0° — cast against wall segments
const EDGE_RAY_ANGLES = [
  -Math.PI / 2, -Math.PI / 4, -Math.PI / 18,
  0,
  Math.PI / 18, Math.PI / 4, Math.PI / 2,
];
const EDGE_RAY_DIST = 35;

// ─────────────────────────────────────────────────────────────────────────────
//  NeuralAI — configurable-depth network
//   layers: e.g. [9, 5, 2] or [9, 6, 6, 2]
// ─────────────────────────────────────────────────────────────────────────────
export class NeuralAI {
  /**
   * @param {object}   car      - Car instance
   * @param {number}   la       - Look-ahead multiplier
   * @param {function} context  - Returns context object each frame
   * @param {number[]|null} genome  - Flat weight array (length must match layers)
   * @param {number[]|null} layers  - e.g. [9,5,2]; inferred from genome if omitted
   */
  constructor(car, la, context, genome = null, layers = null) {
    this.car = car;
    this.la = la || 0.055;
    this.slowTimer = 0;
    this.prevPos = null;
    this.stuckCount = 0;
    this.context = context;
    this.revMode = 'none';
    this.revTimer = 0;
    this.revSteer = 0;
    this._graceTimer = 0; // grace period before stuck detection activates

    // Determine architecture
    if (layers) {
      this.layers = layers;
    } else if (genome) {
      this.layers = NeuralAI._inferLayers(genome) || _DEFAULT_LAYERS;
    } else {
      this.layers = _DEFAULT_LAYERS;
    }

    if (genome && genome.length === NeuralAI.genomeSize(this.layers)) {
      this.weights = NeuralAI._unpack(genome, this.layers);
    } else {
      this._useDefaults();
    }
  }

  // ── Static helpers ──────────────────────────────────────────────────────────

  /** Total number of scalar parameters for a given layer spec. */
  static genomeSize(layers) {
    let s = 0;
    for (let i = 0; i < layers.length - 1; i++) s += layers[i + 1] * (layers[i] + 1);
    return s;
  }

  /** Try to infer layer spec from genome length. Returns null if ambiguous. */
  static _inferLayers(genome) {
    const s = genome.length;
    if (s === 52) return [7, 5, 2];
    if (s === 62) return [9, 5, 2];
    if (s === 88) return [13, 5, 3];
    if (s === 98) return [15, 5, 3];
    if (s === 108) return [17, 5, 3];
    if (s === 123) return [20, 5, 3];
    if (s === 137) return [24, 5, 2];
    if (s === 143) return [24, 5, 3];
    // Try [nIn, 5, 3] variants (last layer [5→3] = 3*6 = 18)
    const r3 = s - 18;
    if (r3 > 0 && r3 % 5 === 0) {
      const nIn = r3 / 5 - 1;
      if (nIn >= 9 && nIn <= 24) return [nIn, 5, 3];
    }
    // Try [nIn, 5, 2] variants
    const r = s - 2 * 6;
    if (r > 0 && r % 5 === 0) {
      const nIn = r / 5 - 1;
      if (nIn >= 7 && nIn <= 24) return [nIn, 5, 2];
    }
    return null;
  }

  /** Unpack flat genome into [{W, b}, ...] weight list. */
  static _unpack(g, layers) {
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

  // ── Weight management ───────────────────────────────────────────────────────

  _useDefaults() {
    if (JSON.stringify(this.layers) === '[24,5,2]') {
      this.weights = [{ W: _W1.map(r => [...r]), b: [..._b1] }, { W: _W2.map(r => [...r]), b: [..._b2] }];
      return;
    }
    // Check localStorage or repo for compatible genome
    const saved = localStorage.getItem('turborace_nn_weights');
    if (saved) {
      try {
        const g = JSON.parse(saved);
        if (g.length === NeuralAI.genomeSize(this.layers)) {
          this.weights = NeuralAI._unpack(g, this.layers); return;
        }
      } catch (_) { /**/ }
    }
    if (_repoGenome && _repoGenome.length === NeuralAI.genomeSize(this.layers)) {
      this.weights = NeuralAI._unpack(_repoGenome, this.layers); return;
    }
    // Xavier random init
    this.weights = NeuralAI._xavierInit(this.layers);
  }

  static _xavierInit(layers) {
    const weights = [];
    for (let l = 0; l < layers.length - 1; l++) {
      const nIn = layers[l], nOut = layers[l + 1];
      const std = Math.sqrt(2 / (nIn + nOut)) * 3;
      const W = Array.from({ length: nOut }, () =>
        Array.from({ length: nIn }, () => (Math.random() * 2 - 1) * std)
      );
      const b = Array.from({ length: nOut }, () => 0);
      weights.push({ W, b });
    }
    return weights;
  }

  /** Replace weights mid-life (called by genetic trainer between generations). */
  setWeights(genome) {
    if (genome.length === NeuralAI.genomeSize(this.layers)) {
      this.weights = NeuralAI._unpack(genome, this.layers);
      // Reset internal driving state so the new generation starts clean,
      // not mid-reverse or mid-stuck-recovery from the previous generation.
      this.slowTimer = 0;
      this.prevPos = null;
      this.stuckCount = 0;
      this.revMode = 'none';
      this.revTimer = 0;
      this._graceTimer = 0;
    }
  }

  // ── Sensors ─────────────────────────────────────────────────────────────────

  // 11 rays cast against track-edge segments — tells the car how far the edge is in each direction
  _castRays(edgeLeft, edgeRight) {
    const c = this.car;
    const ox = c.pos.x, oz = c.pos.z;
    const rr = RAY_DIST * RAY_DIST * 1.5;
    const near = [];
    for (const segs of [edgeLeft, edgeRight]) {
      for (const w of segs) {
        const cx = (w.x0 + w.x1) * 0.5 - ox, cz = (w.z0 + w.z1) * 0.5 - oz;
        if (cx * cx + cz * cz < rr) near.push(w);
      }
    }
    return RAY_ANGLES.map(a => {
      const angle = c.hdg + a;
      const dx = Math.sin(angle), dz = Math.cos(angle);
      let minT = RAY_DIST;
      for (const w of near) {
        const t = raySegment(ox, oz, dx, dz, w.x0, w.z0, w.x1, w.z1);
        if (t > 0 && t < minT) minT = t;
      }
      return Math.sqrt(minT / RAY_DIST);
    });
  }

  // 7 rays cast against wall segments — tells the car how far the barriers are
  _castEdgeRays(wallLeft, wallRight) {
    const c = this.car;
    const ox = c.pos.x, oz = c.pos.z;
    const rr = EDGE_RAY_DIST * EDGE_RAY_DIST * 1.5;
    const near = [];
    for (const segs of [wallLeft, wallRight]) {
      for (const e of segs) {
        const cx = (e.x0 + e.x1) * 0.5 - ox, cz = (e.z0 + e.z1) * 0.5 - oz;
        if (cx * cx + cz * cz < rr) near.push(e);
      }
    }
    return EDGE_RAY_ANGLES.map(a => {
      const angle = c.hdg + a;
      const dx = Math.sin(angle), dz = Math.cos(angle);
      let minT = EDGE_RAY_DIST;
      for (const e of near) {
        const t = raySegment(ox, oz, dx, dz, e.x0, e.z0, e.x1, e.z1);
        if (t > 0 && t < minT) minT = t;
      }
      return minT / EDGE_RAY_DIST;
    });
  }

  // ── Forward pass ─────────────────────────────────────────────────────────────

  _forward(inputs) {
    this.lastInputs = inputs;
    this.lastHiddens = [];
    let x = inputs;
    for (let l = 0; l < this.weights.length - 1; l++) {
      const { W, b } = this.weights[l];
      x = W.map((row, i) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], 0) + b[i]));
      this.lastHiddens.push([...x]);
    }
    this.lastHidden = this.lastHiddens[0] || []; // backward compat
    const last = this.weights[this.weights.length - 1];
    const out = last.W.map((row, i) => Math.tanh(row.reduce((s, w, j) => s + w * x[j], 0) + last.b[i]));
    this.lastOutputs = out;
    return out;
  }

  // ── Main update (called every physics tick) ─────────────────────────────────

  update(dt) {
    const { trackPoints, cityAiPoints, trackData } = this.context();
    if (!trackPoints.length || this.car.finished) return;
    const c = this.car;

    // ── Stuck detection + reverse recovery ───────────────────────────────────
    // Grace period: don't trigger stuck detection for the first 3 seconds
    // after spawn/reset so cars have time to accelerate from standstill.
    this._graceTimer += dt;
    if (!this.prevPos) this.prevPos = { x: c.pos.x, z: c.pos.z };
    const moved = Math.sqrt((c.pos.x - this.prevPos.x) ** 2 + (c.pos.z - this.prevPos.z) ** 2);
    this.prevPos.x = c.pos.x; this.prevPos.z = c.pos.z;
    if (this._graceTimer > 3 && moved < 0.015 * dt * 60) this.slowTimer += dt;
    else { this.slowTimer = Math.max(0, this.slowTimer - dt * 3); if (this.revMode === 'none') this.stuckCount = 0; }

    // Active reverse manoeuvre — overrides all other AI logic
    if (this.revMode === 'braking') {
      this.revTimer += dt;
      c.update({ thr: 0, brk: 1, str: 0 }, dt);
      if (c.spd < 0.15 || this.revTimer > 0.8) { this.revMode = 'reversing'; this.revTimer = 0; }
      return;
    }
    if (this.revMode === 'reversing') {
      this.revTimer += dt;
      c.update({ thr: 0, brk: 0.9, str: this.revSteer }, dt);
      if (this.revTimer > 1.8) {
        this.revMode = 'none'; this.slowTimer = 0; this.stuckCount++;
        if (state.gState !== 'training' && this.stuckCount > 2) {
          const navP = cityAiPoints ? cityAiPoints.pts : trackPoints;
          let md2 = Infinity, ri2 = 0;
          for (let i = 0; i < navP.length; i++) {
            const d = (c.pos.x - navP[i].x) ** 2 + (c.pos.z - navP[i].z) ** 2;
            if (d < md2) { md2 = d; ri2 = i; }
          }
          const ahead = 5 + this.stuckCount * 3;
          const tp = navP[(ri2 + ahead) % navP.length];
          const nxt = navP[(ri2 + ahead + 3) % navP.length];
          c.pos.x = tp.x; c.pos.z = tp.z;
          c.hdg = Math.atan2(nxt.x - tp.x, nxt.z - tp.z);
          c.spd = 3; c.isReversing = false; c.revSpd = 0; this.stuckCount = 0;
        }
      }
      return;
    }

    // Trigger reverse when stuck for >1.5 s
    if (this.slowTimer > 1.5 && this.revMode === 'none') {
      this.revMode = 'braking'; this.revTimer = 0;
      this.revSteer = (Math.random() > 0.5 ? 1 : -1) * 0.9;
      c.stuckTimer = 0;
      return;
    }

    // ── Waypoint navigation ──────────────────────────────────────────────────
    const useCity = !!cityAiPoints;
    const navPts = useCity ? cityAiPoints.pts : trackPoints;
    let md = Infinity, ci = 0;
    for (let i = 0; i < navPts.length; i++) {
      const d = (c.pos.x - navPts[i].x) ** 2 + (c.pos.z - navPts[i].z) ** 2;
      if (d < md) { md = d; ci = i; }
    }
    const n = navPts.length;
    const speedFrac = c.spd / c.data.maxSpd;
    const look = useCity ? Math.round(4 + speedFrac * 12) : Math.round(6 + speedFrac * 22);
    const ti = (ci + look) % n;
    const dh = Math.atan2(navPts[ti].x - c.pos.x, navPts[ti].z - c.pos.z);
    const he = ((dh - c.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    // ── Neural network ───────────────────────────────────────────────────────
    // sensors = 11 track-edge distances; edgeSensors = 7 wall distances
    const sensors = this._castRays(state.trkWallLeft || [], state.trkWallRight || []);
    const edgeSensors = this._castEdgeRays(state.trkWallLeft || [], state.trkWallRight || []);

    // Edge proximity: 0 = at track center, 1 = at/beyond edge
    const halfW = trackData ? trackData.rw * 0.5 : 999;
    const edgeProx = Math.min(1, Math.sqrt(md) / Math.max(1, halfW));
    // Gravel flag: 1 if on gravel, 0 otherwise
    const gravelFlag = c.onGravel ? 1.0 : 0.0;

    // Build input vector for the current architecture.
    // [24,5,3]: 11 track-edge + 7 wall + speed + wpt + edgeProx + grav + grip + acl = 24
    // Legacy models: inner 9 sensors (indices 1..9, skipping ±90°); edge sensors sliced to 3 (center)
    const sensors9 = sensors.slice(1, 10);
    const sensorsFull = sensors;
    const edgeSensors3 = edgeSensors.slice(2, 5); // -10°, 0°, +10° from the 7-angle wall array
    const extra6 = [speedFrac, Math.max(-1, Math.min(1, he / Math.PI)), edgeProx, gravelFlag, c.data.hdl, Math.min(1, c.data.accel / 12)];
    const inputs = this.layers[0] >= 24
      ? [...sensorsFull, ...edgeSensors, ...extra6]                          // 24 items (new default)
      : this.layers[0] >= 20
        ? [...sensorsFull, ...edgeSensors3, ...extra6]                       // 20 items (legacy)
        : this.layers[0] >= 17
          ? [...sensorsFull, ...extra6]                                      // 17 items (legacy)
          : this.layers[0] >= 15
            ? [...sensorsFull, speedFrac, Math.max(-1, Math.min(1, he / Math.PI)), edgeProx, gravelFlag]   // 15 items
            : this.layers[0] >= 13
              ? [...sensors9, speedFrac, Math.max(-1, Math.min(1, he / Math.PI)), edgeProx, gravelFlag]    // 13 items
              : [...sensors9, speedFrac, Math.max(-1, Math.min(1, he / Math.PI))];                         // 11 items

    const [nnSteer, thrMod] = this._forward(inputs);
    // throttle output: tanh [-1,1]; positive = accelerate, negative = brake
    const nnBrake = thrMod < 0 ? -thrMod : 0;

    let str = Math.max(-1, Math.min(1, nnSteer));

    // ── Throttle & brake ──────────────────────────────────────────────────────
    let thr = thrMod > 0 ? thrMod : 0;
    let brk = nnBrake;
    thr *= 0.85 + thrMod * 0.25;
    if (c.onGravel) thr = Math.min(thr, 0.7);
    thr *= c.data.aiSpd * c.aiAgg * 1.15;
    thr = Math.min(1, Math.max(0, thr));

    c.update({ thr, brk: Math.min(1, brk), str }, dt);
  }
}
