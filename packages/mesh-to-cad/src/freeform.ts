// Free-form faces: everything that did not convert well becomes empty space, and each empty
// space gets one smooth sheet stretched across it.
//
// What stays is what converted well: planes, and curved faces with a clean outline. Facets,
// scraps and faces with a ragged outline are thrown back. Each joined stretch of those is laid
// flat by a conformal map, which needs no corners and keeps the outline's own shape, and a
// cubic B-spline is fitted over it. The STL's vertices are the guide points, since they sit
// exactly on the real surface. The sheet is held tightly at the edge of the empty space, which
// must meet the faces around it, and more loosely in the middle, which only has to look right.
// It runs on past the outline and the face's edges trim it, so the empty space can have any
// number of sides. Where one sheet cannot do it, the space is cut along a smooth line of its
// mesh and each side gets its own.

import { type Pipe, pipeNearest } from './chains';
import { type Graph } from './regions';
import { type V3, basis, cross, dist, dot, norm, normalize, sub, maxOf } from './linalg';
import { type SplineSurface, basisInto, closestInto, surfaceHit, surfacePointInto, uniformKnots } from './bspline';
import { type Mesh, connected, triCentroid, triNormal, triVerts, vtx } from './mesh';
import { type RailField, edgeKey, gridLines, railField, rowFlat } from './rows';
import { railSheet } from './railsheet';
import { standsOff } from './sheetcheck';
import { ballOf } from './rolling';
import { roundSheet } from './roundsheet';

/** How far the facets of a patch of rows may stand off the sheet through its rails (mm); for several rows, beyond the facets' own sag. */
const RAIL_OFF = 0.02;

/**
 * `places`: where on the sheet (u, v) each mesh vertex it was fitted to sits. A sheet runs on past
 * its face, and out there it may swing back close to the face's own points, so the nearest point
 * of the whole sheet is not always the right one; a search started from these is.
 * `rails`: set on a sheet laid straight through a patch's rails (2 for one row), not on a fitted one.
 */
export type BSplineFace = { kind: 'bspline'; places?: Map<number, [number, number]>; rails?: number; pipe?: Pipe; graph?: Graph } & SplineSurface;
type Region = { tris: number[]; surf: { kind: string } | null; err: number };

/** For the probe scripts: called with each patch tried. */
let trace: ((info: Record<string, unknown>) => void) | null = null;
export function traceFreeform(f: typeof trace) { trace = f; }

/**
 * The nearest point of a sheet to p. Looking with nothing to go on means measuring p against a
 * dense sampling of the whole sheet, and the solid's edges ask for the same sheet thousands of
 * times, each point a hair from the last (a corner being moved onto its faces step by step, the
 * next vertex along a border). So the search starts from where the last point asked of this sheet
 * was found, when p is within a hundredth of the sheet's size of that one.
 */
/** A miss wider than this (mm) from a search started near the answer is looked for again over the whole sheet. */
const RESEARCH = 0.01;
const lastOn = new WeakMap<object, { p: V3; u: number; v: number; reach: number }>();
function nearestOn(s: BSplineFace, p: V3) {
  const last = lastOn.get(s);
  let reach = last?.reach;
  if (reach === undefined) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const row of s.ctrl) for (const c of row) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], c[d]); hi[d] = Math.max(hi[d], c[d]); }
    reach = 0.01 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  }
  // A sheet standing over a plane: the point's own place over that plane is the first guess.
  const g = s.graph;
  const start: [number, number] | undefined = g
    ? [Math.min(1, Math.max(0, (dot(sub(p, g.c), g.e1) - g.lo[0]) / (g.hi[0] - g.lo[0]))), Math.min(1, Math.max(0, (dot(sub(p, g.c), g.e2) - g.lo[1]) / (g.hi[1] - g.lo[1])))]
    : last && dist(last.p, p) <= reach ? [last.u, last.v] : undefined;
  let c = closestInto(s, p, start, onHit);
  // A search started from the last point can settle in a fold of the sheet where it runs on past
  // its face: a miss wider than the step that allowed the shortcut is looked for again from the
  // whole sheet, and the nearer answer kept.
  if (start && Math.hypot(c.d[0] - p[0], c.d[1] - p[1], c.d[2] - p[2]) > Math.min(reach, RESEARCH)) {
    let bu = c.u, bv = c.v, miss = Math.hypot(c.d[0] - p[0], c.d[1] - p[1], c.d[2] - p[2]);
    const tryFrom = (from: [number, number] | undefined) => {
      const x = closestInto(s, p, from, onHit), d = Math.hypot(x.d[0] - p[0], x.d[1] - p[1], x.d[2] - p[2]);
      if (d < miss) { miss = d; bu = x.u; bv = x.v; }
    };
    tryFrom(undefined);
    for (let i = 0; i <= 2 && miss > RESEARCH; i++) for (let j = 0; j <= 2; j++) tryFrom([0.1 + 0.4 * i, 0.1 + 0.4 * j]);
    c = closestInto(s, p, [bu, bv], onHit);
  }
  lastOn.set(s, { p, u: c.u, v: c.v, reach });
  return c;
}
/** Where `nearestOn` writes: both its callers read the answer at once. */
const onHit = surfaceHit();

/** The surface's normal direction (Su × Sv, not unit) from a hit's derivatives. */
function hitNormal(D: Float64Array): V3 {
  return [D[4] * D[8] - D[5] * D[7], D[5] * D[6] - D[3] * D[8], D[3] * D[7] - D[4] * D[6]];
}

export function bsplineDistance(s: BSplineFace, p: V3): number {
  if (s.pipe) return pipeNearest(s.pipe, p).d;
  const D = nearestOn(s, p).d;
  const r: V3 = [p[0] - D[0], p[1] - D[1], p[2] - D[2]];
  const d = norm(r);
  return dot(r, hitNormal(D)) >= 0 ? d : -d;
}

export function bsplineNormal(s: BSplineFace, p: V3): V3 {
  if (s.pipe) return pipeNearest(s.pipe, p).n;
  return normalize(hitNormal(nearestOn(s, p).d));
}

/**
 * Replaces runs of facets (and the small curved faces among them) with B-spline faces.
 * `smoothAngle`: the largest turn between neighbouring triangles inside one face.
 */
