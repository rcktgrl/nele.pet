'use strict';
/* Red Mesa Rally · Map layout: world bounds, regions, city grid, harbour, metro, heights and biomes */

/* ---------- World layout ---------- */
const WORLD = { x0: -1050, z0: -2950, x1: 5350, z1: 2050, cell: 4 };
WORLD.Sx = WORLD.x1 - WORLD.x0; WORLD.Sz = WORLD.z1 - WORLD.z0;
WORLD.Nx = Math.round(WORLD.Sx / WORLD.cell) + 1; WORLD.Nz = Math.round(WORLD.Sz / WORLD.cell) + 1;
const WATER_Y = -1.6;
const HUB = { x: 0, z: 140, r: 85 };
const MESAS = [
  { x: -430, z: -370, r: 165, h: 128 },
  { x: 410, z: -470, r: 140, h: 150 },
  { x: -610, z: 330, r: 120, h: 108 },
  { x: 560, z: 320, r: 105, h: 118 },
  { x: 140, z: -360, r: 34, h: 92, spire: true },
  { x: -330, z: -110, r: 28, h: 78, spire: true },
  { x: 700, z: -260, r: 42, h: 104, spire: true },
  { x: -120, z: 560, r: 46, h: 96, spire: true },
  { x: -950, z: -150, r: 170, h: 150 },
];
const LAKE = { x: 110, z: 760, r: 140 };
/* Port Calder: a 12 x 11 street grid on the coast, docks to the south. */
const CITY = { x0: 3460, z0: -940, pitch: 125, nx: 13, nz: 12, hw: 9, y: 5 };
CITY.x1 = CITY.x0 + (CITY.nx - 1) * CITY.pitch; CITY.z1 = CITY.z0 + (CITY.nz - 1) * CITY.pitch;
const DOCKS = { x0: CITY.x0, x1: 5150, z0: CITY.z1 + CITY.hw, z1: 800 };
const FLAT = { x0: CITY.x0 - 24, x1: 5150, z0: CITY.z0 - 24, z1: 800 };
/* the harbour: water dredged deep against the south and east quays, and a slipway down into it */
const HARBOUR = [{ x0: 4250, x1: 5700, z0: FLAT.z1, z1: 1600 }, { x0: FLAT.x1, x1: 5700, z0: -760, z1: FLAT.z1 }];
const SLIP = { x: 4650, z0: FLAT.z1 - 6, z1: FLAT.z1 + 62, hw: 8, y1: -4.6 };
/* a ro-ro container ship tied up at the east quay: a ramp from the quay onto its deck */
const SHIP = { x0: 5153, x1: 5191, z0: -650, z1: -390, y: 12.5, rampZ: -555, rampHw: 6, rampX0: 5106 };
/* rooftop car parks: a ramp up the side of each block, a kicker on the high roof aimed at the low one */
const ROOFTOPS = [{ bi: 10, bj: 1, h: 15, side: -1 }, { bi: 11, bj: 1, h: 11, side: 1 }];
/* Calder Metro: a loop of twin-track tube under downtown, no road and no barrier. Cars drive on the rails: the inner track
   carries the stopping service (it runs with the race and waits at the platforms), the outer track the express, which runs
   the other way and never stops. Four portal buildings each have a ramp driven straight through their ground floor down to it.
   Lateral offsets are measured to the right of the loop's direction of travel, which is the inside of the loop. */
const METRO = { y: 0.5, ceil: 4.8, under: CITY.y - 1.5, wallL: -5.2, tracks: [-2.3, 2.3], wallR: 5, plat: 11.4, rampLen: 58, rampHw: 5.5,
  corners: [[2, 2], [10, 2], [10, 8], [2, 8]],
  portals: [{ bi: 4, bj: 1, dir: 's', name: 'Kingsway' }, { bi: 1, bj: 4, dir: 'e', name: 'Westgate' }, { bi: 6, bj: 8, dir: 'n', name: 'Dock Road' }, { bi: 10, bj: 5, dir: 'w', name: 'Eastside' }],
  stations: [{ name: 'CALDER CENTRAL', at: [6, 2] }, { name: 'HARBOUR STREET', at: [10, 5] }, { name: 'MARKET SQUARE', at: [6, 8] }, { name: 'WESTGATE', at: [2, 5] }],
  stationLen: 76 };
