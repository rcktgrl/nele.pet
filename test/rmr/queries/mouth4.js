/* drive the boat through the whole river tunnel both ways (need 814/814) */
GAME.enterFree(); GAME.story.mode = 'free'; GAME.spawnPlayer('boat'); await wait(1500); const U = RIVER.tunnel, P = GAME.player, T = GAME.world.terrain, out = [];
const near = () => U.pts.reduce((bi, p, i) => (Math.hypot(p[0] - P.pos.x, p[1] - P.pos.z) < Math.hypot(U.pts[bi][0] - P.pos.x, U.pts[bi][1] - P.pos.z) ? i : bi), 0);
for (const [name, i0, dir] of [['A', 0, 1], ['B', U.pts.length - 1, -1]]) {
  const a = U.pts[i0], b = U.pts[i0 + dir * 3], yaw = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
  P.reset(a[0], a[1], yaw, T, 0); P.boatYaw = yaw; await wait(400);
  const qi = new THREE.Quaternion(), l = new THREE.Vector3();
  GAME.input.poll = () => { const j = near(), t = U.pts[Math.max(0, Math.min(U.pts.length - 1, j + dir * 8))]; l.set(t[0] - P.pos.x, 0, t[1] - P.pos.z).applyQuaternion(qi.copy(P.q).invert()); const ang = Math.atan2(l.x, -l.z); return { throttle: 0.8, brake: 0, steer: Math.max(-1, Math.min(1, ang * 2.5)), handbrake: 0, boost: 0 }; };
  let maxS = 0, minK = 1e9; const t0 = performance.now(); let k = 0;
  while (performance.now() - t0 < 30000) { await wait(250); const j = near(); const s = dir > 0 ? U.s[j] : U.length - U.s[j]; maxS = Math.max(maxS, s); if (s > 100 && s < 700) minK = Math.min(minK, P.speedKmh); if (k++ === 20) await shot('m' + name); }
  out.push(`${name}: got ${maxS.toFixed(0)} m of ${U.length.toFixed(0)} min kmh inside ${minK.toFixed(0)} end kmh ${P.speedKmh.toFixed(0)}`);
  delete GAME.input.poll;
}
return out.join('\n');
