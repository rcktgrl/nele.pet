import { GameState, createMap, TILE_SIZE, GRID_W, GRID_H, BOMB_FUSE, PLAYER_COLORS } from './game.js';
import { Renderer } from './renderer.js';
import { Network }  from './network.js';

// ─── State ────────────────────────────────────────────────────────────────────
const net   = new Network();
const state = new GameState();
let renderer    = null;
let myPlayer    = null;
let isHost      = false;
let gameRunning = false;

// Input
const keys = {};
let lastMoveTime = 0;
const MOVE_COOLDOWN = 130; // ms between steps
let bombCooldown = false;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = {
  lobby:  $('lobby'),
  game:   $('game-screen'),
  result: $('result-screen'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
    el.classList.toggle('active', k === name);
  });
}

function setStatus(msg, err = false) {
  const el = $('status-msg');
  el.textContent = msg;
  el.style.color = err ? '#ff4444' : '#aaa8cc';
}

// ─── Lobby UI ─────────────────────────────────────────────────────────────────
function updateLobbyList(players) {
  const list = $('player-list');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-entry';
    const dot = document.createElement('span');
    dot.className = 'player-dot';
    dot.style.background = PLAYER_COLORS[i] ?? '#888';
    div.appendChild(dot);
    div.append(` ${p.name}${p.isHost ? ' 👑' : ''}`);
    list.appendChild(div);
  });

  if (isHost) {
    const canStart = players.length >= 2;
    $('start-btn').classList.toggle('hidden', !canStart);
    $('waiting-msg').textContent = canStart
      ? `${players.length} players — ready to start!`
      : 'Waiting for at least 1 more player…';
  } else {
    $('start-btn').classList.add('hidden');
    $('waiting-msg').textContent = 'Waiting for host to start…';
  }
}

async function createRoom() {
  const name = $('username-input').value.trim();
  if (!name) { setStatus('Enter your name first!', true); return; }
  setStatus('Creating room…');
  isHost = true;
  const code = net.generateRoomCode();
  wireNetworkCallbacks();
  await net.joinRoom(code, name, true);
  $('room-code-display').textContent = code;
  $('room-section').classList.add('hidden');
  $('waiting-section').classList.remove('hidden');
  setStatus('');
}

async function joinRoom() {
  const name = $('username-input').value.trim();
  const code = $('room-code-input').value.trim().toUpperCase();
  if (!name) { setStatus('Enter your name first!', true); return; }
  if (code.length !== 4) { setStatus('Enter a valid 4-letter room code!', true); return; }
  setStatus('Joining…');
  isHost = false;
  wireNetworkCallbacks();
  await net.joinRoom(code, name, false);
  $('room-code-display').textContent = code;
  $('room-section').classList.add('hidden');
  $('waiting-section').classList.remove('hidden');
  setStatus('');
}

// ─── Network callbacks ────────────────────────────────────────────────────────
function wireNetworkCallbacks() {
  net.onPresenceUpdate = updateLobbyList;
  net.onGameStart      = handleGameStart;
  net.onPlayerMove     = handlePlayerMove;
  net.onBombPlaced     = handleBombPlaced;
  net.onPlayerDead     = handlePlayerDead;
  net.onPowerupCollected = handlePowerupCollected;
  net.onGameEnd        = handleGameEnd;
}

async function startGame() {
  const players = net.getPresencePlayers();
  if (players.length < 2) return;

  const seed       = Date.now();
  const map        = createMap(seed);
  const playerOrder = players.map(p => ({ id: p.id, name: p.name }));

  // Apply locally first
  beginGame(map, playerOrder);
  // Broadcast to others
  await net.sendGameStart(map, playerOrder);
}

function handleGameStart({ map, playerOrder }) {
  beginGame(map, playerOrder);
}

function beginGame(map, playerOrder) {
  state.init(map, playerOrder);
  myPlayer = state.players.get(net.myId);
  showScreen('game');
  const canvas = $('game-canvas');
  renderer = new Renderer(canvas);
  gameRunning = true;
  lastMoveTime = 0;
  bombCooldown = false;
  updateHUD();
  requestAnimationFrame(gameLoop);
}

// ─── In-game network events ───────────────────────────────────────────────────
function handlePlayerMove({ id, tileX, tileY }) {
  const p = state.players.get(id);
  if (p && id !== net.myId) {
    p.startMove(tileX, tileY, Date.now());
  }
}

