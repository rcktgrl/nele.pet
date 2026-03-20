import { TURBORACE_VERSION } from './version.js';
import { resolveCarCollisions } from './car.js';
import { createRenderPipeline } from './render/pipeline.js';
import { THREE } from './three.js';
import {
  gc, scene, clock,
  camChase, camCock, camEditor,
  state, raceCamOrbit, keys
} from './state.js';
import {
  isTouchControlsVisibleInState,
  onTouchControlsToggle,
  onGyroToggle,
  initTouchSettings,
  setupTouchControls,
  touchState,
  getGyroSteering,
  getTouchSliderSteer
} from './touch-controls.js';
import {
  initAudioSettings,
  onMusicVol, onSfxVol,
  updateAudio,
  startMusic, audioReady, aiSounds
} from './audio.js';
import { updateCamera, toggleCam, updateEditorPreviewCamera, updateTrainSplitCameras } from './camera.js';
import { setupLights } from './lighting.js';
import { updateHUD, drawDash, drawMinimap, resizeDC } from './hud.js';
import {
  ghostVisuals,
  sampleGhostFrame, updateGhostReplay,
  setOnlineGhostToggle, setOnlineGhostCount,
  readOnlineGhostToggle, readOnlineGhostCount
} from './ghost.js';
import {
  pauseRace, resumeRace,
  startRace, restartRace, updateResultsUI,
  initTraining, stopTraining, placeBestCarMarker, switchTrainingTrack
} from './race.js';
import { resetCarForTraining } from './trainer.js';
import {
  editorRebuildScene, drawEditorCanvas,
  setEditorNodeCount, setEditorBrushAsset, setEditorBrushEnabled, setEditorBrushSize, setEditorBrushSpacing,
  onEditorMetaChanged, onEditorStreetGridChanged, onEditorNodeChanged,
  addEditorNode, insertEditorNodeAfter, deleteEditorNode, deleteSelectedEditorAsset,
  createNewEditorTrack, duplicateEditorTrack, deleteEditorTrack, resetEditorTrack,
  saveEditorTrack, upgradeEditorTrackToLatestGeneration, showTrackEditor,
  reverseEditorTrack, exportTrackAsJSON
} from './editor.js';
import {
  showMain, showIntro, showTrkSel, showCarSel,
  showDiffSel, showOnlineTrkSel, showSettings, closeSettings,
  showTrainTrkSel
} from './menu.js';
import {
  closeTrackLeaderboardModal
} from './leaderboard.js';
import { resetEditorCameraToTrack as camResetEditorCam } from './camera.js';
import { loadArcadeUser } from './user.js';

'use strict';

// ═══════════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='KeyC'&&(state.gState==='racing'||state.gState==='cooldown'))toggleCam();
  if(e.code==='Escape'){
    const leaderboardModal=document.getElementById('leaderboardModal');
    if(leaderboardModal&&leaderboardModal.style.display==='flex'){ closeTrackLeaderboardModal(); return; }
    if(state.gState==='racing'||state.gState==='cooldown')pauseRace();
    else if(state.gState==='paused')resumeRace();
  }
});
document.addEventListener('keyup',e=>{ keys[e.code]=false; });
document.addEventListener('pointermove',e=>{
  if((state.gState==='racing'||state.gState==='cooldown'||state.gState==='finished'||state.gState==='countdown')&&e.buttons===2){
    raceCamOrbit.yaw-=e.movementX*0.004;
    raceCamOrbit.pitch=Math.max(-0.55,Math.min(0.75,raceCamOrbit.pitch-e.movementY*0.003));
    raceCamOrbit.lastInput=performance.now();
  }
  if(state.gState==='training'){
    const cam=state.trainSplitCams&&state.trainSplitCams[0];
    if(cam&&cam.isOrthographicCamera&&e.buttons){
      // Pan: drag to scroll (any button); clears car-follow mode
      const s=(cam._span*2)/window.innerHeight;
      cam.position.x-=e.movementX*s;
      cam.position.z-=e.movementY*s;
      state._trainFollowCar=null;
    }
  }
});
document.addEventListener('wheel',e=>{
  if(state.gState==='training'){
    const cam=state.trainSplitCams&&state.trainSplitCams[0];
    if(cam&&cam.isOrthographicCamera&&cam._span!==undefined){
      cam._span=Math.max(30,Math.min(2000,cam._span*(1+Math.sign(e.deltaY)*0.1)));
      const a=window.innerWidth/window.innerHeight;
      cam.left=-cam._span*a; cam.right=cam._span*a;
      cam.top=cam._span; cam.bottom=-cam._span;
      cam.updateProjectionMatrix();
    }
  }
  if(state.gState==='racing'||state.gState==='cooldown'||state.gState==='countdown'||state.gState==='finished'){
    raceCamOrbit.distance=Math.max(4,Math.min(40,raceCamOrbit.distance*(1+Math.sign(e.deltaY)*0.08)));
  }
},{passive:true});
gc.addEventListener('contextmenu',e=>e.preventDefault());

// ═══════════════════════════════════════════════════════
//  TRACK EDITOR CLOSE (bridge: editor -> menu)
// ═══════════════════════════════════════════════════════
function closeTrackEditor(){
  document.getElementById('editorPreviewBanner').style.display='none';
  showMain();
}

