'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  grad-worker-check.mjs — drives the REAL grad-worker.js message protocol in
//  Node (fetch shimmed to read nn_wasm.wasm from disk), exercising both the
//  WASM path and the JS fallback for the PPO gradient task.
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

console.log('\nPPO task — WASM and JS fallback');
for (const force of ['auto', 'js']) {
  const actor = new Net([OBS, H, ACT], 0.5);
  const critic = new Net([OBS, H, 1], 1);
  const rnd = n => Float64Array.from({ length: n }, () => Math.random() * 2 - 1);
  handler({ data: {
    type: 'grad', force,
    actorSizes: actor.sizes, criticSizes: critic.sizes,
    actorFlat: actor.flatF64(), criticFlat: critic.flatF64(),
    logStd: [-0.5, -0.5, -0.5, -0.5],
    hp: { clip: 0.2, entropyCoef: 0.003, vfCoef: 0.5 },
    n: N, obsDim: OBS, actDim: ACT,
    obs: rnd(N * OBS), act: rnd(N * ACT),
    logp: rnd(N), adv: rnd(N), ret: rnd(N),
  } });
  const r = await nextOfType('gradResult');
  const wantMode = force === 'js' ? 'js' : 'wasm';
  check(`${wantMode}: reply with grads of the right shape`,
    !!r && r.mode === wantMode &&
    r.aG.length === actor.paramCount() && r.cG.length === critic.paramCount(),
    r ? `mode ${r.mode}` : 'no reply');
  check(`${wantMode}: values finite, value loss non-negative`,
    !!r && finite(r.aG) && finite(r.cG) && finite(r.gLs) && r.v >= 0 && r.n === N);
}

// ── Recurrent (GRU/BPTT) task — WASM and JS must agree ───────────────────────
console.log('\nRecurrent PPO task — WASM ↔ JS parity through the worker');
{
  const { GRUNet } = await import('../scripts/nn-core.js');
  const I = 8, Hr = 16, O = 2;
  const actor = new GRUNet([I, Hr, O]);
  const critic = new GRUNet([I, Hr, 1]);
  const rnd = n => Float64Array.from({ length: n }, () => Math.random() * 2 - 1);
  const mkSeq = T => {
    const done = new Float64Array(T); if (T > 5) done[3] = 1;
    return { T, obsDim: I, actDim: O, obs: rnd(T * I), act: rnd(T * O),
             logp: rnd(T), adv: rnd(T), ret: rnd(T), done, h0a: rnd(Hr), h0c: rnd(Hr) };
  };
  const seqs = [mkSeq(16), mkSeq(11), mkSeq(7)];
  const base = {
    actorSizes: actor.sizes, criticSizes: critic.sizes,
    actorFlat: actor.flatF64(), criticFlat: critic.flatF64(),
    logStd: [-0.4, -0.4], actDim: O,
    hp: { clip: 0.2, entropyCoef: 0.01, vfCoef: 0.5 },
  };
  const results = {};
  for (const force of ['auto', 'js']) {
    // deep-clone seqs because the worker transfers/consumes typed-array buffers
    const seqsCopy = seqs.map(s => ({ ...s,
      obs: s.obs.slice(), act: s.act.slice(), logp: s.logp.slice(),
      adv: s.adv.slice(), ret: s.ret.slice(), done: s.done.slice(),
      h0a: s.h0a.slice(), h0c: s.h0c.slice() }));
    handler({ data: { type: 'gradRec', force, ...base,
      actorFlat: base.actorFlat.slice(), criticFlat: base.criticFlat.slice(),
      seqs: seqsCopy } });
    const r = await nextOfType('gradResult');
    results[force] = r;
    const wantMode = force === 'js' ? 'js-rec' : 'wasm-rec';
    check(`${wantMode}: reply shape + finite`,
      !!r && r.mode === wantMode &&
      r.aG.length === actor.paramCount() && r.cG.length === critic.paramCount() &&
      finite(r.aG) && finite(r.cG) && finite(r.gLs) && r.v >= 0,
      r ? `mode ${r.mode}` : 'no reply');
  }
  const a = results.auto, b = results.js;
  const maxRel = (x, y) => { let m = 0; for (let k = 0; k < x.length; k++) { const e = Math.abs(x[k] - y[k]) / (Math.abs(x[k]) + Math.abs(y[k]) + 1e-9); if (e > m) m = e; } return m; };
  check('recurrent WASM grads match JS grads',
    !!a && !!b && maxRel(a.aG, b.aG) < 1e-9 && maxRel(a.cG, b.cG) < 1e-9 && maxRel(a.gLs, b.gLs) < 1e-9,
    a && b ? `aG rel ${maxRel(a.aG, b.aG).toExponential(2)}` : 'missing result');
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
