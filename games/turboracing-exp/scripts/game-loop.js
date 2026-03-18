import { state, raceCamOrbit, keys } from './state.js';
import {
  isTouchControlsVisibleInState,
  touchState,
  getGyroSteering,
  getTouchSliderSteer,
} from './touch-controls.js';
import { updateAudio, aiSounds } from './audio.js';
import { updateCamera, updateEditorPreviewCamera } from './camera.js';
import { updateHUD, drawDash, drawMinimap } from './hud.js';
import { ghostVisuals, sampleGhostFrame, updateGhostReplay, shouldRenderGhostsForState } from './ghost.js';
import { updateResultsUI } from './race.js';
import { editorRebuildScene } from './editor.js';

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function readSteeringInput() {
  const left = keys.ArrowLeft || keys.KeyA || touchState.left;
  const right = keys.ArrowRight || keys.KeyD || touchState.right;
  const keySteer = left && !right ? 1 : right && !left ? -1 : 0;
  const gyroSteer = getGyroSteering();
  const sliderSteer = getTouchSliderSteer();

  if (Math.abs(gyroSteer) > 0.01) return gyroSteer;
  if (Math.abs(sliderSteer) > 0.01) return sliderSteer;
  return keySteer;
}

function readPlayerRaceInput() {
  const autoTouchThrottle =
    isTouchControlsVisibleInState(state.gState) &&
    isTouchDevice() &&
    !touchState.brake;

  return {
    thr: keys.ArrowUp || keys.KeyW || touchState.throttle || autoTouchThrottle ? 1 : 0,
    brk: keys.ArrowDown || keys.KeyS || touchState.brake ? 1 : 0,
    str: readSteeringInput(),
  };
}

function updateAiControllers(dt, { unfinishedOnly = false } = {}) {
  for (const ai of state.aiControllers) {
    if (!unfinishedOnly || !ai.car.finished) {
      ai.update(dt);
    }
  }
}

function updateAiAudio() {
  for (let index = 0; index < aiSounds.length; index += 1) {
    const sound = aiSounds[index];
    const aiCar = state.aiCars[index];
    if (sound && aiCar) {
      sound.update(aiCar, state.pCar);
    }
  }
}

function updateRaceView({ thr, brk, dt, hud = true, dash = true, minimap = true }) {
  updateAudio(thr, brk, dt, state.pCar, keys);
  updateCamera();

  if (hud) updateHUD();
  if (dash) drawDash();
  if (minimap) drawMinimap();
}

function hideGhostTags() {
  for (const visual of ghostVisuals) {
    if (visual.tagEl) {
      visual.tagEl.style.display = 'none';
    }
  }
}

function updateGhostState() {
  if (shouldRenderGhostsForState(state.gState)) {
    updateGhostReplay();
  } else {
    hideGhostTags();
  }
}

function updateRacingState(dt) {
  state.raceTime += dt;
  const playerInput = readPlayerRaceInput();

  state.pCar.update(playerInput, dt);
  sampleGhostFrame();
  updateAiControllers(dt);
  updateAiAudio();
  updateRaceView({ ...playerInput, dt });
  updateGhostState();
}

function updateCooldownState(dt) {
  state.raceTime += dt;
  state.pCar.update({ thr: 0, brk: 0.3, str: 0 }, dt);
  updateAiControllers(dt, { unfinishedOnly: true });
  updateAiAudio();
  updateRaceView({ thr: 0, brk: 0, dt, hud: false, dash: false, minimap: false });
  updateGhostState();

  if (document.getElementById('results').style.display === 'flex') {
    updateResultsUI();
  }
}

function updateEditorState(dt) {
  updateEditorPreviewCamera(dt);

  if (state.gState === 'editor') {
    if (state.editorNeedsRebuild && performance.now() - state.editorLastRebuild > 45) {
      editorRebuildScene(false);
    }
  }
}

function updateFinishedState(dt) {
  state.raceTime += dt;
  updateAiControllers(dt, { unfinishedOnly: true });
  updateHUD();
  drawMinimap();
  updateCamera();
  updateGhostState();
}

function updatePassiveRaceState() {
  updateCamera();
  updateGhostState();
}

export function updateGameFrame(dt) {
  switch (state.gState) {
    case 'racing':
      updateRacingState(dt);
      break;
    case 'cooldown':
      updateCooldownState(dt);
      break;
    case 'editorPreview':
    case 'editor':
      updateEditorState(dt);
      break;
    case 'finished':
      updateFinishedState(dt);
      break;
    case 'countdown':
    case 'paused':
      updatePassiveRaceState();
      break;
    default:
      break;
  }
}

export function updateRaceCameraOrbit(event) {
  const isOrbitState = ['racing', 'cooldown', 'finished', 'countdown'].includes(state.gState);
  if (!isOrbitState || event.buttons !== 2) return;

  raceCamOrbit.yaw -= event.movementX * 0.004;
  raceCamOrbit.pitch = Math.max(-0.55, Math.min(0.75, raceCamOrbit.pitch - event.movementY * 0.003));
  raceCamOrbit.lastInput = performance.now();
}
