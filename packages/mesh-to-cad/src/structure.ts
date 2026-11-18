// The mesh's own structure, read before any surface is fitted to it.
//
// A CAD exporter cuts every edge of the model into points once and then meshes each face on its
// own. So the true borders are chains of mesh edges, and three things show where they run:
//
//   1. Exactly flat regions: triangles lying in one plane to the part's float precision. A flat
//      face of the model is one such region, and its outline is a border all the way round.
//   2. Folds: an edge where the surface turns far more sharply than it does on either side.
//   3. Jumps in triangle size: each face is meshed to its own curvature, so the triangles change
//      size where the face changes.
//
// From these, every edge gets a strength, and touching regions are joined weakest border first
// until what is left between them is evidence of a design edge. The joins are kept as a tree, so
// a region that later turns out to hold two faces can be taken apart in the order it was built.
//
// Read from the same mesh: how exactly a point placed on a face sits on it (the float precision
// of the coordinates), how far a point placed on a design edge may sit off the faces it borders
// (the CAD program's own edge curves are approximations), and what kind of mesh this is.

import { type V3, basis, centroid, cross, dot, eigSym3, normalize, scatter, sub } from './linalg';
import { type Mesh, vtx } from './mesh';
import { type Analytic, type Sample, distance, fitCone, fitCylinder, fitSphere, fitTorus, refine } from './surfaces';
import { smoothFlat } from './features';

export type Structure = {
  /** A CAD export with a mesh pattern per face, a generator's mesh, or a sculpt. */
  kind: 'cad' | 'generated' | 'sculpt';
  /** How far a point placed on a face sits off it (mm): the part's float precision. */
  tolPoint: number;
  /** How far a point placed on a design edge may sit off the faces it borders (mm), measured from this part. */
  tolEdge: number;
  /** The mesh region of each triangle, and the triangles of each region. */
  regionOf: Int32Array;
  regions: number[][];
  /** Per half-edge (3 per triangle): 0 to 1, how strongly the mesh says a design edge runs here. */
  strength: Float32Array;
  /** Per vertex: 1 when it lies on a border between regions, 0 when all its triangles are in one. */
  onBorder: Uint8Array;
  /** Per region: 1 when it is an exactly flat face of the model (a proven flat). */
  flatRegion: Uint8Array;
  /** Per triangle: 1 when it lies in a proven flat. */
  flatTri: Uint8Array;
  /** How the regions were built, for taking one apart again. */
  tree: MergeTree;
  /** Where tolEdge came from: see EdgeReading. */
  edgeSamples: EdgeReading;
};

/**
 * The joins that built the regions. Leaves are the starting atoms (an exactly flat set of
 * triangles, or one triangle); node `nLeaf + i` joined `kids[2i]` and `kids[2i + 1]`.
 */
/**
 * What the edge tolerance was read from. Each set is a group of triangles (a region, or a branch
 * of the tree under one) whose inner points pin an exact surface; its value is how far nine tenths
 * of its edge points sit off that surface.
 */
export type EdgeReading = {
  /** Edge points read, and the sets they came from. */
  points: number;
  sets: number;
  /** The value read (mm), the sets that support it, and the largest value no second set supports. */
  value: number;
  support: number;
  next: number;
  /** The least facet sag of the supporting sets (mm): no edge point sits further off than its face's facets do. */
  ceiling: number;
};

export type MergeTree = {
  nLeaf: number;
  kids: Int32Array;
  /** The atom (leaf) of each triangle. */
  leafOf: Int32Array;
  /** The tree node each final region is. */
  nodeOf: Int32Array;
};

/** Settings of the reading. The defaults are the reading; the measuring scripts vary them. */
export type StructureOptions = {
  /** A fold over this (degrees) that stands well above the folds beside it is a design edge. */
  sharp: number;
  /** A sharp fold must be this many times the folds either side of it (the facets of a coarsely meshed round fold alike). */
  sharpOverSides: number;
  /** A size jump of 2^sizeLog in triangle area across an edge counts as full evidence. */
  sizeLog: number;
  /** Regions join while their shared border's mean strength is under this. */
  tau: number;
  /** An exactly flat set is a face only with at least this many triangles... */
  minFlatTris: number;
  /** ...and when it is not one facet of a strip: a planar neighbour of under this area ratio across a smooth fold. */
  stripRatio: number;
  /** Two large regions are not joined when the surface bends differently across the border by this share. */
  vetoD: number;
  /** A region is large enough to judge its bend when its band holds this many triangle pairs. */
  vetoPairs: number;
  /** Rings of triangles each side of a border that show its bend. */
  rings: number;
  /** Regions under this many triangles that are not flat join a neighbour (a speck has no shape to show). */
  minSize: number;
};

/**
 * Measured on the known-answer set at three mesh densities (linear 0.01 / 0.003 / 0.05 mm): the
 * same settings give 260, 261 and 258 of 307 true faces as exactly one region. `vetoPairs` is the
 * one that moves with density (120 loses 12 faces at the fine mesh, 30 loses 5 at the calibrated).
 */
export const STRUCTURE_DEFAULTS: StructureOptions = {
  sharp: 20,
  sharpOverSides: 2.5,
  sizeLog: 4,
  tau: 0.8,
  minFlatTris: 3,
  stripRatio: 2,
  vetoD: 0.85,
  vetoPairs: 60,
  rings: 3,
  minSize: 5,
};

const DEG = 180 / Math.PI;

