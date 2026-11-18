// A sheet laid straight through a patch's rails, in one step.
//
// An exporter steps a face along its own lines, so a patch of rows has every vertex on one of a
// few lines of mesh edges, its rails, with every other edge crossing from one rail to the next:
// a round stepped along a strut in long triangles, the strip of a bevel, the seven rows of a
// rounded corner. Each rail becomes a smooth curve through its own vertices, all on the same
// knots, and the sheet is carried from rail to rail: straight across for one row, and for several
// rows as a smooth curve through the rails. Every vertex lies on it exactly, so a sheet meets its
// neighbour along a shared rail with no gap. Nothing is flattened, no net is tried and tried
// again, and nothing is cut.
//
// The rails of one patch need not be the same length: where a bar is cut off at a slant each rail
// stops a little further on than the last. Every rail then runs on past its last vertex, beside
// the rail next to it, to the range they all share, and the face's own edges trim the sheet.

import { type V3, add, cross, dist, dot, madd, norm, normalize, scale, sub } from './linalg';
import { basisAt, closestOnSurface, solveMany, surfacePointInto } from './bspline';
import { type Mesh, triNormal, triVerts, vtx } from './mesh';
import { type BSplineFace } from './freeform';

/** A stretch of a rail this many times longer than the one beside it is straight. */
const STRAIGHT = 2.5;
/** The most control points along or across the rails: past it the patch is left to the fitter. */
const MOST = 1200;
/** A line of edges that turns more than this at its end vertex has turned the patch's corner (radians). */
const END_TURN = Math.PI / 3;
/** How far off a vertex the sheet may come out (mm): rounding only. */
const EXACT = 1e-6;
/**
 * A triangle along a rail, all three corners on it, is the exporter's filler where the rail has a
 * vertex the row beside it lacks: the rail turns no more than this through its middle corner
 * (radians), and that corner rises off the other two by less than this share of the row's width.
 */
const FILL_TURN = Math.PI / 9, FILL = 0.2;
/** No more than this share of a patch's vertices may be left off its rails: with more it is not rows. */
const LOOSE = 0.25;
/** A sheet whose facets stand no further off than this is taken, and the patch's other sides are not read (mm): the limit the callers hold a sheet to. */
const GOOD = 0.02;
/** A facet's turn from its neighbour counts towards its own sag no further than this (radians): past it the two are not one curve's steps. */
const SAG_TURN = 0.4;
/**
 * The outline of a patch turns more than this at a corner (radians), and the first rail is looked
 * for among the sides between corners. Tried in turn: a rail round a tight bend turns more from
 * edge to edge than a bar's slanted end does from the rail it cuts off.
 */
const SIDE_TURNS = [Math.PI / 6, Math.PI / 12];
/** How many of the outline's longest sides are tried as the first rail, for each of those. */
const SIDES_TRIED = 3;
/** Two rails side by side cover the same ground at speeds no further apart than this. */
const RUN_APART = 3;
/**
 * Vertices of different rails this close along the sheet, as a share of the gap to their own
 * rail's next vertex, stand at one place: MERGE at least, and as much more, up to MERGE_MOST, as
 * moves the rail's curve between its vertices by no more than SNAP (mm). Moving a vertex's place
 * moves the curve beside it by that share of how far it bows off the straight line there: next
 * to nothing on a rail that runs straight, which is where a bar cut at a slant leaves every
 * rail's last vertex at a place of its own.
 */
const MERGE = 0.1, MERGE_MOST = 0.45, SNAP = 1e-3;

/** `left`: the triangles of the patch the sheet does not cover (facets of the next face left on this side of the border); none, as a rule. */
export type RailSheet = { surf: BSplineFace; params: Map<number, [number, number]>; off: number; left: number[] };

/**
 * The sheet through the rails of a patch of rows, with how far the furthest of its facets stands
 * off it (mm), or null when the patch is not rows between rails.
 */
export function railSheet(m: Mesh, tris: number[]): RailSheet | null {
  if (tris.length < 2) return null;
  const P = (v: number) => vtx(m.pos, v);
  // Branches off the row (see `branchesOf`) are no part of the chain: the row is read without
  // them. A filler's middle corner then goes on the rail between its other two; a stray tip is
  // handed back (`left`).
  const branches = branchesOf(m, tris);
  const one = chainRails(m, branches.length ? tris.filter((t) => !branches.some((f) => f.t === t)) : tris);
  if (!one) return rowSheet(m, tris);
  const fillers = branches.filter((f) => f.filler), stray = branches.filter((f) => !f.filler).map((f) => f.t);
  // One row: straight across from one rail to the other. A place along the rails for each
  // crossing edge, by how far the rails have run; a vertex takes the middle of its crossing edges.
  const total = one.steps.reduce((s, d) => s + d, 0);
  if (!(total > 0)) return null;
  const at: number[] = [0];
  for (const d of one.steps) at.push(at[at.length - 1] + d / total);
  const placeOn = (rail: number[], side: 0 | 1) => rail.map((v, i) => {
    if (i === 0) return 0;
    if (i === rail.length - 1) return 1;
    let sum = 0, n = 0;
    one.crossings.forEach((c, j) => { if (c[side] === v) { sum += at[j]; n++; } });
    return sum / n;
  });
  const us = [placeOn(one.A, 0), placeOn(one.B, 1)];
  for (const f of fillers) {
    const r = [one.A, one.B].findIndex((rail) => rail.some((v, i) => (v === f.x && rail[i + 1] === f.y) || (v === f.y && rail[i + 1] === f.x)));
    if (r < 0) return rowSheet(m, tris);
    const rail = r ? one.B : one.A, u = us[r];
    const i = rail.findIndex((v, k) => (v === f.x || v === f.y) && (rail[k + 1] === f.x || rail[k + 1] === f.y));
    const a = dist(P(rail[i]), P(f.mid)), b = dist(P(f.mid), P(rail[i + 1]));
    rail.splice(i + 1, 0, f.mid);
    u.splice(i + 1, 0, u[i] + ((u[i + 1] - u[i]) * a) / (a + b || 1));
  }
  for (const u of us) for (let i = 1; i < u.length; i++) if (!(u[i] > u[i - 1])) return null;
  const along = curvesOn([one.A.map(P), one.B.map(P)], us);
  if (!along) return null;
  const surf: BSplineFace = { kind: 'bspline', degU: 3, degV: 1, knotsU: along.knots, knotsV: [0, 0, 1, 1], ctrl: along.ctrl[0].map((p, j) => [p, along.ctrl[1][j]]) };
  const params = new Map<number, [number, number]>();
  one.A.forEach((v, i) => params.set(v, [us[0][i], 0]));
  one.B.forEach((v, i) => params.set(v, [us[1][i], 1]));
  if (!stray.length) return finish(m, tris, surf, params, false);
  const made = finish(m, tris.filter((t) => !stray.includes(t)), surf, params, false);
  if (made) made.left = stray;
  return made;
}

