// Clipping lines to a region, keeping holes off its edge, and merging the duplicate segments
// a tiled lattice draws. Pure; nothing here needs a polygon library.
//
// Lines are clipped AS LINES (the studio's clip.ts, lifted): split every segment where it
// crosses a region edge, keep a piece when its midpoint is on material, merge what is
// consecutive. A hole is a polygon, and a polygon crossing the edge is not clipped here unless
// it is convex (Sutherland–Hodgman against the region's rings is exact then) — the host owns
// the general boolean, because it already has one and this package must not.
import { insideShapes, insideUnion, isConvex, pointSegmentDistance, ringLength, segmentCrossing, segmentDistance, signedArea } from './geom';
import type { Island, Pt, Polyline, Ring, Shapes } from './types';

const EPS_T = 1e-7;
/** A run shorter than this is numerical dust off a near-tangent crossing. */
const MIN_RUN = 0.05;

interface Edge {
  c: Pt;
  d: Pt;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The region's edges in a uniform grid, so a segment only meets the edges near it. */
export class EdgeIndex {
  readonly edges: Edge[] = [];
  private readonly cells = new Map<string, Edge[]>();
  private readonly size: number;
  readonly shapes: Shapes;

  constructor(shapes: Shapes, cell?: number) {
    this.shapes = shapes;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const island of shapes) {
      for (const ring of island) {
        for (let i = 0; i < ring.length; i++) {
          const c = ring[i]!;
          const d = ring[(i + 1) % ring.length]!;
          const e: Edge = { c, d, minX: Math.min(c[0], d[0]), maxX: Math.max(c[0], d[0]), minY: Math.min(c[1], d[1]), maxY: Math.max(c[1], d[1]) };
          this.edges.push(e);
          minX = Math.min(minX, e.minX);
          minY = Math.min(minY, e.minY);
          maxX = Math.max(maxX, e.maxX);
          maxY = Math.max(maxY, e.maxY);
        }
      }
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    this.size = cell ?? Math.max(1, span / 24);
    for (const e of this.edges) this.forCells(e.minX, e.minY, e.maxX, e.maxY, (k) => {
      let bucket = this.cells.get(k);
      if (!bucket) this.cells.set(k, (bucket = []));
      bucket.push(e);
    });
  }

  private forCells(minX: number, minY: number, maxX: number, maxY: number, fn: (key: string) => void): void {
    const x0 = Math.floor(minX / this.size);
    const x1 = Math.floor(maxX / this.size);
    const y0 = Math.floor(minY / this.size);
    const y1 = Math.floor(maxY / this.size);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) fn(`${x},${y}`);
  }

