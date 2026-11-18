// Where faces meet, worked out from their surfaces: the point nearest all of them, the exact line
// or circle two analytic surfaces share where there is one, and a curve's points as a STEP file
// means them (from its first vertex to its last, in the curve's own direction).
//
// The mesh only says which faces meet and roughly where. An edge an importer can close has to lie
// on both of its faces along its whole length, not only at the mesh points it was drawn through,
// so every curve here is measured between its points as well.

import { type V3, basis, cross, dist, dot, madd, norm, normalize, scale, sub } from './linalg';
import { type Spline, type SplineSurface, type SurfaceHit, closest, closestInto, curveDers, surfaceHit } from './bspline';
import { type Swept } from './swept';
import { type Surface, distance, normalAt } from './surfaces';
import { type Curve } from './topology';

/**
 * A surface as the file holds it. A round's sheet is measured in the engine against the exact
 * pipe it was made from, but the file holds the sheet's own control net, and an importer measures
 * against that; so anything that must agree with an importer measures this.
 */
export function asWritten(s: Surface): Surface {
  if (s.kind !== 'bspline' || !s.pipe) return s;
  let w = written.get(s);
  if (!w) written.set(s, (w = { ...s, pipe: undefined }));
  return w;
}
const written = new WeakMap<object, Surface>();

// ---------------------------------------------------------------------------------------------
// Sheets that close on themselves.

const closesOf = new WeakMap<object, { u: boolean; v: boolean }>();

/**
 * Whether a sheet closes on itself, read from the sheet: in u when its first row of control
 * points is its last (a round all the way round a hole is laid that way), in v when every row's
 * first point is its last. Its parameters then wrap at that seam: a point just past u = 1 is at
 * u = 0, and a search or a loop on it has to carry on across the seam rather than stop there.
 */
export function sheetCloses(s: SplineSurface): { u: boolean; v: boolean } {
  let c = closesOf.get(s.ctrl);
  if (c) return c;
  const net = s.ctrl, nu = net.length, nv = net[0].length;
  let size = 0;
  for (const row of net) for (const q of row) size = Math.max(size, Math.abs(q[0]), Math.abs(q[1]), Math.abs(q[2]));
  // The same point written twice: equal to the last digits of its coordinates.
  const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 1e-9 * (1 + size);
  let u = nu > 2, v = nv > 2;
  for (let j = 0; j < nv && u; j++) u = same(net[0][j], net[nu - 1][j]);
  for (let i = 0; i < nu && v; i++) v = same(net[i][0], net[i][nv - 1]);
  c = { u, v };
  closesOf.set(s.ctrl, c);
  return c;
}

/** Where `nearestOnSheet` tries the far side of a seam from. */
const across = surfaceHit();

/**
 * The nearest point of a sheet to q, as `closestInto` finds it, and on a sheet that closes on
 * itself the same search again from just across the seam whenever it stops at the seam: the
 * search is held inside the knot range, so it stops at u = 1 when the nearest point is just past
 * it at u = 0 (and the sheet is only continuous, not smooth, across the seam, so it cannot slide
 * over). The nearer of the two is written into `hit`.
 */
export function nearestOnSheet(s: SplineSurface, q: number[], start: [number, number] | undefined, hit: SurfaceHit): SurfaceHit {
  const c = closestInto(s, q, start, hit);
  const cl = sheetCloses(s);
  if (!cl.u && !cl.v) return c;
  const u0 = s.knotsU[0], u1 = s.knotsU[s.knotsU.length - 1], v0 = s.knotsV[0], v1 = s.knotsV[s.knotsV.length - 1];
  const atU = cl.u && (c.u - u0 <= SEAM * (u1 - u0) || u1 - c.u <= SEAM * (u1 - u0));
  const atV = cl.v && (c.v - v0 <= SEAM * (v1 - v0) || v1 - c.v <= SEAM * (v1 - v0));
  if (!atU && !atV) return c;
  const far = (x: number, lo: number, hi: number) => (x - lo < hi - x ? hi - SEAM * (hi - lo) : lo + SEAM * (hi - lo));
  const away = (h: SurfaceHit) => (h.d[0] - q[0]) ** 2 + (h.d[1] - q[1]) ** 2 + (h.d[2] - q[2]) ** 2;
  let best = away(c);
  const tries: [number, number][] = [];
  if (atU) tries.push([far(c.u, u0, u1), c.v]);
  if (atV) tries.push([c.u, far(c.v, v0, v1)]);
  if (atU && atV) tries.push([far(c.u, u0, u1), far(c.v, v0, v1)]);
  for (const t of tries) {
    const o = closestInto(s, q, t, across);
    const d = away(o);
    if (d < best) { best = d; hit.u = o.u; hit.v = o.v; hit.d.set(o.d); }
  }
  return hit;
}

