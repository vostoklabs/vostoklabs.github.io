/**
 * The Build-mode composer's geometry — items, transforms, hit-testing, and the
 * rasterise-then-contour pipeline that turns a pile of primitives into one outline.
 *
 * Nothing here touches the DOM except the one function that makes a canvas
 * (`createRasterCanvas`), so this file can be exercised by the esbuild+node test harness the
 * same way `editorGeometry.ts` is — see that file's own header for why that constraint exists
 * (this repo's tests have no DOM at all).
 *
 * The model: a list of `ComposeItem`s, each a primitive (or a frozen `outline`) placed by a
 * centre, a size and a rotation, tagged `add` or `cut`. The result is NOT the items themselves —
 * it is their rasterised union (adds) minus their rasterised union (cuts), read back as vector
 * rings. Order in the list therefore never changes the geometry: all `add`s are unioned first and
 * all `cut`s are subtracted after, regardless of which item sits where in the array. The array
 * order is still meaningful — it is z-order, i.e. which item a click lands on and which one draws
 * on top — but it is not part of the maths, and `shapeEditor.ts` says so once in the UI rather
 * than leaving it to be inferred from what "Bring to front" seems to do.
 *
 * Why rasterise at all, rather than a vector boolean: the shapes here can self-overlap in ways a
 * polygon clipper has to handle carefully (a star's cut sitting half off a rounded rect's corner,
 * three circles meeting at a point), and this app already has a proven raster pipeline for
 * exactly that — `image/trace.ts` traces a quantised photo into rings with `d3-contour` the same
 * way. Reusing it means one library learns to handle the edge cases, not two.
 */
import { contours } from 'd3-contour';
import type { Ring } from '../types';
import {
  archRing, circleRing, crossRing, eggRing, heartRing, ngonRing,
  roundedRectRing, shieldRing, squircleRing, starRing, tagRing,
} from './shapePaths';
import { bboxOf, fitRingToBox, simplifyRing } from './editorGeometry';

/* ======================================================================================
   The item model.
   ====================================================================================== */

/** Every primitive the palette offers, plus `outline` — a frozen ring rather than a generator,
 *  used for whatever shape was in Adjust when the user switched to Build, and for a pack
 *  silhouette dropped in from the rail. */
export type ComposeShapeKind =
  | 'circle' | 'roundedRect' | 'ngon' | 'star' | 'heart' | 'egg' | 'capsule'
  | 'cross' | 'shield' | 'tag' | 'arch' | 'squircle' | 'outline';

export interface ComposeItem {
  id: string;
  kind: ComposeShapeKind;
  /** Centre, mm, in the same frame the base's own rings live in. */
  x: number;
  y: number;
  /** Bounding box, mm. */
  w: number;
  h: number;
  /** Degrees, clockwise on screen (Y-up maths below, so this is a standard CCW-positive
   *  rotation in the ring's own frame — screen "clockwise" is a UI-layer concern only). */
  rot: number;
  op: 'add' | 'cut';
  /** Sides/points, for `ngon` and `star` only. Undefined elsewhere. */
  sides?: number;
  /** The frozen ring, for `kind: 'outline'` only. Any winding; `itemLocalRing` re-fits it. */
  ring?: Ring;
}

/** `ngon` and `star` share the same 3..8 range the rest of the app uses for a side count. */
export const ITEM_SIDES_RANGE: [number, number] = [3, 8];
const DEFAULT_SIDES: Partial<Record<ComposeShapeKind, number>> = { ngon: 6, star: 5 };

/** Below this an item is a sliver nothing can grab or print. Both dimensions are floored here,
 *  not just clamped at the UI's slider — a `fitRingToBox` on a near-zero box produces a ring
 *  the rest of this file would rather not have to reason about. */
export const MIN_ITEM_MM = 3;

let idCounter = 0;
/** Unique per item, never reused within a session — good enough since the list is not
 *  persisted (see `shapeEditor.ts`'s note on why the recipe does not survive Confirm). */
