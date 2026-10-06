import { ICONS, POPULAR, SYMBOL_GROUPS, iconById, searchGroup } from '@vostok/fonts';
import fluentData from '../data/fluent-emoji-high-contrast.json';
import tablerData from '../data/tabler-icons-filled.json';
import { MATERIAL_SOLID } from './material-solid';

/*
  The symbol library: every symbol a customer can put in a design, from three sets, under one id
  scheme, one set of categories and one search.

    material:<name>   Material Symbols Rounded, filled (Apache-2.0). The font and its names stay
                      in @vostok/fonts, where the text engine reads them, and the outlines made
                      from it are stored here; a Material symbol can also be typed into text as
                      its character (`char`).
    tabler:<name>     Tabler Icons, filled set (MIT), stored here as outlines.
    fluent:<name>     Microsoft Fluent Emoji, High Contrast style (MIT), stored here as outlines.

  The categories are @vostok/fonts' symbol groups (Popular, Smileys, Animals & bugs...), so a
  picker reads the same whichever app it is in. A Tabler or Fluent symbol sits in one group, picked
  by hand when it was fetched; a Material one in whatever its group already gathers.

  Ids are safe to keep in a project file. The ids projects already hold resolve too: a bare
  Material name (`favorite`) and the kit catalog's `fluent-…` / `tabler-…`.
*/

export type SymbolSetId = 'material' | 'tabler' | 'fluent';

export interface SymbolSet {
  id: SymbolSetId;
  label: string;
  licence: 'Apache-2.0' | 'MIT';
  copyright: string;
}

/** The three sets, in the order a list shows them: the drawn ones first. */
export const SYMBOL_SETS: readonly SymbolSet[] = [
  { id: 'fluent', label: 'Fluent Emoji', licence: 'MIT', copyright: 'Microsoft Corporation' },
  { id: 'tabler', label: 'Tabler Icons', licence: 'MIT', copyright: 'Paweł Kuna' },
  { id: 'material', label: 'Material Symbols', licence: 'Apache-2.0', copyright: 'Google LLC' },
];

export interface SymbolEntry {
  /** `set:name`, e.g. `fluent:cat-face`. Stable; safe to persist. */
  id: string;
  set: SymbolSetId;
  /** The set's own name for it: `cat-face`, `heart`, `favorite`. */
  name: string;
  /** What to call it: "Cat face", "Heart", "Favorite". */
  label: string;
  /** Extra words a search matches, beyond the label and the name. */
  terms: string;
  /** Prints as one solid blob: the only kind a silhouette product (a charm on a hook) can make. */
  solid: boolean;
  /** Material only: the icon font's character, for a symbol typed into text. */
  char?: string;
}

/** What a list or a search is narrowed to. */
export interface SymbolFilter {
  /** Only these sets. Default all three. */
  sets?: readonly SymbolSetId[];
  /** Only symbols that print as one solid blob. */
  solidOnly?: boolean;
}

interface Drawn extends SymbolEntry {
  group: string;
}

type Row = [name: string, label: string, group: string, terms: string, solid: number];
const drawn = (set: SymbolSetId, rows: unknown): Drawn[] =>
  (rows as Row[]).map(([name, label, group, terms, solid]) => ({ id: `${set}:${name}`, set, name, label, group, terms, solid: !!solid }));

let entries: { all: SymbolEntry[]; drawn: Drawn[]; byId: Map<string, SymbolEntry> } | null = null;
/** Built on first use, so an import costs nothing until something asks. */
function library() {
  if (!entries) {
    const solid = new Set(MATERIAL_SOLID);
    const made = [...drawn('fluent', fluentData.symbols), ...drawn('tabler', tablerData.symbols)];
    const material: SymbolEntry[] = ICONS.map((i) => ({
      id: `material:${i.id}`,
      set: 'material',
      name: i.id,
      label: i.label,
      terms: i.terms,
      solid: solid.has(i.id),
      char: i.char,
    }));
    const all = [...made, ...material];
    entries = { all, drawn: made, byId: new Map(all.map((e) => [e.id, e])) };
  }
  return entries;
}

/** The drawn sets' picks for the Popular page, ahead of Material's own popular list. */
const POPULAR_DRAWN = [
  'fluent:grinning-face', 'fluent:smiling-face-with-heart-eyes', 'fluent:cat-face', 'fluent:dog-face',
  'tabler:heart', 'tabler:star', 'tabler:paw', 'fluent:black-cat', 'tabler:butterfly', 'tabler:flower',
  'tabler:moon', 'tabler:crown', 'fluent:unicorn', 'fluent:rainbow',
];

/** Material's popular glyphs that a drawn pick above already shows (a heart, a star, a moon, a
 *  crown, a paw, a flower, a smiling face), each with the drawn pick that shows it. Popular shows
 *  each once: a Material glyph steps aside only for a drawn twin that is on the page, so a picker
 *  limited to Material still opens on its heart and its star. Search still finds them all. */
