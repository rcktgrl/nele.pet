'use strict';

// Core audio context and state
export let audioCtx = null;
export let audioReady = false;
export let musicMaster = null, sfxMaster = null;
let engOsc = null, engOsc2 = null, engGain = null, engFilter = null, engFilter2 = null;
let scrOsc = null, scrGain = null;
export let musicPlaying = false, musicStep = 0, nextStepTime = 0, musicTimerId = null;

// Array of positional AI engine sounds, managed internally but exported for read-only access
export let aiSounds = [];

// Volume state (0-1)
let musicVolume = 0.6, sfxVolume = 0.8;

export function initAudio(){
  if(audioReady) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gains
    musicMaster = audioCtx.createGain(); musicMaster.gain.value = musicVolume; musicMaster.connect(audioCtx.destination);
    sfxMaster = audioCtx.createGain();   sfxMaster.gain.value = sfxVolume;   sfxMaster.connect(audioCtx.destination);

    // --- Player engine: two oscillators sculpted by filter ---
    engOsc = audioCtx.createOscillator();   engOsc.type = 'sawtooth';  engOsc.frequency.value = 60;
    engOsc2 = audioCtx.createOscillator();  engOsc2.type = 'square';   engOsc2.frequency.value = 40;
    engFilter = audioCtx.createBiquadFilter();  engFilter.type = 'lowpass';  engFilter.frequency.value = 500; engFilter.Q.value = 1.8;
    engFilter2 = audioCtx.createBiquadFilter(); engFilter2.type = 'bandpass'; engFilter2.frequency.value = 320; engFilter2.Q.value = 3;
    const hg = audioCtx.createGain(); hg.gain.value = 0.22;
    const sg = audioCtx.createGain(); sg.gain.value = 0.5;
    engGain = audioCtx.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter); engFilter.connect(engGain);
    engOsc2.connect(sg); sg.connect(engFilter2); engFilter2.connect(hg); hg.connect(engGain);
    engGain.connect(sfxMaster);

    // --- Tyre screech ---
    scrOsc = audioCtx.createOscillator(); scrOsc.type = 'sawtooth'; scrOsc.frequency.value = 220;
    const scrFilt = audioCtx.createBiquadFilter(); scrFilt.type = 'bandpass'; scrFilt.frequency.value = 800; scrFilt.Q.value = 5;
    scrGain = audioCtx.createGain(); scrGain.gain.value = 0;
    scrOsc.connect(scrFilt); scrFilt.connect(scrGain); scrGain.connect(sfxMaster);

    engOsc.start(); engOsc2.start(); scrOsc.start();

    audioReady = true;
    applyVolumes();
  } catch(e) {
    console.warn('Audio init failed:', e);
  }
}

function applyVolumes(){
  if(!audioReady) return;
  musicMaster.gain.setTargetAtTime(musicVolume, audioCtx.currentTime, .05);
  sfxMaster.gain.setTargetAtTime(sfxVolume, audioCtx.currentTime, .05);
}

export function onMusicVol(v){
  musicVolume = v/100;
  document.getElementById('musicVolVal').textContent = v;
  if(audioReady) musicMaster.gain.setTargetAtTime(musicVolume, audioCtx.currentTime, .05);
}

export function onSfxVol(v){
  sfxVolume = v/100;
  document.getElementById('sfxVolVal').textContent = v;
  if(audioReady) sfxMaster.gain.setTargetAtTime(sfxVolume, audioCtx.currentTime, .05);
}

export function updateAudio(thr, brk, dt, pCar, keys){
  if(!audioReady || !pCar) return;
  // Silence engine when player is finished
  if(pCar.finished){
    engGain.gain.setTargetAtTime(0, audioCtx.currentTime, .1);
    scrGain.gain.setTargetAtTime(0, audioCtx.currentTime, .1);
    return;
  }
  const now = audioCtx.currentTime, rpm = pCar.rpm, sf = pCar.spd / pCar.data.maxSpd;
  const freq = 55 + rpm/8000*155;
  engOsc.frequency.setTargetAtTime(freq, now, .06);
  engOsc2.frequency.setTargetAtTime(freq*.5, now, .06);
  const cut = 280 + rpm/8000*2800*(0.4 + thr*.6);
  engFilter.frequency.setTargetAtTime(cut, now, .05);
  const vol = Math.min(.42, 0.06 + thr*.20 + sf*.16 + (brk?.04:0));
  engGain.gain.setTargetAtTime(vol, now, .04);
  const ts = Math.abs((keys['ArrowLeft']||keys['KeyA'])?1:(keys['ArrowRight']||keys['KeyD'])?-1:0);
  const sc = Math.max(0, (brk*.9 + ts*.3)*sf - .22)*0.32;
  scrGain.gain.setTargetAtTime(sc, now, .08);
  scrOsc.frequency.setTargetAtTime(160 + sf*140, now, .1);
}

export function stopAudio(){
  if(!audioReady) return;
  engGain.gain.cancelScheduledValues(0);
  engGain.gain.value = 0;
  scrGain.gain.cancelScheduledValues(0);
  scrGain.gain.value = 0;
  for(const s of aiSounds) s.silence();
}