export function nextItemId(): string {
  idCounter += 1;
  return `it${idCounter}`;
}

/** A new primitive, centred at (x, y), sized to `frac` of `spanMm` — the palette's default. */
export function newPrimitiveItem(
  kind: Exclude<ComposeShapeKind, 'outline'>, x: number, y: number, spanMm: number, frac = 0.45,
): ComposeItem {
  const size = Math.max(MIN_ITEM_MM, Math.round(spanMm * frac));
  return {
    id: nextItemId(), kind, x, y, w: size, h: size, rot: 0, op: 'add',
    sides: DEFAULT_SIDES[kind],
  };
}

/** Where a freshly added item should be centred when nothing places it explicitly — a palette
 *  click, or a rail tile added while already in Build. Offsets from the LAST item in the list by
 *  a fraction of the new item's own size, so a run of plain clicks/double-clicks staggers itself
 *  into a visible diagonal instead of every add landing exactly on the one before it, invisible
 *  underneath it. Falls back to the origin for the first item, same as a drop with no items yet. */
export function nextDropSpot(items: ComposeItem[], sizeMm: number): [number, number] {
  if (!items.length) return [0, 0];
  const last = items[items.length - 1];
  const step = sizeMm * 0.35;
  return [last.x + step, last.y - step];
}

/** A frozen ring as an item — what entering Build seeds from the Adjust shape with, and what a
 *  rail tile (built-in or pack) adds while already in Build. Sized to the ring's own bbox, so
 *  dropping in an untouched outline changes nothing about how it looks. */
export function outlineItem(ring: Ring, x = 0, y = 0): ComposeItem {
  const [minX, minY, maxX, maxY] = bboxOf(ring);
  return {
    id: nextItemId(), kind: 'outline', x, y,
    w: Math.max(MIN_ITEM_MM, maxX - minX), h: Math.max(MIN_ITEM_MM, maxY - minY),
    rot: 0, op: 'add', ring,
  };
}

/* ======================================================================================
   Item -> ring.
   ====================================================================================== */

/** A primitive's outline, in ring units (unnormalised — `fitRingToBox` does the fitting). */
function primitiveRing(kind: Exclude<ComposeShapeKind, 'outline' | 'roundedRect' | 'capsule'>, sides?: number): Ring {
  switch (kind) {
    case 'circle': return circleRing();
    case 'ngon': return ngonRing(sides ?? DEFAULT_SIDES.ngon);
    case 'star': return starRing(sides ?? DEFAULT_SIDES.star);
    case 'heart': return heartRing();
    case 'egg': return eggRing();
    case 'cross': return crossRing();
    case 'shield': return shieldRing();
    case 'tag': return tagRing();
    case 'arch': return archRing();
    case 'squircle': return squircleRing();
    default: return circleRing();
  }
}

/** An item's outline in its OWN local frame: centred at the origin, sized to `w` x `h`, not yet
 *  rotated or moved. `roundedRect` and `capsule` are built straight at their target box — the
 *  same reason `previewRingMm` special-cases them for Adjust mode: stretching a rounded ring
 *  drags its corner radius into an ellipse, which is visibly wrong on the one shape people pick
 *  because it is plain. */
export function itemLocalRing(item: ComposeItem): Ring {
  const w = Math.max(0.1, item.w);
  const h = Math.max(0.1, item.h);
  if (item.kind === 'roundedRect') return roundedRectRing(w, h, 0.22);
  if (item.kind === 'capsule') return roundedRectRing(w, h, 0.5, 16);
  if (item.kind === 'outline') {
    const ring = item.ring && item.ring.length >= 3 ? item.ring : circleRing();
    return fitRingToBox(ring, w, h);
  }
  return fitRingToBox(primitiveRing(item.kind, item.sides), w, h);
}

/** An item's outline in the composition's own mm frame: local, then rotated, then moved to
 *  (x, y). Rotation before translation, always — the local ring is centred on the origin, so
 *  rotating it in place and THEN sliding it to the item's centre is the only order that keeps
 *  the item's own centre fixed while it spins. */
