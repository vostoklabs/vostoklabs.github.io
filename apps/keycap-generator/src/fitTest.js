/**
 * The free "Fit test" preview: a row of small tabs, each with the switch stem standing straight
 * up out of it and its own tolerance number debossed into the tab beside the stem. Print the
 * row, press each stem onto a real switch, and read the number off the one that fits.
 *
 * Every geometry-shaped body lies flat, tab-down — the stem points UP, socket opening up —
 * because a plaque balanced on top of an unsupported post is a wall-less overhang the printer
 * cannot make. See the 180-degree stem flip in `buildFitTestPiece`.
 *
 * Everything here is either a pure function (the ladder, the label text, the tab/label layout
 * maths) or a function that takes its dependencies as arguments — the Manifold module, the
 * cap's authored stem, its `meta`, and a `letterContour` function that turns label text into
 * outline contours. None of it reaches into mount.js's closures, and none of it imports
 * `./manifold.js`: that file's `initManifold()` pulls in `manifold-3d/manifold.wasm?url`, a
 * Vite-only import specifier a plain Node + esbuild test bundle cannot resolve. Dependency
 * injection is what lets tests/fit-test.test.js drive the real geometry with nothing more than
 * `await Module(); api.setup();`.
 */
import { applyStemClearance } from './stemClearance.js';

// ---------------------------------------------------------------- tunables
// The step between rungs, picked by the user while Fit test is open (mount.js). The default is
// what a real print showed was useful: Ian, 2026-09-15, after a -0.40..+0.40 row, "0.4 is a bit
// drammatik, +0.10 and +0.20 mm should be enought, but i also want to give user a choice to fine
// tune it further". The ladder centres on the stepper, so 0.05 tunes around a value a first
// print found, and 0.20 at a centre of 0 still reaches both ends of the stepper's range.
export const FIT_TEST_STEP_OPTIONS = [0.05, 0.1, 0.2];
export const FIT_TEST_STEP_MM = 0.1;
export const FIT_TEST_RUNG_COUNT = 5;
export const FIT_TEST_MARGIN_MM = 2.0;       // stem-region margin around meta.stemBbox, per side
export const FIT_TEST_TAB_THICK_MM = 2.0;
export const FIT_TEST_LABEL_BAND_MM = 7.0;   // -Y band (facing the default camera) for the label
export const FIT_TEST_LABEL_EXTRA_MM = 3.0;  // label-width margin when the label sets tab width
export const FIT_TEST_LABEL_DEPTH_MM = 0.6;
export const FIT_TEST_GLYPH_HEIGHT_MM = 4.0;
export const FIT_TEST_SINK_MM = 0.2;         // how far the stem is sunk into the tab
export const FIT_TEST_GAP_MM = 3.0;          // gap between tabs along the row
// A typeface JSON built into letter.js's FONT_OPTIONS at module load (see BUILT_IN_FONTS) —
// unlike the bundled TTFs behind loadBundledFonts()'s async fetch, this is synchronously
// available the instant Fit test is pressed. Monospace, so every ladder digit lines up.
export const FIT_TEST_FONT_ID = 'droid-sans-mono-regular';

// ---------------------------------------------------------------- pure helpers

/**
 * The tolerance ladder: `count` rungs `stepMM` apart, centred on `center`, clamped to
 * [min, max] and rounded to 2 decimals.
 *
 * Each rung is clamped independently rather than the whole ladder shifted, so a centre near
 * either end of the range simply loses rungs off that side instead of bunching them all up
 * against it. The pre-clamp sequence is monotonic (stepMM > 0), so clamping can only ever
 * flatten a run at the two ends — de-duplicating ADJACENT values afterwards is therefore exact.
 */
export function computeFitTestLadder(center, stepMM, min, max, count = FIT_TEST_RUNG_COUNT) {
  const half = (count - 1) / 2;
  const raw = [];
  for (let i = 0; i < count; i++) {
    const v = Math.min(max, Math.max(min, center + (i - half) * stepMM));
    raw.push(Math.round(v * 100) / 100);
  }
  return raw.filter((v, i) => i === 0 || v !== raw[i - 1]);
}

/**
 * The debossed label for one rung: sign only when non-zero, always 2 decimals, a plain ASCII
 * hyphen (never the stepper readout's typographic minus, which most fonts don't carry), and
 * "-0" guarded so a value that rounds to zero always reads "0.00".
 */
export function fitTestLabel(tolMM) {
  const v = Math.round(tolMM * 100) / 100;
  const EPS = 1e-9;
  const sign = v > EPS ? '+' : v < -EPS ? '-' : '';
  const abs = Math.abs(v) < EPS ? 0 : Math.abs(v);
  return `${sign}${abs.toFixed(2)}`;
}

/**
 * One piece's tab footprint, in the piece's own local frame where the stem sits centred at
 * local (0, 0). Pure geometry maths — no Manifold, no THREE — so it gets its own test with no
 * WASM dependency.
 *
 * The label band sits on the -Y side (the side the default camera faces), adjacent to the stem
 * region rather than overlapping it, so the two can never collide. Tab width is whichever of
 * the stem region or the label needs more room.
 */
