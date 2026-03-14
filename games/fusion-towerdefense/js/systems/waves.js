function getWaveRoundScoreMultiplier(wave){
  return 1+Math.max(0,wave-1)*0.14;
}

function getWaveMoneyLossPercent(wave){
  return Math.max(0,(wave-1)*6);
}

function getCatalogEntryByKey(catalog,key){
  return catalog.find(e=>e.key===key)||catalog[0];
}

function getSpentBudget(entries,catalog){
  let spent=0;
  for(const entry of entries){
    const info=getCatalogEntryByKey(catalog,entry.key);
    spent+=info.cost*(entry.count||1);
  }
  return spent;
}

function getWaveSpawnDurationSec(wave){
  return Math.min(30,12+wave*1.25);
}

function getChunkCountForDuration(durationSec){
  return clamp(Math.round(durationSec/4.5),3,8);
}

function normalizeChunkBudgets(chunkBudgets,totalBudget){
  const sum=chunkBudgets.reduce((a,b)=>a+b,0)||1;
  return chunkBudgets.map(v=>v/sum*totalBudget);
}

function buildChunkBudgets(totalBudget,chunkCount){
  const avg=totalBudget/chunkCount;
  const chunks=[];
  for(let i=0;i<chunkCount;i++)chunks.push(avg*(0.8+Math.random()*0.4));

  if(Math.random()<0.34&&chunkCount>=3){
    const pivot=1+Math.floor(Math.random()*(chunkCount-2));
    chunks[pivot]=avg*(2.6+Math.random()*1.6);
    chunks[pivot-1]*=0.45;
    chunks[pivot+1]*=0.45;
  }

  return normalizeChunkBudgets(chunks,totalBudget);
}

function pickEnemyForBudget(catalog,waveBudget,localBudget,spawnCounts){
  const minAffordability=3;
  const maxAffordableCost=waveBudget/minAffordability;
  const affordable=catalog.filter(e=>!e.isInfinity&&e.cost<=localBudget&&e.cost<=maxAffordableCost);
  if(!affordable.length)return null;

  const filtered=affordable.filter(e=>waveBudget/e.cost<150);
  const pool=filtered.length?filtered:affordable;

  let totalWeight=0;
  const weighted=pool.map(enemy=>{
    const fit20=Math.max(0.12,1-Math.min(1,Math.abs((waveBudget/Math.max(1,enemy.cost))-20)/20));
    const cheapBias=1/Math.pow(Math.max(1,enemy.cost),0.25);
    const repeatPenalty=1/(1+(spawnCounts[enemy.key]||0)*0.75);
    const weight=(0.25+fit20)*cheapBias*repeatPenalty;
    totalWeight+=weight;
    return{enemy,weight};
  });

  let roll=Math.random()*Math.max(0.0001,totalWeight);
  for(const item of weighted){
    roll-=item.weight;
    if(roll<=0)return item.enemy;
  }

  return weighted[weighted.length-1].enemy;
}

function determinePackCount(enemy,waveBudget,localBudget){
  const maxByBudget=Math.max(1,Math.floor(localBudget/enemy.cost));
  const idealByBudget=Math.max(2,Math.round((waveBudget/enemy.cost)/20*4));

  const minPack=maxByBudget>=3?2:1;
  const target=clamp(idealByBudget, minPack, Math.min(18,maxByBudget));
  const randomSwing=Math.random()<0.72 ? (Math.random()*0.35+0.9) : (Math.random()*0.6+0.55);

  let packCount=clamp(Math.round(target*randomSwing), minPack, maxByBudget);

  if(maxByBudget>=2 && Math.random()<0.88){
    packCount=Math.max(2,packCount);
  }

  return packCount;
}

function getPackSpacingSec(packCount){
  const base=0.17+Math.random()*0.22;
  if(packCount>=8) return clamp(base*0.9,0.12,0.4);
  if(packCount<=2) return clamp(base*1.15,0.16,0.6);
  return clamp(base,0.13,0.5);
}


function softenDenseSpawnStacks(events,duration){
  if(!events.length) return events;

  const sorted=[...events].sort((a,b)=>a.time-b.time);
  let i=0;

  while(i<sorted.length){
    let j=i+1;
    const time=sorted[i].time;

    while(j<sorted.length && Math.abs(sorted[j].time-time)<1e-9){
      j+=1;
    }

    const count=j-i;
    if(count>=4){
      for(let k=i;k<j;k++){
        const spreadIndex=k-i;
        sorted[k].time=time+spreadIndex*0.012+Math.random()*0.004;
        if(Number.isFinite(duration)){
          sorted[k].time=Math.min(sorted[k].time,Math.max(0,duration));
        }
      }
    }

    i=j;
  }

  return sorted;
}


