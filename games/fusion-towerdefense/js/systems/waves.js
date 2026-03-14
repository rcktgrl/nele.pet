function getWaveRoundScoreMultiplier(wave){
  return 1+Math.max(0,wave-1)*0.12;
}

function getWaveMoneyMultiplier(wave){
  return 1+Math.max(0,wave-1)*0.08;
}

function getCatalogEntryByKey(catalog,key){
  return catalog.find(e=>e.key===key)||catalog[0];
}

function buildEntriesFromBudget(budget,catalog,wave){
  const entries=[];
  let remaining=Math.max(1,Math.floor(budget));
  const sorted=[...catalog].filter(e=>!e.isInfinity).sort((a,b)=>b.cost-a.cost);

  if(!sorted.length){
    return [{key:'infinity',count:Math.max(1,remaining)}];
  }

  while(remaining>0){
    const progress=remaining/Math.max(1,budget);
    const pool=sorted.filter(e=>e.cost<=remaining&&(!e.isFast||Math.random()>0.22+progress*0.35));
    const pick=(pool.length?pool:sorted.filter(e=>e.cost<=remaining))[0];
    if(!pick)break;
    const existing=entries.find(en=>en.key===pick.key);
    if(existing)existing.count+=1;
    else entries.push({key:pick.key,count:1});
    remaining-=pick.cost;
  }

  if(remaining>0){
    const filler=sorted.filter(e=>e.cost===1)[0]||sorted[sorted.length-1];
    const existing=entries.find(en=>en.key===filler.key);
    if(existing)existing.count+=remaining;
    else entries.push({key:filler.key,count:remaining});
    remaining=0;
  }

  const countMult=Math.max(1,mapConfig.enemyCountMultiplier||1);
  for(const entry of entries){
    entry.count=Math.max(1,Math.round(entry.count*countMult));
  }

  return entries;
}

function getSpentBudget(entries,catalog){
  let spent=0;
  for(const entry of entries){
    const info=getCatalogEntryByKey(catalog,entry.key);
    spent+=info.cost*(entry.count||1)/Math.max(1,mapConfig.enemyCountMultiplier||1);
  }
  return spent;
}

function generateWavePlan(wave){
  const catalog=getEnemyCatalog(wave);

  if(wave%10===0){
    const moneyMultiplier=getWaveMoneyMultiplier(wave);
    const roundScoreMultiplier=getWaveRoundScoreMultiplier(wave);
    const bossHp=Math.floor(650+wave*120+Math.pow(wave,1.6)*26);
    const bossBudget=Math.max(120,Math.floor(170+Math.pow(wave,1.25)*34));

    return {
      wave,
      budget:bossBudget,
      moneyMultiplier,
      roundScoreMultiplier,
      bossWave:true,
      spawnGap:.24,
      preview:`Boss mit ${bossHp} HP`,
      entries:[{key:'boss',count:Math.max(1,Math.round(1*Math.max(1,mapConfig.enemyCountMultiplier||1))),hp:bossHp,speed:Math.min(54+wave*1.45,110),reward:bossBudget,radius:28,cost:bossBudget}]
    };
  }

  const baseBudget=Math.floor(10+Math.pow(wave,1.22)*6);
  const budget=Math.max(8,baseBudget+Math.floor(Math.random()*6));
  const entries=buildEntriesFromBudget(budget,catalog,wave);
  const spent=getSpentBudget(entries,catalog);
  const moneyMultiplier=getWaveMoneyMultiplier(wave);
  const roundScoreMultiplier=getWaveRoundScoreMultiplier(wave);
  const totalCount=entries.reduce((a,e)=>a+e.count,0);
  const preview=entries.map(e=>`${e.count}× ${e.key.replace('_',' ')}`).join(', ');
  const spawnGap=Math.max(.11,Math.min(.46,2.35/(Math.sqrt(totalCount)+spent*.036)));

  return {wave,budget:spent,moneyMultiplier,roundScoreMultiplier,bossWave:false,spawnGap,preview,entries};
}

function queueWave(){if(game.wave>=game.maxWaves){if(!game.victory&&!game.enemies.length&&!game.spawnQueue.length){game.victory=true;finalizeRun(true)}return}game.wave+=1;const def=game.pendingWaveDefs.shift()||generateWavePlan(game.wave);while(game.pendingWaveDefs.length<3&&game.wave+game.pendingWaveDefs.length<game.maxWaves)game.pendingWaveDefs.push(generateWavePlan(game.wave+game.pendingWaveDefs.length+1));game.currentWaveInfo=def;game.currentMoneyMultiplier=Math.max(1,def.moneyMultiplier||1);game.roundScoreMultiplier=Math.max(1,def.roundScoreMultiplier||1);game.spawnQueue=[];for(const entry of def.entries){const count=entry.count||1;const spacingMultiplier=count>20?1:lerp(3.2,1.1,(count-1)/19);for(let i=0;i<count;i++){const enemy=createEnemyFromTemplate(entry,game.wave,game.currentMoneyMultiplier);enemy.spawnGapMultiplier=spacingMultiplier;game.spawnQueue.push(enemy)}}game.timeUntilNextSpawn=0;game.waveInProgress=true;game.intermission=false;setStatus(def.bossWave?`Boss-Wave ${game.wave} gestartet.`:`Wave ${game.wave} gestartet.`);updateWavePreviewUI();updateHUD()}
function spawnEnemyFromQueue(){if(!game.spawnQueue.length||!game.map)return;const e=game.spawnQueue.shift(),s=game.map.pathPoints[0];e.instanceId=`enemy_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;e.x=s.x;e.y=s.y;game.enemies.push(e);const baseGap=game.currentWaveInfo?game.currentWaveInfo.spawnGap:.4;game.timeUntilNextSpawn=baseGap*(e.spawnGapMultiplier||1)}
