'use strict';
/* Red Mesa Rally · Renderer setup, sky, materials and shared geometry helpers */

/* ===================================================================
   RED MESA RALLY — rendering: sky, terrain, water, scatter, vehicles, FX
   =================================================================== */
const SUN_DIR = new THREE.Vector3(-0.55, 0.30, 0.78).normalize();
const FOG_AWAY = new THREE.Color(0.46, 0.50, 0.60);   // linear
const FOG_SUN = new THREE.Color(1.15, 0.72, 0.42);    // linear
const g3 = (v) => `vec3(${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)})`;
const c3 = (c) => `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;

const NOISE_GLSL = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1.0,0.0)),u.x), mix(hash12(i+vec2(0.0,1.0)),hash12(i+vec2(1.0,1.0)),u.x), u.y); }
float fbm2(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }
`;

function patchFogChunks() {
  const S = THREE.ShaderChunk;
  S.fog_pars_vertex = `#ifdef USE_FOG
varying float vFogDepth; varying vec3 vFogWorld;
#endif`;
  S.fog_vertex = `#ifdef USE_FOG
vFogDepth = - mvPosition.z;
#ifdef USE_INSTANCING
vFogWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
#endif`;
  S.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear; uniform float fogFar;
#endif
#endif`;
  S.fog_fragment = `#ifdef USE_FOG
{
  vec3 fv = vFogWorld - cameraPosition; float fd = length(fv); vec3 fdir = fv / max(fd, 1e-3);
  float sunAmt = pow(max(dot(fdir, ${g3(SUN_DIR)}), 0.0), 6.0);
  vec3 fc = mix(${c3(FOG_AWAY)}, ${c3(FOG_SUN)}, sunAmt);
  float hk = 0.006; float y0 = max(cameraPosition.y, 0.0); float dy = fv.y;
  float ht = abs(dy) > 0.05 ? (exp(-hk * y0) - exp(-hk * (y0 + dy))) / (hk * dy) : exp(-hk * y0);
  #ifdef FOG_EXP2
  float ff = 1.0 - exp(-fogDensity * fd * clamp(ht, 0.0, 3.0));
  #else
  float ff = smoothstep(fogNear, fogFar, fd);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(ff, 0.0, 1.0));
}
#endif`;
}

function makeCanvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

/* merge simple non-indexed/indexed geometries that share attribute set position/normal/color */
function mergeGeos(list) {
  let nV = 0, nI = 0;
  const geos = list;
  for (const g of geos) { nV += g.attributes.position.count; nI += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 3), idx = new Uint32Array(nI);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (vo + i) * 3);
      if (n) nor.set([n.getX(i), n.getY(i), n.getZ(i)], (vo + i) * 3);
      if (c) col.set([c.getX(i), c.getY(i), c.getZ(i)], (vo + i) * 3); else col.set([1, 1, 1], (vo + i) * 3);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
    vo += p.count; io += g.index ? g.index.count : p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
function tint(geo, r, g, b) { const n = geo.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; } geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; }
function lumpy(geo, amp, freq, seed) {
  const p = geo.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Noise.n2(v.x * freq + seed * 13.1, v.z * freq - seed * 7.7) * 0.6 + Noise.n2(v.y * freq * 2 + seed, v.x * freq * 2) * 0.4;
    v.multiplyScalar(1 + n * amp); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals(); return geo;
}

