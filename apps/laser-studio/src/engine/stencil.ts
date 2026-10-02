// Stencil bridges: what keeps the inside of an "o" from falling out (G14).
//
// "Letters: Cut out" punches the glyphs through the plate, and every closed counter — o, a, e,
// B, 0, R, the eye of an anchor — is then a loose island. The preview shows the piece intact;
// the customer finds out at the laser, picking the middles of their letters off the bed.
//
// The fix is the one every stencil maker uses: leave a small bar of material joining the counter
// to the world outside the letter. The bar is SUBTRACTED from what gets punched, so it survives
// as material and the counter hangs off it. A counter worth more than 25 mm² gets a second bar
// roughly opposite the first, so a big "O" does not hinge on one point; a counter narrower than
// a millimetre is scrap either way and is simply punched with the letter.
import { bboxOf, signedArea, subtractShapes, unionShapes, type Shapes } from '@vostok/laser';

type Pt = [number, number];

/** The default bar, mm. A bridge thinner than this snaps out of 3 mm ply when you lift the
 *  piece, so a template asking for less gets this instead. */
export const MIN_BRIDGE = 1.5;
/** A counter bigger than this hangs off two bars, not one. */
const TWO_BARS_OVER = 25;
/** A counter whose box's short side is under this is filled instead of bridged. */
const MIN_COUNTER = 1;

export interface StencilResult {
  /** What to punch through the plate: the layer's shapes with the bars taken out and the
   *  slivers filled. */
  punch: Shapes;
  /** The bars themselves — one island each, for a test to measure. */
  bars: Shapes;
  /** Counters too narrow to keep, punched with their letter. */
  filled: number;
}

/** Whether any two islands' boxes meet — the cheap question that decides whether a union could
 *  reveal a counter no single contour encloses. Boxes, not outlines: a false yes costs one
 *  boolean, a false no costs a customer their letter. */
function anyOverlap(shapes: Shapes): boolean {
  if (shapes.length < 2) return false;
  const boxes = shapes.map((isl) => bboxOf([isl]));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY) return true;
    }
  }
  return false;
}

const outerOf = (island: Shapes[number]): Pt[] =>
  island.reduce((a, r) => (Math.abs(signedArea(r)) > Math.abs(signedArea(a)) ? r : a), island[0] ?? []);

/** The closest point on a ring's EDGES to `p` — the edge, not the nearest vertex, so a straight
 *  stroke answers with the point across from you rather than its far corner. */
function nearestOnRing(p: Pt, ring: Pt[]): { q: Pt; d: number } {
  let q: Pt = p;
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    const c: Pt = [a[0] + t * vx, a[1] + t * vy];
    const dd = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (dd < d) { d = dd; q = c; }
  }
  return { q, d };
}

/** A bar of `width` from `p` to `q`, overhanging half its width at each end so the boolean
 *  bites cleanly into both sides. Anything past the stroke is outside the punch anyway. */
function barRing(p: Pt, q: Pt, width: number): Shapes[number] {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const dx = (q[0] - p[0]) / len;
  const dy = (q[1] - p[1]) / len;
  const r = width / 2;
  return [[
    [p[0] - dx * r - dy * r, p[1] - dy * r + dx * r],
    [q[0] + dx * r - dy * r, q[1] + dy * r + dx * r],
    [q[0] + dx * r + dy * r, q[1] + dy * r - dx * r],
    [p[0] - dx * r + dy * r, p[1] - dy * r - dx * r],
  ]];
}

/**
 * The punch a cut-out layer should really make: its counters bridged, its slivers filled.
 *
 * Every hole of every island is a counter that would come loose; the bar runs from the hole's
 * ring to the ring that encloses it, across the letter's own stroke, which is the shortest way
 * out and therefore the least visible.
 *
 * Islands that OVERLAP are unioned first, and that is not tidiness. A font is free to draw one
 * glyph as several overlapping contours — Cinzel's "B" is a serpentine bowl, a stem and two
 * serifs — and then the counters exist only in their union: no contour encloses them, so the
 * islands arriving here have no holes to bridge and the middles of the B fell out of "Bob" with
 * nothing said. Unioning is also what the plate does one step later, so this asks the same
 * question the cut will answer. Shapes that touch nothing — a slot, a screw hole, letters set
 * apart — skip it and come back exactly as they arrived, boolean round trip and all.
 */
export function stencilPunch(wasm: any, shapes: Shapes, bridge = MIN_BRIDGE): StencilResult {
  const width = Math.max(0.6, bridge);
  const bars: Shapes = [];
  const kept: Shapes = [];
  let filled = 0;
  const merged = anyOverlap(shapes) ? unionShapes(wasm, shapes) : shapes;
  for (const island of merged) {
    if (island.length < 2) { kept.push(island); continue; }
    const outer = outerOf(island);
    const holes = island.filter((r) => r !== outer && r.length >= 3);
    const live: Pt[][] = [];
    for (const hole of holes) {
      const box = bboxOf([[hole]]);
      if (Math.min(box.maxX - box.minX, box.maxY - box.minY) < MIN_COUNTER) { filled++; continue; }
      live.push(hole);
      // Every vertex of the counter, by how far it is from the stroke's far side.
      const cands = hole
        .map((p) => ({ p, ...nearestOnRing(p, outer) }))
        .filter((c) => c.d > 1e-6)
        .sort((a, b) => a.d - b.d);
      const first = cands[0];
      if (!first) continue;
      bars.push(barRing(first.p, first.q, width));
      if (Math.abs(signedArea(hole)) > TWO_BARS_OVER) {
        const ux = (first.q[0] - first.p[0]) / first.d;
        const uy = (first.q[1] - first.p[1]) / first.d;
        // The nearest crossing that points the other way, so the counter is held top and bottom
        // rather than twice on one side.
        const opposite = cands.find((c) => ((c.q[0] - c.p[0]) * ux + (c.q[1] - c.p[1]) * uy) / c.d < -0.3);
        if (opposite) bars.push(barRing(opposite.p, opposite.q, width));
      }
    }
    kept.push([outer, ...live]);
  }
  if (!bars.length) return { punch: kept, bars, filled };
  return { punch: subtractShapes(wasm, kept, bars), bars, filled };
}
