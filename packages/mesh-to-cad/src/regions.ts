// Free-form areas as one sheet each. A smooth area bounded by sharp edges that is mostly
// free-form (a twisted fin side, read today as stripes of near-cylinders and scraps) is one face:
// one smooth sheet over the area's own plane, larger than the face, which the face's edges trim.
// Free-form scraps that touch each other are tried as one sheet the same way.

import { type V3, cross, dot, eigSym3, normalize } from './linalg';
import { type Mesh, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions } from './segment';
import { type BSplineFace } from './freeform';
import { basisAt, basisInto } from './bspline';
import { pieces } from './features';
import { SAG_SHARE, SHEET_OFF as SHEET_ALLOW_OFF, facetAllowance } from './sheetcheck';

/** The sharpest turn between two facets inside one smooth area. */
const SHARP = Math.cos((30 * Math.PI) / 180);
/** How far a sheet may stand off the area's vertices (mm). */
const SHEET_OFF = 5e-3;
/** The most a sheet may miss its vertices by (mm), and that as a share of its facets' typical sag. */
const SHEET_EDGE_MOST = 0.02, VERTEX_SAG_SHARE = 0.25;
/** The share of an area's triangles that must be free-form before the whole area is one sheet. */
const FREE_SHARE = 0.25;
/** The most control points one sheet may have. */
const MOST_CTRL = 900;
/** The steepest a facet may stand on a sheet's plane (cosine): steeper, a hair of height is a long way sideways. */
const STEEP = 0.25;
/** Steps along each side of a facet at which the sheet over it is checked. */
const FACET_STEPS = 4;
/** How many times the usual bending term a sheet that swells between its points is solved with, in turn. */
const STIFFER = [1, 1e2, 1e4];

/** The mesh cut at sharp edges: an area number per triangle. */
export function smoothAreas(m: Mesh): Int32Array {
  const nT = m.tri.length / 3, lab = new Int32Array(nT).fill(-1);
  let n = 0;
  for (let s = 0; s < nT; s++) {
    if (lab[s] >= 0) continue;
    lab[s] = n;
    const q = [s];
    while (q.length) {
      const t = q.pop()!;
      for (let k = 0; k < 3; k++) {
        const u = m.adj[t * 3 + k];
        if (u < 0 || lab[u] >= 0) continue;
        if (m.normal[t * 3] * m.normal[u * 3] + m.normal[t * 3 + 1] * m.normal[u * 3 + 1] + m.normal[t * 3 + 2] * m.normal[u * 3 + 2] >= SHARP) { lab[u] = n; q.push(u); }
      }
    }
    n++;
  }
  return lab;
}

/** Height-field sheets: where the sheet's plane is, for a quick first guess of the nearest point. */
export type Graph = { c: V3; e1: V3; e2: V3; n: V3; lo: [number, number]; hi: [number, number] };

function chol(A: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= A[j * n + k] ** 2;
    if (!(s > 1e-300)) return false;
    const d = Math.sqrt(s);
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) { let v = A[i * n + j]; for (let k = 0; k < j; k++) v -= A[i * n + k] * A[j * n + k]; A[i * n + j] = v / d; }
  }
  return true;
}
function cholBack(L: Float64Array, n: number, b: Float64Array): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let v = b[i]; for (let k = 0; k < i; k++) v -= L[i * n + k] * y[k]; y[i] = v / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let v = y[i]; for (let k = i + 1; k < n; k++) v -= L[k * n + i] * y[k]; y[i] = v / L[i * n + i]; }
  return y;
}
const uniform = (n: number) => { const U = [0, 0, 0, 0]; for (let i = 1; i < n - 3; i++) U.push(i / (n - 3)); U.push(1, 1, 1, 1); return U; };
/** Greville points of a clamped cubic knot vector: where a linear function's control points sit. */
const greville = (U: number[], n: number) => Array.from({ length: n }, (_, i) => (U[i + 1] + U[i + 2] + U[i + 3]) / 3);

/**
 * One sheet z(u, v) over the triangles' own best plane, or null if they do not stand over that
 * plane as a height field, or no net that the vertices can pin holds every vertex within SHEET_OFF
 * and every facet, between its corners, within that and the facet's own sag.
 */
