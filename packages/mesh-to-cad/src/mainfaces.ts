// The part's main faces: the faces whose surfaces are exact, found before anything is rolled or
// sheeted between them.
//
// Candidates come from two places: the mesh's own regions (each read whole, or taken apart along
// the tree that built it), and the faces the segmenter found from its seeds (it reads tori and cones
// well where the mesh joins them to their neighbours). Every candidate is held to the same test:
//
//   - its inner points (all their triangles in it) lie on the surface to the float precision;
//   - its edge points lie on it within the edge tolerance: the part's, or what this face's own
//     edge points show when it has inner points to pin it, never more than a small share of how far
//     its facets bow;
//   - its facets lie between the points and face the way the surface does;
//   - its border runs along the mesh's evidence (a crease, a flat's outline, a change of mesh
//     pattern). A cone accepted on part of a gently curved facet has a border across the facet's
//     even triangles, where the mesh shows nothing.
//
// A face with no inner points (a cylinder meshed with no points inside it) is fitted on its edge points.
// Held at the part's edge tolerance it is believed; held only within the share of its bow, it is
// believed when its axis is one the part already has.

import { type V3, basis, cross, dot, norm, normalize, solve, sub } from './linalg';
import { type Mesh, triNormal, vtx } from './mesh';
import { type Region } from './segment';
import { type Analytic, type Cone, type Cylinder, type Torus, distance, fitPlane, normalAt } from './surfaces';
import { holdsFacets, onAxis, pieces, proves, shows } from './features';
import { type Structure, INNER_LEAST, SAG_SHARE, centreOf, exactSurface } from './structure';

/** A main face: exact surface, its triangles, and the tolerance its edge points were held to. */
export type MainFace = Region & { surf: Analytic; tol: number; from: 'flat' | 'region' | 'branch' | 'seed' | 'design' };

type Judged = { surf: Analytic; err: number; tol: number } | null;

/** The share of a candidate's border length that must run on evidence (strength of a half or more). */
const BORDER_SHARE = 0.9;
/** Strength from which an edge is evidence of a design edge. */
const EVIDENCE = 0.5;
/** Points per number of the surface a face with no inner points needs. */
const UNPINNED_PER_NUMBER = 3;
const FREEDOM: Record<Analytic['kind'], number> = { plane: 3, sphere: 4, cylinder: 5, cone: 6, torus: 7 };
/** Two axes are one when they turn apart by less than this (radians). */
const SAME_AXIS = 1e-3;

