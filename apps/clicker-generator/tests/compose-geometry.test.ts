/*
  The Build-mode composer's geometry.

  Same reason `shape-editor.test.ts` exists for `editorGeometry.ts`: this repo's tests are
  esbuild + node with no DOM, so anything decided inside a pointer handler is a rule nothing can
  ever check. `composeGeometry.ts` keeps every item transform, the hit-test and the
  rasterise-then-contour pipeline DOM-free (the one canvas-creating call is isolated and never
  called from here) precisely so this file can exercise them directly, with
  `rasteriseScanline` standing in for the browser's anti-aliased canvas path.

  What is proved here:

   1. **Union is real union, not "draw both and hope."** Two overlapping adds contour to ONE
      outer ring, not two — the failure mode that would ship if the rasteriser silently used
      even-odd instead of accumulating adds before subtracting cuts.
   2. **A cut fully inside produces a hole, not a second island.** `traceField` has to keep the
      hole ring nested under the outer one it belongs to and count it as a hole, not an island.
   3. **Shapes that do not touch are refused, not silently unioned into one box.** Two islands
      is the case `shapeEditor.ts` disables Confirm on.
   4. **A drag cannot compound its own output.** `resizeItem` and `rotateItem` both measure from
      the pointerdown snapshot; the opposite corner from a resize must not move in world space.
   5. **Hit-testing picks the top-most item**, by array order, not by insertion accident.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/compose-geometry.test.ts \
      --bundle --platform=node --format=esm \
      --outfile=apps/clicker-generator/.compose-geometry-test.mjs \
      && node apps/clicker-generator/.compose-geometry-test.mjs
*/
import {
  composeBounds, composeItems, hitTestItem, itemRing, moveItem, newPrimitiveItem, nextDropSpot,
  normaliseRings, outlineItem, placeItemHandles, rasteriseScanline, resizeItem, rotateItem,
  type ComposeDragStart, type ComposeItem,
} from '../src/geometry/composeGeometry.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Signed area (shoelace); positive is CCW. Kept local — the whole point of a normalise-rings
 *  test is not to trust the module under test to also grade itself. */
function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

const circle = (x: number, y: number, d: number, op: 'add' | 'cut' = 'add'): ComposeItem => ({
  id: `c${x},${y},${d}`, kind: 'circle', x, y, w: d, h: d, rot: 0, op,
});

/* ---------------------------------------------------------------- 1 · union of overlapping adds */

{
  const items = [circle(-6, 0, 20), circle(6, 0, 20)];
  const result = composeItems(items, 40, { n: 220, tolMm: 0.15, rasteriser: rasteriseScanline });
  check(
    'two overlapping circles union to one outer ring',
    result.islands === 1 && result.rings.length === 1,
    `islands=${result.islands} rings=${result.rings.length}`,
  );
  if (result.rings.length === 1) {
    check('the union is CCW (an outer ring)', ringArea(result.rings[0]) > 0, `area=${ringArea(result.rings[0]).toFixed(1)}`);
  }
}

/* ---------------------------------------------------------------- 2 · a cut fully inside makes a hole */

{
  const items = [circle(0, 0, 40), circle(0, 0, 10, 'cut')];
  const result = composeItems(items, 40, { n: 260, tolMm: 0.1, rasteriser: rasteriseScanline });
  check(
    'a fully-inside cut makes one outer ring plus one hole',
    result.islands === 1 && result.rings.length === 2,
    `islands=${result.islands} rings=${result.rings.length}`,
  );
  if (result.rings.length === 2) {
    const areas = result.rings.map(ringArea);
    const outer = areas.find((a) => a > 0);
    const hole = areas.find((a) => a < 0);
    check('the outer ring winds CCW and the hole winds CW', outer !== undefined && hole !== undefined, `areas=${areas.map((a) => a.toFixed(1)).join(',')}`);
    const expectedOuter = Math.PI * 20 * 20;
    const expectedHole = Math.PI * 5 * 5;
    check(
      'the outer area is close to the un-cut disc',
      near(Math.abs(outer ?? 0), expectedOuter, expectedOuter * 0.06),
      `outer=${(outer ?? 0).toFixed(0)} expected≈${expectedOuter.toFixed(0)}`,
    );
    check(
      'the hole area is close to the cutting circle',
      near(Math.abs(hole ?? 0), expectedHole, expectedHole * 0.25),
      `hole=${Math.abs(hole ?? 0).toFixed(1)} expected≈${expectedHole.toFixed(1)}`,
    );
  }
}

