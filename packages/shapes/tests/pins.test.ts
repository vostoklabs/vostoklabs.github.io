/*
  pnpm --filter @vostok/shapes test

  Every function this package took over answers exactly as it did where it came from. The
  laser engine's ring maths and the pattern engine's geometry were moved here; the digests below
  were taken by running tests/corpus.ts through those two files as they were, and the same corpus
  through this package must give the same digests, bit for bit. (The union test and the
  rectangle from two corners came later, from the laser studio's own copies, pinned the same
  way.) A change that moves one of them moves every laser blank, pattern fill and cut file built
  on it, so it is a decision, made here on purpose, never a side effect.

  Then the parts that are new here: a rounded rectangle placed by its centre, the box of some
  rings with its width and height, and a rectangle from two corners beside `rect`.
*/
import * as S from '../src/index';
import { digests, type ShapeApi } from './corpus';

let checks = 0;
let failed = 0;
const ok = (cond: unknown, msg: string): void => {
  checks++;
  if (!cond) {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
};

/** From the two original files, before the move. */
const PINNED: Record<string, string> = {
  signedArea: 'f42f477832819006',
  bboxOf: '80a721ee4f3f6e87',
  mapShapes: 'fc11e1aa2f06090e',
  centreShapes: 'e90289f4c73d0178',
  placeShapes: '13399ee0d4f5976a',
  mirrorX: '24572c107f80bdfa',
  simplifyRing: 'ddc60cf1b061b82a',
  circleRing: 'e4b9dada33381403',
  roundedRectRing: '4051cb0ac06b5424',
  teardropRing: '2f9f6e7ed1bc8c69',
  dogTagRing: 'f061015a7e14c246',
  cancelCoincidentRings: 'a1366453351d294f',
  islandsFromContours: '8772416a386bcaf3',
  filletRing: 'a8d4b1a7bbf11565',
  TAU: '8398dd60c6422554',
  signedAreaClosingFirst: 'c09e427f158d86c6',
  ringLength: '877b97387f98c295',
  bboxOfPoints: '58a60affdd8017cd',
  bboxOfShapes: 'a02805853eec1b3a',
  boxValid: '4d4cf1e66ed42b9f',
  boxCentre: '00e9d76ea3fb6250',
  pointInRing: '9df89c5517753a29',
  insideShapes: '56311c5708405f7c',
  pointSegmentDistance: '7ae3664f58b4c4a6',
  segmentCrossing: '808d92a76f1deefa',
  segmentsIntersect: '9401232e154f3b6d',
  segmentDistance: '7075a83ab17f3a85',
  isConvex: '4dbf12bd6fb24442',
  shrinkRing: '1d2e5ad81c784aea',
  circleSegments: '61df6384d625b4b7',
  circle: 'ebba8f7d4f7a75fc',
  arc: '6f2def3ab076f249',
  regularPolygon: '2fd95c084484a7c7',
  hexagon: '1c2f6e3b9a868bdd',
  rect: '7cf1ee7712c540f2',
  roundedRect: 'e09c63f52ed7daa4',
  slot: '745bfaff0c790f73',
  star: 'f6f37288aaf696ad',
  seg: '1fa744a9ac3f4f6b',
  nestRings: '966b4187773d85c4',
  poleOf: 'cd7df02965612c8a',
  insideUnion: '2543d435b15a88ef',
  rectRing: 'c2b5a976e642586c',
};

// ---- 1. the moved functions, pinned

const got = digests(S as unknown as ShapeApi);
for (const [name, want] of Object.entries(PINNED)) ok(got[name] === want, `${name}: ${got[name]} (pinned ${want})`);
ok(Object.keys(got).length === Object.keys(PINNED).length, `every function the corpus runs is pinned (${Object.keys(got).length})`);

// ---- 2. a rounded rectangle placed by its centre

const same = (a: [number, number][], b: [number, number][]) => a.length === b.length && a.every((p, i) => Object.is(p[0], b[i]![0]) && Object.is(p[1], b[i]![1]));
/** A rectangle built from its corners, the way an app with its own builder writes one. */
function byCorners(x0: number, y0: number, x1: number, y1: number, r: number, seg: number): [number, number][] {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (rr === 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const out: [number, number][] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  return out;
}
for (const [w, h, r, seg] of [[20, 10, 3, 10], [57.3, 41.9, 2, 8], [0.7, 0.3, 0.1, 4], [12, 8, 0, 8], [100, 64.2, 1, 8]] as const) {
  ok(same(S.roundedRectRing(w, h, r, seg, [0, 0]), S.roundedRectRing(w, h, r, seg)), `${w} x ${h}: at the origin is the centred ring, to the bit`);
  ok(same(S.roundedRectRing(w, h, r, seg, [w / 2, h / 2]), byCorners(0, 0, w, h, r, seg)), `${w} x ${h}: a box from the origin lands on the corner builder's numbers, to the bit`);
  const moved = S.roundedRectRing(w, h, r, seg, [13.1, -7.7]);
  const shifted = S.roundedRectRing(w, h, r, seg).map(([x, y]) => [x + 13.1, y - 7.7]);
  ok(moved.every((p, i) => Math.abs(p[0] - shifted[i]![0]) < 1e-12 && Math.abs(p[1] - shifted[i]![1]) < 1e-12), `${w} x ${h}: anywhere else it is the centred ring moved there`);
}
{
  const [x0, y0] = S.roundedRectRing(10, 4, 0, 8, [5, 2])[0]!;
  ok(x0 === 0 && y0 === 0, 'square corners: the first corner is exactly the box corner');
}

// ---- 3. the box of some rings, with its size

{
  const b = S.ringBox([[[1, 2], [4, -1], [3, 5]], [[-2, 0]]]);
  ok(b.minX === -2 && b.minY === -1 && b.maxX === 4 && b.maxY === 5 && b.w === 6 && b.h === 6, `two rings: ${JSON.stringify(b)}`);
  const one = S.ringBox([[[0.1, 0.2], [0.7, 0.3]]]);
  ok(one.w === 0.7 - 0.1 && one.h === 0.3 - 0.2, 'w and h are max minus min, as every hand-written copy computes them');
  const none = S.ringBox([]);
  ok(none.minX === Infinity && none.maxX === -Infinity && !Number.isFinite(none.w), 'no points: an empty box, not a zero one');
  const empty = S.ringBox([[]]);
  ok(!Number.isFinite(empty.minX), 'an empty ring is no points too');
  const shapes: [number, number][][][] = [[[[0, 0], [3, 0], [3, 2]], [[1, 0.5], [2, 0.5], [2, 1]]], [[[5, 5], [6, 5], [6, 7]]]];
  const viaRings = S.ringBox(shapes.flat());
  const viaIslands = S.bboxOf(shapes);
  ok(viaRings.minX === viaIslands.minX && viaRings.maxY === viaIslands.maxY, 'the same box bboxOf gives for the same points');
}

// ---- 4. a rectangle from two corners

{
  ok(same(S.rectRing(1.5, -2, 7.25, 3), [[1.5, -2], [7.25, -2], [7.25, 3], [1.5, 3]]), 'rectRing: the corners as given, from (x0, y0) round to (x0, y1)');
  ok(S.signedArea(S.rectRing(0, 0, 4, 3)) === 12, 'rectRing: lower-left to upper-right runs counter-clockwise');
  for (const [cx, cy, w, h] of [[0, 0, 10, 6], [-3.3, 2.2, 0.1, 1e3], [13.1, -7.7, 57.3, 41.9]] as const) {
    ok(same(S.rectRing(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), S.rect(cx, cy, w, h)), `${w} x ${h} at (${cx}, ${cy}): rect's corners, worked out the same way, are rectRing's, to the bit`);
  }
}

console.log(`${checks - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