  /** Edges whose box meets the given box (each at most once). */
  near(minX: number, minY: number, maxX: number, maxY: number): Edge[] {
    const seen = new Set<Edge>();
    const out: Edge[] = [];
    this.forCells(minX, minY, maxX, maxY, (k) => {
      const bucket = this.cells.get(k);
      if (!bucket) return;
      for (const e of bucket) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (e.maxX < minX || e.minX > maxX || e.maxY < minY || e.minY > maxY) continue;
        out.push(e);
      }
    });
    return out;
  }

  inside(p: Pt): boolean {
    return insideShapes(this.shapes, p);
  }

  /** Least distance from a point to any edge, capped: only edges within `limit` are examined. */
  distance(p: Pt, limit: number): number {
    let best = Infinity;
    for (const e of this.near(p[0] - limit, p[1] - limit, p[0] + limit, p[1] + limit)) best = Math.min(best, pointSegmentDistance(p, e.c, e.d));
    return best;
  }

  /** Least distance from a segment to any edge within `limit`. */
  segmentDistance(a: Pt, b: Pt, limit: number): number {
    let best = Infinity;
    const minX = Math.min(a[0], b[0]) - limit;
    const maxX = Math.max(a[0], b[0]) + limit;
    const minY = Math.min(a[1], b[1]) - limit;
    const maxY = Math.max(a[1], b[1]) + limit;
    for (const e of this.near(minX, minY, maxX, maxY)) best = Math.min(best, segmentDistance(a, b, e.c, e.d));
    return best;
  }

  /** Does any edge cross the segment a→b? */
  crosses(a: Pt, b: Pt): boolean {
    for (const e of this.near(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) {
      const t = segmentCrossing(a, b, e.c, e.d);
      if (t !== null && t > EPS_T && t < 1 - EPS_T) return true;
    }
    return false;
  }
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The maximal sub-intervals of a→b whose midpoint lies on material. */
function insidePieces(a: Pt, b: Pt, index: EdgeIndex, inside: (p: Pt) => boolean): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const ts = [0, 1];
  for (const e of index.near(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) {
    const t = segmentCrossing(a, b, e.c, e.d);
    if (t !== null && t > EPS_T && t < 1 - EPS_T) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if ((t1 - t0) * len < 1e-6) continue;
    const m = (t0 + t1) / 2;
    if (!inside([a[0] + dx * m, a[1] + dy * m])) continue;
    const prev = out[out.length - 1];
    if (prev && t0 - prev[1] < EPS_T) prev[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

function runLength(points: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return sum;
}

export interface Run {
  points: Pt[];
  /** The whole ring survived and is still a ring. */
  closed: boolean;
}

/** A run of points clipped to the index's region: on material is `inside`, the region's own
 *  even-odd test unless the caller gives another. */
export function clipRun(points: Pt[], index: EdgeIndex, isRing: boolean, minRun = MIN_RUN, inside: (p: Pt) => boolean = (p) => index.inside(p)): Run[] {
  const n = points.length;
  if (n < 2) return [];
  const segments = isRing ? n : n - 1;
  const runs: Run[] = [];
  let run: Pt[] | null = null;
  let open = false;
  let fromTheStart = false;
  for (let i = 0; i < segments; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const pieces = insidePieces(a, b, index, inside);
    if (!pieces.length) {
      if (run) runs.push({ points: run, closed: false });
      run = null;
      open = false;
      continue;
    }
    for (let j = 0; j < pieces.length; j++) {
      const [t0, t1] = pieces[j]!;
      if (run && open && j === 0 && t0 <= EPS_T) run.push(lerp(a, b, t1));
      else {
        if (run) runs.push({ points: run, closed: false });
        run = [lerp(a, b, t0), lerp(a, b, t1)];
        if (i === 0 && j === 0 && t0 <= EPS_T) fromTheStart = true;
      }
      open = j === pieces.length - 1 && t1 >= 1 - EPS_T;
      if (!open) {
        runs.push({ points: run, closed: false });
        run = null;
      }
    }
  }
  if (run) runs.push({ points: run, closed: false });
  if (isRing && open && fromTheStart && runs.length) {
    if (runs.length === 1) runs[0] = { points: runs[0]!.points.slice(0, -1), closed: true };
    else {
      const tail = runs.pop()!;
      const head = runs.shift()!;
      runs.unshift({ points: [...tail.points, ...head.points.slice(1)], closed: false });
    }
  }
  return runs.filter((r) => r.points.length >= 2 && (r.closed || runLength(r.points) >= minRun));
}

export interface ClipOptions {
  /**
   * Drop the steps of no length first (two points within a millionth of a millimetre, and a
   * ring's trailing copy of its first point). A step of no length has no midpoint to test, so
   * the walk reads it as a gap: a font's outline, rounded to three decimals, is full of them,
   * and a scored word lying wholly on the plate came back as dozens of open runs where closed
   * rings were wanted, the laser lifting its head at each. Off, the points are walked as given.
   */
  compact?: boolean;
  /**
   * Which points count as on material. Off, even-odd across every ring of the region at once:
   * the rule a built plate is drawn with, where a counter is a hole. On, inside any one island
   * (its outer ring, not its holes): the rule a set of OVERLAPPING islands needs, such as the
   * letters of a welded word before they are unioned, where even-odd reads the overlap as off.
   */
  union?: boolean;
}

/** The inside test the options ask for; none means the index's own even-odd one. */
const insideFor = (index: EdgeIndex, opts: ClipOptions): ((p: Pt) => boolean) | undefined =>
  opts.union ? (p) => insideUnion(index.shapes, p) : undefined;

/** Two points this close are the same point: far under the three-decimal rounding of a font's
 *  outline, and under both thresholds a step of no length trips below. */
const SAME_POINT = 1e-6;
const samePoint = (a: Pt, b: Pt): boolean => Math.abs(a[0] - b[0]) < SAME_POINT && Math.abs(a[1] - b[1]) < SAME_POINT;

/** The points with each one that repeats the last one kept left out; for a ring, also the
 *  copies of its first point at its end. */
function withoutRepeats(points: Pt[], isRing: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (!out.length || !samePoint(out[out.length - 1]!, p)) out.push(p);
  if (isRing) while (out.length > 1 && samePoint(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

/** The region as an edge index: the caller's own, or one built for this call. */
const indexOf = (region: EdgeIndex | Shapes): EdgeIndex => (region instanceof EdgeIndex ? region : new EdgeIndex(region));

/** The parts of each open polyline that lie on the region's material. */
export function clipPolylines(polylines: Polyline[], region: EdgeIndex | Shapes, opts: ClipOptions = {}): Polyline[] {
  const index = indexOf(region);
  const inside = insideFor(index, opts);
  return polylines.flatMap((p) => clipRun(opts.compact ? withoutRepeats(p, false) : p, index, false, MIN_RUN, inside).map((r) => r.points));
}

/** Rings clipped as lines: a ring that survived whole stays closed, the rest become runs. */
export function clipRingsAsLines(rings: Ring[], region: EdgeIndex | Shapes, opts: ClipOptions = {}): { closed: Ring[]; open: Polyline[] } {
  const index = indexOf(region);
  const inside = insideFor(index, opts);
  const closed: Ring[] = [];
  const open: Polyline[] = [];
  for (const ring of rings) {
    for (const run of clipRun(opts.compact ? withoutRepeats(ring, true) : ring, index, true, MIN_RUN, inside)) {
      if (run.closed) closed.push(run.points);
      else open.push(run.points);
    }
  }
  return { closed, open };
}

/**
 * `clipRingsAsLines` for rings kept in islands, as a layer of a design keeps them: a ring that
 * survived whole comes back closed, an island of its own in `shapes`; every other run is an open
 * line in `paths`. What a score layer goes through: a coaster's two rule circles stay closed when
 * nothing was punched out of the plate, and come back as open arcs when something was.
 */
export function clipShapesToLines(shapes: Shapes, region: EdgeIndex | Shapes, opts: ClipOptions = {}): { shapes: Shapes; paths: Polyline[] } {
  const { closed, open } = clipRingsAsLines(shapes.flat(), region, opts);
  return { shapes: closed.map((ring) => [ring]), paths: open };
}

/** How much line there is, mm: every ring of `shapes` as a closed loop (its closing step
 *  counted) and every run of `paths` as drawn. Tells a score that was trimmed from one that was
 *  mostly thrown away. */
export function lineLength(shapes: Shapes, paths: Polyline[] = []): number {
  let sum = 0;
  for (const island of shapes) for (const ring of island) sum += ringLength(ring, true);
  for (const p of paths) sum += ringLength(p, false);
  return sum;
}

/**
 * Cut a polyline into the pieces that stay at least `margin` from the region's edge. The
 * runs are sampled every ~`margin/2` (never coarser than 0.5 mm) and a piece is kept when its
 * midpoint clears the edge — a decorative fill is judged by eye, not by a CMM, and this keeps
 * the package free of an offset routine.
 */
export function trimNearEdge(polylines: Polyline[], index: EdgeIndex, margin: number): Polyline[] {
  if (margin <= 0) return polylines;
  const step = Math.min(0.5, margin / 2);
  const out: Polyline[] = [];
  for (const line of polylines) {
    let run: Pt[] | null = null;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const p = lerp(a, b, k / n);
        const q = lerp(a, b, (k + 1) / n);
        const m = lerp(a, b, (k + 0.5) / n);
        if (index.distance(m, margin) >= margin) {
          if (!run) run = [p];
          run.push(q);
        } else if (run) {
          out.push(run);
          run = null;
        }
      }
    }
    if (run) out.push(run);
  }
  return out.filter((r) => runLength(r) >= MIN_RUN);
}

// ---- convex polygon clipping -------------------------------------------------------------

/** Sutherland–Hodgman: `subject` clipped to the CONVEX ring `clip`. */
export function clipToConvex(subject: Ring, clip: Ring): Ring {
  const ccw = signedArea(clip) > 0 ? clip : [...clip].reverse();
  let out = subject;
  for (let i = 0; i < ccw.length && out.length; i++) {
    const a = ccw[i]!;
    const b = ccw[(i + 1) % ccw.length]!;
    const input = out;
    out = [];
    const insideOf = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prev = input[(j + input.length - 1) % input.length]!;
      const curIn = insideOf(cur);
      const prevIn = insideOf(prev);
      if (curIn) {
        if (!prevIn) out.push(intersectLines(prev, cur, a, b));
        out.push(cur);
      } else if (prevIn) out.push(intersectLines(prev, cur, a, b));
    }
  }
  return out;
}

/** Where p→q meets the infinite LINE through a→b — Sutherland–Hodgman clips against the
 *  clip polygon's edge lines, not its edges, so the crossing may lie far past b. */
function intersectLines(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return p;
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den;
  return lerp(p, q, Math.max(0, Math.min(1, t)));
}

/**
 * A convex hole clipped to the region: every ring of every island is clipped to the hole, and
 * what is left is nested back into islands (an outer that survived keeps the counters that did).
 * Exact for convex holes; a concave hole is the host's boolean's job.
 */
export function clipHoleToRegion(hole: Ring, region: Shapes): Island[] {
  if (!isConvex(hole)) return [];
  const rings: Ring[] = [];
  for (const island of region) {
    for (const ring of island) {
      const r = clipToConvex(ring, hole);
      if (r.length >= 3 && Math.abs(signedArea(r)) > 1e-6) rings.push(r);
    }
  }
  // Every region ring is either an outer or a hole; even-odd nesting of what survived sorts
  // them back out, because a counter clipped to the hole is still inside its outer's clip.
  return nestFromRegion(rings);
}

function nestFromRegion(rings: Ring[]): Island[] {
  if (rings.length <= 1) return rings.length ? [rings] : [];
  const areas = rings.map((r) => Math.abs(signedArea(r)));
  const order = rings.map((_, i) => i).sort((a, b) => areas[b]! - areas[a]!);
  const islands: Island[] = [];
  const parentOf = new Map<number, Island>();
  for (const i of order) {
    const r = rings[i]!;
    let depth = 0;
    let parent: Island | null = null;
    for (const j of order) {
      if (j === i || areas[j]! <= areas[i]!) continue;
      if (insideRing(r, rings[j]!)) {
        depth++;
        if (!parent) parent = parentOf.get(j) ?? null;
      }
    }
    if (depth % 2 === 0) {
      const island: Island = [r];
      islands.push(island);
      parentOf.set(i, island);
    } else if (parent) {
      parent.push(r);
      parentOf.set(i, parent);
    }
  }
  return islands;
}

/**
 * Is `inner` inside `outer`? Rings out of one clip never cross, so any point OF the inner ring
 * that is not on the outer one decides for all of it: its first such corner, else the middle of
 * its first such edge. Never the corners' average: for a curved band, an arc or a T it lies in
 * the ring's own bay, outside it — a hole at the rim was then read as a shape and engraved solid
 * (Ian, 2026-09-29: Waves - 20's bands, Chinese - 14's T blocks).
 */
function insideRing(inner: Ring, outer: Ring): boolean {
  for (const mid of [false, true]) {
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i]!;
      const b = inner[(i + 1) % inner.length]!;
      const s = sideOfRing(outer, mid ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a);
      if (s !== 0) return s > 0;
    }
  }
  return false;
}

/** 1 inside the ring (even-odd), −1 outside, 0 on it (within a hundredth of a micron). */
function sideOfRing(ring: Ring, p: Pt): number {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (pointSegmentDistance(p, a, b) <= 1e-8) return 0;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}

// ---- general polygon intersection ------------------------------------------------------------

/**
 * An island (outer ring + holes) clipped to the region — any shape against any shape, with no
 * polygon library: the boundary of A ∩ B is made of the parts of A's edges that lie inside B
 * and the parts of B's edges that lie inside A. Both are what `clipRun` already computes, so
 * the pieces are collected as segments and chained back into loops at their shared crossing
 * points. A ring that survived whole on either side is a loop already. Null when the chaining
 * leaves an open run (a crossing landed on a vertex, an edge lay along an edge) — the caller
 * then keeps the shape whole for the host's boolean, as before.
 */
export function clipIslandToRegion(input: Island, index: EdgeIndex): Island[] | null {
  // A zero-area ring (a dot flattened to three collinear points) is not a shape and cannot be
  // walked; it is dropped before anything else.
  const island = input.filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6);
  if (!island.length) return [];
  const whole = clipRingsToRegion(island, index);
  if (whole || island.length === 1) return whole;
  // A many-ringed island whose holes straddle its outer (a tile's wrap-around copies) defeats
  // the even-odd insideness the chaining relies on. Ring by ring, each is a simple polygon and
  // clips cleanly; the pieces are nested back into islands by containment.
  const rings: Ring[] = [];
  for (const ring of island) {
    const pieces = clipRingsToRegion([ring], index);
    if (!pieces) return null;
    for (const piece of pieces) for (const r of piece) rings.push(r);
  }
  return rings.length ? nestFromRegion(rings) : [];
}

function clipRingsToRegion(island: Island, index: EdgeIndex): Island[] | null {
  const islandIndex = new EdgeIndex([island]);
  const rings: Ring[] = [];
  const segments: [Pt, Pt][] = [];
  const collect = (runs: Run[]) => {
    for (const run of runs) {
      if (run.closed) rings.push(run.points);
      else for (let i = 0; i < run.points.length - 1; i++) segments.push([run.points[i]!, run.points[i + 1]!]);
    }
  };
  // No fragment is dust here: a 0.01 mm piece at a crossing is what joins two loops.
  for (const ring of island) collect(clipRun(ring, index, true, 0));
  for (const regionIsland of index.shapes) for (const ring of regionIsland) collect(clipRun(ring, islandIndex, true, 0));
  // The same crossing is computed twice — once along each polygon's edge — and the two answers
  // differ in the last bits, so endpoints are snapped by proximity before the chaining keys
  // them; a segment the snap collapsed to a point would read as a junction, so it goes.
  snapEndpoints(segments, 1e-4);
  const live = segments.filter(([a, b]) => a !== b && key(a) !== key(b));
  for (const chain of chainSegments(live)) {
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    if (key(first) !== key(last)) return null;
    // Out and straight back (a spike of the drawing crossing the edge) closes on itself with no
    // area: nothing to keep, and no reason to give the whole island up.
    if (chain.length < 4) continue;
    rings.push(chain.slice(0, -1));
  }
  const kept = rings.filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > 1e-6);
  return kept.length ? nestFromRegion(kept) : [];
}

