'use strict';
/* Red Mesa Rally · DOM helper, formatting and the local save store */

/* ===================================================================
   RED MESA RALLY — game: input, camera, audio, events, HUD, menus
   =================================================================== */
const $ = (id) => document.getElementById(id);
const HEAT_RED = 0.64, HEAT_ZONE_CELL = 9; // red zone: last 5 of 14 cells
const fmtTime = (t) => { if (!isFinite(t)) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
/* a car card's stat bars: top speed and the sprint from rest measured, grip and armour rated */
const statRows = (S) => {
  const row = (label, v, val, title) => `<span class="stat" title="${title || ''}">${label}<i style="--v:${Math.round(clamp(v, 0.04, 1) * 100)}%"></i><b>${val}</b></span>`;
  const to = S.to || 100, zero = S.zero * 100 / to; // the boat's 0-50 counts as twice as long to 100
  return row('Speed', S.top / 350, `${S.top} km/h`, `Top speed ${S.top} km/h`) + row(`0–${to}`, 1 - (zero - 2.5) / 5.5, `${S.zero.toFixed(1)} s`, `0–${to} km/h in ${S.zero.toFixed(1)} s`)
    + row('Grip', S.grip, '') + row('Armour', S.armour, '');
};
const ordinal = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'ST' : n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH');

const Store = {
  key: 'redmesa.v1',
  data: { best: {}, vehicle: 'buggy', quality: null, sound: true },
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
