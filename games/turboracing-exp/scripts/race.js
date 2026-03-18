'use strict';
import { CARS } from '../data/cars.js';
import { state, scene, dc } from './state.js';
import { buildTrack } from './track-gen.js';
import { instantiateRaceCars } from './car.js';
import { AI } from './ai-script.js';
import { setupLights } from './lighting.js';
import {
  initAudio, initAiSounds, clearAiSounds,
  stopAudio, stopMusic, playBeep,
  playVictoryJingle, playLossSound,
  startMusic, audioReady, announce
} from './audio.js';
import {
  resetCurrentRaceSubmitted, getCurrentTrackLeaderboard, renderResultsLeaderboard,
  handlePostRaceLeaderboard
} from './leaderboard.js';
import { updateTouchControlsVisibility, releaseAllTouchControls, isTouchControlsEnabled } from './touch-controls.js';
import { fmtT } from './utils/format.js';
import { notify } from './notify.js';
import {
  onlineGhostEnabled, ghostVisuals, clearGhostVisual,
  setupGhostReplayFromTrack, startGhostRecording,
  finalizeGhostRecording
} from './ghost.js';
import { getTrackById, getAllTracks, loadTracksFromFolder, loadEditorTracks } from './editor.js';
import { createTrainingManager, mergeConfig, parseTrainingJson } from './train-ai.js';

function trainingContext() {
  return {
    trackPoints: state.trkPts,
    trackCurvature: state.trkCurv,
    cityAiPoints: state.cityAiPts,
    corridors: state.cityCorridors,
    cityCorridors: state.cityCorridors,
    trackData: state.trkData,
    playerCar: state.pCar,
  };
}

function getTrainingUiElements() {
  return {
    modal: document.getElementById('trainAiModal'),
    status: document.getElementById('trainAiStatus'),
    exportArea: document.getElementById('trainAiJson'),
    generation: document.getElementById('trainAiGeneration'),
    episode: document.getElementById('trainAiEpisode'),
  };
}

function updateTrainingStatus(message = '') {
  const ui = getTrainingUiElements();
  if (ui.status) ui.status.textContent = message;
  if (ui.generation) ui.generation.textContent = String(state.training.generation || 0);
  if (ui.episode) ui.episode.textContent = String(state.training.episode || 0);
  state.training.status = message;
}

function readCheckedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function normaliseTrainingConfig(raw = {}) {
  return mergeConfig({
    nodeLookahead: +raw.nodeLookahead,
    populationSize: +raw.populationSize,
    maxSimulationTime: +raw.maxSimulationTime,
    hiddenLayers: +raw.hiddenLayers,
    neuronsPerLayer: +raw.neuronsPerLayer,
    mutationRate: +raw.mutationRate,
    mutationStrength: +raw.mutationStrength,
    eliteCount: +raw.eliteCount,
    rewards: {
      progress: +raw.rewardProgress,
      speed: +raw.rewardSpeed,
      finish: +raw.rewardFinish,
      survival: +raw.rewardSurvival,
      gravelPenalty: +raw.rewardGravelPenalty,
      wallPenalty: +raw.rewardWallPenalty,
      steeringPenalty: +raw.rewardSteeringPenalty,
    },
  });
}

function getTrainingSelection() {
  const visible = !!document.getElementById('trainAiVisible')?.checked;
  const selectedTrackIds = readCheckedValues('train-track');
  const selectedCarIds = readCheckedValues('train-car').map((value) => Number(value));
  const config = normaliseTrainingConfig(Object.fromEntries(new FormData(document.getElementById('trainAiForm')).entries()));
  return { visible, selectedTrackIds, selectedCarIds, config };
}

function ensureTrainingManager(config) {
  if (!state.training.controller) state.training.controller = createTrainingManager(config);
  state.training.controller.config = mergeConfig(config);
  state.training.config = mergeConfig(config);
  return state.training.controller;
}

function chooseTrainingTrack() {
  const selected = state.training.selectedTrackIds.length ? state.training.selectedTrackIds : getAllTracks().map((track) => String(track.id));
  if (!selected.length) return getTrackById(state.selTrk);
  const nextIndex = state.training.episode % selected.length;
  return getTrackById(selected[nextIndex]);
}

