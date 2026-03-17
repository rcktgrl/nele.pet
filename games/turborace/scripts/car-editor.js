'use strict';
import { THREE } from './three.js';
import { state, scene, keys, camCarEditor } from './state.js';
import { stopAudio, stopMusic } from './audio.js';
import { showMain } from './menu.js';
import { notify } from './notify.js';

// ─── Camera state ──────────────────────────────────────
const camState = { target: new THREE.Vector3(0,0,0), yaw:0.6, pitch:0.9, distance:8 };
const mouseState = { mode:null, lastX:0, lastY:0 };

// ─── Scene objects ─────────────────────────────────────
let ceGroup = null;
let ceGrid = null;
let ceSelBox = null;
let partMeshes = [];

// ─── Designs / state ───────────────────────────────────
let designs = [];
let current = null;
let selIdx = -1;
let placeMode = false;
let drag = null; // {index}

// ─── Geometry ──────────────────────────────────────────
function makeWedgeGeo() {
  const g = new THREE.BufferGeometry();
  // Ramp: full back face, slopes from top-back down to bottom-front
  const v = new Float32Array([
    -0.5,-0.5,-0.5,  // 0 bottom-back-left
     0.5,-0.5,-0.5,  // 1 bottom-back-right
    -0.5, 0.5,-0.5,  // 2 top-back-left
     0.5, 0.5,-0.5,  // 3 top-back-right
    -0.5,-0.5, 0.5,  // 4 bottom-front-left
     0.5,-0.5, 0.5,  // 5 bottom-front-right
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex([
    0,3,1, 0,2,3,   // back rect
    0,1,5, 0,5,4,   // bottom rect
    2,5,3, 2,4,5,   // sloped top
    0,4,2,          // left triangle
    1,3,5,          // right triangle
  ]);
  g.computeVertexNormals();
  return g;
}

const CUBE_GEO   = new THREE.BoxGeometry(1,1,1);
const CYL_GEO    = new THREE.CylinderGeometry(0.5,0.5,1,16);
const WEDGE_GEO  = makeWedgeGeo();

function geoForType(t) {
  if (t==='cylinder') return CYL_GEO;
  if (t==='wedge')    return WEDGE_GEO;
  return CUBE_GEO;
}

// ─── Helpers ───────────────────────────────────────────
function hexToCss(n) { return '#'+((n||0)&0xffffff).toString(16).padStart(6,'0'); }
function cssToHex(s) { return parseInt(String(s||'#4488ff').replace('#',''),16)||0x4488ff; }
function uid()       { return 'car-'+Date.now()+'-'+Math.floor(Math.random()*9999); }

// ─── Scene build ───────────────────────────────────────
function buildScene() {
  if (ceGroup) { scene.remove(ceGroup); ceGroup=null; }
  if (ceGrid)  { scene.remove(ceGrid);  ceGrid=null; }
  if (ceSelBox){ scene.remove(ceSelBox);ceSelBox=null; }
  partMeshes = [];

  ceGrid = new THREE.GridHelper(12,24,0x334466,0x1a2233);
  scene.add(ceGrid);

  ceGroup = new THREE.Group();
  if (current) {
    current.parts.forEach((p,i) => {
      const m = new THREE.MeshLambertMaterial({color:p.color||0x4488ff,side:THREE.DoubleSide});
      const mesh = new THREE.Mesh(geoForType(p.type), m);
      applyTransform(mesh, p);
      mesh.userData.partIndex = i;
      ceGroup.add(mesh);
      partMeshes.push(mesh);
    });
  }
  scene.add(ceGroup);

  ceSelBox = new THREE.Mesh(
    new THREE.BoxGeometry(1,1,1),
    new THREE.MeshBasicMaterial({color:0xffdd00,wireframe:true})
  );
  ceSelBox.visible = false;
  scene.add(ceSelBox);

  refreshSelBox();
}

function applyTransform(mesh, p) {
  mesh.position.set(p.x, p.y, p.z);
  mesh.rotation.set(p.rx, p.ry, p.rz);
  mesh.scale.set(p.sx, p.sy, p.sz);
}

function refreshSelBox() {
  if (!ceSelBox) return;
  if (selIdx<0 || !current || selIdx>=current.parts.length || !partMeshes[selIdx]) {
    ceSelBox.visible = false;
    return;
  }
  const box = new THREE.Box3().setFromObject(partMeshes[selIdx]);
  const sz = new THREE.Vector3(); box.getSize(sz);
  const ct = new THREE.Vector3(); box.getCenter(ct);
  ceSelBox.position.copy(ct);
  ceSelBox.scale.set(sz.x+0.07,sz.y+0.07,sz.z+0.07);
  ceSelBox.rotation.set(0,0,0);
  ceSelBox.visible = true;
}

// ─── Camera update (called every frame) ────────────────
export function updateCarEditorCamera(dt) {
  const move = (camState.distance*0.8+2)*dt;
  const yaw  = camState.yaw;
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
  const rtX  = Math.sin(yaw+Math.PI/2), rtZ = Math.cos(yaw+Math.PI/2);
  if (keys['KeyW']) { camState.target.x+=fwdX*move; camState.target.z+=fwdZ*move; }
  if (keys['KeyS']) { camState.target.x-=fwdX*move; camState.target.z-=fwdZ*move; }
  if (keys['KeyA']) { camState.target.x-=rtX*move;  camState.target.z-=rtZ*move; }
  if (keys['KeyD']) { camState.target.x+=rtX*move;  camState.target.z+=rtZ*move; }
  const horiz = Math.cos(camState.pitch)*camState.distance;
  const desired = new THREE.Vector3(
    camState.target.x + Math.sin(camState.yaw)*horiz,
    Math.sin(camState.pitch)*camState.distance,
    camState.target.z + Math.cos(camState.yaw)*horiz
  );
  camCarEditor.position.lerp(desired,0.18);
  camCarEditor.lookAt(camState.target.x, 0, camState.target.z);
  state.activeCam = camCarEditor;
}

// Handle selected-part keyboard movement (arrow keys, Q/E, R/F)
export function handleCarEditorKeys(dt) {
  if (selIdx<0||!current) return;
  const p = current.parts[selIdx];
  const step = 2.0*dt;
  const rotStep = 60*Math.PI/180*dt;
  let dirty = false;
  if (keys['ArrowLeft'])  { p.x-=step; dirty=true; }
  if (keys['ArrowRight']) { p.x+=step; dirty=true; }
  if (keys['ArrowUp'])    { p.z-=step; dirty=true; }
  if (keys['ArrowDown'])  { p.z+=step; dirty=true; }
  if (keys['KeyQ'])       { p.y+=step; dirty=true; }
  if (keys['KeyE'])       { p.y-=step; dirty=true; }
  if (keys['KeyR'])       { p.ry+=rotStep; dirty=true; }
  if (keys['KeyF'])       { p.ry-=rotStep; dirty=true; }
  if (dirty) {
    if (partMeshes[selIdx]) applyTransform(partMeshes[selIdx], p);
    refreshSelBox();
    syncPartProps();
  }
}

// ─── NDC helpers ───────────────────────────────────────
function clientToNDC(cx, cy) {
  const rr = state.renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((cx-rr.left)/rr.width)*2-1,
    -((cy-rr.top)/rr.height)*2+1
  );
}

function raycastGround(cx, cy, atY=0) {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(clientToNDC(cx,cy), camCarEditor);
  const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -atY);
  const pt = new THREE.Vector3();
  return rc.ray.intersectPlane(plane, pt) ? pt : null;
}

