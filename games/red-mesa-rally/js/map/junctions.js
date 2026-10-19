'use strict';
/* Red Mesa Rally · country junctions: outside Port Calder, where roads meet at grade. Each gets a fine patch the terrain shader
   reads instead of the coarse road grid (rounded corners, edge lines that follow them, the through road's paint carried across,
   the side road's paint stopped at its stop line), plus a stop line and a stop sign on every side road. No signals out here. */

const JPATCH = { size: 72, res: 0.5, fillet: 10, fade: [28, 34], cols: 14 };

class Junctions {
  constructor(T, streets) {
    this.T = T;
    // tarmac on the ground: no viaduct spans (their ends on the ground still count), no city streets
    this.ground = T.routes.filter((R) => R.surface === 'asphalt' && !R.def.street && !R.def.noCarve && !R.def.trafficOnly && !R.def.elevated);
    this.tracks = T.routes.filter((R) => R.surface === 'dirt' && !R.def.noCarve && !R.def.trafficOnly && !R.def.elevated);
    this.find();
    const P = JPATCH, n = Math.round(P.size / P.res);
    this.n = n; this.W = P.cols * n; this.H = Math.max(1, Math.ceil(this.list.length / P.cols)) * n;
    this.tex = new Uint8Array(this.W * this.H * 4);
    this.list.forEach((J, k) => { J.col = k % P.cols; J.row = Math.floor(k / P.cols); this.patch(J); this.dress(J, streets); });
  }
  onGround(R, i) { return !(R.elev && R.elev[i]); }
  /* where two roads (one of them tarmac) meet at about the same height, away from the city */
  find() {
    const T = this.T, all = [...this.ground, ...this.tracks], hits = [];
    for (let a = 0; a < this.ground.length; a++) for (let b = 0; b < all.length; b++) {
      const A = this.ground[a], B = all[b]; if (A === B || (b < this.ground.length && b <= a)) continue;
      for (let i = 0; i <= A.count; i += 2) {
        if (!this.onGround(A, i) || T.city[T.gi(A.x[i], A.z[i])]) continue;
        const p = B.project(A.x[i], A.z[i], 0, -1); if (p.dist > (A.width + B.width) / 2 - 2) continue;
        const j = Math.min(B.count, Math.round(p.s / B.step)); if (!this.onGround(B, j) || Math.abs(A.y[i] - B.y[j]) > 3) continue;
        hits.push({ x: A.x[i], z: A.z[i], d: p.dist, ids: [A, B] });
      }
    }
    hits.sort((a, b) => a.d - b.d);
    const cl = [];
    for (const h of hits) {
      const c = cl.find((c) => Math.hypot(c.x - h.x, c.z - h.z) < 30);
      if (c) { for (const R of h.ids) if (!c.Rs.includes(R)) c.Rs.push(R); } else cl.push({ x: h.x, z: h.z, Rs: [...h.ids] });
    }
    this.list = [];
    for (const c of cl) {
      // settle the centre where the centrelines cross (or where one road ends on another)
      let x = c.x, z = c.z;
      for (let it = 0; it < 4; it++) {
        let sx = 0, sz = 0;
        for (const R of c.Rs) { const q = R.posAt(R.project(x, z, 0, -1).s, {}); sx += q.x; sz += q.z; }
        x = sx / c.Rs.length; z = sz / c.Rs.length;
      }
      const arms = [];
      for (const R of c.Rs) {
        const p = R.project(x, z, 0, -1);
        for (const dir of [-1, 1]) {
          let s1 = p.s + dir * 26;
          if (R.closed) s1 = (s1 + R.length) % R.length; else if (s1 < 0 || s1 > R.length) continue;
          const q = R.posAt(s1, {}), ax = q.x - x, az = q.z - z, L = Math.hypot(ax, az); if (L < 10) continue;
          if (!this.onGround(R, Math.round(s1 / R.step))) continue; // that way it climbs onto its viaduct
          arms.push({ R, s: p.s, dir, ux: ax / L, uz: az / L, hw: R.width / 2 });
        }
      }
      // two arms leaving almost together are a merge, not a junction
      const keep = arms.filter((a, i) => arms.every((b, j) => j <= i || Math.acos(clamp(a.ux * b.ux + a.uz * b.uz, -1, 1)) > 0.45));
      if (keep.length < 3 || !keep.some((A) => A.R.surface === 'asphalt')) continue;
      // the through road has right of way: tarmac first, then running straight through, then the widest
      const score = (R) => (R.surface === 'asphalt' ? 100 : 0) + (keep.filter((A) => A.R === R).length === 2 ? 50 : 0) + R.width - (R.def.ramp ? 20 : 0);
      const major = c.Rs.filter((R) => keep.some((A) => A.R === R)).sort((a, b) => score(b) - score(a))[0];
      this.list.push({ x, z, arms: keep, major });
    }
  }
  /* the patch: R kerb distance, G side-road box (no paint), B offset from the owning road's centreline, A owner and dash phase */
  patch(J) {
    const P = JPATCH, n = this.n, half = P.size / 2, k = P.fillet, N = n * n;
    const e1 = new Float32Array(N).fill(99), e2 = new Float32Array(N).fill(99), r1 = new Int16Array(N).fill(-1), r2 = new Int16Array(N).fill(-1);
    const own = new Float32Array(N).fill(99), lat = new Float32Array(N), sv = new Float32Array(N), oid = new Int16Array(N).fill(-1);
    const em = new Float32Array(N).fill(99), dm = new Float32Array(N), sm = new Float32Array(N);
    const x0 = J.x - half, z0 = J.z - half;
    this.ground.forEach((R, ri) => {
      const hw = R.width / 2 + 1.0, reach = hw + 16;
      for (let i = 0; i < R.count; i += 2) {
        const j = Math.min(R.count, i + 2); if (!this.onGround(R, i) && !this.onGround(R, j)) continue;
        const ax = R.x[i], az = R.z[i], bx = R.x[j], bz = R.z[j];
        if (Math.max(ax, bx) < x0 - reach || Math.min(ax, bx) > x0 + P.size + reach || Math.max(az, bz) < z0 - reach || Math.min(az, bz) > z0 + P.size + reach) continue;
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / P.res)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / P.res));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / P.res)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + reach - z0) / P.res));
        for (let jj = j0; jj <= j1; jj++) {
          const pz = z0 + (jj + 0.5) * P.res;
          for (let ii = i0; ii <= i1; ii++) {
            const px = x0 + (ii + 0.5) * P.res, t = clamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1);
            const d = Math.hypot(px - ax - vx * t, pz - az - vz * t), e = d - hw, c = jj * n + ii, s = (i + t * (j - i)) * R.step;
            const sd = vx * (pz - az) - vz * (px - ax) < 0 ? d : -d; // signed, so the filtered offset still passes through zero on the centreline
            if (r1[c] === ri) { if (e < e1[c]) e1[c] = e; } else if (e < e1[c]) { e2[c] = e1[c]; r2[c] = r1[c]; e1[c] = e; r1[c] = ri; } else if (r2[c] === ri) { if (e < e2[c]) e2[c] = e; } else if (e < e2[c]) { e2[c] = e; r2[c] = ri; }
            if (e < own[c]) { own[c] = e; lat[c] = sd; sv[c] = s; oid[c] = ri; }
            if (R === J.major && e < em[c]) { em[c] = e; dm[c] = sd; sm[c] = s; }
          }
        }
      }
    });
    // how far up each side road its paint stays off: out to where both its kerbs clear the corner fillets
    const sdf = (x, z) => { const ii = Math.round((x - x0) / P.res - 0.5), jj = Math.round((z - z0) / P.res - 0.5); if (ii < 0 || jj < 0 || ii >= n || jj >= n) return 16; const c = jj * n + ii, a = e1[c], b = e2[c], h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
    for (const A of J.arms) {
      if (A.R === J.major) continue;
      A.a0 = 24;
      for (let a = 4; a < 30; a += 0.5) {
        const s = A.s + A.dir * a, p = A.R.posAt(A.R.closed ? (s + A.R.length) % A.R.length : s, {}), [dx, dz] = A.R.dirAt(A.R.closed ? (s + A.R.length) % A.R.length : s);
        if ([-1, 1].every((sd) => sdf(p.x - dz * sd * (A.hw + 2.5), p.z + dx * sd * (A.hw + 2.5)) > 1.2)) { A.a0 = a; break; }
      }
    }
    const box = Math.max(...J.arms.map((A) => A.a0 || 0)) + 1;
    const ox = J.col * n, oz = J.row * n, out = this.tex;
    for (let jj = 0; jj < n; jj++) for (let ii = 0; ii < n; ii++) {
      const c = jj * n + ii, a = e1[c], b = e2[c], h = Math.max(k - Math.abs(a - b), 0) / k, e = Math.min(a, b) - h * h * k * 0.25;
      // on the through road's tarmac it owns the paint; elsewhere whichever road is nearest
      const maj = em[c] < 0.5 || (oid[c] >= 0 && this.ground[oid[c]] === J.major), d = maj && em[c] < 50 ? dm[c] : lat[c], s = maj && em[c] < 50 ? sm[c] : sv[c];
      const px = x0 + (ii + 0.5) * P.res - J.x, pz = z0 + (jj + 0.5) * P.res - J.z;
      const inBox = !maj && Math.hypot(px, pz) < box && J.arms.some((A) => A.a0 && px * A.ux + pz * A.uz > 0 && px * A.ux + pz * A.uz < A.a0 + 0.3 && Math.abs(-px * A.uz + pz * A.ux) < A.hw + 4);
      const ph = (((s % 24) + 24) % 24) / 24, q = ((oz + jj) * this.W + ox + ii) * 4;
      out[q] = clamp(Math.round((e + 16) * 8), 0, 255);
      out[q + 1] = inBox || (!maj && Math.hypot(px, pz) < (J.major.width / 2 + 2)) ? 255 : 0;
      out[q + 2] = clamp(Math.round((d + 16) * 8), 0, 255);
      out[q + 3] = clamp(Math.round((maj ? ph * 0.5 : 0.5 + ph * 0.5) * 255), 0, 255);
    }
  }
  /* a stop line across the incoming lane of each side road, and a stop sign on its kerb */
  dress(J, S) {
    for (const A of J.arms) {
      if (A.R === J.major || !A.a0) continue;
      const R = A.R, at = (a) => { let s = A.s + A.dir * a; if (R.closed) s = (s + R.length) % R.length; else if (s < 0 || s > R.length) return null; const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); return { x: p.x, z: p.z, ux: dx * A.dir, uz: dz * A.dir }; };
      const sl = at(A.a0 + 1); if (!sl) continue;
      const lane = A.hw / 2;
      if (R.surface === 'asphalt') S.paint.push({ x: sl.x + sl.uz * lane, z: sl.z - sl.ux * lane, ux: sl.ux, uz: sl.uz, hl: 0.25, hw: lane - 0.3 });
      const off = A.hw + 1.6, px = sl.x + sl.uz * off, pz = sl.z - sl.ux * off;
      S.stops.push({ x: px, z: pz, y: this.T.height(px, pz), yaw: Math.atan2(sl.ux, sl.uz) });
    }
  }
}
