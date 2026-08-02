// Shared types for the Image to Fridge Magnet generator.
// The image pipeline types (RegionSet, Ring, RGB) mirror the clicker generator's.

export type RGB = [number, number, number];

/** Common PLA filament colors for the palette picker (same list as the clicker). */
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
 *  centered on origin, Y-up. The worker scales by the fit size. */
export interface RegionSet {
  regions: { quantRgb: RGB; components: { rings: Ring[]; coverage: number }[]; coverage: number }[];
  /** Union silhouette of all foreground pixels. */
  outline: Ring[];
  /** Aspect (width/height) of the source silhouette, for reference. */
  aspect: number;
}

/** A color slot for the image. */
export interface PaletteEntry {
  quantRgb: RGB;
  filamentRgb: RGB;
  coverage: number;
}

export type CropRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9';

/** Image preprocessing, 1 = neutral. Same set and same math as the clicker's
 *  import wizard, so an image tuned in one generator behaves in the other. */
export interface PreprocessParams {
  cropRatio: CropRatio;
  keepBackground: boolean;
  /** The clicker's "image thickness"; here it seeds nothing — the magnet body
   *  thickness is driven by the magnet. Kept so the shared module stays in sync. */
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

export type BaseShapeKind = 'outline' | 'circle' | 'roundedRect' | 'rectangle' | 'hexagon' | 'square';
export type EdgeStyle = 'flat' | 'bevel';

/** How the magnet attaches to the body.
 *  none     — flat back, for stick-on magnetic sheet.
 *  glue-on  — pocket open at the back face; glue the magnet in after printing.
 *  embedded — blind pocket over a thin back wall; the print pauses at the top of
 *             the cavity, the magnet drops in, and the body closes over it. */
export type MagnetMode = 'none' | 'glue-on' | 'embedded';

/** Whether we're making a single fridge magnet or a two-piece magnetic slider. */
export type ProductType = 'magnet' | 'slider';

/** Magnet count for slider dice-face pattern. */
export type SliderLayout = 4 | 6;

/** Magnet body type, in the language magnet shops use. */
export type MagnetShapeKind = 'disc' | 'block';

/** Cutout profile for a disc magnet. `hex` prints cleaner (flat walls, no
 *  round-hole shrinkage) and leaves corner gaps for glue. */
export type PocketProfile = 'round' | 'hex';

/** A stock magnet size. Sellers buy known sizes — this is the fast path. */
export interface MagnetPreset {
  id: string;
  shape: MagnetShapeKind;
  label: string;
  /** Disc: diameter. Block: unused. */
  diameter?: number;
  /** Block footprint. */
  x?: number;
  y?: number;
  /** Magnet height (both). */
  height: number;
}

export const MAGNET_PRESETS: MagnetPreset[] = [
  { id: 'd6x3', shape: 'disc', label: '⌀6 × 3 mm', diameter: 6, height: 3 },
  { id: 'd8x3', shape: 'disc', label: '⌀8 × 3 mm', diameter: 8, height: 3 },
  { id: 'd10x2', shape: 'disc', label: '⌀10 × 2 mm', diameter: 10, height: 2 },
  { id: 'd10x3', shape: 'disc', label: '⌀10 × 3 mm', diameter: 10, height: 3 },
  { id: 'd12x2', shape: 'disc', label: '⌀12 × 2 mm', diameter: 12, height: 2 },
  { id: 'd15x2', shape: 'disc', label: '⌀15 × 2 mm', diameter: 15, height: 2 },
  { id: 'd20x2', shape: 'disc', label: '⌀20 × 2 mm', diameter: 20, height: 2 },
  { id: 'b10x10x2', shape: 'block', label: '10 × 10 × 2 mm', x: 10, y: 10, height: 2 },
  { id: 'b20x10x2', shape: 'block', label: '20 × 10 × 2 mm', x: 20, y: 10, height: 2 },
  { id: 'b20x5x2', shape: 'block', label: '20 × 5 × 2 mm', x: 20, y: 5, height: 2 },
  { id: 'b25x10x3', shape: 'block', label: '25 × 10 × 3 mm', x: 25, y: 10, height: 3 },
];

/** Mesh payload (transferable). First 3 of each `numProp` stride are x,y,z. */
export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}

export type PartGroup = 'magnet' | 'slider-mirror';

export interface MagnetPart extends MeshData {
  kind: 'body' | 'inlay';
  group: PartGroup;
  colorRgb: RGB;
  name: string;
  /** 1-based filament slot for slicer color assignment (shared per unique color). */
  extruder?: number;
}

