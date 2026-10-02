/*
  The free Fit test preview: the ladder maths, the label text, the tab/label layout maths, and
  the real Manifold-backed piece builder (tab + flipped stem, unioned into one watertight body).

  Run from the repo root:

    node_modules/.bin/esbuild apps/keycap-generator/tests/fit-test.test.js \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --outfile=apps/keycap-generator/tests/.fit-test.mjs \
      && node apps/keycap-generator/tests/.fit-test.mjs

  `manifold-3d` stays external so node loads the npm WASM build itself.
*/
import Module from 'manifold-3d';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  computeFitTestLadder, fitTestLabel, computeTabLayout, computeRowLayout,
  buildFitTestPiece, buildFitTestRow,
  FIT_TEST_STEP_MM, FIT_TEST_STEP_OPTIONS, FIT_TEST_TAB_THICK_MM, FIT_TEST_MARGIN_MM,
  FIT_TEST_LABEL_BAND_MM, FIT_TEST_FONT_ID,
} from '../src/fitTest.js';
import { parseLetter } from '../src/letter.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ================================================================== pure: ladder
{
  const STEM_TOL_MIN = -0.4, STEM_TOL_MAX = 0.4;

  const mid = computeFitTestLadder(0, FIT_TEST_STEP_MM, STEM_TOL_MIN, STEM_TOL_MAX);
  check('a mid-range centre gives 5 evenly-stepped rungs',
    mid.length === 5 && mid.every((v, i) => i === 0 || near(v - mid[i - 1], FIT_TEST_STEP_MM)),
    JSON.stringify(mid));
  check('centred on 0, the middle rung IS 0', mid[2] === 0, JSON.stringify(mid));

  const hiClamp = computeFitTestLadder(0.4, FIT_TEST_STEP_MM, STEM_TOL_MIN, STEM_TOL_MAX);
  check('a centre pinned at the top clamp collapses to 3 unique rungs, not 5 with repeats',
    hiClamp.length === 3 && hiClamp[hiClamp.length - 1] === 0.4,
    JSON.stringify(hiClamp));

  const loClamp = computeFitTestLadder(-0.4, FIT_TEST_STEP_MM, STEM_TOL_MIN, STEM_TOL_MAX);
  check('a centre pinned at the bottom clamp collapses to 3 unique rungs',
    loClamp.length === 3 && loClamp[0] === -0.4,
    JSON.stringify(loClamp));

  const nearTop = computeFitTestLadder(0.38, FIT_TEST_STEP_MM, STEM_TOL_MIN, STEM_TOL_MAX);
  check('a centre 2 steps from the clamp drops exactly the duplicate, keeping the rest',
    nearTop.length === 4 && nearTop[nearTop.length - 1] === 0.4,
    JSON.stringify(nearTop));

  const dedupe = new Set(computeFitTestLadder(0.4, FIT_TEST_STEP_MM, STEM_TOL_MIN, STEM_TOL_MAX));
  check('no rung ever repeats', dedupe.size === computeFitTestLadder(0.4, FIT_TEST_STEP_MM, STEM_TOL_MIN, STEM_TOL_MAX).length);

  const clean = computeFitTestLadder(0.1, 0.05, STEM_TOL_MIN, STEM_TOL_MAX);
  check('rungs stay 2-decimal-clean for a centre that is itself a step multiple',
    clean.every((v) => near(Math.round(v * 100) / 100, v)), JSON.stringify(clean));
}

// ================================================================== the ladder mount.js actually uses
// Centred on the stepper, step picked by the user. At 0 with the default step the row is
// -0.20..+0.20 (what a real print showed was useful); the coarsest step still reaches both ends
// of the stepper's range, and the finest tunes around a value a first print found.
{
  check('the default ladder at 0 is -0.20, -0.10, 0, +0.10, +0.20',
    JSON.stringify(computeFitTestLadder(0, FIT_TEST_STEP_MM, -0.4, 0.4)) === JSON.stringify([-0.2, -0.1, 0, 0.1, 0.2]),
    JSON.stringify(computeFitTestLadder(0, FIT_TEST_STEP_MM, -0.4, 0.4)));
  check('the step options are 0.05, 0.10 and 0.20, and include the default',
    JSON.stringify(FIT_TEST_STEP_OPTIONS) === JSON.stringify([0.05, 0.1, 0.2]) && FIT_TEST_STEP_OPTIONS.includes(FIT_TEST_STEP_MM),
    JSON.stringify(FIT_TEST_STEP_OPTIONS));
  const coarse = computeFitTestLadder(0, 0.2, -0.4, 0.4);
  check('the coarsest step at 0 spans the whole stepper range', coarse[0] === -0.4 && coarse[4] === 0.4, JSON.stringify(coarse));
  const fine = computeFitTestLadder(0.1, 0.05, -0.4, 0.4);
  check('a fine step tunes around a found value (+0.10 by 0.05 is 0.00..+0.20)',
    JSON.stringify(fine) === JSON.stringify([0, 0.05, 0.1, 0.15, 0.2]), JSON.stringify(fine));
}