/** How near the end of the knot range (as a share of it) a search counts as stopped at a seam. */
const SEAM = 1e-6;

/**
 * Weights of places on a sheet blended into one place (a start for a search inside a facet). On a
 * sheet that closes on itself, places either side of the seam are first brought to the same side
 * (a facet across the seam has corners at u = 0.99 and u = 0.01, and their plain mean is half way
 * round), and the blend is put back inside the knot range.
 */
export function blendPlaces(s: SplineSurface, places: [number, number][], w: number[]): [number, number] {
  const cl = sheetCloses(s);
  const blend = (k: 0 | 1, closed: boolean, lo: number, hi: number) => {
    const span = hi - lo, ref = places[0][k];
    let x = 0;
    places.forEach((p, i) => {
      let y = p[k];
      if (closed) y += span * Math.round((ref - y) / span);
      x += w[i] * y;
    });
    if (closed) x = lo + ((((x - lo) % span) + span) % span);
    return Math.min(hi, Math.max(lo, x));
  };
  return [blend(0, cl.u, s.knotsU[0], s.knotsU[s.knotsU.length - 1]), blend(1, cl.v, s.knotsV[0], s.knotsV[s.knotsV.length - 1])];
}

/** Where a sheet's nearest-point search last ended, and how near a new point must be to start from there. */
const lastOn = new WeakMap<object, { p: V3; u: number; v: number; reach: number }>();
const hit = surfaceHit();

/**
 * A point's signed distance from a surface and the direction it grows fastest, which is the
 * direction from the nearest point of the surface to p. Inside a sheet that is its normal; beyond
 * the sheet's edge, where the nearest point is on that edge, it is not, and a search that took the
 * normal there would never reach a curve the two faces meet in along the sheet's own edge.
 */
export function probe(s: Surface, p: V3, thorough = false): { d: number; n: V3 } {
  if (s.kind === 'revolution' || s.kind === 'extrusion') return probeSwept(s, p, thorough);
  if (s.kind !== 'bspline' || s.pipe) return { d: distance(s, p), n: normalAt(s, p) };
  const last = lastOn.get(s);
  let reach = last?.reach;
  if (reach === undefined) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const row of s.ctrl) for (const c of row) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], c[d]); hi[d] = Math.max(hi[d], c[d]); }
    reach = 0.01 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  }
  const g = s.graph;
  const start: [number, number] | undefined = g
    ? [Math.min(1, Math.max(0, (dot(sub(p, g.c), g.e1) - g.lo[0]) / (g.hi[0] - g.lo[0]))), Math.min(1, Math.max(0, (dot(sub(p, g.c), g.e2) - g.lo[1]) / (g.hi[1] - g.lo[1])))]
    : last && dist(last.p, p) <= reach ? [last.u, last.v] : undefined;
  let c = nearestOnSheet(s, p, start, hit);
  // A search from a nearby start can stop in a fold of the sheet far from p. When measuring
  // (`thorough`), a point found far off is searched for again over the whole sheet, from the
  // nearest of a dense sampling of it.
  if (thorough && start && Math.hypot(p[0] - c.d[0], p[1] - c.d[1], p[2] - c.d[2]) > RECHECK) {
    const u = c.u, v = c.v, d0 = Math.hypot(p[0] - c.d[0], p[1] - c.d[1], p[2] - c.d[2]);
    c = nearestOnSheet(s, p, undefined, hit);
    if (Math.hypot(p[0] - c.d[0], p[1] - c.d[1], p[2] - c.d[2]) > d0) c = nearestOnSheet(s, p, [u, v], hit);
  }
  lastOn.set(s, { p, u: c.u, v: c.v, reach });
  const D = c.d;
  const r: V3 = [p[0] - D[0], p[1] - D[1], p[2] - D[2]];
  const nn: V3 = [D[4] * D[8] - D[5] * D[7], D[5] * D[6] - D[3] * D[8], D[3] * D[7] - D[4] * D[6]];
  const d = norm(r);
  const sign = dot(r, nn) >= 0 ? 1 : -1;
  if (d < 1e-12) return { d: 0, n: normalize(nn) };
  return { d: sign * d, n: [(sign * r[0]) / d, (sign * r[1]) / d, (sign * r[2]) / d] };
}

