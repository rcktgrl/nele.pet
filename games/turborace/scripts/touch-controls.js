import { state } from './state.js';
import { toggleCam } from './camera.js';
const TOUCH_TOGGLE_KEY='turborace_touch_controls';
const GYRO_TOGGLE_KEY='turborace_gyro_enabled';
const touchPointers={throttle:new Set(),brake:new Set(),left:new Set(),right:new Set()};
export const touchState={throttle:false,brake:false,left:false,right:false};
let steerSliderValue=0;
let sliderPointerId=null;
const gyroState={available:false,active:false,permission:'unknown',gamma:0,steer:0};
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let touchControlsEnabled=false;
let gyroEnabled=true;

const GYRO_MAX_TILT=45;
const GYRO_DEADZONE=2.2;
const GYRO_SENSITIVITY=0.2;

function canUseGyro(){
  return typeof window!=='undefined' && 'DeviceOrientationEvent' in window;
}

function clamp(v,min,max){
  return Math.max(min,Math.min(max,v));
}

function updateGyroSteer(){
  if(!gyroState.active){
    gyroState.steer=0;
    return;
  }
  const abs=Math.abs(gyroState.gamma);
  if(abs<GYRO_DEADZONE){
    gyroState.steer=0;
    return;
  }
  // Normalize so steering starts at 0 at the deadzone edge (no jump discontinuity)
  const normalized=Math.min((abs-GYRO_DEADZONE)/(GYRO_MAX_TILT-GYRO_DEADZONE),1);
  // Power curve: sensitivity shapes response but max tilt always reaches full steering (1.0)
  const curved=Math.pow(normalized,1/GYRO_SENSITIVITY);
  gyroState.steer=clamp(Math.sign(gyroState.gamma)*curved,-1,1);
}

function setGyroStatus(msg,tappable=false){
  const el=document.getElementById('gyroStatus');
  if(!el)return;
  el.textContent=msg;
  el.style.cursor=tappable?'pointer':'';
}

function updateGyroStatusText(){
  if(!canUseGyro()){
    setGyroStatus('GYRO: not available on this device/browser.');
    return;
  }
  if(gyroState.permission==='denied'){
    setGyroStatus('GYRO: blocked by permissions. Using touch arrows.');
    return;
  }
  if(!touchControlsEnabled){
    setGyroStatus('GYRO: enable touch controls to use tilt steering.');
    return;
  }
  if(!gyroEnabled){
    setGyroStatus('GYRO: disabled. Toggle above to enable tilt steering.');
    return;
  }
  if(gyroState.active){
    setGyroStatus('GYRO: active tilt steering.');
    return;
  }
  if(gyroState.permission==='required'){
    setGyroStatus('GYRO: tap here to allow motion access (iOS requires a gesture).',true);
    return;
  }
  setGyroStatus('GYRO: ready. Tilt phone left/right to steer.');
}

function updateGyroBars(){
  // Use raw gamma (no deadzone) so the dot always tracks physical tilt
  const pct=50+clamp(gyroState.gamma/GYRO_MAX_TILT,-1,1)*50;
  const pos=pct+'%';
  const sd=document.getElementById('gyroSettingsDot');
  if(sd)sd.style.left=pos;
  const td=document.getElementById('gyroSteerDot');
  if(td)td.style.left=pos;
}

function updateGyroBarVisibility(){
  const steerBar=document.getElementById('gyroSteerBar');
  const settingsBar=document.getElementById('gyroSettingsBar');
  const slider=document.getElementById('touchSteerSlider');
  const gyroActive=gyroState.active&&gyroEnabled;
  const inGameGyro=gyroActive&&touchControlsEnabled;
  if(steerBar)steerBar.style.display=inGameGyro?'flex':'none';
  if(slider)slider.style.display=inGameGyro?'none':'flex';
  if(settingsBar)settingsBar.style.display=gyroActive?'block':'none';
}

function onDeviceOrientation(event){
  if(typeof event.gamma!=='number')return;
  gyroState.gamma=isIOS?-event.gamma:event.gamma;
  updateGyroSteer();
  updateGyroBars();
}

