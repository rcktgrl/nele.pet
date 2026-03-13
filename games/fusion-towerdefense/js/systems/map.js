function seededRandom(seed){let v=seed%2147483647;if(v<=0)v+=2147483646;return function(){v=v*16807%2147483647;return(v-1)/2147483646}}
function generateMap(){
  mapConfig.seed=Math.floor(Math.random()*1e6);
  const rand=seededRandom(mapConfig.seed);
  const cols=16,rows=9,cellSize=BASE_MAP_CELL_SIZE,offsetX=70,offsetY=36;
  const targetPathLength=clamp(mapConfig.pathLength||40,20,50);
  const islandCount=3+Math.floor(rand()*4);
  const farIslandCount=Math.max(1,Math.round(islandCount*.2));
  const nearIslandCount=Math.max(1,islandCount-farIslandCount);

  function key(c,r){return `${c},${r}`}
  function parseKey(k){const [c,r]=k.split(',').map(Number);return {c,r}}
  function randomBorderCell(rng){
    const side=Math.floor(rng()*4);
    if(side===0) return {c:0,r:Math.floor(rng()*rows)};
    if(side===1) return {c:cols-1,r:Math.floor(rng()*rows)};
    if(side===2) return {c:Math.floor(rng()*cols),r:0};
    return {c:Math.floor(rng()*cols),r:rows-1};
  }
  function countVisitedAdj(c,r,visited,prevKey){
    let count=0;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nc=c+dx,nr=r+dy,nk=key(nc,nr);
      if(nc<0||nr<0||nc>=cols||nr>=rows) continue;
      if(nk===prevKey) continue;
      if(visited.has(nk)) count++;
    }
    return count;
  }
  function floodReachable(start,end,visited){
    const q=[start],seen=new Set([key(start.c,start.r)]);
    for(let i=0;i<q.length;i++){
      const cur=q[i];
      if(cur.c===end.c&&cur.r===end.r) return true;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nc=cur.c+dx,nr=cur.r+dy,nk=key(nc,nr);
        if(nc<0||nr<0||nc>=cols||nr>=rows) continue;
        if(seen.has(nk)) continue;
        if(visited.has(nk) && !(nc===end.c&&nr===end.r)) continue;
        seen.add(nk);
        q.push({c:nc,r:nr});
      }
    }
    return false;
  }
  function getTurnProfile(rng){
    const roll=rng();
    if(roll<.45) return {name:'balanced',weights:[1,1.1,1]};
    if(roll<.65) return {name:'front',weights:[1.2,.95,.8]};
    if(roll<.85) return {name:'back',weights:[.8,.95,1.2]};
    return {name:'center',weights:[.85,1.2,.9]};
  }
  function phaseIndex(progress){return progress<1/3?0:progress<2/3?1:2}
  function evaluatePath(path,start,end,profile){
    let turns=0,backToBackPenalty=0,longStraightBonus=0,shortStraightPenalty=0,edgePenalty=0,phaseTurnBalance=0;
    let lastDir=null,straightRun=0;
    const dirs=[];
    for(let i=1;i<path.length;i++){
      const dx=path[i].c-path[i-1].c,dy=path[i].r-path[i-1].r;
      const dir=dx!==0?(dx>0?'R':'L'):(dy>0?'D':'U');
      dirs.push(dir);
      if(path[i].r===0||path[i].r===rows-1||path[i].c===0||path[i].c===cols-1) edgePenalty+=0.04;
      if(lastDir===null||dir===lastDir) straightRun++;
      else{
        turns++;
        const progress=i/(path.length-1);
        phaseTurnBalance+=profile.weights[phaseIndex(progress)];
        if(straightRun<=2) shortStraightPenalty+=1.5;
        if(straightRun>=4) longStraightBonus+=1.0;
        if(dirs.length>=3){
          const a=dirs[dirs.length-3],b=dirs[dirs.length-2],c=dirs[dirs.length-1];
          if(a!==b&&b!==c) backToBackPenalty+=2.3;
        }
        straightRun=1;
      }
      lastDir=dir;
    }
    if(straightRun<=2) shortStraightPenalty+=1.0;
    if(straightRun>=4) longStraightBonus+=1.0;
    const lengthPenalty=Math.abs(path.length-targetPathLength)*5.2;
    const endpointSpread=(Math.abs(start.c-end.c)+Math.abs(start.r-end.r))*.16;
    return 140 - lengthPenalty - backToBackPenalty - shortStraightPenalty - edgePenalty + longStraightBonus + phaseTurnBalance + endpointSpread + turns*.35;
  }
  function buildCandidate(seed){
    const rng=seededRandom(seed);
    let start=randomBorderCell(rng),end=randomBorderCell(rng),pickSafety=0;
    while(start.c===end.c&&start.r===end.r&&pickSafety<20){end=randomBorderCell(rng);pickSafety++}
    const minDist=Math.abs(start.c-end.c)+Math.abs(start.r-end.r);
    if(minDist>=targetPathLength) return null;
    if(((targetPathLength-1-minDist)&1)!==0 && targetPathLength<50) return null;

    const profile=getTurnProfile(rng);
    const visited=new Set([key(start.c,start.r)]);
    const path=[start];
    let found=null;
    let nodeBudget=5200;
    let reachCheckBudget=0;

    function dfs(c,r,prevDir=null,straightRun=0){
      if(found||--nodeBudget<=0) return;
      const usedEdges=path.length-1;
      const remainingEdges=targetPathLength-1-usedEdges;
      const minDistNow=Math.abs(end.c-c)+Math.abs(end.r-r);
      if(minDistNow>remainingEdges) return;
      if(path.length===targetPathLength){
        if(c===end.c&&r===end.r) found=path.slice();
        return;
      }
      const prevKey=path.length>1?key(path[path.length-2].c,path[path.length-2].r):null;
      const progress=usedEdges/Math.max(1,targetPathLength-1);
      const desiredTurnWeight=profile.weights[phaseIndex(progress)];
      const moves=[];
      for(const [dir,dx,dy] of [['R',1,0],['L',-1,0],['U',0,-1],['D',0,1]]){
        const nc=c+dx,nr=r+dy,nk=key(nc,nr);
        if(nc<0||nr<0||nc>=cols||nr>=rows) continue;
        if(visited.has(nk)) continue;
        const nextRemaining=remainingEdges-1;
        const nextMinDist=Math.abs(end.c-nc)+Math.abs(end.r-nr);
        if(nextMinDist>nextRemaining) continue;
        const adj=countVisitedAdj(nc,nr,visited,prevKey);
        if(adj>=2) continue;
        const turnChange=!!(prevDir&&dir!==prevDir);
        let score=rng()*0.22;
        score+=Math.max(0,(nextRemaining-nextMinDist))*0.02;
        if(turnChange) score+=straightRun>=2?(0.48*desiredTurnWeight):(-1.18);
        else if(prevDir&&dir===prevDir&&straightRun>=5) score-=.82;
        if(adj===1) score-=1.0;
        const urgency=nextRemaining-nextMinDist;
        if(urgency<=1){
          score-=nextMinDist*0.24;
          if(prevDir&&dir===prevDir) score+=.15;
        }else if(urgency<=3){
          score += turnChange ? 0.18 : 0.08;
        }else{
          score += turnChange ? (0.26 * desiredTurnWeight) : 0.06;
        }
        if((nc===0||nr===0||nc===cols-1||nr===rows-1) && !(nc===end.c&&nr===end.r)) score-=.04;
        moves.push({dir,nc,nr,score,needsReachCheck:nextRemaining<=8 || (++reachCheckBudget%9===0)});
      }
      moves.sort((a,b)=>b.score-a.score);
      for(const move of moves){
        visited.add(key(move.nc,move.nr));
        if(move.needsReachCheck && !floodReachable({c:move.nc,r:move.nr},end,visited)){
          visited.delete(key(move.nc,move.nr));
          continue;
        }
        path.push({c:move.nc,r:move.nr});
        dfs(move.nc,move.nr,move.dir,prevDir===move.dir?straightRun+1:1);
        path.pop();
        visited.delete(key(move.nc,move.nr));
        if(found) return;
      }
    }

    dfs(start.c,start.r,null,0);
    if(!found) return null;
    return {path:found,start,end,profile,score:evaluatePath(found,start,end,profile)};
  }

  let best=null;
  const candidateAttempts=12;
  for(let i=0;i<candidateAttempts;i++){
    const candidate=buildCandidate(Math.floor(rand()*1e9)+i*997+17);
    if(!candidate) continue;
    if(!best||candidate.score>best.score) best=candidate;
  }

  if(!best){
    const fallbackStart={c:0,r:4},fallbackEnd={c:cols-1,r:4};
    best={path:Array.from({length:cols},(_,c)=>({c,r:4})),start:fallbackStart,end:fallbackEnd,profile:{name:'fallback'},score:0};
  }

  const path=best.path;
  const points=path.map(cell=>({x:offsetX+cell.c*cellSize+cellSize/2,y:offsetY+cell.r*cellSize+cellSize/2}));
  const pathSet=new Set(path.map(cell=>`${cell.c},${cell.r}`));

  const near=[];
  const far=[];
  const strategicNear=[];
  for(let rr=0;rr<rows;rr++)for(let cc=0;cc<cols;cc++){
    const cellKey=`${cc},${rr}`;
    if(pathSet.has(cellKey)) continue;
    let min=Infinity;
    for(const p of path) min=Math.min(min,Math.abs(p.c-cc)+Math.abs(p.r-rr));
    const cell={c:cc,r:rr,key:cellKey,minDist:min};
    if(min<=2){
      let cover=0;
      for(const p of path) if(Math.abs(p.c-cc)+Math.abs(p.r-rr)<=3) cover++;
      cell.cover=cover;
      near.push(cell);
      if(cover>=3) strategicNear.push(cell);
    }else far.push(cell);
  }

  const totalBuildable=Math.max(1,Math.round((near.length+far.length)*(mapConfig.terrainPercent/100)));
  const nearTarget=Math.min(near.length,Math.round(totalBuildable*.8));
  const farTarget=Math.min(far.length,totalBuildable-nearTarget);
  const nearIslandSizes=[];
  const farIslandSizes=[];
  let nearRemaining=nearTarget,farRemaining=farTarget;
  for(let i=0;i<nearIslandCount;i++){
    const remainingIslands=nearIslandCount-i;
    const size=i===nearIslandCount-1?nearRemaining:Math.max(3,Math.round(nearRemaining/remainingIslands*(.8+rand()*.4)));
    nearIslandSizes.push(Math.min(nearRemaining,size));
    nearRemaining-=nearIslandSizes[nearIslandSizes.length-1];
  }
  for(let i=0;i<farIslandCount;i++){
    const remainingIslands=farIslandCount-i;
    const size=i===farIslandCount-1?farRemaining:Math.max(2,Math.round(farRemaining/remainingIslands*(.8+rand()*.4)));
    farIslandSizes.push(Math.min(farRemaining,size));
    farRemaining-=farIslandSizes[farIslandSizes.length-1];
  }

  function pickCenters(pool,count,minCenterDist,preferStrategic=false){
    const source=preferStrategic&&strategicNear.length?strategicNear:pool;
    const centers=[];
    const avail=[...source];
    let safety=0;
    while(centers.length<count&&avail.length&&safety<400){
      safety++;
      const idx=Math.floor(rand()*avail.length);
      const cell=avail.splice(idx,1)[0];
      if(centers.some(c=>Math.abs(c.c-cell.c)+Math.abs(c.r-cell.r)<minCenterDist)) continue;
      centers.push(cell);
    }
    while(centers.length<count&&pool.length){
      const cell=pool[Math.floor(rand()*pool.length)];
      if(centers.some(c=>Math.abs(c.c-cell.c)+Math.abs(c.r-cell.r)<2)) break;
      centers.push(cell);
    }
    return centers;
  }
  function growIsland(center,size,poolSet){
    const island=[];
    const used=new Set();
    const frontier=[center];
    const keyOf=cell=>`${cell.c},${cell.r}`;
    while(frontier.length&&island.length<size){
      frontier.sort((a,b)=>{
        const da=Math.abs(a.c-center.c)+Math.abs(a.r-center.r);
        const db=Math.abs(b.c-center.c)+Math.abs(b.r-center.r);
        return da-db || (rand()-.5);
      });
      const cell=frontier.shift();
      const cellKey=keyOf(cell);
      if(used.has(cellKey)||!poolSet.has(cellKey)) continue;
      used.add(cellKey);
      island.push(cell);
      for(const nb of [{c:cell.c+1,r:cell.r},{c:cell.c-1,r:cell.r},{c:cell.c,r:cell.r+1},{c:cell.c,r:cell.r-1}]){
        const nbKey=keyOf(nb);
        if(nb.c<0||nb.r<0||nb.c>=cols||nb.r>=rows) continue;
        if(used.has(nbKey)||!poolSet.has(nbKey)) continue;
        frontier.push(nb);
      }
      if(!frontier.length&&island.length<size){
        for(const candidateKey of poolSet){
          if(used.has(candidateKey)) continue;
          frontier.push(parseKey(candidateKey));
          break;
        }
      }
    }
    return island;
  }

  const nearPoolSet=new Set(near.map(c=>c.key));
  const farPoolSet=new Set(far.map(c=>c.key));
  const buildableSet=new Set();
  const nearCenters=pickCenters(near,nearIslandCount,3,true);
  const farCenters=pickCenters(far,farIslandCount,4,false);
  nearCenters.forEach((center,i)=>{const cells=growIsland(center,nearIslandSizes[i]||0,nearPoolSet);cells.forEach(cell=>{buildableSet.add(cell.key);nearPoolSet.delete(cell.key);});});
  farCenters.forEach((center,i)=>{const cells=growIsland(center,farIslandSizes[i]||0,farPoolSet);cells.forEach(cell=>{buildableSet.add(cell.key);farPoolSet.delete(cell.key);});});
  const missing=totalBuildable-buildableSet.size;
  if(missing>0){
    const combined=[...near.filter(c=>!buildableSet.has(c.key)),...far.filter(c=>!buildableSet.has(c.key))];
    for(let i=0;i<Math.min(missing,combined.length);i++) buildableSet.add(combined[i].key);
  }

  game.map={cols,rows,cellSize,offsetX,offsetY,pathCells:path,pathPoints:points,pathSet,buildableSet};
  refreshMapLayoutFromCanvas();
  ui.mapPreviewText.textContent=`Automatisch generierte Neon-Map mit orthogonalem Pfad. Ziellänge: ${targetPathLength} · Tatsächliche Länge: ${path.length} · Profil: ${best.profile.name} · Start: (${best.start.c},${best.start.r}) · Ziel: (${best.end.c},${best.end.r}) · Inseln: ${islandCount} (${nearIslandCount} near / ${farIslandCount} far) · Baufläche: ${mapConfig.terrainPercent}% · Score-Multiplikator: x${mapConfig.scoreMultiplier.toFixed(2)} · Wellenlimit: ${mapConfig.waveLimit}.`;
}



