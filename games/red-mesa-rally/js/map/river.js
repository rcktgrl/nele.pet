'use strict';
/* Red Mesa Rally · Calder River: down from the Kestrel Pines, round the island below Millbrook,
   through Port Calder as a concrete channel (or the boat tunnel beside it) and out into the harbour */

/* open Catmull-Rom through pts, n samples per span (same curve as the map plan) */
function catmullPts(pts, n) {
  const out = [], L = pts.length;
  for (let i = 0; i < L - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(L - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t, c = (a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3);
      out.push([c(0), c(1)]);
    }
  }
  out.push(pts[L - 1]);
  return out;
}
function resamplePts(P, step) {
  const out = [P[0]]; let carry = 0;
  for (let i = 1; i < P.length; i++) {
    const [ax, az] = P[i - 1], [bx, bz] = P[i], L = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= L) { out.push([ax + (bx - ax) * d / L, az + (bz - az) * d / L]); d += step; }
    carry = L - (d - step);
  }
  const e = P[P.length - 1], l = out[out.length - 1]; if (Math.hypot(e[0] - l[0], e[1] - l[1]) > step * 0.3) out.push(e); else out[out.length - 1] = e;
  return out;
}

const RIVER = (() => {
  const CTRL = [[2520, -2330], [2420, -1900], [2330, -1500], [2470, -1060], [2560, -700], [2470, -330], [2440, 20], [2620, 300], [2900, 470], [3150, 520],
    [3330, 560], [3520, 520], [3720, 560], [3900, 700], [4080, 790], [4250, 815]];
  const STEP = 8, P = resamplePts(catmullPts(CTRL, 14), STEP), n = P.length;
  const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const nrm = (Q, i) => { const a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]; };
  // water level: falls with the valley floor in the hills, sea level (the global water plane) from the foothills on
  const wl = new Float32Array(n), land = new Float32Array(n);
  // the lowest ground across the bed, so a stream on a side slope never hangs above its lower bank
  for (let i = 0; i < n; i++) { const [nx, nz] = nrm(P, i); land[i] = Math.min(...[-24, -12, 0, 12, 24].map((l) => naturalHeight(P[i][0] + nx * l, P[i][1] + nz * l))); }
  const SEA = 1000; // metres along: the stream has come down out of the hills and the river is at sea level
  let m = Infinity; for (let i = 0; i < n; i++) { m = Math.min(m, land[i] - 3, lerp(land[0] - 3, WATER_Y, smooth(SEA - 750, SEA, s[i]))); wl[i] = m; }
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < n - 1; i++) wl[i] = Math.min(wl[i - 1], (wl[i - 1] + wl[i] + wl[i + 1]) / 3);
  const CHANNEL_X = CITY.x0 - 40; // concrete walls from the edge of the docks on
  const pt = (x, z, hw, bank, w, cc) => ({ x, z, hw, bank, wl: w, con: cc });
  const reach = (id, list) => ({ id, pts: list });
  // the island: two arms bow out either side of the centreline between ISL[0] and ISL[1] metres along it
  const ISL = [2040, 2480];
  const wOf = (si) => Math.sin(Math.PI * (si - ISL[0]) / (ISL[1] - ISL[0]));
  const main = (i) => {
    const con = P[i][0] > CHANNEL_X;
    const hw = con ? 15 : lerp(lerp(5, 13, clamp(i / (n * 0.3), 0, 1)), 21, smooth(WATER_Y + 2, WATER_Y, wl[i]));
    const bank = con ? 3 : clamp((land[i] - wl[i]) * 2.2, 10, 70);
    return pt(P[i][0], P[i][1], hw, bank, wl[i], con);
  };
  const up = [], down = [], armL = [], armR = [];
  for (let i = 0; i < n; i++) {
    if (s[i] < ISL[0]) up.push(main(i));
    else if (s[i] > ISL[1]) down.push(main(i));
    else {
      const w = wOf(s[i]), [nx, nz] = nrm(P, i), b = main(i);
      armL.push({ ...b, x: b.x + nx * 115 * w, z: b.z + nz * 115 * w, hw: lerp(21, 25, w) });
      armR.push({ ...b, x: b.x - nx * 95 * w, z: b.z - nz * 95 * w, hw: lerp(21, 22, w) });
    }
  }
  const joinA = up[up.length - 1], joinB = down[0];
  const reaches = [reach('upper', up), reach('arm-left', [joinA, ...armL, joinB]), reach('arm-right', [joinA, ...armR, joinB]), reach('lower', down)];
  // island outline for the scenery: inside both arms
  const island = [];
  for (let i = 0; i < n; i++) if (s[i] >= ISL[0] && s[i] <= ISL[1]) { const w = wOf(s[i]), [nx, nz] = nrm(P, i); if (115 * w - 28 > 0) island.push([P[i][0] + nx * (115 * w - 28), P[i][1] + nz * (115 * w - 28)]); }
  for (let i = n - 1; i >= 0; i--) if (s[i] >= ISL[0] && s[i] <= ISL[1]) { const w = wOf(s[i]), [nx, nz] = nrm(P, i); if (95 * w - 26 > 0) island.push([P[i][0] - nx * (95 * w - 26), P[i][1] - nz * (95 * w - 26)]); }
  // the boat tunnel under Sunset Marina: forks off the channel, same length (815 m) as the open way round
  const TUN = resamplePts([[3270, 553], [3289, 572], [3316, 600], [3348, 631], [3383, 663], [3420, 690], [3460, 713], [3503, 735], [3549, 756], [3595, 772],
    [3640, 783], [3685, 785], [3731, 781], [3777, 774], [3821, 766], [3860, 761], [3897, 760], [3932, 760], [3963, 760], [3990, 761], [4009, 761]], 4);
  const ts = [0]; for (let i = 1; i < TUN.length; i++) ts.push(ts[i - 1] + Math.hypot(TUN[i][0] - TUN[i - 1][0], TUN[i][1] - TUN[i - 1][1]));
  const tunnel = { pts: TUN, s: ts, length: ts[ts.length - 1], hw: 8, open: [62, ts[ts.length - 1] - 62], ceil: WATER_Y + 5, under: WATER_Y + 3.4, bed: WATER_Y - 3.2 };
  // cut open end to end like the channel; the covered middle gets a lid laid back over it (see carveRiver)
  reaches.push(reach('tunnel', TUN.map(([x, z]) => pt(x, z, tunnel.hw, 3, WATER_Y, true))));
  // the boat race: Millbrook down the left arm and the open channel, finishing out in the harbour
  const b0 = Math.max(0, up.findIndex((q) => q.z > -560 && q.wl <= WATER_Y));
  const line = [...up.slice(b0), ...armL, ...down, { x: 4330, z: 838 }, { x: 4420, z: 860 }];
  const racePts = line.filter((_, i) => i % 3 === 0 || i === line.length - 1).map((q) => [q.x, q.z]);
  return { CTRL, P, s, wl, reaches, island, tunnel, ISL, boatStart: up[b0], racePts, length: s[n - 1] };
})();