export function computeTabLayout(stemW, stemH, labelWidthMM) {
  const regionW = stemW + 2 * FIT_TEST_MARGIN_MM;
  const regionH = stemH + 2 * FIT_TEST_MARGIN_MM;
  const tabW = Math.max(regionW, labelWidthMM + FIT_TEST_LABEL_EXTRA_MM);
  const yMin = -regionH / 2 - FIT_TEST_LABEL_BAND_MM; // label band's far (-Y) edge
  const yMax = regionH / 2;                            // stem region's far (+Y) edge
  return { tabW, tabH: yMax - yMin, yMin, yMax, labelCenterY: yMin + FIT_TEST_LABEL_BAND_MM / 2 };
}

/** Tab widths, in row order -> each piece's X offset, the whole row centred on X = 0. */
export function computeRowLayout(widths, gapMM = FIT_TEST_GAP_MM) {
  const total = widths.reduce((s, w) => s + w, 0) + gapMM * Math.max(0, widths.length - 1);
  let x = -total / 2;
  const offsets = [];
  for (const w of widths) {
    offsets.push(x + w / 2);
    x += w + gapMM;
  }
  return offsets;
}

// ---------------------------------------------------------------- Manifold-backed geometry
//
// These three are deliberately small, local reimplementations of pieces of `./manifold.js`
// (geomToManifold / manifoldToGeom / extrudePrism) rather than imports of it: that file's
// `geomToManifold`/`manifoldToGeom` read a module-level `api` set once by `initManifold()`,
// and importing anything from that file drags in its top-level `manifold-3d/manifold.wasm?url`
// import, which only a Vite build can resolve. Taking `api` as a parameter instead is what
// keeps this module runnable in a plain Node test.

/** THREE.BufferGeometry (already indexed and welded — every geometry this module builds or
 *  receives is) -> a Manifold solid. */
function toManifold(api, geom) {
  const pos = geom.getAttribute('position');
  const idx = geom.getIndex();
  const mesh = new api.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(pos.array),
    triVerts: new Uint32Array(idx.array),
  });
  return api.Manifold.ofMesh(mesh);
}

/** Manifold solid -> plain typed-array geometry. Mirrors manifold.js's `manifoldToGeom` minus
 *  the THREE.BufferGeometry wrapping — mount.js does that part, since it already owns the
 *  `three` import and this module deliberately does not. */
function manifoldToPlainGeom(man) {
  const m = man.getMesh();
  const np = m.numProp;
  const vp = m.vertProperties;
  const positions = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    positions[i * 3] = vp[i * np];
    positions[i * 3 + 1] = vp[i * np + 1];
    positions[i * 3 + 2] = vp[i * np + 2];
  }
  return { positions, indices: new Uint32Array(m.triVerts) };
}

/** Flat 2D contours (as `letterContour` returns them) -> a vertical Manifold prism. */
function extrudeContoursLocal(api, contours, bottomZ, height) {
  const cs = new api.CrossSection(contours, 'NonZero');
  const solid = cs.extrude(height).translate([0, 0, bottomZ]);
  cs.delete();
  return solid;
}

/**
 * Build ONE fit-test piece: the stem at `tolMM`, standing up out of a flat tab debossed with
 * its own tolerance value, unioned into one watertight body.
 *
 * @param {object} deps
 * @param {object} deps.api  Manifold's initialized module ({Manifold, Mesh, CrossSection, ...})
 *   — the caller's own `initManifold()` result (see `getManifoldApi()` in manifold.js), or a
 *   Node test's own `await Module()`.
 * @param {*} deps.baseStemGeometry  The cap's authored stem at 0 tolerance — already a clean,
 *   welded, indexed THREE.BufferGeometry (or anything exposing the same `getAttribute`/
 *   `getIndex` shape).
 * @param {{stemBbox: {min:number[], max:number[]}}} deps.meta  The loaded keycap's `meta`.
 * @param {(text: string) => {contours: number[][][], box: {min:{x,y}, max:{x,y}},
 *   metrics: {capHeight: number}}} deps.letterContour  Turns label text into outline contours
 *   — `parseLetter` bound to the fit test's own font — so this module never has to know
 *   anything about fonts.
 * @param {number} tolMM
 */
