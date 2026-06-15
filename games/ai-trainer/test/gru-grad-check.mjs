'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  gru-grad-check.mjs — finite-difference verification of the GRU BPTT and the
//  recurrent PPO gradient in nn-core.js.
//
//  Run:  node games/ai-trainer/test/gru-grad-check.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { GRUNet, accumulatePPORecurrentGrads, LOG_2PI } from '../scripts/nn-core.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const I = 4, H = 5, O = 3, T = 6;
const EPS = 1e-6, TOL = 1e-4;

function randSeq(n) { const a = new Float64Array(n); for (let k = 0; k < n; k++) a[k] = Math.random() * 2 - 1; return a; }

// ── Test 1: pure GRU BPTT against a quadratic output loss ────────────────────
{
  const net = new GRUNet([I, H, O]);
  const obs = randSeq(T * I);
  const h0 = randSeq(H);
  const target = randSeq(T * O);
  const done = new Float64Array(T); done[2] = 1;  // mid-sequence episode reset

  // L = Σ_t Σ_o ½(y−target)²  ;  dL/dy = (y−target)
  const lossOf = (n) => {
    const { ys } = n.seqForward(obs, T, h0, done);
    let L = 0;
    for (let k = 0; k < T * O; k++) L += 0.5 * (ys[k] - target[k]) ** 2;
    return L;
  };

  const { ys, caches } = net.seqForward(obs, T, h0, done);
  const dY = new Float64Array(T * O);
  for (let k = 0; k < T * O; k++) dY[k] = ys[k] - target[k];
  net.zeroGrad();
  net.seqBackward(caches, dY, done);
  const g = net.gradFlatF64();

  const flat = net.flatF64();
  let maxErr = 0, worst = -1;
  for (let p = 0; p < flat.length; p++) {
    const orig = flat[p];
    flat[p] = orig + EPS; net.loadFlat(flat); const Lp = lossOf(net);
    flat[p] = orig - EPS; net.loadFlat(flat); const Lm = lossOf(net);
    flat[p] = orig; net.loadFlat(flat);
    const num = (Lp - Lm) / (2 * EPS);
    const err = Math.abs(num - g[p]) / (Math.abs(num) + Math.abs(g[p]) + 1e-6);
    if (err > maxErr) { maxErr = err; worst = p; }
  }
  check('GRU BPTT matches finite differences (quadratic loss)', maxErr < TOL,
        `max rel err ${maxErr.toExponential(2)} at param ${worst}/${flat.length}`);
}