/** Endpoints within `tol` of an earlier endpoint take its exact coordinates. */
function snapEndpoints(segments: [Pt, Pt][], tol: number): void {
  const cells = new Map<string, Pt[]>();
  const cellKey = (x: number, y: number) => `${Math.floor(x / tol)},${Math.floor(y / tol)}`;
  const snap = (p: Pt): Pt => {
    const cx = Math.floor(p[0] / tol);
    const cy = Math.floor(p[1] / tol);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = cells.get(`${cx + i},${cy + j}`);
        if (!bucket) continue;
        for (const q of bucket) if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol) return q;
      }
    }
    const k = cellKey(p[0], p[1]);
    let bucket = cells.get(k);
    if (!bucket) cells.set(k, (bucket = []));
    bucket.push(p);
    return p;
  };
  for (const s of segments) {
    s[0] = snap(s[0]);
    s[1] = snap(s[1]);
  }
}

// ---- segment merging ------------------------------------------------------------------------

/** Coordinates quantised to a micron, so two floats that mean the same point agree. */
const key = (p: Pt): string => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

/**
 * Lines → unique, maximal, chained polylines. Every polyline is broken into segments, exact
 * duplicates and collinear overlaps are merged along their line, and the survivors are chained
 * end to end where exactly two meet. A hexagon lattice drawn hexagon by hexagon comes out with
 * each edge once; four half-lines from four cells come out as one line.
 */
