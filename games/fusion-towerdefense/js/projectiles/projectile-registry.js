const _projectileWarnedKeys = new Set();

function warnProjectileOnce(key, message) {
  if (_projectileWarnedKeys.has(key)) return;
  _projectileWarnedKeys.add(key);
  console.warn(message);
}

function cloneProjectileValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(cloneProjectileValue);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = cloneProjectileValue(v);
    }
    return out;
  }
  return value;
}

function mergeProjectileObjects(base, extra) {
  const out = cloneProjectileValue(base);

  if (!extra || typeof extra !== 'object') {
    return out;
  }

  for (const [key, value] of Object.entries(extra)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergeProjectileObjects(out[key], value);
    } else {
      out[key] = cloneProjectileValue(value);
    }
  }

  return out;
}

function getProjectileDef(projectileTypeId) {
  return PROJECTILE_DEFS[projectileTypeId] || null;
}

function getAllProjectileDefs() {
  return Object.values(PROJECTILE_DEFS);
}

function getProjectileResolverFallbackDef(projectileTypeId) {
  return {
    id: projectileTypeId || DEFAULT_PROJECTILE_DEF.id,
    pipelineType: 'standard',
    pipeline: cloneProjectileValue(DEFAULT_STANDARD_PROJECTILE_PIPELINE),
    hooks: cloneProjectileValue(DEFAULT_PROJECTILE_HOOKS),
    effects: {},
    special: {},
    triggers: {},
    visuals: {
      colorMode: 'source_tower'
    }
  };
}

function validateProjectileEnum(def, fieldName, value, validSet, fallbackValue) {
  if (value == null) return fallbackValue;
  if (validSet.has(value)) return value;

  warnProjectileOnce(
    `projectile:${def.id}:invalid:${fieldName}:${String(value)}`,
    `[Projectile Resolver] Unknown ${fieldName} "${value}" on projectile "${def.id}". Falling back to "${fallbackValue}".`
  );
  return fallbackValue;
}

function getDefaultPipelineConfig(pipelineType) {
  if (pipelineType === 'mortar_shell') {
    return DEFAULT_MORTAR_SHELL_PIPELINE;
  }

  if (pipelineType === 'beam') {
    return DEFAULT_BEAM_PROJECTILE_PIPELINE;
  }

  if (pipelineType === 'tesla_chain') {
    return DEFAULT_TESLA_CHAIN_PIPELINE;
  }

  return DEFAULT_STANDARD_PROJECTILE_PIPELINE;
}

function getValidRenderTypesForPipeline(pipelineType) {
  if (pipelineType === 'mortar_shell') {
    return VALID_MORTAR_PIPELINE_RENDER_TYPES;
  }

  if (pipelineType === 'beam') {
    return VALID_BEAM_PIPELINE_RENDER_TYPES;
  }

  if (pipelineType === 'tesla_chain') {
    return VALID_TESLA_CHAIN_PIPELINE_RENDER_TYPES;
  }

  return VALID_STANDARD_PIPELINE_RENDER_TYPES;
}

function resolveProjectileEffect(effectName, rawEffect, def) {
  const resolved = mergeProjectileObjects(DEFAULT_PROJECTILE_EFFECT, rawEffect || {});
  resolved.applyOn = validateProjectileEnum(
    def,
    `effects.${effectName}.applyOn`,
    resolved.applyOn,
    VALID_PROJECTILE_EFFECT_APPLY_ON,
    DEFAULT_PROJECTILE_EFFECT.applyOn
  );
  return resolved;
}

function resolveProjectileEffects(rawEffects, def) {
  if (!rawEffects || typeof rawEffects !== 'object') {
    return {};
  }

  const resolved = {};
  for (const [effectName, rawEffect] of Object.entries(rawEffects)) {
    resolved[effectName] = resolveProjectileEffect(effectName, rawEffect, def);
  }
  return resolved;
}

