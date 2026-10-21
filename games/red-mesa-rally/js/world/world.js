'use strict';
/* Red Mesa Rally · World: terrain, routes, cars, trains and the physics step */

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
  /* the mainline: stations where the line passes them, the freight and the passenger train on one shared period */
  addTrains() {
    const R = this.route('rail');
    this.stations = STATIONS.map((st) => {
      const pr = R.project(st.at[0], st.at[1], 0, -1), s = pr.s, p = R.posAt(s - 60, {}), [dx, dz] = R.dirAt(s - 60), T = this.terrain;
      // the platform goes on whichever side has more room from the roads
      const side = [1, -1].map((k) => { let m = 1e9; for (let a = -60; a <= 60; a += 20) { const q = R.posAt(s - 60 + a, {}); m = Math.min(m, T.rdist[T.gi(q.x + dz * k * 8, q.z - dx * k * 8)]); } return m; });
      return { ...st, s, side: side[0] >= side[1] ? 1 : -1, elevated: p.y - T.h[T.gi(p.x, p.z)] > 3 };
    });
    this.train = new Train(this, R);
    this.passenger = new Train(this, R, { name: 'Calder Valley Line', consist: ['loco', 'coach', 'coach', 'coach', 'coach'], stops: ['millbrook', 'redmesa', 'port', 'union'], vmax: 31, dwell: 20 });
    this.trains = [this.train, this.passenger];
    // one single track, so both trains keep the same period: the quicker one runs slower to match, and makes up the last
    // few seconds at its first stop; then the passenger's phase is set where the two stay furthest apart all round
    const P = Math.max(...this.trains.map((t) => t.timetable()));
    for (const t of this.trains) if (t.period < P) {
      let lo = 6, hi = t.vmax;
      for (let k = 0; k < 18; k++) { t.vmax = (lo + hi) / 2; if (t.timetable() > P) lo = t.vmax; else hi = t.vmax; }
      t.vmax = hi; t.timetable(); t.timetable(P - t.period);
    }
    const [A, B] = this.trains, L = R.length, gapAt = (t) => {
      A.sync(t); B.sync(t); const d = (((B.s - A.s) % L) + L) % L; return Math.min(d - B.length, L - d - A.length);
    };
    let best = -1e9;
    for (let ph = 0; ph < P; ph += 5) {
      B.phase = ph; let m = 1e9; for (let t = 0; t < P && m > best; t += 2) m = Math.min(m, gapAt(t));
      if (m > best) { best = m; this.trainPhase = ph; }
    }
    B.phase = this.trainPhase; this.trainGap = best;
    this.clock = Date.now() / 1000;
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
  /* Calder Tunnel: the lined bore and its portal headwalls, shared by the meshes and the colliders */
  tunnelSpan() { return this.tunnelSpans().find((t) => t.R.id === 'tunnel') || null; }
  /* every bore: the Calder Tunnel, and the railway's tunnels through the rim and the mesas */
  tunnelSpans() {
    if (this._tuns) return this._tuns;
    this._tuns = [];
    for (const R of this.terrain.routes) {
      if (!R.covered) continue;
      for (let i = 0; i <= R.count; i++) {
        if (!R.covered[i]) continue;
        let j = i; while (j < R.count && R.covered[j + 1]) j++;
        if (j - i > 8) this._tuns.push(this.makeTunnelSpan(R, i, j));
        i = j;
      }
    }
    return this._tuns;
  }
  makeTunnelSpan(R, i0, i1) {
    const T = this.terrain;
    i0 = Math.max(0, i0 - 2); i1 = Math.min(R.count, i1 + 2);
    const bore = (R.def.bores || []).find(([a, b]) => { const s = (i0 + i1) / 2 * R.step, p = R.posAt(s, {}); return Math.hypot(p.x - (a[0] + b[0]) / 2, p.z - (a[1] + b[1]) / 2) < 400; });
    const name = R.id === 'tunnel' ? 'CALDER TUNNEL' : bore ? bore[2] : 'RAIL TUNNEL';
    const hw = R.width / 2 + 1.2, reach = R.width / 2 + 20, N = 16, portals = [];
    for (const [iP, facing] of [[i0, 1], [i1, -1]]) {
      const s = iP * R.step, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), rx = dz, rz = -dx;
      const top = Math.max(12, naturalHeight(p.x, p.z) - p.y + 4), line = [];
      for (let k = N; k >= 0; k--) {
        const lx = -reach + 2 * reach * k / N, x = p.x - rx * lx * facing, z = p.z - rz * lx * facing;
        // the wings rise to the mountain cover laid over the bore, so no gap opens between the two
        const th = Math.max(T.height(x, z), naturalHeight(x, z)) - p.y + 0.8;
        line.push([lx, Math.abs(lx) < hw + 3 ? top : Math.max(0.6, th)]);
      }
      portals.push({ s, p, dx, dz, facing, top, line });
    }
    return { R, i0, i1, hw, reach, portals, name };
  }
  addTunnelWalls() { for (const tun of this.tunnelSpans()) this.addTunnelWallsFor(tun); }
  addTunnelWallsFor(tun) {
    const { R, i0, i1, hw, reach } = tun, S = this.scatter, r = 0.35, off = hw + r;
    // bore walls: solid up to the crown
    for (let i = i0; i < i1; i += 2) {
      const j = Math.min(i + 2, i1), a = R.posAt(i * R.step, {}), b = R.posAt(j * R.step, {}), [adx, adz] = R.dirAt(i * R.step), [bdx, bdz] = R.dirAt(j * R.step);
      for (const side of [-1, 1]) {
        const o = S.addSegment(a.x + adz * side * off, a.z - adx * side * off, b.x + bdz * side * off, b.z - bdx * side * off, Math.max(a.y, b.y) + 8.2, 'barrier'); o.r = r;
      }
    }
    // headwall wings either side of each portal mouth
    for (const P of tun.portals) {
      const rx = P.dz, rz = -P.dx, at = (lx) => { // wall height at lateral offset lx, from the headwall outline
        const L = P.line; for (let k = 0; k < L.length - 1; k++) { const [x0, h0] = L[k], [x1, h1] = L[k + 1]; if ((lx - x0) * (lx - x1) <= 0) return lerp(h0, h1, (lx - x0) / ((x1 - x0) || 1)); } return 0.6;
      };
      for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
        const la = side * lerp(hw, reach, k / 6), lb = side * lerp(hw, reach, (k + 1) / 6);
        const pa = [P.p.x - rx * la * P.facing, P.p.z - rz * la * P.facing], pb = [P.p.x - rx * lb * P.facing, P.p.z - rz * lb * P.facing];
        const o = S.addSegment(pa[0], pa[1], pb[0], pb[1], P.p.y + Math.max(at(la), at(lb)), 'barrier'); o.r = 0.6;
      }
    }
  }
  /* metro walls: the loop's outer wall (open where the portal ramps come in), the inner wall, the ramp walls.
     They only touch cars that are down in the metro, and nothing else down there touches those cars. */
  addMetroWalls() {
    const M = this.terrain.metro; if (!M) return;
    const R = M.R, S = this.scatter, top = METRO.y + 3.6;
    const seg = (ax, az, bx, bz, t, r) => { const o = S.addSegment(ax, az, bx, bz, t, 'barrier'); o.r = r; o.sub = true; return o; };
    const line = (s0, s1, l, t, r) => {
      const n = Math.max(1, Math.ceil((s1 - s0) / 3));
      for (let k = 0; k < n; k++) {
        const a = s0 + (s1 - s0) * k / n, b = s0 + (s1 - s0) * (k + 1) / n, pa = R.posAt(a, {}), pb = R.posAt(b, {}), [adx, adz] = R.dirAt(a), [bdx, bdz] = R.dirAt(b);
        seg(pa.x - adz * l, pa.z + adx * l, pb.x - bdz * l, pb.z + bdx * l, t, r);
      }
    };
    // outer wall in runs between the ramp mouths
    const gaps = M.spurs.map((sp) => [sp.s - METRO.rampHw - 0.3, sp.s + METRO.rampHw + 0.3]).sort((a, b) => a[0] - b[0]);
    let s = gaps.length ? gaps[gaps.length - 1][1] - R.length : 0;
    for (const [g0, g1] of gaps) { line(s, g0, METRO.wallL - 0.3, top, 0.3); s = g1; }
    if (!gaps.length) line(0, R.length, METRO.wallL - 0.3, top, 0.3);
    line(0, R.length, METRO.wallR, top, 0.3);
    for (const sp of M.spurs) for (const sd of [-1, 1]) {
      const l = sd * (METRO.rampHw + 0.3), aEnd = sp.L + METRO.wallL + 2 - 0.3;
      for (let a = 0; a < aEnd; a += 6) {
        const b = Math.min(aEnd, a + 6);
        seg(sp.x + sp.dx * a - sp.dz * l, sp.z + sp.dz * a + sp.dx * l, sp.x + sp.dx * b - sp.dz * l, sp.z + sp.dz * b + sp.dx * l, metroSpurY(a) + 3.6, 0.3);
      }
    }
    // up on the street: a parapet down both sides of each open cut and across its far end
    for (const sp of M.spurs) {
      const g = METRO.rampHw + 0.6, P = (a, l) => [sp.x + sp.dx * a - sp.dz * l, sp.z + sp.dz * a + sp.dx * l], top = CITY.y + 1.0, a0 = 9;
      const par = (p, q) => { const o = S.addSegment(...p, ...q, top, 'barrier'); o.r = 0.35; o.bot = CITY.y - 0.8; };
      for (const sd of [-1, 1]) for (let a = a0; a < sp.cover; a += 8) par(P(a, sd * g), P(Math.min(sp.cover, a + 8), sd * g));
      par(P(sp.cover, -g), P(sp.cover, g));
    }
  }
  /* river bridges: parapets along both edges (boats pass under them) and the piers in the water */
  addBridgeWalls() {
    const S = this.scatter;
    for (const B of this.terrain.bridges) {
      for (const p of B.pieces) for (const side of [-1, 1]) {
        if (p.gap[side < 0 ? 0 : 1]) continue; // a road joins the deck here
        const l = side * (p.hw - 0.3), ax = p.x - p.dz * l, az = p.z + p.dx * l, bx = ax + p.dx * p.Lt, bz = az + p.dz * p.Lt;
        const o = S.addSegment(ax, az, bx, bz, Math.max(p.y0, p.y1) + 1.0, 'rail'); o.r = 0.3; o.bot = Math.min(p.y0, p.y1) - 1.2;
      }
      for (const q of B.piers) { const o = S.addObstacle(q.x, q.z, B.rail ? 1.6 : 1.1, q.top, 'barrier'); o.bot = q.bot; }
    }
  }
  /* Millbrook: every house a solid box */
  addVillage() {
    const S = this.scatter;
    for (const o of this.terrain.village) {
      if (o.kind === 'lookout') { for (const [ax, az, bx, bz] of lookoutWall(o)) { const T = this.terrain; S.addSegment(ax, az, bx, bz, Math.max(T.rawH(ax, az), T.rawH(bx, bz)) + 0.9, 'rail').r = 0.35; } continue; }
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw), P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [o.x + a * o.w / 2 * c + b * o.d / 2 * s, o.z - a * o.w / 2 * s + b * o.d / 2 * c]);
      for (let k = 0; k < 4; k++) { const [ax, az] = P[k], [bx, bz] = P[(k + 1) % 4]; S.addSegment(ax, az, bx, bz, o.y1 + o.h, 'barrier').r = 0.3; }
      if (o.wheel) S.addObstacle(o.wheel.x, o.wheel.z, 1.4, WATER_Y + o.wheel.r * 1.6, 'barrier');
    }
  }
  /* harbour quay faces: low walls that stop boats but sit under the wheels of anything on the quay */
  /* Calder Stadium: the stands are solid all round, open at the way in */
  addStadium() {
    const St = this.city.stadium, S = this.scatter; if (!St) return;
    for (let k = 0; k < St.seg; k++) {
      const t0 = k * TAU / St.seg, t1 = (k + 1) * TAU / St.seg, tm = (t0 + t1) / 2;
      if (Math.abs(Math.atan2(Math.sin(tm - Math.PI), Math.cos(tm - Math.PI))) < St.gap) continue;
      for (const r of [0, St.depth]) S.addSegment(St.x + (St.rx - r) * Math.cos(t0), St.z + (St.rz - r) * Math.sin(t0), St.x + (St.rx - r) * Math.cos(t1), St.z + (St.rz - r) * Math.sin(t1), St.y + St.h(tm), 'building').r = 0.4;
    }
    const at = (t, r) => [St.x + (St.rx - r) * Math.cos(t), St.z + (St.rz - r) * Math.sin(t)]; // floodlights and the crane
    for (const t of [Math.PI * 0.72, Math.PI * 1.28]) S.addObstacle(...at(t, -4), 0.8, St.y + 40, 'pole');
    S.addObstacle(...at(0.15, St.depth + 12), 1.6, St.y + 46, 'crane');
    for (const sd of [-1, 1]) { const t = Math.PI + sd * St.gap; S.addSegment(St.x + St.rx * Math.cos(t), St.z + St.rz * Math.sin(t), St.x + (St.rx - St.depth) * Math.cos(t), St.z + (St.rz - St.depth) * Math.sin(t), St.y + 16, 'building').r = 0.4; }
  }
  addQuays() {
    const S = this.scatter, top = CITY.y - 1.2, zq = FLAT.z1 + 1.2, xq = FLAT.x1 + 1.2;
    const south = [[4150, SLIP.x - SLIP.hw - 0.6], [SLIP.x + SLIP.hw + 0.6, xq]];
    // the quay edge in 4 m pieces, open wherever a road runs across it (the coast road's bridge at the river mouth)
    const roads = this.terrain.routes.filter((R) => !R.def.noCarve && !R.def.trafficOnly && R.surface !== 'rail');
    const onRoad = (x, z) => roads.some((R) => R.project(x, z, 0, -1).dist < R.width / 2 + 1.5);
    const edge = (ax, az, bx, bz) => { if (onRoad((ax + bx) / 2, (az + bz) / 2)) return; const o = S.addSegment(ax, az, bx, bz, top, 'barrier'); o.r = 0.8; };
    for (const [a, b] of south) for (let x = a; x < b; x += 4) edge(x, zq, Math.min(b, x + 4), zq);
    for (let z = -760; z < zq; z += 4) edge(xq, z, xq, Math.min(zq, z + 4));
    for (const sd of [-1, 1]) { const o = S.addSegment(SLIP.x + sd * (SLIP.hw + 0.6), zq, SLIP.x + sd * (SLIP.hw + 0.6), SLIP.z1, top - 1.5, 'barrier'); o.r = 0.6; }
    // car-park ramps: a parapet along the open side and across the top landing
    for (const P of this.city.carParks) {
      const { sl } = P, xo = sl.x + P.side * (sl.hw + 0.3), zEnd = sl.z - sl.Lt;
      for (let a = 4; a < sl.Lt; a += 8) { const b = Math.min(sl.Lt, a + 8), o = S.addSegment(xo, sl.z - a, xo, sl.z - b, overlayLift(sl, sl.x, sl.z - b) + 1.0, 'rail'); o.r = 0.3; }
      const o = S.addSegment(sl.x - sl.hw, zEnd + 0.3, sl.x + sl.hw, zEnd + 0.3, P.y + 1.0, 'rail'); o.r = 0.3;
    }
    // the ship: solid hull below the deck, bridge block at the stern, bulwarks round the deck (open at the ramp)
    S.addBox(SHIP.x0, SHIP.z0, SHIP.x1, SHIP.z1, SHIP.y - 1.2, 'container');
    S.addBox(SHIP.x0 + 10, SHIP.z1 - 14, SHIP.x1 - 10, SHIP.z1, SHIP.y + 0.5, 'container'); // the bow
    S.addBox(SHIP.x0 + 2, SHIP.z0, SHIP.x1 - 2, SHIP.z0 + 26, SHIP.y + 24, 'building');
    const bw = (ax, az, bx, bz) => { const o = S.addSegment(ax, az, bx, bz, SHIP.y + 1.0, 'rail'); o.r = 0.35; };
    const ra = SHIP.rampZ - SHIP.rampHw - 0.5, rb = SHIP.rampZ + SHIP.rampHw + 0.5;
    bw(SHIP.x0 + 0.4, SHIP.z0 + 26, SHIP.x0 + 0.4, ra); bw(SHIP.x0 + 0.4, rb, SHIP.x0 + 0.4, SHIP.z1 - 14.4);
    bw(SHIP.x1 - 0.4, SHIP.z0 + 26, SHIP.x1 - 0.4, SHIP.z1 - 14.4); bw(SHIP.x0 + 0.4, SHIP.z1 - 14.4, SHIP.x1 - 0.4, SHIP.z1 - 14.4);
    // the ramp up along the quay: railings both sides, rising with it, then round the landing (open to the deck)
    const sr = this.city.decks.find((d) => d.ship);
    if (sr) for (const side of [-1, 1]) for (let a = 0; a < sr.L; a += 6) {
      const b = Math.min(sr.L, a + 6), xo = sr.x + side * (sr.hw + 0.3), o = S.addSegment(xo, sr.z - a, xo, sr.z - b, overlayLift(sr, sr.x, sr.z - b) + 1.0, 'rail');
      o.r = 0.3; o.bot = overlayLift(sr, sr.x, sr.z - a) - 2.5;
    }
    { const r = SHIP.ramp, lz0 = SHIP.rampZ - SHIP.rampHw, lz1 = SHIP.rampZ + SHIP.rampHw, xw = r.x - r.hw - 0.3;
      for (const [ax, az, bx, bz] of [[xw, r.z1, xw, lz0 - 0.3], [xw, lz0 - 0.3, SHIP.x0, lz0 - 0.3], [r.x + r.hw + 0.3, lz1 + 0.3, SHIP.x0, lz1 + 0.3]]) {
        const o = S.addSegment(ax, az, bx, bz, SHIP.y + 1.0, 'rail'); o.r = 0.3; o.bot = SHIP.y - 2.5;
      } }
  }
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
  findCrossings() {
    const T = this.terrain, rail = this.route('rail'), out = [];
    const raised = (R, i) => (R.elev && R.elev[i]) || (R.covered && R.covered[i]) || T.bridges.some((B) => B.route === R.id && i >= B.i0 - 2 && i <= B.i1 + 2);
    for (const R of T.routes) {
      if (R === rail || R.def.noCarve) continue;
      let last = -1e9;
      for (let i = 0; i <= rail.count; i += 3) {
        const x = rail.x[i], z = rail.z[i];
        if (Math.abs(x - R.x[0]) > 9000) continue;
        const pr = R.project(x, z, 0, -1);
        if (pr.dist < 5 && i * rail.step - last > 80) {
          // only where the two meet at grade: not where one passes over or under the other on a bridge, viaduct or in a bore
          const k = R.idx(Math.round(pr.s / R.step));
          if (Math.abs(R.sample(R.y, pr.s) - rail.y[i]) > 1.5 || raised(rail, i) || raised(R, k)) continue;
          last = i * rail.step;
          const [dx, dz] = rail.dirAt(i * rail.step), [ex, ez] = R.dirAt(pr.s);
          out.push({ s: i * rail.step, x, z, y: rail.y[i], rdx: dx, rdz: dz, road: R.id, ex, ez, roadW: R.width, active: false });
        }
      }
    }
    return out;
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
    const o = y !== undefined && T.overlayAt(x, z), oy = o ? overlayLift(o, x, z) : -Infinity;
    if (o && Math.abs(oy - y) < 1.2 && oy > T.rawH(x, z) + 0.3) {
      const k = o.surf || 'asphalt';
      return this.deckSurface(k === 'asphalt' ? 1 : 0, k === 'dirt' ? 1 : 0, k === 'rail' ? 1 : 0);
    }
    s.road = road; s.mud = mud; s.asph = asph;
    s.water = (y !== undefined && y < WATER_Y) ? clamp((WATER_Y - y) * 1.5, 0, 1) : 0;
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
  collideStatic() {
    const S = this.scatter, P = this.props;
    const sph = [];
    for (const c of this.cars) {
      if (c.asleep || c.remote) continue;
      c.spheres(sph);
      for (const s of sph) {
        const list = S.near(s.p.x, s.p.z);
        if (list) for (const o of list) {
          if (o.off || s.p.y - s.r > o.top || (o.bot !== undefined && s.p.y + s.r < o.bot) || !o.sub !== !c.under) continue;
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
          if (vn < 0) {
            const soft = o.kind === 'rail' || o.kind === 'barrier' ? 1.05 : 1.25;
            const J = new V3(nx, 0, nz).multiplyScalar(-vn * soft * c.spec.mass);
            if (o.kind === 'rail' || o.kind === 'barrier' || o.kind === 'building' || o.kind === 'container') { // scrape along walls instead of sticking
              const vt = new V3(c.vel.x - vn * nx, 0, c.vel.z - vn * nz);
              J.addScaledVector(vt, -0.12 * c.spec.mass);
            }
            c.applyImpulse(J, new V3(cx, s.p.y, cz));
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