export function freeformFaces<R extends Region>(
  m: Mesh, regions: R[],
  opt: {
    eps: number; smoothAngle: number;
    project: (surf: R['surf'], p: V3) => V3 | null;
    distance: (surf: R['surf'] | BSplineFace, p: V3) => number;
    /** Told how much of this step is finished (0 to 1) and what it is doing. */
    progress?: (share: number, text: string) => void;
    /**
     * The patches to fit, each as it is given (from the border map): one sheet over the whole of
     * it or none. Nothing is looked for, cut, joined or tidied; a patch that takes no sheet is
     * left with whatever it came with.
     */
    patches?: number[][];
    /** For each of `patches`: one sheet over the whole of it or nothing, never cut (a face a person joined). */
    keepWhole?: boolean[];
  },
): (R | { tris: number[]; surf: BSplineFace; err: number })[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  regions.forEach((r, i) => r.tris.forEach((t) => (label[t] = i)));
  const outlines = regions.map((r, i) => outlineOf(m, r.tris, label, i));
  // A cylinder or cone whose facets run along its own straight lines is a real face however
  // small: the wall round a corner, a chamfer, a small hole. Unless it is one step of a curve:
  // a rounded edge drawn ring by ring is a stack of exact cones, each turning a few degrees on
  // from the last, where a chamfer meets its neighbours at an angle or runs into a real face.
  const proven = regions.map((r) => ruled(m, r));
  const band = (i: number) => regions[i].surf !== null && regions[i].surf!.kind !== 'plane' && outlines[i].inner === 0;
  const step: number[] = [];
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0 || label[w] === label[t] || !proven[label[t]] || !band(label[w])) continue;
    const turn = dot(triNormal(m, t), triNormal(m, w));
    if (turn < FACET_FLAT && turn > FACET_TURN) step.push(label[t]);
  }
  for (const i of step) proven[i] = false;
  const scrap = (i: number) => regions[i].surf !== null && regions[i].surf!.kind !== 'plane' && regions[i].tris.length <= 16 && !proven[i];
  // A flat piece of a triangle or three is a facet standing for something curved only if it
  // meets another such piece, or a scrap, at a shallow angle: that is how a curve is stepped.
  // Between sharp edges, or running into a real curved face, it is a flat face of the design
  // (the straight stretch of a wall between two rounded corners is two triangles).
  const small = (i: number) => regions[i].surf?.kind === 'plane' && regions[i].tris.length <= 3;
  const stepped = new Uint8Array(regions.length);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0 || label[w] === label[t] || !small(label[t]) || !(small(label[w]) || scrap(label[w]))) continue;
    const turn = dot(triNormal(m, t), triNormal(m, w));
    if (turn < FACET_FLAT && turn > FACET_TURN) stepped[label[t]] = 1;
  }
  const facet = (r: Region) => r.tris.length > 0 && small(label[r.tris[0]]) && stepped[label[r.tris[0]]] === 1;
  const loose = regions.map((r, i) => !r.surf || facet(r) || scrap(i));
  // One sheet is stretched over triangles that turn gently from one to the next. Where they turn
  // sharply (the rounded edge of a thin plate, two millimetres across) is a face of its own, and a
  // sheet carried round it from one side of the plate to the other fits neither.
  const cosRun = Math.cos(Math.min(opt.smoothAngle, RUN_TURN)), cosSmooth = Math.cos(opt.smoothAngle);
  // What did not convert well is empty space to fill. A clean face has an outline with a few
  // corners; a fragment of something else has a ragged, stepped one.
  const areaOf = (r: Region) => r.tris.reduce((a, t) => a + m.area[t], 0);
  const whole = regions.reduce((a, r) => a + areaOf(r), 0);
  const weak = regions.map((r, i) => facet(r) || (
    r.surf?.kind !== 'plane' && r.tris.length <= RAGGED_MAX && outlines[i].sharp > RAGGED_CORNERS &&
    // A true cylinder, torus or the like this large is a real face, notches and all.
    (r.surf?.kind === 'extrusion' || r.surf?.kind === 'revolution' || areaOf(r) < 0.05 * whole)
  ));
  weak.forEach((w, i) => { if (w) loose[i] = true; });
  // A small strip with the radius of a large curved face beside it is that fillet carried on (a
  // straight run of a rounded edge, between two rounded corners). The neighbour must be large:
  // strips of one surface side by side all have about the same radius, so small ones would
  // vouch for each other.
  const radiusOf = (r: Region) => {
    const s = r.surf as { kind: string; r?: number } | null;
    return s && (s.kind === 'cylinder' || s.kind === 'torus' || s.kind === 'sphere') ? s.r! : null;
  };
  const carried = regions.map((r, i) => {
    const mine = radiusOf(r);
    if (mine === null || r.tris.length > 60) return false;
    return [...outlines[i].borders.keys()].some((j) => {
      const theirs = radiusOf(regions[j]);
      return theirs !== null && regions[j].tris.length > 60 && Math.abs(theirs - mine) <= SAME_RADIUS * mine;
    });
  });
  carried.forEach((c, i) => { if (c) loose[i] = false; });
  // A facet walled in by two such fillets is the flat band between them, not a scrap.
  regions.forEach((r, i) => {
    if (!facet(r)) return;
    let all = 0, real = 0, walls = 0;
    for (const [j, len] of outlines[i].borders) { all += len; if (carried[j]) { real += len; walls++; } }
    if (walls >= 2 && real >= FACET_WALLED * all) loose[i] = false;
  });
  // Two rings of vertices and nothing between them: any two coaxial rings lie on a cylinder, a
  // cone and a sphere, so such a face proves nothing about the surface it claims. Alone it may
  // be real (a chamfer band); side by side with others of its kind it is a surface drawn ring by
  // ring, and each strip only looks like a surface of its own.
  const unproven = regions.map((r, i) =>
    r.surf !== null && r.surf.kind !== 'plane' && r.tris.length <= 60 && outlines[i].inner === 0 && outlines[i].loops === 1 && !proven[i]);
  // One of those read as a cylinder far wider than itself is flat for all it shows.
  regions.forEach((r, i) => {
    if (unproven[i] && r.surf?.kind === 'cylinder' && (r.surf as unknown as { r: number }).r > FLAT_STRIP * extentOf(m, r.tris)) loose[i] = true;
  });
  // A small face nearly surrounded by the empty space is part of it; a plane only if walled in.
  // (One long side against a thin strip does not count: real fillets look like that.)
  for (let changed = true; changed;) {
    changed = false;
    regions.forEach((r, i) => {
      if (loose[i] || carried[i] || r.tris.length > 60) return;
      let all = 0, open = 0;
      for (const [j, len] of outlines[i].borders) { all += len; if (loose[j] || (unproven[i] && unproven[j])) open += len; }
      if (!all || open < (r.surf?.kind === 'plane' ? 1 : SURROUNDED) * all) return;
      loose[i] = true;
      changed = true;
    });
  }
  const hole = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) hole[t] = loose[label[t]] ? 1 : 0;
  if (opt.patches) { hole.fill(0); for (const p of opt.patches) for (const t of p) hole[t] = 1; }
  // A good curved face keeps its shape, but a triangle poking into the empty space, bordered by
  // it on two sides, is a tooth on the face's outline.
  for (let round = 0; round < 3 && !opt.patches; round++) {
    const teeth: number[] = [];
    for (let t = 0; t < nT; t++) {
      if (hole[t] || regions[label[t]].surf?.kind === 'plane') continue;
      let sides = 0;
      for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w >= 0 && hole[w]) sides++; }
      if (sides >= 2) teeth.push(t);
    }
    for (const t of teeth) hole[t] = 1;
  }

  // Runs of loose triangles joined across smooth edges.
  const runOf = new Int32Array(nT).fill(-1);
  const runs: number[][] = [];
  for (let t = 0; t < nT; t++) {
    if (runOf[t] >= 0 || !hole[t]) continue;
    const run = [t];
    runOf[t] = runs.length;
    for (let i = 0; i < run.length; i++) {
      const u = run[i];
      for (let k = 0; k < 3; k++) {
        const w = m.adj[u * 3 + k];
        if (w < 0 || runOf[w] >= 0 || !hole[w]) continue;
        const turn = dot(triNormal(m, u), triNormal(m, w));
        if (turn < cosSmooth) continue;
        if (turn < cosRun) {
          // A sharper turn joins only chunky triangles, the steps of a coarsely meshed curve.
          // Long thin ones meeting along their length are the strips of a tight round.
          const along = dist(vtx(m.pos, m.tri[u * 3 + k]), vtx(m.pos, m.tri[u * 3 + ((k + 1) % 3)])) || 1e-12;
          if ((2 * Math.min(m.area[u], m.area[w])) / (along * along) < STRIP_WIDE) continue;
        }
        runOf[w] = runs.length;
        run.push(w);
      }
    }
    runs.push(run);
  }

  const tol = Math.max(1e-3, 5 * opt.eps);
  const size = extentOf(m, regions.flatMap((r) => r.tris));
  // How far this exporter's facets sit from the real surface, read off the good curved faces:
  // a sheet may sit that far from a facet, and no further.
  // Only faces that are beyond doubt may say so (a ruled face shown by its own lines, or one
  // with vertices off its outline), and by the bulk of their area, not their worst triangle: one
  // wrong face would otherwise let every sheet stand as far off its facets as that face does.
  const bows: { off: number; area: number }[] = [];
  regions.forEach((r, i) => {
    if (hole[r.tris[0]] || !r.surf || !SURE_KINDS.has(r.surf.kind) || !(proven[i] || outlines[i].inner > 0)) return;
    for (const t of r.tris) {
      const c = triCentroid(m, t);
      const on = opt.project(r.surf, c);
      if (on) bows.push({ off: dist(c, on), area: m.area[t] });
    }
  });
  bows.sort((a, b) => a.off - b.off);
  let chord = 0;
  const sure = bows.reduce((a, b) => a + b.area, 0);
  for (let i = 0, seen = 0; i < bows.length; i++) {
    seen += bows[i].area;
    chord = bows[i].off;
    if (seen >= CHORD_SHARE * sure) break;
  }
  // The middle of a facet is two thirds of the way to its deepest point's distance, and more.
  const guideGive = Math.max(MIDDLE_SLACK * tol, 2 * chord);
  const taken = new Uint8Array(nT);
  const made: { tris: number[]; surf: BSplineFace; err: number }[] = [];
  // Along a patch's edge, the neighbouring face's own surface where it has one (a triangle
  // another patch has taken has none yet).
  const across = (w: number, p: V3) => (hole[w] || taken[w] ? null : opt.project(regions[label[w]].surf, p));
  const box = (tris: number[]) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const v of triVerts(m, t)) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], m.pos[v * 3 + d]); hi[d] = Math.max(hi[d], m.pos[v * 3 + d]); }
    return [...lo, ...hi].map((x) => +x.toFixed(2));
  };
  const take = (tris: number[], fit: { surf: BSplineFace; err: number; params: Map<number, [number, number]> }) => {
    for (const t of tris) taken[t] = 1;
    made.push({ tris, surf: { ...fit.surf, places: fit.params }, err: fit.err });
  };
  const facetsIn = (run: number[]) => run.filter((t) => weak[label[t]]).length;
  const toFit = opt.patches ?? runs.filter((run) => facetsIn(run) >= 6);
  const trisToFit = toFit.reduce((a, run) => a + run.length, 0);
  let trisFinished = 0;
  for (const [patch, run] of toFit.entries()) {
    const facets = facetsIn(run);
    // The bar moves as triangles get a sheet (a merge refits ones already counted), and each net
    // tried closes a little of what is left of this patch, so a long search still shows.
    let fitted = 0, netsTried = 0;
    // A patch that will not fit whole is divided, and on a large one finding where takes a
    // while with no net tried: the words say so then, with how much is being divided.
    let doing = '';
    const tell = () => {
      const got = Math.min(fitted, run.length);
      const searched = (run.length - got) * (1 - (1 - NET_SHARE) ** netsTried);
      opt.progress?.((trisFinished + got + searched) / trisToFit, `Fitting surfaces, ${patch + 1} of ${toFit.length}${doing}`);
    };
    const dividing = (count: number) => {
      doing = count >= DIVIDING_SHOWN ? `: dividing ${count.toLocaleString('en-US')} triangles` : '';
      netsTried++;
      tell();
    };
    tell();
    // The sets of triangles refused so far on this patch, by size and sum: two pieces of one cut
    // are offered to the merge as one, and that whole was refused moments before.
    const refused = new Map<string, { tris: number[]; why: string }[]>();
    const setKey = (sorted: number[]) => `${sorted.length}:${sorted.reduce((a, t) => a + t, 0)}`;
    const fit = (tris: number[]) => {
      doing = '';
      // One row wide, whole or cut: a sheet straight through its two rails, in one step.
      const railed = opt.patches ? railSheet(m, tris) : null;
      if (railed && railed.off <= RAIL_OFF && !railed.left.length) {
        fitted += tris.length;
        tell();
        return { surf: railed.surf, err: 0, score: 0, off: railed.off, net: 'rails', params: railed.params };
      }
      let found = fitPatch(m, tris, tol, guideGive, across, () => { netsTried++; tell(); });
      // The fit's own checks look at points; the sheet must hold over the whole of every facet too.
      if (found && opt.patches && standsOff(m, tris, found.surf, found.params) > 0) { lastFail = 'stands off its facets'; found = null; }
      if (found) { fitted += tris.length; tell(); }
      else {
        const sorted = [...tris].sort((a, b) => a - b), k = setKey(sorted);
        const list = refused.get(k) ?? [];
        list.push({ tris: sorted, why: lastFail });
        refused.set(k, list);
      }
      return found;
    };
    /** For the merge, which only asks whether a sheet fits: a set already refused is refused again without a fit. */
    const fitNew = (tris: number[]) => {
      const sorted = [...tris].sort((a, b) => a - b);
      const known = refused.get(setKey(sorted))?.find((r) => r.tris.every((t, i) => t === sorted[i]));
      if (known) { lastFail = known.why; return null; }
      return fit(tris);
    };
    // A round along a free curve is one face: one sheet laid through the ball that rolls it, with
    // true circular sections, or failing that one sheet fitted over the whole of it. Never cut.
    const ball = opt.patches ? ballOf(regions[label[run[0]]] as { round?: { r: number } }) : null;
    if (ball) {
      const laid = roundSheet(m, run, ball);
      const sheet = laid && laid.off <= 0 ? { surf: laid.surf, err: 0, params: laid.params } : fit(run);
      if (sheet) take(run, sheet);
      trisFinished += run.length;
      continue;
    }
    // A patch one row wide: a sheet straight through its two rails, in one step, if the facets lie along it.
    const rails = opt.patches ? railSheet(m, run) : null;
    if (rails && rails.off <= RAIL_OFF) {
      // (A facet of the next face left on this side of the border is not covered: it stays as it was found.)
      const left = new Set(rails.left);
      take(left.size ? run.filter((t) => !left.has(t)) : run, { surf: rails.surf, err: 0, params: rails.params });
      trisFinished += run.length;
      continue;
    }
    const whole = opt.patches ? fit(run) : null;
    if (opt.patches && !whole) trace?.({ left: run.length, how: 'as given', why: lastFail, depth: 0 });
    // A patch from the border map that takes no sheet whole (its outline touches itself, it has a
    // hole in it, or it is too much for one net) is still cut the old way, for now: a few patches
    // on each part, where leaving them as loose facets would be worse than what there was before.
    const pieces = whole
      ? [{ tris: run, fit: whole }]
      : opt.keepWhole?.[patch] ? []
      : mergePieces(m, cutUntilFits(m, run, fit, realBorders(m, run), dividing), fitNew, SLIVER_SHARE * size);
    trisFinished += run.length;
    let done = 0;
    for (const p of pieces) { take(p.tris, p.fit); done += p.tris.length; }
    trace?.({
      tris: run.length, facets, box: box(run), left: run.length - done, chord, guideGive,
      pieces: pieces.map((p) => `${p.tris.length}:${p.fit.net}:${p.fit.err.toExponential(0)}`).join(' '),
    });
  }
  // Regions keep whatever the new faces did not take, one region per connected part.
  const out: (R | { tris: number[]; surf: BSplineFace; err: number })[] = [];
  for (const r of regions) {
    const left = r.tris.filter((t) => !taken[t]);
    if (left.length === r.tris.length) out.push(r);
    else if (left.length) for (const part of connected(m, left)) out.push({ ...r, tris: part });
  }
  const faces = [...out, ...made];
  if (opt.patches) return faces;
  opt.progress?.(1, 'Tidying the edges');
  tidyOutlines<(typeof faces)[number]>(m, faces, tol, guideGive, opt.distance);
  return faces.filter((f) => f.tris.length);
}

/** The most two neighbouring triangles may turn and still be covered by one sheet whatever their shape, in radians. */
const RUN_TURN = (25 * Math.PI) / 180;
/** Past that turn, how wide a triangle must stand off the shared side, as a share of the side's length, to be joined. */
const STRIP_WIDE = 0.5;

