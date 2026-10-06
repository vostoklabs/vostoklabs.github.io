// Small exact-ish 2D polygon helpers. No dependencies on purpose: a box net is a
// few dozen straight-edged panels, and pulling a WASM kernel in to union them would
// cost more than it buys. The one thing that has to be right is that shared corners
// compare EQUAL, which is what `snap` is for.

import { pointInRing, pointSegmentDistance, ringBox, signedArea, type Box } from '@vostok/shapes';
import type { Poly, Pt } from '../types';

/* Area and winding, and even-odd point-in-ring, are the shelf's: positive area is
   counter-clockwise, which Manifold and every laser convention agree on and the exporter uses to
   tell an outer ring from a hole; the point test is blind to winding, so it can ask "is this ring
   nested inside that one" before either has been wound the right way. */
export { pointInRing, signedArea };

/**
 * Whether ring `r` lies inside ring `o`, asked of every one of `r`'s vertices rather than its
 * first: inside when none of them is outside `o` and at least one is inside, the ones on `o`'s
 * edge (within `tol`) saying nothing either way.
 *
 * So two rings that cross are side by side, neither inside the other, which is what an outline's
 * overlapping parts are (a font's overlapping strokes, an outline drawing's touching shapes); a
 * counter lies wholly inside its letter and is inside. The answer is the same wherever `r`
 * starts and whichever way it runs, and a hair of float noise in where a vertex sits cannot
 * change it. Asked of the first vertex alone, a crossing ring came out inside or not by which
 * side of the crossing that vertex happened to fall on.
 *
 * `index` is `o`'s `ringIndex`, for a caller asking about the same `o` many times.
 */
export function ringWithin(r: Poly, o: Poly, tol = 1e-9, index: RingIndex = ringIndex(o)): boolean {
  const { box } = index;
  let inside = false;
  for (const p of r) {
    if (p[0] < box.minX - tol || p[0] > box.maxX + tol || p[1] < box.minY - tol || p[1] > box.maxY + tol) return false;
    const side = sideOf(p, o, index, tol);
    if (side === 0) continue;
    if (side < 0) return false;
    inside = true;
  }
  return inside;
}

/** A ring's box, and its edges filed by bands of height: a point only ever needs the edges at
 *  its own height, so asking every vertex of one ring against another costs a few edges a vertex
 *  rather than the whole ring. Without it, rings nested in rings of a few thousand points (a
 *  filled contour map, a target) took seconds where the first-vertex test took milliseconds. */
export interface RingIndex {
  box: Box;
  band: number;
  /** Edge `i` (from vertex `i - 1` to vertex `i`) appears in every band its height spans. */
  start: Int32Array;
  edges: Int32Array;
}

export function ringIndex(o: Poly): RingIndex {
  const box = ringBox([o]);
  const n = o.length;
  let rise = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) rise += Math.abs((o[i] as Pt)[1] - (o[j] as Pt)[1]);
  const height = box.maxY - box.minY;
  const band = Math.max((2 * rise) / Math.max(1, n), height / 4096, 1e-12);
  const bands = Math.floor(height / band) + 1;
  const bandOf = (y: number): number => Math.min(bands - 1, Math.max(0, Math.floor((y - box.minY) / band)));
  const count = new Int32Array(bands + 1);
  const each = (fn: (k: number, i: number) => void): void => {
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ya = (o[i] as Pt)[1];
      const yb = (o[j] as Pt)[1];
      for (let k = bandOf(Math.min(ya, yb)); k <= bandOf(Math.max(ya, yb)); k++) fn(k, i);
    }
  };
  each((k) => count[k + 1]!++);
  for (let k = 0; k < bands; k++) count[k + 1]! += count[k]!;
  const start = count.slice();
  const edges = new Int32Array(count[bands]!);
  each((k, i) => (edges[count[k]!++] = i));
  return { box, band, start, edges };
}

/** Which side of `o` a point is on: 0 within `tol` of an edge, else 1 inside and -1 outside.
 *  The same answers, to the bit, as asking `pointSegmentDistance` and `pointInRing` of every
 *  edge: the same arithmetic on the same ends, asked only of the edges that can matter. */
