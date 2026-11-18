// Turns labelled triangles into a boundary representation: faces bounded by loops of edges that
// meet at corners, every edge shared by exactly two faces.
//
// The topology comes from the mesh, not from intersecting surfaces: wherever two labels meet
// along mesh edges there is a B-rep edge, and wherever three or more meet there is a corner.
// The geometry comes from the surfaces. A corner is the point nearest all of its faces' surfaces.
// An edge is the curve its two surfaces meet in: the exact line or circle where two analytic
// surfaces have one, otherwise points on both surfaces (the border's points moved onto both, and
// more wherever a curve through them leaves either face) with one curve through them. Every
// curve is measured against both faces along its whole length before it is taken, at the one
// tolerance the file states; where the faces themselves do not meet, the closest curve is kept and
// its gap is left for the file check to report.

import { type V3, add, basis, cross, dist, dot, madd, maxOf, norm, normalize, scale, solve, sub } from './linalg';
import { type Mesh, triCentroid, triNormal, vtx } from './mesh';
import { type Region } from './segment';
import { compressKnots } from './bspline';
import { type Surface, fitPlane, normalAt } from './surfaces';
import { type Span, asWritten, circleThrough, exactMeet, interpolateBanded, offAll, offAxis, onAll, spanOf, worstOff } from './meet';
import { statedTolerance } from './check';
import { loopTrouble } from './loops';

export type Curve =
  | { kind: 'line'; o: V3; d: V3 }
  /** Circle in the plane through c normal to n; parameter 0 along ref, increasing counter-clockwise about n. */
  | { kind: 'circle'; c: V3; n: V3; ref: V3; r: number }
  | { kind: 'bspline'; degree: number; ctrl: V3[]; knots: number[]; mults: number[] };

/**
 * `points`: points of the edge on both faces, first and last its two vertices, in order.
 * `gap`: the furthest the curve was found off either face when it was made (mm).
 */
export type BEdge = { v0: number; v1: number; curve: Curve; faces: [number, number]; points: V3[]; gap?: number; alongBorder?: boolean };
export type OrientedEdge = { edge: number; fwd: boolean };
/** `within`: set on a face written as part of another (see buildBrep); it has no loops and is not written. */
export type BFace = { surf: Surface; sameSense: boolean; loops: OrientedEdge[][]; within?: number };
/**
 * `tolerance`: the uncertainty the file states, the gap every edge was made to meet or, where the
 * faces do not allow it, the gap actually met up to a ceiling (see `statedTolerance`).
 * `facets`: the mesh and each face's triangles, for checking sheets against what they replace.
 */
export type Brep = { vertices: V3[]; edges: BEdge[]; faces: BFace[]; tolerance?: number; facets?: { mesh: Mesh; tris: number[][] }; loops?: { redrawn: number; crossing: number[] } };

