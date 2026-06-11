'use strict';
import { state, scene } from './state.js';
import { THREE } from './three.js';

// ═══════════════════════════════════════════════════════
//  FREE DRIVE — OPEN WORLD ISLAND
//  One big island, three cities connected by highways,
//  a winding coastal country road and narrow lanes.
// ═══════════════════════════════════════════════════════

export const ISLAND_R = 1200;     // grass radius — beach + water beyond
export const WATER_R  = 1265;     // hard boundary (cars get pushed back)
export const LAKE_R   = 170;      // central lake (also a boundary)

export const FD_CITIES = [
  { name: 'Aurora Heights', x: 0,    z: -650, beacon: 0xff3355 },
  { name: 'Neon Bay',       x: 600,  z: 390,  beacon: 0x33ddff },
  { name: 'Solace Springs', x: -600, z: 390,  beacon: 0xc44aff },
];

const CITY_HALF_W = 180, CITY_HALF_D = 135, BLOCK = 90;

// Road types — hw is the HALF width in metres. Different sizes per request:
// 22 m highways, 10 m country ring, 7 m lanes, 11 m city streets.
const ROAD_STYLES = {
  highway: { hw: 11,  y: 0.030, col: 0x17171d },
  country: { hw: 5,   y: 0.012, col: 0x1e1c18 },
  lane:    { hw: 3.5, y: 0.006, col: 0x211e16 },
  street:  { hw: 5.5, y: 0.018, col: 0x191922 },
};

let fdWorld = null;
export function getFreeDriveWorld(){ return fdWorld; }

// ── Geometry helpers ─────────────────────────────────────

function polylineNormal(pts, i, closed){
  const n = pts.length;
  const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
  const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
  const tx = next.x - prev.x, tz = next.z - prev.z, l = Math.hypot(tx, tz) || 1;
  return { nx: -tz / l, nz: tx / l, tx: tx / l, tz: tz / l };
}

