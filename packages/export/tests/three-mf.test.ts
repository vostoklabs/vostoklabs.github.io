/*
  The 3MF writer, pinned.

    pnpm --filter @vostok/export check

  Every app that exports through `buildThreeMF` gets exactly these entries for these parts and
  options, so a change to what the writer puts in a file shows up here first, entry by entry.
  The clock is frozen, which fixes CreationDate and the date in the provenance text.

  The zip container itself is not hashed: each entry carries a timestamp in local time, so the
  same file zips to different bytes in another time zone. What is pinned is what a slicer reads:
  the entry names, their order, and every entry byte for byte.

  A deliberate change to the file changes these hashes, and the failure prints the new table.
  Paste it in the same commit, and say in the commit message what changed in the file.
*/
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildThreeMF, buildStl, buildObj, buildObjMtl, exportPartOf, pauseForPocket,
  type ExportMeta, type ExportPart, type RGB,
} from '../src/index';
import { BAMBU_BASE } from '../src/bambuProfile.generated';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

/* ------------------------------------------------------------------ a frozen clock */

const FROZEN = Date.UTC(2026, 0, 2, 12);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    super(...((args.length ? args : [FROZEN]) as [number]));
  }
  static now(): number {
    return FROZEN;
  }
}
globalThis.Date = FrozenDate as DateConstructor;

/* ------------------------------------------------------------------ fixtures */

/** A tetrahedron with its corner at (x, y, z) and edge `s`; off-grid numbers, so the rounding
 *  the writer does is pinned too. */
