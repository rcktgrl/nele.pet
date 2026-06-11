'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  sac-check.mjs — Node verification harness for the trainer's gradient math.
//
//  Run:  node games/ai-trainer/test/sac-check.mjs
//
//  1. Numeric gradient check of accumulateSACGrads (central differences on
//     actor / critic weights and logα, each against its own loss term —
//     SAC's losses are deliberately decoupled).
//  2. WASM ↔ JS parity for compute_sac_grads AND compute_ppo_grads
//     (regression — the .wasm is recompiled whenever nn_wasm.c changes).
//  3. End-to-end SAC sanity: a 2-D point-mass task must reach near-optimal
//     return within a few thousand gradient steps.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
import {
  Net, accumulatePPOGrads, accumulateSACGrads,
  SAC_LOGSTD_MIN, SAC_LOGSTD_MAX, LOG_2PI,
} from '../scripts/nn-core.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

// Deterministic RNG (mulberry32) so failures reproduce.
let seed = 0x9e3779b9;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function nrand() {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const OBS = 7, ACT = 3, H = 16, N = 12;
const TANH_EPS = 1e-6;

function randNet(sizes, scale = 0.5) {
  const net = new Net(sizes, 1);
  for (let l = 0; l < net.W.length; l++) {
    for (let i = 0; i < net.W[l].length; i++) net.W[l][i] = (rand() * 2 - 1) * scale;
    for (let i = 0; i < net.b[l].length; i++) net.b[l][i] = (rand() * 2 - 1) * 0.1;
  }
  return net;
}

function makeBatch() {
  const data = {
    n: N, obsDim: OBS, actDim: ACT,
    obs:    new Float64Array(N * OBS),
    act:    new Float64Array(N * ACT),
    rew:    new Float64Array(N),
    obs2:   new Float64Array(N * OBS),
    done:   new Float64Array(N),
    noise:  new Float64Array(N * ACT),
    noise2: new Float64Array(N * ACT),
  };
  for (let i = 0; i < N * OBS; i++) { data.obs[i] = nrand(); data.obs2[i] = nrand(); }
  for (let i = 0; i < N * ACT; i++) {
    data.act[i] = Math.tanh(nrand());
    data.noise[i] = nrand(); data.noise2[i] = nrand();
  }
  for (let k = 0; k < N; k++) { data.rew[k] = nrand(); data.done[k] = rand() < 0.3 ? 1 : 0; }
  return data;
}

const clampLs = ls => Math.max(SAC_LOGSTD_MIN, Math.min(SAC_LOGSTD_MAX, ls));

// Forward-only loss recomputation (for finite differences). Mirrors the math
// in accumulateSACGrads but takes no gradients.
function sacLosses(nets, hp, data) {
  const { actor, q1, q2, tq1, tq2 } = nets;
  const alpha = Math.exp(hp.logAlpha);
  const qIn = new Float64Array(OBS + ACT);
  let critic = 0, actorL = 0, alphaL = 0;
  for (let k = 0; k < N; k++) {
    const o = data.obs.subarray(k * OBS, (k + 1) * OBS);
    const o2 = data.obs2.subarray(k * OBS, (k + 1) * OBS);
    const a = data.act.subarray(k * ACT, (k + 1) * ACT);
    const e = data.noise.subarray(k * ACT, (k + 1) * ACT);
    const e2 = data.noise2.subarray(k * ACT, (k + 1) * ACT);

    const out2 = actor.forward(o2);
    qIn.set(o2, 0);
    let logp2 = 0;
    for (let d = 0; d < ACT; d++) {
      const ls = clampLs(out2[ACT + d]);
      const ad = Math.tanh(out2[d] + Math.exp(ls) * e2[d]);
      logp2 += -0.5 * e2[d] * e2[d] - ls - 0.5 * LOG_2PI - Math.log(1 - ad * ad + TANH_EPS);
      qIn[OBS + d] = ad;
    }
    const y = data.rew[k] + hp.gamma * (1 - data.done[k]) *
      (Math.min(tq1.forward(qIn)[0], tq2.forward(qIn)[0]) - alpha * logp2);

    qIn.set(o, 0); qIn.set(a, OBS);
    critic += 0.5 * ((q1.forward(qIn)[0] - y) ** 2 + (q2.forward(qIn)[0] - y) ** 2);

    const out = actor.forward(o);
    let logp = 0;
    for (let d = 0; d < ACT; d++) {
      const ls = clampLs(out[ACT + d]);
      const ad = Math.tanh(out[d] + Math.exp(ls) * e[d]);
      logp += -0.5 * e[d] * e[d] - ls - 0.5 * LOG_2PI - Math.log(1 - ad * ad + TANH_EPS);
      qIn[OBS + d] = ad;
    }
    actorL += alpha * logp - Math.min(q1.forward(qIn)[0], q2.forward(qIn)[0]);
    alphaL += -hp.logAlpha * (logp + hp.targetEntropy);
  }
  return { critic, actorL, alphaL };
}

function relErr(a, b) {
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-3);
  return Math.abs(a - b) / denom;
}

