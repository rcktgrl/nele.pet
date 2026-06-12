'use strict';
import { THREE } from './three.js';
import { CARS } from './data/cars.js';
import { state, scene, dc, keys, mmctx } from './state.js';
import { Car, resolveCarCollisions } from './car.js';
import { buildFreeDriveWorld, getFreeDriveWorld } from './freedrive-world.js';
import { FreeDriveNetwork } from './freedrive-net.js';
import { setupLights } from './lighting.js';
import { updateCamera } from './camera.js';
import { drawDash } from './hud.js';
import { initAudio, startMusic, updateAudio } from './audio.js';
import {
  isTouchControlsVisibleInState, updateTouchControlsVisibility,
  isTouchControlsEnabled, touchState, getGyroSteering, getTouchSliderSteer
} from './touch-controls.js';
import { buildCarChipRow, refreshCarChipColors, disposeCarCardPreviews } from './menu.js';
import { clearGhostVisual } from './ghost.js';
import { getArcadeUser } from './user.js';
import { hexNumToCss, cssToHexNum } from './editor.js';
import { notify } from './notify.js';

// ═══════════════════════════════════════════════════════
//  FREE DRIVE MODE
//  Open-world island cruising — solo or together with
//  everyone else on the shared island channel.
// ═══════════════════════════════════════════════════════

const FD_WORLD_ID = 'island-v2';

// Remote drivers: id → {car, tagEl, name, snap, hasPos}
let fdRemote = {};
let _firstRosterSync = false;

// ── Dead-reckoning blend factors (same model as VS mode) ──
const _DR_BLEND_POS = 12, _DR_BLEND_HDG = 15, _DR_BLEND_SPD = 8, _DR_SNAP_DIST = 25;

// ═══════════════════════════════════════════════════════
//  MENU SCREEN
// ═══════════════════════════════════════════════════════
function _setFdStatus(msg){
  const el = document.getElementById('fdStatusMsg');
  if(el) el.textContent = msg;
}

function _syncFdColorPicker(){
  const cp = document.getElementById('fdColor');
  if(!cp) return;
  const def = CARS[state.selCar ?? 0]?.hex || '#ffffff';
  cp.value = state.carColor != null ? hexNumToCss(state.carColor) : def;
}

export function showFreeDriveMenu(){
  document.querySelectorAll('.screen,#results').forEach(s => s.style.display = 'none');
  document.getElementById('sFreeDrive').style.display = 'flex';
  state.gState = 'fdMenu';
  updateTouchControlsVisibility(state.gState);
  if(state.selCar == null) state.selCar = 0;
  buildCarChipRow('fdCarRow', () => { _syncFdColorPicker(); });
  _syncFdColorPicker();
  const tgl = document.getElementById('fdOnlineToggle');
  if(tgl) tgl.checked = state.fdOnline;
  const lbl = document.getElementById('fdMyNameLabel');
  if(lbl) lbl.textContent = getArcadeUser().name || 'Anonymous';
  _setFdStatus('');
}

export function onFdColorInput(css){
  state.carColor = cssToHexNum(css);
  refreshCarChipColors('fdCarRow');
}

// ═══════════════════════════════════════════════════════
//  SESSION START / END
// ═══════════════════════════════════════════════════════
export async function startFreeDrive(){
  disposeCarCardPreviews();
  _teardownSession();
  for(const ctrl of state.aiControllers) if(ctrl.destroy) ctrl.destroy();
  for(const c of state.allCars) scene.remove(c.mesh);
  state.allCars = []; state.aiCars = []; state.aiControllers = []; state.pCar = null;
  clearGhostVisual();
  document.querySelectorAll('.screen,#results').forEach(s => s.style.display = 'none');

  const world = buildFreeDriveWorld();
  setupLights();

  const sp = world.spawnPoints[Math.floor(Math.random() * world.spawnPoints.length)];
  const pos = new THREE.Vector3(sp.x + (Math.random() - 0.5) * 18, 0, sp.z + (Math.random() - 0.5) * 5);
  const car = new Car(CARS[state.selCar ?? 0], pos, sp.hdg, true, scene, state.carColor);
  state.pCar = car; state.allCars = [car];

  state.fdMode = true; state.raceTime = 0; state.fdPosTimer = 0;
  state.fdCleanup = _quitCleanup;

  // HUD: speed + gear + island map — no laps, checkpoints or positions
  document.getElementById('hud').style.display = 'block';
  document.getElementById('raceTop').style.display = 'none';
  document.getElementById('pos').style.display = 'none';
  document.getElementById('speedBox').style.display = 'block';
  document.getElementById('gearBox').style.display = 'block';
  document.getElementById('camLabel').textContent = '[ C ] COCKPIT VIEW';
  document.getElementById('hint').style.display = isTouchControlsEnabled() ? 'none' : 'block';
  state.camMode = 'chase'; dc.style.display = 'none';
  _buildStaticMinimap(world);

  state.gState = 'freedrive';
  updateTouchControlsVisibility(state.gState);
  initAudio(); startMusic();
  notify(`Free Drive — spawned in ${sp.city}. Explore the island!`);
  _updateOnlineHudTag();

  if(state.fdOnline) await _joinIsland();
}

