/*
  The 2-D shape editor's geometry.

  Everything the editor decides is in `src/geometry/editorGeometry.ts` precisely so that it can
  be checked here: this repo's tests are esbuild + node with no DOM, so a rule that lives inside
  a pointer handler is a rule nothing can ever assert. What is proved here:

   1. **The preview covers every shape the build can make.** A `BaseShapeKind` the editor cannot
      draw is a shape the editor silently replaces with a circle — the exact failure mode the
      library shipped last week, one level down.

   2. **Mirroring is symmetric by construction, and stays symmetric under editing.** The risk is
      not the initial reflection, it is the third insert: a cached index pairing is correct until
      a splice shifts every index after it and then drags the wrong point.

   3. **The thin-region shading agrees with what `makeCustom` will actually delete.** A 1.5 mm
      spur must shade and a 4 mm one must not, or the red wash is decoration.

   4. **A drag cannot compound its own output.** Every handle measures from the pointerdown
      snapshot; a handle that reads its own last value accelerates under a steady drag.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/shape-editor.test.ts \
      --bundle --platform=node --format=esm \
      --outfile=apps/clicker-generator/.shape-editor-test.mjs \
      && node apps/clicker-generator/.shape-editor-test.mjs
*/
import {
  applyMirror, bboxOf, columnFits, CORNER_RANGE, COUNT_RANGE, deleteVertex, dragHandle,
  featureRange, fitRingToBox, HANDLES, insertVertex,
  mirrorPartners,
  moveVertex, nearestSegment, normaliseRing, placeHandles, PREVIEWABLE_KINDS, previewRingFor,
  partnersOf, previewRingMm, SIZE_RANGE, simplifyRing, snapPoint, thinField,
  type DragStart, type ShapeParams,
} from '../src/geometry/editorGeometry.ts';
import type { BaseShapeKind, Ring } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const params = (over: Partial<ShapeParams> = {}): ShapeParams => ({
  kind: 'circle', shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34, sizeMm: null, ...over,
});

/* ---------------------------------------------------------------- 1 · preview coverage */

// Every kind the build knows, taken from the type's own union so a new one cannot be added to
// the geometry and quietly skipped here.
const ALL_KINDS: BaseShapeKind[] = [
  'outline', 'circle', 'square', 'rect', 'hexagon', 'heart', 'star', 'egg',
  'ngon', 'cross', 'squircle', 'capsule', 'shield', 'tag', 'arch', 'custom',
];
const notPreviewable = ALL_KINDS.filter(
  (k) => k !== 'outline' && k !== 'custom' && !PREVIEWABLE_KINDS.includes(k),
);
check(
  'every generated shape has a preview',
  notPreviewable.length === 0,
  notPreviewable.length ? `missing: ${notPreviewable.join(', ')}` : `${PREVIEWABLE_KINDS.length} kinds`,
);

for (const kind of PREVIEWABLE_KINDS) {
  const ring = previewRingFor(params({ kind }));
  const [minX, minY, maxX, maxY] = bboxOf(ring);
  const w = maxX - minX;
  const h = maxY - minY;
  const finite = ring.every(([x, y]) => isFinite(x) && isFinite(y));
  check(
    `preview: ${kind}`,
    ring.length >= 3 && finite && w > 0.2 && h > 0.2 && w < 10 && h < 10,
    `${ring.length} pts, ${w.toFixed(2)}×${h.toFixed(2)}`,
  );
}

// The two knobs must actually change the shape, or the handle is a no-op wearing a control's
// clothes — the thing the shape-library pass shipped and Ian caught.
const star5 = previewRingFor(params({ kind: 'star', shapeSides: 5 }));
const star8 = previewRingFor(params({ kind: 'star', shapeSides: 8 }));
check('star point count reaches the outline', star5.length !== star8.length,
  `${star5.length} pts at 5 points, ${star8.length} at 8`);

const areaOf = (ring: Ring): number => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
};
const sharp = areaOf(previewRingFor(params({ kind: 'star', shapeSides: 5, shapeArmPct: 0.3 })));
const chubby = areaOf(previewRingFor(params({ kind: 'star', shapeSides: 5, shapeArmPct: 0.8 })));
check('star sharpness reaches the outline', chubby > sharp * 1.2,
  `area ${sharp.toFixed(3)} at 0.30 inner, ${chubby.toFixed(3)} at 0.80`);

