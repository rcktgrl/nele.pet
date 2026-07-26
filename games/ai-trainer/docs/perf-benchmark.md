# AI Trainer — performance benchmark (map: **jeff**)

What one PPO generation actually costs, and where the time goes.

Run it yourself:

```bash
npm i three@0.128.0                # only needed offline; the page normally CDN-loads three
node games/ai-trainer/test/perf-bench.mjs --track=jeff --gens=3 --repeat=3
node games/ai-trainer/test/perf-bench.mjs --list        # the config sweep
```

## Method

`perf-bench.mjs` drives the **real** trainer stack in headless Chromium: the map is
built by the game's own `track-gen.js`, serialized exactly the way `trainer-app.js`
serializes it, and handed to the real `sim-worker.js` with its real `grad-worker.js`
pool and WASM kernel. Nothing is stubbed except the renderer, which the worker never
touches anyway.

`sim-worker.js` carries an opt-in phase profiler (`cfg.perf`, the `perf` message).
Every probe is behind one boolean test, so it costs nothing when off. The bench opens
a profiler window per generation and closes it when `iteration` ticks.

Accounting note: the sim thread keeps stepping while an update waits on the gradient
workers, so `gradient workers (off-thread)` overlaps the rollout. The tables split
that wait into "sim thread kept stepping" and "this thread was idle-blocked" so the
columns sum to ~100 % of the wall clock instead of 130 %.

**Environment.** 4 logical cores, 15 GB RAM, headless Chromium (Playwright 1.56),
Linux container. Absolute numbers are container numbers; the *ratios* are the point.
All runs: map `jeff` (501 centerline points, 1790 wall segments, 12 m road, gravel
runoff), car 0 (Viper GT), `speedMult: 200`, 3 generations, best of 3 repeats.

## Headline

| config | s/generation | steps/s | vs. best |
|---|---:|---:|---:|
| `minibatch-1024` — mb 1024 | **0.79** | 25.6k | 1.00× |
| `wasm-auto-noperf` — profiler off | 0.91 | 22.7k | 1.15× |
| `wasm-auto` — WASM SIMD, 2 grad workers | 0.96 | 20.2k | 1.21× |
| `envs32-h128` — 32 envs × horizon 128 | 1.05 | 23.5k | 1.33× |
| `wasm-4thread` — 4 grad workers | 1.14 | 18.0k | 1.44× |
| `wasm-1thread` — 1 grad worker | 1.19 | 17.1k | 1.51× |
| `minibatch-64` — mb 64 | 1.55 | 12.5k | 1.96× |
| `mods-mirror-repair` — mirror + repair + 10 % defects | 1.60 | 12.1k | 2.02× |
| `js-1thread` — pure-JS gradients | 2.46 | 7.8k | 3.11× |
| `gru-recurrent` — GRU + truncated BPTT | 3.45 | 5.7k | 4.35× |
| `gpu-tfjs` — TF.js WebGL (software GL here) | 4.57 | 4.4k | 5.78× |
| `bignet-256x2` — 256-wide × 2 hidden | 11.77 | 1.8k | 14.9× |

## Where the time goes

Default-ish config (`wasm-auto`: WASM SIMD, 2 grad workers, 64-wide net, mb 256),
3 generations in 2.88 s:

| phase | time | % wall |
|---|---:|---:|
| rollout · policy+critic forward, sampling | 493 ms | 17.2 % |
| rollout · observations (raycasts, probes) | 468 ms | 16.3 % |
| **update · minibatch packing/transfer** | **301 ms** | **10.4 %** |
| rollout · car physics | 234 ms | 8.1 % |
| rollout · loop overhead | 159 ms | 5.5 % |
| update · KL early-stop estimate | 107 ms | 3.7 % |
| update · gradient reduce | 105 ms | 3.6 % |
| rollout · reward, arc position, termination | 72 ms | 2.5 % |
| update · Adam step | 40 ms | 1.4 % |
| rollout · transition commit | 32 ms | 1.1 % |
| everything else (GAE, norm, shuffle, snapshot, repair) | 36 ms | 1.2 % |
| **sim-thread CPU total** | **2.05 s** | **71 %** |
| gradient workers, off-thread wall | 2.07 s | 72 % |
| … of which the sim thread kept stepping | 1.33 s | 46 % |
| … of which this thread was idle-blocked | 735 ms | 26 % |