// Respawn on the nearest city spawn point (pause-menu RESTART).
export function fdRespawn(){
  const world = getFreeDriveWorld();
  const car = state.pCar;
  if(!world || !car) return;
  let best = world.spawnPoints[0], bd = Infinity;
  for(const sp of world.spawnPoints){
    const d = (car.pos.x - sp.x) ** 2 + (car.pos.z - sp.z) ** 2;
    if(d < bd){ bd = d; best = sp; }
  }
  car.pos.set(best.x + (Math.random() - 0.5) * 18, car.groundY(), best.z);
  car.hdg = best.hdg; car.spd = 0; car.revSpd = 0; car.isReversing = false;
  car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.hdg;
  state.gState = 'freedrive';
  updateTouchControlsVisibility(state.gState);
  initAudio(); startMusic();
  notify(`Respawned in ${best.city}.`);
}

// Tear down network + remote cars (keeps the local car — showMain removes it).
function _teardownSession(){
  if(state.fdNetwork){ state.fdNetwork.leave().catch(() => {}); state.fdNetwork = null; }
  for(const id of Object.keys(fdRemote)) _removeRemote(id);
  fdRemote = {};
  _firstRosterSync = false;
}

// Registered as state.fdCleanup — called by showMain when leaving the mode.
function _quitCleanup(){
  _teardownSession();
  state.fdMode = false; state.fdCleanup = null;
  document.getElementById('raceTop').style.display = '';
  document.getElementById('pos').style.display = '';
  const tag = document.getElementById('fdOnlineTag');
  if(tag) tag.style.display = 'none';
}

// ═══════════════════════════════════════════════════════
//  NETWORK
// ═══════════════════════════════════════════════════════
async function _joinIsland(){
  const user = getArcadeUser();
  const net = new FreeDriveNetwork();
  state.fdNetwork = net;
  net.onRoster = _onRoster;
  net.onPos = _onPos;
  try {
    await net.join(FD_WORLD_ID, user.name || 'Anonymous', state.selCar ?? 0, state.carColor);
  } catch(e) {
    if(state.fdNetwork === net) state.fdNetwork = null;
    notify('Island online unavailable — driving solo. (' + e.message + ')');
    _updateOnlineHudTag();
    return;
  }
  // User may have quit to the menu while we were connecting
  if(state.gState !== 'freedrive' && state.gState !== 'paused'){
    net.leave().catch(() => {});
    if(state.fdNetwork === net) state.fdNetwork = null;
    return;
  }
  _updateOnlineHudTag();
}

function _onRoster(players){
  if(!state.fdNetwork) return;
  const myId = state.fdNetwork.myId;
  const seen = new Set();
  for(const p of players){
    if(!p.id || p.id === myId) continue;
    seen.add(p.id);
    if(!fdRemote[p.id]){
      _addRemote(p);
      if(_firstRosterSync) notify(`${p.name || 'A driver'} joined the island`);
    }
  }
  for(const id of Object.keys(fdRemote)){
    if(!seen.has(id)){
      notify(`${fdRemote[id].name} left the island`);
      _removeRemote(id);
    }
  }
  _firstRosterSync = true;
  _updateOnlineHudTag();
}

function _addRemote(p){
  const car = new Car(CARS[p.carIdx] || CARS[0], new THREE.Vector3(0, 0, 0), 0, false, scene, p.color ?? null);
  car.mesh.visible = false;   // hidden until the first position packet arrives
  const tagEl = document.createElement('div');
  tagEl.style.cssText = 'display:none;position:fixed;pointer-events:none;z-index:60;transform:translate(-50%,-100%);background:rgba(5,5,20,.85);border:1px solid #4af;border-radius:4px;padding:2px 8px;color:#4af;font-family:Orbitron,monospace;font-size:.65rem;white-space:nowrap;';
  tagEl.textContent = p.name || 'Driver';
  document.body.appendChild(tagEl);
  fdRemote[p.id] = { car, tagEl, name: p.name || 'Driver', snap: null, hasPos: false };
}

function _removeRemote(id){
  const r = fdRemote[id];
  if(!r) return;
  scene.remove(r.car.mesh);
  if(r.tagEl.parentNode) r.tagEl.parentNode.removeChild(r.tagEl);
  delete fdRemote[id];
}

