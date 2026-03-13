const TOWER_RUNTIME_HOOKS = {
  beforeTick: [],
  afterTick: [],
  beforeAcquireTarget: [],
  afterAcquireTarget: [],
  beforeFire: [],
  afterFire: [],
  getAttackType: [],
  getProjectileTypeId: [],
  computeCooldown: [],
  canFire: []
};

const TOWER_RUNTIME_HANDLERS = {
  ammo: {
    onReloadTick(tower, prevReloadTimer) {
      if (!tower.requiresAmmo || tower.noReload) {
        return;
      }

      if (prevReloadTimer > 0 && tower.reloadTimer <= 0) {
        tower.ammo = tower.magSize;
      }
    },
    canFire(tower) {
      if (!tower.requiresAmmo || tower.noReload) {
        return true;
      }

      tower.ammo = tower.ammo ?? tower.magSize;

      if (tower.ammo > 0) {
        return true;
      }

      tower.reloadTimer = tower.reloadTime;
      return false;
    },
    onAfterFire(tower) {
      if (!tower.requiresAmmo || tower.noReload) {
        return;
      }

      tower.ammo -= 1;
      if (tower.ammo <= 0) {
        tower.reloadTimer = tower.reloadTime;
      }
    }
  },
  quickRamp: {
    onTick(tower, dt) {
      if (!tower.quickRamp) {
        return;
      }

      const hasTargetableEnemies = game.enemies.length > 0;
      if (hasTargetableEnemies) {
        tower.quickSpin = Math.min(1, (tower.quickSpin || 0) + dt / 10);
      } else {
        tower.quickSpin = Math.max(0, (tower.quickSpin || 0) - dt / (10 / 6));
      }
    },
    getCooldown(tower) {
      if (!tower.quickRamp) {
        return tower.fireRate;
      }

      const spin = tower.quickSpin || 0;
      const startShotsPerSecond = 1 / tower.fireRate;
      const endShotsPerSecond = 9.0;
      const currentShotsPerSecond =
        startShotsPerSecond + (endShotsPerSecond - startShotsPerSecond) * spin;

      return 1 / currentShotsPerSecond;
    }
  }
};

function registerTowerRuntimeHook(stage, hookFn) {
  if (!TOWER_RUNTIME_HOOKS[stage] || typeof hookFn !== 'function') {
    return;
  }

  TOWER_RUNTIME_HOOKS[stage].push(hookFn);
}

function runTowerRuntimeHooks(stage, payload) {
  const hooks = TOWER_RUNTIME_HOOKS[stage] || [];
  let current = payload;

  for (const hook of hooks) {
    const result = hook(current);
    if (result !== undefined) {
      current = result;
    }
  }

  return current;
}

function getTowerResolvedAttackType(tower) {
  const defAttackType = getTowerDefFromInstance(tower)?.special?.attackType;
  const fallback = tower?.attackType || defAttackType || 'projectile';
  const payload = runTowerRuntimeHooks('getAttackType', { tower, attackType: fallback });

  return payload?.attackType || fallback;
}

function getTowerResolvedProjectileTypeId(tower, fallbackProjectileTypeId) {
  const explicit = getTowerDefFromInstance(tower)?.special?.projectileTypeId;
  const fallback = explicit || fallbackProjectileTypeId || 'basic_bullet';
  const payload = runTowerRuntimeHooks('getProjectileTypeId', {
    tower,
    projectileTypeId: fallback
  });

  return payload?.projectileTypeId || fallback;
}

function getTowerFireCooldown(tower) {
  let cooldown = TOWER_RUNTIME_HANDLERS.quickRamp.getCooldown(tower);
  const payload = runTowerRuntimeHooks('computeCooldown', { tower, cooldown });
  cooldown = payload?.cooldown ?? cooldown;

  return Math.max(0.01, cooldown);
}

function canTowerSpendShot(tower) {
  let canFire = TOWER_RUNTIME_HANDLERS.ammo.canFire(tower);
  const payload = runTowerRuntimeHooks('canFire', { tower, canFire });
  canFire = payload?.canFire ?? canFire;

  return !!canFire;
}

function applyTowerTickRuntimeHandlers(tower, dt, prevReloadTimer) {
  TOWER_RUNTIME_HANDLERS.quickRamp.onTick(tower, dt);
  TOWER_RUNTIME_HANDLERS.ammo.onReloadTick(tower, prevReloadTimer);
}

