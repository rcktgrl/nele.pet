/* Online play for the ship card game: a room channel with a 5-letter code.
   Transport: Supabase Realtime broadcast (same project as the nele.pet arcade, no account needed),
   or BroadcastChannel between tabs when the URL has ?local=1 (for testing).
   Lockstep: both players run the same deterministic battle; only fleets and turn orders travel.
   Every message is resent until the other side acknowledges it. */
(function (root) {
  'use strict';
  const SUPABASE_URL = 'https://lglcvsptwkqxykapepey.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbGN2c3B0d2txeHlrYXBlcGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNzQ1NDcsImV4cCI6MjA2MjY1MDU0N30.ci7v2g-5wixuPKnG6wUUO87AsbI1bQ8wzRnHHG9QzIQ';
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const newCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

  async function openTransport(code, onMsg, onPeers) {
    const local = /[?&]local=1/.test(location.search);
    if (local || !root.location.hostname.endsWith('nele.pet') && /[?&]bc=1/.test(location.search)) {
      const bc = new BroadcastChannel('shipcards-' + code);
      bc.onmessage = e => onMsg(e.data);
      setTimeout(() => onPeers(1), 50);
      return { send: m => bc.postMessage(m), close: () => bc.close(), kind: 'local' };
    }
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.5/+esm');
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const me = crypto.randomUUID();
    const ch = sb.channel('shipcards:' + code, { config: { broadcast: { self: false }, presence: { key: me } } });
    ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload));
    ch.on('presence', { event: 'sync' }, () => onPeers(Object.keys(ch.presenceState()).length - 1));
    await new Promise((res, rej) => ch.subscribe(st => { if (st === 'SUBSCRIBED') { ch.track({ at: Date.now() }); res(); } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') rej(new Error('Could not connect (' + st + ')')); }));
    return { send: m => ch.send({ type: 'broadcast', event: 'm', payload: m }), close: () => sb.removeChannel(ch), kind: 'supabase' };
  }

  // Reliable messages on top of the transport: numbered, resent every 1.5 s until acknowledged.
  async function connect(code, role, handlers) {
    const out = new Map(); let seq = 0; const seen = new Set();
    let t = null;
    const onMsg = m => {
      if (!m || m.from === role) return;
      if (m.ack != null) { out.delete(m.ack); return; }
      t.send({ from: role, ack: m.seq });
      if (seen.has(m.seq)) return; seen.add(m.seq);
      handlers.onMessage && handlers.onMessage(m.type, m.data);
    };
    t = await openTransport(code, onMsg, n => handlers.onPeers && handlers.onPeers(n));
    const timer = setInterval(() => { for (const m of out.values()) t.send(m); }, 1500);
    return {
      code, role, kind: t.kind,
      send(type, data) { const m = { from: role, seq: ++seq, type, data }; out.set(m.seq, m); t.send(m); },
      close() { clearInterval(timer); t.close(); }
    };
  }
  root.ShipNet = { connect, newCode };
})(window);
