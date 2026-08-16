// Emit one real cut file per style into apps/foldbox/demo/, so the geometry can be
// looked at without opening the app — and so a change that quietly breaks a dieline
// shows up as a diff rather than as a customer email.
//
//   pnpm --filter foldbox demo

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildCutFiles } from '../src/export/cutFiles';
import { solve } from '../src/geometry/solve';
import { DEFAULT_PARAMS, type BoxParams, type StyleId } from '../src/types';
import { styleMeta } from '../src/geometry/styles';

// cwd is the app directory under `pnpm --filter`. A URL-derived path would arrive
// percent-encoded here, which lands the output in a directory literally called
// "cursor%20projects".
const OUT = 'demo/';
mkdirSync(OUT, { recursive: true });

const CASES: [StyleId, Partial<BoxParams>][] = [
  ['tray-lid', { window: true }],
  ['tuck-top', { window: true }],
  ['snap-lock', { window: false }],
  ['sleeve', { window: false, hangHole: true }],
  ['divider', { dividerCols: 3, dividerRows: 2 }],
];

for (const [style, over] of CASES) {
  const params: BoxParams = { ...DEFAULT_PARAMS, style, ...over };
  const result = solve(params);
  const meta = styleMeta(style);
  const files = buildCutFiles(result, {
    title: `${meta.name} ${params.lengthMm}x${params.widthMm}x${params.heightMm}`,
    params,
  });
  writeFileSync(`${OUT}${style}.svg`, files.svg);
  writeFileSync(`${OUT}${style}.dxf`, files.dxf);
  writeFileSync(`${OUT}${style}.README.txt`, files.readme);

  const errs = result.diagnostics.filter((d) => d.level === 'error');
  console.log(
    `${style.padEnd(10)} ${result.netSizeMm[0].toFixed(0)}×${result.netSizeMm[1].toFixed(0)} mm · ` +
      `${result.net.panels.length}p ${result.net.creases.length}f · ` +
      `${result.overflow ? 'DOES NOT FIT' : result.rotated ? 'fits turned' : 'fits'} · ` +
      `${errs.length ? errs.map((e) => e.code).join(',') : 'clean'}`,
  );
}
console.log(`\nwritten to ${OUT}`);
