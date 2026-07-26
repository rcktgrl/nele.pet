'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  map-window-check.mjs — the configurable look-ahead window ("map window")
//  must reshape the observation consistently everywhere it is described.
//
//  Run:  node games/ai-trainer/test/map-window-check.mjs
//
//  Checks that the stock window is unchanged (old exports stay valid), that a
//  custom window resizes the observation and the actor's input layer, that the
//  mirror map still works at the new width, and that the export carries the
//  layout — without it the racing game cannot rebuild these inputs.
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

const sim = await import('../scripts/sim-worker.js');
const send = msg => globalThis.self.onmessage({ data: msg });

async function waitFor(pred, timeoutMs = 5000) {
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < inbox.length; i++) if (pred(inbox[i])) return inbox.splice(i, 1)[0];
    if (Date.now() - t0 > timeoutMs) return null;
    await new Promise(res => { wakeup = res; setTimeout(res, 100); });
  }
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
      arr.push({ x0: pts[i].x / R * r, z0: pts[i].z / R * r, x1: pts[j].x / R * r, z1: pts[j].z / R * r });
    }
  }
  return { pts, wallLeft, wallRight, data: { wp, rw: 16, laps: 3 } };
}

const carData = { accel: 12, maxSpd: 50, brake: 25, hdl: 1.0, aiSpd: 1.0 };

async function boot(config) {
  inbox.length = 0;
  // The window applies to both policies; these checks pin the feed-forward
  // layout (base + probes + memory cells) unless a case says otherwise.
  send({ type: 'init', track: makeTrack(), carData, config: {
    numEnvs: 4, speedMult: 200, episodeLen: 10, backend: 'js', threads: 1,
    minibatch: 128, horizon: 32, epochs: 2, klStop: false, recurrent: false, ...config,
  } });
  return waitFor(m => m.type === 'ready');
}

async function exportModel() {
  inbox.length = 0;
  send({ type: 'exportModel' });
  const m = await waitFor(m => m.type === 'modelExport');
  return m && m.model;
}

// ── 1. Stock window is unchanged ─────────────────────────────────────────────
console.log('\n1. Stock window (6 probes, 200 m)');
{
  const ready = await boot({});
  check('worker ready', !!ready);
  check(`observation is still 40 wide (${ready && ready.obsDim})`, !!ready && ready.obsDim === 40);
  check('actor input layer matches', !!ready && ready.actorSizes[0] === 40);
  const m = await exportModel();
  check('export records the probe distances', !!m && Array.isArray(m.probeDists));
  check(`stock distances are the historical set (${m && m.probeDists})`,
    !!m && JSON.stringify(m.probeDists) === JSON.stringify([10, 20, 35, 55, 100, 200]));
  send({ type: 'stop' });
}

// ── 2. A wider window reshapes everything ────────────────────────────────────
console.log('\n2. Wide window (12 probes, 400 m)');
{
  const ready = await boot({ probeCount: 12, probeRange: 400 });
  const want = 24 + 12 * 2 + 4;   // base + probes + memory cells
  check(`observation widened to ${want} (${ready && ready.obsDim})`, !!ready && ready.obsDim === want);
  check('actor input layer follows', !!ready && ready.actorSizes[0] === want);

  // the mirror map is index arithmetic over the layout — it must still hold
  const src = Float64Array.from({ length: want }, (_, i) => i + 1);
  const dst = sim.mirrorObsInto(src, new Float64Array(want));
  const back = sim.mirrorObsInto(dst, new Float64Array(want));
  check('mirror is still an involution at the new width', back.every((v, i) => v === src[i]));
  let probesOk = true;
  for (let p = 0; p < 12; p++) {
    probesOk = probesOk && dst[24 + 2 * p] === -src[24 + 2 * p]     // angle flips
                        && dst[25 + 2 * p] === src[25 + 2 * p];     // slope keeps
  }
  check('every probe pair is mirrored, not just the first six', probesOk);
  const memBase = 24 + 12 * 2;
  check('memory cells sit after the widened probe block',
    dst[memBase] === src[memBase] && dst[memBase + 3] === src[memBase + 3]);

  send({ type: 'start' });
  await new Promise(res => setTimeout(res, 4000));
  send({ type: 'getSnapshot' });
  const frame = await waitFor(m => m.type === 'frame', 3000);
  check('training runs at the new width', !!frame && Number.isFinite(frame.avgReturn));
  send({ type: 'stop' });

  const m = await exportModel();
  check(`export carries the 12-probe window (${m && m.probeDists && m.probeDists.length} probes)`,
    !!m && m.probeDists.length === 12);
  check(`furthest probe is the configured range (${m && m.probeDists && m.probeDists[11]} m)`,
    !!m && m.probeDists[11] === 400);
  check('exported obsDim matches the actor input', !!m && m.obsDim === m.actor.sizes[0]);
  check('weights are finite', !!m && m.actor.flat.every(Number.isFinite));
}

// ── 3. The window resizes the recurrent layout too ───────────────────────────
console.log('\n3. Recurrent policy (no memory cells)');
{
  const ready = await boot({ recurrent: true, probeCount: 9, probeRange: 300 });
  const want = 24 + 9 * 2;   // GRU carries memory in its hidden state
  check(`observation is base + probes only, ${want} (${ready && ready.obsDim})`,
    !!ready && ready.obsDim === want);
  const m = await exportModel();
  check('recurrent export carries the window', !!m && m.probeDists.length === 9);
  check(`furthest probe is the configured range (${m && m.probeDists && m.probeDists[8]} m)`,
    !!m && m.probeDists[8] === 300);
  send({ type: 'stop' });
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
