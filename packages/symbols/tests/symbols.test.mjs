// @vostok/symbols: the library, its search, its shapes, its stored data and its old-code tables.
//
// Run: node packages/symbols/tests/symbols.test.mjs   (esbuild bundles the TS source). Part of
// `pnpm test`, so CI runs it. The Material font is read from disk here; under node the package's
// font URL table is empty, so Material shapes are measured through `glyphShapes` directly.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const pkg = `${here}..`;
const tmp = `${pkg}/node_modules/.cache`;
mkdirSync(tmp, { recursive: true });
const entry = `${tmp}/test-entry.ts`;
writeFileSync(entry, [
  `export * from '${pkg}/src/index.ts';`,
  `export { encodeOutline, decodeOutline } from '${pkg}/src/outline.ts';`,
  `export { glyphShapes } from '${pkg}/src/glyph.ts';`,
  `export { MATERIAL_SOLID, MATERIAL_FONT_SHA256 } from '${pkg}/src/material-solid.ts';`,
].join('\n'));
const outfile = `${tmp}/symbols-test-${process.pid}.mjs`;
await build({
  entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
  // `import.meta.glob` exists only under Vite; the font URL table stays empty here.
  define: { 'import.meta.glob': 'globalThis.__viteGlob' },
  banner: { js: 'globalThis.__viteGlob = () => ({});' },
});
const S = await import(pathToFileURL(outfile).href);

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const bbox = (shapes) => {
  const pts = shapes.flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
const wellFormed = (shapes) => shapes.length > 0 && shapes.every((isl) => isl.length > 0 && isl.every((r) => r.length >= 3 && r.every((p) => p.length === 2 && p.every(Number.isFinite))));

// ── the library ──
const all = S.searchSymbols('');
const bySet = (set) => all.filter((e) => e.set === set).length;
check('three sets', S.SYMBOL_SETS.map((s) => s.id).join() === 'fluent,tabler,material');
check('every Material glyph is in the library', bySet('material') === 1487, String(bySet('material')));
const fluentIndex = JSON.parse(readFileSync(`${pkg}/data/fluent-emoji-high-contrast.json`, 'utf8'));
const tablerIndex = JSON.parse(readFileSync(`${pkg}/data/tabler-icons-filled.json`, 'utf8'));
check('every stored Fluent and Tabler symbol is in the library', bySet('fluent') === fluentIndex.symbols.length && bySet('tabler') === tablerIndex.symbols.length);
check('ids are unique', new Set(all.map((e) => e.id)).size === all.length);
check('a Material entry carries its character', S.symbolById('material:favorite')?.char === '\u{e87d}');

// ── ids projects already hold ──
check('a bare Material name resolves', S.resolveSymbolId('favorite') === 'material:favorite');
check('a kit catalog id resolves', S.resolveSymbolId('fluent-cat-face') === 'fluent:cat-face' && S.resolveSymbolId('tabler-heart') === 'tabler:heart');
check('an unknown id does not', S.resolveSymbolId('tabler-rocket') === undefined && S.symbolById('nope') === undefined);
const catalog = JSON.parse(readFileSync(`${pkg}/../ui-kit/src/symbols/catalog.json`, 'utf8'));
const lost = catalog.filter((c) => !S.symbolById(c.id));
check('every symbol of the kit catalog has its entry here', !lost.length, lost.map((c) => c.id).join(' '));

// ── categories ──
const empty = S.SYMBOL_CATEGORIES.filter((c) => !S.listSymbols(c.id).length);
check('every category lists something', !empty.length, empty.map((c) => c.id).join(' '));
const groups = new Set(S.SYMBOL_CATEGORIES.map((c) => c.id));
const stray = [...fluentIndex.symbols, ...tablerIndex.symbols].filter((r) => !groups.has(r[2]));
check('every drawn symbol sits in a real category', !stray.length, stray.map((r) => r[0]).join(' '));
check('Popular opens on the drawn picks, then Material', S.listSymbols('popular')[0]?.id === 'fluent:grinning-face' && S.listSymbols('popular').some((e) => e.set === 'material'));
check('Everything lists the whole library', S.listSymbols('all').length === all.length);
check('an unknown category lists nothing', S.listSymbols('nope').length === 0);
check('a set filter keeps to its sets', S.listSymbols('animals', { sets: ['fluent'] }).every((e) => e.set === 'fluent'));
check('solidOnly keeps solid symbols only', S.listSymbols('all', { solidOnly: true }).every((e) => e.solid));

// ── search ──
const top = (q, n = 1) => S.searchSymbols(q).slice(0, n).map((e) => e.id);
check('"cat face" finds the cat face first', top('cat face')[0] === 'fluent:cat-face', top('cat face', 3).join());
check('"heart" leads with a symbol called Heart', S.searchSymbols('heart')[0]?.label === 'Heart', top('heart', 3).join());
check('a search word reaches across sets', ['fluent:dog-face', 'material:pets'].every((id) => S.searchSymbols('dog').some((e) => e.id === id)));
check('every word has to match', S.searchSymbols('cat zzzz').length === 0);

// ── shapes ──
const heart = await S.symbolShapes('tabler:heart', 20);
const hb = bbox(heart);
check('a Tabler symbol comes as closed shapes', wellFormed(heart) && heart.length === 1);
check('…its longest side the size asked, centred', Math.abs(Math.max(hb.maxX - hb.minX, hb.maxY - hb.minY) - 20) < 1e-6 && Math.abs(hb.minX + hb.maxX) < 1e-6 && Math.abs(hb.minY + hb.maxY) < 1e-6);
const face = await S.symbolShapes('fluent-grinning-face');
check('an older id gives the same symbol', wellFormed(face));
check('a Fluent face is a ring with its eyes and mouth as islands', face.length === 4 && face.some((isl) => isl.length === 2));
check('the drawing path is made from the same shapes', (await S.symbolPath('tabler:heart')).startsWith('M'));
let unknown = '';
await S.symbolShapes('nope').catch((e) => { unknown = e.message; });
check('an unknown id rejects', /Unknown symbol/.test(unknown));

// ── the stored data ──
for (const [file, index] of [['fluent-emoji-high-contrast', fluentIndex], ['tabler-icons-filled', tablerIndex]]) {
  const outlines = JSON.parse(readFileSync(`${pkg}/data/${file}.outlines.json`, 'utf8')).outlines;
  const bad = index.symbols.filter(([name]) => !outlines[name] || S.encodeOutline(S.decodeOutline(outlines[name])) !== outlines[name]);
  check(`${file}: every outline decodes and encodes back to itself`, !bad.length, bad.map((r) => r[0]).join(' '));
  const wrong = index.symbols.filter(([name, , , , solid]) => !!solid !== S.isSolidShape(S.decodeOutline(outlines[name])));
  check(`${file}: the stored solid flags are what the rule measures`, !wrong.length, wrong.map((r) => r[0]).join(' '));
  check(`${file}: pinned to a commit, under MIT`, /^[0-9a-f]{40}$/.test(index.source.commit) && index.licence === 'MIT');
}

// ── Material: the font, the duplicate contours and the solid list ──
const opentype = createRequire(`${pkg}/../fonts/package.json`)('opentype.js');
const ttf = readFileSync(`${pkg}/../fonts/src/fonts/icon-fallback.ttf`);
check('the solid list was measured on this icon font', createHash('sha256').update(ttf).digest('hex') === S.MATERIAL_FONT_SHA256, 'run pnpm --filter @vostok/symbols fetch-symbols --material');
const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
const favorite = S.glyphShapes(font, '\u{e87d}');
check('the heart glyph is one island despite its coincident contours', favorite.length === 1 && favorite[0].length === 1);
check('…so it counts as solid', S.isSolidShape(favorite));
check('a face with eyes and mouth is not solid', !S.isSolidShape(S.glyphShapes(font, S.symbolById('material:mood').char)));
const measured = S.searchSymbols('', { sets: ['material'] }).filter((e) => S.isSolidShape(S.glyphShapes(font, e.char))).map((e) => e.name);
const stored = new Set(S.MATERIAL_SOLID);
check('the stored Material solid list is what the rule measures', measured.length === stored.size && measured.every((n) => stored.has(n)), `${measured.length} measured, ${stored.size} stored`);
check('…and far more than the 17 the raw contours let through', stored.size > 100, String(stored.size));

// ── old codes ──
const fa = S.FONT_AWESOME_TWINS;
check('52 Font Awesome codes, each once', fa.length === 52 && new Set(fa.map((r) => r[0])).size === 52);
const faLost = fa.filter(([, , id]) => !S.symbolById(id));
check('every Font Awesome code has its symbol', !faLost.length, faLost.map((r) => r[1]).join(' '));
check('a Font Awesome character finds its twin', S.fontAwesomeTwin('\uf6d5') === 'fluent:dragon' && S.fontAwesomeTwin('a') === undefined);
const lucide = Object.entries(S.LUCIDE_TWINS);
const lucideLost = lucide.filter(([, id]) => id && !S.symbolById(id));
check('the Lucide shortlist (86 names) is covered', lucide.length === 86, String(lucide.length));
check('every Lucide twin exists', !lucideLost.length, lucideLost.map((r) => r[0]).join(' '));
check('a Lucide name with no twin says so', S.lucideTwin('bold') === undefined && S.lucideTwin('arrow-up') === 'tabler:arrow-big-up');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
