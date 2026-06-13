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
      const sw = new THREE.Mesh(new THREE.BoxGeometry(sLen, 0.12, swW), swMat);
      sw.position.set(swx, 0.06, swz); sw.rotation.y = ang; sw.userData.trk = true; scene.add(sw);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(sLen, 0.14, 0.15), curbMat);
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
    arm.rotation.y = Math.atan2(dx, dz); arm.userData.trk = true; scene.add(arm);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.35), bulbMat);
    bulb.position.set(lx + nx * -1.8 * s, 6.2, lz + nz * -1.8 * s);
    bulb.userData.trk = true; scene.add(bulb);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2; pool.position.set(p1.x, 0.07, p1.z);
    pool.userData.trk = true; scene.add(pool);
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
      pos.push(p0.x + nx, 0.01, p0.z + nz,
               p0.x - nx, 0.01, p0.z - nz);
      verts += 2;
    }
    pos.push(p1.x + nx, 0.01, p1.z + nz,
             p1.x - nx, 0.01, p1.z - nz);
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

// ── Scene builder ─────────────────────────────────────────────────

export function buildDriveMap(mapData) {
  // Remove existing trk-tagged scene objects
  const rm = []; scene.traverse(o => { if (o.userData.trk) rm.push(o); }); rm.forEach(o => scene.remove(o));

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
  for (const road of (mapData.roads || [])) {
    const raw = _roadPath(road, nodeMap);
    if (!raw) continue;
    const pts = _samplePath(raw, 8);
    const geo = _buildRibbon(pts, road.width || 10);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: ROAD_COLORS_3D[road.type] || ROAD_COLORS_3D.street,
    }));
    mesh.receiveShadow = true; mesh.userData.trk = true; scene.add(mesh);

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

  // Assets — render all (including auto-generated scenery)
  (mapData.assets || []).forEach((asset, i) => {
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
      if (h > 14) {
        const wh = h * 0.55;
        const wm = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, wh, d + 0.1), _WIN_MAT);
        wm.position.y = h * 0.3 + wh / 2; g.add(wm);
      }
      if (h > 12 && t2 > 0.6) {
        const wy = 3 + Math.floor(t4 * (h - 4) / 4.5) * 4.5;
        const wn = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 0.1), _WARM_WIN_MAT);
        wn.position.set((t3 - 0.5) * w * 0.6, wy, d / 2 + 0.06); g.add(wn);
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
    if (mesh) { mesh.castShadow = true; mesh.userData.trk = true; scene.add(mesh); }
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
  const scale = (half - 10) / Math.max(rangeX / 2, rangeZ / 2);
  const ocx = (minX + maxX) / 2, ocz = (minZ + maxZ) / 2;
  const toM = (x, z) => [half + (x - ocx) * scale, half + (z - ocz) * scale];

  ctx.fillStyle = 'rgba(4,10,24,.85)'; ctx.fillRect(0, 0, S, S);

  for (const road of (mapData.roads || [])) {
    const raw = _roadPath(road, nodeMap);
    if (!raw) continue;
    const pts = _samplePath(raw, 4);
    ctx.strokeStyle = MINIMAP_ROAD_COLORS[road.type] || '#444';
    ctx.lineWidth = Math.max(2, (road.width || 10) * scale * 0.55);
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
