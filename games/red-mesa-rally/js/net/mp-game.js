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
    car.remote = true; car.invuln = Infinity; car.name = p.name; car.peer = p.id; // only their own machine can wreck them
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
});
