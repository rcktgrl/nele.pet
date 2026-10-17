'use strict';
/* Red Mesa Rally · Static obstacles, scenery scatter and knock-over props */

/* ---------- Static obstacles + scenery ---------- */
class Scatter {
  constructor(T, city) {
    this.T = T; this.city = city;
    this.rocks = []; this.trees = []; this.bushes = []; this.cacti = []; this.pines = []; this.oaks = []; this.grassBush = []; this.granite = []; this.palms = [];
    this.obstacles = [];
    this.grid = new Map(); this.G = 24;
  }
  *build() {
    const T = this.T, rng = mulberry32(7);
    const nrm = { x: 0, y: 0, z: 0 };
    const slopeAt = (x, z) => { T.normal(x, z, nrm); return nrm.y; };
    const okDesert = (x, z, clear) => {
      if (Math.hypot(x, z) > 940) return false;
      if (T.rdist[T.gi(x, z)] < clear) return false;
      if (T.height(x, z) < WATER_Y + 0.6) return false;
      if (Math.hypot(x - HUB.x, z - HUB.z) < HUB.r + 20) return false;
      return true;
    };
    const R2 = 1000;
    for (let i = 0; i < 1400; i++) {
      const x = (rng() * 2 - 1) * R2, z = (rng() * 2 - 1) * R2;
      const big = rng() < 0.25, s = big ? 2.2 + rng() * 3.5 : 0.6 + rng() * 1.4;
      if (!okDesert(x, z, 17 + s)) continue;
      const ny = slopeAt(x, z); if (ny < 0.55 && rng() < 0.6) continue;
      const y = T.height(x, z);
      this.rocks.push({ x, z, y: y - s * 0.25, s, rot: rng() * TAU, tilt: rng() * 0.4, seed: rng() });
      if (s > 0.9) this.addObstacle(x, z, s * 0.85, y + s * 1.2, 'rock');
    }
    for (const m of MESAS) for (let i = 0; i < (m.spire ? 18 : 60); i++) {
      const a = rng() * TAU, d = m.r * (0.98 + rng() * 0.45);
      const x = m.x + Math.cos(a) * d, z = m.z + Math.sin(a) * d;
      const s = 1.5 + rng() * 4.5, y = T.height(x, z);
      if (!okDesert(x, z, 17 + s)) continue;
      this.rocks.push({ x, z, y: y - s * 0.3, s, rot: rng() * TAU, tilt: rng() * 0.5, seed: rng() });
      this.addObstacle(x, z, s * 0.85, y + s, 'rock');
    }
    for (let i = 0; i < 2200 && this.trees.length < 700; i++) {
      const x = (rng() * 2 - 1) * R2, z = (rng() * 2 - 1) * R2;
      if (Noise.fbm(x / 160 + 40, z / 160, 2) < 0.05) continue;
      if (!okDesert(x, z, 15) || slopeAt(x, z) < 0.8) continue;
      const s = 0.8 + rng() * 0.9, y = T.height(x, z);
      this.trees.push({ x, z, y, s, rot: rng() * TAU, seed: rng() });
      this.addObstacle(x, z, 0.45 * s, y + 4 * s, 'tree');
    }
    for (let i = 0; i < 9000 && this.bushes.length < 5200; i++) {
      const x = (rng() * 2 - 1) * R2, z = (rng() * 2 - 1) * R2;
      if (!okDesert(x, z, 9.5) || slopeAt(x, z) < 0.75) continue;
      if (Noise.fbm(x / 90 - 3, z / 90 + 8, 2) < -0.15 && rng() < 0.7) continue;
      this.bushes.push({ x, z, y: T.height(x, z), s: 0.5 + rng() * 0.9, rot: rng() * TAU, seed: rng() });
    }
    for (let i = 0; i < 600 && this.cacti.length < 140; i++) {
      const x = (rng() * 2 - 1) * R2, z = (rng() * 2 - 1) * R2;
      if (!okDesert(x, z, 15)) continue;
      const y = T.height(x, z);
      this.cacti.push({ x, z, y, s: 0.8 + rng() * 0.7, rot: rng() * TAU, seed: rng() });
      this.addObstacle(x, z, 0.3, y + 3, 'tree');
    }
    yield 'Planting Kestrel Pines';
    // ---- east: forests, groves, scrub, granite ----
    const okEast = (x, z, clear) => {
      if (x < 1250) return false;
      const gi = T.gi(x, z);
      if (T.rdist[gi] < clear || T.rail[gi] > 0 || T.city[gi] || T.tun[gi]) return false;
      const y = T.h[gi]; if (y < WATER_Y + 1.5) return false;
      if (eastSDF(x, z).d > -10) return false;
      return true;
    };
    for (let i = 0; i < 90000 && this.pines.length < 9000; i++) {
      const x = 1300 + rng() * 3900, z = -2900 + rng() * 2300;
      const gi = T.gi(x, z), f = T.forest[gi] / 255;
      const dens = f * 0.9 + 0.25 * smooth(0.2, 0.6, Noise.fbm(x / 240 + 3, z / 240, 3));
      if (rng() > dens) continue;
      if (!okEast(x, z, 13) || slopeAt(x, z) < 0.72) continue;
      const s = 0.8 + rng() * 0.8, y = T.h[gi];
      this.pines.push({ x, z, y, s, rot: rng() * TAU, seed: rng() });
      this.addObstacle(x, z, 0.5 * s, y + 9 * s, 'tree');
    }
    for (let i = 0; i < 30000 && this.oaks.length < 1800; i++) {
      const x = 1300 + rng() * 3900, z = -1700 + rng() * 3000;
      const gi = T.gi(x, z), g = T.green[gi] / 255;
      if (g < 0.35 || rng() > g * smooth(0.0, 0.5, Noise.fbm(x / 300 - 8, z / 300 + 2, 3))) continue;
      if (!okEast(x, z, 14) || slopeAt(x, z) < 0.85) continue;
      const s = 0.9 + rng() * 0.8, y = T.h[gi];
      this.oaks.push({ x, z, y, s, rot: rng() * TAU, seed: rng() });
      this.addObstacle(x, z, 0.5 * s, y + 6 * s, 'tree');
    }
    for (let i = 0; i < 40000 && this.grassBush.length < 9000; i++) {
      const x = 1200 + rng() * 4000, z = -2800 + rng() * 4000;
      if (!okEast(x, z, 10) || slopeAt(x, z) < 0.75) continue;
      const gi = T.gi(x, z);
      this.grassBush.push({ x, z, y: T.h[gi], s: 0.5 + rng() * 0.9, rot: rng() * TAU, seed: rng(), g: T.green[gi] / 255 });
    }
    for (let i = 0; i < 20000 && this.granite.length < 1300; i++) {
      const x = 1200 + rng() * 4000, z = -2900 + rng() * 2600;
      if (!okEast(x, z, 16)) continue;
      const ny = slopeAt(x, z); if (ny > 0.92 && rng() < 0.85) continue;
      const big = rng() < 0.3, s = big ? 2 + rng() * 4 : 0.7 + rng() * 1.3, y = T.height(x, z);
      this.granite.push({ x, z, y: y - s * 0.25, s, rot: rng() * TAU, tilt: rng() * 0.4, seed: rng() });
      if (s > 0.9) this.addObstacle(x, z, s * 0.85, y + s * 1.2, 'rock');
    }
    // palms along the coast road and the harbour front
    const coast = T.routes.find((r) => r.id === 'coast');
    for (let s = 300; s < coast.length - 200; s += 34 + rng() * 30) {
      const p = coast.posAt(s, {}), [dx, dz] = coast.dirAt(s), side = rng() < 0.5 ? -1 : 1, off = coast.width / 2 + 5 + rng() * 4;
      const x = p.x - dz * side * off, z = p.z + dx * side * off;
      const y = T.height(x, z); if (y < WATER_Y + 0.8) continue;
      this.palms.push({ x, z, y, s: 0.9 + rng() * 0.4, rot: rng() * TAU, lean: 0.05 + rng() * 0.15, seed: rng() });
      this.addObstacle(x, z, 0.35, y + 9, 'tree');
    }
    yield 'Raising the skyline';
    // city obstacles
    const C = this.city;
    for (const b of C.buildings) if (!b.crown && !b.bridge) this.addBox(b.x0, b.z0, b.x1, b.z1, CITY.y + b.h - (b.deck ? 1.2 : 0), 'building'); // roof decks sit under the wheels
    for (const k of C.containers) this.addBox(k.x0, k.z0, k.x1, k.z1, (k.y ?? CITY.y) + k.h, 'container');
    for (const l of C.lamps) this.addObstacle(l.x, l.z, 0.22, CITY.y + 8, 'pole');
    for (const t of C.parkTrees) this.addObstacle(t.x, t.z, 0.45 * t.s, CITY.y + 6, 'tree');
    for (const c of C.cranes) {
      const ca = Math.cos(c.yaw), sa = Math.sin(c.yaw);
      for (const [lx, lz] of [[-9, -6], [9, -6], [-9, 6], [9, 6]]) this.addObstacle(c.x + lx * ca - lz * sa, c.z + lx * sa + lz * ca, 0.8, CITY.y + 40, 'crane');
    }
    // guard rails on the highways (gaps at junctions and level crossings)
    const near = new Map(), key = (x, z) => Math.floor(x / 30) * 100000 + Math.floor(z / 30);
    for (const R of T.routes) { if (R.def.noCarve) continue; for (let i = 0; i <= R.count; i += 4) { const k = key(R.x[i], R.z[i]); let set = near.get(k); if (!set) near.set(k, set = new Set()); set.add(R.id); } }
    const crowded = (x, z, self) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const set = near.get(key(x + a * 30, z + b * 30)); if (set) for (const id of set) if (id !== self) { const o = T.routes.find((r) => r.id === id); if (o.project(x, z, 0, -1).dist < 45) return true; } } return false; };
    this.railSegs = [];
    for (const R of T.routes) {
      if (!R.def.rails) continue;
      const step = 8, off = R.width / 2 + 1.4;
      let skipUntil = -1;
      for (let s = 0; s + step <= R.length; s += step) {
        const p = R.posAt(s, {}), q = R.posAt(s + step, {});
        if (s > skipUntil && crowded(p.x, p.z, R.id)) skipUntil = s + 60;
        if (s <= skipUntil) continue;
        const [dx, dz] = R.dirAt(s), [ex, ez] = R.dirAt(s + step);
        // rails only where the road sits on an embankment or the drop is real
        for (const side of [-1, 1]) {
          const ax = p.x - dz * side * off, az = p.z + dx * side * off, bx = q.x - ez * side * off, bz = q.z + ex * side * off;
          const drop = p.y - T.height(p.x - dz * side * (off + 6), p.z + dx * side * (off + 6));
          if (R.id !== 'hwy' && drop < 2.5 && Math.abs(drop) < 3) continue;
          this.railSegs.push({ ax, az, ay: p.y, bx, bz, by: q.y });
          this.addSegment(ax, az, bx, bz, Math.max(p.y, q.y) + 0.9, 'rail');
        }
      }
    }
  }
  key(ix, iz) { return ix * 8192 + iz; }
  insert(o, x0, z0, x1, z1) {
    const G = this.G;
    for (let ix = Math.floor(x0 / G); ix <= Math.floor(x1 / G); ix++) for (let iz = Math.floor(z0 / G); iz <= Math.floor(z1 / G); iz++) {
      const k = this.key(ix + 4096, iz + 4096); let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); } a.push(o);
    }
  }
  addObstacle(x, z, r, top, kind) { const o = { type: 0, x, z, r, top, kind }; this.obstacles.push(o); this.insert(o, x - r, z - r, x + r, z + r); return o; }
  addBox(x0, z0, x1, z1, top, kind) { const o = { type: 1, x0, z0, x1, z1, x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2, top, kind }; this.obstacles.push(o); this.insert(o, x0, z0, x1, z1); return o; }
  addSegment(ax, az, bx, bz, top, kind) { const o = { type: 2, ax, az, bx, bz, x: (ax + bx) / 2, z: (az + bz) / 2, r: 0.25, top, kind }; this.insert(o, Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1); return o; }
  near(x, z) { return this.grid.get(this.key(Math.floor(x / this.G) + 4096, Math.floor(z / this.G) + 4096)) || null; }
}

