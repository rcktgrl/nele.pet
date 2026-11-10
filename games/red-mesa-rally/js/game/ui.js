'use strict';
/* Red Mesa Rally · Game: building the menu pages (car cards, liveries, challenge board) and wiring every button */

Object.assign(Game.prototype, {
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
  },
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
  },
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
  },
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
    // zoom and pan: wheel at the cursor, drag, pinch, the buttons and +/- keys (pins stay clickable on top of the canvas)
    const cv = $('bigmap'), toCv = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * MAP_W, (e.clientY - r.top) / r.height * MAP_H, MAP_W / r.width]; };
    this.mapViewSet(1, MAP_W / 2, MAP_H / 2);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = toCv(e); this.mapZoomAt(Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1)), x, y); }, { passive: false });
    const ptrs = new Map(); let pinch = 0;
    cv.addEventListener('pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ } ptrs.set(e.pointerId, toCv(e)); cv.classList.add('drag'); pinch = 0; });
    cv.addEventListener('pointermove', (e) => {
      const old = ptrs.get(e.pointerId); if (!old) return; const now = toCv(e), v = this.mapView;
      if (ptrs.size === 1) this.mapViewSet(v.z, v.cx - (now[0] - old[0]) / v.z, v.cy - (now[1] - old[1]) / v.z);
      else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.entries()].map(([id, p]) => (id === e.pointerId ? now : p)), d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.mapZoomAt(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch = d;
      }
      ptrs.set(e.pointerId, now);
    });
    const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) cv.classList.remove('drag'); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    const step = (f) => this.mapZoomAt(f, MAP_W / 2, MAP_H / 2);
    $('btnMapIn').addEventListener('click', () => step(1.6)); $('btnMapOut').addEventListener('click', () => step(1 / 1.6));
    $('btnMapFit').addEventListener('click', () => this.mapViewSet(1, MAP_W / 2, MAP_H / 2));
    // the player's own marker sits above every pin so it can never be hidden
    const me = this.mapMe = document.createElement('div'); me.className = 'mapme';
    me.innerHTML = '<b></b><i></i><span>You</span>'; wrap.appendChild(me);
    this.refreshPauseButtons();
  },
  refreshPauseButtons() {
    $('btnQuality').textContent = 'Quality: ' + this.quality;
    const inRace = !!this.race;
    $('btnQuit').hidden = !inRace; $('btnRestart').hidden = !inRace || (!!this.mp && !this.mp.isHost);
    $('pauseTitle').textContent = inRace ? this.race.ev.name : this.mp ? 'Multiplayer · ' + this.mp.code : this.story.free ? 'Free roam' : 'Story · ' + this.story.chapterName();
    $('btnMenu').hidden = inRace; $('btnMenu').textContent = this.mp ? 'Leave session' : 'Main menu';
  },
});
