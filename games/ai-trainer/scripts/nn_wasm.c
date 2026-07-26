/*
 * nn_wasm.c — Neural-net forward/backward + PPO gradient accumulation for WASM.
 *
 * Compile:
 *   clang --target=wasm32 -nostdlib -fno-builtin -O3 -ffast-math -msimd128 \
 *         -Wl,--no-entry -Wl,--export-all -Wl,--allow-undefined \
 *         nn_wasm.c -o nn_wasm.wasm
 *
 * The committed nn_wasm.wasm is a clang 18.1.3 build. -msimd128 matters: the
 * same source without it measures ~1.4x slower, so clang IS auto-vectorising
 * these loops and the kernel below is written to give it contiguous runs.
 *
 * -fno-builtin keeps the optimizer from lowering array copies/fills into calls
 * to memcpy/memset that the freestanding target can't import. We provide those
 * three libcalls below so the module needs no imports at all — see the note
 * on exp()/tanh() below.
 *
 * The module is fully self-contained: no imports required. exp() and tanh()
 * used to be imported from the JS host (`env.exp`/`env.tanh`, i.e. Math.exp/
 * Math.tanh), but every hidden-unit activation and every log-prob/ratio term
 * calls one of them — tens of thousands of times per PPO minibatch — and each
 * call crossed the JS↔WASM boundary. That trampoline isn't free (it defeats
 * inlining and, on engines that don't special-case a fixed set of Math.*
 * imports, costs real per-call overhead), so a hot loop that leans on it can
 * end up slower than the equivalent JIT'd JS despite running compiled code.
 * exp_impl()/tanh_impl() below reimplement both natively (fdlibm-derived
 * range reduction + minimax polynomial for exp; exp-based identity for tanh),
 * verified to match JS Math.exp/Math.tanh to within double-precision rounding
 * — see test/wasm-math-check.mjs.
 *
 * All large arrays (weights, grads, batch data) live in WASM linear memory
 * managed by the JS caller.  The C code keeps only small fixed-size caches
 * for per-sample activations.
 */

/* freestanding: define NULL manually */
#define NULL ((void*)0)

/* ── exp()/tanh() — native, no JS import (see file header) ──────────────────
 *
 * exp_impl: fdlibm-style range reduction (x = k*ln2 + r, Cody-Waite split of
 * ln2 for precision) + the standard degree-5 minimax polynomial for exp(r)
 * on |r| <= ln2/2, then rebuild 2^k by constructing its bit pattern directly.
 * That bit trick only produces a valid double when k stays inside the normal
 * exponent range, so the overflow/underflow guards below reject any x whose
 * k would land outside a comfortable margin of that range *before* reaching
 * the bit construction, rather than relying on callers to pre-clamp x.
 *
 * tanh_impl: tanh(x) = (e^2x - 1)/(e^2x + 1) built on exp_impl. The
 * cancellation near x=0 only loses absolute precision at the ~1e-16 level
 * (tanh(x)≈x there already), which is far below the noise floor of a
 * stochastically-sampled PPO gradient.
 */
static double exp_impl(double x) {
    if (x != x) return x;                    /* NaN passthrough */
    if (x > 709.0) return 1e308 * 1e308;      /* -> +inf (safely below the true ~709.78 overflow edge) */
    /* Underflow to 0 well before k=round(x/ln2) could leave the safe normal
     * exponent range the pow2() bit-construction below relies on (needs
     * k >= -1022; -700 keeps k >= -1010, comfortable margin). True exp(x) here
     * is already <1e-304 — irrelevant to any gradient in this trainer — so
     * flushing to 0 instead of computing subnormals costs nothing that matters.
     * (PPO's ratio = exp(rho) has no LOWER clamp on rho, so very negative x is
     * reachable in practice during unstable early training — this must not
     * silently corrupt into garbage via a bad exponent bit pattern.) */
    if (x < -700.0) return 0.0;

    const double INV_LN2 = 1.4426950408889634074;
    const double LN2_HI  = 6.93147180369123816490e-01;
    const double LN2_LO  = 1.90821492927058770002e-10;
    const double P1 =  1.66666666666666019037e-01;
    const double P2 = -2.77777777770155933842e-03;
    const double P3 =  6.61375632143793436117e-05;
    const double P4 = -1.65339022054652515390e-06;
    const double P5 =  4.13813679705723846039e-08;

    double kf = x * INV_LN2;
    kf = (kf >= 0.0) ? (double)(long)(kf + 0.5) : (double)(long)(kf - 0.5);
    long k = (long)kf;

    double r = x - kf * LN2_HI;
    r = r - kf * LN2_LO;

    double t = r * r;
    double c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    double expr = 1.0 - ((r * c) / (c - 2.0) - r);

    /* 2^k via direct IEEE-754 bit construction (k stays well within the
     * normal exponent range here — see the overflow/underflow guards above). */
    unsigned long long bits = (unsigned long long)(k + 1023) << 52;
    double scale;
    __builtin_memcpy(&scale, &bits, sizeof(scale));
    return expr * scale;
}

static double tanh_impl(double x) {
    if (x > 20.0) return 1.0;
    if (x < -20.0) return -1.0;
    double e2x = exp_impl(2.0 * x);
    return (e2x - 1.0) / (e2x + 1.0);
}

#define exp  exp_impl
#define tanh tanh_impl

/* Exported test hooks only — let test/wasm-math-check.mjs verify exp_impl/
 * tanh_impl against JS Math.exp/Math.tanh directly. Not used by the hot path
 * (which calls the static functions above via the macros). */
__attribute__((visibility("default")))
double wasm_test_exp(double x) { return exp_impl(x); }
__attribute__((visibility("default")))
double wasm_test_tanh(double x) { return tanh_impl(x); }

/* ── Freestanding libcalls the optimizer may emit (resolved internally, not
 *    imported). Keep -fno-builtin on so these don't compile to calls to
 *    themselves. ── */
typedef __SIZE_TYPE__ nn_size_t;
__attribute__((visibility("default")))
void *memcpy(void *dst, const void *src, nn_size_t n) {
    unsigned char *d = (unsigned char *)dst; const unsigned char *s = (const unsigned char *)src;
    for (nn_size_t i = 0; i < n; i++) d[i] = s[i];
    return dst;
}
__attribute__((visibility("default")))
void *memmove(void *dst, const void *src, nn_size_t n) {
    unsigned char *d = (unsigned char *)dst; const unsigned char *s = (const unsigned char *)src;
    if (d < s) for (nn_size_t i = 0; i < n; i++) d[i] = s[i];
    else       for (nn_size_t i = n; i > 0; i--) d[i - 1] = s[i - 1];
    return dst;
}
__attribute__((visibility("default")))
void *memset(void *dst, int c, nn_size_t n) {
    unsigned char *d = (unsigned char *)dst;
    for (nn_size_t i = 0; i < n; i++) d[i] = (unsigned char)c;
    return dst;
}

#define LOG_2PI  1.8378770664093453  /* log(2π) */
#define MAX_LAYERS 8                 /* max weight-layer count per network */
#define MAX_UNITS  512               /* max neurons per layer              */

/* Per-sample activation caches.  Layout: acts[l * MAX_UNITS + j]
 * for layer l (0 = raw input), unit j.  Only one sample is live at a time. */
