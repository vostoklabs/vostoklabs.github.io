/*
  The OBJ writer, pinned.

    pnpm --filter @vostok/export check

  What a slicer or a host reads from an OBJ export is its text, so the OBJ and the MTL are pinned
  as text, case by case, the way three-mf.test.ts pins the 3MF's entries. A deliberate change to
  what the writer puts in a file fails here and prints the new table: paste it in the same
  commit, and say in the commit message what changed in the file.

  Below the table: the writer one part at a time (`objWriter`) writes exactly what
  `buildObjMtl` writes, a materials table shared by several plates names one filament one way
  in all of them, and `materialBy: 'extruder'` gives one material per filament slot, numbered
  as `buildThreeMF` numbers its slots.
*/
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import {
  buildObjMtl, buildMtl, buildThreeMF, objMaterials, objWriter, paletteOf,
  type ExportPart, type ObjMtlOptions, type RGB,
} from '../src/index';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  —  ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ a frozen clock */

// The provenance header carries the date.
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

/** A tetrahedron with its corner at (x, y, z) and edge `s`; off-grid numbers, so the writer's
 *  rounding is pinned too. */
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

/** One group; two parts share a colour, so they share a material. */
const ONE_GROUP: ExportPart[] = [
  part('body', [22, 22, 22], [-20.12345, -7.5, 0.25, 30]),
  part('inlay', [200, 16, 46], [-15.5, -3.25, 1.75, 12.3456]),
  part('inlay 2', [22, 22, 22], [2.5, 1.125, 1.75, 6]),
];
/** Two groups, names that need slugging and de-duplicating, a forced slot. */
const TWO_GROUPS: ExportPart[] = [
  part('lid & <top>', [247, 247, 245], [-40.1, 2.2, -1.5, 18], { group: 'lid "A"' }),
  part('lid inlay', [0, 174, 66], [-35.2, 4.4, 1, 6], { group: 'lid "A"', extruder: 4 }),
  part('base', [22, 22, 22], [10.75, -12.5, -1.5, 22.5], { group: 'base' }),
  part('base', [22, 22, 22], [12.75, -10.5, -1.5, 2.5], { group: 'base' }),
];
/** A keycap, the way the keycap generator hands its parts over: a slot per body, the cap and the
 *  stem on slot 1, the legend on 2, and a second legend in the cap's own colour on slot 3. */
const KEYCAP: ExportPart[] = [
  part('Keycap', [22, 22, 22], [-9, -9, 0, 18]),
  part('Legend', [247, 247, 245], [-3, -2, 7.5, 4], { extruder: 2 }),
  part('Legend 2', [22, 22, 22], [1, -2, 7.5, 3], { extruder: 3 }),
  part('Stem', [22, 22, 22], [-2.5, -2.5, -4, 5], { extruder: 1 }),
].map((p, i) => (i === 0 ? { ...p, extruder: 1 } : p));

const PROVENANCE = { title: 'Golden', generator: 'golden-test', application: 'Vostok Labs Golden Test', buildId: 'golden-build' };

const CASES: Record<string, [ExportPart[], ObjMtlOptions]> = {
  defaults: [ONE_GROUP, {}],
  'mtl file name': [ONE_GROUP, { mtlFileName: 'golden.mtl' }],
  provenance: [ONE_GROUP, { provenance: PROVENANCE }],
  'two groups': [TWO_GROUPS, {}],
  'no parts': [[], {}],
  'keycap by colour': [KEYCAP, { mtlFileName: 'keycap.mtl' }],
  'keycap by slot': [KEYCAP, { mtlFileName: 'keycap.mtl', materialBy: 'extruder', provenance: PROVENANCE }],
  'two groups by slot': [TWO_GROUPS, { materialBy: 'extruder' }],
};

/* ------------------------------------------------------------------ the golden */