/** Why the last patch of several rows was refused (for the tools). */
export let rowRefusal = '';
const refuse = (why: string) => { rowRefusal = why; return null; };

/** A patch read as rows: its rails in order across it, each in order along and all running the same way, and the vertices left off them. */
type Rows = { rails: number[][]; loose: number[] };

/** Several rows: the sheet through the rails as read from one side of the patch, or from the next side if its facets stand closer to that one. */
function rowSheet(m: Mesh, tris: number[]): RailSheet | null {
  let best: RailSheet | null = null, why = '';
  for (const rows of readRows(m, tris)) {
    const sheet = sheetThrough(m, tris, rows);
    if (!sheet) why ||= rowRefusal;
    else if (!best || sheet.off < best.off) best = sheet;
    if (best && best.off <= GOOD) break;
  }
  if (!best && why) rowRefusal = why;
  return best;
}

/**
 * The sheet carried from rail to rail.
 *
 * Along: every vertex stands at its distance along its own rail, at a speed and from a start
 * that line the rail up with the one before it through the edges that cross between them. A rail
 * at one speed is a curve whose pieces join without a jump, so two knots a place hold it, and it
 * is the same curve whichever patch draws it. Places of different rails that as good as agree
 * are made one. Across: a curve through the rails for every control point along them.
 *
 * A rail runs on past its last vertex, beside the rail next to it, to the range all the rails
 * share. Nothing holds it there, so that is where the sheet gives: it is moved, by as little as
 * will do, to pass through the vertices that are on no rail (the ones an exporter puts along a
 * slanted end). A loose vertex whose triangles still do not lie along the sheet is another
 * face's, and those triangles are handed back (`left`).
 */
