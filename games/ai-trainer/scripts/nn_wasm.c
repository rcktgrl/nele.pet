/*
 * nn_wasm.c — Neural-net forward/backward + PPO gradient accumulation for WASM.
 *
 * Compile:
 *   clang --target=wasm32 -nostdlib -fno-builtin -O3 -ffast-math \
 *         -Wl,--no-entry -Wl,--export-all -Wl,--allow-undefined \
 *         nn_wasm.c -o nn_wasm.wasm
 *
 * -fno-builtin keeps the optimizer from lowering array copies/fills into calls
 * to memcpy/memset that the freestanding target can't import. We provide those
 * three libcalls below so the module imports only { env: { exp, tanh } }.
 *
 * JS host must provide imports: { env: { exp, tanh } }
 *
 * All large arrays (weights, grads, batch data) live in WASM linear memory
 * managed by the JS caller.  The C code keeps only small fixed-size caches
 * for per-sample activations.
 */

/* freestanding: define NULL manually */
#define NULL ((void*)0)

/* ── Math imports from JS host ── */
extern double exp(double x)  __attribute__((import_module("env"), import_name("exp")));
extern double tanh(double x) __attribute__((import_module("env"), import_name("tanh")));

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
    for (int t = T - 1; t >= 0; t--) {
        double *z = r_z + t * H, *rr = r_r + t * H, *hh = r_hh + t * H;
        double *rh = r_rh + t * H, *h = r_h + t * H, *hp = r_hp + t * H;
        const double *x = obs + t * I;
        double dh[MAX_RH], dhPrev[MAX_RH], dsh[MAX_RH], drh[MAX_RH], dr[MAX_RH];
        for (int j = 0; j < H; j++) { dh[j] = dhNext[j]; dhPrev[j] = 0.0; drh[j] = 0.0; }
        const double *dyt = dY + t * O;
        for (int o = 0; o < O; o++) {
            double dyo = dyt[o];
            if (dyo == 0.0) continue;
            gby[o] += dyo; int off = o * H;
            for (int j = 0; j < H; j++) { gWy[off + j] += dyo * h[j]; dh[j] += dyo * Wy[off + j]; }
        }
        for (int j = 0; j < H; j++) {
            double dhh = dh[j] * z[j];
            double dz  = dh[j] * (hh[j] - hp[j]);
            dhPrev[j] += dh[j] * (1.0 - z[j]);
            dsh[j] = dhh * (1.0 - hh[j] * hh[j]);
            dh[j] = dz;  /* reuse slot to hold dz for the gate pass */
        }
        for (int j = 0; j < H; j++) {
            double d = dsh[j]; gbh[j] += d; int xo = j * I, ho = j * H;
            for (int i = 0; i < I; i++) gWh[xo + i] += d * x[i];
            for (int k = 0; k < H; k++) { gUh[ho + k] += d * rh[k]; drh[k] += d * Uh[ho + k]; }
        }
        for (int k = 0; k < H; k++) { dr[k] = drh[k] * hp[k]; dhPrev[k] += drh[k] * rr[k]; }
        for (int j = 0; j < H; j++) {
            double dsz = dh[j] * z[j] * (1.0 - z[j]);
            double dsr = dr[j] * rr[j] * (1.0 - rr[j]);
            gbz[j] += dsz; gbr[j] += dsr; int xo = j * I, ho = j * H;
            for (int i = 0; i < I; i++) { gWz[xo + i] += dsz * x[i]; gWr[xo + i] += dsr * x[i]; }
            for (int k = 0; k < H; k++) {
                gUz[ho + k] += dsz * hp[k]; dhPrev[k] += dsz * Uz[ho + k];
                gUr[ho + k] += dsr * hp[k]; dhPrev[k] += dsr * Ur[ho + k];
            }
        }
        if (t > 0 && !(done && done[t - 1] != 0.0)) { for (int j = 0; j < H; j++) dhNext[j] = dhPrev[j]; }
        else                                        { for (int j = 0; j < H; j++) dhNext[j] = 0.0; }
    }
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
int get_heap_base(void) { return (int)(unsigned int)&__heap_base; }
