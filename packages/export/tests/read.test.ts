/*
  The model reader: what the writers write, read back, and the files other programs write.

    pnpm --filter @vostok/export check

  Round trips first: an STL, an OBJ and a 3MF written by this package read back as the parts
  that went in (an STL exactly, the OBJ and the 3MF to the four decimals they are written at,
  the 3MF moved by the transform that centres it on the plate). Then the shapes other programs
  write: ASCII STL, binary STL whose header starts with "solid", OBJ quads and negative indices,
  a 3MF in centimetres whose part lives in another file behind a component transform, files of
  different units, attributes in single quotes, damaged and empty STLs, a file with no
  extension. Then the rule that matters most: a coordinate is scaled and placed as a double and
  rounded to a float once, so a file in metres reads to the floats its decimals round to, and a
  -0 stays -0.
*/
import { strToU8, zipSync } from 'fflate';
import {
  buildObjMtl, buildStl, buildThreeMF, modelFormatOf, plateItemTransform, readModel, xyBounds,
  type ExportPart, type RGB,
} from '../src/index';
import { readModel as readModelSubpath } from '../src/read';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  —  ${detail}` : ''}`);
};
const throws = (fn: () => unknown): string => {
  try {
    fn();
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

/* ------------------------------------------------------------------ fixtures */

const tetra = (x: number, y: number, z: number, s: number) => ({
  positions: new Float32Array([x, y, z, x + s, y, z, x, y + s, z, x, y, z + s]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
});
const part = (name: string, color: RGB, at: [number, number, number, number]): ExportPart => ({ name, color, ...tetra(...at) });
const PARTS: ExportPart[] = [
  part('body', [22, 22, 22], [-20.12345, -7.5, 0.25, 30]),
  part('inlay', [200, 16, 46], [-15.5, -3.25, 1.75, 12.3456]),
  part('inlay 2', [22, 22, 22], [2.5, 1.125, 1.75, 6]),
];
/** The parts' indices as one list, each part's moved past the vertices before it. */
const allIndices = (parts: ExportPart[]) => {
  const out: number[] = [];
  let first = 0;
  for (const p of parts) {
    for (const i of p.indices) out.push(first + i);
    first += p.positions.length / 3;
  }
  return out;
};
const allPositions = (parts: ExportPart[]) => parts.flatMap((p) => [...p.positions]);
const worst = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let w = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < Math.min(a.length, b.length); i++) w = Math.max(w, Math.abs(a[i]! - b[i]!));
  return w;
};
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && worst(a, b) === 0;

/* ------------------------------------------------------------------ the format */

check('format by extension, any case', modelFormatOf('a.STL') === 'stl' && modelFormatOf('b.obj') === 'obj' && modelFormatOf('dir.v2/c.3mf') === '3mf');
check('no format for anything else', modelFormatOf('model.step') === null && modelFormatOf('notes.txt') === null && modelFormatOf('') === null);

/* ------------------------------------------------------------------ round trips */

{
  const stl = buildStl(PARTS);
  const m = readModel(stl, 'model.stl');
  const corners: number[] = [];
  for (const p of PARTS) for (const i of p.indices) corners.push(p.positions[i * 3]!, p.positions[i * 3 + 1]!, p.positions[i * 3 + 2]!);
  check('binary STL: every triangle corner back exactly', same(m.positions, corners), `${m.positions.length / 9} triangles`);
  check('binary STL: a soup, three vertices a triangle', same(m.indices, corners.map((_, i) => i).slice(0, corners.length / 3)));
  // The same bytes as a view into a bigger buffer, at an offset, the way a worker can hand them on.
  const padded = new Uint8Array(stl.length + 13);
  padded.set(stl, 7);
  check('binary STL: read from a view at an offset', same(readModel(padded.subarray(7, 7 + stl.length), 'model.stl').positions, corners));
  check('binary STL: read from a bare ArrayBuffer', same(readModel(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength), 'model.stl').positions, corners));
}
{
  const { obj } = buildObjMtl(PARTS);
  const m = readModel(strToU8(obj), 'model.obj');
  check('OBJ: the vertices back to the four decimals they are written at', worst(m.positions, allPositions(PARTS)) <= 5.01e-5, `worst ${worst(m.positions, allPositions(PARTS)).toExponential(2)} mm`);
  check('OBJ: the faces back exactly, numbered across the file', same(m.indices, allIndices(PARTS)));
}
{
  const meta = { title: 'Round trip', generator: 'read-test', plateSize: [180, 180] as [number, number] };
  const m = readModel(buildThreeMF(PARTS, meta), 'model.3mf');
  // The writer drops the lowest point onto the bed and centres the footprint on the plate with
  // the build item's transform; the reader applies the transform.
  const minZ = Math.min(...PARTS.flatMap((p) => [...p.positions].filter((_, i) => i % 3 === 2)));
  const t = plateItemTransform(xyBounds(PARTS.map((p) => p.positions)), meta.plateSize).split(' ').map(Number);
  const expected = allPositions(PARTS).map((v, i) => (i % 3 === 0 ? v + t[9]! : i % 3 === 1 ? v + t[10]! : v - minZ));
  check('3MF: the vertices back, on the bed and centred on the plate', worst(m.positions, expected) <= 1e-4, `worst ${worst(m.positions, expected).toExponential(2)} mm`);
  check('3MF: the faces back exactly, part after part', same(m.indices, allIndices(PARTS)));
}

