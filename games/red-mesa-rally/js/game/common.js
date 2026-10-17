'use strict';
/* Red Mesa Rally · DOM helper, formatting and the local save store */

/* ===================================================================
   RED MESA RALLY — game: input, camera, audio, events, HUD, menus
   =================================================================== */
const $ = (id) => document.getElementById(id);
const HEAT_RED = 0.64, HEAT_ZONE_CELL = 9; // red zone: last 5 of 14 cells
const fmtTime = (t) => { if (!isFinite(t)) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const ordinal = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'ST' : n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH');

const Store = {
  key: 'redmesa.v1',
  data: { best: {}, vehicle: 'rally', quality: null, sound: true },
  load() { try { const s = localStorage.getItem(this.key); if (s) Object.assign(this.data, JSON.parse(s)); } catch (e) { /* storage blocked */ } },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* storage blocked */ } },
  // 0..1 per channel; falls back to the old on/off toggles
  vol(k) {
    const v = this.data.vol && this.data.vol[k];
    if (typeof v === 'number') return clamp(v, 0, 1);
    const legacy = { master: 'sound', music: 'music', voice: 'voice' }[k];
    return legacy && this.data[legacy] === false ? 0 : 1;
  },
  setVol(k, v) { this.data.vol = { ...this.data.vol, [k]: clamp(v, 0, 1) }; },
};
