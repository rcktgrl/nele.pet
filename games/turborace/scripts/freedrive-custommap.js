'use strict';
import { THREE } from './three.js';
import { scene, state } from './state.js';
import { supabase } from './supabase.js';

// ═══════════════════════════════════════════════════════
//  CUSTOM FREE-RIDE MAP — 3-D rendering + cloud sync
//  Converts drive-map-editor format (nodes + roads) into
//  a Three.js scene and provides physics bounds.
// ═══════════════════════════════════════════════════════

const DRIVE_MAPS_TABLE = 'drive_custom_maps';
const ROAD_COLORS_3D = {
  highway: 0x34344a,
  street:  0x2a2838,
  country: 0x28261e,
  lane:    0x201e18,
};

function _assetHash(i) {
  let h = (i + 1) * 2654435769;
  h ^= (h >>> 15); h = Math.imul(h, 0x85ebca6b); h ^= (h >>> 13);
  return ((h >>> 0) & 0xffff) / 0xffff;
}

let _dmWorld = null;
let _dmSyncOk = true;

// ── Cloud sync ────────────────────────────────────────────────────

export async function syncDriveMapsFromCloud() {
  if (!_dmSyncOk) return;
  const { data, error } = await supabase.from(DRIVE_MAPS_TABLE)
    .select('map_id,map_data,updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) {
    _dmSyncOk = false;
    console.warn('Drive map cloud sync failed:', error.message || error);
    return;
  }
  state.driveMaps = (data || [])
    .map(r => r.map_data)
    .filter(m => m && m.id && Array.isArray(m.nodes) && Array.isArray(m.roads));
}

// ── World info ────────────────────────────────────────────────────

export function getDriveMapWorld() { return _dmWorld; }

// ── Path sampling ─────────────────────────────────────────────────

function _samplePath(pts, steps) {
  if (pts.length < 2) return pts;
  if (pts.length === 3) {
    // Quadratic bezier matching the editor's draw mode (1 waypoint = control point)
    const [A, C, B] = pts;
    const N = steps * 6;
    const result = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      result.push({ x: u*u*A.x + 2*u*t*C.x + t*t*B.x, z: u*u*A.z + 2*u*t*C.z + t*t*B.z });
    }
    return result;
  }
  // Linear polyline for 2-point roads or roads with many waypoints
  const result = [];
  const segs = pts.length - 1;
  for (let i = 0; i <= segs * steps; i++) {
    const t = i / (segs * steps);
    const seg = Math.min(Math.floor(t * segs), segs - 1);
    const f = t * segs - seg;
    const p0 = pts[seg], p1 = pts[seg + 1];
    result.push({ x: p0.x + (p1.x - p0.x) * f, z: p0.z + (p1.z - p0.z) * f });
  }
  return result;
}

function _roadPath(road, nodeMap) {
  const a = nodeMap.get(road.nodeA), b = nodeMap.get(road.nodeB);
  if (!a || !b) return null;
  return [{ x: a.x, z: a.z }, ...(road.waypoints || []), { x: b.x, z: b.z }];
}

// ── Ribbon geometry ───────────────────────────────────────────────

function _mat(color) { return new THREE.MeshLambertMaterial({ color }); }

const _TREE_GREENS  = [0x1e4a0a, 0x2d5c14, 0x3a6618, 0x4a7820, 0x3d6e1a, 0x2a5010, 0x456c1c];
const _HOUSE_COLS   = [0xc4b090, 0xb0a07a, 0x9a8e78, 0x8c8070, 0x786860, 0x645850, 0x524840, 0x3e3430];
const _CITY_COLS    = [0x524840, 0x3e3430, 0x4a4438, 0x383230, 0x6a6058, 0x504844, 0x403c38, 0x302c28];
const _NEON_COLS    = [0xff2244, 0x2244ff, 0x22ff88, 0xff8822];
const _WIN_MAT      = new THREE.MeshLambertMaterial({ color: 0x445566, emissive: 0x223344, transparent: true, opacity: 0.6 });
const _WARM_WIN_MAT = new THREE.MeshLambertMaterial({ color: 0x554422, emissive: 0x332211 });