function raycastParts(cx, cy) {
  if (!partMeshes.length) return -1;
  const rc = new THREE.Raycaster();
  rc.setFromCamera(clientToNDC(cx,cy), camCarEditor);
  const hits = rc.intersectObjects(partMeshes, false);
  return hits.length ? partMeshes.indexOf(hits[0].object) : -1;
}

// ─── Canvas interaction ────────────────────────────────
export function bindCarEditorCanvas() {
  const el = document.getElementById('carEditorInteract');
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  el.addEventListener('contextmenu', e=>e.preventDefault());

  el.addEventListener('pointerdown', e=>{
    el.setPointerCapture(e.pointerId);
    mouseState.lastX = e.clientX;
    mouseState.lastY = e.clientY;
    if (e.button===2||e.button===1) { mouseState.mode='orbit'; return; }

    if (placeMode) {
      const gp = raycastGround(e.clientX, e.clientY, 0);
      if (gp) {
        const type = document.getElementById('ceShapePicker')?.value||'cube';
        addPart(type, snapQ(gp.x), 0.5, snapQ(gp.z));
      }
      return;
    }

    const hi = raycastParts(e.clientX, e.clientY);
    if (hi>=0) {
      selIdx = hi;
      drag = {index:hi};
      refreshSelBox();
      syncPartProps();
    } else {
      selIdx = -1;
      drag = null;
      refreshSelBox();
      syncPartProps();
      mouseState.mode = 'pan';
    }
  });

  el.addEventListener('pointermove', e=>{
    if (mouseState.mode==='orbit') {
      const dx=e.clientX-mouseState.lastX, dy=e.clientY-mouseState.lastY;
      camState.yaw   -= dx*0.006;
      camState.pitch  = Math.max(0.15,Math.min(1.5,camState.pitch-dy*0.004));
      mouseState.lastX=e.clientX; mouseState.lastY=e.clientY;
      return;
    }
    if (mouseState.mode==='pan') {
      const dx=e.clientX-mouseState.lastX, dy=e.clientY-mouseState.lastY;
      const f = camState.distance*0.002;
      const ry = camState.yaw+Math.PI/2;
      camState.target.x += (-Math.sin(ry)*dx + -Math.sin(camState.yaw)*dy)*f;
      camState.target.z += (-Math.cos(ry)*dx + -Math.cos(camState.yaw)*dy)*f;
      mouseState.lastX=e.clientX; mouseState.lastY=e.clientY;
      return;
    }
    if (drag!==null && current) {
      const p = current.parts[drag.index];
      const gp = raycastGround(e.clientX, e.clientY, p.y);
      if (gp) {
        p.x=snapQ(gp.x); p.z=snapQ(gp.z);
        if (partMeshes[drag.index]) applyTransform(partMeshes[drag.index], p);
        refreshSelBox();
        syncPartProps();
      }
    }
  });

  el.addEventListener('wheel', e=>{
    e.preventDefault();
    camState.distance = Math.max(1.5,Math.min(30,camState.distance*(1+Math.sign(e.deltaY)*0.1)));
  },{passive:false});

  ['pointerup','pointerleave','pointercancel'].forEach(ev=>
    el.addEventListener(ev,()=>{ drag=null; mouseState.mode=null; })
  );
}

