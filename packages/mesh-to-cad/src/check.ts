// What a CAD program will make of the file, read from the solid itself.
//
// The preview draws each face from its own STL triangles moved onto its surface, so it always
// looks closed and trimmed. An importer works from the file's edges instead: an edge that does
// not lie on both of its faces is a gap it has to close, and a face whose surface it cannot trim
// to that edge's loop is shown whole (a torus round a small corner shows as the whole ring). So
// every edge is measured against both faces' surfaces along its whole length, the way an importer
// samples it (densely, between its vertices, on the curve as written), every corner against all
// the faces round it, every free-form sheet against the triangles it replaces between their
// points; and the surfaces an importer is known to choke on are named.

import { type V3, dist } from './linalg';
import { surfaceHit } from './bspline';
import { type Mesh, triVerts, vtx } from './mesh';
import { facetAllowance } from './sheetcheck';
import { asWritten, blendPlaces, nearestOnSheet, offAll, offOne, onAll, spanOf, worstOff } from './meet';
import { type Surface } from './surfaces';
import { type Brep } from './topology';

/** One place where the solid does not close: an edge or a corner standing off a face. */
export type GapSpot = {
  /** 'edge' or 'corner'. */
  kind: string;
  /** The edge or vertex index in the solid. */
  index: number;
  /** The faces it should lie on. */
  faces: number[];
  /** Where (mm). */
  at: [number, number, number];
  /** How far off the farther face (mm). */
  gap: number;
  /**
   * The least gap any curve could have there: how far off the farther face the point nearest all
   * of the faces stands. Near `gap`, the faces themselves do not meet; far below it, the edge is
   * what is wrong.
   */
  least?: number;
};

export type FileCheck = {
  faces: number;
  /** Faces written as free-form sheets (B-splines): what a person cannot edit by its numbers. */
  sheets: number;
  /** Edges standing off one of their faces by more than the tolerance the file states. */
  gaps: number;
  /** Edges standing off one of their faces by more than 0.01 mm. */
  wideGaps: number;
  /** The furthest any edge stands off one of its faces (mm), measured along its whole length. */
  worstGap: number;
  /** Surfaces an importer may refuse or fail to trim: a torus that crosses itself, a radius far larger than its face. */
  oddSurfaces: number;
  /** Faces smaller than a hundredth of a square millimetre. */
  slivers: number;
  /** One short line for each kind of trouble found, worst first. */
  notes: string[];
  /** The uncertainty the file states (mm). */
  tolerance?: number;
  /** Edges standing off a face by more than the tolerance the solid was built to (the least the file states). */
  overTarget?: number;
  /** Corners standing off one of their faces by more than the stated tolerance, and the furthest (mm). */
  looseCorners?: number;
  worstCorner?: number;
  /**
   * The furthest a free-form sheet stands off the triangles it replaces, between their points (mm);
   * how many sheets stand further off than their triangles' own sag allows (the test the sheets are
   * accepted by, sheetcheck.ts), and the most any does beyond it (mm).
   */
  sheetOff?: number;
  sheetsOff?: number;
  sheetBeyond?: number;
  /** The worst places, worst first, at most WORST_LISTED. */
  worst?: GapSpot[];
  /** What the measuring cost (ms). */
  ms?: number;
};

/** A face this much larger in radius than across is one an importer can rarely trim. */
const HUGE = 50;
/** An edge further off than this is a gap a strict importer will not close (mm). */
const WIDE = 0.01;
/** How many of the worst places are listed. */
const WORST_LISTED = 20;

/** The solid measured: each edge's and each corner's gap, each face's stand-off from its triangles. */
export type Measure = { edgeGap: number[]; edgeAt: V3[]; edgeLength: number[]; cornerGap: number[]; cornerFaces: number[][]; sheetOff: number[]; sheetBeyond: number[]; ms: number };

const measured = new WeakMap<Brep, Measure>();

/**
 * Every edge sampled along its curve as the file writes it, from its first vertex to its last
 * (by its length and its pieces, with a floor, and the worst sample narrowed down), measured to
 * both its faces' surfaces; every vertex to the surfaces of all the faces round it; every sheet,
 * at points inside its triangles, to the sheet. Made once per solid.
 */