function _buildSideWalls(pts, halfRoadW, wallH, wallColor) {
  const wMat  = _mat(wallColor);
  const capMat = _mat(0xaaaaaa);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const sLen = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dz / sLen, nz = dx / sLen;
    const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
    const ang = Math.atan2(dx, dz);
    for (const s of [-1, 1]) {
      const wx = cx + nx * halfRoadW * s;
      const wz = cz + nz * halfRoadW * s;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, wallH, sLen + 0.2), wMat);
      wall.position.set(wx, wallH / 2, wz); wall.rotation.y = ang;
      wall.castShadow = true; wall.receiveShadow = true; wall.userData.trk = true; scene.add(wall);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, sLen + 0.2), capMat);
      cap.position.set(wx, wallH + 0.125, wz); cap.rotation.y = ang;
      cap.userData.trk = true; scene.add(cap);
    }
  }
}

function _buildSidewalks(pts, halfRoadW, swColor) {
  const swW = 2.2, swMat = _mat(swColor), curbMat = _mat(0x48484e);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const sLen = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dz / sLen, nz = dx / sLen;
    const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
    const ang = Math.atan2(dx, dz);
    for (const s of [-1, 1]) {
      const off = halfRoadW + swW / 2;
      const swx = cx + nx * off * s, swz = cz + nz * off * s;
      // BoxGeometry(width=X, height=Y, depth=Z): depth must be sLen so it aligns with road after rotation.y=ang
      const sw = new THREE.Mesh(new THREE.BoxGeometry(swW, 0.12, sLen), swMat);
      sw.position.set(swx, 0.06, swz); sw.rotation.y = ang; sw.userData.trk = true; scene.add(sw);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, sLen), curbMat);
      curb.position.set(cx + nx * halfRoadW * s, 0.07, cz + nz * halfRoadW * s);
      curb.rotation.y = ang; curb.userData.trk = true; scene.add(curb);
    }
  }
}

function _buildStreetLamps(pts, halfRoadW) {
  const poleMat = _mat(0x444455);
  const bulbMat = new THREE.MeshLambertMaterial({ color: 0xffeedd, emissive: 0xaa8844 });
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.12, depthWrite: false });
  const poolGeo = new THREE.CircleGeometry(8, 12);
  const interval = 18;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const sLen = Math.sqrt(dx * dx + dz * dz) || 1;
    acc += sLen;
    if (acc < interval) continue;
    acc -= interval;
    const nx = -dz / sLen, nz = dx / sLen;
    const s = 1; // right side only
    const lx = p1.x + nx * (halfRoadW + 1.8) * s;
    const lz = p1.z + nz * (halfRoadW + 1.8) * s;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 6.5, 5), poleMat);
    pole.position.set(lx, 3.25, lz); pole.userData.trk = true; scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.8), poleMat);
    arm.position.set(lx + nx * -1.0 * s, 6.3, lz + nz * -1.0 * s);
    arm.rotation.y = Math.atan2(-dz, dx); arm.userData.trk = true; scene.add(arm);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.35), bulbMat);
    bulb.position.set(lx + nx * -1.8 * s, 6.2, lz + nz * -1.8 * s);
    bulb.userData.trk = true; scene.add(bulb);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2; pool.position.set(p1.x, 0.07, p1.z);
    pool.userData.trk = true; scene.add(pool);
  }
}

const ROAD_Y = 0.04; // raised above ground to prevent Z-fighting

// Priority: lower number = rendered on top at intersections
const _ROAD_TYPE_PRI = { street: 0, highway: 1, lane: 2, country: 3 };

