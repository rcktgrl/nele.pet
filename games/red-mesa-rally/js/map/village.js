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
      if (T.rdist[gi] < clear || T.river[gi] || T.rail[gi] > 0) return null;
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
    // walk out from the water's edge until the ground is high and level enough for the mill
    for (let off = q.hw + 4; off < q.hw + 60; off += 2) {
      const x = q.x + nx * off, z = q.z + nz * off, yaw = Math.atan2(nx, nz), f = fits(x, z, yaw, 12, 10, 8);
      if (!f) continue;
      const wx = q.x + nx * (q.hw - 1), wz = q.z + nz * (q.hw - 1);
      add({ x, z, yaw, w: 12, d: 10, h: 7, y0: f[0] - 1.5, y1: f[1], kind: 'mill', wall: [0.62, 0.42, 0.32], roof: ROOFS[0], wheel: { x: (x + wx) / 2, z: (z + wz) / 2, r: Math.min(5, off - q.hw + 1), yaw } });
      break;
    }
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
  return lots;
}
