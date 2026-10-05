// The form's decisions, with no DOM in them.
//
// Three rules live here, and each was a bug that looked fine in every automated check the app
// had: the font cards previewing "2026" because a hidden field came first in the list; two rail
// categories of one form resolving to the same icon, so the cake topper's "Size & stakes" and
// "Legs" were the same button twice; and a four-option segmented control truncating every label
// to "Hangin…" in a 240 px panel. None of them throws, none of them fails a type check, and all
// three are decided by a few lines of arithmetic — so the arithmetic is here on its own, where a
// node test can hold it to the rule.

import type { Values } from './templates/types';

export interface SampleField {
  kind: string;
  key: string;
  /** Saved and loaded but never rendered. A value nobody can see must not name the design. */
  hidden?: boolean;
  visibleWhen?: (values: Values) => boolean;
  /** On a `font` field: the key of the text field the cards should be lettered with. */
  previewFrom?: string;
  /** On a `font` field: the sample itself, for a picker whose words are not in a text field. */
  previewText?: string | ((values: Values) => string);
}

/** Anything with a letter in it. A year is not a name. */
const LETTER = /\p{L}/u;
/**
 * …and neither is a web address. A QR template's first text field is what the code OPENS, so
 * the cards lettered 241 faces with "https://vostoklabs.git…" instead of the words on the tag
 * (2026-09-21). `previewFrom` is the fix a template declares; this is the fix for the
 * template that forgets, and it is the same shape of rule as "a year is not a name": a URL is
 * not a word, and nobody chooses a typeface by how a URL looks in it.
 */
const URLISH = /^[a-z][a-z0-9+.-]*:|^www\.|\w\.\w{2,}\//i;

const withoutSymbols = (text: string, isSymbolChar: (c: string) => boolean) =>
  Array.from(text).filter((c) => !isSymbolChar(c)).join('');

/**
 * What the font cards set: the customer's own word, in the customer's own field.
 *
 * A `font` field may STATE its sample with `previewText` — the month a calendar is about to
 * print, which is chosen from a select and so is in no text field at all — or NAME the field to
 * sample with `previewFrom`: the tag's title rather than the link inside its code. Otherwise the
 * text fields are walked in DECLARATION order, so the field the design is about comes first,
 * skipping anything the customer cannot see: a `place-cards` build previewed every face in
 * "Table 4", the default of a field hidden behind `visibleWhen`, and the family templates
 * previewed "2026" because the year field was declared before the names. A value with no letter
 * in it is not a sample, nor is a URL, nor a bare inline symbol — whose private-use character
 * would render as a blank box in 150 faces at once.
 *
 * `forKey` asks for ONE picker's sample: a form with two font fields sets two different things,
 * and the date keychain's calendar picker must letter the faces with the month while the charm's
 * still letters them with the initials (2026-09-22). Given, only that field's own
 * `previewText`/`previewFrom` is read before the walk. Omitted — which is what `form.ts` does
 * today, one sample for the whole form — the first font field that declares either one answers,
 * as it has since `previewFrom` was added.
 */
export function fontSampleOf(
  fields: SampleField[],
  values: Values,
  isSymbolChar: (c: string) => boolean = () => false,
  forKey?: string,
): string {
  /** What passes for a sample at all: a word, and not an address. Applied to a STATED sample as
   *  well as to a field's, so one that is empty, digits only or a URL falls through to the walk
   *  rather than lettering 241 cards with it. */
  const usable = (text: string) => (LETTER.test(text) && !URLISH.test(text) ? text : '');

  const sampleOf = (f: SampleField): string => {
    if (f.kind !== 'text' && f.kind !== 'lines') return '';
    if (f.hidden) return '';
    if (f.visibleWhen && !f.visibleWhen(values)) return '';
    const raw = String(values[f.key] ?? '');
    // A list is represented by its first real line — the first guest, the first family name.
    const value = f.kind === 'lines'
      ? raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? ''
      : raw;
    return usable(withoutSymbols(value, isSymbolChar).trim());
  };

  // The template's own answer first — this picker's when one was asked for, else the first font
  // field that has anything to say. A `previewFrom` that names a field with nothing usable in it
  // falls through to the walk rather than leaving the cards blank.
  const asked = forKey ? fields.filter((f) => f.key === forKey) : fields;
  const stated = asked.find((f) => f.kind === 'font' && f.previewText !== undefined)?.previewText;
  if (stated !== undefined) {
    const text = usable((typeof stated === 'function' ? stated(values) : stated).trim());
    if (text) return text;
  }
  const named = asked.find((f) => f.kind === 'font' && f.previewFrom)?.previewFrom;
  if (named) {
    const field = fields.find((f) => f.key === named);
    if (field) {
      const text = sampleOf(field);
      if (text) return text;
    }
  }
  for (const f of fields) {
    const text = sampleOf(f);
    if (text) return text;
  }
  return 'Name';
}

/**
 * Segmented control, or dropdown?
 *
 * The left panel is ~240 px wide, so four options leave about 55 px a label: "Double rule"
 * became "Double…" and "Hanging" became "Hangin…", which is worse than a dropdown at saying
 * what the choice is. Three tests rather than one, because each failure mode is different — too
 * many options, too much text across them, or one long label starving the rest. A template that
 * wants to stay segmented shortens its labels; the rule decides.
 */