/** `progress`: told the share of the faces' borders that have their edges made (0 to 1), which is where the time goes. */
export function buildBrep(m: Mesh, given: Int32Array, regions: Region[], tol: number, progress: (share: number) => void = () => {}): Brep {
  let label = given;
  const nT = m.tri.length / 3;
  const T = m.tri;
  const isBoundary = (h: number) => {
    const w = m.adj[h];
    return w >= 0 && label[w] !== label[(h / 3) | 0];
  };
  const from = (h: number) => T[h];
  const to = (h: number) => T[((h / 3) | 0) * 3 + ((h % 3) + 1) % 3];
  const other = (h: number) => label[m.adj[h]];

  // Boundary degree per vertex: corners are where it is not 2.
  let degree = new Map<number, number>();
  const countDegree = () => {
    degree = new Map<number, number>();
    for (let h = 0; h < nT * 3; h++) if (isBoundary(h)) degree.set(from(h), (degree.get(from(h)) ?? 0) + 1);
  };
  countDegree();
  const isCorner = (v: number) => (degree.get(v) ?? 0) !== 2;

  /** The next boundary half-edge of the same face, turning about the end vertex inside the face. */
  const next = (h: number): number => {
    const f = label[(h / 3) | 0];
    const b = to(h);
    let t = (h / 3) | 0;
    let cur = t * 3 + ((h % 3) + 1) % 3;
    // Round the vertex once at most: a fan of any size.
    for (let guard = 0; guard <= m.vertTris[b].length + 1; guard++) {
      if (isBoundary(cur)) return cur;
      const c = to(cur);
      const w = m.adj[cur];
      if (w < 0 || label[w] !== f) return cur;
      let kk = 0;
      while (kk < 3 && !(T[w * 3 + kk] === c && T[w * 3 + ((kk + 1) % 3)] === b)) kk++;
      t = w;
      cur = w * 3 + ((kk + 1) % 3);
    }
    throw new Error('boundary walk did not close');
  };

  // Loops of boundary half-edges per face.
  const walkLoops = () => {
    const seen = new Uint8Array(nT * 3);
    const loops: number[][][] = regions.map(() => []);
    for (let h = 0; h < nT * 3; h++) {
      if (seen[h] || !isBoundary(h)) continue;
      const loop: number[] = [];
      let cur = h;
      while (!seen[cur]) { seen[cur] = 1; loop.push(cur); cur = next(cur); }
      loops[label[(h / 3) | 0]].push(loop);
    }
    return loops;
  };
  let faceLoops = walkLoops();
  // An island: a face whose one loop runs round a single other face and touches that face's
  // outline at a corner. The face round it then has a hole touching its own outline, which an
  // importer cannot place inside it: it cuts the hole off as a separate face, and the island and
  // that piece leave the solid. The island is written as part of the face round it.
  const area = (f: number) => regions[f].tris.reduce((a, t) => a + m.area[t], 0);
  const within = new Map<number, number>();
  faceLoops.forEach((loops, f) => {
    if (loops.length !== 1) return;
    const round = new Set(loops[0].map(other));
    if (round.size !== 1) return;
    const g = [...round][0];
    if (within.has(g) || !regions[g].surf || !loops[0].some((h) => isCorner(from(h))) || area(f) >= area(g)) return;
    within.set(f, g);
  });
  if (within.size) {
    label = Int32Array.from(given);
    for (const [f, g] of within) for (const t of regions[f].tris) label[t] = g;
    countDegree();
    faceLoops = walkLoops();
  }

  const vertexOf = new Map<number, number>();
  const vertices: V3[] = [];
  const edges: BEdge[] = [];
  const edgeOfMeshEdge = new Map<number, number>();
  /** Each edge's border in the mesh, its points in order. */
  const borders: V3[][] = [];
  // A mesh edge as one number, the same either way round (far below 2^53).
  const nV = m.pos.length / 3;
  const ukey = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);

  const facesAt = (v: number) => [...new Set(m.vertTris[v].map((t) => label[t]))];
  /** The shortest mesh edge at a vertex: how far a point there may be moved to put it on its surfaces. */
  const spacing = (v: number) => {
    let s = Infinity;
    const p = vtx(m.pos, v);
    for (const t of m.vertTris[v]) for (let k = 0; k < 3; k++) {
      const w = T[t * 3 + k];
      if (w !== v) s = Math.min(s, dist(p, vtx(m.pos, w)));
    }
    return s;
  };
  const cornerPoint = (v: number): number => {
    let id = vertexOf.get(v);
    if (id !== undefined) return id;
    const surfs = facesAt(v).map((f) => regions[f].surf!).filter(Boolean).map(asWritten);
    id = vertices.length;
    vertices.push(onAll(surfs, vtx(m.pos, v), reachFor(spacing(v))));
    vertexOf.set(v, id);
    return id;
  };

  // A sphere's poles are singular in its parametrisation: put them at right angles to its faces
  // (all of them together: faces on one sphere share it, and the file holds it once).
  const facing = new Map<Surface, V3>();
  for (const r of regions) {
    if (r.surf?.kind !== 'sphere') continue;
    let mean = facing.get(r.surf) ?? [0, 0, 0];
    for (const t of r.tris) mean = madd(mean, triNormal(m, t), m.area[t]);
    facing.set(r.surf, mean);
  }
  const poled = new Map<Surface, Surface>();
  for (const [s, mean] of facing) poled.set(s, { ...s, pole: basis(normalize(mean))[0] } as Surface);
  const faces: BFace[] = regions.map((r) => {
    let s = 0;
    for (const t of r.tris) s += m.area[t] * dot(triNormal(m, t), normalAt(r.surf!, triCentroid(m, t)));
    return { surf: poled.get(r.surf!) ?? r.surf!, sameSense: s >= 0, loops: [] };
  });
  for (const [f, g] of within) faces[f].within = g;

  // By length of border, not by face: one flat face can border thousands of small ones.
  const border = faceLoops.reduce((n, loops) => n + loops.reduce((k, loop) => k + loop.length, 0), 0) || 1;
  let walked = 0;
  regions.forEach((_, f) => {
    for (const loop of faceLoops[f]) {
      // Rotate so the loop starts at a corner (if it has one), then cut it at every corner.
      const start = loop.findIndex((h, i) => isCorner(from(h)) || other(h) !== other(loop[(i + loop.length - 1) % loop.length]));
      const hs = start > 0 ? [...loop.slice(start), ...loop.slice(0, start)] : loop;
      const chains: number[][] = [];
      for (const h of hs) {
        const last = chains[chains.length - 1];
        if (!last || isCorner(from(h)) || other(h) !== other(last[last.length - 1])) chains.push([h]);
        else last.push(h);
      }
      const oriented: OrientedEdge[] = [];
      for (const chain of chains) {
        progress(walked / border);
        walked += chain.length;
        const key = ukey(from(chain[0]), to(chain[0]));
        const known = edgeOfMeshEdge.get(key);
        if (known !== undefined) {
          // Seen from the other face: the same mesh edges, walked the opposite way.
          oriented.push({ edge: known, fwd: false });
          continue;
        }
        const g = other(chain[0]);
        const vs = [from(chain[0]), ...chain.map(to)];
        const closed = vs[0] === vs[vs.length - 1];
        const v0 = cornerPoint(vs[0]);
        const v1 = closed ? v0 : cornerPoint(vs[vs.length - 1]);
        const chainPts = vs.map((v) => vtx(m.pos, v));
        const made = edgeBetween(asWritten(regions[f].surf!), asWritten(regions[g].surf!), chainPts, vertices[v0], vertices[v1], closed, tol);
        const id = edges.length;
        borders.push(chainPts);
        edges.push({ v0, v1, curve: made.curve, faces: [f, g], points: made.points, gap: made.gap });
        for (const h of chain) edgeOfMeshEdge.set(ukey(from(h), to(h)), id);
        oriented.push({ edge: id, fwd: true });
      }
      faces[f].loops.push(oriented);
    }
  });
  for (const f of faces) f.loops = f.loops.flatMap((loop) => unpinch(loop, edges));
  untangle(edges, faces, vertices, borders);
  const loops = simpleLoops(edges, faces, vertices, borders);
  const tris: number[][] = regions.map(() => []);
  for (let t = 0; t < nT; t++) tris[label[t]].push(t);
  const brep: Brep = { vertices, edges, faces, facets: { mesh: m, tris }, loops };
  brep.tolerance = statedTolerance(brep, tol);
  return brep;
}

