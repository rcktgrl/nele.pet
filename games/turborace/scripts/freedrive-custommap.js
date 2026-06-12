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
  }

  // Assets (skip auto-generated ones to keep performance reasonable)
  (mapData.assets || []).forEach((asset, i) => {
    if (asset.generated) return;
    let mesh = null;
    if (asset.type === 'tree') {
      const h = 6 + (i % 5) * 2;
      mesh = new THREE.Mesh(new THREE.ConeGeometry(2.5, h, 6),
        new THREE.MeshLambertMaterial({ color: 0x2d7a2d }));
      mesh.position.set(asset.x, h / 2, asset.z);
    } else if (asset.type === 'building') {
      const h = 8 + (i % 7) * 3;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8),
        new THREE.MeshLambertMaterial({ color: 0x55557a }));
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
