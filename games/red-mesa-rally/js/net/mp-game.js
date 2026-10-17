'use strict';
/* Red Mesa Rally · Game: multiplayer screens and what the game does with session messages */

Object.assign(Game.prototype, {
  carInfo() { const P = this.player, L = this.currentLivery(); return { v: P.spec.id, c: P.color, n: L.num, x: L.text, h: L.helmet }; },
  showMp(on) {
    if (this.state !== 'title') return;
    this.mpOpen = on; this.screen('mpScreen', on); this.screen('title', !on);
    if (!on) { this.refreshMenu(); return; }
    this.renderMp('');
    if (this.profile === undefined) arcadeProfile().then((p) => { this.profile = p; this.renderMp(); });
  },
  renderMp(status) {
    if (status !== undefined) this.mpStatus = status;
    const M = this.mp, P = this.profile, who = $('mpWho');
    if (P === undefined) who.textContent = 'Checking your arcade profile…';
    else if (P) { who.textContent = 'Racing as '; const b = document.createElement('b'); b.textContent = P.name; b.style.color = 'var(--sand)'; who.appendChild(b); who.append(M ? '' : '. Host a session and share its code, or join a friend with theirs.'); }
    else who.innerHTML = 'Online play uses your arcade profile. <a href="../index.html">Log in on the arcade page</a>, then come back here.';
    $('mpOut').hidden = !!M; $('mpIn').hidden = !M;
    $('btnHost').disabled = $('btnJoin').disabled = !P || !!this.mpBusy;
    $('btnMpDrive').hidden = $('btnMpLeave').hidden = !M;
    if (M) { $('mpCodeShow').textContent = M.code; this.mpListInto($('mpList')); }
    $('mpStatus').textContent = this.mpBusy ? 'Connecting…' : this.mpStatus || (M && !M.peers.size ? `No one else here yet. Friends join with code ${M.code}.` : '');
  },
  async openMp(code) {
    if (this.mp || this.mpBusy || !this.profile) return;
    this.mpBusy = true; this.renderMp('');
    const M = new Session(this);
    try { this.mp = M; await M.open(code, this.profile); this.mpBusy = false; this.renderMp(''); }
    catch (e) { console.warn('multiplayer', e); this.mp = null; M.leave(); this.mpBusy = false; this.renderMp(e.message || 'Could not open the session.'); }
  },
  leaveMp(why) {
    const M = this.mp; if (!M) return;
    this.mp = null; M.leave();
    this.refreshStory(); this.refreshPauseButtons();
    if (this.state === 'event') this.refreshEventStart();
    if (this.mpOpen) this.renderMp(why || '');
    else { this.refreshMenu(); if (why) this.toast('Left the session', why, 'bad'); }
  },
  mpRefresh() {
    if (!this.mp) return;
    if (this.mpOpen) this.renderMp(); else if (this.state === 'title' && !this.savesOpen) this.refreshMenu();
    if (this.state === 'pause') this.mpListInto($('pauseMp'));
    if (this.state === 'pause' || this.state === 'results') this.refreshPauseButtons();
    if (this.state === 'results') { $('btnRetry').hidden = !this.mp.isHost; }
    if (this.state === 'event') this.refreshEventStart();
  },
  mpListInto(el) {
    const M = this.mp; el.innerHTML = ''; if (!M) return;
    for (const x of M.list) {
      const d = document.createElement('div'), car = x.me ? this.player.spec : VEHICLES[x.info && DRIVEABLE.includes(x.info.v) ? x.info.v : 'rally'];
      d.className = x.me ? 'me' : '';
      d.innerHTML = '<b></b><em></em><span></span>';
      d.firstChild.textContent = x.me ? `${x.name} (you)` : x.name;
      d.children[1].textContent = x.id === M.hostId ? 'Host' : '';
      const out = x.me ? this.inWorld() : !!(x.car && !x.car.hidden);
      d.lastChild.textContent = [car.name, out ? 'On the map' : 'In the lobby', x.me ? '' : x.direct() ? 'Direct link' : x.link === 'relay' ? 'Relayed' : 'Connecting'].filter(Boolean).join(' · ');
      el.appendChild(d);
    }
  },
  mpHint() { const M = this.mp, n = M.peers.size + 1; return `${n} ${n === 1 ? 'driver' : 'drivers'} · code ${M.code} · ${M.isHost ? 'you host: start any event for everyone' : 'the host starts events'}`; },
  mpJoined(p) { if (this.inWorld() || this.state === 'title') this.toast(`${esc(p.name)} joined`, null, 'region'); },
  mpLeft(p, quiet) {
    if (p.car) { if (this.race) this.race.cars = this.race.cars.filter((c) => c !== p.car); this.removeCar(p.car); p.car = null; }
    if (p.label) { p.label.remove(); p.label = null; }
    if (!quiet) { this.toast(`${esc(p.name)} left`, null, ''); if (this.state === 'results') this.renderResults(); }
    this.mpRefresh();
  },
  /* a remote driver's car, rebuilt whenever they change car or livery */
  mpCar(p) {
    const I = p.info || {}, vid = DRIVEABLE.includes(I.v) ? I.v : 'rally', old = p.car;
    const col = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : d);
    const car = this.addCar(VEHICLES[vid], { id: 60 + p.slot, color: col(I.c, VEHICLES[vid].color), number: Number.isInteger(I.n) ? clamp(I.n, 0, 999) : 0, livery: typeof I.x === 'string' ? I.x.slice(0, 16) : undefined, helmet: col(I.h, 0xff6a1a) });
    car.remote = true; car.invuln = Infinity; car.name = p.name; car.peer = p.id; car.netId = 'p'; // only their own machine can wreck them
    if (old) {
      car.pos.copy(old.pos); car.q.copy(old.q);
      const R = this.race, i = R ? R.cars.indexOf(old) : -1;
      if (i >= 0) { R.cars[i] = car; R.prog.set(car, R.prog.get(old)); R.prog.delete(old); }
      this.removeCar(old);
    }
    p.car = car; p.rebuild = false;
    if (!p.label) { p.label = document.createElement('div'); p.label.className = 'label3d shadow mp'; p.label.innerHTML = '<b></b><span></span>'; p.label.style.display = 'none'; $('labels').appendChild(p.label); }
    p.label.firstChild.textContent = p.name;
  },
  /* the host started an event: drop whatever you're doing and line up */
  mpRace(m) {
    const ev = EVENTS.find((e) => e.id === m.ev);
    if (!ev || !Array.isArray(m.order) || !this.inWorld()) return;
    const order = m.order.filter((x) => typeof x === 'string').slice(0, MP_MAX);
    for (const id of ['pause', 'mapScreen', 'eventScreen', 'results']) this.screen(id, false);
    if (this.race) this.endEvent(true);
    this.startEvent(ev, this.vehicle, order);
    this.toast(ev.name, 'Started by the host', 'hot');
  },
  mpFinish(p, m) {
    const R = this.race, pr = R && p.car && R.prog.get(p.car), time = Number(m.time);
    if (!pr || pr.finished || !(time > 0 && time < 36000)) return;
    pr.finished = true; pr.time = time; const best = Number(m.best); pr.best = best > 0 ? best : time;
    R.finishOrder.push(p.car);
    this.toast(`${esc(p.name)} finished`, fmtTime(time), '');
    if (this.state === 'results') this.renderResults();
  },
  mpQuit(p) {
    const R = this.race, pr = R && p.car && R.prog.get(p.car);
    if (!pr || pr.finished) return;
    pr.dnf = true;
    if (this.state === 'results') this.renderResults();
  },
  /* ----- the host's traffic ----- */
  /* the host's civilians and roaming rivals by id ('t3', 'r1'): the real car on the host, its ghost everywhere else */
  aiCar(id) {
    const L = id[0] === 't' ? this.traffic.list : id[0] === 'r' ? this.roamers : null, a = L && L[Number(id.slice(1))];
    return a ? a.car : null;
  },
  trafficPacket(sleepers) {
    const a = [], r = [];
    this.traffic.list.forEach((x, i) => { if (!x.car.asleep && !x.car.hidden) a.push([i, ...packAI(x.car)]); });
    (this.roamers || []).forEach((x, i) => r.push([i, ...packAI(x.car)]));
    if (!this.traffic.list.length && !r.length) return null; // mid-race: nothing out on the roads
    const m = { k: 'tr', a, r };
    if (sleepers) { const routes = this.world.terrain.routes; m.z = []; this.traffic.list.forEach((x, i) => { if (x.car.asleep) m.z.push([i, routes.indexOf(x.route), rnd(x.s, 10)]); }); }
    return m;
  },
  mpTraffic(p, m) {
    if (this.race || !Array.isArray(m.a) || !Array.isArray(m.r)) return;
    const at = p.stamp(Number(m.t));
    const feed = (list, e) => { const x = Array.isArray(e) && e.length === MP_AI_LEN + 1 && e.every(Number.isFinite) && list[e[0]]; if (x) (x.ghost || (x.ghost = new Ghost())).push(e.slice(1), at); };
    for (const e of m.a) feed(this.traffic.list, e);
    for (const e of m.r) feed(this.roamers, e);
    this.traffic.feedT = mpNow();
    if (Array.isArray(m.z)) this.traffic.sleepers(m.z);
  },
  /* drive an AI car from the host's snapshots while they keep coming; hand it back to the local AI when they stop */
  ghostDrive(a, now, dt) {
    const c = a.car, G = a.ghost;
    if (G && G.live(now, 0.6)) {
      c.remote = true; c.asleep = false; c.invuln = Infinity;
      G.apply(c, now, dt); G.wheels(c, this.world, c.pos.distanceTo(this.player.pos) < 160, dt);
      return true;
    }
    if (c.remote) { c.remote = false; c.invuln = 0; a.ghost = null; a.s = a.bestS = a.route.project(c.pos.x, c.pos.z, 0, -1).s; a.stuck = 0; }
    return false;
  },
  /* how far the nearest driver in the session is: traffic wakes up and tidies its wrecks around all of them */
  driverDist(x, z) {
    const P = this.player.pos; let d = Math.hypot(x - P.x, z - P.z);
    if (this.mp) for (const p of this.mp.peers.values()) if (p.car && !p.car.hidden) d = Math.min(d, Math.hypot(x - p.car.pos.x, z - p.car.pos.z));
    return d;
  },
  /* ----- crashes between machines -----
     Every machine runs the crash with what it can see. When a car simulated here (your own, or the host's AI on the
     host) hits a ghost, the ghost's owner hears about it: the push, and whether that hit is hard enough to wreck it.
     The owner skips the push if it already felt that contact itself, and wrecking twice does nothing. */
  mpContact(a, b, Jb, cp, hardA, hardB, vic) {
    const M = this.mp; if (!M) return;
    const t = this.world.time;
    for (const [mine, other, sg, hard] of [[a, b, 1, hardB], [b, a, -1, hardA]]) {
      if (mine.remote || !other.remote || !other.netId) continue;
      (mine.touches || (mine.touches = new Map())).set(other, t);
      if (!mine.netId || (mine !== this.player && !M.isHost)) continue; // a guest's own copy of the traffic speaks for no one
      const sent = mine.hitSent || (mine.hitSent = new Map());
      if (t - (sent.get(other) ?? -9) < 0.15) continue;
      sent.set(other, t);
      M.sendTo(other.peer || M.hostId, { k: 'hit', id: other.netId, by: mine.netId, J: [rnd(Jb.x * sg), rnd(Jb.y * sg), rnd(Jb.z * sg)],
        r: [rnd(cp.x - other.pos.x), rnd(cp.y - other.pos.y), rnd(cp.z - other.pos.z)], h: vic === other ? rnd(hard) : 0 }, true);
    }
  },
  mpHit(p, m) {
    const M = this.mp, W = this.world;
    if (typeof m.id !== 'string' || typeof m.by !== 'string' || !this.inWorld()) return;
    const car = m.id === 'p' ? this.player : M.isHost ? this.aiCar(m.id) : null;
    const by = m.by === 'p' ? p.car : p.id === M.hostId ? this.aiCar(m.by) : null;
    if (!car || car.remote || car.asleep || car.frozen || !by) return;
    const J = m.J, r = m.r, h = Number(m.h);
    if (!Array.isArray(J) || !Array.isArray(r) || J.length !== 3 || r.length !== 3 || ![...J, ...r, h].every(Number.isFinite)) return;
    const t = W.time;
    if (!(car.touches && car.touches.get(by) > t - 0.35)) { // a contact this machine missed: take the push from theirs
      const j = new THREE.Vector3(J[0], J[1], J[2]), cap = car.spec.mass * 25; if (j.length() > cap) j.setLength(cap);
      car.applyImpulse(j, new THREE.Vector3(r[0], r[1], r[2]).clampLength(0, 4).add(car.pos));
      car.events.push({ type: 'bump', v: j.length() / car.spec.mass, other: by });
      (car.touches || (car.touches = new Map())).set(by, t);
    }
    if (h > car.spec.tough * 1.1) { car.lastHit = by; car.lastHitT = t; car.wreck('takedown'); }
  },
});
