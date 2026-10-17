'use strict';
/* Red Mesa Rally · Opening cinematic */

/* ---------------- Intro cinematic ---------------- */
class IntroDirector {
  constructor(game) {
    const W = game.world, R = this.R = W.route('canyon');
    this.g = game; this.sj = R.jumps[0];
    const J = R.posAt(this.sj, {}); this.J = new THREE.Vector3(J.x, J.y, J.z);
    const [dx, dz] = R.dirAt(this.sj); this.d = new THREE.Vector3(dx, 0, dz); this.r = new THREE.Vector3(-dz, 0, dx);
    this.cars = []; this.ai = [];
    const looks = [['rally', 0xd9481c, 7, 0xff6a1a], ['buggy', 0xf0b50a, 23, 0x1f4e79], ['truck', 0x1f4e79, 88, 0xe9e2d6]];
    looks.forEach(([v, col, num, helm], i) => {
      const s = this.sj - 240 - i * 15, lat = (i - 1) * 3.2;
      const car = game.addCar(VEHICLES[v], { id: 40 + i, color: col, number: num, helmet: helm });
      car.name = AI_NAMES[i + 2];
      const p = R.posAt(s, {}), [ex, ez] = R.dirAt(s);
      car.reset(p.x - ez * lat, p.z + ex * lat, Math.atan2(-ex, -ez), W.terrain, 0.25);
      car.vel.set(ex * 28, 0, ez * 28); for (const w of car.wheels) w.omega = 28 / car.spec.wheels.r;
      car.invuln = 999;
      this.cars.push(car);
      this.ai.push(new AIDriver(car, R, { s, lane: lat, skill: 1.05, aggr: 0.95, seed: 60 + i }));
    });
    this.lead = this.cars[0];
    this.t = 0; this.shot = -1; this.shotT = 0; this.slow = 1; this.wasAir = false; this.landT = 0;
    this.cam = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.next();
  }
  next() {
    this.shot++; this.shotT = 0;
    const caps = [['Red Mesa · late afternoon', 'The high desert'], ['Six drivers, no marshals', 'Every line is legal'], ['Watch the heat', 'Hold the boost'], null];
    const c = caps[this.shot];
    const cap = $('introCap');
    cap.classList.remove('show'); void cap.offsetWidth;
    if (c) { $('introEyebrow').textContent = c[0]; $('introText').textContent = c[1]; cap.classList.add('show'); }
    $('introFinal').classList.toggle('show', this.shot === 3);
    const M = this.g.audio.music; if (M) M.setLevel([1, 2, 3, 3][this.shot] ?? 3);
    if (this.shot === 3 && M) M.crash(M.ctx.currentTime + 0.05);
  }
  done() { return this.shot > 3; }
  update(dt) {
    this.t += dt; this.shotT += dt;
    const L = this.lead, cam = this.g.gfx.camera, J = this.J, d = this.d, r = this.r;
    const pr = this.R.project(L.pos.x, L.pos.z, this.ai[0].s, 60);
    const toJump = this.sj - pr.s;
    let pos, look, fov = 52, k = 1;
    this.slow = 1;
    if (this.shot === 0) { // high sweep down the canyon toward the cars
      const u = clamp(this.shotT / 4.6, 0, 1), e = u * u * (3 - 2 * u);
      pos = J.clone().addScaledVector(d, lerp(-520, -330, e)).addScaledVector(r, lerp(180, 40, e)); pos.y = J.y + lerp(170, 40, e);
      look = J.clone().addScaledVector(d, -150).lerp(L.pos, e); fov = 48;
      if (this.shotT > 4.6) this.next();
    } else if (this.shot === 1) { // low tracking alongside the leader
      const f = L.forward(new THREE.Vector3()); f.y = 0; f.normalize(); const side = new THREE.Vector3(-f.z, 0, f.x);
      pos = L.pos.clone().addScaledVector(side, -5.5).addScaledVector(f, -1 + this.shotT * 0.4); pos.y += 0.9;
      look = L.pos.clone().addScaledVector(f, 5); fov = 58; k = 1 - Math.exp(-dt * 8);
      if ((toJump < 55 && this.shotT > 2.5) || this.shotT > 7) this.next();
    } else if (this.shot === 2) { // trackside at the kicker, slow motion over the lip
      pos = J.clone().addScaledVector(r, this.R.width / 2 + 9).addScaledVector(d, 16); pos.y = this.g.world.terrain.height(pos.x, pos.z) + 1.6;
      look = L.pos.clone(); fov = 46; k = 1 - Math.exp(-dt * 10);
      if (!L.onGround) { this.wasAir = true; this.slow = 0.35; }
      if (this.wasAir && L.onGround) this.landT += dt;
      if (this.landT > 0.8 || this.shotT > 6) this.next();
    } else { // crane up over the festival paddock
      const u = clamp(this.shotT / 5.5, 0, 1), e = u * u * (3 - 2 * u), B = this.g.gfx.bonfire;
      pos = new THREE.Vector3(B.x - lerp(20, 95, e), B.y + lerp(4, 55, e), B.z + lerp(26, 120, e));
      look = new THREE.Vector3(B.x, B.y + lerp(3, 20, e), B.z - lerp(0, 80, e)); fov = 50;
      if (this.shotT > 5.8) this.next();
    }
    if (pos) {
      const gy = this.g.world.terrain.height(pos.x, pos.z) + 1.0; if (pos.y < gy) pos.y = gy;
      if (this.shotT < dt * 1.5 || k >= 1) { this.cam.copy(pos); this.look.copy(look); } else { this.cam.lerp(pos, k); this.look.lerp(look, Math.min(1, k * 1.5)); }
      cam.position.copy(this.cam); cam.up.set(0, 1, 0); cam.lookAt(this.look);
      cam.fov = cam.aspect < 1 ? fov * 1.35 : fov; cam.updateProjectionMatrix();
    }
  }
  dispose() { for (const c of this.cars) this.g.removeCar(c); this.cars = []; this.ai = []; }
}