function sideOf(p: Pt, o: Poly, index: RingIndex, tol: number): -1 | 0 | 1 {
  const { box, band, start, edges } = index;
  const n = o.length;
  const last = start.length - 2;
  const bandOf = (y: number): number => Math.min(last, Math.max(0, Math.floor((y - box.minY) / band)));
  const [px, py] = p;
  for (let k = bandOf(py - tol); k <= bandOf(py + tol); k++) {
    for (let e = start[k]!; e < start[k + 1]!; e++) {
      const i = edges[e]!;
      const a = o[i === 0 ? n - 1 : i - 1] as Pt;
      const b = o[i] as Pt;
      if ((px < a[0] - tol && px < b[0] - tol) || (px > a[0] + tol && px > b[0] + tol)) continue;
      if ((py < a[1] - tol && py < b[1] - tol) || (py > a[1] + tol && py > b[1] + tol)) continue;
      if (pointSegmentDistance(p, a, b) <= tol) return 0;
    }
  }
  // Even-odd, as `pointInRing` counts it: every edge the ray to the right can cross spans the
  // point's height, so it is filed in the point's band.
  let c = false;
  const k = bandOf(py);
  for (let e = start[k]!; e < start[k + 1]!; e++) {
    const i = edges[e]!;
    const a = o[i] as Pt;
    const b = o[i === 0 ? n - 1 : i - 1] as Pt;
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c ? 1 : -1;
}

/** Grid the whole app rounds to. Fine enough that no real dimension lands on the
 *  boundary between two cells, coarse enough that two panels built by different
 *  code paths agree on a shared corner. */
export const EPS = 1e-4;

/** Ring access that wraps and never returns undefined. Ring code indexes past the
 *  end constantly — `ring[(i + 1) % n]` is the shape of every loop in this file —
 *  and under `noUncheckedIndexedAccess` that is a `Pt | undefined` at every site.
 *  One accessor keeps the arithmetic readable instead of littered with `!`. */
export function at(ring: Poly, i: number): Pt {
  const n = ring.length;
  return ring[((i % n) + n) % n] as Pt;
}

export function snap(v: number): number {
  // +0 rather than -0: a leading minus on a zero coordinate reads as a bug in every
  // exported file, and it also breaks string-keyed vertex identity.
  const r = Math.round(v / EPS) * EPS;
  return r === 0 ? 0 : r;
}

export function snapPt(p: Pt): Pt {
  return [snap(p[0]), snap(p[1])];
}

export function key(p: Pt): string {
  return `${snap(p[0])},${snap(p[1])}`;
}

export function eq(a: Pt, b: Pt): boolean {
  return Math.abs(a[0] - b[0]) < EPS / 2 && Math.abs(a[1] - b[1]) < EPS / 2;
}

export function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}

export function len(a: Pt): number {
  return Math.hypot(a[0], a[1]);
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function cross(a: Pt, b: Pt): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function dot(a: Pt, b: Pt): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function ensureCCW(ring: Poly): Poly {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/** Holes are wound the other way from outers, and every consumer relies on it: the
 *  exporter tells a hole from a part by the sign, and so does every importer that
 *  fills anything. A window aperture left wound CCW reads as a second blank. */
export function ensureCW(ring: Poly): Poly {
  return signedArea(ring) > 0 ? [...ring].reverse() : ring;
}

/** The box round some rings as `[x0, y0, x1, y1]`, the order every caller here destructures;
 *  `[0, 0, 0, 0]` when there are no points at all. */
export function polysBounds(polys: Poly[]): [number, number, number, number] {
  const b = ringBox(polys);
  return Number.isFinite(b.minX) ? [b.minX, b.minY, b.maxX, b.maxY] : [0, 0, 0, 0];
}

export function translate(poly: Poly, dx: number, dy: number): Poly {
  return poly.map(([x, y]) => [x + dx, y + dy] as Pt);
}

export function rotate90(poly: Poly): Poly {
  // (x, y) -> (-y, x). Winding is preserved, which matters: a nester that mirrors
  // instead of rotating flips every face-specific feature.
  return poly.map(([x, y]) => [-y, x] as Pt);
}

export function pathLength(points: Poly, closed: boolean): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += dist(at(points, i), at(points, i + 1));
  if (closed && points.length > 2) total += dist(at(points, points.length - 1), at(points, 0));
  return total;
}

/** Is `p` strictly between `a` and `b` on the segment ab? Used to split an edge at a
 *  neighbour's vertex — the step that makes a partial contact (a narrow tuck hinged
 *  to a wide closure panel) resolve into an exact shared edge. */
export function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const L = len(ab);
  if (L < EPS) return false;
  // Perpendicular distance, not a bounding-box test: collinearity is the whole point.
  if (Math.abs(cross(ab, ap)) / L > EPS) return false;
  const t = dot(ap, ab) / (L * L);
  return t > EPS / L && t < 1 - EPS / L;
}