/* the portal ramps: mouth at the building face, straight down through the block to the loop's road */
function metroSpurs() {
  const C = CITY, size = C.pitch - 2 * (C.hw + 4), D = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
  return METRO.portals.map((p, k) => {
    const bx0 = C.x0 + p.bi * C.pitch + C.hw + 4, bz0 = C.z0 + p.bj * C.pitch + C.hw + 4, [dx, dz] = D[p.dir];
    const x = dx ? (dx > 0 ? bx0 : bx0 + size) : bx0 + size / 2, z = dz ? (dz > 0 ? bz0 : bz0 + size) : bz0 + size / 2;
    return { k, ...p, x, z, dx, dz, L: C.pitch - (C.hw + 4) - 2, cover: size, bx0, bz0, size };
  });
}
/* a closed loop through grid corners with true arcs at the corners (the tube is wide, so its inner wall needs room) */
function arcLoop(corners, r) {
  const out = [], n = corners.length;
  for (let k = 0; k < n; k++) {
    const p = corners[(k - 1 + n) % n], c = corners[k], q = corners[(k + 1) % n];
    const lu = Math.hypot(c[0] - p[0], c[1] - p[1]), lv = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const u = [(c[0] - p[0]) / lu, (c[1] - p[1]) / lu], v = [(q[0] - c[0]) / lv, (q[1] - c[1]) / lv];
    const a = [c[0] - u[0] * r, c[1] - u[1] * r], b = [c[0] + v[0] * r, c[1] + v[1] * r];
    for (let t = 0; t <= 1.001; t += 1 / 10) { const w = 1 - t; out.push([w * w * a[0] + 2 * w * t * c[0] + t * t * b[0], w * w * a[1] + 2 * w * t * c[1] + t * t * b[1]]); }
    for (let d = 40; d < lv - 2 * r; d += 40) out.push([b[0] + v[0] * d, b[1] + v[1] * d]);
  }
  return out;
}
const metroSpurY = (a) => lerp(CITY.y, METRO.y, smooth(0, METRO.rampLen, a));
const metroSpurCeil = (a) => metroSpurY(a) + 4.3;
/* where boats go in: a parking spot on land and a mooring on the water, facing out */
const BOAT_DOCKS = [
  { id: 'harbour', name: 'Port Calder slipway', land: { x: SLIP.x + 14, z: FLAT.z1 - 22, yaw: Math.PI }, water: { x: SLIP.x, z: FLAT.z1 + 110, yaw: Math.PI } },
  { id: 'lake', name: 'Lake Mesa jetty', land: { x: -30, z: 692, yaw: Math.atan2(-130, -60) }, water: { x: 52, z: 734, yaw: Math.atan2(-130, -60) } },
];
const REGIONS = [
  { id: 'desert', name: 'Red Mesa Desert', x: 0, z: 0, lx: -80, lz: -760 },
  { id: 'valley', name: 'Calder Valley', x: 2300, z: -400, lx: 2620, lz: 60 },
  { id: 'city', name: 'Port Calder', x: 4200, z: -250 },
  { id: 'pines', name: 'Kestrel Pines', x: 2700, z: -2200 },
  { id: 'coast', name: 'Salt Coast', x: 3000, z: 1100 },
];
/* East landmass outline; 's' edges face the sea, 'm' edges rise into mountains. */
const EAST_POLY = [
  [1380, -650, 'm'], [1700, -1450, 'm'], [1850, -2450, 'm'], [2550, -2850, 'm'], [3550, -2820, 'm'], [4000, -2250, 'm'],
  [4450, -1750, 'm'], [5150, -1400, 's'], [5250, -600, 's'], [5200, 380, 's'], [4850, 820, 's'], [4200, 1000, 's'],
  [3500, 1200, 's'], [2800, 1380, 's'], [2100, 1280, 's'], [1680, 950, 'm'], [1420, 420, 'm'],
];
function eastSDF(x, z) {
  const P = EAST_POLY, n = P.length;
  let inside = false, best = 1e9, ws = 0, wsea = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, az] = P[j], [bx, bz, kind] = [P[i][0], P[i][1], P[j][2]];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
    const w = Math.exp(-d / 90); ws += w; if (kind === 's') wsea += w;
  }
  return { d: inside ? -best : best, sea: ws > 0 ? wsea / ws : 0 };
}
function boxMask(x, z, b, soft) {
  const dx = Math.max(b.x0 - x, x - b.x1, 0), dz = Math.max(b.z0 - z, z - b.z1, 0);
  return 1 - smooth(0, soft, Math.hypot(dx, dz));
}