/** Samples per edge when looking for edges that cross. */
const CROSS_SAMPLES = 24;
/** Two edges of one face nearer than this (mm), and than half as near as their borders in the mesh, are taken to cross. */
const CROSSING = 0.02;

/**
 * Where the faces do not meet as the mesh says (a needle of a face, a sheet that swings across
 * its neighbour), the curves the surfaces meet in can cross another edge of the same face, and an
 * importer refuses a face whose loop crosses itself. Two edges of one face that come much nearer
 * each other than their borders in the mesh do (away from a corner they share) are both drawn
 * along their borders instead, between their corners: such a face is closed and valid, and the
 * file check reports how far those edges stand off the faces.
 */
function untangle(edges: BEdge[], faces: BFace[], vertices: V3[], borders: V3[][]): void {
  const drawn = edges.map((e) => {
    const sp = spanOf(e.curve, vertices[e.v0], vertices[e.v1], e.v0 === e.v1);
    return Array.from({ length: CROSS_SAMPLES + 1 }, (_, k) => sp.at(sp.t0 + ((sp.t1 - sp.t0) * k) / CROSS_SAMPLES));
  });
  const box = (pts: V3[]) => {
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p[d]); hi[d] = Math.max(hi[d], p[d]); }
    return { lo, hi };
  };
  const boxes = drawn.map(box);
  const redo = new Set<number>();
  for (const f of faces) {
    const ids = [...new Set(f.loops.flat().map((oe) => oe.edge))];
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const i = ids[x], j = ids[y];
      const A = boxes[i], B = boxes[j];
      if (A.lo.some((v, d) => v > B.hi[d] + CROSSING) || B.lo.some((v, d) => v > A.hi[d] + CROSSING)) continue;
      const shared = [edges[i].v0, edges[i].v1].filter((v) => v === edges[j].v0 || v === edges[j].v1).map((v) => vertices[v]);
      const curves = nearest(drawn[i], drawn[j], shared);
      if (curves >= CROSSING) continue;
      if (curves < 0.5 * nearest(borders[i], borders[j], shared)) { redo.add(i); redo.add(j); }
    }
  }
  for (const i of redo) alongBorder(edges, vertices, borders, i);
}

/**
 * A loop that passes one corner twice (a face that wraps round a sliver of another face, touching
 * itself at a corner) written as the separate closed loops it is made of, cut at that corner.
 */
function unpinch(loop: OrientedEdge[], edges: BEdge[]): OrientedEdge[][] {
  const start = (oe: OrientedEdge) => (oe.fwd ? edges[oe.edge].v0 : edges[oe.edge].v1);
  const out: OrientedEdge[][] = [];
  let rest = loop;
  for (;;) {
    const at = new Map<number, number>();
    let cut: [number, number] | null = null;
    for (let i = 0; i < rest.length && !cut; i++) {
      const v = start(rest[i]);
      const j = at.get(v);
      if (j !== undefined) cut = [j, i];
      else at.set(v, i);
    }
    if (!cut) break;
    out.push(rest.slice(cut[0], cut[1]));
    rest = [...rest.slice(0, cut[0]), ...rest.slice(cut[1])];
  }
  out.push(rest);
  return out;
}

