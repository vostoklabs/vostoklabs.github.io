// How text keeps its size on wide caps (src/legendSize.js). Plain node: the module has no imports.
//   node apps/keycap-generator/tests/legend-size.test.mjs
import { legendSizeMax, textHeightOf, sizeForTextHeight } from '../src/legendSize.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};
const box = (w, h) => ({ min: { x: 0, y: 0 }, max: { x: w, y: h } });

// The shipped Standard caps' usable tops (meta.topExtent).
const TOP_1U = [15.2, 15.2];
const TOP_2U = [34.16, 15.2];
// Roboto's "A" is about as wide as tall; "Shift" about 3.5 times wider than tall.
const A = box(0.68, 0.71);
const SHIFT = box(2.45, 0.71);

// The old ceilings are unchanged.
check('1u, no legend yet: the short side', Math.abs(legendSizeMax(null, TOP_1U) - 15.2 * 0.95) < 1e-9);
check('2u, a near-square legend: the short side, stretched by its own proportions',
  Math.abs(legendSizeMax(A, TOP_2U) - 15.2 * (0.71 / 0.68) * 0.95) < 1e-9);
check('2u, a wide word: the cap\'s length', Math.abs(legendSizeMax(SHIFT, TOP_2U) - 34.16 * 0.95) < 1e-9);

// The bug: an "A" sized 7.6 then retyped "Shift" kept 7.6 as its WIDTH.
const height = textHeightOf(A, 7.6);
check('"A" at Size 7.6 is 7.6 mm tall', Math.abs(height - 7.6) < 1e-9, height.toFixed(3));
const on2u = sizeForTextHeight(SHIFT, height, legendSizeMax(SHIFT, TOP_2U));
check('"Shift" on a 2u keeps the letter height: about 26 mm wide', on2u > 25.5 && on2u < 26.5, `${on2u} mm`);
check('…and its letters are as tall as the "A" was', Math.abs(textHeightOf(SHIFT, on2u) - height) < 0.05, textHeightOf(SHIFT, on2u).toFixed(3));
const on1u = sizeForTextHeight(SHIFT, height, legendSizeMax(SHIFT, TOP_1U));
check('"Shift" on a 1u shrinks to fit the top', on1u === Math.floor(15.2 * 0.95 * 10) / 10, `${on1u} mm`);
check('…so a 2u\'s "Shift" is bigger than a 1u\'s', on2u > on1u * 1.5);
check('the remembered height survives the 1u: back on a 2u it is full size again',
  sizeForTextHeight(SHIFT, height, legendSizeMax(SHIFT, TOP_2U)) === on2u);
check('a single letter is unaffected (Size stays its height)', sizeForTextHeight(A, height, legendSizeMax(A, TOP_1U)) === 7.6);
check('never past the ceiling, even rounding', sizeForTextHeight(SHIFT, 100, 14.44) <= 14.44);
check('a degenerate box does not divide by zero', Number.isFinite(sizeForTextHeight(box(1, 0), 5, 10)) && Number.isFinite(textHeightOf(box(0, 0), 5)));

if (failures) { console.error(`${failures} legend size check(s) failed`); process.exit(1); }
console.log('all legend size checks passed');
