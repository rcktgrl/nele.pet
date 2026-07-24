'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  gru-wasm-parity.mjs — verifies the WASM GRU recurrent PPO kernel
//  (compute_ppo_recurrent_grads) produces the same gradients as the
//  gradient-checked JS path (accumulatePPORecurrentGrads).
//
//  Run:  node games/ai-trainer/test/gru-wasm-parity.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import { GRUNet, accumulatePPORecurrentGrads } from '../scripts/nn-core.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const url = new URL('../scripts/nn_wasm.wasm', import.meta.url);
const bytes = await readFile(url);
const { instance } = await WebAssembly.instantiate(bytes); // no imports — see nn_wasm.c
const ex = instance.exports;
const mem = ex.memory;

function paramCount([I, H, O]) { return 3 * H * I + 3 * H * H + 3 * H + O * H + O; }

const I = 6, H = 8, O = 3, T = 20;
const aSizes = [I, H, O], cSizes = [I, H, 1];
const actor = new GRUNet(aSizes), critic = new GRUNet(cSizes);
const logStd = new Float64Array(O).fill(-0.4);
const hp = { clip: 0.2, entropyCoef: 0.01, vfCoef: 0.5 };

const rnd = n => Float64Array.from({ length: n }, () => Math.random() * 2 - 1);
const obs = rnd(T * I), act = rnd(T * O), adv = rnd(T), ret = rnd(T);
const logp = rnd(T);
const done = new Float64Array(T); done[7] = 1; done[14] = 1;
const h0a = rnd(H), h0c = rnd(H);

// ── JS reference ──
actor.zeroGrad(); critic.zeroGrad();
const rJS = accumulatePPORecurrentGrads(actor, critic, logStd, hp, {
  T, obsDim: I, actDim: O, obs, act, logp, adv, ret, done, h0a, h0c,
});
const aGjs = actor.gradFlatF64(), cGjs = critic.gradFlatF64();

// ── WASM ──
const Pa = paramCount(aSizes), Pc = paramCount(cSizes);
let base = ex.get_heap_base();
const align = () => { base = (base + 7) & ~7; };
const putI32 = (arr) => { align(); const off = base; new Int32Array(mem.buffer, off, arr.length).set(arr); base += arr.length * 4; return off; };
const putF64 = (arr) => { align(); const off = base; new Float64Array(mem.buffer, off, arr.length).set(arr); base += arr.length * 8; return off; };
const zeroF64 = (n) => { align(); const off = base; new Float64Array(mem.buffer, off, n).fill(0); base += n * 8; return off; };

// grow memory generously
mem.grow(64);
const aSizesOff = putI32(aSizes), cSizesOff = putI32(cSizes);
const aFlatOff = putF64(actor.flatF64()), cFlatOff = putF64(critic.flatF64());
const lsOff = putF64(logStd);
const obsOff = putF64(obs), actOff = putF64(act), logpOff = putF64(logp);
const advOff = putF64(adv), retOff = putF64(ret), doneOff = putF64(done);
const h0aOff = putF64(h0a), h0cOff = putF64(h0c);
const aGradOff = zeroF64(Pa), cGradOff = zeroF64(Pc), gLsOff = zeroF64(O), lossOff = zeroF64(3);

const ok = ex.compute_ppo_recurrent_grads(
  T, I, O, aSizesOff, cSizesOff, aFlatOff, cFlatOff, lsOff,
  hp.clip, hp.entropyCoef, hp.vfCoef,
  obsOff, actOff, logpOff, advOff, retOff, doneOff, h0aOff, h0cOff,
  aGradOff, cGradOff, gLsOff, lossOff);
check('kernel handled the sequence (within caps)', ok === 1);

const aGw = new Float64Array(mem.buffer, aGradOff, Pa);
const cGw = new Float64Array(mem.buffer, cGradOff, Pc);
const gLw = new Float64Array(mem.buffer, gLsOff, O);
const loss = new Float64Array(mem.buffer, lossOff, 3);

const maxRel = (a, b) => {
  let m = 0;
  for (let k = 0; k < a.length; k++) {
    const e = Math.abs(a[k] - b[k]) / (Math.abs(a[k]) + Math.abs(b[k]) + 1e-9);
    if (e > m) m = e;
  }
  return m;
};

check('actor grads match JS',  maxRel(aGw, aGjs) < 1e-9, `rel ${maxRel(aGw, aGjs).toExponential(2)}`);
check('critic grads match JS', maxRel(cGw, cGjs) < 1e-9, `rel ${maxRel(cGw, cGjs).toExponential(2)}`);
check('logStd grads match JS', maxRel(gLw, rJS.gLs) < 1e-9, `rel ${maxRel(gLw, rJS.gLs).toExponential(2)}`);
check('losses match JS',
  Math.abs(loss[0] - rJS.pi) < 1e-7 && Math.abs(loss[1] - rJS.v) < 1e-7 && Math.abs(loss[2] - rJS.ent) < 1e-7,
  `pi Δ${Math.abs(loss[0] - rJS.pi).toExponential(2)} v Δ${Math.abs(loss[1] - rJS.v).toExponential(2)}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nWASM ↔ JS recurrent parity holds');
process.exit(failures ? 1 : 0);
