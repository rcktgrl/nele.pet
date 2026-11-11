'use strict';
/* Red Mesa Rally · the suburbs' landmarks: Mesa View Mall and its car park, Kestrel Skate Park, Marina High with its
   field, track and bus loop. The sites themselves are set out in DISTRICT.sites, so the streets and houses keep clear */

/* skate park concrete: raised drivable shapes with no wall anywhere, every edge runs out in a bank.
   qp: a quarter pipe climbing along (dx, dz) to a deck, a bank down its back and its sides
   bowl: a mound with a bowl sunk in it, round or (L > 0) stretched along (dx, dz)
   box: a flat-topped pyramid; roll: a row of rollers */
function skateLift(o, x, z) {
  const rx = x - o.x, rz = z - o.z; let h;
  if (o.shape === 'bowl') {
    const t = clamp(rx * o.dx + rz * o.dz, 0, o.L), r = Math.hypot(rx - o.dx * t, rz - o.dz * t) - o.r0;
    h = r < 0 ? 0 : r < o.A ? o.R - Math.sqrt(o.R * o.R - r * r) : r < o.A + o.W ? o.H : o.H * (1 - (r - o.A - o.W) / o.B);
  } else {
    const a = rx * o.dx + rz * o.dz, l = Math.abs(rx * o.dz - rz * o.dx);
    if (o.shape === 'qp') {
      if (a < 0 || l > o.hw + o.B) return -Infinity;
      h = (a < o.A ? o.R - Math.sqrt(o.R * o.R - a * a) : a < o.A + o.D ? o.H : o.H * (1 - (a - o.A - o.D) / o.B)) * clamp((o.hw + o.B - l) / o.B, 0, 1);
    } else if (o.shape === 'box') h = o.H * (1 - Math.max(Math.abs(a) - o.hl, l - o.hw, 0) / o.B);
    else { if (a < 0 || a > o.L) return -Infinity; const q = Math.sin(Math.PI * a / o.P); h = o.H * q * q * clamp((o.hw + o.B - l) / o.B, 0, 1); }
  }
  return h > 0.001 ? o.y + h : -Infinity;
}
function skatePiece(o) {
  o.kind = 'skate'; o.surf = 'asphalt';
  if (o.R) o.A = Math.sqrt(o.R * o.R - (o.R - o.H) * (o.R - o.H)); // how far out a transition of radius R reaches before it is H up
  let x0, z0, x1, z1;
  if (o.shape === 'bowl') { const r = o.r0 + o.A + o.W + o.B, ex = o.x + o.dx * o.L, ez = o.z + o.dz * o.L; x0 = Math.min(o.x, ex) - r; x1 = Math.max(o.x, ex) + r; z0 = Math.min(o.z, ez) - r; z1 = Math.max(o.z, ez) + r; }
  else {
    const [a0, a1] = o.shape === 'qp' ? [0, o.A + o.D + o.B] : o.shape === 'box' ? [-o.hl - o.B, o.hl + o.B] : [0, o.L], w = o.hw + o.B, xs = [], zs = [];
    for (const a of [a0, a1]) for (const l of [-w, w]) { xs.push(o.x + o.dx * a + o.dz * l); zs.push(o.z + o.dz * a - o.dx * l); }
    x0 = Math.min(...xs); x1 = Math.max(...xs); z0 = Math.min(...zs); z1 = Math.max(...zs);
  }
  o.box = [x0, z0, x1, z1];
  return o;
}