/** The kinds of face whose facets show the exporter's chord error, and the share of their area that sits within it. */
const SURE_KINDS = new Set(['cylinder', 'cone', 'sphere', 'torus']);
const CHORD_SHARE = 0.95;

/** Two flat pieces turning less than this (as a cosine) are steps of one curve; turning this little or less (FACET_FLAT) they are one flat face in two pieces. */
const FACET_TURN = Math.cos((30 * Math.PI) / 180), FACET_FLAT = Math.cos((0.2 * Math.PI) / 180);
/** How far off square to its lines a ruled face's facets may be, and how many of its lines it must show. */
const RULED_TILT = 1e-4, RULED_LINES = 5;

/**
 * Whether a cylinder or cone is shown by its own straight lines: every facet lies along them (a
 * cylinder's facets are parallel to its axis, a cone's pass through its tip), and its vertices
 * mark at least five of them, where three make a circle. Two rings of anything fit a cylinder or
 * a cone somewhere; only the real one has its facets along it.
 */
function ruled(m: Mesh, r: Region): boolean {
  const s = r.surf as { kind: string; o?: V3; apex?: V3; a?: V3 } | null;
  if (!s || (s.kind !== 'cylinder' && s.kind !== 'cone') || !s.a) return false;
  const from = (s.kind === 'cylinder' ? s.o : s.apex)!;
  for (const t of r.tris) {
    const n = triNormal(m, t);
    if (s.kind === 'cylinder') {
      if (Math.abs(dot(n, s.a)) > RULED_TILT) return false;
    } else {
      const d = sub(vtx(m.pos, m.tri[t * 3]), from);
      if (Math.abs(dot(d, n)) > RULED_TILT * (1 + norm(d))) return false;
    }
  }
  const [e1, e2] = basis(s.a);
  const angles = [...new Set(r.tris.flatMap((t) => triVerts(m, t)))]
    .map((v) => { const d = sub(vtx(m.pos, v), from); return Math.atan2(dot(d, e2), dot(d, e1)); })
    .sort((x, y) => x - y);
  let lines = 1;
  for (let i = 1; i < angles.length; i++) if (angles[i] - angles[i - 1] > 1e-3) lines++;
  return lines >= RULED_LINES;
}

/** A patch of at least this many triangles being divided is worth saying so on the progress bar. */
const DIVIDING_SHOWN = 2000;
/** How much of what is left of a patch on the progress bar each net tried closes. */
const NET_SHARE = 0.015;

/** A cylinder more than this many times wider than a strip of itself is flat, for all the strip shows. */
const FLAT_STRIP = 20;
/** Two radii this close (as a share) are one fillet carried from one face to the next. */
const SAME_RADIUS = 1e-3;
/** The share of a facet's outline that real faces must hold for it to be a real flat band. */
const FACET_WALLED = 0.7;

/** The diagonal of the triangles' bounding box. */
function extentOf(m: Mesh, tris: number[]): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of triVerts(m, t)) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], m.pos[v * 3 + d]); hi[d] = Math.max(hi[d], m.pos[v * 3 + d]); }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/** A piece of a cut patch narrower than this share of the part is a sliver left by the cuts. */
const SLIVER_SHARE = 0.015;
/** Fits tried while merging the pieces of one patch. */
const MAX_MERGE_FITS = 6;

/**
 * Cutting a patch can leave more pieces than it needs. Thin strips (mean width under `limit`) join
 * the neighbour they share most border with if one sheet fits the two at all; any other pair joins
 * only if the sheet fits them comfortably, within every limit (a score of 1).
 */
function mergePieces<F extends { score: number }>(
  m: Mesh, pieces: { tris: number[]; fit: F }[], fit: (tris: number[]) => F | null, limit: number,
): { tris: number[]; fit: F }[] {
  if (pieces.length < 2) return pieces;
  const sideLength = (t: number, k: number) => dist(vtx(m.pos, m.tri[t * 3 + k]), vtx(m.pos, m.tri[t * 3 + ((k + 1) % 3)]));
  const widthOf = (tris: number[]) => {
    const inSet = new Set(tris);
    let area = 0, outline = 0;
    for (const t of tris) {
      area += m.area[t];
      for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w < 0 || !inSet.has(w)) outline += sideLength(t, k); }
    }
    return outline > 0 ? (2 * area) / outline : Infinity;
  };
  let out = pieces;
  const tried = new Set<string>();
  let fits = 0;
  for (;;) {
    const pieceOf = new Map<number, number>();
    out.forEach((p, i) => p.tris.forEach((t) => pieceOf.set(t, i)));
    const widths = out.map((p) => widthOf(p.tris));
    const order = out.map((_, i) => i).sort((a, b) => widths[a] - widths[b]);
    let merged = false;
    for (const i of order) {
      const shared = new Map<number, number>();
      for (const t of out[i].tris) for (let k = 0; k < 3; k++) {
        const j = pieceOf.get(m.adj[t * 3 + k]);
        if (j !== undefined && j !== i) shared.set(j, (shared.get(j) ?? 0) + sideLength(t, k));
      }
      for (const [j] of [...shared].sort((a, b) => b[1] - a[1])) {
        const key = [i, j].map((x) => `${out[x].tris.length}+${out[x].tris[0]}`).sort().join('|');
        if (tried.has(key) || fits >= MAX_MERGE_FITS) continue;
        tried.add(key);
        fits++;
        const both = [...out[i].tris, ...out[j].tris];
        const f = fit(both);
        trace?.({ merge: `${out[i].tris.length}+${out[j].tris.length}`, ok: !!f, score: f?.score, why: f ? '' : lastFail.slice(0, 120) });
        if (!f || (widths[i] >= limit && f.score > 1)) continue;
        out = [...out.filter((_, k) => k !== i && k !== j), { tris: both, fit: f }];
        merged = true;
        break;
      }
      if (merged) break;
    }
    if (!merged) break;
  }
  return out;
}

/** The biggest group of a sheet's triangles that can count as a bay in its outline. */
const BAY_MAX = 30;

/**
 * Evens out the borders of sheets. A neighbour's triangle poking into a sheet goes to the sheet if
 * the sheet's fitted surface already holds it, and a small bay of a sheet's triangles, where all
 * of them lie on the next face's surface, goes to that face if that makes the border shorter.
 * Nothing is refitted: a triangle only moves to a surface that already holds it, corners and
 * middle. Corners alone prove nothing: a big flat facet can have all three on a sheet's edge.
 */
function tidyOutlines<F extends { tris: number[]; surf: { kind: string } | null; err: number }>(
  m: Mesh, faces: F[], tol: number, sag: number, surfaceDistance: (surf: F['surf'], p: V3) => number,
): void {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const had = label.slice();
  const sheet = (i: number) => faces[i].surf?.kind === 'bspline';
  const holds = (i: number, t: number) => {
    const off = (p: V3) => Math.abs(surfaceDistance(faces[i].surf, p));
    const [a, b, c] = triVerts(m, t).map((v) => vtx(m.pos, v));
    if (off(a) > tol || off(b) > tol || off(c) > tol) return false;
    const mid = (p: V3, q: V3): V3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    return off(triCentroid(m, t)) <= sag && off(mid(a, b)) <= sag && off(mid(b, c)) <= sag && off(mid(c, a)) <= sag;
  };
  /** A face must stay one piece: at most one stretch of its border may start at any vertex. */
  const pinched = (f: number, vs: number[]) => vs.some((v) => {
    let starts = 0;
    for (const t of m.vertTris[v]) {
      if (label[t] !== f) continue;
      const k = [0, 1, 2].find((j) => m.tri[t * 3 + j] === v)!;
      const w = m.adj[t * 3 + k];
      if (w < 0 || label[w] !== f) starts++;
    }
    return starts > 1;
  });
  const sideLength = (t: number, k: number) => dist(vtx(m.pos, m.tri[t * 3 + k]), vtx(m.pos, m.tri[t * 3 + ((k + 1) % 3)]));
  // A neighbour's tooth into a sheet: at most one of its sides on its own face, one on the sheet,
  // and the sheet already holds it.
  for (let round = 0; round < 6; round++) {
    let moved = 0;
    for (let t = 0; t < nT; t++) {
      const was = label[t];
      if (sheet(was)) continue;
      let own = 0;
      const on = new Set<number>();
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        if (w >= 0 && label[w] === was) own++;
        else if (w >= 0 && sheet(label[w])) on.add(label[w]);
      }
      if (own > 1) continue;
      for (const g of on) {
        if (!holds(g, t)) continue;
        label[t] = g;
        if (pinched(was, triVerts(m, t)) || pinched(g, triVerts(m, t))) { label[t] = was; continue; }
        moved++;
        break;
      }
    }
    if (!moved) break;
  }
  // A bay in a sheet's outline: triangles of the sheet that all lie on the next face's surface.
  const tried = new Set<number>();
  for (let t = 0; t < nT; t++) {
    const s = label[t];
    if (!sheet(s)) continue;
    for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w < 0 || label[w] === s || sheet(label[w])) continue;
      const a = label[w];
      const seed = t * faces.length + a;
      if (tried.has(seed)) continue;
      tried.add(seed);
      if (!holds(a, t)) continue;
      // The group of sheet triangles reachable from this one that a's surface also holds.
      const group = [t];
      const inGroup = new Set(group);
      for (let i = 0; i < group.length && group.length <= BAY_MAX; i++) {
        for (let j = 0; j < 3; j++) {
          const x = m.adj[group[i] * 3 + j];
          if (x < 0 || label[x] !== s || inGroup.has(x) || !holds(a, x)) continue;
          inGroup.add(x);
          group.push(x);
        }
      }
      if (group.length > BAY_MAX) continue;
      let shared = 0, rest = 0;
      for (const u of group) for (let j = 0; j < 3; j++) {
        const x = m.adj[u * 3 + j];
        if (x >= 0 && label[x] === a) shared += sideLength(u, j);
        else if (x < 0 || !inGroup.has(x)) rest += sideLength(u, j);
      }
      if (shared <= rest) continue;
      const verts = [...new Set(group.flatMap((u) => triVerts(m, u)))];
      for (const u of group) label[u] = a;
      if (pinched(s, verts) || pinched(a, verts) || connected(m, faces[s].tris.filter((u) => label[u] === s)).length !== 1) {
        for (const u of group) label[u] = s;
        continue;
      }
      break;
    }
  }
  // Each face's triangles again, in one pass over the mesh. The faces never share a triangle, so
  // the labels as they were say which ones each face had.
  const lists: number[][] = faces.map(() => []);
  for (let t = 0; t < nT; t++) if (label[t] >= 0) lists[label[t]].push(t);
  faces.forEach((f, i) => {
    f.tris = lists[i];
    if (f.surf?.kind !== 'bspline') for (const t of f.tris) if (had[t] !== i) for (const v of triVerts(m, t)) f.err = Math.max(f.err, Math.abs(surfaceDistance(f.surf, vtx(m.pos, v))));
  });
}

/** How much further than an edge the middle of a sheet may sit from its points. */
const MIDDLE_SLACK = 20;

/** The share of a small face's outline that must border empty space for it to join. */
const SURROUNDED = 0.8;

/** A net this many times the middle tolerance off its points gets one round; a round that leaves this share of the last one's miss is the last. */
const FAR_OFF = 50, SLOW_ROUND = 0.95;
/** A patch whose misfit is still this share of what it was this many nets ago is given up. */
const STALL_NETS = 5, STALL_SHARE = 0.85;

