/*
  The zip and the cut download.

    pnpm --filter @vostok/export check

  `buildZip` deflates at level 6 unless asked otherwise, and the default is the same archive,
  byte for byte, it has always written. A cut download is the one SVG when there is one sheet,
  and a zip of the sheets and the README when there are more, entries in the order given.
*/
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildZip, cutFileBundle, downloadCut, type CutFile } from '../src/index';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  —  ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ a frozen clock */

// A zip entry carries its time, so two archives are only comparable made at the same moment.
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

const FILES = {
  'sheet-1.svg': `<svg>${'<path d="M 0 0 L 10 0 L 10 10 Z"/>'.repeat(40)}</svg>`,
  'logo.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6, 7, 8]),
};
const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
/** The compression method of every local file header: 0 stored, 8 deflated. */
const methods = (zip: Uint8Array) => {
  const out: number[] = [];
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let at = 0; at + 30 <= zip.length && view.getUint32(at, true) === 0x04034b50;) {
    out.push(view.getUint16(at + 8, true));
    at += 30 + view.getUint32(at + 18, true) + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  }
  return out;
};
const entries = (zip: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(zip)).map(([k, v]) => [k, strFromU8(v)]));

/* ------------------------------------------------------------------ the level */

{
  const before = zipSync({ 'sheet-1.svg': strToU8(FILES['sheet-1.svg']), 'logo.png': FILES['logo.png'] }, { level: 6 });
  check('default: the same archive as before, byte for byte', bytesEqual(buildZip(FILES), before));
  check('default: deflated', methods(buildZip(FILES)).join() === '8,8');
  const stored = buildZip(FILES, { level: 0 });
  check('level 0: every file stored as it is', methods(stored).join() === '0,0' && stored.length > buildZip(FILES).length);
  check('level 0: and read back the same', JSON.stringify(entries(stored)) === JSON.stringify(entries(buildZip(FILES))));
  check('level 9: deflated, and read back the same', methods(buildZip(FILES, { level: 9 })).join() === '8,8'
    && JSON.stringify(entries(buildZip(FILES, { level: 9 }))) === JSON.stringify(entries(buildZip(FILES))));
}

/* ------------------------------------------------------------------ the cut download */

const SHEETS: CutFile[] = [
  { name: 'box-sheet-1.svg', text: '<svg id="1"/>' },
  { name: 'box-sheet-2.svg', text: '<svg id="2"/>' },
];
{
  const one = cutFileBundle([SHEETS[0]!], 'box', 'a README');
  check('one sheet: its own SVG, the README left out', one.name === 'box-sheet-1.svg' && one.data === '<svg id="1"/>' && one.mime === 'image/svg+xml');
  const two = cutFileBundle(SHEETS, 'box', 'Red lines cut.');
  check('two sheets: one zip named after the stem', two.name === 'box.zip' && two.mime === 'application/zip' && two.data instanceof Uint8Array);
  check('two sheets: the sheets, then the README, as given',
    JSON.stringify(entries(two.data as Uint8Array)) === JSON.stringify({ 'box-sheet-1.svg': '<svg id="1"/>', 'box-sheet-2.svg': '<svg id="2"/>', 'README.txt': 'Red lines cut.' }));
  check('two sheets, no README: just the sheets', Object.keys(entries(cutFileBundle(SHEETS, 'box').data as Uint8Array)).join() === 'box-sheet-1.svg,box-sheet-2.svg');
  // A list that carries its own README (the way Laser Studio builds it) zips as it stands, the
  // same archive it zipped by hand.
  const listed = [...SHEETS, { name: 'README.txt', text: 'Run the engrave first.' }];
  check('a README already in the list: zipped as given, the same bytes as zipping it by hand',
    bytesEqual(cutFileBundle(listed, 'run').data as Uint8Array, buildZip(Object.fromEntries(listed.map((f) => [f.name, f.text])))));
}
{
  // downloadCut hands the bundle to the browser's download: a link clicked with its name.
  const clicked: { name: string; size: number; type: string }[] = [];
  let pending: Blob | null = null;
  Object.assign(globalThis, {
    document: {
      createElement: () => {
        const a = { href: '', download: '', click: () => clicked.push({ name: a.download, size: pending!.size, type: pending!.type }), remove: () => {} };
        return a;
      },
      body: { appendChild: () => {} },
    },
  });
  URL.createObjectURL = (b: Blob) => {
    pending = b;
    return 'blob:cut';
  };
  URL.revokeObjectURL = () => {};
  const saved = downloadCut(SHEETS, 'box', 'Red lines cut.');
  const single = downloadCut([SHEETS[1]!], 'box', 'Red lines cut.');
  check('downloadCut: saves the zip and says its name', saved === 'box.zip' && clicked[0]?.name === 'box.zip' && clicked[0]?.type === 'application/zip');
  check('downloadCut: one sheet saves the SVG', single === 'box-sheet-2.svg' && clicked[1]?.name === 'box-sheet-2.svg' && clicked[1]?.type === 'image/svg+xml' && clicked[1]?.size === 13);
}

/* ------------------------------------------------------------------ report */

console.log(`\nzip: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
