'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  sim-smoke.mjs — end-to-end smoke test of the REAL sim-worker.js in Node.
//
//  Run:  node games/ai-trainer/test/sim-smoke.mjs
//
//  Drives the worker protocol on a synthetic circular track. Nested Workers
//  don't exist in Node, so PPO's gradient pool fails over to the local
//  single-thread path — exactly the trainer's worst-case fallback. Checks:
//    1. ES: generations complete, stats are finite, export is actor-only.
//    2. PPO: updates complete, adaptive γ is reported (regression).
//    3. Adaptive γ: with every reward zeroed the average return stagnates by
//       construction, so γ MUST rise above its base after enough updates.
// ─────────────────────────────────────────────────────────────────────────────

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ── Worker shims (must exist before the module is imported) ─────────────────
const inbox = [];
let wakeup = null;
globalThis.self = globalThis;
globalThis.postMessage = msg => {
  inbox.push(msg);
  if (wakeup) { const w = wakeup; wakeup = null; w(); }
};

await import('../scripts/sim-worker.js');
const handler = globalThis.self.onmessage;
const send = msg => handler({ data: msg });

async function waitFor(pred, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < inbox.length; i++) {
      if (pred(inbox[i])) return inbox.splice(i, 1)[0];
    }
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise(res => {
      wakeup = res;
      setTimeout(res, 250);
    });
  }
}

// Synthetic circular track, radius 100 m, road width 16 m.
function makeTrack() {
  const N = 128, R = 100, HALF = 8;
  const pts = [], wallLeft = [], wallRight = [], wp = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R });
    wp.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    for (const [arr, r] of [[wallLeft, R - HALF], [wallRight, R + HALF]]) {
      arr.push({
        x0: pts[i].x / R * r, z0: pts[i].z / R * r,
        x1: pts[j].x / R * r, z1: pts[j].z / R * r,
      });
    }
  }
  return { pts, wallLeft, wallRight, data: { wp, rw: 16, laps: 3 } };
}

const carData = { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 };

async function runAlgo(label, config, runMs) {
  inbox.length = 0;
  send({ type: 'init', track: makeTrack(), carData, config });
  const ready = await waitFor(m => m.type === 'ready', 5000);
  check(`${label}: worker ready`, !!ready);
  if (!ready) return null;
  send({ type: 'start' });
  await new Promise(res => setTimeout(res, runMs));
  send({ type: 'getSnapshot' });
  // take the LAST frame that arrives after the deadline
  await waitFor(m => m.type === 'frame', 3000);
  let frame = null;
  for (const m of inbox) if (m.type === 'frame') frame = m;
  send({ type: 'stop' });
  return frame;
}

// ── 1. ES ────────────────────────────────────────────────────────────────────
console.log('\n1. ES end-to-end (evolution strategies)');
{
  const frame = await runAlgo('es', {
    algo: 'es', numEnvs: 8, speedMult: 200, episodeLen: 12,
    esSigma: 0.1, esLr: 0.02,
  }, 25000);

  check('frame received', !!frame);
  if (frame) {
    check('algo tagged es', frame.algo === 'es');
    check(`generations completed (${frame.iteration})`, frame.iteration > 1);
    check('fitness stats finite',
      Number.isFinite(frame.avgReturn) && Number.isFinite(frame.loss.pi) && Number.isFinite(frame.loss.v));
    check('backend is sim-only (no gradient compute)', frame.backend === 'sim');
    check('parameter σ reported', Array.isArray(frame.sigma) && frame.sigma[0] === 0.1);
    check('γ not reported for ES', frame.gamma == null);
    check(`episodes completed (${frame.episodes})`, frame.episodes > 0);
    console.log(`  steps ${frame.totalSteps} · generations ${frame.iteration} · ` +
                `gen mean ${frame.loss.pi.toFixed(1)} · gen best ${frame.loss.v.toFixed(1)}`);
  }

  inbox.length = 0;
  send({ type: 'exportModel' });
  const exp = await waitFor(m => m.type === 'modelExport', 3000);
  const m = exp && exp.model;
  check('export is an actor-only ES model',
    !!m && m.algo === 'es' && m.actor && !m.critic && !m.logStd &&
    m.actor.sizes[0] === m.obsDim &&
    m.actor.sizes[m.actor.sizes.length - 1] === m.actDim);
  check('export weights finite', !!m && m.actor.flat.every(Number.isFinite));
}

// ── 2. PPO regression ────────────────────────────────────────────────────────
console.log('\n2. PPO end-to-end (regression)');
{
  const frame = await runAlgo('ppo', {
    algo: 'ppo', numEnvs: 4, speedMult: 200, episodeLen: 15,
    backend: 'js', threads: 1, minibatch: 128, horizon: 64, epochs: 2,
  }, 20000);

  check('frame received', !!frame);
  if (frame) {
    check(`updates completed (${frame.iteration})`, frame.iteration > 0);
    check('losses finite',
      Number.isFinite(frame.loss.pi) && Number.isFinite(frame.loss.v));
    check('sigma reported', Array.isArray(frame.sigma) && Number.isFinite(frame.sigma[0]));
    check(`adaptive γ reported (${frame.gamma})`,
      Number.isFinite(frame.gamma) && frame.gamma >= 0.99 && frame.gamma <= 0.998);
  }

  inbox.length = 0;
  send({ type: 'exportModel' });
  const exp = await waitFor(m => m.type === 'modelExport', 3000);
  const m = exp && exp.model;
  check('export is a complete PPO model',
    !!m && m.algo === 'ppo' && m.actor && m.critic && Array.isArray(m.logStd));
}

// ── 3. Adaptive γ rises under stagnation ─────────────────────────────────────
//  All reward terms zeroed → every episode returns exactly 0 → the windowed
//  average cannot improve → after GAMMA_STAGNATION_UPDATES updates the live γ
//  must have been raised above its base.
console.log('\n3. Adaptive γ under forced reward stagnation');
{
  const frame = await runAlgo('ppo-stagnant', {
    algo: 'ppo', numEnvs: 4, speedMult: 200, episodeLen: 10,
    backend: 'js', threads: 1, minibatch: 128, horizon: 64, epochs: 2,
    progressReward: 0, lapBonus: 0, gravelPenalty: 0, wallPenalty: 0, terminalPenalty: 0,
  }, 30000);

  check('frame received', !!frame);
  if (frame) {
    console.log(`  updates ${frame.iteration} · episodes ${frame.episodes} · γ ${frame.gamma.toFixed(4)}`);
    check(`enough updates ran for the stagnation window (${frame.iteration})`, frame.iteration >= 12);
    check(`γ rose above its 0.99 base (${frame.gamma.toFixed(4)})`, frame.gamma > 0.9905);
    check('γ stayed below its cap', frame.gamma <= 0.998);
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
