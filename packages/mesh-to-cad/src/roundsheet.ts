// One sheet for a round along a free curve, made from the ball that rolls it.
//
// A round of radius r between two faces is swept by a ball touching both. Where the centre-line
// is no line or circle, the round is still that sweep: every section across it is an arc of radius
// r from the contact on one face to the contact on the other, tangent to both. So the sheet is not
// fitted to the round's triangles: it is laid through the ball itself. Stations are walked along
// the centre-line; at each, the arc between the two contacts is sampled; one tensor B-spline
// interpolates them all (the same parameters across every row, so the net is one surface). The
// sheet runs a little past both contact lines and both ends, where the face's own edges trim it.
// The round's triangles are given their places on it from their own balls, so the sheet's checks
// look at each facet against its own stretch of the sheet.

import { type V3 } from './linalg';
import { type Mesh } from './mesh';
import { type SplineSurface, basisAt, solveMany } from './bspline';
import { type BSplineFace } from './freeform';
import { standsOff } from './sheetcheck';
import { type Oriented, type RoundBall, ballAt, faceNormal, newHit, vertexNormal } from './rolling';

/** The share of the arc the sheet runs on past each contact line; past each end it runs on by this share of the radius. */
const RUN_ON = 0.05;
/** Points across each arc: cubic sections through 8 pieces hold a quarter circle to a few millionths of its radius. */
const ARC_POINTS = 9;
/** The most the centre-line may turn from one station to the next (radians). */
const STATION_TURN = 0.1;
/** The longest step between stations, as a share of the radius (the sections must follow the faces' own curvature). */
const STATION_STEP = 0.5;
/** The shortest step, as a share of the radius: a line that turns faster than that is no round's spine. */
const STATION_LEAST = 0.05;

/** Why the last sheet asked for could not be laid (for the probe scripts and the report). */
export let sheetRefusal = '';
function refuse(why: string): null { sheetRefusal = why; return null; }

/** `off`: how far it stands off its facets beyond what each may (standsOff: zero or less, it holds). */
export type RoundSheet = { surf: BSplineFace; params: Map<number, [number, number]>; stations: number; closed: boolean; off: number };

/**
 * The sheet of a round with a free centre-line, or null when it cannot be laid (the ball does not
 * hold at a vertex, or the line cannot be walked). A round all the way round a hole closes on
 * itself: its sheet runs once round, the last row of points the first.
 */