## Findings

**1. Gradient computation is the single biggest cost, everywhere.** The grad-worker
wall is 72 % of the run on `wasm-auto` and 89 % on `js-1thread`, and the sim thread
sits *idle-blocked* on it for 26 % / 71 % of the run respectively. Everything else in
this list is second place.

**2. Per-minibatch dispatch overhead is the biggest thing you control.** Same data,
same epochs, only the minibatch size moves:

| minibatch | minibatches / 3 gens | pack | reduce | Adam | s/gen |
|---|---:|---:|---:|---:|---:|
| 64 | 1,939 | 788 ms | 580 ms | 167 ms | 1.55 |
| 256 (default) | 499 | 301 ms | 105 ms | 40 ms | 0.96 |
| 1024 | 140 | 155 ms | 40 ms | 17 ms | 0.79 |

Reduce and Adam are ~0.3 ms and ~0.09 ms *per minibatch regardless of its size* —
they walk the whole weight vector either way. Packing is worse than it looks: for
every minibatch, `_runPPO` calls `actor.flatF64()` / `critic.flatF64()` (two fresh
copies of the whole weight vector) and then **structured-clones both into every grad
task** — the slice buffers are transferred, the weights are not. At 2 workers × 499
minibatches that is ~2,000 full weight copies per 3 generations. Halving the
minibatch count is a straight 20 % win; the fix is to stop copying weights per
dispatch.

**3. In the rollout, sensing and inference cost the same, and both dwarf physics.**
Observation building (18 raycasts through the wall grid + 6 look-ahead probes) is
16 % of wall and the actor+critic forward pass is 17 %, against 8 % for the car
physics and 2.5 % for reward/termination. Physics is not the bottleneck — the policy
is, on both ends.

**4. Network size is by far the most expensive setting.** 256×2 is **12× slower per
generation** than 64×1. The cost is not only in the gradients: the *rollout* policy
forward alone goes from 493 ms to 9.00 s (25 % of a 35 s run), because every decision
runs two nets of 78k parameters. Packing goes 301 ms → 2.18 s for the same reason as
finding 2 — the per-dispatch weight clone is now ~1.2 MB.

**5. More grad workers stop helping at 2 on a 4-core box.** 1 → 1.19 s/gen,
2 → 0.96, 4 → 1.14. Going from 2 to 4 doubles the per-minibatch packing (244 ms →
559 ms) and the reduce (103 ms → 206 ms) while the actual gradient work is already
split thin; the dispatch tax eats the parallelism. The `cores − 2` auto rule lands on
the right value here.

**6. WASM SIMD is worth 2.6× over pure JS** (0.96 vs 2.46 s/gen) — matching what the
kernel was added for.

**7. Recurrent (GRU) costs 3.6×**, and it lands mostly in the rollout: the policy
forward goes 493 ms → 2.52 s because each decision steps two GRUs, plus BPTT
gradients on top. The KL estimate also gets 3× more expensive (it re-runs sequence
forwards).

**8. Mirror augmentation costs ~1.7×** — it doubles the batch (13.9k samples/update
vs 7.1k), so it doubles minibatch count and roughly doubles the update. Neuron repair
and defect weights are noise by comparison (repair passes total < 2 ms).

**9. "200×" is a ceiling, not a speed.** Nothing reaches it: the default config
achieves 42×, 32 envs achieve 12×, the big net 4×. The trainer is compute-bound well
below the requested multiplier, so raising `speedMult` past ~50 changes nothing on
this hardware — it only removes the pacing.

**10. At max speed every generation trains on ~1.7× the configured horizon.**
Collection keeps running while an update is in flight, capped by the back-pressure
rule at 2× `horizon × numEnvs`. Configured 4,096 samples/update, measured ~7,100.
Update cost scales with that, so the `horizon` slider under-states the real batch at
high speed multipliers.

