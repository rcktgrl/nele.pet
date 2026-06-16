'use strict';
import { THREE } from './three.js';
import { scene } from './state.js';

// ═══════════════════════════════════════════════════════
//  CUSTOM MAP AI TRAFFIC
//  Simple road-following traffic cars for free-ride maps.
//  Cars pick a random road, follow it to the end, then
//  randomly choose a connected road at each intersection.
// ═══════════════════════════════════════════════════════

const TRAFFIC_COUNT   = 8;
const LOOKAHEAD       = 8;    // pts to look ahead for steering

// Speed limits per road type (km/h converted to m/s)
const ROAD_SPEED_MS = {
  highway: 150 / 3.6,  // ~41.7 m/s
  lane:    100 / 3.6,  // ~27.8 m/s
  country:  80 / 3.6,  // ~22.2 m/s
  street:   50 / 3.6,  // ~13.9 m/s
};

function _roadSpeed(type) {
  const base = ROAD_SPEED_MS[type] || ROAD_SPEED_MS.street;
  return base * (0.80 + Math.random() * 0.15); // 80-95% of limit for variety
}
const STEER_RATE      = 3.2;  // rad/s heading blend rate
const SAMPLE_STEPS    = 16;   // pts sampled per road segment

// Traffic car colors
const TRAFFIC_COLORS = [0xcc3322, 0x2255cc, 0xddaa22, 0x33aa55, 0x9933bb, 0xdd6622, 0x228899, 0xcccccc];

let _agents = [];
let _graph  = null; // nodeId → [{ roadId, otherNodeId }]
let _roads  = null; // roadId → { pts, len, nodeA, nodeB }

// ── Path helpers ─────────────────────────────────────────────────

function _sampleRoad(road, nodeMap) {
  const a = nodeMap.get(road.nodeA), b = nodeMap.get(road.nodeB);
  if (!a || !b) return null;
  const raw = [{ x: a.x, z: a.z }, ...(road.waypoints || []), { x: b.x, z: b.z }];
  if (raw.length === 3) {
    // Quadratic bezier matching the editor
    const [A, C, B] = raw;
    const result = [];
    const N = SAMPLE_STEPS * 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      result.push({ x: u*u*A.x + 2*u*t*C.x + t*t*B.x, z: u*u*A.z + 2*u*t*C.z + t*t*B.z });
    }
    return result;
  }
  const result = [];
  const segs = raw.length - 1;
  for (let i = 0; i <= segs * SAMPLE_STEPS; i++) {
    const t = i / (segs * SAMPLE_STEPS);
    const seg = Math.min(Math.floor(t * segs), segs - 1);
    const f = t * segs - seg;
    const p0 = raw[seg], p1 = raw[seg + 1];
    result.push({ x: p0.x + (p1.x - p0.x) * f, z: p0.z + (p1.z - p0.z) * f });
  }
  return result;
}

function _roadLen(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return len;
}

// ── Build road graph ─────────────────────────────────────────────

function _buildGraph(mapData) {
  const nodeMap = new Map();
  for (const n of (mapData.nodes || [])) nodeMap.set(n.id, n);

  _graph = new Map();
  _roads = new Map();

  for (const road of (mapData.roads || [])) {
    const pts = _sampleRoad(road, nodeMap);
    if (!pts || pts.length < 2) continue;
    _roads.set(road.id, { pts, len: _roadLen(pts), nodeA: road.nodeA, nodeB: road.nodeB, type: road.type || 'street' });

    if (!_graph.has(road.nodeA)) _graph.set(road.nodeA, []);
    if (!_graph.has(road.nodeB)) _graph.set(road.nodeB, []);
    _graph.get(road.nodeA).push({ roadId: road.id, otherNodeId: road.nodeB });
    _graph.get(road.nodeB).push({ roadId: road.id, otherNodeId: road.nodeA });
  }
}

// ── Simple traffic car mesh ───────────────────────────────────────

function _makeCarMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.9, 4.0),
    new THREE.MeshLambertMaterial({ color })
  );
  body.position.y = 0.55;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.65, 2.2),
    new THREE.MeshLambertMaterial({ color })
  );
  roof.position.set(0, 1.32, 0.1);
  const wMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const wGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.22, 8);
  const wOff = [[0.95, 0.38, 1.4], [-0.95, 0.38, 1.4], [0.95, 0.38, -1.4], [-0.95, 0.38, -1.4]];
  for (const [wx, wy, wz] of wOff) {
    const w = new THREE.Mesh(wGeo, wMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, wy, wz);
    g.add(w);
  }
  g.add(body); g.add(roof);
  g.castShadow = true;
  g.userData.trk = true;
  return g;
}

// ── Spawn helpers ─────────────────────────────────────────────────

function _randomRoadEntry() {
  const roadIds = [..._roads.keys()];
  if (!roadIds.length) return null;
  const roadId = roadIds[Math.floor(Math.random() * roadIds.length)];
  const rd = _roads.get(roadId);
  const forward = Math.random() < 0.5;
  const ptIdx = Math.floor(Math.random() * rd.pts.length);
  return { roadId, forward, ptIdx };
}

// ── Build / destroy ───────────────────────────────────────────────

