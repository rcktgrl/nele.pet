'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  AI Trainer — Main Thread
//
//  Handles Three.js rendering + UI.  All physics + PPO training runs in
//  sim-worker.js on a separate thread.
// ─────────────────────────────────────────────────────────────────────────────
import { THREE }           from '../../turborace/scripts/three.js';
import { buildTrack }      from '../../turborace/scripts/track-gen.js';
import { createCarVisual } from '../../turborace/scripts/car-model.js';
import { CARS }            from '../../turborace/scripts/data/cars.js';
import { state, scene as trState } from '../../turborace/scripts/state.js';

const SCENE = state.scene || trState;

// ─────────────────────────────────────────────────────────────────────────────
//  Renderer + camera
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gc');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const ambLight = new THREE.AmbientLight(0xffffff, 0.55);
SCENE.add(ambLight);
const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
dirLight.position.set(80, 160, 60); dirLight.castShadow = true;
SCENE.add(dirLight);

// ─────────────────────────────────────────────────────────────────────────────
//  Orbit camera
// ─────────────────────────────────────────────────────────────────────────────
const orbit = { yaw: 0, pitch: 1.1, dist: 120, tx: 0, ty: 0, tz: 0 };
let _drag = null;

canvas.addEventListener('mousedown', e => { if (e.button === 0) _drag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('mouseup',   () => { _drag = null; });
window.addEventListener('mousemove', e => {
  if (!_drag) return;
  orbit.yaw   -= (e.clientX - _drag.x) * 0.005;
  orbit.pitch  = Math.max(0.15, Math.min(1.45, orbit.pitch - (e.clientY - _drag.y) * 0.003));
  _drag.x = e.clientX; _drag.y = e.clientY;
});
canvas.addEventListener('wheel', e => {
  orbit.dist = Math.max(15, Math.min(600, orbit.dist * (1 + Math.sign(e.deltaY) * 0.08)));
}, { passive: true });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function applyOrbitCamera(target) {
  if (target) { orbit.tx = target.x * 0.04 + orbit.tx * 0.96; orbit.tz = target.z * 0.04 + orbit.tz * 0.96; }
  const cy = Math.cos(orbit.pitch), sy = Math.sin(orbit.pitch);
  camera.position.set(
    orbit.tx + orbit.dist * Math.sin(orbit.yaw) * cy,
    orbit.ty + orbit.dist * sy,
    orbit.tz + orbit.dist * Math.cos(orbit.yaw) * cy,
  );
  camera.lookAt(orbit.tx, orbit.ty + 2, orbit.tz);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Track loading
//  fetch() resolves against the page URL, NOT the module URL — one "../".
// ─────────────────────────────────────────────────────────────────────────────
const TRACKS_BASE = '../turborace/tracks/';
let trackList = [];

async function loadTrackIndex() {
  const filenames = await fetch(TRACKS_BASE + 'index.json').then(r => r.json());
  trackList = [];
  for (const fn of filenames) {
    try {
      const data = await fetch(TRACKS_BASE + fn).then(r => r.json());
      trackList.push({ filename: fn, data });
    } catch (err) {
      console.warn('Skipping unreadable track:', fn, err);
    }
  }
}

function applyTrack(data) {
  state.trkData = data;
  buildTrack(data);
  if (state.trkPts && state.trkPts.length) {
    let sx = 0, sz = 0;
    for (const p of state.trkPts) { sx += p.x; sz += p.z; }
    orbit.tx = sx / state.trkPts.length;
    orbit.tz = sz / state.trkPts.length;
    orbit.ty = 0; orbit.dist = 120;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Car meshes
// ─────────────────────────────────────────────────────────────────────────────
// Which car (model + physics) the agents train with. Picked in the config menu.
let selectedCarIdx = 0;
function carSpec() { return CARS[selectedCarIdx] || CARS[0]; }
let carMeshes = [], carWheelGroups = [];

function rebuildCarMeshes(count) {
  for (const m of carMeshes) SCENE.remove(m);
  carMeshes = []; carWheelGroups = [];
  for (let i = 0; i < count; i++) {
    const v = createCarVisual(carSpec());
    SCENE.add(v.mesh);
    carMeshes.push(v.mesh);
    carWheelGroups.push(v.wheels || []);
  }
}

let lastCars = [];
const FIXED_DT = 1 / 60;

function syncCarMeshes(cars, bestIdx) {
  // Multi-track: each map has its own world coordinates, so only draw the cars
  // on the track currently being viewed; the rest are hidden.
  const filtering = simCfg.multiTrack && trackList.length > 1;
  for (let i = 0; i < carMeshes.length && i < cars.length; i++) {
    const c = cars[i], m = carMeshes[i];
    if (filtering && c.trk !== selectedTrackIdx) { m.visible = false; continue; }
    m.visible = true;
    m.position.set(c.x, c.y, c.z);
    m.rotation.y = c.hdg;
    m.traverse(o => {
      if (!o.isMesh || !o.material) return;
      if (o.material.emissive) o.material.emissive.setHex(i === bestIdx ? 0x001530 : 0x000000);
    });
    for (const wg of carWheelGroups[i] || []) {
      if (wg.children[0]) wg.children[0].rotation.x += c.spd * FIXED_DT * 2.2;
    }
  }
}

function bestCarIndex(cars) {
  // When filtering to one viewed track, pick the leader among visible cars so
  // the camera doesn't chase a car on a map you can't see.
  const filtering = simCfg.multiTrack && trackList.length > 1;
  let bi = -1, bf = -Infinity;
  for (let i = 0; i < cars.length; i++) {
    if (filtering && cars[i].trk !== selectedTrackIdx) continue;
    if (cars[i].ret > bf) { bf = cars[i].ret; bi = i; }
  }
  return bi < 0 ? 0 : bi;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Worker
// ─────────────────────────────────────────────────────────────────────────────
let worker = null, workerReady = false, simRunning = false;

const OBS_DIM = 40; // must match sim-worker.js (36 + 4 memory cells)
const ACT_DIM = 6;  // steer, throttle/brake + 4 memory-cell deltas

// Full training config — architecture fields require restart, others are live
const simCfg = {
  hiddenLayers: 1,       // restart required
  hiddenSize: 64,        // restart required
  recurrent: false,      // restart required — GRU recurrent policy/critic (BPTT)
  bpttLen: 32,           // truncated-BPTT window (decisions per training chunk)
  backend: 'auto',       // restart required — 'auto' | 'gpu' | 'wasm' | 'js'
  threads: Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2)),
  numEnvs: 8,            // restart required
  speedMult: 1,
  episodeLen: 60,
  randomSpawn: true,
  multiTrack: false,     // restart required — train across all maps in parallel
  lr: 3e-4,
  entropyCoef: 0.003,
  horizon: 512,          // restart required
  // PPO mods
  groupSize: 1,          // restart required — GRPO-style agent groups
  mirror: false,         // live — left↔right symmetry augmentation
  klStop: true,          // live — KL-based early stop of update epochs
  neuronRepair: false,   // live — dead-neuron recycle + dominant split
  failRate: 0,           // live — defect-weight fraction per agent
  progressReward: 0.2,
  gravelPenalty: 1.0,
  wallPenalty: 2.0,
  wallHitPenalty: 50,
  terminalPenalty: 10,
  lapBonus: 20,
};

function mkWorker() {
  if (worker) { worker.terminate(); worker = null; }
  worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onMsg;
  worker.onerror   = err => console.error('[sim-worker]', err);
  workerReady = false;
}

// Serialize the track currently built into `state` into the worker payload.
function serializeTrackFromState() {
  return {
    pts:          state.trkPts.map(p => ({ x: p.x, y: p.y, z: p.z })),
    wallLeft:     (state.trkWallLeft  || []).map(w => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1 })),
    wallRight:    (state.trkWallRight || []).map(w => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1 })),
    data: state.trkData ? { wp: state.trkData.wp, rw: state.trkData.rw, laps: state.trkData.laps } : null,
    gravelProfile: state.gravelProfile ? {
      pts:         state.gravelProfile.pts.map(p => ({ x: p.x, y: p.y, z: p.z })),
      leftRunoff:  state.gravelProfile.leftRunoff,
      rightRunoff: state.gravelProfile.rightRunoff,
      rw:          state.gravelProfile.rw,
    } : null,
    cityCorridors: state.cityCorridors
      ? state.cityCorridors.map(c => ({ x: c.x, z: c.z, hw: c.hw, hd: c.hd })) : null,
    cityAiPts: state.cityAiPts
      ? { pts: state.cityAiPts.pts.map(p => ({ x: p.x, z: p.z })) } : null,
  };
}

