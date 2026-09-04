// Shared types. See DEV_PLAN.md §4 for the full target data model; this is the
// walking-skeleton subset.

export type RGB = [number, number, number];

export const FILAMENTS: [string, string][] = [
  ['Black', '#161616'],
  ['White', '#f7f7f5'],
  ['Gray', '#8c8c90'],
  ['Silver', '#cfd0d2'],
  ['Red', '#c8102e'],
  ['Orange', '#ff6a13'],
  ['Yellow', '#f5c518'],
  ['Green', '#00ae42'],
  ['Cyan', '#0086d6'],
  ['Blue', '#0a5cd5'],
  ['Purple', '#8e44ad'],
  ['Pink', '#e6398b'],
  ['Brown', '#7a5230'],
  ['Beige', '#d9c8a9'],
];

/** A closed 2D ring (list of [x,y]); EvenOdd fill handles outer/hole nesting. */
export type Ring = [number, number][];

/** Normalized 2D geometry: silhouette fits within a unit box (longest side = 1),
 *  centered on origin, Y-up. Worker scales by capWidthMm. */
export interface RegionSet {
  /** One entry per palette color actually used. */
  regions: { quantRgb: RGB; components: { rings: Ring[]; coverage: number }[]; coverage: number }[];
  /** Union silhouette of all foreground pixels. */
  outline: Ring[];
  /** Aspect (width/height) of the source silhouette, for reference. */
  aspect: number;
  /** Text only: longest side relative to the same text laid out with default typography.
   *  Spacing makes the word bigger, and the clicker grows with it rather than the letters
   *  shrinking to fit — on a printer a bigger part is the cheaper trade. */
  sizeMul?: number;
}

/** A color slot for the image/svg/text. */
export interface PaletteEntry {
  quantRgb: RGB; // The original color grouped from the image/svg
  filamentRgb: RGB; // The assigned physical color
  coverage: number; // fraction of foreground pixels
}

/** The base silhouette. `outline` follows the artwork; the rest are presets.
 *
 *  `custom` is the one that is not built in code: its rings arrive on `BuildParams` as
 *  `baseShapeRings`, traced from an SVG. That is what lets a seasonal pack (a pumpkin, a bat,
 *  a coffin) be a folder of SVGs and a manifest rather than another `case` in the geometry —
 *  see src/packs/. */
export type BaseShapeKind =
  | 'outline' | 'circle' | 'square' | 'rect' | 'hexagon' | 'heart' | 'star' | 'egg'
  // Parametric: one knob each, and the knob is what makes a directory out of a list.
  | 'ngon' | 'cross' | 'squircle' | 'capsule'
  | 'shield' | 'tag' | 'arch'
  | 'custom';
export type ViewMode = 'assembled' | 'exploded' | 'section';

/** Which interaction mode the viewport is in. */
export type EditMode = 'color' | 'extrude' | 'edges';

/** Which edge group or part to modify. E.g. 'baseTop', 'capTop', or a part name like 'top-color-0-1' */
export type EdgeTarget = string;

/** Edge modification style. */
export type EdgeStyle = 'none' | 'fillet' | 'chamfer';

/** One edge-modification entry. */
export interface EdgeSetting {
  target: EdgeTarget;
  style: EdgeStyle;
  radius: number; // mm
}

export type CropRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9';

/** One MX switch placement on the design. x/y in mm from centre, rotation in degrees. */
export interface SwitchPlacement {
  x: number;
  y: number;
  rotation: number;
  /** Seat height for the PREVIEW switch mesh (mm above the frame's Z 0). A clicker body
   *  latches the switch at Z 0; a letter block keeps a slightly thicker plate around the
   *  cut-out, so its switch (and its keycap) sit that much higher. Undefined = 0. */
  z?: number;
}

/** Keychain attachment settings. */
export interface KeychainParams {
  enabled: boolean;
  /** 'loop' = outer tab with a ring hole; 'hole' = ring hole cut through the body. */
  style: 'loop' | 'hole';
  /** Position around the body edge, degrees. 90 = +Y (top), counter-clockwise. */
  angleDeg: number;
  /** Ring hole diameter, mm. Default 5.2. */
  holeDiameterMm: number;
  /** Lateral offset along the body edge tangent, mm. Positive = counter-clockwise
   *  shift from the angle-derived anchor, negative = clockwise. Default 0. */
  offsetMm: number;
}