export function mainFaces(m: Mesh, S: Structure, seeds: Region[], eps: number): { main: MainFace[]; band: number[] } {
  const nT = m.tri.length / 3, nV = m.pos.length / 3;
  const stampT = new Int32Array(nT).fill(-1);
  const inner = new Uint8Array(nV);
  let stamp = 0;
  const axes: { o: V3; a: V3 }[] = [];

  /** The length-weighted share of a set's border on evidence. */
  const onEvidence = (tris: number[], id: number): number => {
    let all = 0, seen = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w < 0 || stampT[w] === id) continue;
      const a = m.tri[t * 3 + k] * 3, b = m.tri[t * 3 + (k + 1) % 3] * 3;
      const l = Math.hypot(m.pos[a] - m.pos[b], m.pos[a + 1] - m.pos[b + 1], m.pos[a + 2] - m.pos[b + 2]);
      all += l;
      if (S.strength[t * 3 + k] >= EVIDENCE) seen += l;
    }
    return all ? seen / all : 1;
  };

  /** Whether every triangle (bar slivers) faces the way the surface does, one way round for all. */
  const facing = (s: Analytic, tris: number[]): boolean => {
    let sense = 0;
    for (const t of tris) sense += m.area[t] * dot(triNormal(m, t), normalAt(s, centreOf(m, t)));
    const sg = sense >= 0 ? 1 : -1;
    for (const t of tris) {
      if (sliver(m, t, S.tolPoint) || onAxis(m, s, t, S.tolPoint)) continue;
      if (sg * dot(triNormal(m, t), normalAt(s, centreOf(m, t))) < 0.5) return false;
    }
    return true;
  };

  /**
   * The test every candidate passes. `given`: a surface the candidate came with (a seed's), tried
   * when the inner points cannot be refitted.
   */
  const judge = (tris: number[], given: Analytic | null, needBorder: number): Judged => {
    const id = stamp++;
    for (const t of tris) stampT[t] = id;
    const innerVs: number[] = [], edgeVs: number[] = [];
    const seenV = new Set<number>();
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = m.tri[t * 3 + k];
      if (seenV.has(v)) continue;
      seenV.add(v);
      let all = true;
      for (const u of m.vertTris[v]) if (stampT[u] !== id) { all = false; break; }
      if (all) { innerVs.push(v); inner[v] = 1; } else edgeVs.push(v);
    }
    const clear = () => { for (const v of innerVs) inner[v] = 0; };
    const allVs = [...innerVs, ...edgeVs];
    if (allVs.length < 6) { clear(); return null; }
    // A face pinned by its inner points proves its surface by them; one held only by its edge
    // points must also be bounded by the mesh's evidence.
    if (innerVs.length < INNER_LEAST && onEvidence(tris, id) < needBorder) { clear(); return null; }
    let s: Analytic | null = null;
    let pinned = false;
    if (innerVs.length >= INNER_LEAST) {
      s = exactSurface(m, tris, innerVs, S.tolPoint);
      if (!s && given && holdsAll(m, given, innerVs, S.tolPoint)) s = given;
      pinned = !!s;
      if (!s) { clear(); return null; }
    } else {
      // No inner points to pin it: the flattest surface through all its points.
      s = exactSurface(m, tris, allVs, Infinity, S.tolPoint);
      if (given && (!s || worstOff(m, given, allVs) < worstOff(m, s, allVs))) s = given;
      // Points only on its edges pin a surface only when there are many more of them than the
      // surface has numbers: ten points of a gently curved facet hold a cone to a few micrometres.
      if (!s || allVs.length < UNPINNED_PER_NUMBER * FREEDOM[s.kind]) { clear(); return null; }
    }
    clear();
    // The bow: how far the facets stand off the surface between their corners.
    let sag = 0;
    for (const t of tris) sag = Math.max(sag, Math.abs(distance(s, centreOf(m, t))));
    const ceiling = Math.max(S.tolEdge, SAG_SHARE * sag);
    let err = worstOff(m, s, edgeVs);
    let tol = S.tolEdge;
    if (err > S.tolEdge) {
      // A face pinned by its inner points is held at the part's edge tolerance: a looser hold on
      // its own reading let a torus take the cones tangent to it (a slot's ends).
      if (pinned) return null;
      {
        // Held only loosely: believed on an axis the part already has.
        const snapped = snapToAxis(m, s, allVs, axes);
        if (!snapped) return null;
        s = snapped;
        err = worstOff(m, s, allVs);
        tol = ceiling;
      }
    }
    const dbg = (globalThis as { __mainDebug?: (x: unknown) => void }).__mainDebug;
    if (dbg) dbg({ tris, inner: innerVs.length, kind: s.kind, err, tol, sag, pinned, shows: shows(m, s, allVs), facets: holdsFacets(m, s, tris), facing: facing(s, tris) });
    if (err > tol) return null;
    if (!shows(m, s, allVs) || !holdsFacets(m, s, tris) || !facing(s, tris)) return null;
    return { surf: s, err: Math.max(err, worstOff(m, s, innerVs)), tol };
  };

  const main: MainFace[] = [];
  const owner = new Int32Array(nT).fill(-1);
  const claim = (f: MainFace) => {
    main.push(f);
    for (const t of f.tris) owner[t] = main.length - 1;
    const s = f.surf;
    if (s.kind === 'cylinder') axes.push({ o: s.o, a: s.a });
    else if (s.kind === 'cone') axes.push({ o: s.apex, a: s.a });
    else if (s.kind === 'torus') axes.push({ o: s.c, a: s.a });
  };
  /** Offers a candidate: what is still unclaimed of it, judged again when some of it was taken. */
  const offer = (tris: number[], given: Analytic | null, needBorder: number, from: MainFace['from']): boolean => {
    const free = tris.filter((t) => owner[t] < 0);
    if (free.length < tris.length / 2) return false;
    let best: MainFace | null = null;
    for (const part of free.length === tris.length ? [tris] : pieces(m, free)) {
      if (part.length < free.length / 2) continue;
      const j = judge(part, given, needBorder);
      if (j) best = { tris: part, surf: j.surf, err: j.err, tol: j.tol, from };
    }
    if (best) claim(best);
    return !!best;
  };

  // 0. A seed face that is already right is the main face, as it is: it holds its inner points at
  // the tolerance it was found at with its own surface, proves it (the reading's own test), faces
  // its way and is bounded by evidence. Where the two sources
  // disagree about such a face (a structure border across a seed's plane), the seed decides: both
  // agree on the surface, and the seed covers it whole.
  const seedFirst = seeds.filter((f) => isAnalytic(f.surf) && proves(m, f)).sort((a, b) => b.tris.length - a.tris.length);
  for (const f of seedFirst) {
    if (f.tris.some((t) => owner[t] >= 0)) continue;
    const s = f.surf as Analytic;
    const id = stamp++;
    for (const t of f.tris) stampT[t] = id;
    const innerVs: number[] = [], edgeVs: number[] = [];
    const seenV = new Set<number>();
    for (const t of f.tris) for (let k = 0; k < 3; k++) {
      const v = m.tri[t * 3 + k];
      if (seenV.has(v)) continue;
      seenV.add(v);
      let all = true;
      for (const u of m.vertTris[v]) if (stampT[u] !== id) { all = false; break; }
      (all ? innerVs : edgeVs).push(v);
    }
    // Bounded by the mesh's evidence, it needs no tighter hold than the one it was found at: the
    // evidence says where it ends. (The tight holds below are for faces the evidence does not bound.)
    const tol = Math.max(eps, 1.5 * f.err);
    if (!holdsAll(m, s, innerVs, tol) || !holdsAll(m, s, edgeVs, tol)) continue;
    if (onEvidence(f.tris, id) < BORDER_SHARE || !facing(s, f.tris)) continue;
    claim({ tris: [...f.tris], surf: s, err: f.err, tol, from: 'seed' });
  }
  // 1. Proven flats: exactly flat, outline all evidence (what no seed took).
  for (let r = 0; r < S.regions.length; r++) {
    if (!S.flatRegion[r]) continue;
    for (const tris of pieces(m, S.regions[r].filter((t) => owner[t] < 0))) {
    if (tris.length < 2) continue;
    const pts = [...new Set(tris.flatMap((t) => [m.tri[t * 3], m.tri[t * 3 + 1], m.tri[t * 3 + 2]]))].map((v) => vtx(m.pos, v));
    const plane = fitPlane(pts);
    let err = 0;
    for (const p of pts) err = Math.max(err, Math.abs(distance(plane, p)));
    if (err > S.tolPoint) continue;
    claim({ tris, surf: plane, err, tol: S.tolPoint, from: 'flat' });
    }
  }
  // 2. Curved regions with inner points, whole, largest first (they pin the part's axes), then
  // regions without; a region that fails is taken apart along its tree.
  const tree = treeIndex(S);
  const order = S.regions.map((_, r) => r).filter((r) => !S.flatRegion[r]).sort((a, b) => S.regions[b].length - S.regions[a].length);
  const failed: number[] = [];
  for (const r of order) if (!offer(S.regions[r], null, 0, 'region')) failed.push(r);
  for (const r of failed) {
    const stack: [number, number][] = [[S.tree.nodeOf[r], tree.size[S.tree.nodeOf[r]]]];
    while (stack.length) {
      const [n, last] = stack.pop()!;
      if (n < S.tree.nLeaf) continue;
      for (const c of [S.tree.kids[2 * (n - S.tree.nLeaf)], S.tree.kids[2 * (n - S.tree.nLeaf) + 1]]) {
        if (tree.size[c] < 3) continue;
        if (tree.size[c] > 0.9 * last) { stack.push([c, last]); continue; }
        if (!offer(tree.tris(c), null, BORDER_SHARE, 'branch') && tree.size[c] >= 6) stack.push([c, tree.size[c]]);
      }
    }
  }
  // 3. The segmenter's faces, on what is left, refitted.
  const seedOrder = seeds.filter((f) => f.surf && f.surf.kind !== 'plane' && isAnalytic(f.surf)).sort((a, b) => b.tris.length - a.tris.length);
  for (const f of seedOrder) offer(f.tris, f.surf as Analytic, BORDER_SHARE, 'seed');
  const free = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) if (owner[t] < 0) free[t] = 1;
  const kept = settle(m, S, main, free);
  const band: number[] = [];
  for (let t = 0; t < nT; t++) if (free[t]) band.push(t);
  return { main: kept, band };
}

