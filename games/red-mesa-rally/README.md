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
| `js/world/` | the World (physics step) and the trains |
| `js/render/` | three.js rendering: sky, terrain, scenery, effects |
| `js/audio/` | music and sound effects |
| `js/net/` | multiplayer |
| `js/game/` | the Game class (main loop), input, camera, HUD, menus, opening cinematic |

The Game class is defined in `js/game/game.js`; other files add their methods with
`Object.assign(Game.prototype, { ... })`.
