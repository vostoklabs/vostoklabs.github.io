// Mesh to CAD: an STL made by a CAD package back into a solid with real faces and edges.
//
// Two steps, with a person's check between them if they want one: `readPart` finds the faces and
// what each is (flat, cylinder, cone, sphere, torus, revolved, extruded, or free-form);
// `makeStep` gives every free-form face a sheet, builds the solid and writes the file.
// `stlToStep` is both, unchecked.

import { type Mesh, buildMesh, flattenSlivers, meshHealth, parseStl, triVerts, vtx } from './mesh';
import { type Region, type SegmentOptions, fitTris } from './segment';
import { seedFaces, mainFirst } from './reading';
import { absorbSpecks, joinSameSurface } from './frames';
import { coverScraps, flatUnits, smoothParts } from './scraps';
import { growOnSurfaces, readLeftovers, unprovenFree } from './features';
import { joinSwept } from './merge';
import { chainRounds } from './chains';
import { sheetAreas } from './regions';
import { type Surface, distance, fitPlane, normalAt } from './surfaces';
import { type V3, madd, maxOf } from './linalg';
import { freeformFaces } from './freeform';
import { writeStep } from './step';
import { buildBrep } from './topology';
import { closeMesh } from './repair';
import { snapSurfaces } from './snap';
import { type FileCheck, checkFile, unclosedFaces } from './check';
import { type PreviewFace, previewSolid } from './preview';
import { type Reading } from './review';

export type { PreviewFace, FileCheck };
export { type Reading, type ReviewFace, type FaceKind, type EditResult, reviewFaces, setKind, joinFaces, describe } from './review';

export type ConvertOptions = Partial<SegmentOptions>;

export type ConvertReport = {
  triangles: number;
  openEdges: number;
  /** Holes in the STL that were covered to make a solid. */
  holes: number;
  faces: Record<string, number>;
  freeForm: number;
  edges: Record<string, number>;
  /** Largest distance from a mesh vertex to its face's surface (mm). */
  maxError: number;
  /** Largest distance from the solid's faces, as drawn, to the STL triangles they stand for (mm). */
  offMesh: number;
  /** Radii and angles rounded to the designer's numbers. */
  snapped: number;
  /** What a CAD program will make of the file. */
  check: FileCheck;
  options: SegmentOptions;
  ms: number;
};

/** How far a conversion has got: `done` rises from 0 and stays below 1 until the result is back. */
export type ConvertProgress = { done: number; text: string };

/**
 * Where each stage starts on the bar, from timed conversions of parts of 7,000 to 350,000
 * triangles: finding faces is a tenth of the time on a part that is all free-form and nearly
 * half on one that is mostly flat and round, the sheets most of the rest. A part with no
 * free-form areas simply jumps across the share for the sheets. Every stage that can take more
 * than a few seconds reports as it goes (faces, sheets, the solid, the drawing).
 */
/** How many times a solid that does not close is built again with its open faces left as facets. */
const CLOSE_ROUNDS = 4;

const BAR = { read: 0, faces: 0.01, swept: 0.27, sheets: 0.29, solid: 0.86, write: 0.94, view: 0.95 };

type Tell = (done: number, text: string) => void;

/** Passes a report on when the words change or the bar has moved half a percent, so a loop can report every step. */
function reporter(onProgress: (p: ConvertProgress) => void, from = 0, to = 1): Tell {
  let shown = -1, said = '';
  return (at, text) => {
    // Each step has a bar of its own: the share of the whole it covers, stretched to fill it.
    const done = Math.max(0, Math.min(1, (at - from) / (to - from)));
    if (text === said && done - shown < 0.005) return;
    shown = done;
    said = text;
    onProgress({ done, text });
  };
}

/** The STL itself, for drawing beside the solid: xyz per vertex and three vertices per triangle. */
export type PreviewMesh = { positions: Float32Array; indices: Uint32Array };

