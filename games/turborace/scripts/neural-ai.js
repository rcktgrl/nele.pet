'use strict';
import { state } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Default hand-designed weights (module-level constants used as fallback)
// ─────────────────────────────────────────────────────────────────────────────

// W1[h][i] = weight from input i to hidden node h
const _W1 = [
  //      s0    s1    s2    s3    s4   spd  wperr
  [-2.0, -3.0, -0.5,  0.5,  0.3,  0.0,  0.0], // H0 danger-left
  [ 0.3,  0.5, -0.5, -3.0, -2.0,  0.0,  0.0], // H1 danger-right
  [ 0.0, -0.5, -3.0, -0.5,  0.0,  0.0,  0.0], // H2 danger-ahead
  [ 0.8,  0.8,  1.5,  0.8,  0.8,  1.5,  0.0], // H3 open-track
  [ 0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  2.0], // H4 waypoint-err
];
const _b1 = [1.0, 1.0, 1.5, -4.0, 0.0];
const _W2 = [
  [ 1.2, -1.2,  0.0,  0.0,  1.5], // steer
  [-0.3, -0.3, -1.5,  1.5,  0.0], // throttle
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

const RAY_ANGLES = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3];
const RAY_DIST = 35;

// ─────────────────────────────────────────────────────────────────────────────
//  NeuralAI
// ─────────────────────────────────────────────────────────────────────────────
export class NeuralAI {
  // genome: optional flat Float64 array of 52 weights.
  //   If omitted, checks localStorage for saved trained weights.
  //   Falls back to hand-designed defaults.
  constructor(car, la, context, genome = null) {
    this.car = car;
    this.la = la || 0.055;
    this.slowTimer = 0;
    this.prevPos = null;
    this.stuckCount = 0;
    this.context = context;

    if (genome) {
      const w = NeuralAI._unpack(genome);
      this.W1 = w.W1; this.b1 = w.b1; this.W2 = w.W2; this.b2 = w.b2;
    } else {
      // Try to use saved trained weights; otherwise use hand-designed defaults
      const saved = localStorage.getItem('turborace_nn_weights');
      if (saved) {
        try {
          const w = NeuralAI._unpack(JSON.parse(saved));
          this.W1 = w.W1; this.b1 = w.b1; this.W2 = w.W2; this.b2 = w.b2;
        } catch (_) { this._useDefaults(); }
      } else {
        this._useDefaults();
      }
    }
  }

  _useDefaults() {
    this.W1 = _W1; this.b1 = _b1; this.W2 = _W2; this.b2 = _b2;
  }

  // Replace weights mid-life (used by the genetic trainer between generations).
  setWeights(genome) {
    const w = NeuralAI._unpack(genome);
    this.W1 = w.W1; this.b1 = w.b1; this.W2 = w.W2; this.b2 = w.b2;
  }

  // Unpack a flat 52-element genome into {W1, b1, W2, b2}.
  static _unpack(g) {
    let i = 0;
    const W1 = Array.from({ length: 5 }, () => Array.from({ length: 7 }, () => g[i++]));
    const b1 = Array.from({ length: 5 }, () => g[i++]);
    const W2 = Array.from({ length: 2 }, () => Array.from({ length: 5 }, () => g[i++]));
    const b2 = Array.from({ length: 2 }, () => g[i++]);
    return { W1, b1, W2, b2 };
  }

  _castRays(wallLeft, wallRight) {
    const c = this.car;
    const ox = c.pos.x, oz = c.pos.z;
    const rr = RAY_DIST * RAY_DIST * 1.5;
    const near = [];
    for (const walls of [wallLeft, wallRight]) {
      for (const w of walls) {
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
      return minT / RAY_DIST;
    });
  }

  _forward(inputs) {
    this.lastInputs = inputs;
    const h = this.W1.map((row, i) =>
      Math.tanh(row.reduce((s, w, j) => s + w * inputs[j], 0) + this.b1[i])
    );
    this.lastHidden = h;
    const out = this.W2.map((row, i) =>
      Math.tanh(row.reduce((s, w, j) => s + w * h[j], 0) + this.b2[i])
    );
    this.lastOutputs = out;
    return out;
  }

