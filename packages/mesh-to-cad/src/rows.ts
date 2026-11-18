// Rows of a mesh. A CAD exporter meshes each face on its own grid: long chains of mesh edges run
// straight on from vertex to vertex along the face (rails), with one row of triangles between each
// pair of neighbouring rails. Laid out along its rails, a patch of rows keeps the shape the
// designer drew, where a conformal map of long thin triangles does not.

import { type V3, cross, dist, dot, norm, normalize, sub } from './linalg';
import { type Mesh, triNormal, triVerts, vtx } from './mesh';

/** A mesh edge as one number, the same either way round: the lower vertex times the vertex count, plus the higher (far below 2^53). */
export const edgeKey = (m: Mesh, a: number, b: number) => (a < b ? a * (m.pos.length / 3) + b : b * (m.pos.length / 3) + a);

/** Most a grid line may turn at a vertex and still be one line, in radians. */
const GRID_TURN = (15 * Math.PI) / 180;
/** Grid lines of fewer vertices than this say nothing about where a face ends. */
export const GRID_MIN = 5;

/**
 * The patch's grid lines: chains of its mesh edges that go straight on at every vertex, where each
 * vertex's straightest way on is also the next one's straightest way back (two lines cross there
 * otherwise, and each goes its own way). Only chains of GRID_MIN vertices or more.
 */
export function gridLines(m: Mesh, tris: number[]): number[][] {
  const key = (a: number, b: number) => edgeKey(m, a, b);
  const nbr = new Map<number, Set<number>>();
  for (const t of tris) {
    const vs = triVerts(m, t);
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3];
      if (!nbr.has(a)) nbr.set(a, new Set());
      if (!nbr.has(b)) nbr.set(b, new Set());
      nbr.get(a)!.add(b);
      nbr.get(b)!.add(a);
    }
  }
  const P = (v: number) => vtx(m.pos, v);
  const dir = (a: number, b: number) => normalize(sub(P(b), P(a)));
  const cosTurn = Math.cos(GRID_TURN);
  /** Coming from u to v, the neighbour of v straightest on, if any is straight enough. */
  const straight = (u: number, v: number) => {
    const d = dir(u, v);
    let best = -1, c = -2;
    for (const y of nbr.get(v)!) {
      if (y === u) continue;
      const cc = dot(d, dir(v, y));
      if (cc > c) { c = cc; best = y; }
    }
    return c >= cosTurn ? best : -1;
  };
  // Two lines cross where each is the other's straight way on, so a line continues only if the
  // next vertex would also choose to come back this way.
  const next = (u: number, v: number) => {
    const w = straight(u, v);
    return w >= 0 && straight(w, v) === u ? w : -1;
  };
  const walked = new Set<number>();
  const chains: number[][] = [];
  for (const [a, around] of nbr) for (const b of around) {
    if (walked.has(key(a, b))) continue;
    walked.add(key(a, b));
    const line = [a, b];
    const on = new Set(line);
    for (let u = a, v = b; ;) { const w = next(u, v); if (w < 0 || on.has(w)) break; walked.add(key(v, w)); line.push(w); on.add(w); u = v; v = w; }
    for (let u = b, v = a; ;) { const w = next(u, v); if (w < 0 || on.has(w)) break; walked.add(key(v, w)); line.unshift(w); on.add(w); u = v; v = w; }
    if (line.length >= GRID_MIN) chains.push(line);
  }
  return chains;
}

/** The share of a patch's triangles that must have a side on a rail for it to be laid out by its rails. */
const ROWED_SHARE = 0.75;
/**
 * How long and thin a patch's typical triangle must be (its longest side over its height) for the
 * patch to be laid out by its rails. A conformal map lays out triangles of any decent shape well; it
 * is long thin ones, which it squeezes and turns, that need the rails.
 */
const ELONGATED = 12;
/** Two neighbouring triangles' rails this far from parallel (as a cosine) disagree on which way the rows run. */
const RAILS_AGREE = Math.cos((30 * Math.PI) / 180);
/** The share of neighbouring pairs that may disagree before the patch is taken to run two ways at once (a crossing). */
const DISAGREE_SHARE = 0.03;

/** Which way the rows run over a patch (see `railField`). */
export type RailField = {
  /** Per triangle, a unit direction in its plane along the rows, all turned the same way. */
  way: V3[];
  /** Per triangle, which of its sides (0 to 2) lies on its rail, or -1. */
  side: Int8Array;
  /** The rails' mean number of vertices: how finely the patch is drawn along its rows. */
  along: number;
  /** The most vertices on one rail. */
  longest: number;
};

