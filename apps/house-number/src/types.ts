/**
 * Everything the generator is, as one object.
 *
 * The spec is `docs/briefs/house-number-spec.md`; this is that parameter table in code.
 * Keep them in step — the table is what the MakerWorld listing and the UI sections are
 * both written from.
 */

/** How the plate is cut. `none` drops the plate and emits the glyphs alone. */
export type PlateShape = 'rounded' | 'rect' | 'pill' | 'plaque' | 'none';

/** How the sign attaches to the wall. `tape` emits no geometry, only advice. */
export type MountKind = 'screws' | 'keyhole' | 'tape';

export type Align = 'left' | 'center' | 'right';

/** How the two lines sit against each other on a shared row. See `SignParams.vAlign`. */
export type VAlign = 'top' | 'middle' | 'bottom';

export type Orientation = 'horizontal' | 'vertical';

/**
 * Which side of the first line the second one goes on.
 *
 * `below` and `above` stack them. `left` and `right` put them on one row at their own sizes,
 * which is what a door plate usually wants — `12 MEETING ROOM`, the number large and the room
 * name small, on a single row. That is not the same as typing both into one field: a single
 * field can only have one type size.
 *
 * All four, not the two it shipped with. A sign is a rectangle and the second line can go on
 * any edge of the first; offering half of them meant a street name over the number, or a unit
 * letter before it, simply could not be typed. `beside` was the old name for `right`.
 */
export type LinePlacement = 'above' | 'below' | 'left' | 'right';

/**
 * True when the two lines share a row rather than stacking.
 *
 * The divider, the plateless bridge and the alignment controls all fork on this and not on
 * any one placement value — writing `=== 'right'` in four files is how `left` would quietly
 * get the stacked treatment in three of them.
 */
export const isSideBySide = (p: LinePlacement): boolean => p === 'left' || p === 'right';

/**
 * The same sign with `scale` folded into every in-plane dimension.
 *
 * Applied once at the seam where geometry is computed — the layout call, the worker payload
 * and the example cards — rather than being threaded through `buildSign`. That way everything
 * downstream of it, the plate solver, the warnings and the millimetre readouts, goes on
 * working in real millimetres and has no idea a size control exists.
 *
 * Listed out longhand on purpose. Which fields scale is a design decision per field, not a
 * pattern a loop over "everything measured in mm" could get right: `chamfer` and `bridgeWidth`
 * are millimetres and must NOT scale, because a bevel and a stencil tie are sized by the
 * nozzle rather than by the sign.
 */
export function atScale(p: SignParams): SignParams {
  const s = p.scale;
  if (!Number.isFinite(s) || Math.abs(s - 1) < 1e-6) return p;
  return {
    ...p,
    textSize: p.textSize * s,
    line2Size: p.line2Size * s,
    lineThickness: p.lineThickness * s,
    lineOverhang: p.lineOverhang * s,
    lineLength: p.lineLength * s,
    lineOffset: p.lineOffset * s,
    cornerRadius: p.cornerRadius * s,
    padding: p.padding * s,
    plateWidth: p.plateWidth * s,
    plateHeight: p.plateHeight * s,
    bandWidth: p.bandWidth * s,
    panelInset: p.panelInset * s,
    frameWidth: p.frameWidth * s,
    mountInset: p.mountInset * s,
    mountOffsetY: p.mountOffsetY * s,
  };
}

/**
 * What sits between the two text blocks.
 *
 * `line` is a bar. `band` sets the second line *inside* a filled bar, knocked out of it — the
 * "34 / DRYFESDALE VIEW" look. This replaces the old `lineOn` + `lineStyle` pair, which made
 * "what goes where" read as a property of the line — the reason "Text inside" ended up filed
 * under Line settings, where nobody would look for it.
 */
export type Divider = 'none' | 'line' | 'band';

/**
 * How the text meets the face it sits on.
 *
 * `inlay` is the one that matters and the one that was missing. `recessed` cuts the legend
 * into the plate and emits a single part — right for an engraved panel, and useless for a
 * house sign, which is fair comment. `inlay` cuts the same recess and then fills it with a
 * second body flush to the face, in the second filament: the two-colour flush finish, and the
 * reason the good listings print face-down.
 */
export type Relief = 'raised' | 'recessed' | 'inlay';

/** A contrasting strip along one edge of the plate — the "300" reference. */
export type BandEdge = 'none' | 'top' | 'bottom' | 'left' | 'right';

