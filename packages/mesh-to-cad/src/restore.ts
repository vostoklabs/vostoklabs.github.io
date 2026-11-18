// Exact faces given back from a free-form patch.
//
// The border map trusts a flat face only if its outline has five corners or more, because a strip
// of a round, one row of the mesh wide, is flat and has four. But a chamfer running the length of
// a groove is a long rectangle too: four corners. So a groove the face finder read exactly (its
// rounds as cylinders, its chamfers and walls as flats) is not trusted, and the border map joins
// it all into one free-form patch to be covered by a sheet.
//
// Inside each free-form patch, the faces the finder read exactly come back where they show their
// surface: a cylinder, cone, torus or sphere whose points reach more than two rings, and a flat
// face lying along the axis of such a cylinder (the groove's own direction) or with five corners.
// Each then takes the patch's triangles that lie on its surface, next to it, and only what is
// left of the patch stays free-form.

import { type V3, basis, dot, norm, sub } from './linalg';
import { type Mesh, connected, triCentroid, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions, cornersOf } from './segment';
import { type Surface, distance } from './surfaces';
import { fitCircle } from './frames';

/** Cross-section points a curved face must reach to show its surface (two rings fit anything). */
const SHOWS = 3;
/** Points closer than this in a cross-section are one (float precision; mm). */
const SAME_POINT = 5e-5;
/** A flat strip this many times wider than the triangles beside it is a face, not a strip of a round. */
const WIDER = 4;

/** The free-form patches with the exact faces in them given back. */
export function restoreExact(m: Mesh, faces: Region[], found: Region[], source: Int32Array, opt: SegmentOptions): Region[] {
  // The directions the part's exact cylinders run in: a round read a little askew is read again
  // along them (a groove's rounds all run the way the groove does).
  const dirs = partDirections(found, opt.eps);
  const out: Region[] = [];
  for (const f of faces) {
    if (f.surf) { out.push(f); continue; }
    out.push(...restorePatch(m, f.tris, found, source, opt, dirs));
  }
  return out;
}

/**
 * A cylinder along one of the part's directions through the triangles, if one holds them: their
 * points seen along the direction lie on one circle. Null if none does.
 */
function cylinderAlong(m: Mesh, tris: number[], dirs: V3[], holds: (s: Surface) => boolean): Surface | null {
  const vs = [...new Set(tris.flatMap((t) => triVerts(m, t)))].map((v) => vtx(m.pos, v));
  for (const d of dirs) {
    const [u, w] = basis(d);
    const pts = vs.map((p) => [dot(p, u), dot(p, w)] as [number, number]);
    const kept: [number, number][] = [];
    for (const p of pts) if (!kept.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= SAME_POINT)) kept.push(p);
    if (kept.length < SHOWS) continue;
    const c = fitCircle(kept);
    if (!c || c.r > CIRCLE_OF_SPREAD * spread(kept)) continue;
    const s: Surface = { kind: 'cylinder', o: [u[0] * c.cr + w[0] * c.ch, u[1] * c.cr + w[1] * c.ch, u[2] * c.cr + w[2] * c.ch], a: d, r: c.r };
    if (holds(s)) return s;
  }
  return null;
}

