'use strict';
/* Red Mesa Rally · World setup: trains and stations, tunnel, metro and bridge walls, village, stadium, quays, level crossings */

Object.assign(World.prototype, {
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
    this.passenger = new Train(this, R, { name: 'Calder Valley Line', consist: ['loco', 'coach', 'coach', 'coach', 'coach'], stops: ['millbrook', 'port', 'union'], vmax: 31, dwell: 20 });
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
  },
  /* Calder Tunnel: the lined bore and its portal headwalls, shared by the meshes and the colliders */
  tunnelSpan() { return this.tunnelSpans().find((t) => t.R.id === 'tunnel') || null; },
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
  },
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
  },
  addTunnelWalls() { for (const tun of this.tunnelSpans()) this.addTunnelWallsFor(tun); },
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
  },
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
    // both walls in runs between the ramps that come in through them
    for (const [side, wl] of [[-1, METRO.wallL - 0.3], [1, METRO.wallR]]) {
      const gaps = M.spurs.filter((sp) => sp.side === side).map((sp) => sp.gap).sort((a, b) => a[0] - b[0]);
      let s = gaps.length ? gaps[gaps.length - 1][1] - R.length : 0;
      for (const [g0, g1] of gaps) { line(s, g0, wl, top, 0.3); s = g1; }
      if (!gaps.length) line(0, R.length, wl, top, 0.3);
    }
    for (const sp of M.spurs) for (const sd of [-1, 1]) {
      const l = sd * (METRO.rampHw + 0.3), aEnd = metroSpurEnd(sp, sd) - 0.3;
      for (let a = 0; a < aEnd; a += 6) {
        const b = Math.min(aEnd, a + 6);
        seg(sp.x + sp.dx * a - sp.dz * l, sp.z + sp.dz * a + sp.dx * l, sp.x + sp.dx * b - sp.dz * l, sp.z + sp.dz * b + sp.dx * l, metroSpurY(a) + 3.6, 0.3);
      }
    }
    // up on the street: the station hall's side walls and back wall, from the street up to its roof
    for (const sp of M.spurs) {
      const g = METRO.rampHw + 0.6, P = (a, l) => [sp.x + sp.dx * a - sp.dz * l, sp.z + sp.dz * a + sp.dx * l], top = CITY.y + METRO.hallH;
      const par = (p, q) => { const o = S.addSegment(...p, ...q, top, 'barrier'); o.r = 0.5; o.bot = CITY.y - 0.8; };
      for (const sd of [-1, 1]) for (let a = 0; a < sp.cover; a += 8) par(P(a, sd * g), P(Math.min(sp.cover, a + 8), sd * g));
      par(P(sp.cover, -g), P(sp.cover, g));
      const t = P(0.55, -(METRO.rampHw + 1.75)), o = S.addObstacle(t[0], t[1], 0.75, top + 3.5, 'barrier'); o.bot = CITY.y - 0.8; // the METRO totem at the front corner
    }
  },
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
      for (const t of B.bents || []) for (const L of t.legs) { const o = S.addObstacle(L.fx, L.fz, 0.45, t.top, 'barrier'); o.bot = L.bot; }
    }
    // the boat tunnel's side walls: real walls down at the water, so a boat glances off them instead of being lifted onto the lid
    const U = RIVER.tunnel;
    for (let i = 0; i < U.pts.length - 1; i++) {
      if (U.s[i] < U.open[0] || U.s[i + 1] > U.open[1]) continue;
      const [ax, az] = U.pts[i], [bx, bz] = U.pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (const l of [-U.hw, U.hw]) { const o = S.addSegment(ax + nx * l, az + nz * l, bx + nx * l, bz + nz * l, U.ceil, 'barrier'); o.r = 0.4; o.bot = U.bed - 1; o.tunWall = true; }
    }
  },
  /* Millbrook: every house a solid box */
  addVillage() {
    const S = this.scatter;
    for (const o of this.terrain.village) {
      if (o.kind === 'lookout') { for (const [ax, az, bx, bz] of lookoutWall(o)) { const T = this.terrain; S.addSegment(ax, az, bx, bz, Math.max(T.rawH(ax, az), T.rawH(bx, bz)) + 0.9, 'rail').r = 0.35; } continue; }
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw), P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [o.x + a * o.w / 2 * c + b * o.d / 2 * s, o.z - a * o.w / 2 * s + b * o.d / 2 * c]);
      for (let k = 0; k < 4; k++) { const [ax, az] = P[k], [bx, bz] = P[(k + 1) % 4]; S.addSegment(ax, az, bx, bz, o.y1 + o.h, 'barrier').r = 0.3; }
      if (o.wheel) S.addObstacle(o.wheel.x, o.wheel.z, 1.4, WATER_Y + o.wheel.r * 1.6, 'barrier');
    }
    // the Calder dam: a wall across the stream, so boats stay on the sea-level water below it
    { const D = RIVER.dam, w = D.hw + 3; S.addSegment(D.x + D.dz * w, D.z - D.dx * w, D.x - D.dz * w, D.z + D.dx * w, D.surf + 0.5, 'barrier').r = 1.6; }
  },
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
  },
  addQuays() {
    const S = this.scatter, top = CITY.y - 1.2, zq = FLAT.z1 + 1.2, xq = FLAT.x1 + 1.2;
    const south = [[4150, SLIP.x - SLIP.hw - 0.6], [SLIP.x + SLIP.hw + 0.6, xq]];
    // the quay edge in 4 m pieces, open wherever a road runs across it (the coast road's bridge at the river mouth) or the river runs out through it
    const roads = this.terrain.routes.filter((R) => !R.def.noCarve && !R.def.trafficOnly && R.surface !== 'rail');
    const onRoad = (x, z) => roads.some((R) => R.project(x, z, 0, -1).dist < R.width / 2 + 1.5);
    const T = this.terrain, edge = (ax, az, bx, bz) => { const mx = (ax + bx) / 2, mz = (az + bz) / 2; if (onRoad(mx, mz) || T.river[T.gi(mx, mz)]) return; const o = S.addSegment(ax, az, bx, bz, top, 'barrier'); o.r = 0.8; };
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
  },
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
  },
});
