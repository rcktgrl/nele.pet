const TOUCH_TOGGLE_KEY='turborace_touch_controls';
const touchPointers={throttle:new Set(),brake:new Set(),left:new Set(),right:new Set()};
export const touchState={throttle:false,brake:false,left:false,right:false};
let touchControlsEnabled=false;

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
  updateTouchControlsVisibility();
}

export function initTouchSettings(){
  const saved=localStorage.getItem(TOUCH_TOGGLE_KEY);
  touchControlsEnabled=(saved==='1');
  const input=document.getElementById('touchToggleInput');
  if(input)input.checked=touchControlsEnabled;
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
}