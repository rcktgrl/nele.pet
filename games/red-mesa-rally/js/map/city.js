'use strict';
/* Red Mesa Rally · Port Calder: ramps, raised decks and the deterministic city layout */

/* ---------- City layout (deterministic) ---------- */
/* street kicker: a long run-up, a short deck and a steep back, all raised on the physics ground */
const RAMP = { up: 16, top: 2.5, down: 7, H: 2.4, hw: 3.2 };
function rampLift(r, x, z) { // height above the street at (x, z), or -1 when off this ramp
  const rx = x - r.x, rz = z - r.z, a = rx * r.dx + rz * r.dz, l = Math.abs(rx * r.dz - rz * r.dx);
  if (a < 0 || a > r.L || l > RAMP.hw) return -1;
  const P = RAMP; let h;
  if (a < P.up) h = P.H * Math.pow(a / P.up, 1.25);
  else if (a < P.up + P.top) h = P.H;
  else h = P.H * (1 - (a - P.up - P.top) / P.down);
  return h * clamp((P.hw - l) / 0.6, 0, 1);
}
/* raised drivable ground laid over the terrain: street kickers, roof decks, car-park ramps, the ship */
function overlayLift(o, x, z) { // absolute height, or -Infinity off this piece
  if (o.kind === 'deck') return x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 ? o.y : -Infinity;
  if (o.kind === 'slope') {
    const rx = x - o.x, rz = z - o.z, a = rx * o.dx + rz * o.dz, l = Math.abs(rx * o.dz - rz * o.dx);
    if (a < 0 || a > o.Lt || l > o.hw) return -Infinity;
    return o.y0 + (o.y1 - o.y0) * Math.min(1, a / o.L);
  }
  const l = rampLift(o, x, z); return l > 0 ? o.y + l : -Infinity;
}
function overlayBox(o) {
  if (o.kind === 'deck') return [o.x0, o.z0, o.x1, o.z1];
  const L = o.kind === 'slope' ? o.Lt : o.L, w = o.kind === 'slope' ? o.hw : RAMP.hw, xs = [], zs = [];
  for (const [a, l] of [[0, -w], [0, w], [L, -w], [L, w]]) { xs.push(o.x + o.dx * a + o.dz * l); zs.push(o.z + o.dz * a - o.dx * l); }
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}
class City {
  constructor(T) {
    const rng = mulberry32(2024);
    this.buildings = []; this.lamps = []; this.parkTrees = []; this.containers = []; this.cranes = []; this.palms = [];
    this.decks = []; this.ramps = []; this.carParks = []; this.portals = [];
    const C = CITY, cx = 4210, cz = -250, spurs = metroSpurs();
    for (let bi = 0; bi < C.nx - 1; bi++) for (let bj = 0; bj < C.nz - 1; bj++) {
      const bx0 = C.x0 + bi * C.pitch + C.hw + 4, bz0 = C.z0 + bj * C.pitch + C.hw + 4, size = C.pitch - 2 * (C.hw + 4);
      const kind = cityBlockKind(bi, bj);
      const roof = ROOFTOPS.find((r) => r.bi === bi && r.bj === bj);
      if (roof) { // rooftop car park: one big building, a ramp strip up one side from the south street
        const W = 11, y = CITY.y + roof.h, rx0 = roof.side < 0 ? bx0 : bx0 + size - W;
        const b = { x0: roof.side < 0 ? bx0 + W : bx0, x1: roof.side < 0 ? bx0 + size : bx0 + size - W, z0: bz0, z1: bz0 + size, h: roof.h, style: 'office', tone: 0.5, seed: rng(), deck: true };
        this.buildings.push(b);
        this.decks.push({ kind: 'deck', x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y });
        const sl = { kind: 'slope', x: rx0 + W / 2, z: bz0 + size, dx: 0, dz: -1, L: size - 18, Lt: size, hw: W / 2, y0: CITY.y, y1: y };
        this.decks.push(sl); this.carParks.push({ b, sl, y, side: roof.side });
        continue;
      }
      const sp = spurs.find((q) => q.bi === bi && q.bj === bj);
      if (sp) { // metro portal: one building over the whole block, its ground floor cut through by the ramp
        const g = METRO.rampHw + 0.7, h = 24.5 + Math.round(rng() * 4) * 3.5, tone = rng(), style = rng() < 0.5 ? 'brick' : 'office', along = sp.dx !== 0;
        const lo = (along ? sp.z : sp.x) - g, hi = (along ? sp.z : sp.x) + g;
        const box = (a0, a1, extra) => this.buildings.push(along ? { x0: bx0, x1: bx0 + size, z0: a0, z1: a1, h, style, tone, seed: rng(), ...extra } : { x0: a0, x1: a1, z0: bz0, z1: bz0 + size, h, style, tone, seed: rng(), ...extra });
        box(along ? bz0 : bx0, lo); box(hi, (along ? bz0 : bx0) + size); box(lo, hi, { y0: metroSpurCeil(0) + 0.15, bridge: true });
        this.portals.push(sp);
        continue;
      }
      const mx = bx0 + size / 2, mz = bz0 + size / 2;
      const core = 1 - smooth(150, 700, Math.hypot(mx - cx, (mz - cz) * 1.2));
      if (kind === 'park') {
        for (let k = 0; k < 14; k++) this.parkTrees.push({ x: bx0 + 8 + rng() * (size - 16), z: bz0 + 8 + rng() * (size - 16), s: 0.9 + rng() * 0.6, rot: rng() * TAU, seed: rng() });
        continue;
      }
      const harbourSide = bj >= C.nz - 3 && rng() < 0.6;
      // split the block into lots
      const splitX = rng() < 0.7 ? 2 : 1, splitZ = rng() < (core > 0.5 ? 0.5 : 0.75) ? 2 : 1;
      const gap = 6;
      for (let a = 0; a < splitX; a++) for (let b = 0; b < splitZ; b++) {
        const lw = (size - gap * (splitX - 1)) / splitX, ld = (size - gap * (splitZ - 1)) / splitZ;
        let x0 = bx0 + a * (lw + gap), z0 = bz0 + b * (ld + gap), x1 = x0 + lw, z1 = z0 + ld;
        const inset = 1 + rng() * 4; x0 += inset; z0 += inset; x1 -= inset * (0.5 + rng()); z1 -= inset * (0.5 + rng());
        let style, h;
        if (harbourSide && core < 0.3) { style = 'warehouse'; h = 9 + rng() * 7; }
        else if (core > 0.55 && rng() < 0.75) { style = rng() < 0.55 ? 'glass' : 'office'; h = 45 + core * 120 * (0.45 + rng() * 0.75); }
        else if (core > 0.2) { style = rng() < 0.5 ? 'office' : 'brick'; h = 16 + rng() * 34 + core * 20; }
        else { style = rng() < 0.65 ? 'brick' : 'office'; h = 10 + rng() * 18; }
        const tone = rng();
        this.buildings.push({ x0, x1, z0, z1, h: Math.round(h / 3.5) * 3.5 + 1, style, tone, seed: rng() });
        // stepped towers get a setback crown
        if ((style === 'glass' || style === 'office') && h > 60 && rng() < 0.6) {
          const m = Math.min(x1 - x0, z1 - z0) * 0.18;
          this.buildings.push({ x0: x0 + m, x1: x1 - m, z0: z0 + m, z1: z1 - m, h: Math.round(h * (1.15 + rng() * 0.2) / 3.5) * 3.5 + 1, style, tone, seed: rng(), crown: true });
        }
      }
    }
    // street lights along every street, both sides
    const clearOf = (v, v0) => { const l = (((v - v0) % C.pitch) + C.pitch) % C.pitch; return l > 16 && l < C.pitch - 16; };
    const lamp = (x, z, yaw, along, a0) => { if (clearOf(along, a0)) this.lamps.push({ x, z, yaw }); };
    for (let i = 0; i < C.nx; i++) for (let z = C.z0 + 20; z < C.z1 - 10; z += 42) { lamp(CX(i) - C.hw - 1.6, z, 0, z, C.z0); lamp(CX(i) + C.hw + 1.6, z + 21, Math.PI, z + 21, C.z0); }
    for (let j = 0; j < C.nz; j++) for (let x = C.x0 + 20; x < C.x1 - 10; x += 42) { lamp(x, CZ(j) - C.hw - 1.6, Math.PI / 2, x, C.x0); lamp(x + 21, CZ(j) + C.hw + 1.6, -Math.PI / 2, x + 21, C.x0); }
    this.lamps = this.lamps.filter((l) => !spurs.some((sp) => Math.hypot(l.x - sp.x, l.z - sp.z) < 10));
    // container yard on the docks, either side of the rail spur
    const colors = [0xb5442a, 0x1f5f8b, 0x2f7a4a, 0xd6a02b, 0x7a7f86, 0x8a2d5a, 0xc8c2b4];
    for (const [zr0, zr1] of [[DOCKS.z0 + 18, 572], [628, 760]]) {
      for (let x = 3540; x < 5020; x += 15) {
        if (rng() < 0.18) { x += 20; continue; }
        if (x > 4130 && x < 4230) continue; // keep the coast road clear
        for (let z = zr0; z + 2.6 < zr1; z += 3.1) {
          if (rng() < 0.25) continue;
          let blocked = false;
          for (const [px, pz] of [[x, z], [x + 6, z + 1.2], [x + 12.2, z + 2.5], [x + 12.2, z], [x, z + 2.5]]) { const gi = T.gi(px, pz); if (T.rdist[gi] < 13 || T.h[gi] < CITY.y - 0.5 || T.rail[gi] > 0 || T.bilinear(T.rail, px, pz + 4) > 0 || T.bilinear(T.rail, px, pz - 4) > 0) blocked = true; }
          if (blocked) continue;
          const n = 1 + Math.floor(rng() * 4);
          this.containers.push({ x0: x, x1: x + 12.2, z0: z, z1: z + 2.5, h: n * 2.6, n, color: colors[Math.floor(rng() * colors.length)] });
        }
      }
    }
    // kicker ramps down the middle of quiet streets (never on a race route or the rail)
    const L = RAMP.up + RAMP.top + RAMP.down, cand = [];
    for (let i = 0; i < C.nx; i++) for (let j = 0; j < C.nz - 1; j++) cand.push([CX(i), CZ(j) + C.pitch / 2, 0, 1]);
    for (let j = 0; j < C.nz; j++) for (let i = 0; i < C.nx - 1; i++) cand.push([CX(i) + C.pitch / 2, CZ(j), 1, 0]);
    for (let k = cand.length - 1; k > 0; k--) { const q = Math.floor(rng() * (k + 1)); [cand[k], cand[q]] = [cand[q], cand[k]]; }
    for (const [mx, mz, ax, az] of cand) {
      if (this.ramps.length >= 14) break;
      let ok = true;
      for (let d = -L / 2 - 6; d <= L / 2 + 6; d += 4) for (const l of [-5, 0, 5]) { const px = mx + ax * d - az * l, pz = mz + az * d + ax * l, gi = T.gi(px, pz); if (T.rdist[gi] < 18 || T.rail[gi] > 0) ok = false; }
      if (!ok || this.ramps.some((r) => Math.hypot(r.cx - mx, r.cz - mz) < 260)) continue;
      const sg = rng() < 0.5 ? 1 : -1, dx = ax * sg, dz = az * sg;
      this.ramps.push({ cx: mx, cz: mz, x: mx - dx * L / 2, z: mz - dz * L / 2, dx, dz, y: CITY.y, L });
    }
    // the roof-to-roof jump: a kicker on the high roof aimed across the street at the low one
    { const [A, B] = this.carParks, dir = Math.sign((B.b.x0 + B.b.x1) - (A.b.x0 + A.b.x1)), edge = dir > 0 ? A.b.x1 : A.b.x0, zc = (A.b.z0 + A.b.z1) / 2;
      this.ramps.push({ cx: edge - dir * L / 2, cz: zc, x: edge - dir * L, z: zc, dx: dir, dz: 0, y: A.y, L, roof: true }); }
    // the ship: deck, a ramp up from the quay, and container stacks in bays with lanes between them
    this.decks.push({ kind: 'deck', x0: SHIP.x0, x1: SHIP.x1, z0: SHIP.z0, z1: SHIP.z1 - 14, y: SHIP.y });
    this.decks.push({ kind: 'slope', x: SHIP.rampX0, z: SHIP.rampZ, dx: 1, dz: 0, L: SHIP.x0 - SHIP.rampX0, Lt: SHIP.x0 - SHIP.rampX0 + 1, hw: SHIP.rampHw, y0: CITY.y, y1: SHIP.y, ship: true });
    this.shipBoxes = [];
    for (const [x0, x1] of [[SHIP.x0 + 4, SHIP.x0 + 16.2], [SHIP.x1 - 16.2, SHIP.x1 - 4]]) {
      for (let zb = SHIP.z0 + 34; zb < SHIP.z1 - 30; zb += 24) for (let k = 0; k < 5; k++) {
        const z = zb + k * 3.1;
        if (x0 < SHIP.x0 + 10 && z > SHIP.rampZ - SHIP.rampHw - 6 && z < SHIP.rampZ + SHIP.rampHw + 4) continue; // keep the ramp mouth clear
        if (rng() < 0.12) continue;
        const n = 1 + Math.floor(rng() * 3);
        this.containers.push({ x0, x1, z0: z, z1: z + 2.5, h: n * 2.6, n, y: SHIP.y, color: colors[Math.floor(rng() * colors.length)] });
      }
    }
    for (let k = 0; k < 4; k++) if (T.h[T.gi(3700 + k * 380, 792)] > CITY.y - 0.5) this.cranes.push({ x: 3700 + k * 380, z: 792, yaw: 0, color: k % 2 ? 0xd94c22 : 0xe0b020 });
    for (let k = 0; k < 3; k++) this.cranes.push({ x: 5136, z: -500 + k * 260, yaw: Math.PI / 2, color: 0xd94c22 });
  }
}
