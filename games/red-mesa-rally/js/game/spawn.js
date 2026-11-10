'use strict';
/* Red Mesa Rally · Game: putting cars in the world — the player, the roaming rivals, boat docks, resets and respawns */

Object.assign(Game.prototype, {
  /* ----- cars ----- */
  addCar(spec, opts, lazy) {
    const car = new Car(spec, opts);
    this.world.cars.push(car);
    // lazy: the model (~50 ms to build) waits until the car first comes in sight, so a town full of traffic costs nothing at load
    this.views.set(car, lazy ? { lazy: opts } : new CarView(car, this.gfx, opts));
    return car;
  },
  removeCar(car) { this.world.cars = this.world.cars.filter((c) => c !== car); const v = this.views.get(car); if (v && !v.lazy) v.dispose(); this.views.delete(car); },
  spawnPlayer(vid, at) {
    const old = this.player, W = this.world, boat = !!VEHICLES[vid].boat;
    let x = HUB.x + 18, z = HUB.z + 46, yaw = Math.PI * 0.9, note = null;
    if (at) { x = at.x; z = at.z; yaw = at.yaw; vid = at.vehicle || vid; }
    else if (old) {
      x = old.pos.x; z = old.pos.z; yaw = old.yaw();
      const wasBoat = !!old.spec.boat, dock = this.nearestDock(x, z);
      if (boat && !wasBoat) { // put the boat in the water: right here if there is water, else at the nearest launch
        const wet = W.terrain.height(x, z) < WATER_Y - 2;
        if (!wet) { ({ x, z, yaw } = dock.water); note = dock.name; }
      } else if (!boat && wasBoat) { // back on dry land at a launch, or the nearest beach
        if (Math.hypot(dock.water.x - x, dock.water.z - z) < 500) { ({ x, z, yaw } = dock.land); note = dock.name; }
        else { const p = W.findDrySpot(x, z); x = p.x; z = p.z; if (p.yaw !== null) yaw = p.yaw; }
      }
    }
    if (old) this.removeCar(old);
    this.vehicle = vid; Store.data.vehicle = vid; Store.save();
    if (!boat) this.landVehicle = vid;
    const L = this.currentLivery();
    this.player = this.addCar(VEHICLES[vid], { id: 0, player: true, color: L.color || VEHICLES[vid].color, number: L.num, livery: L.text, helmet: L.helmet });
    this.player.reset(x, z, yaw, W.terrain, 0.5, old && old.under && !boat ? old.pos.y : undefined); this.player.liveryId = L.id; this.player.netId = 'p';
    this.rig.snap();
    if (this.mp) this.mp.track();
    if (note && this.state === 'free') this.toast(boat ? 'Boat launched' : 'Ashore', note, 'region');
  },
  currentLivery() {
    const L = LIVERIES.find((l) => l.id === this.livery) || LIVERIES[0];
    return this.story && !this.story.liveryUnlocked(L) ? LIVERIES[0] : L;
  },
  nearestDock(x, z) { let best = BOAT_DOCKS[0], bd = 1e18; for (const D of BOAT_DOCKS) { const d = Math.hypot(D.land.x - x, D.land.z - z); if (d < bd) { bd = d; best = D; } } return best; },
  spawnRoamers() {
    this.roamers = [];
    const plan = [['canyon', 'rally', 0.3], ['ridge', 'buggy', 0.55], ['mudbowl', 'truck', 0.2], ['canyon', 'truck', 0.75], ['hwy', 'kaze', 0.2], ['hwy', 'ironside', 0.62], ['coast', 'kaze', 0.4], ['harbour', 'ironside', 0.3], ['pass', 'kaze', 0.5]];
    plan.forEach(([rid, vid, frac], i) => {
      const R = this.world.route(rid), s = R.length * frac;
      const car = this.addCar(VEHICLES[vid], { id: 20 + i, color: AI_COLORS[(i * 3) % AI_COLORS.length], number: 30 + i * 7, helmet: AI_COLORS[(i + 2) % AI_COLORS.length] });
      car.name = VEHICLES[vid].street ? CREW_NAMES[i % CREW_NAMES.length] : AI_NAMES[(i + 3) % AI_NAMES.length]; car.netId = 'r' + i;
      const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); car.reset(p.x, p.z, Math.atan2(-dx, -dz), this.world.terrain, 0.4);
      this.roamers.push(new AIDriver(car, R, { s, lane: (i % 2 ? 1 : -1) * 2, skill: 0.78, aggr: 0.3, seed: 100 + i }));
    });
  },
  clearRoamers() { for (const a of this.roamers || []) this.removeCar(a.car); this.roamers = []; },
  useDock() {
    if (this.state !== 'free' || !this.nearDock) return;
    if (this.player.spec.boat) this.spawnPlayer(this.landVehicle);
    else if (this.story.carUnlocked('boat')) this.spawnPlayer('boat');
    this.audio.start();
  },
  requestReset() {
    const c = this.player; if (c.wrecked) return;
    if (this.race) { const p = this.race.respawnPoint(c); c.reset(p.x, p.z, p.yaw, this.world.terrain, 0.6, p.y); }
    else this.freeRespawn(c, 1.2);
    this.rig.snap();
  },
  freeRespawn(c, lift) {
    if (c.under) {
      const R = this.world.route('metro'), s = R.project(c.pos.x, c.pos.z, 0, -1).s, q = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
      const l = this.world.metroLane(q.x, q.z);
      c.reset(q.x - dz * l, q.z + dx * l, Math.atan2(-dx, -dz), this.world.terrain, lift, q.y); return;
    }
    // down in a road or rail bore: back on its line, on the floor, not up on the mountain over it
    const T = this.world.terrain;
    if (!c.spec.boat && T.bores && T.probe(c.pos.y + 1, () => T.boreFloor(c.pos.x, c.pos.z)) !== null) {
      for (const tun of this.world.tunnelSpans()) {
        const R = tun.R, s = R.project(c.pos.x, c.pos.z, 0, -1).s, q = R.posAt(s, {});
        if (s < tun.i0 * R.step || s > tun.i1 * R.step || Math.hypot(q.x - c.pos.x, q.z - c.pos.z) > R.width / 2 + 8) continue;
        const [dx, dz] = R.dirAt(s), f = Math.cos(c.yaw() - Math.atan2(-dx, -dz)) < 0 ? -1 : 1; // keep facing the way it was going
        c.reset(q.x, q.z, Math.atan2(-dx * f, -dz * f), T, lift, q.y); return;
      }
    }
    // up on the highway viaduct or a slip road: back on its deck in the same lane, not down on the ground beside it (#30)
    if (!c.spec.boat) {
      let best = null;
      for (const R of T.routes) {
        if (!R.def.viaduct || R.surface === 'rail') continue;
        const pr = R.project(c.pos.x, c.pos.z, 0, -1); if (pr.dist > R.width / 2 + 4 || (best && pr.dist >= best.d)) continue;
        const q = R.posAt(pr.s, {}); if (q.y - T.rawH(q.x, q.z) < 3 || Math.abs(q.y - c.pos.y) > 8) continue;
        best = { R, s: pr.s, q, d: pr.dist };
      }
      if (best) {
        const { R, s, q } = best, [dx, dz] = R.dirAt(s), m = R.width / 2 - 3;
        const l = clamp(-(c.pos.x - q.x) * dz + (c.pos.z - q.z) * dx, -m, m), f = Math.cos(c.yaw() - Math.atan2(-dx, -dz)) < 0 ? -1 : 1;
        c.reset(q.x - dz * l, q.z + dx * l, Math.atan2(-dx * f, -dz * f), T, lift, q.y); return;
      }
    }
    const p = c.spec.boat ? this.world.findWetSpot(c.pos.x, c.pos.z) : this.world.findDrySpot(c.pos.x, c.pos.z);
    c.reset(p.x, p.z, p.yaw !== null ? p.yaw : c.yaw(), T, lift);
  },
});
