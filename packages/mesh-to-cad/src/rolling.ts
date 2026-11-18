// Rounds and ball corners rebuilt from the faces they roll between.
//
// A round of radius r between two faces is the surface a ball of radius r sweeps while it touches
// both. Given those two faces exactly, the round needs nothing from its own few triangles: its
// radius, its surface and both its borders (the lines where the ball touches each face) follow.
// So the triangles left between the main faces (the band) are read in this order:
//
//   1. Each band vertex, for each pair of faces near it and each side (a convex round has the ball
//      inside the material, a concave one outside), votes the radius of the ball through it that
//      touches both faces. The radius of a round is the densest window of its pair's votes: one
//      number per round, never a curvature measured on its own facets.
//   2. A band triangle goes to the round whose ball holds all three corners, inside its arc.
//   3. Rounds whose centre-line comes out a line or a circle become faces themselves, and a second
//      pass rebuilds the rounds that roll on them.
//   4. What is left between rounds of one radius is a ball corner when one ball touches every face
//      of those rounds and holds every point; it then takes back the rounds' triangles it holds
//      better than they do.
//
// A round is named as CAD names it: centre-line a line, a cylinder; a circle, a torus; a point, a
// sphere. Anything else is one face with no surface of its own (`surf: null`, `round` set), to be
// given one sheet with circular sections between its two contact lines.
//
// How far a point may sit off the ideal ball is the round's own: a round the CAD wrote exactly
// holds its points at float precision; one it wrote as an approximation (a B-spline through the
// rolling ball) sits off it in a smooth hump, and that hump is measured on the round's own voters.
// It is never allowed beyond what the part itself shows to be approximation: the CAD's tolerance on
// its edges (`tolEdge`) or the bow of the round's own facets off the ball, whichever is larger. A
// point that close to a ball cannot be told from it by the mesh at all.

import { type V3, eigSym3, solve } from './linalg';
import { type Mesh } from './mesh';
import { type Region } from './segment';
import { type Surface, distance, normalAt } from './surfaces';
import { type Swept } from './swept';


export type RollInput = {
  /** Faces whose surfaces are believed exact. */
  main: Region[];
  /** Every triangle in no main face. */
  band: number[];
  tolPoint: number;
  tolEdge: number;
};

/** How a rebuilt round was made: what a sheet or an edge between its faces needs to know. */
export type RoundInfo = {
  /**
   * The faces the ball touches: indices into `main`, or `-1 - k` for `rounds[k]` (a round rolling
   * on a round; NaN in the rare case a corner took that round whole). Two for a round along an
   * edge, three or more for a ball corner.
   */
  on: number[];
  /** +1: a convex round, the ball inside the material; -1: concave, the ball outside it. */
  side: 1 | -1;
  /** The ball's radius (mm). */
  r: number;
  /** How far the round's points may sit off the ideal ball (mm). */
  tol: number;
  /** The ball centre's path: a line (cylinder), a circle (torus), a point (sphere) or a free curve (one sheet). */
  spine: 'line' | 'circle' | 'point' | 'curve';
};

export type Rolled = {
  /** Rounds and ball corners: `round` set; `surf` a cylinder, torus or sphere, or null for one face that takes one sheet. */
  rounds: Region[];
  /** Indices into `main` of exact faces that lie on the ball of two others: rounds already, kept as they are. */
  rolled: number[];
  /** Triangles no round explains. */
  left: number[];
  /** How each of `rounds` was made, in the same order. */
  info: RoundInfo[];
  /** How each of `rolled` lies on its ball, in the same order. */
  rolledInfo: RoundInfo[];
};

// ---------------------------------------------------------------------------------------------
// Faces with a side: the signed distance and its gradient, positive out of the material.

/** A face the ball can touch: its surface and which way the material lies (+1: the surface's own normal points out). */
export type Oriented = { surf: Surface; o: 1 | -1 };

/** Which way the material lies under a set of triangles drawn on `surf`. */
export function orientOf(m: Mesh, surf: Surface, tris: number[]): 1 | -1 {
  let s = 0;
  const p: V3 = [0, 0, 0];
  for (const t of tris) {
    const a = m.tri[t * 3] * 3, b = m.tri[t * 3 + 1] * 3, c = m.tri[t * 3 + 2] * 3;
    p[0] = (m.pos[a] + m.pos[b] + m.pos[c]) / 3;
    p[1] = (m.pos[a + 1] + m.pos[b + 1] + m.pos[c + 1]) / 3;
    p[2] = (m.pos[a + 2] + m.pos[b + 2] + m.pos[c + 2]) / 3;
    const n = normalAt(surf, p);
    s += m.area[t] * (n[0] * m.normal[t * 3] + n[1] * m.normal[t * 3 + 1] + n[2] * m.normal[t * 3 + 2]);
  }
  return s >= 0 ? 1 : -1;
}

const pScratch: V3 = [0, 0, 0];

/**
 * A swept face (a profile round an axis or along a direction) measured many thousands of times at
 * points a hair apart: the profile sampled once into a table, the nearest sample found by a scan,
 * then Newton on (C - q)·C' = 0; distance and normal from the same foot, the last point's kept.
 * Same answer as `distance` / `normalAt` (both take the nearest curve point, ends clamped).
 */
type SweptCache = { ts: Float64Array; xs: Float64Array; ys: Float64Array; C: Curve2[]; lx: number; ly: number; lz: number; d: number; nx: number; ny: number; nz: number };
const sweptCaches = new WeakMap<Surface, SweptCache>();

/** A planar B-spline in flat arrays: degree, knots, control points. */
type Curve2 = { p: number; U: Float64Array; x: Float64Array; y: Float64Array };

/** The curve and its first two derivative curves (control points of a derivative: p (P[i+1] - P[i]) / (U[i+p+1] - U[i+1])). */
function curveAndDerivatives(c: { degree: number; knots: number[]; ctrl: number[][] }): Curve2[] {
  const out: Curve2[] = [{ p: c.degree, U: Float64Array.from(c.knots), x: Float64Array.from(c.ctrl, (q) => q[0]), y: Float64Array.from(c.ctrl, (q) => q[1]) }];
  for (let k = 0; k < 2; k++) {
    const a = out[out.length - 1];
    if (a.p === 0) { out.push({ p: 0, U: a.U, x: new Float64Array(a.x.length), y: new Float64Array(a.x.length) }); continue; }
    const n = a.x.length - 1, x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const den = a.U[i + a.p + 1] - a.U[i + 1];
      const f = den > 0 ? a.p / den : 0;
      x[i] = f * (a.x[i + 1] - a.x[i]); y[i] = f * (a.y[i + 1] - a.y[i]);
    }
    out.push({ p: a.p - 1, U: a.U.subarray(1, a.U.length - 1), x, y });
  }
  return out;
}

const deBoorX = new Float64Array(16), deBoorY = new Float64Array(16);
/** Point of a curve at t (de Boor), into out[at], out[at+1]. */
function curveAt(c: Curve2, t: number, out: Float64Array, at: number): void {
  const n = c.x.length - 1, p = c.p, U = c.U;
  if (n < 0) { out[at] = 0; out[at + 1] = 0; return; }
  let k: number;
  if (t >= U[n + 1]) k = n;
  else if (t <= U[p]) k = p;
  else { let lo = p, hi = n + 1; k = (lo + hi) >> 1; while (t < U[k] || t >= U[k + 1]) { if (t < U[k]) hi = k; else lo = k; k = (lo + hi) >> 1; } }
  for (let j = 0; j <= p; j++) { deBoorX[j] = c.x[j + k - p]; deBoorY[j] = c.y[j + k - p]; }
  for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
    const den = U[j + 1 + k - r] - U[j + k - p];
    const al = den > 0 ? (t - U[j + k - p]) / den : 0;
    deBoorX[j] = (1 - al) * deBoorX[j - 1] + al * deBoorX[j];
    deBoorY[j] = (1 - al) * deBoorY[j - 1] + al * deBoorY[j];
  }
  out[at] = deBoorX[p]; out[at + 1] = deBoorY[p];
}
const D6 = new Float64Array(6);
function curveDers2(C: Curve2[], t: number): Float64Array {
  curveAt(C[0], t, D6, 0); curveAt(C[1], t, D6, 2); curveAt(C[2], t, D6, 4);
  return D6;
}

function sweptAt(s: Swept, x: number, y: number, z: number): SweptCache {
  let c = sweptCaches.get(s);
  if (!c) {
    const spans = Math.max(1, s.profile.ctrl.length - s.profile.degree);
    const k = Math.max(64, spans * 12);
    const U = s.profile.knots, t0 = U[0], t1 = U[U.length - 1];
    const ts = new Float64Array(k + 1), xs = new Float64Array(k + 1), ys = new Float64Array(k + 1);
    const C = curveAndDerivatives(s.profile);
    for (let i = 0; i <= k; i++) { ts[i] = t0 + ((t1 - t0) * i) / k; curveAt(C[0], ts[i], D6, 0); xs[i] = D6[0]; ys[i] = D6[1]; }
    c = { ts, xs, ys, C, lx: NaN, ly: NaN, lz: NaN, d: 0, nx: 0, ny: 0, nz: 0 };
    sweptCaches.set(s, c);
  }
  if (c.lx === x && c.ly === y && c.lz === z) return c;
  const vx = x - s.o[0], vy = y - s.o[1], vz = z - s.o[2];
  let qx: number, qy: number, ux: number, uy: number, uz: number, wx: number, wy: number, wz: number;
  if (s.kind === 'revolution') {
    const h = vx * s.a[0] + vy * s.a[1] + vz * s.a[2];
    const rx = vx - h * s.a[0], ry = vy - h * s.a[1], rz = vz - h * s.a[2];
    const rho = Math.sqrt(rx * rx + ry * ry + rz * rz);
    qx = rho; qy = h;
    if (rho > 1e-12) { ux = rx / rho; uy = ry / rho; uz = rz / rho; } else { ux = s.ref[0]; uy = s.ref[1]; uz = s.ref[2]; }
    wx = s.a[0]; wy = s.a[1]; wz = s.a[2];
  } else {
    qx = vx * s.e1[0] + vy * s.e1[1] + vz * s.e1[2]; qy = vx * s.e2[0] + vy * s.e2[1] + vz * s.e2[2];
    ux = s.e1[0]; uy = s.e1[1]; uz = s.e1[2]; wx = s.e2[0]; wy = s.e2[1]; wz = s.e2[2];
  }
  let best = 0, bd = Infinity;
  for (let i = 0; i < c.ts.length; i++) { const d = (c.xs[i] - qx) ** 2 + (c.ys[i] - qy) ** 2; if (d < bd) { bd = d; best = i; } }
  const t0 = c.ts[0], t1 = c.ts[c.ts.length - 1];
  let t = c.ts[best];
  let D = curveDers2(c.C, t);
  for (let it = 0; it < 30; it++) {
    const rx = D[0] - qx, ry = D[1] - qy;
    const f = rx * D[2] + ry * D[3];
    const df = D[2] * D[2] + D[3] * D[3] + rx * D[4] + ry * D[5];
    if (!(Math.abs(df) > 1e-300)) break;
    let next = t - f / df;
    if (!(next >= t0)) next = t0;
    if (!(next <= t1)) next = t1;
    const moved = Math.abs(next - t);
    t = next;
    D = curveDers2(c.C, t);
    if (moved < 1e-15 * (1 + Math.abs(t))) break;
  }
  const dx = qx - D[0], dy = qy - D[1];
  const d = Math.hypot(dx, dy);
  const tl = Math.hypot(D[2], D[3]) || 1;
  const side = dx * D[3] - dy * D[2];
  c.d = side >= 0 ? d : -d;
  // the normal: the profile tangent turned clockwise, in 3D
  c.nx = (ux * D[3] - wx * D[2]) / tl; c.ny = (uy * D[3] - wy * D[2]) / tl; c.nz = (uz * D[3] - wz * D[2]) / tl;
  c.lx = x; c.ly = y; c.lz = z;
  return c;
}