export function mergeLines(lines: Polyline[]): Polyline[] {
  // Group by the line each segment lies on: a unit direction (sign-normalised) and the signed
  // distance of the line from the origin, both quantised.
  const groups = new Map<string, { ux: number; uy: number; ox: number; oy: number; spans: [number, number][] }>();
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      dx /= len;
      dy /= len;
      if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) {
        dx = -dx;
        dy = -dy;
      }
      // The line's offset: the point on it nearest the origin.
      const t = a[0] * dx + a[1] * dy;
      const ox = a[0] - dx * t;
      const oy = a[1] - dy * t;
      const k = `${Math.round(dx * 1e5)},${Math.round(dy * 1e5)}|${Math.round(ox * 200)},${Math.round(oy * 200)}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { ux: dx, uy: dy, ox, oy, spans: [] }));
      const ta = (a[0] - g.ox) * g.ux + (a[1] - g.oy) * g.uy;
      const tb = (b[0] - g.ox) * g.ux + (b[1] - g.oy) * g.uy;
      g.spans.push(ta < tb ? [ta, tb] : [tb, ta]);
    }
  }
  const segments: [Pt, Pt][] = [];
  for (const g of groups.values()) {
    g.spans.sort((p, q) => p[0] - q[0]);
    let cur: [number, number] | null = null;
    const flush = () => {
      if (cur) segments.push([[g.ox + g.ux * cur[0], g.oy + g.uy * cur[0]], [g.ox + g.ux * cur[1], g.oy + g.uy * cur[1]]]);
    };
    for (const s of g.spans) {
      if (cur && s[0] <= cur[1] + 1e-4) cur[1] = Math.max(cur[1], s[1]);
      else {
        flush();
        cur = [s[0], s[1]];
      }
    }
    flush();
  }
  return chainSegments(segments);
}

/**
 * Lines → the same lines, less every stretch that runs within `tol` of a line before it, along it.
 *
 * `mergeLines` merges a line drawn twice only when both copies round to one key, and a tile's
 * copies are written apart by its data's last decimal: Asanoha draws one diagonal as
 * `34.64,40→46.187,20` in one subpath and `34.641,40→46.188,20` in another, 0.3 µm apart, their
 * keys straddle a rounding step, and the default coaster burnt 62 mm of it twice. A curve drawn
 * twice and flattened at different points is not even the same straight segments (Scales - 3).
 * So a stretch is judged by where it lies: within `tol` of a kept line and running with it (under
 * `ANGLE` apart), it is that line again and goes.
 *
 * Only DROPPED — nothing kept is moved, so a line drawn once comes out exactly as it went in. Only
 * stretches of `MIN_DUP` or more. And never where two DIFFERENT lines merely touch: two lines that
 * cross at a shallow angle, or two circles tangent to each other (Moiré is made of nothing else),
 * come within `tol` over a stretch too — but they part on BOTH sides of it, where a line drawn twice
 * runs with its twin until one of them ends.
 */
export function dropNearDuplicates(lines: Polyline[], tol = NEAR_LINE): Polyline[] {
  type Seg = { ax: number; ay: number; bx: number; by: number; ux: number; uy: number; len: number; seen: number };
  // A grid of the kept segments, 4 mm a cell. A segment is sampled every half cell and filed under
  // every cell within reach of a sample (half a step and `tol`), so a segment looking for its twin
  // need look only in the cells its own samples fall in: a twin within `tol` has a sample within
  // reach of each of them. (A 300 mm panel of Moiré is 105 m of line: few lookups, not many.)
  const size = 4;
  const step = size / 2;
  const reach = step / 2 + tol;
  const grid = new Map<number, Seg[]>();
  const cellOf = (x: number, y: number) => (Math.floor(x / size) + 1048576) * 2097152 + (Math.floor(y / size) + 1048576);
  let asked = 0;
  const out: Polyline[] = [];
  for (const line of lines) {
    // Where along the line a kept line runs with it: stretches of each segment, as fractions of it,
    // and at each end of a stretch whether it ends because the two lines PART (not because one of
    // them ends).
    type Stretch = { from: number; to: number; partsFrom: boolean; partsTo: boolean };
    const segs: { a: Pt; b: Pt; len: number; along: Stretch[] }[] = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-9) continue;
      const ux = (b[0] - a[0]) / len;
      const uy = (b[1] - a[1]) / len;
      const along: Stretch[] = [];
      const me = ++asked;
      const n = Math.max(1, Math.ceil(len / step));
      let last = NaN;
      for (let j = 0; j <= n; j++) {
        const k = cellOf(a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n);
        // (A straight segment visits each cell in one run.)
        if (k === last) continue;
        last = k;
        const list = grid.get(k);
        if (!list) continue;
        for (const s of list) {
          if (s.seen === me) continue;
          s.seen = me;
          if (Math.abs(ux * s.uy - uy * s.ux) > ANGLE) continue;
          // Along s, and off its line: both linear in t along a→b.
          const a0 = (a[0] - s.ax) * s.ux + (a[1] - s.ay) * s.uy;
          const a1 = (b[0] - s.ax) * s.ux + (b[1] - s.ay) * s.uy;
          const o0 = (a[0] - s.ax) * -s.uy + (a[1] - s.ay) * s.ux;
          const o1 = (b[0] - s.ax) * -s.uy + (b[1] - s.ay) * s.ux;
          const da = a1 - a0;
          const lo = Math.max(0, da > 0 ? -a0 / da : (s.len - a0) / da);
          const hi = Math.min(1, da > 0 ? (s.len - a0) / da : -a0 / da);
          const dO = o1 - o0;
          let olo = -Infinity;
          let ohi = Infinity;
          if (Math.abs(dO) < 1e-15) {
            if (Math.abs(o0) > tol) continue;
          } else {
            olo = Math.min((-tol - o0) / dO, (tol - o0) / dO);
            ohi = Math.max((-tol - o0) / dO, (tol - o0) / dO);
          }
          const from = Math.max(lo, olo);
          const to = Math.min(hi, ohi);
          if (to > from) along.push({ from, to, partsFrom: olo > lo, partsTo: ohi < hi });
        }
      }
      segs.push({ a, b, len, along });
    }
    // The covered runs along the whole line, each with whether the lines part at its two ends.
    type Run = { first: number; from: number; partsFrom: boolean; last: number; to: number; partsTo: boolean; length: number };
    const runs: Run[] = [];
    let open: Run | null = null;
    segs.forEach((seg, i) => {
      const crumb = 1e-3 / seg.len;
      const merged: Stretch[] = [];
      for (const s of [...seg.along].sort((p, q) => p.from - q.from)) {
        const m = merged[merged.length - 1];
        if (m && s.from <= m.to + crumb) {
          if (s.to > m.to) {
            m.to = s.to;
            m.partsTo = s.partsTo;
          }
        } else merged.push({ ...s });
      }
      for (const m of merged) {
        // A run reaching the end of one segment goes on into the next, if that is covered from its start.
        if (open && open.last === i - 1 && open.to >= 1 - 1e-3 / segs[i - 1]!.len && m.from <= crumb) {
          open.last = i;
          open.to = m.to;
          open.partsTo = m.partsTo;
          open.length += (m.to - m.from) * seg.len;
        } else {
          if (open) runs.push(open);
          open = { first: i, from: m.from, partsFrom: m.partsFrom, last: i, to: m.to, partsTo: m.partsTo, length: (m.to - m.from) * seg.len };
        }
      }
    });
    if (open) runs.push(open);
    // Drop a run long enough to be a line drawn twice, that the two lines' parting does not bound at
    // both ends.
    const drop = runs.filter((r) => r.length >= MIN_DUP && !(r.partsFrom && r.partsTo));
    if (drop.length) {
      const keep: [Pt, Pt][] = [];
      segs.forEach((seg, i) => {
        const lerp = (u: number): Pt => (u <= 0 ? seg.a : u >= 1 ? seg.b : [seg.a[0] + (seg.b[0] - seg.a[0]) * u, seg.a[1] + (seg.b[1] - seg.a[1]) * u]);
        const crumb = 1e-3 / seg.len;
        // This segment's parts of the dropped runs.
        const gone = drop.filter((r) => r.first <= i && r.last >= i).map((r) => [r.first === i ? r.from : 0, r.last === i ? r.to : 1] as [number, number]).sort((p, q) => p[0] - q[0]);
        let t = 0;
        for (const [lo, hi] of gone) {
          if (lo - t > crumb) keep.push([lerp(t), lerp(lo)]);
          t = Math.max(t, hi);
        }
        if (1 - t > crumb) keep.push([lerp(t), seg.b]);
      });
      out.push(...chainSegments(keep));
    } else out.push(line);
    for (const seg of segs) {
      const s: Seg = { ax: seg.a[0], ay: seg.a[1], bx: seg.b[0], by: seg.b[1], ux: (seg.b[0] - seg.a[0]) / seg.len, uy: (seg.b[1] - seg.a[1]) / seg.len, len: seg.len, seen: 0 };
      const n = Math.max(1, Math.ceil(s.len / step));
      for (let j = 0; j <= n; j++) {
        const x = s.ax + ((s.bx - s.ax) * j) / n;
        const y = s.ay + ((s.by - s.ay) * j) / n;
        for (const k of [cellOf(x - reach, y - reach), cellOf(x + reach, y - reach), cellOf(x - reach, y + reach), cellOf(x + reach, y + reach)]) {
          const list = grid.get(k);
          if (!list) grid.set(k, [s]);
          else if (list[list.length - 1] !== s) list.push(s);
        }
      }
    }
  }
  return out;
}

/** Two lines closer than this, running together, are one line drawn twice, mm: a tenth of a
 *  scored line's width, and a hundred times the rounding that parts a tile's copies. */
const NEAR_LINE = 0.02;
/** …when they run within this of one direction: the sine of 10°. A curve flattened twice at
 *  different points runs a few degrees off itself; two lines meeting at a real angle do not. */
const ANGLE = Math.sin((10 * Math.PI) / 180);
/** The shortest stretch dropped as drawn twice, mm: a shorter one is two lines meeting. */
const MIN_DUP = 0.1;

/**
 * Filled regions → the outline of their UNION, as lines.
 *
 * A tiled fill is built cell by cell, and a motif that runs off one cell into the next leaves
 * both cells carrying the same edge along the cell boundary. Score each island on its own and
 * that boundary is burnt: a grid appears behind the pattern, drawn straight through the motif
 * it is supposed to be part of. Ian saw it on `japanese-pattern-7` (2026-09-22); it was there
 * for every one of the library's fill tiles, which is why some patterns scored cleanly and some
 * did not.
 *
 * What the eye expects is the boundary of the merged region, so: an edge covered by TWO regions
 * is interior and goes, an edge covered by one is boundary and stays. That is parity, not
 * `mergeLines`' deduplication — merging two coincident edges into one is exactly what drew the
 * grid. Partial overlaps fall out of it correctly too, because coverage is counted along the
 * line rather than per whole segment: where three cells meet along a run, only the odd stretches
 * survive.
 *
 * Not a general polygon union. It resolves coincident EDGES; two regions that genuinely cross —
 * Plus - 5's two bars per cross, a colour painted over another, a motif a tile draws on both
 * sides of its seam — need a real union, and a host that has a boolean traces that itself
 * (`FillOptions.hostOutline`, the studio's worker). This is the fallback for a host without one.
 */
export function outlineOfRegions(rings: Ring[]): Polyline[] {
  const groups = new Map<string, { ux: number; uy: number; ox: number; oy: number; spans: [number, number][] }>();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      // Rings are closed, so the last point joins the first — that edge is a boundary like any
      // other, and leaving it out opens every loop at one arbitrary corner.
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      dx /= len;
      dy /= len;
      if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) {
        dx = -dx;
        dy = -dy;
      }
      const t = a[0] * dx + a[1] * dy;
      const ox = a[0] - dx * t;
      const oy = a[1] - dy * t;
      const k = `${Math.round(dx * 1e5)},${Math.round(dy * 1e5)}|${Math.round(ox * 200)},${Math.round(oy * 200)}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { ux: dx, uy: dy, ox, oy, spans: [] }));
      const ta = (a[0] - g.ox) * g.ux + (a[1] - g.oy) * g.uy;
      const tb = (b[0] - g.ox) * g.ux + (b[1] - g.oy) * g.uy;
      g.spans.push(ta < tb ? [ta, tb] : [tb, ta]);
    }
  }

  const segments: [Pt, Pt][] = [];
  for (const g of groups.values()) {
    const at = (s: number): Pt => [g.ox + g.ux * s, g.oy + g.uy * s];
    // Every endpoint is a place the coverage can change; between two of them it is constant. A
    // sweep: the endpoints in order, a span opening at its start and closing at its end, so the
    // count after each position is the coverage up to the next. (A midpoint test against every
    // span was quadratic in the spans on one line — a library plaid lays hundreds of cells'
    // edges along each stripe, and that was 0.3–1 s of every build on the main thread.)
    const events = g.spans.flatMap(([s, e]): [number, number][] => [[s, 1], [e, -1]]).sort((p, q) => p[0] - q[0]);
    let run: [number, number] | null = null;
    const flush = () => {
      if (run) segments.push([at(run[0]), at(run[1])]);
      run = null;
    };
    let cover = 0;
    for (let i = 0; i < events.length; ) {
      const lo = events[i]![0];
      while (i < events.length && events[i]![0] === lo) cover += events[i++]![1];
      if (i >= events.length) break;
      const hi = events[i]![0];
      if (hi - lo < 1e-6) continue;
      if (cover % 2 !== 0) {
        if (run && Math.abs(run[1] - lo) < 1e-6) run[1] = hi;
        else {
          flush();
          run = [lo, hi];
        }
      } else flush();
    }
    flush();
  }
  return chainSegments(segments);
}

