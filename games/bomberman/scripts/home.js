import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

// ─── Arcade account lookup ────────────────────────────────────────────────────
async function getArcadeUser() {
  try {
    const cached = JSON.parse(localStorage.getItem('arcade_user') || 'null');
    if (cached?.name) return cached;
  } catch { /* ignore */ }

  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (!user) return null;

  const name = user.user_metadata?.username
    || user.email?.split('@')[0]
    || 'Player';
  const arcadeUser = { user_id: user.id, name, email: user.email };
  localStorage.setItem('arcade_user', JSON.stringify(arcadeUser));
  return arcadeUser;
}

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
let currentPlayerName = null;

function setStatus(msg, err = false) {
  const el = $('status-msg');
  el.textContent = msg;
  el.style.color = err ? '#ff4444' : '#aaa8cc';
}

function goToLobby(roomCode, playerName, host = false, isPrivate = false) {
  const p = new URLSearchParams({ room: roomCode, name: playerName });
  if (host)      p.set('host', '1');
  if (isPrivate) p.set('private', '1');
  location.href = `lobby.html?${p}`;
}

// ─── Stale room cleanup ───────────────────────────────────────────────────────
// Runs on every home-page load. Any room older than 10 min is considered
// abandoned (host closed tab, connection dropped, etc.) and deleted.
// Uses keepalive fetch so it fires even if the page is being torn down.
function cleanupStaleRooms() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  fetch(
    `${SUPABASE_URL}/rest/v1/bomberman_rooms?created_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      keepalive: true,
    }
  ).catch(() => { /* best-effort */ });
}

// ─── Public rooms list ────────────────────────────────────────────────────────
async function loadRooms() {
  const { data, error } = await supabase
    .from('bomberman_rooms')
    .select('*')
    .eq('status', 'waiting')
    .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()) // max 10 min old
    .order('created_at', { ascending: false })
    .limit(6);

  if (error) {
    console.warn('Could not load rooms:', error.message);
    renderRoomList([]);
    return;
  }
  renderRoomList(data ?? []);
}

function renderRoomList(rooms) {
  const list = $('room-list');
  list.innerHTML = '';

  if (rooms.length === 0) {
    list.innerHTML = '<p class="rooms-empty">No open rooms right now — create one!</p>';
    return;
  }

  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'room-row';
    row.innerHTML = `
      <span class="room-row-host">${escHtml(room.host_name)}</span>
      <span class="room-row-count">${room.player_count}/4 players</span>
      <span class="room-row-code">${room.code}</span>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Join';
    btn.addEventListener('click', () => {
      if (!currentPlayerName) { setStatus('Log in to the Arcade first!', true); return; }
      goToLobby(room.code, currentPlayerName, false, false);
    });
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function subscribeRooms() {
  supabase
    .channel('bomberman_rooms_watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bomberman_rooms' }, loadRooms)
    .subscribe();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  // Detect arcade account
  const user = await getArcadeUser();
  if (user?.name) {
    currentPlayerName = user.name;
    $('account-name').textContent = user.name;
    $('account-display').classList.remove('hidden');
    $('login-prompt').classList.add('hidden');
    $('create-btn').disabled = false;
    $('join-btn').disabled   = false;
  } else {
    $('account-display').classList.add('hidden');
    $('login-prompt').classList.remove('hidden');
    $('create-btn').disabled = true;
    $('join-btn').disabled   = true;
  }

  // Pre-fill room code from invite link (?room=CODE)
  const inviteRoom = new URLSearchParams(location.search).get('room');
  if (inviteRoom) $('room-code-input').value = inviteRoom.slice(0, 4).toUpperCase();

  // Sweep for abandoned rooms, then load the fresh list
  cleanupStaleRooms();
  await loadRooms();
  subscribeRooms();
})();

// ─── Buttons ──────────────────────────────────────────────────────────────────
$('create-btn').addEventListener('click', () => {
  if (!currentPlayerName) { setStatus('Log in to the Arcade first!', true); return; }
  const isPrivate = $('private-toggle').checked;
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  goToLobby(code, currentPlayerName, true, isPrivate);
});

$('join-btn').addEventListener('click', () => {
  if (!currentPlayerName) { setStatus('Log in to the Arcade first!', true); return; }
  const code = $('room-code-input').value.trim().toUpperCase();
  if (code.length !== 4) { setStatus('Enter a valid 4-letter room code!', true); return; }
  goToLobby(code, currentPlayerName, false, false);
});

$('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('join-btn').click();
});
