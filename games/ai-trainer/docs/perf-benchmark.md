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

## Raw output

`node games/ai-trainer/test/perf-bench.mjs --gens=3 --repeat=3 --json=out.json` writes
every generation's phase map for every repeat.