export function itemRing(item: ComposeItem): Ring {
  const local = itemLocalRing(item);
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return local.map(([x, y]) => [
    item.x + x * cos - y * sin,
    item.y + x * sin + y * cos,
  ] as [number, number]);
}

/* ======================================================================================
   Hit-testing and handles.
   ====================================================================================== */

/** Point-in-bounding-box, in the item's own rotated frame — not point-in-outline. Clicking
 *  between a star's points still grabs the star: the box is what the user is dragging by, and a
 *  precise-outline test would make a concave shape's own corners feel like dead space. */
export function hitTestItem(items: ComposeItem[], x: number, y: number): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const rad = (-item.rot * Math.PI) / 180;
    const dx = x - item.x;
    const dy = y - item.y;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (Math.abs(lx) <= item.w / 2 && Math.abs(ly) <= item.h / 2) return item.id;
  }
  return null;
}

export type HandleSlot = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export interface PlacedItemHandle {
  slot: HandleSlot;
  x: number;
  y: number;
}

/** How far above the box the rotate handle floats, mm — a fixed distance rather than a fraction
 *  of the item's own height, so a short, wide item does not end up with the handle sitting on
 *  top of the box itself. */
export const ROTATE_HANDLE_GAP_MM = 10;

/** The 8 resize handles plus the rotate handle, in world mm. The canvas converts these to
 *  screen pixels and does its own nearest-within-radius pick — same division of labour as
 *  Adjust mode's `placeHandles` / `handleUnder` in `editorGeometry.ts` and `shapeEditor.ts`. */
export function placeItemHandles(item: ComposeItem): PlacedItemHandle[] {
  const hw = item.w / 2;
  const hh = item.h / 2;
  const local: [HandleSlot, number, number][] = [
    ['nw', -hw, hh], ['n', 0, hh], ['ne', hw, hh],
    ['e', hw, 0],
    ['se', hw, -hh], ['s', 0, -hh], ['sw', -hw, -hh],
    ['w', -hw, 0],
    ['rotate', 0, hh + ROTATE_HANDLE_GAP_MM],
  ];
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return local.map(([slot, lx, ly]) => ({
    slot,
    x: item.x + lx * cos - ly * sin,
    y: item.y + lx * sin + ly * cos,
  }));
}

/* ======================================================================================
   Drag maths — move, resize, rotate. Every function measures from the POINTERDOWN snapshot,
   never from the item's current, already-dragged value: a handle that reads its own last
   output accelerates under a steady drag, which is the bug `editorGeometry.ts`'s `dragHandle`
   already carries a long comment about. Same rule, same reason, second control.
   ====================================================================================== */

export interface ComposeDragStart {
  /** The item as it was at pointerdown. */
  item: ComposeItem;
  handle: HandleSlot;
  /** The pointer, in composition mm, at pointerdown. */
  startWorld: [number, number];
}

const roundTo = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);

/** Move the item so its centre sits at `world`, offset by wherever inside it the drag actually
 *  grabbed (`grabOffset`) — otherwise the item's centre jumps to the cursor on the first pixel
 *  of a drag that started off-centre. */
export function moveItem(
  world: [number, number], grabOffset: [number, number], gridMm = 0,
): { x: number; y: number } {
  const x = world[0] - grabOffset[0];
  const y = world[1] - grabOffset[1];
  return { x: roundTo(x, gridMm), y: roundTo(y, gridMm) };
}

/**
 * Resize from one of the 8 handles. The edge (or corner) OPPOSITE the one being dragged stays
 * fixed in world space — the ordinary meaning of "drag this corner" — which is why the maths
 * works in the item's own unrotated frame (centred on its ORIGINAL centre) and rotates the
 * result back rather than adjusting `w`/`h` and leaving `x`/`y` untouched: a rotated item whose
 * centre never moved would grow from its middle, not from the handle.
 *
 * `keepAspect` only matters when both axes move (a corner, not an edge) — an edge handle resizes
 * one axis by definition and Alt has nothing to do there.
 */