/** Where a profile's nearest-point search last ended. */
const lastT = new WeakMap<object, { q: [number, number]; t: number; reach: number }>();

/**
 * The same for a swept surface, the same numbers as `sweptDistance` and `sweptNormal` (the
 * distance in the profile's own plane), from one search of the profile instead of two, started
 * where the last one ended when the point is near the last one: the edges ask for one surface
 * thousands of times, each point a hair from the last, and a search from scratch scans the whole
 * profile every time.
 */
function probeSwept(s: Swept, p: V3, thorough: boolean): { d: number; n: V3 } {
  const v = sub(p, s.o);
  let q: [number, number], u: V3, w: V3;
  if (s.kind === 'revolution') {
    const z = dot(v, s.a);
    const radial = madd(v, s.a, -z);
    const rho = norm(radial);
    q = [rho, z]; u = rho > 1e-12 ? [radial[0] / rho, radial[1] / rho, radial[2] / rho] : s.ref; w = s.a;
  } else { q = [dot(v, s.e1), dot(v, s.e2)]; u = s.e1; w = s.e2; }
  const c = s.profile;
  const last = lastT.get(s);
  let reach = last?.reach;
  if (reach === undefined) {
    let lo0 = Infinity, lo1 = Infinity, hi0 = -Infinity, hi1 = -Infinity;
    for (const k of c.ctrl) { lo0 = Math.min(lo0, k[0]); hi0 = Math.max(hi0, k[0]); lo1 = Math.min(lo1, k[1]); hi1 = Math.max(hi1, k[1]); }
    reach = 0.01 * Math.hypot(hi0 - lo0, hi1 - lo1);
  }
  let t: number, P: number[], D1: number[];
  const t0 = c.knots[0], t1 = c.knots[c.knots.length - 1];
  const warm = last && Math.hypot(q[0] - last.q[0], q[1] - last.q[1]) <= reach ? newton(c, q, last.t, t0, t1) : null;
  if (warm) ({ t, p: P, d1: D1 } = warm);
  else ({ t, p: P, d1: D1 } = fromScratch(c, q));
  if (thorough && warm && Math.hypot(q[0] - P[0], q[1] - P[1]) > RECHECK) {
    const g = fromScratch(c, q);
    if (Math.hypot(q[0] - g.p[0], q[1] - g.p[1]) < Math.hypot(q[0] - P[0], q[1] - P[1])) ({ t, p: P, d1: D1 } = g);
  }
  lastT.set(s, { q, t, reach });
  const dx = q[0] - P[0], dy = q[1] - P[1];
  const d = Math.hypot(dx, dy);
  const side = dx * D1[1] - dy * D1[0];
  const L = Math.hypot(D1[0], D1[1]) || 1;
  const n = normalize(madd(scale(u, D1[1] / L), w, -D1[0] / L));
  return { d: side >= 0 ? d : -d, n };
}

/** Dense samples of a profile, kept with it, as `closest` in bspline.ts takes them, packed. */
const profileSamples = new WeakMap<object, { t: Float64Array; p: Float64Array }>();

/**
 * The nearest point of a profile to q from the nearest of its dense samples, as `closest` finds it
 * but with the samples packed and nothing made per sample.
 */
