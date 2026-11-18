// B-spline curves in any dimension: evaluation with derivatives, interpolation through points,
// and the closest point to a given one. Algorithms from The NURBS Book (Piegl & Tiller).

/** Degree, the full (clamped) knot vector, and the control points (each of the curve's dimension). */
export type Spline = { degree: number; knots: number[]; ctrl: number[][] };

/** The knot span holding u (A2.1); u at the end of the range lands in the last span. */
export function findSpan(n: number, p: number, u: number, U: number[]): number {
  if (u >= U[n + 1]) return n;
  if (u <= U[p]) return p;
  let lo = p, hi = n + 1;
  let mid = (lo + hi) >> 1;
  while (u < U[mid] || u >= U[mid + 1]) {
    if (u < U[mid]) hi = mid;
    else lo = mid;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

// Scratch tables: a fit asks for basis functions millions of times, and nothing here outlives a call.
let tableSize = 0;
let nduT = new Float64Array(0), leftT = nduT, rightT = nduT, aT0 = nduT, aT1 = nduT;
function ensureTables(p: number) {
  if (p + 1 <= tableSize) return;
  tableSize = p + 1;
  nduT = new Float64Array(tableSize * tableSize);
  leftT = new Float64Array(tableSize);
  rightT = new Float64Array(tableSize);
  aT0 = new Float64Array(tableSize);
  aT1 = new Float64Array(tableSize);
}

/** The p+1 non-zero basis functions at u, and nothing else (A2.2): the first row of basisDers. */
function basisFuns(span: number, u: number, p: number, U: number[]): number[] {
  const N = new Array<number>(p + 1);
  basisFunsInto(span, u, p, U, N);
  return N;
}

/** The same into a given array. The same steps in the same order as the first row of `basisDersInto`, so the same numbers to the last bit. */
function basisFunsInto(span: number, u: number, p: number, U: number[], N: Float64Array | number[]): void {
  ensureTables(p);
  const left = leftT, right = rightT;
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j];
    right[j] = U[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const temp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
}

/** The p+1 non-zero basis functions at u, and their derivatives up to `nd` (A2.3). */
export function basisDers(span: number, u: number, p: number, nd: number, U: number[]): number[][] {
  if (nd === 0) return [basisFuns(span, u, p, U)];
  const W = p + 1;
  const flat = new Float64Array((nd + 1) * W);
  basisDersInto(span, u, p, nd, U, flat);
  const ders: number[][] = [];
  for (let k = 0; k <= nd; k++) ders.push(Array.from(flat.subarray(k * W, (k + 1) * W)));
  return ders;
}

/** The same into a given array, derivative k of function r at `out[k * (p + 1) + r]`: a closest-point search asks millions of times. */
function basisDersInto(span: number, u: number, p: number, nd: number, U: number[], out: Float64Array): void {
  ensureTables(p);
  const W = p + 1;
  const ndu = nduT, left = leftT, right = rightT;
  ndu[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j];
    right[j] = U[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      ndu[j * W + r] = right[r + 1] + left[j - r];
      const temp = ndu[r * W + j - 1] / ndu[j * W + r];
      ndu[r * W + j] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    ndu[j * W + j] = saved;
  }
  for (let j = 0; j <= p; j++) out[j] = ndu[j * W + p];
  if (p === 3 && nd === 2) {
    // The cubic sheets' case, which is nearly every call: the loops below written out for it,
    // the same divisions and sums in the same order (N(i, j) is ndu[i * 4 + j]).
    let a = -1 / ndu[12];
    out[4] = (0 + a * ndu[2]) * 3;
    out[8] = (0 + (-a / ndu[8]) * ndu[1]) * 6;
    let b = 1 / ndu[12];
    a = -1 / ndu[13];
    out[5] = (b * ndu[2] + a * ndu[6]) * 3;
    out[9] = (0 + ((a - b) / ndu[8]) * ndu[1] + (-a / ndu[9]) * ndu[5]) * 6;
    b = 1 / ndu[13];
    a = -1 / ndu[14];
    out[6] = (b * ndu[6] + a * ndu[10]) * 3;
    out[10] = ((b / ndu[8]) * ndu[1] + ((a - b) / ndu[9]) * ndu[5]) * 6;
    b = 1 / ndu[14];
    out[7] = (b * ndu[10]) * 3;
    out[11] = ((b / ndu[9]) * ndu[5]) * 6;
    return;
  }
  let s1 = aT0, s2 = aT1;
  for (let i = 0; i < W; i++) { s1[i] = 0; s2[i] = 0; }
  const first = s1;
  for (let r = 0; r <= p; r++) {
    s1 = first;
    s2 = first === aT0 ? aT1 : aT0;
    s1[0] = 1;
    for (let k = 1; k <= nd; k++) {
      let d = 0;
      const rk = r - k, pk = p - k;
      if (r >= k) {
        s2[0] = s1[0] / ndu[(pk + 1) * W + rk];
        d = s2[0] * ndu[rk * W + pk];
      }
      const j1 = rk >= -1 ? 1 : -rk;
      const j2 = r - 1 <= pk ? k - 1 : p - r;
      for (let j = j1; j <= j2; j++) {
        s2[j] = (s1[j] - s1[j - 1]) / ndu[(pk + 1) * W + rk + j];
        d += s2[j] * ndu[(rk + j) * W + pk];
      }
      if (r <= pk) {
        s2[k] = -s1[k - 1] / ndu[(pk + 1) * W + r];
        d += s2[k] * ndu[r * W + pk];
      }
      out[k * W + r] = d;
      const swap = s1; s1 = s2; s2 = swap;
    }
  }
  let f = p;
  for (let k = 1; k <= nd; k++) {
    for (let j = 0; j <= p; j++) out[k * W + j] *= f;
    f *= p - k;
  }
}

/** The point and its first `nd` derivatives at u. */
export function curveDers(c: Spline, u: number, nd = 0): number[][] {
  const n = c.ctrl.length - 1, p = c.degree;
  const span = findSpan(n, p, u, c.knots);
  const N = basisDers(span, u, p, Math.min(nd, p), c.knots);
  const dim = c.ctrl[0].length;
  const out: number[][] = [];
  for (let k = 0; k <= nd; k++) {
    const pt = new Array<number>(dim).fill(0);
    if (k <= p) for (let j = 0; j <= p; j++) {
      const w = N[k][j];
      const q = c.ctrl[span - p + j];
      for (let d = 0; d < dim; d++) pt[d] += w * q[d];
    }
    out.push(pt);
  }
  return out;
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dotN = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const lenN = (a: number[]) => Math.sqrt(dotN(a, a));

/**
 * The cubic (or lower, for fewer than four points) B-spline through the points, in order:
 * chord-length parameters on [0, 1] and knots by averaging (The NURBS Book, 9.2.1). The same
 * points always give the same curve, so an edge and a face built from one row of points agree.
 */
export function interpolate(pts: number[][]): Spline {
  const n = pts.length;
  const p = Math.min(3, n - 1);
  const u: number[] = [0];
  for (let i = 1; i < n; i++) u.push(u[i - 1] + Math.max(1e-12, lenN(sub(pts[i], pts[i - 1]))));
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
  // The system is banded (p+1 wide); a dense solve is fine at these sizes.
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const span = findSpan(n - 1, p, u[i], U);
    const N = basisDers(span, u[i], p, 0, U)[0];
    for (let j = 0; j <= p; j++) A[i][span - p + j] = N[j];
  }
  const dim = pts[0].length;
  const ctrl = solveMany(A, pts, dim);
  if (!ctrl) {
    // Degenerate parameters: a polyline through the points is still exact at them.
    return { degree: 1, knots: [0, ...u, 1], ctrl: pts.map((q) => q.slice()) };
  }
  ctrl[0] = pts[0].slice();
  ctrl[n - 1] = pts[n - 1].slice();
  return { degree: p, knots: U, ctrl };
}

/** Solves A X = B for every column of B at once (Gaussian elimination, partial pivoting). */
export function solveMany(A: number[][], B: number[][], dim: number): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...B[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const row = M[c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / row[c];
      if (f === 0) continue;
      const target = M[r];
      for (let k = c; k < n + dim; k++) target[k] -= f * row[k];
    }
  }
  const X: number[][] = Array.from({ length: n }, () => new Array<number>(dim).fill(0));
  for (let r = n - 1; r >= 0; r--) {
    for (let d = 0; d < dim; d++) {
      let s = M[r][n + d];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * X[k][d];
      X[r][d] = s / M[r][r];
    }
  }
  return X.every((x) => x.every(Number.isFinite)) ? X : null;
}

/** Knot values and their multiplicities, as STEP writes them. */
export function compressKnots(U: number[]): { knots: number[]; mults: number[] } {
  const knots: number[] = [], mults: number[] = [];
  for (const k of U) {
    if (knots.length && Math.abs(knots[knots.length - 1] - k) < 1e-12) mults[mults.length - 1]++;
    else { knots.push(k); mults.push(1); }
  }
  return { knots, mults };
}

/** Samples per curve for finding a start for the closest-point search, kept with the curve. */
const samples = new WeakMap<Spline, { t: number[]; p: number[][] }>();

/**
 * The parameter of the curve point nearest q, the point and its tangent. Points beyond the ends
 * get the end. Starts from the nearest of a dense sampling, then Newton on (C - q)·C' = 0.
 */
export function closest(c: Spline, q: number[]): { t: number; p: number[]; d1: number[] } {
  let s = samples.get(c);
  if (!s) {
    const spans = Math.max(1, c.ctrl.length - c.degree);
    const k = Math.max(64, spans * 12);
    const t = Array.from({ length: k + 1 }, (_, i) => i / k);
    s = { t, p: t.map((x) => curveDers(c, x)[0]) };
    samples.set(c, s);
  }
  let best = 0, bd = Infinity;
  for (let i = 0; i < s.p.length; i++) {
    const d = dotN(sub(s.p[i], q), sub(s.p[i], q));
    if (d < bd) { bd = d; best = i; }
  }
  let t = s.t[best];
  let D = curveDers(c, t, 2);
  for (let it = 0; it < 30; it++) {
    const r = sub(D[0], q);
    const f = dotN(r, D[1]);
    const df = dotN(D[1], D[1]) + dotN(r, D[2]);
    if (!(Math.abs(df) > 1e-300)) break;
    let next = t - f / df;
    if (!(next >= 0)) next = 0;
    if (!(next <= 1)) next = 1;
    const moved = Math.abs(next - t);
    t = next;
    D = curveDers(c, t, 2);
    if (moved < 1e-15) break;
  }
  return { t, p: D[0], d1: D[1] };
}

// ---------------------------------------------------------------------------------------------
// Tensor-product surfaces.

/** Degrees, full knot vectors in u and v, control points ctrl[i][j] (i along u, j along v). */
export type SplineSurface = { degU: number; degV: number; knotsU: number[]; knotsV: number[]; ctrl: number[][][] };

/** S, Su, Sv, Suu, Suv, Svv at (u, v). */
export function surfaceDers(s: SplineSurface, u: number, v: number): number[][] {
  const D = new Float64Array(18);
  surfaceDersInto(s, u, v, D);
  return [0, 1, 2, 3, 4, 5].map((k) => [D[k * 3], D[k * 3 + 1], D[k * 3 + 2]]);
}

/**
 * The control net as one flat array, x y z per point, row by row (i along u): a fit reads it
 * millions of times, and three levels of nested arrays cost more than the arithmetic. Kept by the
 * net itself, so copies of one surface share it; nothing changes a net once it is made.
 */
const flatNets = new WeakMap<number[][][], Float64Array>();
function flatNet(s: SplineSurface): Float64Array {
  let f = flatNets.get(s.ctrl);
  if (!f) {
    const nu = s.ctrl.length, nv = s.ctrl[0].length;
    f = new Float64Array(nu * nv * 3);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const P = s.ctrl[i][j], o = (i * nv + j) * 3;
      f[o] = P[0]; f[o + 1] = P[1]; f[o + 2] = P[2];
    }
    flatNets.set(s.ctrl, f);
  }
  return f;
}

