'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  AI Trainer — Main Thread
//
//  Handles Three.js rendering + UI.  All physics/AI runs in sim-worker.js.
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
// ─────────────────────────────────────────────────────────────────────────────
const TRACKS_BASE = '../../turborace/tracks/';
let trackList = [];

async function loadTrackIndex() {
  // index.json is an array of filenames: ["monaco-streets.json", ...]
  const filenames = await fetch(TRACKS_BASE + 'index.json').then(r => r.json());
  trackList = filenames.map(fn => ({
    filename: fn,
    name: fn.replace('.json', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));
  const sel = document.getElementById('trackSelect');
  sel.innerHTML = '';
  for (const t of trackList) {
    const opt = document.createElement('option');
    opt.value = t.filename; opt.textContent = t.name;
    sel.appendChild(opt);
  }
  if (trackList.length) await applyTrack(trackList[0].filename);
}

async function applyTrack(filename) {
  const data = await fetch(TRACKS_BASE + filename).then(r => r.json());

  // Populate state.trkData (buildTrack only handles geometry, not the data reference)
  state.trkData = data;

  // buildTrack populates state.trkPts, state.trkWallLeft, state.trkWallRight,
  // state.gravelProfile, and adds 3D objects to state.scene (= SCENE).
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
    const alpha = c.offTrack ? 0.22 : 1.0;
    m.traverse(o => {
      if (!o.isMesh || !o.material) return;
      o.material.opacity = alpha;
      o.material.transparent = c.offTrack;
      if (o.material.emissive && i === bestIdx && !c.offTrack) {
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
  let bi = -1, bf = -Infinity;
  for (let i = 0; i < cars.length; i++) {
    if (!cars[i].offTrack && cars[i].fitness > bf) { bf = cars[i].fitness; bi = i; }
  }
  return bi < 0 ? 0 : bi;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Worker
// ─────────────────────────────────────────────────────────────────────────────
let worker     = null;
let workerReady = false;
let simRunning  = false;

const simCfg = {
  popSize: 8,
  genDuration: 35,
  speedMult: 1,
  mutRate: 0.15,
  mutStrength: 0.35,
  onTrackRewardRate: 0.10,
  stuckPenaltyRate: 5.0,
  gravelPenaltyBase: 0.5,
  gravelGrowthRate: 0.30,
  offTrackMult: 10,
  offTrackDQTime: 3.0,
  dqPenalty: 200,
  hiddenLayers: 1,
  nodesPerLayer: 5,
  lapMode: false,
};

function mkWorker() {
  if (worker) { worker.terminate(); worker = null; }
  worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onMsg;
  worker.onerror   = err => console.error('[sim-worker]', err);
  workerReady = false;
}

function sendInit(seedGenome = null, forceRandom = false) {
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
  };
  worker.postMessage({ type: 'init', track, carData, config: { ...simCfg }, seedGenome, forceRandom });
}

function onMsg(e) {
  const d = e.data;
  if (d.type === 'ready') {
    workerReady = true;
    rebuildCarMeshes(simCfg.popSize);
    refreshHUD({ generation: 0, genTime: 0, genDuration: simCfg.genDuration, bestFitness: -Infinity, avgFitness: 0 });
    updateStartBtn();
    return;
  }
  if (d.type === 'frame') {
    lastCars = d.cars || [];
    const bi  = bestCarIndex(lastCars);
    syncCarMeshes(lastCars, bi);
    if (lastCars[bi]) applyOrbitCamera(lastCars[bi]);
    refreshHUD(d);
    if (d.bestGenome && d.layers) drawNN(d.bestGenome, d.layers);
    return;
  }
  if (d.type === 'modelExport' && d.model) {
    const blob = new Blob([JSON.stringify(d.model, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ai-trainer-model.json'; a.click();
    URL.revokeObjectURL(url);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────────────
function fmt(v) { return Number.isFinite(v) && v > -1e9 ? v.toFixed(1) : '—'; }

function refreshHUD(d) {
  const { generation = 0, genTime = 0, genDuration = 35, bestFitness = -Infinity, avgFitness = 0 } = d;
  document.getElementById('hudGen').textContent   = 'GEN ' + generation;
  document.getElementById('hudBest').textContent  = 'BEST ' + fmt(bestFitness);
  document.getElementById('hudAvg').textContent   = 'AVG '  + fmt(avgFitness);
  document.getElementById('hudTime').textContent  = Math.max(0, genDuration - genTime).toFixed(1) + 's';
  document.getElementById('genBar').style.width   = (Math.min(1, genTime / Math.max(1, genDuration)) * 100).toFixed(1) + '%';

  if (lastCars.length) {
    const sorted = lastCars.map((c, i) => ({ ...c, i })).sort((a, b) => b.fitness - a.fitness);
    document.getElementById('lbRows').innerHTML = sorted.slice(0, 8).map((c, r) => `
      <div class="lb-row" style="opacity:${c.offTrack ? 0.35 : 1}">
        <span class="lb-rank">${r + 1}</span>
        <span class="lb-fit">${fmt(c.fitness)}</span>
        <span class="lb-spd">${(c.spd * 3.6).toFixed(0)}km/h</span>
        <span class="lb-flag">${c.offTrack ? '🚫' : c.finished ? '🏁' : ''}</span>
      </div>`).join('');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Neural network visualiser
// ─────────────────────────────────────────────────────────────────────────────
const nnCanvas = document.getElementById('nnCanvas');
const nnCtx    = nnCanvas.getContext('2d');

function drawNN(genome, layers) {
  const W = nnCanvas.width, H = nnCanvas.height;
  nnCtx.clearRect(0, 0, W, H);
  const nL  = layers.length;
  const xSt = W / (nL + 1);
  const nodeR = Math.max(2, Math.min(7, 55 / Math.max(...layers)));

  // Build node positions
  const pos = layers.map((cnt, li) => Array.from({ length: cnt }, (_, ni) => ({
    x: xSt * (li + 1),
    y: H / 2 + (ni - (cnt - 1) / 2) * (H / (cnt + 2)) * 0.82,
  })));

  // Draw connections with weight-based colour
  let gi = 0;
  for (let li = 0; li < nL - 1; li++) {
    const nIn = layers[li], nOut = layers[li + 1];
    for (let j = 0; j < nOut; j++) {
      for (let i = 0; i < nIn; i++) {
        const w = genome[gi++];
        const a = Math.min(0.9, Math.abs(w) * 0.3);
        nnCtx.strokeStyle = w > 0 ? `rgba(70,190,255,${a})` : `rgba(255,70,70,${a})`;
        nnCtx.lineWidth   = Math.min(2.5, Math.abs(w) * 0.5 + 0.15);
        nnCtx.beginPath();
        nnCtx.moveTo(pos[li][i].x,   pos[li][i].y);
        nnCtx.lineTo(pos[li+1][j].x, pos[li+1][j].y);
        nnCtx.stroke();
      }
      gi++; // bias
    }
  }

  // Draw nodes
  for (let li = 0; li < nL; li++) {
    const col = li === 0 ? '#4af' : li === nL - 1 ? '#fa4' : '#ccc';
    for (const { x, y } of pos[li]) {
      nnCtx.beginPath();
      nnCtx.arc(x, y, nodeR, 0, Math.PI * 2);
      nnCtx.fillStyle = col;
      nnCtx.fill();
      nnCtx.strokeStyle = '#122';
      nnCtx.lineWidth = 1;
      nnCtx.stroke();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI wiring
// ─────────────────────────────────────────────────────────────────────────────
function wireSlider(sliderId, valId, key, fmtFn) {
  const sl = document.getElementById(sliderId);
  const vl = document.getElementById(valId);
  sl.value = simCfg[key];
  vl.textContent = fmtFn ? fmtFn(simCfg[key]) : simCfg[key];
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    simCfg[key] = v;
    vl.textContent = fmtFn ? fmtFn(v) : v;
    if (worker) worker.postMessage({ type: 'setConfig', config: { [key]: v } });
  });
}

function initUI() {
  document.getElementById('trackSelect').addEventListener('change', async e => {
    const was = simRunning;
    if (was) { worker.postMessage({ type: 'stop' }); simRunning = false; }
    await applyTrack(e.target.value); // value is filename like "monaco-streets.json"
    sendInit();
    if (was) { worker.postMessage({ type: 'start' }); simRunning = true; }
    updateStartBtn();
  });

  wireSlider('speedSlider',   'speedVal',   'speedMult',        v => v + '×');
  wireSlider('genDurSlider',  'genDurVal',  'genDuration',      v => v + 's');
  wireSlider('mutRateSlider', 'mutRateVal', 'mutRate',          v => v.toFixed(2));
  wireSlider('mutStrSlider',  'mutStrVal',  'mutStrength',      v => v.toFixed(2));
  wireSlider('onTrackSlider', 'onTrackVal', 'onTrackRewardRate',v => v.toFixed(2));
  wireSlider('stuckSlider',   'stuckVal',   'stuckPenaltyRate', v => v.toFixed(1));
  wireSlider('dqPenSlider',   'dqPenVal',   'dqPenalty',        v => Math.round(v));

  // popSize doesn't live-update the worker (requires restart)
  const popSl = document.getElementById('popSlider');
  const popVl = document.getElementById('popVal');
  popSl.value = simCfg.popSize; popVl.textContent = simCfg.popSize;
  popSl.addEventListener('input', () => { simCfg.popSize = parseInt(popSl.value); popVl.textContent = popSl.value; });

  document.getElementById('lapModeToggle').addEventListener('change', function () {
    simCfg.lapMode = this.checked;
    if (worker) worker.postMessage({ type: 'setConfig', config: { lapMode: simCfg.lapMode } });
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
    sendInit(null, true);
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
      if (!Array.isArray(model.genome) || !Array.isArray(model.layers)) throw new Error('Invalid model JSON');
      const was = simRunning; simRunning = false;
      sendInit(model.genome, false);
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
    await loadTrackIndex();     // builds track → populates state.trkPts etc.
    sendInit();                 // ship track data to worker
  } catch (err) {
    console.error('Boot error:', err);
    document.getElementById('hudGen').textContent = 'TRACK LOAD ERROR';
  }
  renderLoop();
}

boot();
