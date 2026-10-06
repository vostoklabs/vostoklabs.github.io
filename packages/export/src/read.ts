// Reading a model file: STL (binary and ASCII), OBJ and 3MF, as one triangle list in millimetres.
//
// The writers' other half, for a generator that starts from someone's model (the clicker's
// Model mode) or from a bundled asset (the MX switch). No DOM and no three.js, so it runs in a
// worker: fflate to unzip, and plain string scanning. Its own module, with no import but
// fflate, so a worker that reads models carries nothing else of this package.
//
// Colours, materials, UVs and object names are dropped: everything in the file is the shape.
import { strFromU8, unzipSync } from 'fflate';

export type ModelFormat = 'stl' | 'obj' | '3mf';

/** A model as one triangle list. */
export interface ModelMesh {
  /** xyz per vertex, millimetres. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
}

/** The format a file's name says it is, by its extension, or null. */
export function modelFormatOf(name: string): ModelFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext === 'stl' || ext === 'obj' || ext === '3mf' ? ext : null;
}

/**
 * Read a model file: by its name's extension, or for a name without one, by its first bytes.
 *
 * Every coordinate is read as a double and scaled to millimetres (and placed, in a 3MF) before
 * it is rounded to a float once. Rounding first and scaling after moves a vertex of a file
 * written in metres by a unit in the last place, and a solid made from it is no longer the
 * same solid. Each file of a 3MF is read in its own unit, and a placement in the unit of the
 * file that wrote it.
 *
 * STL and OBJ come back as written (an STL as a triangle soup, three vertices per triangle);
 * welding, repair and orientation are the caller's business. A file with no triangles throws,
 * with a sentence a person can read, and so does a binary STL whose size does not match the
 * triangle count in its header.
 */
export function readModel(bytes: Uint8Array | ArrayBuffer, name: string): ModelMesh {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = modelFormatOf(name) ?? sniff(data);
  if (format === '3mf') return read3mf(data);
  if (format === 'obj') return readObj(data);
  return readStl(data);
}

/** A name with no useful extension: a zip is a 3MF, a line starting "v " is an OBJ. */
function sniff(data: Uint8Array): ModelFormat {
  if (data[0] === 0x50 && data[1] === 0x4b) return '3mf';
  const text = new TextDecoder().decode(data.subarray(0, 512));
  if (/^\s*(#.*\n\s*)*(v|o|g|mtllib)\s/m.test(text) && !/^\s*solid\s/.test(text)) return 'obj';
  return 'stl';
}

/** Three vertex indices per triangle for a soup: 0, 1, 2, 3… */
function soupIndices(vertexCount: number): Uint32Array {
  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;
  return indices;
}

// ---------------------------------------------------------------------------------------- STL

function readStl(data: Uint8Array): ModelMesh {
  // A binary STL's size is fixed by its triangle count, and that is the only reliable test:
  // plenty of binary files begin their 80-byte header with "solid", and some ASCII writers
  // leave out the closing "endsolid".
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength >= 84) {
    const count = view.getUint32(80, true);
    const size = 84 + count * 50;
    if (size === data.byteLength) {
      if (count === 0) throw new Error('This STL has no triangles in it.');
      const positions = new Float32Array(count * 9);
      for (let t = 0; t < count; t++) {
        // 12 bytes of facet normal first: never trusted, the winding says which way is out.
        const at = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(at + k * 4, true);
      }
      return { positions, indices: soupIndices(count * 3) };
    }
    // Binary all the same, at the wrong size: text has no zero byte, and a binary STL's count
    // has one (its top byte, below 16.7 million triangles). Bytes went missing, or came after.
    if (data.subarray(0, 84).includes(0)) {
      throw new Error(`This binary STL is damaged: its header gives ${count} triangles, which take ${size} bytes, but the file is ${data.byteLength} bytes.`);
    }
  }
  const text = new TextDecoder().decode(data);
  const coords: number[] = [];
  const vertex = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  for (let m = vertex.exec(text); m; m = vertex.exec(text)) coords.push(+m[1]!, +m[2]!, +m[3]!);
  coords.length -= coords.length % 9;
  if (!coords.length) throw new Error('This STL has no triangles in it.');
  return { positions: Float32Array.from(coords), indices: soupIndices(coords.length / 3) };
}

// ---------------------------------------------------------------------------------------- OBJ

function readObj(data: Uint8Array): ModelMesh {
  const text = new TextDecoder().decode(data);
  const coords: number[] = [];
  const triangles: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      coords.push(+p[1]!, +p[2]!, +p[3]!);
    } else if (line.startsWith('f ')) {
      const written = coords.length / 3;
      const corners: number[] = [];
      for (const token of line.split(/\s+/).slice(1)) {
        const v = parseInt(token, 10); // "7/2/5" is vertex 7
        if (!Number.isFinite(v) || v === 0) continue;
        corners.push(v > 0 ? v - 1 : written + v); // a negative index counts back from the last vertex
      }
      // A polygon, fanned from its first corner: right for the convex faces OBJ writers make.
      for (let i = 1; i + 1 < corners.length; i++) triangles.push(corners[0]!, corners[i]!, corners[i + 1]!);
    }
  }
  if (!triangles.length) throw new Error('This OBJ has no faces in it.');
  return { positions: Float32Array.from(coords), indices: Uint32Array.from(triangles) };
}

