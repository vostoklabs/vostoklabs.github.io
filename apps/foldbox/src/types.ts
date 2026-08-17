// Shared types for the fold-up box generator.
//
// The whole app rests on one fact from the research: a box net's fold graph is a
// TREE — formally a spanning tree of the face-adjacency dual graph. N panels give
// exactly N-1 fold edges and zero cycles, so there is no constraint solver here
// and none is needed. What follows from that is the load-bearing idea:
//
//     tree edges are the CREASES.  non-tree edges are the CUTS.
//
// So a style builder never authors a silhouette AND a fold rig. It authors panels
// with a parent and a fold angle, and `buildNet` derives both. The silhouette can
// then never disagree with the panels, and no builder can emit a crease it forgot
// to cut around.

/** A point in net (layout) coordinates: millimetres, Y-up, origin bottom-left. */
export type Pt = [number, number];

/** A closed polygon. First point is NOT repeated at the end. */
export type Poly = Pt[];

/** What a ring or segment tells the machine to do. The set is deliberately small:
 *  every one of these maps to a real operation on at least two target machines. */
export type Op = 'cut' | 'crease' | 'perf' | 'film' | 'engrave';

export type PanelRole = 'body' | 'flap' | 'tuck' | 'glue' | 'lid' | 'base' | 'insert';

/** One flat face of the box, in net coordinates.
 *
 *  `parent` and `foldAngle` are the only fold authoring a builder does. The hinge
 *  segment itself is DERIVED — it is whatever edge this panel shares with its
 *  parent — which is why a builder cannot get the two out of step. */
export interface Panel {
  id: string;
  /** Shown on the dieline and in the assembly sheet. */
  label: string;
  role: PanelRole;
  /** Counter-clockwise outer boundary. */
  outline: Poly;
  /** Apertures: window, thumb notch, handle hole. Each cut as its own closed ring. */
  holes: Poly[];
  /** null for the root — the panel that stays still while everything folds onto it. */
  parent: string | null;
  /** Signed radians. Positive = valley (folds up toward the viewer, the printed face
   *  going inward). Negative = mountain. The sign is what the exporter turns into a
   *  reverse-fold layer: Cricut folds INTO the score, so a mountain crease scored
   *  from the same side cracks. */
  foldAngle: number;
  /** Animation order override. Default is the panel's depth in the fold tree, which
   *  already reproduces "walls up, then dust flaps, then tuck last" on every style. */
  order?: number;
  /** Stop short of `foldAngle` by this much at t=1, so a flap that lands on top of
   *  another does not z-fight. The last flap of a real box never quite reaches 90. */
  undershoot?: number;
  /** Overshoot past `foldAngle` mid-flight, so a dust flap visibly tucks under the
   *  panel closing over it. Radians. */
  overshoot?: number;
  /** Root panels only. Where this subtree's base plane sits in the assembled view,
   *  and whether it arrives upside down. A two-piece box has two roots: the tray at
   *  the origin, and the lid coming down over it from above. */
  rootPose?: {
    offset: [number, number, number];
    flip?: boolean;
    /** Extra rotation about the hinge axis as the box assembles, in radians. A tube
     *  has no base panel — its root is one of the walls — so without this the finished
     *  box stands on its front face. This rotates the whole subtree upright. */
    tilt?: number;
  };
}

/** An open cut that lives INSIDE a panel rather than on its boundary — a slit lock,
 *  a lock slot, a tear line. Not a hole: it has no area. */
export interface Slit {
  panelId: string;
  op: Op;
  /** Open polyline. */
  points: Poly;
}

/** What a builder returns. */
export interface StyleParts {
  panels: Panel[];
  slits: Slit[];
  /** The panel that stays still. Defaults to the first panel with `parent: null`. */
  rootId: string;
  /** Extra closed rings that are not part of the folded box — the window film insert,
   *  divider strips, a separate lid blank. Each is its own free-standing part. */
  loose: LoosePart[];
  /** Human-readable assembly steps, in order. The fold tree gives the ordering; the
   *  builder supplies the words for the steps a tree cannot describe (glue, insert). */
  assembly: string[];
}

