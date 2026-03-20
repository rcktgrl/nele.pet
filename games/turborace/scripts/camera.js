import { THREE } from './three.js';
import {
  camChase,
  camCock,
  dc,
  state,
  camEditor,
  raycaster,
  editorGroundPlane,
  editorCam,
  raceCamOrbit,
  keys
} from './state.js';

'use strict';

export function updateCamera(){
  if(!state.pCar)return;
  const now=performance.now();
  if(now-raceCamOrbit.lastInput>2000){
    raceCamOrbit.yaw*=0.88;
    raceCamOrbit.pitch*=0.88;
  }
  raceCamOrbit.pitch=Math.max(-0.55,Math.min(0.75,raceCamOrbit.pitch));
  const fwd=new THREE.Vector3(Math.sin(state.pCar.hdg),0,Math.cos(state.pCar.hdg));
  if(state.camMode==='chase'){
    const orbitYaw=state.pCar.hdg+Math.PI+raceCamOrbit.yaw;
    const back=new THREE.Vector3(Math.sin(orbitYaw),0,Math.cos(orbitYaw));
    const camHeight=5.0+raceCamOrbit.pitch*3.5;
    const dist=raceCamOrbit.distance||11;
    const tgt=state.pCar.pos.clone().addScaledVector(back,dist).add(new THREE.Vector3(0,camHeight,0));
    camChase.position.lerp(tgt,.09);
    const look=state.pCar.pos.clone().addScaledVector(fwd,5).add(new THREE.Vector3(0,.8+raceCamOrbit.pitch*1.2,0));
    camChase.lookAt(look);
    state.activeCam=camChase;
  } else {
    // Use per-car cockpit height — camera above roof, moved forward past windshield
    const camH=state.pCar.data.camH||1.8;
    // Position: 1.2m forward (past windshield), camH above car base
    const cp=state.pCar.pos.clone().addScaledVector(fwd,1.2).add(new THREE.Vector3(0,camH,0));
    camCock.position.copy(cp);
    camCock.near=1.2; camCock.updateProjectionMatrix();
    const lookDir=new THREE.Vector3(Math.sin(state.pCar.hdg+raceCamOrbit.yaw*0.65),Math.max(-0.25,Math.min(0.25,-0.04-raceCamOrbit.pitch*0.18)),Math.cos(state.pCar.hdg+raceCamOrbit.yaw*0.65)).normalize();
    camCock.lookAt(cp.clone().addScaledVector(lookDir,55));
    state.activeCam=camCock;
  }
}

export function toggleCam(){
  state.camMode=state.camMode==='chase'?'cockpit':'chase';
  dc.style.display=state.camMode==='cockpit'?'block':'none';
  document.getElementById('speedBox').style.display=state.camMode==='chase'?'block':'none';
  document.getElementById('gearBox').style.display=state.camMode==='chase'?'block':'none';
  document.getElementById('camLabel').textContent=state.camMode==='chase'?'[ C ] COCKPIT VIEW':'[ C ] CHASE CAM';
}

export function updateTrainSplitCameras(){
  // Top-down orthographic camera is static; aspect ratio is updated in the render pipeline
}

export function resetEditorCameraToTrack(){
  const b=getEditorBounds();
  editorCam.target.set((b.minX+b.maxX)/2,0,(b.minZ+b.maxZ)/2);
  const span=Math.max(180,Math.max(b.maxX-b.minX,b.maxZ-b.minZ));
  editorCam.distance=Math.max(180,span*1.15);
  editorCam.pitch=1.16;
}

export function updateEditorPreviewCamera(dt){
  const move=(editorCam.distance*0.9+40)*dt;
  const yaw=editorCam.yaw;
  const fwdX=Math.sin(yaw), fwdZ=Math.cos(yaw), rightX=Math.sin(yaw+Math.PI/2), rightZ=Math.cos(yaw+Math.PI/2);
  let mx=0,mz=0;
  if(keys['KeyW']){
    mx+=fwdX;mz+=fwdZ;
  }
  if(keys['KeyS']){
    mx-=fwdX;mz-=fwdZ;
  }
  if(keys['KeyA']){
    mx-=rightX;mz-=rightZ;
  }
  if(keys['KeyD']){
    mx+=rightX;mz+=rightZ;
  }
  const ml=Math.hypot(mx,mz)||1;
  if(mx||mz){
    editorCam.target.x+=mx/ml*move;
    editorCam.target.z+=mz/ml*move;
  }
  const horiz=Math.cos(editorCam.pitch)*editorCam.distance;
  const desired=new THREE.Vector3(editorCam.target.x+Math.sin(editorCam.yaw)*horiz, Math.sin(editorCam.pitch)*editorCam.distance, editorCam.target.z+Math.cos(editorCam.yaw)*horiz);
  camEditor.position.lerp(desired,0.18);
  camEditor.lookAt(editorCam.target.x,0,editorCam.target.z);
  state.activeCam=camEditor;
}