/** Signed distance of (x, y, z) from the face, positive out of the material. */
function dO(F: Oriented, x: number, y: number, z: number): number {
  const s = F.surf;
  switch (s.kind) {
    case 'plane': return F.o * ((x - s.o[0]) * s.n[0] + (y - s.o[1]) * s.n[1] + (z - s.o[2]) * s.n[2]);
    case 'sphere': return F.o * (Math.sqrt((x - s.c[0]) ** 2 + (y - s.c[1]) ** 2 + (z - s.c[2]) ** 2) - s.r);
    case 'cylinder': case 'cone': case 'torus': {
      const o = s.kind === 'cylinder' ? s.o : s.kind === 'cone' ? s.apex : s.c;
      const vx = x - o[0], vy = y - o[1], vz = z - o[2];
      const h = vx * s.a[0] + vy * s.a[1] + vz * s.a[2];
      const rx = vx - h * s.a[0], ry = vy - h * s.a[1], rz = vz - h * s.a[2];
      const rho = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (s.kind === 'cylinder') return F.o * (rho - s.r);
      if (s.kind === 'cone') return F.o * (rho * Math.cos(s.ang) - h * Math.sin(s.ang));
      return F.o * (Math.sqrt((rho - s.R) * (rho - s.R) + h * h) - s.r);
    }
    case 'revolution': case 'extrusion': return F.o * sweptAt(s, x, y, z).d;
    default:
      pScratch[0] = x; pScratch[1] = y; pScratch[2] = z;
      return F.o * distance(s, pScratch);
  }
}

/** The face's outward unit normal at (x, y, z), written into out[at..at+2]. */
function nO(F: Oriented, x: number, y: number, z: number, out: Float64Array, at: number): void {
  const s = F.surf;
  let gx: number, gy: number, gz: number;
  switch (s.kind) {
    case 'plane': gx = s.n[0]; gy = s.n[1]; gz = s.n[2]; break;
    case 'sphere': gx = x - s.c[0]; gy = y - s.c[1]; gz = z - s.c[2]; break;
    case 'cylinder': case 'cone': case 'torus': {
      const o = s.kind === 'cylinder' ? s.o : s.kind === 'cone' ? s.apex : s.c;
      const vx = x - o[0], vy = y - o[1], vz = z - o[2];
      const h = vx * s.a[0] + vy * s.a[1] + vz * s.a[2];
      let rx = vx - h * s.a[0], ry = vy - h * s.a[1], rz = vz - h * s.a[2];
      const rho = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-300;
      rx /= rho; ry /= rho; rz /= rho;
      if (s.kind === 'cylinder') { gx = rx; gy = ry; gz = rz; }
      else if (s.kind === 'cone') {
        const c = Math.cos(s.ang), sn = Math.sin(s.ang);
        gx = rx * c - s.a[0] * sn; gy = ry * c - s.a[1] * sn; gz = rz * c - s.a[2] * sn;
      } else {
        const q = rho - s.R;
        gx = rx * q + s.a[0] * h; gy = ry * q + s.a[1] * h; gz = rz * q + s.a[2] * h;
      }
      break;
    }
    case 'revolution': case 'extrusion': { const c = sweptAt(s, x, y, z); gx = c.nx; gy = c.ny; gz = c.nz; break; }
    default: {
      pScratch[0] = x; pScratch[1] = y; pScratch[2] = z;
      const g = normalAt(s, pScratch);
      gx = g[0]; gy = g[1]; gz = g[2];
    }
  }
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  out[at] = (F.o * gx) / l; out[at + 1] = (F.o * gy) / l; out[at + 2] = (F.o * gz) / l;
}

// ---------------------------------------------------------------------------------------------
// The rolling ball. Faces A and B, side s: the centre c sits at depth s·r under both,
// dO(A, c) = -s r and dO(B, c) = -s r; the contact on A is c + s r nO(A, c).

/** Where a point sits on a ball between two faces: what `ballAt` and `ballThrough` find. */
export type BallHit = {
  /** The centre-line point in the point's normal plane. */
  c: V3;
  r: number;
  /** |p - c| - r, positive out of the material (mm). */
  res: number;
  /** Where p lies round the arc from the contact on A (0) to the contact on B (1). */
  frac: number;
  /** The same as a length along the arc from the contact on A (mm), and the arc's whole angle. */
  arc: number;
  th: number;
  /** p's offset out of the arc's plane, as a share of |p - c| (zero when c is the right centre). */
  off: number;
};

const G = new Float64Array(12);   // nO(A), nO(B), the tangent, scratch
const M4 = new Float64Array(20);

function tangentInto(): boolean {
  // t = nA × nB, unit, into G[6..8]
  const tx = G[1] * G[5] - G[2] * G[4], ty = G[2] * G[3] - G[0] * G[5], tz = G[0] * G[4] - G[1] * G[3];
  const l = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (!(l > 1e-12)) return false;
  G[6] = tx / l; G[7] = ty / l; G[8] = tz / l;
  return true;
}

/**
 * The length the Newton steps are measured against: the radius and the size of the coordinates
 * (what double rounding scales with). It scales with the part, so "converged" means the same at
 * any size.
 */
function span(r: number, x: number, y: number, z: number): number {
  return Math.abs(r) + Math.abs(x) + Math.abs(y) + Math.abs(z);
}

function arcInto(A: Oriented, B: Oriented, s: number, r: number, px: number, py: number, pz: number, cx: number, cy: number, cz: number, hit: BallHit): boolean {
  nO(A, cx, cy, cz, G, 0);
  nO(B, cx, cy, cz, G, 3);
  const ax = s * G[0], ay = s * G[1], az = s * G[2], bx = s * G[3], by = s * G[4], bz = s * G[5];
  const vx = px - cx, vy = py - cy, vz = pz - cz;
  const L = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (!(L > 0)) return false;
  const ux = vx / L, uy = vy / L, uz = vz / L;
  const th = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
  let kx = ay * bz - az * by, ky = az * bx - ax * bz, kz = ax * by - ay * bx;
  const kl = Math.sqrt(kx * kx + ky * ky + kz * kz);
  if (!(kl > 1e-12)) return false;
  kx /= kl; ky /= kl; kz /= kl;
  const cx2 = ay * uz - az * uy, cy2 = az * ux - ax * uz, cz2 = ax * uy - ay * ux;
  const ang = Math.atan2(cx2 * kx + cy2 * ky + cz2 * kz, ax * ux + ay * uy + az * uz);
  hit.c[0] = cx; hit.c[1] = cy; hit.c[2] = cz;
  hit.r = r;
  hit.res = s * (L - r);
  hit.th = th;
  hit.frac = ang / th;
  hit.arc = ang * r;
  hit.off = ux * kx + uy * ky + uz * kz;
  return true;
}

/**
 * The ball of radius r between A and B whose centre lies in p's normal plane: where p sits on it.
 * `c0` is a start for the centre (the vertex normal stepped in by r when none is known).
 */
export function ballAt(A: Oriented, B: Oriented, s: number, r: number, p: V3, c0: V3, hit: BallHit): boolean {
  let cx = c0[0], cy = c0[1], cz = c0[2];
  const cap = 0.5 * r;
  let ok = false;
  for (let it = 0; it < 40; it++) {
    const f1 = dO(A, cx, cy, cz) + s * r, f2 = dO(B, cx, cy, cz) + s * r;
    nO(A, cx, cy, cz, G, 0);
    nO(B, cx, cy, cz, G, 3);
    if (!tangentInto()) return false;
    const f3 = (cx - p[0]) * G[6] + (cy - p[1]) * G[7] + (cz - p[2]) * G[8];
    const res = Math.max(Math.abs(f1), Math.abs(f2), Math.abs(f3));
    if (res < 1e-12 * span(r, cx, cy, cz)) { ok = true; break; }
    // J = rows nA, nB, t (the tangent's own turn is left out: it only slows the last steps)
    const det = G[0] * (G[4] * G[8] - G[5] * G[7]) - G[1] * (G[3] * G[8] - G[5] * G[6]) + G[2] * (G[3] * G[7] - G[4] * G[6]);
    if (!(Math.abs(det) > 1e-14)) return false;
    // Cramer's rule for J d = f
    const dx = (f1 * (G[4] * G[8] - G[5] * G[7]) - G[1] * (f2 * G[8] - G[5] * f3) + G[2] * (f2 * G[7] - G[4] * f3)) / det;
    const dy = (G[0] * (f2 * G[8] - G[5] * f3) - f1 * (G[3] * G[8] - G[5] * G[6]) + G[2] * (G[3] * f3 - f2 * G[6])) / det;
    const dz = (G[0] * (G[4] * f3 - f2 * G[7]) - G[1] * (G[3] * f3 - f2 * G[6]) + f1 * (G[3] * G[7] - G[4] * G[6])) / det;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const k = l > cap ? cap / l : 1;
    cx -= dx * k; cy -= dy * k; cz -= dz * k;
    if (l * k < 1e-14 * span(r, cx, cy, cz)) { ok = true; break; }
  }
  if (!ok) {
    const f1 = dO(A, cx, cy, cz) + s * r, f2 = dO(B, cx, cy, cz) + s * r;
    // not converged to rounding: accept a centre that still sits on both offsets to a part in 10^8 of its span
    if (!(Math.abs(f1) < 1e-8 * span(r, cx, cy, cz) && Math.abs(f2) < 1e-8 * span(r, cx, cy, cz))) return false;
  }
  return arcInto(A, B, s, r, p[0], p[1], p[2], cx, cy, cz, hit);
}

