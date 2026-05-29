import { createMap, BOMB_FUSE, BOMB_TYPE, PLAYER_COLORS, COMPLEXITY_GRIDS, GRID_W, GRID_H } from './game.js';
import { Renderer }          from './renderer.js';
import { Network }           from './network.js';
import { GlobalSimulation }  from './global-sim.js';
import { LocalSimulation }   from './local-sim.js';
import { AIPlayer, BOT_NAMES } from './ai.js';
import { SoundSystem }       from './sound.js';
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
const sound = new SoundSystem();

// One of these is active per game round.
let globalSim = null; // host only
let localSim  = null; // non-host clients

// Convenience: the active simulation for the current game.
// Returns globalSim (host) or localSim (non-host), or null.
function activeSim() { return isHost ? globalSim : localSim; }

let renderer    = null;
let myPlayer    = null;
let gameRunning = false;

// Complexity (host only): 0=Normal, 1=Large, 2=Huge
let complexity = 0;

const MAX_PLAYERS = 4;

// ─── Lobby roster (global-sim / host-authoritative) ───────────────────────────
// The host owns the canonical, ordered roster and broadcasts it to everyone so
// that every client renders an identical lobby view (same order, same colors).
// Each entry: { id, name, isAI, isHost, inGame }.
let roster = [];

// AI instances driven by GlobalSimulation (host only).
let aiInstances = [];

// Whether a round is currently in progress in the room.
let roomGameRunning = false;

// Participants of the current / most-recent round.
let gameParticipants = [];
let amParticipant    = false;

let lastMoveTime = 0;
const MOVE_COOLDOWN = 130;
let bombCooldown = false;

// ─── Scoring (host-authoritative) ────────────────────────────────────────────
// sessionScores persists across "play again" within the same lobby session
const sessionScores = new Map(); // id → {name, score}