static double s_actor_acts[(MAX_LAYERS + 1) * MAX_UNITS];
static double s_critic_acts[(MAX_LAYERS + 1) * MAX_UNITS];

/* Two alternating delta buffers for backward pass (avoids aliasing). */
static double s_dA[MAX_UNITS];
static double s_dB[MAX_UNITS];

/* ── Blocked (batched) gradient kernel ────────────────────────────────────
 * The per-sample path below is correct but memory-bound: it walks the entire
 * weight matrix, and the entire gradient matrix, once for EVERY sample. At
 * 256×2 that is 1.2 MB restreamed 42,000× per generation, which is why the
 * kernel measured ~1-2 GFLOP/s — nowhere near what the arithmetic needs.
 *
 * The blocked path below processes BLK samples at a time with the loop nest
 * reordered so a weight row and its gradient row stay in L1 across the whole
 * block. Crucially it is NOT a reassociation: every accumulator still receives
 * exactly the same additions in exactly the same order as the per-sample path
 * (gW[j][i] and gb[j] over samples ascending, dPrev[s][i] over output units
 * ascending), so the gradients are bit-identical — only the memory traffic
 * changes. Nets wider than BLK_UNITS fall back to the per-sample path.
 */
#define BLK        32   /* samples per block                                */
#define GEMM_T      16   /* output tile held in registers by the gW kernel    */
#define BLK_UNITS 256   /* max layer width handled by the blocked path      */

static double s_blk_actor[(MAX_LAYERS + 1) * BLK * BLK_UNITS];
static double s_blk_critic[(MAX_LAYERS + 1) * BLK * BLK_UNITS];
static double s_blk_dcol[BLK];          /* one output unit's delta column   */
static double s_blk_d0[BLK * BLK_UNITS];
static double s_blk_d1[BLK * BLK_UNITS];

#define BLK_LAYER(base, l) ((base) + (nn_size_t)(l) * (BLK * BLK_UNITS))

static int blk_fits(int nlayers, const int *sizes) {
    if (nlayers > MAX_LAYERS) return 0;
    for (int l = 0; l <= nlayers; l++) if (sizes[l] > BLK_UNITS) return 0;
    return 1;
}

/* Forward a block. acts layer l holds bs×sizes[l], sample-major.
 * Four samples share each weight-row load. */
static void net_forward_blk(int nlayers, const int *sizes, const double *flat,
                            int bs, double *acts) {
    int offset = 0;
    for (int l = 0; l < nlayers; l++) {
        int nIn = sizes[l], nOut = sizes[l + 1];
        const double *W = flat + offset;   offset += nIn * nOut;
        const double *b = flat + offset;   offset += nOut;
        const double *A = BLK_LAYER(acts, l);
        double *O = BLK_LAYER(acts, l + 1);
        int is_last = (l == nlayers - 1);

        for (int j = 0; j < nOut; j++) {
            const double *w = W + (nn_size_t)j * nIn;
            double bj = b[j];
            int s = 0;
            for (; s + 3 < bs; s += 4) {
                const double *a0 = A + (nn_size_t)(s    ) * nIn;
                const double *a1 = A + (nn_size_t)(s + 1) * nIn;
                const double *a2 = A + (nn_size_t)(s + 2) * nIn;
                const double *a3 = A + (nn_size_t)(s + 3) * nIn;
                double t0 = bj, t1 = bj, t2 = bj, t3 = bj;
                for (int i = 0; i < nIn; i++) {
                    double wi = w[i];
                    t0 += wi * a0[i]; t1 += wi * a1[i];
                    t2 += wi * a2[i]; t3 += wi * a3[i];
                }
                if (!is_last) { t0 = tanh(t0); t1 = tanh(t1); t2 = tanh(t2); t3 = tanh(t3); }
                O[(nn_size_t)(s    ) * nOut + j] = t0;
                O[(nn_size_t)(s + 1) * nOut + j] = t1;
                O[(nn_size_t)(s + 2) * nOut + j] = t2;
                O[(nn_size_t)(s + 3) * nOut + j] = t3;
            }
            for (; s < bs; s++) {
                const double *as = A + (nn_size_t)s * nIn;
                double t = bj;
                for (int i = 0; i < nIn; i++) t += w[i] * as[i];
                O[(nn_size_t)s * nOut + j] = is_last ? t : tanh(t);
            }
        }
    }
}

/* Backward a block. `dout` holds bs×sizes[nlayers] sample-major and is
 * consumed; gradients accumulate into grad_flat. */
static void net_backward_blk(int nlayers, const int *sizes, const double *flat,
                             double *grad_flat, const double *acts,
                             const double *dout, int bs) {
    int w_off[MAX_LAYERS], b_off[MAX_LAYERS];
    int offset = 0;
    for (int l = 0; l < nlayers; l++) {
        w_off[l] = offset;  offset += sizes[l] * sizes[l + 1];
        b_off[l] = offset;  offset += sizes[l + 1];
    }

    const double *delta = dout;
    double *dprev_buf = s_blk_d0, *dprev_other = s_blk_d1;

    for (int l = nlayers - 1; l >= 0; l--) {
        int nIn = sizes[l], nOut = sizes[l + 1];
        const double *A = BLK_LAYER(acts, l);
        const double *W = flat      + w_off[l];
        double       *gW = grad_flat + w_off[l];
        double       *gb = grad_flat + b_off[l];

        double *dPrev = NULL;
        if (l > 0) {
            dPrev = dprev_buf;
            for (nn_size_t k = 0; k < (nn_size_t)bs * nIn; k++) dPrev[k] = 0.0;
        }

        /* ── Pass A: gW[j][i] += Σ_s d[s][j]·A[s][i] ──────────────────────
         * The gradient matrix is the hottest memory in the kernel: the
         * per-sample path read and wrote all of it once per sample. Here the
         * output tile stays in registers across the WHOLE block, so gW is
         * loaded and stored exactly once per block — a bs-fold cut in the
         * dominant traffic. i is tiled by GEMM_T so clang keeps the tile in
         * f64x2 registers and still vectorises the inner run.
         */
        for (int j = 0; j < nOut; j++) {
            double *gWj = gW + (nn_size_t)j * nIn;
            /* gather this unit's delta column: contiguous, and lets us skip
             * the (common) all-clipped case in one test */
            double sb = 0.0;
            int any = 0;
            for (int s = 0; s < bs; s++) {
                double d = delta[(nn_size_t)s * nOut + j];
                s_blk_dcol[s] = d;
                sb += d;
                any |= (d != 0.0);
            }
            gb[j] += sb;
            if (!any) continue;

            int i0 = 0;
            for (; i0 + GEMM_T <= nIn; i0 += GEMM_T) {
                double acc[GEMM_T];
                for (int t = 0; t < GEMM_T; t++) acc[t] = gWj[i0 + t];
                for (int s = 0; s < bs; s++) {
                    double d = s_blk_dcol[s];
                    if (d == 0.0) continue;
                    const double *as = A + (nn_size_t)s * nIn + i0;
                    for (int t = 0; t < GEMM_T; t++) acc[t] += d * as[t];
                }
                for (int t = 0; t < GEMM_T; t++) gWj[i0 + t] = acc[t];
            }
            for (; i0 < nIn; i0++) {                     /* ragged tail */
                double a0 = gWj[i0];
                for (int s = 0; s < bs; s++) {
                    double d = s_blk_dcol[s];
                    if (d == 0.0) continue;
                    a0 += d * A[(nn_size_t)s * nIn + i0];
                }
                gWj[i0] = a0;
            }
        }

        /* ── Pass B: dPrev[s][i] += Σ_j d[s][j]·W[j][i] ────────────────────
         * Split from pass A so neither loop runs out of registers (fusing
         * them needs four activation and four dPrev streams live at once and
         * measured slower). j outermost keeps the weight row hot across the
         * two samples that share each load.
         */
        if (dPrev) {
            for (int j = 0; j < nOut; j++) {
                const double *Wj = W + (nn_size_t)j * nIn;
                /* two samples per weight-row load. Four was measured slower:
                 * the extra dPrev streams spill on wasm32 (1.32× vs 1.78×). */
                int s = 0;
                for (; s + 1 < bs; s += 2) {
                    double d0 = delta[(nn_size_t)(s    ) * nOut + j];
                    double d1 = delta[(nn_size_t)(s + 1) * nOut + j];
                    if (d0 == 0.0 && d1 == 0.0) continue;
                    double *p0 = dPrev + (nn_size_t)(s    ) * nIn;
                    double *p1 = dPrev + (nn_size_t)(s + 1) * nIn;
                    for (int i = 0; i < nIn; i++) {
                        double w = Wj[i];
                        p0[i] += d0 * w;
                        p1[i] += d1 * w;
                    }
                }
                for (; s < bs; s++) {
                    double d = delta[(nn_size_t)s * nOut + j];
                    if (d == 0.0) continue;
                    double *ps = dPrev + (nn_size_t)s * nIn;
                    for (int i = 0; i < nIn; i++) ps[i] += d * Wj[i];
                }
            }
        }

        if (dPrev) {
            /* tanh derivative: d/dz tanh(z) = 1 - tanh(z)² = 1 - a² */
            for (nn_size_t k = 0; k < (nn_size_t)bs * nIn; k++) {
                double a = A[k];
                dPrev[k] *= (1.0 - a * a);
            }
            delta = dPrev;
            double *tmp = dprev_buf; dprev_buf = dprev_other; dprev_other = tmp;
        }
    }
}

