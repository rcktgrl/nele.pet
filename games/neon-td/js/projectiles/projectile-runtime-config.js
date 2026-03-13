const _projectileResolvedRuntimeCache = new WeakMap();

function invalidateProjectileRuntimeConfig(projectile) {
  _projectileResolvedRuntimeCache.delete(projectile);
}

function mergeProjectileRuntimeConfig(base, override) {
  return mergeProjectileObjects(base, override);
}

function getEffectiveProjectilePipeline(projectile, projectileDef) {
  const cached = _projectileResolvedRuntimeCache.get(projectile);
  if (cached?.pipeline && cached?.def === projectileDef) {
    return cached.pipeline;
  }

  const pipeline = mergeProjectileRuntimeConfig(
    projectileDef.pipeline || {},
    projectile.pipeline || {}
  );

  const entry = cached && cached.def === projectileDef ? cached : { def: projectileDef };
  entry.pipeline = pipeline;
  _projectileResolvedRuntimeCache.set(projectile, entry);

  return pipeline;
}

function getEffectiveProjectileEffects(projectile, projectileDef) {
  const cached = _projectileResolvedRuntimeCache.get(projectile);
  if (cached?.effects && cached?.def === projectileDef) {
    return cached.effects;
  }

  const effects = mergeProjectileRuntimeConfig(
    projectileDef.effects || {},
    projectile.effects || {}
  );

  const entry = cached && cached.def === projectileDef ? cached : { def: projectileDef };
  entry.effects = effects;
  _projectileResolvedRuntimeCache.set(projectile, entry);

  return effects;
}

function getEffectiveProjectileSpecial(projectile, projectileDef) {
  const cached = _projectileResolvedRuntimeCache.get(projectile);
  if (cached?.special && cached?.def === projectileDef) {
    return cached.special;
  }

  const special = mergeProjectileRuntimeConfig(
    projectileDef.special || {},
    projectile.special || {}
  );

  const entry = cached && cached.def === projectileDef ? cached : { def: projectileDef };
  entry.special = special;
  _projectileResolvedRuntimeCache.set(projectile, entry);

  return special;
}