/**
 * Straight pieces through an edge's points, keeping only the points that move on along its border
 * in the mesh (each one further along it than the last kept): the points are on both faces, so
 * what is left is too, without the back-steps that make the curve cross itself. False when the
 * edge is not straight pieces or nothing is dropped.
 */
function untwist(edges: BEdge[], borders: V3[][], i: number): boolean {
  const e = edges[i], c = e.curve;
  if (c.kind !== 'bspline' || c.degree !== 1) return false;
  const b = borders[i];
  const at: number[] = [0];
  for (let k = 1; k < b.length; k++) at.push(at[k - 1] + dist(b[k], b[k - 1]));
  const along = (p: V3) => {
    let best = Infinity, s = 0;
    for (let k = 0; k + 1 < b.length; k++) {
      const d = sub(b[k + 1], b[k]), L2 = dot(d, d);
      const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, b[k]), d) / L2)) : 0;
      const q = dist(p, madd(b[k], d, t));
      if (q < best) { best = q; s = at[k] + t * Math.sqrt(L2); }
    }
    return s;
  };
  const pts = c.ctrl, kept: V3[] = [pts[0]];
  let last = -Infinity;
  for (let k = 1; k + 1 < pts.length; k++) {
    const s = along(pts[k]);
    if (s > last) { kept.push(pts[k]); last = s; }
  }
  kept.push(pts[pts.length - 1]);
  if (kept.length === pts.length) return false;
  edges[i] = { ...e, curve: polyline(kept), points: kept };
  return true;
}

/** An edge drawn along its border in the mesh, between its two corners. */
function alongBorder(edges: BEdge[], vertices: V3[], borders: V3[][], i: number): void {
  const e = edges[i], b = borders[i];
  const pts = [vertices[e.v0], ...b.slice(1, -1), vertices[e.v1]];
  edges[i] = { ...e, curve: polyline(pts), points: pts, gap: undefined, alongBorder: true };
}

/** The most edges a loop touching another loop at a corner may have to be drawn along the mesh (a sliver's few edges, not a face's whole outline). */
const PINCHED_LOOP = 2;

/** Rounds of redrawing edges whose faces' loops still cross. */
const LOOP_ROUNDS = 6;

/**
 * Every face's loops made simple in the face's own parameters, which is where an importer trims
 * it (see loops.ts): an edge taking part in a crossing is drawn along its border in the mesh
 * instead, and the faces on both its sides are tested again. A face whose loops still cross after
 * that is reported, never hidden.
 */
function simpleLoops(edges: BEdge[], faces: BFace[], vertices: V3[], borders: V3[][]): { redrawn: number; crossing: number[] } {
  let test: Iterable<number> = faces.map((_, i) => i);
  let redrawn = 0;
  // A face whose loops touch at a corner (it wraps round another face's sliver there): an
  // importer decides which loop is inside which by the curves, and a bent curve a hair from its
  // neighbour can put the sliver outside the face. Drawn along the mesh, the loops are the mesh's.
  for (const f of faces) {
    if (f.loops.length < 2) continue;
    const starts = f.loops.map((loop) => new Set(loop.map((oe) => (oe.fwd ? edges[oe.edge].v0 : edges[oe.edge].v1))));
    f.loops.forEach((loop, a) => {
      if (!starts.some((other, b) => b !== a && [...starts[a]].some((v) => other.has(v)))) return;
      for (const oe of loop) if (!edges[oe.edge].alongBorder && f.loops[a].length <= PINCHED_LOOP) { alongBorder(edges, vertices, borders, oe.edge); redrawn++; }
    });
  }
  // Of two edges that cross, the one further off its faces (or not yet drawn along the mesh) is
  // redrawn first: drawing an edge along the mesh costs it its place on the faces, so as few as
  // can be are.
  const selfCrossing = new Set<number>(), untwisted = new Set<number>(), straightened = new Set<number>();
  const worse = (a: number, b: number) => {
    if (a === b) selfCrossing.add(a);
    const A = edges[a], B = edges[b];
    if (!!A.alongBorder !== !!B.alongBorder) return A.alongBorder ? b : a;
    return (A.gap ?? 0) >= (B.gap ?? 0) ? a : b;
  };
  const still = new Set<number>();
  let untested = true;
  for (let round = 0; round < LOOP_ROUNDS; round++) {
    const list = [...test];
    untested = false;
    const redo = new Set<number>();
    const bad = loopTrouble(edges, faces, vertices, borders, list, worse);
    for (const f of list) still.delete(f);
    for (const [f, set] of bad) { still.add(f); for (const e of set) if (!edges[e].alongBorder) redo.add(e); }
    if (!redo.size) break;
    const again = new Set<number>();
    for (const e of redo) {
      // Straight pieces that cross themselves (points that step back along the edge) first lose
      // the points that step back; drawn along the mesh only if that is not enough.
      // A curve through points on both faces that crosses is first made straight pieces through
      // those same points (still on both faces, and unable to swing between them).
      const c = edges[e].curve;
      if (!straightened.has(e) && c.kind !== 'line' && !(c.kind === 'bspline' && c.degree === 1) && edges[e].points.length >= 2) {
        straightened.add(e);
        edges[e] = { ...edges[e], curve: polyline(edges[e].points) };
      } else if (selfCrossing.has(e) && !untwisted.has(e) && untwist(edges, borders, e)) untwisted.add(e);
      else { alongBorder(edges, vertices, borders, e); redrawn++; }
      again.add(edges[e].faces[0]); again.add(edges[e].faces[1]);
    }
    selfCrossing.clear();
    test = again;
    untested = true;
  }
  // The faces redrawn last, tested once more.
  if (untested) {
    const list = [...test];
    for (const f of list) still.delete(f);
    for (const [f] of loopTrouble(edges, faces, vertices, borders, list, worse)) still.add(f);
  }
  return { redrawn, crossing: [...still].sort((a, b) => a - b) };
}

