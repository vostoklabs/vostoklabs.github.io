// Shared types for the slot-together laser-cut generator.
//
// The image-pipeline types (RegionSet, Ring, RGB, PreprocessParams) are copied
// verbatim from the magnet/clicker generators so `src/image/` drops in unchanged.
// Everything below the "laser" divider is new.

export type RGB = [number, number, number];

/** A closed 2D ring (list of [x,y]); EvenOdd fill handles outer/hole nesting. */
export type Ring = [number, number][];

/** Normalized 2D geometry: silhouette fits within a unit box (longest side = 1),
 *  centered on origin, Y-up. The worker scales it to the requested height. */
export interface RegionSet {
  regions: { quantRgb: RGB; components: { rings: Ring[]; coverage: number }[]; coverage: number }[];
  /** Union silhouette of all foreground pixels — the only thing this app uses. */
  outline: Ring[];
  /** Aspect (width/height) of the source silhouette, for reference. */
  aspect: number;
}

export type CropRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9';

/** Image preprocessing, 1 = neutral. Same set and same math as the clicker's
 *  import wizard, so an image tuned in one generator behaves in the other. */
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

// ─────────────────────────────── laser ───────────────────────────────

/** A material preset. `thicknessMm` is the NOMINAL sale thickness — the user is
 *  always asked for the measured one, because nominal is a lie (ISO 7823-1 lets
 *  "3 mm" cast acrylic be anything from 2.3 to 3.7 mm). `kerfMm` is a starting
 *  guess to be replaced by a calibration-comb measurement. */
export interface Material {
  id: string;
  name: string;
  thicknessMm: number;
  kerfMm: number;
  /** False when a 455 nm blue diode (Bambu H2D 10 W / 40 W) cannot process it. */
  h2dSafe: boolean;
  /** Shown when h2dSafe is false, or when the material needs a caveat. */
  note?: string;
  /** Preview colour. */
  hex: string;
}

/** Bambu's own material list rules out transparent, white and blue acrylic on
 *  both laser modules — they are 455 nm blue diodes and acrylic transmits that
 *  band. Fluorescent/neon stock is transparent-tinted, so it is in the same
 *  bucket until somebody cuts a coupon and proves otherwise.
 *  https://wiki.bambulab.com/en/h2/laser/processable-materials-list */
export const MATERIALS: Material[] = [
  { id: 'ply3', name: 'Basswood plywood 3 mm', thicknessMm: 3, kerfMm: 0.18, h2dSafe: true, hex: '#c9a978' },
  { id: 'ply4', name: 'Basswood plywood 4 mm', thicknessMm: 4, kerfMm: 0.2, h2dSafe: true, hex: '#c9a978' },
  { id: 'mdf3', name: 'MDF 3 mm', thicknessMm: 3, kerfMm: 0.2, h2dSafe: true, hex: '#b09a7a' },
  {
    id: 'acr-opaque3',
    name: 'Opaque acrylic 3 mm',
    thicknessMm: 3,
    kerfMm: 0.18,
    h2dSafe: true,
    note: 'H2D cuts this at 2 passes and ~2–4 mm/s — roughly 8× slower than plywood, and every official acrylic preset trips the machine’s attended-operation check.',
    hex: '#d64550',
  },
  {
    id: 'acr-clear3',
    name: 'Clear / neon / white acrylic 3 mm',
    thicknessMm: 3,
    kerfMm: 0.18,
    h2dSafe: false,
    note: 'A 455 nm blue diode passes straight through transparent, white and blue acrylic — Bambu’s own material list says it cannot be processed. Cut this on a CO₂ laser.',
    hex: '#39d7b8',
  },
  { id: 'card2', name: 'Greyboard / card 2 mm', thicknessMm: 2, kerfMm: 0.12, h2dSafe: true, hex: '#9aa0a6' },
];

/** Sheet presets. The H2D's laser work area is smaller than its print bed, and
 *  smaller still on the 40 W module — Bambu's own 300×300 acrylic sheet actually
 *  overhangs the 40 W Y axis. https://bambulab.com/en/h2d/tech-specs */
