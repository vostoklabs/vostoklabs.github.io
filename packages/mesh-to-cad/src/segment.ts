// Splits a CAD-tessellated mesh into the faces it was drawn with, each on one analytic surface.
//
// A CAD exporter puts every vertex exactly on the surface it samples; only the triangle interiors
// cut corners (the chord error). So a face is a connected set of triangles whose vertices all sit
// within `eps` of one surface and whose centroids sit within `chord` of it.
//
//   1. Units: maximal connected sets of coplanar triangles — a flat face, one strip of a curved
//      face, or a single triangle of a curved face triangulated in a staggered pattern.
//   2. Curved faces: from a seed, gather the smallest neighbouring units until there are enough
//      points to pin a surface down (20), fit a cylinder, sphere, cone or torus, and if it fits,
//      grow over every smoothly joined unit that sits on the same surface.
//   3. Left-overs: units no seed reached (small faces) merge pairwise while the union still fits a
//      surface; whatever stays alone is a flat face.

import { type V3, add, basis, dot, eigSym3, normalize, scale, maxOf } from './linalg';
import { type Mesh, triCentroid, triNormal, triVerts, vtx } from './mesh';
import {
  type Analytic, type Cone, type Cylinder, type Sample, type Surface, distance, fitCone, fitCylinder, fitPlane, fitSphere, fitTorus, normalAt, refine,
} from './surfaces';

export type SegmentOptions = {
  /** How far a vertex may sit off its face's surface (mm). */
  eps: number;
  /** How far a triangle's centroid may sit off it (mm): the exporter's chord error, generously. */
  chord: number;
  /** Largest angle between neighbouring triangles that can still lie on one smooth surface. */
  smoothAngle: number;
};

export type Region = {
  tris: number[];
  /** null: no surface fits (free-form). */
  surf: Surface | null;
  /** Largest vertex distance from the surface (mm). */
  err: number;
  /** A round rebuilt from the faces it rolls between: its radius (mm). One face, whatever surface it gets. */
  round?: { r: number };
  /**
   * A face decided before the engine's reading runs, which that reading treats as fixed: a main
   * face loses no triangle (it may gain ones lying on it, and join a face on its surface); a round
   * neither loses nor gains one and is never joined to another face.
   */
  keep?: 'main' | 'round';
};

type Kind = Analytic['kind'];
const CURVED: Kind[] = ['cylinder', 'sphere', 'cone', 'torus'];
/** More general kinds a face can turn out to be once more of it is seen. */
const WIDER: Record<Kind, Kind[]> = { plane: [], cylinder: ['cone', 'torus'], sphere: ['torus'], cone: ['torus'], torus: [] };
/** Points a fit of each kind needs beyond its degrees of freedom before it is believed. */
const DOF: Record<Kind, number> = { plane: 3, cylinder: 5, sphere: 4, cone: 6, torus: 7 };
const SPARE = 3;
/**
 * Seeding passes, strongest evidence first: big faces claim their triangles from large
 * neighbourhoods before small ones are read from small neighbourhoods, which could otherwise
 * straddle two faces and fit a flexible surface (a cone, a torus) to both.
 */
const PASSES = [{ need: 40, least: 40 }, { need: 20, least: 20 }, { need: 12, least: 8 }];
/** How far off a face's surface a unit may stand, as a share of its own size, and still be tried as more of that face. */
const NEAR_WIDER = 0.5;
/** How far round its axis a curved face whose facets do not lie along the surface's straight lines must reach (see showsSurface). */
const SHOW_ROUND = (15 * Math.PI) / 180;
/** The share of a narrow face's height along its axis its median facet must span (see showsSurface). */
const SPAN = 0.45;
/** How alike two fits must be to be one design's numbers (see twins): axis direction (radians) and radius (share of it). */
const TWIN = { axis: (0.1 * Math.PI) / 180, radius: 1.2e-2 };
/** Units a neighbourhood being rebuilt may refuse before it has fitted anything. */
const REBUILD_MISSES = 4;

/**
 * Vertices where two curved faces cross sit only as close to either as the CAD program's own
 * curve between them, which is a fitted one: a few ten-thousandths of a millimetre off, and more
 * beside a blend. A face made of nothing but such vertices (the wall of a slanted hole) fails the
 * point tolerance though it is plainly that cylinder. So a curved fit may also be believed at up
 * to LOOSE off, if the evidence is of another order than its error: its facets bow off it many
 * times further than its vertices sit off it, it has points to spare, and they reach round enough
 * of the surface that nothing gently curved could pass for it. The bow has a limit too: no
 * exporter lets a facet stand for more than a small turn of its surface, so a surface that bows
 * off its facets by a large share of its own radius was never meshed by them (the sphere through
 * two rings of a blend balloons between them).
 */