// ---------------------------------------------------------------------------------------- 3MF

const MM_PER_UNIT: Record<string, number> = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};

/** A 3MF transform: twelve numbers, row-major 4x3, a point taken as [x y z 1] times it. */
type Transform = readonly number[];
const IDENTITY: Transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const isIdentity = (t: Transform) => t.every((v, i) => v === IDENTITY[i]);

function transformOf(attr: string | undefined): Transform {
  if (!attr) return IDENTITY;
  const n = attr.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : IDENTITY;
}

/** `first`, then `then`: the transform that does both. */
function compose(first: Transform, then: Transform): Transform {
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let v = row === 3 ? then[9 + col]! : 0;
      for (let k = 0; k < 3; k++) v += first[row * 3 + k]! * then[k * 3 + col]!;
      out.push(v);
    }
  }
  return out;
}

interface Ref {
  id: string;
  /** The model file it lives in (the production extension's `p:path`), or null for this one. */
  path: string | null;
  transform: Transform;
}
interface ModelPart {
  /** Millimetres per unit of this file. */
  scale: number;
  /** Object id -> its vertices, as written (doubles), and its triangles. */
  meshes: Map<string, { coords: number[]; triangles: number[] }>;
  /** Object id -> the objects it is made of. */
  components: Map<string, Ref[]>;
  /** What the file builds. */
  items: Ref[];
}

/** An attribute of a tag's attribute text, by name, in double quotes or single: XML takes both. */
const ATTR = new Map<string, RegExp>();
function attrOf(tag: string, name: string): string | undefined {
  let re = ATTR.get(name);
  if (!re) ATTR.set(name, (re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)));
  const m = re.exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
}

function readModelPart(xml: string): ModelPart {
  const unit = (attrOf(/<model\b([^>]*)>/.exec(xml)?.[1] ?? '', 'unit') || 'millimeter').toLowerCase();
  const part: ModelPart = { scale: MM_PER_UNIT[unit] ?? 1, meshes: new Map(), components: new Map(), items: [] };
  const objects = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  for (let m = objects.exec(xml); m; m = objects.exec(xml)) {
    const id = attrOf(m[1]!, 'id');
    if (id === undefined) continue;
    const body = m[2]!;
    if (/<mesh\b/.test(body)) {
      const coords: number[] = [];
      const vertices = /<vertex\b([^>]*)>/g;
      for (let v = vertices.exec(body); v; v = vertices.exec(body)) {
        coords.push(+(attrOf(v[1]!, 'x') ?? 0), +(attrOf(v[1]!, 'y') ?? 0), +(attrOf(v[1]!, 'z') ?? 0));
      }
      const triangles: number[] = [];
      const tris = /<triangle\b([^>]*)>/g;
      for (let t = tris.exec(body); t; t = tris.exec(body)) {
        triangles.push(+(attrOf(t[1]!, 'v1') ?? 0), +(attrOf(t[1]!, 'v2') ?? 0), +(attrOf(t[1]!, 'v3') ?? 0));
      }
      part.meshes.set(id, { coords, triangles });
    }
    const refs: Ref[] = [];
    const components = /<component\b([^>]*)>/g;
    for (let c = components.exec(body); c; c = components.exec(body)) {
      const of = attrOf(c[1]!, 'objectid');
      if (of !== undefined) refs.push({ id: of, path: attrOf(c[1]!, 'p:path') ?? null, transform: transformOf(attrOf(c[1]!, 'transform')) });
    }
    if (refs.length) part.components.set(id, refs);
  }
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml)?.[1] ?? '';
  const items = /<item\b([^>]*)>/g;
  for (let m = items.exec(build); m; m = items.exec(build)) {
    const id = attrOf(m[1]!, 'objectid');
    if (id !== undefined) part.items.push({ id, path: attrOf(m[1]!, 'p:path') ?? null, transform: transformOf(attrOf(m[1]!, 'transform')) });
  }
  return part;
}