function fromScratch(c: Spline, q: [number, number]): { t: number; p: number[]; d1: number[] } {
  let smp = profileSamples.get(c);
  if (!smp) {
    const k = Math.max(64, Math.max(1, c.ctrl.length - c.degree) * 12);
    const t = new Float64Array(k + 1), p = new Float64Array((k + 1) * 2);
    for (let i = 0; i <= k; i++) { t[i] = i / k; const x = curveDers(c, i / k)[0]; p[i * 2] = x[0]; p[i * 2 + 1] = x[1]; }
    smp = { t, p };
    profileSamples.set(c, smp);
  }
  let best = 0, bd = Infinity;
  for (let i = 0; i < smp.t.length; i++) {
    const dx = smp.p[i * 2] - q[0], dy = smp.p[i * 2 + 1] - q[1], d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return newton(c, q, smp.t[best], 0, 1) ?? closest(c, q);
}

/** Newton on (C - q)·C' = 0 from t, kept in [t0, t1]; null if it does not settle. */
function newton(c: Spline, q: [number, number], start: number, t0: number, t1: number): { t: number; p: number[]; d1: number[] } | null {
  let t = start;
  let D = curveDers(c, t, 2);
  for (let it = 0; it < 30; it++) {
    const r0 = D[0][0] - q[0], r1 = D[0][1] - q[1];
    const f = r0 * D[1][0] + r1 * D[1][1];
    const df = D[1][0] * D[1][0] + D[1][1] * D[1][1] + r0 * D[2][0] + r1 * D[2][1];
    if (!(Math.abs(df) > 1e-300)) return null;
    const next = Math.min(t1, Math.max(t0, t - f / df));
    const moved = Math.abs(next - t);
    t = next;
    D = curveDers(c, t, 2);
    if (moved < 1e-15) return { t, p: D[0], d1: D[1] };
  }
  return { t, p: D[0], d1: D[1] };
}

/** Past this distance from a sheet (mm), its nearest point is looked for over the whole sheet too. */
const RECHECK = 0.01;

/** A point's distance from a surface, unsigned, as `probe` finds it. */
export const offOne = (s: Surface, p: V3, thorough = false) => Math.abs(probe(s, p, thorough).d);

/** How far a point stands off the farther of some surfaces (mm). */
export function offAll(surfs: Surface[], p: V3): number {
  let off = 0;
  for (const s of surfs) {
    const d = offOne(s, p);
    if (!(d <= off)) off = Number.isFinite(d) ? d : Infinity;
  }
  return off;
}

/**
 * The point nearest all the surfaces, starting from p0 and held near it: least squares on the
 * surfaces' distances plus a light pull back to p0, which decides the point only along a
 * direction the surfaces leave free (a line two faces share, or a band where they touch). Where
 * the surfaces meet this is the point of their meeting nearest p0; where they only touch it is
 * half way between them; where they do not come together at all it is the best compromise, and
 * never more than `reach` from p0 (a bad fit must not drag a point away across the part).
 */
export function onAll(surfs: Surface[], p0: V3, reach = Infinity): V3 {
  if (!surfs.length) return p0;
  let lambda = 1e-3;
  let p = p0;
  for (let attempt = 0; attempt < 4; attempt++) {
    p = settle(surfs, p0, p, lambda);
    if (dist(p, p0) <= reach) return p;
    // Too far: pull harder towards the start and look again.
    lambda *= 30;
  }
  const d = dist(p, p0);
  return d > reach ? madd(p0, sub(p, p0), reach / d) : p;
}

/** Damped Gauss-Newton on sum(d_i^2) + lambda |p - p0|^2, from p. */
function settle(surfs: Surface[], p0: V3, start: V3, lambda: number): V3 {
  let p = start;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < 3; i++) { b[i] = lambda * (p0[i] - p[i]); for (let j = 0; j < 3; j++) A[i][j] = i === j ? lambda : 0; }
    for (const s of surfs) {
      const { d, n } = probe(s, p);
      if (!Number.isFinite(d) || !n.every(Number.isFinite)) continue;
      for (let i = 0; i < 3; i++) {
        b[i] -= n[i] * d;
        for (let j = 0; j < 3; j++) A[i][j] += n[i] * n[j];
      }
    }
    const step = solve3(A, b);
    if (!step) break;
    const q: V3 = [p[0] + step[0], p[1] + step[1], p[2] + step[2]];
    if (!q.every(Number.isFinite)) break;
    p = q;
    if (Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]) < 1e-11) break;
  }
  return p;
}