export function useSegmented(labels: string[]): boolean {
  if (labels.length > 4) return false;
  if (labels.some((l) => l.length > 9)) return false;
  return labels.reduce((n, l) => n + l.length, 0) <= 24;
}

/* ----------------------------------------------------------- where a field lives -- */

/** What `fieldHome` reads off a field. */
export interface HomedField {
  kind: string;
  panel?: 'left' | 'right';
  section?: string;
}

/**
 * Which panel a field is drawn in, and which category it sits under.
 *
 * The right panel is for what the customer TYPES, so the font is never there whatever a template
 * says: it is a setting — the biggest one — and a category on the rail. Every other field sits
 * in the section it names. There is no catch-all: a "More options" drawer used to collect
 * anything marked advanced, which filed tile spacing away from the tiles and boldness away from
 * the lettering, two folds from what each one moves.
 *
 * One exception, and it is a move rather than a drawer: a type knob a template declared in the
 * FONT's own section goes to Lettering, because the Font tab is the font list and nothing else
 * (the list fills the tab, and a slider under it is pushed off the bottom).
 */
export function fieldHome(f: HomedField, fontSection: string): { right: boolean; title: string } {
  const right = f.panel === 'right' && f.kind !== 'font';
  if (f.kind === 'font') return { right: false, title: f.section ?? 'Font' };
  if (!right && f.section === fontSection) return { right: false, title: 'Lettering' };
  return { right, title: f.section ?? (right ? '' : 'Settings') };
}

/**
 * The rail's order: categories in the order their first field is declared — except that the
 * rail opens on the knob that makes this design this design (Size on a keychain, Code on a QR
 * stand), so a Font category that came first goes second.
 */
export function railOrder(titles: string[], fontTitle: string): string[] {
  const out = [...titles];
  if (out.length > 1 && out[0] === fontTitle) out.splice(1, 0, out.splice(0, 1)[0]!);
  return out;
}

/* ------------------------------------------------------- G33 · "Surprise me" -- */

/** Pattern Monster's "Inspire me" look in the studio's pattern vocabulary — the rule lives in
 *  the engine (`surpriseValues` in @vostok/patterns, pure, no DOM) so every consumer
 *  agrees; re-exported here so the node harness holds the form to it as before. */
export { surpriseValues } from '@vostok/patterns';

/** The rail icons this app draws, by name. `form.ts` maps these onto the kit's `ICONS`. */
export type RailIconKey = 'plus' | 'list' | 'layers' | 'grid' | 'qr' | 'maximize' | 'stand' | 'text' | 'link' | 'sliders';

/**
 * A category's icon from what its name says it sets.
 *
 * Order is the whole of it, because titles match more than one pattern: "Size & stakes" is a
 * SIZE category that happens to mention stakes, so size/shape is tested before stand/legs.
 */
export function railIconKey(title: string): RailIconKey {
  const t = title.toLowerCase();
  if (/\b(guest|guests|names|list|lines|family|members)\b/.test(t)) return 'list';
  if (/\b(layer|layers)\b/.test(t)) return 'layers';
  if (/\b(tile|tiles|grid|crossword|puzzle|tray)\b/.test(t)) return 'grid';
  if (/\b(qr|code|contents|link)\b/.test(t)) return 'qr';
  if (/\b(size|shape|outline|border|frame|edge|silhouette|card|plate|body|piece|pieces|split|band)\b/.test(t)) return 'maximize';
  if (/\b(stand|base|post|posts|pegs|stake|stakes|legs|foot|feet)\b/.test(t)) return 'stand';
  if (/\b(font|fonts|lettering|letters|text|type|word|words|name|title)\b/.test(t)) return 'text';
  if (/\b(ring|keyring|hole|holes|hang|hanging|hanger|loop|ribbon|join|joining|bridge|bridges|weld|mount|mounting|wall|screws|keyholes)\b/.test(t)) return 'link';
  return 'sliders';
}

/** Where a displaced category goes, in order of how little the icon claims. `sliders` is the
 *  generic one and therefore first; the rest are only reached by a form with several categories
 *  the patterns above cannot name (family-crossword and date-keychain each have two). */
const FALLBACKS: RailIconKey[] = ['sliders', 'grid', 'layers', 'list', 'maximize', 'stand', 'text', 'link', 'qr', 'plus'];

/**
 * One icon per category, across a whole form.
 *
 * Two buttons wearing the same picture is a rail that cannot be read at a glance, which is the
 * only job the rail has. The first category to claim an icon keeps it; a later claimant takes
 * the generic sliders, or — when that is taken too — the first icon nothing else in this form
 * is using. The one that gives way is always the one further down the rail.
 */
export function railIconKeys(titles: string[]): RailIconKey[] {
  const used = new Set<RailIconKey>();
  return titles.map((title) => {
    const key = railIconKey(title);
    if (!used.has(key)) { used.add(key); return key; }
    const spare = FALLBACKS.find((k) => !used.has(k)) ?? key;
    used.add(spare);
    return spare;
  });
}