/* ---------- Heights ---------- */
function desertHeight(x, z) {
  let h = 9 + 11 * Noise.fbm(x / 520 + 3.1, z / 520 - 1.7, 4) + 3.2 * Noise.fbm(x / 130, z / 130, 3);
  const duneMask = smooth(0.05, 0.45, Noise.fbm(x / 700 + 11, z / 700 - 4, 2));
  h += duneMask * 3.2 * Math.pow(Noise.ridged(x / 75 + z / 260, z / 140, 2), 2.2);
  let mesaH = 0;
  for (const m of MESAS) {
    const dx = x - m.x, dz = z - m.z;
    let d = Math.hypot(dx, dz) / m.r;
    if (d > 2.0) continue;
    const a = Math.atan2(dz, dx);
    d *= 1 + (m.spire ? 0.08 : 0.17) * Noise.n2(Math.cos(a) * 1.7 + m.x * 0.013, Math.sin(a) * 1.7 + m.z * 0.013) + 0.04 * Noise.n2(dx / 22, dz / 22);
    const cliff = 1 - smooth(m.spire ? 0.86 : 0.83, 0.98, d);
    const talus = 1 - smooth(0.92, m.spire ? 1.5 : 1.8, d);
    let c = m.h * (0.8 * cliff + 0.24 * talus * talus);
    c += cliff * m.h * 0.035 * Noise.fbm(dx / 35, dz / 35, 2);
    if (c > mesaH) mesaH = c;
  }
  h += mesaH;
  { const dx = x - LAKE.x, dz = z - LAKE.z;
    const d = Math.hypot(dx, dz) / LAKE.r * (1 + 0.15 * Noise.n2(dx / 90 + 5, dz / 90));
    h = lerp(h, -8.5 + 3 * d, 1 - smooth(0.55, 1.2, d)); }
  const rr = Math.max(Math.hypot(x, z), Math.max(Math.abs(x), Math.abs(z)) * 0.97);
  const e = smooth(860, 990, rr);
  h += e * e * (150 + 70 * Noise.fbm(x / 160, z / 160, 3)) + e * 25 * Noise.ridged(x / 60, z / 60, 3);
  if (rr > 1000) h += smooth(1000, 1900, rr) * 140 * Noise.ridged(x / 400 + 9, z / 400, 3);
  { const d = Math.hypot(x - HUB.x, z - HUB.z);
    if (HUB.y !== undefined) h = lerp(h, HUB.y, 1 - smooth(HUB.r - 20, HUB.r + 50, d)); }
  return h;
}
/* north hills (Kestrel Pines) rise beyond z = -1500 */
const hillMask = (z) => smooth(-1500, -2150, z);
function eastLand(x, z) {
  let h = 10 + 14 * Noise.fbm(x / 650 + 7, z / 650 - 3, 4) + 3.5 * Noise.fbm(x / 160 + 2, z / 160, 3);
  const hm = hillMask(z);
  if (hm > 0) h += hm * (35 + 115 * Math.pow(Noise.ridged(x / 520 + 3, z / 520, 4), 1.3) + 25 * Noise.fbm(x / 200, z / 200, 2));
  return h;
}
function eastHeight(x, z) {
  const sdf = eastSDF(x, z), cm = boxMask(x, z, FLAT, 1);
  const d = sdf.d + 70 * Noise.fbm(x / 380 + 20, z / 380 - 7, 3) * (1 - cm);
  let h = eastLand(x, z);
  const sea = sdf.sea;
  // beaches: pull the land down toward the waterline near sea-facing edges
  const beachH = 0.5 + Math.max(0, -d) * 0.035;
  if (d < 0) h = lerp(h, beachH, (1 - smooth(25, 170, -d)) * sea);
  else {
    const edge = lerp(h, beachH, sea);
    const mtn = edge + smooth(0, 280, d) * (160 + 120 * Noise.fbm(x / 300, z / 300, 3) + 45 * Noise.ridged(x / 90, z / 90, 3));
    const seaH = lerp(edge, -16 - 6 * Noise.fbm(x / 200, z / 200, 2), smooth(0, 140, d));
    h = lerp(mtn, seaH, sea);
  }
  // the port: dead flat, quay drops straight into the harbour
  const f = boxMask(x, z, FLAT, 90);
  if (f > 0) h = lerp(h, CITY.y, f);
  if (f < 1) for (const b of HARBOUR) { // deep water right up to the quay walls
    const dd = Math.hypot(Math.max(b.x0 - x, x - b.x1, 0), Math.max(b.z0 - z, z - b.z1, 0));
    if (dd < 140) h = Math.min(h, lerp(-13 - 3 * Noise.fbm(x / 150, z / 150, 2), h, smooth(0, 140, dd)));
  }
  // the slipway: a concrete ramp from the quay straight down under the water
  if (Math.abs(x - SLIP.x) <= SLIP.hw && z >= SLIP.z0 && z <= SLIP.z1 + 8) h = lerp(CITY.y, SLIP.y1, clamp((z - SLIP.z0) / (SLIP.z1 - SLIP.z0), 0, 1)) - Math.max(0, z - SLIP.z1) * 0.5;
  return h;
}
const eastWeight = (x) => smooth(1150, 1420, x);
function naturalHeight(x, z) {
  const w = eastWeight(x);
  if (w <= 0) return desertHeight(x, z);
  if (w >= 1) return eastHeight(x, z);
  // the range face: carve spurs and gullies down the slope so it isn't one smooth ramp
  const band = 4 * w * (1 - w);
  const gully = Noise.ridged(x / 170 + 3.3, z / 46 + 1.1, 3) - 0.45 + 0.35 * Noise.fbm(x / 60, z / 60, 2);
  return lerp(desertHeight(x, z), eastHeight(x, z), w) + band * 38 * gully;
}
HUB.y = desertHeight(HUB.x, HUB.z);