/** A 3 x 3 solve by Cramer's rule (the matrix here is symmetric and positive definite). */
function solve3(A: number[][], b: number[]): V3 | null {
  const [a, bb, c] = A[0], [d, e, f] = A[1], [g, h, k] = A[2];
  const det = a * (e * k - f * h) - bb * (d * k - f * g) + c * (d * h - e * g);
  if (!(Math.abs(det) > 1e-300)) return null;
  const x = (b[0] * (e * k - f * h) - bb * (b[1] * k - f * b[2]) + c * (b[1] * h - e * b[2])) / det;
  const y = (a * (b[1] * k - f * b[2]) - b[0] * (d * k - f * g) + c * (d * b[2] - b[1] * g)) / det;
  const z = (a * (e * b[2] - b[1] * h) - bb * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)) / det;
  return [x, y, z];
}

// ---------------------------------------------------------------------------------------------
// The exact meeting of two analytic surfaces.

/** The line a surface is turned round, or for a plane its normal (any axis along it), for a sphere its centre (any axis through it). */
type Turned = { o: V3; a: V3 } | { n: V3 } | { c: V3 };
function turnedRound(s: Surface): Turned | null {
  switch (s.kind) {
    case 'cylinder': return { o: s.o, a: s.a };
    case 'cone': return { o: s.apex, a: s.a };
    case 'torus': return { o: s.c, a: s.a };
    case 'revolution': return { o: s.o, a: s.a };
    case 'plane': return { n: s.n };
    case 'sphere': return { c: s.c };
    default: return null;
  }
}

/** Distance of a point from a line through o along unit a (mm). */
export const offAxis = (p: V3, o: V3, a: V3) => { const d = sub(p, o); return norm(madd(d, a, -dot(d, a))); };
const parallel = (a: V3, b: V3) => 1 - Math.abs(dot(a, b)) < 1e-6;

/** The one axis both surfaces are turned round, if they share one: they meet in circles round it. */
export function sharedAxis(sf: Surface, sg: Surface): { o: V3; a: V3 } | null {
  const x = turnedRound(sf), y = turnedRound(sg);
  if (!x || !y) return null;
  for (const [p, q] of [[x, y], [y, x]] as const) {
    if ('a' in p) {
      if ('a' in q && parallel(p.a, q.a) && offAxis(q.o, p.o, p.a) < 1e-3) return p;
      if ('n' in q && parallel(p.a, q.n)) return p;
      if ('c' in q && offAxis(q.c, p.o, p.a) < 1e-3) return p;
    }
    // A sphere and a plane: the axis through the centre square to the plane. Two spheres: through both centres.
    if ('c' in p && 'n' in q) return { o: p.c, a: q.n };
    if ('c' in p && 'c' in q && dist(p.c, q.c) > 1e-6) return { o: p.c, a: normalize(sub(q.c, p.c)) };
  }
  return null;
}

/** The direction both surfaces run straight along, if there is one: they meet in lines along it. */
function sharedRun(sf: Surface, sg: Surface): V3 | null {
  const run = (s: Surface): V3 | 'any' | null =>
    s.kind === 'plane' ? 'any' : s.kind === 'cylinder' || s.kind === 'extrusion' ? s.a : null;
  const x = run(sf), y = run(sg);
  if (!x || !y) return null;
  if (x === 'any' && y === 'any') {
    const d = cross((sf as { n: V3 }).n, (sg as { n: V3 }).n);
    return norm(d) > 1e-6 ? normalize(d) : null;
  }
  if (x === 'any') return Math.abs(dot((sf as { n: V3 }).n, y as V3)) < 1e-6 ? (y as V3) : null;
  if (y === 'any') return Math.abs(dot((sg as { n: V3 }).n, x)) < 1e-6 ? x : null;
  return parallel(x, y as V3) ? x : null;
}

/**
 * Two numbers (h, w) placing a point in a plane, solved so that both surfaces pass through it:
 * Levenberg-Marquardt on their two distances, from the given start. Where the surfaces only touch
 * it settles where they come closest.
 */