function chooseTrainingCarIndex() {
  const selected = state.training.selectedCarIds.length ? state.training.selectedCarIds : CARS.map((car) => car.id);
  if (!selected.length) return 0;
  return selected[state.training.episode % selected.length];
}

export async function openTrainingModal() {
  loadEditorTracks();
  await loadTracksFromFolder().catch(() => {});
  const ui = getTrainingUiElements();
  if (!ui.modal) return;
  ui.modal.style.display = 'flex';
  updateTrainingSelectionUi();
  updateTrainingStatus(state.training.status || 'Train-AI bereit.');
}

export function closeTrainingModal() {
  const ui = getTrainingUiElements();
  if (ui.modal) ui.modal.style.display = 'none';
}

export function updateTrainingSelectionUi() {
  const trackWrap = document.getElementById('trainTrackList');
  const carWrap = document.getElementById('trainCarList');
  if (trackWrap) {
    const tracks = getAllTracks();
    trackWrap.innerHTML = tracks.map((track, index) => `<label class="trainAiPick"><input type="checkbox" name="train-track" value="${track.id}" ${index < Math.min(3, tracks.length) ? 'checked' : ''}> <span>${track.name}</span></label>`).join('');
  }
  if (carWrap) {
    carWrap.innerHTML = CARS.map((car) => `<label class="trainAiPick"><input type="checkbox" name="train-car" value="${car.id}" ${car.id < 2 ? 'checked' : ''}> <span>${car.name}</span></label>`).join('');
  }
  if (state.training.controller) {
    const ui = getTrainingUiElements();
    if (ui.exportArea && !ui.exportArea.value.trim()) ui.exportArea.value = state.training.controller.exportJSON();
  }
}

function applyTrainingCars(selection) {
  state.raceMode = 'training';
  state.training.running = true;
  state.training.visible = selection.visible;
  state.training.selectedTrackIds = selection.selectedTrackIds;
  state.training.selectedCarIds = selection.selectedCarIds;
  const manager = ensureTrainingManager(selection.config);
  const track = chooseTrainingTrack();
  state.selTrk = track?.id ?? state.selTrk;
  state.selCar = chooseTrainingCarIndex();
  if (selection.visible) {
    startRace({ mode: 'training' });
  } else {
    void initRace({ mode: 'training' });
  }
  const ui = getTrainingUiElements();
  if (ui.exportArea) ui.exportArea.value = manager.exportJSON();
}

export function startTrainingFromUi() {
  const selection = getTrainingSelection();
  closeTrainingModal();
  applyTrainingCars(selection);
}

export function importTrainingJsonFromUi() {
  const ui = getTrainingUiElements();
  if (!ui.exportArea) return;
  const manager = ensureTrainingManager(normaliseTrainingConfig({}));
  try {
    manager.importJSON(parseTrainingJson(ui.exportArea.value));
    manager.saveToStorage();
    updateTrainingStatus('Train-AI JSON importiert.');
  } catch (error) {
    updateTrainingStatus(`Import fehlgeschlagen: ${error.message}`);
  }
}

export function exportTrainingJsonToUi() {
  const ui = getTrainingUiElements();
  const manager = ensureTrainingManager(normaliseTrainingConfig({}));
  if (ui.exportArea) ui.exportArea.value = manager.exportJSON();
  manager.saveToStorage();
  updateTrainingStatus('Train-AI JSON exportiert.');
}

