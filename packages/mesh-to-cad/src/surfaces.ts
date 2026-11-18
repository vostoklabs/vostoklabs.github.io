// The analytic surfaces a CAD face is usually drawn on, their signed distances, and fits of each
// to a set of points.

import {
  type V3, add, basis, centroid, dot, eigSym3, levenbergInto, madd, maxOf, norm, normalize, scatter, scale, sub,
} from './linalg';
import { type Swept, sweptDistance, sweptNormal } from './swept';
import { type BSplineFace, bsplineDistance, bsplineNormal } from './freeform';

export type Plane = { kind: 'plane'; o: V3; n: V3 };
/** Axis through `o` along unit `a`. */
export type Cylinder = { kind: 'cylinder'; o: V3; a: V3; r: number };
/** Apex, unit axis `a` pointing into the opening, semi-angle in radians. */
export type Cone = { kind: 'cone'; apex: V3; a: V3; ang: number };
/** `pole` (optional) only orients the parametrisation: written so the poles fall outside the face. */
export type Sphere = { kind: 'sphere'; c: V3; r: number; pole?: V3 };
/** Centre, unit axis, major radius R (tube centre circle), minor radius r (tube). */
export type Torus = { kind: 'torus'; c: V3; a: V3; R: number; r: number };
export type Analytic = Plane | Cylinder | Cone | Sphere | Torus;
/** Every surface a face can be on: an analytic one, or a profile swept round an axis or along a direction. */
export type Surface = Analytic | Swept | BSplineFace;

/** Signed distance: positive on the side the surface's own normal points to. */
export function distance(s: Surface, p: V3): number {
  // Written out without temporaries: the fits call this millions of times.
  switch (s.kind) {
    case 'revolution': case 'extrusion': return sweptDistance(s, p);
    case 'bspline': return bsplineDistance(s, p);
    case 'plane': return (p[0] - s.o[0]) * s.n[0] + (p[1] - s.o[1]) * s.n[1] + (p[2] - s.o[2]) * s.n[2];
    case 'sphere': return Math.sqrt((p[0] - s.c[0]) ** 2 + (p[1] - s.c[1]) ** 2 + (p[2] - s.c[2]) ** 2) - s.r;
    case 'cylinder': return axial(p, s.o, s.a).rho - s.r;
    case 'cone': {
      const { h, rho } = axial(p, s.apex, s.a);
      return rho * Math.cos(s.ang) - h * Math.sin(s.ang);
    }
    case 'torus': {
      const { h, rho } = axial(p, s.c, s.a);
      return Math.hypot(rho - s.R, h) - s.r;
    }
  }
}

/** Height along the axis through o (unit a) and distance from it. */
function axial(p: V3, o: V3, a: V3): { h: number; rho: number } {
  const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
  const h = x * a[0] + y * a[1] + z * a[2];
  const rx = x - h * a[0], ry = y - h * a[1], rz = z - h * a[2];
  return { h, rho: Math.sqrt(rx * rx + ry * ry + rz * rz) };
}

/** The surface's own unit normal near p (gradient of the signed distance). */
export function normalAt(s: Surface, p: V3): V3 {
  if (s.kind === 'plane') return s.n;
  if (s.kind === 'revolution' || s.kind === 'extrusion') return sweptNormal(s, p);
  if (s.kind === 'bspline') return bsplineNormal(s, p);
  const h = 1e-6 * (1 + norm(p));
  const g: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const a: V3 = [p[0], p[1], p[2]], b: V3 = [p[0], p[1], p[2]];
    a[i] += h; b[i] -= h;
    g[i] = (distance(s, a) - distance(s, b)) / (2 * h);
  }
  return normalize(g);
}

// ---------------------------------------------------------------------------------------------
// Refinement: least squares on point distances, starting from a model.

const H = 1e-7;

function sizeOf(s: Analytic): number {
  switch (s.kind) {
    case 'plane': return 1;
    case 'sphere': case 'cylinder': return 1 + s.r;
    case 'cone': return 1;
    case 'torus': return 1 + s.R + s.r;
  }
}

/**
 * `distance` for every point of a packed list (xyz, xyz, ...) at once, written into `out`: the
 * same sums in the same order, with nothing allocated per point.
 */
