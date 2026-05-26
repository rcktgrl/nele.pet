'use strict';
import { CARS } from './data/cars.js';
import { state, scene, dc, editorCam, camEditor } from './state.js';
import { buildTrack } from './track-gen.js';
import { instantiateRaceCars, Car } from './car.js';
import { AI } from './ai-script.js';
import { setupLights } from './lighting.js';
import {
  initAudio, initAiSounds, clearAiSounds,
  stopAudio, stopMusic, playBeep,
  playVictoryJingle, playLossSound,
  startMusic, audioReady, aiSounds, announce
} from './audio.js';
import {
  resetCurrentRaceSubmitted, leaderboardByTrack,
  normaliseTrackId, renderResultsLeaderboard,
  handlePostRaceLeaderboard
} from './leaderboard.js';
import { updateTouchControlsVisibility, releaseAllTouchControls, isTouchControlsEnabled } from './touch-controls.js';
import { fmtT } from './util.js';
import { notify } from './notify.js';
import {
  onlineGhostEnabled, ghostVisuals, clearGhostVisual,
  setupGhostReplayFromTrack, startGhostRecording,
  finalizeGhostRecording, setOnlineGhostToggle
} from './ghost.js';
import { getTrackById } from './editor.js';
import { THREE } from './three.js';

// ═══════════════════════════════════════════════════════
//  RACE LOGIC
// ═══════════════════════════════════════════════════════
export async function initRace(){
  for(const ctrl of state.aiControllers)if(ctrl.destroy)ctrl.destroy();
  for(const c of state.allCars)scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.aiControllers=[]; state.pCar=null;
  clearAiSounds();
  clearGhostVisual();

  state.trkData=getTrackById(state.selTrk);
  try{ buildTrack(state.trkData); }catch(e){ console.error('buildTrack error:',e); }
  setupLights();

  let corridors=state.cityCorridors;

  const ghostModeEnabled = state.opponentMode==='ghost' && !state.vsMode;

  // Keep the ghost module in sync so replay loading works correctly
  if(ghostModeEnabled!==onlineGhostEnabled) setOnlineGhostToggle(ghostModeEnabled);

  // In VS mode: no AI, no ghost — just the player car
  const aiCount = state.vsMode ? 0 : (ghostModeEnabled ? 0 : 4);

  const raceCars=instantiateRaceCars({
    trackPoints: state.trkPts,
    cars: CARS,
    selectedCarIndex: state.selCar,
    aiCount,
    scene: scene,
    createAIController: (aiCar,i)=>{
      const ctx=()=>({
        trackPoints: state.trkPts,
        trackCurvature: state.trkCurv,
        cityAiPoints: state.cityAiPts,
        corridors,
        trackData: state.trkData,
        playerCar: state.pCar
      });
      return new AI(aiCar,.044+i*.010,ctx);
    }
  });
  state.pCar=raceCars.playerCar;
  state.aiCars=raceCars.aiCars;
  state.aiControllers=raceCars.aiControllers;
  state.allCars=raceCars.allCars;

  // ── VS mode: spawn a remote car for the opponent ──────────────────────────
  if(state.vsMode){
    // Remove previous opponent car if any
    if(state.vsOpponentCar) scene.remove(state.vsOpponentCar.mesh);
    const oppCarData=CARS[state.vsOpponentCarIdx ?? 0];
    // Spawn slightly offset from the player start so they don't overlap
    const startPos={x:state.pCar.pos.x + 4, y:state.pCar.pos.y, z:state.pCar.pos.z + 4};
    state.vsOpponentCar=new Car(oppCarData, startPos, state.pCar.hdg, false, scene);
    state.vsOpponentState=null;
    state.vsOpponentFinished=false;
    state.vsOpponentFinTime=0;
    state.vsPosSendTimer=0;
    state.allCars.push(state.vsOpponentCar);
  } else {
    state.vsOpponentCar=null;
  }

  await setupGhostReplayFromTrack(state.trkData&&state.trkData.id);

  state.raceTime=0; state.gState='countdown';
  resetCurrentRaceSubmitted();
  document.getElementById('hud').style.display='block';
  document.getElementById('hint').style.display=isTouchControlsEnabled()?'none':'block';
  updateTouchControlsVisibility(state.gState);
  document.getElementById('camLabel').textContent='[ C ] COCKPIT VIEW';
  state.camMode='chase'; dc.style.display='none';
  document.getElementById('speedBox').style.display='block';
  document.getElementById('gearBox').style.display='block';
  startGhostRecording();
  if(ghostModeEnabled&&ghostVisuals.length===0)notify('Ghost mode enabled: no matching ghost data for this track yet.');

  // Show VS opponent name in HUD
  if(state.vsMode){
    const vsTag=document.getElementById('vsOpponentTag');
    if(vsTag){ vsTag.textContent=state.vsOpponentName||'Opponent'; vsTag.style.display='block'; }
  } else {
    const vsTag=document.getElementById('vsOpponentTag');
    if(vsTag) vsTag.style.display='none';
  }

  doCountdown();
}

