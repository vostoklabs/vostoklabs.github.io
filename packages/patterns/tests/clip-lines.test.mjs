// Clipping lines as lines: `clipShapesToLines`, `clipPolylines` and `lineLength` from
// `@vostok/patterns/clip`, the way a laser host clips a score layer to its plate and draws the
// seams of a welded word. Pure JS, so no manifold and no browser:
//   node tests/clip-lines.test.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
mkdirSync(`${here}.cache`, { recursive: true });

const libFile = `${here}.cache/clip-lines-${process.pid}.mjs`;
await esbuild({
  stdin: {
    contents: [
      `export * from '../src/clip.ts';`,
      `export { circleRing, bboxOf } from '@vostok/shapes';`,
    ].join('\n'),
    resolveDir: here,
    loader: 'ts',
  },
  outfile: libFile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
});
const { clipPolylines, clipShapesToLines, lineLength, circleRing, bboxOf } = await import(`file://${libFile}?t=${Date.now()}`);

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`);
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const square = (w, cx = 0, cy = 0) => [[cx - w / 2, cy - w / 2], [cx + w / 2, cy - w / 2], [cx + w / 2, cy + w / 2], [cx - w / 2, cy + w / 2]];
const disc = (r, cx = 0, cy = 0) => circleRing(cx, cy, r, 180);
/** How a laser host clips: steps of no length dropped first (a font's rounding leaves them). */
const LINES = { compact: true };

// 1. A square ring clipped by a smaller square: four segments in, none on material.
{
  const r = clipShapesToLines([[square(20)]], [[square(10)]], LINES);
  check('a square clipped by a smaller square keeps nothing', r.shapes.length === 0 && r.paths.length === 0, `${r.shapes.length} rings, ${r.paths.length} paths`);
}

// 2. A ring wholly inside stays a CLOSED ring: a coaster's rules when nothing was punched out.
{
  const r = clipShapesToLines([[square(10)]], [[square(20)]], LINES);
  check('a ring wholly inside comes back closed', r.shapes.length === 1 && r.paths.length === 0, `${r.shapes.length} rings, ${r.paths.length} paths`);
  check('and it is the ring it was given, point for point', r.shapes[0][0].length === 4, `${r.shapes[0]?.[0]?.length} points`);
  check('its length is the perimeter, closing segment included', near(lineLength(r.shapes), 40, 1e-6), `${lineLength(r.shapes).toFixed(4)} mm`);
}

// 3. Two overlapping circles: each ring keeps the arc inside the other, and the two arcs are the
//    lens boundary. The endpoints are the crossings, which for r = 10 at ±6 are (0, ±8).
{
  const A = disc(10, -6, 0);
  const B = disc(10, 6, 0);
  const a = clipShapesToLines([[A]], [[B]], LINES);
  const b = clipShapesToLines([[B]], [[A]], LINES);
  check('each circle keeps ONE open arc inside the other', a.paths.length === 1 && b.paths.length === 1 && !a.shapes.length && !b.shapes.length, `${a.paths.length}/${b.paths.length} paths`);
  const ends = [a.paths[0][0], a.paths[0][a.paths[0].length - 1]];
  check('the arc starts and ends on the crossings', ends.every(([x, y]) => near(x, 0, 0.2) && near(Math.abs(y), 8, 0.2)), JSON.stringify(ends));
  check('the arcs end on opposite crossings', ends[0][1] * ends[1][1] < 0, JSON.stringify(ends));
  const inB = a.paths[0].every(([x, y]) => Math.hypot(x - 6, y) <= 10 + 1e-6);
  check('every point of the arc lies inside the other circle', inB);
  const box = bboxOf([[a.paths[0]]]);
  check('the lens boundary spans the crossings, not the whole circle', near(box.maxY - box.minY, 16, 0.3) && box.maxX <= 4.01, JSON.stringify(box));
}

// 4. A score ring over a plate that has had letter-shaped holes punched out of it comes back as
//    ARCS, not as a polygon intersection's slivers.
{
  const plate = [[square(60), square(8, -20, 0), square(8, 20, 0)]];
  const ring = [[disc(20)]];
  const r = clipShapesToLines(ring, plate, LINES);
  check('a ring over a holed plate comes back as open arcs', r.paths.length === 2 && r.shapes.length === 0, `${r.paths.length} paths, ${r.shapes.length} rings`);
  const onMaterial = r.paths.flat().every(([x, y]) => Math.abs(x) <= 30 && Math.abs(y) <= 30 && !(Math.abs(y) < 4 && (Math.abs(x + 20) < 4 || Math.abs(x - 20) < 4)));
  check('no kept point lies in one of the holes', onMaterial);
  check('most of the ring survives', lineLength([], r.paths) > 0.6 * lineLength(ring), `${lineLength([], r.paths).toFixed(1)} of ${lineLength(ring).toFixed(1)} mm`);
}

// 5. An OPEN polyline is clipped as one: in, out, in again gives two runs, in order.
{
  const line = [[[-30, 0], [30, 0]]];
  const polys = [[square(10, -15, 0)], [square(10, 15, 0)]];
  const runs = clipPolylines(line, polys, LINES);
  check('an open line crossing two islands keeps two runs', runs.length === 2, `${runs.length} runs`);
  check('each run spans exactly the island it is in', runs.every((r) => near(Math.abs(r[r.length - 1][0] - r[0][0]), 10, 1e-6)), JSON.stringify(runs));
  check('the runs come back in order along the line', runs[0][0][0] < runs[1][0][0]);
  const none = clipPolylines(line, [[square(10, 0, 40)]], LINES);
  check('a line nowhere near the polygons keeps nothing', none.length === 0, `${none.length} runs`);
}

// 6. Nothing to clip to, and nothing to clip: neither throws.
{
  check('no polygons keeps nothing', clipPolylines([[[0, 0], [1, 1]]], [], LINES).length === 0);
  check('no lines is empty, not a crash', clipShapesToLines([], [[square(10)]], LINES).paths.length === 0);
  check('a degenerate ring is dropped', clipShapesToLines([[[[1, 1]]]], [[square(10)]], LINES).paths.length === 0);
}

// 7. A REPEATED POINT is not a gap. Glyph contours come out of the font rounded to three
//    decimals, so a curve's control points land on top of each other; a step of no length has no
//    midpoint to test, the walk read the empty answer as "off material", and a scored word lying
//    entirely on the card came back as a string of open runs where closed rings were wanted, the
//    laser lifting its head once per path.
{
  const dup = [[-5, -5], [5, -5], [5, -5], [5, 5], [-5, 5], [-5, 5]];
  const r = clipShapesToLines([[dup]], [[square(20)]], LINES);
  check('a ring with duplicated vertices stays ONE closed ring', r.shapes.length === 1 && r.paths.length === 0, `${r.shapes.length} rings, ${r.paths.length} paths`);
  check('...and the duplicates are gone from it', r.shapes[0]?.[0]?.length === 4, `${r.shapes[0]?.[0]?.length} points`);
  check('...and it still measures its own perimeter', near(lineLength(r.shapes), 40, 1e-6), `${lineLength(r.shapes).toFixed(4)} mm`);
  // A ring written with its first point repeated at the end, the other way a closing step comes
  // out zero-length, is the same ring.
  const closed = [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]];
  const rc = clipShapesToLines([[closed]], [[square(20)]], LINES);
  check('a ring that repeats its first point at the end is still one closed ring', rc.shapes.length === 1 && rc.paths.length === 0, `${rc.shapes.length} rings, ${rc.paths.length} paths`);
  // And a ring the plate REALLY cuts still splits, duplicates or not: half of the square is off
  // the material, so what survives is open.
  const half = clipShapesToLines([[dup]], [[square(20, 0, 10)]], LINES);
  check('a ring the plate really cuts still comes back open', half.shapes.length === 0 && half.paths.length === 1, `${half.shapes.length} rings, ${half.paths.length} paths`);
  check('...keeping only the half that is on material', half.paths[0].every(([, y]) => y >= -1e-6), JSON.stringify(half.paths[0]));
  // An open polyline with a repeated point is one run, not two.
  const runs = clipPolylines([[[-8, 0], [0, 0], [0, 0], [8, 0]]], [[square(20)]], LINES);
  check('an open line with a repeated point keeps ONE run', runs.length === 1, `${runs.length} runs`);
  check('...spanning the whole line', near(runs[0][0][0], -8) && near(runs[0][runs[0].length - 1][0], 8), JSON.stringify(runs[0]));
}

// 8. Overlapping islands. Even-odd reads the stretch two islands both cover as off material (a
//    point under both toggles twice); `union` reads it as on, which is what the letters of a welded
//    word are before they are unioned. A hole still reads as a hole.
{
  const islands = [[square(20, -6, 0)], [square(20, 6, 0)]];
  const line = [[[-30, 0], [30, 0]]];
  const evenOdd = clipPolylines(line, islands, LINES);
  const union = clipPolylines(line, islands, { ...LINES, union: true });
  check('even-odd: the overlap splits the line into two runs', evenOdd.length === 2, `${evenOdd.length} runs`);
  check('union: one run across both islands', union.length === 1 && near(union[0][0][0], -16) && near(union[0][union[0].length - 1][0], 16), JSON.stringify(union));
  const ring = [[square(6)]];
  check('even-odd: a ring in the overlap is off material', clipShapesToLines(ring, islands, LINES).shapes.length === 0);
  check('union: a ring in the overlap stays one closed ring', clipShapesToLines(ring, islands, { ...LINES, union: true }).shapes.length === 1);
  const holed = [[square(20, -6, 0), square(4, -12, 0)], [square(20, 6, 0)]];
  const runs = clipPolylines(line, holed, { ...LINES, union: true });
  check('union: a hole of one island still cuts the line', runs.length === 2 && runs.some((r) => near(r[r.length - 1][0], -14)), JSON.stringify(runs));
  check('union off is the clip as it was', JSON.stringify(clipPolylines(line, islands, { ...LINES, union: false })) === JSON.stringify(evenOdd));
}

// 9. lineLength: a ring is measured closed, a path as drawn.
{
  check('a ring counts its closing step', near(lineLength([[square(10)]]), 40));
  check('a path does not', near(lineLength([], [square(10)]), 30));
  check('nothing measures nothing', lineLength([]) === 0 && lineLength([[[[1, 1]]]]) === 0);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  · ${f}`);
  process.exit(1);
}
