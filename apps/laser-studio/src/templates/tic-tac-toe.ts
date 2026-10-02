// Tic-tac-toe: a solid BASE square, a GRID of nine windows glued on top of it, and ten loose
// pieces — five X and five O — each cut from a symbol the customer picks.
//
// One slider does all the arithmetic. `size` decides the rim, the dividers, the corner radii,
// the cell and therefore every piece, so a 60 mm travel set and a 200 mm table set are the same
// design at two scales rather than one drawing stretched: the rim and the divider are
// proportions with structural floors (§2.1), never a fixed millimetre that goes thin at the
// small end and comical at the big one.
//
// The grid is one island with nine holes, which is exactly what `Shapes = CutRing[][]` already
// is — no union, no subtraction. The base carries a SCORE of those same nine rings: the glue
// guide is the window geometry itself, so the two layers can only line up (checklist #17).
//
// A piece is the symbol, not a picture of it. `symbolLayer` does NOT scale an icon so its ink's
// longest side is the size you asked for — 27 mm of "Close" came back 18.4 mm wide — so every
// symbol is built once at a reference size and re-fitted with `fitShapes`, which does. A symbol
// too thin to survive being lifted loose falls back to an engraved disc, on its own, with a note.

import { bboxOf, circleRing, placeShapes, roundedRectRing, signedArea, type Shapes } from '@vostok/laser';
import { iconByChar, iconById } from '@vostok/fonts';
import { applyCase, fitShapes, symbolLayer, textLayer, type TextSpec } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { readSymbols } from '../symbols/model';
import { letteringFields, stem } from './shared';
import { num, str, type TemplateDef, type Values } from './types';
import type { Blank, DesignLayer, KeyringSpec, PartInput } from '../engine/types';

/** How far inside the piece it traces a glue guide is scored, mm — the line has to vanish under
 *  the piece it registers, never show as a halo round it. */
const GUIDE_INSET = 0.3;
/** A diagonal cross that reads as an X. Written as an id, not the private-use character it
 *  resolves to: the literal renders as nothing in an editor or a diff, so a default that changed
 *  by accident would look like no change at all. */
const X_DEFAULT = iconById('close')?.char ?? '';
/** A complete ring band that reads as an O — built and looked at, not assumed. In the bundled
 *  Material Symbols Rounded at FILL=1 the obvious names are all wrong: "Circle" and "Panorama
 *  fish eye" are solid discs, "Donut large"/"Donut small"/"Data usage" are donut CHARTS with a
 *  gap that reads as a C, "Toll" is two overlapping coins and "Adjust" is a target with a centre
 *  dot. "Trip origin" is the one that cuts as a clean washer. */
const O_DEFAULT = iconById('trip_origin')?.char ?? '';

/** The size every symbol is traced at before `fitShapes` brings it to the piece. Big enough that
 *  scaling down never shows the polygonisation. */
const SYMBOL_REF = 100;
/** A window's inner corner. Fixed millimetres, not a proportion: 1.5 clears the ≥ 0.5 mm
 *  inner-fillet floor several times over at every board size without softening the grid. */
const WINDOW_CORNER = 1.5;
/** The material a Silhouette piece keeps round the symbol's own edge, and the corners it rounds
 *  off while doing it. Small: the piece IS the artwork. */
const HUG_MARGIN = 0.6;
const HUG_SMOOTH = 0.5;
/** A piece's own clearance inside its cell, per side once centred (§2.5). */
const CLEARANCE = 3;
/** Below this share of its own bounding box a symbol is mostly thin line at piece size and will
 *  not survive being lifted: it becomes an engraved disc instead (§2.4). */
const MIN_COVERAGE = 0.2;
/** A token's symbol is 70 % of the token — measured as the longest side on a tile and as the
 *  bounding CIRCLE on a disc, so both leave the same 15 % ring of bare material (§2.4). */
const INK_SHARE = 0.7;
/** The smallest capital this design will print on the rim. Under 3 mm no weight of any face
 *  survives the burn. */
const MIN_CAP = 3;
/** Under this board size the cells are small enough to say so. */
const FIDDLY_BOARD = 90;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** This design sits on a table; nothing hangs. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'inside', side: 'bottom', along: 0.5, dia: 5, ring: 2.5, position: -1 });

/** A number the way a person writes it. */
const mm = (x: number) => String(Math.round(x * 10) / 10);

/** The board's arithmetic (§2.1). Everything below the slider is computed from it, so the two
 *  borders keep their hierarchy — rim ~1.6× divider — at every size the slider reaches. */
