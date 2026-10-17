'use strict';
/* Red Mesa Rally · Civilian traffic on the public roads */

/* ---------------- Traffic: civilians on the public roads ---------------- */
// [route, cars, lane offset (m, right of centre), cruise speed (m/s)]
const TRAFFIC_PLAN = [['hwy', 4, 5.5, 27], ['hwy-rev', 4, 5.5, 27], ['coast', 2, 3.6, 22], ['coast-rev', 2, 3.6, 22], ['tunnel', 1, 3.2, 21], ['tunnel-rev', 1, 3.2, 21],
  ['pass', 1, 2.6, 15], ['pass-rev', 1, 2.6, 15], ['lane-valley', 1, 2.3, 16], ['lane-valley-rev', 1, 2.3, 16], ['lane-farm', 1, 2.3, 16], ['lane-farm-rev', 1, 2.3, 16],
  ['city-a', 2, 4.8, 13], ['city-a-rev', 1, 4.8, 13], ['city-b', 2, 4.8, 13], ['city-c', 1, 4.8, 13], ['city-c-rev', 1, 4.8, 13], ['city-d', 2, 4.8, 13],
  ['exit-5', 2, 3.2, 22], ['exit-5-rev', 1, 3.2, 22], ['lane-orchard', 1, 2.4, 16], ['lane-orchard-rev', 1, 2.4, 16], ['lane-mill', 1, 2.3, 16], ['lane-mill-rev', 1, 2.3, 16]];
const TRAFFIC_COLORS = [0x8a9aa6, 0x6b2d2d, 0xe9e2d6, 0x2b3a4a, 0x9c8a64, 0x3d5a3d, 0xc9c4ba, 0x23262b, 0x7a1f1f, 0x4a6a8a];
class Traffic {
  constructor(game) { this.g = game; this.list = []; this.WAKE = 520; this.SLEEP = 650; }
  spawn() {
    this.clear();
    const g = this.g, W = g.world; let n = 0;
    for (const [rid, count, lane, vcap] of TRAFFIC_PLAN) {
      const R = W.route(rid); if (!R) continue;
      for (let k = 0; k < count; k++, n++) {
        const s = R.length * (k + 0.35 + 0.3 * hash2(n, 7)) / count, v = (n % 3 === 1) ? 'van' : 'sedan';
        const car = g.addCar(VEHICLES[v], { id: 80 + n, color: TRAFFIC_COLORS[n % TRAFFIC_COLORS.length], number: 100 + n, livery: v === 'van' ? ['MESA HAULER', 'CALDER POST', 'KRMR 98.7'][n % 3] : 'CALDER COUNTY', helmet: 0x3a3330 });
        car.name = v === 'van' ? 'Delivery van' : 'Local driver'; car.civilian = true;
        const a = new AIDriver(car, R, { s, lane, skill: 0.8 + 0.1 * hash2(n, 3), vcap: vcap * (0.85 + 0.25 * hash2(n, 11)), traffic: true, seed: 300 + n });
        a.cruise = a.vcap * 0.9; a.asleepS = s;
        this.place(a, true);
        car.asleep = true;
        this.list.push(a);
      }
    }
  }
  clear() { for (const a of this.list) this.g.removeCar(a.car); this.list = []; }
  partner(R) { return this.g.world.route(R.id.endsWith('-rev') ? R.id.slice(0, -4) : R.id + '-rev'); }
  /* pose the car on its lane at a.s (used while asleep, and to wake it) */
  place(a, wake) {
    const R = a.route, s = a.s, p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), c = a.car;
    c.reset(p.x - dz * a.baseLane, p.z + dx * a.baseLane, Math.atan2(-dx, -dz), this.g.world.terrain, 0.05, p.y);
    c.invuln = 0;
    if (wake) { const v = Math.min(a.cruise, 14); c.vel.set(dx * v, 0, dz * v); for (const w of c.wheels) w.omega = v / c.spec.wheels.r; }
  }
  /* open roads end: turn round onto the lane coming back */
  uturn(a) { const P = this.partner(a.route); if (!P) return false; a.route = P; a.s = 25; a.bestS = 25; a.stuck = 0; return true; }
  update(dt) {
    const g = this.g, P = g.player, cam = g.gfx.camera.position;
    for (const a of this.list) {
      const c = a.car, R = a.route, d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z);
      c.hidden = g.world.tunnelGateClosed && R.id.startsWith('tunnel'); // the closed tunnel carries no traffic
      if (c.hidden) { c.asleep = true; continue; }
      if (c.asleep) {
        a.s += a.cruise * dt;
        if (!R.closed && a.s > R.length - 30) this.uturn(a); else a.s = R.wrapS(a.s);
        const dc = Math.hypot(c.pos.x - cam.x, c.pos.z - cam.z);
        if (d < this.WAKE) { this.place(a, true); c.asleep = false; a.stuck = 0; a.bestS = a.s; a.respawn = false; }
        else if (dc < 950 && (this.poseT = (this.poseT || 0) + 1) % 8 === 0) this.place(a, false); // keep distant cars visibly moving
        continue;
      }
      if (d > this.SLEEP) { c.asleep = true; continue; }
      a.update(dt, g.world.cars, 1);
      const seen = d < 160;
      if (!R.closed && a.s > R.length - 40 && !seen) { this.uturn(a); this.place(a, true); continue; }
      if ((c.wrecked && c.wreckT > 4) || a.respawn) { // clear the wreck away from the player's eyes
        if (!seen || c.wreckT > 9 || a.respawn) { a.s = R.wrapS(a.s + (seen ? -140 : 60)); if (!R.closed && a.s > R.length - 40) this.uturn(a); this.place(a, true); a.respawn = false; a.stuck = 0; }
      }
    }
  }
}