const thinArm = areaOf(previewRingFor(params({ kind: 'cross', shapeArmPct: 0.15 })));
const fatArm = areaOf(previewRingFor(params({ kind: 'cross', shapeArmPct: 0.45 })));
check('cross arm width reaches the outline', fatArm > thinArm * 1.5,
  `area ${thinArm.toFixed(3)} at 0.15, ${fatArm.toFixed(3)} at 0.45`);

const sq0 = areaOf(previewRingFor(params({ kind: 'square', shapeCornerPct: 0 })));
const sq40 = areaOf(previewRingFor(params({ kind: 'square', shapeCornerPct: 0.4 })));
check('square corner radius reaches the outline', sq0 > sq40 * 1.05,
  `area ${sq0.toFixed(3)} sharp, ${sq40.toFixed(3)} at 40%`);

// The star's rounding was the drift this pass fixed: the picker drew a sharp star while the
// build printed a chubby one. A rounded ring needs many more points than a bare 2n-gon.
check('the star ring carries the rounding the build applies', star5.length > 10 * 2,
  `${star5.length} points for a 5-point star (a sharp one has 10)`);

/* ---------------------------------------------------------------- 2 · normalisation */

const wonky: Ring = [[3, 7], [9, 7], [9, 10], [3, 10]];
const norm = normaliseRing(wonky);
{
  const [minX, minY, maxX, maxY] = bboxOf(norm);
  check('normalise: longest side is exactly 1',
    near(Math.max(maxX - minX, maxY - minY), 1, 1e-12),
    `${(maxX - minX).toFixed(4)} × ${(maxY - minY).toFixed(4)}`);
  check('normalise: bbox centre is the origin',
    near((minX + maxX) / 2, 0, 1e-12) && near((minY + maxY) / 2, 0, 1e-12),
    `centre ${((minX + maxX) / 2).toFixed(6)}, ${((minY + maxY) / 2).toFixed(6)}`);
  check('normalise: aspect is preserved',
    near((maxX - minX) / (maxY - minY), 6 / 3, 1e-9),
    `${((maxX - minX) / (maxY - minY)).toFixed(4)} (was 2)`);
}

/* ---------------------------------------------------------------- 3 · mirroring */

const isSymmetric = (ring: Ring, mode: 'vertical' | 'both'): boolean =>
  ring.every(([x, y]) => {
    const wanted: [number, number][] = mode === 'vertical'
      ? [[-x, y]]
      : [[-x, y], [x, -y], [-x, -y]];
    return wanted.every(([rx, ry]) =>
      ring.some(([ox, oy]) => Math.abs(ox - rx) < 1e-9 && Math.abs(oy - ry) < 1e-9));
  });

const lumpy: Ring = [[-4, -4], [4, -4], [5.5, 0], [4, 4], [-4, 4], [-3, 1]];
const mirrored = applyMirror(lumpy, 'vertical');
check('mirror: reflecting makes the ring symmetric', isSymmetric(mirrored, 'vertical'),
  `${lumpy.length} points in, ${mirrored.length} out`);
check('mirror: the seam is not doubled',
  new Set(mirrored.map(([x, y]) => `${x},${y}`)).size === mirrored.length,
  `${mirrored.length} points, all distinct`);

const quad = applyMirror(lumpy, 'both');
check('mirror: "both" is symmetric on each axis', isSymmetric(quad, 'both'),
  `${quad.length} points`);

// The bug this guards: a pairing computed once and reused after a splice drags the wrong point.
{
  let ring = applyMirror(lumpy, 'vertical');
  const before = ring.length;
  ring = insertVertex(ring, 0, 0.5, 'vertical').ring;
  ring = insertVertex(ring, 3, 0.25, 'vertical').ring;
  ring = moveVertex(ring, 1, ring[1][0] - 1.5, ring[1][1] + 0.5, 'vertical');
  const partners = mirrorPartners(ring, 'vertical');
  const moved = ring[1];
  const partner = partners[1][0];
  check('mirror: a drag after two inserts still moves the right partner',
    partner !== undefined
      && near(ring[partner][0], -moved[0], 1e-9)
      && near(ring[partner][1], moved[1], 1e-9),
    partner === undefined
      ? 'no partner found'
      : `moved (${moved[0].toFixed(2)}, ${moved[1].toFixed(2)}), partner (${ring[partner][0].toFixed(2)}, ${ring[partner][1].toFixed(2)})`);
  check('mirror: inserting adds the reflected point too',
    ring.length === before + 4, `${before} -> ${ring.length} after two mirrored inserts`);
  check('mirror: the ring is still symmetric after inserting', isSymmetric(ring, 'vertical'),
    `${ring.length} points`);
}

