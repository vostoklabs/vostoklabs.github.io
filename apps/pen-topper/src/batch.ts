import type { ExportPart } from '@vostok/export';
import type { BatchResult, PartMesh } from './types';

/*
  The set: one design, many names, laid out on the plate.

  Everything about the topper other than the text comes from the settings already on
  screen, and that is the whole feature — you get the one you tuned, twenty-five
  times, rather than a second set of controls to keep in step with the first. It is
  also why the batch calls the SAME `buildTopper` the preview does: the day those two
  diverge is the day a set stops matching the thing you approved.
*/

/** How many names a run will take. Past this the build is minutes long and the tab
 *  looks hung; a class list is thirty. */
export const MAX_NAMES = 100;

/**
 * Split what was typed into names.
 *
 * Newlines and commas both, because both are how a list arrives: typed one per line,
 * or pasted out of a spreadsheet cell. Blank lines are dropped rather than becoming
 * blank toppers, and duplicates are KEPT — two children in a class are called Sam,
 * and quietly printing one of them is the kind of helpfulness nobody asked for.
 */
export function parseNames(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A filename-safe stem for the whole set. */
export function setFileName(names: string[]): string {
  const first = names[0]?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'set';
  return names.length > 1 ? `${first}-plus-${names.length - 1}-pen-toppers` : `${first}-pen-topper`;
}

/**
 * Flatten a finished batch into the part list the viewer and the exporter both take.
 *
 * Each topper gets its own `group`, which is what makes the export useful rather than
 * merely correct: the 3MF then carries one slicer OBJECT per name, so a name can be
 * moved, recoloured or deleted on the plate without touching the others. Merged into
 * one object instead, a set of twenty-five is a single un-editable slab — right on the
 * bed, wrong the moment anything needs changing.
 */
export function batchToParts(results: BatchResult[], plate = 0): ExportPart[] {
  const out: ExportPart[] = [];
  for (const r of results) {
    if (r.plate !== plate) continue;
    for (const p of r.parts as PartMesh[] as ExportPart[]) {
      out.push({ ...p, group: `${r.label || 'topper'} ${r.plate}-${out.length}` });
    }
  }
  return out;
}

/** Distinct plate numbers in a batch, in order. */
export function platesOf(results: BatchResult[]): number[] {
  return [...new Set(results.map((r) => r.plate))].sort((a, b) => a - b);
}

/** Every warning a batch raised, said once and attributed. */
export function batchWarnings(results: BatchResult[]): string[] {
  const seen = new Map<string, string[]>();
  for (const r of results) {
    for (const w of r.warnings) {
      if (!seen.has(w)) seen.set(w, []);
      seen.get(w)!.push(r.label);
    }
  }
  return [...seen.entries()].map(([w, who]) =>
    who.length > 3 ? `${w} (${who.length} names)` : `${w} (${who.join(', ')})`,
  );
}
