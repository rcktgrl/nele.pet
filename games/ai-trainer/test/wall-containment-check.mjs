'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  wall-containment-check.mjs — regression tests for SimCar.boundary().
//
//  Covers two bugs that came as a pair:
//
//  1. Off-track containment was unreachable. boundary() returned unconditionally
//     inside `if (wallPt)`, and nearestWallPoint() returns non-null whenever the
//     side has ANY segments (its own `return null` is annotated "unreachable
//     while side.n > 0"), so the road-width check below never ran on a track
//     with walls. track-gen.js DROPS wall segments that self-intersect or
//     intrude into the track interior (tight corners), and in those gaps a car
//     left the track with no pushback and no penalty.
//
//  2. Fixing (1) re-enabled a bound of rw/2 + 1.0 — which is INSIDE where
//     gravel starts (rw/2 + 1.75). That pushed cars back before they could
//     reach the runoff, so gravel behaved exactly like a wall. The fallback
//     must bound at the OUTER edge of the runoff, where track-gen puts the
//     barrier.
//
//  Track geometry here mirrors track-gen.js: road ±rw/2, gravel runoff from
//  rw/2+1.75 outward, barrier at the outer edge of the runoff.
//
//  Run:  node games/ai-trainer/test/wall-containment-check.mjs
// ─────────────────────────────────────────────────────────────────────────────

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const inbox = [];
let wakeup = null;
globalThis.self = globalThis;
globalThis.postMessage = m => { inbox.push(m); if (wakeup) { const w = wakeup; wakeup = null; w(); } };

const sim = await import('../scripts/sim-worker.js');
const handler = globalThis.self.onmessage;
const send = m => handler({ data: m });

async function waitFor(pred, ms) {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < inbox.length; i++) if (pred(inbox[i])) return inbox.splice(i, 1)[0];
    if (Date.now() - t0 > ms) return null;
    await new Promise(r => { wakeup = r; setTimeout(r, 25); });
  }
}

const R = 100, HALF = 8, N = 128;
const RUNOFF = 6;
const GRAVEL_INNER = HALF + 1.75;              // checkGravel(): rw/2 + 1.75
const GRAVEL_OUTER = GRAVEL_INNER + RUNOFF;    // barrier line
const ROAD_EDGE    = HALF + 1.0;               // bound when there is no runoff
// Outer wall missing across this index range — the "culled segments" case.
const GAP_FROM = 30, GAP_TO = 80;

function makeTrack({ gravel }) {
  const pts = [], wallLeft = [], wallRight = [], wp = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R });
    wp.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  // Barrier sits at the outer edge of the runoff, as track-gen.js places it.
  const wallOff = gravel ? GRAVEL_OUTER : HALF;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const seg = r => ({
      x0: pts[i].x / R * r, z0: pts[i].z / R * r,
      x1: pts[j].x / R * r, z1: pts[j].z / R * r,
    });
    wallLeft.push(seg(R - wallOff));                             // inner: complete
    if (i < GAP_FROM || i > GAP_TO) wallRight.push(seg(R + wallOff)); // outer: gapped
  }
  const track = { pts, wallLeft, wallRight, data: { wp, rw: HALF * 2, laps: 3 } };
  if (gravel) {
    track.gravelProfile = {
      pts: pts.map(p => ({ x: p.x, y: p.y, z: p.z })),
      leftRunoff:  new Array(N).fill(RUNOFF),
      rightRunoff: new Array(N).fill(RUNOFF),
      rw: HALF * 2,
    };
  }
  return track;
}

const carData = { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 };
const at = (idx, radius) => {
  const a = (idx / N) * 2 * Math.PI;
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
};
const offsetOf = res => Math.abs(Math.hypot(res.x, res.z) - R);

async function initTrack(track, cfg = {}) {
  inbox.length = 0;
  send({ type: 'init', track, carData, config: {
    numEnvs: 24, randomSpawn: true, episodeLen: 30,
    horizon: 1000000,           // no PPO update — this is a physics test
    speedMult: 40, backend: 'js', threads: 1, wallHitPenalty: 50, ...cfg,
  }});
  return !!await waitFor(m => m.type === 'ready', 8000);
}

// ── Track with gravel runoff ────────────────────────────────────────────────
const gravelTrack = makeTrack({ gravel: true });
check('worker initialized on the gapped gravel track', await initTrack(gravelTrack));
check('outer wall really has a gap (inner does not)',
  gravelTrack.wallRight.length < gravelTrack.wallLeft.length && gravelTrack.wallRight.length > 0,
  `${gravelTrack.wallRight.length} outer vs ${gravelTrack.wallLeft.length} inner segments`);

