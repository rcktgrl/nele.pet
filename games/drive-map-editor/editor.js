'use strict';
import { supabase } from './supabase.js';

// ════════════════════════════════════════════════════════════════
//  DRIVE MAP EDITOR
// ════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'drive_maps_v1';
const HIT_NODE    = 14;
const HIT_ASSET   = 12;
const NODE_R      = 8;

const ROAD_TYPES = {
  highway: { col: '#28283a', dash: '#48485a', label: 'Highway', defW: 22 },
  street:  { col: '#201e2c', dash: '#302e3c', label: 'Street',  defW: 12 },
  country: { col: '#1e1c16', dash: '#2c2820', label: 'Country', defW: 10 },
  lane:    { col: '#181610', dash: '#22201a', label: 'Lane',    defW:  7 },
};

const ASSET_TYPES = {
  tree:     { col: '#55cc66', sel: '#88ee88', shape: 'circle', label: 'Tree'     },
  building: { col: '#c792ea', sel: '#ddaaff', shape: 'square', label: 'Building' },
  park:     { col: '#33bb44', sel: '#66dd66', shape: 'bigsq',  label: 'Park'     },
  stand:    { col: '#ff9944', sel: '#ffbb66', shape: 'wide',   label: 'Stand'    },
};

// ── State ──────────────────────────────────────────────────────
let maps = [];
let map  = null;
let nextNid = 0, nextRid = 0;

let tool        = 'select';
let selNode     = -1, selRoad = -1, selAsset = -1;
let connectFrom = -1;
let hoverNode   = -1, hoverRoad = -1, hoverAsset = -1;

// Camera
let camX = 0, camZ = 0, zoom = 1.4;
let panStart = null;   // { sx, sy, cx, cz }

// Drag
let drag    = null;    // { kind:'node'|'asset'|'brush', ... }
let wptDrag = null;    // { roadId, ptIdx } — bezier handle drag

// Brush settings
let brushType = 'tree', brushCount = 1, brushSpacing = 20;

// City spawner settings
let citySize = 3, cityBlockSize = 80, cityRoadType = 'street';

// Road scenery settings
let sceneryDensity = 3, sceneryOffset = 8, sceneryMix = 'mixed';

// Curvy road settings
let curvyEnabled = false, curvyAmount = 3;

// Snap
let snapSize = 0;

// Pointer position in world coords
let mouseWX = 0, mouseWZ = 0, mouseSX = 0, mouseSY = 0;

const canvas = document.getElementById('editorCanvas');
const ctx    = canvas.getContext('2d');

// ── Coordinate transforms ──────────────────────────────────────
function w2s(wx, wz) {
  return [canvas.width  / 2 + (wx - camX) * zoom,
          canvas.height / 2 + (wz - camZ) * zoom];
}
function s2w(sx, sy) {
  return [(sx - canvas.width  / 2) / zoom + camX,
          (sy - canvas.height / 2) / zoom + camZ];
}
function snp(v) { return snapSize > 0 ? Math.round(v / snapSize) * snapSize : v; }

// ── Data helpers ───────────────────────────────────────────────
function getNode(id)  { return map?.nodes.find(n => n.id === id) ?? null; }
function getRoad(id)  { return map?.roads.find(r => r.id === id) ?? null; }

function roadPts(road) {
  const a = getNode(road.nodeA), b = getNode(road.nodeB);
  if (!a || !b) return null;
  return [{ x: a.x, z: a.z }, ...road.waypoints, { x: b.x, z: b.z }];
}

function roadConnections(nodeId) {
  return map ? map.roads.filter(r => r.nodeA === nodeId || r.nodeB === nodeId).length : 0;
}

// ── Render loop ────────────────────────────────────────────────
function rafLoop() { draw(); requestAnimationFrame(rafLoop); }

function draw() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = map?.groundColor || '#1a2a18';
  ctx.fillRect(0, 0, W, H);
  drawGrid();
  if (!map) return;
  drawRoads();
  drawAssets();
  drawNodes();
  drawOverlay();
}

function drawGrid() {
  const [wx0, wz0] = s2w(0, 0);
  const [wx1, wz1] = s2w(canvas.width, canvas.height);
  const step = Math.pow(10, Math.ceil(Math.log10(60 / zoom)));
  ctx.strokeStyle = 'rgba(255,255,255,.03)';
  ctx.lineWidth = 1;
  for (let wx = Math.floor(wx0 / step) * step; wx <= wx1; wx += step) {
    const [sx] = w2s(wx, 0);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke();
  }
  for (let wz = Math.floor(wz0 / step) * step; wz <= wz1; wz += step) {
    const [, sy] = w2s(0, wz);
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
  }
  const [ox, oy] = w2s(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ox - 12, oy); ctx.lineTo(ox + 12, oy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, oy - 12); ctx.lineTo(ox, oy + 12); ctx.stroke();
}

function drawRoadPath(pts) {
  ctx.beginPath();
  if (!pts || pts.length < 2) return;
  const [x0, y0] = w2s(pts[0].x, pts[0].z);
  ctx.moveTo(x0, y0);
  if (pts.length === 2) {
    const [x1, y1] = w2s(pts[1].x, pts[1].z);
    ctx.lineTo(x1, y1);
  } else if (pts.length === 3) {
    const [cx, cy] = w2s(pts[1].x, pts[1].z);
    const [x2, y2] = w2s(pts[2].x, pts[2].z);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
  } else {
    for (let i = 1; i < pts.length; i++) {
      const [xi, yi] = w2s(pts[i].x, pts[i].z);
      ctx.lineTo(xi, yi);
    }
  }
}

