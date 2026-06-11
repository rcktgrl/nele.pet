'use strict';
/* global tf, importScripts */
// ─────────────────────────────────────────────────────────────────────────────
//  tf-worker.js — GPU training backend on TensorFlow.js (WebGL), PPO + SAC
//
//  Replaces the hand-written WebGPU gradient kernel (gpu-grad.js, now only
//  used by the gpu-check diagnostic page). Rationale: Firefox's WebGPU is
//  still experimental — buffer mapAsync completion is driven by a 100 ms
//  polling timer (Bugzilla #1870699 / wgpu #6660), which makes every
//  readback-fenced compute design either monopolise the GPU or stall, and
//  its WebGPU process is crash-prone under sustained compute load. TF.js'
//  WebGL backend is the path browsers have run ML training on for years:
//  small, properly tiled kernels with no manual fences.
//
//  The ENTIRE update runs here; only the final weights and the loss scalars
//  are read back — one GPU→CPU sync per update message.
//    · PPO: advantage-normalised batch in → all epochs of shuffled minibatch
//      Adam steps.
//    · SAC: a round of G sequential gradient steps; the sim-worker samples
//      the G minibatches from its replay buffer up-front (uniform sampling
//      does not depend on the weights, so pre-sampling is exact) and ships
//      them as one flat batch.
//
//  Protocol (classic worker, spawned by sim-worker):
//    → {type:'init', actorSizes, criticSizes, actorFlat, criticFlat, logStd, lr}
//      or {type:'init', algo:'sac', actorSizes, qSizes, actorFlat, q1Flat,
//          q2Flat, tq1Flat, tq2Flat, logAlpha, lr, gamma, targetEntropy, tau}
//    ← {type:'ready', backend} | {type:'fail', error}
//    → {type:'setWeights', …same flats as init…}  (reset / load-best)
//    → {type:'update', n, obs, act, logp, adv, ret, hp, epochs, minibatch}
//      or {type:'update', steps, batchSize, obs, act, rew, obs2, done, lr}
//    ← {type:'updated', …new flats…, loss:{…}, ms}
//    ← {type:'error', error}
//  Flat weight arrays use the trainer's Net.flat() layout:
//  per layer, all weight rows (nOut × nIn), then all biases.
// ─────────────────────────────────────────────────────────────────────────────

importScripts('./vendor/tf.min.js');

const LOG_2PI = Math.log(2 * Math.PI);
const SAC_LOGSTD_MIN = -5, SAC_LOGSTD_MAX = 2, TANH_EPS = 1e-6;

let ALGO = 'ppo';
let AS = null, CS = null;   // actor / critic layer sizes
let I = 0, A = 0;           // obs dim, action dim
let aVars = null, cVars = null;   // { Ws: variable[], bs: variable[] }
let lsVar = null;           // logStd variable [A]
let varList = [];
let opt = null, optLr = 0;

// SAC state
let QS = null;                          // q-net layer sizes
let q1Vars = null, q2Vars = null;       // twin critics
let t1Vars = null, t2Vars = null;       // target critics (not trained)
let laVar = null;                       // logα scalar variable
let optActor = null, optCritic = null, optAlpha = null;
let sacHp = { gamma: 0.99, targetEntropy: -6, tau: 0.005 };

// Variables keep weights as [nOut, nIn] — exactly Net.flat()'s row-major
// layout, so sync is a straight copy and forward uses transposed matMul.
function buildVars(sizes, flat, tag, trainable = true) {
  const Ws = [], bs = [];
  let k = 0;
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    Ws.push(tf.variable(tf.tensor2d(flat.subarray(k, k + nOut * nIn), [nOut, nIn]), trainable, tag + 'W' + l));
    k += nOut * nIn;
    bs.push(tf.variable(tf.tensor1d(flat.subarray(k, k + nOut)), trainable, tag + 'b' + l));
    k += nOut;
  }
  return { Ws, bs };
}