const LOOSE = 5e-3;
/** The most a loosely fitted face's facets may bow off it, as a share of its radius: a facet turning through about 50 degrees. */
const BOW_OF_RADIUS = 0.1;
/** The share of its facets' mean bow that a loosely fitted face's vertices may sit off it. */
const BOW_SHARE = 0.25;
/** How far round a surface (between facet normals) a loose fit's points must reach. */
const LOOSE_TURN = (45 * Math.PI) / 180;
/**
 * The largest radius a loosely fitted face may have, as a multiple of its own size. A small
 * corner blend fits a torus with a tube far wider than the blend itself (a 0.9 mm corner read as
 * a 62 mm tube with a 0.2 mm hole), which no importer can trim. Exact fits are not held to it.
 */
const LOOSE_SIZE = 5;

/** `tol`: how far off its surface this face's vertices may sit (the point tolerance, or looser on evidence). */
/** `id`: its place in `faces`. */
type Face = { id: number; units: number[]; surf: Analytic; err: number; verts: Set<number>; fittedAt: number; tol: number };
type Fit = { surf: Analytic; err: number; tol: number };

export function segment(
  m: Mesh, opt: SegmentOptions, progress: (share: number) => void = () => {},
): { label: Int32Array; regions: Region[] } {
  const nT = m.tri.length / 3;
  const cosSmooth = Math.cos(opt.smoothAngle);
  const unitOf = planarSets(m, opt.eps);
  const nU = maxOf(unitOf) + 1;
  const units: { tris: number[]; verts: number[] }[] = Array.from({ length: nU }, () => ({ tris: [], verts: [] }));
  for (let t = 0; t < nT; t++) units[unitOf[t]].tris.push(t);
  for (const u of units) u.verts = [...new Set(u.tris.flatMap((t) => triVerts(m, t)))];
  const nbrs: Set<number>[] = Array.from({ length: nU }, () => new Set());
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0 || unitOf[w] === unitOf[t]) continue;
    if (dot(triNormal(m, t), triNormal(m, w)) < cosSmooth) continue;
    nbrs[unitOf[t]].add(unitOf[w]);
  }

  const unitArea = units.map((u) => u.tris.reduce((a, t) => a + m.area[t], 0));
  // A flat piece of five corners or more is a flat face. A strip of a curved face has four (two
  // rulings and the chords across their ends), while a flat disc meshed from its rim has all of
  // its vertices on one circle, which any coaxial curved surface also passes through.
  const flatFace = units.map((u) => cornersOf(m, u.tris[0], u.verts, opt.eps) >= 5);
  /**
   * An exporter steps evenly across a face, so each of its facets has a neighbour in the face of
   * about its own size. A wide flat face folded into a fake surface with its narrow neighbours
   * (symmetric strips fit a sphere or cylinder exactly) has none.
   */
  const evenUnits = (us: number[]) => {
    if (us.length < 2) return true;
    const inSet = new Set(us);
    return us.every((u) => [...nbrs[u]].some((n) => inSet.has(n) && Math.max(unitArea[u] / unitArea[n], unitArea[n] / unitArea[u]) <= 4));
  };
  const fitUnits = (us: number[]) => (evenUnits(us) && !us.some((u) => flatFace[u]) ? fitTris(m, trisOf(us), opt, CURVED, true) : null);
  const failed = new Set<string>();

  const faceOf = new Int32Array(nU).fill(-1);
  const faces: Face[] = [];
  const trisOf = (us: number[]) => us.flatMap((u) => units[u].tris);
  const unitFits = (f: Face, u: number) => (flatFace[u] ? null : fitsSurface(m, f.surf, units[u].tris, units[u].verts, opt, f.tol));

  const add = (f: Face, u: number, e: number) => {
    faceOf[u] = f.id;
    f.units.push(u);
    for (const v of units[u].verts) f.verts.add(v);
    f.err = Math.max(f.err, e);
  };

  const grow = (f: Face) => {
    for (let round = 0; round < 4; round++) {
      const queue = [...new Set(f.units.flatMap((u) => [...nbrs[u]]))].filter((u) => faceOf[u] < 0);
      const nearMiss: number[] = [];
      while (queue.length) {
        const u = queue.pop()!;
        if (faceOf[u] >= 0) continue;
        const e = unitFits(f, u);
        if (e === null) { nearMiss.push(u); continue; }
        add(f, u, e);
        for (const n of nbrs[u]) if (faceOf[n] < 0) queue.push(n);
        if (f.verts.size > f.fittedAt * 1.5) {
          const pts = [...f.verts].map((v) => vtx(m.pos, v));
          const s = refine(f.surf, pts);
          const e2 = fitsSurface(m, s, trisOf(f.units), [...f.verts], opt, f.tol);
          if (e2 !== null) { f.surf = s; f.err = e2; }
          f.fittedAt = f.verts.size;
        }
      }
      // The face may be a more general surface than the first patch showed (a shallow cone read
      // as a cylinder): try the wider kinds with each unit it could not take.
      let widened = false;
      const asked = new Set<number>();
      for (const u of nearMiss) {
        if (asked.has(u) || faceOf[u] >= 0 || !WIDER[f.surf.kind].length) continue;
        asked.add(u);
        // More of the same face under a wider surface lies close to the surface found so far,
        // for its size; the next face over stands well off it.
        const off = maxOf(units[u].verts.map((v) => Math.abs(distance(f.surf, vtx(m.pos, v)))));
        if (off > NEAR_WIDER * Math.sqrt(unitArea[u])) continue;
        const fit = fitTris(m, trisOf([...f.units, u]), opt, WIDER[f.surf.kind]);
        // Only on clear evidence: the wider kind must sit far closer than the tolerance.
        if (fit && fit.err <= opt.eps / 5) { f.surf = fit.surf; f.err = fit.err; f.tol = opt.eps; add(f, u, fit.err); widened = true; break; }
      }
      if (!widened) return;
    }
  };

  // Curved faces from seeds with enough points. Units with the most smooth neighbours go first:
  // they are inside a curved face rather than on its edge.
  const order = [...units.keys()].sort((a, b) => nbrs[b].size - nbrs[a].size || units[a].verts.length - units[b].verts.length);
  // Every pass and the left-overs each walk `order` once, which is what the progress bar counts.
  const visits = (PASSES.length + 1) * order.length;
  let visited = 0;
  PASSES.forEach(({ need, least }, pass) => {
    // A neighbourhood that fitted nothing is not tried again from each of its other units: across
    // a free-form area that would be every unit, each one asking for the same refusal.
    const spent = new Uint8Array(nU);
    // Only the smallest neighbourhoods are worth rebuilding unit by unit: a face too small for
    // this pass is found whole by the next.
    const rebuild = pass === PASSES.length - 1;
    for (const seed of order) {
      progress(visited++ / visits);
      if (faceOf[seed] >= 0 || spent[seed] || !nbrs[seed].size) continue;
      // The smallest faces are looked for from flat strips only. An exporter steps a cylinder, a
      // cone, a sphere or a torus along its own lines, which leaves flat four-sided strips; lone
      // triangles are how it meshes a free-form face, where a handful of points fits anything.
      if (rebuild && units[seed].tris.length < 2) continue;
      const hood = neighbourhood(seed, need, least);
      const found = hood && trimmedFit(hood, seed, least, rebuild);
      if (!found) {
        if (hood && !rebuild) for (const u of hood) spent[u] = 1;
        continue;
      }
      const f: Face = { id: faces.length, units: [], surf: found.fit.surf, err: 0, verts: new Set(), fittedAt: 0, tol: found.fit.tol };
      faces.push(f);
      for (const u of found.hood) add(f, u, found.fit.err);
      f.fittedAt = f.verts.size;
      grow(f);
    }
  });

  /** Free units around the seed, smallest first, until there are `need` vertices (or null below `least`). */
  function neighbourhood(seed: number, need: number, least: number): number[] | null {
    const got = [seed];
    const verts = new Set(units[seed].verts);
    const seen = new Set([seed]);
    const frontier = [...nbrs[seed]].filter((u) => faceOf[u] < 0);
    frontier.forEach((u) => seen.add(u));
    // Facets most like the seed first: an exporter steps evenly across one face, so its own
    // facets are about the same size, while the next face's usually are not.
    const a0 = unitArea[seed];
    const unlikeOf = new Map<number, number>();
    const unlike = (u: number) => { let x = unlikeOf.get(u); if (x === undefined) unlikeOf.set(u, (x = Math.abs(Math.log(unitArea[u] / a0)))); return x; };
    while (verts.size < need && frontier.length) {
      frontier.sort((a, b) => unlike(b) - unlike(a) || units[b].verts.length - units[a].verts.length);
      const u = frontier.pop()!;
      got.push(u);
      for (const v of units[u].verts) verts.add(v);
      for (const n of nbrs[u]) if (!seen.has(n) && faceOf[n] < 0) { seen.add(n); frontier.push(n); }
    }
    return verts.size >= least ? got : null;
  }

  /**
   * A neighbourhood often reaches over a face's edge into the next face. If it does not fit whole
   * and `rebuild` is asked for, it is gathered again unit by unit, keeping only what fits.
   */
  function trimmedFit(hood: number[], seed: number, least: number, rebuild: boolean): { hood: number[]; fit: Fit } | null {
    const vertsIn = (us: number[]) => new Set(us.flatMap((u) => units[u].verts)).size;
    const key = [...hood].sort((a, b) => a - b).join(',');
    if (failed.has(key)) return null;
    const whole = fitUnits(hood);
    if (whole) return { hood, fit: whole };
    // Rebuild it in the order it was gathered (most seed-like first), keeping a unit only if the
    // fit still holds with it; units before the fit has enough points are taken on trust.
    if (rebuild) {
      let cur = [seed];
      const inCur = new Set(cur);
      let fit: Fit | null = null;
      const pending = hood.slice(1);
      let misses = 0;
      for (let pass = 0; pass < 2 && (fit || misses < REBUILD_MISSES); pass++) {
        for (let i = 0; i < pending.length && (fit || misses < REBUILD_MISSES); i++) {
          const u = pending[i];
          if (u < 0 || ![...nbrs[u]].some((n) => inCur.has(n))) continue;
          const trial = [...cur, u];
          pending[i] = -1;
          if (vertsIn(trial) < least) { cur = trial; inCur.add(u); continue; }
          const f = fitUnits(trial);
          if (f) { cur = trial; inCur.add(u); fit = f; } else misses++;
        }
      }
      if (fit) return { hood: cur, fit };
    }
    failed.add(key);
    return null;
  }

  // Left-overs: small curved faces form by pairwise merging; the rest are flat.
  for (const u of order) {
    progress(visited++ / visits);
    if (faceOf[u] >= 0) continue;
    const f: Face = { id: faces.length, units: [], surf: fitPlane(units[u].verts.map((v) => vtx(m.pos, v))), err: 0, verts: new Set(), fittedAt: 0, tol: opt.eps };
    faces.push(f);
    add(f, u, 0);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of new Set(f.units.flatMap((x) => [...nbrs[x]]))) {
        if (faceOf[n] >= 0) continue;
        const fit = fitUnits([...f.units, n]);
        if (fit) { f.surf = fit.surf; f.err = fit.err; f.tol = fit.tol; add(f, n, fit.err); grew = true; }
      }
    }
  }

  // (Two seeds that raced across one face leave it in two pieces here. They are joined where the
  // whole part's surfaces are listed, in listed.ts.)

  // Final surfaces from every point of each face.
  const regions: Region[] = [];
  const label = new Int32Array(nT).fill(-1);
  const finals = faces.map((f) => {
    const tris = trisOf(f.units);
    const pts = [...f.verts].map((v) => vtx(m.pos, v));
    let surf = f.surf, err = f.err;
    const s = refine(f.surf, pts);
    const e = fitsSurface(m, s, tris, [...f.verts], opt, f.tol);
    if (e !== null) { surf = s; err = e; }
    return { f, tris, surf, err };
  });
  for (const { f, tris, surf, err } of finals) {
    // A face that does not show its surface is left as the flat facets it was made of.
    const twinned = () => finals.some((g) => g.f !== f && twins(surf, g.surf));
    // A loosely fitted face has to be in proportion to its surface here too: growing refits it,
    // and a refit can run away to a surface far larger than the face (see LOOSE_SIZE).
    const outsized = f.tol > opt.eps && largestRadius(surf) > LOOSE_SIZE * extent([...f.verts].map((v) => vtx(m.pos, v)));
    if (outsized || !showsSurface(m, surf, tris, [...f.verts], opt.eps, twinned)) {
      for (const u of f.units) {
        for (const t of units[u].tris) label[t] = regions.length;
        regions.push({ tris: units[u].tris, surf: fitPlane(units[u].verts.map((v) => vtx(m.pos, v))), err: 0 });
      }
      continue;
    }
    for (const t of tris) label[t] = regions.length;
    regions.push({ tris, surf: canonical(surf), err });
  }
  return { label, regions };
}

