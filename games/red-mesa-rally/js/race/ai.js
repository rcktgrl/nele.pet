'use strict';
/* Red Mesa Rally · AI driver */

/* ---------- AI driver ---------- */
class AIDriver {
  constructor(car, route, opts) {
    this.car = car; this.route = route; this.s = opts.s || 0; this.lane = opts.lane || 0; this.baseLane = this.lane;
    this.traffic = !!opts.traffic; this.vcap = opts.vcap || 99; this.metro = opts.metro || null;
    this.skill = opts.skill || 0.9; this.aggr = opts.aggr || 0.5; this.stuck = 0; this.bestS = 0; this.revT = 0; this.boostT = 0; this.respawn = false; this.rnd = mulberry32(opts.seed || 1);
    this._p = new V3(); this._l = new V3(); this._qi = new Q4();
  }
  update(dt, cars, rubber) {
    const c = this.car, R = this.route;
    if (c.wrecked) { c.input.throttle = 0; c.input.brake = 0; return; }
    if (c.frozen) { this.stuck = 0; this.bestS = this.s; }
    if (this.finished && !R.closed) { c.input.throttle = 0; c.input.brake = 1; c.input.boost = 0; c.input.steer = 0; this.stuck = 0; return; }
    const pr = R.project(c.pos.x, c.pos.z, this.s, 40);
    this.s = pr.s;
    const speed = c.vel.length();
    // avoidance: steer lane around cars ahead (traffic keeps its lane and queues instead)
    let want = this.baseLane; this.gap = 1e9;
    this.switchT = (this.switchT || 0) - dt;
    const train = this.metro ? this.dodgeTrains(speed, cars) : null;
    if (train) want = train.lane;
    if (!train) for (const o of cars) {
      if (o === c || o.asleep) continue;
      if (this.traffic) {
        const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z; if (dx * dx + dz * dz > 1600) continue;
        this._l.set(dx, 0, dz).applyQuaternion(this._qi.copy(c.q).invert());
        if (this._l.z < -1 && Math.abs(this._l.x) < 2.8) this.gap = Math.min(this.gap, -this._l.z);
        continue;
      }
      const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z; if (dx * dx + dz * dz > 400) continue;
      this._l.set(dx, 0, dz).applyQuaternion(this._qi.copy(c.q).invert());
      if (this._l.z < -2 && this._l.z > -18 && Math.abs(this._l.x) < 2.6) { want += this._l.x > 0 ? -3.2 : 3.2; if (this.aggr > 0.7 && o.isPlayer) want = this.baseLane + this._l.x * 0.6; }
    }
    const hw = R.width / 2 - (R.width < 14 ? 3 : 2.2);
    this.lane = lerp(this.lane, clamp(want, -hw, hw), 1 - Math.exp(-dt * (train ? 3 : 1.5)));
    const look = train ? 7 + speed * 0.45 : 9 + speed * 0.62; // the metro's walls hug the rails: aim closer so corners are not cut into them
    const p = R.posAt(this.s + look, this._p);
    const [dx, dz] = R.dirAt(this.s + look);
    p.x += -dz * this.lane; p.z += dx * this.lane;
    this._l.set(p.x - c.pos.x, 0, p.z - c.pos.z).applyQuaternion(this._qi.copy(c.q).invert());
    const ang = Math.atan2(this._l.x, -this._l.z);
    // countersteer: use velocity heading vs body
    const beta = 0;
    // pure pursuit: geometric steering angle, converted to input via the car's current steering range
    const ld = Math.max(4, Math.hypot(this._l.x, this._l.z));
    const wb = c.spec.wheels.zr - c.spec.wheels.zf;
    const delta = Math.atan(2 * wb * Math.sin(ang) / ld) * 1.15;
    const vF = Math.max(0, speed);
    const maxSteer = c.spec.steer / (1 + vF * vF / 520);
    let steer = clamp(delta / maxSteer, -1, 1);
    // speed planning
    let vmax = 92;
    const narrow = R.width < 12; // mountain roads: no run-off, so leave more margin
    const muG = (R.surface === 'asphalt' ? c.spec.aiGripAsph : c.spec.aiGrip) * (narrow ? 0.84 : 1), decel = narrow ? 5.2 : 6.5;
    const horizon = 25 + speed * 3.2;
    for (let d = 6; d < horizon; d += 6) {
      const k = Math.abs(R.curvAt(this.s + d)) + 1e-4;
      const vl = Math.sqrt(muG / k);
      const v = Math.sqrt(vl * vl + 2 * decel * Math.max(0, d - 6));
      if (v < vmax) vmax = v;
    }
    const kNow = Math.abs(R.curvAt(this.s + 4)) + 1e-4; vmax = Math.min(vmax, Math.sqrt(muG / kNow), narrow ? 37 : 92);
    // no braking in the air: arrive at jumps slow enough for whatever follows the landing
    if (R.jumps) for (const sj of R.jumps) {
      let dj = sj - this.s; if (R.closed && dj < -50) dj += R.length;
      if (dj < -10 || dj > horizon + 60) continue;
      let km = 1e-4; for (let d = 25; d <= 90; d += 5) km = Math.max(km, Math.abs(R.curvAt(sj + d)));
      const vl = Math.sqrt(muG / km);
      const v = Math.sqrt(vl * vl + 2 * 6.0 * Math.max(0, dj));
      if (v < vmax) vmax = v;
    }
    vmax *= this.skill * (rubber || 1);
    if (train) { if (train.brake < 1e9) vmax = Math.min(vmax, Math.sqrt(2 * 6.5 * Math.max(0, train.brake - 10))); vmax = Math.min(vmax, train.follow); }
    if (this.traffic) { vmax = Math.min(vmax, this.vcap); if (this.gap < 40) vmax = Math.min(vmax, Math.max(0, (this.gap - 9) * 0.7)); }
    if (c.surfaceMud > 0.3) vmax *= 0.92;
    if (pr.dist > R.width) { vmax = Math.min(vmax, 20); }
    this.dbg = { vmax, ang, beta, k: R.curvAt(this.s + 10) };
    let thr = speed < vmax ? 1 : 0, brk = speed > vmax + 1.5 ? clamp((speed - vmax) / 5, 0.2, 1) : 0;
    // throttle discipline: feed the power in gently while the car is sliding
    if (speed > 4) { const lat = c.vel.dot(this._l.set(1, 0, 0).applyQuaternion(c.q)); const beta = Math.abs(lat) / speed; if (beta > 0.06) thr *= clamp(1 - (beta - 0.06) * 6, 0.2, 1); if (Math.abs(steer) > 0.85 && speed < 20) thr *= 0.6; }
    // recovery
    if (this.s > this.bestS + 1 || (R.closed && this.s < this.bestS - R.length / 2)) { this.bestS = this.s; this.stuck = 0; } else this.stuck += dt;
    if (speed > 3) this.stuck = Math.max(0, this.stuck - dt * 0.5);
    if (this.traffic && (this.gap < 22 || (!R.closed && this.s > R.length - 40))) this.stuck = 0; // queueing, not stuck
    if (this.revT > 0) { this.revT -= dt; thr = 0; brk = 1; steer = -steer; }
    else if (this.stuck > 2.5 && speed < 1.5) { this.revT = 1.4; }
    if (this.stuck > 6) { this.respawn = true; this.stuck = 0; }
    // boost
    this.boostT -= dt;
    let boost = 0;
    if (!this.traffic && c.heat < 0.45 + this.aggr * 0.35 && vmax > speed + 6 && Math.abs(ang) < 0.12 && c.onGround) boost = 1;
    if (boost && this.boostT < 0) { this.boostT = 0.5 + this.rnd() * 1.5; }
    c.input.throttle = thr; c.input.brake = brk; c.input.steer = steer; c.input.boost = boost; c.input.handbrake = 0;
  }
}

