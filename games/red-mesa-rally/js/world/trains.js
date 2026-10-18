'use strict';
/* Red Mesa Rally · Coastline Freight and the Calder Metro trains */

/* ---------- Mainline trains: the Coastline Freight and the Calder Valley passenger train. Both run to a timetable on the
   world clock, so everyone in a session sees them in the same place, and both park in a station while a race is on. ---------- */
const CONSIST = ['loco', 'loco', 'box', 'tank', 'flat', 'box', 'hopper', 'flat', 'box', 'tank', 'box', 'flat'];
const STATIONS = [
  { id: 'redmesa', name: 'RED MESA', at: [150, 458] },
  { id: 'port', name: 'SUNSET MARINA', at: [3995, 625] },
  { id: 'union', name: 'CALDER UNION', at: [4650, -780] },
  { id: 'millbrook', name: 'MILLBROOK', at: [1835, -618] },
];
class Train {
  constructor(world, R, o = {}) {
    this.w = world; this.R = R; this.name = o.name || 'Coastline Freight';
    this.cars = []; let off = 0;
    for (const kind of o.consist || CONSIST) { const len = kind === 'loco' ? 19 : kind === 'coach' ? 21 : 15.5; this.cars.push({ kind, len, off: off + len / 2, pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, dx: 0, dz: 1 } }); off += len + 1.0; }
    this.length = off;
    // stops: s of the head at the platform end, and how long it waits there
    this.stops = (o.stops || ['port']).map((id) => { const st = world.stations.find((q) => q.id === id); return { st, s: st.s, dwell: o.dwell || 16 }; });
    this.station = this.stops[0].s;
    this.vmax = o.vmax || 27; this.horn = 0;
    this.s = this.station; this.v = 0; this.next = 0; this.wait = 0;
  }
  ahead(target) { const L = this.R.length; return (((target - this.s) % L) + L) % L; }
  /* one step of driving: run at line speed, brake for the next stop, wait out its dwell */
  drive(dt) {
    if (this.wait > 0) { this.wait -= dt; this.v = 0; if (this.wait <= 0) { this.next = (this.next + 1) % this.stops.length; this.s = this.R.wrapS(this.s + 0.1); } return; }
    const dist = this.ahead(this.stops[this.next].s);
    const target = Math.min(this.vmax, Math.sqrt(2 * 0.7 * Math.max(0, dist - 0.5)) + 0.4);
    this.v += clamp(target - this.v, -1.1 * dt, 0.55 * dt);
    const ds = Math.min(this.v * dt, dist);
    this.s = this.R.wrapS(this.s + ds);
    if (dist - ds < 0.05) { this.wait = this.stops[this.next].dwell; this.v = 0; }
  }
  /* drive one whole round, from doors open at the first stop until they open there again, and keep where the train is
     every half second; pad stretches the wait at the first stop so trains sharing the line can share one period */
  timetable(pad = 0) {
    const S0 = this.stops[0]; S0.dwell = (S0.base = S0.base || S0.dwell) + pad;
    this.s = S0.s; this.v = 0; this.next = 0; this.wait = S0.dwell;
    const tab = [[this.s, 0]]; let n = 0;
    for (;;) {
      const w0 = this.wait; this.drive(0.05); n++;
      if (w0 <= 0 && this.wait > 0 && this.next === 0) break;
      if (n % 10 === 0) tab.push([this.s, this.v]);
      if (n > 400000) break;
    }
    tab.push([this.s, 0]);
    this.tab = tab; this.period = (tab.length - 1) * 0.5; this.phase = this.phase || 0;
    return this.period;
  }
  /* where the timetable puts the train at world time t (seconds), offset by its phase */
  sync(t) {
    const tab = this.tab, P = this.period, u = ((((t + this.phase) % P) + P) % P) / 0.5, i = Math.floor(u), f = u - i;
    const [s0, v0] = tab[i], [s1, v1] = tab[Math.min(i + 1, tab.length - 1)], L = this.R.length;
    let ds = s1 - s0; if (ds < -L / 2) ds += L;
    this.s = this.R.wrapS(s0 + ds * f); this.v = lerp(v0, v1, f);
  }
  /* parked for a race: standing at its home platform */
  park() { this.s = this.station; this.v = 0; }
  update(dt, t) {
    if (this.w.trainsParked) this.park(); else if (this.tab) this.sync(t); else this.drive(dt);
    const R = this.R;
    const a = {}, b = {};
    for (const c of this.cars) {
      const sc = this.s - c.off, k = c.len * 0.36;
      R.posAt(sc + k, a); R.posAt(sc - k, b);
      const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1, P = c.pose;
      P.x = (a.x + b.x) / 2; P.z = (a.z + b.z) / 2; P.y = (a.y + b.y) / 2 + 0.35;
      P.dx = dx / l; P.dz = dz / l; P.yaw = Math.atan2(P.dx, P.dz); P.pitch = Math.atan2(a.y - b.y, l);
    }
  }
  /* push cars out of wagons; returns nothing, raises car events */
  collide(car, sph) {
    const v = this.v;
    for (const c of this.cars) {
      const P = c.pose, hz = c.len / 2, hx = 1.55;
      const ddx = car.pos.x - P.x, ddz = car.pos.z - P.z;
      if (ddx * ddx + ddz * ddz > (hz + 5) * (hz + 5)) continue;
      for (const s of sph) {
        if (s.p.y + s.r < P.y + 0.4 || s.p.y - s.r > P.y + 4.4) continue;
        const rx = s.p.x - P.x, rz = s.p.z - P.z;
        const lz = rx * P.dx + rz * P.dz, lx = rx * P.dz - rz * P.dx;
        const qx = clamp(lx, -hx, hx), qz = clamp(lz, -hz, hz);
        let nlx = lx - qx, nlz = lz - qz, d = Math.hypot(nlx, nlz), pen;
        if (d > 1e-4) { if (d >= s.r) continue; nlx /= d; nlz /= d; pen = s.r - d; }
        else { const ex = hx - Math.abs(lx), ez = hz - Math.abs(lz); if (ex < ez) { nlx = Math.sign(lx) || 1; nlz = 0; pen = ex + s.r; } else { nlx = 0; nlz = Math.sign(lz) || 1; pen = ez + s.r; } }
        const nx = nlx * P.dz + nlz * P.dx, nz = -nlx * P.dx + nlz * P.dz;
        car.pos.x += nx * pen; car.pos.z += nz * pen;
        const vrel = (car.vel.x - P.dx * v) * nx + (car.vel.z - P.dz * v) * nz;
        if (vrel < 0) {
          const J = new V3(nx, 0.08, nz).multiplyScalar(-vrel * 1.3 * car.spec.mass);
          car.applyImpulse(J, new V3(s.p.x - nx * s.r, s.p.y, s.p.z - nz * s.r));
          car.impact = Math.max(car.impact, -vrel);
          car.events.push({ type: 'hit', v: -vrel, kind: 'train' });
          if (-vrel > car.spec.tough * 0.8) car.wreck('train');
        }
      }
    }
  }
}

