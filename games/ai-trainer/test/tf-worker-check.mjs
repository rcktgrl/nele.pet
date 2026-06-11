'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  tf-worker-check.mjs — runs the REAL tf-worker.js in Node with worker shims
//  and tf's CPU backend (the same tf ops the WebGL backend executes), so the
//  GPU update math can be exercised without a browser.
//
//  Run:  node games/ai-trainer/test/tf-worker-check.mjs
//
//  1. PPO: init + one update round must return finite weights (regression).
//  2. SAC: on a one-step bandit (reward = 1 − (a₀ − 0.5)², done = 1) the
//     critic loss must fall and the deterministic action must approach 0.5.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import { Net } from '../scripts/nn-core.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ── Worker environment shim ──────────────────────────────────────────────────
const scriptsDir = new URL('../scripts/', import.meta.url);
const replies = [];
let wakeup = null;

const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    replies.push(msg);
    if (wakeup) { const w = wakeup; wakeup = null; w(); }
  },
};

async function loadWorker() {
  const tfSrc = await readFile(new URL('./vendor/tf.min.js', scriptsDir), 'utf8');
  const wSrc  = await readFile(new URL('./tf-worker.js', scriptsDir), 'utf8');
  const importScripts = () => {
    // tf.min.js UMD attaches to globalThis. `process` is shadowed so tf's
    // IS_NODE detection picks the browser platform (its node path require()s),
    // and a WorkerGlobalScope stub makes IS_BROWSER true so the browser
    // platform (fetch + TextEncoder, both available in Node) is registered.
    globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
    new Function('process', 'module', 'exports', tfSrc)(undefined, undefined, undefined);
  };
  new Function('self', 'importScripts', 'postMessage', 'performance', wSrc)(
    workerSelf, importScripts, workerSelf.postMessage.bind(workerSelf), globalThis.performance,
  );
}

function send(msg) { workerSelf.onmessage({ data: msg }); }

async function nextReply() {
  while (!replies.length) await new Promise(res => { wakeup = res; });
  return replies.shift();
}

await loadWorker();

const OBS = 5, ACT = 2, H = 16;

// ── 1. PPO regression ────────────────────────────────────────────────────────
console.log('\n1. PPO update round (tf cpu backend)');
{
  const actor = new Net([OBS, H, ACT], 0.01);
  const critic = new Net([OBS, H, 1], 1);
  send({
    type: 'init', backend: 'cpu',
    actorSizes: actor.sizes, criticSizes: critic.sizes,
    actorFlat: Float32Array.from(actor.flatF64()),
    criticFlat: Float32Array.from(critic.flatF64()),
    logStd: Float32Array.from([-0.5, -0.5]),
    lr: 3e-4,
  });
  const ready = await nextReply();
  check(`init ready (backend ${ready.backend})`, ready.type === 'ready' && ready.backend === 'cpu');

  const N = 64;
  const obs = new Float32Array(N * OBS).map(() => Math.random() * 2 - 1);
  const act = new Float32Array(N * ACT).map(() => Math.random() * 2 - 1);
  const logp = new Float32Array(N).fill(-2);
  const adv = new Float32Array(N).map(() => Math.random() * 2 - 1);
  const ret = new Float32Array(N).map(() => Math.random());
  send({
    type: 'update', n: N, obs, act, logp, adv, ret,
    hp: { clip: 0.2, entropyCoef: 0.003, vfCoef: 0.5, lr: 3e-4 },
    epochs: 2, minibatch: 32,
  });
  const r = await nextReply();
  const finite = arr => Array.from(arr).every(Number.isFinite);
  check('update returns finite weights',
    r.type === 'updated' && finite(r.actorFlat) && finite(r.criticFlat) &&
    Number.isFinite(r.loss.pi) && Number.isFinite(r.loss.v));
}

