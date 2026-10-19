/**
 * A 3MF's geometry, read with regular expressions rather than `DOMParser`.
 *
 * `DOMParser` does not exist in a worker, and a DOM of a large mesh document is far more than is
 * needed: these are machine-written files with a rigid shape. The colour join in `colors.ts`
 * reads its XML the same way, for the same reasons.
 *
 * **Scope, stated rather than discovered later.** This reads geometry for *display*: vertices,
 * triangles, object references, component nesting and build transforms, plus per-face paint when
 * asked. It does not read materials, colour groups, textures or slice extensions: `colors.ts`
 * owns colour, whether it comes from the slicer's configs or from the document's own
 * `<basematerials>`. What this file does supply is the two things that join to it: the object
 * names, and which run of triangles belongs to which part. The model's `unit` is not applied:
 * a picture frames the model by its bounds, so scale does not change it.
 */

import { flatPaintState, forEachPaintedTriangle } from './paint';

/** A 4×4 transform in 3MF's row-major, 12-value form. Identity when absent. */
export type Matrix12 = readonly number[];

const IDENTITY: Matrix12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** One `<object>`, kept indexed rather than expanded into a triangle soup. */
export interface ThreeMfObjectIndexed {
  id: string;
  /**
   * `<metadata name="…"/>` from the object's own block, or its `name` attribute, when the file
   * wrote one.
   *
   * Bambu Studio keeps object names in `model_settings.config` instead (those match through
   * `id`), but other writers put the name on the object itself, and matching by name is what the
   * colour join uses for them.
   */
  name: string | null;
  /** Flat `[x,y,z, …]`: one entry per vertex, shared between triangles. */
  vertices: Float32Array;
  /** Flat vertex indices: three per triangle. */
  triangles: Uint32Array;
  /**
   * Each triangle's `paint_color`, or null when the caller did not ask for paint or the object
   * has none.
   *
   * Index-aligned with `triangles`: entry *i* belongs to `triangles[i*3 .. i*3+2]`. An unpainted
   * triangle is the empty string rather than a hole, so the two stay aligned.
   */
  paints: string[] | null;
  components: ThreeMfComponent[];
}

/** A component reference, possibly into another model part of the archive. */
export interface ThreeMfComponent {
  objectId: string;
  transform: Matrix12;
  /**
   * The model part (`p:path`) this component's object lives in, without a leading slash, so it
   * matches zip entry names. Undefined means the same part as the referencing object.
   */
  part?: string;
}

/** One model document of a multi-part 3MF: `name` is its zip entry. */
export interface ThreeMfPart {
  name: string;
  xml: string;
}

/**
 * A run of one mesh object's triangles that came from a single part of it.
 *
 * An assembly is one bucket of triangles, but its parts print in different filaments:
 * `<part id="9">` in `model_settings.config` *is* `<component objectid="9">` here. Without these
 * ranges there is one mesh with one colour, and the assembly renders in whichever filament
 * happened to be read last.
 *
 * `start` and `count` are in triangles; the soup is nine floats per triangle.
 */
export interface ThreeMfPartRange {
  /** The object whose mesh this run came from: a `<part id>` and a `<component objectid>`. */
  id: string;
  /** That object's own name, for the colour join's `byName` half. */
  name: string | null;
  /**
   * The `.model` entry `id` was read from: `""` for a single-document archive.
   *
   * Carried because `id` alone does not identify an object: the Production extension only
   * requires ids to be unique *within* a part, which is why `keyOf` scopes this module's own
   * object map the same way. A colour looked up by the bare id can come off the wrong
   * `object_N.model` entirely.
   */
  entry: string;
  start: number;
  count: number;
}

/**
 * One top-level object's share of the built scene, kept separate so it can be coloured. `id` is
 * the object's id in the part it lives in, which matches the `#id` colours `colors.ts` reads from
 * `model_settings.config`, and `name` is the object's own name, when the file wrote one.
 */
export interface ThreeMfMeshObject {
  id: string;
  name: string | null;
  /** The `.model` entry `id` was read from: see `ThreeMfPartRange.entry`. */
  entry: string;
  /** Flat `[x,y,z, …]`, three vertices per triangle, in world space. */
  positions: Float32Array;
  /**
   * Which run of triangles came from which part, or null when the caller did not ask for paint.
   *
   * Collected only under `options.paint`: a caller that wants one colour has no use for a
   * per-part index it would only throw away.
   */
  partRanges: ThreeMfPartRange[] | null;
  /**
   * The filament slot each triangle is painted in, or null when this object carries no per-face
   * paint. One entry per triangle of `positions`; `0` means unpainted, so the triangle keeps
   * whatever colour the object itself was assigned.
   */
  filaments: Uint8Array | null;
}

