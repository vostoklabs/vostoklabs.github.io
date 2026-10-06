// Plain 2-D helpers with no opinions: the pattern engine's tiles and its fill build on these,
// and nothing here knows what a pattern is.
import type { Box, Island, Pt, Polyline, Ring, Shapes } from './types';

export const TAU = Math.PI * 2;
export const SQRT3 = Math.sqrt(3);

/**
 * `signedArea` summed from the closing edge: the same terms, the edge from the last point back to
 * the first added first rather than last. Floating point is not associative, so the two orders
 * can differ in the last bit, and on a tiling of congruent rings that is enough to reorder a sort
 * by area. The pattern engine has always summed this way, so its fills keep this order.
 */
export function signedAreaClosingFirst(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i]!;
    const q = ring[j]!;
    a += q[0] * p[1] - p[0] * q[1];
  }
  return a / 2;
}

export function ringLength(points: Pt[], closed: boolean): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  if (closed && points.length > 1) sum += Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]);
  return sum;
}

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function growBox(b: Box, p: Pt): void {
  if (p[0] < b.minX) b.minX = p[0];
  if (p[0] > b.maxX) b.maxX = p[0];
  if (p[1] < b.minY) b.minY = p[1];
  if (p[1] > b.maxY) b.maxY = p[1];
}

export function bboxOfPoints(points: Pt[]): Box {
  const b = emptyBox();
  for (const p of points) growBox(b, p);
  return b;
}

export function bboxOfShapes(shapes: Shapes): Box {
  const b = emptyBox();
  for (const island of shapes) for (const ring of island) for (const p of ring) growBox(b, p);
  return b;
}

export const boxValid = (b: Box): boolean => Number.isFinite(b.minX) && b.maxX >= b.minX && b.maxY >= b.minY;

export const boxCentre = (b: Box): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

/** Even-odd point-in-ring (a point on the edge is a coin toss, as everywhere). */
export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Inside the material of `shapes`: even-odd across every ring at once, which is right for
 *  islands whose holes are their own rings and wrong for overlapping outers (union those first). */
export function insideShapes(shapes: readonly (readonly (readonly Pt[])[])[], p: Pt): boolean {
  let inside = false;
  for (const island of shapes) for (const ring of island) if (pointInRing(p, ring)) inside = !inside;
  return inside;
}

/** Inside the UNION of the islands: inside some island's outer ring (its first) and not in one of
 *  that island's holes. What overlapping outers need: under `insideShapes` a point covered by two
 *  islands at once (a blank's ear over its body, two letters of a welded word) reads as outside. */
export function insideUnion(shapes: readonly (readonly (readonly Pt[])[])[], p: Pt): boolean {
  for (const island of shapes) {
    if (!island[0] || !pointInRing(p, island[0])) continue;
    let inHole = false;
    for (let i = 1; i < island.length; i++) if (pointInRing(p, island[i]!)) inHole = !inHole;
    if (!inHole) return true;
  }
  return false;
}

export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / l2));
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}

/** Where a→b crosses c→d as a fraction along a→b, or null when parallel or the crossing misses c→d. */
export function segmentCrossing(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const u = (qx * ry - qy * rx) / den;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  return (qx * sy - qy * sx) / den;
}

export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const t = segmentCrossing(a, b, c, d);
  return t !== null && t >= -1e-9 && t <= 1 + 1e-9;
}

/** The least distance between two segments. */
export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

export function isConvex(ring: Ring): boolean {
  const n = ring.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const c = ring[(i + 2) % n]!;
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function ringCentroid(ring: Ring): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

// ---- transforms -------------------------------------------------------------------------

/** Scale a ring about its centroid — how a hole gets its web without an offset routine. */
export function shrinkRing(ring: Ring, k: number): Ring {
  const c = ringCentroid(ring);
  return ring.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]);
}

// ---- primitives ---------------------------------------------------------------------------

/** How many chords a circle of radius r gets: about one per 0.4 mm of arc, 12..180. */
export function circleSegments(r: number): number {
  return Math.max(12, Math.min(180, Math.ceil((TAU * Math.abs(r)) / 0.4)));
}

export function circle(cx: number, cy: number, r: number, n = circleSegments(r)): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** An open arc from angle a0 to a1 (radians, CCW positive), sampled to the circle's density. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n?: number): Polyline {
  const span = a1 - a0;
  const steps = n ?? Math.max(2, Math.ceil((Math.abs(span) / TAU) * circleSegments(r)));
  const out: Polyline = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (span * i) / steps;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** A regular n-gon of circumradius r; `rot` (radians) turns it, 0 = a vertex on +X. */
