/* Red Mesa Rally world check, no browser needed (a few seconds):
   builds the whole world in Node, drives AI cars over it, and prints a fingerprint of every part.
     npm run test:rmr:world                      print the fingerprint
     npm run test:rmr:world -- --save before.json   keep it (e.g. on main, before a change)
     npm run test:rmr:world -- --diff before.json   list the parts that changed since
   Same code gives the same fingerprint (all randomness is seeded), so a refactor must show "no differences",
   and a map change shows exactly which parts it touched. Exits 1 on a crash or (with --diff) on differences. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSim } from './sim.mjs';
import { arg } from './lib.mjs';

const hash = (h) => h.digest('hex').slice(0, 12);
const isTyped = (v) => ArrayBuffer.isView(v) && !(v instanceof DataView);
const bytes = (v) => hash(createHash('sha1').update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
/* plain data only: numbers rounded so a harmless float wobble does not count, object links cut after a few levels */
function digest(v, depth = 6) {
  const h = createHash('sha1'), seen = new Set();
  const walk = (x, d) => {
    if (typeof x === 'number') return h.update(Number.isFinite(x) ? x.toFixed(4) : String(x));
    if (x === null || typeof x !== 'object') return h.update(typeof x === 'function' ? 'fn' : String(x));
    if (isTyped(x)) return h.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    if (seen.has(x) || d <= 0) return h.update('~');
    seen.add(x);
    if (x instanceof Map || x instanceof Set) x = [...x];
    if (Array.isArray(x)) { h.update('[' + x.length); for (const e of x) walk(e, d - 1); return; }
    for (const k of Object.keys(x).sort()) { if (k[0] === '_') continue; h.update(k); walk(x[k], d - 1); }
  };
  walk(v, depth);
  return hash(h);
}

const t0 = Date.now();
const sim = loadSim();
const W = sim.run('new World().buildSync()');
const T = W.terrain, fp = {};
const put = (name, value, note) => { fp[name] = note === undefined ? value : `${value} (${note})`; };

for (const k of Object.keys(T).sort()) if (isTyped(T[k])) put('terrain.' + k, bytes(T[k]), T[k].length);
put('terrain.bridges', digest(T.bridges), T.bridges.length);
put('routes', digest(T.routes.map((R) => [R.id, R.length, R.pts]), 5), T.routes.length);
for (const k of Object.keys(W.city).sort()) { const v = W.city[k]; if (Array.isArray(v) && k !== 'streets') put('city.' + k, digest(v, 4), v.length); }
for (const k of Object.keys(W.scatter).sort()) { const v = W.scatter[k]; if (Array.isArray(v) || isTyped(v)) put('scatter.' + k, digest(v, 3), v.length); }
for (const k of Object.keys(W.props).sort()) { const v = W.props[k]; if (Array.isArray(v)) put('props.' + k, digest(v, 3), v.length); }
put('stations', digest(W.stations, 3), W.stations.length);
put('crossings', digest(W.crossings, 3), W.crossings.length);

/* physics: AI drivers take three cars along three routes for 40 simulated seconds each (120 steps a second, as in the game) */
const drive = sim.run(`(W, vid, rid, secs) => {
  const R = W.route(rid), car = new Car(VEHICLES[vid], { id: 1 }), [dx, dz] = R.dirAt(50), p = R.posAt(50, {});
  car.reset(p.x, p.z, Math.atan2(-dx, -dz), W.terrain, 0.5);
  W.cars = [car];
  const ai = new AIDriver(car, R, { s: 50, seed: 7 });
  let top = 0;
  for (let i = 0; i < secs * 120; i++) { ai.update(1 / 120, W.cars, 1); W.step(1 / 120); top = Math.max(top, car.speedKmh); }
  W.cars = [];
  return { x: car.pos.x, y: car.pos.y, z: car.pos.z, top, wrecked: !!car.wrecked };
}`);
for (const [vid, rid] of [['rally', 'hwy'], ['buggy', 'coast'], ['super', 'tunnel']]) {
  const r = drive(W, vid, rid, 40);
  put(`drive.${vid}.${rid}`, `${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)}`, `top ${r.top.toFixed(1)} km/h${r.wrecked ? ', wrecked' : ''}`);
}

const width = Math.max(...Object.keys(fp).map((k) => k.length));
for (const [k, v] of Object.entries(fp)) console.log(k.padEnd(width), v);
console.log(`\nworld built and driven in ${((Date.now() - t0) / 1000).toFixed(1)} s (${sim.files.length} files)`);

const save = arg('save'), diff = arg('diff');
if (save) { writeFileSync(save, JSON.stringify(fp, null, 1)); console.log('saved', save); }
if (diff) {
  const old = JSON.parse(readFileSync(diff, 'utf8'));
  const changed = [...new Set([...Object.keys(old), ...Object.keys(fp)])].filter((k) => old[k] !== fp[k]);
  if (!changed.length) console.log(`no differences from ${diff}`);
  else { console.log(`\n${changed.length} part(s) differ from ${diff}:`); for (const k of changed) console.log(`  ${k}: ${old[k] ?? '(new)'} -> ${fp[k] ?? '(gone)'}`); process.exit(1); }
}