export interface ThreeMfMesh {
  /** Flat triangle soup for the whole build, in world space. */
  positions: Float32Array;
  /** How many triangles that is. */
  triangles: number;
  /** The build split by top-level object, in emission order. */
  objects: ThreeMfMeshObject[];
}

/**
 * `transform="1 0 0 0 1 0 0 0 1 0 0 0"` → twelve numbers.
 *
 * 3MF writes the first three columns of a 4×4 matrix, row by row, with the last column implied.
 * Anything that is not twelve finite numbers is treated as identity rather than as a reason to
 * fail: a bad transform should misplace one part, not lose the model.
 */
export function parseTransform(raw: string | undefined): Matrix12 {
  if (!raw) return IDENTITY;
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) return IDENTITY;
  return parts;
}

/** Element `i` of a transform, which always has twelve. */
const at = (m: Matrix12, i: number): number => m[i] ?? 0;

/** Applies a 3MF transform to a point. */
function apply(m: Matrix12, x: number, y: number, z: number): [number, number, number] {
  return [
    at(m, 0) * x + at(m, 3) * y + at(m, 6) * z + at(m, 9),
    at(m, 1) * x + at(m, 4) * y + at(m, 7) * z + at(m, 10),
    at(m, 2) * x + at(m, 5) * y + at(m, 8) * z + at(m, 11),
  ];
}

/**
 * Composes two 3MF transforms into the one that places by `b` and then by `a`: a component's own
 * transform (`b`) inside its parent's (`a`), so nested components compose.
 */
export function composeTransforms(a: Matrix12, b: Matrix12): Matrix12 {
  const out = new Array<number>(12);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] = at(a, r) * at(b, c * 3) + at(a, 3 + r) * at(b, c * 3 + 1) + at(a, 6 + r) * at(b, c * 3 + 2);
    }
  }
  for (let r = 0; r < 3; r++) {
    out[9 + r] = at(a, r) * at(b, 9) + at(a, 3 + r) * at(b, 10) + at(a, 6 + r) * at(b, 11) + at(a, 9 + r);
  }
  return out;
}

/**
 * Every `<object>` in the model, indexed, with its component references.
 *
 * Attributes are matched individually rather than by position: writers order them differently
 * and some add their own namespaced ones between the parts we want.
 *
 * `withPaint` is off by default because it costs a regex per triangle, and only a caller that
 * will show colour can use the result. See `paint.ts`.
 */
export function parseObjectsIndexed(xml: string, withPaint = false): Map<string, ThreeMfObjectIndexed> {
  const objects = new Map<string, ThreeMfObjectIndexed>();

  for (const block of xml.split(/<object\b/i).slice(1)) {
    const id = /^[^>]*\bid="([^"]+)"/i.exec(block)?.[1];
    if (!id) continue;

    // Stop at this object's own close so a following object cannot bleed in.
    const end = block.search(/<\/object\s*>/i);
    const body = end === -1 ? block : block.slice(0, end);

    // The object's own `<metadata name="…"/>` comes right after `<object>`, before any `<part>`
    // blocks, so the first match is the object's, not a part's.
    //
    // Failing that, the `name` attribute on `<object>` itself, which the core spec defines as the
    // object's human-readable name. Reading only the metadata element would leave `name` null for
    // every object of a file that uses the attribute, and the `byName` half of `colorForObject`
    // unreachable for it.
    const name = /<metadata[^>]*\bname="([^"]*)"/i.exec(body)?.[1]
      ?? /^[^>]*\bname="([^"]*)"/i.exec(body)?.[1]
      ?? null;

    objects.set(id, {
      id,
      name,
      ...parseMeshIndexed(body, withPaint),
      components: parseComponents(body),
    });
  }

  return objects;
}

function parseComponents(body: string): ThreeMfComponent[] {
  const out: ThreeMfComponent[] = [];
  for (const tag of body.matchAll(/<component\b[^>]*>/gi)) {
    const el = tag[0];
    const objectId = /\bobjectid="([^"]+)"/i.exec(el)?.[1];
    if (!objectId) continue;
    // The Production extension's `p:path` names the archive entry the object lives in. Written
    // with a leading slash, which zip entries never have; some writers use `\`.
    const rawPart = /\bp:path="([^"]*)"/i.exec(el)?.[1] ?? /\bpath="([^"]*)"/i.exec(el)?.[1];
    out.push({
      objectId,
      transform: parseTransform(/\btransform="([^"]*)"/i.exec(el)?.[1]),
      part: rawPart ? rawPart.replace(/\\/g, '/').replace(/^\/+/, '') : undefined,
    });
  }
  return out;
}