function resolveProjectileSplit(rawSplit, def) {
  if (rawSplit == null) return undefined;

  const resolved = mergeProjectileObjects(DEFAULT_PROJECTILE_SPLIT, rawSplit);

  if (!resolved.projectileType || typeof resolved.projectileType !== 'string') {
    warnProjectileOnce(
      `projectile:${def.id}:split:missingProjectileType`,
      `[Projectile Resolver] Projectile "${def.id}" has split data but no valid split.projectileType. Split is disabled.`
    );
    return undefined;
  }

  const targetDef = getProjectileDef(resolved.projectileType);
  if (!targetDef) {
    warnProjectileOnce(
      `projectile:${def.id}:split:unknownProjectileType:${resolved.projectileType}`,
      `[Projectile Resolver] Projectile "${def.id}" references unknown split projectile "${resolved.projectileType}". Split is disabled.`
    );
    return undefined;
  }

  if (resolved.projectileType === def.id && rawSplit.depth == null) {
    resolved.depth = 1;
  }

  if (typeof resolved.depth !== 'number' || Number.isNaN(resolved.depth) || resolved.depth < 0) {
    warnProjectileOnce(
      `projectile:${def.id}:split:invalidDepth`,
      `[Projectile Resolver] Projectile "${def.id}" has invalid split.depth. Falling back to 0.`
    );
    resolved.depth = 0;
  }

  if (typeof resolved.delay !== 'number' || Number.isNaN(resolved.delay) || resolved.delay < 0) {
    warnProjectileOnce(
      `projectile:${def.id}:split:invalidDelay`,
      `[Projectile Resolver] Projectile "${def.id}" has invalid split.delay. Falling back to 0.`
    );
    resolved.delay = 0;
  }

  return resolved;
}

function resolveProjectileExplosion(rawExplosion, def) {
  if (rawExplosion == null) return undefined;

  const resolved = mergeProjectileObjects(DEFAULT_PROJECTILE_EXPLOSION, rawExplosion);

  if (typeof resolved.delay !== 'number' || Number.isNaN(resolved.delay) || resolved.delay < 0) {
    warnProjectileOnce(
      `projectile:${def.id}:explosion:invalidDelay`,
      `[Projectile Resolver] Projectile "${def.id}" has invalid explosion.delay. Falling back to 0.`
    );
    resolved.delay = 0;
  }

  return resolved;
}

function resolveProjectileTriggers(rawTriggers, resolvedSpecial, def) {
  const resolved = {};
  const source = rawTriggers && typeof rawTriggers === 'object' ? rawTriggers : {};

  function normalizeTriggerList(triggerKey, list, defaultRule) {
    let rules = list;

    if (!rules && defaultRule) {
      rules = [defaultRule];
    }

    if (!rules) return undefined;

    if (!Array.isArray(rules)) {
      warnProjectileOnce(
        `projectile:${def.id}:triggers:${triggerKey}:notArray`,
        `[Projectile Resolver] Projectile "${def.id}" has non-array triggers.${triggerKey}. Using fallback/default trigger rules.`
      );
      rules = defaultRule ? [defaultRule] : [];
    }

    const out = [];

    for (const rawRule of rules) {
      if (!rawRule || typeof rawRule !== 'object') {
        warnProjectileOnce(
          `projectile:${def.id}:triggers:${triggerKey}:invalidRule`,
          `[Projectile Resolver] Projectile "${def.id}" has an invalid trigger rule in triggers.${triggerKey}. Rule is ignored.`
        );
        continue;
      }

      const when = validateProjectileEnum(
        def,
        `triggers.${triggerKey}.when`,
        rawRule.when,
        VALID_PROJECTILE_TRIGGER_WHEN,
        'onExpire'
      );

      const rule = { when };

      if (when === 'travelDistanceOnce' || when === 'travelDistanceRepeat') {
        if (
          typeof rawRule.distance !== 'number' ||
          Number.isNaN(rawRule.distance) ||
          rawRule.distance <= 0
        ) {
          warnProjectileOnce(
            `projectile:${def.id}:triggers:${triggerKey}:${when}:invalidDistance`,
            `[Projectile Resolver] Projectile "${def.id}" has invalid distance for trigger "${when}" in triggers.${triggerKey}. Rule is ignored.`
          );
          continue;
        }
        rule.distance = rawRule.distance;
      }

      out.push(rule);
    }

    return out.length ? out : undefined;
  }

  const splitRules = normalizeTriggerList(
    'split',
    source.split,
    resolvedSpecial.split ? { when: 'onExpire' } : null
  );
  if (splitRules) {
    resolved.split = splitRules;
  }

  const explosionRules = normalizeTriggerList(
    'explosion',
    source.explosion,
    resolvedSpecial.explosion ? { when: 'onExpire' } : null
  );
  if (explosionRules) {
    resolved.explosion = explosionRules;
  }

  return resolved;
}

