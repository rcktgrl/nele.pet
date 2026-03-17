'use strict';
import { TRACKS } from './data/tracks.js';
import { THREE } from './three.js';
import { state, scene, camEditor, editorMouse, editorCam } from './state.js';
import { buildTrack, canPlaceDecorAsset, LATEST_TRACK_GENERATION_VERSION } from './track-gen.js';
import { supabase } from './supabase.js';
import { setupLights } from './lighting.js';
import { notify } from './notify.js';
import { stopAudio, stopMusic } from './audio.js';
import {
  resetEditorCameraToTrack, normalizeEditorTrack,
  editorWorldToOverlay, editorClientToGround,
  updateEditorPreviewCamera
} from './camera.js';

// ═══════════════════════════════════════════════════════
//  TRACK HELPERS
// ═══════════════════════════════════════════════════════
export function getAllTracks(){ return [...TRACKS, ...state.editorTracks]; }
export function getTrackById(id){ return getAllTracks().find(t=>String(t.id)===String(id))||TRACKS[0]; }

const CUSTOM_TRACKS_TABLE='turborace_custom_tracks';
let customTrackSyncAvailable=true;

export function hexNumToCss(n){ return '#'+((n||0)&0xffffff).toString(16).padStart(6,'0'); }
export function cssToHexNum(s){ return parseInt(String(s||'#000000').replace('#',''),16)||0; }
export function deepClone(v){ return JSON.parse(JSON.stringify(v)); }

export function makeTimeOfDayPreset(mode){
  if(mode==='night') return {sky:0x06060c,gnd:0x0a0a14,ambient:0x667788,ambientIntensity:0.35,sun:0x8899bb,sunIntensity:0.58,fill:0x334466,fillIntensity:0.2};
  if(mode==='sunset') return {sky:0x462414,gnd:0x3a2616,ambient:0xffc6a0,ambientIntensity:0.42,sun:0xffb066,sunIntensity:0.92,fill:0x884466,fillIntensity:0.24};
  return {sky:0x0d1a2e,gnd:0x1a3018,ambient:0xffffff,ambientIntensity:0.55,sun:0xffffff,sunIntensity:1.1,fill:0x5566bb,fillIntensity:0.3};
}

export function makeEditableTrackFromGameTrack(src){
  const tod=src.timeOfDay||(src.type==='city'?'night':'day');
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
  if(pts.length&&!pts.some(n=>n.type==='start-finish')) pts[0].type='start-finish';
  return {
    id:src.id,name:src.name,desc:src.desc||'',laps:src.laps||3,rw:src.rw||12,previewColor:src.previewColor||'#44aaff',
    useBezier:src.useBezier!==false,timeOfDay:tod,groundColor:hexNumToCss(src.gnd||makeTimeOfDayPreset(tod).gnd),skyColor:hexNumToCss(src.sky||makeTimeOfDayPreset(tod).sky),
    streetGrid:src.type==='city',gridSize:src.gridSize||70,enableRunoff:src.enableRunoff!==false,
    trackGenerationVersion:Number.isFinite(src.trackGenerationVersion)?Math.max(1,Math.floor(src.trackGenerationVersion)):1,
    nodes:pts,assets:deepClone(src.assets||[]),scenerySeed:Number.isFinite(src.scenerySeed)?(src.scenerySeed>>>0):null,source:src.id,builtin:TRACKS.some(t=>String(t.id)===String(src.id))
  };
}

export function normaliseStoredTrack(raw){
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
    out.wp=thinCheckpoints(nodes.map(n=>[+n.x||0,0,+n.z||0]),50);
    const maxWp=nodes.length*2;
    if(out.wp.length>maxWp){const step=out.wp.length/maxWp;out.wp=Array.from({length:maxWp},(_,i)=>out.wp[Math.round(i*step)]);}
  }
  const updatedAt=Date.parse(out.updatedAt||out.updated_at||raw.updated_at||'');
  out.updatedAt=Number.isFinite(updatedAt)?new Date(updatedAt).toISOString():new Date(0).toISOString();
  return out;
}

export function loadEditorTracks(){
  try{
    const parsed=JSON.parse(localStorage.getItem('turborace_custom_tracks')||'[]');
    state.editorTracks=(Array.isArray(parsed)?parsed:[]).map(normaliseStoredTrack).filter(Boolean);
  }catch{
    state.editorTracks=[];
  }
}

export function persistEditorTracks(){ localStorage.setItem('turborace_custom_tracks',JSON.stringify(state.editorTracks)); }

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
    error.code==='42501'||
    msg.includes('row-level security')||
    msg.includes('permission denied')||
    msg.includes('not authenticated')
  );
}

