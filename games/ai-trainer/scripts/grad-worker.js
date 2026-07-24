'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  grad-worker.js — parallel PPO gradient computation
//
//  Uses the compiled WASM module (nn_wasm.wasm, fetched from this directory)
//  for the hot inner loop, with automatic fallback to the pure-JS path in
//  nn-core.js.  Load status is reported to the sim-worker via
//  { type: 'wasmStatus' } messages so failures are visible, never silent.
//
//  Spawned by sim-worker.js.  Each { type: 'grad' } message carries network
//  weights + a batch slice; the reply is tagged { type: 'gradResult' } with
//  gradient sums in transferable buffers and `mode: 'wasm' | 'js'`.
// ─────────────────────────────────────────────────────────────────────────────

import { Net, GRUNet, accumulatePPOGrads, accumulatePPORecurrentGrads } from './nn-core.js';

// ── WASM loading ─────────────────────────────────────────────────────────────
//
// The module is fully self-contained (no imports — exp/tanh are compiled in,
// see nn_wasm.c) so instantiation needs no import object at all. That also
// means the hot loop never crosses the JS↔WASM boundary for math calls, which
// used to happen tens of thousands of times per gradient minibatch.

let wasmInst  = null;
let wasmReady = false;

(async () => {
  try {
    const url = new URL('./nn_wasm.wasm', import.meta.url);
    let result;
    try {
      result = await WebAssembly.instantiateStreaming(fetch(url));
    } catch (_) {
      // server may send a wrong MIME type — fall back to ArrayBuffer compile
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch ${resp.status} ${resp.statusText}`);
      result = await WebAssembly.instantiate(await resp.arrayBuffer());
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

// ── JS fallback ──────────────────────────────────────────────────────────────

let actor    = null;
let critic   = null;
let sizesKey = '';

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

// ── Recurrent (GRU/BPTT) gradient — WASM path ────────────────────────────────
// compute_ppo_recurrent_grads handles one sequence per call and ACCUMULATES
// into the grad/loss buffers, so we zero them once and loop the chunks. Returns
// null (→ JS fallback) if a chunk exceeds the kernel's caps (T>64 or H>256).

function gruParamCount(I, H, O) { return 3 * H * I + 3 * H * H + 3 * H + O * H + O; }

function computeGradsRecWasm(d) {
  const aSizes = d.actorSizes, cSizes = d.criticSizes;
  const I = aSizes[0], H = aSizes[1], O = d.actDim;
  let Tmax = 0;
  for (const s of d.seqs) if (s.T > Tmax) Tmax = s.T;
  if (H > 256 || Tmax > 64) return null;  // caps → JS path

  const Pa = gruParamCount(I, H, O), Pc = gruParamCount(I, H, 1);
  const a8 = n => (n + 7) & ~7;
  const szSizes = a8(3 * 4), szO = a8(O * 8), szH = a8(H * 8), szLoss = a8(3 * 8);
  const szPa = a8(Pa * 8), szPc = a8(Pc * 8);
  const szObs = a8(Tmax * I * 8), szAct = a8(Tmax * O * 8), szT = a8(Tmax * 8);

  if (arenaBase === 0) arenaBase = wasmInst.exports.get_heap_base();
  const total = szSizes * 2 + szPa + szPc + szO + szObs + szAct + szT * 4 +
                szH * 2 + szPa + szPc + szO + szLoss;
  const mem = wasmInst.exports.memory;
  let o = (arenaBase + 7) & ~7;
  const needed = o + total;
  if (needed > mem.buffer.byteLength) mem.grow(Math.ceil((needed - mem.buffer.byteLength) / 65536));

  const take = sz => { const off = o; o += sz; return off; };
  const aSizesOff = take(szSizes), cSizesOff = take(szSizes);
  const aFlatOff = take(szPa), cFlatOff = take(szPc), lsOff = take(szO);
  const obsOff = take(szObs), actOff = take(szAct);
  const logpOff = take(szT), advOff = take(szT), retOff = take(szT), doneOff = take(szT);
  const h0aOff = take(szH), h0cOff = take(szH);
  const aGradOff = take(szPa), cGradOff = take(szPc), gLsOff = take(szO), lossOff = take(szLoss);

  const B = mem.buffer;
  new Int32Array(B, aSizesOff, 3).set(aSizes);
  new Int32Array(B, cSizesOff, 3).set(cSizes);
  new Float64Array(B, aFlatOff, Pa).set(d.actorFlat);
  new Float64Array(B, cFlatOff, Pc).set(d.criticFlat);
  new Float64Array(B, lsOff, O).set(d.logStd);
  new Float64Array(B, aGradOff, Pa).fill(0);
  new Float64Array(B, cGradOff, Pc).fill(0);
  new Float64Array(B, gLsOff, O).fill(0);
  new Float64Array(B, lossOff, 3).fill(0);

  const hp = d.hp, ex = wasmInst.exports;
  for (const s of d.seqs) {
    new Float64Array(B, obsOff,  s.T * I).set(s.obs);
    new Float64Array(B, actOff,  s.T * O).set(s.act);
    new Float64Array(B, logpOff, s.T).set(s.logp);
    new Float64Array(B, advOff,  s.T).set(s.adv);
    new Float64Array(B, retOff,  s.T).set(s.ret);
    new Float64Array(B, doneOff, s.T).set(s.done);
    new Float64Array(B, h0aOff,  H).set(s.h0a);
    new Float64Array(B, h0cOff,  H).set(s.h0c);
    const ok = ex.compute_ppo_recurrent_grads(
      s.T, I, O, aSizesOff, cSizesOff, aFlatOff, cFlatOff, lsOff,
      hp.clip, hp.entropyCoef, hp.vfCoef,
      obsOff, actOff, logpOff, advOff, retOff, doneOff, h0aOff, h0cOff,
      aGradOff, cGradOff, gLsOff, lossOff);
    if (!ok) return null;
  }
  const aG = new Float64Array(Pa); aG.set(new Float64Array(B, aGradOff, Pa));
  const cG = new Float64Array(Pc); cG.set(new Float64Array(B, cGradOff, Pc));
  const gLs = new Float64Array(O); gLs.set(new Float64Array(B, gLsOff, O));
  const loss = new Float64Array(B, lossOff, 3);
  return { aG, cG, gLs, pi: loss[0], v: loss[1], ent: loss[2] };
}

// ── Recurrent (GRU/BPTT) gradient — JS path ──────────────────────────────────

let recActor = null, recCritic = null, recKey = '';

function computeGradsRec(d) {
  const key = JSON.stringify([d.actorSizes, d.criticSizes]);
  if (key !== recKey) {
    recActor  = new GRUNet(d.actorSizes);
    recCritic = new GRUNet(d.criticSizes);
    recKey = key;
  }
  recActor.loadFlat(d.actorFlat);
  recCritic.loadFlat(d.criticFlat);
  recActor.zeroGrad();
  recCritic.zeroGrad();

  const logStd = Float64Array.from(d.logStd);
  const actDim = d.actDim;
  const gLs = new Float64Array(actDim);
  let pi = 0, v = 0, ent = 0;
  for (const seq of d.seqs) {
    const r = accumulatePPORecurrentGrads(recActor, recCritic, logStd, d.hp, seq);
    for (let i = 0; i < actDim; i++) gLs[i] += r.gLs[i];
    pi += r.pi; v += r.v; ent += r.ent;
  }
  return { aG: recActor.gradFlatF64(), cG: recCritic.gradFlatF64(), gLs, pi, v, ent };
}

// ── Message handler ──────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const d = e.data;

  if (d.type === 'gradRec') {
    let r = null, mode = 'js-rec';
    if (wasmReady && d.force !== 'js') {
      try {
        r = computeGradsRecWasm(d);
        if (r) mode = 'wasm-rec';
      } catch (err) {
        wasmReady = false;
        postMessage({ type: 'wasmStatus', ok: false, error: 'rec runtime: ' + String(err && err.message || err) });
        r = null;
      }
    }
    if (!r) r = computeGradsRec(d);   // JS fallback (also when over WASM caps)
    postMessage(
      { type: 'gradResult', aG: r.aG, cG: r.cG, gLs: r.gLs,
        pi: r.pi, v: r.v, ent: r.ent, mode },
      [r.aG.buffer, r.cG.buffer, r.gLs.buffer],
    );
    return;
  }

  if (d.type !== 'grad') return;

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
};
