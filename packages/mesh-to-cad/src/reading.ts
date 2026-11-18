// The order the faces are decided in, each decision made once:
//
//   1. the mesh's own structure (regions, edge strengths, the part's tolerances, the kind of mesh);
//   2. the exact main faces, from the mesh's regions and the segmenter's seeds;
//   3. rounds and ball corners rolled between the main faces;
//   4. what is left, read the way the engine has always read it.
//
// A mesh that is not a CAD export (no exactly flat faces, or flat caps closed by fans) is read by
// the engine's reading as a whole, exactly as before.

import { type Mesh } from './mesh';
import { distance } from './surfaces';
import { type Region, type SegmentOptions, segment } from './segment';
import { sweptFaces } from './profile';
import { listSurfaces } from './listed';
import { joinSimple } from './simple';
import { pieces } from './features';
import { type Structure, readStructure } from './structure';
import { type MainFace, designOn, mainFaces, settle } from './mainfaces';
import { rollRounds } from './rolling';

/** The segmenter's faces: analytic faces, revolved and extruded ones, one list of surfaces, simple faces joined. */
export function seedFaces(mesh: Mesh, opt: SegmentOptions, progress: (share: number) => void = () => {}, onSwept: () => void = () => {}): Region[] {
  const segmented = segment(mesh, opt, progress).regions;
  onSwept();
  const swept = sweptFaces(mesh, segmented, opt) as Region[];
  const listed = listSurfaces(mesh, swept, { ...opt, alone: true }).regions;
  return joinSimple(mesh, listed, opt);
}

export type MainFirst = {
  structure: Structure;
  /** Null when the mesh is not a CAD export: the engine's reading takes the whole part. */
  main: MainFace[] | null;
  /** Rounds and ball corners rolled between the main faces. */
  rounds: Region[];
  /** The main faces and rounds: final, no later pass takes a triangle from them or gives one to them. */
  frozen: Region[];
  /** The triangles in no frozen face, and the seeds' pieces on them: what today's reading reads. */
  left: number[];
  start: Region[];
};

/**
 * Steps 1 to 3. The main faces, then the rounds rolled between them; then, once, each main face
 * takes the leftover triangles that lie on it and touching main faces on one surface are joined.
 * What is left goes to today's reading as the seeds' pieces on it, each still with its surface for
 * that reading to prove or drop.
 */
export function mainFirst(mesh: Mesh, seeds: Region[], eps: number): MainFirst {
  const nT = mesh.tri.length / 3;
  const structure = readStructure(mesh);
  if (structure.kind !== 'cad') return { structure, main: null, rounds: [], frozen: [], left: [], start: seeds };
  // Switches for measuring: with neither main faces nor rounds this is the engine's reading as it was.
  const noMain = (globalThis as { __noMain?: boolean }).__noMain;
  const found = noMain ? { main: [] as MainFace[], band: Array.from({ length: nT }, (_, t) => t) } : mainFaces(mesh, structure, seeds, eps);
  // Rounds and ball corners rolled between the main faces. Main faces it names as rounds already
  // stay as they are.
  const noRounds = (globalThis as { __noRounds?: boolean }).__noRounds;
  const roll = (main: MainFace[], band: number[]) => (noRounds ? null : rollRounds(mesh, { main: main.map((f) => ({ tris: f.tris, surf: f.surf, err: f.err })), band, tolPoint: structure.tolPoint, tolEdge: structure.tolEdge }));
  let rolled = roll(found.main, found.band);
  const free = new Uint8Array(nT);
  for (const t of rolled ? rolled.left : found.band) free[t] = 1;
  // What neither took, read with the design the part already has; then the rounds roll again, now
  // that the faces beside them have surfaces.
  if ((globalThis as { __design?: boolean }).__design && !noMain) {
    const made = designOn(mesh, structure, found.main, free);
    if (made.length) {
      found.main.push(...made);
      const owned = new Uint8Array(nT);
      for (const f of found.main) for (const t of f.tris) owned[t] = 1;
      const band: number[] = [];
      for (let t = 0; t < nT; t++) if (!owned[t]) band.push(t);
      rolled = roll(found.main, band);
      free.fill(0);
      for (const t of rolled ? rolled.left : band) free[t] = 1;
    }
  }
  // A round of one or two triangles is no round: a piece of one round rolled on a related face (one
  // torus came back as seven pieces, two of them single triangles). Such a piece, and every
  // round of about its radius touching it, goes to the reading after, with the triangles no round
  // explains: the pieces of one round come out as one face or not as rounds at all.
  const all = rolled ? rolled.rounds : [];
  const which = new Int32Array(nT).fill(-1);
  all.forEach((f, i) => f.tris.forEach((t) => (which[t] = i)));
  const drop = new Uint8Array(all.length);
  const queue: number[] = [];
  all.forEach((f, i) => { if (f.tris.length <= ROUND_LEAST) { drop[i] = 1; queue.push(i); } });
  const radius = (f: Region) => (f.round ? f.round.r : NaN);
  while (queue.length) {
    const i = queue.pop()!;
    for (const t of all[i].tris) for (let k = 0; k < 3; k++) {
      const w = mesh.adj[t * 3 + k], j = w >= 0 ? which[w] : -1;
      if (j < 0 || drop[j] || !(Math.abs(radius(all[j]) - radius(all[i])) <= SAME_RADIUS * radius(all[i]))) continue;
      drop[j] = 1;
      queue.push(j);
    }
  }
  const rounds = all.filter((f, i) => {
    if (!drop[i]) return true;
    for (const t of f.tris) free[t] = 1;
    return false;
  });
  const settled = settle(mesh, structure, found.main, free);
  // A flat of a few triangles is evidence, not a decision: the facets of a coarsely meshed sheet
  // pass every test a small flat face passes (a wave sheet, read as eleven flats). Such
  // flats go to today's reading with their planes, which can join them to what they belong to.
  const small = (f: MainFace) => f.surf.kind === 'plane' && f.tris.length <= SMALL_FLAT;
  const main = settled.filter((f) => !small(f));
  for (const f of settled) if (small(f)) for (const t of f.tris) free[t] = 1;
  const left: number[] = [];
  for (let t = 0; t < nT; t++) if (free[t]) left.push(t);
  const start: Region[] = settled.filter(small).map((f) => ({ tris: f.tris, surf: f.surf, err: f.err }));
  for (const t of start.flatMap((f) => f.tris)) free[t] = 2;
  for (const f of seeds) {
    const rest = f.tris.filter((t) => free[t] === 1);
    if (!rest.length) continue;
    if (rest.length === f.tris.length) { start.push(f); continue; }
    for (const part of pieces(mesh, rest)) start.push({ tris: part, surf: f.surf, err: f.err });
  }
  const frozen: Region[] = [
    ...main.map((f): Region => ({ tris: f.tris, surf: f.surf, err: f.err, keep: 'main' })),
    ...rounds.map((f): Region => ({ ...f, keep: 'round' })),
  ];
  return { structure, main, rounds, frozen, left, start };
}

