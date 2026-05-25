// ─── Constants ────────────────────────────────────────────────────────────────
export const TILE = Object.freeze({ WALL: 0, BRICK: 1, EMPTY: 2 });
export const TILE_SIZE   = 40;
export const GRID_W      = 15;   // default (complexity 0)
export const GRID_H      = 13;
export const BOMB_FUSE   = 3000; // ms until explosion
export const EXPLODE_DUR = 600;  // ms explosion lingers

export const PLAYER_COLORS = ['#00e5ff', '#ff4081', '#ffea00', '#69ff47'];

// Complexity levels
export const COMPLEXITY_GRIDS = [
  { w: 15, h: 13 },   // 0 – Normal
  { w: 21, h: 17 },   // 1 – Large
  { w: 27, h: 21 },   // 2 – Huge
];

// Power-up types
export const PU = Object.freeze({
  RANGE:    'range',
  BOMB:     'bomb',
  NAPALM:   'napalm',
  BOX_BOMB: 'box_bomb',
});

// Bomb types
export const BOMB_TYPE = Object.freeze({
  NORMAL: 'normal',
  NAPALM: 'napalm',
  BOX:    'box',
});

// ─── Dynamic helpers ──────────────────────────────────────────────────────────
export function getPlayerStarts(gridW, gridH) {
  return [[1, 1], [gridW - 2, 1], [1, gridH - 2], [gridW - 2, gridH - 2]];
}

function getClearZones(gridW, gridH) {
  const gw = gridW - 2, gh = gridH - 2;
  return new Set([
    '1,1', '2,1', '1,2',
    `${gw},1`, `${gw - 1},1`, `${gw},2`,
    `1,${gh}`, `2,${gh}`, `1,${gh - 1}`,
    `${gw},${gh}`, `${gw - 1},${gh}`, `${gw},${gh - 1}`,
  ]);
}

// ─── Seeded RNG (LCG) ────────────────────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ─── Map Generation ───────────────────────────────────────────────────────────
export function createMap(seed, gridW = GRID_W, gridH = GRID_H) {
  const rng        = makeRng(seed);
  const clearZones = getClearZones(gridW, gridH);
  const map        = Array.from({ length: gridH }, (_, y) =>
    Array.from({ length: gridW }, (_, x) => {
      if (x === 0 || x === gridW - 1 || y === 0 || y === gridH - 1) return TILE.WALL;
      if (x % 2 === 0 && y % 2 === 0) return TILE.WALL;
      return TILE.EMPTY;
    })
  );
  for (let y = 1; y < gridH - 1; y++) {
    for (let x = 1; x < gridW - 1; x++) {
      if (map[y][x] === TILE.EMPTY && !clearZones.has(`${x},${y}`) && rng() < 0.60)
        map[y][x] = TILE.BRICK;
    }
  }
  return map;
}

// Deterministic power-up from brick position (same on all clients)
function brickDropsPowerup(x, y) {
  const n = (x * 31 + y * 17) % 15;
  if (n < 2) return PU.RANGE;
  if (n < 4) return PU.BOMB;
  if (n < 5) return PU.NAPALM;    // ~7 %
  if (n < 6) return PU.BOX_BOMB;  // ~7 %
  return null;
}

// ─── Player ───────────────────────────────────────────────────────────────────
export class Player {
  constructor(id, name, tileX, tileY, colorIdx) {
    this.id           = id;
    this.name         = name;
    this.tileX        = tileX;
    this.tileY        = tileY;
    this.renderX      = tileX * TILE_SIZE;
    this.renderY      = tileY * TILE_SIZE;
    this.animFromX    = this.renderX;
    this.animFromY    = this.renderY;
    this.animStart    = 0;
    this.colorIdx     = colorIdx;
    this.color        = PLAYER_COLORS[colorIdx];
    this.alive        = true;
    this.bombRange    = 2;
    this.maxBombs     = 1;
    this.activeBombs  = 0;
    this.specialBomb  = null; // null | 'napalm' | 'box'
  }

  startMove(newTileX, newTileY, now) {
    this.animFromX = this.renderX;
    this.animFromY = this.renderY;
    this.animStart = now;
    this.tileX     = newTileX;
    this.tileY     = newTileY;
  }

