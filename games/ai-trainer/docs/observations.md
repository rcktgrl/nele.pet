# What the policy actually sees

The observation vector in **GRU (recurrent) mode**, which is the trainer's
default. 36 inputs at the stock map window; the width follows the window as
`24 + 2 × probes`. The feed-forward policy appends 4 memory-register cells on
the end (`obs 36..39`) — the GRU has none, its hidden state does that job.

Every value is clamped to the range shown. Source line references are
`scripts/sim-worker.js` → `buildObs()`.

| idx | input | source | range |
|---|---|---|---|
| 0–10 | 11 barrier rays, **200 m**, √-normalised | wall grid | 0…1, **1 = nothing within range** |
| 11–17 | 7 barrier rays, **35 m**, linear | same wall grid | 0…1, 1 = nothing within range |
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

Both fans are cast against **the same geometry** — `wallIdx.all`, the combined
left+right barrier index. The code calls the first set "track-edge rays", but
there is no separate edge geometry in the cast: both sets measure distance to a
*barrier*.

| | angles (° from heading) | range | normalisation |
|---|---|---|---|
| long fan (0–10) | −90, −60, −30, −10, −5, **0**, +5, +10, +30, +60, +90 | 200 m | `√(d / 200)` |
| short fan (11–17) | −90, −45, −10, **0**, +10, +45, +90 | 35 m | `d / 35` |

**Five of the seven short rays duplicate a long-ray angle exactly** (−90, −10,
0, +10, +90). Only ±45 point somewhere the long fan does not. So the short fan
is mostly a near-field zoom rather than new information: at 5 m the long ray
reads `√(5/200) = 0.158` while the short ray reads `5/35 = 0.143`, and the
short one keeps resolving as the distance shrinks where the long one is
compressed against zero. The √ on the long fan exists for the same reason —
it expands the near field at the cost of far-field resolution.

If you want the rays cheaper, that redundancy is where the slack is: dropping
the five duplicated short angles costs little information, and dropping the
short fan entirely costs near-field resolution only.

## What the policy cannot see

- **Gravel ahead.** The rays hit barriers only. Input 21 says "I am on gravel
  *now*"; nothing shows a runoff area before the car is in it. On a map with
  runoff (jeff has it) the policy can only learn to avoid gravel from the
  centerline geometry and the penalty it collects afterwards.
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