// ═══════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════
function updateFrame(dt){
  if(state.gState==='racing'){
    state.raceTime+=dt;
    const autoTouchThrottle=isTouchControlsVisibleInState(state.gState)
      &&('ontouchstart' in window||navigator.maxTouchPoints>0)
      &&!touchState.brake;
    const thr=(keys['ArrowUp']||keys['KeyW']||touchState.throttle||autoTouchThrottle)?1:0;
    const brk=(keys['ArrowDown']||keys['KeyS']||touchState.brake)?1:0;
    const left=(keys['ArrowLeft']||keys['KeyA']||touchState.left);
    const right=(keys['ArrowRight']||keys['KeyD']||touchState.right);
    const keySteer=left&&!right?1:right&&!left?-1:0;
    const gyroSteer=getGyroSteering();
    const sliderSteer=getTouchSliderSteer();
    const str=Math.abs(gyroSteer)>0.01?gyroSteer:Math.abs(sliderSteer)>0.01?sliderSteer:keySteer;
    state.pCar.update({thr,brk,str},dt);
    sampleGhostFrame();
    for(const ai of state.aiControllers)ai.update(dt);
    resolveCarCollisions(state.allCars);
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&state.aiCars[i])aiSounds[i].update(state.aiCars[i],state.pCar);}
    updateAudio(thr,brk,dt,state.pCar,keys); updateCamera(); updateHUD(); drawDash(); drawMinimap();
    updateGhostReplay();
  }else if(state.gState==='cooldown'){
    state.raceTime+=dt;
    state.pCar.update({thr:0,brk:0.3,str:0},dt);
    for(const ai of state.aiControllers){if(!ai.car.finished)ai.update(dt);}
    resolveCarCollisions(state.allCars);
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&state.aiCars[i])aiSounds[i].update(state.aiCars[i],state.pCar);}
    updateAudio(0,0,dt,state.pCar,keys); updateCamera();
    updateGhostReplay();
    if(document.getElementById('results').style.display==='flex') updateResultsUI();
  }else if(state.gState==='editorPreview'){
    updateEditorPreviewCamera(dt);
  }else if(state.gState==='editor'){
    updateEditorPreviewCamera(dt);
    if(state.editorNeedsRebuild&&performance.now()-state.editorLastRebuild>45){ editorRebuildScene(false); }
    drawEditorCanvas();
  }else if(state.gState==='training'){
    // Remove fog during training for better visibility
    if(scene.fog){scene.fog=null;}
    // Fast-forward: run multiple physics substeps per rendered frame
    const ffSteps=Math.max(1,state.trainFF||1);
    const subDt=Math.min(dt,0.05);
    const halfW=state.trkData?state.trkData.rw*0.55:999;
    for(let _s=0;_s<ffSteps;_s++){
      // Each simulation group runs independently
      for(let gi=0;gi<state.trainGroups.length;gi++){
        const grp=state.trainGroups[gi];
        const{cars,controllers,trainer,grid}=grp;
        // Update AI (includes braking, steering, throttle)
        for(const ai of controllers)ai.update(subDt);
        // Collisions within this group (cars of the same sim push each other)
        resolveCarCollisions(cars);
        // Configurable penalty/reward values
        const stuckPenRate=Number.isFinite(state.trainStuckPenaltyRate)?state.trainStuckPenaltyRate:5;
        const gravelBase=Number.isFinite(state.trainGravelPenaltyBase)?state.trainGravelPenaltyBase:0.5;
        const gravelGrowth=Number.isFinite(state.trainGravelGrowth)?state.trainGravelGrowth:0.3;
        const offTrackMult=Number.isFinite(state.trainOffTrackMult)?state.trainOffTrackMult:10;
        const offTrackDQTime=Number.isFinite(state.trainOffTrackDQTime)?state.trainOffTrackDQTime:3;
        const dqPenalty=Number.isFinite(state.trainDQPenalty)?state.trainDQPenalty:200;
        // Fitness penalties: wall hits and progressive gravel
        for(const car of cars){
          if(car._offTrack)continue;
          if(!car._fitPenalty)car._fitPenalty=0;
          const prevStuck=car._trainPrevStuck||0;
          if(car.stuckTimer>prevStuck) car._fitPenalty+=stuckPenRate*subDt;
          car._trainPrevStuck=car.stuckTimer;
          // Progressive gravel: rate grows the longer a car stays on gravel
          if(car.onGravel){
            car._gravelTime=(car._gravelTime||0)+subDt;
            car._fitPenalty+=gravelBase*(1+car._gravelTime*gravelGrowth)*subDt;
            car._offTrackTime=0;
            car._onTrackTime=0; // reset streak when on gravel
          }else{
            car._gravelTime=Math.max(0,(car._gravelTime||0)-subDt);
          }
        }
        // Off-track detection: neither on track nor gravel → offTrackMult× gravel rate (progressive)
        if(state.trkPts.length){
          for(const car of cars){
            if(car._offTrack)continue;
            let md=Infinity;
            for(const p of state.trkPts){const dx=car.pos.x-p.x,dz=car.pos.z-p.z;const d=dx*dx+dz*dz;if(d<md)md=d;}
            if(Math.sqrt(md)>halfW&&!car.onGravel){
              car._offTrackTime=(car._offTrackTime||0)+subDt;
              car._fitPenalty+=gravelBase*(1+car._offTrackTime*gravelGrowth)*offTrackMult*subDt;
              car._onTrackTime=0; // reset streak when off track
              if(car._offTrackTime>offTrackDQTime){car._offTrack=true;car._fitPenalty=(car._fitPenalty||0)+dqPenalty;}
            }else{
              car._offTrackTime=0;
              // Accumulate on-track streak (not on gravel, not off track)
              if(!car.onGravel) car._onTrackTime=(car._onTrackTime||0)+subDt;
            }
          }
        }
        // Finished reset (laps=999 so rare, but guard)
        for(let i=0;i<cars.length;i++){
          if(cars[i].finished)resetCarForTraining(cars[i],grid[i%grid.length].pos,grid[i%grid.length].hdg);
        }
        // Tick the GA for this group; evolve on generation boundary
        if(trainer.tick(subDt,cars)){
          let bi=0;
          for(let i=1;i<cars.length;i++){if(cars[i].totalProg>cars[bi].totalProg)bi=i;}
          const bc=cars[bi];
          state.trainBestCarPos={x:bc.pos.x,y:bc.pos.y,z:bc.pos.z};
          placeBestCarMarker(bc.pos.x,bc.pos.y,bc.pos.z);
          // Share global best genome across all sims so best traits propagate everywhere
          if(trainer.bestGenome&&trainer.bestFitness>(state.trainGlobalBestFitness||-Infinity)){
            state.trainGlobalBestFitness=trainer.bestFitness;
            state.trainGlobalBestGenome=[...trainer.bestGenome];
          }
          if(state.trainGlobalBestGenome){
            trainer.population[0].genome=[...state.trainGlobalBestGenome];
            if(state.trainGlobalBestFitness>trainer.bestFitness){
              trainer.bestFitness=state.trainGlobalBestFitness;
              trainer.bestGenome=[...state.trainGlobalBestGenome];
            }
          }
          for(let i=0;i<cars.length;i++){
            resetCarForTraining(cars[i],grid[i%grid.length].pos,grid[i%grid.length].hdg);
            controllers[i].setWeights(trainer.population[i].genome);
          }
          // Swap visible group only at generation boundary, when this sim becomes best
          const curBestFit=state.trainGroups[state._trainVisibleGroup].trainer.bestFitness;
          if(gi!==state._trainVisibleGroup&&trainer.bestFitness>curBestFit){
            for(const car of state.trainGroups[state._trainVisibleGroup].cars) car.mesh.visible=false;
            for(const car of grp.cars) car.mesh.visible=true;
            state._trainVisibleGroup=gi;
          }
        }
      }
      // Elite clone mode: wait until ALL simulation groups have finished their generation,
      // then pick the single best genome across all groups and clone it with mutations.
      if(state.trainEliteCloneMode&&state.trainGroups.length&&state.trainGroups.every(g=>g.trainer.pendingEvolve)){
        // Find the global best genome across all active groups
        let globalBestGenome=state.trainGlobalBestGenome;
        let globalBestFit=state.trainGlobalBestFitness||-Infinity;
        for(const grp of state.trainGroups){
          // Check peak from current generation's sorted population
          const sorted=[...grp.trainer.population].sort((a,b)=>b.fitness-a.fitness);
          if(sorted[0]&&sorted[0].fitness>globalBestFit){globalBestFit=sorted[0].fitness;globalBestGenome=sorted[0].genome;}
          // Also consider the trainer's all-time best
          if(grp.trainer.bestFitness>globalBestFit){globalBestFit=grp.trainer.bestFitness;globalBestGenome=grp.trainer.bestGenome;}
        }
        if(!globalBestGenome&&state.trainGroups.length){
          globalBestGenome=state.trainGroups[0].trainer.population[0].genome;
        }
        // Update global best tracking
        if(globalBestFit>(state.trainGlobalBestFitness||-Infinity)){
          state.trainGlobalBestFitness=globalBestFit;
          state.trainGlobalBestGenome=[...globalBestGenome];
        }
        // Evolve all groups using elite clone strategy
        for(let gi2=0;gi2<state.trainGroups.length;gi2++){
          const grp2=state.trainGroups[gi2];
          grp2.trainer.evolveEliteClone(globalBestGenome);
          const{cars:c2,controllers:ct2,grid:gd2}=grp2;
          for(let i=0;i<c2.length;i++){
            resetCarForTraining(c2[i],gd2[i%gd2.length].pos,gd2[i%gd2.length].hdg);
            ct2[i].setWeights(grp2.trainer.population[i].genome);
          }
        }
        // Update global best after internal tracking in evolveEliteClone
        for(const grp of state.trainGroups){
          if(grp.trainer.bestFitness>(state.trainGlobalBestFitness||-Infinity)){
            state.trainGlobalBestFitness=grp.trainer.bestFitness;
            state.trainGlobalBestGenome=[...grp.trainer.bestGenome];
          }
        }
        // Switch visible group to the best-performing simulation
        let bestVisGi=state._trainVisibleGroup;
        let bestVisFit=state.trainGroups[state._trainVisibleGroup].trainer.bestFitness;
        for(let gi2=0;gi2<state.trainGroups.length;gi2++){
          if(state.trainGroups[gi2].trainer.bestFitness>bestVisFit){
            bestVisFit=state.trainGroups[gi2].trainer.bestFitness;
            bestVisGi=gi2;
          }
        }
        if(bestVisGi!==state._trainVisibleGroup){
          for(const c of state.trainGroups[state._trainVisibleGroup].cars) c.mesh.visible=false;
          for(const c of state.trainGroups[bestVisGi].cars) c.mesh.visible=true;
          state._trainVisibleGroup=bestVisGi;
        }
      }
    }
    if(state.trainSplitCams&&state.trainSplitCams.length){
      updateTrainSplitCameras();
    }
    updateTrainingHUD();
    // Follow selected leaderboard car until camera is manually moved
    if(state._trainFollowCar&&state._trainFollowCar.pos){
      const cam=state.trainSplitCams&&state.trainSplitCams[0];
      if(cam){cam.position.x=state._trainFollowCar.pos.x;cam.position.z=state._trainFollowCar.pos.z;}
    }
  }else if(state.gState==='countdown'||state.gState==='finished'||state.gState==='paused'){
    if(state.gState==='finished'){
      state.raceTime+=dt;
      for(const ai of state.aiControllers){if(!ai.car.finished)ai.update(dt);}
      resolveCarCollisions(state.allCars);
      updateHUD(); drawMinimap();
    }
    updateCamera();
    if(state.gState==='countdown'||state.gState==='finished')updateGhostReplay();
    else for(const visual of ghostVisuals){ if(visual.tagEl)visual.tagEl.style.display='none'; }
  }
}