/** Segments → polylines, joined wherever exactly two segment ends meet at a point. */
export function chainSegments(segments: [Pt, Pt][]): Polyline[] {
  const at = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      let list = at.get(k);
      if (!list) at.set(k, (list = []));
      list.push(i);
    }
  });
  const used = new Array<boolean>(segments.length).fill(false);
  const out: Polyline[] = [];
  const walk = (start: number, from: Pt): Polyline => {
    const line: Polyline = [from];
    let i = start;
    let p = from;
    for (;;) {
      used[i] = true;
      const [a, b] = segments[i]!;
      const q = key(a) === key(p) ? b : a;
      line.push(q);
      const next = (at.get(key(q)) ?? []).filter((j) => !used[j]);
      if (next.length !== 1 || (at.get(key(q)) ?? []).length !== 2) break;
      i = next[0]!;
      p = q;
    }
    return line;
  };
  // Open chains first, from the ends (a point with one segment, or a junction), then whatever
  // is left are closed loops.
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const [a, b] = segments[i]!;
    const da = (at.get(key(a)) ?? []).length;
    const db = (at.get(key(b)) ?? []).length;
    if (da !== 2) out.push(walk(i, a));
    else if (db !== 2) out.push(walk(i, b));
  }
  for (let i = 0; i < segments.length; i++) if (!used[i]) out.push(walk(i, segments[i]![0]));
  return out;
}