export function resizeItem(
  start: ComposeDragStart, world: [number, number], keepAspect: boolean, gridMm = 0,
): { x: number; y: number; w: number; h: number } {
  const { item, handle } = start;
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // World -> the item's local frame, still centred on its ORIGINAL centre (un-rotated).
  const dx = world[0] - item.x;
  const dy = world[1] - item.y;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;

  const movesX = handle !== 'n' && handle !== 's';
  const movesY = handle !== 'e' && handle !== 'w';
  const signX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const signY = handle.includes('n') ? 1 : handle.includes('s') ? -1 : 0;

  let hw = item.w / 2;
  let hh = item.h / 2;
  if (movesX && signX !== 0) hw = Math.max(MIN_ITEM_MM / 2, signX * lx);
  if (movesY && signY !== 0) hh = Math.max(MIN_ITEM_MM / 2, signY * ly);

  if (keepAspect && movesX && movesY && signX !== 0 && signY !== 0) {
    // Whichever axis moved further (relative to its own start) drives both — the same
    // "dominant axis" rule most drawing apps use for a proportional corner drag.
    const scale = Math.max(hw / (item.w / 2 || 1), hh / (item.h / 2 || 1));
    hw = (item.w / 2) * scale;
    hh = (item.h / 2) * scale;
  }

  let w = Math.max(MIN_ITEM_MM, roundTo(hw * 2, gridMm));
  let h = Math.max(MIN_ITEM_MM, roundTo(hh * 2, gridMm));

  // The fixed corner/edge, in the ORIGINAL local frame — it never moves in world space either,
  // so the new centre is derived from it rather than from the live (already-changing) box.
  const fixedLX = signX !== 0 ? -signX * (item.w / 2) : 0;
  const fixedLY = signY !== 0 ? -signY * (item.h / 2) : 0;
  const newCLX = signX !== 0 ? fixedLX + signX * (w / 2) : 0;
  const newCLY = signY !== 0 ? fixedLY + signY * (h / 2) : 0;

  return {
    x: item.x + newCLX * cos - newCLY * sin,
    y: item.y + newCLX * sin + newCLY * cos,
    w,
    h,
  };
}

/** Rotate by the angle SWEPT since pointerdown, not the pointer's absolute bearing — so grabbing
 *  the handle never snaps the item to face wherever the cursor happened to be. Same pattern as
 *  `editorGeometry.ts`'s `count` handle. */
export function rotateItem(start: ComposeDragStart, world: [number, number]): number {
  const { item } = start;
  const a0 = Math.atan2(start.startWorld[1] - item.y, start.startWorld[0] - item.x);
  const a1 = Math.atan2(world[1] - item.y, world[0] - item.x);
  const sweepDeg = ((a1 - a0) * 180) / Math.PI;
  return item.rot + sweepDeg;
}

/* ======================================================================================
   Rasterise, then contour — the item list becomes one set of vector rings.
   ====================================================================================== */

export interface RasterBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The square, padded box the raster has to cover: every `add` item's own bbox (rotation
 *  included), padded a little so the contour of the outermost edge is never clipped by the
 *  grid boundary. `cut` items are not counted — a cut sticking out past every add contributes
 *  nothing to the result, and letting it inflate the raster box would waste resolution on
 *  material that was never going to be there. Falls back to `fallbackSpanMm` when there is
 *  nothing to add (an empty list, or cuts only), so the caller always gets a raster to trace
 *  rather than a division by zero. */
export function composeBounds(items: ComposeItem[], fallbackSpanMm: number): RasterBox {
  const adds = items.filter((it) => it.op === 'add');
  if (!adds.length) {
    const half = Math.max(1, fallbackSpanMm) / 2;
    return { minX: -half, minY: -half, maxX: half, maxY: half };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of adds) {
    const [a, b, c, d] = bboxOf(itemRing(item));
    if (a < minX) minX = a;
    if (b < minY) minY = b;
    if (c > maxX) maxX = c;
    if (d > maxY) maxY = d;
  }
  const pad = Math.max(1, (maxX - minX + (maxY - minY)) * 0.04);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Expand a box to a centred square on its longer side, so the raster grid has square cells —
 *  a non-square grid would stretch whichever axis got fewer cells per mm. */
function squareUp(box: RasterBox): RasterBox {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const half = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) / 2;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}