export function readStructure(given: Mesh, options: Partial<StructureOptions> = {}): Structure {
  const o: StructureOptions = { ...STRUCTURE_DEFAULTS, ...options };
  // The facets' own normals, from their corners: the reading may have given a triangle with no
  // height its neighbour's normal (flattenSlivers), and the structure must not depend on when it runs.
  const m: Mesh = { ...given, normal: ownNormals(given) };
  const nT = m.tri.length / 3, nV = m.pos.length / 3;
  const tolPoint = floatPrecision(m);
  const fold = foldsOf(m);
  const back = backEdges(m);
  const atom = flatAtoms(m, tolPoint);
  const { flatAtom, flatSet, atomSize } = provenFlats(m, atom, fold, o);
  const sharp = sharpEdges(m, fold, back, o);
  const hs = edgeStrength(m, atom, flatAtom, sharp, back, o);
  const grown = growRegions(m, atom, flatAtom, atomSize, hs, o);
  const regionOf = grown.regionOf;
  const nR = grown.regions.length;
  const flatRegion = new Uint8Array(nR);
  const flatTri = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) if (flatAtom[atom[t]]) { flatTri[t] = 1; flatRegion[regionOf[t]] = 1; }
  const onBorder = new Uint8Array(nV);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w >= 0 && regionOf[w] !== regionOf[t]) { onBorder[m.tri[t * 3 + k]] = 1; onBorder[m.tri[t * 3 + (k + 1) % 3]] = 1; }
  }
  const strength = new Float32Array(nT * 3);
  for (let h = 0; h < nT * 3; h++) strength[h] = hs[h];
  const { tolEdge, edge } = edgeTolerance(m, grown.regions, flatRegion, grown.tree, tolPoint);
  const kind = meshKind(m, atom, flatSet);
  return {
    kind, tolPoint, tolEdge, regionOf, regions: grown.regions, strength, onBorder, flatRegion, flatTri,
    tree: grown.tree, edgeSamples: edge,
  };
}

// ---------------------------------------------------------------------------------------------
// Precision

/**
 * How far a point the CAD program placed exactly on a face can sit off it once written to the
 * STL: each coordinate is rounded to a float32, half a step at most, so a point moves up to
 * √3/2 steps; doubled, for a surface fitted through such points carries the same rounding. The
 * step is the float32 spacing at the part's largest coordinate.
 */
function floatPrecision(m: Mesh): number {
  let big = 0;
  for (let i = 0; i < m.pos.length; i++) big = Math.max(big, Math.abs(m.pos[i]));
  if (!(big > 0)) return 0;
  const step = 2 ** (Math.floor(Math.log2(big)) - 23);
  return 2 * step;
}

// ---------------------------------------------------------------------------------------------
// Edges

/** Per half-edge: the index of the same edge in the neighbouring triangle, or -1. */
function backEdges(m: Mesh): Int32Array {
  const nT = m.tri.length / 3;
  const back = new Int32Array(nT * 3).fill(-1);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0) continue;
    const a = m.tri[t * 3 + k], b = m.tri[t * 3 + (k + 1) % 3];
    for (let j = 0; j < 3; j++) if (m.tri[w * 3 + j] === b && m.tri[w * 3 + (j + 1) % 3] === a) { back[t * 3 + k] = w * 3 + j; break; }
  }
  return back;
}

/** Per half-edge: the angle between the two triangles' normals (degrees), negative where the surface is concave. */
function foldsOf(m: Mesh): Float64Array {
  const nT = m.tri.length / 3;
  const fold = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0) continue;
    const d = m.normal[t * 3] * m.normal[w * 3] + m.normal[t * 3 + 1] * m.normal[w * 3 + 1] + m.normal[t * 3 + 2] * m.normal[w * 3 + 2];
    const ang = Math.acos(Math.max(-1, Math.min(1, d))) * DEG;
    // The corner of the neighbour that is not on this edge, above this triangle's plane: concave.
    let opp = -1;
    const a = m.tri[t * 3 + k], b = m.tri[t * 3 + (k + 1) % 3];
    for (let j = 0; j < 3; j++) { const v = m.tri[w * 3 + j]; if (v !== a && v !== b) opp = v; }
    const s = (m.pos[opp * 3] - m.pos[a * 3]) * m.normal[t * 3] + (m.pos[opp * 3 + 1] - m.pos[a * 3 + 1]) * m.normal[t * 3 + 1] + (m.pos[opp * 3 + 2] - m.pos[a * 3 + 2]) * m.normal[t * 3 + 2];
    fold[t * 3 + k] = s > 0 ? -ang : ang;
  }
  return fold;
}

const edgeLength = (m: Mesh, h: number): number => {
  const t = Math.floor(h / 3), k = h % 3;
  const a = m.tri[t * 3 + k] * 3, b = m.tri[t * 3 + (k + 1) % 3] * 3;
  return Math.hypot(m.pos[a] - m.pos[b], m.pos[a + 1] - m.pos[b + 1], m.pos[a + 2] - m.pos[b + 2]);
};

// ---------------------------------------------------------------------------------------------
// Exactly flat regions

/**
 * Sets of triangles lying in one plane to the float precision, grown from the largest triangle
 * first (its normal is the most exact). The plane is refitted on what was gathered and the set
 * gathered again on that plane: a seed's normal, from three rounded points, tilts enough to lose
 * the far side of a wide face.
 */
function flatAtoms(m: Mesh, tol: number): Int32Array {
  const nT = m.tri.length / 3;
  const atom = new Int32Array(nT).fill(-1);
  const order = Array.from({ length: nT }, (_, i) => i).sort((a, b) => m.area[b] - m.area[a]);
  const stamp = new Int32Array(nT).fill(-1);
  const stack: number[] = [];
  const gathered: number[] = [];
  const gather = (seed: number, n: V3, d0: number, mark: number) => {
    gathered.length = 0;
    stamp[seed] = mark;
    stack.push(seed);
    while (stack.length) {
      const t = stack.pop()!;
      gathered.push(t);
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        if (w < 0 || atom[w] >= 0 || stamp[w] === mark) continue;
        // Facing the same way: a triangle folded back onto the plane is not part of it.
        if (m.normal[w * 3] * n[0] + m.normal[w * 3 + 1] * n[1] + m.normal[w * 3 + 2] * n[2] <= 0) continue;
        let ok = true;
        for (let j = 0; j < 3 && ok; j++) {
          const v = m.tri[w * 3 + j] * 3;
          if (Math.abs(n[0] * m.pos[v] + n[1] * m.pos[v + 1] + n[2] * m.pos[v + 2] - d0) > tol) ok = false;
        }
        if (!ok) continue;
        stamp[w] = mark;
        stack.push(w);
      }
    }
  };
  let id = 0, mark = 0;
  for (const s of order) {
    if (atom[s] >= 0) continue;
    const n: V3 = [m.normal[s * 3], m.normal[s * 3 + 1], m.normal[s * 3 + 2]];
    const a = m.tri[s * 3] * 3;
    gather(s, n, n[0] * m.pos[a] + n[1] * m.pos[a + 1] + n[2] * m.pos[a + 2], mark++);
    if (gathered.length >= 2) {
      const vs = new Set<number>();
      for (const t of gathered) for (let k = 0; k < 3; k++) vs.add(m.tri[t * 3 + k]);
      const pts: V3[] = [];
      for (const v of vs) pts.push(vtx(m.pos, v));
      const c = centroid(pts);
      let nn = eigSym3(scatter(pts, c)).vectors[0];
      if (dot(nn, n) < 0) nn = [-nn[0], -nn[1], -nn[2]];
      gather(s, nn, dot(nn, c), mark++);
    }
    for (const t of gathered) atom[t] = id;
    id++;
  }
  return atom;
}

