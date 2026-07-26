'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  wall-containment-check.mjs — regression test for the off-track containment
//  bug in SimCar.boundary().
//
//  boundary() used to `return` unconditionally inside `if (wallPt)`. Since
//  nearestWallPoint() returns non-null whenever that side has ANY segments, the
//  road-width containment below it was dead code on every track with walls.
//  track-gen.js deliberately DROPS wall segments that self-intersect or intrude
//  into the track interior (tight corners), and in those gaps a car could leave
//  the track entirely — no pushback, no stuckTimer, no penalty.
//
//  This builds a ring whose OUTER wall has a deliberate gap and asserts that no
//  car ever gets further from the centerline than the road half-width allows.
//  The inner wall stays complete so nearestWallPoint() keeps returning non-null
//  (side.n > 0) — that is what made the old code skip containment.
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
// Outer wall missing across this index range — the "culled segments" case.
const GAP_FROM = 30, GAP_TO = 80;

function makeGappedTrack() {
  const pts = [], wallLeft = [], wallRight = [], wp = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R });
    wp.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const seg = r => ({
      x0: pts[i].x / R * r, z0: pts[i].z / R * r,
      x1: pts[j].x / R * r, z1: pts[j].z / R * r,
    });
    wallLeft.push(seg(R - HALF));                         // inner wall: complete
    if (i < GAP_FROM || i > GAP_TO) wallRight.push(seg(R + HALF)); // outer: gapped
  }
  return { pts, wallLeft, wallRight, data: { wp, rw: HALF * 2, laps: 3 } };
}

const carData = { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 };

const track = makeGappedTrack();
check('outer wall really has a gap (and inner wall does not)',
  track.wallRight.length < track.wallLeft.length && track.wallRight.length > 0,
  `${track.wallRight.length} outer vs ${track.wallLeft.length} inner segments`);

inbox.length = 0;
send({ type: 'init', track, carData, config: {
  numEnvs: 24, randomSpawn: true, episodeLen: 30,
  horizon: 1000000,          // no PPO update — this is a physics test
  speedMult: 40, backend: 'js', threads: 1,
  wallHitPenalty: 50,
}});
check('worker initialized on the gapped track', !!await waitFor(m => m.type === 'ready', 8000));

// ── Direct boundary() probes ────────────────────────────────────────────────
// A driving policy rarely wanders far enough out to exercise the gap, so probe
// boundary() directly at chosen poses instead of hoping a rollout gets there.
const maxD = HALF + 1.0;      // the bound boundary() is supposed to enforce
const at = (idx, radius) => {
  const a = (idx / N) * 2 * Math.PI;
  return { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
};

// Sanity: the gap really is a hole in the outer wall — the nearest right-side
// wall point from deep inside the gap must be far away, which is precisely the
// condition under which the old code skipped containment.
{
  const p = at((GAP_FROM + GAP_TO) / 2, R + HALF);
  const wp = sim.nearestWallForTest(p.x, p.z, 'right');
  const d = wp ? Math.hypot(wp.x - p.x, wp.z - p.z) : Infinity;
  check('nearest outer wall from mid-gap is beyond WALL_STOP (1.2 m)',
    !!wp && d > 1.2, wp ? `${d.toFixed(1)} m away` : 'no wall point at all');
}

// The real regression: a car well outside the road, in the gap, must be pushed
// back inside. Before the fix boundary() returned early here and did nothing.
{
  const OUT = R + HALF + 12;                       // 12 m beyond the road edge
  let worstAfter = 0, allFlagged = true, n = 0;
  for (let idx = GAP_FROM + 5; idx <= GAP_TO - 5; idx += 5) {
    const p = at(idx, OUT);
    const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
    const after = Math.abs(Math.hypot(res.x, res.z) - R);
    if (after > worstAfter) worstAfter = after;
    if (!res.wallHit) allFlagged = false;
    n++;
  }
  check(`cars ${OUT - R} m off-centre inside the gap are pushed back onto the road`,
    worstAfter < OUT - R, `worst remaining offset ${worstAfter.toFixed(2)} m over ${n} probes`);
  check('off-track contact is flagged for the reward (wallHit)', allFlagged);
}

// Control: the same probe where the outer wall EXISTS must also be contained
// (that path always worked — this guards against the fix breaking it).
{
  const p = at(5, R + HALF + 12);
  const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
  const after = Math.abs(Math.hypot(res.x, res.z) - R);
  check('control: containment still works where the wall is intact',
    after <= maxD + 0.6 && res.wallHit, `offset ${after.toFixed(2)} m`);
}

// Control: a car comfortably ON the road must NOT be flagged or moved.
{
  const p = at(50, R);
  const res = sim.boundaryProbeForTest(p.x, p.z, 0, 30);
  const moved = Math.hypot(res.x - p.x, res.z - p.z);
  check('control: a car on the centreline is untouched and unflagged',
    moved < 1e-9 && !res.wallHit, `moved ${moved.toExponential(1)} m`);
}

// ── Rollout smoke: nothing escapes during real driving either ───────────────
send({ type: 'start' });
const DEADLINE = Date.now() + 12000;
let worst = 0, worstSeen = false;
while (Date.now() < DEADLINE) {
  const f = await waitFor(m => m.type === 'frame', 3000);
  if (!f) break;
  for (const c of f.cars) {
    const d = Math.abs(Math.hypot(c.x, c.z) - R);
    if (d > worst) worst = d;
    worstSeen = true;
  }
}
send({ type: 'stop' });

check('saw car telemetry', worstSeen);
const TOL = 2.0;   // containment is a post-move push: allow a tick of overshoot
check('no car escapes the road width during a rollout',
  worst <= maxD + TOL,
  `worst radial offset ${worst.toFixed(2)} m (bound ${maxD.toFixed(2)} + ${TOL} tol)`);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