export function heightSheet(m: Mesh, tris: number[]): { surf: BSplineFace; err: number } | null {
  const vs = [...new Set(tris.flatMap((t) => triVerts(m, t)))];
  if (vs.length < 4) return null;
  const pts = vs.map((v) => vtx(m.pos, v));
  const c: V3 = [0, 0, 0];
  for (const p of pts) for (let d = 0; d < 3; d++) c[d] += p[d] / pts.length;
  const C = new Array(9).fill(0);
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += (p[i] - c[i]) * (p[j] - c[j]);
  const { vectors } = eigSym3(C);
  const spread = vectors.map((e) => pts.reduce((s, p) => s + dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], e) ** 2, 0));
  const order = [0, 1, 2].sort((a, b) => spread[b] - spread[a]);
  const e1 = normalize(vectors[order[0]]), n = normalize(vectors[order[2]]), e2 = cross(n, e1);
  // Every facet must face the same way along the plane's normal.
  let sign = 0;
  for (const t of tris) {
    const d = m.normal[t * 3] * n[0] + m.normal[t * 3 + 1] * n[1] + m.normal[t * 3 + 2] * n[2];
    if (Math.abs(d) < STEEP) return null;
    if (!sign) sign = Math.sign(d); else if (Math.sign(d) !== sign) return null;
  }
  const loc = pts.map((p) => { const d: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [dot(d, e1), dot(d, e2), dot(d, n)]; });
  let lo: [number, number] = [Infinity, Infinity], hi: [number, number] = [-Infinity, -Infinity];
  for (const [x, y] of loc) { lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; }
  // A little larger than the face, so its edges fall inside the sheet.
  const wx = hi[0] - lo[0], wy = hi[1] - lo[1], pad = 0.03 * Math.max(wx, wy) + 1e-3;
  lo = [lo[0] - pad, lo[1] - pad]; hi = [hi[0] + pad, hi[1] + pad];
  const uv = loc.map(([x, y, z]) => [(x - lo[0]) / (hi[0] - lo[0]), (y - lo[1]) / (hi[1] - lo[1]), z]);
  // Where the vertices are far apart (a strip meshed only at its ends), the facets' edge middles
  // and centres hold the sheet to them too, gently: they sit on chords, inside the surface by the
  // facets' sag, which on a coarse mesh is far more than a hair, so they only steady the net.
  const soft: number[][] = [];
  const toUV = (p: V3) => { const d: V3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return [(dot(d, e1) - lo[0]) / (hi[0] - lo[0]), (dot(d, e2) - lo[1]) / (hi[1] - lo[1]), dot(d, n)]; };
  for (const t of tris) {
    const [a, b, q] = triVerts(m, t).map((v) => vtx(m.pos, v));
    soft.push(toUV([(a[0] + b[0] + q[0]) / 3, (a[1] + b[1] + q[1]) / 3, (a[2] + b[2] + q[2]) / 3]));
    for (const [x, y] of [[a, b], [b, q], [q, a]]) soft.push(toUV([(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2]));
  }
  const SOFT = 0.02;
  const aspect = (hi[0] - lo[0]) / (hi[1] - lo[1]);
  // Where the sheet is checked between its points: across every facet, each point with how far
  // the sheet may stand off the facet there (`facetAllowance`: the facet's own sag and a little more).
  const local = new Map(vs.map((v, k) => [v, k]));
  const allowed = facetAllowance(m, tris);
  // How closely the sheet must pass its vertices: SHEET_OFF, or on a coarse mesh a share of its
  // facets' typical sag (a mesh whose facets stand a tenth of a millimetre off the surface cannot
  // pin a fair sheet to five thousandths), never more than SHEET_EDGE_MOST.
  const sags = Array.from(allowed, (a) => (a - SHEET_ALLOW_OFF) / SAG_SHARE).sort((a, b) => a - b);
  const vertexTol = Math.max(SHEET_OFF, Math.min(SHEET_EDGE_MOST, VERTEX_SAG_SHARE * sags[sags.length >> 1]));
  const checks: number[] = [];
  for (const [f, t] of tris.entries()) {
    const [a, b, q] = triVerts(m, t);
    // Distance along the plane's normal, as distance from the facet's plane.
    const tilt = Math.abs(m.normal[t * 3] * n[0] + m.normal[t * 3 + 1] * n[1] + m.normal[t * 3 + 2] * n[2]);
    const A = uv[local.get(a)!], B = uv[local.get(b)!], C = uv[local.get(q)!];
    for (let i = 0; i <= FACET_STEPS; i++) for (let j = 0; i + j <= FACET_STEPS; j++) {
      const k = FACET_STEPS - i - j;
      if (i === FACET_STEPS || j === FACET_STEPS || k === FACET_STEPS) continue;
      const wa = i / FACET_STEPS, wb = j / FACET_STEPS, wc = k / FACET_STEPS;
      checks.push(wa * A[0] + wb * B[0] + wc * C[0], wa * A[1] + wb * B[1] + wc * C[1], wa * A[2] + wb * B[2] + wc * C[2], tilt, allowed[f]);
    }
  }
  const wu = new Float64Array(4), wv = new Float64Array(4);
  // A net no finer than its vertices can pin (four control points for each, a 4 by 4 net at the
  // least; the sparsest that passes is taken): with more freedom than that it passes every vertex
  // and is free to swell in between, and the check over the facets refuses it.
  const most = Math.min(MOST_CTRL, Math.max(16, 4 * vs.length));
  let best: { surf: BSplineFace; err: number } | null = null;
  const tried = new Set<number>();
  nets: for (const base of [4, 6, 9, 13, 18, 24, 32, 44]) {
    let nu = Math.max(4, Math.min(60, Math.round(base * Math.sqrt(aspect)))), nv = Math.max(4, Math.min(60, Math.round(base / Math.sqrt(aspect))));
    // A long thin patch is given fewer spans along its length rather than no net at all.
    while (nu * nv > most && Math.max(nu, nv) > 4) { if (nu >= nv) nu--; else nv--; }
    if (tried.has(nu * 1000 + nv)) break;
    tried.add(nu * 1000 + nv);
    const U = uniform(nu), V = uniform(nv), N = nu * nv;
    const bases = uv.map(([u, v]) => [basisAt(nu, 3, U, u), basisAt(nv, 3, V, v)] as const);
    const softBases = soft.map(([u, v]) => [basisAt(nu, 3, U, u), basisAt(nv, 3, V, v)] as const);
    // The sparsest net first, and on each net the lightest bending term first: stiffer only if the
    // sheet swells between its points, for as long as it still passes them.
    for (const stiff of STIFFER) {
      const A = new Float64Array(N * N), b = new Float64Array(N);
      const addData = (bu: { first: number; w: number[] }, bv: { first: number; w: number[] }, zv: number, weight: number) => {
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          const I = (bu.first + i) * nv + bv.first + j, w = weight * bu.w[i] * bv.w[j];
          b[I] += w * zv;
          for (let i2 = 0; i2 < 4; i2++) for (let j2 = 0; j2 < 4; j2++) A[I * N + (bu.first + i2) * nv + bv.first + j2] += w * bu.w[i2] * bv.w[j2];
        }
      };
      bases.forEach(([bu, bv], k) => addData(bu, bv, uv[k][2], 1));
      softBases.forEach(([bu, bv], k) => addData(bu, bv, soft[k][2], SOFT));
      // A bending term: spans with no vertex under them stay calm.
      const lam = stiff * 1e-5 * (bases.length + SOFT * soft.length) / N;
      const bend = (ids: number[]) => { const w = [1, -2, 1]; for (let a = 0; a < 3; a++) for (let c2 = 0; c2 < 3; c2++) A[ids[a] * N + ids[c2]] += lam * w[a] * w[c2]; };
      for (let i = 0; i < nu; i++) for (let j = 0; j + 2 < nv; j++) bend([i * nv + j, i * nv + j + 1, i * nv + j + 2]);
      for (let j = 0; j < nv; j++) for (let i = 0; i + 2 < nu; i++) bend([i * nv + j, (i + 1) * nv + j, (i + 2) * nv + j]);
      if (!chol(A, N)) continue;
      const z = cholBack(A, N, b);
      let err = 0;
      bases.forEach(([bu, bv], k) => {
        let s = 0;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += bu.w[i] * bv.w[j] * z[(bu.first + i) * nv + bv.first + j];
        err = Math.max(err, Math.abs(s - uv[k][2]));
      });
      // Stiffer only bends it further from its points.
      if (err > vertexTol) continue nets;
      let swells = false;
      for (let c = 0; c < checks.length && !swells; c += 5) {
        const fu = basisInto(nu, 3, U, Math.min(1, Math.max(0, checks[c])), wu), fv = basisInto(nv, 3, V, Math.min(1, Math.max(0, checks[c + 1])), wv);
        let s = 0;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += wu[i] * wv[j] * z[(fu + i) * nv + fv + j];
        if (Math.abs(s - checks[c + 2]) * checks[c + 3] > checks[c + 4]) swells = true;
      }
      if (swells) continue;
      const gu = greville(U, nu), gv = greville(V, nv);
      const ctrl = gu.map((u, i) => gv.map((v, j) => {
        const x = lo[0] + u * (hi[0] - lo[0]), y = lo[1] + v * (hi[1] - lo[1]), h = z[i * nv + j];
        return [c[0] + e1[0] * x + e2[0] * y + n[0] * h, c[1] + e1[1] * x + e2[1] * y + n[1] * h, c[2] + e1[2] * x + e2[2] * y + n[2] * h];
      }));
      const places = new Map<number, [number, number]>();
      vs.forEach((v, k) => places.set(v, [uv[k][0], uv[k][1]]));
      best = { surf: { kind: 'bspline', degU: 3, degV: 3, knotsU: U, knotsV: V, ctrl, places, graph: { c, e1, e2, n, lo, hi } }, err };
      break nets;
    }
  }
  return best;
}