/** The same as `surfaceDers` into a given array: S, Su, Sv, Suu, Suv, Svv, x y z each, 18 numbers. */
export function surfaceDersInto(s: SplineSurface, u: number, v: number, out: Float64Array): void {
  const nu = s.ctrl.length - 1, nv = s.ctrl[0].length - 1;
  const su = findSpan(nu, s.degU, u, s.knotsU), sv = findSpan(nv, s.degV, v, s.knotsV);
  const Wu = s.degU + 1, Wv = s.degV + 1;
  if (surfU.length < 3 * Wu) surfU = new Float64Array(3 * Wu);
  if (surfV.length < 3 * Wv) surfV = new Float64Array(3 * Wv);
  const Nu = surfU, Nv = surfV;
  basisDersInto(su, u, s.degU, 2, s.knotsU, Nu);
  basisDersInto(sv, v, s.degV, 2, s.knotsV, Nv);
  const net = flatNet(s);
  // Each sum taken in the same order as always (a, then b), one running total per number.
  let sx = 0, sy = 0, sz = 0, ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0;
  let uux = 0, uuy = 0, uuz = 0, uvx = 0, uvy = 0, uvz = 0, vvx = 0, vvy = 0, vvz = 0;
  for (let a = 0; a <= s.degU; a++) {
    const row = ((su - s.degU + a) * (nv + 1) + sv - s.degV) * 3;
    const u0 = Nu[a], u1 = Nu[Wu + a], u2 = Nu[2 * Wu + a];
    for (let b = 0; b <= s.degV; b++) {
      const o = row + b * 3;
      const x = net[o], y = net[o + 1], z = net[o + 2];
      const v0 = Nv[b], v1 = Nv[Wv + b], v2 = Nv[2 * Wv + b];
      let w = u0 * v0;
      if (w !== 0) { sx += w * x; sy += w * y; sz += w * z; }
      w = u1 * v0;
      if (w !== 0) { ux += w * x; uy += w * y; uz += w * z; }
      w = u0 * v1;
      if (w !== 0) { vx += w * x; vy += w * y; vz += w * z; }
      w = u2 * v0;
      if (w !== 0) { uux += w * x; uuy += w * y; uuz += w * z; }
      w = u1 * v1;
      if (w !== 0) { uvx += w * x; uvy += w * y; uvz += w * z; }
      w = u0 * v2;
      if (w !== 0) { vvx += w * x; vvy += w * y; vvz += w * z; }
    }
  }
  out[0] = sx; out[1] = sy; out[2] = sz; out[3] = ux; out[4] = uy; out[5] = uz; out[6] = vx; out[7] = vy; out[8] = vz;
  out[9] = uux; out[10] = uuy; out[11] = uuz; out[12] = uvx; out[13] = uvy; out[14] = uvz; out[15] = vvx; out[16] = vvy; out[17] = vvz;
}

