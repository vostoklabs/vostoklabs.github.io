// Leftover pieces read in the part's own axes.
//
// A CAD part is built round a few axes: a hole, a boss, every round carried round an arc. The
// faces found exactly (a cylinder, cone or torus holding its points to the point tolerance) say
// where those axes are. Seen about such an axis, every point of a surface turned round it lies on
// one curve of its cross-section, (distance from the axis, height along it): a line for a plane,
// cylinder or cone, a circle for a torus or sphere. That holds however the exporter triangulated
// the face and however small a piece of it is: a round meshed as a fan of wedges, which the face
// finder cuts into dozens of pieces too small to prove anything, is one circle in that view.
//
// So each small or free-form piece next to the axes is projected into each axis's cross-section,
// largest axis first. A piece that lands on a curve already there (the faces that gave the axis,
// a flat face square to it) takes that face's surface; one rich enough to fit a line or circle of
// its own starts a new curve that the others may land on. A piece goes only where every one of its
// vertices sits within the point tolerance of the surface, measured as the surface itself measures.

import { type V3, dot, norm, sub } from './linalg';
import { type Mesh, connected, triCentroid, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions } from './segment';
import { type Analytic, type Surface, distance } from './surfaces';
import { liesOnFace, senseOfFace } from './features';

/** A face this many triangles or fewer is a piece that may be read again; larger ones keep their surface. */
const PIECE = 60;
/** A face that gives an axis holds at least this many triangles. */
const WITNESS = 20;
/** Two axes are one if as good as parallel (1 - |cos|) and this close where they pass (mm). */
const SAME_TILT = 1e-6, SAME_LINE = 1e-3;
/** Distinct cross-section points a piece needs to fit a curve of its own (two rings fit any curve). */
const RICH = 5;
/** A circle of the cross-section no wider than this many times the spread of the points that gave it. */
const CIRCLE_SIZE = 20;
/** A new circle stays if the pieces on it reach this far round it (radians), or this many pieces agree on it. */
const SPAN = (20 * Math.PI) / 180, AGREE = 3;
/** A new curve is read off a piece no further from the axis than this many times its own spread in the cross-section. */
const FAR = 20;
/** How far the middle of a free-form piece's triangle may sit off a surface it is read onto (mm): what a sheet is held to. */
const FREE_SAG = 0.02;

type Frame = { o: V3; a: V3; support: number; curves: Curve[] };
type Curve = { surf: Analytic };

/** The axis a surface is turned round, if it has one. */
function axisOf(s: Surface): { o: V3; a: V3 } | null {
  switch (s.kind) {
    case 'cylinder': return { o: s.o, a: s.a };
    case 'cone': return { o: s.apex, a: s.a };
    case 'torus': return { o: s.c, a: s.a };
    case 'revolution': return { o: s.o, a: s.a };
    default: return null;
  }
}

