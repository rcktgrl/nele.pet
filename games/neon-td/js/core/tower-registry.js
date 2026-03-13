const DEFAULT_TOWER_STATS = {
  cost: null,
  range: 100,
  damage: 1,
  fireRate: 1,
  projectileSpeed: 400
};

const DEFAULT_TOWER_VISUALS = {
  color: '#ff00ff'
};

const DEFAULT_TOWER_TARGETING = {
  fireCondition: 'target_required',
  targetingMode: 'first',
  retentionMode: 'none',
  rangePolicy: {
    requireInRangeToAcquire: true,
    requireInRangeToFire: true
  },
  aimingMode: 'direct'
};

const DEFAULT_TOWER_SPECIAL = {
  attackType: 'projectile'
};

const DEFAULT_TOWER_ACQUIRE = {
  type: 'buy',
  buyable: false,
  buyCost: null,
  fusionRecipes: [],
  ritualRecipes: []
};

const DEFAULT_TOWER_DESCRIPTION = {
  text: ''
};

const DEFAULT_TOWER_DEF = {
  id: null,
  name: 'noTowerName',
  classes: [],
  tags: [],
  unlock: {
    researchNodeId: null
  },
  acquire: DEFAULT_TOWER_ACQUIRE,
  stats: DEFAULT_TOWER_STATS,
  visuals: DEFAULT_TOWER_VISUALS,
  targeting: DEFAULT_TOWER_TARGETING,
  special: DEFAULT_TOWER_SPECIAL,
  description: DEFAULT_TOWER_DESCRIPTION
};

const resolvedTowerDefCache = new Map();
const towerFallbackWarnCache = new Set();

function warnTowerFallbackOnce(towerId, path, reason, fallbackValue) {
  const key = `${towerId}|${path}|${reason}`;
  if (towerFallbackWarnCache.has(key)) {
    return;
  }

  towerFallbackWarnCache.add(key);
  console.warn(
    `[tower-registry] Tower "${towerId}" used safety fallback for "${path}" (${reason}). Fallback:`,
    fallbackValue
  );
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = cloneValue(value[key]);
    }
    return out;
  }

  return value;
}

