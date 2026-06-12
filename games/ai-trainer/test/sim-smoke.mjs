'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  sim-smoke.mjs — end-to-end smoke test of the REAL sim-worker.js in Node.
//
//  Run:  node games/ai-trainer/test/sim-smoke.mjs
//
//  Drives the worker protocol on a synthetic circular track. Nested Workers
//  don't exist in Node, so the gradient pool fails over to the local
//  single-thread path — exactly the trainer's worst-case fallback. Covers
//  the PPO mods: mirror augmentation (unit-checked index map + live run),
//  KL early stop (forced trigger), agent groups, neuron repair and the
//  defect-weight failure rate.
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

const sim = await import('../scripts/sim-worker.js');
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

async function runConfig(label, config, runMs) {
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

async function exportModel() {
  inbox.length = 0;
  send({ type: 'exportModel' });
  const exp = await waitFor(m => m.type === 'modelExport', 3000);
  return exp && exp.model;
}

// ── 1. Mirror map unit checks ────────────────────────────────────────────────
console.log('\n1. Mirror augmentation index map');
{
  const OBS = 40, ACT = 6;
  const src = Float64Array.from({ length: OBS }, (_, i) => i + 1);
  const dst = sim.mirrorObsInto(src, new Float64Array(OBS));
  let ok = true;
  for (let k = 0; k <= 10; k++) ok = ok && dst[k] === src[10 - k];        // long rays reversed
  for (let k = 11; k <= 17; k++) ok = ok && dst[k] === src[28 - k];       // edge rays reversed
  ok = ok && dst[18] === src[18] && dst[20] === src[20] && dst[21] === src[21]
          && dst[22] === src[22] && dst[23] === src[23];                  // scalars kept
  ok = ok && dst[19] === -src[19];                                        // heading error flips
  for (let p = 0; p < 6; p++) {
    ok = ok && dst[24 + 2 * p] === -src[24 + 2 * p];                      // probe angles flip
    ok = ok && dst[25 + 2 * p] === src[25 + 2 * p];                       // probe slopes keep
  }
  for (let d = 36; d < 40; d++) ok = ok && dst[d] === src[d];             // memory kept
  check('observation map is exactly the documented reflection', ok);

  const back = sim.mirrorObsInto(dst, new Float64Array(OBS));
  check('mirror is an involution (mirror∘mirror = id)',
    back.every((v, i) => v === src[i]));

  const act = Float64Array.from({ length: ACT }, (_, i) => i + 1);
  const actM = sim.mirrorActInto(act, new Float64Array(ACT));
  check('action map flips steer only',
    actM[0] === -act[0] && actM.slice(1).every((v, i) => v === act[i + 1]));
}

// ── 2. Vanilla PPO regression (all mods off) ─────────────────────────────────
console.log('\n2. Vanilla PPO (mods off)');
{
  const frame = await runConfig('vanilla', {
    numEnvs: 4, speedMult: 200, episodeLen: 15,
    backend: 'js', threads: 1, minibatch: 128, horizon: 64, epochs: 2,
    klStop: false, mirror: false, neuronRepair: false, failRate: 0, groupSize: 1,
  }, 15000);
  if (frame) {
    check(`updates completed (${frame.iteration})`, frame.iteration > 0);
    check('losses finite', Number.isFinite(frame.loss.pi) && Number.isFinite(frame.loss.v));
    check(`all epochs ran without KL stop (${frame.mods.epochs}/2)`, frame.mods.epochs === 2);
    check('no mods reported active',
      frame.mods.groupSize === 1 && !frame.mods.mirror && !frame.mods.repair && frame.mods.masked === 0);
  }
  const m = await exportModel();
  check('export is a complete PPO model', !!m && m.algo === 'ppo' && m.actor && m.critic);
}

// ── 3. KL early stop (forced) ────────────────────────────────────────────────
console.log('\n3. KL early stop');
{
  const frame = await runConfig('kl-stop', {
    numEnvs: 4, speedMult: 200, episodeLen: 15,
    backend: 'js', threads: 1, minibatch: 128, horizon: 64, epochs: 4,
    klStop: true, klLimit: 1e-9,  // any movement at all must trigger the stop
  }, 15000);
  if (frame) {
    check(`updates completed (${frame.iteration})`, frame.iteration > 0);
    check(`stopped after the first epoch (${frame.mods.epochs}/4)`, frame.mods.epochs === 1);
    check(`KL movement measured (${frame.mods.kl.toExponential(2)})`,
      Number.isFinite(frame.mods.kl) && frame.mods.kl > 1e-9);
  }
}

// ── 4. Agent groups (GRPO-style) ─────────────────────────────────────────────
console.log('\n4. Agent groups ×4');
{
  const frame = await runConfig('groups', {
    numEnvs: 8, speedMult: 200, episodeLen: 10,
    backend: 'js', threads: 1, minibatch: 128, horizon: 32, epochs: 2,
    groupSize: 4, klStop: false,
  }, 25000);
  if (frame) {
    check(`group updates completed (${frame.iteration})`, frame.iteration > 0);
    check('losses finite', Number.isFinite(frame.loss.pi) && Number.isFinite(frame.loss.v));
    check('group size reported', frame.mods.groupSize === 4);
    check(`episodes completed (${frame.episodes})`, frame.episodes > 0);
  }
  const m = await exportModel();
  check('export still complete under group mode', !!m && m.actor.flat.every(Number.isFinite));
}

// ── 5. Mirror + failure rate + neuron repair together ────────────────────────
console.log('\n5. Combined: mirror + 10% defect weights + neuron repair');
{
  const frame = await runConfig('combo', {
    numEnvs: 4, speedMult: 200, episodeLen: 12,
    backend: 'js', threads: 1, minibatch: 128, horizon: 64, epochs: 2,
    mirror: true, failRate: 0.10, neuronRepair: true, klStop: true,
  }, 25000);
  if (frame) {
    check(`updates completed (${frame.iteration})`, frame.iteration > 0);
    check('losses finite', Number.isFinite(frame.loss.pi) && Number.isFinite(frame.loss.v));
    check('every agent drives a defect-masked copy', frame.mods.masked === 4);
    check('repair stats reported', !!frame.mods.repair &&
      frame.mods.repair.recycled >= 0 && frame.mods.repair.splits >= 0);
    console.log(`  updates ${frame.iteration} · epochs ${frame.mods.epochs} · ` +
                `KL ${frame.mods.kl.toFixed(4)} · repair ♻${frame.mods.repair.recycled}/✂${frame.mods.repair.splits}`);
  }
  // manual repair pass must not corrupt the weights
  send({ type: 'repairNow' });
  await new Promise(res => setTimeout(res, 500));
  const m = await exportModel();
  check('weights finite after manual repair pass',
    !!m && m.actor.flat.every(Number.isFinite) && m.critic.flat.every(Number.isFinite));
}

// ── 6. Neuron repair mechanics on a crafted network ──────────────────────────
//  Import a model whose hidden layer contains one DEAD neuron (outgoing
//  weights all zero → zero influence) and one OVERTUNED neuron (outgoing
//  ×20 → influence far above the layer mean). One repair pass must recycle
//  the dead one and split the dominant one.
console.log('\n6. Neuron repair on a crafted network');
{
  const { Net } = await import('../scripts/nn-core.js');
  const OBS = 40, ACT = 6, H = 32;
  const actor = new Net([OBS, H, ACT], 1);
  const critic = new Net([OBS, H, 1], 1);
  for (let o = 0; o < ACT; o++) actor.W[1][o * H + 0] = 0;     // neuron 0: dead
  for (let o = 0; o < ACT; o++) actor.W[1][o * H + 1] *= 20;   // neuron 1: overtuned
  const model = {
    algo: 'ppo', obsDim: OBS, actDim: ACT,
    actor: { sizes: actor.sizes, flat: actor.flat() },
    critic: { sizes: critic.sizes, flat: critic.flat() },
    logStd: Array(ACT).fill(-0.5),
  };

  inbox.length = 0;
  send({
    type: 'init', track: makeTrack(), carData, model,
    config: {
      numEnvs: 4, speedMult: 200, episodeLen: 15,
      backend: 'js', threads: 1, hiddenSize: H, hiddenLayers: 1,
      neuronRepair: true, klStop: false, mirror: false, failRate: 0, groupSize: 1,
    },
  });
  const ready = await waitFor(m => m.type === 'ready', 5000);
  check('crafted model imported', !!ready);
  send({ type: 'start' });
  await new Promise(res => setTimeout(res, 6000));  // fill the obs reservoir
  send({ type: 'repairNow' });
  await new Promise(res => setTimeout(res, 1000));
  inbox.length = 0;  // drop the run's stale frames — we want the latest stats
  send({ type: 'getSnapshot' });
  const frame = await waitFor(m => m.type === 'frame', 3000);
  send({ type: 'stop' });
  if (frame) {
    console.log(`  repair: recycled ${frame.mods.repair.recycled} · splits ${frame.mods.repair.splits}`);
    check('dead neuron was recycled', frame.mods.repair.recycled >= 1);
    check('overtuned neuron was split', frame.mods.repair.splits >= 1);
  } else {
    check('snapshot after repair', false);
  }
  const m = await exportModel();
  check('weights finite after crafted repair', !!m && m.actor.flat.every(Number.isFinite));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
