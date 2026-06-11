'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  gpu-grad.js — WebGPU PPO gradient backend
//
//  computeEpoch() processes an entire shuffled epoch with ONE readback:
//  minibatch gradient dispatches are encoded into command buffers of a few
//  minibatches each, results accumulate on-device, and everything is read
//  back with a single mapAsync at the end. Chunking matters: a single
//  epoch-sized command buffer can occupy the GPU for hundreds of ms (seconds
//  on integrated GPUs) without any chance of preemption — the OS compositor
//  and the browser starve (system-wide lag), and drivers with a hang
//  watchdog reset the device ("GPU driver crash"). Chunk size adapts to keep
//  each submit near a small time budget, and a short pause between chunks
//  leaves the GPU idle gaps for the rest of the system. The chunks grow
//  toward whole epochs on fast GPUs, so the fence count stays far below the
//  96 sequential per-minibatch round-trips that caused the old CPU spike.
//
//  WGSL is generated per architecture with all sizes baked in as constants.
//  GROUP = 1: one GPU thread per training sample (maximum parallelism, shortest
//  per-invocation runtime, minimal TDR risk).
//  Precision: f32 on GPU; results are returned as f64 for Adam compatibility.
// ─────────────────────────────────────────────────────────────────────────────

const LOG_2PI = Math.log(2 * Math.PI);

function paramCount(sizes) {
  let n = 0;
  for (let l = 0; l < sizes.length - 1; l++) n += sizes[l] * sizes[l + 1] + sizes[l + 1];
  return n;
}

// Per-layer weight/bias offsets within a flat array starting at `base`.
function layerOffsets(sizes, base) {
  const wOff = [], bOff = [];
  let off = base;
  for (let l = 0; l < sizes.length - 1; l++) {
    wOff.push(off); off += sizes[l] * sizes[l + 1];
    bOff.push(off); off += sizes[l + 1];
  }
  return { wOff, bOff };
}

// Activation base offsets within the shared `acts` array (input at index 0).
function actBases(sizes) {
  const b = [0];
  for (let l = 0; l < sizes.length; l++) b.push(b[l] + sizes[l]);
  return b;
}

// Forward pass: tanh on all hidden layers, linear on the last.
function emitForward(sizes, wOff, bOff, bases) {
  let code = '';
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const last = l === sizes.length - 2;
    code += `
    for (var fj${l} = 0u; fj${l} < ${nOut}u; fj${l}++) {
      var fsum${l} = weights[${bOff[l]}u + fj${l}];
      let frow${l} = ${wOff[l]}u + fj${l} * ${nIn}u;
      for (var fi${l} = 0u; fi${l} < ${nIn}u; fi${l}++) {
        fsum${l} += weights[frow${l} + fi${l}] * acts[${bases[l]}u + fi${l}];
      }
      acts[${bases[l + 1]}u + fj${l}] = ${last ? `fsum${l}` : `tanh(fsum${l})`};
    }`;
  }
  return code;
}

// Backward pass: reads delta from dcur[0..nOut), accumulates into the slab
// (mirroring the weights layout), propagates delta to the previous layer.
function emitBackward(sizes, wOff, bOff, bases, tag) {
  let code = '';
  for (let l = sizes.length - 2; l >= 0; l--) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const hasPrev = l > 0;
    code += `
    ${hasPrev ? `for (var bi${tag}${l} = 0u; bi${tag}${l} < ${nIn}u; bi${tag}${l}++) { dnxt[bi${tag}${l}] = 0.0; }` : ''}
    for (var bj${tag}${l} = 0u; bj${tag}${l} < ${nOut}u; bj${tag}${l}++) {
      let bdj${tag}${l} = dcur[bj${tag}${l}];
      slabs[sb + ${bOff[l]}u + bj${tag}${l}] += bdj${tag}${l};
      let brow${tag}${l} = ${wOff[l]}u + bj${tag}${l} * ${nIn}u;
      for (var bi2_${tag}${l} = 0u; bi2_${tag}${l} < ${nIn}u; bi2_${tag}${l}++) {
        slabs[sb + brow${tag}${l} + bi2_${tag}${l}] += bdj${tag}${l} * acts[${bases[l]}u + bi2_${tag}${l}];
        ${hasPrev ? `dnxt[bi2_${tag}${l}] += bdj${tag}${l} * weights[brow${tag}${l} + bi2_${tag}${l}];` : ''}
      }
    }
    ${hasPrev ? `for (var bip${tag}${l} = 0u; bip${tag}${l} < ${nIn}u; bip${tag}${l}++) {
      let bav${tag}${l} = acts[${bases[l]}u + bip${tag}${l}];
      dcur[bip${tag}${l}] = dnxt[bip${tag}${l}] * (1.0 - bav${tag}${l} * bav${tag}${l});
    }` : ''}`;
  }
  return code;
}