/** The faces with their small and free-form pieces read again about the part's axes. */
export function readInFrames(m: Mesh, faces: Region[], opt: SegmentOptions): Region[] {
  const P = (v: number) => vtx(m.pos, v);
  const vertsOf = (f: Region) => [...new Set(f.tris.flatMap((t) => triVerts(m, t)))];
  const worst = (s: Surface, vs: number[]) => { let e = 0; for (const v of vs) { e = Math.max(e, Math.abs(distance(s, P(v)))); if (e > opt.eps) return e; } return e; };
  /** How far the middles of a face's triangles sit off a surface, on average (mm). */
  const sag = (s: Surface, f: Region) => f.tris.reduce((a, t) => a + Math.abs(distance(s, triCentroid(m, t))), 0) / f.tris.length;
  /** The same on the face's own surface, which does not change: worked out once per face. */
  const ownSag = new Map<Region, number>();
  const sagOwn = (f: Region) => { let x = ownSag.get(f); if (x === undefined) ownSag.set(f, (x = sag(f.surf!, f))); return x; };
  const holds = (s: Surface, f: Region, vs: number[]) => {
    if (worst(s, vs) > opt.eps) return false;
    for (const t of f.tris) if (Math.abs(distance(s, triCentroid(m, t))) > opt.chord) return false;
    // A face whose vertices sit only at its two ends (a long strip of a straight round) has them
    // on many surfaces: a torus round a far axis passes through them and bows a third of a
    // millimetre off the strip between. So a face already on a surface moves only to one that
    // holds its triangles' middles about as well.
    if (f.surf && f.surf !== s && f.surf.kind !== 'bspline' && sag(s, f) > 1.5 * sagOwn(f) + 3 * opt.eps) return false;
    // A free-form piece has no surface to compare with: its middles must sit as close as a
    // sheet's would (a piece of a 0.2 mm round read as a 0.34 mm tube stood 0.33 mm off).
    if (!f.surf && f.tris.some((t) => Math.abs(distance(s, triCentroid(m, t))) > FREE_SAG)) return false;
    return true;
  };

  // The axes, from faces found exactly.
  const frames: Frame[] = [];
  const verts = faces.map(vertsOf);
  // Only a face that shows its surface may say where an axis is, the largest first: a band between
  // two rings of points fits a cone, a sphere and a torus alike (a round meshed ring by ring reads
  // as a stack of them), and the axis of such a fit is a little off. Seen about an axis a little
  // off, a ring is no longer one point, and the bands would never be read together. A cylinder is
  // the exception: two rings of one radius are a hole's wall, and their centres fix the axis.
  const witnesses = faces.map((_, i) => i).sort((x, y) => faces[y].tris.length - faces[x].tris.length);
  for (const i of witnesses) {
    const f = faces[i], s = f.surf;
    if (!s || f.tris.length < WITNESS) continue;
    const ax = axisOf(s);
    if (!ax) continue;
    if (s.kind !== 'revolution' && worst(s, verts[i]) > opt.eps) continue;
    if (s.kind !== 'revolution' && s.kind !== 'cylinder' && distinct(verts[i].map(sectionIn(ax))).length < RICH) continue;
    let fr = frames.find((g) => 1 - Math.abs(dot(g.a, ax.a)) < SAME_TILT && offLine(ax.o, g) < SAME_LINE);
    if (!fr) frames.push((fr = { o: ax.o, a: ax.a, support: 0, curves: [] }));
    fr.support += f.tris.length;
    if (s.kind !== 'revolution') fr.curves.push({ surf: s as Analytic });
  }
  // A flat face square to an axis is a line of its cross-section too (the top a round runs into).
  faces.forEach((f, i) => {
    const s = f.surf;
    if (!s || s.kind !== 'plane' || f.tris.length <= 3) return;
    for (const fr of frames) if (1 - Math.abs(dot(s.n, fr.a)) < SAME_TILT && worst(s, verts[i]) <= opt.eps) fr.curves.push({ surf: s });
  });
  frames.sort((x, y) => y.support - x.support);

  const piece = (i: number) => !faces[i].surf || (faces[i].tris.length <= PIECE && faces[i].surf!.kind !== 'revolution' && faces[i].surf!.kind !== 'extrusion');
  const order = faces.map((_, i) => i).filter(piece).sort((x, y) => faces[y].tris.length - faces[x].tris.length);
  const out = faces.map((f) => ({ ...f }));
  const done = new Uint8Array(faces.length);
  // Which faces touch which, for the bands read together below.
  const label = new Int32Array(m.tri.length / 3).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const touching: Set<number>[] = faces.map(() => new Set());
  for (let t = 0; t < label.length; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w >= 0 && label[w] !== label[t] && label[w] >= 0 && label[t] >= 0) touching[label[t]].add(label[w]);
  }
  for (const fr of frames) {
    const section = sectionIn(fr);
    /** The pieces each new curve took, to be given back if together they do not show it. */
    const took = new Map<Curve, number[]>();
    // Bands between two rings of points about this axis, of any size: they show no curve of their
    // own, so the ones side by side are read together. Not a cylinder: two rings of one radius
    // are a straight wall, and a wall read with the round below it is no one circle.
    const band = faces.map((f, i) => !done[i] && !!f.surf && f.surf.kind !== 'revolution' && f.surf.kind !== 'extrusion' && f.surf.kind !== 'plane'
      && f.surf.kind !== 'cylinder' && distinct(verts[i].map(section)).length <= 2);
    const seen = new Uint8Array(faces.length);
    for (let i0 = 0; i0 < faces.length; i0++) {
      if (!band[i0] || seen[i0]) continue;
      const group = [i0];
      seen[i0] = 1;
      for (let g = 0; g < group.length; g++) for (const j of touching[group[g]]) if (band[j] && !seen[j]) { seen[j] = 1; group.push(j); }
      if (group.length < 2) continue;
      const pts = distinct(group.flatMap((i) => verts[i]).map(section));
      if (pts.length < RICH) continue;
      const s = curveSurface(fr, pts, opt.eps);
      if (!s || !group.every((i) => holds(s, faces[i], verts[i]))) continue;
      const c = { surf: s };
      fr.curves.push(c);
      for (const i of group) { out[i] = { tris: faces[i].tris, surf: s, err: worst(s, verts[i]) }; done[i] = 1; }
    }
    // Rich pieces first, so the curves they start are there for the poorer ones to land on.
    for (const pass of [0, 1]) for (const i of order) {
      if (done[i]) continue;
      const f = faces[i], vs = verts[i];
      const on = fr.curves.find((c) => holds(c.surf, f, vs));
      if (on) {
        out[i] = { tris: f.tris, surf: on.surf, err: worst(on.surf, vs) };
        done[i] = 1;
        took.get(on)?.push(i);
        continue;
      }
      if (pass === 1) continue;
      const pts = distinct(vs.map(section));
      if (pts.length < RICH) continue;
      // A piece far from the axis next to its own size is no part of a face turned round it (a
      // 0.4 mm strip read as a torus round the latch on the far side, 35 mm away).
      if (far(pts)) continue;
      const s = curveSurface(fr, pts, opt.eps);
      if (!s || !holds(s, f, vs)) continue;
      const c = { surf: s };
      fr.curves.push(c);
      took.set(c, [i]);
      out[i] = { tris: f.tris, surf: s, err: worst(s, vs) };
      done[i] = 1;
    }
    // A circle read off a short arc can be any of many circles: a new one stays only if the
    // pieces on it reach round enough of it, or several pieces agree on it.
    for (const [c, ids] of took) {
      const s = c.surf;
      if (s.kind !== 'torus' && s.kind !== 'sphere') continue;
      if (ids.length >= AGREE || arcSpan(s, ids.flatMap((i) => verts[i]).map(section), fr) >= SPAN) continue;
      for (const i of ids) { out[i] = { ...faces[i] }; done[i] = 0; }
      fr.curves.splice(fr.curves.indexOf(c), 1);
    }
  }
  return out;

  /** Whether cross-section points lie far from the axis for how far they spread (see FAR). */
  function far(pts: [number, number][]): boolean {
    let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity, rho = 0;
    for (const [r, h] of pts) { lo0 = Math.min(lo0, r); hi0 = Math.max(hi0, r); lo1 = Math.min(lo1, h); hi1 = Math.max(hi1, h); rho += r; }
    return rho / pts.length > FAR * Math.max(Math.hypot(hi0 - lo0, hi1 - lo1), 1e-9);
  }

  /** A vertex in a frame's cross-section: (distance from the axis, height along it). */
  function sectionIn(fr: { o: V3; a: V3 }) {
    return (v: number): [number, number] => {
      const d = sub(P(v), fr.o), h = dot(d, fr.a);
      return [norm([d[0] - h * fr.a[0], d[1] - h * fr.a[1], d[2] - h * fr.a[2]]), h];
    };
  }
}

