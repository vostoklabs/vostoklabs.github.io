// Reading a part the way it was designed: the faces that prove their surface first, then every
// triangle that lies on one of those surfaces, then what is left read as whole pieces. No
// triangle is ever a face of its own because nothing else would take it.

import { type Mesh, triCentroid, triNormal, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions, fitTris } from './segment';
import { type Surface, distance, fitPlane, normalAt } from './surfaces';
import { cross, dot, norm, sub } from './linalg';

/** Vertices a face needs, at the least, before its surface is believed. */
const PROVEN_VERTS = { plane: 5, curved: 6 };
/** The largest leftover piece split into flat units for the joins to read. */
const SPLIT_MOST = 60;
/** Triangles a face needs, at the least, before its surface is believed. */
const PROVEN_TRIS = 3;

const vertsOf = (m: Mesh, tris: number[]) => {
  const s = new Set<number>();
  for (const t of tris) for (const v of triVerts(m, t)) s.add(v);
  return s;
};

/**
 * Whether a face shows its surface: enough triangles and points to pin it, on it within its
 * error. One or two triangles prove nothing: any three points are a plane, and the two triangles
 * of a strip across a round are flat too.
 */
export function proves(m: Mesh, f: Region): boolean {
  if (!f.surf || f.surf.kind === 'bspline') return false;
  if (f.surf.kind !== 'plane' && f.tris.length < PROVEN_TRIS) return false;
  const vs = vertsOf(m, f.tris);
  if (f.surf.kind === 'plane' && (f.tris.length <= PROVEN_TRIS || vs.size < PROVEN_VERTS.plane)) return smoothFlat(m, f.tris);
  if (vs.size < (f.surf.kind === 'plane' ? PROVEN_VERTS.plane : PROVEN_VERTS.curved)) return false;
  return shows(m, f.surf, vs) && holdsFacets(m, f.surf, f.tris);
}

/**
 * Whether the facets' edges stay on the surface between their corners, within the bow a facet
 * of that curve can have. A strip meshed with vertices only at its two ends fits a surface through
 * both ends that leaves it in between (a flat wall read as a torus through its two end sections).
 */
export function holdsFacets(m: Mesh, s: Surface, tris: number[]): boolean {
  if (s.kind === 'plane' || s.kind === 'bspline') return true;
  const r = s.kind === 'cylinder' || s.kind === 'sphere' || s.kind === 'torus' ? s.r : Infinity;
  const bound = Math.max(4e-4, Math.min(0.15 * r, 0.1));
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = vtx(m.pos, m.tri[t * 3 + k]), b = vtx(m.pos, m.tri[t * 3 + ((k + 1) % 3)]);
    if (Math.abs(distance(s, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])) > bound) return false;
  }
  return true;
}

/** Two facets turning less than this (as a cosine) lie in one plane. */
const EXACT_FLAT = 1 - 1e-12;
/**
 * The most a coarse mesher steps a round from one facet to the next (radians): a turn at least
 * this sharp is an edge of the design (a box's corner turns 90 degrees).
 */
const STEP_MOST = (30 * Math.PI) / 180;
/** Two flat pieces whose triangles are within this ratio in size are alike: facets of one strip. */
const STRIP_RATIO = 2;
/** The most triangles looked at when reading a neighbour's flat piece. */
const PIECE_MOST = 64;

/**
 * A flat of a few triangles is a face of its own (a box's side, a chamfer's straight, a groove's
 * flat) when every turn across its outline is sharp (an edge of the design), or meets triangles
 * cut to another size: the mesher cut a face of its own there (the first row of a stepped round
 * beside a box's large flat side). Any other turn, however slight, is a step of something curved:
 * every facet pair of a cylinder, a cone's fan or a round strip is two exactly coplanar triangles
 * too, and it meets the next facets, cut much the same size as its own, by the curve's own step
 * (a cone with a steep side turns only two degrees from one facet to the next).
 */