export interface SignParams {
  /* ── Text ── */
  /** Line 1. Not necessarily a number, which is why the label says "First line". */
  text: string;
  text2: string;
  /**
   * One multiplier over the whole sign's footprint. 1 = as designed.
   *
   * Every dimension that decides how big the sign is on the wall was individually adjustable
   * and nothing moved them together, so "the same sign, but bigger" meant dragging the type
   * size, the margin, the corner radius, the rule and the hole inset by hand and hoping the
   * proportions survived. A template is a set of proportions; this is the control that lets
   * you keep them.
   *
   * **In-plane only** — see `atScale` for exactly which fields ride it. Thickness, text depth
   * and the bevel are printing decisions with their own millimetre ranges, and a screw is
   * 4.5 mm whatever size the sign is; scaling those would turn a 3x sign into a 24 mm slab
   * that no longer fits its own screws.
   */
  scale: number;
  textSize: number;
  /** Independent of `textSize` — the single most-requested missing feature. */
  line2Size: number;
  linePlacement: LinePlacement;
  /** Stacked only: how the lines sit against each other, and — with a fixed plate width — on
   *  the plate. On one row both lines are placed by their own widths, so this has nothing to
   *  move; `vAlign` is the question that replaces it there. */
  align: Align;
  /**
   * Side-by-side only: whether the second line sits on the first's baseline, against its cap
   * height, or halfway up.
   *
   * `bottom` is the shared baseline the row is laid out on. Its own control rather than more
   * options on `align`, because the two axes are never both live: stacked, only `align` can
   * move anything; on one row, only this can.
   */
  vAlign: VAlign;
  /** Horizontal only: baseline gap as a fraction of the two sizes summed. */
  lineSpacing: number;
  /**
   * Vertical only: the character-to-character step, as a multiple of the cap height.
   *
   * Deliberately a second parameter rather than a reused `lineSpacing`. The two go into
   * different formulas — horizontally a fraction of *both sizes summed*, vertically a
   * multiplier on *one* character's step — so one number cannot serve both. Feeding the
   * horizontal 0.55 into the vertical layout stepped 28.6 mm for a 52.8 mm glyph, i.e. the
   * characters overlapped by 46% of their height, which is what "stacked is broken" meant.
   */
  stackSpacing: number;
  letterSpacing: number;
  orientation: Orientation;
  fontId: string;

  /* ── Divider ── */
  /**
   * A line between the two text blocks, welded into the text body.
   *
   * Part of the text solid rather than its own part, and that is the whole point: with no
   * plate, it is what holds the numerals and the street name together as one printable,
   * mountable piece. Every plateless sign in the reference set works this way.
   *
   * On a plate it is a design element instead, and the two want opposite behaviour — see
   * `lineContour`. There it keeps exactly the thickness asked for and floats clear of the
   * text; only the plateless case stretches it to bridge.
   */
  divider: Divider;
  lineThickness: number;
  /** How far it runs past the text at each end. 0 = exactly the block width. */
  lineOverhang: number;
  /** Explicit length in mm. 0 = size it from the text. */
  lineLength: number;
  /** Shifts it off the centre of the gap: +ve toward line 1, -ve toward line 2. */
  lineOffset: number;

  /* ── Plate ── */
  shape: PlateShape;
  cornerRadius: number;
  padding: number;
  /**
   * Explicit plate size in mm. `0` on either axis means "work it out from the text".
   *
   * Auto-sizing is right until it is not. A pill derives its width from its height — the cap
   * radius is half the short side — so a tall pill comes out very wide and no margin setting
   * can bring it in; the auto answer is the *only* answer it will give you. This is the escape
   * hatch, and it is also what makes a run of signs match: type the same numbers on each.
   *
   * Clamped up to whatever the text actually needs, so a size too small to hold the legend
   * grows rather than cropping it.
   */
  plateWidth: number;
  plateHeight: number;
  plateThickness: number;
  /** How far the text stands proud of the face, or how deep it is cut into it. */
  textThickness: number;
  relief: Relief;
  /**
   * Ties across an engraved counter, so the middle of an `0` cannot drop out.
   *
   * Not always wanted, and that is the point of the switch. Engraved straight into the plate
   * the legend is cut clean through, so the islands inside an `0` or an `8` are attached to
   * nothing and the ties are the only thing holding them — take them away and they fall out.
   * Engraved into an **inset panel** the plate behind is left whole, so each island lands on
   * it and prints fused to it: the ties are then two visible scars across a numeral, paying
   * for a problem that does not exist. Hence a setting rather than a rule, on by default and
   * off in the panel template.
   */
  bridgesOn: boolean;
  /** Width of the ties that hold a stencilled counter in place. */
  bridgeWidth: number;

  /* ── Plate detail ── */
  /** A contrasting strip along one edge, in its own filament. The "300" reference. */
  band: BandEdge;
  bandWidth: number;
  bandColor: string;
  /** A smaller board raised on the plate, in its own filament. The "6" reference. */
  panelOn: boolean;
  panelInset: number;
  panelHeight: number;
  panelColor: string;
  /** Raised border inset from the edge. Split from the old single `frame` width, which
   *  doubled as its own on/off switch and hid the fact that the height was never its own. */
  frameOn: boolean;
  frameWidth: number;
  frameHeight: number;
  /** Frame height tracks `textThickness`, which is what it always silently did. */
  frameFollowsText: boolean;
  chamfer: number;