/* ── net_forward ──────────────────────────────────────────────────────────
 * Runs one forward pass through `nlayers`-layer network.
 *
 * flat[]  : weights in the same layout as nn-core.js Net.flat():
 *             layer l → W[l] (nOut×nIn, row-major) then b[l] (nOut)
 * sizes[] : [nIn, h1, …, nOut], length = nlayers+1
 * input[] : nIn doubles
 * acts[]  : (nlayers+1)×MAX_UNITS scratch — caller supplies per-network buffer
 *
 * Returns pointer to output layer activations inside acts[].
 */
static const double *net_forward(int nlayers, const int *sizes,
                                 const double *flat, const double *input,
                                 double *acts) {
    /* Copy input into acts[0]. */
    int nIn0 = sizes[0];
    double *a0 = acts;
    for (int i = 0; i < nIn0; i++) a0[i] = input[i];

    const double *a = a0;
    int offset = 0;

    for (int l = 0; l < nlayers; l++) {
        int nIn  = sizes[l];
        int nOut = sizes[l + 1];
        const double *W = flat + offset;   offset += nIn * nOut;
        const double *b = flat + offset;   offset += nOut;

        double *o = acts + (l + 1) * MAX_UNITS;
        int is_last = (l == nlayers - 1);

        for (int j = 0; j < nOut; j++) {
            double s = b[j];
            int row = j * nIn;
            for (int i = 0; i < nIn; i++) s += W[row + i] * a[i];
            o[j] = is_last ? s : tanh(s);
        }
        a = o;
    }
    return a;
}

/* ── net_backward ─────────────────────────────────────────────────────────
 * Accumulates gradients into grad_flat[].
 * Caller must zero grad_flat before the first backward call in a minibatch.
 *
 * flat[]     : weights (read-only)
 * grad_flat[]: gradient accumulator (same layout as flat[])
 * acts[]     : activation cache from the corresponding net_forward call
 * d_out[]    : dLoss/dOutput for this sample (sizes[nlayers] doubles)
 */
static void net_backward(int nlayers, const int *sizes,
                         const double *flat, double *grad_flat,
                         const double *acts, const double *d_out) {
    /* Pre-compute per-layer weight/bias offsets. */
    int w_off[MAX_LAYERS];
    int b_off[MAX_LAYERS];
    int offset = 0;
    for (int l = 0; l < nlayers; l++) {
        w_off[l] = offset;  offset += sizes[l] * sizes[l + 1];
        b_off[l] = offset;  offset += sizes[l + 1];
    }

    const double *delta = d_out;
    int use_A = 1; /* alternate buffers to avoid aliasing */

    for (int l = nlayers - 1; l >= 0; l--) {
        int nIn  = sizes[l];
        int nOut = sizes[l + 1];

        const double *aIn = acts + l * MAX_UNITS;
        const double *W   = flat      + w_off[l];
        double       *gW  = grad_flat + w_off[l];
        double       *gb  = grad_flat + b_off[l];

        double *dPrev = NULL;
        if (l > 0) {
            dPrev = use_A ? s_dA : s_dB;
            for (int i = 0; i < nIn; i++) dPrev[i] = 0.0;
        }

        for (int j = 0; j < nOut; j++) {
            double d = delta[j];
            if (d == 0.0) continue;
            gb[j] += d;
            int row = j * nIn;
            if (dPrev) {
                for (int i = 0; i < nIn; i++) {
                    gW[row + i] += d * aIn[i];
                    dPrev[i]    += d * W[row + i];
                }
            } else {
                for (int i = 0; i < nIn; i++) {
                    gW[row + i] += d * aIn[i];
                }
            }
        }

        if (dPrev) {
            /* tanh derivative: d/dz tanh(z) = 1 - tanh(z)² = 1 - a² */
            for (int i = 0; i < nIn; i++) dPrev[i] *= (1.0 - aIn[i] * aIn[i]);
            delta = dPrev;
            use_A = !use_A;
        }
    }
}

/* ── compute_ppo_grads ────────────────────────────────────────────────────
 * Main exported function — mirrors accumulatePPOGrads() in nn-core.js.
 *
 * All pointer arguments are byte offsets into WASM linear memory.
 * The JS caller manages allocation; this function only reads/writes those
 * regions plus the small static caches above.
 *
 * Caller must zero actor_grad[] and critic_grad[] before this call.
 * Caller must zero g_log_std[]  before this call.
 *
 * out_losses[0] = sum of -min(surr1,surr2)   (policy loss)
 * out_losses[1] = sum of 0.5*(v-R)²           (value loss, unscaled)
 * out_losses[2] = sum of entropy               (entropy sum)
 */