/**
 * The surface point alone at (u, v), into out[at], out[at + 1], out[at + 2]: the basis values only
 * and sixteen control points, for the many callers that never look at a derivative. The same
 * numbers as `surfaceDers(s, u, v)[0]`, to the last bit.
 */
export function surfacePointInto(s: SplineSurface, u: number, v: number, out: Float64Array | number[], at = 0): void {
  const nu = s.ctrl.length - 1, nv = s.ctrl[0].length - 1;
  const su = findSpan(nu, s.degU, u, s.knotsU), sv = findSpan(nv, s.degV, v, s.knotsV);
  if (pointU.length < s.degU + 1) pointU = new Float64Array(s.degU + 1);
  if (pointV.length < s.degV + 1) pointV = new Float64Array(s.degV + 1);
  const Nu = pointU, Nv = pointV;
  basisFunsInto(su, u, s.degU, s.knotsU, Nu);
  basisFunsInto(sv, v, s.degV, s.knotsV, Nv);
  const net = flatNet(s);
  let x = 0, y = 0, z = 0;
  for (let a = 0; a <= s.degU; a++) {
    const row = ((su - s.degU + a) * (nv + 1) + sv - s.degV) * 3;
    for (let b = 0; b <= s.degV; b++) {
      const w = Nu[a] * Nv[b];
      if (w === 0) continue;
      const o = row + b * 3;
      x += w * net[o]; y += w * net[o + 1]; z += w * net[o + 2];
    }
  }
  out[at] = x; out[at + 1] = y; out[at + 2] = z;
}