/**
 * Which exactly flat sets are flat faces of the model. A faceted cylinder or cone is made of flat
 * sets too: each facet is a long strip with another facet of much the same size beside it across
 * a gentle fold. A flat face has no such twin: what lies beside it across a gentle fold is the
 * first, narrower facet of a round.
 */
function provenFlats(
  m: Mesh, atom: Int32Array, fold: Float64Array, o: StructureOptions,
): { flatAtom: Uint8Array; flatSet: Uint8Array; atomSize: Int32Array } {
  const nT = m.tri.length / 3;
  let nA = 0;
  for (let t = 0; t < nT; t++) nA = Math.max(nA, atom[t] + 1);
  const atomSize = new Int32Array(nA), atomArea = new Float64Array(nA);
  for (let t = 0; t < nT; t++) { atomSize[atom[t]]++; atomArea[atom[t]] += m.area[t]; }
  const strip = new Uint8Array(nA);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0) continue;
    const a = atom[t], b = atom[w];
    if (a === b || atomSize[a] < 2 || atomSize[b] < 2 || Math.abs(fold[t * 3 + k]) > o.sharp) continue;
    const r = Math.max(atomArea[a], atomArea[b]) / Math.min(atomArea[a], atomArea[b]);
    if (r < o.stripRatio) strip[a] = 1;
  }
  // Flat sets of two triangles or more that are not strips: what the kind of mesh is read from.
  const flatSet = new Uint8Array(nA);
  const flatAtom = new Uint8Array(nA);
  for (let a = 0; a < nA; a++) {
    if (strip[a] || atomSize[a] < 2) continue;
    flatSet[a] = 1;
    if (atomSize[a] >= o.minFlatTris) flatAtom[a] = 1;
  }
  // A flat of fewer triangles is a face when every turn across its outline is sharp or meets
  // triangles cut to another size (the same evidence the face reading asks of a small flat).
  const small: number[][] = [];
  for (let t = 0; t < nT; t++) {
    const a = atom[t];
    if (!flatSet[a] || flatAtom[a]) continue;
    (small[a] ??= []).push(t);
  }
  small.forEach((tris, a) => { if (tris && smoothFlat(m, tris)) flatAtom[a] = 1; });
  return { flatAtom, flatSet, atomSize };
}

// ---------------------------------------------------------------------------------------------
// Strength

/**
 * Edges the surface turns sharply across: a fold over `sharp` degrees that also stands well above
 * the next folds met walking straight off the edge on either side. A round meshed coarsely folds
 * by the same large angle at every facet; a design edge folds once.
 */
function sharpEdges(m: Mesh, fold: Float64Array, back: Int32Array, o: StructureOptions): Uint8Array {
  const nT = m.tri.length / 3;
  const sharp = new Uint8Array(nT * 3);
  for (let h = 0; h < nT * 3; h++) {
    const f = Math.abs(fold[h]);
    if (!(f > o.sharp) || back[h] < 0) continue;
    if (h > back[h]) { sharp[h] = sharp[back[h]]; continue; }
    const side = Math.max(nextFold(m, fold, h), nextFold(m, fold, back[h]));
    if (f > o.sharpOverSides * side) sharp[h] = sharp[back[h]] = 1;
  }
  return sharp;
}

/**
 * Walking from the middle of half-edge h straight across its triangle and on, perpendicular to
 * the edge, unfolding as it goes: the size of the first fold met that is not a diagonal inside a
 * planar facet. Within a few triangles; 0 when none is met.
 */
function nextFold(m: Mesh, fold: Float64Array, h: number): number {
  let t = Math.floor(h / 3), inEdge = h % 3;
  const P = m.pos;
  const ia = m.tri[t * 3 + inEdge] * 3, ib = m.tri[t * 3 + (inEdge + 1) % 3] * 3;
  let p: V3 = [(P[ia] + P[ib]) / 2, (P[ia + 1] + P[ib + 1]) / 2, (P[ia + 2] + P[ib + 2]) / 2];
  let n: V3 = [m.normal[t * 3], m.normal[t * 3 + 1], m.normal[t * 3 + 2]];
  let u = normalize(cross(n, [P[ib] - P[ia], P[ib + 1] - P[ia + 1], P[ib + 2] - P[ia + 2]]));
  for (let step = 0; step < 8; step++) {
    let best = Infinity, bj = -1;
    for (let j = 0; j < 3; j++) {
      if (j === inEdge) continue;
      const qa = m.tri[t * 3 + j] * 3, qb = m.tri[t * 3 + (j + 1) % 3] * 3;
      const d: V3 = [P[qb] - P[qa], P[qb + 1] - P[qa + 1], P[qb + 2] - P[qa + 2]];
      const dn = cross(d, n);
      const den = dot(u, dn);
      if (Math.abs(den) < 1e-300) continue;
      const s = dot([P[qa] - p[0], P[qa + 1] - p[1], P[qa + 2] - p[2]], dn) / den;
      if (s > 0 && s < best) { best = s; bj = j; }
    }
    if (bj < 0) return 0;
    const f = Math.abs(fold[t * 3 + bj]);
    const w = m.adj[t * 3 + bj];
    if (w < 0) return 0;
    // A fold of no size is a diagonal inside a planar facet: walk on through it.
    if (f > 1e-3) return f;
    p = [p[0] + best * u[0], p[1] + best * u[1], p[2] + best * u[2]];
    const qa = m.tri[t * 3 + bj] * 3, qb = m.tri[t * 3 + (bj + 1) % 3] * 3;
    const ed = normalize([P[qb] - P[qa], P[qb + 1] - P[qa + 1], P[qb + 2] - P[qa + 2]]);
    const no: V3 = [m.normal[w * 3], m.normal[w * 3 + 1], m.normal[w * 3 + 2]];
    const al = dot(u, ed), be = dot(u, cross(n, ed));
    const pe = cross(no, ed);
    u = normalize([al * ed[0] + be * pe[0], al * ed[1] + be * pe[1], al * ed[2] + be * pe[2]]);
    n = no;
    let came = -1;
    for (let j = 0; j < 3; j++) if (m.adj[w * 3 + j] === t) came = j;
    t = w;
    inEdge = came;
  }
  return 0;
}

