/* Red Mesa Rally smoke test: load the game in headless Chromium, report errors, take screenshots.
   Usage: npm run test:rmr -- [--car super] [--out test-results/rmr] [--software]
   Works offline (three.js from node_modules) and falls back to software rendering when there is no GPU.
   Exits 1 if the game fails to reach the title screen or logs any error. */
/* global GAME */ // the game's own global, read inside page.evaluate
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ROOT, arg, serve, launch, openGame } from './rmr/lib.mjs';

const OUT = resolve(ROOT, arg('out', 'test-results/rmr'));
const CAR = arg('car', 'super');

const site = await serve(), base = site.base;
const problems = [];
// the real GPU through Vulkan; without one (or with --software) software rendering: a couple of frames a second
const { browser, page, software, shot: saveShot } = await launch();
if (software) console.log('(no GPU: software rendering, slow)');
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('page error: ' + e.message));
page.on('requestfailed', (r) => { if (r.url().startsWith(base)) problems.push('request failed: ' + r.url()); });
page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

await mkdir(OUT, { recursive: true });
const shot = async (name) => { const f = join(OUT, name + '.png'); await saveShot(f); console.log('screenshot', f); };
const step = async (label, fn) => { const t = Date.now(); await fn(); console.log(`ok  ${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`); };

let ok = true;
try {
  await step('load to splash', async () => {
    await openGame(page, base);
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
await browser.close(); site.close();

if (problems.length) { console.log('\nProblems:'); for (const p of problems) console.log('  ' + p); }
console.log(ok && !problems.length ? '\nPASS' : '\nFAIL');
process.exit(ok && !problems.length ? 0 : 1);