// ================================================================== pure: labels
{
  check('zero reads "0.00", no sign', fitTestLabel(0) === '0.00', fitTestLabel(0));
  check('negative zero is guarded to "0.00"', fitTestLabel(-0) === '0.00', fitTestLabel(-0));
  check('a value that rounds to zero is guarded too', fitTestLabel(0.001) === '0.00', fitTestLabel(0.001));
  check('positive gets a leading +', fitTestLabel(0.05) === '+0.05', fitTestLabel(0.05));
  check('negative gets a leading -', fitTestLabel(-0.05) === '-0.05', fitTestLabel(-0.05));
  check('always 2 decimals, even at the clamp', fitTestLabel(0.4) === '+0.40', fitTestLabel(0.4));
  check('the minus is a plain ASCII hyphen, not a typographic minus',
    fitTestLabel(-0.1).charCodeAt(0) === 0x2d, `code ${fitTestLabel(-0.1).charCodeAt(0)}`);
}

// ================================================================== pure: tab/label layout
{
  const stemW = 6, stemH = 6;
  const l = computeTabLayout(stemW, stemH, 2);
  const regionW = stemW + 2 * FIT_TEST_MARGIN_MM;
  const regionH = stemH + 2 * FIT_TEST_MARGIN_MM;
  check('tab width is the stem region when the label is narrower',
    near(l.tabW, regionW), `${l.tabW} vs region ${regionW}`);
  check('tab width follows the label when the label needs more room',
    near(computeTabLayout(stemW, stemH, 40).tabW, 43), String(computeTabLayout(stemW, stemH, 40).tabW));
  check('stem region and label band never overlap',
    near(l.yMin + FIT_TEST_LABEL_BAND_MM, -regionH / 2), `yMin ${l.yMin}, regionH ${regionH}`);
  check('label band sits centred in its own strip',
    near(l.labelCenterY, l.yMin + FIT_TEST_LABEL_BAND_MM / 2));
  check('tab height is the stem region plus the label band',
    near(l.tabH, regionH + FIT_TEST_LABEL_BAND_MM));

  const offsets1 = computeRowLayout([10]);
  check('a single piece sits centred on 0', near(offsets1[0], 0), JSON.stringify(offsets1));
  const offsets3 = computeRowLayout([10, 10, 10], 2);
  check('a row of equal tabs is centred and evenly gapped',
    near(offsets3[1], 0) && near(offsets3[0], -12) && near(offsets3[2], 12), JSON.stringify(offsets3));
  const offsetsUneven = computeRowLayout([10, 20], 4);
  check('an uneven row keeps a constant gap between edges',
    near((offsetsUneven[1] - offsetsUneven[0]) - (10 / 2 + 20 / 2), 4), JSON.stringify(offsetsUneven));
}

// ================================================================== Manifold-backed pieces
const api = await Module();
api.setup();

/** manifold.js's manifoldToGeom, minus this module's import of it (see fitTest.js's own header
 *  comment) — used here only to build a synthetic, already-welded test stem. */