function refreshMapLayoutFromCanvas() {
  if (!game.map || !canvas?.parentElement) {
    return;
  }

  const parentRect = canvas.parentElement.getBoundingClientRect();
  const horizontalPadding = Math.max(18, parentRect.width * 0.03);
  const verticalPadding = Math.max(18, parentRect.height * 0.04);

  const contentWidth = Math.max(1, parentRect.width - horizontalPadding * 2);
  const contentHeight = Math.max(1, parentRect.height - verticalPadding * 2);

  if (contentWidth < 160 || contentHeight < 120) {
    return;
  }

  const cellSize = Math.max(
    28,
    Math.floor(
      Math.min(
        contentWidth / game.map.cols,
        contentHeight / game.map.rows
      )
    )
  );

  const baseCellSize = BASE_MAP_CELL_SIZE || 72;

  const mapPixelWidth = cellSize * game.map.cols;
  const mapPixelHeight = cellSize * game.map.rows;

  game.map.cellSize = cellSize;
  game.map.renderScale = cellSize / baseCellSize;
  game.map.offsetX = Math.floor((parentRect.width - mapPixelWidth) / 2);
  game.map.offsetY = Math.floor((parentRect.height - mapPixelHeight) / 2);
  game.map.pathPoints = game.map.pathCells.map(cell => ({
    x: game.map.offsetX + cell.c * cellSize + cellSize / 2,
    y: game.map.offsetY + cell.r * cellSize + cellSize / 2
  }));

  for (const tower of game.towers) {
    tower.x = game.map.offsetX + tower.c * cellSize + cellSize / 2;
    tower.y = game.map.offsetY + tower.r * cellSize + cellSize / 2;
  }


  for (const projectile of game.projectiles) {
    if (projectile.baseRadius != null) {
      projectile.radius = scaleWorldValue(projectile.baseRadius);
    }
  }

  for (const enemy of game.enemies) {
    const index = Math.max(0, Math.min(enemy.pathIndex || 0, game.map.pathPoints.length - 1));
    const point = game.map.pathPoints[index];
    if (point) {
      enemy.x = point.x;
      enemy.y = point.y;
    }

    if (enemy.baseRadius != null) {
      enemy.radius = scaleWorldValue(enemy.baseRadius);
    }
  }
}
