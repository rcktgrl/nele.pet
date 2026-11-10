# Red Mesa Rally

Plain `<script>` files that share one global scope, loaded in order by `index.html`.
A file may use anything declared in an earlier file at load time, and anything at all
inside functions. Add new files to the list in `index.html`.

| Folder | What lives there |
| --- | --- |
| `js/core/` | maths helpers, seeded random, noise |
| `js/map/` | world layout and regions, terrain, Port Calder, scenery props, map image, minimap and big map |
| `js/roads/` | route definitions (every road and track) and civilian traffic |
| `js/cars/` | car specs (`vehicles.js`), car physics (`car.js`), car models (`models.js`) |
| `js/race/` | events list, race logic, AI drivers, starting/ending events and results (`race-flow.js`), online leaderboard |
| `js/story/` | story chapters, unlocks, liveries, challenges, voice lines, story intro |
| `js/world/` | the World (physics step, collisions), its static setup (`world-build.js`) and the trains |
| `js/render/` | three.js rendering, one file per subject: sky and shared helpers (`gfx.js`), terrain, Port Calder (`east-gfx.js`), tunnels, metro, railway, river, scatter, effects |
| `js/audio/` | music and sound effects |
| `js/net/` | multiplayer |
| `js/game/` | the Game class (main loop), spawning, input, camera, HUD, menus and their buttons (`ui.js`), opening cinematic |

The Game class is defined in `js/game/game.js`; other files add their methods with
`Object.assign(Game.prototype, { ... })`.

`CODEMAP.md` lists every file with its functions, classes and methods and their line numbers.
It is generated: run `npm run check:rmr` after changes and commit it.

## Working on it

Run these from the repo root (once: `npm ci`, and `npx playwright install chromium` for the browser ones).

| Command | What it does | Time |
| --- | --- | --- |
| `npm run check:rmr` | Lint (also catches names that exist nowhere, e.g. typos) and refresh `CODEMAP.md` | seconds |
| `npm run test:rmr:world` | Builds the world and drives AI cars in Node, no browser. Prints a fingerprint per part; `-- --save f.json` before a change and `-- --diff f.json` after shows exactly which parts changed | ~35 s |
| `npm run test:rmr` | Smoke test in headless Chromium: loads the game, drives, takes screenshots, fails on any error | ~1 min |
| `npm run rmr:probe -- test/rmr/queries/perf.js` | Runs a small script inside the real game (measure, drive, take pictures). Ready-made ones in `test/rmr/queries/`, each with a one-line description on top; `scene.js` fingerprints everything the renderer built | ~1 min + the query |

The browser tools use the real GPU when there is one and software rendering otherwise (slow, about
2 frames a second), and need no network. Results land in `test-results/`.

For a change that should not alter the game (moving code, tidying): `test:rmr:world` with `--save` / `--diff`
and `queries/scene.js` before and after must match.

Rules of thumb: one subject per file, files under about 30 KB; a new file goes in the list in `index.html`;
methods for `Game`, `Gfx` or `World` go in their own file with `Object.assign(X.prototype, { ... })`;
bump `RMR_VERSION` in `index.html` per release.