/**
 * Per half-edge, 0 to 1: 1 on a proven flat's outline and on a sharp fold, otherwise the jump in
 * triangle area across the edge on a log scale; 0 inside one exactly flat set.
 */
function edgeStrength(
  m: Mesh, atom: Int32Array, flatAtom: Uint8Array, sharp: Uint8Array, back: Int32Array, o: StructureOptions,
): Float64Array {
  const nT = m.tri.length / 3;
  const hs = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const h = t * 3 + k, w = m.adj[h];
    if (w < 0 || back[h] < h && back[h] >= 0) continue;
    let v: number;
    if (atom[t] === atom[w]) v = 0;
    else if (flatAtom[atom[t]] || flatAtom[atom[w]] || sharp[h]) v = 1;
    else {
      const r = Math.max(m.area[t], m.area[w]) / Math.max(1e-300, Math.min(m.area[t], m.area[w]));
      v = Math.min(1, Math.log2(r) / o.sizeLog);
    }
    hs[h] = v;
    if (back[h] >= 0) hs[back[h]] = v;
  }
  return hs;
}

// ---------------------------------------------------------------------------------------------
// Regions

type Border = { he: number[]; s: number; w: number };

/**
 * Touching regions joined, weakest shared border first (length-weighted mean strength), while
 * that border is weaker than `tau`. Two regions large enough to show how they bend are not
 * joined when they bend differently across the border. Then specks join a neighbour and single
 * triangles cut into a neighbour on two sides (teeth) go to it.
 */
function growRegions(
  m: Mesh, atom: Int32Array, flatAtom: Uint8Array, atomSize: Int32Array, hs: Float64Array, o: StructureOptions,
): { regionOf: Int32Array; regions: number[][]; tree: MergeTree } {
  const nT = m.tri.length / 3;
  const nR = atomSize.length;
  const lab = atom;
  const parent = new Int32Array(nR);
  for (let i = 0; i < nR; i++) parent[i] = i;
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const members: number[][] = Array.from({ length: nR }, () => []);
  for (let t = 0; t < nT; t++) members[lab[t]].push(t);
  const flatR = new Uint8Array(nR);
  for (let a = 0; a < nR; a++) flatR[a] = flatAtom[a];
  const bd: Map<number, Border>[] = Array.from({ length: nR }, () => new Map());
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0 || lab[w] === lab[t]) continue;
    const h = t * 3 + k;
    let e = bd[lab[t]].get(lab[w]);
    if (!e) bd[lab[t]].set(lab[w], (e = { he: [], s: 0, w: 0 }));
    const l = edgeLength(m, h);
    e.he.push(h); e.s += hs[h] * l; e.w += l;
  }
  // The tree: each region's current node.
  const node = new Int32Array(nR);
  for (let i = 0; i < nR; i++) node[i] = i;
  const kids: number[] = [];
  const join = (big: number, small: number) => {
    kids.push(node[big], node[small]);
    node[big] = nR + kids.length / 2 - 1;
    parent[small] = big;
    for (const t of members[small]) members[big].push(t);
    members[small] = [];
    flatR[big] |= flatR[small];
    bd[big].delete(small); bd[small].delete(big);
    for (const [c, e] of bd[small]) {
      const mine = bd[big].get(c);
      if (mine) { for (const h of e.he) mine.he.push(h); mine.s += e.s; mine.w += e.w; } else bd[big].set(c, e);
      const th = bd[c].get(small)!;
      bd[c].delete(small);
      const tb = bd[c].get(big);
      if (tb) { for (const h of th.he) tb.he.push(h); tb.s += th.s; tb.w += th.w; } else bd[c].set(big, th);
    }
    bd[small] = new Map();
  };
  const curv = bendAcross(m, (t) => find(lab[t]), o.rings);
  const heap = new MinHeap();
  for (let a = 0; a < nR; a++) for (const [b, e] of bd[a]) if (a < b) heap.push(e.s / e.w, a, b);
  // A pair refused for its bend is offered again only once one side has changed.
  const refused = new Map<number, number>();
  const sizeKey = (a: number, b: number) => a * nR + b;
  while (heap.size) {
    const { key: s, a, b } = heap.pop();
    if (s >= o.tau) break;
    if (parent[a] !== a || parent[b] !== b) continue;
    const cur = bd[a].get(b);
    if (!cur || Math.abs(cur.s / cur.w - s) > 1e-12) continue;
    const r = refused.get(sizeKey(a, b));
    if (r !== undefined && r === members[a].length + members[b].length) continue;
    const judged = curv.sides(a, b, cur.he);
    if (judged.pairsA >= o.vetoPairs && judged.pairsB >= o.vetoPairs && judged.dc > o.vetoD) {
      refused.set(sizeKey(a, b), members[a].length + members[b].length);
      continue;
    }
    const [big, small] = members[a].length >= members[b].length ? [a, b] : [b, a];
    const touched = [...bd[small].keys()].filter((c) => c !== big);
    join(big, small);
    for (const c of touched) { const e = bd[big].get(c)!; heap.push(e.s / e.w, Math.min(big, c), Math.max(big, c)); }
    // Pairs refused before may be judged differently now that this region is larger.
    for (const [c, e] of bd[big]) if (refused.has(sizeKey(Math.min(big, c), Math.max(big, c)))) heap.push(e.s / e.w, Math.min(big, c), Math.max(big, c));
  }
  // Specks: too few triangles to show a shape of their own, and not flat. An exactly flat set of
  // two triangles that nothing joined stays: it may be a small flat face.
  const keep = (r: number) => flatR[r] === 1 || (members[r].length === atomSize[r] && atomSize[r] >= 2);
  for (let pass = 0; pass < 3; pass++) {
    let n = 0;
    for (let r = 0; r < nR; r++) {
      if (parent[r] !== r || !members[r].length || members[r].length >= o.minSize || keep(r)) continue;
      let best = -1, bs = Infinity;
      for (const [c, e] of bd[r]) { if (keep(c)) continue; const v = e.s / e.w; if (v < bs) { bs = v; best = c; } }
      if (best < 0) continue;
      const [big, small] = members[best].length >= members[r].length ? [best, r] : [r, best];
      join(big, small);
      n++;
    }
    if (!n) break;
  }
  // Teeth: a triangle whose two other sides both touch one other region goes to it.
  const label = new Int32Array(nT);
  for (let t = 0; t < nT; t++) label[t] = find(lab[t]);
  for (let round = 0; round < 5; round++) {
    let n = 0;
    for (let t = 0; t < nT; t++) {
      if (flatAtom[atom[t]]) continue;
      const a = m.adj[t * 3], b = m.adj[t * 3 + 1], c = m.adj[t * 3 + 2];
      if (a < 0 || b < 0 || c < 0) continue;
      let x = -1;
      if (label[a] === label[b] && label[a] !== label[t]) x = a;
      else if (label[a] === label[c] && label[a] !== label[t]) x = a;
      else if (label[b] === label[c] && label[b] !== label[t]) x = b;
      if (x < 0 || flatAtom[atom[x]]) continue;
      label[t] = label[x];
      n++;
    }
    if (!n) break;
  }
  // Compact, keeping the tree node of each final region (a region a tooth moved between keeps its
  // node: the tree says how it was built, the triangles where it ended).
  const ids = new Map<number, number>();
  const regionOf = new Int32Array(nT);
  const regions: number[][] = [];
  const nodeOf: number[] = [];
  for (let t = 0; t < nT; t++) {
    let i = ids.get(label[t]);
    if (i === undefined) { i = regions.length; ids.set(label[t], i); regions.push([]); nodeOf.push(node[label[t]]); }
    regionOf[t] = i;
    regions[i].push(t);
  }
  return { regionOf, regions, tree: { nLeaf: nR, kids: Int32Array.from(kids), leafOf: Int32Array.from(atom), nodeOf: Int32Array.from(nodeOf) } };
}