export function doCountdown(){
  stopMusic();
  initAudio();
  if(audioReady){
    initAiSounds(state.aiCars.length);
  }
  const el=document.getElementById('cd');
  el.style.display='block';
  let c=3; el.textContent=c;
  announce('3');
  playBeep(440,.18,.25,'square');
  const iv=setInterval(()=>{
    c--;
    if(c>0){
      el.textContent=c; playBeep(440,.18,.25,'square'); announce(String(c));
    }else{
      el.textContent='GO!'; playBeep(880,.45,.4,'square'); announce('Go go go!');
      clearInterval(iv);
      setTimeout(()=>{el.style.display='none'; state.gState='racing'; updateTouchControlsVisibility(state.gState); startMusic();},700);
    }
  },1000);
}

let _prePauseState='racing';
export function pauseRace(){
  _prePauseState=state.gState;
  state.gState='paused'; stopAudio(); stopMusic();
  document.getElementById('pauseMenu').style.display='flex';
  updateTouchControlsVisibility(state.gState);
  releaseAllTouchControls();
}

export function resumeRace(){
  state.gState=_prePauseState==='cooldown'?'cooldown':'racing';
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  updateTouchControlsVisibility(state.gState);
  initAudio(); startMusic();
}

export async function endRace(){
  const all=[state.pCar,...state.aiCars].sort((a,b)=>{
    if(a.finished&&b.finished)return a.finTime-b.finTime;
    if(a.finished)return-1; if(b.finished)return 1; return b.totalProg-a.totalProg;
  });
  const pos=all.indexOf(state.pCar)+1;
  state.gState='cooldown';

  // VS: broadcast finish time
  if(state.vsMode&&state.vsNetwork){
    state.vsNetwork.sendPlayerFinished(state.pCar.finTime||state.raceTime);
  }

  if(pos===1){
    playVictoryJingle();
    announce('Checkered flag! You win!');
  }else{
    playLossSound();
    announce('Race finished! P'+pos+'!');
  }
  const ghostPayload=state.vsMode?null:await finalizeGhostRecording();
  setTimeout(()=>showResults(ghostPayload),1200);
}
globalThis.endRace=endRace;

export function showResults(ghostPayload){
  updateResultsUI();
  if(!state.vsMode) handlePostRaceLeaderboard(notify,ghostPayload);
  document.getElementById('results').style.display='flex';
  document.getElementById('hud').style.display='none';
  document.getElementById('touchControls').style.display='none';
  for(const visual of ghostVisuals){
    if(visual.tagEl)visual.tagEl.style.display='none';
  }
  const vsTag=document.getElementById('vsOpponentTag');
  if(vsTag) vsTag.style.display='none';
  releaseAllTouchControls();
  dc.style.display='none';
}

