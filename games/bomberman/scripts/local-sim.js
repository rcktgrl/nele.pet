// scripts/local-sim.js
// Client-side game state that mirrors the host's global simulation.
// Applies authoritative events broadcast by the host; also applies the
// local player's own inputs immediately for responsive feedback.
// No death detection or game-end logic — those are the host's job.

import { GameState, TILE, EXPLODE_DUR } from './game.js';

export class LocalSimulation {
  constructor() {
    this.state   = new GameState();
    this.running = false;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  init(map, playerOrder, gridW, gridH) {
    this.state.init(map, playerOrder, gridW, gridH);
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  // ── Frame update (called every animation frame) ───────────────────────────
  update(now) {
    if (!this.running) return;
    for (const [, p] of this.state.players) p.updateRender(now);
    this.state.update(); // prune expired explosions / fires
  }

  // ── Player actions ────────────────────────────────────────────────────────
  // Apply immediately for the local player (prediction), and when receiving
  // move events from the network for remote players.
  applyMove(id, tileX, tileY, now) {
    const p = this.state.players.get(id);
    if (p) p.startMove(tileX, tileY, now ?? Date.now());
  }

  // Add a bomb to the local state. No explosion timer — the host decides when
  // it explodes and broadcasts the result via applyBombExploded.
  applyBombPlace(bombId, placedBy, tileX, tileY, explodesAt, range, type) {
    this.state.addBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type);
  }

  applyBombKick(bombId, newTileX, newTileY) {
    this.state.moveBomb(bombId, newTileX, newTileY);
  }

  // Apply the authoritative explosion result broadcast by the host.
  // tiles        – explosion-zone tiles (visual) or box-brick-creation tiles
  // destroyedBricks – bricks that were destroyed (empty for box bombs)
  // powerups     – [{x,y,type}] power-ups that appeared
  // isNapalm, isBox – bomb type flags
  // killedIds    – player IDs killed by this explosion
  applyBombExploded({ bombId, tiles, destroyedBricks, powerups, isNapalm, isBox, killedIds }) {
    // Remove bomb from local state (it may still be "pending" here)
    const bomb = this.state.bombs.get(bombId);
    if (bomb && !bomb.exploded) {
      bomb.exploded = true;
      this.state.bombs.delete(bombId);
      const owner = this.state.players.get(bomb.placedBy);
      if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
    }

    if (isBox) {
      // Box bomb creates bricks on empty tiles
      const occupied = new Set();
      for (const [, p] of this.state.players) {
        if (p.alive) occupied.add(`${p.tileX},${p.tileY}`);
      }
      for (const { x, y } of tiles) {
        if (this.state.map[y]?.[x] === TILE.EMPTY && !occupied.has(`${x},${y}`))
          this.state.map[y][x] = TILE.BRICK;
      }
    } else {
      // Destroy bricks
      for (const { x, y } of destroyedBricks) {
        if (this.state.map[y]) this.state.map[y][x] = TILE.EMPTY;
        this.state.bricksDestroyed++;
      }
      // Apply power-ups
      for (const { x, y, type } of (powerups ?? [])) {
        this.state.powerups.set(`${x},${y}`, type);
      }
      // Explosion visual
      this.state.explosions.push({ tiles, dieAt: Date.now() + EXPLODE_DUR });
      // Napalm fire
      if (isNapalm) {
        const dieAt = Date.now() + 2000;
        for (const { x, y } of tiles) {
          this.state.napalmFires.set(`${x},${y}`, { x, y, dieAt });
        }
      }
    }

    // Apply deaths
    for (const id of (killedIds ?? [])) {
      const p = this.state.players.get(id);
      if (p) p.alive = false;
    }
  }

  // Apply napalm fire spread broadcast by the host.
  applyNapalmSpread({ tiles, dieAt, killedIds }) {
    for (const { x, y } of (tiles ?? [])) {
      const key = `${x},${y}`;
      if (!this.state.napalmFires.has(key))
        this.state.napalmFires.set(key, { x, y, dieAt });
    }
    for (const id of (killedIds ?? [])) {
      const p = this.state.players.get(id);
      if (p) p.alive = false;
    }
  }

  // Mark a player dead (used for out-of-band deaths, e.g. continuous napalm)
  applyPlayerDead(id) {
    const p = this.state.players.get(id);
    if (p) p.alive = false;
  }

  applyPowerupCollect(playerId, tileX, tileY) {
    return this.state.collectPowerup(playerId, tileX, tileY);
  }

  // Reconcile a bomb's explodesAt with the host's authoritative value.
  applyBombAck(bombId, explodesAt) {
    const bomb = this.state.bombs.get(bombId);
    if (bomb) bomb.explodesAt = explodesAt;
  }
}
