import { GameState, createMap, BOMB_FUSE, BOMB_TYPE, PLAYER_COLORS, COMPLEXITY_GRIDS, GRID_W, GRID_H, TILE } from './game.js';
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

const keys = {};
let lastMoveTime = 0;
const MOVE_COOLDOWN = 200; // 200 ms = max 5 tiles/s
let bombCooldown = false;

// Fixed viewport size (15×13 tiles)
const VP_W = 15 * 40;
const VP_H = 13 * 40;

// ─── Audio unlock ─────────────────────────────────────────────────────────────
// The AudioContext is created immediately (suspended). Any user interaction
// resumes it. We keep the listeners permanently — tryResume() is idempotent.
document.addEventListener('click',    () => sound.tryResume(), true);
document.addEventListener('keydown',  () => sound.tryResume(), true);
document.addEventListener('touchend', () => sound.tryResume(), true);

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showSection(name) {
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
          // Kick real player
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
  sound.init(); // ensure context alive on this gesture

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
  showSection('game');
  updateHUD();
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
  gameRunning = false;
  sound.stop();
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

  // Sound
  sound.playExplosion();
  // Update music tempo
  sound.setBricksDestroyed(state.bricksDestroyed);

  // Napalm: schedule fire spread
  if (result.isNapalm) {
    const tiles = [...result.tiles];
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

// ─── Input ────────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!gameRunning) return;
  if (e.code === 'Space' || e.code === 'KeyF') { e.preventDefault(); placeBomb(); }
  if (e.code === 'KeyQ') { e.preventDefault(); placeSpecialBomb(); }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
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

  // ── Bomb kick ──────────────────────────────────────────────────────────────
  const bombAtTarget = state.getBombAt(nx, ny);
  if (bombAtTarget) {
    const kickResult = state.kickBomb(bombAtTarget.id, dx, dy);
    if (kickResult) {
      net.sendBombKick(bombAtTarget.id, kickResult.newTileX, kickResult.newTileY);
      sound.playKick();
      // Player steps onto the bomb's vacated tile
      myPlayer.startMove(nx, ny, now);
      lastMoveTime = now;
      net.sendMove(nx, ny);
      const pu = state.collectPowerup(net.myId, nx, ny);
      if (pu) { net.sendPowerupCollected(nx, ny); sound.playPowerup(); updateHUD(); }
    } else {
      // Bomb can't slide (wall behind it) — movement blocked
      lastMoveTime = now;
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
      });
    }
  }

  handleMovement(now);
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
  for (const [, p] of state.players) {
    const chip = document.createElement('div');
    chip.className = `stat-chip${p.alive ? '' : ' dead'}`;
    chip.style.setProperty('--player-color', PLAYER_COLORS[i++]);
    const sIcon = p.specialBomb === 'napalm' ? ' 🌋' : p.specialBomb === 'box' ? ' 📦' : '';
    chip.innerHTML = `
      <span class="chip-dot"></span>
      <span class="chip-name">${p.name}</span>
      <span class="chip-info">🔥${p.bombRange} 💣${p.maxBombs}${sIcon}</span>
    `;
    hudEl.appendChild(chip);
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
async function init() {
  updateRoomDisplay();
  showSection('lobby');
  renderSlots();

  // Complexity selector — visible to all, changeable only by host
  if (!isHost) {
    $('complexity-select').disabled = true;
  } else {
    $('complexity-select').addEventListener('change', e => {
      complexity = parseInt(e.target.value, 10);
    });
  }

  // ── Presence handlers ─────────────────────────────────────────────────────
  net.onPresenceUpdate = players => {
    lobbyRealPlayers = players.filter(p => p.id !== net.myId);
    renderSlots();
    if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
  };

  net.onPresenceJoin = newPlayers => {
    let changed = false;
    for (const p of newPlayers) {
      if (p.id !== net.myId && !lobbyRealPlayers.find(r => r.id === p.id)) {
        lobbyRealPlayers.push(p); changed = true;
      }
    }
    if (changed) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  };

  net.onPresenceLeave = leftPlayers => {
    const leftIds = new Set(leftPlayers.map(p => p.id));
    const before  = lobbyRealPlayers.length;
    lobbyRealPlayers = lobbyRealPlayers.filter(p => !leftIds.has(p.id));
    const hostLeft = leftPlayers.some(p => p.isHost);
    if (hostLeft && !isHost && !gameRunning) dbDeleteRoom();
    if (lobbyRealPlayers.length !== before) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  };

  net.onPlayerHello = ({ id, name, isHost: pIsHost }) => {
    if (id === net.myId) return;
    if (!lobbyRealPlayers.find(p => p.id === id)) {
      lobbyRealPlayers.push({ id, name, isHost: pIsHost });
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

  net.onAIUpdate          = ({ aiPlayers }) => { lobbyAIPlayers = aiPlayers ?? []; renderSlots(); };
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

  lobbyRealPlayers = net.getPresencePlayers().filter(p => p.id !== net.myId);
  renderSlots();

  setTimeout(() => {
    lobbyRealPlayers = net.getPresencePlayers().filter(p => p.id !== net.myId);
    renderSlots();
  }, 800);

  // Periodic presence refresh to catch missed leave events
  setInterval(() => {
    if (gameRunning) return;
    const freshIds = new Set(net.getPresencePlayers().map(p => p.id));
    const before   = lobbyRealPlayers.length;
    lobbyRealPlayers = lobbyRealPlayers.filter(p => freshIds.has(p.id));
    if (lobbyRealPlayers.length !== before) {
      renderSlots();
      if (isHost && !isPrivate) dbUpdatePlayerCount(allPlayers().filter(p => !p.isAI).length);
    }
  }, 4000);
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
  showSection('lobby');
  renderSlots();
  if (isHost) {
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