/**
 * Decided once, straight after the main faces and again after the rounds: each main face takes the
 * free triangles beside it that lie on it (every corner within its tolerance, one at the float
 * precision, facing its way), then touching main faces of one kind that one surface holds are one
 * face (each surface holds the other's points within the looser of the two tolerances: a torus the
 * regions cut in three). Triangles taken are cleared in the free mask.
 */
export function settle(m: Mesh, S: Structure, main: MainFace[], free: Uint8Array): MainFace[] {
  const nT = m.tri.length / 3;
  const owner = new Int32Array(nT).fill(-1);
  main.forEach((f, i) => f.tris.forEach((t) => (owner[t] = i)));
  for (let changed = true; changed;) {
    changed = false;
    for (let t = 0; t < nT; t++) {
      if (!free[t] || owner[t] >= 0) continue;
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        if (w < 0 || owner[w] < 0) continue;
        const F = main[owner[w]];
        let worst = 0, least = Infinity;
        for (let j = 0; j < 3; j++) { const d = Math.abs(distance(F.surf, vtx(m.pos, m.tri[t * 3 + j]))); worst = Math.max(worst, d); least = Math.min(least, d); }
        if (worst > F.tol || least > S.tolPoint || !holdsFacets(m, F.surf, [t])) continue;
        if (!sliver(m, t, S.tolPoint) && !onAxis(m, F.surf, t, S.tolPoint) && Math.abs(dot(triNormal(m, t), normalAt(F.surf, centreOf(m, t)))) < 0.5) continue;
        owner[t] = owner[w];
        free[t] = 0;
        F.tris.push(t);
        changed = true;
        break;
      }
    }
  }
  const parent = main.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const vertsOf = (f: MainFace) => [...new Set(f.tris.flatMap((t) => [m.tri[t * 3], m.tri[t * 3 + 1], m.tri[t * 3 + 2]]))];
  const tried = new Set<number>();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0 || owner[t] < 0 || owner[w] < 0) continue;
    const a = find(owner[t]), b = find(owner[w]);
    if (a === b || main[a].surf.kind !== main[b].surf.kind) continue;
    const key = Math.min(a, b) * main.length + Math.max(a, b);
    if (tried.has(key)) continue;
    tried.add(key);
    const tol = Math.max(main[a].tol, main[b].tol);
    if (worstOff(m, main[a].surf, vertsOf(main[b])) > tol || worstOff(m, main[b].surf, vertsOf(main[a])) > tol) continue;
    const [big, small] = main[a].tris.length >= main[b].tris.length ? [a, b] : [b, a];
    parent[small] = big;
    for (const x of main[small].tris) main[big].tris.push(x);
    main[small].tris = [];
    main[big].tol = tol;
    main[big].err = Math.max(main[big].err, main[small].err);
  }
  return main.filter((f) => f.tris.length);
}