interface Board {
  size: number;
  corner: number;
  rim: number;
  divider: number;
  cell: number;
  /** Centre-to-centre spacing of adjacent cells. */
  pitch: number;
  /** The "fits" ceiling every piece style shares. */
  pieceMax: number;
}

function boardOf(size: number): Board {
  const s = clamp(size, 60, 200);
  const rim = clamp(0.08 * s, 6, 18);
  const divider = clamp(0.045 * s, 4, 10);
  const cell = (s - 2 * rim - 2 * divider) / 3;
  return { size: s, corner: 0.06 * s, rim, divider, cell, pitch: cell + divider, pieceMax: cell - CLEARANCE };
}

/** The nine windows, each its own island — the grid's holes, and the base's glue guide. */
function windowRings(b: Board): Shapes {
  const out: Shapes = [];
  for (const row of [1, 0, -1]) {
    for (const col of [-1, 0, 1]) {
      out.push(...placeShapes([[roundedRectRing(b.cell, b.cell, WINDOW_CORNER)]], col * b.pitch, row * b.pitch, 0));
    }
  }
  return out;
}

/** Filled ink: every island's outer ring less its holes. The thinness check compares this with
 *  the symbol's own bounding box, and both numbers are already exported (`signedArea`, `bboxOf`)
 *  — there is no new engine call behind the fallback. */
function inkArea(shapes: Shapes): number {
  let total = 0;
  for (const island of shapes) {
    const areas = island.map((r) => Math.abs(signedArea(r)));
    if (!areas.length) continue;
    let outer = 0;
    for (let i = 1; i < areas.length; i++) if (areas[i]! > areas[outer]!) outer = i;
    for (let i = 0; i < areas.length; i++) total += i === outer ? areas[i]! : -areas[i]!;
  }
  return total;
}

/** How much of its own box a symbol actually fills — scale-free, so it is measured once on the
 *  reference tracing and holds at every board size. */
function coverageOf(shapes: Shapes): number {
  if (!shapes.length) return 0;
  const b = bboxOf(shapes);
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  return area > 1e-6 ? inkArea(shapes) / area : 0;
}

type PieceStyle = 'silhouette' | 'disc' | 'tile';

/** One piece: the blank the laser cuts and whatever is burnt on it. */
function pieceBuild(style: PieceStyle, symbol: Shapes, b: Board, thickness: number): { blank: Blank; layers: DesignLayer[] } {
  if (style === 'silhouette') {
    // The hug adds `margin` all round, so the symbol is fitted to the piece MINUS that border:
    // the finished piece measures `pieceMax`, which is the number the cell was sized for.
    const ink = fitShapes(symbol, Math.max(1, b.pieceMax - 2 * HUG_MARGIN));
    return {
      blank: {
        kind: 'hug', margin: HUG_MARGIN, smoothing: HUG_SMOOTH,
        // Welds any parts of the symbol that do not already touch into ONE piece — a
        // connectivity problem, which is what `bridge` is for, not a thinness one.
        bridge: Math.max(1.5, thickness),
        // A ring cuts as an actual washer, not a disc: the symbol's own enclosed holes stay open.
        counters: 'open', minHole: 1.2,
      },
      layers: [{ id: 'ink', label: 'Symbol', shapes: ink, op: 'off', hugOnly: true }],
    };
  }
  const box = bboxOf(symbol);
  const w = Math.max(box.maxX - box.minX, 1e-6);
  const h = Math.max(box.maxY - box.minY, 1e-6);
  // On a disc the corner of a square symbol is what reaches the rim first, so the share is taken
  // off the symbol's own diagonal; on a tile the edge is straight and the longest side is right.
  const size = style === 'disc'
    ? (INK_SHARE * b.pieceMax * Math.max(w, h)) / Math.hypot(w, h)
    : INK_SHARE * b.pieceMax;
  const ring = style === 'disc'
    ? circleRing(0, 0, b.pieceMax / 2, 64)
    : roundedRectRing(b.pieceMax, b.pieceMax, 0.1 * b.pieceMax);
  return {
    blank: { kind: 'shape', shapes: [[ring]], oneIsland: true },
    layers: [{ id: 'ink', label: 'Symbol', shapes: fitShapes(symbol, Math.max(0.5, size)), op: 'engrave' }],
  };
}

/** Lettering fitted to one band of the rim.
 *
 *  Built at the band's own cap height, scaled down by width if it is too long, and never MOVED.
 *  `fitText`'s search is the wrong tool on this face: the only clear material is the rim, and the
 *  candidates it sweeps would happily land a title in the middle of a window. The band is a
 *  known rectangle, so the fit is a ratio. */
