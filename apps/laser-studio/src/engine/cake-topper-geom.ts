// Scanline geometry for the cake topper: everything the template has to know about its own
// artwork before the engine sees it — where the word spaces are, where the baseline is, how much
// daylight is left between two stacked lines, where the stick can bite into a letter, and how
// thin the thinnest stroke will be.
//
// All of it is pure polygon work on the main thread (millimetres, Y up, no manifold, no DOM), so
// it runs inside a live preview and can be asserted in node. The one primitive underneath is a
// scan line: at a given x (or y), every material interval the artwork covers, merged across
// islands. Even-odd per island is what reads a counter as a hole whichever way its ring is wound.
import { bboxOf, heartRing, starRing, type Pt, type Shapes } from '@vostok/laser';

/** One material interval on a scan line: [low, high]. */
export type Span = [number, number];

/** Overlapping or touching intervals folded into one, in order. */
function merge(spans: Span[]): Span[] {
  if (spans.length < 2) return spans;
  spans.sort((a, b) => a[0] - b[0]);
  const out: Span[] = [spans[0]!];
  for (let i = 1; i < spans.length; i++) {
    const s = spans[i]!;
    const last = out[out.length - 1]!;
    if (s[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

/**
 * The material intervals one scan line crosses. `axis` 0 scans a column at x, 1 scans a row at y.
 *
 * Edges are half-open in the scan coordinate (`lo <= at < hi`) so a vertex counts exactly once —
 * without that rule the apex of an "A" registers twice or not at all depending on a rounding
 * error, and the interval list comes back inverted.
 */
function spansAt(shapes: Shapes, at: number, axis: 0 | 1): Span[] {
  const out: Span[] = [];
  for (const island of shapes) {
    const hits: number[] = [];
    for (const ring of island) {
      if (ring.length < 3) continue;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]! as Pt;
        const b = ring[(i + 1) % ring.length]! as Pt;
        const a0 = a[axis];
        const b0 = b[axis];
        if (a0 === b0) continue;
        if (at < Math.min(a0, b0) || at >= Math.max(a0, b0)) continue;
        const t = (at - a0) / (b0 - a0);
        hits.push(a[(1 - axis) as 0 | 1] + t * (b[(1 - axis) as 0 | 1] - a[(1 - axis) as 0 | 1]));
      }
    }
    if (hits.length < 2) continue;
    hits.sort((p, q) => p - q);
    for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i]!, hits[i + 1]!]);
  }
  return merge(out);
}

/** Material intervals in this column, low to high. */
export const columnSpans = (shapes: Shapes, x: number): Span[] => spansAt(shapes, x, 0);

/** Material intervals in this row, left to right — the same scan, turned on its side. The
 *  hug bridges (`nearestBridge`) read it to lay a word-gap join flat along the baseline. */
export const rowSpans = (shapes: Shapes, y: number): Span[] => spansAt(shapes, y, 1);

/** Column pitch every sweep in here uses: fine enough to find a 1 mm stem, coarse enough that a
 *  300 mm piece is 600 scans. */
const STEP = 0.5;

/**
 * The baseline across a range of columns: the mode of the per-column floors, not their minimum.
 *
 * A "y" or a "g" drops one column's floor 8 mm below the line the word actually stands on, and a
 * connector bar hung off that reads as a dash somebody forgot to delete. The mode is the height
 * most of the ink in range sits on, which is the baseline. Empty columns contribute nothing, so
 * a range that spans a word space answers with the ink either side of it.
 */
export function baselineOf(shapes: Shapes, from: number, to: number): number {
  const floors: number[] = [];
  for (let x = from; x <= to + 1e-9; x += STEP) {
    const s = columnSpans(shapes, x);
    if (s.length) floors.push(s[0]![0]);
  }
  if (!floors.length) return bboxOf(shapes).minY;
  // 0.5 mm bins; the fullest bin wins and its own mean is the answer.
  const bins = new Map<number, number[]>();
  for (const f of floors) {
    const k = Math.round(f * 2);
    const list = bins.get(k);
    if (list) list.push(f);
    else bins.set(k, [f]);
  }
  let best: number[] = [];
  for (const list of bins.values()) if (list.length > best.length) best = list;
  return best.reduce((a, f) => a + f, 0) / best.length;
}

/**
 * The smallest daylight between the TOP of `below` and the BOTTOM of `above`, column by column —
 * negative once they interpenetrate, `Infinity` when they share no column at all.
 *
 * The number a stacked topper turns on. A bounding-box gap answers a different question: two
 * boxes can overlap by millimetres with nothing but air between the ink, which is how "Mr & Mrs"
 * came to hang over "Ramsey" on a pair of twigs.
 */
export function clearance(below: Shapes, above: Shapes): number {
  if (!below.length || !above.length) return Infinity;
  const b = bboxOf(above);
  let best = Infinity;
  for (let x = b.minX; x <= b.maxX + 1e-9; x += STEP) {
    const m = columnSpans(below, x);
    const o = columnSpans(above, x);
    if (!m.length || !o.length) continue;
    best = Math.min(best, o[0]![0] - m[m.length - 1]![1]);
  }
  return best;
}

/**
 * The islands grouped into the bodies they will actually cut as, as INDEX lists: two outlines
 * whose boxes come within `pad` of each other are one piece once the thicken and the smoothing
 * have closed what they can, so they settle together.
 *
 * Indices rather than shapes because the glyphs are handed to the engine in reading order and the
 * seam pass depends on that order — a group that came back as its own array of outlines would
 * have to be spliced back in, and the order is what says which letter's edge is buried in which.
 *
 * Boxes, not outlines: after the weld walk the letters of a word overlap in x long before a
 * bespoke intersection test would say so, and the question here is only "will these end up
 * joined", which a box answers well enough to keep the ampersand of "Mr & Mrs" its own group.
 */