function isAnalytic(s: Region['surf']): s is Analytic {
  return !!s && (s.kind === 'plane' || s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'sphere' || s.kind === 'torus');
}

function holdsAll(m: Mesh, s: Analytic, vs: number[], tol: number): boolean {
  for (const v of vs) if (Math.abs(distance(s, vtx(m.pos, v))) > tol) return false;
  return true;
}

function worstOff(m: Mesh, s: Analytic, vs: number[]): number {
  let e = 0;
  for (const v of vs) e = Math.max(e, Math.abs(distance(s, vtx(m.pos, v))));
  return e;
}


/** A triangle with no height to speak of has no normal at the float precision. */
function sliver(m: Mesh, t: number, tolPoint: number): boolean {
  const p = [0, 1, 2].map((k) => vtx(m.pos, m.tri[t * 3 + k]));
  const longest = Math.max(norm(sub(p[1], p[0])), norm(sub(p[2], p[1])), norm(sub(p[0], p[2])));
  return (2 * m.area[t]) / Math.max(longest, 1e-300) < 10 * tolPoint;
}

/**
 * A cylinder put on an axis the part already has: the same direction, through the same line,
 * its radius the points' mean distance from it. Null when no axis fits (or the face is not a cylinder).
 */
function snapToAxis(m: Mesh, s: Analytic, vs: number[], axes: { o: V3; a: V3 }[]): Analytic | null {
  if (s.kind !== 'cylinder') return null;
  let best: Cylinder | null = null, bestErr = Infinity;
  for (const ax of axes) {
    if (Math.abs(dot(ax.a, s.a)) < Math.cos(SAME_AXIS)) continue;
    // The candidate's own axis must run along this one: the two lines apart by no more than the
    // radius's own uncertainty, a share of the radius.
    const d = sub(s.o, ax.o);
    const off = norm(cross(d, ax.a));
    if (off > SAME_AXIS * s.r + 1e-9 && off > 0.01 * s.r) continue;
    let r = 0;
    for (const v of vs) { const q = sub(vtx(m.pos, v), ax.o); r += norm(cross(q, ax.a)); }
    r /= vs.length;
    const c: Cylinder = { kind: 'cylinder', o: ax.o, a: normalize(ax.a), r };
    const e = worstOff(m, c, vs);
    if (e < bestErr) { best = c; bestErr = e; }
  }
  return best;
}