/** Axis-aligned rectangle, CCW from bottom-left. */
export function rect(x: number, y: number, w: number, h: number): Poly {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** Rectangle with rounded corners, CCW. `segments` per quarter turn — 6 gives a
 *  chord error under 0.02 mm at r = 6, which is finer than any of these machines
 *  positions to. Flattened rather than left as arcs on purpose: a field report from
 *  the laser work says an importer re-fitted and scrambled real Beziers. */
export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  segments = 6,
): Poly {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < EPS) return rect(x, y, w, h);
  const out: Poly = [];
  const corners: [number, number, number][] = [
    [x + w - rr, y + rr, -Math.PI / 2],
    [x + w - rr, y + h - rr, 0],
    [x + rr, y + h - rr, Math.PI / 2],
    [x + rr, y + rr, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = start + (i / segments) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** A stadium (obround) — a rectangle capped with semicircles on the short ends.
 *  The shape every hand hole and every euro hang slot wants, because a square
 *  internal corner in cardstock is where a tear starts. */
export function stadium(cx: number, cy: number, w: number, h: number, segments = 8): Poly {
  const r = Math.min(w, h) / 2;
  const horizontal = w >= h;
  const half = (horizontal ? w : h) / 2 - r;
  const out: Poly = [];
  const push = (ox: number, oy: number, from: number) => {
    for (let i = 0; i <= segments; i++) {
      const a = from + (i / segments) * Math.PI;
      out.push([cx + ox + r * Math.cos(a), cy + oy + r * Math.sin(a)]);
    }
  };
  if (horizontal) {
    push(half, 0, -Math.PI / 2);
    push(-half, 0, Math.PI / 2);
  } else {
    push(0, half, 0);
    push(0, -half, Math.PI);
  }
  return out;
}

/** Fillet corners of a ring. `radii` is either one radius for every corner or one
 *  per vertex, parallel to `poly` — 0 leaves that corner sharp.
 *
 *  Card tears from a sharp internal corner, so every hand hole, handle blade and
 *  tuck flap in a real dieline is filleted. The radius is clamped against BOTH
 *  adjacent edges, which is what stops a generous radius on a short edge from
 *  turning the corner inside out. */
export function roundCorners(poly: Poly, radii: number | number[], segments = 5): Poly {
  const n = poly.length;
  if (n < 3) return poly;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const want = Array.isArray(radii) ? (radii[i] ?? 0) : radii;
    const cur = at(poly, i);
    const v1 = sub(at(poly, i - 1), cur);
    const v2 = sub(at(poly, i + 1), cur);
    const l1 = len(v1);
    const l2 = len(v2);
    if (want <= 0 || l1 < EPS || l2 < EPS) {
      out.push(cur);
      continue;
    }
    const u1: Pt = [v1[0] / l1, v1[1] / l1];
    const u2: Pt = [v2[0] / l2, v2[1] / l2];
    // Interior angle at this corner. Straight and doubled-back both have no corner
    // to round, and both would divide by zero below.
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (ang < 1e-3 || Math.PI - ang < 1e-3) {
      out.push(cur);
      continue;
    }
    const tanHalf = Math.tan(ang / 2);
    // Half of each adjacent edge is the most this corner may consume, so two
    // filleted corners sharing an edge can never overrun each other.
    const r = Math.min(want, (l1 / 2) * tanHalf, (l2 / 2) * tanHalf);
    const d = r / tanHalf;
    const p1: Pt = [cur[0] + u1[0] * d, cur[1] + u1[1] * d];
    const p2: Pt = [cur[0] + u2[0] * d, cur[1] + u2[1] * d];
    const bis: Pt = [u1[0] + u2[0], u1[1] + u2[1]];
    const bl = len(bis);
    if (bl < EPS) {
      out.push(cur);
      continue;
    }
    const h = r / Math.sin(ang / 2);
    const c: Pt = [cur[0] + (bis[0] / bl) * h, cur[1] + (bis[1] / bl) * h];
    const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    let da = Math.atan2(p2[1] - c[1], p2[0] - c[0]) - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let k = 0; k <= segments; k++) {
      const a = a1 + (da * k) / segments;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
  }
  return out;
}

/** A circular arc as a polyline, used for thumb notches. */
export function arcPoints(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  segments = 10,
): Poly {
  const out: Poly = [];
  for (let i = 0; i <= segments; i++) {
    const a = from + (i / segments) * (to - from);
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Cut a straight run into alternating dashes. This is how a fold line becomes a
 *  perforation on a machine with no scoring tool — which is every blade cutter, and every
 *  blade cutter on heavy stock.
 *
 *  The line always starts AND ends with a bridge, never a cut: a dash that runs into
 *  the blank's edge tears out, and the two ends of a fold are exactly where the board
 *  carries the most load. */
/** The dash a fold gets: how much is cut, how much is left.
 *
 *  DUTY — the fraction severed — is the number that matters, and it is nearly constant.
 *  33% is a perf SCORE: the fold is relieved and the panel stays firmly attached. 60%+
 *  is a TEAR-OFF perforation, the coupon/ticket-stub kind, which is what this used to
 *  produce and what "the dashes are too fine" was really describing. The reference is a
 *  real cut on an H2D through 200 gsm kraft — 2.0 mm on, 4.0 mm off — which is 33%.
 *
 *  CALIPER MOVES THE PITCH, NOT THE DUTY. This is the correction that matters: heavy
 *  board does not want a larger FRACTION taken out, it wants a longer land in absolute
 *  millimetres, and a caliper-driven pitch gives exactly that at constant duty. The old
 *  rule raised duty to 80% on thick stock, which is the direction that tears.
 *
 *  LENGTH IS A GUARD, NOT AN AXIS. A pitch is a property of the board, so a 200 mm fold
 *  and a 40 mm fold on the same card get the same dash. Length only intervenes at the
 *  short end, to keep a few dashes on a small flap. */
export function perfSpec(
  lengthMm: number,
  caliperMm: number,
  minCutMm: number,
): { cutMm: number; gapMm: number } {
  const duty = Math.min(0.4, Math.max(0.33, 0.33 + (caliperMm - 0.25) * 0.06));
  /** Thinnest bridge that survives the fold itself. Only binds on a short fold — the
   *  normal land is pitch x (1 - duty), i.e. 3 to 5 mm. */
  const MIN_LAND_MM = 1.5;
  /** Past this the gaps read as slots rather than a perforation. */
  const MAX_PITCH_MM = 8;
  /** A fold keeps at least this many dashes while its length allows it. Fewer and it
   *  hinges about the dashes and the fold wanders between them. */
  const MIN_DASHES = 5;

  let pitch = Math.min(5 + 4 * caliperMm, MAX_PITCH_MM, lengthMm / MIN_DASHES);
  // Both machine floors are applied by pushing the PITCH out, never by letting `cut` or
  // `gap` rise on their own: `cut = max(minCut, pitch * duty)` silently inflates the duty
  // exactly where the floor binds, which is on the short folds that can least afford it.
  pitch = Math.max(pitch, minCutMm / duty, MIN_LAND_MM / (1 - duty), minCutMm + MIN_LAND_MM);
  // 0.1 mm because Suite's Dash and Gap fields step in tenths: an unrounded 2.53 snaps to
  // 2.5 the moment a user touches the box, and the dashes stop landing where the geometry
  // says. Round the PITCH, then split it, so the period stays on the guard above.
  pitch = Math.max(Math.round(pitch * 10) / 10, minCutMm + MIN_LAND_MM);

  const cutMm = Math.max(minCutMm, Math.round(pitch * duty * 10) / 10);
  const gapMm = Math.max(MIN_LAND_MM, Math.round((pitch - cutMm) * 10) / 10);
  return { cutMm, gapMm };
}

export function dashSegment(a: Pt, b: Pt, cutMm: number, gapMm: number): Poly[] {
  const total = dist(a, b);
  if (total < EPS) return [[a, b]];
  // A fold too short for one whole dash gets ONE SHORT DASH, never an unbroken line. An
  // unbroken fold line is a cut straight THROUGH the fold on any importer that reads
  // shape and not layers, which is the failure this whole path exists to prevent.
  const cut = Math.min(cutMm, total * 0.6);
  if (cut <= 0) return [[a, b]];
  const gap = Math.max(gapMm, 0);
  const period = cut + gap;

  // FLOOR, not round. `floor(total / period)` is the largest count whose span leaves a
  // whole gap spare, and that buys the guarantee `round((total - gap) / period)` did not
  // have: the lead is never negative, so the pattern cannot run off the end of the fold.
  // It did run off. At 80% duty — which the old perfSpec reached on E-flute — a 47 mm
  // fold came out spanning -0.10 to 47.10 and put a blade plunge in the cut ring at both
  // ends. Anything past 75% duty (cut > 3 x gap) overran.
  const n = Math.max(1, Math.floor(total / period));
  const span = n * period - gap;
  const lead = (total - span) / 2;

  const dir: Pt = [(b[0] - a[0]) / total, (b[1] - a[1]) / total];
  const at = (d: number): Pt => [a[0] + dir[0] * d, a[1] + dir[1] * d];

  const out: Poly[] = [];
  for (let i = 0; i < n; i++) {
    const s = lead + i * period;
    out.push([at(s), at(s + cutMm)]);
  }
  return out;
}

/** Offset a closed ring outward (positive) or inward (negative) by `d`, by moving
 *  every edge along its own normal and intersecting consecutive edges.
 *
 *  This is the kerf compensation and the film-margin offset. It is a miter offset
 *  with no self-intersection cleanup, which is safe here because every ring it is
 *  applied to is convex or near-convex and `d` is small (a kerf is tenths of a
 *  millimetre). It is NOT a general polygon offset and should not be used as one. */
export function offsetRing(ring: Poly, d: number): Poly {
  if (Math.abs(d) < EPS || ring.length < 3) return ring;
  const ccw = signedArea(ring) >= 0;
  // For a CCW ring the outward normal of edge a->b is (dy, -dx) normalised... which
  // points right of travel. Travelling CCW keeps the interior on the left, so right
  // is outward. A CW ring (a hole) needs the sign flipped so "outward" still means
  // "away from the material".
  const s = ccw ? d : -d;
  const n = ring.length;
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const prev = at(ring, i - 1);
    const cur = at(ring, i);
    const next = at(ring, i + 1);

    const e1 = sub(cur, prev);
    const e2 = sub(next, cur);
    const l1 = len(e1);
    const l2 = len(e2);
    if (l1 < EPS || l2 < EPS) {
      out.push(cur);
      continue;
    }
    const n1: Pt = [(e1[1] / l1) * s, (-e1[0] / l1) * s];
    const n2: Pt = [(e2[1] / l2) * s, (-e2[0] / l2) * s];

    // Intersect the two offset lines. Parallel edges (a straight run split by a
    // vertex) fall back to the shared normal, which is exactly right there.
    const denom = cross(e1, e2);
    if (Math.abs(denom) < EPS * Math.max(l1, l2)) {
      out.push([cur[0] + n1[0], cur[1] + n1[1]]);
      continue;
    }
    const p1: Pt = [prev[0] + n1[0], prev[1] + n1[1]];
    const p2: Pt = [cur[0] + n2[0], cur[1] + n2[1]];
    const t = cross(sub(p2, p1), e2) / denom;
    out.push([p1[0] + e1[0] * t, p1[1] + e1[1] * t]);
  }
  return out;
}
