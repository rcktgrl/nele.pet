/* Red Mesa Rally probe: load the real game headless and run a small script inside it.
     npm run rmr:probe -- test/rmr/queries/perf.js [--out test-results/probe] [--software]
   The query file is the body of an async function running in the page, with:
     GAME                      the running game (GAME.world, GAME.gfx, GAME.player, ...)
     wait(ms)                  sleep
     log(...)                  print to this terminal
     shot(name, [cam], [tgt])  save <out>/<name>.png; cam and tgt are [x, y, z] for a fixed camera, else the chase camera
   Whatever the query returns is printed as JSON. Without a GPU (cloud sessions) it falls back to software
   rendering: about 2 frames a second and the game runs in slow motion, so keep drive tests short there. */
/* global GAME */ // the game's own global, read inside page.evaluate
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ROOT, arg, serve, launch, openGame } from './lib.mjs';

const file = process.argv[2];
if (!file || file.startsWith('--')) { console.error('usage: node test/rmr/probe.mjs <query.js> [--out dir] [--software]'); process.exit(2); }
const query = await readFile(file, 'utf8'), OUT = resolve(ROOT, arg('out', 'test-results/probe'));
await mkdir(OUT, { recursive: true });

const site = await serve();
const { browser, page, software, shot } = await launch();
if (software) console.log('(no GPU: software rendering, slow)');
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log(`HTTP ${r.status()}`, r.url()); });
page.on('console', (m) => { if (m.type() === 'error') { if (!/Failed to load resource/.test(m.text())) console.log('CONSOLE', m.text()); } else if (m.text().startsWith('>')) console.log(m.text().slice(1)); });
await page.exposeFunction('__shot', async (name) => { const f = join(OUT, name + '.png'); await shot(f); console.log('shot', f); });

let failed = false;
try {
  await openGame(page, site.base);
  const result = await page.evaluate(async (src) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const log = (...a) => console.log('>' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    let camFix = null; const rig = GAME.rig, orig = rig.update.bind(rig);
    rig.update = (...a) => { if (camFix) { const c = GAME.gfx.camera; c.position.set(...camFix[0]); c.lookAt(...camFix[1]); c.fov = 55; c.updateProjectionMatrix(); } else orig(...a); };
    const shot = async (name, cam, tgt) => { camFix = cam ? [cam, tgt] : null; await wait(cam ? 1200 : 300); await window.__shot(name); camFix = null; };
    return new Function('GAME', 'wait', 'log', 'shot', 'return (async () => {' + src + '\n})()')(GAME, wait, log, shot);
  }, query);
  if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1));
} catch (e) { failed = true; console.log('FAILED', e.message); }
await browser.close(); site.close();
process.exit(failed ? 1 : 0);