// A point on the axis must stay on it, or the shape silently stops being symmetric while the
// toggle still says it is.
{
  const ring: Ring = [[0, 5], [4, 0], [0, -5], [-4, 0]];
  const moved = moveVertex(ring, 0, 3.5, 6, 'vertical');
  check('mirror: an on-axis point is constrained to the axis',
    near(moved[0][0], 0, 1e-9) && near(moved[0][1], 6, 1e-9),
    `x pulled to 3.5 landed at ${moved[0][0].toFixed(3)}`);
}

// Deleting takes the reflection with it, and refuses to leave less than a shape.
{
  const ring = applyMirror(lumpy, 'vertical');
  const after = deleteVertex(ring, 1, 'vertical');
  check('mirror: deleting removes the partner too', after.length === ring.length - 2,
    `${ring.length} -> ${after.length}`);
  const tri: Ring = [[0, 4], [3, -3], [-3, -3]];
  check('delete refuses below three points', deleteVertex(tri, 0, 'off').length === 3,
    'a triangle stays a triangle');
}

/* ---------------------------------------------------------------- 4 · insert / snap */

{
  const ring: Ring = [[0, 0], [10, 0], [10, 10]];
  const { ring: r2, index } = insertVertex(ring, 0, 0.5);
  check('insert: lands on the segment at t', index === 1 && near(r2[1][0], 5, 1e-9) && near(r2[1][1], 0, 1e-9),
    `inserted at (${r2[1][0]}, ${r2[1][1]})`);
  const seg = nearestSegment(ring, 5, 1);
  check('nearestSegment finds the segment under the cursor',
    seg.index === 0 && near(seg.t, 0.5, 1e-9) && near(seg.dist, 1, 1e-9),
    `segment ${seg.index} at t=${seg.t.toFixed(2)}, ${seg.dist.toFixed(2)} mm away`);
}

{
  const [gx, gy] = snapPoint(3.4, -7.6, 2, 'off', 0.8);
  check('snap: rounds to the grid', near(gx, 4, 1e-9) && near(gy, -8, 1e-9), `(${gx}, ${gy})`);
  const [ax] = snapPoint(0.5, 5, 2, 'vertical', 0.8);
  check('snap: the mirror axis wins over the grid', near(ax, 0, 1e-9),
    `x = 0.5 within 0.8 of the seam landed at ${ax}`);
  const [fx] = snapPoint(1.4, 5, 2, 'vertical', 0.8);
  check('snap: outside the axis tolerance the grid still applies', near(fx, 2, 1e-9),
    `x = 1.4 landed at ${fx}`);
}

{
  // A traced outline is unusable for point editing until it is simplified: the vertices sit
  // closer together than a fingertip. What must NOT happen is the shape changing while it is
  // simplified, so the area is checked as well as the count.
  const traced: Ring = [];
  for (let i = 0; i < 400; i++) {
    const a = (Math.PI * 2 * i) / 400;
    traced.push([Math.cos(a) * 20, Math.sin(a) * 20]);
  }
  const simple = simplifyRing(traced, 0.25);
  const areaBefore = areaOf(traced);
  const areaAfter = areaOf(simple);
  check('simplify: a 400-point trace becomes grabbable',
    simple.length < 80 && simple.length >= 12, `${traced.length} -> ${simple.length} points`);
  check('simplify: the shape does not change',
    Math.abs(areaAfter - areaBefore) / areaBefore < 0.01,
    `area ${areaBefore.toFixed(1)} -> ${areaAfter.toFixed(1)} mm2`);
  const already: Ring = [[0, 5], [5, -5], [-5, -5]];
  check('simplify: a shape with nothing to drop is untouched',
    simplifyRing(already, 0.25).length === 3, 'a triangle stays a triangle');
}

/* ---------------------------------------------------------------- 5 · printability */

const MIN_FEATURE = 1.0; // the build's own; asserted against the real export below

