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

export type Orientation = 'horizontal' | 'vertical';

/**
 * Where the second line goes relative to the first.
 *
 * `below` is a two-line sign. `beside` puts them on one line at their own sizes, which is
 * what a door plate usually wants — `12 MEETING ROOM`, the number large and the room name
 * small, on a single row. That is not the same as typing both into one field: a single field
 * can only have one type size.
 */
export type LinePlacement = 'below' | 'beside';

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
  textSize: number;
  /** Independent of `textSize` — the single most-requested missing feature. */
  line2Size: number;
  linePlacement: LinePlacement;
  /** How the lines sit against each other, and — with a fixed plate width — on the plate. */
  align: Align;
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
  textSize: 60,
  line2Size: 18,
  linePlacement: 'below',
  align: 'center',
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
  bridgeWidth: 1.6,

  band: 'none',
  bandWidth: 12,
  // Contrasting with the plate, not matching it. A band the same colour as the plate it is
  // cut from is invisible, which is a poor first impression of the feature.
  bandColor: '#f7f7f5',
  panelOn: false,
  panelInset: 10,
  panelHeight: 2,
  panelColor: '#7a5230',

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
