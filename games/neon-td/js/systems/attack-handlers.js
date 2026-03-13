const ATTACK_HANDLERS = {
  projectile: handleProjectileAttack,
  shotgun: handleShotgunAttack,
  duo_burst: handleDuoBurstAttack,
  trio_burst: handleTrioBurstAttack,
  penta_burst: handlePentaBurstAttack,
  tesla_chain: handleTeslaAttack,
  stormfork_multi: handleStormforkMultiAttack,
  mortar_target_point: handleMortarAttack,
  explosive_projectile: handleExplosiveProjectileAttack,
  railgun: handleRailgunAttack,
  omni_burst: handleOmniBurstAttack,
  flamethrower_pierce: handleFlamethrowerAttack,
  laser_beam: handleLaserBeamAttack,
  pulse_laser_beam: handlePulseLaserBeamAttack,
  _beam: handleBeamAttack
};

function getTowerProjectileOverrideConfig(tower) {
  const def = getTowerDefFromInstance(tower);
  const special = def?.special || {};

  if (special.projectileOverrides && typeof special.projectileOverrides === 'object') {
    return special.projectileOverrides;
  }

  return {};
}

function mergeTowerProjectileOverrides(tower, overrides = {}) {
  const base = getTowerProjectileOverrideConfig(tower);

  return {
    ...base,
    ...overrides,
    pipeline: mergeProjectileObjects(base.pipeline || {}, overrides.pipeline || {}),
    effects: mergeProjectileObjects(base.effects || {}, overrides.effects || {}),
    special: mergeProjectileObjects(base.special || {}, overrides.special || {})
  };
}

function getTowerProjectileTypeId(tower, fallbackProjectileTypeId = 'basic_bullet') {
  const def = getTowerDefFromInstance(tower);
  const explicit = def?.special?.projectileTypeId;
  if (explicit) {
    return explicit;
  }

  const attackType = def?.special?.attackType;

  if (attackType === 'railgun') return 'rail_slug';
  if (attackType === 'explosive_projectile') return 'explosive_orb';
  if (attackType === 'mortar_target_point') return 'mortar_shell';
  if (attackType === 'flamethrower_pierce') return 'flame_piercer';
  if (attackType === 'laser_beam') return 'laser_beam_projectile';
  if (attackType === 'pulse_laser_beam') return 'pulse_beam_projectile';
  if (attackType === 'tesla_chain') return 'tesla_arc';

  return fallbackProjectileTypeId;
}

function fireSingleProjectile(tower, projectileTypeId, overrides = {}) {
  return spawnTowerProjectile(
    tower,
    projectileTypeId,
    mergeTowerProjectileOverrides(tower, overrides)
  );
}

function fireProjectileBurst(tower, projectileTypeId, angles, overrides = {}) {
  const shots = [];

  for (const angle of angles) {
    shots.push(
      spawnTowerProjectile(
        tower,
        projectileTypeId,
        mergeTowerProjectileOverrides(tower, {
          ...overrides,
          angle
        })
      )
    );
  }

  return shots;
}

function fireOffsetProjectileBurst(tower, projectileTypeId, offsets, overrides = {}) {
  const shots = [];

  for (const offset of offsets) {
    shots.push(
      spawnTowerProjectile(
        tower,
        projectileTypeId,
        mergeTowerProjectileOverrides(tower, {
          ...overrides,
          x: offset.x,
          y: offset.y,
          angle: offset.angle ?? overrides.angle ?? tower.angle
        })
      )
    );
  }

  return shots;
}

function getCenteredSpreadAngles(baseAngle, count, spread) {
  const angles = [];

  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1);
    angles.push(baseAngle + (u - 0.5) * spread);
  }

  return angles;
}

function getParallelOffsets(tower, angle, sideOffset = 6, forwardOffset = 18) {
  const px = Math.cos(angle + Math.PI / 2) * sideOffset;
  const py = Math.sin(angle + Math.PI / 2) * sideOffset;

  return [-1, 1].map(s => ({
    x: tower.x + Math.cos(angle) * forwardOffset + px * s,
    y: tower.y + Math.sin(angle) * forwardOffset + py * s,
    angle
  }));
}

function getAttackHandler(attackType) {
  return ATTACK_HANDLERS[attackType] || handleProjectileAttack;
}

function handleBeamAttack(t, best) {
  const stackRatio = Math.min(1, (t.Stacks || 0) / 40);
  const damage = Math.round(getDamageFromStacks(t.Stacks || 0));

  best.hp -= damage;

  if (best.isBoss && t.instanceId) {
    best.lastDamageWindow = 1;
    best.damageByTower[t.instanceId] =
      (best.damageByTower[t.instanceId] || 0) + damage;
  }

  t.BeamTargetId = best.instanceId;

  game.effects.push({
    type: '_beam',
    x1: t.x,
    y1: t.y,
    x2: best.x,
    y2: best.y,
    life: 0.14,
    stackRatio
  });

  game.effects.push({
    type: '_hit',
    x: best.x,
    y: best.y,
    life: 0.12,
    stackRatio
  });

  if (best.hp <= 0) {
    t.TargetId = null;
    t.BeamTargetId = null;
    t.Stacks = 0;
  } else {
    t.Stacks = Math.min(40, (t.Stacks || 0) + 1);
  }
}

