'use strict';
/* Red Mesa Rally · Procedural car models and the visual car instance */

/* ===================================================================
   RED MESA RALLY — procedural vehicle models
   Local frame matches physics: forward -Z, right +X, up +Y, origin at CoM.
   =================================================================== */
const LIVERY_NAMES = ['DUSTWORKS', 'MESA FUEL', 'HIGH DESERT', 'RIMROCK', 'SIDEWINDER', 'COPPER CO.', 'BADLANDS', 'SUNDOG'];

function profileGeo(pts, width, bevel = 0.05, arches = []) {
  // pts: [[x(forward+), y], ...] outline, counter-clockwise. arches: [{x, y, r}] cut from bottom edge.
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.arch) { s.lineTo(p.arch.x - p.arch.r, p[1]); s.absarc(p.arch.x, p.arch.y, p.arch.r, Math.PI, 0, true); s.lineTo(p.arch.x + p.arch.r, p[1]); continue; }
    s.lineTo(p[0], p[1]);
  }
  const depth = Math.max(0.02, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 14, steps: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // shape x(forward) -> -z
  g.computeVertexNormals();
  return g;
}
function shapeBody(geo, belt, k, z0, z1, taper, tuck) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i); const y = p.getY(i), z = p.getZ(i);
    let s = 1 - Math.max(0, y - belt) * k;
    const t = clamp((Math.abs(z) - z0) / (z1 - z0), 0, 1); s *= 1 - t * t * taper;
    if (tuck) s *= 1 - Math.max(0, tuck[0] - y) * tuck[1];
    p.setX(i, x * s);
  }
  geo.computeVertexNormals(); return geo;
}
function tube(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true; return m;
}
function V(x, y, z) { return new THREE.Vector3(x, y, z); }

function paintMaterial(color, dirt) {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
  addDirt(m, dirt);
  return m;
}
function addDirt(m, dirt) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = dirt.amount; sh.uniforms.uSunVis = dirt.sun;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLP; uniform float uDirt; uniform float uSunVis; float gD;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ float low = smoothstep(${dirt.top.toFixed(2)}, ${dirt.bottom.toFixed(2)}, vLP.y);
  float n = fbm2(vLP.xz * 3.0 + vLP.y * 2.0) * 0.8 + vnoise(vLP.xy * 9.0) * 0.4;
  gD = clamp(uDirt * (low * 1.3 + 0.25) * n * 1.4 - 0.15, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.18, 0.10) * (0.7 + 0.5 * n), gD); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, gD);')
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.directDiffuse *= uSunVis; reflectedLight.directSpecular *= uSunVis;
reflectedLight.indirectDiffuse *= mix(0.35, 1.0, clamp(uSunVis * 2.5, 0.0, 1.0)); reflectedLight.indirectSpecular *= mix(0.25, 1.0, clamp(uSunVis * 2.5, 0.0, 1.0));
#ifdef USE_CLEARCOAT
clearcoatSpecularDirect *= uSunVis * (1.0 - gD);
#endif`);
  };
  m.customProgramCacheKey = () => 'dirt' + dirt.top + dirt.bottom;
}
function sunOnly(m, dirt) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSunVis = dirt.sun;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSunVis;').replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= uSunVis; reflectedLight.directSpecular *= uSunVis;');
  };
  m.customProgramCacheKey = () => 'sunonly';
  return m;
}

function liveryTex(num, color, name) {
  return makeCanvasTex(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const c = '#' + new THREE.Color(color).getHexString();
    g.fillStyle = 'rgba(245,238,226,0.95)'; g.beginPath(); g.arc(150, 128, 92, 0, TAU); g.fill();
    g.fillStyle = '#16100c'; g.font = '900 120px "Saira Stencil One", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(num), 150, 136);
    g.fillStyle = '#16100c'; g.fillRect(260, 92, 240, 72);
    g.fillStyle = '#f5ede0'; g.font = '700 46px "Saira Condensed", Impact, sans-serif'; g.fillText(name, 380, 130);
    g.fillStyle = c; g.globalAlpha = 0.9; g.fillRect(260, 172, 240, 10);
  });
}

function buildTyre(r, w, knobby, riScale) {
  const pts = [];
  const ri = r * (riScale || 0.6), sh = Math.min(w * 0.22, r * 0.18);
  pts.push(new THREE.Vector2(ri, -w / 2));
  pts.push(new THREE.Vector2(r - sh, -w / 2));
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, -w / 2 + sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(r, w / 2 - sh));
  for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(ri, w / 2));
  const g = new THREE.LatheGeometry(pts, 40);
  if (knobby) { // displace outer vertices into tread blocks
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const rr = Math.hypot(v.x, v.z); if (rr > r - sh * 1.2) { const a = Math.atan2(v.z, v.x); const k = (Math.sin(a * 20) > 0.15 ? 1 : 0) * (Math.abs(v.y) < w * 0.45 ? 1 : 0.4); const s = (rr + k * knobby) / rr; p.setXYZ(i, v.x * s, v.y, v.z * s); } }
    g.computeVertexNormals();
  }
  g.rotateZ(Math.PI / 2); // axle along X
  return g;
}
function treadTex() {
  return makeCanvasTex(256, 64, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.fillStyle = '#202020'; for (let i = 0; i < 16; i++) { const x = i * w / 16; g.fillRect(x, 0, 5, h * 0.45); g.fillRect(x + 8, h * 0.55, 5, h * 0.45); g.fillRect(x + 2, h * 0.45, 9, 4); } }, { srgb: false, repeat: true });
}

/* merge static child meshes that share a material: far fewer draw calls per car */
function mergeChildren(group) {
  const groups = new Map();
  for (const m of [...group.children]) {
    if (!m.isMesh || m.userData.dynamic || m.material.map || m.material.bumpMap) continue;
    m.updateMatrix();
    const g = m.geometry.clone().applyMatrix4(m.matrix);
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(g); group.remove(m); m.geometry.dispose();
  }
  for (const [mat, list] of groups) { const mesh = new THREE.Mesh(list.length > 1 ? mergeGeos(list) : list[0], mat); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
}
function buildWheel(spec, mats, style) {
  const ws = spec.wheels, r = ws.r, w = ws.w;
  const spin = new THREE.Group();
  const tyre = new THREE.Mesh(buildTyre(r, w, style.knobby, style.ri), mats.rubber); tyre.castShadow = true; spin.add(tyre);
  const rimR = r * (style.rimScale || 0.62);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, w * 0.82, 20, 1, true), mats.rim); rim.rotation.z = Math.PI / 2; spin.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(rimR * 0.98, 20), mats.rimDark); face.rotation.y = Math.PI / 2; face.position.x = w * 0.2; spin.add(face);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.26, w * 0.2, 10), mats.rim); hub.rotation.z = Math.PI / 2; hub.position.x = w * 0.34; spin.add(hub);
  const nS = style.spokes || 6;
  for (let i = 0; i < nS; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, rimR * 0.9, rimR * 0.16), mats.rim); s.position.set(w * 0.28, 0, 0); s.rotation.x = i / nS * TAU; s.translateY(rimR * 0.48); spin.add(s); }
  mergeChildren(spin);
  const steer = new THREE.Group(); steer.add(spin);
  return { steer, spin };
}