/** The tree's nodes: size, and the triangles under one. */
function treeIndex(S: Structure) {
  const T = S.tree, nT = T.leafOf.length;
  const nNodes = T.nLeaf + T.kids.length / 2;
  const start = new Int32Array(T.nLeaf + 1);
  for (let t = 0; t < nT; t++) start[T.leafOf[t] + 1]++;
  for (let i = 0; i < T.nLeaf; i++) start[i + 1] += start[i];
  const list = new Int32Array(nT), fill = start.slice(0, T.nLeaf);
  for (let t = 0; t < nT; t++) list[fill[T.leafOf[t]]++] = t;
  const size = new Int32Array(nNodes);
  for (let i = 0; i < T.nLeaf; i++) size[i] = start[i + 1] - start[i];
  for (let i = 0; i < T.kids.length / 2; i++) size[T.nLeaf + i] = size[T.kids[2 * i]] + size[T.kids[2 * i + 1]];
  const tris = (node: number): number[] => {
    const out: number[] = [], stack = [node];
    while (stack.length) {
      const n = stack.pop()!;
      if (n < T.nLeaf) { for (let i = start[n]; i < start[n + 1]; i++) out.push(list[i]); } else stack.push(T.kids[2 * (n - T.nLeaf)], T.kids[2 * (n - T.nLeaf) + 1]);
    }
    return out;
  };
  return { size, tris };
}

// ---------------------------------------------------------------------------------------------
// Surfaces about an axis or along a direction the part already has

/** Each point as (height along the axis, distance from it). */
function sectionOf(m: Mesh, l: { o: V3; a: V3 }, vs: number[]): [number, number][] {
  return vs.map((v) => { const q = sub(vtx(m.pos, v), l.o); const h = dot(q, l.a); return [h, norm(cross(q, l.a))]; });
}

/** A cylinder about the axis: its radius the points' mean distance from it. */
function cylinderAbout(m: Mesh, l: { o: V3; a: V3 }, vs: number[]): Cylinder {
  let r = 0;
  for (const [, rho] of sectionOf(m, l, vs)) r += rho;
  return { kind: 'cylinder', o: l.o, a: l.a, r: r / vs.length };
}

/** A cone about the axis: the points' section is a straight line, distance = c0 + k · height. */
function coneAbout(m: Mesh, l: { o: V3; a: V3 }, vs: number[]): Cone | null {
  const sec = sectionOf(m, l, vs);
  let sh = 0, sr = 0, shh = 0, shr = 0;
  for (const [h, r] of sec) { sh += h; sr += r; shh += h * h; shr += h * r; }
  const n = sec.length, den = n * shh - sh * sh;
  if (!(Math.abs(den) > 1e-300)) return null;
  const k = (n * shr - sh * sr) / den, c0 = (sr - k * sh) / n;
  if (!(Math.abs(k) > 1e-6)) return null;
  // The apex where the distance is nothing; the axis points into the opening.
  const hApex = -c0 / k;
  const a: V3 = k > 0 ? l.a : [-l.a[0], -l.a[1], -l.a[2]];
  const apex: V3 = [l.o[0] + l.a[0] * hApex, l.o[1] + l.a[1] * hApex, l.o[2] + l.a[2] * hApex];
  return { kind: 'cone', apex, a, ang: Math.atan(Math.abs(k)) };
}