function handleTeslaAttack(t, best) {
  fireSingleProjectile(t, getTowerProjectileTypeId(t, 'tesla_arc'), {
    x: t.x,
    y: t.y,
    vx: 0,
    vy: 0,
    damage: t.damage,
    color: t.color,
    meta: {
      initialTargetId: best.instanceId
    }
  });
}

function handleMortarAttack(t, best) {
  const target = getInterceptPoint(t.x, t.y, best, t.projectileSpeed || 220);
  const dx = target.x - t.x;
  const dy = target.y - t.y;
  const dist = Math.hypot(dx, dy) || 1;

  fireSingleProjectile(t, getTowerProjectileTypeId(t, 'mortar_shell'), {
    x: t.x + Math.cos(t.angle) * 18,
    y: t.y + Math.sin(t.angle) * 18,
    vx: (dx / dist) * (t.projectileSpeed || 220),
    vy: (dy / dist) * (t.projectileSpeed || 220),
    targetX: target.x,
    targetY: target.y,
    radius: 6,
    life: dist / (t.projectileSpeed || 220) + 0.05,
    pipeline: {
      arrivalRadius: 8
    }
  });
}

function handleExplosiveProjectileAttack(t) {
  fireSingleProjectile(t, getTowerProjectileTypeId(t, 'explosive_orb'));
}

function handleRailgunAttack(t) {
  fireSingleProjectile(t, getTowerProjectileTypeId(t, 'rail_slug'));
}

function handleShotgunAttack(t) {
  const towerDef = getTowerDefFromInstance(t);
  const pelletCount = towerDef?.special?.pelletCount ?? 10;
  const spread = (towerDef?.special?.spread ?? 0.72) * (t.spreadMultiplier || 1);
  const angles = getCenteredSpreadAngles(t.angle, pelletCount, spread);

  fireProjectileBurst(t, getTowerProjectileTypeId(t), angles, {
    speed: t.projectileSpeed * 1.35,
    radius: 3,
    life: 0.24 * (t.projectileLifeMultiplier || 1)
  });
}

function handleDuoBurstAttack(t) {
  fireOffsetProjectileBurst(
    t,
    getTowerProjectileTypeId(t),
    getParallelOffsets(t, t.angle, 6, 18),
    {
      radius: 4,
      life: 2
    }
  );
}

function handleTrioBurstAttack(t) {
  const angles = getTowerDefFromInstance(t)?.special?.forwardAngles || [-0.24, 0, 0.24];

  fireProjectileBurst(
    t,
    getTowerProjectileTypeId(t),
    angles.map(a => t.angle + a),
    {
      x: t.x + Math.cos(t.angle) * 18,
      y: t.y + Math.sin(t.angle) * 18,
      radius: 4,
      life: 2
    }
  );
}

function handlePentaBurstAttack(t) {
  const forwardAngles = getTowerDefFromInstance(t)?.special?.forwardAngles || [-0.24, 0, 0.24];

  fireProjectileBurst(
    t,
    getTowerProjectileTypeId(t),
    forwardAngles.map(a => t.angle + a),
    {
      x: t.x + Math.cos(t.angle) * 18,
      y: t.y + Math.sin(t.angle) * 18,
      radius: 4,
      life: 2
    }
  );

  const backAngle = t.angle + Math.PI;

  fireOffsetProjectileBurst(
    t,
    getTowerProjectileTypeId(t),
    getParallelOffsets(t, backAngle, 6, 18),
    {
      radius: 4,
      life: 2
    }
  );
}

function handleOmniBurstAttack(t) {
  const barrelCount = getTowerDefFromInstance(t)?.special?.barrelCount || 24;
  const angles = [];

  for (let k = 0; k < barrelCount; k++) {
    angles.push((Math.PI * 2 / barrelCount) * k);
  }

  fireProjectileBurst(t, getTowerProjectileTypeId(t), angles, {
    speed: 520,
    radius: 3,
    life: 0.28
  });
}

function handleFlamethrowerAttack(t) {
  const shotAngle = t.spreadRandom
    ? t.angle + ((Math.random() * 2 - 1) * t.spreadRandom)
    : t.angle;

  fireSingleProjectile(t, getTowerProjectileTypeId(t, 'flame_piercer'), {
    angle: shotAngle
  });
}

function handleLaserBeamAttack(t, best) {
  const laserDamage = getLaserDamageAtDistance(t, best);

  fireSingleProjectile(t, getTowerProjectileTypeId(t, 'laser_beam_projectile'), {
    x: t.x,
    y: t.y,
    vx: 0,
    vy: 0,
    damage: laserDamage,
    color: t.color,
    meta: {
      initialTargetId: best.instanceId,
      distanceDamageApplied: true
    }
  });
}

function handlePulseLaserBeamAttack(t, best) {
  fireSingleProjectile(t, getTowerProjectileTypeId(t, 'pulse_beam_projectile'), {
    x: t.x,
    y: t.y,
    vx: 0,
    vy: 0,
    damage: t.damage,
    color: t.color,
    meta: {
      initialTargetId: best.instanceId
    }
  });
}