function read3mf(data: Uint8Array): ModelMesh {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(data);
  } catch {
    throw new Error('This 3MF could not be opened — it is not a valid zip.');
  }
  const keyOf = (path: string) => path.replace(/^\//, '').toLowerCase();
  const parts = new Map<string, ModelPart>();
  for (const [path, entry] of Object.entries(zip)) {
    if (path.toLowerCase().endsWith('.model')) parts.set(keyOf(path), readModelPart(strFromU8(entry)));
  }
  // The root model is the one the package's relationships name; in practice that is always
  // 3D/3dmodel.model, and the first model found covers the rest.
  const root = parts.get('3d/3dmodel.model') ?? [...parts.values()][0];
  if (!root) throw new Error('This 3MF has no model in it.');

  const coords: number[] = [];
  const triangles: number[] = [];
  /** A transform written in one file's unit, in another's: its turn has no unit, its shift is a
   *  length. Between files of one unit it is the transform itself. */
  const inUnitOf = (t: Transform, from: ModelPart, to: ModelPart): Transform => {
    if (from.scale === to.scale) return t;
    const k = from.scale / to.scale;
    return [...t.slice(0, 9), t[9]! * k, t[10]! * k, t[11]! * k];
  };
  /** Emit object `id` of `file`, placed by `written`: a transform in the unit of `from`, the file
   *  that wrote it (the root for a build item, the object's owner for a component). */
  const emit = (from: ModelPart, file: string | null, id: string, written: Transform, depth: number) => {
    if (depth > 16) return; // a component cycle would never end
    const part = (file && parts.get(file)) || root;
    const t = inUnitOf(written, from, part);
    const mesh = part.meshes.get(id);
    if (mesh) {
      const first = coords.length / 3;
      const s = part.scale;
      const c = mesh.coords;
      if (isIdentity(t)) {
        for (let i = 0; i < c.length; i++) coords.push(c[i]! * s);
      } else {
        for (let i = 0; i < c.length; i += 3) {
          const x = c[i]!, y = c[i + 1]!, z = c[i + 2]!;
          coords.push(
            (x * t[0]! + y * t[3]! + z * t[6]! + t[9]!) * s,
            (x * t[1]! + y * t[4]! + z * t[7]! + t[10]!) * s,
            (x * t[2]! + y * t[5]! + z * t[8]! + t[11]!) * s,
          );
        }
      }
      for (const v of mesh.triangles) triangles.push(first + v);
    }
    for (const ref of part.components.get(id) ?? []) {
      emit(part, ref.path ? keyOf(ref.path) : file, ref.id, compose(ref.transform, t), depth + 1);
    }
  };
  const items = root.items.length ? root.items : [...root.meshes.keys()].map((id) => ({ id, path: null, transform: IDENTITY }));
  for (const item of items) emit(root, item.path ? keyOf(item.path) : null, item.id, item.transform, 0);
  if (!triangles.length) throw new Error('This 3MF has no triangles in it.');
  // The one rounding: everything above is in doubles.
  return { positions: Float32Array.from(coords), indices: Uint32Array.from(triangles) };
}
