/*
  pnpm --filter @vostok/fonts test

  The one import path every generator's "Import your own font" goes through (src/import.ts).
  What it guards, each a way the four separate copies went wrong:
   - the same file must get the same id, so a project that names an imported font finds it
     again on reopen (one copy minted a fresh id every time, and nothing ever matched);
   - a .zip brings every font inside it (only one copy took a zip at all);
   - a file that is not a font fails that file, not the import;
   - an imported font is usable for geometry (`getFont`) and listed first in `FONTS`.
  FontFace is a browser API; under node the preview half is skipped and the rest still runs.
*/

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { FONTS, getFont } from '../src/index';
import { importFontBuffer, importFontFiles, toPickerFont, fontSupportsText } from '../src/import';

// cwd, not `import.meta.url`: esbuild bundles this into node_modules/.cache.
const PKG = process.cwd();
let checks = 0;
let failed = 0;
function ok(cond: unknown, msg: string): void {
  checks++;
  if (!cond) { failed++; console.error(`  FAIL  ${msg}`); }
}
const bytes = (name: string): ArrayBuffer => {
  const b = readFileSync(join(PKG, 'src', 'fonts', name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
/** What a file input hands over, without a browser. */
const fileOf = (name: string, data: ArrayBuffer | Uint8Array) =>
  ({ name, arrayBuffer: async () => (data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data) }) as unknown as File;

const before = FONTS.length;

// One font
const anton = await importFontBuffer('My Anton.ttf', bytes('anton.ttf'));
ok(/^custom-[a-z0-9]+$/.test(anton.id) && anton.id.length <= 24, `a short id from the bytes: ${anton.id}`);
ok(anton.category === 'Custom' && anton.curated, 'listed as a curated Custom face');
ok(FONTS[0] === anton && FONTS.length === before + 1, 'put first in FONTS');
ok(/anton/i.test(anton.label), `label from the font's own name table: ${anton.label}`);
const parsed = await getFont(anton.id);
ok(parsed && typeof parsed.getPath === 'function', 'getFont(id) returns the parsed font for the geometry');

// Same file again: same id, no second entry
const again = await importFontBuffer('My Anton.ttf', bytes('anton.ttf'));
ok(again === anton && FONTS.length === before + 1, 'the same file twice is one entry with one id');
// A very long file name still gives a short id, so an app that caps saved ids keeps it whole
const longName = await importFontBuffer(`${'Extremely Long Family Name '.repeat(6)}Bold Italic.ttf`, bytes('aldrich.ttf'));
ok(longName.id.length <= 48, `long file names give a short id (${longName.id.length} chars: ${longName.id})`);

// The same bytes under another name (a host that renamed it 'Font (1).ttf'): still the same font
const renamed = await importFontBuffer('Anton (1).ttf', bytes('anton.ttf'));
ok(renamed === anton, 'a renamed copy of the same file finds the same entry, so a saved project still matches');

// Same name, different bytes: a different id
const other = await importFontBuffer('My Anton.ttf', bytes('pacifico.ttf'));
ok(other.id !== anton.id, 'a different file under the same name is a different font');

// A zip of fonts, with a folder, a stray non-font and a macOS resource fork inside
const zip = zipSync({
  'fonts/': new Uint8Array(0),
  'fonts/Aldrich.ttf': new Uint8Array(bytes('aldrich.ttf')),
  'fonts/Bevan.ttf': new Uint8Array(bytes('bevan.ttf')),
  'fonts/readme.txt': new TextEncoder().encode('not a font'),
  '__MACOSX/fonts/._Bevan.ttf': new TextEncoder().encode('resource fork'),
});
const fromZip = await importFontFiles(fileOf('family.zip', zip));
ok(fromZip.fonts.length === 2, `a zip brings both fonts inside it (got ${fromZip.fonts.length})`);
ok(fromZip.files.length === 2 && fromZip.failed.length === 0, 'and only the fonts: not the folder, the text file or the resource fork');
ok(fromZip.files.every(([n]) => !n.includes('/')), 'a zip entry comes back as its bare file name, without the folder');

// Not a font
const bad = await importFontFiles(fileOf('photo.ttf', new TextEncoder().encode('definitely not a font')));
ok(bad.fonts.length === 0 && bad.failed.length === 1, 'a file that is not a font fails on its own, without throwing');

// The adapters the kit's picker takes
const pf = toPickerFont(anton);
ok(pf.id === anton.id && pf.family === `VL-${anton.id}` && pf.category === 'Custom', 'toPickerFont gives the kit its shape');
ok(fontSupportsText('abril-fatface', 'Hello'), 'a latin face supports latin text');
ok(!fontSupportsText('abril-fatface', 'Привет'), 'and is flagged for cyrillic it does not have');
ok(fontSupportsText('no-such-font', 'Привет'), 'an unknown id is not flagged');

console.log(`\nfont import: ${checks - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
