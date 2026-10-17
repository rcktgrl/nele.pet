'use strict';
/* Red Mesa Rally · Particles, effects and tyre marks */

/* ---------- Particles ---------- */
class ParticleSystem {
  constructor(gfx, max, additive, tex) {
    this.max = max; this.n = 0; this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.life = new Float32Array(max); this.age = new Float32Array(max); this.grow = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.a0 = new Float32Array(max); this.rot = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.uScale = { value: 800 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: this.uScale },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aRot; attribute vec3 color; varying float vA; varying vec3 vC; varying float vR; varying float vFog; uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(aSize * uScale / max(-mv.z, 0.5), 900.0); vA = aAlpha; vC = color; vR = aRot; vFog = 1.0 - exp(-0.0012 * -mv.z); }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA; varying vec3 vC; varying float vR; varying float vFog;
        void main(){ vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); p = mat2(c, -s, s, c) * p + 0.5;
          vec4 t = texture2D(uTex, p); float a = t.a * vA; if (a < 0.004) discard;
          vec3 col = mix(vC * t.rgb, ${c3(FOG_AWAY)}, ${additive ? '0.0' : 'vFog * 0.7'});
          gl_FragColor = vec4(col, a * ${additive ? '(1.0 - vFog)' : '1.0'});
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false;
    gfx.scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, size, grow, life, r, g, b, alpha, grav = 0, drag = 1.5) {
    let i;
    if (this.n < this.max) i = this.n++; else { i = this.head; this.head = (this.head + 1) % this.max; }
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.age[i] = 0; this.a0[i] = alpha; this.alpha[i] = alpha; this.grav[i] = grav; this.drag[i] = drag; this.rot[i] = Math.random() * TAU;
  }
  update(dt, T) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      this.age[i] += dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.grav[i] > 0) { const gy = T.height(this.pos[i * 3], this.pos[i * 3 + 2]); if (this.pos[i * 3 + 1] < gy) { this.pos[i * 3 + 1] = gy; this.vel[i * 3] *= 0.3; this.vel[i * 3 + 1] = 0; this.vel[i * 3 + 2] *= 0.3; } }
      this.size[i] += this.grow[i] * dt;
      const t = this.age[i] / this.life[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      this.rot[i] += dt * 0.3;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'aSize', 'aAlpha', 'aRot']) this.geo.attributes[k].needsUpdate = true;
  }
}

