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
    const geos = new Map();
    const box = (w, h, d, x, y, z, col) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return tint(g, ...col); };
    const gable = (w, d, rise, y, col) => { // ridge along the length (z)
      const hw = w / 2 + 0.5, hd = d / 2 + 0.5, P = [-hw, y, -hd, hw, y, -hd, 0, y + rise, -hd, -hw, y, hd, 0, y + rise, hd, hw, y, hd];
      const v = (i) => P.slice(i * 3, i * 3 + 3), T = [[0, 2, 1], [3, 5, 4], [0, 3, 4], [0, 4, 2], [1, 2, 4], [1, 4, 5]], pos = [];
      for (const t of T) for (const i of t) pos.push(...v(i));
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return tint(g, ...col);
    };
    const DARK = [0.12, 0.13, 0.15], WOOD = [0.36, 0.24, 0.16];
    const cyl = (r0, r1, h, x, y, z, col, seg = 16) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg); g.translate(x, y + h / 2, z); return tint(g, ...col); };
    const STONE = [0.3, 0.28, 0.25], RED = [0.6, 0.1, 0.08], GLASS = [0.95, 0.85, 0.45];
    const cellOf = (x, z) => { const key = Math.floor(x / 400) * 1000 + Math.floor(z / 400); let cell = geos.get(key); if (!cell) geos.set(key, cell = []); return cell; };
    for (const o of this.world.terrain.village) {
      const parts = [], H = o.y1 - o.y0 + o.h, base = o.y0;
      if (o.kind === 'lookout') { this.lookoutParts(o, cellOf(o.x, o.z), box, cyl, STONE, WOOD, DARK); continue; }
      if (o.kind === 'lighthouse') { // a tapered white tower with red bands, the gallery and the lantern on top, the keeper's door at its foot
        const y = o.y1, h = o.h, r = (t) => 3.6 - 1.2 * t;
        parts.push(cyl(4.4, 4.4, y - base + 0.8, 0, base, 0, STONE, 20), cyl(r(0), r(1), h, 0, y + 0.8, 0, o.wall, 20));
        for (const t of [0.3, 0.62]) parts.push(cyl(r(t) + 0.05, r(t + 0.12) + 0.05, h * 0.12, 0, y + 0.8 + h * t, 0, RED, 20));
        const yt = y + 0.8 + h;
        parts.push(cyl(3.3, 3.3, 0.35, 0, yt, 0, DARK, 20), cyl(3.2, 3.2, 0.9, 0, yt + 0.35, 0, DARK, 20), cyl(1.7, 1.7, 2.4, 0, yt + 0.35, 0, GLASS, 12));
        parts.push(cyl(2.2, 0.15, 1.9, 0, yt + 2.75, 0, RED, 12), box(1.3, 2.2, 0.4, 0, y + 0.8 + 1.1, r(0.04), WOOD));
        for (const t of [0.2, 0.45, 0.75]) parts.push(box(0.7, 1.1, 0.3, 0, y + 0.8 + h * t, r(t) + 0.05, DARK));
      } else if (o.kind === 'observatory') { // a white drum under a silver dome with its slit open to the sky, the visitor wing in front
        const y = o.y1, zc = -2.5, R = 6.5;
        parts.push(box(o.w - 2, y - base + 0.6, o.d - 2, 0, base + (y - base + 0.6) / 2, 0, STONE), cyl(R, R, o.h, 0, y + 0.6, zc, o.wall, 24));
        const dome = new THREE.SphereGeometry(R + 0.2, 24, 10, 0, TAU, 0, Math.PI / 2); dome.translate(0, y + 0.6 + o.h, zc); parts.push(tint(dome, ...o.roof));
        for (let p = 0.1; p < 1.45; p += 0.18) { const g = new THREE.BoxGeometry(1.5, 0.12, (R + 0.2) * 0.2); g.rotateX(p); g.translate(0, y + 0.6 + o.h + Math.cos(p) * (R + 0.22), zc + Math.sin(p) * (R + 0.22)); parts.push(tint(g, ...DARK)); }
        parts.push(box(13, 4.2, 5.5, 0, y + 0.6 + 2.1, 4.8, o.wall), box(13.6, 0.4, 6.1, 0, y + 4.98, 4.8, STONE), box(1.6, 2.4, 0.2, 0, y + 1.8, 7.6, WOOD));
        for (const sx of [-4.4, -2.4, 2.4, 4.4]) parts.push(box(1.3, 1.4, 0.2, sx, y + 2.6, 7.6, DARK));
      } else {
        const lodge = o.kind === 'lodge', mill = o.kind === 'mill';
        if (lodge || mill) { // a stone base up to the floor, the walls on top of it
          parts.push(box(o.w + 0.6, o.y1 - base + 0.6, o.d + 0.6, 0, base + (o.y1 - base + 0.6) / 2, 0, STONE), box(o.w, o.h, o.d, 0, o.y1 + o.h / 2, 0, o.wall));
        } else parts.push(box(o.w, H, o.d, 0, base + H / 2, 0, o.wall));
        if (lodge) { // ridge along its length, a log line every course, stone chimneys at both ends and a deep porch along the front
          const g = gable(o.d, o.w, o.d * 0.5, base + H, o.roof); g.rotateY(Math.PI / 2); parts.push(g);
          for (let yy = o.y1 + 0.7; yy < o.y1 + o.h; yy += 0.6) parts.push(box(o.w + 0.3, 0.14, o.d + 0.3, 0, yy, 0, [0.3, 0.17, 0.08]));
          for (const sx of [-1, 1]) parts.push(box(1.8, o.h + o.d * 0.5 + 1.6, 1.8, sx * (o.w / 2 + 0.3), o.y1 + (o.h + o.d * 0.5 + 1.6) / 2, 0, STONE));
          parts.push(box(o.w * 0.62, 0.3, 3.2, 0, o.y1 + 0.15, o.d / 2 + 1.6, WOOD), box(o.w * 0.66, 0.3, 3.8, 0, o.y1 + 3.2, o.d / 2 + 1.7, o.roof));
          for (let k = 0; k < 5; k++) parts.push(box(0.3, 3, 0.3, (k / 4 - 0.5) * o.w * 0.6, o.y1 + 1.6, o.d / 2 + 3.1, WOOD));
          parts.push(box(1.6, 2.4, 0.2, 0, o.y1 + 1.5, o.d / 2 + 0.06, DARK));
          for (const sx of [-0.38, -0.22, 0.22, 0.38]) for (const sz of [-1, 1]) parts.push(box(1.4, 1.3, 0.2, sx * o.w, o.y1 + 2.4, sz * (o.d / 2 + 0.06), GLASS));
        } else {
          parts.push(gable(o.w, o.d, o.kind === 'barn' ? o.w * 0.45 : o.w * 0.38, base + H, o.roof));
          if (o.kind === 'barn') parts.push(box(o.w * 0.5, o.h * 0.75, 0.2, 0, o.y1 + o.h * 0.375, o.d / 2 + 0.05, [0.92, 0.9, 0.86]), box(o.w * 0.44, o.h * 0.68, 0.24, 0, o.y1 + o.h * 0.34, o.d / 2 + 0.06, o.wall));
          else {
            parts.push(box(1.1, 2.1, 0.2, 0, o.y1 + 1.05, o.d / 2 + 0.05, WOOD));
            const nw = Math.max(1, Math.floor(o.d / 3.2));
            for (const side of [-1, 1]) for (let k = 0; k < nw; k++) parts.push(box(0.2, 1.1, 1.1, side * (o.w / 2 + 0.05), o.y1 + 1.6, -o.d / 2 + (k + 0.5) * o.d / nw, DARK));
            for (const sx of [-1, 1]) parts.push(box(1.1, 1.1, 0.2, sx * o.w * 0.28, o.y1 + 1.6, o.d / 2 + 0.05, DARK));
            if (o.h > 4.6) parts.push(box(0.8, 2.2, 0.8, o.w * 0.25, base + H + o.w * 0.3, -o.d * 0.25, [0.55, 0.45, 0.4]));
          }
        }
      }
      const m = new THREE.Matrix4().makeRotationY(o.yaw).setPosition(o.x, 0, o.z);
      const cell = cellOf(o.x, o.z);
      for (const g of parts) cell.push(g.applyMatrix4(m));
      if (o.wheel) { // the wheel stands on edge in the water, its axle across the bank
        const W = o.wheel, wy = WATER_Y + W.r * 0.55, rim = new THREE.TorusGeometry(W.r, 0.18, 6, 24), wg = [tint(rim.clone(), ...WOOD)];
        const rim2 = rim.clone(); rim2.translate(0, 0, 1.2); wg.push(tint(rim2, ...WOOD));
        for (let k = 0; k < 12; k++) { const pdl = new THREE.BoxGeometry(0.15, W.r * 0.3, 1.4); pdl.translate(0, W.r * 0.85, 0.6); pdl.rotateZ(k * TAU / 12); wg.push(tint(pdl, ...WOOD)); }
        for (let k = 0; k < 6; k++) { const sp = new THREE.BoxGeometry(0.14, W.r * 2, 0.14); sp.rotateZ(k * Math.PI / 6); sp.translate(0, 0, 0.6); wg.push(tint(sp, ...WOOD)); }
        const ax = new THREE.CylinderGeometry(0.25, 0.25, 4, 8); ax.rotateX(Math.PI / 2); ax.translate(0, 0, 0.6); wg.push(tint(ax, ...DARK));
        const g = mergeGeos(wg); g.translate(0, 0, -0.6);
        const wm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
        wm.position.set(W.x, wy, W.z); wm.rotation.order = 'YXZ'; wm.rotation.y = W.yaw; // axle into the mill wall, the wheel's face along the stream wm.castShadow = true;
        this.scene.add(wm); this.millWheel = wm;
      }
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    for (const cell of geos.values()) { const mesh = new THREE.Mesh(mergeGeos(cell), mat); mesh.castShadow = mesh.receiveShadow = true; this.scene.add(mesh); }
  },
  /* the summit lookout: a low stone wall round the turning space, coin binoculars at the edge, a bench and a flag */
  lookoutParts(o, cell, box, cyl, STONE, WOOD, DARK) {
    const T = this.world.terrain, gy = (x, z) => T.rawH(x, z), ux = Math.sin(o.yaw), uz = Math.cos(o.yaw);
    const put = (g, x, z, yaw, y = gy(x, z)) => { g.rotateY(yaw); g.translate(x, y, z); cell.push(g); };
    for (const [ax, az, bx, bz] of lookoutWall(o)) {
      const L = Math.hypot(bx - ax, bz - az), ya = gy(ax, az), yb = gy(bx, bz), g = box(L + 0.5, 1.6, 0.7, 0, 0, 0, STONE);
      g.rotateZ(Math.atan2(yb - ya, L)); put(g, (ax + bx) / 2, (az + bz) / 2, -Math.atan2(bz - az, bx - ax), (ya + yb) / 2 + 0.1);
    }
    const at = (a, r) => [o.x + (ux * Math.cos(a) - uz * Math.sin(a)) * r, o.z + (uz * Math.cos(a) + ux * Math.sin(a)) * r];
    for (const a of [-0.35, 0.3]) {
      const [x, z] = at(a, 9.6), scope = [cyl(0.08, 0.08, 1.1, 0, 0, 0, DARK, 6), box(0.5, 0.35, 0.7, 0, 1.25, 0, [0.15, 0.35, 0.2])];
      put(mergeGeos(scope), x, z, o.yaw + a);
    }
    { const [x, z] = at(0.95, 8.4), b = [box(2.2, 0.12, 0.5, 0, 0.5, 0, WOOD), box(2.2, 0.5, 0.1, 0, 0.85, -0.25, WOOD), box(0.12, 0.5, 0.4, -0.9, 0.25, 0, DARK), box(0.12, 0.5, 0.4, 0.9, 0.25, 0, DARK)];
      put(mergeGeos(b), x, z, o.yaw + 0.95 + Math.PI); }
    { const [x, z] = at(-1.0, 8), f = [cyl(0.07, 0.05, 8, 0, 0, 0, [0.8, 0.8, 0.8], 6), box(0.05, 1, 1.6, 0, 7.4, 0.8, [0.7, 0.12, 0.1])];
      put(mergeGeos(f), x, z, o.yaw); }
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
    this.buildDam(m);
  },
  /* the Calder dam at the foot of the stream: a concrete wall bank to bank, the stream pouring over a spillway in the middle */
  buildDam(waterMat) {
    const D = RIVER.dam, T = this.world.terrain, rx = D.dz, rz = -D.dx, top = D.surf + 0.5, foot = WATER_Y - 4.5, th = 3.2;
    // out into each bank until the ground stands above the crest
    const reach = (sg) => { let l = D.hw; while (l < D.hw + 60 && T.rawH(D.x + rx * l * sg, D.z + rz * l * sg) < top + 0.6) l += 1; return l + 2; };
    const l0 = -reach(-1), l1 = reach(1), sw = D.hw * 0.55, conc = new THREE.MeshStandardMaterial({ color: 0xa39d92, roughness: 0.9 });
    const g = new THREE.Group(); g.position.set(D.x, 0, D.z); g.rotation.y = Math.atan2(D.dx, D.dz); this.scene.add(g);
    const box = (a, b, y0, y1, d, z, mat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(b - a, y1 - y0, d), mat); o.position.set((a + b) / 2, (y0 + y1) / 2, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    box(l0, -sw, foot, top, th, th / 2, conc); box(sw, l1, foot, top, th, th / 2, conc); // the wall either side of the spillway
    box(-sw, sw, foot, D.surf - 0.15, th, th / 2, conc); // the spillway sill, just under the stream
    box(-sw - 0.4, -sw, D.surf - 0.15, top + 0.25, th + 0.6, th / 2, conc); box(sw, sw + 0.4, D.surf - 0.15, top + 0.25, th + 0.6, th / 2, conc); // piers at its ends
    // the overflow: a sheet of water over the sill and down the face into the river below
    const fall = new THREE.PlaneGeometry(sw * 2, Math.hypot(1.4, D.surf - WATER_Y), 1, 1), fm = waterMat.clone(); fm.color = new THREE.Color(0.5, 0.6, 0.6); fm.opacity = 0.75;
    const sheet = new THREE.Mesh(fall, fm); sheet.position.set(0, (D.surf + WATER_Y) / 2 - 0.05, th + 0.7); sheet.rotation.x = Math.atan2(-1.4, D.surf - WATER_Y); g.add(sheet);
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(sw * 2, th), waterMat); lip.rotation.x = -Math.PI / 2; lip.position.set(0, D.surf - 0.1, th / 2); g.add(lip);
    this.damFoam = { x: D.x + D.dx * (th + 1.6), z: D.z + D.dz * (th + 1.6), dx: D.dx, dz: D.dz, rx, rz, w: sw };
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
      // a slip road's deck tucks a few cm under the main deck where the two overlap, or the two tops fight for the same depth
      const mains = R.def.ramp ? T.routes.filter((O) => O.def.elevated) : [];
      const under = (x, z, y) => mains.some((O) => { const pr = O.project(x, z, 0, -1); return pr.dist < O.width / 2 + 1.5 && Math.abs(O.sample(O.y, pr.s) - y) < 1; });
      for (let i = B.i0; i <= B.i1; i++) {
        const [dx, dz] = R.dirAt(i * R.step), rx = -dz, rz = dx, x = R.x[i], z = R.z[i], y = R.y[i];
        for (const [l, h] of [[-hw, 0.02], [hw, 0.02], [hw, -D], [-hw, -D]]) { const px = x + rx * l, pz = z + rz * l; P.push(px, y + h - (h > 0 && under(px, pz, y) ? 0.06 : 0), pz); UV.push(l < 0 ? 0 : 1, i * R.step / 12); }
      }
      const n = B.i1 - B.i0;
      for (let k = 0; k < n; k++) {
        const a = k * 4, b = a + 4;
        ti.push(a, b, a + 1, a + 1, b, b + 1); // deck top
        si.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2, a + 2, b + 2, a + 3, a + 3, b + 2, b + 3, a + 3, b + 3, a, a, b + 3, b); // right side, soffit, left side
      }
      const strip = (arr, ind, mat, uv) => {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); for (let t = 0; t < ind.length; t += 3) [ind[t + 1], ind[t + 2]] = [ind[t + 2], ind[t + 1]]; // the lists above wind clockwise from outside
        g.setIndex(ind); g.computeVertexNormals();
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
    const prof = [[-hw, y0], [-hw, y1], [hw, y1], [hw, y0], [-hw, y0]]; // closed: walls, roof and the floor under the water
    const pos = [], uv = [], idx = [];
    for (let i = idx0; i <= idx1; i++) {
      const a = U.pts[Math.max(0, i - 1)], b = U.pts[Math.min(U.pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]), rx = -(b[1] - a[1]) / L, rz = (b[0] - a[0]) / L;
      prof.forEach(([l, y], k) => { pos.push(U.pts[i][0] + rx * l, y, U.pts[i][1] + rz * l); uv.push(k / 4, U.s[i]); });
    }
    for (let i = 0; i < idx1 - idx0; i++) for (let k = 0; k < 4; k++) { const a = i * 5 + k, b = a + 5; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvTU = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTU; float gLamp;').replace('#include <color_fragment>', `#include <color_fragment>
{ float u = vTU.x, s = vTU.y;
  diffuseColor.rgb *= mix(0.72, 1.0, step(0.05, fract(s / 4.0)));
  gLamp = step(0.355, u) * step(u, 0.395) * step(0.85, fract(s / 12.0)); }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gLamp * vec3(0.9, 2.6, 3.0) + diffuseColor.rgb * vec3(0.12, 0.2, 0.24);');
    };
    const tube = new THREE.Mesh(g, m); tube.receiveShadow = true; this.scene.add(tube);
    // headwalls: a concrete face across each mouth with the opening cut out, filling the river's cut banks right up to the ground as it was
    const face = new THREE.MeshStandardMaterial({ color: 0x9d968b, roughness: 0.92 }), M = T.riverTun;
    for (const i of [idx0, idx1]) {
      const a = U.pts[Math.max(0, i - 1)], b = U.pts[Math.min(U.pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(b[0] - a[0], b[1] - a[1]), [x, z] = U.pts[i];
      const at = (lx) => [x + lx * (b[1] - a[1]) / L, z - lx * (b[0] - a[0]) / L]; // local +x of the rotated wall, in the world
      const top = (lx) => { const [px, pz] = at(lx); return Math.max(naturalHeight(px, pz), U.ceil + 1.2) + 0.6; };
      // out to where the banks are back at the ground's own height
      const edge = (sg) => { let l = hw + 2; while (l < 70) { const [px, pz] = at(sg * l); if (T.rawH(px, pz) > naturalHeight(px, pz) - 0.4 && l > M.lid) break; l += 2; } return sg * (l + 2); };
      const l0 = edge(-1), l1 = edge(1), N = Math.ceil((l1 - l0) / 2), shape = new THREE.Shape();
      shape.moveTo(l0, y0); shape.lineTo(l1, y0);
      for (let k = N; k >= 0; k--) { const lx = l0 + (l1 - l0) * k / N; shape.lineTo(lx, top(lx)); }
      const hole = new THREE.Path(); hole.moveTo(-hw, y0 + 0.01); hole.lineTo(-hw, y1); hole.lineTo(hw, y1); hole.lineTo(hw, y0 + 0.01); hole.lineTo(-hw, y0 + 0.01);
      shape.holes.push(hole);
      const wg = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false }); wg.translate(0, 0, -0.8);
      const m = new THREE.Mesh(wg, face); m.castShadow = true; m.receiveShadow = true;
      m.position.set(x, 0, z); m.rotation.y = yaw; this.scene.add(m);
    }
  },
});
