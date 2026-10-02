// The few library tiles the studio draws or offers differently from Pattern Monster, and why.
// Free of path data on purpose: the picker reads it before a byte of the library has loaded.
export interface TileTuning {
  /** Left out of the picker — "Choose pattern…" and "Surprise me". A design that already names
   *  the tile still builds it. */
  hidden?: true;
  /** Tile units by which the lines BETWEEN the tile's shapes are drawn thicker than Pattern
   *  Monster draws them: what its shapes paint is eroded by half this, for Engrave and Score
   *  (`PatternDef.erode`). */
  thicken?: number;
}

export const TILE_TUNING: Readonly<Record<string, TileTuning>> = {
  // Ian, 2026-09-29: two multi-colour tiles whose one colour engraves nearly solid (85–90 % of a
  // coaster) and scores as a thicket of lines. Hidden, not fixed.
  'stars-and-lines-1': { hidden: true },
  'stripes-2': { hidden: true },
  // Ian, 2026-09-29: the lines in between need to be a bit thicker to engrave and cut well.
  // Their lines are drawn 1.2 and 0.5 tile units wide (0.40 and 0.17 mm at their default
  // sizes); both become 2 units (0.66 mm at 100 %).
  'japanese-pattern-7': { thicken: 0.8 },
  'interlocked-hexagons-3': { thicken: 1.5 },
};

/** Whether the picker leaves a tile out, by its id with or without the `pm-` prefix. */
export const isHiddenTile = (id: string): boolean => TILE_TUNING[id.replace(/^pm-/, '')]?.hidden === true;
