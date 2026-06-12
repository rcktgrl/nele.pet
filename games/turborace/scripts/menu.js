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
  loadTracksFromFolder, getAllTracks, hexNumToCss, cssToHexNum
} from './editor.js';
import { syncDriveMapsFromCloud, drawDriveMapPreview } from './freedrive-custommap.js';
import { VsNetwork, generateRoomCode, BOT_NAMES } from './vs-network.js';
import { getArcadeUser } from './user.js';
import { loadTrainedModel, saveTrainedModel, validateTrainedModel } from './ppo-ai.js';
import { notify } from './notify.js';

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
  if(state.fdCleanup) state.fdCleanup();
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
  if((state.gState!=='carSel'&&state.gState!=='vsLobby'&&state.gState!=='fdMenu')||!state.carCardPreviews.length){ state.carCardPreviewRaf=0; return; }
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
    const useColor=(state.selCar===i&&state.carColor!=null)?state.carColor:null;
    const visual=createCarVisual(c,useColor);
    visual.mesh.scale.setScalar(0.72);
    visual.mesh.rotation.x=-0.1;
    visual.mesh.position.set(0,-0.2,0);
    const preview={host:d,canvas,model:visual.mesh,hovered:false,selected:state.selCar===i,carIdx:i,angle:0,spinSpeed:0,baseYaw:-0.55,
      renderer:new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'})};
    preview.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
    preview.renderer.outputColorSpace=THREE.SRGBColorSpace;
    state.carCardPreviews.push(preview);
    const setSel=()=>{
      document.querySelectorAll('#carCards .card').forEach(x=>x.classList.remove('sel'));
      d.classList.add('sel'); state.selCar=i; document.getElementById('btnGo').disabled=false;
      state.carCardPreviews.forEach(item=>{ item.selected=item.host===d; });
      _syncCarColorPicker();
      _refreshSpCarColors();
      startCarCardPreviews();
    };
    d.onmouseenter=()=>{ preview.hovered=true; startCarCardPreviews(); };
    d.onmouseleave=()=>{ preview.hovered=false; };
    d.onclick=setSel;
    ct.appendChild(d);
  });
  _syncCarColorPicker();
  startCarCardPreviews();
}

// Rebuild a preview's 3D model with an optional body-colour override.
function _recolorPreviewModel(preview,colorNum){
  if(preview.carIdx==null) return;
  const visual=createCarVisual(CARS[preview.carIdx],colorNum);
  visual.mesh.scale.setScalar(0.72);
  visual.mesh.rotation.x=-0.1;
  visual.mesh.position.set(0,-0.2,0);
  preview.model=visual.mesh;
}

// Single-player car cards: selected card shows the chosen colour, others stay default.
function _refreshSpCarColors(){
  state.carCardPreviews.filter(p=>!p._vsContainer).forEach(p=>{
    _recolorPreviewModel(p,(p.selected&&state.carColor!=null)?state.carColor:null);
  });
}

// Point the colour <input> at the current selection's colour (custom or car default).
function _syncCarColorPicker(){
  const cp=document.getElementById('carColorPicker');
  if(!cp) return;
  const def=CARS[state.selCar??0]?.hex||'#ffffff';
  cp.value=state.carColor!=null?hexNumToCss(state.carColor):def;
}

// Wired from the car-select colour <input>.
export function onCarColorInput(css){
  state.carColor=cssToHexNum(css);
  _refreshSpCarColors();
  startCarCardPreviews();
}

// Wired from the "default" button — revert to the car's stock colour.
export function resetCarColor(){
  state.carColor=null;
  _syncCarColorPicker();
  _refreshSpCarColors();
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
    card.onclick=()=>{
      document.querySelectorAll('#oppCards .diffCard').forEach(c=>c.classList.remove('sel'));
      card.classList.add('sel'); state.opponentMode=card.dataset.opp;
      if(card.dataset.opp==='trained'&&!loadTrainedModel()) document.getElementById('trainedAiFile').click();
    };
  });
  _refreshTrainedAiCard();
  _wireTrainedAiImport();
}

function _refreshTrainedAiCard(){
  const desc=document.getElementById('trainedAiDesc');
  if(!desc) return;
  const model=loadTrainedModel();
  if(model){
    const steps=model.totalSteps>=1e6?(model.totalSteps/1e6).toFixed(1)+'M':Math.round((model.totalSteps||0)/1e3)+'k';
    const lap=Number.isFinite(model.bestLap)?` · best lap ${model.bestLap.toFixed(2)}s`:'';
    desc.textContent=`Race the model you trained (${steps} steps${lap})`;
  }else{
    desc.textContent='Import a model from the AI Trainer';
  }
}

