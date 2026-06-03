import { THREE } from './three.js';

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
export const raceCamOrbit={yaw:0,pitch:0,lastInput:0,distance:11};

export const keys = {};

export const state = {
    activeCam: camChase,
    camMode: 'chase',
    gState: 'menu',
    selCar: null,
    carColor: null,          // chosen car body colour (hex number) or null = car default
    selTrk: null,
    aiDifficulty: 'medium',  // 'easy' | 'medium' | 'hard'
    opponentMode: 'ai',      // 'ai' | 'ghost'
    carCardPreviewScene: null,
    carCardPreviewCamera: null,
    carCardPreviews: [],
    carCardPreviewLastTime: 0,
    carCardPreviewRaf: 0,
    folderTracks: [],
    editorTracks: [],
    editorTrack: null,
    editorSelectedNode: 0,
    editorSelectedAsset: -1,
    editorBrushEnabled: false,
    editorBrushAsset: 'tree',
    editorBrushSize: 1,
    editorBrushSpacing: 12,
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
    trkWallLeft: [],
    trkWallRight: [],
    trkEdgeLeft: [],
    trkEdgeRight: [],
    sceneryExclusionZones: [],
    aiControllers: [],
    cityCorridors: null,
    cityAiPts: null,
    gravelProfile: null,
    renderer: null,

    // ── VS Mode ──────────────────────────────────────────────────────────────
    vsMode: false,           // true when in a vs race/lobby
    vsNetwork: null,         // VsNetwork instance
    vsIsHost: false,

    // Lobby state
    vsRoomCode: '',
    vsLobbyPlayers: [],      // real players from presence [{id, name, isHost}]
    vsLobbyAIs: [],          // AI bots added by host [{id, name, carIdx}]
    vsGuestCars: {},         // id → carIdx (guest selections received by host)

    // Race state (populated when race starts)
    vsMyId: '',              // this client's network id (= vsNetwork.myId)
    vsSlots: [],             // [{id, name, isAI, carIdx}] ordered slot list
    vsCarsById: {},          // id → Car instance
    vsCarStates: {},         // id → latest received snapshot (for HUD/minimap)
    vsCarBuffers: {},        // id → [{t,x,z,hdg,spd,lap,totalProg}] for interpolation
    vsFinished: {},          // id → finTime
    vsAIControllers: [],     // [{ai, slotId}] — host only

    // Broadcast throttle
    vsPosSendTimer: 0,
    vsPosSendInterval: 0.033, // 30 Hz
};