function sheetThrough(m: Mesh, tris: number[], { rails, loose }: Rows): RailSheet | null {
  const P = (v: number) => vtx(m.pos, v);
  const n = rails.length;
  const where = new Map<number, [number, number]>();
  rails.forEach((r, i) => r.forEach((v, j) => where.set(v, [i, j])));
  const pts = rails.map((r) => r.map(P));
  const way = pts.map(waysOf);
  const arc = pts.map((r) => { const s = [0]; for (let j = 1; j < r.length; j++) s.push(s[j - 1] + dist(r[j - 1], r[j])); return s; });
  // The edges that cross from each rail to the next, once each, and the rail vertices each loose vertex is joined to.
  const nV = m.pos.length / 3;
  const crossings: [number, number][][] = rails.map(() => []);
  const joined = new Map<number, [number, number][]>(loose.map((v) => [v, []]));
  const looseEdges: [number, number][] = [];
  const met = new Set<number>();
  for (const t of tris) {
    const vs = triVerts(m, t);
    for (let k = 0; k < 3; k++) {
      const p = vs[k], q = vs[(k + 1) % 3], key = Math.min(p, q) * nV + Math.max(p, q);
      if (met.has(key)) continue;
      met.add(key);
      const a = where.get(p), b = where.get(q);
      if (a && b) { if (Math.abs(a[0] - b[0]) === 1) crossings[Math.max(a[0], b[0])].push(a[0] < b[0] ? [a[1], b[1]] : [b[1], a[1]]); }
      else if (a) joined.get(q)?.push(a);
      else if (b) joined.get(p)?.push(b);
      else looseEdges.push([p, q]);
    }
  }
  // Each rail's start and speed: a crossing edge says where its far end stands, which is where its
  // near end stands and as much further as the edge runs along the rail it leaves.
  const from = [0], speed = [1];
  for (let i = 1; i < n; i++) {
    let N = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [j, k] of crossings[i]) {
      const x = arc[i][k];
      const y = from[i - 1] + speed[i - 1] * (arc[i - 1][j] + dot(sub(pts[i][k], pts[i - 1][j]), way[i - 1][j]));
      N++; sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    if (!N) return refuse('two rails share no edge');
    const den = N * sxx - sx * sx;
    const s = den > 1e-9 * N * sxx ? (N * sxy - sx * sy) / den : speed[i - 1];
    if (!(s * RUN_APART > speed[i - 1] && s < speed[i - 1] * RUN_APART)) return refuse('rails do not run together');
    speed.push(s);
    from.push((sy - s * sx) / N);
  }
  // A loose vertex stands where the rail vertices it is joined to say, the same way; one joined
  // only to other loose vertices, where they stand.
  const roughOf = new Map<number, number>();
  for (const v of loose) {
    const by = joined.get(v)!;
    if (by.length) roughOf.set(v, by.reduce((s, [i, j]) => s + from[i] + speed[i] * (arc[i][j] + dot(sub(P(v), pts[i][j]), way[i][j])), 0) / by.length);
  }
  for (let more = true; more;) {
    more = false;
    for (const [p, q] of looseEdges) for (const [x, y] of [[p, q], [q, p]]) {
      if (roughOf.has(x) || !roughOf.has(y)) continue;
      roughOf.set(x, roughOf.get(y)!);
      joined.set(x, joined.get(y)!);
      more = true;
    }
  }
  if (roughOf.size !== loose.length) return refuse('a vertex joined to no rail');
  const rough = loose.map((v) => roughOf.get(v)!);
  const us = arc.map((s, i) => s.map((x) => from[i] + speed[i] * x));
  // One list of places for all the rails. Vertices of different rails that stand within a small
  // share of the gap to their own rail's next vertex share one: a mesh drawn on a grid has its
  // vertices in lines across the rails, and each line is then one place and not one for each rail.
  const all: { u: number; give: number; i: number; j: number }[] = [];
  /** How far rail r bows off the straight line beside its vertex j: the larger sag of the two pieces there. */
  const bow = (r: V3[], j: number) => {
    const turn = (k: number) => (k > 0 && k + 1 < r.length ? Math.acos(Math.max(-1, Math.min(1, dot(normalize(sub(r[k], r[k - 1])), normalize(sub(r[k + 1], r[k])))))) : 0);
    const piece = (k: number) => (k >= 0 && k + 1 < r.length ? (dist(r[k], r[k + 1]) * (turn(k) + turn(k + 1))) / 16 : 0);
    return Math.max(piece(j - 1), piece(j));
  };
  us.forEach((u, i) => u.forEach((x, j) => all.push({ u: x, i, j, give: Math.min(MERGE_MOST, Math.max(MERGE, SNAP / (bow(pts[i], j) || 1e-300))) * Math.min(j ? x - u[j - 1] : Infinity, j + 1 < u.length ? u[j + 1] - x : Infinity) })));
  all.sort((p, q) => p.u - q.u);
  const places: number[] = [];
  // (The range reaches the loose vertices too: a place of its own at each end where they stand beyond the rails.)
  const least = Math.min(...rough), most = Math.max(...rough), tiny = 1e-6 * (all[all.length - 1].u - all[0].u);
  if (least < all[0].u - tiny) places.push(least);
  for (let s = 0; s < all.length;) {
    let e = s + 1, give = all[s].give, sum = all[s].u;
    while (e < all.length && all[e].u - all[s].u <= Math.min(give, all[e].give)) { give = Math.min(give, all[e].give); sum += all[e].u; e++; }
    for (let k = s; k < e; k++) us[all[k].i][all[k].j] = places.length;
    places.push(sum / (e - s));
    s = e;
  }
  if (most > places[places.length - 1] + tiny) places.push(most);
  const K = places.length - 1;
  if (K < 1) return refuse('rails of no length');
  if (2 * K + 2 > MOST || 2 * n > MOST) return refuse('too many control points');
  const first = places[0], reach = places[K] - first;
  for (let k = 0; k <= K; k++) places[k] = k === K ? 1 : (places[k] - first) / reach;
  for (const u of us) for (let j = 0; j < u.length; j++) {
    u[j] = places[u[j]];
    if (j && !(u[j] > u[j - 1])) return refuse('a rail doubles back');
  }
  // Across: each rail at its share of the way over, by how far it stands from the one before
  // where both run.
  const vs = [0];
  for (let i = 1; i < n; i++) {
    let sum = 0, N = 0;
    for (const [x, y] of [[i - 1, i], [i, i - 1]]) pts[x].forEach((p, j) => {
      const w = us[x][j];
      if (w < us[y][0] || w > us[y][us[y].length - 1]) return;
      sum += dist(p, shareOf(pts[y], us[y], w));
      N++;
    });
    if (!N || !(sum > 0)) return refuse('two rails touch');
    vs.push(vs[i - 1] + sum / N);
  }
  const span = vs[n - 1];
  for (let i = 0; i < n; i++) vs[i] = i === n - 1 ? 1 : vs[i] / span;
  const over = acrossRails(vs);
  if (!over) return refuse('no curve across the rails');
  // Every rail at every place: where it is and how fast it runs. The sheet is these and nothing else.
  const knotsU = [0, 0, 0, 0, ...places.slice(1, -1).flatMap((w) => [w, w]), 1, 1, 1, 1];
  const sheetOf = (states: { p: V3; d: V3 }[][]): BSplineFace => {
    const along = states.map((at) => {
      const ctrl: V3[] = [at[0].p];
      for (let k = 0; k < K; k++) {
        const g = (places[k + 1] - places[k]) / 3;
        ctrl.push(madd(at[k].p, at[k].d, g), madd(at[k + 1].p, at[k + 1].d, -g));
      }
      ctrl.push(at[K].p);
      return ctrl;
    });
    const ctrl = along[0].map((_, c) => over.weights.map((w) => {
      const p: V3 = [0, 0, 0];
      for (let i = 0; i < n; i++) if (w[i]) for (let d = 0; d < 3; d++) p[d] += w[i] * along[i][c][d];
      return p;
    }));
    return { kind: 'bspline', degU: 3, degV: over.deg, knotsU, knotsV: over.knots, ctrl };
  };
  /** The sheet through the rails and through these of the loose vertices, with every vertex's place on it. */
  const lay = (held: number[]): { surf: BSplineFace; params: Map<number, [number, number]> } | null => {
    const states = pts.map((r, i) => railAt(r, us[i], way[i], places));
    // Past its last vertex a rail runs on beside the nearest rail that goes further: as far from
    // it, at every place, as where it stopped. (Straight on, a short rail soon leaves the surface
    // the others bend along, and takes the sheet between them with it.) Only the rail that goes
    // furthest runs straight on.
    for (const after of [false, true]) {
      const endOf = (i: number) => (after ? us[i][us[i].length - 1] : -us[i][0]);
      const done: number[] = [];
      for (const i of rails.map((_, x) => x).sort((x, y) => endOf(y) - endOf(x))) {
        const guide = done.filter((j) => endOf(j) > endOf(i)).sort((x, y) => Math.abs(x - i) - Math.abs(y - i))[0];
        done.push(i);
        if (guide === undefined) continue;
        const e = places.indexOf(Math.abs(endOf(i)));
        const shift = sub(states[i][e].p, states[guide][e].p);
        for (let q = after ? e + 1 : e - 1; q >= 0 && q <= K; q += after ? 1 : -1) states[i][q] = { p: add(states[guide][q].p, shift), d: [...states[guide][q].d] };
      }
    }
    const params = new Map<number, [number, number]>();
    rails.forEach((r, i) => r.forEach((v, j) => params.set(v, [us[i][j], vs[i]])));
    const surf = sheetOf(states);
    if (!held.length) return { surf, params };
    // Each loose vertex's nearest point of the sheet, and what the sheet there is made of: the
    // rails' states at the two places either side, by known weights. Where a rail stands is
    // free at every place it has no vertex of its own, and how fast it runs is free everywhere:
    // those are moved by the least that takes the sheet to every loose vertex at once.
    const free: { i: number; q: number; slope: boolean }[] = [], index = new Map<string, number>();
    const rows: Map<number, number>[] = [], miss: number[][] = [];
    for (const v of held) {
      const by = joined.get(v)!;
      const start: [number, number] = [Math.min(1, Math.max(0, (rough[loose.indexOf(v)] - first) / reach)), by.reduce((s, [i]) => s + vs[i], 0) / by.length];
      const hit = closestOnSurface(surf, P(v), start);
      params.set(v, [hit.u, hit.v]);
      miss.push([0, 1, 2].map((d) => P(v)[d] - hit.d[0][d]));
      let k = 0;
      while (k + 1 < K && hit.u > places[k + 1]) k++;
      const h = places[k + 1] - places[k], t = (hit.u - places[k]) / h;
      const parts: [number, boolean, number][] = [[k, false, 2 * t * t * t - 3 * t * t + 1], [k, true, (t * t * t - 2 * t * t + t) * h], [k + 1, false, 3 * t * t - 2 * t * t * t], [k + 1, true, (t * t * t - t * t) * h]];
      const { first: l0, w } = basisAt(over.weights.length, over.deg, over.knots, hit.v);
      const row = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        let share = 0;
        w.forEach((x, l) => { share += x * over.weights[l0 + l][i]; });
        for (const [q, slope, part] of parts) {
          if (!(share * part) || (!slope && us[i].includes(places[q]))) continue;
          const name = `${i}/${q}/${slope}`;
          if (!index.has(name)) { index.set(name, free.length); free.push({ i, q, slope }); }
          row.set(index.get(name)!, share * part);
        }
      }
      rows.push(row);
    }
    const G = rows.map((x) => rows.map((y) => { let s = 0; for (const [id, c] of x) s += c * (y.get(id) ?? 0); return s; }));
    const pull = solveMany(G, miss, 3);
    if (!pull) return refuse('a vertex the sheet cannot be brought to');
    rows.forEach((row, a) => {
      for (const [id, c] of row) {
        const { i, q, slope } = free[id], target = slope ? states[i][q].d : states[i][q].p;
        for (let d = 0; d < 3; d++) target[d] += c * pull[a][d];
      }
    });
    return { surf: sheetOf(states), params };
  };
  const laid = lay(loose);
  if (!laid) return null;
  const far: number[] = [];
  const made = finish(m, tris, laid.surf, laid.params, true, far);
  if (!made) return refuse('the sheet misses a vertex');
  if (made.off <= GOOD || !loose.length) return made;
  // A loose vertex whose triangles do not lie along the sheet even when it passes through it is
  // not this face's: the tip of a facet of the next face that the border left on this side. The
  // sheet is laid again without it, and its triangles are handed back.
  const isLoose = new Set(loose);
  const others = new Set(far.flatMap((t) => triVerts(m, t).filter((v) => isLoose.has(v))));
  if (!far.every((t) => triVerts(m, t).some((v) => others.has(v)))) return made;
  const kept = tris.filter((t) => !triVerts(m, t).some((v) => others.has(v)));
  const again = lay(loose.filter((v) => !others.has(v)));
  const whole = again && kept.length && finish(m, kept, again.surf, again.params, true);
  if (!whole) return made;
  whole.left = tris.filter((t) => triVerts(m, t).some((v) => others.has(v)));
  return whole;
}

