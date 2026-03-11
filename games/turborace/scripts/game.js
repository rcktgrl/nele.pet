import { TRACKS } from './data/tracks.js';
import { CARS } from './data/cars.js';

'use strict';

// ═══════════════════════════════════════════════════════
//  AUDIO ENGINE
// ═══════════════════════════════════════════════════════
let audioCtx=null,audioReady=false;
let musicMaster=null,sfxMaster=null;
let engOsc=null,engOsc2=null,engGain=null,engFilter=null,engFilter2=null;
let scrOsc=null,scrGain=null;
let musicPlaying=false,musicStep=0,nextStepTime=0,musicTimerId=null;
let aiSounds=[];

// Volume state (0-1)
let musicVolume=0.6, sfxVolume=0.8;

function initAudio(){
  if(audioReady)return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    // Master gains
    musicMaster=audioCtx.createGain(); musicMaster.gain.value=musicVolume; musicMaster.connect(audioCtx.destination);
    sfxMaster=audioCtx.createGain();   sfxMaster.gain.value=sfxVolume;    sfxMaster.connect(audioCtx.destination);

    // --- Player engine: two oscillators sculpted by filter ---
    engOsc=audioCtx.createOscillator();   engOsc.type='sawtooth';  engOsc.frequency.value=60;
    engOsc2=audioCtx.createOscillator();  engOsc2.type='square';   engOsc2.frequency.value=40;
    engFilter=audioCtx.createBiquadFilter();  engFilter.type='lowpass';  engFilter.frequency.value=500; engFilter.Q.value=1.8;
    engFilter2=audioCtx.createBiquadFilter(); engFilter2.type='bandpass'; engFilter2.frequency.value=320; engFilter2.Q.value=3;
    const hg=audioCtx.createGain(); hg.gain.value=0.22;
    const sg=audioCtx.createGain(); sg.gain.value=0.5;
    engGain=audioCtx.createGain(); engGain.gain.value=0;
    engOsc.connect(engFilter); engFilter.connect(engGain);
    engOsc2.connect(sg); sg.connect(engFilter2); engFilter2.connect(hg); hg.connect(engGain);
    engGain.connect(sfxMaster);

    // --- Tyre screech ---
    scrOsc=audioCtx.createOscillator(); scrOsc.type='sawtooth'; scrOsc.frequency.value=220;
    const scrFilt=audioCtx.createBiquadFilter(); scrFilt.type='bandpass'; scrFilt.frequency.value=800; scrFilt.Q.value=5;
    scrGain=audioCtx.createGain(); scrGain.gain.value=0;
    scrOsc.connect(scrFilt); scrFilt.connect(scrGain); scrGain.connect(sfxMaster);

    engOsc.start(); engOsc2.start(); scrOsc.start();
    audioReady=true;
    applyVolumes();
  }catch(e){console.warn('Audio init failed:',e);}
}

function applyVolumes(){
  if(!audioReady)return;
  musicMaster.gain.setTargetAtTime(musicVolume,audioCtx.currentTime,.05);
  sfxMaster.gain.setTargetAtTime(sfxVolume,audioCtx.currentTime,.05);
}

function onMusicVol(v){
  musicVolume=v/100;
  document.getElementById('musicVolVal').textContent=v;
  if(audioReady)musicMaster.gain.setTargetAtTime(musicVolume,audioCtx.currentTime,.05);
}
function onSfxVol(v){
  sfxVolume=v/100;
  document.getElementById('sfxVolVal').textContent=v;
  if(audioReady)sfxMaster.gain.setTargetAtTime(sfxVolume,audioCtx.currentTime,.05);
}

function updateAudio(thr,brk,dt){
  if(!audioReady||!pCar)return;
  // Silence engine when player is finished
  if(pCar.finished){
    engGain.gain.setTargetAtTime(0,audioCtx.currentTime,.1);
    scrGain.gain.setTargetAtTime(0,audioCtx.currentTime,.1);
    return;
  }
  const now=audioCtx.currentTime,rpm=pCar.rpm,sf=pCar.spd/pCar.data.maxSpd;
  const freq=55+rpm/8000*155;
  engOsc.frequency.setTargetAtTime(freq,now,.06);
  engOsc2.frequency.setTargetAtTime(freq*.5,now,.06);
  const cut=280+rpm/8000*2800*(0.4+thr*.6);
  engFilter.frequency.setTargetAtTime(cut,now,.05);
  const vol=Math.min(.42,0.06+thr*.20+sf*.16+(brk?.04:0));
  engGain.gain.setTargetAtTime(vol,now,.04);
  const ts=Math.abs((keys['ArrowLeft']||keys['KeyA'])?1:(keys['ArrowRight']||keys['KeyD'])?-1:0);
  const sc=Math.max(0,(brk*.9+ts*.3)*sf-.22)*0.32;
  scrGain.gain.setTargetAtTime(sc,now,.08);
  scrOsc.frequency.setTargetAtTime(160+sf*140,now,.1);
}

function stopAudio(){
  if(!audioReady)return;
  // Hard-kill: cancel all scheduled automation and set gain to 0 right now
  engGain.gain.cancelScheduledValues(0);
  engGain.gain.value=0;
  scrGain.gain.cancelScheduledValues(0);
  scrGain.gain.value=0;
  for(const s of aiSounds)s.silence();
}

function playBeep(freq,dur,vol,type){
  if(!audioReady)return;
  vol=vol||0.3; type=type||'sine';
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type=type; o.frequency.value=freq;
  g.gain.setValueAtTime(vol,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);
  o.connect(g); g.connect(sfxMaster);
  o.start(); o.stop(audioCtx.currentTime+dur);
}

function playVictoryJingle(){
  if(!audioReady)return;
  const t=audioCtx.currentTime;
  const notes=[523,659,784,1047,784,1047]; // C5 E5 G5 C6 G5 C6
  const durs=[.15,.15,.15,.3,.1,.5];
  let off=0;
  for(let i=0;i<notes.length;i++){
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type='square'; o.frequency.value=notes[i];
    g.gain.setValueAtTime(0.25,t+off);
    g.gain.exponentialRampToValueAtTime(.001,t+off+durs[i]+.1);
    o.connect(g); g.connect(sfxMaster);
    o.start(t+off); o.stop(t+off+durs[i]+.15);
    off+=durs[i];
  }
}

function playLossSound(){
  if(!audioReady)return;
  const t=audioCtx.currentTime;
  const notes=[392,349,330,262]; // G4 F4 E4 C4 descending
  const durs=[.2,.2,.2,.6];
  let off=0;
  for(let i=0;i<notes.length;i++){
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type='sawtooth'; o.frequency.value=notes[i];
    g.gain.setValueAtTime(0.18,t+off);
    g.gain.exponentialRampToValueAtTime(.001,t+off+durs[i]+.15);
    const filt=audioCtx.createBiquadFilter();
    filt.type='lowpass'; filt.frequency.value=800;
    o.connect(filt); filt.connect(g); g.connect(sfxMaster);
    o.start(t+off); o.stop(t+off+durs[i]+.2);
    off+=durs[i];
  }
}

// ─── AI Positional Sound ───────────────────────────────
class AISound{
  constructor(){
    if(!audioReady)return;
    this.osc=audioCtx.createOscillator();
    this.osc2=audioCtx.createOscillator();
    this.filt=audioCtx.createBiquadFilter();
    this.filt.type='lowpass'; this.filt.frequency.value=400;
    this.gain=audioCtx.createGain(); this.gain.gain.value=0;
    this.panner=audioCtx.createStereoPanner();
    this.osc.type='sawtooth'; this.osc.frequency.value=55;
    this.osc2.type='square'; this.osc2.frequency.value=28;
    const sg2=audioCtx.createGain(); sg2.gain.value=0.4;
    this.osc.connect(this.filt); this.filt.connect(this.gain);
    this.osc2.connect(sg2); sg2.connect(this.gain);
    this.gain.connect(this.panner); this.panner.connect(sfxMaster);
    this.osc.start(); this.osc2.start();
  }
  update(aiCar,playerCar){
    if(!audioReady||!this.gain)return;
    // Silence engine when car finishes
    if(aiCar.finished){this.silence();return;}
    const now=audioCtx.currentTime;
    const dx=aiCar.pos.x-playerCar.pos.x, dz=aiCar.pos.z-playerCar.pos.z;
    const dist=Math.sqrt(dx*dx+dz*dz);
    const vol=Math.max(0,0.18*(1-dist/90));
    const cosH=Math.cos(-playerCar.hdg), sinH=Math.sin(-playerCar.hdg);
    const px=cosH*dx-sinH*dz;
    const pan=Math.max(-1,Math.min(1,px/35));
    const freq=48+aiCar.rpm/8000*90;
    this.osc.frequency.setTargetAtTime(freq,now,.1);
    this.osc2.frequency.setTargetAtTime(freq*.5,now,.1);
    this.filt.frequency.setTargetAtTime(300+aiCar.rpm/8000*600,now,.1);
    this.gain.gain.setTargetAtTime(vol,now,.08);
    this.panner.pan.setTargetAtTime(pan,now,.1);
  }
  silence(){if(audioReady&&this.gain)this.gain.gain.setTargetAtTime(0,audioCtx.currentTime,.2);}
}

// ─── Procedural Music Sequencer ───────────────────────
const BPM=128, STEP_S=60/BPM/4;
// 32-step patterns (2 bars)
const PAT_KICK= [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0, 1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0];
const PAT_CLAP= [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0, 0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0];
const PAT_HHAT= [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1];
const PAT_OHHT= [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0, 0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0];
// Hz values (0=rest)
const PAT_BASS= [55,0,0,55,0,0,41,0, 55,0,0,55,0,0,49,0, 55,0,0,55,0,0,41,0, 82,0,73,0,55,0,82,0];
const PAT_LEAD= [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 220,0,165,0,196,0,220,0,247,0,220,0,196,165,0,0];

