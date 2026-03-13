function getTowerModernRenderDef(tower) {
  const towerTypeId = getTowerTypeId(tower);
  return TOWER_RENDER_DEFS[towerTypeId] || null;
}

function hasTowerModernRenderDef(tower) {
  return !!getTowerModernRenderDef(tower);
}

function resolveTowerRenderColor(colorSpec, tower) {
  if (!colorSpec) return null;

  if (typeof colorSpec === 'string') {
    return colorSpec;
  }

  if (typeof colorSpec === 'object') {
    if (colorSpec.mode === 'towerColor') {
      return tower.color;
    }

    if (colorSpec.mode === 'towerBody') {
      return (tower.stunTimer || 0) > 0 ? '#9fa7b8' : getTowerBodyColor(tower);
    }

    if (colorSpec.mode === 'coreDark') {
      return '#08101f';
    }
  }

  return null;
}

function shouldDrawTowerRenderLayer(layer, tower) {
  const when = layer?.when || 'always';

  if (when === 'always') return true;
  if (when === 'stunned') return (tower.stunTimer || 0) > 0;
  if (when === 'notStunned') return (tower.stunTimer || 0) <= 0;
  if (when === 'recentlyFired') return (tower.idleShotTimer || 999) <= 0.08;

  return true;
}

function applyTowerRenderPartStyle(part, tower) {
  const fill = resolveTowerRenderColor(part.fill, tower);
  const stroke = resolveTowerRenderColor(part.stroke, tower);

  if (fill) {
    ctx.fillStyle = fill;
  }

  if (stroke) {
    ctx.strokeStyle = stroke;
  }

  ctx.lineWidth = part.lineWidth ?? 1;

  if (part.glow) {
    ctx.shadowColor = resolveTowerRenderColor(part.glow.color, tower) || part.glow.color;
    ctx.shadowBlur = part.glow.blur ?? 0;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
}

function drawTowerRenderCirclePart(part, tower) {
  applyTowerRenderPartStyle(part, tower);
  ctx.beginPath();
  ctx.arc(0, 0, part.radius, 0, Math.PI * 2);
  if (part.fill) ctx.fill();
  if (part.stroke) ctx.stroke();
}

function drawTowerRenderRoundRectPart(part, tower) {
  applyTowerRenderPartStyle(part, tower);
  roundRect(
    ctx,
    0,
    0,
    part.width,
    part.height,
    part.radius ?? 0,
    !!part.fill,
    !!part.stroke
  );
}

function drawTowerRenderRingPart(part, tower) {
  applyTowerRenderPartStyle(part, tower);
  ctx.beginPath();
  ctx.arc(0, 0, part.radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTowerRenderPolygonPart(part, tower) {
  if (!Array.isArray(part.points) || !part.points.length) return;

  applyTowerRenderPartStyle(part, tower);
  ctx.beginPath();
  ctx.moveTo(part.points[0].x, part.points[0].y);

  for (let i = 1; i < part.points.length; i++) {
    ctx.lineTo(part.points[i].x, part.points[i].y);
  }

  ctx.closePath();
  if (part.fill) ctx.fill();
  if (part.stroke) ctx.stroke();
}

function drawTowerRenderPart(part, tower) {
  ctx.save();

  ctx.translate(part.x || 0, part.y || 0);
  ctx.rotate(part.rotation || 0);

  if (part.type === 'circle') {
    drawTowerRenderCirclePart(part, tower);
  } else if (part.type === 'roundRect') {
    drawTowerRenderRoundRectPart(part, tower);
  } else if (part.type === 'ring') {
    drawTowerRenderRingPart(part, tower);
  } else if (part.type === 'polygon') {
    drawTowerRenderPolygonPart(part, tower);
  }

  ctx.restore();
}

function drawTowerModernBase(tower, def) {
  const base = def.base || {};

  const bodyFill = resolveTowerRenderColor(base.bodyFill, tower);
  if (base.bodyRadius != null) {
    ctx.fillStyle = bodyFill || tower.color;
    ctx.beginPath();
    ctx.arc(0, 0, base.bodyRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (base.coreRadius != null) {
    ctx.fillStyle = resolveTowerRenderColor(base.coreFill, tower) || '#08101f';
    ctx.beginPath();
    ctx.arc(0, 0, base.coreRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTowerModernLayers(tower, def) {
  const layers = def.layers || [];

  for (const layer of layers) {
    if (!shouldDrawTowerRenderLayer(layer, tower)) {
      continue;
    }

    ctx.save();

    if (layer.rotationSpace === 'turret') {
      ctx.rotate(getTowerDrawAngle(tower));
    }

    for (const part of layer.parts || []) {
      drawTowerRenderPart(part, tower);
    }

    ctx.restore();
  }
}

function drawModernTowerSingle(tower) {
  const def = getTowerModernRenderDef(tower);
  if (!def) return false;

  ctx.save();

  drawTowerRitualOverlay(tower);

  ctx.translate(tower.x, tower.y);

  drawTowerModernBase(tower, def);
  drawTowerModernLayers(tower, def);
  drawTowerStunRing(tower);

  ctx.restore();
  return true;
}

function drawLegacyTowerSingle(tower) {
  ctx.save();

  drawTowerRitualOverlay(tower);
  drawTowerBase(tower);
  drawTowerAmmoOverlay(tower);

  ctx.translate(tower.x, tower.y);
  ctx.rotate(getTowerDrawAngle(tower));

  drawTowerWeaponShape(tower);
  drawTowerCore(tower);
  drawTowerStunRing(tower);

  ctx.restore();
}