/* terrain poking through bridge and viaduct decks */
const W = GAME.world, T = W.terrain, H = T.h, Nx = T.Nx, c = T.cell;
// height of the terrain mesh at LOD step st (chunks of 64 cells, vertices every st cells from the chunk origin; triangles a,cc,b / b,cc,d)
const lodH = (x, z, st) => {
  const fx = (x - T.x0) / c, fz = (z - T.z0) / c, ix = Math.floor(fx / st) * st, iz = Math.floor(fz / st) * st;
  const u = (fx - ix) / st, v = (fz - iz) / st, h = (i, j) => H[Math.min(T.Nz-1, j) * Nx + Math.min(Nx-1, i)];
  const a = h(ix, iz), b = h(ix + st, iz), cc = h(ix, iz + st), d = h(ix + st, iz + st);
  return u + v <= 1 ? a + (b - a) * u + (cc - a) * v : d + (cc - d) * (1 - u) + (b - d) * (1 - v);
};
const res = {};
for (const st of [1, 2, 4]) {
  let n = 0, worst = [0], tot = 0;
  for (const B of T.bridges) { const R = W.route(B.route); for (let i = B.i0; i <= B.i1; i++) { const [dx, dz] = R.dirAt(i * R.step); for (const l of [-B.width/2, 0, B.width/2]) {
    const x = R.x[i] - dz * l, z = R.z[i] + dx * l, p = lodH(x, z, st) - R.y[i]; tot++;
    if (p > 0.02) { n++; if (p > worst[0]) worst = [p.toFixed(2), B.route, Math.round(x), Math.round(z)]; } } } }
  res['step' + st] = { pierced: n, of: tot, worst };
}
return res;