  updateRender(now) {
    const t      = Math.min(1, (now - this.animStart) / 100);
    this.renderX = this.animFromX + (this.tileX * TILE_SIZE - this.animFromX) * t;
    this.renderY = this.animFromY + (this.tileY * TILE_SIZE - this.animFromY) * t;
  }
}

// ─── GameState ────────────────────────────────────────────────────────────────
export class GameState {
  constructor() {
    this.map             = null;
    this.gridW           = GRID_W;
    this.gridH           = GRID_H;
    this.players         = new Map();
    this.bombs           = new Map();
    this.explosions      = [];
    this.powerups        = new Map();
    this.napalmFires     = new Map(); // 'x,y' → {x,y,dieAt}
    this.bricksDestroyed = 0;
  }

  init(map2d, playerList, gridW = GRID_W, gridH = GRID_H) {
    this.gridW           = gridW;
    this.gridH           = gridH;
    this.map             = map2d.map(r => [...r]);
    this.bricksDestroyed = 0;
    this.players.clear();
    this.bombs.clear();
    this.explosions      = [];
    this.powerups.clear();
    this.napalmFires.clear();

    const starts = getPlayerStarts(gridW, gridH);
    playerList.forEach((p, i) => {
      const [tx, ty] = starts[i];
      this.players.set(p.id, new Player(p.id, p.name, tx, ty, i));
    });
  }

  canMoveTo(x, y, myId) {
    if (x < 0 || x >= this.gridW || y < 0 || y >= this.gridH) return false;
    const tile = this.map[y][x];
    if (tile === TILE.WALL || tile === TILE.BRICK) return false;
    const now = Date.now();
    for (const [, bomb] of this.bombs) {
      if (bomb.tileX === x && bomb.tileY === y) {
        const age = now - (bomb.explodesAt - BOMB_FUSE);
        if (bomb.placedBy === myId && age < 400) continue;
        return false;
      }
    }
    return true;
  }

  getBombAt(x, y) {
    for (const [, b] of this.bombs) {
      if (!b.exploded && b.tileX === x && b.tileY === y) return b;
    }
    return null;
  }

  /** Slide bomb in direction (dx,dy); returns {newTileX,newTileY} or null. */
  kickBomb(bombId, dx, dy) {
    const bomb = this.bombs.get(bombId);
    if (!bomb || bomb.exploded) return null;

    let nx = bomb.tileX;
    let ny = bomb.tileY;

    while (true) {
      const cx = nx + dx;
      const cy = ny + dy;
      if (cx < 0 || cx >= this.gridW || cy < 0 || cy >= this.gridH) break;
      const tile = this.map[cy][cx];
      if (tile === TILE.WALL || tile === TILE.BRICK) break;
      let blocked = false;
      for (const [, b] of this.bombs) {
        if (b !== bomb && !b.exploded && b.tileX === cx && b.tileY === cy) {
          blocked = true; break;
        }
      }
      if (blocked) break;
      nx = cx; ny = cy;
    }

    if (nx === bomb.tileX && ny === bomb.tileY) return null; // can't move

    bomb.slideFrom = { x: bomb.tileX, y: bomb.tileY, time: Date.now() };
    bomb.tileX = nx;
    bomb.tileY = ny;
    return { newTileX: nx, newTileY: ny };
  }

  /** Apply a kick received from network. */
  moveBomb(bombId, newTileX, newTileY) {
    const bomb = this.bombs.get(bombId);
    if (!bomb || bomb.exploded) return;
    bomb.slideFrom = { x: bomb.tileX, y: bomb.tileY, time: Date.now() };
    bomb.tileX = newTileX;
    bomb.tileY = newTileY;
  }

  addBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type = BOMB_TYPE.NORMAL) {
    this.bombs.set(bombId, {
      id: bombId, placedBy, tileX, tileY,
      explodesAt, range, type,
      exploded: false, slideFrom: null,
    });
    const owner = this.players.get(placedBy);
    if (owner) owner.activeBombs++;
  }

  /** Explode a bomb. Returns result object or null. */
  explodeBomb(bombId) {
    const bomb = this.bombs.get(bombId);
    if (!bomb || bomb.exploded) return null;
    bomb.exploded = true;
    this.bombs.delete(bombId);

    const isNapalm = bomb.type === BOMB_TYPE.NAPALM;
    const isBox    = bomb.type === BOMB_TYPE.BOX;

    const center = { x: bomb.tileX, y: bomb.tileY };
    const tiles  = [center];
    const destroyedBricks = [];
    const chainIds        = [];

    const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of DIRS) {
      for (let r = 1; r <= bomb.range; r++) {
        const nx = bomb.tileX + dx * r;
        const ny = bomb.tileY + dy * r;
        if (nx < 0 || nx >= this.gridW || ny < 0 || ny >= this.gridH) break;
        const tile = this.map[ny][nx];
        if (tile === TILE.WALL) break;
        tiles.push({ x: nx, y: ny });
        if (tile === TILE.BRICK) {
          if (!isBox) {
            this.map[ny][nx] = TILE.EMPTY;
            destroyedBricks.push({ x: nx, y: ny });
            this.bricksDestroyed++;
            const pu = brickDropsPowerup(nx, ny);
            if (pu) this.powerups.set(`${nx},${ny}`, pu);
          }
          break;
        }
        // Chain-explode any bomb in this tile
        for (const [bid, b] of this.bombs) {
          if (!b.exploded && b.tileX === nx && b.tileY === ny) chainIds.push(bid);
        }
      }
    }

    if (isBox) {
      // Create bricks at empty explosion tiles (skip player positions)
      const occupied = new Set();
      for (const [, p] of this.players) {
        if (p.alive) occupied.add(`${p.tileX},${p.tileY}`);
      }
      for (const { x, y } of tiles) {
        if (this.map[y][x] === TILE.EMPTY && !occupied.has(`${x},${y}`))
          this.map[y][x] = TILE.BRICK;
      }
      // No explosion visual, no fire
    } else {
      // Normal or napalm: standard explosion visual
      this.explosions.push({ tiles, dieAt: Date.now() + EXPLODE_DUR });

      if (isNapalm) {
        const dieAt = Date.now() + 2000;
        for (const { x, y } of tiles) {
          this.napalmFires.set(`${x},${y}`, { x, y, dieAt });
        }
      }
    }

    const owner = this.players.get(bomb.placedBy);
    if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);

    for (const cid of chainIds) this.explodeBomb(cid);

    return { tiles, destroyedBricks, isNapalm, isBox };
  }

  /** Spread napalm fire to adjacent empty tiles (called ~600ms after explosion). */
  spreadNapalm(sourceTiles, dieAt) {
    const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const { x, y } of sourceTiles) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= this.gridW || ny < 0 || ny >= this.gridH) continue;
        const key = `${nx},${ny}`;
        if (this.napalmFires.has(key)) continue;
        const tile = this.map[ny][nx];
        if (tile !== TILE.WALL && tile !== TILE.BRICK)
          this.napalmFires.set(key, { x: nx, y: ny, dieAt });
      }
    }
  }

  isPlayerInExplosion(player) {
    return this.explosions.some(e =>
      e.tiles.some(t => t.x === player.tileX && t.y === player.tileY)
    );
  }

  isPlayerInFire(player) {
    return this.napalmFires.has(`${player.tileX},${player.tileY}`);
  }

  collectPowerup(playerId, tileX, tileY) {
    const key  = `${tileX},${tileY}`;
    const type = this.powerups.get(key);
    if (!type) return null;
    this.powerups.delete(key);
    const player = this.players.get(playerId);
    if (!player) return null;
    if (type === PU.RANGE)    player.bombRange   = Math.min(player.bombRange + 1, 7);
    if (type === PU.BOMB)     player.maxBombs    = Math.min(player.maxBombs  + 1, 5);
    if (type === PU.NAPALM)   player.specialBomb = 'napalm';
    if (type === PU.BOX_BOMB) player.specialBomb = 'box';
    return type;
  }

  update() {
    const now = Date.now();
    this.explosions = this.explosions.filter(e => e.dieAt > now);
    for (const [key, f] of this.napalmFires) {
      if (f.dieAt <= now) this.napalmFires.delete(key);
    }
  }

  getAlivePlayers() {
    return [...this.players.values()].filter(p => p.alive);
  }
}
