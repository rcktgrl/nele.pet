'use strict';
import { CARS } from './data/cars.js';
import { state, scene, dc, editorCam, camEditor } from './state.js';
import { buildTrack } from './track-gen.js';
import { instantiateRaceCars, Car, buildRaceGrid } from './car.js';
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
//  SINGLE-PLAYER RACE
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

  const corridors=state.cityCorridors;
  const ghostModeEnabled = state.opponentMode==='ghost';
  if(ghostModeEnabled!==onlineGhostEnabled) setOnlineGhostToggle(ghostModeEnabled);

  const raceCars=instantiateRaceCars({
    trackPoints: state.trkPts,
    cars: CARS,
    selectedCarIndex: state.selCar,
    aiCount: ghostModeEnabled ? 0 : 4,
    scene,
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
  await setupGhostReplayFromTrack(state.trkData?.id);

  _startCountdown();
  _showRaceHUD();
  if(ghostModeEnabled&&ghostVisuals.length===0) notify('Ghost mode: no ghost data for this track yet.');
}

// ═══════════════════════════════════════════════════════
//  VS RACE (multi-player / AI hybrid)
// ═══════════════════════════════════════════════════════
/**
 * Called on all clients when the host sends game_start.
 * @param {Array} slots   [{id, name, isAI, carIdx}] ordered by grid position
 * @param {string} trackId
 */
export async function initVsRace(slots, trackId){
  // Clean up previous race
  for(const ctrl of state.aiControllers)if(ctrl.destroy)ctrl.destroy();
  for(const c of state.allCars)scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.aiControllers=[];
  state.pCar=null; state.vsAIControllers=[];
  state.vsCarsById={}; state.vsCarStates={}; state.vsCarBuffers={}; state.vsFinished={};
  clearAiSounds(); clearGhostVisual();

  state.vsSlots=slots;
  state.selTrk=trackId;
  state.trkData=getTrackById(trackId);
  try{ buildTrack(state.trkData); }catch(e){ console.error('buildTrack VS error:',e); }
  setupLights();

  const grid=buildRaceGrid(state.trkPts);
  const corridors=state.cityCorridors;

  for(let i=0;i<slots.length;i++){
    const slot=slots[i];
    const carData=CARS[slot.carIdx??0];
    const gp=grid[i]||grid[grid.length-1];
    const isMe=slot.id===state.vsMyId;
    const car=new Car(carData, gp.pos, gp.hdg, isMe, scene);
    car.aiAgg=0.88+i*0.03;
    state.vsCarsById[slot.id]=car;
    state.allCars.push(car);
    if(isMe){
      state.pCar=car;
    } else if(slot.isAI){
      state.aiCars.push(car); // for HUD/minimap
    }
  }

  // Host creates AI controllers for AI slots
  if(state.vsIsHost){
    const ctx=()=>({
      trackPoints: state.trkPts,
      trackCurvature: state.trkCurv,
      cityAiPoints: state.cityAiPts,
      corridors,
      trackData: state.trkData,
      playerCar: state.pCar
    });
    for(const slot of slots.filter(s=>s.isAI)){
      const car=state.vsCarsById[slot.id];
      const ai=new AI(car,0.044+Math.random()*0.02,ctx);
      state.vsAIControllers.push({ai,slotId:slot.id});
      state.aiControllers.push(ai); // legacy – for audio
    }
  }

  initAiSounds(state.aiCars.length);

  // No leaderboard ghosts in VS
  setOnlineGhostToggle(false);
  state.vsPosSendTimer=0;

  _startCountdown();
  _showRaceHUD();

  // Show VS name tags
  document.getElementById('vsOpponentTag').style.display='none';
}

// ═══════════════════════════════════════════════════════
//  SHARED RACE HELPERS
// ═══════════════════════════════════════════════════════
function _showRaceHUD(){
  state.raceTime=0; state.gState='countdown';
  resetCurrentRaceSubmitted();
  document.getElementById('hud').style.display='block';
  document.getElementById('hint').style.display=isTouchControlsEnabled()?'none':'block';
  updateTouchControlsVisibility(state.gState);
  document.getElementById('camLabel').textContent='[ C ] COCKPIT VIEW';
  state.camMode='chase'; dc.style.display='none';
  document.getElementById('speedBox').style.display='block';
  document.getElementById('gearBox').style.display='block';
  if(!state.vsMode) startGhostRecording();
}

export function doCountdown(){
  stopMusic();
  initAudio();
  if(audioReady){ initAiSounds(state.aiCars.length); }
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
      setTimeout(()=>{
        el.style.display='none';
        state.gState='racing';
        updateTouchControlsVisibility(state.gState);
        startMusic();
      },700);
    }
  },1000);
}

