// The pattern engine's vocabulary. Millimetres, Y up, the same ring contract as @vostok/laser
// (`Ring` is structurally the export package's `CutRing`), but nothing here imports either — a
// pattern is maths, and the package has to drop into any tool, laser or not.
//
// Two kinds of pattern. A TILED one describes one period cell and the engine repeats it; a
// FIELD one draws straight into a box (rays about a centre, a spiral, random stipple). Both
// hand back the same three kinds of geometry, because the laser cares about exactly three
// things: a closed shape it can cut out or fill, a line it can score, and a line it may cut
// THROUGH without the sheet falling apart.

export type Pt = [number, number];
/** A closed polygon, implicitly closed, either winding. */
export type Ring = Pt[];
/** An open run of points. */
export type Polyline = Pt[];
/** One island: its outer ring first, holes after. */
export type Island = Ring[];
/** Islands of rings — the same shape as @vostok/laser's `Shapes`. */
export type Shapes = Island[];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PatternGeometry {
  /** Closed shapes. As a CUT they are holes and the web between them must survive; as an
   *  ENGRAVE they are filled regions (an island may carry counters). */
  holes: Island[];
  /** Decoration lines: scored or engraved, never cut THROUGH — a lattice of cut lines is a
   *  pile of loose triangles. Under a cut they are what stays: struts, with the spaces between
   *  them cut out (`LatticeCut`). */
  lines: Polyline[];
  /** Lines that ARE safe to cut through: living-hinge slits. Scored or engraved like `lines`
   *  when the op is not a cut. */
  slits: Polyline[];
  /** Cut as a lattice only: material the lattice keeps whatever its lines do, and that a strut
   *  may land on — the hub at the heart of Rays, so every ray is held at both ends. Invisible
   *  to a score or an engrave. */
  solids?: Island[];
}

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

/** One knob. The kinds mirror the studio's field kinds so a host can render a form from
 *  `PatternDef.params` without a translation table. */
export interface ParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'toggle' | 'select';
  value: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

export type PatternFamily =
  | 'geometric'
  | 'lines'
  | 'japanese'
  | 'islamic'
  | 'textile'
  | 'hinge'
  | 'radial'
  | 'engrave'
  | 'organic'
  | 'library';

export type PatternOp = 'cut' | 'score' | 'engrave';

export interface PatternSource {
  name: string;
  licence: string;
  url?: string;
}

export interface PatternDef {
  id: string;
  name: string;
  family: PatternFamily;
  tags?: string[];
  /** One line for a picker. */
  blurb?: string;
  /** The operations the pattern was drawn for, the first the default. Every pattern CAN be cut:
   *  `cut` listed here means its own closed shapes are holes to punch (or its slits are cut);
   *  without it — a pattern of lines, a fill whose shapes touch — a cut is a LATTICE, the lines
   *  kept as struts and the spaces between them cut out (`lattice.ts`). */
  ops: PatternOp[];
  params: ParamSpec[];
  /** Tiled: the period, in mm, at these params. */
  cell?(p: Params): { w: number; h: number };
  /** Tiled: one period drawn on 0..w × 0..h, Y up, with the motif centred on the cell's centre
   *  where there is a single motif. It may draw past the cell; the fill clips. Edges shared
   *  between neighbouring cells may be drawn by both — the engine merges duplicate and
   *  collinear line segments before anything is scored twice. */
  tile?(p: Params): PatternGeometry;
  /** Field: geometry covering `box` (pattern space, the region's centre at the origin). */
  generate?(box: Box, p: Params): PatternGeometry;
  /** Cut: the narrowest web the pattern leaves between its own holes at these params, mm. The
   *  fill warns when it is under the caller's minimum. Absent: the holes never approach one
   *  another (one hole per cell with the gap as a parameter says so through this). */
  web?(p: Params): number;
  /** Provenance for imported tiles (an MIT library, a customer's own SVG). */
  source?: PatternSource;
  /** How a picker tile shows this pattern: params that read at 40 mm, an overall scale, and for
   *  a tiled pattern how many periods span the tile (default 3). */
  thumb?: { params?: Partial<Params>; scale?: number; periods?: number };
  /** The width, mm, the pattern's lines are ENGRAVED at when the host asks for engraved
   *  lines — a tile library's stroke slider. Absent: lines engrave as hairlines. */
  strokeWidth?(p: Params): number;
  /** How far, mm at these params, a host with a boolean erodes the painted region before it
   *  engraves it or scores its outline (`FillResult.erode`): a tile whose lines BETWEEN its
   *  shapes are drawn thinner than a laser reads them, drawn thicker by twice this. */
  erode?(p: Params): number;
}

