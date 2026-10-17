'use strict';
/* Red Mesa Rally · Painted map image for the minimap and the big map */

/* ---------------- Map rendering ---------------- */
const MAP_W = 1280, MAP_H = Math.round(1280 * WORLD.Sz / WORLD.Sx);
const mapX = (x) => (x - WORLD.x0) / WORLD.Sx * MAP_W, mapZ = (z) => (z - WORLD.z0) / WORLD.Sz * MAP_H;
function buildMapImage(world, gfx) {
  const T = world.terrain, c = document.createElement('canvas'); c.width = MAP_W; c.height = MAP_H;
  const g = c.getContext('2d'), img = g.createImageData(MAP_W, MAP_H), n = new THREE.Vector3();
  for (let py = 0; py < MAP_H; py++) for (let px = 0; px < MAP_W; px++) {
    const x = WORLD.x0 + (px + 0.5) / MAP_W * WORLD.Sx, z = WORLD.z0 + (py + 0.5) / MAP_H * WORLD.Sz;
    const gi = T.gi(x, z), h = T.h[gi]; T.normal(x, z, n);
    const shade = clamp(0.55 + 0.9 * (n.x * SUN_DIR.x + n.y * SUN_DIR.y + n.z * SUN_DIR.z), 0.2, 1.3) * (0.55 + 0.45 * gfx.sunVisAt(x, z));
    let r = 196, gg = 120, b = 78;
    const green = T.green[gi] / 255, beach = T.beach[gi] / 255, city = T.city[gi] / 255;
    r = lerp(r, lerp(150, 70, green), smooth(0.05, 0.3, green)); gg = lerp(gg, lerp(128, 104, green), smooth(0.05, 0.3, green)); b = lerp(b, lerp(70, 48, green), smooth(0.05, 0.3, green));
    const cliff = clamp((0.85 - n.y) * 4, 0, 1); r = lerp(r, green > 0.1 ? 120 : 150, cliff); gg = lerp(gg, green > 0.1 ? 116 : 62, cliff); b = lerp(b, green > 0.1 ? 108 : 40, cliff);
    const hh = clamp(h / 220, 0, 1); r = lerp(r, 226, hh * 0.4); gg = lerp(gg, 205, hh * 0.4); b = lerp(b, 180, hh * 0.4);
    r = lerp(r, 214, beach); gg = lerp(gg, 190, beach); b = lerp(b, 140, beach);
    const mud = T.mud[gi]; r = lerp(r, 70, mud * 0.8); gg = lerp(gg, 45, mud * 0.8); b = lerp(b, 30, mud * 0.8);
    if (city > 0.8) { r = 92; gg = 90; b = 88; } else if (city > 0.3) { r = 74; gg = 104; b = 52; }
    let R = r * shade, G = gg * shade, B = b * shade;
    if (h < WATER_Y && !T.inRiverTunnel(x, z)) { const d = clamp((WATER_Y - h) / 14, 0, 1); R = lerp(52, 22, d); G = lerp(92, 50, d); B = lerp(102, 72, d); }
    const i = (py * MAP_W + px) * 4; img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // the mountain stream above Millbrook, and the boat tunnel under the docks
  g.strokeStyle = 'rgba(60,104,116,.95)'; g.lineCap = 'round';
  const up = RIVER.reaches.find((r) => r.id === 'upper').pts;
  for (let i = 1; i < up.length; i++) { const q = up[i]; if (q.wl <= WATER_Y + 1.1) break; g.lineWidth = clamp(q.hw / 4, 1.2, 3); g.beginPath(); g.moveTo(mapX(up[i - 1].x), mapZ(up[i - 1].z)); g.lineTo(mapX(q.x), mapZ(q.z)); g.stroke(); }
  g.save(); g.setLineDash([4, 3]); g.lineWidth = 2.2; g.beginPath();
  RIVER.tunnel.pts.forEach((q, i) => { const X = mapX(q.x ?? q[0]), Y = mapZ(q.z ?? q[1]); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
  g.stroke(); g.restore(); g.lineCap = 'butt';
  // buildings
  g.fillStyle = 'rgba(214,200,180,.95)';
  for (const o of T.village) { g.save(); g.translate(mapX(o.x), mapZ(o.z)); g.rotate(-o.yaw); g.fillRect(-o.w / 2 * MAP_W / WORLD.Sx, -o.d / 2 * MAP_H / WORLD.Sz, Math.max(1.5, o.w * MAP_W / WORLD.Sx), Math.max(1.5, o.d * MAP_H / WORLD.Sz)); g.restore(); }
  g.fillStyle = 'rgba(200,196,188,.85)';
  for (const bd of world.city.buildings) g.fillRect(mapX(bd.x0), mapZ(bd.z0), Math.max(1, mapX(bd.x1) - mapX(bd.x0)), Math.max(1, mapZ(bd.z1) - mapZ(bd.z0)));
  // city streets
  g.strokeStyle = 'rgba(40,40,44,.9)'; g.lineWidth = 2.2;
  for (let i = 0; i < CITY.nx; i++) { const x = mapX(CITY.x0 + i * CITY.pitch); g.beginPath(); g.moveTo(x, mapZ(CITY.z0)); g.lineTo(x, mapZ(CITY.z1)); g.stroke(); }
  for (let j = 0; j < CITY.nz; j++) { const z = mapZ(CITY.z0 + j * CITY.pitch); g.beginPath(); g.moveTo(mapX(CITY.x0), z); g.lineTo(mapX(CITY.x1), z); g.stroke(); }
  for (const R of T.routes) {
    if (R.def.noCarve) continue;
    g.beginPath();
    for (let i = 0; i <= R.count; i += 2) { const X = mapX(R.x[i]), Y = mapZ(R.z[i]); if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y); }
    if (R.closed) g.closePath();
    if (R.surface === 'rail') { g.setLineDash([]); g.strokeStyle = 'rgba(30,26,24,.9)'; g.lineWidth = 2.6; g.stroke(); g.setLineDash([5, 5]); g.strokeStyle = 'rgba(230,226,216,.9)'; g.lineWidth = 1.2; g.stroke(); g.setLineDash([]); continue; }
    const asph = R.surface === 'asphalt';
    g.strokeStyle = 'rgba(20,12,8,.6)'; g.lineWidth = R.def.trail ? 2.4 : asph ? (R.id === 'hwy' ? 5.5 : 4.2) : 4; g.stroke();
    g.strokeStyle = R.def.trail ? 'rgba(240,222,190,.75)' : asph ? (R.id === 'hwy' ? '#f2c230' : '#f4f1e8') : 'rgba(250,236,210,.95)'; g.lineWidth = R.def.trail ? 1.1 : asph ? (R.id === 'hwy' ? 3 : 2) : 2; g.stroke();
  }
  // the Calder Metro: the loop under downtown and its four ramps
  const M = T.metro;
  if (M) {
    g.save(); g.setLineDash([6, 4]); g.strokeStyle = 'rgba(42,179,200,.95)'; g.lineWidth = 2.6; g.beginPath();
    for (let i = 0; i <= M.R.count; i += 3) { const X = mapX(M.R.x[i]), Y = mapZ(M.R.z[i]); if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y); }
    g.closePath(); g.stroke(); g.setLineDash([]);
    for (const sp of M.spurs) {
      g.beginPath(); g.moveTo(mapX(sp.x), mapZ(sp.z)); g.lineTo(mapX(sp.x + sp.dx * sp.L), mapZ(sp.z + sp.dz * sp.L)); g.stroke();
      g.fillStyle = '#c4161c'; g.beginPath(); g.arc(mapX(sp.x), mapZ(sp.z), 5, 0, TAU); g.fill();
      g.fillStyle = '#f4f1e8'; g.font = '700 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', mapX(sp.x), mapZ(sp.z) + 0.5);
    }
    g.restore();
  }
  return c;
}
