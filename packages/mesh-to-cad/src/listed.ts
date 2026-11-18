// One list of surfaces for the whole part.
//
// The face finder gives every face a surface of its own, fitted to that face's few triangles. A
// narrow strip cannot tell a cone from a leaning cylinder that way, so the same rib comes out
// differently each time it is repeated, and one cone is written once per face with slightly
// different numbers. A design is the other way round: a few surfaces, used by many faces.
//
//   1. Axes and directions: where two or more faces that reach at least half way round their own
//      axis agree on it, that line is one the part is built round (parallel alone: a direction).
//   2. A cylinder or cone whose points lie on a straight line swept round such an axis, or on a
//      circle swept along such a direction, is read as that surface (unless it shows its own
//      axis: a witness keeps its fit).
//   3. Pool: the same plane, cylinder, cone, sphere or torus found twice is one surface, fitted
//      again to every point it now has. A flat piece of a triangle or three is not a surface
//      found: it is what was left where nothing was, and is not pooled.
//   4. Each of those loose triangles, and each triangle of a flat strip (which shows no more than
//      two straight lines), asks the list: the surface that holds its corners exactly and faces
//      its way takes it, the one backed by the most area first, where that makes it more of a
//      face found on that surface. A triangle on a face that proved its own surface stays.
//      A face is then a connected set of triangles on one listed surface.
//
// Faces on one listed surface share the surface object itself, so the file holds it once.
//
// This runs after the sheets are fitted, and takes nothing from them.

import { type V3, basis, dot, madd, solve, sub } from './linalg';
import { type Mesh, triCentroid, triNormal, triVerts, vtx } from './mesh';
import { cornersOf } from './segment';
import { type Analytic, type Cone, type Cylinder, type Surface, distance, normalAt, refine } from './surfaces';

type Face = { tris: number[]; surf: Surface | null; err: number };

/** A line the part is built round, or (without `o`) a direction it is drawn along. */
export type Frame = { a: V3; o?: V3; witnesses: number };

/** How nearly a triangle must face the way the surface does at its middle, as a cosine. */
const FACING = 0.9;
/** How far round its own axis a face must reach to say where that axis is. */
const WITNESS_ROUND = Math.PI;
/** Two axes are one if as good as parallel (1 - cosine) and this close where the faces are (mm). */
const SAME_TILT = 1e-7, SAME_AXIS = 2e-3;
/** A straight profile leaning less than this from end to end (mm) is a cylinder, not a cone. */
const FLAT_LINE = 4e-4;
/** A face this many tolerances off a surface of its own kind may still be the same one: the two are fitted together to find out. */
const NEAR = 20;
/** Fits tried, and failed, to join more faces to one surface before it is left as it is. */
const JOIN_MISSES = 12;
/** A flat piece of this many triangles or fewer is a loose facet, as the stages after this one count it too. */
const FACET = 3;
/** A lone curved face of this many triangles or fewer is too little to take loose triangles. */
const SCRAP = 16;
/** A triangle may turn, or bow, this many times what the surface's own facets do, and this much more (radians). */
const EVEN = 3, EVEN_TURN = 0.035;
/** Cells per unit of a plane's normal in the table that finds planes facing one way. */
const CELLS = 128;

const isAnalytic = (s: Surface | null): s is Analytic =>
  s !== null && (s.kind === 'plane' || s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'sphere' || s.kind === 'torus');