function drawRoads() {
  for (const road of map.roads) {
    const pts = roadPts(road);
    if (!pts) continue;
    const rStyle = ROAD_TYPES[road.type] ?? ROAD_TYPES.street;
    const rw     = Math.max(2, road.width * zoom);
    const isSel  = road.id === selRoad;
    const isHov  = road.id === hoverRoad && !isSel;

    if (isSel || isHov) {
      ctx.save();
      ctx.strokeStyle = isSel ? 'rgba(255,85,0,.5)' : 'rgba(255,215,0,.35)';
      ctx.lineWidth   = rw + 10;
      ctx.lineCap = ctx.lineJoin = 'round';
      drawRoadPath(pts); ctx.stroke();
      ctx.restore();
    }

    ctx.strokeStyle = rStyle.col;
    ctx.lineWidth   = rw;
    ctx.lineCap = ctx.lineJoin = 'round';
    drawRoadPath(pts); ctx.stroke();

    if (rw > 12) {
      ctx.strokeStyle = rStyle.dash;
      ctx.lineWidth   = Math.max(1, rw * 0.07);
      ctx.setLineDash([rw * 0.55, rw * 0.45]);
      drawRoadPath(pts); ctx.stroke();
      ctx.setLineDash([]);
    }

    if (isSel) drawWaypointHandles(road, pts);
  }
}

function drawWaypointHandles(road, pts) {
  for (let i = 1; i < pts.length - 1; i++) {
    const [sx, sy] = w2s(pts[i].x, pts[i].z);
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd700'; ctx.fill();
    ctx.strokeStyle = '#050a14'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (road.waypoints.length === 0 && pts.length === 2) {
    const mx = (pts[0].x + pts[1].x) / 2, mz = (pts[0].z + pts[1].z) / 2;
    const [sx, sy] = w2s(mx, mz);
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,215,0,.45)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,.8)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
}

