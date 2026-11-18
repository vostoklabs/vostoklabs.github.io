// A round is one face from where it starts to where it ends. Along straights it lies on a
// cylinder, round a corner on a torus, at a ball corner on a sphere: one radius, and one
// centre-line (the path of the ball's centre) running on without a break. Neighbouring pieces
// whose radius agrees and whose centre-lines join are one chain, and the chain becomes one sheet:
// the circle of that radius swept along the joined centre-line, written as a B-spline that holds
// every piece's own surface to a hundred-thousandth of a millimetre.

import { type V3, add, cross, dist, dot, madd, norm, normalize, scale, sub } from './linalg';
import { type Mesh, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions } from './segment';
import { type Cylinder, type Sphere, type Torus } from './surfaces';
import { type BSplineFace } from './freeform';
import { basisAt } from './bspline';

type Round = Cylinder | Torus | Sphere;
const isRound = (s: Region['surf']): s is Round => !!s && (s.kind === 'cylinder' || s.kind === 'torus' || s.kind === 'sphere');
/** The largest radius read as a round rather than a wall (mm). */
const ROUND_MOST = 10;
/** How far apart two centre-lines may be where they join (mm), and the angle between them. */
const JOIN_GAP = 2e-3, JOIN_ANGLE = (1 * Math.PI) / 180;
/**
 * The turn one cubic span may make along a circle of radius rho and stay within a millionth of a
 * millimetre of it: a cubic spline's error on an arc is about rho a^4 / 384.
 */
const spanAngle = (rho: number) => Math.min(Math.PI / 6, Math.pow((384 * 1e-6) / Math.max(rho, 1e-3), 0.25));
/** How far the sheet may stand off the pieces' own surfaces (mm). */
const SHEET_EXACT = 8e-5;

/** Nearest point of a round's centre-line to q, and the line's direction there (none for a sphere). */
function centreLine(s: Round, q: V3): { p: V3; t: V3 | null } {
  if (s.kind === 'cylinder') { const h = dot(sub(q, s.o), s.a); return { p: madd(s.o, s.a, h), t: s.a }; }
  if (s.kind === 'sphere') return { p: s.c, t: null };
  const d = sub(q, s.c), h = dot(d, s.a);
  const u = normalize(madd(d, s.a, -h));
  return { p: madd(s.c, u, s.R), t: cross(s.a, u) };
}

const angleOf = (a: V3, b: V3) => Math.acos(Math.min(1, Math.abs(dot(a, b)) / (norm(a) * norm(b) || 1)));

/** One stretch of the joined centre-line: straight, an arc, or a turn on the spot (ball corner). */
export type Seg =
  | { kind: 'line'; a: V3; b: V3; len: number }
  | { kind: 'arc'; c: V3; ax: V3; R: number; u0: V3; turn: number; len: number }
  | { kind: 'turn'; c: V3; t0: V3; turn: number; len: number };

/** Centre-line point and direction at length s into a stretch; B is the chain's up direction. */
function along(g: Seg, s: number, B: V3): { c: V3; t: V3 } {
  if (g.kind === 'line') { const t = normalize(sub(g.b, g.a)); return { c: madd(g.a, t, s), t }; }
  if (g.kind === 'arc') {
    const phi = (g.turn * s) / g.len;
    const v = cross(g.ax, g.u0);
    const u = add(scale(g.u0, Math.cos(phi)), scale(v, Math.sin(phi)));
    const t = scale(cross(g.ax, u), Math.sign(g.turn) || 1);
    return { c: madd(g.c, u, g.R), t };
  }
  const phi = g.len > 0 ? (g.turn * s) / g.len : 0;
  const n0 = cross(B, g.t0);
  return { c: g.c, t: add(scale(g.t0, Math.cos(phi)), scale(n0, Math.sin(phi))) };
}

/** A round's sheet as what it is: a circle of radius r swept along stretches of centre-line. */
export type Pipe = { segs: Seg[]; B: V3; r: number; sign: number; open: boolean };

/**
 * The nearest point of the centre-line to p, and p's signed distance from the round (positive on
 * the sheet's own normal side) with the normal there. Exact, and no search: the stretches are
 * lines, arcs and ball corners.
 */
