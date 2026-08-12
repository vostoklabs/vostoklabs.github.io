/**
 * Plate outlines and mounting cut-outs, as plain polygons.
 *
 * Deliberately free of manifold and of the DOM: everything here is arithmetic on
 * `[x, y]` pairs, so it can be checked headless in Node the way `@vostok/fonts`
 * `textLayout` is. The manifold step in `buildSign.ts` only unions and subtracts what
 * this file hands it, which keeps the part that is easy to get subtly wrong — corner
 * radii, hole placement, keyhole geometry — in the part that is easy to test.
 *
 * Convention: a contour is `number[][]` of `[x, y]`, and a shape is `number[][][]`.
 * Outer loops are wound **counter-clockwise** (positive signed area), matching what
 * manifold's `Positive` fill rule expects. Holes are returned separately rather than as
 * negative loops — the caller subtracts them, which is explicit and survives a shape
 * being reused as a pocket rather than a through-hole.
 */

export type Contour = number[][];
export type Shape2D = number[][][];

/** Kept structurally identical to `SignParams['shape']`, and declared here rather than
 *  imported so this file stays runnable on its own under `node` for the headless checks. */
export type PlateShape = 'rounded' | 'rect' | 'pill' | 'plaque' | 'none';

/** Points per 90° of arc. 8 is smooth at sign scale and cheap in the boolean. */
const ARC_STEPS = 8;

/** Anything below this is a duplicate point as far as an extruder is concerned. */
const WELD = 1e-4;

export function signedArea(poly: Contour): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    a += p[0]! * q[1]! - q[0]! * p[1]!;
  }
  return a / 2;
}

/** Drops points that repeat their neighbour, including around the wrap. */
export function weld(poly: Contour): Contour {
  const out: Contour = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0]! - p[0]!) < WELD && Math.abs(prev[1]! - p[1]!) < WELD) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last
      && Math.abs(first[0]! - last[0]!) < WELD && Math.abs(first[1]! - last[1]!) < WELD) {
    out.pop();
  }
  return out;
}

/** Ensures a loop is wound counter-clockwise. */
export function ccw(poly: Contour): Contour {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** A circle, centred, counter-clockwise. */
export function circle(cx: number, cy: number, radius: number, steps = ARC_STEPS * 4): Contour {
  const out: Contour = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    out.push([cx + Math.cos(t) * radius, cy + Math.sin(t) * radius]);
  }
  return out;
}

/**
 * A rectangle with rounded corners, centred on the origin.
 *
 * `radius` is clamped to half the shorter side rather than rejected: the UI lets someone
 * drag corner radius up while the plate auto-shrinks around short text, and a slider that
 * throws when the two cross is worse than one that quietly becomes a pill.
 */
export function roundedRect(width: number, height: number, radius: number): Contour {
  const w = Math.max(WELD, width);
  const h = Math.max(WELD, height);
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= WELD) {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  }

  const x = w / 2 - r;
  const y = h / 2 - r;
  const corners: Array<[number, number, number]> = [
    [x, y, 0],           // top-right,    sweeping 0° → 90°
    [-x, y, Math.PI / 2],
    [-x, -y, Math.PI],
    [x, -y, Math.PI * 1.5],
  ];

  const out: Contour = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = start + (i / ARC_STEPS) * (Math.PI / 2);
      out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
  }
  return weld(out);
}

/** A rectangle with its corners cut off at 45° — the classic engraved-plaque outline. */
export function plaque(width: number, height: number, cut: number): Contour {
  const w = Math.max(WELD, width);
  const h = Math.max(WELD, height);
  const c = Math.max(0, Math.min(cut, Math.min(w, h) / 2));
  if (c <= WELD) return roundedRect(w, h, 0);
  const x = w / 2;
  const y = h / 2;
  return weld([
    [x - c, -y], [x, -y + c],
    [x, y - c], [x - c, y],
    [-x + c, y], [-x, y - c],
    [-x, -y + c], [-x + c, -y],
  ]);
}

