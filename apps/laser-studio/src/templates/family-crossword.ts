// Family names crossword ornament: type your family's names, they interlock like a crossword on
// shared letters, and every filled cell becomes a letter tile.
//
// Three pieces, always:
//
// · FRAME (primary, LIGHT sheet). The silhouette with a window cut out of it: a constant rim all
//   the way round, widening at the bottom into a BAND that carries the family name over the year.
//   The window is `silhouette inset by rimWidth` minus that band, so the frame is one island with
//   one hole and the band is simply the part of the frame below the window. `circleBandRing`
//   (round) and `stripBandRing` (square) give the band its own region, which is what the text is
//   fitted to. The hanging loop is the ordinary outside-mode keyring grown from the FRAME.
// · BACKER (DARK sheet). The plain silhouette, `keyring: 'shared'` so the loop runs through both
//   sheets, plus the scored glue guide saying where the tiles land.
// · TILES (LIGHT sheet). The welded crossword, cut as its own piece and glued RAISED on the
//   backer inside the window. It never carries the loop or a hole.
//
// Two silhouettes, round and square, and nothing else: one shape of ornament done well rather
// than several done badly (2026-09-21). The plaque with no frame, the
// heart, the tree, the bauble and the Wide/Tall interlock they needed are gone with them.
//
// Sizes, all derived — none of them is a control, because every one of them has exactly one
// right answer once the customer has said how big the ornament is:
//   rim       = rimWidthFor(D)                 7 % of D, 5–14 mm       → 7 mm at Ø 100
//   band      = 0.14 × D into the window       9–(half the window)     → 14 mm at Ø 100
//   loop hole = 0.04 × D, 3–6 mm  · wall = 0.05 × D, 3–7 mm            → Ø 4 in a 14 mm tab
//   tile      = the crossword filling 0.70 of the window (the geometric mean of the two
//               sides), or the largest that fits inside it tile by tile — whichever is smaller