// ── Test 2: recurrent PPO gradient (actor, critic, logStd) ───────────────────
{
  const actDim = O;
  const actor = new GRUNet([I, H, actDim]);
  const critic = new GRUNet([I, H, 1]);
  const logStd = new Float64Array(actDim).fill(-0.5);
  const hp = { clip: 0.2, entropyCoef: 0.01, vfCoef: 0.5 };

  const obs = randSeq(T * I);
  const act = randSeq(T * actDim);
  const adv = randSeq(T);
  const ret = randSeq(T);
  const done = new Float64Array(T); done[3] = 1;
  const h0a = randSeq(H), h0c = randSeq(H);
  // behaviour log-probs from a slightly perturbed policy so ratios ≠ 1 and we
  // sit away from the clip boundary (keeps the surrogate locally smooth)
  const logp = new Float64Array(T);
  {
    const tmp = new GRUNet([I, H, actDim]); tmp.loadFlat(actor.flatF64());
    const f = tmp.flatF64(); for (let k = 0; k < f.length; k++) f[k] += 0.05 * (Math.random() * 2 - 1); tmp.loadFlat(f);
    const { ys } = tmp.seqForward(obs, T, h0a);
    for (let t = 0; t < T; t++) {
      let lp = 0;
      for (let d = 0; d < actDim; d++) {
        const sd = Math.exp(logStd[d]);
        const z = (act[t * actDim + d] - ys[t * actDim + d]) / sd;
        lp += -0.5 * z * z - logStd[d] - 0.5 * LOG_2PI;
      }
      logp[t] = lp;
    }
  }
  const seq = { T, obsDim: I, actDim, obs, act, logp, adv, ret, done, h0a, h0c };

  // Loss components reproduced for finite differencing.
  const piLoss = (a, ls) => {
    const { ys } = a.seqForward(obs, T, h0a, done);
    let L = 0;
    for (let t = 0; t < T; t++) {
      let lp = 0;
      for (let d = 0; d < actDim; d++) {
        const sd = Math.exp(ls[d]);
        const z = (act[t * actDim + d] - ys[t * actDim + d]) / sd;
        lp += -0.5 * z * z - ls[d] - 0.5 * LOG_2PI;
      }
      const ratio = Math.exp(Math.min(20, lp - logp[t]));
      const clip = Math.max(1 - hp.clip, Math.min(1 + hp.clip, ratio));
      L += -Math.min(ratio * adv[t], clip * adv[t]);
    }
    return L;
  };
  const entLoss = (ls) => {
    let L = 0;
    for (let t = 0; t < T; t++) for (let d = 0; d < actDim; d++) L += -hp.entropyCoef * (ls[d] + 0.5 * (LOG_2PI + 1));
    return L;
  };
  const vLoss = (c) => {
    const { ys } = c.seqForward(obs, T, h0c, done);
    let L = 0;
    for (let t = 0; t < T; t++) L += hp.vfCoef * 0.5 * (ys[t] - ret[t]) ** 2;
    return L;
  };

  actor.zeroGrad(); critic.zeroGrad();
  const r = accumulatePPORecurrentGrads(actor, critic, logStd, hp, seq);
  const gA = actor.gradFlatF64(), gC = critic.gradFlatF64();

  // actor params vs piLoss
  {
    const flat = actor.flatF64(); let maxErr = 0, worst = -1;
    for (let p = 0; p < flat.length; p++) {
      const orig = flat[p];
      flat[p] = orig + EPS; actor.loadFlat(flat); const Lp = piLoss(actor, logStd);
      flat[p] = orig - EPS; actor.loadFlat(flat); const Lm = piLoss(actor, logStd);
      flat[p] = orig; actor.loadFlat(flat);
      const num = (Lp - Lm) / (2 * EPS);
      const err = Math.abs(num - gA[p]) / (Math.abs(num) + Math.abs(gA[p]) + 1e-6);
      if (err > maxErr) { maxErr = err; worst = p; }
    }
    check('recurrent PPO actor grads match finite differences', maxErr < TOL,
          `max rel err ${maxErr.toExponential(2)} at param ${worst}`);
  }
  // critic params vs vLoss
  {
    const flat = critic.flatF64(); let maxErr = 0, worst = -1;
    for (let p = 0; p < flat.length; p++) {
      const orig = flat[p];
      flat[p] = orig + EPS; critic.loadFlat(flat); const Lp = vLoss(critic);
      flat[p] = orig - EPS; critic.loadFlat(flat); const Lm = vLoss(critic);
      flat[p] = orig; critic.loadFlat(flat);
      const num = (Lp - Lm) / (2 * EPS);
      const err = Math.abs(num - gC[p]) / (Math.abs(num) + Math.abs(gC[p]) + 1e-6);
      if (err > maxErr) { maxErr = err; worst = p; }
    }
    check('recurrent PPO critic grads match finite differences', maxErr < TOL,
          `max rel err ${maxErr.toExponential(2)} at param ${worst}`);
  }
  // logStd vs piLoss + entLoss
  {
    let maxErr = 0, worst = -1;
    for (let d = 0; d < actDim; d++) {
      const orig = logStd[d];
      logStd[d] = orig + EPS; const Lp = piLoss(actor, logStd) + entLoss(logStd);
      logStd[d] = orig - EPS; const Lm = piLoss(actor, logStd) + entLoss(logStd);
      logStd[d] = orig;
      const num = (Lp - Lm) / (2 * EPS);
      const err = Math.abs(num - r.gLs[d]) / (Math.abs(num) + Math.abs(r.gLs[d]) + 1e-6);
      if (err > maxErr) { maxErr = err; worst = d; }
    }
    check('recurrent PPO logStd grads match finite differences', maxErr < TOL,
          `max rel err ${maxErr.toExponential(2)} at dim ${worst}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll GRU gradient checks passed');
process.exit(failures ? 1 : 0);
