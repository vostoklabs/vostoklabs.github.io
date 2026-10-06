// The ring maths the box takes from the shelf, on four rings: which way round the area's sign
// is, which argument of the point test is the point, and which order the box comes back in.
//
// Every one is load-bearing and none would fail loudly. The exporter tells an outer ring from a
// hole by the sign, and cuts holes before the outline that frees the blank; the logo's nesting
// asks the point test "is this ring inside that one"; and every caller destructures the box as
// [x0, y0, x1, y1].
//
// Run: pnpm --filter foldbox test:poly

import { pointInRing, polysBounds, signedArea } from '../src/geometry/poly';
import type { Poly } from '../src/types';

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

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