const POPULAR_DRAWN_TWIN = new Map([
  ['material:favorite', 'tabler:heart'],
  ['material:star', 'tabler:star'],
  ['material:bedtime', 'tabler:moon'],
  ['material:crown', 'tabler:crown'],
  ['material:pets', 'tabler:paw'],
  ['material:local_florist', 'tabler:flower'],
  ['material:mood', 'fluent:grinning-face'],
  ['material:sentiment_very_satisfied', 'fluent:smiling-face-with-heart-eyes'],
]);

/** The categories a picker lists, in order: @vostok/fonts' symbol groups. */
export const SYMBOL_CATEGORIES: readonly { id: string; label: string }[] = SYMBOL_GROUPS.map((g) => ({
  id: g.id,
  label: g.id === 'all' ? 'Everything' : g.label,
}));

/** The id a stored value names, or undefined: `set:name` as it is, and the older forms projects
 *  hold, a bare Material name (`favorite`) and the kit catalog's `fluent-…` / `tabler-…`. A
 *  project file is untrusted JSON, so a value that is not a string names nothing. */
export function resolveSymbolId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const { byId } = library();
  if (byId.has(value)) return value;
  const old = value.match(/^(fluent|tabler)-(.+)$/);
  if (old && byId.has(`${old[1]}:${old[2]}`)) return `${old[1]}:${old[2]}`;
  if (iconById(value)) return `material:${value}`;
  return undefined;
}

/** One symbol by its id (or an older form of one, see `resolveSymbolId`). */
export function symbolById(id: unknown): SymbolEntry | undefined {
  const real = resolveSymbolId(id);
  return real ? library().byId.get(real) : undefined;
}

const keep = (filter: SymbolFilter | undefined) => (e: SymbolEntry) =>
  (!filter?.sets || filter.sets.includes(e.set)) && (!filter?.solidOnly || e.solid);

/** Everything in one category, drawn sets first. An unknown category lists nothing. */
export function listSymbols(category: string, filter?: SymbolFilter): SymbolEntry[] {
  const lib = library();
  const material = (list: { id: string }[]) => list.map((i) => lib.byId.get(`material:${i.id}`)).filter((e): e is SymbolEntry => !!e);
  let list: SymbolEntry[];
  if (category === 'popular') {
    // The filter goes on the drawn picks first: a Material glyph gives way only to a drawn twin
    // that is still on the page after it.
    const drawn = POPULAR_DRAWN.map((id) => lib.byId.get(id)).filter((e): e is SymbolEntry => !!e).filter(keep(filter));
    const shown = new Set(drawn.map((e) => e.id));
    list = [...drawn, ...material(POPULAR).filter((e) => !shown.has(POPULAR_DRAWN_TWIN.get(e.id) ?? ''))];
  } else if (category === 'all') {
    list = lib.all;
  } else if (SYMBOL_GROUPS.some((g) => g.id === category)) {
    list = [...lib.drawn.filter((e) => e.group === category), ...material(searchGroup('', category))];
  } else {
    list = [];
  }
  return list.filter(keep(filter));
}

/** Lower-case words: each run of letters or digits. */
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Each symbol's label, name and search words as words, made on the first search. */
let searchWords: Map<SymbolEntry, { label: string[]; name: string[]; terms: string[] }> | null = null;

/**
 * Every symbol matching a query, best first, across every set. Each word of the query has to
 * match a word of the label, the name or the search words, whole or at its start: "cat" finds
 * "cats" and "Category", never "Location". A whole word ranks above the start of one wherever it
 * is, so "cat" leads with the cats and paws and not with Category, and "car" with Car, Car rental
 * and Electric car and not with Caret. Within each, the label ranks above the name and the name
 * above the search words, and a label's first word above its others; a label that is the query,
 * or starts with it, ranks first of all. Ties keep the sets' order.
 */
export function searchSymbols(query: string, filter?: SymbolFilter): SymbolEntry[] {
  const words = wordsOf(query);
  const lib = library();
  const pool = lib.all.filter(keep(filter));
  if (!words.length) return pool;
  const whole = words.join(' ');
  searchWords ??= new Map(lib.all.map((e) => [e, { label: wordsOf(e.label), name: wordsOf(e.name), terms: wordsOf(e.terms) }]));
  const hits: { e: SymbolEntry; score: number; at: number }[] = [];
  pool.forEach((e, at) => {
    const { label, name, terms } = searchWords!.get(e)!;
    const text = label.join(' ');
    let score = text === whole ? 300 : text.startsWith(`${whole} `) ? 100 : 0;
    for (const w of words) {
      const starts = (list: string[]) => list.some((x) => x.startsWith(w));
      const s =
        label[0] === w ? 50 : label.includes(w) ? 40 : name.includes(w) ? 30 : terms.includes(w) ? 20
        : label[0]?.startsWith(w) ? 15 : starts(label) ? 12 : starts(name) ? 8 : starts(terms) ? 4 : 0;
      if (!s) return;
      score += s;
    }
    hits.push({ e, score, at });
  });
  return hits.sort((a, b) => b.score - a.score || a.at - b.at).map((h) => h.e);
}