/** Control points a sheet may have for each vertex and edge point that holds it, and the fewest it is ever limited to. */
const NET_PER_POINT = 1.5, NET_LEAST = 100;
/** The share of its facets' sag that a sheet may miss an edge vertex by, and the most it may ever (mm). */
const EDGE_SHARE = 0.25, EDGE_MOST = 0.02;

/** The most a sheet may be let off its facets for their sag, as a share of the patch's mean width. */
const GIVE_OF_WIDTH = 0.05;
/** Steps along each side of a triangle at which the sheet over it is looked at for swelling. */
const SWELL_STEPS = 6;
/** How many times stiffer than usual a swelling net is solved again, in turn. */
const STIFFER = [1e2, 1e4, 1e6];
/** How strongly a guide point pulls, against 1 for a vertex of the patch. */
const GUIDE_WEIGHT = 0.05;
/** Most guide points on one patch; past this they are spaced further apart. */
const MAX_GUIDES = 6000;

/**
 * Points across the patch's triangles, one per step of about the patch's typical edge length,
 * and at least the middle of each. An exporter keeps every facet
 * within its chord tolerance of the real surface, so a facet is itself a good guide. Each point
 * says which vertices it is a blend of.
 */
function guidePoints(
  m: Mesh, tris: number[], verts: number[], local: Map<number, number>,
): { q: V3; at: number[]; by: number[] }[] {
  const P = (i: number) => vtx(m.pos, verts[i]);
  const corners = tris.map((t) => triVerts(m, t).map((v) => local.get(v)!));
  const longest = corners.map((c) => Math.max(dist(P(c[0]), P(c[1])), dist(P(c[1]), P(c[2])), dist(P(c[2]), P(c[0]))));
  // At most an eighth of the longest triangle: on a patch of nothing but long triangles, the
  // typical size alone would leave them all without a guide.
  let step = Math.min(1.5 * [...longest].sort((x, y) => x - y)[longest.length >> 1], maxOf(longest) / 8);
  const steps = (L: number) => Math.ceil(L / step);
  const count = () => longest.reduce((n, L) => { const k = steps(L); return k < 2 ? n : n + ((k + 1) * (k + 2)) / 2 - 3; }, 0);
  while (count() > MAX_GUIDES) step *= 1.25;
  const out: { q: V3; at: number[]; by: number[] }[] = [];
  corners.forEach((c, f) => {
    const k = steps(longest[f]);
    const A = P(c[0]), B = P(c[1]), C = P(c[2]);
    // Every triangle's middle, however small it is: a net finer than the mesh is free to swell
    // inside a triangle whose corners alone hold it, and nothing else would see that.
    if (k < 3) out.push({ q: [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3], at: c, by: [1 / 3, 1 / 3, 1 / 3] });
    if (k < 2) return;
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
      const l = k - i - j;
      if (i === k || j === k || l === k) continue;
      const by = [i / k, j / k, l / k];
      out.push({ q: [0, 1, 2].map((d) => by[0] * A[d] + by[1] * B[d] + by[2] * C[d]) as V3, at: c, by });
    }
  });
  return out;
}

/** A curved face this small with more sharp corners on its outline than this is a fragment. */
const RAGGED_MAX = 200;
const RAGGED_CORNERS = 6;

/**
 * How many sharp corners a face's outline has, its border length with each neighbour, how many of
 * its vertices are off the outline, and how many loops the outline makes.
 */
function outlineOf(m: Mesh, tris: number[], label: Int32Array, self: number): { sharp: number; borders: Map<number, number>; inner: number; loops: number } {
  const P = (v: number) => vtx(m.pos, v);
  const next = new Map<number, number>();
  const borders = new Map<number, number>();
  const verts = new Set<number>();
  for (const t of tris) {
    const vs = triVerts(m, t);
    for (const v of vs) verts.add(v);
    for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w >= 0 && label[w] === self) continue;
      const a = vs[k], b = vs[(k + 1) % 3];
      next.set(a, b);
      if (w >= 0) borders.set(label[w], (borders.get(label[w]) ?? 0) + norm(sub(P(b), P(a))));
    }
  }
  const cosSharp = Math.cos((50 * Math.PI) / 180);
  let sharp = 0;
  for (const [a, b] of next) {
    const c = next.get(b);
    if (c !== undefined && dot(normalize(sub(P(b), P(a))), normalize(sub(P(c), P(b)))) < cosSharp) sharp++;
  }
  let loops = 0;
  const walked = new Set<number>();
  for (const a of next.keys()) {
    if (walked.has(a)) continue;
    loops++;
    for (let v: number | undefined = a; v !== undefined && !walked.has(v); v = next.get(v)) walked.add(v);
  }
  return { sharp, borders, inner: verts.size - next.size, loops };
}

/** Enough cuts for any patch in practice: each one roughly halves it. */
const MAX_CUTS = 7;
/** The most times one patch is opened along the way down (see `ringCut`). */
const MAX_OPENINGS = 40;

/**
 * The patch as one surface, or failing that, the same for each side of its best smooth cut.
 * What still fits nothing is left out and stays as facets.
 */
function cutUntilFits<F>(
  m: Mesh, tris: number[], fit: (tris: number[]) => F | null, real: Set<number>, dividing: (tris: number) => void = () => {}, depth = 0, opened = 0,
): { tris: number[]; fit: F }[] {
  const whole = fit(tris);
  trace?.({ attempt: tris.length, depth, ok: !!whole, why: whole ? '' : lastFail });
  if (whole) return [{ tris, fit: whole }];
  // What to fall back on if this patch cannot be cut into pieces that fit.
  const reserve = spare as F | null;
  const whyNot = lastFail;
  const settle = (how = ''): { tris: number[]; fit: F }[] => {
    if (!reserve) trace?.({ left: tris.length, depth, how, why: whyNot, set: tris });
    return reserve ? [{ tris, fit: reserve }] : [];
  };
  if (depth >= MAX_CUTS || tris.length < 12) return settle(depth >= MAX_CUTS ? 'too deep' : 'too small');
  // A patch with a hole in it (the blend round the mouth of a bore is a ring) cannot be laid
  // flat as it is, and no single line across it parts it: it is opened into two first. Opening
  // is not counted as a cut: a wall with a hundred ribs standing on it has a hundred holes, and
  // takes a hundred openings before any of it can be fitted at all.
  dividing(tris.length);
  // An outline that touches itself is parted there the same way, and counted the same.
  const ring = opened < MAX_OPENINGS ? ringCut(m, tris) ?? pinchCut(m, tris) : null;
  // A patch of rows with a crease across them is parted along it first.
  const halves = ring ?? (railField(m, tris) ? kinkCut(m, tris) : null) ?? bestCut(m, tris, real);
  if (!halves) return settle('no cut');
  const pieces = halves.map((h) => cutUntilFits(m, h, fit, real, dividing, ring ? depth : depth + 1, ring ? opened + 1 : opened));
  // Cut, but a side of it still fitted nothing: the whole on its looser sheet is the better face.
  if (reserve && pieces.some((p, i) => p.reduce((n, x) => n + x.tris.length, 0) < halves[i].length)) return settle();
  return pieces.flat();
}

/**
 * A patch whose outline is more than one loop, cut into two along the two shortest ways across
 * from its longest loop to its next longest, on opposite sides: a ring becomes two four-sided
 * pieces. Null when its outline is one loop, or touches itself, or no two such ways exist.
 */
function ringCut(m: Mesh, tris: number[]): [number[], number[]] | null {
  const key = (a: number, b: number) => edgeKey(m, a, b);
  const P = (v: number) => vtx(m.pos, v);
  const inSet = new Set(tris);
  // The outline is walked by fan (see `fansOf`), so one that touches itself at a vertex is still
  // read as the loops it is: a band right round a face, pinched where two of its corners meet.
  const { verts, corner } = fansOf(m, tris);
  const nextOf = new Map<number, number>();
  const nbr = new Map<number, number[]>();
  const join = (a: number, b: number) => { if (!nbr.has(a)) nbr.set(a, []); nbr.get(a)!.push(b); };
  for (let f = 0; f < tris.length; f++) {
    const t = tris[f];
    const vs = triVerts(m, t);
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3];
      join(a, b);
      join(b, a);
      const w = m.adj[t * 3 + k];
      if (w >= 0 && inSet.has(w)) continue;
      if (nextOf.has(corner[f * 3 + k])) return null;
      nextOf.set(corner[f * 3 + k], corner[f * 3 + ((k + 1) % 3)]);
    }
  }
  const loops: number[][] = [];
  const walked = new Set<number>();
  for (const start of nextOf.keys()) {
    if (walked.has(start)) continue;
    const loop: number[] = [];
    for (let v: number | undefined = start; v !== undefined && !walked.has(v); v = nextOf.get(v)) { walked.add(v); loop.push(verts[v]); }
    loops.push(loop);
  }
  if (loops.length < 2) return null;
  const lengthOf = (loop: number[]) => loop.reduce((a, v, i) => a + dist(P(v), P(loop[(i + 1) % loop.length])), 0);
  const [outer, inner] = loops.map((loop) => ({ loop, length: lengthOf(loop) })).sort((a, b) => b.length - a.length);
  const onOutline = new Set(loops.flat());
  const goal = new Set(inner.loop);
  const across = (starts: number[], shut: Set<number>) => wayAcross(m, nbr, starts, goal, onOutline, shut);
  const first = across(outer.loop, new Set());
  if (!first) return null;
  // The second from the far side of the outer loop: half way round it from where the first began.
  const began = outer.loop.indexOf(first[first.length - 1]);
  let round = 0, opposite = began;
  for (let i = 0; i < outer.loop.length && round < outer.length / 2; i++) {
    opposite = (began + i) % outer.loop.length;
    round += dist(P(outer.loop[opposite]), P(outer.loop[(opposite + 1) % outer.loop.length]));
  }
  // Where the patch is all long thin triangles, hardly a vertex is off its outline, and from that
  // one point there may be no way across that keeps off it. Then the nearest way from further
  // and further round will do: any second way opens the ring.
  const shut = new Set(first);
  const count = outer.loop.length;
  const awayBy = (share: number) => outer.loop.filter((v, i) => {
    const steps = Math.abs(i - began);
    return !shut.has(v) && Math.min(steps, count - steps) >= share * count;
  });
  const second = across([outer.loop[opposite]], shut) ?? across(awayBy(0.25), shut) ?? across(awayBy(0.05), shut) ?? across(awayBy(0), shut);
  if (!second) return null;
  const cut = new Set<number>();
  for (const path of [first, second]) for (let i = 0; i + 1 < path.length; i++) cut.add(key(path[i], path[i + 1]));
  const seen = new Set<number>();
  const parts: number[][] = [];
  for (const t0 of tris) {
    if (seen.has(t0)) continue;
    if (parts.length === 2) return null;
    const part = [t0];
    seen.add(t0);
    for (let i = 0; i < part.length; i++) {
      const vs = triVerts(m, part[i]);
      for (let k = 0; k < 3; k++) {
        const w = m.adj[part[i] * 3 + k];
        if (w < 0 || !inSet.has(w) || seen.has(w) || cut.has(key(vs[k], vs[(k + 1) % 3]))) continue;
        seen.add(w);
        part.push(w);
      }
    }
    parts.push(part);
  }
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

/**
 * The shortest way along the patch's edges (`nbr`) from any of `starts` to any of `goal`, through
 * none of `shut`, with only its two ends on the outline. Null when there is none.
 */
