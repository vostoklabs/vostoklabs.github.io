// The runs a lattice can hold — the first half of `latticeFaces`, before any boolean.
//
// A strut is only as good as what holds it. The lines of a pattern, clipped to where the faces
// are cut (`zone`: the region shrunk by the inset, less the pattern's solids), are a graph: the
// runs are its edges and the places they meet are its nodes; every place a run meets the zone's
// edge is the FRAME — the border, a reserve's panel, a solid hub — one node for all of them,
// since that material stands whatever the struts do. Three things are wrong with the graph as a
// pattern draws it, and all three are fixed here, on the lines, before a band is built:
//
//   · NEAR MISSES. Two ends that stop a hair apart (plaid's stitching, a tile whose outlines
//     stop and start), a weave's line stopping short of the next, an end just shy of the frame.
//     Built as struts, their caps overlap in a waist narrower than the web and the faces either
//     side come within a hair of each other; left alone, the end is a cantilever. So a free end
//     carries straight on to the first line or edge within two webs, or failing that onto the
//     nearest within one (`snapped`): a near miss becomes the join the drawing meant.
//   · CANTILEVERS. A strut is held when it lies on a loop through the frame or of its own; one
//     that does not is hanging — a ray with nothing at its tip, a stub poking into a face, a
//     spiral's coil (held at one end however many turns it makes), a ring on a stick. Cut out
//     it tips in the bed, flutters under the air assist, snaps off in a pocket. In graph terms
//     it is a BRIDGE: every bridge is taken away (`pruned`), leaving each piece of the drawing
//     either held at both ends or a free loop, which the faces' rule 3 deals with. Taking a
//     cantilever away never joins two faces: it only takes a notch out of the one it poked into.
//   · SPECKS. A free loop too narrow to hold a cut inside it (plaid's stitch marks, a little
//     cross) is not a motif, it is a lump waiting to weld itself to the nearest strut. It goes.
import { EdgeIndex, clipPolylines } from './clip';
import { pointSegmentDistance, signedArea } from './geom';
import type { Polyline, Pt, Shapes } from './types';

/** Two points closer than this are one point, mm — the same junction drawn by two cells. */
const TOL = 1e-4;
/** A point this close to the zone's edge lies on it: where the clip ended a run. */
const ON_EDGE = 1e-6;
/** How far a free end carries straight on to meet a line, in webs at 100 % zoom. A weave's lines
 *  stop short of the next set by a fraction of a cell (hex weave: 1.7 mm along the line at 100 %),
 *  a gap that grows with the zoom while the web does not — so the reach grows with the zoom too,
 *  and a weave that bridges at one zoom bridges at every larger one, rather than turning into
 *  combs (then pruned to bare hexagons) at the zoom the "too fine" sentence sent it to. */
const CARRY = 2;

export interface HeldRun {
  points: Pt[];
  /** The run closes on itself (first point = last): it has no ends. */
  loop: boolean;
  /** Each end lies on the zone's edge — the frame, a reserve's border or a solid — rather than
   *  on another strut: the band there must run on past the edge, not stop at it. */
  held: [boolean, boolean];
}

/** A cell of the held drawing at zero width: a space the lines (and the zone's edge) close. */
export interface Cell {
  /** Its outline, counter-clockwise… */
  ring: Pt[];
  /** …and the outlines of what floats inside it: a loop touching nothing, a reserve's border. */
  holes: Pt[][];
  /** Area of the space between them. */
  area: number;
  /** The length of its sides that are lines — where struts will eat into it; the zone's edge
   *  does not. */
  lines: number;
  /** One of its sides is the zone's edge: a cell the frame cut through, or a reserve's border. */
  frame: boolean;
}

export interface Held {
  runs: HeldRun[];
  /** Every cell the held runs make in the zone, before any strut is built. */
  cells: Cell[];
  snapped: number;
  /** Pieces of run taken away: bridges (cantilevers) and specks. */
  pruned: number;
  /** …and how much line that was, against all there was, mm — a drawing that lost most of its
   *  length to pruning does not hold together, whatever the faces then say. */
  prunedLength: number;
  totalLength: number;
  /** A point on each piece taken away (its middle vertex): where the drawing lost its lines, so
   *  a face left empty there is empty for that reason, not for being big. */
  prunedAt: Pt[];
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The nearest point of segment a→b to p. */
export function closestOn(p: Pt, a: Pt, b: Pt): Pt {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2));
  return [a[0] + vx * t, a[1] + vy * t];
}