export function roundSheet(m: Mesh, tris: number[], ball: RoundBall): RoundSheet | null {
  const { a: A, b: B, side: s, r } = ball;
  const hit = newHit();
  // ---- each vertex's ball: centre, and where it sits round the arc
  const vs: number[] = [];
  const index = new Map<number, number>();
  for (const t of tris) for (let k = 0; k < 3; k++) { const v = m.tri[t * 3 + k]; if (!index.has(v)) { index.set(v, vs.length); vs.push(v); } }
  const n = vs.length;
  const C = new Float64Array(n * 3), T = new Float64Array(n * 3), frac = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = vs[i], p: V3 = [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
    const nv = vertexNormal(m, v);
    if (!ballAt(A, B, s, r, p, [p[0] - s * r * nv[0], p[1] - s * r * nv[1], p[2] - s * r * nv[2]], hit)) return refuse('a vertex off every ball');
    C[i * 3] = hit.c[0]; C[i * 3 + 1] = hit.c[1]; C[i * 3 + 2] = hit.c[2];
    frac[i] = hit.frac;
    const t = spineTangent(A, B, hit.c);
    T[i * 3] = t[0]; T[i * 3 + 1] = t[1]; T[i * 3 + 2] = t[2];
  }
  // ---- distance along the centre-line, carried over the round's own edges: two vertices across
  // the arc share a centre, two along it differ by the step between their centres
  const S = new Float64Array(n).fill(NaN);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const x = index.get(m.tri[t * 3 + k])!, y = index.get(m.tri[t * 3 + ((k + 1) % 3)])!;
    adj[x].push(y); adj[y].push(x);
  }
  let reach = 0;
  for (let i = 0; i < n; i++) for (const j of adj[i]) reach = Math.max(reach, Math.hypot(C[i * 3] - C[j * 3], C[i * 3 + 1] - C[j * 3 + 1], C[i * 3 + 2] - C[j * 3 + 2]));
  const step = (i: number, j: number) => {
    // the step along the line between two centres, measured on the mean of their tangents
    let tx = T[i * 3] + T[j * 3], ty = T[i * 3 + 1] + T[j * 3 + 1], tz = T[i * 3 + 2] + T[j * 3 + 2];
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l; ty /= l; tz /= l;
    return (C[j * 3] - C[i * 3]) * tx + (C[j * 3 + 1] - C[i * 3 + 1]) * ty + (C[j * 3 + 2] - C[i * 3 + 2]) * tz;
  };
  // the tangents of one round all point one way along it
  const seed = 0;
  S[seed] = 0;
  const queue = [seed];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of adj[i]) {
      if (!Number.isNaN(S[j])) continue;
      if (T[i * 3] * T[j * 3] + T[i * 3 + 1] * T[j * 3 + 1] + T[i * 3 + 2] * T[j * 3 + 2] < 0) { T[j * 3] *= -1; T[j * 3 + 1] *= -1; T[j * 3 + 2] *= -1; }
      S[j] = S[i] + step(i, j);
      queue.push(j);
    }
  }
  if (queue.length < n) return refuse('not one piece');
  // Closed: an edge whose ends disagree by far more than its own step (the walk went round a hole
  // both ways and met itself).
  let closed = false;
  for (let i = 0; i < n && !closed; i++) for (const j of adj[i]) if (Math.abs(S[j] - S[i] - step(i, j)) > 0.25 * reach + 1e-9 * (Math.abs(S[i]) + Math.abs(S[j]))) { closed = true; break; }
  let sLo = Infinity, sHi = -Infinity;
  for (let i = 0; i < n; i++) { sLo = Math.min(sLo, S[i]); sHi = Math.max(sHi, S[i]); }
  const len = sHi - sLo;
  if (!(len > 0)) return refuse('no length');
  // ---- stations: walked from the seed's centre, each a centre on both offsets in the normal plane
  // of a point a step on along the line. Open: both ways, a little past the round's ends (where a
  // face beside it ends too, the walk stops at its end). Closed: once round, back to the start.
  const from = sLo - RUN_ON * r, to = sHi + RUN_ON * r;
  /** Whether a point lies within lim of some vertex's ball centre. */
  const besideRound = (c: V3, lim: number) => {
    for (let i = 0; i < n; i++) if (Math.abs(C[i * 3] - c[0]) <= lim && Math.abs(C[i * 3 + 1] - c[1]) <= lim && Math.abs(C[i * 3 + 2] - c[2]) <= lim && Math.hypot(C[i * 3] - c[0], C[i * 3 + 1] - c[1], C[i * 3 + 2] - c[2]) <= lim) return true;
    return false;
  };
  type Station = { s: number; c: V3; t: V3; frame?: [V3, V3] };
  const first: Station = { s: 0, c: [C[0], C[1], C[2]], t: [T[0], T[1], T[2]] };
  const stations: Station[] = [first];
  for (const dir of closed ? [1] : [1, -1]) {
    let cur = first, sCur = 0, atEnd = false, endPushed = false;
    for (let k = 0; k < 100000; k++) {
      if (!closed && (dir > 0 ? sCur >= to : sCur <= from)) break;
      // a step short enough that the line turns little and the sections follow the faces
      let h = STATION_STEP * r;
      const turn = turnRate(A, B, s, r, cur.c, cur.t);
      // A ball rolling along a line that bends tighter than its own radius would cut through itself:
      // that is no round's centre-line (the faces it was read between are wrong there).
      if (turn * r > 1 && !(dir > 0 ? sCur >= sHi : sCur <= sLo)) return refuse('the centre-line bends tighter than the radius');
      if (turn > 0) h = Math.max(STATION_LEAST * r, Math.min(h, STATION_TURN / turn));
      // the last station on the faces stands at the round's own end, never past it
      const toEnd = dir > 0 ? sHi - sCur : sCur - sLo;
      if (!closed && !atEnd && toEnd < h) { h = Math.max(toEnd, 1e-9 * len); atEnd = true; }
      const p: V3 = [cur.c[0] + dir * h * cur.t[0], cur.c[1] + dir * h * cur.t[1], cur.c[2] + dir * h * cur.t[2]];
      const ok = ballAt(A, B, s, r, p, p, hit);
      let t = ok ? spineTangent(A, B, hit.c) : cur.t;
      if (t[0] * cur.t[0] + t[1] * cur.t[1] + t[2] * cur.t[2] < 0) t = [-t[0], -t[1], -t[2]];
      const c: V3 = [hit.c[0], hit.c[1], hit.c[2]];
      const ds = (c[0] - cur.c[0]) * (t[0] + cur.t[0]) / 2 + (c[1] - cur.c[1]) * (t[1] + cur.t[1]) / 2 + (c[2] - cur.c[2]) * (t[2] + cur.t[2]) / 2;
      // Past the round's own end the faces beside it may end too (a face's surface beyond its
      // edge is no surface of the design): the sheet is carried on straight from the last section.
      // ... or the walk has left the round: its centre is no longer beside any of the round's own
      const beyond = !closed && (endPushed || (ok && !besideRound(c, reach + h)));
      if (!ok || !(dir * ds > 0) || beyond) {
        if (closed) return refuse(ok ? 'the centre-line turned back' : 'a station off both offsets');
        // Past the end of a face beside it the offsets give out (or turn back): the sheet runs on
        // straight, with the last section's arc, a little past the end.
        const frame = cur.frame ?? frameAt(A, B, s, cur.c);
        const stop = sCur + dir * RUN_ON * r;
        for (let e = 0; e < 1000 && (dir > 0 ? sCur < stop : sCur > stop); e++) {
          const dh = Math.min(STATION_STEP * r, Math.abs(stop - sCur));
          sCur += dir * dh;
          cur = { s: sCur, c: [cur.c[0] + dir * dh * cur.t[0], cur.c[1] + dir * dh * cur.t[1], cur.c[2] + dir * dh * cur.t[2]], t: cur.t, frame };
          if (dir > 0) stations.push(cur); else stations.unshift(cur);
        }
        break;
      }
      if (closed && k > 2 && Math.hypot(c[0] - first.c[0], c[1] - first.c[1], c[2] - first.c[2]) <= h) {
        // round again: the last station is the first, a whole turn on
        const back = (first.c[0] - cur.c[0]) * cur.t[0] + (first.c[1] - cur.c[1]) * cur.t[1] + (first.c[2] - cur.c[2]) * cur.t[2];
        if (back > 0) { stations.push({ s: sCur + back, c: first.c, t: first.t }); break; }
      }
      sCur += ds;
      cur = { s: sCur, c, t };
      if (dir > 0) stations.push(cur); else stations.unshift(cur);
      if (atEnd) endPushed = true;
      if (closed && sCur > 4 * len + 100 * r) return refuse('the centre-line does not come back round');
    }
  }
  if (closed && stations.length >= 4) {
    // Round again with every step the same length, the shortest step the first walk needed (where
    // the line turns fastest): the periodic net is spaced evenly in u, so its stations must be
    // evenly spaced along the line, or the sections between them swing.
    let least = Infinity;
    for (let k = 1; k < stations.length; k++) least = Math.min(least, stations[k].s - stations[k - 1].s);
    const L = stations[stations.length - 1].s;
    const N = Math.max(stations.length - 1, Math.ceil(L / least));
    // A step along the tangent lands a little off the step asked for, so the walk round is tried
    // again with the step corrected until the step back to the start is as long as the others.
    let h = L / N, even: Station[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      even = [first];
      let cur = first;
      for (let k = 1; k < N; k++) {
        const p: V3 = [cur.c[0] + h * cur.t[0], cur.c[1] + h * cur.t[1], cur.c[2] + h * cur.t[2]];
        if (!ballAt(A, B, s, r, p, p, hit)) return refuse('a station off both offsets');
        const c: V3 = [hit.c[0], hit.c[1], hit.c[2]];
        let t = spineTangent(A, B, c);
        if (t[0] * cur.t[0] + t[1] * cur.t[1] + t[2] * cur.t[2] < 0) t = [-t[0], -t[1], -t[2]];
        cur = { s: k * h, c, t };
        even.push(cur);
      }
      let walked = 0;
      for (let k = 1; k < N; k++) walked += Math.hypot(even[k].c[0] - even[k - 1].c[0], even[k].c[1] - even[k - 1].c[1], even[k].c[2] - even[k - 1].c[2]);
      const back = Math.hypot(first.c[0] - cur.c[0], first.c[1] - cur.c[1], first.c[2] - cur.c[2]);
      const mean = (walked + back) / N;
      if (Math.abs(back - mean) <= 1e-4 * mean) break;
      h *= mean / (walked / (N - 1));
    }
    even.push({ s: N * h, c: first.c, t: first.t });
    stations.length = 0;
    stations.push(...even);
  }
  const K = stations.length;
  if (K < 4) return refuse('too short');
  const s0 = stations[0].s, s1 = stations[K - 1].s;
  const uOf = (x: number) => (x - s0) / (s1 - s0);
  // ---- the grid: at each station, the arc from just before the contact on A to just past B
  const grid: number[][][] = [];
  for (const st of stations) {
    const row: number[][] = [];
    const fr = st.frame ?? frameAt(A, B, s, st.c);
    const ea = fr[0], eb = fr[1];
    const th = Math.acos(Math.max(-1, Math.min(1, ea[0] * eb[0] + ea[1] * eb[1] + ea[2] * eb[2])));
    // the unit vector in the arc's plane square to ea, towards eb
    let wx = eb[0] - Math.cos(th) * ea[0], wy = eb[1] - Math.cos(th) * ea[1], wz = eb[2] - Math.cos(th) * ea[2];
    const wl = Math.hypot(wx, wy, wz) || 1;
    wx /= wl; wy /= wl; wz /= wl;
    for (let j = 0; j < ARC_POINTS; j++) {
      const f = -RUN_ON + ((1 + 2 * RUN_ON) * j) / (ARC_POINTS - 1);
      const ang = f * th, ca = Math.cos(ang), sa = Math.sin(ang);
      row.push([st.c[0] + r * (ca * ea[0] + sa * wx), st.c[1] + r * (ca * ea[1] + sa * wy), st.c[2] + r * (ca * ea[2] + sa * wz)]);
    }
    grid.push(row);
  }
  // A closed sheet is smooth through its seam: its stations are spaced evenly in u and the u
  // direction interpolated periodically (the design has no seam round a hole).
  const us = closed ? stations.map((_, k) => k / (K - 1)) : stations.map((st) => uOf(st.s));
  const vsP = Array.from({ length: ARC_POINTS }, (_, j) => j / (ARC_POINTS - 1));
  const surf = closed ? periodicGrid(grid.slice(0, K - 1), vsP) : interpolateGrid(grid, us, vsP);
  if (!surf) return refuse('no net through the arcs');
  // ---- each vertex's place: along the line from its centre (the nearest step of the stations'
  // line), round the arc from its own ball
  const params = new Map<number, [number, number]>();
  const where = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity, u = 0;
    for (let k = 0; k + 1 < K; k++) {
      const a = stations[k], b = stations[k + 1];
      const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1], dz = b.c[2] - a.c[2], dl = dx * dx + dy * dy + dz * dz;
      const w = dl > 0 ? Math.min(1, Math.max(0, ((C[i * 3] - a.c[0]) * dx + (C[i * 3 + 1] - a.c[1]) * dy + (C[i * 3 + 2] - a.c[2]) * dz) / dl)) : 0;
      const d = Math.hypot(a.c[0] + w * dx - C[i * 3], a.c[1] + w * dy - C[i * 3 + 1], a.c[2] + w * dz - C[i * 3 + 2]);
      if (d < best) { best = d; u = us[k] + w * (us[k + 1] - us[k]); }
    }
    where[i] = u;
    params.set(vs[i], [u, (frac[i] + RUN_ON) / (1 + 2 * RUN_ON)]);
  }
  // ---- does it hold over every facet? A closed sheet is looked at in two parts: the facets clear
  // of the seam at their places on it, the facets across the seam from their points alone.
  let off: number;
  if (!closed) off = standsOff(m, tris, surf, params);
  else {
    const across = (t: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 3; k++) { const u = where[index.get(m.tri[t * 3 + k])!]; lo = Math.min(lo, u); hi = Math.max(hi, u); }
      return hi - lo > 0.5;
    };
    const clear = tris.filter((t) => !across(t)), seam = tris.filter(across);
    // Across the seam a facet has no one place on the sheet: it is looked at on the same sheet
    // laid from half-way round, where it is clear of the seam.
    off = clear.length ? standsOff(m, clear, surf, params) : -Infinity;
    if (seam.length) {
      const half = (K - 1) >> 1, u0 = us[half];
      const other = periodicGrid(Array.from({ length: K - 1 }, (_, k) => grid[(k + half) % (K - 1)]), vsP);
      if (!other) return refuse('no net through the arcs');
      const params2 = new Map<number, [number, number]>();
      for (const [v, uv] of params) params2.set(v, [(uv[0] - u0 + 1) % 1, uv[1]]);
      off = Math.max(off, standsOff(m, seam, other, params2));
    }
  }
  return { surf: { kind: 'bspline', ...surf, places: params }, params, stations: K, closed, off };
}

