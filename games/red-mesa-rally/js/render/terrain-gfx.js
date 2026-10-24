'use strict';
/* Red Mesa Rally · Streamed terrain, lighting bake, sea, vegetation, horizon */

/* ===================================================================
   RED MESA RALLY — world rendering: streamed terrain, lighting bake,
   sea, vegetation, horizon
   =================================================================== */
const TERRAIN_GLSL_PARS = `
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec3 aD;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec3 vD; varying vec3 vWPos; varying vec3 vWNrm;`;
const cellKey = (x, z, C) => Math.floor((x - WORLD.x0) / C) * 1000 + Math.floor((z - WORLD.z0) / C);

Object.assign(Gfx.prototype, {
  /* ---------- lighting bake (half resolution, includes building shadows) ---------- */
  bakeLighting() {
    const T = this.world.terrain, Nx = T.Nx, Nz = T.Nz, c = T.cell, H = T.h;
    const sx = Math.ceil(Nx / 2), sz = Math.ceil(Nz / 2), sc = c * 2;
    const occ = new Float32Array(sx * sz);
    for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
      let m = -1e9; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const ix = Math.min(Nx - 1, i * 2 + a), iz = Math.min(Nz - 1, j * 2 + b); m = Math.max(m, H[iz * Nx + ix]); }
      occ[j * sx + i] = m;
    }
    const occT = occ.slice(); // terrain only: the 8 m grid turns building shadows into blotches on paving, the shadow map draws those
    const raster = (x0, z0, x1, z1, top) => {
      for (let j = Math.max(0, Math.floor((z0 - T.z0) / sc)); j <= Math.min(sz - 1, Math.ceil((z1 - T.z0) / sc)); j++)
        for (let i = Math.max(0, Math.floor((x0 - T.x0) / sc)); i <= Math.min(sx - 1, Math.ceil((x1 - T.x0) / sc)); i++) occ[j * sx + i] = Math.max(occ[j * sx + i], top);
    };
    for (const b of this.world.city.buildings) footprint(b.x, b.z, b.yaw, b.w, b.d, 0, (x, z) => raster(x, z, x, z, b.base + b.h));
    for (const k of this.world.city.containers) raster(k.x0, k.z0, k.x1, k.z1, (k.y ?? CITY.y) + k.h);
    const occAt = (o, x, z) => {
      const fx = clamp((x - T.x0) / sc, 0, sx - 1.001), fz = clamp((z - T.z0) / sc, 0, sz - 1.001);
      const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, k = iz * sx + ix;
      return lerp(lerp(o[k], o[k + 1], tx), lerp(o[k + sx], o[k + sx + 1], tx), tz);
    };
    const sun = new Float32Array(sx * sz), sunT = new Float32Array(sx * sz);
    const hx = Math.hypot(SUN_DIR.x, SUN_DIR.z), dx = SUN_DIR.x / hx, dz = SUN_DIR.z / hx, tanE = SUN_DIR.y / hx;
    for (let j = 0; j < sz; j++) for (let i = 0; i < sx; i++) {
      const x = T.x0 + i * sc, z = T.z0 + j * sc;
      const y0 = T.height(x, z) + 0.6;
      let vis = 1, visT = 1;
      for (let t = 6; t < 900; t += 6 * (1 + t / 260)) {
        const rh = y0 + t * tanE; if (rh > 420) break;
        const px = x + dx * t, pz = z + dz * t;
        if (visT > 0) visT = Math.min(visT, (rh - occAt(occT, px, pz)) / t * 9);
        vis = Math.min(vis, (rh - occAt(occ, px, pz)) / t * 9);
        if (vis <= 0 && visT <= 0) break;
      }
      sun[j * sx + i] = clamp(vis, 0, 1); sunT[j * sx + i] = clamp(visT, 0, 1);
    }
    this.sunGrid = { data: sun, sx, sz, sc };
    this.sunGridT = { data: sunT, sx, sz, sc };
    // ambient occlusion from local relief (summed area table on the full grid)
    const sat = new Float64Array((Nx + 1) * (Nz + 1));
    for (let iz = 0; iz < Nz; iz++) { let row = 0; for (let ix = 0; ix < Nx; ix++) { row += H[iz * Nx + ix]; sat[(iz + 1) * (Nx + 1) + ix + 1] = sat[iz * (Nx + 1) + ix + 1] + row; } }
    const box = (ix, iz, r) => { const x0 = Math.max(0, ix - r), x1 = Math.min(Nx - 1, ix + r), z0 = Math.max(0, iz - r), z1 = Math.min(Nz - 1, iz + r); const s = sat[(z1 + 1) * (Nx + 1) + x1 + 1] - sat[z0 * (Nx + 1) + x1 + 1] - sat[(z1 + 1) * (Nx + 1) + x0] + sat[z0 * (Nx + 1) + x0]; return s / ((x1 - x0 + 1) * (z1 - z0 + 1)); };
    const ao = new Uint8Array(Nx * Nz);
    for (let iz = 0; iz < Nz; iz++) for (let ix = 0; ix < Nx; ix++) {
      const i = iz * Nx + ix, h = H[i];
      const o = Math.max(0, box(ix, iz, 3) - h) * 0.09 + Math.max(0, box(ix, iz, 12) - h) * 0.018;
      ao[i] = clamp(1 - o, 0.35, 1) * 255;
      if (T.tun[i]) ao[i] = 70;
    }
    this.aoMap = ao;
  },
  sunVisAt(x, z, terrainOnly) {
    const G = terrainOnly ? this.sunGridT : this.sunGrid, T = this.world.terrain;
    if (T.tun[T.gi(x, z)]) return 0;
    const fx = clamp((x - T.x0) / G.sc, 0, G.sx - 1.001), fz = clamp((z - T.z0) / G.sc, 0, G.sz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, k = iz * G.sx + ix, d = G.data;
    return lerp(lerp(d[k], d[k + 1], tx), lerp(d[k + G.sx], d[k + G.sx + 1], tx), tz);
  },
  kerbTexture() {
    if (this.kerbTex) return this.kerbTex;
    const S = this.world.city.streets, t = new THREE.DataTexture(S.kerbRG, S.NX, S.NZ, THREE.RGFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    return (this.kerbTex = t);
  },
  junctionTexture() {
    if (this.juncTex) return this.juncTex;
    const J = this.world.city.streets.rural, t = new THREE.DataTexture(J.tex, J.W, J.H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return (this.juncTex = t);
  },
  /* the shader's lookup into the country junction patches: the nearest patch centre wins */
  junctionGLSL() {
    const J = this.world.city.streets.rural, P = JPATCH, half = (P.size / 2).toFixed(1), f = (v) => v.toFixed(1);
    if (!J.list.length) return '';
    return `{ float best = 1e9; vec2 juv = vec2(0.0);
    ${J.list.map((j) => `{ vec2 q = P.xz - vec2(${f(j.x)}, ${f(j.z)}); float m = max(abs(q.x), abs(q.y)); if (m < best) { best = m; juv = (vec2(${j.col * J.n}.0, ${j.row * J.n}.0) + (q + ${half}) / ${P.res.toFixed(2)}) / vec2(${J.W}.0, ${J.H}.0); } }`).join('\n    ')}
    if (best < ${f(P.fade[1])}) { jW = 1.0 - smoothstep(${f(P.fade[0])}, ${f(P.fade[1])}, best); jT = texture2D(uJunc, juv); } }`;
  },
  /* where a cut runs into a bore, the ground steps up from the cut floor to the lid over one 4 m cell: cut that step out of the tube */
  boreGLSL() {
    const f = (v) => v.toFixed(2), out = [];
    for (const R of this.world.terrain.routes) if (R.bore) for (let i = 0; i <= R.count; i++) {
      const edge = R.bore[i] && (!R.bore[i - 1] || !R.bore[i + 1]); if (!edge) continue;
      const into = R.bore[i + 1] ? 1 : -1, [dx, dz] = R.dirAt(i * R.step), ux = dx * into, uz = dz * into;
      // back through the open cut to the portal: inside the tube only the tube and its floor show
      let k = i, y0 = R.y[i], y1 = R.y[i]; while (k - into >= 0 && k - into <= R.count && (R.covered[k - into] || Math.abs(k - i) < 4)) k -= into;
      for (let m = Math.min(i, k); m <= Math.max(i, k); m++) { y0 = Math.min(y0, R.y[m]); y1 = Math.max(y1, R.y[m]); }
      out.push(`{ vec2 q = P.xz - vec2(${f(R.x[i])}, ${f(R.z[i])}); float a = dot(q, vec2(${f(ux)}, ${f(uz)})), l = abs(dot(q, vec2(${f(-uz)}, ${f(ux)}))); if (a > ${f(-Math.abs(k - i) * R.step - 1)} && a < 30.0 && l < ${f(R.width / 2 + 1.2)} && P.y > ${f(y0 - 0.4)} && P.y < ${f(y1 + BORE_CROWN + 0.6)}) discard; } // bore mouth and cut`);
    }
    // the boat tunnel: the ground runs on over the culvert, so cut it out of the tube and the mouth in front of each headwall
    const U = RIVER.tunnel;
    for (const [i, into] of [[U.s.findIndex((v) => v >= U.open[0]), 1], [U.s.findIndex((v) => v >= U.open[1]), -1]]) {
      const a = U.pts[Math.max(0, i - 1)], b = U.pts[Math.min(U.pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L * into, uz = (b[1] - a[1]) / L * into, [x, z] = U.pts[i];
      out.push(`{ vec2 q = P.xz - vec2(${f(x)}, ${f(z)}); float a = dot(q, vec2(${f(ux)}, ${f(uz)})), l = abs(dot(q, vec2(${f(-uz)}, ${f(ux)}))); if (a > -8.0 && a < 24.0 && l < ${f(U.hw + 0.4)} && P.y > mix(-99.0, ${f(WATER_Y)}, step(a, 0.0)) && P.y < ${f(U.ceil + 0.5)}) discard; } // boat tunnel mouth (outside it only above the water, so the bed stays)`);
    }
    return out.join('\n  ');
  },
  /* ---------- terrain material ---------- */
  terrainMaterial() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.uniforms.uKerb = { value: this.kerbTexture() };
      sh.uniforms.uJunc = { value: this.junctionTexture() };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + TERRAIN_GLSL_PARS)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(position,1.0)).xyz; vWNrm = normal; vA = aA; vB = aB; vC = aC; vD = aD;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec3 vD; varying vec3 vWPos; varying vec3 vWNrm;
uniform sampler2D uKerb; uniform sampler2D uJunc;
${NOISE_GLSL}
float gWet; float gBump; float gGloss; vec3 gEmis;
float lineAA(float d, float w) { float f = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - f, w + f, abs(d)); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 P = vWPos; vec3 Nw = normalize(vWNrm); float slope = 1.0 - Nw.y;
  ${metroSpurs().map((sp) => `{ vec2 q = P.xz - vec2(${sp.x.toFixed(2)}, ${sp.z.toFixed(2)}); float a = dot(q, vec2(${sp.dx}, ${sp.dz})), l = abs(dot(q, vec2(${-sp.dz}, ${sp.dx}))); if (a > -0.5 && a < ${sp.cover.toFixed(1)} && l < ${(METRO.rampHw + 0.3).toFixed(2)}) discard; } // metro cut`).join('\n  ')}
  ${this.boreGLSL()}
  float vRoad = vA.x, vMud = vA.y, lat = vB.x, hw = vB.y, asph = vB.z, rail = vB.w, jbox = 0.0;
  float green = vC.x, beach = vC.y, city = vC.z, tun = vC.w, rs = vD.x, lanes = vD.y, jfade = 1.0 - vD.z;
  float dist = length(vViewPosition);
  float n1 = fbm2(P.xz * 0.012), n2 = fbm2(P.xz * 0.11), n3 = vnoise(P.xz * 0.8), n4 = vnoise(P.xz * 3.1);
  gEmis = vec3(0.0); gGloss = 0.0;
  // desert sand and red strata
  vec3 sand = mix(vec3(0.42, 0.17, 0.075), vec3(0.58, 0.29, 0.13), n1);
  sand *= 0.82 + 0.32 * n2;
  sand = mix(sand, vec3(0.62, 0.42, 0.25), smoothstep(0.62, 0.9, fbm2(P.xz * 0.03 + 7.0)) * 0.45);
  float scrub = smoothstep(0.52, 0.72, fbm2(P.xz * 0.045 + 3.0)) * (1.0 - clamp(slope * 3.0, 0.0, 1.0));
  sand = mix(sand, vec3(0.20, 0.17, 0.09), scrub * 0.42);
  sand *= 0.95 + 0.1 * n4;
  float band = P.y * 0.38 + fbm2(P.xz * 0.018) * 4.0 + n2 * 0.5;
  vec3 strata = mix(vec3(0.30, 0.075, 0.03), vec3(0.56, 0.20, 0.07), 0.5 + 0.5 * sin(band));
  strata = mix(strata, vec3(0.62, 0.42, 0.27), smoothstep(0.82, 0.98, sin(band * 0.31 + 1.3)) * 0.7);
  float fineFade = smoothstep(500.0, 120.0, dist);
  strata *= 0.72 + 0.45 * mix(0.5, vnoise(vec2(P.y * 1.8, (P.x + P.z) * 0.07)), fineFade);
  // east: grassland, forest floor, granite
  float gw = smoothstep(0.03, 0.25, green);
  vec3 grassDry = vec3(0.40, 0.31, 0.14) * (0.82 + 0.34 * n2);
  vec3 grassLush = vec3(0.16, 0.25, 0.075) * (0.78 + 0.44 * n2);
  vec3 grass = mix(grassDry, grassLush, smoothstep(0.35, 0.8, green + (n1 - 0.5) * 0.3));
  grass = mix(grass, vec3(0.12, 0.12, 0.065) * (0.75 + 0.5 * n3), smoothstep(0.82, 1.0, green) * 0.65);
  grass *= 0.92 + 0.16 * n4;
  vec3 ground = mix(sand, grass, gw);
  vec3 granite = vec3(0.37, 0.35, 0.33) * (0.65 + 0.55 * fbm2(vec2(P.y * 0.9, (P.x - P.z) * 0.12)));
  granite = mix(granite, vec3(0.22, 0.24, 0.16), smoothstep(0.55, 0.75, n2) * 0.5);
  vec3 cliffC = mix(strata, granite, gw);
  float cliff = smoothstep(0.26, 0.48, slope + (n3 - 0.5) * 0.12);
  vec3 col = mix(ground, cliffC, cliff);
  // beach sand
  vec3 beachC = vec3(0.70, 0.60, 0.44) * (0.88 + 0.2 * n3);
  col = mix(col, beachC, beach * (1.0 - cliff));
  // graded dirt road: pale crown, two worn lanes, loose edges
  float al = abs(lat), lw = hw * 0.42;
  float lanesW = exp(-pow((al - lw) / (hw * 0.17), 2.0)) * jfade;
  float edge = smoothstep(hw - 2.5, hw + 0.5, al) * jfade;
  vec3 roadC = vec3(0.74, 0.52, 0.34) * (0.9 + 0.14 * n3);
  roadC = mix(mix(roadC, vec3(0.42, 0.25, 0.14), lanesW * 0.6 * (0.7 + 0.3 * n2)), vec3(0.36, 0.17, 0.09) * (0.8 + 0.4 * n4), edge * 0.75);
  roadC = mix(roadC, roadC * vec3(0.95, 1.0, 0.85) * 0.9, gw);
  col = mix(col, roadC, vRoad * 0.95);
  // rail ballast
  vec3 ballast = vec3(0.33, 0.31, 0.29) * (0.65 + 0.6 * vnoise(P.xz * 7.0));
  col = mix(col, ballast, rail);
  // Port Calder: paved lots, lawns and parks, and a kerbed sidewalk along every street
  if (city > 0.01) {
    vec3 lot = vec3(0.31, 0.30, 0.28) * (0.8 + 0.2 * n3);
    vec2 slab = fract(P.xz / 6.0); lot *= 0.92 + 0.08 * step(0.03, min(slab.x, slab.y));
    vec3 cg = mix(lot, grassLush * 1.1, smoothstep(0.92, 0.7, city) * step(0.3, city));
    vec3 walk = vec3(0.46, 0.44, 0.41) * (0.85 + 0.15 * n3);
    vec2 sl = fract(P.xz / 2.0); walk *= 0.92 + 0.08 * step(0.06, min(sl.x, sl.y));
    // midway between two streets the lateral offset flips sign from one grid vertex to the next: no sidewalk there
    float latGrad = length(vec2(dFdx(lat), dFdy(lat))) / max(length(vec2(dFdx(P.x), dFdy(P.x))) + length(vec2(dFdx(P.z), dFdy(P.z))), 1e-3);
    float real = 1.0 - smoothstep(1.6, 2.6, latGrad);
    // the street plan: a fine kerb map with every corner rounded, where there is one; the coarse road grid elsewhere
    vec2 kuv = (P.xz - vec2(${STREETMAP.x0.toFixed(1)}, ${STREETMAP.z0.toFixed(1)}) + ${(STREETMAP.res / 2).toFixed(3)}) / vec2(${(STREETMAP.x1 - STREETMAP.x0).toFixed(1)}, ${(STREETMAP.z1 - STREETMAP.z0).toFixed(1)});
    float ke = 16.0;
    if (kuv.x > 0.0 && kuv.y > 0.0 && kuv.x < 1.0 && kuv.y < 1.0) { vec2 kt = texture2D(uKerb, kuv).rg; ke = kt.r * 31.875 - 16.0; jbox = kt.g; }
    float kn = step(ke, 14.0), kw = fwidth(ke) + 0.02;
    cg = mix(cg, walk, mix((1.0 - smoothstep(hw + 4.0, hw + 4.6, al)) * real, 1.0 - smoothstep(4.2, 4.2 + kw, ke), kn));
    cg = mix(cg, vec3(0.62, 0.6, 0.56), mix(lineAA(al - hw - 0.15, 0.14) * real, lineAA(ke - 0.15, 0.14), kn));
    float vergeCut = mix(1.0, 1.0 - smoothstep(6.6, 7.0 + kw, ke), kn * step(0.00015, beach) * step(beach, 0.02));
    col = mix(col, cg, smoothstep(0.02, 0.25, city) * vergeCut * (1.0 - cliff));
    asph = mix(asph, 1.0 - smoothstep(-kw, kw, ke), kn * step(0.25, city));
    gGloss = max(gGloss, step(0.8, city) * 0.2);
  }
  // asphalt with markings (none through the junction boxes)
  jfade *= 1.0 - smoothstep(0.3, 0.7, jbox);
  {
    vec3 tar = vec3(0.085, 0.087, 0.092) * (0.82 + 0.3 * n3 + 0.12 * n4);
    float wear = lanes > 2.5 ? exp(-pow((al - hw * 0.25) / 1.1, 2.0)) + exp(-pow((al - hw * 0.75) / 1.1, 2.0)) : exp(-pow((al - hw * 0.5) / 1.0, 2.0));
    tar *= 1.0 - 0.18 * wear * fineFade * jfade;
    tar = mix(tar, vec3(0.13, 0.13, 0.135), smoothstep(0.62, 0.8, fbm2(P.xz * 0.06)) * 0.5);
    float m = 0.0; vec3 mc = vec3(0.86);
    float dash = step(0.5, fract(rs / 12.0));
    if (lanes > 2.5) {
      float y2 = lineAA(al - 0.28, 0.1);
      m = max(m, y2);
      if (y2 > 0.01) mc = vec3(0.85, 0.62, 0.12);
      m = max(m, lineAA(al - hw * 0.5, 0.08) * dash);
      m = max(m, lineAA(al - (hw - 0.7), 0.1));
    } else if (lanes > 0.5) {
      m = max(m, lineAA(lat, 0.08) * dash); mc = vec3(0.85, 0.72, 0.3);
      float e = lineAA(al - (hw - 0.55), 0.08);
      if (e > m) mc = vec3(0.86);
      m = max(m, e);
    }
    m *= smoothstep(1400.0, 300.0, dist) * (0.75 + 0.25 * n4) * jfade;
    // a country junction: its patch draws the tarmac with rounded corners, the edge lines round them, and the paint
    float jW = 0.0; vec4 jT = vec4(1.0, 0.0, 0.0, 0.0);
    ${this.junctionGLSL()}
    if (jW > 0.0) {
      float je = jT.r * 31.875 - 16.0, jk = fwidth(je) + 0.02, jd = jT.b * 31.875 - 16.0, jdash = step(0.5, fract(fract(jT.a * 2.0) * 2.0));
      float jm = lineAA(jd, 0.08) * jdash * (1.0 - step(0.5, jT.g)); vec3 jmc = vec3(0.85, 0.72, 0.3);
      float jedge = lineAA(je + 1.55, 0.08); if (jedge > jm) jmc = vec3(0.86); jm = max(jm, jedge);
      jm *= smoothstep(1400.0, 300.0, dist) * (0.75 + 0.25 * n4);
      m = mix(m, jm, jW); mc = mix(mc, jmc, jW);
      asph = mix(asph, 1.0 - smoothstep(-jk, jk, je), jW);
      tar = mix(tar, vec3(0.085, 0.087, 0.092) * (0.82 + 0.3 * n3 + 0.12 * n4), jW * 0.6);
    }
    tar = mix(tar, mc, m * 0.85);
    col = mix(col, tar, asph);
    gGloss = max(gGloss, asph * 0.35);
  }
  // mud
  vec3 mudC = vec3(0.075, 0.045, 0.028) * (0.75 + 0.5 * n2);
  float puddle = smoothstep(0.55, 0.7, vnoise(P.xz * 0.25)) * vMud;
  col = mix(col, mudC, vMud);
  float shore = 1.0 - smoothstep(0.0, 1.6, P.y - (${WATER_Y.toFixed(2)}));
  gWet = clamp(max(vMud * 0.85 + puddle * 0.4, shore), 0.0, 1.0);
  col *= 1.0 - 0.38 * shore * (1.0 - vMud);
  // tunnel: sodium lights wash the road
  gEmis = col * vec3(1.0, 0.62, 0.3) * 0.55 * tun;
  diffuseColor.rgb = col;
  gBump = n3 * 0.3 + n4 * 0.06 + cliff * fbm2(vec2(P.y * 1.3, (P.x + P.z) * 0.25)) * 1.6 + vRoad * lanesW * -0.12;
  gBump *= (1.0 - puddle) * (1.0 - max(asph, step(0.8, city)) * 0.85) * smoothstep(420.0, 60.0, dist);
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.28, gWet); roughnessFactor = mix(roughnessFactor, 0.62, gGloss);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  vec3 sp = -vViewPosition; vec3 sx = dFdx(sp), sy = dFdy(sp);
  float dhx = dFdx(gBump), dhy = dFdy(gBump);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx); float det = dot(sx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad * 0.9);
}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmis;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.directDiffuse *= vA.z; reflectedLight.directSpecular *= vA.z;
reflectedLight.indirectDiffuse *= vA.w; reflectedLight.indirectSpecular *= vA.w;`);
    };
    mat.customProgramCacheKey = () => 'terrain2';
    return mat;
  },
  /* ---------- streamed terrain chunks ---------- */
  buildTerrain() {
    this.bakeLighting();
    this.terrainMat = this.terrainMaterial();
    const T = this.world.terrain, CH = 64, SUP = 4; // 64-cell chunks, grouped 4×4 into far-field superchunks
    this.chunks = [];
    this.terrainGroup = new THREE.Group(); this.scene.add(this.terrainGroup);
    const sup = new Map();
    for (let z0 = 0; z0 < T.Nz - 1; z0 += CH) for (let x0 = 0; x0 < T.Nx - 1; x0 += CH) {
      const ni = Math.min(CH, T.Nx - 1 - x0), nj = Math.min(CH, T.Nz - 1 - z0);
      const ch = { x0, z0, ni, nj, hi: null, mid: null, lvl: 0, cx: T.x0 + (x0 + ni / 2) * T.cell, cz: T.z0 + (z0 + nj / 2) * T.cell, half: Math.max(ni, nj) * T.cell / 2 };
      const key = Math.floor(x0 / CH / SUP) + ',' + Math.floor(z0 / CH / SUP);
      let S = sup.get(key); if (!S) { S = { subs: [] }; sup.set(key, S); }
      ch.sup = S; S.subs.push(ch); this.chunks.push(ch);
    }
    // chunks under a bridge or viaduct and its approaches: on high they stay at full detail at any distance,
    // so the ground and road around the decks never reshape as the camera moves
    const nCx = Math.ceil((T.Nx - 1) / CH), byCell = (ix, iz) => this.chunks[Math.floor(iz / CH) * nCx + Math.floor(ix / CH)];
    for (const B of T.bridges) {
      const R = this.world.route(B.route), m = (B.width / 2 + 12) / T.cell;
      for (let i = Math.max(0, B.i0 - 8); i <= Math.min(R.count, B.i1 + 8); i++) {
        const ix = (R.x[i] - T.x0) / T.cell, iz = (R.z[i] - T.z0) / T.cell;
        for (const [ax, az] of [[-m, -m], [m, -m], [-m, m], [m, m]]) {
          const ch = byCell(clamp(ix + ax, 0, T.Nx - 2), clamp(iz + az, 0, T.Nz - 2)); if (ch) ch.deck = true;
        }
      }
    }
    // one mesh per superchunk; a sub-chunk's triangles drop out of the index while finer detail covers it
    this.supers = [];
    for (const S of sup.values()) {
      const parts = S.subs.map((ch) => this.chunkArrays(ch, 4, 14));
      let nv = 0, ni = 0; for (const q of parts) { nv += q.nv; ni += q.idx.length; }
      const geo = new THREE.BufferGeometry(), names = ['position', 'normal', 'aA', 'aB', 'aC', 'aD'], sizes = [3, 3, 4, 4, 4, 3];
      names.forEach((nm, k) => {
        const arr = new Float32Array(nv * sizes[k]); let o = 0;
        for (const q of parts) { arr.set(q[nm], o); o += q[nm].length; }
        geo.setAttribute(nm, new THREE.BufferAttribute(arr, sizes[k]));
      });
      let vo = 0;
      S.subs.forEach((ch, k) => { const q = parts[k]; ch.loIdx = new Uint32Array(q.idx.length); for (let i = 0; i < q.idx.length; i++) ch.loIdx[i] = q.idx[i] + vo; vo += q.nv; });
      S.index = new THREE.BufferAttribute(new Uint32Array(ni), 1); S.index.setUsage(THREE.DynamicDrawUsage);
      geo.setIndex(S.index); geo.computeBoundingSphere();
      S.geo = geo; S.mesh = new THREE.Mesh(geo, this.terrainMat); S.mesh.receiveShadow = true; this.terrainGroup.add(S.mesh);
      S.dirty = true; this.supers.push(S);
    }
    this.refreshSupers();
  },
  refreshSupers() {
    for (const S of this.supers) {
      if (!S.dirty) continue; S.dirty = false;
      const arr = S.index.array; let n = 0;
      for (const ch of S.subs) if (!ch.hi && !ch.mid) { arr.set(ch.loIdx, n); n += ch.loIdx.length; }
      S.geo.setDrawRange(0, n); S.mesh.visible = n > 0;
      S.index.needsUpdate = true;
    }
  },
  chunkArrays(ch, step, skirt) {
    const T = this.world.terrain, Nx = T.Nx, c = T.cell, H = T.h;
    const xs = [], zs = [];
    for (let k = 0; k < ch.ni; k += step) xs.push(ch.x0 + k); xs.push(ch.x0 + ch.ni);
    for (let k = 0; k < ch.nj; k += step) zs.push(ch.z0 + k); zs.push(ch.z0 + ch.nj);
    const nx = xs.length, nz = zs.length, ring = 2 * (nx + nz) - 4, nv = nx * nz + ring;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), A = new Float32Array(nv * 4), B = new Float32Array(nv * 4), Cc = new Float32Array(nv * 4), D = new Float32Array(nv * 3);
    const M = T.metro, overMetro = (x, z) => M && x > M.x0 && z > M.z0 && x < M.x0 + M.nx * M.G && z < M.z0 + M.nz * M.G;
    const put = (k, ix, iz, dy) => {
      const gi = iz * Nx + ix, x = T.x0 + ix * c, z = T.z0 + iz * c;
      if (dy && overMetro(x, z)) dy = Math.min(dy, Math.max(0, H[gi] - METRO.ceil - 0.05)); // skirts would hang down into the tube
      pos[k * 3] = x; pos[k * 3 + 1] = H[gi] - dy; pos[k * 3 + 2] = z;
      const l = H[iz * Nx + Math.max(0, ix - 1)], r = H[iz * Nx + Math.min(Nx - 1, ix + 1)], d = H[Math.max(0, iz - 1) * Nx + ix], u = H[Math.min(T.Nz - 1, iz + 1) * Nx + ix];
      const nxv = l - r, nzv = d - u, ny = 2 * c, L = Math.hypot(nxv, ny, nzv);
      nor[k * 3] = nxv / L; nor[k * 3 + 1] = ny / L; nor[k * 3 + 2] = nzv / L;
      A[k * 4] = T.road[gi]; A[k * 4 + 1] = T.mud[gi]; A[k * 4 + 2] = this.sunVisAt(x, z, true); A[k * 4 + 3] = this.aoMap[gi] / 255;
      B[k * 4] = T.rlat[gi]; B[k * 4 + 1] = T.rhw[gi]; B[k * 4 + 2] = T.asph[gi]; B[k * 4 + 3] = T.rail[gi];
      Cc[k * 4] = T.green[gi] / 255; Cc[k * 4 + 1] = T.beach[gi] / 255; Cc[k * 4 + 2] = T.city[gi] / 255; Cc[k * 4 + 3] = T.tun[gi] / 255;
      D[k * 3] = T.rs[gi]; D[k * 3 + 1] = T.rlanes[gi]; D[k * 3 + 2] = T.rfade[gi] / 255;
    };
    let k = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) put(k++, xs[i], zs[j], 0);
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
    // skirt ring hides cracks between detail levels
    const edge = [];
    for (let i = 0; i < nx; i++) edge.push([i, 0]);
    for (let j = 1; j < nz; j++) edge.push([nx - 1, j]);
    for (let i = nx - 2; i >= 0; i--) edge.push([i, nz - 1]);
    for (let j = nz - 2; j > 0; j--) edge.push([0, j]);
    const base = k;
    for (const [i, j] of edge) put(k++, xs[i], zs[j], skirt);
    for (let e = 0; e < edge.length; e++) {
      const a = edge[e][1] * nx + edge[e][0], b = edge[(e + 1) % edge.length][1] * nx + edge[(e + 1) % edge.length][0];
      const sa = base + e, sb = base + (e + 1) % edge.length;
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
    return { nv, idx, position: pos, normal: nor, aA: A, aB: B, aC: Cc, aD: D };
  },
  chunkGeometry(ch, step, skirt) {
    const q = this.chunkArrays(ch, step, skirt), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(q.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(q.normal, 3));
    geo.setAttribute('aA', new THREE.BufferAttribute(q.aA, 4)); geo.setAttribute('aB', new THREE.BufferAttribute(q.aB, 4));
    geo.setAttribute('aC', new THREE.BufferAttribute(q.aC, 4)); geo.setAttribute('aD', new THREE.BufferAttribute(q.aD, 3));
    geo.setIndex(q.idx);
    geo.computeBoundingSphere();
    return geo;
  },
  updateTerrain(cam, budget) {
    const qd = this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.75 : 0.55;
    const hiDist = 800 * qd, midDist = 1900 * qd; // far enough out that the switch in detail does not show on roads and decks
    let builds = budget === undefined ? 2 : budget;
    const list = this.chunks.map((ch) => [Math.max(0, Math.hypot(ch.cx - cam.x, ch.cz - cam.z) - ch.half), ch]).sort((a, b) => a[0] - b[0]);
    const drop = (ch, k) => { if (ch[k]) { this.terrainGroup.remove(ch[k]); ch[k].geometry.dispose(); ch[k] = null; ch.sup.dirty = true; } };
    const pin = this.quality === 'high';
    for (const [d, ch] of list) {
      const far = !(pin && ch.deck) && d > hiDist;
      if (!far && !ch.hi && builds > 0) {
        builds--; ch.hi = new THREE.Mesh(this.chunkGeometry(ch, 1, 5), this.terrainMat); ch.hi.receiveShadow = true; this.terrainGroup.add(ch.hi); ch.sup.dirty = true;
      } else if (ch.hi && far && d > hiDist + 160) drop(ch, 'hi');
      if (d < midDist && !ch.mid && !ch.hi && builds > 0) {
        builds--; ch.mid = new THREE.Mesh(this.chunkGeometry(ch, 2, 8), this.terrainMat); ch.mid.receiveShadow = true; this.terrainGroup.add(ch.mid); ch.sup.dirty = true;
      } else if (ch.mid && d > midDist + 250) drop(ch, 'mid');
      if (ch.mid) ch.mid.visible = !ch.hi;
    }
    this.refreshSupers();
  },
  /* ---------- sea + lake ---------- */
  buildWater() {
    const nTex = makeCanvasTex(256, 256, (g, w, h) => {
      const img = g.createImageData(w, h);
      const hgt = (x, y) => { let s = 0; for (let o = 0; o < 4; o++) { const f = 2 ** o * 4; s += Math.sin((x / w * f + Math.sin(y / h * TAU * 2 + o) * 0.3) * TAU) * Math.cos((y / h * f + o * 0.7) * TAU) / (o + 1); } return s; };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
        const i = (y * w + x) * 4; img.data[i] = 128 - dx * 30; img.data[i + 1] = 128 - dy * 30; img.data[i + 2] = 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, { srgb: false, repeat: true });
    const R = 22000;
    nTex.repeat.set(R / 6, R / 6);
    this.waterNormal = nTex;
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.035, 0.075, 0.08), roughness: 0.06, metalness: 0.1, normalMap: nTex, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.9, envMapIntensity: 1.25 });
    const water = this.water = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), m);
    water.rotation.x = -Math.PI / 2; water.position.set(2150, WATER_Y, -450);
    water.receiveShadow = true;
    this.scene.add(water);
  },
  /* distant mountains and sea so the horizon never ends in a void */
  buildFarLand() {
    const N = 90, S = 26000, cx = 2150, cz = -450;
    const geo = new THREE.PlaneGeometry(S, S, N, N); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + cx, z = p.getZ(i) + cz;
      const ox = Math.max(WORLD.x0 - x, x - WORLD.x1, 0), oz = Math.max(WORLD.z0 - z, z - WORLD.z1, 0), out = Math.hypot(ox, oz);
      const landSide = (x < 1500 || z < -1600) && !(z > WORLD.z1 && x > 1600);
      let h;
      if (out < 1) h = -120;
      else if (landSide) h = 120 + smooth(0, 3000, out) * 420 * (0.4 + Noise.ridged(x / 2200, z / 2200, 3)) + 60 * Noise.fbm(x / 700, z / 700, 2);
      else h = -40;
      p.setY(i, h);
      const k = clamp(h / 500, 0, 1);
      col[i * 3] = lerp(0.36, 0.55, k); col[i * 3 + 1] = lerp(0.24, 0.47, k); col[i * 3 + 2] = lerp(0.18, 0.42, k);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    mesh.position.set(cx, 0, cz);
    this.scene.add(mesh);
  },
  /* ---------- scatter ---------- */
  rockMaterial(granite) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.3 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;').replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
vRW = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;
#else
vRW = (modelMatrix * vec4(position,1.0)).xyz;
#endif`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vRW;\n${NOISE_GLSL}`).replace('#include <color_fragment>', granite ? `#include <color_fragment>
{ diffuseColor.rgb *= vec3(0.46, 0.44, 0.41) * (0.7 + 0.45 * fbm2(vRW.xz * 0.9 + vRW.y)) ; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.26, 0.12), smoothstep(0.6, 0.9, vnoise(vRW.xz * 1.3)) * 0.5); }` : `#include <color_fragment>
{ float b = vRW.y * 1.7 + fbm2(vRW.xz * 0.3) * 2.0; diffuseColor.rgb *= vec3(0.78, 0.5, 0.36) * (0.75 + 0.35 * sin(b)) * (0.8 + 0.4 * vnoise(vRW.xz * 2.0 + vRW.y)); }`);
    };
    m.customProgramCacheKey = () => 'rock' + (granite ? 'g' : 'r');
    return m;
  },
  /* instanced scatter split into cells so frustum + distance culling work */
  cellInstances(geo, mat, items, place, opts) {
    const C = opts.cell || 400, cells = new Map();
    for (const it of items) { const k = cellKey(it.x, it.z, C); let a = cells.get(k); if (!a) { a = []; cells.set(k, a); } a.push(it); }
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    for (const list of cells.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => { col.setRGB(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); place(it, dummy, col); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, col); });
      im.computeBoundingSphere();
      im.castShadow = !!opts.cast; im.receiveShadow = true;
      im.userData.drawDist = opts.dist; im.userData.lodMin = opts.lodMin || 0; im.userData.lodMax = opts.lodMax || 0;
      this.scene.add(im); this.cullList.push(im);
    }
  },
  updateCulling(cam) {
    const q = this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.8 : 0.55;
    for (const im of this.cullList) {
      const c = im.boundingSphere.center, u = im.userData, dc = Math.hypot(c.x - cam.x, c.z - cam.z), d = dc - im.boundingSphere.radius;
      im.visible = d < u.drawDist * q && !(u.lodMax && dc > u.lodMax * q) && !(u.lodMin && dc <= u.lodMin * q);
    }
    this.updateTerrain(cam);
  },
  buildScatter() {
    const S = this.world.scatter;
    this.cullList = this.cullList || [];
    const vis = (x, z) => 0.42 + 0.58 * this.sunVisAt(x, z);
    const low = this.quality === 'low';
    const rockMat = this.rockMaterial(false), graniteMat = this.rockMaterial(true);
    const rockGeo = (k, detail) => { const g = new THREE.IcosahedronGeometry(1, detail); g.scale(1, 0.62 + k * 0.08, 0.9); lumpy(g, 0.32, 1.1, k + 1); tint(g, 1, 1, 1); return g; };
    const placeRock = (r, d, col) => { d.position.set(r.x, r.y, r.z); d.rotation.set(r.tilt, r.rot, r.tilt * 0.5); d.scale.set(r.s * (1 + r.seed * 0.4), r.s, r.s); const v = vis(r.x, r.z); col.setRGB(v, v, v); };
    for (let k = 0; k < 2; k++) {
      const bigR = S.rocks.filter((r, i) => r.s >= 2 && i % 2 === k), bigG = S.granite.filter((r, i) => r.s >= 2 && i % 2 === k);
      this.cellInstances(rockGeo(k, low ? 1 : 2), rockMat, bigR, placeRock, { cast: true, dist: 1400, lodMax: 450 });
      this.cellInstances(rockGeo(k, 0), rockMat, bigR, placeRock, { cast: false, dist: 1400, lodMin: 450 });
      this.cellInstances(rockGeo(k + 1, 0), graniteMat, bigG, placeRock, { cast: false, dist: 1300, lodMin: 450 });
      this.cellInstances(rockGeo(k + 2, 1), rockMat, S.rocks.filter((r, i) => r.s < 2 && i % 2 === k), placeRock, { cast: true, dist: 500 });
      this.cellInstances(rockGeo(k + 1, low ? 1 : 2), graniteMat, bigG, placeRock, { cast: true, dist: 1300, lodMax: 450 });
      this.cellInstances(rockGeo(k + 3, 1), graniteMat, S.granite.filter((r, i) => r.s < 2 && i % 2 === k), placeRock, { cast: true, dist: 450 });
    }
    // junipers
    const jParts = [];
    const trunk = new THREE.CylinderGeometry(0.12, 0.22, 2.0, 6); trunk.translate(0, 1.0, 0); tint(trunk, 0.22, 0.15, 0.1); jParts.push(trunk);
    const rr = mulberry32(5);
    for (let i = 0; i < 6; i++) { const b = new THREE.IcosahedronGeometry(0.9 + rr() * 0.5, low ? 0 : 1); lumpy(b, 0.3, 1.6, i); b.translate((rr() - 0.5) * 1.4, 1.9 + rr() * 1.8, (rr() - 0.5) * 1.4); const sh = 0.75 + rr() * 0.25; tint(b, 0.16 * sh, 0.2 * sh, 0.11 * sh); jParts.push(b); }
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const placeJ = (t, d, col) => { d.position.set(t.x, t.y - 0.1, t.z); d.rotation.set(0, t.rot, 0); d.scale.setScalar(t.s); const v = vis(t.x, t.z); col.setRGB(v * (0.85 + t.seed * 0.3), v, v * (0.9 + t.seed * 0.2)); };
    this.cellInstances(mergeGeos(jParts), leafMat, S.trees, placeJ, { cast: true, dist: 1100, lodMax: 420 });
    const jFar = new THREE.IcosahedronGeometry(1.5, 0); jFar.scale(1, 1.15, 1); jFar.translate(0, 2.7, 0); tint(jFar, 0.15, 0.185, 0.1);
    this.cellInstances(jFar, leafMat, S.trees, placeJ, { cast: false, dist: 1100, lodMin: 420 });
    // sagebrush (desert) and meadow scrub (east): leafy clumps up on a few short woody stems, so they never read as stones
    const bushGeo = (clumps, detail) => {
      const parts = [], r = mulberry32(11);
      for (let i = 0; i < 3; i++) { const st = new THREE.CylinderGeometry(0.035, 0.07, 0.55, 5); st.translate(0, 0.27, 0); st.rotateZ((r() - 0.5) * 0.6); st.rotateY(i * 2.1); tint(st, 0.32, 0.22, 0.14); parts.push(st); }
      for (let i = 0; i < clumps; i++) {
        const a = i / clumps * Math.PI * 2 + r(), d = i ? 0.38 + r() * 0.12 : 0, c = new THREE.IcosahedronGeometry(0.34 + r() * 0.12, detail);
        c.scale(1, 0.8, 1); lumpy(c, 0.22, 3.2, i + 7); c.translate(Math.cos(a) * d, 0.62 + r() * 0.22 + (i ? 0 : 0.18), Math.sin(a) * d);
        const sh = 0.85 + r() * 0.3; tint(c, sh, sh * 1.04, sh); parts.push(c);
      }
      return mergeGeos(parts);
    };
    const bGeo = bushGeo(low ? 4 : 6, low ? 0 : 1), bFar = bushGeo(3, 0);
    const bMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const placeB = (b, d, col) => { d.position.set(b.x, b.y - 0.05, b.z); d.rotation.set(0, b.rot, 0); d.scale.set(b.s, b.s * (0.8 + b.seed * 0.5), b.s); const v = vis(b.x, b.z), k = b.seed; col.setRGB((0.17 + k * 0.06) * v, (0.21 + k * 0.05) * v, (0.13 + k * 0.03) * v); };
    const placeG = (b, d, col) => { d.position.set(b.x, b.y - 0.05, b.z); d.rotation.set(0, b.rot, 0); d.scale.set(b.s * 1.2, b.s * (0.7 + b.seed * 0.5), b.s * 1.2); const v = vis(b.x, b.z), g = b.g; col.setRGB(lerp(0.2, 0.08, g) * v * (0.8 + b.seed * 0.4), lerp(0.25, 0.2, g) * v, lerp(0.09, 0.06, g) * v); };
    this.cellInstances(bGeo, bMat, S.bushes, placeB, { cast: this.quality === 'high', dist: 420, lodMax: 230 });
    this.cellInstances(bFar, bMat, S.bushes, placeB, { cast: false, dist: 420, lodMin: 230 });
    this.cellInstances(bGeo, bMat, S.grassBush, placeG, { cast: false, dist: 420, lodMax: 230 });
    this.cellInstances(bFar, bMat, S.grassBush, placeG, { cast: false, dist: 420, lodMin: 230 });
    // dead snags
    const sParts = [];
    const st = new THREE.CylinderGeometry(0.08, 0.2, 3.2, 5); st.translate(0, 1.6, 0); sParts.push(st);
    for (let i = 0; i < 4; i++) { const br = new THREE.CylinderGeometry(0.03, 0.08, 1.6, 4); br.translate(0, 0.8, 0); br.rotateZ(0.6 + i * 0.25); br.rotateY(i * 1.7); br.translate(0, 1.4 + i * 0.4, 0); sParts.push(br); }
    sParts.forEach((g) => tint(g, 0.45, 0.4, 0.34));
    this.cellInstances(mergeGeos(sParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), S.cacti, (t, d, col) => { d.position.set(t.x, t.y - 0.1, t.z); d.rotation.set(t.seed * 0.2, t.rot, 0); d.scale.setScalar(t.s); const v = vis(t.x, t.z); col.setRGB(v, v, v); }, { cast: true, dist: 700 });
    // pines: trunk and stacked cones
    const pParts = [];
    const pt = new THREE.CylinderGeometry(0.16, 0.3, 3, 6); pt.translate(0, 1.5, 0); tint(pt, 0.25, 0.17, 0.11); pParts.push(pt);
    for (let i = 0; i < 4; i++) { const r = 2.6 - i * 0.55, hgt = 3.4 - i * 0.35; const cg = new THREE.ConeGeometry(r, hgt, low ? 6 : 8, 1); lumpy(cg, 0.08, 2, i + 7); cg.translate(0, 2.6 + i * 1.75 + hgt / 2, 0); const sh = 0.8 + i * 0.07; tint(cg, 0.075 * sh, 0.16 * sh, 0.09 * sh); pParts.push(cg); }
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const placeP = (t, d, col) => { d.position.set(t.x, t.y - 0.2, t.z); d.rotation.set(0, t.rot, 0); d.scale.set(t.s, t.s * (0.9 + t.seed * 0.4), t.s); const v = vis(t.x, t.z); col.setRGB(v * (0.8 + t.seed * 0.35), v * (0.9 + t.seed * 0.2), v); };
    this.cellInstances(mergeGeos(pParts), pineMat, S.pines, placeP, { cast: true, dist: 1150, lodMax: 380 });
    const pFar = mergeGeos([tint(new THREE.CylinderGeometry(0.2, 0.3, 3, 4, 1, true).translate(0, 1.5, 0), 0.25, 0.17, 0.11), tint(new THREE.ConeGeometry(2.5, 8.6, 6, 1, true).translate(0, 7.0, 0), 0.068, 0.15, 0.084)]);
    this.cellInstances(pFar, pineMat, S.pines, placeP, { cast: false, dist: 1500, lodMin: 380 });
    // broadleaf oaks (valley, parks)
    const oParts = [];
    const ot = new THREE.CylinderGeometry(0.2, 0.34, 2.6, 6); ot.translate(0, 1.3, 0); tint(ot, 0.24, 0.17, 0.11); oParts.push(ot);
    const or = mulberry32(17);
    for (let i = 0; i < 7; i++) { const b = new THREE.IcosahedronGeometry(1.4 + or() * 0.8, low ? 0 : 1); lumpy(b, 0.25, 1.2, i + 3); b.scale(1, 0.8, 1); b.translate((or() - 0.5) * 3.2, 3.6 + or() * 1.8, (or() - 0.5) * 3.2); const sh = 0.75 + or() * 0.3; tint(b, 0.16 * sh, 0.24 * sh, 0.08 * sh); oParts.push(b); }
    const oakGeo = mergeGeos(oParts);
    const placeO = (t, d, col) => { d.position.set(t.x, t.y - 0.1, t.z); d.rotation.set(0, t.rot, 0); d.scale.setScalar(t.s); const v = vis(t.x, t.z); col.setRGB(v * (0.9 + t.seed * 0.3), v, v * 0.9); };
    this.cellInstances(oakGeo, leafMat, S.oaks, placeO, { cast: true, dist: 1100, lodMax: 420 });
    const oFar = mergeGeos([tint(new THREE.CylinderGeometry(0.25, 0.34, 2.6, 4, 1, true).translate(0, 1.3, 0), 0.24, 0.17, 0.11), tint(new THREE.IcosahedronGeometry(2.6, 0).scale(1.2, 0.85, 1.2).translate(0, 4.4, 0), 0.15, 0.22, 0.075)]);
    this.cellInstances(oFar, leafMat, S.oaks, placeO, { cast: false, dist: 1300, lodMin: 420 });
    this.cellInstances(oakGeo, leafMat, this.world.city.parkTrees, (t, d, col) => { d.position.set(t.x, t.y - 0.1, t.z); d.rotation.set(0, t.rot, 0); d.scale.setScalar(t.s * 0.85); const v = vis(t.x, t.z); col.setRGB(v, v, v); }, { cast: true, dist: 900 });
    // palms
    const palm = [];
    let px = 0, py = 0;
    for (let i = 0; i < 6; i++) { const seg = new THREE.CylinderGeometry(0.17 - i * 0.012, 0.2 - i * 0.012, 1.6, 6); seg.translate(0, 0.8, 0); seg.rotateZ(-0.05 * i); seg.translate(px, py, 0); px += Math.sin(0.05 * i) * 1.6; py += 1.58; tint(seg, 0.4, 0.31, 0.2); palm.push(seg); }
    for (let i = 0; i < 9; i++) { const f = new THREE.PlaneGeometry(0.9, 3.6, 1, 4); const fp = f.attributes.position; for (let k = 0; k < fp.count; k++) { const yy = fp.getY(k); fp.setZ(k, -Math.pow((yy + 1.8) / 3.6, 2) * 1.4); } f.translate(0, 1.8, 0); f.rotateX(-1.1); f.rotateY(i / 9 * TAU); f.translate(px, py, 0); tint(f, 0.15, 0.3, 0.09); palm.push(f); }
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    this.cellInstances(mergeGeos(palm), palmMat, S.palms, (t, d, col) => { d.position.set(t.x, t.y - 0.1, t.z); d.rotation.set(0, t.rot, t.lean); d.scale.setScalar(t.s); const v = vis(t.x, t.z); col.setRGB(v, v, v); }, { cast: true, dist: 900 });
  },
});

'use strict';