function sendInit(model = null) {
  if (!worker || !state.trkPts || !state.trkPts.length) return;
  const car = carSpec();
  const carData = {
    accel: car.accel, maxSpd: car.maxSpd,
    brake: car.brake, hdl: car.hdl, aiSpd: car.aiSpd || 1.0,
  };
  let tracks;
  if (simCfg.multiTrack && trackList.length > 1) {
    // Build + serialize every map, then re-apply the displayed one so the scene
    // mesh + camera end up back on the track the user is watching. Track order
    // matches trackList, so a car's `trk` index lines up with selectedTrackIdx.
    tracks = [];
    for (let i = 0; i < trackList.length; i++) {
      applyTrack(trackList[i].data);
      tracks.push(serializeTrackFromState());
    }
    applyTrack(trackList[selectedTrackIdx].data);
  } else {
    tracks = [serializeTrackFromState()];
  }
  const displayIdx = (simCfg.multiTrack && trackList.length > 1) ? selectedTrackIdx : 0;
  worker.postMessage({ type: 'init', track: tracks[displayIdx], tracks, carData, config: { ...simCfg }, model });
  updateTrackView();
}

function onMsg(e) {
  const d = e.data;
  if (d.type === 'ready') {
    workerReady = true;
    rebuildCarMeshes(simCfg.numEnvs);
    refreshHUD({ iteration: 0, totalSteps: 0, bufferFill: 0, avgReturn: 0, bestLap: null, phase: 'collecting' });
    updateStartBtn();
    return;
  }
  if (d.type === 'frame') {
    lastCars = d.cars || [];
    const bi = bestCarIndex(lastCars);
    syncCarMeshes(lastCars, bi);
    if (lastCars[bi]) applyOrbitCamera(lastCars[bi]);
    refreshHUD(d);
    if (d.actorFlat && d.actorSizes) drawNN(d.actorFlat, d.actorSizes);
    else if (d.recurrent && !_recNoteDrawn) { drawRecurrentNote(); _recNoteDrawn = true; }
    return;
  }
  if (d.type === 'error') { alert(d.message); return; }
  if (d.type === 'modelExport' && d.model) {
    // Record which car the agents trained with so the racing game can spawn the
    // AI in the matching car. CARS ids line up with their array index.
    const car = carSpec();
    d.model.carId = car.id;
    d.model.carName = car.name;
    const blob = new Blob([JSON.stringify(d.model, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ai-trainer-ppo-model.json'; a.click();
    URL.revokeObjectURL(url);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────────────
function fmt(v) { return Number.isFinite(v) ? v.toFixed(1) : '—'; }
function fmtSteps(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function fmtLap(t) {
  if (!Number.isFinite(t) || t == null) return '—';
  const m = Math.floor(t / 60), s = (t % 60).toFixed(2);
  return m > 0 ? `${m}:${s.padStart(5, '0')}` : s + 's';
}

function refreshHUD(d) {
  const { iteration = 0, totalSteps = 0, bufferFill = 0, avgReturn = 0, bestLap = null, phase = 'collecting' } = d;
  document.getElementById('hudGen').textContent  = 'UPDATE ' + iteration;
  document.getElementById('hudBest').textContent = 'REWARD ' + fmt(avgReturn);
  document.getElementById('hudAvg').textContent  = 'BEST LAP ' + fmtLap(bestLap);
  document.getElementById('hudTime').textContent = fmtSteps(totalSteps) + ' steps';

  const bar = document.getElementById('genBar');
  const wrap = document.getElementById('genBarWrap');
  if (phase === 'updating') {
    bar.style.width = '100%';
    bar.style.background = 'linear-gradient(90deg, #fa4, #f84)';
    wrap.title = 'UPDATING POLICY…';
  } else {
    bar.style.width = (Math.min(1, bufferFill) * 100).toFixed(1) + '%';
    bar.style.background = 'linear-gradient(90deg, #4af, #4f4)';
    wrap.title = 'Collecting rollout — bar fills then policy updates';
  }
  const threads = d.gradThreads || 0;
  const phaseEl = document.getElementById('hudPhase');
  if (phase === 'updating') {
    phaseEl.textContent = threads ? `⚙ UPDATING ×${threads}` : '⚙ UPDATING';
    phaseEl.style.color = '#fa4';
  } else {
    phaseEl.textContent = '● COLLECTING';
    phaseEl.style.color = '#4f4';
  }
  // Compute-backend badge: GPU / WASM / JS, tooltip carries failure reasons
  const backendEl = document.getElementById('hudWasm');
  if (backendEl && d.backend) {
    const labels = {
      'gpu': 'GPU ✓', 'gpu-init': 'GPU …', 'gpu-failed': 'GPU ✗→CPU',
      'wasm': `WASM ×${threads}`, 'js': `JS ×${threads || 1}`,
    };
    const colors = {
      'gpu': '#c9f', 'gpu-init': '#fa4', 'gpu-failed': '#f66',
      'wasm': '#4fa', 'js': '#888',
    };
    backendEl.textContent = labels[d.backend] || d.backend;
    backendEl.style.color = colors[d.backend] || '#888';
    backendEl.title = d.backendInfo || 'Gradient compute backend';
  }

  if (d.sigma) {
    document.getElementById('hudSigma').textContent = 'σ ' + d.sigma.map(s => s.toFixed(2)).join('/');
  }

  const bestEl = document.getElementById('bestStatus');
  if (bestEl && Object.prototype.hasOwnProperty.call(d, 'best')) {
    if (d.best) {
      let txt = `best avg ${fmt(d.best.avg)} @ update ${d.best.iter}`;
      if (d.best.cur != null) txt += ` · current avg ${fmt(d.best.cur)}`;
      bestEl.textContent = txt;
      // amber when the current average has fallen clearly below the snapshot
      const dropping = d.best.cur != null &&
        d.best.cur < d.best.avg - Math.max(2, Math.abs(d.best.avg) * 0.1);
      bestEl.style.color = dropping ? '#fa4' : '#4a8';
    } else {
      bestEl.textContent = 'no snapshot yet — needs ~12 finished episodes';
      bestEl.style.color = '#667';
    }
  }

  const modsEl = document.getElementById('modsStatus');
  if (modsEl && d.mods) {
    const m = d.mods;
    const parts = [];
    if (m.groupSize > 1) parts.push(`groups ×${m.groupSize}`);
    if (m.mirror) parts.push('mirror ×2');
    if (m.klStop && m.epochsMax) {
      parts.push(`epochs ${m.epochs || '—'}/${m.epochsMax} · KL ${m.kl.toFixed(3)}`);
    }
    if (m.repair) parts.push(`♻ ${m.repair.recycled} recycled · ${m.repair.splits} split`);
    if (m.masked) parts.push(`⚡ ${m.masked} defect agents`);
    modsEl.textContent = parts.length ? parts.join('  ·  ') : 'no mods active';
  }

  if (lastCars.length) {
    const sorted = lastCars.map((c, i) => ({ ...c, i })).sort((a, b) => b.ret - a.ret);
    document.getElementById('lbRows').innerHTML = sorted.slice(0, 8).map((c, r) => `
      <div class="lb-row">
        <span class="lb-rank">${r + 1}</span>
        <span class="lb-fit">${fmt(c.ret)}</span>
        <span class="lb-spd">${(c.spd * 3.6).toFixed(0)}km/h</span>
        <span class="lb-flag">${c.lap > 0 ? 'L' + c.lap : ''}</span>
      </div>`).join('');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Neural network visualiser
// ─────────────────────────────────────────────────────────────────────────────
const nnCanvas = document.getElementById('nnCanvas');
const nnCtx    = nnCanvas.getContext('2d');

let _recNoteDrawn = false;
function drawRecurrentNote() {
  const W = nnCanvas.width, H = nnCanvas.height;
  nnCtx.clearRect(0, 0, W, H);
  nnCtx.fillStyle = '#fa4';
  nnCtx.font = '13px monospace';
  nnCtx.textAlign = 'center';
  nnCtx.fillText('GRU recurrent policy', W / 2, H / 2 - 8);
  nnCtx.fillStyle = '#668';
  nnCtx.font = '10px monospace';
  nnCtx.fillText('hidden state carried across decisions (BPTT)', W / 2, H / 2 + 10);
  nnCtx.textAlign = 'left';
}

function drawNN(flat, layers) {
  _recNoteDrawn = false;  // re-arm the recurrent note if the mode switches back
  const W = nnCanvas.width, H = nnCanvas.height;
  nnCtx.clearRect(0, 0, W, H);
  const nL  = layers.length;
  const xSt = W / (nL + 1);
  const nodeR = Math.max(1.2, Math.min(7, 110 / Math.max(...layers)));
  const pos = layers.map((cnt, li) => Array.from({ length: cnt }, (_, ni) => ({
    x: xSt * (li + 1),
    y: H / 2 + (ni - (cnt - 1) / 2) * (H / (cnt + 2)) * 0.92,
  })));

  let gi = 0;
  for (let li = 0; li < nL - 1; li++) {
    const nIn = layers[li], nOut = layers[li + 1];
    for (let j = 0; j < nOut; j++) {
      for (let i = 0; i < nIn; i++) {
        const w = flat[gi++];
        const aw = Math.abs(w);
        if (aw < 0.12) continue;
        const a = Math.min(0.85, aw * 0.45);
        nnCtx.strokeStyle = w > 0 ? `rgba(70,190,255,${a})` : `rgba(255,70,70,${a})`;
        nnCtx.lineWidth   = Math.min(2, aw * 0.6 + 0.1);
        nnCtx.beginPath();
        nnCtx.moveTo(pos[li][i].x,   pos[li][i].y);
        nnCtx.lineTo(pos[li+1][j].x, pos[li+1][j].y);
        nnCtx.stroke();
      }
    }
    gi += nOut;
  }

  for (let li = 0; li < nL; li++) {
    const col = li === 0 ? '#4af' : li === nL - 1 ? '#fa4' : '#ccc';
    for (const { x, y } of pos[li]) {
      nnCtx.beginPath(); nnCtx.arc(x, y, nodeR, 0, Math.PI * 2);
      nnCtx.fillStyle = col; nnCtx.fill();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Config menu — shown between map selection and training start
// ─────────────────────────────────────────────────────────────────────────────

function netParams(hiddenLayers, hiddenSize, outDim) {
  const sizes = [OBS_DIM, ...Array(hiddenLayers).fill(hiddenSize), outDim];
  let n = 0;
  for (let i = 0; i < sizes.length - 1; i++) n += (sizes[i] + 1) * sizes[i + 1];
  return n;
}

// GRU(I→H) + linear(H→O). Recurrent mode drops the 4 memory cells, so the
// input is OBS_DIM−4 and the actor output is 2.
function gruParams(hiddenSize, inDim, outDim) {
  const H = hiddenSize, I = inDim, O = outDim;
  return 3 * H * I + 3 * H * H + 3 * H + O * H + O;
}

function updateConfigParamCount() {
  const l = simCfg.hiddenLayers, h = simCfg.hiddenSize;
  let act, crit, note;
  if (simCfg.recurrent) {
    const I = OBS_DIM - 4, O = ACT_DIM - 4;  // memory cells dropped
    act  = gruParams(h, I, O);
    crit = gruParams(h, I, 1);
    note = ' · GRU recurrent';
  } else {
    act  = netParams(l, h, ACT_DIM);
    crit = netParams(l, h, 1);
    note = '';
  }
  document.getElementById('configParamCount').textContent =
    `${(act + crit).toLocaleString()} total parameters  (actor ${act.toLocaleString()} · critic ${crit.toLocaleString()})${note}`;
}

function makeOptBtnGroup(containerId, options, key, onChange) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  for (const { label, val } of options) {
    const b = document.createElement('button');
    b.className = 'opt-btn' + (simCfg[key] === val ? ' sel' : '');
    b.textContent = label || val;
    b.dataset.val = val;
    b.addEventListener('click', () => {
      simCfg[key] = val;
      wrap.querySelectorAll('.opt-btn').forEach(el => el.classList.toggle('sel', el.dataset.val === String(val)));
      onChange && onChange(val);
    });
    wrap.appendChild(b);
  }
}

function wireConfigSlider(sliderId, valId, key, fmtFn) {
  const sl = document.getElementById(sliderId), vl = document.getElementById(valId);
  sl.value = simCfg[key];
  vl.textContent = fmtFn ? fmtFn(simCfg[key]) : simCfg[key];
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    simCfg[key] = v;
    vl.textContent = fmtFn ? fmtFn(v) : v;
  });
}

// Build the car picker: one button per car, plus a stat readout that updates
// when the selection changes. Picking a new car also rebuilds the on-screen
// meshes so the preview matches the choice before training starts.
function updateCarInfo() {
  const el = document.getElementById('configCarInfo');
  if (!el) return;
  const c = carSpec();
  const s = c.stats || {};
  el.innerHTML =
    `<span style="color:${c.hex}">${c.name}</span> — ${c.desc || ''}` +
    `<br>SPEED ${s.s ?? '–'} · ACCEL ${s.a ?? '–'} · HANDLING ${s.h ?? '–'}`;
}

function initCarPicker() {
  const wrap = document.getElementById('configCarBtns');
  if (!wrap) return;
  wrap.innerHTML = '';
  CARS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'opt-btn' + (i === selectedCarIdx ? ' sel' : '');
    b.textContent = c.name;
    b.dataset.idx = i;
    b.style.borderColor = i === selectedCarIdx ? c.hex : '';
    b.addEventListener('click', () => {
      selectedCarIdx = i;
      wrap.querySelectorAll('.opt-btn').forEach(el => {
        const sel = el.dataset.idx === String(i);
        el.classList.toggle('sel', sel);
        el.style.borderColor = sel ? c.hex : '';
      });
      updateCarInfo();
      if (workerReady) rebuildCarMeshes(simCfg.numEnvs);
    });
    wrap.appendChild(b);
  });
  updateCarInfo();
}

function initConfigMenu() {
  initCarPicker();

  makeOptBtnGroup('configGroupBtns',
    [{ label: 'OFF', val: 1 }, { label: '×2', val: 2 }, { label: '×4', val: 4 }, { label: '×8', val: 8 }],
    'groupSize');

  makeOptBtnGroup('configLayerBtns',
    [{ val: 1 }, { val: 2 }, { val: 3 }],
    'hiddenLayers', () => updateConfigParamCount());

  makeOptBtnGroup('configUnitBtns',
    [{ val: 32 }, { val: 64 }, { val: 128 }, { val: 256 }],
    'hiddenSize', () => updateConfigParamCount());

  makeOptBtnGroup('configHorizonBtns',
    [{ label: '256', val: 256 }, { label: '512', val: 512 }, { label: '1024', val: 1024 }],
    'horizon');

  makeOptBtnGroup('configBackendBtns',
    [{ label: 'AUTO', val: 'auto' }, { label: 'GPU', val: 'gpu' },
     { label: 'WASM', val: 'wasm' }, { label: 'JS', val: 'js' }],
    'backend');

  wireConfigSlider('configAgentSlider',  'configAgentVal',  'numEnvs',  v => Math.round(v) + ' agents');
  wireConfigSlider('configThreadSlider', 'configThreadVal', 'threads',  v => Math.round(v) + ' threads');
  wireConfigSlider('configEpLenSlider',  'configEpLenVal',  'episodeLen', v => v + 's');
  wireConfigSlider('configLrSlider',     'configLrVal',     'lr',        v => v.toExponential(1));
  wireConfigSlider('configEntSlider',    'configEntVal',    'entropyCoef', v => v.toFixed(4));

  const spawnTog = document.getElementById('configSpawnToggle');
  spawnTog.checked = simCfg.randomSpawn;
  spawnTog.addEventListener('change', () => { simCfg.randomSpawn = spawnTog.checked; });

  const recTog = document.getElementById('configRecurrentToggle');
  if (recTog) {
    recTog.checked = simCfg.recurrent;
    recTog.addEventListener('change', () => {
      simCfg.recurrent = recTog.checked;
      updateConfigParamCount();
    });
  }

  const mtTog = document.getElementById('configMultiTrackToggle');
  if (mtTog) {
    mtTog.checked = simCfg.multiTrack;
    mtTog.addEventListener('change', () => { simCfg.multiTrack = mtTog.checked; });
  }

  document.getElementById('configBackBtn').addEventListener('click', () => {
    hideConfigMenu(); showMapMenu();
  });
  document.getElementById('configStartBtn').addEventListener('click', startFromConfigMenu);

  updateConfigParamCount();
}

function showConfigMenu() {
  document.getElementById('configMenu').style.display = 'flex';
  updateConfigParamCount();
}

function hideConfigMenu() {
  document.getElementById('configMenu').style.display = 'none';
}

function startFromConfigMenu() {
  // groups need a whole number of groups — snap the agent count
  const G = simCfg.groupSize | 0;
  if (G > 1) {
    simCfg.numEnvs = Math.max(G, Math.round(simCfg.numEnvs / G) * G);
  }
  hideConfigMenu();
  sendInit();
  setTimeout(() => {
    if (workerReady) { worker.postMessage({ type: 'start' }); simRunning = true; updateStartBtn(); }
  }, 80);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Map selection menu
// ─────────────────────────────────────────────────────────────────────────────
let selectedTrackIdx = 0;

function showMapMenu() {
  if (simRunning) { worker.postMessage({ type: 'stop' }); simRunning = false; updateStartBtn(); }
  renderMapCards();
  document.getElementById('mapMenu').style.display = 'flex';
}

function hideMapMenu() { document.getElementById('mapMenu').style.display = 'none'; }

function renderMapCards() {
  const wrap = document.getElementById('mapCards');
  wrap.innerHTML = '';
  trackList.forEach((t, i) => {
    const d = t.data;
    const card = document.createElement('div');
    card.className = 'map-card' + (i === selectedTrackIdx ? ' sel' : '');
    card.innerHTML = `
      <div class="map-card-swatch" style="background:${d.previewColor || '#44aaff'}"></div>
      <div class="map-card-name">${d.name || t.filename}</div>
      <div class="map-card-desc">${d.desc || ''}</div>
      <div class="map-card-meta">${d.type === 'city' ? '🏙 City' : '🏁 Circuit'} · ${d.laps || 3} laps · road ${d.rw || 12}m</div>`;
    card.addEventListener('click', () => {
      selectedTrackIdx = i;
      wrap.querySelectorAll('.map-card').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
    });
    wrap.appendChild(card);
  });
}

function selectMapAndConfigure() {
  const entry = trackList[selectedTrackIdx];
  if (!entry) return;
  hideMapMenu();
  applyTrack(entry.data);
  updateTrackView();
  showConfigMenu();
}

// Refresh the HUD track label + the "view next track" button for the current
// mode. In multi-track mode the label shows which of the N maps is on screen
// and the button (which only cycles the *view*, not the training) is revealed.
function updateTrackView() {
  const multi = simCfg.multiTrack && trackList.length > 1;
  const btn = document.getElementById('viewTrackBtn');
  if (btn) btn.style.display = multi ? '' : 'none';
  const entry = trackList[selectedTrackIdx];
  if (!entry) return;
  const name = entry.data.name || entry.filename;
  document.getElementById('hudTrack').textContent =
    multi ? `${name} · ${selectedTrackIdx + 1}/${trackList.length} · ALL` : name;
}

// ─────────────────────────────────────────────────────────────────────────────
//  In-trainer controls sidebar
// ─────────────────────────────────────────────────────────────────────────────
function wireSlider(sliderId, valId, key, fmtFn, editable) {
  const sl = document.getElementById(sliderId);
  const vl = document.getElementById(valId);
  sl.value = simCfg[key];
  vl.textContent = fmtFn ? fmtFn(simCfg[key]) : simCfg[key];

  // Apply a value from any source: store it, sync the slider (it clamps to its
  // own min/max, but simCfg keeps the real value so typed values can exceed it).
  const apply = (v) => {
    simCfg[key] = v;
    sl.value = v;
    vl.textContent = fmtFn ? fmtFn(v) : v;
    if (worker) worker.postMessage({ type: 'setConfig', config: { [key]: v } });
  };

  sl.addEventListener('input', () => apply(parseFloat(sl.value)));

  // Click the value to type any number directly — not limited to the slider range.
  if (editable) {
    vl.title = 'Click to type any value';
    vl.contentEditable = 'true';
    vl.addEventListener('focus', () => {
      vl.textContent = String(simCfg[key]);
      const r = document.createRange(); r.selectNodeContents(vl);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    });
    vl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); vl.blur(); }
    });
    vl.addEventListener('blur', () => {
      const v = parseFloat(vl.textContent);
      if (isFinite(v)) apply(Math.max(0, v));
      else vl.textContent = fmtFn ? fmtFn(simCfg[key]) : simCfg[key];
    });
  }
}

function initUI() {
  document.getElementById('mapsBtn').addEventListener('click', showMapMenu);
  document.getElementById('mapStartBtn').addEventListener('click', selectMapAndConfigure);

  // Multi-track only: cycle which map is on screen without touching training,
  // which keeps running across every track underneath.
  const viewBtn = document.getElementById('viewTrackBtn');
  if (viewBtn) viewBtn.addEventListener('click', () => {
    if (trackList.length < 2) return;
    selectedTrackIdx = (selectedTrackIdx + 1) % trackList.length;
    applyTrack(trackList[selectedTrackIdx].data);
    updateTrackView();
  });
  document.getElementById('mapBackBtn').addEventListener('click', () => { window.location.href = '../index.html'; });

  initConfigMenu();

  wireSlider('speedSlider',   'speedVal',   'speedMult',       v => v + '×');
  wireSlider('lrSlider',      'lrVal',      'lr',              v => v.toExponential(1));
  wireSlider('entSlider',     'entVal',     'entropyCoef',     v => v.toFixed(4));
  wireSlider('epLenSlider',   'epLenVal',   'episodeLen',      v => v + 's');
  wireSlider('failSlider',    'failVal',    'failRate',        v => Math.round(v * 100) + '%');

  // live PPO-mod toggles
  const wireToggle = (id, key) => {
    const el = document.getElementById(id);
    el.checked = simCfg[key];
    el.addEventListener('change', () => {
      simCfg[key] = el.checked;
      if (worker) worker.postMessage({ type: 'setConfig', config: { [key]: el.checked } });
    });
  };
  wireToggle('mirrorToggle', 'mirror');
  wireToggle('klToggle', 'klStop');
  wireToggle('repairToggle', 'neuronRepair');

  document.getElementById('repairNowBtn').addEventListener('click', () => {
    if (worker) worker.postMessage({ type: 'repairNow' });
  });
  wireSlider('progSlider',    'progVal',    'progressReward',  v => v.toFixed(2), true);
  wireSlider('gravelSlider',  'gravelVal',  'gravelPenalty',   v => v.toFixed(1), true);
  wireSlider('wallHitSlider', 'wallHitVal', 'wallHitPenalty',  v => Math.round(v), true);
  wireSlider('wallSlider',    'wallVal',    'wallPenalty',     v => v.toFixed(1), true);
  wireSlider('termSlider',    'termVal',    'terminalPenalty', v => Math.round(v), true);
  wireSlider('lapBonusSlider','lapBonusVal','lapBonus',        v => Math.round(v), true);

  document.getElementById('loadBestBtn').addEventListener('click', () => {
    if (worker) worker.postMessage({ type: 'loadBest' });
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    if (!workerReady) return;
    simRunning = !simRunning;
    worker.postMessage({ type: simRunning ? 'start' : 'stop' });
    updateStartBtn();
  });

  document.getElementById('restartBtn').addEventListener('click', () => {
    if (!workerReady) return;
    simRunning = false; updateStartBtn();
    sendInit();
    setTimeout(() => { worker.postMessage({ type: 'start' }); simRunning = true; updateStartBtn(); }, 80);
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!workerReady) return;
    const was = simRunning; simRunning = false;
    sendInit(null);
    setTimeout(() => { if (was) { worker.postMessage({ type: 'start' }); simRunning = true; } updateStartBtn(); }, 80);
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    if (worker) worker.postMessage({ type: 'exportModel' });
  });

  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async function () {
    if (!this.files[0]) return;
    try {
      const model = JSON.parse(await this.files[0].text());
      if ((model.algo !== 'ppo' && model.algo !== 'ppo-gru') || !model.actor || !model.critic)
        throw new Error('Not a PPO model — older genetic trainer exports are not compatible');
      // Match the network architecture to the imported model. A recurrent
      // (GRU) export only loads when the worker is built in recurrent mode, so
      // align simCfg + the UI toggle to the model's algo before re-init.
      simCfg.recurrent = (model.algo === 'ppo-gru');
      const recTog = document.getElementById('configRecurrentToggle');
      if (recTog) recTog.checked = simCfg.recurrent;
      updateConfigParamCount();
      const was = simRunning; simRunning = false;
      sendInit(model);
      setTimeout(() => { if (was) { worker.postMessage({ type: 'start' }); simRunning = true; } updateStartBtn(); }, 80);
    } catch (err) { alert('Import failed: ' + err.message); }
    this.value = '';
  });

  document.getElementById('backBtn').addEventListener('click', () => { window.location.href = '../index.html'; });

  document.getElementById('rewardsToggle').addEventListener('click', function () {
    const p = document.getElementById('rewardsPanel');
    const show = p.style.display === 'none';
    p.style.display = show ? '' : 'none';
    this.textContent = (show ? '▼' : '▶') + ' REWARDS & PENALTIES';
  });
}

function updateStartBtn() {
  const btn = document.getElementById('startBtn');
  btn.textContent = simRunning ? '⏹ STOP' : '▶ START';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Render loop
// ─────────────────────────────────────────────────────────────────────────────
function renderLoop() {
  requestAnimationFrame(renderLoop);
  applyOrbitCamera(null);
  renderer.render(SCENE, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────────────────
async function boot() {
  initUI();
  mkWorker();
  try {
    await loadTrackIndex();
    if (!trackList.length) throw new Error('No tracks found');
    showMapMenu();
  } catch (err) {
    console.error('Boot error:', err);
    document.getElementById('mapMenuTitle').textContent = 'TRACK LOAD ERROR';
    document.getElementById('mapCards').innerHTML = `<div style="color:#f66;font-size:.8rem;">${err.message}</div>`;
    document.getElementById('mapMenu').style.display = 'flex';
  }
  renderLoop();
}

boot();
