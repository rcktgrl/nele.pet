'use strict';
/* Red Mesa Rally · Port Calder scenery: buildings, docks, harbour, streets, stadium, ship, ramps, roadside */

/* ===================================================================
   RED MESA RALLY — eastern scenery. buildEast() below builds all of it in order;
   the parts live here (Port Calder) and in tunnel-gfx.js, metro-gfx.js,
   rail-gfx.js and river-gfx.js. Shared helpers: signFace, mergeByMaterial.
   =================================================================== */
function textTex(w, h, draw, opts) { return makeCanvasTex(w, h, draw, opts); }
function signFace(lines, opts = {}) {
  return textTex(1024, 256, (g, w, h) => {
    g.fillStyle = opts.bg || '#0f5c38'; g.fillRect(0, 0, w, h);
    g.strokeStyle = opts.fg || '#f4f1e8'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = opts.fg || '#f4f1e8'; g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((l, i) => {
      const y = h / 2 + (i - (n - 1) / 2) * (h * 0.38);
      g.font = `700 ${n > 1 ? 86 : 110}px "Saira Condensed", "Arial Narrow", sans-serif`;
      if (Array.isArray(l)) { g.textAlign = 'left'; g.fillText(l[0], 48, y); g.textAlign = 'right'; g.fillText(l[1], w - 48, y); }
      else { g.textAlign = 'center'; g.fillText(l, w / 2, y); }
    });
  });
}

/* collapse a group's direct static meshes into one mesh per material (fewer draw calls) */
function mergeByMaterial(g, skip) {
  const buckets = new Map();
  for (const o of [...g.children]) {
    if (!o.isMesh || (skip && skip.has(o))) continue;
    o.updateMatrix();
    const geo = o.geometry.clone().applyMatrix4(o.matrix);
    let b = buckets.get(o.material); if (!b) { b = { list: [], cast: false, recv: false }; buckets.set(o.material, b); }
    b.list.push(geo); b.cast = b.cast || o.castShadow; b.recv = b.recv || o.receiveShadow;
    g.remove(o); o.geometry.dispose();
  }
  for (const [mat, b] of buckets) {
    let nv = 0, ni = 0; for (const q of b.list) { nv += q.attributes.position.count; ni += q.index ? q.index.count : q.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const q of b.list) {
      const n = q.attributes.position.count;
      pos.set(q.attributes.position.array, vo * 3); nor.set(q.attributes.normal.array, vo * 3);
      if (q.attributes.uv) uv.set(q.attributes.uv.array, vo * 2);
      if (q.index) for (let i = 0; i < q.index.count; i++) idx[io++] = q.index.array[i] + vo; else for (let i = 0; i < n; i++) idx[io++] = vo + i;
      vo += n; q.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat); m.castShadow = b.cast; m.receiveShadow = b.recv; g.add(m);
  }
  return g;
}

