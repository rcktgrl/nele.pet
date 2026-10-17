'use strict';
/* Red Mesa Rally · Generative soundtrack */

/* ===================================================================
   RED MESA RALLY — generative soundtrack
   A small step sequencer with synthesized drums, bass, distorted
   power chords, pads, arps and leads. Every event has its own song;
   free roam rolls new sections and follows how hard you drive.
   =================================================================== */
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], mixo: [0, 2, 4, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11] };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const DRUMS = {
  rock: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  gallop: { k: 'x..x..x.x..x..x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  half: { k: 'x.....x...x.....', s: '........x.......', h: 'x...x...x...x...' },
  dnb: { k: 'x.........x.....', s: '....x.......x...', g: '.......x.x....x.', h: 'x.xxx.xxx.xxx.xx' },
  four: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.' },
  shuffle: { k: 'x.....x.x.......', s: '....x.......x..x', h: 'x..x..x.x..x..x.' },
  ambient: { k: 'x.........x.....', s: '................', h: '....x.......x...' },
};
/* Each event's song: fixed seed so the same tune always belongs to the same race. */
const SONGS = {
  intro: { name: 'Heat Haze', bpm: 124, root: 40, scale: 'phrygian', prog: [0, 0, 1, 0, 0, 0, 6, 5], drums: 'four', bass: 'pulse', gtr: 'chug', lead: 'synth', pad: true, seed: 11 },
  title: { name: 'Paddock at Dusk', bpm: 94, root: 45, scale: 'dorian', prog: [0, 3, 5, 4], drums: 'shuffle', bass: 'round', gtr: 'clean', lead: 'pluck', pad: true, seed: 5 },
  canyon: { name: 'Canyon Run', bpm: 150, root: 40, scale: 'minor', prog: [0, 5, 2, 6], drums: 'rock', bass: 'pick', gtr: 'chug', lead: 'gtr', pad: false, seed: 101 },
  mudbowl: { name: 'Mud Bowl', bpm: 88, root: 38, scale: 'phrygian', prog: [0, 1, 0, 6], drums: 'half', bass: 'fuzz', gtr: 'sludge', lead: 'gtr', pad: false, seed: 202, barsPerChord: 2 },
  sprint: { name: 'Mesa Sprint', bpm: 172, root: 45, scale: 'minor', prog: [0, 5, 3, 6], drums: 'dnb', bass: 'reese', gtr: 'none', lead: 'arp', pad: true, seed: 303, barsPerChord: 2 },
  ridge: { name: 'Ridge Attack', bpm: 116, root: 42, scale: 'dorian', prog: [0, 6, 5, 3], drums: 'four', bass: 'pulse', gtr: 'none', lead: 'arp', pad: true, seed: 404 },
  interstate: { name: 'Interstate Loop', bpm: 128, root: 41, scale: 'minor', prog: [0, 5, 3, 6], drums: 'four', bass: 'reese', gtr: 'none', lead: 'arp', pad: true, seed: 505, barsPerChord: 2 },
  harbour: { name: 'Harbour Circuit', bpm: 164, root: 43, scale: 'phrygian', prog: [0, 1, 5, 6], drums: 'dnb', bass: 'reese', gtr: 'chug', lead: 'synth', pad: true, seed: 606 },
  pass: { name: 'Kestrel Pass', bpm: 142, root: 38, scale: 'dorian', prog: [0, 3, 6, 4], drums: 'gallop', bass: 'pick', gtr: 'chug', lead: 'gtr', pad: false, seed: 707 },
  finale: { name: 'Coast to Canyon', bpm: 152, root: 40, scale: 'harmonic', prog: [0, 5, 3, 4, 0, 5, 6, 4], drums: 'gallop', bass: 'pick', gtr: 'chug', lead: 'synth', pad: true, seed: 808 },
  results: { name: 'Cool Down', bpm: 84, root: 43, scale: 'mixo', prog: [0, 6, 3, 0], drums: 'ambient', bass: 'round', gtr: 'clean', lead: 'pluck', pad: true, seed: 77 },
};
const FREE_STYLES = [
  { drums: 'ambient', bass: 'round', gtr: 'clean', lead: 'pluck', pad: true, bpm: [78, 92] },
  { drums: 'shuffle', bass: 'round', gtr: 'clean', lead: 'pluck', pad: true, bpm: [88, 100] },
  { drums: 'half', bass: 'fuzz', gtr: 'sludge', lead: 'gtr', pad: false, bpm: [82, 96] },
  { drums: 'four', bass: 'pulse', gtr: 'none', lead: 'arp', pad: true, bpm: [100, 116] },
  { drums: 'rock', bass: 'pick', gtr: 'chug', lead: 'gtr', pad: false, bpm: [120, 138] },
];
const PROGS = [[0, 5, 3, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 2, 5, 4], [0, 5, 6, 4], [0, 1, 0, 6], [0, 3, 0, 4]];

class Music {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0.42; this.out.connect(dest);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 18000; this.filter.Q.value = 0.7; this.filter.connect(this.out);
    this.bus = ctx.createGain(); this.bus.connect(this.filter);
    // tempo-synced echo for leads
    this.delay = ctx.createDelay(1.5); this.fb = ctx.createGain(); this.fb.gain.value = 0.34;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
    this.delay.connect(dl).connect(this.fb).connect(this.delay);
    const wet = ctx.createGain(); wet.gain.value = 0.32; dl.connect(wet).connect(this.bus);
    // amp for guitars: shared distortion + cabinet
    this.amp = ctx.createWaveShaper(); const curve = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 9) * 0.9; } this.amp.curve = curve; this.amp.oversample = '2x';
    const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3200; cab.Q.value = 0.9;
    const cab2 = ctx.createBiquadFilter(); cab2.type = 'peaking'; cab2.frequency.value = 700; cab2.gain.value = -5;
    this.ampGain = ctx.createGain(); this.ampGain.gain.value = 0.16;
    this.amp.connect(cab).connect(cab2).connect(this.ampGain).connect(this.bus);
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = nb;
    this.song = null; this.level = 0; this.target = 0; this.final = false; this.vol = 1;
    this.freeRoam = false; this.freeBars = 0;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  /* ----- public ----- */
  play(id, opts = {}) {
    const def = typeof id === 'string' ? SONGS[id] : id;
    if (!def) return;
    this.freeRoam = !!opts.free; this.final = false; this.freeBars = 0;
    this.song = this.compile(def);
    this.level = opts.level !== undefined ? opts.level : 2; this.target = this.level;
    this.step = 0; this.next = this.ctx.currentTime + 0.12;
    this.songId = typeof id === 'string' ? id : 'free';
    this.filter.frequency.cancelScheduledValues(this.next); this.filter.frequency.setTargetAtTime(this.final ? 18000 : 14000, this.next, 0.3);
  }
  playFree() { this.play(this.makeFreeSong(), { free: true, level: 1 }); }
  setLevel(l) { this.target = clamp(l, 0, 3); }
  setFinal(on) { if (on === this.final) return; this.final = on; this.target = on ? 3 : this.target; }
  duck(amount, dur) { const t = this.ctx.currentTime; const f = this.filter.frequency; f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(Math.max(300, 14000 * (1 - amount)), t + 0.08); f.setTargetAtTime(14000, t + dur, 0.4); }
  gainNow() { return this.vol * (this.paused ? 0.14 : this.talk ? 0.17 : 0.42); }
  setPaused(p) { const t = this.ctx.currentTime; this.paused = p; this.out.gain.setTargetAtTime(this.gainNow(), t, 0.15); this.filter.frequency.setTargetAtTime(p ? 900 : 14000, t, 0.15); }
  setVolume(v) { this.vol = v; this.out.gain.setTargetAtTime(this.gainNow(), this.ctx.currentTime, 0.1); }
  speaking(on) { this.talk = on; this.out.gain.setTargetAtTime(this.gainNow(), this.ctx.currentTime, 0.2); }
  stop() { this.song = null; }
  /* ----- composition ----- */
  makeFreeSong() {
    const r = Math.random, st = FREE_STYLES[Math.floor(r() * FREE_STYLES.length)];
    const scales = ['minor', 'dorian', 'phrygian', 'mixo', 'harmonic'];
    return { name: 'Free roam', bpm: Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0])), root: 38 + Math.floor(r() * 8), scale: scales[Math.floor(r() * scales.length)], prog: PROGS[Math.floor(r() * PROGS.length)], drums: st.drums, bass: st.bass, gtr: st.gtr, lead: st.lead, pad: st.pad, seed: Math.floor(r() * 1e6), barsPerChord: r() < 0.4 ? 2 : 1 };
  }
  compile(def) {
    const rng = mulberry32(def.seed), sc = SCALES[def.scale];
    const deg = (d, oct = 0) => { const n = sc.length; const o = Math.floor(d / n); return def.root + sc[((d % n) + n) % n] + 12 * (o + oct); };
    // bass rhythm: anchored on 1, random syncopation
    const bassRhythm = [];
    for (let i = 0; i < 16; i++) bassRhythm.push(i === 0 ? 2 : (def.drums === 'half' || def.bass === 'fuzz') ? (i === 6 || i === 10 ? 1 : 0) : rng() < (i % 2 === 0 ? 0.62 : 0.22) ? 1 : 0);
    // lead motif: 2 bars over chord tones and passing notes
    const motif = [];
    let cur = 4;
    for (let i = 0; i < 32; i++) {
      const strong = i % 4 === 0;
      if (rng() < (strong ? 0.75 : def.lead === 'gtr' ? 0.4 : 0.32)) { cur = clamp(cur + Math.round((rng() - 0.5) * 4), 0, 9); if (strong && rng() < 0.5) cur = [0, 2, 4, 7][Math.floor(rng() * 4)]; motif.push({ d: cur, len: rng() < 0.3 ? 3 : 1 }); }
      else motif.push(null);
    }
    const arpShape = [0, 2, 4, 7, 4, 2, 4, 9].map((x, i) => (rng() < 0.2 ? x + 2 : x));
    return { ...def, deg, bassRhythm, motif, arpShape, bpc: def.barsPerChord || 1, drum: DRUMS[def.drums] || DRUMS.rock };
  }
  /* ----- scheduler ----- */
  schedule() {
    if (!this.song || this.ctx.state !== 'running') return;
    const ahead = this.ctx.currentTime + 0.14;
    while (this.next < ahead) {
      this.playStep(this.step, this.next);
      if (this.reroll) { this.reroll = false; const keep = this.target; this.song = this.compile(this.makeFreeSong()); this.freeBars = 0; this.step = 0; this.target = keep; continue; }
      const bpm = this.song.bpm * (this.final ? 1.06 : 1);
      this.next += 60 / bpm / 4; this.step++;
    }
  }
  playStep(step, t) {
    const S = this.song, i = step % 16, bar = Math.floor(step / 16);
    if (i === 0) { // levels move on bar lines so layers enter musically
      this.level += clamp(this.target - this.level, -1, 1);
      if (this.freeRoam) { this.freeBars++; if (this.freeBars > 40 && bar % 8 === 0) { this.reroll = true; return; } }
    }
    const L = this.level, fin = this.final;
    const key = fin ? 2 : 0;
    const chordDeg = S.prog[Math.floor(bar / S.bpc) % S.prog.length];
    const root = S.deg(chordDeg) + key;
    const chord = [S.deg(chordDeg), S.deg(chordDeg + 2), S.deg(chordDeg + 4)].map((n) => n + key);
    const D = S.drum, sixteenth = 60 / S.bpm / 4;
    const phraseEnd = bar % 8 === 7;
    // drums
    if (L >= 1 && D.k[i] === 'x') this.kick(t, 0.9);
    if (L >= 2) {
      if (D.s[i] === 'x') this.snare(t, 0.7);
      if (D.g && D.g[i] === 'x') this.snare(t, 0.25);
      if (phraseEnd && i >= 12) this.snare(t, 0.35 + (i - 12) * 0.12);
      if (fin && i % 4 === 2) this.kick(t, 0.5);
    }
    if (L >= 2 && (D.h[i] === 'x' || (L >= 3 && S.drums !== 'ambient'))) this.hat(t, L >= 3 && i % 4 === 2 ? 0.16 : 0.09, i % 8 === 6 && L >= 3);
    if (L === 1 && S.drums === 'ambient' && D.h[i] === 'x') this.hat(t, 0.05, false);
    if (L >= 3 && i === 0 && bar % 4 === 0) this.crash(t);
    // bass
    if (L >= 1 && S.bassRhythm[i]) {
      const n = root - 12 + (S.bass === 'pick' && i % 8 === 6 ? 12 : 0);
      const len = S.bass === 'reese' || S.bass === 'fuzz' ? sixteenth * (S.bassRhythm[i] === 2 ? 8 : 4) : sixteenth * (S.bassRhythm[i] === 2 ? 3 : 1.6);
      this.bassNote(t, n, len, S.bass);
    }
    // guitars
    if (L >= 2 && S.gtr !== 'none') {
      if (S.gtr === 'chug' && i % 2 === 0 && (S.bassRhythm[i] || i % 4 === 0)) this.power(t, root, sixteenth * (i % 8 === 0 ? 2.5 : 0.9), i % 8 !== 0);
      if (S.gtr === 'sludge' && (i === 0 || (i === 8 && S.bpc === 1))) this.power(t, root - 12 + 12, sixteenth * 14, false);
      if (S.gtr === 'clean' && i % 2 === 0) this.pluck(t, chord[(i / 2) % 3] + 12 * (i % 6 === 4 ? 1 : 0), sixteenth * 3, 0.07);
    }
    // pad
    if (S.pad && i === 0 && bar % S.bpc === 0) this.pad(t, chord, sixteenth * 16 * S.bpc, L >= 2 ? 0.05 : 0.07);
    if (!S.pad && L === 0 && i === 0) this.pad(t, chord, sixteenth * 16, 0.05);
    // lead / arp
    if (S.lead === 'arp' && L >= 2) { const a = S.arpShape[i % 8]; const n = S.deg(chordDeg + a, 1) + key; this.pluck(t, n + (L >= 3 && i % 16 >= 8 ? 12 : 0), sixteenth * 1.5, 0.06, true); }
    if (L >= 3 || (S.lead === 'pluck' && L >= 2)) {
      const m = S.motif[(step % 32)];
      if (m) {
        const n = S.deg(chordDeg + m.d, S.lead === 'gtr' ? 1 : 1) + key;
        if (S.lead === 'gtr') this.leadGtr(t, n, sixteenth * m.len * 1.1);
        else if (S.lead === 'synth') this.lead(t, n, sixteenth * m.len * 1.2);
        else if (S.lead === 'pluck') this.pluck(t, n + 12, sixteenth * 2.5, 0.06, true);
        else if (S.lead === 'arp' && L >= 3) this.lead(t, n + 12, sixteenth * m.len * 1.4);
      }
    }
    this.delay.delayTime.setValueAtTime(sixteenth * 3, t);
  }
  /* ----- instruments ----- */
  env(g, t, a, peak, dec, end = 0.0001) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(end, t + a + dec); }
  kick(t, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    this.env(g, t, 0.003, v * 0.95, 0.32); o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.4);
    const n = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain(); n.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 2500;
    this.env(ng, t, 0.001, v * 0.12, 0.015); n.connect(f).connect(ng).connect(this.bus); n.start(t, Math.random() * 0.5); n.stop(t + 0.03);
  }
  snare(t, v) {
    const c = this.ctx, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    this.env(g, t, 0.002, v * 0.55, 0.17); n.connect(f).connect(g).connect(this.bus); n.start(t, Math.random() * 0.5); n.stop(t + 0.22);
    const o = c.createOscillator(), og = c.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    this.env(og, t, 0.002, v * 0.35, 0.09); o.connect(og).connect(this.bus); o.start(t); o.stop(t + 0.12);
  }
  hat(t, v, open) {
    const c = this.ctx, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7600;
    this.env(g, t, 0.001, v, open ? 0.22 : 0.035); n.connect(f).connect(g).connect(this.bus); n.start(t, Math.random() * 0.5); n.stop(t + 0.3);
  }
  crash(t) {
    const c = this.ctx, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 4200;
    this.env(g, t, 0.003, 0.16, 1.4); n.connect(f).connect(g).connect(this.bus); n.start(t, 0); n.stop(t + 1.5);
  }
  bassNote(t, m, len, kind) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass';
    const freq = mtof(m);
    const oscs = kind === 'reese' ? [['sawtooth', -9], ['sawtooth', 9]] : kind === 'fuzz' ? [['sawtooth', 0], ['square', -1200]] : kind === 'round' ? [['triangle', 0], ['sine', -1200]] : [['sawtooth', 0], ['square', -1200]];
    const top = kind === 'round' ? 700 : kind === 'reese' ? 900 : kind === 'fuzz' ? 1400 : 1600;
    f.frequency.setValueAtTime(top, t); f.frequency.exponentialRampToValueAtTime(Math.max(120, top * 0.25), t + Math.min(len, 0.4)); f.Q.value = kind === 'reese' ? 4 : 2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === 'round' ? 0.32 : 0.24, t + 0.006); g.gain.setValueAtTime(kind === 'round' ? 0.28 : 0.2, t + len * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    for (const [type, det] of oscs) { const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + 0.05); }
    f.connect(g).connect(kind === 'fuzz' ? this.amp : this.bus);
  }
  power(t, m, len, mute) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = mute ? 900 : 4000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(mute ? 0.0001 : 0.25, t + (mute ? 0.11 : len * 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, t + len + (mute ? 0 : 0.08));
    for (const n of [m, m + 7, m + 12]) for (const det of [-8, 8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + 0.12); }
    f.connect(g).connect(this.amp);
  }
  leadGtr(t, m, len) {
    const c = this.ctx, g = c.createGain(), o = c.createOscillator(), o2 = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m) * 1.003;
    lfo.frequency.value = 5.5; lg.gain.value = 9; lfo.connect(lg); lg.connect(o.detune); lg.connect(o2.detune);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.008); g.gain.setValueAtTime(0.32, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.12);
    o.connect(g); o2.connect(g); g.connect(this.amp);
    const send = c.createGain(); send.gain.value = 0.25; g.connect(send).connect(this.delay);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + len + 0.15); }
  }
  lead(t, m, len) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(), o = c.createOscillator(), o2 = c.createOscillator();
    o.type = 'square'; o2.type = 'sawtooth'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m); o2.detune.value = 12;
    f.type = 'lowpass'; f.frequency.setValueAtTime(3800, t); f.frequency.exponentialRampToValueAtTime(1200, t + len); f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.085, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.bus); g.connect(this.delay);
    for (const x of [o, o2]) { x.start(t); x.stop(t + len + 0.15); }
  }
  pluck(t, m, len, v, echo) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(), o = c.createOscillator();
    o.type = 'triangle'; o.frequency.value = mtof(m);
    f.type = 'lowpass'; f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(700, t + len);
    this.env(g, t, 0.003, v * 1.6, len);
    o.connect(f).connect(g).connect(this.bus); if (echo) g.connect(this.delay);
    o.start(t); o.stop(t + len + 0.05);
  }
  pad(t, chord, len, v) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.6, len * 0.3)); g.gain.setValueAtTime(v, t + len * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.4);
    for (const n of chord) for (const det of [-11, 0, 11]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n + 12); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + 0.45); }
    f.connect(g).connect(this.bus);
  }
}

'use strict';
