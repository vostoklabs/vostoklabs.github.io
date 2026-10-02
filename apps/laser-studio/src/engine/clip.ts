// Clipping LINES, not polygons — the one thing manifold cannot do for us.
//
// A score is a line. Intersecting its ring with the plate AS A POLYGON is what turned the arc
// coaster's two rule circles into 56 garbled paths the moment the lettering was cut out of the
// plate (G20): a ring encloses no material, so the boolean answers with slivers. The fix is to
// treat a score as what it is — a polyline — and keep the parts of it that lie on material.
//
// The same machinery draws the seams of a welded word (G3): a glyph's outline clipped to the
// INTERIOR of the plate is exactly the run where that letter is buried in its neighbour.
//
// Pure: no manifold, no DOM. Split every segment at every crossing of a polygon edge, keep a
// sub-segment when its midpoint is inside (even-odd, the rule the plate itself is drawn with),
// then merge the kept pieces back into the longest runs they form.
import type { Shapes } from '@vostok/laser';
import { insideShapes, insideUnion } from './editorGeometry';

type Pt = [number, number];

/**
 * Which points count as "on material".
 *
 * `even-odd` is the rule a built plate is drawn with and the default: every ring toggles, so a
 * counter is a hole. `union` is the rule a set of OVERLAPPING islands needs — the letters of a
 * welded word, before manifold has unioned them. Under even-odd a point covered by two letters
 * at once reads as outside, which is precisely the overlap a seam lives in (G32), so the seam
 * clip asks for the union instead.
 */
export interface ClipOpts { union?: boolean }

/** A run shorter than this is numerical dust off a near-tangent crossing, not a line a laser
 *  could follow. */
const MIN_RUN = 0.05;
const EPS_T = 1e-7;

/** One polygon edge with its box, so a segment nowhere near it costs two comparisons. */
interface Edge { c: Pt; d: Pt; minX: number; maxX: number; minY: number; maxY: number }

function edgesOf(polygons: Shapes): Edge[] {
  const out: Edge[] = [];
  for (const island of polygons) {
    for (const ring of island) {
      for (let i = 0; i < ring.length; i++) {
        const c = ring[i]!;
        const d = ring[(i + 1) % ring.length]!;
        out.push({
          c, d,
          minX: Math.min(c[0], d[0]), maxX: Math.max(c[0], d[0]),
          minY: Math.min(c[1], d[1]), maxY: Math.max(c[1], d[1]),
        });
      }
    }
  }
  return out;
}

/** Where segment a→b crosses segment c→d, as a fraction along a→b. Null when they are parallel
 *  or the crossing misses c→d. */
function crossing(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const u = (qx * ry - qy * rx) / den;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  return (qx * sy - qy * sx) / den;
}

/** The maximal sub-intervals of a→b whose midpoint lies inside `polygons`. */
function insidePieces(a: Pt, b: Pt, polygons: Shapes, edges: Edge[], inside: (s: Shapes, p: Pt) => boolean): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
  const ts = [0, 1];
  for (const e of edges) {
    if (e.maxX < minX || e.minX > maxX || e.maxY < minY || e.minY > maxY) continue;
    const t = crossing(a, b, e.c, e.d);
    if (t !== null && t > EPS_T && t < 1 - EPS_T) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if ((t1 - t0) * len < 1e-6) continue;
    const m = (t0 + t1) / 2;
    if (!inside(polygons, [a[0] + dx * m, a[1] + dy * m])) continue;
    const prev = out[out.length - 1];
    if (prev && t0 - prev[1] < EPS_T) prev[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function runLength(points: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return sum;
}

/** Two points this close are the same point: a thousandth of the three-decimal rounding the font
 *  pipeline does, and comfortably under both thresholds a zero-length step trips below. */
const DUP_EPS = 1e-6;

/**
 * The same line with its zero-length steps removed.
 *
 * A glyph's contours come out of the font rounded to three decimals, so a curve's control points
 * land on top of each other all the time. A step of no length has no midpoint to test:
 * `insidePieces` answered "nothing here", `clipOne` read that as a GAP, and a scored word that
 * lay entirely on material came back as a string of open runs — the bracelet card's three score
 * objects were 100 open paths where 18 closed rings were wanted, and the laser lifts its head
 * once per path. Dropping the duplicates before the walk is the whole fix: a ring wholly inside
 * the plate stays one closed ring, and a ring the plate really does cut still splits where it
 * crosses. A ring's implicit closing step counts too, so a trailing copy of the first point goes.
 */
function compact(points: Pt[], isRing: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (q && Math.abs(p[0] - q[0]) < DUP_EPS && Math.abs(p[1] - q[1]) < DUP_EPS) continue;
    out.push(p);
  }
  while (isRing && out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.abs(first[0] - last[0]) >= DUP_EPS || Math.abs(first[1] - last[1]) >= DUP_EPS) break;
    out.pop();
  }
  return out;
}