class FX {
  constructor(gfx) {
    this.gfx = gfx;
    const puff = makeCanvasTex(128, 128, (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), d = Math.hypot(dx, dy);
        const n = 0.6 + 0.4 * Noise.fbm(x / 18, y / 18, 3) + 0.25 * Noise.n2(x / 6, y / 6);
        const a = clamp((1 - d) * 1.4, 0, 1) ** 1.6 * clamp(n, 0, 1.2);
        const shade = 0.75 + 0.25 * clamp(-dy * 0.6 + n * 0.4, 0, 1);
        const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * shade; img.data[i + 3] = 255 * clamp(a, 0, 1);
      }
      g.putImageData(img, 0, 0);
    });
    const glow = makeCanvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,220,0.8)'); gr.addColorStop(1, 'rgba(255,200,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    this.smoke = new ParticleSystem(gfx, gfx.quality === 'low' ? 1800 : 3500, false, puff);
    this.fire = new ParticleSystem(gfx, 1500, true, glow);
  }
  update(dt) { this.smoke.update(dt, this.gfx.world.terrain); this.fire.update(dt, this.gfx.world.terrain); if (this.gfx.millWheel) this.gfx.millWheel.rotation.z -= dt * 0.6; }
  dust(x, y, z, vx, vz, amount, kind) {
    const r = Math.random;
    if (kind === 2) { // mud: dark heavy clods + brown spray
      this.smoke.emit(x, y + 0.2, z, vx * 0.4 + (r() - 0.5) * 3, 2 + r() * 4, vz * 0.4 + (r() - 0.5) * 3, 0.35, 0.3, 1.2, 0.12, 0.075, 0.045, 0.95, 9, 0.6);
      if (r() < 0.25) this.smoke.emit(x, y + 0.3, z, vx * 0.2, 0.6, vz * 0.2, 1.0, 2.0, 1.2, 0.28, 0.2, 0.14, 0.18 * amount, 0, 1.4);
    } else if (kind === 5) { // asphalt: no dust, white tyre smoke when the rubber is sliding
      if (amount > 0.75) this.smoke.emit(x, y + 0.25, z, vx * 0.2 + (r() - 0.5) * 1.5, 0.6 + r(), vz * 0.2 + (r() - 0.5) * 1.5, 0.9, 3.4 + r() * 2, 2.4 + r(), 0.86, 0.86, 0.88, 0.22 * Math.min(1.4, amount - 0.6), -0.15, 1.1);
    } else if (kind === 6) { // grass: thin seed-dust and clippings
      this.smoke.emit(x, y + 0.2, z, vx * 0.3 + (r() - 0.5) * 2, 0.6 + r(), vz * 0.3 + (r() - 0.5) * 2, 0.8, 2.2, 1.4, 0.48, 0.44, 0.3, 0.12 * Math.min(1.2, amount), 0, 1.2);
      if (r() < 0.3) this.smoke.emit(x, y + 0.2, z, vx * 0.3 + (r() - 0.5) * 3, 2 + r() * 2, vz * 0.3 + (r() - 0.5) * 3, 0.12, 0, 0.9, 0.16, 0.24, 0.08, 0.9, 9, 0.5);
    } else if (kind === 4) { // water spray
      this.smoke.emit(x, y + 0.2, z, vx * 0.3 + (r() - 0.5) * 3, 3 + r() * 4, vz * 0.3 + (r() - 0.5) * 3, 0.6, 2.5, 0.9, 0.85, 0.9, 0.95, 0.55, 7, 0.8);
    } else {
      const s = kind === 1 ? 0.75 : 1;
      this.smoke.emit(x, y + 0.3, z, vx * 0.25 + (r() - 0.5) * 2, 0.8 + r() * 1.5, vz * 0.25 + (r() - 0.5) * 2, 1.2, 3.2 + r() * 2, 2.2 + r() * 1.4, 0.78 * s, 0.52 * s, 0.36 * s, 0.2 * Math.min(1.2, amount), 0, 0.9);
    }
  }
  burst(x, y, z, n, kind) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, sp = 3 + Math.random() * 7; this.dust(x, y, z, Math.cos(a) * sp * 2, Math.sin(a) * sp * 2, 1.4, kind); }
  }
  boost(x, y, z, vx, vy, vz) {
    const r = Math.random;
    this.fire.emit(x, y, z, vx + (r() - 0.5), vy + (r() - 0.5), vz + (r() - 0.5), 0.55, -1.2, 0.12 + r() * 0.06, 1.2, 0.55, 0.22, 1, 0, 2);
    this.fire.emit(x, y, z, vx * 0.6, vy * 0.6, vz * 0.6, 0.35, -0.8, 0.07, 0.6, 0.75, 1.4, 1, 0, 2);
  }
  explosion(x, y, z) {
    const r = Math.random;
    for (let i = 0; i < 55; i++) { const a = r() * TAU, e = r() * 1.2, s = 4 + r() * 10; this.fire.emit(x, y + 0.5, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, 1.2 + r() * 1.6, 5, 0.45 + r() * 0.5, 1.4, 0.55 + r() * 0.2, 0.18, 0.9, -1, 2.5); }
    for (let i = 0; i < 34; i++) { const a = r() * TAU, s = 2 + r() * 5; this.smoke.emit(x + (r() - 0.5) * 2, y + 1.5 + r() * 2.5, z + (r() - 0.5) * 2, Math.cos(a) * s, 3 + r() * 5, Math.sin(a) * s, 1.6 + r() * 1.5, 2.6 + r() * 2, 2.6 + r() * 2, 0.09, 0.08, 0.075, 0.5, -0.9, 0.9); }
    for (let i = 0; i < 24; i++) { const a = r() * TAU, s = 4 + r() * 8; this.smoke.emit(x, y + 0.3, z, Math.cos(a) * s, 0.5 + r(), Math.sin(a) * s, 1.4, 3.5, 1.8, 0.7, 0.5, 0.36, 0.35, 0, 1.5); }
    for (let i = 0; i < 40; i++) { const a = r() * TAU, s = 6 + r() * 14; this.fire.emit(x, y + 0.5, z, Math.cos(a) * s, 6 + r() * 10, Math.sin(a) * s, 0.25, -0.1, 1 + r(), 1.5, 0.8, 0.35, 1, 9.8, 0.3); }
  }
  sparks(x, y, z, n) { const r = Math.random; for (let i = 0; i < n; i++) this.fire.emit(x, y, z, (r() - 0.5) * 10, 2 + r() * 6, (r() - 0.5) * 10, 0.15, -0.05, 0.4 + r() * 0.4, 1.6, 1.1, 0.5, 1, 9.8, 0.5); }
  campfire(p, dt) {
    const r = Math.random;
    if (r() < dt * 40) this.fire.emit(p.x + (r() - 0.5) * 0.9, p.y + 0.5, p.z + (r() - 0.5) * 0.9, (r() - 0.5) * 0.4, 1.8 + r() * 1.4, (r() - 0.5) * 0.4, 0.9 + r() * 0.5, -0.6, 0.7 + r() * 0.4, 1.3, 0.5, 0.15, 0.9, -1.2, 0.5);
    if (r() < dt * 6) this.smoke.emit(p.x, p.y + 2.5, p.z, 0.3, 1.5, 0.2, 1.5, 2.5, 4, 0.18, 0.16, 0.15, 0.4, -0.3, 0.2);
  }
}