/* Decals that follow the body: a grid patch is ray-cast onto the paint meshes so glass, lamps and
   stripes sit on the actual surface (tapers, bevels, tumblehome) instead of floating as flat boxes.
   Each row is trimmed to where the surface still faces the patch (and to an optional outline). */
const _rc = new THREE.Raycaster();
function conformPatch(targets, o) {
  const U = o.U.clone().normalize(), V = o.V.clone().normalize(), D = o.dir.clone().normalize(), N0 = D.clone().negate();
  const reach = o.reach || 1.5, thr = o.thr ?? 0.5, off = o.off ?? 0.006, nv = o.nv || 8, nu = o.nu || 14, probe = o.probe || 40, margin = o.margin || 0;
  for (const t of targets) t.updateMatrixWorld(true);
  const cast = (u, v) => {
    const org = o.c.clone().addScaledVector(U, u).addScaledVector(V, v).addScaledVector(D, -reach);
    _rc.set(org, D); _rc.far = reach * 2.2;
    const h = _rc.intersectObjects(targets, false)[0];
    if (!h || !h.face) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (n.dot(N0) < thr) return null;
    return { p: h.point.clone().addScaledVector(n, off), n };
  };
  const rows = [];
  for (let j = 0; j <= nv; j++) {
    const v = -o.h / 2 + o.h * j / nv;
    // probe the row, keep the widest run that both hits facing surface and lies inside the outline
    let best = null, run = null;
    for (let i = 0; i <= probe; i++) {
      const u = -o.w / 2 + o.w * i / probe;
      const ok = (!o.inside || o.inside(u, v)) && cast(u, v);
      if (ok) { if (!run) run = [u, u]; else run[1] = u; } else if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
    }
    if (run && (!best || run[1] - run[0] > best[1] - best[0])) best = run;
    if (!best || best[1] - best[0] < 2 * margin + 0.02) { rows.push(null); continue; }
    const uL = best[0] + margin, uR = best[1] - margin, pts = [];
    for (let i = 0; i <= nu; i++) { const h = cast(uL + (uR - uL) * i / nu, v); if (!h) { pts.length = 0; break; } pts.push(h); }
    rows.push(pts.length ? pts : null);
  }
  const pos = [], nor = [], uv = [], idx = [];
  const base = [];
  rows.forEach((r, j) => { base.push(pos.length / 3); if (r) r.forEach((h, i) => { pos.push(h.p.x, h.p.y, h.p.z); nor.push(h.n.x, h.n.y, h.n.z); uv.push(i / nu, j / nv); }); });
  for (let j = 0; j < nv; j++) if (rows[j] && rows[j + 1]) for (let i = 0; i < nu; i++) {
    const a = base[j] + i, b = base[j + 1] + i;
    const flip = U.clone().cross(V).dot(N0) < 0;
    if (flip) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); return g;
}
function inPoly(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
/* glass for one cabin: windshield, rear window and side windows, all cast onto the cabin paint */
function cabinGlass(add, targets, glass, spec) {
  const yz = (a, b) => { // patch spanning profile points a -> b (profile x forward = -z)
    const A = new THREE.Vector3(0, a[1], -a[0]), B = new THREE.Vector3(0, b[1], -b[0]);
    const V = B.clone().sub(A), c = A.clone().add(B).multiplyScalar(0.5), L = V.length(); V.normalize();
    let n = new THREE.Vector3(0, -V.z, V.y); if (n.y < 0) n.negate();
    return { c, V, n, L };
  };
  for (const [a, b, w] of [[spec.front[0], spec.front[1], spec.width], [spec.rear[0], spec.rear[1], spec.width]]) {
    const p = yz(a, b);
    const g = conformPatch(targets, { c: p.c, U: new THREE.Vector3(1, 0, 0), V: p.V, dir: p.n.clone().negate(), w, h: p.L, nv: 6, nu: 12, thr: 0.62, margin: spec.pillar || 0.07 });
    if (g) add(g, glass);
  }
  if (spec.side) for (const sd of [-1, 1]) {
    const poly = spec.side; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const inside = (u, v) => inPoly(cx + u, cy + v, poly) && !(spec.bpillar !== undefined && Math.abs(cx + u - spec.bpillar) < 0.05);
    const g = conformPatch(targets, { c: new THREE.Vector3(0, cy, -cx), U: new THREE.Vector3(0, 0, -1), V: new THREE.Vector3(0, 1, 0), dir: new THREE.Vector3(-sd, 0, 0), w: x1 - x0, h: y1 - y0, nv: 6, nu: 16, probe: 60, thr: 0.25, inside, reach: 2 });
    if (g) add(g, glass);
  }
}
/* a lamp or stripe cast onto the body */
function bodyDecal(add, targets, mat, c, U, V, dir, w, h, o = {}) {
  const g = conformPatch(targets, { c, U, V, dir, w, h, nv: o.nv || 3, nu: o.nu || 6, thr: o.thr ?? 0.35, off: o.off ?? 0.008, probe: o.probe || 24 });
  if (g) add(g, mat);
  return g;
}
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

function buildCar(spec, opts, gfx) {
  const color = opts.color || spec.color, num = opts.number || 7, name = opts.livery || LIVERY_NAMES[num % LIVERY_NAMES.length];
  const root = new THREE.Group();
  const dirt = { amount: { value: opts.dirt || 0.15 }, sun: { value: 1 }, top: 0, bottom: -0.6 };
  const S = { rally: [0.3, -0.35], buggy: [0.6, -0.3], truck: [0.6, -0.4], kaze: [0.05, -0.32], ironside: [0.05, -0.34], super: [0.0, -0.33], sedan: [0.0, -0.36], van: [0.1, -0.4], boat: [-0.1, -0.45] }[spec.id] || [0.3, -0.4];
  dirt.top = S[0]; dirt.bottom = S[1];
  const paint = paintMaterial(color, dirt);
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6, metalness: 0.2 }); addDirt(black, dirt);
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.3, metalness: 0.95 }); sunOnly(metal, dirt);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1116, roughness: 0.04, metalness: 0.6, envMapIntensity: 1.6, clearcoat: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); sunOnly(glass, dirt);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1716, roughness: 0.92, bumpMap: treadTex(), bumpScale: 2 }); rubber.bumpMap.repeat.set(1, 3); addDirt(rubber, { ...dirt, top: 0.4, bottom: -0.4 });
  const rimCol = { rally: 0xe8e8e8, buggy: 0x1d1d1d, truck: 0x2a2a2a, kaze: 0xc9ced4, ironside: 0x9ea3a8, super: 0x2a2b30, sedan: 0xb9bdc2, van: 0x8d9196, boat: 0x9ea3a8 }[spec.id];
  const rim = new THREE.MeshStandardMaterial({ color: rimCol, roughness: 0.25, metalness: 0.9 }); sunOnly(rim, dirt);
  const rimDark = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.6, metalness: 0.5 });
  const lightW = new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: new THREE.Color(1.6, 1.5, 1.3), roughness: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const lightR = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: new THREE.Color(0.6, 0.02, 0.01), roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const mats = { paint, black, metal, glass, rubber, rim, rimDark, lightW, lightR };
  const sp = spec, ws = sp.wheels;
  const groundY = -(ws.r - ws.y + (sp.susp.rest - sp.mass * 9.81 / 4 / sp.susp.k)) + 0; // approx ground at rest (local)
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; root.add(m); return m; };
  const decal = (x, y, z, sx, flip) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sx * 0.5), new THREE.MeshStandardMaterial({ map: liveryTex(num, color, name), transparent: true, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 })); m.position.set(x, y, z); m.rotation.y = flip ? -Math.PI / 2 : Math.PI / 2; root.add(m); return m; };
  let driverPos;

  if (spec.boat) {
    // deep-vee runabout: pointed bow, flat transom, centre console and twin outboards
    const hullG = profileGeo([[3.15, 0.46], [2.75, 0.12], [2.0, -0.28], [0.6, -0.44], [-2.9, -0.42], [-3.06, -0.22], [-3.06, 0.44]], 2.24, 0.06);
    { const p = hullG.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); const t = clamp((-z - 0.4) / 2.75, 0, 1); p.setX(i, p.getX(i) * (1 - t * t * 0.92) * (1 - clamp((0.15 - y) * 0.8, 0, 0.55))); } hullG.computeVertexNormals(); }
    const hull = add(hullG, paint);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.85 }); addDirt(deckMat, dirt);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.06, 4.6), deckMat); deck.position.set(0, 0.3, 0.55); deck.receiveShadow = true; root.add(deck);
    const stripe = new THREE.MeshStandardMaterial({ color: 0x16100c, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const sd of [-1, 1]) { bodyDecal(add, [hull], stripe, v3(sd * 1.1, 0.24, 0.5), v3(0, 0, -1), v3(0, 1, 0), v3(-sd, 0, 0), 4.6, 0.08, { nu: 12, nv: 1, thr: 0.3 }); decal(sd * 1.07, 0.02, 0.6, 1.1, sd < 0); }
    // console + screen
    add(new THREE.BoxGeometry(0.9, 0.85, 0.75), paint, 0, 0.72, -0.2);
    const scr = add(new THREE.BoxGeometry(0.95, 0.42, 0.05), glass, 0, 1.32, -0.5); scr.rotation.x = -0.45;
    add(new THREE.BoxGeometry(0.5, 0.55, 0.5), black, 0, 0.6, 0.75); // seat
    // grab rails round the bow
    const rail = new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.25, metalness: 0.9 });
    for (const sd of [-1, 1]) { root.add(tube(V(sd * 0.95, 0.75, 0.6), V(sd * 0.7, 0.75, -1.9), 0.03, rail)); root.add(tube(V(sd * 0.7, 0.75, -1.9), V(sd * 0.12, 0.72, -2.85), 0.03, rail)); for (const z of [0.4, -0.9, -1.9]) root.add(tube(V(sd * (z < -1 ? 0.7 : 0.9), 0.45, z), V(sd * (z < -1 ? 0.7 : 0.92), 0.75, z), 0.025, rail)); }
    // twin outboards on the transom
    for (const sd of [-0.48, 0.48]) {
      add(new THREE.BoxGeometry(0.42, 0.62, 0.55), black, sd, 0.62, 3.25);
      add(new THREE.BoxGeometry(0.44, 0.12, 0.57), paint, sd, 0.96, 3.25);
      add(new THREE.BoxGeometry(0.14, 0.95, 0.24), black, sd, -0.1, 3.36);
    }
    for (const sd of [-1, 1]) bodyDecal(add, [hull], lightR, v3(sd * 0.6, 0.3, 3.07), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 0.2, 0.1);
    driverPos = V(0, 0.55, 0.35);
  } else if (spec.id === 'sedan' || spec.id === 'van') {
    const van = spec.id === 'van';
    const yb = -0.36, archR = ws.r + 0.07, ay = -0.2;
    const body = add(shapeBody(profileGeo(van
      ? [[2.5, yb], [2.58, -0.1], [2.55, 0.35], [2.3, 0.62], [-2.55, 0.66], [-2.6, 0.2], [-2.58, yb], Object.assign([-1.0, yb], { arch: { x: -ws.zr, y: ay, r: archR } }), Object.assign([2.5, yb], { arch: { x: -ws.zf, y: ay, r: archR } })]
      : [[2.22, yb], [2.3, -0.16], [2.27, 0.06], [1.95, 0.17], [0.95, 0.24], [-1.5, 0.29], [-2.1, 0.27], [-2.3, 0.1], [-2.32, -0.16], [-2.24, yb], Object.assign([-1.0, yb], { arch: { x: -ws.zr, y: ay, r: archR } }), Object.assign([2.22, yb], { arch: { x: -ws.zf, y: ay, r: archR } })],
    van ? 1.98 : 1.8, 0.1), 0.0, 0.2, 1.7, 2.4, 0.1, [-0.2, 0.25]), paint);
    const cab = add(shapeBody(profileGeo(van
      ? [[2.3, 0.6], [1.75, 1.42], [-2.55, 1.46], [-2.55, 0.62]]
      : [[0.95, 0.22], [0.45, 0.66], [0.1, 0.78], [-1.0, 0.78], [-1.55, 0.28]], van ? 1.96 : 1.62, 0.08), van ? 0.7 : 0.25, van ? 0.04 : 0.36, 9, 10, 0), van ? paint : paint);
    cabinGlass(add, [cab], glass, van
      ? { front: [[2.2, 0.72], [1.82, 1.36]], rear: [[-2.55, 0.9], [-2.55, 1.35]], width: 2.1, side: [[2.15, 0.76], [1.78, 1.36], [1.0, 1.38], [1.0, 0.78]] }
      : { front: [[0.88, 0.27], [0.15, 0.75]], rear: [[-1.48, 0.32], [-1.05, 0.75]], width: 1.8, side: [[0.82, 0.29], [0.42, 0.62], [0.1, 0.73], [-0.95, 0.73], [-1.42, 0.33]], bpillar: -0.35 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.25, metalness: 0.9 }); sunOnly(chrome, dirt);
    const L = van ? 2.6 : 2.32, hw = van ? 0.98 : 0.89;
    add(new THREE.BoxGeometry(hw * 2 + 0.04, 0.16, 0.12), black, 0, -0.24, -L); add(new THREE.BoxGeometry(hw * 2 + 0.04, 0.16, 0.12), black, 0, -0.24, L);
    add(new THREE.BoxGeometry(0.9, 0.16, 0.04), chrome, 0, 0.0, -L - 0.02);
    for (const sd of [-1, 1]) {
      bodyDecal(add, [body], lightW, v3(sd * hw * 0.68, van ? 0.12 : 0.02, -L), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), 0.36, 0.12);
      bodyDecal(add, [body], lightR, v3(sd * hw * 0.72, van ? 0.3 : 0.08, L), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 0.3, 0.14);
      add(new THREE.BoxGeometry(0.12, 0.08, 0.1), black, sd * (hw + 0.05), van ? 1.0 : 0.5, van ? -1.75 : -0.45);
      if (van) decal(sd * 1.0, 0.75, 0.3, 2.0, sd < 0);
    }
    driverPos = van ? V(-0.45, 0.5, -1.35) : V(-0.38, -0.08, 0.05);
  } else if (spec.id === 'rally') {
    const fz = -ws.zf, rz = -ws.zr; // forward-positive x in profile space
    const yb = -0.33, archR = 0.43, ay = -0.27;
    const body = add(shapeBody(profileGeo([[2.06, yb], [2.14, -0.05], [2.13, 0.1], [2.02, 0.22], [1.7, 0.29], [1.2, 0.35], [0.95, 0.38], [-1.6, 0.43], [-1.95, 0.4], [-2.1, 0.3], [-2.13, 0.08], [-2.06, yb], Object.assign([-1.0, yb], { arch: { x: -ws.zr, y: ay, r: archR } }), Object.assign([2.08, yb], { arch: { x: -ws.zf, y: ay, r: archR } })], 1.8, 0.1), 0.05, 0.2, 1.45, 2.2, 0.16, [-0.15, 0.25]), paint);
    // cabin
    const cab = add(shapeBody(profileGeo([[1.0, 0.36], [0.62, 0.62], [0.2, 0.84], [-0.2, 0.89], [-0.98, 0.88], [-1.62, 0.43]], 1.5, 0.1), 0.38, 0.42, 9, 10, 0), paint);
    // glass cast onto the cabin
    cabinGlass(add, [cab], glass, { front: [[0.93, 0.42], [0.25, 0.82]], rear: [[-1.55, 0.47], [-1.02, 0.86]], width: 1.7, side: [[0.86, 0.45], [0.55, 0.64], [0.22, 0.79], [-0.92, 0.81], [-1.46, 0.48]], bpillar: -0.3 });
    add(new THREE.BoxGeometry(1.2, 0.12, 0.08), black, 0, -0.22, 2.14); // diffuser
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.16, 0.2), black, s * 0.4, -0.25, 2.06);
    // flares, bumpers, details
    for (const s of [-1, 1]) {
      for (const z of [ws.zf, ws.zr]) { const f = add(new THREE.TorusGeometry(archR + 0.02, 0.07, 6, 16, Math.PI), black, s * 0.9, ay, z); f.rotation.y = Math.PI / 2; }
      add(new THREE.BoxGeometry(0.16, 0.05, 0.08), black, s * 0.86, 0.6, -0.55); // mirrors
      add(new THREE.BoxGeometry(0.3, 0.38, 0.03), new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.8 }), s * 0.62, -0.42, ws.zr + 0.5); // mud flaps
      decal(s * 0.905, 0.08, 0.05, 0.95, s < 0);
    }
    add(new THREE.BoxGeometry(1.7, 0.18, 0.16), black, 0, -0.18, -2.1);
    add(new THREE.BoxGeometry(1.7, 0.18, 0.16), black, 0, -0.18, 2.12);
    add(new THREE.BoxGeometry(1.0, 0.16, 0.04), black, 0, 0.06, -2.15); // grille
    for (const x of [-0.6, -0.2, 0.2, 0.6]) { const l = add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14), lightW, x, 0.3, -2.3); l.rotation.x = Math.PI / 2; const c = add(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 14), black, x, 0.3, -2.25); c.rotation.x = Math.PI / 2; } // spot pod
    add(new THREE.BoxGeometry(1.5, 0.06, 0.06), black, 0, 0.3, -2.2); for (const x of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.05, 0.16, 0.05), black, x, 0.22, -2.2);
    for (const s of [-1, 1]) {
      bodyDecal(add, [body], lightW, v3(s * 0.6, 0.04, -2.1), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), 0.38, 0.13);
      bodyDecal(add, [body], lightR, v3(s * 0.62, 0.2, 2.1), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 0.4, 0.13);
    }
    // rear wing
    add(new THREE.BoxGeometry(1.5, 0.05, 0.36), black, 0, 0.95, 1.55).rotation.x = -0.12;
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.2, 0.36), black, s * 0.74, 0.86, 1.55);
    add(new THREE.BoxGeometry(0.5, 0.1, 0.45), black, 0, 0.9, -0.1); // roof scoop
    const ex = add(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 10), metal, 0.55, -0.26, 2.1); ex.rotation.x = Math.PI / 2;
    driverPos = V(-0.35, 0.1, 0.12);
  } else if (spec.id === 'buggy') {
    const frame = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.9), roughness: 0.35, metalness: 0.5 }); addDirt(frame, dirt);
    const yb = -0.2;
    // floor pan + nose
    const pan = add(profileGeo([[1.75, -0.05], [1.4, 0.25], [0.6, 0.3], [-0.2, 0.15], [-1.4, 0.05], [-1.5, yb], [1.65, yb]], 1.1, 0.05), paint);
    // side pods
    for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.28, 0.32, 1.6), paint, s * 0.6, 0.0, 0.05); decal(s * 0.745, 0.02, 0.1, 0.62, s < 0); }
    // cage
    const P = { fl: V(-0.55, 0.15, -0.6), fr: V(0.55, 0.15, -0.6), rl: V(-0.6, 0.12, 0.55), rr: V(0.6, 0.12, 0.55), tfl: V(-0.45, 1.05, -0.25), tfr: V(0.45, 1.05, -0.25), trl: V(-0.5, 1.08, 0.55), trr: V(0.5, 1.08, 0.55), nl: V(-0.35, 0.25, -1.55), nr: V(0.35, 0.25, -1.55), bl: V(-0.55, 0.3, 1.5), br: V(0.55, 0.3, 1.5) };
    const R = 0.035;
    for (const [a, b] of [['fl', 'tfl'], ['fr', 'tfr'], ['rl', 'trl'], ['rr', 'trr'], ['tfl', 'tfr'], ['trl', 'trr'], ['tfl', 'trl'], ['tfr', 'trr'], ['tfl', 'trr'], ['fl', 'nl'], ['fr', 'nr'], ['nl', 'nr'], ['rl', 'bl'], ['rr', 'br'], ['bl', 'br'], ['trl', 'bl'], ['trr', 'br'], ['fl', 'rl'], ['fr', 'rr']]) root.add(tube(P[a], P[b], R, frame));
    // engine
    add(new THREE.BoxGeometry(0.7, 0.45, 0.6), black, 0, 0.18, 1.0);
    add(new THREE.BoxGeometry(0.5, 0.2, 0.35), metal, 0, 0.5, 0.95);
    for (const s of [-1, 1]) { const e = add(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), metal, s * 0.25, 0.42, 1.5); e.rotation.x = 1.2; }
    add(new THREE.BoxGeometry(1.4, 0.05, 0.4), paint, 0, 1.25, 1.35).rotation.x = -0.2; // wing
    for (const s of [-1, 1]) root.add(tube(V(s * 0.45, 1.08, 0.9), V(s * 0.5, 1.23, 1.3), 0.025, frame));
    { const nV = v3(0, 0.3, 0.35).normalize(), nN = v3(0, 0.35, -0.3).normalize(); for (const s of [-1, 1]) bodyDecal(add, [pan], lightW, v3(s * 0.26, 0.1, -1.58), v3(1, 0, 0), nV, nN.clone().negate(), 0.24, 0.12); }
    add(new THREE.BoxGeometry(0.5, 0.5, 0.08), black, 0, 0.5, 0.3); // seat back
    driverPos = V(0, 0.32, 0.05);
  } else if (spec.id === 'kaze') {
    const yb = -0.36, archR = ws.r + 0.07, ay = -0.19;
    const body = add(shapeBody(profileGeo([[2.18, yb], [2.25, -0.22], [2.22, -0.04], [1.95, 0.05], [1.3, 0.13], [0.82, 0.18], [-1.4, 0.24], [-1.95, 0.24], [-2.2, 0.12], [-2.24, -0.16], [-2.16, yb], Object.assign([-1.0, yb], { arch: { x: -ws.zr, y: ay, r: archR } }), Object.assign([2.18, yb], { arch: { x: -ws.zf, y: ay, r: archR } })], 1.86, 0.1), 0.0, 0.32, 1.5, 2.25, 0.14, [-0.2, 0.3]), paint);
    const cab = add(shapeBody(profileGeo([[0.86, 0.17], [0.42, 0.48], [0.05, 0.6], [-0.65, 0.6], [-1.6, 0.26]], 1.5, 0.08), 0.18, 0.5, 9, 10, 0), paint);
    cabinGlass(add, [cab], glass, { front: [[0.8, 0.21], [0.1, 0.58]], rear: [[-1.5, 0.28], [-0.72, 0.58]], width: 1.7, side: [[0.74, 0.23], [0.4, 0.45], [0.05, 0.56], [-0.62, 0.56], [-1.42, 0.29]] });
    add(new THREE.BoxGeometry(1.9, 0.05, 0.42), black, 0, -0.35, -2.15); // splitter
    for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.08, 0.1, 2.2), black, s * 0.93, -0.3, 0.0); add(new THREE.BoxGeometry(0.15, 0.05, 0.08), black, s * 0.8, 0.43, -0.45); decal(s * 0.94, -0.05, 0.1, 0.9, s < 0); }
    {
      for (const s of [-1, 1]) {
        bodyDecal(add, [body], lightW, v3(s * 0.6, -0.11, -2.2), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), 0.42, 0.08, { thr: 0.6 });
        bodyDecal(add, [body], lightR, v3(s * 0.57, 0.06, 2.3), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 0.48, 0.1, { thr: 0.65 });
      }
      bodyDecal(add, [body], lightR, v3(0, 0.08, 2.3), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 0.72, 0.03, { nv: 1, thr: 0.65 }); }
    add(new THREE.BoxGeometry(0.7, 0.04, 0.7), black, 0, 0.17, -1.25); // hood vent
    add(new THREE.BoxGeometry(1.8, 0.04, 0.38), black, 0, 0.62, 2.0).rotation.x = -0.1; // wing
    for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.04, 0.4, 0.32), black, s * 0.6, 0.43, 2.02); add(new THREE.BoxGeometry(0.04, 0.18, 0.42), black, s * 0.9, 0.62, 2.0); }
    add(new THREE.BoxGeometry(1.3, 0.14, 0.1), black, 0, -0.27, 2.31);
    for (const s of [-0.35, 0.35]) { const e = add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), metal, s, -0.26, 2.37); e.rotation.x = Math.PI / 2; }
    driverPos = V(-0.36, -0.16, 0.12);
  } else if (spec.id === 'ironside') {
    const yb = -0.34, archR = ws.r + 0.06, ay = -0.19;
    const body = add(shapeBody(profileGeo([[2.38, yb], [2.42, -0.06], [2.39, 0.18], [2.12, 0.27], [0.72, 0.31], [-1.3, 0.3], [-2.25, 0.3], [-2.4, 0.16], [-2.42, -0.2], [-2.36, yb], Object.assign([-1.0, yb], { arch: { x: -ws.zr, y: ay, r: archR } }), Object.assign([2.38, yb], { arch: { x: -ws.zf, y: ay, r: archR } })], 1.95, 0.08), 0.1, 0.12, 2.0, 2.45, 0.06), paint);
    const cab = add(shapeBody(profileGeo([[0.7, 0.29], [0.18, 0.66], [-0.42, 0.7], [-1.05, 0.56], [-2.05, 0.32]], 1.52, 0.08), 0.3, 0.42, 9, 10, 0), paint);
    cabinGlass(add, [cab], glass, { front: [[0.64, 0.34], [0.2, 0.64]], rear: [[-1.95, 0.35], [-1.1, 0.55]], width: 1.7, side: [[0.58, 0.35], [0.16, 0.62], [-0.4, 0.66], [-0.98, 0.54], [-1.82, 0.37]], bpillar: -0.72 });
    const bulge = add(new THREE.BoxGeometry(0.62, 0.1, 1.5), paint, 0, 0.33, -1.25); // hood bulge
    const white = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 }); addDirt(white, dirt);
    // twin racing stripes laid over hood, roof and deck
    for (const s of [-0.22, 0.22]) {
      bodyDecal(add, [body, bulge], white, v3(s, 0.4, -1.55), v3(1, 0, 0), v3(0, 0, -1), v3(0, -1, 0), 0.16, 1.66, { nv: 14, nu: 2, thr: 0.55, off: 0.005 });
      bodyDecal(add, [cab], white, v3(s, 0.7, 0.1), v3(1, 0, 0), v3(0, 0, -1), v3(0, -1, 0), 0.16, 0.6, { nv: 6, nu: 2, thr: 0.8, off: 0.005 });
      bodyDecal(add, [body], white, v3(s, 0.4, 2.22), v3(1, 0, 0), v3(0, 0, -1), v3(0, -1, 0), 0.16, 0.34, { nv: 3, nu: 2, thr: 0.8, off: 0.005 });
    }
    add(new THREE.BoxGeometry(1.98, 0.14, 0.12), metal, 0, -0.24, -2.52); add(new THREE.BoxGeometry(1.98, 0.14, 0.12), metal, 0, -0.24, 2.53);
    add(new THREE.BoxGeometry(1.5, 0.26, 0.04), black, 0, 0.0, -2.495);
    for (const s of [-1, 1]) for (const k of [0.62, 0.38]) { const h = add(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), lightW, s * k, 0.02, -2.51); h.rotation.x = Math.PI / 2; }
    for (const s of [-1, 1]) { bodyDecal(add, [body], lightR, v3(s * 0.52, 0.06, 2.4), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 0.6, 0.15); decal(s * 0.985, -0.02, -0.1, 0.95, s < 0); add(new THREE.BoxGeometry(0.14, 0.06, 0.08), metal, s * 0.85, 0.45, -0.3); }
    add(new THREE.BoxGeometry(1.7, 0.06, 0.25), paint, 0, 0.36, 2.28).rotation.x = -0.25; // ducktail
    for (const s of [-0.5, 0.5]) { const e = add(new THREE.CylinderGeometry(0.065, 0.065, 0.26, 10), metal, s, -0.32, 2.56); e.rotation.x = Math.PI / 2; }
    driverPos = V(-0.4, -0.14, 0.2);
  } else if (spec.id === 'super') {
    // mid-engined wedge: long low nose, the cabin pushed forward, the V12 under louvres behind it
    const yb = -0.34, archR = ws.r + 0.07, ay = -0.2;
    const body = add(shapeBody(profileGeo([[2.24, yb], [2.32, -0.25], [2.27, -0.14], [1.7, -0.04], [0.95, 0.07], [-0.2, 0.16], [-1.7, 0.22], [-2.18, 0.22], [-2.3, 0.06], [-2.28, -0.2], [-2.2, yb], Object.assign([-1.0, yb], { arch: { x: -ws.zr, y: ay, r: archR } }), Object.assign([2.24, yb], { arch: { x: -ws.zf, y: ay, r: archR } })], 1.98, 0.1), -0.05, 0.3, 1.55, 2.3, 0.12, [-0.2, 0.3]), paint);
    const cab = add(shapeBody(profileGeo([[0.95, 0.06], [0.45, 0.34], [0.0, 0.47], [-0.55, 0.47], [-1.75, 0.2]], 1.42, 0.08), 0.1, 0.55, 9, 10, 0), paint);
    cabinGlass(add, [cab], glass, { front: [[0.88, 0.1], [0.05, 0.45]], rear: [[-1.62, 0.23], [-0.62, 0.45]], width: 1.6, side: [[0.82, 0.11], [0.42, 0.33], [0.0, 0.43], [-0.6, 0.43], [-1.3, 0.28]] });
    add(new THREE.BoxGeometry(1.94, 0.04, 0.46), black, 0, -0.33, -2.22); // splitter
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.06, 0.24, 0.9), black, s * 0.97, -0.08, 0.35); // side intakes
      add(new THREE.BoxGeometry(0.08, 0.08, 2.1), black, s * 0.96, -0.31, 0.0); // skirts
      add(new THREE.BoxGeometry(0.14, 0.05, 0.08), black, s * 0.78, 0.28, -0.75); // mirrors
      decal(s * 0.985, -0.06, -0.6, 0.85, s < 0);
      bodyDecal(add, [body], lightW, v3(s * 0.62, -0.08, -2.25), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), 0.46, 0.06, { thr: 0.6 });
    }
    bodyDecal(add, [body], lightR, v3(0, 0.1, 2.3), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 1.7, 0.05, { nv: 1, thr: 0.65 }); // full-width tail light
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(1.0, 0.03, 0.08), black, 0, 0.25, 0.95 + i * 0.2); // engine louvres
    add(new THREE.BoxGeometry(2.0, 0.05, 0.44), black, 0, 0.66, 2.02).rotation.x = -0.14; // wing
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.42, 0.3), black, s * 0.55, 0.44, 2.04);
    add(new THREE.BoxGeometry(1.6, 0.16, 0.22), black, 0, -0.27, 2.24); // diffuser
    for (const s of [-0.12, 0.12]) for (const y of [-0.12, 0.0]) { const e = add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), metal, s, y, 2.3); e.rotation.x = Math.PI / 2; }
    driverPos = V(-0.34, -0.26, -0.05);
  } else {
    // truck
    const yb = -0.25, archR = 0.66, ay = ws.y - (sp.susp.rest - 0.1);
    const body = add(shapeBody(profileGeo([[2.42, yb], [2.47, 0.3], [2.36, 0.62], [2.1, 0.72], [1.0, 0.84], [-2.4, 0.8], [-2.46, 0.5], [-2.45, yb], Object.assign([-1.0, yb], { arch: { x: -ws.zr, y: ay, r: archR } }), Object.assign([2.42, yb], { arch: { x: -ws.zf, y: ay, r: archR } })], 2.1, 0.12), 0.4, 0.08, 2.0, 2.5, 0.08), paint);
    const cab = add(shapeBody(profileGeo([[1.0, 0.8], [0.35, 1.55], [-0.75, 1.58], [-0.85, 0.8]], 1.9, 0.1), 0.9, 0.16, 9, 10, 0), paint);
    cabinGlass(add, [cab], glass, { front: [[0.92, 0.92], [0.42, 1.48]], rear: [[-0.83, 0.98], [-0.77, 1.46]], width: 2.1, side: [[0.86, 0.93], [0.4, 1.45], [-0.64, 1.47], [-0.71, 0.93]] });
    // bed walls
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.35, 1.5), paint, s * 1.0, 0.95, -1.7 + 3.4);
    add(new THREE.BoxGeometry(2.0, 0.35, 0.08), paint, 0, 0.95, 2.4);
    // roll bar + light bar
    const bar = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4, metalness: 0.6 }); addDirt(bar, dirt);
    for (const s of [-1, 1]) root.add(tube(V(s * 0.9, 0.8, -0.95 + 1.9), V(s * 0.8, 1.9, -0.9 + 1.9), 0.05, bar));
    root.add(tube(V(-0.8, 1.9, 1.0), V(0.8, 1.9, 1.0), 0.05, bar));
    add(new THREE.BoxGeometry(1.5, 0.14, 0.14), black, 0, 1.68, -0.45);
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.18, 0.1, 0.03), lightW, -0.62 + i * 0.25, 1.68, -0.53);
    // bull bar
    for (const s of [-1, 1]) root.add(tube(V(s * 0.75, -0.1, -2.5), V(s * 0.65, 0.7, -2.55), 0.05, bar));
    root.add(tube(V(-0.75, 0.2, -2.55), V(0.75, 0.2, -2.55), 0.05, bar));
    root.add(tube(V(-0.65, 0.7, -2.55), V(0.65, 0.7, -2.55), 0.05, bar));
    // snorkel
    root.add(tube(V(0.98, 0.5, -1.05), V(0.98, 1.6, -1.0), 0.07, black));
    for (const s of [-1, 1]) { bodyDecal(add, [body], lightW, v3(s * 0.68, 0.52, -2.4), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), 0.36, 0.14); bodyDecal(add, [body], lightR, v3(s * 0.84, 0.46, 2.4), v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1), 0.2, 0.26); decal(s * 1.055, 0.35, -0.3, 1.2, s < 0); }
    for (const s of [-1, 1]) for (const z of [ws.zf, ws.zr]) { const f = add(new THREE.TorusGeometry(archR + 0.03, 0.1, 6, 16, Math.PI), black, s * 1.05, ay, z); f.rotation.y = Math.PI / 2; }
    driverPos = V(-0.42, 0.72, -0.15);
  }
  // driver
  const suit = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 });
  const helmet = new THREE.MeshPhysicalMaterial({ color: opts.helmet || 0xf3efe6, roughness: 0.2, clearcoat: 1 });
  const torso = add(new THREE.CylinderGeometry(0.18, 0.2, 0.5, 10), suit, driverPos.x, driverPos.y + 0.2, driverPos.z + 0.05);
  const head = add(new THREE.SphereGeometry(0.15, 14, 10), helmet, driverPos.x, driverPos.y + 0.6, driverPos.z);
  const visor = add(new THREE.SphereGeometry(0.152, 14, 8, -0.9, 1.8, 1.1, 0.7), glass, driverPos.x, driverPos.y + 0.6, driverPos.z); visor.rotation.y = Math.PI;

  // wheels + visible suspension struts
  const style = { sedan: { knobby: 0, spokes: 5, rimScale: 0.62, ri: 0.66 }, van: { knobby: 0, spokes: 6, rimScale: 0.58, ri: 0.62 }, rally: { knobby: 0.015, spokes: 6, rimScale: 0.66 }, buggy: { knobby: 0.035, spokes: 5, rimScale: 0.55 }, truck: { knobby: 0.05, spokes: 6, rimScale: 0.52 }, kaze: { knobby: 0, spokes: 5, rimScale: 0.74, ri: 0.72 }, ironside: { knobby: 0, spokes: 10, rimScale: 0.7, ri: 0.7 }, super: { knobby: 0, spokes: 10, rimScale: 0.76, ri: 0.74 } }[spec.id];
  const wheels = [];
  const strutMat = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.4, metalness: 0.6 });
  for (const w of [[1, 1], [1, 0], [0, 1], [0, 0]]) {
    const { steer, spin } = spec.boat ? { steer: new THREE.Group(), spin: new THREE.Group() } : buildWheel(spec, mats, style);
    const left = w[1];
    if (left) spin.rotation.y = 0; // spin group handles rotation, mirror the face below
    if (left) spin.scale.x = -1;
    root.add(steer);
    let strut = null;
    if (spec.id === 'buggy' || spec.id === 'truck') { strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), strutMat); strut.castShadow = true; strut.userData.dynamic = true; root.add(strut); }
    wheels.push({ steer, spin, strut });
  }
  mergeChildren(root);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { root, wheels, mats, dirt, groundY, brakeMat: lightR };
}

