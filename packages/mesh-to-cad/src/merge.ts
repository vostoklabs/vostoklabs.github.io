// Neighbouring faces that are pieces of one surface made one: pieces turned about one axis whose
// cross-sections land on one circle or line (a round meshed ring by ring is a stack of cones and
// spheres, and is one torus), and pieces run along one direction whose sections land on one
// circle or line (a round meshed strip by strip is a row of flats, and is one cylinder).
//
// The test is the points themselves, not the pieces' fits: a set of points whose (radius, height)
// about an axis lie on one curve lies on the surface that curve sweeps.

import { type V3, basis, cross, dot, madd, norm, normalize, sub } from './linalg';
import { type Mesh, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions } from './segment';
import { type Surface } from './surfaces';
import { keptOf } from './frames';
import { fitCircle } from './frames';
import { holdsFacets } from './features';

type Frame = { kind: 'axis' | 'dir'; o: V3; a: V3 };
/** How far round a section's points must reach before a circle through them is believed. */
const SHOW = (15 * Math.PI) / 180;

/** The axis a surface turns about, or the direction it runs along. */
function framesOf(s: Surface | null): Frame[] {
  if (!s) return [];
  switch (s.kind) {
    case 'cylinder': return [{ kind: 'axis', o: s.o, a: s.a }, { kind: 'dir', o: s.o, a: s.a }];
    case 'cone': return [{ kind: 'axis', o: s.apex, a: s.a }];
    case 'torus': return [{ kind: 'axis', o: s.c, a: s.a }];
    case 'revolution': return [{ kind: 'axis', o: s.o, a: s.a }];
    case 'extrusion': return [{ kind: 'dir', o: s.o, a: s.a }];
    default: return [];
  }
}

/** A point in the frame's own 2D section: (radius, height) about an axis, (x, y) across a direction. */
function section(f: Frame, p: V3): [number, number] {
  const v = sub(p, f.o);
  const h = dot(v, f.a);
  if (f.kind === 'axis') return [norm(madd(v, f.a, -h)), h];
  const [e1, e2] = basis(f.a);
  return [dot(v, e1), dot(v, e2)];
}

type Curve2 = { kind: 'line'; p: [number, number]; d: [number, number]; err: number } | { kind: 'circle'; cr: number; ch: number; r: number; err: number };

function extent2(pts: [number, number][]): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return Math.hypot(x1 - x0, y1 - y0);
}

/** The one line or circle the section points lie on within tol, or null. */
function sectionCurve(pts: [number, number][], tol: number): Curve2 | null {
  if (pts.length < 3) return null;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const d: [number, number] = [Math.cos(ang), Math.sin(ang)];
  let lerr = 0;
  for (const [x, y] of pts) lerr = Math.max(lerr, Math.abs(-(x - mx) * d[1] + (y - my) * d[0]));
  if (lerr <= tol) return { kind: 'line', p: [mx, my], d, err: lerr };
  const size = extent2(pts);
  if (size < 1e-6) return null;
  const c = fitCircle(pts);
  if (!c || c.r > 20 * size) return null;
  let cerr = 0;
  for (const [x, y] of pts) cerr = Math.max(cerr, Math.abs(Math.hypot(x - c.cr, y - c.ch) - c.r));
  // The points must show the circle: reach round at least SHOW of it. A few points of a nearly
  // straight section fit a huge circle as well as any (a flat strip read as a 9 mm tube).
  const angs = pts.map(([x, y]) => Math.atan2(y - c.ch, x - c.cr)).sort((a, b) => a - b);
  let gap = angs[0] + 2 * Math.PI - angs[angs.length - 1];
  for (let i = 1; i < angs.length; i++) gap = Math.max(gap, angs[i] - angs[i - 1]);
  if (2 * Math.PI - gap < SHOW) return null;
  return cerr <= tol ? { kind: 'circle', ...c, err: cerr } : null;
}

/** The surface a section curve sweeps in a frame. */
function sweep(f: Frame, c: Curve2): Surface | null {
  const at = (h: number): V3 => madd(f.o, f.a, h);
  if (f.kind === 'axis') {
    if (c.kind === 'circle') {
      if (Math.abs(c.cr) < 1e-6 * (1 + c.r)) return { kind: 'sphere', c: at(c.ch), r: c.r };
      if (c.cr < c.r - 1e-6) return null; // a spindle torus: no designer draws one
      return { kind: 'torus', c: at(c.ch), a: f.a, R: c.cr, r: c.r };
    }
    const [dr, dh] = c.d;
    if (Math.abs(dh) < 1e-9) return { kind: 'plane', o: at(c.p[1]), n: f.a };
    if (Math.abs(dr) < 1e-9) return c.p[0] > 1e-6 ? { kind: 'cylinder', o: f.o, a: f.a, r: c.p[0] } : null;
    const k = dr / dh; // rho = p0 + k (h - p1): the apex where rho is 0
    const h0 = c.p[1] - c.p[0] / k;
    return k > 0 ? { kind: 'cone', apex: at(h0), a: f.a, ang: Math.atan(k) } : { kind: 'cone', apex: at(h0), a: [-f.a[0], -f.a[1], -f.a[2]], ang: Math.atan(-k) };
  }
  const [e1, e2] = basis(f.a);
  if (c.kind === 'circle') return { kind: 'cylinder', o: madd(madd(f.o, e1, c.cr), e2, c.ch), a: f.a, r: c.r };
  const nrm = normalize(cross(f.a, madd(madd([0, 0, 0], e1, c.d[0]), e2, c.d[1])));
  return { kind: 'plane', o: madd(madd(f.o, e1, c.p[0]), e2, c.p[1]), n: nrm };
}

