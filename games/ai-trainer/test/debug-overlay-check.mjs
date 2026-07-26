'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  debug-overlay-check.mjs — drive the real trainer page and confirm the debug
//  overlay reports live data rather than placeholders.
//
//  Run:  node games/ai-trainer/test/debug-overlay-check.mjs
//
//  Loads index.html in a browser, picks a map, starts training, opens the
//  overlay and reads it back. A panel that renders but shows "—" everywhere is
//  the failure this is here to catch — as is a backend row quietly saying "js"
//  because a kernel did not load.
//
//  Requirements are the same as perf-bench.mjs (playwright + a local three).
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const chromium = await (async () => {
  try { return (await import('playwright')).chromium; } catch { /* not local */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return createRequire(path.join(root, 'noop.js'))('playwright').chromium;
  } catch {
    console.error('playwright not found — install it with:  npm i -D playwright');
    process.exit(1);
  }
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const THREE_LOCAL = path.join(ROOT, 'node_modules/three/build/three.module.js');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext();
if (fs.existsSync(THREE_LOCAL)) {
  const body = fs.readFileSync(THREE_LOCAL, 'utf8');
  await ctx.route('**/three.module.js', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body }));
}
const page = await ctx.newPage();
page.on('pageerror', e => { console.error('  [page error]', e.message); failures++; });

await page.goto(`http://127.0.0.1:${port}/games/ai-trainer/index.html`);
await page.waitForSelector('#mapCards .map-card', { timeout: 30000 });

console.log('\n1. Start a training run');
await page.click('#mapCards .map-card');
await page.click('#mapStartBtn');            // map menu → config menu
await page.waitForSelector('#configStartBtn', { state: 'visible', timeout: 10000 });
await page.click('#configStartBtn');          // config menu → training
// wait until at least one policy update has completed, so the series have data
await page.waitForFunction(
  () => document.getElementById('hudGen') &&
        parseInt(document.getElementById('hudGen').textContent.replace(/\D/g, ''), 10) >= 1,
  null, { timeout: 180000 });
check('trainer reached its first policy update', true);

console.log('\n2. Overlay reports live data');
await page.keyboard.press('d');
// one profiler window, plus the next update so seconds/update has a reading
await page.waitForFunction(
  () => (document.getElementById('dbgSpu') || {}).textContent !== '—',
  null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(1200);

const ui = await page.evaluate(() => {
  const t = id => (document.getElementById(id) || {}).textContent || '';
  return {
    visible: document.getElementById('dbgWrap').classList.contains('on'),
    spu: t('dbgSpu'), upm: t('dbgUpm'), sps: t('dbgSps'), speed: t('dbgSpeed'),
    ret: t('dbgRet'), loss: t('dbgLoss'), kl: t('dbgKl'), sigma: t('dbgSigma'),
    grad: t('dbgGrad'), infer: t('dbgInfer'), ray: t('dbgRay'), rej: t('dbgRej'),
    phaseRows: document.getElementById('dbgPhaseList').children.length,
  };
});

check('panel is open', ui.visible);
check(`seconds/update is measured (${ui.spu})`, /\d/.test(ui.spu) && ui.spu !== '—');
check(`updates/min is derived (${ui.upm})`, /\d/.test(ui.upm) && ui.upm !== '—');
check(`physics steps/s is measured (${ui.sps})`, /\d/.test(ui.sps) && ui.sps !== '—');
check(`achieved speed is reported (${ui.speed})`, /×/.test(ui.speed));
check(`average return is shown (${ui.ret})`, ui.ret !== '—');
check(`losses are shown (${ui.loss})`, /\d/.test(ui.loss) && ui.loss !== '—');
check(`KL and epochs are shown (${ui.kl})`, /\d/.test(ui.kl) && ui.kl !== '—');
check(`exploration sigma is shown (${ui.sigma})`, /\d/.test(ui.sigma) && ui.sigma !== '—');
check(`phase breakdown has rows (${ui.phaseRows})`, ui.phaseRows > 0);

console.log('\n3. Backends are reported honestly');
check(`gradient backend (${ui.grad})`, /wasm|js|gpu/i.test(ui.grad));
check(`inference is the batched kernel, not the fallback (${ui.infer})`, ui.infer === 'wasm-batch');
check(`ray casting is the kernel, not the fallback (${ui.ray})`, ui.ray === 'wasm');
check(`no updates rejected as non-finite (${ui.rej})`, ui.rej === '0');

console.log('\n4. Toggling off stops the profiler');
await page.keyboard.press('d');
await page.waitForTimeout(300);
const off = await page.evaluate(() => document.getElementById('dbgWrap').classList.contains('on'));
check('panel closes again', !off);

await browser.close();
server.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
