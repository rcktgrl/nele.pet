function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function getRampDamageFromStacks(stacks, rampStages, rampStageDuration = 1) {
  if (!Array.isArray(rampStages) || rampStages.length === 0) {
    return 0;
  }

  if (rampStages.length === 1) {
    return rampStages[0];
  }

  const safeDuration = Math.max(0.0001, rampStageDuration || 1);
  const stacksPerStage = safeDuration / 0.1;
  const maxStageIndex = rampStages.length - 1;

  const t = clamp((stacks || 0) / stacksPerStage, 0, maxStageIndex);
  const stageIndex = Math.floor(t);

  if (stageIndex >= maxStageIndex) {
    return rampStages[maxStageIndex];
  }

  const localT = t - stageIndex;
  const from = rampStages[stageIndex];
  const to = rampStages[stageIndex + 1];

  return from + (to - from) * localT;
}

function getInfernoDamageFromTower(tower) {
  return getRampDamageFromStacks(
    tower?.infernoStacks || 0,
    tower?.rampStages || [5, 10, 25, 50, 150],
    tower?.rampStageDuration || 1
  );
}
function snapToGrid(v){return Math.round(v/RESEARCH_GRID_SIZE)*RESEARCH_GRID_SIZE}
function lerp(a,b,t){return a+(b-a)*t}
function getScoreMultiplierForTerrain(p){p=clamp(p,10,100);if(p>=50)return lerp(1,1.2,(100-p)/50);if(p>=25)return lerp(1.2,1.5,(50-p)/25);return lerp(1.5,3,(25-p)/15)}
function getScoreMultiplierForPathLength(v){v=clamp(v,20,50);if(v<=40)return lerp(1.3,1,(v-20)/20);return lerp(1,.8,(v-40)/10)}

function getMapScale() {
  if (!game?.map) return 1;
  const scale = game.map.renderScale;
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(1, scale);
}

function scaleWorldValue(value) {
  return value * getMapScale();
}


function getTowerVisualScale() {
  return getMapScale() * 0.5;
}

function getRangeInPixels(rangeValue) {
  if (!Number.isFinite(rangeValue)) return 0;
  if (rangeValue >= 99999) return Infinity;
  const cellSize = game?.map?.cellSize || BASE_MAP_CELL_SIZE || 72;
  return (rangeValue / 100) * cellSize;
}