export function genWGSL(lay) {
  const { AS, CS, I, A, ECAP, GROUP, SLAB, aP, cP, OUT } = lay;
  const aOffs  = layerOffsets(AS, 0);
  const cOffs  = layerOffsets(CS, aP);
  const aBases = actBases(AS);
  const cBases = actBases(CS);
  const ACTS   = Math.max(aBases[AS.length], cBases[CS.length]);
  const MAXW   = Math.max(...AS, ...CS);
  const MUB    = aBases[AS.length - 1];  // actor mean output base in acts
  const CVB    = cBases[CS.length - 1];  // critic value output base in acts
  const LS     = aP + cP;               // logStd offset in weights buffer
  const GLS    = aP + cP;               // gLogStd offset in slab
  const LOSS   = aP + cP + A;           // [pi, v, ent] offset in slab

  // Batch buffer region offsets (epoch-capacity stride)
  const OB = 0;
  const AB = ECAP * I;
  const LB = ECAP * (I + A);
  const DB = LB + ECAP;
  const RB = DB + ECAP;

  return /* wgsl */ `
struct Uni { n: u32, nGroups: u32, mbBase: u32, clip: f32, entCoef: f32, vfCoef: f32 };
@group(0) @binding(0) var<storage, read>        weights : array<f32>;
@group(0) @binding(1) var<storage, read>        batch   : array<f32>;
@group(0) @binding(2) var<storage, read_write>  slabs   : array<f32>;
@group(0) @binding(3) var<storage, read_write>  outg    : array<f32>;
@group(0) @binding(4) var<uniform>              uni     : Uni;

// grad_main: one thread per GROUP consecutive samples. GROUP is sized so the
// per-group gradient slab buffer fits the device's storage binding limit —
// big networks get larger groups (fewer slabs), small networks get GROUP=1.
@compute @workgroup_size(64)
fn grad_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let g = gid.x;
  if (g >= uni.nGroups) { return; }
  let sb = g * ${SLAB}u;

  var acts : array<f32, ${ACTS}>;
  var dcur : array<f32, ${MAXW}>;
  var dnxt : array<f32, ${MAXW}>;
  var lossPi  = 0.0;
  var lossV   = 0.0;
  var lossEnt = 0.0;

  let k0   = uni.mbBase + g * ${GROUP}u;
  let kEnd = min(uni.mbBase + uni.n, k0 + ${GROUP}u);
  for (var k = k0; k < kEnd; k++) {

  // Load observation into actor input slots.
  for (var i = 0u; i < ${I}u; i++) { acts[i] = batch[${OB}u + k * ${I}u + i]; }

  // ── Actor forward ──
  ${emitForward(AS, aOffs.wOff, aOffs.bOff, aBases)}

  // ── Gaussian log-prob of the stored action ──
  var lp = 0.0;
  for (var d = 0u; d < ${A}u; d++) {
    let ls = weights[${LS}u + d];
    let sd = exp(ls);
    let z  = (batch[${AB}u + k * ${A}u + d] - acts[${MUB}u + d]) / sd;
    lp += -0.5 * z * z - ls - ${0.5 * LOG_2PI}f;
  }

  // ── PPO clipped surrogate ──
  let ratio  = exp(min(20.0, lp - batch[${LB}u + k]));
  let advk   = batch[${DB}u + k];
  let clp    = clamp(ratio, 1.0 - uni.clip, 1.0 + uni.clip);
  let surr1  = ratio * advk;
  let surr2  = clp   * advk;
  lossPi += -min(surr1, surr2);

  // Actor gradient: coef is nonzero only when the clipped bound is NOT binding.
  var coef = 0.0;
  if (surr1 <= surr2) { coef = -advk * ratio; }
  for (var d = 0u; d < ${A}u; d++) {
    let ls   = weights[${LS}u + d];
    let sd2  = exp(2.0 * ls);
    let diff = batch[${AB}u + k * ${A}u + d] - acts[${MUB}u + d];
    dcur[d]  = coef * diff / sd2;
    slabs[sb + ${GLS}u + d] += coef * (diff * diff / sd2 - 1.0);
  }
  // ── Actor backward (always executes; coef=0 ⇒ zero-gradient) ──
  ${emitBackward(AS, aOffs.wOff, aOffs.bOff, aBases, 'a')}

  // ── Entropy bonus (gradient on logStd) ──
  for (var d = 0u; d < ${A}u; d++) {
    slabs[sb + ${GLS}u + d] += -uni.entCoef;
    lossEnt += weights[${LS}u + d] + ${0.5 * (LOG_2PI + 1)}f;
  }

  // ── Critic forward (reuses acts; actor pass is complete) ──
  for (var ci = 0u; ci < ${I}u; ci++) { acts[ci] = batch[${OB}u + k * ${I}u + ci]; }
  ${emitForward(CS, cOffs.wOff, cOffs.bOff, cBases)}
  let v   = acts[${CVB}u];
  let dr  = v - batch[${RB}u + k];
  lossV += 0.5 * dr * dr;
  dcur[0] = uni.vfCoef * dr;
  // ── Critic backward ──
  ${emitBackward(CS, cOffs.wOff, cOffs.bOff, cBases, 'c')}

  } // sample loop

  slabs[sb + ${LOSS}u + 0u] = lossPi;
  slabs[sb + ${LOSS}u + 1u] = lossV;
  slabs[sb + ${LOSS}u + 2u] = lossEnt;
}

// reduce_main: sum slab[g][p] across all nGroups into outg[p].
@compute @workgroup_size(256)
fn reduce_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let p = gid.x;
  if (p >= ${OUT}u) { return; }
  var s = 0.0;
  for (var g = 0u; g < uni.nGroups; g++) { s += slabs[g * ${SLAB}u + p]; }
  outg[p] = s;
}
`;
}