// Awards placement bonuses and merges game scores into session totals.
// Called by the host's onGameEnd callback BEFORE broadcasting scores.
function finalizeGameScores(winnerId) {
  if (!isHost || !globalSim) return;
  const totalPlayers = globalSim.state.players.size;
  const deathOrder   = globalSim.deathOrder;

  if (winnerId) globalSim.awardScore(winnerId, 100);
  if (totalPlayers > 2 && deathOrder.length >= 1)
    globalSim.awardScore(deathOrder[deathOrder.length - 1], 50);
  if (totalPlayers >= 4 && deathOrder.length >= 2)
    globalSim.awardScore(deathOrder[deathOrder.length - 2], 10);

  for (const [id, pts] of globalSim.gameScores) {
    const player = globalSim.state.players.get(id);
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

// ─── Lobby roster helpers (host-authoritative) ────────────────────────────────
function realPlayerCount() {
  return roster.filter(e => !e.isAI).length;
}

// Host: rebuild the roster from live presence + AI entries.
// Fixes the timing race by always ensuring the host themselves is present.
function hostRebuildRoster() {
  const presence = net.getPresencePlayers();

  // Guard against the async presence-state race: ensure the host is always in
  // the list even if the presence sync hasn't arrived back yet.
  if (!presence.find(p => p.id === net.myId)) {
    presence.push({ id: net.myId, name: playerName, isHost: true });
  }

  const presentIds = new Set(presence.map(p => p.id));

  // Reconnect detection — run before pruning so we can match the stale id.
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

// ─── Global leaderboard ───────────────────────────────────────────────────────
async function saveGlobalScore(name, pts) {
  if (pts <= 0) return;
  try {
    const { data: existing } = await supabase
      .from('bomberman_scores').select('id, score').eq('player_name', name).maybeSingle();
    if (existing) {
      await supabase.from('bomberman_scores')
        .update({ score: existing.score + pts, last_updated: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('bomberman_scores').insert({ player_name: name, score: pts });
    }
  } catch (e) { console.warn('Could not save global score:', e); }
}
async function loadGlobalLeaderboard() {
  try {
    const { data, error } = await supabase
      .from('bomberman_scores').select('player_name, score')
      .order('score', { ascending: false }).limit(10);
    if (error) throw error;
    return data || [];
  } catch (e) { console.warn('Could not load global leaderboard:', e); return []; }
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
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${medals[i] ?? `${i + 1}.`} ${row.player_name}</td><td>${row.score.toLocaleString()} pts</td>`;
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
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${medals[i] ?? `${i + 1}.`} ${e.name}</td><td>${e.score.toLocaleString()} pts</td>`;
    table.appendChild(tr);
  });
}
function renderResultScores(gameScores, players) {
  const el = $('result-scores');
  if (!el) return;
  const entries = [...gameScores.entries()]
    .map(([id, score]) => ({ name: players.get(id)?.name || id, score }))
    .sort((a, b) => b.score - a.score);
  if (!entries.length) { el.innerHTML = ''; return; }
  const medals = ['🥇', '🥈', '🥉'];
  let html = '<table class="lb-table">';
  entries.forEach((e, i) => {
    html += `<tr><td>${medals[i] ?? `${i + 1}.`} ${e.name}</td><td>${e.score.toLocaleString()} pts</td></tr>`;
  });
  el.innerHTML = html + '</table>';
}

// ─── Lobby UI ─────────────────────────────────────────────────────────────────
function el(tag, cls, text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function makePlayerSlot(p, idx) {
  const slot  = el('div', 'slot slot-filled');
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
  if (isHost && !roomGameRunning && roster.length < MAX_PLAYERS) {
    const add = el('div', 'slot slot-empty');
    const btn = el('button', 'slot-add-btn', '+ Add Bot');
    btn.addEventListener('click', addAI);
    add.appendChild(btn);
    container.appendChild(add);
  }
  for (let i = container.children.length; i < MAX_PLAYERS; i++) {
    const passive = el('div', 'slot slot-passive');
    passive.appendChild(el('span', 'slot-empty-label', '—'));
    container.appendChild(passive);
  }
  const total    = roster.length;
  const canStart = isHost && !roomGameRunning && total >= 2;
  const startBtn = $('start-btn');
  if (startBtn) startBtn.disabled = !canStart;
  const msg = $('lobby-msg');
  if (msg) {
    if (roomGameRunning) {
      msg.textContent = isHost
        ? 'Game in progress…'
        : "Game in progress — you'll join the next round.";
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

// ─── AI management (host only) ───────────────────────────────────────────────
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
async function startGame() {
  if (!isHost || roomGameRunning || roster.length < 2) return;
  sound.init();
  await startRound(roster.slice(0, MAX_PLAYERS));
}
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
  hostSyncRoster(); // mark 🎮 + push roster to spectators
  beginGame(map, order, gridW, gridH);
}

// ─── Begin game (called on all participating clients) ─────────────────────────
function beginGame(map, playerOrder, gridW = GRID_W, gridH = GRID_H) {
  gameRunning  = true;
  lastMoveTime = 0;
  bombCooldown = false;
  renderer     = new Renderer($('game-canvas'), gridW, gridH);

  if (isHost) {
    // Host uses GlobalSimulation as the authoritative game state
    globalSim = new GlobalSimulation();

    // Wire up AI instances that belong to this round
    const roundAI = aiInstances.filter(ai => playerOrder.some(p => p.id === ai.id));
    globalSim.setAI(roundAI);

    globalSim.init(map, playerOrder, gridW, gridH);
    wireGlobalSimCallbacks();

    myPlayer = globalSim.state.players.get(net.myId);
  } else {
    // Non-host uses LocalSimulation that follows the host's global sim
    localSim = new LocalSimulation();
    localSim.init(map, playerOrder, gridW, gridH);

    myPlayer = localSim.state.players.get(net.myId);
  }

  showSection('game');
  updateHUD();
  sound.setBricksDestroyed(0);
  sound.start();
  requestAnimationFrame(gameLoop);
}

// ─── Host: wire GlobalSimulation callbacks to network + sound + UI ────────────
function wireGlobalSimCallbacks() {
  globalSim.onBombExploded = (bombId, result, killedIds, powerups, totalBricks) => {
    sound.playExplosion();
    sound.setBricksDestroyed(totalBricks);
    net.sendBombExploded(bombId, result, killedIds, powerups, totalBricks);
    updateHUD();
  };

  globalSim.onNapalmSpread = (tiles, dieAt, killedIds) => {
    net.sendNapalmSpread(tiles, dieAt, killedIds);
    if (killedIds.length) updateHUD();
  };

  globalSim.onPlayerDead = (id) => {
    updateHUD();
    // Individual player_dead broadcast is implicit via onBombExploded killedIds.
    // We only need a separate broadcast for napalm continuous deaths (handled above).
  };

  globalSim.onGameEnd = (winnerId) => {
    // Finalise placement bonuses before broadcasting scores
    finalizeGameScores(winnerId);
    const scores = [...globalSim.gameScores.entries()].map(([id, pts]) => {
      const name = globalSim.state.players.get(id)?.name ?? id;
      return { id, name, pts };
    });
    net.sendGameEnd(winnerId, scores);
    handleGameEnd({ winnerId, scores });
  };

  globalSim.onAIMove = (id, tileX, tileY) => {
    net.sendAnyMove(id, tileX, tileY);
  };

  globalSim.onAIBomb = (bombId, placedBy, tileX, tileY, explodesAt, range, type) => {
    net.sendAnyBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type);
    sound.playBombPlace();
  };

  globalSim.onAIPowerup = (playerId, tileX, tileY) => {
    net.sendAnyPowerupCollected(playerId, tileX, tileY);
    sound.playPowerup();
  };
}

// ─── Non-host: handle authoritative events from host ─────────────────────────
function handleBombExploded(payload) {
  if (!gameRunning || !localSim) return;
  localSim.applyBombExploded(payload);
  sound.playExplosion();
  sound.setBricksDestroyed(payload.totalBricksDestroyed ?? 0);
  updateHUD();
}

function handleNapalmSpread(payload) {
  if (!gameRunning || !localSim) return;
  localSim.applyNapalmSpread(payload);
  if ((payload.killedIds ?? []).length) updateHUD();
}

// ─── Shared game events (received by all non-host clients via broadcast) ──────
function handleGameStart({ map, playerOrder, gridW, gridH }) {
  gameParticipants = playerOrder;
  roomGameRunning  = true;
  amParticipant    = playerOrder.some(p => p.id === net.myId);

  if (amParticipant) {
    beginGame(map, playerOrder, gridW ?? GRID_W, gridH ?? GRID_H);
  } else {
    gameRunning = false;
    showSection('lobby');
    renderRoster();
  }
}

function handlePlayerMove({ id, tileX, tileY }) {
  if (!gameRunning || id === net.myId) return;
  const sim = activeSim();
  sim?.applyMove(id, tileX, tileY, Date.now());
}

function handleBombPlaced({ bombId, placedBy, tileX, tileY, explodesAt, range, type }) {
  if (!gameRunning) return;
  if (isHost) {
    // Guard against double-apply (AI bombs are added to state directly by ai.js,
    // then broadcast; the host won't receive self-broadcasts, but be explicit).
    if (globalSim.state.bombs.has(bombId)) return;
    globalSim.applyBombPlace(bombId, placedBy, tileX, tileY, explodesAt, range, type);
  } else {
    // Non-host: bomb exists in local state; explosion comes via bomb_exploded
    localSim.applyBombPlace(bombId, placedBy, tileX, tileY, explodesAt, range, type);
  }
}

function handleBombKick({ bombId, newTileX, newTileY }) {
  if (!gameRunning) return;
  activeSim()?.applyBombKick(bombId, newTileX, newTileY);
  sound.playKick();
}

function handlePowerupCollected({ playerId, tileX, tileY }) {
  if (!gameRunning) return;
  if (isHost) {
    globalSim.applyPowerupCollect(playerId, tileX, tileY);
  } else {
    localSim.applyPowerupCollect(playerId, tileX, tileY);
  }
  updateHUD();
}

function handleGameEnd({ winnerId, scores }) {
  if (!gameRunning) return;
  gameRunning     = false;
  roomGameRunning = false;
  sound.stop();

  const sim     = activeSim();
  const players = sim?.state.players ?? new Map();

  // Reconstruct a scores Map from the broadcast payload (works for both host/non-host)
  // Host: scores was just built from globalSim.gameScores after finalizeGameScores().
  // Non-host: scores comes from the network payload.
  const gameScores = new Map((scores ?? []).map(s => [s.id, s.pts]));

  if (isHost) {
    // finalizeGameScores() and sessionScores merge already done in onGameEnd callback.
    renderSessionLeaderboard();
    renderResultScores(gameScores, players);
    const myScore = gameScores.get(net.myId) || 0;
    saveGlobalScore(playerName, myScore);
    globalSim.stop();
    globalSim = null;
    hostSyncRoster();
  } else {
    // Merge received scores into session totals for non-host clients
    for (const { id, name, pts } of (scores ?? [])) {
      const prev = sessionScores.get(id) || { name, score: 0 };
      sessionScores.set(id, { name, score: prev.score + pts });
    }
    renderSessionLeaderboard();
    renderResultScores(gameScores, players);
    const myScore = gameScores.get(net.myId) || 0;
    saveGlobalScore(playerName, myScore);
    localSim.stop();
    localSim = null;
  }

  const winner = winnerId ? players.get(winnerId) : null;
  $('result-title').textContent    = winner ? `${winner.name} wins! 🎉` : "It's a draw! 💥";
  $('result-subtitle').textContent = winner
    ? `${winner.name} was the last one standing.`
    : 'Everyone eliminated at the same time.';

  $('play-again-btn').classList.toggle('hidden', !isHost);
  $('back-to-lobby-btn').classList.toggle('hidden', !isHost);
  $('leave-title-btn').classList.toggle('hidden', isHost);

  showSection('result');
}

function returnToLobby() {
  gameRunning      = false;
  roomGameRunning  = false;
  gameParticipants = [];
  amParticipant    = false;
  sound.stop();
  if (isHost) {
    globalSim?.stop();
    globalSim = null;
  } else {
    localSim?.stop();
    localSim = null;
  }
  showSection('lobby');
  if (isHost) {
    if (!isPrivate) dbRegisterRoom();
    hostSyncRoster();
  } else {
    renderRoster();
  }
  renderSessionLeaderboard();
  loadGlobalLeaderboard().then(rows => renderGlobalLeaderboard(rows));
}

// ─── Camera ───────────────────────────────────────────────────────────────────
function updateCamera() {
  if (!renderer || !myPlayer) return;
  const sim = activeSim();
  if (!sim) return;
  const mapPixW = sim.state.gridW * 40;
  const mapPixH = sim.state.gridH * 40;
  const vpW     = renderer.canvas.width;
  const vpH     = renderer.canvas.height;
  let camX = myPlayer.renderX + 20 - vpW / 2;
  let camY = myPlayer.renderY + 20 - vpH / 2;
  camX = Math.max(0, Math.min(mapPixW - vpW, camX));
  camY = Math.max(0, Math.min(mapPixH - vpH, camY));
  renderer.cameraX = camX;
  renderer.cameraY = camY;
}

// ─── Movement ─────────────────────────────────────────────────────────────────
function doMove(dx, dy, now) {
  if (!myPlayer?.alive) return;
  const sim = activeSim();
  if (!sim) return;

  const nx = myPlayer.tileX + dx;
  const ny = myPlayer.tileY + dy;

  // Bomb kick
  const bombAtTarget = sim.state.getBombAt(nx, ny);
  if (bombAtTarget) {
    const kickResult = sim.state.kickBomb(bombAtTarget.id, dx, dy);
    if (kickResult) {
      net.sendBombKick(bombAtTarget.id, kickResult.newTileX, kickResult.newTileY);
      sound.playKick();
      sim.applyMove(net.myId, nx, ny, now);
      lastMoveTime = now;
      net.sendMove(nx, ny);
      const pu = sim.applyPowerupCollect(net.myId, nx, ny);
      if (pu) {
        net.sendPowerupCollected(nx, ny);
        sound.playPowerup();
        updateHUD();
      }
    } else {
      lastMoveTime = now;
    }
    return;
  }

  if (sim.state.canMoveTo(nx, ny, net.myId)) {
    sim.applyMove(net.myId, nx, ny, now);
    lastMoveTime = now;
    net.sendMove(nx, ny);
    const pu = sim.applyPowerupCollect(net.myId, nx, ny);
    if (pu) {
      net.sendPowerupCollected(nx, ny);
      sound.playPowerup();
      updateHUD();
    }
  }
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (!gameRunning) return;
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'KeyF') { e.preventDefault(); placeBomb(); return; }
  if (e.code === 'KeyQ') { e.preventDefault(); placeSpecialBomb(); return; }
  let dx = 0, dy = 0;
  if      (e.code === 'ArrowUp'    || e.code === 'KeyW') { dy = -1; e.preventDefault(); }
  else if (e.code === 'ArrowDown'  || e.code === 'KeyS') { dy =  1; e.preventDefault(); }
  else if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { dx = -1; e.preventDefault(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { dx =  1; e.preventDefault(); }
  else return;
  const now = Date.now();
  if (now - lastMoveTime >= MOVE_COOLDOWN) doMove(dx, dy, now);
});

// ─── Touch controls ───────────────────────────────────────────────────────────
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
  if (bombBtn) bombBtn.addEventListener('pointerdown', e => { e.preventDefault(); if (!gameRunning) return; sound.init(); placeBomb(); });
  const specialBtn = $('touch-special');
  if (specialBtn) specialBtn.addEventListener('pointerdown', e => { e.preventDefault(); if (!gameRunning) return; sound.init(); placeSpecialBomb(); });
}

// ─── Bomb placement ───────────────────────────────────────────────────────────
function placeBomb() {
  if (!myPlayer?.alive || myPlayer.activeBombs >= myPlayer.maxBombs || bombCooldown) return;
  const sim = activeSim();
  if (!sim) return;
  const { tileX, tileY } = myPlayer;
  if (sim.state.getBombAt(tileX, tileY)) return;

  const bombId     = crypto.randomUUID();
  const explodesAt = Date.now() + BOMB_FUSE;

  // Apply locally (for host: schedules timer; for non-host: adds to local state)
  sim.applyBombPlace(bombId, net.myId, tileX, tileY, explodesAt, myPlayer.bombRange, BOMB_TYPE.NORMAL);
  net.sendBomb(bombId, tileX, tileY, explodesAt, myPlayer.bombRange, BOMB_TYPE.NORMAL);

  // Host receives its own broadcast via bomb_placed handler too, but we guard
  // against double-apply because sendBomb uses self:false channel config.

  bombCooldown = true;
  setTimeout(() => { bombCooldown = false; }, 300);
  sound.playBombPlace();
}

function placeSpecialBomb() {
  if (!myPlayer?.alive || !myPlayer.specialBomb) return;
  if (myPlayer.activeBombs >= myPlayer.maxBombs || bombCooldown) return;
  const sim = activeSim();
  if (!sim) return;
  const { tileX, tileY } = myPlayer;
  if (sim.state.getBombAt(tileX, tileY)) return;

  const bombTypeStr = myPlayer.specialBomb === 'napalm' ? BOMB_TYPE.NAPALM : BOMB_TYPE.BOX;
  myPlayer.specialBomb = null;
  if (isHost) globalSim.awardScore(net.myId, 10);
  updateHUD();

  const bombId     = crypto.randomUUID();
  const explodesAt = Date.now() + BOMB_FUSE;

  sim.applyBombPlace(bombId, net.myId, tileX, tileY, explodesAt, myPlayer.bombRange, bombTypeStr);
  net.sendBomb(bombId, tileX, tileY, explodesAt, myPlayer.bombRange, bombTypeStr);

  bombCooldown = true;
  setTimeout(() => { bombCooldown = false; }, 300);
  sound.playBombPlace();
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning) return;
  const now = Date.now();

  if (isHost && globalSim) {
    globalSim.update(now);
    globalSim.updateRender(now);
  } else if (localSim) {
    localSim.update(now);
  }

  updateCamera();
  const sim = activeSim();
  if (sim) renderer.render(sim.state);

  requestAnimationFrame(gameLoop);
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateHUD() {
  const sim   = activeSim();
  const hudEl = $('player-stats');
  if (!hudEl || !sim) return;
  hudEl.innerHTML = '';
  let i = 0;
  for (const [id, p] of sim.state.players) {
    const chip = document.createElement('div');
    chip.className = `stat-chip${p.alive ? '' : ' dead'}`;
    chip.style.setProperty('--player-color', PLAYER_COLORS[i++]);
    const sIcon = p.specialBomb === 'napalm' ? ' 🌋' : p.specialBomb === 'box' ? ' 📦' : '';
    const pts   = isHost ? (globalSim?.gameScores.get(id) || 0) : 0;
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
  loadGlobalLeaderboard().then(rows => renderGlobalLeaderboard(rows));

  if (isHost) {
    $('complexity-row').classList.remove('hidden');
    $('complexity-select').addEventListener('change', e => {
      complexity = parseInt(e.target.value, 10);
    });
  }

  // ── Presence handlers ─────────────────────────────────────────────────────
  const onPresenceChanged = () => { if (isHost) hostSyncRoster(); };
  net.onPresenceUpdate = onPresenceChanged;
  net.onPresenceJoin   = onPresenceChanged;

  net.onPresenceLeave = leftPlayers => {
    if (isHost) { hostSyncRoster(); return; }
    const hostLeft = leftPlayers.some(p => p.isHost);
    if (hostLeft && !gameRunning && !roomGameRunning) dbDeleteRoom();
  };

  net.onPlayerLeave = ({ id }) => {
    if (!isHost || id === net.myId) return;
    roster = roster.filter(e => e.id !== id);
    hostSyncRoster();
  };

  net.onPlayerHello = () => { if (isHost) hostSyncRoster(); };

  net.onLobbyState = ({ roster: r, gameRunning: gr }) => {
    if (isHost) return;
    roster          = Array.isArray(r) ? r : [];
    roomGameRunning = !!gr;
    renderRoster();
  };

  net.onReturnLobby = () => { if (!isHost) returnToLobby(); };

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

  // ── Game event handlers ───────────────────────────────────────────────────
  net.onGameStart        = handleGameStart;
  net.onPlayerMove       = handlePlayerMove;
  net.onBombPlaced       = handleBombPlaced;
  net.onBombKick         = handleBombKick;
  net.onBombExploded     = handleBombExploded;
  net.onNapalmSpread     = handleNapalmSpread;
  net.onPowerupCollected = handlePowerupCollected;
  net.onGameEnd          = handleGameEnd;

  try {
    await net.joinRoom(roomCode, playerName, isHost);
  } catch (e) {
    $('lobby-msg').textContent = `Connection failed: ${e.message}. Try refreshing.`;
    return;
  }

  if (isHost) {
    await dbRegisterRoom();
    hostSyncRoster();
    setInterval(() => hostSyncRoster(), 5000);
  }
}

// ─── Button wiring ────────────────────────────────────────────────────────────
$('start-btn').addEventListener('click', startGame);

$('back-btn').addEventListener('click', async e => {
  e.preventDefault();
  net.sendPlayerLeave(net.myId);
  if (isHost) await dbDeleteRoom();
  await net.leave();
  location.href = 'index.html';
});

$('play-again-btn').addEventListener('click', () => {
  if (!isHost) return;
  const presentIds   = new Set(net.getPresencePlayers().map(p => p.id));
  const participants = gameParticipants.filter(p => p.isAI || presentIds.has(p.id));
  if (participants.length < 2) {
    returnToLobby();
    net.sendReturnLobby();
    return;
  }
  startRound(participants);
});

$('back-to-lobby-btn').addEventListener('click', () => {
  if (!isHost) return;
  returnToLobby();
  net.sendReturnLobby();
});

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
