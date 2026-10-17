'use strict';
/* Red Mesa Rally · Story intro fly-through */

/* ---------------- Story intro: KRMR tells the story over a fly-through ---------------- */
const STORY_INTRO = ['si_1', 'si_2', 'si_3', 'si_4', 'si_5', 'si_6', 'si_7'];
class StoryIntro {
  constructor(game) {
    this.g = game; this.shot = -1; this.shotT = 0; this.t = 0; this.idleT = 0;
    this.cam = new THREE.Vector3(); this.look = new THREE.Vector3(); this.focus = new THREE.Vector3();
    const d = game.story.d; d.skip(); d.queue.length = 0; d.say(STORY_INTRO);
  }
  caption(c) {
    const cap = $('introCap'); cap.classList.remove('show'); void cap.offsetWidth;
    if (c) { $('introEyebrow').textContent = c[0]; $('introText').textContent = c[1]; cap.classList.add('show'); }
  }
  next(k) {
    this.shot = k; this.shotT = 0;
    this.caption([['KRMR 98.7 · Red Mesa radio', 'The festival is back'], ['Red Mesa Desert', 'Thirty years of dirt'], ['Port Calder', 'Vic Calder\'s city'], null,
      ['Calder Tunnel', 'Closed for years'], null, ['Chapter 1', 'The Festival']][k]);
  }
  done() { return this.t > 1.5 && this.idleT > 0.6; }
  update(dt) {
    const g = this.g, d = g.story.d, W = g.world, T = W.terrain;
    this.t += dt; this.shotT += dt;
    const k = d.cur ? STORY_INTRO.indexOf(d.cur) : -1;
    if (k > this.shot) this.next(k);
    this.idleT = d.busy() ? 0 : this.idleT + dt;
    if (this.shot < 0) this.next(0); // open on the festival while the first line loads
    const dur = d.cur && VO_DATA.lines[d.cur] ? d.dur : 6, u = clamp(this.shotT / Math.max(3, dur), 0, 1), e = u * u * (3 - 2 * u);
    const B = g.gfx.bonfire, P = g.player;
    let pos, look, fov = 50, k2 = 1 - Math.exp(-dt * 2.5);
    switch (Math.max(0, this.shot)) {
      case 0: // dusk over the festival paddock
        pos = new THREE.Vector3(B.x - lerp(150, 70, e), B.y + lerp(75, 28, e), B.z + lerp(170, 80, e));
        look = new THREE.Vector3(B.x, B.y + 4, B.z - 20); fov = 48; break;
      case 1: { // high over the canyon and the mesas
        const R = W.route('canyon'), J = R.posAt(R.jumps ? R.jumps[0] : 0, {}), M = MESAS[1];
        pos = new THREE.Vector3(lerp(J.x - 380, J.x - 150, e), J.y + lerp(210, 120, e), lerp(J.z + 420, J.z + 260, e));
        look = new THREE.Vector3(lerp(J.x, M.x, e), lerp(J.y, M.h * 0.6, e), lerp(J.z, M.z, e)); fov = 46; break;
      }
      case 2: // in over the docks toward the towers
        pos = new THREE.Vector3(lerp(3120, 3420, e), lerp(170, 105, e), lerp(760, 470, e));
        look = new THREE.Vector3(4180, lerp(30, 60, e), -260); fov = 48; break;
      case 3: { // Vic's stadium billboard
        const A = g.gfx.stadiumAd || { x: 4200, y: 40, z: -250, nx: 0, nz: 1, w: 20 }, sx = -A.nz, sz = A.nx, r = A.w * 1.7;
        pos = new THREE.Vector3(A.x + A.nx * lerp(r * 1.4, r, e) + sx * lerp(r * 0.6, -r * 0.3, e), A.y + lerp(8, 2, e), A.z + A.nz * lerp(r * 1.4, r, e) + sz * lerp(r * 0.6, -r * 0.3, e));
        look = new THREE.Vector3(A.x, A.y, A.z); fov = 42; break;
      }
      case 4: { // the locked west portal
        const G = W.tunnelGatePose(), sx = -G.dz, sz = G.dx, back = lerp(140, 34, e);
        pos = new THREE.Vector3(G.x - G.dx * back + sx * lerp(26, 5, e), G.y + lerp(16, 3.2, e), G.z - G.dz * back + sz * lerp(26, 5, e));
        look = new THREE.Vector3(G.x + G.dx * 4, G.y + 2.6, G.z + G.dz * 4); fov = 50; break;
      }
      case 5: { // back at the bonfire with Rosa's crowd
        const a = 0.6 + this.shotT * 0.07;
        pos = new THREE.Vector3(B.x + Math.cos(a) * 38, B.y + 14, B.z + Math.sin(a) * 38);
        look = new THREE.Vector3(B.x, B.y + 2, B.z); fov = 50; break;
      }
      default: { // the new driver
        const f = P.forward(new THREE.Vector3()); f.y = 0; f.normalize();
        const side = new THREE.Vector3(-f.z, 0, f.x), dist = lerp(26, 9, e);
        pos = P.pos.clone().addScaledVector(f, dist * 0.8).addScaledVector(side, dist * 0.6); pos.y += lerp(9, 2.4, e);
        look = P.pos.clone(); look.y += 0.8; fov = 50;
      }
    }
    const gy = T.height(pos.x, pos.z) + 1.2; if (pos.y < gy) pos.y = gy;
    if (this.shotT < dt * 1.5) { this.cam.copy(pos); this.look.copy(look); } else { this.cam.lerp(pos, k2); this.look.lerp(look, k2); }
    this.focus.copy(this.look);
    const cam = g.gfx.camera; cam.position.copy(this.cam); cam.up.set(0, 1, 0); cam.lookAt(this.look);
    cam.fov = cam.aspect < 1 ? fov * 1.35 : fov; cam.updateProjectionMatrix();
  }
}
