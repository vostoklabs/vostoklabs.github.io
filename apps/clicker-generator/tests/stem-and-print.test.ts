/*
  Two asks from the listing, in one place because each is small.

   1. Switch stem thickness: the post that grips the switch gets stronger by getting wider. Its
      hole must not move (the grip is the other control's job), it must keep its height (the
      whole cap is stacked on it), and it must stop short of the switch's opening.
   2. How the file prints: one wall on the first layer, a slower first layer, Arachne walls, in the
      3MF's project settings and in what MakerLab is told to write into its own 3MF.

    node apps/clicker-generator/tests/suites.mjs stem-and-print
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import Module from 'manifold-3d';
import { ringsOf } from '@vostok/manifold';

const { readModel } = await import('@vostok/export/read');
const { applyStemFit, STEM_FIT_STOCK_MM, STEM_OUTER_MAX_MM, STEM_OUTER_STEP_MM } = await import('../src/geometry/stemFit.ts');
const { CLICKER_PROCESS, clickerThreeMF } = await import('../src/export/threemfExport.ts');
const { CLICKER_HOST_PRINT, splitsTopAndBody } = await import('../src/export/objExport.ts');

type ClickerPart = import('../src/types.ts').ClickerPart;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const wasm: any = await Module();
wasm.setup();
const b = readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets/switch/mx/mx-stem.3mf'));
const raw = readModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'mx-stem.3mf');
const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
mesh.merge();
const asset = wasm.Manifold.ofMesh(mesh);
const bb0 = asset.boundingBox();
const stem = asset.translate([-(bb0.min[0] + bb0.max[0]) / 2, -(bb0.min[1] + bb0.max[1]) / 2, 0]);

/** Width of the post's outside and of its hole, partway up the straight part. */
function measure(solid: any): { outer: number; hole: number; volume: number; zMin: number; zMax: number } {
  const bb = solid.boundingBox();
  const cs = solid.slice(bb.min[2] + 0.3 * (bb.max[2] - bb.min[2]));
  const rings = ringsOf(cs) as [number, number][][];
  cs.delete();
  const width = (r: [number, number][]) => Math.max(...r.map(([x]) => x)) - Math.min(...r.map(([x]) => x));
  const sorted = rings.map(width).sort((a, c) => c - a);
  return { outer: sorted[0], hole: sorted[1], volume: solid.volume(), zMin: bb.min[2], zMax: bb.max[2] };
}

const asDrawn = measure(stem);
const atStock = applyStemFit(wasm, stem, 0);
const stockVolume = atStock.solid.volume();
atStock.solid.delete();
for (const mm of [STEM_OUTER_STEP_MM, STEM_OUTER_MAX_MM]) {
  const fit = applyStemFit(wasm, stem, 0, mm);
  const got = measure(fit.solid);
  check(`+${mm} mm: the post is that much wider`, fit.applied && Math.abs(got.outer - asDrawn.outer - mm) < 0.02, `${asDrawn.outer.toFixed(3)} -> ${got.outer.toFixed(3)} mm`);
  check(`+${mm} mm: the hole stays stock`, Math.abs(got.hole - asDrawn.hole - STEM_FIT_STOCK_MM) < 0.005, `${asDrawn.hole.toFixed(3)} -> ${got.hole.toFixed(3)} mm`);
  check(`+${mm} mm: the height does not move`, Math.abs(got.zMin - asDrawn.zMin) < 1e-3 && Math.abs(got.zMax - asDrawn.zMax) < 1e-3, `${got.zMin.toFixed(3)}..${got.zMax.toFixed(3)}`);
  check(`+${mm} mm: more plastic, one body`, got.volume > stockVolume && fit.solid.decompose().length === 1, `${stockVolume.toFixed(1)} -> ${got.volume.toFixed(1)} mm³`);
  fit.solid.delete();
}

