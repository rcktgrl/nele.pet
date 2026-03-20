'use strict';
import { state } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared genome constants
// ─────────────────────────────────────────────────────────────────────────────
/** Total scalar parameters for a given layer spec (e.g. [9,5,2]). */
export function computeGenomeSize(layers) {
  let s = 0;
  for (let i = 0; i < layers.length - 1; i++) s += layers[i + 1] * (layers[i] + 1);
  return s;
}

/** Genome size for default [17,5,3] architecture. */
export const GENOME_SIZE = computeGenomeSize([17, 5, 3]); // 108

// Hand-designed seed genome for [17,5,3]:
//   11 wall sensors (-90,-60,-30,-10,-5,0,+5,+10,+30,+60,+90) + speed + waypointErr + edgeProximity + gravelFlag + grip + accel
//   → 5 hidden → 3 out (steer, throttle, brake)
export const DEFAULT_GENOME = [
  // W1: 5 rows × 17 inputs  (s-90 s-60 s-30 s-10 s-5 s0 s+5 s+10 s+30 s+60 s+90 spd wpt edge grav grip acl)
  -3.0, -2.0, -3.0, -1.5, -1.0, -0.5,  0.0,  0.3,  0.5,  0.3,  0.0,  0.0,  0.0,  0.8,  0.5,  0.0,  0.0,  // H0 danger-left
   0.0,  0.3,  0.5,  0.0,  0.3, -0.5, -1.0, -1.5, -3.0, -2.0, -3.0,  0.0,  0.0,  0.8,  0.5,  0.0,  0.0,  // H1 danger-right
   0.0,  0.0, -0.5, -0.8, -1.5, -3.0, -1.5, -0.8, -0.5,  0.0,  0.0,  0.0,  0.0,  0.5,  0.5,  0.0,  0.0,  // H2 danger-ahead
   0.8,  0.8,  0.8,  0.6,  0.5,  1.5,  0.5,  0.6,  0.8,  0.8,  0.8,  1.5,  0.0, -1.5, -1.0,  0.0,  0.0,  // H3 open-track
   0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  2.0,  0.0,  0.0,  0.0,  0.0,  // H4 waypoint-err
  // b1: 5
  1.0, 1.0, 1.5, -4.0, 0.0,
  // W2: 3 rows × 5
   1.2, -1.2,  0.0,  0.0,  1.5,  // steer
  -0.3, -0.3, -1.5,  1.5,  0.0,  // throttle
  -0.5, -0.5, -2.0, -0.5,  0.0,  // brake
  // b2: 3
  0.0, 0.5, -1.5,
];

/**
 * Build a seed genome for the given architecture.
 * Uses hand-designed weights for known architectures; Xavier random otherwise.
 */
export function buildDefaultGenome(layers) {
  const key = JSON.stringify(layers);
  if (key === '[17,5,3]') return [...DEFAULT_GENOME];
  // Xavier random init for other architectures
  const genome = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const nIn = layers[l], nOut = layers[l + 1];
    const std = Math.sqrt(2 / (nIn + nOut));
    for (let j = 0; j < nOut * nIn; j++) genome.push((Math.random() * 2 - 1) * std);
    for (let j = 0; j < nOut; j++) genome.push(0);
  }
  return genome;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Grid builder — places N cars in rows of 4 behind the track start line
// ─────────────────────────────────────────────────────────────────────────────
export function buildTrainingGrid(trackPoints, count) {
  const n = trackPoints.length;
  if (!n) return Array(count).fill({ pos: { x: 0, y: 0, z: 0 }, hdg: 0 });
  const COLS = 4, COL_GAP = 3.5, ROW_STEP = 8;
  const grid = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / COLS), col = i % COLS;
    const colOff = (col - (COLS - 1) / 2) * COL_GAP;
    const idx = ((n - row * ROW_STEP) % n + n) % n;
    const pt = trackPoints[idx], ptF = trackPoints[(idx + 5) % n];
    const hdg = Math.atan2(ptF.x - pt.x, ptF.z - pt.z);
    const rx = Math.cos(hdg), rz = -Math.sin(hdg);
    grid.push({ pos: { x: pt.x + rx * colOff, y: pt.y, z: pt.z + rz * colOff }, hdg });
  }
  return grid;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Car reset — called at the start of every generation
