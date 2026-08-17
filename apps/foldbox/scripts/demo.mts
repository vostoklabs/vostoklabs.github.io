// Emit one real cut file per style into apps/foldbox/demo/, so the geometry can be
// looked at without opening the app — and so a change that quietly breaks a dieline
// shows up as a diff rather than as a customer email.
//
//   pnpm --filter foldbox demo

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildThreeMF } from '@vostok/export';
import { buildCutFiles } from '../src/export/cutFiles';
import { buildPrintable } from '../src/export/printable';
import { solve } from '../src/geometry/solve';
import { DEFAULT_PARAMS, type BoxParams, type StyleId } from '../src/types';
import { styleMeta } from '../src/geometry/styles';

// cwd is the app directory under `pnpm --filter`. A URL-derived path would arrive
// percent-encoded here, which lands the output in a directory literally called
// "cursor%20projects".
const OUT = 'demo/';
mkdirSync(OUT, { recursive: true });

const CASES: [StyleId, Partial<BoxParams>, string?][] = [
  ['mailer', { window: false }],
  // A hand hole needs ~14 mm of opening plus clearance to the rim, so a 25 mm end
  // has nowhere to put one. 64 x 60 x 30 is the biggest carry mailer that still
  // fits A4 — the end has to reach 30 mm, and 3H + 2W is what the blank then costs
  // in the other direction.
  ['mailer', { window: false, handHoles: true, lengthMm: 64, heightMm: 30 }, 'mailer-carry'],
  ['handle-box', { window: false, lengthMm: 90, widthMm: 35, heightMm: 20 }],
  ['tray', { window: false, handle: true }, 'tray-basket'],
  ['tray', { window: false, handle: false }],
  ['tray-lid', { window: true }],
  ['tuck-top', { window: true }],
  ['snap-lock', { window: false }],
  ['sleeve', { window: false, hangHole: true }],
  ['divider', { dividerCols: 3, dividerRows: 2 }],
];

for (const [style, over, nameOverride] of CASES) {
  const name = nameOverride ?? style;
  const params: BoxParams = { ...DEFAULT_PARAMS, style, ...over };
  const result = solve(params);
  const meta = styleMeta(style);
  const files = buildCutFiles(result, {
    title: `${meta.name} ${params.lengthMm}x${params.widthMm}x${params.heightMm}`,
    params,
  });
  writeFileSync(`${OUT}${name}.svg`, files.svg);
  writeFileSync(`${OUT}${name}.dxf`, files.dxf);
  writeFileSync(`${OUT}${name}.README.txt`, files.readme);

  // The same net as a printed sheet. Written for every style so a change that makes
  // a blank untessellatable shows up here as well as in test:print.
  const { parts, stats } = buildPrintable(result.net, params);
  writeFileSync(
    `${OUT}${name}.3mf`,
    buildThreeMF(parts, { title: `${meta.name} (printable)`, generator: 'foldbox' }),
  );

  const errs = result.diagnostics.filter((d) => d.level === 'error');
  console.log(
    `${name.padEnd(12)} ${result.netSizeMm[0].toFixed(0)}×${result.netSizeMm[1].toFixed(0)} mm · ` +
      `${result.net.panels.length}p ${result.net.creases.length}f · ` +
      `${result.overflow ? 'DOES NOT FIT' : result.rotated ? 'fits turned' : 'fits'} · ` +
      `${errs.length ? errs.map((e) => e.code).join(',') : 'clean'} · ` +
      `print ${stats.sheetMm.toFixed(2)}/${stats.hingeMm.toFixed(2)} mm, ${stats.triangles} tris`,
  );
}
console.log(`\nwritten to ${OUT}`);
