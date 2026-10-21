'use strict';
/* Red Mesa Rally · Map layout: world bounds, regions, city grid, harbour, metro, heights and biomes */

/* ---------- World layout ---------- */
const WORLD = { x0: -1050, z0: -2950, x1: 5350, z1: 2050, cell: 4 };
WORLD.Sx = WORLD.x1 - WORLD.x0; WORLD.Sz = WORLD.z1 - WORLD.z0;
WORLD.Nx = Math.round(WORLD.Sx / WORLD.cell) + 1; WORLD.Nz = Math.round(WORLD.Sz / WORLD.cell) + 1;
const WATER_Y = -1.6;
// road and rail bores: how many route samples (2 m) in from each portal the ground is still cut open, and how far above
// the bore floor something still counts as inside it (the crown is at 8 m)
const BORE_IN = 5, BORE_CROWN = 7.5;
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
/* a ro-ro container ship tied up at the east quay. The ramp climbs along the quay beside the hull (clear of Harbour Dr) to a
   landing at deck height, which opens sideways onto the deck between rampZ ± rampHw */
const SHIP = { x0: 5153, x1: 5191, z0: -650, z1: -390, y: 12.5, rampZ: -557, rampHw: 8, ramp: { x: 5142, hw: 6, z0: -497, z1: -549 } };
/* Calder Metro: a loop of twin-track tube under Port Calder, no road and no barrier. Cars drive on the rails: the inner track
   carries the stopping service (it runs with the race and waits at the platforms), the outer track the express, which runs
   the other way and never stops. Four portals each have a ramp down an open cut beside a street and on under it to the loop.
   Lateral offsets are measured to the right of the loop's direction of travel, which is the inside of the loop. */
const METRO = { y: 0.5, ceil: 4.8, under: CITY.y - 1.5, wallL: -5.2, tracks: [-2.3, 2.3], wallR: 5, plat: 11.4, rampLen: 58, rampHw: 5.5, cut: 50,
  box: { x0: 3480, z0: -1080, x1: 5080, z1: 620 },
  loop: [[3650, -450], [3950, -470], [4250, -446], [4370, -452], [4418, -510], [4424, -600], [4470, -690], [4600, -750], [4700, -880], [4850, -990],
    [5000, -800], [4960, -400], [4820, -50], [4560, 175], [4430, 470], [4150, 520], [3900, 450], [3640, 330], [3560, -100]],
  portals: [{ name: 'Kingsway', x: 4299, z: -555.9, dx: 0.9994, dz: -0.0337, L: 122 }, { name: 'Westgate', x: 3996.4, z: -534.4, dx: -0.0346, dz: 0.9994, L: 66 },
    { name: 'Mesa View', x: 3467.9, z: -256.7, dx: 0.9848, dz: 0.1739, L: 104 }, { name: 'Harbour Dr', x: 5112.1, z: -483.7, dx: -0.9834, dz: -0.1813, L: 132 }],
  stations: [{ name: 'DOWNTOWN', at: [4422, -560] }, { name: 'UNION', at: [4640, -800] }, { name: 'KESTREL HEIGHTS', at: [4900, -930] }, { name: 'SALTWORKS', at: [4965, -450] },
    { name: 'STADIUM', at: [4600, 150] }, { name: 'PORT', at: [4290, 500] }, { name: 'SUNSET MARINA', at: [3770, 390] }, { name: 'MESA VIEW', at: [3575, -250] }],
  stationLen: 76 };
/* the portal ramps: mouth on the street, an open cut METRO.cut long, then a covered ramp on down to the loop */
function metroSpurs() { return METRO.portals.map((p, k) => ({ k, ...p, cover: METRO.cut })); }
const metroSpurY = (a) => lerp(CITY.y, METRO.y, smooth(0, METRO.rampLen, a));
const metroSpurCeil = (a) => (a >= METRO.cut ? Math.min(metroSpurY(a) + 4.3, METRO.ceil) : metroSpurY(a) + 4.3); // open sky over the cut
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
/* Kestrel Heights: a ridge north of downtown with the suburbs on its south slope, the observatory and the lighthouse on its crest */
const HEIGHTS = { x0: 4120, z: -1240, top: 34, south: -880, north: -1580 };
function heightsLift(x, z, sd) {
  const H = HEIGHTS, crest = H.z + 35 * Math.sin(x / 260 + 1.3);
  const prof = z > crest ? smooth(H.south, crest, z) : smooth(H.north, crest, z);
  return prof * smooth(H.x0 - 110, H.x0 + 110, x) * (1 - smooth(-170, -50, sd)) * H.top * (0.85 + 0.3 * Noise.fbm(x / 240 + 4, z / 240, 2));
}
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
  if (z < HEIGHTS.south) h += heightsLift(x, z, sdf.d);
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