/** How near two runs of points come, as straight pieces, away from the corners they share (mm). */
function nearest(p: V3[], q: V3[], shared: V3[]): number {
  const length = (r: V3[]) => r.reduce((s, x, k) => (k ? s + dist(x, r[k - 1]) : 0), 0);
  // Near a shared corner the two always meet: a fifth of the shorter one is left out there.
  const keep = 0.2 * Math.min(length(p), length(q));
  const away = (a: V3, b: V3) => shared.every((c) => dist(a, c) > keep || dist(b, c) > keep);
  let best = Infinity;
  for (let i = 0; i + 1 < p.length; i++) {
    if (!away(p[i], p[i + 1])) continue;
    for (let j = 0; j + 1 < q.length; j++) {
      if (!away(q[j], q[j + 1])) continue;
      best = Math.min(best, segments(p[i], p[i + 1], q[j], q[j + 1]));
    }
  }
  return best;
}

/** The distance between two straight pieces (mm). */
function segments(a: V3, b: V3, c: V3, d: V3): number {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const A = dot(u, u), B = dot(u, v), C = dot(v, v), D = dot(u, w), E = dot(v, w);
  const den = A * C - B * B;
  let s = den > 1e-18 ? Math.max(0, Math.min(1, (B * E - C * D) / den)) : 0;
  let t = C > 1e-18 ? (B * s + E) / C : 0;
  if (t < 0) { t = 0; s = A > 1e-18 ? Math.max(0, Math.min(1, -D / A)) : 0; }
  else if (t > 1) { t = 1; s = A > 1e-18 ? Math.max(0, Math.min(1, (B - D) / A)) : 0; }
  return dist(madd(a, u, s), madd(c, v, t));
}

/** How far a point may be moved onto its surfaces: half the mesh's spacing there, and never less than this (mm). */
const LEAST_REACH = 0.05;
const reachFor = (spacing: number) => Math.max(LEAST_REACH, 0.5 * (Number.isFinite(spacing) ? spacing : 0));

/** Border points an edge starts from, at most (more are added wherever the curve needs them). */
const START_POINTS = 40;
/** Rounds of adding points where a curve leaves a face, and the most points one edge may have. */
const REFINE_ROUNDS = 14, MOST_POINTS = 2000;
/** The shortest piece that is cut again where the faces do not meet (mm): past it, points only pile up. */
const SHORTEST_PIECE = 0.05;
/** A border point the chain turns this sharply at is always kept: it is a real turn of the edge. */
const SHARP = (45 * Math.PI) / 180;

/**
 * The curve two faces meet in along a border of the mesh (`chain`, mesh points in order, first
 * and last at the corners `a` and `b`), and the points of it on both surfaces. The first curve
 * that holds both faces within `tol` from end to end is taken: the exact line or circle the two
 * surfaces meet in, a line or circle through the points, a smooth curve through them, straight
 * pieces through them. Where none does, the one with the smallest gap.
 */
