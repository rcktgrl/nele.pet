'use strict';
/* Red Mesa Rally · Rocks, trees and bushes: instanced per map cell, culled by distance */

Object.assign(Gfx.prototype, {
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