__attribute__((visibility("default")))
void compute_ppo_grads(
        int n, int obs_dim, int act_dim,
        /* Network architectures */
        int n_actor_layers, const int *actor_sizes,
        int n_critic_layers, const int *critic_sizes,
        /* Weights (read-only) */
        const double *actor_flat,
        const double *critic_flat,
        /* logStd vector */
        const double *log_std,
        /* Hyperparameters */
        double clip, double entropy_coef, double vf_coef,
        /* Batch data */
        const double *obs,   /* n × obs_dim */
        const double *act,   /* n × act_dim */
        const double *logp,  /* n            */
        const double *adv,   /* n            */
        const double *ret,   /* n            */
        /* Outputs */
        double *actor_grad,  /* nActorParams — must be pre-zeroed */
        double *critic_grad, /* nCriticParams — must be pre-zeroed */
        double *g_log_std,   /* act_dim — must be pre-zeroed */
        double *out_losses   /* [pi_sum, v_sum, ent_sum] */
) {
    int n_al = n_actor_layers  - 1; /* number of weight layers */
    int n_cl = n_critic_layers - 1;

    double sum_pi = 0.0, sum_v = 0.0, sum_ent = 0.0;
    double d_mu[MAX_UNITS]; /* actor output gradient (act_dim ≤ MAX_UNITS) */
    double d_v[1];          /* critic scalar gradient */

    /* Blocked path — same arithmetic, a fraction of the memory traffic. */
    if (blk_fits(n_al, actor_sizes) && blk_fits(n_cl, critic_sizes)) {
        static double blk_dmu[BLK * BLK_UNITS];
        static double blk_dv [BLK * BLK_UNITS];
        /* σ and σ² are fixed for the whole minibatch — logStd only moves
         * between Adam steps — so these exp() calls leave the sample loop. */
        double sd_[MAX_UNITS], sd2_[MAX_UNITS];
        for (int d = 0; d < act_dim; d++) {
            sd_[d]  = exp(log_std[d]);
            sd2_[d] = exp(2.0 * log_std[d]);
        }

        for (int k0 = 0; k0 < n; k0 += BLK) {
            int bs = n - k0 < BLK ? n - k0 : BLK;

            /* Inputs for this block go into layer 0 of both activation
             * caches (both nets read the same observation). */
            double *ain = s_blk_actor, *cin = s_blk_critic;
            for (int s = 0; s < bs; s++) {
                const double *src = obs + (nn_size_t)(k0 + s) * obs_dim;
                double *da = ain + (nn_size_t)s * obs_dim;
                double *dc = cin + (nn_size_t)s * obs_dim;
                for (int i = 0; i < obs_dim; i++) { da[i] = src[i]; dc[i] = src[i]; }
            }

            net_forward_blk(n_al, actor_sizes,  actor_flat,  bs, s_blk_actor);
            net_forward_blk(n_cl, critic_sizes, critic_flat, bs, s_blk_critic);

            const double *MU = BLK_LAYER(s_blk_actor,  n_al);
            const double *VV = BLK_LAYER(s_blk_critic, n_cl);
            for (nn_size_t z = 0; z < (nn_size_t)bs * act_dim; z++) blk_dmu[z] = 0.0;

            for (int s = 0; s < bs; s++) {
                int k = k0 + s;
                const double *a  = act + (nn_size_t)k * act_dim;
                const double *mu = MU  + (nn_size_t)s * act_dim;
                double A = adv[k], R = ret[k];

                double lp = 0.0;
                for (int d = 0; d < act_dim; d++) {
                    double z  = (a[d] - mu[d]) / sd_[d];
                    lp += -0.5 * z * z - log_std[d] - 0.5 * LOG_2PI;
                }
                double rho = lp - logp[k];
                if (rho > 20.0) rho = 20.0;
                double ratio = exp(rho);
                double lo = 1.0 - clip, hi = 1.0 + clip;
                double clipped = ratio < lo ? lo : (ratio > hi ? hi : ratio);
                double surr1 = ratio * A, surr2 = clipped * A;
                sum_pi += surr1 < surr2 ? -surr1 : -surr2;

                double coef = (surr1 <= surr2) ? (-A * ratio) : 0.0;
                if (coef != 0.0) {
                    /* clipped samples keep an all-zero row, which the block
                     * backward skips sample-by-sample exactly as before */
                    double *dm = blk_dmu + (nn_size_t)s * act_dim;
                    for (int d = 0; d < act_dim; d++) {
                        double sd2  = sd2_[d];
                        double diff = a[d] - mu[d];
                        dm[d]         = coef * diff / sd2;
                        g_log_std[d] += coef * (diff * diff / sd2 - 1.0);
                    }
                }
                for (int d = 0; d < act_dim; d++) {
                    g_log_std[d] += -entropy_coef;
                    sum_ent      += log_std[d] + 0.5 * (LOG_2PI + 1.0);
                }

                double v = VV[s];
                sum_v  += 0.5 * (v - R) * (v - R);
                blk_dv[s] = vf_coef * (v - R);
            }

            net_backward_blk(n_al, actor_sizes,  actor_flat,  actor_grad,
                             s_blk_actor,  blk_dmu, bs);
            net_backward_blk(n_cl, critic_sizes, critic_flat, critic_grad,
                             s_blk_critic, blk_dv,  bs);
        }

        out_losses[0] = sum_pi;
        out_losses[1] = sum_v;
        out_losses[2] = sum_ent;
        return;
    }

    for (int k = 0; k < n; k++) {
        const double *o = obs  + k * obs_dim;
        const double *a = act  + k * act_dim;
        double A = adv[k];
        double R = ret[k];

        /* ── Actor forward ── */
        const double *mu = net_forward(n_al, actor_sizes, actor_flat, o, s_actor_acts);

        /* ── Log-probability under current policy ── */
        double lp = 0.0;
        for (int d = 0; d < act_dim; d++) {
            double sd = exp(log_std[d]);
            double z  = (a[d] - mu[d]) / sd;
            lp += -0.5 * z * z - log_std[d] - 0.5 * LOG_2PI;
        }

        /* ── PPO clipped surrogate ── */
        double rho   = lp - logp[k];
        if (rho > 20.0) rho = 20.0;
        double ratio = exp(rho);
        double lo    = 1.0 - clip, hi = 1.0 + clip;
        double clipped = ratio < lo ? lo : (ratio > hi ? hi : ratio);
        double surr1   = ratio * A, surr2 = clipped * A;
        sum_pi += surr1 < surr2 ? -surr1 : -surr2;

        /* Gradient only through the unclipped branch when it is the min. */
        double coef = (surr1 <= surr2) ? (-A * ratio) : 0.0;
        if (coef != 0.0) {
            for (int d = 0; d < act_dim; d++) {
                double sd2  = exp(2.0 * log_std[d]);
                double diff = a[d] - mu[d];
                d_mu[d]       = coef * diff / sd2;
                g_log_std[d] += coef * (diff * diff / sd2 - 1.0);
            }
            net_backward(n_al, actor_sizes, actor_flat, actor_grad, s_actor_acts, d_mu);
        }

        /* ── Entropy bonus ── */
        for (int d = 0; d < act_dim; d++) {
            g_log_std[d] += -entropy_coef;
            sum_ent      += log_std[d] + 0.5 * (LOG_2PI + 1.0);
        }

        /* ── Critic forward + backward ── */
        const double *v_out = net_forward(n_cl, critic_sizes, critic_flat, o, s_critic_acts);
        double v = v_out[0];
        sum_v   += 0.5 * (v - R) * (v - R);
        d_v[0]   = vf_coef * (v - R);
        net_backward(n_cl, critic_sizes, critic_flat, critic_grad, s_critic_acts, d_v);
    }

    out_losses[0] = sum_pi;
    out_losses[1] = sum_v;
    out_losses[2] = sum_ent;
}