/**
 * One sheet over the triangles, or failing that, sheets over halves cut across their longest
 * direction (up to three cuts deep): a twisted area that stands over no single plane does over
 * each part. Null when some part takes no sheet.
 */
export function sheetsOver(m: Mesh, tris: number[], depth = 0): Region[] | null {
  const one = heightSheet(m, tris);
  if (one) return [{ tris, surf: one.surf, err: one.err }];
  if (depth >= 3 || tris.length < 8) return null;
  const cs = tris.map((t) => { const v = triVerts(m, t).map((i) => vtx(m.pos, i)); return [0, 1, 2].map((d) => (v[0][d] + v[1][d] + v[2][d]) / 3) as V3; });
  const c: V3 = [0, 0, 0];
  for (const p of cs) for (let d = 0; d < 3; d++) c[d] += p[d] / cs.length;
  const C = new Array(9).fill(0);
  for (const p of cs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += (p[i] - c[i]) * (p[j] - c[j]);
  const { vectors } = eigSym3(C);
  const spread = vectors.map((e) => cs.reduce((s2, p) => s2 + dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], e) ** 2, 0));
  const axis = vectors[spread.indexOf(Math.max(...spread))];
  const side = cs.map((p) => dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], axis) >= 0);
  const out: Region[] = [];
  for (const half of [tris.filter((_, i) => side[i]), tris.filter((_, i) => !side[i])]) {
    for (const part of pieces(m, half)) {
      const got = sheetsOver(m, part, depth + 1);
      if (!got) return null;
      out.push(...got);
    }
  }
  return out;
}