// ═══════════════════════════════════════════════════════
//  TRAINING HUD
// ═══════════════════════════════════════════════════════
let _nnCanvas=null;
function updateTrainingHUD(){
  const groups=state.trainGroups;
  if(!groups||!groups.length)return;
  // Show stats from the group with the best all-time fitness
  const bestGrp=groups.reduce((b,g)=>g.trainer.bestFitness>b.trainer.bestFitness?g:b,groups[0]);
  const t=bestGrp.trainer;
  const avgGen=Math.round(groups.reduce((s,g)=>s+g.trainer.generation,0)/groups.length);
  const avgFit=groups.reduce((s,g)=>s+g.trainer.avgFitness,0)/groups.length;
  document.getElementById('trainGenNum').textContent=`GEN ${avgGen+1}`;
  document.getElementById('trainBestFit').textContent=`BEST ${t.bestFitness>0?t.bestFitness.toFixed(1):'—'}`;
  document.getElementById('trainAvgFit').textContent=`AVG ${avgFit.toFixed(1)}`;
  document.getElementById('trainCountdown').textContent=Math.max(0,Math.ceil(t.genDuration-t.genTime))+'s';
  document.getElementById('trainBar').style.width=Math.min(100,(t.genTime/t.genDuration)*100)+'%';
  _drawNNViz();
  _updateTrainLeaderboard();
}