function mergeObjects(base, override) {
  const result = cloneValue(base);

  if (!override || typeof override !== 'object') {
    return result;
  }

  for (const key of Object.keys(override)) {
    const value = override[key];

    if (Array.isArray(value)) {
      result[key] = cloneValue(value);
    } else if (value && typeof value === 'object') {
      result[key] = mergeObjects(result[key] ?? {}, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function applySafetyFallbacks(def) {
  const towerId = def.id || 'unknownTower';

  if (!def.name || typeof def.name !== 'string') {
    warnTowerFallbackOnce(towerId, 'name', 'missing_or_invalid', 'noTowerName');
    def.name = 'noTowerName';
  }

  if (!isFiniteNumber(def.stats.range)) {
    warnTowerFallbackOnce(towerId, 'stats.range', 'missing_or_invalid', DEFAULT_TOWER_STATS.range);
    def.stats.range = DEFAULT_TOWER_STATS.range;
  }

  if (!isFiniteNumber(def.stats.damage)) {
    warnTowerFallbackOnce(towerId, 'stats.damage', 'missing_or_invalid', DEFAULT_TOWER_STATS.damage);
    def.stats.damage = DEFAULT_TOWER_STATS.damage;
  }

  if (!isFiniteNumber(def.stats.fireRate) || def.stats.fireRate <= 0) {
    warnTowerFallbackOnce(towerId, 'stats.fireRate', 'missing_or_invalid', DEFAULT_TOWER_STATS.fireRate);
    def.stats.fireRate = DEFAULT_TOWER_STATS.fireRate;
  }

  if (!isFiniteNumber(def.stats.projectileSpeed)) {
    warnTowerFallbackOnce(
      towerId,
      'stats.projectileSpeed',
      'missing_or_invalid',
      DEFAULT_TOWER_STATS.projectileSpeed
    );
    def.stats.projectileSpeed = DEFAULT_TOWER_STATS.projectileSpeed;
  }

  if (!def.visuals.color || typeof def.visuals.color !== 'string') {
    warnTowerFallbackOnce(towerId, 'visuals.color', 'missing_or_invalid', DEFAULT_TOWER_VISUALS.color);
    def.visuals.color = DEFAULT_TOWER_VISUALS.color;
  }

  if (!def.special.attackType || typeof def.special.attackType !== 'string') {
    warnTowerFallbackOnce(
      towerId,
      'special.attackType',
      'missing_or_invalid',
      DEFAULT_TOWER_SPECIAL.attackType
    );
    def.special.attackType = DEFAULT_TOWER_SPECIAL.attackType;
  }

  if (!Array.isArray(def.acquire.fusionRecipes)) {
    warnTowerFallbackOnce(towerId, 'acquire.fusionRecipes', 'missing_or_invalid', []);
    def.acquire.fusionRecipes = [];
  }

  if (!Array.isArray(def.acquire.ritualRecipes)) {
    warnTowerFallbackOnce(towerId, 'acquire.ritualRecipes', 'missing_or_invalid', []);
    def.acquire.ritualRecipes = [];
  }

  if (!Array.isArray(def.classes)) {
    warnTowerFallbackOnce(towerId, 'classes', 'missing_or_invalid', []);
    def.classes = [];
  }

  if (!Array.isArray(def.tags)) {
    warnTowerFallbackOnce(towerId, 'tags', 'missing_or_invalid', []);
    def.tags = [];
  }

  if (!def.description || typeof def.description.text !== 'string') {
    warnTowerFallbackOnce(towerId, 'description.text', 'missing_or_invalid', '');
    def.description = { text: '' };
  }

  return def;
}

function resolveTowerDef(rawDef) {
  const merged = mergeObjects(DEFAULT_TOWER_DEF, rawDef || {});
  return applySafetyFallbacks(merged);
}

function getTowerDef(id) {
  if (!id) {
    return null;
  }

  if (resolvedTowerDefCache.has(id)) {
    return resolvedTowerDefCache.get(id);
  }

  const rawDef = RAW_TOWER_DEFS[id];
  if (!rawDef) {
    return null;
  }

  const resolved = resolveTowerDef(rawDef);
  resolvedTowerDefCache.set(id, resolved);
  return resolved;
}

function getTowerDefsArray() {
  return Object.keys(RAW_TOWER_DEFS)
    .map(getTowerDef)
    .filter(Boolean);
}

function isTowerBuyable(id) {
  const def = getTowerDef(id);
  return !!def?.acquire?.buyable;
}

function getFusionRecipeResult(a, b) {
  const sorted = [a, b].sort().join('+');

  for (const def of getTowerDefsArray()) {
    for (const recipe of def.acquire?.fusionRecipes || []) {
      if ([...recipe].sort().join('+') === sorted) {
        return def;
      }
    }
  }

  return null;
}

function getFusionResult(a, b) {
  const def = getFusionRecipeResult(a, b);
  if (!def) return null;

  const visuals = def.visuals || {};
  const stats = def.stats || {};
  const unlockId = def.unlock?.researchNodeId || def.id;

  if (unlockId && metaProgress.researched[unlockId] === false) {
    return null;
  }

  return {
    name: def.name,
    towerTypeId: def.id,
    damage: stats.damage,
    fireRate: stats.fireRate,
    range: stats.range,
    note: def.description?.text || 'Keine Beschreibung.',
    targetColor: visuals.color || '#ffffff'
  };
}

const towerTypes = Object.fromEntries(
  getTowerDefsArray().map(def => [
    def.id,
    {
      id: def.id,
      name: def.name,
      cost: def.stats.cost,
      range: def.stats.range,
      damage: def.stats.damage,
      fireRate: def.stats.fireRate,
      projectileSpeed: def.stats.projectileSpeed,
      color: def.visuals.color,
      description: def.description.text,
      ...(def.special.magSize != null ? { magSize: def.special.magSize } : {}),
      ...(def.special.reloadTime != null ? { reloadTime: def.special.reloadTime } : {})
    }
  ])
);