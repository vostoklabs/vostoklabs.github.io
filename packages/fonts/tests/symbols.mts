/*
  pnpm --filter @vostok/fonts test

  What this guards: a symbol group is a list of STRING IDS, and nothing in the type
  system knows whether `'chess_knight'` is a real glyph. A typo, or an icon the next
  curation pass drops, does not crash — `groupIcons` simply never matches it, and the
  tile quietly disappears from the picker. That is the same class of failure as a CSS
  class nothing defines: renders fine, renders wrong, nothing notices.

  So: every hand-written id must resolve, every group must be non-empty, and the
  registry must agree with the font that ships beside it.
*/

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { ICONS, ICON_CATEGORIES, iconById, iconByChar, searchIcons } from '../src/icons';
import { SYMBOL_GROUPS, POPULAR_IDS, POPULAR, QUICK_PICKS, searchGroup } from '../src/symbolGroups';

// cwd, not `import.meta.url`: esbuild bundles this test into node_modules/.cache,
// so the module's own path points at the cache rather than at the package.
const PKG = process.cwd();
let checks = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  checks++;
  if (!cond) { failed++; console.error(`  FAIL  ${msg}`); }
}

console.log('the registry');
{
  ok(ICONS.length > 1000, `only ${ICONS.length} icons in the registry`);
  ok(ICON_CATEGORIES.length > 0, 'no categories');
  ok(new Set(ICONS.map((i) => i.id)).size === ICONS.length, 'duplicate icon ids');
  ok(new Set(ICONS.map((i) => i.char)).size === ICONS.length, 'two icons share a character');
  for (const i of ICONS.slice(0, 50)) {
    ok(!!i.label.trim(), `${i.id}: empty label`);
    ok([...i.char].length === 1, `${i.id}: char is not a single code point`);
  }
  // Every category an icon claims must be one the picker can offer, or the tile is
  // reachable only by search.
  const known = new Set(ICON_CATEGORIES.map((c) => c.id));
  const orphan = [...new Set(ICONS.flatMap((i) => i.cats))].filter((c) => !known.has(c));
  ok(orphan.length === 0, `categories on icons but not in ICON_CATEGORIES: ${orphan.join(', ')}`);
  console.log(`  ok  ${ICONS.length} icons, ${ICON_CATEGORIES.length} categories, ids and chars unique`);
}

console.log('\nthe font actually carries them');
{
  const require_ = createRequire(pathToFileURL(join(PKG, 'package.json')));
  const opentype = require_('opentype.js');
  const ttf = join(PKG, 'src', 'fonts', 'icon-fallback.ttf');
  ok(existsSync(ttf), 'icon-fallback.ttf is missing');
  if (existsSync(ttf)) {
    const font = opentype.loadSync(ttf);
    const cmap = font.tables.cmap.glyphIndexMap;
    // A glyph the font cannot draw exports as an EMPTY solid rather than an error,
    // which is the worst failure mode this package has.
    const absent = ICONS.filter((i) => cmap[i.char.codePointAt(0)!] === undefined);
    ok(absent.length === 0, `${absent.length} icons are not in the font, e.g. ${absent.slice(0, 5).map((i) => i.id).join(', ')}`);
    const size = readFileSync(ttf).length;
    ok(size < 700_000, `icon-fallback.ttf is ${(size / 1024).toFixed(0)} KB — it is inlined in offline builds, keep it under 700 KB`);
    console.log(`  ok  ${ICONS.length} glyphs present, font ${(size / 1024).toFixed(0)} KB`);
  }
}

console.log('\nthe hand-written lists resolve');
{
  const missing = POPULAR_IDS.filter((id) => !iconById(id));
  ok(missing.length === 0, `POPULAR_IDS the font does not carry: ${missing.join(', ')}`);
  ok(POPULAR.length === POPULAR_IDS.length, `POPULAR dropped ${POPULAR_IDS.length - POPULAR.length} entries`);
  ok(QUICK_PICKS.length === 12, `QUICK_PICKS is ${QUICK_PICKS.length}, not 12`);
  ok(new Set(POPULAR_IDS).size === POPULAR_IDS.length, 'POPULAR_IDS repeats an id');

  for (const g of SYMBOL_GROUPS) {
    const bad = (g.ids ?? []).filter((id) => !iconById(id));
    ok(bad.length === 0, `group "${g.id}" names ids the font does not carry: ${bad.join(', ')}`);
    const n = searchGroup('', g.id).length;
    // An empty group is a tab that opens on nothing — the exact thing the group
    // tree exists to prevent.
    ok(n > 0, `group "${g.id}" is empty`);
  }
  console.log(`  ok  ${POPULAR_IDS.length} popular ids, ${SYMBOL_GROUPS.length} groups, none empty`);
}

console.log('\nsearch and lookup');
{
  ok(searchIcons('star').length > 0, 'searching "star" found nothing');
  ok(searchIcons('zzzzzzz').length === 0, 'searching nonsense found something');
  const first = ICONS[0]!;
  ok(iconById(first.id) === first, 'iconById does not round-trip');
  ok(iconByChar(first.char) === first, 'iconByChar does not round-trip');
  // Free text searches the whole library rather than staying inside the group —
  // the alternative reads as the search being broken.
  ok(searchGroup('star', 'tech').length === searchIcons('star').length, 'a group narrowed a free-text search');
  console.log('  ok  ranked search, id/char lookup, free text ignores the group');
}

console.log(`\n${checks - failed}/${checks} checks passed`);
if (failed) process.exit(1);
