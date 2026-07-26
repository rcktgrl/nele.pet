'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  edge-ray-check.mjs — the short ray fan must measure the PAVEMENT boundary,
//  not the barriers.
//
//  Run:  node games/ai-trainer/test/edge-ray-check.mjs
//
//  Both fans used to be cast against the same barrier index, and five of the
//  short fan's seven angles duplicate a long-ray angle exactly — so it carried
//  almost nothing the long fan did not. The short fan now aims at the asphalt
//  edge, where gravel begins.
//
//  The track below puts the two boundaries at clearly different distances:
//  road width 12 (edge at ±6 m) inside barriers at ±10 m. A ray straight out
//  to the side must therefore read 6 m, not 10 m.
// ─────────────────────────────────────────────────────────────────────────────

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
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

const ROAD_HALF = 6;    // pavement edge
const WALL_HALF = 10;   // barrier, further out
const R = 200, N = 256;

// Concentric ring track: centerline at R, edges at R±6, barriers at R±10.
function makeTrack(withEdges) {
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
        arr.push({
          x0: pts[i].x / R * r, z0: pts[i].z / R * r,
          x1: pts[j].x / R * r, z1: pts[j].z / R * r,
        });
      }
    }
    return [inner, outer];
  };
  const [wallLeft, wallRight] = ring(WALL_HALF);
  const [edgeLeft, edgeRight] = ring(ROAD_HALF);
  const t = { pts, wallLeft, wallRight, data: { wp, rw: ROAD_HALF * 2, laps: 3 } };
  if (withEdges) { t.edgeLeft = edgeLeft; t.edgeRight = edgeRight; }
  return t;
}

const carData = { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 };

async function sampleObs(withEdges) {
  inbox.length = 0;
  send({ type: 'init', track: makeTrack(withEdges), carData, config: {
    numEnvs: 1, speedMult: 1, episodeLen: 30, randomSpawn: false,
    backend: 'js', threads: 1, recurrent: false, klStop: false,
  } });
  if (!await waitFor(m => m.type === 'ready')) return null;
  send({ type: 'inspectObs', env: 0 });
  const s = await waitFor(m => m.type === 'obsSample');
  send({ type: 'stop' });
  return s;
}

// The ±90° rays: index 0 and 10 in the long fan, 11 and 17 in the short fan.
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('\n1. Short fan reads the pavement edge');
{
  const s = await sampleObs(true);
  check('worker ready with edge geometry', !!s);
  if (s) {
    check('export layout reports edge rays', s.edgeRays === true);
    const left = s.obs[11] * s.edgeRayDist, right = s.obs[17] * s.edgeRayDist;
    check(`side rays measure the asphalt edge, ~${ROAD_HALF} m (${left.toFixed(2)}, ${right.toFixed(2)})`,
      near(left, ROAD_HALF, 0.6) && near(right, ROAD_HALF, 0.6));
    // the long fan still measures the barriers, √-normalised over 200 m
    const lw = s.obs[0] * s.obs[0] * s.rayDist, rw = s.obs[10] * s.obs[10] * s.rayDist;
    check(`long fan still measures the barrier, ~${WALL_HALF} m (${lw.toFixed(2)}, ${rw.toFixed(2)})`,
      near(lw, WALL_HALF, 1.0) && near(rw, WALL_HALF, 1.0));
    check('the two fans now disagree, i.e. the short one carries new information',
      Math.abs(left - lw) > 2);
  }
}

console.log('\n2. Payload without edge geometry falls back to barriers');
{
  const s = await sampleObs(false);
  check('worker ready without edge geometry', !!s);
  if (s) {
    check('export layout reports barrier rays', s.edgeRays === false);
    const left = s.obs[11] * s.edgeRayDist, right = s.obs[17] * s.edgeRayDist;
    check(`side rays fall back to the barrier, ~${WALL_HALF} m (${left.toFixed(2)}, ${right.toFixed(2)})`,
      near(left, WALL_HALF, 1.0) && near(right, WALL_HALF, 1.0));
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
