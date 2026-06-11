'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  sim-smoke.mjs — end-to-end smoke test of the REAL sim-worker.js in Node.
//
//  Run:  node games/ai-trainer/test/sim-smoke.mjs
//
//  Drives the worker protocol on a synthetic circular track. Nested Workers
//  don't exist in Node, so the gradient pool fails over to the local
//  single-thread path — exactly the trainer's worst-case fallback. Checks:
//    1. SAC: warmup fills the replay buffer, gradient steps run, losses and
//       α are finite, export carries the full twin-critic state.
//    2. PPO: still collects and completes updates (regression).
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

async function runAlgo(algo, config, runMs) {
  inbox.length = 0;
  send({ type: 'init', track: makeTrack(), carData, config });
  const ready = await waitFor(m => m.type === 'ready', 5000);
  check(`${algo}: worker ready`, !!ready);
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

// ── 1. SAC ───────────────────────────────────────────────────────────────────
console.log('\n1. SAC end-to-end (local CPU fallback path)');
{
  const frame = await runAlgo('sac', {
    algo: 'sac', numEnvs: 4, speedMult: 200, episodeLen: 15,
    backend: 'js', threads: 1, minibatch: 64, utd: 0.5,
    bufferSize: 20000, lr: 3e-4,
  }, 30000);

  check('frame received', !!frame);
  if (frame) {
    check(`algo tagged sac`, frame.algo === 'sac');
    check(`left warmup (phase ${frame.phase})`, frame.phase === 'training');
    check(`gradient steps ran (${frame.iteration})`, frame.iteration > 0);
    check('losses finite',
      Number.isFinite(frame.loss.pi) && Number.isFinite(frame.loss.v) && Number.isFinite(frame.loss.ent));
    check(`alpha live (${frame.alpha != null ? frame.alpha.toFixed(3) : '—'})`,
      Number.isFinite(frame.alpha) && frame.alpha > 0);
    check(`sigma reported`, Array.isArray(frame.sigma) && Number.isFinite(frame.sigma[0]));
    check(`episodes completed (${frame.episodes})`, frame.episodes > 0);
    console.log(`  steps ${frame.totalSteps} · grad steps ${frame.iteration} · ` +
                `avg return ${frame.avgReturn.toFixed(1)} · α ${frame.alpha.toFixed(3)}`);
  }

  inbox.length = 0;
  send({ type: 'exportModel' });
  const exp = await waitFor(m => m.type === 'modelExport', 3000);
  const m = exp && exp.model;
  check('export is a complete SAC model',
    !!m && m.algo === 'sac' && m.actor && m.q1 && m.q2 && m.tq1 && m.tq2 &&
    Number.isFinite(m.logAlpha) &&
    m.actor.sizes[m.actor.sizes.length - 1] === 2 * m.actDim &&
    m.q1.sizes[0] === m.obsDim + m.actDim);
  check('export weights finite',
    !!m && m.actor.flat.every(Number.isFinite) && m.q1.flat.every(Number.isFinite));
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
  }

  inbox.length = 0;
  send({ type: 'exportModel' });
  const exp = await waitFor(m => m.type === 'modelExport', 3000);
  const m = exp && exp.model;
  check('export is a complete PPO model',
    !!m && m.algo === 'ppo' && m.actor && m.critic && Array.isArray(m.logStd));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
