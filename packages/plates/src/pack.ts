import { getPlate, type PlateChoice } from './registry';

/*
  Laying a batch out on the build plate.

  This lives here rather than in an app because the plate is what it is about: the
  usable area, the margin the bed clips need, and which plate the user picked are all
  already this package's job. The keycap generator grew its own copy for keyboard
  sets (`src/pro/keyboardSet.js`), which is the second one — so the next generator
  that wants a set can have this instead of a third.
*/

/** How much of the plate an item takes, in mm. */
export interface Footprint {
  w: number;
  d: number;
}

/** Where an item's MIN corner goes, in plate coordinates centred on the origin. */
export interface Placement {
  /** 0 for the first plate. Items past the first need another print. */
  plate: number;
  x: number;
  y: number;
}

export interface PackOptions {
  /** Plate size in mm. Pass a `PlateChoice` to `packOnPlate` instead to look it up. */
  plate: [number, number];
  /** Kept clear at every edge. Default 6 mm — clips, the purge line, and a bed that
   *  is never quite square to the model. */
  margin?: number;
  /** Between neighbours. Default 3 mm: enough that two brims do not merge, and that
   *  a thumb can get between them once printed. */
  gap?: number;
}

const DEFAULT_MARGIN = 6;
const DEFAULT_GAP = 3;

/**
 * Shelf pack, in the order given.
 *
 * Items run left to right, wrap to a new row when the plate runs out of width, and to
 * a new plate when it runs out of depth. Rows are laid from the BACK forward, so the
 * plate reads in the order the names were typed — top-left first.
 *
 * Order-preserving rather than best-fit on purpose. A tighter pack would shuffle a
 * class list into whatever happened to tessellate, and then finding the one topper
 * that failed means hunting for it. Sorting by height would pack better still; it
 * would also mean the plate no longer matches the list the user is holding.
 *
 * An item wider than the usable plate is placed anyway, on its own row, and reported
 * by `packFits` — silently dropping it would be worse than a name that overhangs
 * where the user can see it.
 */
export function packShelf(items: Footprint[], opts: PackOptions): Placement[] {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const gap = opts.gap ?? DEFAULT_GAP;
  const usableW = Math.max(1, opts.plate[0] - margin * 2);
  const usableD = Math.max(1, opts.plate[1] - margin * 2);

  const out: Placement[] = [];
  let plate = 0;
  let cursorX = 0;
  let rowTop = 0;
  let rowDepth = 0;

  for (const item of items) {
    // Wrap the row when this item would run off the right edge. `cursorX > 0` so a
    // single over-wide item does not wrap forever on an empty row.
    if (cursorX > 0 && cursorX + item.w > usableW) {
      cursorX = 0;
      rowTop += rowDepth + gap;
      rowDepth = 0;
    }
    // Then the plate, on the same guard.
    if (rowTop > 0 && rowTop + item.d > usableD) {
      plate += 1;
      cursorX = 0;
      rowTop = 0;
      rowDepth = 0;
    }
    out.push({ plate, x: cursorX - usableW / 2, y: usableD / 2 - rowTop - item.d });
    cursorX += item.w + gap;
    rowDepth = Math.max(rowDepth, item.d);
  }
  return out;
}

/** `packShelf` against a named plate. Falls back to the A1 bed when the preview is on
 *  the plain grid, because "no plate shown" is a display choice, not a bed size. */
export function packOnPlate(
  items: Footprint[],
  choice: PlateChoice,
  opts: Omit<PackOptions, 'plate'> = {},
): Placement[] {
  return packShelf(items, { ...opts, plate: plateSize(choice) });
}

/** The bed to pack against for a choice, including the grid's fallback. */
export function plateSize(choice: PlateChoice): [number, number] {
  return getPlate(choice)?.size ?? [256, 256];
}

export interface PackSummary {
  placements: Placement[];
  /** How many plates the batch needs. 1 is one print. */
  plates: number;
  /** Indices of items too big for the usable area at all. */
  oversized: number[];
}

/** Pack, and say what the answer means: how many prints, and what will not fit. */
export function packFits(
  items: Footprint[],
  choice: PlateChoice,
  opts: Omit<PackOptions, 'plate'> = {},
): PackSummary {
  const size = plateSize(choice);
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const usableW = size[0] - margin * 2;
  const usableD = size[1] - margin * 2;
  const placements = packShelf(items, { ...opts, plate: size });
  const oversized = items
    .map((it, i) => (it.w > usableW || it.d > usableD ? i : -1))
    .filter((i) => i >= 0);
  return {
    placements,
    plates: placements.length ? Math.max(...placements.map((p) => p.plate)) + 1 : 0,
    oversized,
  };
}
