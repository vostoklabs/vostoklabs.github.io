#!/usr/bin/env node
/*
  pnpm --filter @vostok/fonts fetch-icons

  Writes BOTH halves of the symbol library, so they cannot drift apart:

    src/fonts/icon-fallback.ttf   the glyphs
    src/icons.ts                  their names, categories and search terms

  icon-fallback.ttf is **Material Symbols Rounded at FILL=1**, subset to the curated
  set below. Apache-2.0 — see src/fonts/CREDITS.md and src/fonts/LICENSE-APACHE-2.0.txt.

  ── why this is not Font Awesome any more ────────────────────────────────────────
  It was, until 2026-09-18. Font Awesome Free splits its licence: the FONT is SIL
  OFL 1.1, but the ICONS are CC BY 4.0, and CC BY attaches to every copy and
  derivative. Our generators trace those outlines into the file the USER exports, so
  every cut file a customer made carried an attribution obligation they were never
  told about. Apache-2.0 has no per-derivative
  attribution clause, so the exported file is clean; the repo and the dist carry the
  licence text, which is all Apache asks for.

  ── why FILL=1, and why Rounded ──────────────────────────────────────────────────
  Material Symbols is a variable font whose FILL axis runs 0 (line art) to 1 (solid
  silhouette). Only FILL=1 is usable here: these outlines get engraved, cut and
  EXTRUDED into 3D parts, and a line-art glyph extrudes into fragile spaghetti.
  Rounded over Sharp for the same reason — a rounded corner survives a blade and a
  0.4 mm nozzle; a sharp one chips.

  ── why a subset ─────────────────────────────────────────────────────────────────
  The full family is 6111 icons / 1.8 MB. icon-fallback.ttf is base64-inlined in the
  offline single-file build, so size here is not free. 1500 curated glyphs come to ~520 KB,
  close to what Font Awesome's 1392 cost (410 KB).

  The curation does NOT rank by Google's `popularity`: that number reflects UI usage,
  and it buries `crown`, `skull` and `chess_knight` below #1500 while promoting
  `sync_alt`. Anything matching PICTORIAL is kept outright; the rest of the budget
  goes to the most popular of what is left.
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
const subsetFont = (await import('subset-font')).default;

const OFFLINE = process.argv.includes('--offline');

// How many glyphs the font may carry. See the size note above before raising it.
const BUDGET = 1500;

const META_URL = 'https://fonts.google.com/metadata/icons?incomplete=1&key=material_symbols';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:FILL@1';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

// ---------------------------------------------------------------------------
// 1. Chrome we never want in a symbol picker
// ---------------------------------------------------------------------------
// Battery levels, signal bars, format toolbars, numbered variants, page chevrons.
// Nobody engraves `keyboard_arrow_down` on a box, and 1700 slots are worth more
// than that.
const CHROME = [
  /^(keyboard|arrow|expand|chevron|unfold|swap_vert|swap_horiz|first_page|last_page)/,
  /^(signal|network|wifi_[0-9]|battery|sim_card|cell_|nest_|sensor|adb$|android)/,
  /^(format_|border_|text_|align_|vertical_align|line_(weight|style)|table_|toolbar)/,
  /^(filter_[0-9]|looks_|exposure_|counter_|font_download|numbers$)/,
  /^(brightness_[0-9]|zoom_|fullscreen|aspect_ratio|fit_screen|crop_)/,
  /_[0-9]+$|^[0-9]/,
  /(_off|_outline|_outlined|_alt|_2$|_3$|_rounded|_sharp)$/,
  /^(checkbox|radio_button|toggle_|indeterminate|check_box)/,
  /^(more_|menu$|menu_open|apps$|dashboard|widgets|view_|list$|grid_)/,
  /^(vpn|https|http|dns|lan|router|hub$|cast|airplay|screen_)/,
  /(_fill$|_badge$|_progress$|_indicator$|_placeholder$)/,
  /^(rotate_|flip$|flip_|transform|straighten|tune$|settings_)/,
  /^(play_|pause|stop_|skip_|fast_|replay_|repeat|shuffle|volume_)/,
];

// ---------------------------------------------------------------------------
// 2. What this product is actually for
// ---------------------------------------------------------------------------
const PICTORIAL = [
  /^sports_/, /^chess/, /^emoji_/,
  /^local_(pizza|cafe|bar|dining|florist|fire|drink|grocery|mall|movies|library|hotel|parking|police|hospital|pharmacy|laundry|shipping|taxi|activity|play|see|offer|atm)/,
  /^(pets|cruelty_free|egg|eggs|nutrition|bakery|icecream|cake|ramen|lunch|dinner|brunch|breakfast|kebab|tapas|set_meal|rice_bowl|soup|coffee|liquor|wine)/,
  /^(park|forest|nature|eco|energy_savings_leaf|potted_plant|yard|grass|compost|water_drop|waves|tsunami|volcano|landscape|terrain|hiking|kayaking|surfing|sailing|scuba|downhill|snowboarding|skateboarding|paragliding)/,
  /^(sunny|clear_day|cloud$|cloudy|rainy|snowing|ac_unit|thunderstorm|foggy|bedtime|nightlight|star$|stars|mode_night|routine|sunny_snowing)/,
  /^(celebration|festival|redeem|card_giftcard|cake_add|theater|attractions|casino|nightlife|toys|smart_toy|rocket|flight|directions_|train|tram|subway|two_wheeler|pedal_bike|electric_|anchor)/,
  /^(favorite|heart|star_|diamond|crown|skull|skeleton|whatshot|bolt$|flare|auto_awesome|all_inclusive|shapes|circle$|square$|hexagon|pentagon|rectangle|change_history|token)/,
  /^(face|mood|sentiment_|person|group|people|family|child|elderly|pregnant|accessible|waving_hand|handshake|folded_hands|thumb_up|thumb_down|volunteer|diversity)/,
  /^(music_note|piano|mic$|headphones|graphic_eq|queue_music|library_music|album|radio$|speaker$|palette|brush|draw$|colorize|photo_camera|camera$|movie$|theaters)/,
  /^(school|menu_book|auto_stories|science|biotech|calculate|functions|psychology|history_edu|backpack|edit$|create$|design_services|architecture|engineering|construction|build$|handyman|agriculture)/,
  /^(pet_supplies|bug_report|coronavirus|vaccines|medical|healing|monitor_heart|cardiology|dentistry|orthopedics|neurology|pulmonology)/,
];

// ---------------------------------------------------------------------------
// 3. Categories
// ---------------------------------------------------------------------------
// Material Symbols carries BOTH its old and its new category names — `action` and
// `Actions` and `UI actions` are three labels for one idea, and an icon is often in
// several. Merged here so the picker's group tree has one entry per idea.
const CAT_MERGE = {
  action: 'actions', actions: 'actions', 'ui actions': 'actions',
  av: 'av', 'audio&video': 'av',
  image: 'images', images: 'images',
  maps: 'maps', places: 'maps', navigation: 'maps',
  social: 'social',
  device: 'hardware', hardware: 'hardware',
  home: 'home', household: 'home',
  text: 'text', editor: 'text', content: 'text', file: 'text',
  communicate: 'communication', communication: 'communication',
  transit: 'travel', travel: 'travel',
  alert: 'alert', notification: 'alert',
  business: 'business', activities: 'activities', privacy: 'privacy',
  search: 'search', toggle: 'toggle', android: 'android',
};
const CAT_LABEL = {
  actions: 'Actions', activities: 'Activities', alert: 'Alerts', android: 'Android',
  av: 'Audio & video', business: 'Business', communication: 'Communication',
  hardware: 'Devices', home: 'Home', images: 'Images', maps: 'Maps & places',
  privacy: 'Privacy', search: 'Search', social: 'Social', text: 'Text & files',
  toggle: 'Toggles', travel: 'Travel & transit',
};
const normCat = (c) => CAT_MERGE[String(c).toLowerCase()] ?? String(c).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// A name reads better without its filing prefix: `local_pizza` is "Pizza" on a box.
// The ID keeps the full Material Symbols name, so nothing that is persisted moves.
const LABEL_STRIP = [/^local_/, /^emoji_/, /^sports_/, /^directions_/, /^social_/];

// Google names an icon for the PRODUCT SURFACE it was drawn for, not for the thing it
// depicts: the snowflake is `ac_unit` because it marks air conditioning, the apple is
// `nutrition`, the flame is `local_fire_department`, the rabbit is `cruelty_free`. Those
// names are right inside a Google UI and meaningless in a picker that says "put a symbol
// on your box" — the first screen read "Ac Unit, Nutrition, Fire Department".
//
// So the ones that face the user get the name of the thing. The label is also what
// `searchIcons` ranks highest, so this fixes FINDING them as well as reading them:
// nobody types "ac unit" looking for a snowflake.
const LABEL_OVERRIDE = {
  favorite: 'Heart', mood: 'Smiley', sentiment_very_satisfied: 'Grin', sentiment_satisfied: 'Smile',
  sentiment_sad: 'Sad face', sentiment_calm: 'Calm face', add_reaction: 'Add a face',
  pets: 'Paw', pet_supplies: 'Dog bowl', cruelty_free: 'Rabbit', chess_knight: 'Horse',
  bug_report: 'Bug', flutter_dash: 'Bird', savings: 'Piggy bank',
  ac_unit: 'Snowflake', nutrition: 'Apple', local_fire_department: 'Flame', whatshot: 'Fire',
  bedtime: 'Moon', nightlight: 'Night light', mode_night: 'Crescent moon', sunny: 'Sun',
  clear_day: 'Bright sun', water_drop: 'Droplet', eco: 'Leaf', energy_savings_leaf: 'Green leaf',
  park: 'Tree', forest: 'Trees', potted_plant: 'Plant', florist: 'Flower', yard: 'Garden',
  emoji_events: 'Trophy', casino: 'Dice', esports: 'Controller', all_inclusive: 'Infinity',
  auto_awesome: 'Sparkles', bolt: 'Lightning', flare: 'Starburst', diamond: 'Gem',
  menu_book: 'Book', auto_stories: 'Open book', school: 'Graduation cap', edit: 'Pencil',
  science: 'Flask', psychology: 'Brain', self_improvement: 'Meditation', biotech: 'Microscope',
  redeem: 'Gift', card_giftcard: 'Gift card', celebration: 'Party popper', festival: 'Bunting',
  workspace_premium: 'Medal', emergency: 'Star of life', volunteer_activism: 'Caring hands',
  waving_hand: 'Waving hand', folded_hands: 'Folded hands',
  icecream: 'Ice cream', cafe: 'Coffee', bar: 'Cocktail', liquor: 'Bottle', wine_bar: 'Wine',
  bakery_dining: 'Croissant', lunch_dining: 'Burger', ramen_dining: 'Noodles', set_meal: 'Bento',
  rice_bowl: 'Rice bowl', dinner_dining: 'Pasta', fastfood: 'Fast food', restaurant: 'Cutlery',
  car: 'Car', flight: 'Plane', sailing: 'Sailboat', rocket: 'Rocket',
  skull: 'Skull', crown: 'Crown', change_history: 'Triangle',
  music_note: 'Music note', graphic_eq: 'Equaliser', notifications: 'Bell', location_on: 'Map pin',
  chat_bubble: 'Speech bubble', shield: 'Shield', key: 'Key', lock: 'Padlock',
  home: 'House', search: 'Magnifier', check: 'Tick', lightbulb: 'Light bulb', terrain: 'Mountains',
};

function labelFor(name) {
  // Overrides are keyed on the name AFTER the prefix strip as well as before it, so
  // `sports_esports` and `esports` are one entry rather than two that can disagree.
  let s = name;
  for (const re of LABEL_STRIP) s = s.replace(re, '');
  if (!s) s = name;
  const override = LABEL_OVERRIDE[name] ?? LABEL_OVERRIDE[s];
  if (override) return override;
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// 4. Fetch
// ---------------------------------------------------------------------------
const CACHE = join(HERE, '.icons-metadata.json');

async function metadata() {
  if (OFFLINE) {
    if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
    console.error(`--offline and no cache at ${CACHE}. Run once without it first.`);
    process.exit(1);
  }
  const text = await (await fetch(META_URL, { headers: UA })).text();
  const json = JSON.parse(text.replace(/^\)\]\}'/, ''));
  writeFileSync(CACHE, JSON.stringify(json));
  return json;
}

const meta = await metadata();
const all = meta.icons ?? [];
if (!all.length) { console.error('metadata carried no icons'); process.exit(1); }

// Google's metadata lists 1872 icons TWICE — once as a legacy "Material Icons"
// entry and once as a Material Symbol, same name, same codepoint. Left in, they
// become duplicate ids and two rows fighting over one character.
const seen = new Set();
const unique = all.filter((i) => !seen.has(i.name) && seen.add(i.name));

const pool = unique.filter((i) => !CHROME.some((re) => re.test(i.name)));
const pictorial = pool.filter((i) => PICTORIAL.some((re) => re.test(i.name)));
const rest = pool
  .filter((i) => !PICTORIAL.some((re) => re.test(i.name)))
  .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
const keep = [...pictorial, ...rest.slice(0, Math.max(0, BUDGET - pictorial.length))];
console.log(`metadata ${all.length} -> ${unique.length} unique -> ${pool.length} after chrome -> ${keep.length} kept`);

// ---------------------------------------------------------------------------
// 5. The font
// ---------------------------------------------------------------------------
// Subset from the FILL=1 instance Google's CSS API serves, not from the variable
// font: opentype.js draws a variable font's DEFAULT instance, which is FILL=0, and
// the whole point here is the filled one. Asking the API for `FILL@1` gets an
// already-instanced file, so what we subset is what the app will draw.
if (!OFFLINE) {
  const css = await (await fetch(FONT_CSS, { headers: UA })).text();
  const url = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) { console.error('no font url in the CSS response'); process.exit(1); }
  const src = Buffer.from(await (await fetch(url)).arrayBuffer());
  const chars = keep.map((i) => String.fromCodePoint(i.codepoint)).join('');
  const out = await subsetFont(src, chars, { targetFormat: 'truetype' });
  writeFileSync(TTF, out);
  console.log(`icon-fallback.ttf  ${(out.length / 1024).toFixed(0)} KB  (${keep.length} glyphs)`);
}

// ---------------------------------------------------------------------------
// 6. The rows — cross-checked against the font that is actually on disk
// ---------------------------------------------------------------------------
// A picker that inserts a glyph the font cannot draw produces a BLANK plate, and a
// blank plate exports as an empty solid rather than as an error. So the font is the
// authority on what exists, exactly as it was under Font Awesome.
const opentype = require('opentype.js');
if (!existsSync(TTF)) { console.error(`Missing ${TTF}`); process.exit(1); }
const font = opentype.loadSync(TTF);
const cmap = font.tables.cmap.glyphIndexMap;

const rows = [];
const absent = [];
for (const icon of keep) {
  const cp = icon.codepoint;
  if (!Number.isFinite(cp) || cmap[cp] === undefined) { absent.push(icon.name); continue; }
  const label = labelFor(icon.name);
  const cats = Array.from(new Set((icon.categories ?? []).map(normCat)));
  // Search terms minus anything already in the label or the id — the picker matches
  // those anyway, and duplicated words are bundle bytes for nothing.
  const known = new Set(`${label} ${icon.name}`.toLowerCase().split(/[\s_-]+/).filter(Boolean));
  const terms = Array.from(
    new Set(
      (icon.tags ?? [])
        .map((t) => String(t).toLowerCase().trim())
        .filter(Boolean)
        .flatMap((t) => t.split(/\s+/))
        .filter((t) => t.length > 1 && !known.has(t)),
    ),
  ).slice(0, 14).join(' ');
  rows.push({ id: icon.name, label, cp, cats, terms });
}
rows.sort((a, b) => a.id.localeCompare(b.id));

const usedCats = new Map();
for (const r of rows) for (const c of r.cats) usedCats.set(c, (usedCats.get(c) ?? 0) + 1);
const catRows = Array.from(usedCats.keys())
  .sort((a, b) => (CAT_LABEL[a] ?? a).localeCompare(CAT_LABEL[b] ?? b))
  .map((id) => ({ id, label: CAT_LABEL[id] ?? id, count: usedCats.get(id) }));
const uncategorised = rows.filter((r) => r.cats.length === 0).length;

// ---------------------------------------------------------------------------
// 7. Emit
// ---------------------------------------------------------------------------
const esc = (s) => JSON.stringify(s);
const hex = (cp) => `\\u{${cp.toString(16)}}`;
const body = rows
  .map((r) => `  [${esc(r.id)},${esc(r.label)},"${hex(r.cp)}",${esc(r.cats.join(' '))},${esc(r.terms)}],`)
  .join('\n');

writeFileSync(
  OUT,
  `// AUTO-GENERATED by scripts/fetch-icons.mjs — do not edit by hand.
// Material Symbols Rounded, FILL=1: ${rows.length} glyphs in ${catRows.length} categories
// (${uncategorised} carry no category). Apache-2.0 — see fonts/CREDITS.md.
//
// Apache-2.0 and not CC BY, deliberately: these outlines are traced into the file
// the USER exports, and CC BY would put an attribution obligation on their cut file.

export interface IconChoice {
  /** Material Symbols name, e.g. "local_pizza". Stable; safe to persist in a project file. */
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
      // not with something that merely lists it as a synonym.
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

console.log(`icons.ts           ${rows.length} rows, ${catRows.length} categories, ${uncategorised} uncategorised`);
if (absent.length) {
  // The metadata runs ahead of the font Google's CSS API serves. Not an error —
  // the font is the authority — but a group that names one of these gets a hole
  // in it, so print them rather than swallowing it.
  console.log(`  dropped, not in the served font: ${absent.join(', ')}`);
}

// The font's row in the asset registry (assets.json), described by scripts/assets.mjs.
const { writeAssets } = await import(new URL('../../../scripts/assets.mjs', import.meta.url).href);
writeAssets();
console.log('assets.json        updated');