export async function initRace(options = {}) {
  const mode = options.mode || state.raceMode || 'race';
  const trainingMode = mode === 'training';
  state.raceMode = mode;

  for (const c of state.allCars) scene.remove(c.mesh);
  state.allCars = []; state.aiCars = []; state.aiControllers = []; state.pCar = null;
  clearAiSounds();
  clearGhostVisual();

  if (trainingMode) {
    const track = chooseTrainingTrack();
    state.trkData = track;
    state.selTrk = track?.id ?? state.selTrk;
  } else {
    state.trkData = getTrackById(state.selTrk);
  }
  try { buildTrack(state.trkData); } catch (e) { console.error('buildTrack error:', e); }
  setupLights();

  const corridors = state.cityCorridors;
  const ghostModeEnabled = !trainingMode && onlineGhostEnabled;
  const trainingConfig = state.training.config || mergeConfig({});
  const aiCount = trainingMode ? trainingConfig.populationSize : 4;
  const playerControlled = !trainingMode;
  const manager = trainingMode ? ensureTrainingManager(trainingConfig) : null;

  const raceCars = instantiateRaceCars({
    trackPoints: state.trkPts,
    cars: CARS,
    selectedCarIndex: trainingMode ? chooseTrainingCarIndex() : state.selCar,
    aiCount: ghostModeEnabled ? 0 : aiCount,
    playerControlled,
    scene,
    createAIController: (aiCar, i) => {
      if (trainingMode) {
        const inputSize = 3 + trainingConfig.nodeLookahead * 3 + 2 + 2 + 1 + 1;
        return new AI(aiCar, .044 + i * .010, trainingContext, {
          config: trainingConfig,
          genome: manager.getGenomeAt(i, inputSize),
          aggression: 1,
        });
      }
      return new AI(aiCar, .044 + i * .010, trainingContext, { aggression: .86 + i * .04 });
    }
  });
  state.pCar = playerControlled ? raceCars.playerCar : raceCars.aiCars[0] || null;
  state.aiCars = trainingMode ? raceCars.aiCars : raceCars.aiCars;
  state.aiControllers = raceCars.aiControllers;
  state.allCars = playerControlled ? raceCars.allCars : raceCars.aiCars;
  if (!trainingMode) await setupGhostReplayFromTrack(state.trkData && state.trkData.id);

  state.raceTime = 0; state.gState = 'countdown';
  resetCurrentRaceSubmitted();
  document.getElementById('hud').style.display = trainingMode && !state.training.visible ? 'none' : 'block';
  document.getElementById('hint').style.display = isTouchControlsEnabled() && !trainingMode ? 'none' : 'block';
  updateTouchControlsVisibility(state.gState);
  document.getElementById('camLabel').textContent = '[ C ] COCKPIT VIEW';
  state.camMode = 'chase'; dc.style.display = 'none';
  document.getElementById('speedBox').style.display = 'block';
  document.getElementById('gearBox').style.display = 'block';
  if (!trainingMode) startGhostRecording();
  if (ghostModeEnabled && ghostVisuals.length === 0) notify('Ghost mode enabled: no matching ghost data for this track yet.');
  if (trainingMode && !state.training.visible) {
    state.gState = 'training';
    updateTrainingStatus(`Generation ${state.training.generation || 1} · Episode ${state.training.episode + 1} · ${state.trkData?.name || 'Track'}`);
  } else {
    doCountdown();
  }
}

export function doCountdown() {
  stopMusic();
  initAudio();
  if (audioReady) {
    initAiSounds(state.aiCars.length);
  }
  const el = document.getElementById('cd');
  el.style.display = 'block';
  let c = 3; el.textContent = c;
  announce('3');
  playBeep(440, .18, .25, 'square');
  const iv = setInterval(() => {
    c--;
    if (c > 0) {
      el.textContent = c; playBeep(440, .18, .25, 'square'); announce(String(c));
    } else {
      el.textContent = 'GO!'; playBeep(880, .45, .4, 'square'); announce('Go go go!');
      clearInterval(iv);
      setTimeout(() => {
        el.style.display = 'none';
        state.gState = state.raceMode === 'training' ? 'training' : 'racing';
        updateTouchControlsVisibility(state.gState);
        startMusic();
      }, 700);
    }
  }, 1000);
}

let _prePauseState = 'racing';
export function pauseRace() {
  _prePauseState = state.gState;
  state.gState = 'paused'; stopAudio(); stopMusic();
  document.getElementById('pauseMenu').style.display = 'flex';
  updateTouchControlsVisibility(state.gState);
  releaseAllTouchControls();
}

export function resumeRace() {
  state.gState = _prePauseState === 'cooldown' ? 'cooldown' : (state.raceMode === 'training' ? 'training' : 'racing');
  document.getElementById('pauseMenu').style.display = 'none';
  document.getElementById('settingsModal').style.display = 'none';
  updateTouchControlsVisibility(state.gState);
  initAudio(); startMusic();
}

