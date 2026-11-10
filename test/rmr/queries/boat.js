/* the boat: floating, speed, steering */
GAME.enterFree(); GAME.story.mode='free'; await wait(1500);
const g = GAME.gfx, U = RIVER.tunnel, T = GAME.world.terrain;
const i0 = U.s.findIndex((s) => s >= U.open[0]), i1 = U.s.findIndex((s) => s >= U.open[1]);
const out = [U.hw, U.bed, U.ceil, U.under, WATER_Y, i0, i1, U.pts[i0], U.pts[i1]];
for (const [n, i, dir] of [['a', i0, -1], ['b', i1, 1]]) {
  const [x, z] = U.pts[i], o = U.pts[Math.max(0, Math.min(U.pts.length - 1, i + dir * 3))], dx = o[0] - x, dz = o[1] - z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  const far = [x + ux * 40, WATER_Y + 4, z + uz * 40]; g.camera.position.set(...far); for (let k = 0; k < 30; k++) g.updateTerrain(g.camera.position, 4);
  await shot('b' + n + '1', far, [x, WATER_Y + 2, z]);
  const hi = [x + ux * 30 - uz * 25, WATER_Y + 18, z + uz * 30 + ux * 25]; await shot('b' + n + '2', hi, [x, WATER_Y + 2, z]);
  const ins = [x - ux * 20, WATER_Y + 1.5, z - uz * 20]; await shot('b' + n + '3', ins, [x + ux * 20, WATER_Y + 1.5, z + uz * 20]);
  out.push([n, 'rawH', T.rawH(x, z).toFixed(1), 'nat', naturalHeight(x, z).toFixed(1)]);
}
return out;