/**
 * Which way the rows run over each triangle of a patch. A triangle with a side on a grid line runs
 * along the longest such line (in a grid of long thin rows the rails are the long lines; the short
 * ones run across); one with none takes its neighbours' way. Null when too few triangles lie along
 * a rail, or they are not long and thin, or neighbours disagree on the way too often, as where two
 * rows of rails cross.
 */
export function railField(m: Mesh, tris: number[], lines = gridLines(m, tris)): RailField | null {
  const P = (v: number) => vtx(m.pos, v);
  const lineOf = new Map<number, number>();
  const length = lines.map((c) => c.reduce((a, v, i) => (i ? a + dist(P(c[i - 1]), P(v)) : 0), 0));
  lines.forEach((c, i) => { for (let j = 0; j + 1 < c.length; j++) lineOf.set(edgeKey(m, c[j], c[j + 1]), i); });
  const index = new Map(tris.map((t, f) => [t, f]));
  const side = new Int8Array(tris.length).fill(-1);
  const used = new Set<number>();
  const way: (V3 | null)[] = tris.map((t, f) => {
    const vs = triVerts(m, t);
    let best = -1, longest = 0, line = -1;
    for (let k = 0; k < 3; k++) {
      const i = lineOf.get(edgeKey(m, vs[k], vs[(k + 1) % 3]));
      if (i !== undefined && length[i] > longest) { longest = length[i]; best = k; line = i; }
    }
    if (best < 0) return null;
    side[f] = best;
    used.add(line);
    return normalize(sub(P(vs[(best + 1) % 3]), P(vs[best])));
  });
  if (way.filter(Boolean).length < ROWED_SHARE * tris.length) return null;
  const thin = tris.map((t) => {
    const [a, b, c] = triVerts(m, t).map(P);
    const L = Math.max(dist(a, b), dist(b, c), dist(c, a));
    return (L * L) / (2 * m.area[t] || 1e-300);
  }).sort((x, y) => x - y);
  if (thin[thin.length >> 1] < ELONGATED) return null;
  // Turned one way from triangle to triangle; a triangle off every rail takes the way of the one
  // it was reached from, laid into its own plane.
  const out: (V3 | null)[] = tris.map(() => null);
  const start = way.findIndex(Boolean);
  out[start] = way[start];
  const queue = [start];
  let pairs = 0, disagree = 0;
  for (let i = 0; i < queue.length; i++) {
    const f = queue[i], t = tris[f], d = out[f]!;
    for (let k = 0; k < 3; k++) {
      const g = index.get(m.adj[t * 3 + k]);
      if (g === undefined) continue;
      const own = way[g];
      if (out[g]) {
        if (own && way[f]) { pairs++; if (Math.abs(dot(out[g]!, d)) < RAILS_AGREE) disagree++; }
        continue;
      }
      if (own) {
        out[g] = dot(own, d) >= 0 ? own : [-own[0], -own[1], -own[2]];
        if (way[f]) { pairs++; if (Math.abs(dot(own, d)) < RAILS_AGREE) disagree++; }
      } else {
        const n = triNormal(m, tris[g]);
        const flat = sub(d, [n[0] * dot(d, n), n[1] * dot(d, n), n[2] * dot(d, n)]);
        out[g] = norm(flat) > 1e-9 ? normalize(flat) : d;
      }
      queue.push(g);
    }
  }
  if (queue.length !== tris.length || disagree > DISAGREE_SHARE * Math.max(1, pairs)) return null;
  let count = 0, longest = 0;
  for (const i of used) { count += lines[i].length; longest = Math.max(longest, lines[i].length); }
  return { way: out as V3[], side, along: count / used.size, longest };
}

/** A side across the rows this many times longer than the triangle's side on its rail is one of the straight lines a surface between two curves is drawn with. */
const RULING = 4;
/** How much more a side along a rail counts than one across the rows: the rails hold their lengths, and the sides across only line them up. */
const RAIL_WEIGHT = 100;

/**
 * A patch of rows laid flat along its rails: u along the rows, v across them, each triangle's sides
 * measured in its own frame (its rail's way, and square to it in its plane) and the whole fitted
 * to those by least squares. A rail keeps its length, and a long side from one rail to the next,
 * the straight line between two curves, joins points of the same place along both: measured along
 * a twisted strip such a side gains a length it does not have. Returned in the same form as the
 * conformal map's, in [0, 1]² with a small margin, with the root of the ratio of how many points
 * hold it along the rows and across them, which is how its net is shaped: a single row between two
 * long curves needs many control points along and only the fewest across; and the most control
 * points it can take each way. Null if anything folds.
 */