/** The plate outline for a shape, sized to `width` × `height`. `none` has no plate. */
export function plateOutline(
  shape: PlateShape,
  width: number,
  height: number,
  cornerRadius: number,
): Shape2D {
  switch (shape) {
    case 'none': return [];
    case 'rect': return [ccw(roundedRect(width, height, 0))];
    case 'pill': return [ccw(roundedRect(width, height, Math.min(width, height) / 2))];
    case 'plaque': return [ccw(plaque(width, height, Math.max(cornerRadius, 2)))];
    case 'rounded':
    default: return [ccw(roundedRect(width, height, cornerRadius))];
  }
}

/**
 * Where the screws go: one near each end, on the horizontal centreline.
 *
 * Inset by `inset` from the plate edge, and never closer to the edge than the hole's own
 * radius plus a wall — a hole that breaks the outline is the failure people photograph.
 */
export function screwHolePositions(
  plateWidth: number,
  plateHeight: number,
  holeDia: number,
  inset: number,
): Array<[number, number]> {
  const minWall = holeDia * 0.75;
  const maxInset = plateWidth / 2 - holeDia / 2 - minWall;
  // Clamped at **both** ends. Bounding only the maximum left a small inset placing the
  // hole hard against the outline — at inset 0.1 the wall was 0.1 mm, which is not a wall,
  // it is a slot. The floor is the same `minWall` the ceiling uses, so a hole is either a
  // proper hole or it is dropped.
  const x = Math.min(Math.max(inset, minWall), maxInset);
  if (!(x > WELD) || maxInset < minWall) return [];
  // Vertically centred: on a tall two-line sign the centreline is still the strongest
  // place to hang it from, and it keeps the pair symmetric about both axes.
  void plateHeight;
  return [[-(plateWidth / 2 - x - holeDia / 2), 0], [plateWidth / 2 - x - holeDia / 2, 0]];
}

export function screwHoles(
  plateWidth: number,
  plateHeight: number,
  holeDia: number,
  inset: number,
): Shape2D {
  return screwHolePositions(plateWidth, plateHeight, holeDia, inset)
    .map(([x, y]) => ccw(circle(x, y, holeDia / 2)));
}

/** A laid-out line's ink box. Mirrors `LineBox` in types.ts, kept local so this file has
 *  no app imports and stays runnable under bare `node` for the checks. */
export interface Box { minX: number; maxX: number; minY: number; maxY: number }

/**
 * The rule: a bar between two text blocks, as a plain contour.
 *
 * Lives here rather than in `buildSign` because it is arithmetic on `[x, y]` pairs like
 * everything else in this file, and because the example thumbnails need the identical shape —
 * a card that draws its own idea of the bar is a card that will eventually disagree with the
 * model.
 *
 * **It has to TOUCH both blocks, not merely sit between them.** Centred in the gap at the
 * user's thickness it floated: on a two-line sign the gap is wider than any sensible rule, so
 * `shape: 'none'` still decomposed into loose glyphs and the one thing the rule exists for —
 * holding a plateless sign together as a single printable piece — did not happen. So it spans
 * at least the whole gap, biting `BITE` into each block, and grows symmetrically beyond that
 * if asked for something chunkier. Thickness reads as "at least this thick", which is the only
 * reading that can also promise one piece.
 */
export interface LineOptions {
  thickness: number;
  overhang: number;
  /** Explicit length in mm; 0 sizes it from the text. */
  length: number;
  /** Shifts it off the centre of the gap. +ve toward the first block. */
  offset: number;
  beside: boolean;
  /**
   * Stretch it until it touches both blocks.
   *
   * True only when there is no plate, and that distinction is the whole design. Plateless,
   * the line is structural — it must weld the numerals to the street name or the sign
   * prints as loose pieces. On a plate it is a design element, and stretching it there was
   * wrong twice over: the thickness control did nothing (any value under the gap was
   * swallowed by the bridging) and the bar grew into the glyphs instead of sitting clear
   * of them.
   */
  bridge: boolean;
  /** Highest glyph bottom in the upper block — where a bridging bar must reach up to. */
  reachUp?: number;
  /** Lowest glyph top in the lower block — where a bridging bar must reach down to. */
  reachDown?: number;
}