/** The faces again, each on a surface from one list for the whole part, and the part's axes and directions. */
export function listSurfaces<R extends Face>(
  m: Mesh, found: R[],
  /** `alone`: loose triangles on a listed surface make a face of their own where no found face is among them (see below). */
  opt: { eps: number; chord: number; alone?: boolean },
): { regions: R[]; axes: Frame[]; directions: Frame[] } {
  const nT = m.tri.length / 3;
  // An exporter puts every vertex on its surface to float precision: a listed surface holds a
  // point within the point tolerance or not at all.
  const tol = opt.eps;
  const P = (v: number) => vtx(m.pos, v);
  const vertsOf = (tris: number[]) => [...new Set(tris.flatMap((t) => triVerts(m, t)))];
  const areaOf = (tris: number[]) => tris.reduce((a, t) => a + m.area[t], 0);
  const worst = (s: Surface, verts: Iterable<number>) => { let e = 0; for (const v of verts) e = Math.max(e, Math.abs(distance(s, P(v)))); return e; };
  const within = (s: Surface, verts: Iterable<number>, limit: number) => { for (const v of verts) if (Math.abs(distance(s, P(v))) > limit) return false; return true; };
  const faces = (s: Surface, tris: number[]) => tris.every((t) => Math.abs(dot(triNormal(m, t), normalAt(s, triCentroid(m, t)))) > FACING);
  /** Mean distance of the triangles' middles from the surface: what tells two surfaces through the same points apart. */
  const middles = (s: Surface, tris: number[]) => tris.reduce((a, t) => a + Math.abs(distance(s, triCentroid(m, t))), 0) / tris.length;

  const label = new Int32Array(nT).fill(-1);
  found.forEach((r, i) => r.tris.forEach((t) => (label[t] = i)));
  const verts = found.map((r) => vertsOf(r.tris));
  const area = found.map((r) => areaOf(r.tris));
  const surfs: (Surface | null)[] = found.map((r) => r.surf);

  // 1. Axes and directions.
  const { axes, directions, witnesses } = framesOf(m, found, verts, area);

  // 2. Cylinders and cones read about them. Not a witness: a face that reaches half way round
  // its own axis shows where that is better than another face's axis can tell it.
  found.forEach((r, i) => {
    const s = surfs[i];
    if (!s || (s.kind !== 'cylinder' && s.kind !== 'cone') || witnesses.has(i)) return;
    const pts = verts[i].map(P);
    for (const frame of [...axes, ...directions]) {
      const cand = frame.o ? aboutAxis(frame.a, frame.o, pts) : alongDirection(frame.a, pts);
      if (!cand || !within(cand, verts[i], tol) || !faces(cand, r.tris)) continue;
      if (r.tris.some((t) => Math.abs(distance(cand, triCentroid(m, t))) > opt.chord)) continue;
      // Not where the face's own surface lies clearly closer to its facets: that one shows a bend this one lacks.
      const mine = middles(s, r.tris), theirs = middles(cand, r.tris);
      if (mine < 0.5 * theirs && theirs - mine > 10 * opt.eps) continue;
      surfs[i] = cand;
      frameOf.set(cand, frame);
      break;
    }
  });

  // 3. Pool, most area first: the largest face of a surface fitted it best.
  type Pool = { id: number; surf: Analytic; members: number[]; verts: Set<number>; area: number; tris: number; misses: number; turn: number; bow: number };
  const pools: Pool[] = [];
  const poolOf = new Int32Array(found.length).fill(-1);
  const byKind = new Map<string, Pool[]>();
  const planes = new Map<string, Pool[]>();
  const cell = (n: V3, sign: number) => [Math.round(sign * n[0] * CELLS), Math.round(sign * n[1] * CELLS), Math.round(sign * n[2] * CELLS)];
  /** The planes facing about the way n does, or the opposite way: each is kept under both. */
  const planesNear = (n: V3): Pool[] => {
    const [a, b, c] = cell(n, 1);
    const out: Pool[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const list = planes.get(`${a + i},${b + j},${c + k}`);
      if (list) for (const p of list) out.push(p);
    }
    return out;
  };
  const keep = (table: Map<string, Pool[]>, key: string, p: Pool) => { const list = table.get(key); if (list) list.push(p); else table.set(key, [p]); };
  const refit = (p: Pool, extra: number[] = []): Analytic | null => {
    const all = [...p.verts, ...extra];
    const pts = all.map(P);
    const frame = frameOf.get(p.surf);
    const about = frame ? (frame.o ? aboutAxis(frame.a, frame.o, pts) : alongDirection(frame.a, pts)) : null;
    if (about && about.kind === p.surf.kind && within(about, all, tol)) { frameOf.set(about, frame!); return about; }
    const free = refine(p.surf, pts);
    return within(free, all, tol) ? free : null;
  };
  const loose = (i: number) => surfs[i]?.kind === 'plane' && found[i].tris.length <= FACET;
  const order = found.map((_, i) => i).filter((i) => isAnalytic(surfs[i]) && !loose(i)).sort((x, y) => area[y] - area[x] || x - y);
  for (const i of order) {
    const s = surfs[i] as Analytic, r = found[i];
    const near = s.kind === 'plane' ? planesNear(s.n).sort((x, y) => x.id - y.id) : byKind.get(s.kind) ?? [];
    let home = near.find((p) => within(p.surf, verts[i], tol) && faces(p.surf, r.tris));
    if (!home) {
      // Two fits of one surface from two small faces differ by more than a point's tolerance a long
      // way from either, so a face close to a surface is tried with it: one fit to both.
      for (const p of near) {
        if (p.misses >= JOIN_MISSES || !within(p.surf, verts[i], NEAR * tol) || !faces(p.surf, r.tris)) continue;
        const both = refit(p, verts[i]);
        if (!both || !faces(both, r.tris)) { p.misses++; continue; }
        p.surf = both;
        home = p;
        break;
      }
    }
    if (!home) {
      home = { id: pools.length, surf: s, members: [], verts: new Set(), area: 0, tris: 0, misses: 0, turn: -1, bow: -1 };
      pools.push(home);
      if (s.kind === 'plane') for (const sign of [1, -1]) keep(planes, cell(s.n, sign).join(','), home);
      else keep(byKind, s.kind, home);
    }
    home.members.push(i);
    home.area += area[i];
    home.tris += r.tris.length;
    for (const v of verts[i]) home.verts.add(v);
    poolOf[i] = home.id;
  }
  // Each pooled surface once more from every point it has.
  for (const p of pools) if (p.members.length > 1) p.surf = refit(p) ?? p.surf;

  // 4. Every loose triangle to the best-backed listed surface that holds it.
  /** How much the surface's own facets turn and bow: a triangle that does far more is not one of them. */
  const evenness = (p: Pool) => {
    if (p.turn >= 0) return;
    if (p.surf.kind === 'plane') { p.turn = 0; p.bow = 0; return; }
    const turns: number[] = [], bows: number[] = [];
    for (const i of p.members) for (const t of found[i].tris) { turns.push(turnOf(p.surf, t)); bows.push(Math.abs(distance(p.surf, triCentroid(m, t)))); }
    turns.sort((x, y) => x - y);
    bows.sort((x, y) => x - y);
    // A low quantile, as the face finder does: the widest facets must not set the bar.
    p.turn = turns[Math.floor(turns.length / 4)];
    p.bow = bows[Math.floor(bows.length / 4)];
  };
  const turnOf = (s: Analytic, t: number) => {
    const n = triNormal(m, t);
    let most = 0;
    for (const v of triVerts(m, t)) most = Math.max(most, Math.acos(Math.min(1, Math.abs(dot(n, normalAt(s, P(v)))))));
    return most;
  };
  const holds = (p: Pool, t: number) => {
    const s = p.surf;
    for (const v of triVerts(m, t)) if (Math.abs(distance(s, P(v))) > tol) return false;
    if (s.kind === 'plane') return Math.acos(Math.min(1, Math.abs(dot(triNormal(m, t), s.n)))) <= EVEN_TURN;
    evenness(p);
    const bow = Math.abs(distance(s, triCentroid(m, t)));
    if (bow > opt.chord || bow > EVEN * p.bow + tol) return false;
    return turnOf(s, t) <= EVEN * p.turn + EVEN_TURN;
  };
  // Only a surface that holds its own faces exactly has a say over other triangles: one fitted on
  // a loosened tolerance (or to a stretch of something free-form) is believed for its own face alone.
  const exactOf = pools.map((p) => within(p.surf, p.verts, tol));
  const exact = (p: Pool) => exactOf[p.id];
  const curved = pools.filter((p) => p.surf.kind !== 'plane' && (p.members.length > 1 || p.tris > SCRAP) && exact(p)).sort((x, y) => y.area - x.area);
  // A flat piece with four corners or fewer lies between two straight lines, and so on every
  // ruled surface through them: it is flat for want of evidence, and a curved surface may have it.
  const strip = (i: number) => surfs[i]?.kind === 'plane' && !loose(i) && cornersOf(m, found[i].tris[0], verts[i], opt.eps) <= 4;
  // Where each triangle goes: a pooled surface, or (past them) the face it was in, which keeps it.
  const to = new Int32Array(nT);
  found.forEach((r, i) => {
    const facet = loose(i), strips = !facet && strip(i);
    for (const t of r.tris) {
      to[t] = poolOf[i] < 0 ? pools.length + i : poolOf[i];
      if (!facet && !strips) continue;
      let best = curved.find((p) => holds(p, t));
      if (facet) for (const p of planesNear(triNormal(m, t))) if ((!best || p.area > best.area) && exact(p) && holds(p, t)) best = p;
      if (best) to[t] = best.id;
    }
  });

  // Loose triangles stay with a surface only as more of a face that was found on it. A stretch of
  // them with no such face among them would be a face of its own bounded by mesh edges alone, and
  // those cut straight across a curved surface: until a border gets a curve of its own, that
  // trades a wrong surface for loose edges.
  const seen = new Uint8Array(nT);
  for (let t0 = 0; t0 < nT; t0++) {
    if (seen[t0] || to[t0] >= pools.length) continue;
    const part = [t0];
    seen[t0] = 1;
    for (let k = 0; k < part.length; k++) for (let e = 0; e < 3; e++) {
      const w = m.adj[part[k] * 3 + e];
      if (w < 0 || seen[w] || to[w] !== to[t0]) continue;
      seen[w] = 1;
      part.push(w);
    }
    if (opt.alone || part.some((t) => poolOf[label[t]] === to[t0])) continue;
    for (const t of part) to[t] = poolOf[label[t]] < 0 ? pools.length + label[t] : poolOf[label[t]];
  }

  // Faces: connected triangles on one surface, in the order the faces came in.
  const faceOf = new Int32Array(nT).fill(-1);
  const out: R[] = [];
  for (const [i, r] of found.entries()) {
    for (const t0 of r.tris) {
      if (faceOf[t0] >= 0) continue;
      const id = out.length;
      const tris = [t0];
      faceOf[t0] = id;
      for (let k = 0; k < tris.length; k++) for (let e = 0; e < 3; e++) {
        const w = m.adj[tris[k] * 3 + e];
        if (w < 0 || faceOf[w] >= 0 || to[w] !== to[t0]) continue;
        faceOf[w] = id;
        tris.push(w);
      }
      const p = to[t0] < pools.length ? pools[to[t0]] : null;
      const surf = p ? p.surf : r.surf;
      // The face as it came in, if nothing about it changed.
      const same = surf === r.surf && tris.length === r.tris.length && tris.every((t) => label[t] === i);
      out.push(same ? r : { ...r, tris, surf, err: surf ? worst(surf, vertsOf(tris)) : r.err });
    }
  }
  return { regions: out, axes, directions };
}