/** A part that is cut but not folded as part of the main tree — the film insert, a
 *  divider strip, the separate lid of a two-piece box (which is its own little net). */
export interface LoosePart {
  id: string;
  label: string;
  op: Op;
  outline: Poly;
  holes: Poly[];
  /** If this loose part is itself a foldable net (a two-piece box's lid), its panels
   *  live here and fold as their own tree, offset by the part's own placement. */
  sub?: StyleParts;
}

/** A derived fold: the shared edge between a panel and its parent. */
export interface Crease {
  /** Child panel id. The parent is `panel.parent`. */
  panelId: string;
  parentId: string;
  /** The hinge segment in NET coordinates, ordered so the child lies to the left of
   *  a -> b. That ordering is what fixes the sign of the fold. */
  a: Pt;
  b: Pt;
  foldAngle: number;
  dir: 'mountain' | 'valley';
  /** Depth in the fold tree. Drives the animation stage and the assembly order. */
  depth: number;
  /** Zero for cardstock. The V-groove width for the phase-2 printed net, where a
   *  fold is a finite band of thinned material rather than a line. */
  creaseWidthMm: number;
}

/** Everything derived from a builder's panels. */
export interface Net {
  panels: Panel[];
  creases: Crease[];
  slits: Slit[];
  loose: LoosePart[];
  /** The blank's outline(s), walked from every panel edge that has no twin. Outer
   *  rings wound CCW, holes CW. A correct net is exactly ONE outer ring. */
  cutRings: Poly[];
  rootId: string;
  assembly: string[];
  bbox: [number, number, number, number];
  /** Total path length by operation, mm — drives the time and cost readout. */
  lengthByOp: Record<Op, number>;
}

// ───────────────────────────── materials & machines ─────────────────────────────

/** Caliper is what every panel is actually built from, and nominal gsm does not
 *  determine it: caliper[um] = gsm x bulk[cm3/g], and the spread at a given gsm is
 *  about 50%. So a stock preset seeds the number and the user measures the real one.
 *  Exactly the lesson the laser-slot generator learned about "3 mm" acrylic. */
export interface Stock {
  id: string;
  name: string;
  gsm: number;
  caliperMm: number;
  note?: string;
}

export const STOCKS: Stock[] = [
  { id: 'card200', name: 'Light card 200 gsm (12 pt)', gsm: 200, caliperMm: 0.25, note: 'Lightweight cartons. Folds easily, holds little.' },
  { id: 'card250', name: 'Card 250 gsm (14 pt)', gsm: 250, caliperMm: 0.31, note: "Bambu's own A4 cardstock. Standard retail and soap boxes." },
  { id: 'card300', name: 'Cardstock 300 gsm (16 pt)', gsm: 300, caliperMm: 0.38, note: 'The maker sweet spot — cosmetics and tuck cartons.' },
  { id: 'card350', name: 'Heavy cardstock 350 gsm (18 pt)', gsm: 350, caliperMm: 0.46, note: 'Premium feel. At the H2D blade module’s 0.5 mm ceiling.' },
  { id: 'kraft300', name: 'Kraft 300 gsm', gsm: 300, caliperMm: 0.4, note: 'Laser-scores brown, which reads as intentional on kraft.' },
  { id: 'card400', name: 'Board 400 gsm (24 pt)', gsm: 400, caliperMm: 0.55, note: 'Exceeds the H2D blade’s 0.5 mm limit — laser or hand-cut only.' },
  { id: 'eflute', name: 'E-flute corrugated 1.6 mm', gsm: 0, caliperMm: 1.6, note: 'Laser only — the blade module cannot cut corrugated.' },
];

/** A cutting machine, and the constraints it actually imposes on the file.
 *
 *  Note the H2D's blade area (300x285) and laser area (310x270 / 310x250) DIFFER.
 *  A net that blade-cuts may not laser-score, and nobody catches that until the job
 *  fails, so the two are separate entries rather than one "H2D". */
