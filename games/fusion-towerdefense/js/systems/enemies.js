function getEnemyRadiusFromTileRatio(tileDiameterRatio) {
  const cellSize = game?.map?.cellSize || BASE_MAP_CELL_SIZE || 72;
  const safeRatio = Number.isFinite(tileDiameterRatio) ? tileDiameterRatio : 1 / 3;
  return (cellSize * safeRatio) / 2;
}

function getEnemyCatalog(wave){
  const hpScale=Math.pow(1.115,Math.max(0,wave-4));
  const speedScale=1+Math.min(.55,Math.max(0,wave-4)*.018);
  const rewardScale=Math.pow(1.07,Math.max(0,wave-4));
  const baseHp=Math.floor((30+wave*4.5+Math.pow(wave,1.08)*1.8)*hpScale);
  const baseSpeed=Math.min((74+wave*1.35)*speedScale,210);
  const baseReward=Math.max(5,Math.floor((7+wave*.28)*rewardScale));
  const fastBase=Math.max(8,Math.floor(baseHp*.5));
  const infinityHp=Math.max(4,Math.floor(6*Math.pow(1.2,Math.max(0,wave-1))));
  const waveSizeBonus=Math.min(.07,Math.max(0,wave-1)*.0025);

  return[
    {key:'yellow',hp:baseHp,speed:baseSpeed,reward:baseReward,cost:1,tileDiameterRatio:(1/3)+waveSizeBonus,color:'#ffe66b'},
    {key:'yellow_red',hp:baseHp*3,speed:baseSpeed*.92,reward:baseReward,cost:3,tileDiameterRatio:.4+waveSizeBonus,color:'#ffe66b',core:'#ff667f'},
    {key:'yellow_fort',hp:baseHp*9,speed:baseSpeed*.82,reward:baseReward,cost:9,tileDiameterRatio:.46+waveSizeBonus,color:'#ffe66b',core:'#9d8cff'},
    {key:'fast_1',hp:fastBase,speed:baseSpeed*1.95,reward:Math.max(4,Math.floor(baseReward*.78)),cost:1.1,tileDiameterRatio:.28+waveSizeBonus*.5,color:'#59f3ff',isFast:true},
    {key:'fast_2',hp:fastBase*3,speed:baseSpeed*1.78,reward:Math.max(4,Math.floor(baseReward*.78)),cost:3.3,tileDiameterRatio:.34+waveSizeBonus*.5,color:'#59f3ff',core:'#ff667f',isFast:true},
    {key:'fast_3',hp:fastBase*9,speed:baseSpeed*1.62,reward:Math.max(4,Math.floor(baseReward*.78)),cost:9.9,tileDiameterRatio:.4+waveSizeBonus*.5,color:'#59f3ff',core:'#9d8cff',isFast:true},
    {key:'infinity',hp:infinityHp,speed:baseSpeed*1.35,reward:1,cost:.05,tileDiameterRatio:.24,color:'#ffffff',core:'#08101f',isInfinity:true}
  ]
}

function createEnemyFromTemplate(template,wave,enemyMultiplier){
  const countMult=Math.max(1,mapConfig.enemyCountMultiplier||1);

  if(template.key==='boss'){
    const tileDiameterRatio = Number.isFinite(template.tileDiameterRatio) ? template.tileDiameterRatio : null;
    const bossRadius = tileDiameterRatio != null
      ? getEnemyRadiusFromTileRatio(tileDiameterRatio)
      : scaleWorldValue(template.radius);

    return {
      instanceId:null,
      maxHp:template.hp,
      hp:template.hp,
      speed:template.speed,
      reward:Math.max(.35,(template.reward/Math.max(1,enemyMultiplier))/countMult),
      pathIndex:0,
      baseRadius:template.radius,
      tileDiameterRatio,
      radius:bossRadius,
      isBoss:true,
      isFast:false,
      damageByTower:{},
      lastDamageWindow:0,
      stunCooldown:1,
      stunPulseTimer:1,
      color:'#ff667f',
      core:'#ff5edc'
    }
  }

  const data=getEnemyCatalog(wave).find(e=>e.key===template.key)||getEnemyCatalog(wave)[0];
  return {
    instanceId:null,
    maxHp:data.hp,
    hp:data.hp,
    speed:data.speed,
    reward:Math.max(.35,(data.reward/Math.max(1,enemyMultiplier))/countMult),
    pathIndex:0,
    baseRadius:data.radius,
    tileDiameterRatio:data.tileDiameterRatio,
    radius:getEnemyRadiusFromTileRatio(data.tileDiameterRatio),
    isBoss:false,
    isFast:!!data.isFast,
    isInfinity:!!data.isInfinity,
    damageByTower:{},
    lastDamageWindow:0,
    stunCooldown:1,
    stunPulseTimer:1,
    color:data.color,
    core:data.core||null,
    key:data.key
  }
}

function getEnemyVelocity(e){if(!game.map)return{vx:0,vy:0};const ni=Math.min(e.pathIndex+1,game.map.pathPoints.length-1),np=game.map.pathPoints[ni],dx=np.x-e.x,dy=np.y-e.y,dist=Math.hypot(dx,dy)||1;return{vx:dx/dist*e.speed,vy:dy/dist*e.speed}}
function getInterceptPoint(sx,sy,t,ps){const v=getEnemyVelocity(t),tx=t.x-sx,ty=t.y-sy;const distance=Math.hypot(tx,ty);if(distance<24)return{x:t.x,y:t.y};const a=v.vx*v.vx+v.vy*v.vy-ps*ps,b=2*(tx*v.vx+ty*v.vy),c=tx*tx+ty*ty;let time;if(Math.abs(a)<.0001){if(Math.abs(b)<.0001)return{x:t.x,y:t.y};time=c/Math.max(.0001,-b)}else{const disc=b*b-4*a*c;if(disc<0)return{x:t.x,y:t.y};const t1=(-b+Math.sqrt(disc))/(2*a),t2=(-b-Math.sqrt(disc))/(2*a),valid=[t1,t2].filter(v=>v>0);if(!valid.length)return{x:t.x,y:t.y};time=Math.min(...valid)}if(!Number.isFinite(time)||time<0)return{x:t.x,y:t.y};time=clamp(time,0,1.5);return{x:t.x+v.vx*time,y:t.y+v.vy*time}}