/** Tolerances scaled to the part, and the length of its diagonal. */
function defaults(mesh: Mesh, options: ConvertOptions): SegmentOptions & { diag: number } {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < mesh.pos.length / 3; v++) {
    const p = vtx(mesh.pos, v);
    lo = lo.map((x, i) => Math.min(x, p[i]));
    hi = hi.map((x, i) => Math.max(x, p[i]));
  }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return {
    // CAD exporters put vertices on the surface to float precision (~1e-7 of the coordinates).
    eps: Math.max(1e-4, 1e-6 * diag),
    // Only a sanity bound on how far a facet may bow off its surface; evenFacets does the real work.
    chord: Math.max(0.5, 1e-2 * diag),
    smoothAngle: (40 * Math.PI) / 180,
    ...options,
    diag,
  };
}

/** The STL as a closed mesh, which is what every stage after this relies on. */
function readMesh(bytes: Uint8Array) {
  const read = buildMesh(parseStl(bytes));
  if (!read.tri.length) throw new Error('there are no triangles in it');
  const health = meshHealth(read);
  if (!health.open) return { mesh: read, health, holes: 0 };
  const { mesh, holes } = closeMesh(read);
  if (meshHealth(mesh).open) throw new Error('its surface could not be closed');
  return { mesh, health, holes };
}

/** The STL read into faces, each with what it is: what a person checks before the STEP is made. */
export function readPart(bytes: Uint8Array, options: ConvertOptions = {}, onProgress: (p: ConvertProgress) => void = () => {}): Reading {
  const tell = reporter(onProgress, BAR.read, BAR.sheets);
  tell(BAR.read, 'Reading the mesh');
  const { mesh, health, holes } = readMesh(bytes);
  const { diag, ...opt } = defaults(mesh, options);
  const { whole, ...read } = recogniseFaces(mesh, opt, tell, holes);
  return { mesh, opt, diag, health, holes, ...read, joined: new Set(whole), version: 0 };
}