function edgeBetween(sf: Surface, sg: Surface, chain: V3[], a: V3, b: V3, closed: boolean, tol: number): { curve: Curve; points: V3[]; gap: number } {
  const surfs = [sf, sg];
  const off = (p: V3) => offAll(surfs, p);
  // Along the curve, and its ends against the corners it joins (an exact curve may miss them).
  // `over`: a curve known to be worse than that is not measured to the end (a candidate that can
  // neither hold the faces nor beat the best so far needs no exact gap).
  const measure = (c: Curve, over = Infinity) => {
    const sp = spanOf(c, a, b, closed);
    const ends = Math.max(dist(sp.at(sp.t0), a), dist(sp.at(sp.t1), b));
    if (ends > over) return ends;
    return Math.max(worstOff(sp, off, undefined, over).gap, ends);
  };

  // Points on both faces, a few along the border to start from.
  const pick = startPoints(chain);
  const inner: V3[] = [];
  let moved = 0;
  for (const i of pick) {
    const spacing = Math.min(dist(chain[i], chain[i - 1]), dist(chain[i], chain[i + 1]));
    const q = onAll(surfs, chain[i], reachFor(spacing));
    moved = Math.max(moved, dist(q, chain[i]));
    inner.push(q);
  }
  const pts = smoothBorder([a, ...inner, b], surfs, off, tol);

  // A curve that holds both faces is where they meet, however far that is from a coarse mesh's
  // border. One that does not is kept near the border it stands for: where the faces do not meet,
  // the point nearest both can lie far from the mesh, and a curve through such points may cross
  // the face's other edges.
  const limit = Math.max(2 * LEAST_REACH, 2 * Math.max(moved, dist(a, chain[0]), dist(b, chain[chain.length - 1])));
  let best: { curve: Curve; points: V3[]; gap: number } | null = null;
  const take = (curve: Curve, points: V3[], gap = measure(curve, Math.max(tol, best ? best.gap : Infinity))): boolean => {
    if (gap > tol && strays(spanOf(curve, a, b, closed), chain) > limit) return false;
    if (!best || gap < best.gap) best = { curve, points, gap };
    return gap <= tol;
  };

  // The exact curve, where it runs through the border's points (not a far branch of the same pair).
  const reach = Math.max(LEAST_REACH, 4 * moved);
  for (const c of exactMeet(sf, sg, pts, a, closed)) {
    if (!pts.every((p) => offCurve(c, p) <= reach)) continue;
    if (take(c, pts)) return best!;
  }
  // A line or circle through the points.
  if (!closed && dist(a, b) > tol) {
    const d = normalize(sub(b, a));
    if (maxOf(pts.map((p) => offAxis(p, a, d))) <= tol && take({ kind: 'line', o: a, d }, pts)) return best!;
  }
  if (pts.length >= 3) {
    const c = fittedCircle(pts, tol);
    if (c && take(c, pts)) return best!;
  }
  // Straight pieces, refined until they stay on both faces: halving them always brings them
  // closer where the faces meet. Then one smooth curve through their points, evenly spread so it
  // does not swing between them, which is what is written when it holds: an importer has to
  // rebuild a kinked curve on each face, and does that badly. Straight pieces only when they
  // hold the faces and the smooth curve does not, or, where the faces do not meet, when they come
  // far closer.
  const straight = refined(pts, surfs, off, tol);
  const straightGap = measure(straight.curve);
  const smooth = smoothThrough(straight.points, surfs, measure, tol);
  const smoothGap = smooth ? smooth.gap : Infinity;
  if (smooth && smoothGap <= tol && take(smooth.curve, smooth.points, smoothGap)) return best!;
  if (straightGap <= tol || straightGap < 0.5 * smoothGap) take(straight.curve, straight.points, straightGap);
  if (smooth) take(smooth.curve, smooth.points, smoothGap);
  if (!best) take(straight.curve, straight.points, straightGap);
  if (!best) {
    const through = polyline(pts);
    best = { curve: through, points: pts, gap: measure(through) };
  }
  return best!;
}

/** The furthest a curve runs from a border of the mesh (mm), at a few dozen points along it. */
function strays(sp: Span, chain: V3[]): number {
  let worst = 0;
  const n = 32;
  for (let k = 0; k <= n; k++) {
    const p = sp.at(sp.t0 + ((sp.t1 - sp.t0) * k) / n);
    let near = Infinity;
    for (let i = 0; i + 1 < chain.length && near > worst; i++) near = Math.min(near, toSegment(p, chain[i], chain[i + 1]));
    if (chain.length === 1) near = dist(p, chain[0]);
    if (near > worst) worst = near;
  }
  return worst;
}

/** Distance from a point to a straight piece (mm). */
function toSegment(p: V3, a: V3, b: V3): number {
  const d = sub(b, a), L2 = dot(d, d);
  const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / L2)) : 0;
  return dist(p, madd(a, d, t));
}

/** Indices of the border points to start from: evenly along the chain, and every sharp turn. */
function startPoints(chain: V3[]): number[] {
  const n = chain.length;
  if (n <= 2) return [];
  const keep = new Set<number>();
  const every = Math.max(1, (n - 1) / (START_POINTS + 1));
  for (let k = every; k < n - 1; k += every) keep.add(Math.round(k));
  for (let i = 1; i + 1 < n; i++) {
    const u = sub(chain[i], chain[i - 1]), w = sub(chain[i + 1], chain[i]);
    const c = dot(u, w) / (norm(u) * norm(w) || 1);
    if (Math.acos(Math.max(-1, Math.min(1, c))) >= SHARP) keep.add(i);
  }
  keep.delete(0);
  keep.delete(n - 1);
  return [...keep].sort((x, y) => x - y);
}

