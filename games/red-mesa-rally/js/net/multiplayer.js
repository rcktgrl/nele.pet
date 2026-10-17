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
const MP_MAX = 8, MP_HZ = 20, MP_STALE = 3, MP_EXTRAP = 0.35, MP_PING = 2;
const MP_ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const MP_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', MP_CODE_LEN = 5;
const MP_POSE_LEN = 14, MP_AI_LEN = 15, MP_STATE_LEN = 26;
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
const rnd = (v, k = 100) => Math.round(v * k) / k;
const mpNow = () => performance.now() / 1000;
/* where a car is, how it is moving and spinning, and its lights: [pos, quat, vel, spin, flags] */
function packPose(c) {
  const f = (c.input.brake > 0.1 ? 1 : 0) | (c.boosting ? 2 : 0) | (c.wrecked ? 4 : 0) | (c.under ? 8 : 0) | (c.reverse ? 16 : 0) | (c.onGround ? 32 : 0);
  return [rnd(c.pos.x), rnd(c.pos.y), rnd(c.pos.z), rnd(c.q.x, 1e4), rnd(c.q.y, 1e4), rnd(c.q.z, 1e4), rnd(c.q.w, 1e4),
    rnd(c.vel.x), rnd(c.vel.y), rnd(c.vel.z), rnd(c.w.x), rnd(c.w.y), rnd(c.w.z), f];
}
/* a driver's car: the pose plus the dashboard and each wheel's travel and slip, small enough to send 20 times a second */
function packCar(c) {
  const W = c.wheels;
  return [...packPose(c), rnd(c.steerAngle, 1e3), Math.round(c.rpm), rnd(c.heat), rnd(c.inWater),
    ...W.map((w) => (w.contact ? rnd(Math.max(0, w.t - c.spec.wheels.r)) : -1)),
    ...W.map((w) => rnd(Math.min(2, Math.abs(w.slipLat) * 4 + Math.abs(w.slip) * 1.5)))];
}
/* the host's traffic and roaming rivals: the pose and where the front wheels point */
const packAI = (c) => [...packPose(c), rnd(c.steerAngle, 1e3)];

/* ---------------- Ghosts: cars driven on another machine ----------------
   A snapshot says where a car was when its owner sent it. Rather than draw the car back there, each one is carried
   forward to the present along its velocity and spin, and the jump a fresh snapshot makes is eased out over a few
   frames. So a ghost sits where the car really is right now, and a crash into it lands where it looks like it should. */
