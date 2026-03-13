const PROJECTILE_EVENT_INJECTION_HANDLERS = {
  onExpire: runProjectileOnExpireInjections
};

function runProjectileEventInjections(eventName, projectile, projectileDef, context = {}) {
  const handler = PROJECTILE_EVENT_INJECTION_HANDLERS[eventName];
  if (!handler) return context;
  return handler(projectile, projectileDef, context) || context;
}

function projectileHasTriggerForEvent(triggerRules, eventName) {
  if (!Array.isArray(triggerRules)) return false;
  return triggerRules.some(rule => rule.when === eventName);
}

function runProjectileOnExpireInjections(projectile, projectileDef, context = {}) {
  const special = getEffectiveProjectileSpecial(projectile, projectileDef);
  const triggers = projectileDef.triggers || {};

  if (special.explosion && projectileHasTriggerForEvent(triggers.explosion, 'onExpire')) {
    context.didExplode = executeProjectileExplosionInjection(projectile, projectileDef, context) || context.didExplode;
  }

  if (special.split && projectileHasTriggerForEvent(triggers.split, 'onExpire')) {
    context.didSplit = executeProjectileSplitInjection(projectile, projectileDef, context) || context.didSplit;
  }

  return context;
}

function executeProjectileExplosionInjection(projectile, projectileDef, context = {}) {
  const explosion = getEffectiveProjectileSpecial(projectile, projectileDef).explosion;
  if (!explosion) return false;

  const explosionX = context.useTargetPointForExplosion ? (context.x ?? projectile.x) : projectile.x;
  const explosionY = context.useTargetPointForExplosion ? (context.y ?? projectile.y) : projectile.y;

  const blastRadius = explosion.radius || 0;
  const blastDamageMultiplier = explosion.damageMultiplier ?? 1;

  for (let k = game.enemies.length - 1; k >= 0; k--) {
    const enemy = game.enemies[k];

    if (Math.hypot(enemy.x - explosionX, enemy.y - explosionY) <= blastRadius) {
      const blastDamage = projectile.damage * blastDamageMultiplier;

      const hitContext = runProjectileHook(projectile, projectileDef, 'onHit', {
        enemy,
        damage: blastDamage,
        didHit: false,
        didKill: false,
        hitMode: 'explosion'
      });

      if (!hitContext.didHit) {
        continue;
      }

      applyProjectileEffectsOnExplosionHit(projectile, projectileDef, enemy);
      addBossDamageCreditFromProjectile(enemy, projectile, blastDamage);

      if (hitContext.didKill) {
        runProjectileHook(projectile, projectileDef, 'onKill', {
          enemy,
          damage: blastDamage,
          hitMode: 'explosion'
        });

        rewardEnemyKill(enemy);
        game.enemies.splice(k, 1);
      }
    }
  }

  game.effects.push({
    type: 'explosion',
    x: explosionX,
    y: explosionY,
    r: blastRadius,
    life: 0.16
  });

  return true;
}

function executeProjectileSplitInjection(projectile, projectileDef, context = {}) {
  const split = getEffectiveProjectileSpecial(projectile, projectileDef).split;
  if (!split) return false;

  const remainingDepth =
    projectile.splitDepthRemaining != null
      ? projectile.splitDepthRemaining
      : (split.depth ?? 0);

  if (remainingDepth <= 0) {
    return false;
  }

  const splitCount = split.count ?? 1;
  const splitSpread = split.spread ?? 0;
  const splitProjectileType = split.projectileType;
  const splitDamageMultiplier = split.damageMultiplier ?? 1;
  const splitSpeedMultiplier = split.speedMultiplier ?? 1;

  const baseAngle =
    typeof context.baseAngle === 'number'
      ? context.baseAngle
      : Math.atan2(projectile.vy || 0, projectile.vx || 1);

  const baseSpeed = Math.hypot(projectile.vx || 0, projectile.vy || 0);

  for (let i = 0; i < splitCount; i++) {
    const u = splitCount === 1 ? 0.5 : i / (splitCount - 1);
    const angle = baseAngle + (u - 0.5) * splitSpread;
    const speed = baseSpeed * splitSpeedMultiplier;

    spawnProjectile(splitProjectileType, {
      x: projectile.x,
      y: projectile.y,
      sourceTowerId: projectile.sourceTowerId ?? null,
      sourceTowerTypeId: projectile.sourceTowerTypeId ?? null,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage: projectile.damage * splitDamageMultiplier,
      color: projectile.color,
      splitDepthRemaining: remainingDepth - 1
    });
  }

  return true;
}