const tetra = (x: number, y: number, z: number, s: number) => ({
  positions: new Float32Array([x, y, z, x + s, y, z, x, y + s, z, x, y, z + s]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
});
const part = (name: string, color: RGB, at: [number, number, number, number], extra: Partial<ExportPart> = {}): ExportPart => ({
  name,
  color,
  ...tetra(...at),
  ...extra,
});

/** One group, the usual "one object, N parts"; two parts share a colour, so share a slot. */
const ONE_GROUP: ExportPart[] = [
  part('body', [22, 22, 22], [-20.12345, -7.5, 0.25, 30]),
  part('inlay', [200, 16, 46], [-15.5, -3.25, 1.75, 12.3456]),
  part('inlay 2', [22, 22, 22], [2.5, 1.125, 1.75, 6]),
];
/** Two slicer objects, a forced slot that leaves a hole in the palette, and names that need
 *  escaping. Lowest point below zero, so the drop onto the bed is pinned. */
const TWO_GROUPS: ExportPart[] = [
  part('lid & <top>', [247, 247, 245], [-40.1, 2.2, -1.5, 18], { group: 'lid "A"' }),
  part('lid inlay', [0, 174, 66], [-35.2, 4.4, 1, 6], { group: 'lid "A"', extruder: 4 }),
  part('base', [22, 22, 22], [10.75, -12.5, -1.5, 22.5], { group: 'base' }),
];

const META: ExportMeta = {
  title: 'Golden',
  generator: 'golden-test',
  application: 'Vostok Labs Golden Test',
  buildId: 'golden-build',
};
const COVER = new TextEncoder().encode('PNG-STAND-IN');
const COVER_SMALL = new TextEncoder().encode('SMALL-PNG-STAND-IN');

const CASES: Record<string, [ExportPart[], ExportMeta]> = {
  defaults: [ONE_GROUP, { title: 'Golden', generator: 'golden-test' }],
  'one group': [ONE_GROUP, META],
  'plate size': [ONE_GROUP, { ...META, plateSize: [184.23, 183.5] }],
  cover: [ONE_GROUP, { ...META, cover: COVER }],
  'cover and small cover': [ONE_GROUP, { ...META, cover: COVER, coverSmall: COVER_SMALL }],
  process: [ONE_GROUP, { ...META, process: { initial_layer_print_height: '0.12', wall_loops: ['2', '3'] } }],
  'two groups': [TWO_GROUPS, { ...META, title: 'Golden & <co> "x"', plateSize: [355, 346] }],
  'no parts': [[], META],
  'source model': [ONE_GROUP, { ...META, sourceModel: 'dragon & <co>.stl' }],
};

/* ------------------------------------------------------------------ the golden */

/** Entry name -> first 16 hex digits of its sha256, in the order the zip holds them. */
const GOLDEN: Record<string, Record<string, string>> = {
  defaults: {
    '[Content_Types].xml': 'a1ed066344e85390',
    '_rels/.rels': '465f67e7a55f044d',
    '3D/3dmodel.model': 'a7497e958de36005',
    'Metadata/model_settings.config': '5b4bbbe9fe11f12d',
    'Metadata/project_settings.config': '8bc45ad392059413',
    'Metadata/vostok_labs.txt': 'a5a4e761f7366c98',
  },
  'one group': {
    '[Content_Types].xml': 'a1ed066344e85390',
    '_rels/.rels': '465f67e7a55f044d',
    '3D/3dmodel.model': '9515befff96b3351',
    'Metadata/model_settings.config': '5b4bbbe9fe11f12d',
    'Metadata/project_settings.config': '8bc45ad392059413',
    'Metadata/vostok_labs.txt': 'a3cc714246fb7238',
  },
  'plate size': {
    '[Content_Types].xml': 'a1ed066344e85390',
    '_rels/.rels': '465f67e7a55f044d',
    '3D/3dmodel.model': '99b81eefd2614dc9',
    'Metadata/model_settings.config': '5b4bbbe9fe11f12d',
    'Metadata/project_settings.config': '8bc45ad392059413',
    'Metadata/vostok_labs.txt': 'a3cc714246fb7238',
  },
  cover: {
    '[Content_Types].xml': '0f6f00c642b1b578',
    '_rels/.rels': '115a1c1124d2978f',
    '3D/3dmodel.model': '9515befff96b3351',
    'Metadata/model_settings.config': '5b4bbbe9fe11f12d',
    'Metadata/project_settings.config': '8bc45ad392059413',
    'Metadata/vostok_labs.txt': 'a3cc714246fb7238',
    'Metadata/plate_1.png': '7716abaa1eaf3e10',
    'Metadata/plate_1_small.png': '7716abaa1eaf3e10',
  },
  'cover and small cover': {
    '[Content_Types].xml': '0f6f00c642b1b578',
    '_rels/.rels': '115a1c1124d2978f',
    '3D/3dmodel.model': '9515befff96b3351',
    'Metadata/model_settings.config': '5b4bbbe9fe11f12d',
    'Metadata/project_settings.config': '8bc45ad392059413',
    'Metadata/vostok_labs.txt': 'a3cc714246fb7238',
    'Metadata/plate_1.png': '7716abaa1eaf3e10',
    'Metadata/plate_1_small.png': '2e8e9bd9bb9b39c0',
  },
  process: {
    '[Content_Types].xml': 'a1ed066344e85390',
    '_rels/.rels': '465f67e7a55f044d',
    '3D/3dmodel.model': '9515befff96b3351',
    'Metadata/model_settings.config': '5b4bbbe9fe11f12d',
    'Metadata/project_settings.config': 'c45eea60a5c2ebf8',
    'Metadata/vostok_labs.txt': 'a3cc714246fb7238',
  },
  'two groups': {
    '[Content_Types].xml': 'a1ed066344e85390',
    '_rels/.rels': '465f67e7a55f044d',
    '3D/3dmodel.model': '137bae879b3912ec',
    'Metadata/model_settings.config': 'f6171afde8768ffa',
    'Metadata/project_settings.config': 'e599fe61f0a327ba',
    'Metadata/vostok_labs.txt': 'd5fb8e26c1cf74b7',
  },
  'no parts': {
    '[Content_Types].xml': 'a1ed066344e85390',
    '_rels/.rels': '465f67e7a55f044d',
    '3D/3dmodel.model': 'bd0bc9fb2c5cbf90',
    'Metadata/model_settings.config': '4a3995904aa531c8',
    'Metadata/project_settings.config': 'bd7879159992c427',
    'Metadata/vostok_labs.txt': 'a3cc714246fb7238',
  },
  'source model': {
    '[Content_Types].xml': 'a1ed066344e85390',
    '_rels/.rels': '465f67e7a55f044d',
    '3D/3dmodel.model': 'f7a95bf5d14bd46c',
    'Metadata/model_settings.config': '5b4bbbe9fe11f12d',
    'Metadata/project_settings.config': '8bc45ad392059413',
    'Metadata/vostok_labs.txt': '9b121fae3e3153be',
  },
};

const entriesOf = (bytes: Uint8Array): Record<string, string> =>
  Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, data]) => [name, createHash('sha256').update(data).digest('hex').slice(0, 16)]),
  );

check('the clock is frozen', new Date().toISOString() === '2026-01-02T12:00:00.000Z' && Date.now() === FROZEN);