/* bed height a reach asks for at distance d from its centre, given the ground h there */
function riverBed(q, d, h) {
  // deep at sea level, shallow up in the hills, blending over the last metre and a half of fall so no step shows through the water
  const up = q.wl - WATER_Y;
  const centre = Math.min(q.wl - 1.1, WATER_Y - (q.con ? 3.6 : 4.5) + up * 2.5), edge = Math.min(q.wl - 0.25, WATER_Y - (q.con ? 3.2 : 1.2) + up * 1.7);
  if (d < q.hw) return lerp(centre, edge, (d / q.hw) * (d / q.hw));
  return lerp(edge, Math.max(h, edge), smooth(q.hw, q.hw + q.bank, d));
}

/* carve every reach into the height grid: water, beds and banks only ever lower the ground */
function carveRiver(T) {
  const { Nx, Nz, cell: c, x0, z0 } = T;
  T.river = new Uint8Array(Nx * Nz); // 255 = under water
  // the boat tunnel's covered middle, on a 2 m grid: 1 the bore (water for boats, the lid for everyone else), 2 the lid over the walls.
  // top keeps the ground as it was before the cut, so the lid sits exactly where the land was
  const U = RIVER.tunnel, G = 2, xs = U.pts.map((p) => p[0]), zs = U.pts.map((p) => p[1]);
  const bx0 = Math.min(...xs) - 20, bz0 = Math.min(...zs) - 20, nx = Math.ceil((Math.max(...xs) + 20 - bx0) / G), nz = Math.ceil((Math.max(...zs) + 20 - bz0) / G);
  const M = T.riverTun = { G, x0: bx0, z0: bz0, nx, nz, mask: new Uint8Array(nx * nz), top: new Float32Array(nx * nz), lid: U.hw + 3.5 };
  const best = new Float32Array(nx * nz).fill(1e9);
  for (let i = 0; i < U.pts.length - 1; i++) {
    if (U.s[i] < U.open[0] || U.s[i + 1] > U.open[1]) continue;
    const [ax, az] = U.pts[i], [bx, bz] = U.pts[i + 1], vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1, r = M.lid + 1;
    for (let gj = Math.floor((Math.min(az, bz) - r - bz0) / G); gj <= Math.ceil((Math.max(az, bz) + r - bz0) / G); gj++)
      for (let gi = Math.floor((Math.min(ax, bx) - r - bx0) / G); gi <= Math.ceil((Math.max(ax, bx) + r - bx0) / G); gi++) {
        if (gi < 0 || gj < 0 || gi >= nx || gj >= nz) continue;
        const x = bx0 + gi * G, z = bz0 + gj * G, t = ((x - ax) * vx + (z - az) * vz) / L2; if (t < -0.02 || t > 1.02) continue; // square ends: the mouths stay open
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t), k = gj * nx + gi;
        if (d < best[k]) best[k] = d;
      }
  }
  for (let k = 0; k < nx * nz; k++) if (best[k] < M.lid) {
    M.mask[k] = best[k] < U.hw ? 1 : 2;
    M.top[k] = Math.max(T.rawH(bx0 + (k % nx) * G, bz0 + Math.floor(k / nx) * G), U.ceil + 1.2);
  }
  for (const R of RIVER.reaches) {
    const Q = R.pts;
    for (let i = 0; i < Q.length - 1; i++) {
      const a = Q[i], b = Q[i + 1], reach = Math.max(a.hw + a.bank, b.hw + b.bank), rc = Math.ceil(reach / c) + 1;
      const cx = Math.round(((a.x + b.x) / 2 - x0) / c), cz = Math.round(((a.z + b.z) / 2 - z0) / c), half = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2 / c);
      const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1;
      for (let dz = -rc - half; dz <= rc + half; dz++) for (let dx = -rc - half; dx <= rc + half; dx++) {
        const gx = cx + dx, gz = cz + dz; if (gx < 0 || gz < 0 || gx >= Nx || gz >= Nz) continue;
        const px = x0 + gx * c, pz = z0 + gz * c, t = clamp(((px - a.x) * vx + (pz - a.z) * vz) / L2, 0, 1);
        const d = Math.hypot(px - a.x - vx * t, pz - a.z - vz * t); if (d > reach) continue;
        const q = { hw: lerp(a.hw, b.hw, t), bank: lerp(a.bank, b.bank, t), wl: lerp(a.wl, b.wl, t), con: a.con || b.con };
        if (d > q.hw + q.bank) continue;
        const gi = gz * Nx + gx, y = riverBed(q, d, T.h[gi]);
        if (y < T.h[gi]) T.h[gi] = y;
        if (d < q.hw + 1 && !T.riverTunAt(px, pz)) T.river[gi] = 255;
      }
    }
  }
}