function distancesInto(s: Analytic, P: Float64Array, out: Float64Array): void {
  const n = out.length;
  if (s.kind === 'plane') {
    for (let i = 0; i < n; i++) out[i] = (P[i * 3] - s.o[0]) * s.n[0] + (P[i * 3 + 1] - s.o[1]) * s.n[1] + (P[i * 3 + 2] - s.o[2]) * s.n[2];
    return;
  }
  if (s.kind === 'sphere') {
    const cx = s.c[0], cy = s.c[1], cz = s.c[2], r = s.r;
    for (let i = 0; i < n; i++) out[i] = Math.sqrt((P[i * 3] - cx) ** 2 + (P[i * 3 + 1] - cy) ** 2 + (P[i * 3 + 2] - cz) ** 2) - r;
    return;
  }
  const o = s.kind === 'cylinder' ? s.o : s.kind === 'cone' ? s.apex : s.c;
  const ox = o[0], oy = o[1], oz = o[2], ax = s.a[0], ay = s.a[1], az = s.a[2];
  const cos = s.kind === 'cone' ? Math.cos(s.ang) : 0, sin = s.kind === 'cone' ? Math.sin(s.ang) : 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - ox, y = P[i * 3 + 1] - oy, z = P[i * 3 + 2] - oz;
    const h = x * ax + y * ay + z * az;
    const rx = x - h * ax, ry = y - h * ay, rz = z - h * az;
    const rho = Math.sqrt(rx * rx + ry * ry + rz * rz);
    // (A plain square root: Math.hypot is several times slower, and nothing here can overflow.)
    out[i] = s.kind === 'cylinder' ? rho - s.r : s.kind === 'cone' ? rho * cos - h * sin : Math.sqrt((rho - s.R) * (rho - s.R) + h * h) - s.r;
  }
}

export function refine(s: Analytic, pts: V3[]): Analytic {
  if (s.kind === 'plane') return fitPlane(pts);
  const P = new Float64Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) { P[i * 3] = pts[i][0]; P[i * 3 + 1] = pts[i][1]; P[i * 3 + 2] = pts[i][2]; }
  const h = H * sizeOf(s) * (s.kind === 'cone' ? 1 + maxOf(pts.map((p) => norm(sub(p, (s as Cone).apex)))) : 1);
  const fit = (nParams: number, apply: (m: Analytic, d: number[]) => Analytic) =>
    levenbergInto<Analytic>(s, nParams, apply, (m, out) => distancesInto(m, P, out), pts.length, h);
  switch (s.kind) {
    case 'sphere':
      return fit(4, (m, d) => {
        const q = m as Sphere;
        return { kind: 'sphere', c: add(q.c, [d[0], d[1], d[2]]), r: q.r + d[3] };
      });
    case 'cylinder':
      return fit(5, (m, d) => {
        const q = m as Cylinder;
        const [e1, e2] = basis(q.a);
        return {
          kind: 'cylinder',
          a: normalize(add(q.a, add(scale(e1, d[0]), scale(e2, d[1])))),
          o: add(q.o, add(scale(e1, d[2]), scale(e2, d[3]))),
          r: q.r + d[4],
        };
      });
    case 'cone':
      return fit(6, (m, d) => {
        const q = m as Cone;
        const [e1, e2] = basis(q.a);
        return {
          kind: 'cone',
          apex: add(q.apex, [d[0], d[1], d[2]]),
          a: normalize(add(q.a, add(scale(e1, d[3]), scale(e2, d[4])))),
          ang: q.ang + d[5],
        };
      });
    case 'torus':
      return fit(7, (m, d) => {
        const q = m as Torus;
        const [e1, e2] = basis(q.a);
        return {
          kind: 'torus',
          c: add(q.c, [d[0], d[1], d[2]]),
          a: normalize(add(q.a, add(scale(e1, d[3]), scale(e2, d[4])))),
          R: q.R + d[5],
          r: q.r + d[6],
        };
      });
  }
}

// ---------------------------------------------------------------------------------------------
// Fits from scratch: a starting guess from the geometry, then refinement. Null when no guess.

/** What a fit can use: the vertices, and each triangle's normal and centroid (area-weighted). */
export type Sample = {
  pts: V3[];
  /** Vertex normals, averaged over the sample's own triangles. */
  vnrm: V3[];
  /** Triangle normals and centroids. */
  tnrm: V3[];
  tpts: V3[];
  /** Index pairs of vertices joined by a mesh edge. */
  pairs: [number, number][];
};

export function fitPlane(pts: V3[]): Plane {
  const c = centroid(pts);
  const { vectors } = eigSym3(scatter(pts, c));
  return { kind: 'plane', o: c, n: vectors[0] };
}

export function fitSphere(s: Sample): Sphere | null {
  const pts = s.pts;
  if (pts.length < 4) return null;
  // Algebraic start: x²+y²+z² + D x + E y + F z + G = 0, about the centroid.
  const c0 = centroid(pts);
  const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const b = [0, 0, 0, 0];
  for (const p of pts) {
    const q = sub(p, c0);
    const row = [q[0], q[1], q[2], 1];
    const rhs = -(q[0] * q[0] + q[1] * q[1] + q[2] * q[2]);
    for (let i = 0; i < 4; i++) {
      b[i] += row[i] * rhs;
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
    }
  }
  const x = solveSmall(A, b);
  if (!x) return null;
  const cc: V3 = [-x[0] / 2, -x[1] / 2, -x[2] / 2];
  const r2 = dot(cc, cc) - x[3];
  if (!(r2 > 0)) return null;
  return refine({ kind: 'sphere', c: add(c0, cc), r: Math.sqrt(r2) }, pts) as Sphere;
}

