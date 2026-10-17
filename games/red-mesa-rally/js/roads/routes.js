'use strict';
/* Red Mesa Rally · Roads: street paths, every route definition and the Route spline */

/* ---------- Routes ---------- */
/* Turn grid corners into a street path that stays on the asphalt through right-angle turns. */
function streetPath(corners, closed) {
  const out = [], n = corners.length, R = 24;
  for (let k = 0; k < n; k++) {
    const p = corners[(k - 1 + n) % n], c = corners[k], q = corners[(k + 1) % n];
    const u = [c[0] - p[0], c[1] - p[1]], v = [q[0] - c[0], q[1] - c[1]];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    out.push([c[0] - u[0] / lu * R, c[1] - u[1] / lu * R], [c[0] + v[0] / lv * R, c[1] + v[1] / lv * R]);
    out.push([c[0] + v[0] * 0.35, c[1] + v[1] * 0.35], [c[0] + v[0] * 0.65, c[1] + v[1] * 0.65]);
  }
  return out;
}
const CX = (i) => CITY.x0 + i * CITY.pitch, CZ = (j) => CITY.z0 + j * CITY.pitch;
const ROUTE_DEFS = [
  { id: 'canyon', closed: true, width: 17, jumps: 4, mud: 1, whoops: 1,
    pts: [[-60, 30], [80, -40], [215, -140], [268, -265], [235, -420], [255, -600], [170, -720], [10, -760], [-150, -700], [-240, -580], [-215, -430], [-195, -290], [-150, -190], [-130, -50]] },
  { id: 'mudbowl', closed: true, width: 15, jumps: 0, mud: 3, whoops: 2,
    pts: [[300, 500], [390, 430], [510, 430], [570, 510], [530, 600], [440, 610], [390, 670], [300, 700], [230, 640], [260, 560]] },
  { id: 'sprint', closed: false, width: 15, jumps: 5, mud: 1, whoops: 2,
    pts: [[-70, 230], [-230, 270], [-380, 190], [-480, 90], [-610, 60], [-700, -40], [-680, -200], [-620, -320], [-650, -480], [-560, -610], [-410, -650], [-300, -760]] },
  { id: 'ridge', closed: true, width: 15, jumps: 3, mud: 0, whoops: 2,
    pts: [[330, 60], [470, -30], [560, -130], [680, -150], [790, -80], [790, 60], [700, 140], [580, 130], [450, 150]] },
  { id: 'trail-east', closed: false, width: 9, trail: true, pts: [[60, 170], [160, 240], [240, 330], [290, 440]] },
  { id: 'trail-ridge', closed: false, width: 9, trail: true, pts: [[70, 110], [190, 80], [330, 60]] },
  { id: 'trail-lake', closed: false, width: 9, trail: true, pts: [[-20, 220], [-50, 400], [-10, 560], [-20, 700]] },
  { id: 'trail-north', closed: false, width: 9, trail: true, pts: [[-300, -760], [-150, -800], [10, -760]] },
  // ---- the east ----
  { id: 'tunnel', closed: false, width: 13, surface: 'asphalt', tunnel: true, lanes: 2, grade: 0.05,
    pts: [[792, 10], [850, 12], [1000, 16], [1250, 20], [1480, 18], [1600, 12], [1700, -10], [1760, -40]] },
  // the interstate: up the valley past Millbrook to the Kestrel Pass junction, through Port Calder on a viaduct, back west along the coast.
  // It flies over every road and railway that crosses it (viaduct), so you only get on at a junction or a ramp.
  { id: 'hwy', closed: true, width: 22, surface: 'asphalt', lanes: 4, rails: true, smoothWin: 40, grade: 0.06, viaduct: true,
    pts: [[1760, -40], [1690, -420], [1800, -820], [1990, -1060], [2160, -1120], [2380, -1390], [2720, -1440], [3021, -1390], [3150, -1330], [3400, -1180], [3640, -1060],
      [3870, -900], [3897, -640], [3897, -380], [3897, -120], [4022, 120], [4147, 380], [4120, 560], [3900, 560], [3600, 600], [3300, 640], [3150, 620], [2850, 585],
      [2550, 480], [2200, 320], [1900, 160]] },
  { id: 'coast', closed: false, width: 15, surface: 'asphalt', lanes: 2, rails: true, smoothWin: 30, grade: 0.08,
    pts: [[2350, 210], [2300, 500], [2450, 850], [2850, 1050], [3350, 1050], [3800, 900], [4100, 700], [4210, 520], [4210, CITY.z1]] },
  { id: 'pass', closed: false, width: 11, surface: 'asphalt', lanes: 2, smoothWin: 25, grade: 0.11, rails: true,
    // ends sit on the highway centreline; the north face is too steep to drop straight down, so it switchbacks
    pts: [[3021, -1390], [3050, -1600], [2900, -1800], [3150, -1950], [3000, -2200], [2750, -2300], [2850, -2500], [2550, -2600], [2350, -2450], [2400, -2200],
      [2420, -2060], [2400, -1920], [2150, -1870], [1990, -1845], [1895, -1805], [1885, -1750], [1960, -1725], [2100, -1690], [2400, -1580], [2430, -1480], [2430, -1405]] },
  { id: 'harbour', closed: true, width: 16, surface: 'asphalt', street: true,
    pts: streetPath([[CX(3), CZ(2)], [CX(8), CZ(2)], [CX(8), CZ(5)], [CX(10), CZ(5)], [CX(10), CZ(9)], [CX(6), CZ(9)], [CX(6), CZ(6)], [CX(3), CZ(6)]], true) },
  // ---- country roads: gravel tracks across the desert, farm lanes through the valley, logging roads in the pines ----
  { id: 'trail-west', closed: false, width: 10, trail: true, country: true, pts: [[-230, 270], [-380, 450], [-350, 650], [-180, 760], [-20, 700]] },
  { id: 'trail-mesa', closed: false, width: 10, trail: true, country: true, pts: [[-700, -40], [-560, -60], [-420, -30], [-260, -40], [-135, -60]] },
  { id: 'trail-spires', closed: false, width: 10, trail: true, country: true, pts: [[264, -302], [380, -235], [500, -180], [560, -130]] },
  { id: 'lane-valley', closed: false, width: 9, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[2430, -1405], [2470, -1340], [2600, -950], [2450, -600], [2650, -250], [2605, 175]] },
  { id: 'lane-farm', closed: false, width: 9, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[3060, -332], [3000, -420], [2800, -700], [2950, -1000], [3219, -1272]] },
  { id: 'track-pines', closed: false, width: 9, country: true, grade: 0.14, pts: [[2400, -1920], [2550, -1895], [2700, -1905], [2810, -1870], [2900, -1800]] },
  { id: 'track-logging', closed: false, width: 9, country: true, grade: 0.14, pts: [[2050, -1050], [2000, -1250], [2030, -1450], [2060, -1600], [2100, -1690]] },
  // ---- side roads: an orchard lane down to the coast, a dune loop by the beach, a ridge track over the pines, a mill lane across the valley ----
  { id: 'lane-orchard', closed: false, width: 10, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[2849, 148], [2880, 300], [3040, 420], [3150, 600], [3090, 790], [2960, 930], [2900, 1059]] },
  { id: 'track-dunes', closed: true, width: 13, country: true, jumps: 2, whoops: 1, mud: 1,
    pts: [[1900, 650], [2060, 590], [2190, 640], [2245, 760], [2200, 930], [2060, 1060], [1900, 1040], [1820, 900], [1800, 760]] },
  { id: 'trail-dunes', closed: false, width: 10, trail: true, country: true, pts: [[2368, 731], [2310, 745], [2240, 760]] },
  { id: 'track-kestrel', closed: false, width: 10, country: true, grade: 0.13, jumps: 1,
    pts: [[3150, -1950], [3330, -1870], [3560, -1830], [3780, -1720], [3790, -1540], [3600, -1390], [3360, -1205]] },
  { id: 'lane-mill', closed: false, width: 9, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[1750, -650], [1950, -590], [2150, -640], [2300, -570], [2450, -600]] },
  // ---- links into Port Calder: the old oval's south side kept as Valley Rd, Mesa Blvd and North Rd across the valley to the grid ----
  { id: 'valley-rd', closed: false, width: 13, surface: 'asphalt', lanes: 2, rails: true, smoothWin: 20, grade: 0.07,
    pts: [[2200, 320], [2350, 210], [2480, 192], [2605, 175], [2730, 160], [2849, 148], [2990, 160], [3150, 170], [3300, 180], [CX(0), CZ(9)]] },
  { id: 'mesa-blvd', closed: false, width: 12, surface: 'asphalt', lanes: 2, smoothWin: 20, grade: 0.08,
    pts: [[2627, -313], [2800, -315], [2960, -322], [3121, -339], [3300, -325], [CX(0), CZ(5)]] },
  { id: 'north-rd', closed: false, width: 11, surface: 'asphalt', lanes: 2, country: true, smoothWin: 20, grade: 0.09,
    pts: [[2915, -925], [3020, -890], [3150, -860], [3300, -830], [CX(0), CZ(1)]] },
  // ---- interchanges: two-way slip roads off the viaduct down to the street grid ----
  { id: 'ramp-kestrel', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3700, -1022], [3655, -1040], [3605, -1050], [3555, -1042], [3510, -1012], [3478, -972], [CX(0), CZ(0) + 10]] },
  { id: 'ramp-central-w', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3897, -730], [3893, -685], [3881, -640], [3868, -590], [3866, -520], [3866, -450], [3862, -380], [3850, -335], [CX(3), CZ(5)]] },
  { id: 'ramp-central-e', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3912, -85], [3905, -125], [3912, -170], [3928, -220], [3930, -280], [3942, -308], [CX(4), CZ(5)]] },
  { id: 'ramp-port', closed: false, width: 10, surface: 'asphalt', lanes: 2, smoothWin: 12, grade: 0.07, viaduct: true, ramp: true,
    pts: [[3840, 566], [3795, 562], [3752, 548], [3724, 520], [3713, 482], [CX(2), CZ(11)]] },
  { id: 'rail', closed: true, width: 8, surface: 'rail', smoothWin: 70, passes: 6, grade: 0.03, noFeatures: true,
    pts: [[1950, -250], [2100, 100], [2250, 330], [2600, 560], [3100, 760], [3700, 690], [4150, 600], [4650, 600], [5060, 460], [5080, -200], [5050, -900], [4600, -1300], [4000, -1580], [3400, -1700], [2800, -1650], [2350, -1450], [2150, -1000], [2000, -650]] },
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

