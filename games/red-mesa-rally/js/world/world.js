'use strict';
/* Red Mesa Rally · World: build order, surface and spawn queries, gates, the physics step and collisions (static setup: world-build.js) */

/* ---------- World ---------- */
class World {
  constructor() {
    this.cars = [];
    this._surf = { mu: 1, crr: 0.02, mud: 0, water: 0, road: 0, asph: 0, kind: 0 };
    this._n = new V3();
    this.time = 0;
  }
  *build() {
    this.terrain = new Terrain();
    yield* this.terrain.build();
    this.city = new City(this.terrain);
    this.terrain.setOverlays([...this.city.ramps, ...this.city.decks, ...this.terrain.bridges.flatMap((b) => b.pieces)]);
    this.scatter = new Scatter(this.terrain, this.city);
    yield* this.scatter.build();
    this.props = new Props(this.terrain);
    this.addTrains();
    this.crossings = this.findCrossings();
    this.addTunnelWalls();
    this.addQuays(); this.addStadium();
    this.addBridgeWalls(); this.addVillage();
    this.addMetroWalls();
    // two trains each way on the metro: stoppers with the loop, expresses against it, each pair half a round apart
    this.metroTrains = this.terrain.metro ? [
      new MetroTrain(this, { lat: METRO.tracks[1], vmax: 19 }), new MetroTrain(this, { lat: METRO.tracks[1], vmax: 19 }),
      new MetroTrain(this, { lat: METRO.tracks[0], reverse: true, express: true, vmax: 23 }), new MetroTrain(this, { lat: METRO.tracks[0], reverse: true, express: true, vmax: 23 }),
    ] : [];
    for (let k = 0; k < this.metroTrains.length; k += 2) { const a = this.metroTrains[k], b = this.metroTrains[k + 1], P = a.timetable(); b.timetable(); b.phase = P / 2; }
    yield 'World ready';
  }
  /* trains go home to their platforms while a race is on, and back to the timetable after */
  parkTrains(on) { this.trainsParked = on; }
  buildSync() { for (const _ of this.build()); return this; }
  /* the metro track at (x, z) with the most room before a train gets there: where to put a car back down */
  metroLane(x, z) {
    let best = METRO.tracks[0], room = -1;
    for (const l of METRO.tracks) {
      let d = 1e9;
      for (const mt of this.metroTrains) if (mt.lat === l) for (const c of mt.cars) d = Math.min(d, Math.hypot(c.pose.x - x, c.pose.z - z) - (mt.v > 1 ? 40 : 0));
      if (d > room) { room = d; best = l; }
    }
    return best;
  }
  /* a metro race: both trains out on the far side of the loop from the start line */
  resetMetro() {
    const M = this.terrain.metro; if (!M) return;
    const p = M.R.posAt(M.R.length * 0.5, {});
    this.metroLive = true;
    for (const mt of this.metroTrains) mt.placeNear(p.x, p.z);
  }
  route(id) { return this.terrain.routes.find((r) => r.id === id); }
  /* nearest open water deep enough to float a boat */
  findWetSpot(x, z) {
    const T = this.terrain;
    const ok = (px, pz) => {
      if (px < WORLD.x0 + 60 || px > WORLD.x1 - 60 || pz < WORLD.z0 + 60 || pz > WORLD.z1 - 60) return false;
      for (const rr of [0, 7]) for (let k = 0; k < (rr ? 8 : 1); k++) { const a = k / 8 * TAU; if (T.height(px + Math.cos(a) * rr, pz + Math.sin(a) * rr) > WATER_Y - 2) return false; }
      const near = this.scatter.near(px, pz); return !(near && near.some((o) => !o.off && this.obstacleDist(o, px, pz) < 5));
    };
    for (let r = 0; r <= 1500; r += 8) {
      const steps = r === 0 ? 1 : Math.ceil(r / 5);
      for (let k = 0; k < steps; k++) { const a = k / steps * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return { x: px, z: pz, yaw: null }; }
    }
    const d = BOAT_DOCKS[0].water; return { x: d.x, z: d.z, yaw: d.yaw };
  }
  /* construction barrier across the west approach of the Calder Tunnel (story mode) */
  tunnelGatePose() {
    if (this._gatePose) return this._gatePose;
    const R = this.route('tunnel'); let i0 = 0;
    if (R.covered) for (let i = 0; i <= R.count; i++) if (R.covered[i]) { i0 = i; break; }
    // just inside the west portal, where the cut walls are already too tall and steep to drive round
    const s = i0 * R.step + 8, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
    return (this._gatePose = { s, x: p.x, y: p.y, z: p.z, dx, dz, half: R.width / 2 + 10, bore: R.width / 2 + 1.2 });
  }
  setTunnelGate(closed) {
    if (!this._gate) {
      const g = this.tunnelGatePose(), nx = -g.dz, nz = g.dx; this._gate = [];
      for (let k = 0; k < 4; k++) {
        const a = -g.half + (2 * g.half) * k / 4, b = -g.half + (2 * g.half) * (k + 1) / 4;
        const o = this.scatter.addSegment(g.x + nx * a, g.z + nz * a, g.x + nx * b, g.z + nz * b, g.y + 40, 'barrier'); o.r = 0.5; this._gate.push(o);
      }
    }
    for (const o of this._gate) o.off = !closed;
    this.tunnelGateClosed = closed;
    for (const g of this.railGates()) if (!g.walls) {
      const nx = -g.dz, nz = g.dx; g.walls = [];
      for (let k = 0; k < 2; k++) { const a = -g.half + g.half * k, b = a + g.half; const o = this.scatter.addSegment(g.x + nx * a, g.z + nz * a, g.x + nx * b, g.z + nz * b, g.y + 7, 'barrier'); o.r = 0.5; g.walls.push(o); }
    }
    this.updateRailGates();
  }
  /* the railway's two tunnels through the rim get steel doors at their valley mouths while the road tunnel is shut:
     they roll aside for a train and close behind it */
  railGates() {
    if (this._railGates) return this._railGates;
    const R = this.route('rail');
    return (this._railGates = this.tunnelSpans().filter((t) => t.R === R && t.name.startsWith('RIM')).map((t) => {
      const P = t.portals.reduce((a, b) => (b.p.x > a.p.x ? b : a)), s = R.wrapS(P.s + P.facing * 6), p = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
      return { s, x: p.x, y: p.y, z: p.z, dx, dz, half: t.hw, name: t.name, open: 0 };
    }));
  }
  updateRailGates() {
    for (const g of this.railGates()) {
      const train = this.trains.some((T) => { const ahead = T.ahead(g.s); return ahead < 260 || T.R.length - ahead < T.length + 20; });
      g.shut = this.tunnelGateClosed && !train;
      if (g.walls) for (const o of g.walls) o.off = !g.shut;
    }
  }
  playable(x, z) {
    if (Math.hypot(x, z) < 930) return true;
    if (x > 1300 && eastSDF(x, z).d < -25) return true;
    return false;
  }
  obstacleDist(o, x, z) {
    if (o.type === 1) { const dx = Math.max(o.x0 - x, x - o.x1, 0), dz = Math.max(o.z0 - z, z - o.z1, 0); return Math.hypot(dx, dz); }
    if (o.type === 2) { const vx = o.bx - o.ax, vz = o.bz - o.az, t = clamp(((x - o.ax) * vx + (z - o.az) * vz) / (vx * vx + vz * vz || 1), 0, 1); return Math.hypot(x - o.ax - vx * t, z - o.az - vz * t) - o.r; }
    return Math.hypot(o.x - x, o.z - z) - o.r;
  }
  /* nearest drivable dry spot: above the waterline, not too steep, clear of obstacles */
  findDrySpot(x, z) {
    const T = this.terrain, n = this._n;
    const ok = (px, pz) => {
      if (!this.playable(px, pz)) return false;
      if (T.height(px, pz) < WATER_Y + 3) return false;
      for (const rr of [12, 25]) for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; if (T.height(px + Math.cos(a) * rr, pz + Math.sin(a) * rr) < WATER_Y + 1.5) return false; }
      T.normal(px, pz, n); if (n.y < 0.985) return false;
      if (T.rail[T.gi(px, pz)] > 0.1) return false;
      for (const [ox, oz] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) { const near = this.scatter.near(px + ox, pz + oz); if (near && near.some((o) => this.obstacleDist(o, px, pz) < 3.5)) return false; }
      return true;
    };
    for (let r = 0; r <= 600; r += 6) {
      const steps = r === 0 ? 1 : Math.ceil(r / 4);
      for (let k = 0; k < steps; k++) {
        const a = k / steps * TAU, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (ok(px, pz)) {
          const wet = T.height(x, z) < WATER_Y + 1.4;
          return { x: px, z: pz, yaw: wet ? Math.atan2(-(px - x), -(pz - z)) : null };
        }
      }
    }
    return { x: HUB.x, z: HUB.z + 30, yaw: 0 };
  }
  surface(x, z, y) {
    const T = this.terrain, s = this._surf;
    const road = T.bilinear(T.road, x, z), mud = T.bilinear(T.mud, x, z), rail = T.bilinear(T.rail, x, z);
    const gi = T.gi(x, z);
    const city = T.city[gi] / 255, green = T.green[gi] / 255, beach = T.beach[gi] / 255;
    const asph = Math.max(T.bilinear(T.asph, x, z), city > 0.8 ? 1 : 0);
    T.normal(x, z, this._n);
    const rock = smooth(0.85, 0.7, this._n.y) * (1 - road) * (1 - asph);
    // on a bridge, viaduct, ramp or car-park deck the grip is the deck's own, not the river bed or gap underneath
    // down in a road or rail bore: the floor of the bore
    // down in the metro, or on a station ramp: its own asphalt, whatever lies on the ground overhead
    const mm = y !== undefined ? T.metroAt(x, z) : 0;
    const hall = mm > 1 && ((sp) => (x - sp.x) * sp.dx + (z - sp.z) * sp.dz < sp.cover)(T.metro.spurs[mm - 2]);
    if (mm && (hall || y < METRO.under)) return this.deckSurface(1, 0, 0);
    if (y !== undefined && T.bores && T.probe(y + 1, () => T.boreFloor(x, z)) !== null) return this.deckSurface(T.boreRail.has(Math.round(x / 2) * 65536 + Math.round(z / 2)) ? 0 : 1, 0, 0);
    const o = y !== undefined && T.overlayAt(x, z), oy = o ? overlayLift(o, x, z) : -Infinity;
    if (o && Math.abs(oy - y) < 1.2 && oy > T.rawH(x, z) + 0.3) {
      const k = o.surf || 'asphalt';
      return this.deckSurface(k === 'asphalt' ? 1 : 0, k === 'dirt' ? 1 : 0, k === 'rail' ? 1 : 0);
    }
    s.road = road; s.mud = mud; s.asph = asph;
    const wy = T.waterY(x, z); s.water = (y !== undefined && y < wy) ? clamp((wy - y) * 1.5, 0, 1) : 0;
    let mu = lerp(lerp(0.94, 0.86, green), 0.8, beach);
    mu = lerp(mu, 1.1, road); mu = lerp(mu, 0.95, rail); mu = lerp(mu, 1.18, asph); mu = lerp(mu, 1.1, rock);
    s.mu = mu * (s.water ? 0.85 : 1);
    let crr = lerp(lerp(0.045, 0.05, green), 0.09, beach);
    crr = lerp(crr, 0.02, road); crr = lerp(crr, 0.05, rail); crr = lerp(crr, 0.013, asph);
    s.crr = crr + s.water * 0.08;
    s.kind = mud > 0.4 ? 2 : asph > 0.5 ? 5 : rock > 0.5 ? 3 : (road > 0.5 || rail > 0.5) ? 1 : beach > 0.5 ? 0 : green > 0.45 ? 6 : 0;
    return s;
  }
  deckSurface(asph, road, rail) {
    const s = this._surf;
    s.road = road; s.mud = 0; s.asph = asph; s.water = 0;
    s.mu = asph ? 1.18 : road ? 1.1 : 0.95; s.crr = asph ? 0.013 : road ? 0.02 : 0.05; s.kind = asph ? 5 : 1;
    return s;
  }
  step(dt) {
    this.time += dt;
    // one clock for every train; in a session it is the wall clock, so the timetables agree everywhere
    this.clock = this.wallClock ? Date.now() / 1000 : (this.clock || 0) + dt;
    if (this.trains) { for (const t of this.trains) t.update(dt, this.clock); this.updateRailGates(); }
    for (const mt of this.metroTrains) mt.update(dt, this.clock);
    const T = this.terrain;
    for (const c of this.cars) {
      if (c.asleep) continue;
      if (c.remote) { c.pos.addScaledVector(c.vel, dt); continue; } // driven on another machine: coast between its snapshots
      T.probeY = c.under ? Math.min(c.pos.y, METRO.under - 0.5) : c.pos.y; c.step(dt, this);
    }
    T.probeY = Infinity;
    // down in the metro stays down in the metro: tumbling about under the ceiling never lands a car on the street above
    for (const c of this.cars) {
      if (c.asleep) continue;
      const inside = c.pos.x > CITY.x0 - 30 && T.metroAt(c.pos.x, c.pos.z) > 0;
      c.under = inside && (c.pos.y < METRO.under || (!!c.under && c.pos.y < METRO.ceil + 3));
      if (c.under) {
        const ce = T.probe(METRO.y, () => T.subCeil(c.pos.x, c.pos.z));
        if (ce !== null && c.pos.y + 0.9 > ce) { c.pos.y = ce - 0.9; if (c.vel.y > 0) c.vel.y *= -0.2; }
      }
    }
    this.collideCars();
    this.collideStatic();
  }
  /* a car against something that does not move: restitution e along the wall normal (n, level), sliding friction along it,
     through the car's full effective mass at the contact point so an off-centre hit turns it as much as it should and no more.
     The caller passes the contact at the car's own height: a wall pushing at bumper height would roll it onto its side */
  wallImpulse(c, nx, nz, px, py, pz, e) {
    const m = c.spec.mass, t = this._wall || (this._wall = { r: new V3(), n: new V3(), a: new V3(), b: new V3(), v: new V3(), J: new V3(), p: new V3() });
    const r = t.r.set(px - c.pos.x, py - c.pos.y, pz - c.pos.z), n = t.n.set(nx, 0, nz);
    const vc = t.v.crossVectors(c.w, r).add(c.vel), vn = vc.dot(n);
    if (vn >= 0) return;
    const k = (dir) => 1 / m + dir.dot(c.invIWorld(t.a.crossVectors(r, dir), t.a).cross(r));
    const Jn = -(1 + e) * vn / k(n);
    const J = t.J.copy(n).multiplyScalar(Jn);
    const vt = vc.addScaledVector(n, -vn); vt.y = 0; const sl = vt.length();
    if (sl > 1e-3) { vt.multiplyScalar(1 / sl); J.addScaledVector(vt, -Math.min(sl / k(vt), 0.35 * Jn)); }
    const wy = c.w.y;
    c.applyImpulse(J, t.p.set(px, py, pz));
    c.w.y = wy + clamp(c.w.y - wy, -2.2, 2.2); // a glancing blow turns the car, it never sends it spinning
    c.wallT = 0.7; // and the car settles quickly afterwards (car.step)
    // the wheels slow with the car: still spinning at the old road speed they would kick it round
    const vf = c.vel.dot(c.forward(t.b)); for (const wh of c.wheels) if (Math.abs(wh.omega * c.spec.wheels.r) > Math.abs(vf)) wh.omega = vf / c.spec.wheels.r;
  }
  collideStatic() {
    const S = this.scatter, P = this.props;
    const sph = [];
    for (const c of this.cars) {
      if (c.asleep || c.remote) continue;
      const inTun = c.pos.y < RIVER.tunnel.under && this.terrain.riverTunWet(c.pos.x, c.pos.z); // in the boat tunnel: all but its walls is up on the lid
      c.spheres(sph);
      const hitThisStep = new Set();
      for (const s of sph) {
        const list = S.near(s.p.x, s.p.z);
        if (list) for (const o of list) {
          if (o.off || (inTun && !o.tunWall) || s.p.y - s.r > o.top || (o.bot !== undefined && s.p.y + s.r < o.bot) || !o.sub !== !c.under) continue;
          let nx, nz, pen, cx, cz;
          if (o.type === 1) {
            cx = clamp(s.p.x, o.x0, o.x1); cz = clamp(s.p.z, o.z0, o.z1);
            const dx = s.p.x - cx, dz = s.p.z - cz, d = Math.hypot(dx, dz);
            if (d >= s.r) continue;
            if (d > 1e-4) { nx = dx / d; nz = dz / d; pen = s.r - d; }
            else {
              const f = [[s.p.x - o.x0, -1, 0], [o.x1 - s.p.x, 1, 0], [s.p.z - o.z0, 0, -1], [o.z1 - s.p.z, 0, 1]].sort((a, b) => a[0] - b[0])[0];
              nx = f[1]; nz = f[2]; pen = f[0] + s.r;
            }
          } else if (o.type === 2) {
            const vx = o.bx - o.ax, vz = o.bz - o.az, t = clamp(((s.p.x - o.ax) * vx + (s.p.z - o.az) * vz) / (vx * vx + vz * vz || 1), 0, 1);
            cx = o.ax + vx * t; cz = o.az + vz * t;
            const dx = s.p.x - cx, dz = s.p.z - cz, d = Math.hypot(dx, dz), md = s.r + o.r;
            if (d >= md || d < 1e-4) continue;
            nx = dx / d; nz = dz / d; pen = md - d;
          } else {
            const dx = s.p.x - o.x, dz = s.p.z - o.z, d = Math.hypot(dx, dz), md = s.r + o.r;
            if (d >= md || d < 1e-4) continue;
            nx = dx / d; nz = dz / d; pen = md - d; cx = o.x + nx * o.r; cz = o.z + nz * o.r;
          }
          const vn = c.vel.x * nx + c.vel.z * nz;
          c.pos.x += nx * pen; c.pos.z += nz * pen;
          if (vn < 0 && !hitThisStep.has(o)) {
            hitThisStep.add(o); // both hull spheres touching the same wall get one impulse between them
            this.wallImpulse(c, nx, nz, cx, c.pos.y, cz, o.kind === 'rail' || o.kind === 'barrier' ? 0.15 : 0.25);
            c.impact = Math.max(c.impact, -vn);
            c.events.push({ type: 'hit', v: -vn, kind: o.kind });
            const limit = o.kind === 'rail' || o.kind === 'barrier' ? 1.5 : 1.05;
            if (-vn > c.spec.tough * limit) { c.wreck('obstacle'); c._obs = o; }
          }
        }
      }
      if (this.trains) for (const t of this.trains) t.collide(c, sph);
      if (c.under) for (const mt of this.metroTrains) mt.collide(c, sph);
      for (const p of P.list) {
        const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
        if (dx * dx + dz * dz > 36) continue;
        for (const s of sph) {
          const ex = p.x - s.p.x, ey = p.y - s.p.y, ez = p.z - s.p.z, d = Math.hypot(ex, ey, ez);
          if (d < s.r + p.r) {
            const sp = c.vel.length();
            if (sp < 1.5 || p.active) continue;
            const nx = ex / (d || 1), nz = ez / (d || 1);
            p.vx = c.vel.x * 1.15 + nx * (2 + sp * 0.25); p.vz = c.vel.z * 1.15 + nz * (2 + sp * 0.25); p.vy = 3 + sp * 0.25 + Math.random() * 3;
            p.wx = (Math.random() - 0.5) * 14; p.wy = (Math.random() - 0.5) * 10; p.wz = (Math.random() - 0.5) * 14;
            p.active = true; p.rest = false;
            c.vel.multiplyScalar(0.985);
            c.events.push({ type: 'prop', kind: p.kind });
            break;
          }
        }
      }
    }
  }
  collideCars() {
    const cars = this.cars, A = [], Bs = [];
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (a.asleep || b.asleep || a.pos.distanceToSquared(b.pos) > 100) continue;
      a.spheres(A); b.spheres(Bs);
      for (const sa of A) for (const sb of Bs) {
        const d = sa.p.distanceTo(sb.p), md = sa.r + sb.r;
        if (d >= md || d < 1e-4) continue;
        const n = new V3().subVectors(sb.p, sa.p).divideScalar(d);
        const pen = md - d;
        const ma = a.spec.mass, mb = b.spec.mass, wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.pos.addScaledVector(n, -pen * wa); b.pos.addScaledVector(n, pen * wb);
        const cp = new V3().addVectors(sa.p, sb.p).multiplyScalar(0.5);
        const va = new V3().subVectors(cp, a.pos).cross(a.w).negate().add(a.vel);
        const vb = new V3().subVectors(cp, b.pos).cross(b.w).negate().add(b.vel);
        const vrel = vb.sub(va).dot(n);
        if (vrel >= 0) continue;
        const jj = -(1.25) * vrel / (1 / ma + 1 / mb) * 0.85;
        const J = n.clone().multiplyScalar(jj);
        b.applyImpulse(J, cp); a.applyImpulse(J.clone().negate(), cp);
        const sev = -vrel;
        a.impact = Math.max(a.impact, sev * wa * 2); b.impact = Math.max(b.impact, sev * wb * 2);
        const aTo = a.vel.dot(n), bTo = -b.vel.dot(n);
        const att = aTo > bTo ? a : b, vic = att === a ? b : a;
        vic.lastHit = att; vic.lastHitT = this.time;
        a.events.push({ type: 'bump', v: sev, other: b }); b.events.push({ type: 'bump', v: sev, other: a });
        const vicW = vic === a ? wa : wb;
        if (sev * vicW * 2 > vic.spec.tough * 1.1) vic.wreck('takedown');
        if (this.onContact && (a.remote || b.remote)) this.onContact(a, b, J, cp, sev * wa * 2, sev * wb * 2, vic); // a car driven elsewhere: tell its owner
        break;
      }
    }
  }
}

'use strict';
