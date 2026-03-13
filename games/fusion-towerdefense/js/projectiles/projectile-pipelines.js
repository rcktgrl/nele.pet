const PROJECTILE_PIPELINE_HANDLERS = {
  standard: runStandardProjectilePipeline,
  mortar_shell: runMortarShellProjectilePipeline,
  beam: runBeamProjectilePipeline,
  tesla_chain: runTeslaChainProjectilePipeline
};
function getEnemyPathProgress(enemy) {
  return enemy.pathProgress ?? enemy.progress ?? 0;
}

function getProjectilePipelineHandler(pipelineType) {
  return PROJECTILE_PIPELINE_HANDLERS[pipelineType] || runStandardProjectilePipeline;
}

function moveProjectileForTick(projectile, dt) {
  const prevX = projectile.x;
  const prevY = projectile.y;

  projectile.x += projectile.vx * dt;
  projectile.y += projectile.vy * dt;
  projectile.life -= dt;

  if (projectile.traveledDistance != null) {
    projectile.traveledDistance += Math.hypot(projectile.x - prevX, projectile.y - prevY);
  }

  return { prevX, prevY };
}

function getProjectileSourceTowerId(projectile) {
  return projectile.sourceTowerId || null;
}

function addBossDamageCreditFromProjectile(enemy, projectile, damage) {
  const sourceTowerId = getProjectileSourceTowerId(projectile);
  if (!enemy.isBoss || !sourceTowerId) return;

  enemy.lastDamageWindow = 1;
  enemy.damageByTower[sourceTowerId] =
    (enemy.damageByTower[sourceTowerId] || 0) + damage;
}

function projectileUsesPiercing(projectileDef) {
  return getEffectiveProjectilePipeline({}, projectileDef).pierceType !== 'none';
}

function getProjectileEffectiveRadius(projectile, projectileDef, dt) {
  const pipeline = getEffectiveProjectilePipeline(projectile, projectileDef);

  if (pipeline.collisionType === 'segment_hit') {
    return Math.max(projectile.radius, Math.hypot(projectile.vx * dt, projectile.vy * dt) * 0.5);
  }
  return projectile.radius;
}

function getProjectileDamage(projectile, prevX, prevY) {
  if (projectile.longsniperBoost) {
    return projectile.damage + Math.floor(Math.hypot(projectile.x - prevX, projectile.y - prevY) / 75) * 3;
  }
  return projectile.damage;
}

function applyProjectileEffectsOnDirectHit(projectile, projectileDef, enemy) {
  const effects = getEffectiveProjectileEffects(projectile, projectileDef);
  const stun = effects.stun;

  if (stun && stun.applyOn === 'onDirectHit' && !enemy.isBoss) {
    enemy.stunTimer = Math.max(enemy.stunTimer || 0, stun.duration || 0);
  }
}

function applyProjectileEffectsOnExplosionHit(projectile, projectileDef, enemy) {
  const effects = getEffectiveProjectileEffects(projectile, projectileDef);
  const stun = effects.stun;

  if (stun && stun.applyOn === 'onExplosionHit' && !enemy.isBoss) {
    enemy.stunTimer = Math.max(enemy.stunTimer || 0, stun.duration || 0);
  }
}

function handleProjectilePierce(projectile, projectileDef) {
  const pipeline = getEffectiveProjectilePipeline(projectile, projectileDef);
  const pierceType = pipeline.pierceType;

  if (pierceType === 'none') {
    return true;
  }

  if (pierceType === 'count') {
    const pierceCount = pipeline.pierce?.count ?? 0;
    projectile.pierceLeft = (projectile.pierceLeft ?? pierceCount) - 1;
    return projectile.pierceLeft < 0;
  }

  return false;
}

function segmentCircleHit(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(cx - x1, cy - y1) <= r;
  }

  let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const px = x1 + dx * t;
  const py = y1 + dy * t;
  return Math.hypot(cx - px, cy - py) <= r;
}

