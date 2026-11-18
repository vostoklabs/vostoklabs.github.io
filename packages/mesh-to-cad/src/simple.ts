// Faces that are one simple face: neighbours whose triangles together lie on one plane,
// cylinder, cone, sphere or torus, to the point tolerance.
//
// The face finder reads a face piece by piece, and a piece too narrow to show its own surface
// gets a surface of its own size: the strips of a straight round each read as a different thin
// cylinder, side by side. Together they show the one surface they are all on. So each face, the
// largest first, takes the smooth neighbours that lie on its surface as it is, and then those
// that fit one surface with it when the two are fitted together. Two large faces that each hold
// their own points exactly are left alone: if they were one surface, the list of surfaces has
// already made them one face.
//
// Nothing here makes a surface that was not there: a join is kept only if one plane, cylinder,
// cone, sphere or torus holds every vertex of it within the point tolerance.

import { dot } from './linalg';
import { type Mesh, triCentroid, triNormal, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions, fitTris } from './segment';
import { type Analytic, type Surface, distance } from './surfaces';

/** A face this many triangles or fewer has not shown its surface on its own, and may be refitted with a neighbour. */
const SMALL = 60;
/** The most triangles a join may hold: a fit of more takes long and is never what a strip needs. */
const MOST = 6000;
/** Fits tried on one part before the rest are left as they are (each is a least-squares solve). */
const TRIES = 4000;
/** The fewest vertices a fit is believed on; fewer are gathered on trust and dropped if no fit comes. */
const LEAST = 12;
/** A torus has more freedom than the others: it needs more points before it is believed. */
const LEAST_TORUS = 18;

const KINDS_CURVED: Analytic['kind'][] = ['cylinder', 'cone', 'sphere', 'torus'];
const simpleKind = (s: Surface | null): s is Analytic =>
  s !== null && (s.kind === 'plane' || s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'sphere' || s.kind === 'torus');

export function joinSimple<R extends Region>(m: Mesh, regions: R[], opt: SegmentOptions): R[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  regions.forEach((r, i) => r.tris.forEach((t) => (label[t] = i)));
  const cosSmooth = Math.cos(opt.smoothAngle);
  const nbrs: Set<number>[] = regions.map(() => new Set());
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    if (w < 0 || label[w] === label[t] || label[w] < 0 || label[t] < 0) continue;
    if (dot(triNormal(m, t), triNormal(m, w)) < cosSmooth) continue;
    nbrs[label[t]].add(label[w]);
  }
  const P = (v: number) => vtx(m.pos, v);
  const vertsOf = (tris: number[]) => [...new Set(tris.flatMap((t) => triVerts(m, t)))];
  /** Whether the triangles lie on s: every vertex within the tolerance, every middle within the chord. */
  const holds = (s: Surface, tris: number[]) => {
    for (const t of tris) {
      for (const v of triVerts(m, t)) if (Math.abs(distance(s, P(v))) > opt.eps) return false;
      if (Math.abs(distance(s, triCentroid(m, t))) > opt.chord) return false;
    }
    return true;
  };
  const exact = regions.map((r) => simpleKind(r.surf) && vertsOf(r.tris).every((v) => Math.abs(distance(r.surf!, P(v))) <= opt.eps));
  const flat = (i: number) => regions[i].surf?.kind === 'plane';

  const owner = regions.map((_, i) => i);
  const members: number[][] = regions.map((_, i) => [i]);
  const surf: (Surface | null)[] = regions.map((r) => r.surf);
  const err = regions.map((r) => r.err);
  let tries = 0;

  const order = regions.map((_, i) => i).filter((i) => simpleKind(regions[i].surf)).sort((a, b) => regions[b].tris.length - regions[a].tris.length);
  for (const seed of order) {
    if (owner[seed] !== seed || tries >= TRIES) continue;
    let tris = [...regions[seed].tris];
    let cur: Surface = surf[seed]!;
    let curErr = err[seed];
    const verts = new Set(vertsOf(tris));
    // A facet's own plane says nothing about the surface it stands for; any other face's does.
    let fitted = !(flat(seed) && regions[seed].tris.length <= 3);
    // A real flat face is never part of a curved one: it only takes facets lying in its plane.
    const planeFace = flat(seed) && fitted;
    const inJoin = new Set([seed]);
    const tried = new Set<number>();
    for (let grew = true; grew && tries < TRIES;) {
      grew = false;
      const frontier = [...new Set([...inJoin].flatMap((i) => [...nbrs[i]]))]
        .filter((j) => !inJoin.has(j) && owner[j] === j && members[j].length === 1 && !tried.has(j) && simpleKind(regions[j].surf))
        .sort((a, b) => regions[b].tris.length - regions[a].tris.length);
      for (const j of frontier) {
        if (tries >= TRIES) break;
        const r = regions[j];
        // A flat face is never part of a curved one, and two coplanar ones were joined already.
        if (flat(j) && r.tris.length > 3) { tried.add(j); continue; }
        // A large face that holds its own surface exactly is a face of its own beside a large one.
        if (r.tris.length > SMALL && exact[j] && tris.length > SMALL && fitted) { tried.add(j); continue; }
        if (tris.length + r.tris.length > MOST) { tried.add(j); continue; }
        // More of the same surface: nothing to fit.
        if (fitted && holds(cur, r.tris)) {
          tris = tris.concat(r.tris);
          for (const v of vertsOf(r.tris)) verts.add(v);
          inJoin.add(j);
          grew = true;
          continue;
        }
        // A face that has shown its surface only takes what lies on it: refitting is for pieces
        // too small to have shown one (and once enough strips are joined, the rest lie on it).
        if (planeFace || (fitted && tris.length > SMALL)) { tried.add(j); continue; }
        const union = tris.concat(r.tris);
        const nv = new Set([...verts, ...vertsOf(r.tris)]).size;
        if (!fitted && nv < LEAST) {
          // Too few points to say anything yet: gathered on trust, given back if no fit comes.
          tris = union;
          for (const v of vertsOf(r.tris)) verts.add(v);
          inJoin.add(j);
          grew = true;
          continue;
        }
        tries++;
        const fit = fitTris(m, union, opt, KINDS_CURVED);
        if (!fit || (fit.surf.kind === 'torus' && nv < LEAST_TORUS)) { tried.add(j); continue; }
        tris = union;
        for (const v of vertsOf(r.tris)) verts.add(v);
        inJoin.add(j);
        cur = fit.surf;
        curErr = fit.err;
        fitted = true;
        grew = true;
      }
    }
    // Pieces taken on trust are given back if nothing ever fitted them.
    if (!fitted || inJoin.size === 1) continue;
    for (const j of inJoin) if (j !== seed) { owner[j] = seed; members[seed].push(j); }
    surf[seed] = cur;
    err[seed] = curErr;
  }

  const out: R[] = [];
  regions.forEach((r, i) => {
    if (owner[i] !== i) return;
    if (members[i].length === 1) { out.push(r); return; }
    out.push({ ...r, tris: members[i].flatMap((j) => regions[j].tris), surf: surf[i], err: err[i] });
  });
  return out;
}