function activateGyroListener(){
  if(gyroState.active||!canUseGyro())return;
  window.addEventListener('deviceorientation',onDeviceOrientation,true);
  gyroState.active=true;
  gyroState.available=true;
  updateGyroStatusText();
  updateGyroBarVisibility();
}

function deactivateGyroListener(){
  if(!gyroState.active)return;
  window.removeEventListener('deviceorientation',onDeviceOrientation,true);
  gyroState.active=false;
  gyroState.gamma=0;
  updateGyroSteer();
  updateGyroBars();
  updateGyroStatusText();
  updateGyroBarVisibility();
}

async function ensureGyroPermission(){
  if(!gyroEnabled){
    deactivateGyroListener();
    return;
  }
  if(!canUseGyro()){
    gyroState.permission='unsupported';
    updateGyroStatusText();
    return;
  }
  const needsRequest=typeof DeviceOrientationEvent!=='undefined'
    && typeof DeviceOrientationEvent.requestPermission==='function';
  if(!needsRequest){
    gyroState.permission='granted';
    activateGyroListener();
    return;
  }
  try{
    const result=await DeviceOrientationEvent.requestPermission();
    gyroState.permission=(result==='granted')?'granted':'denied';
    if(result==='granted')activateGyroListener();
    else deactivateGyroListener();
  }catch{
    gyroState.permission='required';
    deactivateGyroListener();
  }
  updateGyroStatusText();
}

export function getGyroSteering(){
  return gyroState.active?gyroState.steer:0;
}

export function getTouchSliderSteer(){return steerSliderValue;}

// Raw normalized gamma for HUD visualization — tracks physical tilt smoothly without deadzone or curve
export function getGyroVisualSteer(){
  if(!gyroState.active)return 0;
  return clamp(gyroState.gamma/GYRO_MAX_TILT,-1,1);
}

export function isTouchControlsEnabled(){ return touchControlsEnabled; }

export function isTouchControlsVisibleInState(state){
  return touchControlsEnabled&&(state==='racing'||state==='cooldown');
}

export function updateTouchControlsVisibility(gState){
  const root=document.getElementById('touchControls');
  if(!root)return;
  root.style.display=isTouchControlsVisibleInState(gState)?'flex':'none';
}

function updateHintVisibility(){
  const hint=document.getElementById('hint');
  if(!hint)return;
  if(hint.style.display==='none'&&!touchControlsEnabled)return;
  if(touchControlsEnabled){hint.style.display='none';}
}

export function onTouchControlsToggle(enabled){
  touchControlsEnabled=!!enabled;
  const input=document.getElementById('touchToggleInput');
  if(input&&input.checked!==touchControlsEnabled)input.checked=touchControlsEnabled;
  localStorage.setItem(TOUCH_TOGGLE_KEY,touchControlsEnabled?'1':'0');
  if(!touchControlsEnabled)releaseAllTouchControls();
  if(touchControlsEnabled)ensureGyroPermission();
  else deactivateGyroListener();
  updateTouchControlsVisibility(state.gState);
  updateHintVisibility();
  updateGyroBarVisibility();
  updateGyroStatusText();
}

export function onGyroToggle(enabled){
  gyroEnabled=!!enabled;
  const input=document.getElementById('gyroToggleInput');
  if(input&&input.checked!==gyroEnabled)input.checked=gyroEnabled;
  localStorage.setItem(GYRO_TOGGLE_KEY,gyroEnabled?'1':'0');
  if(gyroEnabled&&touchControlsEnabled)ensureGyroPermission();
  else deactivateGyroListener();
  updateGyroBarVisibility();
  updateGyroStatusText();
}

export function initTouchSettings(){
  const saved=localStorage.getItem(TOUCH_TOGGLE_KEY);
  touchControlsEnabled=(saved==='1');
  const input=document.getElementById('touchToggleInput');
  if(input)input.checked=touchControlsEnabled;
  const savedGyro=localStorage.getItem(GYRO_TOGGLE_KEY);
  gyroEnabled=(savedGyro===null)?true:(savedGyro==='1');
  const gyroInput=document.getElementById('gyroToggleInput');
  if(gyroInput)gyroInput.checked=gyroEnabled;
  updateGyroStatusText();
}

