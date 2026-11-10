/* grades and lips of the Port Calder ramps */
GAME.enterFree(); GAME.story.mode = 'free'; await wait(1500);
const W = GAME.world, T = W.terrain, H = W.route('hwy'), ids = (self.RAMPS || T.routes.filter(r => r.def.ramp).map(r => r.id));
const out = [];
for (const id of ids) {
  const R = W.route(id), n = R.count;
  const e0 = H.project(R.x[0], R.z[0], 0, -1).dist < H.project(R.x[n], R.z[n], 0, -1).dist ? 0 : n; // merge end
  const land = e0 ? 0 : n, dir = e0 ? -1 : 1;
  let mg = 0; for (let i = 1; i <= n; i++) mg = Math.max(mg, Math.abs(R.y[i] - R.y[i-1]) / R.step);
  const B = T.bridges.filter(b => b.route === id).map(b => [b.i0, b.i1]);
  out.push({ id, n, grade: mg.toFixed(3), spans: B, land: [Math.round(R.x[land]), Math.round(R.z[land])] });
  if (self.NOSHOT) continue;
  for (const [nm, i] of [['merge', e0 + dir * 25], ['land', land - dir * 30]]) {
    const k = Math.max(0, Math.min(n, i)), [dx, dz] = R.dirAt(k * R.step), x = R.x[k], z = R.z[k], y = R.y[k];
    await shot(`${id}-${nm}`, [x - dx * 30 - dz * 18, y + 9, z - dz * 30 + dx * 18], [x, y, z]);
  }
}
return out;
