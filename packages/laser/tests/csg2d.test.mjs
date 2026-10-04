// @vostok/laser's 2D CSG held to what manifold actually does, on both builds: the npm one the
// tests use and the vendored no-eval one the apps ship.
//
// 1. A hole with every corner on its island's outline comes back a hole. manifold's
//    `decompose()` hands such a hole back as a part of its own with NEGATIVE area, and `fromCS`
//    dropped it: uroko's scales cut out of a card came back as wood. The fixture is uroko's own
//    lattice — upward triangles meeting only at their corners — cut to a box.
// 2. The same hole on the path past 2 000 contours, where the islands are grouped by hand.
// 3. Nothing a boolean makes stays in the heap: the offset under `offsetShapes`' simplify, and
//    the rings manifold-3d 3.5.1's glue copies and never frees on the way in and out. Measured by
//    walking the allocator (heap-probe.mjs), so a leak shows to the byte.
// 4. `csOf` / `ringsOf` give exactly what the glue gives.
//
// Run: node tests/csg2d.test.mjs   (esbuild bundles the TS source under test)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureHeaps, heapInUse } from './heap-probe.mjs';

const heaps = captureHeaps();

const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}..`.split('\\').join('/');
const tmp = `${root}/tests/.tmp-csg2d`;
mkdirSync(tmp, { recursive: true });
const entry = `${tmp}/entry.mjs`;
writeFileSync(entry, [
  `export { withScope, toCS, fromCS, csOf, ringsOf, offsetShapes, unionShapes, subtractShapes, intersectShapes, applyKeyring } from '${root}/src/csg2d.ts';`,
  `export { signedArea, circleRing } from '${root}/src/rings.ts';`,
].join('\n') + '\n');
// Paths here contain a space, and `shell: true` on Windows re-splits the argv — so quote them.
execFileSync('npx', ['esbuild', `"${entry}"`, '--bundle', '--format=esm', '--platform=node', `"--outfile=${tmp}/bundle.mjs"`, '--log-level=error'], { shell: true, stdio: 'inherit' });
const L = await import(`file://${tmp}/bundle.mjs`);

const BUILDS = [
  ['npm', `${root}/node_modules/manifold-3d/manifold.js`],
  ['no-eval', `${root}/../manifold-noeval/manifold.js`],
];

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// ---- fixtures -------------------------------------------------------------
/** Uroko: the triangular lattice of side `s` with every upward triangle filled, `rows` rows of
 *  it, cut to a box `cols` triangles wide. The triangles meet only at their corners, so the wood
 *  between is one piece that touches itself at every corner, and each triangle it surrounds is a
 *  hole with all three corners on the wood's outline. */
function uroko(s, rows, cols) {
  const h = (s * Math.sqrt(3)) / 2;
  const scales = [];
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const x = k * s + ((r % 2) * s) / 2;
      scales.push([[[x, r * h], [x + s, r * h], [x + s / 2, (r + 1) * h]]]);
    }
  }
  const zone = [[[[-0.1 * s, 0], [(cols + 0.1) * s, 0], [(cols + 0.1) * s, rows * h], [-0.1 * s, rows * h]]]];
  return { zone, scales };
}

const material = (islands) => islands.reduce((sum, island) => sum + island.reduce((s, r, i) => s + (i === 0 ? 1 : -1) * Math.abs(L.signedArea(r)), 0), 0);
const holesIn = (islands) => islands.reduce((n, island) => n + island.length - 1, 0);
/** Even-odd, for "is this hole inside its own island's outer ring" — at an edge's middle, since
 *  the corners may sit on the outer. */