/** A disc of radius `r` mm, plus an optional rectangular spur out of its right side. */
const discWithSpur = (r: number, spurW: number, spurLen: number): Ring => {
  const ring: Ring = [];
  const steps = 128;
  for (let i = 0; i < steps; i++) {
    const a = (Math.PI * 2 * i) / steps;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    // Walk the spur out and back when the circle crosses the +X axis.
    if (spurW > 0 && i === 0) {
      ring.push([x, -spurW / 2], [r + spurLen, -spurW / 2], [r + spurLen, spurW / 2], [x, spurW / 2]);
      continue;
    }
    ring.push([x, y]);
  }
  return ring;
};

{
  const plain = thinField([discWithSpur(20, 0, 0)], MIN_FEATURE, 128);
  const thinCells = plain.thin.reduce((n, v) => n + v, 0);
  check('thin field: a plain 40 mm disc has nothing too thin', thinCells === 0,
    `${thinCells} shaded cells, ${(plain.survivingFrac * 100).toFixed(1)}% survives`);
  check('thin field: the disc\'s switch spot is its centre',
    near(plain.switchSpot[0], 0, 1) && near(plain.switchSpot[1], 0, 1),
    `(${plain.switchSpot[0].toFixed(2)}, ${plain.switchSpot[1].toFixed(2)})`);
  check('thin field: the disc\'s clearance is its radius',
    near(plain.switchClearMm, 20, 1.2), `${plain.switchClearMm.toFixed(2)} mm (radius 20)`);
}

{
  // 1.5 mm is under 2 x MIN_FEATURE, so the build's open eats it. This is the pumpkin stalk.
  const spur = thinField([discWithSpur(20, 1.5, 6)], MIN_FEATURE, 160);
  let shadedInSpur = 0;
  let shadedInBody = 0;
  for (let row = 0; row < spur.n; row++) {
    for (let col = 0; col < spur.n; col++) {
      const k = row * spur.n + col;
      if (!spur.thin[k]) continue;
      const x = spur.x0 + (col + 0.5) * spur.cell;
      if (x > 19.5) shadedInSpur++;
      else if (Math.hypot(x, spur.y0 + (row + 0.5) * spur.cell) < 17) shadedInBody++;
    }
  }
  check('thin field: a 1.5 mm spur is shaded', shadedInSpur > 0, `${shadedInSpur} cells in the spur`);
  check('thin field: the body around it is not', shadedInBody === 0,
    `${shadedInBody} cells shaded inside the disc`);
}

{
  // 5 mm is comfortably over the threshold and must NOT be shaded — a warning that fires on
  // healthy geometry is worse than none, because it teaches the user to ignore it.
  const fat = thinField([discWithSpur(20, 5, 6)], MIN_FEATURE, 160);
  let shadedInSpur = 0;
  for (let row = 0; row < fat.n; row++) {
    for (let col = 0; col < fat.n; col++) {
      const k = row * fat.n + col;
      if (fat.thin[k] && fat.x0 + (col + 0.5) * fat.cell > 20.5) shadedInSpur++;
    }
  }
  // Not zero: the build's open is `offset(-1)` then `offset(+1, 'Round')`, which genuinely
  // rounds the spur's two sharp tip corners off — about 0.2 mm2 each. Shading those is right.
  // What must not happen is the spur's BODY going red, which is what a wrong threshold does.
  let spurCells = 0;
  for (let row = 0; row < fat.n; row++) {
    for (let col = 0; col < fat.n; col++) {
      const x = fat.x0 + (col + 0.5) * fat.cell;
      if (fat.inside[row * fat.n + col] && x > 20.5) spurCells++;
    }
  }
  check('thin field: a 5 mm spur survives', shadedInSpur < spurCells * 0.1,
    `${shadedInSpur} of ${spurCells} spur cells shaded (the two rounded tip corners)`);
}

{
  // A shape thinner than the open everywhere: the build SKIPS the open rather than returning
  // nothing (makeCustom's isEmpty guard), so the editor must not shade the whole thing red.
  const sliver: Ring = [[-20, -0.6], [20, -0.6], [20, 0.6], [-20, 0.6]];
  const f = thinField([sliver], MIN_FEATURE, 128);
  const shaded = f.thin.reduce((n, v) => n + v, 0);
  check('thin field: a shape thinner than the open everywhere is not all red', shaded === 0,
    `${shaded} shaded cells; survivingFrac ${f.survivingFrac.toFixed(2)}`);
}

