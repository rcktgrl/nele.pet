// ─── Constants ────────────────────────────────────────────────────────────────
export const TILE = Object.freeze({ WALL: 0, BRICK: 1, EMPTY: 2 });
export const TILE_SIZE  = 40;
export const GRID_W     = 15;
export const GRID_H     = 13;
export const BOMB_FUSE  = 3000; // ms until explosion
export const EXPLODE_DUR = 600; // ms explosion lingers

export const PLAYER_COLORS  = ['#00e5ff', '#ff4081', '#ffea00', '#69ff47'];
export const PLAYER_STARTS  = [[1,1],[13,1],[1,11],[13,11]];

// Power-up type constants (stored in powerups Map by tile key)
export const PU = Object.freeze({ RANGE: 'range', BOMB: 'bomb' });

// Tiles adjacent to player spawn corners that must stay clear
const CLEAR_ZONES = new Set([
  '1,1','2,1','1,2',
  '13,1','12,1','13,2',
  '1,11','2,11','1,10',
  '13,11','12,11','13,10',
]);

// ─── Seeded RNG (LCG) ────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ─── Map Generation ───────────────────────────────────────────────────────────
export function createMap(seed) {
  const rng = makeRng(seed);
  const map = Array.from({ length: GRID_H }, (_, y) =>
    Array.from({ length: GRID_W }, (_, x) => {
      if (x === 0 || x === GRID_W - 1 || y === 0 || y === GRID_H - 1) return TILE.WALL;
      if (x % 2 === 0 && y % 2 === 0) return TILE.WALL;
      return TILE.EMPTY;
    })
  );

  // Scatter destructible bricks, keeping spawn corners clear
  for (let y = 1; y < GRID_H - 1; y++) {
    for (let x = 1; x < GRID_W - 1; x++) {
      if (map[y][x] === TILE.EMPTY && !CLEAR_ZONES.has(`${x},${y}`) && rng() < 0.60) {
        map[y][x] = TILE.BRICK;
      }
    }
  }
  return map;
}

// Deterministic power-up from brick position (same result on all clients)
function brickDropsPowerup(x, y) {
  const n = (x * 31 + y * 17) % 10;
  if (n < 2) return PU.RANGE;
  if (n < 4) return PU.BOMB;
  return null;
}

// ─── Player ───────────────────────────────────────────────────────────────────
export class Player {
  constructor(id, name, tileX, tileY, colorIdx) {
    this.id       = id;
    this.name     = name;
    this.tileX    = tileX;
    this.tileY    = tileY;
    // Visual interpolation
    this.renderX  = tileX * TILE_SIZE;
    this.renderY  = tileY * TILE_SIZE;
    this.animFromX = this.renderX;
    this.animFromY = this.renderY;
    this.animStart = 0;
    // Stats
    this.colorIdx  = colorIdx;
    this.color     = PLAYER_COLORS[colorIdx];
    this.alive     = true;
    this.bombRange = 2;
    this.maxBombs  = 1;
    this.activeBombs = 0;
  }

  startMove(newTileX, newTileY, now) {
    this.animFromX = this.renderX;
    this.animFromY = this.renderY;
    this.animStart = now;
    this.tileX = newTileX;
    this.tileY = newTileY;
  }

  updateRender(now) {
    const ANIM = 100; // ms
    const t    = Math.min(1, (now - this.animStart) / ANIM);
    this.renderX = this.animFromX + (this.tileX * TILE_SIZE - this.animFromX) * t;
    this.renderY = this.animFromY + (this.tileY * TILE_SIZE - this.animFromY) * t;
  }
}

// ─── GameState ────────────────────────────────────────────────────────────────
export class GameState {
  constructor() {
    this.map       = null;           // number[][]
    this.players   = new Map();      // id → Player
    this.bombs     = new Map();      // bombId → bomb object
    this.explosions = [];            // { tiles, dieAt }[]
    this.powerups  = new Map();      // `x,y` → PU type
  }