/** The directions from the centre c to the contacts on A and on B (each face's normal, turned to the ball's side). */
function frameAt(A: Oriented, B: Oriented, s: number, c: V3): [V3, V3] {
  const na = faceNormal(A, c), nb = faceNormal(B, c);
  return [[s * na[0], s * na[1], s * na[2]], [s * nb[0], s * nb[1], s * nb[2]]];
}

/** The centre-line's unit tangent at c: square to both faces' normals there. */
function spineTangent(A: Oriented, B: Oriented, c: V3): V3 {
  const na = new Float64Array(3), nb = new Float64Array(3);
  normalInto(A, c, na); normalInto(B, c, nb);
  const t: V3 = [na[1] * nb[2] - na[2] * nb[1], na[2] * nb[0] - na[0] * nb[2], na[0] * nb[1] - na[1] * nb[0]];
  const l = Math.hypot(t[0], t[1], t[2]) || 1;
  return [t[0] / l, t[1] / l, t[2] / l];
}

/** How fast the centre-line's tangent turns at c (radians per mm), from a short step either way. */
function turnRate(A: Oriented, B: Oriented, s: number, r: number, c: V3, t: V3): number {
  const h = 0.05 * r, hit = newHit();
  const p: V3 = [c[0] + h * t[0], c[1] + h * t[1], c[2] + h * t[2]];
  if (!ballAt(A, B, s, r, p, p, hit)) return 0;
  const t2 = spineTangent(A, B, hit.c);
  const d = Math.abs(t2[0] * t[0] + t2[1] * t[1] + t2[2] * t[2]);
  return Math.acos(Math.min(1, d)) / h;
}

