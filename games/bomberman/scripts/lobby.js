import { GameState, createMap, BOMB_FUSE, PLAYER_COLORS } from './game.js';
import { Renderer }  from './renderer.js';
import { Network }   from './network.js';
import { AIPlayer, BOT_NAMES } from './ai.js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

// ─── URL params ───────────────────────────────────────────────────────────────
const params     = new URLSearchParams(location.search);
const roomCode   = params.get('room')?.slice(0, 4).toUpperCase();
const playerName = decodeURIComponent(params.get('name') || '').trim();
const isHost     = params.has('host');
const isPrivate  = params.has('private');

if (!roomCode || !playerName) location.replace('index.html');

// ─── Core objects ─────────────────────────────────────────────────────────────
const net   = new Network();
const state = new GameState();
let renderer    = null;
let myPlayer    = null;
let gameRunning = false;

// lobbyRealPlayers = other real humans (self is always pinned separately)
let lobbyRealPlayers = [];
let lobbyAIPlayers   = [];
let aiInstances      = [];

const keys = {};
let lastMoveTime = 0;
const MOVE_COOLDOWN = 130;
let bombCooldown = false;

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showSection(name) {
  ['lobby', 'game', 'result'].forEach(s => {
    $(`${s}-section`).classList.toggle('hidden', s !== name);
    $(`${s}-section`).classList.toggle('active', s === name);
  });
}

// ─── Player list helpers ──────────────────────────────────────────────────────
// Self is always slot 0 — built from URL params, not from presence.
function selfEntry() {
  return { id: net.myId, name: playerName, isHost, isAI: false };
}

// Full ordered list: [self, ...other humans, ...bots]
function allPlayers() {
  const others = lobbyRealPlayers.filter(p => p.id !== net.myId);
  return [selfEntry(), ...others, ...lobbyAIPlayers];
}

// ─── Room database helpers (public rooms only) ────────────────────────────────
async function dbRegisterRoom() {
  if (!isHost || isPrivate) return;
  await supabase.from('bomberman_rooms').upsert(
    { code: roomCode, host_name: playerName, player_count: 1, status: 'waiting' },
    { onConflict: 'code' }
  );
}

async function dbUpdatePlayerCount(n) {
  if (!isHost || isPrivate) return;
  await supabase.from('bomberman_rooms').update({ player_count: n }).eq('code', roomCode);
}

async function dbMarkStarted() {
  if (!isHost || isPrivate) return;
  await supabase.from('bomberman_rooms').update({ status: 'started' }).eq('code', roomCode);
}

async function dbDeleteRoom() {
  if (isPrivate) return;
  await supabase.from('bomberman_rooms').delete().eq('code', roomCode);
}

