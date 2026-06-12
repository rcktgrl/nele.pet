'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  tf-worker-check.mjs — runs the REAL tf-worker.js in Node with worker shims
//  and tf's CPU backend (the same tf ops the WebGL backend executes), so the
//  GPU PPO update can be exercised without a browser.
//
//  Run:  node games/ai-trainer/test/tf-worker-check.mjs
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

console.log('\nPPO update round (tf cpu backend)');
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

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
