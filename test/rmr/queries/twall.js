/* ram the river tunnel walls in the boat (Y must stay near -1.4) */
GAME.enterFree(); GAME.story.mode = 'free'; GAME.spawnPlayer('boat'); await wait(1500); const U = RIVER.tunnel, P = GAME.player, T = GAME.world.terrain, out = [];
for (const [s0, st] of [[300, 1], [300, -1], [500, 1], [650, -1]]) {
  const i = U.s.findIndex((v) => v >= s0), a = U.pts[i], b = U.pts[i + 3], yaw = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
  P.reset(a[0], a[1], yaw, T, 0); P.boatYaw = yaw; await wait(300); const why = []; const wf = P.wreck.bind(P); P.wreck = (r, T2) => { why.push(r); return wf(r, T2); };
  GAME.input.poll = () => ({ throttle: 1, brake: 0, steer: st * 0.6, handbrake: 0, boost: 0 });
  let maxY = -99, minD = 99; const t0 = performance.now();
  while (performance.now() - t0 < 5000) { await wait(100); maxY = Math.max(maxY, P.pos.y); const d = Math.min(...U.pts.map((p) => Math.hypot(p[0] - P.pos.x, p[1] - P.pos.z))); minD = Math.min(minD, U.hw - d); }
  const d = Math.min(...U.pts.map((p) => Math.hypot(p[0] - P.pos.x, p[1] - P.pos.z)));
  out.push(`s${s0} steer${st}: maxY ${maxY.toFixed(1)} endY ${P.pos.y.toFixed(1)} dist-from-axis ${d.toFixed(1)} kmh ${P.speedKmh.toFixed(0)} wrecks ${why.join('/')}`); P.wreck = wf;
  if (s0 === 500) await shot('tw');
  delete GAME.input.poll;
}
return out.join('\n');
