// The sheet or plate a blank is laid out on: the "Custom size" rows, and a blank that does not
// fit. What has to hold:
//
//   - a preset reads exactly as listed, and a custom size reads the size in the params;
//   - a blank too big for its sheet or plate is a WARNING: it is said, with the fix, and the
//     export is not refused — `assertExportable` lets it through and the file still builds;
//   - the fit check, "Resize to fit" and the flat view's sheet all measure a custom size at the
//     size the user gave it, not at the row's fallback;
//   - a printed blank in pieces that will not share a plate gets a plate each, in the fit check
//     and in the file, and each piece is its own slicer object either way.
//
// Run: pnpm --filter foldbox test:sheet

import { unzipSync, strFromU8 } from 'fflate';
import { assertExportable } from '../../../packages/ui-kit/src/diagnostics';
import { fitToSheet, sheetById, sheetFor, solve, SHEET_MARGIN_MM } from '../src/geometry/solve';
import { buildPrintable, buildPrintableFile } from '../src/export/printable';
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
  const file = buildPrintableFile(r.net, r.params, { title: 'big', baseName: 'big', buildId: 'test' });
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

console.log('a tray and its lid that do not share a plate');
{
  // 60 x 45 x 20 on an A1 mini: the blank is about 189 x 183 mm, the plate gives 170 x 170, and
  // the tray and the lid are each under 150 x 90.
  const p = at({ style: 'tray-lid', makeMode: 'print', sheetId: 'plate-a1mini', lengthMm: 60, widthMm: 45, heightMm: 20 });
  const r = solve(p);
  const [w, h] = r.netSizeMm;
  check('together they are bigger than the plate', !(w <= r.usableMm[0] && h <= r.usableMm[1]) && !(h <= r.usableMm[0] && w <= r.usableMm[1]),
    `${w.toFixed(0)} × ${h.toFixed(0)} on ${r.usableMm.join(' × ')}`);
  check('the pieces are the tray and the lid', r.pieces.map((q) => q.name).join() === 'tray,lid', r.pieces.map((q) => q.name).join());
  check('so they go on a plate each', JSON.stringify(r.plates) === '[[0],[1]]', JSON.stringify(r.plates));
  check('and it fits, with nothing to warn about', !r.overflow && !r.diagnostics.some((d) => d.code === 'sheet'));

  const meta = { title: 'tray', baseName: 'tray', buildId: 'test', plateSize: [180, 180] as [number, number] };
  const file = buildPrintableFile(r.net, r.params, meta, r);
  const zip = unzipSync(file.data);
  const settings = strFromU8(zip['Metadata/model_settings.config']!);
  const model = strFromU8(zip['3D/3dmodel.model']!);
  const objectName = (id: string) => new RegExp(`<object id="${id}"><metadata key="name" value="([^"]+)"`).exec(settings)?.[1];
  const onPlates = settings.split('<plate>').slice(1).map((b) => [...b.matchAll(/key="object_id" value="(\d+)"/g)].map((m) => objectName(m[1]!)));
  check('the 3MF has two plates, the tray on the first and the lid on the second', JSON.stringify(onPlates) === '[["tray"],["lid"]]', JSON.stringify(onPlates));
  // Each piece is centred on its own plate, and the second plate starts 216 mm along, where
  // Bambu Studio puts an A1 mini's second plate.
  const { parts } = buildPrintable(r.net, r.params, r);
  const centreOf = (piece: string) => {
    const id = [...settings.matchAll(/<object id="(\d+)"><metadata key="name" value="([^"]+)"/g)].find((m) => m[2] === piece)![1];
    const t = new RegExp(`<item objectid="${id}" transform="([^"]+)"`).exec(model)![1]!.split(' ').map(Number);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const part of parts.filter((q) => q.group === piece)) {
      for (let i = 0; i < part.positions.length; i += 3) {
        x0 = Math.min(x0, part.positions[i]!); x1 = Math.max(x1, part.positions[i]!);
        y0 = Math.min(y0, part.positions[i + 1]!); y1 = Math.max(y1, part.positions[i + 1]!);
      }
    }
    return [t[9]! + (x0 + x1) / 2, t[10]! + (y0 + y1) / 2];
  };
  const [tx, ty] = centreOf('tray');
  const [lx, ly] = centreOf('lid');
  check('the tray is in the middle of plate 1', Math.abs(tx - 90) < 0.01 && Math.abs(ty - 90) < 0.01, `${tx.toFixed(2)}, ${ty.toFixed(2)}`);
  check('the lid is in the middle of plate 2', Math.abs(lx - 306) < 0.01 && Math.abs(ly - 90) < 0.01, `${lx.toFixed(2)}, ${ly.toFixed(2)}`);

  // The same box on a plate that takes both: one plate, but still two objects, so a slicer can
  // move either alone.
  const big = solve({ ...p, sheetId: 'plate-256' });
  check('on a 256 mm plate they share one', big.plates.length === 1 && !big.overflow);
  const bigFile = buildPrintableFile(big.net, big.params, { ...meta, plateSize: [256, 256] }, big);
  const bigSettings = strFromU8(unzipSync(bigFile.data)['Metadata/model_settings.config']!);
  check('and the file has no plate list, but a tray and a lid', !bigSettings.includes('<plate>') && /value="tray"/.test(bigSettings) && /value="lid"/.test(bigSettings));

  // Cut from card it is one sheet whatever happens: there is no second sheet to send it to.
  const cut = solve({ ...p, makeMode: 'cut', sheetId: CUSTOM_SHEET_ID, customSheetWMm: 180, customSheetHMm: 180 });
  check('cut from card, it stays one sheet and says it does not fit', cut.plates.length === 1 && cut.overflow);

  // A tray too big for a plate even on its own is named in the warning, not the blank.
  const huge = solve({ ...p, lengthMm: 120, widthMm: 80, heightMm: 30 });
  const warning = huge.diagnostics.find((d) => d.code === 'sheet');
  check('a piece too big on its own is the warning, by name', huge.plates.length === 2 && huge.overflow && /^The (tray|lid) is /.test(warning?.message ?? ''), warning?.message);

  // "Resize to fit" looks for the biggest box whose pieces each fit a plate, which is bigger
  // than the biggest whose blank fits one.
  const dims = fitToSheet(huge.params);
  const resized = solve({ ...huge.params, ...dims });
  const together = solve({ ...resized.params, makeMode: 'cut', sheetId: CUSTOM_SHEET_ID, customSheetWMm: 180, customSheetHMm: 180 });
  check('resize to fit finds a box on two plates that would not fit one', !resized.overflow && resized.plates.length === 2 && together.overflow,
    `${dims.lengthMm} × ${dims.widthMm} × ${dims.heightMm}`);

  // A box in one piece is one object called "blank" on no plate, as it always was.
  const mailer = buildPrintable(solve(at({ style: 'mailer', makeMode: 'print' })).net, at({ makeMode: 'print' }));
  check('a one-piece box is still one object, "blank", on no plate of its own', mailer.parts.filter((q) => q.group !== 'inserts').every((q) => q.group === 'blank' && q.plate === undefined));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
