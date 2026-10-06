/*
  A fixed corpus of rings, islands, points and parameters, and every shape-maths function run
  over it, each function's answers reduced to one sha256.

  The functions here lived in two packages until they moved into this one: the laser engine's
  ring maths and the pattern engine's geometry. The digests in pins.test.ts were taken from those
  two files as they were, so the same corpus run through this package proves every moved function
  answers exactly as before, to the last bit. `digests` takes the functions as an argument so the
  same corpus can be run through any door that hands them out.
*/
import { createHash } from 'node:crypto';

type Pt = [number, number];
type Ring = Pt[];
type Shapes = Ring[][];
interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** Every function the corpus runs, under the names this package gives them. */
export interface ShapeApi {
  // from the laser engine's ring maths
  signedArea(ring: Ring): number;
  bboxOf(shapes: Shapes): Box;
  mapShapes(shapes: Shapes, fn: (p: Pt) => Pt): Shapes;
  centreShapes(shapes: Shapes): { shapes: Shapes; dx: number; dy: number };
  placeShapes(shapes: Shapes, x: number, y: number, deg: number): Shapes;
  mirrorX(shapes: Shapes): Shapes;
  simplifyRing(ring: Ring, tol: number): Ring;
  circleRing(cx: number, cy: number, r: number, n?: number): Ring;
  roundedRectRing(w: number, h: number, r: number, seg?: number): Ring;
  teardropRing(w: number, h: number, n?: number): Ring;
  dogTagRing(w: number, h: number): Ring;
  cancelCoincidentRings(rings: Ring[]): Ring[];
  islandsFromContours(contours: number[][][]): Shapes;
  filletRing(pts: Pt[], radii: number[]): Ring;
  // from the pattern engine's geometry
  TAU: number;
  SQRT3: number;
  signedAreaClosingFirst(ring: Ring): number;
  ringLength(points: Pt[], closed: boolean): number;
  bboxOfPoints(points: Pt[]): Box;
  bboxOfShapes(shapes: Shapes): Box;
  boxValid(b: Box): boolean;
  boxCentre(b: Box): Pt;
  pointInRing(p: Pt, ring: Ring): boolean;
  insideShapes(shapes: Shapes, p: Pt): boolean;
  pointSegmentDistance(p: Pt, a: Pt, b: Pt): number;
  segmentCrossing(a: Pt, b: Pt, c: Pt, d: Pt): number | null;
  segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean;
  segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number;
  isConvex(ring: Ring): boolean;
  shrinkRing(ring: Ring, k: number): Ring;
  circleSegments(r: number): number;
  circle(cx: number, cy: number, r: number, n?: number): Ring;
  arc(cx: number, cy: number, r: number, a0: number, a1: number, n?: number): Pt[];
  regularPolygon(cx: number, cy: number, r: number, n: number, rot?: number): Ring;
  hexagon(cx: number, cy: number, acrossFlats: number): Ring;
  rect(cx: number, cy: number, w: number, h: number): Ring;
  roundedRect(cx: number, cy: number, w: number, h: number, r: number): Ring;
  slot(cx: number, cy: number, l: number, w: number): Ring;
  star(cx: number, cy: number, points: number, rOuter: number, rInner: number, rot?: number): Ring;
  seg(a: Pt, b: Pt): Pt[];
  nestRings(rings: Ring[]): Shapes;
  poleOf(ring: Ring, precision?: number, holes?: Ring[], enough?: number): { at: Pt; radius: number };
  // from the laser studio
  insideUnion(shapes: Shapes, p: Pt): boolean;
  rectRing(x0: number, y0: number, x1: number, y1: number): Ring;
}

