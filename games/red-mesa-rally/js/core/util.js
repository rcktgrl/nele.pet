'use strict';
/* Red Mesa Rally · Maths helpers, seeded random and Perlin noise */

/* ===================================================================
   RED MESA RALLY — world core: layout, terrain, routes, city, scatter
   Coordinates: metres, Y up. North is -Z. The desert festival sits at the
   origin; Calder Valley, Port Calder and Kestrel Pines lie east of the
   mountain belt, reached through the Calder Tunnel.
   =================================================================== */
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash2 = (i, j) => { let h = Math.imul(i * 374761393 + j * 668265263, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/* ---------- Perlin noise ---------- */
const Noise = (() => {
  const p = new Uint8Array(512), r = mulberry32(1337), perm = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = r() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  function n2(x, y) {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1], ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
    const x1 = gx[aa] * xf + gy[aa] * yf, x2 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const y1 = gx[ab] * xf + gy[ab] * (yf - 1), y2 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const a = x1 + (x2 - x1) * u, b = y1 + (y2 - y1) * u;
    return (a + (b - a) * v) * 1.4;
  }
  function fbm(x, y, o = 4) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < o; i++) { s += a * n2(x * f + i * 17.3, y * f - i * 9.1); n += a; a *= 0.5; f *= 2.03; } return s / n; }
  function ridged(x, y, o = 3) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < o; i++) { s += a * (1 - Math.abs(n2(x * f, y * f))); n += a; a *= 0.5; f *= 2.1; } return s / n; }
  return { n2, fbm, ridged };
})();