export function measure(b: Brep): Measure {
  const known = measured.get(b);
  if (known) return known;
  const t0 = performance.now();
  const surf = b.faces.map((f) => asWritten(f.surf));
  const edgeGap: number[] = [], edgeAt: V3[] = [], edgeLength: number[] = [];
  const cornerFaces: Set<number>[] = b.vertices.map(() => new Set<number>());
  for (const e of b.edges) {
    const [f, g] = e.faces;
    const sf = surf[f], sg = surf[g];
    const off = (p: V3) => {
      const x = offOne(sf, p, true), y = offOne(sg, p, true);
      const m = x > y ? x : y;
      return Number.isFinite(m) ? m : Infinity;
    };
    const sp = spanOf(e.curve, b.vertices[e.v0], b.vertices[e.v1], e.v0 === e.v1);
    const w = worstOff(sp, off);
    // The curve's own ends against the vertices the file joins it to.
    const ends = Math.max(dist(sp.at(sp.t0), b.vertices[e.v0]), dist(sp.at(sp.t1), b.vertices[e.v1]));
    edgeGap.push(Math.max(w.gap, ends));
    edgeAt.push(w.at);
    edgeLength.push(sp.length);
    for (const v of [e.v0, e.v1]) { cornerFaces[v].add(f); cornerFaces[v].add(g); }
  }
  const cornerGap = b.vertices.map((p, v) => {
    let gap = 0;
    for (const f of cornerFaces[v]) gap = Math.max(gap, offOne(surf[f], p, true));
    return Number.isFinite(gap) ? gap : Infinity;
  });
  const stood = b.faces.map((f, i) => (f.surf.kind === 'bspline' && b.facets && f.loops.length ? standOff(b.facets.mesh, b.facets.tris[i] ?? [], surf[i]) : { off: 0, beyond: -Infinity }));
  const sheetOff = stood.map((x) => x.off), sheetBeyond = stood.map((x) => x.beyond);
  const m: Measure = { edgeGap, edgeAt, edgeLength, cornerGap, cornerFaces: cornerFaces.map((s) => [...s]), sheetOff, sheetBeyond, ms: performance.now() - t0 };
  measured.set(b, m);
  return m;
}

/** Where the sheets' nearest-point searches write. */
const hit = surfaceHit();

/** Points inside a triangle a sheet is measured at, as weights of its corners: the middle and towards each corner. */
const INSIDE: [number, number, number][] = [[1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3], [1 / 2, 1 / 2, 0], [0, 1 / 2, 1 / 2], [1 / 2, 0, 1 / 2]];

/**
 * The furthest a surface stands off the triangles at points between their corners (mm), and the
 * furthest beyond what each triangle may (its own sag, as the sheets are accepted by: see
 * sheetcheck.ts), so the file check and the sheets' own test read one sheet the same way.
 */
function standOff(mesh: Mesh, tris: number[], s: Surface): { off: number; beyond: number } {
  let worst = 0, beyond = -Infinity;
  const allow = facetAllowance(mesh, tris);
  const p: V3 = [0, 0, 0];
  const sheet = s.kind === 'bspline' && !s.pipe ? s : null;
  const places = sheet?.places;
  for (let f = 0; f < tris.length; f++) {
    const t = tris[f];
    const [a, b, c] = triVerts(mesh, t);
    const A = vtx(mesh.pos, a), B = vtx(mesh.pos, b), C = vtx(mesh.pos, c);
    // A sheet is searched from where its corners were fitted, as the preview does.
    const uv = places ? [places.get(a), places.get(b), places.get(c)] : [];
    const known = uv.length === 3 && uv.every((x) => x !== undefined) ? (uv as [number, number][]) : null;
    for (const w of INSIDE) {
      for (let d = 0; d < 3; d++) p[d] = w[0] * A[d] + w[1] * B[d] + w[2] * C[d];
      let g: number;
      if (known && sheet) {
        const D = nearestOnSheet(sheet, p, blendPlaces(sheet, known, w), hit).d;
        g = Math.hypot(p[0] - D[0], p[1] - D[1], p[2] - D[2]);
      } else g = offOne(s, [p[0], p[1], p[2]], true);
      if (g > worst) worst = Number.isFinite(g) ? g : Infinity;
      if (g - allow[f] > beyond) beyond = Number.isFinite(g) ? g - allow[f] : Infinity;
    }
  }
  return { off: worst, beyond };
}

/**
 * The uncertainty the file should state. An importer treats two faces as joined along an edge
 * when the edge lies on both within the file's uncertainty. State less than the real gaps and it
 * sees open edges and opens the part as loose surfaces; state far more and it may merge or drop
 * features smaller than that. So: the tolerance the solid was built to where every edge and corner
 * meets it; otherwise the widest gap actually left, rounded up to 1, 2 or 5 in its decade, but
 * never past 0.01 mm (a strict importer's own limit) or a quarter of the shortest edge. A gap
 * past that is left loose, and the check says so.
 */
