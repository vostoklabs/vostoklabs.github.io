// Letter tiles: a rounded square per letter, the letter engraved in the middle, its word-game
// value small in the bottom-right corner, and a scored border a hair inside the edge. The tiles
// are handed out as one island each and grown by a whisker, so wherever two of them share an
// edge they weld into a single cut piece under the Positive fill rule (`toCS` in @vostok/laser)
// — a crossword grid comes out as one board, a word comes out as one strip, and tiles that only
// touch at a corner still come out separate, which is what you want.
//
// The values are the ordinary English word-game letter values. The board game whose name people
// reach for here is a trademark; it is not used in this codebase, in the UI or in any copy.
import { bboxOf, mapShapes, roundedRectRing, type Shapes } from '@vostok/shapes';
import type { CutRing } from '@vostok/export';
import { textLayer } from './text';
import type { SymbolMap } from '../symbols/model';
import type { DesignLayer, OpChoice } from './types';

/** English word-game letter values. Anything else scores 1. */
export const LETTER_VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

export const letterValue = (char: string): number => LETTER_VALUES[char.toUpperCase()] ?? 1;

/** Tile overlap, mm — fixed, never a knob. Adjacent tile squares overlap this much so the union
 *  is numerically robust: far above coordinate noise, far below the score inset, so it never
 *  swallows the seam. */
export const TILE_WELD = 0.3;

/** How a tile LOOKS, from its size alone — the numbers that make a tile read as a letter tile
 *  rather than as one product's idea of one. Both tile products take them from here, so the
 *  keychain's tile and the crossword's are the same object at the same size; the two design
 *  docs' tables (§2.3 and §2.2) agree on every line of it and this is where they live.
 *  `boardTileLayers` keeps its own fallbacks for a caller with no product opinion. */
export interface TileLook {
  /** Corner radius, mm — 10 % of the side, the eased corner of a real tile, never a pill. */
  corner: number;
  /** Overlap between neighbours, mm. The grid pitch is `size − weld`. */
  weld: number;
  /** How far inside the edge the scored border runs, mm. */
  inset: number;
  /** The value numeral's inset from the right and bottom edges, mm. */
  valueInset: number;
  /** Nudge the letter up from the tile's centre, mm — ON TOP of `boardTileLayers`' own optical lift,
   *  for 0.05 × size in total: the optical centre sits ~45 % from the top. */
  letterDy: number;
  /** The value numeral's cap height as a share of the letter's. */
  valueRatio: number;
  /** Below this numeral cap height the value is dropped rather than engraved illegibly, mm. */
  valueFloor: number;
  /** Close radius that turns the V where two welded tiles meet into a fillet, mm. A pocketed
   *  piece needs it (the keychain); a wall plaque can live with the cusp. */
  seamFillet: number;
}

export function tileLook(size: number): TileLook {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const inset = clamp(0.04 * size, 0.6, 0.8);
  return {
    corner: clamp(0.1 * size, 0.8, 3.0),
    weld: TILE_WELD,
    inset,
    valueInset: inset + Math.max(0.07 * size, 0.8),
    letterDy: 0.01 * size,
    valueRatio: 0.34,
    valueFloor: 2.8,
    seamFillet: Math.max(0.6, 0.055 * size),
  };
}

export interface TileSpec {
  /** Tile side, mm. Use it as the grid pitch and the tiles weld into one piece. */
  size: number;
  /** Corner radius of the tile, mm. */
  corner: number;
  /** Letter height, mm. */
  letterSize: number;
  font: string;
  /** Engrave the word-game value in the bottom-right corner. */
  values?: boolean;
  /** Value numeral height, mm. Default letterSize × 0.32. */
  valueSize?: number;
  /** Face for the numeral. Default the letter's font — two typefaces is the ceiling. */
  valueFont?: string;
  /** How far inside the tile edge the scored border runs, mm. 0 leaves it off. */
  border?: number;
  symbols?: SymbolMap;
  /** How much each tile outline is grown so neighbours overlap, mm. Default 0.06. */
  weld?: number;
  /** Nudge the letter up (+) or down (−) from the optical centre, mm. */
  letterDy?: number;
  /** Grow the letter and value strokes by this many mm (dark dense woods want fatter strokes). */
  boldness?: number;
  /** Below this numeral height the values are left off rather than engraved illegibly, mm. */
  valueMinSize?: number;
  /** Value numeral inset from the right and bottom edges, mm. Default 12 % of the tile. */
  valueInset?: number;
}

/** How much every tile outline is grown so neighbours overlap instead of merely abutting.
 *  0.06 mm is a third of a 3 mm ply kerf: invisible on the cut, decisive for the union.
 *
 *  Edge-to-edge neighbours weld along the whole 18 mm edge — no thin web anywhere. Tiles that
 *  meet only at a CORNER stay separate as long as the corner radius clears 2·WELD/0.83 ≈
 *  0.15 mm, which every real tile does by two orders of magnitude; a square-cornered tile
 *  (corner ≈ 0) would join its diagonal neighbour by a ~0.1 mm thread, which is not a tile
 *  board, it is a fracture. */