/** Newton on centre and radius: the ball touching A and B that passes through p. */
function newtonThrough(A: Oriented, B: Oriented, s: number, p: V3, r0: number, x0: number, y0: number, z0: number, out: Float64Array): boolean {
  let cx = x0, cy = y0, cz = z0, r = r0;
  const cap = 0.5 * r0;
  for (let it = 0; it < 40; it++) {
    nO(A, cx, cy, cz, G, 0);
    nO(B, cx, cy, cz, G, 3);
    if (!tangentInto()) return false;
    const vx = cx - p[0], vy = cy - p[1], vz = cz - p[2];
    const L = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (!(L > 0)) return false;
    const f0 = dO(A, cx, cy, cz) + s * r, f1 = dO(B, cx, cy, cz) + s * r;
    const f2 = vx * G[6] + vy * G[7] + vz * G[8], f3 = L - r;
    const res = Math.max(Math.abs(f0), Math.abs(f1), Math.abs(f2), Math.abs(f3));
    if (res < 1e-12 * span(r, cx, cy, cz)) { out[0] = cx; out[1] = cy; out[2] = cz; out[3] = r; return r > 0; }
    // J (4x4, rows nA|s, nB|s, t|0, u|-1) d = f, by elimination with pivoting
    const J = M4;
    J[0] = G[0]; J[1] = G[1]; J[2] = G[2]; J[3] = s; J[4] = f0;
    J[5] = G[3]; J[6] = G[4]; J[7] = G[5]; J[8] = s; J[9] = f1;
    J[10] = G[6]; J[11] = G[7]; J[12] = G[8]; J[13] = 0; J[14] = f2;
    J[15] = vx / L; J[16] = vy / L; J[17] = vz / L; J[18] = -1; J[19] = f3;
    if (!solve4(J)) return false;
    const dx = J[4], dy = J[9], dz = J[14], dr = J[19];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz + dr * dr);
    const k = l > cap ? cap / l : 1;
    cx -= dx * k; cy -= dy * k; cz -= dz * k; r -= dr * k;
    if (l * k < 1e-14 * span(r, cx, cy, cz)) { out[0] = cx; out[1] = cy; out[2] = cz; out[3] = r; return r > 0; }
  }
  const f0 = dO(A, cx, cy, cz) + s * r, f1 = dO(B, cx, cy, cz) + s * r;
  const L = Math.hypot(cx - p[0], cy - p[1], cz - p[2]);
  if (!(Math.abs(f0) < 1e-8 * span(r, cx, cy, cz) && Math.abs(f1) < 1e-8 * span(r, cx, cy, cz) && Math.abs(L - r) < 1e-8 * span(r, cx, cy, cz))) return false;
  out[0] = cx; out[1] = cy; out[2] = cz; out[3] = r;
  return r > 0;
}

/** In-place Gauss-Jordan on a 4x5 augmented matrix (row stride 5): the solution lands in column 4. */
function solve4(J: Float64Array): boolean {
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(J[r * 5 + c]) > Math.abs(J[piv * 5 + c])) piv = r;
    if (!(Math.abs(J[piv * 5 + c]) > 1e-14)) return false;
    if (piv !== c) for (let k = 0; k < 5; k++) { const t = J[c * 5 + k]; J[c * 5 + k] = J[piv * 5 + k]; J[piv * 5 + k] = t; }
    const d = J[c * 5 + c];
    for (let k = c; k < 5; k++) J[c * 5 + k] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = J[r * 5 + c];
      if (f === 0) continue;
      for (let k = c; k < 5; k++) J[r * 5 + k] -= f * J[c * 5 + k];
    }
  }
  return true;
}

const T4 = new Float64Array(4);
const startR = new Float64Array(6), startC = new Float64Array(18);

/**
 * The ball through p touching A and B (centre and radius both free): what p votes for. The two
 * roots of |p - c(r)| = r (p inside the arc, or on the ball beyond a contact) are both tried, from
 * the faces' tangent planes at p and from the vertex normal, until p lands inside the arc.
 */
export function ballThrough(A: Oriented, B: Oriented, s: number, p: V3, n: V3, rMax: number, hit: BallHit): boolean {
  const dA = dO(A, p[0], p[1], p[2]), dB = dO(B, p[0], p[1], p[2]);
  nO(A, p[0], p[1], p[2], G, 0);
  nO(B, p[0], p[1], p[2], G, 3);
  const ax = G[0], ay = G[1], az = G[2], bx = G[3], by = G[4], bz = G[5];
  let nS = 0;
  // Tangent planes at p: the centre in the normal plane is linear in r, c = p + x e1 + y e2 with
  // e1 = a, e2 = (a × b) × a / |...|; |c - p| = r is then a quadratic in r.
  let tx = ay * bz - az * by, ty = az * bx - ax * bz, tz = ax * by - ay * bx;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl > 1e-9) {
    tx /= tl; ty /= tl; tz /= tl;
    const e2x = ty * az - tz * ay, e2y = tz * ax - tx * az, e2z = tx * ay - ty * ax;
    const m21 = bx * ax + by * ay + bz * az, m22 = bx * e2x + by * e2y + bz * e2z;
    if (Math.abs(m22) > 1e-12) {
      // x = q1, y = (q2 - m21 q1) / m22, for (q1, q2) = (-s r - dA, -s r - dB)
      const U0 = -s, U1 = (-s + s * m21) / m22, W0 = -dA, W1 = (-dB + m21 * dA) / m22;
      const qa = U0 * U0 + U1 * U1 - 1, qb = 2 * (U0 * W0 + U1 * W1), qc = W0 * W0 + W1 * W1;
      const roots: number[] = [];
      if (Math.abs(qa) < 1e-12) { if (qb !== 0) roots.push(-qc / qb); }
      else {
        const D = qb * qb - 4 * qa * qc;
        if (D >= 0) { const sq = Math.sqrt(D); roots.push((-qb - sq) / (2 * qa), (-qb + sq) / (2 * qa)); }
      }
      for (const r0 of roots) {
        if (!(r0 > 0 && r0 < rMax)) continue;
        const x = r0 * U0 + W0, y = r0 * U1 + W1;
        startR[nS] = r0;
        startC[nS * 3] = p[0] + ax * x + e2x * y; startC[nS * 3 + 1] = p[1] + ay * x + e2y * y; startC[nS * 3 + 2] = p[2] + az * x + e2z * y;
        nS++;
      }
    }
  }
  const den = n[0] * ax + n[1] * ay + n[2] * az + n[0] * bx + n[1] * by + n[2] * bz - 2;
  const est = (s * (dA + dB)) / den;
  if (est > 0 && est < rMax) for (const k of [1, 0.6, 1.6]) {
    startR[nS] = est * k;
    startC[nS * 3] = p[0] - s * est * k * n[0]; startC[nS * 3 + 1] = p[1] - s * est * k * n[1]; startC[nS * 3 + 2] = p[2] - s * est * k * n[2];
    nS++;
  }
  let found = false;
  let fx = 0, fy = 0, fz = 0, fr = 0;
  for (let i = 0; i < nS; i++) {
    if (!newtonThrough(A, B, s, p, startR[i], startC[i * 3], startC[i * 3 + 1], startC[i * 3 + 2], T4)) continue;
    if (!arcInto(A, B, s, T4[3], p[0], p[1], p[2], T4[0], T4[1], T4[2], hit)) continue;
    if (hit.frac > -0.02 && hit.frac < 1.02) return true;
    if (!found) { found = true; fx = T4[0]; fy = T4[1]; fz = T4[2]; fr = T4[3]; }
  }
  return found && arcInto(A, B, s, fr, p[0], p[1], p[2], fx, fy, fz, hit);
}

export function newHit(): BallHit { return { c: [0, 0, 0], r: 0, res: 0, frac: 0, arc: 0, th: 0, off: 0 }; }

/**
 * A round as `rollRounds` hands it on: its radius (the seam's `round.r`), and riding along on the
 * same object the side and the two faces the ball touches, for the sheet of a round along a free
 * curve. Read it with `ballOf`.
 */
export type RoundBall = { r: number; side: 1 | -1; a: Oriented; b: Oriented };

/** The ball a rebuilt round carries, or null for a face that is no rebuilt edge round (a ball corner, or anything else). */
export function ballOf(g: { round?: { r: number } }): RoundBall | null {
  const x = g.round as Partial<RoundBall> | undefined;
  return x && x.a && x.b && (x.side === 1 || x.side === -1) ? (x as RoundBall) : null;
}

