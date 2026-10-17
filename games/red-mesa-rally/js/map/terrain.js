'use strict';
/* Red Mesa Rally · Terrain grid: heights, road carving, surfaces and collision queries */

/* ---------- Terrain grid ---------- */
class Terrain {
  constructor() {
    const { Nx, Nz, cell } = WORLD, n = Nx * Nz;
    this.Nx = Nx; this.Nz = Nz; this.cell = cell; this.x0 = WORLD.x0; this.z0 = WORLD.z0;
    this.h = new Float32Array(n);
    this.road = new Float32Array(n); this.mud = new Float32Array(n); this.asph = new Float32Array(n); this.rail = new Float32Array(n);
    this.rdist = new Float32Array(n).fill(1e9); this.rlat = new Float32Array(n).fill(40); this.rhw = new Float32Array(n).fill(8); this.rs = new Float32Array(n); this.rlanes = new Uint8Array(n); this.rown = new Uint8Array(n);
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
    yield 'Paving Port Calder';
    for (let iz = 0; iz < Nz; iz++) for (let ix = 0; ix < Nx; ix++) {
      const i = iz * Nx + ix, x = x0 + ix * cell, z = z0 + iz * cell;
      if (x < 1100) continue;
      const b = biomeAt(x, z, this.h[i]);
      this.green[i] = b.green * 255; this.beach[i] = b.beach * 255; this.forest[i] = b.forest * 255;
      this.city[i] = cityCell(x, z) * 255;
      if (this.city[i]) { this.green[i] = this.city[i] < 200 ? 230 : 40; this.beach[i] = 0; }
    }
    // the finale reuses existing roads end to end
    const R = (id) => this.routes.find((r) => r.id === id);
    const fin = Route.compose({ id: 'finale', closed: false, width: 14, surface: 'asphalt', noCarve: true }, [
      { route: R('coast'), from: [4210, CITY.z1 - 4], to: [2350, 210], dir: -1 },
      { route: R('hwy'), from: [2350, 210], to: [1700, 0], dir: -1 },
      { route: R('tunnel'), from: [1700, 0], to: [792, 10], dir: -1 },
      { route: R('ridge'), from: [790, 12], to: [330, 60], dir: 1 },
      { route: R('trail-ridge'), from: [330, 60], to: [70, 110], dir: -1 },
    ]);
    for (let i = 0; i <= fin.count; i++) fin.y[i] = this.height(fin.x[i], fin.z[i]);
    this.routes.push(fin);
    // Exit 5 Express: down the interstate from the tunnel, off at Exit 5 and through downtown to the docks
    const exp = Route.compose({ id: 'express', closed: false, width: 13, surface: 'asphalt', noCarve: true }, [
      { route: R('hwy'), from: [1700, 0], to: [3205, -88], dir: 1 },
      { route: R('exit-5'), from: [3211, -84], to: [CX(3), -440], dir: 1 },
      { route: R('harbour'), from: [CX(3), -440], to: [CX(8), CZ(9)], dir: 1 },
    ]);
    for (let i = 0; i <= exp.count; i++) exp.y[i] = this.height(exp.x[i], exp.z[i]);
    this.routes.push(exp);
    // the Calder Metro loop (its road centreline) and the floor grid that stands in for the ground underneath downtown
    const metro = new Route({ id: 'metro', closed: true, width: 12, surface: 'asphalt', noCarve: true, metro: true, lanes: 2, sub: 6, pts: arcLoop(METRO.corners.map(([i, j]) => [CX(i), CZ(j)]), 52) });
    metro.y.fill(METRO.y); this.routes.push(metro);
    this.buildMetro(metro);
    // traffic lanes: the open roads driven the other way, and loops round the downtown blocks
    const rev = (id) => { const d = R(id).def; return { ...d, id: id + '-rev', pts: d.pts.slice().reverse(), keepStart: true, rails: false, tunnel: false }; };
    const loop = (id, a, b, c, d) => ({ id, closed: true, width: 16, surface: 'asphalt', pts: streetPath([[CX(a), CZ(b)], [CX(c), CZ(b)], [CX(c), CZ(d)], [CX(a), CZ(d)]], true), keepStart: true });
    const tdefs = [rev('hwy'), rev('coast'), rev('tunnel'), rev('pass'), rev('lane-valley'), rev('lane-farm'),
      loop('city-a', 1, 1, 5, 4), loop('city-b', 7, 1, 11, 6), loop('city-c', 2, 5, 6, 9), loop('city-d', 9, 3, 12, 10)];
    tdefs.push({ ...tdefs[6], id: 'city-a-rev', pts: tdefs[6].pts.slice().reverse() }, { ...tdefs[8], id: 'city-c-rev', pts: tdefs[8].pts.slice().reverse() });
    tdefs.push(rev('exit-5'), rev('lane-orchard'), rev('lane-mill'));
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
    if (x < CITY.x0 - 30) return h;
    if (this.metro) { const f = this.subFloor(x, z); if (f !== null) return f; }
    return this.ovGrid ? this.overlayHeight(x, z, h) : h;
  }
  /* metro mask on a 2 m grid: 0 solid ground, 1 the loop, 2 + k portal ramp k */
  buildMetro(R) {
    const G = 2, x0 = CITY.x0 - 40, z0 = CITY.z0 - 40, nx = Math.ceil((CITY.x1 - CITY.x0 + 80) / G) + 1, nz = Math.ceil((CITY.z1 - CITY.z0 + 80) / G) + 1;
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
    for (const o of a) if (overlayLift(o, x, z) > -Infinity) { if (!o.kind) return o; if (!kickOnly) hit = hit || o; }
    return hit;
  }
  rampAt(x, z) { return this.overlayAt(x, z, true); }
  overlayHeight(x, z, h) {
    const a = this.ovGrid.get(Math.floor(x / 32) * 100000 + Math.floor(z / 32)); if (!a) return h;
    for (const o of a) { const y = overlayLift(o, x, z); if (y > h) h = y; }
    return h;
  }
  normal(x, z, out) {
    if (this.ovGrid && x > CITY.x0 - 30 && (this.overlayAt(x, z) || (this.metro && this.subFloor(x, z) !== null))) { // raised pieces and the metro: slope from the height function
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
    const order = [...this.routes].sort((a, b) => rank(a) - rank(b));
    const done = [];
    // junction bookkeeping: which road owns each cell's markings, and how close the widest road nearby is
    const ownD = new Float32Array(n).fill(1e9), ownP = new Uint8Array(n), zid = new Uint8Array(n), multi = new Uint8Array(n);
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
      if (def.tunnel) { // bore straight through the mountain between the portal approaches
        const a = prof[0], b = prof[nS];
        for (let i = 0; i <= nS; i++) prof[i] = Math.min(prof[i], lerp(a, b, i / nS) + 0.5);
      }
      if (def.street) for (let i = 0; i <= nS; i++) prof[i] = CITY.y;
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
      // level crossings: engineered roads pin the rail height into the grade limiter below
      const hits = [];
      if (R.surface !== 'rail' && railHash.size) {
        for (let i = 0; i <= nS; i++) { const ry = railAt(R.x[i], R.z[i]); if (ry !== null && (!hits.length || i - hits[hits.length - 1][0] > 30)) hits.push([i, ry]); }
        if (def.grade) for (const [c, ry] of hits) for (let k = -3; k <= 3; k++) { const i = R.idx(c + k); if (R.closed || (c + k >= 0 && c + k <= nS)) pin[i] = ry; }
      }
      const pinned = pin.some((v) => !isNaN(v));
      if (def.grade) { // engineered roads: limit the gradient with alternating sweeps, then soften the kinks
        const g = def.grade * R.step;
        for (let i = 0; i <= nS; i++) if (!isNaN(pin[i])) prof[i] = pin[i];
        for (let it = 0; it < 4; it++) {
          for (let i = 1; i <= nS; i++) { const a = prof[R.idx(i - 1)]; prof[i] = isNaN(pin[i]) ? clamp(prof[i], a - g, a + g) : pin[i]; }
          for (let i = nS - 1; i >= 0; i--) { const a = prof[R.idx(i + 1)]; prof[i] = isNaN(pin[i]) ? clamp(prof[i], a - g, a + g) : pin[i]; }
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
      R.feature = feat;
      if (R.surface === 'rail') for (let i = 0; i <= nS; i++) { const k = rkey(R.x[i], R.z[i]); let l = railHash.get(k); if (!l) railHash.set(k, l = []); l.push([R.x[i], R.z[i], R.y[i]]); }
      // tunnel cover: where the untouched mountain stands well above the road
      if (def.tunnel) {
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
