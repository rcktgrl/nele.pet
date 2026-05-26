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
  getAllTracks, loadEditorTracks, syncEditorTracksFromCloud,
  loadTracksFromFolder, makeEditableTrackFromGameTrack
} from './editor.js';
import { VsNetwork, generateRoomCode } from './vs-network.js';

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
//  MENU SCREENS
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
  const epbtn=document.getElementById('editorPreviewBtn'); if(epbtn)epbtn.textContent='3D PREVIEW';
  stopAudio(); stopMusic();
  disposeCarCardPreviews();
  clearGhostVisual();
  if(audioReady)startMusic();
  for(const c of state.allCars)scene.remove(c.mesh);
  state.allCars=[]; state.aiCars=[]; state.pCar=null;
  state.vsMode=false;
  // Clean up VS network if we have one
  if(state.vsNetwork){ state.vsNetwork.leave().catch(()=>{}); state.vsNetwork=null; }
}

// ═══════════════════════════════════════════════════════
//  CAR SELECTION
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
  const scene=state.carCardPreviewScene;
  const camera=state.carCardPreviewCamera;
  for(const item of state.carCardPreviews){
    if(!item.host.isConnected) continue;
    const rect=item.host.getBoundingClientRect();
    if(rect.width<2||rect.height<2) continue;
    item.spinSpeed+=(((item.selected||item.hovered)?1.9:0)-item.spinSpeed)*Math.min(1,dt*8);
    item.angle+=item.spinSpeed*dt;
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

function buildTrackCards(tracks, container, nextBtnId){
  const COLORS=['#4488ff','#44cc66','#ffaa22','#ff4488','#22ddaa','#dd66ff','#66bbff'];
  container.innerHTML='';
  if(!tracks.length){
    const msg=document.createElement('p'); msg.textContent='No tracks found.'; msg.style.color='#778';
    container.appendChild(msg); return;
  }
  tracks.forEach((t,i)=>{
    const card=document.createElement('div'); card.className='tcard'+(String(state.selTrk)===String(t.id)?' sel':'');
    const canvas=document.createElement('canvas'); canvas.width=280; canvas.height=230;
    canvas.style.borderRadius='6px';
    const h3=document.createElement('h3'); h3.textContent=t.name;
    const p=document.createElement('p'); p.textContent=t.desc+' · '+t.rw+'m wide'+(t.builtin?'':' · Custom');
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
  document.getElementById('btnNxt').style.display='';
  document.getElementById('btnNxt').disabled=(state.selTrk==null);
  const tracks=state.folderTracks;
  await buildTrackCards(tracks,document.getElementById('trkCards'),'btnNxt');
}

export function showDiffSel(){
  if(state.selTrk==null){ showTrkSel(); return; }
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sDiff').style.display='flex';
  state.gState='diffSel';

  // Sync difficulty cards with state
  document.querySelectorAll('#diffCards .diffCard').forEach(card=>{
    card.classList.toggle('sel', card.dataset.diff===state.aiDifficulty);
    card.onclick=()=>{
      document.querySelectorAll('#diffCards .diffCard').forEach(c=>c.classList.remove('sel'));
      card.classList.add('sel');
      state.aiDifficulty=card.dataset.diff;
    };
  });

  // Sync opponent mode cards with state
  document.querySelectorAll('#oppCards .diffCard').forEach(card=>{
    card.classList.toggle('sel', card.dataset.opp===state.opponentMode);
    card.onclick=()=>{
      document.querySelectorAll('#oppCards .diffCard').forEach(c=>c.classList.remove('sel'));
      card.classList.add('sel');
      state.opponentMode=card.dataset.opp;
    };
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

let _vsCarPreviews = [];

function _disposeVsCarPreviews(){
  if(state.carCardPreviewRaf){ cancelAnimationFrame(state.carCardPreviewRaf); state.carCardPreviewRaf=0; }
  state.carCardPreviews.forEach(item=>{ if(item.renderer) item.renderer.dispose(); });
  state.carCardPreviews.length=0;
  _vsCarPreviews=[];
}

/** Build the compact car-select row inside the VS lobby */
function _buildVsCarRow(container, onSelect){
  _disposeVsCarPreviews();
  ensureCarCardPreviewRenderer();
  container.innerHTML='';
  if(state.selCar==null) state.selCar=0;

  CARS.forEach((c,i)=>{
    const d=document.createElement('div');
    d.className='vsCarChip'+(state.selCar===i?' sel':'');
    d.title=c.name;
    const cvs=document.createElement('canvas');
    cvs.className='vsCarCanvas';
    const nameEl=document.createElement('span');
    nameEl.textContent=c.name;
    d.appendChild(cvs); d.appendChild(nameEl);

    const visual=createCarVisual(c);
    visual.mesh.scale.setScalar(0.72);
    visual.mesh.rotation.x=-0.1;
    visual.mesh.position.set(0,-0.2,0);
    const preview={host:d,canvas:cvs,model:visual.mesh,hovered:false,selected:state.selCar===i,angle:0,spinSpeed:0,baseYaw:-0.55,
      renderer:new THREE.WebGLRenderer({canvas:cvs,alpha:true,antialias:true,powerPreference:'low-power'})};
    preview.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
    preview.renderer.outputColorSpace=THREE.SRGBColorSpace;
    state.carCardPreviews.push(preview);
    _vsCarPreviews.push(preview);

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

/** Rebuild the player list section of the VS lobby */
function _renderVsPlayerList(){
  const listEl=document.getElementById('vsPlayerList');
  if(!listEl) return;
  const players=state.vsLobbyPlayers||[];
  listEl.innerHTML='';
  for(const p of players){
    const row=document.createElement('div');
    row.className='vsPlayerRow';
    const dot=document.createElement('span'); dot.className='vsPlayerDot';
    dot.style.background=p.isHost?'#fa4':'#4af';
    const nm=document.createElement('span'); nm.className='vsPlayerName';
    nm.textContent=(p.name||'Player')+(p.isHost?' 👑':'');
    row.appendChild(dot); row.appendChild(nm);
    listEl.appendChild(row);
  }
  // Waiting slot
  if(players.length<2){
    const row=document.createElement('div'); row.className='vsPlayerRow vsWaiting';
    row.textContent='Waiting for opponent...';
    listEl.appendChild(row);
  }
}

export async function showVsLobby(){
  // Clean up any previous VS network
  if(state.vsNetwork){ await state.vsNetwork.leave().catch(()=>{}); state.vsNetwork=null; }
  state.vsMode=false;
  state.vsLobbyPlayers=[];

  await loadTracksFromFolder().catch(()=>{});

  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  document.getElementById('sVsLobby').style.display='flex';
  state.gState='vsLobby';
  updateTouchControlsVisibility(state.gState);

  // Reset to join/create panel
  document.getElementById('vsJoinPanel').style.display='flex';
  document.getElementById('vsRoomPanel').style.display='none';
  document.getElementById('vsStatusMsg').textContent='';
  document.getElementById('vsNameInput').value=state.vsMyName||'';
}

/** Called when CREATE ROOM is clicked */
export async function vsCreateRoom(){
  const nameInput=document.getElementById('vsNameInput');
  const name=(nameInput.value||'').trim()||'Player 1';
  state.vsMyName=name;

  const code=generateRoomCode();
  state.vsRoomCode=code;
  state.vsIsHost=true;
  state.selCar=state.selCar??0;

  const net=new VsNetwork();
  state.vsNetwork=net;

  _setVsStatus('Connecting…');
  try{
    await net.joinRoom(code, name, true);
  }catch(e){
    _setVsStatus('❌ Failed to connect: '+e.message);
    return;
  }

  _attachVsNetworkHandlers(net);
  _showVsRoomPanel(true);
}

/** Called when JOIN ROOM is clicked */
export async function vsJoinRoom(){
  const nameInput=document.getElementById('vsNameInput');
  const codeInput=document.getElementById('vsCodeInput');
  const name=(nameInput.value||'').trim()||'Player 2';
  const code=(codeInput.value||'').trim().toUpperCase();
  if(!code||code.length!==4){ _setVsStatus('❌ Enter a 4-character room code'); return; }

  state.vsMyName=name;
  state.vsRoomCode=code;
  state.vsIsHost=false;
  state.selCar=state.selCar??0;

  const net=new VsNetwork();
  state.vsNetwork=net;

  _setVsStatus('Joining room…');
  try{
    await net.joinRoom(code, name, false);
  }catch(e){
    _setVsStatus('❌ Failed to join: '+e.message);
    return;
  }

  _attachVsNetworkHandlers(net);
  _showVsRoomPanel(false);

  // Guest: send ready immediately with selected car
  net.sendGuestReady(state.selCar??0, name);
}

function _setVsStatus(msg){
  const el=document.getElementById('vsStatusMsg');
  if(el) el.textContent=msg;
}

function _showVsRoomPanel(isHost){
  document.getElementById('vsJoinPanel').style.display='none';
  document.getElementById('vsRoomPanel').style.display='flex';

  document.getElementById('vsRoomCodeDisplay').textContent=state.vsRoomCode;

  // Host controls visibility
  const hostControls=document.getElementById('vsHostControls');
  const guestControls=document.getElementById('vsGuestControls');
  if(hostControls) hostControls.style.display=isHost?'flex':'none';
  if(guestControls) guestControls.style.display=isHost?'none':'flex';

  _renderVsPlayerList();

  if(isHost){
    // Host: build track selector
    _buildVsTrkCards();
    // Host: build car selector
    const carRow=document.getElementById('vsHostCarRow');
    if(carRow) _buildVsCarRow(carRow, (carIdx)=>{
      // Broadcast config whenever host changes car
      if(state.vsNetwork&&state.selTrk!=null){
        state.vsNetwork.sendGameConfig(state.selTrk, carIdx, state.vsMyName);
      }
    });
  } else {
    // Guest: just show car selector
    const carRow=document.getElementById('vsGuestCarRow');
    if(carRow) _buildVsCarRow(carRow, (carIdx)=>{
      if(state.vsNetwork){
        state.vsNetwork.sendGuestReady(carIdx, state.vsMyName);
      }
    });
  }
}

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
    drawTrackPreview(cvs, t, t.previewColor||COLORS[i%COLORS.length]);
    card.onclick=()=>{
      container.querySelectorAll('.vsTrackCard').forEach(x=>x.classList.remove('sel'));
      card.classList.add('sel'); state.selTrk=t.id;
      // Broadcast updated config to guest
      if(state.vsNetwork){
        state.vsNetwork.sendGameConfig(state.selTrk, state.selCar??0, state.vsMyName);
      }
      const startBtn=document.getElementById('vsStartBtn');
      if(startBtn) startBtn.disabled=false;
    };
    container.appendChild(card);
  });
}

function _attachVsNetworkHandlers(net){
  net.onPresenceUpdate=(players)=>{
    state.vsLobbyPlayers=players;
    _renderVsPlayerList();
  };

  net.onPlayerLeft=({id})=>{
    if(state.gState==='vsLobby'){
      _setVsStatus('⚠️ Opponent left the lobby');
    } else if(state.gState==='racing'||state.gState==='cooldown'){
      // notify in-race — use the notify module
      import('./notify.js').then(m=>m.notify('Opponent disconnected'));
    }
  };

  net.onGameConfig=({trackId, carIdx, hostName})=>{
    // Guest receives host config
    state.selTrk=trackId;
    state.vsOpponentCarIdx=carIdx;
    state.vsOpponentName=hostName||'Host';
    _setVsStatus('Track set by host. Pick your car and wait…');
    // Re-send guest ready with our current car
    net.sendGuestReady(state.selCar??0, state.vsMyName);
  };

  net.onGuestReady=({carIdx, guestName})=>{
    // Host receives guest config
    state.vsOpponentCarIdx=carIdx;
    state.vsOpponentName=guestName||'Guest';
    _renderVsPlayerList();
    _setVsStatus('✅ Opponent ready! You can start the race.');
    const startBtn=document.getElementById('vsStartBtn');
    if(startBtn&&state.selTrk!=null) startBtn.disabled=false;
  };

  net.onGameStart=()=>{
    // Guest receives start signal
    _launchVsRace();
  };

  net.onPosUpdate=(data)=>{
    // In-race: store latest opponent state for interpolation
    state.vsOpponentState=data;
  };

  net.onPlayerFinished=({id, finTime})=>{
    if(id!==net.myId){
      state.vsOpponentFinished=true;
      state.vsOpponentFinTime=finTime;
    }
  };
}

function _launchVsRace(){
  state.vsMode=true;
  _disposeVsCarPreviews();
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  import('./race.js').then(m=>m.startRace());
}

export function vsStartRace(){
  if(!state.vsNetwork) return;
  if(state.selTrk==null){ _setVsStatus('❌ Pick a track first'); return; }
  // Send final config then start
  state.vsNetwork.sendGameConfig(state.selTrk, state.selCar??0, state.vsMyName);
  state.vsNetwork.sendGameStart();
  _launchVsRace();
}

export function vsLeaveLobby(){
  if(state.vsNetwork){ state.vsNetwork.leave().catch(()=>{}); state.vsNetwork=null; }
  state.vsMode=false;
  _disposeVsCarPreviews();
  showMain();
}