export function smoothFlat(m: Mesh, tris: number[]): boolean {
  const own = new Set(tris);
  const area = tris.reduce((a, t) => a + m.area[t], 0);
  // One triangle is any three points: a facet of a gently curved sheet meets its neighbours
  // smoothly too. Two or more in one plane, and big enough to be drawn, can be a face.
  if (tris.length < 2 || area < 0.05) return false;
  const sharp = Math.cos(STEP_MOST);
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0 || own.has(w)) continue;
    const turn = dot(triNormal(m, t), triNormal(m, w));
    if (turn >= EXACT_FLAT || turn <= sharp) continue;
    // The flat piece across the step (one triangle, if it lies in no plane with others), by the
    // size of its triangles against this one's.
    const other = flatPiece(m, w, own);
    const mine = area / tris.length, each = other.reduce((a, x) => a + m.area[x], 0) / other.length;
    if (Math.max(mine, each) < STRIP_RATIO * Math.min(mine, each)) return false;
  }
  return true;
}

/** The facets exactly in one plane with t, side by side, outside `not` (at most PIECE_MOST). */
function flatPiece(m: Mesh, t: number, not: Set<number>): number[] {
  const n0 = triNormal(m, t), o = vtx(m.pos, m.tri[t * 3]);
  const piece = [t], seen = new Set([t]);
  for (let i = 0; i < piece.length && piece.length < PIECE_MOST; i++) for (let k = 0; k < 3; k++) {
    const w = m.adj[piece[i] * 3 + k];
    if (w < 0 || seen.has(w) || not.has(w)) continue;
    seen.add(w);
    if (dot(triNormal(m, w), n0) < 1 - 1e-8) continue;
    if (triVerts(m, w).every((v) => { const p = vtx(m.pos, v); return Math.abs((p[0] - o[0]) * n0[0] + (p[1] - o[1]) * n0[1] + (p[2] - o[2]) * n0[2]) <= 1e-6 * (1 + Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2])); })) piece.push(w);
  }
  return piece;
}

/** The most a curved surface's radius may be, as a multiple of how far its points spread across it. */
const SHOWN = 20;

/**
 * Whether the points show the curve of the surface they were fitted to: a radius many times
 * wider than the points spread is a fit to something nearly flat (a 0.1 mm strip of wall read
 * as a torus with a 9.4 mm tube, a flat strip as a 228 mm cylinder), not a surface found.
 */
export function shows(m: Mesh, s: Surface, verts: Iterable<number>): boolean {
  if (s.kind !== 'cylinder' && s.kind !== 'torus' && s.kind !== 'sphere') return true;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const v of verts) {
    const p = vtx(m.pos, v);
    let q: [number, number, number];
    if (s.kind === 'sphere') q = p;
    else {
      const o = s.kind === 'cylinder' ? s.o : s.c;
      const d: [number, number, number] = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      const h = d[0] * s.a[0] + d[1] * s.a[1] + d[2] * s.a[2];
      const rad: [number, number, number] = [d[0] - h * s.a[0], d[1] - h * s.a[1], d[2] - h * s.a[2]];
      // A cylinder's section is its points seen down its axis; a torus's is (distance from the axis, height).
      q = s.kind === 'cylinder' ? rad : [Math.hypot(rad[0], rad[1], rad[2]), h, 0];
    }
    x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); z0 = Math.min(z0, q[2]);
    x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); z1 = Math.max(z1, q[2]);
  }
  return s.r <= SHOWN * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

/** Which way the face's triangles look along its surface's own normal (+1 or -1). */
function sense(m: Mesh, f: Region): number {
  let s = 0;
  for (const t of f.tris) s += m.area[t] * dot(triNormal(m, t), normalAt(f.surf!, triCentroid(m, t)));
  return s >= 0 ? 1 : -1;
}

/**
 * Proven faces keep their triangles; every other triangle goes to the proven neighbour whose
 * surface holds its three corners (within the face's own tolerance) and faces its way, growing
 * outwards until nothing more is taken. Where two could take one, the closer fit wins.
 */