export function lineContour(lines: Box[], block: Box, opts: LineOptions): Contour | null {
  const t = Math.max(0.2, opts.thickness) / 2;
  const over = Math.max(0, opts.overhang);

  /*
   * Where the bar has to reach to touch every glyph in a block.
   *
   * Two wrong answers came before this one. A flat 0.3 mm bite into the block's ink box was
   * not enough: the box's `minY` is the bottom of the block's *lowest* glyph — a descender —
   * so on "Marianijeva" the bar met the `j` and nothing else, and every other letter printed
   * in mid-air. Then a quarter of the block height was far too much: on a 70 mm number with
   * no descenders at all it ate 17.5 mm into the digits and the bar became a slab across the
   * sign.
   *
   * The right answer is not a fraction of anything. It is measured: the bar must reach the
   * **highest glyph bottom** in the block above it, and the **lowest glyph top** in the block
   * below. A block of digits needs no bite, because every glyph already sits on the baseline;
   * one with a descender needs exactly enough to clear it. `opts.reachUp` / `reachDown` carry
   * those, and fall back to the ink box when the caller has not measured.
   */
  const reachUp = opts.reachUp ?? (lines[0] ? lines[0].minY : 0);
  const reachDown = opts.reachDown ?? (lines[1] ? lines[1].maxY : 0);
  const OVERLAP = 0.4;

  /** The bar's extent along its own length, honouring an explicit length if given. */
  const span = (lo: number, hi: number): [number, number] => {
    if (opts.length > 0) {
      const c = (lo + hi) / 2;
      return [c - opts.length / 2, c + opts.length / 2];
    }
    return [lo - over, hi + over];
  };

  if (lines.length < 2) {
    // One block: the bar sits under it — the "big number over a bar" look.
    const y = block.minY - opts.thickness * 1.2 + opts.offset;
    const [x0, x1] = span(block.minX, block.maxX);
    return [[x0, y - t], [x1, y - t], [x1, y + t], [x0, y + t]];
  }

  const [a, b] = [lines[0]!, lines[1]!];

  if (opts.beside) {
    // Vertical line in the gap between them — the "10 | RYDAL DRIVE" divider.
    const left = a.maxX < b.maxX ? a : b;
    const right = a.maxX < b.maxX ? b : a;
    const mid = (left.maxX + right.minX) / 2 + opts.offset;
    const x0 = opts.bridge ? Math.min(mid - t, left.maxX - OVERLAP) : mid - t;
    const x1 = opts.bridge ? Math.max(mid + t, right.minX + OVERLAP) : mid + t;
    const [y0, y1] = span(block.minY, block.maxY);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  // Horizontal line in the gap between the two rows. `offset` is positive toward line 1,
  // which is the upper row, so it adds to y.
  const lower = a.minY < b.minY ? a : b;
  const upper = a.minY < b.minY ? b : a;
  const mid = (lower.maxY + upper.minY) / 2 + opts.offset;
  const y0 = opts.bridge ? Math.min(mid - t, reachDown - OVERLAP) : mid - t;
  const y1 = opts.bridge ? Math.max(mid + t, reachUp + OVERLAP) : mid + t;
  const [x0, x1] = span(block.minX, block.maxX);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * How far a bar must reach to touch every glyph in a block, measured from the real outlines.
 *
 * `highestBottom` is the greatest of each glyph's own lowest point — for a row of digits that
 * is the baseline, for one with a descender it is still the baseline, because the descender
 * is only *one* glyph's minimum. `lowestTop` is the mirror. Between them they say exactly
 * where a bar has to be to catch every letter, rather than guessing with a fraction of the
 * block's height.
 */
export function glyphReach(contours: Shape2D, box: Box): { highestBottom: number; lowestTop: number } {
  let highestBottom = -Infinity;
  let lowestTop = Infinity;

  for (let i = 0; i < contours.length; i++) {
    const loop = contours[i]!;
    let lo = Infinity, hi = -Infinity, cx = 0;
    for (const pt of loop) {
      if (pt[1]! < lo) lo = pt[1]!;
      if (pt[1]! > hi) hi = pt[1]!;
      cx += pt[0]!;
    }
    cx /= loop.length || 1;
    const cy = (lo + hi) / 2;

    // Only glyphs belonging to this block.
    if (cy < box.minY - 0.5 || cy > box.maxY + 0.5) continue;

    /*
     * Skip counters. The inside of a `0` is a contour like any other, and its bottom sits
     * well above the baseline — so counting it made `highestBottom` the top of the counter
     * rather than the foot of the glyph. On the Street preset that pushed the number 7 mm
     * too far down and straight through the street name below it.
     */
    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (j !== i && pointInPoly(contours[j]!, cx, cy)) depth++;
    }
    if (depth % 2 === 1) continue;

    if (lo > highestBottom) highestBottom = lo;
    if (hi < lowestTop) lowestTop = hi;
  }

  return {
    highestBottom: Number.isFinite(highestBottom) ? highestBottom : box.minY,
    lowestTop: Number.isFinite(lowestTop) ? lowestTop : box.maxY,
  };
}

/**
 * A filled label bar sized to hold a block of text, with padding.
 *
 * The "34 / DRYFESDALE VIEW" look: the street name is not set beside a bar, it is set
 * *inside* one and knocked out of the fill, so it reads as reversed-out type. The caller
 * unions this into the text body and subtracts the line-2 glyphs from it.
 */
export function labelBarContour(box: Box, padX: number, padY: number, overhang: number): Contour {
  const x0 = box.minX - padX - overhang;
  const x1 = box.maxX + padX + overhang;
  const y0 = box.minY - padY;
  const y1 = box.maxY + padY;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/**
 * A rectangle covering one edge of a `width` x `height` plate, `band` mm deep.
 *
 * Intersected with the plate outline by the caller, so the strip takes the plate's own
 * silhouette — on a rounded or pill plate it keeps the curve rather than ending in a square
 * corner sticking out of it. The "300" reference: a contrasting strip along the bottom.
 */
export function bandContour(
  edge: 'top' | 'bottom' | 'left' | 'right',
  width: number,
  height: number,
  band: number,
): Contour {
  const w = width / 2 + 1;
  const h = height / 2 + 1;
  const d = Math.max(WELD, band);
  switch (edge) {
    case 'top': return [[-w, h - d], [w, h - d], [w, h], [-w, h]];
    case 'bottom': return [[-w, -h], [w, -h], [w, -h + d], [-w, -h + d]];
    case 'left': return [[-w, -h], [-w + d, -h], [-w + d, h], [-w, h]];
    default: return [[w - d, -h], [w, -h], [w, h], [w - d, h]];
  }
}

/** True when `(px, py)` is inside `poly`, by ray casting. */
function pointInPoly(poly: Contour, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as [number, number];
    const [xj, yj] = poly[j] as [number, number];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Ties that stop a stencil's counters falling out.
 *
 * Cut an `8` clean through a plate and the two enclosed islands inside it are attached to
 * nothing — they drop out of the sign, or in a print they sit on the bed as loose ovals. Every
 * stencil alphabet solves this the same way: leave a narrow bridge of material joining each
 * counter to the surrounding field.
 *
 * These are the bridges as solid rectangles; the caller **subtracts** them from the glyph
 * before cutting, so the material they cover is never removed. Each runs vertically from
 * inside its counter out past the top of the glyph that contains it, which is guaranteed to
 * cross the stroke and reach the field beyond.
 *
 * A counter is found by containment rather than by winding: `@vostok/fonts` flips Y on the way
 * out of opentype, which reverses every loop, so signed area is not a reliable "is this a
 * hole" test here. A loop whose centre sits inside an odd number of other loops is a hole.
 */
export function stencilBridges(contours: Shape2D, bridgeWidth = 1.6): Shape2D {
  const w = Math.max(0.3, bridgeWidth) / 2;
  const boxes = contours.map((loop) => bboxOf([loop]));
  const bridges: Shape2D = [];

  for (let i = 0; i < contours.length; i++) {
    const b = boxes[i]!;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;

    // How many other loops contain this one's centre? Odd means it is a counter.
    let depth = 0;
    let outerTop = -Infinity;
    let outerBottom = Infinity;
    for (let j = 0; j < contours.length; j++) {
      if (j === i) continue;
      if (pointInPoly(contours[j]!, cx, cy)) {
        depth++;
        outerTop = Math.max(outerTop, boxes[j]!.maxY);
        outerBottom = Math.min(outerBottom, boxes[j]!.minY);
      }
    }
    if (depth % 2 === 0) continue;

    /*
     * One tie above and one below, not just above.
     *
     * A single tie holds the island perfectly well, and looks like a mistake — an `0` with a
     * bar at the top and nothing at the bottom reads as damage rather than as a stencil.
     * Every stencil alphabet ties symmetrically for exactly that reason, and the pair is also
     * stiffer: the island is carried at both ends instead of cantilevered off one.
     *
     * Both start at the counter's own centre so the island is genuinely held by them.
     */
    bridges.push(ccw([
      [cx - w, cy], [cx + w, cy],
      [cx + w, outerTop + 1], [cx - w, outerTop + 1],
    ]));
    bridges.push(ccw([
      [cx - w, outerBottom - 1], [cx + w, outerBottom - 1],
      [cx + w, cy], [cx - w, cy],
    ]));
  }
  return bridges;
}

/** Shortest distance from a point to any point on a set of contours. */
export function distanceToContours(shape: Shape2D, px: number, py: number): number {
  let best = Infinity;
  for (const loop of shape) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[j]!, b = loop[i]!;
      const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]!) * dx + (py - a[1]!) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(px - (a[0]! + t * dx), py - (a[1]! + t * dy)));
    }
  }
  return best;
}

