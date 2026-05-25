import { supabase } from './supabase.js';

// ─── Arcade account lookup (same pattern as turborace/user.js) ───────────────
async function getArcadePlayerName() {
  // 1. Check localStorage cache (set by arcade.js on login)
  try {
    const cached = JSON.parse(localStorage.getItem('arcade_user') || 'null');
    if (cached?.name) return cached.name;
  } catch { /* ignore */ }

  // 2. Fall back to live Supabase session
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (!user) return null;

  const name = user.user_metadata?.username
    || user.email?.split('@')[0]
    || 'Player';

  // Cache it for future page loads
  localStorage.setItem('arcade_user', JSON.stringify({
    user_id: user.id,
    name,
    email: user.email,
  }));
  return name;
}

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function setStatus(msg, err = false) {
  const el = $('status-msg');
  el.textContent = msg;
  el.style.color = err ? '#ff4444' : '#aaa8cc';
}

function getPlayerName() {
  // Prefer logged-in account name
  try {
    const cached = JSON.parse(localStorage.getItem('arcade_user') || 'null');
    if (cached?.name) return cached.name;
  } catch { /* ignore */ }
  return $('guest-name-input').value.trim() || null;
}

function goToLobby(roomCode, playerName, host = false) {
  const params = new URLSearchParams({ room: roomCode, name: playerName });
  if (host) params.set('host', '1');
  location.href = `lobby.html?${params}`;
}

// ─── Init: detect arcade account ─────────────────────────────────────────────
(async () => {
  const name = await getArcadePlayerName();
  if (name) {
    $('account-display').textContent = name;
    $('account-row').classList.remove('hidden');
    $('guest-row').classList.add('hidden');
  }

  // Pre-fill room code from invite link (?room=CODE)
  const inviteRoom = new URLSearchParams(location.search).get('room');
  if (inviteRoom) $('room-code-input').value = inviteRoom.slice(0, 4).toUpperCase();
})();

// ─── Buttons ──────────────────────────────────────────────────────────────────
$('create-btn').addEventListener('click', () => {
  const name = getPlayerName();
  if (!name) { setStatus('Enter your name first!', true); return; }
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  goToLobby(code, name, true);
});

$('join-btn').addEventListener('click', () => {
  const name = getPlayerName();
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!name) { setStatus('Enter your name first!', true); return; }
  if (code.length !== 4) { setStatus('Enter a valid 4-letter room code!', true); return; }
  goToLobby(code, name, false);
});

$('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('join-btn').click();
});
