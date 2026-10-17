'use strict';
/* Red Mesa Rally · Engine and sound effects */

/* ---------------- Audio ---------------- */
class SoundFX {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain(); master.gain.value = 0.7 * Store.vol('master'); master.connect(ctx.destination);
    this.fxGain = ctx.createGain(); this.fxGain.gain.value = Store.vol('fx'); this.fxGain.connect(master);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(this.fxGain); this.out = comp;
    this.music = new Music(ctx, master); this.music.setVolume(Store.vol('music'));
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = noiseBuf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // engine
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); } shaper.curve = curve;
    this.eFilter = ctx.createBiquadFilter(); this.eFilter.type = 'lowpass'; this.eFilter.Q.value = 2.5;
    this.eGain = ctx.createGain(); this.eGain.gain.value = 0;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = ctx.createOscillator(); this.o2.type = 'square'; this.o3 = ctx.createOscillator(); this.o3.type = 'sawtooth';
    const g1 = ctx.createGain(); g1.gain.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.35; const g3 = ctx.createGain(); g3.gain.value = 0.2;
    this.o1.connect(g1).connect(shaper); this.o2.connect(g2).connect(shaper); this.o3.connect(g3).connect(shaper);
    shaper.connect(this.eFilter).connect(this.eGain).connect(this.out);
    for (const o of [this.o1, this.o2, this.o3]) o.start();
    // intake / boost roar
    this.boostF = ctx.createBiquadFilter(); this.boostF.type = 'bandpass'; this.boostF.frequency.value = 700; this.boostF.Q.value = 0.7;
    this.boostG = ctx.createGain(); this.boostG.gain.value = 0; noise().connect(this.boostF).connect(this.boostG).connect(this.out);
    // gravel crunch + skid + wind
    this.gravF = ctx.createBiquadFilter(); this.gravF.type = 'lowpass'; this.gravF.frequency.value = 900; this.gravG = ctx.createGain(); this.gravG.gain.value = 0; noise().connect(this.gravF).connect(this.gravG).connect(this.out);
    this.skidF = ctx.createBiquadFilter(); this.skidF.type = 'bandpass'; this.skidF.frequency.value = 1400; this.skidF.Q.value = 3; this.skidG = ctx.createGain(); this.skidG.gain.value = 0; noise().connect(this.skidF).connect(this.skidG).connect(this.out);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500; this.windG = ctx.createGain(); this.windG.gain.value = 0; noise().connect(this.windF).connect(this.windG).connect(this.out);
    // rival engine
    this.aiO = ctx.createOscillator(); this.aiO.type = 'sawtooth'; this.aiF = ctx.createBiquadFilter(); this.aiF.type = 'lowpass'; this.aiF.frequency.value = 600; this.aiG = ctx.createGain(); this.aiG.gain.value = 0;
    this.aiO.connect(this.aiF).connect(this.aiG).connect(this.out); this.aiO.start();
  }
  setVolume(k, v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (k === 'master') this.master.gain.setTargetAtTime(0.7 * v, t, 0.05);
    else if (k === 'fx') this.fxGain.gain.setTargetAtTime(v, t, 0.05);
    else if (k === 'music') this.music.setVolume(v);
  }
  update(car, nearest) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sp = car.spec, E = sp.engine;
    const cyl = sp.id === 'super' ? 12 : sp.id === 'truck' || sp.id === 'ironside' ? 8 : sp.id === 'kaze' ? 6 : 4;
    const f0 = Math.max(18, car.rpm / 60 * cyl / 2);
    const thr = car.reverse ? car.input.brake : car.input.throttle;
    this.o1.frequency.setTargetAtTime(f0, t, 0.02); this.o2.frequency.setTargetAtTime(f0 * 0.5, t, 0.02); this.o3.frequency.setTargetAtTime(f0 * 2.01, t, 0.02);
    const rf = car.rpm / E.red;
    this.eFilter.frequency.setTargetAtTime(220 + thr * 1800 + rf * 1400 + (sp.id === 'buggy' ? 600 : 0), t, 0.04);
    this.eGain.gain.setTargetAtTime(car.wrecked ? 0 : 0.06 + thr * 0.12 + rf * 0.05, t, 0.05);
    this.boostG.gain.setTargetAtTime(car.boosting ? 0.5 : 0, t, 0.06);
    this.boostF.frequency.setTargetAtTime(500 + rf * 900, t, 0.1);
    const speed = car.vel.length();
    let slip = 0, loose = 0, n = 0;
    for (const w of car.wheels) if (w.contact && w.surf) { n++; slip += Math.min(1, Math.abs(w.slipLat) * 3 + Math.abs(w.slip)); loose += w.surf.kind === 1 ? 0.6 : w.surf.kind === 3 ? 0.3 : 1; }
    if (n) { slip /= n; loose /= n; }
    this.gravG.gain.setTargetAtTime(n ? Math.min(0.35, speed * 0.012 * loose + slip * 0.25) : 0, t, 0.05);
    this.gravF.frequency.setTargetAtTime(400 + speed * 18, t, 0.1);
    this.skidG.gain.setTargetAtTime(n ? Math.max(0, slip - 0.35) * 0.18 * (1.2 - loose) : 0, t, 0.05);
    this.windG.gain.setTargetAtTime(Math.min(0.25, speed * speed * 0.00008), t, 0.1);
    if (nearest) {
      const d = nearest.d, c = nearest.car;
      this.aiO.frequency.setTargetAtTime(Math.max(20, c.rpm / 60 * 2), t, 0.05);
      this.aiG.gain.setTargetAtTime(Math.max(0, 0.08 * (1 - d / 45)), t, 0.1);
    } else this.aiG.gain.setTargetAtTime(0, t, 0.1);
  }
  horn(v) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.08); g.gain.setValueAtTime(0.16 * v, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    for (const fr of [277, 349, 415]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = (Math.random() - 0.5) * 10; o.connect(f); o.start(t); o.stop(t + 1.6); }
    f.connect(g).connect(this.out);
  }
  bell(v, time) {
    if (!this.ctx || v <= 0) return;
    const k = Math.floor(time * 3.2);
    if (k === this.bellK) return; this.bellK = k;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 1320;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.3);
  }
  rumble(v) {
    if (!this.ctx) return;
    if (!this.rumbleG) { const ctx = this.ctx; this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.connect(f).connect(this.rumbleG).connect(this.out); s.start(); }
    this.rumbleG.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.2);
  }
  alarm(k) { // k < 0: off, 0..1 how deep into the red zone
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (k < 0) { this.alarmNext = 0; return; }
    if (this.alarmNext && t < this.alarmNext) return;
    const period = 0.62 - 0.42 * k;
    this.alarmNext = t + period;
    for (const [i, f] of [[0, 1180], [1, 880]]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'square'; o.frequency.value = f + k * 200;
      const t0 = t + i * period * 0.45;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + period * 0.4);
      o.connect(g).connect(this.out); o.start(t0); o.stop(t0 + period * 0.45);
    }
  }
  oneShot(kind, strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (kind === 'beep' || kind === 'go') {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = kind === 'go' ? 880 : 440;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'go' ? 0.6 : 0.25));
      o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.7); return;
    }
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; const g = ctx.createGain();
    if (kind === 'boom') {
      f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.4);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.8); og.gain.setValueAtTime(0.8, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.9); o.connect(og).connect(this.out); o.start(t); o.stop(t + 1);
    } else { // thud / crash
      f.frequency.value = kind === 'crash' ? 2400 : 500;
      const v = Math.min(1, strength);
      g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'crash' ? 0.5 : 0.25));
    }
    src.connect(f).connect(g).connect(this.out); src.start(t, Math.random()); src.stop(t + 2);
  }
}
