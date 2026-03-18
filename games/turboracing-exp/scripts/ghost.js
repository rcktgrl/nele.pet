'use strict';
import { THREE } from './three.js';
import { scene, state } from './state.js';
import { createCarVisual } from './car-model.js';
import { loadTrackLeaderboard, normaliseTrackId } from './leaderboard.js';
import { loadArcadeUser } from './user.js';

// ═══════════════════════════════════════════════════════
//  GHOST STATE
// ═══════════════════════════════════════════════════════
const ONLINE_GHOST_TOGGLE_KEY='turboracing_exp_online_ghost_enabled';
const ONLINE_GHOST_COUNT_KEY='turboracing_exp_online_ghost_count';
const GHOST_SAMPLE_MS=100;

export let onlineGhostEnabled=false;
export let onlineGhostCount=1;
export let ghostReplays=[];
export let ghostRecord=null;
export let ghostVisuals=[];

function normalizeGhostName(raw){
  const out=String(raw||'').trim().replace(/\s+/g,' ').slice(0,24);
  return out||'Ghost';
}

export function readOnlineGhostToggle(){
  return localStorage.getItem(ONLINE_GHOST_TOGGLE_KEY)==='1';
}

function parseOnlineGhostCount(raw){
  return Math.max(1,Math.min(10,Math.round(Number(raw)||1)));
}

export function readOnlineGhostCount(){
  return parseOnlineGhostCount(localStorage.getItem(ONLINE_GHOST_COUNT_KEY));
}

export function setOnlineGhostToggle(enabled){
  onlineGhostEnabled=!!enabled;
  const input=document.getElementById('onlineGhostToggleInput');
  if(input&&input.checked!==onlineGhostEnabled)input.checked=onlineGhostEnabled;
  localStorage.setItem(ONLINE_GHOST_TOGGLE_KEY,onlineGhostEnabled?'1':'0');
}

export function setOnlineGhostCount(raw){
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

export function clearGhostVisual(){
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
  ghostVisuals.push({mesh,replay,tagEl,username});
}

export async function setupGhostReplayFromTrack(trackId){
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

export function startGhostRecording(){
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

export function sampleGhostFrame(){
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

export async function finalizeGhostRecording(){
  if(!ghostRecord||!state.trkData||!state.pCar||!state.pCar.finTime)return null;
  const user=await loadArcadeUser();
  ghostRecord.username=normalizeGhostName(user&&user.name);
  ghostRecord.timeMs=Math.round(Math.max(0,state.pCar.finTime)*1000);
  if(ghostRecord.frames.length<2)return null;
  return {
    username:ghostRecord.username,
    carData:{...ghostRecord.carData},
    frames:ghostRecord.frames.map(frame=>({...frame})),
    timeMs:ghostRecord.timeMs
  };
}

export function updateGhostReplay(){
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

export function shouldRenderGhostsForState(gameState){
  return gameState==='countdown'||gameState==='racing'||gameState==='cooldown'||gameState==='finished';
}
