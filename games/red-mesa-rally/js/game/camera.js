'use strict';
/* Red Mesa Rally · Chase camera */

/* ---------------- Camera ---------------- */
class CameraRig {
  constructor(cam, T) { this.cam = cam; this.T = T; this.mode = 0; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.shake = 0; this.dir = new THREE.Vector3(0, 0, -1); this.fov = 62; this.init = false; this.back = false; this._v = new THREE.Vector3(); this.orbitA = 0; }
  snap() { this.init = false; }
  update(dt, car, opts) {
    this.follow(dt, car, opts);
    const T = this.T;
    // a boat in the boat tunnel: keep the camera under the roof and inside the bore
    if (car.spec.boat && car.pos.y < RIVER.tunnel.under && T.inRiverTunnel(car.pos.x, car.pos.z)) {
      const p = this.cam.position, c = car.pos, dir = this.cam.getWorldDirection(this._v);
      if (!T.inRiverTunnel(p.x, p.z)) for (let k = 1; k <= 10; k++) { const t = k / 10, x = lerp(p.x, c.x, t), z = lerp(p.z, c.z, t); if (T.inRiverTunnel(x, z)) { p.x = x; p.z = z; break; } }
      p.y = Math.min(p.y, RIVER.tunnel.ceil - 0.5);
      this.cam.lookAt(p.x + dir.x * 10, p.y + dir.y * 10, p.z + dir.z * 10);
      return;
    }
    // down in the metro: keep the camera under the ceiling and inside the tube
    if (!car.under || !T.metro) return;
    const p = this.cam.position, c = car.pos, dir = this.cam.getWorldDirection(this._v);
    let ce = T.subCeil(p.x, p.z);
    if (ce === null) for (let k = 1; k <= 10; k++) { const t = k / 10, x = lerp(p.x, c.x, t), z = lerp(p.z, c.z, t), q = T.subCeil(x, z); if (q !== null) { p.x = x; p.z = z; ce = q; break; } }
    if (ce !== null && p.y > ce - 0.45) p.y = ce - 0.45;
    this.cam.lookAt(p.x + dir.x * 10, p.y + dir.y * 10, p.z + dir.z * 10);
  }
  follow(dt, car, opts) {
    const c = car, f = this._v.set(0, 0, -1).applyQuaternion(c.q); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    const speed = c.vel.length();
    const vf = new THREE.Vector3(c.vel.x, 0, c.vel.z); if (vf.lengthSq() > 4) vf.normalize(); else vf.copy(f);
    let desiredDir = f.clone().lerp(vf, clamp(speed / 25, 0, 1) * 0.35).normalize();
    if (c.vel.dot(f) < -2 && c.reverse) desiredDir = f.clone();
    if (!this.init) { this.dir.copy(desiredDir); }
    const k = 1 - Math.exp(-dt * (c.onGround ? 4.5 : 1.6));
    this.dir.lerp(desiredDir, k).normalize();
    const dir = this.back ? this.dir.clone().negate() : this.dir;
    const big = (c.spec.id === 'truck' ? 1.25 : c.spec.boat ? 1.35 : c.spec.id === 'buggy' ? 0.95 : 1) * (this.cam.aspect < 1 ? 1.25 : 1) * (opts && opts.far ? opts.far : 1);
    let dist, h, lookH;
    if (opts && opts.orbit) { // wreck / title orbit
      this.orbitA += dt * (opts.orbitSpeed || 0.4);
      const R = opts.radius || 9;
      const p = new THREE.Vector3(c.pos.x + Math.cos(this.orbitA) * R, c.pos.y + (opts.height || 3.5), c.pos.z + Math.sin(this.orbitA) * R);
      const gy = this.T.height(p.x, p.z) + 1.5; if (p.y < gy) p.y = gy;
      if (!this.init) this.pos.copy(p); else this.pos.lerp(p, 1 - Math.exp(-dt * 2));
      this.look.lerp(c.pos, this.init ? 1 - Math.exp(-dt * 4) : 1); this.init = true;
      this.cam.position.copy(this.pos); this.cam.lookAt(this.look);
      this.setFov(dt, opts.fov || 55);
      return;
    }
    if (this.mode === 2) { // bumper cam
      const p = new THREE.Vector3(0, c.spec.hull.y + c.spec.hull.hy * 0.9, -c.spec.hull.hz * 0.4).applyQuaternion(c.q).add(c.pos);
      const ahead = new THREE.Vector3(0, c.spec.hull.y + 0.6, this.back ? 30 : -30).applyQuaternion(c.q).add(c.pos);
      this.cam.position.copy(p); this.cam.up.set(0, 1, 0).applyQuaternion(c.q).lerp(new THREE.Vector3(0, 1, 0), 0.6); this.cam.lookAt(ahead); this.cam.up.set(0, 1, 0);
      this.setFov(dt, 74 + Math.min(18, speed * 0.25) + (c.boosting ? 6 : 0)); this.init = true; return;
    }
    if (this.mode === 0) { dist = (6.4 + Math.min(2.5, speed * 0.04)) * big; h = 2.25 * big; lookH = 1.05 * big; } else { dist = (9 + Math.min(3, speed * 0.05)) * big; h = 3.4 * big; lookH = 1.2 * big; }
    const target = new THREE.Vector3(c.pos.x - dir.x * dist, c.pos.y + h, c.pos.z - dir.z * dist);
    const gy = Math.max(this.T.height(target.x, target.z), WATER_Y) + 1.3; if (target.y < gy) target.y = gy;
    if (!this.init) this.pos.copy(target); else { const kp = 1 - Math.exp(-dt * 10); this.pos.lerp(target, kp); this.pos.y = lerp(this.pos.y, target.y, 1 - Math.exp(-dt * (c.onGround ? 6 : 3))); }
    const ly = c.pos.y + lookH;
    const lookT = new THREE.Vector3(c.pos.x + dir.x * 3, ly, c.pos.z + dir.z * 3);
    if (!this.init) this.look.copy(lookT); else this.look.lerp(lookT, 1 - Math.exp(-dt * 14));
    this.init = true;
    const sh = this.shake; this.shake = Math.max(0, this.shake - dt * 2.2);
    const jitter = new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh).multiplyScalar(0.35);
    const camGy = Math.max(this.T.height(this.pos.x, this.pos.z), WATER_Y + 0.3) + 0.9; if (this.pos.y < camGy) this.pos.y = camGy;
    this.cam.position.copy(this.pos).add(jitter);
    this.cam.lookAt(this.look);
    this.setFov(dt, 60 + Math.min(20, speed * 0.24) + (c.boosting ? 9 : 0));
  }
  setFov(dt, target) { this.fov = lerp(this.fov, target, 1 - Math.exp(-dt * 3)); const a = this.cam.aspect; this.cam.fov = a < 1 ? Math.min(100, this.fov * (1 + (1 - a) * 0.55)) : this.fov; this.cam.updateProjectionMatrix(); }
}
