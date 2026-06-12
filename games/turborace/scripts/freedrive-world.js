'use strict';
import { state, scene } from './state.js';
import { THREE } from './three.js';

// ═══════════════════════════════════════════════════════
//  FREE DRIVE — OPEN WORLD ISLAND  (v2)
//  Irregular island shape, ~2× larger than v1.
//  Three cities at asymmetric positions, a race circuit,
//  highways + coastal ring + lanes connecting everything.
// ═══════════════════════════════════════════════════════

export const ISLAND_R = 2000;   // approximate inset radius used for tree/spawn checks
export const WATER_R  = 2500;   // circular hard boundary for car physics
export const LAKE_R   = 340;    // central lake

// Asymmetric city positions — deliberately not forming an equilateral triangle
export const FD_CITIES = [
  { name: 'Harborgate',    x: -200, z: -980, beacon: 0xff3355 },
  { name: 'Neon Bay',      x: 1050, z:  150, beacon: 0x33ddff },
  { name: 'Solace Springs',x: -720, z:  680, beacon: 0xc44aff },
];

const CITY_HALF_W = 180, CITY_HALF_D = 135, BLOCK = 90;

const ROAD_STYLES = {
  highway:   { hw: 11,  y: 0.030, col: 0x17171d },
  country:   { hw: 5,   y: 0.012, col: 0x1e1c18 },
  lane:      { hw: 3.5, y: 0.006, col: 0x211e16 },
  street:    { hw: 5.5, y: 0.018, col: 0x191922 },
  racetrack: { hw: 9,   y: 0.040, col: 0x0c0c11 },
};

// Irregular island boundary — [angle_rad, radius] pairs going 0→2π
const ISLAND_CTRL = [
  [0,    2100], [0.38, 1780], [0.70, 2280], [1.05, 1590],
  [1.40, 2160], [1.72, 1710], [2.05, 1960], [2.42, 2380],
  [2.78, 1870], [3.12, 2100], [3.46, 1650], [3.80, 1910],
  [4.20, 2220], [4.55, 1520], [4.88, 2070], [5.24, 1760],
  [5.62, 2110], [5.94, 1930],
];

export function getIslandBoundaryPts(n = 200) {
  const curve = new THREE.CatmullRomCurve3(
    ISLAND_CTRL.map(([a, r]) => new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)),
    true, 'centripetal', 0.5
  );
  return curve.getSpacedPoints(n);
}

let fdWorld = null;
export function getFreeDriveWorld() { return fdWorld; }

// ── Geometry helpers ─────────────────────────────────────

function polylineNormal(pts, i, closed) {
  const n = pts.length;
  const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
  const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  const tx = next.x - prev.x, tz = next.z - prev.z, l = Math.hypot(tx, tz) || 1;
  return { nx: -tz / l, nz: tx / l, tx: tx / l, tz: tz / l };
}

function addStripMesh(pts, hw, y, material, closed) {
  const n = pts.length, verts = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], { nx, nz } = polylineNormal(pts, i, closed);
    verts.push(p.x - nx * hw, y, p.z - nz * hw, p.x + nx * hw, y, p.z + nz * hw);
  }
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true; mesh.userData.trk = true; scene.add(mesh);
  return mesh;
}

function offsetPolyline(pts, off, closed) {
  return pts.map((p, i) => {
    const { nx, nz } = polylineNormal(pts, i, closed);
    return new THREE.Vector3(p.x + nx * off, 0, p.z + nz * off);
  });
}

function addDashes(pts, y, material, closed, stride = 3, frac = 0.42, w = 0.32) {
  const n = pts.length, verts = [], idx = []; let vi = 0;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i += stride) {
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const tx = p1.x - p0.x, tz = p1.z - p0.z, l = Math.hypot(tx, tz) || 1;
    const ux = tx / l, uz = tz / l, nx = -uz, nz = ux;
    const len = l * frac * 2.2;
    const ax = p0.x, az = p0.z, bx = p0.x + ux * len, bz = p0.z + uz * len;
    verts.push(ax - nx * w, y, az - nz * w, ax + nx * w, y, az + nz * w,
               bx + nx * w, y, bz + nz * w, bx - nx * w, y, bz - nz * w);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
  }
  if (!verts.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.trk = true; scene.add(mesh);
}