function assignVars(v, sizes, flat) {
  tf.tidy(() => {
    let k = 0;
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      v.Ws[l].assign(tf.tensor2d(flat.subarray(k, k + nOut * nIn), [nOut, nIn]));
      k += nOut * nIn;
      v.bs[l].assign(tf.tensor1d(flat.subarray(k, k + nOut)));
      k += nOut;
    }
  });
}

async function flattenVars(v) {
  let total = 0;
  for (const w of v.Ws) total += w.size;
  for (const b of v.bs) total += b.size;
  const out = new Float32Array(total);
  let k = 0;
  for (let l = 0; l < v.Ws.length; l++) {
    const w = await v.Ws[l].data(); out.set(w, k); k += w.length;
    const b = await v.bs[l].data(); out.set(b, k); k += b.length;
  }
  return out;
}

// MLP forward: tanh hidden layers, linear output.
function fwd(v, x) {
  let a = x;
  for (let l = 0; l < v.Ws.length; l++) {
    a = tf.matMul(a, v.Ws[l], false, true).add(v.bs[l]);
    if (l < v.Ws.length - 1) a = tf.tanh(a);
  }
  return a;
}

function makeOpt(lr) {
  if (opt) opt.dispose();
  opt = tf.train.adam(lr, 0.9, 0.999, 1e-8);
  optLr = lr;
}

// PPO clipped-surrogate + value + entropy loss — same math as nn-core.js'
// accumulatePPOGrads, expressed as tensors so tf autograd derives the
// gradients (per-sample means, matching the JS path's 1/batch scaling).
function ppoLoss(obs, act, logp, adv, ret, hp) {
  const mu = fwd(aVars, obs);                                       // [B,A]
  const z  = act.sub(mu).div(tf.exp(lsVar));                        // [B,A]
  const lp = z.square().mul(-0.5).sub(lsVar).sub(0.5 * LOG_2PI).sum(1); // [B]
  const ratio   = tf.exp(tf.minimum(lp.sub(logp), 20));
  const clipped = tf.clipByValue(ratio, 1 - hp.clip, 1 + hp.clip);
  const lossPi  = tf.minimum(ratio.mul(adv), clipped.mul(adv)).mean().neg();
  const v     = fwd(cVars, obs).reshape([-1]);
  const lossV = v.sub(ret).square().mean().mul(0.5);
  const ent   = lsVar.sum().add(0.5 * A * (LOG_2PI + 1));           // per-sample entropy
  const total = lossPi.add(lossV.mul(hp.vfCoef)).sub(ent.mul(hp.entropyCoef));
  return { lossPi, lossV, ent, total };
}

