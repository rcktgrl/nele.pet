import { TILE, BOMB_FUSE } from './game.js';

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
  // Active napalm fire
  for (const [key] of state.napalmFires) s.add(key);

  // Predicted blast zones of live bombs
  for (const [, bomb] of state.bombs) {
    if (bomb.exploded) continue;
    s.add(`${bomb.tileX},${bomb.tileY}`);
    for (const { dx, dy } of DIRS) {
      for (let r = 1; r <= bomb.range; r++) {
        const nx = bomb.tileX + dx * r;
        const ny = bomb.tileY + dy * r;
        if (nx < 0 || nx >= state.gridW || ny < 0 || ny >= state.gridH) break;
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

    this.lastMoveTime = 0;
    this.lastBombTime = 0;
    this.moveInterval  = 310 + Math.random() * 120;  // ~300–430 ms
    this.bombCooldown  = 2200 + Math.random() * 900; // ~2.2–3.1 s

    this.preferredDir = DIRS[Math.floor(Math.random() * 4)];
    this.stickCount   = 0;

    // Tracks tiles that recently exploded; value is the timestamp after which
    // the tile is considered safe again (explosion end + 100–500 ms randomised).
    this.recentlyExplodedTiles = new Map(); // 'x,y' → safeAt (ms)
  }

  #isTileWalkable(state, x, y, dangerSet, skipDanger = false) {
    if (x < 0 || x >= state.gridW || y < 0 || y >= state.gridH) return false;
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
      if (nx < 0 || nx >= state.gridW || ny < 0 || ny >= state.gridH) continue;
      if (state.map[ny][nx] === TILE.BRICK) return true;
      for (const [id, p] of state.players) {
        if (id !== this.id && p.alive && p.tileX === nx && p.tileY === ny) return true;
      }
    }
    return false;
  }

  #tryMove(state, me, now, net, dangerSet, allowDangerous = false) {
    const dirs = shuffle(DIRS);

    if (dangerSet.has(`${me.tileX},${me.tileY}`)) {
      for (const d of dirs) {
        const nx = me.tileX + d.dx, ny = me.tileY + d.dy;
        if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
          this.#doMove(state, me, nx, ny, now, net, d); return true;
        }
      }
      if (allowDangerous) {
        for (const d of dirs) {
          const nx = me.tileX + d.dx, ny = me.tileY + d.dy;
          if (this.#isTileWalkable(state, nx, ny, dangerSet, true)) {
            this.#doMove(state, me, nx, ny, now, net, d); return true;
          }
        }
      }
      return false;
    }

    if (this.stickCount > 0) {
      const nx = me.tileX + this.preferredDir.dx;
      const ny = me.tileY + this.preferredDir.dy;
      if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
        this.#doMove(state, me, nx, ny, now, net, this.preferredDir);
        this.stickCount--; return true;
      }
    }

    for (const d of dirs) {
      const nx = me.tileX + d.dx, ny = me.tileY + d.dy;
      if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
        this.#doMove(state, me, nx, ny, now, net, d);
        this.preferredDir = d;
        this.stickCount   = 2 + Math.floor(Math.random() * 4);
        return true;
      }
    }
    return false;
  }

  #doMove(state, me, nx, ny, now, net, dir) {
    me.startMove(nx, ny, now);
    net.sendAnyMove(this.id, nx, ny);
  }

  update(state, now, net, scheduleBombExplosion) {
    const me = state.players.get(this.id);
    if (!me || !me.alive) return;

    const dangerSet = buildDangerSet(state);

    // ── Post-explosion cooldown ──────────────────────────────────────────────
    // For every active explosion tile, register a randomised cool-down window
    // that starts when the explosion visual ends (dieAt) and lasts an extra
    // 100–500 ms so the AI doesn't immediately walk back through hot tiles.
    for (const exp of state.explosions) {
      for (const t of exp.tiles) {
        const key = `${t.x},${t.y}`;
        if (!this.recentlyExplodedTiles.has(key)) {
          const safeAt = exp.dieAt + 100 + Math.random() * 400;
          this.recentlyExplodedTiles.set(key, safeAt);
        }
      }
    }
    // Purge expired entries; keep still-cooling tiles in the danger set.
    for (const [key, safeAt] of this.recentlyExplodedTiles) {
      if (safeAt <= now) {
        this.recentlyExplodedTiles.delete(key);
      } else {
        dangerSet.add(key);
      }
    }

    const inDanger  = dangerSet.has(`${me.tileX},${me.tileY}`);

    if (
      !inDanger &&
      me.activeBombs < me.maxBombs &&
      now - this.lastBombTime > this.bombCooldown &&
      this.#hasAdjacentTarget(state, me)
    ) {
      const bombId     = crypto.randomUUID();
      const explodesAt = Date.now() + BOMB_FUSE;
      state.addBomb(bombId, this.id, me.tileX, me.tileY, explodesAt, me.bombRange);
      net.sendAnyBomb(bombId, this.id, me.tileX, me.tileY, explodesAt, me.bombRange);
      scheduleBombExplosion(bombId, BOMB_FUSE);
      this.lastBombTime = now;
      dangerSet.add(`${me.tileX},${me.tileY}`);
    }

    if (now - this.lastMoveTime > this.moveInterval) {
      const moved = this.#tryMove(state, me, now, net, dangerSet)
                 || this.#tryMove(state, me, now, net, dangerSet, true);
      if (moved) this.lastMoveTime = now;
    }
  }
}