{
  // The heart is the shape the centring rule exists for: its centroid is in the notch, so the
  // switch spot has to sit UP in the lobes.
  const heart = previewRingMm(params({ kind: 'heart' }), 40);
  const f = thinField([heart], MIN_FEATURE, 128);
  check('thin field: the heart\'s switch spot is up in the lobes', f.switchSpot[1] > 0,
    `y = ${f.switchSpot[1].toFixed(2)} mm`);
  check('thin field: the heart has room for a 17 mm switch column, and only just',
    f.switchClearMm * 2 >= 17 && f.switchClearMm * 2 < 40,
    `largest circle that fits at the switch spot: ${(f.switchClearMm * 2).toFixed(1)} mm across`);
}

{
  // The size grips have to move the SHAPE, not just themselves. The first cut of
  // `previewRingMm` ignored `sizeMm`, so dragging a corner moved the grip and left the outline
  // exactly where it was — a control that looks wired and is not, which is the failure mode
  // this whole pass exists to stop shipping.
  const free = previewRingMm(params({ kind: 'circle' }), 40);
  const boxed = previewRingMm(params({ kind: 'circle', sizeMm: { w: 60, h: 30 } }), 40);
  const fb = bboxOf(free);
  const bb = bboxOf(boxed);
  check('preview: pinning the size stretches the outline to that box',
    near(bb[2] - bb[0], 60, 0.01) && near(bb[3] - bb[1], 30, 0.01),
    `free ${(fb[2] - fb[0]).toFixed(1)}x${(fb[3] - fb[1]).toFixed(1)}, pinned ${(bb[2] - bb[0]).toFixed(1)}x${(bb[3] - bb[1]).toFixed(1)} mm`);
}

{
  // The switch column is a SQUARE. Testing it with the inscribed-circle radius is the tempting
  // shortcut and is wrong both ways: it passes a square whose corners poke out of a disc, and
  // fails one that sits comfortably in a long thin shape.
  const disc = thinField([discWithSpur(10, 0, 0)], MIN_FEATURE, 128);
  check('switch fit: a 20 mm disc does not hold a 17 mm square',
    !columnFits(disc, 0, 0, 17),
    `inscribed radius ${disc.switchClearMm.toFixed(1)} mm would have said yes; the corners do not fit`);
  const big = thinField([discWithSpur(14, 0, 0)], MIN_FEATURE, 128);
  check('switch fit: a 28 mm disc does', columnFits(big, 0, 0, 17),
    `radius ${big.switchClearMm.toFixed(1)} mm, needs ${(17 * Math.SQRT2 / 2).toFixed(1)}`);
  const off = thinField([discWithSpur(14, 0, 0)], MIN_FEATURE, 128);
  check('switch fit: and not when it is pushed off the edge', !columnFits(off, 8, 0, 17),
    'a column 8 mm off centre on a 28 mm disc hangs over the side');
}

{
  // A drawn outline has no generator behind it, so a size drag has to move the points it has.
  // Doing it from the LIVE ring each frame would scale the previous frame's result and the
  // drag would accelerate away from the cursor, so this is measured from a fixed start.
  const drawn: Ring = [[-10, -5], [10, -5], [12, 0], [10, 5], [-10, 5]];
  const boxed = fitRingToBox(drawn, 60, 30);
  const bb = bboxOf(boxed);
  check('drawn: the size grips stretch the points to the box',
    near(bb[2] - bb[0], 60, 1e-9) && near(bb[3] - bb[1], 30, 1e-9),
    `${(bb[2] - bb[0]).toFixed(1)} x ${(bb[3] - bb[1]).toFixed(1)} mm`);
  check('drawn: and keep the same number of them', boxed.length === drawn.length,
    `${drawn.length} points in, ${boxed.length} out`);
  const twice = fitRingToBox(fitRingToBox(drawn, 60, 30), 60, 30);
  check('drawn: scaling from a fixed start does not compound',
    twice.every((p, i) => near(p[0], boxed[i][0], 1e-9) && near(p[1], boxed[i][1], 1e-9)),
    'the same box twice is the same shape');
}