/** The point at place w of a line of points standing at `at`, straight from each to the next. */
function shareOf(r: V3[], at: number[], w: number): V3 {
  let i = 0;
  while (i + 2 < r.length && w > at[i + 1]) i++;
  return madd(r[i], sub(r[i + 1], r[i]), (w - at[i]) / (at[i + 1] - at[i]));
}

/**
 * A patch of rows read from each of its longest sides in turn.
 *
 * The first rail is a side of the outline. The next is every vertex one edge away from it, and
 * so on across the patch: each triangle then lies between one rail and the next, and the vertices
 * of one rail are joined in a line. Three things an exporter does are read for what they are. A
 * vertex one rail has and the row beside it does not is closed off with a thin triangle along
 * the rail, all three corners on it: that triangle is no row, and its middle corner stands on the
 * rail. A rail that runs on past the end of the one before it (the stepped end of a bar cut at a
 * slant) is followed along the outline for as long as it goes straight on. And where a bar is
 * cut off, the vertices along the cut are the next face's, not this one's rails': one that does
 * not carry a rail straight on is left off the rails, with its triangles in no row.
 */
function* readRows(m: Mesh, tris: number[]): Generator<Rows, void, undefined> {
  const P = (v: number) => vtx(m.pos, v);
  const nV = m.pos.length / 3;
  const key = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  const T = tris.map((t) => triVerts(m, t));
  const at = new Map<number, number[]>(), nbr = new Map<number, Set<number>>(), sides = new Map<number, number>();
  T.forEach((t, f) => t.forEach((a, k) => {
    const b = t[(k + 1) % 3];
    if (!at.has(a)) { at.set(a, []); nbr.set(a, new Set()); }
    if (!nbr.has(b)) { at.set(b, []); nbr.set(b, new Set()); }
    at.get(a)!.push(f);
    nbr.get(a)!.add(b);
    nbr.get(b)!.add(a);
    sides.set(key(a, b), (sides.get(key(a, b)) ?? 0) + 1);
  }));
  // The outline, once round.
  const onward = new Map<number, number[]>();
  for (const [a, around] of nbr) for (const b of around) if (a < b && sides.get(key(a, b)) === 1) {
    onward.set(a, [...(onward.get(a) ?? []), b]);
    onward.set(b, [...(onward.get(b) ?? []), a]);
  }
  if (!onward.size) { refuse('no outline'); return; }
  for (const ways of onward.values()) if (ways.length !== 2) { refuse('outline touches itself'); return; }
  const loop: number[] = [];
  const start = onward.keys().next().value as number;
  for (let prev = -1, v = start; ;) {
    loop.push(v);
    const w = onward.get(v)!.find((x) => x !== prev) ?? prev;
    if (w === start || loop.length > onward.size) break;
    prev = v;
    v = w;
  }
  if (loop.length !== onward.size) { refuse('a hole in it'); return; }
  const L = loop.length;
  const dir = (a: number, b: number) => normalize(sub(P(b), P(a)));
  /** How far the line a to b to c turns at b (radians). */
  const turnAt = (a: number, b: number, c: number) => Math.acos(Math.max(-1, Math.min(1, dot(dir(a, b), dir(b, c)))));
  /** How far vertex z stands off the line through x and y. */
  const height = (z: number, x: number, y: number) => norm(cross(sub(P(y), P(x)), sub(P(z), P(x)))) / (dist(P(x), P(y)) || 1e-300);
  /** The middle corner of a triangle that is three vertices along one line, or -1 if it is not that thin. */
  const middleOf = (t: number[]) => {
    const k = [0, 1, 2].find((i) => turnAt(t[(i + 1) % 3], t[i], t[(i + 2) % 3]) < FILL_TURN);
    return k === undefined ? -1 : t[k];
  };

  let why = '', said = '';
  const fail = (reason: string) => { why = reason; return null; };
  /** The rails counted off from one side of the outline, or null with `why`. */
  const read = (seed: number[]): Rows | null => {
    const level = new Map<number, number>();
    const used = new Uint8Array(T.length);
    const rails: number[][] = [], loose: number[] = [];
    /** Left off the rails, and its triangles with it: they are in no row. */
    const drop = (v: number) => { level.set(v, -1); loose.push(v); for (const f of at.get(v)!) used[f] = 1; };
    /**
     * A rail goes straight on to its last vertex: one it turns into as a filler's corner would
     * not be turned, and twice as far as at the vertex before, is not its own (the tip of a spike
     * of the next face, a vertex along the cut).
     */
    const trim = (path: number[]) => {
      for (const front of [true, false]) while (path.length >= 4) {
        const [e, a, b, c] = front ? path : path.slice(-4).reverse();
        const turn = turnAt(b, a, e);
        if (!(turn > FILL_TURN && turn > 2 * turnAt(c, b, a))) break;
        drop(e);
        if (front) path.shift(); else path.pop();
      }
      return path;
    };
    for (let rail = trim([...seed]); ;) {
      const k = rails.length;
      // The row beyond this rail: every triangle at it that the row before did not take. First a
      // vertex that stands on this rail's own line is put on it: the corner of a triangle on two
      // of the rail's vertices that hardly rises off them, where the row is several times wider.
      let row: number[] = [];
      for (; ;) {
        const index = new Map(rail.map((v, i) => [v, i]));
        row = [...new Set(rail.flatMap((v) => at.get(v)!.filter((f) => !used[f])))];
        const wide: number[] = [], thin: { b: number; at: number; rise: number }[] = [];
        for (const f of row) {
          const mine = T[f].filter((v) => index.has(v)), others = T[f].filter((v) => !index.has(v));
          if (mine.length === 3) continue;
          const [z, x, y] = mine.length === 2 ? [others[0], mine[0], mine[1]] : [mine[0], others[0], others[1]];
          const rise = height(z, x, y);
          wide.push(rise);
          const i = index.get(x)!, j = index.get(y)!;
          if (mine.length === 2 && Math.abs(i - j) === 1 && !level.has(z) && middleOf(T[f]) === z) thin.push({ b: z, at: Math.max(i, j), rise });
        }
        wide.sort((p, q) => p - q);
        const fill = thin.find((c) => c.rise < FILL * wide[wide.length >> 1]);
        if (!fill) break;
        rail.splice(fill.at, 0, fill.b);
      }
      const index = new Map(rail.map((v, i) => [v, i]));
      for (const v of rail) level.set(v, k);
      rails.push(rail);
      if (!row.length) break;
      const next = new Set<number>();
      for (const f of row) {
        used[f] = 1;
        let on = 0;
        for (const v of T[f]) {
          const l = level.get(v);
          if (l === k) on++;
          else if (l === undefined) next.add(v);
          else return fail('a triangle over two rows');
        }
        // All three on this rail: only the thin filler along it.
        if (on === 3 && middleOf(T[f]) < 0) return fail('a triangle on one rail');
      }
      if (!next.size) break;
      // Its far side is one line of vertices. (A filler along it joins its two ends as well: that
      // edge is not part of the line.) Whatever else the row reaches is left off the rails.
      const skipped = new Set<number>();
      for (const v of next) for (const f of at.get(v)!) {
        if (used[f] || !T[f].every((w) => next.has(w))) continue;
        const b = middleOf(T[f]);
        if (b < 0) continue;
        const [x, y] = T[f].filter((w) => w !== b);
        skipped.add(key(x, y));
      }
      const same = (v: number) => [...nbr.get(v)!].filter((w) => next.has(w) && !skipped.has(key(v, w)));
      const reach = (from: number) => {
        const back = new Map<number, number>([[from, -1]]), queue = [from];
        for (let i = 0; i < queue.length; i++) for (const w of same(queue[i])) if (!back.has(w)) { back.set(w, queue[i]); queue.push(w); }
        return { queue, back };
      };
      let whole: number[] = [];
      const seen = new Set<number>();
      for (const v of next) {
        if (seen.has(v)) continue;
        const { queue } = reach(v);
        for (const w of queue) seen.add(w);
        if (queue.length > whole.length) whole = queue;
      }
      const end = reach(whole[0]).queue.pop()!;
      const { queue, back } = reach(end);
      let path: number[] = [];
      for (let v = queue[queue.length - 1]; v >= 0; v = back.get(v)!) path.push(v);
      const inPath = new Set(path);
      for (const v of next) if (!inPath.has(v)) drop(v);
      if (path.length < 2) { for (const v of path) drop(v); break; }
      // Running the same way as the rail before: by which of its vertices each end is joined to.
      const beside = (v: number) => { let sum = 0, c = 0; for (const w of nbr.get(v)!) { const i = index.get(w); if (i !== undefined) { sum += i; c++; } } return sum / c; };
      const lead = beside(path[path.length - 1]) - beside(path[0]);
      if (lead < 0 || (lead === 0 && dot(sub(P(path[path.length - 1]), P(path[0])), sub(P(rail[rail.length - 1]), P(rail[0]))) < 0)) path = path.reverse();
      // On past the end of the rail before, along the outline: an edge with nothing behind it,
      // whose triangle's third corner is on the row beyond, and which carries the rail straight
      // on where that triangle's other side would turn it.
      for (const front of [true, false]) for (; ;) {
        const e = front ? path[0] : path[path.length - 1], before = front ? path[1] : path[path.length - 2];
        const d = dir(before, e);
        let found = -1;
        for (const x of nbr.get(e)!) {
          if (level.has(x) || inPath.has(x) || sides.get(key(e, x)) !== 1) continue;
          const y = T[at.get(e)!.find((f) => T[f].includes(x))!].find((v) => v !== e && v !== x)!;
          if (level.has(y) || inPath.has(y)) continue;
          const on = dot(d, dir(e, x));
          if (on > Math.cos(SIDE_TURNS[0]) && on > Math.abs(dot(d, dir(y, x)))) found = x;
        }
        if (found < 0) break;
        if (front) path.unshift(found); else path.push(found);
        inPath.add(found);
      }
      rail = trim(path);
    }
    for (const v of nbr.keys()) if (!level.has(v)) drop(v);
    if (rails.length < 2) return fail('one rail');
    if (loose.length > LOOSE * nbr.size) return fail(`${loose.length} of ${nbr.size} vertices on no rail`);
    // A rail is a smooth line: it turns no corner, and it does not jog from one line to another
    // (a turn at one vertex that the vertices beside it do not share).
    for (const [k, r] of rails.entries()) {
      const turns = r.map((_, i) => (i && i + 1 < r.length ? turnAt(r[i - 1], r[i], r[i + 1]) : 0));
      for (let i = 1; i + 1 < r.length; i++) {
        if (turns[i] > END_TURN || (turns[i] > FILL_TURN && turns[i] > 2 * Math.max(turns[i - 1], turns[i + 1]))) return fail(`a rail turns a corner (rail ${k} of ${rails.length}, vertex ${i} of ${r.length})`);
      }
    }
    return { rails, loose };
  };

  const tried = new Set<string>();
  for (const turn of SIDE_TURNS) {
    const corners = loop.map((_, i) => i).filter((i) => turnAt(loop[(i + L - 1) % L], loop[i], loop[(i + 1) % L]) > turn);
    if (corners.length < 2) continue;
    const found = corners.map((c, k) => {
      const side = [loop[c]];
      let length = 0;
      for (let i = c; i !== corners[(k + 1) % corners.length];) { const j = (i + 1) % L; length += dist(P(loop[i]), P(loop[j])); side.push(loop[j]); i = j; }
      return { side, length };
    }).filter((s) => s.side.length >= 2).sort((x, y) => y.length - x.length);
    for (const { side } of found.slice(0, SIDES_TRIED)) {
      const name = `${side[0]}/${side[1]}/${side.length}`;
      if (tried.has(name)) continue;
      tried.add(name);
      const rows = read(side);
      if (rows) yield rows;
      // (The longest side's reason is the one worth telling.)
      else said ||= why;
    }
  }
  refuse(`rows: ${said || 'no side to start from'}`);
}