/* road and rail decks wherever the river cut away the ground under a route: raised overlays that boats pass under */
function findBridges(T) {
  const out = [], Rs = T.routes.filter((R) => !R.def.noCarve && !R.def.trafficOnly);
  const deck = (R, a, b, wet) => {
    const span = { route: R.id, i0: a, i1: b, width: R.width, rail: R.surface === 'rail', pieces: [], piers: [] };
    for (let k = a; k < b; k += 2) {
      const e = Math.min(b, k + 2), dx = R.x[e] - R.x[k], dz = R.z[e] - R.z[k], L = Math.hypot(dx, dz) || 1;
      const y0 = R.y[k], y1 = R.y[e];
      span.pieces.push({ kind: 'slope', x: R.x[k] - dx / L * 0.4, z: R.z[k] - dz / L * 0.4, dx: dx / L, dz: dz / L, L: L + 0.4, Lt: L + 0.8, hw: R.width / 2 + 1.5, y0, y1, under: Math.min(y0, y1) - 3, bridge: true, gap: [false, false] });
    }
    // piers: in the water every 26 m, a pair under a road deck and one under the rail; a viaduct stands on them all the way,
    // except where they would land on a road, the railway or a city street
    const street = (x, z) => cityCell(x, z) > 0 && Math.min(Math.abs(((x - CITY.x0) % CITY.pitch + CITY.pitch) % CITY.pitch - CITY.pitch / 2), Math.abs(((z - CITY.z0) % CITY.pitch + CITY.pitch) % CITY.pitch - CITY.pitch / 2)) > CITY.pitch / 2 - CITY.hw - 3;
    const dry = (x, z) => { const gi = T.gi(x, z); return !T.river[gi] && !T.rown[gi] && !(T.rail[gi] > 0) && !street(x, z); };
    let acc = 13;
    if (wet || R.elev) for (let k = a; k < b; k++) {
      const gi = T.gi(R.x[k], R.z[k]);
      acc += R.step; if (acc < 26 || !(T.river[gi] || (R.elev && R.elev[k] && dry(R.x[k], R.z[k])))) continue;
      acc = 0; const [dx, dz] = R.dirAt(k * R.step);
      for (const l of span.rail ? [0] : [-(R.width / 2 - 2), R.width / 2 - 2]) span.piers.push({ x: R.x[k] - dz * l, z: R.z[k] + dx * l, top: R.y[k] - 0.9, bot: T.h[T.gi(R.x[k] - dz * l, R.z[k] + dx * l)] - 0.5, dx, dz });
    }
    out.push(span); return span;
  };
  // the road deck at (x, z) if a bridge already carries one there at about height y
  const onDeck = (x, z, y) => out.some((B) => B.pieces.some((p) => { const ax = x - p.x, az = z - p.z, u = ax * p.dx + az * p.dz, v = -ax * p.dz + az * p.dx; return u > -2 && u < p.Lt + 2 && Math.abs(v) < p.hw + 3 && Math.abs(y - (p.y0 + p.y1) / 2) < 2.5; }));
  for (const pass of [0, 1]) for (const R of Rs) {
    const N = R.count, cut = new Uint8Array(N + 1);
    for (let i = 0; i <= N; i++) cut[i] = T.rawH(R.x[i], R.z[i]) < R.y[i] - 0.12 ? 1 : 0;
    let i = 0;
    while (i <= N) {
      if (!cut[i]) { i++; continue; }
      let j = i; while (j < N && cut[j + 1]) j++;
      let wet = false; for (let k = i; k <= j; k++) if (T.river[T.gi(R.x[k], R.z[k])]) wet = true;
      // first the spans over water; then dry dips in a road that runs onto one of those decks (a junction at the bridgehead)
      let up = false; if (R.elev) for (let k = i; k <= j; k++) if (R.elev[k]) up = true;
      if (pass === 0 ? wet || up : !wet && j - i < 40 && (onDeck(R.x[Math.max(0, i - 2)], R.z[Math.max(0, i - 2)], R.y[i]) || onDeck(R.x[Math.min(N, j + 2)], R.z[Math.min(N, j + 2)], R.y[j])))
        deck(R, Math.max(0, i - 3), Math.min(N, j + 3), wet);
      i = j + 1;
    }
  }
  // leave the parapet open wherever another road joins at deck level
  for (const B of out) for (const p of B.pieces) for (const R of Rs) {
    if (R.id === B.route) continue;
    for (const [si, side] of [[0, -1], [1, 1]]) {
      const l = side * p.hw, x = p.x - p.dz * l + p.dx * p.Lt / 2, z = p.z + p.dx * l + p.dz * p.Lt / 2, pr = R.project(x, z, 0, -1);
      if (pr.dist < R.width / 2 + 3 && Math.abs(R.y[R.idx(Math.round(pr.s / R.step))] - (p.y0 + p.y1) / 2) < 2.5) p.gap[si] = true;
    }
  }
  return out;
}
