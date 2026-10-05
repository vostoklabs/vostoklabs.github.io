// Read an uploaded 3D model: STL (binary and ASCII), OBJ, 3MF. Runs in the worker, so there is
// no DOMParser and no three.js here — plain byte and string scanning, the same approach the
// clicker already takes for its own 3MF assets (geometry/threemfImport.ts).
//
// Everything comes out as one triangle list in millimetres. Colours, materials, UVs and object
// names are dropped: a clicker is cut from the shape, and every object in the file is part of
// the shape the user meant.
import { strFromU8, unzipSync } from 'fflate';
import { modelFormatOf, type ModelFormat } from '@vostok/export/read';

// Which files Model mode opens, by their extension, is the shelf's model reader's answer.
export { modelFormatOf, type ModelFormat };

export interface RawModel {
  /** xyz per vertex, mm. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
}

/** The formats Model mode opens, by extension. */
export const MODEL_EXTENSIONS = ['stl', '3mf', 'obj'] as const;

export function parseModel(bytes: ArrayBuffer, name: string): RawModel {
  const format = modelFormatOf(name) ?? sniff(bytes);
  if (format === '3mf') return parse3MFModel(bytes);
  if (format === 'obj') return parseOBJ(bytes);
  return parseSTL(bytes);
}

/** A file with no useful extension: a zip is a 3MF, a line starting "v " is an OBJ. */
function sniff(bytes: ArrayBuffer): ModelFormat {
  const head = new Uint8Array(bytes, 0, Math.min(512, bytes.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) return '3mf';
  const text = new TextDecoder().decode(head);
  if (/^\s*(#.*\n\s*)*(v|o|g|mtllib)\s/m.test(text) && !/^\s*solid\s/.test(text)) return 'obj';
  return 'stl';
}

// ---------------------------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------------------------

export function parseSTL(bytes: ArrayBuffer): RawModel {
  // Binary STL's size is fixed by its triangle count, which is the only reliable test: plenty of
  // binary files start their 80-byte header with the word "solid", and some ASCII exporters do
  // not end with "endsolid".
  if (bytes.byteLength >= 84) {
    const n = new DataView(bytes).getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) return parseBinarySTL(bytes, n);
  }
  return parseAsciiSTL(bytes);
}

function parseBinarySTL(bytes: ArrayBuffer, n: number): RawModel {
  const dv = new DataView(bytes);
  const positions = new Float32Array(n * 9);
  let o = 84;
  for (let t = 0; t < n; t++) {
    o += 12; // the facet normal: recomputed from the winding, never trusted
    for (let k = 0; k < 9; k++) {
      positions[t * 9 + k] = dv.getFloat32(o, true);
      o += 4;
    }
    o += 2; // attribute byte count
  }
  return soup(positions);
}

function parseAsciiSTL(bytes: ArrayBuffer): RawModel {
  const text = new TextDecoder().decode(bytes);
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  const whole = out.length - (out.length % 9);
  if (whole < 9) throw new Error('This STL has no triangles in it.');
  return soup(Float32Array.from(out.slice(0, whole)));
}

/** A triangle soup (three fresh vertices per triangle), indexed trivially. Welding happens in
 *  prepare.ts, for every format alike. */
function soup(positions: Float32Array): RawModel {
  const indices = new Uint32Array(positions.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

// ---------------------------------------------------------------------------------------------
// OBJ
// ---------------------------------------------------------------------------------------------

export function parseOBJ(bytes: ArrayBuffer): RawModel {
  const text = new TextDecoder().decode(bytes);
  const verts: number[] = [];
  const tris: number[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const p = line.split(/\s+/).slice(1);
      const count = verts.length / 3;
      const ids: number[] = [];
      for (const tok of p) {
        const v = parseInt(tok, 10); // "7/2/5" → 7
        if (!Number.isFinite(v) || v === 0) continue;
        ids.push(v > 0 ? v - 1 : count + v); // negative = relative to the end so far
      }
      // A polygon, fanned from its first corner. OBJ faces are convex in practice; a concave
      // n-gon fans wrongly, and the weld/validate step reports what that does to the solid.
      for (let i = 1; i + 1 < ids.length; i++) tris.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  if (tris.length < 3) throw new Error('This OBJ has no faces in it.');
  return { positions: Float32Array.from(verts), indices: Uint32Array.from(tris) };
}

// ---------------------------------------------------------------------------------------------
// 3MF
// ---------------------------------------------------------------------------------------------

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};

/** 3MF's affine transform: twelve numbers, row-major 4×3, applied as [x y z 1] · M. */
type Affine = number[];
const IDENTITY: Affine = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseAffine(s: string | undefined): Affine {
  if (!s) return IDENTITY;
  const n = s.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : IDENTITY;
}

/** a then b: a point transformed by a, then by b. */
function compose(a: Affine, b: Affine): Affine {
  const r = new Array<number>(12);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let v = row === 3 ? b[9 + col] : 0;
      for (let k = 0; k < 3; k++) v += a[row * 3 + k] * b[k * 3 + col];
      r[row * 3 + col] = v;
    }
  }
  return r;
}

interface MeshObject {
  verts: Float32Array;
  tris: Uint32Array;
}
interface ComponentRef {
  id: string;
  path: string | null;
  transform: Affine;
}
interface ModelFile {
  scale: number;
  meshes: Map<string, MeshObject>;
  components: Map<string, ComponentRef[]>;
  items: ComponentRef[];
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];

function readModelFile(xml: string): ModelFile {
  const unit = (/<model[^>]*\bunit\s*=\s*"([^"]+)"/.exec(xml)?.[1] ?? 'millimeter').toLowerCase();
  const file: ModelFile = {
    scale: UNIT_TO_MM[unit] ?? 1,
    meshes: new Map(),
    components: new Map(),
    items: [],
  };
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(xml))) {
    const id = attr(m[1], 'id');
    if (!id) continue;
    const body = m[2];
    if (/<mesh\b/.test(body)) {
      const v: number[] = [];
      const vre = /<vertex\b([^>]*)\/?>/g;
      let q: RegExpExecArray | null;
      while ((q = vre.exec(body))) v.push(+(attr(q[1], 'x') ?? 0), +(attr(q[1], 'y') ?? 0), +(attr(q[1], 'z') ?? 0));
      const t: number[] = [];
      const tre = /<triangle\b([^>]*)\/?>/g;
      while ((q = tre.exec(body))) t.push(+(attr(q[1], 'v1') ?? 0), +(attr(q[1], 'v2') ?? 0), +(attr(q[1], 'v3') ?? 0));
      file.meshes.set(id, { verts: Float32Array.from(v), tris: Uint32Array.from(t) });
    }
    const comps: ComponentRef[] = [];
    const cre = /<component\b([^>]*)\/?>/g;
    let c: RegExpExecArray | null;
    while ((c = cre.exec(body))) {
      const cid = attr(c[1], 'objectid');
      if (cid) comps.push({ id: cid, path: attr(c[1], 'p:path') ?? null, transform: parseAffine(attr(c[1], 'transform')) });
    }
    if (comps.length) file.components.set(id, comps);
  }
  const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml)?.[1] ?? '';
  const ire = /<item\b([^>]*)\/?>/g;
  while ((m = ire.exec(build))) {
    const id = attr(m[1], 'objectid');
    if (id) file.items.push({ id, path: attr(m[1], 'p:path') ?? null, transform: parseAffine(attr(m[1], 'transform')) });
  }
  return file;
}

