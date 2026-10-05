// The engine's vocabulary: what a template hands the worker, and what comes back to draw and
// to export.
import type { Keyring, Op, Pt, Shapes, Box } from '@vostok/laser';
import type { CutImage } from '@vostok/export';
import type { LatticeSpec } from '@vostok/patterns/lattice';

export type OpChoice = Op | 'off';

/** One design layer, placed in mm: text outlines, a symbol, a blank's silhouette, a picture. */
export interface DesignLayer {
  owner?: string;
  id: string;
  label: string;
  shapes: Shapes;
  op: OpChoice;
  /** Offset the outline by this many mm before use (text boldness). */
  grow?: number;
  hex?: string;
  /** Shapes the hugging body but is never lasered itself. Pair it with `op: 'off'`. */
  hugOnly?: boolean;
  /** A raster engrave: pixels and the box they fill, part frame, Y up. */
  image?: CutImage;
  /** Keep only what lies inside these shapes (an intersect), before anything else — a big
   *  letter kept to the two bands of a split monogram. */
  keep?: Shapes;
  /** Remove these shapes from the layer (a subtract), before anything else. */
  minus?: Shapes;
  /** Union the layer's shapes and fill every hole first — a puzzle piece's letter with no
   *  counter, even when the font draws the "A" as a lambda plus a loose crossbar. */
  solid?: boolean;
  /** With `op: 'score'`: score the SEAMS of a welded word, not the letters. The layer's shapes
   *  are the letters in reading order, and what is scored is the run of each letter's outline
   *  that a LATER LETTER covers — one clean line per junction, nothing along the cut, and
   *  nothing at all where the letters do not overlap (G32). */
  seams?: boolean;
  /** How many of `shapes`' islands each character owns, in reading order — the only thing that
   *  says where one letter ends and the next begins (W3). A glyph is NOT one island: a
   *  stroke-built face draws Fredoka's H as three and Baloo's E as five, and without this the
   *  seam clip took each stroke for a letter and scored the junctions INSIDE a glyph — two lines
   *  across the H's crossbar. Absent (or out of step with `shapes`): one island is one glyph,
   *  exactly as before. Set by `textLayer` / `connectedLayer`. */
  glyphIslands?: number[];
  /** With `op: 'cut'`: leave stencil bridges so the counters of o, a, e and B stay attached
   *  instead of falling out of the bed. On by default for any cut layer;
   *  `false` turns it off, `{ bridge }` sets the bar's width in mm (default 1.5). */
  stencil?: boolean | { bridge?: number };
  /** What this layer IS, for the engine's rules that only apply to some of them. The one that
   *  reads it today is G16: "The ring sits on the lettering" is about LETTERING, and testing it
   *  against every mark on the piece meant a hole near a border rule or a frame's inset line
   *  warned with no letter anywhere near it (qr-stand's tag had to drop its hole to escape it).
   *
   *  Set by `textLayer` / `arcTextLayer` / `stackedText` (`text`), `symbolLayer` (`symbol`) and
   *  `blankDetailLayers` (`detail`). Absent means "not lettering", so a template that builds a
   *  DesignLayer by hand opts INTO the net rather than out of it. */
  /** What this layer IS, where the engine has to treat one differently from another.
   *
   *  `fill` is a pattern that covers the piece: it is MEANT to reach the edge, so the engine's
   *  "ran past the edge" warning — which exists for a name coming out "RINCESS BUTTERC" — does
   *  not apply to it. Everything else about the clip is unchanged; only the complaint is
   *  dropped. */
  kind?: 'text' | 'symbol' | 'rule' | 'detail' | 'guide' | 'fill';
  /** OPEN polylines beside `shapes` — the lines of a pattern fill, a hinge's slits, a jigsaw's
   *  seams. A score layer clips them to the part (inset) and hands them on as open runs; a cut
   *  layer clips them to the part EXACTLY, so a seam ends on the outline, and cuts each once —
   *  the status line counts the pieces they make. An engrave layer ignores them (a fill has no
   *  line to fill). */
  paths?: Pt[][];
  /** With `op: 'cut'`: a pattern cut as a LATTICE — its lines kept as struts, the faces between
   *  them cut out. `shapes` is the region the pattern fills, `minus` the solids it keeps (a
   *  hub, a keep-out box: material the struts may land on), and `lattice.runs` the pattern's
   *  lines; the engine runs @vostok/patterns' `latticeFaces` on them (dead ends pruned, struts
   *  built, the region shrunk by `inset` less the solids and struts, the rules), replaces
   *  `shapes` with the faces and writes what it did into `stats`. Moving one? Move `shapes`,
   *  `minus` and `lattice.runs` together. Never built by hand: `fillLayers` / `patternLayers` in
   *  templates/pattern-shared.ts make it. */
  lattice?: LatticeSpec;
  /** With `op: 'score'`: a pattern's closed shapes, scored as the outline of what they paint
   *  (`PatternOutline`), beside the layer's own `shapes` and `paths`. Made by `fillLayers`. */
  outline?: PatternOutline;
  /** With `op: 'engrave'`: what the shapes paint, gaps under `seal` mm closed, is eroded by `by` mm
   *  before it is burnt — a pattern whose lines between shapes are drawn thicker than its tile's
   *  (@vostok/patterns' `PatternDef.erode`). Made by `fillLayers`. */
  erode?: { seal: number; by: number };
}

