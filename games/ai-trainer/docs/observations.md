# What the policy actually sees

The observation vector in **GRU (recurrent) mode**, which is the trainer's
default. 36 inputs at the stock map window; the width follows the window as
`24 + 2 × probes`. The feed-forward policy appends 4 memory-register cells on
the end (`obs 36..39`) — the GRU has none, its hidden state does that job.

Every value is clamped to the range shown. Source line references are
`scripts/sim-worker.js` → `buildObs()`.

| idx | input | source | range |
|---|---|---|---|
| 0–10 | 11 **barrier** rays, **200 m**, √-normalised | wall grid | 0…1, **1 = nothing within range** |
| 11–17 | 7 **pavement-edge** rays, **35 m**, linear | track-edge grid | 0…1, 1 = nothing within range |
| 18 | speed ÷ car's max speed | car | 0…1 |
| 19 | heading error to a look-ahead point `12 + 45·speedFrac` m along the centerline, ÷π | centerline | −1…1 |
| 20 | distance from centerline ÷ half road width | centerline | 0…1 (clamped) |
| 21 | on gravel | car | 0 / 1 |
| 22 | reversing | car | 0 / 1 |
| 23 | grade over the next 4 m ÷ 0.30 | centerline elevation | −1…1 |
| 24+2k | probe k: bearing to a point `d_k` ahead, ÷π | centerline | −1…1 |
| 25+2k | probe k: mean grade between probe k−1 and k ÷ 0.30 | centerline elevation | −1…1 |

Stock probe distances `d_k`: 10, 20, 35, 55, 100, 200 m (see the map window
setting). Actions in GRU mode are 2: steer and throttle/brake.

## The rays, precisely

The two fans measure **different boundaries**:

| | angles (° from heading) | target | range | normalisation |
|---|---|---|---|---|
| long fan (0–10) | −90, −60, −30, −10, −5, **0**, +5, +10, +30, +60, +90 | barriers | 200 m | `√(d / 200)` |
| short fan (11–17) | −90, −45, −10, **0**, +10, +45, +90 | **pavement edge (±rw/2)** | 35 m | `d / 35` |

The short fan aims at where the asphalt ends and gravel begins — geometry
`track-gen.js` already computes for the scripted AI (`state.trkEdgeLeft/Right`)
and the trainer previously never shipped.

This matters because **five of the seven short angles duplicate a long-ray
angle exactly** (−90, −10, 0, +10, +90). Cast at the same barriers, as they
were originally, that fan carried almost nothing the long fan did not — it was
a near-field zoom. Pointed at the pavement edge, every one of them measures
something the long fan cannot see.

The √ on the long fan expands the near field at the cost of far-field
resolution; the short fan does not need it, since 35 m of range keeps its
resolution usable throughout.

Exports carry `edgeRays: true`. Models exported before this flag existed
trained against the barriers and are fed barrier rays by the racing game, so
they keep working unchanged.

## What the policy cannot see

- **How far the gravel extends.** The short fan now shows where the asphalt
  ends — i.e. where gravel *starts* — out to 35 m, so the policy can see a
  runoff area coming. What it still cannot see is how deep that runoff is or
  where it ends, only the boundary it is about to cross.
- **How wide the road is.** Input 20 is distance-to-centerline *divided by*
  half-width, so a 12 m road and a 20 m road produce identical numbers. Fine on
  one map, a real blind spot across maps.
- **Curvature.** `track-gen.js` computes `state.trkCurv` (two scales, used by
  the scripted AI) and never sends it. Corner sharpness has to be inferred from
  differences between successive probe bearings.
- **Its own slip.** Speed is there; lateral velocity, yaw rate and steering
  angle are not, so "am I sliding?" has to come out of the GRU's hidden state.
- **Other cars** — correct, each agent trains in its own copy of the world.
- **Probes do not scale with speed.** They are fixed metre distances, so at
  61 m/s the 10 m and 20 m probes are 0.16 s and 0.33 s ahead. Input 19's
  look-ahead *does* scale with speed; the probe set does not.
