'use strict';
/* Red Mesa Rally · Streamed terrain chunks, sea and horizon */

/* ===================================================================
   RED MESA RALLY — world rendering: the terrain mesh in streamed chunks,
   the sea and the far horizon. The terrain shader and lighting bake are in
   terrain-material.js, rocks and vegetation in scatter-gfx.js.
   =================================================================== */
const TERRAIN_GLSL_PARS = `
attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; attribute vec3 aD;
varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec3 vD; varying vec3 vWPos; varying vec3 vWNrm;`;
const cellKey = (x, z, C) => Math.floor((x - WORLD.x0) / C) * 1000 + Math.floor((z - WORLD.z0) / C);

Object.assign(Gfx.prototype, {
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
});

'use strict';
