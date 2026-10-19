'use strict';
/* Red Mesa Rally · Port Calder's street plan: a fine kerb map with rounded corners, the junctions, and the paint and signals at each */

const STREETMAP = { x0: 3240, z0: -1620, x1: 5260, z1: 1180, res: 0.7, far: 12, fillet: 9 };

class Streets {
  constructor(T, city) {
    const M = STREETMAP;
    this.routes = T.routes.filter((R) => R.surface === 'asphalt' && !R.def.viaduct && !R.def.ramp && !R.def.noCarve && !R.def.trafficOnly && this.inBox(R));
    this.kerbMap();
    this.findJunctions(T);
    this.paint = []; this.signals = []; this.stops = [];
    for (const J of this.junctions) this.dress(J, T);
    this.rural = new Junctions(T, this);
    this.junctionMask();
    for (const P of city.lots || []) this.bays(P);
  }
  inBox(R) { const M = STREETMAP; for (let i = 0; i <= R.count; i += 4) if (R.x[i] > M.x0 && R.x[i] < M.x1 && R.z[i] > M.z0 && R.z[i] < M.z1) return true; return false; }
  /* the signed distance to the kerb (negative on the tarmac), the streets' union filleted at every corner, 8 steps a metre in a byte */
  kerbMap() {
    const M = STREETMAP, NX = Math.round((M.x1 - M.x0) / M.res), NZ = Math.round((M.z1 - M.z0) / M.res), TILE = 256;
    const out = new Uint8Array(NX * NZ).fill(255), enc = (e) => Math.max(0, Math.min(255, Math.round((e + 16) * 8)));
    this.NX = NX; this.NZ = NZ; this.kerb = out;
    // segments bucketed by the tiles they can reach
    const tiles = new Map(), reach = (R) => R.width / 2 + M.far;
    this.routes.forEach((R, ri) => {
      for (let i = 0; i < R.count; i += 2) {
        const j = Math.min(R.count, i + 2), ax = R.x[i], az = R.z[i], bx = R.x[j], bz = R.z[j], r = reach(R);
        const ti0 = Math.floor((Math.min(ax, bx) - r - M.x0) / M.res / TILE), ti1 = Math.floor((Math.max(ax, bx) + r - M.x0) / M.res / TILE);
        const tj0 = Math.floor((Math.min(az, bz) - r - M.z0) / M.res / TILE), tj1 = Math.floor((Math.max(az, bz) + r - M.z0) / M.res / TILE);
        for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
          if (ti < 0 || tj < 0 || ti * TILE >= NX || tj * TILE >= NZ) continue;
          const k = tj * 1000 + ti; let a = tiles.get(k); if (!a) tiles.set(k, a = []); a.push(ri, i, j);
        }
      }
    });
    const d1 = new Float32Array(TILE * TILE), d2 = new Float32Array(TILE * TILE), id1 = new Int16Array(TILE * TILE), id2 = new Int16Array(TILE * TILE), k = M.fillet;
    for (const [key, segs] of tiles) {
      const ti = key % 1000, tj = (key - ti) / 1000, ox = ti * TILE, oz = tj * TILE;
      d1.fill(99); d2.fill(99); id1.fill(-1); id2.fill(-1);
      for (let n = 0; n < segs.length; n += 3) {
        const R = this.routes[segs[n]], ri = segs[n], ax = R.x[segs[n + 1]], az = R.z[segs[n + 1]], bx = R.x[segs[n + 2]], bz = R.z[segs[n + 2]];
        const hw = R.width / 2, r = hw + M.far, vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - M.x0) / M.res) - ox), i1 = Math.min(TILE - 1, Math.ceil((Math.max(ax, bx) + r - M.x0) / M.res) - ox);
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - M.z0) / M.res) - oz), j1 = Math.min(TILE - 1, Math.ceil((Math.max(az, bz) + r - M.z0) / M.res) - oz);
        for (let j = j0; j <= j1; j++) {
          const pz = M.z0 + (oz + j) * M.res;
          for (let i = i0; i <= i1; i++) {
            const px = M.x0 + (ox + i) * M.res, t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2));
            const v = Math.hypot(px - ax - vx * t, pz - az - vz * t) - hw, c = j * TILE + i;
            if (id1[c] === ri) { if (v < d1[c]) d1[c] = v; }
            else if (v < d1[c]) { d2[c] = d1[c]; id2[c] = id1[c]; d1[c] = v; id1[c] = ri; }
            else if (id2[c] === ri) { if (v < d2[c]) d2[c] = v; }
            else if (v < d2[c]) { d2[c] = v; id2[c] = ri; }
          }
        }
      }
      for (let j = 0; j < TILE && oz + j < NZ; j++) for (let i = 0; i < TILE && ox + i < NX; i++) {
        const c = j * TILE + i, a = d1[c], b = d2[c]; if (a > 30) continue;
        const h = Math.max(k - Math.abs(a - b), 0) / k;
        out[(oz + j) * NX + ox + i] = enc(Math.min(a, b) - h * h * k * 0.25);
      }
    }
  }
  /* the junction boxes, where the through-lane paint stops: the middle and each arm out to its crossing */
  junctionMask() {
    const M = STREETMAP, NX = this.NX, NZ = this.NZ, jm = this.jmask = new Uint8Array(NX * NZ);
    const fill = (x0, z0, x1, z1, inside) => {
      for (let j = Math.max(0, Math.floor((z0 - M.z0) / M.res)); j <= Math.min(NZ - 1, Math.ceil((z1 - M.z0) / M.res)); j++)
        for (let i = Math.max(0, Math.floor((x0 - M.x0) / M.res)); i <= Math.min(NX - 1, Math.ceil((x1 - M.x0) / M.res)); i++) if (inside(M.x0 + i * M.res, M.z0 + j * M.res)) jm[j * NX + i] = 255;
    };
    for (const J of this.junctions) {
      const arms = J.arms.filter((A) => A.a0 > 0); if (!arms.length) continue;
      const r = Math.min(...arms.map((A) => A.a0));
      fill(J.x - r, J.z - r, J.x + r, J.z + r, (x, z) => Math.hypot(x - J.x, z - J.z) < r);
      for (const A of arms) {
        const w = A.hw + 3, L = A.a0 + 0.2, ex = J.x + A.ux * L, ez = J.z + A.uz * L;
        fill(Math.min(J.x, ex) - w, Math.min(J.z, ez) - w, Math.max(J.x, ex) + w, Math.max(J.z, ez) + w, (x, z) => { const a = (x - J.x) * A.ux + (z - J.z) * A.uz, l = Math.abs((x - J.x) * -A.uz + (z - J.z) * A.ux); return a > 0 && a < L && l < w; });
      }
    }
    // interleave with the kerb distance: red = kerb, green = junction box
    const rg = this.kerbRG = new Uint8Array(NX * NZ * 2);
    for (let k = 0; k < NX * NZ; k++) { rg[k * 2] = this.kerb[k]; rg[k * 2 + 1] = jm[k]; }
  }
  kerbAt(x, z) {
    const M = STREETMAP, i = Math.round((x - M.x0) / M.res), j = Math.round((z - M.z0) / M.res);
    if (i < 0 || j < 0 || i >= this.NX || j >= this.NZ) return 16;
    return this.kerb[j * this.NX + i] / 8 - 16;
  }
  /* where streets meet at grade: the centre, and each arm leaving it */
  findJunctions(T) {
    const Rs = this.routes, H = new Map(), C = 20, key = (x, z) => Math.floor(x / C) * 100000 + Math.floor(z / C), hits = [];
    Rs.forEach((R, ri) => { for (let i = 0; i <= R.count; i += 2) { const k = key(R.x[i], R.z[i]); let a = H.get(k); if (!a) H.set(k, a = []); a.push(ri, i); } });
    Rs.forEach((R, ri) => {
      for (let i = 0; i <= R.count; i += 2) {
        const x = R.x[i], z = R.z[i];
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const l = H.get(key(x + a * C, z + b * C)); if (!l) continue;
          for (let n = 0; n < l.length; n += 2) {
            const rj = l[n], j = l[n + 1]; if (rj <= ri) continue; const O = Rs[rj];
            const d = Math.hypot(O.x[j] - x, O.z[j] - z);
            if (d < (R.width + O.width) / 2 - 2 && Math.abs(R.y[i] - O.y[j]) < 3) hits.push({ x, z, d, ids: [ri, rj] });
          }
        }
      }
    });
    hits.sort((a, b) => a.d - b.d);
    const cl = [];
    for (const h of hits) {
      const c = cl.find((c) => Math.hypot(c.x - h.x, c.z - h.z) < 26);
      if (c) { for (const id of h.ids) if (!c.ids.includes(id)) c.ids.push(id); }
      else cl.push({ x: h.x, z: h.z, ids: [...h.ids] });
    }
    // settle each centre where the centrelines actually cross (or where a street ends on another)
    this.junctions = [];
    for (const c of cl) {
      let x = c.x, z = c.z;
      for (let it = 0; it < 4; it++) {
        let sx = 0, sz = 0;
        for (const ri of c.ids) { const p = Rs[ri].project(x, z, 0, -1), q = Rs[ri].posAt(p.s, {}); sx += q.x; sz += q.z; }
        x = sx / c.ids.length; z = sz / c.ids.length;
      }
      const arms = [];
      for (const ri of c.ids) {
        const R = Rs[ri], p = R.project(x, z, 0, -1);
        for (const dir of [-1, 1]) {
          let s1 = p.s + dir * 26;
          if (R.closed) s1 = (s1 + R.length) % R.length; else if (s1 < 0 || s1 > R.length) continue;
          const q = R.posAt(s1, {}), ax = q.x - x, az = q.z - z, L = Math.hypot(ax, az); if (L < 10) continue;
          arms.push({ ri, s: p.s, dir, ux: ax / L, uz: az / L, hw: R.width / 2 });
        }
      }
      // two arms leaving almost together are a merge, not a junction to paint
      const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.ux * b.ux + a.uz * b.uz)));
      const keep = arms.filter((a, i) => arms.every((b, j) => j === i || ang(a, b) > 0.45 || (j > i)));
      if (keep.length < 3) continue;
      const lanes = (R) => (R.width >= 13 ? 4 : 2);
      if (!T.city[T.gi(x, z)] || x < STREETMAP.x0 + 20 || x > STREETMAP.x1 - 20 || z < STREETMAP.z0 + 20 || z > STREETMAP.z1 - 20) continue;
      this.junctions.push({ x, z, y: T.rawH(x, z), arms: keep, major: keep.some((a) => lanes(Rs[a.ri]) > 2 || !/^(st|ring|lane|cul)-/.test(Rs[a.ri].id)) });
    }
  }
  /* crossings, stop lines and the signals or signs for one junction */
  dress(J, T) {
    const Rs = this.routes;
    for (const A of J.arms) {
      const R = Rs[A.ri];
      // walk out along the arm until both its kerbs are clear of the corner fillets
      let a0 = -1;
      for (let a = 4; a < 40; a += 0.5) {
        const p = R.posAt(R.closed ? (A.s + A.dir * a + R.length) % R.length : A.s + A.dir * a, {}), [dx, dz] = R.dirAt(R.closed ? (A.s + A.dir * a + R.length) % R.length : A.s + A.dir * a);
        const ok = [-1, 1].every((sd) => { const e = this.kerbAt(p.x - dz * sd * (A.hw + 1.5), p.z + dx * sd * (A.hw + 1.5)); return e > 1.2; });
        if (ok) { a0 = a; break; }
      }
      if (a0 < 0) continue;
      A.a0 = a0;
      const at = (a) => { const s = R.closed ? (A.s + A.dir * a + R.length) % R.length : A.s + A.dir * a; if (s < 0 || s > R.length) return null; const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); return { x: p.x, z: p.z, ux: dx * A.dir, uz: dz * A.dir }; };
      const c = at(a0 + 1.6), sl = at(a0 + 4); if (!c || !sl) continue;
      // zebra: bars across the street, running with the traffic
      const w = A.hw - 0.6;
      for (let l = -w + 0.3; l <= w - 0.3; l += 1.2) this.paint.push({ x: c.x - c.uz * l, z: c.z + c.ux * l, ux: c.ux, uz: c.uz, hl: 1.6, hw: 0.3 });
      // stop line across the lane coming in (traffic keeps right: heading back to the centre, its right is our left)
      const lane = A.hw / 2;
      this.paint.push({ x: sl.x + sl.uz * lane, z: sl.z - sl.ux * lane, ux: sl.ux, uz: sl.uz, hl: 0.25, hw: lane - 0.2 });
      // the signal stands on the kerb to the incoming driver's right
      const off = A.hw + 1.4, px = sl.x + sl.uz * off, pz = sl.z - sl.ux * off, y = T.rawH(px, pz);
      if (J.major) this.signals.push({ x: px, z: pz, y, yaw: Math.atan2(sl.ux, sl.uz), reach: A.hw * 0.5 + 1.4, phase: Math.abs(A.ux) > Math.abs(A.uz) ? 0 : 1 });
      else if (J.arms.length >= 4 || J.arms.filter((b) => b.ri === A.ri).length === 1) this.stops.push({ x: px, z: pz, y, yaw: Math.atan2(sl.ux, sl.uz) });
    }
  }
  /* painted bays in a car park: {x, z, yaw, w, d} with the bays across its depth */
  bays(P) {
    const c = Math.cos(P.yaw), s = Math.sin(P.yaw), ux = s, uz = c, vx = c, vz = -s; // u: across the lot (depth), v: along the street
    for (const row of P.rows) for (let a = -P.w / 2 + 1; a <= P.w / 2 - 1 + 0.01; a += 2.7) {
      const cx = P.x + vx * a + ux * row.b, cz = P.z + vz * a + uz * row.b;
      this.paint.push({ x: cx, z: cz, ux, uz, hl: 2.5, hw: 0.07 });
    }
  }
}