/**
 * As `sheetsOver`, but a part that takes no sheet is handed back (`left`) instead of failing the
 * whole: the sheets that did fit are kept.
 */
export function someSheets(m: Mesh, tris: number[], depth = 0): { sheets: Region[]; left: number[] } {
  const one = tris.length >= 2 ? heightSheet(m, tris) : null;
  if (one) return { sheets: [{ tris, surf: one.surf, err: one.err }], left: [] };
  if (depth >= 3 || tris.length < 8) return { sheets: [], left: tris };
  const out = { sheets: [] as Region[], left: [] as number[] };
  for (const half of halves(m, tris)) for (const part of pieces(m, half)) {
    const got = someSheets(m, part, depth + 1);
    out.sheets.push(...got.sheets);
    out.left.push(...got.left);
  }
  return out;
}

/**
 * The triangles in two halves: by which way they face, where they face too many ways to stand over
 * one plane (a strip wrapped round a strand stays wrapped however often it is cut along its
 * length); otherwise cut square to the direction they spread furthest along.
 */
function halves(m: Mesh, tris: number[]): [number[], number[]] {
  const N = new Array(9).fill(0);
  for (const t of tris) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) N[i * 3 + j] += m.area[t] * m.normal[t * 3 + i] * m.normal[t * 3 + j];
  const ns = eigSym3(N);
  const order = [0, 1, 2].sort((a, b) => ns.values[b] - ns.values[a]);
  const main = ns.vectors[order[0]], across = ns.vectors[order[1]];
  if (tris.some((t) => Math.abs(m.normal[t * 3] * main[0] + m.normal[t * 3 + 1] * main[1] + m.normal[t * 3 + 2] * main[2]) < STEEP)) {
    const by = tris.map((t) => m.normal[t * 3] * across[0] + m.normal[t * 3 + 1] * across[1] + m.normal[t * 3 + 2] * across[2]);
    const mid = [...by].sort((a, b) => a - b)[by.length >> 1];
    return [tris.filter((_, i) => by[i] < mid), tris.filter((_, i) => by[i] >= mid)];
  }
  const cs = tris.map((t) => { const v = triVerts(m, t).map((i) => vtx(m.pos, i)); return [0, 1, 2].map((d) => (v[0][d] + v[1][d] + v[2][d]) / 3) as V3; });
  const c: V3 = [0, 0, 0];
  for (const p of cs) for (let d = 0; d < 3; d++) c[d] += p[d] / cs.length;
  const C = new Array(9).fill(0);
  for (const p of cs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += (p[i] - c[i]) * (p[j] - c[j]);
  const { vectors } = eigSym3(C);
  const spread = vectors.map((e) => cs.reduce((s2, p) => s2 + dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], e) ** 2, 0));
  const axis = vectors[spread.indexOf(Math.max(...spread))];
  const side = cs.map((p) => dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], axis) >= 0);
  return [tris.filter((_, i) => side[i]), tris.filter((_, i) => !side[i])];
}

