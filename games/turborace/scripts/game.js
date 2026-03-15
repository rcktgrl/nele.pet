import { TRACKS } from './data/tracks.js';
import { CARS } from './data/cars.js';
import { createRenderPipeline } from './render/pipeline.js';
import { instantiateRaceCars } from './car.js';
import { AI } from './ai-script.js';
import { THREE } from './three.js';
import { createCarVisual } from './car-model.js';
import { supabase } from './supabase.js';
import { loadArcadeUser } from './user.js';
import { fmtT } from './util.js';
import {
  leaderboardByTrack,
  normaliseTrackId,
  renderResultsLeaderboard,
  updateTrackCardBestTime,
  loadTrackLeaderboard,
  handlePostRaceLeaderboard,
  openTrackLeaderboardModal,
  closeTrackLeaderboardModal,
  resetCurrentRaceSubmitted
} from './leaderboard.js';
import {
  gc,
  scene,
  clock,
  camChase,
  camCock,
  dc,
  dctx,
  mmctx,
  state,
  camEditor,
  editorMouse,
  editorCam,
  raceCamOrbit,
  keys
} from './state.js';
import {
  isTouchControlsVisibleInState,
  updateTouchControlsVisibility,
  onTouchControlsToggle,
  initTouchSettings,
  releaseAllTouchControls,
  setupTouchControls,
  touchState,
  getGyroSteering,
} from './touch-controls.js';
import {
  initAudio,
  initAudioSettings,
  onMusicVol,
  onSfxVol,
  updateAudio,
  stopAudio,
  playBeep,
  playVictoryJingle,
  playLossSound,
  startMusic,
  stopMusic,
  tryStartMenuMusic,
  announce,
  audioReady,
  aiSounds,
  initAiSounds,
  clearAiSounds
} from './audio.js';
import { buildTrack, canPlaceDecorAsset, LATEST_TRACK_GENERATION_VERSION } from './track-gen.js';
import { TURBORACE_VERSION } from './version.js';

import {
  updateCamera,
  toggleCam,
  resetEditorCameraToTrack,
  updateEditorPreviewCamera,
  editorWorldToOverlay,
  editorClientToGround,
  normalizeEditorTrack
} from './camera.js';

'use strict';

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
const CUSTOM_TRACKS_TABLE='turborace_custom_tracks';
const ONLINE_GHOST_TOGGLE_KEY='turborace_online_ghost_enabled';
const ONLINE_GHOST_COUNT_KEY='turborace_online_ghost_count';
const GHOST_SAMPLE_MS=100;
let customTrackSyncAvailable=true;
let onlineGhostEnabled=false;
let onlineGhostCount=1;
let ghostReplays=[];
let ghostRecord=null;
let ghostVisuals=[];

function normalizeGhostName(raw){
  const out=String(raw||'').trim().replace(/\s+/g,' ').slice(0,24);
  return out||'Ghost';
}

function readOnlineGhostToggle(){
  return localStorage.getItem(ONLINE_GHOST_TOGGLE_KEY)==='1';
}

function parseOnlineGhostCount(raw){
  return Math.max(1,Math.min(10,Math.round(Number(raw)||1)));
}

function readOnlineGhostCount(){
  return parseOnlineGhostCount(localStorage.getItem(ONLINE_GHOST_COUNT_KEY));
}

function setOnlineGhostToggle(enabled){
  onlineGhostEnabled=!!enabled;
  const input=document.getElementById('onlineGhostToggleInput');
  if(input&&input.checked!==onlineGhostEnabled)input.checked=onlineGhostEnabled;
  localStorage.setItem(ONLINE_GHOST_TOGGLE_KEY,onlineGhostEnabled?'1':'0');
}

function setOnlineGhostCount(raw){
  onlineGhostCount=parseOnlineGhostCount(raw);
  const select=document.getElementById('onlineGhostCountSelect');
  if(select&&Number(select.value)!==onlineGhostCount)select.value=String(onlineGhostCount);
  localStorage.setItem(ONLINE_GHOST_COUNT_KEY,String(onlineGhostCount));
}

function createGhostTag(){
  const tag=document.createElement('div');
  tag.className='ghostNameTag';
  tag.setAttribute('aria-hidden','true');
  document.body.appendChild(tag);
  return tag;
}

function clearGhostVisual(){
  for(const visual of ghostVisuals){
    if(visual.mesh)scene.remove(visual.mesh);
    if(visual.tagEl&&visual.tagEl.parentNode)visual.tagEl.parentNode.removeChild(visual.tagEl);
  }
  ghostVisuals=[];
}

function addGhostVisual(replay,idx){
  if(!replay||!replay.carData||!Array.isArray(replay.frames)||replay.frames.length<2)return;
  const visual=createCarVisual(replay.carData);
  const mesh=visual.mesh;
  const opacity=Math.max(0.28,0.48-(idx*0.1));
  mesh.traverse(obj=>{
    if(obj.isMesh){
      obj.castShadow=false;
      obj.receiveShadow=false;
      if(obj.material){
        obj.material=obj.material.clone();
        obj.material.transparent=true;
        obj.material.opacity=opacity;
        obj.material.depthWrite=false;
      }
    }
  });
  scene.add(mesh);
  const tagEl=createGhostTag();
  const username=normalizeGhostName(replay.username);
  tagEl.textContent=username;
  ghostVisuals.push({ mesh, replay, tagEl, username });
}

async function setupGhostReplayFromTrack(trackId){
  ghostReplays=[];
  clearGhostVisual();
  if(onlineGhostEnabled&&trackId){
    const data=await loadTrackLeaderboard(trackId,{force:true,limit:Math.max(10,onlineGhostCount*4),trackName:state.trkData&&state.trkData.name});
    for(const entry of data.entries){
      if(ghostReplays.length>=onlineGhostCount)break;
      if(entry.ghost_data&&Array.isArray(entry.ghost_data.frames)&&entry.ghost_data.frames.length>1){
        ghostReplays.push(entry.ghost_data);
      }
    }
  }
  ghostReplays.slice(0,10).forEach((replay,idx)=>addGhostVisual(replay,idx));
}

function startGhostRecording(){
  if(!state.trkData||!state.pCar)return;
  ghostRecord={
    trackId:normaliseTrackId(state.trkData.id,state.trkData.name),
    username:'Anonymous',
    carData:{...state.pCar.data},
    frames:[],
    nextSampleMs:0,
    timeMs:0
  };
}

function sampleGhostFrame(){
  if(!ghostRecord||!state.pCar||state.gState!=='racing')return;
  const nowMs=Math.round(state.raceTime*1000);
  if(nowMs<ghostRecord.nextSampleMs)return;
  ghostRecord.nextSampleMs=nowMs+GHOST_SAMPLE_MS;
  ghostRecord.frames.push({
    t:nowMs,
    x:state.pCar.pos.x,
    y:state.pCar.pos.y,
    z:state.pCar.pos.z,
    h:state.pCar.hdg
  });
}

async function finalizeGhostRecording(){
  if(!ghostRecord||!state.trkData||!state.pCar||!state.pCar.finTime)return null;
  const user=await loadArcadeUser();
  ghostRecord.username=normalizeGhostName(user&&user.name);
  ghostRecord.timeMs=Math.round(Math.max(0,state.pCar.finTime)*1000);
  if(ghostRecord.frames.length<2)return null;
  return {
    username:ghostRecord.username,
    carData:{...ghostRecord.carData},
    frames:ghostRecord.frames.map(frame=>({ ...frame })),
    timeMs:ghostRecord.timeMs
  };
}

function updateGhostReplay(){
  if(!ghostVisuals.length)return;
  const t=Math.round(Math.max(0,state.raceTime)*1000);
  for(const visual of ghostVisuals){
    const frames=visual.replay.frames;
    if(t<=frames[0].t){
      visual.mesh.position.set(frames[0].x,frames[0].y,frames[0].z);
      visual.mesh.rotation.y=frames[0].h;
    }else if(t>=frames[frames.length-1].t){
      visual.mesh.position.set(frames[frames.length-1].x,frames[frames.length-1].y,frames[frames.length-1].z);
      visual.mesh.rotation.y=frames[frames.length-1].h;
    }else{
      let i=0;
      while(i<frames.length-1&&frames[i+1].t<t)i++;
      const a=frames[i],b=frames[Math.min(i+1,frames.length-1)];
      const span=Math.max(1,b.t-a.t);
      const f=Math.max(0,Math.min(1,(t-a.t)/span));
      visual.mesh.position.set(
        a.x+(b.x-a.x)*f,
        a.y+(b.y-a.y)*f,
        a.z+(b.z-a.z)*f
      );
      const da=Math.atan2(Math.sin(b.h-a.h),Math.cos(b.h-a.h));
      visual.mesh.rotation.y=a.h+da*f;
    }
    if(visual.tagEl&&state.activeCam){
      const p=visual.mesh.position.clone().add(new THREE.Vector3(0,2.9,0)).project(state.activeCam);
      if(p.z>-1&&p.z<1){
        visual.tagEl.style.display='block';
        visual.tagEl.style.left=`${(p.x*0.5+0.5)*window.innerWidth}px`;
        visual.tagEl.style.top=`${(-p.y*0.5+0.5)*window.innerHeight}px`;
        visual.tagEl.textContent=visual.username;
      }else visual.tagEl.style.display='none';
    }
  }
}

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
//  LIGHTING
// ═══════════════════════════════════════════════════════
function setupLights(){
  const rm=[]; scene.traverse(o=>{if(o.isLight)rm.push(o);}); rm.forEach(l=>scene.remove(l));
  const isCity=state.trkData&&state.trkData.type==='city';
  const ambientCol=state.trkData&&state.trkData.ambient!=null?state.trkData.ambient:(isCity?0x667788:0xffffff);
  const ambientInt=state.trkData&&state.trkData.ambientIntensity!=null?state.trkData.ambientIntensity:(isCity?.35:.55);
  const sunCol=state.trkData&&state.trkData.sun!=null?state.trkData.sun:(isCity?0x8899bb:0xffffff);
  const sunInt=state.trkData&&state.trkData.sunIntensity!=null?state.trkData.sunIntensity:(isCity?.6:1.1);
  const fillCol=state.trkData&&state.trkData.fill!=null?state.trkData.fill:(isCity?0x334466:0x5566bb);
  const fillInt=state.trkData&&state.trkData.fillIntensity!=null?state.trkData.fillIntensity:(isCity?.20:.30);
  scene.add(new THREE.AmbientLight(ambientCol,ambientInt));
  const sun=new THREE.DirectionalLight(sunCol,sunInt);
  sun.position.set(isCity?-40:80,180,isCity?-60:100); sun.castShadow=true;
  sun.shadow.mapSize.width=sun.shadow.mapSize.height=2048;
  sun.shadow.camera.left=-340;sun.shadow.camera.right=340;sun.shadow.camera.top=340;sun.shadow.camera.bottom=-340;
  sun.shadow.camera.far=700; sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
  const fill=new THREE.DirectionalLight(fillCol,fillInt);
  fill.position.set(-60,70,-80); scene.add(fill);
  if(isCity || (state.trkData&&state.trkData.timeOfDay==='night')){
    const up=new THREE.DirectionalLight(0x556688,.15); up.position.set(0,-20,0); scene.add(up);
  }
}

