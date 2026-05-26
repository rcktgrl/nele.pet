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

let lobbyRealPlayers = [];
let lobbyAIPlayers   = [];
let aiInstances      = [];

// Tracks which section is currently visible: 'lobby' | 'game' | 'result'
// Used to guard presence pruning — we only want to remove disconnected players
// while we're actually in the lobby, not during gameplay or the result screen.
let activeSection = 'lobby';

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
  activeSection = name;
  ['lobby', 'game', 'result'].forEach(s => {
    $(`${s}-section`).classList.toggle('hidden', s !== name);
    $(`${s}-section`).classList.toggle('active', s === name);
  });
}

// ─── Player list helpers ──────────────────────────────────────────────────────
function selfEntry() {
  return { id: net.myId, name: playerName, isHost, isAI: false };
}

function allPlayers() {
  const others = lobbyRealPlayers.filter(p => p.id !== net.myId);
  return [selfEntry(), ...others, ...lobbyAIPlayers];
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

function kickPlayer(id) {
  net.sendPlayerKick(id);
  lobbyRealPlayers = lobbyRealPlayers.filter(p => p.id !== id);
  renderSlots();
  if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
}

// ─── Game start ───────────────────────────────────────────────────────────────
async function startGame() {
  const all = allPlayers();
  if (all.length < 2) return;
  sound.init();

  const { w: gridW, h: gridH } = COMPLEXITY_GRIDS[complexity] ?? COMPLEXITY_GRIDS[0];
  const map         = createMap(Date.now(), gridW, gridH);
  const playerOrder = all.map(p => ({ id: p.id, name: p.name, isAI: !!p.isAI }));

  await dbMarkStarted();
  beginGame(map, playerOrder, gridW, gridH);
  await net.sendGameStart(map, playerOrder, gridW, gridH);
}

function handleGameStart({ map, playerOrder, gridW, gridH }) {
  beginGame(map, playerOrder, gridW ?? GRID_W, gridH ?? GRID_H);
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
function handlePlayerMove({ id, tileX, tileY }) {
  const p = state.players.get(id);
  if (p && id !== net.myId) p.startMove(tileX, tileY, Date.now());
}

function handleBombPlaced({ bombId, placedBy, tileX, tileY, explodesAt, range, type }) {
  state.addBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type ?? 'normal');
  const delay = Math.max(0, explodesAt - Date.now());
  setTimeout(() => triggerExplosion(bombId), delay);
  // Award 10pts for other players' special bombs (local player handles it in placeSpecialBomb)
  if (type && type !== BOMB_TYPE.NORMAL && placedBy !== net.myId) {
    awardGameScore(placedBy, 10);
  }
}

function handleBombKick({ bombId, newTileX, newTileY }) {
  state.moveBomb(bombId, newTileX, newTileY);
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
  if (!gameRunning) return; // guard against double-calls
  gameRunning = false;
  sound.stop();

  // Compute placement bonuses and merge into session scores
  finalizeGameScores(winnerId);

  // Update leaderboards
  renderSessionLeaderboard();
  const myScore = gameScores.get(net.myId) || 0;
  saveGlobalScore(playerName, myScore); // async, non-blocking

  const winner = winnerId ? state.players.get(winnerId) : null;
  $('result-title').textContent    = winner ? `${winner.name} wins! 🎉` : "It's a draw! 💥";
  $('result-subtitle').textContent = winner
    ? `${winner.name} was the last one standing.`
    : 'Everyone eliminated at the same time.';

  renderResultScores();
  showSection('result');
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
  renderSlots();
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

  // ── Presence merge helper ─────────────────────────────────────────────────
  // Applies a list of incoming presence players to lobbyRealPlayers.
  // • Skips self.
  // • If the same *name* already exists with a different *id*, the player
  //   reconnected (page refresh) — reclaim their slot and transfer scores.
  // • Never removes players; onPresenceLeave + the 4-s interval handle that,
  //   so a stale sync can't accidentally wipe someone who just joined.
  function mergePresencePlayers(incoming) {
    let changed = false;
    for (const p of incoming) {
      if (p.id === net.myId) continue;
      const existingById   = lobbyRealPlayers.find(r => r.id   === p.id);
      const existingByName = !existingById && lobbyRealPlayers.find(r => r.name === p.name);
      if (existingByName) {
        // Same name, new ID → reconnect; keep their slot position
        const idx   = lobbyRealPlayers.indexOf(existingByName);
        const oldId = existingByName.id;
        lobbyRealPlayers[idx] = { ...existingByName, id: p.id };
        if (sessionScores.has(oldId)) {
          sessionScores.set(p.id, sessionScores.get(oldId));
          sessionScores.delete(oldId);
        }
        changed = true;
      } else if (!existingById) {
        lobbyRealPlayers.push(p);
        changed = true;
      }
    }
    return changed;
  }

  // ── Presence handlers ─────────────────────────────────────────────────────
  // Sync events give us the full authoritative state; we merge-add so that a
  // late or out-of-order sync can't remove a player that onPresenceJoin just
  // added (fixes the "appears for a split second then disappears" flicker).
  net.onPresenceUpdate = freshPlayers => {
    if (mergePresencePlayers(freshPlayers)) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  };

  net.onPresenceJoin = newPlayers => {
    if (mergePresencePlayers(newPlayers)) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  };

  net.onPresenceLeave = leftPlayers => {
    const leftIds  = new Set(leftPlayers.map(p => p.id));
    const hostLeft = leftPlayers.some(p => p.isHost);
    // Handle host-left immediately — this is time-sensitive
    if (hostLeft && !isHost && !gameRunning) dbDeleteRoom();

    // Delay the actual removal to guard against spurious leave events that
    // Supabase fires during WebSocket reconnections (a leave+join pair for the
    // same player).  Re-check presence state before removing.
    // Only prune while in the lobby — not during the game or result screen.
    // (gameRunning is already false on the result screen, so checking only
    // gameRunning would cause players to be pruned prematurely.)
    setTimeout(() => {
      if (activeSection !== 'lobby') return;
      const stillPresent = new Set(net.getPresencePlayers().map(p => p.id));
      const before = lobbyRealPlayers.length;
      lobbyRealPlayers = lobbyRealPlayers.filter(
        p => !leftIds.has(p.id) || stillPresent.has(p.id)
      );
      if (lobbyRealPlayers.length !== before) {
        renderSlots();
        if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
      }
    }, 2500);
  };

  net.onPlayerHello = ({ id, name, isHost: pIsHost }) => {
    if (id === net.myId) return;
    // Reuse mergePresencePlayers so reconnects are handled identically
    if (mergePresencePlayers([{ id, name, isHost: pIsHost }])) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
    if (isHost && lobbyAIPlayers.length > 0) net.sendAIUpdate(lobbyAIPlayers);
  };

  net.onPlayerKick = ({ targetId }) => {
    if (targetId === net.myId) {
      alert('You were kicked from the lobby.');
      location.href = 'index.html';
      return;
    }
    lobbyRealPlayers = lobbyRealPlayers.filter(p => p.id !== targetId);
    renderSlots();
  };

  net.onAIUpdate  = ({ aiPlayers }) => { lobbyAIPlayers = aiPlayers ?? []; renderSlots(); };

  // Host broadcasts play_again when they click "Play Again".  Non-host
  // clients receive this and transition back to the lobby automatically —
  // no page refresh needed, so player IDs and session scores are preserved.
  net.onPlayAgain = () => {
    if (isHost) return; // host already handled this locally
    gameRunning = false;
    // Rebuild player list from current presence so we start fresh.
    lobbyRealPlayers = net.getPresencePlayers().filter(p => p.id !== net.myId);
    showSection('lobby'); // sets activeSection = 'lobby'
    renderSlots();
    renderSessionLeaderboard();
    loadGlobalLeaderboard().then(rows => renderGlobalLeaderboard(rows));
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

  if (isHost) await dbRegisterRoom();

  // Initial population from the snapshot returned by joinRoom.
  // We do a merge-add here too (via the helper) so any players already present
  // get their duplicate-name check on first load.
  mergePresencePlayers(net.getPresencePlayers());
  renderSlots();

  // Fast interval — only ADDS players we might have missed (e.g. player_hello
  // arrived before presence state propagated).  No pruning here: removing
  // players is handled exclusively by onPresenceLeave so we never accidentally
  // evict a player whose presence hasn't fully propagated yet.
  setInterval(() => {
    if (activeSection !== 'lobby') return;
    const fresh  = net.getPresencePlayers();
    const before = lobbyRealPlayers.length;
    mergePresencePlayers(fresh);
    if (lobbyRealPlayers.length !== before) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  }, 4000);

  // Slow safety-net — prunes genuinely stale entries in case a leave event
  // was missed (e.g. hard browser close with no WebSocket teardown).
  // 30 s gives Supabase plenty of time to surface any reconnect join.
  setInterval(() => {
    if (activeSection !== 'lobby') return;
    const fresh    = net.getPresencePlayers();
    const freshIds = new Set(fresh.map(p => p.id));
    const before   = lobbyRealPlayers.length;
    lobbyRealPlayers = lobbyRealPlayers.filter(p => freshIds.has(p.id));
    if (lobbyRealPlayers.length !== before) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  }, 30000);
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
  sound.stop();
  // Rebuild the real-player list directly from the current presence snapshot so
  // we don't inherit any stale pruning that happened during the game or on the
  // result screen (activeSection was not 'lobby' then, so the leave-event
  // timeouts were suppressed, but any that slipped through can't hurt us here).
  lobbyRealPlayers = net.getPresencePlayers().filter(p => p.id !== net.myId);
  showSection('lobby');   // also sets activeSection = 'lobby'
  renderSlots();
  renderSessionLeaderboard();
  // Refresh global leaderboard
  loadGlobalLeaderboard().then(rows => renderGlobalLeaderboard(rows));
  if (isHost) {
    // Tell non-host players to return to the lobby too, so they don't have
    // to manually refresh (which would give them a new ID and lose scores).
    net.sendPlayAgain();
    net.sendAIUpdate(lobbyAIPlayers);
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

window.addEventListener('beforeunload', () => {
  if (isHost) dbDeleteRoomBeacon();
});

init();