  /* ── Mount ── */
  mount: MountKind;
  mountHoleDia: number;
  /** Four holes instead of two, for a wide plate that would otherwise rock. */
  mountFourHoles: boolean;
  /**
   * How far each hole sits in from the plate edge, in mm.
   *
   * Was derived from the margin, so on a pill — where the plate is much wider than the text
   * needs — the holes ended up pinned to the far ends with no way to bring them in.
   */
  mountInset: number;
  /**
   * Moves the fixings up or down the plate, in mm from the middle.
   *
   * Two screw holes were nailed to the horizontal centreline and keyhole slots to a fixed
   * height near the top, so on a tall sign there was no way to hang it from anywhere else —
   * and no way to move a slot off the back of the numeral it was cutting into. Positive is
   * up. Clamped against the real outline, so it can be dragged to the end without ever
   * biting the edge.
   */
  mountOffsetY: number;
  countersink: boolean;

  /* ── Colour ── */
  plateColor: string;
  textColor: string;
  /** The frame prints as its own body, so it can take a third filament. */
  frameColor: string;
}

export const DEFAULTS: SignParams = {
  text: '12',
  text2: '',
  scale: 1,
  textSize: 60,
  line2Size: 18,
  linePlacement: 'below',
  align: 'center',
  vAlign: 'bottom',
  lineSpacing: 0.55,
  stackSpacing: 1.15,
  letterSpacing: 0,
  orientation: 'horizontal',
  fontId: '',

  divider: 'none',
  lineThickness: 3,
  lineOverhang: 0,
  lineLength: 0,
  lineOffset: 0,
  relief: 'raised',
  bridgesOn: true,
  bridgeWidth: 1.6,

  band: 'none',
  bandWidth: 12,
  // Contrasting with the plate, not matching it. A band the same colour as the plate it is
  // cut from is invisible, which is a poor first impression of the feature.
  bandColor: '#f7f7f5',
  panelOn: false,
  panelInset: 10,
  panelHeight: 2,
  // Grey, not the wood brown it shipped with. The card drew the panel as a neutral board and
  // the model printed it brown, so the two templates disagreed about what the same feature is.
  panelColor: '#8c8c90',

  shape: 'rounded',
  cornerRadius: 6,
  padding: 12,
  plateWidth: 0,
  plateHeight: 0,
  plateThickness: 4,
  textThickness: 2,
  frameOn: false,
  frameWidth: 3,
  frameHeight: 2,
  frameFollowsText: true,
  chamfer: 0.4,

  mount: 'tape',
  mountHoleDia: 4.5,
  mountFourHoles: false,
  mountInset: 10,
  mountOffsetY: 0,
  countersink: true,

  plateColor: '#161616',
  textColor: '#f7f7f5',
  frameColor: '#f7f7f5',
};

/**
 * The MakerWorld arrange limit, in mm. Past this a sign has to be printed in pieces —
 * which people do, so it is a warning and never a clamp.
 */
export const MAX_PLATE_MM = 240;

/**
 * The strip of plate reserved at each end for screw holes, in mm. A **constant**.
 *
 * There has to be one: with no allowance the holes land on the text, and `nudgeClear` can only
 * push them as far as the plate goes. But it must not be a function of the fixings, and it was
 * `mountHoleDia * 2.5` — so dragging the screw diameter from 2 mm to 8 mm grew the plate by
 * 30 mm, and turning on four holes added the same strip to the height. The plate is sized from
 * the text; a wider screw is a wider screw, not a bigger sign.
 *
 * 11.25 mm is what the old expression gave at the shipped 4.5 mm screw, so every existing sign
 * comes out at exactly the size it did.
 */
export const SCREW_HOLE_ROOM_MM = 11.25;

/* ── Worker protocol ─────────────────────────────────────────────────────────── */

export interface PartMesh {
  name: string;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  colorRgb: [number, number, number];
}

/** One laid-out line's ink box, in the layout's own coordinates. */
export interface LineBox { minX: number; maxX: number; minY: number; maxY: number }

export type GeometryRequest =
  | { type: 'init' }
  // `textLines` rides along so the worker can place the rule between the two blocks without
  // re-running the layout, which needs the parsed font and therefore the main thread.
  | { type: 'build'; textContours: number[][][]; textLines: LineBox[]; params: SignParams };

export type GeometryResponse =
  | { type: 'ready' }
  | { type: 'parts'; parts: PartMesh[]; warnings: string[]; size: { width: number; height: number } }
  | { type: 'error'; message: string };
