'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  grad-worker.js — parallel PPO gradient computation
//
//  Spawned (several instances) by sim-worker.js. Each task carries the
//  current network weights plus a slice of the minibatch; the worker
//  computes gradient sums over its slice and posts them back. The sim
//  worker reduces all slices and applies the Adam step.
// ─────────────────────────────────────────────────────────────────────────────

import { Net, accumulatePPOGrads } from './nn-core.js';

let actor = null, critic = null, sizesKey = '';

self.onmessage = function (e) {
  const d = e.data;
  if (d.type !== 'grad') return;

  const key = JSON.stringify([d.actorSizes, d.criticSizes]);
  if (key !== sizesKey) {
    actor  = new Net(d.actorSizes);
    critic = new Net(d.criticSizes);
    sizesKey = key;
  }
  actor.loadFlat(d.actorFlat);
  critic.loadFlat(d.criticFlat);
  actor.zeroGrad();
  critic.zeroGrad();

  const logStd = Float64Array.from(d.logStd);
  const r = accumulatePPOGrads(actor, critic, logStd, d.hp, d);

  const aG = actor.gradFlatF64();
  const cG = critic.gradFlatF64();
  postMessage(
    { aG, cG, gLs: r.gLs, pi: r.pi, v: r.v, ent: r.ent, n: d.n },
    [aG.buffer, cG.buffer, r.gLs.buffer],
  );
};