export function buildFitTestPiece(deps, tolMM) {
  const { api, baseStemGeometry, meta, letterContour } = deps;
  const label = fitTestLabel(tolMM);
  const bbox = meta.stemBbox;
  const stemW = bbox.max[0] - bbox.min[0];
  const stemH = bbox.max[1] - bbox.min[1];
  const stemCenterX = (bbox.min[0] + bbox.max[0]) / 2;
  const stemCenterY = (bbox.min[1] + bbox.max[1]) / 2;
  const zMaxOrig = bbox.max[2]; // the end that joins the cap crown — flipped DOWN, into the tab
  const zMinOrig = bbox.min[2]; // the switch-facing open end — flipped UP

  // ---- the stem at this rung's tolerance, turned 180deg about X so its socket opens upward ----
  // applyStemClearance only moves the switch-gripping surface, so the Z range above (read
  // straight off meta, computed once when the profile was converted) is exactly where this
  // stem's vertices already sit.
  let pieceWatertight = true;
  let scaled = baseStemGeometry;
  if (Math.abs(tolMM) > 1e-4) {
    const result = applyStemClearance(api, baseStemGeometry, tolMM);
    if (result.watertight) {
      scaled = result.geometry;
    } else {
      pieceWatertight = false;
      console.warn(`Fit test piece ${label}: stem clearance was not watertight at tol ${tolMM} — using the unmodified stem.`);
    }
  }
  const srcPos = scaled.getAttribute('position').array;
  const srcIdx = scaled.getIndex().array;
  // 180deg about X: (x,y,z) -> (x,-y,-z). Then translate so the flipped closed end (originally
  // zMaxOrig) lands `FIT_TEST_SINK_MM` below the tab's top face, embedded for a clean union.
  const tz = FIT_TEST_TAB_THICK_MM - FIT_TEST_SINK_MM + zMaxOrig;
  const stemPos = new Float32Array(srcPos.length);
  for (let i = 0; i < srcPos.length; i += 3) {
    stemPos[i] = srcPos[i] - stemCenterX;
    stemPos[i + 1] = stemCenterY - srcPos[i + 1];
    stemPos[i + 2] = tz - srcPos[i + 2];
  }
  if (scaled !== baseStemGeometry) scaled.dispose?.();
  const stemM = api.Manifold.ofMesh(new api.Mesh({
    numProp: 3,
    vertProperties: stemPos,
    triVerts: new Uint32Array(srcIdx),
  }));
  const stemBBox = stemM.boundingBox();

  // ---- the label, sized off the font's own measured cap height — never the text's own
  // (much wider) bounding box, which is what `transformContours` scales elsewhere ----
  const letter = letterContour(label);
  const glyphScale = FIT_TEST_GLYPH_HEIGHT_MM / letter.metrics.capHeight;
  const glyphCX = (letter.box.min.x + letter.box.max.x) / 2;
  const glyphCY = (letter.box.min.y + letter.box.max.y) / 2;
  const labelWidthMM = (letter.box.max.x - letter.box.min.x) * glyphScale;

  const layout = computeTabLayout(stemW, stemH, labelWidthMM);
  // Y is negated on top of being centred: parseLetter's contours come back through
  // pointsToContour, which already flips the raw (y-up) glyph into a y-down frame — the same
  // frame `transformContours` (geometry.js) corrects with its own "-s" flip for every OTHER
  // legend in this app. Skipping it here would print every fit-test label upside down.
  const contours = letter.contours.map((c) => c.map(([x, y]) => [
    (x - glyphCX) * glyphScale,
    (glyphCY - y) * glyphScale + layout.labelCenterY,
  ]));

  // ---- assemble: tab, minus the label recess, plus the stem ----
  const tabM = api.Manifold.cube([layout.tabW, layout.tabH, FIT_TEST_TAB_THICK_MM], false)
    .translate([-layout.tabW / 2, layout.yMin, 0]);
  const labelPrism = extrudeContoursLocal(
    api, contours,
    FIT_TEST_TAB_THICK_MM - FIT_TEST_LABEL_DEPTH_MM,
    FIT_TEST_LABEL_DEPTH_MM + 1, // pokes 1mm above the tab top so the cut face isn't coplanar
  );
  const bodyM = tabM.subtract(labelPrism);
  const recessVolume = tabM.volume() - bodyM.volume();
  const unionM = bodyM.add(stemM);
  const status = unionM.status();
  const decomposed = unionM.decompose();
  const watertight = status === 'NoError' && decomposed.length === 1 && pieceWatertight;
  for (const p of decomposed) p.delete();
  const pieceBBox = unionM.boundingBox();

  let geometry = null, tabGeometry = null, stemGeometry = null;
  if (watertight) {
    geometry = manifoldToPlainGeom(unionM);
  } else {
    console.warn(
      `Fit test piece ${label}: tab+stem union was not watertight (${status}, ${decomposed.length} ` +
      'bodies) — exporting the tab and the stem as two separate parts.',
    );
    tabGeometry = manifoldToPlainGeom(bodyM);
    stemGeometry = manifoldToPlainGeom(stemM);
  }

  tabM.delete(); labelPrism.delete(); bodyM.delete(); stemM.delete(); unionM.delete();

  return {
    tol: Math.round(tolMM * 100) / 100,
    label,
    width: layout.tabW,
    depth: layout.tabH,
    geometry, tabGeometry, stemGeometry,
    watertight,
    pieceBBox, stemBBox, recessVolume,
  };
}

/**
 * Every rung, laid out in one row (`FIT_TEST_GAP_MM` gaps, row centred on X = 0). Each piece's
 * geometry is built in its own local frame (stem centred at local (0, 0)); `offsetX` is the one
 * translation needed to place it on the plate.
 */
export function buildFitTestRow(deps, values) {
  const pieces = values.map((tol) => buildFitTestPiece(deps, tol));
  const offsets = computeRowLayout(pieces.map((p) => p.width));
  return pieces.map((p, i) => ({ ...p, offsetX: offsets[i] }));
}
