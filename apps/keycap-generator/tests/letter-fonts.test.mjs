/*
  The keycap's legends in any alphabet the font library writes (src/letterFonts.js).

    node apps/keycap-generator/tests/letter-fonts.test.mjs      (part of pnpm test)

  What has to hold:
   - the keycap's 29 faces keep their ids, in their order, and are listed first; the library's
     faces follow, one per family the keycap does not already have, in the kit chooser's shape;
   - Korean, Japanese, Chinese, Russian, Greek and accented Latin each move to a face that
     writes them: Roboto (the keycap's default) when it can, else the library's plain face for
     the alphabet, and every face offered writes the text;
   - once `ensureLetterFont` has loaded that face, the synchronous `parseLetter` draws the text
     in it (outlines, a box with an area), and the face, judged from its own glyphs now, still
     writes it;
   - a library face not loaded yet is judged by the coverage the library measured; an unknown id
     cannot be loaded;
   - loading a library face changes nothing the keycap's own faces draw.

  The library finds its files through Vite's `import.meta.glob`, stood in for here with the
  files on disk; `fetch` reads those, and the app's public/ folder as the page does.
*/
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONTS_SRC = resolve(APP, '..', '..', 'packages', 'fonts', 'src');

// ------------------------------------------------------------------ what Vite and the page provide
/** `import.meta.glob` as Vite answers it, with file URLs of the real files. Only the font
 *  library globs, relative to its own src/. */
