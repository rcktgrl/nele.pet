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
// state.js is a side-effect import — it creates state.scene, state.trkPts, etc.
import { state, scene as trState }  from '../../turborace/scripts/state.js';

// state.scene is the Three.js scene that track-gen writes into; render that.
const SCENE = state.scene || trState;

// ─────────────────────────────────────────────────────────────────────────────
//  Renderer + camera (overhead orbit)
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

// Ambient + directional lights
const ambLight = new THREE.AmbientLight(0xffffff, 0.55);
SCENE.add(ambLight);
const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
dirLight.position.set(80, 160, 60);
dirLight.castShadow = true;
SCENE.add(dirLight);

// ─────────────────────────────────────────────────────────────────────────────
//  Orbit camera control
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
//  Track selection
//  NOTE: fetch() resolves against the page URL (games/ai-trainer/index.html),
//  NOT this module's URL — so the path needs exactly one "../".
// ─────────────────────────────────────────────────────────────────────────────
const TRACKS_BASE = '../turborace/tracks/';
let trackList = [];   // [{filename, data}] — full track JSON, used by the menu cards

async function loadTrackIndex() {
  // index.json is an array of filenames: ["monaco-streets.json", ...]
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
  // Populate state.trkData (buildTrack only handles geometry, not the data reference)
  state.trkData = data;

  // buildTrack populates state.trkPts, state.trkWallLeft, state.trkWallRight,
  // state.gravelProfile, state.cityCorridors/cityAiPts and adds 3D objects to SCENE.
  buildTrack(data);

  // Centre orbit on track centroid
  if (state.trkPts && state.trkPts.length) {
    let sx = 0, sz = 0;
    for (const p of state.trkPts) { sx += p.x; sz += p.z; }
    orbit.tx = sx / state.trkPts.length;
    orbit.tz = sz / state.trkPts.length;
    orbit.ty = 0;
    orbit.dist = 120;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Car meshes (Three.js visualisation of worker-computed positions)
// ─────────────────────────────────────────────────────────────────────────────
const CAR_SPEC = CARS[0]; // Viper GT
let carMeshes = [];
let carWheelGroups = [];

function rebuildCarMeshes(count) {
  for (const m of carMeshes) SCENE.remove(m);
  carMeshes = []; carWheelGroups = [];
  for (let i = 0; i < count; i++) {
    const v = createCarVisual(CAR_SPEC);
    SCENE.add(v.mesh);
    carMeshes.push(v.mesh);
    carWheelGroups.push(v.wheels || []);
  }
}

let lastCars = [];
const FIXED_DT = 1 / 60;

function syncCarMeshes(cars, bestIdx) {
  for (let i = 0; i < carMeshes.length && i < cars.length; i++) {
    const c = cars[i], m = carMeshes[i];
    m.position.set(c.x, c.y, c.z);
    m.rotation.y = c.hdg;
    m.traverse(o => {
      if (!o.isMesh || !o.material) return;
      if (o.material.emissive && i === bestIdx) {
        o.material.emissive.setHex(0x001530);
      } else if (o.material.emissive) {
        o.material.emissive.setHex(0x000000);
      }
    });
    for (const wg of carWheelGroups[i] || []) {
      if (wg.children[0]) wg.children[0].rotation.x += c.spd * FIXED_DT * 2.2;
    }
  }
}

function bestCarIndex(cars) {
  let bi = 0, bf = -Infinity;
  for (let i = 0; i < cars.length; i++) {
    if (cars[i].ret > bf) { bf = cars[i].ret; bi = i; }
  }
  return bi;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Worker
// ─────────────────────────────────────────────────────────────────────────────
let worker     = null;
let workerReady = false;
let simRunning  = false;

const simCfg = {
  // environment
  numEnvs: 8,            // restart required
  speedMult: 1,
  episodeLen: 60,
  randomSpawn: true,
  // PPO
  lr: 3e-4,
  entropyCoef: 0.003,
  // rewards (live)
  progressReward: 0.2,
  gravelPenalty: 1.0,
  wallPenalty: 2.0,
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

function sendInit(model = null) {
  if (!worker || !state.trkPts || !state.trkPts.length) return;
  const carData = {
    accel: CAR_SPEC.accel, maxSpd: CAR_SPEC.maxSpd,
    brake: CAR_SPEC.brake, hdl: CAR_SPEC.hdl, aiSpd: CAR_SPEC.aiSpd || 1.0,
  };
  const track = {
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
      ? state.cityCorridors.map(c => ({ x: c.x, z: c.z, hw: c.hw, hd: c.hd }))
      : null,
    cityAiPts: state.cityAiPts
      ? { pts: state.cityAiPts.pts.map(p => ({ x: p.x, z: p.z })) }
      : null,
  };
  worker.postMessage({ type: 'init', track, carData, config: { ...simCfg }, model });
}

function onMsg(e) {
  const d = e.data;
  if (d.type === 'ready') {
    workerReady = true;
    rebuildCarMeshes(d.numEnvs || simCfg.numEnvs);
    refreshHUD({ iteration: 0, totalSteps: 0, bufferFill: 0, avgReturn: 0, bestLap: null });
    updateStartBtn();
    return;
  }
  if (d.type === 'frame') {
    lastCars = d.cars || [];
    const bi  = bestCarIndex(lastCars);
    syncCarMeshes(lastCars, bi);
    if (lastCars[bi]) applyOrbitCamera(lastCars[bi]);
    refreshHUD(d);
    if (d.actorFlat && d.actorSizes) drawNN(d.actorFlat, d.actorSizes);
    return;
  }
  if (d.type === 'error') {
    alert(d.message);
    return;
  }
  if (d.type === 'modelExport' && d.model) {
    const blob = new Blob([JSON.stringify(d.model, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
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
  const { iteration = 0, totalSteps = 0, bufferFill = 0, avgReturn = 0, bestLap = null } = d;
  document.getElementById('hudGen').textContent   = 'ITER ' + iteration;
  document.getElementById('hudBest').textContent  = 'RETURN ' + fmt(avgReturn);
  document.getElementById('hudAvg').textContent   = 'BEST LAP ' + fmtLap(bestLap);
  document.getElementById('hudTime').textContent  = fmtSteps(totalSteps) + ' steps';
  document.getElementById('genBar').style.width   = (Math.min(1, bufferFill) * 100).toFixed(1) + '%';

  if (d.sigma) {
    document.getElementById('hudSigma').textContent =
      'σ ' + d.sigma.map(s => s.toFixed(2)).join('/');
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
//  Neural network visualiser — draws the actor (policy) network
// ─────────────────────────────────────────────────────────────────────────────
const nnCanvas = document.getElementById('nnCanvas');
const nnCtx    = nnCanvas.getContext('2d');

function drawNN(flat, layers) {
  const W = nnCanvas.width, H = nnCanvas.height;
  nnCtx.clearRect(0, 0, W, H);
  const nL  = layers.length;
  const xSt = W / (nL + 1);
  const nodeR = Math.max(1.4, Math.min(7, 110 / Math.max(...layers)));

  const pos = layers.map((cnt, li) => Array.from({ length: cnt }, (_, ni) => ({
    x: xSt * (li + 1),
    y: H / 2 + (ni - (cnt - 1) / 2) * (H / (cnt + 2)) * 0.92,
  })));

  // Weight layout per layer: all weight rows (nOut × nIn), THEN all biases.
  // Only draw connections above a magnitude threshold — a 36×64 layer has
  // ~2300 weights and drawing them all is illegible.
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
    gi += nOut; // skip the layer's bias block
  }

  for (let li = 0; li < nL; li++) {
    const col = li === 0 ? '#4af' : li === nL - 1 ? '#fa4' : '#ccc';
    for (const { x, y } of pos[li]) {
      nnCtx.beginPath();
      nnCtx.arc(x, y, nodeR, 0, Math.PI * 2);
      nnCtx.fillStyle = col;
      nnCtx.fill();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI wiring
// ─────────────────────────────────────────────────────────────────────────────
function wireSlider(sliderId, valId, key, fmtFn, live = true) {
  const sl = document.getElementById(sliderId);
  const vl = document.getElementById(valId);
  sl.value = simCfg[key];
  vl.textContent = fmtFn ? fmtFn(simCfg[key]) : simCfg[key];
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    simCfg[key] = v;
    vl.textContent = fmtFn ? fmtFn(v) : v;
    if (live && worker) worker.postMessage({ type: 'setConfig', config: { [key]: v } });
  });
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

function hideMapMenu() {
  document.getElementById('mapMenu').style.display = 'none';
}

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

function startWithSelectedTrack() {
  const entry = trackList[selectedTrackIdx];
  if (!entry) return;
  hideMapMenu();
  applyTrack(entry.data);
  document.getElementById('hudTrack').textContent = entry.data.name || entry.filename;
  sendInit();
}

function initUI() {
  document.getElementById('mapsBtn').addEventListener('click', showMapMenu);
  document.getElementById('mapStartBtn').addEventListener('click', startWithSelectedTrack);
  document.getElementById('mapBackBtn').addEventListener('click', () => { window.location.href = '../index.html'; });

  wireSlider('speedSlider',  'speedVal',  'speedMult',      v => v + '×');
  wireSlider('lrSlider',     'lrVal',     'lr',             v => v.toExponential(1));
  wireSlider('entSlider',    'entVal',    'entropyCoef',    v => v.toFixed(4));
  wireSlider('epLenSlider',  'epLenVal',  'episodeLen',     v => v + 's');
  wireSlider('progSlider',   'progVal',   'progressReward', v => v.toFixed(2));
  wireSlider('gravelSlider', 'gravelVal', 'gravelPenalty',  v => v.toFixed(1));
  wireSlider('wallSlider',   'wallVal',   'wallPenalty',    v => v.toFixed(1));
  wireSlider('termSlider',   'termVal',   'terminalPenalty',v => Math.round(v));
  wireSlider('lapBonusSlider','lapBonusVal','lapBonus',     v => Math.round(v));

  // numEnvs doesn't live-update the worker (requires restart)
  const popSl = document.getElementById('popSlider');
  const popVl = document.getElementById('popVal');
  popSl.value = simCfg.numEnvs; popVl.textContent = simCfg.numEnvs;
  popSl.addEventListener('input', () => { simCfg.numEnvs = parseInt(popSl.value); popVl.textContent = popSl.value; });

  document.getElementById('spawnToggle').checked = simCfg.randomSpawn;
  document.getElementById('spawnToggle').addEventListener('change', function () {
    simCfg.randomSpawn = this.checked;
    if (worker) worker.postMessage({ type: 'setConfig', config: { randomSpawn: simCfg.randomSpawn } });
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    if (!workerReady) return;
    simRunning = !simRunning;
    worker.postMessage({ type: simRunning ? 'start' : 'stop' });
    updateStartBtn();
  });

  document.getElementById('restartBtn').addEventListener('click', () => {
    if (!workerReady) return;
    simRunning = false;
    sendInit();
    setTimeout(() => { worker.postMessage({ type: 'start' }); simRunning = true; updateStartBtn(); }, 50);
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!workerReady) return;
    const was = simRunning; simRunning = false;
    sendInit(null);
    setTimeout(() => {
      if (was) { worker.postMessage({ type: 'start' }); simRunning = true; }
      updateStartBtn();
    }, 50);
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    if (worker) worker.postMessage({ type: 'exportModel' });
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', async function () {
    if (!this.files[0]) return;
    try {
      const model = JSON.parse(await this.files[0].text());
      if (model.algo !== 'ppo' || !model.actor || !model.critic) {
        throw new Error('Not a PPO model export (older genetic-trainer exports are not compatible)');
      }
      const was = simRunning; simRunning = false;
      sendInit(model);
      setTimeout(() => {
        if (was) { worker.postMessage({ type: 'start' }); simRunning = true; }
        updateStartBtn();
      }, 50);
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
//  Render loop (pure rendering — no simulation here)
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
    await loadTrackIndex();     // fetch all track JSONs for the menu
    if (!trackList.length) throw new Error('No tracks found');
    showMapMenu();              // map selection menu comes first
  } catch (err) {
    console.error('Boot error:', err);
    document.getElementById('mapMenuTitle').textContent = 'TRACK LOAD ERROR';
    document.getElementById('mapCards').innerHTML =
      `<div style="color:#f66;font-size:.8rem;">${err.message}</div>`;
    document.getElementById('mapMenu').style.display = 'flex';
  }
  renderLoop();
}

boot();
