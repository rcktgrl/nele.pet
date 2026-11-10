/* crash test: driving into walls */
GAME.enterFree(); GAME.story.mode='free'; await wait(1000);
const W = GAME.world, T = W.terrain, S = W.scatter, out = [];
for (const B of T.bridges) { const R = W.route(B.route), k = (B.i0+B.i1)>>1; out.push([B.route, Math.round(R.x[k]), Math.round(R.z[k]), B.wet, B.i0, B.i1]); }
// obstacles whose footprint crosses a road's tarmac on any bridge in the river-mouth area
const hits = [];
for (const B of T.bridges) { const R = W.route(B.route); for (let i = B.i0; i <= B.i1; i += 1) { const x = R.x[i], z = R.z[i], y = R.y[i];
  if (x < 3300 || z < 300) continue;
  const near = S.near(x, z) || [];
  for (const o of near) { let d;
    if (o.type === 0) d = Math.hypot(o.x - x, o.z - z) - o.r; else if (o.type === 2) { const vx=o.bx-o.ax, vz=o.bz-o.az, t=Math.max(0,Math.min(1,((x-o.ax)*vx+(z-o.az)*vz)/(vx*vx+vz*vz||1))); d=Math.hypot(o.ax+vx*t-x,o.az+vz*t-z)-o.r; } else d = Math.max(o.x0 - x, x - o.x1, o.z0 - z, z - o.z1);
    if (d < B.width/2 - 1 && o.top > y && (o.bot === undefined || o.bot < y + 1)) hits.push([B.route, i, Math.round(x), Math.round(z), o.kind, o.type, d.toFixed(1), o.top.toFixed(1), y.toFixed(1)]); } } }
return { bridges: out.filter(b => b[1] > 3300 && b[2] > 300), hits: hits.slice(0, 30) };