/** Corners of the outline of a flat piece: its vertices' convex hull in its own plane. */
export function cornersOf(m: Mesh, tri: number, verts: number[], eps: number): number {
  if (verts.length < 5) return verts.length;
  const [e1, e2] = basis(triNormal(m, tri));
  const pts = verts.map((v) => { const p = vtx(m.pos, v); return [dot(p, e1), dot(p, e2)] as [number, number]; })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // Monotone chain; a vertex within eps of the line between its neighbours is not a corner.
  const off = (o: [number, number], a: [number, number], b: [number, number]) =>
    ((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])) / (Math.hypot(b[0] - o[0], b[1] - o[1]) || 1);
  const half = (list: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of list) {
      while (h.length >= 2 && off(h[h.length - 2], h[h.length - 1], p) <= eps) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return half(pts).length + half([...pts].reverse()).length;
}

/** Maximal connected sets of coplanar triangles, largest triangles seeding first. */
function planarSets(m: Mesh, eps: number): Int32Array {
  const nT = m.tri.length / 3;
  const set = new Int32Array(nT).fill(-1);
  const order = [...Array(nT).keys()].sort((a, b) => m.area[b] - m.area[a]);
  let id = 0;
  for (const seed of order) {
    if (set[seed] >= 0) continue;
    const n = triNormal(m, seed);
    const o = vtx(m.pos, m.tri[seed * 3]);
    set[seed] = id;
    const queue = [seed];
    while (queue.length) {
      const u = queue.pop()!;
      for (let k = 0; k < 3; k++) {
        const w = m.adj[u * 3 + k];
        if (w < 0 || set[w] >= 0) continue;
        if (dot(triNormal(m, w), n) < 0.98) continue;
        let on = true;
        for (const v of triVerts(m, w)) {
          const p = vtx(m.pos, v);
          if (Math.abs(dot([p[0] - o[0], p[1] - o[1], p[2] - o[2]], n)) > eps) { on = false; break; }
        }
        if (!on) continue;
        set[w] = id;
        queue.push(w);
      }
    }
    id++;
  }
  return set;
}