export function statedTolerance(b: Brep, target: number): number {
  const m = measure(b);
  let worst = 0, shortest = Infinity;
  for (const g of m.edgeGap) if (g > worst) worst = g;
  for (const g of m.cornerGap) if (g > worst) worst = g;
  for (const l of m.edgeLength) if (l > 1e-9 && l < shortest) shortest = l;
  if (!(worst > target)) return target;
  const ceiling = Math.max(target, Math.min(WIDE, shortest / 4));
  return Math.max(target, Math.min(ceiling, roundUp(worst)));
}

/** The next of 1, 2, 5, 10, 20... times a power of ten at or above x. */
function roundUp(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return x;
  const decade = Math.pow(10, Math.floor(Math.log10(x)));
  for (const k of [1, 2, 5, 10]) if (k * decade >= x * (1 - 1e-12)) return k * decade;
  return 10 * decade;
}

/**
 * The faces that keep the file from opening as a clean solid, by the same tests as `checkFile`:
 * on an edge or at a corner that does not meet them, with edges that cross on their own surface,
 * or on a surface a CAD program may draw whole (a torus crossing itself, a radius far beyond the
 * face). As indices into `b.faces`.
 */
export function unclosedFaces(b: Brep, tolerance: number): Set<number> {
  const m = measure(b);
  const stated = Math.max(tolerance, b.tolerance ?? tolerance);
  const bad = new Set<number>();
  b.edges.forEach((e, i) => { if (m.edgeGap[i] > stated) for (const f of e.faces) bad.add(f); });
  m.cornerGap.forEach((g, v) => { if (g > stated) for (const f of m.cornerFaces[v]) bad.add(f); });
  for (const f of b.loops?.crossing ?? []) bad.add(f);
  const across = b.faces.map(() => 0);
  const firstPoint: ([number, number, number] | null)[] = b.faces.map(() => null);
  for (const e of b.edges) for (const f of e.faces) for (const p of e.points) {
    const q = firstPoint[f];
    if (!q) firstPoint[f] = p;
    else across[f] = Math.max(across[f], dist(q, p));
  }
  b.faces.forEach((f, i) => {
    const s: Surface = f.surf;
    if (s.kind === 'torus' && s.R < s.r) { bad.add(i); return; }
    const radius = s.kind === 'cylinder' || s.kind === 'sphere' || s.kind === 'torus' ? s.r : 0;
    if (radius > HUGE * Math.max(across[i] * 2, 1e-3) && radius > 10) bad.add(i);
  });
  return bad;
}