/** One kept run. `closed` means the whole ring survived and is still a ring. */
interface Run { points: Pt[]; closed: boolean }

function clipOne(raw: Pt[], polygons: Shapes, edges: Edge[], isRing: boolean, inside = insideShapes): Run[] {
  const points = compact(raw, isRing);
  const n = points.length;
  if (n < 2 || !polygons.length) return [];
  const segments = isRing ? n : n - 1;
  const runs: Run[] = [];
  let run: Pt[] | null = null;
  /** The previous segment ended ON material, so the next piece continues this run. */
  let open = false;
  /** The very first point of the ring is on material — what a wrap-around needs. */
  let fromTheStart = false;
  for (let i = 0; i < segments; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const pieces = insidePieces(a, b, polygons, edges, inside);
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
      if (!open) { runs.push({ points: run, closed: false }); run = null; }
    }
  }
  if (run) runs.push({ points: run, closed: false });
  // A ring's seam is not a gap: a run that reached the last point continues into the one that
  // started at the first. Both being the same run means nothing was cut away at all.
  if (isRing && open && fromTheStart && runs.length) {
    if (runs.length === 1) runs[0] = { points: runs[0]!.points.slice(0, -1), closed: true };
    else {
      const tail = runs.pop()!;
      const head = runs.shift()!;
      runs.unshift({ points: [...tail.points, ...head.points.slice(1)], closed: false });
    }
  }
  return runs.filter((r) => r.points.length >= 2 && (r.closed || runLength(r.points) >= MIN_RUN));
}

/**
 * The parts of each OPEN polyline that lie inside `polygons`, as open polylines.
 *
 * Split at every crossing, keep a sub-segment when its midpoint is inside, merge what is
 * consecutive — so a line crossing a plate three times comes back as three runs.
 */
export function clipPolylines(polylines: Pt[][], polygons: Shapes, opts: ClipOpts = {}): Pt[][] {
  const edges = edgesOf(polygons);
  const inside = opts.union ? insideUnion : insideShapes;
  return polylines.flatMap((p) => clipOne(p, polygons, edges, false, inside).map((r) => r.points));
}

/**
 * A layer's rings clipped to `polygons` AS LINES: a ring that survived whole stays a closed
 * ring (`shapes`, one ring per island), everything else becomes an open run (`paths`).
 *
 * This is what a score layer goes through: it keeps the two rule circles of a coaster closed
 * when nothing was punched out of the plate, and hands back open arcs when something was.
 */
export function clipShapesToLines(shapes: Shapes, polygons: Shapes, opts: ClipOpts = {}): { shapes: Shapes; paths: Pt[][] } {
  const edges = edgesOf(polygons);
  const inside = opts.union ? insideUnion : insideShapes;
  const rings: Shapes = [];
  const paths: Pt[][] = [];
  for (const island of shapes) {
    for (const ring of island) {
      for (const run of clipOne(ring, polygons, edges, true, inside)) {
        if (run.closed) rings.push([run.points]);
        else paths.push(run.points);
      }
    }
  }
  return { shapes: rings, paths };
}

/** How much line there is: a closed ring includes its closing segment. Used to tell a score
 *  that was trimmed from one that was mostly thrown away. */
export function lineLength(shapes: Shapes, paths: Pt[][] = []): number {
  let sum = 0;
  for (const island of shapes) {
    for (const ring of island) {
      if (ring.length < 2) continue;
      sum += runLength([...ring, ring[0]!]);
    }
  }
  for (const p of paths) sum += runLength(p);
  return sum;
}
