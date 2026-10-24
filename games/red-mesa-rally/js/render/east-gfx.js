'use strict';
/* Red Mesa Rally · Eastern scenery: Port Calder, highways, tunnel, railway */

/* ===================================================================
   RED MESA RALLY — eastern scenery: Port Calder, highways, tunnel,
   railway, level crossings and the Coastline Freight
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
      const k = cellKey(o.x, o.z, 400); let a = cells.get(k); if (!a) cells.set(k, a = []);
      const px = -o.uz, pz = o.ux;
      for (const [u, l] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = o.x + o.ux * u * o.hl + px * l * o.hw, z = o.z + o.uz * u * o.hl + pz * l * o.hw; a.push(x, T.rawH(x, z) + 0.035, z); }
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
  /* ---------- Calder Tunnel: lined bore, mountain cover, portals ---------- */
  buildTunnel() { for (const tun of this.world.tunnelSpans()) this.buildTunnelFor(tun); },
  buildTunnelFor(tun) {
    const { R, i0, i1, hw } = tun;
    // cross-section, inward-facing
    const prof = [];
    prof.push([-hw, -0.4], [-hw, 4.6]);
    for (let k = 1; k < 10; k++) { const a = Math.PI - k / 10 * Math.PI; prof.push([Math.cos(a) * hw, 4.6 + Math.sin(a) * 3.4]); }
    prof.push([hw, 4.6], [hw, -0.4]);
    const pos = [], nor = [], uv = [], idx = [];
    const n = prof.length;
    for (let i = i0; i <= i1; i++) {
      const s = i * R.step, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), rx = dz, rz = -dx;
      for (let k = 0; k < n; k++) {
        const [lx, ly] = prof[k];
        pos.push(p.x + rx * lx, p.y + ly, p.z + rz * lx);
        const cxv = -lx, cyv = 4.6 - ly; const L = Math.hypot(cxv, cyv) || 1;
        nor.push(rx * cxv / L, cyv / L, rz * cxv / L);
        uv.push(k / (n - 1), s);
      }
    }
    for (let i = 0; i < i1 - i0; i++) for (let k = 0; k < n - 1; k++) { const a = i * n + k, b = a + n; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
    const tm = new THREE.MeshStandardMaterial({ color: 0x8c877f, roughness: 0.85, side: THREE.DoubleSide });
    tm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nvarying vec2 vTU; float gLamp;`).replace('#include <color_fragment>', `#include <color_fragment>
{ float u = vTU.x, s = vTU.y;
  float tile = step(0.04, fract(s / 1.2)) * step(0.04, fract(u * 24.0));
  diffuseColor.rgb *= mix(0.7, 1.0, tile) * (0.85 + 0.25 * vnoise(vec2(u * 30.0, s * 0.5)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.66, 0.2), step(u, 0.06) * step(0.35, fract(s / 3.0)) * 0.0);
  float band = step(0.2, u) * step(u, 0.26) + step(0.74, u) * step(u, 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.6, 0.14), band * 0.8);
  gLamp = step(0.47, u) * step(u, 0.53) * step(0.82, fract(s / 9.0)); }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gLamp * vec3(4.0, 2.4, 1.0) + diffuseColor.rgb * vec3(0.55, 0.36, 0.18);');
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTU = uv;');
    };
    const tube = new THREE.Mesh(g, tm); tube.castShadow = true; tube.receiveShadow = true; this.scene.add(tube);
    // the floor of the bore, portal to portal (the ground above the bore was left alone, and the terrain is cut away where the cut meets it)
    const rail = R.surface === 'rail', fw = R.width / 2 + 1.2, fp = [], fu = [], fi = [];
    for (let i = i0; i <= i1; i++) {
      const s = i * R.step, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), rx = dz, rz = -dx;
      for (const l of [-fw, fw]) { fp.push(p.x + rx * l, p.y + 0.03, p.z + rz * l); fu.push(l < 0 ? 0 : 1, s / 12); }
    }
    for (let k = 0; k < i1 - i0; k++) { const a = k * 2, b = a + 2; fi.push(a, b, a + 1, a + 1, b, b + 1); }
    if (fi.length) {
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setIndex(fi); fg.computeVertexNormals();
      if (fg.attributes.normal.array[1] < 0) { for (let t = 0; t < fi.length; t += 3) [fi[t + 1], fi[t + 2]] = [fi[t + 2], fi[t + 1]]; fg.setIndex(fi); fg.computeVertexNormals(); }
      const floorTex = this._boreFloorTex || (this._boreFloorTex = {});
      const tex = floorTex[rail ? 'r' : 'a'] || (floorTex[rail ? 'r' : 'a'] = textTex(128, 256, (gg, w, h) => {
        const r = mulberry32(rail ? 9 : 8);
        gg.fillStyle = rail ? '#5d564e' : '#1d1e21'; gg.fillRect(0, 0, w, h);
        for (let k = 0; k < 900; k++) { const v = (rail ? 70 : 30) + r() * 40; gg.fillStyle = `rgba(${v},${v},${v + 3},0.5)`; gg.fillRect(r() * w, r() * h, 2, 2); }
        if (!rail) { gg.fillStyle = '#d8d4ca'; gg.fillRect(10, 0, 3, h); gg.fillRect(w - 13, 0, 3, h); gg.fillStyle = '#d6aa3a'; gg.fillRect(w / 2 - 2, 0, 4, h * 0.5); }
      }, { repeat: true }));
      const fm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const floor = new THREE.Mesh(fg, fm); floor.receiveShadow = true; this.scene.add(floor);
    }
    // mountain cover: the mountainside laid back over the open cut just behind each portal (deeper in, the ground was never cut)
    const reach = tun.reach, W = 12;
    const cp = [], cn = [], cA = [], cB = [], cC = [], cD = [], ci = [];
    const cut = (i) => !(R.bore && R.bore[i] && R.bore[Math.min(R.count, i + 1)]);
    for (let i = i0; i <= i1; i++) {
      const s = i * R.step, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), rx = dz, rz = -dx;
      for (let k = 0; k <= W; k++) {
        const lx = -reach + 2 * reach * k / W, x = p.x + rx * lx, z = p.z + rz * lx;
        const h = naturalHeight(x, z), e = 2;
        cp.push(x, h, z);
        const nx = naturalHeight(x - e, z) - naturalHeight(x + e, z), nz = naturalHeight(x, z - e) - naturalHeight(x, z + e), L = Math.hypot(nx, 2 * e, nz);
        cn.push(nx / L, 2 * e / L, nz / L);
        const b = biomeAt(x, z, h);
        cA.push(0, 0, 0.85, 1); cB.push(40, 8, 0, 0); cC.push(b.green, 0, 0, 0); cD.push(0, 0, 0);
      }
    }
    for (let i = 0; i < i1 - i0; i++) if (cut(i0 + i)) for (let k = 0; k < W; k++) { const a = i * (W + 1) + k, b = a + W + 1; ci.push(a, b, a + 1, a + 1, b, b + 1); }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
    cg.setAttribute('aA', new THREE.Float32BufferAttribute(cA, 4)); cg.setAttribute('aB', new THREE.Float32BufferAttribute(cB, 4)); cg.setAttribute('aC', new THREE.Float32BufferAttribute(cC, 4)); cg.setAttribute('aD', new THREE.Float32BufferAttribute(cD, 3));
    cg.setIndex(ci); cg.computeBoundingSphere();
    const cover = new THREE.Mesh(cg, this.terrainMat); cover.castShadow = true; cover.receiveShadow = true; this.scene.add(cover);
    // portals: concrete headwalls with the tunnel name
    const nameTex = textTex(1024, 160, (gg, w, h) => { gg.fillStyle = '#5d5953'; gg.fillRect(0, 0, w, h); gg.fillStyle = '#e9e3d6'; gg.font = '400 104px "Saira Stencil One", Impact, sans-serif'; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText(tun.name, w / 2, h / 2 + 4); });
    const concTex = textTex(256, 256, (gg, w, h) => {
      gg.fillStyle = '#8a837a'; gg.fillRect(0, 0, w, h);
      const r = mulberry32(31);
      for (let i = 0; i < 900; i++) { const v = 110 + r() * 40; gg.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.08 + r() * 0.1})`; gg.fillRect(r() * w, r() * h, 2 + r() * 10, 2 + r() * 10); }
      for (let i = 0; i < 14; i++) { const x = r() * w, gr = gg.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(40,30,22,.22)'); gr.addColorStop(1, 'rgba(40,30,22,0)'); gg.fillStyle = gr; gg.fillRect(x, 0, 3 + r() * 8, h * (0.3 + r() * 0.6)); }
      gg.fillStyle = 'rgba(30,26,22,.55)'; gg.fillRect(0, 0, w, 3); gg.fillRect(0, 0, 3, h);
    }, { repeat: true });
    concTex.repeat.set(1 / 4, 1 / 3);
    const conc = new THREE.MeshStandardMaterial({ map: concTex, color: 0xd8d2c8, roughness: 0.92 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x6d6760, roughness: 0.85 });
    for (const { p, dx, dz, facing, top, line } of tun.portals) {
      // the headwall top follows the ground and the mountain cover either side instead of standing proud of them
      const shape = new THREE.Shape(); shape.moveTo(-reach, -1); shape.lineTo(reach, -1);
      for (const [lx, h] of line) shape.lineTo(lx, h);
      shape.lineTo(-reach, -1);
      const hole = new THREE.Path(); hole.moveTo(-hw, -0.5); hole.lineTo(-hw, 4.6); hole.absellipse(0, 4.6, hw, 3.4, Math.PI, 0, true); hole.lineTo(hw, -0.5); hole.lineTo(-hw, -0.5); // exactly the bore's own section
      shape.holes.push(hole);
      const fg = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false, curveSegments: 16 });
      const face = new THREE.Mesh(fg, conc);
      face.position.set(p.x, p.y, p.z); face.rotation.y = Math.atan2(dx, dz) + (facing > 0 ? Math.PI : 0);
      face.castShadow = true; face.receiveShadow = true; this.scene.add(face);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.03), new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.8 }));
      plate.position.set(0, 9.4, -0.05); plate.rotation.y = Math.PI; face.add(plate);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2 * (hw + 3) + 0.8, 0.7, 2.8), capMat); cap.position.set(0, top + 0.35, 1); cap.castShadow = true; face.add(cap);
    }
  },
  /* ---------- Calder Metro: tube, ramps, stations, portals and the train ---------- */
  metroMaterial(map, emis, opts = {}) {
    // the sun never reaches the metro: no direct light, a little sky, and the lamps baked in as emission
    const m = new THREE.MeshStandardMaterial({ map, color: opts.color || 0xffffff, roughness: opts.rough ?? 0.8, metalness: opts.metal || 0, emissive: new THREE.Color(emis), emissiveMap: map || null, side: opts.side || THREE.FrontSide });
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.directDiffuse *= 0.0; reflectedLight.directSpecular *= 0.0; reflectedLight.indirectDiffuse *= 0.45; reflectedLight.indirectSpecular *= 0.6;`); };
    m.customProgramCacheKey = () => 'metro';
    return m;
  },
  buildMetro() {
    const T = this.world.terrain, M = T.metro; if (!M) return;
    const R = M.R, Y = METRO.y, CE = METRO.ceil, grp = this.metroGroup = new THREE.Group(); this.scene.add(grp);
    const B = new Map(), bucket = (k) => { let b = B.get(k); if (!b) B.set(k, b = { pos: [], nor: [], uv: [], idx: [] }); return b; };
    // a quad a-b (bottom edge) c-d (top edge), facing n; winding fixed up to face n
    const quad = (k, a, b, c, d, n, uv) => {
      const q = bucket(k), v = q.pos.length / 3; q.pos.push(...a, ...b, ...c, ...d); for (let i = 0; i < 4; i++) q.nor.push(...n); q.uv.push(...uv);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) q.idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); else q.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    };
    const P = (s, l, y) => { const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); return [p.x - dz * l, y, p.z + dx * l]; };
    const latN = (s, sg) => { const [dx, dz] = R.dirAt(s); return [-dz * sg, 0, dx * sg]; };
    // walk [s0, s1] in ~2 m steps
    const strip = (s0, s1, fn) => { const n = Math.max(1, Math.ceil((s1 - s0) / 2)); for (let k = 0; k < n; k++) fn(s0 + (s1 - s0) * k / n, s0 + (s1 - s0) * (k + 1) / n); };
    const stations = METRO.stations.map((st) => ({ ...st, s: R.project(st.at[0], st.at[1], 0, -1).s }));
    const half = METRO.stationLen / 2;
    // station runs and plain runs along the loop
    const cuts = []; for (const st of stations) cuts.push([st.s - half, st.s + half, st]);
    cuts.sort((a, b) => a[0] - b[0]);
    const runs = []; let s = cuts[cuts.length - 1][1] - R.length;
    for (const [a, b, st] of cuts) { runs.push([s, a, null]); runs.push([a, b, st]); s = b; }
    const gapsOn = (side) => M.spurs.filter((sp) => sp.side === side).map((sp) => sp.gap);
    const L0 = METRO.wallL, WR = METRO.wallR, PL = METRO.plat, TRS = METRO.tracks;
    const gapIn = (gaps) => (a, b) => gaps.some(([g0, g1]) => [-R.length, 0, R.length].some((k) => b + k > g0 && a + k < g1));
    const inGap = gapIn(gapsOn(-1)), inGapR = gapIn(gapsOn(1)); // the ramps come in through the outer wall, or past a platform's end through the inner one
    // the floor across the tube: a sleeper bed under each track, plain ballast either side
    const floor = []; let l0 = L0;
    for (const t of TRS) { if (t - 2.2 > l0) floor.push([l0, t - 2.2, 'ballast']); floor.push([t - 2.2, t + 2.2, 'bed']); l0 = t + 2.2; }
    if (WR > l0) floor.push([l0, WR, 'ballast']);
    for (const [r0, r1, st] of runs) strip(r0, r1, (a, b) => {
      const nUp = [0, 1, 0], nDn = [0, -1, 0];
      for (const [la, lb, k] of floor) quad(k, P(a, la, Y), P(b, la, Y), P(a, lb, Y), P(b, lb, Y), nUp, k === 'bed' ? [0, a / 2.4, 0, b / 2.4, 1, a / 2.4, 1, b / 2.4] : [0, a / 4, 0, b / 4, (lb - la) / 4, a / 4, (lb - la) / 4, b / 4]);
      const far = st ? PL : WR;
      quad('ceil', P(a, L0, CE), P(b, L0, CE), P(a, far, CE), P(b, far, CE), nDn, [0, a / 6, 0, b / 6, 1, a / 6, 1, b / 6]);
      if (!inGap(a, b)) quad('wall', P(a, L0, Y), P(b, L0, Y), P(a, L0, CE), P(b, L0, CE), latN(a, 1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
      if (st) {
        quad('plat', P(a, WR, Y + 1), P(b, WR, Y + 1), P(a, PL, Y + 1), P(b, PL, Y + 1), nUp, [0, a / 4, 0, b / 4, 1, a / 4, 1, b / 4]);
        quad('edge', P(a, WR, Y), P(b, WR, Y), P(a, WR, Y + 1), P(b, WR, Y + 1), latN(a, -1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
        quad('swall', P(a, PL, Y + 1), P(b, PL, Y + 1), P(a, PL, CE), P(b, PL, CE), latN(a, -1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
      } else if (!inGapR(a, b)) quad('wall', P(a, WR, Y), P(b, WR, Y), P(a, WR, CE), P(b, WR, CE), latN(a, -1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
      // the rails, two tracks of them
      for (const TR of TRS) for (const off of [-0.72, 0.72]) quad('rail', P(a, TR + off - 0.06, Y + 0.18), P(b, TR + off - 0.06, Y + 0.18), P(a, TR + off + 0.06, Y + 0.18), P(b, TR + off + 0.06, Y + 0.18), nUp, [0, 0, 0, 1, 1, 0, 1, 1]);
    });
    // station ends: walls across the platform
    for (const st of stations) for (const [sE, sg] of [[st.s - half, 1], [st.s + half, -1]]) {
      const [dx, dz] = R.dirAt(sE), n = [dx * sg, 0, dz * sg];
      quad('swall', P(sE, WR, Y), P(sE, PL, Y), P(sE, WR, CE), P(sE, PL, CE), n, [0, 0, 2, 0, 0, 1, 2, 1]);
    }
    // ceiling lamps over both tracks
    for (let s0 = 0; s0 < R.length; s0 += 9) for (const l of TRS) {
      const a = s0, b = s0 + 4, w = 0.35;
      quad('lamp', P(a, l - w, CE - 0.03), P(b, l - w, CE - 0.03), P(a, l + w, CE - 0.03), P(b, l + w, CE - 0.03), [0, -1, 0], [0, 0, 0, 1, 1, 0, 1, 1]);
    }
    // the portal ramps
    for (const sp of M.spurs) {
      const g = METRO.rampHw + 0.3, aEnd = metroSpurEnd(sp), rx = -sp.dz, rz = sp.dx, eL = metroSpurEnd(sp, -1), eR = metroSpurEnd(sp, 1);
      const Q = (a, l, y) => [sp.x + sp.dx * a + rx * l, y, sp.z + sp.dz * a + rz * l];
      for (let a = 0; a < aEnd; a += 2) {
        const b = Math.min(aEnd, a + 2), ya = metroSpurY(a), yb = metroSpurY(b), ca = metroSpurCeil(a), cb = metroSpurCeil(b);
        const nUp = [0, 1, 0], [aL, bL, aR, bR] = [Math.min(a, eL), Math.min(b, eL), Math.min(a, eR), Math.min(b, eR)]; // each edge stops at the loop's wall, the floor tapers in between
        quad('road', Q(aL, -g, metroSpurY(aL)), Q(bL, -g, metroSpurY(bL)), Q(aR, g, metroSpurY(aR)), Q(bR, g, metroSpurY(bR)), nUp, [0, aL / 10, 0, bL / 10, 1, aR / 10, 1, bR / 10]);
        const open = a < sp.cover, ta = open ? CITY.y - 0.4 : ca, tb = open ? ta : cb; // the cut is open to the sky; up in the hall its walls stop under the hall's own walls
        if (!open) quad('ceil', Q(aL, -g, metroSpurCeil(aL)), Q(bL, -g, metroSpurCeil(bL)), Q(aR, g, metroSpurCeil(aR)), Q(bR, g, metroSpurCeil(bR)), [0, -1, 0], [0, aL / 6, 0, bL / 6, 1, aR / 6, 1, bR / 6]);
        for (const sd of [-1, 1]) {
          const e = sd < 0 ? eL : eR; if (a >= e) continue;
          const bb = Math.min(b, e), ybb = metroSpurY(bb), tbb = open ? ta : metroSpurCeil(bb), l = sd * (g - (open ? 0.03 : 0));
          if (open && ta <= Math.max(ya, ybb) + 0.05) continue;
          quad(open ? 'rwall' : 'wall', Q(a, l, ya), Q(bb, l, ybb), Q(a, l, Math.max(ta, ya)), Q(bb, l, Math.max(tbb, ybb)), [-rx * sd, 0, -rz * sd], [a / 3, 0, bb / 3, 0, a / 3, 1, bb / 3, 1]);
        }
        if (!open && (Math.floor(a / 9) !== Math.floor(b / 9))) quad('lamp', Q(a, -0.35, Math.min(ca, cb) - 0.03), Q(a + 3, -0.35, Math.min(ca, cb) - 0.03), Q(a, 0.35, Math.min(ca, cb) - 0.03), Q(a + 3, 0.35, Math.min(ca, cb) - 0.03), [0, -1, 0], [0, 0, 0, 1, 1, 0, 1, 1]);
      }
    }
    // textures
    const noise = (x, w, h, base, amt, n) => { const r = mulberry32(n); x.fillStyle = base; x.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { const v = r(); x.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${amt * r()})`; x.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); } };
    const roadTex = makeCanvasTex(256, 256, (x, w, h) => {
      noise(x, w, h, '#26272a', 0.08, 3);
      x.fillStyle = '#d8d4c8'; x.fillRect(w * 0.035, 0, 5, h); x.fillRect(w * 0.965 - 5, 0, 5, h);
      x.fillStyle = '#d9a52b'; x.fillRect(w * 0.49, 0, 6, h * 0.55);
    }, { repeat: true });
    const bedTex = makeCanvasTex(256, 128, (x, w, h) => {
      noise(x, w, h, '#3b3833', 0.25, 5);
      x.fillStyle = '#5a5249'; x.fillRect(w * 0.18, h * 0.3, w * 0.64, h * 0.4);
      x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(w * 0.18, h * 0.66, w * 0.64, h * 0.06);
    }, { repeat: true });
    const ballastTex = makeCanvasTex(128, 128, (x, w, h) => noise(x, w, h, '#3b3833', 0.25, 7), { repeat: true });
    const wallTex = makeCanvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#d9d2c2'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(80,70,60,.35)'; x.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(0, i * h / 8); x.lineTo(w, i * h / 8); x.stroke(); x.beginPath(); x.moveTo(i * w / 8, 0); x.lineTo(i * w / 8, h); x.stroke(); }
      x.fillStyle = '#1f7a8c'; x.fillRect(0, h * 0.62, w, h * 0.08); x.fillStyle = '#f2c230'; x.fillRect(0, h * 0.71, w, h * 0.02);
      const g = x.createLinearGradient(0, h, 0, h * 0.75); g.addColorStop(0, 'rgba(40,30,20,.55)'); g.addColorStop(1, 'rgba(40,30,20,0)'); x.fillStyle = g; x.fillRect(0, h * 0.75, w, h * 0.25);
    }, { repeat: true });
    const rampTex = makeCanvasTex(256, 256, (x, w, h) => {
      noise(x, w, h, '#8f8a82', 0.12, 9);
      x.fillStyle = 'rgba(40,36,30,.5)'; x.fillRect(0, h * 0.88, w, h * 0.12);
      x.fillStyle = '#1f7a8c'; x.fillRect(0, h * 0.62, w, h * 0.06);
    }, { repeat: true });
    const ceilTex = makeCanvasTex(128, 128, (x, w, h) => { noise(x, w, h, '#4b4945', 0.15, 11); x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(0, 0, w, 3); }, { repeat: true });
    const platTex = makeCanvasTex(256, 256, (x, w, h) => {
      noise(x, w, h, '#a49d92', 0.12, 13);
      x.fillStyle = '#f2c230'; x.fillRect(0, 0, w * 0.06, h);
      x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 8; i++) x.fillRect(w * 0.1, i * h / 8, w * 0.9, 1);
    }, { repeat: true });
    const mats = {
      road: this.metroMaterial(roadTex, 0x2a2622, { rough: 0.7 }),
      bed: this.metroMaterial(bedTex, 0x1c1915),
      ballast: this.metroMaterial(ballastTex, 0x1c1915),
      ceil: this.metroMaterial(ceilTex, 0x262320),
      wall: this.metroMaterial(wallTex, 0x6a6052),
      rwall: this.metroMaterial(rampTex, 0x4a463f),
      swall: this.metroMaterial(wallTex, 0x7a705f, { color: 0xf4efe2 }),
      plat: this.metroMaterial(platTex, 0x5a554c),
      edge: this.metroMaterial(null, 0x000000, { color: 0x6b6760 }),
      rail: this.metroMaterial(null, 0x302c28, { color: 0x9da3a8, metal: 0.8, rough: 0.35 }),
      lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.4) }),
    };
    for (const [k, q] of B) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(q.nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(q.uv, 2));
      geo.setIndex(q.idx); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mats[k]); m.name = 'metro-' + k; m.castShadow = k !== 'lamp' && k !== 'rail'; m.receiveShadow = k !== 'lamp'; grp.add(m);
    }
    // station names on the platform wall and across the tracks on the outer wall
    const signTex = (name) => textTex(1024, 192, (x, w, h) => {
      x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, w, h); x.fillStyle = '#1f7a8c'; x.fillRect(0, 0, w, 26); x.fillRect(0, h - 26, w, 26);
      x.fillStyle = '#c4161c'; x.beginPath(); x.arc(104, h / 2, 62, 0, TAU); x.fill(); x.fillStyle = '#f4f1e8'; x.font = '400 86px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('M', 104, h / 2 + 4);
      x.fillStyle = '#16100c'; x.font = '700 104px "Saira Condensed", sans-serif'; x.textAlign = 'left'; x.fillText(name, 196, h / 2 + 6);
    });
    for (const st of stations) {
      const tex = signTex(st.name), lit = this.metroMaterial(tex, 0xb0aa9a);
      for (const off of [-24, 0, 24]) {
        const ss = st.s + off, p = P(ss, PL - 0.05, Y + 2.6), [dx, dz] = R.dirAt(ss);
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), lit); sg.position.set(p[0], p[1], p[2]);
        sg.rotation.y = Math.atan2(dz, -dx); grp.add(sg); // faces back across the track
      }
      for (const off of [-24, 0, 24]) {
        const ss = st.s + off; if (inGap(ss - 3.5, ss + 3.5)) continue;
        const p = P(ss, L0 + 0.05, Y + 2.6), [dx, dz] = R.dirAt(ss);
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), lit); sg.position.set(p[0], p[1], p[2]);
        sg.rotation.y = Math.atan2(-dz, dx); grp.add(sg);
      }
    }
    // the station halls: a long low hall over each ramp's open stretch, the street front under a canopy with the METRO sign over it
    const conc = new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.85 }), frame = new THREE.MeshStandardMaterial({ color: 0x5f5a54, roughness: 0.85 });
    const teal = new THREE.MeshStandardMaterial({ color: 0x1f7a8c, roughness: 0.5 }), glass = new THREE.MeshStandardMaterial({ color: 0x9fd6e0, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.45 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.4, 2.0) });
    const logoTex = textTex(256, 256, (x, w, h) => { x.fillStyle = '#c4161c'; x.beginPath(); x.arc(w / 2, h / 2, w * 0.46, 0, TAU); x.fill(); x.fillStyle = '#f4f1e8'; x.font = '400 170px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('M', w / 2, h / 2 + 10); });
    const logo = new THREE.MeshStandardMaterial({ map: logoTex, emissive: 0xffffff, emissiveMap: logoTex, emissiveIntensity: 0.7, transparent: true, alphaTest: 0.5 });
    const HY = CITY.y, HH = METRO.hallH;
    for (const sp of M.spurs) {
      const g = METRO.rampHw + 0.3, Lh = sp.cover, wt = 0.9, yaw = Math.atan2(sp.dx, sp.dz), so = metroSpurCeil(Lh);
      const fg = new THREE.Group(); fg.position.set(sp.x, 0, sp.z); fg.rotation.y = yaw; // local +z runs down the ramp
      const box = (w, h, d, x, y, z, m, shadow = true) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = shadow; b.receiveShadow = true; fg.add(b); return b; };
      // side walls from the street to the roof, the back wall from the ramp's tunnel roof up, the roof with a glazed strip down the middle
      for (const sd of [-1, 1]) box(wt, HH + 0.5, Lh + 0.9, sd * (g + wt / 2), HY - 0.5 + (HH + 0.5) / 2, Lh / 2 + 0.45, conc);
      box(2 * g + 2 * wt, HY + HH - so, wt, 0, (so + HY + HH) / 2, Lh + 0.45, conc);
      for (const sd of [-1, 1]) box(g + wt - 1.6, 0.5, Lh + 0.9, sd * (1.6 + (g + wt - 1.6) / 2), HY + HH + 0.25, Lh / 2 + 0.45, frame);
      box(3.2, 0.12, Lh + 0.9, 0, HY + HH + 0.3, Lh / 2 + 0.45, glass, false);
      for (let a = 4; a < Lh; a += 7) box(2 * g, 0.3, 0.3, 0, HY + HH - 0.15, a, frame);
      for (let a = 3; a < Lh - 2; a += 7) box(0.6, 0.08, 3, 0, HY + HH - 0.36, a + 2, glow, false); // lamps under the roof
      // the street front: a lintel over the way in, the facade above it, the canopy out over the pavement on two posts
      const lin = HY + 4.6;
      box(2 * g + 2 * wt, HY + HH + 0.5 - lin, wt, 0, (lin + HY + HH + 0.5) / 2, 0.45, conc);
      box(2 * g + 2 * wt + 0.4, 0.4, 0.3, 0, HY + HH + 0.5, 0.05, teal);
      box(2 * g + 2 * wt + 3, 0.35, 6.5, 0, lin - 0.2, -3.0, frame);
      box(2 * g + 2 * wt + 3.2, 0.12, 6.7, 0, lin - 0.4, -3.0, teal, false);
      for (const sd of [-1, 1]) box(0.35, lin - HY, 0.35, sd * (g + wt + 1.0), HY + (lin - HY) / 2, -5.9, frame);
      const tex = textTex(1024, 192, (x, w, h) => {
        x.fillStyle = '#16100c'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#c4161c'; x.beginPath(); x.arc(100, h / 2, 64, 0, TAU); x.fill(); x.fillStyle = '#f4f1e8'; x.font = '400 90px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('M', 100, h / 2 + 4);
        x.textAlign = 'left'; x.font = '700 78px "Saira Condensed", sans-serif'; x.fillText(sp.name.toUpperCase(), 190, h * 0.36); x.fillStyle = '#7fd0de'; x.font = '700 56px "Saira Condensed", sans-serif'; x.fillText('CALDER METRO  ·  DRIVE IN', 190, h * 0.74);
      });
      const sw = 2 * g + 1, sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.1875), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.5 }));
      sign.position.set(0, (lin + HY + HH) / 2 + 0.1, -0.02); sign.rotation.y = Math.PI; fg.add(sign);
      // a totem with the M on it at the front corner, seen down the street
      box(1.1, HH + 3.5, 1.1, g + wt + 0.55, HY + (HH + 3.5) / 2, 0.55, teal);
      for (const [ox, oz, ry] of [[0, -0.01, Math.PI], [0.56, 0.55, Math.PI / 2], [-0.56, 0.55, -Math.PI / 2]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), logo); m.position.set(g + wt + 0.55 + ox, HY + HH + 2.4, oz); m.rotation.y = ry; fg.add(m);
      }
      this.scene.add(fg);
    }
    // the trains: the stopper in teal, the express in red, both lit up front so you can see them coming down the tube
    const winTex = textTex(512, 128, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff1cc'; for (let i = 0; i < 6; i++) x.fillRect(18 + i * 82, h * 0.18, 62, h * 0.4); });
    const plain = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.45, metalness: 0.5 }), skirt = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7 });
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.2) }), tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.15, 0.1) });
    const lampGeo = new THREE.PlaneGeometry(0.5, 0.28);
    this.metroCars = this.world.metroTrains.map((mt) => {
      const stripe = mt.express ? '#c4161c' : '#1f7a8c';
      const bodyTex = textTex(512, 128, (x, w, h) => {
        x.fillStyle = '#c9ccd0'; x.fillRect(0, 0, w, h);
        x.fillStyle = stripe; x.fillRect(0, h * 0.72, w, h * 0.12);
        x.fillStyle = '#1a2026'; for (let i = 0; i < 6; i++) x.fillRect(18 + i * 82, h * 0.18, 62, h * 0.4);
        if (!mt.express) { x.fillStyle = '#2b3036'; x.fillRect(w * 0.47, h * 0.12, 26, h * 0.7); }
      });
      const side = new THREE.MeshStandardMaterial({ map: bodyTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.5 });
      const cab = new THREE.MeshStandardMaterial({ color: mt.express ? 0xc4161c : 0x1f7a8c, roughness: 0.5, emissive: mt.express ? 0x300806 : 0x0a2a30 });
      return mt.cars.map((c) => {
        const g = new THREE.Group(), last = c.k === mt.cars.length - 1;
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.0, c.len), [side, side, plain, plain, c.k === 0 ? cab : plain, last ? cab : plain]);
        body.position.y = 1.7; body.castShadow = true; g.add(body);
        const sk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, c.len - 2), skirt); sk.position.y = 0.25; g.add(sk);
        for (const sd of [-1, 1]) {
          if (c.k === 0) { const l = new THREE.Mesh(lampGeo, head); l.position.set(sd * 0.95, 0.75, c.len / 2 + 0.02); g.add(l); }
          if (last) { const l = new THREE.Mesh(lampGeo, tail); l.position.set(sd * 0.95, 0.75, -c.len / 2 - 0.02); l.rotation.y = Math.PI; g.add(l); }
        }
        grp.add(g); return g;
      });
    });
    this.updateMetroTrain();
  },
  updateMetroTrain() {
    if (!this.metroCars) return;
    this.world.metroTrains.forEach((mt, j) => mt.cars.forEach((c, i) => { const g = this.metroCars[j][i], P = c.pose; g.position.set(P.x, P.y, P.z); g.rotation.y = P.yaw; }));
  },
  /* ---------- story-mode road closure at the west portal ---------- */
  buildTunnelGate() {
    const W = this.world, T = W.terrain, g = W.tunnelGatePose(), R = W.route('tunnel');
    const grp = new THREE.Group(); this.tunnelGate = grp; this.gateLamps = [];
    const nx = -g.dz, nz = g.dx, yaw = Math.atan2(g.dx, g.dz);
    const at = (lat, fwd = 0) => { const x = g.x + nx * lat + g.dx * fwd, z = g.z + nz * lat + g.dz * fwd; return [x, T.height(x, z), z]; };
    // chain-link fence wall to wall across the bore (the barrier segments run on into the rock)
    const wire = textTex(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(190,196,200,1)'; c.lineWidth = 3;
      for (let i = -h; i < w + h; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke(); c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); }
    }, { repeat: true, srgb: true });
    const H = 2.8, fh = g.bore - 0.15, n = Math.ceil(fh * 2 / 2.5), pos = [], uv = [], idx = [], posts = [];
    for (let k = 0; k <= n; k++) {
      const lat = -fh + 2 * fh * k / n, [x, y, z] = at(lat, 1.2);
      pos.push(x, y + 0.1, z, x, y + H, z); uv.push(lat / 1.4, 0, lat / 1.4, H / 1.4);
      if (k < n) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      if (k % 2 === 0) posts.push([x, y, z]);
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); fg.setIndex(idx); fg.computeVertexNormals();
    const fence = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: wire, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }));
    fence.castShadow = true; grp.add(fence);
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.45, metalness: 0.7 });
    const parts = [];
    for (const [x, y, z] of posts) parts.push(new THREE.CylinderGeometry(0.05, 0.05, H + 0.2, 6).translate(x, y + H / 2, z));
    const up = new THREE.Vector3(0, 1, 0);
    const beam = (ax, ay, az, bx, by, bz, r) => { const d = new THREE.Vector3(bx - ax, by - ay, bz - az), L = d.length(); const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize()); return new THREE.CylinderGeometry(r, r, L, 5).applyQuaternion(q).translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); };
    for (let k = 0; k < n; k++) { const [ax, ay, az] = at(-fh + 2 * fh * k / n, 1.2), [bx, by, bz] = at(-fh + 2 * fh * (k + 1) / n, 1.2); parts.push(beam(ax, ay + H, az, bx, by + H, bz, 0.035)); }
    const steelMesh = new THREE.Mesh(mergeGeos(parts.map((q) => tint(q, 0.55, 0.57, 0.6))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }));
    steelMesh.castShadow = true; grp.add(steelMesh); void steel;
    // jersey barriers across the carriageway, striped
    const stripe = textTex(256, 64, (c, w, h) => { c.fillStyle = '#d9d4ca'; c.fillRect(0, 0, w, h); c.fillStyle = '#c4161c'; for (let i = -h; i < w; i += 64) { c.beginPath(); c.moveTo(i, h); c.lineTo(i + 32, h); c.lineTo(i + 32 + h, 0); c.lineTo(i + h, 0); c.fill(); } });
    const shape = new THREE.Shape(); shape.moveTo(-0.32, 0); shape.lineTo(0.32, 0); shape.lineTo(0.32, 0.08); shape.lineTo(0.14, 0.3); shape.lineTo(0.1, 0.82); shape.lineTo(-0.1, 0.82); shape.lineTo(-0.14, 0.3); shape.lineTo(-0.32, 0.08); shape.lineTo(-0.32, 0);
    const jg = new THREE.ExtrudeGeometry(shape, { depth: 3.0, bevelEnabled: false }); jg.translate(0, 0, -1.5); jg.rotateY(Math.PI / 2);
    const jm = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.85 });
    const span = g.bore - 0.4, nb = Math.ceil(span * 2 / 3.1);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x5a3a08, emissive: new THREE.Color(0, 0, 0), roughness: 0.3 }); this.gateLampMat = lampMat;
    const lamps = [];
    for (let k = 0; k < nb; k++) {
      const lat = -span + (k + 0.5) * (2 * span / nb), [x, y, z] = at(lat, -0.6);
      const b = new THREE.Mesh(jg, jm); b.position.set(x, y - 0.02, z); b.rotation.y = yaw; b.castShadow = true; b.receiveShadow = true; grp.add(b);
      if (k % 2 === 0) lamps.push(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 10).rotateX(Math.PI / 2).rotateY(yaw).translate(x, y + 1.0, z));
    }
    grp.add(new THREE.Mesh(mergeGeos(lamps.map((q) => tint(q, 1, 1, 1))), lampMat));
    // the sign
    const sign = textTex(1024, 512, (c, w, h) => {
      c.fillStyle = '#f2c230'; c.fillRect(0, 0, w, h); c.strokeStyle = '#120c09'; c.lineWidth = 18; c.strokeRect(20, 20, w - 40, h - 40);
      c.fillStyle = '#120c09'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '400 150px "Saira Stencil One", Impact, sans-serif'; c.fillText('ROAD CLOSED', w / 2, h * 0.36);
      c.font = '700 64px "Saira Condensed", sans-serif'; c.fillText('CALDER TUNNEL · FESTIVAL FINALISTS ONLY', w / 2, h * 0.64);
      c.font = '700 44px "Saira Condensed", sans-serif'; c.fillText('BY ORDER OF ROSA DELGADO', w / 2, h * 0.82);
    });
    const [sx, sy, sz] = at(0, 1.0);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6, side: THREE.DoubleSide }));
    board.position.set(sx, sy + 3.1, sz); board.rotation.y = yaw + Math.PI; grp.add(board);
    for (const o of [-2.0, 2.0]) { const [px, py, pz] = at(o, 1.15); const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.3, 0.12), steel); post.position.set(px, py + 2.15, pz); post.castShadow = true; grp.add(post); }
    this.scene.add(grp);
    grp.visible = false;
  },
  setTunnelGate(closed) { if (this.tunnelGate) this.tunnelGate.visible = closed; if (this.railDoors) for (const d of this.railDoors) d.grp.visible = closed; },
  /* steel doors across the rim rail tunnels: two leaves that roll aside into the rock for a train */
  buildRailGates() {
    const stripe = textTex(256, 256, (c, w, h) => {
      c.fillStyle = '#6c7176'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) { c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, y, w, 2); }
      c.fillStyle = '#f2c230'; c.fillRect(0, h * 0.78, w, h * 0.22); c.fillStyle = '#120c09'; for (let x = -h; x < w; x += 48) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 24, h); c.lineTo(x + 24 + h * 0.22, h * 0.78); c.lineTo(x + h * 0.22, h * 0.78); c.fill(); }
    }, { repeat: true, srgb: true });
    const mat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.55, metalness: 0.6 });
    const sign = new THREE.MeshStandardMaterial({ map: signFace(['NO ENTRY', 'RAILWAY TUNNEL'], { bg: '#8c1a12' }), roughness: 0.6 });
    this.railDoors = [];
    for (const g of this.world.railGates()) {
      const grp = new THREE.Group(), H = 6.6, leaves = [];
      grp.position.set(g.x, g.y, g.z); grp.rotation.y = Math.atan2(g.dx, g.dz);
      for (const k of [-1, 1]) {
        const leaf = new THREE.Group(), w = g.half;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, 0.35), mat); m.position.set(k * w / 2, H / 2, 0); m.castShadow = true; leaf.add(m);
        if (k > 0) for (const z of [0.2, -0.2]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), sign); b.position.set(w / 2 - 1.2, 3.4, z); if (z < 0) b.rotation.y = Math.PI; leaf.add(b); }
        grp.add(leaf); leaves.push({ leaf, k, w });
      }
      this.scene.add(grp); grp.visible = false;
      this.railDoors.push({ g, grp, leaves, open: 0 });
    }
  },
  updateRailGates(dt) {
    if (!this.railDoors) return;
    for (const d of this.railDoors) {
      d.open = clamp(d.open + (d.g.shut ? -dt / 4 : dt / 4), 0, 1);
      for (const L of d.leaves) L.leaf.position.x = L.k * L.w * d.open * 0.98;
    }
  },
  updateTunnelGate(t) {
    if (!this.tunnelGate || !this.tunnelGate.visible) return;
    const on = Math.floor(t * 1.6) % 2; this.gateLampMat.emissive.setRGB(on ? 3.2 : 0.1, on ? 1.6 : 0.05, 0);
  },
  /* ---------- railway ---------- */
  buildRail() {
    const R = this.world.route('rail');
    const pos = [], nor = [], idx = [];
    for (const off of [-0.72, 0.72]) {
      const base = pos.length / 3;
      for (let i = 0; i <= R.count; i++) {
        const [dx, dz] = R.dirAt(i * R.step), rx = dz, rz = -dx, x = R.x[i] + rx * off, z = R.z[i] + rz * off, y = R.y[i];
        for (const [lx, ly] of [[-0.04, 0.22], [-0.04, 0.38], [0.04, 0.38], [0.04, 0.22]]) { pos.push(x + rx * lx, y + ly, z + rz * lx); nor.push(rx * Math.sign(lx), ly > 0.3 ? 1 : 0, rz * Math.sign(lx)); }
      }
      for (let i = 0; i < R.count; i++) for (let f = 0; f < 3; f++) { const a = base + i * 4 + f, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const rails = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9c9690, roughness: 0.25, metalness: 0.9 }));
    rails.receiveShadow = true; this.scene.add(rails);
    const sleepers = [];
    for (let s = 0; s < R.length; s += 0.7) { const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); sleepers.push({ x: p.x, y: p.y, z: p.z, yaw: Math.atan2(dx, dz) }); }
    const sg = new THREE.BoxGeometry(2.5, 0.16, 0.24); sg.translate(0, 0.14, 0);
    this.cellInstances(sg, new THREE.MeshStandardMaterial({ color: 0x4a3d33, roughness: 0.95 }), sleepers, (p, d) => { d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.yaw, 0); }, { cast: false, dist: 320, cell: 300 });
    // a platform at every station, on the side away from the roads; out on the desert viaduct it stands on columns
    const conc = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c22a, roughness: 0.6 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2f3a40, roughness: 0.5, metalness: 0.4 });
    for (const st of this.world.stations) {
      const sp = R.posAt(st.s - 60, {}), [sdx, sdz] = R.dirAt(st.s - 60), k = st.side;
      const plat = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 1.1, 130), conc); deck.position.set(4.6 * k, 0.55, 0); plat.add(deck);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 130), yellow); edge.position.set(2.4 * k, 1.12, 0); plat.add(edge);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 90), roofMat); roof.position.set(4.8 * k, 5.2, 0); roof.rotation.z = 0.06 * k; plat.add(roof);
      for (let z = -42; z <= 42; z += 12) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.2, 8), roofMat); col.position.set(5.6 * k, 3.1, z); plat.add(col); }
      for (const z of [-30, 30]) {
        const name = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshStandardMaterial({ map: signFace([st.name], { bg: '#1b3550' }), roughness: 0.6 }));
        name.position.set(6.9 * k, 4.2, z); name.rotation.y = -Math.PI / 2 * k; plat.add(name);
      }
      // a back wall and benches
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 128), conc); wall.position.set(7.0 * k, 2.4, 0); plat.add(wall);
      for (let z = -36; z <= 36; z += 24) { const bench = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 2.4), roofMat); bench.position.set(6.2 * k, 1.33, z); plat.add(bench); }
      if (st.elevated) {
        const T = this.world.terrain;
        for (let z = -60; z <= 60; z += 15) {
          const lx = 4.6 * k, wx = sp.x + sdz * lx + sdx * z, wz = sp.z - sdx * lx + sdz * z, gy = T.h[T.gi(wx, wz)], h = sp.y - gy + 1;
          if (h < 1) continue;
          const col = new THREE.Mesh(new THREE.BoxGeometry(1.0, h, 1.0), conc); col.position.set(lx, -h / 2 + 0.2, z); plat.add(col);
        }
      }
      plat.position.set(sp.x, sp.y, sp.z); plat.rotation.y = Math.atan2(sdx, sdz);
      plat.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(plat);
    }
  },
  /* ---------- level crossings ---------- */
  buildCrossings() {
    this.crossingFx = [];
    const post = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    const buckTex = textTex(256, 64, (g, w, h) => { g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c4161c'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); g.fillStyle = '#1a1a1a'; g.font = '700 30px "Saira Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RAILROAD CROSSING', w / 2, h / 2); });
    const buck = new THREE.MeshStandardMaterial({ map: buckTex, roughness: 0.6, side: THREE.DoubleSide });
    for (const c of this.world.crossings) {
      const fx = { c, lights: [], arms: [] };
      const nx = -c.ez, nz = c.ex; // across the road
      for (const side of [-1, 1]) {
        // signal on the right-hand side of each approach
        const along = side * 7, across = side * (c.roadW / 2 + 1.6);
        const x = c.x + c.ex * along + nx * across, z = c.z + c.ez * along + nz * across, y = this.world.terrain.height(x, z);
        const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(c.ex, c.ez) + (side > 0 ? Math.PI : 0);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.6, 8), post); p.position.y = 2.3; g.add(p);
        for (const r of [0.6, -0.6]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.42), buck); b.position.set(0, 4.1, 0.12); b.rotation.z = r; g.add(b); }
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.14), dark); bar.position.set(0, 3.2, 0.12); g.add(bar);
        for (const lx of [-0.55, 0.55]) {
          const lm = new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: new THREE.Color(0, 0, 0), roughness: 0.3 });
          const l = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 14), lm); l.rotation.x = Math.PI / 2; l.position.set(lx, 3.2, 0.24); g.add(l);
          const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 14, 1, true, 0, Math.PI), dark); hood.rotation.x = Math.PI / 2; hood.rotation.y = Math.PI / 2; hood.position.set(lx, 3.24, 0.3); g.add(hood);
          fx.lights.push(lm);
        }
        // barrier arm across the half of the road
        const pivot = new THREE.Group(); pivot.position.set(0, 1.1, 0.25);
        const len = c.roadW / 2 + 1.0;
        const armTex = textTex(256, 32, (gg, w, h) => { for (let i = 0; i < 8; i++) { gg.fillStyle = i % 2 ? '#f4f1e8' : '#c4161c'; gg.fillRect(i * w / 8, 0, w / 8 + 1, h); } });
        const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.1), new THREE.MeshStandardMaterial({ map: armTex, roughness: 0.6 }));
        arm.position.x = -len / 2; pivot.add(arm);
        
        g.add(pivot); fx.arms.push(pivot);
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        mergeByMaterial(g, new Set(g.children.filter((o) => o.isMesh && fx.lights.includes(o.material))));
        this.scene.add(g); (fx.groups = fx.groups || []).push(g);
      }
      fx.down = 0;
      this.crossingFx.push(fx);
    }
  },
  updateCrossings(dt, t) {
    const cp = this.camera.position;
    for (const fx of this.crossingFx) {
      const c = fx.c;
      const near = Math.hypot(c.x - cp.x, c.z - cp.z) < 650;
      for (const g of fx.groups) g.visible = near;
      const active = this.world.trains.some((T) => { const ahead = T.ahead(c.s), behind = T.R.length - ahead; return (ahead < 300 && T.v > 0.5) || behind < T.length + 25; });
      c.active = active;
      fx.down = clamp(fx.down + (active ? dt / 3 : -dt / 4), 0, 1);
      const blink = Math.floor(t * 2.6) % 2;
      fx.lights.forEach((m, i) => m.emissive.setRGB(active && (i % 2) === blink ? 6 : 0, 0, 0));
      for (const p of fx.arms) p.rotation.z = lerp(-Math.PI / 2, 0, fx.down);
    }
  },
  /* ---------- the Coastline Freight ---------- */
  buildTrain() {
    this.trainGroups = [];
    const coachTex = textTex(1024, 128, (g, w, h) => {
      g.fillStyle = '#efe4cc'; g.fillRect(0, 0, w, h); g.fillStyle = '#8c1a12'; g.fillRect(0, h * 0.78, w, h * 0.22); g.fillRect(0, 0, w, h * 0.08);
      g.fillStyle = '#1b2228'; for (let i = 0; i < 11; i++) g.fillRect(40 + i * 88, h * 0.2, 64, h * 0.4);
      g.fillStyle = '#5a5048'; for (const x of [6, w - 40]) g.fillRect(x, h * 0.14, 34, h * 0.62);
    });
    const livery = textTex(1024, 128, (g, w, h) => { g.fillStyle = '#8c1a12'; g.fillRect(0, 0, w, h); g.fillStyle = '#efe4cc'; g.fillRect(0, h * 0.62, w, h * 0.16); g.fillStyle = '#efe4cc'; g.font = '400 64px "Saira Stencil One", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('COASTLINE FREIGHT', w * 0.42, h * 0.34); g.font = '700 54px "Saira Condensed", sans-serif'; g.fillText('5150', w * 0.88, h * 0.34); });
    const box = textTex(512, 128, (g, w, h) => { g.fillStyle = '#6a3424'; g.fillRect(0, 0, w, h); for (let i = 0; i < 26; i++) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(i * w / 26, 0, 3, h); } g.fillStyle = '#e8dcc4'; g.font = '700 30px "Saira Condensed", sans-serif'; g.fillText('CFX 30' + Math.floor(Math.random() * 90 + 10), 24, 40); });
    const mats = {
      red: new THREE.MeshStandardMaterial({ color: 0x8c1a12, roughness: 0.45, metalness: 0.3 }),
      cream: new THREE.MeshStandardMaterial({ color: 0xefe4cc, roughness: 0.5 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.6, metalness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b1116, roughness: 0.05, metalness: 0.8 }),
      livery: new THREE.MeshStandardMaterial({ map: livery, roughness: 0.45, metalness: 0.3 }),
      box: new THREE.MeshStandardMaterial({ map: box, roughness: 0.8 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x6a3424, roughness: 0.85 }),
      tank: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.6 }),
      hopper: new THREE.MeshStandardMaterial({ color: 0x7c7f83, roughness: 0.7, metalness: 0.3 }),
      head: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.5, 3.5) }),
    };
    const ccol = [0xb5442a, 0x1f5f8b, 0x2f7a4a, 0xd6a02b];
    mats.coach = new THREE.MeshStandardMaterial({ map: coachTex, roughness: 0.45, metalness: 0.2 });
    for (const car of this.world.trains.flatMap((T) => T.cars)) {
      const g = new THREE.Group(), L = car.len;
      const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
      for (const bz of [-L * 0.36, L * 0.36]) { add(new THREE.BoxGeometry(2.4, 0.8, 3.2), mats.dark, 0, 0.7, bz); for (const wz of [-0.9, 0.9]) for (const wx of [-0.75, 0.75]) { const w = add(new THREE.CylinderGeometry(0.46, 0.46, 0.18, 14), mats.dark, wx, 0.5, bz + wz); w.rotation.z = Math.PI / 2; } }
      add(new THREE.BoxGeometry(2.9, 0.35, L - 0.4), mats.dark, 0, 1.3, 0);
      if (car.kind === 'loco') {
        const body = add(new THREE.BoxGeometry(2.9, 3.0, L - 4), mats.red, 0, 3.0, -1.4);
        for (const sx of [-1.46, 1.46]) { const side = add(new THREE.PlaneGeometry(L - 4, 3.0), mats.livery, sx, 3.0, -1.4); side.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; }
        add(new THREE.BoxGeometry(3.0, 3.3, 3.2), mats.red, 0, 3.15, L / 2 - 2.6);
        add(new THREE.BoxGeometry(2.6, 1.0, 0.05), mats.glass, 0, 4.1, L / 2 - 0.98);
        add(new THREE.BoxGeometry(3.0, 0.25, 3.4), mats.cream, 0, 4.9, L / 2 - 2.6);
        add(new THREE.BoxGeometry(2.4, 1.5, 1.0), mats.red, 0, 2.2, L / 2 - 0.5);
        add(new THREE.CircleGeometry(0.22, 12), mats.head, 0, 2.6, L / 2 + 0.01);
        for (const sx of [-0.8, 0.8]) add(new THREE.CircleGeometry(0.14, 10), mats.head, sx, 1.9, L / 2 + 0.01);
        for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12), mats.dark, 0, 4.6, -4 + k * 2.2);
        void body;
      } else if (car.kind === 'coach') {
        add(new THREE.BoxGeometry(2.9, 3.3, L - 0.6), mats.cream, 0, 3.1, 0);
        for (const sx of [-1.46, 1.46]) { const side = add(new THREE.PlaneGeometry(L - 0.6, 3.3), mats.coach, sx, 3.1, 0); side.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; }
        const rf = add(new THREE.CylinderGeometry(1.5, 1.5, L - 0.6, 12, 1, false, Math.PI / 2, Math.PI), mats.dark, 0, 4.7, 0); rf.rotation.x = Math.PI / 2; rf.scale.set(1, 1, 0.25);
      } else if (car.kind === 'box') {
        const b = add(new THREE.BoxGeometry(2.9, 3.2, L - 0.6), mats.rust, 0, 3.05, 0);
        for (const sx of [-1.46, 1.46]) { const side = add(new THREE.PlaneGeometry(L - 0.6, 3.2), mats.box, sx, 3.05, 0); side.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; }
        void b;
      } else if (car.kind === 'tank') {
        const tk = add(new THREE.CylinderGeometry(1.45, 1.45, L - 1.6, 18), mats.tank, 0, 3.0, 0); tk.rotation.x = Math.PI / 2;
        for (const z of [-(L - 1.6) / 2, (L - 1.6) / 2]) add(new THREE.SphereGeometry(1.45, 16, 8, 0, TAU, 0, Math.PI / 2), mats.tank, 0, 3.0, z).rotation.x = z > 0 ? Math.PI / 2 : -Math.PI / 2;
        add(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 10), mats.tank, 0, 4.6, 0);
      } else if (car.kind === 'hopper') {
        const hp = new THREE.CylinderGeometry(1.5, 0.9, L - 1, 4, 1); hp.rotateY(Math.PI / 4); hp.rotateX(Math.PI / 2); hp.scale(1.4, 1.3, 1);
        add(hp, mats.hopper, 0, 3.0, 0);
      } else {
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) add(new THREE.BoxGeometry(2.5, 2.6, n === 1 ? 12.2 : 6.1), new THREE.MeshStandardMaterial({ color: ccol[Math.floor(Math.random() * 4)], roughness: 0.7, metalness: 0.3 }), 0, 2.8, n === 1 ? 0 : (k - 0.5) * 6.6);
      }
      mergeByMaterial(g);
      g.rotation.order = 'YXZ';
      this.scene.add(g); this.trainGroups.push(g);
    }
    this.updateTrain();
  },
  updateTrain() {
    const cp = this.camera.position;
    this.world.trains.flatMap((T) => T.cars).forEach((c, i) => { const g = this.trainGroups[i], P = c.pose; g.position.set(P.x, P.y, P.z); g.rotation.y = P.yaw; g.rotation.x = -P.pitch; g.visible = Math.hypot(P.x - cp.x, P.z - cp.z) < 2200; });
  },
});

'use strict';