export function clusterIndices(islands: Shapes, pad: number): number[][] {
  const boxes = islands.map((i) => bboxOf([i]));
  const owner = islands.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (owner[r] !== r) r = owner[r]!;
    let k = i;
    while (owner[k] !== r) { const next = owner[k]!; owner[k] = r; k = next; }
    return r;
  };
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY) owner[find(i)] = find(j);
    }
  }
  const out = new Map<number, number[]>();
  islands.forEach((_, i) => {
    const k = find(i);
    const g = out.get(k);
    if (g) g.push(i);
    else out.set(k, [i]);
  });
  return [...out.values()];
}

export interface Seat {
  /** The highest underside across the window — a stick topped here is inside the material
   *  everywhere it touches. */
  floor: number;
  /** The thinnest the lowest run of material gets across the window, mm. */
  span: number;
  /** Share of the sampled columns that have any material at all, 0..1. */
  coverage: number;
}

/** What a stick standing between `x0` and `x1` would meet: the underside of the lowest material. */
export function legSeat(shapes: Shapes, x0: number, x1: number): Seat | null {
  let floor = -Infinity;
  let span = Infinity;
  let hits = 0;
  let total = 0;
  for (let x = x0; x <= x1 + 1e-9; x += STEP) {
    total++;
    const s = columnSpans(shapes, x);
    if (!s.length) continue;
    hits++;
    const low = s[0]!;
    floor = Math.max(floor, low[0]);
    span = Math.min(span, low[1] - low[0]);
  }
  if (!hits) return null;
  return { floor, span, coverage: hits / Math.max(1, total) };
}

/**
 * The thinnest sustained stroke, mm: the 5th percentile of every material interval a sweep of
 * scan lines crosses, both axes.
 *
 * An estimate, deliberately. The exact answer is an erosion, which needs manifold and so cannot
 * run where this runs; a percentile is stable across faces and it is measured on the real
 * outlines rather than inferred from the font's weight. The 5th, not the minimum, because a scan
 * line that clips the top of a round stroke tangentially measures near zero in every typeface
 * ever drawn.
 */
export function thinnestStroke(shapes: Shapes, samples = 160): number {
  if (!shapes.length) return 0;
  const b = bboxOf(shapes);
  const widths: number[] = [];
  const sweep = (lo: number, hi: number, axis: 0 | 1) => {
    if (!(hi > lo)) return;
    for (let i = 0; i < samples; i++) {
      const at = lo + ((i + 0.5) / samples) * (hi - lo);
      for (const [a, c] of spansAt(shapes, at, axis)) widths.push(c - a);
    }
  };
  sweep(b.minX, b.maxX, 0);
  sweep(b.minY, b.maxY, 1);
  if (!widths.length) return 0;
  widths.sort((p, q) => p - q);
  return widths[Math.min(widths.length - 1, Math.floor(widths.length * 0.05))]!;
}

/** The smallest island on the piece, measured across its narrowest side — the dot of an "i", an
 *  accent, an apostrophe. What the weld or a bridge has to hold on to. */
export function smallestIsland(shapes: Shapes): number {
  let best = Infinity;
  for (const island of shapes) {
    if (!island.length) continue;
    const b = bboxOf([island]);
    best = Math.min(best, Math.min(b.maxX - b.minX, b.maxY - b.minY));
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * The stick: `w` wide from `top` (buried in the lettering) down to the start of the taper, then
 * a straight point at `bottom`.
 *
 * A point, not a rounded end — a tapered spike parts the icing, and a
 * round end pushes icing aside instead of parting it. The taper is `point` mm long; the sides are
 * parallel above it, so the width the customer asked for is the width that carries the load.
 */
export function stickRing(cx: number, top: number, bottom: number, w: number, point: number): Pt[] {
  const half = Math.max(0.2, w / 2);
  // Where the taper starts. Clamped under `top` so a very short stick is still a spike and not an
  // inverted wedge.
  const shoulder = Math.min(Math.max(bottom + Math.max(0, point), bottom + 0.2), top - 0.1);
  return [[cx, bottom], [cx + half, shoulder], [cx + half, top], [cx - half, top], [cx - half, shoulder]];
}

/**
 * The accent that sits at the top-right of the lettering, `height` mm tall, centred on the
 * origin: a heart, a star, or a balloon.
 *
 * Parametric, never traced: the heart and the star are the shared blanks
 * `@vostok/laser` already draws, and the balloon is an ellipse with a knot under it — the shape
 * a topper hangs beside "Happy Birthday". No string: a 1 mm thread of plywood is not
 * a part, and the knot welds straight into the lettering instead.
 *
 * The star's inner radius is 0.46 rather than the blank's 0.45, so its points carry a couple of
 * millimetres more at the waist — this one is cut at 30–40 mm and then pushed into a cake.
 */
export function accentShapes(kind: string, height: number): Shapes {
  const h = Math.max(1, height);
  if (kind === 'heart') return [[heartRing(1.05 * h, h)]];
  if (kind === 'star') return [[starRing(h, h, 5, 0.46)]];
  if (kind !== 'balloon') return [];
  const w = 0.72 * h;
  const body: Pt[] = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    body.push([(w / 2) * Math.cos(t), 0.08 * h + 0.42 * h * Math.sin(t)]);
  }
  // The knot: a stubby wedge whose top edge is inside the body, so the two rings union into one
  // balloon with no bridge and nothing under 2 mm.
  const knot: Pt[] = [[0, -0.5 * h], [0.11 * w, -0.3 * h], [-0.11 * w, -0.3 * h]];
  return [[body], [knot]];
}