export function updateResultsUI(){
  if(state.vsMode){
    _updateVsResultsUI();
    return;
  }
  const all=[state.pCar,...state.aiCars].sort((a,b)=>{
    if(a.finished&&b.finished)return a.finTime-b.finTime;
    if(a.finished)return-1; if(b.finished)return 1; return b.totalProg-a.totalProg;
  });
  const win=all[0]===state.pCar;
  document.getElementById('rTitle').textContent=win?'🏆 VICTORY!':'RACE OVER';
  document.getElementById('rTitle').style.color=win?'#ffd700':'#ff5500';
  const pods=document.getElementById('podium'); pods.innerHTML='';
  const medals=['🥇','🥈','🥉','4th','5th'];
  for(let i=0;i<Math.min(5,all.length);i++){
    const car=all[i],ip=car===state.pCar;
    const d=document.createElement('div'); d.className='pi';
    d.innerHTML=`<div class="pm">${medals[i]}</div>
      <div class="pn" style="color:${ip?'#ffd700':'#aaa'}">${ip?'⭐ YOU':car.data.name}</div>
      <div class="pt">${car.finished?fmtT(car.finTime):'racing...'}</div>`;
    pods.appendChild(d);
  }
  const pp=all.indexOf(state.pCar)+1;
  document.getElementById('ptime').textContent=`Your time: ${fmtT(state.pCar.finTime||state.raceTime)}  ·  P${pp}`;
  const carName=(state.pCar&&state.pCar.data&&state.pCar.data.name)?state.pCar.data.name:'Unknown';
  document.getElementById('runCar').textContent=`Run car: ${carName}`;
  const cached=leaderboardByTrack.get(normaliseTrackId(state.trkData&&state.trkData.id,state.trkData&&state.trkData.name));
  renderResultsLeaderboard(cached?cached.entries:[]);
}

function _updateVsResultsUI(){
  const myTime=state.pCar?state.pCar.finTime||state.raceTime:0;
  const oppTime=state.vsOpponentFinished?state.vsOpponentFinTime:null;
  const myFinished=!!(state.pCar&&state.pCar.finished);
  let win=false;
  if(myFinished&&oppTime!==null) win=myTime<=oppTime;
  else if(myFinished&&oppTime===null) win=true;

  document.getElementById('rTitle').textContent=win?'🏆 VICTORY!':'RACE OVER';
  document.getElementById('rTitle').style.color=win?'#ffd700':'#ff5500';
  const pods=document.getElementById('podium'); pods.innerHTML='';

  const entries=[
    {name:'⭐ YOU', time:myTime, finished:myFinished},
    {name:state.vsOpponentName||'Opponent', time:oppTime??state.raceTime, finished:!!oppTime},
  ].sort((a,b)=>{
    if(a.finished&&b.finished)return a.time-b.time;
    if(a.finished)return -1; if(b.finished)return 1; return 0;
  });

  const medals=['🥇','🥈'];
  entries.forEach((e,i)=>{
    const d=document.createElement('div'); d.className='pi';
    d.innerHTML=`<div class="pm">${medals[i]}</div>
      <div class="pn" style="color:${e.name.startsWith('⭐')?'#ffd700':'#aaa'}">${e.name}</div>
      <div class="pt">${e.finished?fmtT(e.time):'still racing...'}</div>`;
    pods.appendChild(d);
  });

  document.getElementById('ptime').textContent=`Your time: ${fmtT(myTime)}`;
  document.getElementById('runCar').textContent=`VS Race · Room: ${state.vsRoomCode}`;
  document.getElementById('resultsLeaderboard').innerHTML='';
  const h3=document.querySelector('#resultsLbWrap h3');
  if(h3) h3.textContent='';
}

export function startRace(){
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  void initRace();
}

export function restartRace(){
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  releaseAllTouchControls();
  document.getElementById('results').style.display='none';
  // In VS mode, go back to main menu — the VS session is over
  if(state.vsMode){
    import('./menu.js').then(m=>m.showMain());
    return;
  }
  void initRace();
}
