'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  perf-bench.js — in-page half of the AI-trainer benchmark.
//
//  Loads a real track through the game's own track-gen, serializes it exactly
//  the way trainer-app.js does, then drives sim-worker.js through N policy
//  updates ("generations") per config while the worker's phase profiler
//  (cfg.perf) accumulates where the time goes.
//
//  Driven from Node by perf-bench.mjs; open the page by hand and it runs a
//  short default sweep so the harness is usable without Playwright.
// ─────────────────────────────────────────────────────────────────────────────
import { buildTrack } from '../../turborace/scripts/track-gen.js';
import { CARS }       from '../../turborace/scripts/data/cars.js';
import { state }      from '../../turborace/scripts/state.js';

const TRACKS_BASE = '../../turborace/tracks/';
const logEl = document.getElementById('log');
const log = m => { logEl.textContent += '\n' + m; console.log(m); };

// ── Track loading (mirrors trainer-app.js) ──────────────────────────────────
async function loadTrack(name) {
  const filenames = await fetch(TRACKS_BASE + 'index.json').then(r => r.json());
  const file = filenames.find(f => f.replace(/\.json$/, '') === name) ||
               filenames.find(f => f.toLowerCase().includes(name.toLowerCase()));
  if (!file) throw new Error(`track "${name}" not in index.json (${filenames.join(', ')})`);
  const data = await fetch(TRACKS_BASE + file).then(r => r.json());
  buildTrack(data);
  return data;
}

// Byte-for-byte the payload trainer-app.js ships to the worker.
function serializeTrackFromState() {
  return {
    pts:       state.trkPts.map(p => ({ x: p.x, y: p.y, z: p.z })),
    wallLeft:  (state.trkWallLeft  || []).map(w => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1 })),
    wallRight: (state.trkWallRight || []).map(w => ({ x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1 })),
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

// ── Config defaults: the trainer's own menu defaults (trainer-app.js simCfg) ─
const BASE_CFG = {
  hiddenLayers: 1, hiddenSize: 64,
  recurrent: false, bpttLen: 32,
  backend: 'js', threads: 1,
  numEnvs: 8, speedMult: 200, episodeLen: 60, randomSpawn: true, multiTrack: false,
  lr: 3e-4, entropyCoef: 0.003, horizon: 512, epochs: 6, minibatch: 256,
  groupSize: 1, mirror: false, klStop: true, neuronRepair: false, failRate: 0,
  progressReward: 0.2, gravelPenalty: 1.0, wallPenalty: 2.0,
  wallHitPenalty: 50, terminalPenalty: 10, lapBonus: 20,
};

// ── One benchmark run ───────────────────────────────────────────────────────
//  Runs until `gens` policy updates have completed, taking a profiler window
//  per generation. Returns wall-clock, throughput and the phase breakdown.
function runConfig({ label, cfg, gens = 3, track, carIdx = 0, perf = true, timeoutMs = 300000 }) {
  return new Promise((resolve, reject) => {
    const car = CARS[carIdx] || CARS[0];
    const carData = { accel: car.accel, maxSpd: car.maxSpd, brake: car.brake, hdl: car.hdl, aiSpd: car.aiSpd || 1.0 };
    const full = { ...BASE_CFG, ...cfg, perf };

    const worker = new Worker(new URL('../scripts/sim-worker.js', import.meta.url), { type: 'module' });
    const out = {
      label, gens, config: full, generations: [], total: null,
      ready: null, error: null, frames: 0,
    };
    let t0 = 0, tGen = 0, seen = 0, done = false, pending = null;

    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { worker.postMessage({ type: 'stop' }); } catch { /* already gone */ }
      try { worker.terminate(); } catch { /* already gone */ }
      if (err) reject(err); else resolve(out);
    };
    const timer = setTimeout(() => finish(new Error(`${label}: timed out after ${timeoutMs} ms`)), timeoutMs);

    worker.onerror = e => finish(new Error(`${label}: worker error — ${e.message || e}`));
    worker.onmessage = e => {
      const d = e.data;

      if (d.type === 'ready') {
        out.ready = { obsDim: d.obsDim, actorSizes: d.actorSizes, numEnvs: d.numEnvs, gradThreads: d.gradThreads };
        // Start the profiler window at 'start' so worker/pool construction
        // and track indexing stay out of the per-generation numbers.
        t0 = tGen = performance.now();
        worker.postMessage({ type: 'perf', on: perf, reset: true, tag: 'prime' });
        worker.postMessage({ type: 'start' });
        return;
      }

      if (d.type === 'frame') {
        out.frames++;
        if (d.iteration > seen && !pending) {
          // a generation completed — close this profiler window and open the next
          seen = d.iteration;
          pending = { gen: seen, wall: performance.now() - tGen };
          tGen = performance.now();
          worker.postMessage({ type: 'perf', reset: true, tag: 'gen' + seen });
        }
        return;
      }

      if (d.type === 'perfStats') {
        if (d.tag === 'prime') return;   // window opener, not a generation
        const rec = {
          gen: pending ? pending.gen : seen,
          wallMs: pending ? pending.wall : performance.now() - tGen,
          workerWallMs: d.wall,
          ms: d.ms, n: d.n,
          totalSteps: d.totalSteps, episodes: d.episodes,
          gradThreads: d.gradThreads, wasm: d.wasm, wasmErr: d.wasmErr,
          gpuState: d.gpuState, gpuInfo: d.gpuInfo,
          obsDim: d.obsDim, actorSizes: d.actorSizes,
        };
        pending = null;
        out.generations.push(rec);
        if (rec.gen >= gens) {
          out.total = {
            wallMs: performance.now() - t0,
            totalSteps: d.totalSteps,
            episodes: d.episodes,
            gradThreads: d.gradThreads,
            wasm: d.wasm, wasmErr: d.wasmErr,
            gpuState: d.gpuState, gpuInfo: d.gpuInfo,
          };
          finish(null);
        }
        return;
      }

      if (d.type === 'error') finish(new Error(`${label}: ${d.message}`));
    };

    worker.postMessage({
      type: 'init', track, tracks: [track], carData, config: full,
    });
  });
}

// ── Public entry point (called from Playwright) ─────────────────────────────
let trackPayload = null;
let trackMeta = null;

async function prepare(trackName) {
  const data = await loadTrack(trackName);
  trackPayload = serializeTrackFromState();
  trackMeta = {
    name: data.name, file: trackName, laps: data.laps, roadWidth: data.rw,
    centerlinePts: trackPayload.pts.length,
    wallSegs: trackPayload.wallLeft.length + trackPayload.wallRight.length,
    gravel: !!trackPayload.gravelProfile,
  };
  return trackMeta;
}

window.__bench = {
  prepare,
  meta: () => trackMeta,
  run: opts => runConfig({ ...opts, track: trackPayload }),
};

// Standalone (no Playwright): prepare jeff and report readiness.
prepare('jeff')
  .then(m => { logEl.textContent = 'ready — ' + JSON.stringify(m); window.__benchReady = true; })
  .catch(err => { logEl.textContent = 'FAILED: ' + err.message; window.__benchError = String(err); });

export { runConfig, prepare, log };