export function regularPolygon(cx: number, cy: number, r: number, n: number, rot = 0): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = rot + (i / n) * TAU;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** A pointy-top regular hexagon from its across-flats width. */
export function hexagon(cx: number, cy: number, acrossFlats: number): Ring {
  return regularPolygon(cx, cy, acrossFlats / SQRT3, 6, Math.PI / 6);
}

export function rect(cx: number, cy: number, w: number, h: number): Ring {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ];
}

export function roundedRect(cx: number, cy: number, w: number, h: number, r: number): Ring {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 1e-6) return rect(cx, cy, w, h);
  const seg = Math.max(2, Math.ceil(circleSegments(rr) / 4));
  const out: Ring = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cy - h / 2 + rr, -Math.PI / 2],
    [cx + w / 2 - rr, cy + h / 2 - rr, 0],
    [cx - w / 2 + rr, cy + h / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cy - h / 2 + rr, Math.PI],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = a0 + ((Math.PI / 2) * i) / seg;
      out.push([x + rr * Math.cos(t), y + rr * Math.sin(t)]);
    }
  }
  return out;
}

/** A stadium: a slot of length l (tip to tip) and width w along +X. */
export function slot(cx: number, cy: number, l: number, w: number): Ring {
  return roundedRect(cx, cy, Math.max(l, w), w, w / 2);
}