function startMusic(){
  if(!audioReady||musicPlaying)return;
  musicPlaying=true; musicStep=0; nextStepTime=audioCtx.currentTime+0.1;
  scheduleMusicLoop();
}
function stopMusic(){
  musicPlaying=false;
  if(musicTimerId){clearInterval(musicTimerId);musicTimerId=null;}
}
function scheduleMusicLoop(){
  if(!musicPlaying)return;
  musicTimerId=setInterval(()=>{
    if(!musicPlaying||!audioReady)return;
    while(nextStepTime<audioCtx.currentTime+0.18){
      const s=musicStep%32, t=nextStepTime;
      if(PAT_KICK[s])mKick(t);
      if(PAT_CLAP[s])mClap(t);
      if(PAT_HHAT[s])mHihat(t,false);
      if(PAT_OHHT[s])mHihat(t,true);
      if(PAT_BASS[s])mBass(t,PAT_BASS[s]);
      if(PAT_LEAD[s])mLead(t,PAT_LEAD[s]);
      musicStep++; nextStepTime+=STEP_S;
    }
  },20);
}
function mKick(t){
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.frequency.setValueAtTime(110,t); o.frequency.exponentialRampToValueAtTime(35,t+0.18);
  g.gain.setValueAtTime(0.75,t); g.gain.exponentialRampToValueAtTime(.001,t+0.32);
  o.connect(g); g.connect(musicMaster); o.start(t); o.stop(t+0.35);
}
function mClap(t){
  const buf=makeNoiseBuf(0.14);
  const src=audioCtx.createBufferSource(),filt=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
  filt.type='highpass'; filt.frequency.value=900;
  g.gain.setValueAtTime(0.38,t); g.gain.exponentialRampToValueAtTime(.001,t+0.14);
  src.buffer=buf; src.connect(filt); filt.connect(g); g.connect(musicMaster); src.start(t);
}
function mHihat(t,open){
  const dur=open?0.14:0.035;
  const buf=makeNoiseBuf(dur);
  const src=audioCtx.createBufferSource(),filt=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
  filt.type='highpass'; filt.frequency.value=9000;
  g.gain.setValueAtTime(open?0.28:0.18,t); g.gain.exponentialRampToValueAtTime(.001,t+dur);
  src.buffer=buf; src.connect(filt); filt.connect(g); g.connect(musicMaster); src.start(t);
}
function mBass(t,freq){
  const o=audioCtx.createOscillator(),filt=audioCtx.createBiquadFilter(),g=audioCtx.createGain();
  o.type='sawtooth'; o.frequency.value=freq;
  filt.type='lowpass'; filt.frequency.value=700; filt.Q.value=2;
  g.gain.setValueAtTime(0.52,t); g.gain.exponentialRampToValueAtTime(.001,t+STEP_S*1.9);
  o.connect(filt); filt.connect(g); g.connect(musicMaster); o.start(t); o.stop(t+STEP_S*2);
}
function mLead(t,freq){
  const o=audioCtx.createOscillator(),o2=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.type='square'; o.frequency.value=freq;
  o2.type='sawtooth'; o2.frequency.value=freq*1.005;
  g.gain.setValueAtTime(0.20,t); g.gain.exponentialRampToValueAtTime(.001,t+STEP_S*1.85);
  o.connect(g); o2.connect(g); g.connect(musicMaster);
  o.start(t); o2.start(t); o.stop(t+STEP_S*2); o2.stop(t+STEP_S*2);
}
let _noiseBufs={};
function makeNoiseBuf(dur){
  const len=Math.round(audioCtx.sampleRate*dur);
  const key=len;
  if(_noiseBufs[key])return _noiseBufs[key];
  const buf=audioCtx.createBuffer(1,len,audioCtx.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
  _noiseBufs[key]=buf; return buf;
}

// ─── Start menu music on first interaction (any key/click/touch) ─
let menuMusicStarted=false;
function tryStartMenuMusic(){
  if(menuMusicStarted)return;
  menuMusicStarted=true;
  initAudio();
  startMusic();
}
// Hook into any user gesture so music starts immediately
['click','keydown','touchstart'].forEach(ev=>{
  document.addEventListener(ev, tryStartMenuMusic, {once:true, capture:true});
});
// Also fire on any first click or keypress anywhere on the page
function _firstInteraction(){
  tryStartMenuMusic();
  document.removeEventListener('click',_firstInteraction);
  document.removeEventListener('keydown',_firstInteraction);
}
document.addEventListener('click',_firstInteraction);
document.addEventListener('keydown',_firstInteraction);

function announce(text){
  if(!window.speechSynthesis)return;
  const u=new SpeechSynthesisUtterance(text);
  u.rate=1.05; u.pitch=0.92; u.volume=Math.max(0.2,sfxVolume);
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ═══════════════════════════════════════════════════════
//  THREE.JS INIT
// ═══════════════════════════════════════════════════════
const gc=document.getElementById('gc');
const renderer=new THREE.WebGLRenderer({canvas:gc,antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
const clock=new THREE.Clock();
const camChase=new THREE.PerspectiveCamera(72,1,.1,2000);
const camCock=new THREE.PerspectiveCamera(88,1,.05,2000);
let activeCam=camChase, camMode='chase';
const dc=document.getElementById('dc'),dctx=dc.getContext('2d');
const mmc=document.getElementById('mmc'),mmctx=mmc.getContext('2d');

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let gState='menu';
let selCar=null,selTrk=null;
let editorTracks=[],editorTrack=null,editorSelectedNode=0,editorSelectedAsset=-1,editorDrag=null,editorPreviewMode=false,editorPreviewOrbit={angle:0,radius:160,center:new THREE.Vector3()};
const camEditor=new THREE.PerspectiveCamera(55,1,.1,3000);
const raycaster=new THREE.Raycaster();
const editorGroundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
let editorNeedsRebuild=false,editorLastRebuild=0;
let editorCam={target:new THREE.Vector3(),yaw:0,pitch:1.16,distance:260};
let editorMouse={mode:null,lastX:0,lastY:0};
let raceCamOrbit={yaw:0,pitch:0,lastInput:0};
let raceTime=0;
let pCar=null,aiCars=[],allCars=[],trkData=null,trkCurve=null,trkPts=[],trkCurv=[];
let aiControllers=[];
let cityCorridors=null; // For city tracks: array of {x,z,hw,hd} axis-aligned driveable rectangles
let cityAiPts=null;    // For city tracks: dense waypoints following grid roads exactly
let settingsFromPause=false;
const TOUCH_TOGGLE_KEY='turborace_touch_controls';
let touchControlsEnabled=false;

const keys={};
const touchState={throttle:false,brake:false,left:false,right:false};
const touchPointers={throttle:new Set(),brake:new Set(),left:new Set(),right:new Set()};
document.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='KeyC'&&(gState==='racing'||gState==='cooldown'))toggleCam();
  if(e.code==='Escape'){
    if(gState==='racing'||gState==='cooldown')pauseRace();
    else if(gState==='paused')resumeRace();
  }
});
document.addEventListener('keyup',e=>{ keys[e.code]=false; });
document.addEventListener('pointermove',e=>{
  if((gState==='racing'||gState==='cooldown'||gState==='finished'||gState==='countdown')&&e.buttons===2){
    raceCamOrbit.yaw-=e.movementX*0.004;
    raceCamOrbit.pitch=Math.max(-0.55,Math.min(0.75,raceCamOrbit.pitch-e.movementY*0.003));
    raceCamOrbit.lastInput=performance.now();
  }
});


function isTouchControlsVisibleInState(state){
  return touchControlsEnabled&&(state==='racing'||state==='cooldown');
}

function updateTouchControlsVisibility(){
  const root=document.getElementById('touchControls');
  if(!root)return;
  root.style.display=isTouchControlsVisibleInState(gState)?'flex':'none';
}

function onTouchControlsToggle(enabled){
  touchControlsEnabled=!!enabled;
  const input=document.getElementById('touchToggleInput');
  if(input&&input.checked!==touchControlsEnabled)input.checked=touchControlsEnabled;
  localStorage.setItem(TOUCH_TOGGLE_KEY,touchControlsEnabled?'1':'0');
  if(!touchControlsEnabled)releaseAllTouchControls();
  updateTouchControlsVisibility();
}

function initTouchSettings(){
  const saved=localStorage.getItem(TOUCH_TOGGLE_KEY);
  touchControlsEnabled=(saved==='1');
  const input=document.getElementById('touchToggleInput');
  if(input)input.checked=touchControlsEnabled;
}

function setTouchControl(name,active){
  touchState[name]=active;
  const btn=document.querySelector(`#touchControls [data-control="${name}"]`);
  if(btn)btn.classList.toggle('active',!!active);
}

function syncTouchControlFromPointers(name){
  setTouchControl(name,touchPointers[name].size>0);
}

function releaseAllTouchControls(){
  Object.values(touchPointers).forEach(set=>set.clear());
  setTouchControl('throttle',false);
  setTouchControl('brake',false);
  setTouchControl('left',false);
  setTouchControl('right',false);
}

function setupTouchControls(){
  const root=document.getElementById('touchControls');
  if(!root)return;
  root.querySelectorAll('[data-control]').forEach(btn=>{
    const name=btn.dataset.control;
    const onPress=(e)=>{
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      touchPointers[name].add(e.pointerId);
      syncTouchControlFromPointers(name);
    };
    const onRelease=(e)=>{
      e.preventDefault();
      touchPointers[name].delete(e.pointerId);
      syncTouchControlFromPointers(name);
    };
    btn.addEventListener('pointerdown',onPress);
    btn.addEventListener('pointerup',onRelease);
    btn.addEventListener('pointercancel',onRelease);
    btn.addEventListener('pointerleave',e=>{ if(e.buttons===0) onRelease(e); });
    btn.addEventListener('contextmenu',e=>e.preventDefault());
  });
  root.querySelectorAll('[data-tap]').forEach(btn=>{
    const onTap=(e)=>{
      e.preventDefault();
      if(btn.dataset.tap==='camera' && (gState==='racing'||gState==='cooldown')) toggleCam();
      if(btn.dataset.tap==='pause'){
        if(gState==='racing'||gState==='cooldown') pauseRace();
        else if(gState==='paused') resumeRace();
      }
    };
    btn.addEventListener('pointerup',onTap);
    btn.addEventListener('contextmenu',e=>e.preventDefault());
  });
  window.addEventListener('pointerup',e=>{
    Object.keys(touchPointers).forEach(name=>{
      if(touchPointers[name].has(e.pointerId)){
        touchPointers[name].delete(e.pointerId);
        syncTouchControlFromPointers(name);
      }
    });
  });
  window.addEventListener('blur',releaseAllTouchControls);
}

// ═══════════════════════════════════════════════════════
//  CAR CLASS
// ═══════════════════════════════════════════════════════
class Car{
  constructor(data,pos,hdg,isPlayer){
    this.data=data; this.isPlayer=isPlayer;
    this.pos=new THREE.Vector3(pos.x,pos.y,pos.z);
    this.hdg=hdg; this.spd=0; this.rpm=800; this.gear=1;
    this.lap=0; this.lastCP=0; this.cpPassed=0;
    this.totalProg=0; this.finished=false; this.finTime=0; this.lapStart=0;
    this.tl=[]; this.wh=[];
    this.prevGear=1; this.rpmDrop=0; // for gear-shift RPM dip
    this.stuckTimer=0;               // for boundary recovery
    this.isReversing=false; this.revSpd=0; this.reverseTimer=0;
    this.mesh=this.buildMesh();
    this.mesh.position.copy(this.pos); this.mesh.rotation.y=this.hdg;
    scene.add(this.mesh);
  }

  buildMesh(){
    switch(this.data.id){
      case 0: return this.buildWedgeMesh();
      case 2: return this.buildJeepMesh();
      case 3: return this.buildHatchMesh();
      default: return this.buildSportsMesh();
    }
  }

  // ── Existing sports coupe (Thunder V8) ──────────────
  buildSportsMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x111111), Gm=matT(0x7799bb,.55), Wm=mat(0x111111), Rm=mat(0x777777);
    const Lm=matE(0xffee88,0x443300), TLm=matE(0xee1100,0x220000);
    addB(g,1.8,.48,4.0,0,.44,0,Bm); addB(g,1.38,.48,1.78,0,.93,.08,Bm);
    addB(g,1.28,.42,.06,0,.93,.98,Gm,0.22,0,0); addB(g,1.28,.38,.06,0,.90,-.82,Gm,-.18,0,0);
    [-1,1].forEach(s=>addB(g,.1,.18,3.6,s*.95,.28,0,Dm));
    addB(g,1.9,.07,.42,0,.21,2.1,Dm); addB(g,1.72,.08,.44,0,1.1,-1.78,Dm);
    [-.62,.62].forEach(x=>addB(g,.08,.34,.08,x,.93,-1.78,Dm));
    [-.56,.56].forEach(x=>addB(g,.38,.13,.05,x,.54,2.02,Lm));
    this.tl=[];[-.56,.56].forEach(x=>{const m=matE(0xee1100,0x220000);const t=addB(g,.38,.11,.05,x,.54,-2.02,m);this.tl.push(t);});
    this.wh=wheels(g,Wm,Rm,.33,.20,.26,.28,[[-1,1.32],[1,1.32],[-1,-1.32],[1,-1.32]]);
    return g;
  }

  // ── Lamborghini-style low wedge (Viper GT) ──────────
  buildWedgeMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x0e0e0e), Gm=matT(0x66aacc,.50), Wm=mat(0x0e0e0e), Rm=mat(0x666666);
    const Lm=matE(0xffffaa,0x554400), TLm=matE(0xff1100,0x330000);
    // Splitter / nosecone (very low)
    addB(g,1.75,.08,.9,0,.20,2.05,Dm);
    // Front hood – steps up in stages to create wedge profile
    addB(g,1.88,.16,1.0,0,.26,1.52,Bm);
    addB(g,1.92,.26,1.4,0,.34,.6,Bm);
    // Main body slab
    addB(g,2.0,.30,2.4,0,.40,-.2,Bm);
    // Rear haunches (wider)
    addB(g,2.06,.38,1.0,0,.40,-1.6,Bm);
    // Cabin – very low and flat
    addB(g,1.30,.22,1.65,0,.74,.05,Bm);
    addB(g,1.35,.07,1.72,0,.88,.05,Dm); // roof cap
    // Very raked windscreen
    const ws=addB(g,1.22,.35,.06,0,.80,.88,Gm,0.58,0,0);
    addB(g,1.22,.28,.06,0,.80,-.75,Gm,-.48,0,0); // rear glass
    // Side air intakes (scoops)
    [-1,1].forEach(s=>{addB(g,.12,.3,.75,s*1.02,.58,-.40,Dm); addB(g,.06,.3,.7,s*1.04,.58,-.40,Dm);});
    // Diffuser
    addB(g,2.0,.14,.55,0,.28,-2.1,Dm);
    // Rear wing + endplates
    addB(g,1.88,.06,.65,0,1.06,-1.88,Dm);
    [-.9,.9].forEach(x=>addB(g,.07,.38,.67,x,.87,-1.88,Dm));
    // Wing standoffs
    [-.6,.6].forEach(x=>addB(g,.06,.32,.06,x,.88,-1.88,Dm));
    // Hood vents
    [-0.4,0,0.4].forEach(x=>addB(g,.36,.04,.5,x,.50,1.0,Dm));
    // Side skirts
    [-1,1].forEach(s=>addB(g,.08,.14,3.4,s*1.02,.24,0,Dm));
    // Headlights – thin horizontal slits
    [-.58,.58].forEach(x=>{addB(g,.52,.07,.05,x,.38,2.01,Lm);});
    // LED strip headlight accent
    addB(g,1.4,.03,.05,0,.34,2.01,Lm);
    this.tl=[];
    [-.62,.62].forEach(x=>{const m=matE(0xff1100,0x330000);const t=addB(g,.5,.07,.05,x,.38,-2.01,m);this.tl.push(t);});
    // Wide LED strip tail
    addB(g,1.5,.03,.05,0,.34,-2.01,matE(0xff1100,0x220000));
    // Wheels – wide and low profile
    this.wh=wheels(g,Wm,Rm,.32,.24,.30,.32,[[-1.05,1.38],[1.05,1.38],[-1.05,-1.38],[1.05,-1.38]]);
    return g;
  }

  // ── Jeep / off-road (Rally Storm) ───────────────────
  buildJeepMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x181818), Gm=matT(0x88aacc,.52), Wm=mat(0x181818), Rm=mat(0x555555);
    const Lm=matE(0xffffcc,0x443300), TLm=matE(0xff2200,0x330000);
    // High chassis body
    addB(g,1.88,.65,3.75,0,.82,0,Bm);
    // Tall boxy cabin
    addB(g,1.78,.92,2.35,0,1.60,-.04,Bm);
    // Separate flat hood with slight raise
    addB(g,1.76,.20,1.45,0,1.23,1.20,Bm);
    // Windscreen – upright
    addB(g,1.62,.72,.07,0,1.58,1.10,Gm,.06,0,0);
    addB(g,1.62,.62,.07,0,1.58,-1.10,Gm,-.06,0,0); // rear window
    // Side windows
    [-1,1].forEach(s=>addB(g,.07,.60,2.0,s*.90,1.62,-.04,Gm));
    // Roof rack frame
    addB(g,1.84,.06,2.4,0,2.09,-.04,Dm);
    [-.88,.88].forEach(x=>addB(g,.06,.06,2.3,x,2.09,-.04,Dm));
    [-0.9,0.9].forEach(z=>addB(g,1.8,.06,.07,0,2.09,z,Dm));
    // Bull bar
    addB(g,1.72,.54,.1,0,.90,1.97,Dm);
    [-.62,0,.62].forEach(x=>addB(g,.08,.64,.20,x,.86,1.88,Dm));
    // Horizontal bull-bar bars
    [.25,.65].forEach(y=>addB(g,1.6,.07,.07,0,y,1.93,Dm));
    // Side steps
    [-1,1].forEach(s=>addB(g,.16,.14,3.0,s*1.08,.50,0,Dm));
    // Fender flares
    [[-1,1.12],[1,1.12],[-1,-1.12],[1,-1.12]].forEach(([sx,sz])=>addB(g,.20,.32,.88,sx*1.04,.82,sz,Dm));
    // Snorkel (right side)
    addB(g,.11,1.25,.11,.92,1.6,1.1,Dm);
    addB(g,.22,.11,.11,.92,2.24,1.1,Dm); // elbow cap
    // Spare tire on rear
    const sp=new THREE.Mesh(new THREE.CylinderGeometry(.44,.44,.24,10),Wm);
    sp.rotation.z=Math.PI/2; sp.position.set(0,1.48,-2.06); g.add(sp);
    const sc=new THREE.Mesh(new THREE.CylinderGeometry(.30,.30,.26,8),Rm);
    sc.rotation.z=Math.PI/2; sc.position.set(0,1.48,-2.06); g.add(sc);
    // Headlights – square/round
    [-.56,.56].forEach(x=>addB(g,.40,.40,.06,x,1.06,1.93,Lm));
    this.tl=[];
    [-.56,.56].forEach(x=>{const m=matE(0xff2200,0x330000);const t=addB(g,.38,.30,.06,x,1.06,-1.93,m);this.tl.push(t);});
    // Extra brake lights strip
    addB(g,1.6,.07,.06,0,.80,-1.93,matE(0xff0000,0x220000));
    // Big off-road wheels
    this.wh=wheels(g,Wm,Rm,.48,.32,.30,.36,[[-1.04,1.12],[1.04,1.12],[-1.04,-1.12],[1.04,-1.12]],0.18);
    return g;
  }

  // ── Hatchback (Flash Hatch) ─────────────────────────
  buildHatchMesh(){
    const g=new THREE.Group(), C=this.data.col;
    const Bm=mat(C), Dm=mat(0x111111), Gm=matT(0x7799bb,.55), Wm=mat(0x111111), Rm=mat(0x666666);
    const Lm=matE(0xffee88,0x443300);
    // Main body — compact, short
    addB(g,1.65,.45,3.2,0,.48,0,Bm);
    // Cabin — taller, boxy hatchback shape
    addB(g,1.50,.50,1.8,0,.98,-.15,Bm);
    // Roof
    addB(g,1.48,.06,1.7,0,1.24,-.15,Dm);
    // Windscreen — moderately raked
    addB(g,1.38,.42,.06,0,.92,.78,Gm,0.30,0,0);
    // Rear hatch glass — steep angle (hatchback signature)
    addB(g,1.38,.45,.06,0,.92,-1.0,Gm,-.55,0,0);
    // Side windows
    [-1,1].forEach(s=>addB(g,.06,.38,1.5,s*.76,.98,-.15,Gm));
    // Hood
    addB(g,1.60,.10,1.0,0,.72,1.12,Bm);
    // Front bumper
    addB(g,1.68,.22,.35,0,.32,1.68,Dm);
    // Rear bumper
    addB(g,1.68,.22,.30,0,.32,-1.68,Dm);
    // Side skirts
    [-1,1].forEach(s=>addB(g,.06,.16,2.8,s*.84,.30,0,Dm));
    // Small rear spoiler
    addB(g,1.30,.06,.30,0,1.26,-1.0,Dm);
    // Headlights — round-ish
    [-.52,.52].forEach(x=>addB(g,.35,.18,.05,x,.52,1.62,Lm));
    // Taillights
    this.tl=[];
    [-.52,.52].forEach(x=>{const m=matE(0xee1100,0x220000);const t=addB(g,.30,.15,.05,x,.52,-1.62,m);this.tl.push(t);});
    // Wheels — small, sporty
    this.wh=wheels(g,Wm,Rm,.30,.18,.24,.26,[[-0.85,1.15],[0.85,1.15],[-0.85,-1.15],[0.85,-1.15]]);
    return g;
  }

  // ── Physics update ───────────────────────────────────
  update(inp,dt){
    if(this.finished)return;
    const{thr,brk,str}=inp;

    // ── Reverse gear: hold brake while stopped (player only) ──
    if(this.isPlayer && this.spd<0.3 && brk>0.5 && thr<0.1 && !this.isReversing){
      this.reverseTimer=(this.reverseTimer||0)+dt;
      if(this.reverseTimer>0.3) this.isReversing=true;
    } else if(thr>0.1){
      this.isReversing=false; this.reverseTimer=0;
    }
    if(this.isReversing && this.spd<0.3 && brk<0.1) this.isReversing=false;

    if(this.isReversing){
      // Reverse: brake input drives backward, gear shows R
      this.gear=0; // 0 = reverse
      this.rpm=Math.max(800,Math.min(3000,800+this.revSpd*200));
      const revAccel=brk*this.data.accel*0.4;
      const revDrag=this.revSpd*this.revSpd*0.01+this.revSpd*0.2;
      this.revSpd=Math.max(0,Math.min(8,this.revSpd+(revAccel-revDrag)*dt));
      if(thr>0.1){ this.revSpd=Math.max(0,this.revSpd-this.data.brake*0.5*dt); }
      this.spd=0;
      // Steer reversed
      const sf=Math.max(.5,1-this.revSpd/8*.4);
      if(this.revSpd>0.3)this.hdg-=str*this.data.hdl*1.8*sf*dt;
      const fwd=new THREE.Vector3(Math.sin(this.hdg),0,Math.cos(this.hdg));
      this.pos.addScaledVector(fwd,-this.revSpd*dt);
    } else {
      this.revSpd=0;
      // Auto gearbox — per-car gear count
      const nGears=this.data.gears||4;
      const gThr=this.data.gearThr||[0,10,22,36,this.data.maxSpd+2];
      const RATIOS=this.data.gearRat||[620,281,172,112];
      if(this.gear<1)this.gear=1;
      if(this.gear<nGears&&this.spd>gThr[this.gear])this.gear=Math.min(nGears,this.gear+1);
      else if(this.gear>1&&this.spd<gThr[this.gear-1]*.72)this.gear=Math.max(1,this.gear-1);
      const baseRpm=800+RATIOS[this.gear-1]*this.spd;
      this.rpm=Math.max(800,Math.min(8000,baseRpm+(thr>.1?thr*300:0)));
      // Forces — drag tuned per car so full throttle reaches exactly maxSpd
      const thrust=thr*this.data.accel;
      const rollCoeff=0.08;
      const dragCoeff=(this.data.accel-this.data.maxSpd*rollCoeff)/(this.data.maxSpd*this.data.maxSpd);
      const drag=this.spd*this.spd*dragCoeff;
      const roll=this.spd*rollCoeff;
      const bForce=brk*this.data.brake;
      this.spd=Math.max(0,Math.min(this.data.maxSpd,this.spd+(thrust-drag-roll-bForce)*dt));
      // Steering
      const sf=Math.max(.28,1-this.spd/this.data.maxSpd*.60);
      if(this.spd>.5)this.hdg+=str*this.data.hdl*2.2*sf*dt;
      // Move forward
      const fwd=new THREE.Vector3(Math.sin(this.hdg),0,Math.cos(this.hdg));
      this.pos.addScaledVector(fwd,this.spd*dt);
    }

    this.pos.y=this.groundY();
    this.mesh.position.copy(this.pos); this.mesh.rotation.y=this.hdg;
    // Wheel spin & steer
    const wr=(this.isReversing?-this.revSpd:this.spd)*dt*2.2;
    for(const w of this.wh)w.children[0].rotation.x+=wr;
    if(this.wh[0])this.wh[0].rotation.y=str*.40;
    if(this.wh[1])this.wh[1].rotation.y=str*.40;
    // Brake lights (on during braking or reversing)
    const bOn=brk>.1||this.isReversing;
    const bc=bOn?0xee1100:0x440500,be=bOn?0x881100:0x100100;
    for(const t of this.tl){t.material.color.set(bc);t.material.emissive.set(be);}
    this.boundary(dt); this.progress();
  }

  groundY(){
    if(!trkPts.length)return this.data.gndOff;
    let md=Infinity,ny=0;
    for(const p of trkPts){const d=(this.pos.x-p.x)**2+(this.pos.z-p.z)**2;if(d<md){md=d;ny=p.y;}}
    return ny+this.data.gndOff;
  }

  boundary(dt){
    if(!trkPts.length)return;

    // ── City tracks: use grid corridors ──
    if(cityCorridors&&cityCorridors.length){
      const px=this.pos.x,pz=this.pos.z;
      let inside=false;
      for(const c of cityCorridors){
        if(px>c.x-c.hw&&px<c.x+c.hw&&pz>c.z-c.hd&&pz<c.z+c.hd){inside=true;break;}
      }
      if(!inside){
        // Find nearest corridor edge and push back
        let bestDist=Infinity,bestPx=px,bestPz=pz;
        for(const c of cityCorridors){
          const cx=Math.max(c.x-c.hw,Math.min(c.x+c.hw,px));
          const cz=Math.max(c.z-c.hd,Math.min(c.z+c.hd,pz));
          const d=(px-cx)**2+(pz-cz)**2;
          if(d<bestDist){bestDist=d;bestPx=cx;bestPz=cz;}
        }
        this.pos.x=bestPx; this.pos.z=bestPz;
        this.spd*=0.4;
        if(this.isReversing)this.revSpd*=0.3;
        this.stuckTimer+=dt;
      } else {
        this.stuckTimer=Math.max(0,this.stuckTimer-0.04);
      }
      return;
    }

    // ── Spline-based boundary for normal tracks ──
    let md=Infinity,ni=0;
    for(let i=0;i<trkPts.length;i++){
      const d=(this.pos.x-trkPts[i].x)**2+(this.pos.z-trkPts[i].z)**2;
      if(d<md){md=d;ni=i;}
    }
    const np=trkPts[ni];
    const dist=Math.sqrt(md),maxD=trkData.rw*.5+1.0;
    if(dist>maxD){
      const px=np.x-this.pos.x,pz=np.z-this.pos.z,pl=Math.sqrt(px*px+pz*pz)||1;
      this.pos.x+=px/pl*(dist-maxD+0.5);
      this.pos.z+=pz/pl*(dist-maxD+0.5);
      this.spd*=0.45;
      const nxt=trkPts[(ni+1)%trkPts.length];
      const prv=trkPts[(ni+trkPts.length-1)%trkPts.length];
      const tx=nxt.x-prv.x, tz=nxt.z-prv.z;
      const trkHdg=Math.atan2(tx,tz);
      let he=((trkHdg-this.hdg+Math.PI*3)%(Math.PI*2))-Math.PI;
      const heR=he>0?he-Math.PI:he+Math.PI;
      if(Math.abs(heR)<Math.abs(he))he=heR;
      this.hdg+=he*0.75;
      this.stuckTimer+=dt;
    } else {
      this.stuckTimer=Math.max(0,this.stuckTimer-0.032);
    }
  }

  progress(){
    if(!trkData)return;
    const wps=trkData.wp,n=wps.length,cr=22;
    for(let i=0;i<n;i++){
      const w=wps[i];
      const d=Math.sqrt((this.pos.x-w[0])**2+(this.pos.z-w[2])**2);
      if(d<cr&&i!==this.lastCP){
        const exp=(this.lastCP+1+n)%n;
        if(i===exp){
          this.lastCP=i; this.cpPassed++;
          if(i===0&&this.cpPassed>=n){
            this.cpPassed=0; this.lap++;
            const lt=raceTime-this.lapStart; this.lapStart=raceTime;
            if(this.isPlayer){
              const startingFinal=this.lap===trkData.laps-1;
              notify('LAP '+this.lap+'/'+trkData.laps+(this.lap>1?' · '+fmtT(lt):''));
              if(startingFinal) announce('Final lap! Push it to the limit!');
              else if(this.lap>1) announce('Lap '+(this.lap)+'. '+fmtT(lt));
            }
            if(this.lap>=trkData.laps){this.finished=true;this.finTime=raceTime;if(this.isPlayer)endRace();}
          }
        }
      }
    }
    const ni=(this.lastCP+1+n)%n,nw=trkData.wp[ni];
    const dd=Math.sqrt((this.pos.x-nw[0])**2+(this.pos.z-nw[2])**2);
    this.totalProg=this.lap*n+this.cpPassed+Math.max(0,1-dd/35);
  }
}

