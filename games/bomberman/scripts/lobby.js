import { GameState, createMap, BOMB_FUSE, BOMB_TYPE, PLAYER_COLORS, COMPLEXITY_GRIDS, GRID_W, GRID_H } from './game.js';
import { Renderer }  from './renderer.js';
import { Network }   from './network.js';
import { AIPlayer, BOT_NAMES } from './ai.js';
import { SoundSystem } from './sound.js';
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
const sound = new SoundSystem();
let renderer    = null;
let myPlayer    = null;
let gameRunning = false;

// Complexity (host only): 0=Normal, 1=Large, 2=Huge
let complexity = 0;

const MAX_PLAYERS = 4;

// ─── Lobby roster (host-authoritative) ─────────────────────────────────────────
// The host owns the canonical, ordered roster and broadcasts it to everyone so
// that every client renders an *identical* lobby view (same order, same colors).
// Each entry: { id, name, isAI, isHost, inGame }.
// The roster persists for the entire life of the room — players stay listed even
// while a game is running (shown with a 🎮 marker); they only leave the roster
// when they disconnect or get kicked.
let roster = [];

// AI behaviour instances (host only). The roster holds the AI's lobby entry;
// aiInstances drive their in-game logic.
let aiInstances = [];

// Whether a round is currently in progress *in the room* (any client). Distinct
// from `gameRunning`, which means *this* client is actively playing a round.
let roomGameRunning = false;

// playerOrder of the current / most-recent round, and whether I'm one of them.
let gameParticipants = [];
let amParticipant    = false;


let lastMoveTime = 0;
const MOVE_COOLDOWN = 130;
let bombCooldown = false;

// ─── Scoring ──────────────────────────────────────────────────────────────────
// sessionScores persists across "play again" within the same lobby session
const sessionScores = new Map(); // id → {name, score}
// gameScores resets each game
let gameScores = new Map();      // id → score
// order of deaths within a game (first element = first to die = last place)
let deathOrder = [];

function awardGameScore(playerId, pts) {
  if (!playerId || pts <= 0) return;
  gameScores.set(playerId, (gameScores.get(playerId) || 0) + pts);
}

function finalizeGameScores(winnerId) {
  const totalPlayers = state.players.size;

  // Placement bonuses
  if (winnerId) awardGameScore(winnerId, 100);

  // 2nd place: 50pts (only when more than 2 players)
  if (totalPlayers > 2 && deathOrder.length >= 1) {
    awardGameScore(deathOrder[deathOrder.length - 1], 50);
  }

  // 3rd place: 10pts (only when 4 players)
  if (totalPlayers >= 4 && deathOrder.length >= 2) {
    awardGameScore(deathOrder[deathOrder.length - 2], 10);
  }

  // Merge this game's scores into the session totals
  for (const [id, pts] of gameScores) {
    const player = state.players.get(id);
    const name   = player?.name || id;
    const prev   = sessionScores.get(id) || { name, score: 0 };
    sessionScores.set(id, { name, score: prev.score + pts });
  }
}

// ─── Sound init on first user gesture ────────────────────────────────────────
window.addEventListener('keydown',  () => sound.init(), { once: true });
window.addEventListener('click',    () => sound.init(), { once: true });
window.addEventListener('touchend', () => sound.init(), { once: true });

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showSection(name) {
  ['lobby', 'game', 'result'].forEach(s => {
    $(`${s}-section`).classList.toggle('hidden', s !== name);
    $(`${s}-section`).classList.toggle('active', s === name);
  });
}

// ─── Roster helpers (host-authoritative) ───────────────────────────────────────
function realPlayerCount() {
  return roster.filter(e => !e.isAI).length;
}