let _trainedImportWired=false;
function _wireTrainedAiImport(){
  if(_trainedImportWired) return;
  _trainedImportWired=true;
  const input=document.getElementById('trainedAiFile');
  document.getElementById('trainedAiImportBtn').addEventListener('click',e=>{
    e.stopPropagation();
    input.click();
  });
  input.addEventListener('change',async function(){
    if(!this.files[0]) return;
    try{
      const model=validateTrainedModel(JSON.parse(await this.files[0].text()));
      saveTrainedModel(model);
      state.opponentMode='trained';
      document.querySelectorAll('#oppCards .diffCard').forEach(c=>c.classList.toggle('sel',c.dataset.opp==='trained'));
      _refreshTrainedAiCard();
      notify('Trained AI model imported — it will race against you.');
    }catch(err){
      notify('Model import failed: '+err.message);
    }
    this.value='';
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
//  FREE DRIVE MAP SELECTION
// ═══════════════════════════════════════════════════════

function _drawIslandPreview(canvas) {
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#10334d'; ctx.fillRect(0, 0, W, H);
  const r = Math.min(W, H) * 0.36;
  const pts = 14;
  function islandPath(scl) {
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const noise = 0.78 + 0.22 * Math.sin(a * 3.7 + 1.2) + 0.12 * Math.cos(a * 7.1 + 0.8);
      const x = cx + Math.cos(a) * r * scl * noise;
      const y = cy + Math.sin(a) * r * scl * noise;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  islandPath(1.0); ctx.fillStyle = '#54492f'; ctx.fill();
  islandPath(0.93); ctx.fillStyle = '#15301b'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2); ctx.fillStyle = '#10334d'; ctx.fill();
  const cities = [{ a: -0.5, d: 0.52, col: '#ffd700' }, { a: 2.0, d: 0.54, col: '#ff6644' }, { a: 1.0, d: 0.48, col: '#44aaff' }];
  for (const c of cities) {
    ctx.beginPath(); ctx.arc(cx + Math.cos(c.a) * r * c.d, cy + Math.sin(c.a) * r * c.d, 4, 0, Math.PI * 2);
    ctx.fillStyle = c.col; ctx.fill();
  }
  ctx.font = 'bold 10px Orbitron, monospace'; ctx.fillStyle = '#2ecc88'; ctx.textAlign = 'center';
  ctx.fillText('ISLAND', cx, H - 10); ctx.textAlign = 'left';
}

function _buildFdMapCards(tracks, driveMaps) {
  const COLORS = ['#4488ff', '#44cc66', '#ffaa22', '#ff4488', '#22ddaa', '#dd66ff', '#66bbff'];
  const container = document.getElementById('fdMapCards');
  container.innerHTML = '';

  const selIsDriveMap = state.fdCustomMapData != null;

  // Island card (always first)
  const islandCard = document.createElement('div');
  islandCard.className = 'tcard' + (!selIsDriveMap && state.fdSelMap === 'island' ? ' sel' : '');
  const islandCanvas = document.createElement('canvas'); islandCanvas.width = 280; islandCanvas.height = 230; islandCanvas.style.borderRadius = '6px';
  const islandH3 = document.createElement('h3'); islandH3.textContent = 'Island';
  const islandP = document.createElement('p'); islandP.textContent = 'Open-world island · three cities · cruise freely';
  islandCard.appendChild(islandCanvas); islandCard.appendChild(islandH3); islandCard.appendChild(islandP);
  islandCard.onclick = () => {
    container.querySelectorAll('.tcard').forEach(x => x.classList.remove('sel'));
    islandCard.classList.add('sel');
    state.fdSelMap = 'island'; state.fdCustomMapData = null;
    document.getElementById('fdMapNextBtn').disabled = false;
  };
  container.appendChild(islandCard);
  _drawIslandPreview(islandCanvas);

  // Race track cards
  tracks.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'tcard' + (!selIsDriveMap && String(state.fdSelMap) === String(t.id) ? ' sel' : '');
    const canvas = document.createElement('canvas'); canvas.width = 280; canvas.height = 230; canvas.style.borderRadius = '6px';
    const h3 = document.createElement('h3'); h3.textContent = t.name;
    const p = document.createElement('p'); p.textContent = t.desc + ' · ' + t.rw + 'm wide' + (t.builtin ? '' : ' · Custom');
    card.appendChild(canvas); card.appendChild(h3); card.appendChild(p);
    card.onclick = () => {
      container.querySelectorAll('.tcard').forEach(x => x.classList.remove('sel'));
      card.classList.add('sel');
      state.fdSelMap = t.id; state.fdCustomMapData = null;
      document.getElementById('fdMapNextBtn').disabled = false;
    };
    container.appendChild(card);
    drawTrackPreview(canvas, t, t.previewColor || COLORS[i % COLORS.length]);
  });

  // Drive-map-editor custom map cards
  (driveMaps || []).forEach(dm => {
    const card = document.createElement('div');
    card.className = 'tcard' + (selIsDriveMap && state.fdCustomMapData.id === dm.id ? ' sel' : '');
    const canvas = document.createElement('canvas'); canvas.width = 280; canvas.height = 230; canvas.style.borderRadius = '6px';
    const h3 = document.createElement('h3'); h3.textContent = dm.name || 'Custom Map';
    const nodeCount = (dm.nodes || []).length, roadCount = (dm.roads || []).length;
    const p = document.createElement('p'); p.textContent = (dm.desc || '') + (dm.desc ? ' · ' : '') + nodeCount + ' nodes · ' + roadCount + ' roads · Free Ride Map';
    card.appendChild(canvas); card.appendChild(h3); card.appendChild(p);
    card.onclick = () => {
      container.querySelectorAll('.tcard').forEach(x => x.classList.remove('sel'));
      card.classList.add('sel');
      state.fdSelMap = dm.id; state.fdCustomMapData = dm;
      document.getElementById('fdMapNextBtn').disabled = false;
    };
    container.appendChild(card);
    drawDriveMapPreview(canvas, dm);
  });

  if (!state.fdSelMap && !state.fdCustomMapData) {
    state.fdSelMap = 'island';
    islandCard.classList.add('sel');
    document.getElementById('fdMapNextBtn').disabled = false;
  }
}

export async function showFdMapSel() {
  await loadTracksFromFolder().catch(() => {});
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  document.getElementById('sFdMapSel').style.display = 'flex';
  state.gState = 'fdMapSel';
  updateTouchControlsVisibility(state.gState);
  document.getElementById('fdMapNextBtn').disabled = (state.fdSelMap == null);
  _buildFdMapCards(state.folderTracks);
}

export async function showFdMapOnlineTracks() {
  loadEditorTracks();
  const container = document.getElementById('fdMapCards');
  const loadingEl = document.createElement('p'); loadingEl.textContent = 'Loading online tracks…'; loadingEl.style.color = '#778'; loadingEl.style.width = '100%'; loadingEl.style.textAlign = 'center';
  container.innerHTML = ''; container.appendChild(loadingEl);
  await Promise.all([
    syncEditorTracksFromCloud().catch(() => {}),
    syncDriveMapsFromCloud().catch(() => {}),
  ]);
  const allOnline = state.editorTracks.filter(t => !state.folderTracks.some(f => String(f.id) === String(t.id)));
  _buildFdMapCards([...state.folderTracks, ...allOnline], state.driveMaps);
}

// ═══════════════════════════════════════════════════════
//  VS MODE LOBBY
// ═══════════════════════════════════════════════════════

// Player colors — matches Bomber's 4-player palette
const VS_COLORS = ['#ff9a3c', '#4af', '#f44', '#4f4'];
const MAX_VS_PLAYERS = 4;

// Host-authoritative roster. Each entry: { id, name, isAI, isHost, carIdx }
// Host owns this canonical list and broadcasts it after every change.
// Non-hosts receive it via lobby_state and render it unchanged.
let _vsRoster = [];
let _vsTrackId = null;
let _vsGameRunning = false;
let _vsLobbyPruneInterval = null;
let _vsShowOnline = false;   // host loaded online (custom/cloud) tracks into the picker

// ── Internal helpers ──────────────────────────────────────────────────────────

function _vsSetStatus(msg) {
  const el = document.getElementById('vsStatusMsg');
  if (el) el.textContent = msg;
}

// Host: broadcast the full roster to all clients, then refresh local UI
function _hostSyncRoster() {
  if (!state.vsIsHost || !state.vsNetwork) return;
  state.vsNetwork.sendLobbyState(_vsRoster, _vsTrackId, _vsGameRunning);
  _renderVsSlots();
}

function _renderVsSlots() {
  const isHost = state.vsIsHost;
  const net = state.vsNetwork;

  for (let i = 0; i < MAX_VS_PLAYERS; i++) {
    const slotEl = document.getElementById(`vsSlot${i}`);
    if (!slotEl) continue;
    slotEl.innerHTML = '';
    slotEl.className = 'vsSlot';

    if (i < _vsRoster.length) {
      const p = _vsRoster[i];
      slotEl.classList.add('vsSlot-filled');
      slotEl.style.setProperty('--sc', VS_COLORS[i]);

      const dot = document.createElement('span'); dot.className = 'vsSlotDot';
      const nm = document.createElement('span'); nm.className = 'vsSlotName';
      nm.textContent = (p.isAI ? '🤖 ' : '') + p.name + (p.isHost ? ' 👑' : '');

      const carLbl = document.createElement('span');
      carLbl.style.cssText = 'font-size:.68rem;color:#99a;margin-left:auto;flex-shrink:0;';
      carLbl.textContent = CARS[p.carIdx ?? 0]?.name ?? '';

      slotEl.appendChild(dot);
      slotEl.appendChild(nm);
      slotEl.appendChild(carLbl);

      if (isHost) {
        if (p.isAI) {
          const rm = document.createElement('button'); rm.className = 'vsSlotRemove'; rm.textContent = '✕';
          rm.title = 'Remove bot'; rm.onclick = e => { e.stopPropagation(); _vsRemoveAI(p.id); };
          slotEl.appendChild(rm);
        } else if (p.id !== net?.myId) {
          const kick = document.createElement('button'); kick.className = 'vsSlotRemove'; kick.textContent = '✕ Kick';
          kick.title = 'Kick player'; kick.onclick = e => { e.stopPropagation(); _vsKickPlayer(p.id); };
          slotEl.appendChild(kick);
        }
      }
    } else if (isHost && _vsRoster.length < MAX_VS_PLAYERS) {
      slotEl.classList.add('vsSlot-empty');
      const btn = document.createElement('button'); btn.className = 'vsAddBotBtn'; btn.textContent = '+ Add AI';
      btn.onclick = _vsAddAI;
      slotEl.appendChild(btn);
    } else {
      slotEl.classList.add('vsSlot-passive');
      const dash = document.createElement('span'); dash.className = 'vsSlotEmpty'; dash.textContent = '—';
      slotEl.appendChild(dash);
    }
  }

  const total = _vsRoster.length;
  const canStart = isHost && total >= 2 && _vsTrackId != null;
  const startBtn = document.getElementById('vsStartBtn');
  const statusEl = document.getElementById('vsStatusMsg');
  if (startBtn) startBtn.disabled = !canStart;
  if (statusEl) {
    if (isHost) {
      if (_vsTrackId == null)  statusEl.textContent = 'Pick a track first.';
      else if (total < 2)      statusEl.textContent = 'Add 1 more player or AI to start.';
      else                     statusEl.textContent = `${total} player${total > 1 ? 's' : ''} ready!`;
    } else {
      const trk = _vsTrackId
        ? (getAllTracks().find(t => String(t.id) === String(_vsTrackId))?.name ?? 'selected')
        : null;
      statusEl.textContent = trk
        ? `Track: ${trk} — waiting for host to start…`
        : 'Waiting for host to start the race…';
    }
  }
}

// ── AI management (host only) ─────────────────────────────────────────────────

function _vsAddAI() {
  if (!state.vsIsHost || _vsRoster.length >= MAX_VS_PLAYERS) return;
  const usedNames = _vsRoster.filter(e => e.isAI).map(e => e.name);
  const name = BOT_NAMES.find(n => !usedNames.includes(n)) || `Bot ${_vsRoster.filter(e => e.isAI).length + 1}`;
  _vsRoster.push({
    id: `ai-${crypto.randomUUID()}`,
    name,
    isAI: true,
    isHost: false,
    carIdx: Math.floor(Math.random() * CARS.length),
  });
  _hostSyncRoster();
}

function _vsRemoveAI(id) {
  if (!state.vsIsHost) return;
  _vsRoster = _vsRoster.filter(e => e.id !== id);
  _hostSyncRoster();
}

function _vsKickPlayer(id) {
  if (!state.vsIsHost) return;
  state.vsNetwork.sendPlayerKick(id);
  _vsRoster = _vsRoster.filter(e => e.id !== id);
  _hostSyncRoster();
}

// ── Track cards (host only) ───────────────────────────────────────────────────

function _buildVsTrkCards() {
  const container = document.getElementById('vsTrackCards');
  if (!container) return;
  const tracks = _vsShowOnline ? getAllTracks() : (state.folderTracks || []);
  const COLORS = ['#4488ff', '#44cc66', '#ffaa22', '#ff4488', '#22ddaa', '#dd66ff', '#66bbff'];
  container.innerHTML = '';
  tracks.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'vsTrackCard' + (String(_vsTrackId) === String(t.id) ? ' sel' : '');
    const cvs = document.createElement('canvas'); cvs.width = 160; cvs.height = 120;
    const nm = document.createElement('span'); nm.textContent = t.name;
    card.appendChild(cvs); card.appendChild(nm);
    drawTrackPreview(cvs, t, t.previewColor || COLORS[i % COLORS.length]);
    card.onclick = () => {
      container.querySelectorAll('.vsTrackCard').forEach(x => x.classList.remove('sel'));
      card.classList.add('sel');
      _vsTrackId = t.id;
      state.selTrk = t.id;
      _hostSyncRoster();
    };
    container.appendChild(card);
  });
}