/** Every segment of every run in a uniform grid, so a query only meets its neighbours. */
class SegGrid {
  readonly a: Pt[] = [];
  readonly b: Pt[] = [];
  readonly run: number[] = [];
  readonly seg: number[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly stamp: number[] = [];
  private tick = 0;
  constructor(readonly size: number) {}

  private key(ix: number, iy: number): number {
    return (ix + 1048576) * 2097152 + (iy + 1048576);
  }

  add(run: number, seg: number, a: Pt, b: Pt): number {
    const id = this.a.length;
    this.a.push(a);
    this.b.push(b);
    this.run.push(run);
    this.seg.push(seg);
    this.stamp.push(0);
    const s = this.size;
    for (let x = Math.floor(Math.min(a[0], b[0]) / s); x <= Math.floor(Math.max(a[0], b[0]) / s); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) / s); y <= Math.floor(Math.max(a[1], b[1]) / s); y++) {
        const k = this.key(x, y);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(id);
        else this.cells.set(k, [id]);
      }
    }
    return id;
  }

  /** Each segment whose cells meet the box, once. */
  near(minX: number, minY: number, maxX: number, maxY: number, fn: (id: number) => void): void {
    const t = ++this.tick;
    const s = this.size;
    for (let x = Math.floor(minX / s); x <= Math.floor(maxX / s); x++) {
      for (let y = Math.floor(minY / s); y <= Math.floor(maxY / s); y++) {
        const bucket = this.cells.get(this.key(x, y));
        if (!bucket) continue;
        for (const id of bucket) {
          if (this.stamp[id] === t) continue;
          this.stamp[id] = t;
          fn(id);
        }
      }
    }
  }

  /** Every cell's bucket, for the pairwise crossing test. */
  buckets(): IterableIterator<[number, number[]]> {
    return this.cells.entries();
  }

  cellOf(p: Pt): number {
    return this.key(Math.floor(p[0] / this.size), Math.floor(p[1] / this.size));
  }
}

/** The graph's junctions, found by position within `TOL`, so one junction drawn twice is one. */
class Nodes {
  readonly x: number[] = [];
  readonly y: number[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly size = 1e-3;
  private key(ix: number, iy: number): number {
    return (ix + 1048576) * 2097152 + (iy + 1048576);
  }

  at(p: Pt): number {
    const ix = Math.floor(p[0] / this.size);
    const iy = Math.floor(p[1] / this.size);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(this.key(ix + dx, iy + dy));
        if (!bucket) continue;
        for (const n of bucket) {
          const ex = this.x[n]! - p[0];
          const ey = this.y[n]! - p[1];
          if (ex * ex + ey * ey < TOL * TOL) return n;
        }
      }
    }
    const n = this.x.length;
    this.x.push(p[0]);
    this.y.push(p[1]);
    const k = this.key(ix, iy);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(n);
    else this.cells.set(k, [n]);
    return n;
  }

  point(n: number): Pt {
    return [this.x[n]!, this.y[n]!];
  }
}

const isClosed = (r: Pt[]): boolean => r.length > 3 && dist(r[0]!, r[r.length - 1]!) < TOL;

/** Arc length at each vertex. */
function cumulative(r: Pt[]): number[] {
  const c = [0];
  for (let i = 1; i < r.length; i++) c.push(c[i - 1]! + dist(r[i - 1]!, r[i]!));
  return c;
}

/**
 * The lines clipped to `zone`, every near miss closed, every cantilever and speck taken away:
 * what is left is held at both ends, or a free loop. `web` is the strut width, the reach of a
 * snap; `minWidth` the narrowest cut, which a speck cannot hold; `scale` the zoom (1 = 100 %),
 * which the reach of a carry grows with.
 */
export function holdRuns(lines: Polyline[], zone: Shapes, web: number, minWidth: number, scale = 1): Held {
  const index = new EdgeIndex(zone);
  const onEdge = (p: Pt): boolean => index.distance(p, 10 * ON_EDGE) < ON_EDGE;
  const runs: Pt[][] = [];
  for (const r of clipPolylines(lines, index)) {
    const pts: Pt[] = [];
    for (const p of r) if (!pts.length || dist(p, pts[pts.length - 1]!) > TOL) pts.push(p);
    if (pts.length < 2) continue;
    // A loop closes exactly, so its two ends are one node.
    if (isClosed(pts)) pts[pts.length - 1] = pts[0]!;
    runs.push(pts);
  }
  const snapped = snapEnds(runs, index, onEdge, web, CARRY * web * Math.max(1, scale));
  return pruneDeadEnds(runs, onEdge, web, minWidth, snapped, zone);
}