  /** Called by both host and clients once map + player order are known */
  init(map2d, playerList) {
    this.map = map2d.map(r => [...r]);
    this.players.clear();
    this.bombs.clear();
    this.explosions = [];
    this.powerups.clear();

    playerList.forEach((p, i) => {
      const [tx, ty] = PLAYER_STARTS[i];
      this.players.set(p.id, new Player(p.id, p.name, tx, ty, i));
    });
  }

  /** Check if a tile is walkable (ignores bombs placed by myId in the last 400ms) */
  canMoveTo(x, y, myId) {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false;
    const tile = this.map[y][x];
    if (tile === TILE.WALL || tile === TILE.BRICK) return false;
    const now = Date.now();
    for (const [, bomb] of this.bombs) {
      if (bomb.tileX === x && bomb.tileY === y) {
        // Own bomb is passable for 400ms after placement (player can step off)
        const age = now - (bomb.explodesAt - BOMB_FUSE);
        if (bomb.placedBy === myId && age < 400) continue;
        return false;
      }
    }
    return true;
  }

  /** Register a bomb from any player */
  addBomb(bombId, placedBy, tileX, tileY, explodesAt, range) {
    this.bombs.set(bombId, { id: bombId, placedBy, tileX, tileY, explodesAt, range, exploded: false });
    // Increment the owner's active bomb counter
    const owner = this.players.get(placedBy);
    if (owner) owner.activeBombs++;
  }

  /** Trigger a bomb's explosion; returns { tiles, destroyedBricks } */
  explodeBomb(bombId) {
    const bomb = this.bombs.get(bombId);
    if (!bomb || bomb.exploded) return null;
    bomb.exploded = true;
    this.bombs.delete(bombId); // remove so it no longer blocks movement

    const center = { x: bomb.tileX, y: bomb.tileY };
    const tiles  = [center];
    const destroyedBricks = [];
    const chainIds = [];

    const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of DIRS) {
      for (let r = 1; r <= bomb.range; r++) {
        const nx = bomb.tileX + dx * r;
        const ny = bomb.tileY + dy * r;
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) break;

        const tile = this.map[ny][nx];
        if (tile === TILE.WALL) break;

        tiles.push({ x: nx, y: ny });

        if (tile === TILE.BRICK) {
          this.map[ny][nx] = TILE.EMPTY;
          destroyedBricks.push({ x: nx, y: ny });
          const pu = brickDropsPowerup(nx, ny);
          if (pu) this.powerups.set(`${nx},${ny}`, pu);
          break; // brick stops explosion spread
        }

        // Chain-explode any bomb in this tile
        for (const [bid, b] of this.bombs) {
          if (!b.exploded && b.tileX === nx && b.tileY === ny) chainIds.push(bid);
        }
      }
    }

    this.explosions.push({ tiles, dieAt: Date.now() + EXPLODE_DUR });

    // Decrement owner's counter
    const owner = this.players.get(bomb.placedBy);
    if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);

    // Chain explosions (recursive, safe because `exploded` flag guards re-entry)
    for (const cid of chainIds) this.explodeBomb(cid);

    return { tiles, destroyedBricks };
  }

  /** Check if the given player is standing on an active explosion tile */
  isPlayerInExplosion(player) {
    for (const exp of this.explosions) {
      if (exp.tiles.some(t => t.x === player.tileX && t.y === player.tileY)) return true;
    }
    return false;
  }

  /** Collect a power-up for a player; returns type or null */
  collectPowerup(playerId, tileX, tileY) {
    const key  = `${tileX},${tileY}`;
    const type = this.powerups.get(key);
    if (!type) return null;
    this.powerups.delete(key);
    const player = this.players.get(playerId);
    if (!player) return null;
    if (type === PU.RANGE) player.bombRange = Math.min(player.bombRange + 1, 7);
    if (type === PU.BOMB)  player.maxBombs  = Math.min(player.maxBombs + 1, 5);
    return type;
  }

  /** Remove expired explosions */
  update() {
    const now = Date.now();
    this.explosions = this.explosions.filter(e => e.dieAt > now);
  }

  getAlivePlayers() {
    return [...this.players.values()].filter(p => p.alive);
  }
}