/**
 * One object's vertices and triangle indices.
 *
 * Vertices are declared once and shared by the triangles, which is how 3MF stores a mesh and why
 * it is compact: a closed mesh reuses each vertex in about six triangles.
 *
 * Counted before allocation so the data lands directly in typed arrays: collecting boxed
 * `number[]`s first costs tens of megabytes on a 2 M-triangle file, only to be copied out of.
 */
function parseMeshIndexed(
  body: string,
  withPaint = false,
): { vertices: Float32Array; triangles: Uint32Array; paints: string[] | null } {
  const vertsBlock = /<vertices\b[^>]*>([\s\S]*?)<\/vertices\s*>/i.exec(body)?.[1];
  const trisBlock = /<triangles\b[^>]*>([\s\S]*?)<\/triangles\s*>/i.exec(body)?.[1];
  if (!vertsBlock || !trisBlock) {
    return { vertices: new Float32Array(0), triangles: new Uint32Array(0), paints: null };
  }

  let vertexCount = 0;
  for (const _ of vertsBlock.matchAll(/<vertex\b[^>]*>/gi)) vertexCount++;
  const vertices = new Float32Array(vertexCount * 3);

  let vi = 0;
  for (const tag of vertsBlock.matchAll(/<vertex\b[^>]*>/gi)) {
    const el = tag[0];
    const x = Number(/\bx="([^"]*)"/i.exec(el)?.[1]);
    const y = Number(/\by="([^"]*)"/i.exec(el)?.[1]);
    const z = Number(/\bz="([^"]*)"/i.exec(el)?.[1]);
    vertices[vi++] = Number.isFinite(x) ? x : 0;
    vertices[vi++] = Number.isFinite(y) ? y : 0;
    vertices[vi++] = Number.isFinite(z) ? z : 0;
  }

  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n < vertexCount;

  let validTriangles = 0;
  for (const tag of trisBlock.matchAll(/<triangle\b[^>]*>/gi)) {
    const el = tag[0];
    const a = Number(/\bv1="(\d+)"/i.exec(el)?.[1]);
    const b = Number(/\bv2="(\d+)"/i.exec(el)?.[1]);
    const c = Number(/\bv3="(\d+)"/i.exec(el)?.[1]);
    // An index past the end is a corrupt file, not something to crash on.
    if (valid(a) && valid(b) && valid(c)) validTriangles++;
  }
  const triangles = new Uint32Array(validTriangles * 3);
  // Only allocated when asked for, and handed back as null when the file painted nothing: an
  // array of thousands of empty strings is not information worth carrying downstream.
  const paints: string[] | null = withPaint ? new Array<string>(validTriangles).fill('') : null;
  let anyPaint = false;

  let ti = 0;
  for (const tag of trisBlock.matchAll(/<triangle\b[^>]*>/gi)) {
    const el = tag[0];
    const a = Number(/\bv1="(\d+)"/i.exec(el)?.[1]);
    const b = Number(/\bv2="(\d+)"/i.exec(el)?.[1]);
    const c = Number(/\bv3="(\d+)"/i.exec(el)?.[1]);
    if (!(valid(a) && valid(b) && valid(c))) continue;
    if (paints) {
      const code = /\bpaint_color="([^"]*)"/i.exec(el)?.[1];
      if (code) { paints[ti / 3] = code; anyPaint = true; }
    }
    triangles[ti++] = a;
    triangles[ti++] = b;
    triangles[ti++] = c;
  }

  return { vertices, triangles, paints: anyPaint ? paints : null };
}

/** Vertex `i` of a flat vertex array, as a point. */
function vertexAt(vertices: Float32Array, i: number): [number, number, number] {
  const v = i * 3;
  return [vertices[v] ?? 0, vertices[v + 1] ?? 0, vertices[v + 2] ?? 0];
}

/**
 * Expands an indexed mesh into a soup, subdividing wherever a triangle is painted.
 *
 * A painted triangle is not one triangle on screen: the slicer stored the colour as a subdivision
 * tree, so a face with a heart drawn across it comes back as dozens of pieces in two filaments
 * (see `paint.ts`). Everything else passes straight through, so an unpainted file expands to
 * exactly what `expandMesh` gives.
 *
 * A code that does not decode leaves its triangle whole and unpainted.
 */
