'use strict';
/* Red Mesa Rally · Game: dashboard, race box, waypoint and turn hints */

Object.assign(Game.prototype, {
  updateHUD(dt) {
    const P = this.player, g = this.gfx;
    // speedometer
    $('hSpeed').textContent = Math.round(P.speedKmh);
    $('hGear').textContent = P.reverse ? 'R' : (P.speedKmh < 1 && P.input.throttle < 0.1 ? 'N' : P.gear);
    const rf = clamp(P.rpm / P.spec.engine.red, 0, 1);
    $('rpmArc').setAttribute('stroke-dasharray', `${(rf * 400).toFixed(1)} 400`);
    const nOn = Math.round(P.heat * 14);
    this.heatCells.forEach((c, i) => { c.className = i < nOn ? (i >= HEAT_ZONE_CELL ? 'hot' : 'on') : (i >= HEAT_ZONE_CELL ? 'zone' : ''); });
    const danger = P.heat > HEAT_RED && !P.wrecked && ['free', 'race'].includes(this.state);
    $('heat').classList.toggle('warn', danger);
    $('heatWarn').textContent = danger ? 'Overheating' : P.boosting ? 'Boosting' : '';
    const oh = $('overheat'), k = clamp((P.heat - HEAT_RED) / (1 - HEAT_RED), 0, 1);
    oh.classList.toggle('on', danger);
    oh.style.opacity = danger ? (0.75 + 0.25 * k).toFixed(2) : 0;
    oh.style.setProperty('--rate', (0.7 - 0.5 * k).toFixed(2) + 's');
    $('ohSub').textContent = k > 0.75 ? 'About to blow' : P.boosting ? 'Ease off the boost' : 'Cooling down';
    this.audio.alarm(danger ? k : -1);
    $('speedlines').style.opacity = P.boosting ? 1 : clamp((P.speedKmh - 120) / 80, 0, 0.6);
    // race box
    const race = this.race;
    if (race) {
      const st = race.standings(), pos = st.indexOf(P) + 1, pr = race.prog.get(P);
      if (race.ev.type === 'time') $('hPos').innerHTML = `<span style="font-size:.55em">TIME ATTACK</span>`;
      else $('hPos').innerHTML = `${pos}<small>${ordinal(pos)}</small><span class="of">/${st.length}</span>`;
      $('hLap').textContent = race.route.closed ? `Lap ${clamp(pr.lap + 1, 1, race.laps)}/${race.laps}` : `${Math.round(clamp(pr.s / race.route.length, 0, 1) * 100)}% of the stage`;
      $('hClock').textContent = fmtTime(race.state === 'countdown' ? 0 : (pr.finished ? pr.time : race.clock));
      const best = Store.data.best[race.ev.id];
      $('hBest').textContent = race.route.closed ? `Best lap ${fmtTime(pr.best)}${best ? ' · record ' + fmtTime(best.time) : ''}` : (best ? `Record ${fmtTime(best.time)}` : 'No record yet');
      const ww = pr.wrongWay > 1.2 ? 'Wrong way' : (pr.off > 2 ? 'Return to the track' : '');
      $('warn').textContent = ww; $('warn').style.display = ww ? 'block' : 'none';
      this.turnHint(race, pr);
    } else { $('warn').style.display = 'none'; $('turn').classList.remove('on'); }
    // free-roam: beacons + prompt
    this.nearSpot = null;
    const cam = g.camera, w = innerWidth, h = innerHeight, v = new THREE.Vector3();
    const placed = [];
    const spots = [...this.eventSpots].sort((a, b) => Math.hypot(a.x - P.pos.x, a.z - P.pos.z) - Math.hypot(b.x - P.pos.x, b.z - P.pos.z));
    for (const s of spots) {
      const d = Math.hypot(s.x - P.pos.x, s.z - P.pos.z);
      if (s.hidden) { s.label.style.display = 'none'; continue; }
      if (this.state === 'free' && d < 12 && s !== this.cooldownSpot) this.nearSpot = s;
      if (this.cooldownSpot === s && d > 22) this.cooldownSpot = null;
      // label
      v.set(s.x, s.beacon.y + 9 + Math.min(40, d * 0.05), s.z).project(cam);
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      let vis = !this.race && v.z < 1 && ['free', 'map', 'pause', 'event'].includes(this.state) && d > 18;
      if (vis && placed.some(([x, y]) => Math.abs(x - sx) < 150 && Math.abs(y - sy) < 44)) vis = false;
      if (vis) placed.push([sx, sy]);
      s.label.style.display = vis ? '' : 'none';
      if (vis) { s.label.style.left = sx + 'px'; s.label.style.top = sy + 'px'; s.label.lastChild.textContent = d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'; s.label.style.opacity = clamp(1.4 - d / 1200, 0.35, 1); }
    }
    // name tags over the other drivers in a session
    if (this.mp) for (const p of this.mp.peers.values()) {
      const L = p.label, c = p.car; if (!L) continue;
      let vis = !!c && !c.hidden && this.inWorld();
      if (vis) {
        const d = c.pos.distanceTo(P.pos); v.set(c.pos.x, c.pos.y + 2.2, c.pos.z).project(cam);
        vis = v.z < 1 && d < 800 && d > 2;
        if (vis) { L.style.left = ((v.x * 0.5 + 0.5) * w) + 'px'; L.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px'; L.lastChild.textContent = Math.round(d) + ' m'; L.style.opacity = clamp(1.3 - d / 700, 0.4, 1); }
      }
      L.style.display = vis ? '' : 'none';
    }
    // boat launches: take the skiff out, or bring it in
    this.nearDock = null;
    if (this.state === 'free' && !this.nearSpot) for (const D of BOAT_DOCKS) {
      const dl = Math.hypot(D.land.x - P.pos.x, D.land.z - P.pos.z), dw = Math.hypot(D.water.x - P.pos.x, D.water.z - P.pos.z);
      if (P.spec.boat ? dw < 70 || dl < 45 : dl < 22) this.nearDock = D;
    }
    const pr = $('prompt');
    if (this.nearSpot && this.state === 'free') {
      const ev = this.nearSpot.ev, best = Store.data.best[ev.id];
      $('pTitle').textContent = ev.name;
      $('pDesc').innerHTML = `${this.typeLabel(ev)}${best ? ' · best ' + fmtTime(best.time) : ''} · <kbd>Enter</kbd> or tap to enter`;
      pr.classList.add('on');
    } else if (this.nearDock) {
      const D = this.nearDock, open = this.story.carUnlocked('boat');
      $('pTitle').textContent = P.spec.boat ? 'Go ashore' : 'Boat launch';
      $('pDesc').innerHTML = P.spec.boat ? `${D.name} · <kbd>Enter</kbd> or tap for the ${VEHICLES[this.landVehicle].name}`
        : open ? `${D.name} · <kbd>Enter</kbd> or tap to take out the ${VEHICLES.boat.name}` : `${D.name} · ${CAR_UNLOCKS.boat.hint}`;
      pr.classList.add('on');
    } else pr.classList.remove('on');
    const obj = this.story.objective();
    if (this.state === 'free') { $('hFree').textContent = this.waypoint ? `Waypoint: ${this.waypoint.ev.name}` : this.mp ? this.mpHint() : obj.text; $('hRegion').textContent = this.story.region || ''; }
    // waypoint arrow: a manual waypoint wins, otherwise the story objective
    const wp = $('waypoint');
    const tgt = this.waypoint ? { x: this.waypoint.x, z: this.waypoint.z, name: this.waypoint.ev.name } : obj.target;
    if (tgt && this.state === 'free') {
      const dx = tgt.x - P.pos.x, dz = tgt.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < 15 && this.waypoint) { this.waypoint = null; wp.style.display = 'none'; }
      else if (d < 30) wp.style.display = 'none';
      else { const camYaw = Math.atan2(cam.getWorldDirection(v).x, cam.getWorldDirection(v).z); const a = Math.atan2(dx, dz) - camYaw; $('wpArrow').style.transform = `rotate(${-a}rad)`; $('wpText').textContent = `${tgt.name} · ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}`; wp.style.display = 'block'; }
    } else wp.style.display = 'none';
    // minimap (every other frame)
    this.mmFrame = (this.mmFrame || 0) + 1;
    if (this.mmFrame % 2 === 0 && this.state !== 'title') this.drawMinimap();
    if (this.state === 'map') this.drawBigMap();
  },
  /* next corner: direction, severity and distance, so blind city corners never come as a surprise */
  turnHint(race, pr) {
    const el = $('turn'), R = race.route;
    let best = null, bd = 1e9;
    if (!pr.finished && this.state === 'race') for (const t of R.turns()) {
      let d = t.s - pr.s; if (R.closed) d = ((d % R.length) + R.length) % R.length;
      if (d > -4 && d < bd) { bd = d; best = t; }
    }
    if (!best || bd > 240) { el.classList.remove('on'); return; }
    const right = best.ang > 0, a = Math.abs(best.ang);
    $('turnLabel').textContent = `${a > 2.3 ? 'Hairpin' : best.sharp ? 'Sharp' : 'Easy'} ${right ? 'right' : 'left'}`;
    $('turnDist').textContent = bd < 8 ? 'Now' : `${Math.round(bd / 5) * 5} m`;
    el.querySelector('svg').style.transform = right ? '' : 'scaleX(-1)';
    el.classList.toggle('near', bd < 70); el.classList.add('on');
  },
});
