// The faces as the converter reads them, for a person to check before the STEP is made: each
// face with what it was read as (flat, cylinder, cone, sphere, torus, revolved, extruded, or
// free-form), and the two corrections a person can make: "this is a cylinder" (or any other
// kind), and "these are one face".
//
// A free-form face here has no surface yet: it becomes a smooth sheet when the STEP is made.

import { type Mesh, connected, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions, fitAs, fitTris } from './segment';
import { type Surface } from './surfaces';

/** What a person can say a face is. */
export type FaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'free-form';

/** The converter's reading of a part, kept between the review and the making of the STEP. */
export type Reading = {
  mesh: Mesh;
  opt: SegmentOptions;
  diag: number;
  health: { triangles: number; open: number };
  holes: number;
  /** The faces found before the border map, which a face that takes no sheet goes back to. */
  found: Region[];
  /** For each triangle, the face of `found` it is in. */
  source: Int32Array;
  /** The faces to make: a null surface is free-form, to get a sheet. */
  faces: Region[];
  /** Faces a person joined: one sheet over the whole of each, never cut into several. */
  joined: Set<Region>;
  /** How many times the faces were changed: a STEP is made from one version. */
  version: number;
};

/** One face of the review, ready to draw: its STL triangles, its border, and what it was read as. */
export type ReviewFace = {
  kind: string;
  /** In words: "Cylinder · r 1.4 mm". */
  text: string;
  /** How far its furthest vertex sits off its surface (mm); 0 for free-form. */
  err: number;
  triangles: number;
  positions: Float32Array;
  indices: Uint32Array;
  /** Where it meets another face: xyz pairs. */
  edges: Float32Array;
};

/** The furthest a person's choice may sit off the triangles and still be used (mm). */
const USER_MOST = 0.01;

const NAMES: Record<string, string> = {
  plane: 'Flat', cylinder: 'Cylinder', cone: 'Cone', sphere: 'Sphere', torus: 'Torus',
  revolution: 'Revolved', extrusion: 'Extruded', bspline: 'Free-form', 'free-form': 'Free-form',
};

/** A length as a person reads it: up to three places, no trailing zeros. */
const mm = (x: number) => `${+x.toFixed(3)}`;

/** A face's kind and numbers in words. */
export function describe(s: Surface | null): string {
  if (!s) return 'Free-form';
  switch (s.kind) {
    case 'cylinder': return `Cylinder · r ${mm(s.r)} mm`;
    case 'sphere': return `Sphere · r ${mm(s.r)} mm`;
    case 'cone': return `Cone · ${+((s.ang * 180) / Math.PI).toFixed(2)}°`;
    case 'torus': return `Torus · r ${mm(s.r)} mm round ${mm(s.R)} mm`;
    // A round from start to end, written as one sheet.
    case 'bspline': if (s.pipe) return `Round · r ${mm(s.pipe.r)} mm`; return NAMES.bspline;
    default: return NAMES[s.kind] ?? s.kind;
  }
}

/** Every face as the page draws it in the review. */
export function reviewFaces(r: Reading): ReviewFace[] {
  const m = r.mesh, nT = m.tri.length / 3;
  const label = new Int32Array(nT).fill(-1);
  r.faces.forEach((f, i) => f.tris.forEach((t) => (label[t] = i)));
  const edges: number[][] = r.faces.map(() => []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const w = m.adj[t * 3 + k];
    // Each border once, on the face with the lower number.
    if (w < 0 || label[w] === label[t] || label[t] > label[w]) continue;
    const a = vtx(m.pos, m.tri[t * 3 + k]), b = vtx(m.pos, m.tri[t * 3 + ((k + 1) % 3)]);
    edges[label[t]].push(...a, ...b);
  }
  return r.faces.map((f, i) => {
    const at = new Map<number, number>();
    const pos: number[] = [], idx: number[] = [];
    for (const t of f.tris) for (const v of triVerts(m, t)) {
      let j = at.get(v);
      if (j === undefined) { j = at.size; at.set(v, j); pos.push(...vtx(m.pos, v)); }
      idx.push(j);
    }
    return {
      kind: f.surf?.kind ?? 'free-form', text: describe(f.surf), err: f.surf ? f.err : 0, triangles: f.tris.length,
      positions: new Float32Array(pos), indices: new Uint32Array(idx), edges: new Float32Array(edges[i]),
    };
  });
}