/** The basis values `surfaceDersInto` is working with, in u and in v, and those of `surfacePointInto`. */
let surfU = new Float64Array(12), surfV = new Float64Array(12);
let pointU = new Float64Array(4), pointV = new Float64Array(4);

/** A dense grid of the surface's points, kept with the surface: (u, v) pairs and x y z per point. */
const surfSamples = new WeakMap<SplineSurface, { uv: Float64Array; p: Float64Array }>();

/** Where a closest-point search ended: (u, v), and S, Su, Sv, Suu, Suv, Svv there (18 numbers, as `surfaceDersInto`). */
export type SurfaceHit = { u: number; v: number; d: Float64Array };

/** A place for `closestInto` to write to, reused by callers that read the answer at once and keep nothing of it. */
export function surfaceHit(): SurfaceHit {
  return { u: 0, v: 0, d: new Float64Array(18) };
}

/**
 * The (u, v) of the surface point nearest q, with the point and its partial derivatives. Starts
 * from `start` when given (a point's parameters from the fit), else from a dense sampling; then
 * Newton on the gradient of |S - q|², kept inside the domain.
 */
export function closestOnSurface(s: SplineSurface, q: number[], start?: [number, number]): { u: number; v: number; d: number[][] } {
  const hit = closestInto(s, q, start, surfaceHit());
  const D = hit.d;
  return { u: hit.u, v: hit.v, d: [0, 1, 2, 3, 4, 5].map((k) => [D[k * 3], D[k * 3 + 1], D[k * 3 + 2]]) };
}

