'use strict';
/* Red Mesa Rally · Game: title menu, save slots, story progress and the story intro */

Object.assign(Game.prototype, {
  refreshStory(announce) {
    if (!this.story) return;
    const S = this.story, fresh = [];
    for (const s of this.eventSpots) {
      const hide = !S.available(s.ev);
      if (s.hidden && !hide) fresh.push(s.ev.name);
      s.hidden = hide; s.beacon.beam.visible = !hide && !this.race; s.beacon.ring.visible = !hide && !this.race;
      if (hide) s.label.style.display = 'none';
      if (s.pin) s.pin.hidden = hide;
      if (hide && this.waypoint === s) this.waypoint = null;
    }
    const gateClosed = !S.tunnelOpen();
    const wasClosed = this.world.tunnelGateClosed;
    this.world.setTunnelGate(gateClosed); this.gfx.setTunnelGate(gateClosed);
    $('freeTitle').textContent = this.mp ? 'Multiplayer' : S.free ? 'Free roam' : 'Story · ' + S.chapterName();
    if (announce) {
      if (wasClosed && !gateClosed) this.toast('Calder Tunnel open', 'The road east is clear', 'region');
      if (fresh.length) setTimeout(() => this.toast(fresh.length > 1 ? 'New events unlocked' : 'New event unlocked', fresh.join(' · '), 'hot'), wasClosed && !gateClosed ? 2600 : 0);
    }
  },
  /* ----- main menu ----- */
  refreshMenu() {
    const S = this.story, sl = S.slot, ch = sl ? sl.ch : 0;
    $('mPips').innerHTML = this.pips(ch);
    $('mChapter').textContent = !sl ? 'New game' : `Slot ${Store.data.slot + 1} · ` + (ch >= CHAPTERS.length - 1 ? 'Story complete' : `Chapter ${ch + 1} · ${CHAPTERS[ch]}`);
    $('btnSaves').hidden = !Store.data.slots.some(Boolean);
    const last = Store.data.mode === 'free' ? 'mFree' : 'mStory';
    $('mStory').classList.toggle('last', last === 'mStory'); $('mFree').classList.toggle('last', last === 'mFree');
    $('menuHint').textContent = this.isTouch ? 'Pick a mode to start driving.' : `Press 1, 2 or 3, or Enter for ${last === 'mFree' ? 'free roam' : 'story'}. N for a new game${Store.data.slots.some(Boolean) ? ', L for saves' : ''}.`;
    $('mMultiState').textContent = this.mp ? `In session ${this.mp.code} · ${this.mp.peers.size + 1} ${this.mp.peers.size ? 'drivers' : 'driver'}` : `Up to ${MP_MAX} drivers`;
  },
  pips(ch) { return [0, 1, 2, 3, 4].map((i) => `<i class="${i < Math.min(ch, 5) ? 'on' : ''}"></i>`).join(''); },
  /* ----- save slots ----- */
  showSaves(on, hint) {
    this.savesOpen = on; this.delArm = -1;
    this.screen('saves', on); this.screen('title', !on);
    if (on) this.renderSaves(hint || ''); else this.refreshMenu();
  },
  renderSaves(hint) {
    const D = Store.data, list = $('slotList'); list.innerHTML = '';
    D.slots.forEach((sl, i) => {
      const row = document.createElement('div'); row.className = 'slot' + (sl ? '' : ' empty') + (sl && i === D.slot ? ' cur' : '');
      const when = sl && sl.t ? new Date(sl.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const wins = sl ? Object.keys(sl.won).length : 0;
      row.innerHTML = `<span class="sn">Slot ${i + 1}</span><span class="si"><b></b><span></span></span><span class="sa"></span>`;
      row.querySelector('b').textContent = !sl ? 'Empty' : sl.ch >= CHAPTERS.length - 1 ? 'Story complete' : `Chapter ${sl.ch + 1} · ${CHAPTERS[sl.ch]}`;
      const info = row.querySelector('.si span');
      if (sl) info.innerHTML = `<span class="pips">${this.pips(sl.ch)}</span>`, info.append(`${wins} ${wins === 1 ? 'win' : 'wins'}${when ? ' · ' + when : ''}`);
      else info.textContent = 'No story yet';
      const act = row.querySelector('.sa'), btn = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = label; b.onclick = fn; act.appendChild(b); return b; };
      if (sl) {
        btn('Continue', 'primary', () => this.startMode('story', i));
        btn(this.delArm === i ? 'Really delete?' : 'Delete', '', () => {
          if (this.delArm !== i) { this.delArm = i; this.renderSaves(''); return; }
          this.delArm = -1; this.story.deleteSlot(i); this.renderSaves('Slot ' + (i + 1) + ' deleted');
        });
      } else btn('New game', 'primary', () => this.startMode('story', i, true));
      list.appendChild(row);
    });
    const full = this.story.freeSlot() < 0;
    $('btnSlotNew').disabled = full; $('btnSlotNew').style.opacity = full ? 0.45 : '';
    $('savesHint').textContent = hint || (full ? 'All slots are full. Delete one to start a new game.' : '');
  },
  newGame() {
    const k = this.story.freeSlot();
    if (k < 0) { if (!this.savesOpen) this.showSaves(true); else this.renderSaves(''); return; }
    this.startMode('story', k, true);
  },
  startMode(m, slot, fresh) {
    if (this.state !== 'title') return;
    this.audio.start();
    const S = this.story;
    if (m === 'multi' && !this.mp) return;
    if (m === 'story') S.useSlot(slot === undefined ? Store.data.slot : slot, fresh);
    if (this.savesOpen) { this.savesOpen = false; this.screen('saves', false); }
    if (this.mpOpen) { this.mpOpen = false; this.screen('mpScreen', false); }
    if (m === 'multi') { const keep = Store.data.mode; S.setMode('free'); Store.data.mode = keep; Store.save(); } // a session drives with everything open
    else { if (this.mp) this.leaveMp(); S.setMode(m); }
    this.refreshStory(false);
    // story mode only lets you drive what the story has handed you
    if (!S.carUnlocked(this.player.spec.id)) { const v = S.carUnlocked(this.landVehicle) && !VEHICLES[this.landVehicle].boat ? this.landVehicle : 'rally'; this.spawnPlayer(v, { x: HUB.x + 18, z: HUB.z + 46, yaw: Math.PI * 0.9, vehicle: v }); }
    else if (this.player.liveryId !== this.currentLivery().id) this.spawnPlayer(this.player.spec.id);
    // story mode starts you on the right side of the closed tunnel
    if (!S.tunnelOpen() && this.player.pos.x > 1180) { this.player.reset(HUB.x + 18, HUB.z + 46, Math.PI * 0.9, this.world.terrain, 0.5); this.rig.snap(); }
    // a session lines its drivers up side by side in the paddock rather than on top of each other
    if (m === 'multi') { const i = Math.max(0, this.mp.list.findIndex((x) => x.me)); this.player.reset(HUB.x + 18 - i * 7, HUB.z + 46 + i * 2.5, Math.PI * 0.9, this.world.terrain, 0.5); this.rig.snap(); }
    // a fresh story opens with the voiced intro
    if (m === 'story' && S.ch === 0 && !S.s.flags.intro) this.startStoryIntro();
    else this.enterFree();
  },
  startStoryIntro() {
    this.screen('title', false); this.screen('splash', false); this.state = 'storyintro';
    for (const id of STORY_INTRO) this.story.d.load(id);
    this.sintro = new StoryIntro(this);
    const el = $('intro'); el.classList.add('on', 'story'); requestAnimationFrame(() => el.classList.add('bars'));
    el.appendChild($('dlg')); // subtitles ride on the letterbox while the HUD is hidden
    $('skip').textContent = 'Skip story'; $('skip').onclick = () => this.endStoryIntro();
  },
  endStoryIntro() {
    if (this.state !== 'storyintro') return;
    this.story.s.flags.intro = 1; this.story.save();
    this.sintro = null; const d = this.story.d; d.skip(); d.queue.length = 0;
    const el = $('intro'); el.classList.remove('bars', 'on', 'story'); $('introCap').classList.remove('show'); $('skip').textContent = 'Skip intro';
    $('hud').appendChild($('dlg'));
    this.state = 'title'; this.rig.snap(); this.enterFree();
  },
});