/**
 * Smooth areas that are mostly free-form become one sheet each (the faces inside them give up
 * their triangles there); then free-form faces that touch are tried as one sheet, then alone.
 * What takes no sheet stays free-form for the old fitter.
 */
export function sheetAreas(m: Mesh, faces: Region[], _opt: SegmentOptions): Region[] {
  const nT = m.tri.length / 3;
  const area = smoothAreas(m);
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const isFree = (i: number) => !faces[i].surf || (faces[i].surf!.kind === 'bspline' && !(faces[i].surf as BSplineFace).pipe);
  const byArea = new Map<number, number[]>();
  for (let t = 0; t < nT; t++) { const a = area[t]; if (!byArea.has(a)) byArea.set(a, []); byArea.get(a)!.push(t); }
  const taken = new Uint8Array(nT);
  const made: Region[] = [];
  for (const tris of byArea.values()) {
    if (tris.length < 4) continue;
    // A face decided before this reading keeps its triangles.
    if (tris.some((t) => label[t] >= 0 && faces[label[t]].keep)) continue;
    // Free-form here means a free-form face or a piece of three triangles or fewer: a twisted
    // fin meshed as flat quads is free-form, however exactly flat each quad is.
    const free = tris.filter((t) => isFree(label[t]) || faces[label[t]].tris.length <= 3).length;
    if (free < FREE_SHARE * tris.length) continue;
    // Round pieces made into one sheet already belong to their chain.
    if (tris.some((t) => faces[label[t]].surf?.kind === 'bspline' && (faces[label[t]].surf as BSplineFace).pipe)) continue;
    const sheets = sheetsOver(m, tris);
    if (!sheets) continue;
    for (const t of tris) taken[t] = 1;
    made.push(...sheets);
  }
  // What is left of each face once the areas took their triangles.
  const rest: Region[] = [];
  for (const f of faces) {
    const left = f.tris.filter((t) => !taken[t]);
    if (!left.length) continue;
    if (left.length === f.tris.length) { rest.push(f); continue; }
    for (const part of pieces(m, left)) rest.push({ ...f, tris: part });
  }
  // Free-form faces that touch: one sheet if they take one.
  const lab2 = new Int32Array(nT).fill(-1);
  rest.forEach((f, i) => f.tris.forEach((t) => (lab2[t] = i)));
  const free2 = rest.map((f) => !f.surf && !f.keep);
  const seen = new Uint8Array(rest.length), out: Region[] = [];
  rest.forEach((f, i) => {
    if (!free2[i]) { out.push(f); return; }
    if (seen[i]) return;
    const group = [i];
    seen[i] = 1;
    for (let x = 0; x < group.length; x++) for (const t of rest[group[x]].tris) for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w < 0) continue;
      const j = lab2[w];
      if (j >= 0 && free2[j] && !seen[j]) { seen[j] = 1; group.push(j); }
    }
    const all = group.flatMap((g) => rest[g].tris);
    const sheets = sheetsOver(m, all);
    if (sheets) { out.push(...sheets); return; }
    // Alone, then; what takes no sheet alone stays one free-form area with its free neighbours,
    // so the fitter is handed the area and not one triangle at a time.
    const unsheeted: number[] = [];
    for (const g of group) {
      const own = sheetsOver(m, rest[g].tris);
      if (own) out.push(...own);
      else for (const t of rest[g].tris) unsheeted.push(t);
    }
    for (const part of pieces(m, unsheeted)) out.push({ tris: part, surf: null, err: 0 });
  });
  return [...out, ...made];
}
