/* Red Mesa Rally smoke test: load the game in headless Chromium, report errors, take screenshots.
   Usage: npm run test:rmr -- [--car super] [--out test-results/rmr] [--software]
   Exits 1 if the game fails to reach the title screen or logs any error. */
import { chromium } from 'playwright';
/* global GAME */ // the game's own global, read inside page.evaluate
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, arg('out', 'test-results/rmr'));
const CAR = arg('car', 'super');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

/* the site is static: serve the repo root as the web root */
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const problems = [];
// the real GPU through Vulkan; --software for machines without one (slow: a couple of frames a second)
const GPU = process.argv.includes('--software') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...GPU, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('page error: ' + e.message));
page.on('requestfailed', (r) => { if (r.url().startsWith(base)) problems.push('request failed: ' + r.url()); });
page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

await mkdir(OUT, { recursive: true });
const shot = async (name) => { const f = join(OUT, name + '.png'); await page.screenshot({ path: f }); console.log('screenshot', f); };
const step = async (label, fn) => { const t = Date.now(); await fn(); console.log(`ok  ${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`); };

let ok = true;
try {
  await step('load to splash', async () => {
    await page.goto(base + '/games/red-mesa-rally/index.html');
    await page.waitForFunction(() => typeof GAME !== 'undefined' && GAME.state !== 'loading', null, { timeout: 120000 });
  });
  await shot('1-splash');
  await step('title screen and car cards', async () => {
    await page.evaluate(() => GAME.showTitle());
    await page.waitForTimeout(1000);
  });
  await shot('2-title');
  await step(`free roam in ${CAR}`, async () => {
    await page.evaluate((car) => { GAME.enterFree(); GAME.spawnPlayer(car); }, CAR);
    await page.waitForTimeout(3000);
  });
  await shot('3-driving');
  await step('drive forward', async () => {
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(4000); await page.keyboard.up('ArrowUp');
    // game time follows frames (dt is capped), so with --software the car barely moves
    const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(n / 2)); requestAnimationFrame(f); }));
    const s = await page.evaluate(() => ({ state: GAME.state, kmh: Math.round(GAME.player.speedKmh), wrecked: GAME.player.wrecked }));
    s.fps = fps;
    console.log('    ', JSON.stringify(s));
    if (s.state !== 'free') throw new Error('expected free roam, got ' + s.state);
  });
  await shot('4-moving');
} catch (e) {
  ok = false; problems.unshift('FAILED: ' + e.message);
  await shot('failure').catch(() => {});
}
await browser.close(); server.close();

if (problems.length) { console.log('\nProblems:'); for (const p of problems) console.log('  ' + p); }
console.log(ok && !problems.length ? '\nPASS' : '\nFAIL');
process.exit(ok && !problems.length ? 0 : 1);