function addStripMesh(pts, hw, y, material, closed){
  const n = pts.length, verts = [], idx = [];
  for(let i = 0; i < n; i++){
    const p = pts[i], { nx, nz } = polylineNormal(pts, i, closed);
    verts.push(p.x - nx * hw, y, p.z - nz * hw, p.x + nx * hw, y, p.z + nz * hw);
  }
  const segCount = closed ? n : n - 1;
  for(let i = 0; i < segCount; i++){
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

function offsetPolyline(pts, off, closed){
  return pts.map((p, i) => {
    const { nx, nz } = polylineNormal(pts, i, closed);
    return new THREE.Vector3(p.x + nx * off, 0, p.z + nz * off);
  });
}

// Dashed centre line: one short quad every few sample points.
function addDashes(pts, y, material, closed, stride = 3, frac = 0.42, w = 0.32){
  const n = pts.length, verts = [], idx = []; let vi = 0;
  const last = closed ? n : n - 1;
  for(let i = 0; i < last; i += stride){
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const tx = p1.x - p0.x, tz = p1.z - p0.z, l = Math.hypot(tx, tz) || 1;
    const ux = tx / l, uz = tz / l, nx = -uz, nz = ux;
    const len = l * frac * 2.2;
    const ax = p0.x, az = p0.z, bx = p0.x + ux * len, bz = p0.z + uz * len;
    verts.push(ax - nx * w, y, az - nz * w, ax + nx * w, y, az + nz * w,
               bx + nx * w, y, bz + nz * w, bx - nx * w, y, bz - nz * w);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
  }
  if(!verts.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.trk = true; scene.add(mesh);
}

function curvePoints(ctrl, closed, step = 10){
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map(p => new THREE.Vector3(p[0], 0, p[1])), closed, 'centripetal', 0.5);
  const len = curve.getLength();
  const n = Math.max(8, Math.round(len / step));
  return curve.getSpacedPoints(n);
}

// ── World build ──────────────────────────────────────────

export function buildFreeDriveWorld(){
  // Clear previous track/world meshes (same tag the race tracks use)
  const rm = []; scene.traverse(o => { if(o.userData.trk) rm.push(o); }); rm.forEach(o => scene.remove(o));

  // Reset race-track state so Car physics treat the island as open ground:
  // empty trkPts → flat groundY, no walls, no checkpoints, no gravel profile.
  state.trkData = null; state.trkCurve = null; state.trkPts = []; state.trkCurv = [];
  state.trkWallLeft = []; state.trkWallRight = []; state.trkEdgeLeft = []; state.trkEdgeRight = [];
  state.cityCorridors = null; state.cityAiPts = null; state.gravelProfile = null;
  state.sceneryExclusionZones = [];

  const roadSegs = [];          // {x0,z0,x1,z1,hw} for on/off-road queries
  const mapRoads = [];          // {pts:[[x,z]...], type} for the minimap

  const matFor = {};
  for(const [type, s] of Object.entries(ROAD_STYLES)){
    matFor[type] = new THREE.MeshLambertMaterial({ color: s.col });
  }
  const matEdge = new THREE.MeshLambertMaterial({ color: 0xcfcfd4 });
  const matDashW = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
  const matDashY = new THREE.MeshLambertMaterial({ color: 0xbfa133 });

  function addRoad(pts, type, closed){
    const s = ROAD_STYLES[type];
    addStripMesh(pts, s.hw, s.y, matFor[type], closed);
    const segCount = closed ? pts.length : pts.length - 1;
    for(let i = 0; i < segCount; i++){
      const a = pts[i], b = pts[(i + 1) % pts.length];
      roadSegs.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z, hw: s.hw });
    }
    mapRoads.push({ pts: pts.map(p => [p.x, p.z]), type, closed: !!closed });
    if(type === 'highway'){
      addStripMesh(offsetPolyline(pts, -(s.hw - 0.7), closed), 0.22, s.y + 0.006, matEdge, closed);
      addStripMesh(offsetPolyline(pts, s.hw - 0.7, closed), 0.22, s.y + 0.006, matEdge, closed);
      addDashes(pts, s.y + 0.006, matDashY, closed);
    } else if(type === 'country'){
      addDashes(pts, s.y + 0.006, matDashW, closed);
    }
  }

  // ── Ground: water, beach, grass, lake ──
  const water = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000),
    new THREE.MeshLambertMaterial({ color: 0x0d3550 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.45; water.userData.trk = true; scene.add(water);

  const beach = new THREE.Mesh(new THREE.RingGeometry(ISLAND_R - 14, ISLAND_R + 95, 96),
    new THREE.MeshLambertMaterial({ color: 0x8a7a55 }));
  beach.rotation.x = -Math.PI / 2; beach.position.y = -0.16; beach.userData.trk = true; scene.add(beach);

  const grass = new THREE.Mesh(new THREE.CircleGeometry(ISLAND_R, 96),
    new THREE.MeshLambertMaterial({ color: 0x1a3018 }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.08; grass.receiveShadow = true;
  grass.userData.trk = true; scene.add(grass);

  const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE_R, 48),
    new THREE.MeshLambertMaterial({ color: 0x0e3d5c }));
  lake.rotation.x = -Math.PI / 2; lake.position.y = -0.02; lake.userData.trk = true; scene.add(lake);
  const lakeShore = new THREE.Mesh(new THREE.RingGeometry(LAKE_R - 2, LAKE_R + 16, 48),
    new THREE.MeshLambertMaterial({ color: 0x86764f }));
  lakeShore.rotation.x = -Math.PI / 2; lakeShore.position.y = -0.05; lakeShore.userData.trk = true; scene.add(lakeShore);

  // ── City plazas + street grids ──
  const plazaMat = new THREE.MeshLambertMaterial({ color: 0x15151c });
  for(const c of FD_CITIES){
    const plaza = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_HALF_W * 2 + 50, CITY_HALF_D * 2 + 50), plazaMat);
    plaza.rotation.x = -Math.PI / 2; plaza.position.set(c.x, 0.002, c.z);
    plaza.receiveShadow = true; plaza.userData.trk = true; scene.add(plaza);

    for(let i = -2; i <= 2; i++){       // vertical streets (along z)
      addRoad([new THREE.Vector3(c.x + i * BLOCK, 0, c.z - CITY_HALF_D - 25),
               new THREE.Vector3(c.x + i * BLOCK, 0, c.z + CITY_HALF_D + 25)], 'street', false);
    }
    for(let j = 0; j < 4; j++){          // horizontal streets (along x)
      const z = c.z - CITY_HALF_D + j * BLOCK;
      addRoad([new THREE.Vector3(c.x - CITY_HALF_W - 25, 0, z),
               new THREE.Vector3(c.x + CITY_HALF_W + 25, 0, z)], 'street', false);
    }
  }

  // ── Highways between the three cities (run right into downtown) ──
  const bulges = [150, -130, 170];
  for(let i = 0; i < 3; i++){
    const a = FD_CITIES[i], b = FD_CITIES[(i + 1) % 3];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    // Bulge outward (away from the island centre) so highways arc around the lake
    const ml = Math.hypot(mx, mz) || 1;
    const bx = mx + (mx / ml) * bulges[i], bz = mz + (mz / ml) * bulges[i];
    const ctrl = [
      [a.x, a.z],
      [a.x + ux * 300, a.z + uz * 300],
      [bx, bz],
      [b.x - ux * 300, b.z - uz * 300],
      [b.x, b.z],
    ];
    addRoad(curvePoints(ctrl, false, 10), 'highway', false);
  }

  // ── Coastal country ring road (winding, mid size) ──
  const ringCtrl = [];
  for(let k = 0; k < 26; k++){
    const th = (k / 26) * Math.PI * 2;
    const r = 1000 + 70 * Math.sin(th * 3 + 1.7) + 45 * Math.sin(th * 5.3 + 0.6);
    ringCtrl.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  const ringPts = curvePoints(ringCtrl, true, 12);
  addRoad(ringPts, 'country', true);

  // ── Narrow country lanes: each city out to the coastal ring ──
  for(const c of FD_CITIES){
    const cl = Math.hypot(c.x, c.z) || 1;
    const ox = c.x / cl, oz = c.z / cl;           // outward direction
    const px = -oz, pz = ox;                       // perpendicular, for wiggle
    // find the ring point closest to the city's outward ray
    let best = ringPts[0], bd = Infinity;
    for(const p of ringPts){
      const d = (p.x - ox * 1010) ** 2 + (p.z - oz * 1010) ** 2;
      if(d < bd){ bd = d; best = p; }
    }
    const ctrl = [
      [c.x, c.z],
      [c.x + ox * 190 + px * 45, c.z + oz * 190 + pz * 45],
      [c.x + ox * 300 - px * 65, c.z + oz * 300 - pz * 65],
      [(c.x + best.x) / 2 + px * 50, (c.z + best.z) / 2 + pz * 50],
      [best.x, best.z],
    ];
    addRoad(curvePoints(ctrl, false, 10), 'lane', false);
  }

  // Distance from a point to the nearest road edge (negative = on the road)
  function roadEdgeDist(x, z){
    let best = Infinity;
    for(const s of roadSegs){
      const abx = s.x1 - s.x0, abz = s.z1 - s.z0;
      const ab2 = abx * abx + abz * abz || 1;
      let t = ((x - s.x0) * abx + (z - s.z0) * abz) / ab2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (s.x0 + abx * t), dz = z - (s.z0 + abz * t);
      const d = Math.sqrt(dx * dx + dz * dz) - s.hw;
      if(d < best) best = d;
    }
    return best;
  }

  // ── City buildings ──
  const bMats = [0x2a2a3a, 0x3a3a4a, 0x222238, 0x1c2433, 0x33283d, 0x262b40]
    .map(c => new THREE.MeshLambertMaterial({ color: c }));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x333344 });
  for(const c of FD_CITIES){
    for(let bi = -2; bi < 2; bi++){
      for(let bj = 0; bj < 3; bj++){
        const cx = c.x + (bi + 0.5) * BLOCK;
        const cz = c.z - CITY_HALF_D + (bj + 0.5) * BLOCK;
        if(roadEdgeDist(cx, cz) < 12) continue;     // highway cuts through this block
        const count = 1 + (Math.random() < 0.5 ? 1 : 0);
        for(let k = 0; k < count; k++){
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
    // Landmark tower with a coloured beacon — visible from across the island
    const tx = c.x - 45, tz = c.z + 45;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(20, 78, 20),
      new THREE.MeshLambertMaterial({ color: 0x1b1b2c }));
    tower.position.set(tx, 39, tz); tower.castShadow = true; tower.userData.trk = true; scene.add(tower);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(23, 5, 23),
      new THREE.MeshLambertMaterial({ color: c.beacon, emissive: c.beacon, emissiveIntensity: 0.8 }));
    beacon.position.set(tx, 80.5, tz); beacon.userData.trk = true; scene.add(beacon);
  }

  // ── Trees (instanced — cheap even at a few hundred) ──
  const TREES = 300;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.8, 5);
  const coneGeo = new THREE.ConeGeometry(1.6, 3.8, 6);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a2810 }), TREES);
  const coneMesh = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0x1e4a1e }), TREES);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  let placedTrees = 0, attempts = 0;
  while(placedTrees < TREES && attempts < TREES * 14){
    attempts++;
    const th = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ISLAND_R - 70);
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if(r < LAKE_R + 40) continue;
    if(FD_CITIES.some(c => Math.abs(x - c.x) < CITY_HALF_W + 40 && Math.abs(z - c.z) < CITY_HALF_D + 40)) continue;
    if(roadEdgeDist(x, z) < 9) continue;
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

  // ── Sky + fog ──
  const sky = 0x16263e;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 320, 980);

  // ── Spawn points: one per city, on a central horizontal street ──
  const spawnPoints = FD_CITIES.map(c => ({
    x: c.x - 90, z: c.z - CITY_HALF_D + BLOCK, hdg: Math.PI / 2, city: c.name,
  }));

  fdWorld = { islandR: ISLAND_R, waterR: WATER_R, lakeR: LAKE_R, roadSegs, mapRoads, spawnPoints, cities: FD_CITIES, roadEdgeDist };
  return fdWorld;
}
