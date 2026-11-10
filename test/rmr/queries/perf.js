/* fps, triangles and terrain chunk counts at three spots */
GAME.enterFree(); GAME.story.mode='free'; GAME.spawnPlayer('super'); await wait(2500);
const g = GAME.gfx, P = GAME.player;
const res = [];
for (const [x, z] of [[4300, -350], [2400, 250], [700, 300]]) {
  P.pos.set(x, GAME.world.terrain.height(x, z) + 1, z); await wait(2500);
  const fps = await new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(n / 2)); requestAnimationFrame(f); });
  res.push({ x, z, fps, tris: g.renderer.info.render.triangles, hi: g.chunks.filter(c => c.hi).length, mid: g.chunks.filter(c => c.mid).length });
}
return { q: g.quality, deck: g.chunks.filter(c => c.deck).length, all: g.chunks.length, res };