**11. Profiler overhead is ~5 %** (0.96 vs 0.91 s/gen with probes off) — the
breakdown percentages are trustworthy at that resolution, but treat any single phase
under ~1 % as noise.

**12. The `gpu-tfjs` number is not a GPU verdict.** Headless Chromium has no real GPU
here, so TF.js runs on a software rasteriser (SwiftShader) and lands at 4.57 s/gen,
5× *slower* than the WASM CPU path. The path works end-to-end (43 tensors, 2 MB, full
6/6 epochs per update) — only its speed is meaningless in this container.

## Why is a 256×2 net slow? It's tiny.

It is tiny — 154k parameters across actor and critic. The problem is not the net,
it's how many times it runs and how slowly each run goes.

**Cost tracks parameter count almost exactly**, so nothing pathological is happening:

| net (actor) | actor+critic MACs | s/generation | µs per decision | µs per sample-gradient (per core) |
|---|---:|---:|---:|---:|
| 40-64-6 | 5,568 | 1.00 | 16.0 | 31.9 |
| 40-256-6 | 22,272 | 2.47 | 61.5 | 82.9 |
| 40-128-128-6 | 43,904 | 3.89 | 93.3 | 134.6 |
| 40-256-256-6 | 153,344 | 11.12 | 274.5 | 394.6 |

**The work per generation is not small.** One generation of the 256×2 config:

| | passes | FLOPs |
|---|---:|---:|
| PPO update — 6 epochs × ~7,100 samples, forward+backward, both nets | 42,581 sample-gradients | ~39 GFLOP |
| rollout inference — every decision runs actor + critic | 10,736 decisions | ~3.3 GFLOP |
| KL early-stop estimate — 512-sample actor forwards per epoch | ~3,600 forwards | ~0.6 GFLOP |
| **total** | | **~43 GFLOP** |

**And the engine delivers 1–2 GFLOP/s.** Measured: 2.33 GFLOP/s per core in the WASM
gradient kernel, ~1.1 GFLOP/s in the JS rollout forward. 43 GFLOP at that rate on two
usable worker cores is ~11 s — which is exactly what the benchmark reports. The
number is fully explained; there is no hidden stall.

The interesting question is why 1–2 GFLOP/s, when the same CPU does 20–50 GFLOP/s
under a batched BLAS:

1. **Nothing is batched into a matrix multiply.** Every sample is its own
   vector×matrix pass, so the entire 1.2 MB weight set is re-read *per sample* —
   arithmetic intensity ≈ 0.5 FLOP/byte, i.e. memory-bound. A GEMM over a 256-sample
   minibatch reuses each weight 256× and turns the same arithmetic into a
   cache-blocked, compute-bound kernel. This is the whole gap.
2. **Everything is `Float64Array`.** WASM SIMD gets 2 f64 lanes where f32 gets 4, and
   every load moves twice the bytes. ML runs f32 for exactly this reason.
3. **The rollout has no WASM at all.** `Net.forwardScratch` is a scalar triple loop on
   the sim thread — measured at 0.39–0.44 MAC/ns (~0.8 GFLOP/s) regardless of width.
   The WASM SIMD kernel exists only in `grad-worker.js`, so ~3 GFLOP/generation of
   inference runs single-threaded in plain JS.
4. **`Math.tanh` is 9–22 % of the forward pass** (higher for narrow nets, where the
   MAC loop is short). Real, but secondary — the MAC loop is the cost.
5. **Weight cloning scales with the net.** At 256×2 each grad task carries a 1.2 MB
   structured clone of the weights, once per minibatch per worker: 2.18 s of the 35 s
   run, versus 301 ms at 64×1 (see finding 2).

So "small net, big time" comes from ~43 GFLOP/generation meeting an unbatched,
f64, partly-JS execution path on two cores. Batching the minibatch into GEMMs and
moving to f32 is a 10–20× opportunity — and the rollout has a free batching axis
nobody uses: all `numEnvs` agents decide on the same tick, so the 8 (or 32) separate
40→256→256→6 vector passes could be one small matrix multiply.

## What to fix first

1. **Stop cloning the weight vectors per dispatch.** Hoist `flatF64()` out of the
   minibatch loop and share the weights with the pool (transferable or
   `SharedArrayBuffer`), or push the whole epoch to the workers the way the GPU path
   does — one round trip per update instead of ~170. Biggest single win available.