export class GpuGrad {
  // Returns { ok: true, gpu } or { ok: false, error } — never throws.
  // epochCap: maximum training samples per epoch (numEnvs * horizon).
  // mbs:      minibatch size.
  static async create(actorSizes, criticSizes, epochCap, mbs) {
    try {
      if (!(self.navigator && navigator.gpu)) {
        return { ok: false, error: 'WebGPU not available' };
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { ok: false, error: 'no WebGPU adapter' };
      // Ask for the adapter's full buffer limits — the 128 MB default storage
      // binding limit is too small for the gradient slabs of big networks.
      const al = adapter.limits;
      const device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: al.maxStorageBufferBindingSize,
          maxBufferSize:               al.maxBufferSize,
        },
      });
      const g = new GpuGrad(device, actorSizes, criticSizes, epochCap | 0 || 512, mbs | 0 || 256);
      await g._build();
      return { ok: true, gpu: g };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  constructor(device, actorSizes, criticSizes, epochCap, mbs) {
    this.device = device;
    this.lost   = false;
    this._uncaptured = null;
    device.lost.then(info => { this.lost = true; this._uncaptured = 'device lost: ' + (info && info.message || ''); });
    device.addEventListener('uncapturederror', e => {
      this._uncaptured = e.error && e.error.message || String(e.error);
    });

    const AS = actorSizes.slice(), CS = criticSizes.slice();
    const I  = AS[0], A = AS[AS.length - 1];
    const aP = paramCount(AS), cP = paramCount(CS);
    const SLAB = aP + cP + A + 4;   // per-group: grads + gLogStd + [pi, v, ent, pad]
    const OUT  = SLAB;               // reduce output mirrors slab layout

    // Samples per thread: grow GROUP until the slabs buffer fits the device's
    // storage binding limit (with headroom). A 3-layer 256-unit net has a
    // ~1.1 MB slab — at GROUP=1 × minibatch 256 that's ~290 MB, far over the
    // 128 MB default limit, and an oversized buffer silently voids every
    // dispatch (the all-zeros readback failure mode).
    const lim    = device.limits;
    const budget = Math.min(lim.maxStorageBufferBindingSize || 128 << 20,
                            lim.maxBufferSize || 256 << 20,
                            256 << 20) * 0.75;
    let GROUP = 1;
    while (Math.ceil(mbs / GROUP) * SLAB * 4 > budget) GROUP *= 2;
    if (SLAB * 4 > budget) {
      throw new Error(`network too large for GPU: one gradient slab is ${(SLAB * 4 / 1048576).toFixed(0)} MB, ` +
                      `device storage limit is ${(budget / 0.75 / 1048576).toFixed(0)} MB`);
    }

    this.lay  = { AS, CS, I, A, ECAP: epochCap, GROUP, SLAB, aP, cP, OUT };
    this.mbs  = mbs;
    this.ECAP = epochCap;

    // Pre-allocated scratch buffers to avoid per-call Float32Array allocations.
    this._wScratch   = new Float32Array(aP + cP + A);
    this._obsScratch = new Float32Array(epochCap * I);
    this._actScratch = new Float32Array(epochCap * A);
    this._logpScratch = new Float32Array(epochCap);
    this._advScratch  = new Float32Array(epochCap);
    this._retScratch  = new Float32Array(epochCap);

    // Maximum minibatches per epoch.
    this._nMBMax = Math.ceil(epochCap / mbs);

    // Minibatches per command-buffer submit — adapted at runtime so each
    // submit stays near _TARGET_MS of GPU time (see computeEpoch).
    this._chunk = 1;
  }