function normalInto(F: Oriented, c: V3, out: Float64Array): void {
  const g = faceNormal(F, c);
  out[0] = g[0]; out[1] = g[1]; out[2] = g[2];
}

/**
 * The cubic B-spline surface through a grid of points (rows along u, points along v), at the given
 * parameters, knots by averaging (The NURBS Book, 9.2.5): rows first, then columns of the result.
 */
/**
 * The same through rows that go all the way round (the last row is followed by the first): cubic
 * along v as above; along u the periodic uniform cubic through the rows, at u = k / N. Written as
 * the B-spline on a clamped knot vector that is the same surface: every span as its Bezier pieces,
 * each interior knot three times over (the pieces still join with their curvature, as the periodic
 * curve does).
 */
function periodicGrid(rowsIn: number[][][], vs: number[]): SplineSurface | null {
  const N = rowsIn.length, nv = vs.length;
  if (N < 3) return null;
  const degV = Math.min(3, nv - 1), knotsV = averagedKnots(vs, degV);
  const Mv = vs.map((t) => {
    const row = new Array<number>(nv).fill(0);
    const b = basisAt(nv, degV, knotsV, t);
    b.w.forEach((w, k) => (row[b.first + k] = w));
    return row;
  });
  const rows: number[][][] = [];
  for (const row of rowsIn) { const x = solveMany(Mv, row, 3); if (!x) return null; rows.push(x); }
  // (C[i-1] + 4 C[i] + C[i+1]) / 6 = Q[i], indices round N
  const A = Array.from({ length: N }, (_, i) => {
    const r = new Array<number>(N).fill(0);
    r[(i + N - 1) % N] += 1 / 6; r[i] += 4 / 6; r[(i + 1) % N] += 1 / 6;
    return r;
  });
  const ctrl: number[][][] = Array.from({ length: 3 * N + 1 }, () => new Array(nv));
  for (let j = 0; j < nv; j++) {
    const C = solveMany(A, rows.map((r) => r[j]), 3);
    if (!C) return null;
    for (let i = 0; i < N; i++) {
      const c0 = C[i], c1 = C[(i + 1) % N];
      const q = rows[i][j];
      ctrl[3 * i][j] = q;
      ctrl[3 * i + 1][j] = [0, 1, 2].map((d) => (4 * c0[d] + 2 * c1[d]) / 6);
      ctrl[3 * i + 2][j] = [0, 1, 2].map((d) => (2 * c0[d] + 4 * c1[d]) / 6);
    }
    ctrl[3 * N][j] = rows[0][j];
  }
  const knotsU = [0, 0, 0, 0];
  for (let i = 1; i < N; i++) knotsU.push(i / N, i / N, i / N);
  knotsU.push(1, 1, 1, 1);
  return { degU: 3, degV, knotsU, knotsV, ctrl };
}

