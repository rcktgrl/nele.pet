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
  initTraining, stopTraining, placeBestCarMarker
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
  if(state.gState==='training'&&e.buttons===2){
    editorCam.yaw-=e.movementX*0.006;
    editorCam.pitch=Math.max(0.25,Math.min(1.55,editorCam.pitch-e.movementY*0.004));
  }
});
document.addEventListener('wheel',e=>{
  if(state.gState==='training'){
    editorCam.distance=Math.max(50,Math.min(1200,editorCam.distance*(1+Math.sign(e.deltaY)*0.08)));
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
    // Fast-forward: run multiple physics substeps per rendered frame at full dt each
    const ffSteps=Math.max(1,state.trainFF||1);
    const subDt=Math.min(dt,0.05); // cap substep to avoid instability
    for(let _s=0;_s<ffSteps;_s++){
      for(const ai of state.aiControllers)ai.update(subDt);
      // No inter-car collisions in training — each car is an independent simulation
      // Accumulate wall and gravel penalties for training fitness
      for(const car of state.allCars){
        if(car._offTrack)continue;
        if(!car._fitPenalty)car._fitPenalty=0;
        // Wall hit: stuckTimer increased this substep → car is against a wall
        const prevStuck=car._trainPrevStuck||0;
        if(car.stuckTimer>prevStuck) car._fitPenalty+=5*subDt;   // wall penalty
        if(car.onGravel)             car._fitPenalty+=0.5*subDt; // gravel penalty
        car._trainPrevStuck=car.stuckTimer;
      }
      // Off-track detection: car center more than half road width from nearest waypoint
      if(state.trkData&&state.trkPts.length){
        const halfW=state.trkData.rw*0.55;
        for(const car of state.allCars){
          if(car._offTrack)continue;
          let md=Infinity;
          for(const p of state.trkPts){const dx=car.pos.x-p.x,dz=car.pos.z-p.z;const d=dx*dx+dz*dz;if(d<md)md=d;}
          if(Math.sqrt(md)>halfW){car._offTrack=true;car._fitPenalty=(car._fitPenalty||0)+200;}
        }
      }
      // Reset any car that somehow finishes (laps set to 999, but just in case)
      for(let i=0;i<state.allCars.length;i++){
        if(state.allCars[i].finished) resetCarForTraining(state.allCars[i],state.trainGrid[i].pos,state.trainGrid[i].hdg);
      }
      // Track position of leading car this substep
      let _bi=0;
      for(let i=1;i<state.allCars.length;i++){if(state.allCars[i].totalProg>state.allCars[_bi].totalProg)_bi=i;}
      const _bc=state.allCars[_bi];
      state.trainBestCarPos={x:_bc.pos.x,y:_bc.pos.y,z:_bc.pos.z};
      // Tick the GA; on generation boundary, respawn cars with evolved weights
      if(state.trainer.tick(subDt,state.allCars)){
        if(state.trainBestCarPos) placeBestCarMarker(state.trainBestCarPos.x,state.trainBestCarPos.y,state.trainBestCarPos.z);
        for(let i=0;i<state.allCars.length;i++){
          const g=state.trainGrid[i%state.trainGrid.length];
          resetCarForTraining(state.allCars[i],g.pos,g.hdg);
          state.aiControllers[i].setWeights(state.trainer.population[i].genome);
        }
      }
    }
    // Split-screen cameras follow the top N cars; fall back to top-down if no split cams
    if(state.trainSplitCams&&state.trainSplitCams.length){
      updateTrainSplitCameras();
    }else{
      updateEditorPreviewCamera(dt);
    }
    updateTrainingHUD();
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
  const t=state.trainer;
  document.getElementById('trainGenNum').textContent=`GEN ${t.generation+1}`;
  document.getElementById('trainBestFit').textContent=`BEST ${t.bestFitness>0?t.bestFitness.toFixed(1):'—'}`;
  document.getElementById('trainAvgFit').textContent=`AVG ${t.avgFitness.toFixed(1)}`;
  document.getElementById('trainCountdown').textContent=Math.max(0,Math.ceil(t.genDuration-t.genTime))+'s';
  document.getElementById('trainBar').style.width=Math.min(100,(t.genTime/t.genDuration)*100)+'%';
  _drawNNViz();
}

function _drawNNViz(){
  if(!_nnCanvas) _nnCanvas=document.getElementById('trainNNCanvas');
  const cv=_nnCanvas; if(!cv) return;
  const cx=cv.getContext('2d'); if(!cx) return;
  const W=cv.width, H=cv.height;
  cx.clearRect(0,0,W,H);
  // Find the best car's AI controller (highest totalProg)
  let bi=0;
  for(let i=1;i<state.allCars.length;i++) if(state.allCars[i].totalProg>state.allCars[bi].totalProg) bi=i;
  const ai=state.aiControllers[bi];
  if(!ai) return;
  // Layer x positions and node counts
  const LAYERS=[7,5,2];
  const LABELS=[['s-60','s-30','s0','s+30','s+60','spd','wpt'],['H0','H1','H2','H3','H4'],['steer','thrtl']];
  const xs=[28, W/2, W-28];
  const nodeR=7;
  const activations=[ai.lastInputs||[], ai.lastHidden||[], ai.lastOutputs||[]];
  // Compute node y positions
  const ys=LAYERS.map((n,l)=>Array.from({length:n},(_,i)=>(i+1)/(n+1)*H));
  // Draw edges (W1: layer0→1, W2: layer1→2)
  const weights=[ai.W1, ai.W2]; // W1[h][i], W2[o][h]
  for(let l=0;l<2;l++){
    const src=ys[l], dst=ys[l+1];
    const W_=weights[l];
    for(let d=0;d<W_.length;d++){
      for(let s=0;s<W_[d].length;s++){
        const w=W_[d][s];
        const alpha=Math.min(0.85,Math.abs(w)/3);
        const thick=Math.min(3,Math.abs(w)*0.7+0.3);
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
  for(let l=0;l<3;l++){
    for(let n=0;n<LAYERS[l];n++){
      const x=xs[l], y=ys[l][n];
      const act=activations[l][n]??0;
      const t=(act+1)/2; // 0..1
      const r=Math.round(40+t*200), g2=Math.round(80+t*120), b=Math.round(200-t*150);
      cx.beginPath(); cx.arc(x,y,nodeR,0,Math.PI*2);
      cx.fillStyle=`rgb(${r},${g2},${b})`; cx.fill();
      cx.strokeStyle='#334'; cx.lineWidth=1; cx.stroke();
      if(l===0||l===2){
        cx.fillStyle='#aab'; cx.font='7px monospace';
        cx.textAlign=l===0?'right':'left';
        cx.fillText(LABELS[l][n],x+(l===0?-nodeR-2:nodeR+2),y+2.5);
      }
    }
  }
  // Title
  cx.fillStyle='#556'; cx.font='8px monospace'; cx.textAlign='center';
  cx.fillText('NEURAL NET · BEST CAR',W/2,10);
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
document.getElementById('btnTrainStart').addEventListener('click',()=>{ void initTraining(); });
document.getElementById('trainSaveBtn').addEventListener('click',()=>{
  if(!state.trainer)return;
  const saved=state.trainer.saveToLocalStorage();
  const exported=state.trainer.exportAsJSON('neural-driver');
  if(saved||exported) document.getElementById('trainSaveBtn').textContent='EXPORTED ✓';
  setTimeout(()=>{ const b=document.getElementById('trainSaveBtn'); if(b)b.textContent='SAVE & EXPORT'; },2000);
});
document.getElementById('trainStopBtn').addEventListener('click',()=>{ stopTraining(); showMain(); });
document.getElementById('trainPopSlider').addEventListener('input',e=>{
  state.trainPopSize=parseInt(e.target.value);
  document.getElementById('trainPopVal').textContent=e.target.value;
});
document.getElementById('trainFFSlider').addEventListener('input',e=>{
  state.trainFF=parseInt(e.target.value);
  document.getElementById('trainFFVal').textContent=e.target.value+'×';
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