/* ---------- Calder Metro trains: four cars round one of the loop's two tracks. The stopper runs with the loop and waits at
   each station; the express runs the other way and never stops. ---------- */
class MetroTrain {
  constructor(world, o) {
    const R0 = world.terrain.metro.R, pts = [];
    this.w = world; this.phase = o.phase || 0;
    this.lat = o.lat; this.dir = o.reverse ? -1 : 1; this.express = !!o.express;
    for (let s = 0; s < R0.length; s += 6) { const p = R0.posAt(s, {}), [dx, dz] = R0.dirAt(s); pts.push([p.x - dz * o.lat, p.z + dx * o.lat]); }
    if (o.reverse) pts.reverse();
    const R = this.R = new Route({ id: 'metro-track', closed: true, keepStart: true, width: 4, pts, sub: 3 });
    R.y.fill(METRO.y);
    this.cars = [0, 1, 2, 3].map((k) => ({ k, len: 18, off: 9 + k * 18.6, pose: { x: 0, y: 0, z: 0, yaw: 0, dx: 0, dz: 1 } }));
    this.length = 4 * 18.6;
    this.stops = this.express ? [] : METRO.stations.map((st) => R.wrapS(R.project(st.at[0], st.at[1], 0, -1).s + this.length / 2));
    this.vmax = o.vmax;
    this.place(o.at || 0);
  }
  /* put the train down at s along its track: the stopper at the next station, doors open; the express at speed */
  place(s) {
    this.s = this.R.wrapS(s); this.v = this.stops.length ? 0 : this.vmax; this.wait = 0;
    if (this.stops.length) {
      let k = 0; for (let i = 1; i < this.stops.length; i++) if (this.ahead(this.stops[i]) < this.ahead(this.stops[k])) k = i;
      this.s = this.stops[k]; this.next = (k + 1) % this.stops.length; this.wait = 8;
    }
    this.update(0);
  }
  /* place the train at the track point beside (x, z) on the loop */
  placeNear(x, z, along = 0) { this.place(this.R.project(x, z, 0, -1).s + along); }
  ahead(target) { const L = this.R.length; return (((target - this.s) % L) + L) % L; }
  drive(dt) {
    const R = this.R;
    if (!this.stops.length) { this.v += clamp(this.vmax - this.v, -1.6 * dt, 1.0 * dt); this.s = R.wrapS(this.s + this.v * dt); }
    else if (this.wait > 0) { this.wait -= dt; this.v = 0; }
    else {
      const dist = this.ahead(this.stops[this.next]);
      const target = Math.min(this.vmax, Math.sqrt(2 * 0.9 * Math.max(0, dist - 0.5)) + 0.3);
      this.v += clamp(target - this.v, -1.6 * dt, 1.0 * dt);
      const ds = Math.min(this.v * dt, dist);
      this.s = R.wrapS(this.s + ds);
      if (dist - ds < 0.05) { this.wait = 12; this.v = 0; this.next = (this.next + 1) % this.stops.length; }
    }
  }
  /* the stopper's round of the loop, from doors open at the first station until they open there again; the express just runs */
  timetable() {
    if (!this.stops.length) { this.period = this.R.length / this.vmax; return this.period; }
    this.s = this.stops[0]; this.v = 0; this.next = 1 % this.stops.length; this.wait = 12;
    const tab = [[this.s, 0]]; let n = 0;
    for (;;) {
      const w0 = this.wait; this.drive(0.05); n++;
      if (w0 <= 0 && this.wait > 0 && this.next === 1 % this.stops.length) break;
      if (n % 10 === 0) tab.push([this.s, this.v]);
      if (n > 400000) break;
    }
    tab.push([this.s, 0]);
    this.tab = tab; this.period = (tab.length - 1) * 0.5;
    return this.period;
  }
  sync(t) {
    if (!this.tab) { this.s = this.R.wrapS((t + this.phase) * this.vmax); this.v = this.vmax; return; }
    Train.prototype.sync.call(this, t);
  }
  update(dt, t) {
    const R = this.R;
    if (this.w.metroLive || this.period === undefined) this.drive(dt); else this.sync(t);
    const a = {}, b = {};
    for (const c of this.cars) {
      const sc = this.s - c.off; R.posAt(sc + c.len * 0.36, a); R.posAt(sc - c.len * 0.36, b);
      const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1, P = c.pose;
      P.x = (a.x + b.x) / 2; P.z = (a.z + b.z) / 2; P.y = METRO.y + 0.3; P.dx = dx / l; P.dz = dz / l; P.yaw = Math.atan2(P.dx, P.dz);
    }
  }
  /* there is no barrier any more: whoever is on the track when the train arrives gets hit like the freight hits them */
  collide(car, sph) { Train.prototype.collide.call(this, car, sph); }
}