export function parse3MFModel(bytes: ArrayBuffer): RawModel {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error('This 3MF could not be opened — it is not a valid zip.');
  }
  const files = new Map<string, ModelFile>();
  const keyOf = (path: string) => path.replace(/^\//, '').toLowerCase();
  for (const [path, data] of Object.entries(zip)) {
    if (path.toLowerCase().endsWith('.model')) files.set(keyOf(path), readModelFile(strFromU8(data)));
  }
  // The root model is the one the package's relationships point at; in practice it is always
  // 3D/3dmodel.model, and falling back to the first .model found covers the rest.
  const root = files.get('3d/3dmodel.model') ?? [...files.values()][0];
  if (!root) throw new Error('This 3MF has no model in it.');

  const pos: number[] = [];
  const idx: number[] = [];
  const emit = (fileKey: string | null, id: string, t: Affine, depth: number) => {
    if (depth > 16) return; // a component cycle would otherwise never end
    const file = (fileKey && files.get(fileKey)) || root;
    const mesh = file.meshes.get(id);
    if (mesh) {
      const base = pos.length / 3;
      const s = file.scale;
      for (let i = 0; i < mesh.verts.length; i += 3) {
        const x = mesh.verts[i];
        const y = mesh.verts[i + 1];
        const z = mesh.verts[i + 2];
        pos.push(
          (x * t[0] + y * t[3] + z * t[6] + t[9]) * s,
          (x * t[1] + y * t[4] + z * t[7] + t[10]) * s,
          (x * t[2] + y * t[5] + z * t[8] + t[11]) * s,
        );
      }
      for (let i = 0; i < mesh.tris.length; i++) idx.push(base + mesh.tris[i]);
    }
    for (const c of file.components.get(id) ?? []) {
      emit(c.path ? keyOf(c.path) : fileKey, c.id, compose(c.transform, t), depth + 1);
    }
  };
  const items = root.items.length
    ? root.items
    : [...root.meshes.keys()].map((id) => ({ id, path: null, transform: IDENTITY }));
  for (const item of items) emit(item.path ? keyOf(item.path) : null, item.id, item.transform, 0);
  if (idx.length < 3) throw new Error('This 3MF has no triangles in it.');
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