export function buildTraffic(mapData) {
  destroyTraffic();
  _buildGraph(mapData);
  if (!_roads.size) return;

  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const entry = _randomRoadEntry();
    if (!entry) continue;
    const rd = _roads.get(entry.roadId);
    const pt = rd.pts[entry.ptIdx];
    const speed = _roadSpeed(rd.type);
    const color = TRAFFIC_COLORS[i % TRAFFIC_COLORS.length];
    const mesh = _makeCarMesh(color);

    // Compute initial heading from road direction
    const nextIdx = Math.min(entry.ptIdx + 1, rd.pts.length - 1);
    const prevIdx = Math.max(entry.ptIdx - 1, 0);
    const np = rd.pts[nextIdx], pp = rd.pts[prevIdx];
    const hdg = Math.atan2(np.x - pp.x, np.z - pp.z);

    mesh.position.set(pt.x, 0, pt.z);
    mesh.rotation.y = hdg;
    scene.add(mesh);

    _agents.push({ mesh, roadId: entry.roadId, ptIdx: entry.ptIdx, ptFrac: 0, forward: entry.forward, speed, hdg, prevRoadId: -1 });
  }
}

export function destroyTraffic() {
  for (const a of _agents) scene.remove(a.mesh);
  _agents = [];
  _graph  = null;
  _roads  = null;
}

// ── Per-frame update ──────────────────────────────────────────────

export function updateTraffic(dt, playerCar, enableCollisions) {
  if (!_agents.length || !_roads) return;

  for (const a of _agents) {
    let rd = _roads.get(a.roadId);
    if (!rd) continue;

    // Advance using fractional position within segments so cars move smoothly
    // regardless of segment length vs per-frame distance
    let rem = a.speed * dt;
    while (rem > 0) {
      const pts = rd.pts;
      const nextIdx = a.forward ? a.ptIdx + 1 : a.ptIdx - 1;
      if (nextIdx < 0 || nextIdx >= pts.length) {
        // Reached end of road — pick next road
        const endNode = a.forward ? rd.nodeB : rd.nodeA;
        const conns = _graph ? (_graph.get(endNode) || []) : [];
        const choices = conns.filter(e => e.roadId !== a.prevRoadId || conns.length === 1);
        if (!choices.length) { a.forward = !a.forward; a.ptFrac = 0; break; }
        const pick = choices[Math.floor(Math.random() * choices.length)];
        a.prevRoadId = a.roadId;
        a.roadId = pick.roadId;
        rd = _roads.get(pick.roadId);
        if (!rd) break;
        a.forward = (rd.nodeA === endNode);
        a.ptIdx   = a.forward ? 0 : rd.pts.length - 1;
        a.ptFrac  = 0;
        a.speed   = _roadSpeed(rd.type);
        break;
      }
      const cur = rd.pts[a.ptIdx], nxt = rd.pts[nextIdx];
      const segD = Math.hypot(nxt.x - cur.x, nxt.z - cur.z);
      if (segD < 0.001) { a.ptIdx = nextIdx; a.ptFrac = 0; continue; }
      const remInSeg = (1 - a.ptFrac) * segD;
      if (rem >= remInSeg) {
        rem -= remInSeg;
        a.ptIdx = nextIdx;
        a.ptFrac = 0;
      } else {
        a.ptFrac += rem / segD;
        break;
      }
    }

    // Current interpolated position
    const pts = rd.pts;
    const curIdx = a.ptIdx;
    const nxtIdx = a.forward ? Math.min(curIdx + 1, pts.length - 1) : Math.max(curIdx - 1, 0);
    const cur = pts[curIdx], nxt = pts[nxtIdx];
    const px = cur.x + (nxt.x - cur.x) * a.ptFrac;
    const pz = cur.z + (nxt.z - cur.z) * a.ptFrac;

    // Steer toward lookahead point
    const lapIdx = a.forward
      ? Math.min(curIdx + LOOKAHEAD, pts.length - 1)
      : Math.max(curIdx - LOOKAHEAD, 0);
    const tp = pts[lapIdx];
    const desiredHdg = Math.atan2(tp.x - px, tp.z - pz);

    let dh = desiredHdg - a.hdg;
    if (dh >  Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    a.hdg += Math.sign(dh) * Math.min(Math.abs(dh), STEER_RATE * dt);

    a.mesh.position.set(px, 0, pz);
    a.mesh.rotation.y = a.hdg;
  }

  // Collision with player car
  if (enableCollisions && playerCar) {
    const px = playerCar.pos.x, pz = playerCar.pos.z;
    for (const a of _agents) {
      const tp = a.mesh.position;
      const dx = px - tp.x, dz = pz - tp.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d < 3.5 && d > 0.01) {
        const overlap = 3.5 - d;
        const nx = dx / d, nz = dz / d;
        playerCar.pos.x += nx * overlap * 0.6;
        playerCar.pos.z += nz * overlap * 0.6;
        playerCar.spd    *= 0.6;
        if (playerCar.isReversing) playerCar.revSpd *= 0.6;
        playerCar.mesh.position.copy(playerCar.pos);
        // Nudge traffic car slightly
        tp.x -= nx * overlap * 0.4;
        tp.z -= nz * overlap * 0.4;
      }
    }
  }

  // Show on minimap — handled externally via getTrafficPositions()
}

export function getTrafficPositions() {
  return _agents.map(a => ({ x: a.mesh.position.x, z: a.mesh.position.z }));
}
