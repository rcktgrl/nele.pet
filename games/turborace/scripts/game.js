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
  reverseEditorTrack, exportTrackAsJSON
} from './editor.js';
import {
  showMain, showIntro, showTrkSel, showCarSel,
  showDiffSel, showOnlineTrkSel, showSettings, closeSettings,
  showVsLobby, vsCreateRoom, vsJoinRoom, vsStartRace, vsLeaveLobby,
  vsCopyCode, vsCopyInviteLink, vsLoadOnlineTracks,
  onCarColorInput, resetCarColor, onVsColorInput,
  showFdMapSel, showFdMapOnlineTracks
} from './menu.js';
import {
  closeTrackLeaderboardModal
} from './leaderboard.js';
import { resetEditorCameraToTrack as camResetEditorCam } from './camera.js';
import { loadArcadeUser } from './user.js';
import { showFreeDriveMenu, startFreeDrive, onFdColorInput, updateFreeDrive } from './freedrive.js';

'use strict';

// ═══════════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='KeyC'&&(state.gState==='racing'||state.gState==='cooldown'||state.gState==='freedrive'))toggleCam();
  if(e.code==='Escape'){
    const leaderboardModal=document.getElementById('leaderboardModal');
    if(leaderboardModal&&leaderboardModal.style.display==='flex'){ closeTrackLeaderboardModal(); return; }
    if(state.gState==='racing'||state.gState==='cooldown'||state.gState==='freedrive')pauseRace();
    else if(state.gState==='paused')resumeRace();
  }
});
document.addEventListener('keyup',e=>{ keys[e.code]=false; });
document.addEventListener('pointermove',e=>{
  if((state.gState==='racing'||state.gState==='cooldown'||state.gState==='finished'||state.gState==='countdown'||state.gState==='freedrive')&&e.buttons===2){
    raceCamOrbit.yaw-=e.movementX*0.004;
    raceCamOrbit.pitch=Math.max(-0.55,Math.min(0.75,raceCamOrbit.pitch-e.movementY*0.003));
    raceCamOrbit.lastInput=performance.now();
  }
});
document.addEventListener('wheel',e=>{
  if(state.gState==='racing'||state.gState==='cooldown'||state.gState==='countdown'||state.gState==='finished'||state.gState==='freedrive'){
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
//  VS REMOTE CAR INTERPOLATION
// ═══════════════════════════════════════════════════════

// Blend factors for the dead-reckon + error-correction loop.
const _DR_BLEND_POS  = 12;   // position correction rate (fraction per second)
const _DR_BLEND_HDG  = 15;   // heading  correction rate (fraction per second)
const _DR_BLEND_SPD  = 8;    // speed    correction rate (fraction per second)
const _DR_SNAP_DIST  = 15;   // instant-snap threshold (metres)

/**
 * Advance every remote VS car for the current frame using dead-reckoning
 * + error correction:
 *
 *   1. Dead-reckon  — move car forward using its current speed + heading,
 *      same physics as car.js: fwd = (sin(hdg), 0, cos(hdg)).
 *      Produces smooth, physics-like motion between network packets.
 *
 *   2. Error-correct — blend the dead-reckoned position toward the latest
 *      received snapshot.  Typical error is < 0.5 m and corrects in < 150 ms,
 *      which is completely invisible.  If error exceeds _DR_SNAP_DIST the
 *      car teleports instantly (handles spawn and large corrections).
 *
 * No delay buffer required; works smoothly at any packet rate.
 */
function _updateRemoteCars(dt){
  if(!state.vsSlots) return;

  for(const slot of state.vsSlots){
    if(slot.id===state.vsMyId) continue;
    const car  = state.vsCarsById[slot.id];
    const snap = state.vsCarStates[slot.id];
    if(!car||!snap) continue;

    // ── 1. Dead-reckon ────────────────────────────────────────────────────────
    car.pos.x += Math.sin(car.hdg) * car.spd * dt;
    car.pos.z += Math.cos(car.hdg) * car.spd * dt;

    // ── 2. Error correction ───────────────────────────────────────────────────
    const ex=snap.x-car.pos.x, ez=snap.z-car.pos.z;
    const dist=Math.sqrt(ex*ex+ez*ez);

    if(dist>_DR_SNAP_DIST){
      car.pos.x=snap.x; car.pos.z=snap.z;
      car.hdg=snap.hdg; car.spd=snap.spd;
    } else {
      const pb=Math.min(1,_DR_BLEND_POS*dt);
      car.pos.x+=ex*pb;
      car.pos.z+=ez*pb;

      let dh=snap.hdg-car.hdg;
      if(dh> Math.PI) dh-=Math.PI*2;
      if(dh<-Math.PI) dh+=Math.PI*2;
      car.hdg+=dh*Math.min(1,_DR_BLEND_HDG*dt);

      car.spd+=(snap.spd-car.spd)*Math.min(1,_DR_BLEND_SPD*dt);
    }

    // ── 3. Apply to mesh ──────────────────────────────────────────────────────
    car.pos.y=car.groundY();
    car.mesh.position.copy(car.pos);
    car.mesh.rotation.y=car.hdg;
    if(snap.totalProg!=null) car.totalProg=snap.totalProg;
    if(snap.lap      !=null) car.lap      =snap.lap;
  }
}

/** Broadcast our position ~20 Hz; host also broadcasts AI car positions each tick */
function _broadcastVsPos(dt){
  if(!state.vsMode||!state.vsNetwork||!state.pCar) return;
  state.vsPosSendTimer-=dt;
  if(state.vsPosSendTimer>0) return;
  state.vsPosSendTimer=state.vsPosSendInterval;
  const c=state.pCar;
  state.vsNetwork.sendPosUpdate(
    state.vsMyId,
    Math.round(c.pos.x*100)/100,
    Math.round(c.pos.z*100)/100,
    Math.round(c.hdg*1000)/1000,
    Math.round(c.spd*10)/10,
    c.lap,
    Math.round(c.totalProg*100)/100
  );
  // Host: broadcast AI car positions so guests can see them
  if(state.vsIsHost){
    for(const {slotId} of state.vsAIControllers){
      const ac=state.vsCarsById[slotId];
      if(!ac) continue;
      state.vsNetwork.sendPosUpdate(
        slotId,
        Math.round(ac.pos.x*100)/100,
        Math.round(ac.pos.z*100)/100,
        Math.round(ac.hdg*1000)/1000,
        Math.round(ac.spd*10)/10,
        ac.lap,
        Math.round(ac.totalProg*100)/100
      );
    }
  }
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
    // VS: lerp remote cars + broadcast our position
    if(state.vsMode){ _updateRemoteCars(dt); _broadcastVsPos(dt); }
    resolveCarCollisions(state.allCars);
    for(const car of state.allCars) car.checkGravel();
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&state.aiCars[i])aiSounds[i].update(state.aiCars[i],state.pCar);}
    updateAudio(thr,brk,dt,state.pCar,keys); updateCamera(); updateHUD(); drawDash(); drawMinimap();
    updateGhostReplay();
  }else if(state.gState==='cooldown'){
    state.raceTime+=dt;
    state.pCar.update({thr:0,brk:0.3,str:0},dt);
    for(const ai of state.aiControllers){if(!ai.car.finished)ai.update(dt);}
    if(state.vsMode){ _updateRemoteCars(dt); _broadcastVsPos(dt); }
    resolveCarCollisions(state.allCars);
    for(const car of state.allCars) car.checkGravel();
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&state.aiCars[i])aiSounds[i].update(state.aiCars[i],state.pCar);}
    updateAudio(0,0,dt,state.pCar,keys); updateCamera();
    updateGhostReplay();
    if(document.getElementById('results').style.display==='flex') updateResultsUI();
  }else if(state.gState==='freedrive'){
    updateFreeDrive(dt);
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
      if(state.vsMode) _updateRemoteCars(dt);
      resolveCarCollisions(state.allCars);
      for(const car of state.allCars) car.checkGravel();
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
document.getElementById('vsModeBtn').addEventListener('click',function(){tryStartMenuMusic();showVsLobby();});
document.getElementById('freeDriveBtn').addEventListener('click',function(){tryStartMenuMusic();void showFdMapSel();});
document.getElementById('fdMapBackBtn').addEventListener('click',showMain);
document.getElementById('fdMapLoadOnlineBtn').addEventListener('click',function(){void showFdMapOnlineTracks();});
document.getElementById('fdMapNextBtn').addEventListener('click',showFreeDriveMenu);
document.getElementById('fdBackBtn').addEventListener('click',function(){void showFdMapSel();});
document.getElementById('fdStartBtn').addEventListener('click',function(){tryStartMenuMusic();void startFreeDrive();});
document.getElementById('fdColor').addEventListener('input',e=>onFdColorInput(e.target.value));
document.getElementById('fdOnlineToggle').addEventListener('change',e=>{ state.fdOnline=e.target.checked; });
document.getElementById('trackEditorBtn').addEventListener('click',function(){tryStartMenuMusic();showTrackEditor();});
document.getElementById('mainSettingsBtn').addEventListener('click',function(){tryStartMenuMusic();showSettings();});
document.getElementById('backToSelectionBtn').addEventListener('click',()=>{ window.location.href='../index.html'; });
document.getElementById('showTrkSelBtn').addEventListener('click',showDiffSel);
document.getElementById('btnGo').addEventListener('click',startRace);
document.getElementById('carColorPicker').addEventListener('input',e=>onCarColorInput(e.target.value));
document.getElementById('carColorResetBtn').addEventListener('click',resetCarColor);
document.getElementById('trkSelBackBtn').addEventListener('click',showMain);
document.getElementById('loadOnlineTracksBtn').addEventListener('click',showOnlineTrkSel);
document.getElementById('onlineTrkBackBtn').addEventListener('click',showTrkSel);
document.getElementById('btnOnlineNxt').addEventListener('click',showDiffSel);
document.getElementById('btnNxt').addEventListener('click',showDiffSel);
document.getElementById('diffBackBtn').addEventListener('click',showTrkSel);
document.getElementById('diffNextBtn').addEventListener('click',()=>{ showCarSel(); });
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

// VS lobby buttons
document.getElementById('vsCreateBtn').addEventListener('click', vsCreateRoom);
document.getElementById('vsJoinBtn').addEventListener('click', vsJoinRoom);
document.getElementById('vsStartBtn').addEventListener('click', vsStartRace);
document.getElementById('vsLeaveLobbyBtn').addEventListener('click', vsLeaveLobby);
document.getElementById('vsLobbyBackBtn').addEventListener('click', vsLeaveLobby);
document.getElementById('vsCopyCodeBtn').addEventListener('click', vsCopyCode);
document.getElementById('vsCopyInviteBtn').addEventListener('click', vsCopyInviteLink);
document.getElementById('vsLoadOnlineTracksBtn').addEventListener('click', vsLoadOnlineTracks);
document.getElementById('vsHostColor').addEventListener('input', e=>onVsColorInput(e.target.value));
document.getElementById('vsGuestColor').addEventListener('input', e=>onVsColorInput(e.target.value));

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
  getTrainSplitCams:()=>[],
  getGState:()=>state.gState,
});
state.renderer=renderer;
setupLights(); startRenderLoop(); loadArcadeUser(); showIntro();