/** The STEP from a reading, as it stands after any corrections. */
export function makeStep(
  r: Reading, name = 'Part', onProgress: (p: ConvertProgress) => void = () => {},
): { step: string; report: ConvertReport; faces: PreviewFace[]; stl: PreviewMesh; regions?: Region[]; label?: Int32Array } {
  const t0 = performance.now();
  const tell = reporter(onProgress, BAR.sheets, 1);
  const { mesh, opt, diag } = r;
  const filled = fillFaces(mesh, opt, r, tell);
  let { label, regions } = filled;
  const { brokenJoins, facets } = filled;
  const free = regions.filter((g) => !g.surf).length;
  if (free) throw new Error(`${free} free-form face(s): not supported yet`);
  const snapped = snapSurfaces(mesh, regions, opt.eps);
  const tol = Math.max(opt.eps * 4, 1e-3);
  tell(BAR.solid, 'Building the solid');
  // On a part of thousands of faces these two take a minute between them, so they report too.
  let brep = buildBrep(mesh, label, regions, tol, (share) => tell(BAR.solid + (BAR.write - BAR.solid) * share, 'Building the solid'));
  // A clean solid before a perfect one: a face that does not close with its neighbours goes back
  // to the STL's own flat facets, which always meet, and the solid is built again until it closes.
  let flattened = 0;
  for (let round = 0; round < CLOSE_ROUNDS; round++) {
    const bad = unclosedFaces(brep, tol);
    if (!bad.size) break;
    const out = new Set<number>();
    for (const f of bad) for (const t of brep.facets?.tris[f] ?? []) if (label[t] >= 0 && regions[label[t]].surf?.kind !== 'plane') out.add(label[t]);
    // Only flat faces are left on the bad edges: their facets are flat already, nothing more to give.
    if (!out.size) break;
    const keep = regions.filter((_, i) => !out.has(i));
    const flats: Region[] = [];
    for (const i of out) for (const unit of flatUnits(mesh, regions[i].tris, opt.eps)) {
      const vs = [...new Set(unit.flatMap((t) => triVerts(mesh, t)))].map((v) => vtx(mesh.pos, v));
      const plane = fitPlane(vs);
      flats.push({ tris: unit, surf: plane, err: maxOf(vs.map((p) => Math.abs(distance(plane, p)))) });
    }
    flattened += out.size;
    regions = [...keep, ...flats];
    label = new Int32Array(mesh.tri.length / 3).fill(-1);
    regions.forEach((g, i) => g.tris.forEach((t) => (label[t] = i)));
    tell(BAR.solid, 'Closing the solid');
    brep = buildBrep(mesh, label, regions, tol, (share) => tell(BAR.solid + (BAR.write - BAR.solid) * share, 'Closing the solid'));
  }
  tell(BAR.write, 'Writing the STEP file');
  const step = writeStep(brep, name, tol);
  const check = checkFile(brep, tol, regions.map((g) => g.tris.reduce((a, t) => a + mesh.area[t], 0)));
  if (flattened) check.notes.unshift(`${flattened} ${flattened === 1 ? 'face did' : 'faces did'} not close with ${flattened === 1 ? 'its' : 'their'} neighbours and ${flattened === 1 ? 'is' : 'are'} left as the STL's own flat facets, so the solid closes.`);
  if (facets) check.notes.unshift(`${facets} ${facets === 1 ? 'face is' : 'faces are'} left as the STL's own flat facets: no smooth surface holds ${facets === 1 ? 'it' : 'them'}.`);
  if (brokenJoins) check.notes.unshift(`${brokenJoins} joined ${brokenJoins === 1 ? 'face' : 'faces'} could not be one smooth face, and ${brokenJoins === 1 ? 'was' : 'were'} left as found.`);
  tell(BAR.view, 'Drawing the solid');
  const view = previewSolid(mesh, regions, brep, diag, (share) => tell(BAR.view + (1 - BAR.view) * share, 'Drawing the solid'));
  const faces: Record<string, number> = {};
  for (const g of regions) { const k = g.surf?.kind ?? 'free-form'; faces[k] = (faces[k] ?? 0) + 1; }
  const edges: Record<string, number> = {};
  for (const e of brep.edges) edges[e.curve.kind] = (edges[e.curve.kind] ?? 0) + 1;
  return {
    step,
    faces: view.faces,
    stl: { positions: new Float32Array(mesh.pos), indices: new Uint32Array(mesh.tri) },
    regions, label,
    report: {
      triangles: r.health.triangles, openEdges: r.health.open, holes: r.holes, faces, freeForm: free, edges,
      maxError: Math.max(0, maxOf(regions.map((g) => g.err))), offMesh: view.off, snapped, check, options: opt, ms: Math.round(performance.now() - t0),
    },
  };
}

export function stlToStep(
  bytes: Uint8Array,
  name = 'Part',
  options: ConvertOptions = {},
  onProgress: (p: ConvertProgress) => void = () => {},
): { step: string; report: ConvertReport; faces: PreviewFace[]; stl: PreviewMesh } {
  // One bar for both steps: reading takes its share of it, making the rest.
  const r = readPart(bytes, options, (p) => onProgress({ done: p.done * BAR.sheets, text: p.text }));
  return makeStep(r, name, (p) => onProgress({ done: BAR.sheets + p.done * (1 - BAR.sheets), text: p.text }));
}

/** The point on the surface nearest p (two steps along the normal), or null without one. */
function projectOnto(s: Surface | null, p: V3): V3 | null {
  if (!s) return null;
  let q = p;
  for (let i = 0; i < 2; i++) q = madd(q, normalAt(s, q), -distance(s, q));
  return q;
}

/**
 * The faces, read the way the part was designed: analytic faces from the segmenter, revolved and
 * extruded ones from their profiles, one list of surfaces; then only the faces that prove their
 * surface are kept, grown over every triangle lying on them, and pieces of one surface joined,
 * until nothing changes. Then each round from start to end is one face, and each free-form area
 * one sheet. No pass undoes another.
 */
