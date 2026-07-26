'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  perf-bench.mjs — AI-trainer training benchmark (headless Chromium).
//
//  Runs the REAL trainer stack — track-gen geometry, sim-worker.js, the
//  grad-worker pool, the WASM kernel — on a real map and reports where the
//  wall-clock of a training generation actually goes.
//
//  Run:  node games/ai-trainer/test/perf-bench.mjs [options]
//
//    --track=jeff        map to benchmark (name from turborace/tracks/index.json)
//    --gens=3            policy updates ("generations") per config
//    --repeat=1          repeats per config; the fastest is reported in detail
//    --only=a,b          run only these config labels
//    --list              print the config labels and exit
//    --json=<path>       write the raw results
//    --headed            run with a visible browser
//
//  Requirements:
//    · playwright + a chromium build (npx playwright install chromium)
//    · three.js reachable. The page's three.js re-exports a CDN URL; if
//      node_modules/three/build/three.module.js exists it is served in its
//      place, so an offline box only needs:  npm i three@0.128.0
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

// playwright may only be installed globally (npm i -g playwright); fall back to
// the global root before giving up.
const chromium = await (async () => {
  try { return (await import('playwright')).chromium; } catch { /* not installed locally */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const req = createRequire(path.join(root, 'noop.js'));
    return req('playwright').chromium;
  } catch {
    console.error('playwright not found — install it with:  npm i -D playwright');
    process.exit(1);
  }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');          // repo root
const THREE_LOCAL = path.join(ROOT, 'node_modules/three/build/three.module.js');

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const TRACK = argv.track || 'jeff';
const GENS  = Number(argv.gens || 3);
const ONLY  = argv.only ? String(argv.only).split(',').map(s => s.trim()) : null;
const REPEAT = Number(argv.repeat || 1);

// ── Config sweep ────────────────────────────────────────────────────────────
//  Every run is the same map and the same generation count; one axis moves at
//  a time so a difference in the totals is attributable.
const CONFIGS = [
  { label: 'js-1thread',
    note: 'pure-JS gradients, single grad worker — the slow-path floor',
    cfg: { backend: 'js', threads: 1 } },

  { label: 'wasm-auto',
    note: 'WASM SIMD kernel, auto thread count (cores−2)',
    cfg: { backend: 'auto', threads: 0 } },

  { label: 'wasm-1thread',
    note: 'WASM SIMD kernel pinned to one grad worker — isolates threading',
    cfg: { backend: 'auto', threads: 1 } },

  { label: 'wasm-4thread',
    note: 'WASM SIMD kernel, 4 grad workers (oversubscribed on 4 cores)',
    cfg: { backend: 'auto', threads: 4 } },

  { label: 'bignet-256x2',
    note: '256-wide, 2 hidden layers — same data, ~16× the weights',
    cfg: { backend: 'auto', threads: 0, hiddenSize: 256, hiddenLayers: 2 } },

  { label: 'net-256x1',
    note: 'width sweep: 256-wide, 1 hidden layer',
    cfg: { backend: 'auto', threads: 0, hiddenSize: 256, hiddenLayers: 1 } },

  { label: 'net-128x2',
    note: 'width sweep: 128-wide, 2 hidden layers',
    cfg: { backend: 'auto', threads: 0, hiddenSize: 128, hiddenLayers: 2 } },

  { label: 'envs32-h128',
    note: '32 envs × horizon 128 — 4× the physics for the same batch size',
    cfg: { backend: 'auto', threads: 0, numEnvs: 32, horizon: 128 } },

  { label: 'mods-mirror-repair',
    note: 'mirror augmentation + neuron repair + 10% defect weights',
    cfg: { backend: 'auto', threads: 0, mirror: true, neuronRepair: true, failRate: 0.10 } },

  { label: 'minibatch-1024',
    note: 'minibatch 1024 — same samples, ¼ the minibatches (and ¼ the dispatches)',
    cfg: { backend: 'auto', threads: 0, minibatch: 1024 } },

  { label: 'minibatch-64',
    note: 'minibatch 64 — same samples, 4× the minibatches (and 4× the dispatches)',
    cfg: { backend: 'auto', threads: 0, minibatch: 64 } },

  { label: 'gru-recurrent',
    note: 'recurrent GRU policy/critic with truncated BPTT',
    cfg: { backend: 'auto', threads: 0, recurrent: true, bpttLen: 32 } },

  { label: 'gpu-tfjs',
    note: 'TF.js WebGL backend (software GL in headless — not GPU-representative)',
    cfg: { backend: 'gpu', threads: 0 } },

  { label: 'wasm-auto-noperf',
    note: 'wasm-auto with the profiler OFF — prices the instrumentation',
    cfg: { backend: 'auto', threads: 0 }, perf: false },
];

if (argv.list) {
  for (const c of CONFIGS) console.log(`${c.label.padEnd(20)} ${c.note}`);
  process.exit(0);
}

// ── Static server ───────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function serve(root) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end('not found: ' + rel); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ── Reporting helpers ───────────────────────────────────────────────────────
const ms = v => (v >= 1000 ? (v / 1000).toFixed(2) + ' s' : v.toFixed(1) + ' ms');
const pct = (v, t) => t > 0 ? (100 * v / t).toFixed(1).padStart(5) + '%' : '    —';

// Phases as reported by the worker profiler. `blocked` phases are awaits: the
// sim thread is NOT running them, other workers are, so they must not be added
// to this thread's CPU total.
const PHASES = [
  ['roll.obs',       'rollout · observations (raycasts, probes)'],
  ['roll.policy',    'rollout · policy+critic forward, sampling'],
  ['roll.phys',      'rollout · car physics'],
  ['roll.reward',    'rollout · reward, arc position, termination'],
  ['roll.commit',    'rollout · transition commit (buffers)'],
  ['roll.other',     'rollout · loop overhead not covered above'],
  ['upd.gae',        'update · batch flush + GAE'],
  ['upd.norm',       'update · advantage/value normalisation'],
  ['upd.shuffle',    'update · minibatch shuffle'],
  ['upd.pack',       'update · minibatch packing/transfer'],
  ['upd.gradlocal',  'update · gradients on this thread'],
  ['upd.reduce',     'update · gradient reduce'],
  ['upd.adam',       'update · Adam step'],
  ['upd.kl',         'update · KL early-stop estimate'],
  ['upd.post',       'update · best-snapshot, repair, defect refresh'],
  ['snapshot',       'frame snapshot + postMessage'],
];
const BLOCKED = [
  ['upd.gradwait',   'gradient workers (off-thread, wall)'],
  ['upd.gpu',        'TF.js GPU round-trip (off-thread, wall)'],
];

// Fold the per-generation profiler windows into one total per phase.
function foldPhases(gens) {
  const ms_ = Object.create(null), n = Object.create(null);
  for (const g of gens) {
    for (const k of Object.keys(g.ms)) ms_[k] = (ms_[k] || 0) + g.ms[k];
    for (const k of Object.keys(g.n))  n[k]  = (n[k]  || 0) + g.n[k];
  }
  // Derive the rollout remainder: the step loop minus everything measured
  // inside it (loop bookkeeping, useTrack, the batch-full check, GC).
  const inner = ['roll.obs', 'roll.policy', 'roll.phys', 'roll.reward', 'roll.commit']
    .reduce((s, k) => s + (ms_[k] || 0), 0);
  if (ms_['roll.step'] !== undefined) ms_['roll.other'] = Math.max(0, ms_['roll.step'] - inner);
  return { ms: ms_, n };
}

function printRun(run) {
  const t = run.total;
  const g = run.generations;
  const cfg = run.config;
  console.log(`\n── ${run.label} ${'─'.repeat(Math.max(0, 58 - run.label.length))}`);
  console.log(`   ${run.note}`);
  const r = run.ready || {};
  const backend = t.gpuState === 'ready' ? 'GPU (tf.js WebGL)'
                : cfg.backend === 'js'   ? 'JS (wasm kernel forced off)'
                : t.wasm                 ? 'WASM SIMD' : 'JS (wasm unavailable)';
  console.log(`   backend ${backend} · grad workers ${t.gradThreads}` +
              ` · obs ${r.obsDim} · actor ${(r.actorSizes || []).join('-')}` +
              ` · ${cfg.numEnvs} envs × horizon ${cfg.horizon}` +
              (t.wasmErr ? ` · wasm error: ${t.wasmErr}` : '') +
              (t.gpuInfo ? ` · ${t.gpuInfo}` : ''));
  // Effective speed multiplier: sim-seconds simulated per wall second, against
  // the speedMult the config asked for.
  const simSec = t.totalSteps / cfg.numEnvs / 60;
  const effX   = simSec / (t.wallMs / 1000);
  console.log(`   ${run.gens} generations in ${ms(t.wallMs)}  (${ms(t.wallMs / run.gens)}/generation)` +
              ` · ${t.totalSteps.toLocaleString()} physics steps` +
              ` · ${(t.totalSteps / (t.wallMs / 1000) / 1000).toFixed(1)}k steps/s` +
              ` · ${t.episodes} episodes`);
  console.log(`   speed: ${effX.toFixed(0)}× real-time achieved of ${cfg.speedMult}× requested` +
              ` (${(100 * effX / cfg.speedMult).toFixed(0)}% — the sim is compute-bound below that)`);
  console.log('   per generation: ' + g.map(x => ms(x.wallMs)).join(' · '));

  if (!run.perf) { console.log('   (profiler off — wall-clock only)'); return; }

  const { ms: M, n: N } = foldPhases(g);
  const wall = t.wallMs;
  const rollout = M['roll.step'] || 0;
  const overlap = M['roll.step.overlap'] || 0;
  const blocked = BLOCKED.reduce((s, [k]) => s + (M[k] || 0), 0);
  const trueBlocked = Math.max(0, blocked - overlap);  // awaits with nothing else to run

  console.log('   phase                                          time      %wall   calls');
  const rows = PHASES.filter(([k]) => (M[k] || 0) > 0.05)
    .sort((a, b) => (M[b[0]] || 0) - (M[a[0]] || 0));
  for (const [k, desc] of rows) {
    console.log(`   ${desc.padEnd(44)} ${ms(M[k]).padStart(9)}  ${pct(M[k], wall)}  ` +
                `${k === 'roll.other' ? '' : (N[k] || 0).toLocaleString().padStart(9)}`);
  }
  const cpu = rows.reduce((s, [k]) => s + M[k], 0);
  console.log(`   ${'── sim-thread CPU (sum of the above)'.padEnd(44)} ${ms(cpu).padStart(9)}  ${pct(cpu, wall)}`);
  for (const [k, desc] of BLOCKED) {
    if (!(M[k] > 0.05)) continue;
    console.log(`   ${desc.padEnd(44)} ${ms(M[k]).padStart(9)}  ${pct(M[k], wall)}  ` +
                `${(N[k] || 0).toLocaleString().padStart(9)}`);
  }
  if (blocked > 0.05) {
    console.log(`   ${'  of which the sim thread kept stepping'.padEnd(44)} ${ms(overlap).padStart(9)}  ${pct(overlap, wall)}`);
    console.log(`   ${'  of which this thread was idle-blocked'.padEnd(44)} ${ms(trueBlocked).padStart(9)}  ${pct(trueBlocked, wall)}`);
  }
  const unacc = wall - cpu - trueBlocked;
  console.log(`   ${'unaccounted (timer slack, GC, message pump)'.padEnd(44)} ${ms(unacc).padStart(9)}  ${pct(unacc, wall)}`);
  console.log(`   rollout loop total ${ms(rollout)} · update span ${ms(M['upd.wall'] || 0)}` +
              ` (spans overlap — an update awaits while the sim keeps stepping)`);
  if (N['upd.epochs']) {
    console.log(`   epochs run ${N['upd.epochs']}/${cfg.epochs * run.gens} (KL early stop)` +
                ` · minibatches ${N['upd.minibatches']} · grad tasks ${N['upd.tasks'] || 0}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
const { server, port } = await serve(ROOT);
const hasLocalThree = fs.existsSync(THREE_LOCAL);
console.log(`serving ${ROOT} on http://127.0.0.1:${port}`);
console.log(hasLocalThree
  ? `three.js: serving ${path.relative(ROOT, THREE_LOCAL)} in place of the CDN module`
  : 'three.js: loading from the CDN (no local node_modules/three)');

const browser = await chromium.launch({
  headless: !argv.headed,
  // Software GL so the TF.js WebGL backend at least initialises headless. It
  // is a CPU rasteriser — treat the gpu-tfjs numbers as "does it work", not
  // as what a real GPU would do.
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext();

if (hasLocalThree) {
  const body = fs.readFileSync(THREE_LOCAL, 'utf8');
  await context.route('**/three.module.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body }));
}

const page = await context.newPage();
page.on('pageerror', e => console.error('  [page error]', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('  [console]', m.text()); });

await page.goto(`http://127.0.0.1:${port}/games/ai-trainer/test/perf-bench.html`);
await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 60000 });
const meta = await page.evaluate(t => window.__bench.prepare(t), TRACK);

const cpus = await page.evaluate(() => navigator.hardwareConcurrency);
console.log(`\ntrack "${meta.name}" — ${meta.centerlinePts} centerline points, ` +
            `${meta.wallSegs} wall segments, road width ${meta.roadWidth} m, ` +
            `${meta.laps} laps, gravel runoff ${meta.gravel ? 'yes' : 'no'}`);
console.log(`browser reports ${cpus} logical cores · ${GENS} generations per config`);

const runs = [];
for (const c of CONFIGS) {
  if (ONLY && !ONLY.includes(c.label)) continue;
  process.stdout.write(`\nrunning ${c.label} …`);
  const reps = [];
  let failed = null;
  for (let rep = 0; rep < REPEAT; rep++) {
    const t0 = Date.now();
    try {
      const res = await page.evaluate(o => window.__bench.run(o), {
        label: c.label, cfg: c.cfg, gens: GENS, perf: c.perf !== false,
      });
      process.stdout.write(` ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      reps.push(res);
    } catch (err) {
      process.stdout.write(' FAILED');
      failed = String(err.message || err);
      break;
    }
  }
  if (!reps.length) {
    console.error('\n  ' + (failed || 'no result').split('\n')[0]);
    runs.push({ label: c.label, note: c.note, failed });
    continue;
  }
  // Report the fastest repeat in detail (least polluted by background noise)
  // and keep every repeat's wall clock for the spread.
  const best = reps.reduce((a, b) => (a.total.wallMs <= b.total.wallMs ? a : b));
  runs.push({
    ...best, note: c.note, perf: c.perf !== false,
    repeats: reps.map(r => r.total.wallMs), reps: reps.length,
  });
}

console.log('\n\n══════════════════════════ RESULTS ══════════════════════════');
for (const r of runs) {
  if (r.failed) { console.log(`\n── ${r.label} — FAILED: ${r.failed}`); continue; }
  printRun(r);
}

// Cross-config summary — fastest repeat, with the spread across repeats.
console.log('\n\n── summary: seconds per generation (best of ' + REPEAT + ') ──────────────');
for (const r of runs) {
  if (r.failed) { console.log(`   ${r.label.padEnd(20)} failed`); continue; }
  const perGen = r.total.wallMs / r.gens / 1000;
  const spread = r.repeats && r.repeats.length > 1
    ? `  [repeats ${r.repeats.map(v => (v / r.gens / 1000).toFixed(2)).join(', ')}]` : '';
  console.log(`   ${r.label.padEnd(20)} ${perGen.toFixed(2).padStart(7)} s/gen` +
              ` · ${(r.total.totalSteps / (r.total.wallMs / 1000) / 1000).toFixed(1).padStart(6)}k steps/s` + spread);
}

if (argv.json) {
  fs.writeFileSync(argv.json, JSON.stringify({ track: meta, cpus, gens: GENS, runs }, null, 2));
  console.log(`\nraw results → ${argv.json}`);
}

await browser.close();
server.close();
