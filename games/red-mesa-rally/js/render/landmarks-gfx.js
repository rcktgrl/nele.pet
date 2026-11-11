'use strict';
/* Red Mesa Rally · the suburbs' landmarks: what Mesa View Mall, Kestrel Skate Park and Marina High add to their buildings */

Object.assign(Gfx.prototype, {
  buildLandmarks() {
    const C = this.world.city;
    this.lmGroup = new THREE.Group(); this.scene.add(this.lmGroup);
    this.buildMall(C.mall); this.buildSkatePark(C.skate); this.buildSchool(C.school);
  },
  /* lettering on a flat panel; yaw 0 faces south (+z) */
  lmSign(text, w, h, x, y, z, yaw, opts = {}) {
    const tex = textTex(1024, Math.max(64, Math.round(1024 * h / w / 32) * 32), (g, W, H) => {
      if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, W, H); } else g.clearRect(0, 0, W, H);
      g.fillStyle = opts.fg || '#f4f1e8'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const lines = [].concat(text), n = lines.length;
      lines.forEach((l, i) => {
        let px = H / n * (i === 0 ? 0.74 : 0.5); g.font = `${i === 0 ? '400' : '700'} ${px}px ${i === 0 ? '"Saira Stencil One", Impact' : '"Saira Condensed", "Arial Narrow"'}, sans-serif`;
        const tw = g.measureText(l).width; if (tw > W * 0.92) { px *= W * 0.92 / tw; g.font = g.font.replace(/[\d.]+px/, px + 'px'); }
        g.fillText(l, W / 2, H * (i + 0.5) / n + (i === 0 && n > 1 ? H * 0.04 : 0));
      });
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: !opts.bg, alphaTest: opts.bg ? 0 : 0.35, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: opts.glow || 0.25, side: opts.both ? THREE.DoubleSide : THREE.FrontSide }));
    m.position.set(x, y, z); m.rotation.y = yaw; this.lmGroup.add(m); return m;
  },
  lmSolid(parts, opts = {}) {
    const m = new THREE.Mesh(mergeGeos(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough === undefined ? 0.7 : opts.rough, metalness: opts.metal || 0.1 }));
    if (!parts[0].attributes.normal) m.geometry.computeVertexNormals();
    m.castShadow = opts.cast !== false; m.receiveShadow = true; this.lmGroup.add(m); return m;
  },
  /* ---------- Mesa View Mall: the name over the atrium doors, the stores' names, a pylon sign on the boulevard ---------- */
  buildMall(M) {
    if (!M) return;
    this.lmSign('MESA VIEW MALL', 26, 4.4, M.x, M.top - 3.2, M.z + 0.2, 0, { fg: '#ffe9c4', glow: 0.7 });
    for (const s of M.stores) this.lmSign(s.name, 22, 3.2, s.x, s.y, s.z + 0.2, 0, { fg: '#f4f1e8', glow: 0.5 });
    const P = M.pylon, parts = [], steel = [0.2, 0.2, 0.22];
    for (const dz of [-2.4, 2.4]) parts.push(tint(new THREE.BoxGeometry(0.9, 17, 0.9).translate(P.x, P.y + 8.5, P.z + dz), ...steel));
    parts.push(tint(new THREE.BoxGeometry(1.1, 8.4, 7.4).translate(P.x, P.y + 12.6, P.z), 0.62, 0.2, 0.12));
    // the canopy over the doors, on four posts
    parts.push(tint(new THREE.BoxGeometry(22, 0.5, 7).translate(M.x, M.y + 5, M.z + 3.4), 0.62, 0.2, 0.12));
    for (const dx of [-10, -3.4, 3.4, 10]) parts.push(tint(new THREE.BoxGeometry(0.4, 5, 0.4).translate(M.x + dx, M.y + 2.5, M.z + 6.4), ...steel));
    this.lmSolid(parts);
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) this.lmSign(['MESA VIEW', 'MALL · 60 STORES · CINEMA', 'OPEN TILL LATE'], 7, 8, P.x + Math.sin(yaw) * 0.58, P.y + 12.6, P.z, yaw, { bg: '#7a1f10', fg: '#ffe9c4', glow: 0.6 });
  },
  /* ---------- Kestrel Skate Park: the slab, the concrete shapes on it, rails and the gate ---------- */
  buildSkatePark(K) {
    if (!K) return;
    const S = K.site, pos = [], col = [], uv = [], idx = [], ST = 0.75;
    const DECK = [[0.5, 0.1, 0.05], [0.04, 0.2, 0.26], [0.6, 0.38, 0.03], [0.14, 0.1, 0.26]];
    K.pieces.forEach((o, pk) => {
      const [x0, z0, x1, z1] = o.box, nx = Math.ceil((x1 - x0) / ST), nz = Math.ceil((z1 - z0) / ST), v0 = pos.length / 3, hs = [], top = o.shape === 'roll' ? 9 : o.H, dk = DECK[pk % DECK.length];
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz, y = skateLift(o, x, z), h = y > -Infinity ? y - o.y : 0;
        hs.push(h); pos.push(x, o.y + h + 0.05, z); uv.push(x / 6, z / 6);
        const n = 0.3 + 0.05 * Noise.fbm(x / 3, z / 3, 2) + 0.05 * h / top, q = o.shape === 'roll' ? 0 : smooth(top - 0.45, top - 0.02, h), k = o.shape === 'roll' && Math.floor((x - o.x) / 2.5) % 2 ? 0.7 : 1; // the decks are painted, the paint fading out down the transition
        col.push(lerp(n * k, dk[0], q), lerp(n * k * 0.98, dk[1], q), lerp(n * k * 0.93, dk[2], q));
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        if (hs[a] + hs[b] + hs[c] + hs[d] <= 0) continue;
        idx.push(v0 + a, v0 + c, v0 + b, v0 + b, v0 + c, v0 + d);
      }
    });
    { const v0 = pos.length / 3, y = K.y + 0.03; // the slab under it all
      for (const [x, z] of [[S.x0, S.z0], [S.x1, S.z0], [S.x0, S.z1], [S.x1, S.z1]]) { pos.push(x, y, z); col.push(0.3, 0.295, 0.28); uv.push(x / 6, z / 6); }
      idx.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    // poured concrete: mottled, a joint every 6 m, tyre marks
    const tex = textTex(512, 512, (g, w, h) => {
      const r = mulberry32(9); g.fillStyle = '#e4e2dc'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,60,60'},${0.03 + r() * 0.05})`; const s = 4 + r() * 40; g.fillRect(r() * w - s / 2, r() * h - s / 2, s, s * (0.3 + r())); }
      g.strokeStyle = 'rgba(40,40,40,0.45)'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
      g.strokeStyle = 'rgba(20,20,20,0.16)'; g.lineWidth = 5; for (let k = 0; k < 3; k++) { g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.quadraticCurveTo(x + (r() - 0.5) * 300, y + (r() - 0.5) * 300, x + (r() - 0.5) * 500, y + (r() - 0.5) * 500); g.stroke(); }
    }, { anisotropy: 8 });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.castShadow = true; m.receiveShadow = true; this.lmGroup.add(m);
    const parts = [];
    for (const r of K.rails) {
      const L = Math.hypot(r.bx - r.ax, r.bz - r.az), cx = (r.ax + r.bx) / 2, cz = (r.az + r.bz) / 2, yaw = Math.atan2(r.bz - r.az, r.bx - r.ax);
      parts.push(tint(new THREE.CylinderGeometry(0.06, 0.06, L, 8).rotateZ(Math.PI / 2).rotateY(-yaw).translate(cx, r.y + r.h, cz), 0.85, 0.7, 0.1));
      for (let t = 0.5; t < L; t += Math.max(2, (L - 1) / Math.ceil((L - 1) / 3))) parts.push(tint(new THREE.BoxGeometry(0.08, r.h, 0.08).translate(r.ax + (r.bx - r.ax) * t / L, r.y + r.h / 2, r.az + (r.bz - r.az) * t / L), 0.3, 0.3, 0.32));
    }
    this.lmSolid(parts, { metal: 0.6, rough: 0.4 });
    const label = textTex(1024, 128, (g, w, h) => { g.fillStyle = '#16100c'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff8a2a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '400 74px "Saira Stencil One", Impact, sans-serif'; g.fillText(K.name, w / 2, h / 2 + 4, w - 60); });
    this.lmGroup.add(this.makeArch(K.gate.x, K.gate.z, 0, label));
  },
  /* ---------- Marina High: tower roof and clock, field and track, grandstand, goals, buses, flag and sign ---------- */
  buildSchool(S) {
    if (!S) return;
    const parts = [], T = S.tower, tr = S.track, steel = [0.75, 0.76, 0.78];
    // the tower: a pyramid roof with a clock on every side under it
    parts.push(tint(new THREE.ConeGeometry(T.w * 0.78, 6, 4).rotateY(Math.PI / 4).translate(T.x, T.y + 3, T.z), 0.2, 0.3, 0.28));
    parts.push(tint(new THREE.BoxGeometry(T.w + 0.8, 0.5, T.w + 0.8).translate(T.x, T.y + 0.1, T.z), 0.86, 0.84, 0.78));
    const clock = textTex(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = '#f4f1e8'; g.beginPath(); g.arc(w / 2, h / 2, 120, 0, TAU); g.fill(); g.strokeStyle = '#16100c'; g.lineWidth = 10; g.stroke();
      for (let k = 0; k < 12; k++) { const a = k * TAU / 12; g.lineWidth = k % 3 ? 4 : 9; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 96, h / 2 + Math.sin(a) * 96); g.lineTo(w / 2 + Math.cos(a) * 112, h / 2 + Math.sin(a) * 112); g.stroke(); }
      g.lineCap = 'round'; g.lineWidth = 11; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + 50, h / 2 - 36); g.stroke(); g.lineWidth = 7; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 - 22, h / 2 - 86); g.stroke();
    });
    const cm = new THREE.MeshStandardMaterial({ map: clock, alphaTest: 0.5, roughness: 0.5, emissive: 0xffffff, emissiveMap: clock, emissiveIntensity: 0.3 });
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, f = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24), cm); f.position.set(T.x + Math.sin(a) * (T.w / 2 + 0.06), T.y - 3.4, T.z + Math.cos(a) * (T.w / 2 + 0.06)); f.rotation.y = a; this.lmGroup.add(f); }
    this.lmSign(S.name, 17, 3, S.main.x - 8.1, S.main.base + 6.3, S.main.z - 26, -Math.PI / 2, { fg: '#f4f1e8', glow: 0.35 });
    this.lmSign(['HOME OF THE MARLINS'], 26, 3, S.gym.x, S.gym.base + 8.4, S.gym.z + 13.1, 0, { fg: '#ffd23f', glow: 0.35 });
    // the field: grass, pitch lines, and the track round it, all one painted sheet
    { const W = 2 * (tr.L + tr.r) + 4, D = 2 * tr.r + 4, px = 2048 / W;
      const tex = textTex(2048, Math.round(D * px / 64) * 64, (g, w, h) => {
        const sy = h / (D * px), X = (x) => (x + W / 2) * px, Z = (z) => (z + D / 2) * px * sy, oval = (r) => { g.beginPath(); g.moveTo(X(-tr.L), Z(-r)); g.lineTo(X(tr.L), Z(-r)); g.ellipse(X(tr.L), Z(0), r * px, r * px * sy, 0, -Math.PI / 2, Math.PI / 2); g.lineTo(X(-tr.L), Z(r)); g.ellipse(X(-tr.L), Z(0), r * px, r * px * sy, 0, Math.PI / 2, Math.PI * 1.5); g.closePath(); };
        g.clearRect(0, 0, w, h);
        oval(tr.r); g.fillStyle = '#a8452e'; g.fill();
        g.strokeStyle = '#f1ebe0'; g.lineWidth = 2; for (let k = 0; k <= 6; k++) { oval(tr.r - 0.3 - k * (tr.w - 0.6) / 6); g.stroke(); }
        oval(tr.r - tr.w); g.fillStyle = '#3f7a35'; g.fill();
        for (let k = -5; k < 5; k++) if (k % 2) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(X(k * 8.4), Z(-20), 8.4 * px, 40 * px * sy); } // mown stripes
        g.strokeStyle = '#f1ebe0'; g.lineWidth = 3; g.strokeRect(X(-42), Z(-20), 84 * px, 40 * px * sy);
        g.beginPath(); g.moveTo(X(0), Z(-20)); g.lineTo(X(0), Z(20)); g.stroke(); g.beginPath(); g.ellipse(X(0), Z(0), 7 * px, 7 * px * sy, 0, 0, TAU); g.stroke();
        for (const sd of [-1, 1]) g.strokeRect(X(sd > 0 ? 30 : -42), Z(-11), 12 * px, 22 * px * sy);
        g.fillStyle = '#f1ebe0'; g.fillRect(X(tr.L - 0.4), Z(tr.r - tr.w), 0.8 * px, tr.w * px * sy); // the finish line
      }, { anisotropy: 8 });
      const f = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      f.position.set(tr.x, tr.y + 0.05, tr.z); f.receiveShadow = true; this.lmGroup.add(f); }
    // goals, the scoreboard, the grandstand
    for (const g of S.goals) {
      for (const dz of [-3.6, 3.6]) parts.push(tint(new THREE.CylinderGeometry(0.08, 0.08, 6, 6).translate(g.x, tr.y + 3, g.z + dz), ...steel));
      parts.push(tint(new THREE.CylinderGeometry(0.08, 0.08, 7.2, 6).rotateX(Math.PI / 2).translate(g.x, tr.y + 2.6, g.z), ...steel));
    }
    { const B = S.board; for (const dz of [-4, 4]) parts.push(tint(new THREE.BoxGeometry(0.4, 9, 0.4).translate(B.x, B.y + 4.5, B.z + dz), 0.2, 0.2, 0.22));
      parts.push(tint(new THREE.BoxGeometry(0.5, 4.4, 10).translate(B.x, B.y + 7, B.z), 0.1, 0.12, 0.14));
      this.lmSign(['MARLINS 21', 'VISITORS 14'], 9.4, 4, B.x - 0.27, B.y + 7, B.z, -Math.PI / 2, { bg: '#0b1410', fg: '#ffd23f', glow: 0.8 }); }
    { const st = S.stand, n = 6; for (let k = 0; k < n; k++) parts.push(tint(new THREE.BoxGeometry(st.w, st.h * (k + 1) / n, st.d / n).translate(st.x, st.y + st.h * (k + 1) / n / 2, st.z + st.d / 2 - (k + 0.5) * st.d / n), k % 2 ? 0.2 : 0.62, k % 2 ? 0.32 : 0.62, k % 2 ? 0.5 : 0.6)); }
    // the flag and the sign on the island in the bus loop
    { const F = S.flag; parts.push(tint(new THREE.CylinderGeometry(0.07, 0.1, 10, 8).translate(F.x, F.y + 5, F.z), ...steel), tint(new THREE.BoxGeometry(0.05, 1.5, 2.4).translate(F.x, F.y + 9.1, F.z + 1.25), 0.1, 0.25, 0.55)); }
    { const G = S.sign; parts.push(tint(new THREE.BoxGeometry(1, 0.7, 9).translate(G.x, G.y + 0.35, G.z), 0.5, 0.26, 0.2), tint(new THREE.BoxGeometry(0.5, 1.7, 8.4).translate(G.x, G.y + 1.55, G.z), 0.12, 0.2, 0.36));
      for (const yaw of [Math.PI / 2, -Math.PI / 2]) this.lmSign(['MARINA HIGH', 'HOME OF THE MARLINS'], 8, 1.5, G.x + Math.sin(yaw) * 0.27, G.y + 1.55, G.z, yaw, { bg: '#1c3359', fg: '#f4f1e8', glow: 0.45 }); }
    // school buses waiting on the loop
    for (const b of S.buses) {
      const at = (g) => g.rotateY(b.yaw).translate(b.x, b.y, b.z);
      parts.push(tint(at(new THREE.BoxGeometry(2.5, 2.3, 10.4).translate(0, 1.75, 0)), 0.95, 0.68, 0.06), tint(at(new THREE.BoxGeometry(2.3, 1.2, 1.6).translate(0, 1.2, 5.6)), 0.95, 0.68, 0.06),
        tint(at(new THREE.BoxGeometry(2.54, 0.75, 9.6).translate(0, 2.25, -0.2)), 0.08, 0.1, 0.12), tint(at(new THREE.BoxGeometry(2.54, 0.14, 10.44).translate(0, 1.3, 0)), 0.08, 0.08, 0.08),
        tint(at(new THREE.BoxGeometry(2.56, 0.5, 0.08).translate(0, 2.6, 5.2)), 0.08, 0.1, 0.12));
      for (const [wx, wz] of [[-1.15, 3.9], [1.15, 3.9], [-1.15, -3.3], [1.15, -3.3]]) parts.push(tint(at(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12).rotateZ(Math.PI / 2).translate(wx, 0.5, wz)), 0.06, 0.06, 0.06));
    }
    this.lmSolid(parts, { rough: 0.6 });
  },
});
