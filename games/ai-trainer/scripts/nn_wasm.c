/*
 * nn_wasm.c — Neural-net forward/backward + PPO gradient accumulation for WASM.
 *
 * Compile:
 *   clang --target=wasm32 -nostdlib -O3 -ffast-math \
 *         -Wl,--no-entry -Wl,--export-all -Wl,--allow-undefined \
 *         nn_wasm.c -o nn_wasm.wasm
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

/* Expose the linker-supplied heap base so JS can start its bump allocator
 * right after all static/BSS data. */
extern unsigned char __heap_base;
__attribute__((visibility("default")))
int get_heap_base(void) { return (int)(unsigned int)&__heap_base; }