export function playBeep(freq, dur, vol, type){
  if(!audioReady) return;
  vol = vol||0.3; type = type||'sine';
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime+dur);
  o.connect(g); g.connect(sfxMaster);
  o.start(); o.stop(audioCtx.currentTime+dur);
}

export function playVictoryJingle(){
  if(!audioReady) return;
  const t = audioCtx.currentTime;
  const notes=[523,659,784,1047,784,1047];
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

export function playLossSound(){
  if(!audioReady) return;
  const t=audioCtx.currentTime;
  const notes=[392,349,330,262];
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
export class AISound{
  constructor(){
    if(!audioReady) return;
    this.osc = audioCtx.createOscillator();
    this.osc2 = audioCtx.createOscillator();
    this.filt = audioCtx.createBiquadFilter();
    this.filt.type='lowpass'; this.filt.frequency.value=400;
    this.gain = audioCtx.createGain(); this.gain.gain.value=0;
    this.panner = audioCtx.createStereoPanner();
    this.osc.type='sawtooth'; this.osc.frequency.value=55;
    this.osc2.type='square'; this.osc2.frequency.value=28;
    const sg2=audioCtx.createGain(); sg2.gain.value=0.4;
    this.osc.connect(this.filt); this.filt.connect(this.gain);
    this.osc2.connect(sg2); sg2.connect(this.gain);
    this.gain.connect(this.panner); this.panner.connect(sfxMaster);
    this.osc.start(); this.osc2.start();
  }
  update(aiCar,playerCar){
    if(!audioReady||!this.gain) return;
    if(aiCar.finished){ this.silence(); return; }
    const now = audioCtx.currentTime;
    const dx = aiCar.pos.x - playerCar.pos.x, dz = aiCar.pos.z - playerCar.pos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const vol = Math.max(0,0.18*(1-dist/90));
    const cosH=Math.cos(-playerCar.hdg), sinH=Math.sin(-playerCar.hdg);
    const px = cosH*dx - sinH*dz;
    const pan = Math.max(-1, Math.min(1, px/35));
    const freq = 48 + aiCar.rpm/8000*90;
    this.osc.frequency.setTargetAtTime(freq, now, .1);
    this.osc2.frequency.setTargetAtTime(freq*.5, now, .1);
    this.filt.frequency.setTargetAtTime(300+aiCar.rpm/8000*600, now, .1);
    this.gain.gain.setTargetAtTime(vol, now, .08);
    this.panner.pan.setTargetAtTime(pan, now, .1);
  }
  silence(){ if(audioReady && this.gain) this.gain.gain.setTargetAtTime(0, audioCtx.currentTime, .2); }
}

export function initAiSounds(count){
  aiSounds.length = 0;
  for(let i=0;i<count;i++) aiSounds.push(new AISound());
}

export function clearAiSounds(){
  for(const s of aiSounds) s.silence();
  aiSounds.length = 0;
}

// ─── Procedural Music Sequencer ───────────────────────
const BPM = 128, STEP_S = 60/BPM/4;
const PAT_KICK  = [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0, 1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0];
const PAT_CLAP  = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0, 0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0];
const PAT_HHAT  = [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0, 1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1];
const PAT_OHHT  = [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0, 0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0];
const PAT_BASS  = [55,0,0,55,0,0,41,0, 55,0,0,55,0,0,49,0, 55,0,0,55,0,0,41,0, 82,0,73,0,55,0,82,0];
const PAT_LEAD  = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 220,0,165,0,196,0,220,0,247,0,220,0,196,165,0,0];

export function startMusic(){
  if(!audioReady||musicPlaying) return;
  musicPlaying = true; musicStep = 0; nextStepTime = audioCtx.currentTime + 0.1;
  scheduleMusicLoop();
}

export function stopMusic(){
  musicPlaying = false;
  if(musicTimerId){ clearInterval(musicTimerId); musicTimerId = null; }
}

function scheduleMusicLoop(){
  if(!musicPlaying) return;
  musicTimerId = setInterval(() => {
    if(!musicPlaying || !audioReady) return;
    while(nextStepTime < audioCtx.currentTime + 0.18){
      const s = musicStep % 32, t = nextStepTime;
      if(PAT_KICK[s]) mKick(t);
      if(PAT_CLAP[s]) mClap(t);
      if(PAT_HHAT[s]) mHihat(t,false);
      if(PAT_OHHT[s]) mHihat(t,true);
      if(PAT_BASS[s]) mBass(t, PAT_BASS[s]);
      if(PAT_LEAD[s]) mLead(t, PAT_LEAD[s]);
      musicStep++; nextStepTime += STEP_S;
    }
  }, 20);
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
export let menuMusicStarted=false;
export function tryStartMenuMusic(){
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

export function announce(text){
  if(!window.speechSynthesis)return;
  const u=new SpeechSynthesisUtterance(text);
  u.rate=1.05; u.pitch=0.92; u.volume=Math.max(0.2,sfxVolume);
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