/**
 * Largest vertex error if the triangles sit on `s` — vertices within eps, centroids within chord,
 * and every facet turning through about as much of the surface as the others — else null.
 */
function fitsSurface(m: Mesh, s: Analytic, tris: number[], verts: number[], opt: SegmentOptions, tol = opt.eps): number | null {
  let e = 0;
  for (const v of verts) {
    const d = Math.abs(distance(s, vtx(m.pos, v)));
    if (d > tol) return null;
    e = Math.max(e, d);
  }
  // A face on a loosened tolerance is also held to its bow (see LOOSE) as it grows.
  const loose = tol > opt.eps;
  for (const t of tris) {
    const at = triCentroid(m, t);
    const c = Math.abs(distance(s, at));
    if (c > opt.chord || (loose && c > BOW_OF_RADIUS * radiusAt(s, at))) return null;
  }
  return e;
}

/**
 * Exporters step evenly across a curved face, so its facets all span similar angles. A wide flat
 * face folded into a fake cylinder with its narrow neighbours breaks that.
 *
 * A face meshed without strips (triangles joining its two ends at random) spans uneven angles all
 * over, so when the face as a whole is uneven, it is judged flat piece by flat piece instead: a
 * folded flat face is one piece turning far more than every piece beside it, while a facet of an
 * unevenly meshed face always has a neighbour of about its own turn.
 */