// Host: rebuild the roster from live presence + AI entries, preserving order.
// • New real players are appended at the end.
// • Real players that have disconnected are dropped (AI are always kept).
// • A reconnecting player (same name, new id) reclaims their slot + session score.
// • inGame flags are refreshed from the current round's participant list.
function hostRebuildRoster() {
  const presence   = net.getPresencePlayers();         // includes self
  const presentIds = new Set(presence.map(p => p.id));

  // Reconnect detection — must run before pruning so we can match the stale id.
  for (const p of presence) {
    if (roster.find(e => e.id === p.id)) continue;
    const stale = roster.find(e => !e.isAI && e.name === p.name && !presentIds.has(e.id));
    if (stale) {
      const oldId = stale.id;
      stale.id     = p.id;
      stale.isHost = !!p.isHost;
      if (sessionScores.has(oldId)) {
        sessionScores.set(p.id, sessionScores.get(oldId));
        sessionScores.delete(oldId);
      }
    }
  }

  // Drop real players who are no longer present (AI are kept regardless).
  roster = roster.filter(e => e.isAI || presentIds.has(e.id));

  // Append brand-new real players.
  for (const p of presence) {
    if (!roster.find(e => e.id === p.id)) {
      roster.push({ id: p.id, name: p.name, isAI: false, isHost: !!p.isHost, inGame: false });
    }
  }

  // Refresh the in-game markers.
  const partIds = new Set(gameParticipants.map(p => p.id));
  for (const e of roster) e.inGame = roomGameRunning && partIds.has(e.id);
}

// Host: rebuild, broadcast to all clients, update local UI + room player count.
function hostSyncRoster() {
  if (!isHost) return;
  hostRebuildRoster();
  net.sendLobbyState(roster, roomGameRunning);
  renderRoster();
  if (!isPrivate) dbUpdatePlayerCount(realPlayerCount());
}

// ─── Room database helpers ────────────────────────────────────────────────────
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

function dbDeleteRoomBeacon() {
  if (isPrivate) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/bomberman_rooms?code=eq.${roomCode}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      keepalive: true,
    });
  } catch { /* ignore */ }
}