class Gfx {
  constructor(canvas, world, quality) {
    this.world = world; this.quality = quality;
    patchFogChunks();
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.setQuality(quality);
    const sc = this.scene = new THREE.Scene();
    sc.fog = new THREE.FogExp2(0x9aa0b0, 0.00085);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, 15000);
    this.time = { value: 0 };
    this.buildLights();
    this.buildSky();
    this.buildEnv();
    this.buildTerrain();
    this.buildWater();
    this.buildScatter();
    this.buildHub();
    this.buildProps();
    this.buildJumpFlags();
    this.buildEast();
    this.fx = new FX(this);
    this.marks = new TyreMarks(this);
    this.beacons = [];
    this.gates = new THREE.Group(); sc.add(this.gates);
    this.applyAnisotropy();
  }
  // on high every surface texture gets the GPU's full anisotropic filtering, so road decks and markings stay sharp far ahead
  applyAnisotropy() {
    if (!this.scene) return;
    const a = this.quality === 'high' ? this.renderer.capabilities.getMaxAnisotropy() : 4, seen = new Set();
    const fix = (t) => { if (!t || !t.isTexture || seen.has(t)) return; seen.add(t); if (t.anisotropy !== a) { t.anisotropy = a; t.needsUpdate = true; } };
    this.scene.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k of ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'emissiveMap']) fix(m[k]); });
  }
  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 1.75) : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 0.85));
    this.applyAnisotropy();
    if (this.sun) { const s = q === 'high' ? 2048 : q === 'medium' ? 1536 : 1024; this.sun.shadow.mapSize.set(s, s); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
  }
  resize(w, h) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  buildLights() {
    const hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.65, 0.95), new THREE.Color(0.55, 0.32, 0.2), 0.55);
    this.scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.8, 0.6), 3.6);
    sun.castShadow = true;
    const s = this.quality === 'high' ? 2048 : this.quality === 'medium' ? 1536 : 1024;
    sun.shadow.mapSize.set(s, s);
    const cam = sun.shadow.camera; cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70; cam.near = 1; cam.far = 700;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    this.scene.add(sun); this.scene.add(sun.target);
  }
  updateSun(focus) {
    const snap = 2; const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + SUN_DIR.x * 350, focus.y + SUN_DIR.y * 350, fz + SUN_DIR.z * 350);
  }
  skyShader() {
    return {
      uniforms: { uTime: this.time },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vDir; uniform float uTime; ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir); vec3 S = ${g3(SUN_DIR)};
        float sd = max(dot(d, S), 0.0);
        float h = max(d.y, 0.0);
        vec3 zen = vec3(0.10, 0.22, 0.55);
        vec3 hor = mix(${c3(FOG_AWAY)}, ${c3(FOG_SUN)}, pow(sd, 6.0));
        vec3 col = mix(hor, zen, pow(h, 0.45));
        col += vec3(1.0, 0.55, 0.25) * pow(sd, 3.0) * 0.35 * (1.0 - h);
        // cirrus
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.004, 0.0);
          float c = fbm2(uv * 1.3) * fbm2(uv * vec2(0.6, 3.0) + 4.0);
          c = smoothstep(0.18, 0.42, c) * smoothstep(0.0, 0.25, d.y);
          vec3 cc = mix(vec3(1.0, 0.86, 0.75), vec3(1.6, 0.9, 0.55), pow(sd, 4.0));
          col = mix(col, cc, c * 0.55);
        }
        col += vec3(1.6, 1.15, 0.8) * (pow(sd, 1600.0) * 60.0 + pow(sd, 220.0) * 1.2);
        if (d.y < 0.0) col = mix(col, ${c3(FOG_AWAY)} * 0.9, smoothstep(0.0, -0.2, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    };
  }
  buildSky() {
    const m = new THREE.ShaderMaterial({ ...this.skyShader(), side: THREE.BackSide, depthWrite: false, fog: false });
    const sky = this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), m);
    sky.frustumCulled = false; sky.renderOrder = -10;
    this.scene.add(sky);
  }
  buildEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const es = new THREE.Scene();
    const m = new THREE.ShaderMaterial({ ...this.skyShader(), side: THREE.BackSide, depthWrite: false });
    m.fragmentShader = m.fragmentShader.replace('#include <tonemapping_fragment>', '').replace('#include <colorspace_fragment>', '');
    es.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), m));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.17, 0.09) }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -3; es.add(ground);
    this.envMap = pm.fromScene(es, 0.02).texture;
    this.scene.environment = this.envMap;
    pm.dispose();
  }
  /* ---------- festival hub ---------- */
  buildHub() {
    const g = new THREE.Group(), T = this.world.terrain;
    const stripe = (c1, c2) => makeCanvasTex(256, 64, (x, w, h) => { for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? c1 : c2; x.fillRect(i * w / 16, 0, w / 16 + 1, h); } }, { repeat: true });
    const tents = [['#d9481c', '#efe3cf'], ['#1f4e79', '#efe3cf'], ['#f0b50a', '#2a1a12'], ['#d9481c', '#2a1a12']];
    const rng = mulberry32(31);
    const ph = (x, z) => T.height(x, z);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + 0.3, d = 52 + (i % 2) * 14;
      const x = HUB.x + Math.cos(a) * d, z = HUB.z + Math.sin(a) * d;
      const [c1, c2] = tents[i % 4]; const tex = stripe(c1, c2);
      const r = 5 + rng() * 3;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.8, 16, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
      roof.position.set(x, ph(x, z) + 3 + r * 0.4, z);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.9, side: THREE.DoubleSide }));
      wall.position.set(x, ph(x, z) + 1.5, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      pole.position.set(x, roof.position.y + r * 0.4 + 1.2, z);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.MeshStandardMaterial({ color: c1, side: THREE.DoubleSide }));
      flag.position.set(x + 0.7, pole.position.y + 0.8, z);
      for (const o of [roof, wall, pole, flag]) { o.castShadow = true; o.receiveShadow = true; g.add(o); }
      this.world.scatter.addObstacle(x, z, r, ph(x, z) + 6, 'tent');
    }
    // team trucks and trailers
    const trailerMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.3 });
    const cols = [0xe9e2d6, 0x23262b, 0xd9481c, 0x1f4e79];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + 0.8, d = 30;
      const x = HUB.x + Math.cos(a) * d, z = HUB.z + Math.sin(a) * d, y = ph(x, z);
      const tr = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 10), trailerMat(cols[i % 4])); box.position.y = 2.3; tr.add(box);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), trailerMat(0x2a2d33)); cab.position.set(0, 2.1, -6.4); tr.add(cab);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, 8), new THREE.MeshStandardMaterial({ color: cols[(i + 2) % 4], roughness: 0.8 })); awn.position.set(2.9, 3.4, 0); awn.rotation.z = -0.12; tr.add(awn);
      for (const zz of [-6.4, -2.5, 3.5]) for (const xx of [-1.2, 1.2]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })); w.rotation.z = Math.PI / 2; w.position.set(xx, 0.5, zz); tr.add(w); }
      tr.position.set(x, y, z); tr.rotation.y = -a + Math.PI / 2;
      tr.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(tr);
      this.world.scatter.addObstacle(x + Math.cos(a + Math.PI / 2) * 2.5, z + Math.sin(a + Math.PI / 2) * 2.5, 2.2, y + 4, 'trailer');
      this.world.scatter.addObstacle(x - Math.cos(a + Math.PI / 2) * 2.5, z - Math.sin(a + Math.PI / 2) * 2.5, 2.2, y + 4, 'trailer');
      this.world.scatter.addObstacle(x, z, 2.2, y + 4, 'trailer');
    }
    // string lights over the paddock
    const bulbGeo = new THREE.SphereGeometry(0.12, 6, 4);
    const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.2) });
    const nB = 220, bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, nB); const dmy = new THREE.Object3D(); let bi = 0;
    for (let k = 0; k < 6 && bi < nB; k++) {
      const a0 = k / 6 * TAU + 0.3, a1 = a0 + Math.PI * 0.85;
      const p0 = new THREE.Vector3(HUB.x + Math.cos(a0) * 45, 0, HUB.z + Math.sin(a0) * 45), p1 = new THREE.Vector3(HUB.x + Math.cos(a1) * 45, 0, HUB.z + Math.sin(a1) * 45);
      p0.y = ph(p0.x, p0.z) + 8; p1.y = ph(p1.x, p1.z) + 8;
      for (const p of [p0, p1]) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 8.5), new THREE.MeshStandardMaterial({ color: 0x3a3330 })); pl.position.set(p.x, p.y - 4.2, p.z); pl.castShadow = true; g.add(pl); }
      for (let i = 0; i <= 36 && bi < nB; i++) { const t = i / 36; dmy.position.lerpVectors(p0, p1, t); dmy.position.y -= Math.sin(t * Math.PI) * 3; dmy.updateMatrix(); bulbs.setMatrixAt(bi++, dmy.matrix); }
    }
    bulbs.count = bi; g.add(bulbs);
    // festival arch banner
    const bannerTex = makeCanvasTex(1024, 192, (x, w, h) => {
      x.fillStyle = '#1b120d'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#d9481c'; x.fillRect(0, h - 26, w, 26);
      for (let i = 0; i < 32; i++) { x.fillStyle = i % 2 ? '#f6eee2' : '#1b120d'; x.fillRect(i * w / 32, 0, w / 32, 18); }
      x.fillStyle = '#f6eee2'; x.font = '900 104px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('RED MESA RALLY', w / 2, h / 2 + 4);
    });
    this.bannerTex = bannerTex;
    this.scene.add(g);
    this.hubGroup = g;
    // bonfire
    this.bonfire = new THREE.Vector3(HUB.x, ph(HUB.x, HUB.z), HUB.z);
    const logs = new THREE.Group();
    for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 1 })); l.rotation.z = 1.1; l.rotation.y = i / 6 * TAU; l.position.y = 0.6; logs.add(l); }
    logs.position.copy(this.bonfire); g.add(logs);
    this.world.scatter.addObstacle(HUB.x, HUB.z, 1.6, this.bonfire.y + 1.5, 'fire');
    const fl = this.fireLight = new THREE.PointLight(new THREE.Color(1, 0.55, 0.2), 30, 40, 2);
    fl.position.copy(this.bonfire).add(new THREE.Vector3(0, 2, 0)); g.add(fl);
  }
  makeArch(x, z, yaw, label, colA) {
    const T = this.world.terrain, g = new THREE.Group(), y = Math.max(T.height(x, z), T.waterY(x, z)); // over the river: stand on the water, not the bed
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.6, metalness: 0.4 });
    for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(1.1, 9, 1.1), towerMat); t.position.set(s * 11, 4.5, 0); t.castShadow = true; g.add(t); }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(23, 2.6, 0.4), [towerMat, towerMat, towerMat, towerMat, new THREE.MeshStandardMaterial({ map: label || this.bannerTex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ map: label || this.bannerTex, roughness: 0.7 })]);
    banner.position.y = 8.4; banner.castShadow = true; g.add(banner);
    g.position.set(x, y, z); g.rotation.y = yaw;
    return g;
  }
  makeGate(x, z, yaw, color) {
    const T = this.world.terrain, g = new THREE.Group(), y = Math.max(T.height(x, z), T.waterY(x, z)); // over the river: stand on the water, not the bed
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: new THREE.Color(color).multiplyScalar(0.15) });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.75, 10, 32, Math.PI), mat);
    arch.castShadow = true; g.add(arch);
    g.position.set(x, y - 0.3, z); g.rotation.y = yaw;
    return g;
  }
  /* corner warnings for an event: chevron boards across the far side of each corner, arrows painted on the approach */
  addTurnMarkers(R, color, group, opts = {}) {
    const T = this.world.terrain, col = '#' + new THREE.Color(color).getHexString();
    if (!this._chev) {
      this._chev = makeCanvasTex(512, 128, (x, w, h) => {
        x.fillStyle = '#16100c'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#f4f1e8';
        for (let i = 0; i < 5; i++) { const cx = 60 + i * 98; x.beginPath(); x.moveTo(cx - 30, 14); x.lineTo(cx + 10, 14); x.lineTo(cx + 46, h / 2); x.lineTo(cx + 10, h - 14); x.lineTo(cx - 30, h - 14); x.lineTo(cx + 6, h / 2); x.closePath(); x.fill(); }
      });
      this._arrow = makeCanvasTex(256, 256, (x, w, h) => {
        x.clearRect(0, 0, w, h); x.strokeStyle = 'rgba(244,241,232,0.92)'; x.fillStyle = 'rgba(244,241,232,0.92)'; x.lineWidth = 34; x.lineCap = 'butt';
        x.beginPath(); x.moveTo(w * 0.36, h); x.lineTo(w * 0.36, h * 0.62); x.quadraticCurveTo(w * 0.36, h * 0.36, w * 0.62, h * 0.36); x.stroke();
        x.beginPath(); x.moveTo(w * 0.6, h * 0.14); x.lineTo(w * 0.96, h * 0.36); x.lineTo(w * 0.6, h * 0.58); x.closePath(); x.fill();
      });
    }
    const board = new THREE.MeshStandardMaterial({ map: this._chev, emissive: 0xffffff, emissiveMap: this._chev, emissiveIntensity: 0.55, roughness: 0.6, side: THREE.DoubleSide });
    const trim = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.6, roughness: 0.5 });
    const post = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.5 });
    const arrowMat = new THREE.MeshBasicMaterial({ map: this._arrow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const hw = R.width / 2;
    for (const t of R.turns()) {
      if (opts.sharpOnly && !t.sharp) continue;
      const right = t.ang > 0, sIn = R.wrapS(t.s - 22), [dx, dz] = R.dirAt(sIn), pin = R.posAt(sIn, {});
      // board: straight ahead of the approach, just past the far kerb
      const reach = 22 + hw + 4, bx = pin.x + dx * reach, bz = pin.z + dz * reach, by = T.height(bx, bz);
      const g = new THREE.Group();
      const w = Math.min(12, R.width * 0.75), pl = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), board);
      pl.position.y = 1.4 + w / 8; if (!right) pl.scale.x = -1; g.add(pl);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.18, 0.12), trim); bar.position.set(0, 1.25, -0.05); g.add(bar);
      const bar2 = bar.clone(); bar2.position.y = 1.55 + w / 4; g.add(bar2);
      for (const sx of [-w / 2 + 0.3, w / 2 - 0.3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.4 + w / 4, 0.16), post); p.position.set(sx, (1.4 + w / 4) / 2, -0.12); g.add(p); }
      g.position.set(bx, by, bz); g.rotation.y = Math.atan2(-dx, -dz); // faces the oncoming car
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      group.add(g);
      // arrows painted down the approach
      for (const back of [72, 46, 22]) {
        const sa = R.wrapS(t.s - back); if (!R.closed && sa < 5) continue;
        const pa = R.posAt(sa, {}), [ax, az] = R.dirAt(sa);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), arrowMat);
        m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, Math.atan2(-ax, -az), 0); if (!right) m.scale.x = -1;
        m.position.set(pa.x, T.height(pa.x, pa.z) + 0.05, pa.z); m.renderOrder = 2;
        group.add(m);
      }
    }
  }
  buildJumpFlags() {
    const T = this.world.terrain, poles = [], flags = [];
    for (const R of T.routes) {
      if (!R.jumps) continue;
      for (const sj of R.jumps) {
        const p = R.posAt(sj, {}), [dx, dz] = R.dirAt(sj);
        for (const side of [-1, 1]) {
          const off = R.width / 2 + 1.2, x = p.x - dz * side * off, z = p.z + dx * side * off, y = T.height(x, z);
          const pole = new THREE.CylinderGeometry(0.06, 0.06, 5.5, 6); pole.translate(x, y + 2.75, z); tint(pole, 0.15, 0.13, 0.12); poles.push(pole);
          const fl = new THREE.PlaneGeometry(1.6, 1.0, 4, 1); fl.translate(0.8, 0, 0); fl.rotateY(Math.atan2(dx, dz) + Math.PI / 2); fl.translate(x, y + 4.9, z);
          tint(fl, side < 0 ? 1.0 : 0.95, side < 0 ? 0.32 : 0.9, side < 0 ? 0.06 : 0.82); flags.push(fl);
        }
      }
    }
    if (!poles.length) return;
    const pm = new THREE.Mesh(mergeGeos(poles), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 })); pm.castShadow = true; this.scene.add(pm);
    const fm = new THREE.Mesh(mergeGeos(flags), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })); fm.castShadow = true; this.scene.add(fm);
  }
  /* ---------- props ---------- */
  buildProps() {
    const P = this.world.props.list;
    const barrel = new THREE.CylinderGeometry(0.42, 0.42, 1.2, 14);
    const tyres = mergeGeos([0, 1, 2].map((i) => { const t = new THREE.TorusGeometry(0.4, 0.17, 8, 16); t.rotateX(Math.PI / 2); t.translate(0, -0.35 + i * 0.35, 0); return tint(t, 1, 1, 1); }));
    const crate = new THREE.BoxGeometry(1, 1, 1);
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: 0x8a6136, roughness: 0.9 }),
    ];
    const geos = [barrel, tyres, crate];
    this.propMeshes = [0, 1, 2].map((k) => {
      const list = P.filter((p) => p.kind === k);
      const im = new THREE.InstancedMesh(geos[k], mats[k], Math.max(1, list.length));
      im.count = list.length; im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const col = new THREE.Color(), pal = [0xd9481c, 0x1f4e79, 0xe9e2d6, 0xf0b50a];
      list.forEach((p, i) => { if (k === 0) im.setColorAt(i, col.setHex(pal[i % 4])); else im.setColorAt(i, col.setRGB(1, 1, 1)); });
      this.scene.add(im);
      return { im, list };
    });
    this.updateProps(true);
  }
  updateProps(force) {
    const d = new THREE.Object3D();
    for (const { im, list } of this.propMeshes) {
      let dirty = force;
      list.forEach((p, i) => {
        if (!force && !p.active && p.drawn) return;
        d.position.set(p.x, p.y, p.z); d.rotation.set(p.rx, p.ry, p.rz); d.updateMatrix(); im.setMatrixAt(i, d.matrix); dirty = true; p.drawn = !p.active;
      });
      if (dirty) im.instanceMatrix.needsUpdate = true;
    }
  }
  /* ---------- beacons ---------- */
  addBeacon(ev, x, z, color) {
    const y = this.world.terrain.height(x, z);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uColor: { value: new THREE.Color(color) }, uFade: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform vec3 uColor; uniform float uFade;
        void main(){ float a = (1.0 - vUv.y) * (0.35 + 0.65 * smoothstep(0.0, 0.05, vUv.y));
          a *= 0.55 + 0.45 * sin(vUv.y * 60.0 - uTime * 3.0);
          float edge = pow(abs(vUv.x - 0.5) * 2.0, 0.5); a *= 0.4 + 0.6 * edge;
          gl_FragColor = vec4(uColor * 2.2, a * 0.55 * uFade); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 260, 24, 1, true), mat);
    beam.position.set(x, y + 130, z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(9, 10.5, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.25, z);
    this.scene.add(beam); this.scene.add(ring);
    const b = { ev, beam, ring, x, z, y };
    this.beacons.push(b);
    return b;
  }
  render() { this.sky.position.copy(this.camera.position); this.renderer.render(this.scene, this.camera); }
}