function resolveProjectilePipelineConfig(rawDef, def) {
  const rawPipelineType = rawDef.pipelineType ?? DEFAULT_PROJECTILE_DEF.pipelineType;
  const pipelineType = validateProjectileEnum(
    def,
    'pipelineType',
    rawPipelineType,
    VALID_PROJECTILE_PIPELINE_TYPES,
    DEFAULT_PROJECTILE_DEF.pipelineType
  );

  const defaultPipeline = getDefaultPipelineConfig(pipelineType);
  const rawPipeline = rawDef.pipeline && typeof rawDef.pipeline === 'object' ? rawDef.pipeline : {};
  const resolvedPipeline = mergeProjectileObjects(defaultPipeline, rawPipeline);

  resolvedPipeline.renderType = validateProjectileEnum(
    def,
    `pipeline.renderType`,
    resolvedPipeline.renderType,
    getValidRenderTypesForPipeline(pipelineType),
    defaultPipeline.renderType
  );

  if (pipelineType === 'standard') {
    resolvedPipeline.collisionType = validateProjectileEnum(
      def,
      'pipeline.collisionType',
      resolvedPipeline.collisionType,
      VALID_STANDARD_PIPELINE_COLLISION_TYPES,
      DEFAULT_STANDARD_PROJECTILE_PIPELINE.collisionType
    );

    resolvedPipeline.pierceType = validateProjectileEnum(
      def,
      'pipeline.pierceType',
      resolvedPipeline.pierceType,
      VALID_PROJECTILE_PIERCE_TYPES,
      DEFAULT_STANDARD_PROJECTILE_PIPELINE.pierceType
    );
  }

  return {
    pipelineType,
    pipeline: resolvedPipeline
  };
}

function resolveProjectileHooks(rawHooks, def) {
  const source = rawHooks && typeof rawHooks === 'object' ? rawHooks : {};
  const hooks = mergeProjectileObjects(DEFAULT_PROJECTILE_HOOKS, source);

  for (const key of Object.keys(source)) {
    if (!VALID_PROJECTILE_HOOK_KEYS.has(key)) {
      throw new Error(`Unknown hook key "${key}".`);
    }
  }

  for (const hookKey of VALID_PROJECTILE_HOOK_KEYS) {
    const value = hooks[hookKey];

    if (value === null) {
      if (!NULLABLE_PROJECTILE_HOOK_KEYS.has(hookKey)) {
        throw new Error(`Hook "${hookKey}" may not be null.`);
      }
      continue;
    }

    if (typeof value !== 'string' || !hasProjectileHookHandler(value)) {
      throw new Error(`Invalid hook "${hookKey}" value "${String(value)}".`);
    }
  }

  return hooks;
}

function resolveProjectileDef(projectileTypeId) {
  const raw = getProjectileDef(projectileTypeId);
  if (!raw) {
    warnProjectileOnce(
      `projectile:missing:${String(projectileTypeId)}`,
      `[Projectile Resolver] Unknown projectile "${projectileTypeId}". Falling back to default projectile def.`
    );
    return getProjectileResolverFallbackDef(projectileTypeId);
  }

  const def = mergeProjectileObjects(DEFAULT_PROJECTILE_DEF, raw);
  def.id = raw.id || projectileTypeId || DEFAULT_PROJECTILE_DEF.id;

  let resolvedPipelineType = DEFAULT_PROJECTILE_DEF.pipelineType;
  let resolvedPipeline = cloneProjectileValue(DEFAULT_STANDARD_PROJECTILE_PIPELINE);
  let resolvedHooks = cloneProjectileValue(DEFAULT_PROJECTILE_HOOKS);

  try {
    const pipelineConfig = resolveProjectilePipelineConfig(raw, def);
    resolvedPipelineType = pipelineConfig.pipelineType;
    resolvedPipeline = pipelineConfig.pipeline;
    resolvedHooks = resolveProjectileHooks(raw.hooks, def);
  } catch (error) {
    warnProjectileOnce(
      `projectile:${def.id}:pipelineFallback`,
      `[Projectile Resolver] Projectile "${def.id}" has invalid pipeline/hook configuration. Falling back to standard projectile pipeline.`
    );
    resolvedPipelineType = 'standard';
    resolvedPipeline = cloneProjectileValue(DEFAULT_STANDARD_PROJECTILE_PIPELINE);
    resolvedHooks = cloneProjectileValue(DEFAULT_PROJECTILE_HOOKS);
  }

  def.pipelineType = resolvedPipelineType;
  def.pipeline = resolvedPipeline;
  def.hooks = resolvedHooks;
  def.effects = resolveProjectileEffects(raw.effects, def);

  const resolvedSpecial = {};
  const rawSpecial = raw.special && typeof raw.special === 'object' ? raw.special : {};

  if ('split' in rawSpecial) {
    const split = resolveProjectileSplit(rawSpecial.split, def);
    if (split) resolvedSpecial.split = split;
  }

  if ('explosion' in rawSpecial) {
    const explosion = resolveProjectileExplosion(rawSpecial.explosion, def);
    if (explosion) resolvedSpecial.explosion = explosion;
  }

  def.special = resolvedSpecial;
  def.triggers = resolveProjectileTriggers(raw.triggers, resolvedSpecial, def);

  if (raw.visuals && typeof raw.visuals === 'object') {
    def.visuals = cloneProjectileValue(raw.visuals);
  } else {
    def.visuals = { colorMode: 'source_tower' };
  }

  return def;
}