/* the metro: ride whichever track has no train bearing down on it, pass slower cars on the other track when it is clear,
   and stop short if neither track has room */
AIDriver.prototype.dodgeTrains = function (speed, cars) {
  const R = this.route, L = R.length, tracks = METRO.tracks, ttc = tracks.map(() => 1e9), gap = tracks.map(() => 1e9);
  const wrap = (d) => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d), trackOf = (lat) => (Math.abs(lat - tracks[0]) < Math.abs(lat - tracks[1]) ? 0 : 1);
  for (const tr of this.metro) {
    const k = tracks.indexOf(tr.lat), vt = tr.dir * tr.v; if (k < 0) continue;
    let lo = 1e9, hi = -1e9;
    for (const c of tr.cars) {
      const pr = R.project(c.pose.x, c.pose.z, this.s, 260); if (pr.dist > 6) continue;
      const d = wrap(pr.s - this.s); lo = Math.min(lo, d - c.len / 2); hi = Math.max(hi, d + c.len / 2);
    }
    if (lo > hi) continue;
    let t = 1e9;
    if (lo < 3 && hi > -3) t = 0; // alongside
    else if (lo >= 3) { gap[k] = Math.min(gap[k], lo); if (speed - vt > 0.1) t = (lo - 3) / (speed - vt); }
    else if (vt - speed > 0.1) t = (-hi - 3) / (vt - speed); // catching us up from behind
    ttc[k] = Math.min(ttc[k], t);
  }
  // the other cars: who is beside us on each track, and who is ahead on it
  const busy = [false, false], carGap = [1e9, 1e9], carV = [0, 0];
  for (const o of cars) {
    if (o === this.car || o.asleep) continue;
    const dx = o.pos.x - this.car.pos.x, dz = o.pos.z - this.car.pos.z; if (dx * dx + dz * dz > 2500) continue;
    const pr = R.project(o.pos.x, o.pos.z, this.s, 60), d = wrap(pr.s - this.s), k = trackOf(pr.lat);
    if (d > -8 && d < 10) busy[k] = true;
    if (d > 3 && d < carGap[k]) { carGap[k] = d; carV[k] = o.wrecked ? 0 : o.vel.length(); }
  }
  if (this.track === undefined) this.track = trackOf(this.baseLane);
  let o = 1 - this.track;
  if (ttc[this.track] < 4.5 && ttc[o] > ttc[this.track] + 1 && (!busy[o] || ttc[this.track] < 1.8)) { this.track = o; this.switchT = 2.5; }
  else if (this.switchT <= 0 && carGap[this.track] < 28 && carV[this.track] < speed - 1 && ttc[o] > 6 && !busy[o] && carGap[o] > carGap[this.track] + 10) { this.track = o; this.switchT = 2.5; }
  o = 1 - this.track;
  const boxed = ttc[this.track] < 3 && ttc[o] < 3, cg = carGap[this.track];
  return { lane: tracks[this.track], brake: boxed ? gap[this.track] : 1e9, follow: cg < 45 ? carV[this.track] + Math.max(0, cg - 8) * 0.6 : 1e9 };
};
