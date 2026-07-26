'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  gru-batch-check.mjs — the recurrent rollout's batched WASM step must agree
//  with GRUNet.step(), the scalar JS path it replaces.
//
//  Run:  node games/ai-trainer/test/gru-batch-check.mjs
//
//  The recurrent policy is the trainer's default, so this path decides every
//  action in a normal run. Covers several hidden widths and agent counts, both
//  the returned outputs and the new hidden state.
// ─────────────────────────────────────────────────────────────────────────────

let worstAll = 0;
import fs from 'node:fs';
import { GRUNet } from '../scripts/nn-core.js';
const { instance } = await WebAssembly.instantiate(
  fs.readFileSync(new URL('../scripts/nn_wasm.wasm', import.meta.url)), {});
const align8 = n => (n + 7) & ~7;
const median = v => { const s=[...v].sort((a,b)=>a-b); return s[s.length>>1]; };

console.log('batched GRU step vs GRUNet.step()\n');
for (const [I,H,O] of [[36,64,2],[36,128,2],[36,256,2],[52,96,2]]) {
  const net = new GRUNet([I,H,O], 1);
  const flat = net.flatF64();
  for (const n of [1, 8, 31, 32, 33]) {
    const obs = new Float64Array(n*I), hp = new Float64Array(n*H);
    for (let i=0;i<obs.length;i++) obs[i]=Math.random()*2-1;
    for (let i=0;i<hp.length;i++)  hp[i]=Math.random()*2-1;

    const mem=instance.exports.memory, base=instance.exports.get_heap_base();
    const need=align8(3*4)+align8(flat.length*8)+align8(obs.length*8)+align8(hp.length*8)+align8(hp.length*8)+align8(n*O*8);
    if(base+need>mem.buffer.byteLength) mem.grow(Math.ceil((base+need-mem.buffer.byteLength)/65536));
    let off=base;
    const szO=off; off+=align8(3*4);
    const fO=off;  off+=align8(flat.length*8);
    const oO=off;  off+=align8(obs.length*8);
    const pO=off;  off+=align8(hp.length*8);
    const hO=off;  off+=align8(hp.length*8);
    const yO=off;
    const buf=mem.buffer;
    new Int32Array(buf,szO,3).set([I,H,O]);
    new Float64Array(buf,fO,flat.length).set(flat);
    new Float64Array(buf,oO,obs.length).set(obs);
    new Float64Array(buf,pO,hp.length).set(hp);

    // reference: per-agent JS step
    const refY = new Float64Array(n*O), refH = new Float64Array(n*H);
    for (let a=0;a<n;a++){
      const hOut=new Float64Array(H);
      const y=net.step(obs.subarray(a*I,(a+1)*I), hp.subarray(a*H,(a+1)*H), hOut);
      refY.set(y, a*O); refH.set(hOut, a*H);
    }
    instance.exports.gru_step_batch(szO, fO, oO, pO, n, hO, yO);
    const gotY=new Float64Array(buf,yO,n*O), gotH=new Float64Array(buf,hO,n*H);
    let worst=0;
    for(let k=0;k<refY.length;k++) worst=Math.max(worst, Math.abs(refY[k]-gotY[k])/(Math.abs(refY[k])+1e-9));
    for(let k=0;k<refH.length;k++) worst=Math.max(worst, Math.abs(refH[k]-gotH[k])/(Math.abs(refH[k])+1e-9));

    worstAll = Math.max(worstAll, worst);
    console.log(`  ${worst < 1e-9 ? '✓' : '✗ FAIL'} ${(I+'×'+H+'×'+O).padEnd(12)} ${String(n).padStart(3)} agents — max rel err ${worst.toExponential(1)}`);
  }
}

console.log(worstAll < 1e-9 ? '\nall checks passed' : '\nCHECKS FAILED');
process.exit(worstAll < 1e-9 ? 0 : 1);