2. **Raise the default minibatch** (256 → 512/1024) at high `speedMult`, where
   batches arrive at ~7k samples anyway. Free 20 %.
3. **Batch the forward/backward passes into matrix multiplies** (and consider f32).
   The gradient kernel processes one sample at a time against a weight set that does
   not fit in L1/L2 at any useful width; a GEMM over the minibatch is a 10–20× win at
   larger widths. In the rollout, all `numEnvs` agents decide on the same tick — that
   is a free batch dimension currently thrown away.
4. **Cache the rollout observation work.** 18 rays × 15k decisions/generation is
   16 % of wall; the wall grid already bounds each ray, so the remaining win is doing
   fewer of them (or reusing them across an `actionRepeat` window).
5. **Surface the effective speed multiplier in the HUD.** Users set 200× and get
   12–47×; showing the achieved rate makes the compute wall obvious instead of
   looking like a broken slider.

## Optimization pass (applied)

Acting on findings 1–2, with one rule: **the gradients must not change**. The
A/B below verifies that directly — `max |Δgrad| = 0.0`, bit-identical.

**What changed.** The update loop rebuilt two full weight vectors
(`actor.flatF64()` + `critic.flatF64()`) and two full gradient accumulators for
*every minibatch*, then copied the accumulators into the nets. At 256×2 that is
~2.5 MB allocated, filled and copied per minibatch, ~500 minibatches per three
generations. Now the weight buffers are allocated once and refilled
(`flatF64Into`), and the pool's partial gradients are reduced straight into the
nets (`addGradFlat`) — no temporaries. Plus: σ/σ² hoisted out of the PPO sample
loop (they only move between Adam steps), the two per-sample gradient vectors
hoisted, and the duplicated log-σ Adam step and pool-reduce folded into shared
helpers used by both the feed-forward and recurrent updates.

Same-process A/B of the dispatch work (median of 9, interleaved):

| net | old ms/minibatch | new ms/minibatch | speedup |
|---|---:|---:|---:|
| 64×1 | 0.051 | 0.014 | 3.7× |
| 256×1 | 0.236 | 0.056 | 4.2× |
| 256×2 | 1.854 | 0.460 | 4.0× |

End-to-end, paired A/B (baseline and optimized sources alternated, 3 rounds —
see the note on measurement below):

| config | old s/gen | new s/gen | change |
|---|---:|---:|---:|
| `wasm-auto` | 0.957 / 0.983 / 0.950 | 0.913 / 0.911 / 0.945 | **−4 %** |
| `bignet-256x2` | 11.19 / 11.59 / 11.22 | 10.54 / 10.23 / 10.61 | **−7 %** |

The optimized build won all six paired rounds.

**What did not pay, and was reverted.** Reusing preallocated per-layer
activation and delta buffers inside `Net.forward`/`backward` — the obvious
"stop allocating in the hot loop" fix — measured *neutral to 7 % slower*
(64×1 1.02×, 256×1 1.02×, 256×2 0.99–0.93×). Short-lived typed arrays live in
V8's nursery where allocation is a pointer bump and zeroing is free, while
long-lived scratch pays write barriers and needs an explicit `fill(0)`. The
code kept the simpler version, with a comment so nobody "fixes" it again.

**Not attempted.** The WASM kernel was left alone: it is where 72 % of the wall
goes, but the committed `nn_wasm.wasm` does not rebuild byte-identically with
this container's clang 18, so any C change would ship a wholesale-different
binary for an expected ~1–2 % (hoisting the per-sample `exp(log_std)` calls).
The 10×-class win there is the batched-GEMM rewrite described above, which is a
numerics-sensitive project rather than a cleanup.

### A note on measuring this container

Absolute timings drift a lot between runs — the same `wasm-auto` config measured
0.66, 0.91, 0.96 and 1.25 s/gen across sessions with identical code. A plain
before/after comparison minutes apart is therefore worthless; the first attempt
at one showed the optimized build 45 % *slower* purely from drift. Both A/Bs
above are paired: either alternating old/new modules inside one process, or
alternating source trees across interleaved benchmark rounds.

