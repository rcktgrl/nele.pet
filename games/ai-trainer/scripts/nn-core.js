'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  nn-core.js — shared neural-net + PPO gradient math
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
