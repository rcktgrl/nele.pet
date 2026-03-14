const PROJECTILE_RADIUS_SCALE = 0.5;

let _projectileInstanceCounter = 0;

function createProjectileInstanceId() {
  _projectileInstanceCounter += 1;
  return `projectile_${Date.now()}_${_projectileInstanceCounter}`;
}

function shouldProjectileTrackDistance(resolvedDef) {
  const triggers = resolvedDef?.triggers || {};
  const splitRules = triggers.split || [];
  const explosionRules = triggers.explosion || [];
  const allRules = [...splitRules, ...explosionRules];

  return allRules.some(
    rule =>
      rule.when === 'travelDistanceOnce' ||
      rule.when === 'travelDistanceRepeat'
  );
}

function buildProjectileTriggerState(resolvedDef) {
  const triggers = resolvedDef?.triggers || {};
  const state = {};

  function addRuleSet(rules) {
    if (!Array.isArray(rules) || !rules.length) return;

    for (const rule of rules) {
      if (rule.when === 'travelDistanceOnce') {
        state.travelDistanceOnce ??= {};
        state.travelDistanceOnce[String(rule.distance)] = false;
      } else if (rule.when === 'travelDistanceRepeat') {
        state.travelDistanceRepeat ??= {};
        state.travelDistanceRepeat[String(rule.distance)] = 0;
      }
    }
  }

  addRuleSet(triggers.split);
  addRuleSet(triggers.explosion);

  return Object.keys(state).length ? state : undefined;
}

function buildProjectileRuntimeState(projectileTypeId, runtimeData = {}, options = {}) {
  const resolvedDef = resolveProjectileDef(projectileTypeId);
  const effectivePipeline = mergeProjectileObjects(
    resolvedDef.pipeline || {},
    runtimeData.pipeline || {}
  );
  const effectiveSpecial = mergeProjectileObjects(
    resolvedDef.special || {},
    runtimeData.special || {}
  );
  const effectiveEffects = mergeProjectileObjects(
    resolvedDef.effects || {},
    runtimeData.effects || {}
  );

  const rawRadius = runtimeData.radius ?? effectivePipeline.stats?.radius ?? 4;
  const baseRadius = rawRadius * PROJECTILE_RADIUS_SCALE;

  const projectile = {
    instanceId: createProjectileInstanceId(),
    projectileTypeId: resolvedDef.id,

    sourceTowerId: runtimeData.sourceTowerId ?? null,
    sourceTowerTypeId: runtimeData.sourceTowerTypeId ?? null,

    x: runtimeData.x ?? 0,
    y: runtimeData.y ?? 0,
    vx: runtimeData.vx ?? 0,
    vy: runtimeData.vy ?? 0,

    damage: runtimeData.damage ?? 0,
    color: runtimeData.color ?? '#ffffff',

    baseRadius,
    radius: scaleWorldValue(baseRadius),
    life: runtimeData.life ?? effectivePipeline.stats?.life ?? 2
  };

  if (runtimeData.targetX != null) projectile.targetX = runtimeData.targetX;
  if (runtimeData.targetY != null) projectile.targetY = runtimeData.targetY;

  if (runtimeData.meta && typeof runtimeData.meta === 'object') {
    projectile.meta = runtimeData.meta;
  }

  if (runtimeData.longsniperBoost != null) {
    projectile.longsniperBoost = runtimeData.longsniperBoost;
  }

  if (runtimeData.pipeline && typeof runtimeData.pipeline === 'object') {
    projectile.pipeline = runtimeData.pipeline;
  }

  if (runtimeData.special && typeof runtimeData.special === 'object') {
    projectile.special = runtimeData.special;
  }

  if (runtimeData.effects && typeof runtimeData.effects === 'object') {
    projectile.effects = runtimeData.effects;
  }

  if (effectiveSpecial.split) {
    const requestedDepth = runtimeData.splitDepthRemaining;
    const fallbackDepth = effectiveSpecial.split.depth ?? 0;
    projectile.splitDepthRemaining =
      requestedDepth != null ? requestedDepth : fallbackDepth;
  }

  if (shouldProjectileTrackDistance(resolvedDef)) {
    projectile.traveledDistance = runtimeData.traveledDistance ?? 0;
  }

  const triggerState = buildProjectileTriggerState(resolvedDef);
  if (triggerState) {
    projectile.triggerState = triggerState;
  }

  if (options.includeResolvedDef === true) {
    projectile._resolvedProjectileDef = resolvedDef;
  }

  return projectile;
}

function spawnProjectile(projectileTypeId, runtimeData = {}, options = {}) {
  const projectile = buildProjectileRuntimeState(projectileTypeId, runtimeData, options);
  const projectileDef = options.includeResolvedDef === true
    ? projectile._resolvedProjectileDef || resolveProjectileDef(projectile.projectileTypeId)
    : resolveProjectileDef(projectile.projectileTypeId);

  runProjectileHook(projectile, projectileDef, 'onSpawn', {
    runtimeData,
    options
  });

  game.projectiles.push(projectile);
  return projectile;
}

function getTowerProjectileSpawnPosition(tower, angle, distance = 18) {
  const scaledDistance = scaleWorldValue(distance);
  return {
    x: tower.x + Math.cos(angle) * scaledDistance,
    y: tower.y + Math.sin(angle) * scaledDistance
  };
}

function getTowerProjectileVelocity(tower, angle, speedOverride = null) {
  const speed = speedOverride ?? tower.projectileSpeed ?? 0;
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed
  };
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