function snapQ(v) { return Math.round(v*4)/4; }

// ─── Part operations ───────────────────────────────────
function addPart(type, x, y, z) {
  if (!current) return;
  const colorEl = document.getElementById('cePartColor');
  const color = colorEl ? cssToHex(colorEl.value) : 0x4488ff;
  current.parts.push({type, x, y, z, rx:0, ry:0, rz:0, sx:1, sy:1, sz:1, color});
  selIdx = current.parts.length-1;
  buildScene();
  syncSidebar();
}

export function deleteSelectedPart() {
  if (!current||selIdx<0) return;
  current.parts.splice(selIdx,1);
  selIdx = Math.min(selIdx, current.parts.length-1);
  if (selIdx<0 && current.parts.length>0) selIdx=0;
  buildScene();
  syncSidebar();
}

export function onPartPropChange() {
  if (!current||selIdx<0||selIdx>=current.parts.length) return;
  const p = current.parts[selIdx];
  p.x  = parseFloat(document.getElementById('ceX').value)||0;
  p.y  = parseFloat(document.getElementById('ceY').value)||0;
  p.z  = parseFloat(document.getElementById('ceZ').value)||0;
  p.rx = (parseFloat(document.getElementById('ceRX').value)||0)*Math.PI/180;
  p.ry = (parseFloat(document.getElementById('ceRY').value)||0)*Math.PI/180;
  p.rz = (parseFloat(document.getElementById('ceRZ').value)||0)*Math.PI/180;
  p.sx = Math.max(0.05,parseFloat(document.getElementById('ceSX').value)||1);
  p.sy = Math.max(0.05,parseFloat(document.getElementById('ceSY').value)||1);
  p.sz = Math.max(0.05,parseFloat(document.getElementById('ceSZ').value)||1);
  p.color = cssToHex(document.getElementById('cePartColor').value);
  if (partMeshes[selIdx]) {
    applyTransform(partMeshes[selIdx], p);
    partMeshes[selIdx].material.color.setHex(p.color);
  }
  refreshSelBox();
}