// ═══════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════
const ords=['TH','ST','ND','RD'];
function getOrd(n){return n>=1&&n<=3?ords[n]:ords[0];}
function updateHUD(){
  if(!state.pCar||state.gState!=='racing')return;
  document.getElementById('speedNum').textContent=Math.round((state.pCar.isReversing?state.pCar.revSpd:state.pCar.spd)*3.6);
  document.getElementById('gearNum').textContent=state.pCar.gear===0?'R':state.pCar.gear;
  document.getElementById('lapVal').textContent=`${Math.min(state.pCar.lap+1,state.trkData.laps)} / ${state.trkData.laps}`;
  document.getElementById('timer').textContent=fmtT(state.raceTime);
  const all=[state.pCar,...state.aiCars].sort((a,b)=>b.totalProg-a.totalProg);
  const p=all.indexOf(state.pCar)+1;
  document.getElementById('posNum').innerHTML=`${p}<sup style="font-size:18px">${getOrd(p)}</sup>`;
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD (cockpit)
// ═══════════════════════════════════════════════════════
function resizeDC(){dc.width=window.innerWidth;dc.height=window.innerHeight;}
function drawDash(){
  if(state.camMode!=='cockpit'||!state.pCar)return;
  const W=dc.width,H=dc.height,ctx=dctx,ph=H*.3,py=H-ph;
  ctx.clearRect(0,0,W,H);
  const pg=ctx.createLinearGradient(0,py,0,H);
  pg.addColorStop(0,'rgba(8,8,18,.94)'); pg.addColorStop(1,'rgba(2,2,6,.98)');
  ctx.fillStyle=pg; ctx.fillRect(0,py,W,ph);
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,py,W,2);
  // Steering wheel
  const wr=ph*.66,wx=W/2,wy=H-ph*.07;
  const gyroSteer=getGyroSteering();
  const keySteer=(keys['ArrowLeft']||keys['KeyA'])?-1:(keys['ArrowRight']||keys['KeyD'])?1:0;
  const sa=(Math.abs(gyroSteer)>0.01?gyroSteer:keySteer)*0.35;
  ctx.save(); ctx.translate(wx,wy); ctx.rotate(sa);
  ctx.beginPath(); ctx.arc(0,0,wr,0,Math.PI*2); ctx.strokeStyle='#1e1e2e'; ctx.lineWidth=wr*.22; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,wr,0,Math.PI*2); ctx.strokeStyle='#2a2a3e'; ctx.lineWidth=wr*.14; ctx.stroke();
  for(const a of[0,2.094,4.189]){
    ctx.beginPath(); ctx.moveTo(Math.cos(a)*wr*.14,Math.sin(a)*wr*.14); ctx.lineTo(Math.cos(a)*wr*.82,Math.sin(a)*wr*.82);
    ctx.strokeStyle='#1c1c2c'; ctx.lineWidth=wr*.13; ctx.stroke();
    ctx.strokeStyle='#323248'; ctx.lineWidth=wr*.07; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0,0,wr*.16,0,Math.PI*2);
  ctx.fillStyle='#12121e'; ctx.fill(); ctx.strokeStyle='#333'; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle='#ff5500'; ctx.font=`bold ${wr*.16}px Orbitron,monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('TR',0,0);
  ctx.restore();
  // Gauges
  const gr=Math.min(W*.12,ph*.42);
  const redline=state.pCar.redlineRpm||8000;
  const warnRpm=state.pCar.shiftWarnRpm||Math.round(redline*0.78);
  drawGauge(ctx,W*.2,py+ph*.5,gr,state.pCar.rpm,0,redline,warnRpm,'#ff3300','RPM',v=>(v/1000).toFixed(1)+'k');
  const mxK=Math.round(state.pCar.data.maxSpd*3.6*1.08);
  drawGauge(ctx,W*.8,py+ph*.5,gr,state.pCar.spd*3.6,0,mxK,mxK*.82,'#ffaa00','KM/H',v=>Math.round(v));
  // Gear
  ctx.font=`bold ${ph*.52}px Orbitron,monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='#ffd700'; ctx.shadowColor='rgba(255,215,0,.5)'; ctx.shadowBlur=22;
  ctx.fillText(state.pCar.gear===0?'R':state.pCar.gear,W/2,py+ph*.52); ctx.shadowBlur=0;
  ctx.font=`${ph*.11}px Rajdhani,sans-serif`; ctx.fillStyle='#334'; ctx.fillText('GEAR',W/2,py+ph*.8);
  // Rev bar
  const bw=W*.32,bh=ph*.055,bx=(W-bw)/2,by=py+ph*.12;
  ctx.fillStyle='#0a0a14'; ctx.fillRect(bx,by,bw,bh);
  const rf=state.pCar.rpm/redline,rl=warnRpm/redline;
  for(let i=0;i<20;i++){
    const f=(i+1)/20;
    if(f<=rf){
      ctx.fillStyle=f<rl*.7?'#00aa44':f<rl?'#aaaa00':'#ff2200';
      ctx.fillRect(bx+(i/20)*bw+2,by+2,bw/20-3,bh-4);
    }
  }
}
function drawGauge(ctx,cx,cy,r,val,mn,mx,warn,wCol,lbl,fmt){
  const sa=Math.PI*.75,ea=Math.PI*2.25,rng=ea-sa;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle='#090912'; ctx.fill();
  ctx.strokeStyle='#1a1a2a'; ctx.lineWidth=r*.06; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,r*.82,sa,ea); ctx.strokeStyle='#111120'; ctx.lineWidth=r*.18; ctx.stroke();
  const vf=Math.max(0,Math.min(1,(val-mn)/(mx-mn)));
  const va=sa+vf*rng,wf=(warn-mn)/(mx-mn),wa=sa+wf*rng;
  if(vf>0){
    const ne=Math.min(va,wa);
    if(ne>sa){ctx.beginPath();ctx.arc(cx,cy,r*.82,sa,ne);ctx.strokeStyle='#00cc55';ctx.lineWidth=r*.18;ctx.stroke();}
    if(va>wa){ctx.beginPath();ctx.arc(cx,cy,r*.82,wa,va);ctx.strokeStyle=wCol;ctx.lineWidth=r*.18;ctx.stroke();}
  }
  for(let i=0;i<=10;i++){
    const a=sa+(i/10)*rng,mj=i%2===0,i2=r*(mj?.59:.67),o=r*.73;
    ctx.beginPath(); ctx.moveTo(cx+Math.cos(a)*i2,cy+Math.sin(a)*i2); ctx.lineTo(cx+Math.cos(a)*o,cy+Math.sin(a)*o);
    ctx.strokeStyle=mj?'#666':'#333'; ctx.lineWidth=mj?2:1; ctx.stroke();
  }
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(va);
  ctx.beginPath(); ctx.moveTo(-r*.07,0); ctx.lineTo(r*.70,0);
  ctx.strokeStyle='#ff6622'; ctx.lineWidth=r*.04; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,r*.08,0,Math.PI*2); ctx.fillStyle='#222'; ctx.fill(); ctx.restore();
  ctx.font=`bold ${r*.28}px Orbitron,monospace`; ctx.fillStyle='#ddd';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(fmt(val),cx,cy+r*.14);
  ctx.font=`${r*.17}px Rajdhani,sans-serif`; ctx.fillStyle='#444466'; ctx.fillText(lbl,cx,cy+r*.46);
}

// ═══════════════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════════════
function drawMinimap(){
  if(!state.trkPts.length||!state.pCar)return;
  const ctx=mmctx,W=150,H=150;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='rgba(0,0,0,.72)'; ctx.fillRect(0,0,W,H);
  let mx=-Infinity,nx=Infinity,mz=-Infinity,nz=Infinity;
  for(const p of state.trkPts){if(p.x>mx)mx=p.x;if(p.x<nx)nx=p.x;if(p.z>mz)mz=p.z;if(p.z<nz)nz=p.z;}
  const sc=Math.min(W/(mx-nx+24),H/(mz-nz+24))*.88;
  const ox=W/2-(nx+(mx-nx)/2)*sc,oz=H/2-(nz+(mz-nz)/2)*sc;
  const toM=(x,z)=>[x*sc+ox,z*sc+oz];
  ctx.beginPath();
  const[sx,sz]=toM(state.trkPts[0].x,state.trkPts[0].z); ctx.moveTo(sx,sz);
  for(const p of state.trkPts){const[px,pz]=toM(p.x,p.z);ctx.lineTo(px,pz);}
  ctx.closePath(); ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=5; ctx.stroke();
  ctx.strokeStyle='#1a1a2e'; ctx.lineWidth=2; ctx.stroke();
  for(const c of state.aiCars){
    const[ex,ez]=toM(c.pos.x,c.pos.z);
    ctx.beginPath(); ctx.arc(ex,ez,3.5,0,Math.PI*2);
    ctx.fillStyle='#'+c.data.col.toString(16).padStart(6,'0'); ctx.fill();
  }
  const[px,pz]=toM(state.pCar.pos.x,state.pCar.pos.z);
  ctx.beginPath(); ctx.arc(px,pz,5.5,0,Math.PI*2);
  ctx.fillStyle='#ffd700'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
}

// ═══════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════
let ntTO=null;
function notify(txt){
  const el=document.getElementById('notif');
  el.innerHTML=txt; el.style.display='block';
  el.style.opacity='0'; el.style.transition='none'; el.offsetHeight;
  el.style.transition='opacity .22s'; el.style.opacity='1';
  if(ntTO)clearTimeout(ntTO);
  ntTO=setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.style.display='none',300);},2400);
}
globalThis.notify=notify;