/** Two strips of one round have the same radius to this share of it, or to ten point tolerances. */
const SAME_RADIUS = 2e-3;
/** And their axes turn by no more than this from one strip to the next (radians). */
const RUN_TURN = (10 * Math.PI) / 180;

/**
 * A round swept along a curve that is not a circle (round the edge of an oval) is no simple
 * surface, and the face finder reads it strip by strip, each a thin cylinder of the round's own
 * radius with its axis turned a little from the last: hundreds of faces where the design has
 * one. Neighbouring small cylinders of one radius, their axes turning gently, are joined: one
 * simple surface if one holds them all, and otherwise one free-form face (null), to get a single
 * sheet.
 */
export function joinRuns(m: Mesh, faces: Region[], opt: SegmentOptions): Region[] {
  const nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const strip = (i: number) => faces[i].surf?.kind === 'cylinder' && faces[i].tris.length <= SMALL;
  const parent = faces.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const cosSmooth = Math.cos(opt.smoothAngle), cosTurn = Math.cos(RUN_TURN);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k], i = label[t], j = label[w];
    if (w < 0 || i === j || i < 0 || j < 0 || !strip(i) || !strip(j)) continue;
    if (dot(triNormal(m, t), triNormal(m, w)) < cosSmooth) continue;
    const a = faces[i].surf as { r: number; a: [number, number, number] }, b = faces[j].surf as typeof a;
    if (Math.abs(a.r - b.r) > Math.max(SAME_RADIUS * a.r, 10 * opt.eps)) continue;
    if (Math.abs(dot(a.a, b.a)) < cosTurn) continue;
    parent[root(i)] = root(j);
  }
  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => { const g = root(i); groups.set(g, [...(groups.get(g) ?? []), i]); });
  const out: Region[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) { out.push(faces[members[0]]); continue; }
    const tris = members.flatMap((i) => faces[i].tris);
    const fit = tris.length <= MOST ? fitTris(m, tris, opt, KINDS_CURVED) : null;
    out.push({ tris, surf: fit?.surf ?? null, err: fit?.err ?? 0 });
  }
  return out;
}
