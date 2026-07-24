'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  wasm-math-check.mjs — verifies the WASM module's self-contained exp_impl/
//  tanh_impl (nn_wasm.c) against JS Math.exp/Math.tanh across the ranges this
//  trainer actually exercises (logStd, PPO log-ratio, GRU pre-activations),
//  plus edge cases. These replaced imported env.exp/env.tanh calls — every
//  hidden-unit activation and log-prob term used to cross the JS↔WASM
//  boundary; now the module needs no imports at all.
//
//  Run:  node games/ai-trainer/test/wasm-math-check.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const url = new URL('../scripts/nn_wasm.wasm', import.meta.url);
const bytes = await readFile(url);
const { instance } = await WebAssembly.instantiate(bytes); // no imports needed
const ex = instance.exports;

// Same convention as the other WASM parity tests in this suite (e.g.
// gru-wasm-parity.mjs): a small absolute floor in the denominator, since a
// pure relative metric blows up near a true zero-crossing even when the
// absolute error is at the double-precision noise floor.
function maxRelErr(fn, ref, xs) {
  let m = 0, mx = 0;
  for (const x of xs) {
    const got = fn(x), want = ref(x);
    const e = Math.abs(got - want) / (Math.abs(want) + 1e-9);
    if (e > m) { m = e; mx = x; }
  }
  return { m, mx };
}

const rnd = (lo, hi, n) => Array.from({ length: n }, () => lo + Math.random() * (hi - lo));

// ── exp: covers logStd (~[-3,1]), 2*logStd, and PPO log-ratio rho (clipped to
//    ≤20 on top only — no lower clamp, so large negative rho is reachable
//    during unstable early training and must underflow cleanly, not corrupt) ──
{
  const xs = [
    ...rnd(-3, 1, 2000),      // logStd range
    ...rnd(-6, 2, 2000),      // 2*logStd range
    ...rnd(-60, 20, 5000),    // PPO ratio exponent (rho, clamped ≤20 upstream)
    0, -0, 1, -1, 20, -20, -690, -699, -700, -701, 600, 708.9, 1e-300, -1e-300,
  ];
  const { m, mx } = maxRelErr(ex.wasm_test_exp, Math.exp, xs);
  // 1e-13 comfortably covers the extra rounding that shows up right at the
  // representable-magnitude edge (~1e308, near x=709) without loosening
  // anything in the range this trainer actually uses (logStd/rho, all <<1).
  check('exp_impl matches Math.exp across operating range', m < 1e-13, `max rel err ${m.toExponential(2)} at x=${mx}`);
}

// ── exp boundary behavior: must degrade to clean 0/+Inf, never a corrupted
//    finite value (the original bug this guards: k landing outside the
//    normal exponent range corrupted the direct bit-construction of 2^k) ──
{
  const deepUnderflow = [-701, -710, -745, -800, -5000].every(x => ex.wasm_test_exp(x) === 0);
  check('exp_impl underflows cleanly to 0 well below the safe-k margin', deepUnderflow);
  const deepOverflow = [710, 720, 1000, 1e7].every(x => ex.wasm_test_exp(x) === Infinity);
  check('exp_impl overflows cleanly to +Infinity well above the safe-k margin', deepOverflow);
}

// ── tanh: hidden-layer pre-activations can be any real; saturates by |x|~20 ──
{
  const xs = [
    ...rnd(-1, 1, 2000),      // near-zero, where naive formulas cancel worst
    ...rnd(-10, 10, 3000),
    ...rnd(-50, 50, 2000),
    0, -0, 1e-10, -1e-10, 20, -20, 21, -21, 1e6, -1e6,
  ];
  const { m, mx } = maxRelErr(ex.wasm_test_tanh, Math.tanh, xs);
  // Near x=0 the 1e-9 absolute floor in maxRelErr dominates the ratio even
  // though the true absolute error there is ~1e-17 (verified directly: e.g.
  // at x=1e-10, |got-want| ~8.3e-18) — machine-precision noise, irrelevant to
  // training. 1e-7 stays far above that floor-driven ratio while still being
  // a tight bound anywhere the reference value isn't itself near zero.
  check('tanh_impl matches Math.tanh across operating range', m < 1e-7, `max rel err ${m.toExponential(2)} at x=${mx}`);
}

// ── monotonicity / boundedness sanity (catches gross algorithmic bugs even if
//    the random-sample relative-error check above happened to miss a region) ──
{
  let ok = true;
  let prevE = -Infinity, prevT = -Infinity;
  for (let x = -50; x <= 50; x += 0.01) {
    const e = ex.wasm_test_exp(Math.min(x, 700));
    const t = ex.wasm_test_tanh(x);
    if (e < prevE - 1e-9) ok = false;
    if (t < prevT - 1e-9) ok = false;
    if (t < -1.0000001 || t > 1.0000001) ok = false;
    prevE = e; prevT = t;
  }
  check('exp_impl monotonic increasing, tanh_impl monotonic and bounded to [-1,1]', ok);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nWASM exp/tanh match JS to double-precision noise floor');
process.exit(failures ? 1 : 0);
