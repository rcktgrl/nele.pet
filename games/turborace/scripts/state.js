import { THREE } from "./three";

export const gc=document.getElementById('gc');
export const scene=new THREE.Scene();
export const clock=new THREE.Clock();
export const camChase=new THREE.PerspectiveCamera(72,1,.1,2000);
export const camCock=new THREE.PerspectiveCamera(88,1,.05,2000);
export const dc=document.getElementById('dc'),dctx=dc.getContext('2d');
export const mmc=document.getElementById('mmc'),mmctx=mmc.getContext('2d');

export const camEditor=new THREE.PerspectiveCamera(55,1,.1,3000);
export const raycaster=new THREE.Raycaster();
export const editorGroundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);

export const editorMouse = {mode:null,lastX:0,lastY:0};
export const editorCam = {target:new THREE.Vector3(),yaw:0,pitch:1.16,distance:260};

export const raceCamOrbit={yaw:0,pitch:0,lastInput:0};

export const state = {
    activeCam: camChase,
    camMode: 'chase',
    gState: 'menu',
    selCar: null,
    selTrk: null,
    carCardPreviewScene: null,
    carCardPreviewCamera: null,
    carCardPreviews: [],
    carCardPreviewLastTime: 0,
    carCardPreviewRaf: 0,
    editorTracks: [],
    editorTrack: null,
    editorSelectedNode: 0,
    editorSelectedAsset: -1,
    editorDrag: null,
    editorNeedsRebuild: false,
    editorLastRebuild: 0,
    raceTime: 0,
    pCar: null,
    aiCars: [],
    allCars: [],
    trkData: null,
    trkCurve: null,
    trkPts: [],
    trkCurv: [],
    aiControllers: [],
    cityCorridors: null, // For city tracks: array of {x,z,hw,hd} axis-aligned driveable rectangles
    cityAiPts: null    // For city tracks: dense waypoints following grid roads exactly
};