function _buildIntersectionCorners(nodeMap, roads) {
  // Build per-node road list
  const nodeToRoads = new Map();
  for (const road of roads) {
    for (const nid of [road.nodeA, road.nodeB]) {
      if (!nodeToRoads.has(nid)) nodeToRoads.set(nid, []);
      nodeToRoads.get(nid).push(road);
    }
  }

  for (const [nid, rds] of nodeToRoads) {
    if (rds.length < 2) continue;
    const node = nodeMap.get(nid);
    if (!node) continue;

    // Dominant type = highest priority road at this intersection
    const dom = rds.reduce((best, r) =>
      (_ROAD_TYPE_PRI[r.type] ?? 3) < (_ROAD_TYPE_PRI[best.type] ?? 3) ? r : best);
    const maxW = rds.reduce((m, r) => Math.max(m, r.width || 10), 0);

    // Sidewalk corner fill behind road (street type only)
    if (dom.type === 'street') {
      const swW = 2.2, fullW = maxW + swW * 2;
      const swMat = _mat(0x28283a);
      swMat.polygonOffset = true; swMat.polygonOffsetFactor = -0.5; swMat.polygonOffsetUnits = -1;
      const swMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(fullW, fullW).rotateX(-Math.PI / 2), swMat);
      swMesh.position.set(node.x, ROAD_Y - 0.005, node.z);
      swMesh.userData.trk = true; scene.add(swMesh);
    }

    // Road surface corner fill
    const roadMat = new THREE.MeshLambertMaterial({ color: ROAD_COLORS_3D[dom.type] || ROAD_COLORS_3D.street });
    roadMat.polygonOffset = true; roadMat.polygonOffsetFactor = -1; roadMat.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(maxW, maxW).rotateX(-Math.PI / 2), roadMat);
    mesh.position.set(node.x, ROAD_Y + 0.001, node.z);
    mesh.receiveShadow = true; mesh.userData.trk = true; scene.add(mesh);
  }
}

function _buildRibbon(pts, width) {
  if (!pts || pts.length < 2) return null;
  const pos = [], idx = [];
  let verts = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
    if (i === 0) {
      pos.push(p0.x + nx, ROAD_Y, p0.z + nz,
               p0.x - nx, ROAD_Y, p0.z - nz);
      verts += 2;
    }
    pos.push(p1.x + nx, ROAD_Y, p1.z + nz,
             p1.x - nx, ROAD_Y, p1.z - nz);
    const b = verts - 2;
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    verts += 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function _buildRoadMarkings(pts, width, roadType) {
  const markY = ROAD_Y + 0.01;
  if (roadType === 'highway') {
    // Solid white edge lines on both sides
    for (const side of [-1, 1]) {
      const offset = width / 2 - 1.2;
      const lw = 0.35;
      const pos = [], idx = [];
      let v = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        const len = Math.sqrt(dx*dx + dz*dz) || 1;
        const nx = (-dz/len), nz = (dx/len);
        if (i === 0) {
          pos.push(p0.x + nx*(offset+lw)*side, markY, p0.z + nz*(offset+lw)*side,
                   p0.x + nx*(offset-lw)*side, markY, p0.z + nz*(offset-lw)*side);
          v += 2;
        }
        pos.push(p1.x + nx*(offset+lw)*side, markY, p1.z + nz*(offset+lw)*side,
                 p1.x + nx*(offset-lw)*side, markY, p1.z + nz*(offset-lw)*side);
        const b = v - 2; idx.push(b, b+2, b+1, b+1, b+2, b+3); v += 2;
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        mesh.userData.trk = true; scene.add(mesh);
      }
    }
    // Yellow center dashes
    _buildDashLine(pts, markY, 0, 0.25, 8, 6, 0xffee00);
  } else if (roadType === 'street') {
    // Yellow dashed center line
    _buildDashLine(pts, markY, 0, 0.22, 5, 4, 0xddcc22);
  } else if (roadType === 'country') {
    // White dashed center line
    _buildDashLine(pts, markY, 0, 0.20, 8, 6, 0xdddddd);
  }
  // 'lane' gets no markings
}