/** mulberry32: a small seeded generator, so the corpus is the same on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The corpus. Built fresh on each call, so no function can see another's mutations. */
export function corpus() {
  const rnd = prng(0x5eed2026);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rnd();
  const rings: Ring[] = [];

  // Star-shaped polygons: a jittered radius at each step, so most are concave. Several scales
  // and offsets, both windings.
  for (let k = 0; k < 40; k++) {
    const n = 3 + Math.floor(rnd() * 38);
    const scale = [0.01, 0.7, 3, 25, 140, 1000][k % 6]!;
    const cx = between(-2, 2) * scale * (k % 5);
    const cy = between(-2, 2) * scale * (k % 3);
    const ring: Ring = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = scale * between(0.35, 1);
      ring.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    rings.push(k % 2 ? ring.reverse() : ring);
  }
  // Exact shapes and awkward ones.
  rings.push(
    [[0, 0], [10, 0], [10, 6], [0, 6]], // a rectangle
    [[0, 0], [0, 6], [10, 6], [10, 0]], // the same, clockwise
    [[0, 0], [4, 0], [2, 3]], // a triangle
    [[0, 0], [1, 1], [2, 2], [3, 3]], // collinear: no area
    [[0, 0], [5, 0]], // two points
    [[1, 1]], // one point
    [], // none
    [[0, 0], [0, 0], [4, 0], [4, 0], [4, 4], [0, 4], [0, 4]], // repeated points
    [[0, 0], [4, 4], [4, 0], [0, 4]], // a bow tie
    [[1e6, 1e6], [1e6 + 3.3, 1e6], [1e6 + 3.3, 1e6 + 1.7], [1e6, 1e6 + 1.7]], // far from the origin
    [[0.1, 0.2], [0.3, 0.1], [0.7, 0.3], [0.6, 0.9], [0.2, 0.7]], // decimals that do not add up exactly
    [[-3, -3], [3, -3], [3, 3], [1, 3], [1, -1], [-1, -1], [-1, 3], [-3, 3]], // a U
  );

  // Islands: an outer ring, sometimes with holes cut from smaller copies, sometimes several.
  const shrunk = (r: Ring, k: number, back = false): Ring => {
    let cx = 0;
    let cy = 0;
    for (const [x, y] of r) { cx += x / r.length; cy += y / r.length; }
    const out = r.map(([x, y]): Pt => [cx + (x - cx) * k, cy + (y - cy) * k]);
    return back ? out.reverse() : out;
  };
  const shapes: Shapes[] = [
    [],
    [[rings[0]!]],
    [[rings[1]!, shrunk(rings[1]!, 0.3, true)]],
    [[rings[2]!], [rings[3]!, shrunk(rings[3]!, 0.5, true), shrunk(rings[3]!, 0.2)]],
    [[rings[40]!, shrunk(rings[40]!, 0.5, true)], [rings[42]!]],
    rings.slice(4, 14).map((r) => [r]),
    [[rings[49]!], [rings[50]!], [rings[51]!]],
    [[]],
  ];

  // Points to probe with: random ones about each ring's box, its vertices and edge midpoints.
  const probes = (r: Ring): Pt[] => {
    if (!r.length) return [[0, 0]];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const out: Pt[] = [];
    for (let i = 0; i < 12; i++) out.push([minX - 0.1 * w + 1.2 * w * rnd(), minY - 0.1 * h + 1.2 * h * rnd()]);
    out.push(r[0]!, r[Math.floor(r.length / 2)]!);
    const a = r[0]!;
    const b = r[1 % r.length]!;
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    return out;
  };

  // Segments for the segment tests: random, touching, parallel, collinear and of no length.
  const segs: [Pt, Pt][] = [];
  for (let i = 0; i < 60; i++) segs.push([[between(-10, 10), between(-10, 10)], [between(-10, 10), between(-10, 10)]]);
  segs.push([[0, 0], [10, 0]], [[0, 1], [10, 1]], [[2, 0], [8, 0]], [[5, -5], [5, 5]], [[3, 3], [3, 3]], [[10, 0], [20, 0]], [[0, 0], [1e-10, 0]]);

  // Dense noisy rings for the simplifier and the pole finder.
  const dense: Ring[] = [];
  for (let k = 0; k < 6; k++) {
    const n = [24, 63, 64, 65, 200, 400][k]!;
    const r = 5 + 20 * rnd();
    const ring: Ring = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const wobble = k % 2 ? 0.3 * Math.sin(7 * t) : 0.02 * (rnd() - 0.5);
      ring.push([(r + r * wobble) * Math.cos(t), (r + r * wobble) * Math.sin(t)]);
    }
    dense.push(ring);
  }

  // Contours the way a font hands them over: outlines one way, counters the other, and the
  // awkward ones: a bar drawn as its own contour the same way as its legs (an "A"), a figure
  // eight, and the same circle drawn twice in opposite directions (a Material smiley).
  const sq = (x0: number, y0: number, x1: number, y1: number, ccw = true): number[][] =>
    ccw ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
  const loop = (cx: number, cy: number, r: number, n: number, ccw = true): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 * (ccw ? 1 : -1);
      out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    return out;
  };
  const contours: number[][][][] = [
    [sq(0, 0, 10, 10), sq(3, 3, 7, 7, false)], // an "o"
    [sq(0, 0, 10, 10), sq(3, 3, 7, 7, true)], // more material inside, same winding
    [loop(0, 0, 10, 24), loop(0, 0, 6, 24, false), loop(0, 0, 3, 24, true)], // nested three deep
    [sq(0, 0, 2, 10), sq(8, 0, 10, 10), sq(1, 4, 9, 6)], // legs and a bar, all one way
    [loop(0, 5, 4, 20), loop(0, 5, 2, 20, false), loop(0, -4, 5, 20), loop(0, -4, 2.5, 20, false)], // an eight
    [loop(0, 0, 8, 32), loop(0, 0, 6, 32, false), loop(0, 0, 6, 32, true), loop(-2, 2, 1, 12), loop(2, 2, 1, 12)], // a smiley drawn twice
    [sq(0, 0, 1, 1), [[0, 0], [1, 1]], []], // a contour too short to be a ring
    [...rings.slice(0, 8).map((r) => r.map(([x, y]) => [x, y]))],
  ];

  // Coincident rings: a ring with its reverse, a copy started elsewhere, three copies.
  const rot = (r: Ring, k: number): Ring => r.slice(k).concat(r.slice(0, k));
  const coincident: Ring[][] = [
    [rings[0]!, [...rings[0]!].reverse()],
    [rings[1]!, rot(rings[1]!, 2), rings[2]!],
    [rings[3]!, rings[3]!, rings[3]!],
    [rings[4]!, [...rings[4]!, rings[4]![0]!]],
    rings.slice(0, 6),
    [rings[40]!],
  ];

  return { rings, shapes, probes, segs, dense, contours, coincident };
}