function recogniseFaces(mesh: Mesh, opt: SegmentOptions, tell: Tell, holes = 0): { found: Region[]; source: Int32Array; faces: Region[]; whole: Region[] } {
  const finding = 'Finding flat and round faces';
  tell(BAR.faces, finding);
  flattenSlivers(mesh, opt.eps);
  // The segmenter's faces: analytic, swept, one list of surfaces, simple faces joined.
  const found = seedFaces(mesh, opt, (share) => tell(BAR.faces + (BAR.swept - BAR.faces) * share, finding), () => tell(BAR.swept, 'Finding swept faces'));
  const source = new Int32Array(mesh.tri.length / 3);
  found.forEach((r, i) => r.tris.forEach((t) => (source[t] = i)));
  // The mesh's own structure, the exact main faces and the rounds rolled between them first (on a
  // CAD export). Today's reading then runs on the whole part with them inside it as fixed faces (see
  // Region.keep): with none, it is the reading the engine has always done.
  // A mesh with holes the reading had to cover is not a CAD export as written, and the covers are
  // no faces of the part: the engine's reading takes it whole.
  const first = (globalThis as { __oldOrder?: boolean }).__oldOrder || holes > 0 ? null : mainFirst(mesh, found, opt.eps);
  const stage = (globalThis as { __stage?: (name: string, faces: Region[]) => void }).__stage;
  let faces: Region[];
  if (!first?.main) faces = todaysReading(mesh, found, opt, stage ? (name, f) => stage(name, f) : undefined);
  else {
    stage?.('main faces', first.main);
    stage?.('rounds', first.frozen);
    faces = todaysReading(mesh, [...first.frozen, ...first.start], opt, stage);
  }
  // A rolled round with a free centre-line stays one face for one sheet.
  return { found, source, faces, whole: faces.filter((f) => f.keep === 'round' && !f.surf) };
}

/**
 * The reading the engine has always done, on the faces it is given: proven faces grown over every
 * triangle that lies on their surfaces, the rest read whole, pieces of one surface joined, again
 * until nothing changes (a join can show a surface, a fan of wedges a torus, that the triangles
 * between the pieces lie on); then faces that never showed a surface are free-form, each round
 * from start to end is one face, and free-form areas and scraps take one sheet each.
 */
function todaysReading(mesh: Mesh, start: Region[], opt: SegmentOptions, stage?: (name: string, faces: Region[]) => void): Region[] {
  let faces = start;
  for (let round = 0; round < 4; round++) {
    const grown = growOnSurfaces(mesh, faces, opt);
    const next = joinSwept(mesh, joinSameSurface(mesh, [...grown.faces, ...readLeftovers(mesh, grown.pool, opt)], opt), opt);
    const same = next.length === faces.length;
    faces = next;
    if (same) break;
  }
  faces = unprovenFree(mesh, faces);
  stage?.('leftover reading', faces);
  // Faces decided before this reading are not chained: a round is finished, a main face exact.
  if (!(globalThis as { __noChains?: boolean }).__noChains) {
    const fixed = faces.filter((f) => f.keep);
    faces = fixed.length ? [...chainRounds(mesh, faces.filter((f) => !f.keep), opt), ...fixed] : chainRounds(mesh, faces, opt);
  }
  // A face under a hundredth of a square millimetre is no face: free-form, so it goes in with the
  // free-form faces it touches; one that touches none joins the neighbour it lies on.
  const speck = (f: Region) => f.tris.reduce((a, t) => a + mesh.area[t], 0) < SPECK;
  faces = faces.map((f) => (!f.keep && speck(f) && !(f.surf?.kind === 'bspline') ? { ...f, surf: null, err: 0 } : f));
  if (!(globalThis as { __noSheets?: boolean }).__noSheets) faces = sheetAreas(mesh, faces, opt);
  faces = absorbSpecks(mesh, faces);
  stage?.('chains and sheets', faces);
  return faces;
}

/**
 * Every free-form face given a sheet; what no sheet takes is covered by the rules for scraps
 * (`coverScraps`), never handed back as the one-triangle faces it was first found as.
 */