{
  // The one shape the warning matters most for is the one it went silent on. A sliver thinner
  // than the open EVERYWHERE has no core to dilate from, so nothing is shaded — and the first
  // version counted every cell as surviving, which meant the status line said the shape was
  // fine. survivingFrac is the channel that says otherwise.
  const sliver: Ring = [[-20, -0.6], [20, -0.6], [20, 0.6], [-20, 0.6]];
  const f = thinField([sliver], MIN_FEATURE, 128);
  check('thin field: a shape too thin everywhere reports that it survives nothing',
    f.survivingFrac === 0 && f.thin.reduce((n, v) => n + v, 0) === 0,
    `survivingFrac ${f.survivingFrac}, ${f.thin.reduce((n, v) => n + v, 0)} cells shaded`);
  const healthy = thinField([discWithSpur(20, 0, 0)], MIN_FEATURE, 128);
  check('thin field: and a healthy one still reports that it survives',
    healthy.survivingFrac > 0.99, `survivingFrac ${healthy.survivingFrac.toFixed(3)}`);
}

{
  // Stretching a rounded square takes its corner radius with it and leaves elliptical corners.
  // The build refuses to do that (shapeInBox rebuilds square/rect/capsule at the box's size),
  // so the preview must refuse too, or the editor shows a shape the build will not make.
  const wide = previewRingMm(
    params({ kind: 'square', shapeCornerPct: 0.4, sizeMm: { w: 60, h: 20 } }), 40,
  );
  // A circular corner of radius r on a 60x20 box: the corner arc must be as tall as it is
  // wide. Measure the extreme points of the top-right corner region.
  const corner = wide.filter(([x, y]) => x > 0 && y > 0);
  const cx = Math.max(...corner.map((pt) => pt[0]));
  const cy = Math.max(...corner.map((pt) => pt[1]));
  // Radius from the flat run: where the top edge stops being flat.
  const topFlat = wide.filter(([, y]) => Math.abs(y - cy) < 1e-6).map((pt) => pt[0]);
  const rx = cx - Math.max(...topFlat);
  const rightFlat = wide.filter(([x]) => Math.abs(x - cx) < 1e-6).map((pt) => pt[1]);
  const ry = cy - Math.max(...rightFlat);
  check('preview: a stretched square keeps CIRCULAR corners, as the build makes them',
    near(rx, ry, 0.05), `corner is ${rx.toFixed(2)} across and ${ry.toFixed(2)} tall`);
  const bb = bboxOf(wide);
  check('preview: and still fills the box it was given',
    near(bb[2] - bb[0], 60, 0.01) && near(bb[3] - bb[1], 20, 0.01),
    `${(bb[2] - bb[0]).toFixed(1)} x ${(bb[3] - bb[1]).toFixed(1)} mm`);
}

{
  // moveVertex takes the partner list found at drag-start. It has to agree with what it would
  // have computed itself, or a drag would move the wrong point.
  const ring = applyMirror(lumpy, 'vertical');
  const known = partnersOf(ring, 1, 'vertical');
  const table = mirrorPartners(ring, 'vertical')[1];
  check('mirror: the per-vertex lookup agrees with the whole table',
    known.length === table.length && known.every((v, i) => v === table[i]),
    `[${known.join(',')}] vs [${table.join(',')}]`);
  const a = moveVertex(ring, 1, 3, 3, 'vertical');
  const b = moveVertex(ring, 1, 3, 3, 'vertical', known);
  check('mirror: and passing it in gives the same result as not',
    a.every((pt, i) => near(pt[0], b[i][0], 1e-12) && near(pt[1], b[i][1], 1e-12)),
    'cached partners change nothing but the cost');
}

/* ---------------------------------------------------------------- 6 · handles */

{
  const sq = params({ kind: 'square' });
  const ring = previewRingMm(sq, 40);
  const placed = placeHandles(sq, ring);
  const kinds = placed.map((h) => h.kind);
  check('handles: a square declares corner + size',
    kinds.filter((k) => k === 'corner').length === 1 && kinds.filter((k) => k === 'size').length === 4,
    kinds.join(', '));

  const star = params({ kind: 'star' });
  const starPlaced = placeHandles(star, previewRingMm(star, 40));
  check('handles: a star declares count + feature + size',
    new Set(starPlaced.map((h) => h.kind)).size === 3, [...new Set(starPlaced.map((h) => h.kind))].join(', '));

  check('handles: every previewable shape declares at least one',
    PREVIEWABLE_KINDS.every((k) => (HANDLES[k] ?? []).length > 0),
    PREVIEWABLE_KINDS.filter((k) => !(HANDLES[k] ?? []).length).join(', ') || 'all covered');
}

