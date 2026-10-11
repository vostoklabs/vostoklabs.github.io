// The sheet or plate a blank is laid out on: the "Custom size" rows, and a blank that does not
// fit. What has to hold:
//
//   - a preset reads exactly as listed, and a custom size reads the size in the params;
//   - a blank too big for its sheet or plate is a WARNING: it is said, with the fix, and the
//     export is not refused — `assertExportable` lets it through and the file still builds;
//   - the fit check, "Resize to fit" and the flat view's sheet all measure a custom size at the
//     size the user gave it, not at the row's fallback.
//
// Run: pnpm --filter foldbox test:sheet

import { assertExportable } from '../../../packages/ui-kit/src/diagnostics';
import { fitToSheet, sheetById, sheetFor, solve, SHEET_MARGIN_MM } from '../src/geometry/solve';
import { buildPrintableFile } from '../src/export/printable';
import { CUSTOM_PLATE_ID, CUSTOM_SHEET_ID, DEFAULT_PARAMS, SHEETS, type BoxParams } from '../src/types';

let failures = 0;
let checks = 0;
const check = (name: string, ok: boolean, detail = '') => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const at = (p: Partial<BoxParams>): BoxParams => ({ ...DEFAULT_PARAMS, ...p });

console.log('the sheet a blank is laid out on');
{
  const presets = SHEETS.filter((s) => s.id !== CUSTOM_SHEET_ID && s.id !== CUSTOM_PLATE_ID);
  check('every preset reads exactly as listed', presets.every((s) => sheetFor(at({ sheetId: s.id })) === sheetById(s.id)));
  check('each list has exactly one Custom size',
    SHEETS.filter((s) => s.id === CUSTOM_SHEET_ID && s.kind === 'sheet').length === 1
      && SHEETS.filter((s) => s.id === CUSTOM_PLATE_ID && s.kind === 'plate').length === 1);
  const sheet = sheetFor(at({ sheetId: CUSTOM_SHEET_ID, customSheetWMm: 640, customSheetHMm: 410 }));
  check('a custom sheet of card is the size in the params', sheet.widthMm === 640 && sheet.heightMm === 410 && sheet.kind === 'sheet', sheet.name);
  const plate = sheetFor(at({ sheetId: CUSTOM_PLATE_ID, customPlateWMm: 400, customPlateHMm: 380 }));
  check('a custom plate is the size in the params, on the plain grid', plate.widthMm === 400 && plate.heightMm === 380 && plate.kind === 'plate' && !plate.plate, plate.name);
  check('its name carries the size the way a preset does', plate.name === 'Custom size (400 × 380)', plate.name);
  const broken = sheetFor(at({ sheetId: CUSTOM_PLATE_ID, customPlateWMm: Number.NaN, customPlateHMm: -3 }));
  check('a size that is not a size falls back to the row\'s own', broken.widthMm > 0 && broken.heightMm > 0, `${broken.widthMm} × ${broken.heightMm}`);
}

console.log('a blank too big for its plate');
{
  // A 200 mm cube mailer on the 256 mm plate: far too big.
  const big = at({ style: 'mailer', makeMode: 'print', sheetId: 'plate-256', lengthMm: 200, widthMm: 200, heightMm: 120 });
  const r = solve(big);
  const d = r.diagnostics.find((x) => x.code === 'sheet');
  check('it overflows, and says so as a warning with a fix', r.overflow && d?.level === 'warning' && !!d.fix, d?.message);
  let refused = '';
  try {
    assertExportable(r.diagnostics);
  } catch (err) {
    refused = (err as Error).message;
  }
  check('the export is not refused for it', !refused, refused || 'passes');
  const file = buildPrintableFile(r.net, r.params, { title: 'big', baseName: 'big', buildId: 'test' }, '3mf');
  check('and the printable file still builds', file.data.length > 1000, `${(file.data.length / 1024).toFixed(0)} kB`);

  // The same box on a custom plate the blank fits on: nothing to say.
  const [w, h] = r.netSizeMm.map((v) => Math.ceil(v + 2 * SHEET_MARGIN_MM + 1));
  const roomy = solve({ ...big, sheetId: CUSTOM_PLATE_ID, customPlateWMm: Math.max(w, h), customPlateHMm: Math.max(w, h) });
  check('on a custom plate big enough, it fits', !roomy.overflow && !roomy.diagnostics.some((x) => x.code === 'sheet'),
    `${roomy.netSizeMm.map((v) => v.toFixed(0)).join(' × ')} on ${Math.max(w, h)} mm`);
  check('the usable area is the custom size less the margin',
    roomy.usableMm[0] === Math.max(w, h) - 2 * SHEET_MARGIN_MM && roomy.usableMm[1] === Math.max(w, h) - 2 * SHEET_MARGIN_MM,
    roomy.usableMm.join(' × '));
}

console.log('resize to fit a custom size');
{
  const p = at({ style: 'mailer', makeMode: 'cut', sheetId: CUSTOM_SHEET_ID, customSheetWMm: 500, customSheetHMm: 500 });
  const dims = fitToSheet(p);
  const r = solve({ ...p, ...dims });
  check('the box it finds fits the custom sheet', !r.overflow, `${dims.lengthMm} × ${dims.widthMm} × ${dims.heightMm}`);
  const onA4 = solve({ ...p, ...dims, sheetId: 'a4-land' });
  check('and is bigger than one that fits A4 would be', onA4.overflow, `${r.netSizeMm.map((v) => v.toFixed(0)).join(' × ')} mm blank`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