export function star(cx: number, cy: number, points: number, rOuter: number, rInner: number, rot = Math.PI / 2): Ring {
  const out: Ring = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const t = rot + (i / (points * 2)) * TAU;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

export const seg = (a: Pt, b: Pt): Polyline => [a, b];

// ---- nesting -------------------------------------------------------------------------------

/**
 * Loose rings → islands by even-odd containment: a ring inside an odd number of larger rings is
 * a hole of the nearest one around it. What an SVG tile's `fill-rule` means, made explicit.
 */
export function nestRings(rings: Ring[]): Island[] {
  const live = rings.filter((r) => r.length >= 3 && Math.abs(signedAreaClosingFirst(r)) > 1e-9);
  const order = live.map((r, i) => ({ r, i, area: Math.abs(signedAreaClosingFirst(r)) })).sort((a, b) => b.area - a.area);
  const depth = new Map<number, number>();
  const parent = new Map<number, number>();
  for (let k = 0; k < order.length; k++) {
    const me = order[k]!;
    const probe = me.r[0]!;
    let d = 0;
    let nearest = -1;
    for (let j = k - 1; j >= 0; j--) {
      const other = order[j]!;
      if (pointInRing(probe, other.r)) {
        d++;
        if (nearest < 0) nearest = other.i;
      }
    }
    depth.set(me.i, d);
    parent.set(me.i, nearest);
  }
  const islands = new Map<number, Island>();
  for (const { r, i } of order) if (depth.get(i)! % 2 === 0) islands.set(i, [r]);
  for (const { r, i } of order) {
    if (depth.get(i)! % 2 === 0) continue;
    const p = parent.get(i)!;
    const island = islands.get(p);
    if (island) island.push(r);
  }
  return [...islands.values()];
}

/** Past this many edges, `poleOf` asks only the edges near a point (`EdgeField`). */
const FIELD_EDGES = 64;
/** The most edges in one leaf of `EdgeField`'s tree. */
const FIELD_LEAF = 8;

/**
 * `poleOf`'s signed distance for a shape of many edges, to exactly the same number: the same test
 * edge by edge — the same ends in the same order, so the same arithmetic — asked only of the edges
 * that can matter. The nearest edge: a tree of boxes round the edges, searched nearest box first,
 * never opening a box farther than the nearest edge found (so the nearest is always asked). The
 * crossing count: every edge whose height spans the point's — filed by bands of height — which is
 * every edge the ray can cross. A long curl of a thousand points was a thousand tests for each of
 * thousands of squares: most of a card's time on Waves - 7.
 */
class EdgeField {
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;
  /** The tree: per node its box, and either its two children or (negative) a run of `order`. */
  private readonly box: number[] = [];
  private readonly kids: number[] = [];
  private readonly order: Int32Array;
  private readonly stack: Int32Array;
  private readonly y0: number;
  private readonly band: number;
  private readonly bands: number;
  private readonly bandStart: Int32Array;
  private readonly bandEdges: Int32Array;
  constructor(rings: Ring[], b: Box) {
    const n = rings.reduce((s, r) => s + r.length, 0);
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    let k = 0;
    let run = 0;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        this.ax[k] = r[i]![0];
        this.ay[k] = r[i]![1];
        this.bx[k] = r[j]![0];
        this.by[k] = r[j]![1];
        run += Math.hypot(r[j]![0] - r[i]![0], r[j]![1] - r[i]![1]);
        k++;
      }
    }
    this.order = new Int32Array(n);
    for (let e = 0; e < n; e++) this.order[e] = e;
    const mid = new Float64Array(2 * n);
    for (let e = 0; e < n; e++) {
      mid[2 * e] = (this.ax[e]! + this.bx[e]!) / 2;
      mid[2 * e + 1] = (this.ay[e]! + this.by[e]!) / 2;
    }
    let depth = 0;
    const build = (from: number, to: number, level: number): number => {
      depth = Math.max(depth, level);
      const node = this.kids.length / 2;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = from; i < to; i++) {
        const e = this.order[i]!;
        minX = Math.min(minX, this.ax[e]!, this.bx[e]!);
        maxX = Math.max(maxX, this.ax[e]!, this.bx[e]!);
        minY = Math.min(minY, this.ay[e]!, this.by[e]!);
        maxY = Math.max(maxY, this.ay[e]!, this.by[e]!);
      }
      this.box.push(minX, minY, maxX, maxY);
      this.kids.push(0, 0);
      if (to - from <= FIELD_LEAF) {
        this.kids[2 * node] = -1 - from;
        this.kids[2 * node + 1] = to - from;
        return node;
      }
      // Split at the middle edge along the box's longer side.
      const axis = maxX - minX >= maxY - minY ? 0 : 1;
      const part = Array.from(this.order.subarray(from, to)).sort((p, q) => mid[2 * p + axis]! - mid[2 * q + axis]!);
      this.order.set(part, from);
      const half = (from + to) >> 1;
      const left = build(from, half, level + 1);
      const right = build(half, to, level + 1);
      this.kids[2 * node] = left;
      this.kids[2 * node + 1] = right;
      return node;
    };
    build(0, n, 0);
    this.stack = new Int32Array(2 * depth + 8);
    // Bands of height for the crossing count: every edge in each band its height spans.
    this.band = Math.max((2 * run) / Math.max(1, n), (b.maxY - b.minY) / 4096, 1e-6);
    this.y0 = b.minY;
    this.bands = Math.floor((b.maxY - b.minY) / this.band) + 1;
    const count = new Int32Array(this.bands + 1);
    const at = (y: number): number => Math.min(this.bands - 1, Math.max(0, Math.floor((y - this.y0) / this.band)));
    for (let e = 0; e < n; e++) for (let r = at(Math.min(this.ay[e]!, this.by[e]!)); r <= at(Math.max(this.ay[e]!, this.by[e]!)); r++) count[r + 1]!++;
    for (let r = 0; r < this.bands; r++) count[r + 1]! += count[r]!;
    this.bandStart = count.slice();
    this.bandEdges = new Int32Array(count[this.bands]!);
    for (let e = 0; e < n; e++) for (let r = at(Math.min(this.ay[e]!, this.by[e]!)); r <= at(Math.max(this.ay[e]!, this.by[e]!)); r++) this.bandEdges[count[r]!++] = e;
  }
  /** Squared distance from a point to node `i`'s box. */
  private far(i: number, px: number, py: number): number {
    const dx = Math.max(this.box[4 * i]! - px, 0, px - this.box[4 * i + 2]!);
    const dy = Math.max(this.box[4 * i + 1]! - py, 0, py - this.box[4 * i + 3]!);
    return dx * dx + dy * dy;
  }
  signed(px: number, py: number): number {
    let inside = false;
    if (py >= this.y0 && py < this.y0 + this.bands * this.band) {
      const r = Math.floor((py - this.y0) / this.band);
      for (let k = this.bandStart[r]!; k < this.bandStart[r + 1]!; k++) {
        const e = this.bandEdges[k]!;
        const ax = this.ax[e]!;
        const ay = this.ay[e]!;
        const bx = this.bx[e]!;
        const by = this.by[e]!;
        if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
      }
    }
    let d2 = Infinity;
    let top = 0;
    this.stack[top++] = 0;
    while (top) {
      const node = this.stack[--top]!;
      if (this.far(node, px, py) >= d2) continue;
      const l = this.kids[2 * node]!;
      const r = this.kids[2 * node + 1]!;
      if (l < 0) {
        for (let k = -1 - l; k < -1 - l + r; k++) {
          const e = this.order[k]!;
          const ax = this.ax[e]!;
          const ay = this.ay[e]!;
          const vx = this.bx[e]! - ax;
          const vy = this.by[e]! - ay;
          const l2 = vx * vx + vy * vy;
          let t = l2 > 1e-18 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - ax - vx * t;
          const dy = py - ay - vy * t;
          const q = dx * dx + dy * dy;
          if (q < d2) d2 = q;
        }
        continue;
      }
      // The nearer child is searched first: pushed last.
      const fl = this.far(l, px, py);
      const fr = this.far(r, px, py);
      if (fl <= fr) {
        if (fr < d2) this.stack[top++] = r;
        if (fl < d2) this.stack[top++] = l;
      } else {
        if (fl < d2) this.stack[top++] = l;
        if (fr < d2) this.stack[top++] = r;
      }
    }
    const d = Math.sqrt(d2);
    return inside ? d : -d;
  }
}