function evenFacets(m: Mesh, s: Analytic, tris: number[], eps: number): boolean {
  if (s.kind === 'plane' || tris.length < 2) return true;
  const turn = tris.map((t) => {
    const n = triNormal(m, t);
    let worst = 0;
    for (const v of triVerts(m, t)) worst = Math.max(worst, Math.acos(Math.min(1, Math.abs(dot(n, normalAt(s, vtx(m.pos, v)))))));
    return worst;
  });
  const spread = [...turn].sort((a, b) => a - b);
  // A low quantile, so that when the wide facets are half the sample they cannot set the bar.
  const typical = spread[Math.floor(spread.length / 4)];
  if (spread[spread.length - 1] <= 3 * typical + 0.035) return true;
  // Ruled faces only: over a dozen lone facets a torus or sphere can be fitted to a free-form patch.
  if (s.kind !== 'cylinder' && s.kind !== 'cone') return false;
  // Flat pieces: neighbouring facets in one plane.
  const at = new Map(tris.map((t, i) => [t, i]));
  const piece = tris.map((_, i) => i);
  const root = (i: number): number => (piece[i] === i ? i : (piece[i] = root(piece[i])));
  tris.forEach((t, i) => {
    const n = triNormal(m, t), o = vtx(m.pos, m.tri[t * 3]);
    for (let k = 0; k < 3; k++) {
      const j = at.get(m.adj[t * 3 + k]);
      if (j === undefined) continue;
      const w = tris[j];
      if (triVerts(m, w).every((v) => { const p = vtx(m.pos, v); return Math.abs((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2]) <= eps; })) piece[root(i)] = root(j);
    }
  });
  // Only a face of lone facets and single strips is read this way: a flat piece of more than two
  // triangles is a flat face of a faceted design, not a facet of a curved one.
  const size = new Map<number, number>();
  tris.forEach((_, i) => size.set(root(i), (size.get(root(i)) ?? 0) + 1));
  if ([...size.values()].some((n) => n > 2)) return false;
  const pieceTurn = new Map<number, number>();
  tris.forEach((_, i) => pieceTurn.set(root(i), Math.max(pieceTurn.get(root(i)) ?? 0, turn[i])));
  const beside = new Map<number, number>();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const j = at.get(m.adj[t * 3 + k]);
      if (j === undefined || root(j) === root(i)) continue;
      beside.set(root(i), Math.max(beside.get(root(i)) ?? 0, pieceTurn.get(root(j))!));
    }
  });
  for (const [p, a] of pieceTurn) if (a > 3 * (beside.get(p) ?? Infinity) + 0.035) return false;
  return true;
}