import { bboxOf, blankById, blankSilhouette, circleRing, roundedRectRing, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { FONTS } from '@vostok/fonts';
import { textLayer } from '../engine/text';
import { TILE_WELD, tileLayers, tileLook } from '../engine/tiles';
import { layoutCrossword, type CrosswordPrefer } from '../engine/crossword';
import { bandChordWidth, circleBandRing, rimWidthFor, stripBandRing } from '../engine/frame';
import { readSymbols } from '../symbols/model';
import type { DesignLayer, PartInput } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import { lightPieceFields, stackedText, stem } from './shared';
import { lines, num, str, type Field, type TemplateDef } from './types';

/** How far inside the piece it traces a glue guide is scored, mm — the line has to vanish under
 *  the piece it registers, never show as a halo round it. */
const GUIDE_INSET = 0.3;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** One decimal, no trailing zero — "14" not "14.0", "4.2" as typed. */
const fmt = (n: number) => Number(n.toFixed(1)).toString();

/** Tile overlap, mm — §2.3: fixed, not a knob, and `tileLook`'s, so the letter tile keychain
 *  cuts the same tile. The grid PITCH is `size − WELD`, so the overlap comes out of the spacing
 *  itself rather than only from the ring growth inside `tileLayers`. */
const WELD = TILE_WELD;

/** The square's corner radius as a share of its side. 5 % sits in the 4–12 % band at
 *  every size this design offers, and never reads as a pill. */
const SQUARE_CORNER = 0.05;
/** How deep the name band reaches into the window, as a share of the ornament's size. At Ø 100
 *  that is 14 mm of band under a 7 mm rim — 21 % of the height in light wood at the bottom,
 *  which reads as a band rather than a rim. */
const BAND_DEPTH = 0.14;
/** Air above and below the band's text block, mm. */
const BAND_MARGIN = 1.5;
/** The share of the band's chord the text is fitted to — 5 % of air at each end. */
const BAND_FILL = 0.9;
/** The smallest tile letter this design will draw at all: below it a cap's counter closes under
 *  kerf. A fault, not advice. */
const LETTER_HARD = 3.5;
/** Below this the letters engrave but read small. 4 mm rather than the plaque's 5: a Ø 100
 *  ornament carrying five names IS a 4–5 mm capital, and the engraved-text band starts at
 *  3 mm. */
const LETTER_SOFT = 4.0;
/** How much of the window the crossword fills, as the geometric mean of the two sides — the
 *  measure is symmetric, so the rule is the same whichever way round the interlock came out.
 *  Its real job is a ceiling: a two-name board would otherwise be blown up until it touched the
 *  frame. `FILL_MAX` is the same rule per side, for a board the mean cannot see. */
const FILL = 0.7;
const FILL_MAX = 0.85;
/** Loop hole and the wall round it, as shares of the ornament's size. At Ø 100: a 4 mm hole in a
 *  14 mm tab (§5.3 of the laser reference — the neck is as wide as the tab, so the cross-section
 *  through the hole is the weakest point and nothing is necked down past it). */
const LOOP_HOLE = 0.04;
const LOOP_WALL = 0.05;
/** The smallest numeral em the tiles carry, mm — about a 1.3 mm digit, the last size a diode or
 *  CO2 raster still draws as a number rather than a dot. Under it the values are left off. */
const VALUE_MIN_EM = 1.8;

/** §2.1: trim, uppercase, strip everything that is not a Unicode letter, drop if empty,
 *  truncate to 14 (warn), keep at most the first 8 (warn). Eight rather than ten: past that the
 *  grid inside a 100 mm window is under the engraving floor whatever else is done. */
const MAX_NAMES = 8;

function normaliseNames(rawLines: string[]): { names: string[]; warnings: string[] } {
  const warnings: string[] = [];
  let out: string[] = [];
  for (const line of rawLines) {
    const full = Array.from(line.toLocaleUpperCase())
      .filter((ch) => /\p{L}/u.test(ch))
      .join('');
    if (!full) continue;
    let letters = full;
    if (full.length > 14) {
      letters = full.slice(0, 14);
      warnings.push(`${full} was cut to its first 14 letters.`);
    }
    out.push(letters);
  }
  if (out.length > MAX_NAMES) {
    out = out.slice(0, MAX_NAMES);
    warnings.push(`Only the first ${MAX_NAMES} names are used.`);
  }
  return { names: out, warnings };
}

// ---------------------------------------------------------------------------- the frame --

type Shape = 'round' | 'square';

/** The circle's arc ABOVE `y`, closed by the chord — exactly the complement of
 *  `circleBandRing`, and the window a bottom band leaves in a round frame. Wound CCW: up the
 *  right side, over the top, down to the left chord end, and the chord closes it. */
function circleCapRing(R: number, y: number, n = 96): CutRing {
  const yy = clamp(y, -R, R);
  const half = Math.sqrt(Math.max(0, R * R - yy * yy));
  const start = Math.atan2(yy, half); // the right chord end
  const end = Math.PI - start; // the left chord end, the long way over the top
  const ring: CutRing = [];
  const steps = Math.max(2, Math.round(n));
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    ring.push([R * Math.cos(t), R * Math.sin(t)]);
  }
  return ring;
}

const moveRing = (ring: CutRing, dy: number): CutRing => ring.map(([x, y]) => [x, y + dy] as [number, number]);

interface Frame {
  /** The silhouette. */
  outer: CutRing;
  /** The hole in the frame: the silhouette inset by the rim, less the band. */
  window: CutRing;
  /** The band's own region — where the family name and the year are engraved. */
  band: Shapes;
  /** How wide the band is at height `y`, mm. */
  chordAt: (y: number) => number;
  /** The band's vertical middle and its depth, mm. */
  bandY: number;
  bandDepth: number;
  /** How far a point lies inside the window, mm — negative outside. In closed form, because the
   *  crossword fit asks it tens of thousands of times a build (see `fitGrid`). */
  clearance: (x: number, y: number) => number;
}

/**
 * The frame, in closed form. Both silhouettes are their own true offset — a circle's inset is a
 * concentric circle and a rounded square's is a rounded square with `corner − rim` — so this
 * needs no worker pass, which is what lets the window carry the band's bite out of it.
 */