/** A vertex's normal: its triangles' normals, weighted by area. */
export function vertexNormal(m: Mesh, v: number): V3 {
  let x = 0, y = 0, z = 0;
  for (const t of m.vertTris[v]) { x += m.normal[t * 3] * m.area[t]; y += m.normal[t * 3 + 1] * m.area[t]; z += m.normal[t * 3 + 2] * m.area[t]; }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** A face's outward unit normal at p. */
export function faceNormal(F: Oriented, p: V3): V3 {
  const out = new Float64Array(3);
  nO(F, p[0], p[1], p[2], out, 0);
  return [out[0], out[1], out[2]];
}

// ---------------------------------------------------------------------------------------------
// Distance from a point to the triangles of one face, through a grid of cells.

function pointTriangle(px: number, py: number, pz: number, pos: Float64Array, ia: number, ib: number, ic: number): number {
  const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
  const abx = pos[ib] - ax, aby = pos[ib + 1] - ay, abz = pos[ib + 2] - az;
  const acx = pos[ic] - ax, acy = pos[ic + 1] - ay, acz = pos[ic + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const at = (u: number, v: number) => Math.hypot(px - (ax + abx * u + acx * v), py - (ay + aby * u + acy * v), pz - (az + abz * u + acz * v));
  if (d1 <= 0 && d2 <= 0) return at(0, 0);
  const bpx = px - pos[ib], bpy = py - pos[ib + 1], bpz = pz - pos[ib + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return at(1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cpx = px - pos[ic], cpy = py - pos[ic + 1], cpz = pz - pos[ic + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return at(0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at(1 - w, w); }
  const den = 1 / (va + vb + vc);
  return at(vb * den, vc * den);
}

type FaceGrid = { near: (face: number, q: V3, limit: number) => boolean };

/**
 * Whether a point lies within `limit` of a given face's triangles: a bounding-box tree per face
 * (triangles halved along the widest spread of their middles, four to a leaf), searched only where
 * a box is within the limit, ended by the first triangle that is.
 */
function faceGrid(m: Mesh, label: Int32Array): FaceGrid {
  const nT = label.length, pos = m.pos, tri = m.tri;
  let nF = 0;
  for (let t = 0; t < nT; t++) nF = Math.max(nF, label[t] + 1);
  const lists: number[][] = Array.from({ length: nF }, () => []);
  for (let t = 0; t < nT; t++) if (label[t] >= 0) lists[label[t]].push(t);
  const mid = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    if (label[t] < 0) continue;
    for (let d = 0; d < 3; d++) mid[t * 3 + d] = (pos[tri[t * 3] * 3 + d] + pos[tri[t * 3 + 1] * 3 + d] + pos[tri[t * 3 + 2] * 3 + d]) / 3;
  }
  // nodes: box (6), first and count of triangles (leaf) or children (inner: count = -1, first = left child; right = left + 1)
  type Tree = { order: Int32Array; box: Float64Array; first: Int32Array; count: Int32Array };
  const trees: Tree[] = lists.map((list) => {
    const order = Int32Array.from(list);
    const maxNodes = 2 * list.length + 2;
    const box = new Float64Array(maxNodes * 6), first = new Int32Array(maxNodes), count = new Int32Array(maxNodes);
    let used = 1;
    const stack: number[] = [0, 0, list.length];
    while (stack.length) {
      const hi = stack.pop()!, lo = stack.pop()!, node = stack.pop()!;
      let a0 = Infinity, a1 = Infinity, a2 = Infinity, b0 = -Infinity, b1 = -Infinity, b2 = -Infinity;
      let m0 = Infinity, m1 = Infinity, m2 = Infinity, n0 = -Infinity, n1 = -Infinity, n2 = -Infinity;
      for (let i = lo; i < hi; i++) {
        const t = order[i];
        for (let k = 0; k < 3; k++) {
          const v = tri[t * 3 + k] * 3;
          a0 = Math.min(a0, pos[v]); a1 = Math.min(a1, pos[v + 1]); a2 = Math.min(a2, pos[v + 2]);
          b0 = Math.max(b0, pos[v]); b1 = Math.max(b1, pos[v + 1]); b2 = Math.max(b2, pos[v + 2]);
        }
        m0 = Math.min(m0, mid[t * 3]); m1 = Math.min(m1, mid[t * 3 + 1]); m2 = Math.min(m2, mid[t * 3 + 2]);
        n0 = Math.max(n0, mid[t * 3]); n1 = Math.max(n1, mid[t * 3 + 1]); n2 = Math.max(n2, mid[t * 3 + 2]);
      }
      box[node * 6] = a0; box[node * 6 + 1] = a1; box[node * 6 + 2] = a2; box[node * 6 + 3] = b0; box[node * 6 + 4] = b1; box[node * 6 + 5] = b2;
      if (hi - lo <= 4) { first[node] = lo; count[node] = hi - lo; continue; }
      const axis = n0 - m0 >= n1 - m1 && n0 - m0 >= n2 - m2 ? 0 : n1 - m1 >= n2 - m2 ? 1 : 2;
      const part = Array.from(order.subarray(lo, hi)).sort((x, y) => mid[x * 3 + axis] - mid[y * 3 + axis]);
      order.set(part, lo);
      const half = (lo + hi) >> 1;
      const left = used;
      used += 2;
      first[node] = left; count[node] = -1;
      stack.push(left, lo, half, left + 1, half, hi);
    }
    return { order, box, first, count };
  });
  const stack = new Int32Array(256);
  const near = (face: number, q: V3, limit: number): boolean => {
    if (face < 0 || face >= nF || !lists[face].length) return false;
    const T = trees[face];
    let sp = 0;
    stack[sp++] = 0;
    const l2 = limit * limit;
    while (sp) {
      const node = stack[--sp], b = node * 6;
      const ox = Math.max(T.box[b] - q[0], 0, q[0] - T.box[b + 3]), oy = Math.max(T.box[b + 1] - q[1], 0, q[1] - T.box[b + 4]), oz = Math.max(T.box[b + 2] - q[2], 0, q[2] - T.box[b + 5]);
      if (ox * ox + oy * oy + oz * oz > l2) continue;
      if (T.count[node] >= 0) {
        for (let i = T.first[node]; i < T.first[node] + T.count[node]; i++) {
          const t = T.order[i];
          if (pointTriangle(q[0], q[1], q[2], pos, tri[t * 3] * 3, tri[t * 3 + 1] * 3, tri[t * 3 + 2] * 3) <= limit) return true;
        }
      } else if (sp < 254) { stack[sp++] = T.first[node]; stack[sp++] = T.first[node] + 1; }
    }
    return false;
  };
  return { near };
}


// ---------------------------------------------------------------------------------------------
// The faces nearest each band vertex, walking the band's own edges.

/** Up to K faces per vertex, nearest first, by the shortest path over band edges from each face's border. */
type Nearest = { face: Int32Array; dist: Float64Array; count: Uint8Array };
const K_NEAR = 6;
/** Faces each band vertex votes between (the nearest of its K_NEAR): a round lies between the faces nearest its points. */
const K_VOTE = 4;

function nearestFaces(m: Mesh, rest: number[], faceOfVertex: (v: number, each: (f: number) => void) => void): Nearest {
  const nV = m.pos.length / 3;
  const face = new Int32Array(nV * K_NEAR).fill(-1), dist = new Float64Array(nV * K_NEAR), count = new Uint8Array(nV);
  // Band edges as an adjacency list (CSR).
  const deg = new Int32Array(nV + 1);
  for (const t of rest) for (let k = 0; k < 3; k++) { deg[m.tri[t * 3 + k] + 1]++; deg[m.tri[t * 3 + ((k + 1) % 3)] + 1]++; }
  for (let v = 0; v < nV; v++) deg[v + 1] += deg[v];
  const fill = deg.slice(0, nV), to = new Int32Array(deg[nV]), len = new Float64Array(deg[nV]);
  for (const t of rest) for (let k = 0; k < 3; k++) {
    const a = m.tri[t * 3 + k], b = m.tri[t * 3 + ((k + 1) % 3)];
    const l = Math.hypot(m.pos[a * 3] - m.pos[b * 3], m.pos[a * 3 + 1] - m.pos[b * 3 + 1], m.pos[a * 3 + 2] - m.pos[b * 3 + 2]);
    to[fill[a]] = b; len[fill[a]++] = l;
    to[fill[b]] = a; len[fill[b]++] = l;
  }
  // A binary heap of (distance, vertex, face).
  let cap = 1024, size = 0;
  let hk = new Float64Array(cap), hv = new Int32Array(cap), hf = new Int32Array(cap);
  const push = (d: number, v: number, f: number) => {
    if (size === cap) {
      cap *= 2;
      const k2 = new Float64Array(cap), v2 = new Int32Array(cap), f2 = new Int32Array(cap);
      k2.set(hk); v2.set(hv); f2.set(hf); hk = k2; hv = v2; hf = f2;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= d) break;
      hk[i] = hk[p]; hv[i] = hv[p]; hf[i] = hf[p]; i = p;
    }
    hk[i] = d; hv[i] = v; hf[i] = f;
  };
  let topD = 0, topV = 0, topF = 0;
  const pop = () => {
    topD = hk[0]; topV = hv[0]; topF = hf[0];
    const d = hk[--size], v = hv[size], f = hf[size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      if (l >= size) break;
      const c = r < size && hk[r] < hk[l] ? r : l;
      if (hk[c] >= d) break;
      hk[i] = hk[c]; hv[i] = hv[c]; hf[i] = hf[c]; i = c;
    }
    hk[i] = d; hv[i] = v; hf[i] = f;
  };
  const has = (v: number, f: number) => { for (let k = 0; k < count[v]; k++) if (face[v * K_NEAR + k] === f) return true; return false; };
  for (let v = 0; v < nV; v++) if (deg[v + 1] > deg[v]) faceOfVertex(v, (f) => push(0, v, f));
  while (size) {
    pop();
    const v = topV, f = topF, d = topD;
    if (count[v] >= K_NEAR || has(v, f)) continue;
    face[v * K_NEAR + count[v]] = f; dist[v * K_NEAR + count[v]] = d; count[v]++;
    for (let e = deg[v]; e < deg[v + 1]; e++) {
      const w = to[e];
      if (count[w] < K_NEAR && !has(w, f)) push(d + len[e], w, f);
    }
  }
  return { face, dist, count };
}

// ---------------------------------------------------------------------------------------------
// The run.

/**
 * A face the ball rolls on: a main face, or a round of an earlier pass that came out a cylinder or
 * torus. `hyp`: the round it is, if it is one; `from`: the first pass it is rolled on.
 */
type RollFace = Oriented & { tris: number[]; main: number; hyp: number; from: number };

/** A round: the ball of radius r between faces a and b on one side. */
type Hyp = {
  a: number; b: number; s: 1 | -1; r: number; pass: number; tol: number;
  /** Measured, for the record: the voters' median residual and their facets' median bow off the ball (mm). */
  noise: number; sag: number; votes: number;
  /** Per vertex it was evaluated at: where it sits on the ball. */
  at: Map<number, number>; res: number[]; arc: number[]; th: number[]; cx: number[]; cy: number[]; cz: number[];
  tris: number;
  /** For a main face found to be this round already: its index in `main`. */
  rolledMain: number;
};

/** Relative width of the densest window of radius votes that makes one round's radius. */
const CLUSTER_REL = 1e-3;
/**
 * Votes within this share of that radius belong to the same round: a CAD approximation of the
 * rolling ball spreads its votes this wide (measured on parts with known answers).
 */
const SAME_REL = 5e-3;
/** Fewest votes that make a round: below this a pair of faces is noise. */
const MIN_VOTES = 4;
/** A round's tolerance is this many times its voters' median residual (the hump of an approximated round reaches about four times its median). */
const NOISE_SPAN = 6;
/** The most of a round's points that may sit in the outer half of its tolerance (see where it is used). */
const OUTER_SHARE = 0.25;
/** Passes: rounds between main faces, then rounds rolling on those, and once more. */
const PASSES = 3;

export function rollRounds(m: Mesh, input: RollInput): Rolled {
  const { main, band, tolPoint, tolEdge } = input;
  const nT = m.tri.length / 3, nV = m.pos.length / 3;
  const pos = m.pos, tri = m.tri;
  const V = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];

  // Vertex normals, angle-weighted, and the length of each vertex's longest edge (the mesh's own scale there).
  const vn = new Float64Array(nV * 3), scaleOf = new Float64Array(nV);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = tri[t * 3 + k], a = tri[t * 3 + ((k + 1) % 3)], b = tri[t * 3 + ((k + 2) % 3)];
    const ex = pos[a * 3] - pos[v * 3], ey = pos[a * 3 + 1] - pos[v * 3 + 1], ez = pos[a * 3 + 2] - pos[v * 3 + 2];
    const fx = pos[b * 3] - pos[v * 3], fy = pos[b * 3 + 1] - pos[v * 3 + 1], fz = pos[b * 3 + 2] - pos[v * 3 + 2];
    const le = Math.sqrt(ex * ex + ey * ey + ez * ez), lf = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (!(le > 0 && lf > 0)) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (ex * fx + ey * fy + ez * fz) / (le * lf))));
    for (let d = 0; d < 3; d++) vn[v * 3 + d] += m.normal[t * 3 + d] * ang;
    scaleOf[v] = Math.max(scaleOf[v], le);
  }
  for (let v = 0; v < nV; v++) {
    const l = Math.hypot(vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]) || 1;
    vn[v * 3] /= l; vn[v * 3 + 1] /= l; vn[v * 3 + 2] /= l;
  }
  const VN = (v: number): V3 => [vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nV; v++) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], pos[v * 3 + d]); hi[d] = Math.max(hi[d], pos[v * 3 + d]); }
  /** No round is wider than the part. */
  const rMax = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  /** Nor so small that the CAD's own approximation of an edge could pass for it. */
  const rMin = 10 * Math.max(tolEdge, tolPoint);

  const faces: RollFace[] = [];
  const isMain = new Int32Array(nT).fill(-1);
  main.forEach((g, i) => {
    for (const t of g.tris) isMain[t] = i;
    if (g.surf) faces.push({ surf: g.surf, o: orientOf(m, g.surf, g.tris), tris: g.tris, main: i, hyp: -1, from: 0 });
    else faces.push({ surf: { kind: 'plane', o: [0, 0, 0], n: [0, 0, 1] }, o: 1, tris: g.tris, main: -1 - i, hyp: -1, from: Infinity });
  });
  const inBand = new Uint8Array(nT);
  for (const t of band) inBand[t] = 1;
  const hyps: Hyp[] = [];
  const owner = new Int32Array(nT).fill(-1), ownerErr = new Float64Array(nT).fill(Infinity);
  const hit = newHit();

  // ---- exact main faces that are rounds already (a straight round IS an exact cylinder): they
  // are rounds of the first pass, rolled on from the second like any round found here
  const { rolled, rolledHyps } = findRolled(m, main, faces, isMain, tolPoint, VN);
  for (const h of rolledHyps) { faces[h.rolledMain].hyp = hyps.length; faces[h.rolledMain].from = 1; hyps.push(h); }

  /** Where vertex v sits on round h: its slot in the round's record, computed once. */
  const evalAt = (hi: number, v: number): number => {
    const h = hyps[hi];
    let k = h.at.get(v);
    if (k !== undefined) return k;
    k = h.res.length;
    h.at.set(v, k);
    const p = V(v), n = VN(v);
    const ok = ballAt(faces[h.a], faces[h.b], h.s, h.r, p, [p[0] - h.s * h.r * n[0], p[1] - h.s * h.r * n[1], p[2] - h.s * h.r * n[2]], hit);
    h.res.push(ok ? hit.res : Infinity); h.arc.push(ok ? hit.arc : NaN); h.th.push(ok ? hit.th : NaN);
    h.cx.push(hit.c[0]); h.cy.push(hit.c[1]); h.cz.push(hit.c[2]);
    return k;
  };
  /** How far past a contact line a point of round h may sit along the arc: where the ball has turned away from the face by the round's tolerance. */
  const arcSlack = (h: Hyp) => Math.sqrt(2 * h.r * h.tol) + h.tol;
  /** Whether vertex v lies on round h: within its tolerance, inside its arc. Infinity if not, else |residual|. */
  const onRound = (hi: number, v: number): number => {
    const h = hyps[hi], k = evalAt(hi, v);
    const e = Math.abs(h.res[k]);
    if (!(e <= h.tol)) return Infinity;
    const sl = arcSlack(h);
    return h.arc[k] >= -sl && h.arc[k] <= h.th[k] * h.r + sl ? e : Infinity;
  };

  const passes: { first: number; firstFace: number }[] = [];
  for (let pass = 0; pass < PASSES; pass++) {

    const label = new Int32Array(nT).fill(-1);
    faces.forEach((F, f) => { if (F.from <= pass) for (const t of F.tris) label[t] = f; });
    const rest: number[] = [];
    for (const t of band) if (owner[t] < 0) rest.push(t);
    if (!rest.length) break;
    const grid = faceGrid(m, label);
    // Faces at each vertex (a vertex on a face's border is where the walk starts).
    const touchStart = new Int32Array(nV + 1);
    for (let t = 0; t < nT; t++) if (label[t] >= 0) for (let k = 0; k < 3; k++) touchStart[tri[t * 3 + k] + 1]++;
    for (let v = 0; v < nV; v++) touchStart[v + 1] += touchStart[v];
    const touchFill = touchStart.slice(0, nV), touch = new Int32Array(touchStart[nV]);
    for (let t = 0; t < nT; t++) if (label[t] >= 0) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]; touch[touchFill[v]++] = label[t]; }
    const onFace = (v: number) => touchStart[v + 1] > touchStart[v];
    const near = nearestFaces(m, rest, (v, each) => {
      let last = -1;
      for (let i = touchStart[v]; i < touchStart[v + 1]; i++) if (touch[i] !== last) { each(touch[i]); last = touch[i]; }
    });

    // ---- votes
    type Votes = { r: number[]; v: number[]; strict: Uint8Array | number[] };
    const votes = new Map<number, Votes>();
    const restVerts = new Uint8Array(nV);
    for (const t of rest) for (let k = 0; k < 3; k++) restVerts[tri[t * 3 + k]] = 1;
    const qA: V3 = [0, 0, 0], qB: V3 = [0, 0, 0];
    for (let v = 0; v < nV; v++) {
      if (!restVerts[v] || onFace(v)) continue;
      const cnt = Math.min(near.count[v], K_VOTE);
      const p = V(v), n = VN(v);
      const tau = scaleOf[v];
      for (let i = 0; i < cnt; i++) for (let j = i + 1; j < cnt; j++) {
        let fa = near.face[v * K_NEAR + i], fb = near.face[v * K_NEAR + j];
        if (fa > fb) { const x = fa; fa = fb; fb = x; }
        // after the first pass only pairs with a face new to this pass: the rest were asked already
        if (faces[fa].from < pass && faces[fb].from < pass) continue;
        const A = faces[fa], B = faces[fb];
        nO(A, p[0], p[1], p[2], G, 9);
        const ax = G[9], ay = G[10], az = G[11];
        nO(B, p[0], p[1], p[2], G, 9);
        if (Math.abs(ax * G[9] + ay * G[10] + az * G[11]) > 0.99995) continue;
        for (const s of [1, -1] as const) {
          if (!ballThrough(A, B, s, p, n, rMax, hit)) continue;
          const r = hit.r;
          if (!(r > rMin) || r > rMax) continue;
          if (!(hit.frac > 0.03 && hit.frac < 0.97) || Math.abs(hit.off) > 1e-6) continue;
          if (s * ((p[0] - hit.c[0]) * n[0] + (p[1] - hit.c[1]) * n[1] + (p[2] - hit.c[2]) * n[2]) < 0) continue;
          // The contacts must lie on the two faces' own triangles: within the mesh's scale here, or
          // (looser) within the radius past them, where a round's end runs past its face's corner.
          nO(A, hit.c[0], hit.c[1], hit.c[2], G, 9);
          qA[0] = hit.c[0] + s * r * G[9]; qA[1] = hit.c[1] + s * r * G[10]; qA[2] = hit.c[2] + s * r * G[11];
          nO(B, hit.c[0], hit.c[1], hit.c[2], G, 9);
          qB[0] = hit.c[0] + s * r * G[9]; qB[1] = hit.c[1] + s * r * G[10]; qB[2] = hit.c[2] + s * r * G[11];
          const tc = tau + r;
          if (!grid.near(fa, qA, tc) || !grid.near(fb, qB, tc)) continue;
          const strict = grid.near(fa, qA, tau) && grid.near(fb, qB, tau);
          const key = (fa * 1048576 + fb) * 2 + (s > 0 ? 1 : 0);
          let l = votes.get(key);
          if (!l) votes.set(key, (l = { r: [], v: [], strict: [] }));
          l.r.push(r); l.v.push(v); (l.strict as number[]).push(strict ? 1 : 0);
        }
      }
    }

    // ---- one radius per round: the densest window of each pair's votes
    const firstHyp = hyps.length;
    for (const [key, l] of votes) {
      const s: 1 | -1 = key % 2 ? 1 : -1;
      const pair = Math.floor(key / 2), fa = Math.floor(pair / 1048576), fb = pair % 1048576;
      const order = l.r.map((_, i) => i).sort((x, y) => l.r[x] - l.r[y]);
      let alive = order;
      let first = 0;
      while (alive.length >= MIN_VOTES) {
        let bn = 0, blo = 0, bhi = 0;
        for (let i = 0, j = 0; i < alive.length; i++) {
          while (l.r[alive[j]] < l.r[alive[i]] * (1 - CLUSTER_REL)) j++;
          if (i - j + 1 > bn) { bn = i - j + 1; blo = j; bhi = i; }
        }
        if (bn < MIN_VOTES) break;
        const r = l.r[alive[(blo + bhi) >> 1]];
        const same = alive.filter((i) => Math.abs(l.r[i] - r) <= SAME_REL * r);
        const drop = () => { alive = alive.filter((i) => Math.abs(l.r[i] - r) > SAME_REL * r); };
        if (first && (same.length < 0.5 * first || hyps.some((h) => h.a === fa && h.b === fb && h.s === s && Math.abs(h.r - r) < 0.05 * r))) break;
        // The round's own tolerance: its voters' median residual at this radius (float noise on an
        // exact round, the approximation's hump on a CAD B-spline), times the hump's reach.
        const strictSame = same.filter((i) => l.strict[i]);
        // a round is seen touching both faces where they are: voters whose contacts lie on the faces' own triangles
        if (strictSame.length < MIN_VOTES) { drop(); continue; }
        const from = strictSame;
        const resid: number[] = [], bows: number[] = [], centres: V3[] = [];
        const step = Math.max(1, Math.floor(from.length / 200));
        for (let q = 0; q < from.length; q += step) {
          const v = l.v[from[q]], p = V(v), n = VN(v);
          if (!ballAt(faces[fa], faces[fb], s, r, p, [p[0] - s * r * n[0], p[1] - s * r * n[1], p[2] - s * r * n[2]], hit)) continue;
          resid.push(Math.abs(hit.res));
          const c0: V3 = [hit.c[0], hit.c[1], hit.c[2]];
          const cr = hit.res;
          centres.push(c0);
          // the bow of the voter's facets off the ball: each facet's middle against the ball
          for (const t of m.vertTris[v]) {
            if (!inBand[t]) continue;
            const c: V3 = [0, 0, 0];
            for (let k = 0; k < 3; k++) { const w = tri[t * 3 + k]; c[0] += pos[w * 3] / 3; c[1] += pos[w * 3 + 1] / 3; c[2] += pos[w * 3 + 2] / 3; }
            if (ballAt(faces[fa], faces[fb], s, r, c, c0, hit) && hit.frac > 0 && hit.frac < 1) bows.push(Math.abs(hit.res - cr));
          }
        }
        if (!resid.length) { drop(); continue; }
        const noise = median(resid), sag = bows.length ? median(bows) : 0;
        if (pass > 0 && centres.length) {
          // two rounds whose centre-lines cross: the ball sits at one point, a corner, not a round
          const c0 = mean(centres);
          let spread = 0;
          for (const c of centres) spread = Math.max(spread, Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]));
          if (spread < 0.05 * r) { drop(); continue; }
        }
        // Most voters off the ball by more than the part could explain: not one radius (a round
        // whose radius changes along it holds a ball only across a strip).
        const cap = Math.max(tolEdge, sag);
        if (noise > cap) { drop(); continue; }
        const tol = Math.min(cap, Math.max(tolPoint, NOISE_SPAN * noise));
        // Pass 2 and on only continue a round already found: its radius is the radius of a round on
        // these faces (one that holds triangles), to the radius window or what the two rounds may
        // each sit off their balls.
        if (pass > 0) {
          const related = (h: Hyp, k: number) => h.pass < pass && h.tris > 0 && (
            faces[fa].hyp === k || faces[fb].hyp === k || h.a === fa || h.a === fb || h.b === fa || h.b === fb ||
            (faces[h.a]?.hyp >= 0 && (faces[h.a].hyp === faces[fa].hyp || faces[h.a].hyp === faces[fb].hyp)) ||
            (faces[h.b]?.hyp >= 0 && (faces[h.b].hyp === faces[fa].hyp || faces[h.b].hyp === faces[fb].hyp)));
          if (!hyps.some((h, k) => related(h, k) && Math.abs(h.r - r) <= Math.max(CLUSTER_REL * r, h.tol + tol))) { drop(); continue; }
        }
        hyps.push({ a: fa, b: fb, s, r, pass, tol, noise, sag, votes: same.length, at: new Map(), res: [], arc: [], th: [], cx: [], cy: [], cz: [], tris: 0, rolledMain: -1 });
        first ||= same.length;
        drop();
      }
    }

    // ---- a band triangle goes to the round that holds all three corners best
    const reaches = (v: number, f: number) => { for (let k = 0; k < near.count[v]; k++) if (near.face[v * K_NEAR + k] === f) return true; return false; };
    // the rest triangles each face reaches (from any corner)
    const reachedBy = new Map<number, number[]>();
    for (const t of rest) {
      const seen: number[] = [];
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k];
        for (let q = 0; q < near.count[v]; q++) {
          const f = near.face[v * K_NEAR + q];
          if (seen.includes(f)) continue;
          seen.push(f);
          let l = reachedBy.get(f);
          if (!l) reachedBy.set(f, (l = []));
          l.push(t);
        }
      }
    }
    for (let hi = firstHyp; hi < hyps.length; hi++) {
      const h = hyps[hi];
      for (const t of reachedBy.get(h.a) ?? []) {
        const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
        if (!(reaches(a, h.b) || reaches(b, h.b) || reaches(c, h.b))) continue;
        const e = Math.max(onRound(hi, a), onRound(hi, b), onRound(hi, c));
        if (e < ownerErr[t]) { owner[t] = hi; ownerErr[t] = e; }
      }
    }
    // The tolerance again, from the round itself: its voters at the ends may be another surface
    // that nearly matches it (a corner patch blending into its end votes nearly its radius), and
    // they raise the median. The points inside the triangles it now holds (every triangle round
    // them its own) are the round; their median residual sets the tolerance, never wider than
    // before, and the triangles that no longer pass go back.
    for (let hi = firstHyp; hi < hyps.length; hi++) {
      const h = hyps[hi];
      if (h.tol <= tolPoint) continue;
      const own: number[] = [];
      for (const t of reachedBy.get(h.a) ?? []) if (owner[t] === hi) own.push(t);
      const res: number[] = [];
      for (const v of vertsOf(m, own)) {
        let inside = true;
        for (const t of m.vertTris[v]) if (owner[t] !== hi) { inside = false; break; }
        if (inside) res.push(Math.abs(h.res[evalAt(hi, v)]));
      }
      if (res.length < MIN_VOTES) continue;
      const tol = Math.max(tolPoint, NOISE_SPAN * median(res));
      if (!(tol < h.tol)) continue;
      h.tol = tol;
      for (const t of own) if (!(Math.max(onRound(hi, tri[t * 3]), onRound(hi, tri[t * 3 + 1]), onRound(hi, tri[t * 3 + 2])) < Infinity)) { owner[t] = -1; ownerErr[t] = Infinity; }
    }
    const count = new Map<number, number>();
    for (const t of rest) if (owner[t] >= 0) count.set(owner[t], (count.get(owner[t]) ?? 0) + 1);
    for (let hi = firstHyp; hi < hyps.length; hi++) hyps[hi].tris = count.get(hi) ?? 0;
    // A round spans its arc: its triangles reach both contact lines, where it meets its two faces.
    // A ball that holds a few triangles somewhere in the middle of an arc it never fills (a huge
    // ball between two walls, grazing a corner patch) is no round.
    // And its points sit on the ball as a round's do: float noise, or an approximation's smooth
    // hump that stays well inside the tolerance (six times its median). Points spread evenly out
    // to the tolerance are a surface crossing the ball, not lying on it: a round whose radius
    // changes along it is held by each ball across a strip whose ends are where it leaves the
    // tolerance, so about half its points sit in the outer half of it.
    const reachA = new Uint8Array(hyps.length), reachB = new Uint8Array(hyps.length);
    const seenPts = new Int32Array(hyps.length), outerPts = new Int32Array(hyps.length);
    for (const t of rest) {
      const hi = owner[t];
      if (hi < firstHyp) continue;
      const h = hyps[hi], sl = arcSlack(h);
      for (let k = 0; k < 3; k++) {
        const q = evalAt(hi, tri[t * 3 + k]);
        if (h.arc[q] <= sl) reachA[hi] = 1;
        if (h.arc[q] >= h.th[q] * h.r - sl) reachB[hi] = 1;
        seenPts[hi]++;
        if (h.tol > tolPoint && Math.abs(h.res[q]) > 0.5 * h.tol) outerPts[hi]++;
      }
    }
    const bad = (hi: number) => hi >= firstHyp && (!(reachA[hi] && reachB[hi]) || outerPts[hi] > OUTER_SHARE * seenPts[hi]);
    // A round of a triangle or two (four, rolling on a round) is noise.
    for (const t of rest) if (owner[t] >= 0 && (hyps[owner[t]].tris < (pass > 0 ? 4 : 2) || bad(owner[t]))) { owner[t] = -1; ownerErr[t] = Infinity; }

    // ---- rounds of this pass that are cylinders or tori become faces for the next
    const firstFace = faces.length;
    passes.push({ first: firstHyp, firstFace });
    for (const pc of piecesOf(m, band, owner, firstHyp)) {
      if (pc.tris.length < 4) continue;
      const nm = nameRound(hyps, pc.hi, pc.tris, m, evalAt, onRound);
      const h = hyps[pc.hi];
      if (nm.surf && (nm.spine === 'line' || nm.spine === 'circle')) faces.push({ surf: nm.surf, o: h.s, tris: pc.tris, main: -1, hyp: pc.hi, from: pass + 1 });
      else if (nm.spine === 'point' && h.pass > 0) for (const t of pc.tris) { owner[t] = -1; ownerErr[t] = Infinity; }
    }
    if (hyps.length === firstHyp || faces.length === firstFace) break;

  }

  // ---- what is left: ball corners where one ball touches every face of the rounds round it
  const cornerOf = new Int32Array(nT).fill(-1);
  const corners: { tris: number[]; c: V3; r: number; s: 1 | -1; on: number[]; tol: number; err: number }[] = [];
  const leftNow = () => band.filter((t) => owner[t] < 0 && cornerOf[t] < 0);
  const rolledOwner = new Int32Array(nT).fill(-1);
  for (let hi = 0; hi < hyps.length; hi++) if (hyps[hi].rolledMain >= 0) for (const t of main[hyps[hi].rolledMain].tris) rolledOwner[t] = hi;
  const roundOf = (t: number) => (owner[t] >= 0 ? owner[t] : rolledOwner[t]);
  /** The worst corner of triangle t off the sphere (c, r). */
  const ballError = (t: number, c: V3, r: number) => {
    let e = 0;
    for (let q = 0; q < 3; q++) { const v = tri[t * 3 + q] * 3; e = Math.max(e, Math.abs(Math.hypot(pos[v] - c[0], pos[v + 1] - c[1], pos[v + 2] - c[2]) - r)); }
    return e;
  };
  for (const comp of components(m, leftNow())) {
    const own = new Set(comp);
    const beside = new Set<number>();
    for (const t of comp) for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w >= 0 && !own.has(w) && roundOf(w) >= 0) beside.add(roundOf(w)); }
    const verts = vertsOf(m, comp);
    let best: (typeof corners)[number] | null = null;
    // rounds of one radius and side round the leftover: the ball touching all their faces
    const groups: { s: 1 | -1; r: number; hs: number[] }[] = [];
    for (const hi of beside) {
      const h = hyps[hi];
      let g = groups.find((x) => x.s === h.s && Math.abs(x.r - h.r) <= CLUSTER_REL * x.r);
      if (!g) groups.push((g = { s: h.s, r: h.r, hs: [] }));
      g.hs.push(hi);
    }
    for (const g of groups) {
      if (g.hs.length < 2) continue;
      const on = [...new Set(g.hs.flatMap((hi) => [hyps[hi].a, hyps[hi].b]))];
      const p0 = V(verts[0]), n0 = VN(verts[0]);
      const c = ballMeeting(on.map((f) => faces[f]), g.s, g.r, [p0[0] - g.s * g.r * n0[0], p0[1] - g.s * g.r * n0[1], p0[2] - g.s * g.r * n0[2]]);
      if (!c) continue;
      const tol = Math.max(tolPoint, ...g.hs.map((hi) => hyps[hi].tol));
      let meet = 0;
      for (const f of on) meet = Math.max(meet, Math.abs(dO(faces[f], c[0], c[1], c[2]) + g.s * g.r));
      let err = 0;
      for (const v of verts) { const p = V(v); err = Math.max(err, Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - g.r)); }
      if (meet <= tol && err <= tol && (!best || err < best.err)) best = { tris: comp, c, r: g.r, s: g.s, on, tol, err };
    }
    if (!best) continue;
    // One ball found from two leftover pieces (a row of round triangles between them) is one corner.
    const b0 = best;
    const sameFaces = (a: number[], b: number[]) => a.length === b.length && a.every((f) => b.includes(f));
    let k = corners.findIndex((c) => c.s === b0.s && Math.abs(c.r - b0.r) <= CLUSTER_REL * c.r && (sameFaces(c.on, b0.on) || Math.hypot(c.c[0] - b0.c[0], c.c[1] - b0.c[1], c.c[2] - b0.c[2]) <= Math.max(c.tol, b0.tol)));
    if (k >= 0) { corners[k].tris.push(...comp); corners[k].err = Math.max(corners[k].err, b0.err); best = corners[k]; }
    else { k = corners.length; corners.push(best); }
    for (const t of comp) cornerOf[t] = k;
    // The corner takes back the round triangles beside it that sit closer to its ball than to their round.
    const queue = best.tris;
    for (let i = queue.length - comp.length; i < queue.length; i++) for (let j = 0; j < 3; j++) {
      const w = m.adj[queue[i] * 3 + j];
      if (w < 0 || cornerOf[w] >= 0 || owner[w] < 0) continue;
      const e = ballError(w, best.c, best.r);
      if (e <= best.tol && e < ownerErr[w]) { owner[w] = -1; cornerOf[w] = k; queue.push(w); best.err = Math.max(best.err, e); }
    }
  }
  // A triangle on a corner's ball held by the corner on two sides (between two pieces of it), or by
  // nothing at all, is the corner's too.
  for (let changed = true; changed;) {
    changed = false;
    corners.forEach((c, k) => {
      for (let i = 0; i < c.tris.length; i++) for (let j = 0; j < 3; j++) {
        const w = m.adj[c.tris[i] * 3 + j];
        if (w < 0 || cornerOf[w] >= 0 || !inBand[w]) continue;
        let sides = 0;
        for (let q = 0; q < 3; q++) { const x = m.adj[w * 3 + q]; if (x >= 0 && cornerOf[x] === k) sides++; }
        if (owner[w] >= 0 && sides < 2) continue;
        const e = ballError(w, c.c, c.r);
        if (e > c.tol) continue;
        owner[w] = -1; cornerOf[w] = k; c.tris.push(w); c.err = Math.max(c.err, e); changed = true;
      }
    });
  }

  // ---- pieces of one round: a round found twice (two passes, two radius clusters a hair apart) is one face
  const group = new Int32Array(hyps.length).map((_, i) => i);
  const findG = (i: number): number => { while (group[i] !== i) i = group[i] = group[group[i]]; return i; };
  for (let i = 0; i < hyps.length; i++) for (let j = i + 1; j < hyps.length; j++) {
    const a = hyps[i], b = hyps[j];
    if (a.rolledMain >= 0 || b.rolledMain >= 0) continue;
    if (a.s === b.s && Math.min(a.a, a.b) === Math.min(b.a, b.b) && Math.max(a.a, a.b) === Math.max(b.a, b.b) && Math.abs(a.r - b.r) <= CLUSTER_REL * a.r) group[findG(j)] = findG(i);
  }
  const groupOf = (t: number) => (owner[t] >= 0 ? findG(owner[t]) : -1);
  // A leftover piece bordered by one round only (besides main faces), every corner on its ball, is that round.
  for (const comp of components(m, leftNow())) {
    const own = new Set(comp);
    const gs = new Set<number>();
    let other = false;
    for (const t of comp) for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w < 0 || own.has(w)) continue;
      const g = groupOf(w);
      if (g >= 0) gs.add(g); else if (isMain[w] < 0) other = true;
    }
    if (gs.size !== 1 || other) continue;
    const g = [...gs][0];
    let hiBest = -1, nBest = -1;
    for (let hi = 0; hi < hyps.length; hi++) if (findG(hi) === g && hyps[hi].tris > nBest) { nBest = hyps[hi].tris; hiBest = hi; }
    let ok = true;
    for (const v of vertsOf(m, comp)) if (!(onRound(hiBest, v) < Infinity)) { ok = false; break; }
    if (!ok) continue;
    for (const t of comp) { owner[t] = hiBest; ownerErr[t] = 0; }
  }

  // ---- the result: each connected piece of one round is one face
  const rounds: Region[] = [], info: RoundInfo[] = [];
  const roundIndexOfFace = new Map<number, number>();
  const byGroup = new Map<number, number[]>();
  for (const t of band) { const g = groupOf(t); if (g < 0) continue; let l = byGroup.get(g); if (!l) byGroup.set(g, (l = [])); l.push(t); }
  const pieceOut: { tris: number[]; hi: number }[] = [];
  for (const [g, tris] of byGroup) {
    const set = new Set(tris);
    for (const part of connectedIn(m, tris, (w) => set.has(w))) {
      const cnt = new Map<number, number>();
      for (const t of part) cnt.set(owner[t], (cnt.get(owner[t]) ?? 0) + 1);
      let hi = g, n = -1;
      for (const [k, c] of cnt) if (c > n) { n = c; hi = k; }
      pieceOut.push({ tris: part, hi });
    }
  }
  const pieceOfTri = new Int32Array(nT).fill(-1);
  for (const pc of pieceOut) {
    const h = hyps[pc.hi];
    const nm = nameRound(hyps, pc.hi, pc.tris, m, evalAt, onRound);
    let err = 0;
    for (const v of vertsOf(m, pc.tris)) { const k = evalAt(pc.hi, v); err = Math.max(err, Math.abs(hyps[pc.hi].res[k])); }
    for (const t of pc.tris) pieceOfTri[t] = rounds.length;
    // the ball rides along on the face, so the sheet can be laid through it (see `ballOf`)
    const ball: RoundBall = { r: h.r, side: h.s, a: { surf: faces[h.a].surf, o: faces[h.a].o }, b: { surf: faces[h.b].surf, o: faces[h.b].o } };
    rounds.push({ tris: pc.tris, surf: nm.surf, err, round: ball });
    info.push({ on: [h.a, h.b], side: h.s, r: h.r, tol: h.tol, spine: nm.spine });
  }
  // A face made from a round of an earlier pass is the output round holding most of its triangles
  // (a corner may since have taken some).
  faces.forEach((F, f) => {
    if (F.main >= 0 || F.hyp < 0) return;
    const cnt = new Map<number, number>();
    for (const t of F.tris) if (pieceOfTri[t] >= 0) cnt.set(pieceOfTri[t], (cnt.get(pieceOfTri[t]) ?? 0) + 1);
    let best = -1, n = 0;
    for (const [k, c] of cnt) if (c > n) { n = c; best = k; }
    if (best >= 0) roundIndexOfFace.set(f, best);
  });
  for (const c of corners) {
    rounds.push({ tris: c.tris, surf: { kind: 'sphere', c: c.c, r: c.r }, err: c.err, round: { r: c.r } });
    info.push({ on: c.on, side: c.s, r: c.r, tol: c.tol, spine: 'point' });
  }
  // faces of the rolling: main faces by their index, rounds by -1 - their place in `rounds`
  // (NaN for a round a corner took whole, which no longer stands as a face of its own)
  const faceRef = (f: number) => (faces[f].main >= 0 ? faces[f].main : roundIndexOfFace.has(f) ? -1 - roundIndexOfFace.get(f)! : NaN);
  for (const x of info) x.on = x.on.map(faceRef);
  const rolledInfo = rolled.map((i) => { const h = rolledHyps.find((x) => x.rolledMain === i)!; return { on: [faceRef(h.a), faceRef(h.b)], side: h.s, r: h.r, tol: h.tol, spine: (main[i].surf?.kind === 'sphere' ? 'point' : main[i].surf?.kind === 'torus' ? 'circle' : 'line') as RoundInfo['spine'] }; });
  const left = band.filter((t) => owner[t] < 0 && cornerOf[t] < 0);
  return { rounds, rolled, left, info, rolledInfo };
}

