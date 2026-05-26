'use strict';
import { CARS } from './data/cars.js';
import { THREE } from './three.js';
import { state, scene, dc } from './state.js';
import { createCarVisual } from './car-model.js';
import { stopAudio, stopMusic, startMusic, audioReady } from './audio.js';
import { updateTouchControlsVisibility, releaseAllTouchControls } from './touch-controls.js';
import {
  normaliseTrackId, updateTrackCardBestTime,
  loadTrackLeaderboard, openTrackLeaderboardModal
} from './leaderboard.js';
import { clearGhostVisual } from './ghost.js';
import {
  loadEditorTracks, syncEditorTracksFromCloud,
  loadTracksFromFolder
} from './editor.js';
import { VsNetwork, generateRoomCode, BOT_NAMES } from './vs-network.js';
import { getArcadeUser } from './user.js';

// ═══════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════
export function showSettings(){
  document.getElementById('settingsModal').style.display='block';
}
export function closeSettings(){
  document.getElementById('settingsModal').style.display='none';
}

// ═══════════════════════════════════════════════════════
//  SHARED MENU HELPERS
// ═══════════════════════════════════════════════════════
export function showIntro(){
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

export function showMain(){
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
  stopAudio(); stopMusic();
  disposeCarCardPreviews();
  clearGhostVisual();
  if(audioReady) startMusic();
  for(const c of state.allCars) scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.pCar=null;
  state.vsMode=false;
  if(state.vsNetwork){ state.vsNetwork.leave().catch(()=>{}); state.vsNetwork=null; }
}

// ═══════════════════════════════════════════════════════
//  CAR CARD PREVIEWS
// ═══════════════════════════════════════════════════════
export function disposeCarCardPreviews(){
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
  if((state.gState!=='carSel'&&state.gState!=='vsLobby')||!state.carCardPreviews.length){ state.carCardPreviewRaf=0; return; }
  const now=ts||performance.now();
  const dt=Math.min(0.05,Math.max(0.001,(now-state.carCardPreviewLastTime||16)/1000));
  state.carCardPreviewLastTime=now;
  const sc=state.carCardPreviewScene;
  const camera=state.carCardPreviewCamera;
  for(const item of state.carCardPreviews){
    if(!item.host.isConnected) continue;
    const rect=item.host.getBoundingClientRect();
    if(rect.width<2||rect.height<2) continue;
    item.spinSpeed+=(((item.selected||item.hovered)?1.9:0)-item.spinSpeed)*Math.min(1,dt*8);
    item.angle+=item.spinSpeed*dt;
    item.model.rotation.y=item.baseYaw+item.angle;
    const w=Math.max(64,Math.floor(rect.width));
    const h=Math.max(48,Math.floor(rect.height));
    if(item.canvas.width!==w||item.canvas.height!==h){ item.canvas.width=w; item.canvas.height=h; }
    item.renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
    sc.add(item.model);
    item.renderer.render(sc,camera);
    sc.remove(item.model);
  }
  state.carCardPreviewRaf=requestAnimationFrame(renderCarCardPreviews);
}

function startCarCardPreviews(){
  if(state.carCardPreviewRaf||!state.carCardPreviews.length) return;
  state.carCardPreviewLastTime=performance.now();
  state.carCardPreviewRaf=requestAnimationFrame(renderCarCardPreviews);
}

// ═══════════════════════════════════════════════════════
//  CAR SELECTION (full-screen)
// ═══════════════════════════════════════════════════════
export function showCarSel(){
  if(state.selTrk==null){ showTrkSel(); return; }
  if(state.aiDifficulty==null){ showDiffSel(); return; }
  const speedMinKph=100,speedMaxKph=300,accelMin=6,accelMax=12;
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
    d.innerHTML=`<canvas class="carCardCanvas" aria-hidden="true"></canvas>
      <h3>${c.name}</h3><p>${c.desc}</p>
      <div class="stat"><span class="sl">SPEED</span><div class="st"><div class="sf" style="width:${pctForRange(topSpeedKph,speedMinKph,speedMaxKph)}%"></div></div><span class="sv">${topSpeedKph}</span></div>
      <div class="stat"><span class="sl">ACCEL</span><div class="st"><div class="sf" style="width:${pctForRange(c.accel,accelMin,accelMax)}%"></div></div><span class="sv">${c.accel.toFixed(1)}</span></div>
      <div class="stat"><span class="sl">GRIP</span><div class="st"><div class="sf" style="width:${Math.round(c.hdl*100)}%"></div></div><span class="sv">${Math.round(c.hdl*100)}%</span></div>
      <div class="stat"><span class="sl">BRAKES</span><div class="st"><div class="sf" style="width:${Math.min(100,Math.round(c.brake*4))}%"></div></div><span class="sv">${c.brake}</span></div>`;
    const canvas=d.querySelector('.carCardCanvas');
    const visual=createCarVisual(c);
    visual.mesh.scale.setScalar(0.72);
    visual.mesh.rotation.x=-0.1;
    visual.mesh.position.set(0,-0.2,0);
    const preview={host:d,canvas,model:visual.mesh,hovered:false,selected:state.selCar===i,angle:0,spinSpeed:0,baseYaw:-0.55,
      renderer:new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'})};
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

// ═══════════════════════════════════════════════════════
//  TRACK SELECTION
// ═══════════════════════════════════════════════════════
export function drawTrackPreview(canvas,track,color){
  const W=canvas.width,H=canvas.height,ctx=canvas.getContext('2d');
  const pad=22;
  const xs=track.wp.map(p=>p[0]),zs=track.wp.map(p=>p[2]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const scale=Math.min((W-pad*2)/(maxX-minX||1),(H-pad*2)/(maxZ-minZ||1));
  const offX=(W-(maxX-minX)*scale)/2,offZ=(H-(maxZ-minZ)*scale)/2;
  function pt(x,z){return[(x-minX)*scale+offX,(z-minZ)*scale+offZ];}
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
  ctx.strokeStyle='#161622'; ctx.lineWidth=1;
  for(let gx=Math.ceil(minX/50)*50;gx<=maxX;gx+=50){const[sx]=pt(gx,minZ);ctx.beginPath();ctx.moveTo(sx,0);ctx.lineTo(sx,H);ctx.stroke();}
  for(let gz=Math.ceil(minZ/50)*50;gz<=maxZ;gz+=50){const[,sz]=pt(minX,gz);ctx.beginPath();ctx.moveTo(0,sz);ctx.lineTo(W,sz);ctx.stroke();}
  const curve=catmull(track.wp,12);
  ctx.strokeStyle=color+'2a'; ctx.lineWidth=track.rw*scale*1.8; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.beginPath(); curve.forEach(([x,z],i)=>{const[px,pz]=pt(x,z);i?ctx.lineTo(px,pz):ctx.moveTo(px,pz);}); ctx.stroke();
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.setLineDash([]);
  ctx.beginPath(); curve.forEach(([x,z],i)=>{const[px,pz]=pt(x,z);i?ctx.lineTo(px,pz):ctx.moveTo(px,pz);}); ctx.stroke();
  ctx.fillStyle=color+'cc';
  const step=Math.floor(curve.length/8);
  for(let i=step;i<curve.length-1;i+=step){
    const[x1,z1]=pt(curve[i][0],curve[i][2]),[x2,z2]=pt(curve[i+1][0],curve[i+1][2]);
    const dx=x2-x1,dz=z2-z1,len=Math.sqrt(dx*dx+dz*dz)||1,nx=dx/len,nz=dz/len;
    ctx.beginPath();ctx.moveTo(x1+nz*4,z1-nx*4);ctx.lineTo(x1+nx*9,z1+nz*9);ctx.lineTo(x1-nz*4,z1+nx*4);ctx.closePath();ctx.fill();
  }
  const[sfx,sfz]=pt(track.wp[0][0],track.wp[0][2]);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2.5; ctx.setLineDash([3,2]);
  ctx.beginPath();ctx.moveTo(sfx-10,sfz);ctx.lineTo(sfx+10,sfz);ctx.stroke();ctx.setLineDash([]);
  ctx.font='bold 9px Orbitron,monospace'; ctx.fillStyle='#fff';
  ctx.fillText('S/F',sfx+12,sfz+4);
}

function buildTrackCards(tracks,container,nextBtnId){
  const COLORS=['#4488ff','#44cc66','#ffaa22','#ff4488','#22ddaa','#dd66ff','#66bbff'];
  container.innerHTML='';
  if(!tracks.length){
    const msg=document.createElement('p'); msg.textContent='No tracks found.'; msg.style.color='#778';
    container.appendChild(msg); return;
  }
  tracks.forEach((t,i)=>{
    const card=document.createElement('div'); card.className='tcard'+(String(state.selTrk)===String(t.id)?' sel':'');
    const canvas=document.createElement('canvas'); canvas.width=280; canvas.height=230; canvas.style.borderRadius='6px';
    const h3=document.createElement('h3'); h3.textContent=t.name;
    const p=document.createElement('p'); p.textContent=t.desc+' · '+t.rw+'m wide'+(t.builtin?'':' · Custom');
    const best=document.createElement('p'); best.className='trackBest'; best.dataset.trackBest=normaliseTrackId(t.id,t.name); best.textContent='Best: loading...';
    const lb=document.createElement('button'); lb.className='btn btn-s trackLbBtn'; lb.type='button'; lb.textContent='LEADERBOARD';
    lb.addEventListener('click',async(e)=>{ e.stopPropagation(); await openTrackLeaderboardModal(t.id,t.name); });
    card.appendChild(canvas); card.appendChild(h3); card.appendChild(p); card.appendChild(best); card.appendChild(lb);
    card.onclick=()=>{
      container.querySelectorAll('.tcard').forEach(x=>x.classList.remove('sel'));
      card.classList.add('sel'); state.selTrk=t.id; document.getElementById(nextBtnId).disabled=false;
    };
    container.appendChild(card);
    drawTrackPreview(canvas,t,t.previewColor||COLORS[i%COLORS.length]);
  });
  return Promise.all(tracks.map(async(t)=>{
    await loadTrackLeaderboard(t.id,{limit:1,trackName:t.name});
    updateTrackCardBestTime(t.id,t.name);
  }));
}

export async function showTrkSel(){
  await loadTracksFromFolder().catch(()=>{});
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sTrk').style.display='flex';
  document.getElementById('btnNxt').disabled=(state.selTrk==null);
  await buildTrackCards(state.folderTracks,document.getElementById('trkCards'),'btnNxt');
}

export function showDiffSel(){
  if(state.selTrk==null){ showTrkSel(); return; }
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sDiff').style.display='flex';
  state.gState='diffSel';
  document.querySelectorAll('#diffCards .diffCard').forEach(card=>{
    card.classList.toggle('sel', card.dataset.diff===state.aiDifficulty);
    card.onclick=()=>{ document.querySelectorAll('#diffCards .diffCard').forEach(c=>c.classList.remove('sel')); card.classList.add('sel'); state.aiDifficulty=card.dataset.diff; };
  });
  document.querySelectorAll('#oppCards .diffCard').forEach(card=>{
    card.classList.toggle('sel', card.dataset.opp===state.opponentMode);
    card.onclick=()=>{ document.querySelectorAll('#oppCards .diffCard').forEach(c=>c.classList.remove('sel')); card.classList.add('sel'); state.opponentMode=card.dataset.opp; };
  });
}

export async function showOnlineTrkSel(){
  loadEditorTracks();
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sOnlineTrk').style.display='flex';
  document.getElementById('btnOnlineNxt').disabled=true;
  const loadingMsg=document.createElement('p'); loadingMsg.textContent='Loading online tracks...'; loadingMsg.style.color='#778';
  const container=document.getElementById('onlineTrkCards'); container.innerHTML=''; container.appendChild(loadingMsg);
  await syncEditorTracksFromCloud().catch(()=>{});
  document.getElementById('btnOnlineNxt').disabled=(state.selTrk==null||!state.editorTracks.some(t=>String(t.id)===String(state.selTrk)));
  await buildTrackCards(state.editorTracks,container,'btnOnlineNxt');
}

// ═══════════════════════════════════════════════════════
//  VS MODE LOBBY
// ═══════════════════════════════════════════════════════

// PLAYER COLORS matching Bomber's 4-player palette
const VS_COLORS=['#ff9a3c','#4af','#f44','#4f4'];

/** All players (real + AI) in slot order */
function _allVsSlots(){
  return [...state.vsLobbyPlayers, ...state.vsLobbyAIs];
}

/** Build and rebuild the 4-slot player grid */
function _renderVsSlots(){
  const all=_allVsSlots();
  const isHost=state.vsIsHost;
  const net=state.vsNetwork;

  for(let i=0;i<4;i++){
    const slotEl=document.getElementById(`vsSlot${i}`);
    if(!slotEl) continue;
    slotEl.innerHTML='';
    slotEl.className='vsSlot';

    if(i<all.length){
      const p=all[i];
      slotEl.classList.add('vsSlot-filled');
      slotEl.style.setProperty('--sc',VS_COLORS[i]);

      const dot=document.createElement('span'); dot.className='vsSlotDot';
      const nm=document.createElement('span'); nm.className='vsSlotName';
      nm.textContent=(p.isAI?'🤖 ':'')+p.name+(p.isHost?' 👑':'');

      slotEl.appendChild(dot); slotEl.appendChild(nm);

      if(isHost){
        if(p.isAI){
          const rm=document.createElement('button'); rm.className='vsSlotRemove'; rm.textContent='✕';
          rm.title='Remove bot'; rm.onclick=e=>{ e.stopPropagation(); _vsRemoveAI(p.id); };
          slotEl.appendChild(rm);
        } else if(p.id!==net?.myId){
          const kick=document.createElement('button'); kick.className='vsSlotRemove'; kick.textContent='✕ Kick';
          kick.title='Kick player'; kick.onclick=e=>{ e.stopPropagation(); _vsKickPlayer(p.id); };
          slotEl.appendChild(kick);
        }
      }
    } else if(isHost&&all.length<4){
      slotEl.classList.add('vsSlot-empty');
      const btn=document.createElement('button'); btn.className='vsAddBotBtn'; btn.textContent='+ Add AI';
      btn.onclick=_vsAddAI;
      slotEl.appendChild(btn);
    } else {
      slotEl.classList.add('vsSlot-passive');
      const dash=document.createElement('span'); dash.className='vsSlotEmpty'; dash.textContent='—';
      slotEl.appendChild(dash);
    }
  }

  // Start button / status
  const total=all.length;
  const canStart=isHost&&total>=2;
  const startBtn=document.getElementById('vsStartBtn');
  const statusEl=document.getElementById('vsStatusMsg');
  if(startBtn) startBtn.disabled=!canStart||state.selTrk==null;
  if(statusEl){
    if(isHost){
      if(state.selTrk==null) statusEl.textContent='Pick a track first.';
      else if(total<2)       statusEl.textContent='Add 1 more player or AI to start.';
      else                   statusEl.textContent=`${total} player${total>1?'s':''} ready!`;
    } else {
      statusEl.textContent='Waiting for host to start the race…';
    }
  }
}

/** Build compact inline car selector (used inside the lobby) */
function _buildVsCarRow(containerId, onSelect){
  const container=document.getElementById(containerId);
  if(!container) return;
  // Clean up old previews for this container
  const old=state.carCardPreviews.filter(p=>p._vsContainer===containerId);
  old.forEach(p=>{ p.renderer.dispose(); });
  state.carCardPreviews=state.carCardPreviews.filter(p=>p._vsContainer!==containerId);
  if(state.carCardPreviewRaf){ cancelAnimationFrame(state.carCardPreviewRaf); state.carCardPreviewRaf=0; }

  ensureCarCardPreviewRenderer();
  container.innerHTML='';
  if(state.selCar==null) state.selCar=0;

  CARS.forEach((c,i)=>{
    const d=document.createElement('div');
    d.className='vsCarChip'+(state.selCar===i?' sel':'');
    d.title=c.name;
    const cvs=document.createElement('canvas'); cvs.className='vsCarCanvas';
    const nm=document.createElement('span'); nm.textContent=c.name;
    d.appendChild(cvs); d.appendChild(nm);

    const visual=createCarVisual(c);
    visual.mesh.scale.setScalar(0.72);
    visual.mesh.rotation.x=-0.1;
    visual.mesh.position.set(0,-0.2,0);
    const preview={host:d,canvas:cvs,model:visual.mesh,hovered:false,selected:state.selCar===i,
      angle:0,spinSpeed:0,baseYaw:-0.55,_vsContainer:containerId,
      renderer:new THREE.WebGLRenderer({canvas:cvs,alpha:true,antialias:true,powerPreference:'low-power'})};
    preview.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
    preview.renderer.outputColorSpace=THREE.SRGBColorSpace;
    state.carCardPreviews.push(preview);

    d.onmouseenter=()=>{ preview.hovered=true; startCarCardPreviews(); };
    d.onmouseleave=()=>{ preview.hovered=false; };
    d.onclick=()=>{
      container.querySelectorAll('.vsCarChip').forEach(x=>x.classList.remove('sel'));
      d.classList.add('sel'); state.selCar=i;
      state.carCardPreviews.forEach(item=>{ item.selected=item.host===d; });
      startCarCardPreviews();
      onSelect(i);
    };
    container.appendChild(d);
  });
  startCarCardPreviews();
}

/** Build compact track cards inline in the lobby (host only) */
function _buildVsTrkCards(){
  const container=document.getElementById('vsTrackCards');
  if(!container) return;
  const tracks=state.folderTracks||[];
  const COLORS=['#4488ff','#44cc66','#ffaa22','#ff4488','#22ddaa','#dd66ff','#66bbff'];
  container.innerHTML='';
  tracks.forEach((t,i)=>{
    const card=document.createElement('div');
    card.className='vsTrackCard'+(String(state.selTrk)===String(t.id)?' sel':'');
    const cvs=document.createElement('canvas'); cvs.width=160; cvs.height=120;
    const nm=document.createElement('span'); nm.textContent=t.name;
    card.appendChild(cvs); card.appendChild(nm);
    drawTrackPreview(cvs,t,t.previewColor||COLORS[i%COLORS.length]);
    card.onclick=()=>{
      container.querySelectorAll('.vsTrackCard').forEach(x=>x.classList.remove('sel'));
      card.classList.add('sel'); state.selTrk=t.id;
      if(state.vsNetwork) state.vsNetwork.sendGameConfig(state.selTrk,state.selCar??0);
      _renderVsSlots(); // refresh start button / status
    };
    container.appendChild(card);
  });
}

// ── VS lobby actions ──────────────────────────────────────────────────────────

function _vsAddAI(){
  if(_allVsSlots().length>=4) return;
  const usedNames=state.vsLobbyAIs.map(a=>a.name);
  const name=BOT_NAMES.find(n=>!usedNames.includes(n))||`Bot ${state.vsLobbyAIs.length+1}`;
  const ai={id:`ai-${crypto.randomUUID()}`,name,isAI:true,carIdx:Math.floor(Math.random()*CARS.length)};
  state.vsLobbyAIs.push(ai);
  state.vsNetwork?.sendAIUpdate(state.vsLobbyAIs);
  _renderVsSlots();
}

function _vsRemoveAI(id){
  state.vsLobbyAIs=state.vsLobbyAIs.filter(a=>a.id!==id);
  state.vsNetwork?.sendAIUpdate(state.vsLobbyAIs);
  _renderVsSlots();
}

function _vsKickPlayer(targetId){
  state.vsNetwork?.sendPlayerKick(targetId);
  _renderVsSlots();
}

function _vsSetStatus(msg){
  const el=document.getElementById('vsStatusMsg');
  if(el) el.textContent=msg;
}

// ── Show / connect ────────────────────────────────────────────────────────────

export async function showVsLobby(){
  if(state.vsNetwork){ await state.vsNetwork.leave().catch(()=>{}); state.vsNetwork=null; }
  state.vsMode=false;
  state.vsLobbyPlayers=[];
  state.vsLobbyAIs=[];
  state.vsGuestCars={};

  await loadTracksFromFolder().catch(()=>{});

  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  document.getElementById('sVsLobby').style.display='flex';
  state.gState='vsLobby';
  updateTouchControlsVisibility(state.gState);

  document.getElementById('vsJoinPanel').style.display='flex';
  document.getElementById('vsRoomPanel').style.display='none';
  _vsSetStatus('');

  // Show the player's arcade name as a read-only label
  const user=getArcadeUser();
  const nameLbl=document.getElementById('vsMyNameLabel');
  if(nameLbl) nameLbl.textContent=user.name||'Anonymous';

  // Auto-fill room code if ?room=XXXX is in the URL
  const urlRoom=new URLSearchParams(window.location.search).get('room');
  if(urlRoom&&urlRoom.length===4){
    const inp=document.getElementById('vsCodeInput');
    if(inp) inp.value=urlRoom.trim().toUpperCase();
  }
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

function _vsCopyFeedback(msg){
  const el=document.getElementById('vsCopyFeedback');
  if(!el) return;
  el.textContent=msg;
  el.style.opacity='1';
  clearTimeout(el._t);
  el._t=setTimeout(()=>{ el.style.opacity='0'; },1800);
}

export function vsCopyCode(){
  const code=state.vsRoomCode;
  if(!code) return;
  navigator.clipboard.writeText(code).then(()=>{
    const btn=document.getElementById('vsCopyCodeBtn');
    if(btn){ const orig=btn.textContent; btn.textContent='✓'; btn.classList.add('vsCopied');
      setTimeout(()=>{ btn.textContent=orig; btn.classList.remove('vsCopied'); },1600); }
    _vsCopyFeedback('Room code copied!');
  }).catch(()=>_vsCopyFeedback('Could not copy'));
}

export function vsCopyInviteLink(){
  const code=state.vsRoomCode;
  if(!code) return;
  const url=new URL(window.location.href);
  url.searchParams.set('room',code);
  // Strip any hash so it opens cleanly
  url.hash='';
  navigator.clipboard.writeText(url.toString()).then(()=>{
    const btn=document.getElementById('vsCopyInviteBtn');
    if(btn){ const orig=btn.textContent; btn.textContent='✓ COPIED!'; btn.classList.add('vsCopied');
      setTimeout(()=>{ btn.textContent=orig; btn.classList.remove('vsCopied'); },1600); }
    _vsCopyFeedback('Invite link copied!');
  }).catch(()=>_vsCopyFeedback('Could not copy'));
}

export async function vsCreateRoom(){
  const user=getArcadeUser();
  const name=user.name||'Anonymous';

  const code=generateRoomCode();
  state.vsRoomCode=code;
  state.vsIsHost=true;
  state.vsLobbyAIs=[];
  if(state.selCar==null) state.selCar=0;

  const net=new VsNetwork();
  state.vsNetwork=net;
  state.vsMyId=net.myId;
  // Pre-seed our own slot so the grid isn't empty while we wait for presence sync
  state.vsLobbyPlayers=[{id:net.myId, name, isHost:true}];
  // Attach handlers BEFORE joinRoom so the initial presence 'sync' that fires
  // inside joinRoom (while track() is being awaited) is handled correctly.
  _attachVsHandlers(net, true);

  _vsSetStatus('Connecting…');
  try{ await net.joinRoom(code, name, true); }
  catch(e){ _vsSetStatus('❌ Failed: '+e.message); return; }

  // Belt-and-suspenders: replay snapshot in case presenceState was populated
  // during joinRoom but onPresenceUpdate fired before track() completed.
  const snapHost=net.getPresencePlayers();
  if(snapHost.length) net.onPresenceUpdate(snapHost);
  _showVsRoomPanel(true);
}

export async function vsJoinRoom(){
  const user=getArcadeUser();
  const name=user.name||'Anonymous';
  const code=(document.getElementById('vsCodeInput')?.value||'').trim().toUpperCase();
  if(!code||code.length!==4){ _vsSetStatus('❌ Enter a 4-letter room code'); return; }

  state.vsRoomCode=code;
  state.vsIsHost=false;
  state.vsLobbyAIs=[];
  if(state.selCar==null) state.selCar=0;

  const net=new VsNetwork();
  state.vsNetwork=net;
  state.vsMyId=net.myId;
  // Pre-seed our own slot so the grid isn't empty while we wait for presence sync
  state.vsLobbyPlayers=[{id:net.myId, name, isHost:false}];
  // Attach handlers BEFORE joinRoom so the initial presence 'sync' that fires
  // inside joinRoom (while track() is being awaited) is handled correctly —
  // this ensures the guest sees the host immediately without needing a second event.
  _attachVsHandlers(net, false);

  _vsSetStatus('Joining…');
  try{ await net.joinRoom(code, name, false); }
  catch(e){ _vsSetStatus('❌ Failed: '+e.message); return; }

  // Belt-and-suspenders: replay snapshot in case presenceState was populated
  // during joinRoom but the 'sync' callback fired before onPresenceUpdate was live.
  const snapGuest=net.getPresencePlayers();
  if(snapGuest.length) net.onPresenceUpdate(snapGuest);
  _showVsRoomPanel(false);

  // Guest announces their car choice
  net.sendGuestReady(state.selCar??0);
}

function _showVsRoomPanel(isHost){
  document.getElementById('vsJoinPanel').style.display='none';
  document.getElementById('vsRoomPanel').style.display='flex';
  document.getElementById('vsRoomCodeDisplay').textContent=state.vsRoomCode;

  document.getElementById('vsHostSection').style.display=isHost?'flex':'none';
  document.getElementById('vsGuestSection').style.display=isHost?'none':'flex';

  _renderVsSlots();

  if(isHost){
    _buildVsTrkCards();
    _buildVsCarRow('vsHostCarRow', carIdx=>{
      if(state.vsNetwork&&state.selTrk!=null) state.vsNetwork.sendGameConfig(state.selTrk,carIdx);
    });
  } else {
    _buildVsCarRow('vsGuestCarRow', carIdx=>{
      state.vsNetwork?.sendGuestReady(carIdx);
    });
  }
}

function _attachVsHandlers(net, isHost){
  net.onPresenceUpdate=(players)=>{
    // Guard: an empty snapshot means Supabase hasn't synced yet — don't wipe
    // the pre-seeded entry.
    if(!players.length) return;
    // Deduplicate by name so a reconnecting player (new UUID, same display name)
    // never gets a second slot.  Last-write-wins: if old + new IDs briefly
    // coexist in presenceState, the newer entry (appended last by Supabase)
    // overwrites the stale one.
    const seen=new Map(); // name → player
    for(const p of players) seen.set(p.name, p);
    // Always put the host in slot 0, then guests in order of arrival
    state.vsLobbyPlayers=[...seen.values()].sort((a,b)=>(b.isHost?1:0)-(a.isHost?1:0));
    _renderVsSlots();
    // When a new guest joins, host re-broadcasts current config
    if(isHost&&state.selTrk!=null){
      net.sendGameConfig(state.selTrk, state.selCar??0);
      net.sendAIUpdate(state.vsLobbyAIs);
    }
  };

  net.onAIUpdate=({aiPlayers})=>{
    // Guest receives AI list update from host
    state.vsLobbyAIs=aiPlayers||[];
    _renderVsSlots();
  };

  net.onGameConfig=({trackId, hostCarIdx})=>{
    // Guest: update to host's selections
    state.selTrk=trackId;
    // Re-send our car selection so host has it
    net.sendGuestReady(state.selCar??0);
    _renderVsSlots();
    _vsSetStatus('Track updated by host. Waiting to start…');
  };

  net.onGuestReady=({id, carIdx})=>{
    // Host: store guest car choice
    state.vsGuestCars[id]=carIdx;
    // Re-sync the presence list now that a guest has announced themselves.
    // This is a fallback for the case where the presence 'join' event was
    // delayed or missed — the guest's sendGuestReady broadcast is always
    // delivered, so we use it as a reliable signal to refresh.
    const fresh=net.getPresencePlayers();
    if(fresh.length) net.onPresenceUpdate(fresh);
    else _renderVsSlots();
    _vsSetStatus('');
  };

  net.onGameStart=({slots, trackId})=>{
    // All clients: launch the race
    _launchVsRace(slots, trackId);
  };

  net.onPosUpdate=(data)=>{
    // In-race: buffer snapshot
    if(data.id&&data.id!==state.vsMyId){
      state.vsCarStates[data.id]=data;
    }
  };

  net.onPlayerFinished=({id, finTime})=>{
    state.vsFinished[id]=finTime;
  };

  net.onPlayerKick=({targetId})=>{
    if(targetId===net.myId){
      _vsSetStatus('You were kicked from the lobby.');
      vsLeaveLobby();
    }
  };
}

function _buildSlots(){
  const net=state.vsNetwork;
  const user=getArcadeUser();
  const presence=state.vsLobbyPlayers;

  // Slot 0 = host, then other real players, then AIs
  const realSlots=presence.map(p=>({
    id:p.id,
    name:p.name||'Player',
    isAI:false,
    carIdx:(p.id===net.myId)?(state.selCar??0):(state.vsGuestCars[p.id]??0)
  }));
  const aiSlots=state.vsLobbyAIs.map(a=>({
    id:a.id,
    name:a.name,
    isAI:true,
    carIdx:a.carIdx??0
  }));
  return [...realSlots,...aiSlots];
}

function _launchVsRace(slots, trackId){
  state.vsMode=true;
  disposeCarCardPreviews();
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  import('./race.js').then(m=>m.initVsRace(slots, trackId));
}

export function vsStartRace(){
  if(!state.vsNetwork) return;
  if(state.selTrk==null){ _vsSetStatus('❌ Pick a track first'); return; }
  if(_allVsSlots().length<2){ _vsSetStatus('❌ Need at least 2 players/AIs'); return; }

  const slots=_buildSlots();
  state.vsNetwork.sendGameConfig(state.selTrk, state.selCar??0);
  state.vsNetwork.sendGameStart(slots, state.selTrk);
  _launchVsRace(slots, state.selTrk);
}

export function vsLeaveLobby(){
  if(state.vsNetwork){ state.vsNetwork.leave().catch(()=>{}); state.vsNetwork=null; }
  state.vsMode=false;
  disposeCarCardPreviews();
  showMain();
}