export interface RasterField {
  n: number;
  /** Left edge, mm (minimum x). */
  x0: number;
  /** Top edge, mm (MAXIMUM y — the field is stored top-down, row 0 first, matching how a
   *  canvas or an image buffer is laid out; `traceField` undoes this on the way back out). */
  yTop: number;
  cell: number;
  /** Row-major, row 0 = top. 0..1. */
  alpha: Float32Array;
}

export type ComposeRasteriser = (items: ComposeItem[], box: RasterBox, n: number) => RasterField;

/**
 * The test-path rasteriser: an even-odd scanline fill straight into a `Float32Array`, no canvas.
 *
 * Binary, not anti-aliased — fine for the topology and area assertions the tests make, and the
 * whole reason this exists separately from `rasteriseCanvas`: Node has no canvas, and stubbing
 * one to unit-test a contour pipeline is more moving parts than writing the eight lines a
 * scanline fill actually takes.
 *
 * All `add` items are filled first (each sets its interior to 1, never resetting a cell another
 * add already claimed), then every `cut` clears its interior to 0 — which is what makes the
 * result independent of the items' array order, per this file's header.
 */
export function rasteriseScanline(items: ComposeItem[], box: RasterBox, n: number): RasterField {
  const sq = squareUp(box);
  const span = sq.maxX - sq.minX || 1;
  const cell = span / n;
  const x0 = sq.minX;
  const yTop = sq.maxY;
  const alpha = new Float32Array(n * n);

  const fill = (ring: Ring, value: 0 | 1): void => {
    if (ring.length < 3) return;
    for (let row = 0; row < n; row++) {
      const y = yTop - (row + 0.5) * cell;
      const xs: number[] = [];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j];
        const b = ring[i];
        if ((a[1] > y) === (b[1] > y)) continue;
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5));
        const c1 = Math.min(n - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
        for (let col = c0; col <= c1; col++) alpha[row * n + col] = value;
      }
    }
  };

  for (const item of items) if (item.op === 'add') fill(itemRing(item), 1);
  for (const item of items) if (item.op === 'cut') fill(itemRing(item), 0);
  return { n, x0, yTop, cell, alpha };
}

/** Isolated behind one function so a test could stub it — nothing in this repo's test harness
 *  has a DOM, so nothing here ever will, but the browser path (`rasteriseCanvas`) still keeps
 *  its one canvas-creating call in one place rather than three. */
function createRasterCanvas(n: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(n, n);
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  return c;
}

/** The browser-path rasteriser: paint every `add` with `source-over`, then every `cut` with
 *  `destination-out`, and read the alpha channel back as the field. Anti-aliased, unlike
 *  `rasteriseScanline` — the reason the two paths are not the same function — which is what
 *  keeps a contour built from this from looking like a staircase at the base's actual print
 *  size. Two passes (all adds, then all cuts) for the same order-independence reason the
 *  scanline path has two loops instead of one interleaved walk. */
