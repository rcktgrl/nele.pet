// ─── Sound System ──────────────────────────────────────────────────────────────
// Procedural 8-bit music + SFX via Web Audio API

const PENTA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];

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

    // Create AudioContext eagerly — it will sit suspended until a user gesture
    // resumes it. This avoids the race between gesture context and async code.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this._ctx        = new AC();
        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = 0.35;
        this._masterGain.connect(this._ctx.destination);
      }
    } catch (e) { /* Web Audio not available */ }
  }

  // Call on every user interaction — safe to call repeatedly.
  tryResume() {
    if (this._ctx && this._ctx.state !== 'running') {
      this._ctx.resume().catch(() => {});
    }
  }

  // Legacy alias used by existing call sites.
  init() { this.tryResume(); }

  get _ready() { return this._ctx?.state === 'running'; }

  setBricksDestroyed(n) {
    // BPM: 100 → 200 as n goes 0 → 50
    this._bpm = Math.min(200, 100 + Math.round(n * 2));
  }

  get _stepDur() { return 60 / (this._bpm * 4); }

  start() {
    this.tryResume();
    if (this._running) return;
    this._running  = true;
    this._step     = 0;
    // Use the current clock if running, else 0 (will be corrected on resume)
    this._nextStep = (this._ctx?.currentTime ?? 0) + 0.05;
    this._schedule();
  }

  stop() {
    this._running = false;
    if (this._timerID) { clearTimeout(this._timerID); this._timerID = null; }
    if (this._masterGain) {
      try {
        this._masterGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.2);
        setTimeout(() => {
          if (this._masterGain) this._masterGain.gain.value = 0.35;
        }, 800);
      } catch (_) {}
    }
  }

  _schedule() {
    if (!this._running || !this._ctx) return;
    // If context is still suspended, retry in 100ms
    if (this._ctx.state !== 'running') {
      this._timerID = setTimeout(() => this._schedule(), 100);
      return;
    }

    const AHEAD = 0.25;
    // Guard against _nextStep falling far behind (e.g. after long suspension)
    if (this._nextStep < this._ctx.currentTime - 0.5) {
      this._nextStep = this._ctx.currentTime + 0.05;
    }

    while (this._nextStep < this._ctx.currentTime + AHEAD) {
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
    if (!this._ctx || !this._masterGain) return;
    try {
      const osc = this._ctx.createOscillator();
      const g   = this._ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.005);
      g.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.2);
      osc.connect(g); g.connect(this._masterGain);
      osc.start(t); osc.stop(t + dur + 0.05);
    } catch (_) {}
  }

  _kick(t) {
    if (!this._ctx || !this._masterGain) return;
    try {
      const osc = this._ctx.createOscillator();
      const g   = this._ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.12);
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g); g.connect(this._masterGain);
      osc.start(t); osc.stop(t + 0.2);
    } catch (_) {}
  }

  _hihat(t) {
    if (!this._ctx || !this._masterGain) return;
    try {
      const bufLen = Math.floor(this._ctx.sampleRate * 0.05);
      const buf    = this._ctx.createBuffer(1, bufLen, this._ctx.sampleRate);
      const data   = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const src    = this._ctx.createBufferSource(); src.buffer = buf;
      const filter = this._ctx.createBiquadFilter();
      filter.type = 'highpass'; filter.frequency.value = 6000;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      src.connect(filter); filter.connect(g); g.connect(this._masterGain);
      src.start(t);
    } catch (_) {}
  }

  // ── SFX (called at the moment of event, not pre-scheduled) ─────────────────

  _sfx(fn) {
    if (!this._ctx) return;
    this.tryResume();
    if (this._ctx.state !== 'running') return; // can't play if still blocked
    try { fn(this._ctx); } catch (_) {}
  }

  playExplosion() {
    this._sfx(ctx => {
      const now    = ctx.currentTime;
      const bufLen = Math.floor(ctx.sampleRate * 0.7);
      const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data   = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const src    = ctx.createBufferSource(); src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(80, now + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      src.connect(filter); filter.connect(g); g.connect(ctx.destination);
      src.start(now);

      const osc = ctx.createOscillator();
      const og  = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(25, now + 0.25);
      og.gain.setValueAtTime(0.6, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(og); og.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.35);
    });
  }

  playBombPlace() {
    this._sfx(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.setTargetAtTime(140, now, 0.08);
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.2);
    });
  }

  playPowerup() {
    this._sfx(ctx => {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const t   = ctx.currentTime + i * 0.08;
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.type = 'square'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.15);
      });
    });
  }

  playKick() {
    this._sfx(ctx => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.setTargetAtTime(150, now, 0.03);
      g.gain.setValueAtTime(0.35, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.15);
    });
  }
}