function wayAcross(
  m: Mesh, nbr: Map<number, number[]>, starts: number[], goal: Set<number>, onOutline: Set<number>, shut: Set<number>,
): number[] | null {
  const P = (v: number) => vtx(m.pos, v);
  const far = new Map<number, number>(), from = new Map<number, number>();
  // The nearest open vertex first, from a heap: on a patch of a hundred thousand triangles
  // looking through every open one each time is the difference between seconds and hours.
  const heap: [number, number][] = [];
  const push = (d: number, v: number) => {
    let i = heap.length;
    heap.push([d, v]);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let least = i;
        if (l < heap.length && heap[l][0] < heap[least][0]) least = l;
        if (r < heap.length && heap[r][0] < heap[least][0]) least = r;
        if (least === i) break;
        [heap[least], heap[i]] = [heap[i], heap[least]];
        i = least;
      }
    }
    return top;
  };
  for (const v of starts) { far.set(v, 0); push(0, v); }
  while (heap.length) {
    const [d0, v] = pop();
    // An entry from before the vertex was reached a shorter way.
    if (d0 > far.get(v)!) continue;
    if (goal.has(v) && d0 > 0) {
      const path = [v];
      for (let u = from.get(v); u !== undefined; u = from.get(u)) path.push(u);
      return path;
    }
    for (const y of nbr.get(v) ?? []) {
      if (shut.has(y) || (onOutline.has(y) && !goal.has(y))) continue;
      const d = d0 + dist(P(v), P(y));
      if (d >= (far.get(y) ?? Infinity)) continue;
      far.set(y, d);
      from.set(y, v);
      push(d, y);
    }
  }
  return null;
}

/**
 * The patch's local vertices: each mesh vertex once for every fan of the patch's triangles round
 * it (triangles that share a side at the vertex are one fan), and for each triangle corner which
 * local vertex it is. Nearly every vertex has one fan; one where the outline touches itself has
 * two, and walked by fan such an outline is still the loops it is.
 */
function fansOf(m: Mesh, tris: number[]): { verts: number[]; corner: Int32Array } {
  const index = new Map(tris.map((t, f) => [t, f]));
  const corner = new Int32Array(tris.length * 3).fill(-1);
  const verts: number[] = [];
  for (let c0 = 0; c0 < corner.length; c0++) {
    if (corner[c0] >= 0) continue;
    const v = m.tri[tris[(c0 / 3) | 0] * 3 + (c0 % 3)];
    const id = verts.length;
    verts.push(v);
    corner[c0] = id;
    const stack = [c0];
    while (stack.length) {
      const c = stack.pop()!;
      const t = tris[(c / 3) | 0], j = c % 3;
      // The two sides of this triangle that meet at v, and the patch's triangle across each.
      for (const k of [j, (j + 2) % 3]) {
        const w = m.adj[t * 3 + k];
        const g = w < 0 ? undefined : index.get(w);
        if (g === undefined) continue;
        const at = m.tri[w * 3] === v ? 0 : m.tri[w * 3 + 1] === v ? 1 : 2;
        if (corner[g * 3 + at] >= 0) continue;
        corner[g * 3 + at] = id;
        stack.push(g * 3 + at);
      }
    }
  }
  return { verts, corner };
}

/** The outline turning at least this much at both ends of a side across the patch marks a crease along it, in radians. */
const KINK_TURN = (15 * Math.PI) / 180;
/** The fewest triangles each side of a cut across the rows keeps. */
const KINK_LEAST = 2;

/**
 * A patch cut along one side of a triangle from outline to outline where its outline kinks at both
 * ends: two curves joined by straight lines with a crease along one of the lines (two faces of the
 * design meeting at an angle) have their curves kinked at its two ends. No chain of edges marks
 * such a cut, so the cut finder cannot see it. Null when there is no such side.
 */
function kinkCut(m: Mesh, tris: number[]): [number[], number[]] | null {
  const inSet = new Set(tris);
  const nextOf = new Map<number, number>(), prevOf = new Map<number, number>();
  const inner: [number, number][] = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = m.tri[t * 3 + k], b = m.tri[t * 3 + ((k + 1) % 3)], w = m.adj[t * 3 + k];
    if (w < 0 || !inSet.has(w)) {
      // An outline that touches itself has no single way on at that vertex: such a patch is opened elsewhere.
      if (nextOf.has(a) || prevOf.has(b)) return null;
      nextOf.set(a, b);
      prevOf.set(b, a);
    } else if (a < b) inner.push([a, b]);
  }
  const P = (v: number) => vtx(m.pos, v);
  const turnAt = (v: number) => {
    const a = prevOf.get(v), b = nextOf.get(v);
    if (a === undefined || b === undefined) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot(normalize(sub(P(v), P(a))), normalize(sub(P(b), P(v)))))));
  };
  let best: [number[], number[]] | null = null, sharpest = KINK_TURN;
  for (const [a, b] of inner) {
    if (!nextOf.has(a) || !nextOf.has(b)) continue;
    const turn = Math.min(turnAt(a), turnAt(b));
    if (turn < sharpest) continue;
    const sides = splitBy(m, tris, [a, b]);
    if (!sides || Math.min(sides[0].length, sides[1].length) < KINK_LEAST) continue;
    best = sides;
    sharpest = turn;
  }
  return best;
}

/**
 * A patch whose outline touches itself at a vertex, parted there: the outline passes that vertex
 * twice, and a cut from the stretch of it between the two passes across to the rest leaves the
 * vertex once on each side. No sheet is fitted to a pinched patch: a face whose edge touches
 * itself is one a CAD program may trim on the wrong side. Null when the outline has no such vertex.
 */
function pinchCut(m: Mesh, tris: number[]): [number[], number[]] | null {
  const inSet = new Set(tris);
  const { verts, corner } = fansOf(m, tris);
  const nextOf = new Map<number, number>();
  const nbr = new Map<number, number[]>();
  const join = (a: number, b: number) => { if (!nbr.has(a)) nbr.set(a, []); nbr.get(a)!.push(b); };
  for (let f = 0; f < tris.length; f++) for (let k = 0; k < 3; k++) {
    const a = m.tri[tris[f] * 3 + k], b = m.tri[tris[f] * 3 + ((k + 1) % 3)];
    join(a, b);
    join(b, a);
    const w = m.adj[tris[f] * 3 + k];
    if (w < 0 || !inSet.has(w)) nextOf.set(corner[f * 3 + k], corner[f * 3 + ((k + 1) % 3)]);
  }
  const onOutline = new Set([...nextOf.keys()].map((i) => verts[i]));
  const walked = new Set<number>();
  for (const start of nextOf.keys()) {
    if (walked.has(start)) continue;
    const loop: number[] = [];
    for (let v: number | undefined = start; v !== undefined && !walked.has(v); v = nextOf.get(v)) { walked.add(v); loop.push(verts[v]); }
    const met = new Map<number, number>();
    for (let j = 0; j < loop.length; j++) {
      const i = met.get(loop[j]);
      met.set(loop[j], j);
      if (i === undefined) continue;
      // Between the two passes, and the rest of the loop: the vertex itself is on neither side.
      const between = loop.slice(i + 1, j).filter((v) => v !== loop[j]);
      const rest = [...loop.slice(j + 1), ...loop.slice(0, i)].filter((v) => v !== loop[j]);
      if (!between.length || !rest.length) continue;
      const far = new Set(rest);
      const path = wayAcross(m, nbr, between.filter((v) => !far.has(v)), far, onOutline, new Set([loop[j]]));
      const sides = path && splitBy(m, tris, path);
      if (sides) return sides;
    }
  }
  return null;
}

/**
 * The patch's mesh edges that lie on a real border of the original CAD. An exporter meshes each
 * CAD face on its own grid, so the grid lines run straight through a face and stop at its border:
 * a chain of edges that other lines mostly stop on, rather than cross, is such a border. A mesh
 * with no grid has none, and the cuts fall back to the smoothest line.
 */
function realBorders(m: Mesh, tris: number[]): Set<number> {
  const key = (a: number, b: number) => edgeKey(m, a, b);
  const chains = gridLines(m, tris);
  const ends = new Map<number, number>(), through = new Map<number, number>();
  for (const c of chains) c.forEach((v, i) => {
    const count = i === 0 || i === c.length - 1 ? ends : through;
    count.set(v, (count.get(v) ?? 0) + 1);
  });
  const real = new Set<number>();
  for (const c of chains) {
    let stop = 0, cross = 0;
    for (const v of c.slice(1, -1)) {
      stop += ends.get(v) ?? 0;
      // This line itself passes through each of its own inner vertices.
      cross += (through.get(v) ?? 1) - 1;
    }
    if (stop < 3 || stop < cross) continue;
    for (let i = 0; i + 1 < c.length; i++) real.add(key(c[i], c[i + 1]));
  }
  return real;
}

/** Boundary vertices a cut is looked for from, spread round the outline, and the most cuts tried out for one patch. */
const CUT_STARTS = 400, CUTS_TRIED = 1500;
/** A cut along a real border is worth making if each side keeps this share of the patch. */
const REAL_CUT_SHARE = 0.05;

/**
 * The two sides of the best cut across a patch. Along a real border of the original CAD when one
 * crosses the patch, so the line is one the designer drew; otherwise along the smoothest chain of
 * its own mesh edges. The vertices are exact, so an edge through a smooth chain is a clean curve
 * on both sides of it, where one along the ragged front of a growing region zigzags.
 */
function bestCut(m: Mesh, tris: number[], real: Set<number>): [number[], number[]] | null {
  const key = (a: number, b: number) => edgeKey(m, a, b);
  const nV = m.pos.length / 3;
  const uses = new Map<number, number>();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const e = key(m.tri[t * 3 + k], m.tri[t * 3 + ((k + 1) % 3)]);
    uses.set(e, (uses.get(e) ?? 0) + 1);
  }
  const marks = patchMarks(m, tris);
  const nbr = new Map<number, number[]>();
  const edge = new Set<number>();
  for (const [k, n] of uses) {
    const x = Math.floor(k / nV), y = k - x * nV;
    if (n === 1) { edge.add(x); edge.add(y); continue; }
    if (!nbr.has(x)) nbr.set(x, []);
    if (!nbr.has(y)) nbr.set(y, []);
    nbr.get(x)!.push(y);
    nbr.get(y)!.push(x);
  }
  const P = (v: number) => vtx(m.pos, v);
  const dir = (a: number, b: number) => normalize(sub(P(b), P(a)));
  const straightEnough = Math.cos((25 * Math.PI) / 180);

  // Trying a cut out means walking the whole patch, so on a large one only so many are tried:
  // from every few boundary vertices rather than each, and no more than CUTS_TRIED in all.
  const starts = [...edge];
  const every = Math.max(1, Math.ceil(starts.length / CUT_STARTS));
  let tried = 0;
  // From every boundary vertex, along real borders only, to each boundary vertex they reach.
  let bestReal: { sides: [number[], number[]]; balance: number } | null = null;
  for (let at = 0; at < starts.length && tried < CUTS_TRIED; at += every) {
    const s = starts[at];
    const from = new Map<number, number>([[s, -1]]);
    const queue: number[] = [];
    const visit = (v: number) => {
      for (const y of nbr.get(v) ?? []) {
        if (from.has(y) || !real.has(key(v, y))) continue;
        from.set(y, v);
        queue.push(y);
      }
    };
    visit(s);
    for (let i = 0; i < queue.length; i++) if (!edge.has(queue[i])) visit(queue[i]);
    for (const t of queue) {
      if ((every === 1 && t <= s) || !edge.has(t) || tried >= CUTS_TRIED) continue;
      const path = [t];
      for (let v = from.get(t)!; v !== -1; v = from.get(v)!) path.push(v);
      tried++;
      const sides = splitBy(m, tris, path, marks);
      if (!sides) continue;
      const smaller = Math.min(sides[0].length, sides[1].length);
      if (smaller < 6 || smaller < REAL_CUT_SHARE * tris.length) continue;
      const balance = smaller / tris.length;
      if (!bestReal || balance > bestReal.balance) bestReal = { sides, balance };
    }
  }
  if (bestReal) return bestReal.sides;

  // From every boundary vertex, along each edge into the patch, straight on until the far side.
  const seen = new Set<string>();
  let best: { sides: [number[], number[]]; score: number } | null = null;
  tried = 0;
  for (let at = 0; at < starts.length && tried < CUTS_TRIED; at += every) for (const x of nbr.get(starts[at]) ?? []) {
    const s = starts[at];
    const path = [s, x];
    const visited = new Set(path);
    let turn = 0, ok = true;
    while (!edge.has(path[path.length - 1])) {
      const last = path[path.length - 1];
      const d = dir(path[path.length - 2], last);
      let next = -1, c = -2;
      for (const y of nbr.get(last) ?? []) {
        if (visited.has(y)) continue;
        const cc = dot(d, dir(last, y));
        if (cc > c) { c = cc; next = y; }
      }
      if (next < 0 || c < straightEnough) { ok = false; break; }
      turn += Math.acos(Math.min(1, c));
      path.push(next);
      visited.add(next);
    }
    if (!ok || path.length < 3) continue;
    const id = path[0] < path[path.length - 1] ? path.join(',') : [...path].reverse().join(',');
    if (seen.has(id)) continue;
    seen.add(id);
    tried++;
    const sides = splitBy(m, tris, path, marks);
    if (!sides) continue;
    // Even sides, and as straight as can be for its length.
    const balance = Math.min(sides[0].length, sides[1].length) / tris.length;
    if (Math.min(sides[0].length, sides[1].length) < 6) continue;
    const meanTurn = turn / (path.length - 2);
    const score = Math.min(balance, 0.25) * Math.exp(-meanTurn / 0.1);
    if (!best || score > best.score) best = { sides, score };
  }
  return best?.sides ?? null;
}