function _buildDashLine(pts, y, lateralOffset, halfW, dashLen, gapLen, color) {
  const pos = [], idx = [];
  let v = 0, acc = 0, isDash = true;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const sLen = Math.sqrt(dx*dx + dz*dz) || 1;
    const ux = dx/sLen, uz = dz/sLen;
    const rx = -dz/sLen, rz = dx/sLen;
    let t = 0;
    while (t < sLen) {
      const remain = isDash ? (dashLen - acc) : (gapLen - acc);
      const advance = Math.min(remain, sLen - t);
      if (isDash && advance > 0.05) {
        const sx = p0.x + ux*t + rx*lateralOffset, sz = p0.z + uz*t + rz*lateralOffset;
        const ex = p0.x + ux*(t+advance) + rx*lateralOffset, ez = p0.z + uz*(t+advance) + rz*lateralOffset;
        pos.push(sx - rx*halfW, y, sz - rz*halfW,
                 sx + rx*halfW, y, sz + rz*halfW,
                 ex - rx*halfW, y, ez - rz*halfW,
                 ex + rx*halfW, y, ez + rz*halfW);
        idx.push(v, v+2, v+1, v+1, v+2, v+3); v += 4;
      }
      acc += advance; t += advance;
      if (acc >= (isDash ? dashLen : gapLen)) { acc = 0; isDash = !isDash; }
    }
  }
  if (pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    mesh.userData.trk = true; scene.add(mesh);
  }
}

// ── Road-exclusion helper ─────────────────────────────────────────

function _pointOnRoad(x, z, roads, nodeMap) {
  for (const road of roads) {
    const raw = _roadPath(road, nodeMap);
    if (!raw) continue;
    const pts = _samplePath(raw, 6);
    const hw = (road.width || 10) / 2 + 2; // small margin
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      const ux = dx/len, uz = dz/len;
      const tx = x - p0.x, tz = z - p0.z;
      const proj = tx*ux + tz*uz;
      if (proj >= 0 && proj <= len) {
        const perp = Math.abs(tx*uz - tz*ux);
        if (perp < hw) return true;
      }
    }
  }
  return false;
}

// ── Scene builder ─────────────────────────────────────────────────