// ═══════════════════════════════════════════════════════
//  RACE LOGIC
// ═══════════════════════════════════════════════════════
async function initRace(){
  for(const c of state.allCars)scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.aiControllers=[]; state.pCar=null;
  clearAiSounds();
  clearGhostVisual();
  ghostRecord=null;
  ghostReplays=[];

  state.trkData=getTrackById(state.selTrk);
  try{ buildTrack(state.trkData); }catch(e){ console.error('buildTrack error:',e); }
  setupLights();

  let corridors = state.cityCorridors;

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
  document.getElementById('hint').style.display='block';
  updateTouchControlsVisibility(state.gState);
  document.getElementById('camLabel').textContent='[ C ] COCKPIT VIEW';
  state.camMode='chase'; dc.style.display='none';
  document.getElementById('speedBox').style.display='block';
  document.getElementById('gearBox').style.display='block';
  startGhostRecording();
  if(ghostModeEnabled&&ghostVisuals.length===0)notify('Ghost mode enabled: no matching ghost data for this track yet.');
  doCountdown();
}

function doCountdown(){
  stopMusic(); // stop menu music first
  initAudio();
  // Create AI sounds now that audio is ready
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
    } else {
      el.textContent='GO!'; playBeep(880,.45,.4,'square'); announce('Go go go!');
      clearInterval(iv);
      setTimeout(()=>{el.style.display='none'; state.gState='racing'; updateTouchControlsVisibility(state.gState); startMusic();},700);
    }
  },1000);
}

let _prePauseState='racing';
function pauseRace(){
  _prePauseState=state.gState;
  state.gState='paused'; stopAudio(); stopMusic();
  document.getElementById('pauseMenu').style.display='flex';
  updateTouchControlsVisibility(state.gState);
  releaseAllTouchControls();
}
function resumeRace(){
  state.gState=_prePauseState==='cooldown'?'cooldown':'racing';
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  updateTouchControlsVisibility(state.gState);
  initAudio(); startMusic();
}

async function endRace(){
  const all=[state.pCar,...state.aiCars].sort((a,b)=>{
    if(a.finished&&b.finished)return a.finTime-b.finTime;
    if(a.finished)return-1; if(b.finished)return 1; return b.totalProg-a.totalProg;
  });
  const pos=all.indexOf(state.pCar)+1;
  state.gState='cooldown'; // always cooldown — AI keeps racing
  if(pos===1){
    playVictoryJingle();
    announce('Checkered flag! You win!');
  } else {
    playLossSound();
    announce('Race finished! P'+pos+'!');
  }
  const ghostPayload=await finalizeGhostRecording();
  // Show results after brief delay (AI keeps driving behind it)
  setTimeout(()=>showResults(ghostPayload),1200);
}
globalThis.endRace=endRace;

