// Small exact-ish 2D polygon helpers. No dependencies on purpose: a box net is a
// few dozen straight-edged panels, and pulling a WASM kernel in to union them would
// cost more than it buys. The one thing that has to be right is that shared corners
// compare EQUAL, which is what `snap` is for.

import type { Poly, Pt } from '../types';

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

/** Positive for counter-clockwise. Manifold and every laser convention agree on
 *  this sign, and the exporter uses it to tell an outer ring from a hole. */
export function signedArea(ring: Poly): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = at(ring, i);
    const b = at(ring, i + 1);
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
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

export function bboxOf(polys: Poly[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
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
 *  perforation on a machine with no scoring tool — which is most Cricuts, and every
 *  blade cutter on heavy stock.
 *
 *  The line always starts AND ends with a bridge, never a cut: a dash that runs into
 *  the blank's edge tears out, and the two ends of a fold are exactly where the board
 *  carries the most load. */
export function dashSegment(a: Pt, b: Pt, cutMm: number, gapMm: number): Poly[] {
  const total = dist(a, b);
  const period = cutMm + gapMm;
  if (total < period || cutMm <= 0) return [[a, b]];

  // Fit a whole number of periods so the pattern is symmetric, and start half a gap
  // in from each end.
  const n = Math.max(1, Math.round((total - gapMm) / period));
  const span = n * period - gapMm;
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