/** The points, normals and edges a fit works from. */
function sampleOf(m: Mesh, tris: number[]): Sample & { ids: number[] } {
  const ids = [...new Set(tris.flatMap((t) => triVerts(m, t)))];
  const where = new Map(ids.map((v, i) => [v, i]));
  const pts = ids.map((v) => vtx(m.pos, v));
  const acc: V3[] = ids.map(() => [0, 0, 0]);
  const tnrm: V3[] = [], tpts: V3[] = [];
  const pairs: [number, number][] = [];
  for (const t of tris) {
    const n = triNormal(m, t);
    tnrm.push(n);
    tpts.push(triCentroid(m, t));
    const [a, b, c] = triVerts(m, t);
    for (const v of [a, b, c]) { const i = where.get(v)!; acc[i] = add(acc[i], scale(n, m.area[t])); }
    pairs.push([where.get(a)!, where.get(b)!], [where.get(b)!, where.get(c)!]);
  }
  return { ids, pts, vnrm: acc.map(normalize), tnrm, tpts, pairs };
}

/** A fit of one kind, unchecked (null when no starting guess, too few points, or absurd). */
function fitKind(sample: Sample, kind: Kind): Analytic | null {
  const { pts } = sample;
  if (pts.length < DOF[kind] + SPARE) return null;
  const s: Analytic | null =
    kind === 'plane' ? fitPlane(pts)
    : kind === 'cylinder' ? fitCylinder(sample)
    : kind === 'sphere' ? fitSphere(sample)
    : kind === 'cone' ? fitCone(sample)
    : fitTorus(sample);
  const size = Math.max(1e-9, maxOf(pts.map((p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1], p[2] - pts[0][2]))));
  return s && sane(s, size) ? s : null;
}

/**
 * The surface of the given kinds the triangles sit on, or null. The vertices cannot always tell
 * kinds apart (any two coaxial circles lie on a sphere, so a two-ring cone band fits one), but
 * the facet centres can: of the kinds that fit, a more general one wins only if it brings the
 * centres clearly closer than the simpler one.
 */
export function fitTris(m: Mesh, tris: number[], opt: SegmentOptions, kinds: Kind[], loose = false): Fit | null {
  const sample = sampleOf(m, tris);
  let best: (Fit & { centres: number }) | null = null;
  // Facets all parallel to one direction are a straight wall: a cylinder if its ends are circles,
  // an extruded outline if not. No cone, sphere or torus has such facets, bar the band round its
  // widest part, which is that cylinder too. But two rings of any outline that is nearly round
  // fit a sphere and a torus within any tolerance worth having, and those balloon out of the wall.
  for (const kind of straightWall(sample.tnrm) ? kinds.filter((k) => k === 'cylinder') : kinds) {
    const s = fitKind(sample, kind);
    if (!s) continue;
    let tol = opt.eps;
    let e = fitsSurface(m, s, tris, sample.ids, opt);
    if (e === null) {
      const earned = loose ? looseTolerance(m, s, tris, sample.ids, opt) : null;
      if (earned === null || largestRadius(s) > LOOSE_SIZE * extent(sample.pts)) continue;
      tol = earned;
      e = fitsSurface(m, s, tris, sample.ids, opt, tol);
    }
    if (e === null || !evenFacets(m, s, tris, opt.eps)) continue;
    let c = 0;
    for (const t of tris) c += Math.abs(distance(s, triCentroid(m, t)));
    c /= tris.length;
    // Clearly: half the centre error or less, and by more than the point tolerance tenfold.
    // A sphere and a cone both pass through the same two rings, and only through two. The cone is
    // the one to believe: it lies along the facets (a chamfer carried round a corner), where a
    // sphere that narrow would be a rare thing to draw.
    const coneOverSphere = kind === 'cone' && best?.surf.kind === 'sphere';
    if (!best || coneOverSphere || (c < 0.5 * best.centres && best.centres - c > 10 * opt.eps)) best = { surf: s, err: e, tol, centres: c };
    if (best.centres <= 10 * opt.eps) break;
  }
  return best && { surf: best.surf, err: best.err, tol: best.tol };
}

