// What a template is: a name and a picture in the gallery, a form in the editor, and one
// function from the form's values to what the engine builds. Everything a design needs to say
// is said here, so adding a design is one file in this folder and one line in index.ts.
//
// The form has two homes, the way every shipped generator does: the RIGHT panel holds what
// you type (text, the font, a symbol) and the download; the LEFT panel holds the settings, in
// named sections. A field says which with `panel` and `section`.
import type { BlankCategory } from '@vostok/laser';
import type { BuildInput } from '../engine/types';

export type Values = Record<string, string | number | boolean>;

interface FieldBase {
  key: string;
  label: string;
  /** The "?" tooltip beside the label: ONE short sentence (≤ 12 words) saying what the number
   *  decides, only where the label cannot carry it. The only copy a control gets — there is no
   *  `note` (a paragraph under a control) any more; Ian, 2026-09-21. */
  help?: string;
  /** `right` for the inputs (text, font, symbol); everything else is a setting on the left. */
  panel?: 'left' | 'right';
  /** The section heading the field sits under. Sections appear in first-use order. */
  section?: string;
  /** Under "More options", closed by default, at the end of the left panel. */
  advanced?: boolean;
  /** Saved and loaded, never rendered — a value the preview writes (the hole's position). */
  hidden?: boolean;
  /** Hide the control unless this says so — "Loop reach" only for a loop tab. */
  visibleWhen?: (values: Values) => boolean;
}

export type Field =
  | (FieldBase & { kind: 'text'; value: string; placeholder?: string; maxLength?: number; /** Symbol insertion is enabled by default; false disables it. */ symbols?: boolean })
  /** The font cards. `recommended` names the faces that actually suit THIS design — scripts
   *  that weld for a cake topper, a chunky sans for a puzzle — as `@vostok/fonts` ids, in the
   *  order they should read. Given, the cards split into "Recommended for this design" and
   *  "More fonts"; absent, nothing changes. A template's default font must be in its list.
   *
   *  `previewFrom` is the KEY of the text field the cards should be lettered with. Absent, the
   *  cards sample the first text field the customer can see — which on a QR template is the
   *  payload, so every face read "https://vostoklabs.git…" instead of the tag's own words
   *  (Ian, 2026-09-21). Set it wherever the first text field is not the one set in this font.
   *
   *  `previewText` states the sample OUTRIGHT, for the picker whose words are not in a text field
   *  at all: the date keychain's calendar prints a month chosen from a select, and its cards were
   *  lettered "E" — the charm's initial (Ian, 2026-09-22). A function when it follows the
   *  settings, the way `exportNote` does. It wins over `previewFrom`; if what it returns is not a
   *  sample (empty, digits only, a URL) the walk decides as usual. */
  | (FieldBase & { kind: 'font'; value: string; recommended?: string[]; previewFrom?: string; previewText?: string | ((values: Values) => string) })
  | (FieldBase & { kind: 'number'; value: number; min: number; max: number; step: number; unit?: string; format?: (v: number) => string })
  | (FieldBase & { kind: 'select'; value: string; options: { value: string; label: string }[] })
  | (FieldBase & { kind: 'toggle'; value: boolean })
  | (FieldBase & { kind: 'symbol'; value: string })
  /** The customer's OWN SVG as the artwork: a drop target, and nothing in front of it. The file
   *  is traced and stored exactly as the symbol picker stores an import, so the value is the
   *  same private-use character a `symbol` field holds and everything downstream (`areas`,
   *  `symbolLayer`, Save/Load) is unchanged. Use it where the design IS the customer's file —
   *  a grid of paw prints is not a step on the way there (Ian, 2026-09-22). */
  | (FieldBase & {
    kind: 'svg'; value: string;
    /** The key of the design's size field. A dropped file that states a REAL size — a cut file
     *  does, at `width="142.36mm"` — opens at that size instead of the design's default, because
     *  scaling a cut file is how a box stops fitting together. */
    sizeKey?: string;
  })
  | (FieldBase & { kind: 'blank'; value: string; categories?: BlankCategory[]; /** Number fields that take the picked shape's own defaults. */ linked?: { width?: string; height?: string; corner?: string } })
  /** Two numbers moved with a nudge pad: `key` is X, `keyY` is Y. */
  | (FieldBase & { kind: 'position'; value: number; keyY: string; valueY: number; max: number; step: number; unit?: string })
  /** A multi-line list, one item per line — a guest list, the family's names. The value is the
   *  raw text; `build()` splits it. */
  | (FieldBase & { kind: 'lines'; value: string; placeholder?: string; rows?: number; maxLines?: number })
  /** An integer count with − / + — posts, stakes, layers. */
  | (FieldBase & { kind: 'stepper'; value: number; min: number; max: number; step?: number; unit?: string; format?: (v: number) => string })
  /** A grid of silhouette tiles to pick a theme or a style by eye. `svgPath` draws in a 40 × 40 box. */
  | (FieldBase & { kind: 'thumbs'; value: string; options: { value: string; label: string; svgPath?: string }[]; columns?: number })
  /** A repeating pattern, picked from the gallery. The value is a pattern id: `pm-<slug>` for a
   *  tile of the Pattern Monster library, or a procedural id (`honeycomb`, `asanoha`). The
   *  control is a preview card of the current pattern over "Choose pattern…" and "Surprise me". */
  | (FieldBase & { kind: 'pattern'; value: string })
  /** Which surfaces of an uploaded SVG a pattern fills, picked by clicking them. `from` names
   *  the `symbol` field whose artwork is shown. The value is `"<char>|<i>,<j>"` — the artwork
   *  the pick was made on, then the faces; empty means every area, which is what a one-piece
   *  silhouette wants without a click. See `src/areas.ts`. */
  | (FieldBase & { kind: 'areas'; value: string; from: string });