// The gap is a genuine hole: nothing within WALL_STOP to stop a car there.
{
  const p = at((GAP_FROM + GAP_TO) / 2, R + GRAVEL_OUTER);
  const wp = sim.nearestWallForTest(p.x, p.z, 'right');
  const d = wp ? Math.hypot(wp.x - p.x, wp.z - p.z) : Infinity;
  check('nearest outer wall from mid-gap is beyond WALL_STOP (1.2 m)',
    !!wp && d > 1.2, wp ? `${d.toFixed(1)} m away` : 'no wall point at all');
}

// REGRESSION 2 — gravel must stay drivable, in the gap and where walls exist.
{
  let worstPush = 0, anyFlagged = false, n = 0;
  for (const idx of [10, 40, 55, 70, 100]) {
    for (const off of [GRAVEL_INNER + 0.5, (GRAVEL_INNER + GRAVEL_OUTER) / 2, GRAVEL_OUTER - 0.5]) {
      const p = at(idx, R + off);
      const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
      const push = Math.hypot(res.x - p.x, res.z - p.z);
      if (push > worstPush) worstPush = push;
      if (res.wallHit) anyFlagged = true;
      n++;
    }
  }
  check('cars on gravel runoff are NOT pushed back (gravel is not a wall)',
    worstPush < 1e-9, `worst pushback ${worstPush.toFixed(3)} m over ${n} probes`);
  check('cars on gravel runoff are NOT flagged as wall contact', !anyFlagged);
}

// REGRESSION 1 — past the runoff, inside the wall gap, containment must apply.
{
  const OUT = GRAVEL_OUTER + 10;
  let worstAfter = 0, allFlagged = true, n = 0;
  for (let idx = GAP_FROM + 5; idx <= GAP_TO - 5; idx += 5) {
    const p = at(idx, R + OUT);
    const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
    const after = offsetOf(res);
    if (after > worstAfter) worstAfter = after;
    if (!res.wallHit) allFlagged = false;
    n++;
  }
  check('cars past the runoff inside the gap are pulled back',
    worstAfter < OUT, `worst remaining offset ${worstAfter.toFixed(2)} m over ${n} probes`);
  check('that off-track contact is flagged for the reward (wallHit)', allFlagged);
}

// Control: same probe where the wall is intact (this path always worked).
{
  const p = at(5, R + GRAVEL_OUTER + 10);
  const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
  check('control: containment still works where the wall is intact',
    offsetOf(res) < GRAVEL_OUTER + 10 && res.wallHit, `offset ${offsetOf(res).toFixed(2)} m`);
}

// Control: a car on the centreline is untouched.
{
  const p = at(50, R);
  const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
  const moved = Math.hypot(res.x - p.x, res.z - p.z);
  check('control: a car on the centreline is untouched and unflagged',
    moved < 1e-9 && !res.wallHit, `moved ${moved.toExponential(1)} m`);
}

// ── Track WITHOUT runoff keeps the original road-width bound ────────────────
check('worker initialized on the no-gravel track', await initTrack(makeTrack({ gravel: false })));
{
  const p = at(55, R + HALF + 12);
  const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
  check('no-gravel track: still contained at the road edge',
    offsetOf(res) <= ROAD_EDGE + 0.6 && res.wallHit, `offset ${offsetOf(res).toFixed(2)} m`);
}

// ── Rollout smoke on the gravel track ───────────────────────────────────────
check('re-initialized gravel track for rollout', await initTrack(gravelTrack));
send({ type: 'start' });
const DEADLINE = Date.now() + 12000;
let worst = 0, seen = false;
while (Date.now() < DEADLINE) {
  const f = await waitFor(m => m.type === 'frame', 3000);
  if (!f) break;
  for (const c of f.cars) {
    const d = Math.abs(Math.hypot(c.x, c.z) - R);
    if (d > worst) worst = d;
    seen = true;
  }
}
send({ type: 'stop' });
check('saw car telemetry', seen);
const TOL = 2.0;   // containment is a post-move push: allow a tick of overshoot
check('no car escapes past the barrier line during a rollout',
  worst <= GRAVEL_OUTER + 1.0 + TOL,
  `worst radial offset ${worst.toFixed(2)} m (bound ${(GRAVEL_OUTER + 1.0).toFixed(2)} + ${TOL} tol)`);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
