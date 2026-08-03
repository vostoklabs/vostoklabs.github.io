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
}

/** A color slot for the image/svg/text. */
export interface PaletteEntry {
  quantRgb: RGB; // The original color grouped from the image/svg
  filamentRgb: RGB; // The assigned physical color
  coverage: number; // fraction of foreground pixels
}

export type BaseShapeKind = 'outline' | 'circle' | 'square' | 'hexagon' | 'heart' | 'star' | 'egg';
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
  /** XY scale offset (mm) applied to the cap's keycap-mount stem so it fits the MX
   *  switch: +looser (opens the cross socket, easier to press on), −tighter. 0 = as
   *  authored. Only the XY footprint scales — Z is kept so the cap rest height is fixed. */
  stemTolerance: number;
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
  // ---- Letter-block mode ----
  /** Arrangement: a row, a column, or a grid that wraps at `blockColumns`. */
  blockOrientation?: BlockOrientation;
  /** Columns per row when the layout is 'grid'. */
  blockColumns?: number;
  /** Legend size multiplier on the keycap (1 = the default fit). */
  legendScale?: number;
  /** Outward offset applied to every legend outline, mm — the "boldness" control. */
  legendBold?: number;
  /** Which side of the block set the keyring loop hangs off (blocks mode). */
  keychainEnd?: KeychainSide;
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
    }
  | {
      type: 'buildBlocks';
      regions: BuildRegion[];
      params: BuildParams;
    };

export type GeometryResponse =
  | { type: 'ready' }
  // `switchMesh` is the real MX switch, placed in the assembly frame for the preview
  // toggle (display only — never exported).
  | { type: 'initDone'; socketInfo: string; stemInfo: string; switchInfo: string; switchMesh: MeshData }
  // `switchPlacements` are the placements actually applied (after clamping to the cap
  // footprint + min-pitch spacing), so the preview switch meshes match the geometry.
  // `warnings` surfaces non-fatal build notes (e.g. switches pulled together, no room
  // for the keychain hole) for the status line.
  | { type: 'parts'; parts: ClickerPart[]; switchPlacements: SwitchPlacement[]; warnings: string[] }
  | { type: 'error'; message: string };