## Batched (GEMM-style) gradient kernel

Finding 4 said the engine ran at 1–2 GFLOP/s. That figure was pipeline-level —
gradient wall-clock divided by samples, including dispatch and the sim thread
competing for cores. Measured in isolation the WASM kernel was doing **4.3–5.0
GFLOP/s**, still far below what the arithmetic needs, and for the same reason:
it processed **one sample at a time**, so the weight matrix and the gradient
matrix were re-streamed from memory 42,000× per generation.

**What the kernel does now.** `compute_ppo_grads` processes 32 samples per
block, with the loop nest restructured so the hot matrices stay resident:

- **Forward** — four samples share each weight-row load (four accumulators, one
  `W` row), so `W` is read once per four samples instead of once per sample.
- **Backward pass A (`gW += Dᵀ·A`)** — the real win. A 16-wide output tile is
  held in registers across the *whole block*, so the gradient row — the hottest
  memory in the kernel — is loaded and stored **once per block** instead of
  once per sample.
- **Backward pass B (`dPrev += D·W`)** — split into its own loop so neither
  runs out of registers, two samples per weight-row load.

Same-process A/B against the previous kernel, 256-sample minibatch:

| net | old ms | new ms | speedup | GFLOP/s |
|---|---:|---:|---:|---|
| 64×1 | 1.98 | 1.32 | 1.50× | 4.3 → 6.5 |
| 256×1 | 7.65 | 5.32 | 1.44× | 4.5 → 6.4 |
| 128×2 | 13.77 | 8.71 | 1.58× | 4.9 → 7.7 |
| 256×2 | 47.32 | 26.32 | **1.80×** | 5.0 → **8.9** |

**Numerics.** Holding an accumulator in a register across the block lets
`-ffast-math` reassociate the sum, so this is no longer bit-identical: it
deviates from the previous kernel by ≤4e-12 relative, and from the scalar JS
reference by ≤2.6e-11 — against the parity test's 1e-9 tolerance, and orders of
magnitude below the sampling noise in a PPO advantage estimate. All eight
ai-trainer checks pass.

**Two tunings that measured worse and were reverted** (both are in the source
as comments, so nobody re-tries them): tiling the *fused* backward four samples
wide spills on wasm32 (1.09× vs 1.60×), and widening pass B from two samples to
four costs the same way (1.32× vs 1.78×). A 4-wide output tile in pass A is
also worse than 16 (1.57× vs 1.78×).

### …and why end-to-end only moves ~8 %

A 1.8× kernel does **not** give a 1.8× training run. Paired A/B on the default
config measured 0.766/0.732/0.780 → 0.712/0.678/0.706 s per generation, about
**8 %**. The phase profile after the change explains it exactly:

| | share of wall |
|---|---:|
| gradient workers, off-thread | 72 % |
| … of which the sim thread kept stepping (overlapped) | 51 % |
| … of which the sim thread was **idle-blocked** | **21 %** |
| rollout loop (sim thread) | 55 % |
| — policy+critic forward | 21 % |
| — observations (raycasts) | 17 % |
| — minibatch packing | 11 % |

The gradient work runs in other threads and mostly hides behind the rollout.
Only the 21 % the sim thread spends *blocked* on it is recoverable, so making
the kernel infinitely fast would buy ~21 % on this config. The critical path is
now the sim thread. Bigger nets keep more of the win (paired A/B on 256×2
measured 15–19 % for an intermediate build of this kernel) because gradients
are a larger share there.

**So the next lever is the rollout, not the kernel** — and it is the same
argument one level up: `Net.forwardScratch` runs one decision at a time, in
scalar JS, single-threaded, while every `numEnvs` agent decides on the same
tick. That is a free batch dimension worth 21 % of the wall, and the raycast
observations another 17 %.

## Batched WASM inference in the rollout

Once the gradient kernel was fast, the sim thread was the critical path — and
`Net.forwardScratch` ran **one scalar-JS forward per agent per decision**: 21 %
of the wall on the default config, 40 % at 256×2, single-threaded, never
touching the WASM kernel at all.