// ─── Mesh helpers ──────────────────────────────────────
function mat(c){return new THREE.MeshLambertMaterial({color:c,side:THREE.DoubleSide});}
function matT(c,o){return new THREE.MeshLambertMaterial({color:c,transparent:true,opacity:o,side:THREE.DoubleSide});}
function matE(c,e){return new THREE.MeshLambertMaterial({color:c,emissive:e,side:THREE.DoubleSide});}
function addB(g,w,h,d,x,y,z,m,rx,ry,rz){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
  mesh.position.set(x,y,z);
  if(rx)mesh.rotation.x=rx;
  if(ry)mesh.rotation.y=ry;
  if(rz)mesh.rotation.z=rz;
  g.add(mesh); return mesh;
}
function wheels(g,Wm,Rm,wr,ir,wt,it,positions,yOff){
  yOff=yOff||0;
  const wg=new THREE.CylinderGeometry(wr,wr,wt,12);
  const ig=new THREE.CylinderGeometry(ir,ir,it,8);
  const res=[];
  for(const[wx,wz]of positions){
    const wgrp=new THREE.Group();
    const w=new THREE.Mesh(wg,Wm); w.rotation.z=Math.PI/2; wgrp.add(w);
    const wh=new THREE.Mesh(ig,Rm); wh.rotation.z=Math.PI/2; wgrp.add(wh);
    wgrp.position.set(wx,yOff,wz); g.add(wgrp); res.push(wgrp);
  }
  return res;
}

// ═══════════════════════════════════════════════════════
//  AI CONTROLLER
// ═══════════════════════════════════════════════════════
class AI{
  constructor(car,la){this.car=car;this.la=la||.055;this.slowTimer=0;this.prevPos=null;this.stuckCount=0;}
  update(dt){
    if(!trkPts.length||this.car.finished)return;
    const c=this.car;

    // ── Stuck detection ──
    if(!this.prevPos) this.prevPos={x:c.pos.x,z:c.pos.z};
    const moved=Math.sqrt((c.pos.x-this.prevPos.x)**2+(c.pos.z-this.prevPos.z)**2);
    this.prevPos.x=c.pos.x; this.prevPos.z=c.pos.z;
    if(moved<0.015*dt*60) this.slowTimer+=dt;
    else { this.slowTimer=Math.max(0,this.slowTimer-dt*3); this.stuckCount=0; }

    // If stuck: teleport to track center a bit ahead (generous timers)
    if(c.stuckTimer>1.5 || this.slowTimer>2.5){
      c.stuckTimer=0; this.slowTimer=0; this.stuckCount++;
      const navP=cityAiPts?cityAiPts.pts:trkPts;
      let md2=Infinity,ri2=0;
      for(let i=0;i<navP.length;i++){const d=(c.pos.x-navP[i].x)**2+(c.pos.z-navP[i].z)**2;if(d<md2){md2=d;ri2=i;}}
      const ahead=5+this.stuckCount*5;
      const tp=navP[(ri2+ahead)%navP.length];
      const nxt=navP[(ri2+ahead+3)%navP.length];
      c.pos.x=tp.x; c.pos.z=tp.z;
      c.hdg=Math.atan2(nxt.x-tp.x,nxt.z-tp.z);
      c.spd=3; c.isReversing=false; c.revSpd=0;
      return;
    }

    // ── Normal driving ──────────────────────────────────
    const useCity=!!cityAiPts;
    const navPts=useCity?cityAiPts.pts:trkPts;
    const navCurv=useCity?cityAiPts.curv:trkCurv;
    let md=Infinity,ci=0;
    for(let i=0;i<navPts.length;i++){const d=(c.pos.x-navPts[i].x)**2+(c.pos.z-navPts[i].z)**2;if(d<md){md=d;ci=i;}}
    const n=navPts.length;

    // ── Lookahead ──
    const speedFrac=c.spd/c.data.maxSpd;
    let ti;
    if(useCity){
      // City: waypoints already follow grid roads, just look ahead by speed
      // Short lookahead so AI follows the L-shaped path point by point
      const look=Math.round(4+speedFrac*12); // 4-16 points (at 2m spacing = 8-32m)
      ti=(ci+look)%n;
    } else {
      // Non-city: walk along spline, stop before sharp corners
      const maxLook=Math.round(3+speedFrac*25);
      ti=ci;
      for(let step=1;step<=maxLook;step++){
        const si=(ci+step)%n;
        if(navCurv[si]>0.25){ ti=si; break; }
        ti=si;
      }
    }

    let tgtX=navPts[ti].x, tgtZ=navPts[ti].z;

    // City corridors: bias toward corridor center when near walls
    if(cityCorridors&&cityCorridors.length){
      const px=c.pos.x,pz=c.pos.z;
      for(const cr of cityCorridors){
        if(px>cr.x-cr.hw&&px<cr.x+cr.hw&&pz>cr.z-cr.hd&&pz<cr.z+cr.hd){
          const dL=px-(cr.x-cr.hw), dR=(cr.x+cr.hw)-px;
          const dB=pz-(cr.z-cr.hd), dT=(cr.z+cr.hd)-pz;
          const wallMin=Math.min(dL,dR,dB,dT);
          const margin=4.0;
          if(wallMin<margin){
            const blend=Math.pow(1-wallMin/margin,2)*0.5;
            tgtX=tgtX*(1-blend)+cr.x*blend;
            tgtZ=tgtZ*(1-blend)+cr.z*blend;
          }
          break;
        }
      }
    }

    const dx=tgtX-c.pos.x,dz=tgtZ-c.pos.z;
    const dh=Math.atan2(dx,dz);
    let he=((dh-c.hdg+Math.PI*3)%(Math.PI*2))-Math.PI;
    let str=Math.max(-1,Math.min(1,he*2.5));
    const ts=Math.abs(he);

    // ── Physics-based braking ──
    // Scan further ahead at high speed
    const scanDist=Math.round(20+speedFrac*80); // 20-100 points ahead
    let worstCurv=0, worstDist=Infinity;
    for(let k=1;k<scanDist;k++){
      const ki=(ci+k)%n;
      if(navCurv[ki]>worstCurv){worstCurv=navCurv[ki]; worstDist=k;}
    }
    // Target speed: inversely proportional to curvature
    // At curvature 0 = full speed, at curvature 1 = 25% of max
    const cornerSpeed=c.data.maxSpd*(0.25+0.75*(1-worstCurv));
    const speedOverTarget=c.spd-cornerSpeed;
    // Distance to corner in metres (~2m per point on spline tracks)
    const ptSpacing=useCity?2:2;
    const distToCorner=worstDist*ptSpacing;
    // Required deceleration: v² = u² - 2as → a = (u²-v²)/(2s)
    let reqBrake=0;
    if(speedOverTarget>0&&distToCorner>0){
      const reqDecel=(c.spd*c.spd-cornerSpeed*cornerSpeed)/(2*distToCorner);
      reqBrake=Math.min(1,reqDecel/c.data.brake);
    }

    let thr=ts<.30?1:Math.max(.45,1-ts*0.8);
    let brk=Math.max(ts>.70?(ts-.70)*1.5:0, reqBrake);
    // Cut throttle when braking
    if(brk>0.2) thr=Math.min(thr,1-brk);

    // Spline-based wall avoidance for non-city tracks
    if(!cityCorridors&&trkData){
      const edgeDist=Math.sqrt(md);
      const wallDist=trkData.rw*0.5;
      if(edgeDist>wallDist*0.5){
        const np=trkPts[ci];
        const pullAngle=Math.atan2(np.x-c.pos.x,np.z-c.pos.z);
        let pullErr=((pullAngle-c.hdg+Math.PI*3)%(Math.PI*2))-Math.PI;
        const pushFactor=Math.min(1,(edgeDist-wallDist*0.5)/(wallDist*0.5));
        str=Math.max(-1,Math.min(1,str+pullErr*pushFactor*1.5));
      }
    }

    thr*=c.data.aiSpd*c.aiAgg;
    if(pCar){const lead=c.totalProg-pCar.totalProg;if(lead>8)thr*=.93;else if(lead<-8)thr=Math.min(1,thr*1.05);}
    c.update({thr,brk:Math.min(1,brk),str},dt);
  }
}

// ═══════════════════════════════════════════════════════
//  ROAD TEXTURE
// ═══════════════════════════════════════════════════════
function makeRoadTexture(){
  const c=document.createElement('canvas'); c.width=512; c.height=512;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#1c1c1c'; ctx.fillRect(0,0,512,512);
  for(let i=0;i<14000;i++){
    const x=Math.random()*512,y=Math.random()*512,b=Math.floor(18+Math.random()*28);
    ctx.fillStyle=`rgb(${b},${b},${b})`; ctx.fillRect(x,y,1,1);
  }
  for(let i=0;i<300;i++){
    const x=Math.random()*512,y=Math.random()*512,r=.8+Math.random()*1.8,b=Math.floor(28+Math.random()*22);
    ctx.fillStyle=`rgb(${b},${b},${b})`; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  for(let i=0;i<18;i++){
    const x=Math.random()*512;
    ctx.strokeStyle=`rgba(55,55,55,${Math.random()*.18})`; ctx.lineWidth=Math.random()*2+.5;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+Math.random()*40-20,512); ctx.stroke();
  }
  const tex=new THREE.CanvasTexture(c);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(1,20);
  return tex;
}
let roadTex=null;

// ═══════════════════════════════════════════════════════
//  TRACK GENERATION
// ═══════════════════════════════════════════════════════
function buildTrack(data){
  cityCorridors=null; cityAiPts=null;
  const rm=[]; scene.traverse(o=>{if(o.userData.trk)rm.push(o);}); rm.forEach(o=>scene.remove(o));
  const raw=data.wp.map(w=>new THREE.Vector3(w[0],w[1],w[2]));
  const curve=new THREE.CatmullRomCurve3(raw,true,'centripetal',.5);
  trkCurve=curve; trkPts=curve.getSpacedPoints(500);
  // Precompute per-point curvature (0=straight, 1=very tight) for AI adaptive lookahead
  trkCurv=[];
  const N=trkPts.length;
  for(let i=0;i<N;i++){
    const a=trkPts[(i-2+N)%N],b=trkPts[i],c=trkPts[(i+2)%N];
    const ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z;
    const la=Math.sqrt(ax*ax+az*az)||1,lb=Math.sqrt(bx*bx+bz*bz)||1;
    const dot=(ax*bx+az*bz)/(la*lb);
    trkCurv[i]=Math.max(0,1-Math.min(1,(dot+1)/2*1.2)); // 0=straight 1=hairpin
  }

  // ── Adaptive segment counts: more on curves, fewer on straights ──
  const isCity=data.type==='city';
  // Generate curvature-adaptive point indices from the uniform trkPts
  function adaptivePts(maxPts,minStep,maxStep){
    const res=[trkPts[0]]; let i=0;
    while(i<N-1){
      const c=trkCurv[i]||0;
      const step=Math.round(minStep+(1-c)*(maxStep-minStep));
      i=Math.min(i+step,N-1);
      res.push(trkPts[i]);
    }
    // NO closing point — leave a gap at S/F for barriers
    return res;
  }
  const adaptRoad=adaptivePts(500,1,8);    // dense on corners, sparse on straights
  const adaptKerb=adaptivePts(200,1,5);
  const adaptBarrier=adaptivePts(240,1,6);

  if(!roadTex)roadTex=makeRoadTexture();
  if(!isCity){
    addRibbon(curve,data.rw,500,0,0,0,.005,true,roadTex);
    addRibbon(curve,.30,300,0,0xffffff,0,.028,false);
    addKerbAdaptive(adaptKerb,data.rw,1);
    addKerbAdaptive(adaptKerb,data.rw,-1);
    addBarriersAdaptive(adaptBarrier,data.rw);
  }
  // Ground plane
  const gndCol=isCity?data.gnd:0x1a3018;
  const gnd=new THREE.Mesh(new THREE.PlaneGeometry(1400,1400),new THREE.MeshLambertMaterial({color:gndCol}));
  gnd.rotation.x=-Math.PI/2; gnd.position.y=-.08; gnd.receiveShadow=true; gnd.userData.trk=true; scene.add(gnd);
  if(!isCity) addGantry(curve,data.rw);
  if(isCity) addCityScenery(curve,data);
  else addScenery(curve,data);
  applyPlacedAssets(data);
  scene.background=new THREE.Color(data.sky);
  const fogNear=isCity?120:260, fogFar=isCity?420:680;
  scene.fog=new THREE.Fog(data.sky,fogNear,fogFar);
  return curve;
}