/** A region with its resolved filament color, ready for the worker. */
export interface BuildRegion {
  filamentRgb: RGB;
  coverage: number;
  rings: Ring[];
  partName: string;
}

/** Parameters the geometry worker needs to build the magnet (all mm).
 *  Frame: Z = 0 is the flat BACK face; the front (image) face is at Z = thickness. */
export interface MagnetBuildParams {
  baseShape: BaseShapeKind;
  /** Longest side of the magnet body, mm. */
  fitSizeMm: number;
  /** Body height, mm. */
  thickness: number;
  /** Flat frame between the image edge and the body edge (outline shapes), mm. */
  imageMargin: number;
  /** Corner rounding for the roundedRect preset shape, mm. */
  cornerRadius: number;
  edgeStyle: EdgeStyle;
  /** Bevel size on the front rim, mm (edgeStyle = 'bevel'). */
  edgeRadius: number;
  /** Slab color (the magnet body). */
  bodyRgb: RGB;
  colorBleed: number;
  stepHeight: number;
  /** Per-inlay raise level (partName -> level; × stepHeight). */
  componentHeights: Record<string, number>;
  /** Bevel the top edge of every RAISED inlay. */
  extrudeChamfer: boolean;

  magnetMode: MagnetMode;
  magnetShape: MagnetShapeKind;
  /** Disc diameter, mm. */
  magnetDiameter: number;
  /** Block footprint, mm. */
  magnetX: number;
  magnetY: number;
  /** Magnet height; the pocket is cut this deep. */
  magnetDepth: number;
  /** Embedded only: solid wall left between the back face and the magnet. */
  backWall: number;
  /** Whether to show a visual helper in 'none' mode (magnetic sheet). */
  sheetHelperEnabled: boolean;
  /** 1..4 magnets. */
  magnetCount: number;
  /** Clearance added to the magnet dims (press-fit). */
  pocketFit: number;
  /** Cutout profile for disc magnets. */
  pocketProfile: PocketProfile;
  /** auto = the app spreads them over the shape; manual = `magnets` holds the
   *  positions the user placed (dragged on the model, or nudged with the pad). */
  magnetPlacement: MagnetPlacement;
  /** Magnet positions in body coordinates (mm from the centre) + rotation (deg,
   *  blocks only). Only read when `magnetPlacement` is 'manual'; rotation always. */
  magnets: MagnetPlacementEntry[];

  // ---- Slider fields ----
  /** Whether this is a single fridge magnet or a two-piece slider. */
  productType: ProductType;
  /** Dice-face magnet pattern for sliders (4 corners or 6 two-column). */
  sliderLayout: SliderLayout;
  /** When true, the mirrored slider half has no inlays (plain body only). */
  sliderMirrorBlank: boolean;
}

export type MagnetPlacement = 'auto' | 'manual';
export interface MagnetPlacementEntry {
  x: number;
  y: number;
  rotation: number;
}

/** What the builder actually cut, so the UI can report the truth rather than the
 *  requested numbers (pockets can be reduced in count or size to stay printable). */
export interface MagnetReport {
  requested: number;
  placed: number;
  /** Resolved pocket depth, mm (may be less than the magnet height). */
  pocketDepth: number;
  /** Solid material left above the magnet (toward the image face), mm. */
  coverThickness: number;
  /** Solid material left below the magnet (toward the fridge), mm. */
  backWall: number;
  /** True when the pocket footprint had to be shrunk to fit the silhouette. */
  scaled: boolean;
  /** Pocket centers in body coordinates, mm — where they ACTUALLY ended up. */
  positions: [number, number][];
  /** Circumscribed pocket radius, mm — the grab area for the drag handles. */
  pocketRadius: number;
  /** The magnet's own radius (no fit gap), mm. Drawn as the handle ring so a hex
   *  pocket visibly contains its magnet rather than the ring sitting outside it. */
  magnetRadius: number;
  /** Per-magnet rotation actually used, degrees (blocks only). */
  rotations: number[];
  /** Computed minimum body size (longest side) to fit all slider magnets, mm.
   *  Only meaningful when productType is 'slider'. */
  sliderMinSize?: number;
}

// ---- Worker messages ----
export type GeometryRequest =
  | { type: 'buildMagnet'; regions: BuildRegion[]; outline: Ring[]; params: MagnetBuildParams };

export type GeometryResponse =
  | { type: 'ready' }
  | { type: 'parts'; parts: MagnetPart[]; warnings: string[]; magnet: MagnetReport }
  | { type: 'error'; message: string };
