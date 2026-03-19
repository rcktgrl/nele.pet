'use strict';
import { CARS } from './data/cars.js';
import { state, scene, dc, editorCam, camEditor } from './state.js';
import { buildTrack } from './track-gen.js';
import { instantiateRaceCars, Car } from './car.js';
import { AI } from './ai-script.js';
import { NeuralAI } from './neural-ai.js';
import { GeneticTrainer, buildTrainingGrid, resetCarForTraining } from './trainer.js';
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
  for(const c of state.allCars)scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.aiControllers=[]; state.pCar=null;
  clearAiSounds();
  clearGhostVisual();

  state.trkData=getTrackById(state.selTrk);
  try{ buildTrack(state.trkData); }catch(e){ console.error('buildTrack error:',e); }
  setupLights();

  let corridors=state.cityCorridors;

  const ghostModeEnabled=state.opponentMode==='ghost';
  // Keep the ghost module in sync so replay loading works correctly
  if(ghostModeEnabled!==onlineGhostEnabled) setOnlineGhostToggle(ghostModeEnabled);
  const raceCars=instantiateRaceCars({
    trackPoints: state.trkPts,
    cars: CARS,
    selectedCarIndex: state.selCar,
    aiCount: ghostModeEnabled?0:4,
    scene: scene,
    createAIController: (aiCar,i)=>new (state.aiDifficulty==='neural'?NeuralAI:AI)(aiCar,.044+i*.010,()=>({
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
  const cached=leaderboardByTrack.get(normaliseTrackId(state.trkData&&state.trkData.id,state.trkData&&state.trkData.name));
  renderResultsLeaderboard(cached?cached.entries:[]);
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

// ═══════════════════════════════════════════════════════
//  TRAINING MODE
// ═══════════════════════════════════════════════════════
let _trainLapsBackup = null;

export async function initTraining(){
  // Clean up any prior race
  for(const c of state.allCars) scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.aiControllers=[]; state.pCar=null;
  clearAiSounds(); clearGhostVisual();

  // Build track geometry
  state.trkData=getTrackById(state.selTrk);
  try{ buildTrack(state.trkData); }catch(e){ console.error('buildTrack error:',e); }
  setupLights();

  // Prevent cars from "finishing" during training so they keep driving
  _trainLapsBackup=state.trkData.laps;
  state.trkData.laps=999;

  // Trainer — seed from localStorage if available
  const popSize=state.trainPopSize||20;
  const savedGenome=GeneticTrainer.loadFromLocalStorage();
  state.trainer=new GeneticTrainer({popSize,genDuration:35});
  state.trainer.initPopulation(savedGenome);

  // Grid of starting positions
  state.trainGrid=buildTrainingGrid(state.trkPts,popSize);

  // Create one NeuralAI car per genome — randomise car type per car
  const trainingCars=[], trainingControllers=[];
  for(let i=0;i<popSize;i++){
    const g=state.trainGrid[i];
    const carData=CARS[Math.floor(Math.random()*CARS.length)];
    const car=new Car(carData,g.pos,g.hdg,false,scene);
    car.aiAgg=1.0;
    const genome=state.trainer.population[i].genome;
    const ai=new NeuralAI(car,0.044+i*0.001,()=>({
      trackPoints:state.trkPts,
      trackCurvature:state.trkCurv,
      cityAiPoints:state.cityAiPts,
      corridors:state.cityCorridors,
      trackData:state.trkData,
      playerCar:null,
    }),genome);
    trainingCars.push(car);
    trainingControllers.push(ai);
  }
  state.aiCars=trainingCars;
  state.aiControllers=trainingControllers;
  state.allCars=trainingCars;
  state.pCar=null;

  // Top-down camera — compute track bounds and snap camEditor above the track
  {
    const pts=state.trkPts;
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(const p of pts){
      if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
      if(p.z<minZ)minZ=p.z; if(p.z>maxZ)maxZ=p.z;
    }
    const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
    const span=Math.max(200,Math.max(maxX-minX,maxZ-minZ));
    editorCam.target.set(cx,0,cz);
    editorCam.yaw=0;
    editorCam.pitch=1.42; // near top-down
    editorCam.distance=span*0.72;
    // Snap camera to position immediately so there's no lerp delay
    const horiz=Math.cos(editorCam.pitch)*editorCam.distance;
    camEditor.position.set(cx+Math.sin(0)*horiz, Math.sin(editorCam.pitch)*editorCam.distance, cz+Math.cos(0)*horiz);
    camEditor.lookAt(cx,0,cz);
  }

  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  document.getElementById('hud').style.display='none';
  document.getElementById('hint').style.display='none';
  document.getElementById('trainHud').style.display='flex';
  updateTouchControlsVisibility('training');
  dc.style.display='none';
  stopAudio(); stopMusic();
  state.gState='training';
}

// ─── Best-car position marker ───────────────────────────────────────────────
let _bestMarker=null;

export function placeBestCarMarker(x,y,z){
  if(!_bestMarker){
    const ring=new THREE.Mesh(
      new THREE.TorusGeometry(3.5,0.35,8,32),
      new THREE.MeshBasicMaterial({color:0xffcc00,transparent:true,opacity:0.9})
    );
    ring.rotation.x=Math.PI/2;
    const beam=new THREE.Mesh(
      new THREE.CylinderGeometry(0.18,0.18,18,8),
      new THREE.MeshBasicMaterial({color:0xffcc00,transparent:true,opacity:0.55})
    );
    beam.position.y=9;
    const group=new THREE.Group();
    group.add(ring);
    group.add(beam);
    scene.add(group);
    _bestMarker=group;
  }
  _bestMarker.position.set(x,y+0.2,z);
}

export function stopTraining(){
  if(_trainLapsBackup!==null&&state.trkData){
    state.trkData.laps=_trainLapsBackup;
    _trainLapsBackup=null;
  }
  if(_bestMarker){ scene.remove(_bestMarker); _bestMarker=null; }
  state.trainBestCarPos=null;
  document.getElementById('trainHud').style.display='none';
  state.trainer=null;
  state.trainGrid=[];
}