export function growOnSurfaces(m: Mesh, faces: Region[], opt: SegmentOptions): { faces: Region[]; pool: number[] } {
  const nT = m.tri.length / 3;
  const owner = new Int32Array(nT).fill(-1);
  const kept = faces.filter((f) => f.keep || proves(m, f)).map((f) => ({ ...f, tris: [...f.tris] }));
  kept.forEach((f, i) => f.tris.forEach((t) => (owner[t] = i)));
  const senses = kept.map((f) => (f.surf ? sense(m, f) : 1));
  const tolOf = kept.map((f) => Math.max(opt.eps, 1.5 * f.err));
  const P = (v: number) => vtx(m.pos, v);
  /** How far the triangle's corners sit off face i's surface, or Infinity if it does not lie on it. */
  const off = (t: number, i: number): number => {
    // A round takes nothing more; a face with no surface has nothing to take with.
    if (kept[i].keep === 'round' || !kept[i].surf) return Infinity;
    const s = kept[i].surf as Surface;
    // A main face decided before this reading takes a triangle only as part of itself: its facet too.
    if (kept[i].keep === 'main' && !holdsFacets(m, s, [t])) return Infinity;
    let worst = 0;
    for (const v of triVerts(m, t)) {
      worst = Math.max(worst, Math.abs(distance(s, P(v))));
      if (worst > tolOf[i]) return Infinity;
    }
    if (!(kept[i].keep && onAxis(m, s, t, opt.eps)) && senses[i] * dot(triNormal(m, t), normalAt(s, triCentroid(m, t))) < 0.5) return Infinity;
    return worst;
  };
  let frontier: number[] = [];
  for (let t = 0; t < nT; t++) if (owner[t] < 0) for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w >= 0 && owner[w] >= 0) { frontier.push(t); break; } }
  while (frontier.length) {
    const next = new Set<number>();
    const claims: [number, number][] = [];
    for (const t of frontier) {
      if (owner[t] >= 0) continue;
      let best = -1, bestOff = Infinity;
      const tried = new Set<number>();
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        if (w < 0 || owner[w] < 0 || tried.has(owner[w])) continue;
        tried.add(owner[w]);
        const d = off(t, owner[w]);
        if (d < bestOff) { bestOff = d; best = owner[w]; }
      }
      if (best >= 0) claims.push([t, best]);
    }
    for (const [t, i] of claims) {
      owner[t] = i;
      kept[i].tris.push(t);
      for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w >= 0 && owner[w] < 0) next.add(w); }
    }
    frontier = [...next];
  }
  const pool: number[] = [];
  for (let t = 0; t < nT; t++) if (owner[t] < 0) pool.push(t);
  return { faces: kept, pool };
}

/** Connected pieces of a set of triangles. */
export function pieces(m: Mesh, tris: number[]): number[][] {
  const inSet = new Set(tris), seen = new Set<number>(), out: number[][] = [];
  for (const t0 of tris) {
    if (seen.has(t0)) continue;
    const part = [t0];
    seen.add(t0);
    for (let i = 0; i < part.length; i++) for (let k = 0; k < 3; k++) {
      const w = m.adj[part[i] * 3 + k];
      if (w >= 0 && inSet.has(w) && !seen.has(w)) { seen.add(w); part.push(w); }
    }
    out.push(part);
  }
  return out;
}

/**
 * What no proven surface took, read as whole pieces: a piece that is flat is a flat face, one a
 * single simple surface holds is that face, the rest is free-form (a sheet later).
 */
export function readLeftovers(m: Mesh, pool: number[], opt: SegmentOptions): Region[] {
  const out: Region[] = [];
  for (const part of pieces(m, pool)) {
    const pts = [...vertsOf(m, part)].map((v) => vtx(m.pos, v));
    const plane = fitPlane(pts);
    let err = 0;
    for (const p of pts) err = Math.max(err, Math.abs(distance(plane, p)));
    if (err <= opt.eps) { out.push({ tris: part, surf: plane, err }); continue; }
    const fit = pts.length >= 7 ? fitTris(m, part, opt, ['cylinder', 'cone', 'sphere', 'torus']) : null;
    if (fit && shows(m, fit.surf, vertsOf(m, part)) && holdsFacets(m, fit.surf, part)) { out.push({ tris: part, surf: fit.surf, err: fit.err }); continue; }
    // No one surface: its flat units, for the joins to read (strips of one round, run along one
    // direction, are one cylinder). What no join takes ends free-form.
    // A big piece that fits nothing is free-form as a whole (one sheet later); a small one may be
    // strips of a round meshed end to end, which the joins can read from its flat units.
    if (part.length > SPLIT_MOST) out.push({ tris: part, surf: null, err: 0 });
    else out.push(...flatUnits(m, part, opt.eps));
  }
  return out;
}