/* ---------------------------------------------------------------- 3 · non-touching shapes stay two islands */

{
  const items = [circle(-30, 0, 10), circle(30, 0, 10)];
  const result = composeItems(items, 80, { n: 260, tolMm: 0.1, rasteriser: rasteriseScanline });
  check(
    'two shapes that do not touch stay two islands',
    result.islands === 2 && result.rings.length === 2,
    `islands=${result.islands} rings=${result.rings.length}`,
  );
}

/* ---------------------------------------------------------------- 3b · a cut-only list has no islands */

{
  const items = [circle(0, 0, 10, 'cut')];
  const result = composeItems(items, 40, { n: 120, tolMm: 0.1, rasteriser: rasteriseScanline });
  check('a list with only cuts produces nothing to build', result.islands === 0 && result.rings.length === 0, `islands=${result.islands}`);
}

/* ---------------------------------------------------------------- 4 · item transforms */

{
  const item = newPrimitiveItem('roundedRect', 5, -3, 40);
  check('a new primitive is sized to the requested fraction of the span', near(item.w, 18, 1) && near(item.h, 18, 1), `${item.w}x${item.h}`);
  const ring = itemRing({ ...item, x: 0, y: 0, w: 10, h: 4, rot: 0 });
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  check(
    'an unrotated item’s ring fits its own w x h box',
    near(Math.max(...xs) - Math.min(...xs), 10, 0.05) && near(Math.max(...ys) - Math.min(...ys), 4, 0.05),
    `${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} x ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`,
  );
  // Rotating a 10x4 box by 90 degrees swaps which axis is long — the bbox after rotation
  // should read 4 wide by 10 tall, not the other way round and not unchanged.
  const rotated = itemRing({ ...item, x: 0, y: 0, w: 10, h: 4, rot: 90 });
  const rxs = rotated.map((p) => p[0]);
  const rys = rotated.map((p) => p[1]);
  check(
    'rotating 90 degrees swaps the bounding box axes',
    near(Math.max(...rxs) - Math.min(...rxs), 4, 0.1) && near(Math.max(...rys) - Math.min(...rys), 10, 0.1),
    `${(Math.max(...rxs) - Math.min(...rxs)).toFixed(2)} x ${(Math.max(...rys) - Math.min(...rys)).toFixed(2)}`,
  );
}

/* ---------------------------------------------------------------- 4b · resize keeps the opposite corner fixed */

{
  const item: ComposeItem = { id: 'r', kind: 'roundedRect', x: 0, y: 0, w: 20, h: 10, rot: 0, op: 'add' };
  // Dragging the 'se' (bottom-right, since +y is up) handle: the 'nw' corner must not move.
  const before = placeItemHandles(item).find((h) => h.slot === 'nw')!;
  const start: ComposeDragStart = { item, handle: 'se', startWorld: [10, -5] };
  const next = resizeItem(start, [16, -9], false, 0);
  const after = placeItemHandles({ ...item, ...next }).find((h) => h.slot === 'nw')!;
  check(
    'resizing from a corner leaves the opposite corner in place',
    near(before.x, after.x, 0.02) && near(before.y, after.y, 0.02),
    `before=(${before.x.toFixed(2)},${before.y.toFixed(2)}) after=(${after.x.toFixed(2)},${after.y.toFixed(2)})`,
  );
  check('the dragged corner grew the box', next.w > item.w && next.h > item.h, `${next.w.toFixed(1)}x${next.h.toFixed(1)}`);

  // Same drag with keepAspect: the resulting box keeps the original 2:1 ratio.
  const aspected = resizeItem(start, [16, -9], true, 0);
  check(
    'keepAspect preserves the original width:height ratio',
    near(aspected.w / aspected.h, item.w / item.h, 0.05),
    `${(aspected.w / aspected.h).toFixed(2)} vs ${(item.w / item.h).toFixed(2)}`,
  );

  // An edge handle ('e') only ever touches width.
  const edgeStart: ComposeDragStart = { item, handle: 'e', startWorld: [10, 0] };
  const edged = resizeItem(edgeStart, [14, 0], false, 0);
  check('an edge handle resizes one axis only', near(edged.h, item.h, 0.001), `h stayed ${edged.h}`);

  // Grid snapping rounds the resulting size to the grid.
  const snapped = resizeItem(start, [16.4, -9.2], false, 1);
  check('grid snapping rounds the result to whole mm', Number.isInteger(snapped.w) && Number.isInteger(snapped.h), `${snapped.w}x${snapped.h}`);
}

