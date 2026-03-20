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
    selTrk: null,
    aiDifficulty: 'medium',  // 'easy' | 'medium' | 'hard' | 'neural'
    neuralModelGenome: null, // genome array for neural AI race (null = use default)
    neuralModelLayers: null, // layer spec for neural AI race (null = infer from genome)
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
    sceneryExclusionZones: [],
    aiControllers: [],
    cityCorridors: null, // For city tracks: array of {x,z,hw,hd} axis-aligned driveable rectangles
    cityAiPts: null,    // For city tracks: dense waypoints following grid roads exactly
    gravelProfile: null, // Runoff profile used for gravel physics detection
    renderer: null,
    trainer: null,       // GeneticTrainer instance, active only during training
    trainGrid: [],       // Array of {pos,hdg} start positions for training cars
    trainNumSims: 8,     // Number of parallel independent simulations (read by initTraining)
    trainPopSize: 8,     // Population size (read by initTraining)
    trainFF: 1,          // Fast-forward multiplier (1–10 physics substeps per frame)
    trainGenDuration: 35,// Generation duration in seconds
    trainHiddenLayers: 1,// Number of hidden layers (takes effect next run)
    trainHiddenSize: 5,  // Nodes per hidden layer (takes effect next run)
    trainOnTrackRewardRate: 0.10,
    trainStuckPenaltyRate: 5,
    trainGravelPenaltyBase: 0.5,
    trainGravelGrowth: 0.30,
    trainOffTrackMult: 10,
    trainOffTrackDQTime: 3,
    trainDQPenalty: 200,
    trainMutRate: 0.15,
    trainMutStrength: 0.35,
    trainBestCarPos: null, // {x,z} of the best car's peak position from previous generation
    trainSplitCams: [],  // PerspectiveCamera array for split-screen training view
    trainGroups: [],     // [{cars, controllers, trainer, grid}] — one per simulation
    trainEliteCloneMode: false, // when true: all sims run full duration, then best car is cloned with mutations
};
