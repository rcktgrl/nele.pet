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
  if(state.gState!=='carSel'||!state.carCardPreviews.length){ state.carCardPreviewRaf=0; return; }
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
      const trainBtn=document.getElementById('btnTrainStart'); if(trainBtn) trainBtn.disabled=false;
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
  const trainBtn=document.getElementById('btnTrainStart'); if(trainBtn) trainBtn.disabled=(state.selTrk==null);
  const tracks=state.folderTracks;
  await buildTrackCards(tracks,document.getElementById('trkCards'),'btnNxt');
}

// Opens the track selection screen in "train" mode (TRAIN button is the CTA).
// Reuses the same screen; btnTrainStart is the only CTA (Next is hidden).
export async function showTrainTrkSel(){
  await showTrkSel();
  document.getElementById('btnNxt').style.display='none';
  const trainBtn=document.getElementById('btnTrainStart');
  if(trainBtn) trainBtn.scrollIntoView({behavior:'smooth',block:'nearest'});
}

// ═══════════════════════════════════════════════════════
//  AI TRAINING SETUP
// ═══════════════════════════════════════════════════════
let _trainSetupGenome=null;

export async function showTrainSetup(){
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sTrainSetup').style.display='flex';

  _trainSetupGenome=null;

  // Sync arch sliders with current state
  const h=state.trainHiddenLayers||1, n=state.trainHiddenSize||5;
  document.getElementById('trainSetupHiddenSlider').value=h;
  document.getElementById('trainSetupHiddenVal').textContent=h;
  document.getElementById('trainSetupNodesSlider').value=n;
  document.getElementById('trainSetupNodesVal').textContent=n;

  const container=document.getElementById('trainSetupModelCards');
  container.innerHTML='<div style="color:#556;font-size:.8rem;align-self:center;">Loading models…</div>';

  const models=[];

  // Load repo models from /models/index.json
  try{
    const idx=await fetch('./models/index.json').then(r=>r.json());
    for(const id of (idx.models||[])){
      try{
        const m=await fetch(`./models/${id}.json`).then(r=>r.json());
        if(Array.isArray(m.genome)&&m.genome.length){
          models.push({label:m.name||id,desc:`Built-in · gen ${m.generation||'?'}`,genome:m.genome,icon:'🧠',arch:[15,5,3]});
        }
      }catch(_){}
    }
  }catch(_){}

  // Check localStorage for a saved model
  const saved=localStorage.getItem('turborace_nn_weights');
  if(saved){
    try{
      const genome=JSON.parse(saved);
      const savedName=localStorage.getItem('turborace_nn_name')||'Saved Model';
      models.push({label:savedName,desc:'Saved in browser',genome,icon:'💾',arch:null});
    }catch(_){}
  }

  // Fresh random start
  models.push({label:'Fresh Start',desc:'Random initialisation',genome:null,icon:'✨',arch:null});

  // Default select: first model
  _trainSetupGenome=models[0].genome;
  let selectedIdx=0;

  container.innerHTML='';
  models.forEach((m,i)=>{
    const card=document.createElement('div');
    card.className='diffCard'+(i===0?' sel':'');
    card.innerHTML=`<div class="diffIcon">${m.icon}</div><div class="diffName">${m.label}</div><div class="diffDesc">${m.desc}</div>`;
    card.onclick=()=>{
      container.querySelectorAll('.diffCard').forEach(c=>c.classList.remove('sel'));
      card.classList.add('sel');
      selectedIdx=i;
      _trainSetupGenome=m.genome;
      // Auto-set arch sliders when a repo model with known arch is chosen
      if(m.arch&&m.arch.length>=3){
        const hl=m.arch.length-2, nl=m.arch[1]||5;
        document.getElementById('trainSetupHiddenSlider').value=hl;
        document.getElementById('trainSetupHiddenVal').textContent=hl;
        document.getElementById('trainSetupNodesSlider').value=nl;
        document.getElementById('trainSetupNodesVal').textContent=nl;
        state.trainHiddenLayers=hl; state.trainHiddenSize=nl;
        const hs=document.getElementById('trainHiddenSlider'); if(hs){hs.value=hl;document.getElementById('trainHiddenVal').textContent=hl;}
        const ns=document.getElementById('trainNodesSlider'); if(ns){ns.value=nl;document.getElementById('trainNodesVal').textContent=nl;}
      }
    };
    container.appendChild(card);
  });
}

export function getTrainSetupGenome(){ return _trainSetupGenome; }

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
