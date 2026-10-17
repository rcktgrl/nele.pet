'use strict';
/* Red Mesa Rally · Game: event screen, starting and ending events, results */

Object.assign(Game.prototype, {
  typeLabel(ev) { return ev.type === 'race' ? `Race · ${ev.laps} laps · ${ev.ai} rivals` : ev.type === 'sprint' ? `Sprint · point to point · ${ev.ai} rivals` : this.world.route(ev.route).closed ? `Time attack · ${ev.laps} laps · solo` : 'Time attack · point to point · solo'; },
  openEventScreen(ev) {
    if (this.state !== 'free') return;
    this.state = 'event'; this.pendingEvent = ev; this.pendingVehicle = ev.boat ? 'boat' : VEHICLES[this.vehicle].boat ? this.landVehicle : this.vehicle;
    $('evType').textContent = this.typeLabel(ev); $('evName').textContent = ev.name; $('evBlurb').textContent = ev.blurb;
    const best = Store.data.best[ev.id];
    const chips = [`${Math.round(this.world.route(ev.route).length * (ev.type === 'sprint' ? 1 : ev.laps) / 100) / 10} km`, best ? `Your best ${fmtTime(best.time)}` : 'No time set'];
    if (ev.medals) chips.push(`Gold ${fmtTime(ev.medals[0])}`, `Silver ${fmtTime(ev.medals[1])}`, `Bronze ${fmtTime(ev.medals[2])}`);
    $('evChips').innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');
    if (ev.boat) $('evCars').innerHTML = ''; // boats only: everyone races the Skiff
    else this.carCards($('evCars'), (vid) => { this.pendingVehicle = vid; }, { sel: this.pendingVehicle });
    this.refreshEventStart();
    this.eventOnline(ev);
    this.screen('eventScreen', true);
  },
  refreshEventStart() {
    const M = this.mp, b = $('btnStart');
    b.disabled = !!M && !M.isHost;
    b.textContent = !M ? 'Start event' : M.isHost ? (M.peers.size ? 'Start for everyone' : 'Start event') : 'The host starts events';
  },
  /* in a session the host starts an event for every driver on the map */
  launchEvent(ev, vid) {
    this.audio.start();
    if (!this.mp) { this.startEvent(ev, vid); return; }
    if (!this.mp.isHost) return;
    const order = this.mp.raceOrder();
    this.mp.broadcast({ k: 'race', ev: ev.id, order }, true);
    this.startEvent(ev, vid, order);
  },
  closeEventScreen() { this.screen('eventScreen', false); this.state = 'free'; this.cooldownSpot = this.nearSpot; this.last = performance.now(); },
  /* ----- events ----- */
  startEvent(ev, vid, mpOrder) {
    this.screen('eventScreen', false); this.screen('results', false);
    this.clearRoamers(); this.traffic.clear();
    if (ev.boat) vid = 'boat';
    else if (VEHICLES[vid].boat || !this.story.carUnlocked(vid)) vid = this.story.carUnlocked(this.landVehicle) ? this.landVehicle : 'buggy';
    if (vid !== this.player.spec.id) this.spawnPlayer(vid);
    this.vehicle = vid;
    const R = this.world.route(ev.route);
    const cars = [this.player];
    const others = ['rally', 'buggy', 'truck'].filter((k) => k !== vid);
    const crewCol = [0x16181c, 0x2a7de1, 0xe9e2d6, 0xb0161e, 0x6b2d8c, 0xf2c230];
    if (mpOrder) for (const id of mpOrder) { const p = this.mp && this.mp.peers.get(id); if (p && p.car && !p.car.hidden) cars.push(p.car); }
    else for (let i = 0; i < ev.ai; i++) {
      let v, name, color = AI_COLORS[i % AI_COLORS.length], helmet = AI_COLORS[(i + 3) % AI_COLORS.length], number = [12, 23, 4, 88, 51, 66][i];
      if (ev.aiCars) { v = ev.aiCars[i % ev.aiCars.length]; name = CREW_NAMES[i]; color = crewCol[(i + 1) % crewCol.length]; }
      else { v = i === 2 ? others[0] : i === 4 ? others[1] : (VEHICLES[vid].offroad ? vid : 'rally'); name = AI_NAMES[i]; }
      if (ev.boat) v = 'boat';
      if ((ev.boss || ev.vic) && i === 0) { v = 'ironside'; name = 'Vic Calder'; color = 0x0d0d0f; helmet = 0xd4af37; number = 1; }
      const car = this.addCar(VEHICLES[v], { id: i + 1, color, number, helmet, livery: ev.aiCars ? 'CALDER CREW' : undefined });
      car.name = name; cars.push(car);
    }
    const race = this.race = new Race(this.world, ev, cars, this.player);
    if (R.def.metro) this.world.resetMetro();
    this.world.parkTrains(true);
    // grid: player starts mid-pack; in a session everyone takes the slot the host's order gives them
    const order = [...cars]; if (order.length > 1) { order.splice(0, 1); order.splice(Math.min(3, order.length), 0, this.player); }
    this.ai = [];
    if (mpOrder) { const i = mpOrder.indexOf(this.mp.id), g = race.gridSlot(i < 0 ? mpOrder.length : i); this.player.reset(g.x, g.z, g.yaw, this.world.terrain, 0.3, g.y); this.player.heat = 0; }
    else order.forEach((c, i) => {
      const g = race.gridSlot(i); c.reset(g.x, g.z, g.yaw, this.world.terrain, 0.3, g.y); c.heat = 0;
      if (c !== this.player) this.ai.push(new AIDriver(c, R, { s: g.s, lane: (i % 2 ? 1 : -1) * 2.4, metro: R.def.metro ? this.world.metroTrains : null, skill: (c.name === 'Vic Calder' ? 0.99 : 0.9 + ((i * 7) % 5) * 0.022), aggr: c.name === 'Vic Calder' ? 0.9 : 0.35 + ((i * 3) % 4) * 0.15, seed: i + 11 }));
    });
    // gates
    const G = this.gfx.gates; while (G.children.length) G.remove(G.children[0]);
    // down in the metro the trains fill the tube to within a hand of the ceiling: the arch and the gates become thin boards up there
    const board = (s, mat) => {
      const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s), l = (METRO.wallL + METRO.wallR) / 2, w = METRO.wallR - METRO.wallL - 0.2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, 0.15), mat); b.position.set(p.x - dz * l, METRO.ceil - 0.35, p.z + dx * l); b.rotation.y = Math.atan2(dx, dz); return b;
    };
    const arch = (s) => { if (R.def.metro) { const t = this.gfx.bannerTex.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2.5; t.needsUpdate = true; return board(s, new THREE.MeshBasicMaterial({ map: t })); } const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); return this.gfx.makeArch(p.x, p.z, Math.atan2(dx, dz), null); };
    G.add(arch(R.closed ? 0 : 2)); if (!R.closed) G.add(arch(race.finishS));
    const nG = Math.max(4, Math.round(R.length / 320));
    for (let i = 1; i < nG; i++) {
      const s = R.length * i / nG;
      if (R.def.metro) { G.add(board(s, new THREE.MeshBasicMaterial({ color: new THREE.Color(EVENT_COLORS[ev.id]).multiplyScalar(1.6) }))); continue; }
      const p = R.posAt(s, {}), [dx, dz] = R.dirAt(s); G.add(this.gfx.makeGate(p.x, p.z, Math.atan2(dx, dz), EVENT_COLORS[ev.id]));
    }
    // the street circuit hides its corners behind buildings: board and paint every one of them
    if (R.def.metro) { /* the tube walls do the warning */ }
    else if (R.def.street) this.gfx.addTurnMarkers(R, EVENT_COLORS[ev.id], G);
    else if (R.surface === 'asphalt' || R.def.noCarve) this.gfx.addTurnMarkers(R, EVENT_COLORS[ev.id], G, { sharpOnly: true });
    G.visible = true;
    for (const s of this.eventSpots) { s.beacon.beam.visible = false; s.beacon.ring.visible = false; s.label.style.display = 'none'; }
    this.state = 'race'; this.countLast = 4; this.raceAnnounced = false; this.finalAnnounced = false; this.musicMode = null;
    $('racebox').hidden = false; $('freebox').hidden = true; $('prompt').classList.remove('on');
    this.rig.snap(); this.takedowns = 0; this.waypoint = null;
    this.audio.start();
  },
  endEvent(silent) {
    this.screen('results', false);
    if (this.ai) for (const a of this.ai) this.removeCar(a.car);
    this.ai = []; this.race = null;
    this.world.parkTrains(false); this.world.metroLive = false;
    const G = this.gfx.gates; while (G.children.length) G.remove(G.children[0]);
    for (const s of this.eventSpots) { s.beacon.beam.visible = !s.hidden; s.beacon.ring.visible = !s.hidden; s.label.style.display = ''; }
    this.refreshStory();
    this.player.frozen = false;
    this.spawnRoamers(); this.traffic.spawn();
    if (!silent) { this.state = 'free'; $('hud').classList.add('on'); $('racebox').hidden = true; $('freebox').hidden = false; $('countdown').textContent = ''; this.cooldownSpot = this.nearestSpot(); }
    this.last = performance.now();
  },
  nearestSpot() { let best = null, bd = 1e9; for (const s of this.eventSpots) { if (s.hidden) continue; const d = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z); if (d < bd) { bd = d; best = s; } } return bd < 40 ? best : null; },
  showResults() {
    const race = this.race, ev = race.ev, P = race.prog.get(this.player);
    const st = race.standings(); const pos = st.indexOf(this.player) + 1;
    let note = '', title;
    const playerTime = ev.type === 'race' || ev.type === 'sprint' || ev.type === 'time' ? P.time : 0;
    if (ev.type === 'time') {
      const m = ev.medals; title = playerTime <= m[0] ? 'Gold' : playerTime <= m[1] ? 'Silver' : playerTime <= m[2] ? 'Bronze' : 'No medal';
      note = `Total ${fmtTime(playerTime)} · best lap ${fmtTime(P.best)}`;
    } else { title = `${pos}${ordinal(pos).toLowerCase()} place`; note = `${fmtTime(playerTime)} · best lap ${fmtTime(P.best)}${this.takedowns ? ` · ${this.takedowns} takedown${this.takedowns > 1 ? 's' : ''}` : ''}`; }
    const won = ev.type === 'time' ? playerTime <= ev.medals[1] : pos === 1;
    this.story.onResult(ev, won);
    if (ev.boss && won) title = 'The valley is yours';
    const rec = Store.data.best[ev.id];
    if (!rec || playerTime < rec.time) { Store.data.best[ev.id] = { time: playerTime, vehicle: this.player.spec.id }; Store.save(); note += ' · New personal best'; }
    $('resEyebrow').textContent = `${ev.name} · results`; $('resTitle').textContent = title; $('resNote').textContent = note;
    this.renderResults();
    this.resultsOnline(ev, playerTime, P.best, this.player.spec.id);
    $('btnRetry').hidden = !!this.mp && !this.mp.isHost; $('btnRetry').textContent = this.mp ? 'Rematch' : 'Retry';
    this.screen('results', true);
    this.state = 'results';
  },
  renderResults() {
    const race = this.race, st = race.standings(), lead = race.prog.get(st[0]);
    $('resTable').innerHTML = st.map((c, i) => {
      const p = race.prog.get(c);
      const t = p.dnf ? 'Left' : p.finished ? (i === 0 ? fmtTime(p.time) : '+' + (p.time - lead.time).toFixed(2)) : 'Still racing';
      return `<tr class="${c === this.player ? 'me' : ''}"><td>${i + 1}</td><td>${c === this.player ? 'You' : esc(c.name)}</td><td class="muted">${c.spec.name}</td><td class="t">${t}</td></tr>`;
    }).join('');
  },
});