/** How far round its own cross-section circle the points reach (radians). */
function arcSpan(s: Analytic, pts: [number, number][], fr: Frame): number {
  // The circle's centre in the cross-section: (distance from the axis, height along it).
  const c = s.kind === 'torus' ? s.c : s.kind === 'sphere' ? s.c : null;
  if (!c) return 0;
  const d = sub(c, fr.o), h = dot(d, fr.a);
  const cr = s.kind === 'torus' ? s.R : 0;
  const ang = pts.map(([r, z]) => Math.atan2(z - h, r - cr)).sort((x, y) => x - y);
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
  for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
  return 2 * Math.PI - gap;
}

/** How far a point is from a frame's axis line (mm). */
function offLine(p: V3, fr: { o: V3; a: V3 }): number {
  const d = sub(p, fr.o), h = dot(d, fr.a);
  return norm([d[0] - h * fr.a[0], d[1] - h * fr.a[1], d[2] - h * fr.a[2]]);
}

/**
 * Cross-section points with near repeats taken once: a ring's vertices are one point, to within
 * float precision (about 0.00002 mm at 140 mm from the origin), so points closer than SAME_POINT
 * are one. Cells of that size, each point checked against its own and the eight around it.
 */
const SAME_POINT = 5e-5;
function distinct(pts: [number, number][]): [number, number][] {
  const cells = new Map<string, [number, number][]>(), out: [number, number][] = [];
  for (const p of pts) {
    const cx = Math.floor(p[0] / SAME_POINT), cy = Math.floor(p[1] / SAME_POINT);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) {
      for (const q of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= SAME_POINT) { near = true; break; }
    }
    if (near) continue;
    const k = `${cx},${cy}`;
    cells.set(k, [...(cells.get(k) ?? []), p]);
    out.push(p);
  }
  return out;
}