// keepalive DELETE — fires reliably on page unload even if JS engine is tearing down
function dbDeleteRoomBeacon() {
  if (isPrivate) return;
  try {
    fetch(
      `${SUPABASE_URL}/rest/v1/bomberman_rooms?code=eq.${roomCode}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        keepalive: true,
      }
    );
  } catch { /* ignore */ }
}

// ─── Lobby UI ─────────────────────────────────────────────────────────────────
function el(tag, cls, text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function renderSlots() {
  const all = allPlayers();

  for (let i = 0; i < 4; i++) {
    const slot = $(`slot-${i}`);
    slot.innerHTML = '';
    slot.className = 'slot';
    slot.style.removeProperty('--color');

    if (i < all.length) {
      const p = all[i];
      slot.classList.add('slot-filled');
      slot.style.setProperty('--color', PLAYER_COLORS[i]);

      const dot   = el('span', 'slot-dot');
      const label = el('span', 'slot-name',
        (p.isAI ? '🤖 ' : '') + p.name + (!p.isAI && p.isHost ? ' 👑' : ''));
      slot.append(dot, label);

      if (p.isAI && isHost) {
        const rm = el('button', 'slot-remove', '✕');
        rm.title = 'Remove bot';
        rm.addEventListener('click', e => { e.stopPropagation(); removeAI(p.id); });
        slot.appendChild(rm);
      }
    } else if (isHost && all.length < 4) {
      slot.classList.add('slot-empty');
      const btn = el('button', 'slot-add-btn', '+ Add Bot');
      btn.addEventListener('click', addAI);
      slot.appendChild(btn);
    } else {
      slot.classList.add('slot-passive');
      slot.appendChild(el('span', 'slot-empty-label', '—'));
    }
  }

  const total    = all.length;
  const canStart = isHost && total >= 2;

  $('start-btn').disabled = !canStart;
  $('lobby-msg').textContent = isHost
    ? (total >= 2 ? `${total} players ready!` : 'Add 1 more player or bot to start.')
    : 'Waiting for host to start the game…';
}

function updateRoomDisplay() {
  $('room-code-display').textContent = roomCode;
  const badge = $('private-badge');
  if (badge) badge.classList.toggle('hidden', !isPrivate);
}

// ─── AI management ────────────────────────────────────────────────────────────
function addAI() {
  if (allPlayers().length >= 4) return;
  const idx  = aiInstances.length;
  const id   = `ai-${crypto.randomUUID()}`;
  const name = BOT_NAMES[idx % BOT_NAMES.length];
  aiInstances.push(new AIPlayer(id, name));
  lobbyAIPlayers.push({ id, name, isAI: true });
  net.sendAIUpdate(lobbyAIPlayers);
  renderSlots();
}

function removeAI(id) {
  aiInstances    = aiInstances.filter(a => a.id !== id);
  lobbyAIPlayers = lobbyAIPlayers.filter(p => p.id !== id);
  net.sendAIUpdate(lobbyAIPlayers);
  renderSlots();
}

// ─── Game start ───────────────────────────────────────────────────────────────
async function startGame() {
  const all = allPlayers();
  if (all.length < 2) return;

  const map         = createMap(Date.now());
  const playerOrder = all.map(p => ({ id: p.id, name: p.name, isAI: !!p.isAI }));

  await dbMarkStarted();
  beginGame(map, playerOrder);
  await net.sendGameStart(map, playerOrder);
}

function handleGameStart({ map, playerOrder }) {
  beginGame(map, playerOrder);
}

function beginGame(map, playerOrder) {
  state.init(map, playerOrder);
  myPlayer = state.players.get(net.myId);
  renderer = new Renderer($('game-canvas'));
  gameRunning  = true;
  lastMoveTime = 0;
  bombCooldown = false;
  showSection('game');
  updateHUD();
  requestAnimationFrame(gameLoop);
}

// ─── In-game network events ───────────────────────────────────────────────────
function handlePlayerMove({ id, tileX, tileY }) {
  const p = state.players.get(id);
  if (p && id !== net.myId) p.startMove(tileX, tileY, Date.now());
}

function handleBombPlaced({ bombId, placedBy, tileX, tileY, explodesAt, range }) {
  state.addBomb(bombId, placedBy, tileX, tileY, explodesAt, range);
  const delay = Math.max(0, explodesAt - Date.now());
  setTimeout(() => triggerExplosion(bombId), delay);
}

function handlePlayerDead({ id }) {
  const p = state.players.get(id);
  if (p) { p.alive = false; updateHUD(); }
  if (isHost) checkGameEnd();
}

function handlePowerupCollected({ playerId, tileX, tileY }) {
  state.collectPowerup(playerId, tileX, tileY);
  updateHUD();
}

function handleGameEnd({ winnerId }) {
  gameRunning = false;
  const winner = winnerId ? state.players.get(winnerId) : null;
  $('result-title').textContent    = winner ? `${winner.name} wins! 🎉` : "It's a draw! 💥";
  $('result-subtitle').textContent = winner
    ? `${winner.name} was the last one standing.`
    : 'Everyone eliminated at the same time.';
  showSection('result');
}

// ─── Explosion & death ────────────────────────────────────────────────────────
function triggerExplosion(bombId) {
  if (!state.bombs.has(bombId)) return;
  const result = state.explodeBomb(bombId);
  if (!result) return;

  const wasMyPlayerAlive = myPlayer?.alive ?? false;
  const justKilled = new Set();

  for (const [id, player] of state.players) {
    if (!player.alive) continue;
    if (state.isPlayerInExplosion(player)) {
      player.alive = false;
      justKilled.add(id);
    }
  }

  updateHUD();

  if (myPlayer && wasMyPlayerAlive && !myPlayer.alive) net.sendPlayerDead(net.myId);

  if (isHost) {
    for (const id of justKilled) {
      if (id.startsWith('ai-')) net.sendAnyPlayerDead(id);
    }
    checkGameEnd();
  }
}

function checkGameEnd() {
  if (!isHost || !gameRunning) return;
  const alive = state.getAlivePlayers();
  if (alive.length <= 1) {
    const winner = alive[0] ?? null;
    net.sendGameEnd(winner?.id ?? null);
    handleGameEnd({ winnerId: winner?.id ?? null });
  }
}

// ─── Input ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if ((e.code === 'Space' || e.code === 'KeyF') && gameRunning) {
    e.preventDefault();
    placeBomb();
  }
  if (gameRunning && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function handleMovement(now) {
  if (!myPlayer?.alive) return;
  if (now - lastMoveTime < MOVE_COOLDOWN) return;

  let dx = 0, dy = 0;
  if      (keys['ArrowUp']    || keys['KeyW']) dy = -1;
  else if (keys['ArrowDown']  || keys['KeyS']) dy =  1;
  else if (keys['ArrowLeft']  || keys['KeyA']) dx = -1;
  else if (keys['ArrowRight'] || keys['KeyD']) dx =  1;
  if (dx === 0 && dy === 0) return;

  const nx = myPlayer.tileX + dx;
  const ny = myPlayer.tileY + dy;
  if (state.canMoveTo(nx, ny, net.myId)) {
    myPlayer.startMove(nx, ny, now);
    lastMoveTime = now;
    net.sendMove(nx, ny);
    const type = state.collectPowerup(net.myId, nx, ny);
    if (type) { net.sendPowerupCollected(nx, ny); updateHUD(); }
  }
}

function placeBomb() {
  if (!myPlayer?.alive || myPlayer.activeBombs >= myPlayer.maxBombs || bombCooldown) return;
  const { tileX, tileY } = myPlayer;
  for (const [, b] of state.bombs) {
    if (b.tileX === tileX && b.tileY === tileY) return;
  }
  const bombId     = crypto.randomUUID();
  const explodesAt = Date.now() + BOMB_FUSE;
  state.addBomb(bombId, net.myId, tileX, tileY, explodesAt, myPlayer.bombRange);
  net.sendBomb(bombId, tileX, tileY, explodesAt, myPlayer.bombRange);
  setTimeout(() => triggerExplosion(bombId), BOMB_FUSE);
  bombCooldown = true;
  setTimeout(() => { bombCooldown = false; }, 300);
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning) return;
  const now = Date.now();

  if (isHost) {
    for (const ai of aiInstances) {
      ai.update(state, now, net, (bombId, delay) => {
        setTimeout(() => triggerExplosion(bombId), delay);
      });
    }
  }

  handleMovement(now);
  for (const [, p] of state.players) p.updateRender(now);
  state.update();
  renderer.render(state);
  requestAnimationFrame(gameLoop);
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateHUD() {
  const hudEl = $('player-stats');
  hudEl.innerHTML = '';
  let i = 0;
  for (const [, p] of state.players) {
    const chip = document.createElement('div');
    chip.className = `stat-chip${p.alive ? '' : ' dead'}`;
    chip.style.setProperty('--player-color', PLAYER_COLORS[i++]);
    chip.innerHTML = `
      <span class="chip-dot"></span>
      <span class="chip-name">${p.name}</span>
      <span class="chip-info">🔥${p.bombRange} 💣${p.maxBombs}</span>
    `;
    hudEl.appendChild(chip);
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
async function init() {
  updateRoomDisplay();
  showSection('lobby');
  renderSlots(); // self is always shown immediately

  // ── Presence: full sync (e.g. after reconnect) ─────────────────────────────
  net.onPresenceUpdate = players => {
    lobbyRealPlayers = players.filter(p => p.id !== net.myId);
    renderSlots();
    if (isHost && !isPrivate) {
      dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  };

  // ── Presence: incremental join — newPresences is more reliable than presenceState() ──
  net.onPresenceJoin = newPlayers => {
    let changed = false;
    for (const p of newPlayers) {
      if (p.id !== net.myId && !lobbyRealPlayers.find(r => r.id === p.id)) {
        lobbyRealPlayers.push(p);
        changed = true;
      }
    }
    if (changed) {
      renderSlots();
      if (isHost && !isPrivate) {
        dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
      }
    }
  };

  // ── Presence: incremental leave ────────────────────────────────────────────
  net.onPresenceLeave = leftPlayers => {
    const leftIds = new Set(leftPlayers.map(p => p.id));
    const before  = lobbyRealPlayers.length;
    lobbyRealPlayers = lobbyRealPlayers.filter(p => !leftIds.has(p.id));

    // If the host disconnected and we're still in lobby, clean up the room
    const hostLeft = leftPlayers.some(p => p.isHost);
    if (hostLeft && !isHost && !gameRunning) {
      dbDeleteRoom();
    }

    if (lobbyRealPlayers.length !== before) {
      renderSlots();
      if (isHost && !isPrivate) {
        dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
      }
    }
  };

  // ── Broadcast hello: redundancy so joiners always appear even if presence lags ──
  net.onPlayerHello = ({ id, name, isHost: pIsHost }) => {
    if (id === net.myId) return; // self (broadcast: self=false so shouldn't fire, but guard anyway)
    if (!lobbyRealPlayers.find(p => p.id === id)) {
      lobbyRealPlayers.push({ id, name, isHost: pIsHost });
      renderSlots();
      if (isHost && !isPrivate) {
        dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
      }
    }
    // Host: resend current AI list so the new joiner sees existing bots
    if (isHost && lobbyAIPlayers.length > 0) {
      net.sendAIUpdate(lobbyAIPlayers);
    }
  };

  net.onAIUpdate          = ({ aiPlayers }) => { lobbyAIPlayers = aiPlayers ?? []; renderSlots(); };
  net.onGameStart         = handleGameStart;
  net.onPlayerMove        = handlePlayerMove;
  net.onBombPlaced        = handleBombPlaced;
  net.onPlayerDead        = handlePlayerDead;
  net.onPowerupCollected  = handlePowerupCollected;
  net.onGameEnd           = handleGameEnd;

  try {
    await net.joinRoom(roomCode, playerName, isHost);
  } catch (e) {
    $('lobby-msg').textContent = `Connection failed: ${e.message}. Try refreshing.`;
    return;
  }

  // Register public room in database
  if (isHost) await dbRegisterRoom();

  // Immediate presence refresh (filter out self — we pin ourselves)
  lobbyRealPlayers = net.getPresencePlayers().filter(p => p.id !== net.myId);
  renderSlots();

  // Delayed fallback: presence state sometimes lags one round-trip behind track()
  setTimeout(() => {
    lobbyRealPlayers = net.getPresencePlayers().filter(p => p.id !== net.myId);
    renderSlots();
  }, 800);
}

// ─── Button wiring ────────────────────────────────────────────────────────────
$('start-btn').addEventListener('click', startGame);

$('back-btn').addEventListener('click', async e => {
  e.preventDefault();
  if (isHost) await dbDeleteRoom();
  await net.leave();
  location.href = 'index.html';
});

$('play-again-btn').addEventListener('click', () => {
  gameRunning = false;
  showSection('lobby');
  renderSlots();
  if (isHost) {
    net.sendAIUpdate(lobbyAIPlayers);
    // Re-open room in database if public
    if (!isPrivate) dbRegisterRoom();
  }
});

$('room-code-display').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    $('room-code-display').textContent = 'Copied!';
    setTimeout(() => { $('room-code-display').textContent = roomCode; }, 1200);
  } catch { /* ignore */ }
});

$('copy-link-btn').addEventListener('click', async () => {
  const url = `${location.origin}/games/bomberman/?room=${roomCode}`;
  const btn = $('copy-link-btn');
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '🔗 Copy link'; }, 1800);
  } catch { /* ignore */ }
});

// Clean up room when the page closes — keepalive fetch fires even as JS tears down
window.addEventListener('beforeunload', () => {
  // Any client closing while in the lobby should try to clean up the room
  // (especially the host, but also non-host clients detect host departure above)
  if (isHost) dbDeleteRoomBeacon();
});

init();