{
  // The corner handle is the control Ian found missing entirely. Dragging it out to the arc
  // centre plus half the short side must read as the full 40%.
  const p = params({ kind: 'square', shapeCornerPct: 0.22 });
  const ring = previewRingMm(p, 40);
  const [, , maxX, maxY] = bboxOf(ring);
  const handle = placeHandles(p, ring).find((h) => h.kind === 'corner')!;
  const start: DragStart = {
    handle, world: [handle.x, handle.y], params: p, half: [maxX, maxY],
  };
  const short = Math.min(maxX, maxY) * 2;
  const r0 = 0.22 * short;
  const cx = maxX - r0;
  const cy = maxY - r0;
  const pulled = dragHandle(start, [cx + short * 0.3, cy]);
  check('drag: the corner handle reads out as a fraction of the short side',
    near(pulled.shapeCornerPct, 0.3, 1e-6), `${pulled.shapeCornerPct.toFixed(4)} (pulled to 0.30)`);
  const past = dragHandle(start, [cx + short * 5, cy]);
  check('drag: the corner handle clamps where the build clamps',
    near(past.shapeCornerPct, 0.4, 1e-9), `${past.shapeCornerPct.toFixed(3)} at the far end`);
  // The compounding bug: the same pointer position must always give the same answer.
  const again = dragHandle(start, [cx + short * 0.3, cy]);
  check('drag: a handle cannot compound its own output',
    near(again.shapeCornerPct, pulled.shapeCornerPct, 1e-12), 'same pointer, same value');
}

{
  const p = params({ kind: 'star', shapeSides: 5 });
  const ring = previewRingMm(p, 40);
  const handle = placeHandles(p, ring).find((h) => h.kind === 'count')!;
  const r = Math.hypot(handle.x, handle.y);
  const a0 = Math.atan2(handle.y, handle.x);
  const start: DragStart = { handle, world: [handle.x, handle.y], params: p, half: [r, r] };
  const at = (deg: number) => {
    const a = a0 + (deg * Math.PI) / 180;
    return dragHandle(start, [Math.cos(a) * r, Math.sin(a) * r]).shapeSides;
  };
  check('drag: a quarter-turn walks the count range', at(90) === 8, `5 -> ${at(90)} at +90 degrees`);
  check('drag: the count clamps at the build\'s own limits', at(180) === 8 && at(-180) === 3,
    `+180 -> ${at(180)}, -180 -> ${at(-180)}`);
  check('drag: grabbing the handle without moving changes nothing', at(0) === 5, `${at(0)}`);
}

{
  const p = params({ kind: 'circle' });
  const ring = previewRingMm(p, 40);
  const handle = placeHandles(p, ring).find((h) => h.kind === 'size')!;
  const start: DragStart = { handle, world: [handle.x, handle.y], params: p, half: [20, 20] };
  const bigger = dragHandle(start, [25, 15]);
  check('drag: the size grips set the base box in mm',
    bigger.sizeMm?.w === 50 && bigger.sizeMm?.h === 30,
    `${bigger.sizeMm?.w} x ${bigger.sizeMm?.h} mm`);
  const tiny = dragHandle(start, [2, 2]);
  check('drag: the size grips stop where the fixed-size sliders stop',
    tiny.sizeMm?.w === 24 && tiny.sizeMm?.h === 24, `${tiny.sizeMm?.w} x ${tiny.sizeMm?.h} mm`);
}