function meetIn(sf: Surface, sg: Surface, at: (h: number, w: number) => V3, e1: V3, e2: V3, h0: number, w0: number): [number, number] | null {
  let h = h0, w = w0, mu = 1e-9;
  let p = at(h, w);
  let f = distance(sf, p), g = distance(sg, p);
  for (let it = 0; it < 60; it++) {
    const nf = normalAt(sf, p), ng = normalAt(sg, p);
    const J = [[dot(nf, e1), dot(nf, e2)], [dot(ng, e1), dot(ng, e2)]];
    // (J'J + mu I) step = -J'F
    const a = J[0][0] * J[0][0] + J[1][0] * J[1][0] + mu, b = J[0][0] * J[0][1] + J[1][0] * J[1][1], c = J[0][1] * J[0][1] + J[1][1] * J[1][1] + mu;
    const r0 = -(J[0][0] * f + J[1][0] * g), r1 = -(J[0][1] * f + J[1][1] * g);
    const det = a * c - b * b;
    if (!(Math.abs(det) > 1e-300)) return null;
    const dh = (c * r0 - b * r1) / det, dw = (a * r1 - b * r0) / det;
    const q = at(h + dh, w + dw);
    const fq = distance(sf, q), gq = distance(sg, q);
    if (!Number.isFinite(fq) || !Number.isFinite(gq)) return null;
    if (fq * fq + gq * gq <= f * f + g * g) {
      h += dh; w += dw; p = q; f = fq; g = gq; mu = Math.max(1e-12, mu / 10);
      if (Math.abs(dh) + Math.abs(dw) < 1e-12) break;
    } else {
      mu *= 10;
      if (mu > 1e6) break;
    }
  }
  return Number.isFinite(h) && Number.isFinite(w) ? [h, w] : null;
}

/**
 * The line or circle two analytic surfaces meet in near the given points (the border between
 * their faces), or null where they have none in closed form: surfaces turned round one axis meet
 * in a circle round it; surfaces that run straight along one direction meet in a line along it;
 * a cylinder meets the round it runs on into across itself, in a circle of its own radius.
 * Nothing here is checked against the faces: the caller measures every candidate.
 */
export function exactMeet(sf: Surface, sg: Surface, pts: V3[], first: V3, closed: boolean): Curve[] {
  const out: Curve[] = [];
  if (pts.length < 2) return out;
  const axis = sharedAxis(sf, sg);
  if (axis) {
    let h0 = 0, w0 = 0;
    for (const p of pts) { h0 += dot(sub(p, axis.o), axis.a); w0 += offAxis(p, axis.o, axis.a); }
    h0 /= pts.length; w0 /= pts.length;
    // One half-plane through the axis: every circle round the axis crosses it once.
    const toward = madd(sub(pts[0], axis.o), axis.a, -dot(sub(pts[0], axis.o), axis.a));
    const e = norm(toward) > 1e-9 ? normalize(toward) : basis(axis.a)[0];
    const hw = meetIn(sf, sg, (h, w) => madd(madd(axis.o, axis.a, h), e, w), axis.a, e, h0, w0);
    if (hw && hw[1] > 1e-6) out.push(circleThrough(madd(axis.o, axis.a, hw[0]), axis.a, hw[1], pts, first));
  }
  const run = closed ? null : sharedRun(sf, sg);
  if (run) {
    const m: V3 = [0, 0, 0];
    for (const p of pts) for (let i = 0; i < 3; i++) m[i] += p[i] / pts.length;
    const [e1, e2] = basis(run);
    const xy = meetIn(sf, sg, (x, y) => madd(madd(m, e1, x), e2, y), e1, e2, 0, 0);
    if (xy) {
      const o = madd(madd(m, e1, xy[0]), e2, xy[1]);
      const d = dot(sub(pts[pts.length - 1], pts[0]), run) >= 0 ? run : ([-run[0], -run[1], -run[2]] as V3);
      out.push({ kind: 'line', o, d });
    }
  }
  for (const s of [sf, sg]) {
    if (s.kind !== 'cylinder') continue;
    let h = 0;
    for (const p of pts) h += dot(sub(p, s.o), s.a);
    out.push(circleThrough(madd(s.o, s.a, h / pts.length), s.a, s.r, pts, first));
  }
  return out;
}

/** A circle round an axis, turning the way the points run, its parameter starting at `first`. */
export function circleThrough(c: V3, a: V3, r: number, pts: V3[], first: V3): Curve {
  let turn = 0;
  for (let i = 0; i + 1 < pts.length; i++) turn += dot(cross(sub(pts[i], c), sub(pts[i + 1], c)), a);
  // A full loop's points may run either way; an open edge's way decides which arc is meant.
  const n: V3 = turn < 0 ? [-a[0], -a[1], -a[2]] : a;
  const d = sub(first, c);
  const flat = madd(d, n, -dot(d, n));
  const ref = norm(flat) > 1e-12 ? normalize(flat) : basis(n)[0];
  return { kind: 'circle', c, n, ref, r };
}