/* ------------------------------------------------------------------ other programs' files */

{
  const ascii = 'solid cube\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1.5 0 0\n   vertex 0 2.25e1 0\n  endloop\n endfacet\n'
    + ' facet normal 0 0 1\n  outer loop\n   vertex 1 1 1\n   vertex -1 1 1\n   vertex 1 -1 +1\n  endloop\n endfacet\n';
  const m = readModel(strToU8(ascii), 'cube.stl');
  check('ASCII STL, no endsolid: both triangles', same(m.positions, [0, 0, 0, 1.5, 0, 0, 0, 22.5, 0, 1, 1, 1, -1, 1, 1, 1, -1, 1]) && m.indices.length === 6);
  // A binary file whose 80-byte header happens to start with "solid".
  const bin = buildStl(PARTS, 'solid but binary');
  check('binary STL whose header starts with "solid": read as binary', readModel(bin, 'x.stl').positions.length === (bin.length - 84) / 50 * 9);
  check('an STL with no triangles says so', throws(() => readModel(strToU8('solid empty\nendsolid\n'), 'e.stl')) === 'This STL has no triangles in it.');
  // A binary STL whose header counts no triangles has none, and says so like any other.
  check('a binary STL of no triangles says so', throws(() => readModel(new Uint8Array(84), 'empty.stl')) === 'This STL has no triangles in it.',
    throws(() => readModel(new Uint8Array(84), 'empty.stl')) || 'read without a word');
  // One that is longer or shorter than its own count says it is damaged: it has triangles.
  const whole = buildStl(PARTS);
  const longer = new Uint8Array(whole.length + 7);
  longer.set(whole);
  const said = [throws(() => readModel(longer, 'long.stl')), throws(() => readModel(whole.subarray(0, whole.length - 10), 'short.stl'))];
  check('a binary STL longer or shorter than its triangle count says it is damaged',
    said.every((m) => m.startsWith('This binary STL is damaged') && m.includes('12 triangles') && m.includes(`${whole.length} bytes`)), said.join(' / '));
}
{
  const obj = '# a quad and a triangle\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0 1.0\nvt 0 0\nf 1/1/1 2/1/1 3/1/1 4/1/1\nv 0 0 1\nf -1 -2 -3\n';
  const m = readModel(strToU8(obj), 'quad.obj');
  check('OBJ: a quad fans into two triangles, "v/vt/vn" read as v, a w ignored', same(m.indices.subarray(0, 6), [0, 1, 2, 0, 2, 3]) && m.positions.length === 15);
  check('OBJ: negative indices count back from the last vertex', same(m.indices.subarray(6), [4, 3, 2]));
  check('an OBJ with no faces says so', throws(() => readModel(strToU8('v 0 0 0\n'), 'v.obj')) === 'This OBJ has no faces in it.');
}
{
  // Bambu's production layout: the root model builds an object whose one component lives in
  // another file, moved by a transform; that file is in centimetres.
  const part = '<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>'
    + '<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices>'
    + '<triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh></object>'
    + '</resources><build/></model>';
  const root = '<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>'
    + '<object id="5" type="model"><components><component p:path="/3D/Objects/part_1.model" objectid="1" transform="0 1 0 -1 0 0 0 0 1 2 0 0"/></components></object>'
    + '</resources><build><item objectid="5" transform="1 0 0 0 1 0 0 0 1 0 0 3"/></build></model>';
  const zip = zipSync({ '3D/3dmodel.model': strToU8(root), '3D/Objects/part_1.model': strToU8(part) });
  const m = readModel(zip, 'part.3mf');
  // (x, y, z) -> (-y + 2, x, z) by the component, then +3 on z by the item, in cm: so mm x10.
  check('3MF: a part in another file, through a component and an item transform, in cm',
    same(m.positions, [20, 0, 30, 20, 10, 30, 10, 0, 30, 20, 0, 40]) && m.indices.length === 12, [...m.positions].join(' '));
  // XML quotes an attribute either way; the same two files with every attribute in single quotes.
  const single = (xml: string) => xml.replace(/"/g, "'");
  let quoted: string;
  try {
    const q = readModel(zipSync({ '3D/3dmodel.model': strToU8(single(root)), '3D/Objects/part_1.model': strToU8(single(part)) }), 'part.3mf');
    quoted = same(q.positions, m.positions) && same(q.indices, m.indices) ? '' : [...q.positions].join(' ');
  } catch (err) {
    quoted = err instanceof Error ? err.message : String(err);
  }
  check('3MF: attributes in single quotes read as in double', quoted === '', quoted);
  check('a 3MF that is not a zip says so', throws(() => readModel(strToU8('PK no zip here'), 'bad.3mf')) === 'This 3MF could not be opened — it is not a valid zip.');
  check('a 3MF with no model says so', throws(() => readModel(zipSync({ 'readme.txt': strToU8('hi') }), 'none.3mf')) === 'This 3MF has no model in it.');
}
{
  // Each file of a 3MF has its own unit, and a transform is in the unit of the file it is
  // written in: a placement in centimetres moves a part drawn in millimetres by centimetres.
  const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
  const tetraXml = (id: number, s: number) => `<object id="${id}" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="${s}" y="0" z="0"/>`
    + `<vertex x="0" y="${s}" z="0"/><vertex x="0" y="0" z="${s}"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/>`
    + '<triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh></object>';
  const file = (unit: string, objects: string, build = '') => `<?xml version="1.0"?><model unit="${unit}" ${NS}><resources>${objects}</resources><build>${build}</build></model>`;

  // The root in centimetres turns the part a quarter and moves it (1, 2, 3) cm; the part is in mm.
  const mm = readModel(zipSync({
    '3D/3dmodel.model': strToU8(file('centimeter', '<object id="5" type="model"><components><component p:path="/3D/Objects/a.model" objectid="1"/></components></object>',
      '<item objectid="5" transform="0 1 0 -1 0 0 0 0 1 1 2 3"/>')),
    '3D/Objects/a.model': strToU8(file('millimeter', tetraXml(1, 10))),
  }), 'units.3mf');
  check('3MF: a placement is in the unit of the file that wrote it, the part in its own',
    worst(mm.positions, [10, 20, 30, 10, 30, 30, 0, 20, 30, 10, 20, 40]) === 0, [...mm.positions].join(' '));

  // Two steps: the root in inches moves an object 1 in along y; that object, in a file in
  // metres, places a part 0.01 m along x; the part is 1 mm a side, in metres.
  const deep = readModel(zipSync({
    '3D/3dmodel.model': strToU8(file('inch', '<object id="7" type="model"><components><component p:path="/3D/Objects/b.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 0 1 0"/></components></object>',
      '<item objectid="7"/>')),
    '3D/Objects/b.model': strToU8(file('meter', '<object id="2" type="model"><components><component objectid="3" transform="1 0 0 0 1 0 0 0 1 0.01 0 0"/></components></object>'
      + tetraXml(3, 0.001))),
  }), 'deep.3mf');
  check('3MF: and so at every step of a part placed through two files',
    worst(deep.positions, [10, 25.4, 0, 11, 25.4, 0, 10, 26.4, 0, 10, 25.4, 1]) <= 1e-5, [...deep.positions].join(' '));
}
{
  const zip = buildThreeMF(PARTS, { title: 'x', generator: 'read-test' });
  check('no extension: a zip is read as a 3MF', readModel(zip, 'download').indices.length === allIndices(PARTS).length);
  check('no extension: "v" lines are read as an OBJ', readModel(strToU8('# hi\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'), 'x').indices.length === 3);
  check('no extension: anything else is read as an STL', readModel(buildStl(PARTS), 'blob').positions.length === allIndices(PARTS).length * 3);
}

/* ------------------------------------------------------------------ one rounding */

{
  // Coordinates in metres where rounding to a float first and scaling after lands on another
  // float than scaling the double: the reader must give the second, as the clicker's switch
  // reader always has.
  const picks: number[] = [];
  for (let k = 1; picks.length < 6 && k < 100000; k++) {
    const x = Number((k * 0.0000731).toFixed(10));
    if (Math.fround(x * 1000) !== Math.fround(Math.fround(x) * 1000)) picks.push(x);
  }
  const xyz = [...picks.slice(0, 3), ...picks.slice(3, 6), 0, 0, 0];
  const model = '<?xml version="1.0"?><model unit="meter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="0"><mesh><vertices>'
    + [0, 3, 6].map((i) => `<vertex x="${xyz[i]}" y="${xyz[i + 1]}" z="${xyz[i + 2]}"/>`).join('')
    + '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="0"/></build></model>';
  const m = readModel(zipSync({ '3D/3dmodel.model': strToU8(model) }), 'switch.3mf');
  const once = xyz.map((v) => Math.fround(v * 1000));
  const twice = xyz.map((v) => Math.fround(Math.fround(v) * 1000));
  check('metres: each coordinate scaled as a double and rounded once', picks.length === 6 && same(m.positions, once) && !same(m.positions, twice), `${picks.length} coordinates that two roundings would move`);
  check('-0 stays -0 through the scale', Object.is(readModel(zipSync({ '3D/3dmodel.model': strToU8(model.replace(`x="${xyz[0]}"`, 'x="-0"')) }), 's.3mf').positions[0], -0));
}

check('@vostok/export/read is the same reader', readModelSubpath === readModel);

/* ------------------------------------------------------------------ report */

console.log(`\nread: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