let _lbRows=null;
let _lbTopEntries=[];
function _updateTrainLeaderboard(){
  if(!_lbRows)_lbRows=document.getElementById('trainLbRows');
  if(!_lbRows||!state.trainGroups||!state.trainGroups.length)return;
  // Collect scored entries from all simulation groups
  const entries=[];
  for(const grp of state.trainGroups){
    for(let i=0;i<grp.cars.length;i++){
      const car=grp.cars[i];
      const ctrl=grp.controllers[i];
      const score=Math.max(0,car.totalProg-(car._fitPenalty||0));
      // Brake indicator: check neural output index 2 (brake), or car reversing
      const brakeOut=ctrl&&ctrl.lastOutputs?ctrl.lastOutputs[2]:0;
      const braking=brakeOut>0.1||car.isReversing;
      entries.push({score,spd:car.spd,braking,offTrack:!!car._offTrack,onGravel:car.onGravel,color:car.data&&car.data.hex?car.data.hex:'#889',car});
    }
  }
  entries.sort((a,b)=>b.score-a.score);
  _lbTopEntries=entries.slice(0,8);
  const RANK_COLORS=['#ffd700','#c0c0c0','#cd7f32','#778','#778','#778','#778','#778'];
  const ROW_COUNT=8;
  let html='';
  for(let i=0;i<ROW_COUNT;i++){
    const e=_lbTopEntries[i];
    if(e){
      const spdKph=Math.round(e.spd*3.6);
      const rc=RANK_COLORS[i]||'#778';
      const scoreColor=e.offTrack?'#445':'#4f4';
      const brakeHtml=e.braking
        ?'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f33;box-shadow:0 0 5px #f33;"></span>'
        :'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a1a2a;border:1px solid #223;"></span>';
      html+=`<div data-lbidx="${i}" style="display:grid;grid-template-columns:18px 10px 1fr 48px 14px;gap:2px 6px;align-items:center;padding:1px 0;cursor:pointer;pointer-events:auto;border-radius:3px;" onmouseenter="this.style.background='rgba(80,160,255,.08)'" onmouseleave="this.style.background=''">`
        +`<span style="color:${rc};font-size:.6rem;text-align:right;">${i+1}</span>`
        +`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${e.color};box-shadow:0 0 4px ${e.color};"></span>`
        +`<span style="color:${scoreColor};font-size:.65rem;">${e.offTrack?'X':e.score.toFixed(1)}</span>`
        +`<span style="color:#889;font-size:.6rem;text-align:right;">${spdKph}&nbsp;km/h</span>`
        +`<span style="text-align:center;">${brakeHtml}</span>`
        +`</div>`;
    }else{
      html+=`<div style="display:grid;grid-template-columns:18px 10px 1fr 48px 14px;gap:2px 6px;align-items:center;padding:1px 0;">`
        +`<span style="color:#334;font-size:.6rem;text-align:right;">${i+1}</span>`
        +`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a1a2a;border:1px solid #223;"></span>`
        +`<span style="color:#334;font-size:.65rem;">—</span>`
        +`<span style="color:#334;font-size:.6rem;text-align:right;">—</span>`
        +`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a1a2a;border:1px solid #223;margin:auto;"></span>`
        +`</div>`;
    }
  }
  _lbRows.innerHTML=html;
}

// Center the training top-down camera on a leaderboard car when its row is clicked, and follow it
document.getElementById('trainLbRows').addEventListener('click',e=>{
  const row=e.target.closest('[data-lbidx]');
  if(!row)return;
  const idx=parseInt(row.dataset.lbidx,10);
  const entry=_lbTopEntries[idx];
  if(!entry)return;
  const cam=state.trainSplitCams&&state.trainSplitCams[0];
  if(!cam||!entry.car.pos)return;
  cam.position.x=entry.car.pos.x;
  cam.position.z=entry.car.pos.z;
  state._trainFollowCar=entry.car;
});