// ---------------------------------------------------------------------------------------------
// A curve as the file means it.

/** An edge's curve between its two vertices: where its parameter starts and ends, and the point at a parameter. */
export type Span = { t0: number; t1: number; at: (t: number) => V3; length: number; pieces: number };

/** Knots written out in full, kept with the curve. */
const fullKnots = new WeakMap<object, { degree: number; ctrl: number[][]; knots: number[] }>();

/**
 * The part of a curve an edge from `from` to `to` uses: a line between the two points' feet on it;
 * a circle from the first point's angle round to the second's in the circle's own direction (the
 * whole circle for a closed edge); a B-spline over its whole parameter range.
 */
export function spanOf(c: Curve, from: V3, to: V3, closed: boolean): Span {
  if (c.kind === 'line') {
    const t0 = dot(sub(from, c.o), c.d), t1 = dot(sub(to, c.o), c.d);
    return { t0, t1, at: (t) => madd(c.o, c.d, t), length: Math.abs(t1 - t0), pieces: 1 };
  }
  if (c.kind === 'circle') {
    const side = cross(c.n, c.ref);
    const angle = (p: V3) => { const d = sub(p, c.c); return Math.atan2(dot(d, side), dot(d, c.ref)); };
    const t0 = angle(from);
    let t1 = closed ? t0 + 2 * Math.PI : angle(to);
    while (t1 <= t0) t1 += 2 * Math.PI;
    return {
      t0, t1, length: c.r * (t1 - t0), pieces: Math.ceil((t1 - t0) / (Math.PI / 2)),
      at: (t) => { const x = c.r * Math.cos(t), y = c.r * Math.sin(t); return [c.c[0] + c.ref[0] * x + side[0] * y, c.c[1] + c.ref[1] * x + side[1] * y, c.c[2] + c.ref[2] * x + side[2] * y]; },
    };
  }
  let s = fullKnots.get(c);
  if (!s) {
    s = { degree: c.degree, ctrl: c.ctrl, knots: c.knots.flatMap((k, i) => Array<number>(c.mults[i]).fill(k)) };
    fullKnots.set(c, s);
  }
  const spline = s;
  let length = 0;
  for (let i = 0; i + 1 < c.ctrl.length; i++) length += dist(c.ctrl[i], c.ctrl[i + 1]);
  return { t0: c.knots[0], t1: c.knots[c.knots.length - 1], at: (t) => curveDers(spline, t)[0] as V3, length, pieces: Math.max(1, c.ctrl.length - c.degree) };
}

/** Samples of an edge, at least: this many, one per this length (mm), this many per curve piece, and never more than the most. */
const LEAST = 24, EVERY = 0.25, PER_PIECE = 8, MOST = 400;

/** How many samples a span is measured at: by its length and its pieces, with a floor. */
export function samplesFor(s: Span): number {
  return Math.min(MOST, Math.max(LEAST, Math.ceil(s.length / EVERY), s.pieces * PER_PIECE));
}

/**
 * The furthest a curve stands off the farther of its faces between its two vertices, and where:
 * sampled evenly in its parameter, then the worst sample narrowed down between its neighbours.
 * `stopAbove`: a caller that only needs to know the gap is over this gets the first sample over it.
 */
export function worstOff(sp: Span, off: (p: V3) => number, n = samplesFor(sp), stopAbove = Infinity): { gap: number; t: number; at: V3 } {
  let best = -1, bt = sp.t0, bp = sp.at(sp.t0);
  const dt = (sp.t1 - sp.t0) / n;
  for (let i = 0; i <= n; i++) {
    const t = sp.t0 + dt * i;
    const p = sp.at(t);
    const g = off(p);
    if (!(g <= best)) { best = Number.isFinite(g) ? g : Infinity; bt = t; bp = p; }
    if (best > stopAbove) return { gap: best, t: bt, at: bp };
  }
  // A peak between samples: search either side of the worst one.
  let h = dt / 2;
  for (let k = 0; k < 6 && best < Infinity; k++, h /= 2) {
    for (const t of [bt - h, bt + h]) {
      if (t < Math.min(sp.t0, sp.t1) || t > Math.max(sp.t0, sp.t1)) continue;
      const p = sp.at(t);
      const g = off(p);
      if (g > best) { best = g; bt = t; bp = p; }
    }
  }
  return { gap: best, t: bt, at: bp };
}