/**
 * The pole of inaccessibility of a shape — its outer ring and any holes: the point inside it
 * farthest from every edge, and that distance, the radius of the widest disc the shape holds.
 * Mapbox's polylabel: squares over the box, the most promising split first, stopping when no
 * square can beat the best by `precision` — or once a disc of `enough` is found, for a caller
 * that only needs to know the shape is at least that roomy.
 */
export function poleOf(ring: Ring, precision = 0.02, holes: Ring[] = [], enough = Infinity): { at: Pt; radius: number } {
  const b = bboxOfPoints(ring);
  const size = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  if (!(size > 0)) return { at: ring[0] ?? [0, 0], radius: 0 };
  const rings = [ring, ...holes];
  // Distance to the nearest edge, negative outside — one pass over every edge doing both the
  // squared distance and the crossing count, so a shape of thousands of points stays cheap; past a
  // few dozen edges, only the edges near the point (`EdgeField`), to exactly the same number.
  const edges = rings.reduce((n, r) => n + r.length, 0);
  const field = edges > FIELD_EDGES ? new EdgeField(rings, b) : null;
  const signed = (p: Pt): number => {
    const [px, py] = p;
    if (field) return field.signed(px, py);
    let d2 = Infinity;
    let inside = false;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const ax = r[i]![0];
        const ay = r[i]![1];
        const bx = r[j]![0];
        const by = r[j]![1];
        if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
        const vx = bx - ax;
        const vy = by - ay;
        const l2 = vx * vx + vy * vy;
        let t = l2 > 1e-18 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - ax - vx * t;
        const dy = py - ay - vy * t;
        const q = dx * dx + dy * dy;
        if (q < d2) d2 = q;
      }
    }
    const d = Math.sqrt(d2);
    return inside ? d : -d;
  };
  type Sq = { x: number; y: number; h: number; d: number; max: number };
  const sq = (x: number, y: number, h: number): Sq => {
    const d = signed([x, y]);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  // A binary max-heap on `max`.
  const heap: Sq[] = [];
  const push = (s: Sq) => {
    heap.push(s);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up]!.max >= heap[i]!.max) break;
      [heap[up], heap[i]] = [heap[i]!, heap[up]!];
      i = up;
    }
  };
  const pop = (): Sq => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]!.max > heap[m]!.max) m = l;
        if (r < heap.length && heap[r]!.max > heap[m]!.max) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const h0 = size / 2;
  for (let x = b.minX; x < b.maxX; x += size) for (let y = b.minY; y < b.maxY; y += size) push(sq(x + h0, y + h0, h0));
  let best = sq((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
  let steps = 0;
  while (heap.length && steps++ < 4000 && best.d < enough) {
    const s = pop();
    if (s.d > best.d) best = s;
    if (s.max - best.d <= precision) continue;
    const h = s.h / 2;
    push(sq(s.x - h, s.y - h, h));
    push(sq(s.x + h, s.y - h, h));
    push(sq(s.x - h, s.y + h, h));
    push(sq(s.x + h, s.y + h, h));
  }
  return { at: [best.x, best.y], radius: Math.max(0, best.d) };
}
