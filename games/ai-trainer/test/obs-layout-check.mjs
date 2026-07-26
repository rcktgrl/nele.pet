'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  obs-layout-check.mjs — read a LIVE agent's observation and prove that every
//  index is what docs/observations.md says it is.
//
//  Run:  node games/ai-trainer/test/obs-layout-check.mjs
//
//  The track is a flat circular ring, so every input has a closed-form
//  expected value: rays are ray/circle intersections against the pavement and
//  barrier circles, bearings follow from the chord geometry, and every
//  elevation term is exactly zero. The car's real position and heading are
//  taken from the frame message, so nothing here assumes where it spawned.
//
//  Prints the full labelled vector, then asserts it. If the doc and the code
//  disagree, this fails.
// ─────────────────────────────────────────────────────────────────────────────

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) { console.log(`  ✗ FAIL ${name}${detail ? ' — ' + detail : ''}`); failures++; }
}

const inbox = [];
let wakeup = null;
globalThis.self = globalThis;
globalThis.postMessage = msg => {
  inbox.push(msg);
  if (wakeup) { const w = wakeup; wakeup = null; w(); }
};
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const str = String(url);
  if (str.startsWith('file:')) {
    const { readFile } = await import('node:fs/promises');
    return new Response(await readFile(new URL(str)), { headers: { 'Content-Type': 'application/wasm' } });
  }
  return realFetch(url);
};

await import('../scripts/sim-worker.js');
const send = msg => globalThis.self.onmessage({ data: msg });

async function waitFor(pred, timeoutMs = 5000) {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < inbox.length; i++) if (pred(inbox[i])) return inbox.splice(i, 1)[0];
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise(res => { wakeup = res; setTimeout(res, 50); });
  }
}

// ── Track: flat ring, centerline at R, pavement at R±6, barriers at R±10 ─────
const R = 200, N = 512, ROAD_HALF = 6, WALL_HALF = 10;
function makeTrack() {
  const pts = [], wp = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R });
    wp.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  const ring = half => {
    const inner = [], outer = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      for (const [arr, r] of [[inner, R - half], [outer, R + half]]) {
        arr.push({ x0: pts[i].x / R * r, z0: pts[i].z / R * r,
                   x1: pts[j].x / R * r, z1: pts[j].z / R * r });
      }
    }
    return [inner, outer];
  };
  const [wallLeft, wallRight] = ring(WALL_HALF);
  const [edgeLeft, edgeRight] = ring(ROAD_HALF);
  return { pts, wallLeft, wallRight, edgeLeft, edgeRight,
           data: { wp, rw: ROAD_HALF * 2, laps: 3 } };
}

// Bearing the car sees to a point `d` metres further along the ring, using the
// car's MEASURED heading — the spawn heading is not exactly tangent, and
// assuming it was is what made the first version of this check disagree with
// the code by a constant offset equal to that heading.
function expectedBearing(car, d) {
  const a = Math.atan2(car.z, car.x) + d / R;
  const px = Math.cos(a) * R, pz = Math.sin(a) * R;
  let ang = Math.atan2(px - car.x, pz - car.z) - car.hdg;
  ang = ang - 2 * Math.PI * Math.round(ang / (2 * Math.PI));
  return ang / Math.PI;
}

// First positive hit of a ray against a circle of radius r centred on origin.
function rayCircle(px, pz, dx, dz, r) {
  const b = px * dx + pz * dz;
  const c = px * px + pz * pz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t0 = -b - s, t1 = -b + s;
  if (t0 > 1e-9) return t0;
  if (t1 > 1e-9) return t1;
  return Infinity;
}
const rayTo = (px, pz, dx, dz, halves, maxDist) => {
  let best = maxDist;
  for (const h of halves) {
    for (const r of [R - h, R + h]) {
      const t = rayCircle(px, pz, dx, dz, r);
      if (t < best) best = t;
    }
  }
  return best;
};

const LONG_ANGLES = [-90, -60, -30, -10, -5, 0, 5, 10, 30, 60, 90];
const EDGE_ANGLES = [-90, -45, -10, 0, 10, 45, 90];
const carData = { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 };

async function sample(recurrent) {
  inbox.length = 0;
  send({ type: 'init', track: makeTrack(), carData, config: {
    numEnvs: 1, speedMult: 1, episodeLen: 30, randomSpawn: false,
    backend: 'js', threads: 1, recurrent, klStop: false,
  } });
  if (!await waitFor(m => m.type === 'ready')) return null;
  send({ type: 'getSnapshot' });
  const frame = await waitFor(m => m.type === 'frame');
  send({ type: 'inspectObs', env: 0 });
  const s = await waitFor(m => m.type === 'obsSample');
  send({ type: 'stop' });
  return s && frame ? { ...s, car: frame.cars[0] } : null;
}