/**
 * How the sheet is carried across rails standing at `vs` (0 to 1): the degree and knots across,
 * and for each control point across, its weight on each rail's own. Two rails: straight. Rails
 * evenly spread: the one smooth curve through them all (a parabola through three, a cubic spline
 * through more, with no knot at the second rail and the last but one), which needs no more
 * control points than there are rails. Rails unevenly spread: piece by piece, each piece from its
 * own rails and the ones beside them only, since a smooth curve through a wide flat row beside
 * narrow rows of a round bulges over the flat one.
 */
function acrossRails(vs: number[]): { deg: number; knots: number[]; weights: number[][] } | null {
  const n = vs.length;
  const unit = (i: number): number[] => vs.map((_, r) => (r === i ? 1 : 0));
  if (n === 2) return { deg: 1, knots: [0, 0, 1, 1], weights: [unit(0), unit(1)] };
  const gap = vs.slice(1).map((v, i) => v - vs[i]);
  if (Math.max(...gap) < STRAIGHT * Math.min(...gap)) {
    if (n === 3) {
      const t = vs[1], mid = 2 * t * (1 - t);
      return { deg: 2, knots: [0, 0, 0, 1, 1, 1], weights: [unit(0), [-((1 - t) ** 2) / mid, 1 / mid, -(t * t) / mid], unit(2)] };
    }
    const knots = [0, 0, 0, 0, ...vs.slice(2, n - 2), 1, 1, 1, 1];
    const A = vs.map((v) => {
      const row = new Array<number>(n).fill(0);
      const { first, w } = basisAt(n, 3, knots, v);
      w.forEach((x, k) => { row[first + k] = x; });
      return row;
    });
    const weights = solveMany(A, vs.map((_, i) => unit(i)), n);
    return weights && { deg: 3, knots, weights };
  }
  // The slope at each rail, as weights on the rails: that of the parabola through it and the two
  // beside it, or of the longer stretch alone where one is several times the other.
  const chord = (i: number) => vs.map((_, r) => (r === i + 1 ? 1 / gap[i] : r === i ? -1 / gap[i] : 0));
  const mix = (x: number[], a: number, y: number[], b: number) => x.map((v, r) => a * v + b * y[r]);
  const slope: number[][] = vs.map(() => []);
  for (let i = 1; i + 1 < n; i++) {
    const a = gap[i - 1], b = gap[i];
    slope[i] = a >= STRAIGHT * b ? chord(i - 1) : b >= STRAIGHT * a ? chord(i) : mix(chord(i - 1), b / (a + b), chord(i), a / (a + b));
  }
  slope[0] = mix(chord(0), 2, slope[1], -1);
  slope[n - 1] = mix(chord(n - 2), 2, slope[n - 2], -1);
  const weights = [unit(0)];
  for (let i = 0; i + 1 < n; i++) weights.push(mix(unit(i), 1, slope[i], gap[i] / 3), mix(unit(i + 1), 1, slope[i + 1], -gap[i] / 3));
  weights.push(unit(n - 1));
  return { deg: 3, knots: [0, 0, 0, 0, ...vs.slice(1, -1).flatMap((v) => [v, v]), 1, 1, 1, 1], weights };
}