// ─── Global leaderboard (Supabase) ───────────────────────────────────────────
// Requires a table: bomberman_scores (id uuid PK, player_name text UNIQUE, score int, last_updated timestamptz)
async function saveGlobalScore(name, pts) {
  if (pts <= 0) return;
  try {
    const { data: existing } = await supabase
      .from('bomberman_scores')
      .select('id, score')
      .eq('player_name', name)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('bomberman_scores')
        .update({ score: existing.score + pts, last_updated: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('bomberman_scores')
        .insert({ player_name: name, score: pts });
    }
  } catch (e) {
    console.warn('Could not save global score:', e);
  }
}

async function loadGlobalLeaderboard() {
  try {
    const { data, error } = await supabase
      .from('bomberman_scores')
      .select('player_name, score')
      .order('score', { ascending: false })
      .limit(10);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('Could not load global leaderboard:', e);
    return [];
  }
}

function renderGlobalLeaderboard(rows) {
  const el = $('global-lb-content');
  if (!el) return;
  if (!rows.length) { el.textContent = 'No scores yet.'; return; }
  el.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'lb-table';
  const medals = ['🥇', '🥈', '🥉'];
  rows.forEach((row, i) => {
    const tr  = document.createElement('tr');
    const prefix = medals[i] ?? `${i + 1}.`;
    tr.innerHTML = `<td>${prefix} ${row.player_name}</td><td>${row.score.toLocaleString()} pts</td>`;
    table.appendChild(tr);
  });
  el.appendChild(table);
}

function renderSessionLeaderboard() {
  const el    = $('session-lb');
  const table = $('session-lb-table');
  if (!el || !table) return;

  const entries = [...sessionScores.values()].sort((a, b) => b.score - a.score);
  if (!entries.length) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');
  table.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  entries.forEach((e, i) => {
    const tr     = document.createElement('tr');
    const prefix = medals[i] ?? `${i + 1}.`;
    tr.innerHTML = `<td>${prefix} ${e.name}</td><td>${e.score.toLocaleString()} pts</td>`;
    table.appendChild(tr);
  });
}

function renderResultScores() {
  const el = $('result-scores');
  if (!el) return;
  const entries = [...gameScores.entries()]
    .map(([id, score]) => {
      const p = state.players.get(id);
      return { name: p?.name || id, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!entries.length) { el.innerHTML = ''; return; }

  const medals = ['🥇', '🥈', '🥉'];
  let html = '<table class="lb-table">';
  entries.forEach((e, i) => {
    const prefix = medals[i] ?? `${i + 1}.`;
    html += `<tr><td>${prefix} ${e.name}</td><td>${e.score.toLocaleString()} pts</td></tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ─── Lobby UI ─────────────────────────────────────────────────────────────────
function el(tag, cls, text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function makePlayerSlot(p, idx) {
  const slot = el('div', 'slot slot-filled');
  // First MAX_PLAYERS roster positions get a player color; extras are neutral.
  const color = idx < MAX_PLAYERS ? PLAYER_COLORS[idx] : '#5e5a82';
  slot.style.setProperty('--color', color);

  const dot   = el('span', 'slot-dot');
  let label   = (p.isAI ? '🤖 ' : '') + p.name;
  if (!p.isAI && p.isHost) label += ' 👑';
  if (p.inGame)            label += ' 🎮';
  const nameEl = el('span', 'slot-name', label);
  slot.append(dot, nameEl);

  if (p.inGame) slot.classList.add('slot-ingame');

  if (isHost) {
    if (p.isAI) {
      const rm = el('button', 'slot-remove', '✕');
      rm.title = 'Remove bot';
      rm.addEventListener('click', e => { e.stopPropagation(); removeAI(p.id); });
      slot.appendChild(rm);
    } else if (p.id !== net.myId) {
      const kick = el('button', 'slot-remove', '✕ Kick');
      kick.title = 'Kick player';
      kick.addEventListener('click', e => { e.stopPropagation(); kickPlayer(p.id); });
      slot.appendChild(kick);
    }
  }
  return slot;
}

function renderRoster() {
  const container = $('player-slots');
  if (!container) return;
  container.innerHTML = '';

  roster.forEach((p, i) => container.appendChild(makePlayerSlot(p, i)));

  // "+ Add Bot" slot for the host while a round is not running and there's room.
  if (isHost && !roomGameRunning && roster.length < MAX_PLAYERS) {
    const add = el('div', 'slot slot-empty');
    const btn = el('button', 'slot-add-btn', '+ Add Bot');
    btn.addEventListener('click', addAI);
    add.appendChild(btn);
    container.appendChild(add);
  }

  // Pad up to a minimum of MAX_PLAYERS cells so the grid stays tidy.
  for (let i = container.children.length; i < MAX_PLAYERS; i++) {
    const passive = el('div', 'slot slot-passive');
    passive.appendChild(el('span', 'slot-empty-label', '—'));
    container.appendChild(passive);
  }

  // Start button + status message.
  const total    = roster.length;
  const canStart = isHost && !roomGameRunning && total >= 2;
  const startBtn = $('start-btn');
  if (startBtn) startBtn.disabled = !canStart;

  const msg = $('lobby-msg');
  if (msg) {
    if (roomGameRunning) {
      msg.textContent = isHost
        ? 'Game in progress…'
        : "Game in progress — you'll be able to join the next round.";
    } else if (isHost) {
      msg.textContent = total >= 2 ? `${total} players ready!` : 'Add 1 more player or bot to start.';
    } else {
      msg.textContent = 'Waiting for host to start the game…';
    }
  }
}

function updateRoomDisplay() {
  $('room-code-display').textContent = roomCode;
  const badge = $('private-badge');
  if (badge) badge.classList.toggle('hidden', !isPrivate);
}

// ─── AI management (host only) ──────────────────────────────────────────────────
function addAI() {
  if (!isHost || roomGameRunning || roster.length >= MAX_PLAYERS) return;
  const idx  = aiInstances.length;
  const id   = `ai-${crypto.randomUUID()}`;
  const name = BOT_NAMES[idx % BOT_NAMES.length];
  aiInstances.push(new AIPlayer(id, name));
  roster.push({ id, name, isAI: true, isHost: false, inGame: false });
  hostSyncRoster();
}

function removeAI(id) {
  aiInstances = aiInstances.filter(a => a.id !== id);
  roster      = roster.filter(e => e.id !== id);
  hostSyncRoster();
}

function kickPlayer(id) {
  net.sendPlayerKick(id);
  roster = roster.filter(e => e.id !== id);
  hostSyncRoster();
}

// ─── Game start ───────────────────────────────────────────────────────────────
// Host: start a fresh round from the lobby. The first MAX_PLAYERS roster
// entries become the participants; anyone beyond that (or who joins mid-game)
// waits in the lobby for the next round.
async function startGame() {
  if (!isHost || roomGameRunning || roster.length < 2) return;
  sound.init();
  await startRound(roster.slice(0, MAX_PLAYERS));
}

// Host: kick off a round for an explicit participant list (used by both
// "Start Game" and "Play Again").
async function startRound(participants) {
  const order = participants.map(p => ({ id: p.id, name: p.name, isAI: !!p.isAI }));
  if (order.length < 2) return;

  const { w: gridW, h: gridH } = COMPLEXITY_GRIDS[complexity] ?? COMPLEXITY_GRIDS[0];
  const map = createMap(Date.now(), gridW, gridH);

  gameParticipants = order;
  roomGameRunning  = true;
  amParticipant    = order.some(p => p.id === net.myId);

  await dbMarkStarted();
  await net.sendGameStart(map, order, gridW, gridH);
  hostSyncRoster();                    // mark 🎮 + push roster to spectators
  beginGame(map, order, gridW, gridH); // host is always a participant
}

function handleGameStart({ map, playerOrder, gridW, gridH }) {
  gameParticipants = playerOrder;
  roomGameRunning  = true;
  amParticipant    = playerOrder.some(p => p.id === net.myId);

  if (amParticipant) {
    beginGame(map, playerOrder, gridW ?? GRID_W, gridH ?? GRID_H);
  } else {
    // Joined mid-game: stay in the lobby and watch for the next round.
    gameRunning = false;
    showSection('lobby');
    renderRoster();
  }
}

function beginGame(map, playerOrder, gridW = GRID_W, gridH = GRID_H) {
  state.init(map, playerOrder, gridW, gridH);
  myPlayer     = state.players.get(net.myId);
  renderer     = new Renderer($('game-canvas'), gridW, gridH);
  gameRunning  = true;
  lastMoveTime = 0;
  bombCooldown = false;

  // Reset per-game scoring state
  gameScores = new Map();
  deathOrder = [];
  for (const [id] of state.players) gameScores.set(id, 0);

  showSection('game');
  updateHUD();
  sound.setBricksDestroyed(0); // reset BPM to 100 before start()
  sound.start();
  requestAnimationFrame(gameLoop);
}

// ─── In-game network events ───────────────────────────────────────────────────
// These all bail out unless this client is actively playing — spectators and
// players waiting in the lobby for the next round stay subscribed to the channel
// but have no initialized game state, so they must ignore in-game traffic.
function handlePlayerMove({ id, tileX, tileY }) {
  if (!gameRunning) return;
  const p = state.players.get(id);
  if (p && id !== net.myId) p.startMove(tileX, tileY, Date.now());
}

function handleBombPlaced({ bombId, placedBy, tileX, tileY, explodesAt, range, type }) {
  if (!gameRunning) return;
  state.addBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type ?? 'normal');
  const delay = Math.max(0, explodesAt - Date.now());
  setTimeout(() => triggerExplosion(bombId), delay);
  // Award 10pts for other players' special bombs (local player handles it in placeSpecialBomb)
  if (type && type !== BOMB_TYPE.NORMAL && placedBy !== net.myId) {
    awardGameScore(placedBy, 10);
  }
}

function handleBombKick({ bombId, newTileX, newTileY }) {
  if (!gameRunning) return;
  state.moveBomb(bombId, newTileX, newTileY);
}

function handlePlayerDead({ id }) {
  if (!gameRunning) return;
  const p = state.players.get(id);
  if (p) { p.alive = false; updateHUD(); }
  if (isHost) checkGameEnd();
}

function handlePowerupCollected({ playerId, tileX, tileY }) {
  if (!gameRunning) return;
  state.collectPowerup(playerId, tileX, tileY);
  updateHUD();
}

function handleGameEnd({ winnerId }) {
  if (!gameRunning) return; // guard against double-calls
  gameRunning     = false;
  roomGameRunning = false;
  sound.stop();

  // Compute placement bonuses and merge into session scores
  finalizeGameScores(winnerId);

  // Update leaderboards
  renderSessionLeaderboard();
  const myScore = gameScores.get(net.myId) || 0;
  saveGlobalScore(playerName, myScore); // async, non-blocking

  // Host: clear the 🎮 markers and push the refreshed roster to spectators.
  if (isHost) hostSyncRoster();

  const winner = winnerId ? state.players.get(winnerId) : null;
  $('result-title').textContent    = winner ? `${winner.name} wins! 🎉` : "It's a draw! 💥";
  $('result-subtitle').textContent = winner
    ? `${winner.name} was the last one standing.`
    : 'Everyone eliminated at the same time.';

  renderResultScores();

  // Host gets two choices (Play Again / Back to Lobby); everyone else only
  // gets the option to leave to the title screen.
  $('play-again-btn').classList.toggle('hidden', !isHost);
  $('back-to-lobby-btn').classList.toggle('hidden', !isHost);
  $('leave-title-btn').classList.toggle('hidden', isHost);

  showSection('result');
}

// Shared by the host's "Back to Lobby" button and the broadcast receiver.
function returnToLobby() {
  gameRunning      = false;
  roomGameRunning  = false;
  gameParticipants = [];
  amParticipant    = false;
  sound.stop();
  showSection('lobby');
  if (isHost) {
    if (!isPrivate) dbRegisterRoom(); // back to "waiting" so the room re-lists
    hostSyncRoster();
  } else {
    renderRoster();
  }
  renderSessionLeaderboard();
  loadGlobalLeaderboard().then(rows => renderGlobalLeaderboard(rows));
}

// ─── Explosion & death ────────────────────────────────────────────────────────
function triggerExplosion(bombId) {
  if (!state.bombs.has(bombId)) return;

  // Capture owner before explodeBomb deletes the bomb entry
  const bomb        = state.bombs.get(bombId);
  const bombOwner   = bomb?.placedBy ?? null;

  const result = state.explodeBomb(bombId);
  if (!result) return;

  sound.playExplosion();
  sound.setBricksDestroyed(state.bricksDestroyed);

  // 1pt per brick destroyed (not awarded for box bombs which create bricks)
  if (!result.isBox && bombOwner) {
    awardGameScore(bombOwner, result.destroyedBricks.length);
  }

  // Napalm: schedule fire spread
  if (result.isNapalm) {
    const tiles      = [...result.tiles];
    const spreadDieAt = Date.now() + 2000;
    setTimeout(() => { if (gameRunning) state.spreadNapalm(tiles, spreadDieAt); }, 600);
  }

  const wasMyPlayerAlive = myPlayer?.alive ?? false;
  const justKilled = new Set();

  for (const [id, player] of state.players) {
    if (!player.alive) continue;
    if (state.isPlayerInExplosion(player) || state.isPlayerInFire(player)) {
      player.alive = false;
      justKilled.add(id);
      deathOrder.push(id); // track order for placement scoring
    }
  }

  // 20pts per player killed, but not for self-kills
  if (bombOwner) {
    for (const killedId of justKilled) {
      if (killedId !== bombOwner) awardGameScore(bombOwner, 20);
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

/** Continuously check if players walk into napalm fire. */
function checkNapalmDeaths() {
  const justKilled = new Set();
  for (const [id, player] of state.players) {
    if (!player.alive) continue;
    if (state.isPlayerInFire(player)) {
      player.alive = false;
      justKilled.add(id);
      deathOrder.push(id);
    }
  }
  if (justKilled.size === 0) return;
  updateHUD();
  if (myPlayer && justKilled.has(net.myId)) net.sendPlayerDead(net.myId);
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

// ─── Camera ───────────────────────────────────────────────────────────────────
function updateCamera() {
  if (!renderer || !myPlayer) return;
  const mapPixW = state.gridW * 40;
  const mapPixH = state.gridH * 40;
  const vpW     = renderer.canvas.width;
  const vpH     = renderer.canvas.height;

  let camX = myPlayer.renderX + 20 - vpW / 2;
  let camY = myPlayer.renderY + 20 - vpH / 2;
  camX = Math.max(0, Math.min(mapPixW - vpW, camX));
  camY = Math.max(0, Math.min(mapPixH - vpH, camY));

  renderer.cameraX = camX;
  renderer.cameraY = camY;
}

// ─── Movement (one tile per press) ───────────────────────────────────────────
function doMove(dx, dy, now) {
  if (!myPlayer?.alive) return;

  const nx = myPlayer.tileX + dx;
  const ny = myPlayer.tileY + dy;

  // Bomb kick
  const bombAtTarget = state.getBombAt(nx, ny);
  if (bombAtTarget) {
    const kickResult = state.kickBomb(bombAtTarget.id, dx, dy);
    if (kickResult) {
      net.sendBombKick(bombAtTarget.id, kickResult.newTileX, kickResult.newTileY);
      sound.playKick();
      myPlayer.startMove(nx, ny, now);
      lastMoveTime = now;
      net.sendMove(nx, ny);
      const pu = state.collectPowerup(net.myId, nx, ny);
      if (pu) { net.sendPowerupCollected(nx, ny); sound.playPowerup(); updateHUD(); }
    } else {
      lastMoveTime = now; // blocked — still consume cooldown
    }
    return;
  }

  if (state.canMoveTo(nx, ny, net.myId)) {
    myPlayer.startMove(nx, ny, now);
    lastMoveTime = now;
    net.sendMove(nx, ny);
    const pu = state.collectPowerup(net.myId, nx, ny);
    if (pu) { net.sendPowerupCollected(nx, ny); sound.playPowerup(); updateHUD(); }
  }
}

// ─── Keyboard input (one tile per keydown, ignores held-key repeat) ───────────
window.addEventListener('keydown', e => {
  if (!gameRunning) return;
  if (e.repeat) return; // ignore held-key auto-repeat — one tile per physical press

  if (e.code === 'Space' || e.code === 'KeyF') { e.preventDefault(); placeBomb(); return; }
  if (e.code === 'KeyQ') { e.preventDefault(); placeSpecialBomb(); return; }

  let dx = 0, dy = 0;
  if      (e.code === 'ArrowUp'    || e.code === 'KeyW') { dy = -1; e.preventDefault(); }
  else if (e.code === 'ArrowDown'  || e.code === 'KeyS') { dy =  1; e.preventDefault(); }
  else if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { dx = -1; e.preventDefault(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { dx =  1; e.preventDefault(); }
  else return; // not a game key

  const now = Date.now();
  if (now - lastMoveTime >= MOVE_COOLDOWN) doMove(dx, dy, now);
});

// ─── Touch Controls ───────────────────────────────────────────────────────────
function setupTouchControls() {
  const addDirBtn = (id, dx, dy) => {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!gameRunning) return;
      sound.init();
      const now = Date.now();
      if (now - lastMoveTime >= MOVE_COOLDOWN) doMove(dx, dy, now);
    });
  };

  addDirBtn('touch-up',    0, -1);
  addDirBtn('touch-down',  0,  1);
  addDirBtn('touch-left', -1,  0);
  addDirBtn('touch-right', 1,  0);

  const bombBtn = $('touch-bomb');
  if (bombBtn) {
    bombBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!gameRunning) return;
      sound.init();
      placeBomb();
    });
  }

  const specialBtn = $('touch-special');
  if (specialBtn) {
    specialBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!gameRunning) return;
      sound.init();
      placeSpecialBomb();
    });
  }
}

// ─── Bomb placement ───────────────────────────────────────────────────────────
function placeBomb() {
  if (!myPlayer?.alive || myPlayer.activeBombs >= myPlayer.maxBombs || bombCooldown) return;
  const { tileX, tileY } = myPlayer;
  if (state.getBombAt(tileX, tileY)) return;
  const bombId     = crypto.randomUUID();
  const explodesAt = Date.now() + BOMB_FUSE;
  state.addBomb(bombId, net.myId, tileX, tileY, explodesAt, myPlayer.bombRange, BOMB_TYPE.NORMAL);
  net.sendBomb(bombId, tileX, tileY, explodesAt, myPlayer.bombRange, BOMB_TYPE.NORMAL);
  setTimeout(() => triggerExplosion(bombId), BOMB_FUSE);
  bombCooldown = true;
  setTimeout(() => { bombCooldown = false; }, 300);
  sound.playBombPlace();
}

function placeSpecialBomb() {
  if (!myPlayer?.alive || !myPlayer.specialBomb) return;
  if (myPlayer.activeBombs >= myPlayer.maxBombs || bombCooldown) return;
  const { tileX, tileY } = myPlayer;
  if (state.getBombAt(tileX, tileY)) return;

  const bombTypeStr = myPlayer.specialBomb === 'napalm' ? BOMB_TYPE.NAPALM : BOMB_TYPE.BOX;
  myPlayer.specialBomb = null; // consume
  updateHUD();

  // 10pts for using a special bomb
  awardGameScore(net.myId, 10);

  const bombId     = crypto.randomUUID();
  const explodesAt = Date.now() + BOMB_FUSE;
  state.addBomb(bombId, net.myId, tileX, tileY, explodesAt, myPlayer.bombRange, bombTypeStr);
  net.sendBomb(bombId, tileX, tileY, explodesAt, myPlayer.bombRange, bombTypeStr);
  setTimeout(() => triggerExplosion(bombId), BOMB_FUSE);
  bombCooldown = true;
  setTimeout(() => { bombCooldown = false; }, 300);
  sound.playBombPlace();
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning) return;
  const now = Date.now();

  if (isHost) {
    for (const ai of aiInstances) {
      ai.update(state, now, net, (bombId, delay) => {
        setTimeout(() => triggerExplosion(bombId), delay);
      }, awardGameScore);
    }
  }

  checkNapalmDeaths();
  updateCamera();

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
  for (const [id, p] of state.players) {
    const chip = document.createElement('div');
    chip.className = `stat-chip${p.alive ? '' : ' dead'}`;
    chip.style.setProperty('--player-color', PLAYER_COLORS[i++]);
    const sIcon = p.specialBomb === 'napalm' ? ' 🌋' : p.specialBomb === 'box' ? ' 📦' : '';
    const pts   = gameScores.get(id) || 0;
    chip.innerHTML = `
      <span class="chip-dot"></span>
      <span class="chip-name">${p.name}</span>
      <span class="chip-info">🔥${p.bombRange} 💣${p.maxBombs}${sIcon} ⭐${pts}</span>
    `;
    hudEl.appendChild(chip);
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
async function init() {
  updateRoomDisplay();
  showSection('lobby');
  renderRoster();
  setupTouchControls();

  // Load global leaderboard in background
  loadGlobalLeaderboard().then(rows => renderGlobalLeaderboard(rows));

  // Show complexity selector for host only
  if (isHost) {
    $('complexity-row').classList.remove('hidden');
    $('complexity-select').addEventListener('change', e => {
      complexity = parseInt(e.target.value, 10);
    });
  }

  // ── Presence handlers ─────────────────────────────────────────────────────
  // Only the host derives the roster from presence; it then broadcasts the
  // authoritative roster via lobby_state so every client renders the same view.
  // Non-host clients ignore presence for roster purposes (they just listen for
  // lobby_state) — except they watch for the host disappearing.
  const onPresenceChanged = () => { if (isHost) hostSyncRoster(); };

  net.onPresenceUpdate = onPresenceChanged;
  net.onPresenceJoin   = onPresenceChanged;

  net.onPresenceLeave = leftPlayers => {
    if (isHost) { hostSyncRoster(); return; }
    // Non-host: if the host genuinely left while we're idle in the lobby, the
    // room is effectively dead — clean up the DB entry. (Spurious reconnect
    // leaves are tolerated: we only act when not mid-game.)
    const hostLeft = leftPlayers.some(p => p.isHost);
    if (hostLeft && !gameRunning && !roomGameRunning) dbDeleteRoom();
  };

  // Intentional leave broadcast — lets the host prune immediately rather than
  // waiting for the presence-leave event.
  net.onPlayerLeave = ({ id }) => {
    if (!isHost || id === net.myId) return;
    roster = roster.filter(e => e.id !== id);
    hostSyncRoster();
  };

  net.onPlayerHello = () => { if (isHost) hostSyncRoster(); };

  // Non-host clients receive the canonical roster from the host.
  net.onLobbyState = ({ roster: r, gameRunning: gr }) => {
    if (isHost) return;
    roster          = Array.isArray(r) ? r : [];
    roomGameRunning = !!gr;
    renderRoster();
  };

  // Host sent everyone back to the lobby after a round.
  net.onReturnLobby = () => {
    if (isHost) return;
    returnToLobby();
  };

  net.onPlayerKick = ({ targetId }) => {
    if (targetId === net.myId) {
      alert('You were kicked from the lobby.');
      location.href = 'index.html';
      return;
    }
    if (isHost) {
      roster = roster.filter(e => e.id !== targetId);
      hostSyncRoster();
    }
  };

  net.onGameStart         = handleGameStart;
  net.onPlayerMove        = handlePlayerMove;
  net.onBombPlaced        = handleBombPlaced;
  net.onBombKick          = handleBombKick;
  net.onPlayerDead        = handlePlayerDead;
  net.onPowerupCollected  = handlePowerupCollected;
  net.onGameEnd           = handleGameEnd;

  try {
    await net.joinRoom(roomCode, playerName, isHost);
  } catch (e) {
    $('lobby-msg').textContent = `Connection failed: ${e.message}. Try refreshing.`;
    return;
  }

  if (isHost) {
    await dbRegisterRoom();
    // Build the initial roster from the join snapshot and publish it.
    hostSyncRoster();

    // Safety-net: periodically rebuild + rebroadcast the roster so late joiners
    // (whose player_hello may have raced ahead of presence propagation) and
    // genuine disconnects are reconciled even if an event was missed.
    setInterval(() => hostSyncRoster(), 5000);
  }
}

// ─── Button wiring ────────────────────────────────────────────────────────────
$('start-btn').addEventListener('click', startGame);

$('back-btn').addEventListener('click', async e => {
  e.preventDefault();
  // Broadcast intentional leave so other clients can remove us immediately
  // (before net.leave() disconnects us from the channel).
  net.sendPlayerLeave(net.myId);
  if (isHost) await dbDeleteRoom();
  await net.leave();
  location.href = 'index.html';
});

// Host only — immediately start a new round with the previous round's players
// (those still connected), skipping the lobby entirely.
$('play-again-btn').addEventListener('click', () => {
  if (!isHost) return;
  const presentIds   = new Set(net.getPresencePlayers().map(p => p.id));
  const participants = gameParticipants.filter(p => p.isAI || presentIds.has(p.id));
  if (participants.length < 2) {
    // Not enough of the old players left — fall back to the lobby.
    returnToLobby();
    net.sendReturnLobby();
    return;
  }
  startRound(participants);
});

// Host only — return everyone to the lobby.
$('back-to-lobby-btn').addEventListener('click', () => {
  if (!isHost) return;
  returnToLobby();
  net.sendReturnLobby();
});

// Non-host only — leave the room and go to the title screen.
$('leave-title-btn').addEventListener('click', async () => {
  net.sendPlayerLeave(net.myId);
  await net.leave();
  location.href = 'index.html';
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

window.addEventListener('beforeunload', () => {
  if (isHost) dbDeleteRoomBeacon();
});

init();