const actual: Record<string, Record<string, string>> = {};
for (const [name, [parts, meta]] of Object.entries(CASES)) {
  const got = entriesOf(buildThreeMF(parts, meta));
  actual[name] = got;
  const want = GOLDEN[name] ?? {};
  check(`${name}: the same entries, in the same order`, JSON.stringify(Object.keys(got)) === JSON.stringify(Object.keys(want)));
  for (const entry of Object.keys(want)) check(`${name}: ${entry} unchanged`, got[entry] === want[entry]);
}

/* ------------------------------------------------------------------ the options */

const same = (a: Record<string, string>, b: Record<string, string> | undefined) => JSON.stringify(a) === JSON.stringify(b);
const textOf = (bytes: Uint8Array, entry: string) => strFromU8(unzipSync(bytes)[entry]!);

// sourceModel: the mark stops claiming the shape, and nothing else in the file moves.
{
  const bytes = buildThreeMF(...CASES['source model']!);
  const model = textOf(bytes, '3D/3dmodel.model');
  const text = textOf(bytes, 'Metadata/vostok_labs.txt');
  check('sourceModel: the model is named, escaped, as its creator\'s', model.includes('The shape is from dragon &amp; &lt;co&gt;.stl and belongs to its creator.'));
  check('sourceModel: no copyright or CC licence is claimed over it', !model.includes('©') && !model.includes('CC BY-NC-ND') && !text.includes('CC BY-NC-ND'));
  check('sourceModel: the text file names it too', text.includes('This file was made from an uploaded model: dragon & <co>.stl.'));
  const plain = actual['one group']!;
  const sourced = actual['source model']!;
  check(
    'sourceModel: only the model metadata and the text file change',
    Object.keys(plain).every((e) => (e === '3D/3dmodel.model' || e === 'Metadata/vostok_labs.txt' ? plain[e] !== sourced[e] : plain[e] === sourced[e])),
  );
}

// Positions as any array of numbers: Float64 copies of Float32 values write the same file.
const as64 = (parts: ExportPart[]): ExportPart<Float64Array>[] => parts.map((p) => ({ ...p, positions: Float64Array.from(p.positions) }));
check('Float64 positions: the same 3MF entries', same(entriesOf(buildThreeMF(as64(ONE_GROUP), META)), GOLDEN['one group']));
check('Float64 positions: the same 3MF entries, two groups', same(entriesOf(buildThreeMF(as64(TWO_GROUPS), CASES['two groups']![1])), GOLDEN['two groups']));
check('Float64 positions: the same STL', Buffer.from(buildStl(as64(TWO_GROUPS))).equals(Buffer.from(buildStl(TWO_GROUPS))));
check('Float64 positions: the same OBJ', buildObj(as64(TWO_GROUPS)) === buildObj(TWO_GROUPS));
check('Float64 positions: the same OBJ + MTL', JSON.stringify(buildObjMtl(as64(TWO_GROUPS))) === JSON.stringify(buildObjMtl(TWO_GROUPS)));
{
  // 1.00005 rounds up to 1.0001 at the file's four decimals; as a Float32 it is 1.0000499..., which
  // rounds down. Written from a Float64Array it must arrive as 1.0001: the writer keeps the precision.
  const at = (positions: ArrayLike<number>) => textOf(
    buildThreeMF([{ name: 'p', color: [1, 2, 3], positions, indices: new Uint32Array([0, 1, 2]) }], META),
    '3D/3dmodel.model',
  );
  const xyz = [1.00005, 0, 0, 2, 0, 0, 1.5, 1, 0];
  check('Float64 positions: written at full precision', at(Float64Array.from(xyz)).includes('<vertex x="1.0001" y="0" z="0"/>'));
  check('Float32 positions: rounded as before', at(Float32Array.from(xyz)).includes('<vertex x="1" y="0" z="0"/>'));
}