/** Bambu-style image preprocessing. Adjustment values are multipliers, 1 = neutral. */
export interface PreprocessParams {
  cropRatio: CropRatio;
  keepBackground: boolean;
  thicknessMm: number;
  exposure: number;
  contrast: number;
  saturation: number;
  brightness: number;
  whiteBalance: number;
  highlights: number;
  shadows: number;
}

export const DEFAULT_PREPROCESS: PreprocessParams = {
  cropRatio: 'free',
  keepBackground: false,
  thicknessMm: 1,
  exposure: 1,
  contrast: 1,
  saturation: 1,
  brightness: 1,
  whiteBalance: 1,
  highlights: 1,
  shadows: 1,
};

/** Parameters the geometry worker needs to build the clicker (all mm).
 *  Design: the BODY is a solid block with a recessed well + raised border cut
 *  into the top; the cap nests INSIDE that well (button-in-bezel). */
export interface BuildParams {
  baseShape: BaseShapeKind;
  capWidthMm: number; // the cap (top) footprint; body = cap + tolerance + border
  topThickness: number; // solid base-color backing behind the image (min 1–2 mm)
  imageDepth: number; // how deep the colored image cuts in from the top
  imageMargin: number; // flat base-color frame between the image and the cap edge
  borderWidth: number; // raised body border around the cap (the bezel wall)
  capProud: number; // how far the cap top sticks up above the body border at rest (≈ travel → flush when pressed)
  tolerance: number; // slip-fit gap between cap outer wall and body well wall ("switch socket" fit)
  /** Cap stem fit, as a PERCENTAGE of the stem's cross socket: + opens the socket (easier
   *  to press onto the switch), − tightens the grip. 0 = the asset exactly as authored.
   *
   *  Percent, not mm, because the thing being moved is the HOLE. The old mm control scaled
   *  the whole stem solid by a factor derived from its 7.9 mm outer bbox, so the ~1.2 mm slot
   *  that actually grips the switch moved about a seventh of the millimetres on the label —
   *  one "+0.2 mm" press opened it 0.03 mm, under a single extrusion width. Every setting was
   *  mechanically the same part, which is what "I tried all of them and it still doesn't fit"
   *  meant. `stemFit` in buildClicker moves the hole and leaves the outer post alone, so a
   *  percentage of the hole is the only unit that stays honest. */
  stemFitPct: number;
  /** Body switch-pocket fit, as a PERCENTAGE of the imported socket footprint: + opens the
   *  pocket (switch drops in more easily), − grips harder. 0 = the asset as authored.
   *
   *  Nothing could size the pocket before this — the socket solid was only ever rotated and
   *  translated. It is subtracted from the body, so scaling the cutter IS the pocket. */
  socketFitPct: number;
  /** Nudge (mm) of the design within a preset base shape. The shape grows to keep
   *  containing it, so the artwork can sit off-centre (a heart reads better with its
   *  design a little high). Ignored when the base follows the outline. */
  imageOffset: { x: number; y: number };
  colorBleed: number; // tiny outward grow on each color so neighbors never leave a gap
  stepHeight: number; // mm per height level for raised color relief
  travel: number; // switch press travel the well must clear (~3.5–4 mm)
  floorThickness: number;
  /** MX switch placements (1..3). Each is nudged off the design centre and rotated so
   *  the switch sits under solid material; the worker clamps each to the cap footprint
   *  and enforces a minimum centre-to-centre pitch, reporting the applied array back. */
  switches: SwitchPlacement[];
  keychain: KeychainParams; // keyring attachment (loop tab or inside hole) on the body
  baseFilamentRgb: RGB; // cap backing + stem color
  bodyColorRgb: RGB;
  /** Component-specific height levels (partName -> level integer) */
  componentHeights: Record<string, number>;
  /** Edge modifications (fillet / chamfer) for body and cap edges. */
  edgeSettings: EdgeSetting[];
  /** Global toggle: chamfer the top edge of every raised (extruded) color part. */
  extrudeChamfer: boolean;
  /** Hollow the body's underside, leaving walls and a floor instead of a solid block.
   *  Off by default: it changes what an existing saved design renders as, and the walls
   *  want a print before anyone's default moves. */
  hollowBase?: boolean;
  /** How much of the room inside the frame the artwork takes, 0.3-1. Absent = 1 = fills it,
   *  which is what every clicker built before this control existed did.
   *
   *  Size scales the base and the design together and always did; their ratio was welded shut
   *  by `imageMargin`, a hardcoded literal in mount.ts that no control ever reached. So there
   *  was no way to put a small logo on a big badge — which is the other half of the listing
   *  complaints the outline size clamp already quotes ("is there a way to scale the picture
   *  bigger when using the Base Style").
   *
   *  Ignored when the base follows the outline: there the shape and the artwork are the same
   *  thing, so shrinking one is meaningless. */
  designScale?: number;
  /** Pin the BODY's outer footprint to this rectangle (mm) instead of sizing it from the
   *  artwork, and fit the artwork inside it. Absent = the body follows the design, which is
   *  what every clicker generated before this did.
   *
   *  Two different people want this for two different reasons and it is one control:
   *   • Forty names produce forty body sizes, so a seller cannot make ONE product. A run
   *     generated without a fixed footprint can never be made into one SKU afterwards, which
   *     is why this has to exist before batch does.
   *   • On an `outline` base the Size slider is a no-op for any design narrower than the
   *     switch — the build has to scale it up to clear the socket, so 20/30/40/50/60 all
   *     produce the same part. `warnings` has said so since the fit pass; this is the way out. */
  bodySize?: { w: number; h: number };
  /** The "detail" knob for whichever parametric shape is selected: sides for an n-gon, points
   *  for a star, petals for a flower, teeth for a gear. One field rather than four because the
   *  shapes are mutually exclusive and each clamps it to its own range — four would mean four
   *  sliders in the UI, three of which are always meaningless. */
  shapeSides?: number;
  /** Corner radius for square/rect, as a fraction of the short side. 0.22 is what shipped. */
  shapeCornerPct?: number;
  /** The second parametric knob: how deep the shape's notch cuts. A star's valley radius as a
   *  fraction of its outer radius (0.3-0.8, 0.56 shipped), a cross's arm half-width (0.15-0.45,
   *  0.34 shipped). One field for the same reason `shapeSides` is one field — the shapes that
   *  have a notch are mutually exclusive, and each clamps it to its own range. Absent = each
   *  shape's shipped default, so no model anyone has already generated moves. */
  shapeArmPct?: number;
  /** Silhouette for `baseShape: 'custom'` — normalised the way `parseSvg` returns rings
   *  (longest side = 1, centred, Y-up), scaled by the build like any other preset shape.
   *  Ignored for every other base shape. */
  baseShapeRings?: Ring[];
  /** A maker's mark debossed into the body's underside — the one large, flat, support-free
   *  face the geometry has. Rings are normalised the way `parseSvg` / `parseLetter` return
   *  them (longest side = 1, centred, Y-up); `sizeMm` is the longest side on the print.
   *
   *  Deboss, never emboss: `plateLayout` seats the base group on Z=0 by its own minimum, so
   *  anything protruding below the underside BECOMES the seating plane and tips the part onto
   *  its logo. Cut after both void loops — see the buried-void hazard in buildClicker. */
  brandMark?: { rings: Ring[]; sizeMm: number };
  // ---- Letter-block mode ----
  /** Arrangement: a row, a column, or a grid that wraps at `blockColumns`. */
  blockOrientation?: BlockOrientation;
  /** Columns per row when the layout is 'grid'. */
  blockColumns?: number;
  /** Legend size multiplier on the keycap (1 = the default fit). */
  legendScale?: number;
  /** Outward offset applied to every legend outline, mm — the "boldness" control. */
  legendBold?: number;
  /** Text mode: outward offset applied to every glyph outline before it is carved, mm —
   *  the "boldness" control. Absent/0 = the outline exactly as the font drew it. */
  textBold?: number;
  /** Which side of the block set the keyring loop hangs off (blocks mode). */
  keychainEnd?: KeychainSide;
  /** Slide the keyring loop ALONG that side, mm. 0 = where it has always sat.
   *
   *  A sibling of `keychainEnd`, deliberately not a replacement — buildBlocks reads the side
   *  in two places that must keep agreeing, and 0 has to reproduce today's placement exactly
   *  or every block set anyone has made moves.
   *
   *  Also deliberately NOT `keychain.offsetMm`, which is the flat clicker's tangent shift on a
   *  continuous body outline and is persisted in project files. Sharing the field would make a
   *  loaded clicker project teleport its loop the moment blocks mode was entered. */
  keychainSlideMm?: number;
  /** Per-part colour overrides (partName -> rgb), for parts the user recoloured one at a
   *  time by clicking them in the viewport. The left-hand palette sets the whole group and
   *  clears these. */
  partOverrides?: Record<string, RGB>;
}

