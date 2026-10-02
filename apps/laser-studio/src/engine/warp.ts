// Distorting outlines. Every warp in here is a point map over `Shapes`: the island and ring
// structure comes through untouched, so a letter keeps its counters and a warped word welds the
// same way the unwarped one did.
//
// Pure geometry — millimetres, Y up, no DOM and no manifold — so every rule can be asserted in
// node (tests/node/warp.test.mjs) rather than looked at and hoped about.
//
// The one thing a point map cannot do is bend an edge it was given no points on: the side of an
// "H" is two points, and two points stay a straight line however you move them. So every warp
// subdivides first, and `subdivideShapes` is exported because a caller warping twice wants to
// pay for that once.
import { bboxOf, signedArea, type Box, type Pt, type Shapes } from '@vostok/laser';

/** Longest edge a warp will bend over, mm. Fine enough that a 6 mm letter curves smoothly on an
 *  arch; coarse enough that a word is a few thousand points, not a few hundred thousand. */
const WARP_SEG = 0.75;

/** Ray-cast grid for `warpToSilhouette`, mm. The silhouette is sampled once at this pitch and
 *  read back with a lerp, so a 4000-point word costs 4000 lookups, not 4000 scans of the outline. */
const PROFILE_GRID = 0.25;

/** Most points a single edge may be split into — a guard against a silly `maxSeg`, not a limit
 *  anything real runs into (a 300 mm edge at 0.75 mm is 400). */
const MAX_SPLIT = 4096;

const clone = (shapes: Shapes): Shapes => shapes.map((island) => island.map((ring) => ring.map(([x, y]): Pt => [x, y])));

/**
 * Insert points so no edge is longer than `maxSeg` mm, leaving the shape identical.
 *
 * This is what makes a warp look like a warp: a straight edge bends only if it has points in the
 * middle to bend.
 */
export function subdivideShapes(shapes: Shapes, maxSeg = WARP_SEG): Shapes {
  if (!(maxSeg > 0)) return clone(shapes);
  return shapes.map((island) =>
    island.map((ring) => {
      if (ring.length < 2) return ring.map(([x, y]): Pt => [x, y]);
      const out: Pt[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        out.push([a[0], a[1]]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.min(Math.max(Math.ceil(len / maxSeg), 1), MAX_SPLIT);
        for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      return out;
    }),
  );
}

/**
 * Subdivide, move every point, and keep each ring's winding.
 *
 * The winding repair is not decoration: a taper through zero, or a fisheye past −1, mirrors the
 * plane, and a mirrored ring is a ring wound the other way — which is exactly how
 * `islandsFromContours` and the CSG downstream tell a counter from material. Without this an
 * over-driven warp turns the hole in an "o" into a solid dot.
 */
function warpPoints(shapes: Shapes, fn: (p: Pt) => Pt, maxSeg = WARP_SEG): Shapes {
  return subdivideShapes(shapes, maxSeg).map((island) =>
    island.map((ring) => {
      const before = signedArea(ring);
      const out = ring.map(fn);
      const after = signedArea(out);
      return before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after) ? out.reverse() : out;
    }),
  );
}

// ------------------------------------------------------------------ the silhouette warp --

export interface SilhouetteWarpOptions {
  /** Inset from the silhouette's left and right ends, mm. */
  padX?: number;
  /** Inset from the silhouette's top and bottom at every x, mm. */
  padY?: number;
  /**
   * `fill` stretches the text's own height to the silhouette's height at every x — the carrot,
   * the fish, the banner: the word IS the shape.
   *
   * `height` keeps the text's proportions (one scale for the whole word, the tightest point it
   * passes through decides it) and rides the silhouette's midline. Use it when the letters must
   * stay readable — and give it a `padX`, because the text is always spread across the full
   * width, and on a shape that comes to a point the tightest point is then a height of zero.
   */
  mode?: 'fill' | 'height';
}

/** The silhouette's vertical extent at each grid x, with the gaps filled from the nearest x that
 *  has any: reading past the end of the shape clamps rather than collapsing to nothing. */
interface Profile {
  x0: number;
  step: number;
  count: number;
  bottom: Float64Array;
  top: Float64Array;
  /** False when the silhouette produced no crossings anywhere — a degenerate input. */
  ok: boolean;
}

/**
 * Where sample `i` is cast. Every sample sits on the grid except the last, which is pulled a
 * hair inside the shape: a ray cast exactly at the right-hand extremity passes through a vertex,
 * and the half-open rule below — rightly — hands that vertex to neither of the two edges that
 * meet there. The sample would then find no crossings at all and fall back to its neighbour,
 * which is how a word warped into an ellipse ended up 1.2 mm outside it at the tip.
 */
const sampleX = (p: { x0: number; step: number; count: number }, i: number): number =>
  i === p.count - 1 ? p.x0 + i * p.step - p.step * 1e-9 : p.x0 + i * p.step;

/** The island's outer ring. The contract puts it first, but a shape built by another route can
 *  hand back an island in any order, so take the biggest — the rule `build.ts` already uses. */
function outerRing(island: Shapes[number]): Shapes[number][number] | undefined {
  let best = island[0];
  for (const r of island) if (best && Math.abs(signedArea(r)) > Math.abs(signedArea(best))) best = r;
  return best;
}

/**
 * Ray-cast every outer ring at a fixed grid of x and keep the lowest and highest crossing.
 *
 * Edges are half-open in x — an edge spans `[min, max)` — which is the rule that makes a vertex
 * count exactly once. Without it the two edges meeting at the tip of a carrot both register, or
 * neither does, depending on the sign of a rounding error.
 */
function silhouetteProfile(silhouette: Shapes, box: Box): Profile {
  const width = Math.max(box.maxX - box.minX, 1e-9);
  const n = Math.min(Math.max(Math.ceil(width / PROFILE_GRID), 1), 20000);
  const count = n + 1;
  const step = width / n;
  const x0 = box.minX;
  const bottom = new Float64Array(count).fill(Infinity);
  const top = new Float64Array(count).fill(-Infinity);
  const grid = { x0, step, count };

  for (const island of silhouette) {
    const ring = outerRing(island);
    if (!ring || ring.length < 3) continue;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (a[0] === b[0]) continue; // a vertical edge crosses no vertical ray
      const lo = Math.min(a[0], b[0]);
      const hi = Math.max(a[0], b[0]);
      // The index range is a bound; `lo <= x < hi` on the sample's own x is the rule.
      const from = Math.max(0, Math.ceil((lo - x0) / step) - 1);
      const to = Math.min(count - 1, Math.ceil((hi - x0) / step) + 1);
      const slope = (b[1] - a[1]) / (b[0] - a[0]);
      for (let k = from; k <= to; k++) {
        const x = sampleX(grid, k);
        if (x < lo || x >= hi) continue;
        const y = a[1] + (x - a[0]) * slope;
        if (y < bottom[k]!) bottom[k] = y;
        if (y > top[k]!) top[k] = y;
      }
    }
  }

  // Fill the samples that caught nothing (a tip landing between two grid lines, a gap between
  // two islands) from the nearest sample that did — "clamp to the nearest x that has crossings".
  let first = -1;
  for (let i = 0; i < count; i++) if (bottom[i]! <= top[i]!) { first = i; break; }
  if (first < 0) return { x0, step, count, bottom, top, ok: false };
  for (let i = first - 1; i >= 0; i--) { bottom[i] = bottom[i + 1]!; top[i] = top[i + 1]!; }
  for (let i = first + 1; i < count; i++) {
    if (bottom[i]! > top[i]!) { bottom[i] = bottom[i - 1]!; top[i] = top[i - 1]!; }
  }
  return { x0, step, count, bottom, top, ok: true };
}

