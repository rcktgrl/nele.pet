function resizeCanvas(){const r=canvas.parentElement.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.floor(r.width*dpr);canvas.height=Math.floor(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);refreshMapLayoutFromCanvas()}

function drawBackground(){const dpr=window.devicePixelRatio||1,w=canvas.width/dpr,h=canvas.height/dpr,g=ctx.createLinearGradient(0,0,0,h);ctx.clearRect(0,0,w,h);g.addColorStop(0,'#060912');g.addColorStop(1,'#0b1430');ctx.fillStyle=g;ctx.fillRect(0,0,w,h)}
function roundRect(c,x,y,w,h,r,f,s){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();if(f)c.fill();if(s)c.stroke()}
function drawMap(){if(!game.map)return;const{cols,rows,cellSize,offsetX,offsetY,pathCells,pathPoints,pathSet}=game.map;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const x=offsetX+c*cellSize,y=offsetY+r*cellSize,key=`${c},${r}`,isPath=pathSet.has(key),isHovered=game.hoveredCell&&game.hoveredCell.c===c&&game.hoveredCell.r===r,occupied=game.towers.some(t=>t.c===c&&t.r===r),buildable=game.map.buildableSet.has(key);ctx.fillStyle=isPath?'rgba(255,94,220,.15)':!buildable?'rgba(255,255,255,.018)':occupied?'rgba(165,255,104,.11)':'rgba(89,243,255,.045)';ctx.strokeStyle=isPath?'rgba(255,94,220,.42)':!buildable?'rgba(255,255,255,.04)':isHovered?'rgba(89,243,255,.7)':'rgba(89,243,255,.16)';ctx.lineWidth=1;roundRect(ctx,x+3,y+3,cellSize-6,cellSize-6,14,true,true)}ctx.beginPath();for(let i=0;i<pathPoints.length;i++){const p=pathPoints[i];if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)}ctx.strokeStyle='rgba(255,94,220,.7)';ctx.lineWidth=12;ctx.stroke();const start=pathCells[0],end=pathCells[pathCells.length-1];[{cell:start,color:'#59f3ff'},{cell:end,color:'#ff667f'}].forEach(m=>{const x=offsetX+m.cell.c*cellSize+cellSize/2,y=offsetY+m.cell.r*cellSize+cellSize/2;ctx.fillStyle=m.color;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill()})}
function getTowerInfernoRatio(tower) {
  if (!isTowerType(tower, 'inferno')) return 0;
  return Math.min(1, (tower.infernoStacks || 0) / 40);
}

function getTowerBodyColor(tower) {
  const infernoRatio = getTowerInfernoRatio(tower);

  if (isTowerType(tower, 'inferno')) {
    return `rgb(${Math.round(176 - (87 * infernoRatio))},${Math.round(124 + (116 * infernoRatio))},255)`;
  }

  return tower.color;
}