/** Which axis or direction a surface was read about, so that it is fitted about it again when it gains points. */
const frameOf = new WeakMap<Analytic, Frame>();

/** The axes and directions that two or more faces reaching half way round their own axis agree on. */
function framesOf(m: Mesh, found: Face[], verts: number[][], area: number[]): { axes: Frame[]; directions: Frame[]; witnesses: Set<number> } {
  const lines: { a: V3; o: V3; area: number }[] = [];
  const witnesses = new Set<number>();
  found.forEach((r, i) => {
    const s = r.surf;
    if (!s || (s.kind !== 'cylinder' && s.kind !== 'cone' && s.kind !== 'torus')) return;
    const o = s.kind === 'cylinder' ? s.o : s.kind === 'cone' ? s.apex : s.c;
    const [e1, e2] = basis(s.a);
    let mean: V3 = [0, 0, 0];
    const ang = verts[i].map((v) => {
      const d = sub(vtx(m.pos, v), o);
      mean = madd(mean, d, 1 / verts[i].length);
      return Math.atan2(dot(d, e2), dot(d, e1));
    }).sort((x, y) => x - y);
    let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
    for (let k = 1; k < ang.length; k++) gap = Math.max(gap, ang[k] - ang[k - 1]);
    if (2 * Math.PI - gap < WITNESS_ROUND) return;
    // The axis where the face is: a cone's tip can be a long way off along it.
    lines.push({ a: s.a, o: madd(o, s.a, dot(mean, s.a)), area: area[i] });
    witnesses.add(i);
  });
  lines.sort((x, y) => y.area - x.area);
  const axes: Frame[] = [], directions: Frame[] = [];
  for (const l of lines) {
    const parallel = (f: Frame) => Math.abs(dot(f.a, l.a)) > 1 - SAME_TILT;
    const d = directions.find(parallel);
    if (d) d.witnesses++; else directions.push({ a: l.a, witnesses: 1 });
    const x = axes.find((f) => {
      if (!parallel(f)) return false;
      const off = sub(l.o, f.o!);
      return Math.hypot(...madd(off, f.a, -dot(off, f.a))) <= SAME_AXIS;
    });
    if (x) x.witnesses++; else axes.push({ a: l.a, o: l.o, witnesses: 1 });
  }
  const sure = (list: Frame[]) => list.filter((f) => f.witnesses > 1).sort((x, y) => y.witnesses - x.witnesses);
  return { axes: sure(axes), directions: sure(directions), witnesses };
}