export interface FillOptions {
  op: PatternOp;
  params?: Partial<Params>;
  /** Rotate the pattern about the region's centre, degrees, counter-clockwise. */
  angle?: number;
  /** Slide the pattern, mm, in the region's frame. */
  dx?: number;
  dy?: number;
  /** Uniform scale on top of the params (1 = as given). */
  scale?: number;
  /** Air between the pattern and the region's edge, mm. Default: `web` for a cut, 0 otherwise. */
  inset?: number;
  /** Cut: the least material to leave between a cut and the edge, and between one cut and the
   *  next — a hole nearer the edge than this is dropped. Default 1.5 (3 mm ply wants ≥ the
   *  material thickness; never under 1). */
  web?: number;
  /** A hole that crosses the (inset) edge: drop it, keep it whole for the host to clip, or
   *  clip it here — exact for convex holes; a concave one needs `clipPolygons`, else it is
   *  kept whole. Default: cut → drop, engrave → clip. */
  partial?: 'drop' | 'keep' | 'clip';
  /** A polygon boolean from the host (manifold's CrossSection intersect, say) for clipping
   *  concave holes. `subject ∩ clip`, islands in, islands out. */
  clipPolygons?: (subject: Shapes, clip: Shapes) => Shapes;
  /** Where the pattern's origin sits: the region's centre (default: a symmetric shape gets a
   *  symmetric fill) or its bottom-left corner. */
  align?: 'centre' | 'corner';
  /** Cut only: hand slits back as thin closed slots of this width instead of open paths, for a
   *  host whose cut layer takes closed shapes only. */
  slitWidth?: number;
  /** Engrave only: widen every line into a filled band this wide, mm, so a lines pattern
   *  engraves as strokes rather than hairlines. Default: the pattern's own `strokeWidth`, else
   *  hairlines (`paths`). The bands overlap at their joins; a host unions them. */
  strokeWidth?: number;
  /** Cut only: the narrowest finger of wood a cut may leave inside one opening, mm — a band between
   *  two arms of one shape, which a kerf thins from both sides (round 7). A shape holding a thinner
   *  one is cut only where it holds a 0.8 mm slot. Default 0.4, two kerf walls; a hinge is exempt. */
  thinnest?: number;
  /** Score only: the host traces the outline of what the closed shapes paint — their UNION —
   *  itself, with a polygon boolean (`FillResult.outline`). Without it the fill traces it here,
   *  by parity, which is exact only where shapes meet edge to edge. */
  hostOutline?: boolean;
}

export interface FillStats {
  /** Cells the tiler laid down (0 for a field pattern). */
  cells: number;
  /** Closed shapes that survived. */
  holes: number;
  /** Closed shapes dropped at the edge or for the web rule. */
  dropped: number;
  /** Open runs that survived. */
  lines: number;
  /** Total length of the lines, mm. */
  lineLength: number;
  /** Total area of the closed shapes, mm². */
  area: number;
  /** Cut as a lattice: the strut runs (their centreline length is `lineLength`). */
  struts: number;
  /** Concave holes that crossed the edge and were kept whole because no `clipPolygons` was
   *  given — the host must clip them. */
  unclipped: number;
  /** Cut: pieces of holes that crossed the zone's edge and were clipped to it — cut as Engrave
   *  shows them, never dropped whole. */
  clipped?: number;
  /** Cut: holes, or pieces of them, under the floors a laser cuts cleanly (a slot narrower than
   *  0.8 mm at their widest, or under 2 mm²) — left as wood. */
  tooSmall?: number;
  /** Cut: holes that gave way to hold the web — each closer than the web to another, shrunk by
   *  half the shortfall all round. */
  gaveWay?: number;
}