/** A torus about the axis: the points' section is a circle (its centre's height and distance, and its radius). */
function torusAbout(m: Mesh, l: { o: V3; a: V3 }, vs: number[]): Torus | null {
  const c = circle2(sectionOf(m, l, vs));
  if (!c) return null;
  const [hc, R, r] = c;
  return { kind: 'torus', c: [l.o[0] + l.a[0] * hc, l.o[1] + l.a[1] * hc, l.o[2] + l.a[2] * hc], a: l.a, R, r };
}

/** A cylinder along the direction: the points seen down it lie on a circle. */
function cylinderAlong(m: Mesh, d: V3, vs: number[]): Cylinder | null {
  const [e1, e2] = basis(d);
  const pts = vs.map((v) => { const p = vtx(m.pos, v); return [dot(p, e1), dot(p, e2)] as [number, number]; });
  const c = circle2(pts);
  if (!c) return null;
  const [x, y, r] = c;
  return { kind: 'cylinder', o: [e1[0] * x + e2[0] * y, e1[1] * x + e2[1] * y, e1[2] * x + e2[2] * y], a: d, r };
}

/** The circle through 2D points (algebraic fit about their mean): centre and radius, or null. */
function circle2(pts: [number, number][]): [number, number, number] | null {
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x / pts.length; my += y / pts.length; }
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], b = [0, 0, 0];
  for (const [x0, y0] of pts) {
    const x = x0 - mx, y = y0 - my, row = [x, y, 1], rhs = -(x * x + y * y);
    for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) A[i * 3 + j] += row[i] * row[j]; }
  }
  const s = solve([[A[0], A[1], A[2]], [A[3], A[4], A[5]], [A[6], A[7], A[8]]], b);
  if (!s) return null;
  const cx = -s[0] / 2, cy = -s[1] / 2, r2 = cx * cx + cy * cy - s[2];
  if (!(r2 > 0)) return null;
  return [cx + mx, cy + my, Math.sqrt(r2)];
}

