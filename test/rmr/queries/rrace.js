/* an AI river race */
GAME.enterFree(); GAME.story.mode = 'free'; await wait(1000);
const ev = EVENTS.find((e) => e.id === 'river'); GAME.startEvent(ev, 'boat'); await wait(500);
const r = GAME.race, resets = new Map(), wrecks = new Map();
for (const a of GAME.ai) { const c = a.car, f = c.reset.bind(c); resets.set(c, 0); c.reset = (...x) => { resets.set(c, resets.get(c) + 1); return f(...x); }; const w = c.wreck.bind(c); wrecks.set(c, []); c.wreck = (why, T) => { wrecks.get(c).push(why); return w(why, T); }; }
GAME.input.poll = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 });
const t0 = performance.now(), log = []; let shotN = 0, top = 0;
while (performance.now() - t0 < 150000) { await wait(1000); for (const a of GAME.ai) top = Math.max(top, a.car.speedKmh);
  if (GAME.ai.every((a) => r.prog.get(a.car).finished)) break;
  if (((performance.now() - t0) / 1000 | 0) % 30 === 0) log.push(((performance.now() - t0) / 1000 | 0) + 's ' + GAME.ai.map((a) => (r.prog.get(a.car).s | 0) + (r.prog.get(a.car).finished ? 'F' : '')).join(','));
  if (shotN < 2 && performance.now() - t0 > 40000 + shotN * 25000) { const c = GAME.ai[0].car; await shot('rr' + shotN++, [c.pos.x + 8, c.pos.y + 4, c.pos.z + 8], [c.pos.x, c.pos.y, c.pos.z]); } }
delete GAME.input.poll;
return [`len ${r.route.length | 0} top ${top | 0}`, ...log, ...GAME.ai.map((a) => { const p = r.prog.get(a.car); return `${a.car.spec.id} ${p.finished ? 'fin ' + p.time.toFixed(1) : 'at ' + (p.s | 0)} resets ${resets.get(a.car) - 0} wrecks ${wrecks.get(a.car).join('/')}`; })].join('\n');