export function pipeNearest(pp: Pipe, p: V3): { d: number; n: V3 } {
  let best: V3 = pp.segs[0].kind === 'line' ? pp.segs[0].a : pp.segs[0].c, bd = Infinity;
  const last = pp.segs.length - 1;
  pp.segs.forEach((g, k) => {
    // Only an open end runs on past its piece (for trimming); a join never does, or a point on a
    // tight arc would read as on the straight carried on beyond it.
    const before = pp.open && k === 0 ? pp.r : 0, after = pp.open && k === last ? pp.r : 0;
    let c: V3;
    if (g.kind === 'line') {
      const dir = normalize(sub(g.b, g.a));
      c = madd(g.a, dir, Math.min(g.len + after, Math.max(-before, dot(sub(p, g.a), dir))));
    } else if (g.kind === 'arc') {
      const d = sub(p, g.c), u = normalize(madd(d, g.ax, -dot(d, g.ax)));
      const half = g.turn / 2, um = add(scale(g.u0, Math.cos(half)), scale(cross(g.ax, g.u0), Math.sin(half)));
      const sg = Math.sign(g.turn) || 1;
      const lo = -Math.abs(half) - (sg > 0 ? before : after) / g.R, hi = Math.abs(half) + (sg > 0 ? after : before) / g.R;
      const phi = half + Math.min(hi, Math.max(lo, signedAngle(um, u, g.ax)));
      c = madd(g.c, add(scale(g.u0, Math.cos(phi)), scale(cross(g.ax, g.u0), Math.sin(phi))), g.R);
    } else c = g.c;
    const e = dist(p, c);
    if (e < bd) { bd = e; best = c; }
  });
  const n = normalize(sub(p, best));
  return { d: pp.sign * (bd - pp.r), n: scale(n, pp.sign) };
}

/** The signed angle about B from a to b (both square to B). */
const signedAngle = (a: V3, b: V3, B: V3) => Math.atan2(dot(cross(a, b), B), dot(a, b));

/** `ends`: for half of a loop, the joins it starts and ends at. */
type Chain = { members: number[]; closed: boolean; ends?: [V3, V3] };

/** Rounds whose radius agrees and whose centre-lines join, as paths or loops of faces. */
function findChains(m: Mesh, faces: Region[], label: Int32Array): { chains: Chain[]; joinAt: Map<string, V3> } {
  const nT = m.tri.length / 3;
  const sum = new Map<string, { p: V3; n: number }>();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < t) continue;
    const i = label[t], j = label[w];
    if (i === j || i < 0 || j < 0 || !isRound(faces[i].surf) || !isRound(faces[j].surf)) continue;
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    const a = vtx(m.pos, m.tri[t * 3 + k]), b = vtx(m.pos, m.tri[t * 3 + ((k + 1) % 3)]);
    const e = sum.get(key) ?? { p: [0, 0, 0] as V3, n: 0 };
    e.p = add(e.p, add(a, b)); e.n += 2;
    sum.set(key, e);
  }
  const joinAt = new Map<string, V3>();
  const links = new Map<number, number[]>();
  for (const [key, e] of sum) {
    const [i, j] = key.split(',').map(Number);
    const a = faces[i].surf as Round, b = faces[j].surf as Round;
    if (a.r > ROUND_MOST || Math.abs(a.r - b.r) > Math.max(1e-3, 1e-3 * a.r)) continue;
    if (a.kind === 'sphere' && b.kind === 'sphere') continue;
    const q = scale(e.p, 1 / e.n);
    const ca = centreLine(a, q), cb = centreLine(b, q);
    if (dist(ca.p, cb.p) > JOIN_GAP) continue;
    if (ca.t && cb.t && angleOf(ca.t, cb.t) > JOIN_ANGLE) continue;
    joinAt.set(key, scale(add(ca.p, cb.p), 0.5));
    links.set(i, [...(links.get(i) ?? []), j]);
    links.set(j, [...(links.get(j) ?? []), i]);
  }
  const seen = new Set<number>(), chains: Chain[] = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const comp = [start];
    seen.add(start);
    for (let x = 0; x < comp.length; x++) for (const y of links.get(comp[x]) ?? []) if (!seen.has(y)) { seen.add(y); comp.push(y); }
    if (comp.some((i) => (links.get(i) ?? []).length > 2)) continue; // a branch: a T where rounds meet
    const ends = comp.filter((i) => (links.get(i) ?? []).length === 1);
    const closed = ends.length === 0;
    const order = [closed ? comp[0] : ends[0]];
    const used = new Set(order);
    for (;;) {
      const nx = (links.get(order[order.length - 1]) ?? []).find((y) => !used.has(y));
      if (nx === undefined) break;
      used.add(nx); order.push(nx);
    }
    if (order.length === comp.length) chains.push({ members: order, closed });
  }
  return { chains, joinAt };
}

