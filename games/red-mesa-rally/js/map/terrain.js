'use strict';
/* Red Mesa Rally · Terrain grid: heights, road carving, surfaces and collision queries */

/* ---------- Terrain grid ---------- */
class Terrain {
  constructor() {
    const { Nx, Nz, cell } = WORLD, n = Nx * Nz;
    this.Nx = Nx; this.Nz = Nz; this.cell = cell; this.x0 = WORLD.x0; this.z0 = WORLD.z0;
    this.h = new Float32Array(n);
    this.road = new Float32Array(n); this.mud = new Float32Array(n); this.asph = new Float32Array(n); this.rail = new Float32Array(n);
    this.rdist = new Float32Array(n).fill(1e9); this.rlat = new Float32Array(n).fill(40); this.rhw = new Float32Array(n).fill(8); this.rs = new Float32Array(n); this.rlanes = new Uint8Array(n); this.rown = new Uint16Array(n);
    this.rfade = new Uint8Array(n); // 255 = junction mouth: hide markings and lane patterns that would clash
    this.green = new Uint8Array(n); this.beach = new Uint8Array(n); this.city = new Uint8Array(n); this.tun = new Uint8Array(n); this.forest = new Uint8Array(n);
    this.probeY = Infinity; // height of whoever is asking: below METRO.under, the metro floor replaces the street above it
  }
  *build() {
    const { Nx, Nz, cell, x0, z0 } = this;
    for (let iz = 0; iz < Nz; iz++) {
      const z = z0 + iz * cell;
      for (let ix = 0; ix < Nx; ix++) this.h[iz * Nx + ix] = naturalHeight(x0 + ix * cell, z);
      if (iz % 250 === 0) yield 'Raising the mountains';
    }
    this.routes = ROUTE_DEFS.map((d) => new Route(d));
    yield 'Surveying the roads';
    this.carve();
    yield 'Running the river';
    carveRiver(this);
    this.bridges = findBridges(this);
    this.village = planVillage(this);
    yield 'Paving Port Calder';
    for (let iz = 0; iz < Nz; iz++) for (let ix = 0; ix < Nx; ix++) {
      const i = iz * Nx + ix, x = x0 + ix * cell, z = z0 + iz * cell;
      if (x < 1100) continue;
      const b = biomeAt(x, z, this.h[i]);
      this.green[i] = b.green * 255; this.beach[i] = b.beach * 255; this.forest[i] = b.forest * 255;
      this.city[i] = DISTRICT.cell(x, z) * 255;
      if (this.city[i]) { this.green[i] = this.city[i] < 200 ? 230 : 40; this.beach[i] = 0; }
    }
    // the finale reuses existing roads end to end
    const R = (id) => this.routes.find((r) => r.id === id);
    // heights along a composed route: the deck where it runs on a bridge or the viaduct, the ground elsewhere
    // (where one passes over another, it stays on whichever level it was already on)
    const heights = (C, ids) => {
      let prev = null;
      for (let i = 0; i <= C.count; i++) {
        // on one of its own roads (centreline within 1.5 m) the bare ground is not a choice: a deck that climbs away gently would lose to it
        const ys = [], on = [];
        for (const id of ids) { const O = R(id), pr = O.project(C.x[i], C.z[i], 0, -1); if (pr.dist < O.width / 2) { ys.push(O.sample(O.y, pr.s)); if (pr.dist < 1.5) on.push(ys[ys.length - 1]); } }
        if (on.length) ys.splice(0, ys.length, ...on); else ys.push(this.height(C.x[i], C.z[i]));
        C.y[i] = prev === null ? Math.max(...ys) : ys.reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a)); prev = C.y[i];
      }
    };
    const fin = Route.compose({ id: 'finale', closed: false, width: 14, surface: 'asphalt', noCarve: true }, [
      { route: R('coast'), from: [4600, 770], to: [2350, 210], dir: -1 },
      { route: R('valley-rd'), from: [2350, 210], to: [2200, 320], dir: -1 },
      { route: R('hwy'), from: [2200, 320], to: [1760, -40], dir: 1 },
      { route: R('tunnel'), from: [1760, -40], to: [792, 10], dir: -1 },
      { route: R('ridge'), from: [790, 12], to: [330, 60], dir: 1 },
      { route: R('trail-ridge'), from: [330, 60], to: [70, 110], dir: -1 },
    ]);
    heights(fin, ['coast', 'valley-rd', 'hwy']);
    this.routes.push(fin);
    // Calder Central Express: up the interstate from the tunnel, round over the pass junction, along the viaduct, down the Calder Central ramp,
    // across downtown on Mesa Blvd and down Kingsway to the port gate
    const exp = Route.compose({ id: 'express', closed: false, width: 13, surface: 'asphalt', noCarve: true }, [
      { route: R('hwy'), from: [1760, -40], to: [3897, -730], dir: 1 },
      { route: R('ramp-central-w'), from: [3897, -730], to: [3846, -338], dir: 1 },
      { route: R('mesa-blvd'), from: [3846, -338], to: [4296, -350], dir: 1 },
      { route: R('kingsway'), from: [4296, -350], to: [4290, 520], dir: 1 },
    ]);
    heights(exp, ['hwy', 'ramp-central-w', 'mesa-blvd', 'kingsway']);
    this.routes.push(exp);
    // the Harbour street circuit: down Kingsway past the stadium, along the port gate, up Harbour Dr on the waterfront and back across town on Mesa Blvd
    const hb = [{ route: R('kingsway'), from: [4296, -350], to: [4290, 540], dir: 1 }, { route: R('gate-rd'), from: [4290, 540], to: [4950, 560], dir: 1 },
      { route: R('harbour-dr'), from: [4950, 560], to: [5116, -346], dir: 1 }, { route: R('mesa-blvd'), from: [5116, -346], to: [4296, -350], dir: -1 }];
    const harbour = Route.compose({ id: 'harbour', closed: true, width: 16, surface: 'asphalt', noCarve: true, street: true }, hb);
    heights(harbour, ['kingsway', 'gate-rd', 'harbour-dr', 'mesa-blvd']);
    this.routes.push(harbour);
    // the Calder Metro loop (its road centreline) and the floor grid that stands in for the ground underneath downtown
    const metro = new Route({ id: 'metro', closed: true, width: 12, surface: 'asphalt', noCarve: true, metro: true, lanes: 2, sub: 6, pts: METRO.loop });
    metro.y.fill(METRO.y); this.routes.push(metro);
    this.buildMetro(metro);
    // the river race line: never carved, it just rides the water
    const river = new Route({ id: 'river', closed: false, width: 40, surface: 'water', noCarve: true, boat: true, slack: 260, pts: RIVER.racePts });
    river.y.fill(WATER_Y); this.routes.push(river);
    // traffic lanes: the open roads driven the other way, and loops round the downtown blocks
    const rev = (id) => { const d = R(id).def; return { ...d, id: id + '-rev', pts: d.pts.slice().reverse(), keepStart: true, rails: false, tunnel: false }; };
    const loop = (id, parts) => { const L = Route.compose({ id, closed: true, width: 14, surface: 'asphalt', noCarve: true, keepStart: true }, parts); return { ...L.def, pts: Array.from(L.x, (x, i) => [x, L.z[i]]).filter((p, i) => i % 3 === 0), sub: 4 }; };
    const tdefs = [rev('hwy'), rev('coast'), rev('tunnel'), rev('pass'), rev('lane-valley'), rev('lane-farm'), loop('city-a', hb)];
    tdefs.push({ ...tdefs[6], id: 'city-a-rev', pts: tdefs[6].pts.slice().reverse() });
    tdefs.push(rev('valley-rd'), rev('lane-orchard'), rev('lane-mill'), rev('kingsway'), rev('mesa-blvd'), rev('north-rd'), rev('harbour-dr'));
    for (const d of tdefs) {
      const T2 = new Route({ ...d, noCarve: true, trafficOnly: true });
      for (let i = 0; i <= T2.count; i++) T2.y[i] = this.height(T2.x[i], T2.z[i]);
      this.routes.push(T2);
    }
  }
  gi(x, z) { const ix = clamp(Math.round((x - this.x0) / this.cell), 0, this.Nx - 1), iz = clamp(Math.round((z - this.z0) / this.cell), 0, this.Nz - 1); return iz * this.Nx + ix; }
  rawH(x, z) { return this.heightGrid(this.h, x, z); }
  heightGrid(arr, x, z) {
    const Nx = this.Nx, c = this.cell;
    const fx = clamp((x - this.x0) / c, 0, Nx - 1.001), fz = clamp((z - this.z0) / c, 0, this.Nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz); const tx = fx - ix, tz = fz - iz;
    const k = iz * Nx + ix, a = arr[k], b = arr[k + 1], cc = arr[k + Nx], d = arr[k + Nx + 1];
    if (tx + tz <= 1) return a + (b - a) * tx + (cc - a) * tz;
    return d + (cc - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  height(x, z) {
    const h = this.heightGrid(this.h, x, z);
    const tk = this.riverTunAt(x, z);
    if (tk) { const M = this.riverTun; return M.mask[tk - 1] === 1 && this.probeY < RIVER.tunnel.under ? RIVER.tunnel.bed : M.top[tk - 1]; }
    if (x < CITY.x0 - 30) return this.ovGrid ? this.overlayHeight(x, z, h) : h;
    if (this.metro) { const f = this.subFloor(x, z); if (f !== null) return f; }
    return this.ovGrid ? this.overlayHeight(x, z, h) : h;
  }
  /* inside the covered bore of the boat tunnel (whoever is asking decides whether that is the ground) */
  inRiverTunnel(x, z) { const k = this.riverTunAt(x, z); return k > 0 && this.riverTun.mask[k - 1] === 1; }
  /* 1 + the cell index when (x, z) is under the boat tunnel's lid, else 0 */
  riverTunAt(x, z) {
    const M = this.riverTun; if (!M) return 0;
    const i = Math.round((x - M.x0) / M.G), j = Math.round((z - M.z0) / M.G);
    return i >= 0 && j >= 0 && i < M.nx && j < M.nz && M.mask[j * M.nx + i] ? j * M.nx + i + 1 : 0;
  }
  /* metro mask on a 2 m grid: 0 solid ground, 1 the loop, 2 + k portal ramp k */
  buildMetro(R) {
    const B = METRO.box, G = 2, x0 = B.x0, z0 = B.z0, nx = Math.ceil((B.x1 - B.x0) / G) + 1, nz = Math.ceil((B.z1 - B.z0) / G) + 1;
    const M = this.metro = { G, x0, z0, nx, nz, mask: new Uint8Array(nx * nz), R, spurs: metroSpurs() };
    const stamp = (x, z, v) => { const i = Math.round((x - x0) / G), j = Math.round((z - z0) / G); if (i >= 0 && j >= 0 && i < nx && j < nz) M.mask[j * nx + i] = v; };
    for (const sp of M.spurs) {
      for (let a = 0; a <= sp.L; a += 1) for (let l = -METRO.rampHw - 1; l <= METRO.rampHw + 1; l += 1) stamp(sp.x + sp.dx * a - sp.dz * l, sp.z + sp.dz * a + sp.dx * l, 2 + sp.k);
      // where the ramp meets the loop, and how far along the loop that is
      const ex = sp.x + sp.dx * sp.L, ez = sp.z + sp.dz * sp.L; sp.s = R.project(ex, ez, 0, -1).s;
    }
    for (let s = 0; s < R.length; s += 1) {
      const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
      for (let l = METRO.wallL - 1; l <= METRO.wallR + 1; l += 1) stamp(p.x - dz * l, p.z + dx * l, 1);
    }
  }
  /* the metro mask value under (x, z) */
  metroAt(x, z) {
    const M = this.metro; if (!M) return 0;
    const i = Math.round((x - M.x0) / M.G), j = Math.round((z - M.z0) / M.G);
    return i < 0 || j < 0 || i >= M.nx || j >= M.nz ? 0 : M.mask[j * M.nx + i];
  }
  /* floor of the metro under (x, z) for the current probe, or null for the ground above */
  subFloor(x, z) {
    const m = this.metroAt(x, z); if (!m) return null;
    if (m === 1) return this.probeY < METRO.under ? METRO.y : null;
    const sp = this.metro.spurs[m - 2], a = (x - sp.x) * sp.dx + (z - sp.z) * sp.dz;
    return a < sp.cover || this.probeY < METRO.under ? metroSpurY(a) : null; // inside the portal building the ramp is the only ground
  }
  subCeil(x, z) {
    const m = this.metroAt(x, z); if (!m) return null;
    if (m === 1) return this.probeY < METRO.under ? METRO.ceil : null;
    const sp = this.metro.spurs[m - 2], a = (x - sp.x) * sp.dx + (z - sp.z) * sp.dz;
    return a < sp.cover || this.probeY < METRO.under ? metroSpurCeil(a) : null;
  }
  /* run fn with the height queries answering for something at height y */
  probe(y, fn) { const o = this.probeY; this.probeY = y; try { return fn(); } finally { this.probeY = o; } }
  setOverlays(list) {
    this.ovGrid = new Map(); this.overlays = list;
    for (const o of list) {
      const [x0, z0, x1, z1] = overlayBox(o);
      for (let i = Math.floor(x0 / 32); i <= Math.floor(x1 / 32); i++) for (let j = Math.floor(z0 / 32); j <= Math.floor(z1 / 32); j++) {
        const k = i * 100000 + j; let a = this.ovGrid.get(k); if (!a) this.ovGrid.set(k, a = []); a.push(o);
      }
    }
  }
  /* the overlay piece under (x, z), kickers first (they sit on top of roofs) */
  overlayAt(x, z, kickOnly) {
    const a = this.ovGrid && this.ovGrid.get(Math.floor(x / 32) * 100000 + Math.floor(z / 32)); if (!a) return null;
    let hit = null;
    for (const o of a) if ((o.under === undefined || this.probeY >= o.under) && overlayLift(o, x, z) > -Infinity) { if (!o.kind) return o; if (!kickOnly) hit = hit || o; }
    return hit;
  }
  rampAt(x, z) { return this.overlayAt(x, z, true); }
  overlayHeight(x, z, h) {
    const a = this.ovGrid.get(Math.floor(x / 32) * 100000 + Math.floor(z / 32)); if (!a) return h;
    for (const o of a) { if (o.under !== undefined && this.probeY < o.under) continue; const y = overlayLift(o, x, z); if (y > h) h = y; }
    return h;
  }
  normal(x, z, out) {
    if (this.riverTunAt(x, z)) { out.x = 0; out.y = 1; out.z = 0; return out; } // the bore's water and the lid over it are both flat
    if (this.ovGrid && (this.overlayAt(x, z) || (x > CITY.x0 - 30 && this.metro && this.subFloor(x, z) !== null))) { // raised pieces and the metro: slope from the height function
      const e = 0.3, dhdx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e), dhdz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e), l = Math.hypot(dhdx, 1, dhdz);
      out.x = -dhdx / l; out.y = 1 / l; out.z = -dhdz / l; return out;
    }
    const Nx = this.Nx, c = this.cell, H = this.h;
    const fx = clamp((x - this.x0) / c, 0, Nx - 1.001), fz = clamp((z - this.z0) / c, 0, this.Nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz); const tx = fx - ix, tz = fz - iz;
    const k = iz * Nx + ix, a = H[k], b = H[k + 1], cc = H[k + Nx], d = H[k + Nx + 1];
    let dhdx, dhdz;
    if (tx + tz <= 1) { dhdx = (b - a) / c; dhdz = (cc - a) / c; } else { dhdx = (d - cc) / c; dhdz = (d - b) / c; }
    const l = Math.hypot(dhdx, 1, dhdz);
    out.x = -dhdx / l; out.y = 1 / l; out.z = -dhdz / l; return out;
  }
  bilinear(arr, x, z) {
    const Nx = this.Nx, c = this.cell;
    const fx = clamp((x - this.x0) / c, 0, Nx - 1.001), fz = clamp((z - this.z0) / c, 0, this.Nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, k = iz * Nx + ix;
    return lerp(lerp(arr[k], arr[k + 1], tx), lerp(arr[k + Nx], arr[k + Nx + 1], tx), tz);
  }
  carve() {
    const { Nx, Nz, cell: c, x0, z0 } = this, n = Nx * Nz;
    const wsum = new Float32Array(n), tsum = new Float32Array(n), wmax = new Float32Array(n);
    const rng = mulberry32(42);
    // rail first (roads meet it at level crossings), then the closed highway loop, then everything that joins it
    const rank = (r) => r.surface === 'rail' ? 0 : r.closed && r.surface === 'asphalt' && !r.def.street ? 1 : 2;
    // and a road that ends on another always comes after it, so it can take that road's height where they meet
    const ranked = [...this.routes].sort((a, b) => rank(a) - rank(b)), deps = new Map(), order = [], state = new Map();
    for (const R of ranked) {
      const d = [];
      if (!R.closed && R.surface !== 'rail' && !R.def.noCarve) for (const e of [0, R.count]) for (const O of ranked) {
        if (O === R || O.def.noCarve || O.surface === 'rail' || rank(O) < rank(R)) continue;
        if (O.project(R.x[e], R.z[e], 0, -1).dist <= O.width / 2 + 3) d.push(O);
      }
      deps.set(R, d);
    }
    const visit = (R) => { if (state.get(R)) return; state.set(R, 1); for (const O of deps.get(R)) visit(O); order.push(R); };
    for (const R of ranked) visit(R);
    const done = [];
    // junction bookkeeping: which road owns each cell's markings, and how close the widest road nearby is
    const ownD = new Float32Array(n).fill(1e9), ownP = new Uint8Array(n), zid = new Uint16Array(n), multi = new Uint8Array(n);
    const majP = new Uint8Array(n), majE = new Float32Array(n).fill(1e9), ZONE = 14, MARGIN = 6;
    const railHash = new Map(), rkey = (x, z) => Math.floor(x / 20) * 100000 + Math.floor(z / 20);
    const railAt = (x, z) => { let best = 1e9, y = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = railHash.get(rkey(x + a * 20, z + b * 20)); if (l) for (const [rx, rz, ry] of l) { const d = Math.hypot(rx - x, rz - z); if (d < best) { best = d; y = ry; } } } return best < 6 ? y : null; };
    for (const R of order) {
      const nS = R.count, def = R.def;
      let prof = new Float32Array(nS + 1);
      for (let i = 0; i <= nS; i++) prof[i] = Math.max(this.rawH(R.x[i], R.z[i]), WATER_Y + 0.9);
      // an open road that ends on another road takes that road's height for the stretch where they share tarmac
      const pin = new Float32Array(nS + 1).fill(NaN), endY = [null, null];
      if (!R.closed && R.surface !== 'rail') for (const [e, dir] of [[0, 1], [nS, -1]]) {
        for (const O of done) {
          const pe = O.project(R.x[e], R.z[e], 0, -1), reach = O.width / 2 + 4;
          if (pe.dist > O.width / 2 + 3) continue;
          for (let k = e, hint = pe.s; k >= 0 && k <= nS; k += dir) {
            const pk = O.project(R.x[k], R.z[k], hint, 40); if (pk.dist > reach) break;
            pin[k] = O.sample(O.y, pk.s); hint = pk.s;
          }
          endY[e ? 1 : 0] = pin[e]; prof[e] = pin[e]; break;
        }
      }
      // the railway out west: on a viaduct well clear of the desert floor, wherever it is not in a bore
      const bores = (def.bores || []).map(([a, b]) => { let i = Math.round(R.project(a[0], a[1], 0, -1).s / R.step), j = Math.round(R.project(b[0], b[1], 0, -1).s / R.step); if (i > j) [i, j] = [j, i]; return [Math.max(0, i - 4), Math.min(nS, j + 4)]; });
      const inBore = (i) => bores.some(([a, b]) => i >= a && i <= b);
      if (def.lowland) {
        const env = new Float32Array(nS + 1), W = 40;
        for (let i = 0; i <= nS; i++) if (R.x[i] < def.lowland) { let m = -1e9; for (let k = -W; k <= W; k++) { const j = R.idx(i + k); if (!inBore(j)) m = Math.max(m, this.rawH(R.x[j], R.z[j])); } env[i] = m; }
        for (let i = 0; i <= nS; i++) if (R.x[i] < def.lowland && !inBore(i)) prof[i] = env[i] + 7.8;
      }
      if (def.tunnel) { // bore straight through the mountain between the portal approaches
        const a = prof[0], b = prof[nS];
        for (let i = 0; i <= nS; i++) prof[i] = Math.min(prof[i], lerp(a, b, i / nS) + 0.5);
      }
      for (const [a, b] of bores) for (let i = a; i <= b; i++) prof[i] = Math.min(prof[i], lerp(prof[a], prof[b], (i - a) / (b - a)) + 0.5);
      const win = def.smoothWin || (def.trail ? 10 : 18);
      for (let pass = 0; pass < (def.passes || 4); pass++) {
        const out = new Float32Array(nS + 1);
        let acc = 0, cnt = 0;
        // sliding-window box filter (O(n))
        for (let j = -win; j <= win; j++) { acc += prof[R.idx(j)]; cnt++; }
        for (let i = 0; i <= nS; i++) { out[i] = acc / cnt; acc += prof[R.idx(i + win + 1)] - prof[R.idx(i - win)]; }
        prof = out;
      }
      if (!R.closed) for (let i = 0; i <= nS; i++) {
        const t = Math.min(i, nS - i) * R.step, w = smooth(0, 40, t), ey = endY[i * 2 <= nS ? 0 : 1];
        prof[i] = lerp(ey !== null ? ey : Math.max(this.rawH(R.x[i], R.z[i]), WATER_Y + 0.9), prof[i], w);
      }
      // viaducts: lifted over Port Calder's streets and over every road or railway that crosses them (one that ends on them is a junction)
      if (def.viaduct) {
        const lift = (i, y) => { pin[i] = Math.max(isNaN(pin[i]) ? prof[i] : pin[i], y); };
        if (!def.ramp) for (let i = 0; i <= nS; i++) if (DISTRICT.cell(R.x[i], R.z[i]) > 0 || (R.x[i] > FLAT.x0 && R.x[i] < FLAT.x1 && R.z[i] > FLAT.z0 && R.z[i] < FLAT.z1)) lift(i, CITY.y + 8.5);
        if (def.crossover) { // a figure of eight: the first pass through the middle goes over the second
          const C0 = [];
          for (let i = 0; i < nS; i++) for (let j = i + Math.round(200 / R.step); j < nS; j++) if (Math.hypot(R.x[i] - R.x[j], R.z[i] - R.z[j]) < 4) C0.push(i);
          const lo = Math.min(...C0), span = Math.round((R.width + 8) / R.step);
          for (let k = -span; k <= span; k++) lift(R.idx(lo + k), this.rawH(R.x[lo], R.z[lo]) + 7.8);
        }
        if (!def.ramp) {
          const H = new Map(), C = 24, key = (x, z) => Math.floor(x / C) * 100000 + Math.floor(z / C);
          for (const O of this.routes) {
            if (O === R || O.def.noCarve || O.def.trafficOnly || O.def.ramp) continue;
            for (let k = 0; k <= O.count; k += 2) {
              if (!O.closed && Math.min(k, O.count - k) * O.step < 70) continue; // the mouth of a road that joins us
              const kk = key(O.x[k], O.z[k]); let l = H.get(kk); if (!l) H.set(kk, l = []); l.push([O, k]);
            }
          }
          for (let i = 0; i <= nS; i++) {
            let best = null;
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [O, k] of H.get(key(R.x[i] + a * C, R.z[i] + b * C)) || []) {
              const d = Math.hypot(O.x[k] - R.x[i], O.z[k] - R.z[i]) - O.width / 2 - R.width / 2;
              if (d < 6) { const y = O.surface === 'rail' ? O.y[k] : this.rawH(O.x[k], O.z[k]); if (best === null || y > best) best = y; }
            }
            if (best !== null) lift(i, Math.max(best, WATER_Y + 0.9) + 7.8);
          }
        }
      }
      // the lifts are only minimums: raise the lower of two neighbouring pins so the deck never has to step between them
      if (def.viaduct && def.grade) for (let it = 0; it < 2; it++) {
        const g = def.grade * R.step;
        // a closed loop sweeps on round its seam (index nS is index 0 again)
        const n = R.closed ? 2 * nS : nS, w = (i) => (R.closed ? ((i % nS) + nS) % nS : i);
        for (let i = 1; i <= n; i++) if (!isNaN(pin[w(i)]) && !isNaN(pin[w(i - 1)])) pin[w(i)] = Math.max(pin[w(i)], pin[w(i - 1)] - g);
        for (let i = n - 1; i >= (R.closed ? -nS : 0); i--) if (!isNaN(pin[w(i)]) && !isNaN(pin[w(i + 1)])) pin[w(i)] = Math.max(pin[w(i)], pin[w(i + 1)] - g);
        if (R.closed) pin[nS] = pin[0];
      }
      // level crossings: engineered roads pin the rail height into the grade limiter below
      const hits = [];
      if (R.surface !== 'rail' && railHash.size && !def.viaduct) {
        for (let i = 0; i <= nS; i++) { const ry = railAt(R.x[i], R.z[i]); if (ry !== null && (!hits.length || i - hits[hits.length - 1][0] > 30)) hits.push([i, ry]); }
        if (def.grade) for (const [c, ry] of hits) for (let k = -3; k <= 3; k++) { const i = R.idx(c + k); if (R.closed || (c + k >= 0 && c + k <= nS)) pin[i] = ry; }
      }
      const pinned = pin.some((v) => !isNaN(v));
      if (def.grade) { // engineered roads: limit the gradient with alternating sweeps, then soften the kinks
        const g = def.grade * R.step;
        for (let i = 0; i <= nS; i++) if (!isNaN(pin[i])) prof[i] = pin[i];
        const n = R.closed ? 2 * nS : nS, w = (i) => (R.closed ? ((i % nS) + nS) % nS : i);
        for (let it = 0; it < 4; it++) {
          for (let i = 1; i <= n; i++) { const k = w(i), a = prof[w(i - 1)]; prof[k] = isNaN(pin[k]) ? clamp(prof[k], a - g, a + g) : pin[k]; }
          for (let i = n - 1; i >= (R.closed ? -nS : 0); i--) { const k = w(i), a = prof[w(i + 1)]; prof[k] = isNaN(pin[k]) ? clamp(prof[k], a - g, a + g) : pin[k]; }
          if (R.closed) prof[nS] = prof[0];
        }
        const out = new Float32Array(nS + 1), W2 = 6;
        for (let i = 0; i <= nS; i++) { let a = 0, k = 0; for (let j = -W2; j <= W2; j++) { a += prof[R.idx(i + j)]; k++; } out[i] = a / k; }
        prof = out;
      }
      if (pinned) { // smoothing moved the pins a little: put them back exactly, fading the correction over ~24 m
        const near = new Int32Array(nS + 1).fill(-1), FADE = 12;
        let last = -1; for (let i = 0; i <= nS; i++) { if (!isNaN(pin[i])) last = i; near[i] = last; }
        last = -1; for (let i = nS; i >= 0; i--) { if (!isNaN(pin[i])) last = i; if (last >= 0 && (near[i] < 0 || last - i < i - near[i])) near[i] = last; }
        const res = new Float32Array(nS + 1); for (let i = 0; i <= nS; i++) if (!isNaN(pin[i])) res[i] = pin[i] - prof[i];
        for (let i = 0; i <= nS; i++) { const p = near[i]; if (p >= 0) prof[i] += res[p] * (1 - smooth(0, FADE, Math.abs(i - p))); }
      }
      if (R.surface === 'rail' || def.grade) { /* rail is indexed below once final; graded roads pinned their crossings above */ }
      else if (hits.length) { // level crossings on ungraded roads: bring the road to the rail height smoothly
        for (const [c, ry] of hits) {
          const off = ry - prof[c], span = Math.round(Math.max(40, Math.abs(off) / 0.07) / R.step);
          for (let k = -span; k <= span; k++) { const i = R.idx(c + k); if (!R.closed && (c + k < 0 || c + k > nS)) continue; const w = 1 - smooth(4 / R.step, span, Math.abs(k)); prof[i] += off * w; }
        }
      }
      const feat = new Float32Array(nS + 1);
      if (!def.noFeatures && R.surface === 'dirt') {
        const straight = (i, span) => { let m = 0; for (let j = -span; j <= span; j++) m = Math.max(m, Math.abs(R.curv[R.idx(i + j)])); return m; };
        const taken = [];
        const pick = (count, span, minGap, startPad) => {
          const res = [], cand = [];
          for (let i = startPad; i <= nS - startPad; i += 3) cand.push([straight(i, span), i]);
          cand.sort((a, b) => a[0] - b[0]);
          for (const [k, i] of cand) {
            if (k > 0.006 || res.length >= count) break;
            if (taken.some((t) => { let d = Math.abs(t - i); if (R.closed) d = Math.min(d, nS - d); return d < minGap; })) continue;
            res.push(i); taken.push(i);
          }
          return res;
        };
        const pad = Math.round(90 / R.step);
        for (const i of pick(def.jumps || 0, 18, Math.round(160 / R.step), pad)) {
          const big = rng() < 0.5; const H = big ? 5.2 : 3.6, L = big ? 26 : 20;
          const Li = Math.round(L / R.step);
          for (let k = -Li; k <= Li + 22; k++) {
            const sm = k * R.step; let f = 0;
            if (k < 0) f = H * Math.pow((sm + L) / L, 1.7);
            else if (sm < 8) f = H * (1 - sm / 8) - 0.8 * (sm / 8);
            else f = -0.8 * (1 - (sm - 8) / 36);
            if (sm >= 44) f = 0;
            feat[R.idx(i + k)] += f;
          }
          R.jumps = R.jumps || []; R.jumps.push(i * R.step);
        }
        for (const i of pick(def.whoops || 0, 12, Math.round(120 / R.step), pad)) {
          const Lw = 90;
          for (let k = 0; k * R.step < Lw; k++) { const sm = k * R.step; feat[R.idx(i + k)] += 0.75 * Math.sin(sm / 22 * TAU) * Math.sin(Math.PI * sm / Lw); }
        }
        const mudZones = [];
        for (let m = 0; m < (def.mud || 0); m++) {
          let i0; for (let tries = 0; tries < 50; tries++) { i0 = Math.floor(rng() * nS); if (!taken.some((t) => Math.abs(t - i0) < 60)) break; }
          const len = Math.round((60 + rng() * 60) / R.step);
          mudZones.push([i0, len]);
          for (let k = 0; k <= len; k++) { const i = R.idx(i0 + k); R.mud[i] = 1; feat[i] -= 0.35 * Math.sin(Math.PI * k / len); }
        }
        R.mudZones = mudZones;
      }
      for (let i = 0; i <= nS; i++) R.y[i] = prof[i] + feat[i];
      // well clear of the ground a viaduct stands on piers: no embankment, no tarmac painted underneath
      const elev = def.viaduct || def.lowland ? R.elev = Uint8Array.from(R.y, (y, i) => y - this.rawH(R.x[i], R.z[i]) > 3.2 && (!def.lowland || R.x[i] < def.lowland + 60) ? 1 : 0) : null;
      R.feature = feat;
      if (R.surface === 'rail') for (let i = 0; i <= nS; i++) { if (R.elev && R.elev[i]) continue; const k = rkey(R.x[i], R.z[i]); let l = railHash.get(k); if (!l) railHash.set(k, l = []); l.push([R.x[i], R.z[i], R.y[i]]); }
      // tunnel cover: where the untouched mountain stands well above the road
      if (def.tunnel || def.bores) {
        R.covered = new Uint8Array(nS + 1);
        for (let i = 0; i <= nS; i++) R.covered[i] = naturalHeight(R.x[i], R.z[i]) - R.y[i] > 9.5 ? 1 : 0;
        // close tiny gaps
        for (let i = 1; i < nS; i++) if (!R.covered[i] && R.covered[i - 1] && R.covered.slice(i, i + 12).includes(1)) R.covered[i] = 1;
      }
      const hw = R.width / 2, shoulder = def.trail ? 10 : def.tunnel ? 16 : R.surface === 'rail' ? 14 : 16, reach = hw + shoulder;
      const rc = Math.ceil(reach / c) + 1;
      const isA = R.surface === 'asphalt', isR = R.surface === 'rail';
      const lanes = def.lanes || 0, prio = Math.round(R.width * 4), rid = this.routes.indexOf(R) + 1;
      for (let i = 0; i < nS; i++) {
        const j = R.idx(i + 1);
        const ax = R.x[i], az = R.z[i], bx = R.x[j], bz = R.z[j];
        const cx = Math.round((ax - x0) / c), cz = Math.round((az - z0) / c);
        for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
          const gx = cx + dx, gz = cz + dz; if (gx < 0 || gz < 0 || gx >= Nx || gz >= Nz) continue;
          const px = x0 + gx * c, pz = z0 + gz * c;
          const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
          const t = clamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1);
          const d = Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
          const gi = gz * Nx + gx;
          if (d < this.rdist[gi] && (!isR || d < hw + 2)) this.rdist[gi] = d;
          if (elev && elev[i] && elev[j]) continue;
          if (!isR) {
            // markings follow one road per cell; where roads meet, the wider road keeps its tarmac and paint
            const e = d - hw, oe = ownD[gi] - this.rhw[gi], cIn = e < MARGIN, oIn = oe < MARGIN;
            const win = cIn && oIn ? prio > ownP[gi] || (prio === ownP[gi] && d < ownD[gi]) : cIn ? true : oIn ? false : d < ownD[gi];
            if (win) { ownD[gi] = d; ownP[gi] = prio; const cr = vx * (pz - az) - vz * (px - ax); this.rlat[gi] = clamp(cr < 0 ? d : -d, -40, 40); this.rhw[gi] = hw; this.rs[gi] = (i + t) * R.step; this.rlanes[gi] = lanes; this.rown[gi] = rid; }
            if (e < ZONE) {
              if (!zid[gi]) zid[gi] = rid; else if (zid[gi] !== rid) multi[gi] = 1;
              if (prio > majP[gi] || (prio === majP[gi] && e < majE[gi])) { majP[gi] = prio; majE[gi] = e; }
            }
          }
          if (d > reach) continue;
          const cov = R.covered && (R.covered[i] || R.covered[j]);
          const w = cov ? 1 - smooth(hw + 6, reach, d) : 1 - smooth(hw + 1.5, reach, d);
          const ty = lerp(R.y[i], R.y[j], t);
          const ww = (w * w * w * w + 1e-6) * (isR ? 0.35 : 1);
          wsum[gi] += ww; tsum[gi] += ww * ty; if (w > wmax[gi]) wmax[gi] = w;
          const rw = 1 - smooth(hw - 1.2, hw + 2.2, d);
          if (isA) { const aw = 1 - smooth(hw + 0.3, hw + 1.8, d); if (aw > this.asph[gi]) this.asph[gi] = aw; }
          else if (isR) { const bw = 1 - smooth(2.6, 4.2, d); if (bw > this.rail[gi]) this.rail[gi] = bw; }
          else { const roadW = def.trail ? rw * 0.8 : rw; if (roadW > this.road[gi]) this.road[gi] = roadW; }
          if (R.mud[i]) { const mw = 1 - smooth(hw - 2, hw + 5, d); if (mw > this.mud[gi]) this.mud[gi] = mw; }
          if (cov && d < hw + 3) this.tun[gi] = 255;
        }
      }
      if (!isR) done.push(R);
    }
    for (let i = 0; i < n; i++) if (multi[i]) {
      const e = ownD[i] - this.rhw[i];
      // the main road's paint runs on to its edge; the side road's paint fades out before it reaches the mouth
      const f = ownP[i] >= majP[i] ? smooth(1.5, 4.5, e) : 1 - smooth(MARGIN, ZONE, majE[i]);
      this.rfade[i] = Math.round(f * 255);
    }
    for (let i = 0; i < n; i++) {
      if (wmax[i] > 0) this.h[i] = lerp(this.h[i], tsum[i] / wsum[i], wmax[i]);
      const shore = 1 - smooth(0.4, 2.2, this.h[i] - WATER_Y);
      if (shore > 0 && this.h[i] > WATER_Y - 3 && i % this.Nx < 520) this.mud[i] = Math.max(this.mud[i], shore * 0.85);
    }
  }
}