/* ---------------------------------------------------------------- 4c · rotation is a swept delta */

{
  const item: ComposeItem = { id: 'rot', kind: 'circle', x: 0, y: 0, w: 10, h: 10, rot: 0, op: 'add' };
  const handle = placeItemHandles(item).find((h) => h.slot === 'rotate')!;
  const start: ComposeDragStart = { item, handle: 'rotate', startWorld: [handle.x, handle.y] };
  // The handle starts due north (90 degrees in atan2 terms). Moving the pointer to due east
  // is a -90 degree sweep, so the item should end up rotated -90 from where it started.
  const rot = rotateItem(start, [10, 0]);
  check('rotating from the handle to due east sweeps -90 degrees', near(rot, -90, 1), `${rot.toFixed(1)}`);

  // Starting from a non-zero rotation, the same sweep is added on top rather than replacing it.
  const item2: ComposeItem = { ...item, rot: 30 };
  const handle2 = placeItemHandles(item2).find((h) => h.slot === 'rotate')!;
  const start2: ComposeDragStart = { item: item2, handle: 'rotate', startWorld: [handle2.x, handle2.y] };
  const rot2 = rotateItem(start2, [handle2.x, handle2.y]);
  check('an unmoved pointer reports zero sweep regardless of starting rotation', near(rot2, 30, 0.5), `${rot2.toFixed(1)}`);
}

/* ---------------------------------------------------------------- 4d · move honours the grab offset */

{
  // Grabbed 2mm right, 1mm up of centre; dragging the pointer to (20, 20) should put the
  // centre at (18, 19), not at (20, 20).
  const moved = moveItem([20, 20], [2, 1], 0);
  check('moving offsets by where the drag actually grabbed', near(moved.x, 18, 0.001) && near(moved.y, 19, 0.001), `(${moved.x},${moved.y})`);
  const snappedMove = moveItem([20.6, 19.3], [0, 0], 5);
  check('move snaps to the grid when asked', snappedMove.x % 5 === 0 && snappedMove.y % 5 === 0, `(${snappedMove.x},${snappedMove.y})`);
}

/* ---------------------------------------------------------------- 5 · hit-testing picks the top-most item */

{
  const back: ComposeItem = { id: 'back', kind: 'circle', x: 0, y: 0, w: 20, h: 20, rot: 0, op: 'add' };
  const front: ComposeItem = { id: 'front', kind: 'circle', x: 5, y: 0, w: 20, h: 20, rot: 0, op: 'add' };
  const items = [back, front]; // front is LAST, so it is drawn on top and should win
  check('overlapping items resolve to the last (top-most) one', hitTestItem(items, 3, 0) === 'front', String(hitTestItem(items, 3, 0)));
  check('a point only inside the back item resolves to it', hitTestItem(items, -8, 0) === 'back', String(hitTestItem(items, -8, 0)));
  check('a point outside every item resolves to nothing', hitTestItem(items, 100, 100) === null, String(hitTestItem(items, 100, 100)));

  // A rotated box: a point in its unrotated bounding box but outside the ROTATED one must miss.
  const tall: ComposeItem = { id: 'tall', kind: 'roundedRect', x: 0, y: 0, w: 4, h: 20, rot: 90, op: 'add' };
  // After a 90 degree rotation the box is 20 wide and 4 tall, so (8, 0) is inside it...
  check('hit-testing accounts for rotation (inside)', hitTestItem([tall], 8, 0) === 'tall', String(hitTestItem([tall], 8, 0)));
  // ...while (0, 8) — inside the UNROTATED box — is now outside it.
  check('hit-testing accounts for rotation (outside)', hitTestItem([tall], 0, 8) === null, String(hitTestItem([tall], 0, 8)));
}

