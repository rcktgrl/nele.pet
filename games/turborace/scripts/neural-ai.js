'use strict';
import { state } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Pre-designed neural network weights
//
//  Architecture: 7 inputs → 5 hidden (tanh) → 2 outputs (tanh)
//
//  Inputs  [0-4]: distance sensor rays at -60°,-30°,0°,+30°,+60° from heading
//                 (normalized: 1.0 = clear, ~0 = wall right there)
//  Input   [5]  : speed fraction (car.spd / car.data.maxSpd)
//  Input   [6]  : heading error to waypoint, normalized to (-1, 1)
//
//  Outputs [0]  : steer correction  (-1 = left, +1 = right)
//  Outputs [1]  : throttle modifier  (maps to 0.6–1.1 multiplier)
//
//  Hidden nodes:
//   H0 – danger left  : activates when left-side sensors detect a nearby wall
//   H1 – danger right : activates when right-side sensors detect a nearby wall
//   H2 – danger ahead : activates when centre ray is blocked
//   H3 – open track   : activates when all rays are clear at high speed
//   H4 – waypoint err : tracks heading error to the next waypoint
// ─────────────────────────────────────────────────────────────────────────────

// W1[h][i] = weight from input i to hidden node h
const W1 = [
  //      s0    s1    s2    s3    s4   spd  wperr
  [-2.0, -3.0, -0.5,  0.5,  0.3,  0.0,  0.0], // H0 danger-left
  [ 0.3,  0.5, -0.5, -3.0, -2.0,  0.0,  0.0], // H1 danger-right
  [ 0.0, -0.5, -3.0, -0.5,  0.0,  0.0,  0.0], // H2 danger-ahead
  [ 0.8,  0.8,  1.5,  0.8,  0.8,  1.5,  0.0], // H3 open-track
  [ 0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  2.0], // H4 waypoint-err
];
const b1 = [1.0, 1.0, 1.5, -4.0, 0.0];

// W2[o][h] = weight from hidden node h to output o
const W2 = [
  //     H0    H1    H2    H3    H4
  [ 1.2, -1.2,  0.0,  0.0,  1.5], // steer  : L-danger→right, R-danger→left, wp
  [-0.3, -0.3, -1.5,  1.5,  0.0], // throttle: wall-ahead→slow, open→fast
];
const b2 = [0.0, 0.5];

// ─── Ray-segment intersection ──────────────────────────────────────────────
// Returns t ≥ 0 (distance along ray) if the ray hits the segment, else -1.
function raySegment(ox, oz, dx, dz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const det = dx * ez - dz * ex;
  if (Math.abs(det) < 1e-8) return -1; // parallel
  const fx = ax - ox, fz = az - oz;
  const t = (fx * ez - fz * ex) / det;
  const s = (dz * fx - dx * fz) / det;
  if (t >= 0 && s >= 0 && s <= 1) return t;
  return -1;
}

const RAY_ANGLES = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3];
const RAY_DIST = 35; // metres

export class NeuralAI {
  constructor(car, la, context) {
    this.car = car;
    this.la = la || 0.055;
    this.slowTimer = 0;
    this.prevPos = null;
    this.stuckCount = 0;
    this.context = context;
  }

  // Cast 5 rays and return normalised distances (1=clear, ~0=wall).
  _castRays(wallLeft, wallRight) {
    const c = this.car;
    const ox = c.pos.x, oz = c.pos.z;
    const rr = RAY_DIST * RAY_DIST * 1.5;

    // Prefilter to only segments close to the car.
    const near = [];
    for (const walls of [wallLeft, wallRight]) {
      for (const w of walls) {
        const cx = (w.x0 + w.x1) * 0.5 - ox;
        const cz = (w.z0 + w.z1) * 0.5 - oz;
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
      return minT / RAY_DIST; // 1 = no wall in range, 0 = wall at car
    });
  }

  // Forward pass through the two-layer network.
  _forward(inputs) {
    const h = W1.map((row, i) =>
      Math.tanh(row.reduce((s, w, j) => s + w * inputs[j], 0) + b1[i])
    );
    return W2.map((row, i) =>
      Math.tanh(row.reduce((s, w, j) => s + w * h[j], 0) + b2[i])
    );
  }

  update(dt) {
    const { trackPoints, trackCurvature, cityAiPoints, trackData } = this.context();
    if (!trackPoints.length || this.car.finished) return;
    const c = this.car;

    // ── Stuck detection (identical to scripted AI) ──────────────────────────
    if (!this.prevPos) this.prevPos = { x: c.pos.x, z: c.pos.z };
    const moved = Math.sqrt(
      (c.pos.x - this.prevPos.x) ** 2 + (c.pos.z - this.prevPos.z) ** 2
    );
    this.prevPos.x = c.pos.x; this.prevPos.z = c.pos.z;
    if (moved < 0.015 * dt * 60) this.slowTimer += dt;
    else { this.slowTimer = Math.max(0, this.slowTimer - dt * 3); this.stuckCount = 0; }

    if (c.stuckTimer > 1.5 || this.slowTimer > 2.5) {
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
    const tgtX = navPts[ti].x, tgtZ = navPts[ti].z;
    const dh = Math.atan2(tgtX - c.pos.x, tgtZ - c.pos.z);
    const he = ((dh - c.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const wpSteer = Math.max(-1, Math.min(1, he * 1.8));

    // ── Neural network ──────────────────────────────────────────────────────
    const wallLeft = state.trkWallLeft || [];
    const wallRight = state.trkWallRight || [];
    const sensors = this._castRays(wallLeft, wallRight);
    // Normalise heading error to (−1, 1) for network input.
    const inputs = [...sensors, speedFrac, Math.max(-1, Math.min(1, he / Math.PI))];
    const [nnSteer, thrMod] = this._forward(inputs);

    // Blend waypoint steering with sensor-driven correction.
    // The closer a wall is dead-ahead, the more we trust the sensor network.
    const fwdDanger = 1 - Math.min(sensors[1], sensors[2], sensors[3]);
    const nnBlend = 0.3 + fwdDanger * 0.5; // 0.3 (open) → 0.8 (wall close ahead)
    let str = wpSteer * (1 - nnBlend) + nnSteer * nnBlend;
    str = Math.max(-1, Math.min(1, str));

    // Edge pull-back for open tracks (same as scripted AI).
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

    // ── Braking (lookahead physics, tighter 1.0× margin vs scripted 1.2×) ──
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
        const brake = Math.min(1, decel / c.data.brake * 1.0); // tighter than scripted AI
        if (brake > reqBrake) reqBrake = brake;
      }
    }

    // ── Throttle ─────────────────────────────────────────────────────────────
    let thr = 1.0;
    let brk = reqBrake;
    if (brk > 0.05) thr = Math.min(thr, 1 - brk);

    // Neural throttle modifier: maps thrMod ∈ (-1,1) → scale ∈ (0.6, 1.1)
    thr *= 0.85 + thrMod * 0.25;

    if (c.onGravel) thr = Math.min(thr, 0.7);

    // Full aggression — no rubber-banding for the neural AI.
    thr *= c.data.aiSpd * c.aiAgg * 1.15;
    thr = Math.min(1, Math.max(0, thr));

    c.update({ thr, brk: Math.min(1, brk), str }, dt);
  }
}
