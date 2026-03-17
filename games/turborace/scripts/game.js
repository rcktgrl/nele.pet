import { TURBORACE_VERSION } from './version.js';
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
import { updateCamera, toggleCam, updateEditorPreviewCamera } from './camera.js';
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
  startRace, restartRace, updateResultsUI
} from './race.js';
import {
  editorRebuildScene, drawEditorCanvas,
  setEditorNodeCount, setEditorBrushAsset, setEditorBrushEnabled, setEditorBrushSize, setEditorBrushSpacing,
  onEditorMetaChanged, onEditorStreetGridChanged, onEditorNodeChanged,
  addEditorNode, insertEditorNodeAfter, deleteEditorNode, deleteSelectedEditorAsset,
  createNewEditorTrack, duplicateEditorTrack, deleteEditorTrack, resetEditorTrack,
  saveEditorTrack, upgradeEditorTrackToLatestGeneration, showTrackEditor,
  reverseEditorTrack
} from './editor.js';
import {
  showMain, showIntro, showTrkSel, showCarSel,
  showSettings, closeSettings
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
});
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
    return -steerSliderValue; // negate to match keyboard convention
    const str=Math.abs(gyroSteer)>0.01?gyroSteer:Math.abs(sliderSteer)>0.01?sliderSteer:keySteer;
    state.pCar.update({thr,brk,str},dt);
    sampleGhostFrame();
    for(const ai of state.aiControllers)ai.update(dt);
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&state.aiCars[i])aiSounds[i].update(state.aiCars[i],state.pCar);}
    updateAudio(thr,brk,dt,state.pCar,keys); updateCamera(); updateHUD(); drawDash(); drawMinimap();
    updateGhostReplay();
  }else if(state.gState==='cooldown'){
    state.raceTime+=dt;
    state.pCar.update({thr:0,brk:0.3,str:0},dt);
    for(const ai of state.aiControllers){if(!ai.car.finished)ai.update(dt);}
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
  }else if(state.gState==='countdown'||state.gState==='finished'||state.gState==='paused'){
    if(state.gState==='finished'){
      state.raceTime+=dt;
      for(const ai of state.aiControllers){if(!ai.car.finished)ai.update(dt);}
      updateHUD(); drawMinimap();
    }
    updateCamera();
    if(state.gState==='countdown'||state.gState==='finished')updateGhostReplay();
    else for(const visual of ghostVisuals){ if(visual.tagEl)visual.tagEl.style.display='none'; }
  }
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
document.getElementById('showTrkSelBtn').addEventListener('click',showTrkSel);
document.getElementById('btnGo').addEventListener('click',startRace);
document.getElementById('trkSelBackBtn').addEventListener('click',showMain);
document.getElementById('btnNxt').addEventListener('click',showCarSel);
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
document.getElementById('resetEditorTrackBtn').addEventListener('click',resetEditorTrack);
document.getElementById('upgradeTrackGenerationBtn').addEventListener('click',upgradeEditorTrackToLatestGeneration);
document.getElementById('closeLeaderboardModalBtn').addEventListener('click',closeTrackLeaderboardModal);
document.getElementById('leaderboardModal').addEventListener('click',e=>{ if(e.target.id==='leaderboardModal') closeTrackLeaderboardModal(); });
document.getElementById('menuBtn').addEventListener('click',showMain);
document.getElementById('raceAgainBtn').addEventListener('click',restartRace);

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
  getActiveCamera:()=>state.activeCam
});
state.renderer=renderer;
setupLights(); startRenderLoop(); loadArcadeUser(); showIntro();