/**
 * Marks for one patch, reused by every cut tried on it: which triangles are in the patch, and a
 * stamp per triangle saying which walk has seen it (a new stamp clears them all at once).
 */
type PatchMarks = { inSet: Uint8Array; seen: Uint32Array; stamp: number };
function patchMarks(m: Mesh, tris: number[]): PatchMarks {
  const inSet = new Uint8Array(m.tri.length / 3);
  for (const t of tris) inSet[t] = 1;
  return { inSet, seen: new Uint32Array(m.tri.length / 3), stamp: 0 };
}

/** The patch's triangles on either side of a path of its edges, if the path parts it in two. */
function splitBy(m: Mesh, tris: number[], path: number[], marks = patchMarks(m, tris)): [number[], number[]] | null {
  const cut = new Set<number>();
  for (let i = 0; i + 1 < path.length; i++) cut.add(edgeKey(m, path[i], path[i + 1]));
  const { inSet, seen } = marks;
  const stamp = ++marks.stamp;
  const parts: number[][] = [];
  for (const t0 of tris) {
    if (seen[t0] === stamp) continue;
    if (parts.length === 2) return null;
    const part = [t0];
    seen[t0] = stamp;
    for (let i = 0; i < part.length; i++) {
      const t = part[i];
      for (let k = 0; k < 3; k++) {
        const w = m.adj[t * 3 + k];
        if (w < 0 || !inSet[w] || seen[w] === stamp || cut.has(edgeKey(m, m.tri[t * 3 + k], m.tri[t * 3 + ((k + 1) % 3)]))) continue;
        seen[w] = stamp;
        part.push(w);
      }
    }
    parts.push(part);
  }
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}

/**
 * A disc of triangles laid flat by least-squares conformal maps (Levy et al. 2002): every
 * triangle keeps its angles as well as the whole can, and the outline finds its own shape. Two
 * far-apart boundary points are pinned, and the rest solved by conjugate gradients. Returned in
 * [0, 1]² with its long axis along u, and the root of its width over its height.
 */
function conformalFlat(
  m: Mesh, tris: number[], verts: number[], local: Map<number, number>, loop: number[],
): { uv: [number, number][]; aspect: number } | null {
  const n = verts.length, F = tris.length;
  const P = (i: number) => vtx(m.pos, verts[i]);
  // The two pins: the farthest from a boundary point, and the farthest from that.
  const ids = loop.map((v) => local.get(v)!);
  const far = (from: number) => ids.reduce((b, i) => (dist(P(i), P(from)) > dist(P(b), P(from)) ? i : b), from);
  const p0 = far(ids[0]), p1 = far(p0);
  const L = dist(P(p0), P(p1));
  if (!(L > 0) || p0 === p1) return null;

  // Each triangle's row: the sum over its corners of W_j (u_j + i v_j), scaled by its size.
  const at = new Int32Array(F * 3), wr = new Float64Array(F * 3), wi = new Float64Array(F * 3);
  const areas = tris.map((t) => m.area[t] * 2).sort((x, y) => x - y);
  const floor = 1e-3 * areas[areas.length >> 1];
  tris.forEach((t, f) => {
    const [a, b, c] = triVerts(m, t).map((v) => local.get(v)!);
    const ab = sub(P(b), P(a)), ac = sub(P(c), P(a));
    const lab = norm(ab) || 1e-12;
    const x2 = lab, x3 = dot(ab, ac) / lab, y3 = norm(cross(ab, ac)) / lab;
    const scale = 1 / Math.sqrt(Math.max(m.area[t] * 2, floor));
    const xs = [x3 - x2, -x3, x2], ys = [y3, -y3, 0];
    [a, b, c].forEach((v, j) => {
      at[f * 3 + j] = v;
      wr[f * 3 + j] = xs[j] * scale;
      wi[f * 3 + j] = ys[j] * scale;
    });
  });
  const mulA = (x: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let k = 0; k < F * 3; k++) {
      const f = (k / 3) | 0, v = at[k], u0 = x[v * 2], v0 = x[v * 2 + 1];
      out[f * 2] += wr[k] * u0 - wi[k] * v0;
      out[f * 2 + 1] += wi[k] * u0 + wr[k] * v0;
    }
  };
  const pinned = (i: number) => i === p0 * 2 || i === p0 * 2 + 1 || i === p1 * 2 || i === p1 * 2 + 1;
  const mulAT = (y: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let k = 0; k < F * 3; k++) {
      const f = (k / 3) | 0, v = at[k], re = y[f * 2], im = y[f * 2 + 1];
      out[v * 2] += wr[k] * re + wi[k] * im;
      out[v * 2 + 1] += -wi[k] * re + wr[k] * im;
    }
    for (const i of [p0 * 2, p0 * 2 + 1, p1 * 2, p1 * 2 + 1]) out[i] = 0;
  };
  // Jacobi-preconditioned conjugate gradients on the normal equations.
  const diag = new Float64Array(n * 2);
  for (let k = 0; k < F * 3; k++) {
    const w = wr[k] * wr[k] + wi[k] * wi[k];
    diag[at[k] * 2] += w;
    diag[at[k] * 2 + 1] += w;
  }
  const x = new Float64Array(n * 2);
  x[p1 * 2] = L;
  const r = new Float64Array(F * 2), q = new Float64Array(F * 2);
  mulA(x, r);
  for (let i = 0; i < r.length; i++) r[i] = -r[i];
  const z = new Float64Array(n * 2), d = new Float64Array(n * 2), w = new Float64Array(n * 2);
  const precond = () => { for (let i = 0; i < w.length; i++) w[i] = pinned(i) || !(diag[i] > 0) ? 0 : z[i] / diag[i]; };
  mulAT(r, z);
  precond();
  d.set(w);
  let gamma = 0;
  for (let i = 0; i < z.length; i++) gamma += z[i] * w[i];
  const gamma0 = gamma;
  for (let it = 0; it < 20000 && gamma > 1e-16 * gamma0 && gamma > 0; it++) {
    mulA(d, q);
    let qq = 0;
    for (let i = 0; i < q.length; i++) qq += q[i] * q[i];
    if (!(qq > 0)) break;
    const alpha = gamma / qq;
    for (let i = 0; i < x.length; i++) x[i] += alpha * d[i];
    for (let i = 0; i < r.length; i++) r[i] -= alpha * q[i];
    mulAT(r, z);
    precond();
    let g2 = 0;
    for (let i = 0; i < z.length; i++) g2 += z[i] * w[i];
    const beta = g2 / gamma;
    gamma = g2;
    for (let i = 0; i < d.length; i++) d[i] = w[i] + beta * d[i];
  }
  if (!x.every(Number.isFinite)) return null;

  // Nothing folded over (by area).
  let plus = 0, minus = 0;
  for (let f = 0; f < F; f++) {
    const [i, j, k] = [at[f * 3], at[f * 3 + 1], at[f * 3 + 2]];
    const A = (x[j * 2] - x[i * 2]) * (x[k * 2 + 1] - x[i * 2 + 1]) - (x[j * 2 + 1] - x[i * 2 + 1]) * (x[k * 2] - x[i * 2]);
    if (A >= 0) plus += A; else minus -= A;
  }
  if (Math.min(plus, minus) > 0.02 * (plus + minus)) return null;

  // Long axis along u, then into the unit square with a small margin the surface can run into.
  let cu = 0, cv = 0;
  for (let i = 0; i < n; i++) { cu += x[i * 2]; cv += x[i * 2 + 1]; }
  cu /= n; cv /= n;
  let suu = 0, svv = 0, suv = 0;
  for (let i = 0; i < n; i++) {
    const du = x[i * 2] - cu, dv = x[i * 2 + 1] - cv;
    suu += du * du; svv += dv * dv; suv += du * dv;
  }
  const th = 0.5 * Math.atan2(2 * suv, suu - svv);
  const c = Math.cos(th), sn = Math.sin(th);
  const U = new Float64Array(n), V = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const du = x[i * 2] - cu, dv = x[i * 2 + 1] - cv;
    U[i] = c * du + sn * dv;
    V[i] = -sn * du + c * dv;
  }
  const lo = (a: Float64Array) => a.reduce((p, v) => Math.min(p, v), Infinity);
  const hi = (a: Float64Array) => a.reduce((p, v) => Math.max(p, v), -Infinity);
  const u0 = lo(U), u1 = hi(U), v0 = lo(V), v1 = hi(V);
  const W = Math.max(1e-9, u1 - u0), H = Math.max(1e-9, v1 - v0);
  const margin = 0.03;
  const span = 1 - 2 * margin;
  const uv = verts.map((_, i) => [margin + span * (U[i] - u0) / W, margin + span * (V[i] - v0) / H] as [number, number]);
  return { uv, aspect: Math.sqrt(W / H) };
}

let lastFail = '';

/** A fitted sheet: `score` is its worst miss in units of what is allowed (1 is on the limit), `off` its furthest from a facet (mm). */
type Sheet = { surf: BSplineFace; err: number; score: number; off: number; net: string; params: Map<number, [number, number]> };
/** The last patch's best sheet when that missed the limits by a little: within SPARE_SCORE times them and SPARE_OFF of its facets. */
let spare: Sheet | null = null;
const SPARE_SCORE = 5, SPARE_OFF = 0.1, SPARE_EDGE = 0.05;

/**
 * One patch of triangles as a B-spline face, or null (with the reason in lastFail). A patch of long
 * thin rows is laid out along its rails first, and by the conformal map only if that does not fit.
 */
