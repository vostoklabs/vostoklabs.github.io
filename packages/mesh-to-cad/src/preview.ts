// What the solid looks like: every face drawn from its own surface, every edge from its own curve.
//
// The STL's triangles say where a face is, not what it is: a face fitted with the wrong surface
// still has the right triangles. So each face's triangles are cut finer and every point of them is
// moved onto the face's surface, which is the surface the STEP file holds; a sheet that bulges
// between two vertices bulges here too. The edges are the STEP's curves, sampled.

import { type V3, dist } from './linalg';
import { surfaceHit } from './bspline';
import { blendPlaces, nearestOnSheet, spanOf } from './meet';
import { pipeNearest } from './chains';
import { type Mesh, triVerts, vtx } from './mesh';
import { type Surface, distance, normalAt } from './surfaces';
import { type Brep, type Curve } from './topology';

/** One face of the solid, for drawing it. */
export type PreviewFace = {
  /** The surface kind: plane, cylinder, cone, sphere, torus, revolution, extrusion or bspline. */
  kind: string;
  /** xyz per vertex, millimetres: points of the face's own surface. */
  positions: Float32Array;
  indices: Uint32Array;
  /** The edges this face is drawn with: xyz pairs, each two points one straight piece. */
  edges: Float32Array;
};

/** Steps across the part's diagonal that a curved face is drawn in. */
const DETAIL = 160;
/** The most pieces one side of a triangle is cut into. */
const MOST = 8;
/** The most triangles drawn for the whole solid: past it every curved face is drawn coarser. */
const BUDGET = 500_000;
/** The turn of a circle drawn as one straight piece, in radians. */
const ARC_STEP = (5 * Math.PI) / 180;

/**
 * The faces of the solid as triangles on their own surfaces, and how far the furthest of those
 * points is from the STL triangle it was cut from (mm): the solid's worst departure from the mesh.
 */