function _startCountdown(){ doCountdown(); }

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

  if(state.vsMode&&state.vsNetwork){
    state.vsNetwork.sendPlayerFinished(state.vsMyId, state.pCar.finTime||state.raceTime);
    state.vsFinished[state.vsMyId]=state.pCar.finTime||state.raceTime;
  }

  if(pos===1){ playVictoryJingle(); announce('Checkered flag! You win!'); }
  else        { playLossSound();    announce('Race finished! P'+pos+'!'); }

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
  for(const visual of ghostVisuals){ if(visual.tagEl)visual.tagEl.style.display='none'; }
  document.getElementById('vsOpponentTag').style.display='none';
  releaseAllTouchControls();
  dc.style.display='none';
}

export function updateResultsUI(){
  if(state.vsMode){ _updateVsResultsUI(); return; }

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
  const carName=state.pCar?.data?.name||'Unknown';
  document.getElementById('runCar').textContent=`Run car: ${carName}`;
  const cached=leaderboardByTrack.get(normaliseTrackId(state.trkData?.id,state.trkData?.name));
  renderResultsLeaderboard(cached?cached.entries:[]);
}

function _updateVsResultsUI(){
  const myTime=state.pCar?state.pCar.finTime||state.raceTime:0;
  const myFinished=!!(state.pCar?.finished);

  // Build result entries for all slots
  const entries=state.vsSlots.map(slot=>{
    const car=state.vsCarsById[slot.id];
    const isMe=slot.id===state.vsMyId;
    const finTime=state.vsFinished[slot.id];
    const finished=finTime!=null;
    const time=finished?finTime:(car?car.totalProg:0);
    return {id:slot.id,name:slot.name+(slot.isAI?' 🤖':''),isMe,finished,finTime,time,car,slot};
  }).sort((a,b)=>{
    if(a.finished&&b.finished)return a.finTime-b.finTime;
    if(a.finished)return -1; if(b.finished)return 1;
    return (b.car?.totalProg||0)-(a.car?.totalProg||0);
  });

  const myEntry=entries.find(e=>e.isMe);
  const myPos=entries.indexOf(myEntry)+1;
  const win=myPos===1;

  document.getElementById('rTitle').textContent=win?'🏆 VICTORY!':'RACE OVER';
  document.getElementById('rTitle').style.color=win?'#ffd700':'#ff5500';
  const pods=document.getElementById('podium'); pods.innerHTML='';
  const medals=['🥇','🥈','🥉','4th'];
  entries.forEach((e,i)=>{
    const d=document.createElement('div'); d.className='pi';
    d.innerHTML=`<div class="pm">${medals[i]||`${i+1}th`}</div>
      <div class="pn" style="color:${e.isMe?'#ffd700':'#aaa'}">${e.isMe?'⭐ YOU':e.name}</div>
      <div class="pt">${e.finished?fmtT(e.finTime):'still racing...'}</div>`;
    pods.appendChild(d);
  });
  document.getElementById('ptime').textContent=`Your time: ${fmtT(myTime)}  ·  P${myPos}`;
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
  if(state.vsMode){
    // Go back to main menu — VS session ends after one race
    import('./menu.js').then(m=>m.showMain());
    return;
  }
  void initRace();
}
