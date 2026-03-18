'use strict';
import { THREE } from './three.js';
import { scene, state } from './state.js';

export function setupLights(){
  const rm=[]; scene.traverse(o=>{if(o.isLight)rm.push(o);}); rm.forEach(l=>scene.remove(l));
  const isCity=state.trkData&&state.trkData.type==='city';
  const ambientCol=state.trkData&&state.trkData.ambient!=null?state.trkData.ambient:(isCity?0x667788:0xffffff);
  const ambientInt=state.trkData&&state.trkData.ambientIntensity!=null?state.trkData.ambientIntensity:(isCity?.35:.55);
  const sunCol=state.trkData&&state.trkData.sun!=null?state.trkData.sun:(isCity?0x8899bb:0xffffff);
  const sunInt=state.trkData&&state.trkData.sunIntensity!=null?state.trkData.sunIntensity:(isCity?.6:1.1);
  const fillCol=state.trkData&&state.trkData.fill!=null?state.trkData.fill:(isCity?0x334466:0x5566bb);
  const fillInt=state.trkData&&state.trkData.fillIntensity!=null?state.trkData.fillIntensity:(isCity?.20:.30);
  scene.add(new THREE.AmbientLight(ambientCol,ambientInt));
  const sun=new THREE.DirectionalLight(sunCol,sunInt);
  sun.position.set(isCity?-40:80,180,isCity?-60:100); sun.castShadow=true;
  sun.shadow.mapSize.width=sun.shadow.mapSize.height=2048;
  sun.shadow.camera.left=-340;sun.shadow.camera.right=340;sun.shadow.camera.top=340;sun.shadow.camera.bottom=-340;
  sun.shadow.camera.far=700; sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
  const fill=new THREE.DirectionalLight(fillCol,fillInt);
  fill.position.set(-60,70,-80); scene.add(fill);
  if(isCity||(state.trkData&&state.trkData.timeOfDay==='night')){
    const up=new THREE.DirectionalLight(0x556688,.15); up.position.set(0,-20,0); scene.add(up);
  }
}
