'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  grad-worker.js — parallel PPO/SAC gradient computation
//
//  Uses the compiled WASM module (nn_wasm.wasm, fetched from this directory)
//  for the hot inner loop, with automatic fallback to the pure-JS path in
//  nn-core.js.  Load status is reported to the sim-worker via
//  { type: 'wasmStatus' } messages so failures are visible, never silent.
//
//  Spawned by sim-worker.js.  Each { type: 'grad' } (PPO) or { type: 'sacGrad' }
//  message carries network weights + a batch slice; the reply is tagged
//  { type: 'gradResult' } with gradient sums in transferable buffers and
//  `mode: 'wasm' | 'js'`.
// ─────────────────────────────────────────────────────────────────────────────

import { Net, gauss, accumulatePPOGrads, accumulateSACGrads } from './nn-core.js';

// ── WASM loading ─────────────────────────────────────────────────────────────

let wasmInst  = null;
let wasmReady = false;

const wasmImports = {
  env: {
    exp:  Math.exp,
    tanh: Math.tanh,
    log:  Math.log,
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

(async () => {
  try {
    const url = new URL('./nn_wasm.wasm', import.meta.url);
    let result;
    try {
      result = await WebAssembly.instantiateStreaming(fetch(url), wasmImports);
    } catch (_) {
      // server may send a wrong MIME type — fall back to ArrayBuffer compile
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch ${resp.status} ${resp.statusText}`);
      result = await WebAssembly.instantiate(await resp.arrayBuffer(), wasmImports);
    }
    wasmInst  = result.instance;
    wasmReady = true;
    postMessage({ type: 'wasmStatus', ok: true });
  } catch (err) {
    postMessage({ type: 'wasmStatus', ok: false, error: String(err && err.message || err) });
  }
})();

// ── WASM memory layout ───────────────────────────────────────────────────────
//
// All inputs/outputs live in WASM linear memory starting at the module's heap
// base; the layout is recomputed only when the architecture or slice size
// changes.  Offsets are 8-byte aligned.

let arenaBase    = 0;
let cachedLayout = null;
let cachedKey    = '';

function align8(n) { return (n + 7) & ~7; }

function getLayout(actorSizes, criticSizes, n, obsDim, actDim) {
  const key = `${actorSizes}|${criticSizes}|${n}`;
  if (key === cachedKey) return cachedLayout;

  const nAL = actorSizes.length;
  const nCL = criticSizes.length;
  let nActorParams = 0;
  for (let l = 0; l < nAL - 1; l++) nActorParams += actorSizes[l] * actorSizes[l + 1] + actorSizes[l + 1];
  let nCriticParams = 0;
  for (let l = 0; l < nCL - 1; l++) nCriticParams += criticSizes[l] * criticSizes[l + 1] + criticSizes[l + 1];

  const szActorSizes  = align8(nAL * 4);
  const szCriticSizes = align8(nCL * 4);
  const szActorFlat   = align8(nActorParams  * 8);
  const szCriticFlat  = align8(nCriticParams * 8);
  const szLogStd      = align8(actDim * 8);
  const szObs         = align8(n * obsDim * 8);
  const szAct         = align8(n * actDim * 8);
  const szN           = align8(n * 8);
  const szLoss        = align8(3 * 8);

  const totalBytes = szActorSizes + szCriticSizes +
                     szActorFlat + szCriticFlat + szLogStd +
                     szObs + szAct + szN * 3 +
                     szActorFlat + szCriticFlat + szLogStd + szLoss;

  const mem = wasmInst.exports.memory;
  if (arenaBase === 0) arenaBase = wasmInst.exports.get_heap_base();
  const needed = arenaBase + totalBytes;
  if (needed > mem.buffer.byteLength) {
    mem.grow(Math.ceil((needed - mem.buffer.byteLength) / 65536));
  }

  let off = arenaBase;
  const lay = {};
  lay.actorSizesOff  = off; off += szActorSizes;
  lay.criticSizesOff = off; off += szCriticSizes;
  lay.actorFlatOff   = off; off += szActorFlat;
  lay.criticFlatOff  = off; off += szCriticFlat;
  lay.logStdOff      = off; off += szLogStd;
  lay.obsOff         = off; off += szObs;
  lay.actOff         = off; off += szAct;
  lay.logpOff        = off; off += szN;
  lay.advOff         = off; off += szN;
  lay.retOff         = off; off += szN;
  lay.actorGradOff   = off; off += szActorFlat;
  lay.criticGradOff  = off; off += szCriticFlat;
  lay.gLogStdOff     = off; off += szLogStd;
  lay.lossOutOff     = off;
  lay.nActorParams   = nActorParams;
  lay.nCriticParams  = nCriticParams;
  lay.nAL            = nAL;
  lay.nCL            = nCL;

  cachedLayout = lay;
  cachedKey    = key;
  return lay;
}

function computeGradsWasm(d) {
  const { actorSizes, criticSizes, actorFlat, criticFlat, n, obsDim, actDim,
          obs, act, logp, adv, ret, hp } = d;
  const logStd = Float64Array.from(d.logStd);

  const lay = getLayout(actorSizes, criticSizes, n, obsDim, actDim);
  const buf = wasmInst.exports.memory.buffer;

  const i32 = new Int32Array(buf);
  const asI = lay.actorSizesOff >> 2;
  for (let i = 0; i < lay.nAL; i++) i32[asI + i] = actorSizes[i];
  const csI = lay.criticSizesOff >> 2;
  for (let i = 0; i < lay.nCL; i++) i32[csI + i] = criticSizes[i];

  const put = (off, src) => { new Float64Array(buf, off, src.length).set(src); };
  put(lay.actorFlatOff,  actorFlat);
  put(lay.criticFlatOff, criticFlat);
  put(lay.logStdOff,     logStd);
  put(lay.obsOff,        obs);
  put(lay.actOff,        act);
  put(lay.logpOff,       logp);
  put(lay.advOff,        adv);
  put(lay.retOff,        ret);

  new Float64Array(buf, lay.actorGradOff,  lay.nActorParams).fill(0);
  new Float64Array(buf, lay.criticGradOff, lay.nCriticParams).fill(0);
  new Float64Array(buf, lay.gLogStdOff,    actDim).fill(0);
  new Float64Array(buf, lay.lossOutOff,    3).fill(0);

  wasmInst.exports.compute_ppo_grads(
    n, obsDim, actDim,
    lay.nAL, lay.actorSizesOff,
    lay.nCL, lay.criticSizesOff,
    lay.actorFlatOff, lay.criticFlatOff,
    lay.logStdOff,
    hp.clip, hp.entropyCoef, hp.vfCoef,
    lay.obsOff, lay.actOff, lay.logpOff, lay.advOff, lay.retOff,
    lay.actorGradOff, lay.criticGradOff, lay.gLogStdOff, lay.lossOutOff,
  );

  const aG  = new Float64Array(lay.nActorParams);
  const cG  = new Float64Array(lay.nCriticParams);
  const gLs = new Float64Array(actDim);
  aG.set(new Float64Array(buf, lay.actorGradOff,  lay.nActorParams));
  cG.set(new Float64Array(buf, lay.criticGradOff, lay.nCriticParams));
  gLs.set(new Float64Array(buf, lay.gLogStdOff,   actDim));
  const losses = new Float64Array(buf, lay.lossOutOff, 3);
  return { aG, cG, gLs, pi: losses[0], v: losses[1], ent: losses[2] };
}

// ── SAC WASM layout + compute ───────────────────────────────────────────────
// Shares the arena base with the PPO layout — a worker runs one task at a
// time, so the regions may overlap between task kinds.

let cachedSacLayout = null;
let cachedSacKey    = '';

function netParamCount(sizes) {
  let n = 0;
  for (let l = 0; l < sizes.length - 1; l++) n += sizes[l] * sizes[l + 1] + sizes[l + 1];
  return n;
}

function getSacLayout(actorSizes, qSizes, n, obsDim, actDim) {
  const key = `${actorSizes}|${qSizes}|${n}`;
  if (key === cachedSacKey) return cachedSacLayout;

  const nActorParams = netParamCount(actorSizes);
  const nQParams     = netParamCount(qSizes);
  const szF = c => align8(c * 8);

  const mem = wasmInst.exports.memory;
  if (arenaBase === 0) arenaBase = wasmInst.exports.get_heap_base();

  let off = arenaBase;
  const lay = { nActorParams, nQParams };
  const take = bytes => { const p = off; off += bytes; return p; };
  lay.actorSizesOff = take(align8(actorSizes.length * 4));
  lay.qSizesOff     = take(align8(qSizes.length * 4));
  lay.actorFlatOff  = take(szF(nActorParams));
  lay.q1FlatOff     = take(szF(nQParams));
  lay.q2FlatOff     = take(szF(nQParams));
  lay.tq1FlatOff    = take(szF(nQParams));
  lay.tq2FlatOff    = take(szF(nQParams));
  lay.obsOff        = take(szF(n * obsDim));
  lay.actOff        = take(szF(n * actDim));
  lay.rewOff        = take(szF(n));
  lay.obs2Off       = take(szF(n * obsDim));
  lay.doneOff       = take(szF(n));
  lay.noiseOff      = take(szF(n * actDim));
  lay.noise2Off     = take(szF(n * actDim));
  lay.actorGradOff  = take(szF(nActorParams));
  lay.q1GradOff     = take(szF(nQParams));
  lay.q2GradOff     = take(szF(nQParams));
  lay.gLaOff        = take(szF(1));
  lay.lossOutOff    = take(szF(4));

  if (off > mem.buffer.byteLength) {
    mem.grow(Math.ceil((off - mem.buffer.byteLength) / 65536));
  }
  cachedSacLayout = lay;
  cachedSacKey    = key;
  return lay;
}

function computeSacGradsWasm(d, noise, noise2) {
  const { actorSizes, qSizes, n, obsDim, actDim, hp } = d;
  const lay = getSacLayout(actorSizes, qSizes, n, obsDim, actDim);
  const buf = wasmInst.exports.memory.buffer;

  const i32 = new Int32Array(buf);
  const asI = lay.actorSizesOff >> 2;
  for (let i = 0; i < actorSizes.length; i++) i32[asI + i] = actorSizes[i];
  const qsI = lay.qSizesOff >> 2;
  for (let i = 0; i < qSizes.length; i++) i32[qsI + i] = qSizes[i];

  const put = (off, src) => { new Float64Array(buf, off, src.length).set(src); };
  put(lay.actorFlatOff, d.actorFlat);
  put(lay.q1FlatOff,  d.q1Flat);
  put(lay.q2FlatOff,  d.q2Flat);
  put(lay.tq1FlatOff, d.tq1Flat);
  put(lay.tq2FlatOff, d.tq2Flat);
  put(lay.obsOff,  d.obs);
  put(lay.actOff,  d.act);
  put(lay.rewOff,  d.rew);
  put(lay.obs2Off, d.obs2);
  put(lay.doneOff, d.done);
  put(lay.noiseOff,  noise);
  put(lay.noise2Off, noise2);

  new Float64Array(buf, lay.actorGradOff, lay.nActorParams).fill(0);
  new Float64Array(buf, lay.q1GradOff, lay.nQParams).fill(0);
  new Float64Array(buf, lay.q2GradOff, lay.nQParams).fill(0);
  new Float64Array(buf, lay.gLaOff, 1).fill(0);
  new Float64Array(buf, lay.lossOutOff, 4).fill(0);

  wasmInst.exports.compute_sac_grads(
    n, obsDim, actDim,
    actorSizes.length, lay.actorSizesOff,
    qSizes.length, lay.qSizesOff,
    lay.actorFlatOff, lay.q1FlatOff, lay.q2FlatOff,
    lay.tq1FlatOff, lay.tq2FlatOff,
    d.logAlpha, hp.gamma, hp.targetEntropy,
    lay.obsOff, lay.actOff, lay.rewOff, lay.obs2Off, lay.doneOff,
    lay.noiseOff, lay.noise2Off,
    lay.actorGradOff, lay.q1GradOff, lay.q2GradOff,
    lay.gLaOff, lay.lossOutOff,
  );

  const aG  = new Float64Array(lay.nActorParams);
  const q1G = new Float64Array(lay.nQParams);
  const q2G = new Float64Array(lay.nQParams);
  aG.set(new Float64Array(buf, lay.actorGradOff, lay.nActorParams));
  q1G.set(new Float64Array(buf, lay.q1GradOff, lay.nQParams));
  q2G.set(new Float64Array(buf, lay.q2GradOff, lay.nQParams));
  const gLa = new Float64Array(buf, lay.gLaOff, 1)[0];
  const losses = new Float64Array(buf, lay.lossOutOff, 4);
  return { aG, q1G, q2G, gLa, q: losses[0], pi: losses[1], ent: losses[2], std: losses[3] };
}

// ── JS fallback ──────────────────────────────────────────────────────────────

let actor    = null;
let critic   = null;
let sizesKey = '';

let sacNets    = null;
let sacSizesKey = '';

function computeSacGradsJS(d, noise, noise2) {
  const key = JSON.stringify([d.actorSizes, d.qSizes]);
  if (key !== sacSizesKey) {
    sacNets = {
      actor: new Net(d.actorSizes),
      q1: new Net(d.qSizes), q2: new Net(d.qSizes),
      tq1: new Net(d.qSizes), tq2: new Net(d.qSizes),
    };
    sacSizesKey = key;
  }
  sacNets.actor.loadFlat(d.actorFlat);
  sacNets.q1.loadFlat(d.q1Flat);
  sacNets.q2.loadFlat(d.q2Flat);
  sacNets.tq1.loadFlat(d.tq1Flat);
  sacNets.tq2.loadFlat(d.tq2Flat);
  sacNets.actor.zeroGrad();
  sacNets.q1.zeroGrad();
  sacNets.q2.zeroGrad();

  const r = accumulateSACGrads(
    sacNets,
    { gamma: d.hp.gamma, logAlpha: d.logAlpha, targetEntropy: d.hp.targetEntropy },
    { ...d, noise, noise2 },
  );
  return {
    aG:  sacNets.actor.gradFlatF64(),
    q1G: sacNets.q1.gradFlatF64(),
    q2G: sacNets.q2.gradFlatF64(),
    gLa: r.gLa, q: r.q, pi: r.pi, ent: r.ent, std: r.std,
  };
}

function computeGradsJS(d) {
  const key = JSON.stringify([d.actorSizes, d.criticSizes]);
  if (key !== sizesKey) {
    actor    = new Net(d.actorSizes);
    critic   = new Net(d.criticSizes);
    sizesKey = key;
  }
  actor.loadFlat(d.actorFlat);
  critic.loadFlat(d.criticFlat);
  actor.zeroGrad();
  critic.zeroGrad();

  const logStd = Float64Array.from(d.logStd);
  const r = accumulatePPOGrads(actor, critic, logStd, d.hp, d);
  return {
    aG:  actor.gradFlatF64(),
    cG:  critic.gradFlatF64(),
    gLs: r.gLs,
    pi:  r.pi,
    v:   r.v,
    ent: r.ent,
  };
}

// ── Message handler ──────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const d = e.data;

  if (d.type === 'grad') {
    let r, mode = 'js';
    if (wasmReady && d.force !== 'js') {
      try {
        r = computeGradsWasm(d);
        mode = 'wasm';
      } catch (err) {
        wasmReady = false;
        postMessage({ type: 'wasmStatus', ok: false, error: 'runtime: ' + String(err && err.message || err) });
        r = computeGradsJS(d);
      }
    } else {
      r = computeGradsJS(d);
    }

    postMessage(
      { type: 'gradResult', aG: r.aG, cG: r.cG, gLs: r.gLs,
        pi: r.pi, v: r.v, ent: r.ent, n: d.n, mode },
      [r.aG.buffer, r.cG.buffer, r.gLs.buffer],
    );
    return;
  }

  if (d.type === 'sacGrad') {
    // Reparametrisation noise is drawn here (the WASM module has no RNG);
    // the same draws feed whichever backend runs, so a mid-task WASM
    // failure cannot change the minibatch's stochastic objective.
    const noise  = new Float64Array(d.n * d.actDim);
    const noise2 = new Float64Array(d.n * d.actDim);
    for (let i = 0; i < noise.length; i++) { noise[i] = gauss(); noise2[i] = gauss(); }

    let r, mode = 'js';
    if (wasmReady && d.force !== 'js') {
      try {
        r = computeSacGradsWasm(d, noise, noise2);
        mode = 'wasm';
      } catch (err) {
        wasmReady = false;
        postMessage({ type: 'wasmStatus', ok: false, error: 'runtime: ' + String(err && err.message || err) });
        r = computeSacGradsJS(d, noise, noise2);
      }
    } else {
      r = computeSacGradsJS(d, noise, noise2);
    }

    postMessage(
      { type: 'gradResult', aG: r.aG, q1G: r.q1G, q2G: r.q2G, gLa: r.gLa,
        q: r.q, pi: r.pi, ent: r.ent, std: r.std, n: d.n, mode },
      [r.aG.buffer, r.q1G.buffer, r.q2G.buffer],
    );
  }
};