/**
 * The surface a cross-section curve sweeps round the frame's axis: the plane, cylinder or cone of
 * a line, else the torus or sphere of a circle; null if neither fits the points within reason.
 * (The caller holds it to the point tolerance on the face's own vertices.)
 */
function curveSurface(fr: Frame, pts: [number, number][], eps: number): Analytic | null {
  const at = (h: number): V3 => [fr.o[0] + fr.a[0] * h, fr.o[1] + fr.a[1] * h, fr.o[2] + fr.a[2] * h];
  const n = pts.length;
  const mr = pts.reduce((s, p) => s + p[0], 0) / n, mh = pts.reduce((s, p) => s + p[1], 0) / n;
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const p of pts) { lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])]; hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])]; }
  const spread = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
  // The line through them (total least squares: the direction of most spread) and how far the
  // furthest point is off it.
  let srr = 0, shh = 0, srh = 0;
  for (const [r, h] of pts) { srr += (r - mr) ** 2; shh += (h - mh) ** 2; srh += (r - mr) * (h - mh); }
  {
    const theta = 0.5 * Math.atan2(2 * srh, srr - shh), dr = Math.cos(theta), dh = Math.sin(theta);
    let off = 0;
    for (const [r, h] of pts) off = Math.max(off, Math.abs((r - mr) * dh - (h - mh) * dr));
    if (off <= eps) {
      if (Math.abs(dr) >= Math.abs(dh) * 1e3) return { kind: 'plane', o: at(mh), n: fr.a };
      if (Math.abs(dh) >= Math.abs(dr) * 1e3) return { kind: 'cylinder', o: fr.o, a: fr.a, r: mr };
      // rho = mr + k (h - mh): the tip where rho is 0, opening the way rho grows.
      const k = dr / dh, tip = mh - mr / k, up = k > 0 ? 1 : -1;
      return { kind: 'cone', apex: at(tip), a: [fr.a[0] * up, fr.a[1] * up, fr.a[2] * up], ang: Math.atan(Math.abs(k)) };
    }
  }
  const c = fitCircle(pts);
  if (!c || c.r > CIRCLE_SIZE * spread) return null;
  if (Math.abs(c.cr) < 1e-3 * c.r) return { kind: 'sphere', c: at(c.ch), r: c.r };
  // A ring smaller than its tube crosses itself: not a surface to write.
  if (c.cr < c.r - Math.max(1e-4, 1e-3 * c.r)) return null;
  return { kind: 'torus', c: at(c.ch), a: fr.a, R: Math.max(c.cr, c.r), r: c.r };
}

