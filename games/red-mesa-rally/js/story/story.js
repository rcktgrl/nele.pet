'use strict';
/* Red Mesa Rally · Story: dialogue, chapters, unlocks, liveries and challenges */

/* ===================================================================
   RED MESA RALLY — story: voiced dialogue and chapter progression
   Chapters: 0 debut · 1 one more desert win · 2 go through the tunnel ·
             3 beat Calder's crew · 4 Coast to Canyon · 5 two back-road wins ·
             6 Exit 5 Express · 7 the Metro Line against Vic · 8 epilogue
   =================================================================== */
const DESERT_EVENTS = ['canyon', 'mudbowl', 'sprint', 'ridge'];
const CITY_EVENTS = ['interstate', 'harbour', 'pass'];
const BACKROAD_EVENTS = ['orchard', 'dunes', 'kestrel'];

class Dialogue {
  constructor(game) {
    this.g = game; this.queue = []; this.cur = null; this.t = 0; this.buffers = new Map(); this.loading = new Map();
    this.vol = Store.vol('voice');
    this.el = { box: $('dlg'), ini: $('dlgIni'), por: $('dlgPor'), name: $('dlgName'), role: $('dlgRole'), text: $('dlgText') };
    this.el.box.addEventListener('click', () => this.skip());
  }
  ctx() { return this.g.audio.ctx; }
  load(id) {
    const ctx = this.ctx(); if (!ctx) return Promise.resolve(null);
    if (this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    if (VO_DATA.lines[id] && VO_DATA.lines[id].novo) { this.buffers.set(id, null); return Promise.resolve(null); } // subtitles only
    if (this.loading.has(id)) return this.loading.get(id);
    const p = fetch(`vo/${id}.mp3`).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
      .then((buf) => { this.buffers.set(id, buf); return buf; })
      .catch(() => { this.buffers.set(id, null); return null; });
    this.loading.set(id, p);
    return p;
  }
  preload() { for (const id of Object.keys(VO_DATA.lines)) this.load(id); }
  busy() { return !!this.cur || this.queue.length > 0; }
  say(ids, opts = {}) {
    if (!Array.isArray(ids)) ids = [ids];
    if (opts.ifIdle && this.busy()) return false;
    if (opts.interrupt) { this.queue.length = 0; this.stopCurrent(); }
    for (const id of ids) if (VO_DATA.lines[id]) { this.queue.push(id); this.load(id); }
    return true;
  }
  stopCurrent() { if (this.src) { try { this.src.stop(); } catch (e) { /* already stopped */ } this.src = null; } this.cur = null; }
  skip() { this.stopCurrent(); this.t = 0; }
  setVolume(v) { this.vol = v; if (this.vg) this.vg.gain.setTargetAtTime(1.15 * v, this.ctx().currentTime, 0.05); }
  start(id) {
    const L = VO_DATA.lines[id], who = VO_DATA.cast[L.who];
    this.cur = id; this.t = 0; this.dur = L.dur + 0.5;
    const e = this.el;
    e.name.textContent = who.name; e.role.textContent = who.role; e.text.textContent = L.text;
    e.ini.textContent = who.name.split(' ').map((w) => w[0]).join('').slice(0, 2);
    e.por.style.setProperty('--who', who.color);
    e.box.hidden = false; e.box.classList.remove('in'); void e.box.offsetWidth; e.box.classList.add('in');
    const ctx = this.ctx(), buf = this.buffers.get(id);
    if (ctx && buf && this.vol > 0) {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
      const peak = ctx.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 1800; peak.gain.value = 5;
      const g = this.vg = ctx.createGain(); g.gain.value = 1.15 * this.vol;
      src.connect(hp).connect(lp).connect(peak).connect(g).connect(this.g.audio.master);
      src.start(t + 0.12); this.src = src; this.dur = buf.duration + 0.45;
      this.squelch(t); this.squelchAt = t + 0.12 + buf.duration;
    }
    if (this.g.audio.music) this.g.audio.music.speaking(true);
  }
  squelch(t) {
    const ctx = this.ctx(); if (!ctx || !(this.vol > 0)) return;
    const n = ctx.createBufferSource(); n.buffer = this.g.audio.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * this.vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    n.connect(f).connect(g).connect(this.g.audio.master); n.start(t, Math.random()); n.stop(t + 0.12);
  }
  update(dt) {
    if (this.cur) {
      this.t += dt;
      if (this.squelchAt && this.ctx() && this.ctx().currentTime >= this.squelchAt) { this.squelch(this.ctx().currentTime); this.squelchAt = 0; }
      if (this.t >= this.dur) { this.cur = null; this.src = null; }
      return;
    }
    if (this.queue.length) {
      const id = this.queue[0];
      // give the voice file a moment to arrive, then go with subtitles regardless
      if (this.ctx() && !this.buffers.has(id) && (this.wait = (this.wait || 0) + dt) < 2.5) return;
      this.wait = 0; this.queue.shift(); this.start(id);
    } else if (!this.el.box.hidden) {
      this.el.box.hidden = true;
      if (this.g.audio.music) this.g.audio.music.speaking(false);
    }
  }
}

/* story mode: what unlocks each machine (free roam has them all) */
const CAR_UNLOCKS = {
  buggy: { ch: 0 },
  truck: { ch: 1, hint: 'Unlocks: win your first desert event' },
  rally: { ch: 2, hint: 'Unlocks: win a second desert event' },
  kaze: { ch: 3, hint: 'Unlocks: drive through the Calder Tunnel' },
  ironside: { city: 1, hint: "Unlocks: beat Calder's crew in a city event" },
  super: { ch: 8, hint: 'Unlocks: beat Vic on the Metro Line' },
  boat: { ch: 3, hint: 'Unlocks: reach Port Calder' },
};
/* liveries, each earned by a story challenge */
const LIVERIES = [
  { id: 'festival', name: 'Festival', text: 'RED MESA', helmet: 0xff6a1a, num: 7 },
  { id: 'sundog', name: 'Sundog', text: 'SUNDOG', color: 0xf29a16, helmet: 0x16100c, num: 11, ch: 'air' },
  { id: 'midnight', name: 'Midnight', text: 'TAKEDOWN', color: 0x15171c, helmet: 0xd94c22, num: 13, ch: 'takedown' },
  { id: 'chrome', name: 'Interstate Chrome', text: 'FLAT OUT', color: 0xb9bfc7, helmet: 0x1f4e79, num: 99, ch: 'speed' },
  { id: 'portcalder', name: 'Port Calder', text: 'PORT CALDER', color: 0x1f4e79, helmet: 0xf2c230, num: 21, ch: 'ramps' },
  { id: 'swamp', name: 'Swamp Thing', text: 'MUD BOWL', color: 0x4c5a2c, helmet: 0x9b5a2a, num: 4, ch: 'mud' },
  { id: 'gold', name: 'Gold Rush', text: 'RIDGE GOLD', color: 0xc9a227, helmet: 0x16100c, num: 1, ch: 'gold' },
  { id: 'backroads', name: 'Back Roads', text: 'COUNTRY MILE', color: 0x7b4a2b, helmet: 0xe9e2d6, num: 66, ch: 'country' },
  { id: 'pilot', name: 'Harbour Pilot', text: 'HARBOUR PILOT', color: 0xe9e2d6, helmet: 0x2a8c8c, num: 8, ch: 'sailor' },
  { id: 'nightline', name: 'Night Line', text: 'CALDER METRO', color: 0x1f7a8c, helmet: 0xf4f1e8, num: 5, ch: 'metro' },
  { id: 'haze', name: 'Purple Haze', text: 'PURPLE HAZE', color: 0x7b3fc4, helmet: 0xf2c230, num: 27, ch: 'drift' },
];
const CHALLENGES = [
  { id: 'air', name: 'Big air', desc: 'Stay airborne 2.5 s in one jump', goal: 2.5, fmt: (v) => v.toFixed(1) + ' s' },
  { id: 'takedown', name: 'Takedown artist', desc: 'Take out 5 rivals in races', goal: 5 },
  { id: 'speed', name: 'Speed trap', desc: 'Hit 220 km/h', goal: 220, fmt: (v) => Math.round(v) + ' km/h' },
  { id: 'ramps', name: 'Ramp rat', desc: 'Jump 6 different Port Calder street ramps', goal: 6 },
  { id: 'mud', name: 'Mud lark', desc: 'Win the Mud Bowl in the Brute 4x4', goal: 1 },
  { id: 'gold', name: 'Ridge gold', desc: 'Take gold on Ridge Attack', goal: 1 },
  { id: 'country', name: 'Country mile', desc: 'Drive 8 km on the country roads', goal: 8000, fmt: (v) => (v / 1000).toFixed(1) + ' km' },
  { id: 'sailor', name: 'Old salt', desc: 'Cover 3 km by boat', goal: 3000, fmt: (v) => (v / 1000).toFixed(1) + ' km' },
  { id: 'metro', name: 'Mole', desc: 'Drive 2 km in the Calder Metro', goal: 2000, fmt: (v) => (v / 1000).toFixed(1) + ' km' },
  { id: 'drift', name: 'Sideways', desc: 'Hold one drift for 4 s above 50 km/h', goal: 4, fmt: (v) => v.toFixed(1) + ' s' },
];
const SAVE_SLOTS = 3;
const CHAPTERS = ['The Festival', 'One More Win', 'The Tunnel', "Calder's Crews", 'Coast to Canyon', 'Back Roads', 'Exit 5', 'Underground', 'Epilogue'];
class Story {
  constructor(game) {
    this.g = game; this.d = new Dialogue(game);
    const D = Store.data;
    // story progress lives in save slots; older saves had a single story, which becomes slot 1
    if (!Array.isArray(D.slots)) {
      D.slots = new Array(SAVE_SLOTS).fill(null); D.slot = 0;
      const o = D.story;
      if (o && (o.ch || Object.keys(o.flags || {}).length || Object.keys(o.won || {}).length)) D.slots[0] = { ch: o.ch || 0, flags: o.flags || {}, won: o.won || {}, t: Date.now() };
      delete D.story; Store.save();
    }
    while (D.slots.length < SAVE_SLOTS) D.slots.push(null);
    if (!(D.slot >= 0 && D.slot < SAVE_SLOTS)) D.slot = 0;
    this.s = D.slots[D.slot] || Story.blank();
    this.mode = Store.data.mode === 'free' ? 'free' : 'story';
    this.checkCars(false);
    this.radioT = 90 + Math.random() * 60; this.lastRadio = []; this.trainWarnT = 0; this.inTunnel = false; this.region = null; this.fenceT = 0;
  }
  static blank() { return { ch: 0, flags: {}, won: {}, t: 0, stats: {} }; }
  /* ----- unlocks ----- */
  carUnlocked(id) {
    if (this.free) return true;
    const u = CAR_UNLOCKS[id]; if (!u) return false;
    if (u.city) return this.cityWins() >= u.city || this.s.ch >= 4;
    return this.s.ch >= u.ch;
  }
  unlockedCars() { return DRIVEABLE.filter((id) => this.carUnlocked(id)); }
  get stats() { return this.s.stats || (this.s.stats = {}); }
  chalValue(c) { const v = this.stats[c.id]; return typeof v === 'object' && v ? Object.keys(v).length : v || 0; }
  chalDone(id) { const c = CHALLENGES.find((q) => q.id === id); return !!c && this.chalValue(c) >= c.goal; }
  liveryUnlocked(L) { return this.free || !L.ch || this.chalDone(L.ch); }
  /* record challenge progress (story only); mode 'max' keeps the best, 'add' accumulates, 'key' collects distinct keys */
  stat(id, v, mode) {
    if (this.free || !this.g.player) return;
    const st = this.stats, was = this.chalDone(id);
    if (mode === 'add' || mode === 'inc') st[id] = (st[id] || 0) + v;
    else if (mode === 'key') { if (!st[id] || typeof st[id] !== 'object') st[id] = {}; if (st[id][v]) return; st[id][v] = 1; }
    else { if ((st[id] || 0) >= v) return; st[id] = v; }
    this.dirtyT = (this.dirtyT || 0) + 1;
    if (!was && this.chalDone(id)) {
      const L = LIVERIES.find((q) => q.ch === id), c = CHALLENGES.find((q) => q.id === id);
      this.save();
      this.g.toast('Livery unlocked', `${c.name} · ${L.name}`, 'hot');
    } else if (mode === 'key' || mode === 'inc' || this.dirtyT > 240) { this.dirtyT = 0; this.save(); }
  }
  /* announce any machine the latest progress unlocked */
  checkCars(announce) {
    const now = this.unlockedCars(), had = this._cars || now;
    this._cars = now;
    if (!announce || this.free) return;
    const fresh = now.filter((id) => !had.includes(id));
    if (fresh.length) setTimeout(() => this.g.toast(fresh.length > 1 ? 'New machines unlocked' : 'New machine unlocked', fresh.map((id) => VEHICLES[id].name).join(' · '), 'hot'), 3400);
  }
  /* the slot story mode continues; null when it has never been played */
  get slot() { return Store.data.slots[Store.data.slot]; }
  /* play from slot i, wiping it first when fresh */
  useSlot(i, fresh) {
    const D = Store.data;
    if (fresh || !D.slots[i]) D.slots[i] = Story.blank();
    D.slot = i; this.s = D.slots[i]; this._cars = null; this.checkCars(false); this.save();
  }
  deleteSlot(i) {
    const D = Store.data; D.slots[i] = null;
    if (D.slot === i) { const k = D.slots.findIndex(Boolean); D.slot = k < 0 ? 0 : k; this.s = D.slots[D.slot] || Story.blank(); }
    this.save();
  }
  freeSlot() { return Store.data.slots.findIndex((x) => !x); }
  setMode(m) { this.mode = m; Store.data.mode = m; this._cars = null; this.checkCars(false); this.save(); }
  get free() { return this.mode === 'free'; }
  save() { if (!this.free && this.s === this.slot) this.s.t = Date.now(); Store.save(); }
  get ch() { return this.s.ch; }
  chapterName() { return CHAPTERS[Math.min(this.s.ch, CHAPTERS.length - 1)]; }
  setCh(c) { if (c > this.s.ch) { this.s.ch = c; this.save(); this.g.refreshStory(true); this.checkCars(true); } }
  desertWins() { return DESERT_EVENTS.filter((id) => this.s.won[id]).length; }
  cityWins() { return CITY_EVENTS.filter((id) => this.s.won[id]).length; }
  backWins() { return BACKROAD_EVENTS.filter((id) => this.s.won[id]).length; }
  finaleUnlocked() { return this.free || this.s.ch >= 4; }
  tunnelOpen() { return this.free || this.s.ch >= 2; }
  /* which events a player can see and enter right now */
  available(ev) {
    if (this.free) return true;
    if (DESERT_EVENTS.includes(ev.id)) return true;
    if (CITY_EVENTS.includes(ev.id) || BACKROAD_EVENTS.includes(ev.id)) return this.s.ch >= 3;
    if (ev.id === 'finale') return this.s.ch >= 4;
    if (ev.boat) return this.carUnlocked('boat');
    if (ev.id === 'express') return this.s.ch >= 6;
    if (ev.id === 'metro') return this.s.ch >= 7;
    return true;
  }
  objective() {
    const g = this.g, ch = this.s.ch;
    if (this.free) return { text: 'Free roam · every event is open', target: null };
    const spot = (id) => g.eventSpots.find((s) => s.ev.id === id);
    if (ch === 0) return { text: 'Win any desert event', target: null };
    if (ch === 1) return { text: 'Win one more desert event', target: null };
    if (ch === 2) {
      const R = g.world.route('tunnel'); const p = R.posAt(g.player.pos.x < 900 ? 4 : R.length - 40, {});
      return { text: 'Drive east through the Calder Tunnel', target: { x: p.x, z: p.z, name: 'Calder Tunnel' } };
    }
    if (ch === 3) {
      const left = CITY_EVENTS.filter((id) => !this.s.won[id]);
      let best = null, bd = 1e9; for (const id of left) { const sp = spot(id); const d = Math.hypot(sp.x - g.player.pos.x, sp.z - g.player.pos.z); if (d < bd) { bd = d; best = sp; } }
      return { text: `Beat Calder's crew · ${this.cityWins()}/3 · Interstate, Harbour, Kestrel Pass`, target: best ? { x: best.x, z: best.z, name: best.ev.name } : null };
    }
    if (ch === 4) { const sp = spot('finale'); return { text: 'Win Coast to Canyon', target: { x: sp.x, z: sp.z, name: 'Coast to Canyon' } }; }
    if (ch === 5) {
      let best = null, bd = 1e9; for (const id of BACKROAD_EVENTS.filter((q) => !this.s.won[q])) { const sp = spot(id); const d = Math.hypot(sp.x - g.player.pos.x, sp.z - g.player.pos.z); if (d < bd) { bd = d; best = sp; } }
      return { text: `Take the back roads · ${this.backWins()}/2 · Orchard Dash, Dune Loop, Kestrel Ridgeline`, target: best ? { x: best.x, z: best.z, name: best.ev.name } : null };
    }
    if (ch === 6) { const sp = spot('express'); return { text: 'Win Exit 5 Express', target: { x: sp.x, z: sp.z, name: 'Exit 5 Express' } }; }
    if (ch === 7) { const sp = spot('metro'); return { text: 'Beat Vic on the Metro Line · ramp on Kingsway', target: { x: sp.x, z: sp.z, name: 'Metro Line' } }; }
    return { text: 'Red Mesa is yours · chase your records', target: null };
  }
  onFreeRoam() {
    if (this.free) return;
    if (!this.s.flags.pro) { this.s.flags.pro = 1; this.save(); this.d.say(['pro_1', 'pro_2']); }
  }
  onResult(ev, won) {
    const s = this.s, d = this.d, desert = DESERT_EVENTS.includes(ev.id), city = CITY_EVENTS.includes(ev.id);
    if (this.free) { // no plot outside story mode, just the festival PA
      d.say(won ? ['win_1', 'win_2', 'win_3'][Math.floor(Math.random() * 3)] : ['lose_1', 'lose_2', 'lose_3'][Math.floor(Math.random() * 3)], { interrupt: true });
      return;
    }
    const first = won && !s.won[ev.id];
    if (won) s.won[ev.id] = 1;
    this.save();
    if (won && ev.id === 'mudbowl' && this.g.player.spec.id === 'truck') this.stat('mud', 1);
    if (ev.id === 'ridge' && this.g.race && this.g.race.prog.get(this.g.player).time <= ev.medals[0]) this.stat('gold', 1);
    if (won && city) this.checkCars(true);
    if (ev.id === 'finale') {
      if (won) { d.say(['fin_win_1', 'fin_win_2', 'fin_win_3'], { interrupt: true }); if (s.ch < 5) { d.say(['br_1', 'br_2']); this.setCh(5); this.checkUnlock(); } }
      else d.say('fin_lose', { interrupt: true });
      return;
    }
    if (ev.id === 'express') {
      if (!won) { d.say('ex_lose', { interrupt: true }); return; }
      d.say('ex_win', { interrupt: true });
      if (s.ch === 6) { d.say(['ug_1', 'ug_2']); this.setCh(7); }
      return;
    }
    if (ev.id === 'metro') {
      if (!won) { d.say('ug_lose', { interrupt: true }); return; }
      d.say(['ug_win_1', 'ug_win_2', 'ug_win_3'], { interrupt: true });
      if (s.ch === 7) this.setCh(8); // the Vortex V12 comes with it
      return;
    }
    if (BACKROAD_EVENTS.includes(ev.id) && won && first) {
      d.say('win_' + ev.id, { interrupt: true });
      this.checkUnlock();
      return;
    }
    if (!won) { d.say(city ? (Math.random() < 0.6 ? (Math.random() < 0.5 ? 'lose_city_1' : 'lose_city_2') : 'lose_2') : ['lose_1', 'lose_2', 'lose_3'][Math.floor(Math.random() * 3)], { interrupt: true }); return; }
    if (desert && s.ch === 0) { d.say(['c1_win_1', 'c1_win_2'], { interrupt: true }); this.setCh(1); return; }
    if (desert && s.ch === 1 && this.desertWins() >= 2) { d.say(['c2_1', 'c2_2', 'c2_3'], { interrupt: true }); this.setCh(2); return; }
    if (city && first) {
      d.say({ interstate: 'win_interstate', harbour: 'win_harbour', pass: 'win_pass' }[ev.id], { interrupt: true });
      this.checkUnlock();
      return;
    }
    d.say(['win_1', 'win_2', 'win_3'][Math.floor(Math.random() * 3)], { interrupt: true });
  }
  checkUnlock() {
    if (this.s.ch === 3 && this.cityWins() >= 3) { this.d.say(['fin_unlock_1', 'fin_unlock_2']); this.setCh(4); }
    if (this.s.ch === 5 && this.backWins() >= 2) { this.d.say(['ex_1', 'ex_2']); this.setCh(6); }
  }
  onWreck(reason) { if (reason === 'train') this.d.say('train_hit', { interrupt: true }); }
  regionAt(x, z) {
    if (x < 1150) return 'Red Mesa Desert';
    if (boxMask(x, z, FLAT, 1) > 0.5) return 'Port Calder';
    if (z < -1550) return 'Kestrel Pines';
    if (z > 650) return 'Salt Coast';
    return 'Calder Valley';
  }
  update(dt, free) {
    this.d.update(dt);
    const g = this.g, P = g.player, s = this.s;
    if (!free) return;
    // story mode: the east stays closed until Rosa sends you through
    if (!this.free && !this.tunnelOpen()) {
      this.fenceT -= dt;
      // anyone who scrambles over the cut and drops in behind the barrier gets sent back too
      const gp = g.world.tunnelGatePose(), tr = g.world.route('tunnel');
      const behind = P.pos.x > gp.x - 40 && P.pos.x < 1400 && (() => { const pr = tr.project(P.pos.x, P.pos.z, gp.s, 600); return pr.s > gp.s + 2 && pr.dist < 16 && P.pos.y < gp.y + 8; })();
      if ((P.pos.x > 1180 || behind) && this.fenceT <= 0) {
        this.fenceT = 3;
        const R = g.world.route('tunnel'), p = R.posAt(0, {}), [dx, dz] = R.dirAt(0);
        P.reset(p.x - dx * 30, p.z - dz * 30, Math.atan2(dx, dz), g.world.terrain, 0.4); g.rig.snap();
        g.toast('Calder Tunnel is closed', 'Win one more desert event to open it', 'region');
      }
    }
    // first arrival in the east: Vic's welcome
    if (!this.free && P.pos.x > 1560 && !s.flags.tun) {
      s.flags.tun = 1;
      const lines = s.ch < 2 ? ['c2_2', 'tun_1', 'tun_2', 'tun_3', 'tun_4'] : ['tun_1', 'tun_2', 'tun_3', 'tun_4'];
      this.d.say(lines); this.setCh(3); this.checkUnlock(); this.save();
    }
    const T = g.world.terrain;
    if (P.under && !s.flags.metro) { s.flags.metro = 1; this.save(); this.d.say('metro_enter', { ifIdle: true }); }
    const inTun = T.tun[T.gi(P.pos.x, P.pos.z)] > 0;
    if (inTun && !this.inTunnel && !s.flags.tunEnter) { s.flags.tunEnter = 1; this.save(); this.d.say('tunnel_enter', { ifIdle: true }); }
    this.inTunnel = inTun;
    // region titles
    const reg = P.under ? 'Calder Metro' : this.regionAt(P.pos.x, P.pos.z);
    if (reg !== this.region) { if (this.region) g.toast(reg, null, 'region'); this.region = reg; }
    // the freight: warn when the player sits on the line with a train bearing down
    this.trainWarnT -= dt;
    const W = g.world, tr = W.train;
    if (this.trainWarnT <= 0 && tr.v > 6 && T.rail[T.gi(P.pos.x, P.pos.z)] > 0.2) {
      const ps = tr.R.project(P.pos.x, P.pos.z, 0, -1).s, ahead = tr.ahead(ps);
      if (ahead < 260) { this.d.say('train_warn', { interrupt: true }); this.trainWarnT = 40; g.audio.horn(1); }
    }
    // KRMR radio chatter
    this.radioT -= dt;
    if (this.radioT <= 0) {
      this.radioT = 160 + Math.random() * 120;
      const pool = ['radio_1', 'radio_2', 'radio_3', 'radio_4', 'radio_5', 'radio_6'].filter((r) => !this.lastRadio.includes(r));
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (this.d.say(pick, { ifIdle: true })) { this.lastRadio.push(pick); if (this.lastRadio.length > 2) this.lastRadio.shift(); }
    }
  }
}

'use strict';