/**
 * The same ring drawn twice: as many vertices, and every vertex of each within `tol` of one of
 * the other's (after moving `a` by `d`). A fingerprint cannot say this — Plus - 5 draws each
 * cross as two bars with the same vertex count, area and vertex centroid, and a fingerprint took
 * the second bar for a copy of the first, and the plus pattern came out wrong (2026-09-29).
 */
export function sameRing(a: Ring, b: Ring, tol: number, d: Pt = [0, 0]): boolean {
  if (a.length !== b.length) return false;
  const close = (p: Pt, q: Pt) => Math.abs(p[0] + d[0] - q[0]) <= tol && Math.abs(p[1] + d[1] - q[1]) <= tol;
  return a.every((p) => b.some((q) => close(p, q))) && b.every((q) => a.some((p) => close(p, q)));
}

/** How far apart two copies of one shape may lie and still be one shape, mm: five microns, far
 *  under anything a laser draws and far over the float noise between two cells' copies. */
const SAME_SHAPE = 0.005;

/** Identical closed shapes drawn by neighbouring cells collapse to one: a fingerprint finds the
 *  candidates, the vertices decide (`sameRing`). */
export function dedupeIslands(islands: Island[]): Island[] {
  const seen = new Map<string, Island[]>();
  const out: Island[] = [];
  for (const island of islands) {
    const outer = island[0];
    if (!outer || outer.length < 3) continue;
    let x = 0;
    let y = 0;
    for (const p of outer) {
      x += p[0];
      y += p[1];
    }
    const k = `${Math.round((x / outer.length) * 1000)},${Math.round((y / outer.length) * 1000)},${Math.round(Math.abs(signedArea(outer)) * 1000)},${outer.length}`;
    const same = seen.get(k);
    if (same?.some((other) => other.length === island.length && sameRing(other[0]!, outer, SAME_SHAPE))) continue;
    if (same) same.push(island);
    else seen.set(k, [island]);
    out.push(island);
  }
  return out;
}