/** The same into `hit`, which is returned: nothing is made per call or per step. */
export function closestInto(s: SplineSurface, q: number[], start: [number, number] | undefined, hit: SurfaceHit): SurfaceHit {
  let u: number, v: number;
  if (start) [u, v] = start;
  else {
    let smp = surfSamples.get(s);
    if (!smp) {
      const ku = Math.max(16, (s.ctrl.length - s.degU) * 6), kv = Math.max(16, (s.ctrl[0].length - s.degV) * 6);
      const count = (ku + 1) * (kv + 1);
      const uv = new Float64Array(count * 2), p = new Float64Array(count * 3);
      for (let i = 0, n = 0; i <= ku; i++) for (let j = 0; j <= kv; j++, n++) {
        uv[n * 2] = i / ku;
        uv[n * 2 + 1] = j / kv;
        surfacePointInto(s, i / ku, j / kv, p, n * 3);
      }
      smp = { uv, p };
      surfSamples.set(s, smp);
    }
    const p = smp.p, count = p.length / 3;
    let best = 0, bd = Infinity;
    for (let i = 0; i < count; i++) {
      const x = p[i * 3] - q[0], y = p[i * 3 + 1] - q[1], z = p[i * 3 + 2] - q[2];
      const d = x * x + y * y + z * z;
      if (d < bd) { bd = d; best = i; }
    }
    u = smp.uv[best * 2];
    v = smp.uv[best * 2 + 1];
  }
  const D = hit.d;
  surfaceDersInto(s, u, v, D);
  for (let it = 0; it < 25; it++) {
    // The dot products summed from zero, term by term, as they always were.
    const r0 = D[0] - q[0], r1 = D[1] - q[1], r2 = D[2] - q[2];
    const g0 = 0 + r0 * D[3] + r1 * D[4] + r2 * D[5], g1 = 0 + r0 * D[6] + r1 * D[7] + r2 * D[8];
    const uu = 0 + D[3] * D[3] + D[4] * D[4] + D[5] * D[5];
    const vv = 0 + D[6] * D[6] + D[7] * D[7] + D[8] * D[8];
    const a = uu + (0 + r0 * D[9] + r1 * D[10] + r2 * D[11]);
    const b = (0 + D[3] * D[6] + D[4] * D[7] + D[5] * D[8]) + (0 + r0 * D[12] + r1 * D[13] + r2 * D[14]);
    const c = vv + (0 + r0 * D[15] + r1 * D[16] + r2 * D[17]);
    const det = a * c - b * b;
    let du: number, dv: number;
    if (det > 1e-300 && a > 0) { du = -(c * g0 - b * g1) / det; dv = -(a * g1 - b * g0) / det; }
    else {
      // Not convex here: a gradient step instead.
      const L = uu + vv || 1;
      du = -g0 / L; dv = -g1 / L;
    }
    // A short step at a time: far from the answer a full Newton step can land anywhere.
    const reach = Math.max(Math.abs(du), Math.abs(dv));
    if (reach > 0.1) { du *= 0.1 / reach; dv *= 0.1 / reach; }
    const nu = Math.min(1, Math.max(0, u + du)), nv = Math.min(1, Math.max(0, v + dv));
    const moved = Math.abs(nu - u) + Math.abs(nv - v);
    u = nu; v = nv;
    surfaceDersInto(s, u, v, D);
    if (moved < 1e-14) break;
  }
  hit.u = u;
  hit.v = v;
  return hit;
}

/** Clamped uniform knots for n control points of degree p. */
export function uniformKnots(n: number, p: number): number[] {
  const U: number[] = new Array<number>(p + 1).fill(0);
  const spans = n - p;
  for (let i = 1; i < spans; i++) U.push(i / spans);
  for (let i = 0; i <= p; i++) U.push(1);
  return U;
}

/** Basis values of one direction at t: the first control index and the p+1 weights. */
export function basisAt(n: number, p: number, U: number[], t: number): { first: number; w: number[] } {
  const span = findSpan(n - 1, p, t, U);
  return { first: span - p, w: basisDers(span, t, p, 0, U)[0] };
}

/** The same weights into `w` (p+1 long); returns the first control index. */
export function basisInto(n: number, p: number, U: number[], t: number, w: Float64Array): number {
  const span = findSpan(n - 1, p, t, U);
  basisFunsInto(span, t, p, U, w);
  return span - p;
}