/* biome weights for shading, surfaces and scatter */
function biomeAt(x, z, h) {
  const w = eastWeight(x);
  if (w <= 0) return { green: 0, beach: 0, city: 0, forest: 0 };
  const sdf = eastSDF(x, z);
  const hm = hillMask(z);
  let green = clamp(0.42 + 0.45 * Noise.fbm(x / 520 + 1, z / 520 + 4, 3) + hm * 0.7, 0, 1);
  green *= smooth(0.3, 1, w) * (1 - smooth(-120, 0, sdf.d) * 0.3);
  const beach = h < 4.5 ? (1 - smooth(0, 4.5, h)) * sdf.sea * smooth(-260, -20, sdf.d) * (1 - boxMask(x, z, FLAT, 1)) : 0;
  return { green, beach: clamp(beach * 1.5, 0, 1), city: 0, forest: hm };
}
function cityCell(x, z) { // 0 outside, 1 paved, 0.6 park
  if (x >= DOCKS.x0 - CITY.hw && x <= DOCKS.x1 && z > CITY.z1 && z <= DOCKS.z1) return 1;
  if (x < CITY.x0 - CITY.hw || x > CITY.x1 + CITY.hw || z < CITY.z0 - CITY.hw || z > CITY.z1 + CITY.hw) return 0;
  const bi = Math.floor((x - CITY.x0) / CITY.pitch), bj = Math.floor((z - CITY.z0) / CITY.pitch);
  if (bi < 0 || bj < 0 || bi >= CITY.nx - 1 || bj >= CITY.nz - 1) return 1;
  const u = x - CITY.x0 - bi * CITY.pitch, v = z - CITY.z0 - bj * CITY.pitch;
  const inner = Math.min(u, CITY.pitch - u, v, CITY.pitch - v) > CITY.hw + 4;
  return inner && cityBlockKind(bi, bj) === 'park' ? 0.6 : 1;
}
function cityBlockKind(bi, bj) {
  const r = hash2(bi + 31, bj + 17);
  if ((bi === 5 && bj === 4) || (bi === 9 && bj === 8) || (bi === 2 && bj === 7) || r < 0.04) return 'park';
  return 'build';
}
