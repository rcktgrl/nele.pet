/* metro station halls */
self.ONLY = [3, 0]; self.SHOTS = false;
GAME.enterFree(); GAME.story.mode='free'; GAME.spawnPlayer('super'); await wait(1500);
const W = GAME.world, T = W.terrain, g = GAME.gfx, P = GAME.player, out = [];
const only = self.ONLY || [0, 1, 2, 3, 4, 5, 6, 7];
for (const k of only) { const sp = T.metro.spurs[k];
  if (self.SHOTS !== false) {
    const cam = [sp.x - sp.dx * 34 - sp.dz * 14, CITY.y + 9, sp.z - sp.dz * 34 + sp.dx * 14]; g.camera.position.set(...cam); for (let i = 0; i < 20; i++) g.updateTerrain(g.camera.position, 4);
    await shot(`h${k}a`, cam, [sp.x + sp.dx * 10, CITY.y + 3, sp.z + sp.dz * 10]);
    const top = [sp.x + sp.dx * 25 + sp.dz * 45, CITY.y + 45, sp.z + sp.dz * 25 - sp.dx * 45]; await shot(`h${k}b`, top, [sp.x + sp.dx * 25, CITY.y, sp.z + sp.dz * 25]);
  }
  // drive in
  P.reset(sp.x - sp.dx * 16, sp.z - sp.dz * 16, Math.atan2(-sp.dx, -sp.dz), T); P.under = false; await wait(400);
  GAME.input.poll = () => { const f = P.forward(new THREE.Vector3()), a = (P.pos.x - sp.x) * sp.dx + (P.pos.z - sp.z) * sp.dz, tx = sp.x + sp.dx * (a + 12), tz = sp.z + sp.dz * (a + 12), ax = tx - P.pos.x, az = tz - P.pos.z, cr = f.x * az - f.z * ax;
    return { throttle: P.vel.length() < 12 ? 1 : 0, brake: 0, steer: Math.max(-1, Math.min(1, cr / Math.hypot(ax, az) * 3)), handbrake: 0, boost: 0 }; };
  const t0 = performance.now(), log = []; let shotDone = false;
  while (performance.now() - t0 < 9000) { await wait(500); const a = (P.pos.x - sp.x) * sp.dx + (P.pos.z - sp.z) * sp.dz;
    log.push([Math.round(a), P.pos.y.toFixed(1), P.under ? 'U' : '-']); if (!shotDone && a > 20 && self.SHOTS !== false) { shotDone = true; await shot(`h${k}c`); } if (a > sp.L - 4) break; }
  delete GAME.input.poll;
  out.push([k, sp.name, 'L', sp.L, log.map((q) => q.join('/')).join(' ')]);
}
out.push(["signalsInHalls", GAME.world.city.streets.signals.filter((l) => inMetroHall(l.x, l.z)).length]); return out;