function report(label, s) {
  const { obs, obsDim, probeDists, edgeRays, rayDist, edgeRayDist, car } = s;
  const dirOf = deg => {
    const a = car.hdg + deg * Math.PI / 180;
    return [Math.sin(a), Math.cos(a)];
  };
  const rows = [];
  const row = (i, name, expect, tol) => {
    const ok = expect === null || Math.abs(obs[i] - expect) <= tol;
    rows.push([i, name, obs[i], expect, ok]);
    if (expect !== null) check(`[${i}] ${name}`, ok, `live ${obs[i].toFixed(4)} vs expected ${expect.toFixed(4)}`);
  };

  console.log(`\n══ ${label} — ${obsDim} inputs ══`);
  console.log(`   car at (${car.x.toFixed(1)}, ${car.z.toFixed(1)}) heading ${car.hdg.toFixed(3)} rad, speed ${car.spd.toFixed(2)}`);
  console.log(`   probes ${probeDists.join(', ')} m · edgeRays ${edgeRays} · ray ranges ${rayDist}/${edgeRayDist} m\n`);
  console.log('   idx  input                                          live    expected');

  for (let k = 0; k < LONG_ANGLES.length; k++) {
    const [dx, dz] = dirOf(LONG_ANGLES[k]);
    const d = rayTo(car.x, car.z, dx, dz, [WALL_HALF], rayDist);
    row(k, `barrier ray ${String(LONG_ANGLES[k]).padStart(3)}° (√, ${rayDist} m) → ${d === rayDist ? 'nothing in range' : d.toFixed(1) + ' m'}`,
      Math.sqrt(d / rayDist), 0.02);
  }
  for (let k = 0; k < EDGE_ANGLES.length; k++) {
    const [dx, dz] = dirOf(EDGE_ANGLES[k]);
    const d = rayTo(car.x, car.z, dx, dz, [ROAD_HALF], edgeRayDist);
    row(11 + k, `pavement ray ${String(EDGE_ANGLES[k]).padStart(3)}° (${edgeRayDist} m) → ${d === edgeRayDist ? 'nothing in range' : d.toFixed(1) + ' m'}`,
      d / edgeRayDist, 0.02);
  }
  row(18, 'speed ÷ max speed', car.spd / carData.maxSpd, 0.01);
  // look-ahead point is 12 + 45·speedFrac m along the arc; on a ring the chord
  // to it sits half that arc angle off the tangent
  const lookM = 12 + (car.spd / carData.maxSpd) * 45;
  row(19, `heading error to look-ahead ${lookM.toFixed(1)} m, ÷π`, expectedBearing(car, lookM), 0.002);
  row(20, 'distance from centerline ÷ half road width', 0, 0.02);
  row(21, 'on gravel', 0, 0);
  row(22, 'reversing', 0, 0);
  row(23, 'grade over next 4 m ÷ 0.30 (track is flat)', 0, 1e-9);
  for (let k = 0; k < probeDists.length; k++) {
    const d = probeDists[k];
    row(24 + 2 * k, `probe ${k} (${d} m): bearing ÷π`, expectedBearing(car, d), 0.002);
    row(25 + 2 * k, `probe ${k} (${d} m): grade ÷ 0.30 (flat)`, 0, 1e-9);
  }
  const memBase = 24 + probeDists.length * 2;
  for (let i = memBase; i < obsDim; i++) row(i, `memory cell ${i - memBase} (feed-forward only)`, 0, 1e-9);

  for (const [i, name, live, expect, ok] of rows) {
    console.log(`   ${String(i).padStart(3)}  ${name.padEnd(46)} ${live.toFixed(4).padStart(8)}` +
                (expect === null ? '    (see check below)' : `  ${expect.toFixed(4).padStart(8)} ${ok ? '✓' : '✗'}`));
  }
  check(`${label}: vector width matches 24 + 2·probes${memBase < obsDim ? ' + memory' : ''}`,
    obsDim === memBase + (memBase < obsDim ? 4 : 0));
}

report('GRU (default)', await sample(true));
report('Feed-forward', await sample(false));

console.log(failures ? `\n${failures} CHECK(S) FAILED — the doc and the code disagree`
                     : '\nall checks passed — every index matches docs/observations.md');
process.exit(failures ? 1 : 0);
