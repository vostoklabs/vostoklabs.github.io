// Whether a sheet holds between its points. A sheet is fitted to points of the mesh, and a net with
// more freedom than its points can pin passes every one of them and swells in between, or runs
// short of a facet that it should cover. So it is looked at over every facet it stands for: points
// of the facet against the nearest point of the sheet, and the sheet itself over the facet's stretch
// of it against the facet's plane. Each facet may stand off the surface it was cut from by its own
// sag, and the sheet may stand that far off it and a little more, no further.

import { type Mesh, triVerts, vtx } from './mesh';
import { type SplineSurface, closestInto, surfaceHit, surfacePointInto } from './bspline';

/** How far beyond its facets' own sag a sheet may stand off them (mm). */
export const SHEET_OFF = 0.02;
/** How many times its sag a facet may stand off a fair sheet. */
export const SAG_SHARE = 1;
/** Steps along each side of a facet at which it is looked at. */
const STEPS = 3;

/**
 * How far a sheet may stand off each facet (mm, in the order of `tris`). A facet standing for a
 * curve lies off it by its own sag: a surface bending by k lies k L² / 8 off a facet L across. The
 * bend is read from the facet's neighbourhood in the patch (the patch is one smooth face, bounded
 * by the creases the reading found, however coarse its mesh): a vertex a distance r from the
 * facet's middle, along its plane, that stands h off that plane shows a bend of 2 h / r². The
 * largest over the vertices of the facets around its corners, and over the facets beside it, is
 * its sag; it may stand SAG_SHARE times that, and SHEET_OFF more, off a fair sheet. Measured
 * against the true surfaces of test parts at both densities, the true face stands within 0.83
 * of this sag (and SHEET_OFF) of every facet, except where a coarse torus meets a cone tangentially.
 */
export function facetAllowance(m: Mesh, tris: number[]): Float64Array {
  const index = new Map(tris.map((t, f) => [t, f]));
  const around = new Map<number, number[]>();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = m.tri[t * 3 + k];
    const list = around.get(v);
    if (list) list.push(t); else around.set(v, [t]);
  }
  let sag = new Float64Array(tris.length);
  const seen = new Set<number>();
  tris.forEach((t, f) => {
    const a = m.tri[t * 3], b = m.tri[t * 3 + 1], c = m.tri[t * 3 + 2];
    const n0 = m.normal[t * 3], n1 = m.normal[t * 3 + 1], n2 = m.normal[t * 3 + 2];
    const cx = (m.pos[a * 3] + m.pos[b * 3] + m.pos[c * 3]) / 3, cy = (m.pos[a * 3 + 1] + m.pos[b * 3 + 1] + m.pos[c * 3 + 1]) / 3, cz = (m.pos[a * 3 + 2] + m.pos[b * 3 + 2] + m.pos[c * 3 + 2]) / 3;
    let L = 0;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) L = Math.max(L, Math.hypot(m.pos[x * 3] - m.pos[y * 3], m.pos[x * 3 + 1] - m.pos[y * 3 + 1], m.pos[x * 3 + 2] - m.pos[y * 3 + 2]));
    seen.clear();
    seen.add(a); seen.add(b); seen.add(c);
    for (const v0 of [a, b, c]) for (const u of around.get(v0)!) for (let k = 0; k < 3; k++) {
      const v = m.tri[u * 3 + k];
      if (seen.has(v)) continue;
      seen.add(v);
      const dx = m.pos[v * 3] - cx, dy = m.pos[v * 3 + 1] - cy, dz = m.pos[v * 3 + 2] - cz;
      const h = Math.abs(dx * n0 + dy * n1 + dz * n2), r2 = dx * dx + dy * dy + dz * dz - h * h;
      if (r2 > 0) sag[f] = Math.max(sag[f], ((2 * h) / r2) * (L * L) / 8);
    }
  });
  const next = sag.slice();
  tris.forEach((t, f) => {
    for (let k = 0; k < 3; k++) { const g = index.get(m.adj[t * 3 + k]); if (g !== undefined) next[f] = Math.max(next[f], sag[g]); }
  });
  return next.map((s) => SHEET_OFF + SAG_SHARE * s);
}

/**
 * How far the sheet stands off the facets beyond what each may (mm; zero or less: it holds).
 * `params`: each vertex's place on the sheet; a facet with a corner that has none is looked at
 * from its points only.
 */
export function standsOff(m: Mesh, tris: number[], surf: SplineSurface, params: Map<number, [number, number]>): number {
  const hit = surfaceHit(), at = new Float64Array(3);
  const lo = [surf.knotsU[0], surf.knotsV[0]], hi = [surf.knotsU[surf.knotsU.length - 1], surf.knotsV[surf.knotsV.length - 1]];
  const allowed = facetAllowance(m, tris);
  let worst = -Infinity;
  for (let f = 0; f < tris.length; f++) {
    const t = tris[f], vs = triVerts(m, t);
    const allow = allowed[f];
    const A = vtx(m.pos, vs[0]), B = vtx(m.pos, vs[1]), C = vtx(m.pos, vs[2]);
    const pa = params.get(vs[0]), pb = params.get(vs[1]), pc = params.get(vs[2]);
    const placed = !!(pa && pb && pc);
    const n0 = m.normal[t * 3], n1 = m.normal[t * 3 + 1], n2 = m.normal[t * 3 + 2];
    for (let i = 0; i <= STEPS; i++) for (let j = 0; i + j <= STEPS; j++) {
      const k = STEPS - i - j;
      if (i === STEPS || j === STEPS || k === STEPS) continue;
      const wa = i / STEPS, wb = j / STEPS, wc = k / STEPS;
      const p = [wa * A[0] + wb * B[0] + wc * C[0], wa * A[1] + wb * B[1] + wc * C[1], wa * A[2] + wb * B[2] + wc * C[2]];
      const start: [number, number] | undefined = placed
        ? [Math.min(hi[0], Math.max(lo[0], wa * pa![0] + wb * pb![0] + wc * pc![0])), Math.min(hi[1], Math.max(lo[1], wa * pa![1] + wb * pb![1] + wc * pc![1]))]
        : undefined;
      const c = closestInto(surf, p, start, hit).d;
      let off = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
      if (start) {
        surfacePointInto(surf, start[0], start[1], at);
        off = Math.max(off, Math.abs((at[0] - A[0]) * n0 + (at[1] - A[1]) * n1 + (at[2] - A[2]) * n2));
      }
      worst = Math.max(worst, off - allow);
    }
  }
  return Math.max(worst, folds(tris, m, params) ? FOLDED : -Infinity);
}

/** What a folded sheet counts as standing off its facets (mm): refused, whatever else it holds. */
const FOLDED = 1;

/**
 * Whether the sheet's own parameters fold over its facets: the facets' corners, at their places on
 * the sheet, turn one way for some facets and the other way for others. A face can only be trimmed
 * by a loop drawn in those parameters, and on a folded sheet its outline crosses itself there,
 * however the edges are drawn: an importer cuts it into pieces that leave the solid.
 */
function folds(tris: number[], m: Mesh, params: Map<number, [number, number]>): boolean {
  let pos = 0, neg = 0;
  for (const t of tris) {
    const vs = triVerts(m, t);
    const a = params.get(vs[0]), b = params.get(vs[1]), c = params.get(vs[2]);
    if (!a || !b || !c) continue;
    const s = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (s > 0) pos++; else if (s < 0) neg++;
  }
  return pos > 0 && neg > 0;
}
