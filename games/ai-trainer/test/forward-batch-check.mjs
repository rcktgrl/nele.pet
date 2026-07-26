'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  forward-batch-check.mjs — the rollout's batched WASM inference must agree
//  with the scalar JS forward it replaces.
//
//  Run:  node games/ai-trainer/test/forward-batch-check.mjs
//
//  Covers batch sizes either side of the kernel's BLK boundary (1, 33, 64),
//  several depths/widths, and the recurrent obs/act layout.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import { Net } from '../scripts/nn-core.js';
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(new URL('../scripts/nn_wasm.wasm', import.meta.url)), {});
const align8 = n => (n+7)&~7;
let worst = 0, cases = 0;
for (const [H,L,OBS,ACT] of [[64,1,40,6],[256,2,40,6],[32,3,40,6],[128,1,36,2]]) {
  const sizes=[OBS,...Array(L).fill(H),ACT];
  const net=new Net(sizes,1), flat=net.flatF64();
  for (const n of [1,3,8,32,33,64]) {
    const obs=new Float64Array(n*OBS);
    for(let i=0;i<obs.length;i++)obs[i]=Math.random()*2-1;
    const mem=instance.exports.memory, base=instance.exports.get_heap_base();
    const need=align8(sizes.length*4)+align8(flat.length*8)+align8(obs.length*8)+align8(n*ACT*8);
    if(base+need>mem.buffer.byteLength) mem.grow(Math.ceil((base+need-mem.buffer.byteLength)/65536));
    let off=base; const szO=off; off+=align8(sizes.length*4);
    const fO=off; off+=align8(flat.length*8);
    const oO=off; off+=align8(obs.length*8); const rO=off;
    const buf=mem.buffer;
    new Int32Array(buf,szO,sizes.length).set(sizes);
    new Float64Array(buf,fO,flat.length).set(flat);
    new Float64Array(buf,oO,obs.length).set(obs);
    instance.exports.forward_batch(sizes.length-1, szO, fO, oO, n, rO);
    const got=new Float64Array(buf,rO,n*ACT);
    for(let k=0;k<n;k++){
      const ref=net.forwardScratch(obs.subarray(k*OBS,(k+1)*OBS));
      for(let d=0;d<ACT;d++){
        const e=Math.abs(ref[d]-got[k*ACT+d])/(Math.abs(ref[d])+1e-9);
        if(e>worst)worst=e;
      }
    }
    cases++;
  }
}
console.log(`  ${worst < 1e-9 ? '✓' : '✗ FAIL'} batched WASM forward vs JS forwardScratch: ${cases} shapes/batch-sizes, max rel err ${worst.toExponential(2)}`);
// Tolerance matches grad-worker-check: the kernel is built with -ffast-math,
// so its dot products reassociate relative to the sequential JS sum. Anything
// under 1e-9 is far below the noise in a sampled action.
process.exit(worst < 1e-9 ? 0 : 1);