/** Distance from a line or circle (mm); 0 for a B-spline, which is only ever made through its points. */
function offCurve(c: Curve, p: V3): number {
  if (c.kind === 'line') return offAxis(p, c.o, c.d);
  if (c.kind === 'circle') {
    const d = sub(p, c.c), h = dot(d, c.n);
    return Math.hypot(h, norm(madd(d, c.n, -h)) - c.r);
  }
  return 0;
}

/**
 * Straight pieces through points on both faces, refined: wherever a piece leaves either face by
 * more than the tolerance, its worst place is moved onto both surfaces and added, until none does,
 * or no point there is on both faces (faces that do not meet there).
 */
function refined(start: V3[], surfs: Surface[], off: (p: V3) => number, tol: number): { curve: Curve; points: V3[] } {
  let pts = start;
  let curve = polyline(pts);
  for (let round = 0; round <= REFINE_ROUNDS; round++) {
    curve = polyline(pts);
    if (round === REFINE_ROUNDS || pts.length >= MOST_POINTS) break;
    // Each stretch between two points sampled on its own, by its length.
    const sp = spanOf(curve, pts[0], pts[pts.length - 1], false);
    const u = chordParams(pts);
    const added: { after: number; p: V3 }[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const len = dist(pts[i], pts[i + 1]);
      const k = Math.min(16, Math.max(3, Math.ceil(len / 0.25)));
      let worst = 0, at: V3 | null = null;
      for (let j = 1; j <= k; j++) {
        const t = sp.t0 + (sp.t1 - sp.t0) * (u[i] + ((u[i + 1] - u[i]) * j) / (k + 1));
        const p = sp.at(t);
        const g = off(p);
        if (g > worst) { worst = g; at = p; }
      }
      if (worst <= tol || !at) continue;
      const q = onAll([...surfs, across(at, pts[i], pts[i + 1])], at, Math.max(LEAST_REACH, len));
      // A point on both faces always helps. One that is only much nearer them (faces that do not
      // meet there) helps too, down to pieces SHORTEST_PIECE long: the curve then follows the
      // closest the two faces come.
      const offq = off(q);
      if ((offq <= tol || (len > SHORTEST_PIECE && offq < 0.5 * worst)) && dist(q, pts[i]) > 1e-7 && dist(q, pts[i + 1]) > 1e-7) added.push({ after: i, p: q });
    }
    if (!added.length) break;
    const next: V3[] = [];
    let k = 0;
    for (let i = 0; i < pts.length; i++) {
      next.push(pts[i]);
      while (k < added.length && added[k].after === i) next.push(added[k++].p);
    }
    pts = next;
  }
  return { curve, points: pts };
}

/**
 * One smooth curve through points on both faces (in order, close together): first through a few
 * of them spread evenly along their length and moved onto both surfaces, then twice as many,
 * until the curve holds both faces or every point is used. The best one found.
 */
function smoothThrough(pts: V3[], surfs: Surface[], measure: (c: Curve, over?: number) => number, tol: number): { curve: Curve; points: V3[]; gap: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + dist(pts[i], pts[i - 1]));
  const L = s[n - 1];
  if (!(L > 0)) return null;
  let best: { curve: Curve; points: V3[]; gap: number } | null = null;
  const tryThrough = (q: V3[]) => {
    const c = cubic(q);
    if (!c) return false;
    const gap = measure(c, Math.max(tol, best ? best.gap : Infinity));
    if (!best || gap < best.gap) best = { curve: c, points: q, gap };
    return gap <= tol;
  };
  for (let m = Math.min(n - 1, Math.max(3, Math.ceil((n - 1) / 8))); m < n - 1; m = Math.min(n - 1, 2 * m)) {
    const q: V3[] = [pts[0]];
    let j = 0;
    for (let k = 1; k < m; k++) {
      const at = (L * k) / m;
      while (j + 2 < n && s[j + 1] < at) j++;
      const w = (at - s[j]) / Math.max(1e-12, s[j + 1] - s[j]);
      const p = madd(pts[j], sub(pts[j + 1], pts[j]), Math.min(1, Math.max(0, w)));
      q.push(onAll([...surfs, across(p, pts[j], pts[j + 1])], p, Math.max(1e-3, s[j + 1] - s[j])));
    }
    q.push(pts[n - 1]);
    if (tryThrough(q)) return best;
  }
  tryThrough(pts);
  return best;
}

/** Chord-length parameters of points on [0, 1], as the curves through them use. */
function chordParams(pts: V3[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + Math.max(1e-12, dist(pts[i], pts[i - 1])));
  const L = u[u.length - 1];
  return u.map((x, i) => (i === u.length - 1 ? 1 : x / L));
}

/** The cubic through the points (lower degree for fewer than four). */
function cubic(pts: V3[]): Curve | null {
  if (pts.length < 3) return polyline(pts);
  const c = interpolateBanded(pts);
  if (!c) return null;
  return { kind: 'bspline', degree: c.degree, ctrl: c.ctrl, ...compressKnots(c.knots) };
}