function manifoldToBufferGeometry(man) {
  const m = man.getMesh();
  const np = m.numProp;
  const vp = m.vertProperties;
  const pos = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    pos[i * 3] = vp[i * np]; pos[i * 3 + 1] = vp[i * np + 1]; pos[i * 3 + 2] = vp[i * np + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  g.computeVertexNormals();
  return g;
}

// A synthetic stem: a plain 6x6x8mm box standing from Z=0 (the switch-facing open end) to
// Z=8 (the end that joins the cap crown). It doesn't need to look like a real cross socket —
// scaleStemComponentsXY treats it as one connected component either way, and Manifold's own
// cube() guarantees it comes out welded/indexed/watertight, same as a real converted stem.
const STEM_W = 6, STEM_H = 6, STEM_TALL = 8;
const stemCube = api.Manifold.cube([STEM_W, STEM_H, STEM_TALL], false)
  .translate([-STEM_W / 2, -STEM_H / 2, 0]);
const baseStemGeometry = manifoldToBufferGeometry(stemCube);
stemCube.delete();

const meta = { stemBbox: { min: [-STEM_W / 2, -STEM_H / 2, 0], max: [STEM_W / 2, STEM_H / 2, STEM_TALL] } };
const letterContour = (text) => parseLetter(text, FIT_TEST_FONT_ID, 6);
const deps = { api, baseStemGeometry, meta, letterContour };

{
  const piece = buildFitTestPiece(deps, 0);
  check('a well-formed piece unions into ONE watertight body', piece.watertight === true,
    JSON.stringify({ watertight: piece.watertight }));
  check('the watertight piece carries a real geometry, no fallback parts',
    !!piece.geometry && piece.geometry.positions.length > 0 && !piece.tabGeometry && !piece.stemGeometry);
  check('the piece rests on the plate: Z = 0', near(piece.pieceBBox.min[2], 0, 1e-4),
    JSON.stringify(piece.pieceBBox.min));
  check('the socket opens upward: the stem reaches above the tab top',
    piece.pieceBBox.max[2] > FIT_TEST_TAB_THICK_MM,
    `max Z ${piece.pieceBBox.max[2]} vs tab top ${FIT_TEST_TAB_THICK_MM}`);
  check('the label recess actually removed material', piece.recessVolume > 0, String(piece.recessVolume));
  check('the recess is not implausibly large', piece.recessVolume < piece.width * piece.depth * FIT_TEST_TAB_THICK_MM);
  check('the label reads "0.00" for zero tolerance', piece.label === '0.00', piece.label);
}

{
  // This synthetic stem is a solid box with no socket hole, so applyStemClearance (which
  // buildFitTestPiece now runs the stem through) reads it as a male STUB: growing clearance
  // (+tol, an easier push-on fit) means SHRINKING the peg, the mirror of a female socket's hole
  // growing — see stemClearance.js's own header comment for why the sign flips by kind.
  const zero = buildFitTestPiece(deps, 0);
  const loose = buildFitTestPiece(deps, 0.4);
  const tight = buildFitTestPiece(deps, -0.4);
  const widthOf = (p) => p.stemBBox.max[0] - p.stemBBox.min[0];
  check('zero tolerance reproduces the authored stem footprint exactly',
    near(widthOf(zero), STEM_W, 1e-4), `${widthOf(zero)} vs ${STEM_W}`);
  check('a positive tolerance shrinks a stub footprint (looser fit), by exactly the requested amount',
    near(widthOf(loose), STEM_W - 0.4, 1e-4), `${widthOf(loose)} vs ${STEM_W - 0.4}`);
  check('a negative tolerance grows a stub footprint (tighter fit), by exactly the requested amount',
    near(widthOf(tight), STEM_W + 0.4, 1e-4), `${widthOf(tight)} vs ${STEM_W + 0.4}`);
  check('so the ladder direction is right for a stub: tighter > as-designed > looser',
    widthOf(tight) > widthOf(zero) && widthOf(zero) > widthOf(loose));
}

{
  // A full row at the coarsest step, so its labels span the stepper range.
  const row = buildFitTestRow(deps, computeFitTestLadder(0, 0.2, -0.4, 0.4));
  check('a full row builds one piece per rung', row.length === 5, String(row.length));
  check('every rung in the row is watertight', row.every((p) => p.watertight), row.map((p) => p.watertight).join(','));
  const leftEdge = row[0].offsetX - row[0].width / 2;
  const rightEdge = row[row.length - 1].offsetX + row[row.length - 1].width / 2;
  check('the row is centred on X = 0 (its two outer edges are symmetric)',
    near(leftEdge, -rightEdge, 1e-6), `left ${leftEdge}, right ${rightEdge}`);
  check('adjacent pieces are gapped, not overlapping',
    row.every((p, i) => i === 0 || p.offsetX - row[i - 1].offsetX >= (p.width + row[i - 1].width) / 2 - 1e-6),
    JSON.stringify(row.map((p) => [p.offsetX, p.width])));
  check('labels read in ladder order, -0.40 to +0.40', row.map((p) => p.label).join(',') === '-0.40,-0.20,0.00,+0.20,+0.40',
    row.map((p) => p.label).join(','));
}

// ================================================================== real profiles, through the
// real integration: buildFitTestPiece's OWN output (not stemClearance.js's module, which
// tests/stem-clearance.test.js already measures directly) moves by the rung value at the stem's
// own grip surface, for a real MX-style socket and for Choc v1's stub.
{
  function weldPositions(geom, tol = 1e-3) {
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', geom.getAttribute('position').clone());
    if (geom.index) p.setIndex(geom.index.clone());
    return mergeVertices(p, tol);
  }
  function loadRealBaseStem(jsonPath) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const raw = new THREE.BufferGeometry();
    raw.setAttribute('position', new THREE.Float32BufferAttribute(data.stem.positions, 3));
    raw.setIndex(data.stem.indices);
    const welded = weldPositions(raw);
    const man = api.Manifold.ofMesh(new api.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(welded.getAttribute('position').array),
      triVerts: new Uint32Array(welded.getIndex().array),
    }));
    const baseStemGeometry = manifoldToBufferGeometry(man);
    man.delete();
    return { baseStemGeometry, meta: data.meta };
  }
  function polyBBox(poly) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY, w: maxX - minX };
  }
  function polyArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      a += x1 * y2 - x2 * y1;
    }
    return a / 2;
  }
  /** The grip contour at one Z-slice: a hole nested inside a larger outer boundary (a socket's
   *  own recess), or — with no nesting — the widest standalone island (a stub's own outer wall;
   *  taking the widest covers a multi-stem body like Choc's two side-by-side stubs, which never
   *  nest inside each other). */
  function gripMeasureAtSlice(polys) {
    const items = polys.map((poly) => ({ area: Math.abs(polyArea(poly)), bbox: polyBBox(poly) }));
    items.sort((a, b) => b.area - a.area);
    const outer = items[0];
    const holes = items.slice(1).filter((it) => (
      it.bbox.minX > outer.bbox.minX + 0.02 && it.bbox.maxX < outer.bbox.maxX - 0.02
      && it.bbox.minY > outer.bbox.minY + 0.02 && it.bbox.maxY < outer.bbox.maxY - 0.02
    ));
    if (holes.length) return { kind: 'socket', width: Math.max(...holes.map((h) => h.bbox.w)) };
    return { kind: 'stub', width: Math.max(...items.map((it) => it.bbox.w)) };
  }
  /** Slices the piece's OWN stem at its own mid-height (piece.stemBBox is already in the
   *  flipped/embedded frame buildFitTestPiece produced), well clear of the tab below it. */
  function gripMeasureOfPiece(piece) {
    const man = api.Manifold.ofMesh(new api.Mesh({
      numProp: 3,
      vertProperties: piece.geometry.positions,
      triVerts: piece.geometry.indices,
    }));
    const zMid = (piece.stemBBox.min[2] + piece.stemBBox.max[2]) / 2;
    const cs = man.slice(zMid);
    const polys = cs.toPolygons();
    cs.delete();
    man.delete();
    return gripMeasureAtSlice(polys);
  }

  const KEYCAPS_DIR = fileURLToPath(new URL('../public/keycaps', import.meta.url));
  const REAL_PROFILES = [
    { name: 'standard-profile/1u', file: `${KEYCAPS_DIR}/standard-profile/1u.json` },
    { name: 'choc-v1/1u', file: `${KEYCAPS_DIR}/choc-v1/1u.json` },
  ];
  for (const { name, file } of REAL_PROFILES) {
    const { baseStemGeometry, meta } = loadRealBaseStem(file);
    const realDeps = { api, baseStemGeometry, meta, letterContour };
    const zeroPiece = buildFitTestPiece(realDeps, 0);
    const zeroMeasure = gripMeasureOfPiece(zeroPiece);
    for (const tol of [-0.4, 0.4]) {
      const piece = buildFitTestPiece(realDeps, tol);
      check(`${name} tol=${tol}: fit-test piece is watertight`, piece.watertight, JSON.stringify(piece.watertight));
      if (!piece.watertight) continue;
      const measure = gripMeasureOfPiece(piece);
      const expectedDelta = measure.kind === 'socket' ? tol : -tol;
      const actualDelta = measure.width - zeroMeasure.width;
      check(`${name} tol=${tol}: the fit-test piece's own grip surface (${measure.kind}) moves by the rung value (+/-0.02mm)`,
        Math.abs(actualDelta - expectedDelta) < 0.02, `Δ=${actualDelta.toFixed(4)} vs expected=${expectedDelta}`);
    }
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nthe fit test ladder, labels, layout maths and Manifold-backed pieces all check out');
process.exit(failures ? 1 : 0);