globalThis.__viteGlob = (pattern) => {
  const rel = pattern.replace(/^\.\//, '');
  const slash = rel.lastIndexOf('/');
  const dir = join(FONTS_SRC, rel.slice(0, slash));
  const match = new RegExp(`^${rel.slice(slash + 1).replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`);
  const out = {};
  for (const f of readdirSync(dir)) if (match.test(f)) out[`./${rel.slice(0, slash)}/${f}`] = pathToFileURL(join(dir, f)).href;
  return out;
};
globalThis.fetch = async (url) => {
  const s = String(url);
  const file = s.startsWith('file:') ? fileURLToPath(s) : join(APP, 'public', s);
  if (!existsSync(file)) return { ok: false, status: 404 };
  const buf = readFileSync(file);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};
const warn = console.warn;
console.warn = (...args) => { if (!String(args[0]).startsWith('Could not load font')) warn(...args); };

const cacheDir = join(APP, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, `letter-fonts-${process.pid}.mjs`);
await build({
  stdin: {
    contents: [
      "export { ensureLetterFont, letterFontList, fontWritesText, facesThatWrite, alphabetOf } from './src/letterFonts.js';",
      "export { FONT_OPTIONS, BUNDLED_TTF, loadBundledFonts, parseLetter } from './src/letter.js';",
      "export { FONTS } from '@vostok/fonts';",
    ].join('\n'),
    resolveDir: APP,
    sourcefile: 'letter-fonts-entry.js',
    loader: 'js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  define: { 'import.meta.glob': 'globalThis.__viteGlob' },
});
const app = await import(pathToFileURL(outfile).href);
rmSync(outfile, { force: true });

let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (ok) passes++; else failures++;
};
/** What a legend's outlines are, to the last coordinate. */
const drawn = (text, id) => JSON.stringify(app.parseLetter(text, id).contours);

// ------------------------------------------------------------------ the keycap's own faces
const OWN = [
  'helvetiker-regular', 'helvetiker-bold', 'optimer-regular', 'optimer-bold', 'gentilis-regular', 'gentilis-bold',
  'droid-sans-regular', 'droid-sans-bold', 'droid-sans-mono-regular', 'droid-serif-regular', 'droid-serif-bold',
  ...app.BUNDLED_TTF.map(([slug]) => `bundled-${slug}`),
];
const before = { roboto: drawn('Esc', 'helvetiker-regular'), mono: drawn('Q', 'droid-sans-mono-regular') };
await app.loadBundledFonts();
before.pacifico = drawn('Fn', 'bundled-pacifico');
const ids = app.FONT_OPTIONS.map((f) => f.id);
check('the 29 own faces keep their ids and order', OWN.length === 29 && ids.length === 29 && OWN.every((id, i) => ids[i] === id), `${ids.length} faces`);

const list = app.letterFontList();
check('the list starts with the own faces', OWN.every((id, i) => list[i]?.id === id), list.slice(0, 3).map((f) => f.label).join(', '));
check('every entry has the chooser\'s shape', list.every((f) => f.id && f.label && f.family && Array.isArray(f.scripts)));
check('each id once', new Set(list.map((f) => f.id)).size === list.length, `${list.length} faces`);
const familyOf = (label) => label.toLowerCase().replace(/\b(bold|regular)\b/g, '').replace(/[^a-z0-9]/g, '');
const ownFamilies = new Set(list.slice(0, 29).map((f) => familyOf(f.label)));
const shelf = list.slice(29);
check('no family offered twice', shelf.every((f) => !ownFamilies.has(familyOf(f.label))),
  shelf.filter((f) => ownFamilies.has(familyOf(f.label))).map((f) => f.id).join(', ') || 'none');
for (const id of ['roboto', 'bebas-neue', 'pacifico', 'libertinus-sans']) check(`the library's ${id} is left to the keycap's own copy`, !shelf.some((f) => f.id === id));
check('every other library face is offered', app.FONTS.every((f) => shelf.some((s) => s.id === f.id) || ownFamilies.has(familyOf(f.label))),
  `${shelf.length} of ${app.FONTS.length}`);
for (const id of ['gothic-a1', 'm-plus-1p', 'noto-sans-sc', 'montserrat']) check(`${id} is offered`, shelf.some((f) => f.id === id));
check('Roboto is measured as Latin, Cyrillic and Greek', ['Latin', 'Cyrillic', 'Greek'].every((s) => list[0].scripts.includes(s)) && !list[0].scripts.includes('Korean'),
  list[0].scripts.join(', '));
check('Gothic A1 is listed as Korean', shelf.find((f) => f.id === 'gothic-a1')?.scripts.includes('Korean'));

// ------------------------------------------------------------------ judging a face
check('Roboto cannot write Korean', !app.fontWritesText('helvetiker-regular', '한글'), 'judged from its glyphs');
check('a library face not loaded yet is judged by its coverage',
  app.fontWritesText('gothic-a1', '한글') && !app.fontWritesText('abril-fatface', '한글') && !app.FONT_OPTIONS.some((f) => f.id === 'gothic-a1'));
check('an unknown id cannot be loaded', (await app.ensureLetterFont('no-such-face')) === false);

// ------------------------------------------------------------------ every alphabet
const SAMPLES = [
  ['Korean', '한글', 'gothic-a1'],
  ['Japanese', 'かな', 'm-plus-1p'],
  ['Chinese', '汉字', 'noto-sans-sc'],
  ['Russian', 'Привет', 'helvetiker-regular'],
  ['Greek', 'Ωμέγα', 'helvetiker-regular'],
  ['accented Latin', 'Ñandú', 'helvetiker-regular'],
];
for (const [alphabet, text, want] of SAMPLES) {
  const faces = app.facesThatWrite(text);
  check(`${alphabet} ${text} lands on ${want}`, faces[0] === want, faces.slice(0, 4).join(', '));
  check(`every face offered for ${text} writes it`, faces.length > 0 && faces.every((id) => app.fontWritesText(id, text)), `${faces.length} faces`);
  const after = faces.find((id) => !app.FONT_OPTIONS.some((f) => f.id === id && !f.shelf));
  if (want === 'helvetiker-regular') {
    const plain = { Russian: 'montserrat', Greek: 'gothic-a1', 'accented Latin': 'montserrat' }[alphabet];
    check(`after the keycap's faces, ${text} leads with ${plain}`, after === plain, after ?? '(none)');
  }
  for (const id of new Set([faces[0], after].filter(Boolean))) {
    const loaded = await app.ensureLetterFont(id);
    let detail = '';
    let ok = loaded;
    try {
      const r = app.parseLetter(text, id);
      const w = r.box.max.x - r.box.min.x;
      const h = r.box.max.y - r.box.min.y;
      ok = ok && r.contours.length > 0 && w > 0 && h > 0 && r.fontName === app.FONT_OPTIONS.find((f) => f.id === id)?.name;
      detail = `${r.contours.length} outlines, ${w.toFixed(0)} x ${h.toFixed(0)}, in ${r.fontName}`;
    } catch (e) {
      ok = false;
      detail = e.message;
    }
    check(`${text} drawn in ${id}`, ok, detail);
    check(`${id}, loaded, still writes ${text}`, app.fontWritesText(id, text), 'judged from its glyphs');
  }
}
check('the alphabet is named for the message',
  app.alphabetOf('한글') === 'Korean' && app.alphabetOf('Ñandú') === 'accented' && app.alphabetOf('Esc') === null);

// ------------------------------------------------------------------ loading changes nothing else
const loadedShelf = app.FONT_OPTIONS.filter((f) => f.shelf).map((f) => f.id);
check('a library face is loaded once', loadedShelf.length === new Set(loadedShelf).size && (await app.ensureLetterFont('gothic-a1'))
  && app.FONT_OPTIONS.filter((f) => f.id === 'gothic-a1').length === 1, loadedShelf.join(', '));
check('the own faces stay first, in their order', OWN.every((id, i) => app.FONT_OPTIONS[i].id === id));
check('the list keeps its order once faces load', JSON.stringify(app.letterFontList().map((f) => f.id)) === JSON.stringify(list.map((f) => f.id)));
check('the own faces draw as before', drawn('Esc', 'helvetiker-regular') === before.roboto && drawn('Q', 'droid-sans-mono-regular') === before.mono
  && drawn('Fn', 'bundled-pacifico') === before.pacifico);

console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nall ${passes} letter-font checks pass`);
process.exit(failures ? 1 : 0);