function fitPatch(
  m: Mesh, tris: number[], tol: number, guideGive: number, across: (w: number, p: V3) => V3 | null,
  onNet: () => void = () => {},
): Sheet | null {
  const field = railField(m, tris);
  if (!field) return fitLaidOut(m, tris, tol, guideGive, across, onNet, null);
  const rows = fitLaidOut(m, tris, tol, guideGive, across, onNet, field);
  if (rows) return rows;
  const rowsFail = lastFail, rowsSpare = spare;
  const flat = fitLaidOut(m, tris, tol, guideGive, across, onNet, null);
  if (flat) return flat;
  lastFail = `rows: ${rowsFail} | conformal: ${lastFail}`;
  if (!spare || (rowsSpare && rowsSpare.score < spare.score)) spare = rowsSpare;
  return null;
}

/** fitPatch with the patch laid out along its rails (`field`), or by the conformal map. */
function fitLaidOut(
  m: Mesh, tris: number[], tol: number, guideGive: number, across: (w: number, p: V3) => V3 | null,
  onNet: () => void, field: RailField | null,
): Sheet | null {
  lastFail = '';
  spare = null;
  // Local vertices, edges and the boundary.
  const verts = [...new Set(tris.flatMap((t) => triVerts(m, t)))];
  const local = new Map(verts.map((v, i) => [v, i]));
  const edgeUse = new Map<number, number>();
  const key = (a: number, b: number) => edgeKey(m, a, b);
  for (const t of tris) {
    const [a, b, c] = triVerts(m, t);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) edgeUse.set(key(x, y), (edgeUse.get(key(x, y)) ?? 0) + 1);
  }
  // Directed boundary edges, in the triangles' own order, so the loop has one orientation.
  const nextOf = new Map<number, number>();
  /** The triangle outside the patch across each boundary edge, by its start vertex. */
  const outside = new Map<number, number>();
  for (const t of tris) {
    const [a, b, c] = triVerts(m, t);
    ([[a, b], [b, c], [c, a]] as [number, number][]).forEach(([x, y], k) => {
      if (edgeUse.get(key(x, y)) !== 1) return;
      if (nextOf.has(x)) { lastFail = 'boundary touches itself'; return; }
      nextOf.set(x, y);
      outside.set(x, m.adj[t * 3 + k]);
    });
    if (lastFail === 'boundary touches itself') return null;
  }
  const euler = verts.length - edgeUse.size + tris.length;
  if (euler !== 1) { lastFail = `not a disc (euler ${euler})`; return null; }
  const loop: number[] = [];
  const first = nextOf.keys().next().value as number;
  for (let v = first; ; v = nextOf.get(v)!) {
    loop.push(v);
    if (loop.length > nextOf.size) { lastFail = 'boundary walk'; return null; }
    if (nextOf.get(v) === first) break;
  }
  if (loop.length !== nextOf.size) { lastFail = `${nextOf.size - loop.length} boundary edges in other loops`; return null; }
  if (loop.length < 4) { lastFail = 'boundary too short'; return null; }

  // Laid flat with no corners chosen: a conformal map keeps the outline's own shape, however
  // many sides it has. The surface runs on past the outline and the face's edges trim it. A patch
  // of long thin rows is laid out along its rails instead.
  const P = (v: number) => vtx(m.pos, v);
  const flat = field ? rowFlat(m, tris, verts, local, field) : conformalFlat(m, tris, verts, local, loop);
  if (!flat) { lastFail = 'flattening failed'; return null; }
  const { uv, aspect } = flat;
  const most = (flat as { most?: [number, number] }).most ?? [Infinity, Infinity];
  const isB = new Uint8Array(verts.length);
  for (const v of loop) isB[local.get(v)!] = 1;

  // The points to fit: every vertex (the boundary ones weighted up, so the edges fit), and
  // points along boundary edges far longer than the rest. An exporter leaves an edge of a
  // curved face without points between its ends only where that edge is straight, and the
  // surface would sag there with nothing to hold it. Such points go onto the neighbouring
  // face's surface where it has one; else they stay on the straight edge, held lightly.
  const pts = verts.map(P);
  const weight: number[] = verts.map((_, i) => (isB[i] ? 50 : 1));
  const uv0: [number, number][] = uv.map((q) => [q[0], q[1]]);
  const exact: boolean[] = verts.map(() => true);
  /** How far off a guide point the sheet may lie; 0 for points that are not guides. */
  const give: number[] = verts.map(() => 0);
  /** Which vertices each added point is a blend of, so its parameters can follow theirs. */
  const tie: ({ at: number[]; by: number[] } | null)[] = verts.map(() => null);
  const lens = loop.map((v) => norm(sub(P(nextOf.get(v)!), P(v)))).sort((a, b) => a - b);
  const h = lens[lens.length >> 1];
  for (const v of loop) {
    const y = nextOf.get(v)!;
    const a = P(v), b = P(y), len = norm(sub(b, a));
    const k = Math.round(len / h);
    if (k < 2) continue;
    const ua = uv[local.get(v)!], ub = uv[local.get(y)!];
    for (let i = 1; i < k; i++) {
      const f = i / k;
      const q: V3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      // The neighbour's surface, if that is where the edge is: one that stands further from the
      // straight edge than this exporter's facets ever stand from their surface was read wrongly
      // (a strip of a fin taken for a ball), and a sheet held to it leaves its own triangles.
      const there = across(outside.get(v)!, q);
      const on = there && dist(there, q) <= guideGive ? there : null;
      pts.push(on ?? q);
      weight.push(on ? 50 : 2);
      exact.push(!!on);
      give.push(0);
      tie.push({ at: [local.get(v)!, local.get(y)!], by: [1 - f, f] });
      uv0.push([ua[0] + (ub[0] - ua[0]) * f, ua[1] + (ub[1] - ua[1]) * f]);
    }
  }

  // Guide points across every large triangle. Without them a sheet is free to bulge between
  // corners 20 mm apart, and no check at the corners can see it.
  // How far a sheet may sit off this patch's facets: its own facets' sag, read from how sharply
  // neighbours turn. A facet standing for a curve lies off it by about width x turn / 8, where
  // the width is across the edge the two share (the triangles' heights above it), not along it:
  // two long thin strips of a rounded edge meet along 13 mm and stand 0.4 mm wide. A coarse
  // mesh's facets are poor guides, and held to them a sheet ripples over their creases.
  const inPatch = new Set(tris);
  const sags: number[] = [];
  for (const t of tris) {
    const vs = triVerts(m, t);
    for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w <= t || !inPatch.has(w)) continue;
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(triNormal(m, t), triNormal(m, w)))));
      const along = dist(P(vs[k]), P(vs[(k + 1) % 3])) || 1e-12;
      sags.push((((m.area[t] + m.area[w]) / along) * turn) / 8);
    }
  }
  sags.sort((a, b) => a - b);
  const sag = sags[Math.floor(sags.length * 0.9)] ?? 0;
  // Not without limit, though: the slack is for a wide patch of a coarse mesh. A strip a couple
  // of millimetres across whose triangles turn sharply (the rounded edge of a thin fin) would
  // otherwise let its sheet stand most of a millimetre off it, a bulge wider than the strip.
  let area = 0;
  for (const t of tris) area += m.area[t];
  const width = (2 * area) / lens.reduce((a, x) => a + x, 0);
  const patchGive = Math.max(guideGive, Math.min(2 * sag, GIVE_OF_WIDTH * width));
  // How closely the sheet must pass its own vertices: the edge ones within a share of the
  // facets' own sag, never tighter than the tolerance or looser than EDGE_MOST. A mesh whose
  // facets stand a fifth of a millimetre off the surface cannot pin a sheet to a thousandth:
  // only a net far denser than its points gets there, and that one ripples between them.
  const edgeTol = Math.max(tol, Math.min(EDGE_MOST, EDGE_SHARE * sag));
  const middleTol = Math.max(MIDDLE_SLACK * tol, edgeTol);
  for (const p of guidePoints(m, tris, verts, local)) {
    pts.push(p.q);
    weight.push(GUIDE_WEIGHT);
    exact.push(false);
    give.push(patchGive);
    tie.push({ at: p.at, by: p.by });
    uv0.push([
      p.by[0] * uv[p.at[0]][0] + p.by[1] * uv[p.at[1]][0] + p.by[2] * uv[p.at[2]][0],
      p.by[0] * uv[p.at[0]][1] + p.by[1] * uv[p.at[1]][1] + p.by[2] * uv[p.at[2]][1],
    ]);
  }
  /** Each triangle's corners as local vertices, and where the checks below write each nearest point. */
  const corners = new Int32Array(tris.length * 3);
  for (let f = 0; f < tris.length; f++) for (let k = 0; k < 3; k++) corners[f * 3 + k] = local.get(m.tri[tris[f] * 3 + k])!;
  const hit = surfaceHit();
  let best: Sheet | null = null;
  const tried: string[] = [];
  /** How far the sheet misses the points it must pass: those on the patch's edge, and its inner vertices. */
  const missOf = (face: BSplineFace) => {
    let edge = 0, middle = 0;
    for (let i = 0; i < pts.length; i++) {
      if (!exact[i]) continue;
      const q = pts[i], D = closestInto(face, q, params[i], hit).d;
      const e = Math.hypot(D[0] - q[0], D[1] - q[1], D[2] - q[2]);
      if (i < verts.length && !isB[i]) middle = Math.max(middle, e);
      else edge = Math.max(edge, e);
    }
    return { edge, middle };
  };
  /** How the sheet lies on the patch: its worst miss of a guide point (in units of its give, and in mm), and the share of the patch it faces the wrong way over. */
  const lieOf = (face: BSplineFace) => {
    let guided = 0, offFacets = 0;
    for (let i = verts.length; i < pts.length; i++) {
      if (!give[i]) continue;
      const q = pts[i], D = closestInto(face, q, params[i], hit).d;
      const off = Math.hypot(D[0] - q[0], D[1] - q[1], D[2] - q[2]);
      offFacets = Math.max(offFacets, off);
      guided = Math.max(guided, off / give[i]);
    }
    let facing = 0, against = 0, sideways = 0;
    for (let f = 0; f < tris.length; f++) {
      const t = tris[f];
      const p0 = params[corners[f * 3]], p1 = params[corners[f * 3 + 1]], p2 = params[corners[f * 3 + 2]];
      const start: [number, number] = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3];
      const D = closestInto(face, triCentroid(m, t), start, hit).d;
      // Which way the surface faces against the facet: a fold turns a patch of them round. A
      // sliver or two at a corner of the square, where the surface's direction is poorly
      // defined, is not a fold.
      const d = dot(normalize(hitNormal(D)), triNormal(m, t));
      if (d > 0.3) facing += m.area[t];
      else if (d < -0.3) against += m.area[t];
      else sideways += m.area[t];
    }
    return { guided, offFacets, folded: (Math.min(facing, against) + sideways) / (facing + against + sideways) };
  };
  /** The furthest the sheet itself stands from a triangle's plane, over that triangle's own stretch of it. */
  const swellOf = (face: BSplineFace) => {
    let swell = 0;
    const at = hit.d;
    for (let f = 0; f < tris.length; f++) {
      const t = tris[f];
      const ua = params[corners[f * 3]], ub = params[corners[f * 3 + 1]], uc = params[corners[f * 3 + 2]];
      const A = P(m.tri[t * 3]), n0 = m.normal[t * 3], n1 = m.normal[t * 3 + 1], n2 = m.normal[t * 3 + 2];
      for (let i = 0; i <= SWELL_STEPS; i++) for (let j = 0; j <= SWELL_STEPS - i; j++) {
        const wb = i / SWELL_STEPS, wc = j / SWELL_STEPS, wa = 1 - wb - wc;
        surfacePointInto(face, wa * ua[0] + wb * ub[0] + wc * uc[0], wa * ua[1] + wb * ub[1] + wc * uc[1], at);
        swell = Math.max(swell, Math.abs((at[0] - A[0]) * n0 + (at[1] - A[1]) * n1 + (at[2] - A[2]) * n2));
      }
    }
    return swell;
  };
  // No more control points than the points that hold them down can answer for: a net far denser
  // than its data passes through every vertex and is free to ripple in between. The guide points
  // hold it too where the facets are fine enough to be believed; on a coarse mesh, whose facets
  // stand well off the surface, only the vertices do.
  const held = exact.filter(Boolean).length + (sag <= guideGive ? give.filter((g) => g > 0).length : 0);
  const cap = Math.min(900, Math.max(NET_LEAST, Math.round(NET_PER_POINT * held)));
  const nets = new Set<string>();
  // Each point's place on the sheet is kept from one net to the next: the flattening only
  // starts them off, and a finer net fitted to places already corrected on a coarser one needs
  // far fewer control points than one that starts from the flattening again.
  const params = uv0.map((q) => [q[0], q[1]] as [number, number]);
  const misfits: number[] = [];
  let lastNet = false;
  spare = null;
  for (const N of [16, 25, 36, 49, 64, 100, 144, 196, 289, 400, 625]) {
    if (N > cap) break;
    const nu = Math.max(4, Math.round(Math.sqrt(N) * aspect)), nv = Math.max(4, Math.round(Math.sqrt(N) / aspect));
    // A long thin piece still gets the smallest net.
    const small = N === 16;
    const [iu, iv] = small && nu * nv > cap ? [4, 4] : [nu, nv];
    if (iu * iv > cap || nets.has(`${iu}x${iv}`)) continue;
    if (iu > Math.max(4, most[0]) || iv > Math.max(4, most[1])) break;
    nets.add(`${iu}x${iv}`);
    onNet();
    let surf: SplineSurface | null = null;
    let missed = Infinity;
    for (let round = 0; round < 4; round++) {
      surf = solveNet(pts, params, weight, iu, iv);
      if (!surf) break;
      if (round === 3) break;
      // Better parameters: each point's nearest point on the surface.
      let misses = 0;
      for (let i = 0; i < verts.length; i++) {
        const q = pts[i], S = hit.d;
        surfacePointInto(surf, params[i][0], params[i][1], S);
        const was = Math.hypot(S[0] - q[0], S[1] - q[1], S[2] - q[2]);
        misses = Math.max(misses, was);
        const cp = closestInto(surf, q, params[i], hit);
        // Only ever closer: a step that lands somewhere worse would spoil the next fit.
        if (Math.hypot(cp.d[0] - q[0], cp.d[1] - q[1], cp.d[2] - q[2]) < was) params[i] = [cp.u, cp.v];
      }
      // Another round on this net is not worth its cost if the net is nowhere near its points,
      // or the last round brought it little closer: the next net starts from these places anyway.
      const done = misses > FAR_OFF * middleTol || misses > SLOW_ROUND * missed;
      missed = misses;
      // The added points move with the vertices they are blends of.
      // (Written over in place: nothing else holds the added points' places.)
      for (let i = verts.length; i < pts.length; i++) {
        const { at, by } = tie[i]!;
        let u = 0, v = 0;
        for (let k = 0; k < at.length; k++) { const q = params[at[k]]; u += by[k] * q[0]; v += by[k] * q[1]; }
        const own = params[i];
        own[0] = u;
        own[1] = v;
      }
      if (done) break;
    }
    if (!surf) { tried.push(`${iu}x${iv} singular`); continue; }
    let face: BSplineFace = { kind: 'bspline', ...surf };
    let { edge, middle } = missOf(face);
    // A net that already misses its own vertices needs no further checks.
    const misfit = Math.max(edge / edgeTol, middle / middleTol);
    if (misfit > 2) {
      tried.push(`${iu}x${iv} edge ${edge.toExponential(1)} mid ${middle.toExponential(1)}`);
      // Five nets on and hardly closer: no finer net will fit this patch as it is.
      misfits.push(misfit);
      const stalled = misfits.length > STALL_NETS && misfits[misfits.length - 1] > STALL_SHARE * misfits[misfits.length - 1 - STALL_NETS];
      // Close enough to be worth keeping in reserve (see `spare`); otherwise on to the next net.
      if (misfit > SPARE_SCORE || edge > SPARE_EDGE) { if (stalled) break; continue; }
      if (stalled) lastNet = true;
    }
    let { guided, offFacets, folded } = lieOf(face);
    // Every check so far asked how near the sheet comes to a point of the mesh, and a sheet that
    // waves between its points comes near all of them: a net far finer than a patch of a few
    // long triangles passes every point of it and swells a millimetre in between. A CAD program
    // draws the sheet itself, so that is looked at too, and a sheet that swells is solved again
    // more stiffly, until it lies flat between its points or no longer passes them.
    if (folded <= 0.02 && swellOf(face) > 2 * patchGive) {
      let cured = false;
      for (const stiff of STIFFER) {
        const again = solveNet(pts, params, weight, iu, iv, stiff);
        if (!again) continue;
        const stiffer: BSplineFace = { kind: 'bspline', ...again };
        const miss = missOf(stiffer);
        if (Math.max(miss.edge / edgeTol, miss.middle / middleTol) > 2) break;
        const lie = lieOf(stiffer);
        if (lie.folded > 0.02 || swellOf(stiffer) > 2 * patchGive) continue;
        face = stiffer;
        ({ edge, middle } = miss);
        ({ guided, offFacets, folded } = lie);
        cured = true;
        break;
      }
      if (!cured) { tried.push(`${iu}x${iv} swells between its points`); if (lastNet) break; continue; }
    }
    // Tight at the edges, which must meet the next face; the middle only has to look right.
    const err = Math.max(edge, middle);
    const score = Math.max(edge / edgeTol, middle / middleTol, guided);
    tried.push(`${iu}x${iv} edge ${edge.toExponential(1)} mid ${middle.toExponential(1)} guide ${guided.toFixed(2)} folded ${folded.toFixed(3)}`);
    if (folded > 0.02) { if (lastNet) break; continue; }
    if (!best || score < best.score) best = { surf: face, err, score, off: offFacets, net: `${iu}x${iv}`, params: new Map(verts.map((v, i) => [v, params[i]])) };
    if (score <= 1 || lastNet) break;
  }
  // The best that was near but not within the limits is kept aside: if the patch cannot be cut
  // any further either, a sheet a little looser than asked is still the face that was drawn,
  // where its triangles left as they are would be a patch of facets.
  spare = best && best.score > 2 && best.score <= SPARE_SCORE && best.off <= SPARE_OFF && standsOff(m, tris, best.surf, best.params) <= 0 ? best : null;
  if (!best) { lastFail = 'no fit: ' + tried.join('; '); return null; }
  if (best.score > 2) { lastFail = `fit ${best.err.toExponential(2)} on ${best.net} | ${tried.join("; ")}`; return null; }
  return best;
}