class MinHeap {
  private k: number[] = [];
  private a: number[] = [];
  private b: number[] = [];
  get size(): number { return this.k.length; }
  push(key: number, a: number, b: number): void {
    const { k, a: A, b: B } = this;
    k.push(key); A.push(a); B.push(b);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { key: number; a: number; b: number } {
    const { k, a: A, b: B } = this;
    const top = { key: k[0], a: A[0], b: B[0] };
    const lk = k.pop()!, la = A.pop()!, lb = B.pop()!;
    if (k.length) {
      k[0] = lk; A[0] = la; B[0] = lb;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < k.length && k[l] < k[s]) s = l;
        if (r < k.length && k[r] < k[s]) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }
  private swap(i: number, j: number): void {
    const { k, a, b } = this;
    let x = k[i]; k[i] = k[j]; k[j] = x;
    x = a[i]; a[i] = a[j]; a[j] = x;
    x = b[i]; b[i] = b[j]; b[j] = x;
  }
}

/**
 * How the surface bends on each side of a border, from the mesh's own normals: a shape operator
 * fitted over a band of `rings` triangles each side, read across the border. `dc` is the
 * difference across, relative to the larger; a curvature of a radius as large as the part counts
 * as nearly flat (the offset in the denominator), so two near-flat sides are never told apart.
 */
function bendAcross(m: Mesh, regionOf: (t: number) => number, rings: number) {
  const nT = m.tri.length / 3;
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < m.pos.length / 3; v++) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], m.pos[v * 3 + d]); hi[d] = Math.max(hi[d], m.pos[v * 3 + d]); }
  const k0 = 1 / Math.max(1e-300, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
  const cen = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let d = 0; d < 3; d++) cen[t * 3 + d] = (m.pos[m.tri[t * 3] * 3 + d] + m.pos[m.tri[t * 3 + 1] * 3 + d] + m.pos[m.tri[t * 3 + 2] * 3 + d]) / 3;
  const band = (R: number, starts: number[]): Set<number> => {
    const seen = new Set(starts);
    let front = [...seen];
    for (let r = 1; r < rings; r++) {
      const next: number[] = [];
      for (const t of front) for (let k = 0; k < 3; k++) {
        const x = m.adj[t * 3 + k];
        if (x >= 0 && !seen.has(x) && regionOf(x) === R) { seen.add(x); next.push(x); }
      }
      front = next;
    }
    return seen;
  };
  /** Least-squares shape operator over the band in its mean tangent plane, as a world 3x3, and the pairs it used. */
  const shape = (seen: Set<number>): { T: number[]; pairs: number } => {
    let N: V3 = [0, 0, 0];
    for (const t of seen) for (let i = 0; i < 3; i++) N[i] += m.normal[t * 3 + i] * m.area[t];
    N = normalize(N);
    const [u, v] = basis(N);
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0];
    let pairs = 0;
    const add = (r0: number, r1: number, r2: number, rhs: number) => {
      const row = [r0, r1, r2];
      for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) A[i * 3 + j] += row[i] * row[j]; }
    };
    for (const t of seen) for (let k = 0; k < 3; k++) {
      const x = m.adj[t * 3 + k];
      if (x < 0 || x < t || !seen.has(x)) continue;
      const dx: V3 = [cen[x * 3] - cen[t * 3], cen[x * 3 + 1] - cen[t * 3 + 1], cen[x * 3 + 2] - cen[t * 3 + 2]];
      const dn: V3 = [m.normal[x * 3] - m.normal[t * 3], m.normal[x * 3 + 1] - m.normal[t * 3 + 1], m.normal[x * 3 + 2] - m.normal[t * 3 + 2]];
      const xu = dot(dx, u), xv = dot(dx, v), nu = dot(dn, u), nv = dot(dn, v);
      // Each pair counts once whatever its spacing.
      const w = 1 / Math.max(1e-300, Math.hypot(xu, xv));
      add(xu * w, xv * w, 0, nu * w);
      add(0, xu * w, xv * w, nv * w);
      pairs++;
    }
    for (let i = 0; i < 3; i++) A[i * 4] += 1e-12;
    const s = solve3(A, b);
    const T = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const S2 = [[s[0], s[1]], [s[1], s[2]]], E = [u, v];
    for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) T[i * 3 + j] += S2[p][q] * E[p][i] * E[q][j];
    return { T, pairs };
  };
  const quad = (T: number[], d: V3) => { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += d[i] * T[i * 3 + j] * d[j]; return s; };
  const sides = (A: number, B: number, he: number[]) => {
    const sA: number[] = [], sB: number[] = [];
    for (const h of he) { sA.push(Math.floor(h / 3)); sB.push(m.adj[h]); }
    const a = shape(band(A, sA)), b = shape(band(B, sB));
    let cA = 0, cB = 0, W = 0;
    for (const h of he) {
      const t = Math.floor(h / 3), k = h % 3;
      const p = m.tri[t * 3 + k] * 3, q = m.tri[t * 3 + (k + 1) % 3] * 3;
      const e: V3 = [m.pos[q] - m.pos[p], m.pos[q + 1] - m.pos[p + 1], m.pos[q + 2] - m.pos[p + 2]];
      const l = Math.hypot(e[0], e[1], e[2]);
      const n: V3 = [m.normal[t * 3], m.normal[t * 3 + 1], m.normal[t * 3 + 2]];
      const across = normalize(cross(n, e));
      cA += quad(a.T, across) * l; cB += quad(b.T, across) * l; W += l;
    }
    cA /= W; cB /= W;
    const dc = Math.abs(cA - cB) / (Math.max(Math.abs(cA), Math.abs(cB)) + k0);
    return { dc, cA, cB, pairsA: a.pairs, pairsB: b.pairs };
  };
  return { sides };
}

