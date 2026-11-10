/* Red Mesa Rally without a browser: loads the game's simulation files (map, roads, cars, world, race AI)
   into a Node sandbox. No three.js, no DOM, so it starts in seconds where the full game needs a minute.
     import { loadSim } from './sim.mjs';
     const sim = loadSim(); const W = sim.run('new World().buildSync()');   // sim.run(code) evaluates among the game's globals
   Files that draw or touch the page (render/, game/, audio/, net/, story/, models, map image) are left out. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { GAME_DIR, scriptList } from './lib.mjs';

const BROWSER_ONLY = /\b(THREE\.|document\.|window\.|localStorage|requestAnimationFrame|Game\.prototype)/;
const SIM_DIRS = /^js\/(core|map|roads|cars|world|race)\//;

export function simFiles() {
  return scriptList().filter((f) => SIM_DIRS.test(f) && !BROWSER_ONLY.test(readFileSync(join(GAME_DIR, f), 'utf8')));
}

/* All files are joined into one function body, so their top-level names are that function's locals, as fast
   as in the browser (a vm context would make every global lookup slow: the world build took 90 s that way). */
export function loadSim() {
  const files = simFiles();
  const src = files.map((f) => readFileSync(join(GAME_DIR, f), 'utf8') + `\n//# sourceURL=${f}\n`).join('\n');
  const run = new Function('THREE_MATH', `'use strict';\n${src}\ncoreInit(THREE_MATH);\nreturn (code) => eval(code);`)(createRequire(import.meta.url)('three'));
  return { files, run };
}
