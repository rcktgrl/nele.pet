'use strict';
/* global tf, importScripts */
// ─────────────────────────────────────────────────────────────────────────────
//  tf-worker.js — GPU training backend on TensorFlow.js (WebGL)
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
//  The ENTIRE PPO update (advantage-normalised batch in → all epochs of
//  shuffled minibatch Adam steps) runs here; only the final weights and the
//  loss scalars are read back — one GPU→CPU sync per update.
//
//  Protocol (classic worker, spawned by sim-worker):
//    → {type:'init', actorSizes, criticSizes, actorFlat, criticFlat, logStd, lr}
//    ← {type:'ready', backend} | {type:'fail', error}
//    → {type:'setWeights', actorFlat, criticFlat, logStd}  (reset / load-best)
//    → {type:'update', n, obs, act, logp, adv, ret, hp, epochs, minibatch}
//    ← {type:'updated', actorFlat, criticFlat, logStd, loss:{pi,v,ent}, ms}
//    ← {type:'error', error}
//  Flat weight arrays use the trainer's Net.flat() layout:
//  per layer, all weight rows (nOut × nIn), then all biases.
// ─────────────────────────────────────────────────────────────────────────────

importScripts('./vendor/tf.min.js');

const LOG_2PI = Math.log(2 * Math.PI);

let AS = null, CS = null;   // actor / critic layer sizes
let I = 0, A = 0;           // obs dim, action dim
let aVars = null, cVars = null;   // { Ws: variable[], bs: variable[] }
let lsVar = null;           // logStd variable [A]
let varList = [];
let opt = null, optLr = 0;

// Variables keep weights as [nOut, nIn] — exactly Net.flat()'s row-major
// layout, so sync is a straight copy and forward uses transposed matMul.
function buildVars(sizes, flat, tag) {
  const Ws = [], bs = [];
  let k = 0;
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    Ws.push(tf.variable(tf.tensor2d(flat.subarray(k, k + nOut * nIn), [nOut, nIn]), true, tag + 'W' + l));
    k += nOut * nIn;
    bs.push(tf.variable(tf.tensor1d(flat.subarray(k, k + nOut)), true, tag + 'b' + l));
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

  // KL movement (k3 estimator) of the live actor vs the stored behavior
  // log-probs, on a fixed leading subsample — mirrors the CPU path's
  // early-epoch-stop so both backends train identically.
  const klSub = Math.min(512, n);
  const klEstimate = async () => {
    const t = tf.tidy(() => {
      const obs  = tf.slice(obsT,  [0, 0], [klSub, -1]);
      const act  = tf.slice(actT,  [0, 0], [klSub, -1]);
      const logp = tf.slice(logpT, [0], [klSub]);
      const mu = fwd(aVars, obs);
      const z  = act.sub(mu).div(tf.exp(lsVar));
      const lp = z.square().mul(-0.5).sub(lsVar).sub(0.5 * LOG_2PI).sum(1);
      const dlt = tf.minimum(lp.sub(logp), 20);
      return tf.exp(dlt).sub(1).sub(dlt).mean();
    });
    const v = (await t.data())[0];
    t.dispose();
    return v;
  };
  const klStop = !!(hp.klStop);
  const kl0 = klStop ? await klEstimate() : 0;
  let epochsRan = 0, lastKl = 0;

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
      epochsRan = ep + 1;
      if (klStop) {
        lastKl = (await klEstimate()) - kl0;
        if (lastKl > hp.klLimit) break;
      }
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
      loss: { pi, v, ent }, epochs: epochsRan, kl: lastKl,
      ms: performance.now() - t0,
    }, [actorFlat.buffer, criticFlat.buffer, logStd.buffer]);
  } finally {
    tf.dispose([obsT, actT, logpT, advT, retT]);
  }
}

self.onmessage = async function (e) {
  const d = e.data;
  try {
    if (d.type === 'init') {
      AS = d.actorSizes.slice();
      CS = d.criticSizes.slice();
      I = AS[0]; A = AS[AS.length - 1];
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
      cVars = buildVars(CS, d.criticFlat, 'c');
      lsVar = tf.variable(tf.tensor1d(d.logStd), true, 'logStd');
      varList = [...aVars.Ws, ...aVars.bs, ...cVars.Ws, ...cVars.bs, lsVar];
      makeOpt(d.lr);
      postMessage({ type: 'ready', backend: tf.getBackend() });
      return;
    }
    if (d.type === 'setWeights') {
      assignVars(aVars, AS, d.actorFlat);
      assignVars(cVars, CS, d.criticFlat);
      tf.tidy(() => lsVar.assign(tf.tensor1d(d.logStd)));
      makeOpt(optLr);  // weights jumped — stale Adam moments would fight the new weights
      return;
    }
    if (d.type === 'update') {
      await runUpdate(d);
      return;
    }
  } catch (err) {
    postMessage({ type: 'error', error: String(err && err.message || err) });
  }
};
