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
  for (const exp of state.explosions) {
    for (const t of exp.tiles) s.add(`${t.x},${t.y}`);
  }
  for (const [key] of state.napalmFires) s.add(key);
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
    this.moveInterval  = 155 + Math.random() * 60;  // ~150–215 ms (2x faster)
    this.bombCooldown  = 2200 + Math.random() * 900;

    this.preferredDir = DIRS[Math.floor(Math.random() * 4)];
    this.stickCount   = 0;

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

  // BFS to find the first-step direction toward the nearest safe tile.
  // Traverses through dangerous tiles (to find a path out) but not walls/bricks.
  #findEscapeDir(state, startX, startY, dangerSet) {
    const visited = new Set([`${startX},${startY}`]);
    const queue = [];

    for (const d of DIRS) {
      const nx = startX + d.dx, ny = startY + d.dy;
      if (!this.#isTileWalkable(state, nx, ny, dangerSet, true)) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny, firstDir: d });
    }

    while (queue.length > 0) {
      const { x, y, firstDir } = queue.shift();
      if (!dangerSet.has(`${x},${y}`)) return firstDir; // reached safety

      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (!this.#isTileWalkable(state, nx, ny, dangerSet, true)) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny, firstDir });
      }
    }
    return null; // definitely dead — no escape exists
  }

  // BFS to find the first-step direction toward the nearest reachable power-up.
  // Never walks through danger.
  #findPowerupDir(state, startX, startY, dangerSet) {
    if (!state.powerups || state.powerups.size === 0) return null;

    const visited = new Set([`${startX},${startY}`]);
    const queue = [{ x: startX, y: startY, firstDir: null }];

    while (queue.length > 0) {
      const { x, y, firstDir } = queue.shift();

      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (!this.#isTileWalkable(state, nx, ny, dangerSet)) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const dir = firstDir ?? d;
        if (state.powerups.has(key)) return dir;
        queue.push({ x: nx, y: ny, firstDir: dir });
      }
    }
    return null;
  }

  // Returns true if placing a bomb at (bx, by) with bombRange still leaves an
  // escape route from the AI's current position.
  #canEscapeAfterPlacingBomb(state, me, bx, by, bombRange) {
    // Build hypothetical danger set that includes the new bomb's blast
    const hypoD = buildDangerSet(state);
    hypoD.add(`${bx},${by}`);
    for (const { dx, dy } of DIRS) {
      for (let r = 1; r <= bombRange; r++) {
        const nx = bx + dx * r, ny = by + dy * r;
        if (nx < 0 || nx >= state.gridW || ny < 0 || ny >= state.gridH) break;
        const t = state.map[ny][nx];
        if (t === TILE.WALL) break;
        hypoD.add(`${nx},${ny}`);
        if (t === TILE.BRICK) break;
      }
    }

    // BFS from current position, treating the new bomb tile as impassable,
    // looking for any tile not in the hypothetical danger set.
    const visited = new Set([`${me.tileX},${me.tileY}`]);
    const queue   = [{ x: me.tileX, y: me.tileY }];

    while (queue.length > 0) {
      const { x, y } = queue.shift();
      if (!hypoD.has(`${x},${y}`)) return true;

      for (const { dx, dy } of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= state.gridW || ny < 0 || ny >= state.gridH) continue;
        const t = state.map[ny][nx];
        if (t === TILE.WALL || t === TILE.BRICK) continue;
        // New bomb blocks the tile it sits on
        if (nx === bx && ny === by) continue;
        let hasBomb = false;
        for (const [, bomb] of state.bombs) {
          if (!bomb.exploded && bomb.tileX === nx && bomb.tileY === ny) { hasBomb = true; break; }
        }
        if (hasBomb) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    return false; // definitely trapped
  }

  #tryMove(state, me, now, net, dangerSet, allowDangerous = false) {
    if (dangerSet.has(`${me.tileX},${me.tileY}`)) {
      // Use BFS to find the optimal escape direction
      const escapeDir = this.#findEscapeDir(state, me.tileX, me.tileY, dangerSet);
      if (escapeDir) {
        const nx = me.tileX + escapeDir.dx, ny = me.tileY + escapeDir.dy;
        this.#doMove(state, me, nx, ny, now, net);
        return true;
      }
      // Definitely dead — no safe path exists. Try any passable tile as last resort.
      if (allowDangerous) {
        for (const d of shuffle(DIRS)) {
          const nx = me.tileX + d.dx, ny = me.tileY + d.dy;
          if (this.#isTileWalkable(state, nx, ny, dangerSet, true)) {
            this.#doMove(state, me, nx, ny, now, net);
            return true;
          }
        }
      }
      return false;
    }

    // Not in danger — seek power-ups first via BFS
    const puDir = this.#findPowerupDir(state, me.tileX, me.tileY, dangerSet);
    if (puDir) {
      const nx = me.tileX + puDir.dx, ny = me.tileY + puDir.dy;
      if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
        this.#doMove(state, me, nx, ny, now, net);
        this.preferredDir = puDir;
        this.stickCount   = 0;
        return true;
      }
    }

    if (this.stickCount > 0) {
      const nx = me.tileX + this.preferredDir.dx;
      const ny = me.tileY + this.preferredDir.dy;
      if (this.#isTileWalkable(state, nx, ny, dangerSet)) {
        this.#doMove(state, me, nx, ny, now, net);
        this.stickCount--; return true;
      }
    }

    for (const d of shuffle(DIRS)) {
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

  #doMove(state, me, nx, ny, now, net) {
    me.startMove(nx, ny, now);
    net.sendAnyMove(this.id, nx, ny);
    const pu = state.collectPowerup(this.id, nx, ny);
    if (pu) net.sendAnyPowerupCollected(this.id, nx, ny);
  }

  update(state, now, net, scheduleBombExplosion, awardScore = null) {
    const me = state.players.get(this.id);
    if (!me || !me.alive) return;

    const dangerSet = buildDangerSet(state);

    // Post-explosion cooldown
    for (const exp of state.explosions) {
      for (const t of exp.tiles) {
        const key = `${t.x},${t.y}`;
        if (!this.recentlyExplodedTiles.has(key)) {
          const safeAt = exp.dieAt + 100 + Math.random() * 400;
          this.recentlyExplodedTiles.set(key, safeAt);
        }
      }
    }
    for (const [key, safeAt] of this.recentlyExplodedTiles) {
      if (safeAt <= now) {
        this.recentlyExplodedTiles.delete(key);
      } else {
        dangerSet.add(key);
      }
    }

    const inDanger = dangerSet.has(`${me.tileX},${me.tileY}`);

    if (
      !inDanger &&
      me.activeBombs < me.maxBombs &&
      now - this.lastBombTime > this.bombCooldown &&
      this.#hasAdjacentTarget(state, me) &&
      this.#canEscapeAfterPlacingBomb(state, me, me.tileX, me.tileY, me.bombRange)
    ) {
      let bombType = 'normal';
      if (me.specialBomb) {
        bombType = me.specialBomb === 'napalm' ? 'napalm' : 'box';
        me.specialBomb = null;
        if (awardScore) awardScore(this.id, 10);
      }

      const bombId     = crypto.randomUUID();
      const explodesAt = Date.now() + BOMB_FUSE;
      state.addBomb(bombId, this.id, me.tileX, me.tileY, explodesAt, me.bombRange, bombType);
      net.sendAnyBomb(bombId, this.id, me.tileX, me.tileY, explodesAt, me.bombRange, bombType);
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
