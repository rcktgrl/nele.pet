/* obstacles and land on the river race line */
GAME.enterFree(); GAME.story.mode = 'free'; await wait(800); const W = GAME.world, T = W.terrain, R = W.route('river'), out = [];
const seen = new Set();
for (let s = 0; s < R.length; s += 2) { const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
  for (const l of [-5, 0, 5]) { const x = p.x - dz * l, z = p.z + dx * l, h = T.probe(-1, () => T.height(x, z));
    const near = W.scatter.near(x, z); const ob = near ? near.filter((o) => !o.off && W.obstacleDist(o, x, z) < 1.5 && -0.5 < o.top && (o.bot === undefined || o.bot < 0)): [];
    for (const o of ob) if (!seen.has(o)) { seen.add(o); out.push(`s${s} l${l} h ${h.toFixed(1)} ${o.kind} ${JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean').map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v])))}`); }
    if (h > -2.2) out.push(`s${s} l${l} land h ${h.toFixed(1)}`); } }
return out.slice(0, 80).join('\n') || 'clear';