/* Visual car instance bound to a physics Car */
class CarView {
  constructor(car, gfx, opts) {
    this.car = car; this.gfx = gfx;
    const m = buildCar(car.spec, opts, gfx);
    this.root = m.root; this.wheels = m.wheels; this.dirt = m.dirt; this.brakeMat = m.brakeMat;
    gfx.scene.add(this.root);
    this._v = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.emitAcc = 0;
  }
  dispose() { this.gfx.scene.remove(this.root); this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  update(dt, alpha) {
    const c = this.car, sp = c.spec, ws = sp.wheels;
    this.root.position.copy(c.pos); this.root.quaternion.copy(c.q);
    this.root.visible = !(c.invuln > 0 && c.invuln < 2.9 && Math.floor(c.invuln * 9) % 2 === 1);
    for (let i = 0; i < 4; i++) {
      const w = c.wheels[i], v = this.wheels[i];
      const ext = w.contact ? Math.max(0.0, w.t - ws.r) : sp.susp.rest;
      v.steer.position.set(w.lx * (sp.id === 'truck' ? 1.0 : 1.0), w.ly - ext, w.lz);
      v.steer.rotation.y = -w.steer;
      v.spin.rotation.x = w.spin * (w.left ? 1 : 1);
      if (v.strut) {
        const a = this._a.set(w.lx * 0.45, w.ly + 0.25, w.lz * 0.95), b = this._b.copy(v.steer.position); b.x *= 0.85;
        const d = this._v.subVectors(b, a); const L = d.length();
        v.strut.position.copy(a).addScaledVector(d, 0.5); v.strut.scale.set(1, L, 1);
        v.strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      }
    }
    this.burn = c.wrecked ? Math.min(1, (this.burn || 0) + dt * 3) : Math.max(0, (this.burn || 0) - dt * 0.6);
    if (c.wrecked) this.dirt.amount.value = Math.max(this.dirt.amount.value, 0.9);
    this.brakeMat.emissive.setRGB(c.input.brake > 0.1 && !c.reverse ? 3.6 : 1.1, 0.04, 0.02);
    this.dirt.sun.value = (0.25 + 0.75 * this.gfx.sunVisAt(c.pos.x, c.pos.z)) * (1 - this.burn * 0.65);
    if (c.surfaceMud > 0.3) this.dirt.amount.value = Math.min(1, this.dirt.amount.value + dt * 0.25 * c.surfaceMud);
    else if (c.onGround && c.speedKmh > 20) this.dirt.amount.value = Math.min(0.75, this.dirt.amount.value + dt * 0.006);
    if (c.inWater > 0.1) this.dirt.amount.value = Math.max(0.1, this.dirt.amount.value - dt * 0.3);
  }
  effects(dt, fx, marks, near) {
    const c = this.car, speed = c.vel.length();
    for (let i = 0; i < 4; i++) {
      const w = c.wheels[i];
      if (!w.contact || !w.surf) { marks.add(c.id * 4 + i, 0, 0, 0, 0, 0, 0, 0); continue; }
      const slip = Math.min(2, Math.abs(w.slipLat) * 4 + Math.abs(w.slip) * 1.5);
      const kind = w.surf.water ? 4 : w.surf.kind;
      const rate = (kind === 5 ? slip * 9 : (speed * 0.07 + slip * 4)) * (kind === 1 ? 0.55 : kind === 3 ? 0.2 : kind === 2 ? 0.8 : kind === 6 ? 0.6 : 1) * (near ? 1 : 0.35);
      if ((speed > 2 || slip > 0.3) && (kind !== 5 || slip > 0.5)) {
        let n = rate * dt; while (n > 0) { if (Math.random() < n) fx.dust(w.cp.x, w.cp.y, w.cp.z, c.vel.x, c.vel.z, Math.min(1.5, 0.4 + slip), kind); n -= 1; }
      }
      // tyre marks: rolling ruts on loose ground, darker when sliding
      const a = kind === 3 ? 0 : kind === 5 ? (slip > 0.5 ? Math.min(0.6, (slip - 0.5) * 0.7) : 0) : Math.min(0.55, (kind === 2 ? 0.45 : kind === 1 ? 0.08 : kind === 6 ? 0.12 : 0.18) + slip * 0.25);
      const f = c._t.fwd; const nx = -f.z, nz = f.x; const ln = Math.hypot(nx, nz) || 1;
      marks.add(c.id * 4 + i, w.cp.x, w.cp.y, w.cp.z, nx / ln, nz / ln, c.spec.wheels.w * 0.9, near ? a : 0);
    }
    if (c.spec.boat && c.inWater && speed > 1.5) { // wake off the transom, spray off the bow when planing
      let n = Math.min(40, speed * 1.1) * dt * (near ? 1 : 0.3);
      while (n > 0) {
        if (Math.random() < n) {
          const sd = Math.random() < 0.5 ? -1 : 1, p = this._a.set(sd * 0.9, 0, c.spec.hull.hz + 0.2).applyQuaternion(c.q).add(c.pos);
          fx.dust(p.x, WATER_Y, p.z, c.vel.x * 0.15, c.vel.z * 0.15, 0.6, 4);
          if (speed > 9 && Math.random() < 0.5) { const b = this._b.set(sd * 0.8, 0, -c.spec.hull.hz * 0.45).applyQuaternion(c.q).add(c.pos), side = this._v.set(sd * 4, 0, 0).applyQuaternion(c.q); fx.dust(b.x, WATER_Y, b.z, c.vel.x * 0.5 + side.x, c.vel.z * 0.5 + side.z, 0.8, 4); }
        }
        n -= 1;
      }
    }
    if (c.boosting) {
      const back = this._v.set(0, 0, 1).applyQuaternion(c.q);
      const hz = c.spec.hull.hz;
      for (const s of [-0.3, 0.3]) {
        const p = this._a.set(s, c.spec.hull.y - 0.1, hz + 0.1).applyQuaternion(c.q).add(c.pos);
        fx.boost(p.x, p.y, p.z, back.x * 12 + c.vel.x, back.y * 12 + c.vel.y, back.z * 12 + c.vel.z);
      }
    }
    if (c.heat > 0.8 && Math.random() < dt * 20) { const p = this._a.set(0, c.spec.hull.y + 0.4, -c.spec.hull.hz * 0.5).applyQuaternion(c.q).add(c.pos); fx.smoke.emit(p.x, p.y, p.z, c.vel.x * 0.5, 1.5, c.vel.z * 0.5, 0.6, 2.4, 1.2, 0.12, 0.11, 0.1, 0.5 * (c.heat - 0.7) * 3, -0.5, 1.2); }
    if (c.wrecked && Math.random() < dt * 25) { fx.smoke.emit(c.pos.x, c.pos.y + 0.8, c.pos.z, 0, 2.5, 0, 1.2, 3, 2.5, 0.06, 0.055, 0.05, 0.7, -0.6, 0.4); if (Math.random() < 0.5) fx.fire.emit(c.pos.x, c.pos.y + 0.6, c.pos.z, (Math.random() - 0.5), 2, (Math.random() - 0.5), 1, -0.5, 0.5, 1.3, 0.5, 0.15, 0.8, -1, 1); }
  }
}

'use strict';
