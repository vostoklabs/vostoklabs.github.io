// The ring maths the box takes from the shelf, on four rings: which way round the area's sign
// is, which argument of the point test is the point, and which order the box comes back in.
//
// Every one is load-bearing and none would fail loudly. The exporter tells an outer ring from a
// hole by the sign, and cuts holes before the outline that frees the blank; the logo's nesting
// asks the point test "is this ring inside that one"; and every caller destructures the box as
// [x0, y0, x1, y1].
//
// Then the logo's own question, "is this ring inside that one", and the winding the logo takes
// from it. The answer may not depend on where a ring starts or which way it runs: the printed ink
// is taken by winding, so a reader that starts a ring elsewhere would print different ink.
//
// Run: pnpm --filter foldbox test:poly

import { windByNesting } from '../src/geometry/marks';
import { pointInRing, polysBounds, ringWithin, signedArea } from '../src/geometry/poly';
import type { Poly, Pt } from '../src/types';

let failures = 0;
let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${msg}`);
  }
};

/** Counter-clockwise, 2 x 1. */
const square: Poly = [[0, 0], [2, 0], [2, 1], [0, 1]];
/** The same square wound the other way, as a hole is. */
const hole: Poly = [...square].reverse();
/** Counter-clockwise, legs 4 and 3, all of it at or above y = 0. */
const triangle: Poly = [[0, 0], [4, 0], [0, 3]];
/** An L, counter-clockwise, with its notch at the top right, and all of it off the origin. */
const ell: Poly = [[-1, -2], [5, -2], [5, 1], [1, 1], [1, 7], [-1, 7]];

console.log('the sign of the area');
ok(signedArea(square) === 2, `a counter-clockwise 2 x 1 square has area ${signedArea(square)}, not +2`);
ok(signedArea(hole) === -2, `the same square wound clockwise has area ${signedArea(hole)}, not -2`);
ok(signedArea(triangle) === 6, `a counter-clockwise 4-3 triangle has area ${signedArea(triangle)}, not +6`);
ok(signedArea(ell) === 6 * 3 + 2 * 6, `the L has area ${signedArea(ell)}, not +30`);

console.log('the point first, then the ring');
ok(pointInRing([1, 0.5], square), 'the middle of the square is not inside it');
ok(!pointInRing([3, 0.5], square), 'a point right of the square is inside it');
ok(pointInRing([1, 0.5], hole), 'winding decides the point test, which must be blind to it');
ok(pointInRing([0, 3], ell) && pointInRing([4, -1], ell), 'a point in either arm of the L is not inside it');
ok(!pointInRing([3, 4], ell), 'a point in the notch of the L is inside it');

console.log('the box, as [x0, y0, x1, y1]');
ok(JSON.stringify(polysBounds([ell])) === '[-1,-2,5,7]', `the L's box is ${JSON.stringify(polysBounds([ell]))}`);
ok(JSON.stringify(polysBounds([square, triangle])) === '[0,0,4,3]', 'two rings do not share one box');
ok(JSON.stringify(polysBounds([])) === '[0,0,0,0]', 'no rings is not the empty box at the origin');
ok(JSON.stringify(polysBounds([[]])) === '[0,0,0,0]', 'a ring with no points is not the empty box at the origin');

/** Every start and both directions of a ring. */
const starts = (r: Poly): Poly[] =>
  r.flatMap((_, k) => {
    const s = [...r.slice(k), ...r.slice(0, k)];
    return [s, [...s].reverse()];
  });
const sq4: Poly = [[0, 0], [4, 0], [4, 4], [0, 4]];
/** Crosses `sq4`: one corner inside it and two outside; one of the square's corners is inside it. */
const wedge: Poly = [[2, 2], [7, 2], [2, 7]];
/** Wholly inside `sq4`, as a counter is inside its letter. */
const counter: Poly = [[1, 1], [1, 3], [3, 3], [3, 1]];
/** A V with its two ends on `sq4`'s sides, as an envelope's flap meets them. */
const flap: Poly = [[0, 3], [2, 1], [4, 3]];

console.log('inside, asked of the whole ring');
ok(starts(wedge).every((w) => !ringWithin(w, sq4)), 'a ring that crosses another is inside it from some start');
ok(starts(sq4).every((s) => !ringWithin(s, wedge)), 'the ring it crosses is inside it from some start');
ok(starts(counter).every((c) => ringWithin(c, sq4)), 'a counter is not inside its letter from some start');
ok(!ringWithin(sq4, counter), 'the letter is inside its counter');
ok(starts(flap).every((f) => ringWithin(f, sq4)), 'a ring whose ends touch the other is not inside it from some start');
ok(!ringWithin(sq4, sq4), 'a ring is inside itself');

console.log('outer or hole, by nesting');
let crossed = 0;
for (const w of starts(wedge)) {
  for (const s of starts(sq4)) {
    if (windByNesting([s, w]).every((r) => signedArea(r) > 0)) crossed++;
  }
}
ok(crossed === 6 * 8, `two crossing rings came out as two outers for ${crossed} of 48 starts`);
ok(
  starts(counter).every((c) => {
    const [outer, hole] = windByNesting([[...sq4].reverse(), c]);
    return signedArea(outer!) > 0 && signedArea(hole!) < 0;
  }),
  'a counter is not a hole in its letter from some start',
);
// Six wavy rings one inside the next, 400 points each: the innermost is inside five others, so a
// hole, and the outermost is inside none.
const wavy = Array.from({ length: 6 }, (_, k) =>
  Array.from({ length: 400 }, (_, i): Pt => {
    const a = (i / 400) * Math.PI * 2;
    const rad = 20 + 4 * k + 1.2 * Math.sin(a * (5 + k));
    return [rad * Math.cos(a), rad * Math.sin(a)];
  }),
);
for (const shift of [0, 133, 271]) {
  const signs = windByNesting(wavy.map((r, k) => (k % 2 ? [...r].reverse() : [...r.slice(shift), ...r.slice(0, shift)])))
    .map((r) => (signedArea(r) > 0 ? '+' : '-'))
    .join('');
  ok(signs === '-+-+-+', `six nested rings started at ${shift} wind ${signs}, not -+-+-+`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
