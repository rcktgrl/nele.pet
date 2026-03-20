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

/** Genome size for default [20,5,3] architecture. */
export const GENOME_SIZE = computeGenomeSize([20, 5, 3]); // 123

// Hand-designed seed genome for [20,5,3]:
//   11 wall sensors (-90,-60,-30,-10,-5,0,+5,+10,+30,+60,+90)
//   + 3 edge sensors (e-10,e0,e+10) + speed + waypointErr
//   + edgeProximity + gravelFlag + grip + accel
//   → 5 hidden → 3 out (steer, throttle, brake)
export const DEFAULT_GENOME = [
  // W1: 5 rows × 20 inputs  (s-90 s-60 s-30 s-10 s-5 s0 s+5 s+10 s+30 s+60 s+90 e-10 e0 e+10 spd wpt edge grav grip acl)
  -3.0, -2.0, -3.0, -1.5, -1.0, -0.5,  0.0,  0.3,  0.5,  0.3,  0.0, -0.5, -0.3,  0.0,  0.0,  0.0,  0.8,  0.5,  0.0,  0.0,  // H0 danger-left
   0.0,  0.3,  0.5,  0.0,  0.3, -0.5, -1.0, -1.5, -3.0, -2.0, -3.0,  0.0, -0.3, -0.5,  0.0,  0.0,  0.8,  0.5,  0.0,  0.0,  // H1 danger-right
   0.0,  0.0, -0.5, -0.8, -1.5, -3.0, -1.5, -0.8, -0.5,  0.0,  0.0, -1.0, -1.5, -1.0,  0.0,  0.0,  0.5,  0.5,  0.0,  0.0,  // H2 danger-ahead
   0.8,  0.8,  0.8,  0.6,  0.5,  1.5,  0.5,  0.6,  0.8,  0.8,  0.8,  0.5,  0.8,  0.5,  1.5,  0.0, -1.5, -1.0,  0.0,  0.0,  // H3 open-track
   0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  2.0,  0.0,  0.0,  0.0,  0.0,  // H4 waypoint-err
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
 * Uses hand-designed weights for [20,5,3]; Xavier random otherwise.
 */
export function buildDefaultGenome(layers) {
  const key = JSON.stringify(layers);
  if (key === '[20,5,3]') return [...DEFAULT_GENOME];
  return _xavierGenome(layers);
}

/** Generate a fully random Xavier-initialised genome for any architecture. */
function _xavierGenome(layers) {
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
//  Single source of truth: fitness calculation
//  Every consumer (trainer tick, leaderboard, NN viz, best-car selection)
//  MUST use this function — never compute fitness inline elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the live fitness for a single car.
 *   rawProgress  = peak of (totalProg * onTrackBonus) — rewards never decrease
 *   penalty      = car._fitPenalty — always subtracted, always hurts
 *   fitness      = rawProgress - penalty  (+ lap bonus if applicable)
 *
 * @param {object} car     - Car instance with _fitPenalty, _onTrackTime, totalProg, etc.
 * @param {object} config  - { onTrackRewardRate, lapMode, lapBonus, peakRawProg }
 * @returns {number} fitness value
 */
export function computeFitness(car, config = {}) {
  const onTrackRate = config.onTrackRewardRate ?? 0.10;
  const penalty = car._fitPenalty || 0;
  // Raw progress includes on-track bonus but NOT penalties
  const rawProg = car.totalProg * (1 + (car._onTrackTime || 0) * onTrackRate);

  // Use peak raw progress if tracked (prevents fitness dropping when car slows down)
  // but always subtract the CURRENT cumulative penalty (penalties always bite)
  const effectiveRaw = config.peakRawProg !== undefined
    ? Math.max(config.peakRawProg, rawProg)
    : rawProg;

  let fit = effectiveRaw - penalty;

  // Lap mode: bonus for completing a lap (faster = more points)
  if (config.lapMode && car._lapCompleted && car._lapTime > 0) {
    const lapBonus = config.lapBonus ?? 1000;
    fit += lapBonus / car._lapTime;
  }
  return fit;
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
  // Physics state
  car.pos.set(pos.x, pos.y, pos.z);
  car.hdg = hdg;
  car.spd = 0;
  car.gear = 1;
  car.rpm = car.gearbox.idleRpm;

  // Race progress
  car.lap = 0;
  car.lastCP = 0;
  car.cpPassed = 0;
  car.totalProg = 0;
  car.finished = false;
  car.finTime = 0;
  car.lapStart = 0;
  car.lapTimes = [];

  // Driving state
  car.prevGear = 1;
  car.rpmDrop = 0;
  car.stuckTimer = 0;
  car.isReversing = false;
  car.revSpd = 0;
  car.reverseTimer = 0;
  car.onGravel = false;

  // Training-specific fitness tracking (single source of truth)
  car._offTrack = false;
  car._fitPenalty = 0;
  car._trainPrevStuck = 0;
  car._gravelTime = 0;
  car._offTrackTime = 0;
  car._onTrackTime = 0;
  car._lapCompleted = false;
  car._lapTime = 0;
  car._fitness = 0; // live fitness — always computed via computeFitness()

  // Sync mesh
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.hdg;
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
    // Peak of raw progress (progress * onTrackBonus, WITHOUT penalty).
    // Penalties are always subtracted fresh so they always bite.
    this._peakRawProg = [];
    this.pendingEvolve = false;
  }

  // ── Population initialisation ─────────────────────────────────────────────

  /**
   * Seed from saved genome or hand-designed defaults.
   * Generation 0 has mild perturbations from the seed to explore nearby space.
   * Pass forceRandom=true (e.g. from the Reset button) to skip the hand-designed
   * seed and start from fully random Xavier weights instead.
   */
  initPopulation(seedGenome = null, forceRandom = false) {
    // When force-resetting, wipe ALL learned state so we start truly fresh
    if (forceRandom) {
      this.bestGenome = null;
      this.bestFitness = -Infinity;
      this.avgFitness = 0;
    }

    // Determine seed genome
    let seed;
    if (!forceRandom && seedGenome && seedGenome.length === this.genomeSize) {
      seed = seedGenome;
    } else if (!forceRandom) {
      seed = buildDefaultGenome(this.layers);
    } else {
      seed = null; // fully random Xavier init per car
    }

    this.population = Array.from({ length: this.popSize }, (_, i) => {
      let genome;
      if (seed) {
        genome = [...seed];
        // Wider perturbation for gen-0 diversity (skip slot 0: keep an exact seed copy)
        if (i > 0) this._mutate(genome, 0.4, 0.8);
      } else {
        // Fully random Xavier init — each car gets an independent random network
        genome = _xavierGenome(this.layers);
      }
      return { genome, fitness: 0 };
    });
    this._peakRawProg = new Array(this.popSize).fill(0);
    this.generation = 0;
    this.genTime = 0;
  }

  // ── Per-frame tick ────────────────────────────────────────────────────────

  /**
   * Call every physics frame. Updates fitness for all cars in this group.
   * Returns true when a new generation has just been evolved.
   */
  tick(dt, cars) {
    // In elite clone mode, stop updating once this group's generation has ended
    if (this.pendingEvolve) return false;
    this.genTime += dt;

    // Read live mutation params from UI sliders
    if (state) {
      if (Number.isFinite(state.trainMutRate)) this.mutRate = state.trainMutRate;
      if (Number.isFinite(state.trainMutStrength)) this.mutStrength = state.trainMutStrength;
    }

    // ── Update fitness for every car using single source of truth ──
    const lapMode = state && state.trainMode === 'lap';
    const lapBonus = (state && Number.isFinite(state.trainLapBonus)) ? state.trainLapBonus : 1000;
    const onTrackRate = (state && Number.isFinite(state.trainOnTrackRewardRate))
      ? state.trainOnTrackRewardRate : 0.10;

    for (let i = 0; i < Math.min(this.population.length, cars.length); i++) {
      const car = cars[i];
      if (!car || car._offTrack) continue;

      // Track peak of raw progress (progress + onTrackBonus, NO penalty)
      // This prevents fitness from dropping when a car merely slows down,
      // but penalties are always subtracted fresh so they always reduce fitness.
      const rawProg = car.totalProg * (1 + (car._onTrackTime || 0) * onTrackRate);
      if (rawProg > this._peakRawProg[i]) this._peakRawProg[i] = rawProg;

      // Compute fitness via single source of truth
      const fit = computeFitness(car, {
        onTrackRewardRate: onTrackRate,
        lapMode,
        lapBonus,
        peakRawProg: this._peakRawProg[i],
      });

      car._fitness = fit;
      this.population[i].fitness = fit;
    }

    // ── Check generation end ──
    const allDone = lapMode && cars.length > 0 && cars.every(c => c._lapCompleted || c._offTrack);
    if (allDone || this.genTime >= this.genDuration) {
      if (state && state.trainEliteCloneMode) {
        // Signal readiness; game.js coordinates all groups before evolving
        this.pendingEvolve = true;
        return false;
      }
      this._evolve();
      return true;
    }
    return false;
  }

  // ── Standard genetic evolution ────────────────────────────────────────────

  _evolve() {
    // Sort by fitness (best first)
    this.population.sort((a, b) => b.fitness - a.fitness);
    const best = this.population[0];

    // Update all-time best tracking
    if (best.fitness > this.bestFitness) {
      this.bestFitness = best.fitness;
      this.bestGenome = [...best.genome];
    }
    this.avgFitness = this.population.reduce((s, p) => s + p.fitness, 0) / this.population.length;

    // ── Selection: keep top 30% as elite parents ──
    const eliteN = Math.max(2, Math.floor(this.popSize * 0.3));
    const elites = this.population.slice(0, eliteN);

    // Fitness-weighted parent selection (higher fitness → more likely chosen)
    const minFit = elites[elites.length - 1].fitness;
    const eliteWeights = elites.map(p => Math.max(0, p.fitness - minFit) + 1);
    const totalWeight = eliteWeights.reduce((s, w) => s + w, 0);
    const cumWeights = [];
    let cum = 0;
    for (const w of eliteWeights) { cum += w; cumWeights.push(cum); }
    const pickParent = () => {
      const r = Math.random() * totalWeight;
      for (let i = 0; i < cumWeights.length; i++) if (r <= cumWeights[i]) return elites[i];
      return elites[elites.length - 1];
    };

    // ── Build next generation ──
    // Slot 0: all-time champion (unchanged, never regresses)
    // Slot 1: this generation's winner (unchanged, for direct competition)
    const championGenome = this.bestGenome ? [...this.bestGenome] : [...elites[0].genome];
    const genWinnerGenome = [...elites[0].genome];
    const next = [
      { genome: championGenome, fitness: 0 },
      { genome: genWinnerGenome, fitness: 0 },
    ];

    // Remaining slots: crossover + mutation from elite parents
    while (next.length < this.popSize) {
      const p1 = pickParent();
      const p2 = pickParent();
      // Crossover ratio: better parent contributes more genes
      const w1 = Math.max(0, p1.fitness - minFit) + 1;
      const w2 = Math.max(0, p2.fitness - minFit) + 1;
      const p1ratio = w1 / (w1 + w2);
      const child = p1.genome.map((g, i) => Math.random() < p1ratio ? g : p2.genome[i]);
      this._mutate(child, this.mutRate, this.mutStrength);
      next.push({ genome: child, fitness: 0 });
    }

    this.population = next;
    this._peakRawProg = new Array(this.popSize).fill(0);
    this.generation++;
    this.genTime = 0;
  }

  // ── Elite clone evolution (multi-sim synchronised) ────────────────────────
  //
  // Called by game.js after ALL simulation groups have signalled pendingEvolve.
  // Each group receives the global-best genome and creates mutated variants.
  //
  // groupIndex/totalGroups create an exploitation→exploration gradient:
  //   Group 0: low mutation   (fine-tuning near the best)
  //   Last group: high mutation (exploring distant variants + random genomes)
  // This prevents all groups from driving identically.

  evolveEliteClone(bestGenome, groupIndex = 0, totalGroups = 1) {
    // Update fitness tracking for this group's population
    this.population.sort((a, b) => b.fitness - a.fitness);
    const best = this.population[0];
    if (best && best.fitness > this.bestFitness) {
      this.bestFitness = best.fitness;
      this.bestGenome = [...best.genome];
    }
    this.avgFitness = this.population.reduce((s, p) => s + p.fitness, 0) / this.population.length;

    // ── Per-group mutation gradient (exploitation → exploration) ──
    const t = totalGroups > 1 ? groupIndex / (totalGroups - 1) : 0.5;
    const groupMutRate     = this.mutRate     * (0.5 + t * 1.5);   // 0.5× to 2.0× base rate
    const groupMutStrength = this.mutStrength * (0.3 + t * 2.0);   // 0.3× to 2.3× base strength

    // Slot 0: exact copy of global best (champion, no mutation)
    const next = [{ genome: [...bestGenome], fitness: 0 }];

    // Determine how many slots get random Xavier init (exploration groups only)
    const nRandom = t > 0.8 ? Math.max(1, Math.floor(this.popSize * 0.25)) : 0;

    // Fill mutated clones
    while (next.length < this.popSize - nRandom) {
      const child = [...bestGenome];
      this._mutate(child, groupMutRate, groupMutStrength);
      next.push({ genome: child, fitness: 0 });
    }

    // Fill random Xavier genomes for high-exploration groups (fresh genetic material)
    while (next.length < this.popSize) {
      next.push({ genome: _xavierGenome(this.layers), fitness: 0 });
    }

    this.population = next;
    this._peakRawProg = new Array(this.popSize).fill(0);
    this.generation++;
    this.genTime = 0;
    this.pendingEvolve = false;
  }

  // ── Mutation ──────────────────────────────────────────────────────────────

  _mutate(genome, rate, strength) {
    for (let i = 0; i < genome.length; i++) {
      if (Math.random() < rate) genome[i] += (Math.random() * 2 - 1) * strength;
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────────

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
