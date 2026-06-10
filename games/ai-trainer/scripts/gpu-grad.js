'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  gpu-grad.js — WebGPU PPO gradient backend (experimental)
//
//  Computes the same gradient sums as nn-core.js accumulatePPOGrads(), but on
//  the GPU: each shader thread processes a group of samples (forward + PPO
//  loss + backward) into its own gradient slab; a second kernel reduces the
//  slabs into one gradient vector that is read back to the CPU for the Adam
//  step.
//
//  WGSL is generated per network architecture with all layer sizes and buffer
//  offsets baked in as constants (full layer unrolling — no runtime-indexed
//  size tables).  Precision is f32; the sim-worker validates the first GPU
//  minibatch against the f64 JS path and disables the backend on mismatch.
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

// Activation base offsets within the shared acts array (input at 0).
function actBases(sizes) {
  const bases = [0];
  for (let l = 0; l < sizes.length; l++) bases.push(bases[l] + sizes[l]);
  return bases; // bases[l] = start of layer-l activations
}

function emitForward(sizes, wOff, bOff, bases) {
  let code = '';
  for (let l = 0; l < sizes.length - 1; l++) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const last = l === sizes.length - 2;
    code += `
    for (var j = 0u; j < ${nOut}u; j++) {
      var sum = weights[${bOff[l]}u + j];
      let row = ${wOff[l]}u + j * ${nIn}u;
      for (var i = 0u; i < ${nIn}u; i++) { sum += weights[row + i] * acts[${bases[l]}u + i]; }
      acts[${bases[l + 1]}u + j] = ${last ? 'sum' : 'tanh(sum)'};
    }`;
  }
  return code;
}

// Backward pass: reads delta from dcur[0..nOut), accumulates into the slab
// (same offsets as the weights array — the slab mirrors its layout), and
// leaves the previous layer's delta in dcur for the next iteration.
function emitBackward(sizes, wOff, bOff, bases) {
  let code = '';
  for (let l = sizes.length - 2; l >= 0; l--) {
    const nIn = sizes[l], nOut = sizes[l + 1];
    const hasPrev = l > 0;
    code += `
    ${hasPrev ? `for (var i = 0u; i < ${nIn}u; i++) { dnxt[i] = 0.0; }` : ''}
    for (var j = 0u; j < ${nOut}u; j++) {
      let dj = dcur[j];
      if (dj != 0.0) {
        slabs[sb + ${bOff[l]}u + j] += dj;
        let row = ${wOff[l]}u + j * ${nIn}u;
        for (var i = 0u; i < ${nIn}u; i++) {
          slabs[sb + row + i] += dj * acts[${bases[l]}u + i];
          ${hasPrev ? 'dnxt[i] += dj * weights[row + i];' : ''}
        }
      }
    }
    ${hasPrev ? `
    for (var i = 0u; i < ${nIn}u; i++) {
      let av = acts[${bases[l]}u + i];
      dcur[i] = dnxt[i] * (1.0 - av * av);
    }` : ''}`;
  }
  return code;
}

