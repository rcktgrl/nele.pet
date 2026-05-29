// scripts/global-sim.js
// Host-only authoritative game simulation.
// Owns the canonical GameState. Drives AI, schedules bomb explosions,
// detects deaths and game-end. Results are reported via callbacks so
// lobby.js can broadcast them to non-host clients.

import { GameState } from './game.js';

export class GlobalSimulation {
  constructor() {
    this.state     = new GameState();
    this.aiPlayers = [];   // AIPlayer instances (set before each round)
    this.running   = false;
    this._timers   = new Map(); // bombId → timeoutId

    // Per-round scoring
    this.deathOrder = [];
    this.gameScores = new Map(); // id → number

    // ── Callbacks (assigned by lobby.js before each round) ────────────────
    // onBombExploded(bombId, result, killedIds, powerups, totalBricksDestroyed)
    this.onBombExploded  = null;
    // onNapalmSpread(tiles, dieAt, killedIds)
    this.onNapalmSpread  = null;
    // onPlayerDead(id)
    this.onPlayerDead    = null;
    // onGameEnd(winnerId | null)
    this.onGameEnd       = null;
    // onAIMove(id, tileX, tileY)
    this.onAIMove        = null;
    // onAIBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type)
    this.onAIBomb        = null;
    // onAIPowerup(playerId, tileX, tileY)
    this.onAIPowerup     = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  setAI(aiPlayers) {
    this.aiPlayers = aiPlayers;
  }

  init(map, playerOrder, gridW, gridH) {
    this.state.init(map, playerOrder, gridW, gridH);
    this.running    = true;
    this.deathOrder = [];
    this.gameScores = new Map();
    for (const [id] of this.state.players) this.gameScores.set(id, 0);
    for (const [, t] of this._timers) clearTimeout(t);
    this._timers.clear();
  }

  stop() {
    this.running = false;
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
  }

  awardScore(id, pts) {
    if (!id || pts <= 0) return;
    this.gameScores.set(id, (this.gameScores.get(id) ?? 0) + pts);
  }

  // ── Frame update (called every animation frame by the host's game loop) ──
  update(now) {
    if (!this.running) return;

    const netShim = this._makeAIShim(now);
    for (const ai of this.aiPlayers) {
      ai.update(
        this.state, now, netShim,
        // scheduleBombExplosion callback – delay already set via explodesAt
        (bombId, delay) => this._scheduleBomb(bombId, delay),
        (id, pts) => this.awardScore(id, pts),
      );
    }

    this._checkNapalmDeaths();
    this.state.update(); // prune expired explosions / fires
  }

  // Update all player render positions (called each frame before rendering)
  updateRender(now) {
    for (const [, p] of this.state.players) p.updateRender(now);
  }

  // ── Player actions ────────────────────────────────────────────────────────
  applyMove(id, tileX, tileY, now) {
    const p = this.state.players.get(id);
    if (p) p.startMove(tileX, tileY, now ?? Date.now());
  }

  applyBombPlace(bombId, placedBy, tileX, tileY, explodesAt, range, type) {
    this.state.addBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type);
    const delay = Math.max(0, explodesAt - Date.now());
    this._scheduleBomb(bombId, delay);
  }

  applyBombKick(bombId, newTileX, newTileY) {
    this.state.moveBomb(bombId, newTileX, newTileY);
  }

  applyPowerupCollect(playerId, tileX, tileY) {
    return this.state.collectPowerup(playerId, tileX, tileY);
  }

  // ── Internal ──────────────────────────────────────────────────────────────
  _scheduleBomb(bombId, delay) {
    if (this._timers.has(bombId)) return;
    const t = setTimeout(() => {
      this._timers.delete(bombId);
      this._triggerExplosion(bombId);
    }, delay);
    this._timers.set(bombId, t);
  }

  _triggerExplosion(bombId) {
    if (!this.running) return;
    const bomb = this.state.bombs.get(bombId);
    if (!bomb) return;
    const owner  = bomb.placedBy ?? null;
    const result = this.state.explodeBomb(bombId);
    if (!result) return;

    // Score: bricks destroyed
    if (!result.isBox && owner) {
      this.awardScore(owner, result.destroyedBricks.length);
    }

    // Build powerup list from destroyed bricks (deterministic, same as game.js)
    const powerups = [];
    for (const { x, y } of result.destroyedBricks) {
      const type = this.state.powerups.get(`${x},${y}`);
      if (type) powerups.push({ x, y, type });
    }

    // Detect killed players
    const killedIds = [];
    for (const [id, player] of this.state.players) {
      if (!player.alive) continue;
      if (this.state.isPlayerInExplosion(player) || this.state.isPlayerInFire(player)) {
        player.alive = false;
        killedIds.push(id);
        this.deathOrder.push(id);
        if (owner && id !== owner) this.awardScore(owner, 20);
      }
    }
    for (const id of killedIds) this.onPlayerDead?.(id);

    this.onBombExploded?.(bombId, result, killedIds, powerups, this.state.bricksDestroyed);

    // Schedule napalm spread
    if (result.isNapalm) {
      const spreadTiles = [...result.tiles];
      const spreadDieAt = Date.now() + 2000;
      setTimeout(() => {
        if (!this.running) return;
        this.state.spreadNapalm(spreadTiles, spreadDieAt);
        const napalmKilledIds = this._drainNapalmDeaths();
        this.onNapalmSpread?.(spreadTiles, spreadDieAt, napalmKilledIds);
        for (const id of napalmKilledIds) this.onPlayerDead?.(id);
        this._checkGameEnd();
      }, 600);
    }

    this._checkGameEnd();
  }

  _checkNapalmDeaths() {
    const killed = this._drainNapalmDeaths();
    if (!killed.length) return;
    for (const id of killed) {
      this.onPlayerDead?.(id);
      this.onNapalmSpread?.([], 0, [id]); // piggyback dead id on a spread event
    }
    this._checkGameEnd();
  }

  _drainNapalmDeaths() {
    const killed = [];
    for (const [id, player] of this.state.players) {
      if (!player.alive) continue;
      if (this.state.isPlayerInFire(player)) {
        player.alive = false;
        killed.push(id);
        this.deathOrder.push(id);
      }
    }
    return killed;
  }

  _checkGameEnd() {
    if (!this.running) return;
    const alive = this.state.getAlivePlayers();
    if (alive.length <= 1) {
      this.running = false;
      this.onGameEnd?.(alive[0]?.id ?? null);
    }
  }

  // Shim passed to AIPlayer.update() so AI side-effects feed back to callbacks
  _makeAIShim(now) {
    return {
      sendAnyMove: (id, tx, ty) => {
        // AI already called player.startMove() on the shared state
        this.onAIMove?.(id, tx, ty);
      },
      sendAnyBomb: (bombId, placedBy, tx, ty, explodesAt, range, type) => {
        // AI already called state.addBomb(); explosion is scheduled via
        // the scheduleBombExplosion callback above.
        this.onAIBomb?.(bombId, placedBy, tx, ty, explodesAt, range, type);
      },
      sendAnyPlayerDead: () => {},             // handled in _triggerExplosion
      sendAnyPowerupCollected: (playerId, tx, ty) => {
        // AI already called state.collectPowerup()
        this.onAIPowerup?.(playerId, tx, ty);
      },
    };
  }
}
