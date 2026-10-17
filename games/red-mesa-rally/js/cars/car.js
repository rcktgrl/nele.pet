'use strict';
/* Red Mesa Rally · Car physics */

function engineCurve(f) { // f = rpm/redline → torque fraction
  const t = [0.52, 0.72, 0.88, 0.98, 1.0, 0.93, 0.8];
  const x = clamp(f, 0, 1) * 6, i = Math.min(5, Math.floor(x));
  return lerp(t[i], t[i + 1], x - i);
}

const _v1 = typeof THREE !== 'undefined' ? null : null;
let V3, Q4, EU;
function coreInit(THREE_) { V3 = THREE_.Vector3; Q4 = THREE_.Quaternion; EU = THREE_.Euler; }

class Car {
  constructor(spec, opts = {}) {
    this.spec = spec; this.id = opts.id || 0; this.name = opts.name || spec.name; this.isPlayer = !!opts.player;
    this.color = opts.color || spec.color;
    this.pos = new V3(); this.vel = new V3(); this.q = new Q4(); this.w = new V3();
    const [W, H, L] = spec.dims, m = spec.mass;
    this.invI = new V3(1 / (m / 12 * (H * H + L * L) * 0.9), 1 / (m / 12 * (W * W + L * L) * 0.9), 1 / (m / 12 * (W * W + H * H) * 0.9));
    const ws = spec.wheels;
    this.wheels = [];
    for (const [front, left] of [[1, 1], [1, 0], [0, 1], [0, 0]]) {
      const driven = spec.drive.type === 'awd' || (spec.drive.type === 'rwd' ? !front : front);
      this.wheels.push({ lx: left ? -ws.x : ws.x, ly: ws.y, lz: front ? ws.zf : ws.zr, front: !!front, left: !!left, driven,
        omega: 0, spin: 0, comp: 0, compPrev: 0, contact: false, t: 0, fz: 0, slip: 0, slipLat: 0, sx: 0, sy: 0,
        cp: new V3(), n: new V3(0, 1, 0), surf: null, steer: 0, fx: 0, fy: 0, water: false });
    }
    this.nDriven = this.wheels.filter((w) => w.driven).length;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 };
    this.gear = 1; this.rpm = spec.engine.idle; this.shiftT = 0; this.reverse = false; this.revTimer = 0;
    this.heat = 0; this.steerAngle = 0; this.boosting = false; this.airTime = 0; this.onGround = false; this.wrecked = false;
    this.wreckT = 0; this.wreckReason = ''; this.lastHit = null; this.lastHitT = 0; this.impact = 0; this.landing = 0;
    this.frozen = false; this.invuln = 0; this.inWater = 0; this.surfaceMud = 0; this.speedKmh = 0; this.slipAmount = 0; this.events = [];
    this._t = { a: new V3(), b: new V3(), c: new V3(), d: new V3(), e: new V3(), f: new V3(), g: new V3(), F: new V3(), T: new V3(), right: new V3(), up: new V3(), fwd: new V3(), qi: new Q4() };
  }
  reset(x, z, yaw, T, lift = 0.6, y) { // y: roughly where the car goes, which picks the metro or the street above it
    if (y !== undefined && T.probeY !== y + 1) { T.probe(y + 1, () => this.reset(x, z, yaw, T, lift)); this.under = y + 1 < METRO.under && T.metroAt(x, z) > 0; return; }
    const sp = this.spec;
    if (sp.boat) { // afloat (or sat on the slipway) at ride height
      this.pos.set(x, Math.max(T.height(x, z) + 0.6, WATER_Y + sp.boat.ride) + lift * 0.3, z);
      this.q.setFromAxisAngle(new V3(0, 1, 0), yaw); this.boatYaw = yaw;
      this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
      this.heat = Math.min(this.heat, 0.3); this.invuln = 3; this.wrecked = false; this.wreckT = 0; this.gear = 1; this.reverse = false; this.rpm = sp.engine.idle; this.airTime = 0;
      return;
    }
    const groundY = T.height(x, z);
    const restCom = -(sp.wheels.y - (sp.susp.rest - sp.mass * 9.81 / 4 / sp.susp.k) - sp.wheels.r);
    this.pos.set(x, groundY + restCom + lift, z);
    this.q.setFromAxisAngle(new V3(0, 1, 0), yaw);
    // align roughly to slope
    const n = T.normal(x, z, new V3());
    const align = new Q4().setFromUnitVectors(new V3(0, 1, 0), n);
    this.q.premultiply(align);
    this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.comp = w.compPrev = 0; w.contact = false; }
    this.heat = Math.min(this.heat, 0.3); this.invuln = 3; this.wrecked = false; this.wreckT = 0; this.gear = 1; this.reverse = false; this.rpm = sp.engine.idle; this.airTime = 0;
  }
  yaw() { const f = new V3(0, 0, -1).applyQuaternion(this.q); return Math.atan2(-f.x, -f.z); }
  forward(out) { return out.set(0, 0, -1).applyQuaternion(this.q); }
  applyImpulse(J, p) { // world impulse J at world point p
    const m = this.spec.mass; this.vel.addScaledVector(J, 1 / m);
    const r = this._t.e.subVectors(p, this.pos); const tq = this._t.f.crossVectors(r, J);
    this.w.add(this.invIWorld(tq, tq));
  }
  invIWorld(v, out) { // out = I^-1_world * v
    const qi = this._t.qi.copy(this.q).invert();
    out.copy(v).applyQuaternion(qi); out.x *= this.invI.x; out.y *= this.invI.y; out.z *= this.invI.z; return out.applyQuaternion(this.q);
  }
  wreck(reason, T) {
    if (this.wrecked || this.invuln > 0) return;
    this.wrecked = true; this.wreckT = 0; this.wreckReason = reason; this.events.push({ type: 'wreck', reason });
    if (reason !== 'drowned') { // the blast throws the chassis
      const r = () => Math.random() - 0.5;
      this.vel.y += reason === 'overheat' ? 7 : 3.5; this.vel.x *= 0.7; this.vel.z *= 0.7;
      this.w.set(this.w.x + r() * 5, this.w.y + r() * 3, this.w.z + r() * 6);
    }
  }
  /* boats: buoyant hull, thrust from the outboards, a keel that resists sideways motion */
  stepBoat(dt, W) {
    const sp = this.spec, B = sp.boat, T = W.terrain, inp = this.input;
    if (this.boatYaw === undefined) this.boatYaw = this.yaw();
    // collisions spin the hull through w.y; the keel damps the rest
    this.boatYaw += this.w.y * dt;
    const yaw = this.boatYaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const vF = this.vel.x * fx + this.vel.z * fz, vR = this.vel.x * rx + this.vel.z * rz;
    this.speedKmh = Math.abs(vF) * 3.6;
    let thr = this.frozen || this.wrecked ? 0 : inp.throttle, brk = this.frozen || this.wrecked ? 0 : inp.brake;
    if (!this.reverse && brk > 0.3 && thr < 0.1 && vF < 1) this.reverse = true; else if (this.reverse && thr > 0.3) this.reverse = false;
    const drive = this.reverse ? -brk * 0.45 : thr;
    // where is the hull: afloat, grounded or flying
    const hl = sp.hull.hz * 0.85;
    const keelY = this.pos.y - 0.45;
    let gMax = -1e9;
    for (const k of [-1, 0, 1]) {
      const g = T.height(this.pos.x + fx * hl * k, this.pos.z + fz * hl * k), v = vF * k;
      if (k && g > keelY + 0.6) { // a quay, bank or step too tall to ride up: bounce off it
        if (v > 0) { this.vel.x -= fx * vF * 1.4; this.vel.z -= fz * vF * 1.4; if (v > 3) { this.impact = Math.max(this.impact, v); this.events.push({ type: 'hit', v, kind: 'quay' }); if (v > sp.tough) this.wreck('crash'); } }
        continue;
      }
      if (!k) gMax = g; // the hull rides on what is under its middle
    }
    const rideY = WATER_Y + B.ride + 0.05 * Math.sin(W.time * 1.6 + this.pos.x * 0.05 + this.pos.z * 0.03);
    const afloat = keelY < WATER_Y + 0.3 && gMax < WATER_Y - 0.2, grounded = keelY <= gMax + 0.05;
    this.inWater = afloat ? 1 : 0; this.surfaceMud = 0;
    this.onGround = afloat || grounded;
    const boostOn = !this.wrecked && !this.frozen && inp.boost && this.heat < 1 && drive > 0.05 && (afloat || grounded);
    this.boosting = boostOn;
    if (boostOn) this.heat += sp.boost.heat * dt; else this.heat = Math.max(0, this.heat - (0.16 + (afloat ? 0.1 : 0)) * dt);
    if (this.heat >= 1 && !this.wrecked) { this.heat = 1; this.wreck('overheat'); }
    // vertical: gravity, buoyancy toward ride height, ground contact
    this.vel.y -= 9.81 * dt;
    if (this.pos.y < rideY + 0.6) {
      const sub = clamp(rideY + 0.6 - this.pos.y, 0, 1.5);
      if (this.pos.y < rideY) this.vel.y += (rideY - this.pos.y) * 60 * dt;
      if (sub > 0.2) { if (this.airTime > 0.6) this.events.push({ type: 'land', air: this.airTime }); this.vel.y *= Math.exp(-6 * dt); }
    }
    if (grounded) {
      if (this.pos.y < gMax + 0.45) { this.pos.y = gMax + 0.45; if (this.vel.y < 0) { if (this.vel.y < -6) this.events.push({ type: 'land', air: this.airTime }); this.vel.y = 0; } }
      const n = T.normal(this.pos.x, this.pos.z, this._t.a); this.vel.x += n.x * 9.81 * dt * 0.9; this.vel.z += n.z * 9.81 * dt * 0.9; // slide down slipways
    }
    if (afloat || grounded) this.airTime = 0; else this.airTime += dt;
    // propulsion and drag
    const push = (afloat ? 1 : grounded ? 0.18 : 0) * B.thrust * (boostOn ? 1 + sp.boost.force / B.thrust : 1) * drive;
    let aF = push - (afloat ? B.drag * vF * Math.abs(vF) + (brk > 0 && !this.reverse ? 2.5 * Math.sign(vF) * brk : 0) + 0.15 * vF : 0);
    let aR = 0;
    if (afloat) aR = -vR * B.keel * (inp.handbrake > 0.5 ? 0.25 : 1);
    if (grounded && !afloat) { const slick = Math.abs(this.pos.x - SLIP.x) < SLIP.hw + 2 && this.pos.z > SLIP.z0 ? 0.5 : 1.8; aF -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, slick); aR = -Math.sign(vR) * Math.min(Math.abs(vR) / dt, slick * 2); }
    this.vel.x += (fx * aF + rx * aR) * dt; this.vel.z += (fz * aF + rz * aR) * dt;
    // steering: rudder needs flow, outboards give a little at rest
    const flow = clamp(vF / 7, -1, 1);
    const wantW = -(this.frozen ? 0 : inp.steer) * B.turn * (afloat ? flow * (inp.handbrake > 0.5 ? 1.35 : 1) + 0.28 * Math.sign(drive || 1) * (1 - Math.abs(flow)) : grounded ? flow * 0.3 : 0);
    this.w.y += (wantW - this.w.y) * (1 - Math.exp(-dt * (afloat ? 3.2 : 6)));
    this.w.x = 0; this.w.z = 0;
    this.steerAngle = inp.steer * 0.4;
    // planing attitude: bow up with speed, lean into the turn
    const plane = afloat ? clamp(Math.abs(vF) / 20, 0, 1) : 0;
    const pitch = afloat ? plane * 0.075 - (boostOn ? -0.02 : 0) : grounded ? 0 : clamp(Math.atan2(this.vel.y, Math.max(2, Math.abs(vF))) * 0.6, -0.5, 0.4);
    const roll = afloat ? -inp.steer * plane * 0.14 + clamp(vR * 0.02, -0.08, 0.08) : 0;
    this.q.setFromEuler((this._eu || (this._eu = new EU())).set(pitch, yaw, roll, 'YXZ'));
    this.pos.addScaledVector(this.vel, dt);
    // engine note follows the props
    const E = sp.engine; this.gear = 1;
    this.rpm = lerp(this.rpm, E.idle + (E.red - E.idle) * clamp(Math.abs(drive) * (afloat ? 0.55 : 0.8) + Math.abs(vF) / 30 * 0.45, 0, 1), 1 - Math.exp(-dt * 5));
    const bm = 40;
    if (this.pos.x < WORLD.x0 + bm) { this.pos.x = WORLD.x0 + bm; this.vel.x = Math.abs(this.vel.x) * 0.3; }
    if (this.pos.x > WORLD.x1 - bm) { this.pos.x = WORLD.x1 - bm; this.vel.x = -Math.abs(this.vel.x) * 0.3; }
    if (this.pos.z < WORLD.z0 + bm) { this.pos.z = WORLD.z0 + bm; this.vel.z = Math.abs(this.vel.z) * 0.3; }
    if (this.pos.z > WORLD.z1 - bm) { this.pos.z = WORLD.z1 - bm; this.vel.z = -Math.abs(this.vel.z) * 0.3; }
    for (const w of this.wheels) { w.contact = false; w.omega = 0; }
    if (this.wrecked) this.wreckT += dt;
    if (this.invuln > 0) this.invuln -= dt;
  }
  step(dt, W) {
    if (this.spec.boat) { this.stepBoat(dt, W); return; }
    const sp = this.spec, m = sp.mass, t = this._t, T = W.terrain;
    const right = t.right.set(1, 0, 0).applyQuaternion(this.q), up = t.up.set(0, 1, 0).applyQuaternion(this.q), fwd = t.fwd.set(0, 0, -1).applyQuaternion(this.q);
    const F = t.F.set(0, -9.81 * m, 0), Tq = t.T.set(0, 0, 0);
    const inp = this.input;
    const vF = this.vel.dot(fwd), speed = this.vel.length();
    this.speedKmh = Math.abs(vF) * 3.6;
    let throttle = this.frozen ? 0 : inp.throttle, brake = this.frozen ? 1 : inp.brake;
    if (this.wrecked) { throttle = 0; brake = 0.3; }
    // auto reverse logic
    if (this.frozen) { this.reverse = false; this.revTimer = 0; }
    else if (!this.reverse) {
      if (brake > 0.3 && throttle < 0.1 && vF < 0.8) { this.revTimer += dt; if (this.revTimer > 0.25) { this.reverse = true; this.revTimer = 0; } } else this.revTimer = 0;
    } else {
      if (throttle > 0.3 && vF > -0.8) { this.reverse = false; this.gear = 1; }
    }
    let drive = throttle, brk = brake;
    if (this.reverse) { drive = brake; brk = throttle; }
    if (!this.wrecked && drive < 0.05 && brk < 0.05 && Math.abs(vF) < 1.5) brk = 0.6; // hill hold
    // steering (speed sensitive, rate limited)
    const vs = Math.max(0, Math.abs(vF));
    const maxSteer = sp.steer / (1 + vs * vs / 520);
    let target = inp.steer * maxSteer;
    // countersteer assist: front wheels follow the slide direction (helps hold drifts)
    if (vs > 3 && this.onGround) {
      const lvx = this.vel.dot(right), beta = Math.atan2(lvx, Math.max(vs, 0.1));
      const ex = Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.1);
      target += clamp(ex * 0.8, -sp.steer * 0.7, sp.steer * 0.7);
      target = clamp(target, -sp.steer, sp.steer);
    }
    this.steerAngle += clamp(target - this.steerAngle, -3.2 * dt, 3.2 * dt);
    // ---- engine / gearbox ----
    const E = sp.engine, nG = E.gears.length;
    const ratio = this.reverse ? -E.rev * E.final : E.gears[this.gear - 1] * E.final;
    let wAvg = 0; for (const w of this.wheels) if (w.driven) wAvg += w.omega; wAvg /= this.nDriven;
    const rpmW = Math.abs(wAvg * ratio) * 60 / TAU;
    let clutchSlip = false;
    if (rpmW < E.idle * 1.15) { clutchSlip = true; this.rpm = lerp(this.rpm, E.idle + drive * (E.red * 0.42 - E.idle), 1 - Math.exp(-dt * 8)); }
    else this.rpm = rpmW;
    if (this.shiftT > 0) this.shiftT -= dt;
    else if (!this.reverse) {
      if (this.rpm > E.red * 0.94 && this.gear < nG && this.onGround) { this.gear++; this.shiftT = 0.16; }
      else if (this.gear > 1 && this.rpm < E.red * 0.5 && rpmW * E.gears[this.gear - 2] / E.gears[this.gear - 1] < E.red * 0.86) { this.gear--; this.shiftT = 0.12; }
    }
    let engT;
    const boostOn = !this.wrecked && !this.frozen && inp.boost && this.heat < 1 && drive > 0.05 && !this.reverse;
    this.boosting = boostOn;
    if (this.rpm >= E.red) engT = 0;
    else engT = E.torque * engineCurve(this.rpm / E.red) * drive;
    if (drive < 0.05 && !clutchSlip) engT = -E.torque * 0.14 * (this.rpm / E.red);
    if (this.shiftT > 0) engT *= 0.1;
    if (boostOn) engT *= 1.45;
    const wheelT = engT * ratio * 0.88; // at the axle total
    const Ieng = clutchSlip ? 0 : E.inertia * ratio * ratio;
    // ---- wheels: raycast ----
    const anchor = t.a, down = t.b.copy(up).negate();
    const rest = sp.susp.rest, R = sp.wheels.r, maxT = rest + R;
    let nContact = 0;
    this.inWater = 0; this.surfaceMud = 0;
    for (const w of this.wheels) {
      anchor.set(w.lx, w.ly, w.lz).applyQuaternion(this.q).add(this.pos);
      w.compPrev = w.comp; w.contact = false;
      if (down.y > -0.25) { w.comp = 0; continue; }
      const g = (tt) => anchor.y + down.y * tt - T.height(anchor.x + down.x * tt, anchor.z + down.z * tt);
      const gMax = g(maxT);
      if (gMax > 0) { w.comp = 0; continue; }
      let tt;
      const g0 = g(0);
      if (g0 <= 0) tt = 0;
      else { let a = 0, b = maxT, ga = g0, gb = gMax; tt = b; for (let it = 0; it < 8; it++) { const mid = a + (b - a) * ga / (ga - gb); const gm = g(mid); tt = mid; if (Math.abs(gm) < 1e-4) break; if (gm > 0) { a = mid; ga = gm; } else { b = mid; gb = gm; } } }
      w.t = tt; w.comp = rest - Math.max(0, tt - R); w.contact = true; nContact++;
      w.cp.copy(anchor).addScaledVector(down, tt);
      T.normal(w.cp.x, w.cp.z, w.n);
    }
    this.onGround = nContact > 0;
    // anti-roll
    const arb = [0, 0, 0, 0];
    for (let a = 0; a < 2; a++) { const L = this.wheels[a * 2], Rw = this.wheels[a * 2 + 1]; const d = (L.comp - Rw.comp) * sp.susp.arb; if (L.contact) arb[a * 2] += d; if (Rw.contact) arb[a * 2 + 1] -= d; }
    // ---- wheel forces ----
    let slipSum = 0;
    const B = 1.865, C = 1.45, SP = 0.12;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      let share = 0;
      if (w.driven) share = sp.drive.type === 'awd' ? (w.front ? sp.drive.front : 1 - sp.drive.front) * 0.5 : 0.5;
      let Td = wheelT * share; const Ieff = sp.wheels.I + Ieng * share;
      if (Td > 0 && (w.rho || 0) > 1.15) Td *= clamp(1 - (w.rho - 1.15) * 0.9, this.isPlayer ? 0.45 : 0.3, 1); // soft traction control
      w.steer = w.front ? this.steerAngle : 0;
      if (!w.contact) {
        w.fz = 0; w.fx = w.fy = 0; w.rho = 0;
        w.omega += dt * Td / Ieff;
        const bT = (brk * sp.brake + (w.front ? 0 : inp.handbrake * sp.hbrake)) * dt / Ieff + 0.3 * dt;
        w.omega = Math.abs(w.omega) <= bT ? 0 : w.omega - Math.sign(w.omega) * bT;
        w.slip = 0; w.slipLat = 0;
        continue;
      }
      // suspension
      const compVel = (w.comp - w.compPrev) / dt;
      let damp = sp.susp.c * compVel; const dmax = m * 9.81 * 1.6; damp = clamp(damp, -dmax, dmax);
      let Fs = sp.susp.k * w.comp + damp + arb[i];
      if (w.comp > rest * 0.82) Fs += sp.susp.k * 9 * (w.comp - rest * 0.82);
      if (Fs < 0) Fs = 0;
      w.fz = Fs;
      const surf = W.surface(w.cp.x, w.cp.z, w.cp.y); w.surf = surf;
      this.surfaceMud = Math.max(this.surfaceMud, surf.mud); if (surf.water) this.inWater = Math.max(this.inWater, surf.water);
      // tyre frame
      const sa = Math.sin(w.steer), ca = Math.cos(w.steer);
      const hdg = t.c.set(sa, 0, -ca).applyQuaternion(this.q);
      const n = w.n;
      const lon = hdg.addScaledVector(n, -hdg.dot(n)).normalize();
      const lat = t.d.crossVectors(lon, n);
      const r = t.e.subVectors(w.cp, this.pos);
      const vc = t.f.crossVectors(this.w, r).add(this.vel);
      const vL = vc.dot(lon), vS = vc.dot(lat);
      const den = Math.max(Math.abs(vL), 2.2);
      const s = (w.omega * R - vL) / den;
      const ta = vS / Math.max(Math.abs(vL), 2.6);
      let mu = sp.tire.mu * surf.mu * (w.front ? 1 : 1.04) * lerp(sp.tire.dirt, sp.tire.asphalt, surf.asph);
      if (surf.mud > 0) mu *= lerp(1, Math.min(1, 0.62 * sp.mudGrip), surf.mud);
      const Fmax = mu * Fs;
      // on tarmac the carcass works at much smaller slip angles and lets go more progressively
      const aS = surf.asph * (1 - (surf.mud || 0));
      const AP = (w.front ? 0.17 : 0.145) * lerp(1, sp.tire.stiff || 0.7, aS);
      const SPx = SP * lerp(1, 0.8, aS), Cc = lerp(C, 1.3, aS);
      const sx = s / SPx, sy = ta / AP, rho = Math.hypot(sx, sy);
      let Fx = 0, Fy = 0;
      if (rho > 1e-5) { const f = Math.sin(Cc * Math.atan(B * rho)); Fx = Fmax * f * sx / rho * 0.96; Fy = -Fmax * f * sy / rho; }
      w.slip = s; w.slipLat = Math.atan(ta); w.fx = Fx; w.fy = Fy; w.rho = rho;
      slipSum += Math.min(3, Math.abs(rho) > 1 ? rho - 1 : 0) * (Fs / (m * 2.5));
      // implicit wheel spin integration
      const kx = Fmax * Cc * B / SPx * 0.96;
      const aCoef = kx * R / den;
      const implicitK = 1 + dt * R * aCoef / Ieff;
      w.omega = w.omega + dt * (Td - Fx * R) / Ieff / implicitK;
      // brakes (+ABS on footbrake) and rolling resistance
      let bT = brk * sp.brake * (w.front ? 1 : 0.65);
      if (s < -0.14) bT *= 0.35; // ABS
      if (!w.front) bT += inp.handbrake * sp.hbrake;
      let crr = surf.crr; if (surf.mud > 0) crr *= lerp(1, 1.7 / sp.mudGrip, surf.mud);
      bT += crr * Fs * R;
      const dOm = bT * dt / Ieff / implicitK;
      w.omega = Math.abs(w.omega) <= dOm ? 0 : w.omega - Math.sign(w.omega) * dOm;
      // apply
      const f = t.g.copy(up).multiplyScalar(Fs).addScaledVector(lon, Fx).addScaledVector(lat, Fy);
      F.add(f);
      // apply horizontal tyre forces partway up toward the CoM (reduces tripping roll-overs)
      const hUp = -r.dot(up) * 0.42;
      r.addScaledVector(up, hUp);
      Tq.add(t.d.crossVectors(r, f));
    }
    // limited slip diffs
    const lsd = (a, b, k) => { const d = a.omega - b.omega; const f = Math.min(0.5, k * dt) * d; a.omega -= f; b.omega += f; };
    lsd(this.wheels[0], this.wheels[1], 6); lsd(this.wheels[2], this.wheels[3], 8);
    if (sp.drive.type === 'awd') { const fa = (this.wheels[0].omega + this.wheels[1].omega) / 2, ra = (this.wheels[2].omega + this.wheels[3].omega) / 2; const d = (fa - ra) * Math.min(0.5, 4 * dt); for (let i = 0; i < 2; i++) this.wheels[i].omega -= d / 2; for (let i = 2; i < 4; i++) this.wheels[i].omega += d / 2; }
    this.slipAmount = slipSum;
    // aero + water drag
    F.addScaledVector(this.vel, -0.5 * 1.2 * sp.cda * speed);
    F.addScaledVector(up, -sp.down * speed * speed);
    const comY = this.pos.y;
    if (comY < WATER_Y + 1.0) {
      const depth = clamp(WATER_Y + 1.0 - comY, 0, 2);
      F.addScaledVector(this.vel, -depth * m * 0.55);
      F.y += depth * m * 9.81 * 0.35;
      this.inWater = Math.max(this.inWater, depth);
      if (comY < WATER_Y - 1.2) this.wreck('drowned');
    }
    // boost
    if (boostOn) { F.addScaledVector(fwd, sp.boost.force * m * (this.onGround ? 1 : 0.5)); this.heat += sp.boost.heat * dt; }
    else this.heat = Math.max(0, this.heat - (0.12 + 0.002 * speed + this.inWater * 0.5 + this.surfaceMud * 0.15) * dt);
    if (this.heat >= 1 && !this.wrecked) { this.heat = 1; this.wreck('overheat'); }
    // air control
    if (!this.onGround && !this.wrecked) {
      this.airTime += dt;
      const ac = this.isPlayer ? 0.9 : 0;
      Tq.addScaledVector(right, (inp.throttle - inp.brake) * -ac * m * 1.2);
      Tq.addScaledVector(up, -inp.steer * ac * m * 0.9);
    } else { if (this.airTime > 0.6) this.events.push({ type: 'land', air: this.airTime }); this.airTime = 0; }
    // integrate
    this.vel.addScaledVector(F, dt / m);
    const dw = this.invIWorld(Tq, t.a);
    this.w.addScaledVector(dw, dt);
    // airborne stabiliser: damp roll and level the chassis so landings stay on four wheels
    if (!this.onGround && !this.wrecked && up.y > 0.2) {
      const lv = t.c.set(up.z, 0, -up.x); // up x worldUp
      const rollRate = this.w.dot(fwd), pitchRate = this.w.dot(right);
      this.w.addScaledVector(fwd, -rollRate * (1 - Math.exp(-3.5 * dt)) + lv.dot(fwd) * 4.5 * dt);
      this.w.addScaledVector(right, -pitchRate * (1 - Math.exp(-0.8 * dt)) + lv.dot(right) * 0.9 * dt);
    }
    this.w.multiplyScalar(1 - (this.onGround ? 0.4 : 0.25) * dt);
    this.pos.addScaledVector(this.vel, dt);
    const wq = t.qi.set(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0).multiply(this.q);
    this.q.x += wq.x; this.q.y += wq.y; this.q.z += wq.z; this.q.w += wq.w; this.q.normalize();
    for (const w of this.wheels) w.spin -= w.omega * dt;
    // hull contacts with terrain
    this.hullContacts(W);
    // world bounds
    const bm = 40;
    if (this.pos.x < WORLD.x0 + bm) { this.pos.x = WORLD.x0 + bm; this.vel.x = Math.abs(this.vel.x) * 0.3; }
    if (this.pos.x > WORLD.x1 - bm) { this.pos.x = WORLD.x1 - bm; this.vel.x = -Math.abs(this.vel.x) * 0.3; }
    if (this.pos.z < WORLD.z0 + bm) { this.pos.z = WORLD.z0 + bm; this.vel.z = Math.abs(this.vel.z) * 0.3; }
    if (this.pos.z > WORLD.z1 - bm) { this.pos.z = WORLD.z1 - bm; this.vel.z = -Math.abs(this.vel.z) * 0.3; }
    if (this.wrecked) this.wreckT += dt;
    if (this.invuln > 0) this.invuln -= dt;
  }
  hullContacts(W) {
    const sp = this.spec, h = sp.hull, T = W.terrain, t = this._t;
    const pts = Car._hullPts || (Car._hullPts = (() => { const a = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) a.push([sx, sy, sz]); a.push([0, 1, 0], [0, -1, -1], [0, -1, 1], [0, 1, -1], [0, 1, 1]); return a; })());
    const p = t.a, n = t.b, r = t.c, vp = t.d, tmp = t.e;
    let maxPen = 0, pushN = new V3(), worst = 0;
    for (const q of pts) {
      p.set(q[0] * h.hx * (q[1] > 0 ? 0.82 : 1), h.y + q[1] * h.hy, q[2] * h.hz * (q[1] > 0 ? 0.75 : 1)).applyQuaternion(this.q).add(this.pos);
      const gy = T.height(p.x, p.z);
      const pen = gy - p.y;
      if (pen <= 0) continue;
      T.normal(p.x, p.z, n);
      const penN = pen * n.y;
      r.subVectors(p, this.pos);
      vp.crossVectors(this.w, r).add(this.vel);
      const vn = vp.dot(n);
      if (vn < 0) {
        const rn = tmp.crossVectors(r, n); this.invIWorld(rn, rn); const k = 1 / this.spec.mass + tmp.crossVectors(rn, r).dot(n);
        const j = -(1.15) * vn / k;
        const J = new V3().copy(n).multiplyScalar(j);
        // friction
        const vt = vp.addScaledVector(n, -vn); const vtl = vt.length();
        if (vtl > 1e-3) { const jt = Math.min(0.55 * j, vtl / k * 0.5); J.addScaledVector(vt, -jt / vtl); }
        this.applyImpulse(J, p);
        if (-vn > worst) worst = -vn;
      }
      if (penN > maxPen) { maxPen = penN; pushN.copy(n); }
    }
    if (maxPen > 0) this.pos.addScaledVector(pushN, maxPen * 0.8);
    if (worst > 3) { this.impact = Math.max(this.impact, worst); this.events.push({ type: 'scrape', v: worst }); }
    if (worst > sp.tough) this.wreck('crash');
  }
  spheres(out) { // two collision spheres in world space
    const sp = this.spec, h = sp.hull; const rad = Math.max(h.hx, h.hy) * 1.05;
    out.length = 0;
    for (const z of [-h.hz * 0.5, h.hz * 0.5]) out.push({ p: new V3(0, h.y, z).applyQuaternion(this.q).add(this.pos), r: rad });
    return out;
  }
}


'use strict';