/**
 * A pattern's closed shapes scored as what they PAINT: the outline of their union — the region
 * Engrave burns, and the one colour the picker's card paints them in (2026-09-29). Never
 * each shape's own outline: that burns a line through the paint wherever two shapes overlap
 * (Plus - 5's crosses were two bars each), and twice or not at all where a tile lays a motif down
 * twice (Circles & Diamonds). The worker unions `shapes`, closes gaps under `seal` mm (a tile's
 * copies of one edge are written a last decimal apart), erodes by `erode` mm, and clips what is
 * left AS LINES to `zone`, the pattern's region less its margin. `length` is what that scored,
 * mm, for the status line (`OUTLINE_STATUS`).
 */
export interface PatternOutline {
  shapes: Shapes;
  zone: Shapes;
  seal: number;
  erode: number;
  length?: number;
}

/** What a scored pattern of shapes says in its status until the worker has traced it: the worker
 *  swaps it for the length it scored ("2551 mm of line"). */
export const OUTLINE_STATUS = 'scored round its shapes';

export type KeyringSpec = Keyring & {
  enabled: boolean;
  /** Fraction around the outline, 0..1; -1 means place by side + along. */
  position: number;
  /** A free nudge of the hole, mm, after everything else. */
  dx?: number;
  dy?: number;
  /** Where the ring rests before any nudge, in the part's frame. A template that knows the
   *  natural hanging point (a carrot hangs from its leaves) sets it; absent, the outline's edge
   *  and `side`/`along`/`position` decide. */
  rest?: [number, number];
  /** A loop tab that RESTS inside the part: `side`/`along`/`position` read the inward track (the
   *  one a punched hole rode) instead of the outward one, so the tab sits where the hole used to,
   *  its border inside the edge. Only the resting point moves — the tab is still `'outside'`, free
   *  to be dragged anywhere and welded on wherever it lands (2026-09-28). */
  restInside?: boolean;
};

/** The sheet a batch is cut from. Present, it paginates a `wrap` layout: rows that would run
 *  off the page start a new page laid to the right, and the preview draws each page's guide. */
export interface SheetSpec {
  width: number;
  height: number;
  /** Air between the page edge and the first piece, mm. Default 5. */
  margin?: number;
  /** Air between pages on the preview, mm. Default 10. */
  gutter?: number;
  label?: string;
  /** One material per page: a sheet IS one material, so a run of two-colour pieces is laid out
   *  a colour at a time — the primary's material first, then the others in the order they first
   *  appear — and a change of material starts a fresh page. Only where the pieces are PLACED
   *  changes; they are built, and listed in the output, in input order. */
  byMaterial?: boolean;
}