export async function syncEditorTracksFromCloud(){
  if(!customTrackSyncAvailable) return;
  let result=await supabase.from(CUSTOM_TRACKS_TABLE)
    .select('track_id,track_data,updated_at')
    .order('updated_at',{ascending:false})
    .limit(250);

  if(result.error){
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

export async function uploadCustomTrack(track){
  if(!customTrackSyncAvailable||!track||!track.id) return false;
  const {data:{session}}=await supabase.auth.getSession();
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

export function ensureEditorBoot(){ loadEditorTracks(); if(!state.editorTrack) state.editorTrack=state.editorTracks[0]?deepClone(state.editorTracks[0]):makeEditableTrackFromGameTrack(TRACKS[0]); }
export function uniqueTrackId(){ return 'custom-'+Date.now()+'-'+Math.floor(Math.random()*9999); }
export function getEditorStartIndex(){ const idx=(state.editorTrack.nodes||[]).findIndex(n=>n.type==='start-finish'); return idx>=0?idx:0; }

function cornerSeverity(nodes,i){
  const n=nodes.length;
  if(n<3) return 0;
  const prev=nodes[(i-1+n)%n],cur=nodes[i],next=nodes[(i+1)%n];
  const ax=cur.x-prev.x,az=cur.z-prev.z,bx=next.x-cur.x,bz=next.z-cur.z;
  const al=Math.hypot(ax,az)||1,bl=Math.hypot(bx,bz)||1;
  const dot=(ax*bx+az*bz)/(al*bl);
  return Math.max(0,Math.min(1,1-Math.max(-1,Math.min(1,dot))));
}

function makeBezierPath(nodes,samplesPerSeg=18){
  const out=[]; const n=nodes.length;
  for(let i=0;i<n;i++){
    const p0=nodes[(i-1+n)%n],p1=nodes[i],p2=nodes[(i+1)%n],p3=nodes[(i+2)%n];
    const s=Math.max(0,Math.min(1,(p1.steepness||40)/100))*0.55;
    const h1x=(p2.x-p0.x)*s,h1z=(p2.z-p0.z)*s;
    const h2x=(p3.x-p1.x)*s,h2z=(p3.z-p1.z)*s;
    const c1={x:p1.x+h1x,y:0,z:p1.z+h1z};
    const c2={x:p2.x-h2x,y:0,z:p2.z-h2z};
    const segLen=Math.hypot(p2.x-p1.x,p2.z-p1.z);
    const sharp=Math.max(cornerSeverity(nodes,i),cornerSeverity(nodes,(i+1)%n));
    const detailBoost=1+sharp*2.3;
    const lenBoost=Math.min(2.1,Math.max(0.9,segLen/95));
    const segSamples=Math.max(10,Math.min(90,Math.round(samplesPerSeg*detailBoost*lenBoost)));
    for(let j=0;j<segSamples;j++){
      const t=j/segSamples,mt=1-t;
      const x=mt*mt*mt*p1.x+3*mt*mt*t*c1.x+3*mt*t*t*c2.x+t*t*t*p2.x;
      const z=mt*mt*mt*p1.z+3*mt*mt*t*c1.z+3*mt*t*t*c2.z+t*t*t*p2.z;
      out.push([x,0,z]);
    }
  }
  return out;
}

function makeCityRouteFromNodes(nodes,grid){
  const snapped=[];
  nodes.forEach(n=>{ const x=Math.round(n.x/grid)*grid,z=Math.round(n.z/grid)*grid; if(!snapped.length||snapped[snapped.length-1][0]!==x||snapped[snapped.length-1][1]!==z) snapped.push([x,z]); });
  return snapped.length<4?[[0,70],[0,-70],[-70,-70],[-70,70]]:snapped;
}

function makeCityWpFromRoute(route,grid){
  const pts=[];
  for(let i=0;i<route.length;i++){
    const a=route[i],b=route[(i+1)%route.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.max(Math.abs(dx),Math.abs(dz));
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
    const prev=ordered[(i-1+ordered.length)%ordered.length],next=ordered[(i+1)%ordered.length];
    addZone(n.x,n.z,26);
    addZone((n.x+prev.x)/2,(n.z+prev.z)/2,18);
    addZone((n.x+next.x)/2,(n.z+next.z)/2,18);
  }
  return zones;
}

export function thinCheckpoints(wp,minDist){
  if(!wp||wp.length<2) return wp;
  const out=[wp[0]];
  for(let i=1;i<wp.length;i++){
    const prev=out[out.length-1],cur=wp[i];
    const d=Math.hypot(cur[0]-prev[0],cur[2]-prev[2]);
    if(d>=minDist) out.push(cur);
  }
  return out.length>=2?out:wp;
}

export function editorTrackToGameTrack(){
  normalizeEditorTrack();
  if(!Number.isFinite(state.editorTrack.scenerySeed)) state.editorTrack.scenerySeed=Math.floor(Math.random()*0x100000000);
  const tod=makeTimeOfDayPreset(state.editorTrack.timeOfDay||'day');
  const nodes=[...state.editorTrack.nodes],startIdx=getEditorStartIndex(),ordered=[];
  for(let i=0;i<nodes.length;i++) ordered.push(nodes[(startIdx+i)%nodes.length]);
  let wp,type='circuit',cityRoute=null;
  if(state.editorTrack.streetGrid){ cityRoute=makeCityRouteFromNodes(ordered,state.editorTrack.gridSize||70); wp=makeCityWpFromRoute(cityRoute,state.editorTrack.gridSize||70); type='city'; }
  else wp=state.editorTrack.useBezier?makeBezierPath(ordered,18):ordered.map(n=>[n.x,0,n.z]);
  wp=thinCheckpoints(wp,50);
  const maxWp=ordered.length*2;
  if(wp.length>maxWp){ const step=wp.length/maxWp; wp=Array.from({length:maxWp},(_,i)=>wp[Math.round(i*step)]); }
  return {id:state.editorTrack.id||uniqueTrackId(),name:state.editorTrack.name||'Custom Track',desc:state.editorTrack.desc||'Custom track',laps:+state.editorTrack.laps||3,rw:+state.editorTrack.rw||12,wp,editorNodes:deepClone(ordered),previewColor:state.editorTrack.previewColor||'#44aaff',type,gridSize:state.editorTrack.gridSize||70,enableRunoff:state.editorTrack.enableRunoff!==false,trackGenerationVersion:Number.isFinite(state.editorTrack.trackGenerationVersion)?Math.max(1,Math.floor(state.editorTrack.trackGenerationVersion)):1,cityRoute,noAutoZones:buildNoAutoZones(ordered),sky:cssToHexNum(state.editorTrack.skyColor)||tod.sky,gnd:cssToHexNum(state.editorTrack.groundColor)||tod.gnd,timeOfDay:state.editorTrack.timeOfDay||'day',ambient:tod.ambient,ambientIntensity:tod.ambientIntensity,sun:tod.sun,sunIntensity:tod.sunIntensity,fill:tod.fill,fillIntensity:tod.fillIntensity,assets:deepClone(state.editorTrack.assets||[]),scenerySeed:Number.isFinite(state.editorTrack.scenerySeed)?(state.editorTrack.scenerySeed>>>0):Math.floor(Math.random()*0x100000000),useBezier:!!state.editorTrack.useBezier,fogDist:Number.isFinite(state.editorTrack.fogDist)?state.editorTrack.fogDist:1200};
}

export function populateEditorUI(){
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
  const fogDistVal=Number.isFinite(state.editorTrack.fogDist)?state.editorTrack.fogDist:1200;
  document.getElementById('editorFogDist').value=fogDistVal;
  document.getElementById('editorFogDistVal').textContent=fogDistVal;
  renderEditorTrackList();
  syncSelectedNodeUI();
  syncEditorNodeCountUI();
  syncEditorBrushUI();
  requestEditorRebuild(true);
}

export function renderEditorTrackList(){
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

export function syncSelectedNodeUI(){
  normalizeEditorTrack();
  const node=state.editorTrack.nodes[state.editorSelectedNode]||state.editorTrack.nodes[0];
  if(!node)return;
  document.getElementById('editorNodeType').value=node.type||'no-auto';
  document.getElementById('editorSteepness').value=Math.round(node.steepness||40);
  const gpv=Math.round(Number.isFinite(node.gravelPitSize)?node.gravelPitSize:100);
  document.getElementById('editorNodeGravelPitSize').value=gpv;
  document.getElementById('editorNodeGravelPitSizeVal').textContent=gpv;
  const glv=Number.isFinite(node.gravelLeft)?node.gravelLeft:0;
  document.getElementById('editorNodeGravelLeft').value=glv;
  document.getElementById('editorNodeGravelLeftVal').textContent=glv;
  const grv=Number.isFinite(node.gravelRight)?node.gravelRight:0;
  document.getElementById('editorNodeGravelRight').value=grv;
  document.getElementById('editorNodeGravelRightVal').textContent=grv;
  document.getElementById('editorNodeInfo').textContent='Node '+(state.editorSelectedNode+1)+' · '+(node.type==='start-finish'?'Start/finish':'No scenery')+' · Steepness '+Math.round(node.steepness||40)+' · Gravel '+gpv+'%';
}

export function syncEditorNodeCountUI(){
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

export function setEditorNodeCount(raw){
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
    }else{
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

export function syncEditorBrushUI(){
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
    el.classList.toggle('active',el.dataset.asset===kind);
  });
}

export function setEditorBrushAsset(kind){
  const valid=['tree','building','park'];
  state.editorBrushAsset=valid.includes(kind)?kind:'tree';
  syncEditorBrushUI();
}

export function setEditorBrushEnabled(enabled){
  state.editorBrushEnabled=!!enabled;
  syncEditorBrushUI();
}

export function setEditorBrushSize(raw){
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

export function onEditorMetaChanged(){
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
  const fd=Math.max(100,Math.min(2000,+document.getElementById('editorFogDist').value||1200));
  state.editorTrack.fogDist=fd;
  document.getElementById('editorFogDistVal').textContent=fd;
  requestEditorRebuild(false);
}

export function onEditorStreetGridChanged(){
  onEditorMetaChanged();
}

export function upgradeEditorTrackToLatestGeneration(){
  if(!state.editorTrack) return;
  const current=Number.isFinite(state.editorTrack.trackGenerationVersion)
    ? Math.max(1,Math.floor(state.editorTrack.trackGenerationVersion))
    : 1;
  if(current>=LATEST_TRACK_GENERATION_VERSION){
    notify('TRACK IS ALREADY ON LATEST GENERATION');
    return;
  }
  state.editorTrack.trackGenerationVersion=LATEST_TRACK_GENERATION_VERSION;
  state.editorTrack.enableRunoff=true;
  requestEditorRebuild(false);
  saveEditorTrack();
}

export function onEditorNodeChanged(){
  const node=state.editorTrack.nodes[state.editorSelectedNode];
  if(!node)return;
  node.type=document.getElementById('editorNodeType').value;
  if(node.type==='start-finish') state.editorTrack.nodes.forEach((n,i)=>{
    if(i!==state.editorSelectedNode&&n.type==='start-finish') n.type='no-auto';
  });
  node.steepness=+document.getElementById('editorSteepness').value||40;
  node.gravelPitSize=Math.max(0,Math.min(400,+document.getElementById('editorNodeGravelPitSize').value||100));
  node.gravelLeft=Math.max(0,Math.min(20,+document.getElementById('editorNodeGravelLeft').value||0));
  node.gravelRight=Math.max(0,Math.min(20,+document.getElementById('editorNodeGravelRight').value||0));
  syncSelectedNodeUI();
  requestEditorRebuild(false);
}

export function createNewEditorTrack(){
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

export function duplicateEditorTrack(){
  if(!state.editorTrack) return;
  const clone=deepClone(state.editorTrack);
  clone.id=uniqueTrackId();
  clone.source=clone.id;
  clone.builtin=false;
  clone.trackGenerationVersion=LATEST_TRACK_GENERATION_VERSION;
  clone.enableRunoff=true;
  state.editorTrack=clone;
  state.editorSelectedNode=0;
  state.editorSelectedAsset=-1;
  requestEditorRebuild(true);
  notify('TRACK DUPLICATED');
  populateEditorUI();
}

export function addEditorNode(){ setEditorNodeCount((state.editorTrack.nodes||[]).length+1); }
export function insertEditorNodeAfter(){ addEditorNode(); }
export function deleteEditorNode(){ setEditorNodeCount((state.editorTrack.nodes||[]).length-1); }

export function deleteSelectedEditorAsset(){
  if(state.editorSelectedAsset<0) return;
  state.editorTrack.assets.splice(state.editorSelectedAsset,1);
  state.editorSelectedAsset=-1;
  requestEditorRebuild(false);
}

export function resetEditorTrack(){
  state.editorTrack=makeEditableTrackFromGameTrack(getTrackById(state.editorTrack.source||state.editorTrack.id)||TRACKS[0]);
  state.editorSelectedNode=0;
  state.editorSelectedAsset=-1;
  populateEditorUI();
}

export async function saveEditorTrack(){
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

export function deleteEditorTrack(){
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

export function requestEditorRebuild(resetCam){
  state.editorNeedsRebuild=true;
  if(resetCam) resetEditorCameraToTrack();
}

export function editorRebuildScene(resetCam){
  state.trkData=editorTrackToGameTrack();
  buildTrack(state.trkData);
  setupLights();
  state.activeCam=camEditor;
  state.editorLastRebuild=performance.now();
  state.editorNeedsRebuild=false;
  if(resetCam) resetEditorCameraToTrack();
}

export function editorCanPlaceAssetAt(x,z){
  return canPlaceDecorAsset(editorTrackToGameTrack(),x,z,{exclusionPad:3,startBuffer:28});
}

export function drawEditorCanvas(){
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
    }else if(a.type==='park'){
      ctx.fillRect(p.x-10,p.y-10,20,20);
      ctx.strokeRect(p.x-10,p.y-10,20,20);
    }else{
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

export function bindEditorAssetPalette(){
  document.querySelectorAll('#editorAssetPalette .assetChip').forEach(el=>{
    if(el.dataset.bound) return;
    el.dataset.bound='1';
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',el.dataset.asset);
      setEditorBrushAsset(el.dataset.asset);
    });
    el.addEventListener('click',()=>setEditorBrushAsset(el.dataset.asset));
  });
}

export function bindEditorCanvas(){
  const canvas=document.getElementById('trackEditorCanvas');
  if(!canvas||canvas.dataset.bound) return;
  canvas.dataset.bound='1';
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  function nearestOverlayObject(e){
    const r=canvas.getBoundingClientRect();
    const lx=(e.clientX-r.left)*(canvas.width/r.width),ly=(e.clientY-r.top)*(canvas.height/r.height);
    let best=null,bestD=1e9;
    state.editorTrack.assets.forEach((a,i)=>{
      const q=editorWorldToOverlay(new THREE.Vector3(a.x,3,a.z),canvas);
      if(!q) return;
      const d=(q.x-lx)*(q.x-lx)+(q.y-ly)*(q.y-ly);
      if(d<bestD&&d<500){ best={kind:'asset',index:i}; bestD=d; }
    });
    state.editorTrack.nodes.forEach((n,i)=>{
      const q=editorWorldToOverlay(new THREE.Vector3(n.x,1,n.z),canvas);
      if(!q) return;
      const d=(q.x-lx)*(q.x-lx)+(q.y-ly)*(q.y-ly);
      if(d<bestD&&d<550){ best={kind:'node',index:i}; bestD=d; }
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
    if(e.button===2||e.button===1){ editorMouse.mode='orbit'; return; }
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
      const dx=e.clientX-editorMouse.lastX,dy=e.clientY-editorMouse.lastY;
      editorCam.yaw-=dx*0.006;
      editorCam.pitch=Math.max(0.72,Math.min(1.45,editorCam.pitch-dy*0.004));
      editorMouse.lastX=e.clientX;
      editorMouse.lastY=e.clientY;
      return;
    }
    if(editorMouse.mode==='pan'){
      const dx=e.clientX-editorMouse.lastX,dy=e.clientY-editorMouse.lastY;
      const factor=editorCam.distance*0.0016;
      const rightYaw=editorCam.yaw+Math.PI/2;
      editorCam.target.x+=(-Math.sin(rightYaw)*dx+-Math.sin(editorCam.yaw)*dy)*factor;
      editorCam.target.z+=(-Math.cos(rightYaw)*dx+-Math.cos(editorCam.yaw)*dy)*factor;
      editorMouse.lastX=e.clientX;
      editorMouse.lastY=e.clientY;
      return;
    }
    if(!state.editorDrag) return;
    const p=editorClientToGround(e.clientX,e.clientY);
    if(!p) return;
    const snap=(e.shiftKey||state.editorTrack.streetGrid)?(state.editorTrack.gridSize||70):0;
    if(snap){ p.x=Math.round(p.x/snap)*snap; p.z=Math.round(p.z/snap)*snap; }
    if(state.editorDrag.kind==='node'){
      state.editorTrack.nodes[state.editorDrag.index].x=p.x;
      state.editorTrack.nodes[state.editorDrag.index].z=p.z;
    }else if(state.editorDrag.kind==='asset'&&editorCanPlaceAssetAt(p.x,p.z)){
      state.editorTrack.assets[state.editorDrag.index].x=p.x;
      state.editorTrack.assets[state.editorDrag.index].z=p.z;
    }else if(state.editorBrushEnabled&&state.editorDrag.kind==='brush'&&paintEditorAssetsAt(p.x,p.z)){
      // Brush paints continuously while Alt+dragging.
    }
    requestEditorRebuild(false);
  });
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    editorCam.distance=Math.max(70,Math.min(700,editorCam.distance*(1+Math.sign(e.deltaY)*0.08)));
  },{passive:false});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>canvas.addEventListener(ev,()=>{
    state.editorDrag=null;
    editorMouse.mode=null;
  }));
}

export function showTrackEditor(showMainFn){
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