/* ---------- Tyre marks ---------- */
class TyreMarks {
  constructor(gfx) {
    const max = this.max = 3000;
    this.pos = new Float32Array(max * 4 * 3); this.alpha = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6); }
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.10, 0.06, 0.04, vA); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; gfx.scene.add(this.mesh);
    this.head = 0; this.last = new Map(); this.dirty = false;
  }
  add(key, x, y, z, nx, nz, width, a) {
    const L = this.last.get(key);
    if (!L || a <= 0.02) { this.last.set(key, a > 0.02 ? { x, y, z, nx, nz } : null); return; }
    const dx = x - L.x, dz = z - L.z; const d2 = dx * dx + dz * dz;
    if (d2 < 0.36) return;
    if (d2 > 16) { this.last.set(key, { x, y, z, nx, nz }); return; }
    const i = this.head; this.head = (this.head + 1) % this.max;
    const hw = width / 2, o = i * 12;
    const p = this.pos;
    p[o] = L.x - L.nx * hw; p[o + 1] = L.y + 0.04; p[o + 2] = L.z - L.nz * hw;
    p[o + 3] = L.x + L.nx * hw; p[o + 4] = L.y + 0.04; p[o + 5] = L.z + L.nz * hw;
    p[o + 6] = x - nx * hw; p[o + 7] = y + 0.04; p[o + 8] = z - nz * hw;
    p[o + 9] = x + nx * hw; p[o + 10] = y + 0.04; p[o + 11] = z + nz * hw;
    for (let k = 0; k < 4; k++) this.alpha[i * 4 + k] = a;
    this.last.set(key, { x, y, z, nx, nz }); this.dirty = true;
  }
  update(dt) {
    if (!this.dirty) return;
    for (let i = 0; i < this.alpha.length; i++) if (this.alpha[i] > 0) this.alpha[i] = Math.max(0, this.alpha[i] - dt * 0.008);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aA.needsUpdate = true;
  }
}

'use strict';