const both = applyStemFit(wasm, stem, 0.2, 0.4);
const bothGot = measure(both.solid);
check('fit and thickness together do not fight', both.applied && Math.abs(bothGot.outer - asDrawn.outer - 0.4) < 0.02 && Math.abs(bothGot.hole - asDrawn.hole - 0.2 - STEM_FIT_STOCK_MM) < 0.02, `outer ${bothGot.outer.toFixed(3)}, hole ${bothGot.hole.toFixed(3)}`);
both.solid.delete();

const untouched = applyStemFit(wasm, stem, -STEM_FIT_STOCK_MM);
check('minus the stock fit: exactly the post as drawn', untouched.solid.volume() === stem.volume(), `${untouched.solid.volume()}`);
untouched.solid.delete();
// The stock fit (2026-11-18): the hole as drawn cracked a printed cap going on the switch.
const stock = applyStemFit(wasm, stem, 0);
const stockGot = measure(stock.solid);
check('0: the stock fit, the cross hole 0.1 mm wider than drawn', stock.applied && Math.abs(stockGot.hole - asDrawn.hole - 0.1) < 0.005 && Math.abs(stockGot.outer - asDrawn.outer) < 0.005, `hole ${asDrawn.hole.toFixed(3)} -> ${stockGot.hole.toFixed(3)} mm`);
stock.solid.delete();

// The housing's top begins 3.22 mm from the axis at its tightest (mx-switch.3mf, 2026-11-09).
const OPENING_RADIUS = 3.22;
check('the widest post still clears the switch by more than a printer\'s error',
  OPENING_RADIUS - (asDrawn.outer + STEM_OUTER_MAX_MM) / 2 >= 0.2,
  `${(OPENING_RADIUS - (asDrawn.outer + STEM_OUTER_MAX_MM) / 2).toFixed(3)} mm a side`);

// ---- How the file prints ----
const cube = wasm.Manifold.cube([20, 20, 5], true).translate([0, 0, 2.5]);
const m = cube.getMesh();
const part = (name: string, group: 'top' | 'base', extra: Partial<ClickerPart> = {}): ClickerPart => ({
  kind: group === 'top' ? 'cap' : 'body', group, colorRgb: [10, 20, 30], name, numProp: m.numProp,
  vertProperties: new Float32Array(m.vertProperties), triVerts: new Uint32Array(m.triVerts), ...extra,
});
const zip = unzipSync(clickerThreeMF([part('cap', 'top'), part('base-body', 'base')], { plate: 'a1' as never }));
const settings = JSON.parse(strFromU8(zip['Metadata/project_settings.config']));
check('3MF: Arachne walls', settings.wall_generator === 'arachne', String(settings.wall_generator));
check('3MF: one wall on the first layer', settings.only_one_wall_first_layer === '1', String(settings.only_one_wall_first_layer));
check('3MF: a slower first layer than the preset', JSON.stringify(settings.initial_layer_speed) === JSON.stringify(['30']) && JSON.stringify(settings.initial_layer_infill_speed) === JSON.stringify(['60']), `${settings.initial_layer_speed} / ${settings.initial_layer_infill_speed}`);
const declared = String(settings.different_settings_to_system[0]).split(';');
check('3MF: declared as edits, so the slicer shows them as changed', Object.keys(CLICKER_PROCESS).every((k) => declared.includes(k)), declared.join(';'));

check('MakerLab: the same three things, every value a string',
  CLICKER_HOST_PRINT.wallGenerator === 'arachne' && CLICKER_HOST_PRINT.only_one_wall_first_layer === '1'
  && CLICKER_HOST_PRINT.initial_layer_speed === '30' && CLICKER_HOST_PRINT.initial_layer_infill_speed === '60'
  && Object.values(CLICKER_HOST_PRINT).every((v) => typeof v === 'string'),
  JSON.stringify(CLICKER_HOST_PRINT));

check('MakerLab: several buttons still go as a top plate and a body plate',
  splitsTopAndBody([part('a', 'top', { objectKey: 'button-1' }), part('b', 'top', { objectKey: 'button-2' }), part('c', 'base')]), 'split');
check('MakerLab: a batch row is still not one clicker',
  !splitsTopAndBody([part('a', 'top', { objectKey: 'r01:top' }), part('c', 'base', { objectKey: 'r01:base' })]), 'not split');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
