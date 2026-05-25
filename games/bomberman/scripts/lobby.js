import { GameState, createMap, BOMB_FUSE, PLAYER_COLORS } from './game.js';
import { Renderer } from './renderer.js';
import { Network }  from './network.js';
import { AIPlayer, BOT_NAMES } from './ai.js';

// ─── URL params ───────────────────────────────────────────────────────────────
const params     = new URLSearchParams(location.search);
const roomCode   = params.get('room')?.slice(0, 4).toUpperCase();
const playerName = decodeURIComponent(params.get('name') || '').trim();
const isHost     = params.has('host');

// Redirect back if params are missing
if (!roomCode || !playerName) location.replace('index.html');

// ─── Core objects ─────────────────────────────────────────────────────────────
const net   = new Network();
const state = new GameState();
let renderer    = null;
let myPlayer    = null;
let gameRunning = false;

// Lobby state
let lobbyRealPlayers = []; // from Supabase presence
let lobbyAIPlayers   = []; // { id, name, isAI: true } — managed by host
let aiInstances      = []; // AIPlayer[]  — only on host

// Input
const keys = {};
let lastMoveTime = 0;
const MOVE_COOLDOWN = 130;
let bombCooldown = false;

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showSection(name) {
  ['lobby', 'game', 'result'].forEach(s => {
    $(`${s}-section`).classList.toggle('hidden',   s !== name);
    $(`${s}-section`).classList.toggle('active',   s === name);
  });
}

// ─── Lobby UI ─────────────────────────────────────────────────────────────────
function renderSlots() {
  const all = [...lobbyRealPlayers, ...lobbyAIPlayers];

  for (let i = 0; i < 4; i++) {
    const slot = $(`slot-${i}`);
    slot.innerHTML = '';
    slot.className = 'slot';
    slot.style.removeProperty('--color');

    if (i < all.length) {
      const p = all[i];
      slot.classList.add('slot-filled');
      slot.style.setProperty('--color', PLAYER_COLORS[i]);

      const dot  = el('span', 'slot-dot');
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
  $('start-btn').classList.toggle('hidden', !canStart);
  $('lobby-msg').textContent = isHost
    ? (total >= 2 ? `${total} players ready!` : 'Add 1 more player or bot to start.')
    : 'Waiting for host to start the game…';
}

function el(tag, cls, text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function updateRoomDisplay() {
  $('room-code-display').textContent = roomCode;
}

// ─── AI management ────────────────────────────────────────────────────────────
function addAI() {
  const total = lobbyRealPlayers.length + lobbyAIPlayers.length;
  if (total >= 4) return;
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
  const all = [...lobbyRealPlayers, ...lobbyAIPlayers];
  if (all.length < 2) return;

  const map         = createMap(Date.now());
  const playerOrder = all.map(p => ({ id: p.id, name: p.name, isAI: !!p.isAI }));

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
  // Apply moves for any player that isn't me (includes remote AI from host)
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
  $('result-title').textContent = winner ? `${winner.name} wins! 🎉` : "It's a draw! 💥";
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

  // Each human self-reports only their own death
  if (myPlayer && wasMyPlayerAlive && !myPlayer.alive) {
    net.sendPlayerDead(net.myId);
  }

  // Host also reports AI deaths
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
  const bombId    = crypto.randomUUID();
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

  // AI updates (host only)
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
  const el = $('player-stats');
  el.innerHTML = '';
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
    el.appendChild(chip);
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
async function init() {
  updateRoomDisplay();
  showSection('lobby');

  // Wire callbacks before joining
  net.onPresenceUpdate = players => {
    lobbyRealPlayers = players;
    renderSlots();
  };
  net.onAIUpdate = ({ aiPlayers }) => {
    lobbyAIPlayers = aiPlayers ?? [];
    renderSlots();
  };
  net.onGameStart         = handleGameStart;
  net.onPlayerMove        = handlePlayerMove;
  net.onBombPlaced        = handleBombPlaced;
  net.onPlayerDead        = handlePlayerDead;
  net.onPowerupCollected  = handlePowerupCollected;
  net.onGameEnd           = handleGameEnd;

  await net.joinRoom(roomCode, playerName, isHost);

  // Force-refresh lobby list (presence sync may have fired during async join)
  lobbyRealPlayers = net.getPresencePlayers();
  renderSlots();
}

// ─── Button wiring ────────────────────────────────────────────────────────────
$('start-btn').addEventListener('click', startGame);

$('back-btn').addEventListener('click', async e => {
  e.preventDefault();
  await net.leave();
  location.href = 'index.html';
});

$('play-again-btn').addEventListener('click', () => {
  // Reset game state and go back to lobby view in-page (same channel)
  gameRunning = false;
  showSection('lobby');
  renderSlots();
  // Re-send AI list to sync (host may want to add/remove bots)
  if (isHost) net.sendAIUpdate(lobbyAIPlayers);
});

// Copy room code
$('room-code-display').addEventListener('click', async () => {
  const code = roomCode;
  try {
    await navigator.clipboard.writeText(code);
    $('room-code-display').textContent = 'Copied!';
    setTimeout(() => { $('room-code-display').textContent = code; }, 1200);
  } catch { /* ignore */ }
});

// Copy invite link
$('copy-link-btn').addEventListener('click', async () => {
  const url = `${location.origin}/games/bomberman/?room=${roomCode}`;
  const btn = $('copy-link-btn');
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '🔗 Copy link'; }, 1800);
  } catch { /* ignore */ }
});

init();
