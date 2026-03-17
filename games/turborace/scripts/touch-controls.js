const TOUCH_TOGGLE_KEY='turborace_touch_controls';
const touchPointers={throttle:new Set(),brake:new Set(),left:new Set(),right:new Set()};
export const touchState={throttle:false,brake:false,left:false,right:false};
const gyroState={available:false,active:false,permission:'unknown',gamma:0,steer:0};
let touchControlsEnabled=false;

const GYRO_MAX_TILT=24;
const GYRO_DEADZONE=2.2;

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
  gyroState.steer=clamp(gyroState.gamma/GYRO_MAX_TILT,-1,1);
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

function onDeviceOrientation(event){
  if(typeof event.gamma!=='number')return;
  gyroState.gamma=event.gamma;
  updateGyroSteer();
}

function activateGyroListener(){
  if(gyroState.active||!canUseGyro())return;
  window.addEventListener('deviceorientation',onDeviceOrientation,true);
  gyroState.active=true;
  gyroState.available=true;
  updateGyroStatusText();
}

function deactivateGyroListener(){
  if(!gyroState.active)return;
  window.removeEventListener('deviceorientation',onDeviceOrientation,true);
  gyroState.active=false;
  gyroState.gamma=0;
  updateGyroSteer();
  updateGyroStatusText();
}

async function ensureGyroPermission(){
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

export function isTouchControlsVisibleInState(state){
  return touchControlsEnabled&&(state==='racing'||state==='cooldown');
}

export function updateTouchControlsVisibility(gState){
  const root=document.getElementById('touchControls');
  if(!root)return;
  root.style.display=isTouchControlsVisibleInState(gState)?'flex':'none';
}

export function onTouchControlsToggle(enabled){
  touchControlsEnabled=!!enabled;
  const input=document.getElementById('touchToggleInput');
  if(input&&input.checked!==touchControlsEnabled)input.checked=touchControlsEnabled;
  localStorage.setItem(TOUCH_TOGGLE_KEY,touchControlsEnabled?'1':'0');
  if(!touchControlsEnabled)releaseAllTouchControls();
  if(touchControlsEnabled)ensureGyroPermission();
  else deactivateGyroListener();
  updateTouchControlsVisibility();
  updateGyroStatusText();
}

export function initTouchSettings(){
  const saved=localStorage.getItem(TOUCH_TOGGLE_KEY);
  touchControlsEnabled=(saved==='1');
  const input=document.getElementById('touchToggleInput');
  if(input)input.checked=touchControlsEnabled;
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
}

export function setupTouchControls(gState){
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
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)releaseAllTouchControls();
  });
  const gyroStatusEl=document.getElementById('gyroStatus');
  if(gyroStatusEl){
    gyroStatusEl.addEventListener('click',()=>{
      if(gyroState.permission==='required'&&touchControlsEnabled)ensureGyroPermission();
    });
  }
  if(touchControlsEnabled)ensureGyroPermission();
  else updateGyroStatusText();
}