/**
 * Slides a hole outward until it clears the glyphs, or gives up and says so.
 *
 * The bounding box is not good enough here. A hole can sit in the gap between a 1 and a 2 —
 * inside the box, clear of the ink — and equally a corner hole can be outside the box on one
 * axis and still clipped by a descender. So this measures against the real outlines, and
 * pushes along the direction away from the centre, which is the only direction with room.
 *
 * `limit` is how far out it may go before the hole would break the plate edge.
 */
export function nudgeClear(
  text: Shape2D,
  hole: [number, number],
  radius: number,
  plate: Shape2D,
): { at: [number, number]; clear: boolean } {
  const need = radius + radius * 0.6;
  // A wall between the hole and the plate edge, or the hole is a notch rather than a hole.
  const wall = radius * 0.75;
  const len = Math.hypot(hole[0], hole[1]) || 1;
  const ux = hole[0] / len, uy = hole[1] / len;

  // Best-effort, not all-or-nothing. Giving up and returning the original position left the
  // hole punched through a glyph — the exact failure being fixed. If nothing fully clears,
  // the furthest-out position that still fits the plate is strictly the least bad.
  let best: [number, number] = hole;
  let bestGap = -Infinity;

  for (let step = 0; step <= 200; step++) {
    const s = step * 0.5;
    const x = hole[0] + ux * s;
    const y = hole[1] + uy * s;
    // Bounded by the real outline rather than a radius: a wide, shallow plate has far more
    // room sideways than a single min(width, height) limit would ever allow.
    if (plate.length > 0 && distanceToContours(plate, x, y) < wall + radius) break;
    const gap = distanceToContours(text, x, y);
    if (gap > bestGap) { bestGap = gap; best = [x, y]; }
    if (gap >= need) return { at: [x, y], clear: true };
  }
  return { at: best, clear: false };
}