function handleStormforkMultiAttack(tower, _primaryTarget) {
  const hitCount = tower.multiHitCount || 5;
  const targets = getOrderedTargetsForTower(tower, hitCount);

  if (!targets.length) {
    return;
  }

  for (const target of targets) {
    target.hp -= tower.damage;

    game.effects.push({
      type: 'lightning',
      x1: tower.x,
      y1: tower.y,
      x2: target.x,
      y2: target.y,
      life: 0.12
    });

    if (target.isBoss && tower.instanceId) {
      target.lastDamageWindow = 1;
      target.damageByTower[tower.instanceId] =
        (target.damageByTower[tower.instanceId] || 0) + tower.damage;
    }
  }
}

function handleProjectileAttack(t) {
  const shotAngle = t.spreadRandom
    ? t.angle + ((Math.random() * 2 - 1) * t.spreadRandom)
    : t.angle;

  const sniperDouble =
    metaProgress.researched.sniper_upgrade &&
    isTowerType(t, 'sniper') &&
    (t.idleShotTimer || 0) >= 5;

  fireSingleProjectile(t, getTowerProjectileTypeId(t), {
    angle: shotAngle,
    damage: sniperDouble ? t.damage * 2 : t.damage,
    radius: isTowerType(t, 'sniper') ? 5 : 4,
    life: isTowerType(t, 'sniper') ? 2.4 : 2,
    longsniperBoost:
      metaProgress.researched.longsniper_upgrade &&
      isTowerType(t, 'longsniper')
  });

  t.idleShotTimer = 0;

  if (isTowerType(t, 'rapid') && !t.noReload) {
    t.ammo -= 1;
    if (t.ammo <= 0) {
      t.reloadTimer = t.reloadTime;
    }
  }
}

function handleInfernoBeamAttack(t, best) {
  const stacks = t.infernoStacks || 0;
  const stackRatio = Math.min(1, stacks / 40);
  const infernoDamage = Math.round(getInfernoDamageFromTower(t));

  best.hp -= infernoDamage;

  if (best.isBoss && t.instanceId) {
    best.lastDamageWindow = 1;
    best.damageByTower[t.instanceId] =
      (best.damageByTower[t.instanceId] || 0) + infernoDamage;
  }

  t.infernoTargetId = best.instanceId;
  t.infernoBeamTargetId = best.instanceId;

  game.effects.push({
    type: 'inferno_beam',
    x1: t.x,
    y1: t.y,
    x2: best.x,
    y2: best.y,
    life: 0.14,
    stackRatio
  });

  game.effects.push({
    type: 'inferno_hit',
    x: best.x,
    y: best.y,
    life: 0.12,
    stackRatio
  });

  if (best.hp <= 0) {
    t.infernoTargetId = null;
    t.infernoBeamTargetId = null;
    t.infernoStacks = 0;
  } else {
    t.infernoStacks = Math.min(40, stacks + 1);
  }
}

function spawnTowerProjectile(tower, projectileTypeId, overrides = {}) {
  const angle = overrides.angle ?? tower.angle ?? 0;
  const muzzleDistance = overrides.muzzleDistance ?? 18;

  const position = getTowerProjectileSpawnPosition(tower, angle, muzzleDistance);
  const velocity = getTowerProjectileVelocity(tower, angle, overrides.speed);

  const runtimeData = {
    sourceTowerId: tower.instanceId,
    sourceTowerTypeId: getTowerTypeId(tower),

    x: overrides.x ?? position.x,
    y: overrides.y ?? position.y,

    vx: overrides.vx ?? velocity.vx,
    vy: overrides.vy ?? velocity.vy,

    damage: overrides.damage ?? tower.damage,
    color: overrides.color ?? tower.color,

    radius: overrides.radius,
    life: overrides.life,

    targetX: overrides.targetX,
    targetY: overrides.targetY,

    longsniperBoost: overrides.longsniperBoost,

    pipeline: overrides.pipeline,
    effects: overrides.effects,
    special: overrides.special,
    meta: overrides.meta,

    splitDepthRemaining: overrides.splitDepthRemaining,
    traveledDistance: overrides.traveledDistance
  };

  if (runtimeData.radius == null) delete runtimeData.radius;
  if (runtimeData.life == null) delete runtimeData.life;
  if (runtimeData.targetX == null) delete runtimeData.targetX;
  if (runtimeData.targetY == null) delete runtimeData.targetY;
  if (runtimeData.longsniperBoost == null) delete runtimeData.longsniperBoost;
  if (runtimeData.pipeline == null) delete runtimeData.pipeline;
  if (runtimeData.effects == null) delete runtimeData.effects;
  if (runtimeData.special == null) delete runtimeData.special;
  if (runtimeData.meta == null) delete runtimeData.meta;
  if (runtimeData.splitDepthRemaining == null) delete runtimeData.splitDepthRemaining;
  if (runtimeData.traveledDistance == null) delete runtimeData.traveledDistance;

  return spawnProjectile(projectileTypeId, runtimeData, overrides.options || {});
}