export interface FillResult {
  op: PatternOp;
  /** Closed shapes, one island each: the cut-outs (cut) or the filled regions (engrave), or
   *  the closed outlines that survived whole (score). */
  shapes: Shapes;
  /** Open runs: score/engrave lines, or cut slits. */
  paths: Polyline[];
  /** Cut, when the pattern is cut as a LATTICE: the recipe for the faces, which take a polygon
   *  boolean this package does not have. `shapes` and `paths` are then empty; the host runs
   *  `latticeFaces(lattice, itsBooleans)` for the holes. */
  lattice?: LatticeCut;
  /** Score with `hostOutline`: the closed shapes, as they lie (not clipped), whose painted region
   *  the host unions — closing gaps of a few microns — and scores the outline of, clipped AS LINES
   *  to `zone` (the region less its margin). `paths` then holds the pattern's lines only. */
  outline?: { shapes: Shapes; zone: Shapes };
  /** Engrave: where `shapes` must be trimmed by the host — set when an island crossing the zone's
   *  edge could not be clipped here and is handed on whole (`stats.unclipped`). */
  zone?: Shapes;
  /** Engrave and score: erode the painted region by this, mm, before burning it
   *  (`PatternDef.erode`). */
  erode?: number;
  stats: FillStats;
  warnings: string[];
}

/**
 * A pattern cut out as a lattice: the lines stay as wooden struts `web` wide and the faces
 * between them are cut away — what every laser-cut lattice card is.
 *
 * The faces are `region` shrunk by `inset`, less `solids`, less a strut round every run: polygon
 * booleans, so the recipe travels to the host (the studio's worker) and `latticeFaces` does all
 * of it there — pruning the dead ends, building the struts, the booleans and the rules. Plain
 * data, so it survives `postMessage`.
 */
export interface LatticeCut {
  /** The pattern's name, for the sentences the cut may have to say. */
  name: string;
  /** The region as the caller gave it. Its holes are reserves (a monogram's patch, a card's
   *  panel) — the faces keep `inset` off them as off the outer edge. */
  region: Shapes;
  /** How far in from every edge of the region the faces start, mm; at least `web`. A frame of
   *  material that wide runs round the lattice, and every strut lands on it. */
  inset: number;
  /** The pattern's lines — the centrelines of the struts — clipped to the region. */
  runs: Polyline[];
  /** Closed shapes whose OUTLINE is more of the lines: a fill tile's shapes that touch. The
   *  outline is the boundary of what they cover by the even-odd rule — an edge two cells share
   *  cancels, an edge where one shape crosses another stays — exactly the drawing a Score of
   *  them burns. Traced by the host (`LatticeHost.outline`), because on a library tile that is
   *  a hundred thousand edges and a boolean does it in milliseconds. Near the region only. */
  outlines: Ring[];
  /** Material kept whatever the lines do, that a strut may land on: the pattern's own (the hub
   *  of Rays) and anything the host holds out of the lattice (a keep-out box). */
  solids: Shapes;
  /** The strut width, mm. */
  web: number;
  /** A face that cannot hold a disc this wide is left as material, mm. */
  minWidth: number;
  /** A face smaller than this is left as material, mm². */
  minArea: number;
  /** The zoom the pattern is drawn at (1 = 100 %), so a sentence can name the zoom that cuts. */
  scale: number;
  /** A tiled pattern's period at that zoom, mm (its cell's shorter side): a piece narrower than
   *  that is too small for the pattern, not the pattern too fine for it. */
  period?: number;
  /** The pattern's SHAPES as islands, as Engrave draws them, so the host can tell motifs from a
   *  lattice by topology — shapes that stand apart on one background (stars, snowflakes, a tile's
   *  motifs split by its cell's seams) are cut out as themselves, shapes that join into a network
   *  are the lattice's outlines. Tried first when no line reaches the region; after a lattice of
   *  the lines that cut nothing, otherwise. Near the region only. */
  shapes?: Shapes;
  /** A pattern drawn in STROKES (a library stroke tile): the width Engrave burns its lines at, mm.
   *  When its lines hold no lattice, its strokes may still stand apart on one background — plus
   *  signs, star outlines — and are then cut out as themselves. */
  stroke?: number;
  /** A library tile drawn in HAIRLINES — lines with no width of their own (Circles - 4's rings):
   *  when its lattice cuts nothing, the shapes its lines close may still stand apart, and are then
   *  cut out as themselves (`latticeFaces`' rule 0, on a band a kerf wall wide round each line). */
  hairline?: boolean;
  /** A hole pattern's holes, handed over by `fillShape` to say why they are not all cut (too small,
   *  too tight, parts left as wood): rule 0 cuts them as motifs — holes on one ground, never a
   *  network, never a lattice of their outlines — and says why, with a zoom it has tried. */
  holes?: boolean;
  /** A field's holes (a pattern generated for the region, not a tile): at another zoom the field is
   *  drawn afresh, not the same holes grown, so a zoom tried here is the drawing's likeness only —
   *  a "Parts of …" names none. */
  field?: boolean;
  /** A pattern drawn in strokes or hairlines: its lines as drawn, in its own space, and the fill's
   *  similarity — so the worker places them at any zoom exactly as the fill would: the ink rule 0
   *  cuts as motifs (to the region's box, never clipped round a panel), and the lines a zoom a
   *  sentence names is tried on. */
  drawn?: DrawnLines;
  /** The point of the region the pattern grows from as the Zoom slider moves (the pattern's own
   *  origin, where the fill put it): at k times the zoom every shape is k times as far from it. So
   *  a sentence that names a zoom can be tried at that zoom first, on these shapes scaled. */
  origin?: Pt;
  /** The narrowest finger of wood a motif or hole cut may leave inside one opening, mm ("Thinnest
   *  wood"; round 7). Absent: 0.4, two kerf walls. */
  thinnest?: number;
}