/**
 * Four holes, one near each corner.
 *
 * Two holes on the centreline let a wide sign rock and, on a tall one, sag at the corners.
 * Four is what a plate over about 150 mm wants, and it is the pattern the acrylic signs this
 * category copies are drilled to.
 */
export function screwHolePositions4(
  plateWidth: number,
  plateHeight: number,
  holeDia: number,
  inset: number,
): Array<[number, number]> {
  const minWall = holeDia * 0.75;
  const x = plateWidth / 2 - Math.min(Math.max(inset, minWall), plateWidth / 2 - holeDia / 2 - minWall) - holeDia / 2;
  const y = plateHeight / 2 - Math.min(Math.max(inset, minWall), plateHeight / 2 - holeDia / 2 - minWall) - holeDia / 2;
  if (!(x > WELD) || !(y > WELD)) return [];
  return [[-x, -y], [x, -y], [-x, y], [x, y]];
}

/**
 * Where the keyhole slots go: symmetric about the centre, near enough the ends to stop the
 * sign pivoting but never so near that the slot breaks the outline.
 *
 * Spacing is a fraction of the width rather than a fixed inset, because a keyhole is drilled
 * into a wall from the exported hole plan — the two have to be far enough apart that a
 * spirit level is worth using, and close enough that both land in the same stud bay.
 */