function addRibbon(curve,width,segs,offset,color,yExtra,yBase,recv,tex){
  const pts=curve.getSpacedPoints(segs),verts=[],uvs=[],idx=[];
  for(let i=0;i<=segs;i++){
    const pt=pts[i],nx=pts[(i+1)%(segs+1)];
    const t=new THREE.Vector3().subVectors(nx,pt).normalize();
    const r=new THREE.Vector3(-t.z,0,t.x).normalize();
    const c=pt.clone().addScaledVector(r,offset);
    const l=c.clone().addScaledVector(r,-width/2),ri=c.clone().addScaledVector(r,width/2);
    verts.push(l.x,l.y+yBase+yExtra,l.z,ri.x,ri.y+yBase+yExtra,ri.z);
    const v=i/segs; uvs.push(0,v,1,v);
    if(i<segs){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  idx.push(segs*2,0,segs*2+1,segs*2+1,0,1);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m=tex?new THREE.MeshLambertMaterial({map:tex,side:THREE.DoubleSide}):new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geo,m); if(recv)mesh.receiveShadow=true;
  mesh.userData.trk=true; scene.add(mesh);
}

function addKerb(curve,rw,segs,side){
  const kw=1.6;
  const pts=curve.getSpacedPoints(segs);
  const n=pts.length;
  const matR=new THREE.MeshLambertMaterial({color:0xdd1111,side:THREE.DoubleSide});
  const matW=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
  // Averaged per-point normals → no overlaps on inside of curves
  const norms=[];
  for(let i=0;i<n;i++){
    const p=pts[(i-1+n)%n],q=pts[(i+1)%n];
    const tx=q.x-p.x,tz=q.z-p.z,l=Math.sqrt(tx*tx+tz*tz)||1;
    norms.push(new THREE.Vector3(-tz/l,0,tx/l));
  }
  const ko=side*(rw/2+kw/2+0.05);
  const STRIPE=4;
  for(let i=0;i<segs;i++){
    const p0=pts[i],p1=pts[i+1],r0=norms[i],r1=norms[i+1];
    const c0=new THREE.Vector3(p0.x+r0.x*ko,p0.y+.015,p0.z+r0.z*ko);
    const c1=new THREE.Vector3(p1.x+r1.x*ko,p1.y+.015,p1.z+r1.z*ko);
    const l0=new THREE.Vector3(c0.x-r0.x*kw/2,c0.y,c0.z-r0.z*kw/2);
    const rv0=new THREE.Vector3(c0.x+r0.x*kw/2,c0.y,c0.z+r0.z*kw/2);
    const l1=new THREE.Vector3(c1.x-r1.x*kw/2,c1.y,c1.z-r1.z*kw/2);
    const rv1=new THREE.Vector3(c1.x+r1.x*kw/2,c1.y,c1.z+r1.z*kw/2);
    const v=new Float32Array([l0.x,l0.y,l0.z,rv0.x,rv0.y,rv0.z,rv1.x,rv1.y,rv1.z,l1.x,l1.y,l1.z]);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(v,3));
    geo.setIndex([0,1,2,0,2,3]); geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,Math.floor(i/STRIPE)%2===0?matR:matW);
    mesh.userData.trk=true; scene.add(mesh);
  }
}

function addBarriers(curve,rw,segs){
  const pts=curve.getSpacedPoints(segs);
  const n=pts.length;
  // Averaged per-point normals — eliminates overlap on inner curves and gaps on outer
  const norms=[];
  for(let i=0;i<n;i++){
    const p=pts[(i-1+n)%n],q=pts[(i+1)%n];
    const tx=q.x-p.x,tz=q.z-p.z,l=Math.sqrt(tx*tx+tz*tz)||1;
    norms.push(new THREE.Vector3(-tz/l,0,tx/l));
  }
  for(const side of[-1,1]){
    const vL=[],vT=[],iL=[],iT=[]; let vi=0,ti=0;
    const off=side*(rw/2+2.0),h=1.15;
    for(let i=0;i<segs;i++){
      const p0=pts[i],p1=pts[i+1],r0=norms[i],r1=norms[i+1];
      const b0x=p0.x+r0.x*off,b0z=p0.z+r0.z*off;
      const b1x=p1.x+r1.x*off,b1z=p1.z+r1.z*off;
      vL.push(b0x,p0.y,b0z, b1x,p1.y,b1z, b1x,p1.y+h,b1z, b0x,p0.y+h,b0z);
      iL.push(vi,vi+1,vi+2,vi,vi+2,vi+3); vi+=4;
      vT.push(b0x,p0.y+h,b0z, b1x,p1.y+h,b1z, b1x,p1.y+h+.16,b1z, b0x,p0.y+h+.16,b0z);
      iT.push(ti,ti+1,ti+2,ti,ti+2,ti+3); ti+=4;
    }
    const mkGeo=(v,i)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);g.computeVertexNormals();return g;};
    const bm=new THREE.Mesh(mkGeo(vL,iL),new THREE.MeshLambertMaterial({color:0x888888,side:THREE.DoubleSide}));
    bm.userData.trk=true; scene.add(bm);
    const tm=new THREE.Mesh(mkGeo(vT,iT),new THREE.MeshLambertMaterial({color:side===-1?0xff2211:0xffffff,side:THREE.DoubleSide}));
    tm.userData.trk=true; scene.add(tm);
  }
}

// ── Adaptive versions: take pre-sampled point arrays ──────
function addKerbAdaptive(pts,rw,side){
  const kw=1.6;
  const n=pts.length;
  const matR=new THREE.MeshLambertMaterial({color:0xdd1111,side:THREE.DoubleSide});
  const matW=new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide});
  const norms=[];
  for(let i=0;i<n;i++){
    const p=pts[(i-1+n)%n],q=pts[(i+1)%n];
    const tx=q.x-p.x,tz=q.z-p.z,l=Math.sqrt(tx*tx+tz*tz)||1;
    norms.push(new THREE.Vector3(-tz/l,0,tx/l));
  }
  const ko=side*(rw/2+kw/2+0.05);
  const STRIPE=4;
  // Batch into single geometry
  const allVerts=[],allIdx=[];let vi=0;
  const allVertsW=[],allIdxW=[];let viW=0;
  for(let i=0;i<n-1;i++){
    const p0=pts[i],p1=pts[i+1],r0=norms[i],r1=norms[i+1];
    const c0x=p0.x+r0.x*ko,c0z=p0.z+r0.z*ko;
    const c1x=p1.x+r1.x*ko,c1z=p1.z+r1.z*ko;
    const hw=kw/2;
    const isRed=Math.floor(i/STRIPE)%2===0;
    const v=isRed?allVerts:allVertsW, ix=isRed?allIdx:allIdxW;
    const base=isRed?vi:viW;
    v.push(c0x-r0.x*hw,.015,c0z-r0.z*hw, c0x+r0.x*hw,.015,c0z+r0.z*hw,
           c1x+r1.x*hw,.015,c1z+r1.z*hw, c1x-r1.x*hw,.015,c1z-r1.z*hw);
    ix.push(base,base+1,base+2,base,base+2,base+3);
    if(isRed)vi+=4;else viW+=4;
  }
  const mkGeo=(v,i)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);g.computeVertexNormals();return g;};
  if(allVerts.length){const m=new THREE.Mesh(mkGeo(allVerts,allIdx),matR);m.userData.trk=true;scene.add(m);}
  if(allVertsW.length){const m=new THREE.Mesh(mkGeo(allVertsW,allIdxW),matW);m.userData.trk=true;scene.add(m);}
}

function addBarriersAdaptive(pts,rw){
  const n=pts.length;
  const norms=[];
  for(let i=0;i<n;i++){
    const p=pts[(i-1+n)%n],q=pts[(i+1)%n];
    const tx=q.x-p.x,tz=q.z-p.z,l=Math.sqrt(tx*tx+tz*tz)||1;
    norms.push(new THREE.Vector3(-tz/l,0,tx/l));
  }
  for(const side of[-1,1]){
    const vL=[],vT=[],iL=[],iT=[]; let vi=0,ti=0;
    const off=side*(rw/2+2.0),h=1.15;
    for(let i=0;i<n-1;i++){
      const p0=pts[i],p1=pts[i+1],r0=norms[i],r1=norms[i+1];
      const b0x=p0.x+r0.x*off,b0z=p0.z+r0.z*off;
      const b1x=p1.x+r1.x*off,b1z=p1.z+r1.z*off;
      vL.push(b0x,p0.y,b0z, b1x,p1.y,b1z, b1x,p1.y+h,b1z, b0x,p0.y+h,b0z);
      iL.push(vi,vi+1,vi+2,vi,vi+2,vi+3); vi+=4;
      vT.push(b0x,p0.y+h,b0z, b1x,p1.y+h,b1z, b1x,p1.y+h+.16,b1z, b0x,p0.y+h+.16,b0z);
      iT.push(ti,ti+1,ti+2,ti,ti+2,ti+3); ti+=4;
    }
    const mkGeo=(v,i)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);g.computeVertexNormals();return g;};
    const bm=new THREE.Mesh(mkGeo(vL,iL),new THREE.MeshLambertMaterial({color:0x888888,side:THREE.DoubleSide}));
    bm.userData.trk=true; scene.add(bm);
    const tm=new THREE.Mesh(mkGeo(vT,iT),new THREE.MeshLambertMaterial({color:side===-1?0xff2211:0xffffff,side:THREE.DoubleSide}));
    tm.userData.trk=true; scene.add(tm);
  }
}

function addGantry(curve,rw){
  const sp=curve.getPoint(0),st=curve.getTangentAt(0.01);
  const sr=new THREE.Vector3(-st.z,0,st.x).normalize();
  const ang=Math.atan2(st.x,st.z);
  const pM=mat(0xdddddd),rM=matE(0xff2200,0x220000);
  [-1,1].forEach(s=>{
    const pole=new THREE.Mesh(new THREE.BoxGeometry(.26,5.5,.26),pM);
    pole.position.copy(sp).addScaledVector(sr,s*(rw/2+2.2)); pole.position.y=2.75; pole.userData.trk=true; scene.add(pole);
  });
  const ban=new THREE.Mesh(new THREE.BoxGeometry(rw+5,.4,.18),rM);
  ban.position.copy(sp); ban.position.y=5.6; ban.rotation.y=ang; ban.userData.trk=true; scene.add(ban);
  const ln=new THREE.Mesh(new THREE.BoxGeometry(rw,.07,1.3),mat(0xffffff));
  ln.position.copy(sp); ln.position.y=.07; ln.rotation.y=ang; ln.userData.trk=true; scene.add(ln);
}

function distPointToSegment2(px,pz,ax,az,bx,bz){
  const abx=bx-ax, abz=bz-az;
  const apx=px-ax, apz=pz-az;
  const ab2=abx*abx+abz*abz||1;
  const t=Math.max(0,Math.min(1,(apx*abx+apz*abz)/ab2));
  const cx=ax+abx*t, cz=az+abz*t;
  const dx=px-cx, dz=pz-cz;
  return dx*dx+dz*dz;
}
function pointNearTrack(data,px,pz,margin=0){
  if(!data||!Array.isArray(data.wp)||data.wp.length<2) return false;
  const maxD=((data.rw||12)/2+margin); const maxD2=maxD*maxD;
  for(let i=0;i<data.wp.length;i++){
    const a=data.wp[i],b=data.wp[(i+1)%data.wp.length];
    if(distPointToSegment2(px,pz,a[0],a[2],b[0],b[2])<=maxD2) return true;
  }
  return false;
}
function pointInNoAutoZone(data,px,pz,pad=0){
  const zones=(data&&data.noAutoZones)||[];
  return zones.some(z=>{ const dx=px-z.x,dz=pz-z.z,r=(z.r||18)+pad; return dx*dx+dz*dz<=r*r; });
}

function addScenery(curve,data){
  const pts=curve.getSpacedPoints(100);
  const tmk=mat(0x4a2810),tlv=mat(0x1e4a1e);
  const bmk=mat(0x2a2a3a),bmk2=mat(0x3a3a4a),bmk3=mat(0x222238);
  const roofMat=mat(0x333344);
  const standMat=mat(0x444455),standSeat=mat(0x995522);
  const gravelMat=mat(0x3a3a2a);
  const minOff=data.rw/2+7.0;
  const placed=[];
  // S/F exclusion zone
  const sfP=curve.getPoint(0);
  const sfExcl=18;

  function onTrack(px,pz,margin){
    const m2=(data.rw/2+margin)**2;
    for(let j=0;j<trkPts.length;j+=3){
      if((px-trkPts[j].x)**2+(pz-trkPts[j].z)**2<m2)return true;
    }
    return false;
  }
  function nearSF(px,pz){return Math.abs(px-sfP.x)<sfExcl&&Math.abs(pz-sfP.z)<sfExcl;}

  for(let i=0;i<pts.length;i++){
    const p=pts[i],nx=pts[(i+1)%pts.length];
    const t=new THREE.Vector3().subVectors(nx,p).normalize();
    const r=new THREE.Vector3(-t.z,0,t.x).normalize();
    for(const s of[-1,1]){
      // ── Trees (dense, varied sizes) ──
      const treeOff=s*(minOff+2+Math.random()*6);
      const tpos=p.clone().addScaledVector(r,treeOff);
      if(!onTrack(tpos.x,tpos.z,6)&&!nearSF(tpos.x,tpos.z)&&!pointInNoAutoZone(data,tpos.x,tpos.z,4)){
        const tg=new THREE.Group();
        const h=1.0+Math.random()*1.2;
        const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.15,.25,h,5),tmk);
        trunk.position.set(0,h/2,0); tg.add(trunk);
        const cr=0.8+Math.random()*1.2, ch=2.0+Math.random()*2.0;
        const cn=new THREE.Mesh(new THREE.ConeGeometry(cr,ch,6),tlv);
        cn.position.set(0,h+ch/2,0); tg.add(cn);
        tg.position.set(tpos.x,p.y,tpos.z); tg.rotation.y=Math.random()*Math.PI*2;
        tg.userData.trk=true; scene.add(tg);
      }

      // ── Second tree row further back ──
      if(Math.random()<0.6){
        const off2=s*(minOff+10+Math.random()*12);
        const tp2=p.clone().addScaledVector(r,off2);
        const tg2=new THREE.Group();
        const h2=1.2+Math.random()*1.5;
        const trunk2=new THREE.Mesh(new THREE.CylinderGeometry(.15,.28,h2,5),tmk);
        trunk2.position.set(0,h2/2,0); tg2.add(trunk2);
        const cn2=new THREE.Mesh(new THREE.ConeGeometry(1.2+Math.random(),2.5+Math.random()*2,6),tlv);
        cn2.position.set(0,h2+1.5,0); tg2.add(cn2);
        if(!pointInNoAutoZone(data,tp2.x,tp2.z,4)){
          tg2.position.set(tp2.x,p.y,tp2.z); tg2.rotation.y=Math.random()*Math.PI*2;
          tg2.userData.trk=true; scene.add(tg2);
        }
      }

      // ── Buildings (varied, better quality) ──
      if(Math.random()<0.18){
        const bOff=s*(data.rw/2+16+Math.random()*14);
        const bpos=p.clone().addScaledVector(r,bOff);
        let bClose=false;
        for(const bl of placed){if((bpos.x-bl.x)**2+(bpos.z-bl.z)**2<144)bClose=true;}
        if(!bClose&&!onTrack(bpos.x,bpos.z,10)&&!nearSF(bpos.x,bpos.z)&&!pointInNoAutoZone(data,bpos.x,bpos.z,6)){
          const bw=4+Math.random()*6, bd=3+Math.random()*5, bh=4+Math.random()*8;
          const bm=[bmk,bmk2,bmk3][Math.floor(Math.random()*3)];
          const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),bm);
          bld.position.set(bpos.x,p.y+bh/2,bpos.z);
          bld.rotation.y=Math.atan2(t.x,t.z)+Math.random()*0.3-0.15;
          bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
          // Roof accent
          const roof=new THREE.Mesh(new THREE.BoxGeometry(bw+0.3,0.3,bd+0.3),roofMat);
          roof.position.set(bpos.x,p.y+bh+0.15,bpos.z); roof.userData.trk=true; scene.add(roof);
          placed.push({x:bpos.x,z:bpos.z});
        }
      }

      // ── Grandstands near track (wedge shape, slope facing track) ──
      if(i%12===0 && Math.random()<0.3 && !nearSF(p.x,p.z) && !pointInNoAutoZone(data,p.x,p.z,8)){
        const gOff=s*(data.rw/2+10);
        const gpos=p.clone().addScaledVector(r,gOff);
        const gang=Math.atan2(t.x,t.z);
        const gw=8+Math.random()*6, gd=5, gh=4+Math.random()*2;
        // Wedge: triangle cross-section — tall at back, slopes down to track side
        // 6 vertices: front-bottom-L, front-bottom-R, front-top-L, front-top-R, back-bottom-L, back-bottom-R
        // "front" = track side (low), "back" = away from track (tall)
        const trackSide=s>0?-1:1; // which local Z direction faces track
        const verts=new Float32Array([
          -gw/2,0,trackSide*gd/2,   gw/2,0,trackSide*gd/2,    // front bottom L,R (track side, ground)
          -gw/2,0.3,trackSide*gd/2, gw/2,0.3,trackSide*gd/2,  // front top L,R (track side, low edge)
          -gw/2,0,-trackSide*gd/2,  gw/2,0,-trackSide*gd/2,   // back bottom L,R
          -gw/2,gh,-trackSide*gd/2, gw/2,gh,-trackSide*gd/2,  // back top L,R
        ]);
        const idx=[
          0,1,3,0,3,2, // front face
          4,6,7,4,7,5, // back face
          2,3,7,2,7,6, // slope (top)
          0,4,5,0,5,1, // bottom
          0,2,6,0,6,4, // left side
          1,5,7,1,7,3, // right side
        ];
        const geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.BufferAttribute(verts,3));
        geo.setIndex(idx); geo.computeVertexNormals();
        const stand=new THREE.Mesh(geo,standMat);
        stand.position.set(gpos.x,p.y,gpos.z);
        stand.rotation.y=gang; stand.userData.trk=true; scene.add(stand);
        // Seat strips on slope
        const seatStrip=new THREE.Mesh(new THREE.BoxGeometry(gw,0.15,gd+0.1),standSeat);
        seatStrip.position.set(gpos.x,p.y+gh*0.45,gpos.z-trackSide*0.3);
        seatStrip.rotation.y=gang;
        seatStrip.rotation.x=trackSide*Math.atan2(gh-0.3,gd)*0.3;
        seatStrip.userData.trk=true; scene.add(seatStrip);
      }
    }

    // ── Gravel runoff areas on outside of tight curves ──
    if(trkCurv[Math.round(i/pts.length*trkPts.length)%trkPts.length]>0.3 && Math.random()<0.4 && !nearSF(p.x,p.z) && !pointInNoAutoZone(data,p.x,p.z,6)){
      const gOff=data.rw/2+5;
      for(const s of[-1,1]){
        const gpos=p.clone().addScaledVector(r,s*gOff);
        const grv=new THREE.Mesh(new THREE.BoxGeometry(6,0.03,4),gravelMat);
        grv.position.set(gpos.x,0.01,gpos.z);
        grv.rotation.y=Math.atan2(t.x,t.z);
        grv.userData.trk=true; scene.add(grv);
      }
    }
  }
}

