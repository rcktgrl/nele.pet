/* autopilot drive through the road tunnels */
self.TUNS = [1, 0];
GAME.enterFree(); GAME.story.mode='free'; GAME.spawnPlayer('super'); await wait(1500);
const W = GAME.world, T = W.terrain, P = GAME.player, cam = GAME.gfx.camera;
W.setTunnelGate(false);
const res = [];
for (const n of (self.TUNS || [0])) {
  const tun = W.tunnelSpans()[n], R = tun.R, P0 = tun.portals[0];
  const s0 = P0.s - 40, p = R.posAt(s0, {}), [dx, dz] = R.dirAt(s0);
  P.reset(p.x, p.z, Math.atan2(-dx, -dz), T); P.invuln = 0; await wait(400);
  // autopilot: steer toward a point 15 m ahead along the route
  let sNow = s0;
  GAME.input.poll = () => {
    let best = 1e9; for (let s = Math.max(0, sNow - 10); s < sNow + 30; s += 1) { const q = R.posAt(s, {}), d = Math.hypot(q.x - P.pos.x, q.z - P.pos.z); if (d < best) { best = d; sNow = s; } }
    const t = R.posAt(sNow + 15, {}), f = P.forward(new THREE.Vector3());
    const ax = t.x - P.pos.x, az = t.z - P.pos.z, cr = f.x * az - f.z * ax;
    const v = P.vel.length();
    return { throttle: v < 25 ? 1 : 0, brake: 0, steer: Math.max(-1, Math.min(1, cr / Math.hypot(ax, az) * 3)), handbrake: 0, boost: 0 };
  };
  const t0 = performance.now(); let k = 0, shotAt = [];
  while (performance.now() - t0 < 25000 && sNow < tun.portals[1].s + 30) { await wait(250);
    const q = R.posAt(sNow, {}), bf = T.probe(P.pos.y + 1, () => T.boreFloor(P.pos.x, P.pos.z));
    const surf = W.surface(P.pos.x, P.pos.z, P.pos.y);
    if ([5, 7, 9].includes(k)) { res.push(["SHOT", n, k, Math.round(sNow), "i0s", tun.i0 * R.step, "i1s", tun.i1 * R.step, "boreAt", R.bore ? R.bore[Math.round(sNow / R.step)] : "-", "nat-y", (naturalHeight(P.pos.x, P.pos.z) - P.pos.y).toFixed(1), "T.h", (T.heightGrid(T.h, P.pos.x, P.pos.z) - P.pos.y).toFixed(1), "gate", W.tunnelGatePose().s, "car", P.pos.x.toFixed(0), P.pos.z.toFixed(0), "cam", cam.position.x.toFixed(0), cam.position.y.toFixed(1), cam.position.z.toFixed(0), "t", GAME.time ?? "-"]); await shot(`d${n}-${k}`); }
    if (k++ % 4 === 0) res.push([n, Math.round(sNow), 'carY', P.pos.y.toFixed(2), 'routeY', q.y.toFixed(2), 'bore', bf === null ? '-' : bf.toFixed(2), 'off', Math.hypot(q.x - P.pos.x, q.z - P.pos.z).toFixed(1), 'kmh', Math.round(P.vel.length() * 3.6), 'surf', surf && (surf.kind || surf.name || JSON.stringify(surf).slice(0, 40)), 'camY', cam.position.y.toFixed(1)]);
  }
  res.push([n, 'END s', Math.round(sNow), 'of', Math.round(tun.portals[1].s)]);
  delete GAME.input.poll;
}
return res;