/**
 * The sheet with how far its facets stand off it (those further than a good sheet's go into
 * `far`), or null if it misses one of its own vertices.
 *
 * `rows`: a sheet through several rails. It curves across its rows where their facets are flat,
 * so a facet is allowed its own sag (how far it stands off the curve it was cut from: its width
 * across the side it shares with a neighbour in the patch, times how far the two turn there, over
 * eight, with the turn counted no further than SAG_TURN), and only what is beyond that counts. And it is
 * looked at in three places along every side, not one: see below.
 */
function finish(m: Mesh, tris: number[], surf: BSplineFace, params: Map<number, [number, number]>, rows: boolean, far?: number[]): RailSheet | null {
  const P = (v: number) => vtx(m.pos, v);
  for (const [v, place] of params) {
    const q = closestOnSurface(surf, P(v), place).d[0];
    if (dist(P(v), [q[0], q[1], q[2]]) > EXACT) return null;
  }
  // The middle of every triangle and three points along every side, each to the nearest point
  // of the sheet, looked for from where its corners' places put it. (The sides too: two triangles
  // folded along the side they share have their middles close to a sheet that cuts straight
  // across the fold. And more than a side's middle: where a rail's run past its end swings
  // across a side, the middle alone can lie on the sheet with the rest of the side well off it.)
  let off = 0, sag = 0;
  const inPatch = new Set(rows ? tris : []);
  // One row: the facets are flat across it, but a side along a rail is a chord of the rail's curve,
  // which bows off it by as much as the rail turns at the side's two ends (its length times the two
  // turns over sixteen): that much is the side's own sag.
  const railBow = new Map<number, number>();
  if (!rows) for (const side of [0, 1]) {
    const rail = [...params].filter(([, p]) => p[1] === side).sort((x, y) => x[1][0] - y[1][0]).map(([v]) => v);
    const turn = (i: number) => (i > 0 && i + 1 < rail.length ? Math.acos(Math.max(-1, Math.min(1, dot(normalize(sub(P(rail[i]), P(rail[i - 1]))), normalize(sub(P(rail[i + 1]), P(rail[i]))))))) : 0);
    for (let i = 0; i + 1 < rail.length; i++) railBow.set(Math.min(rail[i], rail[i + 1]) * (m.pos.length / 3) + Math.max(rail[i], rail[i + 1]), (dist(P(rail[i]), P(rail[i + 1])) * (turn(i) + turn(i + 1))) / 16);
  }
  const at = [0, 0, 0];
  let n: V3 = [0, 0, 0], A: V3 = [0, 0, 0];
  const measure = (vs: number[], share: number[]) => {
    let u = 0, v = 0;
    const mid: V3 = [0, 0, 0];
    vs.forEach((w, k) => {
      const place = params.get(w)!, p = P(w);
      u += place[0] * share[k];
      v += place[1] * share[k];
      for (let d = 0; d < 3; d++) mid[d] += p[d] * share[k];
    });
    const near = closestOnSurface(surf, mid, [u, v]).d[0];
    off = Math.max(off, dist(mid, [near[0], near[1], near[2]]) - sag);
    // And the sheet itself at the same share of its corners' places, against the facet's plane:
    // a sheet twisted between two long rails can pass close to every point of a facet somewhere
    // and still stand well off it over the facet's own stretch.
    surfacePointInto(surf, Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)), at);
    off = Math.max(off, Math.abs((at[0] - A[0]) * n[0] + (at[1] - A[1]) * n[1] + (at[2] - A[2]) * n[2]) - sag);
  };
  for (const tri of tris) {
    const vs = triVerts(m, tri);
    if (vs.some((v) => !params.has(v))) return null;
    const before = off;
    off = 0;
    sag = 0;
    n = triNormal(m, tri);
    A = P(vs[0]);
    if (!rows) for (let e = 0; e < 3; e++) sag = Math.max(sag, railBow.get(Math.min(vs[e], vs[(e + 1) % 3]) * (m.pos.length / 3) + Math.max(vs[e], vs[(e + 1) % 3])) ?? 0);
    if (rows) for (let e = 0; e < 3; e++) {
      const w = m.adj[tri * 3 + e];
      if (!inPatch.has(w)) continue;
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(triNormal(m, tri), triNormal(m, w)))));
      sag = Math.max(sag, (((m.area[tri] + m.area[w]) / (dist(P(vs[e]), P(vs[(e + 1) % 3])) || 1e-300)) * Math.min(turn, SAG_TURN)) / 8);
    }
    measure(vs, [1 / 3, 1 / 3, 1 / 3]);
    for (let e = 0; e < 3; e++) for (const s of [0.25, 0.5, 0.75]) measure([vs[e], vs[(e + 1) % 3]], [1 - s, s]);
    for (const s of [[0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) measure(vs, s);
    if (off > GOOD) far?.push(tri);
    off = Math.max(off, before);
  }
  surf.places = params;
  surf.rails = surf.degV === 1 ? 2 : new Set([...params.values()].map((p) => p[1])).size;
  return { surf, params, off, left: [] };
}