function handleBombPlaced({ bombId, placedBy, tileX, tileY, explodesAt, range }) {
  state.addBomb(bombId, placedBy, tileX, tileY, explodesAt, range);
  const delay = Math.max(0, explodesAt - Date.now());
  setTimeout(() => triggerExplosion(bombId, placedBy), delay);
}

function handlePlayerDead({ id }) {
  const p = state.players.get(id);
  if (p) {
    p.alive = false;
    updateHUD();
  }
  checkGameEnd();
}

function handlePowerupCollected({ playerId, tileX, tileY }) {
  state.collectPowerup(playerId, tileX, tileY);
  updateHUD();
}

function handleGameEnd({ winnerId }) {
  gameRunning = false;
  const winner = winnerId ? state.players.get(winnerId) : null;
  $('result-title').textContent = winner ? `${winner.name} wins! 🎉` : "It's a draw! 💥";
  const alive = state.getAlivePlayers();
  $('result-subtitle').textContent = alive.length <= 1
    ? (winner ? `${winner.name} was the last one standing.` : 'Everyone eliminated at the same time.')
    : '';
  showScreen('result');
}

// ─── Bomb logic ───────────────────────────────────────────────────────────────
function placeBomb() {
  if (!myPlayer || !myPlayer.alive) return;
  if (myPlayer.activeBombs >= myPlayer.maxBombs) return;
  if (bombCooldown) return;

  // Don't stack on existing bomb
  const { tileX, tileY } = myPlayer;
  for (const [, b] of state.bombs) {
    if (b.tileX === tileX && b.tileY === tileY) return;
  }

  const bombId    = crypto.randomUUID();
  const explodesAt = Date.now() + BOMB_FUSE;
  const range     = myPlayer.bombRange;

  state.addBomb(bombId, net.myId, tileX, tileY, explodesAt, range);
  net.sendBomb(bombId, tileX, tileY, explodesAt, range);

  setTimeout(() => triggerExplosion(bombId, net.myId), BOMB_FUSE);

  bombCooldown = true;
  setTimeout(() => { bombCooldown = false; }, 300);
}

function triggerExplosion(bombId, placedBy) {
  const result = state.explodeBomb(bombId);
  if (!result) return;

  updateHUD();

  // Check if any alive player is on explosion tiles
  for (const [id, player] of state.players) {
    if (!player.alive) continue;
    if (state.isPlayerInExplosion(player)) {
      player.alive = false;
      updateHUD();
      net.sendPlayerDead(id);
      checkGameEnd();
    }
  }
}

function checkGameEnd() {
  if (!isHost) return; // only host determines game end
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
  if (e.code === 'Space' || e.code === 'KeyF') {
    e.preventDefault();
    if (gameRunning) placeBomb();
  }
  // Prevent arrow key scrolling during gameplay
  if (gameRunning && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function handleMovement(now) {
  if (!myPlayer?.alive) return;
  if (now - lastMoveTime < MOVE_COOLDOWN) return;

  let dx = 0, dy = 0;
  if (keys['ArrowUp']    || keys['KeyW']) dy = -1;
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

    // Power-up collection
    const type = state.collectPowerup(net.myId, nx, ny);
    if (type) {
      net.sendPowerupCollected(nx, ny);
      updateHUD();
    }
  }
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning) return;
  const now = Date.now();

  handleMovement(now);

  // Smooth render position for all players
  for (const [, p] of state.players) p.updateRender(now);

  state.update(); // purge expired explosions

  renderer.render(state);

  requestAnimationFrame(gameLoop);
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateHUD() {
  const el = $('player-stats');
  el.innerHTML = '';
  for (const [, p] of state.players) {
    const chip = document.createElement('div');
    chip.className = `stat-chip${p.alive ? '' : ' dead'}`;
    chip.style.setProperty('--player-color', p.color);
    chip.innerHTML = `
      <span class="chip-dot"></span>
      <span class="chip-name">${p.name}</span>
      <span class="chip-info">🔥${p.bombRange} 💣${p.maxBombs}</span>
    `;
    el.appendChild(chip);
  }
}

// ─── Button wiring ────────────────────────────────────────────────────────────
$('create-btn').addEventListener('click', createRoom);
$('join-btn').addEventListener('click', joinRoom);
$('start-btn').addEventListener('click', startGame);
$('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});
$('play-again-btn').addEventListener('click', () => {
  net.leave().finally(() => location.reload());
});

// Copy room code on click
$('room-code-display').addEventListener('click', async () => {
  const code = $('room-code-display').textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    $('room-code-display').textContent = 'Copied!';
    setTimeout(() => { $('room-code-display').textContent = code; }, 1200);
  } catch { /* ignore */ }
});
