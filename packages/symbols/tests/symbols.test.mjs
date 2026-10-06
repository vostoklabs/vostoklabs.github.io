// @vostok/symbols: the library, its search, its shapes, its stored data and its old-code tables,
// and every symbol of every set held to the islands contract (src/contract.ts).
//
// Run: node packages/symbols/tests/symbols.test.mjs   (esbuild bundles the TS source). Part of
// `pnpm test`, so CI runs it. Areas are measured in manifold, through the link pnpm makes for
// @vostok/laser, which depends on it; the Material font is read from disk.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const pkg = `${here}..`;
const tmp = `${pkg}/node_modules/.cache`;
mkdirSync(tmp, { recursive: true });
const entry = `${tmp}/test-entry.ts`;
writeFileSync(entry, [
  `export * from '${pkg}/src/index.ts';`,
  `export { encodeOutline, decodeOutline, signedArea } from '${pkg}/src/outline.ts';`,
  `export { contractProblems } from '${pkg}/src/contract.ts';`,
  `export { MATERIAL_SOLID, MATERIAL_FONT_SHA256 } from '${pkg}/src/material-solid.ts';`,
  `export { pathCommandsToPolygons } from '@vostok/fonts/textLayout';`,
  `export { POPULAR as FONTS_POPULAR } from '@vostok/fonts';`,
  `export { csOf } from '${pkg}/../manifold/src/index.ts';`,
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

// ── what a project file holds is untrusted JSON ──
const said = (fn) => (v) => {
  try {
    return fn(v);
  } catch (e) {
    return `throws ${e.constructor.name}`;
  }
};
const notStrings = [42, null, undefined, true, {}, ['favorite'], { id: 'material:favorite' }];
const resolved = notStrings.map(said(S.resolveSymbolId));
check('resolveSymbolId(42) and every other value that is not a string name nothing', resolved.every((r) => r === undefined), resolved.filter((r) => r !== undefined).join(', '));
const byNotString = notStrings.map(said(S.symbolById));
check('…and symbolById finds nothing for them', byNotString.every((r) => r === undefined), byNotString.filter((r) => r !== undefined).join(', '));
let notId = '';
await S.symbolShapes(42).catch((e) => { notId = e.message; });
check('…and their shapes reject as an unknown symbol', /^Unknown symbol/.test(notId), notId);
const inherited = ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty'];
for (const name of inherited) {
  const twin = said(S.lucideTwin)(name);
  check(`lucideTwin('${name}') is no twin, not what every object inherits`, twin === undefined, twin === undefined ? '' : typeof twin);
}
check('…and those names are no symbol ids either', inherited.every((n) => S.resolveSymbolId(n) === undefined));
const oldCodes = notStrings.flatMap((v) => [said(S.lucideTwin)(v), said(S.fontAwesomeTwin)(v)]);
check('a Lucide name or Font Awesome code that is not a string has no twin', oldCodes.every((r) => r === undefined), oldCodes.filter((r) => r !== undefined).join(', '));

// ── categories ──
const empty = S.SYMBOL_CATEGORIES.filter((c) => !S.listSymbols(c.id).length);
check('every category lists something', !empty.length, empty.map((c) => c.id).join(' '));
const groups = new Set(S.SYMBOL_CATEGORIES.map((c) => c.id));
const stray = [...fluentIndex.symbols, ...tablerIndex.symbols].filter((r) => !groups.has(r[2]));
check('every drawn symbol sits in a real category', !stray.length, stray.map((r) => r[0]).join(' '));
check('Popular opens on the drawn picks, then Material', S.listSymbols('popular')[0]?.id === 'fluent:grinning-face' && S.listSymbols('popular').some((e) => e.set === 'material'));
const popular = S.listSymbols('popular').map((e) => e.id);
const twice = ['material:favorite', 'material:star', 'material:bedtime', 'material:crown', 'material:pets', 'material:local_florist', 'material:mood', 'material:sentiment_very_satisfied'];
check('Popular shows a heart, a star, a moon, a crown, a paw once, not again from Material', !twice.some((id) => popular.includes(id)) && popular.includes('tabler:heart'), twice.filter((id) => popular.includes(id)).join(' '));
check('…and search still finds the Material ones', S.searchSymbols('favorite').some((e) => e.id === 'material:favorite') && S.searchSymbols('crown').some((e) => e.id === 'material:crown'));
check('Popular lists each symbol once', new Set(popular).size === popular.length);
// A picker limited to some sets keeps a Material glyph whose drawn twin is not on its page: a
// heart or a star leaves Popular only for a drawn heart or star the picker shows.
{
  const ids = (filter) => S.listSymbols('popular', filter).map((e) => e.id);
  const materialOnly = ids({ sets: ['material'] });
  const oldPage = S.FONTS_POPULAR.map((i) => `material:${i.id}`);
  check('Popular with only Material is the Material popular page, every glyph in its order', materialOnly.join() === oldPage.join(), `${materialOnly.length} of ${oldPage.length}`);
  check('…so it opens on the heart and the star', materialOnly[0] === 'material:favorite' && materialOnly[1] === 'material:star');
  const tablerToo = ids({ sets: ['tabler', 'material'] });
  check(
    'with Tabler and Material, a Material glyph steps aside only for a Tabler twin on the page',
    tablerToo.includes('tabler:heart') && !tablerToo.includes('material:favorite') && tablerToo.includes('material:mood') && tablerToo.includes('material:sentiment_very_satisfied'),
  );
  check('…and still lists each symbol once', new Set(tablerToo).size === tablerToo.length);
  const fluentOnly = ids({ sets: ['fluent'] });
  check('with only Fluent, Popular is the Fluent picks', fluentOnly.length > 0 && fluentOnly.every((id) => id.startsWith('fluent:')));
}
check('Everything lists the whole library', S.listSymbols('all').length === all.length);
check('Yin yang comes unframed: Fluent\'s framed Yin yang and Peace symbol are not in the library', !S.symbolById('fluent:yin-yang') && !S.symbolById('fluent:peace-symbol') && !!S.symbolById('tabler:yin-yang'));
check('Lucide is never a set of the library', all.every((e) => ['fluent', 'tabler', 'material'].includes(e.set)) && !S.symbolById('lucide:heart'));
check('an unknown category lists nothing', S.listSymbols('nope').length === 0);
check('a set filter keeps to its sets', S.listSymbols('animals', { sets: ['fluent'] }).every((e) => e.set === 'fluent'));
check('solidOnly keeps solid symbols only', S.listSymbols('all', { solidOnly: true }).every((e) => e.solid));

// ── search ──
const top = (q, n = 1) => S.searchSymbols(q).slice(0, n).map((e) => e.id);
check('"cat face" finds the cat face first', top('cat face')[0] === 'fluent:cat-face', top('cat face', 3).join());
check('"heart" leads with a symbol called Heart', S.searchSymbols('heart')[0]?.label === 'Heart', top('heart', 3).join());
check('a search word reaches across sets', ['fluent:dog-face', 'material:pets'].every((id) => S.searchSymbols('dog').some((e) => e.id === id)));
check('every word has to match', S.searchSymbols('cat zzzz').length === 0);
const cat = S.searchSymbols('cat').map((e) => e.id);
const cats = ['fluent:cat-face', 'fluent:grinning-cat', 'fluent:black-cat'];
check('"cat" leads with the cats', cats.every((id) => cat.slice(0, cats.length).includes(id)), cat.slice(0, 4).join());
check('…then the paws, before Category and every other word that only starts with cat',
  ['tabler:paw', 'material:pets'].every((id) => cat.includes(id) && cat.indexOf(id) < cat.indexOf('material:category')), cat.slice(0, 8).join());
const midWord = S.searchSymbols('cat').filter((e) => /location|notification|medication|scatter/i.test(e.label)).map((e) => e.id);
check('a word only inside another matches nothing: "cat" finds no Location, Notifications, Medication', !midWord.length, midWord.join(' '));
const car = S.searchSymbols('car');
const hasCar = car.filter((e) => [e.label, e.name, e.terms].some((t) => t.toLowerCase().split(/[^a-z0-9]+/).includes('car')));
const lastCar = Math.max(...hasCar.map((e) => car.indexOf(e)));
check('"car" leads with Car, and Caret comes after every symbol that has the word car',
  car[0]?.id === 'material:directions_car' && ['tabler:caret-up', 'tabler:caret-down'].every((id) => car.findIndex((e) => e.id === id) > lastCar),
  `Car at ${car.findIndex((e) => e.id === 'material:directions_car') + 1}, Caret up at ${car.findIndex((e) => e.id === 'tabler:caret-up') + 1}, last whole "car" at ${lastCar + 1}`);
check('a word that only starts one still matches: "categ" finds Category first', top('categ')[0] === 'material:category', top('categ', 3).join());

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

// ── a chunk that fails to load is fetched again ──
// A second build of the library whose Tabler chunk fails the first time it is read and loads
// the second, as a chunk does over a connection that drops once.
const flakyOut = `${tmp}/symbols-flaky-${process.pid}.mjs`;
await build({
  entryPoints: [`${pkg}/src/index.ts`], outfile: flakyOut, bundle: true, platform: 'node', format: 'esm', logLevel: 'error',
  define: { 'import.meta.glob': 'globalThis.__viteGlob' },
  banner: { js: 'globalThis.__viteGlob = () => ({});' },
  plugins: [{
    name: 'flaky-chunk',
    setup(b) {
      b.onResolve({ filter: /tabler-icons-filled\.outlines\.json$/ }, (args) =>
        args.namespace === 'flaky' ? undefined : { path: join(args.resolveDir, args.path), namespace: 'flaky' });
      b.onLoad({ filter: /.*/, namespace: 'flaky' }, (args) => ({
        resolveDir: dirname(args.path),
        loader: 'js',
        contents: `import real from ${JSON.stringify(args.path)};
export default { get outlines() {
  globalThis.__chunkReads = (globalThis.__chunkReads ?? 0) + 1;
  if (globalThis.__chunkReads === 1) throw new Error('the chunk failed to load');
  return real.outlines;
} };`,
      }));
    },
  }],
});
const F = await import(pathToFileURL(flakyOut).href);
let failed = '';
await F.symbolShapes('tabler:heart').catch((e) => { failed = e.message; });
check('a symbol whose chunk fails to load rejects', failed === 'the chunk failed to load', failed);
const next = await F.symbolShapes('tabler:star').catch((e) => e.message);
check('…and the next symbol of that set loads the chunk again', Array.isArray(next) && wellFormed(next) && globalThis.__chunkReads === 2, `${typeof next === 'string' ? next : 'shapes'}, ${globalThis.__chunkReads} loads`);
const retried = await F.symbolShapes('tabler:heart').catch((e) => e.message);
check('…as does the symbol that failed, asked again', Array.isArray(retried) && wellFormed(retried), typeof retried === 'string' ? retried : '');
await F.symbolShapes('tabler:moon');
check('…and a chunk that loaded is kept', globalThis.__chunkReads === 2, `${globalThis.__chunkReads} loads`);

// ── the stored data ──
const material = all.filter((e) => e.set === 'material');
const materialFile = JSON.parse(readFileSync(`${pkg}/data/material-symbols-rounded.outlines.json`, 'utf8'));
for (const [file, names] of [
  ['fluent-emoji-high-contrast', fluentIndex.symbols.map((r) => r[0])],
  ['tabler-icons-filled', tablerIndex.symbols.map((r) => r[0])],
  ['material-symbols-rounded', material.map((e) => e.name)],
]) {
  const outlines = JSON.parse(readFileSync(`${pkg}/data/${file}.outlines.json`, 'utf8')).outlines;
  const bad = names.filter((name) => !outlines[name] || S.encodeOutline(S.decodeOutline(outlines[name])) !== outlines[name]);
  check(`${file}: every outline decodes and encodes back to itself`, !bad.length, bad.join(' '));
}
for (const [file, index] of [['fluent-emoji-high-contrast', fluentIndex], ['tabler-icons-filled', tablerIndex]]) {
  const outlines = JSON.parse(readFileSync(`${pkg}/data/${file}.outlines.json`, 'utf8')).outlines;
  const wrong = index.symbols.filter(([name, , , , solid]) => !!solid !== S.isSolidShape(S.decodeOutline(outlines[name])));
  check(`${file}: the stored solid flags are what the rule measures`, !wrong.length, wrong.map((r) => r[0]).join(' '));
  check(`${file}: pinned to a commit, under MIT`, /^[0-9a-f]{40}$/.test(index.source.commit) && index.licence === 'MIT');
}

// ── Material: outlines made from the icon font, and the solid list ──
const opentype = createRequire(`${pkg}/../fonts/package.json`)('opentype.js');
const ttf = readFileSync(`${pkg}/../fonts/src/fonts/icon-fallback.ttf`);
const ttfSha = createHash('sha256').update(ttf).digest('hex');
check('the Material outlines and solid list were made from this icon font', materialFile.font.sha256 === ttfSha && S.MATERIAL_FONT_SHA256 === ttfSha, 'run pnpm --filter @vostok/symbols fetch-symbols --material');
check('…under Apache-2.0, as the font is', materialFile.licence === 'Apache-2.0');
const font = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
const favorite = await S.symbolShapes('material:favorite');
check('the heart glyph is one island, its doubled contours gone', favorite.length === 1 && favorite[0].length === 1);
check('…so it counts as solid', S.isSolidShape(favorite));
check('a face with eyes and mouth is not solid', !S.isSolidShape(await S.symbolShapes('material:mood')));
const measured = [];
for (const e of material) if (S.isSolidShape(await S.symbolShapes(e.id))) measured.push(e.name);
const stored = new Set(S.MATERIAL_SOLID);
check('the stored Material solid list is what the rule measures', measured.length === stored.size && measured.every((n) => stored.has(n)), `${measured.length} measured, ${stored.size} stored`);
check('…and far more than the 17 the raw contours let through', stored.size > 100, String(stored.size));
const hidden = ['cloud', 'chess_knight', 'badge', 'bug_report', 'build', 'church'];
check('glyphs whose overlapping contours read as extra pieces count as solid', hidden.every((n) => stored.has(n)), hidden.filter((n) => !stored.has(n)).join(' '));

// ── every symbol of every set keeps the islands contract ──
const manifold = await (await import(pathToFileURL(`${pkg}/../laser/node_modules/manifold-3d/manifold.js`).href)).default();
manifold.setup();
/** What manifold makes of rings, freed once measured. */
const measure = (rings, rule, fn) => {
  const cs = S.csOf(manifold, rings, rule);
  try {
    return fn(cs);
  } finally {
    cs.delete();
  }
};
/** The rings a tile draws: `symbolPath`'s data read back, Y up again. */
const tileRings = (d) => d.split('Z').filter(Boolean).map((r) => r.slice(1).split('L').map((p) => {
  const [x, y] = p.split(' ').map(Number);
  return [x, -y];
}));
/** A glyph as the font fills it (each curve in eight steps, as the text engine reads it), in the
 *  symbol frame of that fill. */
const fontRings = (char) => {
  const contours = S.pathCommandsToPolygons(font.charToGlyph(char).getPath(0, 0, 100).commands).filter((c) => c.length >= 3);
  const { min, max } = measure(contours, 'NonZero', (cs) => cs.bounds());
  const k = 1 / Math.max(max[0] - min[0], max[1] - min[1]);
  return contours.map((r) => r.map(([x, y]) => [(x - (min[0] + max[0]) / 2) * k, (y - (min[1] + max[1]) / 2) * k]));
};
const broken = {};
const offFrame = [];
const notTile = [];
const notFont = [];
for (const e of all) {
  const shapes = await S.symbolShapes(e.id);
  for (const p of S.contractProblems(shapes)) (broken[p.rule] ??= []).push(`${e.id} (${p.at})`);
  // On the stored grid: the longest side the whole box, centred to half a unit of it.
  const b = bbox(shapes);
  const [x0, x1, y0, y1] = [b.minX, b.maxX, b.minY, b.maxY].map((v) => Math.round(v * 1000));
  if (Math.max(x1 - x0, y1 - y0) !== 1000 || Math.abs(x0 + x1) > 1 || Math.abs(y0 + y1) > 1) offFrame.push(e.id);
  // What a consumer taking the islands one by one fills, against what the tile fills (non-zero).
  const tile = tileRings(await S.symbolPath(e.id));
  const islands = shapes.flat().reduce((sum, r) => sum + S.signedArea(r), 0);
  const filled = measure(tile, 'NonZero', (cs) => cs.area());
  if (Math.abs(islands - filled) > 1e-6) notTile.push(`${e.id} ${islands.toFixed(4)} vs ${filled.toFixed(4)}`);
  if (e.set !== 'material') continue;
  // The stored outline against the glyph as the font fills it: no further from it, measured along
  // its outline, than a thousandth of the symbol's size.
  const perimeter = shapes.flat().reduce((sum, r) => sum + r.reduce((s, p, i) => s + Math.hypot(r[(i + 1) % r.length][0] - p[0], r[(i + 1) % r.length][1] - p[1]), 0), 0);
  const apart = measure(fontRings(e.char), 'NonZero', (f) => measure(tile, 'NonZero', (t) => {
    const a = f.subtract(t);
    const c = t.subtract(f);
    const area = a.area() + c.area();
    a.delete();
    c.delete();
    return area;
  }));
  if (apart > 0.001 * perimeter) notFont.push(`${e.id} ${(apart / perimeter).toExponential(1)}`);
}
const listed = (list) => `${list.length}: ${list.slice(0, 6).join(', ')}`;
check(`every symbol (${all.length}) sits on the stored grid`, !broken.grid, listed(broken.grid ?? []));
check('…winds its outers anticlockwise and its holes clockwise', !broken.winding, listed(broken.winding ?? []));
check('…has no ring that encloses nothing', !broken['zero-area'], listed(broken['zero-area'] ?? []));
check('…has no ring that crosses, runs along or touches itself', !broken['self-intersection'], listed(broken['self-intersection'] ?? []));
check('…has no two rings that cross or run along each other', !broken.crossing, listed(broken.crossing ?? []));
check('…keeps each hole inside its own outer, and holes apart', !broken.hole, listed(broken.hole ?? []));
check('…keeps its islands apart', !broken.overlap, listed(broken.overlap ?? []));
check('…is centred, its longest side 1', !offFrame.length, listed(offFrame));
check('…fills, island by island, exactly what its tile fills', !notTile.length, listed(notTile));
check('every Material symbol is the glyph as the font fills it, to a thousandth', !notFont.length, listed(notFont));

// ── old codes ──
const fa = S.FONT_AWESOME_TWINS;
check('52 Font Awesome codes, each once', fa.length === 52 && new Set(fa.map((r) => r[0])).size === 52);
const faLost = fa.filter(([, , id]) => id && !S.symbolById(id));
check('every Font Awesome twin exists', !faLost.length, faLost.map((r) => r[1]).join(' '));
check('a Font Awesome character finds its twin', S.fontAwesomeTwin('\uf6d5') === 'fluent:dragon' && S.fontAwesomeTwin('a') === undefined);
const noTwin = fa.filter(([, , id]) => !id).map((r) => r[1]);
check('Peace alone has no twin, and its character finds none', noTwin.join() === 'Peace' && S.fontAwesomeTwin('\uf67c') === undefined, noTwin.join(' '));
check('Fluent\'s victory hand is not in the library', !S.symbolById('fluent:victory-hand') && !S.searchSymbols('victory').some((e) => e.set === 'fluent'));
const lucide = Object.entries(S.LUCIDE_TWINS);
const lucideLost = lucide.filter(([, id]) => id && !S.symbolById(id));
check('the Lucide shortlist (86 names) is covered', lucide.length === 86, String(lucide.length));
check('every Lucide twin exists', !lucideLost.length, lucideLost.map((r) => r[0]).join(' '));
check('a Lucide name with no twin says so', S.lucideTwin('bold') === undefined && S.lucideTwin('arrow-up') === 'tabler:arrow-big-up');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