async function bandText(
  spec: TextSpec,
  band: { x: number; y: number; w: number; h: number },
  minSize: number,
  id: string,
  label: string,
): Promise<{ layers: DesignLayer[]; floored: boolean }> {
  const built = await textLayer({ ...spec, x: 0, y: 0 }, 'engrave', id, label);
  const first = built[0];
  if (!first) return { layers: [], floored: false };
  const b = bboxOf(first.shapes);
  const want = Math.min(1, band.w / Math.max(b.maxX - b.minX, 1e-6), band.h / Math.max(b.maxY - b.minY, 1e-6));
  const floor = Math.min(1, minSize / Math.max(spec.size, 1e-6));
  const k = Math.max(want, floor);
  const at = k >= 0.999 ? built : await textLayer({ ...spec, size: spec.size * k, x: 0, y: 0 }, 'engrave', id, label);
  return {
    layers: at.map((l) => ({ ...l, shapes: placeShapes(l.shapes, band.x, band.y, 0) })),
    floored: want < floor - 1e-6,
  };
}

/** What the customer called this symbol — the icon's own name, or the name the import wizard
 *  saved their drawing under. */
function symbolName(v: Values, char: string, fallback: string): string {
  return readSymbols(v)[char]?.label || iconByChar(char)?.label || fallback;
}

