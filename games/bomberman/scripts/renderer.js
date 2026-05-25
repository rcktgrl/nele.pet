import { TILE, TILE_SIZE, GRID_W, GRID_H, PU, BOMB_FUSE, BOMB_TYPE } from './game.js';

// Fixed viewport (15 × 13 tiles = 600 × 520 px)
const VP_W = 15 * TILE_SIZE; // 600
const VP_H = 13 * TILE_SIZE; // 520

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
  constructor(canvas, gridW = GRID_W, gridH = GRID_H) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.gridW   = gridW;
    this.gridH   = gridH;
    this.cameraX = 0;
    this.cameraY = 0;
    // Viewport: min(gridW,15) × min(gridH,13) tiles
    canvas.width  = Math.min(gridW, 15) * TILE_SIZE;
    canvas.height = Math.min(gridH, 13) * TILE_SIZE;
  }

  // ── Map ────────────────────────────────────────────────────────────────────
  drawMap(map) {
    const { ctx } = this;
    const rows = map.length;
    const cols = rows > 0 ? map[0].length : 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
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

      let color, label;
      if (type === PU.RANGE)    { color = C.puRange; label = '🔥'; }
      else if (type === PU.BOMB)     { color = '#ff4081';  label = '💣'; }
      else if (type === PU.NAPALM)   { color = '#ff6a00';  label = '🌋'; }
      else                           { color = '#4a90d9';  label = '📦'; }

      ctx.fillStyle  = color;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = `bold 13px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy);
    }
  }

  // ── Explosions ─────────────────────────────────────────────────────────────
  drawExplosions(explosions) {
    const { ctx } = this;
    for (const exp of explosions) {
      const alpha = Math.max(0, (exp.dieAt - Date.now()) / 600);
      ctx.fillStyle = `rgba(255,106,0,${alpha * 0.85})`;
      for (const { x, y } of exp.tiles) {
        ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      }
      if (exp.tiles.length > 0) {
        const { x, y } = exp.tiles[0];
        ctx.fillStyle = `rgba(255,221,0,${alpha})`;
        ctx.beginPath();
        ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Napalm fire ────────────────────────────────────────────────────────────
  drawNapalm(napalmFires) {
    const { ctx } = this;
    const now = Date.now();
    const t   = now / 180;
    for (const [, fire] of napalmFires) {
      const remaining = Math.max(0, (fire.dieAt - now) / 2000);
      const flicker   = 0.65 + Math.sin(t + fire.x * 3.7 + fire.y * 2.1) * 0.35;
      const alpha     = remaining * flicker;

      const px = fire.x * TILE_SIZE;
      const py = fire.y * TILE_SIZE;

      // Outer orange glow
      ctx.fillStyle = `rgba(255,70,0,${alpha * 0.85})`;
      ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      // Inner yellow core
      ctx.fillStyle = `rgba(255,210,40,${alpha * 0.8})`;
      ctx.fillRect(px + 9, py + 9, TILE_SIZE - 18, TILE_SIZE - 18);
      // White-hot centre dot
      ctx.fillStyle = `rgba(255,255,220,${alpha * 0.55})`;
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Bombs ──────────────────────────────────────────────────────────────────
  drawBombs(bombs) {
    const { ctx } = this;
    const now = Date.now();
    for (const [, bomb] of bombs) {
      if (bomb.exploded) continue;

      // Compute draw position (slide animation)
      let drawX = bomb.tileX;
      let drawY = bomb.tileY;
      if (bomb.slideFrom) {
        const SLIDE_DUR = 250;
        const t = Math.min(1, (now - bomb.slideFrom.time) / SLIDE_DUR);
        drawX = bomb.slideFrom.x + (bomb.tileX - bomb.slideFrom.x) * t;
        drawY = bomb.slideFrom.y + (bomb.tileY - bomb.slideFrom.y) * t;
        if (t >= 1) bomb.slideFrom = null;
      }

      const cx  = drawX * TILE_SIZE + TILE_SIZE / 2;
      const cy  = drawY * TILE_SIZE + TILE_SIZE / 2;
      const age = (now - (bomb.explodesAt - BOMB_FUSE)) / BOMB_FUSE;
      const pulse = 1 + Math.sin(age * Math.PI * (2 + age * 6)) * 0.08;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);

      const isNapalm = bomb.type === BOMB_TYPE.NAPALM;
      const isBox    = bomb.type === BOMB_TYPE.BOX;

      if (isBox) {
        // Draw as a brown crate
        ctx.fillStyle = C.brick;
        ctx.shadowColor = '#a05020';
        ctx.shadowBlur  = 6;
        const s = TILE_SIZE * 0.34;
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = C.brickDark;
        ctx.lineWidth = 2;
        ctx.strokeRect(-s + 3, -s + 3, s * 2 - 6, s * 2 - 6);
        // cross
        ctx.beginPath();
        ctx.moveTo(-s + 5, 0); ctx.lineTo(s - 5, 0);
        ctx.moveTo(0, -s + 5); ctx.lineTo(0, s - 5);
        ctx.stroke();
      } else {
        // Sphere bomb (normal or napalm)
        const bodyColor  = isNapalm ? '#a03000' : C.bombBody;
        const glowColor  = isNapalm ? '#ff6a00' : '#888';
        ctx.fillStyle   = bodyColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur  = isNapalm ? 12 : 6;
        ctx.beginPath();
        ctx.arc(0, 0, TILE_SIZE * 0.33, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Shine
        ctx.fillStyle = isNapalm ? 'rgba(255,160,60,0.25)' : 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(-4, -5, 5, 0, Math.PI * 2);
        ctx.fill();
        // Fuse spark
        const sparkAlpha = 0.5 + Math.random() * 0.5;
        ctx.fillStyle = isNapalm
          ? `rgba(255,120,10,${sparkAlpha})`
          : `rgba(255,80,50,${sparkAlpha})`;
        ctx.beginPath();
        ctx.arc(-TILE_SIZE * 0.12, -TILE_SIZE * 0.28, isNapalm ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
      }

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
      ctx.shadowBlur = 0;

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

      // Special bomb indicator (top-right corner dot)
      if (p.specialBomb) {
        const dotColor = p.specialBomb === 'napalm' ? '#ff6a00' : '#4a90d9';
        ctx.fillStyle  = dotColor;
        ctx.shadowColor = dotColor;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.arc(cx + r * 0.72, cy - r * 0.72, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Name tag
      ctx.font = 'bold 10px monospace';
      const tw = ctx.measureText(p.name).width + 8;
      ctx.fillStyle = C.nameTag;
      ctx.fillRect(cx - tw / 2, cy - r - 19, tw, 14);
      ctx.fillStyle = '#fff';
      ctx.textAlign    = 'center';
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

    ctx.save();
    ctx.translate(-this.cameraX, -this.cameraY);
    this.drawMap(state.map);
    this.drawPowerups(state.powerups);
    this.drawNapalm(state.napalmFires);
    this.drawExplosions(state.explosions);
    this.drawBombs(state.bombs);
    this.drawPlayers(state.players);
    ctx.restore();
  }
}
