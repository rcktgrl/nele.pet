'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  nn-core.js — shared neural-net + PPO/SAC gradient math
//
//  Used by sim-worker.js (coordinator + fallback) and grad-worker.js
//  (parallel gradient computation). No DOM, no Three.js.
// ─────────────────────────────────────────────────────────────────────────────

export const LOG_2PI = Math.log(2 * Math.PI);

export function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Net {
  // sizes e.g. [36, 64, 2]; tanh hidden layers, linear output.
  constructor(sizes, finalScale = 1) {
    this.sizes = sizes;
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      const lim = Math.sqrt(6 / (nIn + nOut)) * (l === sizes.length - 2 ? finalScale : 1);
      const W = new Float64Array(nOut * nIn);
      for (let k = 0; k < W.length; k++) W[k] = (Math.random() * 2 - 1) * lim;
      this.W.push(W);
      this.b.push(new Float64Array(nOut));
    }
    this.gW = this.W.map(w => new Float64Array(w.length));
    this.gb = this.b.map(b => new Float64Array(b.length));
    this.mW = this.W.map(w => new Float64Array(w.length));
    this.vW = this.W.map(w => new Float64Array(w.length));
    this.mb = this.b.map(b => new Float64Array(b.length));
    this.vb = this.b.map(b => new Float64Array(b.length));
    this.t  = 0;
  }

  paramCount() {
    let n = 0;
    for (let l = 0; l < this.W.length; l++) n += this.W[l].length + this.b[l].length;
    return n;
  }

  forward(x, cache = null) {
    let a = x;
    if (cache) cache.acts = [x];
    for (let l = 0; l < this.W.length; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const W = this.W[l], b = this.b[l];
      const out = new Float64Array(nOut);
      const isLast = l === this.W.length - 1;
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        const off = j * nIn;
        for (let i = 0; i < nIn; i++) s += W[off + i] * a[i];
        out[j] = isLast ? s : Math.tanh(s);
      }
      a = out;
      if (cache) cache.acts.push(out);
    }
    return a;
  }

  // Accumulates gradients; dOut = dLoss/dOutput for the cached forward pass.
  backward(cache, dOut) {
    let delta = dOut;
    for (let l = this.W.length - 1; l >= 0; l--) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const aIn = cache.acts[l];
      const W = this.W[l], gW = this.gW[l], gb = this.gb[l];
      const dPrev = l > 0 ? new Float64Array(nIn) : null;
      for (let j = 0; j < nOut; j++) {
        const d = delta[j];
        if (d === 0) continue;
        gb[j] += d;
        const off = j * nIn;
        for (let i = 0; i < nIn; i++) {
          gW[off + i] += d * aIn[i];
          if (dPrev) dPrev[i] += d * W[off + i];
        }
      }
      if (dPrev) {
        for (let i = 0; i < nIn; i++) dPrev[i] *= (1 - aIn[i] * aIn[i]);
        delta = dPrev;
      }
    }
  }

  // Gradient of the (scalar-weighted) output w.r.t. the INPUT vector, without
  // touching the weight gradients. Needed by SAC's actor loss, where dQ/da
  // flows through the critic into the actor but must not update the critic.
  backwardToInput(cache, dOut) {
    let delta = dOut;
    for (let l = this.W.length - 1; l >= 0; l--) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const aIn = cache.acts[l];
      const W = this.W[l];
      const dPrev = new Float64Array(nIn);
      for (let j = 0; j < nOut; j++) {
        const d = delta[j];
        if (d === 0) continue;
        const off = j * nIn;
        for (let i = 0; i < nIn; i++) dPrev[i] += d * W[off + i];
      }
      if (l > 0) {
        for (let i = 0; i < nIn; i++) dPrev[i] *= (1 - aIn[i] * aIn[i]);
      }
      delta = dPrev;
    }
    return delta;
  }

  zeroGrad() {
    for (const g of this.gW) g.fill(0);
    for (const g of this.gb) g.fill(0);
  }

  // Clear Adam moments + step count — required after externally overwriting
  // the weights (checkpoint restore), or the stale momentum immediately
  // pushes the restored weights back toward the abandoned policy.
  resetAdam() {
    for (const m of this.mW) m.fill(0);
    for (const v of this.vW) v.fill(0);
    for (const m of this.mb) m.fill(0);
    for (const v of this.vb) v.fill(0);
    this.t = 0;
  }

  adamStep(lr, scale) {
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const bc1 = 1 - Math.pow(b1, this.t), bc2 = 1 - Math.pow(b2, this.t);
    const upd = (P, G, M, V) => {
      for (let k = 0; k < P.length; k++) {
        const g = G[k] * scale;
        M[k] = b1 * M[k] + (1 - b1) * g;
        V[k] = b2 * V[k] + (1 - b2) * g * g;
        P[k] -= lr * (M[k] / bc1) / (Math.sqrt(V[k] / bc2) + eps);
      }
    };
    for (let l = 0; l < this.W.length; l++) {
      upd(this.W[l], this.gW[l], this.mW[l], this.vW[l]);
      upd(this.b[l], this.gb[l], this.mb[l], this.vb[l]);
    }
  }

  // Flat layout per layer: all weight rows (nOut × nIn), then all biases.
  flat() {
    const out = [];
    for (let l = 0; l < this.W.length; l++) {
      for (const w of this.W[l]) out.push(w);
      for (const b of this.b[l]) out.push(b);
    }
    return out;
  }

  flatF64() {
    const out = new Float64Array(this.paramCount());
    let k = 0;
    for (let l = 0; l < this.W.length; l++) {
      out.set(this.W[l], k); k += this.W[l].length;
      out.set(this.b[l], k); k += this.b[l].length;
    }
    return out;
  }

  loadFlat(arr) {
    let k = 0;
    for (let l = 0; l < this.W.length; l++) {
      for (let i = 0; i < this.W[l].length; i++) this.W[l][i] = arr[k++];
      for (let i = 0; i < this.b[l].length; i++) this.b[l][i] = arr[k++];
    }
  }

  gradFlatF64() {
    const out = new Float64Array(this.paramCount());
    let k = 0;
    for (let l = 0; l < this.gW.length; l++) {
      out.set(this.gW[l], k); k += this.gW[l].length;
      out.set(this.gb[l], k); k += this.gb[l].length;
    }
    return out;
  }

  loadGradFlat(arr) {
    let k = 0;
    for (let l = 0; l < this.gW.length; l++) {
      this.gW[l].set(arr.subarray(k, k + this.gW[l].length)); k += this.gW[l].length;
      this.gb[l].set(arr.subarray(k, k + this.gb[l].length)); k += this.gb[l].length;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PPO per-sample gradient accumulation (clipped surrogate + entropy + value)
//
//  data: { n, obsDim, actDim, obs, act, logp, adv, ret } — packed Float64Arrays
//  hp:   { clip, entropyCoef, vfCoef }
//  Accumulates into actor/critic .gW/.gb (call zeroGrad first).
//  Returns { gLs, pi, v, ent } — logStd gradient sums + loss sums.
// ─────────────────────────────────────────────────────────────────────────────

export function accumulatePPOGrads(actor, critic, logStd, hp, data) {
  const { n, obsDim, actDim, obs, act, logp, adv, ret } = data;
  const gLs = new Float64Array(actDim);
  let sumPi = 0, sumV = 0, sumEnt = 0;

  for (let k = 0; k < n; k++) {
    const o = obs.subarray(k * obsDim, (k + 1) * obsDim);
    const a = act.subarray(k * actDim, (k + 1) * actDim);
    const A = adv[k], R = ret[k];

    // ── Actor ──
    const aCache = {};
    const mu = actor.forward(o, aCache);
    let lp = 0;
    for (let d = 0; d < actDim; d++) {
      const sd = Math.exp(logStd[d]);
      const z = (a[d] - mu[d]) / sd;
      lp += -0.5 * z * z - logStd[d] - 0.5 * LOG_2PI;
    }
    const ratio = Math.exp(Math.min(20, lp - logp[k]));
    const clipped = Math.max(1 - hp.clip, Math.min(1 + hp.clip, ratio));
    const surr1 = ratio * A, surr2 = clipped * A;
    sumPi += -Math.min(surr1, surr2);
    // gradient flows only through the unclipped branch when it's the min
    const coef = surr1 <= surr2 ? -A * ratio : 0;
    if (coef !== 0) {
      const dMu = new Float64Array(actDim);
      for (let d = 0; d < actDim; d++) {
        const sd2 = Math.exp(2 * logStd[d]);
        dMu[d] = coef * (a[d] - mu[d]) / sd2;
        gLs[d] += coef * (((a[d] - mu[d]) ** 2) / sd2 - 1);
      }
      actor.backward(aCache, dMu);
    }
    // entropy bonus: H = Σ(logσ + ½log(2πe)) → dH/dlogσ = 1
    for (let d = 0; d < actDim; d++) {
      gLs[d] += -hp.entropyCoef;
      sumEnt += logStd[d] + 0.5 * (LOG_2PI + 1);
    }

    // ── Critic ──
    const cCache = {};
    const v = critic.forward(o, cCache)[0];
    const dv = hp.vfCoef * (v - R);
    sumV += 0.5 * (v - R) ** 2;
    critic.backward(cCache, Float64Array.of(dv));
  }

  return { gLs, pi: sumPi, v: sumV, ent: sumEnt };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SAC per-sample gradient accumulation
//
//  Actor outputs [mu(A), logStd(A)] (state-dependent std); the policy action
//  is a = tanh(mu + σ·ε) — bounded by construction, so unlike the PPO path no
//  clamping bias exists at the action limits. Twin Q critics take [obs, act]
//  and target critics provide the bootstrap; entropy temperature α is learned
//  against a target entropy (loss form matches Stable-Baselines3:
//  dJ/dlogα = −(logπ + H̄) per sample).
//
//  nets: { actor, q1, q2, tq1, tq2 } — Net instances (tq* are read-only here)
//  hp:   { gamma, logAlpha, targetEntropy }
//  data: { n, obsDim, actDim, obs, act, rew, obs2, done, noise, noise2 }
//        noise / noise2: n×actDim standard-normal draws for the reparametrised
//        actions at s and s' (passed in so WASM and JS paths can share them)
//  Accumulates into actor/q1/q2 .gW/.gb (call zeroGrad first).
//  Returns { gLa, q, pi, ent, std } — logα gradient sum + loss/stat sums.
// ─────────────────────────────────────────────────────────────────────────────

export const SAC_LOGSTD_MIN = -5;
export const SAC_LOGSTD_MAX = 2;
const TANH_EPS = 1e-6;

export function accumulateSACGrads(nets, hp, data) {
  const { actor, q1, q2, tq1, tq2 } = nets;
  const { n, obsDim, actDim, obs, act, rew, obs2, done, noise, noise2 } = data;
  const alpha = Math.exp(hp.logAlpha);
  const qIn = new Float64Array(obsDim + actDim);
  let gLa = 0, sumQ = 0, sumPi = 0, sumEnt = 0, sumStd = 0;

  for (let k = 0; k < n; k++) {
    const o  = obs.subarray(k * obsDim, (k + 1) * obsDim);
    const o2 = obs2.subarray(k * obsDim, (k + 1) * obsDim);
    const a  = act.subarray(k * actDim, (k + 1) * actDim);
    const e  = noise.subarray(k * actDim, (k + 1) * actDim);
    const e2 = noise2.subarray(k * actDim, (k + 1) * actDim);

    // ── Bootstrap target: y = r + γ(1−d)(min Q'(s',ã') − α·logπ(ã'|s')) ──
    const out2 = actor.forward(o2);
    qIn.set(o2, 0);
    let logp2 = 0;
    for (let d = 0; d < actDim; d++) {
      const ls = Math.max(SAC_LOGSTD_MIN, Math.min(SAC_LOGSTD_MAX, out2[actDim + d]));
      const u  = out2[d] + Math.exp(ls) * e2[d];
      const ad = Math.tanh(u);
      logp2 += -0.5 * e2[d] * e2[d] - ls - 0.5 * LOG_2PI - Math.log(1 - ad * ad + TANH_EPS);
      qIn[obsDim + d] = ad;
    }
    const tqMin = Math.min(tq1.forward(qIn)[0], tq2.forward(qIn)[0]);
    const y = rew[k] + hp.gamma * (1 - done[k]) * (tqMin - alpha * logp2);

    // ── Critic: ½(Q1−y)² + ½(Q2−y)² on the REPLAYED action ──
    qIn.set(o, 0);
    qIn.set(a, obsDim);
    const c1 = {}, c2 = {};
    const q1v = q1.forward(qIn, c1)[0];
    const q2v = q2.forward(qIn, c2)[0];
    sumQ += 0.5 * ((q1v - y) ** 2 + (q2v - y) ** 2);
    q1.backward(c1, Float64Array.of(q1v - y));
    q2.backward(c2, Float64Array.of(q2v - y));

    // ── Actor: α·logπ(ã|s) − min Q(s,ã), ã reparametrised ──
    const aCache = {};
    const out = actor.forward(o, aCache);
    const dOut = new Float64Array(2 * actDim);
    let logp = 0;
    for (let d = 0; d < actDim; d++) {
      const lsRaw = out[actDim + d];
      const ls = Math.max(SAC_LOGSTD_MIN, Math.min(SAC_LOGSTD_MAX, lsRaw));
      const sd = Math.exp(ls);
      const u  = out[d] + sd * e[d];
      const ad = Math.tanh(u);
      logp += -0.5 * e[d] * e[d] - ls - 0.5 * LOG_2PI - Math.log(1 - ad * ad + TANH_EPS);
      qIn[obsDim + d] = ad;
      sumStd += sd / actDim;
    }
    const f1 = {}, f2 = {};
    const q1a = q1.forward(qIn, f1)[0];
    const q2a = q2.forward(qIn, f2)[0];
    const qMinNet = q1a <= q2a ? q1 : q2;
    const qMinCache = q1a <= q2a ? f1 : f2;
    sumPi += alpha * logp - Math.min(q1a, q2a);
    // dQ/d(input) through the argmin critic only — no critic weight grads
    const dQin = qMinNet.backwardToInput(qMinCache, Float64Array.of(1));
    for (let d = 0; d < actDim; d++) {
      const lsRaw = out[actDim + d];
      const ls = Math.max(SAC_LOGSTD_MIN, Math.min(SAC_LOGSTD_MAX, lsRaw));
      const sd = Math.exp(ls);
      const ad = qIn[obsDim + d];
      const oneMinusA2 = 1 - ad * ad;
      // dlogπ/du via the tanh correction (the Gaussian term cancels in u);
      // dL/dã from the −minQ pathway
      const dLdu = alpha * (2 * ad * oneMinusA2 / (oneMinusA2 + TANH_EPS))
                 - dQin[obsDim + d] * oneMinusA2;
      dOut[d] = dLdu;                                   // ∂u/∂mu = 1
      // clamp gate: no gradient to logStd outside its bounds
      dOut[actDim + d] = (lsRaw > SAC_LOGSTD_MIN && lsRaw < SAC_LOGSTD_MAX)
        ? dLdu * sd * e[d] - alpha                       // ∂u/∂logσ = σε; ∂logπ/∂logσ = −1
        : 0;
    }
    actor.backward(aCache, dOut);

    // ── Temperature: dJ/dlogα = −(logπ + H̄), logπ detached ──
    gLa += -(logp + hp.targetEntropy);
    sumEnt += -logp;
  }

  return { gLa, q: sumQ, pi: sumPi, ent: sumEnt, std: sumStd };
}