export function rowFlat(
  m: Mesh, tris: number[], verts: number[], local: Map<number, number>, field: RailField,
): { uv: [number, number][]; aspect: number; most: [number, number] } | null {
  const n = verts.length, F = tris.length;
  const P = (i: number) => vtx(m.pos, verts[i]);
  // One equation per side of each triangle: the change of u (or v) along it is that side measured
  // along (or across) the triangle's rail.
  const from = new Int32Array(F * 3), to = new Int32Array(F * 3);
  const along = new Float64Array(F * 3), across = new Float64Array(F * 3), weight = new Float64Array(F * 3).fill(1);
  tris.forEach((t, f) => {
    const vs = triVerts(m, t).map((v) => local.get(v)!);
    const d = field.way[f], s = cross(triNormal(m, t), d);
    const k0 = field.side[f];
    const railLength = k0 < 0 ? Infinity : dist(P(vs[k0]), P(vs[(k0 + 1) % 3]));
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3], e = sub(P(b), P(a));
      from[f * 3 + k] = a;
      to[f * 3 + k] = b;
      along[f * 3 + k] = k !== k0 && norm(e) > RULING * railLength ? 0 : dot(e, d);
      across[f * 3 + k] = dot(e, s);
      if (k === k0) weight[f * 3 + k] = RAIL_WEIGHT;
    }
  });
  const u = solveDifferences(n, from, to, along, weight), v = solveDifferences(n, from, to, across, weight);
  if (!u || !v) return null;
  let plus = 0, minus = 0;
  for (let f = 0; f < F; f++) {
    const i = from[f * 3], j = from[f * 3 + 1], k = from[f * 3 + 2];
    const A = (u[j] - u[i]) * (v[k] - v[i]) - (v[j] - v[i]) * (u[k] - u[i]);
    if (A >= 0) plus += A; else minus -= A;
  }
  if (Math.min(plus, minus) > 0.02 * (plus + minus)) return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) { u0 = Math.min(u0, u[i]); u1 = Math.max(u1, u[i]); v0 = Math.min(v0, v[i]); v1 = Math.max(v1, v[i]); }
  const W = Math.max(1e-9, u1 - u0), H = Math.max(1e-9, v1 - v0);
  const margin = 0.03, span = 1 - 2 * margin;
  const uv = verts.map((_, i) => [margin + (span * (u[i] - u0)) / W, margin + (span * (v[i] - v0)) / H] as [number, number]);
  const rails = Math.max(2, n / field.along);
  // No more control points along a row than its longest rail has vertices, nor across than it has
  // rails: with nothing to hold it between them, a finer net only waves.
  return { uv, aspect: Math.sqrt(field.along / rails), most: [field.longest + 2, Math.ceil(rails) + 2] };
}

/**
 * Values at n points whose differences x[to] - x[from] come closest to `want`, by weighted least squares,
 * the first point held at 0. Conjugate gradients on the normal equations, which are those of a
 * graph Laplacian.
 */
function solveDifferences(n: number, from: Int32Array, to: Int32Array, want: Float64Array, weight: Float64Array): Float64Array | null {
  const E = from.length;
  // The first point is held, so it plays no part: its row is the identity and its value stays 0.
  const mul = (x: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let e = 0; e < E; e++) { const r = weight[e] * (x[to[e]] - x[from[e]]); out[to[e]] += r; out[from[e]] -= r; }
    out[0] = x[0];
  };
  const b = new Float64Array(n), diag = new Float64Array(n);
  for (let e = 0; e < E; e++) { const w = weight[e]; b[to[e]] += w * want[e]; b[from[e]] -= w * want[e]; diag[to[e]] += w; diag[from[e]] += w; }
  b[0] = 0;
  diag[0] = 1;
  const x = new Float64Array(n), r = b.slice(), z = new Float64Array(n), d = new Float64Array(n), q = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = r[i] / diag[i];
  d.set(z);
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  const rz0 = rz;
  for (let it = 0; it < 4 * n + 100 && rz > 1e-24 * rz0 && rz > 0; it++) {
    mul(d, q);
    let dq = 0;
    for (let i = 0; i < n; i++) dq += d[i] * q[i];
    if (!(dq > 0)) break;
    const alpha = rz / dq;
    for (let i = 0; i < n; i++) { x[i] += alpha * d[i]; r[i] -= alpha * q[i]; }
    for (let i = 0; i < n; i++) z[i] = r[i] / diag[i];
    let rz2 = 0;
    for (let i = 0; i < n; i++) rz2 += r[i] * z[i];
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) d[i] = z[i] + beta * d[i];
  }
  return x.every(Number.isFinite) ? x : null;
}
