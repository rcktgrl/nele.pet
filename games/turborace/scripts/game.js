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
  showDiffSel, showNeuralModelSel, showOnlineTrkSel, showSettings, closeSettings,
  showTrainTrkSel, showTrainSetup, getTrainSetupGenome
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
        // Lap mode: detect when a car completes its first lap and record the time
        if(state.trainMode==='lap'){
          for(const car of cars){
            if(!car._lapCompleted&&car.lap>=1){
              car._lapCompleted=true;
              car._lapTime=trainer.genTime; // seconds elapsed in this generation
            }
          }
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
let _nnPan={x:0,y:0};
let _nnZoom=1;
let _nnDrag=null;      // {sx,sy,px,py} — drag start
let _nnLastArch='';   // detect arch change to reset view

function _initNNInteraction(){
  const cv=document.getElementById('trainNNCanvas');
  if(!cv||cv._nnInit) return;
  cv._nnInit=true;
  cv.addEventListener('mousedown',e=>{
    _nnDrag={sx:e.clientX,sy:e.clientY,px:_nnPan.x,py:_nnPan.y};
    cv.style.cursor='grabbing'; e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!_nnDrag) return;
    _nnPan.x=_nnDrag.px+(e.clientX-_nnDrag.sx);
    _nnPan.y=_nnDrag.py+(e.clientY-_nnDrag.sy);
  });
  window.addEventListener('mouseup',()=>{
    if(_nnDrag){_nnDrag=null; cv.style.cursor='grab';}
  });
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    const f=e.deltaY<0?1.15:1/1.15;
    const rect=cv.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    _nnPan.x=mx+(_nnPan.x-mx)*f;
    _nnPan.y=my+(_nnPan.y-my)*f;
    _nnZoom=Math.max(0.04,Math.min(20,_nnZoom*f));
  },{passive:false});
  // Touch pan
  let _t0=null;
  cv.addEventListener('touchstart',e=>{
    if(e.touches.length===1) _t0={x:e.touches[0].clientX,y:e.touches[0].clientY,px:_nnPan.x,py:_nnPan.y};
    e.preventDefault();
  },{passive:false});
  cv.addEventListener('touchmove',e=>{
    if(e.touches.length===1&&_t0){
      _nnPan.x=_t0.px+(e.touches[0].clientX-_t0.x);
      _nnPan.y=_t0.py+(e.touches[0].clientY-_t0.y);
    }
    e.preventDefault();
  },{passive:false});
  cv.addEventListener('touchend',()=>{ _t0=null; });
}
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
  const modeLabelEl=document.getElementById('trainModeLabel');
  if(modeLabelEl)modeLabelEl.textContent=state.trainMode==='lap'?'LAP RACE':'TIMED';
  const durLabelEl=document.getElementById('trainGenDurLabel');
  if(durLabelEl){const firstText=durLabelEl.firstChild;if(firstText&&firstText.nodeType===3)firstText.nodeValue=(state.trainMode==='lap'?'TIMEOUT':'SIM TIME')+'\u00a0';}
  if(state.trainMode==='lap'){
    // In lap mode: show how many cars have finished and time elapsed
    const allCarsInGroups=groups.flatMap(g=>g.cars);
    const finished=allCarsInGroups.filter(c=>c._lapCompleted).length;
    const total=allCarsInGroups.length;
    const timeLeft=Math.max(0,Math.ceil(t.genDuration-t.genTime));
    document.getElementById('trainCountdown').textContent=`${finished}/${total} ✓ · ${timeLeft}s`;
    document.getElementById('trainBar').style.width=Math.min(100,(t.genTime/t.genDuration)*100)+'%';
  }else{
    document.getElementById('trainCountdown').textContent=Math.max(0,Math.ceil(t.genDuration-t.genTime))+'s';
    document.getElementById('trainBar').style.width=Math.min(100,(t.genTime/t.genDuration)*100)+'%';
  }
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
  const lapMode=state.trainMode==='lap';
  for(const grp of state.trainGroups){
    for(let i=0;i<grp.cars.length;i++){
      const car=grp.cars[i];
      const ctrl=grp.controllers[i];
      let score,lapLabel;
      if(lapMode){
        if(car._lapCompleted&&car._lapTime>0){
          score=car._lapTime; // lower is better for display
          lapLabel=car._lapTime.toFixed(1)+'s';
        }else{
          score=Infinity; // unfinished cars sort to bottom
          lapLabel=null;
        }
      }else{
        score=Math.max(0,car.totalProg-(car._fitPenalty||0));
        lapLabel=null;
      }
      // Brake indicator: check neural output index 2 (brake), or car reversing
      const brakeOut=ctrl&&ctrl.lastOutputs?ctrl.lastOutputs[2]:0;
      const braking=brakeOut>0.1||car.isReversing;
      entries.push({score,lapLabel,lapMode,spd:car.spd,braking,offTrack:!!car._offTrack,onGravel:car.onGravel,color:car.data&&car.data.hex?car.data.hex:'#889',car});
    }
  }
  // In lap mode: finished cars (lower lapTime=better) first, then unfinished by progress
  if(lapMode){
    entries.sort((a,b)=>{
      const aFin=a.lapLabel!=null, bFin=b.lapLabel!=null;
      if(aFin&&bFin)return a.score-b.score; // faster lap first
      if(aFin)return -1; if(bFin)return 1;
      return (b.car.totalProg||0)-(a.car.totalProg||0);
    });
  }else{
    entries.sort((a,b)=>b.score-a.score);
  }
  _lbTopEntries=entries.slice(0,8);
  const RANK_COLORS=['#ffd700','#c0c0c0','#cd7f32','#778','#778','#778','#778','#778'];
  const ROW_COUNT=8;
  let html='';
  for(let i=0;i<ROW_COUNT;i++){
    const e=_lbTopEntries[i];
    if(e){
      const spdKph=Math.round(e.spd*3.6);
      const rc=RANK_COLORS[i]||'#778';
      const scoreColor=e.offTrack?'#445':(e.lapLabel?'#4df':'#4f4');
      const brakeHtml=e.braking
        ?'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f33;box-shadow:0 0 5px #f33;"></span>'
        :'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a1a2a;border:1px solid #223;"></span>';
      const scoreText=e.offTrack?'X':(e.lapLabel||e.score.toFixed(1));
      html+=`<div data-lbidx="${i}" style="display:grid;grid-template-columns:18px 10px 1fr 48px 14px;gap:2px 6px;align-items:center;padding:1px 0;cursor:pointer;pointer-events:auto;border-radius:3px;" onmouseenter="this.style.background='rgba(80,160,255,.08)'" onmouseleave="this.style.background=''">`
        +`<span style="color:${rc};font-size:.6rem;text-align:right;">${i+1}</span>`
        +`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${e.color};box-shadow:0 0 4px ${e.color};"></span>`
        +`<span style="color:${scoreColor};font-size:.65rem;">${scoreText}</span>`
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
  _initNNInteraction();
  const cx=cv.getContext('2d'); if(!cx) return;
  const W=cv.width, H=cv.height;
  cx.clearRect(0,0,W,H);

  // Find best car's AI across all simulation groups
  let bestAI=null, bestProg=-1;
  for(const grp of state.trainGroups)
    for(let i=0;i<grp.cars.length;i++)
      if(grp.cars[i].totalProg>bestProg){bestProg=grp.cars[i].totalProg;bestAI=grp.controllers[i];}
  const ai=bestAI;
  if(!ai||!ai.layers||!ai.weights) return;

  const LAYERS=ai.layers;
  const nL=LAYERS.length;
  const maxNodes=Math.max(...LAYERS);

  // Natural (unscaled) layout — full node count, no capping
  const NODE_R=5, V_STEP=16, H_STEP=80, PAD_X=46, PAD_Y=22;
  const vW=PAD_X+(nL-1)*H_STEP+PAD_X;
  const vH=PAD_Y+maxNodes*V_STEP+PAD_Y;

  // Auto-fit when architecture changes (reset pan/zoom)
  const archKey=LAYERS.join(',');
  if(archKey!==_nnLastArch){
    _nnLastArch=archKey;
    const fitZ=Math.min(0.98, W/vW, H/vH)*0.92;
    _nnZoom=fitZ;
    _nnPan.x=(W-vW*fitZ)/2;
    _nnPan.y=(H-vH*fitZ)/2;
  }

  cx.save();
  cx.translate(_nnPan.x,_nnPan.y);
  cx.scale(_nnZoom,_nnZoom);

  // Visible virtual rect for culling
  const vx0=-_nnPan.x/_nnZoom, vy0=-_nnPan.y/_nnZoom;
  const vx1=vx0+W/_nnZoom,     vy1=vy0+H/_nnZoom;

  // Layer X positions
  const xs=Array.from({length:nL},(_,l)=>PAD_X+l*H_STEP);
  // Node Y positions — each layer vertically centred in the virtual canvas
  const ys=LAYERS.map(n=>{
    const top=PAD_Y+(maxNodes-n)*V_STEP/2;
    return Array.from({length:n},(_,i)=>top+i*V_STEP);
  });

  const hiddens=ai.lastHiddens||[];
  const activations=[ai.lastInputs||[],...hiddens,ai.lastOutputs||[]];
  const INPUT_LABELS=['s-90','s-60','s-30','s-10','s-5','s0','s+5','s+10','s+30','s+60','s+90','spd','wpt','edge','grav'];
  const OUTPUT_LABELS=['steer','thrtl','brake'];

  // Draw edges — skip transitions where either side has >40 nodes (too dense to be useful)
  const edgeAlphaMin=0.05;
  for(let l=0;l<nL-1;l++){
    if(LAYERS[l]>40||LAYERS[l+1]>40) continue;
    // Skip layer column if entirely off-screen
    if(xs[l]>vx1+H_STEP||xs[l+1]<vx0-H_STEP) continue;
    const Wm=ai.weights[l].W;
    for(let d=0;d<Wm.length;d++){
      if(ys[l+1][d]<vy0-V_STEP||ys[l+1][d]>vy1+V_STEP) continue;
      for(let s=0;s<Wm[d].length;s++){
        const w=Wm[d][s];
        const alpha=Math.min(0.85,Math.abs(w)/3);
        if(alpha<edgeAlphaMin) continue;
        cx.strokeStyle=w>0?`rgba(80,220,120,${alpha})`:`rgba(220,80,80,${alpha})`;
        cx.lineWidth=Math.min(1.5,Math.abs(w)*0.6+0.2);
        cx.beginPath(); cx.moveTo(xs[l],ys[l][s]); cx.lineTo(xs[l+1],ys[l+1][d]); cx.stroke();
      }
    }
  }

  // Draw nodes (with viewport culling for large layers)
  for(let l=0;l<nL;l++){
    if(xs[l]<vx0-H_STEP||xs[l]>vx1+H_STEP) continue;
    for(let n=0;n<LAYERS[l];n++){
      const y=ys[l][n];
      if(y<vy0-V_STEP||y>vy1+V_STEP) continue;
      const x=xs[l];
      const act=activations[l]?.[n]??0;
      const t=(act+1)/2;
      const r=Math.round(40+t*200),g2=Math.round(80+t*120),b=Math.round(200-t*150);
      cx.beginPath(); cx.arc(x,y,NODE_R,0,Math.PI*2);
      cx.fillStyle=`rgb(${r},${g2},${b})`; cx.fill();
      cx.strokeStyle='#334'; cx.lineWidth=0.8; cx.stroke();
      if(l===0&&INPUT_LABELS[n]){
        cx.fillStyle='#889'; cx.font='6px monospace'; cx.textAlign='right';
        cx.fillText(INPUT_LABELS[n],x-NODE_R-2,y+2);
      } else if(l===nL-1&&OUTPUT_LABELS[n]){
        cx.fillStyle='#889'; cx.font='6px monospace'; cx.textAlign='left';
        cx.fillText(OUTPUT_LABELS[n],x+NODE_R+2,y+2);
      }
    }
    // Node count label below each column
    cx.fillStyle='#445'; cx.font='6px monospace'; cx.textAlign='center';
    cx.fillText(LAYERS[l],xs[l],vH-4);
  }

  cx.restore();

  // Title and hint in screen space (unaffected by pan/zoom)
  const archStr=LAYERS.join('→');
  cx.fillStyle='#556'; cx.font='7px monospace'; cx.textAlign='center';
  cx.fillText(`NET [${archStr}] · BEST CAR`,W/2,11);
  cx.fillStyle='#2a3550'; cx.font='6px monospace'; cx.textAlign='right';
  cx.fillText('scroll=zoom  drag=pan',W-5,H-4);
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
document.getElementById('diffNextBtn').addEventListener('click',()=>{
  if(state.aiDifficulty==='neural') showNeuralModelSel(); else showCarSel();
});
document.getElementById('neuralModelBackBtn').addEventListener('click',showDiffSel);
document.getElementById('neuralModelNextBtn').addEventListener('click',showCarSel);
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
document.getElementById('btnTrainStart').addEventListener('click',()=>{ showTrainSetup(); });
document.getElementById('trainSetupBackBtn').addEventListener('click',()=>{ showTrainTrkSel(); });
document.getElementById('trainSetupStartBtn').addEventListener('click', async ()=>{
  await initTraining({preservedGenome: getTrainSetupGenome()});
  _syncTrainHudSliders();
  _populateTrainTrkSelect();
});
document.getElementById('trainSetupHiddenSlider').addEventListener('input',e=>{
  state.trainHiddenLayers=parseInt(e.target.value);
  document.getElementById('trainSetupHiddenVal').textContent=e.target.value;
  const s=document.getElementById('trainHiddenSlider'); if(s){s.value=e.target.value;document.getElementById('trainHiddenVal').textContent=e.target.value;}
});
document.getElementById('trainSetupNodesSlider').addEventListener('input',e=>{
  state.trainHiddenSize=parseInt(e.target.value);
  document.getElementById('trainSetupNodesVal').textContent=e.target.value;
  const s=document.getElementById('trainNodesSlider'); if(s){s.value=e.target.value;document.getElementById('trainNodesVal').textContent=e.target.value;}
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
document.getElementById('trainNumSimsSlider').addEventListener('input',e=>{
  state.trainNumSims=parseInt(e.target.value);
  document.getElementById('trainNumSimsVal').textContent=e.target.value;
  document.getElementById('trainSimsHint').textContent=e.target.value;
});
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
function _syncTrainHudSliders(){
  const sync=(id,valId,val,fmt)=>{
    const el=document.getElementById(id); if(el)el.value=val;
    const v=document.getElementById(valId); if(v)v.textContent=fmt(val);
  };
  sync('trainOnTrackRateSlider','trainOnTrackRateVal',state.trainOnTrackRewardRate,v=>v.toFixed(2));
  sync('trainStuckPenaltySlider','trainStuckPenaltyVal',state.trainStuckPenaltyRate,v=>v.toFixed(1));
  sync('trainGravelPenaltySlider','trainGravelPenaltyVal',state.trainGravelPenaltyBase,v=>v.toFixed(1));
  sync('trainGravelGrowthSlider','trainGravelGrowthVal',state.trainGravelGrowth,v=>v.toFixed(2));
  sync('trainOffTrackMultSlider','trainOffTrackMultVal',state.trainOffTrackMult,v=>parseInt(v)+'×');
  sync('trainOffTrackDQTimeSlider','trainOffTrackDQTimeVal',state.trainOffTrackDQTime,v=>v.toFixed(1)+'s');
  sync('trainDQPenaltySlider','trainDQPenaltyVal',state.trainDQPenalty,v=>parseInt(v));
  sync('trainMutRateSlider','trainMutRateVal',state.trainMutRate,v=>v.toFixed(2));
  sync('trainMutStrengthSlider','trainMutStrengthVal',state.trainMutStrength,v=>v.toFixed(2));
}
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
