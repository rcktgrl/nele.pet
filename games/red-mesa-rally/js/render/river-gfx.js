'use strict';
/* Red Mesa Rally · Calder River scenery: the mountain stream, bridges, the boat tunnel under the docks */

Object.assign(Gfx.prototype, {
  buildRiver() {
    this.buildStream();
    this.buildBridges();
    this.buildBoatTunnel();
    this.buildChannelWalls();
    this.buildVillage();
  },
  /* Millbrook: whitewashed houses with gable roofs, red barns, the stone mill and its wheel */
  buildVillage() {
    const geos = [];
    const box = (w, h, d, x, y, z, col) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return tint(g, ...col); };
    const gable = (w, d, rise, y, col) => { // ridge along the length (z)
      const hw = w / 2 + 0.5, hd = d / 2 + 0.5, P = [-hw, y, -hd, hw, y, -hd, 0, y + rise, -hd, -hw, y, hd, 0, y + rise, hd, hw, y, hd];
      const v = (i) => P.slice(i * 3, i * 3 + 3), T = [[0, 2, 1], [3, 5, 4], [0, 3, 4], [0, 4, 2], [1, 2, 4], [1, 4, 5]], pos = [];
      for (const t of T) for (const i of t) pos.push(...v(i));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return tint(g, ...col);
    };
    const DARK = [0.12, 0.13, 0.15], WOOD = [0.36, 0.24, 0.16];
    for (const o of this.world.terrain.village) {
      const parts = [], H = o.y1 - o.y0 + o.h, base = o.y0;
      parts.push(box(o.w, H, o.d, 0, base + H / 2, 0, o.wall));
      parts.push(gable(o.w, o.d, o.kind === 'barn' ? o.w * 0.45 : o.w * 0.38, base + H, o.roof));
      if (o.kind === 'barn') parts.push(box(o.w * 0.5, o.h * 0.75, 0.2, 0, o.y1 + o.h * 0.375, o.d / 2 + 0.05, [0.92, 0.9, 0.86]), box(o.w * 0.44, o.h * 0.68, 0.24, 0, o.y1 + o.h * 0.34, o.d / 2 + 0.06, o.wall));
      else {
        parts.push(box(1.1, 2.1, 0.2, 0, o.y1 + 1.05, o.d / 2 + 0.05, WOOD));
        const nw = Math.max(1, Math.floor(o.d / 3.2));
        for (const side of [-1, 1]) for (let k = 0; k < nw; k++) parts.push(box(0.2, 1.1, 1.1, side * (o.w / 2 + 0.05), o.y1 + 1.6, -o.d / 2 + (k + 0.5) * o.d / nw, DARK));
        for (const sx of [-1, 1]) parts.push(box(1.1, 1.1, 0.2, sx * o.w * 0.28, o.y1 + 1.6, o.d / 2 + 0.05, DARK));
        if (o.h > 4.6) parts.push(box(0.8, 2.2, 0.8, o.w * 0.25, base + H + o.w * 0.3, -o.d * 0.25, [0.55, 0.45, 0.4]));
      }
      if (o.kind === 'mill') parts.push(box(o.w + 0.6, 1.2, o.d + 0.6, 0, o.y0 + 0.6, 0, [0.5, 0.48, 0.45]));
      const m = new THREE.Matrix4().makeRotationY(o.yaw).setPosition(o.x, 0, o.z);
      for (const g of parts) geos.push(g.applyMatrix4(m));
      if (o.wheel) { // the wheel stands on edge in the water, its axle across the bank
        const W = o.wheel, wy = WATER_Y + W.r * 0.55, rim = new THREE.TorusGeometry(W.r, 0.18, 6, 24), wg = [tint(rim.clone(), ...WOOD)];
        const rim2 = rim.clone(); rim2.translate(0, 0, 1.2); wg.push(tint(rim2, ...WOOD));
        for (let k = 0; k < 12; k++) { const pdl = new THREE.BoxGeometry(0.15, W.r * 0.3, 1.4); pdl.translate(0, W.r * 0.85, 0.6); pdl.rotateZ(k * TAU / 12); wg.push(tint(pdl, ...WOOD)); }
        for (let k = 0; k < 6; k++) { const sp = new THREE.BoxGeometry(0.14, W.r * 2, 0.14); sp.rotateZ(k * Math.PI / 6); sp.translate(0, 0, 0.6); wg.push(tint(sp, ...WOOD)); }
        const ax = new THREE.CylinderGeometry(0.25, 0.25, 4, 8); ax.rotateX(Math.PI / 2); ax.translate(0, 0, 0.6); wg.push(tint(ax, ...DARK));
        const g = mergeGeos(wg); g.translate(0, 0, -0.6);
        const wm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
        wm.position.set(W.x, wy, W.z); wm.rotation.order = 'YXZ'; wm.rotation.y = W.yaw + Math.PI / 2; wm.castShadow = true;
        this.scene.add(wm); this.millWheel = wm;
      }
    }
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeos(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    mesh.castShadow = mesh.receiveShadow = true; this.scene.add(mesh);
  },
  /* through the docks the river runs between straight concrete walls */
  buildChannelWalls() {
    const conc = new THREE.MeshStandardMaterial({ color: 0x9a9388, roughness: 0.92, side: THREE.DoubleSide }), grp = new THREE.Group(), T = this.world.terrain;
    const wall = (run) => {
      const pos = [], idx = [];
      run.forEach(([x, z, top], k) => { pos.push(x, WATER_Y - 3, z, x, top, z); if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, conc); m.receiveShadow = true; grp.add(m);
    };
    for (const R of RIVER.reaches) for (const side of [-1, 1]) {
      const Q = R.pts; let run = [];
      for (let i = 0; i < Q.length; i++) {
        const q = Q[i], a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / L * side, nz = (b.x - a.x) / L * side;
        const x = q.x + nx * (q.hw + 1.6), z = q.z + nz * (q.hw + 1.6);
        // no wall inside the covered tunnel, nor across the mouth where another waterway opens off this one
        if (!q.con || T.inRiverTunnel(q.x, q.z) || T.river[T.gi(x, z)]) { if (run.length > 1) wall(run); run = []; continue; }
        run.push([x, z, Math.max(T.rawH(x + nx * 3, z + nz * 3), WATER_Y + 1) + 0.25]);
      }
      if (run.length > 1) wall(run);
    }
    this.scene.add(grp);
  },
  /* up in the hills the river runs above sea level: a ribbon of water down its own bed */
  buildStream() {
    const Q = RIVER.reaches.find((r) => r.id === 'upper').pts.filter((q) => q.wl > WATER_Y + 1.1); // lower down the bed is under sea level and the real water takes over
    if (Q.length < 2) return;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < Q.length; i++) {
      const a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const q = Q[i], w = q.hw * 1.15, y = q.wl - 0.12;
      for (const l of [-w, w]) { const x = q.x + nx * l, z = q.z + nz * l; pos.push(x, y, z); uv.push(x / 6, z / 6); }
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = this.water.material.clone(); m.normalMap = this.waterNormal.clone(); m.normalMap.repeat.set(1, 1); m.normalMap.needsUpdate = true;
    m.color = new THREE.Color(0.07, 0.13, 0.13); m.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; this.scene.add(mesh);
  },
  /* decks, parapets and piers wherever a road or the railway crosses the river */
  buildBridges() {
    const conc = new THREE.MeshStandardMaterial({ color: 0xa49c90, roughness: 0.9 });
    const lines = (lanes) => textTex(256, 256, (g, w, h) => {
      g.fillStyle = '#3b3b3d'; g.fillRect(0, 0, w, h);
      const r = mulberry32(7); for (let i = 0; i < 1500; i++) { const v = 40 + r() * 40; g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; g.fillRect(r() * w, r() * h, 2, 2); }
      g.fillStyle = '#7a756c'; g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h); // kerbs under the parapets
      g.fillStyle = '#e8e4da'; g.fillRect(18, 0, 5, h); g.fillRect(w - 23, 0, 5, h);
      for (let k = 1; k < lanes; k++) { const x = 20 + (w - 40) * k / lanes; g.fillStyle = k * 2 === lanes ? '#e0b030' : '#e8e4da'; g.fillRect(x - 3, 0, 6, k * 2 === lanes && lanes > 2 ? h : h * 0.45); }
    }, { repeat: true });
    const tops = {}, top = (lanes) => tops[lanes] || (tops[lanes] = new THREE.MeshStandardMaterial({ map: lines(lanes), roughness: 0.85 }));
    const ballast = new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 1 });
    const planks = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.95 }); // dirt tracks cross on timber
    const T = this.world.terrain, grp = new THREE.Group();
    for (const B of T.bridges) {
      const R = this.world.route(B.route), hw = B.width / 2 + 1.5, D = B.rail ? 2.2 : 1.4;
      // one strip along the route samples: top, two sides and the soffit, plus the parapet walls
      const P = [], UV = [], pi = [], ti = [], si = [];
      for (let i = B.i0; i <= B.i1; i++) {
        const [dx, dz] = R.dirAt(i * R.step), rx = -dz, rz = dx, x = R.x[i], z = R.z[i], y = R.y[i];
        for (const [l, h] of [[-hw, 0.02], [hw, 0.02], [hw, -D], [-hw, -D]]) { P.push(x + rx * l, y + h, z + rz * l); UV.push(l < 0 ? 0 : 1, i * R.step / 12); }
      }
      const n = B.i1 - B.i0;
      for (let k = 0; k < n; k++) {
        const a = k * 4, b = a + 4;
        ti.push(a, b, a + 1, a + 1, b, b + 1); // deck top
        si.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2, a + 2, b + 2, a + 3, a + 3, b + 2, b + 3, a + 3, b + 3, a, a, b + 3, b); // right side, soffit, left side
      }
      const strip = (arr, ind, mat, uv) => {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind); g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      };
      strip(P, ti, B.rail ? ballast : R.surface === 'asphalt' ? top(R.def.lanes || 2) : planks, UV); strip(P, si, conc);
      if (!B.rail) { // parapets: inner faces and tops, the outer face is the deck side carried up
        const W = [];
        for (let i = 0; i <= n; i++) {
          const a = B.i0 + i, [dx, dz] = R.dirAt(a * R.step), rx = -dz, rz = dx, x = R.x[a], z = R.z[a], y = R.y[a];
          for (const [l, h] of [[-hw, -D], [-hw, 1.0], [-hw + 0.45, 1.0], [-hw + 0.45, 0], [hw - 0.45, 0], [hw - 0.45, 1.0], [hw, 1.0], [hw, -D]]) W.push(x + rx * l, y + h, z + rz * l);
        }
        for (let k = 0; k < n; k++) {
          const a = k * 8, b = a + 8;
          const gap = (B.pieces[k >> 1] || {}).gap || []; // a road joins here: no wall on that side
          for (const [u, v] of [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]]) if (!gap[u < 4 ? 0 : 1]) pi.push(a + u, b + u, a + v, a + v, b + u, b + v);
        }
        strip(W, pi, conc);
      }
      for (const q of B.piers) {
        const h = q.top - q.bot; if (h < 1) continue;
        const r = B.rail ? 1.6 : 1.1, c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, h, 14), conc);
        c.position.set(q.x, q.bot + h / 2, q.z); c.castShadow = true; c.receiveShadow = true; grp.add(c);
      }
    }
    mergeByMaterial(grp); this.scene.add(grp);
  },
  /* the boat tunnel: a lit concrete box culvert under the docks, headwalls at both mouths */
  buildBoatTunnel() {
    const U = RIVER.tunnel, T = this.world.terrain, hw = U.hw, y0 = U.bed - 1.5, y1 = U.ceil;
    const idx0 = U.s.findIndex((s) => s >= U.open[0]), idx1 = U.s.findIndex((s) => s >= U.open[1]);
    const prof = [[-hw, y0], [-hw, y1], [hw, y1], [hw, y0]];
    const pos = [], uv = [], idx = [];
    for (let i = idx0; i <= idx1; i++) {
      const a = U.pts[Math.max(0, i - 1)], b = U.pts[Math.min(U.pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]), rx = -(b[1] - a[1]) / L, rz = (b[0] - a[0]) / L;
      prof.forEach(([l, y], k) => { pos.push(U.pts[i][0] + rx * l, y, U.pts[i][1] + rz * l); uv.push(k / 3, U.s[i]); });
    }
    for (let i = 0; i < idx1 - idx0; i++) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 4; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTU = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU; float gLamp;').replace('#include <color_fragment>', `#include <color_fragment>
{ float u = vTU.x, s = vTU.y;
  diffuseColor.rgb *= mix(0.72, 1.0, step(0.05, fract(s / 4.0)));
  gLamp = step(0.47, u) * step(u, 0.53) * step(0.85, fract(s / 12.0)); }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gLamp * vec3(0.9, 2.6, 3.0) + diffuseColor.rgb * vec3(0.12, 0.2, 0.24);');
    };
    const tube = new THREE.Mesh(g, m); tube.receiveShadow = true; this.scene.add(tube);
    // the lid: the ground as it was, laid back over the cut, in the terrain's own material so paving and grass carry on across it
    const M = T.riverTun, Wn = 10, cp = [], cn = [], cA = [], cB = [], cC = [], cD = [], ci = [];
    const topAt = (x, z) => { const k = T.riverTunAt(x, z); return k ? M.top[k - 1] : T.rawH(x, z); };
    for (let i = idx0; i <= idx1; i++) {
      const a = U.pts[Math.max(0, i - 1)], b = U.pts[Math.min(U.pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]), rx = -(b[1] - a[1]) / L, rz = (b[0] - a[0]) / L;
      for (let k = 0; k <= Wn; k++) {
        const l = (-1 + 2 * k / Wn) * (M.lid - 0.6), x = U.pts[i][0] + rx * l, z = U.pts[i][1] + rz * l, gi = T.gi(x, z);
        cp.push(x, topAt(x, z) + 0.03, z); cn.push(0, 1, 0);
        cA.push(T.road[gi], 0, 1, 1); cB.push(T.rlat[gi], T.rhw[gi], T.asph[gi], 0); cC.push(T.green[gi] / 255, T.beach[gi] / 255, T.city[gi] / 255, 0); cD.push(T.rs[gi], T.rlanes[gi], T.rfade[gi] / 255);
      }
    }
    for (let i = 0; i < idx1 - idx0; i++) for (let k = 0; k < Wn; k++) { const a = i * (Wn + 1) + k, b = a + Wn + 1; ci.push(a, a + 1, b, a + 1, b + 1, b); }
    const lg = new THREE.BufferGeometry();
    for (const [nm, arr, sz] of [['position', cp, 3], ['normal', cn, 3], ['aA', cA, 4], ['aB', cB, 4], ['aC', cC, 4], ['aD', cD, 3]]) lg.setAttribute(nm, new THREE.Float32BufferAttribute(arr, sz));
    lg.setIndex(ci); lg.computeBoundingSphere();
    const lid = new THREE.Mesh(lg, this.terrainMat); lid.castShadow = true; lid.receiveShadow = true; this.scene.add(lid);
    // headwalls: a concrete face across each mouth with the opening cut out, up to the ground above
    const face = new THREE.MeshStandardMaterial({ color: 0x9d968b, roughness: 0.92 });
    for (const i of [idx0, idx1]) {
      const a = U.pts[Math.max(0, i - 1)], b = U.pts[Math.min(U.pts.length - 1, i + 1)], yaw = Math.atan2(b[0] - a[0], b[1] - a[1]), [x, z] = U.pts[i];
      const W = hw + 7, top = Math.max(T.rawH(x, z), U.ceil + 1.2) + 0.6, g = new THREE.Group();
      const box = (x0, x1, b0, b1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, b1 - b0, 1.6), face); m.position.set((x0 + x1) / 2, (b0 + b1) / 2, 0); m.castShadow = true; m.receiveShadow = true; g.add(m); };
      box(-W, -hw, y0, top); box(hw, W, y0, top); box(-hw, hw, y1, top); // the two piers and the lintel over the opening
      g.position.set(x, 0, z); g.rotation.y = yaw; this.scene.add(g);
    }
  },
});