function isProjectileHit(projectile, projectileDef, prevX, prevY, enemy, effectiveRadius) {
  const pipeline = getEffectiveProjectilePipeline(projectile, projectileDef);
  const collisionType = pipeline.collisionType;

  if (collisionType === 'segment_hit') {
    return segmentCircleHit(prevX, prevY, projectile.x, projectile.y, enemy.x, enemy.y, enemy.radius + effectiveRadius);
  }

  if (collisionType === 'circle_hit') {
    return Math.hypot(enemy.x - projectile.x, enemy.y - projectile.y) <= enemy.radius + projectile.radius;
  }

  return false;
}

function runStandardProjectilePipeline(projectile, projectileDef, dt) {
  runProjectileHook(projectile, projectileDef, 'onTick', { dt });

  const { prevX, prevY } = moveProjectileForTick(projectile, dt);
  const effectiveRadius = getProjectileEffectiveRadius(projectile, projectileDef, dt);

  let removeProjectile = false;
  let expireReason = null;

  for (let j = game.enemies.length - 1; j >= 0; j--) {
    const enemy = game.enemies[j];

    const hitNow = isProjectileHit(projectile, projectileDef, prevX, prevY, enemy, effectiveRadius);
    if (!hitNow) {
      continue;
    }

    if (projectile.hitSet && projectile.hitSet.has(enemy.instanceId)) {
      continue;
    }

    if (projectileUsesPiercing(projectileDef)) {
      projectile.hitSet ??= new Set();
      projectile.hitSet.add(enemy.instanceId);
    }

    const damage = getProjectileDamage(projectile, prevX, prevY);

    const hitContext = runProjectileHook(projectile, projectileDef, 'onHit', {
      enemy,
      damage,
      didHit: false,
      didKill: false,
      hitMode: 'direct'
    });

    if (!hitContext.didHit) {
      continue;
    }

    applyProjectileEffectsOnDirectHit(projectile, projectileDef, enemy);
    addBossDamageCreditFromProjectile(enemy, projectile, damage);

    if (hitContext.didKill) {
      runProjectileHook(projectile, projectileDef, 'onKill', {
        enemy,
        damage,
        hitMode: 'direct'
      });

      registerTowerKillCredit(projectile.sourceTowerId);
      rewardEnemyKill(enemy);
      game.enemies.splice(j, 1);
    }

    const shouldRemoveFromPierce = handleProjectilePierce(projectile, projectileDef);
    if (shouldRemoveFromPierce) {
      removeProjectile = true;
      expireReason = 'hit';
    }

    if (hitContext.didKill) {
      if (!projectileUsesPiercing(projectileDef) || removeProjectile) {
        break;
      }
    } else if (!projectileUsesPiercing(projectileDef) || removeProjectile) {
      removeProjectile = true;
      expireReason = expireReason || 'hit';
      break;
    }
  }

  const expiredByLife = projectile.life <= 0;
  if (expiredByLife) {
    removeProjectile = true;
    expireReason = expireReason || 'life_end';
  }

  if (removeProjectile) {
    const expireContext = runProjectileHook(projectile, projectileDef, 'onExpire', {
      reason: expireReason || 'unknown'
    });
    runProjectileEventInjections('onExpire', projectile, projectileDef, expireContext);
  }

  return {
    remove: removeProjectile
  };
}

function runMortarShellProjectilePipeline(projectile, projectileDef, dt) {
  runProjectileHook(projectile, projectileDef, 'onTick', { dt });

  moveProjectileForTick(projectile, dt);

  const pipeline = getEffectiveProjectilePipeline(projectile, projectileDef);
  const arrivalRadius = pipeline.arrivalRadius ?? 8;

  const arrived =
    Math.hypot((projectile.targetX || projectile.x) - projectile.x, (projectile.targetY || projectile.y) - projectile.y) <=
    Math.max(arrivalRadius, Math.hypot(projectile.vx * dt, projectile.vy * dt));

  if (!arrived && projectile.life > 0) {
    return { remove: false };
  }

  game.effects.push({
    type: 'mortar_blast',
    x: projectile.targetX,
    y: projectile.targetY,
    r: (getEffectiveProjectileSpecial(projectile, projectileDef).explosion?.radius || 0),
    life: 0.18
  });

  const expireContext = runProjectileHook(projectile, projectileDef, 'onExpire', {
    reason: arrived ? 'arrival' : 'life_end'
  });

  runProjectileEventInjections('onExpire', projectile, projectileDef, {
    ...expireContext,
    x: projectile.targetX,
    y: projectile.targetY,
    useTargetPointForExplosion: true
  });

  return { remove: true };
}