function _drawNNViz(){
  if(!_nnCanvas) _nnCanvas=document.getElementById('trainNNCanvas');
  const cv=_nnCanvas; if(!cv) return;
  const cx=cv.getContext('2d'); if(!cx) return;
  const W=cv.width, H=cv.height;
  cx.clearRect(0,0,W,H);
  // Find the best car's AI controller across all simulation groups
  let bestAI=null, bestProg=-1;
  for(const grp of state.trainGroups){
    for(let i=0;i<grp.cars.length;i++){
      if(grp.cars[i].totalProg>bestProg){bestProg=grp.cars[i].totalProg;bestAI=grp.controllers[i];}
    }
  }
  const ai=bestAI;
  if(!ai||!ai.layers||!ai.weights) return;

  const LAYERS=ai.layers;
  const nL=LAYERS.length;
  const maxNodes=Math.max(...LAYERS);
  // Allow radius to shrink freely so nodes never overlap regardless of layer size
  const nodeR=Math.max(1,Math.min(6,Math.floor(H/(maxNodes+2)/2)-1));
  // Shrink side margins when many layers are present so they don't crowd
  const margin=Math.max(18,Math.min(28,Math.floor(W/(nL+1))));

  // X positions: first and last columns pinned, middle ones evenly spaced
  const xs=Array.from({length:nL},(_,l)=>
    l===0?margin:l===nL-1?W-margin:Math.round(margin+(W-margin*2)*l/(nL-1))
  );

  // Build activation arrays: [inputs, ...hiddens, outputs]
  const hiddens=ai.lastHiddens||[];
  const activations=[ai.lastInputs||[],...hiddens,ai.lastOutputs||[]];

  // Node y positions
  const ys=LAYERS.map((n,l)=>Array.from({length:n},(_,i)=>(i+1)/(n+1)*H));

  // Labels (only first and last layer)
  const INPUT_LABELS=['s-90','s-60','s-30','s-10','s-5','s0','s+5','s+10','s+30','s+60','s+90','spd','wpt','edge','grav'];
  const OUTPUT_LABELS=['steer','thrtl','brake'];

  // Threshold below which edges are too dim to bother drawing (also limits cost for large nets)
  const edgeAlphaMin=0.06;
  // Draw edges for each layer transition
  for(let l=0;l<nL-1;l++){
    const src=ys[l], dst=ys[l+1];
    const Wm=ai.weights[l].W;
    for(let d=0;d<Wm.length;d++){
      for(let s=0;s<Wm[d].length;s++){
        const w=Wm[d][s];
        const alpha=Math.min(0.85,Math.abs(w)/3);
        if(alpha<edgeAlphaMin) continue;
        const thick=Math.min(2,Math.abs(w)*0.7+0.3);
        cx.strokeStyle=w>0?`rgba(80,220,120,${alpha})`:`rgba(220,80,80,${alpha})`;
        cx.lineWidth=thick;
        cx.beginPath();
        cx.moveTo(xs[l],src[s]);
        cx.lineTo(xs[l+1],dst[d]);
        cx.stroke();
      }
    }
  }
  // Draw nodes
  for(let l=0;l<nL;l++){
    for(let n=0;n<LAYERS[l];n++){
      const x=xs[l], y=ys[l][n];
      const act=activations[l]?.[n]??0;
      const t=(act+1)/2;
      const r=Math.round(40+t*200), g2=Math.round(80+t*120), b=Math.round(200-t*150);
      cx.beginPath(); cx.arc(x,y,nodeR,0,Math.PI*2);
      cx.fillStyle=`rgb(${r},${g2},${b})`; cx.fill();
      cx.strokeStyle='#334'; cx.lineWidth=1; cx.stroke();
      // Labels only when there's enough vertical room (≥8px spacing per node)
      const spacing=H/(LAYERS[l]+1);
      if(spacing>=8){
        if(l===0&&INPUT_LABELS[n]){
          const fs=Math.max(5,Math.min(7,Math.floor(spacing*0.55)));
          cx.fillStyle='#aab'; cx.font=`${fs}px monospace`; cx.textAlign='right';
          cx.fillText(INPUT_LABELS[n],x-nodeR-2,y+2);
        } else if(l===nL-1&&OUTPUT_LABELS[n]){
          const fs=Math.max(5,Math.min(7,Math.floor(spacing*0.55)));
          cx.fillStyle='#aab'; cx.font=`${fs}px monospace`; cx.textAlign='left';
          cx.fillText(OUTPUT_LABELS[n],x+nodeR+2,y+2);
        }
      }
    }
  }
  // Title
  const archStr=LAYERS.join('→');
  cx.fillStyle='#556'; cx.font='7px monospace'; cx.textAlign='center';
  cx.fillText(`NET [${archStr}] · BEST CAR`,W/2,10);
}

// ═══════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════
function tryStartMenuMusic(){ if(audioReady)startMusic(); }

