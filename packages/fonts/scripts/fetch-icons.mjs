#!/usr/bin/env node
/*
  pnpm --filter @vostok/fonts fetch-icons

  Emits src/icons.ts: every solid glyph that is actually present in
  src/fonts/icon-fallback.ttf, with its label, codepoint, categories and search
  terms.

  icon-fallback.ttf IS Font Awesome 6 Free Solid — all 1392 of its glyphs, not a
  subset. The generators were reaching into it through a hand-written array of
  sixty ``-style literals, which is why "insert a symbol" meant "insert one
  of the sixty someone thought of". The font never needed changing; only a way to
  find what was already in it.

  Source of the names/categories is @fortawesome/fontawesome-free (a devDependency
  here), NOT the network — this runs offline and is deterministic.

  Licence: the icons are CC BY 4.0, the font SIL OFL 1.1. Both permit bundling;
  both want attribution, which is in src/fonts/CREDITS.md.
*/

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const OUT = join(PKG, 'src', 'icons.ts');
const TTF = join(PKG, 'src', 'fonts', 'icon-fallback.ttf');

const require = createRequire(pathToFileURL(join(PKG, 'package.json')));

// ---------------------------------------------------------------------------
// 1. Which codepoints does the bundled font actually carry?
//
// Generating from the metadata alone would list icons the font does not have, and
// a picker that inserts a glyph the font cannot draw produces a blank plate — the
// worst failure mode here, because it exports as an empty solid rather than an error.
// ---------------------------------------------------------------------------
const opentype = require('opentype.js');
if (!existsSync(TTF)) {
  console.error(`Missing ${TTF} — nothing to generate from.`);
  process.exit(1);
}
const font = opentype.loadSync(TTF);
const cmap = font.tables.cmap.glyphIndexMap;

// ---------------------------------------------------------------------------
// 2. Font Awesome metadata
// ---------------------------------------------------------------------------
let faDir;
try {
  faDir = dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
} catch {
  console.error(
    'Could not resolve @fortawesome/fontawesome-free.\n' +
      'It is a devDependency of @vostok/fonts — run `pnpm install` first.',
  );
  process.exit(1);
}

const families = JSON.parse(readFileSync(join(faDir, 'metadata', 'icon-families.json'), 'utf8'));
const categories = parseCategoriesYml(readFileSync(join(faDir, 'metadata', 'categories.yml'), 'utf8'));
const faVersion = JSON.parse(readFileSync(join(faDir, 'package.json'), 'utf8')).version;

/** category id -> label, and icon id -> the categories it belongs to. */
const catLabel = new Map();
const catsOf = new Map();
for (const [id, entry] of Object.entries(categories)) {
  catLabel.set(id, entry.label);
  for (const icon of entry.icons) {
    if (!catsOf.has(icon)) catsOf.set(icon, []);
    catsOf.get(icon).push(id);
  }
}

// ---------------------------------------------------------------------------
// 3. Build the rows
// ---------------------------------------------------------------------------
const rows = [];
for (const [id, meta] of Object.entries(families)) {
  if (!meta?.svgs?.classic?.solid) continue; // free tier = solid only
  const cp = parseInt(meta.unicode, 16);
  if (!Number.isFinite(cp) || cmap[cp] === undefined) continue; // not in our font

  const cats = catsOf.get(id) ?? [];
  // Search terms minus anything already in the label or the id — the picker
  // matches those anyway, and 1392 rows of duplicated words is 40 KB of bundle
  // for nothing.
  const known = new Set(`${meta.label} ${id}`.toLowerCase().split(/[\s-]+/).filter(Boolean));
  const terms = Array.from(
    new Set(
      (meta.search?.terms ?? [])
        .map((t) => String(t).toLowerCase().trim())
        .filter(Boolean)
        .flatMap((t) => t.split(/\s+/))
        .filter((t) => t.length > 1 && !known.has(t)),
    ),
  ).join(' ');

  rows.push({ id, label: meta.label, cp, cats, terms });
}

rows.sort((a, b) => a.id.localeCompare(b.id));

// Categories that survived the font check, in the order the picker shows them.
// "Uncategorised" catches the dozen FA leaves out of categories.yml.
const usedCats = new Map();
for (const r of rows) for (const c of r.cats) usedCats.set(c, (usedCats.get(c) ?? 0) + 1);
const catRows = Array.from(usedCats.keys())
  .sort((a, b) => (catLabel.get(a) ?? a).localeCompare(catLabel.get(b) ?? b))
  .map((id) => ({ id, label: catLabel.get(id) ?? id, count: usedCats.get(id) }));