export interface Machine {
  id: string;
  name: string;
  /** Work area, mm. */
  areaMm: [number, number];
  /** How this machine makes a fold line. */
  foldMode: FoldMode;
  /** Beam or blade width, mm. Every path is offset by half of it. A drag knife is
   *  effectively zero; a 40 W diode at 0.14 x 0.2 mm spot is ~0.17. */
  kerfMm: number;
  /** Material thickness ceiling, mm. 0 = no meaningful limit. */
  maxCaliperMm: number;
  /** Cut face-down, so asymmetric artwork must be mirrored. True for any machine that
   *  folds INTO the score — Cricut says so explicitly. */
  mirror: boolean;
  /** Preferred export for this machine, shown in the README. */
  format: 'svg' | 'dxf';
  note: string;
}

export type FoldMode = 'score' | 'perf' | 'draw' | 'none';

export const MACHINES: Machine[] = [
  {
    id: 'h2d-blade',
    name: 'Bambu H2D — blade + pen',
    areaMm: [300, 285],
    foldMode: 'draw',
    kerfMm: 0,
    maxCaliperMm: 0.5,
    mirror: false,
    format: 'svg',
    note: 'Basic cut for the outline, Drawing line for the fold marks — one plate, one pen swap, and the machine pauses for it. No scorch. Bambu Suite has no crease operation, so the folds are pen marks you fold by hand.',
  },
  {
    id: 'h2d-laser',
    name: 'Bambu H2D — 40 W laser',
    areaMm: [310, 250],
    foldMode: 'score',
    kerfMm: 0.17,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    note: 'Laser cut outline + low-power Laser line folds, one plate, no tool change. Laser-scoring paper is controlled charring: expect a brown line down every fold. Bambu forbid leaving paper jobs unattended.',
  },
  {
    id: 'h2d-laser10',
    name: 'Bambu H2D — 10 W laser',
    areaMm: [310, 270],
    foldMode: 'score',
    kerfMm: 0.07,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    note: 'Smaller spot than the 40 W, so a finer kerf and a tidier score — but slower on anything above 250 gsm.',
  },
  {
    id: 'cricut-maker',
    name: 'Cricut Maker (12 × 12 mat)',
    areaMm: [292, 292],
    foldMode: 'score',
    kerfMm: 0,
    maxCaliperMm: 2.4,
    mirror: true,
    format: 'svg',
    note: 'Scoring Wheel scores properly, but 100 lb+ cardstock needs the Double wheel. Import, set the blue layer to Score, then ATTACH — without Attach the folds lose registration.',
  },
  {
    id: 'cricut-explore',
    name: 'Cricut Explore (12 × 12 mat)',
    areaMm: [292, 292],
    foldMode: 'perf',
    kerfMm: 0,
    maxCaliperMm: 1,
    mirror: true,
    format: 'svg',
    note: 'No scoring wheel on this machine — the Scoring Stylus is light-duty only, so perforated folds are the reliable default here.',
  },
  {
    id: 'cricut-long',
    name: 'Cricut (12 × 24 mat)',
    areaMm: [292, 596],
    foldMode: 'score',
    kerfMm: 0,
    maxCaliperMm: 2.4,
    mirror: true,
    format: 'svg',
    note: 'The long mat is the only way to get a box much past 70 mm on a Cricut.',
  },
  {
    id: 'silhouette',
    name: 'Silhouette Cameo',
    areaMm: [292, 292],
    foldMode: 'perf',
    kerfMm: 0,
    maxCaliperMm: 2,
    mirror: false,
    format: 'dxf',
    note: 'The free edition of Silhouette Studio cannot open SVG at all — use the DXF, and re-set the size after import because DXF import drops it.',
  },
  {
    id: 'glowforge',
    name: 'Glowforge',
    areaMm: [279, 495],
    foldMode: 'score',
    kerfMm: 0.15,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    note: 'Colour maps to operation directly. Give every path a stroke and no fill, or a fill becomes an engrave.',
  },
  {
    id: 'print',
    name: 'Print & cut by hand',
    areaMm: [210, 297],
    foldMode: 'draw',
    kerfMm: 0,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    note: 'Fold lines print as light dashes. Score them with a bone folder or an empty ballpoint against a ruler before folding.',
  },
];

