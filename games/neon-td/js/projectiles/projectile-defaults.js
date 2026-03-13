const DEFAULT_PROJECTILE_DEF = {
  id: 'noProjectileName',

  pipelineType: 'standard',
  pipeline: {},

  hooks: {},

  effects: {},

  special: {},

  triggers: {}
};

const DEFAULT_STANDARD_PROJECTILE_PIPELINE = {
  renderType: 'orb',
  collisionType: 'circle_hit',
  pierceType: 'none',

  stats: {
    radius: 4,
    life: 2
  },

  pierce: {
    count: 0,
    stages: null
  }
};

const DEFAULT_MORTAR_SHELL_PIPELINE = {
  renderType: 'orb',
  arrivalRadius: 8,

  stats: {
    radius: 6,
    life: 1
  }
};

const DEFAULT_BEAM_PROJECTILE_PIPELINE = {
  renderType: 'beam_line',

  stats: {
    life: 0.08
  },

  lingerTime: 0,
  lineWidth: 3
};

const DEFAULT_TESLA_CHAIN_PIPELINE = {
  renderType: 'beam_arc',

  stats: {
    life: 0.1
  },

  chainCount: 1,
  chainDelay: 0,
  chainRange: 100,
  retargetMode: 'random_unvisited',
  allowRepeatTargets: false
};

const DEFAULT_PROJECTILE_SPLIT = {
  projectileType: 'basic_bullet',
  count: 1,
  spread: 0,
  damageMultiplier: 1,
  speedMultiplier: 1,
  depth: 0,
  delay: 0
};

const DEFAULT_PROJECTILE_EXPLOSION = {
  radius: 0,
  damageMultiplier: 1,
  delay: 0
};

const DEFAULT_PROJECTILE_EFFECT = {
  applyOn: 'onHit'
};

const DEFAULT_PROJECTILE_HOOKS = {
  onSpawn: 'standard_spawn',
  onTick: 'standard_tick',
  onHit: 'standard_hit',
  onKill: 'standard_kill',
  onExpire: 'standard_expire'
};

const VALID_PROJECTILE_PIPELINE_TYPES = new Set([
  'standard',
  'mortar_shell',
  'beam',
  'tesla_chain'
]);

const VALID_STANDARD_PIPELINE_RENDER_TYPES = new Set([
  'orb',
  'rail_slug',
  'none'
]);

const VALID_MORTAR_PIPELINE_RENDER_TYPES = new Set([
  'orb',
  'none'
]);

const VALID_BEAM_PIPELINE_RENDER_TYPES = new Set([
  'beam_line',
  'beam_arc',
  'none'
]);

const VALID_TESLA_CHAIN_PIPELINE_RENDER_TYPES = new Set([
  'beam_arc',
  'none'
]);

const VALID_STANDARD_PIPELINE_COLLISION_TYPES = new Set([
  'circle_hit',
  'segment_hit',
  'none'
]);

const VALID_PROJECTILE_PIERCE_TYPES = new Set([
  'none',
  'count',
  'overpierce',
  'staged'
]);

const VALID_PROJECTILE_EFFECT_APPLY_ON = new Set([
  'onHit',
  'onDirectHit',
  'onExplosionHit'
]);

const VALID_PROJECTILE_TRIGGER_WHEN = new Set([
  'onExpire',
  'travelDistanceOnce',
  'travelDistanceRepeat'
]);

const VALID_PROJECTILE_HOOK_KEYS = new Set([
  'onSpawn',
  'onTick',
  'onHit',
  'onKill',
  'onExpire'
]);

const NULLABLE_PROJECTILE_HOOK_KEYS = new Set([
  'onTick'
]);