function drawNodes() {
  for (const node of map.nodes) {
    const conns   = roadConnections(node.id);
    const isSel   = node.id === selNode;
    const isHov   = node.id === hoverNode;
    const isConn  = node.id === connectFrom;
    const [sx, sy] = w2s(node.x, node.z);
    const r = NODE_R + (conns > 2 ? 2 : 0);

    if (isSel || isHov || isConn) {
      ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = isConn ? 'rgba(255,85,0,.3)' : isSel ? 'rgba(255,215,0,.28)' : 'rgba(100,200,255,.2)';
      ctx.fill();
    }

    // Cure tool: highlight orphans with a pulsing ring
    if (tool === 'cure' && conns === 0) {
      ctx.beginPath(); ctx.arc(sx, sy, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,80,80,.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = isConn ? '#ff5500' :
                    isSel   ? '#ffd700' :
                    isHov   ? '#9de'    :
                    conns === 0 ? '#f55' :
                    conns === 1 ? '#4af' :
                                 '#7df';
    ctx.fill();
    ctx.strokeStyle = '#050a14'; ctx.lineWidth = 2; ctx.stroke();

    if (conns >= 3 && zoom > 1.1) {
      ctx.fillStyle = '#050a14';
      ctx.font = 'bold 8px Orbitron,monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(conns, sx, sy);
    }
  }
}

function drawAssets() {
  for (let i = 0; i < map.assets.length; i++) {
    const a     = map.assets[i];
    const style = ASSET_TYPES[a.type] ?? ASSET_TYPES.tree;
    const isSel = i === selAsset;
    const isHov = i === hoverAsset;
    const [sx, sy] = w2s(a.x, a.z);
    ctx.fillStyle   = (isSel || isHov) ? style.sel : style.col;
    ctx.strokeStyle = '#050a14';
    ctx.lineWidth   = 1.5;
    switch (style.shape) {
      case 'circle':
        ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke(); break;
      case 'square':
        ctx.fillRect(sx-6,  sy-6,  12, 12); ctx.strokeRect(sx-6,  sy-6,  12, 12); break;
      case 'bigsq':
        ctx.fillRect(sx-9,  sy-9,  18, 18); ctx.strokeRect(sx-9,  sy-9,  18, 18); break;
      case 'wide':
        ctx.fillRect(sx-12, sy-5,  24, 10); ctx.strokeRect(sx-12, sy-5,  24, 10); break;
    }
  }
}

function drawOverlay() {
  // City grid preview
  if (tool === 'city' && map) drawCityPreview(snp(mouseWX), snp(mouseWZ));

  // Dashed preview line when drawing a road
  if (tool === 'road' && connectFrom >= 0) {
    const from = getNode(connectFrom);
    if (from) {
      const [fx, fy] = w2s(from.x, from.z);
      const tx = snp(mouseWX), tz = snp(mouseWZ);
      const [mx, my] = hoverNode >= 0 ? w2s(getNode(hoverNode).x, getNode(hoverNode).z) : w2s(tx, tz);
      ctx.beginPath();
      ctx.strokeStyle = '#ff550099';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.moveTo(fx, fy); ctx.lineTo(mx, my);
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // Snap cursor indicator
  if (snapSize > 0 && (tool === 'node' || (tool === 'road' && connectFrom < 0) || tool === 'city')) {
    const [sx, sy] = w2s(snp(mouseWX), snp(mouseWZ));
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,100,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

function drawCityPreview(wx, wz) {
  const blocks = citySize;
  const bs     = cityBlockSize;
  const half   = blocks / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(100,200,255,.3)';
  ctx.lineWidth   = Math.max(1.5, bs * zoom * 0.05);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.setLineDash([6, 6]);
  for (let r = 0; r <= blocks; r++) {
    const [x0, y0] = w2s(wx - half * bs,             wz + (r - half) * bs);
    const [x1, y1] = w2s(wx + (blocks - half) * bs,  wz + (r - half) * bs);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  for (let c = 0; c <= blocks; c++) {
    const [x0, y0] = w2s(wx + (c - half) * bs, wz - half * bs);
    const [x1, y1] = w2s(wx + (c - half) * bs, wz + (blocks - half) * bs);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.setLineDash([]);
  const [cx, cy] = w2s(wx, wz);
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(100,200,255,.5)'; ctx.fill();
  ctx.restore();
}

// ── Hit testing ────────────────────────────────────────────────
function hitNode(sx, sy) {
  if (!map) return -1;
  for (const n of map.nodes) {
    const [nx, ny] = w2s(n.x, n.z);
    if (Math.hypot(sx - nx, sy - ny) < HIT_NODE) return n.id;
  }
  return -1;
}
function hitAsset(sx, sy) {
  if (!map) return -1;
  for (let i = map.assets.length - 1; i >= 0; i--) {
    const [ax, ay] = w2s(map.assets[i].x, map.assets[i].z);
    if (Math.hypot(sx - ax, sy - ay) < HIT_ASSET) return i;
  }
  return -1;
}
function hitRoad(sx, sy) {
  if (!map) return -1;
  for (const road of map.roads) {
    const pts = roadPts(road);
    if (!pts) continue;
    const hw = Math.max(10, road.width * zoom / 2);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = w2s(pts[i].x, pts[i].z);
      const [bx, by] = w2s(pts[i + 1].x, pts[i + 1].z);
      if (ptSegDist(sx, sy, ax, ay, bx, by) < hw) return road.id;
    }
  }
  return -1;
}
function hitWaypointHandle(sx, sy) {
  if (!map || selRoad < 0) return null;
  const road = getRoad(selRoad);
  if (!road) return null;
  const pts = roadPts(road);
  if (!pts || pts.length < 2) return null;
  for (let i = 1; i < pts.length - 1; i++) {
    const [hx, hy] = w2s(pts[i].x, pts[i].z);
    if (Math.hypot(sx - hx, sy - hy) < 12) return { roadId: road.id, ptIdx: i - 1 };
  }
  if (road.waypoints.length === 0 && pts.length === 2) {
    const mx = (pts[0].x + pts[1].x) / 2, mz = (pts[0].z + pts[1].z) / 2;
    const [hx, hy] = w2s(mx, mz);
    if (Math.hypot(sx - hx, sy - hy) < 12) return { roadId: road.id, ptIdx: -1 };
  }
  return null;
}
function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (!lenSq) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ── Pointer events ─────────────────────────────────────────────
function canvasXY(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (canvas.width / r.width),
          (e.clientY - r.top)  * (canvas.height / r.height)];
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 1 || e.button === 2) {
    panStart = { sx: e.clientX, sy: e.clientY, cx: camX, cz: camZ };
    return;
  }

  const [sx, sy] = canvasXY(e);
  const [wx, wz] = s2w(sx, sy);
  if (!map) return;

  if (tool === 'select') {
    const wph = hitWaypointHandle(sx, sy);
    if (wph) { wptDrag = wph; return; }

    const nHit = hitNode(sx, sy);
    if (nHit >= 0) {
      selNode = nHit; selRoad = -1; selAsset = -1;
      drag = { kind: 'node', id: nHit };
      syncSelectedUI(); return;
    }
    const aHit = hitAsset(sx, sy);
    if (aHit >= 0) {
      selAsset = aHit; selNode = -1; selRoad = -1;
      drag = { kind: 'asset', idx: aHit };
      syncSelectedUI(); return;
    }
    const rHit = hitRoad(sx, sy);
    if (rHit >= 0) {
      selRoad = rHit; selNode = -1; selAsset = -1;
      syncSelectedUI(); return;
    }
    selNode = -1; selRoad = -1; selAsset = -1;
    syncSelectedUI();
    panStart = { sx: e.clientX, sy: e.clientY, cx: camX, cz: camZ };

  } else if (tool === 'node') {
    addNode(snp(wx), snp(wz));

  } else if (tool === 'road') {
    const nHit = hitNode(sx, sy);
    if (connectFrom < 0) {
      if (nHit >= 0) connectFrom = nHit;
    } else {
      if (nHit >= 0 && nHit !== connectFrom) {
        finishRoad(connectFrom, nHit);
        connectFrom = -1;
      } else if (nHit < 0) {
        const newId = nextNid;
        addNode(snp(wx), snp(wz));
        finishRoad(connectFrom, newId);
        connectFrom = -1;
      } else {
        connectFrom = -1;
      }
    }

  } else if (tool === 'erase') {
    const nHit = hitNode(sx, sy);
    if (nHit >= 0) { deleteNode(nHit); syncSelectedUI(); return; }
    const rHit = hitRoad(sx, sy);
    if (rHit >= 0) { deleteRoad(rHit); syncSelectedUI(); return; }
    const aHit = hitAsset(sx, sy);
    if (aHit >= 0) { deleteAsset(aHit); syncSelectedUI(); return; }

  } else if (tool === 'brush') {
    paintAssets(wx, wz);
    drag = { kind: 'brush' };

  } else if (tool === 'cure') {
    cureElement(sx, sy);

  } else if (tool === 'city') {
    spawnCity(snp(wx), snp(wz));
  }
});

canvas.addEventListener('pointermove', e => {
  const [sx, sy] = canvasXY(e);
  const [wx, wz] = s2w(sx, sy);
  mouseWX = wx; mouseWZ = wz; mouseSX = sx; mouseSY = sy;

  if (panStart) {
    const f = 1 / zoom;
    camX = panStart.cx - (e.clientX - panStart.sx) * f;
    camZ = panStart.cz - (e.clientY - panStart.sy) * f;
    return;
  }
  if (!map) return;

  if (wptDrag) {
    const road = getRoad(wptDrag.roadId);
    if (road) {
      const pt = { x: snp(wx), z: snp(wz) };
      if (wptDrag.ptIdx < 0) road.waypoints = [pt];
      else                   road.waypoints[wptDrag.ptIdx] = pt;
    }
    return;
  }

  if (drag) {
    if (drag.kind === 'node') {
      const n = getNode(drag.id);
      if (n) { n.x = snp(wx); n.z = snp(wz); syncSelectedUI(); }
    } else if (drag.kind === 'asset') {
      map.assets[drag.idx].x = wx;
      map.assets[drag.idx].z = wz;
      syncSelectedUI();
    } else if (drag.kind === 'brush') {
      paintAssets(wx, wz);
    }
    return;
  }

  // Hover updates
  if (tool !== 'brush' && tool !== 'city') {
    hoverNode  = hitNode(sx, sy);
    hoverAsset = hoverNode < 0 ? hitAsset(sx, sy) : -1;
    hoverRoad  = hoverNode < 0 && hoverAsset < 0 ? hitRoad(sx, sy) : -1;
  } else {
    hoverNode = hoverAsset = hoverRoad = -1;
  }
});

canvas.addEventListener('pointerup', e => {
  if (panStart && (e.button === 1 || e.button === 2)) { panStart = null; return; }
  drag = null; wptDrag = null;
  if (e.button === 0 && panStart) panStart = null;
});

canvas.addEventListener('pointerleave', () => {
  panStart = null; drag = null; wptDrag = null;
  hoverNode = hoverAsset = hoverRoad = -1;
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const [sx, sy] = canvasXY(e);
  const [wx, wz] = s2w(sx, sy);
  zoom = Math.max(0.1, Math.min(10, zoom * (1 - Math.sign(e.deltaY) * 0.1)));
  camX = wx - (sx - canvas.width  / 2) / zoom;
  camZ = wz - (sy - canvas.height / 2) / zoom;
}, { passive: false });

// ── Map CRUD ───────────────────────────────────────────────────
function uid() { return 'map-' + Date.now() + '-' + (Math.random() * 0xffff | 0); }

function createMap() {
  nextNid = 0; nextRid = 0;
  map = {
    id: uid(), name: 'New Map', desc: '',
    timeOfDay: 'day', skyColor: '#0d1a2e', groundColor: '#1a3018',
    fogDist: 1200, scenerySeed: Math.random() * 0x100000000 | 0,
    nodes: [
      { id: nextNid++, x: 0,    z: 0    },
      { id: nextNid++, x: 200,  z: 0    },
      { id: nextNid++, x: 0,    z: 200  },
      { id: nextNid++, x: -200, z: 0    },
      { id: nextNid++, x: 0,    z: -200 },
    ],
    roads: [
      { id: nextRid++, nodeA: 0, nodeB: 1, width: 12, type: 'street', waypoints: [] },
      { id: nextRid++, nodeA: 0, nodeB: 2, width: 12, type: 'street', waypoints: [] },
      { id: nextRid++, nodeA: 0, nodeB: 3, width: 12, type: 'street', waypoints: [] },
      { id: nextRid++, nodeA: 0, nodeB: 4, width: 12, type: 'street', waypoints: [] },
    ],
    assets: [],
  };
  selNode = selRoad = selAsset = -1; connectFrom = -1;
}

function recalcIds() {
  if (!map) return;
  nextNid = map.nodes.reduce((a, n) => Math.max(a, n.id), -1) + 1;
  nextRid = map.roads.reduce((a, r) => Math.max(a, r.id), -1) + 1;
}

function loadMapsFromStorage() {
  try { maps = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { maps = []; }
}
function saveMapsToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
}

function saveCurrentMap() {
  if (!map) return;
  const clone = JSON.parse(JSON.stringify(map));
  const idx = maps.findIndex(m => m.id === map.id);
  if (idx >= 0) maps[idx] = clone; else maps.push(clone);
  saveMapsToStorage();
  renderMapList();
  notify('MAP SAVED');
}

function deleteCurrentMap() {
  if (!map) return;
  maps = maps.filter(m => m.id !== map.id);
  saveMapsToStorage();
  if (maps.length > 0) {
    map = JSON.parse(JSON.stringify(maps[0]));
    recalcIds();
  } else {
    createMap();
  }
  selNode = selRoad = selAsset = -1; connectFrom = -1;
  resetView(); populateUI(); renderMapList();
  notify('MAP DELETED');
}

function duplicateCurrentMap() {
  if (!map) return;
  const clone = JSON.parse(JSON.stringify(map));
  clone.id   = uid();
  clone.name = map.name + ' (copy)';
  maps.push(clone);
  saveMapsToStorage();
  map = clone; recalcIds();
  selNode = selRoad = selAsset = -1; connectFrom = -1;
  renderMapList(); populateUI();
  notify('MAP DUPLICATED');
}

// ── Cloud sync ─────────────────────────────────────────────────
const CLOUD_TABLE = 'drive_custom_maps';
let _cloudOk = true;

async function publishMapToCloud() {
  if (!map) { notify('NO MAP TO PUBLISH'); return; }
  const btn = document.getElementById('btnPublish');
  if (btn) { btn.disabled = true; btn.textContent = 'PUBLISHING…'; }
  try {
    const payload = { ...JSON.parse(JSON.stringify(map)), updatedAt: new Date().toISOString() };
    const { error } = await supabase.from(CLOUD_TABLE).upsert(
      { map_id: map.id, map_data: payload },
      { onConflict: 'map_id' }
    );
    if (error) throw error;
    notify('MAP PUBLISHED ONLINE');
    if (btn) {
      btn.textContent = '✓ PUBLISHED';
      setTimeout(() => { btn.disabled = false; btn.textContent = 'PUBLISH'; }, 2000);
    }
  } catch (err) {
    notify('PUBLISH FAILED: ' + (err.message || 'network error'));
    if (btn) { btn.disabled = false; btn.textContent = 'PUBLISH'; }
  }
}

async function loadMapsFromCloud() {
  if (!_cloudOk) { notify('CLOUD SYNC UNAVAILABLE'); return; }
  const btn = document.getElementById('btnLoadOnline');
  if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
  try {
    const { data, error } = await supabase.from(CLOUD_TABLE)
      .select('map_id,map_data,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) { _cloudOk = false; throw error; }
    const incoming = (data || [])
      .map(r => r.map_data)
      .filter(m => m && m.id && Array.isArray(m.nodes) && Array.isArray(m.roads));
    for (const online of incoming) {
      const idx = maps.findIndex(m => m.id === online.id);
      if (idx >= 0) {
        if ((online.updatedAt || '') >= (maps[idx].updatedAt || '')) maps[idx] = online;
      } else {
        maps.push(online);
      }
    }
    saveMapsToStorage();
    renderMapList();
    notify('LOADED ' + incoming.length + ' ONLINE MAP' + (incoming.length !== 1 ? 'S' : ''));
    if (btn) { btn.disabled = false; btn.textContent = 'LOAD ONLINE'; }
  } catch (err) {
    notify('LOAD FAILED: ' + (err.message || 'network error'));
    if (btn) { btn.disabled = false; btn.textContent = 'LOAD ONLINE'; }
  }
}

function exportJSON() {
  if (!map) return;
  const json = JSON.stringify(map, null, 2);
  const url  = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a    = document.createElement('a');
  a.href = url;
  a.download = (map.name || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Editing operations ─────────────────────────────────────────
function addNode(wx, wz) {
  const node = { id: nextNid++, x: wx, z: wz };
  map.nodes.push(node);
  selNode = node.id; selRoad = selAsset = -1;
  syncSelectedUI();
}

function deleteNode(id) {
  map.nodes = map.nodes.filter(n => n.id !== id);
  map.roads = map.roads.filter(r => r.nodeA !== id && r.nodeB !== id);
  if (selNode  === id) selNode  = -1;
}

function finishRoad(aId, bId) {
  if (aId === bId) return;
  const dup = map.roads.some(r =>
    (r.nodeA === aId && r.nodeB === bId) || (r.nodeA === bId && r.nodeB === aId));
  if (dup) { notify('ROAD ALREADY EXISTS'); return; }
  const typeEl  = document.getElementById('newRoadType');
  const widthEl = document.getElementById('newRoadWidth');
  const road = {
    id: nextRid++,
    nodeA: aId, nodeB: bId,
    width: +widthEl?.value || 12,
    type:   typeEl?.value  || 'street',
    waypoints: [],
  };
  if (curvyEnabled) {
    const a = getNode(aId), b = getNode(bId);
    if (a && b) {
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len > 1) {
        const maxOff = len * 0.08 * curvyAmount;
        const side = Math.random() < 0.5 ? 1 : -1;
        const offDist = maxOff * (0.4 + Math.random() * 0.6) * side;
        road.waypoints = [{ x: mx + (-dz / len) * offDist, z: mz + (dx / len) * offDist }];
      }
    }
  }
  map.roads.push(road);
  selRoad = road.id; selNode = selAsset = -1;
  syncSelectedUI();
}

function deleteRoad(id) {
  map.roads = map.roads.filter(r => r.id !== id);
  if (selRoad === id) selRoad = -1;
}

function deleteAsset(idx) {
  map.assets.splice(idx, 1);
  if      (selAsset === idx) selAsset = -1;
  else if (selAsset  >  idx) selAsset--;
}

function paintAssets(wx, wz) {
  const count   = Math.max(1, brushCount);
  const spacing = Math.max(8, brushSpacing);
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2;
    const off = i === 0 ? 0 : (Math.floor(i / 8) + 1) * spacing;
    const px  = wx + Math.cos(ang) * off;
    const pz  = wz + Math.sin(ang) * off;
    if (map.assets.some(a => Math.hypot(a.x - px, a.z - pz) < spacing * 0.7)) continue;
    map.assets.push({ type: brushType, x: px, z: pz });
  }
}

// ── Cure tool ──────────────────────────────────────────────────
function cureElement(sx, sy) {
  const nHit = hitNode(sx, sy);
  if (nHit >= 0) {
    const conns = roadConnections(nHit);
    if (conns === 0) {
      deleteNode(nHit);
      notify('ORPHAN REMOVED');
    } else {
      notify('NODE HAS ' + conns + ' CONNECTION(S)');
    }
    return;
  }
  const rHit = hitRoad(sx, sy);
  if (rHit >= 0) {
    cureRoad(rHit);
  }
}

function cureRoad(roadId) {
  const road = getRoad(roadId);
  if (!road) return;
  const a = getNode(road.nodeA), b = getNode(road.nodeB);
  if (!a || !b) return;
  if (road.waypoints.length > 0) {
    road.waypoints = [];
    notify('ROAD STRAIGHTENED');
    return;
  }
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  // Alternate curve side based on road id for variety
  const side   = ((road.id % 2) === 0) ? 1 : -1;
  const offset = len * 0.18 * side;
  road.waypoints = [{ x: mx + (-dz / len) * offset, z: mz + (dx / len) * offset }];
  notify('ROAD CURVED');
}

function cureAllOrphans() {
  if (!map) return;
  const orphans = map.nodes.filter(n => roadConnections(n.id) === 0);
  if (orphans.length === 0) { notify('NO ORPHANS FOUND'); return; }
  orphans.forEach(n => deleteNode(n.id));
  if (selNode >= 0 && !getNode(selNode)) { selNode = -1; syncSelectedUI(); }
  notify('REMOVED ' + orphans.length + ' ORPHAN(S)');
}

function straightenAllRoads() {
  if (!map) return;
  let count = 0;
  map.roads.forEach(r => { if (r.waypoints.length > 0) { r.waypoints = []; count++; } });
  notify(count > 0 ? 'STRAIGHTENED ' + count + ' ROAD(S)' : 'ROADS ALREADY STRAIGHT');
}

// ── City spawner ───────────────────────────────────────────────
function spawnCity(wx, wz) {
  if (!map) return;
  const blocks = citySize;
  const bs     = cityBlockSize;
  const half   = blocks / 2;
  const rw     = ROAD_TYPES[cityRoadType]?.defW || 12;

  // Build node grid
  const grid = [];
  for (let r = 0; r <= blocks; r++) {
    grid[r] = [];
    for (let c = 0; c <= blocks; c++) {
      const node = { id: nextNid++, x: wx + (c - half) * bs, z: wz + (r - half) * bs };
      map.nodes.push(node);
      grid[r][c] = node.id;
    }
  }

  // Horizontal roads
  for (let r = 0; r <= blocks; r++) {
    for (let c = 0; c < blocks; c++) {
      map.roads.push({ id: nextRid++, nodeA: grid[r][c], nodeB: grid[r][c + 1],
        width: rw, type: cityRoadType, waypoints: [] });
    }
  }
  // Vertical roads
  for (let r = 0; r < blocks; r++) {
    for (let c = 0; c <= blocks; c++) {
      map.roads.push({ id: nextRid++, nodeA: grid[r][c], nodeB: grid[r + 1][c],
        width: rw, type: cityRoadType, waypoints: [] });
    }
  }

  // Auto-place buildings and parks in each block
  let seed = ((wx * 1234 + wz * 5678) | 0) || 1;
  function rng() {
    seed = (Math.imul(seed + 1, 1664525) + 1013904223) | 0;
    return ((seed >>> 0) & 0xffff) / 0xffff;
  }
  const inset = rw / 2 + 5;
  const usable = bs - inset * 2;
  let assetCount = 0;
  for (let r = 0; r < blocks; r++) {
    for (let c = 0; c < blocks; c++) {
      const bx = wx + (c - half + 0.5) * bs;
      const bz = wz + (r - half + 0.5) * bs;
      if (rng() < 0.22 && usable > 12) {
        map.assets.push({ type: 'park', x: bx, z: bz, generated: true });
        assetCount++;
        for (let ti = 0; ti < 3; ti++) {
          const ang = (ti / 3) * Math.PI * 2 + rng() * 0.5;
          const rad = Math.max(4, usable * 0.22);
          map.assets.push({ type: 'tree', x: bx + Math.cos(ang) * rad, z: bz + Math.sin(ang) * rad, generated: true });
          assetCount++;
        }
      } else if (usable > 10) {
        const num = 2 + Math.floor(rng() * 3);
        for (let b = 0; b < num; b++) {
          const bldX = bx + (rng() - 0.5) * usable;
          const bldZ = bz + (rng() - 0.5) * usable;
          map.assets.push({ type: 'building', x: bldX, z: bldZ, generated: true, tall: true, city: true });
          assetCount++;
        }
      }
    }
  }

  notify('CITY SPAWNED ' + blocks + '\xd7' + blocks + ' + ' + assetCount + ' ASSETS');
}

// ── Road scenery generation ────────────────────────────────────
function bezierSample(pts, t) {
  if (pts.length === 2) {
    return { x: pts[0].x + (pts[1].x - pts[0].x) * t,
             z: pts[0].z + (pts[1].z - pts[0].z) * t };
  }
  if (pts.length === 3) {
    const u = 1 - t;
    return { x: u*u*pts[0].x + 2*u*t*pts[1].x + t*t*pts[2].x,
             z: u*u*pts[0].z + 2*u*t*pts[1].z + t*t*pts[2].z };
  }
  // Polyline fallback
  let total = 0;
  for (let i = 1; i < pts.length; i++)
    total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].z - pts[i-1].z);
  const target = t * total;
  let accum = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i-1].x, pts[i].z - pts[i-1].z);
    if (accum + seg >= target || i === pts.length - 1) {
      const st = seg > 0 ? Math.min(1, (target - accum) / seg) : 0;
      return { x: pts[i-1].x + (pts[i].x - pts[i-1].x) * st,
               z: pts[i-1].z + (pts[i].z - pts[i-1].z) * st };
    }
    accum += seg;
  }
  return pts[pts.length - 1];
}