/** What became of a correction, in words for the status line. */
export type EditResult = { ok: boolean; message: string };

/**
 * Say what the faces are: each one given that kind, fitted to its own triangles. With several
 * faces, they are joined into one first. Refused, with the reason, where no surface of that kind
 * comes within USER_MOST of the triangles.
 */
export function setKind(r: Reading, ids: number[], kind: FaceKind): EditResult {
  if (!ids.length) return { ok: false, message: 'Pick a face first.' };
  const unique = [...new Set(ids)];
  // Faces side by side are one face of that kind; faces apart (all of one kind, picked
  // together) are each given it.
  if (unique.length > 1 && connected(r.mesh, unique.flatMap((i) => r.faces[i].tris)).length === 1) {
    const joined = join(r, unique);
    if (!joined.ok) return joined;
    return setOne(r, joined.id, kind);
  }
  const results = unique.map((i) => setOne(r, i, kind));
  if (results.length === 1) return results[0];
  const done = results.filter((x) => x.ok).length;
  return { ok: done > 0, message: done === results.length ? `${done} faces: ${NAMES[kind]}.` : `${done} of ${results.length} faces made ${NAMES[kind].toLowerCase()}; ${results.find((x) => !x.ok)!.message}` };
}

function setOne(r: Reading, id: number, kind: FaceKind): EditResult {
  const f = r.faces[id];
  if (kind === 'free-form') {
    f.surf = null;
    f.err = 0;
    r.version++;
    return { ok: true, message: 'Free-form: it gets one smooth sheet.' };
  }
  const fit = fitAs(r.mesh, f.tris, kind);
  const name = NAMES[kind].toLowerCase();
  if (!fit) return { ok: false, message: `No ${name} can be put through this face.` };
  if (fit.err > USER_MOST) return { ok: false, message: `The nearest ${name} is ${fit.err.toFixed(3)} mm off this face: too far to use.` };
  f.surf = fit.surf;
  f.err = fit.err;
  r.version++;
  return { ok: true, message: `${describe(fit.surf)}, within ${fit.err < 1e-4 ? '0.0001' : fit.err.toFixed(4)} mm.` };
}

/**
 * Make the faces one face: the simple surface all of it lies on if there is one (loosely, within
 * the converter's own limits), and free-form otherwise.
 */
export function joinFaces(r: Reading, ids: number[]): EditResult {
  const joined = join(r, ids);
  if (!joined.ok) return joined;
  const f = r.faces[joined.id];
  return { ok: true, message: f.surf ? `Joined: ${describe(f.surf)}.` : 'Joined as one free-form face: it gets a smooth sheet.' };
}

function join(r: Reading, ids: number[]): EditResult & { id: number } {
  const unique = [...new Set(ids)].filter((i) => i >= 0 && i < r.faces.length).sort((a, b) => a - b);
  if (unique.length < 2) return { ok: false, message: 'Pick two faces or more to join (shift-click).', id: -1 };
  const tris = unique.flatMap((i) => r.faces[i].tris);
  if (connected(r.mesh, tris).length > 1) return { ok: false, message: 'Those faces do not touch: pick faces side by side.', id: -1 };
  const fit = fitTris(r.mesh, tris, r.opt, ['plane', 'cylinder', 'cone', 'sphere', 'torus'], true);
  const keep = unique[0];
  r.faces[keep] = { tris, surf: fit?.surf ?? null, err: fit?.err ?? 0 };
  r.joined.add(r.faces[keep]);
  const gone = new Set(unique.slice(1));
  r.faces = r.faces.filter((_, i) => !gone.has(i));
  r.version++;
  return { ok: true, message: '', id: keep };
}