/* Knock-over props: barrels, tyre stacks, crates along corners; cones on the city circuit */
class Props {
  constructor(T) {
    this.T = T; this.list = [];
    const rng = mulberry32(99);
    for (const R of T.routes) {
      if (R.def.trail || R.def.country || R.def.noCarve || R.surface === 'rail' || (R.surface === 'asphalt' && !R.def.street)) continue;
      for (let i = 0; i < R.count; i += 6) {
        const k = R.curv[i];
        if (Math.abs(k) < 0.012 || rng() < 0.45) continue;
        const [dx, dz] = R.dirAt(i * R.step);
        const side = k > 0 ? -1 : 1;
        const off = R.width / 2 + (R.def.street ? 0.5 : 2.5 + rng() * 2);
        const x = R.x[i] + (-dz) * side * off, z = R.z[i] + dx * side * off;
        const kind = R.def.street ? (rng() < 0.6 ? 1 : 0) : rng() < 0.55 ? 0 : (rng() < 0.6 ? 1 : 2);
        const n = kind === 1 ? 1 : 1 + Math.floor(rng() * 3);
        for (let m = 0; m < n; m++) this.add(x + dx * m * 1.3, z + dz * m * 1.3, kind, rng);
      }
    }
    for (let i = 0; i < 40; i++) { const a = rng() * TAU, d = 30 + rng() * 45; this.add(HUB.x + Math.cos(a) * d, HUB.z + Math.sin(a) * d, Math.floor(rng() * 3), rng); }
  }
  add(x, z, kind, rng) {
    const y = this.T.height(x, z);
    const r = kind === 0 ? 0.42 : kind === 1 ? 0.55 : 0.5, hh = kind === 0 ? 0.6 : kind === 1 ? 0.55 : 0.5;
    this.list.push({ kind, x, y: y + hh, z, r, hh, vx: 0, vy: 0, vz: 0, rx: 0, ry: rng() * TAU, rz: 0, wx: 0, wy: 0, wz: 0, active: false, rest: true, home: [x, y + hh, z] });
  }
  update(dt) {
    const T = this.T;
    for (const p of this.list) {
      if (!p.active) continue;
      p.vy -= 9.81 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
      const g = T.height(p.x, p.z) + p.r * 0.8;
      if (p.y < g) { p.y = g; if (p.vy < 0) p.vy *= -0.3; p.vx *= 0.8; p.vz *= 0.8; p.wx *= 0.8; p.wz *= 0.8; p.wy *= 0.8; }
      if (Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz) < 0.4 && p.y - g < 0.05) p.active = false;
    }
  }
}

'use strict';