/** JSON that keeps what plain JSON loses: -0, the infinities and NaN. */
const exact = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === 'number' ? (Object.is(x, -0) ? '-0' : Number.isFinite(x) ? x : String(x)) : x));
const sha = (v: unknown): string => createHash('sha256').update(exact(v)).digest('hex').slice(0, 16);

/** Each function's answers over the corpus, as one digest per function. */
export function digests(api: ShapeApi): Record<string, string> {
  const out: Record<string, string> = {};
  const pin = (name: string, run: (c: ReturnType<typeof corpus>) => unknown) => {
    out[name] = sha(run(corpus()));
  };
  const affine = ([x, y]: Pt): Pt => [x * 1.7 - y * 0.3 + 4.1, x * 0.2 + y * 0.9 - 2.3];

  pin('signedArea', (c) => [...c.rings, ...c.dense].map((r) => api.signedArea(r)));
  pin('bboxOf', (c) => c.shapes.map((s) => api.bboxOf(s)));
  pin('mapShapes', (c) => c.shapes.map((s) => api.mapShapes(s, affine)));
  pin('centreShapes', (c) => c.shapes.map((s) => api.centreShapes(s)));
  pin('placeShapes', (c) => c.shapes.flatMap((s) => [api.placeShapes(s, 0, 0, 0), api.placeShapes(s, 12.5, -3.25, 37), api.placeShapes(s, -1e3, 7, -90), api.placeShapes(s, 0.1, 0.2, 359.9)]));
  pin('mirrorX', (c) => c.shapes.map((s) => api.mirrorX(s)));
  pin('simplifyRing', (c) => [...c.dense, ...c.rings].flatMap((r) => [0, 0.001, 0.05, 0.5, 3].map((tol) => api.simplifyRing(r, tol))));
  pin('circleRing', () => [api.circleRing(0, 0, 10), api.circleRing(3, -4, 0.5, 12), api.circleRing(-100, 50, 33.3, 40), api.circleRing(0, 0, 0, 7), api.circleRing(1e5, 1e5, 2.5, 3)]);
  pin('roundedRectRing', () => [[20, 10, 3], [20, 10, 0], [20, 10, 50], [5, 30, 2.5, 4], [0.3, 0.2, 0.1, 1], [100, 100, 49.9, 16], [12, 8, -1]].map(([w, h, r, s]) => api.roundedRectRing(w!, h!, r!, s)));
  pin('teardropRing', () => [[20, 30], [20, 20], [20, 10], [7, 31, 36], [40, 41, 100], [1, 50, 8]].map(([w, h, n]) => api.teardropRing(w!, h!, n)));
  pin('dogTagRing', () => [[50, 28], [28, 50], [10, 10], [3.3, 1.1]].map(([w, h]) => api.dogTagRing(w!, h!)));
  pin('cancelCoincidentRings', (c) => c.coincident.map((set) => api.cancelCoincidentRings(set)));
  pin('islandsFromContours', (c) => c.contours.map((set) => api.islandsFromContours(set)));
  pin('filletRing', (c) => [
    api.filletRing([[0, 0], [10, 0], [10, 6], [0, 6]], [1, 2, 3, 0]),
    api.filletRing([[0, 0], [10, 0], [10, 6], [0, 6]], [100, 100, 100, 100]),
    api.filletRing([[-3, -3], [3, -3], [3, 3], [1, 3], [1, -1], [-1, -1], [-1, 3], [-3, 3]], [0.5, 0.5, 0.5, 0.2, 0.3, 0.3, 0.2, 0.5]),
    api.filletRing([[0, 0], [4, 0], [4, 0], [2, 3]], [1, 1, 1, 1]),
    ...c.rings.slice(0, 10).map((r, i) => api.filletRing(r, r.map((_, j) => ((i + j) % 4) * 0.4))),
  ]);

  pin('TAU', () => [api.TAU, api.SQRT3]);
  pin('signedAreaClosingFirst', (c) => [...c.rings, ...c.dense].map((r) => api.signedAreaClosingFirst(r)));
  pin('ringLength', (c) => [...c.rings, ...c.dense].flatMap((r) => [api.ringLength(r, false), api.ringLength(r, true)]));
  pin('bboxOfPoints', (c) => [...c.rings, ...c.dense].map((r) => api.bboxOfPoints(r)));
  pin('bboxOfShapes', (c) => c.shapes.map((s) => api.bboxOfShapes(s)));
  pin('boxValid', (c) => [...c.shapes.map((s) => api.bboxOfShapes(s)), { minX: 0, minY: 0, maxX: 0, maxY: 0 }, { minX: 1, minY: 0, maxX: 0, maxY: 1 }].map((b) => api.boxValid(b)));
  pin('boxCentre', (c) => c.shapes.map((s) => api.boxCentre(api.bboxOfShapes(s))));
  pin('pointInRing', (c) => c.rings.map((r) => c.probes(r).map((p) => api.pointInRing(p, r))));
  pin('insideShapes', (c) => c.shapes.map((s) => [...c.probes(s.flat()[0] ?? []), ...c.probes(s.flat()[1] ?? [])].map((p) => api.insideShapes(s, p))));
  pin('pointSegmentDistance', (c) => c.segs.flatMap(([a, b]) => c.segs.slice(0, 12).map(([p]) => api.pointSegmentDistance(p, a, b))));
  pin('segmentCrossing', (c) => c.segs.flatMap(([a, b]) => c.segs.slice(55).map(([p, q]) => api.segmentCrossing(a, b, p, q))));
  pin('segmentsIntersect', (c) => c.segs.flatMap(([a, b]) => c.segs.slice(40).map(([p, q]) => api.segmentsIntersect(a, b, p, q))));
  pin('segmentDistance', (c) => c.segs.flatMap(([a, b]) => c.segs.slice(48).map(([p, q]) => api.segmentDistance(a, b, p, q))));
  pin('isConvex', (c) => [...c.rings, ...c.dense].map((r) => api.isConvex(r)));
  pin('shrinkRing', (c) => c.rings.filter((r) => r.length).flatMap((r) => [api.shrinkRing(r, 0.5), api.shrinkRing(r, 1.1), api.shrinkRing(r, 0)]));
  pin('circleSegments', () => [-5, 0, 0.01, 0.5, 1, 3.3, 10, 28.6, 40, 1000].map((r) => api.circleSegments(r)));
  pin('circle', () => [api.circle(0, 0, 10), api.circle(3, -4, 0.5, 12), api.circle(-100, 50, 33.3), api.circle(0, 0, 0), api.circle(1e5, 1e5, 2.5, 3)]);
  pin('arc', () => [api.arc(0, 0, 10, 0, Math.PI), api.arc(1, 2, 3, -1, 2.5, 5), api.arc(0, 0, 50, Math.PI, -Math.PI / 3), api.arc(0, 0, 0.2, 0, 0.001)]);
  pin('regularPolygon', () => [api.regularPolygon(0, 0, 10, 3), api.regularPolygon(5, 5, 2, 7, 0.4), api.regularPolygon(-1, 2, 100, 64, -Math.PI)]);
  pin('hexagon', () => [api.hexagon(0, 0, 10), api.hexagon(3.3, -1.1, 0.7)]);
  pin('rect', () => [api.rect(0, 0, 10, 6), api.rect(-3.3, 2.2, 0.1, 1e3)]);
  pin('roundedRect', () => [[0, 0, 20, 10, 3], [5, -5, 20, 10, 0], [0, 0, 20, 10, 50], [1, 2, 5, 30, 2.5], [0, 0, 0.3, 0.2, 1e-7], [0, 0, 100, 100, 49.9]].map(([x, y, w, h, r]) => api.roundedRect(x!, y!, w!, h!, r!)));
  pin('slot', () => [api.slot(0, 0, 20, 4), api.slot(3, 4, 2, 6), api.slot(0, 0, 0.5, 0.5)]);
  pin('star', () => [api.star(0, 0, 5, 10, 4), api.star(2, 2, 7, 3, 1.5, 0), api.star(0, 0, 3, 1, 0.99, -1)]);
  pin('seg', () => [api.seg([0, 0], [1, 2]), api.seg([-1.5, 3], [1e9, -2])]);
  pin('nestRings', (c) => [
    api.nestRings(c.rings),
    api.nestRings(c.dense),
    api.nestRings([c.dense[0]!, shrinkFor(c.dense[0]!, 0.6), shrinkFor(c.dense[0]!, 0.3), shrinkFor(c.dense[0]!, 0.1)]),
    api.nestRings([c.rings[0]!, c.rings[0]!]),
    api.nestRings([]),
  ]);
  pin('poleOf', (c) => [
    ...c.dense.map((r) => api.poleOf(r)),
    ...c.dense.map((r) => api.poleOf(r, 0.5)),
    api.poleOf(c.dense[4]!, 0.02, [shrinkFor(c.dense[4]!, 0.4).reverse()]),
    api.poleOf(c.dense[5]!, 0.02, [], 2),
    ...c.rings.filter((r) => r.length >= 3).slice(0, 30).map((r) => api.poleOf(r)),
    api.poleOf([[0, 0], [1, 1], [2, 2]]),
  ]);
  // The islands as above, and three that overlap: a rectangle, a triangle on it, and the same
  // rectangle again the other way round, where even-odd and the union part company.
  pin('insideUnion', (c) => [
    ...c.shapes.map((s) => [...c.probes(s.flat()[0] ?? []), ...c.probes(s.flat()[1] ?? [])].map((p) => api.insideUnion(s, p))),
    [...c.probes(c.rings[40]!), ...c.probes(c.rings[42]!)].map((p) => api.insideUnion([[c.rings[40]!], [c.rings[42]!], [c.rings[41]!]], p)),
  ]);
  // Corners either way round, decimals, far from the origin, a box of no size, and signed zeros.
  pin('rectRing', () => [[0, 0, 10, 6], [10, 6, 0, 0], [-3.3, 2.2, 0.1, 1e3], [0.1, 0.2, 0.3, 0.7], [1e6, 1e6, 1e6 + 3.3, 1e6 + 1.7], [5, 5, 5, 5], [-0, 0, 0, -0]].map(([x0, y0, x1, y1]) => api.rectRing(x0!, y0!, x1!, y1!)));
  return out;
}

function shrinkFor(r: Ring, k: number): Ring {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of r) { cx += x / r.length; cy += y / r.length; }
  return r.map(([x, y]): Pt => [cx + (x - cx) * k, cy + (y - cy) * k]);
}