/** One cell of a block arrangement: a glyph, a Lucide symbol, or a deliberate hole (which
 *  keeps its place in the grid so shapes like WASD are possible). */
export type BlockSlot =
  | { kind: 'char'; ch: string }
  | { kind: 'icon'; name: string }
  | { kind: 'empty' };

/** 'grid' is implemented in the geometry (and covered by the headless tests) but is NOT
 *  offered in the UI, because the current shells can't tile one cleanly:
 *   • They are 0.34 mm wider than they are deep, and a grid puts neighbours 90° apart, so
 *     every rotated joint pairs a wide face with a narrow one (0.17–0.34 mm of slop).
 *   • A wall with no neighbour stays FULL, which is 0.875 mm thicker than a halved one —
 *     so in a non-rectangular shape (an L, a WASD cluster) two diagonal blocks run their
 *     full outer walls into each other's corner.
 *  Both go away if the block CAD is made square; then this can be re-exposed as-is. */
export type KeychainSide = 'left' | 'right' | 'top' | 'bottom';

export type BlockOrientation = 'horizontal' | 'vertical' | 'grid';

/** Mesh payload (transferable). First 3 of each `numProp` stride are x,y,z. */
export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}

export type PartKind = 'cap' | 'body';
/** Which independently-movable object a part belongs to in the export. */
export type PartGroup = 'top' | 'base';