Object.assign(Gfx.prototype, {
  buildEast() {
    this.buildFarLand();
    this.buildCity();
    this.buildDocks();
    this.buildRamps();
    this.buildDecks();
    this.buildShip();
    this.buildStadium();
    this.buildStreets();
    this.buildRoadside();
    this.buildTunnel();
    this.buildRiver();
    this.buildMetro();
    this.buildTunnelGate(); this.buildRailGates();
    this.buildRail();
    this.buildCrossings();
    this.buildTrain();
  },
  /* ---------- buildings ---------- */
  buildingMaterial(style) {
    const P = { glass: { r: 0.55, m: 0.2, ws: 2.2 }, office: { r: 0.85, m: 0.05, ws: 3.0 }, brick: { r: 0.9, m: 0.0, ws: 2.6 }, warehouse: { r: 0.8, m: 0.3, ws: 7.0 } }[style];
    const m = new THREE.MeshStandardMaterial({ roughness: P.r, metalness: P.m, envMapIntensity: 1.0 });
    const winRect = { glass: [0.04, 0.96, 0.08, 0.94], office: [0.16, 0.84, 0.26, 0.8], brick: [0.26, 0.74, 0.24, 0.74], warehouse: [0.1, 0.9, 0.62, 0.86] }[style];
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;').replace('#include <begin_vertex>', `#include <begin_vertex>
mat4 bm = modelMatrix;
#ifdef USE_INSTANCING
bm = modelMatrix * instanceMatrix;
#endif
vBW = (bm * vec4(position, 1.0)).xyz; vBN = normalize(mat3(bm) * normal);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vBW; varying vec3 vBN; float gWin; float gLit;
${NOISE_GLSL}`).replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 N = normalize(vBN), P = vBW;
  float roof = step(0.5, N.y), bottom = step(N.y, -0.5);
  float u = dot(P.xz, vec2(-N.z, N.x));
  float v = P.y - ${CITY.y.toFixed(1)};
  vec2 cell = vec2(u / ${P.ws.toFixed(2)}, v / 3.5); vec2 f = fract(cell); vec2 id = floor(cell);
  // window grid prefiltered per axis: columns blur out before floors do
  vec2 fwc = max(fwidth(cell), vec2(1e-4));
  vec2 aa2 = smoothstep(vec2(0.3), vec2(0.8), fwc);
  float aaf = max(aa2.x, aa2.y);
  float wx = mix(step(${winRect[0]}, f.x) * step(f.x, ${winRect[1]}), ${(winRect[1]-winRect[0]).toFixed(3)}, aa2.x);
  float wy = mix(step(${winRect[2]}, f.y) * step(f.y, ${winRect[3]}), ${(winRect[3]-winRect[2]).toFixed(3)}, aa2.y);
  float win = wx * wy;
  ${style === 'warehouse' ? 'win *= step(4.0, v);' : 'float shop = step(0.6, v) * step(v, 3.6) * step(0.06, fract(u / 6.0)); win = v < 4.2 ? shop : win;'}
  win *= 1.0 - roof;
  vec3 base = diffuseColor.rgb;
  ${style === 'brick' ? 'vec2 bk = vec2(u * 2.2 + step(0.5, fract(v * 4.0)) * 0.5, v * 4.0); base *= 0.86 + 0.14 * step(0.08, fract(bk.x)) * step(0.1, fract(bk.y)); base *= 0.9 + 0.2 * hash12(floor(bk));' : ''}
  ${style === 'office' ? 'base *= 0.88 + 0.12 * step(0.1, f.y); base *= 0.92 + 0.08 * vnoise(P.xz * 0.3 + P.y);' : ''}
  ${style === 'warehouse' ? 'base *= 0.82 + 0.18 * step(0.5, fract(u * 1.6));' : ''}
  ${style === 'glass' ? 'base = mix(base, base * 0.6, 0.5);' : ''}
  float litF = ${style === 'warehouse' ? '0.04' : '0.1'};
  float lit = mix(step(hash12(id * 1.37 + floor(P.xz / 40.0) * 7.1), litF) * win * step(1.0, id.y), litF * win, aaf);
  vec3 glassC = ${style === 'glass' ? 'mix(vec3(0.16, 0.21, 0.26), vec3(0.24, 0.28, 0.3), hash12(id) * (1.0 - aaf) + 0.5 * aaf)' : 'mix(vec3(0.1, 0.12, 0.14), vec3(0.16, 0.18, 0.2), hash12(id) * (1.0 - aaf) + 0.5 * aaf)'};
  diffuseColor.rgb = mix(base, glassC, win);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.14, 0.15) * (0.8 + 0.3 * vnoise(P.xz * 0.4)), roof);
  gWin = win; gLit = lit;
}`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, gWin);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.55, gWin);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gLit * vec3(1.0, 0.72, 0.45) * 0.45;');
    };
    m.customProgramCacheKey = () => 'bld' + style;
    return m;
  },
  buildCity() {
    const C = this.world.city, rng = mulberry32(77);
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const pal = {
      glass: [[0.32, 0.4, 0.46], [0.24, 0.3, 0.36], [0.38, 0.42, 0.4]],
      office: [[0.62, 0.58, 0.52], [0.5, 0.5, 0.5], [0.7, 0.66, 0.58], [0.42, 0.44, 0.47]],
      brick: [[0.52, 0.26, 0.18], [0.6, 0.36, 0.24], [0.42, 0.22, 0.16], [0.66, 0.52, 0.38]],
      warehouse: [[0.45, 0.48, 0.5], [0.55, 0.3, 0.22], [0.36, 0.42, 0.38]],
    };
    for (const style of ['glass', 'office', 'brick', 'warehouse']) {
      const list = C.buildings.filter((b) => b.style === style);
      this.cellInstances(box, this.buildingMaterial(style), list, (b, d, col) => {
        d.position.set(b.x, b.y0, b.z); d.rotation.set(0, b.yaw, 0); d.scale.set(b.w, b.base + b.h - b.y0, b.d);
        const c = pal[style][Math.floor(b.tone * pal[style].length)]; col.setRGB(c[0], c[1], c[2]);
      }, { cast: true, dist: 4000, cell: 500 });
    }
    // rooftop clutter: AC units, water tanks, antennas
    const ac = [], tanks = [], masts = [];
    for (const b of C.buildings) {
      const top = b.base + b.h, c = Math.cos(b.yaw), s = Math.sin(b.yaw), at = (m) => { const a = (rng() - 0.5) * (b.w - m), e = (rng() - 0.5) * (b.d - m); return { x: b.x + a * c + e * s, z: b.z - a * s + e * c }; };
      if (b.h > 70 && b.crown) masts.push({ x: b.x, z: b.z, y: top, h: 8 + rng() * 14 });
      if (b.crown) continue;
      for (let k = 0; k < 1 + Math.floor(rng() * 3); k++) ac.push({ ...at(6), y: top, s: 1.5 + rng() * 2.5, rot: b.yaw + Math.floor(rng() * 4) * Math.PI / 2 });
      if (b.style === 'brick' && rng() < 0.45) tanks.push({ ...at(8), y: top });
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.6 });
    this.cellInstances(box, metal, ac, (a, d) => { d.position.set(a.x, a.y, a.z); d.scale.set(a.s, a.s * 0.6, a.s * 1.4); d.rotation.set(0, a.rot, 0); }, { cast: true, dist: 1200, cell: 400 });
    const tankGeo = mergeGeos([tint(new THREE.CylinderGeometry(2, 2, 4, 12).translate(0, 5.5, 0), 0.45, 0.32, 0.2), tint(new THREE.ConeGeometry(2.2, 1.6, 12).translate(0, 8.3, 0), 0.3, 0.22, 0.15), ...[[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([x, z]) => tint(new THREE.CylinderGeometry(0.12, 0.12, 3.5).translate(x, 1.75, z), 0.2, 0.2, 0.2))]);
    this.cellInstances(tankGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), tanks, (t, d) => d.position.set(t.x, t.y, t.z), { cast: true, dist: 1500, cell: 1600 });
    const mastGeo = new THREE.CylinderGeometry(0.15, 0.35, 1, 6); mastGeo.translate(0, 0.5, 0);
    this.cellInstances(mastGeo, metal, masts, (t, d) => { d.position.set(t.x, t.y, t.z); d.scale.set(1, t.h, 1); }, { cast: false, dist: 4000, cell: 1600 });
    const beacon = new THREE.SphereGeometry(0.5, 8, 6);
    this.cellInstances(beacon, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }), masts, (t, d) => d.position.set(t.x, t.y + t.h, t.z), { cast: false, dist: 6000, cell: 1600 });
    // street lights
    const pole = mergeGeos([tint(new THREE.CylinderGeometry(0.09, 0.14, 8, 6).translate(0, 4, 0), 0.22, 0.23, 0.25), tint(new THREE.BoxGeometry(2.4, 0.12, 0.14).translate(1.2, 7.9, 0), 0.22, 0.23, 0.25), tint(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8).translate(0, 0.3, 0), 0.18, 0.18, 0.2)]);
    const head = new THREE.BoxGeometry(0.7, 0.16, 0.38); head.translate(2.3, 7.78, 0);
    this.cellInstances(pole, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), C.lamps, (l, d) => { d.position.set(l.x, l.y, l.z); d.rotation.set(0, -l.yaw, 0); }, { cast: true, dist: 900, cell: 400 });
    this.cellInstances(head, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.2) }), C.lamps, (l, d) => { d.position.set(l.x, l.y, l.z); d.rotation.set(0, -l.yaw, 0); }, { cast: false, dist: 1600, cell: 500 });
    // rooftop billboards: the story is written on the skyline
    const ads = [
      ['CALDER STADIUM', 'COMING SOON · A VIC CALDER DEVELOPMENT', '#141414', '#f2c230'],
      ['KRMR 98.7', 'RED MESA RADIO · ALL DUST, ALL DAY', '#ff6a1a', '#120c09'],
      ['KAZE GT4', 'BUILT FOR THE CITY', '#1d4f9a', '#f4f1e8'],
      ['IRONSIDE V8', 'NO REPLACEMENT FOR DISPLACEMENT', '#7a1016', '#f4f1e8'],
      ['COASTLINE FREIGHT', 'WE DO NOT STOP · DO NOT RACE THE TRAIN', '#2b2f36', '#f2c230'],
    ];
    const route = this.world.route('harbour');
    const cands = C.buildings.filter((b) => !b.crown && b.h > 14 && b.h < 45 && route.project(b.x, b.z, 0, -1).dist < 80);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.5 });
    for (let k = 0; k < Math.min(cands.length, 10); k++) {
      const b = cands[Math.floor(k * cands.length / 10)], ad = ads[k % ads.length];
      const tex = textTex(1024, 384, (g, w, h) => { g.fillStyle = ad[2]; g.fillRect(0, 0, w, h); g.fillStyle = ad[3]; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '400 150px "Saira Stencil One", Impact, sans-serif'; g.fillText(ad[0], w / 2, h * 0.42); g.font = '700 46px "Saira Condensed", sans-serif'; g.fillText(ad[1], w / 2, h * 0.8); });
      const w = Math.min(b.w, b.d, 22), grp = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
      panel.position.y = 4 + w * 0.19; grp.add(panel);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, w * 0.375 + 0.4, 0.3), frameMat); back.position.set(0, panel.position.y, -0.2); grp.add(back);
      for (const sx of [-w / 3, w / 3]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), frameMat); leg.position.set(sx, 2, -0.2); grp.add(leg); }
      const cx = b.x, cz = b.z, pr = route.project(cx, cz, 0, -1), rp = route.posAt(pr.s, {});
      grp.position.set(cx, b.base + b.h, cz); grp.rotation.y = Math.atan2(rp.x - cx, rp.z - cz);
      if (k === 0) this.stadiumAd = { x: cx, y: b.base + b.h + panel.position.y, z: cz, nx: Math.sin(grp.rotation.y), nz: Math.cos(grp.rotation.y), w };
      grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(grp);
    }
  },
  /* ---------- docks: containers, cranes, quay ---------- */
  buildDocks() {
    const C = this.world.city;
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.35 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;').replace('#include <begin_vertex>', `#include <begin_vertex>
mat4 bm = modelMatrix;
#ifdef USE_INSTANCING
bm = modelMatrix * instanceMatrix;
#endif
vBW = (bm * vec4(position, 1.0)).xyz; vBN = normalize(mat3(bm) * normal);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;').replace('#include <color_fragment>', `#include <color_fragment>
{ vec3 N = normalize(vBN); float u = abs(N.x) > 0.5 ? vBW.z : vBW.x; float v = vBW.y - ${CITY.y.toFixed(1)};
  float rib = 0.82 + 0.18 * step(0.5, fract(u * 3.3)); float seam = step(0.04, fract(v / 2.6)) * step(fract(v / 2.6), 0.97);
  diffuseColor.rgb *= mix(1.0, rib, 1.0 - step(0.5, abs(N.y))) * mix(0.45, 1.0, seam); }`);
    };
    mat.customProgramCacheKey = () => 'container';
    this.cellInstances(box, mat, C.containers, (k, d, col) => { d.position.set((k.x0 + k.x1) / 2, k.y ?? CITY.y, (k.z0 + k.z1) / 2); d.scale.set(k.x1 - k.x0, k.h, k.z1 - k.z0); col.setHex(k.color); }, { cast: true, dist: 1600, cell: 500 });
    // gantry cranes
    for (const c of C.cranes) {
      const parts = [], col = new THREE.Color(c.color);
      const t = (g, cc = col) => { tint(g, cc.r, cc.g, cc.b); parts.push(g); };
      for (const [lx, lz] of [[-9, -6], [9, -6], [-9, 6], [9, 6]]) t(new THREE.BoxGeometry(1.2, 34, 1.2).translate(lx, 17, lz));
      for (const lz of [-6, 6]) t(new THREE.BoxGeometry(20, 1.6, 1.4).translate(0, 34, lz));
      for (const lx of [-9, 9]) t(new THREE.BoxGeometry(1.4, 1.4, 13).translate(lx, 22, 0));
      t(new THREE.BoxGeometry(2.4, 2, 70).translate(0, 37, 18));
      t(new THREE.BoxGeometry(7, 5, 9).translate(0, 39, -9), new THREE.Color(0.85, 0.83, 0.78));
      t(new THREE.BoxGeometry(2.2, 2.6, 2.6).translate(0, 34.6, 22), new THREE.Color(0.2, 0.22, 0.25));
      for (const z of [10, 30, 46]) t(new THREE.CylinderGeometry(0.06, 0.06, 18).translate(0, 27, z), new THREE.Color(0.1, 0.1, 0.1));
      const mesh = new THREE.Mesh(mergeGeos(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }));
      mesh.position.set(c.x, CITY.y, c.z); mesh.rotation.y = c.yaw === 0 ? 0 : -Math.PI / 2;
      mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    }
    // quay walls along the harbour edges
    const wall = new THREE.MeshStandardMaterial({ color: 0x6f6a63, roughness: 0.95 });
    const qa = SLIP.x - SLIP.hw - 1, qb = SLIP.x + SLIP.hw + 1, QH = 20;
    const q1 = new THREE.Mesh(new THREE.BoxGeometry(3, QH, FLAT.z1 - FLAT.z0 + 3), wall); q1.position.set(FLAT.x1 + 1.5, CITY.y - QH / 2, (FLAT.z0 + FLAT.z1 + 3) / 2);
    const q2 = new THREE.Mesh(new THREE.BoxGeometry(qa - 4250, QH, 3), wall); q2.position.set((4250 + qa) / 2, CITY.y - QH / 2, FLAT.z1 + 1.5);
    const q3 = new THREE.Mesh(new THREE.BoxGeometry(FLAT.x1 - qb, QH, 3), wall); q3.position.set((qb + FLAT.x1) / 2, CITY.y - QH / 2, FLAT.z1 + 1.5);
    for (const q of [q1, q2, q3]) { q.receiveShadow = true; this.scene.add(q); }
    this.buildHarbour(wall);
  },
  /* ---------- the slipway, a pontoon with moored boats, and the lake jetty ---------- */
  buildHarbour(wall) {
    const T = this.world.terrain, S = this.world.scatter;
    // slipway deck and its side walls follow the physics ramp
    const pos = [], nor = [], uv = [], idx = [], quad = (a, b, c, d, n) => { const v = pos.length / 3; for (const q of [a, b, c, d]) { pos.push(...q); nor.push(...n); } uv.push(0, 0, 1, 0, 0, 1, 1, 1); idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); };
    const hz = (z) => T.height(SLIP.x, z) + 0.04, z0 = SLIP.z0, z1 = SLIP.z1 + 6, step = 2;
    for (let z = z0; z < z1; z += step) {
      const za = z, zb = Math.min(z1, z + step), ya = hz(za), yb = hz(zb), sl = Math.atan2(ya - yb, step);
      quad([SLIP.x - SLIP.hw, ya, za], [SLIP.x + SLIP.hw, ya, za], [SLIP.x - SLIP.hw, yb, zb], [SLIP.x + SLIP.hw, yb, zb], [0, Math.cos(sl), Math.sin(sl)]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const conc = makeCanvasTex(128, 128, (x, w, h) => { x.fillStyle = '#8d8780'; x.fillRect(0, 0, w, h); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#7f7972' : '#99938b'; x.fillRect(0, i * h / 8, w, 3); } }, { repeat: true });
    const deck = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9 })); deck.receiveShadow = true; this.scene.add(deck);
    for (const sd of [-1, 1]) {
      const L = SLIP.z1 - FLAT.z1, m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, L), wall);
      const yTop = (hz(FLAT.z1) + hz(SLIP.z1)) / 2 + 0.6, bottom = -14;
      m.scale.y = yTop - bottom; m.position.set(SLIP.x + sd * (SLIP.hw + 0.6), (yTop + bottom) / 2, FLAT.z1 + L / 2); m.receiveShadow = true; this.scene.add(m);
    }
    // a pontoon off the east side of the slip, boats tied up along it
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
    const px = SLIP.x + 42, pz0 = FLAT.z1 + 3, pz1 = FLAT.z1 + 78;
    const pont = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, pz1 - pz0), wood); pont.position.set(px, WATER_Y + 0.45, (pz0 + pz1) / 2); pont.receiveShadow = true; pont.castShadow = true; this.scene.add(pont);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 9), wood); ramp.position.set(px, (CITY.y + WATER_Y) / 2 + 0.4, FLAT.z1 + 4); ramp.rotation.x = Math.atan2(CITY.y - WATER_Y - 0.6, 9); this.scene.add(ramp);
    { const o = S.addSegment(px, pz0, px, pz1, WATER_Y + 1.2, 'barrier'); o.r = 1.8; }
    const moored = [[px - 4.2, 818, 0x1f4e79], [px - 4.2, 846, 0xd9481c], [px + 4.2, 826, 0xf0b50a], [px + 4.2, 858, 0x2f6f53], [SLIP.x - 70, FLAT.z1 + 6, 0xe9e2d6, Math.PI / 2]];
    moored.forEach(([x, z, color, yaw], i) => {
      const m = buildCar(VEHICLES.boat, { color, number: 60 + i * 7, livery: 'PORT CALDER' }, this).root;
      m.position.set(x, WATER_Y + VEHICLES.boat.boat.ride, z); m.rotation.y = yaw || 0; this.scene.add(m);
      const fx = -Math.sin(yaw || 0), fz = -Math.cos(yaw || 0); S.addSegment(x - fx * 2.6, z - fz * 2.6, x + fx * 2.6, z + fz * 2.6, WATER_Y + 1.5, 'barrier').r = 1.1;
    });
    // bollards along the quay edge
    const boll = [];
    for (let x = 4300; x < FLAT.x1; x += 24) if (Math.abs(x - SLIP.x) > SLIP.hw + 4) boll.push({ x, z: FLAT.z1 - 0.8 });
    for (let z = -740; z < FLAT.z1; z += 24) boll.push({ x: FLAT.x1 - 0.8, z });
    this.cellInstances(new THREE.CylinderGeometry(0.28, 0.34, 0.8, 8).translate(0, 0.4, 0), new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.4 }), boll, (b, d) => d.position.set(b.x, CITY.y, b.z), { cast: true, dist: 600 });
    // lake jetty
    { // from the bank out over the water on piles
      const L = BOAT_DOCKS[1], len = Math.hypot(L.water.x - L.land.x, L.water.z - L.land.z), ux = (L.water.x - L.land.x) / len, uz = (L.water.z - L.land.z) / len;
      let s0 = 0; while (s0 < len && T.rawH(L.land.x + ux * s0, L.land.z + uz * s0) > WATER_Y + 0.6) s0 += 1;
      const a = s0 - 5, b = s0 + 30, y = WATER_Y + 1.1, parts = [new THREE.BoxGeometry(3, 0.3, b - a).translate(0, y, (a + b) / 2)];
      for (let t = a + 1; t < b; t += 4) for (const sx of [-1.4, 1.4]) parts.push(new THREE.CylinderGeometry(0.16, 0.16, 4, 6).translate(sx, y - 2, t));
      for (const sx of [-1.4, 1.4]) parts.push(new THREE.BoxGeometry(0.12, 0.12, b - a - 4).translate(sx, y + 0.9, (a + b) / 2 + 2), ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.BoxGeometry(0.12, 0.9, 0.12).translate(sx, y + 0.45, a + 6 + k * (b - a - 6) / 7)));
      const jet = new THREE.Mesh(mergeGeos(parts), wood);
      jet.position.set(L.land.x, 0, L.land.z); jet.rotation.y = Math.atan2(ux, uz); jet.castShadow = jet.receiveShadow = true; this.scene.add(jet);
    }
    // launch signs
    for (const D of BOAT_DOCKS) {
      const grp = new THREE.Group(), y = T.height(D.land.x, D.land.z);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: signFace(['BOAT LAUNCH'], { bg: '#1f4e79' }), roughness: 0.5, side: THREE.DoubleSide }));
      panel.position.y = 3; grp.add(panel);
      for (const sx of [-1.7, 1.7]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3, 0.12), wall); post.position.set(sx, 1.5, 0); grp.add(post); }
      grp.position.set(D.land.x + 7, y, D.land.z); grp.rotation.y = D.land.yaw; this.scene.add(grp);
    }
  },
  /* ---------- rooftop car parks: ramp strips, parapets, bay lines on the roofs ---------- */
  buildDecks() {
    const para = new THREE.MeshStandardMaterial({ color: 0xd9481c, roughness: 0.6 });
    for (const P of this.world.city.carParks) {
      const { sl } = P, n = 24;
      // the ramp deck as a solid wedge, sloped top
      const pos = [], idx = [], add = (a, b, c, d) => { const v = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); };
      for (let k = 0; k < n; k++) {
        const a0 = sl.Lt * k / n, a1 = sl.Lt * (k + 1) / n, z0 = sl.z - a0, z1 = sl.z - a1, y0 = overlayLift(sl, sl.x, z0) + 0.03, y1 = overlayLift(sl, sl.x, z1) + 0.03, xl = sl.x - sl.hw, xr = sl.x + sl.hw;
        add([xl, y0, z0], [xr, y0, z0], [xl, y1, z1], [xr, y1, z1]);
        add([xl, CITY.y - 0.5, z0], [xl, y0, z0], [xl, CITY.y - 0.5, z1], [xl, y1, z1]);
        add([xr, y0, z0], [xr, CITY.y - 0.5, z0], [xr, y1, z1], [xr, CITY.y - 0.5, z1]);
        // parapet on the open side
        const xo = sl.x + P.side * (sl.hw + 0.15);
        add([xo, y0, z0], [xo, y0 + 1.0, z0], [xo, y1, z1], [xo, y1 + 1.0, z1]);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8d8780, roughness: 0.9, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
      const zEnd = sl.z - sl.Lt, cap = new THREE.Mesh(new THREE.BoxGeometry(sl.hw * 2, 1.0, 0.3), para); cap.position.set(sl.x, P.y + 0.5, zEnd + 0.15); this.scene.add(cap);
      // parking bays painted on the roof
      const b = P.b, lines = [];
      for (let x = b.x0 + 8; x < b.x1 - 6; x += 2.8) for (const z of [b.z0 + 6, b.z1 - 11]) { const l = new THREE.PlaneGeometry(0.15, 5); l.rotateX(-Math.PI / 2); l.translate(x, P.y + 0.04, z + 2.5); lines.push(l); }
      const lm = new THREE.Mesh(mergeGeos(lines), new THREE.MeshBasicMaterial({ color: 0xe9e2d6 })); this.scene.add(lm);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshStandardMaterial({ map: signFace(['ROOF PARKING ↑'], { bg: '#1f4e79' }), roughness: 0.5, side: THREE.DoubleSide }));
      sign.position.set(sl.x, CITY.y + 4.2, sl.z + 0.4); this.scene.add(sign);
    }
  },
  /* ---------- the container ship at the east quay ---------- */
  /* ---------- Calder Stadium: a bowl of stands round the pitch, the east side still a building site ---------- */
  /* ---------- the street plan: paint at the junctions and in the car parks, signals, stop signs, parked cars, fences ---------- */
  buildStreets() {
    const C = this.world.city, S = C.streets, T = this.world.terrain;
    // paint: flat quads a hair above the ground, bucketed so far-off ones drop out
    const cells = new Map(), quad = (o) => {
      const px = -o.uz, pz = o.ux, vs = [];
      for (const [u, l] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = o.x + o.ux * u * o.hl + px * l * o.hw, z = o.z + o.uz * u * o.hl + pz * l * o.hw, y = T.rawH(x, z);
        if (Math.abs(T.height(x, z) - y) > 0.5) return; // the river or the boat tunnel's cut took the ground away: no paint hanging in the air
        vs.push(x, y + 0.035, z);
      }
      const k = cellKey(o.x, o.z, 400); let a = cells.get(k); if (!a) cells.set(k, a = []);
      a.push(...vs);
    };
    for (const o of S.paint) quad(o);
    const paintMat = new THREE.MeshStandardMaterial({ color: 0xd8d4ca, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    for (const pos of cells.values()) {
      const n = pos.length / 3, idx = []; for (let v = 0; v < n; v += 4) idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, paintMat); m.receiveShadow = true; m.boundingSphere = geo.boundingSphere; m.userData.drawDist = 700; this.scene.add(m); this.cullList.push(m);
    }
    // traffic signals: a pole on the corner, a mast arm over the lane, a head on each; the two axes take turns
    const dark = [0.16, 0.17, 0.16];
    const darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
    // the arm is stretched to its reach, so build pole and arm-end head separately
    const pole = mergeGeos([tint(new THREE.CylinderGeometry(0.11, 0.14, 5.8, 8).translate(0, 2.9, 0), ...dark), tint(new THREE.BoxGeometry(0.36, 1.05, 0.3).translate(0, 3.0, 0.22), 0.12, 0.12, 0.1)]);
    const arm = tint(new THREE.BoxGeometry(1, 0.14, 0.14).translate(-0.5, 5.55, 0), ...dark), head = tint(new THREE.BoxGeometry(0.36, 1.05, 0.3).translate(0, 4.95, 0), 0.12, 0.12, 0.1);
    const place = (l, d) => { d.position.set(l.x, l.y, l.z); d.rotation.set(0, l.yaw, 0); };
    this.cellInstances(pole, darkMat, S.signals, place, { cast: true, dist: 700, cell: 400 });
    this.cellInstances(arm, darkMat, S.signals, (l, d) => { place(l, d); d.scale.set(l.reach, 1, 1); }, { cast: true, dist: 700, cell: 400 });
    this.cellInstances(head, darkMat, S.signals, (l, d) => { place(l, d); d.translateX(-l.reach + 0.3); }, { cast: true, dist: 700, cell: 400 });
    this.signalMats = [];
    const lens = new THREE.CircleGeometry(0.12, 10);
    for (const ph of [0, 1]) for (const [k, dy] of [[0, 0.32], [1, 0], [2, -0.32]]) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x111111 }); this.signalMats.push({ mat, ph, k });
      const list = S.signals.filter((l) => l.phase === ph);
      this.cellInstances(lens, mat, list.flatMap((l) => [{ ...l, at: 0 }, { ...l, at: 1 }]), (l, d) => {
        place(l, d); if (l.at) d.translateX(-l.reach + 0.3); d.translateY(l.at ? 4.95 + dy : 3.0 + dy); d.translateZ(l.at ? 0.16 : 0.38);
      }, { cast: false, dist: 900, cell: 400 });
    }
    // stop signs
    const stopTex = textTex(256, 256, (g, w, h) => {
      g.fillStyle = '#b3121a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f4f1e8'; g.lineWidth = 12;
      g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(w / 2 + Math.cos(a) * 112, h / 2 + Math.sin(a) * 112); } g.closePath(); g.stroke();
      g.fillStyle = '#f4f1e8'; g.font = '700 84px "Saira Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', w / 2, h / 2 + 4);
    });
    const oct = new THREE.CircleGeometry(0.42, 8, Math.PI / 8); oct.translate(0, 2.35, 0.06);
    this.cellInstances(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.6 }), S.stops, place, { cast: true, dist: 600, cell: 400 });
    this.cellInstances(oct, new THREE.MeshStandardMaterial({ map: stopTex, roughness: 0.6, side: THREE.DoubleSide }), S.stops, place, { cast: false, dist: 600, cell: 400 });
    // parked cars: a body in the owner's colour, dark glass, black tyres
    const wheels = (L) => [[-0.82, -L], [0.82, -L], [-0.82, L], [0.82, L]].map(([x, z]) => tint(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10).rotateZ(Math.PI / 2).translate(x, 0.34, z), 0.06, 0.06, 0.06));
    const sedan = mergeGeos([tint(new THREE.BoxGeometry(1.82, 0.62, 4.4).translate(0, 0.66, 0), 1, 1, 1), tint(new THREE.BoxGeometry(1.6, 0.52, 2.2).translate(0, 1.22, -0.2), 0.08, 0.1, 0.12), ...wheels(1.36)]);
    const van = mergeGeos([tint(new THREE.BoxGeometry(1.9, 1.5, 5.1).translate(0, 1.1, 0), 1, 1, 1), tint(new THREE.BoxGeometry(1.86, 0.5, 0.06).translate(0, 1.45, 2.56), 0.08, 0.1, 0.12), ...wheels(1.7)]);
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.5 });
    for (const [geo, list] of [[sedan, C.parked.filter((p) => !p.van)], [van, C.parked.filter((p) => p.van)]])
      this.cellInstances(geo, carMat, list, (p, d, col) => { d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.yaw, 0); col.setRGB(...(p.van ? [0.85, 0.85, 0.82] : p.col)); }, { cast: true, dist: 800, cell: 400 });
    // fences: picket and chain-link as cut-out panels that repeat along their length; hedges as boxes
    const picket = textTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#efe9dc'; for (let i = 0; i < 4; i++) { const x = i * 32 + 6; g.beginPath(); g.moveTo(x, h); g.lineTo(x, 18); g.lineTo(x + 10, 4); g.lineTo(x + 20, 18); g.lineTo(x + 20, h); g.fill(); } g.fillRect(0, 34, w, 10); g.fillRect(0, 96, w, 10); });
    const chain = textTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#a7aaa8'; g.lineWidth = 2; for (let i = -8; i < 16; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + h, h); g.stroke(); g.beginPath(); g.moveTo(i * 16 + h, 0); g.lineTo(i * 16, h); g.stroke(); } g.fillStyle = '#7d807e'; g.fillRect(0, 0, w, 5); g.fillRect(0, 0, 6, h); });
    for (const t of [picket, chain]) { t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; }
    const kinds = { picket: { tex: picket, h: 1.1, rep: 1.2 }, chain: { tex: chain, h: 2.0, rep: 2.0 } };
    for (const kind of ['picket', 'chain']) {
      const K = kinds[kind], byCell = new Map();
      for (const f of C.fences) if (f.kind === kind) {
        const k = cellKey(f.ax, f.az, 400); let a = byCell.get(k); if (!a) byCell.set(k, a = { pos: [], uv: [] });
        const L = Math.hypot(f.bx - f.ax, f.bz - f.az), ya = T.rawH(f.ax, f.az), yb = T.rawH(f.bx, f.bz);
        a.pos.push(f.ax, ya, f.az, f.bx, yb, f.bz, f.bx, yb + K.h, f.bz, f.ax, ya + K.h, f.az); a.uv.push(0, 0, L / K.rep, 0, L / K.rep, 1, 0, 1);
      }
      const mat = new THREE.MeshStandardMaterial({ map: K.tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: kind === 'chain' ? 0.4 : 0 });
      for (const a of byCell.values()) {
        const n = a.pos.length / 3, idx = []; for (let v = 0; v < n; v += 4) idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2)); geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.boundingSphere = geo.boundingSphere; m.userData.drawDist = 650; this.scene.add(m); this.cullList.push(m);
      }
    }
    const hedges = C.fences.filter((f) => f.kind === 'hedge').map((f) => ({ x: (f.ax + f.bx) / 2, z: (f.az + f.bz) / 2, y: Math.min(T.rawH(f.ax, f.az), T.rawH(f.bx, f.bz)), L: Math.hypot(f.bx - f.ax, f.bz - f.az), yaw: Math.atan2(f.bz - f.az, f.bx - f.ax) }));
    this.cellInstances(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x2f4a1e, roughness: 1 }), hedges, (h, d) => { d.position.set(h.x, h.y - 0.1, h.z); d.rotation.set(0, -h.yaw, 0); d.scale.set(h.L + 0.6, 1.25, 0.9); }, { cast: true, dist: 650, cell: 400 });
  },
  updateSignals(t) {
    if (!this.signalMats) return;
    // 24 s cycle: one axis green 10 s, amber 2 s, then all red 0 s and the other axis gets its turn
    const c = t % 24;
    for (const { mat, ph, k } of this.signalMats) {
      const u = ph ? (c + 12) % 24 : c, state = u < 10 ? 2 : u < 12 ? 1 : 0;
      const on = state === k ? [[3, 0.25, 0.15], [3, 1.6, 0.2], [0.3, 2.6, 0.6]][k] : [[0.12, 0.03, 0.03], [0.12, 0.09, 0.02], [0.03, 0.1, 0.05]][k];
      mat.color.setRGB(...on);
    }
  },
  buildStadium() {
    const St = this.world.city.stadium; if (!St) return;
    const pos = [], col = [], idx = [], quad = (a, b, c, d, cc) => { const v = pos.length / 3; pos.push(...a, ...b, ...c, ...d); for (let i = 0; i < 4; i++) col.push(...cc); idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); };
    const P = (t, r, y) => [St.x + (St.rx - r) * Math.cos(t), St.y + y, St.z + (St.rz - r) * Math.sin(t)];
    const CON = [0.62, 0.6, 0.56], SEAT = [[0.75, 0.16, 0.12], [0.85, 0.65, 0.12], [0.75, 0.16, 0.12]], BARE = [0.5, 0.48, 0.45];
    for (let k = 0; k < St.seg; k++) {
      const t0 = k * TAU / St.seg, t1 = (k + 1) * TAU / St.seg, tm = (t0 + t1) / 2, h = St.h(tm), done = Math.cos(tm) < 0.25;
      if (Math.abs(Math.atan2(Math.sin(tm - Math.PI), Math.cos(tm - Math.PI))) < St.gap) continue;
      quad(P(t0, 0, -0.5), P(t1, 0, -0.5), P(t0, 0, h), P(t1, 0, h), CON); // outer wall
      quad(P(t1, St.depth, -0.5), P(t0, St.depth, -0.5), P(t1, St.depth, 2.4), P(t0, St.depth, 2.4), CON); // pitch wall
      quad(P(t1, St.depth, 2.4), P(t0, St.depth, 2.4), P(t1, 1, h), P(t0, 1, h), done ? SEAT[k % 3] : BARE); // the seating
      quad(P(t0, 1, h), P(t1, 1, h), P(t0, 0, h), P(t1, 0, h), CON);
    }
    for (const sd of [-1, 1]) { const t = Math.PI + sd * St.gap, a = sd > 0 ? 1 : 0; const q = [P(t, 0, -0.5), P(t, St.depth, -0.5), P(t, 0, 16), P(t, St.depth, 2.4)]; quad(...(a ? q : [q[1], q[0], q[3], q[2]]), CON); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); m.castShadow = m.receiveShadow = true; this.scene.add(m);
    // floodlight masts on the finished side, a tower crane over the unfinished one
    const parts = [], steel = [0.55, 0.57, 0.6];
    for (const t of [Math.PI * 0.72, Math.PI * 1.28]) { const [x, , z] = P(t, -4, 0); parts.push(tint(new THREE.CylinderGeometry(0.5, 0.8, 40, 8).translate(x, St.y + 20, z), ...steel), tint(new THREE.BoxGeometry(7, 4, 1).translate(x, St.y + 41, z), 0.9, 0.9, 0.85)); }
    { const [x, , z] = P(0.15, St.depth + 12, 0); parts.push(tint(new THREE.BoxGeometry(2.2, 46, 2.2).translate(x, St.y + 23, z), 0.92, 0.7, 0.1), tint(new THREE.BoxGeometry(56, 1.8, 1.8).translate(x - 14, St.y + 46, z), 0.92, 0.7, 0.1), tint(new THREE.BoxGeometry(4, 3, 3).translate(x + 12, St.y + 44.5, z), 0.35, 0.35, 0.35)); }
    const cm = new THREE.Mesh(mergeGeos(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 })); cm.castShadow = true; this.scene.add(cm);
  },
  buildShip() {
    const S = SHIP, L = S.z1 - S.z0, B = S.x1 - S.x0, cx = (S.x0 + S.x1) / 2, g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1d3a5c, roughness: 0.6, metalness: 0.3 }), red = new THREE.MeshStandardMaterial({ color: 0x8c2a1e, roughness: 0.7 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x4f6b4a, roughness: 0.85 }), white = new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.6 });
    const bottom = -10, top = S.y - 0.02;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(B, top - WATER_Y, L - 14), hullMat); hull.position.set(cx, (top + WATER_Y) / 2, S.z0 + (L - 14) / 2); g.add(hull);
    const keel = new THREE.Mesh(new THREE.BoxGeometry(B - 0.4, WATER_Y - bottom, L - 16), red); keel.position.set(cx, (WATER_Y + bottom) / 2, S.z0 + (L - 16) / 2); g.add(keel);
    // raked bow
    const bow = new THREE.Shape(); bow.moveTo(-B / 2, 0); bow.lineTo(B / 2, 0); bow.lineTo(B * 0.12, 14); bow.lineTo(-B * 0.12, 14); bow.closePath();
    const bg = new THREE.ExtrudeGeometry(bow, { depth: top - bottom, bevelEnabled: false }); bg.rotateX(Math.PI / 2); bg.translate(cx, top, S.z1 - 14);
    const bm = new THREE.Mesh(bg, hullMat); g.add(bm);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(B, L - 14), deckMat); deck.rotation.x = -Math.PI / 2; deck.position.set(cx, S.y + 0.02, S.z0 + (L - 14) / 2); deck.receiveShadow = true; g.add(deck);
    // bridge block, wings and funnel at the stern
    const br = new THREE.Mesh(new THREE.BoxGeometry(B - 4, 24, 26), this.buildingMaterial('office')); br.position.set(cx, S.y + 12, S.z0 + 13); g.add(br);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(B + 6, 1.2, 6), white); wing.position.set(cx, S.y + 21, S.z0 + 24); g.add(wing);
    const fun = new THREE.Mesh(new THREE.BoxGeometry(6, 10, 8), red); fun.position.set(cx, S.y + 29, S.z0 + 8); g.add(fun);
    // bulwarks
    for (const [x, z, w, d] of [[S.x0 + 0.3, (S.z0 + 26 + S.rampZ - S.rampHw) / 2, 0.4, S.rampZ - S.rampHw - S.z0 - 26], [S.x0 + 0.3, (S.rampZ + S.rampHw + S.z1 - 14) / 2, 0.4, S.z1 - 14 - S.rampZ - S.rampHw], [S.x1 - 0.3, (S.z0 + 26 + S.z1 - 14) / 2, 0.4, S.z1 - 14 - S.z0 - 26], [cx, S.z1 - 14.3, B, 0.4]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), hullMat); m.position.set(x, S.y + 0.55, z); g.add(m);
    }
    // name on the hull
    const name = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), new THREE.MeshStandardMaterial({ map: textTex(1024, 128, (x, w, h) => { x.clearRect(0, 0, w, h); x.fillStyle = '#f4f1e8'; x.font = '400 100px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('CALDER STAR', w / 2, h / 2 + 4); }), transparent: true, side: THREE.DoubleSide }));
    name.position.set(S.x1 + 0.05, S.y - 4, S.z1 - 60); name.rotation.y = Math.PI / 2; g.add(name);
    // ro-ro ramp up along the quay to a landing that opens onto the deck, on legs
    const R = S.ramp, rl = R.z0 - R.z1, rise = S.y - CITY.y, ang = Math.atan2(rise, rl), steel = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.6, metalness: 0.5 });
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(R.hw * 2, 0.5, Math.hypot(rl, rise)), steel);
    ramp.position.set(R.x, (S.y + CITY.y) / 2 - 0.25, (R.z0 + R.z1) / 2); ramp.rotation.x = ang; g.add(ramp);
    for (const sd of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.0, Math.hypot(rl, rise)), red); rail.position.set(R.x + sd * (R.hw + 0.1), (S.y + CITY.y) / 2 + 0.55, (R.z0 + R.z1) / 2); rail.rotation.x = ang; g.add(rail); }
    const lx0 = R.x - R.hw, lx1 = S.x0 + 0.5, lz0 = S.rampZ - S.rampHw, lz1 = S.rampZ + S.rampHw;
    const land = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 0.5, lz1 - lz0), steel); land.position.set((lx0 + lx1) / 2, S.y - 0.25, S.rampZ); g.add(land);
    for (const [x, z, w, d] of [[lx0 - 0.1, (R.z1 + lz0) / 2, 0.25, R.z1 - lz0], [(lx0 + S.x0) / 2, lz0 - 0.1, S.x0 - lx0, 0.25], [(R.x + R.hw + S.x0) / 2, lz1 + 0.1, S.x0 - R.x - R.hw, 0.25]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), red); m.position.set(x, S.y + 0.5, z); g.add(m);
    }
    for (const [x, z] of [[lx0 + 1, lz0 + 1], [lx0 + 1, lz1 - 1], [lx1 - 2, lz0 + 1], [lx1 - 2, lz1 - 1], [R.x - R.hw + 1, R.z1 + rl / 2], [R.x + R.hw - 1, R.z1 + rl / 2]]) {
      const top = z > lz1 ? S.y - rise / 2 : S.y, leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, top - CITY.y, 0.6), steel); leg.position.set(x, (top + CITY.y) / 2 - 0.5, z); g.add(leg);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
  },
  /* ---------- street kickers in Port Calder ---------- */
  buildRamps() {
    const list = this.world.city.ramps; if (!list.length) return;
    const tex = makeCanvasTex(256, 512, (x, w, h) => {
      x.fillStyle = '#2b2d31'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 9; i++) { const y = h * 0.08 + i * h * 0.075; x.fillStyle = '#f2c230'; x.beginPath(); x.moveTo(w * 0.15, y + 34); x.lineTo(w * 0.5, y); x.lineTo(w * 0.85, y + 34); x.lineTo(w * 0.85, y + 52); x.lineTo(w * 0.5, y + 18); x.lineTo(w * 0.15, y + 52); x.closePath(); x.fill(); }
      x.fillStyle = '#d9481c'; x.fillRect(0, h * 0.86, w, h * 0.14);
      for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f4f1e8' : '#16100c'; x.fillRect(i * w / 8, h * 0.94, w / 8, h * 0.06); }
    });
    const side = makeCanvasTex(256, 64, (x, w, h) => { for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#f2c230' : '#16100c'; x.beginPath(); x.moveTo(i * w / 16, h); x.lineTo(i * w / 16 + w / 32, 0); x.lineTo((i + 1) * w / 16 + w / 32, 0); x.lineTo((i + 1) * w / 16, h); x.fill(); } });
    const P = RAMP, A = [0, 2, 4, 6, 8, 10, 12, 14, 16, P.up + P.top, P.up + P.top + P.down];
    const prof = (a) => (a < P.up ? P.H * Math.pow(a / P.up, 1.25) : a < P.up + P.top ? P.H : P.H * (1 - (a - P.up - P.top) / P.down));
    const top = [], sides = [];
    const pushQ = (arr, q, uvs, n) => { arr.push({ q, uvs, n }); };
    const hw = P.hw - 0.3;
    for (let k = 0; k < A.length - 1; k++) {
      const a0 = A[k], a1 = A[k + 1], h0 = prof(a0) + 0.03, h1 = prof(a1) + 0.03, v0 = a0 / (P.up + P.top + P.down), v1 = a1 / (P.up + P.top + P.down);
      const n = new THREE.Vector3(0, a1 - a0, -(h1 - h0)).normalize();
      pushQ(top, [[-hw, h0, a0], [hw, h0, a0], [-hw, h1, a1], [hw, h1, a1]], [0, v0, 1, v0, 0, v1, 1, v1], [n.x, n.y, n.z]);
      for (const sd of [-1, 1]) pushQ(sides, [[sd * hw, -0.05, a0], [sd * hw, -0.05, a1], [sd * hw, h0, a0], [sd * hw, h1, a1]], [v0 * 4, 0, v1 * 4, 0, v0 * 4, h0 / P.H, v1 * 4, h1 / P.H], [sd, 0, 0]);
    }
    const geoOf = (quads) => {
      const pos = [], nor = [], uv = [], idx = [];
      for (const r of list) {
        const yaw = Math.atan2(r.dx, r.dz), c = Math.cos(yaw), s = Math.sin(yaw);
        for (const { q, uvs, n } of quads) {
          const v = pos.length / 3;
          for (const [lx, ly, lz] of q) pos.push(r.x + lx * c + lz * s, r.y + ly, r.z - lx * s + lz * c);
          for (let i = 0; i < 4; i++) nor.push(n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c);
          uv.push(...uvs); idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2, v, v + 2, v + 1, v + 1, v + 2, v + 3);
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere(); return g;
    };
    const mt = new THREE.Mesh(geoOf(top), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.5 }));
    const ms = new THREE.Mesh(geoOf(sides), new THREE.MeshStandardMaterial({ map: side, roughness: 0.6, metalness: 0.4 }));
    for (const m of [mt, ms]) { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
  },
  /* ---------- guard rails + sign gantries ---------- */
  buildRoadside() {
    const segs = this.world.scatter.railSegs;
    if (segs.length) {
      const pos = [], nor = [], idx = [];
      const posts = [];
      for (const s of segs) {
        const v = pos.length / 3, dx = s.bx - s.ax, dz = s.bz - s.az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        pos.push(s.ax, s.ay + 0.45, s.az, s.bx, s.by + 0.45, s.bz, s.ax, s.ay + 0.82, s.az, s.bx, s.by + 0.82, s.bz);
        for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        posts.push({ x: s.ax, y: s.ay, z: s.az });
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide }));
      m.receiveShadow = true; this.scene.add(m);
      const pg = new THREE.BoxGeometry(0.14, 1, 0.14); pg.translate(0, 0.4, 0);
      this.cellInstances(pg, new THREE.MeshStandardMaterial({ color: 0x8a8e92, roughness: 0.5, metalness: 0.6 }), posts, (p, d) => d.position.set(p.x, p.y - 0.1, p.z), { cast: false, dist: 500 });
    }
    // overhead sign gantries
    const hwy = this.world.route('hwy'), coast = this.world.route('coast'), pass = this.world.route('pass');
    const steel = new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.4, metalness: 0.7 });
    const gantry = (R, near, front, back) => {
      const s = R.project(near[0], near[1], 0, -1).s, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), hw = R.width / 2 + 1.6;
      const g = new THREE.Group();
      for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.6, 0.5), steel); post.position.set(sd * hw, 3.8, 0); g.add(post); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.6, 0.7, 0.7), steel); beam.position.y = 7.4; g.add(beam);
      const mk = (lines, flip) => { const w = Math.min(hw * 1.6, 14), pl = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: signFace(lines), roughness: 0.5, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 })); pl.position.set(0, 7.4 + w / 8 + 0.2, flip ? 0.4 : -0.4); if (flip) pl.rotation.y = Math.PI; g.add(pl); };
      if (front) mk(front, false); if (back) mk(back, true);
      g.position.set(p.x, p.y, p.z); g.rotation.y = Math.atan2(dx, dz) + Math.PI;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
    };
    gantry(hwy, [1900, 95], [['PORT CALDER', '6 km ↑'], ['SALT COAST', '2 km ↑']], [['RED MESA ↗', 'CALDER TUNNEL'], ['FESTIVAL', '1.5 km']]);
    gantry(hwy, [2700, 535], [['PORT CALDER', '2 km ↑'], ['DOCKS', 'EXIT 4']], [['SALT COAST', 'VALLEY RD'], ['RED MESA', '5 km ↑']]);
    gantry(hwy, [3050, -1345], [['KESTREL PASS', 'NEXT RIGHT ↗']], [['KESTREL PASS', 'NEXT LEFT ↖']]);
    // the interchanges on the viaduct
    gantry(hwy, [3820, -940], [['CALDER CENTRAL', 'EXIT 5 ↘'], ['DOWNTOWN', 'METRO']], [['KESTREL PASS', '2 km ↑']]);
    gantry(hwy, [3960, 30], [['CALDER CENTRAL', 'EXIT 5 ↗']], [['PORT', 'EXIT 6 ↑'], ['DOCKS', 'MARINA']]);
    gantry(this.world.route('ramp-kestrel'), [3490, -990], [['INTERSTATE', '↑ ON RAMP']], [['DOWNTOWN', 'KINGSWAY ↓']]);
    gantry(coast, [3600, 980], [['PORT CALDER', 'DOCKS ↑']], [['CALDER VALLEY', 'INTERSTATE ↑']]);
    gantry(pass, [2900, -1800], [['KESTREL PASS', 'SUMMIT 2 km']], [['CALDER VALLEY', '↓ 3 km']]);
  },
});
