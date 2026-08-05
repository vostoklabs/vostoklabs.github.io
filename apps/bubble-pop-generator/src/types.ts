// Shared types for the Bubble Pop Fidget generator.
// The image pipeline types (RegionSet, Ring, RGB) mirror the clicker and magnet
// generators' so an image tuned in one behaves the same in all three.

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
 *  import wizard. */
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

// ---------------------------------------------------------------------------
// The pop module. Measured off `public/assets/pop-socket/pop-socket-module.3mf`
// (Ian's Plasticity design, unit = meter). See docs/briefs/bubble-pop-generator-spec.md §1.
//
// These are FACTS about the mechanism, not preferences. The only one the UI may
// touch is the bore, via `buttonClearance`.
// ---------------------------------------------------------------------------
export const POP = {
  /** Housing outer ⌀ — the keep-out around every button. */
  outerDiameter: 19.55,
  /** Bore ⌀ the button slides in. */
  boreDiameter: 11.46,
  /** Sleeve height. This IS the body thickness — the snap fit needs all of it. */
  height: 13.0,
  /** Chamfer depth at both bore ends (⌀12.46 at the face → ⌀11.46 at this depth). */
  boreChamfer: 0.5,
  /** Extra ⌀ at the very mouth of the bore, i.e. the chamfer's outer diameter. */
  boreChamferDiameter: 12.46,
  /** Spring-beam pocket, in socket-local coordinates (axis at origin). Two of
   *  them, opposed; the second is the first rotated 180°, never mirrored. The
   *  pocket is BLIND — it stops 2.6 mm short of the outer wall. */
  window: {
    /** Inner radial face (inside the bore, so it merges with it). */
    rIn: 4.154,
    /** Outer radial face. */
    rOut: 7.164,
    /** Half-width across the chord. */
    halfY: 5.268,
    zMin: 4.941,
    zMax: 7.525,
  },
  /** Button overall height (it stands 3.43 mm proud of the sleeve at rest). */
  buttonHeight: 16.425,
  /** Button skirt/cap ⌀ — the sliding fit against the bore. */
  buttonBodyDiameter: 11.08,
  /** Snap bead max ⌀. The bead vs the beam tip is the pop; never scale it. */
  beadDiameter: 10.22,
  /** Spring beam tip, distance from the axis. Bead radius (5.11) minus this
   *  (4.594) = 0.516 mm of radial deflection per press. */
  beamTipRadius: 4.594,
} as const;

/** Body thickness is the sleeve height. Not a parameter — see spec §3. */
export const BODY_THICKNESS = POP.height;

/** Min solid wall around a socket (to the outline edge and to its neighbours).
 *  Shared by the geometry and the UI's size floor so the two can never disagree. */
export const SOCKET_WALL_MM = 2.0;

/** Every shape the library can build. `outline` means "use the traced image". */
export type ShapeKind =
  | 'outline'
  | 'circle'
  | 'square'
  | 'roundedSquare'
  | 'rectangle'
  | 'hexagon'
  | 'octagon'
  | 'triangle'
  | 'donut'
  | 'heart'
  | 'star'
  | 'flower'
  | 'egg'
  | 'cloud'
  | 'moon'
  | 'lightning'
  | 'speech'
  | 'human'
  | 'cat'
  | 'paw'
  | 'fish'
  | 'butterfly';

export interface ShapeDef {
  id: ShapeKind;
  label: string;
  /** Grouping for the gallery. */
  group: 'Basic' | 'Fun' | 'Characters';
  /** Shapes whose silhouette can't hold a socket near its edge need more size
   *  before the first button fits; used to seed a sensible default size. */
  suggestedSize: number;
}

export const SHAPE_LIBRARY: ShapeDef[] = [
  { id: 'circle', label: 'Circle', group: 'Basic', suggestedSize: 90 },
  { id: 'roundedSquare', label: 'Rounded square', group: 'Basic', suggestedSize: 90 },
  { id: 'square', label: 'Square', group: 'Basic', suggestedSize: 90 },
  { id: 'rectangle', label: 'Rectangle', group: 'Basic', suggestedSize: 110 },
  { id: 'hexagon', label: 'Hexagon', group: 'Basic', suggestedSize: 95 },
  { id: 'octagon', label: 'Octagon', group: 'Basic', suggestedSize: 95 },
  { id: 'triangle', label: 'Triangle', group: 'Basic', suggestedSize: 110 },
  { id: 'donut', label: 'Donut', group: 'Basic', suggestedSize: 120 },
  { id: 'heart', label: 'Heart', group: 'Fun', suggestedSize: 100 },
  { id: 'star', label: 'Star', group: 'Fun', suggestedSize: 120 },
  { id: 'flower', label: 'Flower', group: 'Fun', suggestedSize: 110 },
  { id: 'egg', label: 'Egg', group: 'Fun', suggestedSize: 95 },
  { id: 'cloud', label: 'Cloud', group: 'Fun', suggestedSize: 115 },
  { id: 'moon', label: 'Crescent moon', group: 'Fun', suggestedSize: 110 },
  { id: 'lightning', label: 'Lightning', group: 'Fun', suggestedSize: 120 },
  { id: 'speech', label: 'Speech bubble', group: 'Fun', suggestedSize: 105 },
  { id: 'human', label: 'Person', group: 'Characters', suggestedSize: 120 },
  { id: 'cat', label: 'Cat', group: 'Characters', suggestedSize: 105 },
  { id: 'paw', label: 'Paw', group: 'Characters', suggestedSize: 110 },
  { id: 'fish', label: 'Fish', group: 'Characters', suggestedSize: 120 },
  { id: 'butterfly', label: 'Butterfly', group: 'Characters', suggestedSize: 120 },
];

