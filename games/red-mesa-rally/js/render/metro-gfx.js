'use strict';
/* Red Mesa Rally · Calder Metro: tube, ramps, stations, portals and the trains */

Object.assign(Gfx.prototype, {
  /* ---------- Calder Metro: tube, ramps, stations, portals and the train ---------- */
  metroMaterial(map, emis, opts = {}) {
    // the sun never reaches the metro: no direct light, a little sky, and the lamps baked in as emission
    const m = new THREE.MeshStandardMaterial({ map, color: opts.color || 0xffffff, roughness: opts.rough ?? 0.8, metalness: opts.metal || 0, emissive: new THREE.Color(emis), emissiveMap: map || null, side: opts.side || THREE.FrontSide });
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.directDiffuse *= 0.0; reflectedLight.directSpecular *= 0.0; reflectedLight.indirectDiffuse *= 0.45; reflectedLight.indirectSpecular *= 0.6;`); };
    m.customProgramCacheKey = () => 'metro';
    return m;
  },
  buildMetro() {
    const T = this.world.terrain, M = T.metro; if (!M) return;
    const R = M.R, Y = METRO.y, CE = METRO.ceil, grp = this.metroGroup = new THREE.Group(); this.scene.add(grp);
    const B = new Map(), bucket = (k) => { let b = B.get(k); if (!b) B.set(k, b = { pos: [], nor: [], uv: [], idx: [] }); return b; };
    // a quad a-b (bottom edge) c-d (top edge), facing n; winding fixed up to face n
    const quad = (k, a, b, c, d, n, uv) => {
      const q = bucket(k), v = q.pos.length / 3; q.pos.push(...a, ...b, ...c, ...d); for (let i = 0; i < 4; i++) q.nor.push(...n); q.uv.push(...uv);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) q.idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); else q.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    };
    const P = (s, l, y) => { const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); return [p.x - dz * l, y, p.z + dx * l]; };
    const latN = (s, sg) => { const [dx, dz] = R.dirAt(s); return [-dz * sg, 0, dx * sg]; };
    // walk [s0, s1] in ~2 m steps
    const strip = (s0, s1, fn) => { const n = Math.max(1, Math.ceil((s1 - s0) / 2)); for (let k = 0; k < n; k++) fn(s0 + (s1 - s0) * k / n, s0 + (s1 - s0) * (k + 1) / n); };
    const stations = METRO.stations.map((st) => ({ ...st, s: R.project(st.at[0], st.at[1], 0, -1).s }));
    const half = METRO.stationLen / 2;
    // station runs and plain runs along the loop
    const cuts = []; for (const st of stations) cuts.push([st.s - half, st.s + half, st]);
    cuts.sort((a, b) => a[0] - b[0]);
    const runs = []; let s = cuts[cuts.length - 1][1] - R.length;
    for (const [a, b, st] of cuts) { runs.push([s, a, null]); runs.push([a, b, st]); s = b; }
    const gapsOn = (side) => M.spurs.filter((sp) => sp.side === side).map((sp) => sp.gap);
    const L0 = METRO.wallL, WR = METRO.wallR, PL = METRO.plat, TRS = METRO.tracks;
    const gapIn = (gaps) => (a, b) => gaps.some(([g0, g1]) => [-R.length, 0, R.length].some((k) => b + k > g0 && a + k < g1));
    const inGap = gapIn(gapsOn(-1)), inGapR = gapIn(gapsOn(1)); // the ramps come in through the outer wall, or past a platform's end through the inner one
    // the floor across the tube: a sleeper bed under each track, plain ballast either side
    const floor = []; let l0 = L0;
    for (const t of TRS) { if (t - 2.2 > l0) floor.push([l0, t - 2.2, 'ballast']); floor.push([t - 2.2, t + 2.2, 'bed']); l0 = t + 2.2; }
    if (WR > l0) floor.push([l0, WR, 'ballast']);
    for (const [r0, r1, st] of runs) strip(r0, r1, (a, b) => {
      const nUp = [0, 1, 0], nDn = [0, -1, 0];
      for (const [la, lb, k] of floor) quad(k, P(a, la, Y), P(b, la, Y), P(a, lb, Y), P(b, lb, Y), nUp, k === 'bed' ? [0, a / 2.4, 0, b / 2.4, 1, a / 2.4, 1, b / 2.4] : [0, a / 4, 0, b / 4, (lb - la) / 4, a / 4, (lb - la) / 4, b / 4]);
      const far = st ? PL : WR;
      quad('ceil', P(a, L0, CE), P(b, L0, CE), P(a, far, CE), P(b, far, CE), nDn, [0, a / 6, 0, b / 6, 1, a / 6, 1, b / 6]);
      if (!inGap(a, b)) quad('wall', P(a, L0, Y), P(b, L0, Y), P(a, L0, CE), P(b, L0, CE), latN(a, 1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
      if (st) {
        quad('plat', P(a, WR, Y + 1), P(b, WR, Y + 1), P(a, PL, Y + 1), P(b, PL, Y + 1), nUp, [0, a / 4, 0, b / 4, 1, a / 4, 1, b / 4]);
        quad('edge', P(a, WR, Y), P(b, WR, Y), P(a, WR, Y + 1), P(b, WR, Y + 1), latN(a, -1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
        quad('swall', P(a, PL, Y + 1), P(b, PL, Y + 1), P(a, PL, CE), P(b, PL, CE), latN(a, -1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
      } else if (!inGapR(a, b)) quad('wall', P(a, WR, Y), P(b, WR, Y), P(a, WR, CE), P(b, WR, CE), latN(a, -1), [a / 3, 0, b / 3, 0, a / 3, 1, b / 3, 1]);
      // the rails, two tracks of them
      for (const TR of TRS) for (const off of [-0.72, 0.72]) quad('rail', P(a, TR + off - 0.06, Y + 0.18), P(b, TR + off - 0.06, Y + 0.18), P(a, TR + off + 0.06, Y + 0.18), P(b, TR + off + 0.06, Y + 0.18), nUp, [0, 0, 0, 1, 1, 0, 1, 1]);
    });
    // station ends: walls across the platform
    for (const st of stations) for (const [sE, sg] of [[st.s - half, 1], [st.s + half, -1]]) {
      const [dx, dz] = R.dirAt(sE), n = [dx * sg, 0, dz * sg];
      quad('swall', P(sE, WR, Y), P(sE, PL, Y), P(sE, WR, CE), P(sE, PL, CE), n, [0, 0, 2, 0, 0, 1, 2, 1]);
    }
    // ceiling lamps over both tracks
    for (let s0 = 0; s0 < R.length; s0 += 9) for (const l of TRS) {
      const a = s0, b = s0 + 4, w = 0.35;
      quad('lamp', P(a, l - w, CE - 0.03), P(b, l - w, CE - 0.03), P(a, l + w, CE - 0.03), P(b, l + w, CE - 0.03), [0, -1, 0], [0, 0, 0, 1, 1, 0, 1, 1]);
    }
    // the portal ramps
    for (const sp of M.spurs) {
      const g = METRO.rampHw + 0.3, aEnd = metroSpurEnd(sp), rx = -sp.dz, rz = sp.dx, eL = metroSpurEnd(sp, -1), eR = metroSpurEnd(sp, 1);
      const Q = (a, l, y) => [sp.x + sp.dx * a + rx * l, y, sp.z + sp.dz * a + rz * l];
      for (let a = 0; a < aEnd; a += 2) {
        const b = Math.min(aEnd, a + 2), ya = metroSpurY(a), yb = metroSpurY(b), ca = metroSpurCeil(a), cb = metroSpurCeil(b);
        const nUp = [0, 1, 0], [aL, bL, aR, bR] = [Math.min(a, eL), Math.min(b, eL), Math.min(a, eR), Math.min(b, eR)]; // each edge stops at the loop's wall, the floor tapers in between
        quad('road', Q(aL, -g, metroSpurY(aL)), Q(bL, -g, metroSpurY(bL)), Q(aR, g, metroSpurY(aR)), Q(bR, g, metroSpurY(bR)), nUp, [0, aL / 10, 0, bL / 10, 1, aR / 10, 1, bR / 10]);
        const open = a < sp.cover, ta = open ? CITY.y - 0.4 : ca, tb = open ? ta : cb; // the cut is open to the sky; up in the hall its walls stop under the hall's own walls
        if (!open) quad('ceil', Q(aL, -g, metroSpurCeil(aL)), Q(bL, -g, metroSpurCeil(bL)), Q(aR, g, metroSpurCeil(aR)), Q(bR, g, metroSpurCeil(bR)), [0, -1, 0], [0, aL / 6, 0, bL / 6, 1, aR / 6, 1, bR / 6]);
        for (const sd of [-1, 1]) {
          const e = sd < 0 ? eL : eR; if (a >= e) continue;
          const bb = Math.min(b, e), ybb = metroSpurY(bb), tbb = open ? ta : metroSpurCeil(bb), l = sd * (g - (open ? 0.03 : 0));
          if (open && ta <= Math.max(ya, ybb) + 0.05) continue;
          quad(open ? 'rwall' : 'wall', Q(a, l, ya), Q(bb, l, ybb), Q(a, l, Math.max(ta, ya)), Q(bb, l, Math.max(tbb, ybb)), [-rx * sd, 0, -rz * sd], [a / 3, 0, bb / 3, 0, a / 3, 1, bb / 3, 1]);
        }
        if (!open && (Math.floor(a / 9) !== Math.floor(b / 9))) quad('lamp', Q(a, -0.35, Math.min(ca, cb) - 0.03), Q(a + 3, -0.35, Math.min(ca, cb) - 0.03), Q(a, 0.35, Math.min(ca, cb) - 0.03), Q(a + 3, 0.35, Math.min(ca, cb) - 0.03), [0, -1, 0], [0, 0, 0, 1, 1, 0, 1, 1]);
      }
    }
    // textures
    const noise = (x, w, h, base, amt, n) => { const r = mulberry32(n); x.fillStyle = base; x.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { const v = r(); x.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${amt * r()})`; x.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); } };
    const roadTex = makeCanvasTex(256, 256, (x, w, h) => {
      noise(x, w, h, '#26272a', 0.08, 3);
      x.fillStyle = '#d8d4c8'; x.fillRect(w * 0.035, 0, 5, h); x.fillRect(w * 0.965 - 5, 0, 5, h);
      x.fillStyle = '#d9a52b'; x.fillRect(w * 0.49, 0, 6, h * 0.55);
    }, { repeat: true });
    const bedTex = makeCanvasTex(256, 128, (x, w, h) => {
      noise(x, w, h, '#3b3833', 0.25, 5);
      x.fillStyle = '#5a5249'; x.fillRect(w * 0.18, h * 0.3, w * 0.64, h * 0.4);
      x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(w * 0.18, h * 0.66, w * 0.64, h * 0.06);
    }, { repeat: true });
    const ballastTex = makeCanvasTex(128, 128, (x, w, h) => noise(x, w, h, '#3b3833', 0.25, 7), { repeat: true });
    const wallTex = makeCanvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#d9d2c2'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(80,70,60,.35)'; x.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(0, i * h / 8); x.lineTo(w, i * h / 8); x.stroke(); x.beginPath(); x.moveTo(i * w / 8, 0); x.lineTo(i * w / 8, h); x.stroke(); }
      x.fillStyle = '#1f7a8c'; x.fillRect(0, h * 0.62, w, h * 0.08); x.fillStyle = '#f2c230'; x.fillRect(0, h * 0.71, w, h * 0.02);
      const g = x.createLinearGradient(0, h, 0, h * 0.75); g.addColorStop(0, 'rgba(40,30,20,.55)'); g.addColorStop(1, 'rgba(40,30,20,0)'); x.fillStyle = g; x.fillRect(0, h * 0.75, w, h * 0.25);
    }, { repeat: true });
    const rampTex = makeCanvasTex(256, 256, (x, w, h) => {
      noise(x, w, h, '#8f8a82', 0.12, 9);
      x.fillStyle = 'rgba(40,36,30,.5)'; x.fillRect(0, h * 0.88, w, h * 0.12);
      x.fillStyle = '#1f7a8c'; x.fillRect(0, h * 0.62, w, h * 0.06);
    }, { repeat: true });
    const ceilTex = makeCanvasTex(128, 128, (x, w, h) => { noise(x, w, h, '#4b4945', 0.15, 11); x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(0, 0, w, 3); }, { repeat: true });
    const platTex = makeCanvasTex(256, 256, (x, w, h) => {
      noise(x, w, h, '#a49d92', 0.12, 13);
      x.fillStyle = '#f2c230'; x.fillRect(0, 0, w * 0.06, h);
      x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 8; i++) x.fillRect(w * 0.1, i * h / 8, w * 0.9, 1);
    }, { repeat: true });
    const mats = {
      road: this.metroMaterial(roadTex, 0x2a2622, { rough: 0.7 }),
      bed: this.metroMaterial(bedTex, 0x1c1915),
      ballast: this.metroMaterial(ballastTex, 0x1c1915),
      ceil: this.metroMaterial(ceilTex, 0x262320),
      wall: this.metroMaterial(wallTex, 0x6a6052),
      rwall: this.metroMaterial(rampTex, 0x4a463f),
      swall: this.metroMaterial(wallTex, 0x7a705f, { color: 0xf4efe2 }),
      plat: this.metroMaterial(platTex, 0x5a554c),
      edge: this.metroMaterial(null, 0x000000, { color: 0x6b6760 }),
      rail: this.metroMaterial(null, 0x302c28, { color: 0x9da3a8, metal: 0.8, rough: 0.35 }),
      lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.9, 2.4) }),
    };
    for (const [k, q] of B) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(q.nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(q.uv, 2));
      geo.setIndex(q.idx); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mats[k]); m.name = 'metro-' + k; m.castShadow = k !== 'lamp' && k !== 'rail'; m.receiveShadow = k !== 'lamp'; grp.add(m);
    }
    // station names on the platform wall and across the tracks on the outer wall
    const signTex = (name) => textTex(1024, 192, (x, w, h) => {
      x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, w, h); x.fillStyle = '#1f7a8c'; x.fillRect(0, 0, w, 26); x.fillRect(0, h - 26, w, 26);
      x.fillStyle = '#c4161c'; x.beginPath(); x.arc(104, h / 2, 62, 0, TAU); x.fill(); x.fillStyle = '#f4f1e8'; x.font = '400 86px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('M', 104, h / 2 + 4);
      x.fillStyle = '#16100c'; x.font = '700 104px "Saira Condensed", sans-serif'; x.textAlign = 'left'; x.fillText(name, 196, h / 2 + 6);
    });
    for (const st of stations) {
      const tex = signTex(st.name), lit = this.metroMaterial(tex, 0xb0aa9a);
      for (const off of [-24, 0, 24]) {
        const ss = st.s + off, p = P(ss, PL - 0.05, Y + 2.6), [dx, dz] = R.dirAt(ss);
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), lit); sg.position.set(p[0], p[1], p[2]);
        sg.rotation.y = Math.atan2(dz, -dx); grp.add(sg); // faces back across the track
      }
      for (const off of [-24, 0, 24]) {
        const ss = st.s + off; if (inGap(ss - 3.5, ss + 3.5)) continue;
        const p = P(ss, L0 + 0.05, Y + 2.6), [dx, dz] = R.dirAt(ss);
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), lit); sg.position.set(p[0], p[1], p[2]);
        sg.rotation.y = Math.atan2(-dz, dx); grp.add(sg);
      }
    }
    // the station halls: a long low hall over each ramp's open stretch, the street front under a canopy with the METRO sign over it
    const conc = new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.85 }), frame = new THREE.MeshStandardMaterial({ color: 0x5f5a54, roughness: 0.85 });
    const teal = new THREE.MeshStandardMaterial({ color: 0x1f7a8c, roughness: 0.5 }), glass = new THREE.MeshStandardMaterial({ color: 0x9fd6e0, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.45 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.4, 2.0) });
    const logoTex = textTex(256, 256, (x, w, h) => { x.fillStyle = '#c4161c'; x.beginPath(); x.arc(w / 2, h / 2, w * 0.46, 0, TAU); x.fill(); x.fillStyle = '#f4f1e8'; x.font = '400 170px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('M', w / 2, h / 2 + 10); });
    const logo = new THREE.MeshStandardMaterial({ map: logoTex, emissive: 0xffffff, emissiveMap: logoTex, emissiveIntensity: 0.7, transparent: true, alphaTest: 0.5 });
    const HY = CITY.y, HH = METRO.hallH;
    for (const sp of M.spurs) {
      const g = METRO.rampHw + 0.3, Lh = sp.cover, wt = 0.9, yaw = Math.atan2(sp.dx, sp.dz), so = metroSpurCeil(Lh);
      const fg = new THREE.Group(); fg.position.set(sp.x, 0, sp.z); fg.rotation.y = yaw; // local +z runs down the ramp
      const box = (w, h, d, x, y, z, m, shadow = true) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = shadow; b.receiveShadow = true; fg.add(b); return b; };
      // side walls from the street to the roof, the back wall from the ramp's tunnel roof up, the roof with a glazed strip down the middle
      for (const sd of [-1, 1]) box(wt, HH + 0.5, Lh + 0.9, sd * (g + wt / 2), HY - 0.5 + (HH + 0.5) / 2, Lh / 2 + 0.45, conc);
      box(2 * g + 2 * wt, HY + HH - so, wt, 0, (so + HY + HH) / 2, Lh + 0.45, conc);
      for (const sd of [-1, 1]) box(g + wt - 1.6, 0.5, Lh + 0.9, sd * (1.6 + (g + wt - 1.6) / 2), HY + HH + 0.25, Lh / 2 + 0.45, frame);
      box(3.2, 0.12, Lh + 0.9, 0, HY + HH + 0.3, Lh / 2 + 0.45, glass, false);
      for (let a = 4; a < Lh; a += 7) box(2 * g, 0.3, 0.3, 0, HY + HH - 0.15, a, frame);
      for (let a = 3; a < Lh - 2; a += 7) box(0.6, 0.08, 3, 0, HY + HH - 0.36, a + 2, glow, false); // lamps under the roof
      // the street front: a lintel over the way in, the facade above it, the canopy out over the pavement on two posts
      const lin = HY + 4.6;
      box(2 * g + 2 * wt, HY + HH + 0.5 - lin, wt, 0, (lin + HY + HH + 0.5) / 2, 0.45, conc);
      box(2 * g + 2 * wt + 0.4, 0.4, 0.3, 0, HY + HH + 0.5, 0.05, teal);
      box(2 * g + 2 * wt + 3, 0.35, 6.5, 0, lin - 0.2, -3.0, frame);
      box(2 * g + 2 * wt + 3.2, 0.12, 6.7, 0, lin - 0.4, -3.0, teal, false);
      for (const sd of [-1, 1]) box(0.35, lin - HY, 0.35, sd * (g + wt + 1.0), HY + (lin - HY) / 2, -5.9, frame);
      const tex = textTex(1024, 192, (x, w, h) => {
        x.fillStyle = '#16100c'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#c4161c'; x.beginPath(); x.arc(100, h / 2, 64, 0, TAU); x.fill(); x.fillStyle = '#f4f1e8'; x.font = '400 90px "Saira Stencil One", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('M', 100, h / 2 + 4);
        x.textAlign = 'left'; x.font = '700 78px "Saira Condensed", sans-serif'; x.fillText(sp.name.toUpperCase(), 190, h * 0.36); x.fillStyle = '#7fd0de'; x.font = '700 56px "Saira Condensed", sans-serif'; x.fillText('CALDER METRO  ·  DRIVE IN', 190, h * 0.74);
      });
      const sw = 2 * g + 1, sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.1875), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.5 }));
      sign.position.set(0, (lin + HY + HH) / 2 + 0.1, -0.02); sign.rotation.y = Math.PI; fg.add(sign);
      // a totem with the M on it at the front corner, seen down the street
      box(1.1, HH + 3.5, 1.1, g + wt + 0.55, HY + (HH + 3.5) / 2, 0.55, teal);
      for (const [ox, oz, ry] of [[0, -0.01, Math.PI], [0.56, 0.55, Math.PI / 2], [-0.56, 0.55, -Math.PI / 2]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), logo); m.position.set(g + wt + 0.55 + ox, HY + HH + 2.4, oz); m.rotation.y = ry; fg.add(m);
      }
      this.scene.add(fg);
    }
    // the trains: the stopper in teal, the express in red, both lit up front so you can see them coming down the tube
    const winTex = textTex(512, 128, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff1cc'; for (let i = 0; i < 6; i++) x.fillRect(18 + i * 82, h * 0.18, 62, h * 0.4); });
    const plain = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.45, metalness: 0.5 }), skirt = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7 });
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.2) }), tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.15, 0.1) });
    const lampGeo = new THREE.PlaneGeometry(0.5, 0.28);
    this.metroCars = this.world.metroTrains.map((mt) => {
      const stripe = mt.express ? '#c4161c' : '#1f7a8c';
      const bodyTex = textTex(512, 128, (x, w, h) => {
        x.fillStyle = '#c9ccd0'; x.fillRect(0, 0, w, h);
        x.fillStyle = stripe; x.fillRect(0, h * 0.72, w, h * 0.12);
        x.fillStyle = '#1a2026'; for (let i = 0; i < 6; i++) x.fillRect(18 + i * 82, h * 0.18, 62, h * 0.4);
        if (!mt.express) { x.fillStyle = '#2b3036'; x.fillRect(w * 0.47, h * 0.12, 26, h * 0.7); }
      });
      const side = new THREE.MeshStandardMaterial({ map: bodyTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.5 });
      const cab = new THREE.MeshStandardMaterial({ color: mt.express ? 0xc4161c : 0x1f7a8c, roughness: 0.5, emissive: mt.express ? 0x300806 : 0x0a2a30 });
      return mt.cars.map((c) => {
        const g = new THREE.Group(), last = c.k === mt.cars.length - 1;
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.0, c.len), [side, side, plain, plain, c.k === 0 ? cab : plain, last ? cab : plain]);
        body.position.y = 1.7; body.castShadow = true; g.add(body);
        const sk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, c.len - 2), skirt); sk.position.y = 0.25; g.add(sk);
        for (const sd of [-1, 1]) {
          if (c.k === 0) { const l = new THREE.Mesh(lampGeo, head); l.position.set(sd * 0.95, 0.75, c.len / 2 + 0.02); g.add(l); }
          if (last) { const l = new THREE.Mesh(lampGeo, tail); l.position.set(sd * 0.95, 0.75, -c.len / 2 - 0.02); l.rotation.y = Math.PI; g.add(l); }
        }
        grp.add(g); return g;
      });
    });
    this.updateMetroTrain();
  },
  updateMetroTrain() {
    if (!this.metroCars) return;
    this.world.metroTrains.forEach((mt, j) => mt.cars.forEach((c, i) => { const g = this.metroCars[j][i], P = c.pose; g.position.set(P.x, P.y, P.z); g.rotation.y = P.yaw; }));
  },
});