document.getElementById('resumeBtn').addEventListener('click',resumeRace);
document.getElementById('restartBtn').addEventListener('click',restartRace);
document.getElementById('showSettingsBtn').addEventListener('click',()=>showSettings());
document.getElementById('quitToMenuBtn').addEventListener('click',showMain);
document.getElementById('musicVolSlider').addEventListener('input',e=>onMusicVol(e.target.value));
document.getElementById('sfxVolSlider').addEventListener('input',e=>onSfxVol(e.target.value));
document.getElementById('touchToggleInput').addEventListener('input',e=>onTouchControlsToggle(e.target.checked));
document.getElementById('gyroToggleInput').addEventListener('input',e=>onGyroToggle(e.target.checked));
document.getElementById('onlineGhostToggleInput').addEventListener('input',e=>setOnlineGhostToggle(e.target.checked));
document.getElementById('onlineGhostCountSelect').addEventListener('change',e=>setOnlineGhostCount(e.target.value));
document.getElementById('settingsCloseBtn').addEventListener('click',closeSettings);
document.getElementById('introStartBtn').addEventListener('click',function(){tryStartMenuMusic();showMain();});
document.getElementById('gameStartBtn').addEventListener('click',function(){tryStartMenuMusic();showTrkSel();});
document.getElementById('trackEditorBtn').addEventListener('click',function(){tryStartMenuMusic();showTrackEditor();});
document.getElementById('mainSettingsBtn').addEventListener('click',function(){tryStartMenuMusic();showSettings();});
document.getElementById('backToSelectionBtn').addEventListener('click',()=>{ window.location.href='../index.html'; });
document.getElementById('showTrkSelBtn').addEventListener('click',showDiffSel);
document.getElementById('btnGo').addEventListener('click',startRace);
document.getElementById('trkSelBackBtn').addEventListener('click',showMain);
document.getElementById('loadOnlineTracksBtn').addEventListener('click',showOnlineTrkSel);
document.getElementById('onlineTrkBackBtn').addEventListener('click',showTrkSel);
document.getElementById('btnOnlineNxt').addEventListener('click',showDiffSel);
document.getElementById('btnNxt').addEventListener('click',showDiffSel);
document.getElementById('diffBackBtn').addEventListener('click',showTrkSel);
document.getElementById('diffNextBtn').addEventListener('click',showCarSel);
document.getElementById('closeEditorBtn').addEventListener('click',closeTrackEditor);
document.getElementById('newTrackBtn').addEventListener('click',createNewEditorTrack);
document.getElementById('dupeTrackBtn').addEventListener('click',duplicateEditorTrack);
document.getElementById('delTrackBtn').addEventListener('click',deleteEditorTrack);
document.getElementById('editorTrackName').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorTrackDesc').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorTrackLaps').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorTrackWidth').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorTrackColor').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorUseBezier').addEventListener('change',onEditorMetaChanged);
document.getElementById('editorGroundColor').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorSkyColor').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorTimeOfDay').addEventListener('change',onEditorMetaChanged);
document.getElementById('editorStreetGrid').addEventListener('change',onEditorStreetGridChanged);
document.getElementById('editorGridSize').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorEnableRunoff').addEventListener('change',onEditorMetaChanged);
document.getElementById('editorFogDist').addEventListener('input',onEditorMetaChanged);
document.getElementById('editorNodeCount').addEventListener('input',e=>setEditorNodeCount(e.target.value));
document.getElementById('editorBrushAsset').addEventListener('change',e=>setEditorBrushAsset(e.target.value));
document.getElementById('editorBrushEnabled').addEventListener('change',e=>setEditorBrushEnabled(e.target.checked));
document.getElementById('editorBrushSize').addEventListener('input',e=>setEditorBrushSize(e.target.value));
document.getElementById('editorBrushSpacing').addEventListener('input',e=>setEditorBrushSpacing(e.target.value));
document.getElementById('editorNodeType').addEventListener('change',onEditorNodeChanged);
document.getElementById('editorSteepness').addEventListener('input',onEditorNodeChanged);
document.getElementById('editorNodeGravelPitSize').addEventListener('input',onEditorNodeChanged);
document.getElementById('editorNodeGravelLeft').addEventListener('input',onEditorNodeChanged);
document.getElementById('editorNodeGravelRight').addEventListener('input',onEditorNodeChanged);
document.getElementById('addNodeBtn').addEventListener('click',addEditorNode);
document.getElementById('insertNodeBtn').addEventListener('click',insertEditorNodeAfter);
document.getElementById('delNodeBtn').addEventListener('click',deleteEditorNode);
document.getElementById('reverseDirectionBtn').addEventListener('click',reverseEditorTrack);
document.getElementById('delAssetBtn').addEventListener('click',deleteSelectedEditorAsset);
document.getElementById('resetEditorCamBtn').addEventListener('click',camResetEditorCam);
document.getElementById('saveEditorTrackBtn').addEventListener('click',saveEditorTrack);
document.getElementById('exportTrackJsonBtn').addEventListener('click',exportTrackAsJSON);
document.getElementById('resetEditorTrackBtn').addEventListener('click',resetEditorTrack);
document.getElementById('upgradeTrackGenerationBtn').addEventListener('click',upgradeEditorTrackToLatestGeneration);
document.getElementById('closeLeaderboardModalBtn').addEventListener('click',closeTrackLeaderboardModal);
document.getElementById('leaderboardModal').addEventListener('click',e=>{ if(e.target.id==='leaderboardModal') closeTrackLeaderboardModal(); });
document.getElementById('menuBtn').addEventListener('click',showMain);
document.getElementById('raceAgainBtn').addEventListener('click',restartRace);
document.getElementById('trainAiBtn').addEventListener('click',()=>{ tryStartMenuMusic(); showTrainTrkSel(); });
document.getElementById('btnTrainStart').addEventListener('click', async ()=>{
  await initTraining();
  _populateTrainTrkSelect();
});
function _getBestTrainer(){
  const groups=state.trainGroups;
  if(!groups||!groups.length)return null;
  return groups.reduce((b,g)=>g.trainer.bestFitness>b.trainer.bestFitness?g:b,groups[0]).trainer;
}
document.getElementById('trainSaveBtn').addEventListener('click',()=>{
  const best=_getBestTrainer(); if(!best)return;
  const defaultName=`gen${best.generation}-${best.layers.join('x')}`;
  const name=(prompt('Name this model:',defaultName)||'').trim()||defaultName;
  best.saveToLocalStorage();
  localStorage.setItem('turborace_nn_name',name);
  const btn=document.getElementById('trainSaveBtn');
  btn.textContent='SAVED ✓';
  setTimeout(()=>{ btn.textContent='SAVE'; },2000);
});
document.getElementById('trainExportBtn').addEventListener('click',()=>{
  const best=_getBestTrainer(); if(!best)return;
  const defaultName=`gen${best.generation}-${best.layers.join('x')}`;
  const name=(prompt('Name this model:',defaultName)||'').trim()||defaultName;
  const exported=best.exportAsJSON(name);
  if(exported){
    const btn=document.getElementById('trainExportBtn');
    btn.textContent='EXPORTED ✓';
    setTimeout(()=>{ btn.textContent='EXPORT'; },2000);
  }
});
document.getElementById('trainStopBtn').addEventListener('click',()=>{ stopTraining(); showMain(); });
document.getElementById('trainTrkSelect').addEventListener('change', async e=>{
  const newId=e.target.value;
  if(!newId||newId===String(state.selTrk))return;
  await switchTrainingTrack(newId);
  _populateTrainTrkSelect();
});
function _populateTrainTrkSelect(){
  const sel=document.getElementById('trainTrkSelect');
  if(!sel)return;
  const tracks=[...state.folderTracks,...(state.editorTracks||[])];
  sel.innerHTML=tracks.map(t=>`<option value="${t.id}"${String(t.id)===String(state.selTrk)?' selected':''}>${t.name||t.id}</option>`).join('');
}
document.getElementById('trainPopSlider').addEventListener('input',e=>{
  state.trainPopSize=parseInt(e.target.value);
  document.getElementById('trainPopVal').textContent=e.target.value;
});
document.getElementById('trainFFSlider').addEventListener('input',e=>{
  state.trainFF=parseInt(e.target.value);
  document.getElementById('trainFFVal').textContent=e.target.value+'×';
});
document.getElementById('trainHiddenSlider').addEventListener('input',e=>{
  state.trainHiddenLayers=parseInt(e.target.value);
  document.getElementById('trainHiddenVal').textContent=e.target.value;
});
document.getElementById('trainNodesSlider').addEventListener('input',e=>{
  state.trainHiddenSize=parseInt(e.target.value);
  document.getElementById('trainNodesVal').textContent=e.target.value;
});
document.getElementById('trainGenDurSlider').addEventListener('input',e=>{
  const v=parseInt(e.target.value);
  state.trainGenDuration=v;
  document.getElementById('trainGenDurVal').textContent=v+'s';
  for(const grp of state.trainGroups) grp.trainer.genDuration=v;
});