function frameOf(shape: Shape, D: number, rim: number, bandDepth: number): Frame {
  if (shape === 'square') {
    const C = SQUARE_CORNER * D;
    const w = D - 2 * rim;
    const h = D - 2 * rim;
    const ci = Math.max(0, C - rim);
    const bd = clamp(bandDepth, 0, 0.5 * h);
    // The window is a rounded rectangle `w × (h − bd)` centred `bd / 2` up: minus its signed
    // distance field is how deep a point sits inside it.
    const hw = w / 2;
    const hh = (h - bd) / 2;
    const cr = Math.min(ci, hh);
    return {
      outer: roundedRectRing(D, D, C),
      window: moveRing(roundedRectRing(w, h - bd, Math.min(ci, (h - bd) / 2)), bd / 2),
      band: bd > 0 ? [[stripBandRing(w, h, 'bottom', bd)]] : [],
      chordAt: () => w,
      bandY: -h / 2 + bd / 2,
      bandDepth: bd,
      clearance: (x, y) => {
        const qx = Math.abs(x) - (hw - cr);
        const qy = Math.abs(y - bd / 2) - (hh - cr);
        return cr - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0);
      },
    };
  }
  const R = D / 2;
  const Rw = R - rim;
  const bd = clamp(bandDepth, 0, 0.5 * Rw);
  const top = -Rw + bd;
  return {
    outer: circleRing(0, 0, R, 192),
    window: bd > 0 ? circleCapRing(Rw, top) : circleRing(0, 0, Rw, 192),
    band: bd > 0 ? [[circleBandRing(Rw, top, 64)]] : [],
    chordAt: (y) => bandChordWidth(Rw, y),
    bandY: -Rw + bd / 2,
    bandDepth: bd,
    // The window is the disc less everything under the band's chord: whichever edge is nearer.
    clearance: (x, y) => Math.min(Rw - Math.hypot(x, y), bd > 0 ? y - top : Infinity),
  };
}

// ------------------------------------------------------------------------- the name band --

/** The em size to hand a text layer so the RENDERED cap height comes out at `capMm`, for
 *  whichever font is chosen — faces differ in how tall their capitals are against their own em,
 *  so `size` alone does not hit an exact cap height without this correction. */
async function capRatio(font: string): Promise<number> {
  const box = bboxOf((await textLayer({ text: 'H', font, size: 1 }, 'off')).flatMap((l) => l.shapes));
  return Math.max(0.1, box.maxY - box.minY);
}

/**
 * The family name over the year, fitted to the band.
 *
 * Two passes, because on the round frame the two are coupled: the band is a circular segment, so
 * how wide the text may be depends on how tall it turned out — the top line sits higher up the
 * chord than the block's centre does. Pass one measures the block, pass two re-fits it to the
 * chord at the top line's own height.
 */
async function bandBlock(
  f: Frame,
  rows: { text: string; rel: number; font?: string }[],
  base: { font: string; symbols: ReturnType<typeof readSymbols> },
  capOf: number,
): Promise<{ layers: DesignLayer[]; cap: number } | null> {
  const live = rows.filter((r) => r.text.trim() !== '');
  if (!live.length || f.bandDepth <= 2) return null;
  const maxHeight = f.bandDepth - 2 * BAND_MARGIN;
  if (maxHeight <= 1) return null;

  const make = (size: number) =>
    stackedText(live.map((r) => ({ text: r.text, size: r.rel * size, ...(r.font ? { font: r.font } : {}) })), { ...base, x: 0, y: f.bandY }, 'engrave', 'band', 'Name band');

  let width = BAND_FILL * f.chordAt(f.bandY);
  let size = 8;
  let layers = await make(size);
  if (!layers.length) return null;
  for (let pass = 0; pass < 2; pass++) {
    const box = bboxOf(layers[0]!.shapes);
    const k = Math.min(width / Math.max(box.maxX - box.minX, 1e-6), maxHeight / Math.max(box.maxY - box.minY, 1e-6));
    if (Math.abs(k - 1) > 0.01) {
      size = Math.max(0.4, size * k);
      layers = await make(size);
      if (!layers.length) return null;
    }
    // Where the tallest line really sits, so the second pass measures the chord there and not at
    // the block's centre — on a segment that is worth a millimetre or two of cap height.
    const b2 = bboxOf(layers[0]!.shapes);
    const topLineY = b2.maxY - (b2.maxY - b2.minY) * 0.25;
    width = BAND_FILL * f.chordAt(clamp(topLineY, -1e6, 1e6));
  }
  // `keep` holds the engrave inside the band's own region — the segment `circleBandRing` cuts, or
  // the strip `stripBandRing` does. The fit above already sizes the block to that region, so this
  // is a backstop against a face whose ink reaches further than its metrics say: the plate clip
  // would otherwise let a tall glyph run up onto the rim, where the frame is only 7 mm wide.
  return { layers: layers.map((l) => ({ ...l, keep: f.band })), cap: size * capOf * live[0]!.rel };
}

// -------------------------------------------------------------------------- the crossword --

const PREFERS: CrosswordPrefer[] = ['compact', 'wide', 'tall'];

interface GridCell { row: number; col: number; char: string }