/** The extent at any x, lerped between the two grid samples either side and clamped at the ends. */
function extentAt(p: Profile, x: number): { bottom: number; top: number } {
  const f = (x - p.x0) / p.step;
  if (!(f > 0)) return { bottom: p.bottom[0]!, top: p.top[0]! };
  if (f >= p.count - 1) return { bottom: p.bottom[p.count - 1]!, top: p.top[p.count - 1]! };
  const i = Math.floor(f);
  const t = f - i;
  return {
    bottom: p.bottom[i]! + (p.bottom[i + 1]! - p.bottom[i]!) * t,
    top: p.top[i]! + (p.top[i + 1]! - p.top[i]!) * t,
  };
}

/**
 * Map the text's bounding box onto a silhouette: x is spread across the silhouette's width, and
 * at every x the text's vertical extent becomes the silhouette's own extent there.
 *
 * This is the carrot / fish / banner look — the word does not sit on the shape, it *is* the
 * shape. `silhouette` is only read for its outline (every island's outer ring); its holes are
 * ignored, because a hole is not a boundary the text should be squeezed against.
 */
export function warpToSilhouette(shapes: Shapes, silhouette: Shapes, opts: SilhouetteWarpOptions = {}): Shapes {
  const padX = opts.padX ?? 0;
  const padY = opts.padY ?? 0;
  const mode = opts.mode ?? 'fill';
  if (!shapes.length || !silhouette.length) return clone(shapes);

  const t = bboxOf(shapes);
  const tw = t.maxX - t.minX;
  const th = t.maxY - t.minY;
  const tyc = (t.minY + t.maxY) / 2;
  const s = bboxOf(silhouette);
  const span = s.maxX - s.minX - 2 * padX;
  if (tw <= 1e-9 || th <= 1e-9 || span <= 1e-9) return clone(shapes);

  const profile = silhouetteProfile(silhouette, s);
  if (!profile.ok) return clone(shapes);
  const xAt = (x: number) => s.minX + padX + ((x - t.minX) / tw) * span;

  if (mode === 'height') {
    // One scale for the whole word, set by the tightest point it has to pass through — sampled
    // on the same grid the profile was built on, plus the two exact ends.
    let tightest = Infinity;
    const consider = (x: number) => {
      const e = extentAt(profile, x);
      tightest = Math.min(tightest, e.top - e.bottom - 2 * padY);
    };
    consider(xAt(t.minX));
    consider(xAt(t.maxX));
    const from = Math.max(0, Math.floor((xAt(t.minX) - profile.x0) / profile.step));
    const to = Math.min(profile.count - 1, Math.ceil((xAt(t.maxX) - profile.x0) / profile.step));
    for (let i = from; i <= to; i++) consider(profile.x0 + i * profile.step);
    const k = Math.max(tightest, 0) / th;
    return warpPoints(shapes, ([x, y]): Pt => {
      const X = xAt(x);
      const e = extentAt(profile, X);
      return [X, (e.bottom + e.top) / 2 + (y - tyc) * k];
    });
  }

  return warpPoints(shapes, ([x, y]): Pt => {
    const X = xAt(x);
    const e = extentAt(profile, X);
    const avail = e.top - e.bottom - 2 * padY;
    // Thinner than the padding asks for (the pointed end of a carrot): sit on the midline rather
    // than turn the letter inside out.
    if (avail <= 0) return [X, (e.bottom + e.top) / 2];
    return [X, e.bottom + padY + ((y - t.minY) / th) * avail];
  });
}