function inside(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const holesAtHome = (islands) => islands.every(([outer, ...holes]) => holes.every((h) => inside(outer, (h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2)));

for (const [name, file] of BUILDS) {
  const Module = (await import(pathToFileURL(file).href)).default;
  const wasm = await Module();
  wasm.setup();
  wasm.setMinCircularEdgeLength(0.15);
  wasm.setMinCircularAngle(3);
  const heap = heaps[heaps.length - 1];
  console.log(`\n== ${name} (${file.replace(/^.*vostok-labs-tools\//, '')})`);

  // ---- 1. a hole touching its outline at every corner ----------------------
  for (const [rows, cols] of [[3, 2], [3, 4]]) {
    const { zone, scales } = uroko(4, rows, cols);
    const tag = `${name}: uroko ${rows}×${cols}`;
    L.withScope((keep) => {
      const d = keep(L.toCS(wasm, zone, keep).subtract(L.toCS(wasm, scales, keep)));
      const parts = d.decompose().map((p) => keep(p));
      const strays = parts.filter((p) => p.area() < -0.01).length;
      // If a later manifold places these holes itself, this fixture no longer reaches the fix.
      check(`${tag}: decompose() still hands a hole back as a part of its own (the fixture reaches the fix)`, strays > 0, `${strays} of ${parts.length} parts`);
      const truth = d.area();
      const want = L.ringsOf(d).filter((r) => L.signedArea(r) < 0).length;
      const out = L.fromCS(d, keep);
      check(`${tag}: fromCS keeps every hole`, holesIn(out) === want, `${holesIn(out)} of ${want}`);
      check(`${tag}: fromCS's material is manifold's own area`, Math.abs(material(out) - truth) < 1e-6, `${material(out).toFixed(4)} vs ${truth.toFixed(4)}`);
      check(`${tag}: each hole sits in its own island`, holesAtHome(out));
    });
    const out = L.subtractShapes(wasm, zone, scales);
    const expected = L.withScope((keep) => keep(L.toCS(wasm, zone, keep).subtract(L.toCS(wasm, scales, keep))).area());
    check(`${tag}: subtractShapes cuts every scale`, Math.abs(material(out) - expected) < 1e-6 && holesAtHome(out), `${material(out).toFixed(4)} vs ${expected.toFixed(4)} mm²`);
  }

  // ---- 2. the same holes past the decompose limit --------------------------
  {
    // 2 100 specks far off to one side push the contour count past 2 000.
    const specks = [];
    for (let i = 0; i < 2100; i++) {
      const x = 100 + (i % 50) * 2;
      const y = Math.floor(i / 50) * 2;
      specks.push([[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]]);
    }
    const past = (label, zone, cut) => {
      const out = L.withScope((keep) => {
        const d = keep(L.toCS(wasm, [...zone, ...specks], keep).subtract(L.toCS(wasm, cut, keep)));
        return { contours: d.numContour(), truth: d.area(), islands: L.fromCS(d, keep) };
      });
      check(`${name}: past ${out.contours} contours, ${label}`, Math.abs(material(out.islands) - out.truth) < 1e-6 && holesAtHome(out.islands), `${material(out.islands).toFixed(4)} vs ${out.truth.toFixed(4)} mm²`);
    };
    const { zone, scales } = uroko(4, 3, 2);
    past('a hole with all three corners on the outline stays a hole', zone, scales);
    // manifold starts this hole's ring on the corner it shares with the square, and a ray test
    // from exactly there read it as outside the square: the hole was dropped.
    past('a hole touching the outline\'s corner stays a hole', [[[[-10, 0], [0, 0], [0, 10], [-10, 10]]]], [[[[-10, 10], [-8, 6], [-6, 8]]]]);
  }

  // ---- 3. nothing stays in the heap ----------------------------------------
  const disc = [[L.circleRing(0, 0, 20, 400)]];
  const ring = [[L.circleRing(0, 0, 20, 400), L.circleRing(0, 0, 12, 300)]];
  const bar = [[[[-30, -3], [30, -3], [30, 3], [-30, 3]]]];
  const { zone, scales } = uroko(4, 3, 4);
  const many = [];
  for (let i = 0; i < 2100; i++) many.push([[[i * 2, 0], [i * 2 + 1, 0], [i * 2 + 1, 1], [i * 2, 1]]]);
  const ops = [
    ['unionShapes', () => L.unionShapes(wasm, [...ring, ...bar])],
    ['subtractShapes', () => L.subtractShapes(wasm, disc, bar)],
    ['intersectShapes', () => L.intersectShapes(wasm, ring, bar)],
    ['offsetShapes (grow)', () => L.offsetShapes(wasm, ring, 1.5)],
    ['offsetShapes (shrink)', () => L.offsetShapes(wasm, ring, -1.5)],
    ['subtractShapes, holes touching at their corners', () => L.subtractShapes(wasm, zone, scales)],
    ['unionShapes past 2 000 contours', () => L.unionShapes(wasm, many)],
    ['applyKeyring (a loop tab, welded and filleted)', () => L.applyKeyring(wasm, ring, [26, 0], { mode: 'outside', side: 'right', along: 0.5, dia: 4, ring: 2.5 })],
    ['csOf + ringsOf', () => L.withScope((keep) => L.ringsOf(keep(L.csOf(wasm, ring.flat(), 'EvenOdd'))))],
  ];
  for (const [label, run] of ops) {
    for (let i = 0; i < 3; i++) run();
    const before = heapInUse(heap);
    const N = 25;
    for (let i = 0; i < N; i++) run();
    const grew = heapInUse(heap) - before;
    check(`${name}: ${label} leaves nothing in the heap`, Number.isFinite(grew) && grew <= 0, Number.isFinite(grew) ? `${(grew / N).toFixed(0)} B a call` : 'heap probe could not read the allocator — update heap-probe.mjs');
  }

  // ---- 4. csOf / ringsOf are the glue, less the leak --------------------------
  const rings = [L.circleRing(0, 0, 20, 64), L.circleRing(0, 0, 12, 48), L.circleRing(30, 0, 5, 32), L.circleRing(5, 0, 10, 40)];
  for (const rule of ['Positive', 'EvenOdd', 'NonZero', 'Negative']) {
    L.withScope((keep) => {
      const glue = keep(new wasm.CrossSection(rings, rule));
      const ours = keep(L.csOf(wasm, rings, rule));
      check(`${name}: csOf(${rule}) is the glue's CrossSection`, JSON.stringify(glue.toPolygons()) === JSON.stringify(ours.toPolygons()));
      check(`${name}: ringsOf(${rule}) is the glue's toPolygons()`, JSON.stringify(L.ringsOf(glue)) === JSON.stringify(glue.toPolygons()));
    });
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(1);
}