class Route {
  constructor(def) {
    this.def = def; this.id = def.id; this.closed = def.closed; this.width = def.width;
    this.surface = def.surface || 'dirt';
    const P = def.pts, n = P.length, dense = [];
    const get = (i) => this.closed ? P[(i + n) % n] : P[clamp(i, 0, n - 1)];
    const segs = this.closed ? n : n - 1;
    const sub = def.sub || 40;
    for (let i = 0; i < segs; i++) for (let k = 0; k < sub; k++) dense.push(catmull(get(i - 1), get(i), get(i + 1), get(i + 2), k / sub));
    if (!this.closed) dense.push(P[n - 1].slice());
    const STEP = 2;
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    let total = cum[cum.length - 1];
    if (this.closed) total += Math.hypot(dense[0][0] - dense[dense.length - 1][0], dense[0][1] - dense[dense.length - 1][1]);
    const count = Math.floor(total / STEP);
    this.length = count * STEP; this.step = STEP; this.count = count;
    this.x = new Float32Array(count + 1); this.z = new Float32Array(count + 1); this.y = new Float32Array(count + 1);
    this.mud = new Uint8Array(count + 1); this.feature = new Float32Array(count + 1); this.curv = new Float32Array(count + 1);
    let j = 0;
    for (let i = 0; i <= count; i++) {
      const s = i * STEP * (total / this.length);
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      let ax, az, bx, bz, t;
      if (this.closed && s > cum[cum.length - 1]) { const a = dense[dense.length - 1], b = dense[0]; const seg = total - cum[cum.length - 1]; t = (s - cum[cum.length - 1]) / seg; ax = a[0]; az = a[1]; bx = b[0]; bz = b[1]; }
      else { const a = dense[j], b = dense[j + 1]; t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]); ax = a[0]; az = a[1]; bx = b[0]; bz = b[1]; }
      this.x[i] = lerp(ax, bx, clamp(t, 0, 1)); this.z[i] = lerp(az, bz, clamp(t, 0, 1));
    }
    if (this.closed) { this.x[count] = this.x[0]; this.z[count] = this.z[0]; }
    this.computeCurvature();
    if (this.closed && !def.keepStart) { // start/finish on the straightest stretch
      let best = 1e9, bi = 0; const span = 35;
      for (let i = 0; i < count; i++) { let m = 0; for (let j = -span; j <= span; j += 2) m = Math.max(m, Math.abs(this.curv[this.idx(i + j)])); if (m < best) { best = m; bi = i; } }
      const rot = (a) => { const b = new Float32Array(a.length); for (let i = 0; i < count; i++) b[i] = a[(i + bi) % count]; b[count] = b[0]; return b; };
      this.x = rot(this.x); this.z = rot(this.z); this.curv = rot(this.curv);
    }
  }
  computeCurvature() {
    const W = 6, count = this.count;
    for (let i = 0; i <= count; i++) {
      const a = this.idx(i - W), b = this.idx(i + W);
      const h1 = Math.atan2(this.x[i] - this.x[a], -(this.z[i] - this.z[a]));
      const h2 = Math.atan2(this.x[b] - this.x[i], -(this.z[b] - this.z[i]));
      let d = h2 - h1; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      this.curv[i] = d / (W * this.step);
    }
    if (!this.closed) for (let i = 0; i < W; i++) { this.curv[i] = this.curv[W]; this.curv[count - i] = this.curv[count - W]; }
  }
  idx(i) { const c = this.count; return this.closed ? ((i % c) + c) % c : clamp(i, 0, c); }
  wrapS(s) { return this.closed ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length); }
  sample(arr, s) { s = this.wrapS(s); const f = s / this.step, i = Math.floor(f), t = f - i; return lerp(arr[this.idx(i)], arr[this.idx(i + 1)], t); }
  posAt(s, out) { out.x = this.sample(this.x, s); out.z = this.sample(this.z, s); out.y = this.sample(this.y, s); return out; }
  dirAt(s) { const a = this.wrapS(s - 2), b = this.wrapS(s + 2); const dx = this.sample(this.x, b) - this.sample(this.x, a), dz = this.sample(this.z, b) - this.sample(this.z, a); const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; }
  curvAt(s) { return this.sample(this.curv, s); }
  project(x, z, sGuess, win) {
    let i0, i1;
    if (win < 0) { i0 = 0; i1 = this.count; } else { const c = Math.round(sGuess / this.step), w = Math.ceil(win / this.step); i0 = c - w; i1 = c + w; if (!this.closed) { i0 = Math.max(0, i0); i1 = Math.min(this.count, i1); } }
    let best = 1e18, bi = 0;
    for (let k = i0; k <= i1; k++) { const i = this.idx(k); const dx = x - this.x[i], dz = z - this.z[i]; const d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    const i = bi, j = this.idx(bi + 1), h = this.idx(bi - 1);
    let s = bi * this.step, bestD = best;
    for (const [a, b] of [[h, i], [i, j]]) {
      const ax = this.x[a], az = this.z[a], bx = this.x[b], bz = this.z[b];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
      const px = ax + vx * t, pz = az + vz * t, d = (x - px) ** 2 + (z - pz) ** 2;
      if (d <= bestD) { bestD = d; s = (a + t) * this.step; }
    }
    const [dx, dz] = this.dirAt(s);
    const lat = (x - this.sample(this.x, s)) * (-dz) + (z - this.sample(this.z, s)) * dx;
    return { s: this.wrapS(s), dist: Math.sqrt(bestD), lat };
  }
  /* corners worth warning about: where the heading swings by a fair angle within a short stretch */
  turns() {
    if (this._turns) return this._turns;
    const out = [], n = this.count, W = Math.round(30 / this.step);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.curv[i]); if (k < 0.012) continue;
      let peak = true; for (let j = -W; j <= W; j++) if (j && Math.abs(this.curv[this.idx(i + j)]) > k) { peak = false; break; }
      if (!peak || (!this.closed && (i < 5 || i > n - 5))) continue;
      let ang = 0; for (let j = -W; j <= W; j++) ang += this.curv[this.idx(i + j)] * this.step;
      if (Math.abs(ang) < 0.5) continue;
      const s = i * this.step;
      if (out.length && Math.abs(out[out.length - 1].s - s) < 45) continue;
      out.push({ s, ang, sharp: Math.abs(ang) > 1.15 || k > 0.06 });
    }
    return (this._turns = out);
  }
  /* walk along existing routes to build a point-to-point event route without re-carving */
  static compose(def, parts) {
    // sample each part, then fillet every junction with a quadratic curve around the corner
    const segs = parts.map(({ route: R, from, to, dir }) => {
      const s0 = R.project(from[0], from[1], 0, -1).s, s1 = R.project(to[0], to[1], 0, -1).s;
      let span = (s1 - s0) * dir; if (R.closed) span = ((span % R.length) + R.length) % R.length; else span = Math.abs(span);
      const out = []; for (let d = 0; d <= span; d += 8) { const s = R.wrapS(s0 + d * dir); out.push([R.sample(R.x, s), R.sample(R.z, s)]); }
      return out;
    });
    const FR = 34, pts = [];
    for (let k = 0; k < segs.length; k++) {
      let seg = segs[k];
      if (k > 0) { const c = segs[k - 1].corner; seg = seg.filter((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) > FR); }
      if (k < segs.length - 1) {
        const c = seg[seg.length - 1], nx = segs[k + 1][0];
        const corner = [(c[0] + nx[0]) / 2, (c[1] + nx[1]) / 2]; segs[k].corner = corner;
        seg = seg.filter((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) > FR);
        for (const p of seg) pts.push(p);
        // fillet from the trimmed end of this part to the trimmed start of the next
        const a = pts[pts.length - 1], nb = segs[k + 1].find((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) > FR) || nx;
        const L = Math.hypot(nb[0] - a[0], nb[1] - a[1]), n = Math.max(2, Math.ceil(L / 7));
        for (let i = 1; i < n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * corner[0] + t * t * nb[0], u * u * a[1] + 2 * u * t * corner[1] + t * t * nb[1]]); }
      } else for (const p of seg) pts.push(p);
    }
    const clean = [pts[0]];
    for (const p of pts) { const q = clean[clean.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 5) clean.push(p); }
    return new Route({ ...def, pts: clean, sub: 4 });
  }
}