function solve3(A: number[], b: number[]): number[] {
  const M = [[A[0], A[1], A[2], b[0]], [A[3], A[4], A[5], b[1]], [A[6], A[7], A[8], b[2]]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    const sw = M[c]; M[c] = M[p]; M[p] = sw;
    const d = M[c][c] || 1e-300;
    for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / d; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  }
  return [M[0][3] / (M[0][0] || 1e-300), M[1][3] / (M[1][1] || 1e-300), M[2][3] / (M[2][2] || 1e-300)];
}

// ---------------------------------------------------------------------------------------------
// Edge tolerance

/**
 * How far points on this part's design edges sit off the faces they border. A face with points
 * inside it shows its surface exactly: fitted on those inner points alone it holds them to the
 * float precision. Its edge points then sit off that surface by whatever the CAD program's edge
 * curve is off it. The distance read on every set of triangles that shows an exact surface is the
 * edge tolerance of this part (never under the float precision).
 *
 * A region that shows no exact surface (it holds two faces or more) is taken apart along the tree
 * that built it, and its parts are read: on a part where the mesh joins a facet to its rounds, the
 * facet is still one branch of the tree, and its edges are the ones the CAD program approximated.
 */
function edgeTolerance(
  m: Mesh, regions: number[][], flatRegion: Uint8Array, tree: MergeTree, tolPoint: number,
): { tolEdge: number; edge: EdgeReading } {
  const nT = m.tri.length / 3, nV = m.pos.length / 3;
  const inSet = new Int32Array(nT).fill(-1);
  const inner = new Uint8Array(nV);
  let stamp = 0, points = 0;
  const found: { value: number; sag: number; inner: number }[] = [];
  // Tree nodes: the triangles of each leaf, and each node's size.
  const nNodes = tree.nLeaf + tree.kids.length / 2;
  const leafStart = new Int32Array(tree.nLeaf + 1);
  for (let t = 0; t < nT; t++) leafStart[tree.leafOf[t] + 1]++;
  for (let i = 0; i < tree.nLeaf; i++) leafStart[i + 1] += leafStart[i];
  const leafTris = new Int32Array(nT), fill = leafStart.slice(0, tree.nLeaf);
  for (let t = 0; t < nT; t++) leafTris[fill[tree.leafOf[t]]++] = t;
  const size = new Int32Array(nNodes);
  for (let i = 0; i < tree.nLeaf; i++) size[i] = leafStart[i + 1] - leafStart[i];
  for (let i = 0; i < tree.kids.length / 2; i++) size[tree.nLeaf + i] = size[tree.kids[2 * i]] + size[tree.kids[2 * i + 1]];
  const nodeTris = (node: number): number[] => {
    const out: number[] = [], stack = [node];
    while (stack.length) {
      const n = stack.pop()!;
      if (n < tree.nLeaf) { for (let i = leafStart[n]; i < leafStart[n + 1]; i++) out.push(leafTris[i]); } else stack.push(tree.kids[2 * (n - tree.nLeaf)], tree.kids[2 * (n - tree.nLeaf) + 1]);
    }
    return out;
  };
  /** Reads one set of triangles; true when it showed an exact surface. */
  const read = (tris: number[]): boolean => {
    const id = stamp++;
    for (const t of tris) inSet[t] = id;
    const innerVs: number[] = [];
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = m.tri[t * 3 + k];
      if (inner[v]) continue;
      let all = true;
      for (const u of m.vertTris[v]) if (inSet[u] !== id) { all = false; break; }
      if (!all) continue;
      inner[v] = 1;
      innerVs.push(v);
    }
    const clear = () => { for (const v of innerVs) inner[v] = 0; };
    if (innerVs.length < INNER_LEAST) { clear(); return false; }
    const s = exactSurface(m, tris, innerVs, tolPoint);
    if (!s) { clear(); return false; }
    // How far this surface's own facets bow off it: the mesher's sag, read on triangles with only
    // inner corners. A triangle with an edge point bows about as far; one that bows much further
    // belongs to another surface the set took in (a round joined to the face it runs into shares
    // inner points with it along the tangent edge).
    let sag = 0, whole = 0;
    for (const t of tris) {
      const a = m.tri[t * 3], b = m.tri[t * 3 + 1], c = m.tri[t * 3 + 2];
      if (!inner[a] || !inner[b] || !inner[c]) continue;
      sag = Math.max(sag, Math.abs(distance(s, centreOf(m, t))));
      whole++;
    }
    const edgeVs = new Set<number>();
    if (whole) for (const t of tris) {
      const a = m.tri[t * 3], b = m.tri[t * 3 + 1], c = m.tri[t * 3 + 2];
      const nIn = inner[a] + inner[b] + inner[c];
      if (nIn === 0 || nIn === 3) continue;
      if (Math.abs(distance(s, centreOf(m, t))) > 2 * sag + tolPoint) continue;
      for (const v of [a, b, c]) if (!inner[v]) edgeVs.add(v);
    }
    clear();
    // An edge point further off than the facets bow is on another surface: no CAD program's edge
    // curve strays from its face further than the mesher let a facet stray from it.
    const ds: number[] = [];
    for (const v of edgeVs) {
      const d = Math.abs(distance(s, vtx(m.pos, v)));
      if (d <= Math.max(sag, tolPoint)) ds.push(d);
    }
    if (!ds.length) return true;
    // A high share rather than the largest: a few corners of a neighbour's triangles that the set
    // took in sit just inside the bow.
    ds.sort((x, y) => x - y);
    const here = ds[Math.min(ds.length - 1, Math.floor(EDGE_SHARE * ds.length))];
    // Pinned: a surface threaded through a few inner points of something else (a patch of a
    // free-form round holds a torus at the float precision) parts from that face's edge points by
    // about as much as the facets bow. A real edge curve stays within a small share of the bow.
    if (here > SAG_SHARE * sag) return true;
    points += ds.length;
    found.push({ value: Math.max(here, tolPoint), sag, inner: innerVs.length });
    const dbg = (globalThis as { __structureDebug?: unknown[] }).__structureDebug;
    if (dbg) dbg.push({ tris: tris.length, tri0: tris[0], inner: innerVs.length, whole, kind: s.kind, edge: ds.length, worst: here, sag });
    return true;
  };
  for (let r = 0; r < regions.length; r++) {
    if (flatRegion[r] || read(regions[r])) continue;
    // Down the tree. A long run of small joins is walked, not read at every step: a node is read
    // when it is at most nine tenths of the last node read on its way down.
    const stack: [number, number][] = [[tree.nodeOf[r], size[tree.nodeOf[r]]]];
    while (stack.length) {
      const [n, last] = stack.pop()!;
      if (n < tree.nLeaf) continue;
      for (const c of [tree.kids[2 * (n - tree.nLeaf)], tree.kids[2 * (n - tree.nLeaf) + 1]]) {
        if (size[c] < 2 * INNER_LEAST) continue;
        if (size[c] > DESCEND_STEP * last) { stack.push([c, last]); continue; }
        if (!read(nodeTris(c))) stack.push([c, size[c]]);
      }
    }
  }
  // Supported: by a set with many inner points, or by two sets that read within a factor of two
  // of each other. One small set alone decides nothing.
  found.sort((a, b) => b.value - a.value);
  let value = tolPoint, support = 0, next = 0, ceiling = Infinity;
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    const with_ = found.filter((g) => g.value >= f.value / 2 && g.value <= 2 * f.value);
    if (f.inner >= LARGE_SET || with_.length >= 2) {
      value = f.value;
      support = with_.length;
      for (const g of with_) ceiling = Math.min(ceiling, g.sag);
      break;
    }
    next = Math.max(next, f.value);
  }
  const tolEdge = Math.max(EDGE_FLOOR * tolPoint, Math.min(EDGE_MARGIN * value, ceiling));
  return { tolEdge, edge: { points, sets: found.length, value, support, next, ceiling: Number.isFinite(ceiling) ? ceiling : 0 } };
}