function applyTowerAfterFireRuntimeHandlers(tower) {
  TOWER_RUNTIME_HANDLERS.ammo.onAfterFire(tower);
}

registerTowerRuntimeHook('getAttackType', ({ tower, attackType }) => {
  const overrideAttackType = tower?.runtimeAttackType;

  if (!overrideAttackType) {
    return { tower, attackType };
  }

  return { tower, attackType: overrideAttackType };
});



function registerTowerKillCredit(towerInstanceId) {
  if (!towerInstanceId) {
    return;
  }

  const tower = game.towers.find(entry => entry.instanceId === towerInstanceId);
  if (!tower) {
    return;
  }

  const hasSniperKillCard = (game.activeCards || []).includes('sniper_chain_trigger') && getTowerTypeId(tower) === 'sniper';
  if (!hasSniperKillCard) {
    return;
  }

  const hasteMultiplier = tower.onKillCooldownMultiplier || 0.25;

  if ((tower.cooldown || 0) > 0.01) {
    const targetCooldown = Math.max(0.01, tower.fireRate * hasteMultiplier);
    tower.cooldown = Math.min(tower.cooldown, targetCooldown);
    return;
  }

  tower.nextShotCooldownMultiplier = hasteMultiplier;
}

registerTowerRuntimeHook('computeCooldown', ({ tower, cooldown }) => {
  const multiplier = tower?.nextShotCooldownMultiplier;
  if (multiplier == null) {
    return { tower, cooldown };
  }

  tower.nextShotCooldownMultiplier = null;
  return { tower, cooldown: cooldown * multiplier };
  if ((game.activeCards || []).includes('sniper_chain_trigger') && getTowerTypeId(tower) === 'sniper') {
    tower.sniperKillHasteCharges = (tower.sniperKillHasteCharges || 0) + 1;
  }
}

registerTowerRuntimeHook('computeCooldown', ({ tower, cooldown }) => {
  if (!tower || !(tower.sniperKillHasteCharges > 0)) {
    return { tower, cooldown };
  }

  const hasCard = (game.activeCards || []).includes('sniper_chain_trigger') && getTowerTypeId(tower) === 'sniper';
  if (!hasCard) {
    return { tower, cooldown };
  }

  tower.sniperKillHasteCharges -= 1;
  return { tower, cooldown: cooldown * 0.25 };
});

const TOWER_MODIFIER_CARDS = {};

function registerTowerModifierCard(cardId, handlers) {
  if (!cardId || typeof handlers !== 'object') {
    return;
  }

  TOWER_MODIFIER_CARDS[cardId] = handlers;
}

function applyTowerModifierCard(tower, cardId) {
  const handlers = TOWER_MODIFIER_CARDS[cardId];
  if (!tower || !handlers) {
    return false;
  }

  const nextModifiers = Array.isArray(tower.runtimeModifiers)
    ? [...tower.runtimeModifiers]
    : [];

  if (!nextModifiers.includes(cardId)) {
    nextModifiers.push(cardId);
  }

  tower.runtimeModifiers = nextModifiers;

  if (typeof handlers.onApply === 'function') {
    handlers.onApply(tower);
  }

  return true;
}

function getTowerModifierHandlers(tower) {
  if (!tower || !Array.isArray(tower.runtimeModifiers)) {
    return [];
  }

  return tower.runtimeModifiers
    .map(cardId => TOWER_MODIFIER_CARDS[cardId])
    .filter(Boolean);
}

registerTowerRuntimeHook('computeCooldown', ({ tower, cooldown }) => {
  let nextCooldown = cooldown;

  for (const handlers of getTowerModifierHandlers(tower)) {
    if (typeof handlers.getCooldown === 'function') {
      nextCooldown = handlers.getCooldown(tower, nextCooldown);
    }
  }

  return { tower, cooldown: nextCooldown };
});

registerTowerRuntimeHook('beforeFire', payload => {
  let nextPayload = payload;

  for (const handlers of getTowerModifierHandlers(payload.tower)) {
    if (typeof handlers.beforeFire === 'function') {
      nextPayload = handlers.beforeFire(nextPayload) || nextPayload;
    }
  }

  return nextPayload;
});

registerTowerModifierCard('inferno_rampdown_protocol', {
  onApply(tower) {
    if (!tower || getTowerTypeId(tower) !== 'inferno') {
      return;
    }

    tower.runtimeAttackType = 'inferno_beam';
    tower.rampMode = 'ramp_down';
    tower.rampStages = [50, 35, 25, 18, 12];
  }
});