function restorePatch(m: Mesh, tris: number[], found: Region[], source: Int32Array, opt: SegmentOptions, dirs: V3[]): Region[] {
  const P = (v: number) => vtx(m.pos, v);
  const on = (s: Surface, t: number) =>
    triVerts(m, t).every((v) => Math.abs(distance(s, P(v))) <= opt.eps) && Math.abs(distance(s, triCentroid(m, t))) <= opt.chord;
  // The found faces in the patch, by their part of it.
  const parts = new Map<number, number[]>();
  for (const t of tris) parts.set(source[t], [...(parts.get(source[t]) ?? []), t]);
  const exact = (i: number, ts: number[]) => {
    const s = found[i].surf;
    return !!s && (s.kind === 'plane' || s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'torus' || s.kind === 'sphere') && ts.every((t) => on(s, t));
  };
  // Curved faces that show their surface; their directions say which way the patch runs.
  const seeds: { surf: Surface; tris: number[] }[] = [];
  const axes: [number, number, number][] = [];
  for (const [i, ts] of parts) {
    const s = found[i].surf;
    if (!s || s.kind === 'plane') continue;
    if (exact(i, ts) && showsCurve(m, s, ts)) {
      seeds.push({ surf: s, tris: ts });
      if (s.kind === 'cylinder') axes.push(s.a);
      continue;
    }
    // A cylinder fitted a little askew (a strip whose vertices sit only at its two ends pins its
    // axis badly) read again along the part's own directions.
    if (s.kind !== 'cylinder') continue;
    const along = cylinderAlong(m, ts, dirs, (c) => ts.every((t) => on(c, t)) && showsCurve(m, c, ts));
    if (!along) continue;
    seeds.push({ surf: along, tris: ts });
    axes.push((along as { a: V3 }).a);
  }
  // Flat faces: along a cylinder's axis (a groove's walls and chamfers), with five corners, or
  // a strip several times wider than the strips beside it. A strip of a round, one row wide, is
  // as wide as the next strip of that round; a chamfer between two rounds is many of theirs.
  const inPatchSet = new Set(tris);
  const width = (t: number) => {
    const [a, b, c] = triVerts(m, t).map((v) => vtx(m.pos, v));
    const longest = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    return longest > 0 ? (2 * m.area[t]) / longest : 0;
  };
  // (Lying along the groove is not enough on its own: one strip of a round running the groove's
  // length lies along it too, and a round read that way comes out as a stack of thin flats.)
  for (const [i, ts] of parts) {
    const s = found[i].surf;
    if (!s || s.kind !== 'plane' || ts.length < 2 || !exact(i, ts)) continue;
    const vs = [...new Set(ts.flatMap((t) => triVerts(m, t)))];
    if (cornersOf(m, ts[0], vs, opt.eps) < 5 && !widerThanBeside(ts)) continue;
    seeds.push({ surf: s, tris: ts });
  }
  void axes;
  /** Whether a flat strip is many times wider than the triangles along its sides (see above). */
  function widerThanBeside(ts: number[]): boolean {
    const mine = new Set(ts);
    const area = ts.reduce((a, t) => a + m.area[t], 0);
    // The strip's own width: its area over its length (its longest triangle side).
    const length = Math.max(...ts.map((t) => { const [a, b, c] = triVerts(m, t).map((v) => vtx(m.pos, v)); return Math.max(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])); }));
    const own = length > 0 ? area / length : 0;
    const beside: number[] = [];
    for (const t of ts) for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w >= 0 && !mine.has(w) && inPatchSet.has(w)) beside.push(width(w)); }
    if (!beside.length) return false;
    beside.sort((x, y) => x - y);
    return own >= WIDER * beside[beside.length >> 1];
  }
  // Each seed takes the triangles next to it that lie on its surface, the largest first.
  seeds.sort((a, b) => b.tris.length - a.tris.length);
  const owner = new Map<number, number>();
  seeds.forEach((s, k) => s.tris.forEach((t) => { if (!owner.has(t)) owner.set(t, k); }));
  const inPatch = new Set(tris);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tris) {
      if (owner.has(t)) continue;
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        const by = w >= 0 && inPatch.has(w) ? owner.get(w) : undefined;
        if (by === undefined || !on(seeds[by].surf, t)) continue;
        owner.set(t, by);
        grew = true;
        break;
      }
    }
  }
  const out: Region[] = [];
  seeds.forEach((s, k) => {
    const mine = tris.filter((t) => owner.get(t) === k);
    for (const part of connected(m, mine)) out.push({ tris: part, surf: s.surf, err: worst(m, s.surf, part) });
  });
  // What is left may still be rounds running along the part's directions, strip by strip: grown
  // into cylinders triangle by triangle before anything is left free-form.
  const left = tris.filter((t) => !owner.has(t));
  for (const part of connected(m, left)) out.push(...cylindersAlong(m, part, dirs, on));
  return out;
}