export type EdgeStyle = 'flat' | 'bevel';
export type ButtonLayout = 'auto' | 'grid' | 'manual';

export interface ButtonEntry {
  x: number;
  y: number;
}

/** Mesh payload (transferable). First 3 of each `numProp` stride are x,y,z. */
export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}

/** One printable object in the export. Every button is its own group so the
 *  slicer can arrange it and give it its own filament. */
export type PartGroup = 'body' | `button-${number}`;

export interface PopPart extends MeshData {
  kind: 'body' | 'inlay' | 'button';
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

/** Parameters the geometry worker needs (all mm).
 *  Frame: Z = 0 is the flat IMAGE face and the build plate; the slab runs to
 *  Z = 13 and the buttons stand proud of it. */
export interface PopBuildParams {
  baseShape: ShapeKind;
  /** Longest side of the body, mm. */
  fitSizeMm: number;
  /** Corner rounding for the roundedSquare / rectangle / speech shapes, mm. */
  cornerRadius: number;
  /** Donut only: hole ⌀ as a fraction of the body size. */
  holeRatio: number;
  /** Star only. */
  starPoints: number;
  edgeStyle: EdgeStyle;
  /** Bevel size on the top rim, mm. The bottom rim must stay square — it is the
   *  image face and it prints against the plate. */
  edgeRadius: number;

  /** Slab colour. */
  bodyRgb: RGB;
  /** Colour every button is exported in. */
  buttonRgb: RGB;
  /** Flat frame between the image edge and the body edge (outline shape), mm. */
  imageMargin: number;
  /** How deep the colour inlays sit in the image face, mm. */
  imageDepth: number;
  colorBleed: number;
  // NOTE: there is deliberately no per-region raise level here. The magnet and
  // clicker generators can emboss colours because their image face points up.
  // Ours prints face DOWN on the plate, so relief would have to grow into the
  // build plate. The image is always flush.

  /** How many pop buttons the user asked for. */
  buttonCount: number;
  buttonLayout: ButtonLayout;
  /** Extra plastic between sockets on top of the 2 mm minimum, mm. */
  buttonSpacing: number;
  /** Absolute socket centres, mm from the body centre. Read when layout is
   *  'manual'; always reported back so manual mode can seed from auto. */
  buttons: ButtonEntry[];
  /** Extra ⌀ on the bore (press fit). NOT applied to the beam or the bead — the
   *  snap interference is a fact of the CAD, not a setting. */
  buttonClearance: number;
  /** False exports the plate with empty sockets (used by the fit-test harness). */
  includeButtons: boolean;
}

/** What the builder actually made, so the UI reports the truth rather than the
 *  requested numbers. */
export interface PopReport {
  requested: number;
  placed: number;
  /** Socket centres in body coordinates, mm — where they ACTUALLY ended up. */
  positions: [number, number][];
  /** Keep-out radius per socket, mm (= outer ⌀ / 2). The drag-handle radius. */
  keepoutRadius: number;
  /** Resolved bore ⌀ after clearance, mm. */
  boreDiameter: number;
  /** Body thickness, mm — always 13, reported so the UI never hardcodes it. */
  thickness: number;
  /** Smallest body (longest side) this shape needs for ONE button, mm. */
  minBodySize: number;
  /** True when a manual position had to be walked back to stay legal. */
  clamped: number[];
  /** Body extent actually built, mm. */
  bodyWidth: number;
  bodyHeight: number;
}

// ---- Worker messages ----
export type GeometryRequest =
  | {
      type: 'buildPop';
      regions: BuildRegion[];
      outline: Ring[];
      params: PopBuildParams;
      /** The bundled pop module, fetched on the main thread and handed over once. */
      moduleBuffer?: ArrayBuffer;
    }
  /** Outlines for the shape-picker thumbnails. Asking the worker for them means
   *  the picture in the gallery is the shape the builder actually makes — a
   *  hand-drawn icon set would drift the first time a shape is tweaked. */
  | { type: 'shapePreviews'; moduleBuffer?: ArrayBuffer };

export type GeometryResponse =
  | { type: 'ready' }
  | { type: 'parts'; parts: PopPart[]; warnings: string[]; report: PopReport }
  | { type: 'previews'; previews: { id: ShapeKind; rings: Ring[] }[] }
  | { type: 'error'; message: string };