// ─── 1. Numeric gradient check ───────────────────────────────────────────────
console.log('\n1. SAC analytic vs numeric gradients (JS)');
{
  const nets = {
    actor: randNet([OBS, H, 2 * ACT]),
    q1: randNet([OBS + ACT, H, 1]),
    q2: randNet([OBS + ACT, H, 1]),
    tq1: randNet([OBS + ACT, H, 1]),
    tq2: randNet([OBS + ACT, H, 1]),
  };
  const hp = { gamma: 0.99, logAlpha: Math.log(0.17), targetEntropy: -ACT };
  const data = makeBatch();

  nets.actor.zeroGrad(); nets.q1.zeroGrad(); nets.q2.zeroGrad();
  const r = accumulateSACGrads(nets, hp, data);

  const EPSFD = 1e-5;
  const checkParams = (net, lossKey, label, count = 30) => {
    let worst = 0;
    for (let t = 0; t < count; t++) {
      const l = Math.floor(rand() * net.W.length);
      const useB = rand() < 0.25;
      const arr = useB ? net.b[l] : net.W[l];
      const g = useB ? net.gb[l] : net.gW[l];
      const i = Math.floor(rand() * arr.length);
      const keep = arr[i];
      arr[i] = keep + EPSFD;
      const up = sacLosses(nets, hp, data)[lossKey];
      arr[i] = keep - EPSFD;
      const dn = sacLosses(nets, hp, data)[lossKey];
      arr[i] = keep;
      worst = Math.max(worst, relErr((up - dn) / (2 * EPSFD), g[i]));
    }
    check(`${label} grads match (worst rel err ${worst.toExponential(2)})`, worst < 1e-4);
  };
  checkParams(nets.actor, 'actorL', 'actor');
  checkParams(nets.q1, 'critic', 'q1');
  checkParams(nets.q2, 'critic', 'q2');

  const keep = hp.logAlpha;
  hp.logAlpha = keep + EPSFD;
  // alphaL holds logp fixed under α perturbation by construction (logp does
  // not depend on α), so a plain recompute is the correct detached loss.
  const up = sacLosses(nets, hp, data).alphaL;
  hp.logAlpha = keep - EPSFD;
  const dn = sacLosses(nets, hp, data).alphaL;
  hp.logAlpha = keep;
  const numLa = (up - dn) / (2 * EPSFD);
  check(`logα grad matches (rel err ${relErr(numLa, r.gLa).toExponential(2)})`, relErr(numLa, r.gLa) < 1e-5);
}

// ─── 2. WASM ↔ JS parity ─────────────────────────────────────────────────────
console.log('\n2. WASM ↔ JS parity');
const wasmBytes = await readFile(new URL('../scripts/nn_wasm.wasm', import.meta.url));
let wasmInst;
const imports = {
  env: {
    exp: Math.exp, tanh: Math.tanh, log: Math.log,
    memset: (ptr, val, len) => {
      new Uint8Array(wasmInst.exports.memory.buffer).fill(val & 0xff, ptr, ptr + len);
      return ptr;
    },
    memcpy: (dst, src, len) => {
      new Uint8Array(wasmInst.exports.memory.buffer).copyWithin(dst, src, src + len);
      return dst;
    },
  },
};
wasmInst = (await WebAssembly.instantiate(wasmBytes, imports)).instance;

