/* fast travel to every map pin */
GAME.enterFree(); GAME.story.mode = 'free'; GAME.spawnPlayer('super'); await wait(1500);
const spot = GAME.eventSpots.find((s) => s.ev.id === 'river'), out = ['at ' + JSON.stringify(spot.ev.at)];
const t0 = performance.now(); GAME.travelTo(spot); out.push('travel ms ' + (performance.now() - t0).toFixed(0));
const P = GAME.player; out.push(`pos ${P.pos.x.toFixed(1)},${P.pos.y.toFixed(1)},${P.pos.z.toFixed(1)} boat ${!!P.spec.boat}`);
const f0 = GAME.frameCount || 0, t1 = performance.now(); await wait(1500); out.push('waited ' + (performance.now() - t1).toFixed(0) + ' ms, state ' + GAME.state);
out.push('ground ' + GAME.world.terrain.height(P.pos.x, P.pos.z).toFixed(1) + ' wY ' + GAME.world.terrain.waterY(P.pos.x, P.pos.z).toFixed(1) + ' kmh ' + P.speedKmh.toFixed(0)); await shot('travel'); return out.join(' | ');