function finishTrainingGeneration() {
  const manager = ensureTrainingManager(state.training.config || mergeConfig({}));
  const winner = manager.evaluate(state.aiControllers);
  state.training.generation = manager.generation;
  state.training.episode += 1;
  state.training.bestGenome = winner;
  manager.saveToStorage();
  const ui = getTrainingUiElements();
  if (ui.exportArea) ui.exportArea.value = manager.exportJSON();
  updateTrainingStatus(`Gen ${state.training.generation} fertig · Best Fitness ${winner ? winner.fitness.toFixed(2) : '0.00'} · ${state.trkData?.name || 'Track'}`);
  if (state.training.running) {
    void initRace({ mode: 'training' });
  }
}

export async function endRace() {
  if (state.raceMode === 'training') {
    finishTrainingGeneration();
    return;
  }
  const all = [state.pCar, ...state.aiCars].sort((a, b) => {
    if (a.finished && b.finished) return a.finTime - b.finTime;
    if (a.finished) return -1; if (b.finished) return 1; return b.totalProg - a.totalProg;
  });
  const pos = all.indexOf(state.pCar) + 1;
  state.gState = 'cooldown';
  if (pos === 1) {
    playVictoryJingle();
    announce('Checkered flag! You win!');
  } else {
    playLossSound();
    announce(`Race finished! P${pos}!`);
  }
  const ghostPayload = await finalizeGhostRecording();
  setTimeout(() => showResults(ghostPayload), 1200);
}
globalThis.endRace = endRace;

export function showResults(ghostPayload) {
  updateResultsUI();
  handlePostRaceLeaderboard(notify, ghostPayload);
  document.getElementById('results').style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('touchControls').style.display = 'none';
  for (const visual of ghostVisuals) {
    if (visual.tagEl) visual.tagEl.style.display = 'none';
  }
  releaseAllTouchControls();
  dc.style.display = 'none';
}

export function updateResultsUI() {
  const pool = state.raceMode === 'training' ? state.aiCars : [state.pCar, ...state.aiCars];
  const player = state.pCar || state.aiCars[0];
  const all = pool.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finTime - b.finTime;
    if (a.finished) return -1; if (b.finished) return 1; return b.totalProg - a.totalProg;
  });
  const win = all[0] === player;
  document.getElementById('rTitle').textContent = win ? '🏆 VICTORY!' : 'RACE OVER';
  document.getElementById('rTitle').style.color = win ? '#ffd700' : '#ff5500';
  const pods = document.getElementById('podium'); pods.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉', '4th', '5th'];
  for (let i = 0; i < Math.min(5, all.length); i++) {
    const car = all[i], ip = car === player;
    const d = document.createElement('div'); d.className = 'pi';
    d.innerHTML = `<div class="pm">${medals[i]}</div>
      <div class="pn" style="color:${ip ? '#ffd700' : '#aaa'}">${ip ? '⭐ YOU' : car.data.name}</div>
      <div class="pt">${car.finished ? fmtT(car.finTime) : 'racing...'}</div>`;
    pods.appendChild(d);
  }
  const pp = all.indexOf(player) + 1;
  document.getElementById('ptime').textContent = `Your time: ${fmtT(player.finTime || state.raceTime)}  ·  P${pp}`;
  const carName = (player && player.data && player.data.name) ? player.data.name : 'Unknown';
  document.getElementById('runCar').textContent = `Run car: ${carName}`;
  const cached = getCurrentTrackLeaderboard();
  renderResultsLeaderboard(cached.entries);
}

export function startRace(options = {}) {
  document.querySelectorAll('.screen,#results').forEach(s => s.style.display = 'none');
  void initRace(options);
}

export function restartRace() {
  document.getElementById('pauseMenu').style.display = 'none';
  document.getElementById('settingsModal').style.display = 'none';
  releaseAllTouchControls();
  document.getElementById('results').style.display = 'none';
  void initRace({ mode: state.raceMode });
}

export function stopTraining() {
  state.training.running = false;
  state.raceMode = 'race';
}