// Host: pull custom/cloud tracks into the VS picker (mirrors single-player "load online tracks")
export async function vsLoadOnlineTracks() {
  if (!state.vsIsHost) return;
  const btn = document.getElementById('vsLoadOnlineTracksBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
  loadEditorTracks();
  await syncEditorTracksFromCloud().catch(() => {});
  _vsShowOnline = true;
  _buildVsTrkCards();
  if (btn) { btn.disabled = false; btn.textContent = '✓ ONLINE TRACKS LOADED'; }
}

// ── Inline car selector (shared by VS lobby and Free Drive) ──────────────────

export function buildCarChipRow(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const old = state.carCardPreviews.filter(p => p._vsContainer === containerId);
  old.forEach(p => { p.renderer.dispose(); });
  state.carCardPreviews = state.carCardPreviews.filter(p => p._vsContainer !== containerId);
  if (state.carCardPreviewRaf) { cancelAnimationFrame(state.carCardPreviewRaf); state.carCardPreviewRaf = 0; }

  ensureCarCardPreviewRenderer();
  container.innerHTML = '';
  if (state.selCar == null) state.selCar = 0;

  CARS.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'vsCarChip' + (state.selCar === i ? ' sel' : '');
    d.title = c.name;
    const cvs = document.createElement('canvas'); cvs.className = 'vsCarCanvas';
    const nm = document.createElement('span'); nm.textContent = c.name;
    d.appendChild(cvs); d.appendChild(nm);

    const useColor = (state.selCar === i && state.carColor != null) ? state.carColor : null;
    const visual = createCarVisual(c, useColor);
    visual.mesh.scale.setScalar(0.72);
    visual.mesh.rotation.x = -0.1;
    visual.mesh.position.set(0, -0.2, 0);
    const preview = {
      host: d, canvas: cvs, model: visual.mesh, hovered: false, selected: state.selCar === i, carIdx: i,
      angle: 0, spinSpeed: 0, baseYaw: -0.55, _vsContainer: containerId,
      renderer: new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true, powerPreference: 'low-power' }),
    };
    preview.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    preview.renderer.outputColorSpace = THREE.SRGBColorSpace;
    state.carCardPreviews.push(preview);

    d.onmouseenter = () => { preview.hovered = true; startCarCardPreviews(); };
    d.onmouseleave = () => { preview.hovered = false; };
    d.onclick = () => {
      container.querySelectorAll('.vsCarChip').forEach(x => x.classList.remove('sel'));
      d.classList.add('sel'); state.selCar = i;
      state.carCardPreviews.forEach(item => { item.selected = item.host === d; });
      refreshCarChipColors(containerId);
      startCarCardPreviews();
      onSelect(i);
    };
    container.appendChild(d);
  });
  refreshCarChipColors(containerId);
  startCarCardPreviews();
}