Every agent due a decision on a tick is now forwarded in **one** call to
`forward_batch`. Two effects stack: compiled SIMD instead of a scalar JS loop,
and each weight loaded once per tick instead of once per agent.

| net | agents | JS µs/decision | batched WASM µs/decision | speedup |
|---|---:|---:|---:|---:|
| 64×1 | 8 | 6.61 | 1.50 | **4.4×** |
| 64×1 | 32 | 6.86 | 1.49 | **4.6×** |
| 256×2 | 8 | 137.7 | 21.7 | **6.3×** |
| 256×2 | 32 | 140.4 | 23.6 | **6.0×** |

Including the copy in and out of WASM memory. `forward-batch-check.mjs` pins
the kernel to the JS reference (max 4e-12 relative across 24 shape/batch-size
combinations, including the batch-size boundary at 33), and `sim-smoke` now
shims `fetch` so the node suite exercises the WASM decision path rather than
the fallback.

Three details worth knowing:

- **`stepOnce` is now two phases** — every decision first, then every agent's
  physics. Agents never observe each other, so nothing an agent can see
  changes; the RNG draw order does, so runs do not replay identically.
- **Weights upload when they change, not per tick.** They change once per
  completed update, so agents act with the last *completed* policy for the
  duration of an update instead of a half-applied one — the standard PPO
  arrangement, and it keeps stored log-probs consistent with the weights that
  produced them. The PopArt critic rescale forces an immediate re-upload,
  since `valMean`/`valStd` move with those weights.
- **It is best-effort.** Recurrent policies (GRU hidden state), defect-masked
  agents (`failRate > 0`, each acts with its own weights), and any layout the
  kernel does not handle fall back to the per-agent JS path. `inferBackend` in
  the frame message says which ran.

## Export: latest, not best

`exportModel` used to default to the best-average snapshot. That snapshot is
scored on one scalar — mean return over recent episodes — which stops being a
meaningful thing to maximise once training spans several maps, where the
"best" update is whichever one drew the easier tracks. It now exports the
**current** network; `{ which: 'best' }` still returns the snapshot, and LOAD
BEST is unchanged (it is a training aid, not an export policy).

## Note on the numbers in this document

Everything above was measured in a 4-core Linux container. The trainer's actual
target is a desktop CPU (i9-14900KF, Ryzen 9600X), where several of these
conclusions do not transfer:

- **"More than 2 grad workers stops helping"** is a 4-core artifact. The pool
  cap was `min(6, cores − 2)`, which left a 32-thread part with 6 workers and
  26 idle; it is now `min(12, cores − 2)`. Note the per-minibatch split is
  separately bounded by `minibatch/32` slices, so workers past that only pay
  off once the minibatch is raised.
- **The `gpu-tfjs` row** ran on a software rasteriser here. On a real GPU that
  path is worth re-measuring rather than dismissing.
- **Block sizes** (`BLK`, `GEMM_T`) were tuned against this container's cache
  hierarchy; a desktop part has more of both and may prefer larger.
- **SharedArrayBuffer is still unavailable** regardless of CPU — that is a
  GitHub Pages headers constraint, not a hardware one.

## The map window (look-ahead setting)

`PROBE_DISTS` was a hard-coded `[10, 20, 35, 55, 100, 200]`. It is now derived
from two restart-required settings, **MAP WINDOW — PROBES** (3/6/9/12) and
**RANGE** (80/200/400/800 m). `probeRange` scales the whole window and
`probeCount` resamples the same near-dense/far-sparse curve, so the defaults
(6, 200) reproduce the historical set exactly and stock models keep their
layout.

The observation width follows: `24 + 2·probes + 4 memory cells`. That reaches
further than it looks — the mirror-augmentation index map, the actor/critic
input layer, the config screen's parameter count, and the racing game's
inference all had the layout baked in as a constant. **The export now carries
`probeDists`**, and `ppo-ai.js` rebuilds its observations from the model rather
than from its own copy of the array; exports without the field fall back to the
stock window, so old models keep working.

`map-window-check.mjs` covers the stock window being unchanged, a 12-probe
window resizing the observation and the actor input, the mirror map still being
an involution at the new width, and the export round trip.

