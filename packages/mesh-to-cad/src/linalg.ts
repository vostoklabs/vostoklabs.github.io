// Small dense linear algebra for fitting: 3-vectors, a symmetric 3x3 eigen solver, a linear
// solver and a Levenberg–Marquardt loop. Millimetres throughout.

export type V3 = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** `Math.max(...values)` for a list of any length: spread into a call, a big mesh overflows the stack. */
export function maxOf(values: ArrayLike<number>): number {
  let out = -Infinity;
  for (let i = 0; i < values.length; i++) out = Math.max(out, values[i]);
  return out;
}
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function normalize(a: V3): V3 {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1];
}

/** Two unit vectors perpendicular to unit `a` and to each other (right-handed: e1 × e2 = a). */
export function basis(a: V3): [V3, V3] {
  const t: V3 = Math.abs(a[0]) < 0.6 ? [1, 0, 0] : Math.abs(a[1]) < 0.6 ? [0, 1, 0] : [0, 0, 1];
  const e1 = normalize(cross(t, a));
  // a × e1 completes the frame so that e1 × e2 = a.
  return [e1, cross(a, e1)];
}

export function centroid(pts: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  const n = pts.length || 1;
  return [x / n, y / n, z / n];
}

/** Eigen decomposition of a symmetric 3x3 (row-major), by Jacobi rotation. Values ascending. */
export function eigSym3(m: number[]): { values: V3; vectors: [V3, V3, V3] } {
  const a = m.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-300) continue;
      const app = a[p * 3 + p], aqq = a[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i * 4] - a[j * 4]);
  const col = (j: number): V3 => normalize([v[j], v[3 + j], v[6 + j]]);
  return {
    values: order.map((i) => a[i * 4]) as V3,
    vectors: order.map((j) => col(j)) as [V3, V3, V3],
  };
}

/** Covariance (scatter) matrix of points about their centroid. */
export function scatter(pts: V3[], c: V3): number[] {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  return m;
}

/** Solves A x = b (n×n, row-major arrays) by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * Levenberg–Marquardt on a model re-based every step: `apply(model, delta)` makes a nearby model
 * from a small parameter step, `residuals(model)` gives one residual per point. Finite-difference
 * Jacobian; `h` is the step used for it.
 */
export function levenberg<M>(
  model: M,
  nParams: number,
  apply: (m: M, d: number[]) => M,
  residuals: (m: M) => number[],
  h: number,
  iterations = 40,
): M {
  const first = residuals(model);
  return levenbergInto(model, nParams, apply, (m, out) => { const r = m === model ? first : residuals(m); for (let i = 0; i < r.length; i++) out[i] = r[i]; }, first.length, h, iterations);
}

/** Scratch space for `levenbergInto`, grown as needed: a fit is asked for many thousands of times. */
let lmSize = 0;
let lmR = new Float64Array(0), lmTrial = lmR, lmJ = lmR;

/**
 * The same, for a caller that writes its `nR` residuals into a given array: nothing is allocated
 * per residual, which is most of the cost of fitting a surface to a handful of points.
 */
export function levenbergInto<M>(
  model: M,
  nParams: number,
  apply: (m: M, d: number[]) => M,
  residualsInto: (m: M, out: Float64Array) => void,
  nR: number,
  h: number,
  iterations = 40,
): M {
  if (nR * (nParams + 2) > lmSize) {
    lmSize = nR * (nParams + 2) * 2;
    lmR = new Float64Array(lmSize);
    lmTrial = new Float64Array(lmSize);
    lmJ = new Float64Array(lmSize);
  }
  let r = lmR.subarray(0, nR), rk = lmTrial.subarray(0, nR);
  const J = lmJ;
  const sumSquares = (x: Float64Array) => { let s = 0; for (let i = 0; i < nR; i++) s += x[i] * x[i]; return s; };
  let cur = model;
  residualsInto(cur, r);
  let cost = sumSquares(r);
  let lambda = 1e-3;
  const d = new Array<number>(nParams).fill(0);
  for (let it = 0; it < iterations; it++) {
    if (cost < 1e-24 * nR) break;
    for (let k = 0; k < nParams; k++) {
      d.fill(0);
      d[k] = h;
      residualsInto(apply(cur, d), rk);
      for (let i = 0; i < nR; i++) J[k * nR + i] = (rk[i] - r[i]) / h;
    }
    const JTJ: number[][] = Array.from({ length: nParams }, () => new Array<number>(nParams).fill(0));
    const JTr: number[] = new Array<number>(nParams).fill(0);
    for (let a = 0; a < nParams; a++) {
      let s = 0;
      for (let i = 0; i < nR; i++) s += J[a * nR + i] * r[i];
      JTr[a] = -s;
      for (let b = a; b < nParams; b++) {
        let t = 0;
        for (let i = 0; i < nR; i++) t += J[a * nR + i] * J[b * nR + i];
        JTJ[a][b] = t;
        JTJ[b][a] = t;
      }
    }
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const A = JTJ.map((row, i) => row.map((x, j) => (i === j ? x * (1 + lambda) + 1e-12 : x)));
      const step = solve(A, JTr);
      if (!step) { lambda *= 10; continue; }
      const next = apply(cur, step);
      residualsInto(next, rk);
      const cn = sumSquares(rk);
      if (Number.isFinite(cn) && cn < cost) {
        const gain = cost - cn;
        const was = r;
        cur = next; r = rk; rk = was; cost = cn;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = true;
        // Converged: the step gained almost nothing, absolutely or against what is left.
        if (gain < 1e-14 * (1 + cost) || gain < 1e-8 * cost) return cur;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return cur;
}