// ---------------------------------------------------------------------------------------------
// Exact main faces that are rounds already.

/**
 * A main cylinder, torus or sphere that lies on the rolling ball of two of its neighbouring main
 * faces, at its own radius, is a round: an exact cylinder can only be told from a straight round
 * by what is beside it. Its vertices are held to twice the point tolerance (the surface was
 * fitted to them), inside the arc. A sphere whose centre sits at its radius under two or more
 * faces near it is a ball corner.
 */
function findRolled(m: Mesh, main: Region[], faces: RollFace[], isMain: Int32Array, tolPoint: number, VN: (v: number) => V3): { rolled: number[]; rolledHyps: Hyp[] } {
  const rolled: number[] = [], rolledHyps: Hyp[] = [];
  const hit = newHit();
  const tol = 2 * tolPoint;
  const make = (i: number, a: number, b: number, s: 1 | -1, r: number) => {
    rolled.push(i);
    rolledHyps.push({ a, b, s, r, pass: -1, tol, noise: 0, sag: 0, votes: 0, at: new Map(), res: [], arc: [], th: [], cx: [], cy: [], cz: [], tris: main[i].tris.length, rolledMain: i });
  };
  main.forEach((g, i) => {
    const s0 = g.surf;
    if (!s0 || (s0.kind !== 'cylinder' && s0.kind !== 'torus' && s0.kind !== 'sphere')) return;
    const nb = new Set<number>();
    for (const t of g.tris) for (let k = 0; k < 3; k++) { const w = m.adj[t * 3 + k]; if (w >= 0 && isMain[w] >= 0 && isMain[w] !== i && main[isMain[w]].surf) nb.add(isMain[w]); }
    const list = [...nb];
    const vs = vertsOf(m, g.tris);
    const step = Math.max(1, Math.floor(vs.length / 60));
    const r = s0.r;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) for (const s of [1, -1] as const) {
      if (rolled[rolled.length - 1] === i) return;
      let ok = true;
      for (let k = 0; k < vs.length && ok; k += step) {
        const v = vs[k], p: V3 = [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]], n = VN(v);
        ok = ballAt(faces[list[x]], faces[list[y]], s, r, p, [p[0] - s * r * n[0], p[1] - s * r * n[1], p[2] - s * r * n[2]], hit) && Math.abs(hit.res) <= tol && hit.frac > -0.01 && hit.frac < 1.01;
      }
      if (ok) { make(i, list[x], list[y], s, r); return; }
    }
    if (s0.kind === 'sphere') {
      // the walls of a ball corner are not its mesh neighbours (its rounds lie between): every face with a vertex near the ball
      const lim = 1.5 * s0.r;
      for (const s of [1, -1] as const) {
        const hits: number[] = [];
        main.forEach((G2, j) => {
          if (j === i || !G2.surf) return;
          let close = false;
          for (const t of G2.tris) { for (let k = 0; k < 3 && !close; k++) { const v = m.tri[t * 3 + k]; close = Math.hypot(m.pos[v * 3] - s0.c[0], m.pos[v * 3 + 1] - s0.c[1], m.pos[v * 3 + 2] - s0.c[2]) <= lim; } if (close) break; }
          if (close && Math.abs(dO(faces[j], s0.c[0], s0.c[1], s0.c[2]) + s * s0.r) <= tol) hits.push(j);
        });
        if (hits.length >= 2) { make(i, hits[0], hits[1], s, s0.r); return; }
      }
    }
  });
  return { rolled, rolledHyps };
}