/** A pattern's lines in its own space and the similarity the fill put them in the region with:
 *  region = c + R·(p·scale + (o − c)) + d, R the rotation (cos, sin) — `fillShape`'s `toRegion`. */
export interface DrawnLines {
  lines: Polyline[];
  c: Pt;
  o: Pt;
  cos: number;
  sin: number;
  d: Pt;
}

/** What `latticeFaces` did, for a status line or a test. */
export interface LatticeStats {
  /** Faces cut out. */
  faces: number;
  /** The pattern's cells, counted at zero width before any strut is built — the ones inside
   *  the pattern, not the partial cells the frame trims off its edge (unless those are all
   *  there is). What `coverage` is a share of. */
  cells: number;
  /** Faces left as material because they are under `minWidth` / `minArea` — confetti. */
  tooSmall: number;
  /** Faces cut out WHOLE because a ring of strut floated inside them, unattached — the ring
   *  goes with the offcut rather than falling out of the bed on its own. */
  loose: number;
  /** Faces left as material because cutting them would have emptied their region — the
   *  background round motifs that never touch, a cell as big as a quarter of the piece — or
   *  dropped a structure or one of the region's reserves with it. */
  solid: number;
  /** Pieces of line taken away before the struts were built: every piece that hangs — a ray with
   *  nothing at its tip, a stub, a spiral's coil, a ring on a stick — and every free speck too
   *  narrow to hold a cut (a plaid's stitch mark). A cantilever is not a lattice. */
  pruned: number;
  /** Line ends carried onto what they nearly met — straight on to a line or the frame within
   *  two webs, or to the nearest within one: a near miss is a join, or two faces a hair apart. */
  snapped: number;
  /** Faces left as material because another face came closer than the web — what is left of a
   *  near miss after `snapped`. Zero on every pattern the studio ships. */
  tight: number;
  /** Faces left as material because each wraps round wood that would hang on a neck under the
   *  web — a panel held by grazing struts, a motif on a stick. The web between a face and itself. */
  necks: number;
  /** Hairline strips — parts of a face narrower than `minWidth` and more than twice as long —
   *  taken off the faces: a crack where two struts' sides meet, a face tapering into a corner. */
  trimmed: number;
  /** The share of the openable area — the region less its struts, less the background round
   *  motifs that never touch — that was cut, 0–1. Under `OPEN_SHARE_MIN`, nothing is cut. */
  open: number;
  /** The share of `cells` that were cut, 0–1 — a cell whose face vanished under its struts
   *  counts as much as one left as confetti… */
  coverage: number;
  /** …and the share of their area. Under both `COVERAGE_MIN` and `AREA_MIN`, nothing is cut. */
  areaCoverage: number;
  /** Cut as MOTIFS, not a lattice: the pattern's shapes stand apart on one background, so each
   *  is cut out as itself at its drawn size, clipped at the zone's edge (`faces` of them;
   *  `tooSmall` stayed wood under the floors). */
  motifs?: boolean;
  /** Motifs that gave way to hold the web — each closer than the web to another, shrunk by half
   *  the shortfall all round. */
  gaveWay?: number;
}