/**
 * The crossword's own cells, plus a row under it for every name that could not be welded in.
 *
 * A name that shares no letter with the others has no legal crossing, and a name typed twice is
 * normalised away by the solver before it reaches the grid (§2.7, §5). Both get a blank row of
 * gap and then their own row of tiles under the board — the piece then comes off the bed in two
 * parts, which is honest, rather than the name disappearing with nothing said.
 *
 * Returned in grid units with row 0 and col 0 at the block's own top-left, so the caller can
 * scale the whole thing by a pitch without re-deriving anything.
 */
function gridWithStrays(layout: ReturnType<typeof layoutCrossword>, names: string[]): {
  cells: GridCell[]; cols: number; rows: number; strays: { word: string; repeat: boolean }[];
} {
  const seen = new Set<string>();
  const repeats: string[] = [];
  for (const w of names) { if (seen.has(w)) repeats.push(w); else seen.add(w); }
  const strays = [
    ...layout.unplaced.map((word) => ({ word, repeat: false })),
    ...repeats.map((word) => ({ word, repeat: true })),
  ];
  const cells: GridCell[] = layout.cells.map((c) => ({ row: c.row, col: c.col, char: c.char }));
  strays.forEach((s, i) => {
    const col0 = Math.round((layout.cols - s.word.length) / 2);
    const row = layout.rows + 1 + i * 2; // a blank row of gap, then this name's row
    for (let j = 0; j < s.word.length; j++) cells.push({ row, col: col0 + j, char: s.word[j]! });
  });
  if (!cells.length) return { cells, cols: 0, rows: 0, strays };
  const minCol = Math.min(...cells.map((c) => c.col));
  const minRow = Math.min(...cells.map((c) => c.row));
  const norm = cells.map((c) => ({ row: c.row - minRow, col: c.col - minCol, char: c.char }));
  return {
    cells: norm,
    cols: Math.max(...norm.map((c) => c.col)) + 1,
    rows: Math.max(...norm.map((c) => c.row)) + 1,
    strays,
  };
}

/**
 * How big the tiles are, and where the block sits.
 *
 * Two rules, and the smaller wins:
 *
 * 1. the crossword fills `FILL` of the window — the geometric mean of the two sides, and neither
 *    side past `FILL_MAX` of its own. A ceiling, because a two-name board would otherwise be
 *    blown up until it touched the frame;
 * 2. every TILE sits inside the real window with `margin` of material clear.
 *
 * Rule 2 is per tile and not per bounding box on purpose: a crossword's box corners are empty —
 * that is what a crossword looks like — and holding the box inside a round window costs a third
 * of the tile size for material that was never there. A typical five-name board would not fit
 * its own ornament under a box test.
 */