function runBeamProjectilePipeline(projectile, projectileDef, dt) {
  runProjectileHook(projectile, projectileDef, 'onTick', { dt });

  const pipeline = getEffectiveProjectilePipeline(projectile, projectileDef);

  projectile.didBeamHit ??= false;
  projectile.life -= dt;

  if (!projectile.didBeamHit) {
    let target = null;

    const initialTargetId = projectile.meta?.initialTargetId;
    if (initialTargetId) {
      target = game.enemies.find(e => e.instanceId === initialTargetId) || null;
    }

    if (!target && projectile.meta?.resolveTargetFromTower === true && projectile.sourceTowerId) {
      const sourceTower = game.towers.find(t => t.instanceId === projectile.sourceTowerId) || null;
      if (sourceTower) {
        target = resolveTowerTarget(sourceTower);
      }
    }

    if (target) {
      const damage = projectile.damage;

      projectile.lineFromX = projectile.x;
      projectile.lineFromY = projectile.y;
      projectile.lineToX = target.x;
      projectile.lineToY = target.y;
      projectile.lineWidth = pipeline.lineWidth ?? 3;

      const hitContext = runProjectileHook(projectile, projectileDef, 'onHit', {
        enemy: target,
        damage,
        didHit: false,
        didKill: false,
        hitMode: 'beam'
      });

      if (hitContext.didHit) {
        applyProjectileEffectsOnDirectHit(projectile, projectileDef, target);
        addBossDamageCreditFromProjectile(target, projectile, damage);

        if (hitContext.didKill) {
          runProjectileHook(projectile, projectileDef, 'onKill', {
            enemy: target,
            damage,
            hitMode: 'beam'
          });

          registerTowerKillCredit(projectile.sourceTowerId);
          rewardEnemyKill(target);
          const idx = game.enemies.indexOf(target);
          if (idx !== -1) {
            game.enemies.splice(idx, 1);
          }
        }
      }
    }

    projectile.didBeamHit = true;
  }

  const expired = projectile.life <= 0;
  if (expired) {
    const expireContext = runProjectileHook(projectile, projectileDef, 'onExpire', {
      reason: 'life_end'
    });
    runProjectileEventInjections('onExpire', projectile, projectileDef, expireContext);
  }

  return { remove: expired };
}