export function rasteriseCanvas(items: ComposeItem[], box: RasterBox, n: number): RasterField {
  const sq = squareUp(box);
  const span = sq.maxX - sq.minX || 1;
  const cell = span / n;
  const x0 = sq.minX;
  const yTop = sq.maxY;

  const canvas = createRasterCanvas(n);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return { n, x0, yTop, cell, alpha: new Float32Array(n * n) };
  ctx.clearRect(0, 0, n, n);

  const toPx = (x: number, y: number): [number, number] => [(x - x0) / cell, (yTop - y) / cell];
  const paint = (ring: Ring, mode: 'add' | 'cut'): void => {
    if (ring.length < 3) return;
    ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out';
    ctx.beginPath();
    const [sx, sy] = toPx(ring[0][0], ring[0][1]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = toPx(ring[i][0], ring[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
  };

  for (const item of items) if (item.op === 'add') paint(itemRing(item), 'add');
  for (const item of items) if (item.op === 'cut') paint(itemRing(item), 'cut');

  const data = ctx.getImageData(0, 0, n, n).data;
  const alpha = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) alpha[k] = data[k * 4 + 3] / 255;
  return { n, x0, yTop, cell, alpha };
}

export interface ComposeResult {
  /** Every ring, outer and hole alike, wound the way `baseShapeRings` / `CrossSection(...,
   *  'NonZero')` needs: outers CCW, holes CW. That is `d3-contour`'s own convention once its
   *  raw output is read back with y increasing upward (see the comment on `toMm` below) — the
   *  same fact `image/trace.ts` relies on, so this file does not re-derive it, only reuses it. */
  rings: Ring[];
  /** How many of those rings are OUTER boundaries — i.e. separate islands. 1 is one base; more
   *  than 1 means some shapes do not touch, which `shapeEditor.ts` refuses to build from. Holes
   *  do not count. */
  islands: number;
}

/** Marching-squares the field at alpha = 0.5 and hands back mm-space rings.
 *
 * `field` is stored top-down (row 0 = maximum y), because that is the natural order for both
 * rasterisers (a canvas's `ImageData` is top-down, and the scanline fill was written to match
 * it so one function can read either). `d3-contour` returns coordinates in that same row/column
 * space, so converting back to mm is one subtraction for x and one for y — no separate
 * "un-flip" step, because storing the field top-down and then reading `py` as "distance down
 * from the top" are the same fact stated twice. */
export function traceField(field: RasterField, tolMm: number): ComposeResult {
  const gen = contours().size([field.n, field.n]).thresholds([0.5]);
  const multi = gen(field.alpha as unknown as number[])[0];
  const toMm = (p: [number, number]): [number, number] => [
    field.x0 + p[0] * field.cell,
    field.yTop - p[1] * field.cell,
  ];

  const rings: Ring[] = [];
  let islands = 0;
  for (const poly of multi.coordinates as [number, number][][][]) {
    let outerKept = false;
    poly.forEach((ring, i) => {
      const mm = ring.map(toMm);
      const simplified = simplifyRing(mm, tolMm);
      if (simplified.length < 3) return;
      rings.push(simplified);
      if (i === 0) outerKept = true;
    });
    if (outerKept) islands++;
  }
  return { rings, islands };
}

/** The whole pipeline: items -> raster -> rings. `rasteriser` defaults to the canvas path;
 *  tests pass `rasteriseScanline` (see this file's header on why the two exist). */
export function composeItems(
  items: ComposeItem[],
  fallbackSpanMm: number,
  opts: { n?: number; tolMm?: number; rasteriser?: ComposeRasteriser } = {},
): ComposeResult {
  const box = composeBounds(items, fallbackSpanMm);
  const n = opts.n ?? 1024;
  const rasteriser = opts.rasteriser ?? rasteriseCanvas;
  const field = rasteriser(items, box, n);
  return traceField(field, opts.tolMm ?? 0.15);
}

/** Normalise a WHOLE result together — bbox centre at the origin, both axes divided by the
 *  longest side across every ring, not each ring's own. `editorGeometry.ts`'s `normaliseRing`
 *  does this per-ring, which is right for a single outline and wrong here: normalising a hole
 *  against its OWN bbox would slide it away from the outer ring it is supposed to sit inside. */
export function normaliseRings(rings: Ring[]): Ring[] {
  if (!rings.length) return rings;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    const [a, b, c, d] = bboxOf(ring);
    if (a < minX) minX = a;
    if (b < minY) minY = b;
    if (c > maxX) maxX = c;
    if (d > maxY) maxY = d;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const k = Math.max(maxX - minX, maxY - minY) || 1;
  return rings.map((ring) => ring.map(([x, y]) => [(x - cx) / k, (y - cy) / k] as [number, number]));
}