function fitGrid(f: Frame, cells: GridCell[], cols: number, rows: number, margin: number): { tile: number; cy: number; skew: number } {
  if (!cols || !rows || !cells.length) return { tile: 0, cy: 0, skew: Infinity };
  const wb = bboxOf([[f.window]]);
  const winW = wb.maxX - wb.minX;
  const winH = wb.maxY - wb.minY;
  const sideW = (t: number) => (cols - 1) * (t - WELD) + t;
  const sideH = (t: number) => (rows - 1) * (t - WELD) + t;
  // "Fills FILL of the window", measured as the geometric mean of the two sides so the rule is
  // the same whichever way round the board came out — capping the longest side alone would let a
  // tall board on a square window run to 84 % of its height while a wide one stopped at 70 %.
  // Monotone in `t`, so bisection rather than a quadratic.
  const target = FILL * Math.sqrt(winW * winH);
  let ceiling = Math.max(winW, winH);
  {
    let lo = 0;
    let hi = ceiling;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (Math.sqrt(sideW(mid) * sideH(mid)) <= target) lo = mid;
      else hi = mid;
    }
    // …and neither side alone past FILL_MAX of its own, which only bites the boards the mean
    // cannot see: a 6 × 9 interlock in a square window came out at 89 % of its height.
    const side = (win: number, n: number) => (FILL_MAX * win + (n - 1) * WELD) / n;
    ceiling = Math.min(lo, side(winW, cols), side(winH, rows));
  }

  // A tile fits when its four CORNERS keep `margin` inside the window. Four points are exact,
  // not a sample: both windows are convex (a disc cut by a chord, a rounded rectangle), and the
  // distance to a convex region's edge is concave inside it, so over a square it is smallest at
  // a corner.
  //
  // This used to be `fitBoxInside` per tile — nine points, a polygon walk each, and a ten-step
  // bisection of its own for every tile that missed, when all this needs is yes or no. Nine
  // boards × 21 heights × 10 halvings × every tile made it 2–4 SECONDS a build, on every
  // keystroke, which made the editor lag. Closed-form
  // corners take the whole fit to a few milliseconds.
  const fits = (t: number, cy: number): boolean => {
    const pitch = t - WELD;
    const h = t / 2;
    for (const c of cells) {
      const x = (c.col - (cols - 1) / 2) * pitch;
      const y = ((rows - 1) / 2 - c.row) * pitch + cy;
      if (f.clearance(x - h, y - h) < margin || f.clearance(x + h, y - h) < margin
        || f.clearance(x - h, y + h) < margin || f.clearance(x + h, y + h) < margin) return false;
    }
    return true;
  };

  // The optical centre sits a little above the geometric one, so among the
  // heights that hold the same tile the one nearest that point wins.
  const cyOptical = (wb.minY + wb.maxY) / 2 + 0.03 * winH;
  let tile = 0;
  let cy = cyOptical;
  const SCANS = 21;
  for (let s = 0; s < SCANS; s++) {
    const at = wb.minY + 0.15 * winH + (s / (SCANS - 1)) * 0.7 * winH;
    // The largest tile that fits at this height, halved in from the ceiling.
    let lo = 0;
    let hi = ceiling;
    if (fits(hi, at)) lo = hi;
    else for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, at)) lo = mid;
      else hi = mid;
    }
    if (lo > tile + 1e-6 || (Math.abs(lo - tile) <= 1e-6 && Math.abs(at - cyOptical) < Math.abs(cy - cyOptical))) {
      tile = lo;
      cy = at;
    }
  }
  // How far this board's shape is from the window's own, in log aspect — the tie-break when two
  // interlocks hold the same tile size.
  const skew = tile > 0 ? Math.abs(Math.log((sideW(tile) / sideH(tile)) / (winW / winH))) : Infinity;
  return { tile, cy, skew };
}

// ----------------------------------------------------------------------------- the form --

function silhouettePath(blankId: string): string | undefined {
  const def = blankById(blankId);
  return def ? blankSilhouette(def) : undefined;
}

