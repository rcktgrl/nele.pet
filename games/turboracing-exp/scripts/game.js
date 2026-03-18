import { TURBORACING_EXP_VERSION } from './version.js';
import { createRenderPipeline } from './render/pipeline.js';
import { THREE } from './three.js';
import { gc, scene, clock, camChase, camCock, camEditor, state, keys } from './state.js';
import {
  onTouchControlsToggle,
  onGyroToggle,
  initTouchSettings,
  setupTouchControls,
} from './touch-controls.js';
import { initAudioSettings, onMusicVol, onSfxVol, startMusic, audioReady } from './audio.js';
import { toggleCam, adjustTrainingCameraZoom } from './camera.js';
import { setupLights } from './lighting.js';
import { resizeDC } from './hud.js';
import { setOnlineGhostToggle, setOnlineGhostCount, readOnlineGhostToggle, readOnlineGhostCount } from './ghost.js';
import {
  pauseRace, resumeRace, startRace, restartRace,
  openTrainingModal, closeTrainingModal, startTrainingFromUi,
  importTrainingJsonFromUi, exportTrainingJsonToUi, updateTrainingSelectionUi, stopTraining
} from './race.js';
import {
  setEditorNodeCount, setEditorBrushAsset, setEditorBrushEnabled, setEditorBrushSize, setEditorBrushSpacing,
  onEditorMetaChanged, onEditorStreetGridChanged, onEditorNodeChanged,
  addEditorNode, insertEditorNodeAfter, deleteEditorNode, deleteSelectedEditorAsset,
  createNewEditorTrack, duplicateEditorTrack, deleteEditorTrack, resetEditorTrack,
  saveEditorTrack, upgradeEditorTrackToLatestGeneration, showTrackEditor,
  reverseEditorTrack, exportTrackAsJSON,
} from './editor.js';
import { showMain, showIntro, showTrkSel, showCarSel, showOnlineTrkSel, showSettings, closeSettings } from './menu.js';
import { closeTrackLeaderboardModal } from './leaderboard.js';
import { resetEditorCameraToTrack as resetEditorCamera } from './camera.js';
import { loadArcadeUser } from './user.js';
import { updateGameFrame, updateRaceCameraOrbit } from './game-loop.js';

'use strict';

function tryStartMenuMusic() {
  if (audioReady) {
    startMusic();
  }
}

function closeTrackEditor() {
  document.getElementById('editorPreviewBanner').style.display = 'none';
  showMain();
}

function bindKeyboardInput() {
  document.addEventListener('keydown', (event) => {
    keys[event.code] = true;

    if (event.code === 'KeyC' && (state.gState === 'racing' || state.gState === 'cooldown')) {
      toggleCam();
    }

    if (event.code === 'Escape') {
      const leaderboardModal = document.getElementById('leaderboardModal');
      if (leaderboardModal?.style.display === 'flex') {
        closeTrackLeaderboardModal();
        return;
      }

      if (state.gState === 'training') {
        stopTraining();
      } else if (state.gState === 'racing' || state.gState === 'cooldown') {
        pauseRace();
      } else if (state.gState === 'paused') {
        resumeRace();
      }
    }
  });

  document.addEventListener('keyup', (event) => {
    keys[event.code] = false;
  });
}

function bindPointerInput() {
  document.addEventListener('pointermove', updateRaceCameraOrbit);
  gc.addEventListener('contextmenu', (event) => event.preventDefault());
  gc.addEventListener('wheel', (event) => {
    if (state.gState === 'training') {
      event.preventDefault();
      adjustTrainingCameraZoom(event.deltaY);
    }
  }, { passive: false });
}

function bindSettingsControls() {
  document.getElementById('musicVolSlider').addEventListener('input', (event) => onMusicVol(event.target.value));
  document.getElementById('sfxVolSlider').addEventListener('input', (event) => onSfxVol(event.target.value));
  document.getElementById('touchToggleInput').addEventListener('input', (event) => onTouchControlsToggle(event.target.checked));
  document.getElementById('gyroToggleInput').addEventListener('input', (event) => onGyroToggle(event.target.checked));
  document.getElementById('onlineGhostToggleInput').addEventListener('input', (event) => setOnlineGhostToggle(event.target.checked));
  document.getElementById('onlineGhostCountSelect').addEventListener('change', (event) => setOnlineGhostCount(event.target.value));
  document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);
  document.getElementById('showSettingsBtn').addEventListener('click', showSettings);
  document.getElementById('mainSettingsBtn').addEventListener('click', () => { tryStartMenuMusic(); showSettings(); });
  document.getElementById('trainAiBtn').addEventListener('click', () => { tryStartMenuMusic(); openTrainingModal(); });
  document.getElementById('trainAiCloseBtn').addEventListener('click', closeTrainingModal);
  document.getElementById('trainAiStartBtn').addEventListener('click', startTrainingFromUi);
  document.getElementById('trainAiImportBtn').addEventListener('click', importTrainingJsonFromUi);
  document.getElementById('trainAiExportBtn').addEventListener('click', exportTrainingJsonToUi);
}