// exportPartOf: a manifold mesh, as a part.
{
  const t = tetra(1.5, -2.25, 0.5, 4);
  const mesh = { numProp: 3, vertProperties: t.positions, triVerts: t.indices };
  const p = exportPartOf(mesh, { name: 'n', color: [9, 8, 7], group: 'g', extruder: 2 });
  check('exportPartOf: at numProp 3 the mesh arrays are used, not copied', p.positions === mesh.vertProperties && p.indices === mesh.triVerts);
  check('exportPartOf: carries name, colour, group and slot', p.name === 'n' && p.color.join() === '9,8,7' && p.group === 'g' && p.extruder === 2);

  // The same parts with two extra floats per vertex: de-strided, they write the same file.
  const strided = ONE_GROUP.map((q) => {
    const n = q.positions.length / 3;
    const vertProperties = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) vertProperties.set([q.positions[i * 3]!, q.positions[i * 3 + 1]!, q.positions[i * 3 + 2]!, 1000 + i, -7], i * 5);
    return exportPartOf({ numProp: 5, vertProperties, triVerts: q.indices }, { name: q.name, color: q.color });
  });
  check('exportPartOf: past numProp 3 only the xyz are kept', strided.every((q, i) => Buffer.from(q.positions.buffer).equals(Buffer.from(ONE_GROUP[i]!.positions.buffer))));
  check('exportPartOf: a de-strided mesh writes the same 3MF', same(entriesOf(buildThreeMF(strided, META)), GOLDEN['one group']));
}

/* ------------------------------------------------------------------ print pauses */

const PAUSE_FILE = 'Metadata/custom_gcode_per_layer.xml';
const bytesEqual = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const pauseXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)[PAUSE_FILE] ?? new Uint8Array());

/** Well-formed, for the small XML the pause file is: the prolog, then elements with attributes and
 *  nothing between them but line breaks, every element closed in order, one root, no attribute
 *  twice, no `&` that is not one of the five entities. */
const wellFormed = (xml: string): boolean => {
  const prolog = '<?xml version="1.0" encoding="utf-8"?>';
  if (!xml.startsWith(prolog)) return false;
  const body = xml.slice(prolog.length);
  const open: string[] = [];
  let roots = 0;
  let at = 0;
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"<]*")*)\s*(\/?)>/g)) {
    if (body.slice(at, m.index).trim() !== '') return false;
    at = m.index! + m[0].length;
    const [, close, name, attrs = '', self] = m;
    const names = [...attrs.matchAll(/([A-Za-z_][\w.:-]*)=/g)].map((a) => a[1]);
    if (new Set(names).size !== names.length || /&(?!(amp|lt|gt|quot|apos);)/.test(attrs)) return false;
    if (close) {
      if (self || attrs || open.pop() !== name) return false;
    } else {
      if (!open.length) roots++;
      if (!self) open.push(name!);
    }
  }
  return body.slice(at).trim() === '' && open.length === 0 && roots === 1;
};

// Left out or empty, every case above writes the same bytes as without the option, so the same
// entries as GOLDEN, and no pause file.
for (const [name, [parts, meta]] of Object.entries(CASES)) {
  const plain = buildThreeMF(parts, meta);
  check(
    `pauseAt: absent, undefined and [] write the same bytes, ${name}`,
    bytesEqual(buildThreeMF(parts, { ...meta, pauseAt: undefined }), plain) && bytesEqual(buildThreeMF(parts, { ...meta, pauseAt: [] }), plain),
  );
  check(`pauseAt: no pause file unless asked for, ${name}`, !(PAUSE_FILE in unzipSync(plain)));
}

// Asked for: the file Bambu Studio itself saves for pauses on plate 1, line for line (the shape was
// checked against one Studio wrote). Sorted, a height the file would write twice written once, and
// nothing else in the 3MF moves.
{
  const STUDIO_TWO_PAUSES =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<custom_gcodes_per_layer>\n' +
    '<plate>\n' +
    '<plate_info id="1"/>\n' +
    '<layer top_z="0.6" type="1" extruder="1" color="" extra="" gcode="M400 U1"/>\n' +
    '<layer top_z="1.2" type="1" extruder="1" color="" extra="" gcode="M400 U1"/>\n' +
    '<mode value="MultiAsSingle"/>\n' +
    '</plate>\n' +
    '</custom_gcodes_per_layer>';
  const bytes = buildThreeMF(ONE_GROUP, { ...META, pauseAt: [1.2, 0.6000000000000001, 1.2, 1.20004] });
  const xml = pauseXml(bytes);
  check('pauseAt: the pause file is written', PAUSE_FILE in unzipSync(bytes));
  check('pauseAt: well-formed XML', wellFormed(xml));
  check('pauseAt: the file Studio saves, sorted, each height once', xml === STUDIO_TWO_PAUSES);
  const without = entriesOf(buildThreeMF(ONE_GROUP, META));
  const withPauses = entriesOf(bytes);
  check(
    'pauseAt: every other entry unchanged, in the same order',
    JSON.stringify(Object.keys(withPauses).filter((e) => e !== PAUSE_FILE)) === JSON.stringify(Object.keys(without)) &&
      Object.keys(without).every((e) => without[e] === withPauses[e]),
  );
}

