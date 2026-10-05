import { ICONS, POPULAR, SYMBOL_GROUPS, iconById, searchGroup } from '@vostok/fonts';
import fluentData from '../data/fluent-emoji-high-contrast.json';
import tablerData from '../data/tabler-icons-filled.json';
import { MATERIAL_SOLID } from './material-solid';

/*
  The symbol library: every symbol a customer can put in a design, from three sets, under one id
  scheme, one set of categories and one search.

    material:<name>   Material Symbols Rounded, filled (Apache-2.0). The font and its names stay
                      in @vostok/fonts, where the text engine reads them; a Material symbol can
                      also be typed into text as its character (`char`).
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
 *  crown, a paw, a flower, a smiling face). Popular shows each once; search still finds them. */
const POPULAR_SHOWN_ALREADY = new Set([
  'material:favorite', 'material:star', 'material:bedtime', 'material:crown', 'material:pets',
  'material:local_florist', 'material:mood', 'material:sentiment_very_satisfied',
]);

/** The categories a picker lists, in order: @vostok/fonts' symbol groups. */
export const SYMBOL_CATEGORIES: readonly { id: string; label: string }[] = SYMBOL_GROUPS.map((g) => ({
  id: g.id,
  label: g.id === 'all' ? 'Everything' : g.label,
}));

/** The id a stored value names, or undefined: `set:name` as it is, and the older forms projects
 *  hold, a bare Material name (`favorite`) and the kit catalog's `fluent-…` / `tabler-…`. */
export function resolveSymbolId(value: string): string | undefined {
  const { byId } = library();
  if (byId.has(value)) return value;
  const old = value.match(/^(fluent|tabler)-(.+)$/);
  if (old && byId.has(`${old[1]}:${old[2]}`)) return `${old[1]}:${old[2]}`;
  if (iconById(value)) return `material:${value}`;
  return undefined;
}

/** One symbol by its id (or an older form of one, see `resolveSymbolId`). */
export function symbolById(id: string): SymbolEntry | undefined {
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
    list = [
      ...POPULAR_DRAWN.map((id) => lib.byId.get(id)).filter((e): e is SymbolEntry => !!e),
      ...material(POPULAR).filter((e) => !POPULAR_SHOWN_ALREADY.has(e.id)),
    ];
  } else if (category === 'all') {
    list = lib.all;
  } else if (SYMBOL_GROUPS.some((g) => g.id === category)) {
    list = [...lib.drawn.filter((e) => e.group === category), ...material(searchGroup('', category))];
  } else {
    list = [];
  }
  return list.filter(keep(filter));
}

/**
 * Every symbol matching a query, best first, across every set. Each word has to match the
 * label, the name or the search words; an exact label ranks first, then a label that starts with
 * the word, a label that holds it, the name, and last a search word, so "car" leads with Car and
 * not with something that only lists car among its synonyms. Ties keep the sets' order.
 */
export function searchSymbols(query: string, filter?: SymbolFilter): SymbolEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pool = library().all.filter(keep(filter));
  if (!words.length) return pool;
  const whole = words.join(' ');
  const hits: { e: SymbolEntry; score: number; at: number }[] = [];
  pool.forEach((e, at) => {
    const label = e.label.toLowerCase();
    const name = e.name.replace(/[_-]/g, ' ');
    // A search word matches the start of one: "cat" finds "cats", never "location".
    const terms = ` ${e.terms}`;
    let score = label === whole ? 200 : label.startsWith(whole) ? 100 : 0;
    for (const w of words) {
      const s = label === w ? 100 : label.startsWith(w) ? 50 : label.includes(w) ? 25 : name.includes(w) ? 10 : terms.includes(` ${w}`) ? 4 : 0;
      if (!s) return;
      score += s;
    }
    hits.push({ e, score, at });
  });
  return hits.sort((a, b) => b.score - a.score || a.at - b.at).map((h) => h.e);
}