/** Up to `cap` points of a set, spread evenly. */
function spread(pts: V3[], cap: number): V3[] {
  if (pts.length <= cap) return pts;
  const out: V3[] = [];
  for (let i = 0; i < cap; i++) out.push(pts[Math.floor((i * pts.length) / cap)]);
  return out;
}

/** Whether two frames are the same axis (or direction). */
function sameFrame(f: Frame, g: Frame): boolean {
  if (f.kind !== g.kind || norm(cross(f.a, g.a)) > 2e-3) return false;
  if (f.kind === 'dir') return true;
  const d = sub(g.o, f.o);
  return norm(madd(d, f.a, -dot(d, f.a))) < 5e-3;
}

/**
 * Neighbouring faces joined wherever all their points sit on one surface swept about an axis or
 * along a direction that one of them gives. Tested on every vertex (spread to at most `CAP`), so
 * a join is never on a fit's word alone.
 */
export function joinSwept(m: Mesh, faces: Region[], opt: SegmentOptions): Region[] {
  const CAP = 3000;
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const border = new Map<string, number>();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < t) continue;
    const i = label[t], j = label[w];
    if (i === j || i < 0 || j < 0) continue;
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    border.set(key, (border.get(key) ?? 0) + 1);
  }
  const vertsOf = (f: Region) => { const s = new Set<number>(); for (const t of f.tris) for (const v of triVerts(m, t)) s.add(v); return [...s].map((v) => vtx(m.pos, v)); };
  const groups = faces.map((f) => ({ members: [f], pts: spread(vertsOf(f), CAP), surf: f.surf, err: f.err, frames: framesOf(f.surf), alive: true }));
  const parent = faces.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const pairs = [...border].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(',').map(Number));
  // The part's own axes: those of curved faces big enough to show them. A round meshed as a fan of
  // wedges has no piece that shows its axis (each wedge fits a cylinder along the round); the
  // chamfer or wall beside it does.
  const axes: Frame[] = [];
  for (const f of faces) {
    if (f.tris.length < 20) continue;
    for (const fr of framesOf(f.surf)) if (fr.kind === 'axis' && !axes.some((g) => sameFrame(fr, g))) axes.push(fr);
  }
  // And its directions: those of its cylinders and extrusions (a round meshed as strips along a
  // straight shows its direction only through the walls beside it).
  const dirs: Frame[] = [];
  for (const f of faces) {
    if (f.tris.length < 20) continue;
    for (const fr of framesOf(f.surf)) if (fr.kind === 'dir' && !dirs.some((g) => sameFrame(fr, g))) dirs.push(fr);
  }
  const centreOf = (pts: V3[]): V3 => { const c: V3 = [0, 0, 0]; for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length; } return c; };
  const offAxis = (f: Frame, p: V3) => { const d = sub(p, f.o); return norm(madd(d, f.a, -dot(d, f.a))); };
  // Two rounds: a join can make a frame for a later pair.
  for (let round = 0; round < 2; round++) for (const [i0, j0] of pairs) {
    const i = root(i0), j = root(j0);
    if (i === j) continue;
    const A = groups[i], B = groups[j];
    // A face decided before this reading is not swept into a new surface with others.
    if (A.members.some((f) => f.keep) || B.members.some((f) => f.keep)) continue;
    if (!A.surf || !B.surf || A.surf.kind === 'bspline' || B.surf.kind === 'bspline') continue;
    // Two flats: only into a cylinder along a direction of the part (strips of one round).
    const flats = A.surf.kind === 'plane' && B.surf.kind === 'plane';
    const cands: Frame[] = [];
    for (const f of [...A.frames, ...B.frames]) if (!cands.some((g) => sameFrame(f, g))) cands.push(f);
    const mid = centreOf([...A.pts.slice(0, 50), ...B.pts.slice(0, 50)]);
    for (const f of axes.map((g) => [g, offAxis(g, mid)] as const).filter(([, d]) => d < 10).sort((x, y) => x[1] - y[1]).slice(0, 6).map(([g]) => g)) {
      if (!cands.some((g) => sameFrame(f, g))) cands.push(f);
    }
    if (A.surf.kind === 'plane' || B.surf.kind === 'plane') for (const f of dirs.slice(0, 12)) if (!cands.some((g) => sameFrame(f, g))) cands.push({ ...f, o: mid });
    if (A.surf.kind === 'sphere' && B.surf.kind === 'sphere' && norm(sub(A.surf.c, B.surf.c)) > 1e-6) cands.push({ kind: 'axis', o: A.surf.c, a: normalize(sub(B.surf.c, A.surf.c)) });
    const tol = Math.max(opt.eps, A.err, B.err);
    const pts = spread([...A.pts, ...B.pts], CAP);
    for (const f of cands) {
      const sec = pts.map((p) => section(f, p));
      const c = sectionCurve(sec, tol);
      if (!c) continue;
      if (flats && c.kind !== 'circle') continue;
      const s = sweep(f, c);
      if (!s || !A.members.every((x) => holdsFacets(m, s, x.tris)) || !B.members.every((x) => holdsFacets(m, s, x.tris))) continue;
      parent[j] = i;
      groups[i] = { members: [...A.members, ...B.members], pts, surf: s, err: Math.max(A.err, B.err, c.err), frames: framesOf(s).length ? framesOf(s) : [f], alive: true };
      B.alive = false;
      break;
    }
  }
  const out: Region[] = [];
  faces.forEach((_, i) => {
    if (root(i) !== i) return;
    const g = groups[i];
    if (g.members.length === 1) { out.push(g.members[0]); return; }
    out.push({ tris: g.members.flatMap((f) => f.tris), surf: g.surf, err: g.err, ...keptOf(g.members) });
  });
  return out;
}
