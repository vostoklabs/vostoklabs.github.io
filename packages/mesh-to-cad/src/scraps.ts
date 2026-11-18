// What no sheet took. A free-form face can come back from the sheets with triangles no fitted sheet
// would hold. They are never handed back to the one-triangle flats they were first found as: a row
// of long thin facets between two rails is one sheet through the rails; a piece that stands over
// a plane is a height sheet (or a few); a needle or a speck that lies on a neighbour's surface joins
// that neighbour; and what still has no surface is kept as few flat faces as it can be, every set
// of exactly coplanar facets side by side one face.

import { type Mesh, triNormal, triVerts, vtx } from './mesh';
import { type Region } from './segment';
import { type Surface, distance, fitPlane } from './surfaces';
import { dist, dot } from './linalg';
import { railSheet } from './railsheet';
import { heightSheet, someSheets } from './regions';
import { type BSplineFace } from './freeform';

/** How far a sheet through rails may stand off its facets (mm), as for every other sheet. */
const SHEET_OFF = 0.02;
/** A needle: narrower than this and longer than NEEDLE_LONG (mm). */
const NEEDLE_WIDE = 0.05, NEEDLE_LONG = 1;
/** A speck: this many triangles at most, and under this area (mm²). */
const SPECK_TRIS = 3, SPECK_AREA = 0.01;
/** How far a needle's or speck's vertices may sit off the neighbour it joins (mm). */
const JOIN_FIT = 1e-3;
/** The largest sheet refitted to take a piece beside it (triangles): past it the refit costs more than the piece is worth. */
const JOIN_MOST = 3000;

/**
 * Faces for the triangles no sheet took (`left`), given the faces already made (`faces`, which
 * needles and specks may join). Returns the faces with the joins made and the new faces added, and
 * how many of those are facets left flat because nothing would hold them.
 */
export function coverScraps(m: Mesh, faces: Region[], left: number[], eps: number): { faces: Region[]; facets: number } {
  if (!left.length) return { faces, facets: 0 };
  const made: Region[] = [];
  let rest: number[] = [];
  // Pieces of one smooth stretch: a sheet never carries over a sharp fold.
  const parts = smoothParts(m, left);
  for (const part of parts) {
    // A row of facets between two rails.
    const rails = part.length >= 2 ? railSheet(m, part) : null;
    if (rails && rails.off <= SHEET_OFF) {
      const out = new Set(rails.left);
      const kept = part.filter((t) => !out.has(t));
      if (kept.length) {
        made.push({ tris: kept, surf: { ...rails.surf, places: rails.params }, err: 0 });
        for (const t of rails.left) rest.push(t);
        continue;
      }
    }
    // A piece standing over a plane, whole or in parts.
    const got = someSheets(m, part);
    for (const g of got.sheets) made.push(g);
    for (const t of got.left) rest.push(t);
  }
  // Rows inside what the height sheets left of a piece (a piece left whole was tried already).
  if (rest.length) {
    const tried = new Set(parts.map((p) => `${p.length}:${p.reduce((a, b) => Math.min(a, b))}`));
    const again: number[] = [];
    for (const part of smoothParts(m, rest)) {
      const rails = part.length >= 2 && !tried.has(`${part.length}:${part.reduce((a, b) => Math.min(a, b))}`) ? railSheet(m, part) : null;
      if (rails && rails.off <= SHEET_OFF && !rails.left.length) made.push({ tris: part, surf: { ...rails.surf, places: rails.params }, err: 0 });
      else for (const t of part) again.push(t);
    }
    rest = again;
  }
  const all = [...faces, ...made];
  if (!rest.length) return { faces: all, facets: 0 };
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  all.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const P = (v: number) => vtx(m.pos, v);
  // A piece beside a sheet over a plane is often the same surface run on, refused only for being
  // too little to hold a sheet of its own: one sheet fitted to both, as honestly checked as any,
  // takes it. Neighbours by the length of border shared, longest first.
  const still: number[] = [];
  for (const part of smoothParts(m, rest)) {
    const own = new Set(part), border = new Map<number, number>();
    for (const t of part) for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (w < 0 || own.has(w) || label[w] < 0) continue;
      const s = all[label[w]].surf;
      if (s?.kind !== 'bspline' || !(s as BSplineFace).graph || all[label[w]].tris.length > JOIN_MOST) continue;
      border.set(label[w], (border.get(label[w]) ?? 0) + dist(P(m.tri[t * 3 + k]), P(m.tri[t * 3 + ((k + 1) % 3)])));
    }
    let joined = false;
    for (const [j] of [...border].sort((a, b) => b[1] - a[1])) {
      const both = [...all[j].tris, ...part];
      const sheet = heightSheet(m, both);
      if (!sheet) continue;
      all[j] = { tris: both, surf: sheet.surf, err: sheet.err };
      for (const t of part) label[t] = j;
      joined = true;
      break;
    }
    if (!joined) for (const t of part) still.push(t);
  }
  if (!still.length) return { faces: all, facets: 0 };
  // The rest as flat units: facets side by side in one plane.
  const units = flatUnits(m, still, eps);
  const flats: Region[] = [];
  for (const unit of units) {
    // A needle or a speck joins the neighbour it shares the longest border with, if that
    // neighbour's surface holds its vertices.
    // Its mean width is twice its area over its outline, its length half the outline.
    const area = unit.reduce((a, t) => a + m.area[t], 0);
    const vs = [...new Set(unit.flatMap((t) => triVerts(m, t)))];
    const own = new Set(unit), border = new Map<number, number>();
    let outline = 0;
    for (const t of unit) for (let k = 0; k < 3; k++) {
      const w = m.adj[t * 3 + k];
      if (own.has(w)) continue;
      const len = dist(P(m.tri[t * 3 + k]), P(m.tri[t * 3 + ((k + 1) % 3)]));
      outline += len;
      if (w >= 0 && label[w] >= 0) border.set(label[w], (border.get(label[w]) ?? 0) + len);
    }
    const needle = outline / 2 >= NEEDLE_LONG && (2 * area) / outline < NEEDLE_WIDE;
    const speck = unit.length <= SPECK_TRIS && area < SPECK_AREA;
    if (needle || speck) {
      const by = [...border].sort((a, b) => b[1] - a[1])[0];
      if (by && all[by[0]].surf) {
        const s = all[by[0]].surf as Surface;
        let off = 0;
        for (const v of vs) { off = Math.max(off, Math.abs(distance(s, P(v)))); if (off > JOIN_FIT) break; }
        if (off <= JOIN_FIT) {
          const f = all[by[0]];
          f.tris = [...f.tris, ...unit];
          f.err = Math.max(f.err, off);
          for (const t of unit) label[t] = by[0];
          continue;
        }
      }
    }
    const plane = fitPlane(vs.map(P));
    let err = 0;
    for (const v of vs) err = Math.max(err, Math.abs(distance(plane, P(v))));
    flats.push({ tris: unit, surf: plane, err });
  }
  return { faces: [...all, ...flats], facets: flats.length };
}