function wasmArena() {
  let off = wasmInst.exports.get_heap_base();
  const alloc = (n, Type = Float64Array) => {
    off = (off + 7) & ~7;
    const bytes = n * Type.BYTES_PER_ELEMENT;
    while (off + bytes > wasmInst.exports.memory.buffer.byteLength) {
      wasmInst.exports.memory.grow(16);
    }
    const ptr = off;
    off += bytes;
    return ptr;
  };
  const f64 = (ptr, n) => new Float64Array(wasmInst.exports.memory.buffer, ptr, n);
  const i32 = (ptr, n) => new Int32Array(wasmInst.exports.memory.buffer, ptr, n);
  return { alloc, f64, i32 };
}

{
  const nets = {
    actor: randNet([OBS, H, 2 * ACT]),
    q1: randNet([OBS + ACT, H, 1]),
    q2: randNet([OBS + ACT, H, 1]),
    tq1: randNet([OBS + ACT, H, 1]),
    tq2: randNet([OBS + ACT, H, 1]),
  };
  const hp = { gamma: 0.99, logAlpha: Math.log(0.3), targetEntropy: -ACT };
  const data = makeBatch();

  nets.actor.zeroGrad(); nets.q1.zeroGrad(); nets.q2.zeroGrad();
  const js = accumulateSACGrads(nets, hp, data);
  const jsAG = nets.actor.gradFlatF64();
  const jsQ1G = nets.q1.gradFlatF64();
  const jsQ2G = nets.q2.gradFlatF64();

  const A = wasmArena();
  const aSizes = nets.actor.sizes, qSizes = nets.q1.sizes;
  const put = (arr, Type = Float64Array) => {
    const ptr = A.alloc(arr.length, Type);
    (Type === Int32Array ? A.i32(ptr, arr.length) : A.f64(ptr, arr.length)).set(arr);
    return ptr;
  };
  const pAS = put(aSizes, Int32Array), pQS = put(qSizes, Int32Array);
  const pAF = put(nets.actor.flatF64());
  const pQ1 = put(nets.q1.flatF64()), pQ2 = put(nets.q2.flatF64());
  const pT1 = put(nets.tq1.flatF64()), pT2 = put(nets.tq2.flatF64());
  const pObs = put(data.obs), pAct = put(data.act), pRew = put(data.rew);
  const pObs2 = put(data.obs2), pDone = put(data.done);
  const pNo = put(data.noise), pNo2 = put(data.noise2);
  const nAP = nets.actor.paramCount(), nQP = nets.q1.paramCount();
  const pAG = A.alloc(nAP), pQ1G = A.alloc(nQP), pQ2G = A.alloc(nQP);
  const pGLa = A.alloc(1), pLoss = A.alloc(4);
  A.f64(pAG, nAP).fill(0); A.f64(pQ1G, nQP).fill(0); A.f64(pQ2G, nQP).fill(0);
  A.f64(pGLa, 1).fill(0); A.f64(pLoss, 4).fill(0);

  wasmInst.exports.compute_sac_grads(
    N, OBS, ACT,
    aSizes.length, pAS, qSizes.length, pQS,
    pAF, pQ1, pQ2, pT1, pT2,
    hp.logAlpha, hp.gamma, hp.targetEntropy,
    pObs, pAct, pRew, pObs2, pDone, pNo, pNo2,
    pAG, pQ1G, pQ2G, pGLa, pLoss,
  );

  const maxDiff = (a, b) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  };
  const wAG = A.f64(pAG, nAP), wQ1G = A.f64(pQ1G, nQP), wQ2G = A.f64(pQ2G, nQP);
  const wLoss = A.f64(pLoss, 4), wGLa = A.f64(pGLa, 1);
  // -ffast-math reorders float ops, so allow small absolute drift
  check(`SAC actor grads match (max |Δ| ${maxDiff(wAG, jsAG).toExponential(2)})`, maxDiff(wAG, jsAG) < 1e-9);
  check(`SAC q1 grads match (max |Δ| ${maxDiff(wQ1G, jsQ1G).toExponential(2)})`, maxDiff(wQ1G, jsQ1G) < 1e-9);
  check(`SAC q2 grads match (max |Δ| ${maxDiff(wQ2G, jsQ2G).toExponential(2)})`, maxDiff(wQ2G, jsQ2G) < 1e-9);
  check('SAC logα grad matches', Math.abs(wGLa[0] - js.gLa) < 1e-9);
  check('SAC losses match',
    Math.abs(wLoss[0] - js.q) < 1e-8 && Math.abs(wLoss[1] - js.pi) < 1e-8 &&
    Math.abs(wLoss[2] - js.ent) < 1e-8 && Math.abs(wLoss[3] - js.std) < 1e-8);
}