/** The cylinder or cone about the axis whose straight profile passes nearest the points, or null where they show no profile. */
function aboutAxis(a: V3, o: V3, pts: V3[]): Cylinder | Cone | null {
  let mh = 0, mr = 0, lo = Infinity, hi = -Infinity;
  const q = pts.map((p) => {
    const d = sub(p, o), h = dot(d, a), rho = Math.hypot(...madd(d, a, -h));
    mh += h / pts.length; mr += rho / pts.length;
    lo = Math.min(lo, h); hi = Math.max(hi, h);
    return [h, rho];
  });
  let shh = 0, shr = 0;
  for (const [h, rho] of q) { shh += (h - mh) ** 2; shr += (h - mh) * (rho - mr); }
  // All at one height: a ring, which every surface about the axis passes through.
  if (!(shh > 1e-9) || !(mr > 0)) return null;
  const lean = shr / shh;
  if (Math.abs(lean) * (hi - lo) <= FLAT_LINE) return { kind: 'cylinder', o, a, r: mr };
  const ang = Math.atan(Math.abs(lean));
  if (!(ang > 0.01 && ang < Math.PI / 2 - 0.01)) return null;
  return { kind: 'cone', apex: madd(o, a, mh - mr / lean), a: lean > 0 ? a : [-a[0], -a[1], -a[2]], ang };
}

/** The cylinder along the direction through the points, or null where they show no circle. */
function alongDirection(a: V3, pts: V3[]): Cylinder | null {
  const [e1, e2] = basis(a);
  const o = pts[0];
  // Algebraic circle x² + y² + Dx + Ey + F = 0 in the plane across the direction, about the first point.
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  let reach = 0;
  for (const p of pts) {
    const d = sub(p, o), x = dot(d, e1), y = dot(d, e2), row = [x, y, 1], rhs = -(x * x + y * y);
    reach = Math.max(reach, Math.hypot(x, y));
    for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]; }
  }
  const s = solve(A, b);
  if (!s) return null;
  const cx = -s[0] / 2, cy = -s[1] / 2, r2 = cx * cx + cy * cy - s[2];
  // (The same bound the face finder puts on a cylinder: one far wider than what shows it is flat.)
  if (!(r2 > 0) || Math.sqrt(r2) > 50 * reach + 1000) return null;
  return { kind: 'cylinder', o: madd(madd(o, e1, cx), e2, cy), a, r: Math.sqrt(r2) };
}
