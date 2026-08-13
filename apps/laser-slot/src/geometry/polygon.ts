// Exact scanline analysis of a closed-ring polygon set.
//
// Everything the slot solver needs to *decide* (where the spine is, how much
// material surrounds it, where the crossing interval starts and ends) is
// answered here in plain JS against the rings, not in the CSG kernel. Manifold
// is for *constructing* geometry; asking it 120 boolean questions to pick an
// axis would be slower and no more accurate.
//
// Rings are [x,y] pairs, implicitly closed, non-zero winding.

import type { Ring } from '../types';

export type Interval = [number, number];

/** Where a vertical line at `x` is inside the polygon, as y-intervals, sorted
 *  bottom to top. Non-zero winding, so nested holes subtract correctly. */
export function verticalIntervals(rings: Ring[], x: number): Interval[] {
  const hits: { y: number; w: number }[] = [];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      // Half-open test on x so a vertex exactly on the line is counted once.
      const aIn = a[0] <= x;
      const bIn = b[0] <= x;
      if (aIn === bIn) continue;
      const t = (x - a[0]) / (b[0] - a[0]);
      hits.push({ y: a[1] + t * (b[1] - a[1]), w: b[0] > a[0] ? 1 : -1 });
    }
  }
  return windToIntervals(hits);
}

/** Where a horizontal line at `y` is inside the polygon, as x-intervals. */
export function horizontalIntervals(rings: Ring[], y: number): Interval[] {
  const hits: { y: number; w: number }[] = [];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const aIn = a[1] <= y;
      const bIn = b[1] <= y;
      if (aIn === bIn) continue;
      const t = (y - a[1]) / (b[1] - a[1]);
      hits.push({ y: a[0] + t * (b[0] - a[0]), w: b[1] > a[1] ? -1 : 1 });
    }
  }
  return windToIntervals(hits);
}

function windToIntervals(hits: { y: number; w: number }[]): Interval[] {
  if (hits.length < 2) return [];
  hits.sort((p, q) => p.y - q.y);
  const out: Interval[] = [];
  let wind = 0;
  let start = 0;
  for (const h of hits) {
    const prev = wind;
    wind += h.w;
    if (prev === 0 && wind !== 0) start = h.y;
    else if (prev !== 0 && wind === 0 && h.y > start) out.push([start, h.y]);
  }
  return out;
}

/** The interval in `list` that contains `v`, or null. */
export function intervalAt(list: Interval[], v: number): Interval | null {
  for (const iv of list) if (v >= iv[0] && v <= iv[1]) return iv;
  return null;
}

/** The longest interval, or null for none. */
export function longest(list: Interval[]): Interval | null {
  let best: Interval | null = null;
  for (const iv of list) if (!best || iv[1] - iv[0] > best[1] - best[0]) best = iv;
  return best;
}

export function bbox(rings: Ring[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!isFinite(minX)) return [0, 0, 0, 0];
  return [minX, minY, maxX, maxY];
}

/** Signed area (shoelace). Holes wound opposite to their outer ring come out
 *  negative, so summing over all rings gives the true filled area. */
export function signedArea(ring: Ring): number {
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export function totalArea(rings: Ring[]): number {
  let a = 0;
  for (const r of rings) a += signedArea(r);
  return Math.abs(a);
}

/** Area-weighted centroid over all rings, holes included with negative weight.
 *  This is the point the base-diameter rule measures the tip angle about — the
 *  bbox centre would put a palm tree's centre of mass in its trunk. */
export function centroid(rings: Ring[]): [number, number] {
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const cross = a[0] * b[1] - b[0] * a[1];
      area += cross;
      cx += (a[0] + b[0]) * cross;
      cy += (a[1] + b[1]) * cross;
    }
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) {
    const bb = bbox(rings);
    return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

export function perimeter(rings: Ring[]): number {
  let len = 0;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
  }
  return len;
}

/** Segment count for a circle of radius `r` whose facets stay within `tol` mm of
 *  true. A fixed 16-gon is fine on a pen plot and visibly faceted on an 80 mm
 *  base disc; this keeps the error constant instead of the segment count.
 *      N = ceil(pi / acos(1 - tol/r))
 *  r = 40, tol = 0.05  ->  64 segments. */
export function circleSegments(r: number, tol = 0.05): number {
  if (r <= tol) return 8;
  const inner = 1 - tol / r;
  const n = Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, inner))));
  return Math.max(12, Math.min(512, n));
}