function drawTowerRitualOverlay(tower) {
  const ritualState = getCurrentRitualCandidateState(tower);
  const scale = getTowerVisualScale();
  const isExecutableCenter = ritualState === 'center' && isCurrentRitualExecutable();

  if (ritualState === 'center') {
    ctx.fillStyle = isExecutableCenter
      ? 'rgba(89,243,255,0.26)'
      : 'rgba(120,160,255,0.20)';
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 28 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isExecutableCenter
      ? 'rgba(89,243,255,0.92)'
      : 'rgba(120,160,255,0.68)';
    ctx.lineWidth = isExecutableCenter ? 2.5 : 2;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 28 * scale, 0, Math.PI * 2);
    ctx.stroke();

    if (isExecutableCenter) {
      ctx.strokeStyle = 'rgba(89,243,255,0.35)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, 31 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    return;
  }

  if (ritualState === 'selected') {
    ctx.fillStyle = 'rgba(125,255,176,0.16)';
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 27 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(125,255,176,0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 27 * scale, 0, Math.PI * 2);
    ctx.stroke();

    return;
  }

  if (ritualState === 'candidate') {
    ctx.fillStyle = 'rgba(255,230,107,0.10)';
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 26 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,230,107,0.44)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 26 * scale, 0, Math.PI * 2);
    ctx.stroke();

    return;
  }

  if (ritualState === 'invalid') {
    ctx.fillStyle = 'rgba(255,102,127,0.08)';
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 26 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,102,127,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 26 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTowerBase(tower) {
  const stunned = (tower.stunTimer || 0) > 0;
  const scale = getTowerVisualScale();

  ctx.fillStyle = stunned ? '#9fa7b8' : getTowerBodyColor(tower);
  ctx.beginPath();
  ctx.arc(tower.x, tower.y, 20 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#08101f';
  ctx.beginPath();
  ctx.arc(tower.x, tower.y, 10 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawTowerAmmoOverlay(tower) {
  if (!isTowerType(tower, 'rapid') || tower.noReload) {
    return;
  }

  const scale = getTowerVisualScale();

  const ammoRatio = Math.max(
    0,
    Math.min(1, (tower.ammo ?? tower.magSize ?? 0) / (tower.magSize || 1))
  );

  ctx.fillStyle = '#28c76f';
  ctx.beginPath();
  ctx.arc(tower.x, tower.y, 10 * ammoRatio * scale, 0, Math.PI * 2);
  ctx.fill();
}

function getTowerDrawAngle(tower) {
  if (isTowerType(tower, 'stormfork') || isTowerType(tower, 'ring')) {
    return 0;
  }

  return tower.angle || 0;
}

function drawDefaultTowerBarrel() {
  ctx.fillStyle = 'rgba(234,250,255,.95)';
  roundRect(ctx, 0, -5, 24, 10, 5, true, false);
}

function drawDuoTowerBarrel() {
  roundRect(ctx, 0, -10, 24, 8, 4, true, false);
  roundRect(ctx, 0, 2, 24, 8, 4, true, false);
}

function drawBasesniperTowerBarrel() {
  ctx.fillStyle = '#59f3ff';
  roundRect(ctx, 0, -4, 30, 8, 4, true, false);
}

function drawSnipegunTowerBarrel() {
  ctx.fillStyle = '#ffe66b';
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(22, -6);
  ctx.lineTo(22, 6);
  ctx.lineTo(0, 3);
  ctx.closePath();
  ctx.fill();
}

function drawStormforkTowerBarrel() {
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawInfernoTowerBarrel(tower) {
  const infernoRatio = getTowerInfernoRatio(tower);
  const gripColor = `rgb(${Math.round(176 - (87 * infernoRatio))},${Math.round(124 + (116 * infernoRatio))},255)`;

  ctx.fillStyle = gripColor;
  roundRect(ctx, -2, -7, 10, 14, 5, true, false);

  ctx.save();
  ctx.rotate(-0.23);
  roundRect(ctx, 6, -11, 18, 6, 3, true, false);
  ctx.restore();

  ctx.save();
  ctx.rotate(0.23);
  roundRect(ctx, 6, 5, 18, 6, 3, true, false);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(21, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawQuicksniperTowerBarrel() {
  roundRect(ctx, 0, -4, 24, 2, 1.5, true, false);
  roundRect(ctx, 0, -1, 24, 2, 1.5, true, false);
  roundRect(ctx, 0, 2, 24, 2, 1.5, true, false);
  roundRect(ctx, 0, 5, 24, 2, 1.5, true, false);
}

function drawLongsniperTowerBarrel() {
  roundRect(ctx, 0, -5, 34, 10, 5, true, false);
}

function drawTrioTowerBarrel() {
  for (const a of [-0.24, 0, 0.24]) {
    ctx.save();
    ctx.rotate(a);
    roundRect(ctx, 0, -2, 22, 4, 2, true, false);
    ctx.restore();
  }
}

function drawPentaTowerBarrel() {
  drawTrioTowerBarrel();

  ctx.save();
  ctx.rotate(Math.PI);
  roundRect(ctx, 0, -7, 22, 4, 2, true, false);
  roundRect(ctx, 0, 3, 22, 4, 2, true, false);
  ctx.restore();
}

function drawRingTowerBarrel() {
  ctx.fillStyle = '#ffd46b';
  for (let k = 0; k < 24; k++) {
    ctx.save();
    ctx.rotate((Math.PI * 2 / 24) * k);
    roundRect(ctx, 10, -1.5, 14, 3, 1.5, true, false);
    ctx.restore();
  }
}

function drawMortarTowerBarrel() {
  ctx.fillStyle = '#ff8af0';
  roundRect(ctx, 0, -4, 24, 8, 4, true, false);
  ctx.beginPath();
  ctx.arc(24, 0, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlamethrowerTowerBarrel() {
  ctx.fillStyle = '#101318';
  roundRect(ctx, 0, -5, 22, 10, 5, true, false);

  ctx.fillStyle = '#0a0d12';
  roundRect(ctx, 10, -4, 16, 8, 4, true, false);

  ctx.fillStyle = '#ff9a4d';
  roundRect(ctx, 12, -1, 12, 2, 1, true, false);

  ctx.shadowColor = 'rgba(255,154,77,0.75)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#ffb066';
  roundRect(ctx, 14, -0.75, 8, 1.5, 0.75, true, false);
  ctx.shadowBlur = 0;
}

function drawLaserTowerBarrel() {
  ctx.fillStyle = '#b8c0cc';
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#06080c';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 0, -2.5, 18, 5, 2.5, true, false);

  ctx.beginPath();
  ctx.moveTo(18, -4);
  ctx.lineTo(26, 0);
  ctx.lineTo(18, 4);
  ctx.closePath();
  ctx.fill();
}

const TOWER_BARREL_RENDERERS = [
  ['duo', drawDuoTowerBarrel],
  ['basesniper', drawBasesniperTowerBarrel],
  ['snipegun', drawSnipegunTowerBarrel],
  ['stormfork', drawStormforkTowerBarrel],
  ['inferno', drawInfernoTowerBarrel],
  ['quicksniper', drawQuicksniperTowerBarrel],
  ['longsniper', drawLongsniperTowerBarrel],
  ['trio', drawTrioTowerBarrel],
  ['penta', drawPentaTowerBarrel],
  ['ring', drawRingTowerBarrel],
  ['mortar', drawMortarTowerBarrel],
  ['flamethrower', drawFlamethrowerTowerBarrel],
  ['laser', drawLaserTowerBarrel]
];

function drawTowerWeaponShape(tower) {
  ctx.fillStyle = isTowerType(tower, 'snipegun')
    ? towerTypes.sniper.color
    : 'rgba(234,250,255,.95)';

  for (const [typeId, renderer] of TOWER_BARREL_RENDERERS) {
    if (isTowerType(tower, typeId)) {
      renderer(tower);
      return;
    }
  }

  drawDefaultTowerBarrel();
}

function drawTowerCore(tower) {
  if (isTowerType(tower, 'stormfork') || isTowerType(tower, 'rapid')) {
    return;
  }

  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1327';
  ctx.fill();
}

function drawTowerStunRing(tower) {
  if ((tower.stunTimer || 0) <= 0) {
    return;
  }

  ctx.strokeStyle = 'rgba(255,230,107,.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTowers() {
  for (const tower of game.towers) {
    if (hasTowerModernRenderDef(tower)) {
      drawModernTowerSingle(tower);
    } else {
      drawLegacyTowerSingle(tower);
    }
  }
}
function drawEnemies(){for(const e of game.enemies){ctx.save();ctx.fillStyle=e.isBoss?'#ff667f':(e.color||(e.isFast?'#59f3ff':'#ffe66b'));ctx.beginPath();if(e.isFast){ctx.moveTo(e.x,e.y-e.radius);ctx.lineTo(e.x+e.radius,e.y);ctx.lineTo(e.x,e.y+e.radius);ctx.lineTo(e.x-e.radius,e.y);ctx.closePath()}else ctx.arc(e.x,e.y,e.radius,0,Math.PI*2);ctx.fill();if(e.core){ctx.fillStyle=e.core;ctx.beginPath();ctx.arc(e.x,e.y,Math.max(3,e.radius*.38),0,Math.PI*2);ctx.fill()}const w=30,hp=Math.max(0,e.hp/e.maxHp);ctx.fillStyle='rgba(0,0,0,.45)';ctx.fillRect(e.x-w/2,e.y-e.radius-14,w,5);ctx.fillStyle=e.isBoss?'#ff5edc':(e.isFast?'#a5ff68':'#59f3ff');ctx.fillRect(e.x-w/2,e.y-e.radius-14,w*hp,5);ctx.restore()}}
function drawProjectiles() {
  for (const p of game.projectiles) {
    const projectileDef = resolveProjectileDef(p.projectileTypeId || 'basic_bullet');
    const renderHandler = getProjectileRenderHandler(projectileDef.pipeline.renderType);

    ctx.save();
    ctx.fillStyle = p.color;
    renderHandler(p, projectileDef);
    ctx.restore();
  }

  for (const e of game.effects) {
    if (e.type === 'lightning') {
      ctx.save();
      ctx.strokeStyle = 'rgba(157,140,255,.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);

      const dx = e.x2 - e.x1;
      const dy = e.y2 - e.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        const px = e.x1 + dx * t + nx * ((i % 2 ? 1 : -1) * 8);
        const py = e.y1 + dy * t + ny * ((i % 2 ? 1 : -1) * 8);
        ctx.lineTo(px, py);
      }

      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.restore();
    } else if (e.type === 'laser_beam') {
      ctx.save();

      ctx.strokeStyle = 'rgba(128,216,255,0.28)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(128,216,255,0.98)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();

      ctx.restore();
    } else if (e.type === 'inferno_beam') {
      const sr = e.stackRatio || 0;

      ctx.save();
      ctx.strokeStyle = `rgba(${Math.round(200 - (80 * sr))},80,255,0.24)`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,70,70,0.98)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.restore();
    } else if (e.type === 'inferno_hit') {
      const sr = e.stackRatio || 0;

      ctx.save();
      ctx.strokeStyle = `rgba(255,${Math.round(60 + (120 * sr))},${Math.round(60 + (180 * sr))},0.95)`;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(e.x, e.y, 6 + (1 - e.life / 0.12) * 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(e.x - 5, e.y);
      ctx.lineTo(e.x + 5, e.y);
      ctx.moveTo(e.x, e.y - 5);
      ctx.lineTo(e.x, e.y + 5);
      ctx.stroke();
      ctx.restore();
    } else if (e.type === 'explosion') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,143,90,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1 - e.life / 0.16), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (e.type === 'mortar_blast') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,138,240,.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1 - e.life / 0.18), 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,180,250,.8)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 10 + (1 - e.life / 0.18) * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
function drawHoverPreview() {
  if (!game.map || !game.hoveredCell || game.sellMode) return;

  let range = null;
  let blocked = false;
  let previewColor = 'rgba(89,243,255,.10)';
  let previewStroke = 'rgba(89,243,255,.9)';

  const x =
    game.map.offsetX + game.hoveredCell.c * game.map.cellSize + game.map.cellSize / 2;
  const y =
    game.map.offsetY + game.hoveredCell.r * game.map.cellSize + game.map.cellSize / 2;

  const ritualPreview = getRitualPreviewForHoveredTower();

  if (ritualPreview) {
    range = ritualPreview.resultDef.stats.range;
    blocked = false;
    previewColor = 'rgba(89,243,255,.10)';
    previewStroke = 'rgba(89,243,255,.9)';
  } else {
    if (!game.selectedTowerType) return;

    const t = towerTypes[game.selectedTowerType];
    const f = getFusionPreview(game.selectedTowerType, game.hoveredCell);
    range = f ? f.range : t.range;

    const key = `${game.hoveredCell.c},${game.hoveredCell.r}`;
    const existing = game.towers.find(
      t => t.c === game.hoveredCell.c && t.r === game.hoveredCell.r
    );

    blocked =
      !f &&
      (
        game.map.pathSet.has(key) ||
        !game.map.buildableSet.has(key) ||
        !!existing ||
        game.money < t.cost
      );

    previewColor = blocked ? 'rgba(255,102,127,.14)' : 'rgba(89,243,255,.10)';
    previewStroke = blocked ? 'rgba(255,102,127,.85)' : 'rgba(89,243,255,.9)';
  }

  ctx.save();

  ctx.strokeStyle = previewStroke;
  ctx.fillStyle = previewColor;
  ctx.lineWidth = 2;

  const scale = getMapScale();

  ctx.beginPath();
  ctx.arc(x, y, 18 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  const scaledRange = range >= 99999 ? 320 * scale : getRangeInPixels(range);
  ctx.arc(x, y, scaledRange, 0, Math.PI * 2);
  ctx.strokeStyle = blocked
    ? 'rgba(255,102,127,.22)'
    : 'rgba(89,243,255,.20)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}
function drawEndOverlay(){if(!game.gameOver&&!game.victory)return;const r=canvas.getBoundingClientRect(),w=420,h=220,x=r.width/2-w/2,y=r.height/2-h/2;ctx.save();ctx.fillStyle='rgba(4,6,14,.62)';ctx.fillRect(0,0,r.width,r.height);ctx.fillStyle='rgba(10,14,30,.95)';ctx.strokeStyle=game.victory?'rgba(125,255,176,.7)':'rgba(255,102,127,.55)';ctx.lineWidth=2;roundRect(ctx,x,y,w,h,22,true,true);ctx.fillStyle='#eafaff';ctx.font='800 34px Inter, Arial';ctx.textAlign='center';ctx.fillText(game.victory?'Sieg':'Game Over',r.width/2,y+70);ctx.font='500 18px Inter, Arial';ctx.fillStyle='#93adc0';ctx.fillText(`Run-Score: ${game.score}`,r.width/2,y+118);ctx.fillText(`Meta-Cash: ${Math.floor(game.score*(game.victory?1:.5))}`,r.width/2,y+148);ctx.fillText('Nutze links den Button, um ins Menü zurückzukehren.',r.width/2,y+182);ctx.restore()}
function draw(){drawBackground();drawMap();drawHoverPreview();drawTowers();drawEnemies();drawProjectiles();drawEndOverlay()}