function expandMeshPainted(
  vertices: Float32Array,
  triangles: Uint32Array,
  paints: string[],
): { positions: Float32Array; filaments: Uint8Array } {
  const positions: number[] = [];
  const filaments: number[] = [];

  const push = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    filament: number,
  ) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    filaments.push(filament);
  };

  for (let i = 0; i < triangles.length; i += 3) {
    const a = vertexAt(vertices, triangles[i] ?? 0);
    const b = vertexAt(vertices, triangles[i + 1] ?? 0);
    const c = vertexAt(vertices, triangles[i + 2] ?? 0);

    const code = paints[i / 3] ?? '';
    if (!code) { push(a, b, c, 0); continue; }

    // The overwhelmingly common case: one colour over the whole face, and no reason to walk a
    // tree or allocate a midpoint for it.
    const flat = flatPaintState(code);
    if (flat !== null) { push(a, b, c, flat); continue; }

    if (!forEachPaintedTriangle(code, a, b, c, push)) push(a, b, c, 0);
  }

  return { positions: new Float32Array(positions), filaments: Uint8Array.from(filaments) };
}

/** Expands an indexed mesh into a flat triangle soup. */
function expandMesh(vertices: Float32Array, triangles: Uint32Array): Float32Array {
  const positions = new Float32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    const v = (triangles[i] ?? 0) * 3;
    positions[i * 3] = vertices[v] ?? 0;
    positions[i * 3 + 1] = vertices[v + 1] ?? 0;
    positions[i * 3 + 2] = vertices[v + 2] ?? 0;
  }
  return positions;
}

/** `<build><item objectid="1" transform="…"/></build>`: what actually gets placed. */
export function parseBuildItems(xml: string): { objectId: string; transform: Matrix12 }[] {
  const build = /<build\b[^>]*>([\s\S]*?)<\/build\s*>/i.exec(xml)?.[1];
  if (!build) return [];

  const items: { objectId: string; transform: Matrix12 }[] = [];
  for (const tag of build.matchAll(/<item\b[^>]*>/gi)) {
    const el = tag[0];
    const objectId = /\bobjectid="([^"]+)"/i.exec(el)?.[1];
    if (!objectId) continue;
    items.push({ objectId, transform: parseTransform(/\btransform="([^"]*)"/i.exec(el)?.[1]) });
  }
  return items;
}

/** A key that cannot collide with an object id: part and id, joined with a NUL. */
function keyOf(part: string, objectId: string): string {
  return `${part}\u0000${objectId}`;
}

/** Every object of every part, and the build items, tagged with their part. */
function indexParts(parts: ThreeMfPart[], withPaint = false): {
  objects: Map<string, ThreeMfObjectIndexed>;
  items: { part: string; objectId: string; transform: Matrix12 }[];
  /** The part that declares `<build>`; the first part with objects when none does. */
  rootPart: string;
  /** Object ids of the root part, for the no-build fallback. */
  rootIds: string[];
} {
  const objects = new Map<string, ThreeMfObjectIndexed>();
  const items: { part: string; objectId: string; transform: Matrix12 }[] = [];
  let rootPart = parts[0]?.name ?? '';
  let rootIds: string[] = [];
  let firstIds: string[] = [];
  let firstPart = '';

  for (const { name, xml } of parts) {
    const parsed = parseObjectsIndexed(xml, withPaint);
    for (const [id, object] of parsed) {
      objects.set(keyOf(name, id), object);
    }
    if (firstIds.length === 0 && parsed.size > 0) {
      firstIds = [...parsed.keys()];
      firstPart = name;
    }

    const partItems = parseBuildItems(xml);
    if (partItems.length > 0) {
      rootPart = name;
      rootIds = [...parsed.keys()];
      for (const item of partItems) items.push({ part: name, ...item });
    }
  }

  // No part declared a build: the fallback looks `rootIds` up in `keyOf(rootPart, …)`, so both
  // must come from the same part, the first one that has objects.
  if (rootIds.length === 0) {
    rootIds = firstIds;
    if (firstPart) rootPart = firstPart;
  }

  return { objects, items, rootPart, rootIds };
}