export function buildDriveMap(mapData) {
  // Remove existing trk-tagged scene objects
  const rm = []; scene.traverse(o => { if (o.userData.trk) rm.push(o); }); rm.forEach(o => scene.remove(o));
  state.sceneryColliders = [];

  // Fog + sky
  const skyHex = parseInt((mapData.skyColor || '#0d1a2e').replace('#', ''), 16);
  const fogDist = mapData.fogDist || 800;
  scene.fog = new THREE.Fog(skyHex, fogDist * 0.35, fogDist);
  scene.background = new THREE.Color(skyHex);

  const nodeMap = new Map();
  for (const n of (mapData.nodes || [])) nodeMap.set(n.id, n);

  // Ground plane
  const gndColor = parseInt((mapData.groundColor || '#1a3018').replace('#', ''), 16);
  const gnd = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: gndColor })
  );
  gnd.receiveShadow = true; gnd.userData.trk = true; scene.add(gnd);

  // Roads
  const roadList = mapData.roads || [];
  for (const road of roadList) {
    const raw = _roadPath(road, nodeMap);
    if (!raw) continue;
    const pts = _samplePath(raw, 8);
    const geo = _buildRibbon(pts, road.width || 10);
    if (!geo) continue;
    const roadMat = new THREE.MeshLambertMaterial({
      color: ROAD_COLORS_3D[road.type] || ROAD_COLORS_3D.street,
    });
    roadMat.polygonOffset = true; roadMat.polygonOffsetFactor = -1; roadMat.polygonOffsetUnits = -2;
    const mesh = new THREE.Mesh(geo, roadMat);
    mesh.receiveShadow = true; mesh.userData.trk = true; scene.add(mesh);

    _buildRoadMarkings(pts, road.width || 10, road.type || 'street');

    const hw = (road.width || 10) / 2;
    if (road.type === 'highway') {
      _buildSideWalls(pts, hw + 0.3, 3.8, 0x888888);
    } else if (road.type === 'street') {
      _buildSidewalks(pts, hw, 0x28283a);
      _buildStreetLamps(pts, hw);
    } else if (road.type === 'lane') {
      _buildSidewalks(pts, hw, 0x222230);
    }
  }

  // Intersection corner fills — prevent empty gaps where roads meet
  _buildIntersectionCorners(nodeMap, roadList);

  // Assets — skip any that land on a road, add colliders for trees/buildings
  (mapData.assets || []).forEach((asset, i) => {
    if (_pointOnRoad(asset.x, asset.z, roadList, nodeMap)) return;
    const t = _assetHash(i);
    const t2 = _assetHash(i + 1000);
    let mesh = null;
    if (asset.type === 'tree') {
      const h = 5 + t * 9;
      const grn = _TREE_GREENS[Math.floor(t2 * _TREE_GREENS.length)];
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.5, h * 0.35, 5),
        _mat(0x5c3a1a)
      );
      trunk.position.y = h * 0.175;
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(2 + t2 * 1.5, h * 0.75, 6),
        _mat(grn)
      );
      crown.position.y = h * 0.55;
      mesh = new THREE.Group();
      mesh.add(trunk); mesh.add(crown);
      mesh.position.set(asset.x, 0, asset.z);
    } else if (asset.type === 'building') {
      const isCity = asset.tall || asset.city;
      const t3 = _assetHash(i + 2000), t4 = _assetHash(i + 3000);
      const h = isCity ? 18 + t * 40 : 5 + t * 12;
      const w = 6 + t2 * 8, d = 6 + t3 * 8;
      const palette = isCity ? _CITY_COLS : _HOUSE_COLS;
      const col = palette[Math.floor(t4 * palette.length)];
      const g = new THREE.Group();
      const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _mat(col));
      bld.position.y = h / 2; bld.castShadow = true; g.add(bld);

      // Interlaced window/wall floors — every other floor gets a window band
      const floorH = isCity ? 3.5 : 3.0;
      const winBandH = floorH * 0.55;
      const numFloors = Math.max(1, Math.floor(h / floorH));
      const winMat = (t4 > 0.5) ? _WIN_MAT : _WARM_WIN_MAT;
      for (let f = 0; f < numFloors; f++) {
        if (f % 2 !== 0) continue; // only every other floor has windows
        const wy = f * floorH + (floorH - winBandH) / 2 + winBandH / 2;
        if (wy + winBandH / 2 > h) continue;
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(w + 0.06, winBandH, d + 0.06),
          winMat
        );
        band.position.y = wy; g.add(band);
      }

      if (isCity && h > 22 && t4 > 0.78) {
        const nCol = _NEON_COLS[Math.floor(t * _NEON_COLS.length)];
        const nSign = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.55, 0.6, 0.1),
          new THREE.MeshLambertMaterial({ color: nCol, emissive: (nCol & 0xfefefe) >> 1 })
        );
        nSign.position.set(0, h * 0.6, d / 2 + 0.12); g.add(nSign);
      }
      mesh = g;
      mesh.position.set(asset.x, 0, asset.z);
    } else if (asset.type === 'park') {
      const g = new THREE.Group();
      const ground = new THREE.Mesh(
        new THREE.BoxGeometry(16, 0.12, 16),
        new THREE.MeshLambertMaterial({ color: 0x2d7a2d })
      );
      ground.position.y = 0.06;
      g.add(ground);
      for (let ti = 0; ti < 4; ti++) {
        const th = _assetHash(i * 13 + ti);
        const ang = (ti / 4) * Math.PI * 2;
        const grn = _TREE_GREENS[Math.floor(th * _TREE_GREENS.length)];
        const tr = new THREE.Mesh(
          new THREE.ConeGeometry(1.2 + th * 0.8, 4 + th * 4, 5),
          _mat(grn)
        );
        tr.position.set(Math.cos(ang) * 5.5, 2 + th * 2, Math.sin(ang) * 5.5);
        g.add(tr);
      }
      mesh = g;
      mesh.position.set(asset.x, 0, asset.z);
    } else if (asset.type === 'stand') {
      const h = 4 + t * 3;
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(16, h, 5),
        new THREE.MeshLambertMaterial({ color: 0x8a4a3a })
      );
      mesh.position.set(asset.x, h / 2, asset.z);
    }
    if (mesh) {
      mesh.castShadow = true; mesh.userData.trk = true; scene.add(mesh);
      // Colliders for solid objects
      if (asset.type === 'tree') {
        state.sceneryColliders.push({ x: asset.x, z: asset.z, r: 1.2 });
      } else if (asset.type === 'building') {
        state.sceneryColliders.push({ x: asset.x, z: asset.z, r: 4.5 });
      }
    }
  });

  // Compute bounding box for physics
  const allX = (mapData.nodes || []).map(n => n.x);
  const allZ = (mapData.nodes || []).map(n => n.z);
  const minX = Math.min(...allX, 0) - 80, maxX = Math.max(...allX, 0) + 80;
  const minZ = Math.min(...allZ, 0) - 80, maxZ = Math.max(...allZ, 0) + 80;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const boundary = Math.max((maxX - minX) / 2, (maxZ - minZ) / 2) + 120;

  // Spawn at first node, pointing along its first road
  const firstNode = (mapData.nodes || [])[0] || { x: 0, z: 0 };
  const firstRoad = (mapData.roads || []).find(r => r.nodeA === firstNode.id || r.nodeB === firstNode.id);
  let spawnHdg = 0;
  if (firstRoad) {
    const otherId = firstRoad.nodeA === firstNode.id ? firstRoad.nodeB : firstRoad.nodeA;
    const other = nodeMap.get(otherId);
    if (other) spawnHdg = Math.atan2(other.x - firstNode.x, other.z - firstNode.z);
  }

  _dmWorld = { cx, cz, boundary, spawnX: firstNode.x, spawnZ: firstNode.z, spawnHdg };
  return _dmWorld;
}

