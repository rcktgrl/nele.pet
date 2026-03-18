const TRAINING_STORAGE_KEY = 'turboracing_exp_train_ai_genome';
let nextWorkerControllerId = 1;
const DEFAULT_CONFIG = {
  nodeLookahead: 3,
  populationSize: 24,
  maxSimulationTime: 45,
  hiddenLayers: 2,
  neuronsPerLayer: 12,
  mutationRate: 0.14,
  mutationStrength: 0.22,
  eliteCount: 4,
  tickRate: 1,
  jokerCarrySimulations: 3,
  rewards: {
    progress: 18,
    speed: 0.06,
    finish: 140,
    survival: 0.7,
    gravelPenalty: 1.2,
    wallPenalty: 3.4,
    steeringPenalty: 0.05,
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randRange(amount) {
  return (Math.random() * 2 - 1) * amount;
}

function sigmoid(value) {
  return Math.tanh(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeConfig(config = {}) {
  const merged = deepClone(DEFAULT_CONFIG);
  Object.assign(merged, config || {});
  merged.rewards = { ...DEFAULT_CONFIG.rewards, ...(config.rewards || {}) };
  merged.nodeLookahead = clamp(Math.round(merged.nodeLookahead || 3), 1, 8);
  merged.populationSize = clamp(Math.round(merged.populationSize || 24), 1, 200);
  merged.maxSimulationTime = clamp(+merged.maxSimulationTime || 45, 5, 600);
  merged.hiddenLayers = clamp(Math.round(merged.hiddenLayers || 2), 1, 6);
  merged.neuronsPerLayer = clamp(Math.round(merged.neuronsPerLayer || 12), 2, 64);
  merged.mutationRate = clamp(+merged.mutationRate || 0.14, 0.001, 1);
  merged.mutationStrength = clamp(+merged.mutationStrength || 0.22, 0.001, 3);
  merged.eliteCount = clamp(Math.round(merged.eliteCount || 4), 1, merged.populationSize);
  merged.tickRate = clamp(+merged.tickRate || 1, 0.25, 12);
  merged.jokerCarrySimulations = clamp(Math.round(merged.jokerCarrySimulations ?? 3), 0, 20);
  return merged;
}

function randomWeight() {
  return randRange(1);
}

function createLayer(inputSize, outputSize) {
  return {
    weights: Array.from({ length: outputSize }, () => Array.from({ length: inputSize }, randomWeight)),
    biases: Array.from({ length: outputSize }, randomWeight),
  };
}

function createGenome(config, inputSize, outputSize = 3) {
  const layers = [];
  let currentInput = inputSize;
  for (let index = 0; index < config.hiddenLayers; index += 1) {
    layers.push(createLayer(currentInput, config.neuronsPerLayer));
    currentInput = config.neuronsPerLayer;
  }
  layers.push(createLayer(currentInput, outputSize));
  return { layers, meta: { createdAt: new Date().toISOString(), inputSize, outputSize } };
}

function cloneGenome(genome) {
  return deepClone(genome);
}

function mutateGenome(genome, config) {
  const next = cloneGenome(genome);
  next.layers.forEach((layer) => {
    layer.weights.forEach((row) => {
      for (let index = 0; index < row.length; index += 1) {
        if (Math.random() < config.mutationRate) row[index] += randRange(config.mutationStrength);
      }
    });
    for (let index = 0; index < layer.biases.length; index += 1) {
      if (Math.random() < config.mutationRate) layer.biases[index] += randRange(config.mutationStrength);
    }
  });
  next.meta.updatedAt = new Date().toISOString();
  return next;
}

function crossoverGenome(a, b) {
  const out = cloneGenome(a);
  out.layers.forEach((layer, layerIndex) => {
    const otherLayer = b.layers[layerIndex];
    layer.weights.forEach((row, rowIndex) => {
      row.forEach((_, weightIndex) => {
        if (Math.random() < 0.5) row[weightIndex] = otherLayer.weights[rowIndex][weightIndex];
      });
    });
    layer.biases.forEach((_, biasIndex) => {
      if (Math.random() < 0.5) layer.biases[biasIndex] = otherLayer.biases[biasIndex];
    });
  });
  out.meta.updatedAt = new Date().toISOString();
  return out;
}


function genomeDeterministicSeed(genome) {
  let hash = 2166136261;
  for (const layer of genome?.layers || []) {
    for (const row of layer.weights || []) {
      for (const weight of row || []) {
        const value = Math.round((Number(weight) || 0) * 1000);
        hash ^= value & 0xffffffff;
        hash = Math.imul(hash, 16777619);
      }
    }
    for (const bias of layer.biases || []) {
      const value = Math.round((Number(bias) || 0) * 1000);
      hash ^= value & 0xffffffff;
      hash = Math.imul(hash, 16777619);
    }
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function forwardPass(genome, inputs) {
  let activations = inputs;
  genome.layers.forEach((layer) => {
    activations = layer.weights.map((row, outputIndex) => {
      let sum = layer.biases[outputIndex];
      for (let inputIndex = 0; inputIndex < row.length; inputIndex += 1) sum += row[inputIndex] * activations[inputIndex];
      return sigmoid(sum);
    });
  });
  return activations;
}

function rotateRelative(dx, dz, heading) {
  const sin = Math.sin(-heading);
  const cos = Math.cos(-heading);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

function computeClearance(car, trackData, cityCorridors) {
  if (cityCorridors?.length) {
    for (const corridor of cityCorridors) {
      if (car.pos.x > corridor.x - corridor.hw && car.pos.x < corridor.x + corridor.hw && car.pos.z > corridor.z - corridor.hd && car.pos.z < corridor.z + corridor.hd) {
        return {
          left: corridor.x + corridor.hw - car.pos.x,
          right: car.pos.x - (corridor.x - corridor.hw),
        };
      }
    }
  }
  const width = trackData?.rw || 12;
  return { left: width * 0.5, right: width * 0.5 };
}

function wrapAngle(angle) {
  return ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function getNodeBundle(car, context, lookahead) {
  const navPts = context.cityAiPoints ? context.cityAiPoints.pts : context.trackPoints;
  const curv = context.cityAiPoints ? context.cityAiPoints.curv : context.trackCurvature;
  if (!navPts?.length) return [];
  let closestIndex = 0;
  let minDistance = Infinity;
  for (let index = 0; index < navPts.length; index += 1) {
    const point = navPts[index];
    const d = (car.pos.x - point.x) ** 2 + (car.pos.z - point.z) ** 2;
    if (d < minDistance) {
      minDistance = d;
      closestIndex = index;
    }
  }
  const points = [];
  let reference = { x: car.pos.x, z: car.pos.z };
  for (let step = 1; step <= lookahead; step += 1) {
    const point = navPts[(closestIndex + step) % navPts.length];
    const rel = rotateRelative(point.x - reference.x, point.z - reference.z, car.hdg);
    points.push({ x: rel.x, z: rel.z, steepness: curv[(closestIndex + step) % navPts.length] || 0 });
    reference = point;
  }
  return points;
}

export function createTrainingSnapshot(car, context, config = DEFAULT_CONFIG) {
  const nodes = getNodeBundle(car, context, config.nodeLookahead);
  const navPts = context.cityAiPoints ? context.cityAiPoints.pts : context.trackPoints;
  let headingRelative = 0;
  if (navPts?.length) {
    let closestIndex = 0;
    let minDistance = Infinity;
    for (let index = 0; index < navPts.length; index += 1) {
      const point = navPts[index];
      const d = (car.pos.x - point.x) ** 2 + (car.pos.z - point.z) ** 2;
      if (d < minDistance) {
        minDistance = d;
        closestIndex = index;
      }
    }
    const current = navPts[closestIndex];
    const next = navPts[(closestIndex + 1) % navPts.length] || current;
    const trackHeading = Math.atan2(next.x - current.x, next.z - current.z);
    headingRelative = wrapAngle(car.hdg - trackHeading) / Math.PI;
  }
  const clearance = computeClearance(car, context.trackData, context.cityCorridors || context.corridors);
  const speedRatio = car.data.maxSpd > 0 ? car.spd / car.data.maxSpd : 0;
  const primary = [car.data.hdl || 0, car.data.brake || 0, car.data.maxSpd || 0];
  const nodeInputs = [];
  nodes.forEach((node) => {
    nodeInputs.push(node.x / 120, node.z / 120, node.steepness);
  });
  while (nodeInputs.length < config.nodeLookahead * 3) nodeInputs.push(0, 0, 0);
  return {
    primaryStats: { grip: primary[0], brake: primary[1], speed: primary[2] },
    nodes,
    ownPosition: { x: car.pos.x, z: car.pos.z },
    clearance,
    speed: car.spd,
    speedRatio,
    onGravel: !!car.onGravel,
    headingRelative,
    inputs: [
      primary[0] / 1.2,
      primary[1] / 24,
      primary[2] / 90,
      ...nodeInputs,
      car.pos.x / 500,
      car.pos.z / 500,
      clamp(clearance.left / 20, 0, 2),
      clamp(clearance.right / 20, 0, 2),
      speedRatio,
      headingRelative,
      car.onGravel ? 1 : -1,
    ],
  };
}

function scoreCar(car, telemetry, config) {
  const rewards = config.rewards;
  const progressMeters = Number.isFinite(car.progressMeters) ? car.progressMeters : car.totalProg;
  const currentProgressCm = Number.isFinite(car.progressCm) ? car.progressCm : progressMeters * 100;
  const bestProgressCm = Math.max(currentProgressCm, Number.isFinite(telemetry?.progressCm) ? telemetry.progressCm : 0);
  return bestProgressCm * rewards.progress * 0.01 + telemetry.maxSpeed * rewards.speed + telemetry.aliveTime * rewards.survival + (car.finished ? rewards.finish : 0) - telemetry.gravelTime * rewards.gravelPenalty - telemetry.wallContacts * rewards.wallPenalty - telemetry.steerEffort * rewards.steeringPenalty;
}

export class TrainableAIController {
  constructor(car, genome, getContext, config) {
    this.car = car;
    this.genome = cloneGenome(genome);
    this.getContext = getContext;
    this.config = mergeConfig(config);
    this.telemetry = { aliveTime: 0, gravelTime: 0, wallContacts: 0, maxSpeed: 0, steerEffort: 0, progressCm: 0, snapshots: [] };
    this.lastStuckTimer = 0;
    this.bootstrapTimer = 0;
    this.explorationSeed = genomeDeterministicSeed(this.genome);
    this.workerId = nextWorkerControllerId++;
    this.workerSnapshot = null;
    this.pendingWorkerAction = null;
  }

  exportData() {
    return {
      genome: cloneGenome(this.genome),
      config: deepClone(this.config),
      telemetry: deepClone(this.telemetry),
      snapshot: this.lastSnapshot || null,
    };
  }

  importData(payload) {
    if (payload?.genome) this.genome = cloneGenome(payload.genome);
    if (payload?.config) this.config = mergeConfig(payload.config);
  }

  update(dt) {
    const context = this.getContext();
    if (!context.trackPoints?.length || this.car.finished) return;
    const snapshot = createTrainingSnapshot(this.car, context, this.config);
    this.lastSnapshot = snapshot;
    const outputs = forwardPass(this.genome, snapshot.inputs);
    this.pendingWorkerAction = null;
    this.workerSnapshot = null;
    const bootstrapNode = snapshot.nodes[0] || { x: 0, z: 1, steepness: 0 };
    const nextNode = snapshot.nodes[1] || bootstrapNode;
    const steerNear = clamp(bootstrapNode.x / Math.max(7, Math.abs(bootstrapNode.z) + 3), -1, 1);
    const steerFar = clamp(nextNode.x / Math.max(12, Math.abs(nextNode.z) + 5), -1, 1);
    const pilotSteer = clamp((steerNear * 0.7) + (steerFar * 0.3) - snapshot.headingRelative * 0.55, -1, 1);
    const cornerSeverity = Math.max(Math.abs(bootstrapNode.steepness || 0), Math.abs(nextNode.steepness || 0), Math.abs(snapshot.headingRelative || 0));
    const desiredSpeedRatio = clamp(1 - cornerSeverity * 0.78, 0.24, 1);
    const speedError = desiredSpeedRatio - snapshot.speedRatio;
    const pilotThr = clamp(0.35 + Math.max(0, speedError) * 1.25, 0.12, 1);
    const pilotBrk = clamp(Math.max(0, -speedError) * 1.45, 0, 1);
    const isStartingFromRest = this.telemetry.aliveTime < 1.6 && this.car.spd < Math.max(4.5, this.car.data.maxSpd * 0.16);
    const isStuck = this.car.spd < 0.35 && this.telemetry.aliveTime > 1.1;
    const nnThr = outputs[0];
    const nnBrk = outputs[1];
    const nnStr = outputs[2];
    let thr = clamp(pilotThr + nnThr * 0.55 - Math.max(0, nnBrk) * 0.18, 0, 1);
    let brk = clamp(pilotBrk + Math.max(0, nnBrk) * 0.6 - Math.max(0, nnThr) * 0.12, 0, 1);
    let str = clamp(pilotSteer + nnStr * 0.9, -1, 1);
    if (isStartingFromRest || isStuck) {
      this.bootstrapTimer += dt;
      thr = Math.max(thr, 0.76);
      brk = Math.min(brk, 0.08);
      str = clamp(pilotSteer + Math.sin(this.explorationSeed + this.telemetry.aliveTime * 4.5) * 0.04, -1, 1);
    } else {
      this.bootstrapTimer = Math.max(0, this.bootstrapTimer - dt * 2);
    }
    this.car.update({ thr, brk, str }, dt);
    this.telemetry.aliveTime += dt;
    this.telemetry.maxSpeed = Math.max(this.telemetry.maxSpeed, this.car.spd);
    this.telemetry.steerEffort += Math.abs(str);
    this.telemetry.progressCm = Math.max(this.telemetry.progressCm, this.car.progressCm || 0);
    if (this.car.onGravel) this.telemetry.gravelTime += dt;
    if (this.car.stuckTimer > this.lastStuckTimer && this.car.stuckTimer > 0.15) this.telemetry.wallContacts += 1;
    this.lastStuckTimer = this.car.stuckTimer;
    if (this.telemetry.snapshots.length < 12) this.telemetry.snapshots.push(snapshot);
  }
}

export class TrainingManager {
  constructor(config) {
    this.config = mergeConfig(config);
    this.population = [];
    this.generation = 0;
    this.bestEntry = null;
    this.inputSize = null;
    this.jokerGenome = null;
    this.jokerRemaining = 0;
  }

  initPopulation(inputSize) {
    this.inputSize = inputSize;
    this.population = Array.from({ length: this.config.populationSize }, () => ({ genome: createGenome(this.config, inputSize), fitness: 0, source: 'random' }));
    this.generation = 1;
  }

  ensurePopulation(inputSize) {
    if (!this.population.length || this.inputSize !== inputSize) this.initPopulation(inputSize);
  }

  buildControllers(cars, getContext) {
    if (!cars.length) return [];
    const seedSnapshot = createTrainingSnapshot(cars[0], getContext(), this.config);
    this.ensurePopulation(seedSnapshot.inputs.length);
    return cars.map((car, index) => new TrainableAIController(car, this.population[index % this.population.length].genome, getContext, this.config));
  }

  getGenomeAt(index, inputSize) {
    this.ensurePopulation(inputSize);
    return this.population[index % this.population.length].genome;
  }

  evaluate(controllers) {
    if (!controllers.length) return null;
    const scored = controllers.map((controller, index) => ({
      genome: cloneGenome(controller.genome),
      fitness: scoreCar(controller.car, controller.telemetry, this.config),
      telemetry: controller.exportData().telemetry,
      carIndex: index,
    })).sort((a, b) => b.fitness - a.fitness);
    this.population = scored.slice(0, this.config.populationSize);
    this.bestEntry = scored[0] || this.bestEntry;
    if (scored[0] && this.config.jokerCarrySimulations > 0) {
      this.jokerGenome = cloneGenome(scored[0].genome);
      this.jokerRemaining = this.config.jokerCarrySimulations;
      this.bestEntry.jokerRemaining = this.jokerRemaining;
    }
    const elites = this.population.slice(0, this.config.eliteCount).map((entry) => entry.genome);
    const next = [];
    if (this.jokerGenome && this.jokerRemaining > 0) {
      next.push({ genome: cloneGenome(this.jokerGenome), fitness: 0, source: 'joker', jokerRemaining: this.jokerRemaining });
      this.jokerRemaining -= 1;
    }
    for (const entry of this.population.slice(0, this.config.eliteCount)) {
      if (next.length >= this.config.populationSize) break;
      next.push({ genome: cloneGenome(entry.genome), fitness: 0, source: entry.source || 'elite' });
    }
    while (next.length < this.config.populationSize) {
      const a = elites[Math.floor(Math.random() * elites.length)];
      const b = elites[Math.floor(Math.random() * elites.length)];
      next.push({ genome: mutateGenome(crossoverGenome(a, b), this.config), fitness: 0, source: 'bred' });
    }
    this.population = next;
    this.generation += 1;
    return scored[0] || null;
  }

  exportJSON() {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      config: this.config,
      generation: this.generation,
      bestEntry: this.bestEntry,
      population: this.population,
      jokerGenome: this.jokerGenome,
      jokerRemaining: this.jokerRemaining,
    }, null, 2);
  }

  importJSON(jsonString) {
    const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
    this.config = mergeConfig(parsed.config || {});
    this.population = Array.isArray(parsed.population) ? parsed.population.map((entry) => ({ genome: cloneGenome(entry.genome), fitness: +entry.fitness || 0, source: entry.source || 'imported' })) : [];
    this.generation = Math.max(1, Math.round(parsed.generation || 1));
    this.bestEntry = parsed.bestEntry || null;
    this.jokerGenome = parsed.jokerGenome ? cloneGenome(parsed.jokerGenome) : null;
    this.jokerRemaining = Math.max(0, Math.round(parsed.jokerRemaining || 0));
    const firstGenome = this.population[0]?.genome;
    this.inputSize = firstGenome?.meta?.inputSize || null;
    return parsed;
  }

  saveToStorage() {
    localStorage.setItem(TRAINING_STORAGE_KEY, this.exportJSON());
  }

  loadFromStorage() {
    const raw = localStorage.getItem(TRAINING_STORAGE_KEY);
    if (!raw) return null;
    return this.importJSON(raw);
  }
}

export function createTrainingManager(config) {
  const manager = new TrainingManager(config);
  try {
    manager.loadFromStorage();
  } catch {
    // ignore corrupted data
  }
  return manager;
}

export function parseTrainingJson(jsonString) {
  const parsed = JSON.parse(jsonString);
  return parsed;
}

export { DEFAULT_CONFIG, TRAINING_STORAGE_KEY, mergeConfig };


export class TrainingWorkerPool {
  constructor() {
    const concurrency = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1 || 2));
    this.controllers = new Map();
    this.workers = Array.from({ length: concurrency }, () => {
      const worker = new Worker(new URL('./training-worker.js', import.meta.url), { type: 'module' });
      const entry = { worker };
      worker.onmessage = (event) => this.handleMessage(event.data);
      return entry;
    });
    this.inFlightToken = 0;
    this.pendingResponses = 0;
  }

  register(controllers) {
    controllers.forEach((controller) => {
      this.controllers.set(controller.workerId, controller);
    });
  }

  schedule(controllers) {
    if (!this.workers.length || this.pendingResponses > 0) return;
    const batch = (controllers || []).filter((controller) => controller && controller.workerSnapshot && !controller.car.finished);
    if (!batch.length) return;
    this.register(batch);
    this.inFlightToken += 1;
    const token = this.inFlightToken;
    const workerCount = Math.min(this.workers.length, batch.length);
    this.pendingResponses = workerCount;
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      const slice = batch.filter((_, index) => index % workerCount === workerIndex).map((controller) => ({
        id: controller.workerId,
        genome: controller.genome,
        inputs: controller.workerSnapshot.inputs,
      }));
      this.workers[workerIndex].worker.postMessage({ type: 'infer', token, batch: slice });
    }
  }

  handleMessage(message) {
    if (message?.type !== 'infer-result' || message.token !== this.inFlightToken) return;
    (message.results || []).forEach((result) => {
      const controller = this.controllers.get(result.id);
      if (controller) controller.pendingWorkerAction = result.outputs;
    });
    this.pendingResponses = Math.max(0, this.pendingResponses - 1);
  }

  dispose() {
    this.workers.forEach(({ worker }) => worker.terminate());
    this.workers = [];
    this.pendingResponses = 0;
    this.controllers.clear();
  }
}

export function createTrainingWorkerPool() {
  try {
    if (typeof Worker === 'undefined') return null;
    return new TrainingWorkerPool();
  } catch {
    return null;
  }
}
