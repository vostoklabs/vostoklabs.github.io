/*
  Every model file the clicker opens, read through the shelf's reader, pinned.

    node apps/clicker-generator/tests/suites.mjs golden/readers      (part of pnpm test)

  The clicker reads its MX assets (the socket, stem and switch, written in metres), its Model-mode
  samples and every uploaded model with `readModel` (@vostok/export, "Model reader"), in the
  geometry worker. It used to read them with two readers of its own, and before those went this
  test compared `readModel` with both, array for array: the same floats and the same triangles for
  every file below. The hashes are what all three gave, so a change to what the clicker reads
  fails here, file by file: the MX assets, every Model-mode sample, and an upload of each shape the
  clicker's own suites read (binary and ASCII STL, an OBJ with quads and negative indices, a file
  with no extension).

  Where the old upload reader rounded a vertex to a float before it scaled or placed it, the shelf
  scales and places the double and rounds once: a 3MF in another unit, or a part placed by a
  transform, comes out where the file puts it, to a float's last place. A -0 in the file is kept.
  Those cases are held to where the file puts them at the end.
*/
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { readModel } from '@vostok/export/read';
import { MODEL_SAMPLES } from '../../src/model/samples.ts';

const APP = join(process.cwd(), 'apps/clicker-generator');
const asset = (p: string): ArrayBuffer => {
  const b = readFileSync(join(APP, 'public/assets', p));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
};

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const hash = (m: { positions: Float32Array; indices: Uint32Array }) =>
  createHash('sha256').update(bytes(m.positions)).update(bytes(m.indices)).digest('hex').slice(0, 16);

/** What the clicker read for each file, its own readers and the shelf's alike. */
const GOLDEN: Record<string, string> = {
  'MX mx-socket.3mf': '06c865c2dda6be23',
  'MX mx-stem.3mf': '70e0a0abaf9c1e11',
  'MX mx-switch.3mf': 'd3b74a9bea483b8b',
  'sample pumpkin.3mf': '59c6481b5067267f',
  'sample skull.3mf': '7808a68f70162cbc',
  'sample ghost.3mf': 'a8b7805733a388b6',
  'sample duck.3mf': '4d0e65d9f03ea8ea',
  'sample cupcake.3mf': '2b8d2faa3e5cfbae',
  'binary STL': '3fde8086313eb92c',
  'ASCII STL': '3fde8086313eb92c',
  'OBJ, quads and negative indices': 'e2e9d9049a63d566',
  'a file with no extension (STL)': '3fde8086313eb92c',
};

const actual: Record<string, string> = {};
function pin(name: string, file: string, data: ArrayBuffer) {
  const mesh = readModel(data, file);
  actual[name] = hash(mesh);
  check(`${name}: read as the clicker always read it`, actual[name] === GOLDEN[name], `${mesh.positions.length / 3} vertices, ${mesh.indices.length / 3} triangles, ${actual[name]}`);
}

/* ------------------------------------------------------------------ the MX assets (metres) */

for (const file of ['mx-socket.3mf', 'mx-stem.3mf', 'mx-switch.3mf']) pin(`MX ${file}`, file, asset(`switch/mx/${file}`));

/* ------------------------------------------------------------------ the Model-mode samples */

for (const sample of MODEL_SAMPLES) pin(`sample ${sample.id}.3mf`, `${sample.id}.3mf`, asset(`samples/${sample.id}.3mf`));

/* ------------------------------------------------------------------ uploads the clicker reads */

// A ball, as a binary and an ASCII STL; an OBJ cube of quads, half of it by negative index.
const ball: number[] = [];
const ballTris: number[] = [];
{
  const rings = 12;
  const segs = 24;
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = (Math.PI * r) / rings;
      const b = (2 * Math.PI * s) / segs;
      ball.push(20 * Math.sin(a) * Math.cos(b) + 0.123, 20 * Math.sin(a) * Math.sin(b) - 4.5, 20 * Math.cos(a) + 21.75);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const p = r * segs + s;
      const q = r * segs + ((s + 1) % segs);
      ballTris.push(p, q, p + segs, q, q + segs, p + segs);
    }
  }
}
function binarySTL(): ArrayBuffer {
  const n = ballTris.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const v = ballTris[t * 3 + k]! * 3;
      for (let c = 0; c < 3; c++) dv.setFloat32(84 + t * 50 + 12 + k * 12 + c * 4, ball[v + c]!, true);
    }
  }
  return buf;
}
function asciiSTL(): ArrayBuffer {
  const lines = ['solid ball'];
  for (let t = 0; t < ballTris.length; t += 3) {
    lines.push(' facet normal 0 0 0', '  outer loop');
    for (let k = 0; k < 3; k++) {
      const v = ballTris[t + k]! * 3;
      lines.push(`   vertex ${ball[v]} ${ball[v + 1]} ${ball[v + 2]}`);
    }
    lines.push('  endloop', ' endfacet');
  }
  lines.push('endsolid ball');
  return strToU8(lines.join('\n')).buffer as ArrayBuffer;
}
const cubeObj = strToU8([
  'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0',
  'v 0 0 10.25', 'v 10 0 10.25', 'v 10 10 10.25', 'v 0 10 10.25',
  'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5',
  'f -6/1/1 -5/2/2 -1/3/3 -2/4/4', 'f -5 -8 -4 -1', 'f -7 -6 -2 -3',
].join('\n')).buffer as ArrayBuffer;

