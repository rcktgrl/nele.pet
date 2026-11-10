/* Red Mesa Rally test tooling, shared parts: the script list, a static file server, a headless browser. */
/* global GAME */ // the game's own global, read inside page.evaluate
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const GAME_DIR = join(ROOT, 'games/red-mesa-rally');
export const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
export const flag = (name) => process.argv.includes('--' + name);

/* the game's script files in load order, read from the list in index.html (the one place that names them) */
export function scriptList() {
  const html = readFileSync(join(GAME_DIR, 'index.html'), 'utf8');
  return [...html.matchAll(/^\s*'(js\/[\w./-]+\.js)',?\s*$/gm)].map((m) => m[1]);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

/* the site is static: serve the repo root as the web root. Returns { base, close } */
export async function serve(root = ROOT) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    try {
      const body = await readFile(join(root, path.endsWith('/') ? path + 'index.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/* is there a GPU that headless Chromium can use? (a DRM render node; cloud containers have none) */
export const hasGpu = () => existsSync('/dev/dri/renderD128');

/* Headless Chromium with the game's outside requests handled, so it also runs with no network:
   three.js comes from node_modules (same version as the CDN one in index.html), web fonts are skipped.
   software: true = SwiftShader (a couple of frames a second); default = the real GPU through Vulkan when there is one. */
export async function launch({ software = flag('software') || !hasGpu(), width = 1280, height = 800 } = {}) {
  const { chromium } = await import('playwright');
  const GPU = software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
  // CHROMIUM_PATH: use this browser binary instead of the one "npx playwright install chromium" downloads
  const browser = await chromium.launch({ args: [...GPU, '--autoplay-policy=no-user-gesture-required'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width, height } });
  const three = join(ROOT, 'node_modules/three/build/three.min.js');
  if (existsSync(three)) await page.route(/\/three@[\d.]+\/build\/three\.min\.js/, (r) => r.fulfill({ path: three, contentType: 'text/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  /* a picture of the game canvas. page.screenshot() hangs under SwiftShader, so there the canvas is read back
     inside the page (the game view only, without the HTML HUD on top) */
  const shot = async (file) => {
    if (!software) return page.screenshot({ path: file });
    const url = await page.evaluate(() => { const g = GAME.gfx; g.renderer.render(g.scene, g.camera); return g.renderer.domElement.toDataURL('image/png'); });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  };
  return { browser, page, software, shot };
}

/* open the game and wait until loading is over */
export async function openGame(page, base, timeout = 300000) {
  await page.goto(base + '/games/red-mesa-rally/index.html');
  await page.waitForFunction(() => typeof GAME !== 'undefined' && GAME.state !== 'loading', null, { timeout });
}