function addCityScenery(curve,data){
  const gs=data.gridSize||70;
  const roadW=data.rw;
  const swW=3;
  const corridorW=roadW+swW*2;
  const intZone=corridorW/2+1;

  // ── Materials ──
  const roadMat=new THREE.MeshLambertMaterial({color:0x1a1a1e,side:THREE.DoubleSide});
  const swMat=new THREE.MeshLambertMaterial({color:0x222230});
  const curbMat=new THREE.MeshLambertMaterial({color:0x2e2e38});
  const markMat=new THREE.MeshLambertMaterial({color:0x888855,emissive:0x111108});
  const brrMat=new THREE.MeshLambertMaterial({color:0x888888,side:THREE.DoubleSide});
  const brrTop=new THREE.MeshLambertMaterial({color:0xff2211,side:THREE.DoubleSide});
  const bCols=[0x14141e,0x18182a,0x1c1c28,0x121220,0x1a1a30,0x161622,0x20202c,0x0e0e18];
  const bMats=bCols.map(c=>new THREE.MeshLambertMaterial({color:c}));
  const litMats=[
    new THREE.MeshLambertMaterial({color:0x181828,emissive:0x0c0c18}),
    new THREE.MeshLambertMaterial({color:0x1a1a2e,emissive:0x0a0a15}),
    new THREE.MeshLambertMaterial({color:0x1e2030,emissive:0x0e1020}),
  ];
  const winMat=new THREE.MeshLambertMaterial({color:0x445566,emissive:0x223344,transparent:true,opacity:0.6});
  const warmWin=new THREE.MeshLambertMaterial({color:0x554422,emissive:0x332211});
  const neons=[matE(0xff2244,0x881122),matE(0x2244ff,0x112288),matE(0x22ff88,0x118844)];
  const poleMat=mat(0x444455);
  const bulbMat=matE(0xffeedd,0xaa8844);
  const poolMat=new THREE.MeshBasicMaterial({color:0xffcc44,transparent:true,opacity:0.15,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
  const poolGeo=new THREE.CircleGeometry(12,16);

  // ── Grid extents ──
  let mnX=Infinity,mxX=-Infinity,mnZ=Infinity,mxZ=-Infinity;
  for(const p of trkPts){
    if(p.x<mnX)mnX=p.x;if(p.x>mxX)mxX=p.x;if(p.z<mnZ)mnZ=p.z;if(p.z>mxZ)mxZ=p.z;
  }
  const gx0=Math.floor(mnX/gs)*gs-gs*2, gx1=Math.ceil(mxX/gs)*gs+gs*2;
  const gz0=Math.floor(mnZ/gs)*gs-gs*2, gz1=Math.ceil(mxZ/gs)*gs+gs*2;

  // ── Detect track road segments ──
  // H seg "x,z" = horizontal road at Z=z from X=x to X=x+gs
  // V seg "x,z" = vertical road at X=x from Z=z to Z=z+gs
  const trackH=new Set(), trackV=new Set(), trackInter=new Set();
  for(let i=0;i<trkPts.length;i++){
    const p=trkPts[i];
    const nearX=Math.round(p.x/gs)*gs, nearZ=Math.round(p.z/gs)*gs;
    // On a vertical road? (X near gridline, Z in mid-segment)
    if(Math.abs(p.x-nearX)<roadW*0.7){
      const segZ=Math.floor(p.z/gs)*gs;
      if(p.z>segZ+intZone && p.z<segZ+gs-intZone) trackV.add(nearX+','+segZ);
    }
    // On a horizontal road?
    if(Math.abs(p.z-nearZ)<roadW*0.7){
      const segX=Math.floor(p.x/gs)*gs;
      if(p.x>segX+intZone && p.x<segX+gs-intZone) trackH.add(segX+','+nearZ);
    }
    // Near an intersection?
    if(Math.abs(p.x-nearX)<corridorW && Math.abs(p.z-nearZ)<corridorW){
      trackInter.add(nearX+','+nearZ);
    }
  }
  // Intersection exit detection based on connected track segments
  const trackExits={};
  for(const key of trackInter){
    const[ix,iz]=key.split(',').map(Number);
    trackExits[key]={
      n: trackV.has(ix+','+iz),
      s: trackV.has(ix+','+(iz-gs)),
      e: trackH.has(ix+','+iz),
      w: trackH.has((ix-gs)+','+iz),
    };
  }

  // ── 1. BUILD ALL ROADS ──
  const swLen=gs-corridorW;
  for(let z=gz0;z<=gz1;z+=gs){
    for(let x=gx0;x<gx1;x+=gs){
      const cx=x+gs/2;
      const rd=new THREE.Mesh(new THREE.BoxGeometry(gs,0.04,roadW),roadMat);
      rd.position.set(cx,0.005,z); rd.receiveShadow=true; rd.userData.trk=true; scene.add(rd);
      if(swLen>2){
        for(const s of[-1,1]){
          const sw=new THREE.Mesh(new THREE.BoxGeometry(swLen,0.12,swW),swMat);
          sw.position.set(cx,0.06,z+s*(roadW/2+swW/2)); sw.userData.trk=true; scene.add(sw);
          const cb=new THREE.Mesh(new THREE.BoxGeometry(swLen,0.14,0.15),curbMat);
          cb.position.set(cx,0.07,z+s*roadW/2); cb.userData.trk=true; scene.add(cb);
        }
      }
      for(let dx=x+intZone+1;dx<x+gs-intZone;dx+=5){
        const dm=new THREE.Mesh(new THREE.BoxGeometry(2,0.02,0.15),markMat);
        dm.position.set(dx,0.05,z); dm.userData.trk=true; scene.add(dm);
      }
    }
  }
  for(let x=gx0;x<=gx1;x+=gs){
    for(let z=gz0;z<gz1;z+=gs){
      const cz=z+gs/2;
      const rd=new THREE.Mesh(new THREE.BoxGeometry(roadW,0.04,gs),roadMat);
      rd.position.set(x,0.005,cz); rd.receiveShadow=true; rd.userData.trk=true; scene.add(rd);
      if(swLen>2){
        for(const s of[-1,1]){
          const sw=new THREE.Mesh(new THREE.BoxGeometry(swW,0.12,swLen),swMat);
          sw.position.set(x+s*(roadW/2+swW/2),0.06,cz); sw.userData.trk=true; scene.add(sw);
          const cb=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.14,swLen),curbMat);
          cb.position.set(x+s*roadW/2,0.07,cz); cb.userData.trk=true; scene.add(cb);
        }
      }
      for(let dz=z+intZone+1;dz<z+gs-intZone;dz+=5){
        const dm=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.02,2),markMat);
        dm.position.set(x,0.05,dz); dm.userData.trk=true; scene.add(dm);
      }
    }
  }
  for(let x=gx0;x<=gx1;x+=gs){
    for(let z=gz0;z<=gz1;z+=gs){
      const ip=new THREE.Mesh(new THREE.BoxGeometry(corridorW,0.04,corridorW),roadMat);
      ip.position.set(x,0.004,z); ip.receiveShadow=true; ip.userData.trk=true; scene.add(ip);
    }
  }

  // ── 2. BARRIERS on track segment sidewalks only ──
  const bH=1.15;
  function addWall(cx,cy,cz,bw,bh,bd){
    const wall=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),brrMat);
    wall.position.set(cx,cy,cz); wall.userData.trk=true; scene.add(wall);
    const top=new THREE.Mesh(new THREE.BoxGeometry(bw,0.16,bd),brrTop);
    top.position.set(cx,cy+bh/2+0.08,cz); top.userData.trk=true; scene.add(top);
  }
  for(const key of trackH){
    const[sx,sz]=key.split(',').map(Number);
    const cx=sx+gs/2;
    addWall(cx, bH/2, sz+roadW/2+swW, swLen, bH, 0.35);
    addWall(cx, bH/2, sz-roadW/2-swW, swLen, bH, 0.35);
  }
  for(const key of trackV){
    const[sx,sz]=key.split(',').map(Number);
    const cz=sz+gs/2;
    addWall(sx+roadW/2+swW, bH/2, cz, 0.35, bH, swLen);
    addWall(sx-roadW/2-swW, bH/2, cz, 0.35, bH, swLen);
  }

  // ── 3. INTERSECTION CROSS-WALLS ──
  for(const key of trackInter){
    const[ix,iz]=key.split(',').map(Number);
    const ex=trackExits[key];
    const hw=corridorW/2;
    if(!ex.n) addWall(ix, bH/2, iz+hw, corridorW, bH, 0.4);
    if(!ex.s) addWall(ix, bH/2, iz-hw, corridorW, bH, 0.4);
    if(!ex.e) addWall(ix+hw, bH/2, iz, 0.4, bH, corridorW);
    if(!ex.w) addWall(ix-hw, bH/2, iz, 0.4, bH, corridorW);
  }

  // Start/finish gantry
  const sp=curve.getPoint(0),st=curve.getTangentAt(0.001);
  const sr=new THREE.Vector3(-st.z,0,st.x).normalize();
  const ang=Math.atan2(st.x,st.z);
  const gM=mat(0xdddddd),gR=matE(0xff2200,0x220000);
  [-1,1].forEach(s=>{
    const pole=new THREE.Mesh(new THREE.BoxGeometry(.26,5.5,.26),gM);
    pole.position.copy(sp).addScaledVector(sr,s*(roadW/2+swW+0.5)); pole.position.y=2.75; pole.userData.trk=true; scene.add(pole);
  });
  const ban=new THREE.Mesh(new THREE.BoxGeometry(corridorW+2,.4,.18),gR);
  ban.position.copy(sp); ban.position.y=5.6; ban.rotation.y=ang; ban.userData.trk=true; scene.add(ban);
  const sfLine=new THREE.Mesh(new THREE.BoxGeometry(roadW,.07,1.3),mat(0xffffff));
  sfLine.position.copy(sp); sfLine.position.y=.07; sfLine.rotation.y=ang; sfLine.userData.trk=true; scene.add(sfLine);

  // ── 4. BUILDINGS ──
  const blockInset=corridorW/2+0.5;
  const placed=[];
  for(let bx=gx0;bx<gx1;bx+=gs){
    for(let bz=gz0;bz<gz1;bz+=gs){
      const cx=bx+gs/2, cz=bz+gs/2;
      const blockW=gs-corridorW-1, blockD=gs-corridorW-1;
      if(blockW<4||blockD<4)continue;
      const nBld=1+Math.floor(Math.random()*2.5);
      for(let bi=0;bi<nBld;bi++){
        let bw,bd,px,pz;
        if(nBld===1){
          bw=blockW*(.7+Math.random()*.25); bd=blockD*(.7+Math.random()*.25);
          px=cx+(Math.random()-.5)*2; pz=cz+(Math.random()-.5)*2;
        } else {
          bw=blockW/nBld*(.8+Math.random()*.3); bd=blockD*(.6+Math.random()*.3);
          px=cx-blockW/2+bw/2+bi*(blockW/nBld)+(Math.random()-.5)*2;
          pz=cz+(Math.random()-.5)*(blockD-bd)*.4;
        }
        if(px-bw/2<bx+blockInset||px+bw/2>bx+gs-blockInset)continue;
        if(pz-bd/2<bz+blockInset||pz+bd/2>bz+gs-blockInset)continue;
        let md=Infinity;
        for(let j=0;j<trkPts.length;j+=5){const d=(px-trkPts[j].x)**2+(pz-trkPts[j].z)**2;if(d<md)md=d;}
        md=Math.sqrt(md); const near=md<50;
        if(pointInNoAutoZone(data,px,pz,10))continue;
        let bh=near?(28+Math.random()*50):(8+Math.random()*30);
        if(Math.random()<0.06)bh=Math.max(bh,55+Math.random()*30);
        const useLit=Math.random()<0.35;
        const m=useLit?litMats[Math.floor(Math.random()*litMats.length)]:bMats[Math.floor(Math.random()*bMats.length)];
        const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),m);
        bld.position.set(px,bh/2,pz); bld.castShadow=true; bld.userData.trk=true; scene.add(bld);
        placed.push({x:px,z:pz,w:bw,d:bd,h:bh});
        if(bh>25&&Math.random()<0.5){
          const wh=bh*0.55;
          const wMesh=new THREE.Mesh(new THREE.BoxGeometry(bw+.2,wh,bd+.2),winMat);
          wMesh.position.set(px,bh*0.35+wh/2,pz); wMesh.userData.trk=true; scene.add(wMesh);
        }
        if(bh>18&&Math.random()<0.4){
          const face=Math.floor(Math.random()*4);
          for(let f=1;f<Math.floor(bh/4.5);f++){
            if(Math.random()<0.5)continue;
            const fy=f*4.5+1; let wx,wz;
            if(face===0){wx=px+(Math.random()-.5)*bw*.5;wz=pz+bd/2+.08;}
            else if(face===1){wx=px+(Math.random()-.5)*bw*.5;wz=pz-bd/2-.08;}
            else if(face===2){wx=px+bw/2+.08;wz=pz+(Math.random()-.5)*bd*.5;}
            else{wx=px-bw/2-.08;wz=pz+(Math.random()-.5)*bd*.5;}
            const wn=new THREE.Mesh(new THREE.BoxGeometry(1.6,1.8,.08),warmWin);
            wn.position.set(wx,fy,wz); if(face>=2)wn.rotation.y=Math.PI/2;
            wn.userData.trk=true; scene.add(wn);
          }
        }
        if(near&&bh>25&&Math.random()<0.15){
          const nm=neons[Math.floor(Math.random()*neons.length)];
          const ns=new THREE.Mesh(new THREE.BoxGeometry(bw*.6,.6,.08),nm);
          ns.position.set(px+(Math.abs(px-bx)<Math.abs(px-(bx+gs))?-1:1)*(bw/2+.1),bh*.5+Math.random()*bh*.2,pz);
          ns.rotation.y=Math.PI/2; ns.userData.trk=true; scene.add(ns);
        }
      }
    }
  }

  // ── 5. STREET LAMPS on sidewalks, yellow pools on road ──
  // S/F exclusion zone — no lamps near start/finish
  const sfPt=curve.getPoint(0);
  const sfExclude=15; // metres exclusion radius around S/F

  const lPts=curve.getSpacedPoints(120);
  for(let i=0;i<lPts.length;i+=4){
    const p=lPts[i],nx=lPts[(i+1)%lPts.length];
    // Skip if near start/finish
    if(Math.abs(p.x-sfPt.x)<sfExclude&&Math.abs(p.z-sfPt.z)<sfExclude)continue;
    if(pointInNoAutoZone(data,p.x,p.z,6))continue;
    const t=new THREE.Vector3().subVectors(nx,p).normalize();
    const r=new THREE.Vector3(-t.z,0,t.x).normalize();
    const side=(i%8<4)?-1:1;
    // Place on outer edge of sidewalk
    const off=side*(roadW/2+swW*0.8);
    const lx=p.x+r.x*off, lz=p.z+r.z*off;
    let inBld=false;
    for(const b of placed){if(Math.abs(lx-b.x)<b.w/2+1&&Math.abs(lz-b.z)<b.d/2+1){inBld=true;break;}}
    if(inBld)continue;
    // Pole on sidewalk
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.08,6.5,5),poleMat);
    pole.position.set(lx,3.25,lz); pole.userData.trk=true; scene.add(pole);
    // Arm extends over road
    const armDx=-r.x*side*2.0, armDz=-r.z*side*2.0;
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.05,.05,2.8),poleMat);
    arm.position.set(lx+armDx*0.4,6.3,lz+armDz*0.4);
    arm.rotation.y=Math.atan2(r.x,r.z); arm.userData.trk=true; scene.add(arm);
    const bx2=lx+armDx, bz2=lz+armDz;
    const bulb=new THREE.Mesh(new THREE.BoxGeometry(.6,.12,.35),bulbMat);
    bulb.position.set(bx2,6.2,bz2); bulb.userData.trk=true; scene.add(bulb);
    // Yellow transparent pool on road surface
    const pool=new THREE.Mesh(poolGeo,poolMat);
    pool.rotation.x=-Math.PI/2;
    pool.position.set(p.x,0.06,p.z);
    pool.userData.trk=true; scene.add(pool);
  }

  // ── 6. PARKS in empty blocks (no buildings placed) ──
  const tmk=mat(0x4a2810),tlv=mat(0x1e4a1e);
  const grassMat=new THREE.MeshLambertMaterial({color:0x1a3a1a});
  const pathMat=new THREE.MeshLambertMaterial({color:0x2a2a22});
  for(let bx=gx0;bx<gx1;bx+=gs){
    for(let bz=gz0;bz<gz1;bz+=gs){
      const cx=bx+gs/2, cz=bz+gs/2;
      const blockW=gs-corridorW-1, blockD=gs-corridorW-1;
      if(blockW<8||blockD<8)continue;
      // Check if this block has any buildings
      let hasBld=false;
      for(const b of placed){
        if(b.x>bx+blockInset&&b.x<bx+gs-blockInset&&b.z>bz+blockInset&&b.z<bz+gs-blockInset){
          hasBld=true;break;
        }
      }
      if(hasBld)continue;
      if(pointInNoAutoZone(data,cx,cz,12))continue;
      // This block is empty — make a park
      // Grass patch
      const grass=new THREE.Mesh(new THREE.BoxGeometry(blockW,0.06,blockD),grassMat);
      grass.position.set(cx,0.03,cz); grass.userData.trk=true; scene.add(grass);
      // Path through middle
      const pathH=new THREE.Mesh(new THREE.BoxGeometry(blockW,0.04,1.5),pathMat);
      pathH.position.set(cx,0.06,cz); pathH.userData.trk=true; scene.add(pathH);
      const pathV=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.04,blockD),pathMat);
      pathV.position.set(cx,0.06,cz); pathV.userData.trk=true; scene.add(pathV);
      // Trees scattered around
      const nTrees=6+Math.floor(Math.random()*8);
      for(let ti=0;ti<nTrees;ti++){
        const tx=cx+(Math.random()-.5)*blockW*0.85;
        const tz=cz+(Math.random()-.5)*blockD*0.85;
        // Skip if on path or near start/finish
        if(Math.abs(tx-cx)<1.5||Math.abs(tz-cz)<1.5)continue;
        if((tx-sfPt.x)*(tx-sfPt.x)+(tz-sfPt.z)*(tz-sfPt.z)<(sfExclude+10)*(sfExclude+10))continue;
        const tg=new THREE.Group();
        const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.15,.25,1.2+Math.random()*.5,5),tmk);
        trunk.position.set(0,.7,0); tg.add(trunk);
        const cn=new THREE.Mesh(new THREE.ConeGeometry(.9+Math.random()*.8,2.4+Math.random()*1.5,6),tlv);
        cn.position.set(0,2.5+Math.random()*.4,0); tg.add(cn);
        tg.position.set(tx,0,tz); tg.rotation.y=Math.random()*Math.PI*2;
        tg.userData.trk=true; scene.add(tg);
      }
    }
  }

  // ── 6. BUILD CITY CORRIDORS for boundary system ──
  // Each corridor is an axis-aligned rectangle the car can legally be in
  const corr=[];
  const hw=roadW/2+swW-0.3; // half-width of driveable area (wall to wall)
  // All track H segments
  for(const key of trackH){
    const[sx,sz]=key.split(',').map(Number);
    corr.push({x:sx+gs/2, z:sz, hw:gs/2, hd:hw});
  }
  // All track V segments
  for(const key of trackV){
    const[sx,sz]=key.split(',').map(Number);
    corr.push({x:sx, z:sz+gs/2, hw:hw, hd:gs/2});
  }
  // All track intersections (full square)
  for(const key of trackInter){
    const[ix,iz]=key.split(',').map(Number);
    corr.push({x:ix, z:iz, hw:hw, hd:hw});
  }
  cityCorridors=corr;

  // ── 7. CITY AI WAYPOINTS — follow grid roads exactly ──
  if(data.cityRoute){
    const route=data.cityRoute;
    const pts=[];
    const spacing=2; // metres between points
    for(let r=0;r<route.length;r++){
      const curr=route[r], next=route[(r+1)%route.length];
      const dx=next[0]-curr[0], dz=next[1]-curr[1];
      const len=Math.sqrt(dx*dx+dz*dz);
      const steps=Math.max(1,Math.round(len/spacing));
      // Add a small corner arc at this intersection before heading to next
      if(r>0||pts.length>0){
        const prev=route[(r-1+route.length)%route.length];
        // Direction arriving
        const ax=curr[0]-prev[0], az=curr[1]-prev[1];
        const al=Math.sqrt(ax*ax+az*az)||1;
        // Direction leaving
        const bx=next[0]-curr[0], bz=next[1]-curr[1];
        const bl=Math.sqrt(bx*bx+bz*bz)||1;
        // Add corner arc: 4 points rounding the inside
        const R=3.5; // corner radius
        for(let a=0;a<=3;a++){
          const t=a/3;
          const ix=curr[0]-ax/al*R*(1-t)+bx/bl*R*t;
          const iz=curr[1]-az/al*R*(1-t)+bz/bl*R*t;
          pts.push(new THREE.Vector3(ix,0,iz));
        }
      }
      // Straight segment from curr toward next
      for(let s=1;s<=steps;s++){
        const t=s/steps;
        pts.push(new THREE.Vector3(curr[0]+dx*t, 0, curr[1]+dz*t));
      }
    }
    // Compute curvature for city AI points
    const cn=pts.length;
    const cityAiCurv=[];
    for(let i=0;i<cn;i++){
      const a=pts[(i-2+cn)%cn],b=pts[i],c=pts[(i+2)%cn];
      const aax=b.x-a.x,aaz=b.z-a.z,bbx=c.x-b.x,bbz=c.z-b.z;
      const la2=Math.sqrt(aax*aax+aaz*aaz)||1,lb2=Math.sqrt(bbx*bbx+bbz*bbz)||1;
      const dot2=(aax*bbx+aaz*bbz)/(la2*lb2);
      cityAiCurv[i]=Math.max(0,1-Math.min(1,(dot2+1)/2*1.2));
    }
    cityAiPts={pts,curv:cityAiCurv};
  }
}