// ── Physics bound ─────────────────────────────────────────────────

export function applyDriveMapBounds(car) {
  if (!_dmWorld) return;
  const { cx, cz, boundary } = _dmWorld;
  const dx = car.pos.x - cx, dz = car.pos.z - cz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > boundary) {
    const f = boundary / d;
    car.pos.x = cx + dx * f; car.pos.z = cz + dz * f;
    car.spd *= 0.8; if (car.isReversing) car.revSpd *= 0.7;
    car.mesh.position.copy(car.pos);
  }

  // Scenery collisions
  const carR = 1.3;
  for (const col of state.sceneryColliders) {
    const cdx = car.pos.x - col.x, cdz = car.pos.z - col.z;
    const cd = Math.sqrt(cdx*cdx + cdz*cdz);
    const minD = col.r + carR;
    if (cd < minD && cd > 0.01) {
      const f2 = minD / cd;
      car.pos.x = col.x + cdx * f2; car.pos.z = col.z + cdz * f2;
      car.spd *= 0.5; if (car.isReversing) car.revSpd *= 0.5;
      car.mesh.position.copy(car.pos);
    }
  }
}

// ── Minimap canvas ────────────────────────────────────────────────

const MINIMAP_ROAD_COLORS = {
  highway: '#48485a', street: '#38364a', country: '#2c2820', lane: '#22201a',
};

