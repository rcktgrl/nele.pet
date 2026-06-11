'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  grad-worker-check.mjs — drives the REAL grad-worker.js message protocol in
//  Node (fetch shimmed to read nn_wasm.wasm from disk), exercising both the
//  WASM arena layout and the JS fallback for the PPO and SAC task kinds.
//
//  Run:  node games/ai-trainer/test/grad-worker-check.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import { Net } from '../scripts/nn-core.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// ── Shims (before import) ────────────────────────────────────────────────────
const inbox = [];
let wakeup = null;
globalThis.self = globalThis;
globalThis.postMessage = msg => {
  inbox.push(msg);
  if (wakeup) { const w = wakeup; wakeup = null; w(); }
};
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const s = String(url);
  if (s.startsWith('file:')) {
    const bytes = await readFile(new URL(s));
    return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
  }
  return realFetch(url);
};

await import('../scripts/grad-worker.js');
const handler = globalThis.self.onmessage;

async function nextOfType(type, timeoutMs = 5000) {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < inbox.length; i++) {
      if (inbox[i].type === type) return inbox.splice(i, 1)[0];
    }
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise(res => { wakeup = res; setTimeout(res, 100); });
  }
}

const status = await nextOfType('wasmStatus');
check(`wasm module loaded (${status && (status.ok ? 'ok' : status.error)})`, !!status && status.ok);

const OBS = 9, ACT = 4, H = 24, N = 48;
const finite = arr => Array.from(arr).every(Number.isFinite);

function sacMsg(force) {
  const actor = new Net([OBS, H, 2 * ACT], 0.5);
  const q = new Net([OBS + ACT, H, 1], 1);
  const rnd = n => Float64Array.from({ length: n }, () => Math.random() * 2 - 1);
  return {
    type: 'sacGrad', force,
    actorSizes: actor.sizes, qSizes: q.sizes,
    actorFlat: actor.flatF64(),
    q1Flat: new Net(q.sizes, 1).flatF64(),
    q2Flat: new Net(q.sizes, 1).flatF64(),
    tq1Flat: new Net(q.sizes, 1).flatF64(),
    tq2Flat: new Net(q.sizes, 1).flatF64(),
    logAlpha: Math.log(0.2),
    hp: { gamma: 0.99, targetEntropy: -ACT },
    n: N, obsDim: OBS, actDim: ACT,
    obs: rnd(N * OBS), act: rnd(N * ACT), rew: rnd(N),
    obs2: rnd(N * OBS), done: Float64Array.from({ length: N }, () => Math.random() < 0.5 ? 1 : 0),
    _nAP: actor.paramCount(), _nQP: q.paramCount(),
  };
}

console.log('\nSAC task — WASM and JS fallback');
for (const force of ['auto', 'js']) {
  const msg = sacMsg(force);
  handler({ data: msg });
  const r = await nextOfType('gradResult');
  const wantMode = force === 'js' ? 'js' : 'wasm';
  check(`${wantMode}: reply with grads of the right shape`,
    !!r && r.mode === wantMode &&
    r.aG.length === msg._nAP && r.q1G.length === msg._nQP && r.q2G.length === msg._nQP,
    r ? `mode ${r.mode}` : 'no reply');
  check(`${wantMode}: values finite, q-loss non-negative, entropy stats sane`,
    !!r && finite(r.aG) && finite(r.q1G) && finite(r.q2G) &&
    Number.isFinite(r.gLa) && r.q >= 0 && r.std > 0 && r.n === N);
}

console.log('\nPPO task — regression');
{
  const actor = new Net([OBS, H, ACT], 0.5);
  const critic = new Net([OBS, H, 1], 1);
  const rnd = n => Float64Array.from({ length: n }, () => Math.random() * 2 - 1);
  handler({ data: {
    type: 'grad', force: 'auto',
    actorSizes: actor.sizes, criticSizes: critic.sizes,
    actorFlat: actor.flatF64(), criticFlat: critic.flatF64(),
    logStd: [-0.5, -0.5, -0.5, -0.5],
    hp: { clip: 0.2, entropyCoef: 0.003, vfCoef: 0.5 },
    n: N, obsDim: OBS, actDim: ACT,
    obs: rnd(N * OBS), act: rnd(N * ACT),
    logp: rnd(N), adv: rnd(N), ret: rnd(N),
  } });
  const r = await nextOfType('gradResult');
  check('wasm PPO reply finite and well-shaped',
    !!r && r.mode === 'wasm' && r.aG.length === actor.paramCount() &&
    r.cG.length === critic.paramCount() && finite(r.aG) && finite(r.cG) && r.v >= 0);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