function bezierTangent(pts, t) {
  const eps = 0.001;
  const a = bezierSample(pts, Math.max(0, t - eps));
  const b = bezierSample(pts, Math.min(1, t + eps));
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

function roadApproxLength(road) {
  const pts = roadPts(road);
  if (!pts || pts.length < 2) return 0;
  if (pts.length === 2) return Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
  let len = 0;
  const steps = 20;
  for (let i = 0; i < steps; i++) {
    const a = bezierSample(pts, i / steps);
    const b = bezierSample(pts, (i + 1) / steps);
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

function getSceneryPalette(mix) {
  switch (mix) {
    case 'trees':  return ['tree', 'tree', 'tree', 'tree'];
    case 'dense':  return ['tree', 'tree', 'building', 'park', 'stand', 'tree'];
    default:       return ['tree', 'tree', 'tree', 'building', 'tree'];
  }
}

function assetOnAnyRoad(ax, az) {
  for (const road of map.roads) {
    const pts = roadPts(road);
    if (!pts) continue;
    const hw = (road.width || 10) / 2 + 2;
    const steps = 20;
    for (let si = 0; si < steps; si++) {
      const p0 = bezierSample(pts, si / steps);
      const p1 = bezierSample(pts, (si + 1) / steps);
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx/len, uz = dz/len;
      const tx = ax - p0.x, tz = az - p0.z;
      const proj = tx*ux + tz*uz;
      if (proj >= 0 && proj <= len) {
        const perp = Math.abs(tx*uz - tz*ux);
        if (perp < hw) return true;
      }
    }
  }
  return false;
}

function generateRoadScenery() {
  if (!map) return;
  const spacing  = Math.max(10, 100 / sceneryDensity);
  let   count    = 0;
  let   seed     = 0;
  const mixPalette = getSceneryPalette(sceneryMix);

  for (const road of map.roads) {
    const rType = road.type || 'street';
    // Highways get 3D walls — no roadside asset scatter
    if (rType === 'highway') continue;

    const pts    = roadPts(road);
    if (!pts)    continue;
    const len    = roadApproxLength(road);
    if (len < 1) continue;

    // Country / lane roads: trees only, slightly wider offset
    const isCountry = rType === 'country' || rType === 'lane';
    const palette   = isCountry ? ['tree', 'tree', 'tree', 'tree'] : mixPalette;
    const sideOff   = road.width / 2 + sceneryOffset + (isCountry ? 4 : 0);
    const steps     = Math.max(2, Math.ceil(len / spacing));

    for (let i = 0; i <= steps; i++) {
      const t   = i / steps;
      const pos = bezierSample(pts, t);
      const tan = bezierTangent(pts, t);
      const px  = -tan.z, pz = tan.x;

      for (const side of [-1, 1]) {
        const ax = pos.x + px * sideOff * side;
        const az = pos.z + pz * sideOff * side;
        if (map.assets.some(a => Math.hypot(a.x - ax, a.z - az) < spacing * 0.6)) continue;
        if (assetOnAnyRoad(ax, az)) continue;
        const type = palette[(seed++) % palette.length];
        map.assets.push({ type, x: ax, z: az, generated: true });
        count++;
      }
    }
  }
  notify(count > 0 ? 'SCENERY: ' + count + ' ASSETS PLACED' : 'NO ROADS TO DECORATE');
}

function populateMapWithScenery() {
  if (!map) return;
  clearRoadScenery();
  generateRoadScenery();
}

function clearRoadScenery() {
  if (!map) return;
  const before = map.assets.length;
  map.assets = map.assets.filter(a => !a.generated);
  const removed = before - map.assets.length;
  if (selAsset >= map.assets.length) { selAsset = -1; syncSelectedUI(); }
  notify(removed > 0 ? 'CLEARED ' + removed + ' SCENERY ASSET(S)' : 'NO GENERATED SCENERY');
}

// ── UI helpers ─────────────────────────────────────────────────
let _notifTimer = 0;
function notify(msg) {
  const el = document.getElementById('notif');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

function populateUI() {
  if (!map) return;
  document.getElementById('mapName').value      = map.name      || '';
  document.getElementById('mapDesc').value      = map.desc      || '';
  document.getElementById('mapTimeOfDay').value = map.timeOfDay || 'day';
  document.getElementById('mapGroundColor').value = map.groundColor || '#1a3018';
  document.getElementById('mapSkyColor').value    = map.skyColor    || '#0d1a2e';
  const fd = map.fogDist ?? 1200;
  document.getElementById('mapFogDist').value    = fd;
  document.getElementById('mapFogDistVal').textContent = fd;
  syncSelectedUI();
}

function syncSelectedUI() {
  if (!map) return;
  const node  = selNode  >= 0 ? getNode(selNode)     : null;
  const road  = selRoad  >= 0 ? getRoad(selRoad)     : null;
  const asset = selAsset >= 0 ? map.assets[selAsset] : null;

  document.getElementById('selNodePanel').style.display  = node  ? '' : 'none';
  document.getElementById('selRoadPanel').style.display  = road  ? '' : 'none';
  document.getElementById('selAssetPanel').style.display = asset ? '' : 'none';

  if (node) {
    document.getElementById('selNodeX').value = Math.round(node.x);
    document.getElementById('selNodeZ').value = Math.round(node.z);
    const c = roadConnections(node.id);
    document.getElementById('selNodeInfo').textContent =
      `Node #${node.id} · ` +
      (c === 0 ? 'Orphan (no roads)' : c === 1 ? 'Dead end' : c === 2 ? 'Through road' : `${c}-way intersection`);
  }
  if (road) {
    document.getElementById('selRoadType').value  = road.type;
    document.getElementById('selRoadWidth').value = road.width;
    document.getElementById('selRoadWidthVal').textContent = road.width;
    document.getElementById('selRoadInfo').textContent =
      `Road #${road.id} · Node ${road.nodeA} → Node ${road.nodeB} · ${road.waypoints.length} curve pt(s)`;
  }
  if (asset) {
    document.getElementById('selAssetType').value = asset.type;
    document.getElementById('selAssetInfo').textContent =
      `${ASSET_TYPES[asset.type]?.label || asset.type} · (${Math.round(asset.x)}, ${Math.round(asset.z)})`;
  }
}

function renderMapList() {
  const wrap = document.getElementById('mapList');
  if (!wrap) return;
  wrap.innerHTML = '';
  maps.forEach(m => {
    const d = document.createElement('div');
    d.className = 'editorListItem' + (m.id === map?.id ? ' sel' : '');
    d.textContent = m.name || 'Unnamed Map';
    d.onclick = () => {
      map = JSON.parse(JSON.stringify(m));
      recalcIds();
      selNode = selRoad = selAsset = -1; connectFrom = -1;
      resetView(); populateUI(); renderMapList();
    };
    wrap.appendChild(d);
  });
}

function resetView() { camX = 0; camZ = 0; zoom = 1.4; }

function setTool(t) {
  tool = t; connectFrom = -1;
  document.querySelectorAll('.toolBtn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.style.cursor =
    t === 'node'  ? 'cell'        :
    t === 'road'  ? 'crosshair'   :
    t === 'erase' ? 'not-allowed' :
    t === 'brush' ? 'copy'        :
    t === 'cure'  ? 'help'        :
    t === 'city'  ? 'crosshair'   : 'default';
}

function syncBrushUI() {
  document.querySelectorAll('.assetChip').forEach(el =>
    el.classList.toggle('active', el.dataset.asset === brushType));
  const sel = document.getElementById('brushAsset');
  if (sel) sel.value = brushType;
}

// ── Bind all UI events ─────────────────────────────────────────
function bindUI() {
  // Tool buttons
  document.querySelectorAll('.toolBtn').forEach(b =>
    b.addEventListener('click', () => setTool(b.dataset.tool)));

  // Map meta
  ['mapName','mapDesc','mapTimeOfDay','mapGroundColor','mapSkyColor'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = { mapName:'name', mapDesc:'desc', mapTimeOfDay:'timeOfDay',
                  mapGroundColor:'groundColor', mapSkyColor:'skyColor' }[id];
    el.addEventListener('input',  () => { if (map) map[key] = el.value; });
    el.addEventListener('change', () => { if (map) map[key] = el.value; });
  });
  document.getElementById('mapFogDist').addEventListener('input', e => {
    if (map) map.fogDist = +e.target.value;
    document.getElementById('mapFogDistVal').textContent = e.target.value;
  });

  // Selected node
  document.getElementById('selNodeX').addEventListener('change', e => {
    const n = getNode(selNode); if (n) n.x = +e.target.value;
  });
  document.getElementById('selNodeZ').addEventListener('change', e => {
    const n = getNode(selNode); if (n) n.z = +e.target.value;
  });
  document.getElementById('btnDeleteNode').addEventListener('click', () => {
    if (selNode >= 0) { deleteNode(selNode); selNode = -1; syncSelectedUI(); }
  });

  // Selected road
  document.getElementById('selRoadType').addEventListener('change', e => {
    const r = getRoad(selRoad); if (r) r.type = e.target.value;
  });
  document.getElementById('selRoadWidth').addEventListener('input', e => {
    const r = getRoad(selRoad);
    if (r) { r.width = +e.target.value; document.getElementById('selRoadWidthVal').textContent = e.target.value; }
  });
  document.getElementById('btnDeleteRoad').addEventListener('click', () => {
    if (selRoad >= 0) { deleteRoad(selRoad); syncSelectedUI(); }
  });
  document.getElementById('btnClearCurve').addEventListener('click', () => {
    const r = getRoad(selRoad); if (r) r.waypoints = [];
  });

  // Selected asset
  document.getElementById('selAssetType').addEventListener('change', e => {
    if (selAsset >= 0 && map?.assets[selAsset]) map.assets[selAsset].type = e.target.value;
  });
  document.getElementById('btnDeleteAsset').addEventListener('click', () => {
    if (selAsset >= 0) { deleteAsset(selAsset); syncSelectedUI(); }
  });

  // Map actions
  document.getElementById('btnNewMap').addEventListener('click', () => {
    createMap(); resetView(); populateUI(); renderMapList();
  });
  document.getElementById('btnSaveMap').addEventListener('click', saveCurrentMap);
  document.getElementById('btnDupeMap').addEventListener('click', duplicateCurrentMap);
  document.getElementById('btnDeleteMap').addEventListener('click', deleteCurrentMap);
  document.getElementById('btnExport').addEventListener('click', exportJSON);
  document.getElementById('btnPublish').addEventListener('click', publishMapToCloud);
  document.getElementById('btnLoadOnline').addEventListener('click', loadMapsFromCloud);
  document.getElementById('btnResetView').addEventListener('click', resetView);

  // Import
  document.getElementById('btnImport').addEventListener('click', () =>
    document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(txt => {
      try {
        const parsed = JSON.parse(txt);
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.roads))
          throw new Error('Missing nodes or roads array');
        parsed.id = parsed.id || uid();
        const idx = maps.findIndex(m => m.id === parsed.id);
        if (idx >= 0) maps[idx] = parsed; else maps.push(parsed);
        saveMapsToStorage();
        map = JSON.parse(JSON.stringify(parsed));
        recalcIds(); selNode = selRoad = selAsset = -1; connectFrom = -1;
        resetView(); populateUI(); renderMapList();
        notify('MAP IMPORTED');
      } catch (err) { notify('IMPORT ERROR: ' + err.message); }
      e.target.value = '';
    });
  });

  // Brush
  document.getElementById('brushAsset').addEventListener('change', e => {
    brushType = e.target.value; syncBrushUI();
  });
  document.getElementById('brushCount').addEventListener('input', e => {
    brushCount = +e.target.value;
    document.getElementById('brushCountVal').textContent = e.target.value;
  });
  document.getElementById('brushSpacing').addEventListener('input', e => {
    brushSpacing = +e.target.value;
    document.getElementById('brushSpacingVal').textContent = e.target.value;
  });
  document.querySelectorAll('.assetChip').forEach(el => {
    el.addEventListener('click', () => { brushType = el.dataset.asset; setTool('brush'); syncBrushUI(); });
  });

  // Cure tool
  document.getElementById('btnCureOrphans').addEventListener('click', cureAllOrphans);
  document.getElementById('btnStraightenAll').addEventListener('click', straightenAllRoads);

  // City spawner
  document.getElementById('citySize').addEventListener('input', e => {
    citySize = +e.target.value;
    document.getElementById('citySizeVal').textContent = citySize + '\xd7' + citySize;
  });
  document.getElementById('cityBlockSize').addEventListener('input', e => {
    cityBlockSize = +e.target.value;
    document.getElementById('cityBlockSizeVal').textContent = e.target.value;
  });
  document.getElementById('cityRoadType').addEventListener('change', e => {
    cityRoadType = e.target.value;
  });

  // Road scenery
  document.getElementById('sceneryDensity').addEventListener('input', e => {
    sceneryDensity = +e.target.value;
    document.getElementById('sceneryDensityVal').textContent = e.target.value;
  });
  document.getElementById('sceneryOffset').addEventListener('input', e => {
    sceneryOffset = +e.target.value;
    document.getElementById('sceneryOffsetVal').textContent = e.target.value;
  });
  document.getElementById('sceneryMix').addEventListener('change', e => {
    sceneryMix = e.target.value;
  });
  document.getElementById('btnGenScenery').addEventListener('click', generateRoadScenery);
  document.getElementById('btnClearScenery').addEventListener('click', clearRoadScenery);
  document.getElementById('btnPopulateMap').addEventListener('click', populateMapWithScenery);

  // Curvy roads
  document.getElementById('curvyToggle').addEventListener('change', e => {
    curvyEnabled = e.target.checked;
    document.getElementById('curvyAmountRow').style.display = curvyEnabled ? '' : 'none';
  });
  document.getElementById('curvyAmount').addEventListener('input', e => {
    curvyAmount = +e.target.value;
    document.getElementById('curvyAmountVal').textContent = e.target.value;
  });

  // Snap
  document.getElementById('snapToggle').addEventListener('change', e => {
    snapSize = e.target.checked ? 20 : 0;
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    switch (e.code) {
      case 'KeyS': setTool('select');  break;
      case 'KeyN': setTool('node');    break;
      case 'KeyR': setTool('road');    break;
      case 'KeyE': setTool('erase');   break;
      case 'KeyB': setTool('brush');   break;
      case 'KeyC': setTool('cure');    break;
      case 'KeyY': setTool('city');    break;
      case 'KeyG':
        snapSize = snapSize > 0 ? 0 : 20;
        document.getElementById('snapToggle').checked = snapSize > 0;
        break;
      case 'Escape': connectFrom = -1; setTool('select'); break;
      case 'Delete':
      case 'Backspace':
        if      (selNode  >= 0) { deleteNode(selNode);   selNode  = -1; syncSelectedUI(); }
        else if (selRoad  >= 0) { deleteRoad(selRoad);   syncSelectedUI(); }
        else if (selAsset >= 0) { deleteAsset(selAsset); syncSelectedUI(); }
        break;
    }
  });

  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const p = canvas.parentElement;
  canvas.width  = p.clientWidth  || 800;
  canvas.height = p.clientHeight || 600;
}

// ── Bootstrap ──────────────────────────────────────────────────
function init() {
  loadMapsFromStorage();
  if (maps.length > 0) { map = JSON.parse(JSON.stringify(maps[0])); recalcIds(); }
  else                   createMap();
  resizeCanvas();
  populateUI();
  renderMapList();
  setTool('select');
  bindUI();
  requestAnimationFrame(rafLoop);
}

init();