for (const [name, file, data] of [
  ['binary STL', 'ball.stl', binarySTL()],
  ['ASCII STL', 'ball.stl', asciiSTL()],
  ['OBJ, quads and negative indices', 'cube.obj', cubeObj],
  ['a file with no extension (STL)', 'ball', binarySTL()],
] as [string, string, ArrayBuffer][]) {
  pin(name, file, data);
}

/* ------------------------------------------------------------------ read where the file puts it */

/** The largest distance, mm, between what was read and where the file puts each vertex. */
function worst(positions: Float32Array, exact: number[]): number {
  let w = 0;
  for (let i = 0; i < positions.length; i++) w = Math.max(w, Math.abs(positions[i]! - exact[i]!));
  return w;
}

{
  // Bambu's production layout: a part in its own file, pulled in by a component with a turn and
  // a shift, in centimetres; off-grid numbers, so rounding before placing would show.
  const verts: number[][] = [];
  const tris: number[][] = [];
  for (let i = 0; i < 40; i++) verts.push([Math.cos(i * 0.7) * 1.37, Math.sin(i * 1.3) * 2.11, (i % 7) * 0.333]);
  for (let i = 0; i + 2 < 40; i++) tris.push([i, i + 1, i + 2]);
  const part = '<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>'
    + verts.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')
    + '</vertices><triangles>' + tris.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('')
    + '</triangles></mesh></object></resources><build/></model>';
  const root = '<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>'
    + '<object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="0.8 0.6 0 -0.6 0.8 0 0 0 1 2.0137 -1.31 0.25"/></components></object>'
    + '</resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 12.7 3.3 0"/></build></model>';
  const zip = zipSync({ '3D/3dmodel.model': strToU8(root), '3D/Objects/object_1.model': strToU8(part) });
  const mesh = readModel(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, 'part.3mf');
  // Where each vertex really is: the decimals in the file, turned, shifted and scaled in doubles.
  const exact: number[] = [];
  for (const [x, y, z] of verts) {
    const cx = (x! * 0.8 + y! * -0.6 + 2.0137) * 10;
    const cy = (x! * 0.6 + y! * 0.8 - 1.31) * 10;
    exact.push(cx + 127, cy + 33, (z! + 0.25) * 10);
  }
  check('placed by a transform: the triangles as written', mesh.indices.join() === tris.flat().join());
  const w = worst(mesh.positions, exact);
  check('placed by a transform: every vertex where the file puts it, to a float\'s last place', mesh.positions.length === exact.length && w < 2e-5, `at most ${w.toExponential(1)} mm off`);
}

{
  // No transform, but in centimetres: scaled as a double, rounded once.
  const verts: number[][] = [];
  for (let i = 0; i < 40; i++) verts.push([Math.cos(i * 0.9) * 2.37, Math.sin(i * 1.1) * 1.91, (i % 5) * 0.271]);
  const model = '<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>'
    + verts.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')
    + '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
  const zip = zipSync({ '3D/3dmodel.model': strToU8(model) });
  const mesh = readModel(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, 'cm.3mf');
  const exact = verts.flat().map((v) => v * 10);
  const fround = mesh.positions.every((p, i) => p === Math.fround(exact[i]!));
  check('in centimetres: every coordinate the file\'s, scaled, then rounded to a float once', mesh.positions.length === exact.length && fround);

  // A -0 written in the file.
  const signed = zipSync({ '3D/3dmodel.model': strToU8(model.replace(/x="[^"]*"/, 'x="-0"')) });
  const zero = readModel(signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer, 'zero.3mf').positions[0]!;
  check('a -0 in the file is kept', Object.is(zero, -0), Object.is(zero, -0) ? '-0' : String(zero));
}

/* ------------------------------------------------------------------ report */

console.log(`\nreaders: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nThe shelf reader now gives (paste over GOLDEN only if the change is deliberate):\n');
  console.log(`const GOLDEN: Record<string, string> = ${JSON.stringify(actual, null, 2)};`);
  process.exit(1);
}
