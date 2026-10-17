'use strict';
/* Red Mesa Rally · Race: grid, laps, progress, finish order and standings */

/* ---------- Race ---------- */
class Race {
  constructor(world, ev, cars, player) {
    this.world = world; this.ev = ev; this.route = world.route(ev.route); this.cars = cars; this.player = player;
    this.laps = ev.type === 'sprint' ? 1 : ev.laps; this.finishS = this.route.closed ? 0 : this.route.length - (ev.finishBack || 14); this.state = 'countdown'; this.t = 0; this.clock = 0;
    this.prog = new Map(); this.finishOrder = []; this.ai = [];
    for (const c of cars) this.prog.set(c, { lap: this.route.closed ? -1 : 0, s: 0, total: 0, finished: false, time: 0, lapStart: 0, best: Infinity, lastLap: 0, off: 0, wrongWay: 0 });
  }
  gridSlot(i) {
    const R = this.route;
    const row = Math.floor(i / 2), col = i % 2;
    const ss = R.closed ? R.wrapS(-12 - row * 11) : Math.max(4, 40 - row * 11);
    const p = R.posAt(ss, { x: 0, y: 0, z: 0 }); const [dx, dz] = R.dirAt(ss);
    const lat = R.def.metro ? METRO.tracks[col] : (col ? 1 : -1) * 3.6; // down in the metro the grid lines up on the rails
    return { x: p.x - dz * lat, z: p.z + dx * lat, y: p.y, yaw: Math.atan2(-dx, -dz), s: ss };
  }
  update(dt) {
    this.t += dt;
    if (this.state === 'countdown') { if (this.t >= 3.6) { this.state = 'running'; this.clock = 0; for (const c of this.cars) c.frozen = false; } else { for (const c of this.cars) c.frozen = true; } }
    if (this.state === 'running' || this.state === 'finished') this.clock += dt;
    const R = this.route;
    for (const c of this.cars) {
      const P = this.prog.get(c);
      if (P.finished) continue;
      const pr = R.project(c.pos.x, c.pos.z, P.s, 50);
      let ds = pr.s - P.s;
      if (R.closed) { if (ds < -R.length / 2) ds += R.length; if (ds > R.length / 2) ds -= R.length; }
      P.off = pr.dist > (R.def.slack || R.width * 0.5 + 25) ? P.off + dt : 0; // slack: a river race may take either side of the island
      if (this.state === 'countdown') { P.s = pr.s; continue; }
      if (pr.dist < (R.def.slack || R.width * 0.5 + 40)) {
        const prevS = P.s; P.s = pr.s;
        if (R.closed && ds > 0 && pr.s < prevS - R.length / 2) { // crossed line
          P.lap++;
          const lt = this.clock - P.lapStart; if (P.lap > 0) { P.lastLap = lt; P.best = Math.min(P.best, lt); } P.lapStart = this.clock;
          if (c === this.player && P.lap > 0 && P.lap < this.laps) c.events.push({ type: 'lap', lap: P.lap + 1, time: lt });
        } else if (R.closed && ds < 0 && pr.s > prevS + R.length / 2) P.lap--;
        P.wrongWay = ds < -0.05 && c.vel.length() > 3 ? P.wrongWay + dt : Math.max(0, P.wrongWay - dt * 2);
      }
      P.total = P.lap * R.length + P.s;
      const done = !c.remote && (R.closed ? P.lap >= this.laps : P.s >= this.finishS); // remote players report their own finish
      if (done) { P.finished = true; P.time = this.clock; if (!R.closed) { P.best = this.clock; } this.finishOrder.push(c); c.events.push({ type: 'finish', pos: this.finishOrder.length }); }
    }
    if (this.prog.get(this.player).finished && this.state === 'running') { this.state = 'finished'; this.finishT = this.t; }
  }
  standings() {
    const arr = [...this.cars];
    arr.sort((a, b) => {
      const A = this.prog.get(a), Bp = this.prog.get(b);
      if (!A.dnf !== !Bp.dnf) return A.dnf ? 1 : -1;
      if (A.finished && Bp.finished) return A.time - Bp.time;
      if (A.finished) return -1; if (Bp.finished) return 1;
      return Bp.total - A.total;
    });
    return arr;
  }
  respawnPoint(c) {
    const R = this.route, P = this.prog.get(c);
    const s = R.wrapS(P.s - 8);
    const p = R.posAt(s, { x: 0, y: 0, z: 0 }); const [dx, dz] = R.dirAt(s);
    const l = R.def.metro ? this.world.metroLane(p.x, p.z) : 0; // back down on whichever track has no train coming
    return { x: p.x - dz * l, z: p.z + dx * l, y: p.y, yaw: Math.atan2(-dx, -dz) };
  }
}
