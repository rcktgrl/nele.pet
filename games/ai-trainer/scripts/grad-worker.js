'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  grad-worker.js — parallel PPO gradient computation
//
//  Uses a WASM module (nn_wasm.wasm) for the hot inner loop when available,
//  with an automatic fallback to the pure-JS path in nn-core.js.
//
//  Spawned by sim-worker.js.  Each message carries network weights + a batch
//  slice; we return gradient sums via transferable buffers.
// ─────────────────────────────────────────────────────────────────────────────

import { Net, accumulatePPOGrads } from './nn-core.js';

// ── Inline WASM binary (base64) ──────────────────────────────────────────────
// Generated from nn_wasm.c:
//   clang --target=wasm32 -nostdlib -O3 -ffast-math \
//         -Wl,--no-entry -Wl,--export-all -Wl,--allow-undefined \
//         nn_wasm.c -o nn_wasm.wasm
const WASM_B64 =
  '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';

// ── WASM loader ──────────────────────────────────────────────────────────────

function b64ToBytes(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

const wasmImports = {
  env: {
    exp:    Math.exp,
    tanh:   Math.tanh,
    // memset is used internally by LLVM; provide a fast version
    memset: (ptr, val, len) => {
      const mem8 = new Uint8Array(wasmInst.exports.memory.buffer);
      mem8.fill(val & 0xff, ptr, ptr + len);
      return ptr;
    },
  },
};

let wasmInst = null;     // WebAssembly.Instance once ready
let wasmReady = false;
let wasmFailed = false;

// Load asynchronously so the worker can still answer its first message via JS
// while WASM is compiling.
(async () => {
  try {
    const bytes  = b64ToBytes(WASM_B64);
    const result = await WebAssembly.instantiate(bytes, wasmImports);
    wasmInst  = result.instance;
    wasmReady = true;
  } catch (err) {
    wasmFailed = true;
    // JS fallback will be used automatically.
  }
})();

// ── WASM memory allocator ────────────────────────────────────────────────────
//
// Layout (all in WASM linear memory, starting at heapBase):
//
//   actorSizesOff   : nActorLayers × 4  (i32)
//   criticSizesOff  : nCriticLayers × 4
//   actorFlatOff    : nActorParams × 8  (f64)
//   criticFlatOff   : nCriticParams × 8
//   logStdOff       : actDim × 8
//   obsOff          : n × obsDim × 8
//   actOff          : n × actDim × 8
//   logpOff         : n × 8
//   advOff          : n × 8
//   retOff          : n × 8
//   actorGradOff    : nActorParams × 8  (output)
//   criticGradOff   : nCriticParams × 8 (output)
//   gLogStdOff      : actDim × 8        (output)
//   lossOutOff      : 3 × 8             (output: pi, v, ent)
//
// All allocations are aligned to 8 bytes.

let wasmHeap   = 0;       // byte offset of our arena (set after module loads)
let arenaBase  = 0;
const ALIGN    = 8;

function align8(n) { return (n + 7) & ~7; }

// Per-architecture layout cache (avoid re-computing when sizes unchanged)
let cachedLayout = null;
let cachedKey    = '';

function getLayout(actorSizes, criticSizes, n, obsDim, actDim) {
  const key = `${actorSizes}|${criticSizes}|${n}`;
  if (key === cachedKey) return cachedLayout;

  const nAL = actorSizes.length;
  const nCL = criticSizes.length;
  let nActorParams = 0;
  for (let l = 0; l < nAL - 1; l++) nActorParams += actorSizes[l] * actorSizes[l+1] + actorSizes[l+1];
  let nCriticParams = 0;
  for (let l = 0; l < nCL - 1; l++) nCriticParams += criticSizes[l] * criticSizes[l+1] + criticSizes[l+1];

  // Compute needed byte size
  const szActorSizes  = align8(nAL * 4);
  const szCriticSizes = align8(nCL * 4);
  const szActorFlat   = align8(nActorParams  * 8);
  const szCriticFlat  = align8(nCriticParams * 8);
  const szLogStd      = align8(actDim * 8);
  const szObs         = align8(n * obsDim * 8);
  const szAct         = align8(n * actDim * 8);
  const szN           = align8(n * 8);    // for logp, adv, ret
  const szGrad        = szActorFlat;      // same size as weights
  const szCGrad       = szCriticFlat;
  const szGLogStd     = szLogStd;
  const szLoss        = align8(3 * 8);

  const totalBytes = szActorSizes + szCriticSizes +
                     szActorFlat + szCriticFlat + szLogStd +
                     szObs + szAct + szN * 3 +
                     szGrad + szCGrad + szGLogStd + szLoss;

  // Grow WASM memory if needed
  const mem       = wasmInst.exports.memory;
  const heapBase  = wasmInst.exports.get_heap_base();
  if (arenaBase === 0) arenaBase = heapBase;

  const needed    = arenaBase + totalBytes;
  const curBytes  = mem.buffer.byteLength;
  if (needed > curBytes) {
    const pages = Math.ceil((needed - curBytes) / 65536);
    mem.grow(pages);
  }

  // Assign offsets
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
  lay.actorGradOff   = off; off += szGrad;
  lay.criticGradOff  = off; off += szCGrad;
  lay.gLogStdOff     = off; off += szGLogStd;
  lay.lossOutOff     = off;
  lay.nActorParams   = nActorParams;
  lay.nCriticParams  = nCriticParams;
  lay.nAL            = nAL;
  lay.nCL            = nCL;

  cachedLayout = lay;
  cachedKey    = key;
  return lay;
}

// ── WASM gradient computation ────────────────────────────────────────────────

function computeGradsWasm(d) {
  const { actorSizes, criticSizes, actorFlat, criticFlat, n, obsDim, actDim,
          obs, act, logp, adv, ret, hp } = d;
  const logStd = Float64Array.from(d.logStd);

  const lay = getLayout(actorSizes, criticSizes, n, obsDim, actDim);
  const buf = wasmInst.exports.memory.buffer;

  // Write inputs into WASM memory
  const i32 = new Int32Array(buf);
  const f64 = new Float64Array(buf);

  // Actor + critic layer sizes (i32 arrays)
  const asI = lay.actorSizesOff >> 2;
  for (let i = 0; i < lay.nAL; i++) i32[asI + i] = actorSizes[i];
  const csI = lay.criticSizesOff >> 2;
  for (let i = 0; i < lay.nCL; i++) i32[csI + i] = criticSizes[i];

  // Float64 data
  const f64View = (off, src) => {
    const v = new Float64Array(buf, off, src.length);
    v.set(src);
  };
  f64View(lay.actorFlatOff,  actorFlat);
  f64View(lay.criticFlatOff, criticFlat);
  f64View(lay.logStdOff,     logStd);
  f64View(lay.obsOff,        obs);
  f64View(lay.actOff,        act);
  f64View(lay.logpOff,       logp);
  f64View(lay.advOff,        adv);
  f64View(lay.retOff,        ret);

  // Zero output regions
  new Float64Array(buf, lay.actorGradOff,  lay.nActorParams).fill(0);
  new Float64Array(buf, lay.criticGradOff, lay.nCriticParams).fill(0);
  new Float64Array(buf, lay.gLogStdOff,    actDim).fill(0);
  new Float64Array(buf, lay.lossOutOff,    3).fill(0);

  // Call WASM
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

  // Read outputs — copy out of WASM memory into fresh transferable buffers
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

// ── Message handler ──────────────────────────────────────────────────────────

self.onmessage = function (e) {
  const d = e.data;
  if (d.type !== 'grad') return;

  let r;
  if (wasmReady) {
    try {
      r = computeGradsWasm(d);
    } catch (err) {
      wasmFailed = true;
      wasmReady  = false;
      r = computeGradsJS(d);
    }
  } else {
    r = computeGradsJS(d);
  }

  postMessage(
    { aG: r.aG, cG: r.cG, gLs: r.gLs, pi: r.pi, v: r.v, ent: r.ent, n: d.n },
    [r.aG.buffer, r.cG.buffer, r.gLs.buffer],
  );
};