### Three information gaps worth knowing about

Looking at what the policy actually receives, beyond the window size:

1. **Probes are fixed distances in metres, not scaled by speed.** At the Viper
   GT's 61 m/s top speed the 10 m and 20 m probes are 0.16 s and 0.33 s ahead —
   below useful reaction range — while at low speed the 200 m probe is ten
   seconds out. Effectively the policy has ~4 useful probes at speed and ~4 at
   low speed, just not the same four. The dynamic look-ahead heading error
   (obs 19) already scales with speed; the probe set does not.
2. **Road width is normalised away.** Obs 20 is `distance-to-centerline /
   half-width`, so a 12 m road and a 20 m road look identical. On a single map
   that is fine — it is a constant. Across maps, which is exactly the
   multi-track case, the policy cannot tell how much room it has.
3. **Curvature is computed and thrown away.** `track-gen.js` already builds
   `state.trkCurv` (per-point curvature at two scales, used by the scripted
   AI), and it is never sent to the trainer. The policy has to infer corner
   sharpness from differences between successive probe angles.

None of these are fixed here — each changes the observation layout, and (2) and
(3) would want their own settings so a run can be compared against one without
them.

## GRU is the default now

The recurrent (GRU) policy is the mode that actually holds up over a long run;
the feed-forward policy trains but has been observed to collapse after a few
hundred updates. `recurrent: true` is now the default in the config screen, in
the worker's fallback config, and the feed-forward tests ask for
`recurrent: false` explicitly.

Two consequences worth being explicit about:

- **The batched WASM inference does not cover this mode.** `forward_batch` is
  feed-forward only — a GRU carries hidden state across steps — so recurrent
  runs still take the per-agent JS `step()` path. From the sweep, that path is
  the single biggest item in a recurrent run: policy forward 2.52 s of a
  10.35 s run (24 %). Batching the GRU step across agents is the same
  optimisation one level over, and it is the one that would actually help the
  default mode.
- **The GPU backend is off in recurrent mode** (`initGpu` returns early — the
  TF.js per-sample kernel cannot do BPTT), so recurrent training is CPU/WASM
  only.

### Non-finite guard on the CPU update

While looking at how a run could "just die", one gap stood out: the GPU path
refuses to load non-finite weights, and the CPU path had no such check. A single
bad update — a ratio spike driving an enormous gradient, a NaN anywhere in the
batch — would be written straight into the policy, and every later update would
train from NaN weights. The run would look like it simply stopped learning,
with nothing in the HUD to say why.

The CPU path now checkpoints the weights before the epoch loop (after the
PopArt rescale, so a rollback stays consistent with `valMean`/`valStd`) and
restores them if the update produced anything non-finite, clearing the Adam
moments with it. Rejected updates are counted in `updateRejects` on the frame
message.

This is insurance, not a diagnosis: it was not reproduced, and if the
feed-forward collapse is a gradual degradation rather than a numerical
blow-up the guard will never fire. Two other candidates, both feed-forward
only, if it needs chasing: the memory-as-action register (its action
dimensions get the entropy bonus but only an indirect reward signal, so their
σ drifts up while the register saturates and feeds noise back as observations),
and Adam's second moment being poisoned by one huge gradient, which freezes the
affected parameters at an effective learning rate of ~0.

## Batched GRU step (the default mode)

`forward_batch` covered the feed-forward policy only, so the default mode still
ran a scalar JS `GRUNet.step()` per agent per decision — the single biggest item
in a recurrent run. `gru_step_batch` steps every due agent in one call: each
gate is a pair of matrix-vector products against shared weights, so batching
turns them into matrix-matrix work, with a weight row loaded once for two
agents on top of the compiled SIMD the JS path never had.

| I×H×O | agents | JS µs/tick | batched WASM µs/tick | speedup |
|---|---:|---:|---:|---:|
| 36×64×2 | 8 | 388.2 | 73.4 | **5.3×** |
| 36×64×2 | 32 | 1566.7 | 301.5 | **5.2×** |
| 36×128×2 | 8 | 1246.0 | 200.6 | **6.2×** |
| 36×128×2 | 32 | 4876.6 | 793.5 | **6.2×** |
| 36×256×2 | 8 | 4131.0 | 600.7 | **6.9×** |

