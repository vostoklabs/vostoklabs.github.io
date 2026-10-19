/**
 * Loading a model file into an object whose colourable regions are individually addressable.
 */

import * as THREE from 'three';
import { unzipSync } from 'fflate';
import { modelFormatOf, readModel } from '@vostok/export/read';
import { buildMeshFromParts, parsePlateObjects, plateObjectsFor, type ThreeMfPart } from './threemf/mesh';
import { buildPaint, paintWithMaterials, type ThreeMfPaint } from './threemf/colors';
import { assignRegions, groupByRegion, type PaintRegion } from './regions';
import { fileStem } from './studio';

export interface LoadedModel {
  /**
   * The model, y-up. Never drawn itself: every scene draws a copy of it (sharing its geometry),
   * so one loaded model can be in the preview and in a still at the same time.
   */
  object: THREE.Object3D;
  /**
   * One entry per independently colourable run of triangles, in panel order.
   *
   * Not one per mesh, which is the wrong grain: a painted 3MF is one mesh with three colours in
   * it. See `regions.ts`.
   */
  regions: PaintRegion[];
  /** Filename stem, used to name what comes out. */
  stem: string;
}

/*
 * **Smooth shading was tried here and reverted.** Keep it reverted unless the measurement below
 * is redone and comes out differently.
 *
 * Every mesh reaching the studio is a triangle soup with unshared vertices, so
 * `computeVertexNormals` gives each triangle its own flat normal and a coarsely tessellated
 * cylinder shows one visible band per segment. `toCreasedNormals` looks like the fix: weld by
 * position, average the neighbouring face normals only where the faces are closer than a
 * threshold, so curves smooth and box corners stay sharp.
 *
 * On a real print file it is a net loss, and the numbers are not close. Measured on a
 * 16 106-triangle CAD part, deviation of a vertex normal from its own face normal:
 *
 * | crease angle | largest 10% of faces, mean / worst | smallest 30%, mean |
 * |--------------|-----------------------------------|--------------------|
 * | flat         | 0.00 / 0.02 deg                   | 0.00 deg           |
 * | 8 deg        | 1.32 / 5.09 deg                   | 3.22 deg           |
 * | 15 deg       | 1.39 / 8.19 deg                   | 3.29 deg           |
 * | 40 deg       | 1.43 / 13.00 deg                  | 3.29 deg           |
 *
 * Two things kill it. **No threshold avoids tilting the big faces**: a flat face on a CAD part is
 * two or three large triangles whose corners are all shared with the fillet around it, and a
 * fillet is *tangent* by construction, so its first facet is a degree or two off the face and
 * inside any threshold worth having. The face has no interior vertices to anchor it, so the whole
 * of its shading is interpolated between corners that have been pulled, and it reads as a soft
 * wash across a surface that should be even. **And the curves gain nothing**: smoothing saturates
 * by 8 degrees, which means this mesh is already finer than that per facet and flat shading was
 * never what was wrong with it.
 *
 * Area weighting does not rescue it either. Weighting each neighbour by its face area, so a large
 * flat triangle outvotes the small fillet facets, moved the mean on the largest faces from 1.43 to
 * 1.24 degrees and made the worst case slightly worse.
 *
 * If banding on a *coarse* model needs solving, it is a different fix: decide per mesh whether its
 * curves are coarse enough to be worth smoothing, rather than smoothing every model and paying
 * for it on the ones that were fine.
 */

/** Extensions the studio can photograph. */
export const RENDERABLE = ['stl', 'obj', '3mf'] as const;

/** Whether a file name has an extension the studio can photograph. */
export function canRender(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (RENDERABLE as readonly string[]).includes(ext);
}

/**
 * Loads a model file into an object whose colourable regions are individually addressable.
 *
 * STL and OBJ are read by the shelf's model reader as geometry only, and are one region: the
 * whole model. A 3MF goes through this package's own reader, which keeps what the file knows
 * about its colours: the slicer's per-object slot, the per-part slot of an assembly, per-triangle
 * painting, and the model document's own `<basematerials>`, joined and turned into
 * `PaintRegion`s. The geometry is then sorted so each region is one contiguous run with its own
 * material, because a region carries a **finish** as well as a colour and three.js has no
 * per-vertex channel for roughness. Only the first plate of a multi-plate project is loaded.
 *
 * `name` is the file's name: its extension says the format (a name without one is sniffed) and
 * its stem names the pictures made from it.
 *
 * Synchronous, on the calling thread: a large 3MF takes a moment, so show that something is
 * happening and yield a frame before calling. Throws an `Error` whose message can be shown as it
 * is when the file cannot be read.
 */
export function loadRenderModel(bytes: Uint8Array | ArrayBuffer, name: string): LoadedModel {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stem = fileStem(name);
  const hasExtension = /\.[^.\\/]+$/.test(name);
  const format = modelFormatOf(name)
    ?? (hasExtension ? null : data[0] === 0x50 && data[1] === 0x4b ? '3mf' : 'stl');
  if (!format) throw new Error('Only STL, OBJ and 3MF files can be photographed.');
  if (format === '3mf') return loadThreeMf(data, stem);

  // `readModel` sniffs STL from OBJ itself for a name without an extension.
  const { positions, indices } = readModel(data, name);
  const soup = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = (indices[i] ?? 0) * 3;
    soup[i * 3] = positions[v] ?? 0;
    soup[i * 3 + 1] = positions[v + 1] ?? 0;
    soup[i * 3 + 2] = positions[v + 2] ?? 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(soup, 3));
  // Flat, one normal per triangle: see the note above on smooth shading.
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry);
  mesh.name = stem;
  const region: PaintRegion = {
    key: 'whole', label: stem, source: 'whole', fileHex: null, triangles: indices.length / 3,
  };
  mesh.userData.regionKeys = [region.key];
  return finish(mesh, [region], stem);
}