// `mode` follows the project's filament count, as Studio writes it.
{
  const modeOf = (parts: ExportPart[]) => pauseXml(buildThreeMF(parts, { ...META, pauseAt: [1] })).match(/<mode value="(\w+)"\/>/)?.[1];
  check('pauseAt: one filament is SingleExtruder', modeOf([ONE_GROUP[0]!]) === 'SingleExtruder');
  check('pauseAt: one colour on two parts is still one filament', modeOf([ONE_GROUP[0]!, ONE_GROUP[2]!]) === 'SingleExtruder');
  check('pauseAt: more than one filament is MultiAsSingle', modeOf(ONE_GROUP) === 'MultiAsSingle' && modeOf(TWO_GROUPS) === 'MultiAsSingle');
}

// The pause command is the profile's, read from it (not typed again) and escaped.
{
  const base = BAMBU_BASE as Record<string, unknown>;
  const real = base.machine_pause_gcode;
  check("pauseAt: the bundled printer's pause command is M400 U1", real === 'M400 U1');
  base.machine_pause_gcode = 'M601 ; "wait" & <go>';
  try {
    const xml = pauseXml(buildThreeMF(ONE_GROUP, { ...META, pauseAt: [1] }));
    check("pauseAt: the pause command comes from the profile, escaped", xml.includes('gcode="M601 ; &quot;wait&quot; &amp; &lt;go&gt;"') && wellFormed(xml));
  } finally {
    base.machine_pause_gcode = real;
  }
}

// A height that is not above the bed is a mistake, refused rather than written.
for (const bad of [0, -0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
  let threw = false;
  try {
    buildThreeMF(ONE_GROUP, { ...META, pauseAt: [1.2, bad] });
  } catch (e) {
    threw = e instanceof RangeError;
  }
  check(`pauseAt: ${bad} is refused`, threw);
}

/* ------------------------------------------------------------------ pauseForPocket */

check(
  'pauseForPocket: the profile slices a 0.2 mm first layer, then 0.2 mm layers',
  Number(BAMBU_BASE.initial_layer_print_height) === 0.2 && Number(BAMBU_BASE.layer_height) === 0.2,
);
const POCKETS: [what: string, ceiling: number, pause: number, process?: ExportMeta['process']][] = [
  ['a ceiling on the first layer: the second layer', 0.2, 0.4],
  ['a ceiling on a boundary: the layer that starts there', 1, 1.2],
  ['float noise below a boundary is on it', 0.9999999999999999, 1.2],
  ['float noise above a boundary is on it', 0.6000000000000001, 0.8],
  ['a ceiling low inside a layer: that layer', 1.05, 1.2],
  ['a ceiling high inside a layer: that layer', 1.15, 1.2],
  ['a ten-thousandth below a boundary is on it', 1.19995, 1.4],
  ["a 0.12 mm first layer from the export's process", 0.12, 0.32, { initial_layer_print_height: '0.12' }],
  ['a 0.12 mm first layer, higher up', 0.52, 0.72, { initial_layer_print_height: '0.12' }],
  ["0.16 mm layers from the export's process", 1, 1.16, { layer_height: '0.16' }],
];
for (const [what, ceiling, pause, process] of POCKETS) {
  const got = pauseForPocket(ceiling, process);
  check(`pauseForPocket: ${what}: ${ceiling} -> ${got}`, got === pause);
}
for (const bad of [0.1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  let threw = false;
  try {
    pauseForPocket(bad);
  } catch (e) {
    threw = e instanceof RangeError;
  }
  check(`pauseForPocket: a ceiling of ${bad} is refused`, threw);
}
check(
  'pauseForPocket: its height is what the file writes',
  pauseXml(buildThreeMF(ONE_GROUP, { ...META, pauseAt: [pauseForPocket(1)] })).includes('<layer top_z="1.2" type="1" '),
);

/* ------------------------------------------------------------------ report */

console.log(`\nthree-mf: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nThe writer now produces (paste over GOLDEN only if the change is deliberate):\n');
  console.log(`const GOLDEN: Record<string, Record<string, string>> = ${JSON.stringify(actual, null, 2)};`);
  process.exit(1);
}