It also removes the two hidden-state arrays the JS path allocated per agent per
decision — the new states are written back into the gather buffer and scattered
from there.

`gru-batch-check.mjs` pins it to `GRUNet.step()` across four shapes and agent
counts either side of the kernel's 32-agent block (max 1.1e-11 relative), and
`sim-smoke` asserts the recurrent run actually takes this path.

End-to-end, paired on `gru-recurrent`: the **rollout loop drops 2.89 s → 2.09 s
(1.38×)** and the wall 5.87 s → 5.31 s. The wall moves less than the rollout
because the recurrent update's BPTT gradients — off-thread, and untouched here —
dominate a recurrent generation. On a machine with more cores the gradient pool
finishes sooner and the rollout share grows, so this should be worth more there
than on the 4-core box it was measured on.

## Blocked BPTT weight gradients

With the rollout batched, the recurrent update's BPTT gradients became the
dominant cost of a recurrent generation. `gru_backward` accumulated all six
weight-gradient matrices *inside* the time loop, so 3·(H×I) + 3·(H×H) + O×H of
gradient memory was read-modify-written on **every timestep** — 155 KB per step
at H=64, ~5 MB per 32-step chunk.

The recurrence itself has to stay sequential (each step's `dhPrev` feeds the
previous one), but the weight gradients do not: the per-timestep pre-activation
deltas are now stored and the gradients accumulated once per chunk, with time
as the reduction axis and the output tile held in registers — the same blocking
the feed-forward kernel uses. The weight *reads* that drive the recurrence stay
in the time loop; only the read-modify-write traffic leaves it.

Paired on `gru-recurrent`: gradient wall **3.94 s → 3.53 s** (13.6 → 12.1 ms
per minibatch), end-to-end **5.23 s → 4.75 s (~9 %)**. Less than the 1.8× the
feed-forward kernel got, because the time loop still reads the three H×H
recurrent matrices every step to propagate `dhPrev`, and the per-dispatch
overhead is unchanged. `gru-wasm-parity` holds at 1.9e-13.

## Observation reference

What each input actually is — including which rays duplicate each other and
what the policy cannot see — is written up separately in
[`observations.md`](./observations.md).

## Ray casting in the kernel

The last piece of the rollout still running interpreted: `rayThroughGrid` is an
Amanatides–Woo grid march, ported to C so the 18 rays per decision run compiled.

Each wall/edge grid is uploaded to linear memory once — segments, plus the
per-cell segment lists flattened to CSR, since linear memory cannot hold JS's
array-of-arrays — and marched in place. Direction vectors are computed host-side
and passed in: deriving them in C would need `sin`/`cos`, which this
deliberately import-free module does not have, and taking them from the host
also guarantees both paths march the identical rays.

Observation phase on `gru-recurrent`: **62 µs → 32.4 µs per tick (1.9×)**,
8.8 % → 5.2 % of wall.

That is a smaller share of the wall than it sounds, and the reason is worth
recording: on this 4-core box the sim thread is already **idle-blocked ~40 % of
the run** waiting for gradients, so making the rollout cheaper mostly buys more
idling. The port matters on a machine with enough cores to run a wide gradient
pool — the update finishes sooner there, and the single-threaded rollout becomes
the critical path. It could not be demonstrated on the hardware it was written
on.

Two bugs the checks caught, both of the same family — code that looks correct
because it silently degrades:

- The ray fans were running the **JS fallback** while every geometric assertion
  passed, because `initFwd()` resolves asynchronously and the check sampled
  immediately after `ready`. `inspectObs` now reports `rayBackend`, and the
  check asserts it rather than trusting that the values look right.
- `initFwd()` builds a **new instance with its own linear memory** on every
  init, so cached grid and scratch offsets pointed into a buffer that no longer
  existed. The epoch counter invalidated the grids but not the scratch.

## Raw output

`node games/ai-trainer/test/perf-bench.mjs --gens=3 --repeat=3 --json=out.json` writes
every generation's phase map for every repeat.