/* ---------------------------------------------------------------- 6 · outline items and normalisation */

{
  // Scaled well above MIN_ITEM_MM so the floor that protects an unusably tiny item does not
  // masquerade as a bbox bug in this test.
  const ring: [number, number][] = [[-20, -10], [20, -10], [20, 10], [-20, 10]];
  const item = outlineItem(ring);
  check('an outline item is sized to the ring’s own bbox', near(item.w, 40, 0.01) && near(item.h, 20, 0.01), `${item.w}x${item.h}`);
  const rebuilt = itemRing(item);
  const [minX, minY, maxX, maxY] = [Math.min(...rebuilt.map((p) => p[0])), Math.min(...rebuilt.map((p) => p[1])), Math.max(...rebuilt.map((p) => p[0])), Math.max(...rebuilt.map((p) => p[1]))];
  check('rebuilding an untouched outline item reproduces its box', near(maxX - minX, 40, 0.05) && near(maxY - minY, 20, 0.05), `${(maxX - minX).toFixed(2)}x${(maxY - minY).toFixed(2)}`);

  const rings: [number, number][][] = [[[-2, -1], [2, -1], [2, 1], [-2, 1]], [[-0.5, -0.25], [0.5, -0.25], [0.5, 0.25], [-0.5, 0.25]]];
  const normed = normaliseRings(rings);
  const outerW = Math.max(...normed[0].map((p) => p[0])) - Math.min(...normed[0].map((p) => p[0]));
  check('normaliseRings scales the whole set by ONE factor (longest side becomes 1)', near(outerW, 1, 0.01), `${outerW.toFixed(3)}`);
  const innerW = Math.max(...normed[1].map((p) => p[0])) - Math.min(...normed[1].map((p) => p[0]));
  check('the hole shrinks by the SAME factor as the outer ring, not its own', near(innerW, 0.25, 0.01), `${innerW.toFixed(3)}`);
}

/* ---------------------------------------------------------------- 7 · composeBounds ignores cuts */

{
  const items = [circle(0, 0, 10), circle(100, 100, 4, 'cut')];
  const box = composeBounds(items, 40);
  check(
    'the raster box follows the adds, not a stray cut far away',
    box.maxX < 20 && box.maxY < 20,
    `box=(${box.minX.toFixed(1)},${box.minY.toFixed(1)})..(${box.maxX.toFixed(1)},${box.maxY.toFixed(1)})`,
  );
}

/* ---------------------------------------------------------------- 8 · default drop spot staggers */

{
  // An empty canvas has nothing to offset from — the first shape lands at the origin.
  const first = nextDropSpot([], 20);
  check('the first default drop lands at the origin', first[0] === 0 && first[1] === 0, `(${first[0]},${first[1]})`);

  // A second shape added the same way (no explicit drop point) must NOT land on top of the
  // first — that is the exact "two adds stack invisibly" bug this function exists to avoid.
  const one: ComposeItem = { id: 'a', kind: 'circle', x: 0, y: 0, w: 20, h: 20, rot: 0, op: 'add' };
  const second = nextDropSpot([one], 20);
  const dist = Math.hypot(second[0] - one.x, second[1] - one.y);
  check('the next drop spot sits away from the last item, not on it', dist > 1, `offset ${dist.toFixed(2)} mm`);

  // Chaining the call the way repeated clicks would keeps walking further away rather than
  // orbiting back onto an earlier shape.
  const two: ComposeItem = { ...one, id: 'b', x: second[0], y: second[1] };
  const third = nextDropSpot([one, two], 20);
  const distFromFirst = Math.hypot(third[0] - one.x, third[1] - one.y);
  const distFromSecond = Math.hypot(third[0] - two.x, third[1] - two.y);
  check(
    'a third default drop clears both earlier shapes',
    distFromFirst > 1 && distFromSecond > 1,
    `from first ${distFromFirst.toFixed(2)} mm, from second ${distFromSecond.toFixed(2)} mm`,
  );
}

console.log(failures === 0 ? `\nAll checks passed.` : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
