const PROJECTILE_RENDER_HANDLERS = {
  orb: renderOrbProjectile,
  rail_slug: renderRailSlugProjectile,
  beam_arc: renderBeamArcProjectile,
  beam_line: renderBeamLineProjectile,
  none: renderNoProjectile
};

function getProjectileRenderHandler(renderType) {
  return PROJECTILE_RENDER_HANDLERS[renderType] || renderOrbProjectile;
}

function renderOrbProjectile(projectile) {
  ctx.beginPath();
  ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
  ctx.fill();
}

function renderRailSlugProjectile(projectile) {
  ctx.translate(projectile.x, projectile.y);
  ctx.rotate(Math.atan2(projectile.vy, projectile.vx));
  ctx.fillRect(-18, -2, 36, 4);
}

function renderBeamArcProjectile(projectile) {
  const segments = projectile.arcSegments || [];
  if (!segments.length) {
    return;
  }

  for (const segment of segments) {
    if (!segment || segment.life <= 0) {
      continue;
    }

    ctx.strokeStyle = projectile.color;
    ctx.lineWidth = segment.width ?? 3;
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);

    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const px = segment.x1 + dx * t + nx * ((i % 2 ? 1 : -1) * 8);
      const py = segment.y1 + dy * t + ny * ((i % 2 ? 1 : -1) * 8);
      ctx.lineTo(px, py);
    }

    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
  }
}

function renderBeamLineProjectile(projectile) {
  if (
    projectile.lineFromX == null ||
    projectile.lineFromY == null ||
    projectile.lineToX == null ||
    projectile.lineToY == null
  ) {
    return;
  }

  ctx.strokeStyle = projectile.color;
  ctx.lineWidth = projectile.lineWidth ?? 3;
  ctx.beginPath();
  ctx.moveTo(projectile.lineFromX, projectile.lineFromY);
  ctx.lineTo(projectile.lineToX, projectile.lineToY);
  ctx.stroke();
}

function renderNoProjectile() {
  // absichtlich leer
}