function finiteOf(s: Analytic): boolean {
  for (const x of Object.values(s)) {
    if (typeof x === 'number' && !Number.isFinite(x)) return false;
    if (Array.isArray(x) && !x.every(Number.isFinite)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Design candidates on what is left

/**
 * What the main faces and rounds left, read with the design the part already has. A face with few
 * or no inner points cannot pin a surface of five to seven numbers, but it can pin one with one or
 * two: the same surface as a main face, a cylinder or cone about an axis a main face has, a cylinder
 * along such a direction and tangent to a main face beside it, a torus about such an axis. Fewest
 * free numbers first.
 *
 * Offered only on what is left: a whole leftover piece, or a structure region or tree node inside
 * one, and only where the candidate's border runs on evidence (the mesh's, or a decided face's
 * edge). Held with inner points at the float precision, edge points within a share of its facets'
 * bow, and those edge points off it the way a CAD program's edge curve is: on one side, changing
 * smoothly from point to point, not scattered.
 */
export function designOn(m: Mesh, S: Structure, main: MainFace[], free: Uint8Array): MainFace[] {
  const nT = m.tri.length / 3;
  const owner = new Int32Array(nT).fill(-1);
  main.forEach((f, i) => f.tris.forEach((t) => (owner[t] = i)));
  const stampT = new Int32Array(nT).fill(-1);
  let stamp = 0;
  const made: MainFace[] = [];
  // The part's axes and directions: those of main faces only.
  const lines: { o: V3; a: V3 }[] = [];
  for (const f of main) {
    const s = f.surf;
    const ax = s.kind === 'cylinder' ? { o: s.o, a: s.a } : s.kind === 'cone' ? { o: s.apex, a: s.a } : s.kind === 'torus' ? { o: s.c, a: s.a } : null;
    if (!ax) continue;
    const a = normalize(ax.a);
    if (lines.some((l) => Math.abs(dot(l.a, a)) > Math.cos(SAME_AXIS) && norm(cross(sub(ax.o, l.o), l.a)) < 10 * S.tolEdge)) continue;
    lines.push({ o: ax.o, a });
  }
  const dirs: V3[] = [];
  for (const l of lines) if (!dirs.some((d) => Math.abs(dot(d, l.a)) > Math.cos(SAME_AXIS))) dirs.push(l.a);
  const known = main.map((f) => f.surf);

  /** The share of a set's border on evidence; an edge against a decided face counts as evidence. */
  const onEvidence = (tris: number[], id: number): number => {
    let all = 0, seen = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w < 0 || stampT[w] === id) continue;
      const a = m.tri[t * 3 + k] * 3, b = m.tri[t * 3 + (k + 1) % 3] * 3;
      const l = Math.hypot(m.pos[a] - m.pos[b], m.pos[a + 1] - m.pos[b + 1], m.pos[a + 2] - m.pos[b + 2]);
      all += l;
      if (!free[w] || S.strength[t * 3 + k] >= EVIDENCE) seen += l;
    }
    return all ? seen / all : 1;
  };
  const facingOk = (s: Analytic, tris: number[]): boolean => {
    let sense = 0;
    for (const t of tris) sense += m.area[t] * dot(triNormal(m, t), normalAt(s, centreOf(m, t)));
    const sg = sense >= 0 ? 1 : -1;
    for (const t of tris) {
      if (sliver(m, t, S.tolPoint) || onAxis(m, s, t, S.tolPoint)) continue;
      if (sg * dot(triNormal(m, t), normalAt(s, centreOf(m, t))) < 0.5) return false;
    }
    return true;
  };
  const tangent = (c: Cylinder, tris: number[], id: number): boolean => {
    const seen = new Set<number>();
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w < 0 || stampT[w] === id || owner[w] < 0 || seen.has(owner[w])) continue;
      seen.add(owner[w]);
      const s = main[owner[w]].surf;
      const tol = Math.max(S.tolEdge, 1e-3 * c.r);
      if (s.kind === 'plane' && Math.abs(dot(s.n, c.a)) < Math.sin(SAME_AXIS) && Math.abs(Math.abs(dot(sub(c.o, s.o), s.n)) - c.r) <= tol) return true;
      if (s.kind === 'cylinder' && Math.abs(dot(s.a, c.a)) > Math.cos(SAME_AXIS)) {
        const d = norm(cross(sub(c.o, s.o), s.a));
        if (Math.abs(d - (c.r + s.r)) <= tol || Math.abs(d - Math.abs(c.r - s.r)) <= tol) return true;
      }
    }
    return false;
  };

  const tryOn = (tris: number[]): MainFace | null => {
    const id = stamp++;
    for (const t of tris) stampT[t] = id;
    if (onEvidence(tris, id) < BORDER_SHARE) return null;
    const innerVs: number[] = [], edgeVs: number[] = [];
    const seenV = new Set<number>();
    let longest = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = m.tri[t * 3 + k], w = m.tri[t * 3 + (k + 1) % 3];
      longest = Math.max(longest, norm(sub(vtx(m.pos, v), vtx(m.pos, w))));
      if (seenV.has(v)) continue;
      seenV.add(v);
      let all = true;
      for (const u of m.vertTris[v]) if (stampT[u] !== id) { all = false; break; }
      (all ? innerVs : edgeVs).push(v);
    }
    const allVs = [...innerVs, ...edgeVs];
    if (allVs.length < 6) return null;
    const cap = SAG_SHARE * longest;
    const sample = [allVs[0], allVs[allVs.length >> 1], allVs[allVs.length - 1]];
    const test = (s: Analytic | null, freeNumbers: number): MainFace | null => {
      if (!s || !finiteOf(s) || allVs.length < Math.max(6, UNPINNED_PER_NUMBER * freeNumbers)) return null;
      for (const v of sample) if (Math.abs(distance(s, vtx(m.pos, v))) > cap) return null;
      if (!holdsAll(m, s, innerVs, S.tolPoint)) return null;
      let sag = 0;
      for (const t of tris) sag = Math.max(sag, Math.abs(distance(s, centreOf(m, t))));
      const err = worstOff(m, s, edgeVs);
      if (err > Math.max(S.tolEdge, SAG_SHARE * sag)) return null;
      if (err > S.tolEdge && !hump(m, s, edgeVs, id, stampT, S.tolPoint)) return null;
      if (!holdsFacets(m, s, tris) || !facingOk(s, tris)) return null;
      return { tris, surf: s, err: Math.max(err, worstOff(m, s, innerVs)), tol: Math.max(err, S.tolEdge), from: 'design' };
    };
    for (const s of known) { const f = test(s, 0); if (f) return f; }
    for (const l of lines) { const f = test(cylinderAbout(m, l, allVs), 1); if (f) return f; }
    for (const l of lines) { const f = test(coneAbout(m, l, allVs), 2); if (f) return f; }
    for (const d of dirs) {
      const c = cylinderAlong(m, d, allVs);
      if (!c || !tangent(c, tris, id)) continue;
      const f = test(c, 3);
      if (f) return f;
    }
    for (const l of lines) { const f = test(torusAbout(m, l, allVs), 3); if (f) return f; }
    return null;
  };

  const claim = (f: MainFace) => { made.push(f); for (const t of f.tris) { free[t] = 0; owner[t] = -2; } };
  const nodes = treeIndex(S);
  // Each leftover piece: whole, else the structure's regions and tree nodes lying inside it, largest first.
  const left: number[] = [];
  for (let t = 0; t < nT; t++) if (free[t]) left.push(t);
  const pieceOf = new Int32Array(nT).fill(-1);
  const parts = pieces(m, left);
  parts.forEach((p, i) => p.forEach((t) => (pieceOf[t] = i)));
  parts.forEach((p, pi) => {
    if (p.length < 3) return;
    const f = tryOn(p);
    if (f) { claim(f); return; }
    const regs = new Set<number>();
    for (const t of p) regs.add(S.regionOf[t]);
    for (const r of [...regs].sort((a, b) => S.regions[b].length - S.regions[a].length)) {
      const stack = [S.tree.nodeOf[r]];
      while (stack.length) {
        const n = stack.pop()!;
        const all = n === S.tree.nodeOf[r] ? S.regions[r] : nodes.tris(n);
        const tris = all.filter((t) => free[t] && pieceOf[t] === pi);
        if (tris.length >= 3 && tris.length === all.length) {
          const g = tryOn(tris);
          if (g) { claim(g); continue; }
        }
        if (n >= S.tree.nLeaf && tris.length >= 3) stack.push(S.tree.kids[2 * (n - S.tree.nLeaf)], S.tree.kids[2 * (n - S.tree.nLeaf) + 1]);
      }
    }
  });
  return made;
}