/**
 * Which objects sit on which plate.
 *
 * A multi-plate 3MF is **one model** whose objects are placed at different coordinates: plate 2
 * is not a separate mesh, it is the same build shifted along the bed. So loading the file and
 * drawing it gives every plate at once, side by side, which is not what anyone wants to look at.
 *
 * The grouping lives in the slicer's `model_settings.config`, not in the model XML:
 *
 * ```xml
 * <plate>
 *   <metadata key="index" value="1"/>
 *   <model_instance><metadata key="object_id" value="2"/></model_instance>
 * </plate>
 * ```
 *
 * Nothing in the 3MF core spec describes plates at all; they are a slicer's idea.
 *
 * Returns an empty map for a file with no plate blocks, which the caller must read as "this file
 * is one plate", not as "this file has none".
 */
export function parsePlateObjects(modelSettingsXml: string): Map<number, Set<string>> {
  const plates = new Map<number, Set<string>>();
  if (!modelSettingsXml) return plates;

  for (const block of modelSettingsXml.split(/<plate\b/i).slice(1)) {
    const end = block.search(/<\/plate\s*>/i);
    const body = end === -1 ? block : block.slice(0, end);

    const rawIndex = /<metadata[^>]*\bkey="(?:index|plater_id)"[^>]*\bvalue="(\d+)"/i.exec(body)?.[1];
    const index = rawIndex ? Number(rawIndex) : NaN;
    if (!Number.isFinite(index)) continue;

    const ids = plates.get(index) ?? new Set<string>();
    for (const tag of body.matchAll(/<metadata[^>]*\bkey="object_id"[^>]*\bvalue="([^"]+)"/gi)) {
      if (tag[1]) ids.add(tag[1]);
    }
    if (ids.size > 0) plates.set(index, ids);
  }

  return plates;
}

/**
 * The object ids of the plate the caller asked for, never "every plate".
 *
 * An unknown index (a plate the slicer renumbered) must not draw the whole build, which is the
 * all-plates-at-once view this exists to avoid. It falls back to the first plate instead. A
 * single-plate file has no plate to pick, so there is nothing to filter by.
 */
export function plateObjectsFor(
  plates: Map<number, Set<string>>,
  index: number,
): ReadonlySet<string> | undefined {
  if (plates.size <= 1) return undefined;
  return plates.get(index) ?? plates.values().next().value;
}

/** Guards against a component graph that references itself. */
const MAX_DEPTH = 16;

/**
 * The whole build across every model part of an archive, split by top-level object.
 *
 * Components are expanded recursively with their transforms composed, which is what makes an
 * assembly come out assembled rather than as a pile of parts at the origin. Depth is capped
 * because a 3MF references objects by id and nothing in the format stops a file from doing so in
 * a cycle.
 *
 * Bambu Studio writes big assemblies as several `.model` files: the root document holds `<build>`
 * items and assembly objects whose `<component>`s name the real geometry through the Production
 * extension's `p:path` (`3D/Objects/object_17.model`, say). Reading only the root gives an empty
 * scene, because the root has no vertices of its own. Components resolve wherever their `p:path`
 * points, or the current part when they have none.
 *
 * A build with no items falls back to every object of the first part that has any: some
 * exporters write no `<build>` at all, and a model on screen beats a correct empty scene.
 *
 * `onlyObjectIds` narrows the build to one plate's objects (see `parsePlateObjects`, which reads
 * the root part's ids). Omitted, it builds everything.
 *
 * `options.paint` reads per-face paint and part ranges, which only a caller that shows colour
 * needs.
 */