export function fitCylinder(s: Sample): Cylinder | null {
  if (s.pts.length < 5 || s.tnrm.length < 2) return null;
  // A cylinder's facets all contain lines parallel to its axis, so every facet normal is
  // perpendicular to it: the axis is the direction the normals leave out.
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const n of s.tnrm) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += n[i] * n[j];
  const a = eigSym3(m).vectors[0];
  const circle = fitCircle2D(s.pts, a);
  if (!circle) return null;
  return refine({ kind: 'cylinder', o: circle.c, a, r: circle.r }, s.pts) as Cylinder;
}

export function fitCone(s: Sample): Cone | null {
  if (s.pts.length < 6 || s.tnrm.length < 3) return null;
  // A cone's facet normals all make one angle with its axis: they lie on a circle of the unit
  // sphere, and the axis is the normal of that circle's plane.
  const nc = centroid(s.tnrm);
  let a = eigSym3(scatter(s.tnrm, nc)).vectors[0];
  const c = dot(nc, a);
  // A facet spanning two rulings lies in a plane through the apex.
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  s.tnrm.forEach((n, i) => {
    const pn = dot(s.tpts[i], n);
    for (let r = 0; r < 3; r++) {
      b[r] += n[r] * pn;
      for (let k = 0; k < 3; k++) A[r][k] += n[r] * n[k];
    }
  });
  const x = solveSmall(A, b);
  if (!x) return null;
  const apex: V3 = [x[0], x[1], x[2]];
  if (s.pts.reduce((t, p) => t + dot(sub(p, apex), a), 0) < 0) a = scale(a, -1);
  const ang = Math.asin(Math.min(0.999, Math.abs(c)));
  if (!(ang > 1e-3 && ang < Math.PI / 2 - 1e-3)) return null;
  return refine({ kind: 'cone', apex, a, ang }, s.pts) as Cone;
}

/**
 * Torus: estimate the tube radius from how fast the normals turn, step every point to its tube
 * centre, and the centres lie on a circle (the spine) whose plane gives the axis.
 */
export function fitTorus(s: Sample): Torus | null {
  const { pts, vnrm: nrm, pairs } = s;
  if (pts.length < 7 || pairs.length < 3) return null;
  const ks: number[] = [];
  for (const [i, j] of pairs) {
    const dp = sub(pts[i], pts[j]);
    const L2 = dot(dp, dp);
    if (L2 < 1e-12) continue;
    ks.push(dot(sub(nrm[i], nrm[j]), dp) / L2);
  }
  if (ks.length < 3) return null;
  ks.sort((x, y) => Math.abs(y) - Math.abs(x));
  const kTube = ks[Math.floor(ks.length * 0.1)];
  if (!kTube || Math.abs(kTube) < 1e-9) return null;
  const r = 1 / Math.abs(kTube);
  // Convex tube (normals spread apart): the tube centre is behind the surface.
  const sgn = kTube > 0 ? -1 : 1;
  const centres = pts.map((p, i) => madd(p, nrm[i], sgn * r));
  const plane = fitPlane(centres);
  const circle = fitCircle2D(centres, plane.n);
  if (!circle) return null;
  const c = madd(circle.c, plane.n, -dot(sub(circle.c, plane.o), plane.n));
  return refine({ kind: 'torus', c, a: plane.n, R: circle.r, r }, pts) as Torus;
}

/** Circle through points projected on the plane normal to `a`: a point on the axis and radius. */
function fitCircle2D(pts: V3[], a: V3): { c: V3; r: number } | null {
  const [e1, e2] = basis(a);
  const c0 = centroid(pts);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (const p of pts) {
    const q = sub(p, c0);
    const x = dot(q, e1), y = dot(q, e2);
    const row = [x, y, 1];
    const rhs = -(x * x + y * y);
    for (let i = 0; i < 3; i++) {
      b[i] += row[i] * rhs;
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j];
    }
  }
  const s = solveSmall(A, b);
  if (!s) return null;
  const cx = -s[0] / 2, cy = -s[1] / 2;
  const r2 = cx * cx + cy * cy - s[2];
  if (!(r2 > 0)) return null;
  return { c: add(c0, add(scale(e1, cx), scale(e2, cy))), r: Math.sqrt(r2) };
}

function solveSmall(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  const big = Math.max(...A.flat().map(Math.abs), 1e-300);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-13 * big) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
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
