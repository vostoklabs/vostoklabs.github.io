// The sheet sizes and materials: every entry as it stands, pinned, and the ones added since.
//
// A kerf here is what a cut file is offset by, so a number that moves moves every joint cut
// from it. Each one is pinned below: changing one is a decision with this test changed beside
// it, never a side effect.
//
// Run: node tests/sheets.test.mjs   (esbuild bundles the TS source under test)
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const tmp = `${here}.tmp-sheets`;
mkdirSync(tmp, { recursive: true });
await build({ entryPoints: [`${here}../src/sheets.ts`], outfile: `${tmp}/sheets.mjs`, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const { SHEET_PRESETS, MATERIALS, materialById, presetById } = await import(`${pathToFileURL(`${tmp}/sheets.mjs`).href}?${Date.now()}`);

let pass = 0;
let fail = 0;
const ok = (cond, what) => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗ ' + what);
  }
};
const row = (o) => JSON.stringify(o);

// [id, name, width, height, group], in the order the pickers list them.
const PRESETS = [
  ['h2d-10w', 'Bambu Lab H2D · 10 W laser', 310, 270, 'Machines'],
  ['h2d-40w', 'Bambu Lab H2D · 40 W laser', 310, 250, 'Machines'],
  ['sheet-12x12', '12 × 12 in sheet', 305, 305, 'Sheets & blanks'],
  ['sheet-12x20', '12 × 20 in sheet', 508, 305, 'Sheets & blanks'],
  ['sheet-a4', 'A4', 297, 210, 'Sheets & blanks'],
  ['sheet-a3', 'A3', 420, 297, 'Sheets & blanks'],
  ['sheet-400x400', '400 × 400 mm', 400, 400, 'Sheets & blanks'],
  ['sheet-300x300', '300 × 300 mm', 300, 300, 'Sheets & blanks'],
  ['sheet-300x200', '300 × 200 mm', 300, 200, 'Sheets & blanks'],
  ['sheet-200x200', '200 × 200 mm', 200, 200, 'Sheets & blanks'],
  ['sheet-100x100', '100 × 100 mm (slate coaster)', 100, 100, 'Sheets & blanks'],
  ['sheet-card', '85 × 54 mm (aluminium card)', 85, 54, 'Sheets & blanks'],
  ['custom', 'Custom size', 200, 200, 'Sheets & blanks'],
];
ok(SHEET_PRESETS.length === PRESETS.length, `${SHEET_PRESETS.length} sheet presets`);
PRESETS.forEach(([id, name, widthMm, heightMm, group], i) => {
  const p = SHEET_PRESETS[i];
  ok(row(p) === row({ id, name, widthMm, heightMm, group }), `preset ${i}: ${row(p)}`);
});
ok(new Set(SHEET_PRESETS.map((p) => p.id)).size === SHEET_PRESETS.length, 'preset ids are unique');
ok(presetById('sheet-300x300')?.widthMm === 300 && presetById('sheet-400x400')?.heightMm === 400, 'the square sheets are found by id');
ok(presetById('nope') === undefined, 'an unknown sheet is not invented');

// [id, name, thickness, kerf, hex, engrave only], in the order the pickers list them.
const STOCK = [
  ['ply15', 'Basswood plywood 1.5 mm', 1.5, 0.15, '#d6b98a'],
  ['ply3', 'Basswood plywood 3 mm', 3, 0.18, '#c9a978'],
  ['ply4', 'Basswood plywood 4 mm', 4, 0.2, '#c9a978'],
  ['ply6', 'Basswood plywood 6 mm', 6, 0.24, '#c9a978'],
  ['mdf3', 'MDF 3 mm', 3, 0.2, '#b09a7a'],
  ['mdf6', 'MDF 6 mm', 6, 0.25, '#b09a7a'],
  ['acr-opaque3', 'Opaque acrylic 3 mm', 3, 0.18, '#d64550'],
  ['acr-clear3', 'Clear acrylic 3 mm', 3, 0.18, '#bfe3ee'],
  ['leatherette', 'Leatherette 1.4 mm', 1.4, 0.1, '#6b4a2f'],
  ['card2', 'Greyboard / card 2 mm', 2, 0.12, '#9aa0a6'],
  ['slate', 'Slate (engrave only)', 8, 0, '#4a4f57', true],
  ['anodised', 'Anodised aluminium (engrave only)', 0.5, 0, '#8d9298', true],
];
ok(MATERIALS.length === STOCK.length, `${MATERIALS.length} materials`);
STOCK.forEach(([id, name, thicknessMm, kerfMm, hex, engraveOnly], i) => {
  const m = MATERIALS[i];
  ok(row(m) === row({ id, name, thicknessMm, kerfMm, hex, ...(engraveOnly ? { engraveOnly } : {}) }), `material ${i}: ${row(m)}`);
});
ok(new Set(MATERIALS.map((m) => m.id)).size === MATERIALS.length, 'material ids are unique');
ok(materialById('mdf6').thicknessMm === 6, 'MDF 6 mm is found by id, not the 3 mm ply fallback');
ok(materialById('nope').id === 'ply3', 'an unknown material falls back to 3 mm ply, as it always has');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