/* ───────────────────────────────────────────────────────────────────────────
 *  GRU recurrent PPO — BPTT gradient accumulation. Mirrors GRUNet /
 *  accumulatePPORecurrentGrads() in nn-core.js exactly.
 *
 *  Flat parameter layout (matches GRUNet.flat()):
 *    Wz Wr Wh (each H×I) · Uz Ur Uh (each H×H) · bz br bh (each H) · Wy(O×H) · by(O)
 *
 *  One training sequence (chunk) per call; grads/losses accumulate, so the JS
 *  caller zeroes them once before looping its sequences. Per-step activations
 *  live in the static caches below (capped — the worker falls back to JS when a
 *  sequence is longer than MAX_SEQ or wider than MAX_RH).
 * ───────────────────────────────────────────────────────────────────────────*/

#define MAX_SEQ 64    /* max decisions per BPTT chunk handled in WASM   */
#define MAX_RH  256   /* max GRU hidden width handled in WASM            */

static double r_z[MAX_SEQ * MAX_RH];
static double r_r[MAX_SEQ * MAX_RH];
static double r_hh[MAX_SEQ * MAX_RH];
static double r_rh[MAX_SEQ * MAX_RH];
static double r_h[MAX_SEQ * MAX_RH];
static double r_hp[MAX_SEQ * MAX_RH];   /* input hidden state per step */
static double r_ys[MAX_SEQ * MAX_RH];   /* per-step outputs            */
static double r_dY[MAX_SEQ * MAX_RH];   /* per-step output gradient    */

static double sigmoidd(double x) { return 1.0 / (1.0 + exp(-x)); }

static void gru_forward(const int *sizes, const double *f, const double *obs,
                        int T, const double *h0, const double *done, double *ys) {
    int I = sizes[0], H = sizes[1], O = sizes[2];
    const double *Wz = f;            const double *Wr = Wz + H * I;  const double *Wh = Wr + H * I;
    const double *Uz = Wh + H * I;   const double *Ur = Uz + H * H;  const double *Uh = Ur + H * H;
    const double *bz = Uh + H * H;   const double *br = bz + H;      const double *bh = br + H;
    const double *Wy = bh + H;       const double *by = Wy + O * H;
    double hprev[MAX_RH];
    for (int j = 0; j < H; j++) hprev[j] = h0[j];
    for (int t = 0; t < T; t++) {
        const double *x = obs + t * I;
        double *z = r_z + t * H, *rr = r_r + t * H, *hh = r_hh + t * H;
        double *rh = r_rh + t * H, *h = r_h + t * H, *hp = r_hp + t * H;
        for (int j = 0; j < H; j++) hp[j] = hprev[j];
        for (int j = 0; j < H; j++) {
            double sz = bz[j], sr = br[j];
            int xo = j * I, ho = j * H;
            for (int i = 0; i < I; i++) { sz += Wz[xo + i] * x[i]; sr += Wr[xo + i] * x[i]; }
            for (int k = 0; k < H; k++) { sz += Uz[ho + k] * hprev[k]; sr += Ur[ho + k] * hprev[k]; }
            z[j] = sigmoidd(sz); rr[j] = sigmoidd(sr);
        }
        for (int k = 0; k < H; k++) rh[k] = rr[k] * hprev[k];
        for (int j = 0; j < H; j++) {
            double sh = bh[j];
            int xo = j * I, ho = j * H;
            for (int i = 0; i < I; i++) sh += Wh[xo + i] * x[i];
            for (int k = 0; k < H; k++) sh += Uh[ho + k] * rh[k];
            hh[j] = tanh(sh);
            h[j] = (1.0 - z[j]) * hprev[j] + z[j] * hh[j];
        }
        double *yo = ys + t * O;
        for (int o = 0; o < O; o++) { double s = by[o]; int off = o * H; for (int j = 0; j < H; j++) s += Wy[off + j] * h[j]; yo[o] = s; }
        if (done && done[t] != 0.0) { for (int j = 0; j < H; j++) hprev[j] = 0.0; }
        else                        { for (int j = 0; j < H; j++) hprev[j] = h[j]; }
    }
}

/* Per-timestep pre-activation deltas, kept so the weight gradients can be
 * accumulated ONCE after the time loop instead of once per timestep. */
static double r_dsz[MAX_SEQ * MAX_RH];
static double r_dsr[MAX_SEQ * MAX_RH];
static double r_dsh[MAX_SEQ * MAX_RH];

/* G[j][i] += Σ_t D[t][j]·A[t][i], walking t downwards so the sum keeps the
 * order the per-timestep version produced. The output tile stays in registers
 * across the whole sequence, so each gradient element is read and written once
 * per chunk rather than once per timestep — the same blocking that the
 * feed-forward kernel uses, with time as the reduction axis. */
static void accum_outer(double *G, int rows, int cols,
                        const double *D, int dstride,
                        const double *A, int astride, int T) {
    for (int j = 0; j < rows; j++) {
        double *gj = G + (nn_size_t)j * cols;
        int i0 = 0;
        for (; i0 + GEMM_T <= cols; i0 += GEMM_T) {
            double acc[GEMM_T];
            for (int u = 0; u < GEMM_T; u++) acc[u] = gj[i0 + u];
            for (int t = T - 1; t >= 0; t--) {
                double d = D[(nn_size_t)t * dstride + j];
                if (d == 0.0) continue;
                const double *a = A + (nn_size_t)t * astride + i0;
                for (int u = 0; u < GEMM_T; u++) acc[u] += d * a[u];
            }
            for (int u = 0; u < GEMM_T; u++) gj[i0 + u] = acc[u];
        }
        for (; i0 < cols; i0++) {
            double acc = gj[i0];
            for (int t = T - 1; t >= 0; t--) {
                double d = D[(nn_size_t)t * dstride + j];
                if (d != 0.0) acc += d * A[(nn_size_t)t * astride + i0];
            }
            gj[i0] = acc;
        }
    }
}

static void accum_bias(double *gb, int n, const double *D, int dstride, int T) {
    for (int j = 0; j < n; j++) {
        double acc = gb[j];
        for (int t = T - 1; t >= 0; t--) acc += D[(nn_size_t)t * dstride + j];
        gb[j] = acc;
    }
}

