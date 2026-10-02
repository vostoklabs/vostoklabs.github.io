// Where a hole can actually go: the point inside a design that keeps a given clearance from
// every edge it has.
//
// Two designs need the same answer and neither can ask manifold for it (a template runs before
// the worker). A layered keychain's hole only registers the stack if it lands inside the
// SMALLEST piece — the lettering itself — and a frameless split monogram's hanging hole has to
// miss the 6 mm rail that is the only thing holding the letter's two halves together. Both are
// "find me a spot with `want` mm of material all round", so both ask here.
//
// The inside test is NONZERO WINDING, which is what a font means. Glyphs do not arrive as tidy
// outer-ring-plus-holes islands: Cinzel's "M" is eight overlapping strokes wound the same way
// (even-odd would read every overlap as air) and an "O" is a ring inside a ring wound the other
// way (a union test would read its counter as material). Summing the signed crossings is right
// for both, and it is the same rule the SVG the customer gets is drawn with.
//
// Pure: millimetres, Y up, no DOM and no wasm (tests/node/inscribe.test.mjs).
import { bboxOf, signedArea, type Box, type Pt, type Shapes } from '@vostok/laser';

export interface InscribeOpts {
  /** Clearance from the outline, mm — usually `dia / 2 + ring`. */
  want: number;
  /** Clearance from the design's own COUNTERS, when that differs: a counter is cut back to its
   *  original size on a hugging piece, so the border it leaves is not the one the outline gives.
   *  Default `want`. */
  fromHoles?: number;
  /** Only look inside this box — the top of a letter, the fat half of a shape. */
  region?: Box;
  /** Ties go to the candidate nearest this point; absent, to the leftmost. */
  prefer?: Pt;
  /** Sampling pitch, mm. Default a third of `want`, never under 0.4. */
  step?: number;
}

/** One ring, with what its winding says it is. */
interface Edge {
  ring: Pt[];
  /** +1 or −1: a counter is wound against the contour that encloses it. */
  sign: number;
  counter: boolean;
}

/** Inside by nonzero winding: the signed crossings of a ray to the right. */
function insideNonZero(edges: Edge[], p: Pt): boolean {
  let winding = 0;
  for (const { ring } of edges) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]!;
      const b = ring[i]!;
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]) > 0) winding++;
      } else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]) < 0) {
        winding--;
      }
    }
  }
  return winding !== 0;
}

/** How far `p` is from the nearest edge of these rings, mm. */
function distanceTo(edges: Edge[], p: Pt, counters: boolean): number {
  let d = Infinity;
  for (const e of edges) {
    if (e.counter !== counters) continue;
    const ring = e.ring;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k]!;
      const b = ring[(k + 1) % ring.length]!;
      const vx = b[0] - a[0];
      const vy = b[1] - a[1];
      const len2 = vx * vx + vy * vy || 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
      const dd = Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
      if (dd < d) d = dd;
    }
  }
  return d;
}

/**
 * A point with `want` mm of material all round it, or null when the design has nowhere to put
 * one. The grid is coarse on purpose: this answers "is there room, and roughly where", and the
 * caller's own `holdInside` does the final millimetre.
 */
export function inscribedPoint(shapes: Shapes, o: InscribeOpts): Pt | null {
  if (!shapes.length || !(o.want > 0)) return null;
  const rings = shapes.flat().filter((r) => r.length >= 3);
  if (!rings.length) return null;
  // The winding that means material is the biggest ring's: everything wound against it is a
  // counter, which is how a font draws the inside of an "o".
  let solid = 0;
  let biggest = 0;
  for (const r of rings) {
    const a = signedArea(r);
    if (Math.abs(a) > biggest) { biggest = Math.abs(a); solid = Math.sign(a); }
  }
  const edges: Edge[] = rings.map((ring) => {
    const sign = Math.sign(signedArea(ring)) || 1;
    return { ring: ring as Pt[], sign, counter: sign !== solid };
  });

  const box = o.region ?? bboxOf(shapes);
  const step = Math.max(0.4, o.step ?? o.want / 3);
  const fromHoles = o.fromHoles ?? o.want;
  const nx = Math.floor((box.maxX - box.minX) / step);
  const ny = Math.floor((box.maxY - box.minY) / step);
  if (nx < 1 || ny < 1) return null;
  const hasCounters = edges.some((e) => e.counter);
  let best: Pt | null = null;
  let bestCost = Infinity;
  for (let iy = 0; iy <= ny; iy++) {
    const y = box.minY + ((box.maxY - box.minY) * iy) / ny;
    for (let ix = 0; ix <= nx; ix++) {
      const x = box.minX + ((box.maxX - box.minX) * ix) / nx;
      const p: Pt = [x, y];
      // Nearest to what was asked for, or leftmost — a ring belongs at the start of a word.
      const cost = o.prefer ? Math.hypot(x - o.prefer[0], y - o.prefer[1]) : x;
      if (cost >= bestCost) continue;
      // Cheapest test first: most of a bounding box is not material at all.
      if (!insideNonZero(edges, p)) continue;
      if (distanceTo(edges, p, false) < o.want) continue;
      if (hasCounters && distanceTo(edges, p, true) < fromHoles) continue;
      bestCost = cost;
      best = p;
    }
  }
  return best;
}
