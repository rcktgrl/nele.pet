'use strict';
/* Red Mesa Rally · Game: boot, state, main loop, simulation and rendering */

class Game {
  constructor() {
    Store.load();
    this.canvas = $('game');
    this.input = new Input();
    this.audio = new SoundFX();
    this.state = 'loading';
    this.timeScale = 1; this.slowmo = 0;
    this.toastQ = []; this.takedowns = 0;
    this.vehicle = DRIVEABLE.includes(Store.data.vehicle) ? Store.data.vehicle : 'buggy';
    this.landVehicle = VEHICLES[this.vehicle].boat ? 'buggy' : this.vehicle;
    this.livery = LIVERIES.some((l) => l.id === Store.data.livery) ? Store.data.livery : 'festival';
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.quality = Store.data.quality || (this.isTouch ? 'low' : 'high');
    this.mp = null; this.profile = undefined; // multiplayer session; arcade profile once looked up (null: not logged in)
  }
  async boot(hot) {
    coreInit(THREE);
    const setLoad = (p, t) => { $('loadBar').style.width = (p * 100) + '%'; $('loadText').textContent = t; };
    const tick = () => new Promise((r) => setTimeout(r, 30));
    try { await Promise.race([document.fonts.load('40px "Saira Stencil One"'), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fonts optional */ }
    setLoad(0.05, 'Raising the mesas'); await tick();
    this.world = new World();
    let k = 0;
    for (const label of this.world.build()) { k++; setLoad(0.05 + Math.min(0.5, k * 0.045), label); await tick(); }
    setLoad(0.62, 'Baking the late-afternoon light'); await tick();
    this.gfx = new Gfx(this.canvas, this.world, this.quality);
    setLoad(0.85, 'Lining up the festival'); await tick();
    this.rig = new CameraRig(this.gfx.camera, this.world.terrain);
    this.mapImg = buildMapImage(this.world, this.gfx);
    this.setupBeacons();
    this.views = new Map();
    this.spawnPlayer(this.vehicle, hot && hot.player);
    this.spawnRoamers();
    this.traffic = new Traffic(this); this.traffic.spawn();
    this.world.onContact = (...a) => this.mpContact(...a);
    this.story = new Story(this);
    this.buildUI();
    this.refreshStory();
    this.gfx.updateTerrain(this.player.pos, 999);
    this.onResize(); addEventListener('resize', () => this.onResize());
    setLoad(1, 'Ready'); await tick();
    $('loading').classList.remove('on');
    if (hot && hot.state === 'free') { this.enterFree(); } else this.showSplash();
    this.last = performance.now();
    this.acc = 0;
    window.claude?.hot?.snapshot?.(() => ({ state: this.state === 'race' ? 'free' : this.state, player: { vehicle: this.player.spec.id, x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw() } }));
    requestAnimationFrame((t) => this.frame(t));
  }
  onResize() { const w = innerWidth, h = innerHeight; this.gfx.resize(w, h); this.gfx.fx.smoke.uScale.value = this.gfx.fx.fire.uScale.value = h * this.gfx.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(31))); }
  /* ----- cars ----- */
  addCar(spec, opts) {
    const car = new Car(spec, opts);
    this.world.cars.push(car);
    const view = new CarView(car, this.gfx, opts);
    this.views.set(car, view);
    return car;
  }
  removeCar(car) { this.world.cars = this.world.cars.filter((c) => c !== car); const v = this.views.get(car); if (v) v.dispose(); this.views.delete(car); }
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
  }
  currentLivery() {
    const L = LIVERIES.find((l) => l.id === this.livery) || LIVERIES[0];
    return this.story && !this.story.liveryUnlocked(L) ? LIVERIES[0] : L;
  }
  nearestDock(x, z) { let best = BOAT_DOCKS[0], bd = 1e18; for (const D of BOAT_DOCKS) { const d = Math.hypot(D.land.x - x, D.land.z - z); if (d < bd) { bd = d; best = D; } } return best; }
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
  }
  clearRoamers() { for (const a of this.roamers || []) this.removeCar(a.car); this.roamers = []; }
  setupBeacons() {
    this.eventSpots = [];
    for (const ev of EVENTS) {
      const R = this.world.route(ev.route);
      const s = R.closed ? R.length - 30 : 10;
      const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
      let x = p.x, z = p.z;
      if (ev.at) { x = ev.at.x; z = ev.at.z; } else
      for (const side of [R.width / 2 + 13, -(R.width / 2 + 13), R.width / 2 + 6, 0]) {
        const cx = p.x - dz * side, cz = p.z + dx * side, W = this.world;
        const near = W.scatter.near(cx, cz), T = W.terrain;
        if (side !== 0 && ((near && near.some((o) => W.obstacleDist(o, cx, cz) < 8)) || T.rail[T.gi(cx, cz)] > 0 || Math.abs(T.height(cx, cz) - p.y) > 3 || T.height(cx, cz) < WATER_Y + 1)) continue;
        x = cx; z = cz; break;
      }
      const b = this.gfx.addBeacon(ev, x, z, EVENT_COLORS[ev.id]);
      const lab = document.createElement('div'); lab.className = 'label3d shadow'; lab.innerHTML = `<b>${ev.name}</b><span></span>`; $('labels').appendChild(lab);
      this.eventSpots.push({ ev, x, z, beacon: b, label: lab });
    }
  }
  /* ----- UI ----- */
  carCards(container, onPick, opts = {}) {
    container.innerHTML = '';
    const sel = opts.sel || this.vehicle;
    for (const id of DRIVEABLE) {
      const v = VEHICLES[id];
      if (v.boat && !opts.boats) continue;
      const open = !this.story || this.story.carUnlocked(id);
      const b = document.createElement('button'); b.className = 'carpick' + (id === sel ? ' sel' : '') + (open ? '' : ' locked'); b.type = 'button';
      b.innerHTML = `<span class="c">${v.cls}</span><span class="n">${v.name}</span><span class="b">${open ? v.blurb : CAR_UNLOCKS[id].hint}</span>${statRows(v.stats)}`;
      if (!open) { b.setAttribute('aria-disabled', 'true'); b.title = CAR_UNLOCKS[id].hint; }
      b.addEventListener('click', () => { if (!open) { this.audio.start(); return; } this.audio.start(); [...container.children].forEach((c) => c.classList.remove('sel')); b.classList.add('sel'); onPick(id); });
      container.appendChild(b);
    }
  }
  /* livery chips (locked ones name their challenge) and the challenge board */
  liveryChips(container) {
    container.innerHTML = '';
    for (const L of LIVERIES) {
      const open = this.story.liveryUnlocked(L), c = L.ch && CHALLENGES.find((q) => q.id === L.ch);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'liv' + (L.id === this.currentLivery().id ? ' sel' : '') + (open ? '' : ' locked');
      const col = '#' + new THREE.Color(L.color || this.player.spec.color).getHexString();
      b.innerHTML = `<i style="background:${col}"></i><span></span>`; b.lastChild.textContent = L.name;
      b.title = open ? L.name : `Locked · ${c.name}: ${c.desc}`;
      b.addEventListener('click', () => {
        if (!open) { this.toast(L.name + ' is locked', c.desc, ''); return; }
        this.livery = L.id; Store.data.livery = L.id; Store.save();
        if (!this.race) this.spawnPlayer(this.player.spec.id);
        this.liveryChips(container);
      });
      container.appendChild(b);
    }
  }
  challengeBoard(container) {
    const S = this.story; container.innerHTML = '';
    if (S.free) { container.innerHTML = '<div><b>Free roam</b>Every livery is open. Challenges run in story mode.</div>'; return; }
    for (const c of CHALLENGES) {
      const v = S.chalValue(c), done = v >= c.goal, L = LIVERIES.find((l) => l.ch === c.id), f = c.fmt || ((x) => String(Math.floor(x)));
      const d = document.createElement('div'); if (done) d.className = 'done';
      d.innerHTML = `<b></b><span></span><i style="--v:${Math.min(100, v / c.goal * 100)}%"></i>`;
      d.firstChild.textContent = `${c.name} · ${L.name}`;
      d.children[1].textContent = done ? 'Complete · livery unlocked' : `${c.desc} · ${f(Math.min(v, c.goal))} / ${f(c.goal)}`;
      container.appendChild(d);
    }
  }
  buildUI() {
    const bar = $('heatBar'); for (let i = 0; i < 14; i++) bar.appendChild(document.createElement('i'));
    this.heatCells = [...bar.children];
    this.mm = $('minimap').getContext('2d');
    this.bigmap = $('bigmap').getContext('2d');
    $('mStory').addEventListener('click', () => this.startMode('story'));
    $('mFree').addEventListener('click', () => this.startMode('free'));
    $('mMulti').addEventListener('click', () => { this.audio.start(); this.showMp(true); });
    $('btnHost').addEventListener('click', () => this.openMp(mpCode()));
    $('mpJoin').addEventListener('submit', (e) => { e.preventDefault(); const c = cleanCode($('mpCode').value); if (c.length === MP_CODE_LEN) this.openMp(c); else this.renderMp(`Session codes are ${MP_CODE_LEN} letters and numbers.`); });
    $('mpCode').addEventListener('input', (e) => { const c = cleanCode(e.target.value); if (c !== e.target.value) e.target.value = c; });
    $('btnCopyCode').addEventListener('click', () => { if (this.mp && navigator.clipboard) navigator.clipboard.writeText(this.mp.code).then(() => this.renderMp('Code copied.'), () => {}); });
    $('btnMpDrive').addEventListener('click', () => this.startMode('multi'));
    $('btnMpLeave').addEventListener('click', () => this.leaveMp());
    $('btnMpBack').addEventListener('click', () => this.showMp(false));
    addEventListener('pagehide', () => { if (this.mp) this.mp.leave(); });
    $('btnNewGame').addEventListener('click', () => this.newGame());
    $('btnSaves').addEventListener('click', () => this.showSaves(true));
    $('btnSlotNew').addEventListener('click', () => this.newGame());
    $('btnSlotsBack').addEventListener('click', () => this.showSaves(false));
    $('btnMenu').addEventListener('click', () => this.goMenu());
    $('btnStart').addEventListener('click', () => this.launchEvent(this.pendingEvent, this.pendingVehicle || this.vehicle));
    $('btnNotNow').addEventListener('click', () => this.closeEventScreen());
    $('btnContinue').addEventListener('click', () => this.endEvent());
    $('btnRetry').addEventListener('click', () => { const ev = this.race.ev; this.endEvent(true); this.launchEvent(ev, this.vehicle); });
    $('btnResume').addEventListener('click', () => this.togglePause(false));
    $('btnQuit').addEventListener('click', () => { if (this.mp && this.race) this.mp.broadcast({ k: 'quit' }, true); this.togglePause(false); this.endEvent(); });
    $('btnRestart').addEventListener('click', () => { this.togglePause(false); const ev = this.race.ev; this.endEvent(true); this.launchEvent(ev, this.vehicle); });
    $('btnQuality').addEventListener('click', () => { const order = ['high', 'medium', 'low']; this.quality = order[(order.indexOf(this.quality) + 1) % 3]; Store.data.quality = this.quality; Store.save(); this.gfx.setQuality(this.quality); this.onResize(); this.refreshPauseButtons(); });
    for (const el of document.querySelectorAll('#pauseVols input[data-vol]')) {
      const k = el.dataset.vol, out = el.nextElementSibling;
      el.value = Math.round(Store.vol(k) * 100); out.textContent = el.value;
      el.addEventListener('input', () => {
        const v = el.value / 100; out.textContent = el.value;
        this.audio.start(); Store.setVol(k, v);
        if (k === 'voice') this.story.d.setVolume(v); else this.audio.setVolume(k, v);
      });
      el.addEventListener('change', () => Store.save());
    }
    const ui = $('uiScale'), uiOut = ui.nextElementSibling;
    const setUi = () => { uiOut.textContent = ui.value + '%'; document.documentElement.style.setProperty('--uiscale', ui.value / 100); };
    ui.value = Math.round((Store.data.uiScale || 1) * 100); setUi();
    ui.addEventListener('input', setUi);
    ui.addEventListener('change', () => { Store.data.uiScale = ui.value / 100; Store.save(); });
    $('bigmap').width = MAP_W; $('bigmap').height = MAP_H; $('mapwrap').style.aspectRatio = MAP_W + ' / ' + MAP_H;
    $('btnMapClose').addEventListener('click', () => this.toggleMap(false));
    $('btnTravel').addEventListener('click', () => { const s = this.mapSel; if (!s || s.hidden) return; this.toggleMap(false); this.travelTo(s); });
    $('btnWaypoint').addEventListener('click', () => { this.waypoint = this.mapSel; this.toggleMap(false); });
    $('prompt').addEventListener('click', () => { if (this.nearSpot) this.openEventScreen(this.nearSpot.ev); else if (this.nearDock) this.useDock(); });
    $('tReset').addEventListener('click', () => this.requestReset());
    $('tCam').addEventListener('click', () => { this.rig.mode = (this.rig.mode + 1) % 3; });
    $('tMap').addEventListener('click', () => this.toggleMap());
    $('tPause').addEventListener('click', () => this.togglePause());
    this.input.bindTouch();
    this.updateTouchVisibility = () => $('touch').classList.toggle('on', this.isTouch && ['free', 'race'].includes(this.state));
    if (this.isTouch) document.body.classList.add('touchdev');
    // map pins
    const wrap = $('mapwrap');
    for (const s of this.eventSpots) {
      const pin = document.createElement('button'); pin.className = 'pin'; pin.type = 'button';
      pin.style.left = (mapX(s.x) / MAP_W * 100) + '%'; pin.style.top = (mapZ(s.z) / MAP_H * 100) + '%'; s.pin = pin;
      pin.innerHTML = `<i style="background:#${new THREE.Color(EVENT_COLORS[s.ev.id]).getHexString()}"></i><span>${s.ev.name}</span>`;
      pin.addEventListener('click', () => { this.mapSel = s; $('miType').textContent = this.typeLabel(s.ev); $('miName').textContent = s.ev.name; const mi = $('mapInfo'); const low = s.z > 0; mi.style.top = low ? '12px' : 'auto'; mi.style.bottom = low ? 'auto' : '12px'; mi.classList.add('on'); });
      wrap.appendChild(pin);
    }
    // the player's own marker sits above every pin so it can never be hidden
    const me = this.mapMe = document.createElement('div'); me.className = 'mapme';
    me.innerHTML = '<b></b><i></i><span>You</span>'; wrap.appendChild(me);
    this.refreshPauseButtons();
  }
  refreshPauseButtons() {
    $('btnQuality').textContent = 'Quality: ' + this.quality;
    const inRace = !!this.race;
    $('btnQuit').hidden = !inRace; $('btnRestart').hidden = !inRace || (!!this.mp && !this.mp.isHost);
    $('pauseTitle').textContent = inRace ? this.race.ev.name : this.mp ? 'Multiplayer · ' + this.mp.code : this.story.free ? 'Free roam' : 'Story · ' + this.story.chapterName();
    $('btnMenu').hidden = inRace; $('btnMenu').textContent = this.mp ? 'Leave session' : 'Main menu';
  }
  screen(id, on) { $(id).classList.toggle('on', on); }
  showSplash() {
    this.state = 'splash'; $('hud').classList.remove('on'); this.screen('splash', true);
    $('pressStart').textContent = this.isTouch ? 'Tap to start' : 'Press any key';
    const go = () => { if (this.state === 'splash') this.startIntro(); };
    $('splash').addEventListener('pointerdown', go);
  }
  startIntro() {
    this.audio.start();
    this.screen('splash', false);
    this.state = 'intro'; this.intro = new IntroDirector(this);
    const el = $('intro'); el.classList.add('on'); requestAnimationFrame(() => el.classList.add('bars'));
    $('skip').onclick = () => this.endIntro();
  }
  endIntro() {
    if (this.state !== 'intro') return;
    this.intro.dispose(); this.intro = null; this.introSlow = 1;
    const el = $('intro'); el.classList.remove('bars', 'on'); $('introFinal').classList.remove('show'); $('introCap').classList.remove('show');
    this.rig.snap(); this.showTitle();
  }
  updateMusic(dt) {
    const A = this.audio, M = A.music; if (!M) return;
    const st = this.state, P = this.player;
    const modes = { intro: 'intro', storyintro: 'title', title: 'title', race: this.race && this.race.ev.id, results: 'results', free: 'free' };
    const want = modes[st];
    if (want && want !== this.musicMode) {
      this.musicMode = want;
      if (want === 'free') M.playFree(); else M.play(want, { level: want === 'intro' || want === 'race' ? 1 : want === 'results' ? 1 : 2 });
    }
    const paused = ['pause', 'map', 'event'].includes(st);
    if (paused !== this.musicPaused) { this.musicPaused = paused; M.setPaused(paused); }
    if (st === 'free') {
      this.idleT = P.speedKmh < 5 ? (this.idleT || 0) + dt : 0;
      M.setLevel(P.boosting || P.speedKmh > 110 ? 3 : P.speedKmh > 30 ? 2 : this.idleT > 6 ? 0 : 1);
    } else if (st === 'race' && this.race) {
      const r = this.race, pr = r.prog.get(P);
      const fin = r.state !== 'countdown' && !pr.finished && (r.route.closed ? pr.lap >= r.laps - 1 : pr.s > r.route.length * 0.72);
      if (fin && !this.finalAnnounced) { this.finalAnnounced = true; if (!r.route.closed) this.toast('Final stretch', null, 'hot'); }
      M.setFinal(fin);
      M.setLevel(r.state === 'countdown' ? 1 : fin ? 3 : 2);
    }
  }
  showTitle() {
    this.state = 'title'; this.savesOpen = false; this.screen('saves', false); this.mpOpen = false; this.screen('mpScreen', false);
    this.carCards($('titleCars'), (vid) => { if (vid !== this.player.spec.id) this.spawnPlayer(vid); }, { sel: this.player.spec.boat ? this.landVehicle : this.vehicle });
    this.liveryChips($('titleLivs'));
    this.refreshMenu();
    this.screen('title', true); $('hud').classList.remove('on');
  }
  enterFree() {
    this.screen('title', false); this.screen('splash', false); this.state = 'free'; $('hud').classList.add('on'); this.rig.snap();
    this.story.d.preload(); this.story.onFreeRoam();
    $('racebox').hidden = true; $('freebox').hidden = false;
  }
  togglePause(on) {
    if (on === undefined) on = this.state !== 'pause';
    if (on) {
      if (!['free', 'race'].includes(this.state)) return;
      this.prevState = this.state; this.state = 'pause';
      this.carCards($('pauseCars'), (vid) => { if (this.race) return; this.spawnPlayer(vid); }, { boats: true });
      $('pauseCars').hidden = !!this.race; $('garageLabel').hidden = !!this.race;
      this.liveryChips($('pauseLivs')); $('pauseLivs').hidden = !!this.race; $('livLabel').hidden = !!this.race;
      this.challengeBoard($('pauseChal'));
      $('mpLabel').hidden = $('pauseMp').hidden = !this.mp; if (this.mp) this.mpListInto($('pauseMp'));
      this.refreshPauseButtons(); this.screen('pause', true);
    } else if (this.state === 'pause') { this.state = this.prevState; this.screen('pause', false); this.last = performance.now(); }
  }
  useDock() {
    if (this.state !== 'free' || !this.nearDock) return;
    if (this.player.spec.boat) this.spawnPlayer(this.landVehicle);
    else if (this.story.carUnlocked('boat')) this.spawnPlayer('boat');
    this.audio.start();
  }
  requestReset() {
    const c = this.player; if (c.wrecked) return;
    if (this.race) { const p = this.race.respawnPoint(c); c.reset(p.x, p.z, p.yaw, this.world.terrain, 0.6, p.y); }
    else this.freeRespawn(c, 1.2);
    this.rig.snap();
  }
  freeRespawn(c, lift) {
    if (c.under) {
      const R = this.world.route('metro'), s = R.project(c.pos.x, c.pos.z, 0, -1).s, q = R.posAt(s, {}), [dx, dz] = R.dirAt(s);
      const l = this.world.metroLane(q.x, q.z);
      c.reset(q.x - dz * l, q.z + dx * l, Math.atan2(-dx, -dz), this.world.terrain, lift, q.y); return;
    }
    const p = c.spec.boat ? this.world.findWetSpot(c.pos.x, c.pos.z) : this.world.findDrySpot(c.pos.x, c.pos.z);
    c.reset(p.x, p.z, p.yaw !== null ? p.yaw : c.yaw(), this.world.terrain, lift);
  }
  toast(text, small, cls) {
    const el = document.createElement('div'); el.className = 'toast ' + (cls || ''); el.innerHTML = text + (small ? `<small>${small}</small>` : '');
    const box = $('toasts'); box.appendChild(el); while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => el.remove(), 1900);
  }
  /* ----- main loop ----- */
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const I = this.input;
    if (this.state === 'splash' && (I.pressed.size || (I.padButtons && I.padButtons.length))) { I.pressed.clear(); this.startIntro(); }
    if (this.state === 'intro' && (I.was('Escape') || I.was('Enter') || I.was('Space') || I.padPressed(0) || I.padPressed(9))) { I.pressed.clear(); this.endIntro(); }
    if (this.state === 'storyintro' && (I.was('Escape') || I.was('Enter') || I.was('Space') || I.padPressed(0) || I.padPressed(9))) { I.pressed.clear(); this.endStoryIntro(); }
    // global keys
    if (I.was('Escape') || I.padPressed(9)) { if (this.state === 'map') this.toggleMap(false); else if (this.state === 'event') this.closeEventScreen(); else this.togglePause(); }
    if ((I.was('KeyM') || I.padPressed(8)) && ['free', 'race', 'map'].includes(this.state)) this.toggleMap();
    if (I.was('KeyC') || I.padPressed(3)) this.rig.mode = (this.rig.mode + 1) % 3;
    if (this.state === 'title' && this.mpOpen) { if (I.was('Escape') || I.padPressed(1)) { I.pressed.clear(); this.showMp(false); } }
    else if (this.state === 'title' && this.savesOpen) {
      if (I.was('Escape') || I.padPressed(1)) { I.pressed.clear(); this.showSaves(false); }
      else for (let i = 0; i < SAVE_SLOTS; i++) if (I.was('Digit' + (i + 1)) || I.was('Numpad' + (i + 1))) this.startMode('story', i, !Store.data.slots[i]);
    }
    else if (this.state === 'title') {
      if (I.was('KeyN')) this.newGame();
      else if (I.was('KeyL') && Store.data.slots.some(Boolean)) this.showSaves(true);
      else if (I.was('Digit1') || I.was('Numpad1')) this.startMode('story');
      else if (I.was('Digit2') || I.was('Numpad2')) this.startMode('free');
      else if (I.was('Digit3') || I.was('Numpad3')) this.showMp(true);
      else if (I.was('Enter') || I.padPressed(0)) this.startMode(Store.data.mode === 'free' ? 'free' : 'story');
    }
    else if (this.state === 'event' && (I.was('Enter') || I.padPressed(0))) { this.audio.start(); this.startEvent(this.pendingEvent, this.pendingVehicle || this.vehicle); }
    else if (this.state === 'results' && (I.was('Enter') || I.padPressed(0))) this.endEvent();
    if (I.keys.size || I.usingPad) this.audio.start();
    // a session never stops for one driver's menu: the world keeps turning while you're paused
    const running = ['free', 'race', 'title', 'results', 'splash', 'intro', 'storyintro'].includes(this.state) || (!!this.mp && this.inWorld());
    const inp = I.poll(dt);
    if (running) this.simulate(dt, inp);
    if (this.mp) this.mp.update(dt);
    this.gfx.time.value += dt;
    this.renderFrame(dt);
    I.endFrame();
  }
  simulate(dt, inp) {
    const W = this.world, P = this.player, I = this.input;
    // player controls
    if (this.state === 'free' || this.state === 'race') {
      Object.assign(P.input, inp);
      if (I.was('KeyR') || I.padPressed(2)) this.requestReset();
      this.rig.back = I.keys.has('KeyB') || (I.padButtons && navigator.getGamepads && (() => { const p = [...navigator.getGamepads()].find((q) => q && q.connected); return p && p.buttons[5] && p.buttons[5].pressed; })());
    } else { P.input.throttle = 0; P.input.brake = 0; P.input.handbrake = 1; P.input.steer = 0; P.input.boost = 0; }
    if (this.state === 'free' && (I.was('Enter') || I.padPressed(0))) { if (this.nearSpot) this.openEventScreen(this.nearSpot.ev); else if (this.nearDock) this.useDock(); }
    // slow motion after wrecks
    if (this.slowmo > 0) { this.slowmo -= dt; this.timeScale = lerp(this.timeScale, 0.3, 0.2); } else this.timeScale = lerp(this.timeScale, 1, 0.1);
    const sdt = dt * this.timeScale * (this.intro ? this.intro.slow : 1);
    // AI
    const race = this.race;
    if (race) {
      race.update(sdt);
      const pl = race.prog.get(P);
      for (const a of this.ai) {
        const ap = race.prog.get(a.car);
        let rubber = 1;
        if (!ap.finished && this.ai.length) { const gap = (pl.total - ap.total); rubber = clamp(1 + gap * 0.00012, 0.94, 1.07); }
        a.update(sdt, W.cars, ap.finished ? 0.7 : rubber);
      }
      // countdown
      if (race.state === 'countdown') {
        const n = Math.ceil(3.6 - race.t - 0.6);
        if (n !== this.countLast && n >= 1 && n <= 3) { this.countLast = n; $('countdown').textContent = n; $('countdown').className = 'shadow'; this.audio.oneShot('beep'); }
      } else if (!this.raceAnnounced) { this.raceAnnounced = true; $('countdown').textContent = 'GO'; $('countdown').className = 'go shadow'; this.audio.oneShot('go'); setTimeout(() => { if ($('countdown').textContent === 'GO') $('countdown').textContent = ''; }, 900); }
      if (race.state === 'finished' && this.state === 'race' && race.t - race.finishT > 2.2) this.showResults();
    } else {
      const now = mpNow(); // in a session, the host's rivals come over the wire
      for (const a of this.roamers) if (!this.ghostDrive(a, now, dt)) a.update(sdt, W.cars, 1);
      this.traffic.update(sdt);
      if (this.intro) for (const a of this.intro.ai) a.update(sdt, W.cars, 1.1);
    }
    this.story.update(dt, this.state === 'free');
    // physics
    this.acc += sdt; const h = 1 / 240; let n = 0;
    while (this.acc >= h && n < 14) { W.step(h); this.acc -= h; n++; }
    if (n >= 14) this.acc = 0;
    W.props.update(sdt);
    // car events & respawns
    for (const c of W.cars) this.handleEvents(c);
    for (const a of (race ? this.ai : this.roamers)) {
      const c = a.car; if (c.remote) continue;
      const off = race ? race.prog.get(c).off > 6 : false;
      if ((c.wrecked && c.wreckT > 3) || a.respawn || off) {
        if (race) { const p = race.respawnPoint(c); c.reset(p.x, p.z, p.yaw, W.terrain, 0.5, p.y); }
        else { const s = a.s - 10; const p = a.route.posAt(s, {}), [dx, dz] = a.route.dirAt(s); c.reset(p.x, p.z, Math.atan2(-dx, -dz), W.terrain, 0.5, p.y); }
        a.respawn = false; a.stuck = 0;
      }
    }
    if (P.wrecked && P.wreckT > 2.8) {
      if (race) { const p = race.respawnPoint(P); P.reset(p.x, p.z, p.yaw, W.terrain, 0.6, p.y); }
      else this.freeRespawn(P, 1.5);
      this.rig.snap();
    }
    // auto-flip the player if stuck on the roof/side
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(P.q).y;
    this.flipT = (upY < 0.3 && P.vel.length() < 2 && !P.wrecked) ? (this.flipT || 0) + dt : 0;
    if (this.flipT > 2) { this.requestReset(); this.flipT = 0; }
    if (race && race.state !== 'countdown' && race.prog.get(P).off > 8 && !P.wrecked) { this.requestReset(); this.toast('Back on track', null, ''); }
    if (this.state === 'free' || this.state === 'race') this.trackStats(sdt);
  }
  /* story challenge progress from the player's driving */
  trackStats(dt) {
    const P = this.player, S = this.story, T = this.world.terrain;
    if (S.free || P.wrecked || dt <= 0) return;
    const v = P.vel.length();
    if (P.speedKmh > (S.stats.speed || 0) + 1) S.stat('speed', Math.min(P.speedKmh, 400));
    if (P.spec.boat) { if (P.inWater && v > 1) S.stat('sailor', v * dt, 'add'); return; }
    // one unbroken slide: the car pointing 17° or more off where it is going, with a moment's grace to link corners
    const f = (this._fwd || (this._fwd = new THREE.Vector3())).set(0, 0, -1).applyQuaternion(P.q), vf = P.vel.dot(f);
    const slide = P.onGround && !P.reverse && v > 50 / 3.6 && vf > 0 && Math.acos(clamp(vf / v, -1, 1)) > 0.3;
    if (slide) { this.driftT = (this.driftT || 0) + dt; this.driftGap = 0; S.stat('drift', Math.min(this.driftT, 30)); }
    else if ((this.driftGap = (this.driftGap || 0) + dt) > 0.3) this.driftT = 0;
    if (P.onGround && P.pos.x > CITY.x0 - 30) { const r = T.rampAt(P.pos.x, P.pos.z); if (r) this.lastRamp = { k: this.world.city.ramps.indexOf(r), t: this.world.time }; }
    const gi = T.gi(P.pos.x, P.pos.z), rid = T.rown[gi], R = rid && T.routes[rid - 1];
    if (R && R.def.country && P.onGround && v > 2 && T.rdist[gi] < R.width / 2 + 3) S.stat('country', v * dt, 'add');
    if (P.under && P.onGround && v > 2) S.stat('metro', v * dt, 'add');
  }
  handleEvents(c) {
    const isP = c === this.player, fx = this.gfx.fx;
    for (const e of c.events) {
      if (e.type === 'wreck') {
        fx.explosion(c.pos.x, c.pos.y, c.pos.z);
        const near = c.pos.distanceTo(this.player.pos) < 120;
        if (near) this.audio.oneShot('boom');
        if (isP) {
          if (this.audio.music) this.audio.music.duck(0.85, 1.4);
          this.slowmo = this.mp ? 0 : 1.3; this.rig.shake = 2.5; this.rig.orbitA = Math.atan2(this.rig.pos.z - c.pos.z, this.rig.pos.x - c.pos.x); // no slow-mo in a session: its clock runs on for everyone
          const by = c.lastHit && this.world.time - c.lastHitT < 1.5 ? c.lastHit.name : null;
          this.toast('Wrecked', e.reason === 'overheat' ? 'Engine overheated' : e.reason === 'drowned' ? 'Drowned' : e.reason === 'train' ? 'Flattened by the Coastline Freight' : by ? `Taken out by ${by}` : 'Hit too hard', 'bad');
          this.story.onWreck(e.reason);
        } else if (c.lastHit === this.player && this.world.time - c.lastHitT < 2) {
          if (c.civilian) this.toast('Traffic wrecked', 'Calder County will hear about this', '');
          else { this.takedowns++; this.toast('Takedown', c.name, 'hot'); if (this.race) this.story.stat('takedown', 1, 'inc'); }
          this.rig.shake = Math.max(this.rig.shake, 1);
        }
      } else if (e.type === 'land' && isP) {
        this.rig.shake = Math.max(this.rig.shake, Math.min(1.4, e.air * 0.6));
        fx.burst(c.pos.x, c.pos.y - 0.5, c.pos.z, 10, c.surfaceMud > 0.3 ? 2 : 0);
        this.audio.oneShot('thud', e.air * 0.5);
        if (e.air > 1.4) this.toast(`Big air ${e.air.toFixed(1)}s`, null, 'hot');
        if (!c.spec.boat) this.story.stat('air', Math.min(e.air, 9));
        if (this.lastRamp && e.air > 0.5 && this.world.time - this.lastRamp.t < e.air + 0.6) { this.story.stat('ramps', this.lastRamp.k, 'key'); this.lastRamp = null; }
      } else if ((e.type === 'bump' || e.type === 'hit') && isP) {
        if (e.v > 3) { this.rig.shake = Math.max(this.rig.shake, Math.min(1.5, e.v * 0.08)); this.audio.oneShot('crash', e.v / 15); fx.sparks(c.pos.x, c.pos.y, c.pos.z, Math.min(30, e.v * 2)); }
      } else if (e.type === 'scrape' && isP) { if (e.v > 5) { this.rig.shake = Math.max(this.rig.shake, 0.5); this.audio.oneShot('thud', e.v / 12); } }
      else if (e.type === 'prop' && isP) { this.audio.oneShot('thud', 0.5); }
      else if (e.type === 'lap' && isP) { const last = this.race.prog.get(c).lastLap; this.toast(e.lap === this.race.laps ? 'Final lap' : `Lap ${e.lap}`, `Last lap ${fmtTime(last)}`); }
      else if (e.type === 'finish' && isP) { this.toast('Finish', null, 'hot'); c.input.throttle = 0; if (this.mp) { const pr = this.race.prog.get(c); this.mp.broadcast({ k: 'fin', time: pr.time, best: pr.best }, true); } }
      else if (e.type === 'finish' && this.state === 'results') this.renderResults(); // rivals still crossing the line after you
    }
    c.events.length = 0;
    c.impact *= 0.9;
  }
  /* ----- rendering + HUD ----- */
  renderFrame(dt) {
    const P = this.player, W = this.world;
    W.terrain.probeY = P.under ? Math.min(P.pos.y, METRO.under - 0.5) : P.pos.y + 1; // camera, dust and marks follow the player's level
    this.renderFrameAt(dt);
    W.terrain.probeY = Infinity;
  }
  renderFrameAt(dt) {
    const g = this.gfx, P = this.player, W = this.world;
    const sdt = !this.mp && (this.state === 'pause' || this.state === 'map' || this.state === 'event') ? 0 : dt * this.timeScale;
    // views
    for (const [car, view] of this.views) {
      const d = car.pos.distanceTo(g.camera.position);
      view.root.visible = !car.hidden && (d < 900 || car === P);
      if (!view.root.visible) continue;
      view.update(sdt);
      if (sdt > 0) view.effects(sdt, g.fx, g.marks, d < 160);
    }
    if (sdt > 0) { g.fx.update(sdt); g.marks.update(sdt); g.fx.campfire(g.bonfire, sdt); }
    g.updateProps(false);
    if (g.fireLight) g.fireLight.intensity = 26 + Math.random() * 10;
    g.waterNormal.offset.set(g.time.value * 0.01, g.time.value * 0.006);
    for (const b of g.beacons) { b.ring.rotation.z += dt * 0.4; b.beam.material.uniforms.uFade.value = clamp((Math.hypot(b.x - g.camera.position.x, b.z - g.camera.position.z) - 5) / 30, 0.08, 1); }
    // camera
    if (this.state === 'intro' && this.intro) { this.intro.update(dt); if (this.intro.done()) this.endIntro(); }
    else if (this.state === 'storyintro' && this.sintro) { this.sintro.update(dt); if (this.sintro.done()) this.endStoryIntro(); }
    else if (this.state === 'splash') this.rig.update(dt, P, { orbit: true, orbitSpeed: 0.04, radius: 170, height: 60, fov: 48 });
    else if (this.state === 'title') this.rig.update(dt, P, { orbit: true, orbitSpeed: 0.12, radius: 11, height: 3, fov: 50 });
    else if (P.wrecked && P.wreckT < 2.8) this.rig.update(dt, P, { orbit: true, orbitSpeed: 0.5, radius: 10, height: 4 });
    else this.rig.update(dt, P, this.race && this.race.route.def.street ? { far: 1.2 } : undefined);
    g.updateTrain(); g.updateMetroTrain();
    if (sdt > 0) { g.updateCrossings(sdt, g.time.value); g.updateSignals(g.time.value); g.updateTunnelGate(g.time.value); g.updateRailGates(sdt); }
    this.trainAudio(dt);
    g.updateSun(this.sintro ? this.sintro.focus : P.pos);
    g.updateCulling(g.camera.position);
    g.render();
    this.updateHUD(dt);
    this.updateTouchVisibility();
    this.updateMusic(dt);
    // audio
    let nearest = null;
    for (const c of W.cars) { if (c === P) continue; const d = c.pos.distanceTo(P.pos); if (!nearest || d < nearest.d) nearest = { d, car: c }; }
    this.audio.update(P, nearest);
  }
  trainAudio(dt) {
    const P = this.player, A = this.audio, near = (T) => Math.hypot(T.cars[0].pose.x - P.pos.x, T.cars[0].pose.z - P.pos.z);
    const T = this.world.trains.reduce((a, b) => (near(b) < near(a) ? b : a)), dh = near(T);
    this.hornT = (this.hornT || 0) - dt;
    if (dh < 420 && T.v > 6 && this.hornT <= 0) { A.horn(clamp(1.3 - dh / 420, 0.2, 1)); this.hornT = 9 + Math.random() * 6; }
    // down in the metro: a train sounds off when you're on its track in front of it
    this.metroHornT = (this.metroHornT || 0) - dt;
    if (P.under && this.metroHornT <= 0) for (const mt of this.world.metroTrains) {
      if (mt.v < 3) continue;
      const pr = mt.R.project(P.pos.x, P.pos.z, mt.s, 200), ahead = mt.ahead(pr.s);
      if (pr.dist < 2.2 && ahead < 170) { A.horn(clamp(1.4 - ahead / 170, 0.4, 1)); this.metroHornT = 3.5; break; }
    }
    let bell = 0;
    for (const c of this.world.crossings) if (c.active) { const d = Math.hypot(c.x - P.pos.x, c.z - P.pos.z); bell = Math.max(bell, clamp(1 - d / 220, 0, 1)); }
    A.bell(bell, this.gfx.time.value);
    A.rumble(clamp(1 - dh / 160, 0, 1) * clamp(T.v / 20, 0, 1));
  }
  /* ----- multiplayer ----- */
  inWorld() { return ['free', 'race', 'pause', 'map', 'event', 'results'].includes(this.state); }
  goMenu() {
    if (this.race) return;
    if (this.mp) this.leaveMp();
    this.screen('pause', false); this.screen('mapScreen', false);
    this.story.d.skip(); this.story.d.queue.length = 0;
    this.showTitle();
  }
}