/** The circle through 2D points: an algebraic fit, then a few steps of the geometric one. */
export function fitCircle(pts: [number, number][]): { cr: number; ch: number; r: number } | null {
  const [ox, oy] = pts[0];
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [px, py] of pts) {
    const x = px - ox, y = py - oy, z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z;
  }
  const n = pts.length;
  // x² + y² + D x + E y + F = 0, least squares.
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [-sxz, -syz, -sz];
  const det = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d0 = det(A);
  if (Math.abs(d0) < 1e-30) return null;
  const col = (k: number) => A.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)));
  const D = det(col(0)) / d0, E = det(col(1)) / d0, F = det(col(2)) / d0;
  let cx = -D / 2, cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  let r = Math.sqrt(r2);
  // Geometric refinement (Gauss-Newton on distance minus radius).
  for (let it = 0; it < 8; it++) {
    let j11 = 0, j12 = 0, j13 = 0, j22 = 0, j23 = 0, j33 = 0, g1 = 0, g2 = 0, g3 = 0;
    for (const [px, py] of pts) {
      const x = px - ox - cx, y = py - oy - cy, d = Math.hypot(x, y) || 1e-12;
      const res = d - r, a1 = -x / d, a2 = -y / d, a3 = -1;
      j11 += a1 * a1; j12 += a1 * a2; j13 += a1 * a3; j22 += a2 * a2; j23 += a2 * a3; j33 += a3 * a3;
      g1 += a1 * res; g2 += a2 * res; g3 += a3 * res;
    }
    const M = [[j11, j12, j13], [j12, j22, j23], [j13, j23, j33]], rhs = [-g1, -g2, -g3];
    const dd = det(M);
    if (Math.abs(dd) < 1e-30) break;
    const cM = (k: number) => M.map((row, i) => row.map((x, j) => (j === k ? rhs[i] : x)));
    cx += det(cM(0)) / dd; cy += det(cM(1)) / dd; r += det(cM(2)) / dd;
  }
  return r > 0 ? { cr: cx + ox, ch: cy + oy, r } : null;
}

/** A face this small is a speck (mm², triangles). */
const SPECK_AREA = 0.01, SPECK_TRIS = 8;
/** How far a speck's vertices may sit off the neighbour it joins: the file's own tolerance (mm). */
const SPECK_FIT = 1e-3;

/**
 * Specks joined to a neighbour. Where rounds meet at a corner, the face finder leaves faces of
 * a few triangles and a hundredth of a square millimetre, read as whatever fits four points (a
 * torus with a 0.05 mm tube): their edges cannot meet their neighbours, and they are far below
 * anything that prints. Each joins the neighbour whose surface holds its vertices best, if that
 * is within the file's tolerance.
 */
export function absorbSpecks(m: Mesh, faces: Region[]): Region[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const area = faces.map((f) => f.tris.reduce((a, t) => a + m.area[t], 0));
  const speck = (i: number) => area[i] < SPECK_AREA && faces[i].tris.length <= SPECK_TRIS;
  // Joins chain (a speck onto a speck of the same round onto the round), so they are kept as
  // groups, each written with the surface of its largest face.
  const parent = faces.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  faces.forEach((f, i) => {
    if (!speck(i) || f.keep) return;
    const vs = [...new Set(f.tris.flatMap((t) => triVerts(m, t)))].map((v) => vtx(m.pos, v));
    const nbrs = new Set<number>();
    for (const t of f.tris) for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w >= 0 && label[w] !== i) nbrs.add(label[w]); }
    let best = -1, bestOff = SPECK_FIT;
    for (const j of nbrs) {
      const s = faces[j].surf;
      if (!s || faces[j].keep === 'round') continue;
      // Onto a main face only as part of it: corners, facets and facing.
      if (faces[j].keep === 'main' && !liesOnFace(m, s, senseOfFace(m, faces[j]), f.tris, SPECK_FIT)) continue;
      let off = 0;
      for (const p of vs) { off = Math.max(off, Math.abs(distance(s, p))); if (off > bestOff) break; }
      if (off <= bestOff) { bestOff = off; best = j; }
    }
    if (best >= 0 && root(best) !== root(i)) parent[root(i)] = root(best);
  });
  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => { const g = root(i); groups.set(g, [...(groups.get(g) ?? []), i]); });
  const out: Region[] = [];
  for (const members of groups.values()) {
    // Specks joined only to each other have no surface worth the name: they stay as they were.
    if (members.length === 1 || members.every(speck)) { for (const i of members) out.push(faces[i]); continue; }
    const lead = members.filter((i) => !speck(i)).reduce((a, b) => (faces[b].tris.length > faces[a].tris.length ? b : a));
    out.push({ tris: members.flatMap((i) => faces[i].tris), surf: faces[lead].surf, err: Math.max(...members.map((i) => faces[i].err)), ...keptOf(members.map((i) => faces[i])) });
  }
  return out;
}