export function checkFile(b: Brep, tolerance: number, faceArea: number[]): FileCheck {
  const m = measure(b);
  const stated = Math.max(tolerance, b.tolerance ?? tolerance);
  let gaps = 0, wideGaps = 0, worstGap = 0, overTarget = 0;
  const spots: GapSpot[] = [];
  b.edges.forEach((e, i) => {
    const g = m.edgeGap[i];
    worstGap = Math.max(worstGap, g);
    if (g > stated) gaps++;
    if (g > WIDE) wideGaps++;
    if (g > tolerance) overTarget++;
    if (g > stated) spots.push({ kind: 'edge', index: i, faces: [...e.faces], at: [...m.edgeAt[i]], gap: g });
  });
  let looseCorners = 0, worstCorner = 0;
  m.cornerGap.forEach((g, v) => {
    worstCorner = Math.max(worstCorner, g);
    if (g > stated) { looseCorners++; spots.push({ kind: 'corner', index: v, faces: m.cornerFaces[v], at: [...b.vertices[v]], gap: g }); }
  });
  spots.sort((x, y) => y.gap - x.gap);
  for (const s of spots.slice(0, WORST_LISTED)) {
    const surfs = s.faces.map((f) => asWritten(b.faces[f].surf));
    s.least = offAll(surfs, onAll(surfs, s.at, 1));
  }
  let sheetOff = 0, sheetsOff = 0, sheetBeyond = 0;
  m.sheetOff.forEach((s, i) => { sheetOff = Math.max(sheetOff, s); if (m.sheetBeyond[i] > 0) { sheetsOff++; sheetBeyond = Math.max(sheetBeyond, m.sheetBeyond[i]); } });

  // Each face's size: the widest its edges' points spread.
  const across = b.faces.map(() => 0);
  const firstPoint: ([number, number, number] | null)[] = b.faces.map(() => null);
  for (const e of b.edges) for (const f of e.faces) for (const p of e.points) {
    const q = firstPoint[f];
    if (!q) firstPoint[f] = p;
    else across[f] = Math.max(across[f], dist(q, p));
  }
  let oddSurfaces = 0, selfCrossing = 0;
  b.faces.forEach((f, i) => {
    const s: Surface = f.surf;
    if (s.kind === 'torus' && s.R < s.r) { oddSurfaces++; selfCrossing++; return; }
    // A torus's tube is what an importer has to trim: a thin round on a wide ring is an ordinary face.
    const radius = s.kind === 'cylinder' || s.kind === 'sphere' || s.kind === 'torus' ? s.r : 0;
    if (radius > HUGE * Math.max(across[i] * 2, 1e-3) && radius > 10) oddSurfaces++;
  });
  // Rounds written as one sheet each have a radius; only the true free-form faces count here.
  const sheets = b.faces.filter((f) => f.surf.kind === 'bspline' && !f.surf.pipe).length;
  const rounds = b.faces.filter((f) => f.surf.kind === 'bspline' && !!f.surf.pipe).length;
  const slivers = faceArea.filter((a) => a < 0.01).length;
  const mm = (x: number) => (x < 0.01 ? x.toFixed(4) : x.toFixed(3));
  const notes: string[] = [];
  if (gaps) notes.push(`${gaps} ${gaps === 1 ? 'edge does' : 'edges do'} not meet ${gaps === 1 ? 'its' : 'their'} faces (up to ${mm(worstGap)} mm): a CAD program may open it as surfaces, not a solid.`);
  if (looseCorners) notes.push(`${looseCorners} ${looseCorners === 1 ? 'corner is' : 'corners are'} off ${looseCorners === 1 ? 'its' : 'their'} faces (up to ${mm(worstCorner)} mm): the faces there do not come together.`);
  if (selfCrossing) notes.push(`${selfCrossing} ${selfCrossing === 1 ? 'torus crosses' : 'tori cross'} itself: a CAD program may refuse ${selfCrossing === 1 ? 'that face' : 'those faces'}.`);
  if (oddSurfaces - selfCrossing > 0) notes.push(`${oddSurfaces - selfCrossing} curved ${oddSurfaces - selfCrossing === 1 ? 'face is' : 'faces are'} far larger in radius than across: a CAD program may show the whole surface.`);
  if (sheetsOff) notes.push(`${sheetsOff} free-form ${sheetsOff === 1 ? 'face stands' : 'faces stand'} off the mesh between its points by more than its triangles' own curve allows (up to ${mm(sheetBeyond)} mm more).`);
  if (sheets) notes.push(`${sheets} free-form ${sheets === 1 ? 'face' : 'faces'}: smooth sheets with no radius to edit.`);
  if (rounds) notes.push(`${rounds} ${rounds === 1 ? 'round is' : 'rounds are'} one face from end to end (a full loop is two): smooth sheets, exact to the round's radius.`);
  const inside = b.faces.filter((f) => f.within !== undefined).length;
  if (inside) notes.push(`${inside} small ${inside === 1 ? 'face' : 'faces'} written as part of the face round ${inside === 1 ? 'it' : 'them'}: ${inside === 1 ? 'its' : 'their'} only border touched itself at a corner, which a CAD program cannot trim.`);
  const crossing = b.loops?.crossing.length ?? 0;
  if (crossing) notes.push(`${crossing} ${crossing === 1 ? 'face has' : 'faces have'} edges that cross on ${crossing === 1 ? 'its' : 'their'} own surface: a CAD program may cut ${crossing === 1 ? 'it' : 'them'} into pieces.`);
  if (slivers) notes.push(`${slivers} tiny ${slivers === 1 ? 'face' : 'faces'} under 0.01 mm².`);
  if (stated > tolerance && overTarget) notes.push(`${overTarget} ${overTarget === 1 ? 'edge meets' : 'edges meet'} ${overTarget === 1 ? 'its' : 'their'} faces only within ${mm(stated)} mm, so the file states that tolerance: most CAD programs close that.`);
  return {
    faces: b.faces.filter((f) => f.loops.length).length, sheets, gaps, wideGaps, worstGap, oddSurfaces, slivers, notes,
    tolerance: stated, overTarget, looseCorners, worstCorner, sheetOff, sheetsOff, sheetBeyond, worst: spots.slice(0, WORST_LISTED), ms: Math.round(m.ms),
  };
}