function buildTimelinePlan(wave,budget,catalog,restrictedKeys=null){
  const duration=getWaveSpawnDurationSec(wave);
  const chunkCount=getChunkCountForDuration(duration);
  const chunkDuration=duration/chunkCount;
  const chunkBudgets=buildChunkBudgets(budget,chunkCount);
  const countsByKey={};
  const events=[];

  let carryBudget=0;

  for(let chunk=0;chunk<chunkCount;chunk++){
    let localBudget=chunkBudgets[chunk]+carryBudget;
    let cursor=chunk*chunkDuration;
    const chunkEnd=(chunk+1)*chunkDuration;

    while(localBudget>=1){
      const sourceCatalog=Array.isArray(restrictedKeys)
        ? catalog.filter(e=>restrictedKeys.includes(e.key))
        : catalog;
      const enemy=pickEnemyForBudget(sourceCatalog,budget,localBudget,countsByKey);
      if(!enemy)break;

      const packCount=determinePackCount(enemy,budget,localBudget);
      const spacing=getPackSpacingSec(packCount);

      for(let i=0;i<packCount;i++){
        events.push({time:cursor,key:enemy.key});
        cursor+=spacing;
      }

      countsByKey[enemy.key]=(countsByKey[enemy.key]||0)+packCount;
      localBudget-=enemy.cost*packCount;

      if(cursor<chunkEnd&&Math.random()<0.88){
        cursor+=Math.random()*0.3;
      }

      if(localBudget>0&&localBudget<enemy.cost&&Math.random()<0.8){
        break;
      }
    }

    carryBudget=Math.max(0,localBudget);
  }

  if(carryBudget>=1){
    const fallback=pickEnemyForBudget(catalog,budget,carryBudget,countsByKey);
    if(fallback){
      const maxByBudget=Math.max(1,Math.floor(carryBudget/fallback.cost));
      const packCount=maxByBudget>=2?Math.max(2,Math.min(6,maxByBudget)):1;
      const spacing=getPackSpacingSec(packCount);
      let cursor=Math.max(0,duration-packCount*spacing);
      for(let i=0;i<packCount;i++){
        events.push({time:cursor,key:fallback.key});
        cursor+=spacing;
      }
    }
  }

  if(!events.length){
    events.push({time:0,key:'yellow'});
  }

  softenDenseSpawnStacks(events,duration);
  events.sort((a,b)=>a.time-b.time);

  const entriesMap=new Map();
  for(const ev of events){
    entriesMap.set(ev.key,(entriesMap.get(ev.key)||0)+1);
  }
  const entries=[...entriesMap.entries()].map(([key,count])=>({key,count}));

  return {duration,events,entries,budget:getSpentBudget(entries,catalog)};
}