function runTeslaChainProjectilePipeline(projectile, projectileDef, dt) {
  runProjectileHook(projectile, projectileDef, 'onTick', { dt });

  const pipeline = getEffectiveProjectilePipeline(projectile, projectileDef);

  projectile.arcSegments ??= [];
  projectile.chainVisitedIds ??= new Set();
  projectile.chainHitsRemaining ??= pipeline.chainCount ?? 3;
  projectile.chainDelayTimer ??= 0;
  projectile.didInitialTeslaHit ??= false;

  const lingerTime = pipeline.lingerTime ?? 0.12;
  const chainDelay = pipeline.chainDelay ?? 0.12;
  const chainRange = scaleWorldValue(pipeline.chainRange ?? 120);
  const allowRepeatTargets = !!pipeline.allowRepeatTargets;
  const retargetMode = pipeline.retargetMode ?? 'closest_unvisited';

  for (let i = projectile.arcSegments.length - 1; i >= 0; i--) {
    projectile.arcSegments[i].life -= dt;
    if (projectile.arcSegments[i].life <= 0) {
      projectile.arcSegments.splice(i, 1);
    }
  }

  projectile.chainDelayTimer = Math.max(0, projectile.chainDelayTimer - dt);
  projectile.life -= dt;

  function addArcSegment(x1, y1, x2, y2) {
    projectile.arcSegments.push({
      x1,
      y1,
      x2,
      y2,
      width: 3,
      life: lingerTime
    });
  }

  function hitTarget(fromX, fromY, target) {
    const damage = projectile.damage;

    const hitContext = runProjectileHook(projectile, projectileDef, 'onHit', {
      enemy: target,
      damage,
      didHit: false,
      didKill: false,
      hitMode: 'chain'
    });

    if (!hitContext.didHit) {
      return false;
    }

    addBossDamageCreditFromProjectile(target, projectile, damage);
    addArcSegment(fromX, fromY, target.x, target.y);

    if (hitContext.didKill) {
      runProjectileHook(projectile, projectileDef, 'onKill', {
        enemy: target,
        damage,
        hitMode: 'chain'
      });

      registerTowerKillCredit(projectile.sourceTowerId);
      rewardEnemyKill(target);
      const idx = game.enemies.indexOf(target);
      if (idx !== -1) {
        game.enemies.splice(idx, 1);
      }
    }

    projectile.chainVisitedIds.add(target.instanceId);
    projectile.chainHitsRemaining -= 1;
    projectile.currentSourceX = target.x;
    projectile.currentSourceY = target.y;
    projectile.chainDelayTimer = chainDelay;

    return true;
  }

  if (!projectile.didInitialTeslaHit) {
    const initialTargetId = projectile.meta?.initialTargetId;
    const initialTarget = initialTargetId
      ? game.enemies.find(e => e.instanceId === initialTargetId) || null
      : null;

    if (!initialTarget) {
      const expireContext = runProjectileHook(projectile, projectileDef, 'onExpire', {
        reason: 'missing_initial_target'
      });
      runProjectileEventInjections('onExpire', projectile, projectileDef, expireContext);
      return { remove: projectile.arcSegments.length === 0 };
    }

    hitTarget(projectile.x, projectile.y, initialTarget);
    projectile.didInitialTeslaHit = true;
  } else if (projectile.chainHitsRemaining > 0 && projectile.chainDelayTimer <= 0) {
    const sourceX = projectile.currentSourceX ?? projectile.x;
    const sourceY = projectile.currentSourceY ?? projectile.y;

    const candidates = game.enemies.filter(enemy => {
      if (!allowRepeatTargets && projectile.chainVisitedIds.has(enemy.instanceId)) {
        return false;
      }

      return Math.hypot(enemy.x - sourceX, enemy.y - sourceY) <= chainRange;
    });

    let target = null;

    if (candidates.length) {
      if (retargetMode === 'first') {
        target = candidates.reduce((best, enemy) => {
          if (!best) return enemy;
          return getEnemyPathProgress(enemy) > getEnemyPathProgress(best) ? enemy : best;
        }, null);
      } else {
        target = candidates.reduce((best, enemy) => {
          if (!best) return enemy;

          const bestDist = Math.hypot(best.x - sourceX, best.y - sourceY);
          const enemyDist = Math.hypot(enemy.x - sourceX, enemy.y - sourceY);

          return enemyDist < bestDist ? enemy : best;
        }, null);
      }
    }

    if (target) {
      hitTarget(sourceX, sourceY, target);
    } else {
      projectile.chainHitsRemaining = 0;
    }
  }

  const shouldExpireNow =
    projectile.chainHitsRemaining <= 0 ||
    projectile.life <= 0;

  if (shouldExpireNow) {
    const expireContext = runProjectileHook(projectile, projectileDef, 'onExpire', {
      reason: projectile.life <= 0 ? 'life_end' : 'chain_done'
    });
    runProjectileEventInjections('onExpire', projectile, projectileDef, expireContext);

    return {
      remove: projectile.arcSegments.length === 0
    };
  }

  return { remove: false };
}