const WELD = 0.06;
/** The optical centre sits ~46 % from the top, so a centred letter looks low. */
const OPTICAL_LIFT = 0.04;
/** Value numeral inset from the right and bottom edges, as a fraction of the tile. */
const VALUE_INSET = 0.12;
/** How wide the engraved border band is, mm. An engrave fills whatever region it is given, so
 *  the border becomes a true annulus there — a filled ring spanning nearly the whole tile would
 *  black the face out and hide the letter, which is exactly what it used to do. */
const ENGRAVE_BAND = 0.35;

/** One tile outline, CCW, centred on (cx, cy). */
export function tileRing(cx: number, cy: number, size: number, corner: number): CutRing {
  return roundedRectRing(size, size, corner).map(([x, y]) => [x + cx, y + cy] as [number, number]);
}

/**
 * Tiles → the blank they cut from and the layers that go on them.
 *
 * `blank` is one island per cell (grown by WELD, so touching tiles fuse). `layers` are the
 * letters, optionally the values — both on `ops.letter` — and the inset borders on `ops.border`.
 * Borders are inset, so they never touch each other: every tile keeps its own scored edge even
 * when the bodies have welded into one board.
 */
export async function boardTileLayers(
  cells: { x: number; y: number; char: string }[],
  spec: TileSpec,
  ops: { letter: OpChoice; border: OpChoice },
): Promise<{ blank: Shapes; layers: DesignLayer[]; valuesDropped: boolean }> {
  const size = spec.size;
  const border = spec.border ?? 0.7;
  const valueSize = spec.valueSize ?? spec.letterSize * 0.32;
  const valueFont = spec.valueFont ?? spec.font;
  const inset = spec.valueInset ?? size * VALUE_INSET;
  const weld = spec.weld ?? WELD;
  // A numeral too small to engrave cleanly is left off, and the caller is told so it can say why.
  const valuesDropped = !!spec.values && spec.valueMinSize !== undefined && valueSize < spec.valueMinSize;
  const wantValues = !!spec.values && !valuesDropped;

  const blank: Shapes = cells.map((c) => [tileRing(c.x, c.y, size + 2 * weld, spec.corner + weld)]);

  const built = await Promise.all(
    cells.map(async (cell) => {
      const char = String(cell.char ?? '').toUpperCase();
      if (!char.trim()) return { letter: [] as Shapes, value: [] as Shapes };
      const letter = (
        await textLayer(
          { text: char, font: spec.font, size: spec.letterSize, x: cell.x, y: cell.y + size * OPTICAL_LIFT + (spec.letterDy ?? 0), symbols: spec.symbols },
          ops.letter,
          'letters',
          'Letters',
        )
      ).flatMap((l) => l.shapes);
      // A numeral only where the character really carries a word-game value: a digit, a hyphen or
      // an accented capital printed with a "1" is a fabricated score on a real object.
      if (!wantValues || LETTER_VALUES[char] === undefined) return { letter, value: [] as Shapes };
      // Built at the origin and measured, so the numeral sits on the tile's corner whatever the
      // face's digit metrics are, and "10" grows leftwards instead of over the edge.
      const digits = (await textLayer({ text: String(letterValue(char)), font: valueFont, size: valueSize }, ops.letter, 'values', 'Letter values')).flatMap(
        (l) => l.shapes,
      );
      if (!digits.length) return { letter, value: [] as Shapes };
      const b = bboxOf(digits);
      const dx = cell.x + size / 2 - inset - b.maxX;
      const dy = cell.y - size / 2 + inset - b.minY;
      return { letter, value: mapShapes(digits, ([x, y]) => [x + dx, y + dy]) };
    }),
  );

  const layers: DesignLayer[] = [];
  const grow = spec.boldness && Math.abs(spec.boldness) > 1e-3 ? { grow: spec.boldness } : {};
  const letters = built.flatMap((b) => b.letter);
  if (letters.length) layers.push({ id: 'letters', label: 'Letters', shapes: letters, op: ops.letter, ...grow });
  const values = built.flatMap((b) => b.value);
  if (values.length) layers.push({ id: 'values', label: 'Letter values', shapes: values, op: ops.letter, ...grow });
  if (border > 0 && cells.length) {
    const side = size - 2 * border;
    const r = Math.max(0, spec.corner - border);
    // Scored, the border is one thin line and a single ring says it. Engraved, a ring is FILLED,
    // so the same ring would black out the whole face: the band is drawn as a true annulus and
    // only the band is filled.
    const rings: Shapes = cells.map((c) => (ops.border === 'engrave'
      ? [tileRing(c.x, c.y, side, r), tileRing(c.x, c.y, side - 2 * ENGRAVE_BAND, Math.max(0, r - ENGRAVE_BAND))]
      : [tileRing(c.x, c.y, side, r)]));
    layers.push({ id: 'borders', label: 'Tile borders', shapes: rings, op: ops.border });
  }
  return { blank, layers, valuesDropped };
}