function showResults(ghostPayload){
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

function updateResultsUI(){
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



// ═══════════════════════════════════════════════════════
//  TRACK EDITOR
// ═══════════════════════════════════════════════════════
function getAllTracks(){ return [...TRACKS, ...state.editorTracks]; }
function getTrackById(id){ return getAllTracks().find(t=>String(t.id)===String(id))||TRACKS[0]; }
function hexNumToCss(n){ return '#'+((n||0)&0xffffff).toString(16).padStart(6,'0'); }
function cssToHexNum(s){ return parseInt(String(s||'#000000').replace('#',''),16)||0; }
function deepClone(v){ return JSON.parse(JSON.stringify(v)); }
function makeTimeOfDayPreset(mode){
  if(mode==='night') return {sky:0x06060c,gnd:0x0a0a14,ambient:0x667788,ambientIntensity:0.35,sun:0x8899bb,sunIntensity:0.58,fill:0x334466,fillIntensity:0.2};
  if(mode==='sunset') return {sky:0x462414,gnd:0x3a2616,ambient:0xffc6a0,ambientIntensity:0.42,sun:0xffb066,sunIntensity:0.92,fill:0x884466,fillIntensity:0.24};
  return {sky:0x0d1a2e,gnd:0x1a3018,ambient:0xffffff,ambientIntensity:0.55,sun:0xffffff,sunIntensity:1.1,fill:0x5566bb,fillIntensity:0.3};
}
function makeEditableTrackFromGameTrack(src){
  const tod = src.timeOfDay || (src.type==='city'?'night':'day');
  const sourceNodes=Array.isArray(src.editorNodes)&&src.editorNodes.length>=3
    ? src.editorNodes
    : (Array.isArray(src.nodes)&&src.nodes.length>=3 ? src.nodes : (src.wp||[]).map(p=>({x:p[0],z:p[2]})));
  const rawPts=sourceNodes.map((n,i)=>({
    x:+n.x||0,
    z:+n.z||0,
    steepness:typeof n.steepness==='number'?n.steepness:40,
    gravelPitSize:Number.isFinite(n.gravelPitSize)?Math.max(0,Math.min(400,+n.gravelPitSize||100)):100,
    type:n.type||(i===0?'start-finish':'no-auto')
  }));
  const pts=[];
  for(const node of rawPts){
    const last=pts[pts.length-1];
    if(last&&last.x===node.x&&last.z===node.z) continue;
    pts.push(node);
  }
  if(pts.length && !pts.some(n=>n.type==='start-finish')) pts[0].type='start-finish';
  return {
    id:src.id,name:src.name,desc:src.desc||'',laps:src.laps||3,rw:src.rw||12,previewColor:src.previewColor||'#44aaff',
    useBezier:src.useBezier!==false,timeOfDay:tod,groundColor:hexNumToCss(src.gnd||makeTimeOfDayPreset(tod).gnd),skyColor:hexNumToCss(src.sky||makeTimeOfDayPreset(tod).sky),
    streetGrid:src.type==='city',gridSize:src.gridSize||70,enableRunoff:src.enableRunoff!==false,
    trackGenerationVersion:Number.isFinite(src.trackGenerationVersion)?Math.max(1,Math.floor(src.trackGenerationVersion)):1,
    nodes:pts,assets:deepClone(src.assets||[]),scenerySeed:Number.isFinite(src.scenerySeed)?(src.scenerySeed>>>0):null,source:src.id,builtin:TRACKS.some(t=>String(t.id)===String(src.id))
  };
}
function normaliseStoredTrack(raw){
  if(!raw) return null;
  let track=raw;
  for(let i=0;i<3;i++){
    if(typeof track==='string'){
      try{ track=JSON.parse(track); }catch{ return null; }
      continue;
    }
    if(track&&typeof track==='object'&&track.track_data!==undefined){
      track=track.track_data;
      continue;
    }
    break;
  }
  if(!track||typeof track!=='object') return null;
  const out=deepClone(track);
  out.id=String(out.id||raw.track_id||'');
  if(!out.id) return null;
  if(!out.name) out.name='Custom Track';
  if(!Array.isArray(out.wp)||out.wp.length<3){
    const nodes=Array.isArray(out.editorNodes)&&out.editorNodes.length>=3
      ? out.editorNodes
      : (Array.isArray(out.nodes)&&out.nodes.length>=3 ? out.nodes : null);
    if(!nodes) return null;
    out.wp=nodes.map(n=>[+n.x||0,0,+n.z||0]);
  }
  const updatedAt=Date.parse(out.updatedAt||out.updated_at||raw.updated_at||'');
  out.updatedAt=Number.isFinite(updatedAt)?new Date(updatedAt).toISOString():new Date(0).toISOString();
  return out;
}

function loadEditorTracks(){
  try{
    const parsed=JSON.parse(localStorage.getItem('turborace_custom_tracks')||'[]');
    state.editorTracks=(Array.isArray(parsed)?parsed:[]).map(normaliseStoredTrack).filter(Boolean);
  }catch{
    state.editorTracks=[];
  }
}
function persistEditorTracks(){ localStorage.setItem('turborace_custom_tracks', JSON.stringify(state.editorTracks)); }

function normaliseCloudTrack(raw){
  if(!raw||typeof raw!=='object') return null;
  const track=normaliseStoredTrack(raw);
  if(!track) return null;
  track.__cloud=true;
  if(raw.updated_at) track.updatedAt=raw.updated_at;
  return track;
}

function trackUpdatedAtMs(track){
  const ts=Date.parse(track&&track.updatedAt?track.updatedAt:'');
  return Number.isFinite(ts)?ts:0;
}

function mergeTracksById(...groups){
  const out=[];
  const byId=new Map();
  groups.forEach(group=>{
    (group||[]).forEach(track=>{
      if(!track||track.id===undefined||track.id===null) return;
      const key=String(track.id);
      if(byId.has(key)){
        const idx=byId.get(key);
        if(trackUpdatedAtMs(track)>=trackUpdatedAtMs(out[idx])) out[idx]=track;
      }else{
        byId.set(key,out.length);
        out.push(track);
      }
    });
  });
  return out;
}

function isAuthPolicyError(error){
  const msg=String(error&&error.message||'').toLowerCase();
  return error&&(
    error.code==='42501' ||
    msg.includes('row-level security') ||
    msg.includes('permission denied') ||
    msg.includes('not authenticated')
  );
}

async function syncEditorTracksFromCloud(){
  if(!customTrackSyncAvailable) return;
  let result=await supabase.from(CUSTOM_TRACKS_TABLE)
    .select('track_id,track_data,updated_at')
    .order('updated_at',{ascending:false})
    .limit(250);

  if(result.error){
    // Older tables may not include updated_at; retry with a minimal projection.
    result=await supabase.from(CUSTOM_TRACKS_TABLE)
      .select('track_id,track_data')
      .limit(250);
  }

  if(result.error){
    if(isAuthPolicyError(result.error)){
      console.info('Custom track cloud sync skipped (auth required).');
      return;
    }
    customTrackSyncAvailable=false;
    console.warn('Custom track sync unavailable:',result.error.message||result.error);
    return;
  }

  const cloudTracks=(result.data||[]).map(normaliseCloudTrack).filter(Boolean);
  state.editorTracks=mergeTracksById(state.editorTracks,cloudTracks);
  persistEditorTracks();
}

async function uploadCustomTrack(track){
  if(!customTrackSyncAvailable||!track||!track.id) return false;
  const { data:{session} }=await supabase.auth.getSession();
  if(!session){
    console.info('Custom track cloud sync skipped (no signed-in user).');
    return false;
  }
  const {error}=await supabase.from(CUSTOM_TRACKS_TABLE).upsert({
    track_id:String(track.id),
    track_data:track
  },{onConflict:'track_id'});
  if(error){
    if(isAuthPolicyError(error)){
      console.info('Custom track cloud sync blocked by policy; keeping local save.');
      return false;
    }
    console.warn('Failed to sync custom track:',error.message||error);
    customTrackSyncAvailable=false;
    return false;
  }
  return true;
}

function ensureEditorBoot(){ loadEditorTracks(); if(!state.editorTrack) state.editorTrack=state.editorTracks[0]?deepClone(state.editorTracks[0]):makeEditableTrackFromGameTrack(TRACKS[0]); }
function uniqueTrackId(){ return 'custom-'+Date.now()+'-'+Math.floor(Math.random()*9999); }
function getEditorStartIndex(){ const idx=(state.editorTrack.nodes||[]).findIndex(n=>n.type==='start-finish'); return idx>=0?idx:0; }
function cornerSeverity(nodes,i){
  const n=nodes.length;
  if(n<3) return 0;
  const prev=nodes[(i-1+n)%n], cur=nodes[i], next=nodes[(i+1)%n];
  const ax=cur.x-prev.x, az=cur.z-prev.z, bx=next.x-cur.x, bz=next.z-cur.z;
  const al=Math.hypot(ax,az)||1, bl=Math.hypot(bx,bz)||1;
  const dot=(ax*bx+az*bz)/(al*bl);
  return Math.max(0,Math.min(1,1-Math.max(-1,Math.min(1,dot))));
}
function makeBezierPath(nodes,samplesPerSeg=18){
  const out=[]; const n=nodes.length;
  for(let i=0;i<n;i++){
    const p0=nodes[(i-1+n)%n], p1=nodes[i], p2=nodes[(i+1)%n], p3=nodes[(i+2)%n];
    const s=Math.max(0,Math.min(1,(p1.steepness||40)/100))*0.55;
    const h1x=(p2.x-p0.x)*s, h1z=(p2.z-p0.z)*s;
    const h2x=(p3.x-p1.x)*s, h2z=(p3.z-p1.z)*s;
    const c1={x:p1.x+h1x,y:0,z:p1.z+h1z};
    const c2={x:p2.x-h2x,y:0,z:p2.z-h2z};
    const segLen=Math.hypot(p2.x-p1.x,p2.z-p1.z);
    const sharp=Math.max(cornerSeverity(nodes,i),cornerSeverity(nodes,(i+1)%n));
    const detailBoost=1+sharp*2.3;
    const lenBoost=Math.min(2.1,Math.max(0.9,segLen/95));
    const segSamples=Math.max(10,Math.min(90,Math.round(samplesPerSeg*detailBoost*lenBoost)));
    for(let j=0;j<segSamples;j++){
      const t=j/segSamples, mt=1-t;
      const x=mt*mt*mt*p1.x + 3*mt*mt*t*c1.x + 3*mt*t*t*c2.x + t*t*t*p2.x;
      const z=mt*mt*mt*p1.z + 3*mt*mt*t*c1.z + 3*mt*t*t*c2.z + t*t*t*p2.z;
      out.push([x,0,z]);
    }
  }
  return out;
}
function makeCityRouteFromNodes(nodes,grid){
  const snapped=[];
  nodes.forEach(n=>{ const x=Math.round(n.x/grid)*grid, z=Math.round(n.z/grid)*grid; if(!snapped.length||snapped[snapped.length-1][0]!==x||snapped[snapped.length-1][1]!==z) snapped.push([x,z]); });
  return snapped.length<4?[[0,70],[0,-70],[-70,-70],[-70,70]]:snapped;
}
function makeCityWpFromRoute(route,grid){
  const pts=[];
  for(let i=0;i<route.length;i++){
    const a=route[i], b=route[(i+1)%route.length], dx=b[0]-a[0], dz=b[1]-a[1], len=Math.max(Math.abs(dx),Math.abs(dz));
    const steps=Math.max(2,Math.round(len/Math.max(18,grid*0.35)));
    for(let s=0;s<steps;s++){ const t=s/steps; pts.push([a[0]+dx*t,0,a[1]+dz*t]); }
  }
  return pts;
}
function buildNoAutoZones(ordered){
  const zones=[];
  const seen=new Set();
  const addZone=(x,z,r)=>{
    const key=`${Math.round(x)}:${Math.round(z)}:${Math.round(r)}`;
    if(seen.has(key)) return;
    seen.add(key);
    zones.push({x,z,r});
  };
  for(let i=0;i<ordered.length;i++){
    const n=ordered[i]; if(n.type!=='no-auto') continue;
    const prev=ordered[(i-1+ordered.length)%ordered.length], next=ordered[(i+1)%ordered.length];
    addZone(n.x,n.z,26);
    addZone((n.x+prev.x)/2,(n.z+prev.z)/2,18);
    addZone((n.x+next.x)/2,(n.z+next.z)/2,18);
  }
  return zones;
}
function editorTrackToGameTrack(){
  normalizeEditorTrack();
  if(!Number.isFinite(state.editorTrack.scenerySeed)) state.editorTrack.scenerySeed=Math.floor(Math.random()*0x100000000);
  const tod=makeTimeOfDayPreset(state.editorTrack.timeOfDay||'day');
  const nodes=[...state.editorTrack.nodes], startIdx=getEditorStartIndex(), ordered=[]; for(let i=0;i<nodes.length;i++) ordered.push(nodes[(startIdx+i)%nodes.length]);
  let wp, type='circuit', cityRoute=null;
  if(state.editorTrack.streetGrid){ cityRoute=makeCityRouteFromNodes(ordered, state.editorTrack.gridSize||70); wp=makeCityWpFromRoute(cityRoute, state.editorTrack.gridSize||70); type='city'; }
  else wp=state.editorTrack.useBezier?makeBezierPath(ordered,18):ordered.map(n=>[n.x,0,n.z]);
  return {id:state.editorTrack.id||uniqueTrackId(),name:state.editorTrack.name||'Custom Track',desc:state.editorTrack.desc||'Custom track',laps:+state.editorTrack.laps||3,rw:+state.editorTrack.rw||12,wp,editorNodes:deepClone(ordered),previewColor:state.editorTrack.previewColor||'#44aaff',type,gridSize:state.editorTrack.gridSize||70,enableRunoff:state.editorTrack.enableRunoff!==false,trackGenerationVersion:Number.isFinite(state.editorTrack.trackGenerationVersion)?Math.max(1,Math.floor(state.editorTrack.trackGenerationVersion)):1,cityRoute,noAutoZones:buildNoAutoZones(ordered),sky:cssToHexNum(state.editorTrack.skyColor)||tod.sky,gnd:cssToHexNum(state.editorTrack.groundColor)||tod.gnd,timeOfDay:state.editorTrack.timeOfDay||'day',ambient:tod.ambient,ambientIntensity:tod.ambientIntensity,sun:tod.sun,sunIntensity:tod.sunIntensity,fill:tod.fill,fillIntensity:tod.fillIntensity,assets:deepClone(state.editorTrack.assets||[]),scenerySeed:Number.isFinite(state.editorTrack.scenerySeed)?(state.editorTrack.scenerySeed>>>0):Math.floor(Math.random()*0x100000000),useBezier:!!state.editorTrack.useBezier};
}
function populateEditorUI(){
  normalizeEditorTrack();
  document.getElementById('editorTrackName').value=state.editorTrack.name||'';
  document.getElementById('editorTrackDesc').value=state.editorTrack.desc||'';
  document.getElementById('editorTrackLaps').value=state.editorTrack.laps||3;
  document.getElementById('editorTrackWidth').value=state.editorTrack.rw||12;
  document.getElementById('editorTrackColor').value=state.editorTrack.previewColor||'#44aaff';
  document.getElementById('editorUseBezier').checked=state.editorTrack.useBezier!==false;
  document.getElementById('editorGroundColor').value=state.editorTrack.groundColor||'#1a3018';
  document.getElementById('editorSkyColor').value=state.editorTrack.skyColor||'#0d1a2e';
  document.getElementById('editorTimeOfDay').value=state.editorTrack.timeOfDay||'day';
  document.getElementById('editorStreetGrid').checked=!!state.editorTrack.streetGrid;
  document.getElementById('editorEnableRunoff').checked=state.editorTrack.enableRunoff!==false;
  document.getElementById('editorGridSize').value=state.editorTrack.gridSize||70;
  renderEditorTrackList();
  syncSelectedNodeUI();
  syncEditorNodeCountUI();
  syncEditorBrushUI();
  requestEditorRebuild(true);
}
function renderEditorTrackList(){
  const wrap=document.getElementById('editorTrackList');
  if(!wrap) return;
  wrap.innerHTML='';
  getAllTracks().forEach(src=>{
    const d=document.createElement('div');
    d.className='editorListItem'+(String(state.editorTrack.id)===String(src.id)?' sel':'');
    d.textContent=src.name+(TRACKS.some(t=>String(t.id)===String(src.id))?' · built-in':'');
    d.onclick=()=>{
      state.editorTrack=makeEditableTrackFromGameTrack(src);
      state.editorSelectedNode=0;
      state.editorSelectedAsset=-1;
      populateEditorUI();
    };
    wrap.appendChild(d);
  });
}
function syncSelectedNodeUI(){
  normalizeEditorTrack();
  const node=state.editorTrack.nodes[state.editorSelectedNode]||state.editorTrack.nodes[0];
  if(!node)return;
  document.getElementById('editorNodeType').value=node.type||'no-auto';
  document.getElementById('editorSteepness').value=Math.round(node.steepness||40);
  document.getElementById('editorNodeGravelPitSize').value=Math.round(Number.isFinite(node.gravelPitSize)?node.gravelPitSize:100);
  document.getElementById('editorNodeInfo').textContent='Node '+(state.editorSelectedNode+1)+' · '+(node.type==='start-finish'?'Start/finish':'No scenery')+' · Steepness '+Math.round(node.steepness||40)+' · Gravel '+Math.round(Number.isFinite(node.gravelPitSize)?node.gravelPitSize:100)+'%';
}
function syncEditorNodeCountUI(){
  const count=(state.editorTrack?.nodes||[]).length;
  const slider=document.getElementById('editorNodeCount');
  const label=document.getElementById('editorNodeCountVal');
  if(slider){
    const min=Number(slider.min)||3;
    const desiredMax=Math.max(100,count,min);
    slider.max=String(desiredMax);
    slider.value=String(Math.max(min,Math.min(desiredMax,count)));
  }
  if(label) label.textContent=String(count);
}
function setEditorNodeCount(raw){
  if(!state.editorTrack) return;
  const nodes=state.editorTrack.nodes;
  const slider=document.getElementById('editorNodeCount');
  const max=Number(slider?.max)||100;
  const target=Math.max(3,Math.min(max,Math.round(Number(raw)||nodes.length||3)));
  if(nodes.length===target){
    syncEditorNodeCountUI();
    return;
  }
  while(nodes.length<target){
    const last=nodes[nodes.length-1]||{x:0,z:0,steepness:40,gravelPitSize:100,type:'no-auto'};
    const prev=nodes[nodes.length-2]||{x:last.x-80,z:last.z};
    const dx=last.x-prev.x;
    const dz=last.z-prev.z;
    nodes.push({x:last.x+dx*0.8+22,z:last.z+dz*0.8+18,steepness:last.steepness||40,gravelPitSize:Number.isFinite(last.gravelPitSize)?last.gravelPitSize:100,type:'no-auto'});
  }
  while(nodes.length>target){
    const next=[];
    for(let i=0;i<nodes.length;i+=2){
      const a=nodes[i];
      const b=nodes[(i+1)%nodes.length];
      if(!b||next.length>=target){
        if(next.length<target) next.push({...a});
        continue;
      }
      next.push({
        x:(a.x+b.x)*0.5,
        z:(a.z+b.z)*0.5,
        steepness:Math.round(((a.steepness||40)+(b.steepness||40))*0.5),
        gravelPitSize:Math.round(((Number.isFinite(a.gravelPitSize)?a.gravelPitSize:100)+(Number.isFinite(b.gravelPitSize)?b.gravelPitSize:100))*0.5),
        type:(a.type==='start-finish'||b.type==='start-finish')?'start-finish':'no-auto'
      });
    }
    if(next.length===nodes.length){
      nodes.pop();
    }
    else {
      nodes.splice(0,nodes.length,...next.slice(0,Math.max(target,3)));
    }
    if(nodes.length<target) break;
  }
  while(nodes.length>target) nodes.pop();
  state.editorSelectedNode=Math.max(0,Math.min(state.editorSelectedNode,nodes.length-1));
  normalizeEditorTrack();
  syncSelectedNodeUI();
  syncEditorNodeCountUI();
  requestEditorRebuild(false);
}
function syncEditorBrushUI(){
  const kind=state.editorBrushAsset||'tree';
  const count=Math.max(1,Math.round(state.editorBrushSize||1));
  const enabled=!!state.editorBrushEnabled;
  const sel=document.getElementById('editorBrushAsset');
  const slider=document.getElementById('editorBrushSize');
  const label=document.getElementById('editorBrushSizeVal');
  const toggle=document.getElementById('editorBrushEnabled');
  if(sel) sel.value=kind;
  if(slider) slider.value=String(count);
  if(label) label.textContent=String(count);
  if(toggle) toggle.checked=enabled;
  document.querySelectorAll('#editorAssetPalette .assetChip').forEach(el=>{
    el.classList.toggle('active', el.dataset.asset===kind);
  });
}
function setEditorBrushAsset(kind){
  const valid=['tree','building','park'];
  state.editorBrushAsset=valid.includes(kind)?kind:'tree';
  syncEditorBrushUI();
}
function setEditorBrushEnabled(enabled){
  state.editorBrushEnabled=!!enabled;
  syncEditorBrushUI();
}
function setEditorBrushSize(raw){
  state.editorBrushSize=Math.max(1,Math.min(25,Math.round(Number(raw)||1)));
  syncEditorBrushUI();
}
function paintEditorAssetsAt(x,z){
  const count=Math.max(1,Math.round(state.editorBrushSize||1));
  const type=state.editorBrushAsset||'tree';
  const spacing=12;
  let placed=0;
  for(let i=0;i<count;i++){
    const angle=(i/count)*Math.PI*2;
    const ring=Math.floor(i/8)+1;
    const offset=i===0?0:ring*spacing;
    const px=x+Math.cos(angle)*offset;
    const pz=z+Math.sin(angle)*offset;
    if(!editorCanPlaceAssetAt(px,pz)) continue;
    const exists=state.editorTrack.assets.some(a=>Math.hypot(a.x-px,a.z-pz)<10);
    if(exists) continue;
    state.editorTrack.assets.push({type,x:px,z:pz});
    state.editorSelectedAsset=state.editorTrack.assets.length-1;
    placed++;
  }
  return placed>0;
}
function onEditorMetaChanged(){
  if(!state.editorTrack)return;
  state.editorTrack.name=document.getElementById('editorTrackName').value;
  state.editorTrack.desc=document.getElementById('editorTrackDesc').value;
  state.editorTrack.laps=Math.max(1,Math.min(9,+document.getElementById('editorTrackLaps').value||3));
  state.editorTrack.rw=Math.max(6,Math.min(30,+document.getElementById('editorTrackWidth').value||12));
  state.editorTrack.previewColor=document.getElementById('editorTrackColor').value;
  state.editorTrack.useBezier=document.getElementById('editorUseBezier').checked;
  state.editorTrack.groundColor=document.getElementById('editorGroundColor').value;
  state.editorTrack.skyColor=document.getElementById('editorSkyColor').value;
  state.editorTrack.timeOfDay=document.getElementById('editorTimeOfDay').value;
  state.editorTrack.streetGrid=document.getElementById('editorStreetGrid').checked;
  state.editorTrack.enableRunoff=document.getElementById('editorEnableRunoff').checked;
  state.editorTrack.gridSize=Math.max(40,Math.min(120,+document.getElementById('editorGridSize').value||70));
  requestEditorRebuild(false);
}
function onEditorStreetGridChanged(){
  onEditorMetaChanged();
}
function upgradeEditorTrackToLatestGeneration(){
  if(!state.editorTrack) return;
  const current=Number.isFinite(state.editorTrack.trackGenerationVersion)
    ? Math.max(1,Math.floor(state.editorTrack.trackGenerationVersion))
    : 1;
  if(current>=LATEST_TRACK_GENERATION_VERSION){
    notify('TRACK IS ALREADY ON LATEST GENERATION');
    return;
  }
  state.editorTrack.trackGenerationVersion=LATEST_TRACK_GENERATION_VERSION;
  requestEditorRebuild(false);
  notify(`TRACK UPDATED TO GENERATION V${LATEST_TRACK_GENERATION_VERSION}`);
}
function onEditorNodeChanged(){
  const node=state.editorTrack.nodes[state.editorSelectedNode];
  if(!node)return;
  node.type=document.getElementById('editorNodeType').value;
  if(node.type==='start-finish') state.editorTrack.nodes.forEach((n,i)=>{
    if(i!==state.editorSelectedNode && n.type==='start-finish') n.type='no-auto';
  });
  node.steepness=+document.getElementById('editorSteepness').value||40;
  node.gravelPitSize=Math.max(0,Math.min(400,+document.getElementById('editorNodeGravelPitSize').value||100));
  syncSelectedNodeUI();
  requestEditorRebuild(false);
}
function createNewEditorTrack(){
  state.editorTrack={
    id:uniqueTrackId(),
    name:'New Track',
    desc:'Custom circuit',
    laps:3,
    rw:12,
    previewColor:'#44aaff',
    useBezier:true,
    timeOfDay:'day',
    groundColor:'#1a3018',
    skyColor:'#0d1a2e',
    streetGrid:false,
    enableRunoff:true,
    trackGenerationVersion:LATEST_TRACK_GENERATION_VERSION,
    gridSize:70,
    nodes:[
      {x:0,z:0,steepness:40,gravelPitSize:100,type:'start-finish'},
      {x:140,z:20,steepness:45,gravelPitSize:100,type:'no-auto'},
      {x:160,z:-120,steepness:55,gravelPitSize:100,type:'no-auto'},
      {x:20,z:-180,steepness:55,gravelPitSize:100,type:'no-auto'},
      {x:-120,z:-90,steepness:35,gravelPitSize:100,type:'no-auto'}
    ],
    assets:[],
    scenerySeed:Math.floor(Math.random()*0x100000000)
  };
  state.editorSelectedNode=0;
  state.editorSelectedAsset=-1;
  populateEditorUI();
}
function duplicateEditorTrack(){
  if(!state.editorTrack) return;
  const clone=deepClone(state.editorTrack);
  clone.id=uniqueTrackId();
  clone.source=clone.id;
  clone.builtin=false;
  clone.trackGenerationVersion=LATEST_TRACK_GENERATION_VERSION;
  state.editorTrack=clone;
  state.editorSelectedNode=0;
  state.editorSelectedAsset=-1;
  requestEditorRebuild(true);
  notify('TRACK DUPLICATED');
  populateEditorUI();
}
function addEditorNode(){
  setEditorNodeCount((state.editorTrack.nodes||[]).length+1);
}
function insertEditorNodeAfter(){
  addEditorNode();
}
function deleteEditorNode(){
  setEditorNodeCount((state.editorTrack.nodes||[]).length-1);
}
function deleteSelectedEditorAsset(){
  if(state.editorSelectedAsset<0) return;
  state.editorTrack.assets.splice(state.editorSelectedAsset,1);
  state.editorSelectedAsset=-1;
  requestEditorRebuild(false);
}
function resetEditorTrack(){
  state.editorTrack=makeEditableTrackFromGameTrack(getTrackById(state.editorTrack.source||state.editorTrack.id)||TRACKS[0]);
  state.editorSelectedNode=0;
  state.editorSelectedAsset=-1;
  populateEditorUI();
}
async function saveEditorTrack(){
  const data=editorTrackToGameTrack();
  data.id=TRACKS.some(t=>String(t.id)===String(state.editorTrack.id))?uniqueTrackId():(state.editorTrack.id||uniqueTrackId());
  data.name=state.editorTrack.name||'Custom Track';
  data.updatedAt=new Date().toISOString();
  state.editorTrack.id=data.id;
  state.editorTrack.source=data.id;
  state.editorTrack.builtin=false;
  const idx=state.editorTracks.findIndex(t=>String(t.id)===String(data.id));
  if(idx>=0) state.editorTracks[idx]=data;
  else state.editorTracks.push(data);
  persistEditorTracks();
  const synced=await uploadCustomTrack(data);
  state.selTrk=data.id;
  renderEditorTrackList();
  notify(synced?'TRACK SAVED + SYNCED':'TRACK SAVED (LOCAL ONLY)');
}
function deleteEditorTrack(){
  if(!state.editorTrack) return;
  if(TRACKS.some(t=>String(t.id)===String(state.editorTrack.id))){
    notify('BUILT-IN TRACKS CANNOT BE DELETED'); return;
  }
  const id=String(state.editorTrack.id);
  state.editorTracks=state.editorTracks.filter(t=>String(t.id)!==id);
  if(String(state.selTrk)===id) state.selTrk=null;
  persistEditorTracks();
  const fallback=getAllTracks()[0]||TRACKS[0];
  state.editorTrack=makeEditableTrackFromGameTrack(fallback);
  state.editorSelectedNode=0;
  state.editorSelectedAsset=-1;
  populateEditorUI();
  notify('TRACK DELETED');
}
function requestEditorRebuild(resetCam){
  state.editorNeedsRebuild=true;
  if(resetCam) resetEditorCameraToTrack();
}
function editorRebuildScene(resetCam){
  state.trkData=editorTrackToGameTrack();
  buildTrack(state.trkData);
  setupLights();
  state.activeCam=camEditor;
  state.editorLastRebuild=performance.now();
  state.editorNeedsRebuild=false;
  if(resetCam) resetEditorCameraToTrack();
}
async function showTrackEditor(){
  ensureEditorBoot();
  void syncEditorTracksFromCloud().catch(()=>{});
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  document.getElementById('sEditor').style.display='flex';
  document.getElementById('hud').style.display='none';
  document.getElementById('hint').style.display='none';
  bindEditorCanvas();
  bindEditorAssetPalette();
  populateEditorUI();
  document.getElementById('editorPreviewBanner').style.display='block';
  state.gState='editor';
  stopAudio();
  stopMusic();
  state.activeCam=camEditor;
  requestEditorRebuild(true);
}
function closeTrackEditor(){
  document.getElementById('editorPreviewBanner').style.display='none';
  showMain();
}
function editorCanPlaceAssetAt(x,z){
  return canPlaceDecorAsset(editorTrackToGameTrack(),x,z,{exclusionPad:3,startBuffer:28});
}
function drawEditorCanvas(){
  const canvas=document.getElementById('trackEditorCanvas');
  if(!canvas||!state.editorTrack||state.gState!=='editor') return;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const data=editorTrackToGameTrack();
  if(data.wp&&data.wp.length){
    ctx.strokeStyle=(state.editorTrack.previewColor||'#44aaff')+'88';
    ctx.lineWidth=4;
    ctx.lineJoin='round';
    ctx.beginPath();
    data.wp.forEach((p,i)=>{
      const q=editorWorldToOverlay(new THREE.Vector3(p[0],0.2,p[2]),canvas);
      if(!q) return;
      i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  state.editorTrack.assets.forEach((a,i)=>{
    const p=editorWorldToOverlay(new THREE.Vector3(a.x,3,a.z),canvas);
    if(!p) return;
    ctx.fillStyle=i===state.editorSelectedAsset?'#ffd166':(a.type==='building'?'#c792ea':a.type==='park'?'#55dd88':'#66cc66');
    ctx.strokeStyle='#091018';
    ctx.lineWidth=2;
    if(a.type==='building'){
      ctx.fillRect(p.x-8,p.y-8,16,16);
      ctx.strokeRect(p.x-8,p.y-8,16,16);
    }
    else if(a.type==='park'){
      ctx.fillRect(p.x-10,p.y-10,20,20);
      ctx.strokeRect(p.x-10,p.y-10,20,20);
    }
    else {
      ctx.beginPath();
      ctx.arc(p.x,p.y,8,0,Math.PI*2);
      ctx.fill();
      ctx.stroke();
    }
  });
  state.editorTrack.nodes.forEach((n,i)=>{
    const p=editorWorldToOverlay(new THREE.Vector3(n.x,1,n.z),canvas);
    if(!p) return;
    ctx.beginPath();
    ctx.fillStyle=n.type==='start-finish'?'#ffffff':(i===state.editorSelectedNode?'#ffd166':'#7cc7ff');
    ctx.arc(p.x,p.y,n.type==='start-finish'?10:8,0,Math.PI*2);
    ctx.fill();
    ctx.lineWidth=2;
    ctx.strokeStyle='#091018';
    ctx.stroke();
    if(n.type==='start-finish'){
      ctx.strokeStyle='#111';
      ctx.setLineDash([5,3]);
      ctx.beginPath();
      ctx.moveTo(p.x-14,p.y);
      ctx.lineTo(p.x+14,p.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}
function bindEditorAssetPalette(){
  document.querySelectorAll('#editorAssetPalette .assetChip').forEach(el=>{
    if(el.dataset.bound) return;
    el.dataset.bound='1';
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain', el.dataset.asset);
      setEditorBrushAsset(el.dataset.asset);
    });
    el.addEventListener('click',()=>setEditorBrushAsset(el.dataset.asset));
  });
}
function bindEditorCanvas(){
  const canvas=document.getElementById('trackEditorCanvas');
  if(!canvas||canvas.dataset.bound) return;
  canvas.dataset.bound='1';
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  function nearestOverlayObject(e){
    const r=canvas.getBoundingClientRect();
    const lx=(e.clientX-r.left)*(canvas.width/r.width), ly=(e.clientY-r.top)*(canvas.height/r.height);
    let best=null,bestD=1e9;
    state.editorTrack.assets.forEach((a,i)=>{
      const q=editorWorldToOverlay(new THREE.Vector3(a.x,3,a.z),canvas);
      if(!q) return;
      const d=(q.x-lx)*(q.x-lx)+(q.y-ly)*(q.y-ly);
      if(d<bestD&&d<500){
        best={kind:'asset',index:i};
        bestD=d;
      }
    });
    state.editorTrack.nodes.forEach((n,i)=>{
      const q=editorWorldToOverlay(new THREE.Vector3(n.x,1,n.z),canvas);
      if(!q) return;
      const d=(q.x-lx)*(q.x-lx)+(q.y-ly)*(q.y-ly);
      if(d<bestD&&d<550){
        best={kind:'node',index:i};
        bestD=d;
      }
    });
    return best;
  }
  canvas.addEventListener('dragover',e=>e.preventDefault());
  canvas.addEventListener('drop',e=>{
    e.preventDefault();
    const kind=e.dataTransfer.getData('text/plain');
    if(kind) setEditorBrushAsset(kind);
    const p=editorClientToGround(e.clientX,e.clientY);
    if(!p||!paintEditorAssetsAt(p.x,p.z)) return;
    requestEditorRebuild(false);
  });
  canvas.addEventListener('pointerdown',e=>{
    canvas.setPointerCapture(e.pointerId);
    editorMouse.lastX=e.clientX;
    editorMouse.lastY=e.clientY;
    if(e.button===2||e.button===1){
      editorMouse.mode='orbit';
      return;
    }
    const hit=nearestOverlayObject(e);
    if(hit&&hit.kind==='asset'){
      state.editorSelectedAsset=hit.index;
      state.editorDrag={kind:'asset',index:hit.index};
      requestEditorRebuild(false);
      return;
    }
    if(e.altKey&&state.editorBrushEnabled){
      const p=editorClientToGround(e.clientX,e.clientY);
      if(p&&paintEditorAssetsAt(p.x,p.z)) requestEditorRebuild(false);
      state.editorDrag={kind:'brush'};
      return;
    }
    if(hit&&hit.kind==='node'){
      state.editorSelectedNode=hit.index;
      syncSelectedNodeUI();
      state.editorDrag={kind:'node',index:hit.index};
      requestEditorRebuild(false);
      return;
    }
    const p=editorClientToGround(e.clientX,e.clientY);
    if(state.editorBrushEnabled&&p&&paintEditorAssetsAt(p.x,p.z)){
      requestEditorRebuild(false);
      state.editorDrag={kind:'brush'};
      return;
    }
    editorMouse.mode='pan';
  });
  canvas.addEventListener('pointermove',e=>{
    if(editorMouse.mode==='orbit'){
      const dx=e.clientX-editorMouse.lastX, dy=e.clientY-editorMouse.lastY;
      editorCam.yaw-=dx*0.006;
      editorCam.pitch=Math.max(0.72,Math.min(1.45,editorCam.pitch-dy*0.004));
      editorMouse.lastX=e.clientX;
      editorMouse.lastY=e.clientY;
      return;
    }
    if(editorMouse.mode==='pan'){
      const dx=e.clientX-editorMouse.lastX, dy=e.clientY-editorMouse.lastY;
      const factor=editorCam.distance*0.0016;
      const rightYaw=editorCam.yaw+Math.PI/2;
      editorCam.target.x+=(-Math.sin(rightYaw)*dx + -Math.sin(editorCam.yaw)*dy)*factor;
      editorCam.target.z+=(-Math.cos(rightYaw)*dx + -Math.cos(editorCam.yaw)*dy)*factor;
      editorMouse.lastX=e.clientX;
      editorMouse.lastY=e.clientY;
      return;
    }
    if(!state.editorDrag) return;
    const p=editorClientToGround(e.clientX,e.clientY);
    if(!p) return;
    const snap=(e.shiftKey||state.editorTrack.streetGrid)?(state.editorTrack.gridSize||70):0;
    if(snap){
      p.x=Math.round(p.x/snap)*snap;
      p.z=Math.round(p.z/snap)*snap;
    }
    if(state.editorDrag.kind==='node'){
      state.editorTrack.nodes[state.editorDrag.index].x=p.x;
      state.editorTrack.nodes[state.editorDrag.index].z=p.z;
    }
    else if(state.editorDrag.kind==='asset' && editorCanPlaceAssetAt(p.x,p.z)){
      state.editorTrack.assets[state.editorDrag.index].x=p.x;
      state.editorTrack.assets[state.editorDrag.index].z=p.z;
    }
    else if(state.editorBrushEnabled&&state.editorDrag.kind==='brush' && paintEditorAssetsAt(p.x,p.z)){
      // Brush paints continuously while Alt+dragging.
    }
    requestEditorRebuild(false);
  });
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    editorCam.distance=Math.max(70,Math.min(700,editorCam.distance*(1+Math.sign(e.deltaY)*0.08)));
  },{passive:false}); ['pointerup','pointerleave','pointercancel'].forEach(ev=>canvas.addEventListener(ev,()=>{
    state.editorDrag=null;
    editorMouse.mode=null;
  }));
}

// ═══════════════════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════════════════
function updateFrame(dt){
  if(state.gState==='racing'){
    state.raceTime+=dt;
    const autoTouchThrottle=isTouchControlsVisibleInState(state.gState)
      && ('ontouchstart' in window||navigator.maxTouchPoints>0)
      && !touchState.brake;
    const thr=(keys['ArrowUp']||keys['KeyW']||touchState.throttle||autoTouchThrottle)?1:0;
    const brk=(keys['ArrowDown']||keys['KeyS']||touchState.brake)?1:0;
    const left=(keys['ArrowLeft']||keys['KeyA']||touchState.left);
    const right=(keys['ArrowRight']||keys['KeyD']||touchState.right);
    const keySteer=left&&!right?1:right&&!left?-1:0;
    const gyroSteer=getGyroSteering();
    const str=Math.abs(gyroSteer)>0.01?gyroSteer:keySteer;
    state.pCar.update({thr,brk,str},dt);
    sampleGhostFrame();
    for(const ai of state.aiControllers)ai.update(dt);
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&state.aiCars[i])aiSounds[i].update(state.aiCars[i],state.pCar);}
    updateAudio(thr,brk,dt,state.pCar,keys); updateCamera(); updateHUD(); drawDash(); drawMinimap();
    updateGhostReplay();
  } else if(state.gState==='cooldown'){
    // Player finished — car coasts, AI keeps racing behind results screen
    state.raceTime+=dt;
    state.pCar.update({thr:0,brk:0.3,str:0},dt);
    for(const ai of state.aiControllers){if(!ai.car.finished)ai.update(dt);}
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&state.aiCars[i])aiSounds[i].update(state.aiCars[i],state.pCar);}
    updateAudio(0,0,dt,state.pCar,keys); updateCamera();
    updateGhostReplay();
    // Live-update results as AI cars finish
    if(document.getElementById('results').style.display==='flex') updateResultsUI();
  } else if(state.gState==='editorPreview'){
    updateEditorPreviewCamera(dt);
  } else if(state.gState==='editor'){
    updateEditorPreviewCamera(dt);
    if(state.editorNeedsRebuild&&performance.now()-state.editorLastRebuild>45){ editorRebuildScene(false); }
    drawEditorCanvas();
  } else if(state.gState==='countdown'||state.gState==='finished'||state.gState==='paused'){
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
//  SETTINGS
// ═══════════════════════════════════════════════════════
function showSettings(){
  document.getElementById('settingsModal').style.display='block';
}
function closeSettings(){
  document.getElementById('settingsModal').style.display='none';
}

// ═══════════════════════════════════════════════════════
//  MENU FUNCTIONS
// ═══════════════════════════════════════════════════════
function showIntro(){
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  const intro=document.getElementById('sIntro');
  if(intro) intro.style.display='flex';
  document.getElementById('hud').style.display='none';
  document.getElementById('hint').style.display='none';
  state.gState='menu';
  updateTouchControlsVisibility(state.gState);
  releaseAllTouchControls();
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  clearGhostVisual();
  dc.style.display='none';
}

function showMain(){
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  document.getElementById('sMain').style.display='flex';
  document.getElementById('hud').style.display='none';
  document.getElementById('hint').style.display='none';
  state.gState='menu';
  updateTouchControlsVisibility(state.gState);
  releaseAllTouchControls();
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  dc.style.display='none';
  const epb=document.getElementById('editorPreviewBanner'); if(epb)epb.style.display='none';
  const epbtn=document.getElementById('editorPreviewBtn'); if(epbtn)epbtn.textContent='3D PREVIEW';
  stopAudio(); stopMusic();
  disposeCarCardPreviews();
  clearGhostVisual();
  // Restart menu music (audio already initialised)
  if(audioReady)startMusic();
  for(const c of state.allCars)scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.pCar=null;
}


function disposeCarCardPreviews(){
  if(state.carCardPreviewRaf){ cancelAnimationFrame(state.carCardPreviewRaf); state.carCardPreviewRaf=0; }
  state.carCardPreviews.forEach(item=>{ if(item.renderer) item.renderer.dispose(); });
  state.carCardPreviews.length=0;
  state.carCardPreviewScene=null;
  state.carCardPreviewCamera=null;
}

function ensureCarCardPreviewRenderer(){
  if(state.carCardPreviewScene&&state.carCardPreviewCamera) return;
  state.carCardPreviewScene=new THREE.Scene();
  state.carCardPreviewCamera=new THREE.PerspectiveCamera(30,1,0.1,100);
  state.carCardPreviewCamera.position.set(0,3.2,9.5);
  state.carCardPreviewCamera.lookAt(0,0.9,0);
  const amb=new THREE.AmbientLight(0xffffff,0.85);
  const key=new THREE.DirectionalLight(0xffffff,1.15); key.position.set(5,8,6);
  const fill=new THREE.DirectionalLight(0x88aaff,0.4); fill.position.set(-6,4,-5);
  state.carCardPreviewScene.add(amb,key,fill);
}

function renderCarCardPreviews(ts){
  if(state.gState!=='carSel'||!state.carCardPreviews.length){ state.carCardPreviewRaf=0; return; }
  const now=ts||performance.now();
  const dt=Math.min(0.05, Math.max(0.001,(now-state.carCardPreviewLastTime||16)/1000));
  state.carCardPreviewLastTime=now;
  const scene=state.carCardPreviewScene;
  const camera=state.carCardPreviewCamera;
  for(const item of state.carCardPreviews){
    if(!item.host.isConnected) continue;
    const rect=item.host.getBoundingClientRect();
    if(rect.width<2||rect.height<2) continue;
    item.spinSpeed += (((item.selected||item.hovered)?1.9:0)-item.spinSpeed)*Math.min(1,dt*8);
    item.angle += item.spinSpeed*dt;
    item.model.rotation.y=item.baseYaw+item.angle;
    const w=Math.max(96,Math.floor(rect.width));
    const h=Math.max(72,Math.floor(rect.height));
    if(item.canvas.width!==w||item.canvas.height!==h){ item.canvas.width=w; item.canvas.height=h; }
    item.renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    scene.add(item.model);
    item.renderer.render(scene,camera);
    scene.remove(item.model);
  }
  state.carCardPreviewRaf=requestAnimationFrame(renderCarCardPreviews);
}

function startCarCardPreviews(){
  if(state.carCardPreviewRaf||!state.carCardPreviews.length) return;
  state.carCardPreviewLastTime=performance.now();
  state.carCardPreviewRaf=requestAnimationFrame(renderCarCardPreviews);
}

function showCarSel(){
  if(state.selTrk==null){ showTrkSel(); return; }
  const speedMinKph=100;
  const speedMaxKph=300;
  const accelMin=6;
  const accelMax=12;
  const pctForRange=(value,min,max)=>Math.max(0,Math.min(100,((value-min)/(max-min))*100));
  disposeCarCardPreviews();
  ensureCarCardPreviewRenderer();
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sCar').style.display='flex';
  state.gState='carSel';
  const ct=document.getElementById('carCards'); ct.innerHTML='';
  document.getElementById('btnGo').disabled=(state.selCar==null);
  CARS.forEach((c,i)=>{
    const d=document.createElement('div'); d.className='card'+(state.selCar===i?' sel':'');
    const topSpeedKph=Math.round(c.maxSpd*3.6);
    const topSpeedBarPct=pctForRange(topSpeedKph,speedMinKph,speedMaxKph);
    const accelBarPct=pctForRange(c.accel,accelMin,accelMax);
    const handlingPct=Math.round(c.hdl*100);
    const brakeStat=Math.min(100,Math.round(c.brake*4));
    d.innerHTML=`<canvas class="carCardCanvas" aria-hidden="true"></canvas>
      <h3>${c.name}</h3><p>${c.desc}</p>
      <div class="stat"><span class="sl">SPEED</span><div class="st"><div class="sf" style="width:${topSpeedBarPct}%"></div></div><span class="sv">${topSpeedKph}</span></div>
      <div class="stat"><span class="sl">ACCEL</span><div class="st"><div class="sf" style="width:${accelBarPct}%"></div></div><span class="sv">${c.accel.toFixed(1)}</span></div>
      <div class="stat"><span class="sl">GRIP</span><div class="st"><div class="sf" style="width:${handlingPct}%"></div></div><span class="sv">${handlingPct}%</span></div>
      <div class="stat"><span class="sl">BRAKES</span><div class="st"><div class="sf" style="width:${brakeStat}%"></div></div><span class="sv">${c.brake}</span></div>
`;
    const canvas=d.querySelector('.carCardCanvas');
    const visual=createCarVisual(c);
    visual.mesh.scale.setScalar(0.72);
    visual.mesh.rotation.x=-0.1;
    visual.mesh.position.set(0,-0.2,0);
    const preview={host:d,canvas,model:visual.mesh,hovered:false,selected:state.selCar===i,angle:0,spinSpeed:0,baseYaw:-0.55,renderer:new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'})};
    preview.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
    preview.renderer.outputColorSpace=THREE.SRGBColorSpace;
    state.carCardPreviews.push(preview);
    const setSel=()=>{
      document.querySelectorAll('#carCards .card').forEach(x=>x.classList.remove('sel'));
      d.classList.add('sel'); state.selCar=i; document.getElementById('btnGo').disabled=false;
      state.carCardPreviews.forEach(item=>{ item.selected=item.host===d; });
      startCarCardPreviews();
    };
    d.onmouseenter=()=>{ preview.hovered=true; startCarCardPreviews(); };
    d.onmouseleave=()=>{ preview.hovered=false; };
    d.onclick=setSel;
    ct.appendChild(d);
  });
  startCarCardPreviews();
}


function drawTrackPreview(canvas, track, color){
  const W=canvas.width, H=canvas.height, ctx=canvas.getContext('2d');
  const pad=22;
  const xs=track.wp.map(p=>p[0]), zs=track.wp.map(p=>p[2]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const scale=Math.min((W-pad*2)/(maxX-minX||1),(H-pad*2)/(maxZ-minZ||1));
  const offX=(W-(maxX-minX)*scale)/2, offZ=(H-(maxZ-minZ)*scale)/2;
  function pt(x,z){return [(x-minX)*scale+offX,(z-minZ)*scale+offZ];}
  // Catmull-Rom smooth curve
  function catmull(pts,steps=10){
    const n=pts.length,res=[];
    for(let s=0;s<n;s++){
      const p0=pts[(s-1+n)%n],p1=pts[s],p2=pts[(s+1)%n],p3=pts[(s+2)%n];
      for(let i=0;i<steps;i++){
        const t=i/steps,t2=t*t,t3=t2*t;
        res.push([
          .5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
          .5*((2*p1[2])+(-p0[2]+p2[2])*t+(2*p0[2]-5*p1[2]+4*p2[2]-p3[2])*t2+(-p0[2]+3*p1[2]-3*p2[2]+p3[2])*t3)
        ]);
      }
    }
    res.push(res[0]);
    return res;
  }
  ctx.fillStyle='#0c0c18'; ctx.fillRect(0,0,W,H);
  // grid
  ctx.strokeStyle='#161622'; ctx.lineWidth=1;
  for(let gx=Math.ceil(minX/50)*50;gx<=maxX;gx+=50){const[sx]=pt(gx,minZ);ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,H);ctx.stroke();}
  for(let gz=Math.ceil(minZ/50)*50;gz<=maxZ;gz+=50){const[,sz]=pt(minX,gz);ctx.beginPath();ctx.moveTo(0,sz);ctx.lineTo(W,sz);ctx.stroke();}
  const curve=catmull(track.wp,12);
  // width band
  ctx.strokeStyle=color+'2a'; ctx.lineWidth=track.rw*scale*1.8; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.beginPath(); curve.forEach(([x,z],i)=>{const[px,pz]=pt(x,z);i?ctx.lineTo(px,pz):ctx.moveTo(px,pz);}); ctx.stroke();
  // centre line
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.setLineDash([]);
  ctx.beginPath(); curve.forEach(([x,z],i)=>{const[px,pz]=pt(x,z);i?ctx.lineTo(px,pz):ctx.moveTo(px,pz);}); ctx.stroke();
  // direction arrows
  ctx.fillStyle=color+'cc';
  const step=Math.floor(curve.length/8);
  for(let i=step;i<curve.length-1;i+=step){
    const[x1,z1]=pt(curve[i][0],curve[i][2]),[x2,z2]=pt(curve[i+1][0],curve[i+1][2]);
    const dx=x2-x1,dz=z2-z1,len=Math.sqrt(dx*dx+dz*dz)||1,nx=dx/len,nz=dz/len;
    ctx.beginPath();ctx.moveTo(x1+nz*4,z1-nx*4);ctx.lineTo(x1+nx*9,z1+nz*9);ctx.lineTo(x1-nz*4,z1+nx*4);ctx.closePath();ctx.fill();
  }
  // S/F line
  const[sfx,sfz]=pt(track.wp[0][0],track.wp[0][2]);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.setLineDash([3,2]);
  ctx.beginPath();ctx.moveTo(sfx-10,sfz);ctx.lineTo(sfx+10,sfz);ctx.stroke();ctx.setLineDash([]);
  ctx.font='bold 9px Orbitron,monospace'; ctx.fillStyle='#fff';
  ctx.fillText('S/F',sfx+12,sfz+4);
}

async function showTrkSel(){
  loadEditorTracks();
  void syncEditorTracksFromCloud().catch(()=>{});
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sTrk').style.display='flex';
  document.getElementById('btnNxt').disabled=(state.selTrk==null);
  const COLORS=['#4488ff','#44cc66','#ffaa22','#ff4488','#22ddaa','#dd66ff','#66bbff'];
  const tt=document.getElementById('trkCards'); tt.innerHTML='';
  const tracks=getAllTracks();
  tracks.forEach((t,i)=>{
    const card=document.createElement('div'); card.className='tcard'+(String(state.selTrk)===String(t.id)?' sel':'');
    const canvas=document.createElement('canvas'); canvas.width=280; canvas.height=230;
    canvas.style.borderRadius='6px';
    const h3=document.createElement('h3'); h3.textContent=t.name;
    const p=document.createElement('p'); p.textContent=t.desc+' · '+t.rw+'m wide'+(TRACKS.some(bt=>String(bt.id)===String(t.id))?'':' · Custom');
    const best=document.createElement('p'); best.className='trackBest'; best.dataset.trackBest=normaliseTrackId(t.id,t.name); best.textContent='Best: loading...';
    const leaderboardBtn=document.createElement('button');
    leaderboardBtn.className='btn btn-s trackLbBtn';
    leaderboardBtn.type='button';
    leaderboardBtn.textContent='LEADERBOARD';
    leaderboardBtn.addEventListener('click',async(e)=>{
      e.stopPropagation();
      await openTrackLeaderboardModal(t.id,t.name);
    });
    card.appendChild(canvas); card.appendChild(h3); card.appendChild(p); card.appendChild(best); card.appendChild(leaderboardBtn);
    card.onclick=()=>{
      document.querySelectorAll('#trkCards .tcard').forEach(x=>x.classList.remove('sel'));
      card.classList.add('sel'); state.selTrk=t.id; document.getElementById('btnNxt').disabled=false;
    };
    tt.appendChild(card);
    drawTrackPreview(canvas,t,t.previewColor||COLORS[i%COLORS.length]);
  });
  await Promise.all(tracks.map(async(t)=>{
    await loadTrackLeaderboard(t.id,{limit:1,trackName:t.name});
    updateTrackCardBestTime(t.id,t.name);
  }));
}


function startRace(){
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  void initRace();
}
function restartRace(){
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  releaseAllTouchControls();
  document.getElementById('results').style.display='none';
  void initRace();
}

document.getElementById('resumeBtn').addEventListener('click', resumeRace);
document.getElementById('restartBtn').addEventListener('click', restartRace);
document.getElementById('showSettingsBtn').addEventListener('click', () => showSettings());
document.getElementById('quitToMenuBtn').addEventListener('click', showMain);
document.getElementById('musicVolSlider').addEventListener('input', e => onMusicVol(e.target.value));
document.getElementById('sfxVolSlider').addEventListener('input', e => onSfxVol(e.target.value));
document.getElementById('touchToggleInput').addEventListener('input', e => onTouchControlsToggle(e.target.checked));
document.getElementById('onlineGhostToggleInput').addEventListener('input', e => setOnlineGhostToggle(e.target.checked));
document.getElementById('onlineGhostCountSelect').addEventListener('change', e => setOnlineGhostCount(e.target.value));
document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);
document.getElementById('introStartBtn').addEventListener('click', function() {tryStartMenuMusic();showMain();});
document.getElementById('gameStartBtn').addEventListener('click', function() {tryStartMenuMusic();showTrkSel();});
document.getElementById('trackEditorBtn').addEventListener('click', function() {tryStartMenuMusic();showTrackEditor();});
document.getElementById('mainSettingsBtn').addEventListener('click', function() {tryStartMenuMusic();showSettings();});
document.getElementById('backToSelectionBtn').addEventListener('click', () => { window.location.href = '../index.html'; });
document.getElementById('showTrkSelBtn').addEventListener('click', showTrkSel);
document.getElementById('btnGo').addEventListener('click', startRace);
document.getElementById('trkSelBackBtn').addEventListener('click', showMain);
document.getElementById('btnNxt').addEventListener('click', showCarSel);
document.getElementById('closeEditorBtn').addEventListener('click', closeTrackEditor);
document.getElementById('newTrackBtn').addEventListener('click', createNewEditorTrack);
document.getElementById('dupeTrackBtn').addEventListener('click', duplicateEditorTrack);
document.getElementById('delTrackBtn').addEventListener('click', deleteEditorTrack);
document.getElementById('editorTrackName').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorTrackDesc').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorTrackLaps').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorTrackWidth').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorTrackColor').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorUseBezier').addEventListener('change', onEditorMetaChanged);
document.getElementById('editorGroundColor').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorSkyColor').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorTimeOfDay').addEventListener('change', onEditorMetaChanged);
document.getElementById('editorStreetGrid').addEventListener('change', onEditorStreetGridChanged);
document.getElementById('editorGridSize').addEventListener('input', onEditorMetaChanged);
document.getElementById('editorEnableRunoff').addEventListener('change', onEditorMetaChanged);
document.getElementById('editorNodeCount').addEventListener('input', e=>setEditorNodeCount(e.target.value));
document.getElementById('editorBrushAsset').addEventListener('change', e=>setEditorBrushAsset(e.target.value));
document.getElementById('editorBrushEnabled').addEventListener('change', e=>setEditorBrushEnabled(e.target.checked));
document.getElementById('editorBrushSize').addEventListener('input', e=>setEditorBrushSize(e.target.value));
document.getElementById('editorNodeType').addEventListener('change', onEditorNodeChanged);
document.getElementById('editorSteepness').addEventListener('input', onEditorNodeChanged);
document.getElementById('editorNodeGravelPitSize').addEventListener('input', onEditorNodeChanged);
document.getElementById('addNodeBtn').addEventListener('click', addEditorNode);
document.getElementById('insertNodeBtn').addEventListener('click', insertEditorNodeAfter);
document.getElementById('delNodeBtn').addEventListener('click', deleteEditorNode);
document.getElementById('delAssetBtn').addEventListener('click', deleteSelectedEditorAsset);
document.getElementById('resetEditorCamBtn').addEventListener('click', resetEditorCameraToTrack);
document.getElementById('saveEditorTrackBtn').addEventListener('click', saveEditorTrack);
document.getElementById('resetEditorTrackBtn').addEventListener('click', resetEditorTrack);
document.getElementById('upgradeTrackGenerationBtn').addEventListener('click', upgradeEditorTrackToLatestGeneration);
document.getElementById('closeLeaderboardModalBtn').addEventListener('click', closeTrackLeaderboardModal);
document.getElementById('leaderboardModal').addEventListener('click', e=>{ if(e.target.id==='leaderboardModal') closeTrackLeaderboardModal(); });
document.getElementById('menuBtn').addEventListener('click', showMain);
document.getElementById('raceAgainBtn').addEventListener('click', restartRace);

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
scene.background=new THREE.Color(0x050510);
setupTouchControls(state.gState);
initTouchSettings();
initAudioSettings();
setOnlineGhostToggle(readOnlineGhostToggle());
setOnlineGhostCount(readOnlineGhostCount());
document.querySelectorAll('.menuVersion').forEach(el=>{
  el.textContent=TURBORACE_VERSION;
});

const { renderer, start:startRenderLoop }=createRenderPipeline({
  THREE,
  canvas:gc,
  scene,
  clock,
  cameras:[camChase,camCock,camEditor],
  resizeOverlays:resizeDC,
  frameUpdate:updateFrame,
  getActiveCamera:()=>state.activeCam
});
state.renderer = renderer;
setupLights(); startRenderLoop(); loadArcadeUser(); showIntro();