function bindMenuButtons() {
  document.getElementById('introStartBtn').addEventListener('click', () => { tryStartMenuMusic(); showMain(); });
  document.getElementById('gameStartBtn').addEventListener('click', () => { tryStartMenuMusic(); showTrkSel(); });
  document.getElementById('trackEditorBtn').addEventListener('click', () => { tryStartMenuMusic(); showTrackEditor(); });
  document.getElementById('backToSelectionBtn').addEventListener('click', () => { window.location.href = '../index.html'; });
  document.getElementById('showTrkSelBtn').addEventListener('click', showTrkSel);
  document.getElementById('trkSelBackBtn').addEventListener('click', showMain);
  document.getElementById('loadOnlineTracksBtn').addEventListener('click', showOnlineTrkSel);
  document.getElementById('onlineTrkBackBtn').addEventListener('click', showTrkSel);
  document.getElementById('btnOnlineNxt').addEventListener('click', showCarSel);
  document.getElementById('btnNxt').addEventListener('click', showCarSel);
  document.getElementById('quitToMenuBtn').addEventListener('click', showMain);
  document.getElementById('menuBtn').addEventListener('click', showMain);
}

function bindRaceButtons() {
  document.getElementById('resumeBtn').addEventListener('click', resumeRace);
  document.getElementById('restartBtn').addEventListener('click', restartRace);
  document.getElementById('btnGo').addEventListener('click', startRace);
  document.getElementById('raceAgainBtn').addEventListener('click', restartRace);
}

function bindEditorControls() {
  document.getElementById('closeEditorBtn').addEventListener('click', closeTrackEditor);
  document.getElementById('newTrackBtn').addEventListener('click', createNewEditorTrack);
  document.getElementById('dupeTrackBtn').addEventListener('click', duplicateEditorTrack);
  document.getElementById('delTrackBtn').addEventListener('click', deleteEditorTrack);
  document.getElementById('editorTrackName').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorTrackDesc').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorTrackLaps').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorTrackWidth').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorTrackColor').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorUseBezier').addEventListener('change', onEditorMetaChanged);
  document.getElementById('editorGroundColor').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorSkyColor').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorTimeOfDay').addEventListener('change', onEditorMetaChanged);
  document.getElementById('editorStreetGrid').addEventListener('change', onEditorStreetGridChanged);
  document.getElementById('editorGridSize').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorEnableRunoff').addEventListener('change', onEditorMetaChanged);
  document.getElementById('editorFogDist').addEventListener('input', onEditorMetaChanged);
  document.getElementById('editorNodeCount').addEventListener('input', (event) => setEditorNodeCount(event.target.value));
  document.getElementById('editorBrushAsset').addEventListener('change', (event) => setEditorBrushAsset(event.target.value));
  document.getElementById('editorBrushEnabled').addEventListener('change', (event) => setEditorBrushEnabled(event.target.checked));
  document.getElementById('editorBrushSize').addEventListener('input', (event) => setEditorBrushSize(event.target.value));
  document.getElementById('editorBrushSpacing').addEventListener('input', (event) => setEditorBrushSpacing(event.target.value));
  document.getElementById('editorNodeType').addEventListener('change', onEditorNodeChanged);
  document.getElementById('editorSteepness').addEventListener('input', onEditorNodeChanged);
  document.getElementById('editorNodeGravelPitSize').addEventListener('input', onEditorNodeChanged);
  document.getElementById('editorNodeGravelLeft').addEventListener('input', onEditorNodeChanged);
  document.getElementById('editorNodeGravelRight').addEventListener('input', onEditorNodeChanged);
  document.getElementById('addNodeBtn').addEventListener('click', addEditorNode);
  document.getElementById('insertNodeBtn').addEventListener('click', insertEditorNodeAfter);
  document.getElementById('delNodeBtn').addEventListener('click', deleteEditorNode);
  document.getElementById('reverseDirectionBtn').addEventListener('click', reverseEditorTrack);
  document.getElementById('delAssetBtn').addEventListener('click', deleteSelectedEditorAsset);
  document.getElementById('resetEditorCamBtn').addEventListener('click', resetEditorCamera);
  document.getElementById('saveEditorTrackBtn').addEventListener('click', saveEditorTrack);
  document.getElementById('exportTrackJsonBtn').addEventListener('click', exportTrackAsJSON);
  document.getElementById('resetEditorTrackBtn').addEventListener('click', resetEditorTrack);
  document.getElementById('upgradeTrackGenerationBtn').addEventListener('click', upgradeEditorTrackToLatestGeneration);
}

function bindLeaderboardControls() {
  document.getElementById('closeLeaderboardModalBtn').addEventListener('click', closeTrackLeaderboardModal);
  document.getElementById('leaderboardModal').addEventListener('click', (event) => {
    if (event.target.id === 'leaderboardModal') {
      closeTrackLeaderboardModal();
    }
  });
}

function bindUi() {
  bindKeyboardInput();
  bindPointerInput();
  bindSettingsControls();
  bindMenuButtons();
  bindRaceButtons();
  bindEditorControls();
  bindLeaderboardControls();
}

function applyStoredSettings() {
  setOnlineGhostToggle(readOnlineGhostToggle());
  setOnlineGhostCount(readOnlineGhostCount());
  updateTrainingSelectionUi();
}

function updateVersionLabels() {
  document.querySelectorAll('.menuVersion').forEach((element) => {
    element.textContent = TURBORACING_EXP_VERSION;
  });
}

function bootRenderer() {
  const { renderer, start: startRenderLoop } = createRenderPipeline({
    THREE,
    canvas: gc,
    scene,
    clock,
    cameras: [camChase, camCock, camEditor],
    resizeOverlays: resizeDC,
    frameUpdate: updateGameFrame,
    getActiveCamera: () => state.activeCam,
  });

  state.renderer = renderer;
  startRenderLoop();
}

scene.background = new THREE.Color(0x050510);
setupTouchControls({ pauseRace, resumeRace });
initTouchSettings();
initAudioSettings();
applyStoredSettings();
updateVersionLabels();
bindUi();
bootRenderer();
setupLights();
loadArcadeUser();
showIntro();
