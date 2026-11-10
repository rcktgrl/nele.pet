/* bush placement */
GAME.enterFree(); GAME.story.mode='free'; await wait(1000);
const S = GAME.world.scatter, T = GAME.world.terrain, out = [];
const flat = (p) => { const h = T.height(p.x, p.z); return Math.abs(h - p.y) < 0.5 && Math.abs(T.height(p.x+8,p.z+8) - h) < 1.5; };
const b = S.bushes.find(b => b.x > 300 && flat(b) && S.rocks.some(r => r.s < 2 && Math.hypot(r.x-b.x, r.z-b.z) < 5 && Math.hypot(r.x-b.x, r.z-b.z) > 2));
const g = S.grassBush.find((g, i) => i > 3000 && flat(g) && S.grassBush.filter(o => Math.hypot(o.x-g.x,o.z-g.z) < 10).length > 3);
for (const [n, p] of [['desert', b], ['meadow', g]]) { out.push([n, Math.round(p.x), Math.round(p.z)]); const cy = (x,z,h) => [x, T.height(x,z)+h, z];
  await shot('bush-'+n, cy(p.x+5, p.z+5, 1.8), [p.x, p.y+0.4, p.z]); await shot('bush-'+n+'-far', cy(p.x+30, p.z+30, 6), [p.x, p.y, p.z]); }
return out;
