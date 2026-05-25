import { TILE, TILE_SIZE, GRID_W, GRID_H, PU, BOMB_FUSE } from './game.js';

// Palette
const C = {
  bg:         '#0d1025',
  wall:       '#151830',
  wallBorder: '#0a0c1a',
  brick:      '#7a3a18',
  brickDark:  '#4d2410',
  empty:      '#1a1e3a',
  expOuter:   '#ff6a00',
  expInner:   '#ffdd00',
  bombBody:   '#1a1a2e',
  bombFuse:   '#ff3333',
  puRange:    '#00e5ff',
  puBomb:     '#ff4081',
  nameTag:    'rgba(0,0,0,0.75)',
  shadow:     'rgba(0,0,0,0.35)',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    canvas.width  = GRID_W * TILE_SIZE;
    canvas.height = GRID_H * TILE_SIZE;
  }

  // ── Map ────────────────────────────────────────────────────────────────────
  drawMap(map) {
    const { ctx } = this;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const px = x * TILE_SIZE, py = y * TILE_SIZE;
        const tile = map[y][x];
        if (tile === TILE.WALL) {
          ctx.fillStyle = C.wall;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = C.wallBorder;
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        } else if (tile === TILE.BRICK) {
          ctx.fillStyle = C.brick;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // cross-hatch detail
          ctx.strokeStyle = C.brickDark;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px + 6, py + 6);  ctx.lineTo(px + TILE_SIZE - 6, py + TILE_SIZE - 6);
          ctx.moveTo(px + TILE_SIZE - 6, py + 6); ctx.lineTo(px + 6, py + TILE_SIZE - 6);
          ctx.stroke();
          ctx.strokeStyle = C.brickDark;
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        } else {
          ctx.fillStyle = C.empty;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  // ── Power-ups ──────────────────────────────────────────────────────────────
  drawPowerups(powerups) {
    const { ctx } = this;
    const t = Date.now() / 600;
    for (const [key, type] of powerups) {
      const [x, y] = key.split(',').map(Number);
      const cx = x * TILE_SIZE + TILE_SIZE / 2;
      const cy = y * TILE_SIZE + TILE_SIZE / 2 + Math.sin(t + x + y) * 3;
      const r  = TILE_SIZE * 0.28;
      ctx.fillStyle = type === PU.RANGE ? C.puRange : C.puBomb;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle  = '#fff';
      ctx.font       = `bold 13px monospace`;
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(type === PU.RANGE ? '🔥' : '💣', cx, cy);
    }
  }

  // ── Explosions ─────────────────────────────────────────────────────────────
  drawExplosions(explosions) {
    const { ctx } = this;
    for (const exp of explosions) {
      const alpha = Math.max(0, (exp.dieAt - Date.now()) / 600);
      // Outer glow tiles
      ctx.fillStyle = `rgba(255,106,0,${alpha * 0.85})`;
      for (const { x, y } of exp.tiles) {
        ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      }
      // Bright core (first tile = bomb center)
      if (exp.tiles.length > 0) {
        const { x, y } = exp.tiles[0];
        ctx.fillStyle = `rgba(255,221,0,${alpha})`;
        ctx.beginPath();
        ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Bombs ──────────────────────────────────────────────────────────────────
  drawBombs(bombs) {
    const { ctx } = this;
    const now = Date.now();
    for (const [, bomb] of bombs) {
      if (bomb.exploded) continue;
      const cx = bomb.tileX * TILE_SIZE + TILE_SIZE / 2;
      const cy = bomb.tileY * TILE_SIZE + TILE_SIZE / 2;
      const age = (now - (bomb.explodesAt - BOMB_FUSE)) / BOMB_FUSE;
      // Pulse faster as it nears explosion
      const pulse = 1 + Math.sin(age * Math.PI * (2 + age * 6)) * 0.08;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);

      // Body
      ctx.fillStyle = C.bombBody;
      ctx.shadowColor = '#888';
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(0, 0, TILE_SIZE * 0.33, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Shine
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(-4, -5, 5, 0, Math.PI * 2);
      ctx.fill();

      // Fuse spark
      const sparkAlpha = 0.5 + Math.random() * 0.5;
      ctx.fillStyle = `rgba(255,80,50,${sparkAlpha})`;
      ctx.beginPath();
      ctx.arc(-TILE_SIZE * 0.12, -TILE_SIZE * 0.28, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // ── Players ────────────────────────────────────────────────────────────────
  drawPlayers(players) {
    const { ctx } = this;
    for (const [, p] of players) {
      if (!p.alive) continue;
      const cx = p.renderX + TILE_SIZE / 2;
      const cy = p.renderY + TILE_SIZE / 2;
      const r  = TILE_SIZE * 0.36;

      // Shadow
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.9, r * 0.65, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      // Body glow
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 14;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur  = 0;

      // Inner highlight
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.26, cy - r * 0.1, r * 0.13, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.26, cy - r * 0.1, r * 0.13, 0, Math.PI * 2);
      ctx.fill();

      // Name tag
      ctx.font = 'bold 10px monospace';
      const tw = ctx.measureText(p.name).width + 8;
      ctx.fillStyle = C.nameTag;
      ctx.fillRect(cx - tw / 2, cy - r - 19, tw, 14);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(p.name, cx, cy - r - 18);
    }
  }

  // ── Full frame ─────────────────────────────────────────────────────────────
  render(state) {
    const { ctx } = this;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (!state.map) return;
    this.drawMap(state.map);
    this.drawPowerups(state.powerups);
    this.drawExplosions(state.explosions);
    this.drawBombs(state.bombs);
    this.drawPlayers(state.players);
  }
}