Object.assign(City.prototype, {
  buildLandmarks(T, CAR_COLS) {
    const rng = mulberry32(606), site = (id) => DISTRICT.sites.find((s) => s.id === id);
    const bld = (x, z, yaw, w, d, h, style, tone) => { const y = T.rawH(x, z), b = boxAabb({ x, z, yaw, w, d, h, base: y, y0: y - 0.8, style, tone, seed: rng(), landmark: true }); this.buildings.push(b); return b; };
    // a double row of parking bays along x, cars in some of them
    const row = (x0, x1, zr, fill, van = 0.12) => {
      const n = Math.floor((x1 - x0 - 2) / 2.7), w = n * 2.7 + 2, x = (x0 + x1) / 2;
      this.lots.push({ x, z: zr, yaw: 0, w, d: 17, y: T.rawH(x, zr), rows: [{ b: -6 }, { b: 6 }] });
      for (let k = 0; k < n; k++) for (const b of [-6, 6]) if (rng() < fill) { const xc = x - w / 2 + 1 + 1.35 + k * 2.7; this.parked.push({ x: xc, z: zr + b, y: T.rawH(xc, zr + b), yaw: (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.08, col: CAR_COLS[(rng() * CAR_COLS.length) | 0], van: rng() < van }); }
    };
    const hedge = (ax, az, bx, bz, kind = 'hedge') => this.fences.push({ ax, az, bx, bz, y: T.rawH(ax, az), kind });
    const lamp = (x, z, yaw) => this.lamps.push({ x, z, y: T.rawH(x, z), yaw });

    /* ---- Mesa View Mall: a long concourse between two department stores, a glass atrium on the car park side,
       and the car park itself all the way down to Mesa Blvd ---- */
    { const M = site('mall'), cx = (M.x0 + M.x1) / 2, front = M.z0 + 54;
      bld(cx, M.z0 + 23, 0, 210, 38, 9.5, 'mall', 0.1);
      const west = bld(M.x0 + 36, M.z0 + 29, 0, 62, 50, 13.5, 'mall', 0.45), east = bld(M.x1 - 36, M.z0 + 29, 0, 62, 50, 13.5, 'mall', 0.8);
      const atrium = bld(cx, M.z0 + 47, 0, 36, 14, 15, 'glass', 0.5);
      const aisles = [cx - 83, cx, cx + 83], edges = [M.x0 + 8, ...aisles.flatMap((a) => [a - (a === cx ? 7 : 4.5), a + (a === cx ? 7 : 4.5)]), M.x1 - 8];
      let k = 0;
      for (let zr = front + 19; zr + 8.5 < M.z1 - 3; zr += 23, k++) {
        for (let e = 0; e < edges.length; e += 2) row(edges[e], edges[e + 1], zr, 0.62 - 0.11 * k - 0.08 * Math.abs(e - 3) / 3);
        if (zr + 23 + 8.5 < M.z1 - 3) for (const a of aisles) lamp(a + (a === cx ? 7.5 : 5), zr + 11.5, Math.PI);
      }
      // hedges round the lot, open where the aisles meet the boulevard and half way down either side
      const s = M.z1 - 1.5, gaps = aisles.map((a) => [a - (a === cx ? 8 : 6), a + (a === cx ? 8 : 6)]);
      let x = M.x0 + 1; for (const [g0, g1] of gaps) { hedge(x, s, g0, s); x = g1; } hedge(x, s, M.x1 - 1, s);
      for (const xe of [M.x0 + 1, M.x1 - 1]) { hedge(xe, M.z0 + 1, xe, front + 26); hedge(xe, front + 38, xe, s); }
      hedge(M.x0 + 1, M.z0 + 1, M.x1 - 1, M.z0 + 1);
      this.mall = { name: M.name, x: cx, z: atrium.z + 7, y: atrium.base, top: atrium.base + atrium.h, pylon: { x: cx + 13, z: M.z1 - 6, y: T.rawH(cx + 13, M.z1 - 6) },
        stores: [{ x: west.x, z: west.z + 25, y: west.base + 9.6, name: 'CALDER & SONS' }, { x: east.x, z: east.z + 25, y: east.base + 9.6, name: 'DUNE OUTFITTERS' }] };
    }

    /* ---- Kestrel Skate Park: one long strip of concrete at the foot of the Heights, built big enough to drive:
       a quarter pipe at each end facing down the park, two bowls, a pyramid and a line of rollers between ---- */
    { const K = site('skate'), y = CITY.y, zc = (K.z0 + K.z1) / 2, P = [];
      P.push(skatePiece({ shape: 'qp', x: K.x0 + 29, z: zc, dx: -1, dz: 0, y, hw: 17, R: 9, H: 3.2, D: 5, B: 7 }));
      P.push(skatePiece({ shape: 'qp', x: K.x1 - 29, z: zc, dx: 1, dz: 0, y, hw: 17, R: 9, H: 3.2, D: 5, B: 7 }));
      P.push(skatePiece({ shape: 'box', x: K.x0 + 62, z: zc + 9, dx: 1, dz: 0, y, hl: 5, hw: 3.5, H: 1.5, B: 6 }));
      P.push(skatePiece({ shape: 'bowl', x: K.x0 + 100, z: zc - 3, dx: 1, dz: 0, L: 16, y, r0: 7, R: 8, H: 2.7, W: 3, B: 6.5 }));
      P.push(skatePiece({ shape: 'roll', x: K.x0 + 142, z: zc + 14, dx: 1, dz: 0, L: 30, P: 10, y, hw: 4.5, H: 1.1, B: 3 }));
      P.push(skatePiece({ shape: 'box', x: K.x0 + 157, z: zc - 14, dx: 1, dz: 0, y, hl: 9, hw: 2.5, H: 1.0, B: 4.5 }));
      P.push(skatePiece({ shape: 'bowl', x: K.x0 + 196, z: zc + 2, dx: 1, dz: 0, L: 0, y, r0: 5, R: 9, H: 3.3, W: 3, B: 7 }));
      const rails = [[K.x0 + 62, zc - 14, 12], [K.x0 + 128, zc - 2, 10], [K.x0 + 174, zc + 12, 9]].map(([x, z, L]) => ({ ax: x - L / 2, az: z, bx: x + L / 2, bz: z, y, h: 0.55 }));
      this.skate = { name: K.name, site: K, y, pieces: P, rails, gate: { x: K.x0 + 124, z: K.z1 - 2 } };
      for (const x of [K.x0 + 40, K.x0 + 124, K.x1 - 40]) { lamp(x, K.z0 + 2, Math.PI / 2); lamp(x + 42, K.z1 - 2, -Math.PI / 2); }
    }

    /* ---- Marina High: the main block faces the bus loop on the ring street, a clock tower over its doors, a wing at each end,
       the gym behind, and the track round the playing field ---- */
    { const S = site('school'), L = S.loop, fx = L.x + L.rx + 22, zc = L.z; // fx: the front wall
      const main = bld(fx + 8, zc, Math.PI / 2, 92, 16, 8, 'brick', 0.3);
      bld(fx + 28, zc - 39, 0, 24, 14, 8, 'brick', 0.3); bld(fx + 28, zc + 39, 0, 24, 14, 8, 'brick', 0.3);
      const tower = bld(fx - 2.5, zc, 0, 7, 7, 19, 'brick', 0.05);
      const gym = bld(fx + 72, S.z0 + 20, 0, 44, 26, 11, 'warehouse', 0.4);
      const tr = { x: S.x1 - 78, z: zc + 8, L: 30, r: 33, w: 8, y: T.rawH(S.x1 - 78, zc + 8) }; // straights along x, half length L; r is the outer radius
      row(S.x0 + 68, S.x1 - 10, S.z1 - 14.5, 0.5, 0.1);
      const buses = [-30, -17, 22].map((dz) => ({ x: L.x + L.rx + 6.2, z: zc + dz, yaw: 0, y: T.rawH(L.x + L.rx + 6.2, zc + dz) }));
      const stand = { x: tr.x, z: tr.z - tr.r - 6.5, w: 46, d: 6, h: 3.6, y: tr.y };
      this.school = { name: S.name, site: S, loop: L, main, tower: { x: tower.x, z: tower.z, y: tower.base + tower.h, w: 7 }, gym, track: tr, buses, stand,
        sign: { x: L.x, z: zc, y: T.rawH(L.x, zc) }, flag: { x: fx - 6, z: zc - 14, y: T.rawH(fx - 6, zc - 14) },
        goals: [-1, 1].map((sd) => ({ x: tr.x + sd * (tr.L + 12), z: tr.z, sd })), board: { x: tr.x + tr.L + tr.r + 5, z: tr.z, y: tr.y } };
      for (const dz of [-34, 34]) lamp(L.x + L.rx + 4.5, zc + dz, 0);
      hedge(S.x0 + 60, S.z1 - 1, S.x1 - 1, S.z1 - 1, 'chain'); hedge(S.x1 - 1, S.z0 + 1, S.x1 - 1, S.z1 - 1, 'chain'); hedge(fx + 44, S.z0 + 1, S.x1 - 1, S.z0 + 1, 'chain');
    }
  },
});