/** Case -> first 16 hex digits of the sha256 of the OBJ and of the MTL, and the material count. */
const GOLDEN: Record<string, { obj: string; mtl: string; materials: number }> = {
  defaults: { obj: '26e388014174a9bf', mtl: 'c6673ae21a516708', materials: 2 },
  'mtl file name': { obj: 'd610443ee3087158', mtl: 'c6673ae21a516708', materials: 2 },
  provenance: { obj: '451687dee1ca93ce', mtl: 'c6673ae21a516708', materials: 2 },
  'two groups': { obj: '474ab45fc84135cc', mtl: 'c5944bc6e529ad1a', materials: 3 },
  'no parts': { obj: 'fea8cc5cca31d6f9', mtl: '01ba4719c80b6fe9', materials: 0 },
  'keycap by colour': { obj: 'e4967efd0cf2c179', mtl: '0e53d6bf9c092948', materials: 2 },
  'keycap by slot': { obj: 'eb34a4d88f31ed54', mtl: '6f7a631cdfad1cdf', materials: 3 },
  'two groups by slot': { obj: '06df363f95ec2b3d', mtl: 'd11c978118aeca99', materials: 3 },
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const actual: Record<string, { obj: string; mtl: string; materials: number }> = {};
for (const [name, [parts, opts]] of Object.entries(CASES)) {
  const out = buildObjMtl(parts, opts);
  actual[name] = { obj: sha(out.obj), mtl: sha(out.mtl), materials: out.materialCount };
  check(`${name}: the OBJ, the MTL and the material count unchanged`, JSON.stringify(actual[name]) === JSON.stringify(GOLDEN[name]));
}

/* ------------------------------------------------------------------ a part at a time */

// The writer writes what buildObjMtl writes, for every case above.
for (const [name, [parts, opts]] of Object.entries(CASES)) {
  const writer = objWriter(opts);
  for (const p of parts) writer.add(p);
  const whole = buildObjMtl(parts, opts);
  check(`${name}: written a part at a time, the same OBJ and MTL`, writer.text === whole.obj && buildMtl(writer.materials) === whole.mtl);
}
{
  const writer = objWriter();
  const emptyBefore = writer.isEmpty;
  writer.add({ name: 'nothing', color: [1, 2, 3], positions: new Float32Array(0), indices: new Uint32Array(0) });
  const emptyAfterNothing = writer.isEmpty;
  writer.add(ONE_GROUP[0]!);
  check('isEmpty: true until a part with a vertex in it is written', emptyBefore && emptyAfterNothing && !writer.isEmpty);
}

/* ------------------------------------------------------------------ one table, several plates */

{
  const materials = objMaterials();
  const plateA = objWriter({ materials, mtlFileName: 'set.mtl' });
  const plateB = objWriter({ materials, mtlFileName: 'set.mtl' });
  plateA.add(ONE_GROUP[0]!); // black
  plateA.add(ONE_GROUP[1]!); // red
  plateB.add(ONE_GROUP[1]!); // red again, on another plate
  plateB.add(part('extra', [0, 134, 214], [0, 0, 0, 5])); // a colour plate A never had
  const usemtl = (text: string) => text.split('\n').filter((l) => l.startsWith('usemtl ')).map((l) => l.slice(7));
  check('a shared table: a colour keeps its name on every plate', usemtl(plateA.text).join() === 'filament1,filament2' && usemtl(plateB.text).join() === 'filament2,filament3',
    `${usemtl(plateA.text).join()} / ${usemtl(plateB.text).join()}`);
  check('a shared table: one MTL names every material of every plate, in first-used order',
    buildMtl(materials) === 'newmtl filament1\nKd 0.0863 0.0863 0.0863\n\nnewmtl filament2\nKd 0.7843 0.0627 0.1804\n\nnewmtl filament3\nKd 0.0000 0.5255 0.8392\n');
  check('a shared table: each plate still numbers its own vertices from 1', plateB.text.includes('\nf 1 3 2\n'));
}

/* ------------------------------------------------------------------ one material per filament slot */

{
  const out = buildObjMtl(KEYCAP, { materialBy: 'extruder', mtlFileName: 'keycap.mtl' });
  const usemtl = out.obj.split('\n').filter((l) => l.startsWith('usemtl ')).map((l) => l.slice(7));
  check('by slot: the cap and the stem share slot 1, the legends keep 2 and 3', usemtl.join() === 'filament1,filament2,filament3,filament1', usemtl.join());
  check('by slot: a legend in the cap\'s colour on its own slot stays its own material', out.materialCount === 3 &&
    out.mtl === 'newmtl filament1\nKd 0.0863 0.0863 0.0863\n\nnewmtl filament2\nKd 0.9686 0.9686 0.9608\n\nnewmtl filament3\nKd 0.0863 0.0863 0.0863\n',
    JSON.stringify(out.mtl));
  const byColour = buildObjMtl(KEYCAP, { mtlFileName: 'keycap.mtl' });
  check('by colour (the default): the same parts fold onto two materials', byColour.materialCount === 2);
}
{
  // The slots the OBJ names are the slots the 3MF gives the same parts, and so are the colours.
  const threeMF = unzipSync(buildThreeMF(TWO_GROUPS, { title: 'Golden', generator: 'golden-test' }));
  const settings = strFromU8(threeMF['Metadata/model_settings.config']!);
  const slots = [...settings.matchAll(/<part id="\d+"[^>]*><metadata key="name" value="[^"]*"\/><metadata key="extruder" value="(\d+)"\/>/g)].map((m) => Number(m[1]));
  const out = buildObjMtl(TWO_GROUPS, { materialBy: 'extruder' });
  const usemtl = out.obj.split('\n').filter((l) => l.startsWith('usemtl ')).map((l) => Number(l.slice('usemtl filament'.length)));
  check('by slot: every part names the slot the 3MF puts it on', slots.length === TWO_GROUPS.length && usemtl.join() === slots.join(), `3MF ${slots.join()} / OBJ ${usemtl.join()}`);
  const palette = paletteOf(TWO_GROUPS, slots);
  const kd = (rgb: RGB) => rgb.map((v) => (v / 255).toFixed(4)).join(' ');
  check('by slot: and the colour the 3MF gives that slot',
    usemtl.every((slot) => out.mtl.includes(`newmtl filament${slot}\nKd ${kd(palette[slot - 1]!)}`)));
}

/* ------------------------------------------------------------------ report */

console.log(`\nobj: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nThe writer now produces (paste over GOLDEN only if the change is deliberate):\n');
  console.log(`const GOLDEN: Record<string, { obj: string; mtl: string; materials: number }> = ${JSON.stringify(actual, null, 2)};`);
  process.exit(1);
}