function interpolateGrid(grid: number[][][], us: number[], vs: number[]): SplineSurface | null {
  const nu = us.length, nv = vs.length;
  const degU = Math.min(3, nu - 1), degV = Math.min(3, nv - 1);
  const knotsU = averagedKnots(us, degU), knotsV = averagedKnots(vs, degV);
  const matrix = (ts: number[], p: number, U: number[]) => ts.map((t) => {
    const row = new Array<number>(ts.length).fill(0);
    const b = basisAt(ts.length, p, U, t);
    b.w.forEach((w, k) => (row[b.first + k] = w));
    return row;
  });
  const Mv = matrix(vs, degV, knotsV), Mu = matrix(us, degU, knotsU);
  const rows: number[][][] = [];
  for (const row of grid) { const x = solveMany(Mv, row, 3); if (!x) return null; rows.push(x); }
  const ctrl: number[][][] = Array.from({ length: nu }, () => new Array(nv));
  for (let j = 0; j < nv; j++) {
    const col = solveMany(Mu, rows.map((r) => r[j]), 3);
    if (!col) return null;
    for (let i = 0; i < nu; i++) ctrl[i][j] = col[i];
  }
  return { degU, degV, knotsU, knotsV, ctrl };
}

function averagedKnots(ts: number[], p: number): number[] {
  const n = ts.length;
  const U = new Array<number>(p + 1).fill(0);
  for (let j = 1; j < n - p; j++) { let s = 0; for (let i = j; i < j + p; i++) s += ts[i]; U.push(s / p); }
  for (let i = 0; i <= p; i++) U.push(1);
  return U;
}