const key2 = (i: number, j: number) => (i < j ? `${i},${j}` : `${j},${i}`);

/** Solve the normal equations of a least-squares fit (A symmetric positive definite, n x n) for several right-hand sides. */
function cholSolve(A: Float64Array, n: number, B: number[][]): number[][] | null {
  const L = Float64Array.from(A);
  for (let j = 0; j < n; j++) {
    let s = L[j * n + j];
    for (let k = 0; k < j; k++) s -= L[j * n + k] ** 2;
    if (!(s > 1e-300)) return null;
    const d = Math.sqrt(s);
    L[j * n + j] = d;
    for (let i = j + 1; i < n; i++) { let v = L[i * n + j]; for (let k = 0; k < j; k++) v -= L[i * n + k] * L[j * n + k]; L[i * n + j] = v / d; }
  }
  return B.map((b) => {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let v = b[i]; for (let k = 0; k < i; k++) v -= L[i * n + k] * y[k]; y[i] = v / L[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let v = y[i]; for (let k = i + 1; k < n; k++) v -= L[k * n + i] * y[k]; y[i] = v / L[i * n + i]; }
    return Array.from(y);
  });
}

/** Least-squares control points of one direction: rows of samples at params ts, basis on knots U. */
function fitRows(U: number[], p: number, nCtrl: number, ts: number[], rows: number[][]): number[][] | null {
  const A = new Float64Array(nCtrl * nCtrl);
  const N = ts.map((t) => basisAt(nCtrl, p, U, t));
  for (const { first, w } of N) for (let a = 0; a <= p; a++) for (let b = 0; b <= p; b++) A[(first + a) * nCtrl + first + b] += w[a] * w[b];
  const rhs = rows.map((vals) => { const r = new Array<number>(nCtrl).fill(0); N.forEach(({ first, w }, i) => { for (let a = 0; a <= p; a++) r[first + a] += w[a] * vals[i]; }); return r; });
  return cholSolve(A, nCtrl, rhs);
}

/**
 * A B-spline surface through samples of S(s, θ) on a grid: knots `U` (in s, normalised), `V` (in
 * θ), degree 3. Fitted row by row then column by column, which on a full grid is the least squares.
 */
function gridSheet(U: number[], V: number[], S: (u: number, v: number) => V3): BSplineFace | null {
  const p = 3, nu = U.length - p - 1, nv = V.length - p - 1;
  const params = (K: number[], per: number) => {
    const out: number[] = [];
    const brk = [...new Set(K)];
    for (let i = 0; i + 1 < brk.length; i++) for (let k = 0; k < per; k++) out.push(brk[i] + ((brk[i + 1] - brk[i]) * k) / per);
    out.push(brk[brk.length - 1]);
    return out;
  };
  const us = params(U, 6), vs = params(V, 6);
  const pts = us.map((u) => vs.map((v) => S(u, v)));
  // Along v for every sample row: nv control points per row, per coordinate.
  const rowsCtrl: number[][][] = [];
  for (const row of pts) {
    const c = fitRows(V, p, nv, vs, [0, 1, 2].map((d) => row.map((q) => q[d])));
    if (!c) return null;
    rowsCtrl.push(c); // [dim][nv]
  }
  const ctrl: number[][][] = Array.from({ length: nu }, () => Array.from({ length: nv }, () => [0, 0, 0]));
  for (let j = 0; j < nv; j++) {
    const c = fitRows(U, p, nu, us, [0, 1, 2].map((d) => rowsCtrl.map((rc) => rc[d][j])));
    if (!c) return null;
    for (let i = 0; i < nu; i++) ctrl[i][j] = [c[0][i], c[1][i], c[2][i]];
  }
  return { kind: 'bspline', degU: p, degV: p, knotsU: U, knotsV: V, ctrl };
}