export const ticTacToe: TemplateDef = {
  id: 'tic-tac-toe',
  name: 'Tic-tac-toe',
  blurb: 'A two-layer board with a windowed grid, and ten pieces cut from any two symbols you pick.',
  // Job order, which is the order the laser runs them in: the glue guide is scored, then every
  // outline is cut. The default board engraves nothing — the rim is empty until someone types.
  tags: ['games', 'score + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'symbol', key: 'xSymbol', label: 'X symbol', panel: 'right', section: 'Symbols', value: X_DEFAULT,
      help: 'Becomes all five X pieces.',
    },
    {
      kind: 'symbol', key: 'oSymbol', label: 'O symbol', panel: 'right', section: 'Symbols', value: O_DEFAULT,
      help: 'Becomes all five O pieces.',
    },
    {
      kind: 'text', key: 'xName', label: 'X player', panel: 'right', section: 'Rim', value: '',
      placeholder: 'e.g. Ava', maxLength: 16,
      help: 'Engraved bottom-left of the rim.',
    },
    {
      kind: 'text', key: 'oName', label: 'O player', panel: 'right', section: 'Rim', value: '',
      placeholder: 'e.g. Noah', maxLength: 16,
      help: 'Engraved bottom-right of the rim, mirroring X player.',
    },
    {
      kind: 'text', key: 'title', label: 'Title', panel: 'right', section: 'Rim', value: '',
      placeholder: 'e.g. Family Game Night', maxLength: 28,
      help: 'Engraved along the top rim, centred.',
    },
    {
      // Faces built through the harness on this board's own rim before they went on the list:
      // a round, even sans holds up at the 5 mm capitals a 9.6 mm rim allows, where a thin or a
      // high-contrast face loses its hairlines to the burn at that height.
      kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'fredoka',
      recommended: ['fredoka', 'baloo-2', 'quicksand', 'comfortaa', 'nunito', 'chewy', 'luckiest-guy', 'paytone-one'],
    },

    // -------------------------------------------------- LEFT: "Board" (opens first) --
    {
      kind: 'number', key: 'size', label: 'Board size', section: 'Board',
      value: 120, min: 60, max: 200, step: 5, unit: 'mm',
      help: 'The rim, dividers and every piece size themselves from this number.',
    },
    {
      kind: 'select', key: 'pieceStyle', label: 'Piece style', section: 'Board', value: 'silhouette',
      options: [
        { value: 'silhouette', label: 'Silhouette' },
        { value: 'disc', label: 'On a disc' },
        { value: 'tile', label: 'On a tile' },
      ],
      help: 'Silhouette cuts the symbol shape itself, others engrave it on a token.',
    },
    {
      kind: 'number', key: 'thickness', label: 'Material thickness', section: 'Board', advanced: true,
      value: 3, min: 2, max: 6, step: 0.5, unit: 'mm',
      help: 'Sets how wide a bridge needs to hold a symbol together.',
    },
    {
      kind: 'select', key: 'glueGuide', label: 'Glue guide', section: 'Board', advanced: true, value: 'score',
      options: [{ value: 'score', label: 'Score' }, { value: 'none', label: 'None' }],
      help: 'Scores the base so the two layers line up when glued.',
    },

    // ------------------------------------------------------- LEFT: "Rim lettering" --
    ...letteringFields('Rim lettering'),
  ],

  async build(v) {
    const b = boardOf(num(v, 'size'));
    const thickness = clamp(num(v, 'thickness') || 3, 1, 12);
    const asked = (str(v, 'pieceStyle') || 'silhouette') as PieceStyle;
    const symbols = readSymbols(v);
    const warnings: string[] = [];

    // A cleared symbol field is not a decorative accent that can simply be absent — it is five
    // pieces of the set. Whichever is empty falls back to its own default rather than shipping
    // five blank tokens (§5).
    const xChar = str(v, 'xSymbol') || X_DEFAULT;
    const oChar = str(v, 'oSymbol') || O_DEFAULT;

    // Traced once at a reference size; every use is `fitShapes` from here, because `symbolLayer`
    // fits the EM, not the ink.
    const trace = async (char: string): Promise<Shapes> => {
      const built = await symbolLayer(char, SYMBOL_REF, 'off', { symbols });
      return built.flatMap((l) => l.shapes);
    };
    // A symbol that traces to NOTHING — a character no bundled face draws, a pasted "★" — gets
    // the same fallback as an empty field, and says so. Before, it shipped five empty parts: the
    // sheet laid out ten labelled slots and cut two pieces' worth of air (2026-09-26 audit).
    const traceOr = async (char: string, fallback: string, who: string): Promise<Shapes> => {
      const ink = await trace(char);
      if (ink.length || char === fallback) return ink;
      warnings.push(`${who} has no shape to cut — using the default instead.`);
      return trace(fallback);
    };
    const [xInk, oInk] = await Promise.all([traceOr(xChar, X_DEFAULT, 'The X symbol'), traceOr(oChar, O_DEFAULT, 'The O symbol')]);

    // The thinness check, per symbol. A silhouette of thin line art snaps the moment it is lifted
    // off the bed, so that symbol alone becomes a disc; the other player's style is untouched.
    const styleFor = (ink: Shapes, char: string, fallbackName: string): PieceStyle => {
      if (asked !== 'silhouette' || !ink.length) return asked;
      if (coverageOf(ink) >= MIN_COVERAGE) return 'silhouette';
      warnings.push(`${symbolName(v, char, fallbackName)} is too fine a line to cut as a loose piece — shown on a disc instead.`);
      return 'disc';
    };
    const xStyle = styleFor(xInk, xChar, 'The X symbol');
    const oStyle = styleFor(oInk, oChar, 'The O symbol');

    // ------------------------------------------------------------------ the two layers --

    const outer = (): Shapes => [[roundedRectRing(b.size, b.size, b.corner)]];
    const windows = windowRings(b);
    // One island, nine holes. `oneIsland` is the promise the design makes out loud: a board that
    // came off the bed in two pieces would be a bug, not a variation.
    const gridBlank: Blank = { kind: 'shape', shapes: [[outer()[0]![0]!, ...windows.map((isl) => isl[0]!)]], oneIsland: true };

    // ------------------------------------------------------------------ the rim lettering --

    const textCase = str(v, 'textCase');
    const font = str(v, 'font');
    const tracking = num(v, 'letterSpacing') / 100;
    const cap = 0.55 * b.rim;
    const em = await sizeForCapHeight(font, cap);
    const minEm = await sizeForCapHeight(font, Math.min(cap, MIN_CAP));
    const pad = Math.max(1.2, 0.1 * b.rim);
    // The band never runs into the rounded corners, and the top rim's own edge sits a whole
    // divider clear of the window block, so a width fit is all this face ever needs (§2.6).
    const bandY = b.size / 2 - b.rim / 2;
    const bandW = b.size - 2 * (b.corner + pad);
    const bandH = b.rim - 2 * pad;
    const gap = b.rim;
    const halfW = (bandW - gap) / 2;
    const halfX = gap / 2 + halfW / 2;

    const rim: DesignLayer[] = [];
    const setLine = async (key: string, band: { x: number; y: number; w: number; h: number }, id: string, label: string, size = em) => {
      const text = applyCase(str(v, key), textCase).trim();
      if (!text || band.w <= 1 || band.h <= 1) return;
      const spec: TextSpec = { symbols, text, font, size, letterSpacing: tracking, align: 'center' };
      const got = await bandText(spec, band, minEm, id, label);
      rim.push(...got.layers);
      if (got.floored) warnings.push(`${label} is longer than the rim can hold at a readable size — shorten it, or use a bigger board.`);
    };
    await setLine('title', { x: 0, y: bandY, w: bandW, h: bandH }, 'title', 'Title');
    // The two player names are one pair and share ONE size: fitted each to its own half, "Jo"
    // stood at full rim height beside "Maximilian Alexander" squeezed to half of it, which reads
    // as a mistake on a board meant to be even-handed (2026-09-26 audit). Each is measured, the
    // smaller scale wins, and both are set at it — never under the readable floor.
    const pairScale = async (key: string): Promise<number> => {
      const text = applyCase(str(v, key), textCase).trim();
      if (!text) return 1;
      const probe = (await textLayer({ symbols, text, font, size: em, letterSpacing: tracking, x: 0, y: 0 }, 'engrave', 'probe', 'probe'))[0];
      if (!probe) return 1;
      const pb = bboxOf(probe.shapes);
      return Math.min(1, halfW / Math.max(pb.maxX - pb.minX, 1e-6), bandH / Math.max(pb.maxY - pb.minY, 1e-6));
    };
    const pairEm = Math.max(minEm, em * Math.min(await pairScale('xName'), await pairScale('oName')));
    await setLine('xName', { x: -halfX, y: -bandY, w: halfW, h: bandH }, 'x-name', 'X player', pairEm);
    await setLine('oName', { x: halfX, y: -bandY, w: halfW, h: bandH }, 'o-name', 'O player', pairEm);

    // ------------------------------------------------------------------------ the pieces --

    // Two corner cells hold a piece each, so the card reads as a game in progress; the other
    // eight sit in two rows under the board — one row of X, one of O. A single row of eight
    // would be 217 mm wide against a 120 mm board, and the card would read as a strip with a
    // board on the end of it.
    const spare = b.pieceMax + 4;
    const spareY = -(b.size / 2 + 6 + b.pieceMax / 2);
    const spot = (index: number, row: number, corner: { x: number; y: number }): { x: number; y: number } =>
      index === 0 ? corner : { x: (index - 2.5) * spare, y: spareY - row * spare };

    const parts: PartInput[] = [
      {
        id: 'grid',
        label: 'Grid',
        blank: gridBlank,
        layers: rim,
        keyring: 'none',
        assembledAt: { x: 0, y: 0 },
        material: 'light',
      },
    ];
    const addPieces = (prefix: string, label: string, ink: Shapes, style: PieceStyle, corner: { x: number; y: number }, row: number) => {
      const built = pieceBuild(style, ink, b, thickness);
      for (let i = 0; i < 5; i++) {
        parts.push({
          id: `${prefix}-${i + 1}`,
          label,
          blank: built.blank,
          layers: built.layers.map((l) => ({ ...l, id: `${prefix}${i + 1}-${l.id}` })),
          keyring: 'none',
          assembledAt: spot(i, row, corner),
          material: 'light',
        });
      }
    };
    addPieces('x', 'X', xInk, xStyle, { x: -b.pitch, y: b.pitch }, 0);
    addPieces('o', 'O', oInk, oStyle, { x: b.pitch, y: -b.pitch }, 1);

    // ------------------------------------------------------------------------ the notes --

    if (b.size < FIDDLY_BOARD) {
      warnings.push(`Cells are about ${mm(b.cell)} mm — fine for display, fiddly for small hands. 90 mm or larger plays easier.`);
    }
    if (thickness < 2.5 && b.divider <= 4 + 1e-9) {
      warnings.push("The grid's dividers are thin at this stock and size — handle that layer gently until it's glued, or use 3 mm+ material.");
    }

    return {
      label: 'Base',
      material: 'dark',
      blank: { kind: 'shape', shapes: outer(), oneIsland: true },
      keyring: noRing(),
      // The glue guide IS the window geometry, traced on the piece the grid lands on — a
      // registration mark that cannot drift from what it registers (checklist #17).
      // Drawn GUIDE_INSET inside the window's own edge so the line hides under the piece that
      // lands on it (a guide that can be seen in the finished piece is a flaw).
      layers: str(v, 'glueGuide') === 'score'
        ? [{ id: 'guide', label: 'Glue guide', shapes: windows, op: 'score', grow: -GUIDE_INSET }]
        : [],
      parts,
      layout: { flow: 'wrap', gap: 5, maxWidth: 300 },
      status: '2 layers · 10 pieces',
      ...(warnings.length ? { warnings } : {}),
    };
  },

  exportNote: (v) =>
    str(v, 'glueGuide') === 'score'
      ? 'Glue the grid to the base along the scored lines, then cut the pieces from a contrasting sheet.'
      : 'Glue the grid to the base, lining the windows with the edges, then cut the pieces from a contrasting sheet.',

  fileName: (v) => stem(str(v, 'title') || [str(v, 'xName'), str(v, 'oName')].filter(Boolean).join('-and-') || 'tic-tac-toe', 'board'),
};
