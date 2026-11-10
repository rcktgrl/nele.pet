/* 2D debug map of roads, districts, buildings and lots (fastest layout check) */
GAME.enterFree(); await wait(300);
const T = GAME.world.terrain, C = GAME.world.city;
const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 800; cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999'; document.body.appendChild(cv);
const g = cv.getContext('2d');
const draw = async (name, cx, cz, sc) => { // sc = px per m
  const X = (x) => 640 + (x - cx) * sc, Z = (z) => 400 + (z - cz) * sc;
  const img = g.createImageData(1280, 800);
  for (let py = 0; py < 800; py++) for (let px = 0; px < 1280; px++) {
    const x = cx + (px - 640) / sc, z = cz + (py - 400) / sc, gi = T.gi(x, z), h = T.h[gi];
    let c = h < WATER_Y ? [60, 110, 170] : [150 + h * 1.5, 170 + h, 120 + h];
    const pv = DISTRICT.cell(x, z); if (pv === 1) c = [175, 175, 170]; else if (pv > 0) c = [140, 190, 120];
    if (T.river[gi]) c = [80, 140, 200];
    if (T.lot[gi]) c = [200, 200, 150];
    if (T.rdist[gi] < T.rhw[gi]) c = T.asph[gi] > 0.5 ? [50, 50, 55] : [150, 120, 80];
    if (T.rail[gi] > 0) c = [120, 60, 60];
    if (T.underDeck && T.underDeck[gi]) c = [c[0] * 0.6, c[1] * 0.6, c[2] * 0.9];
    const o = (py * 1280 + px) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const box = (o, col) => { g.save(); g.translate(X(o.x), Z(o.z)); g.rotate(-o.yaw); g.fillStyle = col; g.fillRect(-o.w / 2 * sc, -o.d / 2 * sc, o.w * sc, o.d * sc); g.restore(); };
  for (const o of T.village) if (o.w) box(o, '#a0522d');
  for (const o of C.buildings) box(o, '#333399');
  for (const o of C.lots) box(o, 'rgba(255,255,0,0.5)');
  g.fillStyle = '#063'; for (const t of C.parkTrees) g.fillRect(X(t.x) - 1, Z(t.z) - 1, 3, 3);
  g.strokeStyle = '#f0f'; g.lineWidth = 1.5; for (const d of DISTRICT.districts) { g.beginPath(); d.outline.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.closePath(); g.stroke(); }
  g.fillStyle = '#f00'; for (const c of DISTRICT.culs) { g.beginPath(); g.arc(X(c[0]), Z(c[1]), 4, 0, 7); g.fill(); }
  g.strokeStyle = '#0ff'; for (const sp of metroSpurs()) { g.beginPath(); g.moveTo(X(sp.x), Z(sp.z)); g.lineTo(X(sp.x + sp.dx * 50), Z(sp.z + sp.dz * 50)); g.stroke(); }
  for (const R of T.routes) if (R.def.viaduct || R.def.ramp) { g.strokeStyle = R.def.ramp ? '#fa0' : '#f60'; g.lineWidth = 2; g.beginPath(); for (let i = 0; i <= R.count; i += 4) i ? g.lineTo(X(R.x[i]), Z(R.z[i])) : g.moveTo(X(R.x[i]), Z(R.z[i])); g.stroke(); }
  g.font = '11px sans-serif'; g.lineWidth = 0.5; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.fillStyle = '#000';
  for (let x = Math.ceil((cx - 640 / sc) / 100) * 100; x < cx + 640 / sc; x += 100) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), 800); g.stroke(); g.fillText(x, X(x) + 2, 10); }
  for (let z = Math.ceil((cz - 400 / sc) / 100) * 100; z < cz + 400 / sc; z += 100) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(1280, Z(z)); g.stroke(); g.fillText(z, 2, Z(z) - 2); }
  await window.__save(name, cv.toDataURL('image/png'));
};
window.__draw = draw;
await draw('mv', 3650, -420, 1.6);
await draw('kh', 4680, -1000, 1.25);
await draw('sm', 3560, 420, 1.6);
const T2 = GAME.world.terrain, hi = []; for (const s of DISTRICT.sites) if (s.id === 'school') for (let x = s.x0; x <= s.x1; x += 4) for (let z = s.z0; z <= s.z1; z += 4) if (T2.h[T2.gi(x, z)] > 5.4) hi.push([x, z, +T2.h[T2.gi(x, z)].toFixed(1)]);
log('school high', hi.length, JSON.stringify(hi.slice(0, 12)), JSON.stringify(hi.slice(-6)));
cv.remove();
const C2 = GAME.world.city, M = C2.mall, K = C2.skate, S = K.site, zc = (S.z0 + S.z1) / 2;
await shot('mall-b', [M.x - 60, 5, M.z + 96], [M.x, 9, M.z]);
await shot('mall-c', [M.pylon.x + 60, 7, M.pylon.z + 14], [M.pylon.x, 11, M.pylon.z]);
await shot('skate-n', [S.x0 + 124, 48, S.z0 - 62], [S.x0 + 124, 3, zc + 6]);
await shot('skate-e', [S.x1 - 84, 9, zc - 30], [S.x1 - 30, 4, zc + 4]);
await shot('heights', [4650, 260, -700], [4650, 20, -1060]);