// --------------------------------------------------------------------------- the rest --

/**
 * Vertical scale ramped across the text: `leftScale` at its left edge, `rightScale` at its
 * right, about the text's vertical centre. The swash / speed-line look, and the cheapest way to
 * make a name follow a wedge.
 */
export function warpTaper(shapes: Shapes, leftScale: number, rightScale: number): Shapes {
  if (!shapes.length) return clone(shapes);
  const b = bboxOf(shapes);
  const w = b.maxX - b.minX;
  const cy = (b.minY + b.maxY) / 2;
  if (w <= 1e-9) return clone(shapes);
  return warpPoints(shapes, ([x, y]): Pt => {
    const k = leftScale + ((x - b.minX) / w) * (rightScale - leftScale);
    return [x, cy + (y - cy) * k];
  });
}

/**
 * Bend the text along a circular arc: the middle ends up `riseMm` above the ends (positive is a
 * rainbow, negative a valley). Every point moves along the arc's normal at its own x, so the
 * letters lean out from the curve instead of shearing.
 *
 * The line that becomes the arc is the text's vertical centre, which is what makes the rise
 * measurable from the outside: the middle of the word rises by exactly `riseMm` relative to its
 * ends. Ink above that line rides a slightly larger radius and so climbs a hair further — that
 * is the arc being an arc, not an error.
 */
export function warpArch(shapes: Shapes, riseMm: number): Shapes {
  if (!shapes.length || Math.abs(riseMm) < 1e-6) return subdivideShapes(shapes);
  const b = bboxOf(shapes);
  const w = b.maxX - b.minX;
  if (w <= 1e-9) return clone(shapes);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const sign = riseMm < 0 ? -1 : 1;
  const h = Math.abs(riseMm);
  // Radius from chord and rise: R = (c²/4 + h²) / 2h, the circle through both ends and the apex.
  const R = ((w * w) / 4 + h * h) / (2 * h);
  // Half the sweep: the angle at the centre of curvature between the apex and an end.
  const A = Math.atan2(w / 2, R - h);
  return warpPoints(shapes, ([x, y]): Pt => {
    const a = ((x - cx) / (w / 2)) * A;
    // Work in the frame where the arch is always a rainbow, then flip for a valley.
    const dy = sign * (y - cy);
    const r = Math.max(R + dy, 1e-3); // a rise deeper than the text is tall would invert the map
    return [cx + r * Math.sin(a), cy + sign * (h - R + r * Math.cos(a))];
  });
}

/**
 * Horizontal fisheye, −1..1: the middle of the word grows (or shrinks) and the ends keep their
 * height. The "inflated sticker" look.
 */
export function warpBulge(shapes: Shapes, amount: number): Shapes {
  if (!shapes.length) return clone(shapes);
  const k = Math.max(-1, Math.min(1, amount));
  const b = bboxOf(shapes);
  const w = b.maxX - b.minX;
  const cy = (b.minY + b.maxY) / 2;
  if (w <= 1e-9 || Math.abs(k) < 1e-9) return subdivideShapes(shapes);
  return warpPoints(shapes, ([x, y]): Pt => {
    const u = 2 * ((x - b.minX) / w) - 1;
    return [x, cy + (y - cy) * (1 + k * (1 - u * u))];
  });
}

/** A flag ripple: the whole word slides up and down by `amplitudeMm` over `periods` full waves. */
export function warpWave(shapes: Shapes, amplitudeMm: number, periods: number): Shapes {
  if (!shapes.length || Math.abs(amplitudeMm) < 1e-9) return subdivideShapes(shapes);
  const b = bboxOf(shapes);
  const w = b.maxX - b.minX;
  if (w <= 1e-9) return clone(shapes);
  return warpPoints(shapes, ([x, y]): Pt => [x, y + amplitudeMm * Math.sin(2 * Math.PI * periods * ((x - b.minX) / w))]);
}