/** Where a ray from `p` along the unit `u` first meets segment c→d, within `reach` — or null. */
function rayHit(p: Pt, u: Pt, c: Pt, d: Pt, reach: number): number | null {
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = u[0] * sy - u[1] * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - p[0];
  const qy = c[1] - p[1];
  const t = (qx * sy - qy * sx) / den;
  const s = (qx * u[1] - qy * u[0]) / den;
  return t > 1e-6 && t <= reach && s >= -1e-9 && s <= 1 + 1e-9 ? t : null;
}

/**
 * Every free end carried onto what it nearly meets: straight on along its own line to the first
 * line or edge within `far`, or else to the nearest point of one within a web. Ends are
 * taken one at a time and each carry joins the grid at once, so two ends facing each other meet
 * once, not twice. The runs are extended in place.
 */
function snapEnds(runs: Pt[][], index: EdgeIndex, onEdge: (p: Pt) => boolean, web: number, far: number): number {
  const grid = new SegGrid(Math.max(0.5, web));
  runs.forEach((r, ri) => {
    for (let i = 0; i < r.length - 1; i++) grid.add(ri, i, r[i]!, r[i + 1]!);
  });
  const cum = runs.map(cumulative);
  const near = web + 1e-9;
  const extend: (Pt | null)[][] = runs.map(() => [null, null]);
  let count = 0;
  runs.forEach((r, ri) => {
    if (isClosed(r)) return;
    const c = cum[ri]!;
    const L = c[c.length - 1]!;
    for (const end of [0, 1] as const) {
      const p = end ? r[r.length - 1]! : r[0]!;
      if (onEdge(p)) continue;
      // A run's own segments near this end are not something to land on: only those at least
      // two webs of arc away, where a curl comes back round to meet itself.
      const own = (seg: number): boolean => (seg < 0 ? true : end ? L - c[seg + 1]! < 2 * web : c[seg]! < 2 * web);
      let touching = false;
      grid.near(p[0] - TOL, p[1] - TOL, p[0] + TOL, p[1] + TOL, (id) => {
        if (!(grid.run[id] === ri && own(grid.seg[id]!)) && pointSegmentDistance(p, grid.a[id]!, grid.b[id]!) < TOL) touching = true;
      });
      if (touching) continue;
      // Straight on: the way the run arrives at this end, off the last stretch 0.05 mm long.
      let from = p;
      for (let k = 1; k < r.length && dist(p, from) < 0.05; k++) from = end ? r[r.length - 1 - k]! : r[k]!;
      const len = dist(p, from);
      let to: Pt | null = null;
      if (len > 1e-9) {
        const u: Pt = [(p[0] - from[0]) / len, (p[1] - from[1]) / len];
        const tip: Pt = [p[0] + u[0] * far, p[1] + u[1] * far];
        let bestT = Infinity;
        const [x0, x1] = p[0] < tip[0] ? [p[0], tip[0]] : [tip[0], p[0]];
        const [y0, y1] = p[1] < tip[1] ? [p[1], tip[1]] : [tip[1], p[1]];
        grid.near(x0, y0, x1, y1, (id) => {
          if (grid.run[id] === ri && own(grid.seg[id]!)) return;
          const t = rayHit(p, u, grid.a[id]!, grid.b[id]!, far);
          if (t !== null && t < bestT) bestT = t;
        });
        for (const e of index.near(x0, y0, x1, y1)) {
          const t = rayHit(p, u, e.c, e.d, far);
          if (t !== null && t < bestT) bestT = t;
        }
        if (bestT < Infinity) to = [p[0] + u[0] * bestT, p[1] + u[1] * bestT];
      }
      if (!to) {
        let best = near;
        grid.near(p[0] - near, p[1] - near, p[0] + near, p[1] + near, (id) => {
          if (grid.run[id] === ri && own(grid.seg[id]!)) return;
          const q = closestOn(p, grid.a[id]!, grid.b[id]!);
          const d = dist(p, q);
          if (d < best) { best = d; to = q; }
        });
        for (const e of index.near(p[0] - near, p[1] - near, p[0] + near, p[1] + near)) {
          const q = closestOn(p, e.c, e.d);
          const d = dist(p, q);
          if (d < best) { best = d; to = q; }
        }
      }
      if (!to) continue;
      extend[ri]![end] = to;
      grid.add(ri, end ? -2 : -1, p, to);
      count++;
    }
  });
  runs.forEach((r, ri) => {
    const [head, tail] = extend[ri]!;
    if (head) r.unshift(head);
    if (tail) r.push(tail);
  });
  return count;
}