static void gru_backward(const int *sizes, const double *f, double *g,
                         const double *obs, const double *dY, const double *done, int T) {
    int I = sizes[0], H = sizes[1], O = sizes[2];
    const double *Uz = f + 3 * H * I;      const double *Ur = Uz + H * H;   const double *Uh = Ur + H * H;
    const double *Wy = f + 3 * H * I + 3 * H * H + 3 * H;
    double *gWz = g;                  double *gWr = gWz + H * I;  double *gWh = gWr + H * I;
    double *gUz = gWh + H * I;        double *gUr = gUz + H * H;  double *gUh = gUr + H * H;
    double *gbz = gUh + H * H;        double *gbr = gbz + H;      double *gbh = gbr + H;
    double *gWy = gbh + H;            double *gby = gWy + O * H;
    double dhNext[MAX_RH];
    for (int j = 0; j < H; j++) dhNext[j] = 0.0;

    /* ── recurrence: sequential in time, weights read-only ─────────────── */
    for (int t = T - 1; t >= 0; t--) {
        double *z = r_z + t * H, *rr = r_r + t * H, *hh = r_hh + t * H;
        double *rh = r_rh + t * H, *hp = r_hp + t * H;
        double dh[MAX_RH], dhPrev[MAX_RH], drh[MAX_RH], dr[MAX_RH];
        double *dsz = r_dsz + t * H, *dsr = r_dsr + t * H, *dsh = r_dsh + t * H;
        for (int j = 0; j < H; j++) { dh[j] = dhNext[j]; dhPrev[j] = 0.0; drh[j] = 0.0; }

        const double *dyt = dY + t * O;
        for (int o = 0; o < O; o++) {
            double dyo = dyt[o];
            if (dyo == 0.0) continue;
            int off = o * H;
            for (int j = 0; j < H; j++) dh[j] += dyo * Wy[off + j];
        }
        for (int j = 0; j < H; j++) {
            double dhh = dh[j] * z[j];
            double dz  = dh[j] * (hh[j] - hp[j]);
            dhPrev[j] += dh[j] * (1.0 - z[j]);
            dsh[j] = dhh * (1.0 - hh[j] * hh[j]);
            dh[j] = dz;  /* reuse slot to hold dz for the gate pass */
        }
        for (int j = 0; j < H; j++) {
            double d = dsh[j];
            int ho = j * H;
            for (int k = 0; k < H; k++) drh[k] += d * Uh[ho + k];
        }
        (void)rh;
        for (int k = 0; k < H; k++) { dr[k] = drh[k] * hp[k]; dhPrev[k] += drh[k] * rr[k]; }
        for (int j = 0; j < H; j++) {
            double a = dh[j] * z[j] * (1.0 - z[j]);
            double b = dr[j] * rr[j] * (1.0 - rr[j]);
            dsz[j] = a; dsr[j] = b;
            int ho = j * H;
            for (int k = 0; k < H; k++) {
                dhPrev[k] += a * Uz[ho + k];
                dhPrev[k] += b * Ur[ho + k];
            }
        }
        if (t > 0 && !(done && done[t - 1] != 0.0)) { for (int j = 0; j < H; j++) dhNext[j] = dhPrev[j]; }
        else                                        { for (int j = 0; j < H; j++) dhNext[j] = 0.0; }
    }

    /* ── weight gradients: one pass over the whole chunk ───────────────── */
    accum_outer(gWy, O, H, dY,    O, r_h,  H, T);
    accum_bias (gby, O,    dY,    O,              T);
    accum_outer(gWh, H, I, r_dsh, H, obs,  I, T);
    accum_outer(gUh, H, H, r_dsh, H, r_rh, H, T);
    accum_bias (gbh, H,    r_dsh, H,              T);
    accum_outer(gWz, H, I, r_dsz, H, obs,  I, T);
    accum_outer(gUz, H, H, r_dsz, H, r_hp, H, T);
    accum_bias (gbz, H,    r_dsz, H,              T);
    accum_outer(gWr, H, I, r_dsr, H, obs,  I, T);
    accum_outer(gUr, H, H, r_dsr, H, r_hp, H, T);
    accum_bias (gbr, H,    r_dsr, H,              T);
}

/* out_losses / *_grad / g_log_std ACCUMULATE — zero them once before the
 * per-sequence loop in JS. Returns 1 if handled, 0 if the sequence exceeds the
 * WASM caps (caller must then use the JS path). */
__attribute__((visibility("default")))
int compute_ppo_recurrent_grads(
        int T, int obs_dim, int act_dim,
        const int *actor_sizes, const int *critic_sizes,
        const double *actor_flat, const double *critic_flat,
        const double *log_std,
        double clip, double entropy_coef, double vf_coef,
        const double *obs, const double *act, const double *logp,
        const double *adv, const double *ret, const double *done,
        const double *h0a, const double *h0c,
        double *actor_grad, double *critic_grad, double *g_log_std, double *out_losses) {
    int H = actor_sizes[1];
    int O = act_dim;
    if (T > MAX_SEQ || H > MAX_RH) return 0;

    double sum_pi = 0.0, sum_v = 0.0, sum_ent = 0.0;

    /* ── Actor forward → r_ys, then per-step surrogate gradient into r_dY ── */
    gru_forward(actor_sizes, actor_flat, obs, T, h0a, done, r_ys);
    for (int t = 0; t < T; t++) {
        const double *a = act + t * act_dim;
        double A = adv[t];
        const double *mu = r_ys + t * O;
        double lp = 0.0;
        for (int d = 0; d < act_dim; d++) {
            double sd = exp(log_std[d]);
            double z  = (a[d] - mu[d]) / sd;
            lp += -0.5 * z * z - log_std[d] - 0.5 * LOG_2PI;
        }
        double rho = lp - logp[t]; if (rho > 20.0) rho = 20.0;
        double ratio = exp(rho);
        double lo = 1.0 - clip, hi = 1.0 + clip;
        double clp = ratio < lo ? lo : (ratio > hi ? hi : ratio);
        double surr1 = ratio * A, surr2 = clp * A;
        sum_pi += surr1 < surr2 ? -surr1 : -surr2;
        double coef = (surr1 <= surr2) ? (-A * ratio) : 0.0;
        double *dmt = r_dY + t * O;
        for (int d = 0; d < act_dim; d++) dmt[d] = 0.0;
        if (coef != 0.0) {
            for (int d = 0; d < act_dim; d++) {
                double sd2 = exp(2.0 * log_std[d]);
                double diff = a[d] - mu[d];
                dmt[d] = coef * diff / sd2;
                g_log_std[d] += coef * (diff * diff / sd2 - 1.0);
            }
        }
        for (int d = 0; d < act_dim; d++) {
            g_log_std[d] += -entropy_coef;
            sum_ent += log_std[d] + 0.5 * (LOG_2PI + 1.0);
        }
    }
    gru_backward(actor_sizes, actor_flat, actor_grad, obs, r_dY, done, T);

    /* ── Critic forward → r_ys, value gradient into r_dY ── */
    gru_forward(critic_sizes, critic_flat, obs, T, h0c, done, r_ys);
    for (int t = 0; t < T; t++) {
        double v = r_ys[t];
        double dv = vf_coef * (v - ret[t]);
        r_dY[t] = dv;
        sum_v += 0.5 * (v - ret[t]) * (v - ret[t]);
    }
    gru_backward(critic_sizes, critic_flat, critic_grad, obs, r_dY, done, T);

    out_losses[0] += sum_pi;
    out_losses[1] += sum_v;
    out_losses[2] += sum_ent;
    return 1;
}

/* Expose the linker-supplied heap base so JS can start its bump allocator
 * right after all static/BSS data. */