{
  // PPO regression — same recompiled .wasm must still match the JS PPO path
  const actor = randNet([OBS, H, ACT]);
  const critic = randNet([OBS, H, 1]);
  const logStd = Float64Array.from({ length: ACT }, () => -0.5 + nrand() * 0.1);
  const hp = { clip: 0.2, entropyCoef: 0.003, vfCoef: 0.5 };
  const data = makeBatch();
  const ppoData = {
    n: N, obsDim: OBS, actDim: ACT,
    obs: data.obs, act: data.act,
    logp: Float64Array.from({ length: N }, () => -2 + nrand() * 0.3),
    adv: Float64Array.from({ length: N }, () => nrand()),
    ret: Float64Array.from({ length: N }, () => nrand()),
  };

  actor.zeroGrad(); critic.zeroGrad();
  const js = accumulatePPOGrads(actor, critic, logStd, hp, ppoData);
  const jsAG = actor.gradFlatF64(), jsCG = critic.gradFlatF64();

  const A = wasmArena();
  const put = (arr, Type = Float64Array) => {
    const ptr = A.alloc(arr.length, Type);
    (Type === Int32Array ? A.i32(ptr, arr.length) : A.f64(ptr, arr.length)).set(arr);
    return ptr;
  };
  const pAS = put(actor.sizes, Int32Array), pCS = put(critic.sizes, Int32Array);
  const pAF = put(actor.flatF64()), pCF = put(critic.flatF64()), pLS = put(logStd);
  const pObs = put(ppoData.obs), pAct = put(ppoData.act);
  const pLp = put(ppoData.logp), pAdv = put(ppoData.adv), pRet = put(ppoData.ret);
  const nAP = actor.paramCount(), nCP = critic.paramCount();
  const pAG = A.alloc(nAP), pCG = A.alloc(nCP), pGLS = A.alloc(ACT), pLoss = A.alloc(3);
  A.f64(pAG, nAP).fill(0); A.f64(pCG, nCP).fill(0);
  A.f64(pGLS, ACT).fill(0); A.f64(pLoss, 3).fill(0);

  wasmInst.exports.compute_ppo_grads(
    N, OBS, ACT,
    actor.sizes.length, pAS, critic.sizes.length, pCS,
    pAF, pCF, pLS, hp.clip, hp.entropyCoef, hp.vfCoef,
    pObs, pAct, pLp, pAdv, pRet,
    pAG, pCG, pGLS, pLoss,
  );

  const maxDiff = (a, b) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  };
  check('PPO actor grads still match', maxDiff(A.f64(pAG, nAP), jsAG) < 1e-9);
  check('PPO critic grads still match', maxDiff(A.f64(pCG, nCP), jsCG) < 1e-9);
  check('PPO logStd grads still match', maxDiff(A.f64(pGLS, ACT), js.gLs) < 1e-9);
}