export const familyCrossword: TemplateDef = {
  id: 'family-crossword',
  name: 'Family names crossword',
  blurb: 'Your family’s names interlock into raised letter tiles, framed and ready to hang.',
  tags: ['ornament', 'engrave + score + cut'],
  fields: [
    // ---------------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'lines', key: 'names', label: 'Names', panel: 'right', section: 'Names',
      value: 'Sarah\nJordan\nDavid\nChris',
      placeholder: 'One name per line',
      rows: 5, maxLines: MAX_NAMES,
      help: 'Your surname can be a line too, and it interlocks.',
    },
    {
      kind: 'text', key: 'familyName', label: 'Family name', panel: 'right', section: 'Band',
      // Default family name: "The Millers" because
      // its narrow i/l/l keep the band cap over the 5 mm floor at Ø 100 — "The Harpers" is a
      // hair wider and warns at 4.9 mm.
      value: 'The Millers', placeholder: 'The Millers', maxLength: 20, symbols: true,
    },
    {
      kind: 'text', key: 'year', label: 'Year', panel: 'right', section: 'Band',
      value: '2026', placeholder: '2026', maxLength: 12, symbols: false,
      help: 'A year, or a short second line under the name.',
    },
    // The font field always lands on the left as its own category, whatever `panel` says.
    // Slabs and sturdy serifs: a tile letter is a small block of ink with no hairlines, and
    // every face here was built as the default family before it was listed.
    {
      kind: 'font', key: 'font', label: 'Tile font', panel: 'right', section: 'Font', value: 'arvo',
      recommended: ['arvo', 'roboto-slab', 'bitter', 'zilla-slab', 'sanchez', 'bree-serif', 'domine', 'montserrat'],
    },
    // The family name's own face — a script, by default. The tiles are a block of capitals, so
    // the band is where the piece gets its one accent (two typefaces, one accent): a surname
    // set in a script under the grid reads as part of the ornament, where a block face read as a
    // label. The year stays in the tile face.
    {
      kind: 'font', key: 'bandFont', label: 'Family name font', panel: 'right', section: 'Font', value: 'great-vibes',
      recommended: ['great-vibes', 'parisienne', 'pinyon-script', 'dancing-script', 'sacramento', 'arvo'],
      previewFrom: 'familyName',
      visibleWhen: (v) => str(v, 'familyName').trim() !== '',
    },

    // ------------------------------------------------------- LEFT: "Ornament" (opens first) --
    {
      kind: 'thumbs', key: 'backer', label: 'Shape', section: 'Ornament', value: 'round', columns: 2,
      options: [
        { value: 'round', label: 'Round', svgPath: silhouettePath('circle') },
        { value: 'square', label: 'Square', svgPath: silhouettePath('coaster-square') },
      ],
    },
    {
      kind: 'number', key: 'backerSize', label: 'Size', section: 'Ornament', value: 100, min: 60, max: 140, step: 1, unit: 'mm',
      help: '80–110 mm is the classic hanging-ornament range.',
    },
    {
      kind: 'number', key: 'backerMargin', label: 'Edge margin', section: 'Ornament', value: 3, min: 2, max: 15, step: 0.5, unit: 'mm',
      help: 'Material kept clear around the tiles, inside the frame.',
    },

    // ------------------------------------------------------------------- LEFT: "Tiles" --
    {
      kind: 'stepper', key: 'layout', label: 'Layout', section: 'Tiles', value: 1, min: 1, max: 99, step: 1,
      help: 'Steps through different interlocks of the same names.',
    },
    // The word-game value in each tile's corner. On, like the tiles it copies: without the
    // numeral a letter tile reads as a square with a letter in it, and at this same scale it
    // still engraves cleanly. The numeral is small (about 1.5 mm at Ø 100), so it is dropped —
    // and said — when the tiles get small enough that it would engrave as a smudge.
    {
      kind: 'toggle', key: 'values', label: 'Letter values', section: 'Tiles', value: true,
      help: 'The small number in each tile’s corner.',
    },
    {
      kind: 'select', key: 'edgeOp', label: 'Tile edges', section: 'Tiles', value: 'score',
      options: [{ value: 'score', label: 'Score' }, { value: 'engrave', label: 'Engrave' }, { value: 'off', label: 'Off' }],
      help: 'If your software cuts on blue, use Engrave instead.',
    },
    // Raised is the product: the tiles are their own light piece, glued on the dark backer over
    // a scored guide. Engrave burns them into the backer instead, for one sheet of material.
    ...lightPieceFields('Tiles', 'raised', { help: 'Raised cuts the tiles as a piece to glue on.' }),

    // --------------------------------------------------------------- LEFT: "Lettering" --
    // The same three knobs, in the same section, as the letter tile keychain's.
    {
      kind: 'number', key: 'letterScale', label: 'Letter size', section: 'Lettering', value: 0.55, min: 0.35, max: 0.65, step: 0.01,
      format: (val: number) => `${Math.round(val * 100)}% of the tile`,
    },
    {
      kind: 'select', key: 'letterOp', label: 'Letters', section: 'Lettering', value: 'engrave',
      options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'No cut-out option, since it would sever letters like A and O.',
    },
    {
      kind: 'number', key: 'letterBold', label: 'Boldness', section: 'Lettering', value: 0, min: -0.2, max: 0.6, step: 0.05, unit: 'mm',
      help: 'Grows or shrinks the engraved strokes without changing letter size.',
    },

    // ----------------------------------------------------------------- LEFT: "Hanging" --
    // The loop is grown from the FRAME, resting at top centre, and its size comes from the
    // ornament (below) — so the shared block keeps only the switch and the nudge pad.
    ...keyringFields('outside', { section: 'Hanging', dia: 4, ring: 5, side: 'top', along: 50, nudge: 70 }).map((f): Field => {
      if (f.key === 'holeDia' || f.key === 'holeRing') return { ...f, hidden: true };
      return f;
    }),
  ],

  async build(v) {
    const { names, warnings: wCount } = normaliseNames(lines(v, 'names'));
    const D = clamp(num(v, 'backerSize'), 40, 400);
    const savedShape = str(v, 'backer');
    const shape: Shape = savedShape === 'square' ? 'square' : 'round';
    const font = str(v, 'font');
    const symbols = readSymbols(v);
    const raised = str(v, 'lightOp') !== 'engrave';
    const margin = clamp(num(v, 'backerMargin'), 2, 15);

    const wShape: string[] = [];
    const wBand: string[] = [];
    const wUnplaced: string[] = [];
    const wLetterHard: string[] = [];
    const wLetterSoft: string[] = [];
    const wScript: string[] = [];

    if (savedShape && savedShape !== 'round' && savedShape !== 'square') {
      wShape.push(`The ${savedShape} shape is not one of these — using the round ornament.`);
    }
    const fontMeta = FONTS.find((f) => f.id === font);
    if (fontMeta && (fontMeta.category === 'Script' || fontMeta.category === 'Handwriting')) {
      wScript.push('Script faces do not read as letter tiles — a slab or a clean sans does.');
    }

    // ------------------------------------------------------------------ the loop, sized to it --
    // A Ø 100 ornament gets a 14 mm tab with a 4 mm hole; both scale with the ornament and both
    // are floored where the hardware is (a 3 mm ribbon hole, a 3 mm wall — §5.2 of the laser
    // reference). Nothing about the loop is a control any more: there is one right answer.
    const keyring = { ...keyringFrom(v), mode: 'outside' as const, dia: clamp(LOOP_HOLE * D, 3, 6), ring: clamp(LOOP_WALL * D, 3, 7) };

    // ------------------------------------------------------------------- the frame and its band --
    const rim = rimWidthFor(D);
    const familyName = str(v, 'familyName');
    const yearText = str(v, 'year');
    const wantBand = `${familyName}${yearText}`.trim() !== '';
    const innerShort = D - 2 * rim; // the window before the band bites, on both silhouettes
    const f = frameOf(shape, D, rim, wantBand ? clamp(BAND_DEPTH * D, 9, 0.45 * innerShort) : 0);
    const ratio = await capRatio(font);

    const bandFont = str(v, 'bandFont') || font;
    const band = wantBand
      ? await bandBlock(f, [{ text: familyName, rel: 1, font: bandFont }, { text: yearText, rel: 0.45, font }], { font, symbols }, await capRatio(bandFont))
      : null;
    // "Cap height ≥ 5 mm at Ø 100" — eased down to the 3 mm engraving floor on the smallest
    // ornaments, where no band can hold five millimetres of capital and a shorter name is the
    // only fix there is.
    const bandFloor = clamp(0.05 * D, 3, 5);
    if (band && band.cap < bandFloor) {
      wBand.push(`The family name engraves at ${fmt(band.cap)} mm — try a shorter name, or a bigger ornament.`);
    }

    const frameShapes: Shapes = [[f.outer, f.window]];
    const silhouette: Shapes = [[f.outer]];

    const parts: PartInput[] = [];
    const backerLayers: DesignLayer[] = [];

    // --------------------------------------------------------------------------- the crossword --
    const seed = Math.max(1, Math.round(num(v, 'layout')) || 1);
    // Nine interlocks of the same names — three shuffles × compact/wide/tall — and the one that
    // comes out BIGGEST inside this window wins. The old "Shape: Compact · Wide · Tall" control
    // asked the customer to solve that by eye, and there is only ever one right answer: a round
    // window is wider than it is tall once the band has taken its bottom, so a tall board shrinks
    // where a wide one does not, and a sparse board shrinks where a tight one does not. The step
    // owns its own three shuffles, so stepping really does change the board.
    const board = PREFERS
      .flatMap((prefer) => [3 * seed - 2, 3 * seed - 1, 3 * seed].map((s) => {
        const layout = layoutCrossword(names, { seed: s, prefer, tries: 120 });
        const cells = gridWithStrays(layout, names);
        return { ...cells, ...fitGrid(f, cells.cells, cells.cols, cells.rows, margin) };
      }))
      // Names interlocked first — a board that leaves ELSIE out has fewer cells and therefore
      // bigger tiles, so ranking on size alone quietly prefers dropping a name. Then the biggest
      // tile; then, within a per cent, the board whose shape is closest to the window's own —
      // otherwise a square window takes the first board that ties, which came out 56 % of its
      // width and 89 % of its height.
      .reduce((a, b) => {
        if (b.strays.length !== a.strays.length) return b.strays.length < a.strays.length ? b : a;
        if (b.tile > a.tile * 1.01) return b;
        return b.tile > a.tile * 0.99 && b.skew < a.skew ? b : a;
      });

    for (const s of board.strays) {
      wUnplaced.push(s.repeat
        ? `${s.word} is in the list twice — the second one sits under the grid.`
        : `${s.word} shares no letter with the others — it sits under the grid.`);
    }

    if (board.cells.length) {
      const { cols, rows, tile, cy: bestY } = board;
      const pitch = tile - WELD;
      const placed = board.cells.map((c) => ({
        x: (c.col - (cols - 1) / 2) * pitch,
        y: ((rows - 1) / 2 - c.row) * pitch + bestY,
        char: c.char,
      }));

      const look = tileLook(tile);
      const letterCap = clamp(num(v, 'letterScale'), 0.35, 0.65) * tile;
      if (letterCap < LETTER_HARD) wLetterHard.push(`The tiles are ${fmt(tile)} mm — the letters are too small to engrave cleanly.`);
      else if (letterCap < LETTER_SOFT) wLetterSoft.push(`Letters are ${fmt(letterCap)} mm — fewer or shorter names, or a bigger ornament, helps.`);

      const letterOp: 'engrave' | 'score' = str(v, 'letterOp') === 'score' ? 'score' : 'engrave';
      const edgeChoice = str(v, 'edgeOp');
      const tiled = await tileLayers(placed, {
        size: tile, corner: look.corner, weld: WELD,
        letterSize: letterCap / ratio, font, letterDy: look.letterDy, boldness: num(v, 'letterBold'),
        // The corner numerals, at a real tile's proportion — 0.34 × the letter's cap. They were
        // left off until 2026-09-26 on the grounds that a 1.4 mm digit is under the keychain's
        // 2.8 mm floor; with them at exactly this scale the piece reads as a word-game board,
        // without them as squares with letters in. A
        // raster engrave draws a 1.4 mm digit; what it cannot draw is one much under that, so
        // `VALUE_MIN_EM` drops them there and the build says so.
        values: v.values !== false,
        valueSize: look.valueRatio * letterCap / ratio,
        valueInset: look.valueInset,
        valueMinSize: VALUE_MIN_EM,
        border: edgeChoice === 'off' ? 0 : look.inset,
        symbols,
      }, { letter: letterOp, border: edgeChoice === 'engrave' ? 'engrave' : 'score' });
      if (tiled.valuesDropped) wLetterSoft.push('The tiles are too small for their letter values — they were left off.');

      if (raised) {
        // The glue guide is the tile piece's own outline. `keep` is the backer it has to stay
        // inside, and running the overlapping tile rings through that intersection is also what
        // welds them: one staircase scored on the dark sheet, not a lattice of squares.
        if (str(v, 'glue') !== 'none') {
          // Drawn GUIDE_INSET inside the tiles' own edge, so it can guide the gluing but is not
          // seen in the finished piece — on the line, the scorch shows past the tile.
          backerLayers.push({ id: 'glue', label: 'Glue guide', shapes: tiled.blank, op: 'score', grow: -GUIDE_INSET, keep: silhouette });
        }
        parts.push({
          id: 'tiles',
          label: 'Letter tiles · light sheet',
          // A close, not an offset: it leaves every convex edge where the tile drew it and turns
          // the sharp V where two tiles meet into a fillet, so a piece this small has no crack
          // starter and two tiles that only touch at a corner join instead of charring apart.
          blank: { kind: 'hug', margin: 0, smoothing: look.seamFillet, bridges: 'none' },
          bodyMembers: ['tiles'],
          layers: [{ owner: 'tiles', id: 'tiles', label: 'Tiles', shapes: tiled.blank, op: 'off', hugOnly: true }, ...tiled.layers],
          keyring: 'none',
          assembledAt: 'built',
          material: 'light',
        });
      } else {
        backerLayers.push(...tiled.layers);
      }
    }

    // ------------------------------------------------------------------------------ the pieces --
    parts.unshift({
      id: 'backer',
      label: 'Backer · dark sheet',
      blank: { kind: 'shape', shapes: silhouette },
      layers: backerLayers,
      // The loop runs through both sheets: the backer grows the same lug and hole at the same
      // local point, which is what registers the stack.
      keyring: 'shared',
      assembledAt: 'built',
      material: 'dark',
    });

    return {
      label: 'Frame · light sheet',
      material: 'light',
      blank: { kind: 'shape', shapes: frameShapes },
      layers: band ? band.layers : [],
      keyring,
      parts,
      layout: { flow: 'row', gap: 6 },
      status: `${parts.length + 1} pieces · dark backer, light frame${raised && parts.length > 1 ? ' and tiles' : ''}`,
      warnings: [...wUnplaced, ...wLetterHard, ...wLetterSoft, ...wBand, ...wCount, ...wShape, ...wScript],
    };
  },

  exportNote: (v) =>
    str(v, 'lightOp') === 'engrave'
      ? 'Cut the backer from dark wood and the frame from light — nothing to glue.'
      : 'Cut the backer from dark wood, the frame and tiles from light, then glue the tiles on.',

  fileName: (v) => stem(str(v, 'familyName') || lines(v, 'names')[0] || 'family', 'crossword'),
};