export type Blank =
  | { kind: 'none' }
  /** A body the template built. Overlapping outer rings in separate islands union. `solid`
   *  fills every hole after the union — a loose puzzle letter with no counter to fall out.
   *  `oneIsland` says the design is meant to weld into a single piece, so the engine reports
   *  the real count when it does not (a row of loose letters or a nest of cards sets nothing). */
  | { kind: 'shape'; shapes: Shapes; solid?: boolean; oneIsland?: boolean }
  /** A frame: the silhouette minus itself inset by `rimWidth` — a ring. A TRUE offset, so the
   *  rim keeps its width all the way round a concave outline (a bone's waist, a house's eaves)
   *  where a scaled-down copy of the outline would run thick on the bulges and thin at the
   *  notches. `smoothing` rounds the rim's INNER corners only, the outer edge staying exactly
   *  what the silhouette drew; default 0.35 × `rimWidth`. */
  | { kind: 'rim'; outer: Shapes; rimWidth: number; smoothing?: number }
  /** An outline that follows the layers. `bridge` is the minimum width of the automatic
   *  bridges that join separate pieces (letters that do not touch), mm; default max(1, margin).
   *
   *  `margin: 0, smoothing: 0` means the layers' own union, bridged, with no offset pass at all
   *  — the piece IS the letters, cut on the glyph outlines (G31). Any other margin grows the
   *  union into a border round it. */
  | {
      kind: 'hug'; margin: number; smoothing: number; bridge?: number;
      /** Which separate pieces the automatic bridges join — the customer's "Connect".
       *  `all` (default) joins everything until the piece is one island; `dots` joins only the
       *  small pieces that can never be welded (an i's tittle, an inline symbol's pip) and
       *  leaves whole letters where the font put them; `none` adds no bars at all. */
      bridges?: 'all' | 'dots' | 'none';
      /** Whether the letters' counters (the inside of an "o") stay open as holes in the piece.
       *  Default: `open` when the outline IS the lettering (every attached layer is `hugOnly`
       *  or `cut`), `filled` when it is a backdrop for engraved or scored letters. */
      counters?: 'open' | 'filled';
      /** With open counters, a hole narrower than this (its box's short side, mm) is filled —
       *  a speck between two letters is not a counter. Default 1.2. */
      minHole?: number;
    };

/**
 * Where a piece sits once the product is put together, in three dimensions — what the 3D view
 * draws. Millimetres, Z up, the table at z = 0. `x`/`y`/`z` place the piece's CENTRE: the centre
 * of its outline's box in X and Y and the middle of its thickness in Z. `rx`/`ry`/`rz` turn it
 * about that centre, in degrees, about the WORLD axes and in that order: X first (a plate
 * standing up is `rx: 90`; leaning back by θ is `rx: 90 − θ`), then Y, then Z (a standing plate
 * turned to run front-to-back is `rx: 90, rz: 90`).
 *
 * A flat stack needs none of this: `assembledAt` + `z` already say where each layer lies and the
 * view stacks them by the material thickness. A stand says how its plate leans and how its feet
 * stand, because nothing else can.
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

/** One more piece beside the primary one: a backer layer, a stand's base, a tile, a place card. */
export interface PartInput {
  id: string;
  /** Shown under the piece on the preview. */
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  /** `shared`: punch another piece's keyring (hole and lug) at the same local coordinates —
   *  registration for stacked layers. A `KeyringSpec` instead gives this piece its OWN keyring,
   *  placed on its own outline exactly as the primary's is — what a batch's copies carry.
   *  Default: no keyring. */
  keyring?: 'shared' | 'none' | KeyringSpec;
  /** For `shared`: the id of the piece whose hole and anchor to copy. Default the primary.
   *  Pieces build in order, so the piece named must come earlier in `parts`. */
  registerTo?: string;
  /** Which layer owners this piece's body wraps / clips / cuts out of, like the primary's. */
  bodyMembers?: string[];
  /** Explicit placement in the primary's frame, mm. Absent = auto-placed by `layout`. */
  at?: { x: number; y: number };
  /** Where this piece's CENTRE sits in the primary's frame once the design is glued up — a
   *  backer under its frame at (0, 0), a name band low on the backer. The preview's Assembled
   *  view and the gallery card draw the stack there; the cut layout is unaffected.
   *
   *  `'built'` means "exactly where it was built": the layout move is undone and the piece goes
   *  back into the primary's frame. A stack whose pieces are the same outline at different
   *  margins can only say that — every piece's own box centre differs by half its margin, and by
   *  whatever a lug adds, so no template can name the point before the engine has hugged it. */
  assembledAt?: { x: number; y: number } | 'built';
  /** Which sheet the piece is cut from, for the Assembled view's tones. Default `light` for
   *  parts, `dark` for a primary that is a backer. `card` is a THIRD material rather than a
   *  third tone: a paper piece cut and scored from stock the wood pieces are not, so its
   *  outline and its scores get their own export groups for the operator to run after the
   *  sheet change. */
  material?: 'light' | 'dark' | 'card';
  /** How the Assembled view draws this piece. `solid` (default) paints it like any other;
   *  `dashed` draws it as a ghost — a dashed outline and faded marks — which is what a piece
   *  standing BEHIND another one looks like on a flat picture. A table sign's back panel drawn
   *  solid and offset reads as a second product beside the first. */
  previewStyle?: 'solid' | 'dashed';
  /** Where the piece sits in the Assembled view's stack: low is drawn first, so it ends up
   *  behind. Default 0 for a `dark` or `card` sheet and 1 for a `light` one — the tiers as they
   *  were, and the reason a slat that belongs behind its panel had to claim it was cut from dark
   *  stock to get there. Tone and order are two different questions; this is the order one. */
  z?: number;
  /** The piece's place in the assembled product, in three dimensions — for a piece that stands,
   *  leans or turns. Wins over `assembledAt`/`z` in the 3D view; the flat card is unaffected. */
  pose?: Pose;
}