/** Where a run meets something, `s` mm along it. */
interface Station {
  s: number;
  node: number;
}

/** A piece of one run between two consecutive stations. */
interface Edge {
  run: number;
  s0: number;
  s1: number;
  a: number;
  b: number;
  live: boolean;
}

/** The first index whose arc length is above `x`. */
function firstAbove(c: number[], x: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid]! > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The runs as a graph — a node wherever two of them cross, one touches another, or one ends —
 * and every piece that leads to a free end taken away, until each node left has two pieces or
 * lies on the zone's edge.
 */
function pruneDeadEnds(runs: Pt[][], onEdge: (p: Pt) => boolean, web: number, minWidth: number, snapped: number, zone: Shapes): Held {
  const grid = new SegGrid(Math.max(0.5, web));
  runs.forEach((r, ri) => {
    for (let i = 0; i < r.length - 1; i++) grid.add(ri, i, r[i]!, r[i + 1]!);
  });
  const cum = runs.map(cumulative);
  const loops = runs.map(isClosed);
  const nodes = new Nodes();
  const stations: Station[][] = runs.map(() => []);
  const anchored = new Set<number>();
  runs.forEach((r, ri) => {
    const n0 = nodes.at(r[0]!);
    stations[ri]!.push({ s: 0, node: n0 });
    if (loops[ri]) return;
    const c = cum[ri]!;
    const n1 = nodes.at(r[r.length - 1]!);
    stations[ri]!.push({ s: c[c.length - 1]!, node: n1 });
    if (onEdge(r[0]!)) anchored.add(n0);
    if (onEdge(r[r.length - 1]!)) anchored.add(n1);
  });
  const adjacent = (ri: number, i: number, j: number): boolean => {
    const d = Math.abs(i - j);
    return d <= 1 || (loops[ri]! && d === runs[ri]!.length - 2);
  };

  // Crossings: every pair of segments sharing a grid cell, each crossing counted in the one cell
  // it lies in. A crossing AT a vertex is the vertex pass's (below).
  for (const [cell, bucket] of grid.buckets()) {
    for (let i = 0; i < bucket.length; i++) {
      const e = bucket[i]!;
      const a = grid.a[e]!;
      const b = grid.b[e]!;
      const re = grid.run[e]!;
      for (let j = i + 1; j < bucket.length; j++) {
        const f = bucket[j]!;
        const rf = grid.run[f]!;
        if (re === rf && adjacent(re, grid.seg[e]!, grid.seg[f]!)) continue;
        const c = grid.a[f]!;
        const d = grid.b[f]!;
        if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0])) continue;
        if (Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
        const rx = b[0] - a[0];
        const ry = b[1] - a[1];
        const sx = d[0] - c[0];
        const sy = d[1] - c[1];
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-12) continue;
        const qx = c[0] - a[0];
        const qy = c[1] - a[1];
        const t = (qx * sy - qy * sx) / den;
        const u = (qx * ry - qy * rx) / den;
        if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
        const p: Pt = [a[0] + rx * t, a[1] + ry * t];
        if (grid.cellOf(p) !== cell) continue;
        const node = nodes.at(p);
        const ce = cum[re]!;
        const cf = cum[rf]!;
        const se = grid.seg[e]!;
        const sf = grid.seg[f]!;
        stations[re]!.push({ s: ce[se]! + t * (ce[se + 1]! - ce[se]!), node });
        stations[rf]!.push({ s: cf[sf]! + u * (cf[sf + 1]! - cf[sf]!), node });
      }
    }
  }

  // Touches: a vertex on another segment — an end landing on a line (a T), two ends meeting, a
  // zigzag's corner on a rail, the ends of two runs laid over each other.
  runs.forEach((r, ri) => {
    const last = loops[ri] ? r.length - 1 : r.length;
    for (let k = 0; k < last; k++) {
      const v = r[k]!;
      grid.near(v[0] - TOL, v[1] - TOL, v[0] + TOL, v[1] + TOL, (id) => {
        const rj = grid.run[id]!;
        const sj = grid.seg[id]!;
        if (rj === ri && (sj === k || sj === k - 1 || (loops[ri] && k === 0 && sj === r.length - 2))) return;
        const q = closestOn(v, grid.a[id]!, grid.b[id]!);
        if (dist(v, q) >= TOL) return;
        const node = nodes.at(v);
        stations[rj]!.push({ s: cum[rj]![sj]! + dist(grid.a[id]!, q), node });
        stations[ri]!.push({ s: cum[ri]![k]!, node });
      });
    }
  });
  return prune(runs, cum, loops, stations, nodes, anchored, snapped, onEdge, web, minWidth, zone);
}

