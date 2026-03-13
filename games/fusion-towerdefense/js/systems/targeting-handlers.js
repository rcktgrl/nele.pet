const DEFAULT_TARGETING_CONFIG = {
  fireCondition: 'target_required',
  targetingMode: 'first',
  retentionMode: 'none',
  rangePolicy: {
    requireInRangeToAcquire: true,
    requireInRangeToFire: true
  },
  aimingMode: 'direct'
};

function getTowerTargetingConfig(tower) {
  const def = getTowerDefFromInstance(tower);
  const raw = def?.targeting || {};

  return {
    fireCondition: raw.fireCondition || DEFAULT_TARGETING_CONFIG.fireCondition,
    targetingMode: tower?.runtimeTargetingMode || raw.targetingMode || DEFAULT_TARGETING_CONFIG.targetingMode,
    retentionMode: raw.retentionMode || DEFAULT_TARGETING_CONFIG.retentionMode,
    rangePolicy: {
      requireInRangeToAcquire:
        raw.rangePolicy?.requireInRangeToAcquire ??
        DEFAULT_TARGETING_CONFIG.rangePolicy.requireInRangeToAcquire,
      requireInRangeToFire:
        raw.rangePolicy?.requireInRangeToFire ??
        DEFAULT_TARGETING_CONFIG.rangePolicy.requireInRangeToFire
    },
    aimingMode: raw.aimingMode || DEFAULT_TARGETING_CONFIG.aimingMode
  };
}

function getTowerCurrentTarget(tower) {
  if (!tower?.currentTargetId) return null;
  return game.enemies.find(e => e.instanceId === tower.currentTargetId) || null;
}

function clearTowerCurrentTarget(tower) {
  tower.currentTargetId = null;
}

function setTowerCurrentTarget(tower, enemy) {
  tower.currentTargetId = enemy?.instanceId || null;
}

function isEnemyInTowerRange(tower, enemy) {
  if (!tower || !enemy) return false;
  const dx = enemy.x - tower.x;
  const dy = enemy.y - tower.y;
  const rangePixels = getRangeInPixels(tower.range);
  return dx * dx + dy * dy <= rangePixels * rangePixels;
}

function getEnemiesInTowerRange(tower) {
  return game.enemies.filter(e => isEnemyInTowerRange(tower, e));
}

function getEnemiesInRangeOfTower(tower) {
  return getEnemiesInTowerRange(tower);
}

function getRandomUniqueEnemies(list, count) {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function scoreEnemyForTargeting(tower, enemy, targetingMode) {
  const dx = enemy.x - tower.x;
  const dy = enemy.y - tower.y;
  const distSq = dx * dx + dy * dy;
  const pathProgress = getEnemyPathProgress(enemy);

  switch (targetingMode) {
    case 'last':
      return -pathProgress * 1e6 - distSq * 0.0001;
    case 'closest':
      return -distSq;
    case 'far':
      return distSq;
    case 'highest_hp':
      return enemy.hp * 1e6 - distSq * 0.0001;
    case 'lowest_hp':
      return -enemy.hp * 1e6 - distSq * 0.0001;
    case 'random':
      return Math.random();
    case 'first':
    default:
      return pathProgress * 1e6 - distSq * 0.0001;
  }
}

function getTargetingScoreForTower(tower, enemy, targetingMode) {
  return scoreEnemyForTargeting(tower, enemy, targetingMode);
}

function chooseEnemyByTargetingMode(tower, enemies, targetingMode) {
  if (!enemies.length) return null;

  if (targetingMode === 'random') {
    return enemies[Math.floor(Math.random() * enemies.length)] || null;
  }

  let best = null;
  let bestScore = -Infinity;

  for (const enemy of enemies) {
    const score = scoreEnemyForTargeting(tower, enemy, targetingMode);
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }

  return best;
}

function getOrderedTargetsForTower(tower, maxCount) {
  const cfg = getTowerTargetingConfig(tower);
  const inRangeEnemies = getEnemiesInTowerRange(tower);

  if (!inRangeEnemies.length) {
    return [];
  }

  if (cfg.targetingMode === 'random') {
    return getRandomUniqueEnemies(inRangeEnemies, maxCount);
  }

  return [...inRangeEnemies]
    .sort((a, b) => {
      const scoreA = scoreEnemyForTargeting(tower, a, cfg.targetingMode);
      const scoreB = scoreEnemyForTargeting(tower, b, cfg.targetingMode);
      return scoreB - scoreA;
    })
    .slice(0, maxCount);
}

function resolveTowerTarget(tower) {
  const cfg = getTowerTargetingConfig(tower);
  const current = getTowerCurrentTarget(tower);

  if (cfg.retentionMode === 'sticky' && current) {
    if (isEnemyInTowerRange(tower, current)) {
      return current;
    }
    clearTowerCurrentTarget(tower);
  }

  if (cfg.retentionMode === 'super_sticky' && current) {
    return current;
  }

  if (cfg.fireCondition === 'enemy_in_range') {
    const inRange = getEnemiesInTowerRange(tower);
    if (!inRange.length) {
      clearTowerCurrentTarget(tower);
      return null;
    }

    const chosen = chooseEnemyByTargetingMode(tower, inRange, cfg.targetingMode);
    setTowerCurrentTarget(tower, chosen);
    return chosen;
  }

  const candidates = cfg.rangePolicy.requireInRangeToAcquire
    ? getEnemiesInTowerRange(tower)
    : [...game.enemies];

  if (!candidates.length) {
    clearTowerCurrentTarget(tower);
    return null;
  }

  const chosen = chooseEnemyByTargetingMode(tower, candidates, cfg.targetingMode);
  setTowerCurrentTarget(tower, chosen);
  return chosen;
}

function canTowerFireAtTarget(tower, target) {
  if (!target) return false;
  const cfg = getTowerTargetingConfig(tower);

  if (!cfg.rangePolicy.requireInRangeToFire) {
    return true;
  }

  return isEnemyInTowerRange(tower, target);
}

function getTowerAimPoint(tower, target) {
  if (!tower || !target) return null;

  const cfg = getTowerTargetingConfig(tower);
  if (cfg.aimingMode === 'predictive') {
    return getInterceptPoint(tower.x, tower.y, target, tower.projectileSpeed || 1);
  }

  return { x: target.x, y: target.y };
}