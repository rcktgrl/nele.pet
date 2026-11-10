/* crash test: spin-outs */
GAME.enterFree(); GAME.story.mode='free'; GAME.spawnPlayer(self.CAR || 'super'); await wait(1500);
const W = GAME.world, T = W.terrain, S = W.scatter, P = GAME.player;
P.spec = Object.assign({}, P.spec, { tough: 1e9 });
// a flat bit of desert, a long wall across it
const x0 = 760, z0 = 380, zw = z0 - 30;
for (const kind of ['building', 'rail']) { const o = S.addSegment(x0 - 200, zw + (kind === 'rail' ? 0 : 0), x0 + 200, zw, 999, kind); o.r = kind === 'rail' ? 0.35 : 0.4; o._test = kind; o.off = true; }
const segs = []; for (let x = x0 - 200; x <= x0 + 200; x += 8) for (const o of S.near(x, zw) || []) if (o._test && !segs.includes(o)) segs.push(o);
const res = [];
for (const kind of ['building', 'rail']) for (const ang of [10, 30, 60, 85]) for (const v of [30, 55]) {
  for (const o of segs) o.off = o._test !== kind;
  const yaw = ang * Math.PI / 180; // 0 = straight at the wall (heading -z)
  P.reset(x0, z0, yaw, T); P.invuln = 0; await wait(300);
  const f = P.forward(new THREE.Vector3()); P.vel.copy(f).multiplyScalar(v); P.vel.y = 0; P.w.set(0, 0, 0);
  for (const wh of P.wheels) wh.omega = v / P.spec.wheels.r;
  let mx = 0, settle = null, t0 = performance.now(), hit = null, yaw0 = P.yaw(), turns = 0, last = yaw0;
  while (performance.now() - t0 < 3500) { await new Promise(r => requestAnimationFrame(r));
    const t = (performance.now() - t0) / 1000; if (hit === null && P.pos.z < zw + 3.2) hit = t;
    const wy = Math.abs(P.w.y); if (hit !== null) { mx = Math.max(mx, wy); if (wy > 1 ) settle = t - hit; }
    let y = P.yaw(), d = y - last; d = Math.atan2(Math.sin(d), Math.cos(d)); turns += d; last = y; }
  res.push([kind, ang, v, 'maxW', mx.toFixed(2), 'spinTime', settle === null ? 0 : settle.toFixed(2), 'yawTurned°', Math.round(turns * 180 / Math.PI), 'kmh', Math.round(P.vel.length() * 3.6)]);
}
for (const o of segs) o.off = true;
return res;
