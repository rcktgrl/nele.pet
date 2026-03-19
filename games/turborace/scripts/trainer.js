'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared genome constants
// ─────────────────────────────────────────────────────────────────────────────
export const GENOME_SIZE = 52; // W1(35) + b1(5) + W2(10) + b2(2)

// Flat representation of the hand-designed weights from neural-ai.js.
// Used as the seed genome so generation-0 starts from a driver that can
// already corner, rather than from random noise.
export const DEFAULT_GENOME = [
  // W1: 5 rows × 7 inputs
  -2.0, -3.0, -0.5,  0.5,  0.3,  0.0,  0.0,  // H0 danger-left
   0.3,  0.5, -0.5, -3.0, -2.0,  0.0,  0.0,  // H1 danger-right
   0.0, -0.5, -3.0, -0.5,  0.0,  0.0,  0.0,  // H2 danger-ahead
   0.8,  0.8,  1.5,  0.8,  0.8,  1.5,  0.0,  // H3 open-track
   0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  2.0,  // H4 waypoint-err
  // b1: 5
  1.0, 1.0, 1.5, -4.0, 0.0,
  // W2: 2 rows × 5 inputs
   1.2, -1.2,  0.0,  0.0,  1.5,  // steer
  -0.3, -0.3, -1.5,  1.5,  0.0,  // throttle
  // b2: 2
  0.0, 0.5,
];

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
  car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.hdg;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Genetic Trainer
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = 'turborace_nn_weights';

export class GeneticTrainer {
  constructor({ popSize = 20, genDuration = 35, mutRate = 0.15, mutStrength = 0.35 } = {}) {
    this.popSize = popSize;
    this.genDuration = genDuration;
    this.mutRate = mutRate;
    this.mutStrength = mutStrength;
    this.generation = 0;
    this.genTime = 0;
    this.population = [];
    this.bestGenome = null;
    this.bestFitness = -Infinity;
    this.avgFitness = 0;
    this._peakProg = [];   // max totalProg seen this generation per car
  }

  // Seed from saved genome or hand-designed defaults.
  // Generation 0 has mild perturbations from the seed to explore nearby space.
  initPopulation(seedGenome = null) {
    const seed = seedGenome || DEFAULT_GENOME;
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
    for (let i = 0; i < Math.min(this.population.length, cars.length); i++) {
      const car = cars[i];
      // Off-track cars are disqualified — their fitness is frozen at current value
      if (!car || car._offTrack) continue;
      // Penalise wall hits (large) and gravel (small) by subtracting from progress
      const penalty = car._fitPenalty || 0;
      const adjusted = Math.max(0, car.totalProg - penalty);
      if (adjusted > this._peakProg[i]) this._peakProg[i] = adjusted;
      this.population[i].fitness = this._peakProg[i];
    }
    if (this.genTime >= this.genDuration) {
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

    // All-time best genome always survives as champion (never regresses)
    const championGenome = this.bestGenome ? [...this.bestGenome] : [...elites[0].genome];
    const next = [{ genome: championGenome, fitness: 0 }];
    while (next.length < this.popSize) {
      const p1 = elites[Math.floor(Math.random() * eliteN)].genome;
      const p2 = elites[Math.floor(Math.random() * eliteN)].genome;
      const child = p1.map((w, i) => Math.random() < 0.5 ? w : p2[i]);
      this._mutate(child, this.mutRate, this.mutStrength);
      next.push({ genome: child, fitness: 0 });
    }
    this.population = next;
    this._peakProg = new Array(this.popSize).fill(0);
    this.generation++;
    this.genTime = 0;
  }

  _mutate(genome, rate, strength) {
    for (let i = 0; i < genome.length; i++) {
      if (Math.random() < rate) genome[i] += (Math.random() * 2 - 1) * strength;
    }
  }

  saveToLocalStorage() {
    if (!this.bestGenome) return false;
    localStorage.setItem(LS_KEY, JSON.stringify(this.bestGenome));
    return true;
  }

  exportAsJSON(name = 'neural-driver') {
    if (!this.bestGenome) return false;
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const model = {
      id,
      name,
      version: 1,
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