function fillFaces(mesh: Mesh, opt: SegmentOptions, r: Reading, tell: Tell): { label: Int32Array; regions: Region[]; brokenJoins: number; facets: number } {
  const free = r.faces.filter((f) => !f.surf);
  const toFit = free.map((f) => f.tris);
  // Copies: the reading stays as the person left it, whatever the sheets do.
  const given = r.faces.map((f) => ({ ...f }));
  let sheets = freeformFaces(mesh, given, {
    ...opt, project: projectOnto, distance: (s, p) => distance(s as Surface, p), patches: toFit,
    keepWhole: free.map((f) => r.joined.has(f)),
    progress: (share, text) => tell(BAR.sheets + (BAR.solid - BAR.sheets) * share, text),
  }) as Region[];
  // What a patch left, in smooth pieces, is offered to the fitter once more on its own: the cuts
  // that failed were made for the whole patch, and a piece of it can hold a sheet of its own.
  const unfitted: number[] = [];
  for (const g of sheets) if (!g.surf) for (const t of g.tris) unfitted.push(t);
  const again = smoothParts(mesh, unfitted).filter((p) => p.length >= REFIT_LEAST);
  if (again.length) {
    sheets = freeformFaces(mesh, sheets, {
      ...opt, project: projectOnto, distance: (s, p) => distance(s as Surface, p), patches: again,
      progress: (share, text) => tell(BAR.solid - 0.01 + 0.01 * share, text),
    }) as Region[];
  }
  const left: number[] = [];
  for (const g of sheets) if (!g.surf) for (const t of g.tris) left.push(t);
  const { faces: regions, facets } = coverScraps(mesh, sheets.filter((g) => g.surf), left, opt.eps);
  const label = new Int32Array(mesh.tri.length / 3).fill(-1);
  regions.forEach((g, i) => g.tris.forEach((t) => (label[t] = i)));
  // A joined free-form face that took no single sheet.
  const brokenJoins = free.filter((f) => r.joined.has(f) && label[f.tris[0]] >= 0 && regions[label[f.tris[0]]].tris.length !== f.tris.length).length;
  return { label, regions, brokenJoins, facets };
}

/** The smallest face there is (mm²). */
const SPECK = 0.01;

/** The fewest triangles a piece the sheets left is offered to the fitter again with. */
const REFIT_LEAST = 4;

/**
 * The surface a patch already has: the one all its triangles were found on, the plane it lies
 * in, or a cylinder, cone, sphere or torus that holds every vertex within the point tolerance.
 */
function ownSurface(mesh: Mesh, found: Region[], source: Int32Array, tris: number[], opt: SegmentOptions): { surf: Surface; err: number } | null {
  const first = found[source[tris[0]]].surf;
  if (first && first.kind !== 'bspline' && tris.every((t) => found[source[t]].surf === first)) {
    return { surf: first, err: Math.max(...new Set(tris.map((t) => found[source[t]].err))) };
  }
  const pts = [...new Set(tris.flatMap((t) => triVerts(mesh, t)))].map((v) => vtx(mesh.pos, v));
  const plane = fitPlane(pts);
  let err = 0;
  for (const p of pts) { err = Math.max(err, Math.abs(distance(plane, p))); if (err > opt.eps) break; }
  if (err <= opt.eps) return { surf: plane, err };
  // Simple surfaces before any sheet: a patch the border map drew round one whole round face.
  const fit = fitTris(mesh, tris, opt, ['cylinder', 'cone', 'sphere', 'torus']);
  return fit ? { surf: fit.surf, err: fit.err } : null;
}

/** Debugging: the faces found, without building a solid. */
export function analyse(bytes: Uint8Array, options: ConvertOptions = {}) {
  const r = readPart(bytes, options);
  const { label, regions } = fillFaces(r.mesh, r.opt, r, () => {});
  return { mesh: r.mesh, opt: { ...r.opt, diag: r.diag }, label, regions };
}