/** A point of a B-spline surface. */
function sheetAt(s: BSplineFace, u: number, v: number): V3 {
  const nu = s.ctrl.length, nv = s.ctrl[0].length;
  const bu = basisAt(nu, s.degU, s.knotsU, u), bv = basisAt(nv, s.degV, s.knotsV, v);
  const out: V3 = [0, 0, 0];
  for (let a = 0; a <= s.degU; a++) for (let b = 0; b <= s.degV; b++) {
    const w = bu.w[a] * bv.w[b], c = s.ctrl[bu.first + a][bv.first + b];
    out[0] += w * c[0]; out[1] += w * c[1]; out[2] += w * c[2];
  }
  return out;
}

/** The chain as one sheet, or null if it cannot be one exactly. */
export let whyNot = '';
function chainSheet(m: Mesh, faces: Region[], ch: Chain, joinAt: Map<string, V3>, eps: number): { surf: BSplineFace; err: number } | null {
  const mem = ch.members, n = mem.length;
  const surf = (i: number) => faces[mem[i]].surf as Round;
  const r = surf(0).r;
  // The chain's up direction: its tori's axis, or square to its straight pieces.
  let B: V3 | null = null;
  for (let i = 0; i < n; i++) { const s = surf(i); if (s.kind === 'torus') { B = s.a; break; } }
  if (!B) {
    const axes = mem.map((_, i) => surf(i)).filter((s): s is Cylinder => s.kind === 'cylinder').map((s) => s.a);
    for (let i = 1; i < axes.length && !B; i++) { const c = cross(axes[0], axes[i]); if (norm(c) > 1e-3) B = normalize(c); }
  }
  if (!B) { whyNot = 'r1'; return null; }
  for (let i = 0; i < n; i++) {
    const s = surf(i);
    if (s.kind === 'torus' && norm(cross(s.a, B)) > 2e-3) { whyNot = 'r2'; return null; }
    if (s.kind === 'cylinder' && Math.abs(dot(s.a, B)) > 2e-3) { whyNot = 'r3'; return null; }
  }
  const vertsOf = (i: number) => { const set = new Set<number>(); for (const t of faces[mem[i]].tris) for (const v of triVerts(m, t)) set.add(v); return [...set]; };
  // Where each piece's stretch of centre-line starts and ends: at the joins, or at its own end.
  const joins: (V3 | null)[] = [];
  for (let i = 0; i + 1 < n; i++) joins.push(joinAt.get(key2(mem[i], mem[i + 1]))!);
  if (ch.closed) joins.push(joinAt.get(key2(mem[n - 1], mem[0]))!); else joins.push(null);
  if (ch.ends) joins[n - 1] = ch.ends[1];
  const startOf = (i: number) => (i > 0 ? joins[i - 1] : ch.closed ? joins[n - 1] : ch.ends ? ch.ends[0] : null);
  const endOf = (i: number) => joins[i];
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const s = surf(i);
    let a = startOf(i), b = endOf(i);
    if (s.kind === 'sphere') {
      if (!a || !b) { whyNot = 'r4'; return null; } // a ball at the end of a chain: leave the chain as it is
      const pi = (i + n - 1) % n, ni = (i + 1) % n;
      const t0 = centreLine(surf(pi), a).t, t1 = centreLine(surf(ni), b).t;
      if (!t0 || !t1) { whyNot = 'r5'; return null; }
      // Into the ball from the previous piece, out of it into the next.
      const mean = (k: number) => { const vs = vertsOf(k).map((v) => vtx(m.pos, v)); return centreLine(surf(k), scale(vs.reduce((x, y) => add(x, y), [0, 0, 0] as V3), 1 / vs.length)).p; };
      const tIn = dot(t0, sub(a, mean(pi))) >= 0 ? t0 : scale(t0, -1);
      const tOut = dot(t1, sub(mean(ni), b)) >= 0 ? t1 : scale(t1, -1);
      const turn = signedAngle(tIn, tOut, B);
      segs.push({ kind: 'turn', c: s.c, t0: tIn, turn, len: r * Math.abs(turn) });
      continue;
    }
    // A piece at an open end runs to its furthest vertex.
    const vs = vertsOf(i).map((v) => vtx(m.pos, v));
    if (!a || !b) {
      const known = (a ?? b)!;
      const dir = centreLine(s, known).t!;
      let far = known, best = -Infinity;
      for (const p of vs) {
        const c = centreLine(s, p).p;
        // Along the line (or round the arc) away from the known end.
        const d = s.kind === 'cylinder' ? Math.abs(dot(sub(c, known), dir)) : dist(c, known);
        if (d > best) { best = d; far = c; }
      }
      if (!a) a = far; else b = far;
    }
    if (s.kind === 'cylinder') segs.push({ kind: 'line', a: a!, b: b!, len: dist(a!, b!) });
    else {
      const t = s as Torus;
      const flat = (q: V3) => { const d = sub(q, t.c); return normalize(madd(d, t.a, -dot(d, t.a))); };
      const u0 = flat(a!), u1 = flat(b!);
      let turn = signedAngle(madd(u0, t.a, -dot(u0, t.a)), madd(u1, t.a, -dot(u1, t.a)), t.a);
      // The arc that holds the piece's vertices: check one vertex's angle lies between.
      const mid = vs[Math.floor(vs.length / 2)];
      const um = normalize(madd(sub(mid, t.c), t.a, -dot(sub(mid, t.c), t.a)));
      const at = signedAngle(u0, um, t.a);
      const within = turn >= 0 ? at >= -1e-6 && at <= turn + 1e-6 : at <= 1e-6 && at >= turn - 1e-6;
      if (!within) turn = turn >= 0 ? turn - 2 * Math.PI : turn + 2 * Math.PI;
      if (Math.abs(turn) < 1e-9 && ch.closed && n === 1) turn = 2 * Math.PI;
      segs.push({ kind: 'arc', c: t.c, ax: t.a, R: t.R, u0, turn, len: Math.abs(turn) * t.R });
    }
  }
  // Directions must run on: each stretch's end direction is the next one's start direction.
  for (let i = 0; i + 1 < segs.length; i++) {
    const t0 = along(segs[i], segs[i].len, B).t, t1 = along(segs[i + 1], 0, B).t;
    if (dot(t0, t1) < Math.cos(2 * JOIN_ANGLE)) { whyNot = 'r6'; return null; }
  }
  const total = segs.reduce((a, g) => a + g.len, 0);
  if (!(total > 0)) { whyNot = 'r7'; return null; }
  const starts: number[] = [];
  segs.reduce((a, g) => (starts.push(a), a + g.len), 0);
  const frameAt = (s: number) => {
    let k = 0;
    while (k + 1 < segs.length && s > starts[k + 1]) k++;
    const f = along(segs[k], Math.min(segs[k].len, Math.max(0, s - starts[k])), B);
    return { c: f.c, n: normalize(cross(B, f.t)) };
  };
  // Every vertex's place: nearest stretch of centre-line, then the angle round it.
  const place = new Map<number, [number, number]>();
  let cx = 0, cy = 0;
  const raw: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const g = segs[i];
    for (const v of vertsOf(i)) {
      const p = vtx(m.pos, v);
      let s: number;
      if (g.kind === 'line') s = Math.min(g.len, Math.max(0, dot(sub(p, g.a), normalize(sub(g.b, g.a)))));
      else if (g.kind === 'arc') {
        const u = normalize(madd(sub(p, g.c), g.ax, -dot(sub(p, g.c), g.ax)));
        // Measured from the middle of the arc, so an arc of half a turn or more reads both ends.
        const half = g.turn / 2, um = add(scale(g.u0, Math.cos(half)), scale(cross(g.ax, g.u0), Math.sin(half)));
        const phi = half + signedAngle(um, u, g.ax);
        s = Math.min(g.len, Math.max(0, (phi / g.turn) * g.len));
      } else {
        const w = sub(p, g.c), n0 = cross(B, g.t0);
        let a = Math.atan2(-dot(w, g.t0), dot(w, n0));
        // Normal plane of the turn: w is square to the direction at angle a (or a + pi).
        const pick = [a, a + Math.PI, a - Math.PI].find((x) => g.turn !== 0 && x / g.turn >= -1e-6 && x / g.turn <= 1 + 1e-6);
        a = pick ?? 0;
        s = g.turn !== 0 ? (a / g.turn) * g.len : 0;
      }
      const sg = starts[i] + s;
      const f = frameAt(sg);
      const w = sub(p, f.c);
      const th = Math.atan2(dot(w, B), dot(w, f.n));
      cx += Math.cos(th); cy += Math.sin(th);
      raw.push([v, sg, th]);
    }
  }
  const th0 = Math.atan2(cy, cx);
  let tlo = Infinity, thi = -Infinity;
  for (const x of raw) { let d = x[2] - th0; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); x[2] = th0 + d; tlo = Math.min(tlo, x[2]); thi = Math.max(thi, x[2]); }
  const margin = (3 * Math.PI) / 180;
  tlo -= margin; thi += margin;
  if (thi - tlo > 1.9 * Math.PI) { whyNot = 'r8'; return null; }
  const S = (u: number, v: number): V3 => { const f = frameAt(u * total); const th = tlo + v * (thi - tlo); return add(f.c, add(scale(f.n, r * Math.cos(th)), scale(B!, r * Math.sin(th)))); };
  // Knots: triple at every join (each stretch fitted on its own spans), spans every 20 degrees of
  // turn along an arc or ball corner, one along a straight; across, every 15 degrees.
  const U: number[] = [0, 0, 0, 0];
  segs.forEach((g, k) => {
    const rho = g.kind === 'arc' ? g.R + r : r;
    const spans = g.kind === 'line' ? 1 : Math.max(1, Math.ceil(Math.abs(g.turn) / spanAngle(rho)));
    for (let j = 1; j <= spans; j++) {
      const at = (starts[k] + (g.len * j) / spans) / total;
      if (j < spans) U.push(at); else if (k + 1 < segs.length) U.push(at, at, at); else U.push(1, 1, 1, 1);
    }
  });
  const nV = Math.max(1, Math.ceil((thi - tlo) / spanAngle(r)));
  const V: number[] = [0, 0, 0, 0];
  for (let j = 1; j < nV; j++) V.push(j / nV);
  V.push(1, 1, 1, 1);
  const sheet = gridSheet(U, V, S);
  if (!sheet) { whyNot = 'r9'; return null; }
  // How exact: the sheet against the sweep between the samples, and every vertex against the sheet.
  let off = 0, offU = 0;
  for (let i = 0; i <= 97; i++) for (let j = 0; j <= 13; j++) { const u = (i + 0.37) / 98.37, v = (j + 0.41) / 13.41; const d = dist(sheetAt(sheet, u, v), S(u, v)); if (d > off) { off = d; offU = u; } }
  let jump = 0;
  for (let i = 0; i + 1 < segs.length; i++) jump = Math.max(jump, dist(along(segs[i], segs[i].len, B).c, along(segs[i + 1], 0, B).c));
  const segAt = starts.findIndex((x, k) => offU * total >= x && offU * total <= x + segs[k].len);
  if (off > SHEET_EXACT) { whyNot = `off ${off.toExponential(1)} at seg ${segAt} ${segs[segAt]?.kind} of ${segs.map((g) => g.kind[0] + g.len.toFixed(2)).join(',')} jump ${jump.toExponential(1)}`; return null; } if (false) { whyNot = 'r10'; return null; }
  let err = 0;
  for (const [v, sg, th] of raw) {
    const uv: [number, number] = [sg / total, (th - tlo) / (thi - tlo)];
    place.set(v, uv);
    err = Math.max(err, dist(sheetAt(sheet, uv[0], uv[1]), vtx(m.pos, v)));
  }
  if (err > Math.max(eps, ...mem.map((i) => faces[i].err)) * 1.5) { whyNot = `err ${err.toExponential(1)}`; return null; } if (false) { whyNot = 'r11'; return null; }
  sheet.places = place;
  // Which way the sheet's own normal faces: out of the tube or into it.
  const [v0, s0, t0] = raw[0];
  const uv0: [number, number] = [s0 / total, (t0 - tlo) / (thi - tlo)];
  const h = 1e-5, P0 = sheetAt(sheet, uv0[0], uv0[1]);
  const su = sub(sheetAt(sheet, Math.min(1, uv0[0] + h), uv0[1]), sheetAt(sheet, Math.max(0, uv0[0] - h), uv0[1]));
  const sv = sub(sheetAt(sheet, uv0[0], Math.min(1, uv0[1] + h)), sheetAt(sheet, uv0[0], Math.max(0, uv0[1] - h)));
  void v0;
  const out = sub(P0, frameAt(s0).c);
  sheet.pipe = { segs, B, r, sign: dot(cross(su, sv), out) >= 0 ? 1 : -1, open: !ch.closed };
  return { surf: sheet, err };
}

