'use strict';
/* Red Mesa Rally · Port Calder districts: arterials, a ring street round every district, the street grids inside them,
   the Heights lanes and the Marina fan. Every street is a Route (pushed into ROUTE_DEFS before the ramps, so the ramps
   can end on them); the buildings are placed along them later, once the terrain knows where the tarmac is. */

const DISTRICT = (() => {
  const rng = mulberry32(7);
  const curve = (pts, closed, sub = 8) => { // catmull-rom through the control points
    const n = pts.length, out = [], get = (i) => closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
    for (let i = 0; i < (closed ? n : n - 1); i++) for (let k = 0; k < sub; k++) out.push(catmull(get(i - 1), get(i), get(i + 1), get(i + 2), k / sub));
    out.push(closed ? out[0].slice() : pts[n - 1].slice()); return out;
  };
  const pip = (x, z, poly) => {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins; }
    return ins;
  };
  const plen = (pl) => { let L = 0; for (let i = 1; i < pl.length; i++) L += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]); return L; };
  // the proper crossing of segments ab and cd: [t along ab, u along cd]
  const cross = (a, b, c, d) => {
    const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return null;
    const qx = c[0] - a[0], qz = c[1] - a[1], t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
  };
  /* a spatial hash of polyline segments, for crossings and near misses */
  class Index {
    constructor() { this.m = new Map(); }
    add(pl, tag) {
      for (let i = 0; i < pl.length - 1; i++) {
        const a = pl[i], b = pl[i + 1], sg = { a, b, tag };
        for (let cx = Math.floor(Math.min(a[0], b[0]) / 40); cx <= Math.floor(Math.max(a[0], b[0]) / 40); cx++)
          for (let cz = Math.floor(Math.min(a[1], b[1]) / 40); cz <= Math.floor(Math.max(a[1], b[1]) / 40); cz++) {
            const k = cx * 10000 + cz; let l = this.m.get(k); if (!l) this.m.set(k, l = []); l.push(sg);
          }
      }
    }
    near(x0, z0, x1, z1, r = 0) {
      const out = new Set();
      for (let cx = Math.floor((Math.min(x0, x1) - r) / 40); cx <= Math.floor((Math.max(x0, x1) + r) / 40); cx++)
        for (let cz = Math.floor((Math.min(z0, z1) - r) / 40); cz <= Math.floor((Math.max(z0, z1) + r) / 40); cz++) for (const sg of this.m.get(cx * 10000 + cz) || []) out.add(sg);
      return out;
    }
    /* where polyline pl crosses anything indexed (that passes the filter): distances along pl */
    hits(pl, ok) {
      const out = []; let s = 0;
      for (let i = 0; i < pl.length - 1; i++) {
        const a = pl[i], b = pl[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (const sg of this.near(a[0], a[1], b[0], b[1])) if (!ok || ok(sg.tag)) { const c = cross(a, b, sg.a, sg.b); if (c) out.push({ s: s + c[0] * L, tag: sg.tag, p: [a[0] + (b[0] - a[0]) * c[0], a[1] + (b[1] - a[1]) * c[0]] }); }
        s += L;
      }
      return out.sort((p, q) => p.s - q.s);
    }
    /* the nearest indexed segment to (x, z) within r: { d, dir, tag } */
    nearest(x, z, r, ok) {
      let best = null;
      for (const sg of this.near(x, z, x, z, r)) {
        if (ok && !ok(sg.tag)) continue;
        const vx = sg.b[0] - sg.a[0], vz = sg.b[1] - sg.a[1], L2 = vx * vx + vz * vz || 1, t = clamp(((x - sg.a[0]) * vx + (z - sg.a[1]) * vz) / L2, 0, 1);
        const d = Math.hypot(x - sg.a[0] - vx * t, z - sg.a[1] - vz * t);
        if (d < r && (!best || d < best.d)) { const L = Math.sqrt(L2); best = { d, dir: [vx / L, vz / L], tag: sg.tag, p: [sg.a[0] + vx * t, sg.a[1] + vz * t] }; }
      }
      return best;
    }
  }
  /* the stretch of polyline pl between distances s0 and s1 */
  const slice = (pl, s0, s1) => {
    const out = []; let s = 0;
    const at = (i, t) => [pl[i][0] + (pl[i + 1][0] - pl[i][0]) * t, pl[i][1] + (pl[i + 1][1] - pl[i][1]) * t];
    for (let i = 0; i < pl.length - 1; i++) {
      const L = Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]);
      if (s + L >= s0 && s <= s1) {
        if (!out.length) out.push(at(i, clamp((s0 - s) / L, 0, 1)));
        if (s + L <= s1) out.push(pl[i + 1].slice()); else { out.push(at(i, clamp((s1 - s) / L, 0, 1))); break; }
      }
      s += L;
    }
    return out;
  };
  const thin = (pl, step) => { // drop points closer than step to the last kept one (ends kept exactly)
    const out = [pl[0]];
    for (let i = 1; i < pl.length - 1; i++) { const q = out[out.length - 1]; if (Math.hypot(pl[i][0] - q[0], pl[i][1] - q[1]) >= step) out.push(pl[i]); }
    const e = pl[pl.length - 1], q = out[out.length - 1]; if (out.length > 1 && Math.hypot(e[0] - q[0], e[1] - q[1]) < step * 0.4) out.pop(); out.push(e);
    return out;
  };
  const def = (id) => ROUTE_DEFS.find((d) => d.id === id);

  /* ---------- what the streets must keep clear of ---------- */
  const obs = new Index();
  const rail = curve(def('rail').pts, true, 2), hwy = curve(def('hwy').pts, true);
  { // the railway is no obstacle where it runs in a bore
    const at = (p) => { let b = 0, bd = 1e18; rail.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; b = i; } }); return b; };
    let open = rail.map(() => true);
    for (const [a, b] of def('rail').bores) { const i = at(a), j = at(b); for (let k = Math.min(i, j); k <= Math.max(i, j); k++) open[k] = false; }
    let run = []; rail.forEach((q, i) => { if (open[i]) run.push(q); else { if (run.length > 1) obs.add(run, 'rail'); run = []; } }); if (run.length > 1) obs.add(run, 'rail');
  }
  obs.add(hwy, 'hwy');
  for (const d of ROUTE_DEFS) if (d.ramp) obs.add(curve(d.pts, false), 'ramp');
  const lower = RIVER.reaches.find((r) => r.id === 'lower').pts.map((q) => [q.x, q.z]);
  obs.add(lower, 'river');
  const wet = (x, z) => naturalHeight(x, z) < 1.2;

  /* ---------- arterials ---------- */
  const ART = [
    { id: 'kingsway', w: 14, pts: [[4392, -1150], [4352, -1050], [4316, -950], [4300, -860], [4300, -760], [4296, -350], [4300, 30], [4300, 200], [4296, 400], [4290, 540], [4282, 680], [4276, 773]] },
    { id: 'harbour-dr', w: 14, pts: [[4880, 768], [4930, 700], [4950, 560], [5030, 420], [5086, 250], [5106, 100], [5116, -200], [5116, -346], [5116, -700], [5112, -900], [5100, -1060], [5075, -1190], [5052, -1262]] },
    { id: 'hill-rd', w: 12, pts: [[4690, -326], [4690, -600], [4690, -880], [4715, -1000], [4700, -1180], [4738, -1282]] },
    { id: 'ridge-dr', w: 10, pts: [[4738, -1282], [4800, -1350], [4880, -1372], [4960, -1342], [5020, -1300], [5052, -1262]] },
    { id: 'lighthouse-ln', w: 8, pts: [[5052, -1262], [5095, -1242], [5130, -1222], [5160, -1205]] }, // down off the crest to the point
    { id: 'gate-rd', w: 12, pts: [[4290, 540], [4450, 540], [4600, 540], [4800, 540], [4950, 560]] },
    { id: 'stadium-dr', w: 12, pts: [[4300, 200], [4385, 200]] },
  ];
  const frame = new Index(), streets = [];
  for (const id of ['north-rd', 'mesa-blvd', 'valley-rd', 'coast']) frame.add(curve(def(id).pts, false), 'art:' + id);
  for (const a of ART) { const pl = curve(a.pts, false); frame.add(pl, 'art:' + a.id); streets.push({ id: a.id, kind: 'art', w: a.w, pts: a.pts, sub: 40 }); }

  /* ---------- districts ---------- */
  const D = [
    { id: 'dt', name: 'DOWNTOWN', paved: 1, w: 12, ang: 0, pitch: 92, org: [4290, -350], drop: 0.1, label: [4290, -560, 0],
      poly: [[3975, -760], [4300, -800], [4600, -770], [4615, -330], [4600, 40], [4380, 90], [4180, 80], [4060, 20], [3995, -150], [3975, -380]] },
    { id: 'sw', name: 'SALTWORKS', paved: 1, w: 11, ang: -12, pitch: 105, org: [4880, -300], drop: 0.14, label: [4900, -560, -12],
      poly: [[4720, -880], [4900, -935], [5080, -905], [5088, -300], [5078, 220], [4950, 370], [4730, 330], [4705, -60], [4705, -400]] },
    { id: 'ws', name: 'MESA VIEW', paved: 0.6, w: 9, ang: 13, pitch: 112, org: [3700, -400], drop: 0.15, cul: true, label: [3640, -250, 13],
      poly: [[3480, -860], [3700, -890], [3830, -850], [3835, -400], [3830, 40], [3700, 100], [3480, 110], [3470, -400]] },
    { id: 'hl', name: 'KESTREL HEIGHTS', paved: 0.6, w: 8, lanes: true, label: [4680, -1030, -8],
      poly: [[4250, -1150], [4600, -1180], [4850, -1120], [5080, -1070], [5090, -935], [4900, -960], [4720, -920], [4500, -880], [4330, -895], [4250, -960]] },
    { id: 'ma', name: 'SUNSET MARINA', paved: 0.6, w: 10, fan: [3780, 1060], label: [3800, 330, 0],
      poly: [[3420, 150], [3740, 140], [3960, 70], [4180, 130], [4250, 330], [4240, 600], [4240, 780], [4000, 960], [3620, 1080], [3330, 1130], [3300, 600]] },
  ];
  const PARKS = [
    { poly: curve([[4100, -560], [4150, -612], [4225, -600], [4242, -540], [4190, -505], [4120, -515]], true, 6) },
    { poly: curve([[3560, -650], [3700, -700], [3800, -600], [3700, -520], [3580, -540]], true, 6) },
  ];
  const STADIUM = { x: 4490, z: 200, rx: 105, rz: 78, lot: [[4320, 100], [4620, 60], [4690, 330], [4320, 335]] };
  const DOCKS = { poly: [[4250, 336], [4720, 340], [4900, 420], [5000, 560], [4930, 740], [4880, 800], [4250, 800]] };
  const inPark = (x, z) => PARKS.some((p) => pip(x, z, p.poly)) || Math.hypot((x - STADIUM.x) / STADIUM.rx, (z - STADIUM.z) / STADIUM.rz) < 1.15;

  // a stretch of street is fine where it keeps off the railway and the ramps, does not run along the interstate or the
  // river, stays dry and out of the parks (crossing the interstate or the river is fine: they go over or under)
  const clear = (pl, w, mayCrossRail) => {
    for (const h of obs.hits(pl)) if (h.tag === 'ramp' || (h.tag === 'rail' && !mayCrossRail)) return false;
    for (let i = 0; i < pl.length; i += 2) {
      const [x, z] = pl[i], n = obs.nearest(x, z, w / 2 + 26);
      if (n) {
        const j = Math.min(pl.length - 1, i + 1), k = Math.max(0, j - 1), dx = pl[j][0] - pl[k][0], dz = pl[j][1] - pl[k][1], L = Math.hypot(dx, dz) || 1;
        const par = Math.abs((dx * n.dir[0] + dz * n.dir[1]) / L) > 0.8;
        if (n.tag === 'ramp' && n.d < w / 2 + 14) return false;
        if (n.tag === 'rail' && n.d < w / 2 + 12 && (par || !mayCrossRail)) return false;
        if ((n.tag === 'hwy' || n.tag === 'river') && par && n.d < w / 2 + 24) return false;
      }
      if (wet(x, z) || inPark(x, z)) return false;
    }
    // and it never ends underneath the interstate, where its last metres would have to climb onto the viaduct
    for (const [x, z] of [pl[0], pl[pl.length - 1]]) { const n = obs.nearest(x, z, w / 2 + 20); if (n && n.tag === 'hwy') return false; }
    return true;
  };

  const culs = [];
  for (const d of D) {
    const poly = curve(d.poly, true, 6), dense = resamplePts(poly, 6);
    d.outline = poly;
    // the ring: every district has one, except where an arterial already runs along its edge
    const keep = dense.map(([x, z], i) => {
      const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n = frame.nearest(x, z, 30);
      return !(n && Math.abs(((b[0] - a[0]) * n.dir[0] + (b[1] - a[1]) * n.dir[1]) / L) > 0.6);
    });
    let runs = [], cur = [];
    const n0 = keep.indexOf(false), start = n0 < 0 ? 0 : n0;
    for (let k = 0; k <= dense.length; k++) {
      const i = (start + k) % dense.length;
      if (keep[i] && k < dense.length) cur.push(dense[i]); else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (n0 < 0) runs = [dense.concat([dense[0]])];
    // ends of a trimmed ring bend in to meet the arterial that took over
    for (const r of runs) {
      if (n0 < 0) break;
      for (const end of [0, 1]) {
        const p = end ? r[r.length - 1] : r[0], n = frame.nearest(p[0], p[1], 36);
        if (n) { if (end) r.push(n.p); else r.unshift(n.p); }
      }
    }
    for (const r of runs) {
      // and stop short of anything it may not touch: split round the bad stretches
      const pieces = []; let piece = [r[0]];
      for (let i = 1; i < r.length; i++) {
        if (clear([r[i - 1], r[i]], d.w + 1, false)) piece.push(r[i]); else { if (piece.length > 1) pieces.push(piece); piece = [r[i]]; }
      }
      if (piece.length > 1) pieces.push(piece);
      for (const pc of pieces) if (plen(pc) > 50) {
        const closed = n0 < 0 && pieces.length === 1;
        frame.add(pc, 'ring:' + d.id);
        streets.push({ id: `ring-${d.id}-${streets.length}`, kind: 'ring', w: d.w + 1, pts: thin(closed ? pc.slice(0, -1) : pc, 10), closed, sub: 4, dist: d.id });
      }
    }
    // the inside: two families of lines that cross each other
    const fam = [[], []];
    if (d.ang !== undefined) {
      const ca = Math.cos(d.ang * Math.PI / 180), sa = Math.sin(d.ang * Math.PI / 180), W = (u, v) => [d.org[0] + u * ca - v * sa, d.org[1] + u * sa + v * ca];
      for (let i = -14; i <= 14; i++) { fam[0].push(resamplePts([W(i * d.pitch, -1600), W(i * d.pitch, 1600)], 8)); fam[1].push(resamplePts([W(-1600, i * d.pitch), W(1600, i * d.pitch)], 8)); }
    } else if (d.lanes) { // contour lanes across the slope, short cul-de-sacs off them
      for (const [z0, ph] of [[-1112, 0], [-1052, 1.3], [-992, 2.6]]) {
        const f = (x) => z0 + 22 * Math.sin(x / 95 + ph) + (x - 4600) * 0.05;
        const pl = []; for (let x = 4200; x <= 5160; x += 8) pl.push([x, f(x)]);
        fam[0].push(pl);
      }
    } else if (d.fan) { // arcs round the bay and avenues fanning out from it
      const [cx, cz] = d.fan;
      for (let r = 330; r < 1250; r += 105) { const pl = []; for (let a = 180; a <= 360; a += 2) pl.push([cx + r * Math.cos(a * Math.PI / 180), cz + r * Math.sin(a * Math.PI / 180)]); fam[0].push(pl); }
      for (let a = 195; a < 350; a += 13) fam[1].push(resamplePts([[cx + 150 * Math.cos(a * Math.PI / 180), cz + 150 * Math.sin(a * Math.PI / 180)], [cx + 1250 * Math.cos(a * Math.PI / 180), cz + 1250 * Math.sin(a * Math.PI / 180)]], 8));
    }
    const famIdx = [new Index(), new Index()];
    fam.forEach((F, f) => F.forEach((pl, k) => famIdx[f].add(pl, k)));
    // cut every line at the frame; the stretches inside the district are candidates, cut again where the other family crosses
    const segs = [];
    const key = (p) => Math.round(p[0] / 3) + ':' + Math.round(p[1] / 3);
    fam.forEach((F, f) => F.forEach((pl, li) => {
      const fh = frame.hits(pl), oh = famIdx[1 - f].hits(pl);
      for (let k = 0; k < fh.length - 1; k++) {
        const s0 = fh[k].s, s1 = fh[k + 1].s; if (s1 - s0 < 24) continue;
        const mid = slice(pl, (s0 + s1) / 2, (s0 + s1) / 2 + 1)[0]; if (!mid || !pip(mid[0], mid[1], poly)) continue;
        const cuts = [{ s: s0, p: fh[k].p, anchor: true }, ...oh.filter((h) => h.s > s0 + 12 && h.s < s1 - 12), { s: s1, p: fh[k + 1].p, anchor: true }];
        for (let c = 0; c < cuts.length - 1; c++) {
          const pts = slice(pl, cuts[c].s, cuts[c + 1].s); pts[0] = cuts[c].p.slice(); pts[pts.length - 1] = cuts[c + 1].p.slice();
          segs.push({ f, li, s0: cuts[c].s, pts, a: cuts[c], b: cuts[c + 1], ka: key(cuts[c].p), kb: key(cuts[c + 1].p), on: true });
        }
      }
    }));
    // the Heights: a cul-de-sac every so often up or down the slope from each lane
    if (d.lanes) for (const sg of segs.slice()) {
      const L = plen(sg.pts); if (L < 120) continue;
      for (let t = 50; t < L - 50; t += 110 + rng() * 60) {
        const p = slice(sg.pts, t, t + 2), dx = p[1][0] - p[0][0], dz = p[1][1] - p[0][1], l = Math.hypot(dx, dz), sd = rng() < 0.5 ? 1 : -1;
        const e = [p[0][0] - dz / l * 42 * sd, p[0][1] + dx / l * 42 * sd];
        if (!pip(e[0], e[1], poly)) continue;
        segs.push({ f: 2, li: segs.length, s0: 0, pts: [p[0], e], a: { p: p[0], anchor: true }, b: { p: e }, ka: key(p[0]), kb: key(e), on: true, stub: true });
      }
    }
    for (const sg of segs) {
      if (!sg.stub && rng() < (d.drop || 0)) sg.on = false;
      else if (!clear(sg.pts, d.w, false)) sg.on = false;
      else { // no line alongside an arterial or a ring
        const m = sg.pts[Math.floor(sg.pts.length / 2)], q = sg.pts[Math.min(sg.pts.length - 1, Math.floor(sg.pts.length / 2) + 1)], p = sg.pts[Math.floor(sg.pts.length / 2) - 1] || m;
        const n = frame.nearest(m[0], m[1], 30), L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        if (n && Math.abs(((q[0] - p[0]) * n.dir[0] + (q[1] - p[1]) * n.dir[1]) / L) > 0.8) sg.on = false;
      }
    }
    // a dead end inside the district: prune it back (suburbs keep it and get a turning circle instead)
    for (let pass = 0; pass < 40; pass++) {
      const deg = new Map(); for (const sg of segs) if (sg.on) for (const k of [sg.ka, sg.kb]) deg.set(k, (deg.get(k) || 0) + 1);
      let changed = false;
      for (const sg of segs) if (sg.on) {
        const deadA = !sg.a.anchor && deg.get(sg.ka) === 1, deadB = !sg.b.anchor && deg.get(sg.kb) === 1;
        if (!deadA && !deadB) continue;
        if ((d.cul || d.lanes) && !(deadA && deadB) && plen(sg.pts) > 40) { sg.cul = deadA ? sg.a.p : sg.b.p; continue; }
        sg.on = false; changed = true;
      }
      if (!changed) break;
    }
    // join what is left of each line into runs, one street each
    const byLine = new Map();
    for (const sg of segs) if (sg.on) { const k = sg.f + ':' + sg.li; let l = byLine.get(k); if (!l) byLine.set(k, l = []); l.push(sg); }
    for (const list of byLine.values()) {
      list.sort((p, q) => p.s0 - q.s0);
      let run = null;
      const flush = () => { if (run) { streets.push({ id: `st-${d.id}-${streets.length}`, kind: 'grid', w: d.w, pts: thin(run, 10), sub: 4, dist: d.id }); run = null; } };
      for (const sg of list) {
        if (run && key(run[run.length - 1]) === sg.ka) run.push(...sg.pts.slice(1)); else { flush(); run = sg.pts.slice(); }
        if (sg.cul) culs.push(sg.cul);
      }
      flush();
    }
  }

  // the Port interchange ramp runs straight on until it meets a Marina street
  { const r = def('ramp-port'), P = r.pts, a = P[P.length - 3], b = P[P.length - 2], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ma = new Index(); for (const st of streets) if (st.dist === 'ma') ma.add(st.pts, 1);
    for (let t = 0; t < 160; t += 2) { const p = [b[0] + (b[0] - a[0]) / L * t, b[1] + (b[1] - a[1]) / L * t], n = ma.nearest(p[0], p[1], 3); if (n) { P[P.length - 1] = n.p.map(Math.round); break; } } }

  /* ---------- route definitions ---------- */
  const defs = streets.map((st) => ({ id: st.id, closed: !!st.closed, width: st.w, surface: 'asphalt', lanes: 2, street: true, grade: 0.12, smoothWin: 8, sub: st.sub,
    pts: st.pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), keepStart: true, dist: st.dist, art: st.kind === 'art' }));
  culs.forEach((c, k) => { const pts = []; for (let a = 0; a < 8; a++) pts.push([c[0] + 8 * Math.cos(a * Math.PI / 4), c[1] + 8 * Math.sin(a * Math.PI / 4)]); defs.push({ id: 'cul-' + k, closed: true, width: 9, surface: 'asphalt', street: true, sub: 6, keepStart: true, pts }); });

  /* the paving: districts and docks paved or lawn, parks green; rasterised once on a 4 m grid */
  const RX0 = 3250, RZ0 = -1250, RC = 4, RNX = 490, RNZ = 615, ras = new Uint8Array(RNX * RNZ);
  const fill = (poly, v) => {
    for (let j = 0; j < RNZ; j++) {
      const z = RZ0 + j * RC, xs = [];
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) { const [xi, zi] = poly[i], [xk, zk] = poly[k]; if ((zi > z) !== (zk > z)) xs.push(xi + (z - zi) * (xk - xi) / (zk - zi)); }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil((xs[q] - RX0) / RC)); i <= Math.min(RNX - 1, Math.floor((xs[q + 1] - RX0) / RC)); i++) ras[j * RNX + i] = v;
    }
  };
  for (const d of D) fill(d.outline, d.paved === 1 ? 2 : 1);
  fill(STADIUM.lot, 2); fill(DOCKS.poly, 2);
  fill([[5070, -1000], [5170, -1000], [5170, 800], [4880, 800], [4990, 560], [5070, 300]], 2); // the east quay along Harbour Dr
  { const e = []; for (let a = 0; a < 48; a++) e.push([STADIUM.x + (STADIUM.rx - 18) * Math.cos(a * TAU / 48), STADIUM.z + (STADIUM.rz - 18) * Math.sin(a * TAU / 48)]); fill(e, 1); } // the pitch
  for (const p of PARKS) fill(p.poly, 1);
  const cell = (x, z) => {
    const i = Math.round((x - RX0) / RC), j = Math.round((z - RZ0) / RC);
    return i < 0 || j < 0 || i >= RNX || j >= RNZ ? 0 : [0, 0.6, 1][ras[j * RNX + i]];
  };
  return { districts: D, parks: PARKS, stadium: STADIUM, docks: DOCKS, defs, culs, cell, pip, curve, Index, rail, hwy };
})();
ROUTE_DEFS.splice(ROUTE_DEFS.findIndex((d) => d.ramp), 0, ...DISTRICT.defs);
