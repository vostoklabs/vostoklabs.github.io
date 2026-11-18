// A triangle mesh read from STL, welded into shared vertices, with triangle adjacency.

import { type V3, cross, dot, norm, normalize, sub } from './linalg';

export type Mesh = {
  /** xyz per vertex. */
  pos: Float64Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  tri: Uint32Array;
  /** Per half-edge (3 per triangle, edge k runs tri[3t+k] → tri[3t+(k+1)%3]): the neighbouring triangle, or -1. */
  adj: Int32Array;
  normal: Float64Array;
  area: Float64Array;
  /** Triangles around each vertex. */
  vertTris: number[][];
};

/** Raw triangle soup (9 floats per triangle) from a binary or ASCII STL. */
export function parseStl(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 84) {
    const n = view.getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) {
      const out = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const base = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(base + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(bytes);
  const nums: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(+m[1], +m[2], +m[3]);
  return new Float32Array(nums);
}

/** Welds identical positions, drops degenerate triangles, builds adjacency, orients outward. */
export function buildMesh(soup: Float32Array): Mesh {
  const index = new Map<string, number>();
  const pos: number[] = [];
  const tri: number[] = [];
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let t = 0; t < soup.length / 9; t++) {
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const x = soup[t * 9 + k * 3], y = soup[t * 9 + k * 3 + 1], z = soup[t * 9 + k * 3 + 2];
      const kk = key(x, y, z);
      let id = index.get(kk);
      if (id === undefined) { id = pos.length / 3; index.set(kk, id); pos.push(x, y, z); }
      ids.push(id);
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    tri.push(ids[0], ids[1], ids[2]);
  }
  const P = new Float64Array(pos);
  let T = new Uint32Array(tri);
  // Outward: a closed mesh with positive signed volume.
  let vol = 0;
  for (let t = 0; t < T.length / 3; t++) {
    const a = vtx(P, T[t * 3]), b = vtx(P, T[t * 3 + 1]), c = vtx(P, T[t * 3 + 2]);
    vol += dot(a, cross(b, c)) / 6;
  }
  if (vol < 0) {
    T = T.slice();
    for (let t = 0; t < T.length / 3; t++) { const s = T[t * 3 + 1]; T[t * 3 + 1] = T[t * 3 + 2]; T[t * 3 + 2] = s; }
  }
  return finish(P, T);
}

function finish(pos: Float64Array, tri: Uint32Array): Mesh {
  const nT = tri.length / 3, nV = pos.length / 3;
  const half = new Map<number, number>();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)];
    half.set(a * nV + b, t * 3 + k);
  }
  const adj = new Int32Array(nT * 3).fill(-1);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = tri[t * 3 + k], b = tri[t * 3 + ((k + 1) % 3)];
    const o = half.get(b * nV + a);
    if (o !== undefined) adj[t * 3 + k] = Math.floor(o / 3);
  }
  const normal = new Float64Array(nT * 3), area = new Float64Array(nT);
  const vertTris: number[][] = Array.from({ length: nV }, () => []);
  for (let t = 0; t < nT; t++) {
    const a = vtx(pos, tri[t * 3]), b = vtx(pos, tri[t * 3 + 1]), c = vtx(pos, tri[t * 3 + 2]);
    const n = cross(sub(b, a), sub(c, a));
    area[t] = norm(n) / 2;
    const u = normalize(n);
    normal.set(u, t * 3);
    for (let k = 0; k < 3; k++) vertTris[tri[t * 3 + k]].push(t);
  }
  return { pos, tri, adj, normal, area, vertTris };
}

/**
 * A triangle with no height is not a facet of anything. Exporters leave them where one face's
 * edge has a vertex that the next face's edge lacks, to close the gap, and three points in a line
 * have no normal worth the name: read as a face it is a flat one facing nowhere in particular,
 * bounded by a circle kilometres wide. Each takes the normal of the triangle across its longest
 * side, the one it lies flat against, so every later step sees it as part of that face. Returns
 * how many there were.
 */
export function flattenSlivers(m: Mesh, eps: number): number {
  const nT = m.tri.length / 3;
  const waiting: number[] = [];
  const sides: number[][] = [];
  const isSliver = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const p = [0, 1, 2].map((k) => vtx(m.pos, m.tri[t * 3 + k]));
    const len = [0, 1, 2].map((k) => norm(sub(p[(k + 1) % 3], p[k])));
    const longest = Math.max(len[0], len[1], len[2]);
    if ((2 * m.area[t]) / longest > eps) continue;
    isSliver[t] = 1;
    waiting.push(t);
    sides[t] = [0, 1, 2].sort((a, b) => len[b] - len[a]);
  }
  // A sliver lying against another sliver waits until that one has a normal to give.
  let left = waiting.length;
  for (let round = 0; round < 8 && left; round++) {
    for (const t of waiting) {
      if (!isSliver[t]) continue;
      const from = sides[t].map((k) => m.adj[t * 3 + k]).find((w) => w >= 0 && !isSliver[w]);
      if (from === undefined) continue;
      for (let d = 0; d < 3; d++) m.normal[t * 3 + d] = m.normal[from * 3 + d];
      isSliver[t] = 0;
      left--;
    }
  }
  return waiting.length;
}

export const vtx = (pos: Float64Array, i: number): V3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
export const triNormal = (m: Mesh, t: number): V3 => [m.normal[t * 3], m.normal[t * 3 + 1], m.normal[t * 3 + 2]];
export const triVerts = (m: Mesh, t: number): [number, number, number] => [m.tri[t * 3], m.tri[t * 3 + 1], m.tri[t * 3 + 2]];
export function triCentroid(m: Mesh, t: number): V3 {
  const [a, b, c] = triVerts(m, t);
  const A = vtx(m.pos, a), B = vtx(m.pos, b), C = vtx(m.pos, c);
  return [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
}

/** Count of edges with no partner (0 for a closed mesh) and edges shared by more than two triangles. */
export function meshHealth(m: Mesh): { open: number; triangles: number; vertices: number } {
  let open = 0;
  for (let i = 0; i < m.adj.length; i++) if (m.adj[i] < 0) open++;
  return { open, triangles: m.tri.length / 3, vertices: m.pos.length / 3 };
}

/** Triangles split into edge-connected pieces. */
export function connected(m: Mesh, tris: number[]): number[][] {
  const inSet = new Set(tris);
  const seen = new Set<number>();
  const parts: number[][] = [];
  for (const t of tris) {
    if (seen.has(t)) continue;
    const part: number[] = [];
    const stack = [t];
    seen.add(t);
    while (stack.length) {
      const u = stack.pop()!;
      part.push(u);
      for (let k = 0; k < 3; k++) {
        const w = m.adj[u * 3 + k];
        if (w >= 0 && inSet.has(w) && !seen.has(w)) { seen.add(w); stack.push(w); }
      }
    }
    parts.push(part);
  }
  return parts;
}