export function buildMeshFromParts(
  parts: ThreeMfPart[],
  onlyObjectIds?: ReadonlySet<string>,
  options: { paint?: boolean } = {},
): ThreeMfMesh {
  const withPaint = options.paint === true;
  const { objects, items, rootPart, rootIds } = indexParts(parts, withPaint);

  interface Bucket {
    id: string;
    name: string | null;
    /** The `.model` entry the top-level object was found in. */
    entry: string;
    chunks: Float32Array[];
    /** Index-aligned with `chunks`; null for a chunk that carried no paint. */
    paintChunks: (Uint8Array | null)[];
    /**
     * Index-aligned with `chunks`: the object each chunk's geometry came from, its name, and the
     * `.model` entry it was read from, which is not always the bucket's own, as a component may
     * cross into another part. Left empty unless paint was asked for (see `partRanges`).
     */
    partIds: string[];
    partNames: (string | null)[];
    partEntries: string[];
  }

  // One bucket per top-level object, so each object keeps its own colour: a single merged soup
  // has no object to hang a colour on. Components recurse into the bucket of the object that
  // references them; they are pieces of it, not objects of their own.
  const buckets: Bucket[] = [];

  const emit = (part: string, objectId: string, transform: Matrix12, depth: number, parent: Bucket | null) => {
    if (depth > MAX_DEPTH) return;
    const object = objects.get(keyOf(part, objectId));
    if (!object) return;

    let bucket = parent;
    if (depth === 0 || !bucket) {
      bucket = {
        id: objectId, name: object.name ?? null, entry: part,
        chunks: [], paintChunks: [], partIds: [], partNames: [], partEntries: [],
      };
      buckets.push(bucket);
    }

    if (object.vertices.length > 0) {
      // Painting subdivides, so the soup and the per-triangle colours have to be produced
      // together: a colour array built against the unsplit triangles would be off by however
      // many pieces the first painted face turned into.
      const painted = withPaint && object.paints
        ? expandMeshPainted(object.vertices, object.triangles, object.paints)
        : null;
      const soup = painted ? painted.positions : expandMesh(object.vertices, object.triangles);
      const out = new Float32Array(soup.length);
      for (let i = 0; i < soup.length; i += 3) {
        const [x, y, z] = apply(transform, soup[i] ?? 0, soup[i + 1] ?? 0, soup[i + 2] ?? 0);
        out[i] = x; out[i + 1] = y; out[i + 2] = z;
      }
      bucket.chunks.push(out);
      bucket.paintChunks.push(painted ? painted.filaments : null);
      // Which object this run of triangles belongs to, so an assembly can be coloured part by
      // part. Only tracked under `paint`, because only that caller can show the difference.
      if (withPaint) {
        bucket.partIds.push(objectId);
        bucket.partNames.push(object.name ?? null);
        bucket.partEntries.push(part);
      }
    }

    for (const component of object.components) {
      emit(component.part ?? part, component.objectId, composeTransforms(transform, component.transform), depth + 1, bucket);
    }
  };

  // `onlyObjectIds` filters at the *top* of the graph, not inside `emit`: a component is part of
  // whatever object references it, and excluding it separately would take pieces out of a model
  // that was selected.
  const wanted = (id: string) => !onlyObjectIds || onlyObjectIds.has(id);

  if (items.length > 0) {
    for (const item of items) if (wanted(item.objectId)) emit(item.part, item.objectId, item.transform, 0, null);
  } else {
    // No build: emit every root object. No vertices-length guard here: an assembly object has
    // none of its own, but its components may still carry the geometry.
    for (const id of rootIds) {
      if (objects.has(keyOf(rootPart, id)) && wanted(id)) emit(rootPart, id, IDENTITY, 0, null);
    }
  }

  // A bucket that collected nothing (an object whose components all failed to resolve) has
  // nothing to draw; dropping it keeps the caller from building zero-vertex meshes.
  const meshObjects: ThreeMfMeshObject[] = buckets
    .filter((b) => b.chunks.length > 0)
    .map((b) => {
      const total = b.chunks.reduce((n, c) => n + c.length, 0);
      const positions = new Float32Array(total);
      let offset = 0;
      for (const chunk of b.chunks) { positions.set(chunk, offset); offset += chunk.length; }

      // One walk of the chunks answers both questions, because they are the same walk: the
      // triangle each chunk starts at is where its filaments go and where its part's range
      // begins.
      //
      // `filaments` gets one entry per triangle, and only when some component of this object was
      // painted. A component that was not keeps its zeros, which reads as "this object's own
      // colour", the same thing an unpainted file gets.
      const filaments: Uint8Array | null =
        b.paintChunks.some((p) => p !== null) ? new Uint8Array(total / 9) : null;
      const partRanges: ThreeMfPartRange[] | null = b.partIds.length > 0 ? [] : null;

      let tri = 0;
      b.chunks.forEach((chunk, i) => {
        const count = chunk.length / 9;
        const paint = b.paintChunks[i];
        if (filaments && paint) filaments.set(paint, tri);
        partRanges?.push({
          id: b.partIds[i] ?? b.id, name: b.partNames[i] ?? null,
          entry: b.partEntries[i] ?? b.entry, start: tri, count,
        });
        tri += count;
      });

      return { id: b.id, name: b.name, entry: b.entry, positions, filaments, partRanges };
    });

  const total = meshObjects.reduce((n, o) => n + o.positions.length, 0);
  const positions = new Float32Array(total);
  let offset = 0;
  for (const o of meshObjects) { positions.set(o.positions, offset); offset += o.positions.length; }

  return { positions, triangles: Math.floor(total / 9), objects: meshObjects };
}
