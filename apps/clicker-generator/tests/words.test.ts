/*
  Where a new line of words fits on a shape base (src/words.ts).

  The foot of a heart or a circle is narrower than a word, so a line put at the frame's lowest
  point was cut off at both ends. `lowestFit` finds the first height, going up, where the line is
  wide enough to sit inside, and `spanAt` / `wordFits` are what it measures with.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs words
*/
import { lowestFit, spanAt, wordFits } from '../src/words.ts';
type Ring = import('../src/types.ts').Ring;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const circle = (r: number, n = 128): Ring => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);
const square = (half: number): Ring => [[-half, -half], [half, -half], [half, half], [-half, half]];
/** A frame with a round hole in the middle, the hole wound the other way. */
const ringed = [circle(15), circle(4).reverse()];

{
  const s = spanAt([circle(15)], 0);
  check('across a 15 mm circle\'s middle: from -15 to 15', !!s && near(s[0], -15, 0.05) && near(s[1], 15, 0.05), JSON.stringify(s));
  const low = spanAt([circle(15)], -12);
  check('…and 12 mm down, the chord: ±9 mm', !!low && near(low[1], 9, 0.05) && near(low[0], -9, 0.05), JSON.stringify(low));
  check('…and none below the circle', spanAt([circle(15)], -16) === null, String(spanAt([circle(15)], -16)));
  const holed = spanAt(ringed, 0);
  check('a hole in the frame is not inside it: the stretch beside the hole, the widest', !!holed && near(holed[1] - holed[0], 11, 0.05), JSON.stringify(holed));
}

{
  check('a 12 × 5 mm line fits a 30 mm square anywhere short of its edge', wordFits([square(15)], -11.5, 12, 5, 0.8) && !wordFits([square(15)], -12, 12, 5, 0.8), 'at y -11.5, not -12');
  // At y = -12 the circle is only ±5.4 mm wide under the line's foot: a 12 mm line does not fit.
  check('a 12 × 5 mm line does not fit low in a 15 mm circle', !wordFits([circle(15)], -12, 12, 5, 0.8), 'at y -12');
}

{
  const sq = lowestFit([square(15)], 12, 5, -15 + 2.5, -4);
  check('in a square, the lowest place is a margin inside the edge', sq !== null && near(sq, -15 + 2.5 + 0.8, 0.26), `y ${sq}`);
  const ci = lowestFit([circle(15)], 12, 5, -15 + 2.5, -4);
  // A margin under the line's foot the circle must still be ±6.8 mm wide: y − 3.3 ≥ −sqrt(15² − 6.8²),
  // so y ≥ −10.07, and the first height on the 0.25 mm walk up from −12.5 that clears it is −10.
  check('in a circle, higher up, where the chord is as wide as the line and its margin', ci === -10 && wordFits([circle(15)], ci, 12, 5, 0.8), `y ${ci}`);
  check('…and nowhere, when the line is wider than the whole frame', lowestFit([circle(15)], 40, 5, -12.5, 12.5) === null, 'a 40 mm line');
}

console.log(failures ? `\n${failures} FAILED` : '\nnew lines of words find room');
process.exit(failures ? 1 : 0);
