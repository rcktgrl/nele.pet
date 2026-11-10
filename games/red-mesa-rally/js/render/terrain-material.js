'use strict';
/* Red Mesa Rally · Terrain look: the lighting bake, kerb and junction textures and the terrain shader */

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
  /* the boat tunnel's concrete-walled open cuts on a 1 m mask: the 4 m ground grid cannot step straight down at a wall, so whatever of the bank
     pokes out in front of one above the water is cut away in the shader (the boat tunnel's covered lid is left alone) */
  channelMask() {
    if (this.chanMask) return this.chanMask;
    const T = this.world.terrain, reaches = RIVER.reaches.filter((R) => R.id === 'tunnel'), pts = reaches.flatMap((R) => R.pts), G = 1;
    const x0 = Math.floor(Math.min(...pts.map((q) => q.x)) - 30), z0 = Math.floor(Math.min(...pts.map((q) => q.z)) - 30);
    const W = Math.ceil(Math.max(...pts.map((q) => q.x)) + 30 - x0), H = Math.ceil(Math.max(...pts.map((q) => q.z)) + 30 - z0), m = new Uint8Array(W * H);
    for (const R of reaches) for (let i = 0; i < R.pts.length - 1; i++) {
      const a = R.pts[i], b = R.pts[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1, r = Math.max(a.hw, b.hw) + 1.4;
      for (let gz = Math.floor(Math.min(a.z, b.z) - r - z0); gz <= Math.ceil(Math.max(a.z, b.z) + r - z0); gz++)
        for (let gx = Math.floor(Math.min(a.x, b.x) - r - x0); gx <= Math.ceil(Math.max(a.x, b.x) + r - x0); gx++) {
          if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
          const px = x0 + gx * G + 0.5, pz = z0 + gz * G + 0.5, t = clamp(((px - a.x) * vx + (pz - a.z) * vz) / L2, 0, 1);
          if (Math.hypot(px - a.x - vx * t, pz - a.z - vz * t) < lerp(a.hw, b.hw, t) + 1.4 && !T.inRiverTunnel(px, pz) && !T.riverTunAt(px, pz)) m[gz * W + gx] = 255;
        }
    }
    const t = new THREE.DataTexture(m, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    t.userData = { x0, z0, W, H };
    return (this.chanMask = t);
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
      const CM = this.channelMask(); sh.uniforms.uChan = { value: CM };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + TERRAIN_GLSL_PARS)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(position,1.0)).xyz; vWNrm = normal; vA = aA; vB = aB; vC = aC; vD = aD;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec3 vD; varying vec3 vWPos; varying vec3 vWNrm;
uniform sampler2D uKerb; uniform sampler2D uJunc; uniform sampler2D uChan;
${NOISE_GLSL}
float gWet; float gBump; float gGloss; vec3 gEmis;
float lineAA(float d, float w) { float f = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - f, w + f, abs(d)); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 P = vWPos; vec3 Nw = normalize(vWNrm); float slope = 1.0 - Nw.y;
  ${metroSpurs().map((sp) => `{ vec2 q = P.xz - vec2(${sp.x.toFixed(2)}, ${sp.z.toFixed(2)}); float a = dot(q, vec2(${sp.dx}, ${sp.dz})), l = abs(dot(q, vec2(${-sp.dz}, ${sp.dx}))); if (a > -0.5 && a < ${sp.cover.toFixed(1)} && l < ${(METRO.rampHw + 0.3).toFixed(2)}) discard; } // metro cut`).join('\n  ')}
  ${this.boreGLSL()}
  { vec2 cu = (P.xz - vec2(${CM.userData.x0.toFixed(1)}, ${CM.userData.z0.toFixed(1)})) / vec2(${CM.userData.W.toFixed(1)}, ${CM.userData.H.toFixed(1)});
    if (P.y > ${(WATER_Y + 0.05).toFixed(2)} && cu.x > 0.0 && cu.y > 0.0 && cu.x < 1.0 && cu.y < 1.0 && texture2D(uChan, cu).r > 0.5) discard; } // in front of a channel wall
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
});