/**
 * Whether a face's edge points sit off it the way a CAD program's edge curve does: a smooth hump
 * along each border, not scatter. Over the points off by more than twice the float precision: they
 * lie on one side of the surface (HUMP_SIDE of them), and from one edge point to the next along the
 * border the distance changes by less than HUMP_STEP of its typical size.
 */
export function hump(m: Mesh, s: Analytic, edgeVs: number[], id: number, stampT: Int32Array, tolPoint: number): boolean {
  const d = new Map<number, number>();
  for (const v of edgeVs) d.set(v, distance(s, vtx(m.pos, v)));
  let pos = 0, neg = 0, mag = 0;
  for (const x of d.values()) { if (Math.abs(x) <= 2 * tolPoint) continue; if (x > 0) pos++; else neg++; mag += Math.abs(x); }
  const off = pos + neg;
  const dbg = (globalThis as { __humpDebug?: (x: unknown) => void }).__humpDebug;
  if (!off) return true;
  mag /= off;
  // Steps along the border: mesh edges on the set's border (one side in it, one out).
  let step = 0, steps = 0;
  const seen = new Set<string>();
  for (const v of edgeVs) for (const t of m.vertTris[v]) {
    if (stampT[t] !== id) continue;
    for (let k = 0; k < 3; k++) {
      const a = m.tri[t * 3 + k], b = m.tri[t * 3 + (k + 1) % 3];
      const w = m.adj[t * 3 + k];
      if (w >= 0 && stampT[w] === id) continue;
      if (!d.has(a) || !d.has(b)) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      step += Math.abs(d.get(a)! - d.get(b)!);
      steps++;
    }
  }
  const side = Math.max(pos, neg) / off, rough = steps ? step / steps / mag : 0;
  if (dbg) dbg({ kind: s.kind, off, side, rough, mag });
  return side >= HUMP_SIDE && rough <= HUMP_STEP;
}
/** The share of off points that must lie on one side of the surface. */
const HUMP_SIDE = 0.8;
/** The most the distance may change from one edge point to the next along the border, as a share of its typical size. */
const HUMP_STEP = 0.5;
