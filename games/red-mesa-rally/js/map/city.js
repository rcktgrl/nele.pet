'use strict';
/* Red Mesa Rally · Port Calder: ramps, raised decks and the deterministic city layout */

/* street kicker: a long run-up, a short deck and a steep back, all raised on the physics ground */
const RAMP = { up: 16, top: 2.5, down: 7, H: 2.4, hw: 3.2 };
function rampLift(r, x, z) { // height above the street at (x, z), or -1 when off this ramp
  const rx = x - r.x, rz = z - r.z, a = rx * r.dx + rz * r.dz, l = Math.abs(rx * r.dz - rz * r.dx);
  if (a < 0 || a > r.L || l > RAMP.hw) return -1;
  const P = RAMP; let h;
  if (a < P.up) h = P.H * Math.pow(a / P.up, 1.25);
  else if (a < P.up + P.top) h = P.H;
  else h = P.H * (1 - (a - P.up - P.top) / P.down);
  return h * clamp((P.hw - l) / 0.6, 0, 1);
}
/* raised drivable ground laid over the terrain: street kickers, roof decks, car-park ramps, the ship */
function overlayLift(o, x, z) { // absolute height, or -Infinity off this piece
  if (o.kind === 'deck') return x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 ? o.y : -Infinity;
  if (o.kind === 'slope') {
    const rx = x - o.x, rz = z - o.z, a = rx * o.dx + rz * o.dz, l = Math.abs(rx * o.dz - rz * o.dx);
    if (a < 0 || a > o.Lt || l > o.hw) return -Infinity;
    return o.y0 + (o.y1 - o.y0) * Math.min(1, a / o.L);
  }
  const l = rampLift(o, x, z); return l > 0 ? o.y + l : -Infinity;
}
function overlayBox(o) {
  if (o.kind === 'deck') return [o.x0, o.z0, o.x1, o.z1];
  const L = o.kind === 'slope' ? o.Lt : o.L, w = o.kind === 'slope' ? o.hw : RAMP.hw, xs = [], zs = [];
  for (const [a, l] of [[0, -w], [0, w], [L, -w], [L, w]]) { xs.push(o.x + o.dx * a + o.dz * l); zs.push(o.z + o.dz * a - o.dx * l); }
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}
/* a rotated footprint: calls fn at points over the box inflated by m, about every 2 m */
function footprint(x, z, yaw, w, d, m, fn) {
  const c = Math.cos(yaw), s = Math.sin(yaw), W = w + 2 * m, Dp = d + 2 * m, na = Math.max(1, Math.ceil(W / 2)), nb = Math.max(1, Math.ceil(Dp / 2));
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
    const a = -W / 2 + W * i / na, b = -Dp / 2 + Dp * j / nb;
    if (fn(x + a * c + b * s, z - a * s + b * c) === false) return false;
  }
  return true;
}
function boxCorners(o) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [o.x + a * o.w / 2 * c + b * o.d / 2 * s, o.z - a * o.w / 2 * s + b * o.d / 2 * c]);
}
/* buildings: {x, z, yaw, w, d, h, base, y0, style, tone, seed, crown} plus their bounding box x0..z1; the top is base + h */
class City {
  constructor(T) {
    const rng = mulberry32(2024), D = DISTRICT;
    this.buildings = []; this.lamps = []; this.parkTrees = []; this.containers = []; this.cranes = []; this.palms = [];
    this.decks = []; this.ramps = []; this.carParks = []; this.portals = [];
    // the viaduct and the railway, each with a margin: nothing is built in their way
    const vm = new Uint8Array(T.h.length);
    const stamp = (R, w) => { for (let i = 0; i <= R.count; i++) { const [dx, dz] = R.dirAt(i * R.step); for (let l = -w; l <= w; l += 2) vm[T.gi(R.x[i] - dz * l, R.z[i] + dx * l)] = 1; } };
    for (const R of T.routes) { if (R.def.viaduct || R.def.ramp) stamp(R, R.width / 2 + 4); else if (R.surface === 'rail') stamp(R, 9); }
    // 2 m occupancy over Port Calder, so lots never overlap
    const OX = 3250, OZ = -1600, OC = 2, ONX = 1060, ONZ = 1260, occ = new Uint8Array(ONX * ONZ);
    const oi = (x, z) => { const i = Math.floor((x - OX) / OC), j = Math.floor((z - OZ) / OC); return i < 0 || j < 0 || i >= ONX || j >= ONZ ? -1 : j * ONX + i; };
    const S = D.stadium, distAt = (x, z) => D.districts.find((d) => D.pip(x, z, d.outline));
    const green = (x, z) => D.parks.some((p) => D.pip(x, z, p.poly)) || D.pip(x, z, S.lot) || Math.hypot((x - S.x) / S.rx, (z - S.z) / S.rz) < 1.2;
    // a footprint fits where it is dry, level, off every road by its sidewalk, and on free ground; returns [lo, hi]
    const fits = (x, z, yaw, w, d, walk, m) => {
      let lo = 1e9, hi = -1e9;
      const ok = footprint(x, z, yaw, w, d, m, (px, pz) => {
        const gi = T.gi(px, pz), k = oi(px, pz);
        if (k < 0 || occ[k] || vm[gi] || T.river[gi] || T.rail[gi] > 0 || T.rdist[gi] < T.rhw[gi] + walk - m - 1 || green(px, pz)) return false;
        const y = T.h[gi]; if (y < WATER_Y + 1.2) return false; lo = Math.min(lo, y); hi = Math.max(hi, y);
      });
      return ok && hi - lo < 3 ? [lo, hi] : null;
    };
    for (const sp of metroSpurs()) for (let a = 0; a <= sp.cover + 4; a += 1) for (let l = -9; l <= 9; l += 1) { const k = oi(sp.x + sp.dx * a - sp.dz * l, sp.z + sp.dz * a + sp.dx * l); if (k >= 0) occ[k] = 1; }
    const claim = (x, z, yaw, w, d, m) => footprint(x, z, yaw, w, d, m, (px, pz) => { const k = oi(px, pz); if (k >= 0) occ[k] = 1; });
    const aabb = (o) => { const P = boxCorners(o); o.x0 = Math.min(...P.map((p) => p[0])); o.x1 = Math.max(...P.map((p) => p[0])); o.z0 = Math.min(...P.map((p) => p[1])); o.z1 = Math.max(...P.map((p) => p[1])); return o; };
    const WALLS = [[0.93, 0.9, 0.84], [0.88, 0.82, 0.7], [0.78, 0.84, 0.86], [0.86, 0.74, 0.56], [0.95, 0.94, 0.92], [0.72, 0.8, 0.7], [0.9, 0.72, 0.62]];
    const ROOFS = [[0.32, 0.3, 0.3], [0.5, 0.26, 0.2], [0.38, 0.4, 0.44], [0.55, 0.36, 0.26]];
    const streets = T.routes.filter((R) => R.surface === 'asphalt' && !R.def.viaduct && !R.def.ramp && !R.def.noCarve && !R.id.startsWith('cul-'));
    // lots face the streets: walk each side of every street and put a lot down wherever one fits
    const front = (R, side, row) => {
      for (let s = 2 + rng() * 10; s < R.length - 4;) {
        const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), nx = -dz * side, nz = dx * side, hw = R.width / 2;
        const dist = distAt(p.x + nx * 25, p.z + nz * 25), dock = !dist && D.pip(p.x + nx * 25, p.z + nz * 25, D.docks.poly);
        if (!dist && !dock) { s += 16; continue; }
        const id = dock ? 'dk' : dist.id, town = id === 'dt' || id === 'sw' || id === 'dk';
        if (!town && row) return;
        let w, d, walk, gap;
        const core = 1 - smooth(80, 480, Math.hypot(p.x - 4290, (p.z + 350) * 1.1));
        if (id === 'dt') { w = 16 + rng() * 16 + core * 12; d = 16 + rng() * 16 + core * 6; walk = 4.6; gap = rng() < 0.4 ? 0.6 : 2 + rng() * 5; }
        else if (id === 'sw') { w = 18 + rng() * 26; d = 16 + rng() * 22; walk = 4.6; gap = 3 + rng() * 7; }
        else if (id === 'dk') { w = 34 + rng() * 20; d = 18 + rng() * 10; walk = 6; gap = 40 + rng() * 60; }
        else { w = 8 + rng() * 4; d = 9 + rng() * 4; walk = 7 + rng() * 3; gap = 5 + rng() * 9; }
        const off = hw + walk + (row ? 34 : 0) + d / 2, x = p.x + nx * off, z = p.z + nz * off;
        // buildings line up with the street; houses turn their front door to it
        const yaw = town ? Math.atan2(-dz, dx) : Math.atan2(-nx, -nz);
        const f = fits(x, z, yaw, w, d, walk, town ? 0.6 : 2);
        if (!f || (!town && rng() < 0.12)) { s += 4; continue; }
        claim(x, z, yaw, w, d, town ? 0.6 : 3);
        if (town) {
          let style, h;
          if (id === 'dk' || (id === 'sw' && rng() < 0.55)) { style = 'warehouse'; h = 9 + rng() * 7; }
          else if (id === 'sw') { style = rng() < 0.7 ? 'brick' : 'office'; h = 10 + rng() * 16; }
          else if (core > 0.55 && rng() < 0.6) { style = rng() < 0.55 ? 'glass' : 'office'; h = 40 + core * 110 * (0.3 + rng() * 0.9); }
          else if (core > 0.2) { style = rng() < 0.5 ? 'office' : 'brick'; h = 14 + rng() * 26 + core * 16; }
          else { style = rng() < 0.65 ? 'brick' : 'office'; h = 10 + rng() * 18; }
          const tone = rng(), b = aabb({ x, z, yaw, w, d, h: Math.round(h / 3.5) * 3.5 + 1, base: f[1], y0: f[0] - 0.6, style, tone, seed: rng() });
          this.buildings.push(b);
          if ((style === 'glass' || style === 'office') && h > 60 && rng() < 0.6) // stepped towers get a setback crown
            this.buildings.push(aabb({ ...b, w: w * 0.64, d: d * 0.64, h: Math.round(h * (1.15 + rng() * 0.2) / 3.5) * 3.5 + 1, seed: rng(), crown: true }));
        } else {
          const o = { x, z, yaw, w, d, h: 3 + rng() * 3, y0: f[0] - 1, y1: f[1], kind: 'house', wall: WALLS[(rng() * WALLS.length) | 0], roof: ROOFS[(rng() * ROOFS.length) | 0] };
          T.village.push(o);
          footprint(x, z, yaw, w, d, 2, (px, pz) => { T.lot[T.gi(px, pz)] = 1; });
          // a tree or two in the back yard
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          for (let k = 0; k < 2; k++) if (rng() < 0.55) {
            const a = (rng() - 0.5) * w, b = -d / 2 - 4 - rng() * 6, tx = x + a * c + b * sn, tz = z - a * sn + b * c, gi = T.gi(tx, tz), q = oi(tx, tz);
            if (q >= 0 && !occ[q] && T.rdist[gi] > T.rhw[gi] + 4 && !vm[gi] && !T.river[gi]) this.parkTrees.push({ x: tx, z: tz, y: T.h[gi], s: 0.7 + rng() * 0.5, rot: rng() * TAU, seed: rng() });
          }
        }
        s += w + gap;
      }
    };
    for (const row of [0, 1]) for (const R of streets) for (const side of [-1, 1]) front(R, side, row);
    // then fill the middles of the town blocks: lower buildings, square to the district grid
    for (const dist of D.districts.filter((d) => d.id === 'dt' || d.id === 'sw')) {
      const xs = dist.outline.map((q) => q[0]), zs = dist.outline.map((q) => q[1]), yaw = -dist.ang * Math.PI / 180;
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 10) for (let x = Math.min(...xs); x < Math.max(...xs); x += 10) {
        if (!D.pip(x, z, dist.outline)) continue;
        const w = 14 + rng() * 14, d = 14 + rng() * 12, f = fits(x, z, yaw, w, d, 5, 1);
        if (!f) continue;
        claim(x, z, yaw, w, d, 1.5);
        const sw = dist.id === 'sw', style = sw ? (rng() < 0.6 ? 'warehouse' : 'brick') : (rng() < 0.6 ? 'brick' : 'office'), h = sw ? 8 + rng() * 8 : 12 + rng() * 22;
        this.buildings.push(aabb({ x, z, yaw, w, d, h: Math.round(h / 3.5) * 3.5 + 1, base: f[1], y0: f[0] - 0.6, style, tone: rng(), seed: rng() }));
      }
    }
    // street lights down both sides, staggered, kept clear of the junctions
    for (const R of streets) for (const side of [-1, 1]) for (let s = 12 + (side > 0 ? 21 : 0); s < R.length - 8; s += 42) {
      const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), nx = -dz * side, nz = dx * side, off = R.width / 2 + 1.6, x = p.x + nx * off, z = p.z + nz * off;
      if (!distAt(x, z) && !D.pip(x, z, D.docks.poly)) continue;
      const gi = T.gi(x, z), go = T.gi(x + nx * 3, z + nz * 3);
      const q = oi(x, z); if (T.rdist[gi] < R.width / 2 + 1 || T.rdist[go] < R.width / 2 + 3.5 || vm[gi] || (q >= 0 && occ[q] && T.metroAt(x, z) > 1)) continue;
      this.lamps.push({ x, z, y: p.y, yaw: Math.atan2(-nz, -nx) });
    }
    // the parks: oaks scattered over the lawns, clear of the paths
    for (const P of D.parks) {
      const xs = P.poly.map((q) => q[0]), zs = P.poly.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      for (let k = 0, n = (x1 - x0) * (z1 - z0) / 260; k < n; k++) {
        const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0), gi = T.gi(x, z);
        if (!D.pip(x, z, P.poly) || T.rdist[gi] < T.rhw[gi] + 3 || vm[gi]) continue;
        this.parkTrees.push({ x, z, y: T.h[gi], s: 0.9 + rng() * 0.6, rot: rng() * TAU, seed: rng() });
      }
    }
    // container yard on the docks, in rows between the gate road, the rail yard and the quay road
    const colors = [0xb5442a, 0x1f5f8b, 0x2f7a4a, 0xd6a02b, 0x7a7f86, 0x8a2d5a, 0xc8c2b4];
    for (let x = 4260; x < 5000; x += 15) {
      if (rng() < 0.18) { x += 20; continue; }
      for (let z = 345; z + 2.6 < 795; z += 3.1) {
        if (rng() < 0.25) continue;
        let blocked = false;
        for (const [px, pz] of [[x, z], [x + 6, z + 1.2], [x + 12.2, z + 2.5], [x + 12.2, z], [x, z + 2.5]]) {
          const gi = T.gi(px, pz), k = oi(px, pz);
          if (!D.pip(px, pz, D.docks.poly) || T.rdist[gi] < T.rhw[gi] + 5 || T.h[gi] < CITY.y - 0.5 || vm[gi] || (k >= 0 && occ[k]) || green(px, pz)) { blocked = true; break; }
        }
        if (blocked) continue;
        const n = 1 + Math.floor(rng() * 4);
        this.containers.push({ x0: x, x1: x + 12.2, z0: z, z1: z + 2.5, h: n * 2.6, n, y: T.height(x + 6, z + 1.2), color: colors[Math.floor(rng() * colors.length)] });
      }
    }
    // kicker ramps down the middle of quiet, straight, level side streets (never an arterial, a race route or the rail)
    const L = RAMP.up + RAMP.top + RAMP.down, cand = [];
    for (const R of streets) if (R.def.dist && !R.def.art && R.def.dist !== 'dt') for (let s = L; s < R.length - L; s += 30) cand.push([R, s]);
    for (let k = cand.length - 1; k > 0; k--) { const q = Math.floor(rng() * (k + 1)); [cand[k], cand[q]] = [cand[q], cand[k]]; }
    for (const [R, s] of cand) {
      if (this.ramps.length >= 14) break;
      const rid = T.routes.indexOf(R) + 1, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
      if (this.ramps.some((r) => Math.hypot(r.cx - p.x, r.cz - p.z) < 260)) continue;
      let ok = true;
      for (let a = -L / 2 - 8; a <= L / 2 + 8 && ok; a += 4) {
        const q = R.posAt(s + a, {}), [ex, ez] = R.dirAt(s + a);
        if (ex * dx + ez * dz < 0.995 || Math.abs(q.y - p.y) > 0.3) ok = false;
        for (const l of [-4, 0, 4]) { const gi = T.gi(q.x - ez * l, q.z + ex * l); if (T.rown[gi] !== rid || T.rail[gi] > 0) ok = false; }
      }
      if (!ok) continue;
      const sg = rng() < 0.5 ? 1 : -1, ax = dx * sg, az = dz * sg;
      this.ramps.push({ cx: p.x, cz: p.z, x: p.x - ax * L / 2, z: p.z - az * L / 2, dx: ax, dz: az, y: p.y, L });
    }
    // the ship: deck, a ramp up from the quay, and container stacks in bays with lanes between them
    this.decks.push({ kind: 'deck', x0: SHIP.x0, x1: SHIP.x1, z0: SHIP.z0, z1: SHIP.z1 - 14, y: SHIP.y });
    this.decks.push({ kind: 'slope', x: SHIP.rampX0, z: SHIP.rampZ, dx: 1, dz: 0, L: SHIP.x0 - SHIP.rampX0, Lt: SHIP.x0 - SHIP.rampX0 + 1, hw: SHIP.rampHw, y0: CITY.y, y1: SHIP.y, ship: true });
    for (const [x0, x1] of [[SHIP.x0 + 4, SHIP.x0 + 16.2], [SHIP.x1 - 16.2, SHIP.x1 - 4]]) {
      for (let zb = SHIP.z0 + 34; zb < SHIP.z1 - 30; zb += 24) for (let k = 0; k < 5; k++) {
        const z = zb + k * 3.1;
        if (x0 < SHIP.x0 + 10 && z > SHIP.rampZ - SHIP.rampHw - 6 && z < SHIP.rampZ + SHIP.rampHw + 4) continue; // keep the ramp mouth clear
        if (rng() < 0.12) continue;
        const n = 1 + Math.floor(rng() * 3);
        this.containers.push({ x0, x1, z0: z, z1: z + 2.5, h: n * 2.6, n, y: SHIP.y, color: colors[Math.floor(rng() * colors.length)] });
      }
    }
    // Calder Stadium, half built: the west stands are finished, the east ones are still going up; the way in faces Kingsway
    { const S0 = D.stadium; this.stadium = { x: S0.x, z: S0.z, rx: S0.rx, rz: S0.rz, depth: 18, gap: 0.24, y: T.height(S0.x - S0.rx, S0.z), seg: 72,
      h: (t) => { const c = Math.cos(t); return c < -0.15 ? 16 : c < 0.25 ? 16 - (c + 0.15) * 25 : 6 + 2 * Math.sin(t * 7); } }; }
    // gantry cranes on the south quay (clear of the slipway) and the east quay by the ship
    for (const x of [4340, 4480, 4820]) this.cranes.push({ x, z: 792, yaw: 0, color: x === 4480 ? 0xe0b020 : 0xd94c22 });
    for (let k = 0; k < 3; k++) this.cranes.push({ x: 5136, z: -500 + k * 260, yaw: Math.PI / 2, color: 0xd94c22 });
  }
}
