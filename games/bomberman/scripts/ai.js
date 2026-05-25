import { TILE, GRID_W, GRID_H, BOMB_FUSE } from './game.js';

export const BOT_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta'];

const DIRS = [
  { dx:  1, dy:  0 },
  { dx: -1, dy:  0 },
  { dx:  0, dy:  1 },
  { dx:  0, dy: -1 },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Danger map ───────────────────────────────────────────────────────────────
function buildDangerSet(state) {
  const s = new Set();
  // Active explosion tiles
  for (const exp of state.explosions) {
    for (const t of exp.tiles) s.add(`${t.x},${t.y}`);
  }
  // Predicted blast zones of all live bombs
  for (const [, bomb] of state.bombs) {
    if (bomb.exploded) continue;
    s.add(`${bomb.tileX},${bomb.tileY}`);
    for (const { dx, dy } of DIRS) {
      for (let r = 1; r <= bomb.range; r++) {
        const nx = bomb.tileX + dx * r;
        const ny = bomb.tileY + dy * r;
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) break;
        const t = state.map[ny][nx];
        if (t === TILE.WALL) break;
        s.add(`${nx},${ny}`);
        if (t === TILE.BRICK) break;
      }
    }
  }
  return s;
}

// ─── AIPlayer ─────────────────────────────────────────────────────────────────
export class AIPlayer {
  constructor(id, name) {
    this.id   = id;
    this.name = name;

    // Timing
    this.lastMoveTime = 0;
    this.lastBombTime = 0;
    this.moveInterval  = 310 + Math.random() * 120; // ~300–430 ms
    this.bombCooldown  = 2200 + Math.random() * 900; // ~2.2–3.1 s

    // Persistence across frames
    this.preferredDir  = DIRS[Math.floor(Math.random() * 4)];
    this.stickCount    = 0; // moves remaining in current direction
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  #isTileWalkable(state, x, y, dangerSet, skipDanger = false) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false;
    const t = state.map[y][x];
    if (t === TILE.WALL || t === TILE.BRICK) return false;
    for (const [, bomb] of state.bombs) {
      if (!bomb.exploded && bomb.tileX === x && bomb.tileY === y) return false;
    }
    if (!skipDanger && dangerSet.has(`${x},${y}`)) return false;
    return true;
  }

  #hasAdjacentTarget(state, me) {
    for (const { dx, dy } of DIRS) {
      const nx = me.tileX + dx;
      const ny = me.tileY + dy;
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
      if (state.map[ny][nx] === TILE.BRICK) return true;
      for (const [id, p] of state.players) {
        if (id !== this.id && p.alive && p.tileX === nx && p.tileY === ny) return true;
      }
    }
    return false;
  }

  // ── Move decision ─────────────────────────────────────────────────────────
  #tryMove(state, me, now, net, dangerSet, allowDangerous = false) {
    const dirs = shuffle(DIRS);

    // In dangerous tile: flee to any safe tile
    if (dangerSet.has(`${me.tileX},${me.tileY}`)) {
      for (const d of dirs) {
        const nx = me.tileX + d.dx;
        const ny = me.tileY + d.dy;
        if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
          this.#doMove(state, me, nx, ny, now, net, d);
          return true;
        }
      }
      if (allowDangerous) {
        // Cornered — take any walkable tile
        for (const d of dirs) {
          const nx = me.tileX + d.dx;
          const ny = me.tileY + d.dy;
          if (this.#isTileWalkable(state, nx, ny, dangerSet, true)) {
            this.#doMove(state, me, nx, ny, now, net, d);
            return true;
          }
        }
      }
      return false;
    }

    // Safe tile: try to continue in preferred direction
    if (this.stickCount > 0) {
      const nx = me.tileX + this.preferredDir.dx;
      const ny = me.tileY + this.preferredDir.dy;
      if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
        this.#doMove(state, me, nx, ny, now, net, this.preferredDir);
        this.stickCount--;
        return true;
      }
    }

    // Pick a new direction
    for (const d of dirs) {
      const nx = me.tileX + d.dx;
      const ny = me.tileY + d.dy;
      if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
        this.#doMove(state, me, nx, ny, now, net, d);
        this.preferredDir = d;
        this.stickCount = 2 + Math.floor(Math.random() * 4);
        return true;
      }
    }
    return false;
  }

  #doMove(state, me, nx, ny, now, net, dir) {
    me.startMove(nx, ny, now);
    net.sendAnyMove(this.id, nx, ny);
    // AI intentionally skips powerup collection (simpler, humans can grab them)
  }

  // ── Main update (called every game loop tick, host only) ──────────────────
  /**
   * @param {import('./game.js').GameState} state
   * @param {number} now - Date.now()
   * @param {import('./network.js').Network} net
   * @param {(bombId: string, delay: number) => void} scheduleBombExplosion
   */
  update(state, now, net, scheduleBombExplosion) {
    const me = state.players.get(this.id);
    if (!me || !me.alive) return;

    const dangerSet = buildDangerSet(state);
    const inDanger  = dangerSet.has(`${me.tileX},${me.tileY}`);

    // ── Maybe place a bomb ────────────────────────────────────────────────
    if (
      !inDanger &&
      me.activeBombs < me.maxBombs &&
      now - this.lastBombTime > this.bombCooldown &&
      this.#hasAdjacentTarget(state, me)
    ) {
      const bombId    = crypto.randomUUID();
      const explodesAt = Date.now() + BOMB_FUSE;
      state.addBomb(bombId, this.id, me.tileX, me.tileY, explodesAt, me.bombRange);
      net.sendAnyBomb(bombId, this.id, me.tileX, me.tileY, explodesAt, me.bombRange);
      scheduleBombExplosion(bombId, BOMB_FUSE);
      this.lastBombTime = now;
      // Rebuild danger so we immediately try to flee the bomb we just placed
      dangerSet.add(`${me.tileX},${me.tileY}`);
    }

    // ── Move ──────────────────────────────────────────────────────────────
    if (now - this.lastMoveTime > this.moveInterval) {
      const moved = this.#tryMove(state, me, now, net, dangerSet)
                 || this.#tryMove(state, me, now, net, dangerSet, true); // fallback: any tile
      if (moved) this.lastMoveTime = now;
    }
  }
}
