import { THREE } from "./three";

export const gc=document.getElementById('gc');
export const scene=new THREE.Scene();
export const clock=new THREE.Clock();
export const camChase=new THREE.PerspectiveCamera(72,1,.1,2000);
export const camCock=new THREE.PerspectiveCamera(88,1,.05,2000);
export const dc=document.getElementById('dc'),dctx=dc.getContext('2d');
export const mmc=document.getElementById('mmc'),mmctx=mmc.getContext('2d');

export const state = {
    activeCam: camChase,
    camMode: 'chase'
};