function curvePoints(ctrl, closed, step = 10) {
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map(p => new THREE.Vector3(p[0], 0, p[1])), closed, 'centripetal', 0.5);
  const len = curve.getLength();
  const n = Math.max(8, Math.round(len / step));
  return curve.getSpacedPoints(n);
}

// ── World build ──────────────────────────────────────────

export function buildFreeDriveWorld() {
  const rm = []; scene.traverse(o => { if (o.userData.trk) rm.push(o); }); rm.forEach(o => scene.remove(o));

  state.trkData = null; state.trkCurve = null; state.trkPts = []; state.trkCurv = [];
  state.trkWallLeft = []; state.trkWallRight = []; state.trkEdgeLeft = []; state.trkEdgeRight = [];
  state.cityCorridors = null; state.cityAiPts = null; state.gravelProfile = null;
  state.sceneryExclusionZones = [];

  const roadSegs = [];
  const mapRoads = [];

  const matFor = {};
  for (const [type, s] of Object.entries(ROAD_STYLES)) {
    matFor[type] = new THREE.MeshLambertMaterial({ color: s.col });
  }
  const matEdge  = new THREE.MeshLambertMaterial({ color: 0xcfcfd4 });
  const matDashW = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
  const matDashY = new THREE.MeshLambertMaterial({ color: 0xbfa133 });

  function addRoad(pts, type, closed) {
    const s = ROAD_STYLES[type];
    addStripMesh(pts, s.hw, s.y, matFor[type], closed);
    const segCount = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      roadSegs.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z, hw: s.hw });
    }
    mapRoads.push({ pts: pts.map(p => [p.x, p.z]), type, closed: !!closed });
    if (type === 'highway') {
      addStripMesh(offsetPolyline(pts, -(s.hw - 0.7), closed), 0.22, s.y + 0.006, matEdge, closed);
      addStripMesh(offsetPolyline(pts,   s.hw - 0.7,  closed), 0.22, s.y + 0.006, matEdge, closed);
      addDashes(pts, s.y + 0.006, matDashY, closed);
    } else if (type === 'country') {
      addDashes(pts, s.y + 0.006, matDashW, closed);
    } else if (type === 'racetrack') {
      addStripMesh(offsetPolyline(pts, -(s.hw - 0.6), closed), 0.25, s.y + 0.006, matEdge, closed);
      addStripMesh(offsetPolyline(pts,   s.hw - 0.6,  closed), 0.25, s.y + 0.006, matEdge, closed);
      addDashes(pts, s.y + 0.006, matDashW, closed, 2, 0.5, 0.45);
    }
  }

  // ── Ground: water, beach (irregular), grass (irregular), lake ──
  const water = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000),
    new THREE.MeshLambertMaterial({ color: 0x0d3550 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.45; water.userData.trk = true; scene.add(water);

  // Build an irregular island mesh from the spline boundary.
  // ShapeGeometry lives in XY; after rotation.x=-π/2 a shape point (sx,sy) lands at world (sx, 0, -sy).
  // So we feed (p.x, -p.z) to get the correct XZ placement.
  function makeIslandMesh(scale, yPos, material) {
    const bPts = getIslandBoundaryPts(200);
    const shape = new THREE.Shape(bPts.map(p => new THREE.Vector2(p.x * scale, -p.z * scale)));
    const geo = new THREE.ShapeGeometry(shape, 4);
    const mesh = new THREE.Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = yPos;
    mesh.receiveShadow = true; mesh.userData.trk = true; scene.add(mesh);
    return mesh;
  }

  makeIslandMesh(1.055, -0.16, new THREE.MeshLambertMaterial({ color: 0x8a7a55 })); // beach ring
  makeIslandMesh(1.0,   -0.08, new THREE.MeshLambertMaterial({ color: 0x1a3018 })); // grass

  const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE_R, 64),
    new THREE.MeshLambertMaterial({ color: 0x0e3d5c }));
  lake.rotation.x = -Math.PI / 2; lake.position.y = -0.02; lake.userData.trk = true; scene.add(lake);
  const lakeShore = new THREE.Mesh(new THREE.RingGeometry(LAKE_R - 2, LAKE_R + 20, 64),
    new THREE.MeshLambertMaterial({ color: 0x86764f }));
  lakeShore.rotation.x = -Math.PI / 2; lakeShore.position.y = -0.05; lakeShore.userData.trk = true; scene.add(lakeShore);

  // ── City plazas + street grids ──
  const plazaMat = new THREE.MeshLambertMaterial({ color: 0x15151c });
  for (const c of FD_CITIES) {
    const plaza = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_HALF_W * 2 + 50, CITY_HALF_D * 2 + 50), plazaMat);
    plaza.rotation.x = -Math.PI / 2; plaza.position.set(c.x, 0.002, c.z);
    plaza.receiveShadow = true; plaza.userData.trk = true; scene.add(plaza);

    for (let i = -2; i <= 2; i++) {
      addRoad([new THREE.Vector3(c.x + i * BLOCK, 0, c.z - CITY_HALF_D - 25),
               new THREE.Vector3(c.x + i * BLOCK, 0, c.z + CITY_HALF_D + 25)], 'street', false);
    }
    for (let j = 0; j < 4; j++) {
      const z = c.z - CITY_HALF_D + j * BLOCK;
      addRoad([new THREE.Vector3(c.x - CITY_HALF_W - 25, 0, z),
               new THREE.Vector3(c.x + CITY_HALF_W + 25, 0, z)], 'street', false);
    }
  }

  // ── Highways — three asymmetric routes between the cities ──

  // Harborgate ↔ Neon Bay: swings wide SE to avoid the central lake
  addRoad(curvePoints([
    [FD_CITIES[0].x, FD_CITIES[0].z],
    [FD_CITIES[0].x + 260, FD_CITIES[0].z + 190],
    [620, -670],
    [860, -360],
    [FD_CITIES[1].x - 100, FD_CITIES[1].z - 200],
    [FD_CITIES[1].x, FD_CITIES[1].z],
  ], false, 10), 'highway', false);

  // Neon Bay ↔ Solace Springs: arcs south through open land
  addRoad(curvePoints([
    [FD_CITIES[1].x, FD_CITIES[1].z],
    [FD_CITIES[1].x - 80, FD_CITIES[1].z + 280],
    [520, 560],
    [60,  730],
    [FD_CITIES[2].x + 200, FD_CITIES[2].z - 60],
    [FD_CITIES[2].x, FD_CITIES[2].z],
  ], false, 10), 'highway', false);

  // Solace Springs ↔ Harborgate: deep western arc
  addRoad(curvePoints([
    [FD_CITIES[2].x, FD_CITIES[2].z],
    [FD_CITIES[2].x - 200, FD_CITIES[2].z - 80],
    [-1150, 160],
    [-950, -520],
    [FD_CITIES[0].x - 140, FD_CITIES[0].z + 220],
    [FD_CITIES[0].x, FD_CITIES[0].z],
  ], false, 10), 'highway', false);

  // ── Coastal country ring road (irregular, non-centred) ──
  const ringRawCtrl = [
    [0,    1780], [0.32, 1940], [0.65, 1750], [0.95, 1870],
    [1.28, 1930], [1.58, 1790], [1.90, 1860], [2.22, 2020],
    [2.55, 1890], [2.88, 1970], [3.20, 1810], [3.52, 1900],
    [3.85, 1960], [4.18, 1770], [4.50, 1850], [4.82, 1730],
    [5.15, 1900], [5.50, 1960], [5.82, 1820],
  ];
  const ringPts = curvePoints(
    ringRawCtrl.map(([a, r]) => [Math.cos(a) * r, Math.sin(a) * r]),
    true, 12
  );
  addRoad(ringPts, 'country', true);

  // ── Narrow country lanes: each city out to the coastal ring (asymmetric) ──
  const laneWiggles = [70, -95, 85]; // different offsets per city for variety
  for (let ci = 0; ci < FD_CITIES.length; ci++) {
    const c = FD_CITIES[ci];
    const cl = Math.hypot(c.x, c.z) || 1;
    const ox = c.x / cl, oz = c.z / cl;
    const px = -oz, pz = ox;
    let best = ringPts[0], bd = Infinity;
    for (const p of ringPts) {
      const d = (p.x - c.x - ox * 500) ** 2 + (p.z - c.z - oz * 500) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    const w = laneWiggles[ci];
    addRoad(curvePoints([
      [c.x, c.z],
      [c.x + ox * 210 + px * w,       c.z + oz * 210 + pz * w],
      [(c.x + best.x) / 2 - px * 40,  (c.z + best.z) / 2 - pz * 40],
      [best.x, best.z],
    ], false, 10), 'lane', false);
  }

  // ── Race circuit — asymmetric oval SE of centre ──
  const RT_X = 550, RT_Z = -440;
  const raceTrackPts = curvePoints([
    [RT_X - 300, RT_Z + 20],   // pit straight (S/F)
    [RT_X - 170, RT_Z - 260],  // T1
    [RT_X + 70,  RT_Z - 370],  // T2 apex
    [RT_X + 320, RT_Z - 290],  // T3
    [RT_X + 440, RT_Z - 65],   // hairpin apex
    [RT_X + 400, RT_Z + 165],  // T4-5 complex
    [RT_X + 220, RT_Z + 295],  // T5 apex
    [RT_X - 40,  RT_Z + 340],  // long sweeper mid
    [RT_X - 280, RT_Z + 245],  // T7
    [RT_X - 420, RT_Z + 55],   // final corner
    [RT_X - 415, RT_Z - 110],  // final straight entry
  ], true, 8);
  addRoad(raceTrackPts, 'racetrack', true);

  // Start/finish white stripe
  const sfMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const sfLine = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_STYLES.racetrack.hw * 2.1, 1.5), sfMat);
  sfLine.rotation.x = -Math.PI / 2;
  sfLine.position.set(RT_X - 300, ROAD_STYLES.racetrack.y + 0.01, RT_Z + 20);
  sfLine.userData.trk = true; scene.add(sfLine);

  // Pit beacon (orange tower) at track entrance
  const pitMat = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff5500, emissiveIntensity: 0.6 });
  const pitBeacon = new THREE.Mesh(new THREE.BoxGeometry(3.5, 16, 3.5), pitMat);
  pitBeacon.position.set(RT_X - 300 + ROAD_STYLES.racetrack.hw + 4, 8, RT_Z + 20);
  pitBeacon.castShadow = true; pitBeacon.userData.trk = true; scene.add(pitBeacon);

  // Access lane: pit entrance → highway (Harborgate–Neon Bay corridor)
  addRoad(curvePoints([
    [RT_X - 300, RT_Z + 20],
    [RT_X - 420, RT_Z - 100],
    [220, -620],
    [60,  -760],
    [FD_CITIES[0].x + 110, FD_CITIES[0].z + 160],
  ], false, 10), 'lane', false);

  // ── Distance from nearest road edge (negative = on the road) ──
  function roadEdgeDist(x, z) {
    let best = Infinity;
    for (const s of roadSegs) {
      const abx = s.x1 - s.x0, abz = s.z1 - s.z0;
      const ab2 = abx * abx + abz * abz || 1;
      let t = ((x - s.x0) * abx + (z - s.z0) * abz) / ab2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (s.x0 + abx * t), dz = z - (s.z0 + abz * t);
      const d = Math.sqrt(dx * dx + dz * dz) - s.hw;
      if (d < best) best = d;
    }
    return best;
  }

  // ── City buildings ──
  const bMats = [0x2a2a3a, 0x3a3a4a, 0x222238, 0x1c2433, 0x33283d, 0x262b40]
    .map(c => new THREE.MeshLambertMaterial({ color: c }));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x333344 });
  for (const c of FD_CITIES) {
    for (let bi = -2; bi < 2; bi++) {
      for (let bj = 0; bj < 3; bj++) {
        const cx = c.x + (bi + 0.5) * BLOCK;
        const cz = c.z - CITY_HALF_D + (bj + 0.5) * BLOCK;
        if (roadEdgeDist(cx, cz) < 12) continue;
        const count = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let k = 0; k < count; k++) {
          const bw = 22 + Math.random() * 28, bd = 22 + Math.random() * 28;
          const jx = cx + (Math.random() - 0.5) * (BLOCK - bw - 16);
          const jz = cz + (Math.random() - 0.5) * (BLOCK - bd - 16);
          const centerDist = Math.hypot(jx - c.x, jz - c.z);
          const bh = 8 + 26 * Math.exp(-centerDist / 160) + Math.random() * 9;
          const bld = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd),
            bMats[Math.floor(Math.random() * bMats.length)]);
          bld.position.set(jx, bh / 2, jz); bld.castShadow = true;
          bld.userData.trk = true; scene.add(bld);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.6, 0.4, bd + 0.6), roofMat);
          roof.position.set(jx, bh + 0.2, jz); roof.userData.trk = true; scene.add(roof);
        }
      }
    }
    const tx = c.x - 45, tz = c.z + 45;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(20, 78, 20),
      new THREE.MeshLambertMaterial({ color: 0x1b1b2c }));
    tower.position.set(tx, 39, tz); tower.castShadow = true; tower.userData.trk = true; scene.add(tower);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(23, 5, 23),
      new THREE.MeshLambertMaterial({ color: c.beacon, emissive: c.beacon, emissiveIntensity: 0.8 }));
    beacon.position.set(tx, 80.5, tz); beacon.userData.trk = true; scene.add(beacon);
  }

  // ── Trees (more of them on the larger island) ──
  const TREES = 500;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.8, 5);
  const coneGeo  = new THREE.ConeGeometry(1.6, 3.8, 6);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a2810 }), TREES);
  const coneMesh  = new THREE.InstancedMesh(coneGeo,  new THREE.MeshLambertMaterial({ color: 0x1e4a1e }), TREES);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  let placedTrees = 0, attempts = 0;
  while (placedTrees < TREES && attempts < TREES * 22) {
    attempts++;
    const th = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ISLAND_R - 130);
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (r < LAKE_R + 55) continue;
    if (FD_CITIES.some(c => Math.abs(x - c.x) < CITY_HALF_W + 55 && Math.abs(z - c.z) < CITY_HALF_D + 55)) continue;
    // Keep trees away from race track
    if (Math.hypot(x - RT_X, z - RT_Z) < 560) continue;
    if (roadEdgeDist(x, z) < 10) continue;
    const s = 0.8 + Math.random() * 1.1;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    sv.set(s, s, s);
    pv.set(x, 0.9 * s, z); m4.compose(pv, q, sv); trunkMesh.setMatrixAt(placedTrees, m4);
    pv.set(x, (1.8 + 1.7) * s, z); m4.compose(pv, q, sv); coneMesh.setMatrixAt(placedTrees, m4);
    placedTrees++;
  }
  trunkMesh.count = placedTrees; coneMesh.count = placedTrees;
  trunkMesh.instanceMatrix.needsUpdate = true; coneMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.userData.trk = true; coneMesh.userData.trk = true;
  scene.add(trunkMesh); scene.add(coneMesh);

  // ── Sky + fog (extended for larger island) ──
  const sky = 0x16263e;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 600, 2100);

  // ── Spawn points: one per city + one at the race track ──
  const spawnPoints = FD_CITIES.map(c => ({
    x: c.x - 90, z: c.z - CITY_HALF_D + BLOCK, hdg: Math.PI / 2, city: c.name,
  }));
  spawnPoints.push({ x: RT_X - 285, z: RT_Z + 20, hdg: Math.PI, city: 'Race Circuit' });

  const islandBoundaryPts = getIslandBoundaryPts(120);
  fdWorld = { islandR: ISLAND_R, waterR: WATER_R, lakeR: LAKE_R, roadSegs, mapRoads, spawnPoints, cities: FD_CITIES, roadEdgeDist, islandBoundaryPts };
  return fdWorld;
}