function _onPos(p){
  const r = fdRemote[p.id];
  if(!r) return;
  r.snap = { x: p.x, z: p.z, hdg: p.hdg, spd: p.spd, rxT: performance.now() / 1000 };
  if(!r.hasPos){
    r.hasPos = true;
    r.car.pos.x = p.x; r.car.pos.z = p.z; r.car.hdg = p.hdg; r.car.spd = p.spd;
    r.car.mesh.visible = true;
  }
}

function _updateOnlineHudTag(){
  const el = document.getElementById('fdOnlineTag');
  if(!el) return;
  if(!state.fdMode){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  if(state.fdNetwork){
    const n = 1 + Object.keys(fdRemote).length;
    el.textContent = `🏝 ISLAND ONLINE · ${n} DRIVER${n > 1 ? 'S' : ''}`;
    el.style.color = '#4f9';
  } else {
    el.textContent = '🏝 ISLAND · SOLO DRIVE';
    el.style.color = '#789';
  }
}

function _broadcastPos(dt){
  if(!state.fdNetwork || !state.pCar) return;
  state.fdPosTimer -= dt;
  if(state.fdPosTimer > 0) return;
  state.fdPosTimer = 0.1;   // 10 Hz — dead-reckoning fills the gaps
  const c = state.pCar;
  state.fdNetwork.sendPos(
    Math.round(c.pos.x * 100) / 100,
    Math.round(c.pos.z * 100) / 100,
    Math.round(c.hdg * 1000) / 1000,
    Math.round((c.isReversing ? -c.revSpd : c.spd) * 10) / 10
  );
}

function _updateRemoteCars(dt){
  const now = performance.now() / 1000;
  for(const r of Object.values(fdRemote)){
    const car = r.car, snap = r.snap;
    if(!snap || !r.hasPos) continue;

    // Stale feed (tab hidden / paused on their end): coast to a stop
    if(now - snap.rxT > 1.5) car.spd *= Math.max(0, 1 - 2 * dt);

    car.pos.x += Math.sin(car.hdg) * car.spd * dt;
    car.pos.z += Math.cos(car.hdg) * car.spd * dt;

    const ex = snap.x - car.pos.x, ez = snap.z - car.pos.z;
    const dist = Math.sqrt(ex * ex + ez * ez);
    if(dist > _DR_SNAP_DIST){
      car.pos.x = snap.x; car.pos.z = snap.z;
      car.hdg = snap.hdg; car.spd = snap.spd;
    } else {
      const pb = Math.min(1, _DR_BLEND_POS * dt);
      car.pos.x += ex * pb; car.pos.z += ez * pb;
      let dh = snap.hdg - car.hdg;
      if(dh > Math.PI) dh -= Math.PI * 2;
      if(dh < -Math.PI) dh += Math.PI * 2;
      car.hdg += dh * Math.min(1, _DR_BLEND_HDG * dt);
      car.spd += (snap.spd - car.spd) * Math.min(1, _DR_BLEND_SPD * dt);
    }
    car.pos.y = car.groundY();
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y = car.hdg;
  }
}

function _updateTags(){
  for(const r of Object.values(fdRemote)){
    if(!r.hasPos || !state.activeCam){ r.tagEl.style.display = 'none'; continue; }
    const p = r.car.mesh.position.clone().add(new THREE.Vector3(0, 2.7, 0)).project(state.activeCam);
    if(p.z > -1 && p.z < 1){
      r.tagEl.style.display = 'block';
      r.tagEl.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
      r.tagEl.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
    } else r.tagEl.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════
//  PER-FRAME UPDATE (called from the game loop)
// ═══════════════════════════════════════════════════════
export function updateFreeDrive(dt){
  const world = getFreeDriveWorld();
  const car = state.pCar;
  if(!world || !car) return;
  state.raceTime += dt;

  const autoTouchThrottle = isTouchControlsVisibleInState(state.gState)
    && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    && !touchState.brake;
  const thr = (keys['ArrowUp'] || keys['KeyW'] || touchState.throttle || autoTouchThrottle) ? 1 : 0;
  const brk = (keys['ArrowDown'] || keys['KeyS'] || touchState.brake) ? 1 : 0;
  const left = (keys['ArrowLeft'] || keys['KeyA'] || touchState.left);
  const right = (keys['ArrowRight'] || keys['KeyD'] || touchState.right);
  const keySteer = left && !right ? 1 : right && !left ? -1 : 0;
  const gyroSteer = getGyroSteering();
  const sliderSteer = getTouchSliderSteer();
  const str = Math.abs(gyroSteer) > 0.01 ? gyroSteer : Math.abs(sliderSteer) > 0.01 ? sliderSteer : keySteer;

  // Off-road: Rally Storm (green) drives freely. All other cars get reduced thrust
  // (set via onGravel) — slower acceleration but no hard speed cap.
  const offroad = world.roadEdgeDist(car.pos.x, car.pos.z) > 1.5;
  const isRally = car.data.id === 2;
  car.onGravel = offroad && !isRally;
  car.update({ thr, brk, str }, dt);
  _applyWorldBounds(car, world);

  _updateRemoteCars(dt);
  _broadcastPos(dt);
  resolveCarCollisions([car, ...Object.values(fdRemote).filter(r => r.hasPos).map(r => r.car)]);

  updateAudio(thr, brk, dt, car, keys);
  updateCamera();
  document.getElementById('speedNum').textContent = Math.round((car.isReversing ? car.revSpd : car.spd) * 3.6);
  document.getElementById('gearNum').textContent = car.gear === 0 ? 'R' : car.gear;
  drawDash();
  _drawFdMinimap(world);
  _updateTags();
}

function _applyWorldBounds(car, world){
  const d = Math.hypot(car.pos.x, car.pos.z);
  if(d > world.waterR){
    const f = world.waterR / d;
    car.pos.x *= f; car.pos.z *= f;
    car.spd *= 0.8; if(car.isReversing) car.revSpd *= 0.7;
  } else if(d < world.lakeR + 6 && d > 0.01){
    const f = (world.lakeR + 6) / d;
    car.pos.x *= f; car.pos.z *= f;
    car.spd *= 0.8; if(car.isReversing) car.revSpd *= 0.7;
  }
  car.mesh.position.copy(car.pos);
}

// ═══════════════════════════════════════════════════════
//  ISLAND MINIMAP
// ═══════════════════════════════════════════════════════
let _mapCanvas = null, _mapScale = 1;

function _buildStaticMinimap(world){
  const S = 150, half = S / 2;
  _mapCanvas = document.createElement('canvas');
  _mapCanvas.width = S; _mapCanvas.height = S;
  _mapScale = half / (world.waterR + 60);
  const ctx = _mapCanvas.getContext('2d');
  const toM = (x, z) => [half + x * _mapScale, half + z * _mapScale];
  ctx.fillStyle = 'rgba(4,10,24,.85)'; ctx.fillRect(0, 0, S, S);
  // Draw irregular island outline from boundary points
  function drawIslandShape(pts, scale, fillColor) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const mx = half + p.x * scale * _mapScale, mz = half + p.z * scale * _mapScale;
      i === 0 ? ctx.moveTo(mx, mz) : ctx.lineTo(mx, mz);
    });
    ctx.closePath(); ctx.fillStyle = fillColor; ctx.fill();
  }
  const iPts = world.islandBoundaryPts || [];
  drawIslandShape(iPts, 1.055, '#54492f'); // beach
  drawIslandShape(iPts, 1.0,   '#15301b'); // grass
  ctx.beginPath(); ctx.arc(half, half, world.lakeR * _mapScale, 0, Math.PI * 2);
  ctx.fillStyle = '#10334d'; ctx.fill();
  const styles = { highway: ['#ffb347', 2.4], country: ['#7ddb8a', 1.6], lane: ['#55996b', 1.0], street: ['#4a8cff', 1.0], racetrack: ['#ff4400', 1.8] };
  for(const r of world.mapRoads){
    const [col, w] = styles[r.type] || ['#888', 1];
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
    r.pts.forEach(([x, z], i) => { const [mx, mz] = toM(x, z); i ? ctx.lineTo(mx, mz) : ctx.moveTo(mx, mz); });
    if(r.closed) ctx.closePath();
    ctx.stroke();
  }
  for(const c of world.cities){
    const [mx, mz] = toM(c.x, c.z);
    ctx.fillStyle = '#' + c.beacon.toString(16).padStart(6, '0');
    ctx.beginPath(); ctx.arc(mx, mz, 2.6, 0, Math.PI * 2); ctx.fill();
  }
}

function _drawFdMinimap(){
  if(!_mapCanvas || !state.pCar) return;
  const ctx = mmctx, S = 150, half = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.drawImage(_mapCanvas, 0, 0);
  for(const r of Object.values(fdRemote)){
    if(!r.hasPos) continue;
    ctx.beginPath();
    ctx.arc(half + r.car.pos.x * _mapScale, half + r.car.pos.z * _mapScale, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#44aaff'; ctx.fill();
  }
  const px = half + state.pCar.pos.x * _mapScale, pz = half + state.pCar.pos.z * _mapScale;
  const hdg = state.pCar.hdg;
  ctx.beginPath(); ctx.arc(px, pz, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd700'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px, pz);
  ctx.lineTo(px + Math.sin(hdg) * 8, pz + Math.cos(hdg) * 8);
  ctx.stroke();
}