extern unsigned char __heap_base;
__attribute__((visibility("default")))
/* ── forward_batch ────────────────────────────────────────────────────────
 * Batched inference for the rollout: n observations in, n output rows out.
 * The rollout used to call a scalar JS forward once per agent per decision;
 * one call per tick for every agent that needs a decision measured 4.4x
 * faster at 64x1 and 6.3x at 256x2, because the compiled kernel replaces the
 * scalar JS loop AND each weight is loaded once for the whole tick instead
 * of once per agent.
 *
 * obs: n x sizes[0], row-major.   out: n x sizes[nlayers], row-major.
 * Falls back to nothing — the caller checks blk_fits() equivalents by
 * construction (the trainer's widths are <= BLK_UNITS).
 */
__attribute__((visibility("default")))
void forward_batch(int nlayers, const int *sizes, const double *flat,
                   const double *obs, int n, double *out) {
    if (!blk_fits(nlayers, sizes)) return;   /* caller keeps the JS path */
    int nIn0 = sizes[0], nOut = sizes[nlayers];
    for (int k0 = 0; k0 < n; k0 += BLK) {
        int bs = n - k0 < BLK ? n - k0 : BLK;
        double *in = s_blk_actor;
        for (int s = 0; s < bs; s++) {
            const double *src = obs + (nn_size_t)(k0 + s) * nIn0;
            double *dst = in + (nn_size_t)s * nIn0;
            for (int i = 0; i < nIn0; i++) dst[i] = src[i];
        }
        net_forward_blk(nlayers, sizes, flat, bs, s_blk_actor);
        const double *O = BLK_LAYER(s_blk_actor, nlayers);
        for (int s = 0; s < bs; s++) {
            const double *src = O + (nn_size_t)s * nOut;
            double *dst = out + (nn_size_t)(k0 + s) * nOut;
            for (int j = 0; j < nOut; j++) dst[j] = src[j];
        }
    }
}

/* ── gru_step_batch ───────────────────────────────────────────────────────
 * One GRU step for n agents at once — the recurrent rollout's inner loop.
 *
 * The recurrent policy is the trainer's default, and it was the one path still
 * running a scalar JS step per agent per decision (24 % of a recurrent run).
 * Each gate is a pair of matrix-vector products against shared weights, so
 * stepping the agents together turns them into matrix-matrix work: a weight row
 * is loaded once for two agents instead of once each, on top of the compiled
 * SIMD the JS path never had.
 *
 * Layout matches GRUNet.flat():
 *   Wz Wr Wh (H×I) · Uz Ur Uh (H×H) · bz br bh (H) · Wy (O×H) · by (O)
 * obs: n×I, hprev: n×H, hout: n×H, yout: n×O — all row-major, sample-major.
 * Accumulation order per unit is the JS order (inputs then hidden), so this
 * agrees with GRUNet.step() to floating-point noise.
 */
#define GRU_BLK 32

static double s_gru_z [GRU_BLK * BLK_UNITS];
static double s_gru_r [GRU_BLK * BLK_UNITS];
static double s_gru_rh[GRU_BLK * BLK_UNITS];

__attribute__((visibility("default")))
void gru_step_batch(const int *sizes, const double *flat,
                    const double *obs, const double *hprev, int n,
                    double *hout, double *yout) {
    int I = sizes[0], H = sizes[1], O = sizes[2];
    if (H > BLK_UNITS || I > BLK_UNITS || O > BLK_UNITS) return;  /* JS fallback */

    const double *Wz = flat;
    const double *Wr = Wz + (nn_size_t)H * I;
    const double *Wh = Wr + (nn_size_t)H * I;
    const double *Uz = Wh + (nn_size_t)H * I;
    const double *Ur = Uz + (nn_size_t)H * H;
    const double *Uh = Ur + (nn_size_t)H * H;
    const double *bz = Uh + (nn_size_t)H * H;
    const double *br = bz + H;
    const double *bh = br + H;
    const double *Wy = bh + H;
    const double *by = Wy + (nn_size_t)O * H;

    for (int k0 = 0; k0 < n; k0 += GRU_BLK) {
        int bs = n - k0 < GRU_BLK ? n - k0 : GRU_BLK;
        const double *X  = obs   + (nn_size_t)k0 * I;
        const double *P  = hprev + (nn_size_t)k0 * H;
        double       *HO = hout  + (nn_size_t)k0 * H;
        double       *YO = yout  + (nn_size_t)k0 * O;

        /* ── update (z) and reset (r) gates ─────────────────────────────── */
        for (int j = 0; j < H; j++) {
            const double *wz = Wz + (nn_size_t)j * I, *wr = Wr + (nn_size_t)j * I;
            const double *uz = Uz + (nn_size_t)j * H, *ur = Ur + (nn_size_t)j * H;
            double bzj = bz[j], brj = br[j];
            int s = 0;
            for (; s + 1 < bs; s += 2) {          /* two agents per weight load */
                const double *x0 = X + (nn_size_t)s * I,     *x1 = X + (nn_size_t)(s + 1) * I;
                const double *p0 = P + (nn_size_t)s * H,     *p1 = P + (nn_size_t)(s + 1) * H;
                double z0 = bzj, z1 = bzj, r0 = brj, r1 = brj;
                for (int i = 0; i < I; i++) {
                    double a0 = x0[i], a1 = x1[i], vz = wz[i], vr = wr[i];
                    z0 += vz * a0; z1 += vz * a1; r0 += vr * a0; r1 += vr * a1;
                }
                for (int k = 0; k < H; k++) {
                    double c0 = p0[k], c1 = p1[k], vz = uz[k], vr = ur[k];
                    z0 += vz * c0; z1 += vz * c1; r0 += vr * c0; r1 += vr * c1;
                }
                s_gru_z[(nn_size_t)s * H + j]       = sigmoidd(z0);
                s_gru_z[(nn_size_t)(s + 1) * H + j] = sigmoidd(z1);
                s_gru_r[(nn_size_t)s * H + j]       = sigmoidd(r0);
                s_gru_r[(nn_size_t)(s + 1) * H + j] = sigmoidd(r1);
            }
            for (; s < bs; s++) {
                const double *xs = X + (nn_size_t)s * I, *ps = P + (nn_size_t)s * H;
                double zz = bzj, rr = brj;
                for (int i = 0; i < I; i++) { zz += wz[i] * xs[i]; rr += wr[i] * xs[i]; }
                for (int k = 0; k < H; k++) { zz += uz[k] * ps[k]; rr += ur[k] * ps[k]; }
                s_gru_z[(nn_size_t)s * H + j] = sigmoidd(zz);
                s_gru_r[(nn_size_t)s * H + j] = sigmoidd(rr);
            }
        }

        for (int s = 0; s < bs; s++) {
            const double *ps = P + (nn_size_t)s * H;
            for (int k = 0; k < H; k++)
                s_gru_rh[(nn_size_t)s * H + k] = s_gru_r[(nn_size_t)s * H + k] * ps[k];
        }

        /* ── candidate state and the new hidden state ───────────────────── */
        for (int j = 0; j < H; j++) {
            const double *wh = Wh + (nn_size_t)j * I, *uh = Uh + (nn_size_t)j * H;
            double bhj = bh[j];
            int s = 0;
            for (; s + 1 < bs; s += 2) {
                const double *x0 = X + (nn_size_t)s * I, *x1 = X + (nn_size_t)(s + 1) * I;
                const double *g0 = s_gru_rh + (nn_size_t)s * H, *g1 = s_gru_rh + (nn_size_t)(s + 1) * H;
                double h0 = bhj, h1 = bhj;
                for (int i = 0; i < I; i++) { double v = wh[i]; h0 += v * x0[i]; h1 += v * x1[i]; }
                for (int k = 0; k < H; k++) { double v = uh[k]; h0 += v * g0[k]; h1 += v * g1[k]; }
                double t0 = tanh(h0), t1 = tanh(h1);
                double zz0 = s_gru_z[(nn_size_t)s * H + j], zz1 = s_gru_z[(nn_size_t)(s + 1) * H + j];
                HO[(nn_size_t)s * H + j]       = (1.0 - zz0) * P[(nn_size_t)s * H + j] + zz0 * t0;
                HO[(nn_size_t)(s + 1) * H + j] = (1.0 - zz1) * P[(nn_size_t)(s + 1) * H + j] + zz1 * t1;
            }
            for (; s < bs; s++) {
                const double *xs = X + (nn_size_t)s * I, *gs = s_gru_rh + (nn_size_t)s * H;
                double hs = bhj;
                for (int i = 0; i < I; i++) hs += wh[i] * xs[i];
                for (int k = 0; k < H; k++) hs += uh[k] * gs[k];
                double t = tanh(hs), zz = s_gru_z[(nn_size_t)s * H + j];
                HO[(nn_size_t)s * H + j] = (1.0 - zz) * P[(nn_size_t)s * H + j] + zz * t;
            }
        }

        /* ── linear output head ─────────────────────────────────────────── */
        for (int s = 0; s < bs; s++) {
            const double *hs = HO + (nn_size_t)s * H;
            for (int o = 0; o < O; o++) {
                const double *wy = Wy + (nn_size_t)o * H;
                double sy = by[o];
                for (int j = 0; j < H; j++) sy += wy[j] * hs[j];
                YO[(nn_size_t)s * O + o] = sy;
            }
        }
    }
}