/** The largest radius a surface turns at: a torus's ring or tube, whichever is larger; none for a plane or cone. */
function largestRadius(s: Analytic): number {
  if (s.kind === 'cylinder' || s.kind === 'sphere') return s.r;
  if (s.kind === 'torus') return Math.max(s.r, Math.abs(s.R));
  return 0;
}

/** The diagonal of the points' box (mm). */
function extent(pts: V3[]): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p[d]); hi[d] = Math.max(hi[d], p[d]); }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/**
 * A surface of one kind through the triangles, however well it fits, and how far its furthest
 * vertex sits off it (mm): for a person who has said what the face is. Null when no surface of
 * that kind can be put through them at all (too few points, or the fit runs away).
 */
export function fitAs(m: Mesh, tris: number[], kind: Kind): { surf: Analytic; err: number } | null {
  const sample = sampleOf(m, tris);
  // A flat face needs no spare points: one triangle is a plane.
  const s = kind === 'plane' ? fitPlane(sample.pts) : fitKind(sample, kind);
  if (!s) return null;
  const pts = sample.pts;
  const refined = refine(s, pts);
  let err = 0;
  for (const p of pts) err = Math.max(err, Math.abs(distance(refined, p)));
  return { surf: canonical(refined), err };
}

/** Whether unit normals are all square to one direction: the facets of a wall swept along it. */
function straightWall(normals: V3[]): boolean {
  if (normals.length < 2) return false;
  const sum = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const n of normals) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sum[i * 3 + j] += n[i] * n[j];
  const along = eigSym3(sum).vectors[0];
  return normals.every((n) => Math.abs(dot(n, along)) <= 1e-5);
}

/**
 * Whether a curved face's facets show the surface it was fitted to. A narrow face is often two
 * curves and nothing between them (a row of long triangles between two rails), which shows a bend
 * in one direction only: two gently bent rails lie on a cylinder, cone or torus of some size
 * whatever they were drawn on. Such a face proves its surface only if it reaches far enough round
 * the axis (SHOW_ROUND), or if its facets lie along the surface's own straight lines: flat
 * four-sided strips, each square to a cylinder's axis or in a plane through a cone's apex, to
 * within a few point tolerances at its far corner (exporters' strips stray up to about seven), and
 * within three if fewer than half the facets are in strips. A row of lone triangles has no strip
 * and shows no line. And the strips must run the length of the face (SPAN): an exporter lays a
 * curved face's strips side by side round it, each from one end to the other, while a row of
 * quads stacked end to end along a bent bar shows the bar's bend, not a cylinder's.
 * Or, whatever its facets, if another face has the same surface's numbers (see twins): a design
 * repeats its own radius and direction from face to face, while a strip passing for a cylinder
 * has numbers of its own.
 */
