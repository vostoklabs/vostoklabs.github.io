/*
  The clicker's 3MF: one slicer object per plate object, each under its own name.

  The shared writer (@vostok/export) makes one slicer object per group and names it after the
  group, so threemfExport.ts gives every plate object a group of its own, named by its label.
  Two plate objects with the same label must still be two objects: the fit test's pieces all
  fall back to "clicker_base", and grouped by that name they would arrive as one object the
  slicer cannot pull apart.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/export-objects.test.ts \
      --bundle --platform=node --format=esm \
      --outfile=apps/clicker-generator/.export-objects-test.mjs \
      && node apps/clicker-generator/.export-objects-test.mjs
*/
import { unzipSync, strFromU8 } from 'fflate';
import { buildThreeMF } from '../src/export/threemfExport.ts';
import type { ClickerPart } from '../src/types.ts';

const tetra = (name: string, group: 'top' | 'base', x: number, extra: Partial<ClickerPart> = {}): ClickerPart => ({
  kind: group === 'top' ? 'cap' : 'body',
  group,
  colorRgb: [240, 240, 240],
  name,
  numProp: 3,
  vertProperties: new Float32Array([x, 0, 0, x + 10, 0, 0, x, 10, 0, x, 0, 10]),
  triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
  ...extra,
});

/** Each slicer object in the file: its name and how many parts it holds. */
function objectsOf(parts: ClickerPart[]): { name: string; parts: number }[] {
  const cfg = strFromU8(unzipSync(buildThreeMF(parts, { plate: 'a1' }))['Metadata/model_settings.config']!);
  return [...cfg.matchAll(/<object id="\d+"><metadata key="name" value="([^"]*)"\/>((?:(?!<\/object>)[\s\S])*)/g)]
    .map(([, name, body]) => ({ name: name!, parts: (body!.match(/<part /g) ?? []).length }));
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// The fit test: one plate object per piece, and no label on any of them.
const fit = objectsOf([0, 1, 2].map((i) => tetra(`fit-${i}`, 'base', i * 20, { objectKey: `fit-${i}` })));
check('three fit-test pieces stay three objects', fit.length === 3 && fit.every((o) => o.parts === 1), JSON.stringify(fit));
check('under three names', new Set(fit.map((o) => o.name)).size === 3, fit.map((o) => o.name).join(', '));
check('the first keeps the label', fit[0]?.name === 'clicker_base', fit[0]?.name ?? '(none)');

// A batch run labels every plate object itself: labels that are already unique are used as given.
const batch = objectsOf(
  ['r01', 'r02'].flatMap((row, i) => [
    tetra(`${row}-cap`, 'top', i * 40, { objectKey: `${row}:top`, objectLabel: `${row}_top` }),
    tetra(`${row}-ink`, 'top', i * 40, { objectKey: `${row}:top`, objectLabel: `${row}_top` }),
    tetra(`${row}-body`, 'base', i * 40, { objectKey: `${row}:base`, objectLabel: `${row}_base` }),
  ]),
);
check(
  'labelled objects keep their labels and their parts',
  batch.map((o) => `${o.name}:${o.parts}`).join(',') === 'r01_top:2,r01_base:1,r02_top:2,r02_base:1',
  batch.map((o) => `${o.name}:${o.parts}`).join(', '),
);

console.log(failures ? `\n${failures} FAILED` : '\nevery plate object is its own slicer object, under its own name');
process.exit(failures ? 1 : 0);