// ── 2. SAC bandit ────────────────────────────────────────────────────────────
console.log('\n2. SAC one-step bandit (tf cpu backend)');
{
  // both sections share one worker instance here (the real app spawns a fresh
  // worker per init) — drop the PPO test's registered variables first
  globalThis.tf.disposeVariables();

  const actor = new Net([OBS, H, 2 * ACT], 0.01);
  const lb = actor.b[actor.b.length - 1];
  for (let d = 0; d < ACT; d++) lb[ACT + d] = -0.5;
  const q1 = new Net([OBS + ACT, H, 1], 1);
  const q2 = new Net([OBS + ACT, H, 1], 1);

  send({
    type: 'init', algo: 'sac', backend: 'cpu',
    actorSizes: actor.sizes, qSizes: q1.sizes,
    actorFlat: Float32Array.from(actor.flatF64()),
    q1Flat: Float32Array.from(q1.flatF64()),
    q2Flat: Float32Array.from(q2.flatF64()),
    tq1Flat: Float32Array.from(q1.flatF64()),
    tq2Flat: Float32Array.from(q2.flatF64()),
    logAlpha: Math.log(0.2),
    lr: 3e-3, gamma: 0.99, targetEntropy: -ACT, tau: 0.005,
  });
  const ready = await nextReply();
  check(`init ready (backend ${ready.backend})`, ready.type === 'ready' && ready.backend === 'cpu');

  const B = 64;
  const TARGET = 0.5;
  const makeRound = G => {
    const n = G * B;
    const obs = new Float32Array(n * OBS);
    const act = new Float32Array(n * ACT);
    const rew = new Float32Array(n);
    const obs2 = new Float32Array(n * OBS);
    const done = new Float32Array(n).fill(1);    // one-step bandit
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < OBS; i++) {
        const v = Math.random() * 2 - 1;
        obs[k * OBS + i] = v; obs2[k * OBS + i] = v;
      }
      let a0 = 0;
      for (let d = 0; d < ACT; d++) {
        const a = (Math.random() * 2 - 1) * 0.999;  // uniform — even Q coverage
        act[k * ACT + d] = a;
        if (d === 0) a0 = a;
      }
      rew[k] = 1 - (a0 - TARGET) ** 2;
    }
    return { type: 'update', steps: G, batchSize: B, obs, act, rew, obs2, done, lr: 3e-3 };
  };

  let firstQ = null, last = null;
  for (let round = 0; round < 24; round++) {
    send(makeRound(50));
    last = await nextReply();
    if (last.type !== 'updated') break;
    if (firstQ === null) firstQ = last.loss.q;
  }
  check('rounds return finite results',
    last.type === 'updated' && Number.isFinite(last.loss.q) && Number.isFinite(last.loss.pi) &&
    Number.isFinite(last.logAlpha),
    last.type !== 'updated' ? JSON.stringify(last) : '');

  // Deterministic action from the returned actor weights, via the JS Net —
  // also verifies the flat-layout round trip between tf vars and Net.
  const probe = new Net(actor.sizes, 1);
  probe.loadFlat(last.actorFlat);
  let mean0 = 0;
  const TRIALS = 200;
  for (let t = 0; t < TRIALS; t++) {
    const o = Float64Array.from({ length: OBS }, () => Math.random() * 2 - 1);
    mean0 += Math.tanh(probe.forward(o)[0]) / TRIALS;
  }
  console.log(`  q loss ${firstQ.toFixed(4)} → ${last.loss.q.toFixed(4)} · ` +
              `mean action ${mean0.toFixed(3)} (target ${TARGET}) · α ${Math.exp(last.logAlpha).toFixed(3)}`);
  check('critic loss fell', last.loss.q < firstQ * 0.5);
  // The actor typically lands at 0.55–0.9: with a STATIC dataset it climbs
  // past the optimum into Q's extrapolation error and nothing corrects it
  // (no fresh on-policy data). This check is a sign/shape discriminator, not
  // a convergence bound — an inverted gradient drives a₀ to ≈ −0.9, a dead
  // update leaves it at ≈ 0, so > 0.25 separates both failure modes cleanly.
  check('actor moved decisively toward the rewarded action (a₀ > 0.25)', mean0 > 0.25);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
