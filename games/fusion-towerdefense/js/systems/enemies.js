const ENEMY_LAYER_COLORS = ['#ffe66b', '#ff667f', '#9d8cff', '#65ff8f'];
const ENEMY_LAYER_HP_MULTIPLIER = 5;

function getEnemyRadiusFromTileRatio(tileDiameterRatio) {
  const cellSize = game?.map?.cellSize || BASE_MAP_CELL_SIZE || 72;
  const safeRatio = Number.isFinite(tileDiameterRatio) ? tileDiameterRatio : 1 / 3;
  return (cellSize * safeRatio) / 2;
}

function getEnemyCatalog(wave) {
  const speedScale = 1 + Math.min(0.45, Math.max(0, wave - 1) * 0.012);
  const baseLayerHp = 50;
  const fastLayerHp = 26;
  const baseSpeed = Math.min((74 + wave * 1.0) * speedScale, 210);
  const waveSizeBonus = Math.min(0.07, Math.max(0, wave - 1) * 0.0025);

  return [
    { key: 'yellow', layerHp: baseLayerHp, speed: baseSpeed, cost: 4, tier: 0, tileDiameterRatio: (1 / 3) + waveSizeBonus, color: '#ffe66b' },
    { key: 'yellow_red', layerHp: baseLayerHp, speed: baseSpeed * 0.92, cost: 24, tier: 1, tileDiameterRatio: 0.4 + waveSizeBonus, color: '#ffe66b' },
    { key: 'yellow_fort', layerHp: baseLayerHp, speed: baseSpeed * 0.82, cost: 144, tier: 2, tileDiameterRatio: 0.46 + waveSizeBonus, color: '#ffe66b' },
    { key: 'fast_1', layerHp: fastLayerHp, speed: baseSpeed * 1.95, cost: 4, tier: 0, tileDiameterRatio: 0.28 + waveSizeBonus * 0.5, color: '#59f3ff', isFast: true },
    { key: 'fast_2', layerHp: fastLayerHp, speed: baseSpeed * 1.78, cost: 24, tier: 1, tileDiameterRatio: 0.34 + waveSizeBonus * 0.5, color: '#59f3ff', isFast: true },
    { key: 'fast_3', layerHp: fastLayerHp, speed: baseSpeed * 1.62, cost: 864, tier: 3, tileDiameterRatio: 0.4 + waveSizeBonus * 0.5, color: '#59f3ff', isFast: true },
    { key: 'infinity', layerHp: Math.max(4, Math.floor(6 * Math.pow(1.2, Math.max(0, wave - 1)))), speed: baseSpeed * 1.35, cost: 4, tier: 0, tileDiameterRatio: 0.24, color: '#ffffff', isInfinity: true }
  ];
}

function buildEnemyLayers(layerHpBase, tier) {
  const layers = [];

  for (let i = 0; i <= tier; i++) {
    layers.push({
      maxHp: Math.max(1, Math.floor(layerHpBase * Math.pow(ENEMY_LAYER_HP_MULTIPLIER, i))),
      hp: Math.max(1, Math.floor(layerHpBase * Math.pow(ENEMY_LAYER_HP_MULTIPLIER, i))),
      color: ENEMY_LAYER_COLORS[i] || ENEMY_LAYER_COLORS[ENEMY_LAYER_COLORS.length - 1],
      rewardWeight: Math.pow(ENEMY_LAYER_HP_MULTIPLIER, i)
    });
  }

  return layers;
}