/** Facets that lie in one plane (within eps), side by side, as sets. */
export function flatUnits(m: Mesh, tris: number[], eps: number): number[][] {
  const inSet = new Set(tris), done = new Set<number>(), out: number[][] = [];
  for (const t0 of tris) {
    if (done.has(t0)) continue;
    const n0 = triNormal(m, t0), o = vtx(m.pos, m.tri[t0 * 3]);
    const unit = [t0];
    done.add(t0);
    for (let i = 0; i < unit.length; i++) for (let k = 0; k < 3; k++) {
      const w = m.adj[unit[i] * 3 + k];
      if (w < 0 || !inSet.has(w) || done.has(w) || dot(triNormal(m, w), n0) < 1 - 1e-8) continue;
      if (triVerts(m, w).every((v) => { const p = vtx(m.pos, v); return Math.abs((p[0] - o[0]) * n0[0] + (p[1] - o[1]) * n0[1] + (p[2] - o[2]) * n0[2]) <= eps; })) { done.add(w); unit.push(w); }
    }
    out.push(unit);
  }
  return out;
}

/** The sharpest turn between two facets one sheet may carry over (cosine). */
const SMOOTH = Math.cos((30 * Math.PI) / 180);

/** Connected pieces of the triangles, joined only across edges that turn less than SMOOTH. */
export function smoothParts(m: Mesh, tris: number[]): number[][] {
  const inSet = new Set(tris), seen = new Set<number>(), out: number[][] = [];
  for (const t0 of tris) {
    if (seen.has(t0)) continue;
    const part = [t0];
    seen.add(t0);
    for (let i = 0; i < part.length; i++) for (let k = 0; k < 3; k++) {
      const w = m.adj[part[i] * 3 + k];
      if (w < 0 || !inSet.has(w) || seen.has(w) || dot(triNormal(m, part[i]), triNormal(m, w)) < SMOOTH) continue;
      seen.add(w);
      part.push(w);
    }
    out.push(part);
  }
  return out;
}