  update(dt) {
    const { trackPoints, trackCurvature, cityAiPoints, trackData } = this.context();
    if (!trackPoints.length || this.car.finished) return;
    const c = this.car;

    // ── Stuck detection ──────────────────────────────────────────────────────
    if (!this.prevPos) this.prevPos = { x: c.pos.x, z: c.pos.z };
    const moved = Math.sqrt((c.pos.x - this.prevPos.x) ** 2 + (c.pos.z - this.prevPos.z) ** 2);
    this.prevPos.x = c.pos.x; this.prevPos.z = c.pos.z;
    if (moved < 0.015 * dt * 60) this.slowTimer += dt;
    else { this.slowTimer = Math.max(0, this.slowTimer - dt * 3); this.stuckCount = 0; }

    if ((c.stuckTimer > 1.5 || this.slowTimer > 2.5) && state.gState !== 'training') {
      c.stuckTimer = 0; this.slowTimer = 0; this.stuckCount++;
      const navP = cityAiPoints ? cityAiPoints.pts : trackPoints;
      let md2 = Infinity, ri2 = 0;
      for (let i = 0; i < navP.length; i++) {
        const d = (c.pos.x - navP[i].x) ** 2 + (c.pos.z - navP[i].z) ** 2;
        if (d < md2) { md2 = d; ri2 = i; }
      }
      const ahead = 5 + this.stuckCount * 5;
      const tp = navP[(ri2 + ahead) % navP.length];
      const nxt = navP[(ri2 + ahead + 3) % navP.length];
      c.pos.x = tp.x; c.pos.z = tp.z;
      c.hdg = Math.atan2(nxt.x - tp.x, nxt.z - tp.z);
      c.spd = 3; c.isReversing = false; c.revSpd = 0;
      return;
    }

    // ── Waypoint navigation ──────────────────────────────────────────────────
    const useCity = !!cityAiPoints;
    const navPts = useCity ? cityAiPoints.pts : trackPoints;
    const navCurv = useCity ? cityAiPoints.curv : trackCurvature;
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
    const wpSteer = Math.max(-1, Math.min(1, he * 1.8));

    // ── Neural network ───────────────────────────────────────────────────────
    const sensors = this._castRays(state.trkWallLeft || [], state.trkWallRight || []);
    const inputs = [...sensors, speedFrac, Math.max(-1, Math.min(1, he / Math.PI))];
    const [nnSteer, thrMod] = this._forward(inputs);

    const fwdDanger = 1 - Math.min(sensors[1], sensors[2], sensors[3]);
    const nnBlend = 0.3 + fwdDanger * 0.5;
    let str = wpSteer * (1 - nnBlend) + nnSteer * nnBlend;
    str = Math.max(-1, Math.min(1, str));

    // Edge pull-back for open tracks
    if (!useCity && trackData) {
      const edgeDist = Math.sqrt(md);
      const wallDist = trackData.rw * 0.5;
      if (edgeDist > wallDist * 0.5) {
        const np = trackPoints[ci];
        const pullAngle = Math.atan2(np.x - c.pos.x, np.z - c.pos.z);
        const pullErr = ((pullAngle - c.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const gravelBoost = c.onGravel ? 2.2 : 1.0;
        const pushFactor = Math.min(1, (edgeDist - wallDist * 0.5) / (wallDist * 0.5));
        str = Math.max(-1, Math.min(1, str + pullErr * pushFactor * 1.5 * gravelBoost));
      }
    }

    // ── Braking (tighter 1.0× margin vs scripted AI's 1.2×) ─────────────────
    const ptSpacing = 2;
    const scanDist = Math.round(6 + speedFrac * 44);
    let reqBrake = 0;
    for (let k = 1; k < scanDist; k++) {
      const ki = (ci + k) % n;
      const curv = navCurv[ki];
      if (curv < 0.03) continue;
      const cornerSpd = c.data.maxSpd * c.data.hdl * (0.18 + 0.77 * (1 - curv));
      const dist = k * ptSpacing;
      const speedOver = c.spd - cornerSpd;
      if (speedOver > 0 && dist > 0) {
        const decel = (c.spd * c.spd - cornerSpd * cornerSpd) / (2 * dist);
        const brake = Math.min(1, decel / c.data.brake * 1.0);
        if (brake > reqBrake) reqBrake = brake;
      }
    }

    // ── Throttle ─────────────────────────────────────────────────────────────
    let thr = 1.0;
    let brk = reqBrake;
    if (brk > 0.05) thr = Math.min(thr, 1 - brk);
    thr *= 0.85 + thrMod * 0.25;
    if (c.onGravel) thr = Math.min(thr, 0.7);
    thr *= c.data.aiSpd * c.aiAgg * 1.15;
    thr = Math.min(1, Math.max(0, thr));

    c.update({ thr, brk: Math.min(1, brk), str }, dt);
  }
}