/** Least squares for the control net, with a light thin-plate smoothing of the net itself. */
function solveNet(pts: V3[], params: [number, number][], weight: number[], nu: number, nv: number, stiff = 1): SplineSurface | null {
  const p = 3;
  const U = uniformKnots(nu, p), V = uniformKnots(nv, p);
  const n = nu * nv;
  // Two control points share a data point only if they are within three of each other both
  // ways, so the matrix is zero further than this from its diagonal, and only that band of its
  // lower half is kept: row i, column j at i * W + (j - i + band). The whole matrix is n squared
  // numbers, cleared and walked for every net tried, and that was most of the time fitting took.
  const band = 3 * nv + 3, W = band + 1;
  const A = new Float64Array(n * W);
  const B = new Float64Array(n * 3);
  const idx = new Int32Array(16), val = new Float64Array(16);
  const wu = new Float64Array(p + 1), wv = new Float64Array(p + 1);
  let wsum = 0;
  for (let k = 0; k < pts.length; k++) {
    const fu = basisInto(nu, p, U, params[k][0], wu), fv = basisInto(nv, p, V, params[k][1], wv);
    // The sixteen control points this one bears on, in rising order, so each pair is met once
    // on the lower side of the diagonal.
    let count = 0;
    for (let a = 0; a <= p; a++) for (let b = 0; b <= p; b++) {
      const w = wu[a] * wv[b];
      if (w === 0) continue;
      idx[count] = (fu + a) * nv + fv + b;
      val[count++] = w;
    }
    const wk = weight[k], q = pts[k];
    wsum += wk;
    for (let x = 0; x < count; x++) {
      const ix = idx[x], wx = wk * val[x];
      const row = ix * W + band - ix;
      for (let y = 0; y <= x; y++) A[row + idx[y]] += wx * val[y];
      B[ix * 3] += wx * q[0];
      B[ix * 3 + 1] += wx * q[1];
      B[ix * 3 + 2] += wx * q[2];
    }
  }
  // Second differences of the net along u, along v, and across.
  const lambda = 1e-6 * stiff * (wsum / n);
  const addStencil = (cells: number[], coef: number[], s: number) => {
    for (let x = 0; x < cells.length; x++) for (let y = 0; y < cells.length; y++) if (cells[y] <= cells[x]) A[cells[x] * W + band - cells[x] + cells[y]] += s * coef[x] * coef[y];
  };
  const id = (i: number, j: number) => i * nv + j;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    if (i > 0 && i < nu - 1) addStencil([id(i - 1, j), id(i, j), id(i + 1, j)], [1, -2, 1], lambda);
    if (j > 0 && j < nv - 1) addStencil([id(i, j - 1), id(i, j), id(i, j + 1)], [1, -2, 1], lambda);
    if (i < nu - 1 && j < nv - 1) addStencil([id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1)], [1, -1, -1, 1], 2 * lambda);
  }
  const X = cholesky(A, B, n, band);
  if (!X) return null;
  const ctrl: number[][][] = [];
  for (let i = 0; i < nu; i++) {
    const row: number[][] = [];
    for (let j = 0; j < nv; j++) row.push([X[id(i, j) * 3], X[id(i, j) * 3 + 1], X[id(i, j) * 3 + 2]]);
    ctrl.push(row);
  }
  return { degU: p, degV: p, knotsU: U, knotsV: V, ctrl };
}

/**
 * Solves the symmetric positive definite A X = B (three right-hand sides) in place. A holds the
 * band of its lower half (row i, column j at i * (band + 1) + j - i + band); its factor is zero
 * outside the same band, so it is written over it.
 */
function cholesky(A: Float64Array, B: Float64Array, n: number, band: number): Float64Array | null {
  const W = band + 1;
  // Where row i starts, less i: add a column to get its place.
  const row = (i: number) => i * W + band - i;
  for (let j = 0; j < n; j++) {
    const rj = row(j);
    let d = A[rj + j];
    for (let k = Math.max(0, j - band); k < j; k++) d -= A[rj + k] * A[rj + k];
    if (!(d > 1e-300)) return null;
    d = Math.sqrt(d);
    A[rj + j] = d;
    const last = Math.min(n - 1, j + band);
    for (let i = j + 1; i <= last; i++) {
      const ri = row(i);
      let s = A[ri + j];
      for (let k = Math.max(0, i - band); k < j; k++) s -= A[ri + k] * A[rj + k];
      A[ri + j] = s / d;
    }
  }
  const X = new Float64Array(n * 3);
  for (let c = 0; c < 3; c++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ri = row(i);
      let s = B[i * 3 + c];
      for (let k = Math.max(0, i - band); k < i; k++) s -= A[ri + k] * y[k];
      y[i] = s / A[ri + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1, end = Math.min(n - 1, i + band); k <= end; k++) s -= A[row(k) + i] * X[k * 3 + c];
      X[i * 3 + c] = s / A[row(i) + i];
    }
  }
  return X;
}