function genWGSL(lay) {
  const { AS, CS, I, A, CAP, GROUP, SLAB, aP, cP, OUT } = lay;
  const aOffs = layerOffsets(AS, 0);
  const cOffs = layerOffsets(CS, aP);
  const aBases = actBases(AS);
  const cBases = actBases(CS); // shares the acts array; safe — critic runs after actor backward
  const ACTS = Math.max(aBases[AS.length], cBases[CS.length]);
  const MAXW = Math.max(...AS, ...CS);
  const MUB  = aBases[AS.length - 1];   // actor output (means) base
  const CVB  = cBases[CS.length - 1];   // critic output base
  const LS   = aP + cP;                 // logStd offset in weights buffer
  const GLS  = aP + cP;                 // gLogStd offset in slab
  const LOSS = aP + cP + A;             // [pi, v, ent] offset in slab
  // batch buffer region offsets (capacity-based)
  const OB = 0, AB = CAP * I, LB = CAP * (I + A), DB = LB + CAP, RB = DB + CAP;

  return /* wgsl */ `
struct Uni { n: u32, nGroups: u32, clip: f32, entCoef: f32, vfCoef: f32 };
@group(0) @binding(0) var<storage, read>        weights : array<f32>;
@group(0) @binding(1) var<storage, read>        batch   : array<f32>;
@group(0) @binding(2) var<storage, read_write>  slabs   : array<f32>;
@group(0) @binding(3) var<storage, read_write>  outg    : array<f32>;
@group(0) @binding(4) var<uniform>              uni     : Uni;

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

  let k0 = g * ${GROUP}u;
  let k1 = min(uni.n, k0 + ${GROUP}u);
  for (var k = k0; k < k1; k++) {
    for (var i = 0u; i < ${I}u; i++) { acts[i] = batch[${OB}u + k * ${I}u + i]; }

    // ── Actor forward ──
    ${emitForward(AS, aOffs.wOff, aOffs.bOff, aBases)}

    // ── Gaussian log-prob of the stored action ──
    var lp = 0.0;
    for (var d = 0u; d < ${A}u; d++) {
      let ls = weights[${LS}u + d];
      let sd = exp(ls);
      let z  = (batch[${AB}u + k * ${A}u + d] - acts[${MUB}u + d]) / sd;
      lp += -0.5 * z * z - ls - ${0.5 * LOG_2PI};
    }

    // ── PPO clipped surrogate ──
    let ratio = exp(min(20.0, lp - batch[${LB}u + k]));
    let advk  = batch[${DB}u + k];
    let clp   = clamp(ratio, 1.0 - uni.clip, 1.0 + uni.clip);
    let surr1 = ratio * advk;
    let surr2 = clp * advk;
    lossPi += -min(surr1, surr2);

    var coef = 0.0;
    if (surr1 <= surr2) { coef = -advk * ratio; }
    if (coef != 0.0) {
      for (var d = 0u; d < ${A}u; d++) {
        let ls   = weights[${LS}u + d];
        let sd2  = exp(2.0 * ls);
        let diff = batch[${AB}u + k * ${A}u + d] - acts[${MUB}u + d];
        dcur[d] = coef * diff / sd2;
        slabs[sb + ${GLS}u + d] += coef * (diff * diff / sd2 - 1.0);
      }
      // ── Actor backward ──
      ${emitBackward(AS, aOffs.wOff, aOffs.bOff, aBases)}
    }

    // ── Entropy bonus ──
    for (var d = 0u; d < ${A}u; d++) {
      slabs[sb + ${GLS}u + d] += -uni.entCoef;
      lossEnt += weights[${LS}u + d] + ${0.5 * (LOG_2PI + 1)};
    }

    // ── Critic forward (overwrites actor hidden acts — actor pass is done) ──
    ${emitForward(CS, cOffs.wOff, cOffs.bOff, cBases)}
    let v  = acts[${CVB}u];
    let dr = v - batch[${RB}u + k];
    lossV += 0.5 * dr * dr;
    dcur[0] = uni.vfCoef * dr;
    // ── Critic backward ──
    ${emitBackward(CS, cOffs.wOff, cOffs.bOff, cBases)}
  }

  slabs[sb + ${LOSS}u + 0u] = lossPi;
  slabs[sb + ${LOSS}u + 1u] = lossV;
  slabs[sb + ${LOSS}u + 2u] = lossEnt;
}

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
  static async create(actorSizes, criticSizes, cap) {
    try {
      if (!(self.navigator && navigator.gpu)) {
        return { ok: false, error: 'WebGPU not available in this browser/worker' };
      }
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { ok: false, error: 'no WebGPU adapter (GPU blocked or unsupported)' };
      const device = await adapter.requestDevice();
      const g = new GpuGrad(device, actorSizes, criticSizes, cap | 0 || 256);
      await g._build();
      return { ok: true, gpu: g };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  constructor(device, actorSizes, criticSizes, cap) {
    this.device = device;
    this.lost = false;
    device.lost.then(() => { this.lost = true; });

    const AS = actorSizes.slice(), CS = criticSizes.slice();
    const I = AS[0], A = AS[AS.length - 1];
    const aP = paramCount(AS), cP = paramCount(CS);
    const SLAB = aP + cP + A + 4;          // grads + gLogStd + [pi, v, ent, pad]
    const OUT  = aP + cP + A + 4;

    // Samples per thread: keep the slab buffer under ~48 MB.
    let GROUP = 4;
    while (Math.ceil(cap / GROUP) * SLAB * 4 > 48 * 1024 * 1024) GROUP *= 2;

    this.lay = { AS, CS, I, A, CAP: cap, GROUP, SLAB, aP, cP, OUT };
    this.cap = cap;
    this.W = aP + cP + A;                  // weights buffer length (floats)
    this._wScratch = new Float32Array(this.W);
  }

  async _build() {
    const d = this.device;
    const { CAP, I, A, SLAB, OUT } = this.lay;
    const nGroupsMax = Math.ceil(CAP / this.lay.GROUP);

    const module = d.createShaderModule({ code: genWGSL(this.lay) });
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) {
      throw new Error('WGSL: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | '));
    }

    const layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const pipeLayout = d.createPipelineLayout({ bindGroupLayouts: [layout] });
    [this.gradPipe, this.reducePipe] = await Promise.all([
      d.createComputePipelineAsync({ layout: pipeLayout, compute: { module, entryPoint: 'grad_main' } }),
      d.createComputePipelineAsync({ layout: pipeLayout, compute: { module, entryPoint: 'reduce_main' } }),
    ]);

    const mk = (size, usage) => d.createBuffer({ size, usage });
    this.bufWeights = mk(this.W * 4,                     GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.bufBatch   = mk((CAP * (I + A) + 3 * CAP) * 4,  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.bufSlabs   = mk(nGroupsMax * SLAB * 4,          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.bufOut     = mk(OUT * 4,                        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.bufUni     = mk(32,                             GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.bufStage   = mk(OUT * 4,                        GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    this.bindGroup = d.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.bufWeights } },
        { binding: 1, resource: { buffer: this.bufBatch } },
        { binding: 2, resource: { buffer: this.bufSlabs } },
        { binding: 3, resource: { buffer: this.bufOut } },
        { binding: 4, resource: { buffer: this.bufUni } },
      ],
    });
  }

  // slice: { n, obs, act, logp, adv, ret } (Float64Arrays from packSlice)
  async compute(actorFlat, criticFlat, logStd, hp, slice) {
    if (this.lost) throw new Error('GPU device lost');
    const d = this.device, q = d.queue;
    const { I, A, CAP, GROUP, aP, cP, OUT } = this.lay;
    const n = slice.n;
    const nGroups = Math.ceil(n / GROUP);

    // weights + logStd  (f64 → f32)
    const w = this._wScratch;
    w.set(actorFlat, 0);          // TypedArray.set converts f64 → f32
    w.set(criticFlat, aP);
    for (let k = 0; k < A; k++) w[aP + cP + k] = logStd[k];
    q.writeBuffer(this.bufWeights, 0, w);

    // batch regions
    q.writeBuffer(this.bufBatch, 0,                     Float32Array.from(slice.obs));
    q.writeBuffer(this.bufBatch, CAP * I * 4,           Float32Array.from(slice.act));
    q.writeBuffer(this.bufBatch, CAP * (I + A) * 4,     Float32Array.from(slice.logp));
    q.writeBuffer(this.bufBatch, (CAP * (I + A) + CAP) * 4,     Float32Array.from(slice.adv));
    q.writeBuffer(this.bufBatch, (CAP * (I + A) + 2 * CAP) * 4, Float32Array.from(slice.ret));

    // uniforms
    const ub = new ArrayBuffer(32);
    const u32 = new Uint32Array(ub), f32 = new Float32Array(ub);
    u32[0] = n; u32[1] = nGroups;
    f32[2] = hp.clip; f32[3] = hp.entropyCoef; f32[4] = hp.vfCoef;
    q.writeBuffer(this.bufUni, 0, ub);

    const enc = d.createCommandEncoder();
    enc.clearBuffer(this.bufSlabs);
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.gradPipe);
    pass.dispatchWorkgroups(Math.ceil(nGroups / 64));
    pass.setPipeline(this.reducePipe);
    pass.dispatchWorkgroups(Math.ceil(OUT / 256));
    pass.end();
    enc.copyBufferToBuffer(this.bufOut, 0, this.bufStage, 0, OUT * 4);
    q.submit([enc.finish()]);

    await this.bufStage.mapAsync(GPUMapMode.READ);
    const res = new Float32Array(this.bufStage.getMappedRange()).slice();
    this.bufStage.unmap();

    return {
      aG:  Float64Array.from(res.subarray(0, aP)),
      cG:  Float64Array.from(res.subarray(aP, aP + cP)),
      gLs: Float64Array.from(res.subarray(aP + cP, aP + cP + A)),
      pi:  res[aP + cP + A],
      v:   res[aP + cP + A + 1],
      ent: res[aP + cP + A + 2],
    };
  }

  destroy() {
    try { this.device.destroy(); } catch (_) { /* already gone */ }
  }
}
