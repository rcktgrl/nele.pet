'use strict';
/* Red Mesa Rally · Millbrook: farmhouses and barns along the lanes above the island, and the old water mill on the bank */

const MILLBROOK = { x: 2470, z: -610, r: 140 };

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* the summit lookout's low stone wall: a half ring round the far side of the turning space, as [ax, az, bx, bz] pieces */
function lookoutWall(o) {
  const out = [], R = 11, ux = Math.sin(o.yaw), uz = Math.cos(o.yaw), N = 9;
  for (let k = 0; k < N; k++) {
    const a0 = -1.45 + 2.9 * k / N, a1 = -1.45 + 2.9 * (k + 1) / N, p = (a) => [o.x + (ux * Math.cos(a) - uz * Math.sin(a)) * R, o.z + (uz * Math.cos(a) + ux * Math.sin(a)) * R];
    out.push([...p(a0), ...p(a1)]);
  }
  return out;
}

/* lots: {x, z, yaw, w, d, h, y0, y1, kind, wall, roof}; marks T.lot so nothing gets planted inside them */
function planVillage(T) {
  const rng = mulberry32(31), lots = [], lot = T.lot = new Uint8Array(T.h.length);
  const WALLS = [[0.93, 0.9, 0.84], [0.88, 0.82, 0.7], [0.78, 0.84, 0.86], [0.86, 0.74, 0.56], [0.95, 0.94, 0.92]];
  const ROOFS = [[0.32, 0.3, 0.3], [0.5, 0.26, 0.2], [0.38, 0.4, 0.44]];
  const rd = (x, z) => T.rdist[T.gi(x, z)];
  // a footprint fits where it is dry, off the roads and not too steep
  const fits = (x, z, yaw, w, d, clear) => {
    const c = Math.cos(yaw), s = Math.sin(yaw); let lo = 1e9, hi = -1e9;
    for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]]) {
      const lx = a * (w / 2 + 2), lz = b * (d / 2 + 2), px = x + lx * c + lz * s, pz = z - lx * s + lz * c, gi = T.gi(px, pz);
      if (T.rdist[gi] < clear || T.river[gi] || T.riverTunAt(px, pz) || T.rail[gi] > 0) return null;
      const y = T.h[gi]; if (y < WATER_Y + 1.2) return null; lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return hi - lo < 3 ? [lo, hi] : null;
  };
  const clearOf = (x, z, r) => lots.every((o) => Math.hypot(o.x - x, o.z - z) > r + Math.hypot(o.w, o.d) / 2 + 4);
  const add = (o) => {
    lots.push(o);
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    for (let a = -o.w / 2 - 2; a <= o.w / 2 + 2; a += 2) for (let b = -o.d / 2 - 2; b <= o.d / 2 + 2; b += 2) lot[T.gi(o.x + a * c + b * s, o.z - a * s + b * c)] = 1;
  };
  // the mill first: on the village bank of the river, its wheel turning in the water
  const up = RIVER.reaches.find((r) => r.id === 'upper').pts;
  let best = null;
  for (const q of up) { const dd = Math.hypot(q.x - MILLBROOK.x, q.z - MILLBROOK.z); if (q.wl <= WATER_Y + 0.2 && (!best || dd < best.dd)) best = { q, dd }; }
  if (best) {
    const { q } = best, i = up.indexOf(q), q2 = up[Math.min(up.length - 1, i + 1)], q1 = up[Math.max(0, i - 1)];
    let tx = q2.x - q1.x, tz = q2.z - q1.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    let nx = -tz, nz = tx; if (nx * (MILLBROOK.x - q.x) + nz * (MILLBROOK.z - q.z) < 0) { nx = -nx; nz = -nz; }
    // it stands right at the water's edge on a stone undercroft built up the bank, the wheel turning against its river wall
    let e = 0; while (e < q.hw + 40 && T.h[T.gi(q.x + nx * e, q.z + nz * e)] < WATER_Y + 0.4) e += 0.5;
    const w = 12, d = 10, off = e - 0.5 + d / 2, x = q.x + nx * off, z = q.z + nz * off, yaw = Math.atan2(nx, nz);
    let top = -1e9;
    for (let a = -w / 2; a <= w / 2; a += 2) for (let b = -d / 2; b <= d / 2; b += 2) top = Math.max(top, T.h[T.gi(x + a * tx + b * nx, z + a * tz + b * nz)]);
    const wo = e - 1.6, r = clamp((top - WATER_Y) * 0.5, 3.5, 5);
    add({ x, z, yaw, w, d, h: 7, y0: WATER_Y - 1, y1: top, kind: 'mill', wall: [0.62, 0.42, 0.32], roof: ROOFS[0], wheel: { x: q.x + nx * wo + tx * w * 0.18, z: q.z + nz * wo + tz * w * 0.18, r, yaw } });
  }
  for (let tries = 0; tries < 1500 && lots.length < 18; tries++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * MILLBROOK.r, x = MILLBROOK.x + Math.cos(a) * r, z = MILLBROOK.z + Math.sin(a) * r;
    const d0 = rd(x, z); if (d0 > 40) continue; // houses line the lanes
    const barn = rng() < 0.22, w = barn ? 10 + rng() * 3 : 6.5 + rng() * 3, d = barn ? 14 + rng() * 5 : 8.5 + rng() * 4;
    // face the nearest road: down the gradient of the road distance
    const gx = rd(x + 4, z) - rd(x - 4, z), gz = rd(x, z + 4) - rd(x, z - 4), yaw = Math.atan2(-gx, -gz);
    if (!clearOf(x, z, Math.hypot(w, d) / 2)) continue;
    const f = fits(x, z, yaw, w, d, barn ? 9 : 7); if (!f) continue;
    add({ x, z, yaw, w, d, h: barn ? 5 + rng() * 1.5 : 3 + rng() * 2.6, y0: f[0] - 1, y1: f[1], kind: barn ? 'barn' : 'house',
      wall: barn ? [0.6, 0.2, 0.16] : WALLS[(rng() * WALLS.length) | 0], roof: barn ? [0.36, 0.34, 0.32] : ROOFS[(rng() * ROOFS.length) | 0] });
  }
  // the Kestrel Lodge up in the pines, facing Ridge Rd
  for (let tries = 0; tries < 200; tries++) {
    const a = rng() * TAU, r = tries * 0.4, x = 4000 + Math.cos(a) * r, z = -1810 + Math.sin(a) * r;
    const gx = rd(x + 4, z) - rd(x - 4, z), gz = rd(x, z + 4) - rd(x, z - 4), yaw = Math.atan2(-gx, -gz);
    const f = fits(x, z, yaw, 24, 12, 8); if (!f) continue;
    add({ x, z, yaw, w: 24, d: 12, h: 6, y0: f[0] - 1.5, y1: f[1], kind: 'lodge', wall: [0.2, 0.11, 0.05], roof: [0.06, 0.12, 0.08] });
    break;
  }
  // the destinations at the ends of the scenic roads: the observatory on the Heights, the lighthouse over the sea, the summit lookout
  const end = (id) => { const R = T.routes.find((r) => r.id === id), n = R.count; return { x: R.x[n], z: R.z[n], dx: R.x[n] - R.x[n - 4], dz: R.z[n] - R.z[n - 4] }; };
  const site = (cx, cz, w, d, clear, rMax, score) => { // the best-scoring footprint that fits within rMax of (cx, cz), facing the nearest road
    let b = null;
    for (let r = 0; r <= rMax; r += 4) for (let a = 0; a < TAU; a += 4 / Math.max(r, 4)) {
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!clearOf(x, z, Math.hypot(w, d) / 2)) continue;
      const gx = rd(x + 4, z) - rd(x - 4, z), gz = rd(x, z + 4) - rd(x, z - 4), yaw = Math.atan2(-gx, -gz), f = fits(x, z, yaw, w, d, clear);
      if (!f) continue;
      const sc = score(x, z, f, r); if (!b || sc > b.sc) b = { x, z, yaw, f, sc };
    }
    return b;
  };
  { const J = end('hill-rd'), o = site(J.x, J.z, 18, 18, 10, 90, (x, z, f, r) => f[0] - r * 0.08);
    if (o) add({ x: o.x, z: o.z, yaw: o.yaw, w: 18, d: 18, h: 7, y0: o.f[0] - 1, y1: o.f[1], kind: 'observatory', wall: [0.82, 0.82, 0.8], roof: [0.7, 0.72, 0.74] }); }
  { const J = end('lighthouse-ln'), L = Math.hypot(J.dx, J.dz), sx = J.dx / L, sz = J.dz / L; // on the point, as far out toward the sea as it fits
    const o = site(J.x, J.z, 9, 9, 7, 50, (x, z) => (x - J.x) * sx + (z - J.z) * sz);
    if (o) {
      add({ x: o.x, z: o.z, yaw: o.yaw, w: 9, d: 9, h: 26, y0: o.f[0] - 1, y1: o.f[1], kind: 'lighthouse', wall: [0.9, 0.9, 0.88], roof: [0.6, 0.12, 0.1] });
      const k = site(o.x, o.z, 7, 9, 7, 40, (x, z, f, r) => -r);
      if (k) add({ x: k.x, z: k.z, yaw: k.yaw, w: 7, d: 9, h: 3.4, y0: k.f[0] - 1, y1: k.f[1], kind: 'cottage', wall: [0.9, 0.9, 0.88], roof: [0.5, 0.26, 0.2] });
    } }
  { const E = end('summit'), L = Math.hypot(E.dx, E.dz), ux = E.dx / L, uz = E.dz / L, x = E.x + ux * 9, z = E.z + uz * 9;
    lots.push({ x, z, yaw: Math.atan2(ux, uz), w: 18, d: 12, h: 0, y0: T.h[T.gi(x, z)], y1: T.h[T.gi(x, z)], kind: 'lookout' }); }
  return lots;
}