const uncategorised = rows.filter((r) => r.cats.length === 0).length;

// ---------------------------------------------------------------------------
// 4. Emit
// ---------------------------------------------------------------------------
const esc = (s) => JSON.stringify(s);
const hex = (cp) => `\\u{${cp.toString(16)}}`;

const body = rows
  .map((r) => `  [${esc(r.id)},${esc(r.label)},"${hex(r.cp)}",${esc(r.cats.join(' '))},${esc(r.terms)}],`)
  .join('\n');

writeFileSync(
  OUT,
  `// AUTO-GENERATED by scripts/fetch-icons.mjs — do not edit by hand.
// Font Awesome ${faVersion} Free, solid style: ${rows.length} glyphs in ${catRows.length} categories
// (${uncategorised} carry no category). Icons CC BY 4.0, font SIL OFL 1.1 — see fonts/CREDITS.md.

export interface IconChoice {
  /** Font Awesome slug, e.g. "face-smile". Stable; safe to persist in a project file. */
  id: string;
  label: string;
  /** The character to put in the text field. */
  char: string;
  /** Category ids this icon belongs to; may be empty. */
  cats: string[];
  /** Extra words to match on, beyond the label and the id. */
  terms: string;
}

export interface IconCategory {
  id: string;
  label: string;
  count: number;
}

export const ICON_CATEGORIES: IconCategory[] = ${JSON.stringify(catRows, null, 2)};

/** Tuple rows rather than objects: same data, roughly half the parsed bytes. */
type Row = [id: string, label: string, char: string, cats: string, terms: string];

const ROWS: Row[] = [
${body}
];

export const ICONS: IconChoice[] = ROWS.map(([id, label, char, cats, terms]) => ({
  id,
  label,
  char,
  cats: cats ? cats.split(' ') : [],
  terms,
}));

const BY_ID = new Map(ICONS.map((i) => [i.id, i]));
const BY_CHAR = new Map(ICONS.map((i) => [i.char, i]));

export const iconById = (id: string): IconChoice | undefined => BY_ID.get(id);
export const iconByChar = (char: string): IconChoice | undefined => BY_CHAR.get(char);

/** Free-text search over label, id and terms. Empty query returns everything in
 *  \`cat\` (or everything, when no category is given). */
export function searchIcons(query: string, cat?: string): IconChoice[] {
  const pool = cat ? ICONS.filter((i) => i.cats.includes(cat)) : ICONS;
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  const words = q.split(/\\s+/);
  const scored: { icon: IconChoice; score: number }[] = [];
  for (const icon of pool) {
    const label = icon.label.toLowerCase();
    let score = 0;
    // Every word has to hit something, or the icon is out.
    for (const w of words) {
      // Rank an exact label first, then a label prefix, then anywhere in the
      // label, then the slug, then the synonyms — so "car" leads with Car and
      // not with "Battery Three Quarters (car)".
      const hit =
        label === w ? 100
        : label.startsWith(w) ? 50
        : label.includes(w) ? 25
        : icon.id.includes(w) ? 10
        : icon.terms.includes(w) ? 4
        : 0;
      if (hit === 0) { score = 0; break; }
      score += hit;
    }
    if (score > 0) scored.push({ icon, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.icon.label.localeCompare(b.icon.label)).map((s) => s.icon);
}
`,
);

console.log(
  `Wrote ${OUT}\n  ${rows.length} solid glyphs · ${catRows.length} categories · ${uncategorised} uncategorised\n  from Font Awesome ${faVersion}`,
);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** categories.yml is a flat two-level map; a YAML dependency for this would be
 *  one more thing to keep current than the ten lines it saves. */
function parseCategoriesYml(text) {
  const out = {};
  let current = null;
  let inIcons = false;
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^([A-Za-z0-9-]+):\s*$/))) {
      current = m[1];
      out[current] = { label: current, icons: [] };
      inIcons = false;
    } else if (current && line.match(/^\s{2}icons:\s*$/)) {
      inIcons = true;
    } else if (current && (m = line.match(/^\s{2}label:\s*(.+?)\s*$/))) {
      out[current].label = m[1].replace(/^["']|["']$/g, '');
      inIcons = false;
    } else if (current && inIcons && (m = line.match(/^\s{4}-\s*(.+?)\s*$/))) {
      out[current].icons.push(m[1]);
    }
  }
  return out;
}
