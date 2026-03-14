const PROJECTILE_HOOK_HANDLERS = {
  standard_spawn: runStandardProjectileOnSpawn,
  standard_tick: runStandardProjectileOnTick,
  standard_hit: runStandardProjectileOnHit,
  standard_kill: runStandardProjectileOnKill,
  standard_expire: runStandardProjectileOnExpire
};

function hasProjectileHookHandler(hookName) {
  return !!PROJECTILE_HOOK_HANDLERS[hookName];
}

function getProjectileHookHandler(hookName) {
  return PROJECTILE_HOOK_HANDLERS[hookName] || null;
}

function runProjectileHook(projectile, projectileDef, hookType, context = {}) {
  const hooks = projectileDef.hooks || {};
  const hookName = hooks[hookType];

  if (hookName == null) {
    return context;
  }

  const handler = getProjectileHookHandler(hookName);
  if (!handler) {
    return context;
  }

  return handler(projectile, projectileDef, context) || context;
}

function runStandardProjectileOnSpawn(projectile, projectileDef, context) {
  return context;
}

function runStandardProjectileOnTick(projectile, projectileDef, context) {
  return context;
}

function runStandardProjectileOnHit(projectile, projectileDef, context) {
  const enemy = context.enemy;
  if (!enemy) return context;

  const damage = context.damage ?? 0;
  const damageResult = applyEnemyDamage(enemy, damage, projectile.sourceTowerId || null);
  context.didHit = damageResult.didHit;
  context.didKill = damageResult.didKill;

  return context;
}

function runStandardProjectileOnKill(projectile, projectileDef, context) {
  return context;
}

function runStandardProjectileOnExpire(projectile, projectileDef, context) {
  return context;
}