// ═══════════════════════════════════════════════════════
//  LIGHTING
// ═══════════════════════════════════════════════════════
function setupLights(){
  const rm=[]; scene.traverse(o=>{if(o.isLight)rm.push(o);}); rm.forEach(l=>scene.remove(l));
  const isCity=trkData&&trkData.type==='city';
  const ambientCol=trkData&&trkData.ambient!=null?trkData.ambient:(isCity?0x667788:0xffffff);
  const ambientInt=trkData&&trkData.ambientIntensity!=null?trkData.ambientIntensity:(isCity?.35:.55);
  const sunCol=trkData&&trkData.sun!=null?trkData.sun:(isCity?0x8899bb:0xffffff);
  const sunInt=trkData&&trkData.sunIntensity!=null?trkData.sunIntensity:(isCity?.6:1.1);
  const fillCol=trkData&&trkData.fill!=null?trkData.fill:(isCity?0x334466:0x5566bb);
  const fillInt=trkData&&trkData.fillIntensity!=null?trkData.fillIntensity:(isCity?.20:.30);
  scene.add(new THREE.AmbientLight(ambientCol,ambientInt));
  const sun=new THREE.DirectionalLight(sunCol,sunInt);
  sun.position.set(isCity?-40:80,180,isCity?-60:100); sun.castShadow=true;
  sun.shadow.mapSize.width=sun.shadow.mapSize.height=2048;
  sun.shadow.camera.left=-340;sun.shadow.camera.right=340;sun.shadow.camera.top=340;sun.shadow.camera.bottom=-340;
  sun.shadow.camera.far=700; sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
  const fill=new THREE.DirectionalLight(fillCol,fillInt);
  fill.position.set(-60,70,-80); scene.add(fill);
  if(isCity || (trkData&&trkData.timeOfDay==='night')){
    const up=new THREE.DirectionalLight(0x556688,.15); up.position.set(0,-20,0); scene.add(up);
  }
}

// ═══════════════════════════════════════════════════════
//  CAMERA
// ═══════════════════════════════════════════════════════
function updateCamera(){
  if(!pCar)return;
  const now=performance.now();
  if(now-raceCamOrbit.lastInput>2000){
    raceCamOrbit.yaw*=0.88;
    raceCamOrbit.pitch*=0.88;
  }
  raceCamOrbit.pitch=Math.max(-0.55,Math.min(0.75,raceCamOrbit.pitch));
  const fwd=new THREE.Vector3(Math.sin(pCar.hdg),0,Math.cos(pCar.hdg));
  if(camMode==='chase'){
    const orbitYaw=pCar.hdg+Math.PI+raceCamOrbit.yaw;
    const back=new THREE.Vector3(Math.sin(orbitYaw),0,Math.cos(orbitYaw));
    const camHeight=5.0+raceCamOrbit.pitch*3.5;
    const tgt=pCar.pos.clone().addScaledVector(back,11).add(new THREE.Vector3(0,camHeight,0));
    camChase.position.lerp(tgt,.09);
    const look=pCar.pos.clone().addScaledVector(fwd,5).add(new THREE.Vector3(0,.8+raceCamOrbit.pitch*1.2,0));
    camChase.lookAt(look);
    activeCam=camChase;
  } else {
    // Use per-car cockpit height — camera above roof, moved forward past windshield
    const camH=pCar.data.camH||1.8;
    // Position: 1.2m forward (past windshield), camH above car base
    const cp=pCar.pos.clone().addScaledVector(fwd,1.2).add(new THREE.Vector3(0,camH,0));
    camCock.position.copy(cp);
    camCock.near=1.2; camCock.updateProjectionMatrix();
    const lookDir=new THREE.Vector3(Math.sin(pCar.hdg+raceCamOrbit.yaw*0.65),Math.max(-0.25,Math.min(0.25,-0.04-raceCamOrbit.pitch*0.18)),Math.cos(pCar.hdg+raceCamOrbit.yaw*0.65)).normalize();
    camCock.lookAt(cp.clone().addScaledVector(lookDir,55));
    activeCam=camCock;
  }
}

function toggleCam(){
  camMode=camMode==='chase'?'cockpit':'chase';
  dc.style.display=camMode==='cockpit'?'block':'none';
  document.getElementById('speedBox').style.display=camMode==='chase'?'block':'none';
  document.getElementById('gearBox').style.display=camMode==='chase'?'block':'none';
  document.getElementById('camLabel').textContent=camMode==='chase'?'[ C ] COCKPIT VIEW':'[ C ] CHASE CAM';
}