function generateWavePlan(wave){
  const catalog=getEnemyCatalog(wave);
  const moneyLossPercent=getWaveMoneyLossPercent(wave);
  const roundScoreMultiplier=getWaveRoundScoreMultiplier(wave);

  if(wave%10===0){
    const bossHp=Math.floor(720+wave*145+Math.pow(wave,1.68)*34);
    const bossBudget=Math.max(180,Math.floor(260+Math.pow(wave,1.35)*52));
    return {
      wave,budget:bossBudget,moneyLossPercent,roundScoreMultiplier,bossWave:true,spawnGap:.22,
      preview:`Boss mit ${bossHp} HP`,
      timelineEvents:[{time:0,key:'boss'}],
      entries:[{key:'boss',count:1,hp:bossHp,speed:Math.min(54+wave*1.45,110),reward:bossBudget,radius:28,cost:bossBudget}],
      spawnDurationSec:8
    };
  }

  if(wave===1){
    const fixedEntries=[{key:'yellow',count:8},{key:'fast_1',count:2}];
    const plan=buildTimelinePlan(wave,getSpentBudget(fixedEntries,catalog),catalog,['yellow','fast_1']);
    return {wave,budget:plan.budget,moneyLossPercent,roundScoreMultiplier,bossWave:false,spawnGap:.34,preview:'8× yellow, 2× fast 1',entries:plan.entries,timelineEvents:plan.events,spawnDurationSec:plan.duration};
  }

  if(wave===2){
    const fixedEntries=[{key:'yellow',count:9},{key:'fast_1',count:3}];
    const plan=buildTimelinePlan(wave,getSpentBudget(fixedEntries,catalog),catalog,['yellow','fast_1']);
    return {wave,budget:plan.budget,moneyLossPercent,roundScoreMultiplier,bossWave:false,spawnGap:.32,preview:'9× yellow, 3× fast 1',entries:plan.entries,timelineEvents:plan.events,spawnDurationSec:plan.duration};
  }

  if(wave===3){
    const fixedBudget=getSpentBudget([{key:'yellow',count:10},{key:'fast_1',count:2},{key:'yellow_red',count:1}],catalog);
    const plan=buildTimelinePlan(wave,fixedBudget,catalog,['yellow','fast_1']);
    plan.events.push({time:Math.max(1,Math.min(plan.duration-1,plan.duration*0.58)),key:'yellow_red'});
    plan.events.sort((a,b)=>a.time-b.time);
    const map=new Map();
    for(const ev of plan.events)map.set(ev.key,(map.get(ev.key)||0)+1);
    plan.entries=[...map.entries()].map(([key,count])=>({key,count}));
    plan.budget=getSpentBudget(plan.entries,catalog);
    return {wave,budget:plan.budget,moneyLossPercent,roundScoreMultiplier,bossWave:false,spawnGap:.30,preview:'weak + 1× yellow red',entries:plan.entries,timelineEvents:plan.events,spawnDurationSec:plan.duration};
  }

  const baseBudget=Math.floor(40+Math.pow(wave,1.42)*14+wave*4.5);
  const budget=Math.max(40,baseBudget+Math.floor(Math.random()*12));
  const plan=buildTimelinePlan(wave,budget,catalog,null);
  const preview=plan.entries.map(e=>`${e.count}× ${e.key.replace('_',' ')}`).join(', ');

  return {wave,budget:plan.budget,moneyLossPercent,roundScoreMultiplier,bossWave:false,spawnGap:.26,preview,entries:plan.entries,timelineEvents:plan.events,spawnDurationSec:plan.duration};
}

function queueWave(){
  if(game.wave>=game.maxWaves){
    if(!game.victory&&!game.enemies.length&&!game.spawnQueue.length){game.victory=true;finalizeRun(true)}
    return;
  }

  game.wave+=1;
  const def=game.pendingWaveDefs.shift()||generateWavePlan(game.wave);
  while(game.pendingWaveDefs.length<3&&game.wave+game.pendingWaveDefs.length<game.maxWaves){
    game.pendingWaveDefs.push(generateWavePlan(game.wave+game.pendingWaveDefs.length+1));
  }

  game.currentWaveInfo=def;
  game.currentMoneyLossPercent=Math.max(0,def.moneyLossPercent||0);
  game.roundScoreMultiplier=Math.max(1,def.roundScoreMultiplier||1);
  game.spawnQueue=[];

  const timeline=Array.isArray(def.timelineEvents)&&def.timelineEvents.length
    ? [...def.timelineEvents].sort((a,b)=>a.time-b.time)
    : def.entries.flatMap(entry=>Array.from({length:entry.count||1},()=>({time:0,key:entry.key})));

  let lastTime=0;
  for(const event of timeline){
    const matchingEntry=def.entries.find(e=>e.key===event.key)||{key:event.key,count:1};
    const enemy=createEnemyFromTemplate(matchingEntry,game.wave,game.currentMoneyLossPercent);
    enemy.spawnDelay=Math.max(0,event.time-lastTime);
    game.spawnQueue.push(enemy);
    lastTime=event.time;
  }

  game.timeUntilNextSpawn=0;
  game.waveInProgress=true;
  game.intermission=false;
  setStatus(def.bossWave?`Boss-Wave ${game.wave} gestartet.`:`Wave ${game.wave} gestartet.`);
  updateWavePreviewUI();
  updateHUD();
}

function spawnEnemyFromQueue(){
  if(!game.spawnQueue.length||!game.map)return;
  const e=game.spawnQueue.shift();
  const s=game.map.pathPoints[0];
  e.instanceId=`enemy_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
  e.x=s.x;
  e.y=s.y;
  game.enemies.push(e);

  const fallbackBaseGap=game.currentWaveInfo?game.currentWaveInfo.spawnGap:.4;
  const plannedDelay=Number.isFinite(e.spawnDelay)?e.spawnDelay:fallbackBaseGap;
  game.timeUntilNextSpawn=Math.max(0.015,plannedDelay);
}
