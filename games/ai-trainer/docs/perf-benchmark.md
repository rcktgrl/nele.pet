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

## What to fix first

1. **Stop cloning the weight vectors per dispatch.** Hoist `flatF64()` out of the
   minibatch loop and share the weights with the pool (transferable or
   `SharedArrayBuffer`), or push the whole epoch to the workers the way the GPU path
   does — one round trip per update instead of ~170. Biggest single win available.
2. **Raise the default minibatch** (256 → 512/1024) at high `speedMult`, where
   batches arrive at ~7k samples anyway. Free 20 %.
3. **Cache the rollout observation work.** 18 rays × 15k decisions/generation is
   16 % of wall; the wall grid already bounds each ray, so the remaining win is doing
   fewer of them (or reusing them across an `actionRepeat` window).
4. **Surface the effective speed multiplier in the HUD.** Users set 200× and get
   12–47×; showing the achieved rate makes the compute wall obvious instead of
   looking like a broken slider.

## Raw output

`node games/ai-trainer/test/perf-bench.mjs --gens=3 --repeat=3 --json=out.json` writes
every generation's phase map for every repeat.
