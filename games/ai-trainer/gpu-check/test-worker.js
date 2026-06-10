import { GpuGrad } from '../scripts/gpu-grad.js';
import { Net, accumulatePPOGrads } from '../scripts/nn-core.js';

const log = m => postMessage({ log: String(m) });

(async () => {
  try {
    log('navigator.gpu present: ' + !!navigator.gpu);
    if (!navigator.gpu) { postMessage({ done: true, ok: false, why: 'no webgpu' }); return; }
    const adapter = await navigator.gpu.requestAdapter();
    log('adapter: ' + (adapter ? `${adapter.info?.vendor || '?'} / ${adapter.info?.architecture || '?'} / ${adapter.info?.description || ''}` : 'NULL'));
    if (!adapter) { postMessage({ done: true, ok: false, why: 'no adapter' }); return; }

    const relL2 = (x, y) => {
      let e2 = 0, n2 = 0;
      for (let q = 0; q < y.length; q++) { const e = x[q] - y[q]; e2 += e * e; n2 += y[q] * y[q]; }
      return Math.sqrt(e2 / (n2 + 1e-12));
    };

    let allPass = true;
    for (const [nl, h] of [[1, 64], [2, 128], [2, 256], [3, 256]]) {
      const I = 40, A = 6;
      const AS = [I, ...Array(nl).fill(h), A], CS = [I, ...Array(nl).fill(h), 1];
      const ECAP = 8 * 512 * 2 + 64, MBS = 256, N = 4100; // realistic trainer sizes

      const res = await GpuGrad.create(AS, CS, ECAP, MBS);
      if (!res.ok) { log(`${nl}x${h}: create FAILED: ` + res.error); allPass = false; continue; }
      const gpu = res.gpu;
      log(`${nl}x${h}: created, GROUP=${gpu.lay.GROUP}, slabs=${(Math.ceil(MBS / gpu.lay.GROUP) * gpu.lay.SLAB * 4 / 1048576).toFixed(1)} MB`);

      const actor = new Net(AS, 0.5), critic = new Net(CS, 0.5);
      const logStd = Float64Array.from({ length: A }, () => -0.5);
      const hp = { clip: 0.2, entropyCoef: 0.003, vfCoef: 0.5 };
      const rnd = n => Float64Array.from({ length: n }, () => Math.random() * 2 - 1);
      const obs = rnd(N * I), act = rnd(N * A), adv = rnd(N), ret = rnd(N);
      const logp = Float64Array.from({ length: N }, () => -3 + Math.random());

      try {
        const t0 = performance.now();
        const results = await gpu.computeEpoch(actor.flatF64(), critic.flatF64(), logStd, hp,
          { N, obs, act, logp, adv, ret });
        const dt = performance.now() - t0;

        const bs = results[0].n;
        actor.zeroGrad(); critic.zeroGrad();
        accumulatePPOGrads(actor, critic, logStd, hp, {
          n: bs, obsDim: I, actDim: A,
          obs: obs.subarray(0, bs * I), act: act.subarray(0, bs * A),
          logp: logp.subarray(0, bs), adv: adv.subarray(0, bs), ret: ret.subarray(0, bs),
        });
        const refA = actor.gradFlatF64(), refC = critic.gradFlatF64();
        const r0 = results[0];
        const ea = relL2(r0.aG, refA), ec = relL2(r0.cG, refC);
        const pass = ea < 5e-3 && ec < 5e-3;
        log(`${nl}x${h}: ${results.length} minibatches in ${dt.toFixed(0)} ms — rel-L2 actor=${ea.toExponential(1)} critic=${ec.toExponential(1)} → ${pass ? 'PASS' : 'FAIL'}`);
        if (!pass) allPass = false;
      } catch (err) {
        log(`${nl}x${h}: computeEpoch THREW: ` + err.message);
        allPass = false;
      }
      gpu.destroy();
    }
    postMessage({ done: true, ok: allPass, why: allPass ? 'all architectures validated' : 'see log' });
  } catch (err) {
    log('THROW: ' + (err && err.message) + '\n' + (err && err.stack));
    postMessage({ done: true, ok: false, why: String(err && err.message) });
  }
})();