export function editorWorldToOverlay(vec,canvas){
  const p=vec.clone().project(camEditor);
  if(p.z<-1||p.z>1) return null;
  const rr=state.renderer.domElement.getBoundingClientRect(), cr=canvas.getBoundingClientRect();
  const sx=(p.x*0.5+0.5)*rr.width-(cr.left-rr.left), sy=(-p.y*0.5+0.5)*rr.height-(cr.top-rr.top);
  return {x:sx*(canvas.width/cr.width),y:sy*(canvas.height/cr.height)};
}

export function editorClientToGround(clientX,clientY){
  const rr=state.renderer.domElement.getBoundingClientRect();
  const ndc=new THREE.Vector2(((clientX-rr.left)/rr.width)*2-1,-((clientY-rr.top)/rr.height)*2+1);
  raycaster.setFromCamera(ndc,camEditor);
  const out=new THREE.Vector3();
  return raycaster.ray.intersectPlane(editorGroundPlane,out)?out:null;
}

// Helper function for resetEditorCameraToTrack
function getEditorBounds(){
  normalizeEditorTrack();
  const pts=[...state.editorTrack.nodes.map(n=>({x:n.x,z:n.z})), ...state.editorTrack.assets.map(a=>({x:a.x,z:a.z}))];
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  pts.forEach(p=>{ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.z<minZ)minZ=p.z; if(p.z>maxZ)maxZ=p.z; });
  if(!isFinite(minX)){ minX=-150; maxX=150; minZ=-150; maxZ=150; }
  return {minX,maxX,minZ,maxZ};
}

// Helper function for getEditorBounds
export function normalizeEditorTrack(){
  if(!state.editorTrack) return;
  if(!Array.isArray(state.editorTrack.nodes)||state.editorTrack.nodes.length<3) state.editorTrack.nodes=[{x:0,z:0,steepness:40,type:'start-finish'},{x:120,z:0,steepness:40,type:'no-auto'},{x:120,z:-120,steepness:40,type:'no-auto'},{x:0,z:-120,steepness:40,type:'no-auto'}];
  let sfCount=0;
  // eslint-disable-next-line no-unused-vars
  state.editorTrack.nodes.forEach((n,i)=>{ if(typeof n.steepness!=='number') n.steepness=40; if(!Number.isFinite(n.gravelPitSize)) n.gravelPitSize=100; n.gravelPitSize=Math.max(0,Math.min(400,+n.gravelPitSize||100)); n.type=(n.type==='start-finish'&&sfCount++===0)?'start-finish':'no-auto'; });
  if(!state.editorTrack.nodes.some(n=>n.type==='start-finish')) state.editorTrack.nodes[0].type='start-finish';
  if(state.editorTrack.nodes.length){
    const lastIdx=state.editorTrack.nodes.length-1;
    if(state.editorTrack.nodes[lastIdx].type==='start-finish') state.editorTrack.nodes[lastIdx].type='no-auto';
    state.editorTrack.nodes[lastIdx].type='no-auto';
  }
  if(!Array.isArray(state.editorTrack.assets)) state.editorTrack.assets=[];
  if(typeof state.editorTrack.enableRunoff!=='boolean') state.editorTrack.enableRunoff=true;
  if(!Number.isFinite(state.editorTrack.trackGenerationVersion)) state.editorTrack.trackGenerationVersion=1;
  state.editorTrack.trackGenerationVersion=Math.max(1,Math.floor(state.editorTrack.trackGenerationVersion));
  state.editorTrack.gridSize=Math.max(40,Math.min(120,+state.editorTrack.gridSize||70));
}