/*
  The shelf's model reader against the clicker's own two, file by file.

    node apps/clicker-generator/tests/suites.mjs golden/readers      (part of pnpm test)

  The clicker reads its MX assets with geometry/threemfImport.ts and an uploaded model with
  model/parse.ts. `readModel` (@vostok/export, "Model reader") is to replace both, and before it
  can it has to give the same floats for the same files: the MX socket, stem and switch (written
  in metres), every Model-mode sample, and an upload of each shape the clicker's own suite reads
  (binary and ASCII STL, an OBJ with quads and negative indices). Each is compared array for
  array with the reader it would replace, and pinned by hash, so the comparison still holds once
  the old readers are gone.

  One case may differ, and is held to a bound instead: a 3MF whose part is placed by a
  transform. The upload reader rounds a vertex to a float before it moves and scales it; the
  shelf's moves and scales the double and rounds once, so its vertex is as close to where the
  file puts it or closer, and the two differ by a float's last place (nanometres). None of the
  files the clicker ships has a transform.
*/
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { readModel } from '@vostok/export/read';
import { parse3MF } from '../../src/geometry/threemfImport.ts';
import { parseModel } from '../../src/model/parse.ts';
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
const sameBytes = (a: ArrayBufferView, b: ArrayBufferView) => {
  const x = bytes(a);
  const y = bytes(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const hash = (m: { positions: Float32Array; indices: Uint32Array }) =>
  createHash('sha256').update(bytes(m.positions)).update(bytes(m.indices)).digest('hex').slice(0, 16);

/** The shelf reader's output for each file, hashed: what the clicker reads today. */
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
function compare(name: string, file: string, theirs: { positions: Float32Array; indices: Uint32Array }, data: ArrayBuffer) {
  const ours = readModel(data, file);
  actual[name] = hash(ours);
  check(
    `${name}: the same floats and the same triangles as the clicker's reader`,
    sameBytes(ours.positions, theirs.positions) && sameBytes(ours.indices, theirs.indices),
    `${ours.positions.length / 3} vertices, ${ours.indices.length / 3} triangles`,
  );
  check(`${name}: unchanged`, actual[name] === GOLDEN[name], actual[name]);
}

/* ------------------------------------------------------------------ the MX assets (metres) */

for (const file of ['mx-socket.3mf', 'mx-stem.3mf', 'mx-switch.3mf']) {
  const data = asset(`switch/mx/${file}`);
  const theirs = parse3MF(data);
  compare(`MX ${file}`, file, { positions: theirs.vertProperties, indices: theirs.triVerts }, data);
}

/* ------------------------------------------------------------------ the Model-mode samples */

for (const sample of MODEL_SAMPLES) {
  const file = `${sample.id}.3mf`;
  const data = asset(`samples/${file}`);
  compare(`sample ${file}`, file, parseModel(data, file), data);
}

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
  compare(name, file, parseModel(data, file), data);
}

/* ------------------------------------------------------------------ a part placed by a transform */

{
  // Bambu's production layout: a part in its own file, pulled in by a component with a turn and
  // a shift, in centimetres; off-grid numbers, so the two orders of rounding can disagree.
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
  const data = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  const theirs = parseModel(data, 'part.3mf');
  const ours = readModel(data, 'part.3mf');
  // Where each vertex really is: the decimals in the file, turned, shifted and scaled in doubles.
  const exact: number[] = [];
  for (const [x, y, z] of verts) {
    const cx = (x! * 0.8 + y! * -0.6 + 2.0137) * 10;
    const cy = (x! * 0.6 + y! * 0.8 - 1.31) * 10;
    exact.push(cx + 127, cy + 33, (z! + 0.25) * 10);
  }
  let moved = 0;
  let worst = 0;
  let closer = true;
  for (let i = 0; i < ours.positions.length; i++) {
    const d = Math.abs(ours.positions[i]! - theirs.positions[i]!);
    if (d) moved++;
    worst = Math.max(worst, d);
    if (Math.abs(ours.positions[i]! - exact[i]!) > Math.abs(theirs.positions[i]! - exact[i]!)) closer = false;
  }
  check('placed by a transform: the same triangles', sameBytes(ours.indices, theirs.indices));
  check('placed by a transform: every vertex as close to where the file puts it, or closer', ours.positions.length === theirs.positions.length && closer,
    `${moved} of ${ours.positions.length} coordinates differ, by at most ${worst.toExponential(1)} mm`);
  check('placed by a transform: and by less than a micron', worst < 1e-3, `${worst.toExponential(1)} mm`);
}

/* ------------------------------------------------------------------ report */

console.log(`\nreaders: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nThe shelf reader now gives (paste over GOLDEN only if the change is deliberate):\n');
  console.log(`const GOLDEN: Record<string, string> = ${JSON.stringify(actual, null, 2)};`);
  process.exit(1);
}