export function keyholePositions(plateWidth: number): number[] {
  const half = Math.max(WELD, plateWidth * 0.28);
  return plateWidth < 60 ? [0] : [-half, half];
}

/** A keyhole as two stacked cavities. See `keyhole` for what each one is and why. */
export interface Keyhole {
  /** At the back face: the entry circle plus the narrow slot the shank rides in. */
  mouth: Shape2D;
  /** Deeper in: the entry circle plus a head-width channel, so the head can actually slide. */
  chamber: Shape2D;
  /** Where the shank ends up once the sign has dropped — the load-bearing point. */
  restsAt: [number, number];
}

/**
 * A keyhole slot, as an undercut rather than a flat pocket.
 *
 * The version this replaces was wrong twice over, and both are worth writing down because
 * the code confidently asserted the opposite.
 *
 * **1 · It was upside down.** The old comment reasoned "the sign drops onto the screw, so
 * the neck must run down from the hole". The sign dropping is exactly why the neck must run
 * *up*: when the sign falls, the screw — fixed in the wall — travels **upward through the
 * sign's own frame**. So the wide entry has to be at the BOTTOM and the narrow slot above
 * it, which is also how every commercial keyhole hanger and keyhole router bit is cut. Hung
 * the old way the screw stayed in the entry hole with nothing above it to catch on, and the
 * sign lifted straight back off.
 *
 * **2 · A single-depth pocket cannot work at all.** The old shape was one cavity of uniform
 * depth: entry circle unioned with a narrow slot. The screw *head* is wider than the slot,
 * so it could not travel along it — it jammed against the pocket wall the moment the sign
 * moved. A keyhole has to be an undercut: a head-width channel **behind** a shank-width
 * opening, so the head slides hidden while the material either side of the slot traps it.
 *
 * Hence two cavities. `mouth` is cut from the back face to `mouthDepth`; `chamber` continues
 * from there to the full depth. The step between them is the lip the head is captured by.
 *
 * Reference dimensions for a standard #6–#8 screw: 8 mm entry, 4 mm slot, 8 mm of travel,
 * about 3 mm of head depth. Those are the defaults this is sized against.
 */
export function keyhole(
  cx: number,
  cy: number,
  headDia: number,
  shankDia: number,
  travel: number,
): Keyhole {
  const hr = Math.max(WELD, headDia / 2);
  const sr = Math.max(WELD, Math.min(shankDia / 2, hr * 0.75));
  const rise = Math.max(hr, travel);

  /** A slot from the entry centre running UP by `rise`, of radius `r`, round-capped. */
  const slot = (r: number): Contour => ccw(weld([
    [cx + r, cy],
    [cx + r, cy + rise],
    ...Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
      const t = (i / ARC_STEPS) * Math.PI;
      return [cx + Math.cos(t) * r, cy + rise + Math.sin(t) * r] as number[];
    }),
    [cx - r, cy + rise],
    [cx - r, cy],
  ]));

  const entry = ccw(circle(cx, cy, hr));

  return {
    // Entry circle stays full width at the mouth — that is how the head gets in.
    mouth: [entry, slot(sr)],
    // Behind it, the channel is head-width for the whole travel, so the head can slide up.
    chamber: [entry, slot(hr)],
    restsAt: [cx, cy + rise],
  };
}

/**
 * The smallest rotation, in degrees, that fits a `w` x `h` plate on a square `bed` — or
 * `null` if it does not fit at any angle.
 *
 * A long sign is the normal case here, and "larger than a 240 mm bed, print it in pieces"
 * was wrong advice for most of them: a 250 x 45 mm plate sits comfortably across the
 * diagonal of a 256 mm bed. Turning it is what any slicer's arrange does, so the warning
 * should say which angle rather than send someone off to cut their sign in half.
 *
 * Rotating by t makes the footprint `w·cos t + h·sin t` by `w·sin t + h·cos t`. A degree-wise
 * sweep is exact enough to quote and far clearer than the closed form.
 */