/** The most a set's edge points may sit off its surface, as a share of its facets' bow, for the set to count (see read). */
export const SAG_SHARE = 0.25;
/** Inner points that let one set support a value alone. */
const LARGE_SET = 50;

/** A node of the tree is read again when it is at most this share of the last one read above it. */
const DESCEND_STEP = 0.9;
/** The share of a region's edge points below the distance read from it. */
const EDGE_SHARE = 0.9;
/**
 * The tolerance given for the distance read. Faces with no inner points (flats and cylinders in
 * a mesh with no inner points) cannot be read and sit further off: on parts with known answers up to 1.5
 * float steps where the faces that can be read show under 1.1; on one test part its end walls
 * 3.5e-3 mm where its cone with inner points shows 1.4e-3 (nine tenths of its edge points).
 * Measured on those two only.
 */
const EDGE_MARGIN = 2;
/**
 * The least edge tolerance, in float precisions: edge points on a part whose exact faces show no
 * looser edge still sit up to 2.6 of them off (Head1's cylinders, 4e-5 mm against 1.5e-5).
 */
const EDGE_FLOOR = 3;

export const centreOf = (m: Mesh, t: number): V3 => {
  const a = m.tri[t * 3] * 3, b = m.tri[t * 3 + 1] * 3, c = m.tri[t * 3 + 2] * 3;
  return [(m.pos[a] + m.pos[b] + m.pos[c]) / 3, (m.pos[a + 1] + m.pos[b + 1] + m.pos[c + 1]) / 3, (m.pos[a + 2] + m.pos[b + 2] + m.pos[c + 2]) / 3];
};

/** Inner points a set needs before a surface fitted on them alone is believed: a torus has 7 degrees of freedom, and spares. */
export const INNER_LEAST = 12;
/** The most inner points a fit is run on (spread evenly over the region); all of them are tested. */
const FIT_POINTS = 400;