function createEnemyFromTemplate(template, wave, moneyLossPercent) {
  const countMult = Math.max(1, mapConfig.enemyCountMultiplier || 1);

  if (template.key === 'boss') {
    const tileDiameterRatio = Number.isFinite(template.tileDiameterRatio) ? template.tileDiameterRatio : null;
    const bossRadius = tileDiameterRatio != null
      ? getEnemyRadiusFromTileRatio(tileDiameterRatio)
      : scaleWorldValue(template.radius);

    return {
      instanceId: null,
      maxHp: template.hp,
      hp: template.hp,
      speed: template.speed,
      reward: (template.reward / (1 + Math.max(0, moneyLossPercent) / 100)) / countMult,
      rewardGranted: false,
      pathIndex: 0,
      baseRadius: template.radius,
      tileDiameterRatio,
      radius: bossRadius,
      isBoss: true,
      isFast: false,
      damageByTower: {},
      lastDamageWindow: 0,
      stunCooldown: 1,
      stunPulseTimer: 1,
      color: '#ff667f',
      core: '#ff5edc',
      key: 'boss'
    };
  }

  const catalog = getEnemyCatalog(wave);
  const data = catalog.find(e => e.key === template.key) || catalog[0];
  const tier = Number.isFinite(data.tier) ? data.tier : 0;
  const layers = buildEnemyLayers(data.layerHp, tier);
  const rewardWeightTotal = layers.reduce((sum, layer) => sum + layer.rewardWeight, 0) || 1;
  const enemyBudgetValue = data.cost;
  const rewardLayers = layers.map(layer =>
    ((enemyBudgetValue * (layer.rewardWeight / rewardWeightTotal)) / (1 + Math.max(0, moneyLossPercent) / 100)) / countMult
  );

  return {
    instanceId: null,
    maxHp: layers.reduce((sum, layer) => sum + layer.maxHp, 0),
    hp: layers.reduce((sum, layer) => sum + layer.hp, 0),
    speed: data.speed,
    reward: rewardLayers.reduce((sum, r) => sum + r, 0),
    rewardLayers,
    rewardGranted: false,
    pathIndex: 0,
    baseRadius: data.radius,
    tileDiameterRatio: data.tileDiameterRatio,
    radius: getEnemyRadiusFromTileRatio(data.tileDiameterRatio),
    isBoss: false,
    isFast: !!data.isFast,
    isInfinity: !!data.isInfinity,
    damageByTower: {},
    lastDamageWindow: 0,
    stunCooldown: 1,
    stunPulseTimer: 1,
    color: data.color,
    core: null,
    key: data.key,
    layers,
    activeLayerIndex: layers.length - 1,
    layerHp: layers[layers.length - 1].hp,
    layerMaxHp: layers[layers.length - 1].maxHp,
    layerColor: layers[layers.length - 1].color,
    enemyBudgetValue
  };
}

function getEnemyVelocity(e){if(!game.map)return{vx:0,vy:0};const ni=Math.min(e.pathIndex+1,game.map.pathPoints.length-1),np=game.map.pathPoints[ni],dx=np.x-e.x,dy=np.y-e.y,dist=Math.hypot(dx,dy)||1;return{vx:dx/dist*e.speed,vy:dy/dist*e.speed}}
function getInterceptPoint(sx,sy,t,ps){const v=getEnemyVelocity(t),tx=t.x-sx,ty=t.y-sy;const distance=Math.hypot(tx,ty);if(distance<24)return{x:t.x,y:t.y};const a=v.vx*v.vx+v.vy*v.vy-ps*ps,b=2*(tx*v.vx+ty*v.vy),c=tx*tx+ty*ty;let time;if(Math.abs(a)<.0001){if(Math.abs(b)<.0001)return{x:t.x,y:t.y};time=c/Math.max(.0001,-b)}else{const disc=b*b-4*a*c;if(disc<0)return{x:t.x,y:t.y};const t1=(-b+Math.sqrt(disc))/(2*a),t2=(-b-Math.sqrt(disc))/(2*a),valid=[t1,t2].filter(v=>v>0);if(!valid.length)return{x:t.x,y:t.y};time=Math.min(...valid)}if(!Number.isFinite(time)||time<0)return{x:t.x,y:t.y};time=clamp(time,0,1.5);return{x:t.x+v.vx*time,y:t.y+v.vy*time}}