/** The pieces between stations, the bridges and specks taken away, and what is left stitched
 *  back into runs. */
function prune(
  runs: Pt[][], cum: number[][], loops: boolean[], stations: Station[][], nodes: Nodes,
  anchored: Set<number>, snapped: number, onEdge: (p: Pt) => boolean, web: number, minWidth: number, zone: Shapes,
): Held {
  const edges: Edge[] = [];
  const perRun: Edge[][] = runs.map(() => []);
  runs.forEach((_, ri) => {
    const c = cum[ri]!;
    const L = c[c.length - 1]!;
    const sorted = stations[ri]!.sort((p, q) => p.s - q.s);
    const st: Station[] = [];
    for (const s of sorted) {
      const prev = st[st.length - 1];
      if (prev && prev.node === s.node && s.s - prev.s < 1e-3) continue;
      st.push(s);
    }
    const add = (s0: number, s1: number, a: number, b: number) => {
      if (a === b && s1 - s0 < 1e-3) return;
      const e: Edge = { run: ri, s0, s1, a, b, live: true };
      edges.push(e);
      perRun[ri]!.push(e);
    };
    for (let i = 0; i + 1 < st.length; i++) add(st[i]!.s, st[i + 1]!.s, st[i]!.node, st[i + 1]!.node);
    // A loop's last piece runs on through its closing point to the first station.
    if (loops[ri]) add(st[st.length - 1]!.s, st[0]!.s + L, st[st.length - 1]!.node, st[0]!.node);
  });

  // The points of one piece, from its first node to its last.
  const piece = (ri: number, e: Edge): Pt[] => {
    const r = runs[ri]!;
    const c = cum[ri]!;
    const L = c[c.length - 1]!;
    const pts: Pt[] = [nodes.point(e.a)];
    const take = (from: number, to: number) => {
      for (let k = firstAbove(c, from + 1e-9); k < r.length && c[k]! < to - 1e-9; k++) pts.push(r[k]!);
    };
    if (e.s1 <= L + 1e-9) take(e.s0, e.s1);
    else {
      take(e.s0, L);
      if (e.s0 < L - 1e-9 && e.s1 - L > 1e-9) pts.push(r[0]!);
      take(0, e.s1 - L);
    }
    pts.push(nodes.point(e.b));
    const out: Pt[] = [];
    for (const p of pts) if (!out.length || dist(p, out[out.length - 1]!) > TOL) out.push(p);
    return out;
  };

  let pruned = 0;
  let prunedLength = 0;
  const prunedAt: Pt[] = [];
  const totalLength = edges.reduce((s, e) => s + (e.s1 - e.s0), 0);
  const drop = (e: Edge) => {
    if (!e.live) return;
    e.live = false;
    pruned++;
    prunedLength += e.s1 - e.s0;
    const pts = piece(e.run, e);
    const a = pts[(pts.length - 1) >> 1]!;
    const b = pts[pts.length >> 1]!;
    prunedAt.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  };

  // Sticks first: a piece that leaves a node and comes back to within a web of it, straying more
  // than a web, too narrow inside to hold a cut — a thin bar's outline, a hairpin. Built as a
  // strut it is a solid finger held at one end, whatever the graph thinks of its "loop".
  for (const e of edges) {
    const A = nodes.point(e.a);
    const B = nodes.point(e.b);
    if (dist(A, B) >= web) continue;
    const pts = piece(e.run, e);
    let stray = 0;
    for (const p of pts) stray = Math.max(stray, pointSegmentDistance(p, A, B));
    if (stray > web && hullWidth(pts) - web < minWidth) drop(e);
  }

  // Then the bridges, by Tarjan's low-link over what is left — iteratively, as a long chain of
  // pieces would overflow the call stack. Everything on the zone's edge is one node, F: the
  // frame holds whatever reaches it. A piece reached by `via` is never its own way back; a
  // parallel piece is. One pass finds them all, and taking them away makes no new ones.
  const F = nodes.x.length;
  const N = F + 1;
  const at = (n: number): number => (anchored.has(n) ? F : n);
  const ends: [number, number][] = edges.map((e) => [at(e.a), at(e.b)]);
  const adj: number[][] = Array.from({ length: N }, () => []);
  ends.forEach(([u, v], i) => {
    if (!edges[i]!.live) return;
    adj[u]!.push(i);
    if (v !== u) adj[v]!.push(i);
  });
  const disc = new Array<number>(N).fill(-1);
  const low = new Array<number>(N).fill(0);
  let time = 0;
  for (let s = 0; s < N; s++) {
    if (disc[s] !== -1 || !adj[s]!.length) continue;
    disc[s] = low[s] = time++;
    const stack: [number, number, number][] = [[s, -1, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const v = top[0];
      if (top[2] < adj[v]!.length) {
        const i = adj[v]![top[2]++]!;
        if (i === top[1]) continue;
        const [a, b] = ends[i]!;
        const w = a === v ? b : a;
        if (disc[w] === -1) {
          disc[w] = low[w] = time++;
          stack.push([w, i, 0]);
        } else low[v] = Math.min(low[v]!, disc[w]!);
      } else {
        stack.pop();
        const up = stack[stack.length - 1];
        if (!up) continue;
        low[up[0]] = Math.min(low[up[0]]!, low[v]!);
        if (low[v]! > disc[up[0]]!) drop(edges[top[1]]!);
      }
    }
  }

  // Specks: each free loop — a group of pieces with no way to the frame — whose hull is too
  // narrow for any face inside it to hold a cut once the struts have taken a web.
  const root = Array.from({ length: N }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (root[r] !== r) r = root[r]!;
    while (root[x] !== r) { const next = root[x]!; root[x] = r; x = next; }
    return r;
  };
  edges.forEach((e, i) => {
    if (!e.live) return;
    const [u, v] = ends[i]!;
    const ru = find(u);
    const rv = find(v);
    if (ru !== rv) root[ru] = rv;
  });
  const frame = find(F);
  const free = new Map<number, Edge[]>();
  edges.forEach((e, i) => {
    if (!e.live) return;
    const g = find(ends[i]![0]);
    if (g === frame) return;
    const list = free.get(g);
    if (list) list.push(e);
    else free.set(g, [e]);
  });
  for (const group of free.values()) {
    if (hullWidth(group.flatMap((e) => piece(e.run, e))) - web < minWidth) group.forEach(drop);
  }

  const out: HeldRun[] = [];
  runs.forEach((r, ri) => {
    const es = perRun[ri]!;
    if (!es.length) return;
    if (loops[ri] && es.every((e) => e.live)) {
      out.push({ points: r, loop: true, held: [false, false] });
      return;
    }
    let cur: Pt[] | null = null;
    const flush = () => {
      if (cur && cur.length >= 2) out.push({ points: cur, loop: false, held: [onEdge(cur[0]!), onEdge(cur[cur.length - 1]!)] });
      cur = null;
    };
    // A loop is walked from just after a dead piece, so a live stretch across its closing point
    // comes out as one run.
    const start = loops[ri] ? (es.findIndex((e) => !e.live) + 1) % es.length : 0;
    for (let k = 0; k < es.length; k++) {
      const e = es[(start + k) % es.length]!;
      if (!e.live) {
        flush();
        continue;
      }
      const pts = piece(ri, e);
      if (pts.length < 2) continue;
      if (cur) (cur as Pt[]).push(...pts.slice(1));
      else cur = pts;
    }
    flush();
  });
  const cells = cellsOf(edges.filter((e) => e.live), (e) => piece(e.run, e), nodes, anchored, zone);
  return { runs: out, cells, snapped, pruned, prunedLength, totalLength, prunedAt };
}

/** The least width of the points' convex hull — the narrowest slot the shape would pass. A
 *  speck test, so a big shape's points are thinned to a few hundred first. */
function hullWidth(all: Pt[]): number {
  const step = Math.max(1, Math.floor(all.length / 400));
  const pts = all.filter((_, i) => i % step === 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return 0;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]): Pt[] => {
    const h: Pt[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    return h.slice(0, -1);
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const len = dist(a, b);
    if (len < 1e-12) continue;
    let far = 0;
    for (const q of hull) far = Math.max(far, Math.abs(cross(a, b, q)) / len);
    best = Math.min(best, far);
  }
  return best;
}

/**
 * The cells of the held drawing at zero width: the faces of the planar graph its pieces make
 * with the zone's edge, split wherever a piece lands on it. Each piece is a pair of half-edges;
 * at every node they are sorted by the direction they leave in, and a face is walked by taking,
 * at each node, the next half-edge clockwise from the one it came in by — so the cell is always
 * on the left and comes out counter-clockwise. The inside of a reserve or a solid (a hole of the
 * zone no line enters) is not a cell; neither is the outside of anything.
 */
function cellsOf(live: Edge[], piece: (e: Edge) => Pt[], nodes: Nodes, anchored: Set<number>, zone: Shapes): Cell[] {
  interface Half { to: number; pts: Pt[]; frame: boolean; hole: boolean; angle: number; twin: number; len: number }
  const halves: Half[] = [];
  const outOf = new Map<number, number[]>();
  const leaving = (pts: Pt[]): number => {
    const p = pts[0]!;
    for (let k = 1; k < pts.length; k++) {
      const q = pts[k]!;
      if (dist(p, q) > 1e-7) return Math.atan2(q[1] - p[1], q[0] - p[0]);
    }
    return 0;
  };
  const add = (a: number, b: number, pts: Pt[], frame: boolean, hole: boolean) => {
    if (pts.length < 2) return;
    const i = halves.length;
    const back = [...pts].reverse();
    let len = 0;
    for (let k = 1; k < pts.length; k++) len += dist(pts[k - 1]!, pts[k]!);
    halves.push({ to: b, pts, frame, hole, angle: leaving(pts), twin: i + 1, len }, { to: a, pts: back, frame, hole, angle: leaving(back), twin: i, len });
    for (const [n, h] of [[a, i], [b, i + 1]] as const) {
      const list = outOf.get(n);
      if (list) list.push(h);
      else outOf.set(n, [h]);
    }
  };
  for (const e of live) add(e.a, e.b, piece(e), false, false);

  // The zone's edge, ring by ring, cut at every node a held piece lands on it by.
  const rings: { ring: Pt[]; hole: boolean }[] = [];
  for (const island of zone) {
    let outer = 0;
    island.forEach((r, i) => { if (Math.abs(signedArea(r)) > Math.abs(signedArea(island[outer]!))) outer = i; });
    island.forEach((r, i) => { if (r.length >= 3) rings.push({ ring: r, hole: i !== outer }); });
  }
  const grid = new SegGrid(2);
  rings.forEach(({ ring }, ri) => {
    for (let j = 0; j < ring.length; j++) grid.add(ri, j, ring[j]!, ring[(j + 1) % ring.length]!);
  });
  const stopsOn: { at: number; node: number }[][] = rings.map(() => []);
  for (const n of anchored) {
    if (!outOf.has(n)) continue;
    const p = nodes.point(n);
    let found: { ri: number; at: number } | null = null;
    grid.near(p[0] - 1e-5, p[1] - 1e-5, p[0] + 1e-5, p[1] + 1e-5, (id) => {
      if (found) return;
      const a = grid.a[id]!;
      const b = grid.b[id]!;
      if (pointSegmentDistance(p, a, b) > 1e-5) return;
      const l = dist(a, b);
      found = { ri: grid.run[id]!, at: grid.seg[id]! + (l > 0 ? Math.min(1, dist(a, p) / l) : 0) };
    });
    const f = found as { ri: number; at: number } | null;
    if (f) stopsOn[f.ri]!.push({ at: f.at, node: n });
  }
  rings.forEach(({ ring, hole }, ri) => {
    const m = ring.length;
    const stops = stopsOn[ri]!.sort((x, y) => x.at - y.at);
    if (!stops.length) {
      const n = nodes.at(ring[0]!);
      add(n, n, [...ring, ring[0]!], true, hole);
      return;
    }
    stops.forEach((s, k) => {
      const t = stops[(k + 1) % stops.length]!;
      if (stops.length > 1 && t.at === s.at) return;
      // The ring's own vertices strictly after this stop and before the next, going round.
      const end = stops.length === 1 || t.at <= s.at ? t.at + m : t.at;
      const pts: Pt[] = [nodes.point(s.node)];
      for (let j = Math.floor(s.at) + 1; j < end; j++) pts.push(ring[j % m]!);
      pts.push(nodes.point(t.node));
      add(s.node, t.node, pts, true, hole);
    });
  });

  const pos = new Array<number>(halves.length).fill(0);
  for (const list of outOf.values()) {
    list.sort((x, y) => halves[x]!.angle - halves[y]!.angle);
    list.forEach((h, k) => { pos[h] = k; });
  }
  const next = (h: number): number => {
    const H = halves[h]!;
    const list = outOf.get(H.to)!;
    return list[(pos[H.twin]! - 1 + list.length) % list.length]!;
  };
  // Walk every face. A counter-clockwise one is a cell; a clockwise one is the outside of a
  // piece of drawing that touches nothing round it (a floating loop, a reserve no line reaches),
  // and is a HOLE of whichever cell holds it — found by a point just off its first side, on the
  // side the cell is.
  const seen = new Array<boolean>(halves.length).fill(false);
  type Walk = { ring: Pt[]; area: number; lines: number; frame: boolean; holes: Pt[][] };
  const found: Walk[] = [];
  const outsides: { ring: Pt[]; lines: number; probe: Pt }[] = [];
  for (let s = 0; s < halves.length; s++) {
    if (seen[s]) continue;
    const ring: Pt[] = [];
    let frame = false;
    let holeOnly = true;
    let lines = 0;
    let h = s;
    let guard = 0;
    do {
      seen[h] = true;
      const H = halves[h]!;
      for (let k = 0; k < H.pts.length - 1; k++) ring.push(H.pts[k]!);
      if (H.frame) frame = true;
      else lines += H.len;
      if (!H.frame || !H.hole) holeOnly = false;
      h = next(h);
    } while (h !== s && ++guard <= halves.length);
    if (h !== s || ring.length < 3) continue;
    const area = signedArea(ring);
    if (area > 1e-9 && !holeOnly) found.push({ ring, area, lines, frame, holes: [] });
    else if (area < -1e-9) {
      const [a, b] = [ring[0]!, ring[1]!];
      const l = dist(a, b) || 1;
      outsides.push({ ring, lines, probe: [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / l) * 1e-4, (a[1] + b[1]) / 2 + ((b[0] - a[0]) / l) * 1e-4] });
    }
  }
  const boxes = found.map((w) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of w.ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  });
  // The cells' boxes in a grid, so each outside meets only the cells round it — a coaster of
  // floating rings has thousands of each.
  const size = Math.max(1, Math.sqrt(boxes.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxY - b.minY), 0) / Math.max(1, boxes.length)));
  const buckets = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    if ((b.maxX - b.minX) * (b.maxY - b.minY) > 400 * size * size) return;
    for (let x = Math.floor(b.minX / size); x <= Math.floor(b.maxX / size); x++) {
      for (let y = Math.floor(b.minY / size); y <= Math.floor(b.maxY / size); y++) {
        const k = `${x},${y}`;
        const list = buckets.get(k);
        if (list) list.push(i);
        else buckets.set(k, [i]);
      }
    }
  });
  // Cells too big for the grid (a zone-wide background) are tried by everyone.
  const big = boxes.map((b, i) => ((b.maxX - b.minX) * (b.maxY - b.minY) > 400 * size * size ? i : -1)).filter((i) => i >= 0);
  for (const o of outsides) {
    let best = -1;
    const [px, py] = o.probe;
    for (const i of [...(buckets.get(`${Math.floor(px / size)},${Math.floor(py / size)}`) ?? []), ...big]) {
      const b = boxes[i]!;
      if (px < b.minX || px > b.maxX || py < b.minY || py > b.maxY || (best >= 0 && found[i]!.area >= found[best]!.area)) continue;
      if (pointInRingXY(found[i]!.ring, px, py)) best = i;
    }
    if (best >= 0) {
      found[best]!.holes.push(o.ring);
      found[best]!.lines += o.lines;
    }
  }
  // A hairline is not a cell. A library tile often draws a line as a filled sliver a hundredth
  // of a millimetre wide, and its outline is both sides of it: a "cell" between them that no web
  // could ever open, and that would count against every cut of the pattern.
  const perimeter = (r: Pt[]) => r.reduce((s, p, i) => s + dist(p, r[(i + 1) % r.length]!), 0);
  const cells: Cell[] = [];
  for (const w of found) {
    const area = w.area - w.holes.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
    if ((2 * area) / (perimeter(w.ring) + w.holes.reduce((s, r) => s + perimeter(r), 0)) < HAIRLINE) continue;
    cells.push({ ring: w.ring, holes: w.holes, area, lines: w.lines, frame: w.frame });
  }
  return cells;
}

/** The mean width under which a space between lines is a hairline — a line drawn as a sliver —
 *  and not a cell, mm. Half a kerf. */
const HAIRLINE = 0.05;

function pointInRingXY(ring: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