/** The most triangles a corner blend made one face may hold: past it, it is not a corner. */
const CORNER_MOST = 300;
/** A face this small that misses its own surface by more than the point tolerance is a piece of a blend. */
const LOOSE_PIECE = 60;
/** A curved face smaller than this (mm²) beside a blend's scraps is part of the blend. */
const BLEND_AREA = 0.3;

/**
 * Corner blends as one face. Where three rounds meet, the CAD program fills the corner with a
 * patch of its own, and the face finder reads it as a cluster of specks (a few triangles each,
 * each fitting whatever four points fit) and free-form scraps, whose edges cannot meet one
 * another. The specks that are left after `absorbSpecks`, with the free-form faces touching them,
 * become one free-form face: one sheet over the whole corner, meeting the rounds round it.
 */
export function joinCorners(m: Mesh, faces: Region[], eps: number): Region[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const area = faces.map((f) => f.tris.reduce((a, t) => a + m.area[t], 0));
  // A speck, or a small face that does not hold its own surface exactly (a piece of a blend read
  // as whatever came closest), is blend material as much as a free-form scrap is.
  const speck = (i: number) => (area[i] < SPECK_AREA && faces[i].tris.length <= SPECK_TRIS) || (!!faces[i].surf && faces[i].tris.length <= LOOSE_PIECE && faces[i].err > eps);
  const free = (i: number) => !faces[i].surf && faces[i].tris.length <= CORNER_MOST;
  // A small face beside them is part of the same blend, however exactly it holds its own surface
  // (a sphere cap a few tenths of a millimetre across, a sliver of a cone): it only joins through
  // a speck or a scrap, so small faces of a clean corner stay as they are.
  const small = (i: number) => area[i] < BLEND_AREA && faces[i].tris.length <= CORNER_MOST && faces[i].surf?.kind !== 'plane';
  const messy = (i: number) => speck(i) || free(i);
  const material = (i: number) => messy(i) || small(i);
  const parent = faces.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const size = faces.map((f) => f.tris.length);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k], i = label[t], j = label[w];
    if (w < 0 || i === j || i < 0 || j < 0 || !material(i) || !material(j)) continue;
    // Only round a speck or a scrap: two free-form faces side by side are left to the sheet
    // fitter, and two small exact faces side by side are a clean corner.
    if (!(speck(i) || speck(j)) && !((free(i) || free(j)) && (small(i) || small(j)))) continue;
    const a = root(i), b = root(j);
    if (a === b || size[a] + size[b] > CORNER_MOST) continue;
    parent[a] = b;
    size[b] += size[a];
  }
  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => { const g = root(i); groups.set(g, [...(groups.get(g) ?? []), i]); });
  const out: Region[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) { out.push(faces[members[0]]); continue; }
    out.push({ tris: members.flatMap((i) => faces[i].tris), surf: null, err: 0 });
  }
  return out;
}

/**
 * Borders tidied. Where a free-form face meets a face with a surface, the border between them
 * can zigzag from triangle to triangle: triangles that lie on the neighbour's surface were left on
 * the free-form side. Each such triangle (all three corners on the neighbour's surface) goes to
 * the neighbour, round after round, so the border runs where the surfaces really part.
 */
