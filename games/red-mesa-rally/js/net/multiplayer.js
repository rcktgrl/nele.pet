'use strict';
/* Red Mesa Rally · Multiplayer: Supabase signalling and WebRTC peers */

/* ---------------- Multiplayer: peer to peer ----------------
   Drivers meet in a room on the arcade's Supabase realtime channel, which only carries
   WebRTC signalling (offers, answers, ICE candidates) and presence. Car state then flows
   straight between browsers over data channels. A peer we can't reach directly (strict NAT,
   no TURN server) gets the same messages relayed over the room channel instead.
   Who you are comes from the arcade profile: the arcade_user the hub caches on login. */
const SUPA_URL = 'https://lglcvsptwkqxykapepey.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';
const SUPA_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm';
const MP_MAX = 8, MP_HZ = 15, MP_DELAY = 0.12, MP_STALE = 3; // render remote cars a little behind their newest snapshot
const MP_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const MP_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', MP_CODE_LEN = 5;
const MP_STATE_LEN = 23;
let supaClient = null;
async function supa() { if (!supaClient) { const { createClient } = await import(SUPA_ESM); supaClient = createClient(SUPA_URL, SUPA_KEY); } return supaClient; }
const cleanName = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 24);
const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const mpCode = () => Array.from({ length: MP_CODE_LEN }, () => MP_CODE[Math.floor(Math.random() * MP_CODE.length)]).join('');
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MP_CODE_LEN);
/* the arcade profile, same shape the hub and the other arcade games use */
async function arcadeProfile() {
  try { const c = JSON.parse(localStorage.getItem('arcade_user') || 'null'); if (c && cleanName(c.name)) return { uid: c.user_id ? String(c.user_id) : null, name: cleanName(c.name) }; } catch (e) { /* storage blocked */ }
  try {
    const { data } = await (await supa()).auth.getSession();
    const u = data && data.session && data.session.user; if (!u) return null;
    const p = { user_id: u.id, name: cleanName((u.user_metadata && u.user_metadata.username) || (u.email || '').split('@')[0] || 'Player'), email: u.email };
    try { localStorage.setItem('arcade_user', JSON.stringify(p)); } catch (e) { /* storage blocked */ }
    return { uid: p.user_id, name: p.name };
  } catch (e) { console.warn('arcade profile', e); return null; }
}
/* one car's pose and dashboard, small enough to send 15 times a second */
function packCar(c) {
  const r = (v, k = 100) => Math.round(v * k) / k, W = c.wheels;
  const f = (c.input.brake > 0.1 ? 1 : 0) | (c.boosting ? 2 : 0) | (c.wrecked ? 4 : 0) | (c.under ? 8 : 0) | (c.reverse ? 16 : 0) | (c.onGround ? 32 : 0);
  return [r(c.pos.x), r(c.pos.y), r(c.pos.z), r(c.q.x, 1e4), r(c.q.y, 1e4), r(c.q.z, 1e4), r(c.q.w, 1e4), r(c.vel.x), r(c.vel.y), r(c.vel.z),
    r(c.steerAngle, 1e3), f, Math.round(c.rpm), r(c.heat), r(c.inWater),
    ...W.map((w) => (w.contact ? r(Math.max(0, w.t - c.spec.wheels.r)) : -1)),
    ...W.map((w) => r(Math.min(2, Math.abs(w.slipLat) * 4 + Math.abs(w.slip) * 1.5)))];
}
class Peer {
  constructor(s, id, slot) {
    this.s = s; this.id = id; this.slot = slot; this.name = 'Driver'; this.t = 0; this.info = null;
    this.pc = null; this.u = null; this.r = null; this.ice = []; this.tries = 0; this.link = 'connecting';
    this.buf = []; this.car = null; this.label = null; this.rebuild = false;
    this._qa = new THREE.Quaternion(); this._qb = new THREE.Quaternion();
  }
  get initiator() { return this.s.id < this.id; } // exactly one side of each pair makes the offer
  direct() { return !!(this.r && this.r.readyState === 'open'); }
  setInfo(info) { const k = JSON.stringify(info || null); if (k !== this.infoKey) { this.infoKey = k; this.info = info && typeof info === 'object' ? info : {}; this.rebuild = true; } }
  connect(initiator) {
    this.closePc();
    if (!window.RTCPeerConnection) { this.fail(); return; }
    const pc = this.pc = new RTCPeerConnection({ iceServers: MP_ICE });
    pc.onicecandidate = (e) => { if (e.candidate && pc === this.pc) this.s.signal(this.id, { ice: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc !== this.pc) return; if (pc.connectionState === 'failed') this.fail(); this.s.g.mpRefresh(); };
    pc.ondatachannel = (e) => this.bind(e.channel);
    if (initiator) {
      this.ice.length = 0;
      this.bind(pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
      this.bind(pc.createDataChannel('r'));
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.s.signal(this.id, { sdp: pc.localDescription.toJSON() })).catch((e) => { console.warn('rtc offer', e); this.fail(); });
    }
    clearTimeout(this.timer); this.timer = setTimeout(() => { if (pc === this.pc && !this.direct()) this.fail(); }, 12000);
  }
  bind(dc) {
    if (dc.label === 'u') this.u = dc; else this.r = dc;
    dc.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } this.s.onMessage(this, m); };
    dc.onopen = () => { if (dc === this.r) { this.link = 'direct'; this.tries = 0; this.s.g.mpRefresh(); } };
    dc.onclose = () => { if (dc === this.r && this.s.active) { this.link = 'relay'; this.s.g.mpRefresh(); } };
  }
  /* no direct line: messages go over the room channel, and the offering side tries again a couple of times */
  fail() {
    this.link = 'relay'; this.s.g.mpRefresh();
    if (this.initiator && this.tries < 2) { this.tries++; setTimeout(() => { if (this.s.active && this.s.peers.get(this.id) === this && !this.direct()) this.connect(true); }, 3000); }
  }
  async onSignal(d) {
    try {
      if (d.sdp && (d.sdp.type === 'offer' || d.sdp.type === 'answer')) {
        if (d.sdp.type === 'offer') { if (this.initiator) return; this.connect(false); } // a fresh offer replaces whatever line we had
        const pc = this.pc; if (!pc) return;
        await pc.setRemoteDescription(d.sdp);
        for (const c of this.ice.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.s.signal(this.id, { sdp: pc.localDescription.toJSON() }); }
      } else if (d.ice) {
        if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(d.ice).catch(() => {}); else if (this.ice.length < 60) this.ice.push(d.ice);
      }
    } catch (e) { console.warn('rtc signal', e); }
  }
  send(str, reliable) {
    const dc = !reliable && this.u && this.u.readyState === 'open' ? this.u : this.r;
    if (dc && dc.readyState === 'open') { try { dc.send(str); return true; } catch (e) { /* fall back to the relay */ } }
    return false;
  }
  closePc() {
    const { pc, u, r } = this; this.pc = this.u = this.r = null;
    for (const dc of [u, r]) if (dc) try { dc.close(); } catch (e) { /* already closed */ }
    if (pc) try { pc.close(); } catch (e) { /* already closed */ }
  }
  close() { clearTimeout(this.timer); this.closePc(); }
  push(d) {
    if (!Array.isArray(d) || d.length !== MP_STATE_LEN || !d.every(Number.isFinite)) return;
    this.buf.push({ at: performance.now() / 1000, d }); if (this.buf.length > 30) this.buf.shift();
  }
  /* ease the car between the last two snapshots; coast on its velocity for a moment if the next one is late */
  animate(now, dt) {
    const g = this.s.g, B = this.buf;
    if (!B.length) return;
    if (!this.car || this.rebuild) g.mpCar(this);
    const c = this.car, stale = now - B[B.length - 1].at > MP_STALE;
    c.hidden = c.asleep = stale;
    if (stale) return;
    const rt = now - MP_DELAY;
    while (B.length > 2 && B[1].at <= rt) B.shift();
    const a = B[0], b = B[1] || B[0], A = a.d, D = b.d;
    const k = b !== a ? clamp((rt - a.at) / Math.max(1e-3, b.at - a.at), 0, 1) : 1, over = clamp(rt - b.at, 0, 0.25);
    c.pos.set(lerp(A[0], D[0], k) + D[7] * over, lerp(A[1], D[1], k) + D[8] * over, lerp(A[2], D[2], k) + D[9] * over);
    c.q.slerpQuaternions(this._qa.set(A[3], A[4], A[5], A[6]).normalize(), this._qb.set(D[3], D[4], D[5], D[6]).normalize(), k);
    c.vel.set(lerp(A[7], D[7], k), lerp(A[8], D[8], k), lerp(A[9], D[9], k)); c.w.set(0, 0, 0);
    const f = D[11], wr = !!(f & 4);
    if (wr && !c.wrecked) c.events.push({ type: 'wreck', reason: 'remote' });
    c.wrecked = wr; c.wreckT = wr ? c.wreckT + dt : 0;
    c.input.brake = f & 1 ? 1 : 0; c.boosting = !!(f & 2); c.under = !!(f & 8); c.reverse = !!(f & 16); c.onGround = !!(f & 32);
    c.steerAngle = D[10]; c.rpm = D[12]; c.heat = D[13]; c.inWater = D[14]; c.speedKmh = c.vel.length() * 3.6;
    const sp = c.spec, fwd = c._t.fwd.set(0, 0, -1).applyQuaternion(c.q), vF = c.vel.dot(fwd), near = c.pos.distanceTo(g.player.pos) < 160;
    for (let i = 0; i < 4; i++) {
      const w = c.wheels[i], e = D[15 + i];
      w.steer = w.front ? c.steerAngle : 0; w.contact = e >= 0; w.t = sp.wheels.r + Math.max(0, e);
      w.spin -= vF / sp.wheels.r * dt; w.slipLat = D[19 + i] / 4; w.slip = 0;
      if (w.contact && near) { w.cp.set(w.lx, w.ly - w.t, w.lz).applyQuaternion(c.q).add(c.pos); w.surf = g.world.surface(w.cp.x, w.cp.z, w.cp.y); } else w.surf = null;
    }
  }
}
class Session {
  constructor(game) { this.g = game; this.id = randomId(); this.peers = new Map(); this.active = false; this.ch = null; this.sendT = 0; this.relayN = 0; this.hostId = null; this.early = new Map(); }
  /* everyone in the room, oldest first; the oldest one hosts */
  get list() { return [{ id: this.id, name: this.me.name, t: this.t, me: true }, ...this.peers.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1)); }
  get isHost() { return this.active && this.hostId === this.id; }
  async open(code, me) {
    this.code = code; this.me = me; this.t = Date.now();
    const sb = await supa();
    const ch = this.ch = sb.channel('redmesa:' + code, { config: { broadcast: { self: false }, presence: { key: this.id } } });
    ch.on('presence', { event: 'sync' }, () => this.syncPresence());
    ch.on('broadcast', { event: 'sig' }, ({ payload: p }) => {
      if (!p || p.to !== this.id || !p.data || typeof p.from !== 'string') return;
      const peer = this.peers.get(p.from);
      if (peer) peer.onSignal(p.data);
      else { const q = this.early.get(p.from) || []; if (q.length < 60) q.push(p.data); this.early.set(p.from, q); } // an offer can beat their presence here
    });
    ch.on('broadcast', { event: 'relay' }, ({ payload: p }) => { const peer = p && this.peers.get(p.from); if (peer && !peer.direct()) this.onMessage(peer, p.m); });
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('The session server did not answer')), 12000);
      ch.subscribe((st) => {
        if (st === 'SUBSCRIBED') { clearTimeout(timer); res(); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(timer); rej(new Error('Could not reach the session server')); }
      });
    });
    this.active = true; this.hostId = this.id;
    await this.track();
  }
  track() { if (!this.ch) return Promise.resolve(); return this.ch.track({ id: this.id, name: this.me.name, uid: this.me.uid, t: this.t, car: this.g.carInfo() }).catch((e) => console.warn('presence', e)); }
  syncPresence() {
    if (!this.active) return;
    const seen = new Set();
    for (const metas of Object.values(this.ch.presenceState())) for (const m of metas) {
      if (!m || typeof m.id !== 'string' || m.id === this.id || seen.has(m.id)) continue;
      seen.add(m.id);
      let p = this.peers.get(m.id), fresh = false;
      if (!p) {
        const used = new Set([...this.peers.values()].map((q) => q.slot)); let slot = 0; while (used.has(slot)) slot++;
        p = new Peer(this, m.id, slot); this.peers.set(m.id, p); fresh = true;
      }
      p.name = cleanName(m.name) || 'Driver'; p.uid = m.uid || null; p.t = Number(m.t) || 0; p.setInfo(m.car);
      if (p.car) p.car.name = p.name;
      if (fresh) {
        this.g.mpJoined(p);
        if (p.initiator) p.connect(true);
        const early = this.early.get(m.id); this.early.delete(m.id);
        if (early) (async () => { for (const d of early) await p.onSignal(d); })();
      }
    }
    for (const [id, p] of this.peers) if (!seen.has(id)) { p.close(); this.peers.delete(id); this.g.mpLeft(p); }
    const L = this.list;
    if (L.length > MP_MAX && L.findIndex((x) => x.me) >= MP_MAX) { this.g.leaveMp(`That session is full (${MP_MAX} drivers).`); return; }
    const host = L[0].id;
    if (host !== this.hostId) { this.hostId = host; this.g.toast(host === this.id ? 'You are hosting' : `${esc(L[0].name)} is hosting`, 'The host starts the events', 'region'); }
    this.g.mpRefresh();
  }
  signal(to, data) { if (this.ch) this.ch.send({ type: 'broadcast', event: 'sig', payload: { from: this.id, to, data } }); }
  broadcast(m, reliable) {
    const str = JSON.stringify(m); let relay = false;
    for (const p of this.peers.values()) if (!p.send(str, reliable)) relay = true;
    // anyone without a direct line hears it over the room channel (car state at half rate there)
    if (relay && this.ch && (reliable || this.relayN++ % 2 === 0)) this.ch.send({ type: 'broadcast', event: 'relay', payload: { from: this.id, m } });
  }
  onMessage(p, m) {
    if (!m || typeof m !== 'object') return;
    const g = this.g;
    if (m.k === 's') p.push(m.d);
    else if (m.k === 'race' && p.id === this.hostId) g.mpRace(m);
    else if (m.k === 'fin') g.mpFinish(p, m);
    else if (m.k === 'quit') g.mpQuit(p);
  }
  /* who lines up for a race: the drivers out on the map right now, in room order */
  raceOrder() { return this.list.filter((x) => x.me || (x.car && !x.car.hidden)).map((x) => x.id); }
  update(dt) {
    if (!this.active) return;
    const g = this.g;
    this.sendT -= dt;
    if (this.sendT <= 0 && g.inWorld()) { this.sendT = 1 / MP_HZ; if (this.peers.size) this.broadcast({ k: 's', d: packCar(g.player) }); }
    const now = performance.now() / 1000;
    for (const p of this.peers.values()) p.animate(now, dt);
  }
  leave() {
    this.active = false;
    for (const p of this.peers.values()) { p.close(); this.g.mpLeft(p, true); }
    this.peers.clear();
    const ch = this.ch; this.ch = null;
    if (ch) { ch.untrack().catch(() => {}).finally(() => supaClient.removeChannel(ch)); }
  }
}