// ═══════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════
const ords=['TH','ST','ND','RD'];
function getOrd(n){return n>=1&&n<=3?ords[n]:ords[0];}
function fmtT(s){
  const m=Math.floor(s/60),sc=Math.floor(s%60),ms=Math.floor((s%1)*1000);
  return`${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}
function updateHUD(){
  if(!pCar||gState!=='racing')return;
  document.getElementById('speedNum').textContent=Math.round((pCar.isReversing?pCar.revSpd:pCar.spd)*3.6);
  document.getElementById('gearNum').textContent=pCar.gear===0?'R':pCar.gear;
  document.getElementById('lapVal').textContent=`${Math.min(pCar.lap+1,trkData.laps)} / ${trkData.laps}`;
  document.getElementById('timer').textContent=fmtT(raceTime);
  const all=[pCar,...aiCars].sort((a,b)=>b.totalProg-a.totalProg);
  const p=all.indexOf(pCar)+1;
  document.getElementById('posNum').innerHTML=`${p}<sup style="font-size:18px">${getOrd(p)}</sup>`;
}

// ═══════════════════════════════════════════════════════
//  DASHBOARD (cockpit)
// ═══════════════════════════════════════════════════════
function resizeDC(){dc.width=window.innerWidth;dc.height=window.innerHeight;}
function drawDash(){
  if(camMode!=='cockpit'||!pCar)return;
  const W=dc.width,H=dc.height,ctx=dctx,ph=H*.3,py=H-ph;
  ctx.clearRect(0,0,W,H);
  const pg=ctx.createLinearGradient(0,py,0,H);
  pg.addColorStop(0,'rgba(8,8,18,.94)'); pg.addColorStop(1,'rgba(2,2,6,.98)');
  ctx.fillStyle=pg; ctx.fillRect(0,py,W,ph);
  ctx.fillStyle='#1a1a2e'; ctx.fillRect(0,py,W,2);
  // Steering wheel
  const wr=ph*.66,wx=W/2,wy=H-ph*.07;
  const sa=(keys['ArrowLeft']||keys['KeyA'])?-.35:(keys['ArrowRight']||keys['KeyD'])?.35:0;
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
  drawGauge(ctx,W*.2,py+ph*.5,gr,pCar.rpm,0,8000,6000,'#ff3300','RPM',v=>(v/1000).toFixed(0)+'k');
  const mxK=Math.round(pCar.data.maxSpd*3.6*1.08);
  drawGauge(ctx,W*.8,py+ph*.5,gr,pCar.spd*3.6,0,mxK,mxK*.82,'#ffaa00','KM/H',v=>Math.round(v));
  // Gear
  ctx.font=`bold ${ph*.52}px Orbitron,monospace`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='#ffd700'; ctx.shadowColor='rgba(255,215,0,.5)'; ctx.shadowBlur=22;
  ctx.fillText(pCar.gear===0?'R':pCar.gear,W/2,py+ph*.52); ctx.shadowBlur=0;
  ctx.font=`${ph*.11}px Rajdhani,sans-serif`; ctx.fillStyle='#334'; ctx.fillText('GEAR',W/2,py+ph*.8);
  // Rev bar
  const bw=W*.32,bh=ph*.055,bx=(W-bw)/2,by=py+ph*.12;
  ctx.fillStyle='#0a0a14'; ctx.fillRect(bx,by,bw,bh);
  const rf=pCar.rpm/8000,rl=6000/8000;
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
  if(!trkPts.length||!pCar)return;
  const ctx=mmctx,W=150,H=150;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='rgba(0,0,0,.72)'; ctx.fillRect(0,0,W,H);
  let mx=-Infinity,nx=Infinity,mz=-Infinity,nz=Infinity;
  for(const p of trkPts){if(p.x>mx)mx=p.x;if(p.x<nx)nx=p.x;if(p.z>mz)mz=p.z;if(p.z<nz)nz=p.z;}
  const sc=Math.min(W/(mx-nx+24),H/(mz-nz+24))*.88;
  const ox=W/2-(nx+(mx-nx)/2)*sc,oz=H/2-(nz+(mz-nz)/2)*sc;
  const toM=(x,z)=>[x*sc+ox,z*sc+oz];
  ctx.beginPath();
  const[sx,sz]=toM(trkPts[0].x,trkPts[0].z); ctx.moveTo(sx,sz);
  for(const p of trkPts){const[px,pz]=toM(p.x,p.z);ctx.lineTo(px,pz);}
  ctx.closePath(); ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=5; ctx.stroke();
  ctx.strokeStyle='#1a1a2e'; ctx.lineWidth=2; ctx.stroke();
  for(const c of aiCars){
    const[ex,ez]=toM(c.pos.x,c.pos.z);
    ctx.beginPath(); ctx.arc(ex,ez,3.5,0,Math.PI*2);
    ctx.fillStyle='#'+c.data.col.toString(16).padStart(6,'0'); ctx.fill();
  }
  const[px,pz]=toM(pCar.pos.x,pCar.pos.z);
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

// ═══════════════════════════════════════════════════════
//  RACE LOGIC
// ═══════════════════════════════════════════════════════
function getGrid(){
  const n=trkPts.length;
  if(!n)return Array(5).fill({pos:new THREE.Vector3(0,0,0),hdg:0});
  const grid=[];
  const rows=[1,1,2,2,3];   // 3 rows: front pair, middle pair, back solo
  const cols=[-1,1,-1,1,0];
  const rowStep=16;
  const sideOff=2.6;
  for(let slot=0;slot<5;slot++){
    const idx=((n - rows[slot]*rowStep) % n + n) % n;
    const pt=trkPts[idx];
    const ptF=trkPts[(idx+5)%n];
    const hdg=Math.atan2(ptF.x-pt.x, ptF.z-pt.z);
    const right=new THREE.Vector3(Math.cos(hdg),0,-Math.sin(hdg));
    const pos=pt.clone().addScaledVector(right,cols[slot]*sideOff);
    grid.push({pos,hdg});
  }
  return grid;
}

function initRace(){
  for(const c of allCars)scene.remove(c.mesh);
  allCars=[]; aiCars=[]; aiControllers=[]; pCar=null;
  for(const s of aiSounds)s.silence();
  aiSounds=[];

  trkData=getTrackById(selTrk);
  try{ buildTrack(trkData); }catch(e){ console.error('buildTrack error:',e); }
  setupLights();

  const grid=getGrid();
  pCar=new Car(CARS[selCar],grid[0].pos,grid[0].hdg,true);
  allCars.push(pCar);

  const aiIdx=[0,1,2,3].filter(i=>i!==selCar);
  for(let i=0;i<4;i++){
    const cd=CARS[aiIdx[i%aiIdx.length]];
    const ai=new Car(cd,grid[i+1].pos,grid[i+1].hdg,false);
    ai.aiAgg=.86+i*.04; aiCars.push(ai); allCars.push(ai);
    aiControllers.push(new AI(ai,.044+i*.010));
  }

  raceTime=0; gState='countdown';
  document.getElementById('hud').style.display='block';
  document.getElementById('hint').style.display='block';
  updateTouchControlsVisibility();
  document.getElementById('camLabel').textContent='[ C ] COCKPIT VIEW';
  camMode='chase'; dc.style.display='none';
  document.getElementById('speedBox').style.display='block';
  document.getElementById('gearBox').style.display='block';
  doCountdown();
}

function doCountdown(){
  stopMusic(); // stop menu music first
  initAudio();
  // Create AI sounds now that audio is ready
  if(audioReady){
    for(let i=0;i<aiCars.length;i++) aiSounds.push(new AISound());
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
      setTimeout(()=>{el.style.display='none'; gState='racing'; updateTouchControlsVisibility(); startMusic();},700);
    }
  },1000);
}

let _prePauseState='racing';
function pauseRace(){
  _prePauseState=gState;
  gState='paused'; stopAudio(); stopMusic();
  document.getElementById('pauseMenu').style.display='flex';
  updateTouchControlsVisibility();
  releaseAllTouchControls();
}
function resumeRace(){
  gState=_prePauseState==='cooldown'?'cooldown':'racing';
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  updateTouchControlsVisibility();
  initAudio(); startMusic();
}

function endRace(){
  const all=[pCar,...aiCars].sort((a,b)=>{
    if(a.finished&&b.finished)return a.finTime-b.finTime;
    if(a.finished)return-1; if(b.finished)return 1; return b.totalProg-a.totalProg;
  });
  const pos=all.indexOf(pCar)+1;
  gState='cooldown'; // always cooldown — AI keeps racing
  if(pos===1){
    playVictoryJingle();
    announce('Checkered flag! You win!');
  } else {
    playLossSound();
    announce('Race finished! P'+pos+'!');
  }
  // Show results after brief delay (AI keeps driving behind it)
  setTimeout(()=>showResults(),1200);
}

function showResults(){
  updateResultsUI();
  document.getElementById('results').style.display='flex';
  document.getElementById('hud').style.display='none';
  document.getElementById('touchControls').style.display='none';
  releaseAllTouchControls();
  dc.style.display='none';
}

function updateResultsUI(){
  const all=[pCar,...aiCars].sort((a,b)=>{
    if(a.finished&&b.finished)return a.finTime-b.finTime;
    if(a.finished)return-1; if(b.finished)return 1; return b.totalProg-a.totalProg;
  });
  const win=all[0]===pCar;
  document.getElementById('rTitle').textContent=win?'🏆 VICTORY!':'RACE OVER';
  document.getElementById('rTitle').style.color=win?'#ffd700':'#ff5500';
  const pods=document.getElementById('podium'); pods.innerHTML='';
  const medals=['🥇','🥈','🥉','4th','5th'];
  for(let i=0;i<Math.min(5,all.length);i++){
    const car=all[i],ip=car===pCar;
    const d=document.createElement('div'); d.className='pi';
    d.innerHTML=`<div class="pm">${medals[i]}</div>
      <div class="pn" style="color:${ip?'#ffd700':'#aaa'}">${ip?'⭐ YOU':car.data.name}</div>
      <div class="pt">${car.finished?fmtT(car.finTime):'racing...'}</div>`;
    pods.appendChild(d);
  }
  const pp=all.indexOf(pCar)+1;
  document.getElementById('ptime').textContent=`Your time: ${fmtT(pCar.finTime||raceTime)}  ·  P${pp}`;
}



// ═══════════════════════════════════════════════════════
//  TRACK EDITOR
// ═══════════════════════════════════════════════════════
function getAllTracks(){ return [...TRACKS, ...editorTracks]; }
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
  const pts=(src.wp||[]).map((p,i)=>({x:p[0],z:p[2],steepness:40,type:i===0?'start-finish':'track-node'}));
  if(pts.length && !pts.some(n=>n.type==='start-finish')) pts[0].type='start-finish';
  return {
    id:src.id,name:src.name,desc:src.desc||'',laps:src.laps||3,rw:src.rw||12,previewColor:src.previewColor||'#44aaff',
    useBezier:src.useBezier!==false,timeOfDay:tod,groundColor:hexNumToCss(src.gnd||makeTimeOfDayPreset(tod).gnd),skyColor:hexNumToCss(src.sky||makeTimeOfDayPreset(tod).sky),
    streetGrid:src.type==='city',gridSize:src.gridSize||70,nodes:pts,assets:deepClone(src.assets||[]),source:src.id,builtin:TRACKS.some(t=>String(t.id)===String(src.id))
  };
}
function loadEditorTracks(){
  try{ editorTracks=JSON.parse(localStorage.getItem('turborace_custom_tracks')||'[]'); if(!Array.isArray(editorTracks))editorTracks=[]; }catch(e){ editorTracks=[]; }
}
function persistEditorTracks(){ localStorage.setItem('turborace_custom_tracks', JSON.stringify(editorTracks)); }
function ensureEditorBoot(){ loadEditorTracks(); if(!editorTrack) editorTrack=editorTracks[0]?deepClone(editorTracks[0]):makeEditableTrackFromGameTrack(TRACKS[0]); }
function uniqueTrackId(){ return 'custom-'+Date.now()+'-'+Math.floor(Math.random()*9999); }
function getEditorStartIndex(){ const idx=(editorTrack.nodes||[]).findIndex(n=>n.type==='start-finish'); return idx>=0?idx:0; }
function normalizeEditorTrack(){
  if(!editorTrack) return;
  if(!Array.isArray(editorTrack.nodes)||editorTrack.nodes.length<3) editorTrack.nodes=[{x:0,z:0,steepness:40,type:'start-finish'},{x:120,z:0,steepness:40,type:'track-node'},{x:120,z:-120,steepness:40,type:'track-node'},{x:0,z:-120,steepness:40,type:'track-node'}];
  let sfCount=0;
  editorTrack.nodes.forEach((n,i)=>{ if(typeof n.steepness!=='number') n.steepness=40; n.type=(n.type==='start-finish'&&sfCount++===0)?'start-finish':(n.type==='no-auto'?'no-auto':'track-node'); });
  if(!editorTrack.nodes.some(n=>n.type==='start-finish')) editorTrack.nodes[0].type='start-finish';
  if(!Array.isArray(editorTrack.assets)) editorTrack.assets=[];
  editorTrack.gridSize=Math.max(40,Math.min(120,+editorTrack.gridSize||70));
}
function getEditorBounds(){
  normalizeEditorTrack();
  const pts=[...editorTrack.nodes.map(n=>({x:n.x,z:n.z})), ...editorTrack.assets.map(a=>({x:a.x,z:a.z}))];
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  pts.forEach(p=>{ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.z<minZ)minZ=p.z; if(p.z>maxZ)maxZ=p.z; });
  if(!isFinite(minX)){ minX=-150; maxX=150; minZ=-150; maxZ=150; }
  return {minX,maxX,minZ,maxZ};
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
    for(let j=0;j<samplesPerSeg;j++){
      const t=j/samplesPerSeg, mt=1-t;
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
  for(let i=0;i<ordered.length;i++){
    const n=ordered[i]; if(n.type!=='no-auto') continue;
    const prev=ordered[(i-1+ordered.length)%ordered.length], next=ordered[(i+1)%ordered.length];
    zones.push({x:n.x,z:n.z,r:26},{x:(n.x+prev.x)/2,z:(n.z+prev.z)/2,r:18},{x:(n.x+next.x)/2,z:(n.z+next.z)/2,r:18});
  }
  return zones;
}
function editorTrackToGameTrack(){
  normalizeEditorTrack();
  const tod=makeTimeOfDayPreset(editorTrack.timeOfDay||'day');
  const nodes=[...editorTrack.nodes], startIdx=getEditorStartIndex(), ordered=[]; for(let i=0;i<nodes.length;i++) ordered.push(nodes[(startIdx+i)%nodes.length]);
  let wp, type='circuit', cityRoute=null;
  if(editorTrack.streetGrid){ cityRoute=makeCityRouteFromNodes(ordered, editorTrack.gridSize||70); wp=makeCityWpFromRoute(cityRoute, editorTrack.gridSize||70); type='city'; }
  else wp=editorTrack.useBezier?makeBezierPath(ordered,18):ordered.map(n=>[n.x,0,n.z]);
  return {id:editorTrack.id||uniqueTrackId(),name:editorTrack.name||'Custom Track',desc:editorTrack.desc||'Custom track',laps:+editorTrack.laps||3,rw:+editorTrack.rw||12,wp,previewColor:editorTrack.previewColor||'#44aaff',type,gridSize:editorTrack.gridSize||70,cityRoute,noAutoZones:buildNoAutoZones(ordered),sky:cssToHexNum(editorTrack.skyColor)||tod.sky,gnd:cssToHexNum(editorTrack.groundColor)||tod.gnd,timeOfDay:editorTrack.timeOfDay||'day',ambient:tod.ambient,ambientIntensity:tod.ambientIntensity,sun:tod.sun,sunIntensity:tod.sunIntensity,fill:tod.fill,fillIntensity:tod.fillIntensity,assets:deepClone(editorTrack.assets||[]),useBezier:!!editorTrack.useBezier};
}
function populateEditorUI(){ normalizeEditorTrack(); document.getElementById('editorTrackName').value=editorTrack.name||''; document.getElementById('editorTrackDesc').value=editorTrack.desc||''; document.getElementById('editorTrackLaps').value=editorTrack.laps||3; document.getElementById('editorTrackWidth').value=editorTrack.rw||12; document.getElementById('editorTrackColor').value=editorTrack.previewColor||'#44aaff'; document.getElementById('editorUseBezier').checked=editorTrack.useBezier!==false; document.getElementById('editorGroundColor').value=editorTrack.groundColor||'#1a3018'; document.getElementById('editorSkyColor').value=editorTrack.skyColor||'#0d1a2e'; document.getElementById('editorTimeOfDay').value=editorTrack.timeOfDay||'day'; document.getElementById('editorStreetGrid').checked=!!editorTrack.streetGrid; document.getElementById('editorGridSize').value=editorTrack.gridSize||70; renderEditorTrackList(); syncSelectedNodeUI(); requestEditorRebuild(true); }
function renderEditorTrackList(){ const wrap=document.getElementById('editorTrackList'); if(!wrap) return; wrap.innerHTML=''; getAllTracks().forEach(src=>{ const d=document.createElement('div'); d.className='editorListItem'+(String(editorTrack.id)===String(src.id)?' sel':''); d.textContent=src.name+(TRACKS.some(t=>String(t.id)===String(src.id))?' · built-in':''); d.onclick=()=>{ editorTrack=makeEditableTrackFromGameTrack(src); editorSelectedNode=0; editorSelectedAsset=-1; populateEditorUI(); }; wrap.appendChild(d); }); }
function syncSelectedNodeUI(){ normalizeEditorTrack(); const node=editorTrack.nodes[editorSelectedNode]||editorTrack.nodes[0]; if(!node)return; document.getElementById('editorNodeType').value=node.type||'track-node'; document.getElementById('editorSteepness').value=Math.round(node.steepness||40); document.getElementById('editorNodeInfo').textContent='Node '+(editorSelectedNode+1)+' · '+(node.type==='start-finish'?'Start/finish':node.type==='no-auto'?'No auto scenery':'Track node')+' · Steepness '+Math.round(node.steepness||40); }
function onEditorMetaChanged(){ if(!editorTrack)return; editorTrack.name=document.getElementById('editorTrackName').value; editorTrack.desc=document.getElementById('editorTrackDesc').value; editorTrack.laps=Math.max(1,Math.min(9,+document.getElementById('editorTrackLaps').value||3)); editorTrack.rw=Math.max(6,Math.min(30,+document.getElementById('editorTrackWidth').value||12)); editorTrack.previewColor=document.getElementById('editorTrackColor').value; editorTrack.useBezier=document.getElementById('editorUseBezier').checked; editorTrack.groundColor=document.getElementById('editorGroundColor').value; editorTrack.skyColor=document.getElementById('editorSkyColor').value; editorTrack.timeOfDay=document.getElementById('editorTimeOfDay').value; editorTrack.streetGrid=document.getElementById('editorStreetGrid').checked; editorTrack.gridSize=Math.max(40,Math.min(120,+document.getElementById('editorGridSize').value||70)); requestEditorRebuild(false); }
function onEditorStreetGridChanged(){ onEditorMetaChanged(); }
function onEditorNodeChanged(){ const node=editorTrack.nodes[editorSelectedNode]; if(!node)return; node.type=document.getElementById('editorNodeType').value; if(node.type==='start-finish') editorTrack.nodes.forEach((n,i)=>{ if(i!==editorSelectedNode && n.type==='start-finish') n.type='track-node'; }); node.steepness=+document.getElementById('editorSteepness').value||40; syncSelectedNodeUI(); requestEditorRebuild(false); }
function createNewEditorTrack(){ editorTrack={id:uniqueTrackId(),name:'New Track',desc:'Custom circuit',laps:3,rw:12,previewColor:'#44aaff',useBezier:true,timeOfDay:'day',groundColor:'#1a3018',skyColor:'#0d1a2e',streetGrid:false,gridSize:70,nodes:[{x:0,z:0,steepness:40,type:'start-finish'},{x:140,z:20,steepness:45,type:'track-node'},{x:160,z:-120,steepness:55,type:'track-node'},{x:20,z:-180,steepness:55,type:'track-node'},{x:-120,z:-90,steepness:35,type:'track-node'}],assets:[]}; editorSelectedNode=0; editorSelectedAsset=-1; populateEditorUI(); }
function duplicateEditorTrack(){ const data=editorTrackToGameTrack(); editorTrack=makeEditableTrackFromGameTrack(data); editorTrack.id=uniqueTrackId(); editorTrack.name+=' Copy'; populateEditorUI(); }
function addEditorNode(){ const n=editorTrack.nodes[editorSelectedNode]||editorTrack.nodes[0]; editorTrack.nodes.splice(editorSelectedNode+1,0,{x:n.x+40,z:n.z+20,steepness:n.steepness||40,type:'track-node'}); editorSelectedNode=Math.min(editorSelectedNode+1,editorTrack.nodes.length-1); syncSelectedNodeUI(); requestEditorRebuild(false); }
function insertEditorNodeAfter(){ addEditorNode(); }
function deleteEditorNode(){ if(editorTrack.nodes.length<=3) return; editorTrack.nodes.splice(editorSelectedNode,1); editorSelectedNode=Math.max(0,Math.min(editorSelectedNode,editorTrack.nodes.length-1)); normalizeEditorTrack(); syncSelectedNodeUI(); requestEditorRebuild(false); }
function deleteSelectedEditorAsset(){ if(editorSelectedAsset<0) return; editorTrack.assets.splice(editorSelectedAsset,1); editorSelectedAsset=-1; requestEditorRebuild(false); }
function resetEditorTrack(){ editorTrack=makeEditableTrackFromGameTrack(getTrackById(editorTrack.source||editorTrack.id)||TRACKS[0]); editorSelectedNode=0; editorSelectedAsset=-1; populateEditorUI(); }
function saveEditorTrack(){ const data=editorTrackToGameTrack(); data.id=TRACKS.some(t=>String(t.id)===String(editorTrack.id))?uniqueTrackId():(editorTrack.id||uniqueTrackId()); data.name=editorTrack.name||'Custom Track'; editorTrack.id=data.id; editorTrack.source=data.id; editorTrack.builtin=false; const idx=editorTracks.findIndex(t=>String(t.id)===String(data.id)); if(idx>=0) editorTracks[idx]=data; else editorTracks.push(data); persistEditorTracks(); selTrk=data.id; renderEditorTrackList(); notify('TRACK SAVED'); }
function deleteEditorTrack(){
  if(!editorTrack) return;
  if(TRACKS.some(t=>String(t.id)===String(editorTrack.id))){ notify('BUILT-IN TRACKS CANNOT BE DELETED'); return; }
  const id=String(editorTrack.id);
  editorTracks=editorTracks.filter(t=>String(t.id)!==id);
  if(String(selTrk)===id) selTrk=null;
  persistEditorTracks();
  const fallback=getAllTracks()[0]||TRACKS[0];
  editorTrack=makeEditableTrackFromGameTrack(fallback);
  editorSelectedNode=0; editorSelectedAsset=-1;
  populateEditorUI();
  notify('TRACK DELETED');
}
function requestEditorRebuild(resetCam){ editorNeedsRebuild=true; if(resetCam) resetEditorCameraToTrack(); }
function editorRebuildScene(resetCam){ trkData=editorTrackToGameTrack(); buildTrack(trkData); setupLights(); activeCam=camEditor; editorLastRebuild=performance.now(); editorNeedsRebuild=false; if(resetCam) resetEditorCameraToTrack(); }
function resetEditorCameraToTrack(){ const b=getEditorBounds(); editorCam.target.set((b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2); const span=Math.max(180,Math.max(b.maxX-b.minX,b.maxZ-b.minZ)); editorCam.distance=Math.max(180,span*1.15); editorCam.pitch=1.16; }
function showTrackEditor(){ ensureEditorBoot(); document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none'); document.getElementById('sEditor').style.display='flex'; document.getElementById('hud').style.display='none'; document.getElementById('hint').style.display='none'; bindEditorCanvas(); bindEditorAssetPalette(); populateEditorUI(); document.getElementById('editorPreviewBanner').style.display='block'; gState='editor'; stopAudio(); stopMusic(); activeCam=camEditor; requestEditorRebuild(true); }
function closeTrackEditor(){ document.getElementById('editorPreviewBanner').style.display='none'; showMain(); }
function toggleEditorPreview(){}
function updateEditorPreviewCamera(dt){ const move=(editorCam.distance*0.9+40)*dt; const yaw=editorCam.yaw; const fwdX=Math.sin(yaw), fwdZ=Math.cos(yaw), rightX=Math.sin(yaw+Math.PI/2), rightZ=Math.cos(yaw+Math.PI/2); let mx=0,mz=0; if(keys['KeyW']){mx+=fwdX;mz+=fwdZ;} if(keys['KeyS']){mx-=fwdX;mz-=fwdZ;} if(keys['KeyA']){mx-=rightX;mz-=rightZ;} if(keys['KeyD']){mx+=rightX;mz+=rightZ;} const ml=Math.hypot(mx,mz)||1; if(mx||mz){ editorCam.target.x+=mx/ml*move; editorCam.target.z+=mz/ml*move; } const horiz=Math.cos(editorCam.pitch)*editorCam.distance; const desired=new THREE.Vector3(editorCam.target.x+Math.sin(editorCam.yaw)*horiz, Math.sin(editorCam.pitch)*editorCam.distance, editorCam.target.z+Math.cos(editorCam.yaw)*horiz); camEditor.position.lerp(desired,0.18); camEditor.lookAt(editorCam.target.x,0,editorCam.target.z); activeCam=camEditor; }
function editorWorldToOverlay(vec,canvas){ const p=vec.clone().project(camEditor); if(p.z<-1||p.z>1) return null; const rr=renderer.domElement.getBoundingClientRect(), cr=canvas.getBoundingClientRect(); const sx=(p.x*0.5+0.5)*rr.width-(cr.left-rr.left), sy=(-p.y*0.5+0.5)*rr.height-(cr.top-rr.top); return {x:sx*(canvas.width/cr.width),y:sy*(canvas.height/cr.height)}; }
function editorClientToGround(clientX,clientY){ const rr=renderer.domElement.getBoundingClientRect(); const ndc=new THREE.Vector2(((clientX-rr.left)/rr.width)*2-1,-((clientY-rr.top)/rr.height)*2+1); raycaster.setFromCamera(ndc,camEditor); const out=new THREE.Vector3(); return raycaster.ray.intersectPlane(editorGroundPlane,out)?out:null; }
function editorCanPlaceAssetAt(x,z){ return !pointNearTrack(editorTrackToGameTrack(),x,z,3); }
function drawEditorCanvas(){ const canvas=document.getElementById('trackEditorCanvas'); if(!canvas||!editorTrack||gState!=='editor') return; const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); const data=editorTrackToGameTrack(); if(data.wp&&data.wp.length){ ctx.strokeStyle=(editorTrack.previewColor||'#44aaff')+'88'; ctx.lineWidth=4; ctx.lineJoin='round'; ctx.beginPath(); data.wp.forEach((p,i)=>{ const q=editorWorldToOverlay(new THREE.Vector3(p[0],0.2,p[2]),canvas); if(!q) return; i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y); }); ctx.closePath(); ctx.stroke(); } editorTrack.assets.forEach((a,i)=>{ const p=editorWorldToOverlay(new THREE.Vector3(a.x,3,a.z),canvas); if(!p) return; ctx.fillStyle=i===editorSelectedAsset?'#ffd166':(a.type==='building'?'#c792ea':a.type==='park'?'#55dd88':'#66cc66'); ctx.strokeStyle='#091018'; ctx.lineWidth=2; if(a.type==='building'){ ctx.fillRect(p.x-8,p.y-8,16,16); ctx.strokeRect(p.x-8,p.y-8,16,16); } else if(a.type==='park'){ ctx.fillRect(p.x-10,p.y-10,20,20); ctx.strokeRect(p.x-10,p.y-10,20,20); } else { ctx.beginPath(); ctx.arc(p.x,p.y,8,0,Math.PI*2); ctx.fill(); ctx.stroke(); } }); editorTrack.nodes.forEach((n,i)=>{ const p=editorWorldToOverlay(new THREE.Vector3(n.x,1,n.z),canvas); if(!p) return; ctx.beginPath(); ctx.fillStyle=n.type==='start-finish'?'#ffffff':(n.type==='no-auto'?'#7cc7ff':(i===editorSelectedNode?'#ffd166':'#ff6b6b')); ctx.arc(p.x,p.y,n.type==='start-finish'?10:8,0,Math.PI*2); ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='#091018'; ctx.stroke(); if(n.type==='start-finish'){ ctx.strokeStyle='#111'; ctx.setLineDash([5,3]); ctx.beginPath(); ctx.moveTo(p.x-14,p.y); ctx.lineTo(p.x+14,p.y); ctx.stroke(); ctx.setLineDash([]); } }); }
function bindEditorAssetPalette(){ document.querySelectorAll('#editorAssetPalette .assetChip').forEach(el=>{ if(el.dataset.bound) return; el.dataset.bound='1'; el.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain', el.dataset.asset); }); }); }
function bindEditorCanvas(){ const canvas=document.getElementById('trackEditorCanvas'); if(!canvas||canvas.dataset.bound) return; canvas.dataset.bound='1'; canvas.addEventListener('contextmenu',e=>e.preventDefault()); function nearestOverlayObject(e){ const r=canvas.getBoundingClientRect(); const lx=(e.clientX-r.left)*(canvas.width/r.width), ly=(e.clientY-r.top)*(canvas.height/r.height); let best=null,bestD=1e9; editorTrack.assets.forEach((a,i)=>{ const q=editorWorldToOverlay(new THREE.Vector3(a.x,3,a.z),canvas); if(!q) return; const d=(q.x-lx)*(q.x-lx)+(q.y-ly)*(q.y-ly); if(d<bestD&&d<500){ best={kind:'asset',index:i}; bestD=d; } }); editorTrack.nodes.forEach((n,i)=>{ const q=editorWorldToOverlay(new THREE.Vector3(n.x,1,n.z),canvas); if(!q) return; const d=(q.x-lx)*(q.x-lx)+(q.y-ly)*(q.y-ly); if(d<bestD&&d<550){ best={kind:'node',index:i}; bestD=d; } }); return best; } canvas.addEventListener('dragover',e=>e.preventDefault()); canvas.addEventListener('drop',e=>{ e.preventDefault(); const kind=e.dataTransfer.getData('text/plain'); if(!kind) return; const p=editorClientToGround(e.clientX,e.clientY); if(!p||!editorCanPlaceAssetAt(p.x,p.z)) return; editorTrack.assets.push({type:kind,x:p.x,z:p.z}); editorSelectedAsset=editorTrack.assets.length-1; requestEditorRebuild(false); }); canvas.addEventListener('pointerdown',e=>{ canvas.setPointerCapture(e.pointerId); editorMouse.lastX=e.clientX; editorMouse.lastY=e.clientY; if(e.button===2||e.button===1){ editorMouse.mode='orbit'; return; } const hit=nearestOverlayObject(e); if(hit&&hit.kind==='asset'){ editorSelectedAsset=hit.index; editorDrag={kind:'asset',index:hit.index}; requestEditorRebuild(false); return; } if(hit&&hit.kind==='node'){ editorSelectedNode=hit.index; syncSelectedNodeUI(); editorDrag={kind:'node',index:hit.index}; requestEditorRebuild(false); return; } editorMouse.mode='pan'; }); canvas.addEventListener('pointermove',e=>{ if(editorMouse.mode==='orbit'){ const dx=e.clientX-editorMouse.lastX, dy=e.clientY-editorMouse.lastY; editorCam.yaw-=dx*0.006; editorCam.pitch=Math.max(0.72,Math.min(1.45,editorCam.pitch-dy*0.004)); editorMouse.lastX=e.clientX; editorMouse.lastY=e.clientY; return; } if(editorMouse.mode==='pan'){ const dx=e.clientX-editorMouse.lastX, dy=e.clientY-editorMouse.lastY; const factor=editorCam.distance*0.0016; const rightYaw=editorCam.yaw+Math.PI/2; editorCam.target.x+=(-Math.sin(rightYaw)*dx + -Math.sin(editorCam.yaw)*dy)*factor; editorCam.target.z+=(-Math.cos(rightYaw)*dx + -Math.cos(editorCam.yaw)*dy)*factor; editorMouse.lastX=e.clientX; editorMouse.lastY=e.clientY; return; } if(!editorDrag) return; const p=editorClientToGround(e.clientX,e.clientY); if(!p) return; const snap=(e.shiftKey||editorTrack.streetGrid)?(editorTrack.gridSize||70):0; if(snap){ p.x=Math.round(p.x/snap)*snap; p.z=Math.round(p.z/snap)*snap; } if(editorDrag.kind==='node'){ editorTrack.nodes[editorDrag.index].x=p.x; editorTrack.nodes[editorDrag.index].z=p.z; } else if(editorDrag.kind==='asset' && editorCanPlaceAssetAt(p.x,p.z)){ editorTrack.assets[editorDrag.index].x=p.x; editorTrack.assets[editorDrag.index].z=p.z; } requestEditorRebuild(false); }); canvas.addEventListener('wheel',e=>{ e.preventDefault(); editorCam.distance=Math.max(70,Math.min(700,editorCam.distance*(1+Math.sign(e.deltaY)*0.08))); },{passive:false}); ['pointerup','pointerleave','pointercancel'].forEach(ev=>canvas.addEventListener(ev,()=>{ editorDrag=null; editorMouse.mode=null; })); }
function applyPlacedAssets(data){
  if(!data||!Array.isArray(data.assets)) return;
  data.assets.forEach(asset=>{
    if(pointNearTrack(data,asset.x,asset.z,3)) return;
    const sf=data.wp&&data.wp[0]?new THREE.Vector3(data.wp[0][0],0,data.wp[0][2]):new THREE.Vector3();
    const dx=asset.x-sf.x, dz=asset.z-sf.z; if(dx*dx+dz*dz<28*28) return;
    if(asset.type==='tree'){
      const g=new THREE.Group();
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.32,2.2,6),mat(0x5a3418)); trunk.position.y=1.1; g.add(trunk);
      const crown=new THREE.Mesh(new THREE.ConeGeometry(1.4,3.5,7),mat(0x2e6b34)); crown.position.y=3.5; g.add(crown);
      g.position.set(asset.x,0,asset.z); g.userData.trk=true; scene.add(g);
    }else if(asset.type==='park'){
      const park=new THREE.Mesh(new THREE.BoxGeometry(16,0.08,16),new THREE.MeshLambertMaterial({color:0x295a2b})); park.position.set(asset.x,0.04,asset.z); park.userData.trk=true; scene.add(park);
    }else{
      const h=8+((Math.abs(asset.x)+Math.abs(asset.z))%18);
      const b=new THREE.Mesh(new THREE.BoxGeometry(8,h,8),new THREE.MeshLambertMaterial({color:0x4a445d})); b.position.set(asset.x,h/2,asset.z); b.castShadow=true; b.userData.trk=true; scene.add(b);
      const roof=new THREE.Mesh(new THREE.BoxGeometry(8.5,0.35,8.5),new THREE.MeshLambertMaterial({color:0x22242a})); roof.position.set(asset.x,h+.18,asset.z); roof.userData.trk=true; scene.add(roof);
    }
  });
}

// ═══════════════════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════════════════
function onResize(){
  const W=window.innerWidth,H=window.innerHeight;
  renderer.setSize(W,H);
  [camChase,camCock,camEditor].forEach(c=>{c.aspect=W/H;c.updateProjectionMatrix();});
  resizeDC();
}
window.addEventListener('resize',onResize); onResize();

// ═══════════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════════
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  if(gState==='racing'){
    raceTime+=dt;
    const autoTouchThrottle=isTouchControlsVisibleInState(gState)
      && ('ontouchstart' in window||navigator.maxTouchPoints>0)
      && !touchState.brake;
    const thr=(keys['ArrowUp']||keys['KeyW']||touchState.throttle||autoTouchThrottle)?1:0;
    const brk=(keys['ArrowDown']||keys['KeyS']||touchState.brake)?1:0;
    const left=(keys['ArrowLeft']||keys['KeyA']||touchState.left);
    const right=(keys['ArrowRight']||keys['KeyD']||touchState.right);
    const str=left&&!right?1:right&&!left?-1:0;
    pCar.update({thr,brk,str},dt);
    for(const ai of aiControllers)ai.update(dt);
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&aiCars[i])aiSounds[i].update(aiCars[i],pCar);}
    updateAudio(thr,brk,dt); updateCamera(); updateHUD(); drawDash(); drawMinimap();
  } else if(gState==='cooldown'){
    // Player finished — car coasts, AI keeps racing behind results screen
    raceTime+=dt;
    pCar.update({thr:0,brk:0.3,str:0},dt);
    for(const ai of aiControllers){if(!ai.car.finished)ai.update(dt);}
    for(let i=0;i<aiSounds.length;i++){if(aiSounds[i]&&aiCars[i])aiSounds[i].update(aiCars[i],pCar);}
    updateAudio(0,0,dt); updateCamera();
    // Live-update results as AI cars finish
    if(document.getElementById('results').style.display==='flex') updateResultsUI();
  } else if(gState==='editorPreview'){
    updateEditorPreviewCamera(dt);
  } else if(gState==='editor'){
    updateEditorPreviewCamera(dt);
    if(editorNeedsRebuild&&performance.now()-editorLastRebuild>45){ editorRebuildScene(false); }
    drawEditorCanvas();
  } else if(gState==='countdown'||gState==='finished'||gState==='paused'){
    if(gState==='finished'){
      raceTime+=dt;
      for(const ai of aiControllers){if(!ai.car.finished)ai.update(dt);}
      updateHUD(); drawMinimap();
    }
    updateCamera();
  }
  renderer.render(scene,activeCam);
}

// ═══════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════
function showSettings(fromPause){
  settingsFromPause=!!fromPause;
  document.getElementById('settingsModal').style.display='block';
}
function closeSettings(){
  document.getElementById('settingsModal').style.display='none';
}

// ═══════════════════════════════════════════════════════
//  MENU FUNCTIONS
// ═══════════════════════════════════════════════════════
function showMain(){
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  document.getElementById('sMain').style.display='flex';
  document.getElementById('hud').style.display='none';
  document.getElementById('hint').style.display='none';
  gState='menu';
  updateTouchControlsVisibility();
  releaseAllTouchControls();
  document.getElementById('pauseMenu').style.display='none';
  document.getElementById('settingsModal').style.display='none';
  dc.style.display='none';
  editorPreviewMode=false;
  const epb=document.getElementById('editorPreviewBanner'); if(epb)epb.style.display='none';
  const epbtn=document.getElementById('editorPreviewBtn'); if(epbtn)epbtn.textContent='3D PREVIEW';
  stopAudio(); stopMusic();
  // Restart menu music (audio already initialised)
  if(audioReady)startMusic();
  for(const c of allCars)scene.remove(c.mesh);
  allCars=[]; aiCars=[]; pCar=null;
}

function showCarSel(){
  if(selTrk==null){ showTrkSel(); return; }
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sCar').style.display='flex';
  const ct=document.getElementById('carCards'); ct.innerHTML='';
  document.getElementById('btnGo').disabled=(selCar==null);
  CARS.forEach((c,i)=>{
    const d=document.createElement('div'); d.className='card'+(selCar===i?' sel':'');
    d.innerHTML=`<div class="dot" style="background:${c.hex};box-shadow:0 0 15px ${c.hex}55"></div>
      <h3>${c.name}</h3><p>${c.desc}</p>
      <div class="stat"><span class="sl">SPEED</span><div class="st"><div class="sf" style="width:${c.stats.s}%"></div></div></div>
      <div class="stat"><span class="sl">ACCEL</span><div class="st"><div class="sf" style="width:${c.stats.a}%"></div></div></div>
      <div class="stat"><span class="sl">HANDL</span><div class="st"><div class="sf" style="width:${c.stats.h}%"></div></div></div>`;
    d.onclick=()=>{
      document.querySelectorAll('#carCards .card').forEach(x=>x.classList.remove('sel'));
      d.classList.add('sel'); selCar=i; document.getElementById('btnGo').disabled=false;
    };
    ct.appendChild(d);
  });
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

function showTrkSel(){
  loadEditorTracks();
  document.querySelectorAll('.screen').forEach(s=>s.style.display='none');
  document.getElementById('sTrk').style.display='flex';
  document.getElementById('btnNxt').disabled=(selTrk==null);
  const COLORS=['#4488ff','#44cc66','#ffaa22','#ff4488','#22ddaa','#dd66ff','#66bbff'];
  const tt=document.getElementById('trkCards'); tt.innerHTML='';
  getAllTracks().forEach((t,i)=>{
    const card=document.createElement('div'); card.className='tcard'+(String(selTrk)===String(t.id)?' sel':'');
    const canvas=document.createElement('canvas'); canvas.width=280; canvas.height=230;
    canvas.style.borderRadius='6px';
    const h3=document.createElement('h3'); h3.textContent=t.name;
    const p=document.createElement('p'); p.textContent=t.desc+' · '+t.rw+'m wide'+(TRACKS.some(bt=>String(bt.id)===String(t.id))?'':' · Custom');
    card.appendChild(canvas); card.appendChild(h3); card.appendChild(p);
    card.onclick=()=>{
      document.querySelectorAll('#trkCards .tcard').forEach(x=>x.classList.remove('sel'));
      card.classList.add('sel'); selTrk=t.id; document.getElementById('btnNxt').disabled=false;
    };
    tt.appendChild(card);
    drawTrackPreview(canvas,t,t.previewColor||COLORS[i%COLORS.length]);
  });
}

function startRace(){
  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  initRace();
}
function restartRace(){
  document.getElementById('results').style.display='none';
  initRace();
}

document.getElementById('resumeBtn').addEventListener('click', resumeRace);
document.getElementById('showSettingsBtn').addEventListener('click', () => showSettings(true));
document.getElementById('quitToMenuBtn').addEventListener('click', showMain);
document.getElementById('musicVolSlider').addEventListener('input', e => onMusicVol(e.target.value));
document.getElementById('sfxVolSlider').addEventListener('input', e => onSfxVol(e.target.value));
document.getElementById('touchToggleInput').addEventListener('input', e => onTouchControlsToggle(e.target.checked));
document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);
document.getElementById('gameStartBtn').addEventListener('click', function() {tryStartMenuMusic();showTrkSel();});
document.getElementById('trackEditorBtn').addEventListener('click', function() {tryStartMenuMusic();showTrackEditor();});
document.getElementById('mainSettingsBtn').addEventListener('click', function() {tryStartMenuMusic();showSettings(false);});
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
document.getElementById('editorNodeType').addEventListener('change', onEditorNodeChanged);
document.getElementById('editorSteepness').addEventListener('input', onEditorNodeChanged);
document.getElementById('addNodeBtn').addEventListener('click', addEditorNode);
document.getElementById('insertNodeBtn').addEventListener('click', insertEditorNodeAfter);
document.getElementById('delNodeBtn').addEventListener('click', deleteEditorNode);
document.getElementById('delAssetBtn').addEventListener('click', deleteSelectedEditorAsset);
document.getElementById('resetEditorCamBtn').addEventListener('click', resetEditorCameraToTrack);
document.getElementById('saveEditorTrackBtn').addEventListener('click', saveEditorTrack);
document.getElementById('resetEditorTrackBtn').addEventListener('click', resetEditorTrack);
document.getElementById('menuBtn').addEventListener('click', showMain);
document.getElementById('raceAgainBtn').addEventListener('click', restartRace);

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
scene.background=new THREE.Color(0x050510);
setupTouchControls();
initTouchSettings();
setupLights(); animate(); showMain();