function syncTouchControlFromPointers(name){
  setTouchControl(name,touchPointers[name].size>0);
}

function setTouchControl(name,active){
  touchState[name]=active;
  const btn=document.querySelector(`#touchControls [data-control="${name}"]`);
  if(btn)btn.classList.toggle('active',!!active);
}

export function releaseAllTouchControls(){
  Object.values(touchPointers).forEach(set=>set.clear());
  setTouchControl('throttle',false);
  setTouchControl('brake',false);
  setTouchControl('left',false);
  setTouchControl('right',false);
  steerSliderValue=0;
  sliderPointerId=null;
  const thumb=document.getElementById('touchSteerThumb');
  if(thumb){thumb.classList.remove('dragging');thumb.style.transform='translate(-50%,-50%)';}
}

function setupSteerSlider(){
  const slider=document.getElementById('touchSteerSlider');
  const thumb=document.getElementById('touchSteerThumb');
  if(!slider||!thumb)return;
  let sliderRect=null;
  function getSteerValue(clientX){
    if(!sliderRect)return 0;
    const center=sliderRect.left+sliderRect.width/2;
    const maxOffset=sliderRect.width/2-26;
    return clamp((clientX-center)/Math.max(maxOffset,1),-1,1);
  }
  function applyThumb(value){
    steerSliderValue=value;
    if(!sliderRect)return;
    const maxOffset=sliderRect.width/2-26;
    thumb.style.transform=`translate(calc(-50% + ${value*maxOffset}px),-50%)`;
  }
  slider.addEventListener('pointerdown',e=>{
    if(sliderPointerId!==null)return;
    e.preventDefault();
    slider.setPointerCapture(e.pointerId);
    sliderPointerId=e.pointerId;
    sliderRect=slider.getBoundingClientRect();
    thumb.classList.add('dragging');
    applyThumb(getSteerValue(e.clientX));
  });
  slider.addEventListener('pointermove',e=>{
    if(e.pointerId!==sliderPointerId)return;
    e.preventDefault();
    applyThumb(getSteerValue(e.clientX));
  });
  function releaseSlider(e){
    if(e.pointerId!==sliderPointerId)return;
    sliderPointerId=null;
    sliderRect=null;
    thumb.classList.remove('dragging');
    steerSliderValue=0;
    thumb.style.transform='translate(-50%,-50%)';
  }
  slider.addEventListener('pointerup',releaseSlider);
  slider.addEventListener('pointercancel',releaseSlider);
  slider.addEventListener('contextmenu',e=>e.preventDefault());
}

export function setupTouchControls({pauseRace,resumeRace}={}){
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
      const gs=state.gState;
      if(btn.dataset.tap==='camera' && (gs==='racing'||gs==='cooldown')) toggleCam();
      if(btn.dataset.tap==='pause'){
        if(gs==='racing'||gs==='cooldown') pauseRace&&pauseRace();
        else if(gs==='paused') resumeRace&&resumeRace();
      }
    };
    btn.addEventListener('pointerdown',e=>{ e.preventDefault(); btn.setPointerCapture(e.pointerId); });
    btn.addEventListener('pointerup',onTap);
    btn.addEventListener('contextmenu',e=>e.preventDefault());
  });
  setupSteerSlider();
  window.addEventListener('pointerup',e=>{
    Object.keys(touchPointers).forEach(name=>{
      if(touchPointers[name].has(e.pointerId)){
        touchPointers[name].delete(e.pointerId);
        syncTouchControlFromPointers(name);
      }
    });
  });
  window.addEventListener('blur',releaseAllTouchControls);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)releaseAllTouchControls();
  });
  const gyroStatusEl=document.getElementById('gyroStatus');
  if(gyroStatusEl){
    gyroStatusEl.addEventListener('click',()=>{
      if(gyroState.permission==='required'&&touchControlsEnabled&&gyroEnabled)ensureGyroPermission();
    });
  }
  if(touchControlsEnabled&&gyroEnabled)ensureGyroPermission();
  else updateGyroStatusText();
}