async function runUpdate(d) {
  const t0 = performance.now();
  const n = d.n, hp = d.hp;
  if (hp.lr !== optLr) { opt.learningRate = hp.lr; optLr = hp.lr; }

  const obsT  = tf.tensor2d(d.obs, [n, I]);
  const actT  = tf.tensor2d(d.act, [n, A]);
  const logpT = tf.tensor1d(d.logp);
  const advT  = tf.tensor1d(d.adv);
  const retT  = tf.tensor1d(d.ret);

  const mbs = Math.max(8, d.minibatch | 0);
  const idx = new Int32Array(n);
  for (let k = 0; k < n; k++) idx[k] = k;

  try {
    for (let ep = 0; ep < d.epochs; ep++) {
      for (let k = n - 1; k > 0; k--) {  // Fisher-Yates shuffle
        const j = (Math.random() * (k + 1)) | 0;
        const t = idx[k]; idx[k] = idx[j]; idx[j] = t;
      }
      for (let s = 0; s < n; s += mbs) {
        const mb  = tf.tensor1d(idx.subarray(s, Math.min(n, s + mbs)), 'int32');
        const obs = tf.gather(obsT, mb),  act = tf.gather(actT, mb);
        const lpo = tf.gather(logpT, mb), adv = tf.gather(advT, mb);
        const ret = tf.gather(retT, mb);
        opt.minimize(() => ppoLoss(obs, act, lpo, adv, ret, hp).total, false, varList);
        tf.tidy(() => lsVar.assign(tf.clipByValue(lsVar, -2.5, 0.3)));
        tf.dispose([mb, obs, act, lpo, adv, ret]);
      }
      // yield so queued GPU work drains instead of piling up across epochs
      await new Promise(res => setTimeout(res, 0));
    }

    // Loss scalars over the full batch with the final weights (for the HUD).
    const lossT = tf.tidy(() => {
      const L = ppoLoss(obsT, actT, logpT, advT, retT, hp);
      return tf.stack([L.lossPi, L.lossV, L.ent]);
    });
    const [pi, v, ent] = await lossT.data();
    lossT.dispose();

    const actorFlat  = await flattenVars(aVars);
    const criticFlat = await flattenVars(cVars);
    const logStd     = new Float32Array(await lsVar.data());
    postMessage({
      type: 'updated', actorFlat, criticFlat, logStd,
      loss: { pi, v, ent }, ms: performance.now() - t0,
    }, [actorFlat.buffer, criticFlat.buffer, logStd.buffer]);
  } finally {
    tf.dispose([obsT, actT, logpT, advT, retT]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SAC — squashed-Gaussian actor, twin critics, learned temperature.
//  Math mirrors accumulateSACGrads in nn-core.js.
// ─────────────────────────────────────────────────────────────────────────────

// Sample a reparametrised action + its log-probability from the actor.
function sacSample(obs) {
  const out = fwd(aVars, obs);                                  // [B, 2A]
  const mu = tf.slice(out, [0, 0], [-1, A]);
  const ls = tf.clipByValue(tf.slice(out, [0, A], [-1, A]), SAC_LOGSTD_MIN, SAC_LOGSTD_MAX);
  const eps = tf.randomNormal(mu.shape);
  const a = tf.tanh(mu.add(tf.exp(ls).mul(eps)));
  const logp = eps.square().mul(-0.5).sub(ls).sub(0.5 * LOG_2PI)
    .sub(tf.log(tf.scalar(1).sub(a.square()).add(TANH_EPS)))
    .sum(1);                                                    // [B]
  return { a, logp, ls };
}

function qFwd(v, obs, act) {
  return fwd(v, tf.concat([obs, act], 1)).reshape([-1]);
}

function makeSacOpts(lr) {
  for (const o of [optActor, optCritic, optAlpha]) if (o) o.dispose();
  optActor  = tf.train.adam(lr, 0.9, 0.999, 1e-8);
  optCritic = tf.train.adam(lr, 0.9, 0.999, 1e-8);
  optAlpha  = tf.train.adam(lr, 0.9, 0.999, 1e-8);
  optLr = lr;
}

// One SAC gradient step on minibatch tensors (obs[B,I], act[B,A], rew[B],
// obs2[B,I], done[B]). Critic → actor → temperature → polyak.
function sacStep(obs, act, rew, obs2, done) {
  const actorVars  = [...aVars.Ws, ...aVars.bs];
  const criticVars = [...q1Vars.Ws, ...q1Vars.bs, ...q2Vars.Ws, ...q2Vars.bs];

  // Bootstrap target — outside any minimize(), so it is a constant below.
  const y = tf.tidy(() => {
    const { a: a2, logp: logp2 } = sacSample(obs2);
    const tmin = tf.minimum(qFwd(t1Vars, obs2, a2), qFwd(t2Vars, obs2, a2));
    const alpha = tf.exp(laVar);
    return rew.add(
      tf.scalar(1).sub(done).mul(sacHp.gamma)
        .mul(tmin.sub(alpha.mul(logp2))));
  });

  optCritic.minimize(() => {
    const e1 = qFwd(q1Vars, obs, act).sub(y);
    const e2 = qFwd(q2Vars, obs, act).sub(y);
    return e1.square().mean().mul(0.5).add(e2.square().mean().mul(0.5));
  }, false, criticVars);
  y.dispose();

  optActor.minimize(() => {
    const { a, logp } = sacSample(obs);
    const qMin = tf.minimum(qFwd(q1Vars, obs, a), qFwd(q2Vars, obs, a));
    // exp(laVar) participates in the graph but laVar is not in the var list,
    // so this stays a pure actor update (α is "detached" by exclusion).
    return tf.exp(laVar).mul(logp).sub(qMin).mean();
  }, false, actorVars);

  optAlpha.minimize(() => {
    // logp does not depend on laVar — no detach needed; matches SB3's
    // ent_coef loss with dJ/dlogα = −(logπ + H̄).
    const { logp } = sacSample(obs);
    return laVar.mul(logp.add(sacHp.targetEntropy)).mean().neg();
  }, false, [laVar]);

  tf.tidy(() => {
    for (const [t, q] of [[t1Vars, q1Vars], [t2Vars, q2Vars]]) {
      for (let l = 0; l < t.Ws.length; l++) {
        t.Ws[l].assign(t.Ws[l].mul(1 - sacHp.tau).add(q.Ws[l].mul(sacHp.tau)));
        t.bs[l].assign(t.bs[l].mul(1 - sacHp.tau).add(q.bs[l].mul(sacHp.tau)));
      }
    }
  });
}

async function runSacUpdate(d) {
  const t0 = performance.now();
  const G = d.steps, B = d.batchSize;
  if (d.lr !== optLr) makeSacOpts(d.lr);

  const obsT  = tf.tensor2d(d.obs,  [G * B, I]);
  const actT  = tf.tensor2d(d.act,  [G * B, A]);
  const rewT  = tf.tensor1d(d.rew);
  const obs2T = tf.tensor2d(d.obs2, [G * B, I]);
  const doneT = tf.tensor1d(d.done);

  try {
    for (let g = 0; g < G; g++) {
      const obs  = tf.slice(obsT,  [g * B, 0], [B, -1]);
      const act  = tf.slice(actT,  [g * B, 0], [B, -1]);
      const rew  = tf.slice(rewT,  [g * B], [B]);
      const obs2 = tf.slice(obs2T, [g * B, 0], [B, -1]);
      const done = tf.slice(doneT, [g * B], [B]);
      sacStep(obs, act, rew, obs2, done);
      tf.dispose([obs, act, rew, obs2, done]);
      // drain queued GPU work every few steps instead of piling up a round
      if ((g & 7) === 7) await new Promise(res => setTimeout(res, 0));
    }

    // Loss/stat scalars on the last minibatch with the final weights (HUD).
    const statT = tf.tidy(() => {
      const obs  = tf.slice(obsT,  [(G - 1) * B, 0], [B, -1]);
      const act  = tf.slice(actT,  [(G - 1) * B, 0], [B, -1]);
      const rew  = tf.slice(rewT,  [(G - 1) * B], [B]);
      const obs2 = tf.slice(obs2T, [(G - 1) * B, 0], [B, -1]);
      const done = tf.slice(doneT, [(G - 1) * B], [B]);
      const alpha = tf.exp(laVar);
      const { a: a2, logp: logp2 } = sacSample(obs2);
      const tmin = tf.minimum(qFwd(t1Vars, obs2, a2), qFwd(t2Vars, obs2, a2));
      const y = rew.add(tf.scalar(1).sub(done).mul(sacHp.gamma).mul(tmin.sub(alpha.mul(logp2))));
      const e1 = qFwd(q1Vars, obs, act).sub(y);
      const e2 = qFwd(q2Vars, obs, act).sub(y);
      const qLoss = e1.square().mean().mul(0.5).add(e2.square().mean().mul(0.5));
      const { a, logp, ls } = sacSample(obs);
      const qMin = tf.minimum(qFwd(q1Vars, obs, a), qFwd(q2Vars, obs, a));
      const piLoss = alpha.mul(logp).sub(qMin).mean();
      const ent = logp.mean().neg();
      const std = tf.exp(ls).mean();
      return tf.stack([qLoss, piLoss, ent, std]);
    });
    const [q, pi, ent, std] = await statT.data();
    statT.dispose();

    const actorFlat = await flattenVars(aVars);
    const q1Flat = await flattenVars(q1Vars);
    const q2Flat = await flattenVars(q2Vars);
    const tq1Flat = await flattenVars(t1Vars);
    const tq2Flat = await flattenVars(t2Vars);
    const logAlpha = (await laVar.data())[0];
    postMessage({
      type: 'updated', actorFlat, q1Flat, q2Flat, tq1Flat, tq2Flat, logAlpha,
      loss: { q, pi, ent, std }, ms: performance.now() - t0,
    }, [actorFlat.buffer, q1Flat.buffer, q2Flat.buffer, tq1Flat.buffer, tq2Flat.buffer]);
  } finally {
    tf.dispose([obsT, actT, rewT, obs2T, doneT]);
  }
}

self.onmessage = async function (e) {
  const d = e.data;
  try {
    if (d.type === 'init') {
      ALGO = d.algo === 'sac' ? 'sac' : 'ppo';
      AS = d.actorSizes.slice();
      I = AS[0];
      A = ALGO === 'sac' ? AS[AS.length - 1] / 2 : AS[AS.length - 1];
      const want = d.backend || 'webgl';  // override used by the node test harness
      let ok = false;
      try { ok = await tf.setBackend(want); } catch { ok = false; }
      if (!ok || tf.getBackend() !== want) {
        postMessage({ type: 'fail', error: 'WebGL backend unavailable in worker (OffscreenCanvas missing?)' });
        return;
      }
      await tf.ready();
      if (want === 'webgl' && !tf.env().getBool('WEBGL_RENDER_FLOAT32_ENABLED')) {
        postMessage({ type: 'fail', error: 'GPU lacks float32 render support — CPU backend will be more precise' });
        return;
      }
      aVars = buildVars(AS, d.actorFlat, 'a');
      if (ALGO === 'sac') {
        QS = d.qSizes.slice();
        q1Vars = buildVars(QS, d.q1Flat, 'q1');
        q2Vars = buildVars(QS, d.q2Flat, 'q2');
        t1Vars = buildVars(QS, d.tq1Flat, 't1', false);
        t2Vars = buildVars(QS, d.tq2Flat, 't2', false);
        laVar = tf.variable(tf.scalar(d.logAlpha), true, 'logAlpha');
        sacHp = { gamma: d.gamma, targetEntropy: d.targetEntropy, tau: d.tau };
        makeSacOpts(d.lr);
      } else {
        CS = d.criticSizes.slice();
        cVars = buildVars(CS, d.criticFlat, 'c');
        lsVar = tf.variable(tf.tensor1d(d.logStd), true, 'logStd');
        varList = [...aVars.Ws, ...aVars.bs, ...cVars.Ws, ...cVars.bs, lsVar];
        makeOpt(d.lr);
      }
      postMessage({ type: 'ready', backend: tf.getBackend() });
      return;
    }
    if (d.type === 'setWeights') {
      assignVars(aVars, AS, d.actorFlat);
      if (ALGO === 'sac') {
        assignVars(q1Vars, QS, d.q1Flat);
        assignVars(q2Vars, QS, d.q2Flat);
        assignVars(t1Vars, QS, d.tq1Flat);
        assignVars(t2Vars, QS, d.tq2Flat);
        tf.tidy(() => laVar.assign(tf.scalar(d.logAlpha)));
        makeSacOpts(optLr);  // weights jumped — stale Adam moments would fight them
      } else {
        assignVars(cVars, CS, d.criticFlat);
        tf.tidy(() => lsVar.assign(tf.tensor1d(d.logStd)));
        makeOpt(optLr);
      }
      return;
    }
    if (d.type === 'update') {
      if (ALGO === 'sac') await runSacUpdate(d);
      else await runUpdate(d);
      return;
    }
  } catch (err) {
    postMessage({ type: 'error', error: String(err && err.message || err) });
  }
};
