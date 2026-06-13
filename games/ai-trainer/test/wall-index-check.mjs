'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  wall-index-check.mjs — parity test for the wall spatial index.
//
//  Run:  node games/ai-trainer/test/wall-index-check.mjs
//
//  The grid-backed nearestWallPoint / castRayFan must return EXACTLY what the
//  old full-array scans returned (the grid is a superset filter + the same
//  arithmetic). Reference implementations below are verbatim copies of the
//  pre-index code.
// ─────────────────────────────────────────────────────────────────────────────

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const inbox = [];
globalThis.self = globalThis;
globalThis.postMessage = msg => inbox.push(msg);
const sim = await import('../scripts/sim-worker.js');
const handler = globalThis.self.onmessage;

// ── Reference implementations (pre-index code, verbatim) ────────────────────
function refNearestPointOnSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const apx = px - ax, apz = pz - az;
  const ab2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
  return { x: ax + abx * t, z: az + abz * t };
}

function refNearestWallPoint(px, pz, walls) {
  if (!walls || !walls.length) return null;
  let best = null, bestD2 = Infinity;
  for (const w of walls) {
    const pt = refNearestPointOnSegment(px, pz, w.x0, w.z0, w.x1, w.z1);
    const d2 = (px - pt.x) ** 2 + (pz - pt.z) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = pt; }
  }
  return best;
}

function refRaySegment(ox, oz, dx, dz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const det = dx * ez - dz * ex;
  if (Math.abs(det) < 1e-8) return -1;
  const fx = ax - ox, fz = az - oz;
  const t = (fx * ez - fz * ex) / det;
  const s = (dz * fx - dx * fz) / det;
  if (t >= 0 && s >= 0 && s <= 1) return t;
  return -1;
}

function refCastRayFan(wallLeft, wallRight, car, angles, maxDist, out, offset) {
  const ox = car.pos.x, oz = car.pos.z;
  const rr = maxDist * maxDist * 1.5;
  const near = [];
  for (const segs of [wallLeft, wallRight]) {
    for (const w of segs) {
      const cx = (w.x0 + w.x1) * 0.5 - ox, cz = (w.z0 + w.z1) * 0.5 - oz;
      const e0x = w.x0 - ox, e0z = w.z0 - oz;
      const e1x = w.x1 - ox, e1z = w.z1 - oz;
      if (cx * cx + cz * cz < rr ||
          e0x * e0x + e0z * e0z < rr ||
          e1x * e1x + e1z * e1z < rr) near.push(w);
    }
  }
  for (let k = 0; k < angles.length; k++) {
    const angle = car.hdg + angles[k];
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let minT = maxDist;
    for (const w of near) {
      const t = refRaySegment(ox, oz, dx, dz, w.x0, w.z0, w.x1, w.z1);
      if (t > 0 && t < minT) minT = t;
    }
    out[offset + k] = minT / maxDist;
  }
}

// ── Synthetic geometry: circle track + extra random clutter segments ────────
let seed = 0x1234567;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function makeTrack() {
  const N = 128, R = 100, HALF = 8;
  const pts = [], wallLeft = [], wallRight = [], wp = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R });
    wp.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    for (const [arr, r] of [[wallLeft, R - HALF], [wallRight, R + HALF]]) {
      arr.push({
        x0: pts[i].x / R * r, z0: pts[i].z / R * r,
        x1: pts[j].x / R * r, z1: pts[j].z / R * r,
      });
    }
  }
  // clutter: short random segments all over (and a few far outliers), so the
  // grid sees crossing geometry that arc-ordered windows would mishandle
  for (let i = 0; i < 300; i++) {
    const cx = (rand() * 2 - 1) * 260, cz = (rand() * 2 - 1) * 260;
    const a = rand() * Math.PI * 2, len = 0.5 + rand() * 4.5;
    const seg = {
      x0: cx, z0: cz,
      x1: cx + Math.cos(a) * len, z1: cz + Math.sin(a) * len,
    };
    (rand() < 0.5 ? wallLeft : wallRight).push(seg);
  }
  return { pts, wallLeft, wallRight, data: { wp, rw: 16, laps: 3 } };
}

const track = makeTrack();
handler({ data: {
  type: 'init', track,
  carData: { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 },
  config: { numEnvs: 2, backend: 'js', threads: 1 },
} });
check('worker initialized', inbox.some(m => m.type === 'ready'));

const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// ── nearest-wall parity ──────────────────────────────────────────────────────
{
  let worst = 0, bad = 0;
  const TRIALS = 2000;
  for (let t = 0; t < TRIALS; t++) {
    // mostly on-track points, some far outside (exercises the expanding search)
    const far = t % 10 === 0;
    const px = (rand() * 2 - 1) * (far ? 1500 : 130);
    const pz = (rand() * 2 - 1) * (far ? 1500 : 130);
    for (const side of ['left', 'right']) {
      const ref = refNearestWallPoint(px, pz, side === 'left' ? track.wallLeft : track.wallRight);
      const got = sim.nearestWallForTest(px, pz, side);
      // equidistant ties may pick a different segment, but the resulting
      // DISTANCE must match exactly — compare distances, not identities
      const dRef = Math.hypot(px - ref.x, pz - ref.z);
      const dGot = Math.hypot(px - got.x, pz - got.z);
      const err = Math.abs(dRef - dGot);
      worst = Math.max(worst, err);
      if (!close(dRef, dGot)) bad++;
    }
  }
  check(`nearest wall distance matches the full scan on ${TRIALS}×2 queries (worst |Δ| ${worst.toExponential(2)})`, bad === 0);
}

// ── ray-fan parity ───────────────────────────────────────────────────────────
{
  const RAY_ANGLES = [
    -Math.PI / 2, -Math.PI / 3, -Math.PI / 6, -Math.PI / 18, -Math.PI / 36,
    0, Math.PI / 36, Math.PI / 18, Math.PI / 6, Math.PI / 3, Math.PI / 2,
  ];
  const EDGE_RAY_ANGLES = [
    -Math.PI / 2, -Math.PI / 4, -Math.PI / 18, 0, Math.PI / 18, Math.PI / 4, Math.PI / 2,
  ];
  let worst = 0, bad = 0;
  const TRIALS = 500;
  for (let t = 0; t < TRIALS; t++) {
    const car = {
      pos: { x: (rand() * 2 - 1) * 130, z: (rand() * 2 - 1) * 130 },
      hdg: rand() * Math.PI * 2,
    };
    for (const [angles, dist] of [[RAY_ANGLES, 200], [EDGE_RAY_ANGLES, 35]]) {
      const ref = new Float64Array(angles.length);
      const got = new Float64Array(angles.length);
      refCastRayFan(track.wallLeft, track.wallRight, car, angles, dist, ref, 0);
      sim.castRayFan(car, angles, dist, got, 0);
      for (let k = 0; k < angles.length; k++) {
        const err = Math.abs(ref[k] - got[k]);
        worst = Math.max(worst, err);
        if (!close(ref[k], got[k])) bad++;
      }
    }
  }
  check(`ray distances match the full scan on ${TRIALS}×18 rays (worst |Δ| ${worst.toExponential(2)})`, bad === 0);
}

// ── empty-side behavior ──────────────────────────────────────────────────────
{
  handler({ data: {
    type: 'init',
    track: { ...makeTrack(), wallRight: [] },
    carData: { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 },
    config: { numEnvs: 2, backend: 'js', threads: 1 },
  } });
  check('empty wall side returns null like the full scan',
    sim.nearestWallForTest(0, 0, 'right') === null);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