  // Await a GPU promise with a hard timeout so a hung driver surfaces as a
  // catchable error (→ CPU fallback) instead of freezing the update forever.
  async _awaitGpu(promise, ms, label) {
    let to;
    try {
      await Promise.race([
        promise,
        new Promise((_, rej) => { to = setTimeout(() => rej(new Error(label)), ms); }),
      ]);
    } finally {
      clearTimeout(to);
    }
  }

  async _build() {
    const d   = this.device;
    const { ECAP, I, A, SLAB, OUT } = this.lay;
    const nMBMax = this._nMBMax;
    const mbs    = this.mbs;

    // Compile shader.
    const module = d.createShaderModule({ code: genWGSL(this.lay) });
    const info   = await module.getCompilationInfo();
    const errs   = info.messages.filter(m => m.type === 'error');
    if (errs.length) {
      throw new Error('WGSL: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | '));
    }

    const bglLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage'           } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage'           } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform'           } },
      ],
    });
    const pipeLayout = d.createPipelineLayout({ bindGroupLayouts: [bglLayout] });
    [this.gradPipe, this.reducePipe] = await Promise.all([
      d.createComputePipelineAsync({ layout: pipeLayout, compute: { module, entryPoint: 'grad_main'   } }),
      d.createComputePipelineAsync({ layout: pipeLayout, compute: { module, entryPoint: 'reduce_main' } }),
    ]);

    const nGroupsMax = Math.ceil(mbs / this.lay.GROUP);
    const mk = (size, usage) => d.createBuffer({ size, usage });
    const W = this._wScratch.length;
    this.bufWeights = mk(W * 4,                                   GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.bufBatch   = mk((ECAP * (I + A) + 3 * ECAP) * 4,        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.bufSlabs   = mk(nGroupsMax * SLAB * 4,                   GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.bufOut     = mk(OUT  * 4,                                GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.bufAllOut  = mk(nMBMax * OUT * 4,                        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.bufStage   = mk(nMBMax * OUT * 4,                        GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    // One uniform buffer + one bind group per max-minibatch slot.
    // Written fresh each computeEpoch call, before the command encoder.
    this.uniBufs    = Array.from({ length: nMBMax }, () =>
      mk(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST));
    this.bindGroups = this.uniBufs.map(ub =>
      d.createBindGroup({
        layout: bglLayout,
        entries: [
          { binding: 0, resource: { buffer: this.bufWeights } },
          { binding: 1, resource: { buffer: this.bufBatch   } },
          { binding: 2, resource: { buffer: this.bufSlabs   } },
          { binding: 3, resource: { buffer: this.bufOut     } },
          { binding: 4, resource: { buffer: ub              } },
        ],
      }));
  }

  // Process one full shuffled epoch on the GPU.
  // epochData: { N, obs, act, logp, adv, ret } — Float64Arrays, N samples.
  // Returns [{ aG, cG, gLs, pi, v, ent }] — one entry per minibatch.
  async computeEpoch(actorFlat, criticFlat, logStd, hp, epochData) {
    if (this.lost) throw new Error('GPU device lost');
    if (this._uncaptured) throw new Error('WebGPU error: ' + this._uncaptured);

    const d   = this.device, q = d.queue;
    const { I, A, ECAP, GROUP, aP, cP, OUT, SLAB } = this.lay;
    const { N, obs, act, logp, adv, ret } = epochData;
    const mbs    = this.mbs;
    const nMB    = Math.ceil(N / mbs);

    if (N > this.ECAP) throw new Error(`epoch too large: ${N} samples > capacity ${this.ECAP}`);

    // ── Upload weights (f64 → f32 via pre-allocated scratch) ──────────────────
    const w = this._wScratch;
    w.set(actorFlat,  0);
    w.set(criticFlat, aP);
    for (let k = 0; k < A; k++) w[aP + cP + k] = logStd[k];
    q.writeBuffer(this.bufWeights, 0, w);

    // ── Upload epoch batch (f64 → f32, no allocation) ─────────────────────────
    this._obsScratch.set(obs);    // Float64→Float32 conversion, no new array
    this._actScratch.set(act);
    this._logpScratch.set(logp);
    this._advScratch.set(adv);
    this._retScratch.set(ret);
    q.writeBuffer(this.bufBatch, 0,                         this._obsScratch.subarray(0, N * I));
    q.writeBuffer(this.bufBatch, ECAP * I * 4,              this._actScratch.subarray(0, N * A));
    q.writeBuffer(this.bufBatch, ECAP * (I + A) * 4,        this._logpScratch.subarray(0, N));
    q.writeBuffer(this.bufBatch, (ECAP * (I + A) + ECAP) * 4,     this._advScratch.subarray(0, N));
    q.writeBuffer(this.bufBatch, (ECAP * (I + A) + 2*ECAP) * 4,   this._retScratch.subarray(0, N));

    // ── Write per-minibatch uniforms ───────────────────────────────────────────
    const uBuf = new ArrayBuffer(32);
    const u32  = new Uint32Array(uBuf), f32 = new Float32Array(uBuf);
    f32[3] = hp.clip; f32[4] = hp.entropyCoef; f32[5] = hp.vfCoef;
    for (let m = 0; m < nMB; m++) {
      const bs = Math.min(mbs, N - m * mbs);
      u32[0] = bs; u32[1] = Math.ceil(bs / GROUP); u32[2] = m * mbs;
      q.writeBuffer(this.uniBufs[m], 0, uBuf);
    }

    // ── Encode minibatch dispatches in paced chunks ───────────────────────────
    // Each chunk is its own submit; we wait for it to drain before sending the
    // next, so the GPU gets preemption points for the compositor/browser and a
    // hang watchdog never sees one monolithic multi-second command buffer.
    const TARGET_MS = 15;
    d.pushErrorScope('validation');
    d.pushErrorScope('out-of-memory');
    let m = 0;
    while (m < nMB) {
      const mEnd = Math.min(nMB, m + this._chunk);
      const enc = d.createCommandEncoder();
      for (; m < mEnd; m++) {
        const bs = Math.min(mbs, N - m * mbs);
        const nGroups = Math.ceil(bs / GROUP);
        enc.clearBuffer(this.bufSlabs, 0, nGroups * SLAB * 4);
        const pass = enc.beginComputePass();
        pass.setBindGroup(0, this.bindGroups[m]);
        pass.setPipeline(this.gradPipe);
        pass.dispatchWorkgroups(Math.ceil(nGroups / 64));
        pass.setPipeline(this.reducePipe);
        pass.dispatchWorkgroups(Math.ceil(OUT / 256));
        pass.end();
        enc.copyBufferToBuffer(this.bufOut, 0, this.bufAllOut, m * OUT * 4, OUT * 4);
      }
      q.submit([enc.finish()]);
      const t0 = performance.now();
      await this._awaitGpu(q.onSubmittedWorkDone(), 15000, 'GPU work timeout (>15s) — driver hung?');
      const ms = performance.now() - t0;
      if (ms < TARGET_MS * 0.5 && this._chunk < this._nMBMax) this._chunk = Math.min(this._chunk * 2, this._nMBMax);
      else if (ms > TARGET_MS * 2 && this._chunk > 1)         this._chunk = Math.max(1, this._chunk >> 1);
      // idle gap ∝ chunk runtime (≤25 % overhead) so other GPU users get a turn
      if (m < nMB) await new Promise(res => setTimeout(res, Math.min(8, Math.max(1, ms / 4))));
    }

    // ── Single readback for the entire epoch ──────────────────────────────────
    const encC = d.createCommandEncoder();
    encC.copyBufferToBuffer(this.bufAllOut, 0, this.bufStage, 0, nMB * OUT * 4);
    q.submit([encC.finish()]);
    await this._awaitGpu(this.bufStage.mapAsync(GPUMapMode.READ, 0, nMB * OUT * 4),
                         30000, 'GPU mapAsync timeout (>30s)');

    const raw = new Float32Array(this.bufStage.getMappedRange(0, nMB * OUT * 4)).slice();
    this.bufStage.unmap();

    // Surface any GPU-side error — an invalid submit reads back as all zeros,
    // which would otherwise be misreported as a numeric validation failure.
    const [eOOM, eVal] = await Promise.all([d.popErrorScope(), d.popErrorScope()]);
    const gpuErr = (eVal && eVal.message) || (eOOM && eOOM.message) || this._uncaptured;
    if (gpuErr) throw new Error('WebGPU error: ' + gpuErr);

    // ── Unpack results ────────────────────────────────────────────────────────
    const results = [];
    for (let m = 0; m < nMB; m++) {
      const base = m * OUT;
      const bs   = Math.min(mbs, N - m * mbs);
      results.push({
        aG:  Float64Array.from(raw.subarray(base,           base + aP)),
        cG:  Float64Array.from(raw.subarray(base + aP,      base + aP + cP)),
        gLs: Float64Array.from(raw.subarray(base + aP + cP, base + aP + cP + A)),
        pi:  raw[base + aP + cP + A],
        v:   raw[base + aP + cP + A + 1],
        ent: raw[base + aP + cP + A + 2],
        n:   bs,
      });
    }
    return results;
  }

  destroy() {
    try { this.device.destroy(); } catch (_) { /* already gone */ }
  }
}