export function buildDriveMapMinimap(mapData) {
  const S = 150, half = S / 2;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');

  const nodeMap = new Map();
  for (const n of (mapData.nodes || [])) nodeMap.set(n.id, n);

  const allX = (mapData.nodes || []).map(n => n.x);
  const allZ = (mapData.nodes || []).map(n => n.z);
  const minX = Math.min(...allX, 0), maxX = Math.max(...allX, 0);
  const minZ = Math.min(...allZ, 0), maxZ = Math.max(...allZ, 0);
  const rangeX = maxX - minX || 200, rangeZ = maxZ - minZ || 200;
  const scale = (half - 18) / Math.max(rangeX, rangeZ) * 2;
  const ocx = (minX + maxX) / 2, ocz = (minZ + maxZ) / 2;
  const toM = (x, z) => [half + (x - ocx) * scale, half + (z - ocz) * scale];

  ctx.fillStyle = 'rgba(4,10,24,.85)'; ctx.fillRect(0, 0, S, S);

  for (const road of (mapData.roads || [])) {
    const raw = _roadPath(road, nodeMap);
    if (!raw) continue;
    const pts = _samplePath(raw, 4);
    ctx.strokeStyle = MINIMAP_ROAD_COLORS[road.type] || '#444';
    ctx.lineWidth = Math.max(1.5, (road.width || 10) * scale * 0.45);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => { const [mx, mz] = toM(p.x, p.z); i ? ctx.lineTo(mx, mz) : ctx.moveTo(mx, mz); });
    ctx.stroke();
  }

  ctx.font = 'bold 8px Orbitron,monospace'; ctx.fillStyle = '#4af'; ctx.textAlign = 'center';
  ctx.fillText((mapData.name || 'MAP').slice(0, 14).toUpperCase(), half, S - 4);
  ctx.textAlign = 'left';

  return { canvas: c, scale, cx: ocx, cz: ocz };
}

// ── Card preview (2-D for the map-selection UI) ───────────────────

const PREVIEW_ROAD_COLORS = {
  highway: '#48485a', street: '#4466aa', country: '#556633', lane: '#443322',
};

export function drawDriveMapPreview(canvas, mapData) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const nodeMap = new Map();
  for (const n of (mapData.nodes || [])) nodeMap.set(n.id, n);

  const allX = (mapData.nodes || []).map(n => n.x);
  const allZ = (mapData.nodes || []).map(n => n.z);
  if (!allX.length) { ctx.fillStyle = '#0c0c18'; ctx.fillRect(0, 0, W, H); return; }

  const pad = 22;
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minZ = Math.min(...allZ), maxZ = Math.max(...allZ);
  const scale = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxZ - minZ || 1));
  const offX = (W - (maxX - minX) * scale) / 2, offZ = (H - (maxZ - minZ) * scale) / 2;
  const pt = (x, z) => [(x - minX) * scale + offX, (z - minZ) * scale + offZ];

  ctx.fillStyle = '#0c0c18'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#161622'; ctx.lineWidth = 1;
  for (let gx = Math.ceil(minX / 50) * 50; gx <= maxX; gx += 50) {
    const [sx] = pt(gx, minZ); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let gz = Math.ceil(minZ / 50) * 50; gz <= maxZ; gz += 50) {
    const [, sz] = pt(minX, gz); ctx.beginPath(); ctx.moveTo(0, sz); ctx.lineTo(W, sz); ctx.stroke();
  }

  for (const road of (mapData.roads || [])) {
    const raw = _roadPath(road, nodeMap);
    if (!raw) continue;
    const col = PREVIEW_ROAD_COLORS[road.type] || '#448';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = col + '55'; ctx.lineWidth = Math.max(2, (road.width || 10) * scale * 1.2);
    ctx.beginPath();
    raw.forEach((p, i) => { const [px, pz] = pt(p.x, p.z); i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
    ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath();
    raw.forEach((p, i) => { const [px, pz] = pt(p.x, p.z); i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
    ctx.stroke();
  }

  // Intersection dots
  for (const n of (mapData.nodes || [])) {
    const [nx, nz] = pt(n.x, n.z);
    ctx.beginPath(); ctx.arc(nx, nz, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#aabbff'; ctx.fill();
  }

  ctx.font = 'bold 9px Orbitron,monospace'; ctx.fillStyle = '#4af'; ctx.textAlign = 'center';
  ctx.fillText('FREE RIDE MAP', W / 2, H - 6); ctx.textAlign = 'left';
}