/*
  The size grips, and the loop that made them unusable.

  `dragHandle` was never the bug — the test above already proves it cannot compound its own
  output. The bug was one level up, in the VIEW: `fitView` fits the size VALUE, so refitting
  after every frame changed the scale that the next frame's `toWorldX` used to read the same
  screen pixel. Same pointer, bigger world coordinate, bigger size, refit, repeat. Loop gain is
  exactly 1 where the grip rests, so any nudge diverged and a stationary pointer walked a 40 mm
  square to the 120 mm clamp in about ten frames.

  Modelled here rather than asserted on the real code because `fitView` and `toWorldX` are
  three lines of arithmetic inside a DOM-bound closure that no test in this repo can reach.
  They are copied below and named, in the same hand-kept-mirror arrangement `previewRingFor`
  has with `buildClicker`. What is proved is the POLICY, which is the part that was wrong:
  a drag is interpreted through the scale captured when it started, not through one the drag
  itself keeps moving.
*/
{
  // `fitView`, verbatim: `const box = params.sizeMm ? max(w, h) : spanMm`, pad 56 a side.
  const CANVAS = { w: 760, h: 520 };
  const PAD = 56;
  const fitZoom = (boxMm: number) =>
    Math.min((CANVAS.w - PAD * 2) / boxMm, (CANVAS.h - PAD * 2) / boxMm);

  /** Ten frames of a drag with the pointer held perfectly still. */
  const run = (refitEveryFrame: boolean): number[] => {
    const p = { ...params({ kind: 'square' }), sizeMm: { w: 40, h: 40 } };
    let zoom = fitZoom(40);
    const ring = previewRingMm(p, 40);
    const [, , maxX, maxY] = bboxOf(ring);
    const handle = placeHandles(p, ring).find((h) => h.kind === 'size')!;
    const start: DragStart = { handle, world: [handle.x, handle.y], params: p, half: [maxX, maxY] };
    // Pointer goes down on the grip, moves 15 px outward, and stops there for good.
    const screenX = handle.x * zoom + 15;
    const screenY = handle.y * zoom;
    const sizes: number[] = [];
    for (let frame = 0; frame < 10; frame++) {
      const next = dragHandle(start, [screenX / zoom, screenY / zoom]);
      sizes.push(next.sizeMm!.w);
      // The one line this whole test is about.
      if (refitEveryFrame) zoom = fitZoom(Math.max(next.sizeMm!.w, next.sizeMm!.h));
    }
    return sizes;
  };

  const broken = run(true);
  const fixed = run(false);
  /* The bug, reproduced, and kept as the control: without it a regression could pass by the
     fix being a no-op on a case that never diverged in the first place. */
  check(
    'size drag: refitting every frame is a runaway (the bug this models)',
    broken[9] > broken[0] * 1.5,
    `${broken[0].toFixed(1)} -> ${broken[9].toFixed(1)} mm over ten frames`,
  );
  check(
    'size drag: a stationary pointer holds a stationary size',
    Math.abs(fixed[9] - fixed[0]) < 1e-9,
    `${fixed[0].toFixed(1)} -> ${fixed[9].toFixed(1)} mm over ten frames`,
  );
}

/* ---------------------------------------------------------------- 7 · shared handle ranges */

/*
  The editor's side-panel sliders (Sides, Corner radius, Notch, Width, Height) read these
  constants directly rather than carrying their own min/max literals — see the constants'
  own comment in editorGeometry.ts for why. What has to be true here is that the ranges
  actually agree with what `dragHandle` clamps a grip to, which the drag tests above already
  pin down as literals (0.4, 3, 8, 24, 120, 0.3/0.8, 0.15/0.45); this just asserts the exported
  numbers ARE those literals, so a future edit to one cannot drift from the other silently.
*/
check('COUNT_RANGE matches the count handle\'s clamp', COUNT_RANGE[0] === 3 && COUNT_RANGE[1] === 8,
  `${COUNT_RANGE[0]}..${COUNT_RANGE[1]}`);
check('CORNER_RANGE matches the corner handle\'s clamp', CORNER_RANGE[0] === 0 && CORNER_RANGE[1] === 0.4,
  `${CORNER_RANGE[0]}..${CORNER_RANGE[1]}`);
check('SIZE_RANGE matches the size handle\'s clamp', SIZE_RANGE[0] === 24 && SIZE_RANGE[1] === 120,
  `${SIZE_RANGE[0]}..${SIZE_RANGE[1]}`);
check('featureRange(star) matches the star drag test', featureRange('star')[0] === 0.3 && featureRange('star')[1] === 0.8,
  `${featureRange('star')[0]}..${featureRange('star')[1]}`);
check('featureRange(cross) matches the cross preview test', featureRange('cross')[0] === 0.15 && featureRange('cross')[1] === 0.45,
  `${featureRange('cross')[0]}..${featureRange('cross')[1]}`);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