// Car chips: selected chip shows the chosen colour, others stay default.
export function refreshCarChipColors(containerId) {
  state.carCardPreviews.filter(p => p._vsContainer === containerId).forEach(p => {
    _recolorPreviewModel(p, (p.selected && state.carColor != null) ? state.carColor : null);
  });
}

// Wired from the VS car-colour <input> (host + guest share one element id each).
export function onVsColorInput(css) {
  state.carColor = cssToHexNum(css);
  if (state.vsIsHost) {
    const me = _vsRoster.find(e => e.id === state.vsNetwork?.myId);
    if (me) { me.color = state.carColor; _hostSyncRoster(); }
    refreshCarChipColors('vsHostCarRow');
  } else {
    state.vsNetwork?.sendGuestReady(state.selCar ?? 0, state.carColor);
    refreshCarChipColors('vsGuestCarRow');
  }
  startCarCardPreviews();
}

// Point the VS colour inputs at the current chosen colour (custom or car default).
function _syncVsColorPickers() {
  const def = CARS[state.selCar ?? 0]?.hex || '#ffffff';
  const val = state.carColor != null ? hexNumToCss(state.carColor) : def;
  ['vsHostColor', 'vsGuestColor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
}

// ── Room panel (shown after connect) ─────────────────────────────────────────

function _showVsRoomPanel(isHost) {
  document.getElementById('vsJoinPanel').style.display = 'none';
  document.getElementById('vsRoomPanel').style.display = 'flex';
  document.getElementById('vsRoomCodeDisplay').textContent = state.vsRoomCode;

  document.getElementById('vsHostSection').style.display = isHost ? 'flex' : 'none';
  document.getElementById('vsGuestSection').style.display = isHost ? 'none' : 'flex';

  _renderVsSlots();
  _syncVsColorPickers();

  if (isHost) {
    const onlineBtn = document.getElementById('vsLoadOnlineTracksBtn');
    if (onlineBtn) {
      onlineBtn.disabled = false;
      onlineBtn.textContent = _vsShowOnline ? '✓ ONLINE TRACKS LOADED' : 'LOAD ONLINE TRACKS';
    }
    _buildVsTrkCards();
    buildCarChipRow('vsHostCarRow', carIdx => {
      const me = _vsRoster.find(e => e.id === state.vsNetwork?.myId);
      if (me) { me.carIdx = carIdx; me.color = state.carColor; _hostSyncRoster(); }
    });
  } else {
    buildCarChipRow('vsGuestCarRow', carIdx => {
      state.vsNetwork?.sendGuestReady(carIdx, state.carColor);
    });
  }
}

// ── Network event wiring ──────────────────────────────────────────────────────

function _attachVsHandlers(net, isHost) {
  // Presence: fires only for disconnects — handled by 30s safety-net below
  net.onPresenceLeave = (_left) => { /* pruning handled by interval */ };

  // player_hello: a new player joined the channel
  net.onPlayerHello = ({ id, name, isHost: playerIsHost, carIdx, color }) => {
    if (!isHost) return; // only host manages the roster
    if (_vsRoster.find(e => e.id === id)) {
      // Already in roster — resync so the new arrival gets full state
      _hostSyncRoster();
      return;
    }
    // Reconnect detection: same name, new connection id
    const stale = _vsRoster.find(e => !e.isAI && e.name === name && e.id !== id);
    if (stale) {
      stale.id = id;
      stale.isHost = !!playerIsHost;
    } else {
      _vsRoster.push({ id, name, isAI: false, isHost: !!playerIsHost, carIdx: carIdx ?? 0, color: color ?? null });
    }
    _hostSyncRoster();
  };

  // player_leave: intentional departure — remove immediately
  net.onPlayerLeave = ({ id }) => {
    if (id === net.myId) return;
    _vsRoster = _vsRoster.filter(e => e.id !== id);
    if (isHost) _hostSyncRoster();
    else _renderVsSlots();
  };

  // guest_ready: guest changed car selection — host updates roster entry
  net.onGuestReady = ({ id, carIdx, color }) => {
    if (!isHost) return;
    const entry = _vsRoster.find(e => e.id === id);
    if (entry) { entry.carIdx = carIdx; if (color !== undefined) entry.color = color; _hostSyncRoster(); }
  };

  // lobby_state: host-authoritative snapshot (guests apply, host ignores)
  net.onLobbyState = ({ roster, trackId, gameRunning }) => {
    if (isHost) return;
    _vsRoster = Array.isArray(roster) ? roster : [];
    _vsTrackId = trackId ?? null;
    _vsGameRunning = !!gameRunning;
    state.selTrk = trackId ?? null;
    _renderVsSlots();
  };

  // return_lobby: host sent everyone back after a race
  net.onReturnLobby = () => {
    if (!isHost) _enterVsLobbyRoom();
  };

  // game_start: all clients launch the race
  net.onGameStart = ({ slots, trackId, trackData }) => {
    _launchVsRace(slots, trackId, trackData);
  };

  // player_kick
  net.onPlayerKick = ({ targetId }) => {
    if (targetId === net.myId) {
      alert('You were kicked from the lobby.');
      vsLeaveLobby();
      return;
    }
    _vsRoster = _vsRoster.filter(e => e.id !== targetId);
    if (isHost) _hostSyncRoster();
    else _renderVsSlots();
  };

  // In-race: push timestamped snapshot into the per-car interpolation buffer
  net.onPosUpdate = (data) => {
    if (!data.id || data.id === state.vsMyId) return;
    state.vsCarStates[data.id] = data; // latest snapshot for HUD/minimap
    if (!state.vsCarBuffers[data.id]) state.vsCarBuffers[data.id] = [];
    const buf = state.vsCarBuffers[data.id];
    buf.push({ ...data, t: performance.now() / 1000 });
    if (buf.length > 32) buf.shift(); // keep a small sliding window
  };

  // In-race: a car finished
  net.onPlayerFinished = ({ id, finTime }) => {
    state.vsFinished[id] = finTime;
  };

  // 30-second safety-net: prune truly disconnected players (host only)
  if (isHost) _startVsLobbyPrune(net);
}

// Host-only safety-net interval that drops players who vanished from presence.
function _startVsLobbyPrune(net) {
  if (_vsLobbyPruneInterval) clearInterval(_vsLobbyPruneInterval);
  _vsLobbyPruneInterval = setInterval(() => {
    if (state.gState !== 'vsLobby' || !state.vsIsHost) return;
    const fresh = net.getPresencePlayers();
    if (!fresh.length) return; // presence not yet synced — don't prune
    const freshIds = new Set(fresh.map(p => p.id));
    freshIds.add(net.myId); // never remove ourselves
    const before = _vsRoster.length;
    _vsRoster = _vsRoster.filter(e => e.isAI || freshIds.has(e.id));
    if (_vsRoster.length !== before) _hostSyncRoster();
  }, 30000);
}

// ── Race launch ───────────────────────────────────────────────────────────────

function _launchVsRace(slots, trackId, trackData) {
  state.vsMode = true;
  _vsGameRunning = true;
  if (_vsLobbyPruneInterval) { clearInterval(_vsLobbyPruneInterval); _vsLobbyPruneInterval = null; }
  disposeCarCardPreviews();
  document.querySelectorAll('.screen,#results').forEach(s => s.style.display = 'none');
  import('./race.js').then(m => m.initVsRace(slots, trackId, trackData));
}

// Bring everyone back to the lobby room panel after a race (keeps the network/roster alive).
// Host broadcasts return_lobby; guests get here via net.onReturnLobby.
export function vsReturnToLobby() {
  if (!state.vsNetwork) { showMain(); return; }
  if (state.vsIsHost) state.vsNetwork.sendReturnLobby();
  _enterVsLobbyRoom();
}

function _enterVsLobbyRoom() {
  state.vsMode = false;
  _vsGameRunning = false;
  // Tear down the finished race scene (keep the network/roster alive)
  stopAudio();
  for (const c of state.allCars) scene.remove(c.mesh);
  state.allCars = []; state.aiCars = []; state.pCar = null;
  state.vsCarsById = {}; state.vsCarStates = {}; state.vsCarBuffers = {}; state.vsFinished = {};
  clearGhostVisual();
  document.querySelectorAll('.screen,#results').forEach(s => s.style.display = 'none');
  document.getElementById('hud').style.display = 'none';
  document.getElementById('hint').style.display = 'none';
  document.getElementById('pauseMenu').style.display = 'none';
  document.getElementById('touchControls').style.display = 'none';
  dc.style.display = 'none';
  document.getElementById('sVsLobby').style.display = 'flex';
  document.getElementById('vsJoinPanel').style.display = 'none';
  state.gState = 'vsLobby';
  updateTouchControlsVisibility(state.gState);
  releaseAllTouchControls();
  if (audioReady) startMusic();
  if (state.vsIsHost && state.vsNetwork) _startVsLobbyPrune(state.vsNetwork);
  _showVsRoomPanel(state.vsIsHost);
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

function _vsCopyFeedback(msg) {
  const el = document.getElementById('vsCopyFeedback');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function showVsLobby() {
  if (state.vsNetwork) { state.vsNetwork.leave().catch(() => {}); state.vsNetwork = null; }
  state.vsMode = false;
  _vsRoster = [];
  _vsTrackId = null;
  _vsGameRunning = false;
  _vsShowOnline = false;
  if (_vsLobbyPruneInterval) { clearInterval(_vsLobbyPruneInterval); _vsLobbyPruneInterval = null; }

  loadTracksFromFolder().catch(() => {});
  // Pre-load custom/cloud tracks on every client so guests can resolve an online
  // track the host might pick (the host also gets them via the LOAD ONLINE button).
  loadEditorTracks();
  syncEditorTracksFromCloud().catch(() => {});

  document.querySelectorAll('.screen,#results').forEach(s => s.style.display = 'none');
  document.getElementById('sVsLobby').style.display = 'flex';
  state.gState = 'vsLobby';
  updateTouchControlsVisibility(state.gState);

  document.getElementById('vsJoinPanel').style.display = 'flex';
  document.getElementById('vsRoomPanel').style.display = 'none';
  _vsSetStatus('');

  const user = getArcadeUser();
  const nameLbl = document.getElementById('vsMyNameLabel');
  if (nameLbl) nameLbl.textContent = user.name || 'Anonymous';

  const urlRoom = new URLSearchParams(window.location.search).get('room');
  if (urlRoom && urlRoom.length === 4) {
    const inp = document.getElementById('vsCodeInput');
    if (inp) inp.value = urlRoom.trim().toUpperCase();
  }
}

export async function vsCreateRoom() {
  const user = getArcadeUser();
  const name = user.name || 'Anonymous';
  if (state.selCar == null) state.selCar = 0;

  const code = generateRoomCode();
  state.vsRoomCode = code;
  state.vsIsHost = true;
  _vsTrackId = null;
  _vsGameRunning = false;

  const net = new VsNetwork();
  state.vsNetwork = net;
  state.vsMyId = net.myId;

  // Pre-seed own slot so the UI isn't empty while connecting
  _vsRoster = [{ id: net.myId, name, isAI: false, isHost: true, carIdx: state.selCar, color: state.carColor }];

  _attachVsHandlers(net, true);

  _vsSetStatus('Connecting…');
  try {
    await net.joinRoom(code, name, true, state.selCar, state.carColor);
  } catch (e) {
    _vsSetStatus('❌ Connection failed: ' + e.message);
    return;
  }

  _showVsRoomPanel(true);
  // Push initial state to any clients already in the channel
  _hostSyncRoster();
}

export async function vsJoinRoom() {
  const user = getArcadeUser();
  const name = user.name || 'Anonymous';
  const code = (document.getElementById('vsCodeInput')?.value || '').trim().toUpperCase();
  if (!code || code.length !== 4) { _vsSetStatus('❌ Enter a 4-letter room code'); return; }
  if (state.selCar == null) state.selCar = 0;

  state.vsRoomCode = code;
  state.vsIsHost = false;
  _vsTrackId = null;
  _vsGameRunning = false;

  const net = new VsNetwork();
  state.vsNetwork = net;
  state.vsMyId = net.myId;

  // Pre-seed own slot so the UI isn't empty while connecting
  _vsRoster = [{ id: net.myId, name, isAI: false, isHost: false, carIdx: state.selCar, color: state.carColor }];

  _attachVsHandlers(net, false);

  _vsSetStatus('Joining…');
  try {
    await net.joinRoom(code, name, false, state.selCar, state.carColor);
  } catch (e) {
    _vsSetStatus('❌ Connection failed: ' + e.message);
    return;
  }

  _showVsRoomPanel(false);
}

export function vsStartRace() {
  if (!state.vsIsHost || !state.vsNetwork) return;
  if (_vsTrackId == null) { _vsSetStatus('❌ Pick a track first'); return; }
  if (_vsRoster.length < 2) { _vsSetStatus('❌ Need at least 2 players/AIs'); return; }

  _vsGameRunning = true;
  const slots = _vsRoster.map(p => ({ id: p.id, name: p.name, isAI: p.isAI, carIdx: p.carIdx ?? 0, color: p.color ?? null }));
  const trackData = getAllTracks().find(t => String(t.id) === String(_vsTrackId)) || null;
  state.vsNetwork.sendGameStart(slots, _vsTrackId, trackData);
  _launchVsRace(slots, _vsTrackId, trackData);
}

export function vsLeaveLobby() {
  if (_vsLobbyPruneInterval) { clearInterval(_vsLobbyPruneInterval); _vsLobbyPruneInterval = null; }
  if (state.vsNetwork) {
    state.vsNetwork.sendPlayerLeave(state.vsMyId || state.vsNetwork.myId);
    state.vsNetwork.leave().catch(() => {});
    state.vsNetwork = null;
  }
  state.vsMode = false;
  disposeCarCardPreviews();
  showMain();
}

export function vsCopyCode() {
  const code = state.vsRoomCode;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('vsCopyCodeBtn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓'; btn.classList.add('vsCopied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('vsCopied'); }, 1600);
    }
    _vsCopyFeedback('Room code copied!');
  }).catch(() => _vsCopyFeedback('Could not copy'));
}

export function vsCopyInviteLink() {
  const code = state.vsRoomCode;
  if (!code) return;
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  url.hash = '';
  navigator.clipboard.writeText(url.toString()).then(() => {
    const btn = document.getElementById('vsCopyInviteBtn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ COPIED!'; btn.classList.add('vsCopied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('vsCopied'); }, 1600);
    }
    _vsCopyFeedback('Invite link copied!');
  }).catch(() => _vsCopyFeedback('Could not copy'));
}