export function previewSolid(
  mesh: Mesh, regions: { tris: number[] }[], brep: Brep, diag: number, progress: (share: number) => void = () => {},
): { faces: PreviewFace[]; off: number; offs: number[] } {
  const P = (v: number) => vtx(mesh.pos, v);
  const side = (t: number) => {
    const [a, b, c] = triVerts(mesh, t).map(P);
    return Math.max(dist(a, b), dist(b, c), dist(c, a));
  };
  // How finely each face is cut: by the size of its triangles, flat faces not at all.
  const step = diag / DETAIL;
  const cuts = regions.map((r, i) => {
    if (brep.faces[i].surf.kind === 'plane' || !r.tris.length) return 1;
    const sides = r.tris.map(side).sort((x, y) => x - y);
    return Math.min(MOST, Math.max(1, Math.ceil(sides[Math.floor(sides.length * 0.75)] / step)));
  });
  const drawn = () => regions.reduce((n, r, i) => n + r.tris.length * cuts[i] * cuts[i], 0);
  while (drawn() > BUDGET && cuts.some((k) => k > 1)) for (let i = 0; i < cuts.length; i++) if (cuts[i] > 1) cuts[i]--;

  const lines: number[][] = regions.map(() => []);
  for (const e of brep.edges) {
    const pts = edgePoints(e.curve, [brep.vertices[e.v0], brep.vertices[e.v1]], e.v0 === e.v1);
    const into = lines[Math.min(e.faces[0], e.faces[1])];
    for (let i = 0; i + 1 < pts.length; i++) into.push(...pts[i], ...pts[i + 1]);
  }

  /** The vertex count, and where the names of points inside a triangle begin (see `sideName`). */
  const nV = mesh.pos.length / 3, inner = nV + nV * nV * STEPS;
  let off = 0;
  /** The same for each face on its own. */
  const offs = regions.map(() => 0);
  const faces = regions.map((r, i): PreviewFace => {
    progress(i / regions.length);
    const s = brep.faces[i].surf;
    const k = cuts[i];
    const positions: number[] = [];
    const indices: number[] = [];
    // A sheet is searched from each corner's own place on it: the one it was fitted with, or for
    // a vertex the face gained afterwards, the nearest point starting from a corner beside it.
    const sheet = s.kind === 'bspline' ? s : null;
    const placeOf = new Map<number, [number, number]>(sheet?.places ?? []);
    const place = (v: number, beside: number[]): [number, number] => {
      let uv = placeOf.get(v);
      if (!uv) {
        const known = beside.map((w) => placeOf.get(w)).find((x) => x !== undefined);
        const c = nearestOnSheet(sheet!, P(v), known, hit);
        uv = [c.u, c.v];
        placeOf.set(v, uv);
      }
      return uv;
    };
    const put = (p: V3, start?: [number, number]): number => {
      const q = onto(s, p, start);
      offs[i] = Math.max(offs[i], dist(p, q));
      off = Math.max(off, offs[i]);
      positions.push(q[0], q[1], q[2]);
      return positions.length / 3 - 1;
    };
    // Points shared by two triangles of the face are made once, so the face is one skin.
    const made = new Map<number, number>();
    for (const t of r.tris) {
      const [a, b, c] = triVerts(mesh, t);
      const A = P(a), B = P(b), C = P(c);
      const uv = sheet ? [place(a, [b, c]), place(b, [a, c]), place(c, [a, b])] : null;
      /** The point i steps from a towards b and j towards c. */
      const at = (i: number, j: number): number => {
        const l = k - i - j;
        // Named by the corner or the side it is on, counted from the lower vertex, or by its triangle.
        const name = l === k ? a : i === k ? b : j === k ? c
          : j === 0 ? sideName(a, b, i, k, nV) : i === 0 ? sideName(a, c, j, k, nV) : l === 0 ? sideName(b, c, j, k, nV) : inner + (t * STEPS + i) * STEPS + j;
        let id = made.get(name);
        if (id === undefined) {
          const w = [l / k, i / k, j / k];
          const p: V3 = [0, 1, 2].map((d) => w[0] * A[d] + w[1] * B[d] + w[2] * C[d]) as V3;
          const start = uv && sheet ? blendPlaces(sheet, uv, w) : undefined;
          id = put(p, start);
          made.set(name, id);
        }
        return id;
      };
      for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) {
        indices.push(at(i, j), at(i + 1, j), at(i, j + 1));
        if (i + j + 1 < k) indices.push(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }
    return { kind: s.kind, positions: new Float32Array(positions), indices: new Uint32Array(indices), edges: new Float32Array(lines[i]) };
  });
  return { faces, off, offs };
}

/** Steps along a side, as counted in a point's name: one more than the most a side is cut into. */
const STEPS = MOST + 1;

/**
 * A point on the side between two vertices, the same name from either triangle that shares it.
 * Names are numbers: a vertex is its own index, a side point comes after every vertex, and a
 * point inside a triangle after every side point (all far below 2^53).
 */
function sideName(x: number, y: number, fromX: number, k: number, nV: number): number {
  return x < y ? nV + (x * nV + y) * STEPS + fromX : nV + (y * nV + x) * STEPS + k - fromX;
}

/** Where the sheets' nearest-point searches write: every caller here reads the answer at once. */
const hit = surfaceHit();

/** The point of the surface nearest p: straight down its normal, or for a sheet a search from `start`. */
function onto(s: Surface, p: V3, start?: [number, number]): V3 {
  if (s.kind === 'plane') return p;
  if (s.kind === 'bspline' && s.pipe) { const { d, n } = pipeNearest(s.pipe, p); return [p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d]; }
  if (s.kind === 'bspline') { const D = nearestOnSheet(s, p, start, hit).d; return [D[0], D[1], D[2]]; }
  let q = p;
  for (let i = 0; i < 2; i++) {
    const d = distance(s, q), n = normalAt(s, q);
    q = [q[0] - n[0] * d, q[1] - n[1] * d, q[2] - n[2] * d];
  }
  return q.every(Number.isFinite) ? q : p;
}

/**
 * An edge's curve as the file writes it, as points close enough together to draw straight
 * between: from its first vertex to its last (`through`: its points, first and last its two
 * vertices), a circle the way round the file means, a smooth curve several times between each two
 * of its pieces' knots, so the line drawn is where the edge really runs.
 */
export function edgePoints(c: Curve, through: V3[], closed = through.length > 1 && through[0] === through[through.length - 1]): V3[] {
  const a = through[0], b = through[through.length - 1];
  if (c.kind === 'line') {
    const sp = spanOf(c, a, b, false);
    return [sp.at(sp.t0), sp.at(sp.t1)];
  }
  // Straight pieces are their own points.
  if (c.kind === 'bspline' && c.degree === 1) return c.ctrl;
  const sp = spanOf(c, a, b, closed);
  const pieces = c.kind === 'circle'
    ? Math.max(1, Math.ceil((sp.t1 - sp.t0) / ARC_STEP))
    : Math.min(2000, Math.max(16, sp.pieces * 6));
  return Array.from({ length: pieces + 1 }, (_, i) => sp.at(sp.t0 + ((sp.t1 - sp.t0) * i) / pieces));
}