class Ghost {
  constructor() {
    this.snap = null; this.seen = 0; this.fresh = false; this.placed = false;
    this.err = new THREE.Vector3(); this.qErr = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._qi = new THREE.Quaternion(); this._dq = new THREE.Quaternion(); this._ax = new THREE.Vector3(); this._id = new THREE.Quaternion();
  }
  /* d: a packed pose (and extras); at: the local time it describes */
  push(d, at) {
    if (this.snap && at < this.snap.at) return; // overtaken on the way here
    this.snap = { d, at }; this.seen = mpNow(); this.fresh = true;
  }
  live(now, max) { return !!this.snap && now - this.seen < max; }
  apply(c, now, dt) {
    const D = this.snap.d, ex = clamp(now - this.snap.at, 0, MP_EXTRAP), air = !(D[13] & 32);
    const p = this._p.set(D[0] + D[7] * ex, D[1] + D[8] * ex - (air ? 4.9 * ex * ex : 0), D[2] + D[9] * ex);
    const q = this._q.set(D[3], D[4], D[5], D[6]).normalize(), wl = Math.hypot(D[10], D[11], D[12]);
    if (wl > 1e-4) q.premultiply(this._dq.setFromAxisAngle(this._ax.set(D[10] / wl, D[11] / wl, D[12] / wl), wl * ex));
    if (this.fresh) { // the gap between where we drew it and where it turns out to be: ease that out, unless it was a reset
      this.fresh = false;
      this.err.subVectors(c.pos, p); this.qErr.copy(c.q).multiply(this._qi.copy(q).invert());
      if (!this.placed || this.err.lengthSq() > 36) { this.err.set(0, 0, 0); this.qErr.identity(); }
      this.placed = true;
    }
    const k = Math.exp(-dt * 9);
    this.err.multiplyScalar(k); this.qErr.slerp(this._id, 1 - k);
    c.pos.copy(p).add(this.err); c.q.copy(q).premultiply(this.qErr);
    c.vel.set(D[7], D[8] - (air ? 9.81 * ex : 0), D[9]); c.w.set(D[10], D[11], D[12]);
    const f = D[13], wr = !!(f & 4);
    if (wr && !c.wrecked) c.events.push({ type: 'wreck', reason: 'remote' });
    c.wrecked = wr; c.wreckT = wr ? c.wreckT + dt : 0;
    c.input.brake = f & 1 ? 1 : 0; c.boosting = !!(f & 2); c.under = !!(f & 8); c.reverse = !!(f & 16); c.onGround = !!(f & 32);
    c.steerAngle = D[14]; c.speedKmh = c.vel.length() * 3.6; c._t.fwd.set(0, 0, -1).applyQuaternion(c.q);
  }
  /* wheels follow the sender's suspension and slip when it sends them, else they sit at ride height */
  wheels(c, world, near, dt) {
    const D = this.snap.d, full = D.length === MP_STATE_LEN, sp = c.spec, vF = c.vel.dot(c._t.fwd);
    const ride = Math.max(0, sp.susp.rest - sp.mass * 9.81 / 4 / sp.susp.k);
    for (let i = 0; i < 4; i++) {
      const w = c.wheels[i], e = full ? D[18 + i] : c.onGround ? ride : -1;
      w.steer = w.front ? c.steerAngle : 0; w.contact = e >= 0; w.t = sp.wheels.r + Math.max(0, e);
      w.spin -= vF / sp.wheels.r * dt; w.slipLat = full ? D[22 + i] / 4 : 0; w.slip = 0;
      if (w.contact && near) { w.cp.set(w.lx, w.ly - w.t, w.lz).applyQuaternion(c.q).add(c.pos); w.surf = world.surface(w.cp.x, w.cp.z, w.cp.y); } else w.surf = null;
    }
  }
}
class Peer {
  constructor(s, id, slot) {
    this.s = s; this.id = id; this.slot = slot; this.name = 'Driver'; this.t = 0; this.info = null;
    this.pc = null; this.u = null; this.r = null; this.ice = []; this.tries = 0; this.link = 'connecting';
    this.ghost = new Ghost(); this.car = null; this.label = null; this.rebuild = false;
    this.lag = []; this.rtt = 0.1; this.pinged = false;
  }
  /* the local time a moment stamped t on their clock happened: their clock's offset is the smallest
     arrival delay seen lately (the least-delayed message), less half the round trip */
  stamp(t) {
    const now = mpNow();
    if (!Number.isFinite(t)) return now - this.rtt / 2;
    const L = this.lag; L.push(now - t); if (L.length > 60) L.shift();
    return t + Math.min(...L) - this.rtt / 2;
  }
  pong(t) { const rtt = mpNow() - t; if (!(rtt >= 0 && rtt < 5)) return; this.rtt = this.pinged ? lerp(this.rtt, rtt, 0.3) : rtt; this.pinged = true; }
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
  push(d, t) {
    if (!Array.isArray(d) || d.length !== MP_STATE_LEN || !d.every(Number.isFinite)) return;
    this.ghost.push(d, this.stamp(t));
  }
  /* their car where it is now, by the latest snapshot carried forward */
  animate(now, dt) {
    const g = this.s.g, G = this.ghost;
    if (!G.snap) return;
    if (!this.car || this.rebuild) g.mpCar(this);
    const c = this.car, stale = !G.live(now, MP_STALE);
    c.hidden = c.asleep = stale;
    if (stale) return;
    G.apply(c, now, dt);
    const D = G.snap.d;
    c.rpm = D[15]; c.heat = D[16]; c.inWater = D[17];
    G.wheels(c, g.world, c.pos.distanceTo(g.player.pos) < 160, dt);
  }
}
class Session {
  constructor(game) { this.g = game; this.id = randomId(); this.peers = new Map(); this.active = false; this.ch = null; this.sendT = 0; this.relayN = {}; this.tick = 0; this.pingT = 0; this.hostId = null; this.early = new Map(); }
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
    ch.on('broadcast', { event: 'relay' }, ({ payload: p }) => { const peer = p && this.peers.get(p.from); if (peer && !peer.direct() && (!p.to || p.to === this.id)) this.onMessage(peer, p.m); });
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
    // anyone without a direct line hears it over the room channel (car and traffic state at half rate there)
    const n = this.relayN[m.k] = (this.relayN[m.k] || 0) + 1;
    if (relay && this.ch && (reliable || n % 2)) this.ch.send({ type: 'broadcast', event: 'relay', payload: { from: this.id, m } });
  }
  /* one driver only: straight down their line, or over the room channel addressed to them */
  sendTo(id, m, reliable) {
    const p = this.peers.get(id); if (!p) return;
    if (!p.send(JSON.stringify(m), reliable) && this.ch) this.ch.send({ type: 'broadcast', event: 'relay', payload: { from: this.id, to: id, m } });
  }
  onMessage(p, m) {
    if (!m || typeof m !== 'object') return;
    const g = this.g;
    if (m.k === 's') p.push(m.d, m.t);
    else if (m.k === 'tr' && p.id === this.hostId) g.mpTraffic(p, m);
    else if (m.k === 'hit') g.mpHit(p, m);
    else if (m.k === 'ping') this.sendTo(p.id, { k: 'pong', t: m.t });
    else if (m.k === 'pong') p.pong(Number(m.t));
    else if (m.k === 'race' && p.id === this.hostId) g.mpRace(m);
    else if (m.k === 'fin') g.mpFinish(p, m);
    else if (m.k === 'quit') g.mpQuit(p);
  }
  /* who lines up for a race: the drivers out on the map right now, in room order */
  raceOrder() { return this.list.filter((x) => x.me || (x.car && !x.car.hidden)).map((x) => x.id); }
  update(dt) {
    if (!this.active) return;
    const g = this.g;
    const now = mpNow(), t = rnd(now, 1000);
    this.sendT -= dt;
    if (this.sendT <= 0 && g.inWorld()) {
      this.sendT = 1 / MP_HZ;
      if (this.peers.size) {
        this.broadcast({ k: 's', t, d: packCar(g.player) });
        // the host runs the traffic and the roaming rivals for everyone: half as often, and where the sleeping ones are now and then
        if (this.isHost && ++this.tick % 2 === 0) { const m = g.trafficPacket(this.tick % 10 === 0); if (m) { m.t = t; this.broadcast(m); } }
      }
    }
    if ((this.pingT -= dt) <= 0) { this.pingT = MP_PING; for (const p of this.peers.values()) this.sendTo(p.id, { k: 'ping', t }); }
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