export interface Sheet {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export const SHEETS: Sheet[] = [
  { id: 'h2d40', name: 'Bambu H2D — 40 W laser (310 × 250)', widthMm: 310, heightMm: 250 },
  { id: 'h2d10', name: 'Bambu H2D — 10 W laser (310 × 270)', widthMm: 310, heightMm: 270 },
  { id: 'a3', name: 'A3 (420 × 297)', widthMm: 420, heightMm: 297 },
  { id: 'co2-600', name: 'CO₂ bed (600 × 400)', widthMm: 600, heightMm: 400 },
];

/** Everything the solver needs. */
export interface SlotParams {
  /** Overall height of the assembled object, mm (tab excluded). */
  heightMm: number;
  /** MEASURED sheet thickness, mm. Not the number on the invoice. */
  thicknessMm: number;
  /** Beam width, mm. Every drawn path is offset by +kerf/2 to cancel it. */
  kerfMm: number;
  /** Assembled clearance, mm. Positive = slip fit. Never negative on acrylic:
   *  an interference fit plus residual edge stress is how acrylic crazes. */
  clearanceMm: number;
  /** Add the base disc. */
  base: boolean;
  /** 0 = derive the diameter from a 20° tip angle about the centre of mass. */
  baseDiaMm: number;
  /** How far the tabs protrude through the base, mm. */
  tabProtrudeMm: number;
  /** Round the ends of every slot to this radius to kill the stress riser.
   *  Ponoko: "If you have a sharp corner, typical in a laser cut slot, the
   *  acrylic will always fracture at that corner." */
  filletSlotEnds: boolean;
  /** Fraction of the profile's width, 0..1, where the crossing axis sits.
   *  null = let the solver pick the strongest spine. */
  axisFrac: number | null;
  /** Where along the shared run the two slots meet, 0..1 from its bottom.
   *  0.5 is a true half-lap; lower puts the joint nearer the feet. */
  jointFrac: number;
  /** Width of the tabs that pass through the base, mm. 0 = derive it from how
   *  wide the silhouette is where it meets the ground. A pointed shape (a heart,
   *  a teardrop) gives the solver almost nothing to work with there, so this is
   *  the override that matters most often. */
  tabWidthMm: number;
  /** Gap between nested parts, mm. Doubles as the thermal spacing that keeps
   *  adjacent cuts from re-heating each other on acrylic. */
  partGapMm: number;
  sheetId: string;
  materialId: string;
}

export const DEFAULT_PARAMS: SlotParams = {
  // 180 mm. The palm — the sample the app boots with — has a slim trunk, so a
  // 3 mm slot needs the object this tall before the joint has 12 mm of material
  // to bite on. Any taller and its base stops fitting the H2D sheet beside the
  // two profiles. The window is genuinely that narrow; the Results panel says
  // so when you leave it.
  heightMm: 180,
  thicknessMm: 3,
  kerfMm: 0.18,
  clearanceMm: 0.03,
  base: true,
  baseDiaMm: 0,
  tabProtrudeMm: 0,
  filletSlotEnds: true,
  axisFrac: null,
  jointFrac: 0.5,
  tabWidthMm: 0,
  partGapMm: 2,
  sheetId: 'h2d40',
  materialId: 'ply3',
};

/** One flat part, in millimetres, Y-up, ready to place on a sheet.
 *  `rings` are already kerf-compensated and already closed. */
export interface Part {
  id: string;
  label: string;
  rings: Ring[];
  /** Bounding box in the part's own coordinates: [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  /** Engrave-layer strokes (open polylines): assembly marks, provenance. */
  marks?: Ring[];
}

/** A part placed on the sheet. */
export interface Placement {
  partId: string;
  /** Translation applied to the part's own coordinates, mm. */
  dx: number;
  dy: number;
  /** Degrees CCW; 0 or 180 only (the nester never mirrors — that would flip any
   *  face-specific feature and break the mate). */
  rot: 0 | 180;
}

export interface Layout {
  sheet: Sheet;
  placements: Placement[];
  /** True when not everything fitted; the UI must say so rather than silently
   *  dropping parts. */
  overflow: boolean;
  usedHeightMm: number;
}

/** A problem the user has to fix, in the user's language. */
export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** What to actually do about it. */
  fix?: string;
}

/** Mesh for the three.js preview: one per part, already positioned in the
 *  assembled pose. */
export interface PreviewPart {
  id: string;
  label: string;
  positions: Float32Array;
  indices: Uint32Array;
  color: RGB;
}

export interface SolveResult {
  parts: Part[];
  layout: Layout;
  preview: PreviewPart[];
  diagnostics: Diagnostic[];
  /** Total cut path length, mm — drives the time and cost readout. */
  cutLengthMm: number;
  /** Where the solver put the crossing axis, as a fraction of profile width. */
  axisFrac: number;
  /** Tab width actually used, mm — auto-derived unless overridden. */
  tabWidthMm: number;
  /** Height of the joint above the base, mm, for the readout. */
  jointHeightMm: number;
  /** Assembled height including the base, mm. */
  assembledHeightMm: number;
}

// ── worker protocol ──

export type GeometryRequest =
  | { type: 'build'; outline: Ring[]; params: SlotParams }
  | { type: 'ping' };

export type GeometryResponse =
  | { type: 'ready' }
  | { type: 'result'; result: SolveResult }
  | { type: 'error'; message: string };