export interface ClickerPart extends MeshData {
  kind: PartKind;
  group: PartGroup;
  colorRgb: RGB;
  name: string;
  /** 1-based filament slot for slicer color assignment (shared per unique color). */
  extruder?: number;
  /** Which independently-movable object on the build plate this part belongs to. Absent
   *  means `group` — one clicker, two objects, which is every export but a batch run. A run
   *  sets it per row (`r03:top`, `r03:base`) so forty clickers arrive as eighty objects the
   *  slicer can move separately, rather than two stacks of forty. See export/plateLayout.ts
   *  for why this is a second field and not a wider `PartGroup`. */
  objectKey?: string;
  /** What the slicer calls this object. Absent falls back to `clicker_top` / `clicker_base`. */
  objectLabel?: string;
}

/** A region with its resolved filament color, ready for the worker. */
export interface BuildRegion {
  filamentRgb: RGB;
  coverage: number; // fraction of foreground — drives carve priority (small detail wins)
  rings: Ring[];
  partName: string;
}

// ---- Worker messages ----
export type GeometryRequest =
  | { 
      type: 'init'; 
      socket: ArrayBuffer; 
      stem: ArrayBuffer; 
      switch: ArrayBuffer;
      blockNoSides?: ArrayBuffer;
      blockSouth?: ArrayBuffer;
      blockNorthSouth?: ArrayBuffer;
      blockNorthWest?: ArrayBuffer;
      blockNorthSouthWest?: ArrayBuffer;
      blockAllSides?: ArrayBuffer;
      keycapJson?: any;
    }
  | {
      type: 'buildClicker';
      regions: BuildRegion[];
      outline: Ring[];
      params: BuildParams;
      /** Echoed back on the `parts` response. The live preview never sets it — it only ever
       *  has one build in flight and takes whatever arrives. A batch run does: it drives N
       *  builds through this same worker and has to tell the answers apart. Kept here, in the
       *  tracked worker protocol, rather than giving the worker a `buildRun` message, so the
       *  run loop itself stays entirely inside the (unshipped) paid module. */
      requestId?: string;
    }
  | {
      type: 'buildBlocks';
      regions: BuildRegion[];
      params: BuildParams;
      requestId?: string;
    }
  | {
      /** The printable fit test. `labels` carries one tile per setting, with the outlines of
       *  the number to deboss on it — text becomes outlines on the main thread, because the
       *  fonts live there. */
      type: 'buildFitStrip';
      labels: { pct: number; rings: Ring[] }[];
      colorRgb: RGB;
    };

export type GeometryResponse =
  | { type: 'ready' }
  // `switchMesh` is the real MX switch, placed in the assembly frame for the preview
  // toggle (display only — never exported).
  // `switchColumnMm` is the clear square an MX switch needs, measured from the socket asset
  // rather than written down anywhere — the 2-D shape editor draws it.
  | {
    type: 'initDone'; socketInfo: string; stemInfo: string; switchInfo: string;
    switchMesh: MeshData; switchColumnMm: number;
  }
  // `switchPlacements` are the placements actually applied (after clamping to the cap
  // footprint + min-pitch spacing), so the preview switch meshes match the geometry.
  // `warnings` surfaces non-fatal build notes (e.g. switches pulled together, no room
  // for the keychain hole) for the status line.
  | { type: 'parts'; parts: ClickerPart[]; switchPlacements: SwitchPlacement[]; warnings: string[]; requestId?: string }
  | { type: 'error'; message: string };
