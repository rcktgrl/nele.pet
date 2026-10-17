'use strict';
/* Red Mesa Rally · Online leaderboard: every arcade driver's best time per event, kept on the arcade's Supabase.
   Reading is open to everyone; posting needs an arcade sign-in and goes through redmesa_submit_time(),
   which only ever keeps the faster time (supabase/redmesa_leaderboard_setup.sql). */

const LB_TABLE = 'redmesa_leaderboard', LB_TOP = 10, LB_EVENT_TOP = 5, LB_FRESH = 60000;

const Leaderboard = {
  cache: new Map(), // event id → { at, rows }
  async user() {
    try { const { data } = await (await supa()).auth.getSession(); return (data && data.session && data.session.user) || null; } catch (e) { return null; }
  },
  async top(evId, force) {
    const hit = this.cache.get(evId);
    if (!force && hit && performance.now() - hit.at < LB_FRESH) return hit.rows;
    const { data, error } = await (await supa()).from(LB_TABLE).select('user_id,username,vehicle,time_ms')
      .eq('event_id', evId).order('time_ms', { ascending: true }).order('updated_at', { ascending: true }).limit(LB_TOP);
    if (error) throw error;
    const rows = (data || []).map((r) => ({ uid: String(r.user_id || ''), name: cleanName(r.username) || 'Player', vehicle: VEHICLES[r.vehicle] ? r.vehicle : null, time: Math.max(0, Number(r.time_ms) || 0) / 1000 }));
    this.cache.set(evId, { at: performance.now(), rows });
    return rows;
  },
  async submit(evId, time, vehicle, bestLap) {
    const { data, error } = await (await supa()).rpc('redmesa_submit_time', {
      p_event_id: evId, p_time_ms: Math.round(time * 1000), p_vehicle: vehicle,
      p_best_lap_ms: isFinite(bestLap) && bestLap > 0 ? Math.round(bestLap * 1000) : null,
    });
    if (error) throw error;
    this.cache.delete(evId);
    return { improved: !!(data && data.improved), best: Number(data && data.best_ms) / 1000, rank: Number(data && data.rank) || 0 };
  },
};

Object.assign(Game.prototype, {
  onlineRows(rows, uid) {
    return rows.map((r, i) => `<tr class="${uid && r.uid === uid ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="muted">${r.vehicle ? VEHICLES[r.vehicle].name : ''}</td><td class="t">${fmtTime(r.time)}</td></tr>`).join('');
  },
  /* the event screen: the online top few before you start */
  async eventOnline(ev) {
    const el = $('evOnline'), tok = this.lbTok = (this.lbTok || 0) + 1;
    el.innerHTML = '<tr><td class="muted">Loading online times…</td></tr>';
    try {
      const [rows, user] = await Promise.all([Leaderboard.top(ev.id), Leaderboard.user()]);
      if (tok !== this.lbTok) return;
      el.innerHTML = rows.length ? this.onlineRows(rows.slice(0, LB_EVENT_TOP), user && user.id) : '<tr><td class="muted">No online times yet. Set the first one.</td></tr>';
    } catch (e) {
      console.warn('leaderboard', e);
      if (tok === this.lbTok) el.innerHTML = '<tr><td class="muted">Online leaderboard unavailable</td></tr>';
    }
  },
  /* the results screen: post your time if you're signed in, then show the board */
  async resultsOnline(ev, time, bestLap, vehicle) {
    const el = $('resOnline'), note = $('resOnlineNote'), tok = this.lbTok = (this.lbTok || 0) + 1;
    el.innerHTML = ''; note.textContent = 'Loading online times…';
    try {
      const user = await Leaderboard.user();
      let msg = '';
      if (!user) msg = 'Sign in on the <a href="../">arcade page</a> to post your times online.';
      else if (time > 0) {
        const r = await Leaderboard.submit(ev.id, time, vehicle, bestLap);
        msg = r.improved ? `New online best · #${r.rank} on the board` : `Your online best ${fmtTime(r.best)} · #${r.rank}`;
      }
      const rows = await Leaderboard.top(ev.id, true);
      if (tok !== this.lbTok) return;
      el.innerHTML = this.onlineRows(rows, user && user.id);
      note.innerHTML = msg || (rows.length ? '' : 'No online times yet.');
    } catch (e) {
      console.warn('leaderboard', e);
      if (tok === this.lbTok) { el.innerHTML = ''; note.textContent = 'Online leaderboard unavailable'; }
    }
  },
});