/**
 * Cylinders along the part's directions grown over a set of triangles, the rest left free-form.
 * From each triangle not yet taken, its neighbours are added one at a time; once the triangles
 * seen along a direction reach three points of a cross-section a circle is fitted, and a
 * neighbour is kept only if the circle's cylinder still holds every triangle taken.
 */
function cylindersAlong(m: Mesh, tris: number[], dirs: V3[], loose: (s: Surface, t: number) => boolean): Region[] {
  const out: Region[] = [];
  const free = new Set(tris);
  const P = (v: number) => vtx(m.pos, v);
  // Held as a sheet is: a strip's middle within SAG of the cylinder, so a flat strip between two
  // lines is never read as a tiny tube through both (a 0.1 mm wall as a 0.05 mm cylinder).
  const on = (s: Surface, t: number) => loose(s, t) && Math.abs(distance(s, triCentroid(m, t))) <= SAG;
  for (const seed of tris) {
    if (!free.has(seed)) continue;
    let made: { tris: number[]; surf: Surface } | null = null;
    for (const d of dirs) {
      const [u, w] = basis(d);
      const flat = (t: number) => triVerts(m, t).map((v) => { const p = P(v); return [dot(p, u), dot(p, w)] as [number, number]; });
      const group = [seed], pts: [number, number][] = [];
      const addPts = (t: number) => { for (const p of flat(t)) if (!pts.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= SAME_POINT)) pts.push(p); };
      addPts(seed);
      let surf: Surface | null = null;
      const inGroup = new Set(group);
      for (let i = 0; i < group.length; i++) for (let k = 0; k < 3; k++) {
        const nb = m.adj[group[i] * 3 + k];
        if (nb < 0 || !free.has(nb) || inGroup.has(nb)) continue;
        const before = pts.length;
        addPts(nb);
        if (pts.length < SHOWS) { group.push(nb); inGroup.add(nb); continue; }
        const c = fitCircle(pts);
        // Points along a nearly straight strip fit a circle of any size: a 0.1 mm wall read as a
        // cylinder 228 mm wide. A round is no wider than a few times the arc it shows.
        const s: Surface | null = c && c.r <= CIRCLE_OF_SPREAD * spread(pts) ? { kind: 'cylinder', o: [u[0] * c.cr + w[0] * c.ch, u[1] * c.cr + w[1] * c.ch, u[2] * c.cr + w[2] * c.ch], a: d, r: c.r } : null;
        if (s && [...group, nb].every((t) => on(s, t))) { group.push(nb); inGroup.add(nb); surf = s; continue; }
        pts.length = before;
      }
      if (surf && group.length >= 4 && group.every((t) => on(surf!, t))) { made = { tris: group, surf }; break; }
    }
    if (!made) continue;
    for (const t of made.tris) free.delete(t);
    out.push({ tris: made.tris, surf: made.surf, err: worst(m, made.surf, made.tris) });
  }
  for (const part of connected(m, [...free])) out.push({ tris: part, surf: null, err: 0 });
  return out;
}

/** How far the middle of a triangle may sit off a cylinder grown over it (mm): what a sheet is held to. */
const SAG = 0.02;
/** A circle fitted to cross-section points may be no wider than this many times their spread. */
const CIRCLE_OF_SPREAD = 4;
const spread = (pts: [number, number][]) => {
  let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
  for (const [a, b] of pts) { lo0 = Math.min(lo0, a); hi0 = Math.max(hi0, a); lo1 = Math.min(lo1, b); hi1 = Math.max(hi1, b); }
  return Math.hypot(hi0 - lo0, hi1 - lo1);
};

/** A flat face this many triangles or fewer may be one strip of a round. */
const STRIP_TRIS = 4;

/**
 * Thin flat strips side by side, each one row of a round running along one of the part's
 * directions (a groove's round meshed in long triangles, each strip a face of its own), grown
 * into the cylinder they are on. Triangles no cylinder takes stay in the faces they were in.
 */