export function tidyBorders(m: Mesh, faces: Region[], opt: SegmentOptions): Region[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const P = (v: number) => vtx(m.pos, v);
  const on = (s: Surface, t: number) =>
    triVerts(m, t).every((v) => Math.abs(distance(s, P(v))) <= opt.eps) && Math.abs(distance(s, triCentroid(m, t))) <= opt.chord;
  let moved = 0;
  for (let round = 0; round < 8; round++) {
    let now = 0;
    for (let t = 0; t < nT; t++) {
      const i = label[t];
      if (i < 0 || faces[i].surf) continue;
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k], j = w >= 0 ? label[w] : -1;
        const s = j >= 0 && j !== i ? faces[j].surf : null;
        if (!s || s.kind === 'bspline' || !on(s, t)) continue;
        label[t] = j;
        now++;
        break;
      }
    }
    moved += now;
    if (!now) break;
  }
  if (!moved) return faces;
  const by: number[][] = faces.map(() => []);
  for (let t = 0; t < nT; t++) if (label[t] >= 0) by[label[t]].push(t);
  const out: Region[] = [];
  faces.forEach((f, i) => {
    if (!by[i].length) return;
    if (by[i].length === f.tris.length) { out.push(f); return; }
    // A face with a surface keeps it; a free-form face that lost triangles may fall into pieces.
    for (const part of f.surf ? [by[i]] : connected(m, by[i])) out.push({ ...f, tris: part });
  });
  return out;
}

/**
 * Neighbouring faces on one surface are one face: the same surface object, or a small or
 * free-form face whose every vertex lies on its larger neighbour's surface.
 */
export function joinSameSurface(m: Mesh, faces: Region[], opt: SegmentOptions): Region[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const parent = faces.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const size = (i: number) => faces[i].tris.length;
  const P = (v: number) => vtx(m.pos, v);
  const lies = (s: Surface, i: number) => {
    for (const t of faces[i].tris) for (const v of triVerts(m, t)) if (Math.abs(distance(s, P(v))) > opt.eps) return false;
    return true;
  };
  // A main face decided before this reading joins nothing that does not lie on it as a face: each
  // joining face is tested against the main face's own surface, corners, facets and facing.
  const keeper = faces.map((f, i) => (f.keep === 'main' && f.surf ? i : -1));
  const members = faces.map((_, i) => [i]);
  const senses = faces.map((f) => (f.keep === 'main' ? senseOfFace(m, f) : 1));
  const holds = (k: number, r: number) => {
    const K = faces[k];
    const tol = Math.max(opt.eps, 1.5 * K.err);
    return members[r].every((x) => x === k || liesOnFace(m, K.surf as Surface, senses[k], faces[x].tris, tol));
  };
  const unite = (x: number, y: number): boolean => {
    const a = root(x), b = root(y);
    if (a === b) return true;
    if ((keeper[a] >= 0 && !holds(keeper[a], b)) || (keeper[b] >= 0 && !holds(keeper[b], a))) return false;
    parent[a] = b;
    for (const z of members[a]) members[b].push(z);
    members[a] = [];
    if (keeper[b] < 0) keeper[b] = keeper[a];
    return true;
  };
  const asked = new Set<string>();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k], i = label[t], j = label[w];
    if (w < 0 || i < 0 || j < 0 || root(i) === root(j)) continue;
    if (faces[i].keep === 'round' || faces[j].keep === 'round') continue;
    const a = faces[i].surf, b = faces[j].surf;
    if (a && a === b) { unite(i, j); continue; }
    // The smaller face onto the larger one's surface, once per pair.
    const [big, small] = size(i) >= size(j) ? [i, j] : [j, i];
    const s = faces[big].surf;
    const key = `${big}:${small}`;
    if (!s || s.kind === 'bspline' || asked.has(key)) continue;
    asked.add(key);
    if ((faces[small].surf && size(small) > PIECE) || !lies(s, small)) continue;
    unite(small, big);
  }
  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => { const g = root(i); groups.set(g, [...(groups.get(g) ?? []), i]); });
  const out: Region[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) { out.push(faces[members[0]]); continue; }
    // The surface of the largest face that has one.
    const kept = members.find((i) => faces[i].keep === 'main' && faces[i].surf);
    const lead = kept ?? members.filter((i) => faces[i].surf).sort((x, y) => size(y) - size(x))[0] ?? members[0];
    out.push({ tris: members.flatMap((i) => faces[i].tris), surf: faces[lead].surf, err: Math.max(...members.map((i) => faces[i].err)), ...keptOf(members.map((i) => faces[i])) });
  }
  return out;
}

/** A face joined from faces one of which was a main face is a main face. */
export function keptOf(members: Region[]): { keep?: 'main' } {
  return members.some((f) => f.keep === 'main') ? { keep: 'main' } : {};
}