// ─── UI sync ───────────────────────────────────────────
function syncPartProps() {
  const panel = document.getElementById('cePartProps');
  if (!panel) return;
  const has = current && selIdx>=0 && selIdx<current.parts.length;
  panel.style.display = has ? '' : 'none';
  if (!has) return;
  const p = current.parts[selIdx];
  document.getElementById('cePartType').textContent = p.type;
  document.getElementById('ceX').value  = p.x.toFixed(2);
  document.getElementById('ceY').value  = p.y.toFixed(2);
  document.getElementById('ceZ').value  = p.z.toFixed(2);
  document.getElementById('ceRX').value = Math.round(p.rx*180/Math.PI);
  document.getElementById('ceRY').value = Math.round(p.ry*180/Math.PI);
  document.getElementById('ceRZ').value = Math.round(p.rz*180/Math.PI);
  document.getElementById('ceSX').value = p.sx.toFixed(2);
  document.getElementById('ceSY').value = p.sy.toFixed(2);
  document.getElementById('ceSZ').value = p.sz.toFixed(2);
  document.getElementById('cePartColor').value = hexToCss(p.color);
}

function syncSidebar() {
  const nameEl  = document.getElementById('ceDesignName');
  const countEl = document.getElementById('cePartCount');
  const placeBtn = document.getElementById('cePlaceBtn');
  if (nameEl && current) nameEl.value = current.name||'';
  if (countEl && current) countEl.textContent = current.parts.length;
  if (placeBtn) placeBtn.classList.toggle('btn-active', placeMode);
  syncPartProps();
  renderDesignList();
}

function renderDesignList() {
  const wrap = document.getElementById('ceDesignList');
  if (!wrap) return;
  wrap.innerHTML = '';
  designs.forEach(d=>{
    const el = document.createElement('div');
    el.className = 'editorListItem'+(current&&d.id===current.id?' sel':'');
    el.textContent = d.name||'Unnamed Car';
    el.onclick = ()=>{
      current=d; selIdx=-1; placeMode=false;
      buildScene(); syncSidebar();
    };
    wrap.appendChild(el);
  });
}

// ─── Persistence ───────────────────────────────────────
function loadDesigns() {
  try { designs = JSON.parse(localStorage.getItem('turborace_car_designs')||'[]'); }
  catch { designs=[]; }
  if (!Array.isArray(designs)) designs=[];
}

function saveDesigns() {
  localStorage.setItem('turborace_car_designs', JSON.stringify(designs));
}

export function saveDesign() {
  if (!current) return;
  const nameEl = document.getElementById('ceDesignName');
  if (nameEl) current.name = nameEl.value||'My Car';
  const i = designs.findIndex(d=>d.id===current.id);
  if (i>=0) designs[i]=current; else designs.push(current);
  saveDesigns();
  renderDesignList();
  notify('CAR DESIGN SAVED');
}

export function newDesign() {
  const d = {id:uid(), name:'New Car', parts:[]};
  designs.push(d);
  current=d; selIdx=-1; placeMode=false;
  buildScene(); syncSidebar();
}

export function deleteDesign() {
  if (!current) return;
  designs = designs.filter(d=>d.id!==current.id);
  saveDesigns();
  current = designs[0]||{id:uid(),name:'New Car',parts:[]};
  if (!designs.length) designs.push(current);
  selIdx=-1; buildScene(); syncSidebar();
  notify('DESIGN DELETED');
}

export function togglePlaceMode() {
  placeMode = !placeMode;
  syncSidebar();
}

export function onNameChange() {
  if (current) {
    const el = document.getElementById('ceDesignName');
    if (el) { current.name=el.value; renderDesignList(); }
  }
}

// ─── Entry / exit ──────────────────────────────────────
export function showCarEditor() {
  loadDesigns();
  if (!designs.length) { const d={id:uid(),name:'New Car',parts:[]}; designs.push(d); }
  current  = designs[0];
  selIdx   = -1;
  placeMode = false;

  document.querySelectorAll('.screen,#results').forEach(s=>s.style.display='none');
  document.getElementById('sCarEditor').style.display = 'flex';
  document.getElementById('hud').style.display   = 'none';
  document.getElementById('hint').style.display  = 'none';

  stopAudio(); stopMusic();
  scene.background = new THREE.Color(0x050510);

  camState.target.set(0,0,0);
  camState.yaw=0.6; camState.pitch=0.9; camState.distance=8;

  state.gState  = 'carEditor';
  state.activeCam = camCarEditor;

  buildScene();
  bindCarEditorCanvas();
  syncSidebar();
}

export function closeCarEditor() {
  if (ceGroup) { scene.remove(ceGroup); ceGroup=null; }
  if (ceGrid)  { scene.remove(ceGrid);  ceGrid=null; }
  if (ceSelBox){ scene.remove(ceSelBox);ceSelBox=null; }
  partMeshes = [];
  showMain();
}