// ---------------------------------------------------------------------------------------------
// Naming, pieces, small helpers.

type Named = { surf: Region['surf']; spine: RoundInfo['spine'] };

/**
 * What a rebuilt round is, from its centre-line points (the ball centres in each vertex's normal
 * plane, exact wherever the faces are): a point, a line or a circle when they hold it within the
 * round's own tolerance (writing that surface moves the round by no more than its points may sit
 * off it), else a free curve.
 */
function nameRound(hyps: Hyp[], hi: number, tris: number[], m: Mesh, evalAt: (hi: number, v: number) => number, onRound: (hi: number, v: number) => number): Named {
  const h = hyps[hi];
  const cs: V3[] = [];
  for (const v of vertsOf(m, tris)) {
    if (!(onRound(hi, v) < Infinity)) continue;
    const k = evalAt(hi, v);
    cs.push([h.cx[k], h.cy[k], h.cz[k]]);
  }
  const lim = h.tol;
  if (cs.length < 2) return { surf: null, spine: 'curve' };
  const c0 = mean(cs);
  let spread = 0;
  for (const c of cs) spread = Math.max(spread, Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]));
  if (spread <= lim) return { surf: { kind: 'sphere', c: c0, r: h.r }, spine: 'point' };
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const c of cs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] += (c[i] - c0[i]) * (c[j] - c0[j]);
  const ev = eigSym3(S);
  const dir = ev.vectors[2];
  let lineDev = 0;
  for (const c of cs) {
    const dx = c[0] - c0[0], dy = c[1] - c0[1], dz = c[2] - c0[2], t = dx * dir[0] + dy * dir[1] + dz * dir[2];
    lineDev = Math.max(lineDev, Math.hypot(dx - t * dir[0], dy - t * dir[1], dz - t * dir[2]));
  }
  if (lineDev <= lim) return { surf: { kind: 'cylinder', o: c0, a: dir, r: h.r }, spine: 'line' };
  const pn = ev.vectors[0], e1 = ev.vectors[2], e2 = ev.vectors[1];
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  let planeDev = 0;
  for (const c of cs) {
    const dx = c[0] - c0[0], dy = c[1] - c0[1], dz = c[2] - c0[2];
    planeDev = Math.max(planeDev, Math.abs(dx * pn[0] + dy * pn[1] + dz * pn[2]));
    const x = dx * e1[0] + dy * e1[1] + dz * e1[2], y = dx * e2[0] + dy * e2[1] + dz * e2[2];
    const row = [x, y, 1], rhs = -(x * x + y * y);
    for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]; }
  }
  const sol = planeDev <= lim ? solve(A, b) : null;
  if (sol) {
    const cx = -sol[0] / 2, cy = -sol[1] / 2, R = Math.sqrt(cx * cx + cy * cy - sol[2]);
    const cc: V3 = [c0[0] + e1[0] * cx + e2[0] * cy, c0[1] + e1[1] * cx + e2[1] * cy, c0[2] + e1[2] * cx + e2[2] * cy];
    let circDev = 0;
    for (const c of cs) {
      const dx = c[0] - cc[0], dy = c[1] - cc[1], dz = c[2] - cc[2], z = dx * pn[0] + dy * pn[1] + dz * pn[2];
      circDev = Math.max(circDev, Math.hypot(Math.hypot(dx - z * pn[0], dy - z * pn[1], dz - z * pn[2]) - R, z));
    }
    if (R > 0 && circDev <= lim) return { surf: { kind: 'torus', c: cc, a: pn, R, r: h.r }, spine: 'circle' };
  }
  return { surf: null, spine: 'curve' };
}

