// Batch: one design, a list of names, one sheet, one download.
//
// A template that opts in (`TemplateDef.batch`) is built once per line of the list — the same
// values with its text key swapped — and the results are merged HERE into a single `BuildInput`:
// the first build stays the primary (so the keyring drag, the status and the Assembled view still
// describe a real piece), and every later build becomes a part beside it. The engine then does
// what it already does for a set of place cards: wrap the pieces onto the sheet and paginate.
//
// Nothing about a copy is a special case downstream. A copy carries its own `KeyringSpec`, so its
// hole is placed on its own outline exactly as the primary's is; and a copy's own parts (a layered
// keychain's middle and name pieces) keep their `keyring: 'shared'` but point at THAT copy with
// `registerTo`, so a stack registers to the name it belongs to and never to the first one.
//
// Pure and main-thread: no manifold, no DOM.
import type { BuildInput, PartInput } from './types';

/** The sheet a run is cut from. Sizes are the WORK AREA, in mm, landscape. */
export interface BatchSheet {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const BATCH_SHEETS: BatchSheet[] = [
  { id: '300x300', label: '300 × 300 mm', width: 300, height: 300 },
  { id: '400x400', label: '400 × 400 mm', width: 400, height: 400 },
  { id: '600x400', label: '600 × 400 mm', width: 600, height: 400 },
  { id: 'a4', label: 'A4 · 297 × 210 mm', width: 297, height: 210 },
  { id: 'a3', label: 'A3 · 420 × 297 mm', width: 420, height: 297 },
  { id: 'letter', label: 'US Letter · 279 × 216 mm', width: 279.4, height: 215.9 },
];

/** The picked sheet, or the first one — a saved project can name a size this build dropped. */
export const sheetOf = (id: string): BatchSheet => BATCH_SHEETS.find((s) => s.id === id) ?? BATCH_SHEETS[0]!;

/** Air between the page edge and the first piece, mm — the same margin place cards default to. */
const SHEET_MARGIN = 5;
/** Air between pieces, mm: wide enough that one piece's cut cannot reach its neighbour. */
const GAP = 4;

/** How a run of two-colour pieces shares its sheets. `separate`: each colour on sheets of its own
 *  (the engine's `byMaterial`) — the default, because a sheet IS one material. `together`: every
 *  piece where it falls, colours mixed on one page. A one-colour design lays out the same either way. */
export type BatchColours = 'separate' | 'together';

/**
 * One build per name → one build of the whole run.
 *
 * `inputs[0]` is the primary, unchanged but for its name: a template that labels its primary
 * ("Backer · colour 1") keeps that label; one that does not gets the first name, so every piece
 * on the sheet is labelled.
 */
export function mergeBatch(inputs: BuildInput[], names: string[], sheet: { width: number; height: number }, noun: string, colours: BatchColours = 'separate'): BuildInput {
  const first = inputs[0];
  if (!first) throw new Error('A batch needs at least one name.');

  // The first copy's own pieces stay where they are, so each name's set of pieces is read
  // together on the sheet rather than interleaved with the next name's.
  const parts: PartInput[] = [...(first.parts ?? [])];
  for (let i = 1; i < inputs.length; i++) {
    const copy = inputs[i]!;
    const id = `copy-${i}`;
    parts.push({
      id,
      label: names[i] ?? '',
      blank: copy.blank,
      layers: copy.layers,
      keyring: copy.keyring,
      ...(copy.bodyMembers ? { bodyMembers: copy.bodyMembers } : {}),
      ...(copy.material ? { material: copy.material } : {}),
    });
    for (const p of copy.parts ?? []) {
      parts.push({ ...p, id: `${id}-${p.id}`, ...(p.keyring === 'shared' ? { registerTo: id } : {}) });
    }
  }

  // The same sentence from twenty names is one sentence; a sentence only one name provokes
  // carries that name. Only the first warning reaches the status line, so order is kept.
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < inputs.length; i++) {
    for (const w of inputs[i]!.warnings ?? []) {
      if (seen.has(w)) continue;
      seen.add(w);
      warnings.push(i === 0 ? w : `${names[i] ?? ''}: ${w}`);
    }
  }

  const n = names.length;
  return {
    ...first,
    label: first.label || names[0] || '',
    parts,
    layout: { flow: 'wrap', gap: GAP },
    sheet: { width: sheet.width, height: sheet.height, margin: SHEET_MARGIN, ...(colours === 'separate' ? { byMaterial: true } : {}) },
    status: `${n} ${noun}${n === 1 ? '' : 's'}`,
    warnings,
  };
}

/** " · 2 sheets" for the status line, unless the build's own clause already says it. */
export function sheetsClause(out: { sheets?: { count: number } | undefined; status?: string | undefined }): string {
  const count = out.sheets?.count ?? 0;
  if (!count || /\bsheets?\b/i.test(out.status ?? '')) return '';
  return ` · ${count} sheet${count === 1 ? '' : 's'}`;
}