/** A torus ring under this share of its tube is no ring. */
const RING_NONE = 1e-3;

/** Numbers each kind of surface is written with. */
const FREEDOM: Record<Analytic['kind'], number> = { plane: 3, sphere: 4, cylinder: 5, cone: 6, torus: 7 };

/** A cylinder, cone, sphere or torus through the inner points that holds every one of them to the float precision, or null. */
export function exactSurface(m: Mesh, tris: number[], innerVs: number[], tolPoint: number, tie = tolPoint): Analytic | null {
  const stepBy = Math.max(1, Math.floor(innerVs.length / FIT_POINTS));
  const ids = new Map<number, number>();
  const pts: V3[] = [], vnrm: V3[] = [];
  for (let i = 0; i < innerVs.length; i += stepBy) { ids.set(innerVs[i], pts.length); pts.push(vtx(m.pos, innerVs[i])); vnrm.push([0, 0, 0]); }
  const tnrm: V3[] = [], tpts: V3[] = [], pairs: [number, number][] = [];
  for (const t of tris) {
    const n: V3 = [m.normal[t * 3], m.normal[t * 3 + 1], m.normal[t * 3 + 2]];
    tnrm.push(n);
    const a = vtx(m.pos, m.tri[t * 3]), b = vtx(m.pos, m.tri[t * 3 + 1]), c = vtx(m.pos, m.tri[t * 3 + 2]);
    tpts.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    for (let k = 0; k < 3; k++) {
      const i = ids.get(m.tri[t * 3 + k]), j = ids.get(m.tri[t * 3 + (k + 1) % 3]);
      if (i !== undefined) for (let d = 0; d < 3; d++) vnrm[i][d] += n[d] * m.area[t];
      if (i !== undefined && j !== undefined && i < j) pairs.push([i, j]);
    }
  }
  const sample: Sample = { pts, vnrm: vnrm.map(normalize), tnrm, tpts, pairs };
  // Of the surfaces that hold every inner point, the true one is the flattest: the one the facets
  // bow off least. Inner points on two rings of a cone lie on a sphere too, and the sphere bows
  // far off the cone's facets. Two that bow alike (within twice the tie) are one surface written
  // two ways (a torus with no ring is a sphere): the one with fewer numbers is the design.
  let best: Analytic | null = null, bestBow = Infinity;
  for (const fit of [fitCylinder, fitCone, fitSphere, fitTorus]) {
    let s: Analytic | null = null;
    try { s = fit(sample); } catch { s = null; }
    if (!s || !finiteSurface(s)) continue;
    let err = 0;
    for (const v of innerVs) { err = Math.max(err, Math.abs(distance(s, vtx(m.pos, v)))); if (err > tolPoint) break; }
    if (!(err <= tolPoint)) continue;
    let bow = 0;
    for (const t of tris) bow = Math.max(bow, Math.abs(distance(s, centreOf(m, t))));
    const simpler = best !== null && FREEDOM[s.kind] < FREEDOM[best.kind];
    if (bow < bestBow - 2 * tie || (simpler && bow <= bestBow + 2 * tie)) { best = s; bestBow = bow; }
  }
  // A torus whose ring has no size is a sphere (the dome of a turned part): the sphere is the design,
  // and only it has a normal on the axis.
  if (best && best.kind === 'torus' && Math.abs(best.R) <= RING_NONE * best.r) {
    const sphere = refine({ kind: 'sphere', c: best.c, r: best.r }, innerVs.map((v) => vtx(m.pos, v)));
    let err = 0;
    for (const v of innerVs) err = Math.max(err, Math.abs(distance(sphere, vtx(m.pos, v))));
    // Held as well as the float precision allows: the ring the torus found is that much, no more.
    if (finiteSurface(sphere) && err <= 2 * Math.min(tolPoint, tie)) return sphere;
  }
  return best;
}

export function finiteSurface(s: Analytic): boolean {
  for (const x of Object.values(s)) {
    if (typeof x === 'number' && !Number.isFinite(x)) return false;
    if (Array.isArray(x) && !x.every(Number.isFinite)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Kind of mesh

/**
 * What made the mesh. A CAD export meshes each face on its own: its flat faces are exactly flat
 * and have no points inside them (every point is on the outline). A generator (a CSG or extrusion
 * library) closes a flat cap with a fan round a centre point. A sculpt has no flat faces at all.
 */
function meshKind(m: Mesh, atom: Int32Array, flatAtom: Uint8Array): Structure['kind'] {
  const nT = m.tri.length / 3;
  let total = 0, flat = 0, flatTris = 0, fanTris = 0;
  for (let t = 0; t < nT; t++) { total += m.area[t]; if (flatAtom[atom[t]]) { flat += m.area[t]; flatTris++; } }
  if (!(flat >= SCULPT_FLAT_SHARE * total)) return 'sculpt';
  // A point inside a flat: all its triangles in the one exactly flat set.
  for (let v = 0; v < m.pos.length / 3; v++) {
    const ts = m.vertTris[v];
    if (!ts.length || !flatAtom[atom[ts[0]]]) continue;
    let inside = true;
    for (const t of ts) if (atom[t] !== atom[ts[0]]) { inside = false; break; }
    if (inside) fanTris += ts.length;
  }
  return fanTris >= FAN_SHARE * flatTris ? 'generated' : 'cad';
}

/**
 * The least share of the part's area in exactly flat faces for a CAD reading. Measured on the
 * test parts: a sculpted part has 0.7%, the CAD exports 22% to 88%.
 */
const SCULPT_FLAT_SHARE = 0.05;
/**
 * The share of flat triangles round points inside flats that marks a generator. Measured: two
 * generator-made parts 20% and 60% (centre fans of 144 triangles); CAD exports 0 to 1.5%.
 */
const FAN_SHARE = 0.1;

function ownNormals(m: Mesh): Float64Array {
  const nT = m.tri.length / 3, out = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = vtx(m.pos, m.tri[t * 3]), b = vtx(m.pos, m.tri[t * 3 + 1]), c = vtx(m.pos, m.tri[t * 3 + 2]);
    out.set(normalize(cross(sub(b, a), sub(c, a))), t * 3);
  }
  return out;
}