/** Facets that lie in one plane, side by side: each set as a flat face. */
function flatUnits(m: Mesh, tris: number[], eps: number): Region[] {
  const inSet = new Set(tris), done = new Set<number>(), out: Region[] = [];
  for (const t0 of tris) {
    if (done.has(t0)) continue;
    const n0 = triNormal(m, t0), o = vtx(m.pos, m.tri[t0 * 3]);
    const unit = [t0];
    done.add(t0);
    for (let i = 0; i < unit.length; i++) for (let k = 0; k < 3; k++) {
      const w = m.adj[unit[i] * 3 + k];
      if (w < 0 || !inSet.has(w) || done.has(w) || dot(triNormal(m, w), n0) < 1 - 1e-8) continue;
      if (triVerts(m, w).every((v) => { const p = vtx(m.pos, v); return Math.abs((p[0] - o[0]) * n0[0] + (p[1] - o[1]) * n0[1] + (p[2] - o[2]) * n0[2]) <= eps; })) { done.add(w); unit.push(w); }
    }
    out.push({ tris: unit, surf: { kind: 'plane', o, n: n0 }, err: 0 });
  }
  return out;
}

/** Faces that never proved a surface, as free-form: what the sheets take. */
export function unprovenFree(m: Mesh, faces: Region[]): Region[] {
  return faces.map((f) => (!f.keep && f.surf && f.surf.kind !== 'bspline' && !proves(m, f) ? { ...f, surf: null, err: 0 } : f));
}

/**
 * A triangle with a corner on the axis of a torus or at the apex of a cone, where the surface has
 * no normal to compare with (the pole of a dome read as a torus with no ring): judged by its
 * distance alone.
 */
export function onAxis(m: Mesh, s: Surface, t: number, tolPoint: number): boolean {
  if (s.kind !== 'torus' && s.kind !== 'cone') return false;
  for (let k = 0; k < 3; k++) {
    const p = vtx(m.pos, m.tri[t * 3 + k]);
    if (s.kind === 'cone' && norm(sub(p, s.apex)) <= AXIS_NEAR * tolPoint) return true;
    if (s.kind === 'torus' && norm(cross(sub(p, s.c), s.a)) <= AXIS_NEAR * tolPoint) return true;
  }
  return false;
}
/** How near the axis or apex (in float precisions) a corner must be for the normal test to be skipped. */
const AXIS_NEAR = 4;

/**
 * Whether triangles lie on a decided face as part of it, not merely with their corners on its
 * surface: every corner within `tol`, every facet's edges between its corners within the bow a
 * facet of that surface can have, and every facet facing the way the face does (`sense`; corners
 * on a torus's axis or a cone's apex are judged by distance alone). A flat disc whose rim lies on a
 * torus's top circle passes the first test and fails the other two.
 */
export function liesOnFace(m: Mesh, s: Surface, senseOf: number, tris: number[], tol: number): boolean {
  for (const t of tris) for (const v of triVerts(m, t)) if (Math.abs(distance(s, vtx(m.pos, v))) > tol) return false;
  if (!holdsFacets(m, s, tris)) return false;
  for (const t of tris) {
    if (onAxis(m, s, t, tol)) continue;
    if (senseOf * dot(triNormal(m, t), normalAt(s, triCentroid(m, t))) < 0.5) return false;
  }
  return true;
}

/** Which way a face's triangles look along its surface's own normal (+1 or -1). */
export function senseOfFace(m: Mesh, f: Region): number {
  return f.surf ? sense(m, f) : 1;
}