/** The most triangles a flat main face can have and still be handed to today's reading. */
const SMALL_FLAT = 4;
/** The most triangles a rolled round can have and still be no round of its own. */
const ROUND_LEAST = 2;
/** Rounds whose radii differ by less than this share are pieces of one. */
const SAME_RADIUS = 0.05;

/**
 * The mesh made of some of its triangles only: the same points, those triangles, neighbours only
 * among them. `back` gives each triangle's index in the whole mesh, `to` the other way (-1: not in it).
 */
export function subMesh(m: Mesh, tris: number[]): { mesh: Mesh; back: Int32Array; to: Int32Array } {
  const nT = m.tri.length / 3, n = tris.length;
  const to = new Int32Array(nT).fill(-1);
  const back = Int32Array.from(tris);
  tris.forEach((t, i) => (to[t] = i));
  const tri = new Uint32Array(n * 3), adj = new Int32Array(n * 3).fill(-1), normal = new Float64Array(n * 3), area = new Float64Array(n);
  const vertTris: number[][] = Array.from({ length: m.pos.length / 3 }, () => []);
  for (let i = 0; i < n; i++) {
    const t = back[i];
    area[i] = m.area[t];
    for (let k = 0; k < 3; k++) {
      tri[i * 3 + k] = m.tri[t * 3 + k];
      normal[i * 3 + k] = m.normal[t * 3 + k];
      const w = m.adj[t * 3 + k];
      adj[i * 3 + k] = w >= 0 ? to[w] : -1;
      vertTris[m.tri[t * 3 + k]].push(i);
    }
  }
  return { mesh: { pos: m.pos, tri, adj, normal, area, vertTris }, back, to };
}

/**
 * A face of today's reading that touches a frozen face of the same kind, and lies wholly on that
 * face's surface (its points within the edge tolerance, a plane's within the float precision),
 * is more of that face: it joins it, and the frozen face keeps its surface.
 */
export function joinOntoFrozen(mesh: Mesh, frozen: Region[], read: Region[], tolPoint: number, tolEdge: number): { frozen: Region[]; read: Region[] } {
  const nT = mesh.tri.length / 3;
  const owner = new Int32Array(nT).fill(-1);
  frozen.forEach((f, i) => f.tris.forEach((t) => (owner[t] = i)));
  const out = frozen.map((f) => ({ ...f, tris: [...f.tris] }));
  const rest: Region[] = [];
  for (const f of read) {
    const s = f.surf;
    if (!s || s.kind === 'bspline' || 'profile' in s) { rest.push(f); continue; }
    const near = new Set<number>();
    for (const t of f.tris) for (let k = 0; k < 3; k++) { const w = mesh.adj[t * 3 + k]; if (w >= 0 && owner[w] >= 0) near.add(owner[w]); }
    const vs = [...new Set(f.tris.flatMap((t) => [mesh.tri[t * 3], mesh.tri[t * 3 + 1], mesh.tri[t * 3 + 2]]))];
    let to = -1;
    for (const i of near) {
      const g = out[i].surf;
      if (!g || g.kind !== s.kind || out[i].round) continue;
      const tol = g.kind === 'plane' ? tolPoint : tolEdge;
      if (vs.every((v) => Math.abs(distance(g, [mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2]])) <= tol)) { to = i; break; }
    }
    if (to < 0) { rest.push(f); continue; }
    for (const t of f.tris) out[to].tris.push(t);
  }
  return { frozen: out, read: rest };
}