// ---------------------------------------------------------------------------------------------
// A cubic through points, solved as the banded system it is.

/**
 * The cubic (fewer points: lower degree) B-spline through the points in order: chord-length
 * parameters and averaged knots, as `interpolate` in bspline.ts, but solved in its band so a
 * curve through thousands of points costs no more per point than one through ten.
 */
export function interpolateBanded(pts: V3[]): { degree: number; ctrl: V3[]; knots: number[] } | null {
  const n = pts.length;
  const p = Math.min(3, n - 1);
  if (p < 1) return null;
  const u = new Float64Array(n);
  for (let i = 1; i < n; i++) u[i] = u[i - 1] + Math.max(1e-12, dist(pts[i], pts[i - 1]));
  const L = u[n - 1];
  for (let i = 0; i < n; i++) u[i] /= L;
  u[n - 1] = 1;
  const U: number[] = new Array<number>(p + 1).fill(0);
  for (let j = 1; j < n - p; j++) {
    let s = 0;
    for (let i = j; i < j + p; i++) s += u[i];
    U.push(s / p);
  }
  for (let i = 0; i <= p; i++) U.push(1);
  if (p === 1) return { degree: 1, ctrl: pts.map((q) => [q[0], q[1], q[2]] as V3), knots: U };
  // Row i holds basis values at columns i-p .. i+p (the band); right-hand sides beside it.
  const W = 2 * p + 1;
  const M = new Float64Array(n * W), R = new Float64Array(n * 3);
  const N = new Float64Array(p + 1);
  let span = p;
  for (let i = 0; i < n; i++) {
    const t = u[i];
    if (t >= 1) span = n - 1;
    else while (span < n - 1 && U[span + 1] <= t) span++;
    basisFuns(span, t, p, U, N);
    for (let j = 0; j <= p; j++) {
      const col = span - p + j, k = col - i + p;
      if (k < 0 || k >= W) { if (N[j] !== 0) return null; continue; }
      M[i * W + k] = N[j];
    }
    R[i * 3] = pts[i][0]; R[i * 3 + 1] = pts[i][1]; R[i * 3 + 2] = pts[i][2];
  }
  // Elimination without pivoting: the collocation matrix is totally positive, so it is stable.
  for (let c = 0; c < n; c++) {
    const piv = M[c * W + p];
    if (!(Math.abs(piv) > 1e-14)) return null;
    for (let r = c + 1; r <= Math.min(n - 1, c + p); r++) {
      const kc = c - r + p;
      const f = M[r * W + kc] / piv;
      if (f === 0) continue;
      for (let col = c; col <= Math.min(n - 1, c + p); col++) M[r * W + col - r + p] -= f * M[c * W + col - c + p];
      for (let d = 0; d < 3; d++) R[r * 3 + d] -= f * R[c * 3 + d];
    }
  }
  const ctrl: V3[] = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    const x: V3 = [R[r * 3], R[r * 3 + 1], R[r * 3 + 2]];
    for (let col = r + 1; col <= Math.min(n - 1, r + p); col++) {
      const m = M[r * W + col - r + p];
      x[0] -= m * ctrl[col][0]; x[1] -= m * ctrl[col][1]; x[2] -= m * ctrl[col][2];
    }
    const d = M[r * W + p];
    ctrl[r] = [x[0] / d, x[1] / d, x[2] / d];
  }
  if (!ctrl.every((q) => q.every(Number.isFinite))) return null;
  ctrl[0] = [pts[0][0], pts[0][1], pts[0][2]];
  ctrl[n - 1] = [pts[n - 1][0], pts[n - 1][1], pts[n - 1][2]];
  return { degree: p, ctrl, knots: U };
}

/** Scratch for `basisFuns` (degree 3 at most). */
const leftBuf = new Float64Array(4), rightBuf = new Float64Array(4);

/** The p+1 non-zero basis values at t in the given span (The NURBS Book, A2.2). */
function basisFuns(span: number, t: number, p: number, U: number[], N: Float64Array): void {
  const left = leftBuf, right = rightBuf;
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = t - U[span + 1 - j];
    right[j] = U[span + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const tmp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
}