/** Rounds of the slide in smoothBorder; each moves a point at most halfway to its neighbours. */
const SMOOTH_ROUNDS = 20;

/**
 * Where two faces meet nearly tangentially, the mesh vertices between them decide which side a
 * triangle falls on by a few microns, so the border staggers. The surfaces are that close there,
 * so the edge may slide across the band and run smooth, as long as it stays on both within the
 * tolerance. A lone sharp turn with straight runs either side is a real corner of a face and stays
 * where it is.
 */
function smoothBorder(pts: V3[], surfs: Surface[], off: (p: V3) => number, band: number): V3[] {
  const n = pts.length;
  if (n < 5) return pts;
  const turn = (i: number) => {
    const a = normalize(sub(pts[i], pts[i - 1])), b = normalize(sub(pts[i + 1], pts[i]));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  };
  const deg = (x: number) => (x * Math.PI) / 180;
  const turns = pts.map((_, i) => (i === 0 || i === n - 1 ? 0 : turn(i)));
  const fixed = turns.map((t, i) => i === 0 || i === n - 1 || (t >= deg(60) && turns[i - 1] < deg(20) && turns[i + 1] < deg(20)));
  if (!turns.some((t, i) => t >= deg(30) && !fixed[i])) return pts;
  // Never further than the points' own spacing here: this tidies a border, it does not move one.
  const reach = pts.map((_, i) => (i === 0 || i === n - 1 ? 0 : 1.5 * Math.max(dist(pts[i], pts[i - 1]), dist(pts[i], pts[i + 1]))));
  const out = pts.map((p) => [...p] as V3);
  for (let round = 0; round < SMOOTH_ROUNDS; round++) for (let i = 1; i + 1 < n; i++) {
    if (fixed[i]) continue;
    const mid: V3 = [0, 1, 2].map((d) => 0.5 * out[i][d] + 0.25 * (out[i - 1][d] + out[i + 1][d])) as V3;
    const q = onAll(surfs, mid, reach[i]);
    if (off(q) <= Math.max(band, off(out[i])) && dist(q, pts[i]) <= reach[i]) out[i] = q;
  }
  return out;
}

/** A circle through the points when they lie in a plane and on one (within tol), not one so wide it is all but a line. */
function fittedCircle(pts: V3[], tol: number): Curve | null {
  const pl = fitPlane(pts);
  if (maxOf(pts.map((p) => Math.abs(dot(sub(p, pl.o), pl.n)))) > tol) return null;
  const c = circleIn(pts, pl.n, pl.o);
  // Points all but in a line fit a circle too, a hundred metres wide, whose centre the last
  // digit of any of them moves by metres: no importer can trim a face by that.
  const a = pts[0];
  const reach = maxOf(pts.map((p) => dist(p, a)));
  if (!c || c.r > WIDEST_CIRCLE * reach || maxOf(pts.map((p) => Math.abs(dist(p, c.c) - c.r))) > tol) return null;
  return circleThrough(c.c, pl.n, c.r, pts, a);
}

/** The widest a circle may be for the edge that shows it, as a multiple of how far the edge reaches: an arc of half a degree. */
const WIDEST_CIRCLE = 100;

/** Straight pieces through the points: a degree-1 B-spline with a knot at each. */
function polyline(pts: V3[]): Curve {
  const u: number[] = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + Math.max(1e-12, dist(pts[i], pts[i - 1])));
  const L = u[u.length - 1];
  return { kind: 'bspline', degree: 1, ctrl: pts, ...compressKnots([0, ...u.map((x) => x / L), 1]) };
}

function circleIn(pts: V3[], n: V3, o: V3): { c: V3; r: number } | null {
  const t: V3 = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0];
  const e1 = normalize(cross(t, n)), e2 = cross(n, e1);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (const p of pts) {
    const q = sub(p, o);
    const x = dot(q, e1), y = dot(q, e2);
    const row = [x, y, 1];
    for (let i = 0; i < 3; i++) {
      b[i] -= row[i] * (x * x + y * y);
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j];
    }
  }
  const s = solve(A, b);
  if (!s) return null;
  const cx = -s[0] / 2, cy = -s[1] / 2;
  const r2 = cx * cx + cy * cy - s[2];
  if (!(r2 > 0)) return null;
  return { c: add(o, add(scale(e1, cx), scale(e2, cy))), r: Math.sqrt(r2) };
}

/**
 * The plane through p square to the stretch from a to b: a point moved onto both faces within it
 * stays between a and b, in order along the edge, however the edge turns.
 */
function across(p: V3, a: V3, b: V3): Surface {
  const d = sub(b, a);
  return { kind: 'plane', o: p, n: norm(d) > 1e-12 ? normalize(d) : [0, 0, 1] };
}