// ─── 3. End-to-end SAC learning sanity ───────────────────────────────────────
//  2-D point-mass: state = position, action = velocity (bounded ±1·dt·3).
//  Reward = −|pos|; optimal behaviour drives to the origin and stays.
console.log('\n3. End-to-end SAC sanity (2-D point-mass)');
{
  const sObs = 2, sAct = 2, sH = 32, B = 64, GAMMA = 0.98, TAU = 0.01, LR = 3e-3;
  const actor = new Net([sObs, sH, 2 * sAct], 0.01);
  const q1 = new Net([sObs + sAct, sH, 1], 1);
  const q2 = new Net([sObs + sAct, sH, 1], 1);
  const tq1 = new Net(q1.sizes, 1); tq1.loadFlat(q1.flatF64());
  const tq2 = new Net(q2.sizes, 1); tq2.loadFlat(q2.flatF64());
  let logAlpha = Math.log(0.2), laM = 0, laV = 0, laT = 0;
  const nets = { actor, q1, q2, tq1, tq2 };

  const CAP = 20000;
  const rb = {
    size: 0, idx: 0,
    obs: new Float64Array(CAP * sObs), act: new Float64Array(CAP * sAct),
    rew: new Float64Array(CAP), obs2: new Float64Array(CAP * sObs),
    done: new Float64Array(CAP),
  };

  const sampleAct = (o, out) => {
    const v = actor.forward(o);
    for (let d = 0; d < sAct; d++) {
      const ls = clampLs(v[sAct + d]);
      out[d] = Math.tanh(v[d] + Math.exp(ls) * nrand());
    }
  };

  let pos = [nrand() * 2, nrand() * 2], epStep = 0;
  const evalReturn = () => {
    let total = 0;
    for (let trial = 0; trial < 8; trial++) {
      let p = [nrand() * 2, nrand() * 2];
      for (let t = 0; t < 50; t++) {
        const v = actor.forward(Float64Array.from(p));
        p[0] += Math.tanh(v[0]) * 0.3; p[1] += Math.tanh(v[1]) * 0.3;
        total += -Math.hypot(p[0], p[1]);
      }
    }
    return total / 8;
  };
  const before = evalReturn();

  const a = new Float64Array(sAct);
  for (let step = 0; step < 14000; step++) {
    const o = Float64Array.from(pos);
    sampleAct(o, a);
    pos[0] += a[0] * 0.3; pos[1] += a[1] * 0.3;
    const r = -Math.hypot(pos[0], pos[1]);
    epStep++;
    const truncate = epStep >= 50;
    rb.obs.set(o, rb.idx * sObs); rb.act.set(a, rb.idx * sAct);
    rb.rew[rb.idx] = r; rb.obs2.set(pos, rb.idx * sObs);
    rb.done[rb.idx] = 0; // time-limit truncation only — always bootstrap
    rb.idx = (rb.idx + 1) % CAP; rb.size = Math.min(CAP, rb.size + 1);
    if (truncate) { pos = [nrand() * 2, nrand() * 2]; epStep = 0; }

    if (rb.size < 500 || step % 2) continue;
    // one SAC gradient step
    const data = {
      n: B, obsDim: sObs, actDim: sAct,
      obs: new Float64Array(B * sObs), act: new Float64Array(B * sAct),
      rew: new Float64Array(B), obs2: new Float64Array(B * sObs),
      done: new Float64Array(B),
      noise: new Float64Array(B * sAct), noise2: new Float64Array(B * sAct),
    };
    for (let k = 0; k < B; k++) {
      const j = Math.floor(rand() * rb.size);
      data.obs.set(rb.obs.subarray(j * sObs, (j + 1) * sObs), k * sObs);
      data.act.set(rb.act.subarray(j * sAct, (j + 1) * sAct), k * sAct);
      data.rew[k] = rb.rew[j];
      data.obs2.set(rb.obs2.subarray(j * sObs, (j + 1) * sObs), k * sObs);
      data.done[k] = rb.done[j];
    }
    for (let i = 0; i < B * sAct; i++) { data.noise[i] = nrand(); data.noise2[i] = nrand(); }

    actor.zeroGrad(); q1.zeroGrad(); q2.zeroGrad();
    const res = accumulateSACGrads(nets, { gamma: GAMMA, logAlpha, targetEntropy: -sAct }, data);
    actor.adamStep(LR, 1 / B); q1.adamStep(LR, 1 / B); q2.adamStep(LR, 1 / B);
    laT++;
    const g = res.gLa / B, b1 = 0.9, b2 = 0.999;
    laM = b1 * laM + (1 - b1) * g; laV = b2 * laV + (1 - b2) * g * g;
    logAlpha -= LR * (laM / (1 - b1 ** laT)) / (Math.sqrt(laV / (1 - b2 ** laT)) + 1e-8);
    for (const [q, tq] of [[q1, tq1], [q2, tq2]]) {
      for (let l = 0; l < q.W.length; l++) {
        for (let i = 0; i < q.W[l].length; i++) tq.W[l][i] += TAU * (q.W[l][i] - tq.W[l][i]);
        for (let i = 0; i < q.b[l].length; i++) tq.b[l][i] += TAU * (q.b[l][i] - tq.b[l][i]);
      }
    }
  }

  const after = evalReturn();
  // Optimal is ≈ −12 (sum of shrinking distances on approach), a random
  // policy ≈ −135. The bar here is "clearly learned", not "converged" —
  // sign/direction errors land near random, so −40 separates them cleanly.
  console.log(`  return before ${before.toFixed(1)} → after ${after.toFixed(1)} (α ${Math.exp(logAlpha).toFixed(3)})`);
  check('SAC learns the point-mass task (return > −40)', after > -40);
  check('SAC improved substantially', after > before + 60);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