/** The centre where the offsets of every face at depth s·r meet (least squares; Gauss-Newton from `start`). */
function ballMeeting(F: Oriented[], s: number, r: number, start: V3): V3 | null {
  let cx = start[0], cy = start[1], cz = start[2];
  const N = new Float64Array(3);
  for (let it = 0; it < 40; it++) {
    const A = [[1e-12, 0, 0], [0, 1e-12, 0], [0, 0, 1e-12]], b = [0, 0, 0];
    for (const f of F) {
      const res = dO(f, cx, cy, cz) + s * r;
      nO(f, cx, cy, cz, N, 0);
      for (let i = 0; i < 3; i++) { b[i] += N[i] * res; for (let j = 0; j < 3; j++) A[i][j] += N[i] * N[j]; }
    }
    const st = solve(A, b);
    if (!st) return null;
    cx -= st[0]; cy -= st[1]; cz -= st[2];
    if (Math.hypot(st[0], st[1], st[2]) < 1e-14 * span(r, cx, cy, cz)) break;
  }
  return Number.isFinite(cx + cy + cz) ? [cx, cy, cz] : null;
}

function piecesOf(m: Mesh, band: number[], owner: Int32Array, fromHyp: number): { hi: number; tris: number[] }[] {
  const byH = new Map<number, number[]>();
  for (const t of band) if (owner[t] >= fromHyp) { let l = byH.get(owner[t]); if (!l) byH.set(owner[t], (l = [])); l.push(t); }
  const out: { hi: number; tris: number[] }[] = [];
  for (const [hi, tris] of byH) for (const part of connectedIn(m, tris, (w) => owner[w] === hi)) out.push({ hi, tris: part });
  return out;
}

function connectedIn(m: Mesh, tris: number[], inSet: (t: number) => boolean): number[][] {
  const seen = new Set<number>(), out: number[][] = [];
  for (const t0 of tris) {
    if (seen.has(t0)) continue;
    const part = [t0];
    seen.add(t0);
    for (let i = 0; i < part.length; i++) for (let k = 0; k < 3; k++) {
      const w = m.adj[part[i] * 3 + k];
      if (w >= 0 && !seen.has(w) && inSet(w)) { seen.add(w); part.push(w); }
    }
    out.push(part);
  }
  return out;
}

function components(m: Mesh, tris: number[]): number[][] {
  const set = new Set(tris);
  return connectedIn(m, tris, (w) => set.has(w));
}

function vertsOf(m: Mesh, tris: number[]): number[] {
  const s = new Set<number>();
  for (const t of tris) for (let k = 0; k < 3; k++) s.add(m.tri[t * 3 + k]);
  return [...s];
}


function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.5 * s.length))];
}

function mean(cs: V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of cs) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return [c[0] / cs.length, c[1] / cs.length, c[2] / cs.length];
}