/** Every chain of rounds that can be one sheet, made one face. */
export function chainRounds(m: Mesh, faces: Region[], opt: SegmentOptions): Region[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const { chains, joinAt } = findChains(m, faces, label);
  const gone = new Set<number>(), out: Region[] = [];
  // A loop is two faces, halves cut at joins between two pieces that are not balls: a sheet
  // closed on itself needs a seam edge, which the solid's edges are not made with.
  const parts: Chain[] = [];
  for (const ch of chains) {
    if (!ch.closed) { parts.push(ch); continue; }
    const n = ch.members.length;
    const ball = (k: number) => faces[ch.members[(k + n) % n]].surf!.kind === 'sphere';
    const cuts = [...Array(n).keys()].filter((k) => !ball(k) && !ball(k - 1));
    if (n < 4 || cuts.length < 2) continue;
    // Two cuts about half way round the loop by triangle count.
    const size = ch.members.map((i) => faces[i].tris.length), total = size.reduce((a, b) => a + b, 0);
    const k0 = cuts[0];
    let acc = 0, k1 = cuts[1];
    for (let j = 1; j < n; j++) { acc += size[(k0 + j - 1) % n]; const k = (k0 + j) % n; if (cuts.includes(k) && k !== k0) { k1 = k; if (acc >= total / 2) break; } }
    const rot = [...ch.members.slice(k0), ...ch.members.slice(0, k0)];
    const split = (k1 - k0 + n) % n;
    const at = (a: number, b: number) => joinAt.get(key2(a, b))!;
    const A = rot.slice(0, split), B = rot.slice(split);
    parts.push({ members: A, closed: false, ends: [at(B[B.length - 1], A[0]), at(A[A.length - 1], B[0])] });
    parts.push({ members: B, closed: false, ends: [at(A[A.length - 1], B[0]), at(B[B.length - 1], A[0])] });
  }
  for (const ch of parts) {
    if (ch.members.length < 2) continue;
    const made = chainSheet(m, faces, ch, joinAt, opt.eps);
    if (!made) continue;
    for (const i of ch.members) gone.add(i);
    out.push({ tris: ch.members.flatMap((i) => faces[i].tris), surf: made.surf, err: made.err });
  }
  return [...faces.filter((_, i) => !gone.has(i)), ...out];
}

/** For the tools: chains found and how many became sheets. */
export function chainCensus(m: Mesh, faces: Region[], opt: SegmentOptions) {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const { chains, joinAt } = findChains(m, faces, label);
  return chains.map((ch) => ({ n: ch.members.length, closed: ch.closed, kinds: ch.members.map((i) => faces[i].surf!.kind[0]).join(''), ok: !!chainSheet(m, faces, ch, joinAt, opt.eps), why: whyNot }));
}