export function fitAngleFor(w: number, h: number, bed: number): number | null {
  if (w <= bed && h <= bed) return 0;
  for (let deg = 1; deg <= 89; deg++) {
    const t = (deg * Math.PI) / 180;
    const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    if (w * c + h * s <= bed && w * s + h * c <= bed) return deg;
  }
  return null;
}

/** Bounding box of a set of contours. */
export function bboxOf(shape: Shape2D): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of shape) {
    for (const pt of poly) {
      if (pt[0]! < minX) minX = pt[0]!;
      if (pt[0]! > maxX) maxX = pt[0]!;
      if (pt[1]! < minY) minY = pt[1]!;
      if (pt[1]! > maxY) maxY = pt[1]!;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

/**
 * The plate size for a block of text.
 *
 * Auto-sized from the text's own bounding box plus clearance, which is what every tool in
 * the category does and what none of their users complain about. Returned rather than
 * exposed as parameters so the two can never disagree.
 *
 * **Shape-aware, because a margin that only holds on a rectangle is not a margin.** The old
 * version added `padding * 2` on each axis for every shape, then `plateOutline` cut the
 * corners away again — a pill takes `min(w,h)/2` off each end, a plaque cuts 45°. The space
 * the margin had just reserved was exactly the space the outline removed. Measured on the
 * office text: a pill plate came out 97.4 x 75.8 mm with the text *overrunning the outline
 * by 1.49 mm*, and the apartment preset kept 2.70 mm of clearance where 10 mm was asked for.
 *
 * So the question this answers is not "text plus padding" but "how big must this outline be
 * for the text box to sit inside it with `clearance` everywhere". Each shape has a closed
 * form; none of them needs to iterate.
 *
 * `clearance` is the user's margin **plus the frame width**, when a frame is on: a frame is
 * a wall standing inside the outline, and nothing used to account for it.
 */
export function plateSizeFor(
  textBox: { minX: number; maxX: number; minY: number; maxY: number },
  clearance: number,
  shape: PlateShape = 'rect',
  cornerRadius = 0,
): { width: number; height: number } {
  const tw = Math.max(0, textBox.maxX - textBox.minX);
  const th = Math.max(0, textBox.maxY - textBox.minY);
  const c = Math.max(0, clearance);

  // Every shape here is flat across the top and bottom of its centreline, so the height is
  // always the simple case. Only the width has to pay for what the corners take away.
  const height = th + c * 2;

  // Clearance is the *distance to the outline*, not the horizontal gap to it. Near a curve
  // those differ — the shortest line from the text's corner to an arc is a diagonal — and
  // solving for the horizontal gap leaves the corner short of the margin the user asked
  // for. Every case below is solved on the perpendicular distance instead, which is what
  // the eye sees and what `outlines.check.mjs` measures.
  const solve = (w: number): number => {
    switch (shape) {
      case 'pill': {
        // Cap radius is H/2, centred at x = W/2 - H/2. Requiring the text's corner to sit
        // `c` inside that circle collapses: with H already th + 2c, the corner has to land
        // exactly on the cap centre's vertical, so W = tw + H.
        return tw + height;
      }
      case 'rounded': {
        // Corner arc of radius r centred at (W/2 - r, H/2 - r) — the same collapse gives
        // W = tw + 2r. Below r = c the text corner never reaches the arc at all and the
        // plain rectangle answer is already enough.
        const r = Math.max(0, Math.min(cornerRadius, Math.min(w, height) / 2));
        return tw + 2 * Math.max(c, r);
      }
      case 'plaque': {
        // The cut is a 45 degree line, so a perpendicular clearance of c costs c * sqrt(2)
        // measured along the axes rather than c.
        const cut = Math.max(0, Math.min(Math.max(cornerRadius, 2), Math.min(w, height) / 2));
        return tw + 2 * Math.max(c, cut + c * (Math.SQRT2 - 1));
      }
      case 'rect':
      case 'none':
      default:
        return tw + c * 2;
    }
  };

  // `roundedRect` and `plaque` clamp their radius against the finished size, so the answer
  // feeds back into its own input. Width only ever grows here, so a few passes settle it.
  let width = tw + c * 2;
  for (let i = 0; i < 4; i++) width = Math.max(width, solve(width));

  return { width: Math.max(WELD, width), height: Math.max(WELD, height) };
}
