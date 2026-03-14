function applyLeakPenalty(l){game.money+=l*Math.min(100,30+10*game.wave);const intended=250*l;if(game.score>=intended)game.score-=intended;else game.runScorePenaltyMult-=.02*l;if(game.score<0)game.score=0}

function rewardEnemyBudget(amount){
  if(game.gameOver||game.victory)return;
  const safeReward=Math.max(0,amount||0);
  if(safeReward<=0)return;
  game.money+=safeReward;
  const eff=getTotalScoreMultiplier();
  const gain=Math.round(Math.max(1,safeReward)*2.5*eff);
  game.score+=gain;
  game.runEarnedScore+=gain;
}

function recomputeEnemyHpFromLayers(enemy){
  if(!Array.isArray(enemy.layers)||!enemy.layers.length)return;
  let total=0;
  for(let i=0;i<=enemy.activeLayerIndex;i++){
    total+=Math.max(0,enemy.layers[i].hp);
  }
  enemy.hp=total;
}

function syncEnemyLayerVisualState(enemy){
  if(!Array.isArray(enemy.layers)||!enemy.layers.length)return;
  const idx=Math.max(0,Math.min(enemy.layers.length-1,enemy.activeLayerIndex));
  const active=enemy.layers[idx];
  enemy.activeLayerIndex=idx;
  enemy.layerHp=Math.max(0,active.hp);
  enemy.layerMaxHp=Math.max(1,active.maxHp);
  enemy.layerColor=active.color;
  enemy.color=enemy.layers[0].color;
}

function applyEnemyDamage(enemy, rawDamage, sourceTowerId){
  const damage=Math.max(0,rawDamage||0);
  if(!enemy||damage<=0)return{didHit:false,didKill:false,reward:0};

  if(sourceTowerId)enemy.lastHitTowerId=sourceTowerId;

  if(enemy.isBoss||!Array.isArray(enemy.layers)||!enemy.layers.length){
    enemy.hp-=damage;
    if(enemy.hp<=0){
      enemy.hp=0;
      if(!enemy.rewardGranted){
        rewardEnemyBudget(enemy.reward||0);
        enemy.rewardGranted=true;
      }
      return{didHit:true,didKill:true,reward:enemy.reward||0};
    }
    return{didHit:true,didKill:false,reward:0};
  }

  let remainingDamage=damage;
  let rewardPaid=0;

  while(remainingDamage>0&&enemy.activeLayerIndex>=0){
    const layer=enemy.layers[enemy.activeLayerIndex];
    if(!layer)break;

    if(remainingDamage>=layer.hp){
      remainingDamage-=layer.hp;
      layer.hp=0;

      const layerReward=enemy.rewardLayers?.[enemy.activeLayerIndex]||0;
      rewardEnemyBudget(layerReward);
      rewardPaid+=layerReward;

      enemy.activeLayerIndex-=1;
      if(enemy.activeLayerIndex>=0){
        syncEnemyLayerVisualState(enemy);
      }
    }else{
      layer.hp-=remainingDamage;
      remainingDamage=0;
    }
  }

  if(enemy.activeLayerIndex<0){
    enemy.hp=0;
    enemy.rewardGranted=true;
    return{didHit:true,didKill:true,reward:rewardPaid};
  }

  syncEnemyLayerVisualState(enemy);
  recomputeEnemyHpFromLayers(enemy);
  return{didHit:true,didKill:false,reward:rewardPaid};
}

function updateEnemies(dt){if(!game.map||game.gameOver||game.victory)return;for(let i=game.enemies.length-1;i>=0;i--){const e=game.enemies[i];if(e.isBoss){e.lastDamageWindow=Math.max(0,(e.lastDamageWindow||0)-dt);e.stunCooldown=Math.max(0,(e.stunCooldown||0)-dt);e.stunPulseTimer=Math.max(0,(e.stunPulseTimer||0)-dt);if(e.lastDamageWindow===0)e.damageByTower={};if(e.stunPulseTimer===0){let top=null,dam=0;for(const [id,d] of Object.entries(e.damageByTower||{}))if(d>dam){dam=d;top=id}if(top&&e.stunCooldown===0){const tower=game.towers.find(t=>t.instanceId===top);if(tower){tower.stunTimer=1;e.stunCooldown=1}}e.stunPulseTimer=1;e.damageByTower={};e.lastDamageWindow=1}}const ni=e.pathIndex+1;if(ni>=game.map.pathPoints.length){game.enemies.splice(i,1);const lost=e.isBoss?5:1;game.lives-=lost;applyLeakPenalty(lost);if(game.lives<=0){game.lives=0;game.gameOver=true;game.running=false;game.waveInProgress=false;game.intermission=false;game.spawnQueue=[];finalizeRun(false);break}continue}e.stunTimer=Math.max(0,(e.stunTimer||0)-dt);if(e.stunTimer>0)continue;const t=game.map.pathPoints[ni],dx=t.x-e.x,dy=t.y-e.y,dist=Math.hypot(dx,dy),step=e.speed*dt;if(dist<=step){e.x=t.x;e.y=t.y;e.pathIndex=ni}else{e.x+=dx/dist*step;e.y+=dy/dist*step}}}
function addChainLightning(start,base){let cur=start;const hit=new Set([cur.instanceId]);let dmg=base;for(let c=0;c<4;c++){let next=null,best=Infinity;for(const e of game.enemies){if(hit.has(e.instanceId))continue;const d=Math.hypot(e.x-cur.x,e.y-cur.y);if(d<best&&d<=140){best=d;next=e}}if(!next)break;hit.add(next.instanceId);game.effects.push({type:'lightning',x1:cur.x,y1:cur.y,x2:next.x,y2:next.y,life:.1});applyEnemyDamage(next,dmg,null);cur=next;dmg*=.8}}
function rewardEnemyKill(e){if(game.gameOver||game.victory)return;if(!e?.rewardGranted){rewardEnemyBudget(e.reward||0);e.rewardGranted=true}}
