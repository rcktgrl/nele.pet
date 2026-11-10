'use strict';
/* Red Mesa Rally · Road tunnels: lined bore, mountain cover, portals, and the story-mode gate at the west portal */

Object.assign(Gfx.prototype, {
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
  updateTunnelGate(t) {
    if (!this.tunnelGate || !this.tunnelGate.visible) return;
    const on = Math.floor(t * 1.6) % 2; this.gateLampMat.emissive.setRGB(on ? 3.2 : 0.1, on ? 1.6 : 0.05, 0);
  },
});