export function stripsToCylinders(m: Mesh, faces: Region[], dirs: V3[], opt: SegmentOptions): Region[] {
  if (!dirs.length) return faces;
  const P = (v: number) => vtx(m.pos, v);
  const on = (s: Surface, t: number) =>
    triVerts(m, t).every((v) => Math.abs(distance(s, P(v))) <= opt.eps) && Math.abs(distance(s, triCentroid(m, t))) <= opt.chord;
  const strip = (f: Region) => f.surf?.kind === 'plane' && f.tris.length <= STRIP_TRIS;
  const pool = faces.flatMap((f) => (strip(f) ? f.tris : []));
  if (!pool.length) return faces;
  const made = connected(m, pool).flatMap((part) => cylindersAlong(m, part, dirs, on)).filter((r) => r.surf);
  if (!made.length) return faces;
  const taken = new Set(made.flatMap((r) => r.tris));
  const out: Region[] = [];
  for (const f of faces) {
    const left = f.tris.filter((t) => !taken.has(t));
    if (left.length === f.tris.length) { out.push(f); continue; }
    for (const part of connected(m, left)) out.push({ ...f, tris: part });
  }
  return [...out, ...made];
}

/** The directions the part's exact cylinders run in (a groove's rounds all run the way it does). */
export function partDirections(found: Region[], eps: number): V3[] {
  const dirs: V3[] = [];
  for (const f of found) {
    const s = f.surf;
    if (s?.kind !== 'cylinder' || f.tris.length < 10 || f.err > eps) continue;
    if (!dirs.some((d) => 1 - Math.abs(dot(d, s.a)) < 1e-6)) dirs.push(s.a);
  }
  return dirs;
}

/**
 * A cylinder that misses its own points by more than the point tolerance read again along the
 * part's directions: a round read from a strip whose vertices sit only at its two ends gets its
 * axis a little askew (a groove's r 0.2 round, 0.0014 mm off), and along the groove it is exact.
 */
export function refitAlong(m: Mesh, faces: Region[], dirs: V3[], opt: SegmentOptions): Region[] {
  const P = (v: number) => vtx(m.pos, v);
  const on = (s: Surface, t: number) =>
    triVerts(m, t).every((v) => Math.abs(distance(s, P(v))) <= opt.eps) && Math.abs(distance(s, triCentroid(m, t))) <= opt.chord;
  return faces.map((f) => {
    if (f.surf?.kind !== 'cylinder' || f.err <= opt.eps) return f;
    const s = cylinderAlong(m, f.tris, dirs, (c) => f.tris.every((t) => on(c, t)));
    return s ? { tris: f.tris, surf: s, err: worst(m, s, f.tris) } : f;
  });
}

function worst(m: Mesh, s: Surface, tris: number[]): number {
  let e = 0;
  for (const t of tris) for (const v of triVerts(m, t)) e = Math.max(e, Math.abs(distance(s, vtx(m.pos, v))));
  return e;
}

/**
 * Whether a curved face's points show its surface: more than two distinct points in its own
 * cross-section (along a cylinder's axis; round a cone's, torus's or sphere's axis or centre).
 */
function showsCurve(m: Mesh, s: Surface, tris: number[]): boolean {
  const vs = [...new Set(tris.flatMap((t) => triVerts(m, t)))].map((v) => vtx(m.pos, v));
  const section: [number, number][] = [];
  for (const p of vs) {
    if (s.kind === 'cylinder') {
      // Seen along the axis: two coordinates across it.
      const [u, w] = basis(s.a);
      const d = sub(p, s.o);
      section.push([dot(d, u), dot(d, w)]);
    } else {
      const o = s.kind === 'cone' ? s.apex : s.kind === 'torus' ? s.c : s.kind === 'sphere' ? s.c : null;
      const a = s.kind === 'cone' || s.kind === 'torus' ? s.a : null;
      if (!o) return false;
      if (!a) return tris.length >= 20; // a sphere: no axis to read it round; a face of some size
      const d = sub(p, o), h = dot(d, a);
      section.push([norm([d[0] - h * a[0], d[1] - h * a[1], d[2] - h * a[2]]), h]);
    }
  }
  const kept: [number, number][] = [];
  for (const p of section) if (!kept.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= SAME_POINT)) { kept.push(p); if (kept.length >= SHOWS) return true; }
  return false;
}