/**
 * Triangles hanging off one row on a side of their own: each at the end of a branch, joined to a
 * triangle that has the patch on all three sides. One whose three corners lie along one line (it
 * turns no more than FILL_TURN through its middle one) is the exporter's filler, closing off a rail
 * where it has a vertex the row beside it lacks (`filler`). One that stands off the row is the tip
 * of a facet of the next face that the border left on this side. With the two corners each shares
 * with the row (x, y) and its third (mid).
 */
function branchesOf(m: Mesh, tris: number[]): { t: number; x: number; y: number; mid: number; filler: boolean }[] {
  const inSet = new Set(tris);
  const P = (v: number) => vtx(m.pos, v);
  const inner = (t: number) => [0, 1, 2].filter((k) => inSet.has(m.adj[t * 3 + k]));
  const out: { t: number; x: number; y: number; mid: number; filler: boolean }[] = [];
  for (const t of tris) {
    const ks = inner(t);
    if (ks.length !== 1 || inner(m.adj[t * 3 + ks[0]]).length !== 3) continue;
    const x = m.tri[t * 3 + ks[0]], y = m.tri[t * 3 + ((ks[0] + 1) % 3)], mid = m.tri[t * 3 + ((ks[0] + 2) % 3)];
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(normalize(sub(P(mid), P(x))), normalize(sub(P(y), P(mid)))))));
    out.push({ t, x, y, mid, filler: turn < FILL_TURN });
  }
  return out;
}

/**
 * The two rails of a patch one row wide: its triangles are a chain, each joined to the next
 * across one edge, every such edge joining a vertex of rail A to one of rail B. With the edges
 * crossed in order and how far the rails run from each to the next. Null when it is not one row.
 */
function chainRails(m: Mesh, tris: number[]): { A: number[]; B: number[]; crossings: [number, number][]; steps: number[] } | null {
  if (tris.length < 2) return null;
  const inSet = new Set(tris);
  const P = (v: number) => vtx(m.pos, v);
  const inner = (t: number) => [0, 1, 2].filter((k) => inSet.has(m.adj[t * 3 + k]));
  const ends = tris.filter((t) => inner(t).length === 1);
  if (ends.length !== 2 || tris.some((t) => { const n = inner(t).length; return n < 1 || n > 2; })) return null;
  const along = (x: number, y: number, p: number, q: number) => Math.abs(dot(normalize(sub(P(y), P(x))), normalize(sub(P(q), P(p)))));
  const A: number[] = [], B: number[] = [];
  const steps: number[] = [];
  const crossings: [number, number][] = [];
  let t = ends[0];
  const k = inner(t)[0];
  let a = m.tri[t * 3 + k], b = m.tri[t * 3 + ((k + 1) % 3)];
  // The vertex at each end of the chain is put on its rail last (see below).
  const z0 = m.tri[t * 3 + ((k + 2) % 3)];
  let z1 = -1;
  A.push(a);
  B.push(b);
  crossings.push([a, b]);
  for (let count = 1; count < tris.length; count++) {
    // Over the crossing edge a-b into the next triangle.
    let found = -1;
    for (let e = 0; e < 3 && found < 0; e++) {
      const p = m.tri[t * 3 + e], q = m.tri[t * 3 + ((e + 1) % 3)];
      if ((p === a && q === b) || (p === b && q === a)) found = m.adj[t * 3 + e];
    }
    if (found < 0 || !inSet.has(found)) return null;
    t = found;
    const w = triVerts(m, t).find((v) => v !== a && v !== b);
    if (w === undefined) return null;
    // Which of a, b the new vertex replaces: the one not on the triangle's other inner edge.
    const others = inner(t).map((e) => [m.tri[t * 3 + e], m.tri[t * 3 + ((e + 1) % 3)]]).filter(([p, q]) => !((p === a && q === b) || (p === b && q === a)));
    if (others.length === 0) { z1 = w; break; }
    if (others.length !== 1) return null;
    if (others[0].includes(b)) { if (A.includes(w)) return null; steps.push(dist(P(a), P(w))); A.push(w); a = w; }
    else { if (B.includes(w)) return null; steps.push(dist(P(b), P(w))); B.push(w); b = w; }
    crossings.push([a, b]);
  }
  if (z1 < 0) return null;
  // The vertex at each end goes on the rail it carries straight on: a rail is a smooth line, and
  // the patch's end turns a corner. Where a rail is one vertex so far and cannot say, the other
  // rail decides, and where neither can, the outline side that runs with the crossing edge is the end.
  const turn = (p: number, q: number, r: number) => Math.acos(Math.max(-1, Math.min(1, dot(normalize(sub(P(q), P(p))), normalize(sub(P(r), P(q)))))));
  for (const start of [true, false]) {
    const z = start ? z0 : z1;
    const a0 = start ? A[0] : A[A.length - 1], b0 = start ? B[0] : B[B.length - 1];
    const ta = A.length > 1 ? turn(z, a0, start ? A[1] : A[A.length - 2]) : Infinity;
    const tb = B.length > 1 ? turn(z, b0, start ? B[1] : B[B.length - 2]) : Infinity;
    const onA = ta === Infinity && tb === Infinity ? along(a0, b0, z, b0) >= along(a0, b0, a0, z)
      : ta === Infinity ? tb > END_TURN : tb === Infinity ? ta <= END_TURN : ta <= tb;
    const rail = onA ? A : B;
    if (rail.includes(z)) return null;
    const step = dist(P(z), P(onA ? a0 : b0)), crossing: [number, number] = onA ? [z, b0] : [a0, z];
    if (start) { rail.unshift(z); steps.unshift(step); crossings.unshift(crossing); }
    else { rail.push(z); steps.push(step); crossings.push(crossing); }
  }
  // (A fan from a single point is left to the fitter for now: the sheet comes to a point there,
  // where nothing can say which way it faces.)
  if (A.length < 2 || B.length < 2) return null;
  // Two rails run the same way, and neither doubles back: a long triangle with a small one
  // folded over its end is a chain too, but no surface swept from one line to another.
  const reach = (rail: number[]) => sub(P(rail[rail.length - 1]), P(rail[0]));
  if (dot(reach(A), reach(B)) <= 0) return null;
  for (const rail of [A, B]) for (let i = 2; i < rail.length; i++) {
    if (dot(sub(P(rail[i - 1]), P(rail[i - 2])), sub(P(rail[i]), P(rail[i - 1]))) <= 0) return null;
  }
  return { A, B, crossings, steps };
}