export interface TemplateDef {
  id: string;
  name: string;
  /** One line under the name in the gallery. */
  blurb: string;
  /** Gallery pills — "keychain", "engrave + cut". The first is the category. */
  tags: string[];
  fields: Field[];
  /** The form's values → what to build. Async because fonts load lazily. */
  build(values: Values): Promise<BuildInput>;
  /** The download's file name stem. Default: the template id. */
  fileName?(values: Values): string;
  /** ONE sentence this design needs the customer to read about the file — an assembly step, a
   *  cake topper's food-safety note. Shown in the Export Preview's legend, never under the
   *  Download button; the editor appends the "set the blue lines to Score" reminder whenever
   *  the build scores.
   *
   *  A function when the advice depends on the settings: "cut the light frame from another
   *  sheet, then glue" is a lie in a mode that engraves the frame onto the one piece. */
  exportNote?: string | ((v: Values) => string);
  /** This design cuts in runs: `key` is the text field that becomes a one-per-line list in
   *  Batch mode; `noun` names a piece on the status line ("keychain" → "12 keychains"). */
  batch?: { key: string; noun: string };
}

/** The items of a `lines` field: trimmed, empty lines dropped. */
export const lines = (v: Values, k: string): string[] => String(v[k] ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function defaultsOf(t: TemplateDef): Values {
  // The reserved values: `__symbols` holds the inline symbols, and the three batch keys hold
  // what the Single | Batch control writes. They are seeded here so `coerceValues` keeps them
  // (it drops any key the defaults do not name) and Save/Load carries a run of names with it.
  const out: Values = { __symbols: '{}', __batch: false, __batchLines: '', __sheet: '300x300' };
  for (const f of t.fields) {
    out[f.key] = f.value;
    if (f.kind === 'position') out[f.keyY] = f.valueY;
  }
  return out;
}

/** Merge saved values over the defaults, keeping only keys the template knows, same type. */
export function coerceValues(t: TemplateDef, raw: unknown): Values {
  const out = defaultsOf(t);
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const cur = out[k];
    if (typeof cur === typeof v && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v as string | number | boolean;
  }
  if (t.id === 'connected-text') {
    const old = raw as Record<string,unknown>;
    if (!('twoLines' in old)) out.twoLines = typeof old.line2 === 'string' && old.line2.trim() !== '';
    // `letterOp` became the shared `letterLines` when the seams were rebuilt (G32) — same three
    // values, one key across every design that welds a word. A project saved under either of the
    // two older names still opens with the choice its owner made.
    if (!('letterLines' in old)) {
      if (typeof old.letterOp === 'string') out.letterLines = old.letterOp;
      else if (typeof old.scoreLetters === 'boolean') out.letterLines = old.scoreLetters ? 'score' : 'off';
    }
  }
  if (t.id === 'cake-topper') {
    // The topper was rebuilt on 2026-09-21 (packet C): `topLine` + `text` (the name) became
    // `line1`..`line3`. A saved topper keeps its words — the top line first, the name under it.
    const old = raw as Record<string, unknown>;
    if (!('line1' in old) && !('line2' in old)) {
      const top = typeof old.topLine === 'string' ? old.topLine.trim() : '';
      const name = typeof old.text === 'string' ? old.text.trim() : '';
      if (top || name) {
        out.line1 = top || name;
        out.line2 = top ? name : '';
        out.line3 = '';
      }
    }
  }
  return out;
}

export const str = (v: Values, k: string) => String(v[k] ?? '');
export const num = (v: Values, k: string) => Number(v[k] ?? 0);
export const bool = (v: Values, k: string) => v[k] === true;