/* ── cast_ray_fan ─────────────────────────────────────────────────────────
 * Amanatides-Woo grid march for one fan of rays — a faithful port of
 * rayThroughGrid()/castRayFan() in sim-worker.js, which together are the
 * rollout's sensing cost.
 *
 * The JS grid stores each cell as its own Int32Array; linear memory cannot
 * hold an array of arrays, so cells arrive flattened as CSR: cell c owns
 * cell_idx[cell_start[c] .. cell_start[c+1]).
 *
 * `stamp` dedupes segments registered in several cells, compared against a
 * generation counter that ticks per ray. It lives in linear memory and is
 * caller-allocated, one slot per segment.
 *
 * Writes out[k] = distance / max_dist, so "nothing within range" is 1.0. The
 * caller applies the long fan's √ afterwards, exactly as the JS path does.
 */
static int s_ray_gen = 0;

static double ray_segment(double ox, double oz, double dx, double dz,
                          double ax, double az, double bx, double bz) {
    double ex = bx - ax, ez = bz - az;
    double det = dx * ez - dz * ex;
    if (det < 0) { if (-det < 1e-8) return -1.0; }
    else         { if ( det < 1e-8) return -1.0; }
    double fx = ax - ox, fz = az - oz;
    double t = (fx * ez - fz * ex) / det;
    double u = (dz * fx - dx * fz) / det;
    if (t >= 0.0 && u >= 0.0 && u <= 1.0) return t;
    return -1.0;
}

__attribute__((visibility("default")))
void cast_ray_fan(const double *segs, const int *cell_start, const int *cell_idx,
                  int *stamp, int n_segs, int gw, int gh,
                  double min_x, double min_z, double cell_size,
                  double ox, double oz,
                  const double *dirs, int n_angles, double max_dist,
                  double *out) {
    /* Directions arrive precomputed as (dx, dz) pairs. Deriving them here
     * would need sin/cos, which this freestanding module deliberately does not
     * import — and taking them from the host also guarantees the WASM path
     * marches along exactly the same rays the JS path does. */
    for (int k = 0; k < n_angles; k++) {
        double dx = dirs[k * 2], dz = dirs[k * 2 + 1];
        double best = max_dist;

        if (n_segs > 0) {
            double gx1 = min_x + gw * cell_size, gz1 = min_z + gh * cell_size;
            double t0 = 0.0, t1 = max_dist;
            int inside = 1;
            if (dx != 0.0) {
                double ta = (min_x - ox) / dx, tb = (gx1 - ox) / dx;
                double lo = ta < tb ? ta : tb, hi = ta < tb ? tb : ta;
                if (lo > t0) t0 = lo;
                if (hi < t1) t1 = hi;
            } else if (ox < min_x || ox > gx1) inside = 0;
            if (inside && dz != 0.0) {
                double ta = (min_z - oz) / dz, tb = (gz1 - oz) / dz;
                double lo = ta < tb ? ta : tb, hi = ta < tb ? tb : ta;
                if (lo > t0) t0 = lo;
                if (hi < t1) t1 = hi;
            } else if (inside && (oz < min_z || oz > gz1)) inside = 0;

            if (inside && t0 <= t1) {
                double ex = ox + dx * (t0 + 1e-9), ez = oz + dz * (t0 + 1e-9);
                int cx = (int)((ex - min_x) / cell_size);
                int cz = (int)((ez - min_z) / cell_size);
                if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
                if (cz < 0) cz = 0; else if (cz >= gh) cz = gh - 1;
                int step_x = dx > 0 ? 1 : -1, step_z = dz > 0 ? 1 : -1;
                double inf = 1.0 / 0.0;
                double t_max_x = dx != 0.0
                    ? ((min_x + (cx + (dx > 0 ? 1 : 0)) * cell_size) - ox) / dx : inf;
                double t_max_z = dz != 0.0
                    ? ((min_z + (cz + (dz > 0 ? 1 : 0)) * cell_size) - oz) / dz : inf;
                double t_dx = dx != 0.0 ? cell_size / (dx < 0 ? -dx : dx) : inf;
                double t_dz = dz != 0.0 ? cell_size / (dz < 0 ? -dz : dz) : inf;

                int gen = ++s_ray_gen;
                for (;;) {
                    int c = cz * gw + cx;
                    for (int q = cell_start[c]; q < cell_start[c + 1]; q++) {
                        int i = cell_idx[q];
                        if (stamp[i] == gen) continue;
                        stamp[i] = gen;
                        double t = ray_segment(ox, oz, dx, dz,
                                               segs[i * 4], segs[i * 4 + 1],
                                               segs[i * 4 + 2], segs[i * 4 + 3]);
                        if (t > 0.0 && t < best) best = t;
                    }
                    double t_next = t_max_x < t_max_z ? t_max_x : t_max_z;
                    if (t_next > best || t_next > t1) break;
                    if (t_max_x < t_max_z) {
                        t_max_x += t_dx; cx += step_x;
                        if (cx < 0 || cx >= gw) break;
                    } else {
                        t_max_z += t_dz; cz += step_z;
                        if (cz < 0 || cz >= gh) break;
                    }
                }
            }
        }
        out[k] = best / max_dist;
    }
}

int get_heap_base(void) { return (int)(unsigned int)&__heap_base; }