function loadThreeMf(data: Uint8Array, stem: string): LoadedModel {
  let entries: Record<string, Uint8Array>;
  try {
    // Four kinds of entry. `slice_info` and `project_settings` are what turn a filament slot into
    // a colour; without them per-face painting decodes to a slot number nothing can resolve.
    entries = unzipSync(data, {
      filter: (f) => /\.model$/i.test(f.name)
        || /model_settings\.config$/i.test(f.name)
        || /slice_info\.config$/i.test(f.name)
        || /project_settings\.config$/i.test(f.name),
    });
  } catch {
    throw new Error('This 3MF could not be opened: it is not a valid zip.');
  }
  const decoder = new TextDecoder();
  const parts: ThreeMfPart[] = Object.keys(entries)
    .filter((k) => /\.model$/i.test(k))
    .map((k) => ({ name: k, xml: decoder.decode(entries[k]) }));
  if (parts.length === 0) throw new Error('This 3MF has no model in it.');

  const text = (pattern: RegExp) => {
    const key = Object.keys(entries).find((k) => pattern.test(k));
    return key ? decoder.decode(entries[key]) : '';
  };
  const settings = text(/model_settings\.config$/i);

  /*
   * The slicer's own assignment leads because it says what actually prints; the model
   * document's `<basematerials>` fills in the objects nothing else spoke for, which for a file
   * with no `model_settings.config` is all of them. Each part is folded in under its own entry
   * name, because ids repeat across the `object_N.model` files of a Production-extension archive.
   */
  let paint: ThreeMfPaint | null = buildPaint(
    settings, text(/slice_info\.config$/i), text(/project_settings\.config$/i),
  );
  for (const p of parts) paint = paintWithMaterials(paint, p.xml, p.name);

  // Plate 1, always. A listing photograph of "every plate at once" is a photograph of a slicer
  // project, not of a product.
  const wanted = plateObjectsFor(parsePlateObjects(settings), 1);
  const { objects } = buildMeshFromParts(parts, wanted, { paint: true });
  if (objects.length === 0) throw new Error('There is no geometry on the first plate of this 3MF.');

  const group = new THREE.Group();
  // One map across every object, so a filament slot is one row in a panel however many objects
  // print in it.
  const found = new Map<string, PaintRegion>();
  objects.forEach((o, i) => {
    const keys = assignRegions(o, paint, o.name?.trim() || `Part ${i + 1}`, found);
    const { positions, groups } = groupByRegion(o.positions, keys);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // After the sort, never before: a normal attribute is index-aligned with the positions it was
    // built from.
    geometry.computeVertexNormals();
    groups.forEach((g, at) => geometry.addGroup(g.start, g.count, at));

    const mesh = new THREE.Mesh(geometry);
    mesh.name = o.name ?? '';
    mesh.userData.regionKeys = groups.map((g) => g.key);
    group.add(mesh);
  });
  // A part or object the model document left unnamed takes the name the slicer gave it, which is
  // where Bambu Studio keeps the names a person typed.
  const named = settingsNames(settings);
  for (const region of found.values()) {
    if (region.source !== 'part' && region.source !== 'object') continue;
    const id = region.key.split('::').pop() ?? '';
    const name = named.get(id);
    if (name && /^Part \d+$/.test(region.label)) region.label = name;
  }
  return finish(group, [...found.values()], stem);
}

/** The names `model_settings.config` gives objects and parts, by id. */
export function settingsNames(xml: string): Map<string, string> {
  const names = new Map<string, string>();
  const block = /<(object|part)\s+id="([^"]+)"[^>]*>([\s\S]*?)(?=<(?:object|part|\/object|\/part)\b)/g;
  for (let m = block.exec(xml); m; m = block.exec(xml)) {
    const name = /<metadata\s+key="name"\s+value="([^"]*)"/.exec(m[3] ?? '')?.[1]?.trim();
    if (name && m[2] && !names.has(m[2])) names.set(m[2], decodeXml(name));
  }
  return names;
}

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Print files are z-up; everything downstream assumes y-up.
 *
 * This is a guess, and it is right for every 3MF and nearly every STL and wrong for an OBJ out of
 * a y-up modeller. `Orientation` is the escape hatch, because the alternative (sniffing the
 * bounding box and deciding which way is up) guesses differently on every model and cannot be
 * corrected when it guesses wrong.
 */
function finish(object: THREE.Object3D, regions: PaintRegion[], stem: string): LoadedModel {
  object.rotation.x = -Math.PI / 2;
  object.updateMatrixWorld(true);
  return { object, regions, stem };
}

/**
 * Frees a loaded model's geometry, in every renderer that drew it. Call when the model is
 * replaced; nothing may draw it afterwards.
 */
export function disposeModel(model: LoadedModel): void {
  model.object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const m = child.material as THREE.Material | THREE.Material[];
    if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m.dispose();
  });
}