export interface PartLayout {
  /** `row` (default): parts to the right of the primary. `column`: below it. `wrap`: rows no
   *  wider than `maxWidth`. */
  flow?: 'row' | 'column' | 'wrap';
  /** Air between pieces, mm. Default 4. */
  gap?: number;
  /** For `wrap`: the sheet width to fill before starting a new row. Default 300. */
  maxWidth?: number;
}

export interface BuildInput {
  /** What the primary piece is called under the preview when there is more than one piece. */
  label?: string;
  /** The primary's sheet in the Assembled view. Default `light`. */
  material?: 'light' | 'dark' | 'card';
  /** The primary piece's own place in the assembled product — a stand's leaning plate. */
  pose?: Pose;
  blank: Blank;
  /** Which layer owners the body wraps / clips / cuts out of. Absent means all of them. */
  bodyMembers?: string[];
  keyring: KeyringSpec;
  /** The box whose centre lines a dragged ring snaps to, in the primary's frame. Absent: the
   *  body's own box. A design whose outline carries a knob off one side names the part the eye
   *  reads as the piece — the heart puzzle's bar without its heart — so "on the centre line"
   *  means the bar's middle, not a point pulled towards the knob. */
  snapBox?: Box;
  layers: DesignLayer[];
  /** Extra pieces built beside the primary one, each through the same pipeline in its own
   *  frame, then placed. */
  parts?: PartInput[];
  layout?: PartLayout;
  sheet?: SheetSpec;
  /** What the template itself has to say — merged ahead of the engine's own warnings. */
  warnings?: string[];
  /** One clause for the status line, between the size and the operations: "24 cards · 2 sheets". */
  status?: string;
}

/** Where one piece landed, for labels and the status line. Primary first. */
export interface PartPlacement {
  id: string;
  label: string;
  box: Box;
  /** How many separate islands the piece cut into — 1 is a piece, more is a warning. */
  pieces: number;
  /** Where the piece's centre sits once glued up, in the output's frame — when the template
   *  said. The primary carries it too (its own centre) so the Assembled view can move every
   *  piece the same way. */
  assembledAt?: { x: number; y: number };
  material?: 'light' | 'dark' | 'card';
  /** Carried through from `PartInput` — the Assembled view's own two knobs. */
  previewStyle?: 'solid' | 'dashed';
  z?: number;
  /** Carried through from `PartInput.pose` / `BuildInput.pose` — the 3D view's placement. */
  pose?: Pose;
}

export interface BuildObject {
  id: string;
  label: string;
  op: Op;
  shapes: Shapes;
  /** OPEN polylines — a score that the plate cut into arcs, or the seams of a welded word. Drawn
   *  and exported as stroked paths with no closing `Z`, in the same group as `shapes`. */
  paths?: Pt[][];
  image?: CutImage;
}

export interface BuildOutput {
  /** Outline before the keyring and cutouts. */
  body: Shapes;
  bodyBox: Box;
  /** `BuildInput.snapBox` in the output's frame, when the template gave one. */
  snapBox?: Box;
  editorLayers: DesignLayer[];
  /** The part outline with its holes — always a cut. */
  plate: Shapes;
  hole: { centre: [number, number]; dia: number } | null;
  /** Everything in job order: engraves, scores, then the plate. */
  objects: BuildObject[];
  bbox: Box;
  designBox: Box | null;
  warnings: string[];
  parts: PartPlacement[];
  /** The pages a paginated batch landed on, when the build named a sheet. `materials`, beside
   *  `pages` and in step with it, is what each page is cut from — present only when the sheet
   *  asked for `byMaterial` and the pieces really are cut from more than one. */
  sheets?: { count: number; width: number; height: number; pages: Box[]; materials?: ('light' | 'dark' | 'card')[] };
  status?: string;
}

export type WorkerRequest = { type: 'build'; id: number; input: BuildInput };
export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'built'; id: number; output: BuildOutput; ms: number }
  | { type: 'error'; id: number; message: string };
