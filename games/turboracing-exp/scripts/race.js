'use strict';
import { CARS } from '../data/cars.js';
import { state, scene, dc } from './state.js';
import { buildTrack } from './track-gen.js';
import { instantiateRaceCars } from './car.js';
import { AI } from './ai-script.js';
import { setupLights } from './lighting.js';
import {
  initAudio, initAiSounds, clearAiSounds,
  stopAudio, stopMusic, playBeep,
  playVictoryJingle, playLossSound,
  startMusic, audioReady, announce
} from './audio.js';
import {
  resetCurrentRaceSubmitted, getCurrentTrackLeaderboard, renderResultsLeaderboard,
  handlePostRaceLeaderboard
} from './leaderboard.js';
import { updateTouchControlsVisibility, releaseAllTouchControls, isTouchControlsEnabled } from './touch-controls.js';
import { fmtT } from './utils/format.js';
import { notify } from './notify.js';
import {
  onlineGhostEnabled, ghostVisuals, clearGhostVisual,
  setupGhostReplayFromTrack, startGhostRecording,
  finalizeGhostRecording
} from './ghost.js';
import { getTrackById } from './editor.js';

// ═══════════════════════════════════════════════════════
//  RACE LOGIC
// ═══════════════════════════════════════════════════════
export async function initRace(){
  for(const c of state.allCars)scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.aiControllers=[]; state.pCar=null;
  clearAiSounds();
  clearGhostVisual();

  state.trkData=getTrackById(state.selTrk);
  try{ buildTrack(state.trkData); }catch(e){ console.error('buildTrack error:',e); }
  setupLights();

  let corridors=state.cityCorridors;

  const ghostModeEnabled=onlineGhostEnabled;
  const raceCars=instantiateRaceCars({
    trackPoints: state.trkPts,
    cars: CARS,
    selectedCarIndex: state.selCar,
    aiCount: ghostModeEnabled?0:4,
    scene: scene,
    createAIController: (aiCar,i)=>new AI(aiCar,.044+i*.010,()=>({
      trackPoints: state.trkPts,
      trackCurvature: state.trkCurv,
      cityAiPoints: state.cityAiPts,
      corridors,
      trackData: state.trkData,
      playerCar: state.pCar
    }))
  });
  state.pCar=raceCars.playerCar;
  state.aiCars=raceCars.aiCars;
  state.aiControllers=raceCars.aiControllers;
  state.allCars=raceCars.allCars;
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
  if(pos===1){
    playVictoryJingle();
    announce('Checkered flag! You win!');
  }else{
    playLossSound();
    announce('Race finished! P'+pos+'!');
  }
  const ghostPayload=await finalizeGhostRecording();
  setTimeout(()=>showResults(ghostPayload),1200);
}
globalThis.endRace=endRace;

export function showResults(ghostPayload){
  updateResultsUI();
  handlePostRaceLeaderboard(notify,ghostPayload);
  document.getElementById('results').style.display='flex';
  document.getElementById('hud').style.display='none';
  document.getElementById('touchControls').style.display='none';
  for(const visual of ghostVisuals){
    if(visual.tagEl)visual.tagEl.style.display='none';
  }
  releaseAllTouchControls();
  dc.style.display='none';
}

export function updateResultsUI(){
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
  const cached = getCurrentTrackLeaderboard();
  renderResultsLeaderboard(cached.entries);
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
  void initRace();
}