// Click-to-type for SPEED, HIDDEN, NODES value spans
function _makeClickToType(spanId,{suffix='',min=1,max=null,stateKey,sliderId,formatter}){
  const span=document.getElementById(spanId);
  if(!span)return;
  span.addEventListener('click',()=>{
    const cur=state[stateKey]||parseInt(span.textContent)||min;
    const inp=document.createElement('input');
    inp.type='number';
    inp.value=cur;
    inp.min=min;
    if(max!==null)inp.max=max;
    inp.step=1;
    inp.style.cssText='width:3.5em;font-size:.7rem;background:#0a0f1c;color:inherit;border:1px solid #4af;border-radius:3px;padding:1px 3px;font-family:inherit;';
    span.replaceWith(inp);
    inp.focus(); inp.select();
    const commit=()=>{
      let v=parseInt(inp.value);
      if(isNaN(v))v=cur;
      v=Math.max(min,max!==null?Math.min(max,v):v);
      state[stateKey]=v;
      const slider=document.getElementById(sliderId);
      if(slider){slider.value=Math.min(parseInt(slider.max),v);}
      const newSpan=document.createElement('span');
      newSpan.id=spanId;
      newSpan.style.cssText=span.style.cssText;
      newSpan.setAttribute('title','Click to type value');
      newSpan.textContent=formatter?formatter(v):v;
      inp.replaceWith(newSpan);
      _makeClickToType(spanId,{suffix,min,max,stateKey,sliderId,formatter});
    };
    inp.addEventListener('keydown',e=>{if(e.key==='Enter')commit();if(e.key==='Escape'){inp.replaceWith(span);}});
    inp.addEventListener('blur',commit);
  });
}
_makeClickToType('trainFFVal',{min:1,max:null,stateKey:'trainFF',sliderId:'trainFFSlider',formatter:v=>v+'×'});
_makeClickToType('trainHiddenVal',{min:1,max:null,stateKey:'trainHiddenLayers',sliderId:'trainHiddenSlider'});
_makeClickToType('trainNodesVal',{min:1,max:null,stateKey:'trainHiddenSize',sliderId:'trainNodesSlider'});

