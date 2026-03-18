import { TrainableAIController, mergeConfig } from './train-ai.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createFallbackGenome(inputSize) {
  const cfg = mergeConfig({ hiddenLayers: 1, neuronsPerLayer: 8 });
  const layers = [];
  let width = inputSize;
  for (let layer = 0; layer < cfg.hiddenLayers; layer += 1) {
    layers.push({
      weights: Array.from({ length: cfg.neuronsPerLayer }, () => Array.from({ length: width }, () => 0)),
      biases: Array.from({ length: cfg.neuronsPerLayer }, () => 0),
    });
    width = cfg.neuronsPerLayer;
  }
  layers.push({
    weights: [
      Array.from({ length: width }, (_, i) => (i === 3 ? 0.85 : i === 4 ? -0.25 : 0)),
      Array.from({ length: width }, (_, i) => (i === 5 ? 0.9 : i === 4 ? 0.18 : 0)),
      Array.from({ length: width }, (_, i) => (i === 3 ? 0.5 : i === 4 ? -0.7 : i === 6 ? 0.3 : 0)),
    ],
    biases: [0.2, -0.55, 0],
  });
  return { layers, meta: { createdAt: new Date().toISOString(), inputSize, outputSize: 3, preset: 'fallback' } };
}

export class AI extends TrainableAIController {
  constructor(car, _la, context, options = {}) {
    const config = mergeConfig(options.config || {});
    const probe = context();
    const inputSize = 3 + config.nodeLookahead * 3 + 2 + 2 + 1 + 1 + 1;
    const genome = options.genome || createFallbackGenome(inputSize);
    super(car, genome, context, config);
    this.aggression = clamp(options.aggression ?? car.aiAgg ?? 1, 0.4, 1.6);
  }

  update(dt) {
    const preSpeed = this.car.spd;
    super.update(dt);
    if (this.car.spd < preSpeed * 0.35 && !this.car.onGravel) {
      this.car.spd = Math.max(this.car.spd, preSpeed * 0.45);
    }
  }
}
