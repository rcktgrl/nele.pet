'use strict';
/* Red Mesa Rally · Railway: track, tunnel doors, level crossings and the Coastline Freight */

Object.assign(Gfx.prototype, {
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