// Rewards & Penalties panel toggle
document.getElementById('trainRewardsPanelToggle').addEventListener('click',()=>{
  const panel=document.getElementById('trainRewardsPanel');
  const btn=document.getElementById('trainRewardsPanelToggle');
  if(panel.style.display==='none'){panel.style.display='block';btn.textContent='▼ REWARDS & PENALTIES';}
  else{panel.style.display='none';btn.textContent='▶ REWARDS & PENALTIES';}
});
// Rewards & Penalties sliders
document.getElementById('trainOnTrackRateSlider').addEventListener('input',e=>{
  state.trainOnTrackRewardRate=parseFloat(e.target.value);
  document.getElementById('trainOnTrackRateVal').textContent=parseFloat(e.target.value).toFixed(2);
});
document.getElementById('trainStuckPenaltySlider').addEventListener('input',e=>{
  state.trainStuckPenaltyRate=parseFloat(e.target.value);
  document.getElementById('trainStuckPenaltyVal').textContent=parseFloat(e.target.value).toFixed(1);
});
document.getElementById('trainGravelPenaltySlider').addEventListener('input',e=>{
  state.trainGravelPenaltyBase=parseFloat(e.target.value);
  document.getElementById('trainGravelPenaltyVal').textContent=parseFloat(e.target.value).toFixed(1);
});
document.getElementById('trainGravelGrowthSlider').addEventListener('input',e=>{
  state.trainGravelGrowth=parseFloat(e.target.value);
  document.getElementById('trainGravelGrowthVal').textContent=parseFloat(e.target.value).toFixed(2);
});
document.getElementById('trainOffTrackMultSlider').addEventListener('input',e=>{
  state.trainOffTrackMult=parseFloat(e.target.value);
  document.getElementById('trainOffTrackMultVal').textContent=parseInt(e.target.value)+'×';
});
document.getElementById('trainOffTrackDQTimeSlider').addEventListener('input',e=>{
  state.trainOffTrackDQTime=parseFloat(e.target.value);
  document.getElementById('trainOffTrackDQTimeVal').textContent=parseFloat(e.target.value).toFixed(1)+'s';
});
document.getElementById('trainDQPenaltySlider').addEventListener('input',e=>{
  state.trainDQPenalty=parseFloat(e.target.value);
  document.getElementById('trainDQPenaltyVal').textContent=parseInt(e.target.value);
});
document.getElementById('trainMutRateSlider').addEventListener('input',e=>{
  state.trainMutRate=parseFloat(e.target.value);
  document.getElementById('trainMutRateVal').textContent=parseFloat(e.target.value).toFixed(2);
});
document.getElementById('trainMutStrengthSlider').addEventListener('input',e=>{
  state.trainMutStrength=parseFloat(e.target.value);
  document.getElementById('trainMutStrengthVal').textContent=parseFloat(e.target.value).toFixed(2);
});
document.getElementById('trainEliteCloneBtn').addEventListener('click',()=>{
  state.trainEliteCloneMode=!state.trainEliteCloneMode;
  const btn=document.getElementById('trainEliteCloneBtn');
  if(state.trainEliteCloneMode){
    btn.textContent='ELITE CLONE: ON';
    btn.style.color='#4af';
    btn.style.borderColor='#4af';
  }else{
    btn.textContent='ELITE CLONE: OFF';
    btn.style.color='#889';
    btn.style.borderColor='#445';
    // If switching off while any trainer is waiting, resume their timers by clearing pendingEvolve
    for(const grp of state.trainGroups){
      if(grp.trainer.pendingEvolve){
        grp.trainer.pendingEvolve=false;
        grp.trainer.genTime=0; // restart their generation timer
      }
    }
  }
});

// Load AI from localStorage
document.getElementById('trainLoadBtn').addEventListener('click', async ()=>{
  const saved=localStorage.getItem('turborace_nn_weights');
  if(!saved){alert('No saved AI found in local storage. Train and SAVE one first.');return;}
  try{
    const genome=JSON.parse(saved);
    const name=localStorage.getItem('turborace_nn_name')||'saved';
    const best=_getBestTrainer();
    if(best&&genome.length!==best.genomeSize){
      alert(`Genome size mismatch: saved=${genome.length}, current=${best.genomeSize}. Architecture must match.`);
      return;
    }
    await initTraining({preservedGenome:genome});
    _populateTrainTrkSelect();
    const btn=document.getElementById('trainLoadBtn');
    btn.textContent='LOADED ✓';
    setTimeout(()=>{btn.textContent='LOAD';},2000);
  }catch(err){alert('Failed to load AI: '+err.message);}
});

// Import AI from JSON file
document.getElementById('trainImportBtn').addEventListener('click',()=>{
  document.getElementById('trainImportFile').click();
});
document.getElementById('trainImportFile').addEventListener('change', async e=>{
  const file=e.target.files[0];
  if(!file)return;
  try{
    const text=await file.text();
    const model=JSON.parse(text);
    const genome=Array.isArray(model.genome)?model.genome:model;
    if(!Array.isArray(genome)||!genome.length){alert('Invalid model file: no genome array found.');return;}
    // Save to localStorage so initTraining picks it up
    localStorage.setItem('turborace_nn_weights',JSON.stringify(genome));
    if(model.name)localStorage.setItem('turborace_nn_name',model.name);
    await initTraining({preservedGenome:genome});
    _populateTrainTrkSelect();
    const btn=document.getElementById('trainImportBtn');
    btn.textContent='IMPORTED ✓';
    setTimeout(()=>{btn.textContent='IMPORT JSON';},2000);
  }catch(err){alert('Failed to import model: '+err.message);}
  e.target.value='';
});

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
scene.background=new THREE.Color(0x050510);
setupTouchControls({pauseRace,resumeRace});
initTouchSettings();
initAudioSettings();
setOnlineGhostToggle(readOnlineGhostToggle());
setOnlineGhostCount(readOnlineGhostCount());
document.querySelectorAll('.menuVersion').forEach(el=>{
  el.textContent=TURBORACE_VERSION;
});

const {renderer,start:startRenderLoop}=createRenderPipeline({
  THREE,
  canvas:gc,
  scene,
  clock,
  cameras:[camChase,camCock,camEditor],
  resizeOverlays:resizeDC,
  frameUpdate:updateFrame,
  getActiveCamera:()=>state.activeCam,
  getTrainSplitCams:()=>state.trainSplitCams,
  getGState:()=>state.gState,
});
state.renderer=renderer;
setupLights(); startRenderLoop(); loadArcadeUser(); showIntro();