export interface Sheet {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  /** A sheet of card you cut, or a printer bed you print on. The two never belong
   *  in the same dropdown: which one is on offer follows from how you are making
   *  the box, and offering both is how the panel stopped making sense. */
  kind: 'sheet' | 'plate';
}

/** Sheet presets. The trap worth knowing: A4 PORTRAIT (297 tall) fits neither the
 *  H2D blade area (285) nor a Cricut 12x12 mat (292.1), and US 12x12 cardstock
 *  (304.8) fits no H2D process at all. */
export const SHEETS: Sheet[] = [
  { id: 'a4-land', name: 'A4 landscape (297 × 210)', widthMm: 297, heightMm: 210 , kind: 'sheet' },
  { id: 'a4', name: 'A4 portrait (210 × 297)', widthMm: 210, heightMm: 297 , kind: 'sheet' },
  { id: 'letter', name: 'US Letter (279 × 216)', widthMm: 279.4, heightMm: 215.9 , kind: 'sheet' },
  { id: 'sq12', name: '12 × 12 in cardstock (305 × 305)', widthMm: 304.8, heightMm: 304.8 , kind: 'sheet' },
  { id: 'mat12', name: 'Cricut 12 × 12 mat (292 × 292)', widthMm: 292.1, heightMm: 292.1 , kind: 'sheet' },
  { id: 'mat24', name: 'Cricut 12 × 24 mat (292 × 597)', widthMm: 292.1, heightMm: 596.9 , kind: 'sheet' },
  { id: 'a3', name: 'A3 (420 × 297)', widthMm: 420, heightMm: 297 , kind: 'sheet' },
  { id: 'sra3', name: 'SRA3 (450 × 320)', widthMm: 450, heightMm: 320 , kind: 'sheet' },
  // Build plates, for the printed sheet. Same mechanism as a sheet of card — the
  // fit check does not care which one you meant, and "will this blank fit" is the
  // same question on a bed as on a mat.
  // 256 first: it is the bed most people have, and the first plate in this list is
  // the one that gets picked when someone switches to printing. Defaulting to the
  // smallest bed there is meant the mode opened on an overflow error.
  { id: 'plate-256', name: 'Build plate — A1 / P1 / X1 (256 × 256)', widthMm: 256, heightMm: 256 , kind: 'plate' },
  { id: 'plate-a1mini', name: 'Build plate — A1 mini (180 × 180)', widthMm: 180, heightMm: 180 , kind: 'plate' },
  { id: 'plate-mk4', name: 'Build plate — Prusa MK4 (250 × 210)', widthMm: 250, heightMm: 210 , kind: 'plate' },
  { id: 'plate-h2d', name: 'Build plate — H2D (350 × 320)', widthMm: 350, heightMm: 320 , kind: 'plate' },
];

// ───────────────────────────────── parameters ─────────────────────────────────

/** Only styles we can build correctly. The first three are transcribed from
 *  production dielines and need no glue at all; see geometry/styles.ts. */
export type StyleId =
  | 'mailer'
  | 'handle-box'
  | 'tray'
  | 'tray-lid'
  | 'tuck-top'
  | 'snap-lock'
  | 'sleeve'
  | 'divider';

export type TuckLock = 'none' | 'friction' | 'slit';
export type DimBasis = 'inside' | 'outside';
export type Units = 'mm' | 'in';

/** How the box gets made. It is one decision and it changes almost everything
 *  downstream — the material, the sheet, the export, and the thickness the geometry
 *  is built for — so it is one control at the top rather than a machine dropdown
 *  next to an unrelated "print it flat" drawer. */
export type MakeMode = 'cut' | 'print';

export interface BoxParams {
  style: StyleId;
  makeMode: MakeMode;

  lengthMm: number;
  widthMm: number;
  heightMm: number;
  dimBasis: DimBasis;
  units: Units;

  /** Two-piece lid depth. */
  lidHeightMm: number;
  /** Per-side play between lid and tray, on top of the 2t nesting term. */
  lidPlayMm: number;
  /** 0 = derive it, clamped against both W and H. */
  tuckDepthMm: number;
  tuckLock: TuckLock;
  glueTabMm: number;
  thumbNotch: boolean;

