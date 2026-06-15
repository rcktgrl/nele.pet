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

  // Forward pass into preallocated per-net buffers — no allocations, for hot
  // per-tick callers (action selection, value bootstraps, KL probes).
  // The returned array is REUSED by the next call: copy it if you keep it.
  forwardScratch(x) {
    if (!this._scratch) {
      this._scratch = [];
      for (let l = 1; l < this.sizes.length; l++) this._scratch.push(new Float64Array(this.sizes[l]));
    }
    let a = x;
    for (let l = 0; l < this.W.length; l++) {
      const nIn = this.sizes[l], nOut = this.sizes[l + 1];
      const W = this.W[l], b = this.b[l];
      const out = this._scratch[l];
      const isLast = l === this.W.length - 1;
      for (let j = 0; j < nOut; j++) {
        let s = b[j];
        const off = j * nIn;
        for (let i = 0; i < nIn; i++) s += W[off + i] * a[i];
        out[j] = isLast ? s : Math.tanh(s);
      }
      a = out;
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

  // PopArt output-layer rescale: keep the network's de-normalised output
  // (raw = out·std + mean) unchanged when the value-normalisation statistics
  // shift from (oldMean,oldStd) to (newMean,newStd). Applied to the linear
  // output layer so a moving return scale never invalidates the learned value
  // function. Output dim is arbitrary (the critic uses 1).
  popartRescale(oldMean, oldStd, newMean, newStd) {
    const L = this.W.length - 1;
    const W = this.W[L], b = this.b[L];
    const s = oldStd / newStd;
    for (let k = 0; k < W.length; k++) W[k] *= s;
    for (let j = 0; j < b.length; j++) b[j] = (b[j] * oldStd + oldMean - newMean) / newStd;
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
//  GRUNet — single GRU recurrent layer + linear output head.
//
//  Replaces the "memory-as-action" external register with a true recurrent
//  state carried across decisions, trained by backprop-through-time (BPTT).
//  Used for both the recurrent actor (output = action means) and the
//  recurrent critic (output = state value). logStd stays separate, exactly
//  like the feed-forward path.
//
//  Equations (per step, hidden h, input x):
//    z  = σ(Wz·x + Uz·h₋ + bz)              (update gate)
//    r  = σ(Wr·x + Ur·h₋ + br)              (reset gate)
//    h~ = tanh(Wh·x + Uh·(r⊙h₋) + bh)       (candidate)
//    h  = (1−z)⊙h₋ + z⊙h~                   (new state)
//    y  = Wy·h + by                          (linear output)
//
//  Flat parameter layout (flat() / loadFlat()):
//    Wz Wr Wh (each H×I) · Uz Ur Uh (each H×H) · bz br bh (each H) · Wy(O×H) · by(O)
// ─────────────────────────────────────────────────────────────────────────────

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

export class GRUNet {
  // sizes: [I, H, O] — input, hidden, output.  outScale shrinks the initial
  // output head (small initial action means / values), like Net's finalScale.
  constructor(sizes, outScale = 1) {
    const [I, H, O] = sizes;
    this.sizes = sizes.slice();
    this.I = I; this.H = H; this.O = O;

    const xlim = Math.sqrt(6 / (I + H));   // input → hidden
    const hlim = Math.sqrt(6 / (H + H));   // hidden → hidden
    const ylim = Math.sqrt(6 / (H + O)) * outScale;
    const rnd = (n, lim) => {
      const a = new Float64Array(n);
      for (let k = 0; k < n; k++) a[k] = (Math.random() * 2 - 1) * lim;
      return a;
    };
    this.Wz = rnd(H * I, xlim); this.Wr = rnd(H * I, xlim); this.Wh = rnd(H * I, xlim);
    this.Uz = rnd(H * H, hlim); this.Ur = rnd(H * H, hlim); this.Uh = rnd(H * H, hlim);
    this.bz = new Float64Array(H); this.br = new Float64Array(H); this.bh = new Float64Array(H);
    this.Wy = rnd(O * H, ylim); this.by = new Float64Array(O);

    // Ordered parameter views — every per-parameter loop (flat, grads, Adam)
    // iterates this list, so the layout stays consistent everywhere.
    this._P = [this.Wz, this.Wr, this.Wh, this.Uz, this.Ur, this.Uh,
               this.bz, this.br, this.bh, this.Wy, this.by];
    this._G = this._P.map(p => new Float64Array(p.length));
    this._M = this._P.map(p => new Float64Array(p.length));
    this._V = this._P.map(p => new Float64Array(p.length));
    this.t = 0;

    // inference scratch (one decision at a time) — reused, not allocated
    this._z = new Float64Array(H); this._r = new Float64Array(H);
    this._hh = new Float64Array(H); this._rh = new Float64Array(H);
    this._y = new Float64Array(O);
  }

  paramCount() { let n = 0; for (const p of this._P) n += p.length; return n; }

  // Forward one step. hPrev → hOut written into `hOut` (Float64Array(H)).
  // Returns the output array (reused scratch — copy if retained).
  step(x, hPrev, hOut) {
    const { I, H, O } = this;
    const z = this._z, r = this._r, hh = this._hh, rh = this._rh, y = this._y;
    for (let j = 0; j < H; j++) {
      let sz = this.bz[j], sr = this.br[j];
      const xo = j * I, ho = j * H;
      for (let i = 0; i < I; i++) { sz += this.Wz[xo + i] * x[i]; sr += this.Wr[xo + i] * x[i]; }
      for (let k = 0; k < H; k++) { sz += this.Uz[ho + k] * hPrev[k]; sr += this.Ur[ho + k] * hPrev[k]; }
      z[j] = sigmoid(sz); r[j] = sigmoid(sr);
    }
    for (let k = 0; k < H; k++) rh[k] = r[k] * hPrev[k];
    for (let j = 0; j < H; j++) {
      let sh = this.bh[j];
      const xo = j * I, ho = j * H;
      for (let i = 0; i < I; i++) sh += this.Wh[xo + i] * x[i];
      for (let k = 0; k < H; k++) sh += this.Uh[ho + k] * rh[k];
      hh[j] = Math.tanh(sh);
      hOut[j] = (1 - z[j]) * hPrev[j] + z[j] * hh[j];
    }
    for (let o = 0; o < O; o++) {
      let s = this.by[o];
      const off = o * H;
      for (let j = 0; j < H; j++) s += this.Wy[off + j] * hOut[j];
      y[o] = s;
    }
    return y;
  }

  zeroGrad() { for (const g of this._G) g.fill(0); }
  resetAdam() { for (const m of this._M) m.fill(0); for (const v of this._V) v.fill(0); this.t = 0; }

  popartRescale(oldMean, oldStd, newMean, newStd) {
    const s = oldStd / newStd;
    for (let k = 0; k < this.Wy.length; k++) this.Wy[k] *= s;
    for (let j = 0; j < this.by.length; j++) this.by[j] = (this.by[j] * oldStd + oldMean - newMean) / newStd;
  }

  adamStep(lr, scale) {
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const bc1 = 1 - Math.pow(b1, this.t), bc2 = 1 - Math.pow(b2, this.t);
    for (let l = 0; l < this._P.length; l++) {
      const P = this._P[l], G = this._G[l], M = this._M[l], V = this._V[l];
      for (let k = 0; k < P.length; k++) {
        const g = G[k] * scale;
        M[k] = b1 * M[k] + (1 - b1) * g;
        V[k] = b2 * V[k] + (1 - b2) * g * g;
        P[k] -= lr * (M[k] / bc1) / (Math.sqrt(V[k] / bc2) + eps);
      }
    }
  }

  flatF64() {
    const out = new Float64Array(this.paramCount());
    let k = 0;
    for (const p of this._P) { out.set(p, k); k += p.length; }
    return out;
  }
  flat() { return Array.from(this.flatF64()); }

  loadFlat(arr) {
    let k = 0;
    for (const p of this._P) { for (let i = 0; i < p.length; i++) p[i] = arr[k++]; }
  }

  gradFlatF64() {
    const out = new Float64Array(this.paramCount());
    let k = 0;
    for (const g of this._G) { out.set(g, k); k += g.length; }
    return out;
  }

  loadGradFlat(arr) {
    let k = 0;
    for (const g of this._G) { g.set(arr.subarray(k, k + g.length)); k += g.length; }
  }

  // Forward a whole sequence from initial state h0, caching the per-step
  // intermediates BPTT needs. done[t]=1 resets the hidden state to zero before
  // step t+1, matching the rollout where an episode boundary clears the carried
  // state. Returns { ys: Float64Array(T*O), caches }.
  seqForward(obs, T, h0, done) {
    const { I, H, O } = this;
    const ys = new Float64Array(T * O);
    const caches = new Array(T);
    let hPrev = h0;
    for (let t = 0; t < T; t++) {
      const x = obs.subarray(t * I, t * I + I);
      const z = new Float64Array(H), r = new Float64Array(H);
      const hh = new Float64Array(H), rh = new Float64Array(H), h = new Float64Array(H);
      for (let j = 0; j < H; j++) {
        let sz = this.bz[j], sr = this.br[j];
        const xo = j * I, ho = j * H;
        for (let i = 0; i < I; i++) { sz += this.Wz[xo + i] * x[i]; sr += this.Wr[xo + i] * x[i]; }
        for (let k = 0; k < H; k++) { sz += this.Uz[ho + k] * hPrev[k]; sr += this.Ur[ho + k] * hPrev[k]; }
        z[j] = sigmoid(sz); r[j] = sigmoid(sr);
      }
      for (let k = 0; k < H; k++) rh[k] = r[k] * hPrev[k];
      for (let j = 0; j < H; j++) {
        let sh = this.bh[j];
        const xo = j * I, ho = j * H;
        for (let i = 0; i < I; i++) sh += this.Wh[xo + i] * x[i];
        for (let k = 0; k < H; k++) sh += this.Uh[ho + k] * rh[k];
        hh[j] = Math.tanh(sh);
        h[j] = (1 - z[j]) * hPrev[j] + z[j] * hh[j];
      }
      const yo = t * O;
      for (let o = 0; o < O; o++) {
        let s = this.by[o];
        const off = o * H;
        for (let j = 0; j < H; j++) s += this.Wy[off + j] * h[j];
        ys[yo + o] = s;
      }
      caches[t] = { x, hPrev, z, r, hh, rh, h };
      // episode boundary → next step starts from a zero state
      hPrev = (done && done[t]) ? new Float64Array(H) : h;
    }
    return { ys, caches };
  }

  // BPTT over a sequence. dYs is dLoss/dy for every step (Float64Array(T*O));
  // done[t]=1 marks an episode boundary AFTER step t (gradient does not flow
  // from step t+1's hidden input back into step t). Accumulates into this._G.
  seqBackward(caches, dYs, done) {
    const { I, H, O } = this;
    const T = caches.length;
    const [gWz, gWr, gWh, gUz, gUr, gUh, gbz, gbr, gbh, gWy, gby] = this._G;
    let dhNext = new Float64Array(H);  // dLoss/dh flowing from future steps
    for (let t = T - 1; t >= 0; t--) {
      const c = caches[t];
      const dh = new Float64Array(H);
      for (let k = 0; k < H; k++) dh[k] = dhNext[k];
      // output head
      const yo = t * O;
      for (let o = 0; o < O; o++) {
        const dyo = dYs[yo + o];
        if (dyo === 0) continue;
        gby[o] += dyo;
        const off = o * H;
        for (let j = 0; j < H; j++) { gWy[off + j] += dyo * c.h[j]; dh[j] += dyo * this.Wy[off + j]; }
      }
      // h = (1−z)⊙hPrev + z⊙hh
      const dhPrev = new Float64Array(H);
      const dsh = new Float64Array(H);
      for (let j = 0; j < H; j++) {
        const dhh = dh[j] * c.z[j];
        const dz = dh[j] * (c.hh[j] - c.hPrev[j]);
        dhPrev[j] += dh[j] * (1 - c.z[j]);
        dsh[j] = dhh * (1 - c.hh[j] * c.hh[j]);    // through tanh, stored for below
        dh[j] = dz;    // reuse dh slot to hold dz for the gate pass below
      }
      // candidate: h~ = tanh(Wh·x + Uh·(r⊙hPrev) + bh)
      const drh = new Float64Array(H);
      for (let j = 0; j < H; j++) {
        const d = dsh[j];
        gbh[j] += d;
        const xo = j * I, ho = j * H;
        for (let i = 0; i < I; i++) gWh[xo + i] += d * c.x[i];
        for (let k = 0; k < H; k++) { gUh[ho + k] += d * c.rh[k]; drh[k] += d * this.Uh[ho + k]; }
      }
      // rh = r⊙hPrev
      const dr = new Float64Array(H);
      for (let k = 0; k < H; k++) { dr[k] = drh[k] * c.hPrev[k]; dhPrev[k] += drh[k] * c.r[k]; }
      // gates z,r through sigmoid; sz=bz+Wz·x+Uz·hPrev, sr similarly
      for (let j = 0; j < H; j++) {
        const dz = dh[j];                         // stored above
        const dsz = dz * c.z[j] * (1 - c.z[j]);
        const dsr = dr[j] * c.r[j] * (1 - c.r[j]);
        gbz[j] += dsz; gbr[j] += dsr;
        const xo = j * I, ho = j * H;
        for (let i = 0; i < I; i++) { gWz[xo + i] += dsz * c.x[i]; gWr[xo + i] += dsr * c.x[i]; }
        for (let k = 0; k < H; k++) {
          gUz[ho + k] += dsz * c.hPrev[k]; dhPrev[k] += dsz * this.Uz[ho + k];
          gUr[ho + k] += dsr * c.hPrev[k]; dhPrev[k] += dsr * this.Ur[ho + k];
        }
      }
      // propagate to the previous step unless a reset breaks the chain there
      // (h0 of t==0 is a fixed initial state → no gradient beyond it)
      dhNext = (t > 0 && !(done && done[t - 1])) ? dhPrev : new Float64Array(H);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Recurrent PPO per-sequence gradient (clipped surrogate + entropy + value),
//  with BPTT through the GRU actor and critic. Mirrors accumulatePPOGrads but
//  over an ordered sequence with carried hidden state.
//
//  seq: { T, obsDim, actDim, obs, act, logp, adv, ret, done, h0a, h0c }
//  Accumulates into actor/critic ._G (call zeroGrad first). Returns
//  { gLs, pi, v, ent } for this sequence.
// ─────────────────────────────────────────────────────────────────────────────

export function accumulatePPORecurrentGrads(actor, critic, logStd, hp, seq) {
  const { T, actDim, obs, act, logp, adv, ret, done, h0a, h0c } = seq;
  const gLs = new Float64Array(actDim);
  let sumPi = 0, sumV = 0, sumEnt = 0;

  const aF = actor.seqForward(obs, T, h0a, done);   // actor mean sequence
  const cF = critic.seqForward(obs, T, h0c, done);  // critic value sequence
  const dMu = new Float64Array(T * actDim);   // dLoss/dy for the actor
  const dV  = new Float64Array(T);            // dLoss/dy for the critic

  for (let t = 0; t < T; t++) {
    const a = act.subarray(t * actDim, (t + 1) * actDim);
    const A = adv[t], R = ret[t];
    const muOff = t * actDim;

    // ── Actor surrogate ──
    let lp = 0;
    for (let d = 0; d < actDim; d++) {
      const sd = Math.exp(logStd[d]);
      const z = (a[d] - aF.ys[muOff + d]) / sd;
      lp += -0.5 * z * z - logStd[d] - 0.5 * LOG_2PI;
    }
    const ratio = Math.exp(Math.min(20, lp - logp[t]));
    const clipped = Math.max(1 - hp.clip, Math.min(1 + hp.clip, ratio));
    const surr1 = ratio * A, surr2 = clipped * A;
    sumPi += -Math.min(surr1, surr2);
    const coef = surr1 <= surr2 ? -A * ratio : 0;
    if (coef !== 0) {
      for (let d = 0; d < actDim; d++) {
        const sd2 = Math.exp(2 * logStd[d]);
        dMu[muOff + d] = coef * (a[d] - aF.ys[muOff + d]) / sd2;
        gLs[d] += coef * (((a[d] - aF.ys[muOff + d]) ** 2) / sd2 - 1);
      }
    }
    // entropy bonus on logStd
    for (let d = 0; d < actDim; d++) {
      gLs[d] += -hp.entropyCoef;
      sumEnt += logStd[d] + 0.5 * (LOG_2PI + 1);
    }

    // ── Critic ──
    const v = cF.ys[t];
    dV[t] = hp.vfCoef * (v - R);
    sumV += 0.5 * (v - R) ** 2;
  }

  actor.seqBackward(aF.caches, dMu, done);
  critic.seqBackward(cF.caches, dV, done);

  return { gLs, pi: sumPi, v: sumV, ent: sumEnt };
}
