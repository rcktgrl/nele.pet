function sigmoid(value) {
  return Math.tanh(value);
}

function forwardPass(genome, inputs) {
  let activations = inputs;
  genome.layers.forEach((layer) => {
    activations = layer.weights.map((row, outputIndex) => {
      let sum = layer.biases[outputIndex];
      for (let inputIndex = 0; inputIndex < row.length; inputIndex += 1) {
        sum += row[inputIndex] * activations[inputIndex];
      }
      return sigmoid(sum);
    });
  });
  return activations;
}

self.onmessage = (event) => {
  const { type, token, batch } = event.data || {};
  if (type !== 'infer' || !Array.isArray(batch)) return;
  const results = batch.map((entry) => ({
    id: entry.id,
    outputs: forwardPass(entry.genome, entry.inputs),
  }));
  self.postMessage({ type: 'infer-result', token, results });
};