  window: boolean;
  /** Fraction of the host panel the aperture occupies, 0..1. */
  windowScale: number;
  windowRadiusMm: number;
  /** Film insert outline offset outward from the aperture. */
  filmMarginMm: number;
  filmInsert: boolean;

  dividerCols: number;
  dividerRows: number;
  hangHole: boolean;

  /** Add a carry handle: raised grips on a tray, standing straps on a carry box. */
  handle: boolean;
  /** How far the handle rises above the rim or the lid. */
  handleHeightMm: number;
  /** Mailer only: cut a hand hole through both plies of each rolled end. */
  handHoles: boolean;

  stockId: string;
  /** MEASURED caliper, mm. Not the number on the packet. */
  caliperMm: number;
  grainAlongLength: boolean;

  // ── printed sheet (phase 2) ──
  /** Print the net flat as a thin sheet and fold it once. These four only affect
   *  the 3MF/STL; the dieline is the same file either way. */
  layerHeightMm: number;
  /** Total sheet thickness, in layers. Two layers of 0.2 is 0.4 mm, which is what
   *  300 gsm card measures — that is the whole idea. */
  sheetLayers: number;
  /** What is left under a fold line. Equal to `sheetLayers` means no groove. */
  hingeLayers: number;
  /** Width of the thinned band. A 90 degree fold in a sheet of thickness t needs
   *  roughly pi·t/2 of band before the outer face has to stretch. */
  hingeWidthMm: number;

  machineId: string;
  sheetId: string;
  /** Overrides the machine's own default when the user knows better. */
  foldMode: FoldMode;
  kerfMm: number;
  perfCutMm: number;
  perfGapMm: number;
}

export const DEFAULT_PARAMS: BoxParams = {
  style: 'mailer',
  makeMode: 'cut',
  // 90 x 60 x 25 is a small shipper, and it is the largest round size whose MAILER
  // blank still fits A4 landscape — 198 x 196 against the 287 x 200 usable area.
  // Boxes eat a lot of paper: a mailer's blank is roughly L+4H by 2W+2H+2t, so an A4
  // sheet or a Cricut mat tops out near a 40 mm cube in this style. Defaulting past
  // that means opening the app on an error, which is how the incumbents do it.
  lengthMm: 90,
  widthMm: 60,
  heightMm: 25,
  dimBasis: 'inside',
  units: 'mm',
  lidHeightMm: 22,
  lidPlayMm: 0.4,
  tuckDepthMm: 0,
  tuckLock: 'slit',
  glueTabMm: 12,
  thumbNotch: true,
  handle: true,
  handHoles: false,
  window: false,
  windowScale: 0.62,
  windowRadiusMm: 4,
  filmMarginMm: 5,
  filmInsert: true,
  dividerCols: 0,
  dividerRows: 0,
  hangHole: false,
  handleHeightMm: 45,
  stockId: 'card300',
  caliperMm: 0.38,
  grainAlongLength: true,
  // 2 x 0.2 = 0.40 mm sheet on a 0.20 mm hinge. 300 gsm card measures 0.38, so the
  // default printed sheet lands within a fortieth of a millimetre of the default
  // card — the same box, in a material you already have on the spool.
  layerHeightMm: 0.2,
  sheetLayers: 2,
  hingeLayers: 1,
  hingeWidthMm: 1.2,
  machineId: 'h2d-blade',
  sheetId: 'a4-land',
  foldMode: 'draw',
  kerfMm: 0,
  perfCutMm: 5,
  perfGapMm: 5,
};

/** A problem the user has to fix, in the user's language, with what to do about it. */
export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  fix?: string;
}

export interface SolveResult {
  net: Net;
  params: BoxParams;
  diagnostics: Diagnostic[];
  /** Net bounding box size, mm. */
  netSizeMm: [number, number];
  /** True when the net does not fit the chosen sheet in either orientation. */
  overflow: boolean;
  /** Rotate the net 90 degrees to fit. */
  rotated: boolean;
  /** The largest cube this sheet could hold in the current style — the readout that
   *  answers the question every incumbent dodges. */
  largestCubeMm: number;
  cutLengthMm: number;
}