function showsSurface(m: Mesh, s: Analytic, tris: number[], verts: number[], eps: number, twinned: () => boolean): boolean {
  if (s.kind === 'plane' || s.kind === 'sphere') return true;
  const o = s.kind === 'cylinder' ? s.o : s.kind === 'cone' ? s.apex : s.c;
  const [e1, e2] = basis(s.a);
  const ang = verts.map((v) => {
    const p = vtx(m.pos, v), d: V3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    return Math.atan2(dot(d, e2), dot(d, e1));
  }).sort((a, b) => a - b);
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
  for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
  if (2 * Math.PI - gap >= SHOW_ROUND) return true;
  if (s.kind === 'torus') return false;
  if (twinned()) return true;
  let off = 0;
  for (const t of tris) {
    const n = triNormal(m, t), ps = triVerts(m, t).map((v) => vtx(m.pos, v));
    if (s.kind === 'cylinder') {
      const h = ps.map((p) => dot(p, s.a));
      off = Math.max(off, Math.abs(dot(n, s.a)) * (Math.max(...h) - Math.min(...h)));
    } else {
      // A cone: how far the facet's plane misses the apex, carried out to the facet's far corner.
      const c = triCentroid(m, t), d: V3 = [s.apex[0] - c[0], s.apex[1] - c[1], s.apex[2] - c[2]];
      const far = Math.max(...ps.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
      off = Math.max(off, (Math.abs(dot(n, d)) / Math.hypot(d[0], d[1], d[2])) * far);
    }
  }
  // Facets in a strip: a neighbour in the face lies in the facet's plane.
  const inFace = new Set(tris);
  const paired = tris.filter((t) => {
    const n = triNormal(m, t), o = vtx(m.pos, m.tri[t * 3]);
    return [0, 1, 2].some((k) => {
      const w = m.adj[t * 3 + k];
      return inFace.has(w) && triVerts(m, w).every((v) => { const p = vtx(m.pos, v); return Math.abs((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2]) <= eps; });
    });
  }).length;
  if (!paired) return false;
  // Each facet's height along the axis against the face's, at the median facet.
  const heightOf = (vs: number[]) => { const h = vs.map((v) => dot(vtx(m.pos, v), s.a)); return Math.max(...h) - Math.min(...h); };
  const heights = tris.map((t) => heightOf(triVerts(m, t))).sort((a, b) => a - b);
  if (heights[Math.floor(heights.length / 2)] < SPAN * heightOf(verts)) return false;
  return off <= 3 * eps || (2 * paired >= tris.length && off <= 8 * eps);
}

/** The radius a curved surface turns at near p: the tightest way it bends there. */
function radiusAt(s: Analytic, p: V3): number {
  switch (s.kind) {
    case 'plane': return Infinity;
    case 'cylinder': case 'sphere': case 'torus': return s.r;
    case 'cone': {
      const x = p[0] - s.apex[0], y = p[1] - s.apex[1], z = p[2] - s.apex[2];
      const h = x * s.a[0] + y * s.a[1] + z * s.a[2];
      return Math.sqrt(Math.max(0, x * x + y * y + z * z - h * h));
    }
  }
}

/** The looser tolerance a curved fit has earned (see LOOSE), or null when it has earned none. */
function looseTolerance(m: Mesh, s: Analytic, tris: number[], verts: number[], opt: SegmentOptions): number | null {
  if (s.kind === 'plane' || verts.length < 2 * DOF[s.kind] + SPARE) return null;
  let worst = 0;
  for (const v of verts) {
    worst = Math.max(worst, Math.abs(distance(s, vtx(m.pos, v))));
    if (worst > LOOSE) return null;
  }
  let bow = 0;
  for (const t of tris) {
    const at = triCentroid(m, t);
    const c = Math.abs(distance(s, at));
    if (c > opt.chord || c > BOW_OF_RADIUS * radiusAt(s, at)) return null;
    bow += c;
  }
  const tol = Math.min(LOOSE, (BOW_SHARE * bow) / tris.length);
  if (worst > tol) return null;
  const first = triNormal(m, tris[0]), cosTurn = Math.cos(LOOSE_TURN);
  return tris.some((t) => dot(triNormal(m, t), first) < cosTurn) ? tol : null;
}

/**
 * Whether two cylinders (or cones) have the same numbers: parallel axes and the same radius (or
 * half angle), within TWIN, the two allowances shared. Their centres may differ: one radius repeated round a part is one
 * design decision, made once.
 */
function twins(a: Analytic, b: Analytic): boolean {
  if (a.kind !== b.kind || (a.kind !== 'cylinder' && a.kind !== 'cone')) return false;
  // One allowance shared between the two: a closer direction leaves more room in size.
  const axis = Math.acos(Math.min(1, Math.abs(dot(a.a, (b as Cylinder | Cone).a)))) / TWIN.axis;
  const size = a.kind === 'cylinder' ? Math.abs(a.r - (b as Cylinder).r) / (TWIN.radius * a.r) : Math.abs(a.ang - (b as Cone).ang) / TWIN.axis;
  return axis + size <= 1;
}

/** A torus with no hole is a sphere: write the simple surface a designer would have drawn. */
function canonical(s: Analytic): Analytic {
  if (s.kind === 'torus' && Math.abs(s.R) < 1e-3 * s.r) return { kind: 'sphere', c: s.c, r: s.r };
  return s;
}

/** Rejects fits that only pass by being huge (a near-flat strip read as a giant cylinder). */
function sane(s: Analytic, size: number): boolean {
  const big = 50 * size + 1000;
  switch (s.kind) {
    case 'plane': return true;
    case 'cylinder': case 'sphere': return s.r > 0 && s.r < big;
    case 'cone': return s.ang > 0.01 && s.ang < Math.PI / 2 - 0.01;
    // A ring smaller than its tube makes a torus that crosses itself, which importers refuse; a
    // hair smaller is the designer's ring equal to the tube, and the numbers are rounded later.
    case 'torus': return s.r > 0 && s.R >= s.r - Math.max(1e-4, 1e-3 * s.r) && s.R < big && s.r < big;
  }
}