/** Every rail as a curve on one set of knots: three at every place a vertex of any rail stands. */
function curvesOn(rails: V3[][], us: number[][]): { knots: number[]; ctrl: V3[][] } | null {
  const places = [...new Set([0, 1, ...us.flat()])].sort((p, q) => p - q).filter((u, i, all) => i === 0 || u - all[i - 1] > 1e-9);
  if (3 * (places.length - 1) + 1 > MOST) return null;
  return { knots: [0, 0, 0, 0, ...places.slice(1, -1).flatMap((u) => [u, u, u]), 1, 1, 1, 1], ctrl: rails.map((r, i) => chain(r, us[i], places)) };
}

/**
 * Which way the smooth line through `pts` runs at each of them: as the circle through the point
 * and its two neighbours, except beside a stretch several times longer than the other, which is
 * straight (a mesher puts no vertices inside a straight run). At its two ends it leaves as the
 * circle through its last two points and that direction would.
 */
function waysOf(pts: V3[]): V3[] {
  const n = pts.length;
  const len = (i: number) => dist(pts[i], pts[i + 1]);
  const way = (i: number) => normalize(sub(pts[i + 1], pts[i]));
  const dir: V3[] = pts.map(() => [0, 0, 0]);
  for (let i = 1; i + 1 < n; i++) {
    const a = len(i - 1), b = len(i), ep = way(i - 1), en = way(i);
    dir[i] = a >= STRAIGHT * b ? ep : b >= STRAIGHT * a ? en : normalize([ep[0] * b + en[0] * a, ep[1] * b + en[1] * a, ep[2] * b + en[2] * a]);
  }
  const bounce = (e: V3, d: V3): V3 => { const k = 2 * dot(e, d); return normalize([k * e[0] - d[0], k * e[1] - d[1], k * e[2] - d[2]]); };
  dir[0] = n === 2 ? way(0) : bounce(way(0), dir[1]);
  dir[n - 1] = n === 2 ? way(0) : bounce(way(n - 2), dir[n - 2]);
  return dir;
}

/**
 * Where the smooth line through `pts` is, and how fast it runs, at each of `places`. The points
 * stand at `at` (each one of `places`) and the line runs the way `dir` says there. Piece by piece
 * as in `chain`, with one speed through each vertex, the mean of its two pieces': where a rail's
 * vertices stand by their distance along it that is the same curve, handles a third of each
 * piece. Before its first vertex and after its last it runs straight on.
 */
function railAt(pts: V3[], at: number[], dir: V3[], places: number[]): { p: V3; d: V3 }[] {
  const n = pts.length;
  const len = (i: number) => dist(pts[i], pts[i + 1]), step = (i: number) => at[i + 1] - at[i];
  const vel = pts.map((_, i) => scale(dir[i], i === 0 ? len(0) / step(0) : i === n - 1 ? len(n - 2) / step(n - 2) : (len(i - 1) + len(i)) / (step(i - 1) + step(i))));
  let i = 0;
  return places.map((w): { p: V3; d: V3 } => {
    if (w <= at[0]) return { p: madd(pts[0], vel[0], w - at[0]), d: [...vel[0]] };
    if (w >= at[n - 1]) return { p: madd(pts[n - 1], vel[n - 1], w - at[n - 1]), d: [...vel[n - 1]] };
    while (w >= at[i + 1]) i++;
    if (w === at[i]) return { p: [...pts[i]], d: [...vel[i]] };
    const h = step(i), t = (w - at[i]) / h, r = 1 - t;
    const p: V3 = [0, 0, 0], d: V3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const b0 = pts[i][c], b1 = b0 + (vel[i][c] * h) / 3, b3 = pts[i + 1][c], b2 = b3 - (vel[i + 1][c] * h) / 3;
      p[c] = r * r * r * b0 + 3 * r * r * t * b1 + 3 * r * t * t * b2 + t * t * t * b3;
      d[c] = (3 * r * r * (b1 - b0) + 6 * r * t * (b2 - b1) + 3 * t * t * (b3 - b2)) / h;
    }
    return { p, d };
  });
}

/**
 * The control points, on three knots at each of `places`, of the smooth line through `pts`, which
 * stand at `at`. The line is made piece by piece: the piece between two points depends on them
 * and their neighbours only, so a long straight stretch beside a tight round does not ring. Each
 * piece has handles a third of its own length, whatever its share of `at`: points crowd together
 * there wherever another rail runs on.
 */
function chain(pts: V3[], at: number[], places: number[]): V3[] {
  const n = pts.length;
  if (n === 1) return Array.from({ length: 3 * (places.length - 1) + 1 }, () => pts[0]);
  const len = (i: number) => dist(pts[i], pts[i + 1]);
  const dir = waysOf(pts);
  /** At place w, on the piece between points i and i + 1: point and derivative by place. */
  const on = (w: number, i: number) => {
    const h = at[i + 1] - at[i], L = len(i) / 3, t = (w - at[i]) / h, r = 1 - t;
    const p: V3 = [0, 0, 0], v: V3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const b0 = pts[i][c], b1 = b0 + dir[i][c] * L, b3 = pts[i + 1][c], b2 = b3 - dir[i + 1][c] * L;
      p[c] = r * r * r * b0 + 3 * r * r * t * b1 + 3 * r * t * t * b2 + t * t * t * b3;
      v[c] = (3 * r * r * (b1 - b0) + 6 * r * t * (b2 - b1) + 3 * t * t * (b3 - b2)) / h;
    }
    return { p, d: v };
  };
  const ctrl: V3[] = [];
  let i = 0;
  for (let j = 0; j + 1 < places.length; j++) {
    const from = places[j], to = places[j + 1], h = (to - from) / 3;
    while (i + 2 < n && (from + to) / 2 > at[i + 1]) i++;
    const s = on(from, i), e = on(to, i);
    if (j === 0) ctrl.push(s.p);
    ctrl.push([s.p[0] + s.d[0] * h, s.p[1] + s.d[1] * h, s.p[2] + s.d[2] * h], [e.p[0] - e.d[0] * h, e.p[1] - e.d[1] * h, e.p[2] - e.d[2] * h], e.p);
  }
  return ctrl;
}
