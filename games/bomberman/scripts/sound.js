// ─── Sound System ──────────────────────────────────────────────────────────────
// Procedural music and SFX via Web Audio API

// A minor pentatonic: A3, C4, D4, E4, G4, A4, C5, D5
const PENTA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];

// 16-step patterns (index into PENTA, null = rest)
const MELODY_PAT = [0, null, 4, null, 2, 4, null, 5, null, 4, 2, null, 0, null, null, 3];
const BASS_PAT   = [0, null, null, null, 3, null, null, null, 5, null, null, null, 0, null, null, null];
const KICK_PAT   = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const HIHAT_PAT  = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];

export class SoundSystem {
  constructor() {
    this._ctx        = null;
    this._masterGain = null;
    this._bpm        = 100;
    this._step       = 0;
    this._nextStep   = 0;
    this._running    = false;
    this._timerID    = null;
  }

  _ensureCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = 0.35;
      this._masterGain.connect(this._ctx.destination);
    }
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._ctx;
  }

  init() { this._ensureCtx(); }

  setBricksDestroyed(n) {
    // BPM: 100 → 200 as n goes 0 → 50
    this._bpm = Math.min(200, 100 + Math.round(n * 2));
  }

  get _stepDur() { return 60 / (this._bpm * 4); } // 16th-note in seconds

  start() {
    const ctx = this._ensureCtx();
    if (this._running) return;
    this._running  = true;
    this._bpm      = 100; // always reset tempo for a new game
    this._step     = 0;
    this._nextStep = ctx.currentTime + 0.05;
    this._schedule();
  }

  stop() {
    this._running = false;
    if (this._timerID) { clearTimeout(this._timerID); this._timerID = null; }
  }

  _schedule() {
    if (!this._running) return;
    const ctx = this._ctx;
    const AHEAD = 0.25;
    while (this._nextStep < ctx.currentTime + AHEAD) {
      this._playStep(this._step, this._nextStep);
      this._step      = (this._step + 1) % 16;
      this._nextStep += this._stepDur;
    }
    this._timerID = setTimeout(() => this._schedule(), 50);
  }

  _playStep(step, t) {
    const sd = this._stepDur;
    const mi = MELODY_PAT[step];
    if (mi !== null) this._note(PENTA[mi],     t, sd * 0.9,  0.12, 'square');
    const bi = BASS_PAT[step];
    if (bi !== null) this._note(PENTA[bi] / 2, t, sd * 3.5,  0.18, 'sine');
    if (KICK_PAT[step])  this._kick(t);
    if (HIHAT_PAT[step]) this._hihat(t);
  }

  _note(freq, t, dur, gain, type) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.2);
    osc.connect(g); g.connect(this._masterGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  _kick(t) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.12);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g); g.connect(this._masterGain);
    osc.start(t); osc.stop(t + 0.2);
  }

  _hihat(t) {
    const ctx    = this._ctx;
    const bufLen = Math.floor(ctx.sampleRate * 0.05);
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src    = ctx.createBufferSource(); src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(filter); filter.connect(g); g.connect(this._masterGain);
    src.start(t);
  }

  // ── SFX ─────────────────────────────────────────────────────────────────────

  playExplosion() {
    const ctx = this._ensureCtx();
    // Filtered noise burst
    const bufLen = Math.floor(ctx.sampleRate * 0.7);
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src    = ctx.createBufferSource(); src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    src.connect(filter); filter.connect(g); g.connect(ctx.destination);
    src.start(ctx.currentTime);
    // Low thud
    const osc = ctx.createOscillator();
    const og  = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 0.25);
    og.gain.setValueAtTime(0.6, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(og); og.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35);
  }

  playBombPlace() {
    const ctx = this._ensureCtx();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(280, ctx.currentTime);
    osc.frequency.setTargetAtTime(140, ctx.currentTime, 0.08);
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
  }

  playPowerup() {
    const ctx   = this._ensureCtx();
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((freq, i) => {
      const t   = ctx.currentTime + i * 0.08;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.15);
    });
  }

  playKick() {
    const ctx = this._ensureCtx();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.setTargetAtTime(150, ctx.currentTime, 0.03);
    g.gain.setValueAtTime(0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
  }
}