// ─────────────────────────────────────────────────────────────────────────────
export function resetCarForTraining(car, pos, hdg) {
  car.pos.set(pos.x, pos.y, pos.z);
  car.hdg = hdg; car.spd = 0; car.gear = 1;
  car.rpm = car.gearbox.idleRpm;
  car.lap = 0; car.lastCP = 0; car.cpPassed = 0;
  car.totalProg = 0; car.finished = false; car.finTime = 0; car.lapStart = 0;
  car.lapTimes = []; car.prevGear = 1; car.rpmDrop = 0; car.stuckTimer = 0;
  car.isReversing = false; car.revSpd = 0; car.reverseTimer = 0; car.onGravel = false;
  car._offTrack = false;
  car._fitPenalty = 0;
  car._trainPrevStuck = 0;
  car._gravelTime = 0;
  car._offTrackTime = 0;
  car._onTrackTime = 0;
  car._lapCompleted = false;
  car._lapTime = 0;
  car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.hdg;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Genetic Trainer
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = 'turborace_nn_weights';

export class GeneticTrainer {
  constructor({ popSize = 20, genDuration = 35, mutRate = 0.15, mutStrength = 0.35, layers = [13, 5, 3] } = {}) {
    this.popSize = popSize;
    this.genDuration = genDuration;
    this.mutRate = mutRate;
    this.mutStrength = mutStrength;
    this.layers = layers;
    this.genomeSize = computeGenomeSize(layers);
    this.generation = 0;
    this.genTime = 0;
    this.population = [];
    this.bestGenome = null;
    this.bestFitness = -Infinity;
    this.avgFitness = 0;
    this._peakProg = [];
    this.pendingEvolve = false; // set to true in elite-clone mode when timer expires
  }

  // Seed from saved genome or hand-designed defaults.
  // Generation 0 has mild perturbations from the seed to explore nearby space.
  initPopulation(seedGenome = null) {
    const seed = (seedGenome && seedGenome.length === this.genomeSize)
      ? seedGenome
      : buildDefaultGenome(this.layers);
    this.population = Array.from({ length: this.popSize }, (_, i) => {
      const genome = [...seed];
      if (i > 0) this._mutate(genome, 0.4, 0.8); // wider spread for diversity
      return { genome, fitness: 0 };
    });
    this._peakProg = new Array(this.popSize).fill(0);
    this.generation = 0;
    this.genTime = 0;
  }

  // Call every frame. Returns true when a new generation has just been evolved.
  tick(dt, cars) {
    this.genTime += dt;
    // Read configurable mutation params from state if available
    if (typeof state !== 'undefined' && state) {
      if (Number.isFinite(state.trainMutRate)) this.mutRate = state.trainMutRate;
      if (Number.isFinite(state.trainMutStrength)) this.mutStrength = state.trainMutStrength;
    }
    const lapMode = typeof state !== 'undefined' && state && state.trainMode === 'lap';
    const lapBonus = (typeof state !== 'undefined' && Number.isFinite(state.trainLapBonus)) ? state.trainLapBonus : 1000;
    for (let i = 0; i < Math.min(this.population.length, cars.length); i++) {
      const car = cars[i];
      // Off-track cars are disqualified — their fitness is frozen at current value
      if (!car || car._offTrack) continue;
      if (lapMode) {
        const onTrackRate = (typeof state !== 'undefined' && Number.isFinite(state.trainOnTrackRewardRate))
          ? state.trainOnTrackRewardRate : 0.10;
        const onTrackBonus = (car._onTrackTime || 0) * onTrackRate;
        const penalty = car._fitPenalty || 0;
        const baseFit = car.totalProg * (1 + onTrackBonus) - penalty;
        if (car._lapCompleted && car._lapTime > 0) {
          // Lap completed: checkpoint progress fitness + lap speed bonus (faster = more points)
          const lapFit = baseFit + lapBonus / car._lapTime;
          if (lapFit > this._peakProg[i]) this._peakProg[i] = lapFit;
        } else {
          // Not yet finished: same checkpoint rewards as timed mode so cars drive in the right direction
          if (baseFit > this._peakProg[i]) this._peakProg[i] = baseFit;
        }
        this.population[i].fitness = this._peakProg[i];
      } else {
        // Timed mode: penalise wall hits and gravel by subtracting from progress
        const penalty = car._fitPenalty || 0;
        const onTrackRate = (typeof state !== 'undefined' && Number.isFinite(state.trainOnTrackRewardRate))
          ? state.trainOnTrackRewardRate : 0.10;
        const onTrackBonus = (car._onTrackTime || 0) * onTrackRate;
        const adjusted = car.totalProg * (1 + onTrackBonus) - penalty;
        if (adjusted > this._peakProg[i]) this._peakProg[i] = adjusted;
        this.population[i].fitness = this._peakProg[i];
      }
    }
    // In lap mode, also end generation early if all cars have finished or been disqualified
    const allDone = lapMode && cars.length > 0 && cars.every(c => c._lapCompleted || c._offTrack);
    if (allDone || this.genTime >= this.genDuration) {
      const eliteClone = typeof state !== 'undefined' && state && state.trainEliteCloneMode;
      if (eliteClone) {
        // Signal readiness; game.js coordinates all groups before evolving
        this.pendingEvolve = true;
        return false;
      }
      this._evolve();
      return true;
    }
    return false;
  }

  _evolve() {
    this.population.sort((a, b) => b.fitness - a.fitness);
    const best = this.population[0];
    if (best.fitness > this.bestFitness) {
      this.bestFitness = best.fitness;
      this.bestGenome = [...best.genome];
    }
    this.avgFitness = this.population.reduce((s, p) => s + p.fitness, 0) / this.population.length;

    const eliteN = Math.max(2, Math.floor(this.popSize * 0.3));
    const elites = this.population.slice(0, eliteN);

    // Build fitness weights for elites so higher-scoring individuals
    // are more likely to be selected as parents and contribute more genes
    const minFit = elites[elites.length - 1].fitness;
    const eliteWeights = elites.map(p => Math.max(0, p.fitness - minFit) + 1);
    const totalWeight = eliteWeights.reduce((s, w) => s + w, 0);
    const cumWeights = [];
    let cum = 0;
    for (const w of eliteWeights) { cum += w; cumWeights.push(cum); }
    const weightedPickElite = () => {
      const r = Math.random() * totalWeight;
      for (let i = 0; i < cumWeights.length; i++) if (r <= cumWeights[i]) return elites[i];
      return elites[elites.length - 1];
    };

    // All-time best genome always survives as champion (never regresses)
    const championGenome = this.bestGenome ? [...this.bestGenome] : [...elites[0].genome];
    // Current generation's winner also survives unchanged for direct competition
    const genWinnerGenome = [...elites[0].genome];
    const next = [
      { genome: championGenome, fitness: 0 },
      { genome: genWinnerGenome, fitness: 0 },
    ];
    while (next.length < this.popSize) {
      const parent1 = weightedPickElite();
      const parent2 = weightedPickElite();
      // Crossover ratio proportional to fitness: better parent contributes more genes
      const w1 = Math.max(0, parent1.fitness - minFit) + 1;
      const w2 = Math.max(0, parent2.fitness - minFit) + 1;
      const p1ratio = w1 / (w1 + w2);
      const child = parent1.genome.map((g, i) => Math.random() < p1ratio ? g : parent2.genome[i]);
      this._mutate(child, this.mutRate, this.mutStrength);
      next.push({ genome: child, fitness: 0 });
    }
    this.population = next;
    this._peakProg = new Array(this.popSize).fill(0);
    this.generation++;
    this.genTime = 0;
  }

  // Elite clone evolution: fill population with mutated copies of a single best genome.
  // Called by game.js after all simulation groups have signalled pendingEvolve.
  evolveEliteClone(bestGenome) {
    // Update fitness tracking for this group's population
    this.population.sort((a, b) => b.fitness - a.fitness);
    const best = this.population[0];
    if (best && best.fitness > this.bestFitness) {
      this.bestFitness = best.fitness;
      this.bestGenome = [...best.genome];
    }
    this.avgFitness = this.population.reduce((s, p) => s + p.fitness, 0) / this.population.length;

    // First slot: exact copy of global best (preserved champion, no mutation)
    const next = [{ genome: [...bestGenome], fitness: 0 }];
    // All remaining slots: copies of global best with mutations
    while (next.length < this.popSize) {
      const child = [...bestGenome];
      this._mutate(child, this.mutRate, this.mutStrength);
      next.push({ genome: child, fitness: 0 });
    }
    this.population = next;
    this._peakProg = new Array(this.popSize).fill(0);
    this.generation++;
    this.genTime = 0;
    this.pendingEvolve = false;
  }

  _mutate(genome, rate, strength) {
    for (let i = 0; i < genome.length; i++) {
      if (Math.random() < rate) genome[i] += (Math.random() * 2 - 1) * strength;
    }
  }

  saveToLocalStorage() {
    if (!this.bestGenome) return false;
    localStorage.setItem(LS_KEY, JSON.stringify(this.bestGenome));
    localStorage.setItem('turborace_nn_layers', JSON.stringify(this.layers));
    return true;
  }

  exportAsJSON(name = 'neural-driver') {
    if (!this.bestGenome) return false;
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const model = {
      id,
      name,
      version: 1,
      layers: this.layers,
      genome: this.bestGenome,
      fitness: this.bestFitness,
      generation: this.generation,
    };
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = id + '.json'; a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  static loadFromLocalStorage() {
    const s = localStorage.getItem(LS_KEY);
    return s ? JSON.parse(s) : null;
  }

  static clearSaved() { localStorage.removeItem(LS_KEY); }
}
