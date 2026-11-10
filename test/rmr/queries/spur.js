/* metro station spurs */
GAME.enterFree(); await wait(300);
const W = GAME.world, T = W.terrain, R = T.metro.R, out = [], hw = METRO.rampHw, cover = METRO.cut;
const roadGap = (x, z) => { const gi = T.gi(x, z); return T.rdist[gi] - (T.rhw[gi] || 0); };
const chosen = [], DD = DISTRICT, S0 = DD.stadium;
const bad = (x, z) => (S0 && ((x - S0.x) / (S0.rx + 10)) ** 2 + ((z - S0.z) / (S0.rz + 10)) ** 2 < 1) || DD.parks.some((P) => DD.pip(x, z, P.poly));
for (const st of METRO.stations) {
  const s0 = R.project(st.at[0], st.at[1], 0, -1).s; let best = null;
  for (const side of [-1, 1]) for (let ds = -80; ds <= 80; ds += 5) for (let th = -50; th <= 50; th += 5) for (const L of [66, 72, 80, 90, 100, 115, 130]) {
    if (side > 0 && Math.abs(ds) < METRO.stationLen / 2 + hw + 3) continue; if (side < 0 && Math.abs(ds) > 60) continue;
    const sE = R.wrapS(s0 + ds), E = R.posAt(sE, {}), [dx, dz] = R.dirAt(sE), ox = -dz * side, oz = dx * side; // side -1 outer (left), +1 inner
    const t = th * Math.PI / 180, ux = ox * Math.cos(t) - oz * Math.sin(t), uz = ox * Math.sin(t) + oz * Math.cos(t);
    const mx = E.x + ux * L, mz = E.z + uz * L, sdx = -ux, sdz = -uz; // spur dir: mouth -> loop
    const Pq = (a, l) => [mx + sdx * a - sdz * l, mz + sdz * a + sdx * l];
    let ok = true, minGap = 1e9;
    for (let a = -3; a <= cover + 3 && ok; a += 2) for (let l = -hw - 2.5; l <= hw + 2.5 && ok; l += 1.5) { const [x, z] = Pq(a, l), gi = T.gi(x, z), g = roadGap(x, z);
      minGap = Math.min(minGap, g); if (g < 1.5 || T.rail[gi] > 0 || T.river[gi] || Math.abs(T.h[gi] - CITY.y) > 0.6 || T.metroAt(x, z) === 1 || bad(x, z)) ok = false;
      for (const c of chosen) { const q = (x - c.x) * c.dx + (z - c.z) * c.dz, lq = Math.abs(-(x - c.x) * c.dz + (z - c.z) * c.dx); if (q > -16 && q < c.L && lq < hw + 6) ok = false; } }
    if (!ok) continue;
    for (let a = cover; a < L - 9 && ok; a += 2) for (const l of [-hw, 0, hw]) { const [x, z] = Pq(a, l); if (T.metroAt(x, z) === 1) ok = false; for (const c of chosen) { const q = (x - c.x) * c.dx + (z - c.z) * c.dz, lq = Math.abs(-(x - c.x) * c.dz + (z - c.z) * c.dx); if (q > -4 && q < c.L && lq < hw + 4) ok = false; } }
    if (!ok) continue;
    // a road just in front of the mouth to drive in from
    let apron = 1e9; for (let a = -14; a <= -4; a += 2) for (const l of [-2, 0, 2]) { const [x, z] = Pq(a, l); apron = Math.min(apron, roadGap(x, z)); }
    if (apron > 0.5) continue;
    // the race start for spur 0 sits 16 m out
    const score = (side > 0 ? 12 : 0) + L * 0.6 + Math.abs(th) * 0.4 + Math.abs(ds) * 0.5 + Math.max(0, Math.min(minGap, 20) - 6) * 0.5;
    if (!best || score < best.score) best = { name: st.name, x: +mx.toFixed(1), z: +mz.toFixed(1), dx: +sdx.toFixed(4), dz: +sdz.toFixed(4), L, side, score, ds, th, minGap: +minGap.toFixed(1) };
  }
  out.push(best || { name: st.name, none: true }); if (best) chosen.push(best);
}
return out;
