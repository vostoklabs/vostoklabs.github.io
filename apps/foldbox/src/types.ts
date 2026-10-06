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

import type { PlateChoice } from '@vostok/viewer';
import type { Diagnostic } from '@vostok/ui-kit';

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
  /** The part of this panel a WINDOW may use, as [x, y, w, h]. Defaults to the
   *  panel's own bounding box, which is right for every panel that is a plain face.
   *
   *  It stops being right the moment a panel grows something that is not face: a hang
   *  tab on the end of a mailer's lid is part of the lid PANEL — same ply, no crease
   *  between them — but it is not part of the lid's FACE, and centring the aperture in
   *  the bounding box slides the window off the box by half the tab and then widens it
   *  to match. Nothing downstream can catch that: the window is still one ring, still
   *  inside its panel, still clear of every fold. It is simply in the wrong place. */
  windowRect?: [number, number, number, number];
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
   *  another does not z-fight. The last flap of a real box never quite reaches 90.
   *  Negative rests the panel PAST the fold instead: which side "short" lands on is
   *  the unfolded side, and for a base panel on a standing box that is under the
   *  table, so the inner base panels use a negative value. */
  undershoot?: number;
  /** Overshoot past `foldAngle` mid-flight, so a dust flap visibly tucks under the
   *  panel closing over it. Radians. */
  overshoot?: number;
  /** This panel ends up SANDWICHED between two plies of the finished box, so on a
   *  printed sheet it is built at hinge thickness rather than full sheet thickness.
   *
   *  Card gets away with a zero-clearance fit because it crushes. Rigid plastic does
   *  not: the gap a dust flap or a corner ear drops into is one caliper wide, and a
   *  part the full width of it simply jams. Roles do not answer this on their own —
   *  a mailer's inner ply and its corner ears are both `flap`, and one is structural
   *  wall that has to stay thick. So it is marked, not inferred. Tuck flaps (role
   *  `tuck`) and webbed corners (`web`) are already unambiguous and need no flag. */
  thin?: true;
  /** One half of a WEBBED CORNER, the one place a box is not a tree.
   *
   *  Every other panel hangs off exactly one parent, so its hinge is exact and it can
   *  never come away from the box. A web is cut from BOTH walls it sits between — it
   *  shares an edge with each — which makes the corner a closed kinematic loop. A tree
   *  can only hold one of those two edges, so whichever one it drops is free to swing
   *  away, and the corner visibly rips open mid-fold.
   *
   *  Marking the two halves lets the rig drive them from the wall's LIVE angle instead
   *  of from their own clock, which closes the loop exactly. `a` is the half hinged to
   *  the wall it is parented to; `b` is the half folded back over `a` on the diagonal.
   *  See the web driver in fold/rig.ts for the kinematics. */
  web?: 'a' | 'b';
  /** The INNER PLY of a hem — a wall folded back on itself, built by `rollEnd`.
   *
   *  Its crease and its parent's sit exactly `layerStep(t)` = 2 x caliper apart: 0.76 mm
   *  on the default card. That matters to the dieline, because a perforation cannot be
   *  put on both. The strip between them would be severed from both sides at every dash
   *  station and become a row of loose tabs, and one perforation through a strip that
   *  narrow relieves both folds anyway.
   *
   *  Marked at the source rather than found by measuring, because proximity cannot tell
   *  a hem from a genuinely short wall: on a 30 x 30 x 6 mm mailer in 2 mm board a
   *  distance test also matches {base -> wall} and {back -> lid}, and drops the LID's
   *  fold line. `rollEnd` is the only thing in the app that builds one of these. */
  hem?: true;
  /** Root panels only. Where this subtree's base plane sits in the assembled view,
   *  and whether it arrives upside down. A two-piece box has two roots: the tray at
   *  the origin, and the lid coming down over it from above. */
  rootPose?: {
    offset: [number, number, number];
    flip?: boolean;
    /** Extra rotation about the hinge axis as the box assembles, in radians. A tube
     *  has no base panel — its root is one of the walls — so without this the finished
     *  box stands on its front face. This rotates the whole subtree upright, in a stage
     *  of its own after every flap has folded, pivoting about the panel's bottom edge. */
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

/** A logo, before it is placed: closed rings and open lines in a UNIT box — centred on
 *  the origin, longest side exactly 1, Y-up. Produced by the UI from text or an SVG
 *  (`ui/artwork.ts`, `ui/svgLogo.ts`), consumed by `placeMarks`, which scales it onto a face. Keeping it
 *  unitless here is what lets the solver stay synchronous: fonts load asynchronously,
 *  and the net never waits on one. */
export interface Artwork {
  /** Closed rings. Outer rings CCW, holes CW, decided by nesting — see `normalizeArtwork`. */
  rings: Poly[];
  /** Open polylines: an SVG's stroke-only paths. Engraved and drawn, never printed. */
  lines: Poly[];
}

/** A logo placed on one panel, in net coordinates. The one thing on a dieline that is
 *  neither cut nor folded: it is engraved by a laser, drawn by a pen, and printed as a
 *  second colour. */
export interface Mark {
  panelId: string;
  /** Closed rings, outer CCW and holes CW, so the printable inlay can be built from them. */
  rings: Poly[];
  lines: Poly[];
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
  /** Folds that are NOT in the fold tree, and so have no `Crease`.
   *
   *  The tree holds one hinge per panel, to its parent — N panels, N-1 creases. But a panel
   *  can touch a SECOND neighbour, and where it does there is a real fold with nothing in
   *  `creases` to represent it. The webbed corner does exactly that by construction: a web
   *  triangle hinges to its twin on the diagonal (that is its tree edge) and also meets the
   *  wall it folds against (that is this). 100 mm of it on a webbed tray, 130 mm on the
   *  hinged lid, and all of it was missing from the dieline — a fold line the user has to
   *  make by eye, on the one corner in the catalogue that is hard to fold.
   *
   *  `printable.ts` never had this bug, because it grooves by geometry rather than by the
   *  tree (see `sharedEdges`), which is also where the rule is written down: if an edge has
   *  a panel on the other side of it, it folds.
   *
   *  Kept apart from `creases` rather than merged into it, because a Crease is what the
   *  fold RIG hinges on — it is keyed by panel, and a second entry for one panel would
   *  silently replace that panel's hinge. */
  webFolds: { a: Pt; b: Pt }[];
  /** The logo, if one fitted. Empty from `buildNet`; `solve` places it. */
  marks: Mark[];
  /** Which face of the sheet the marks are on.
   *
   *  'top' is the face that is up in the file, which is where a laser engraves and a
   *  pen draws. 'bottom' is the first printed layer: a printed sheet folds INTO its
   *  grooves, so its top face ends up inside the box and the underside is the outside,
   *  which is the only face a logo can be on. Marks on the bottom are stored MIRRORED,
   *  so the dieline still shows the file as it is and the logo reads correctly from
   *  below. */
  markFace: 'top' | 'bottom';
}

// ───────────────────────────── materials & machines ─────────────────────────────

/** Caliper is what every panel is actually built from, and nominal gsm does not
 *  determine it: caliper[um] = gsm x bulk[cm3/g], and the spread at a given gsm is
 *  about 50%. So a stock preset seeds the number and the user measures the real one. */
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
  { id: 'card300', name: 'Cardstock 300 gsm (16 pt)', gsm: 300, caliperMm: 0.38, note: 'The maker sweet spot: cosmetics and tuck cartons.' },
  { id: 'card350', name: 'Heavy cardstock 350 gsm (18 pt)', gsm: 350, caliperMm: 0.46, note: 'Premium feel. At the H2D blade module’s 0.5 mm ceiling.' },
  { id: 'kraft300', name: 'Kraft 300 gsm', gsm: 300, caliperMm: 0.4, note: 'Laser-scores brown, which reads as intentional on kraft.' },
  { id: 'card400', name: 'Board 400 gsm (24 pt)', gsm: 400, caliperMm: 0.55, note: 'Exceeds the H2D blade’s 0.5 mm limit, so laser or hand-cut only.' },
  { id: 'eflute', name: 'E-flute corrugated 1.6 mm', gsm: 0, caliperMm: 1.6, note: 'Laser only: the blade module cannot cut corrugated.' },
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
  /** Cuts with a BEAM rather than a blade or a pen.
   *
   *  Not cosmetic: it decides the words the fold control uses (Bambu Suite calls a laser's
   *  two options Laser Cut and Laser Line), which fold modes a machine is even offered, and
   *  the shortest dash it can make — a beam has no swivel arc to turn through. */
  laser: boolean;
  /** How this machine makes a fold line, i.e. what the control opens on. */
  foldMode: FoldMode;
  /** Every fold mode this machine can actually do, in the order the control lists them.
   *
   *  A list rather than "all four", for the reason `hangModes` is a list: a mode a machine
   *  cannot do is worse than a missing one — it looks like a setting, it silently does
   *  something else, and it goes on doing it in every saved preset made while it was there.
   *  A blade cannot score. A laser has no pen. Nothing can draw with a scoring wheel. */
  foldModes: FoldMode[];
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
  /** How a fold line has to be DRAWN in the SVG and DXF for this machine's front-end.
   *
   *  'solid'  — the front-end keeps layer names, or steps per colour, so the user
   *             assigns the blue CREASE layer to Score or Draw themselves. A
   *             continuous line is what a scoring wheel wants, and dashing it would
   *             leave them no fold layer to select.
   *  'dashed' — the front-end reads SHAPE ONLY. It drops layer names and treats colour
   *             as decoration, so a solid fold line arrives as a cut and the box comes
   *             off the mat as loose panels. Geometry is the only channel left.
   *
   *  Not a guess: Bambu Suite re-saved an import of our own SVG with all sixteen blue
   *  fold lines put back on the blade, and the user had reassigned exactly one by hand
   *  before giving up. A project file states the operation outright and needs none of
   *  this; an SVG has no way to say it. */
  svgFold: 'solid' | 'dashed';
  note: string;
}

export type FoldMode = 'score' | 'perf' | 'draw' | 'none';

export const MACHINES: Machine[] = [
  // The two answers to "I have a laser" and "I have a cutter", for everyone whose machine
  // is not in the list below — and for anyone who does not want the app deciding things
  // about their hardware. The work area is deliberately not a constraint here: the SHEET
  // is, and it has its own control, so a generic profile that also guessed an area would
  // be a second hidden limit with nothing behind it.
  //
  // They still export a `.lac`. That file is the only one that NAMES an operation, so it
  // is worth having whatever the machine is, and it needs a `machine_settings_name` —
  // see `LAC_MACHINE` for why carrying a specific Bambu name in a generic profile is
  // sound rather than a lie.
  {
    id: 'laser',
    name: 'Any laser cutter',
    // Big enough not to constrain the sheet list; the sheet is the real limit.
    areaMm: [1200, 1200],
    laser: true,
    // A dashed cut, because that is what a laser user actually cuts. Both ways work and
    // the control offers both, but the perforation is the one that has been through card
    // on a real machine and come out nice, and it does not depend on the material the way
    // a low-power score does.
    foldMode: 'perf',
    foldModes: ['perf', 'score', 'none'],
    kerfMm: 0.15,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    // Layers and colours kept, which is every front-end except Bambu Suite — and a Suite
    // user opens the .lac, which says the operation outright. A blanket dash here would
    // take away the whole fold layer from a LightBurn or Glowforge user.
    svgFold: 'solid',
    note: 'Colour and layer are the operation: CUT red, fold blue. Assign them in your own software. Folds are a dashed cut by default — change it to a light score if your machine does that well. A .lac is in the zip too, for Bambu Suite.',
  },
  {
    id: 'blade',
    name: 'Any cutting machine',
    areaMm: [1200, 1200],
    laser: false,
    foldMode: 'perf',
    // No score: a drag knife has no scoring tool, and the machines that do have one are
    // listed by name below with their own entry.
    foldModes: ['perf', 'draw', 'none'],
    kerfMm: 0,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    svgFold: 'solid',
    note: 'Colour and layer are the operation: CUT red, fold blue. Perforated folds work on any blade; a pen line needs a pen holder. A .lac is in the zip too, for Bambu Suite.',
  },
  {
    id: 'h2d-blade',
    name: 'Bambu H2D (blade + pen)',
    areaMm: [300, 285],
    laser: false,
    // Perforate, not draw. A pen line means the fold objects arrive in Suite as Drawing
    // lines and it tries to PEN-PLOT them — reported from a real cut, where they had to be
    // deleted by hand — and it costs a pen swap the machine stops for. A dashed Basic Cut
    // is one tool, one pass, and it folds faster.
    foldMode: 'perf',
    // No score: Suite has no crease operation at all, so there is nothing to offer.
    foldModes: ['perf', 'draw', 'none'],
    kerfMm: 0,
    maxCaliperMm: 0.5,
    mirror: false,
    format: 'svg',
    svgFold: 'dashed',
    note: 'Basic cut for the outline. Bambu Suite has no crease operation, so a fold is either a perforation — a dashed Basic Cut, one plate, one tool, no pause — or a Drawing line, which is a pen mark you fold by hand and costs a pen swap the machine stops for. Neither scorches.',
  },
  {
    id: 'h2d-laser',
    name: 'Bambu H2D (40 W laser)',
    areaMm: [310, 250],
    laser: true,
    // A dashed Laser Cut. Cut on cardstock on a real H2D and it came out nice — and it is
    // a real cut on every material, where a Laser Line is a fraction of cut power (18% on
    // kraft, much nearer the edge on 250 g cardstock) and so depends on the stock. The
    // control offers the Laser Line as well; this is only which one it opens on.
    foldMode: 'perf',
    foldModes: ['perf', 'score', 'none'],
    kerfMm: 0.17,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    svgFold: 'dashed',
    note: 'One plate, one process, no tool change. Folds are a dashed Laser Cut by default — a real cut on any material, and what has actually been through cardstock here. Switch them to Laser Line for a solid low-power score instead: tidier, but on paper a score is controlled charring, so expect a brown line down every fold. Bambu forbid leaving paper jobs unattended.',
  },
  {
    id: 'h2d-laser10',
    name: 'Bambu H2D (10 W laser)',
    areaMm: [310, 270],
    laser: true,
    foldMode: 'perf',
    foldModes: ['perf', 'score', 'none'],
    kerfMm: 0.07,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    svgFold: 'dashed',
    note: 'Smaller spot than the 40 W, so a finer kerf and tidier dashes, but slower on anything above 250 gsm. Folds are a dashed Laser Cut by default; Laser Line gives a solid score instead.',
  },
  {
    id: 'print',
    name: 'Plain SVG',
    // Not A4, though this option used to be "print it on A4 and cut by hand". Under a
    // name that promises a plain file, a work area is a second hidden limit with
    // nothing behind it — the same reason the two generic profiles above carry none.
    // The SHEET is the limit, and it has its own control.
    areaMm: [1200, 1200],
    laser: false,
    foldMode: 'draw',
    foldModes: ['draw', 'perf', 'none'],
    kerfMm: 0,
    maxCaliperMm: 0,
    mirror: false,
    format: 'svg',
    svgFold: 'solid',
    note: 'A plain SVG with nothing machine-specific in it: colour and layer are the operation, CUT red and fold blue, and the logo on its own layer. Print it and cut by hand, or open it in whatever software you use. Score the fold lines with a bone folder or an empty ballpoint against a ruler before folding.',
  },
];

export interface Sheet {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  /** For a build plate, the plate @vostok/plates has a mesh for, so the preview can
   *  stand the model on the bed the user actually picked. Sheets of card have none, and
   *  fall back to the plain grid. */
  plate?: PlateChoice;
  /** A sheet of card you cut, or a printer bed you print on. The two never belong
   *  in the same dropdown: which one is on offer follows from how you are making
   *  the box, and offering both is how the panel stopped making sense. */
  kind: 'sheet' | 'plate';
}

/** Sheet presets. The trap worth knowing: A4 PORTRAIT (297 tall) fits neither the
 *  H2D blade area (285) nor a 12 x 12 in cutting mat (292.1), and US 12x12 cardstock
 *  (304.8) fits no H2D process at all. */
export const SHEETS: Sheet[] = [
  { id: 'a4-land', name: 'A4 landscape (297 × 210)', widthMm: 297, heightMm: 210 , kind: 'sheet' },
  { id: 'a4', name: 'A4 portrait (210 × 297)', widthMm: 210, heightMm: 297 , kind: 'sheet' },
  { id: 'letter', name: 'US Letter (279 × 216)', widthMm: 279.4, heightMm: 215.9 , kind: 'sheet' },
  { id: 'sq12', name: '12 × 12 in cardstock (305 × 305)', widthMm: 304.8, heightMm: 304.8 , kind: 'sheet' },
  { id: 'mat12', name: 'Cutting mat 12 × 12 in (292 × 292)', widthMm: 292.1, heightMm: 292.1 , kind: 'sheet' },
  { id: 'mat24', name: 'Cutting mat 12 × 24 in (292 × 597)', widthMm: 292.1, heightMm: 596.9 , kind: 'sheet' },
  { id: 'a3', name: 'A3 (420 × 297)', widthMm: 420, heightMm: 297 , kind: 'sheet' },
  { id: 'sra3', name: 'SRA3 (450 × 320)', widthMm: 450, heightMm: 320 , kind: 'sheet' },
  // Build plates, for the printed sheet. Same mechanism as a sheet of card — the
  // fit check does not care which one you meant, and "will this blank fit" is the
  // same question on a bed as on a mat.
  // 256 first: it is the bed most people have, and the first plate in this list is
  // the one that gets picked when someone switches to printing. Defaulting to the
  // smallest bed there is meant the mode opened on an overflow error.
  { id: 'plate-256', name: 'A1 / P1 / X1 (256 × 256)', widthMm: 256, heightMm: 256 , kind: 'plate', plate: 'a1' },
  { id: 'plate-a1mini', name: 'A1 mini (180 × 180)', widthMm: 180, heightMm: 180 , kind: 'plate', plate: 'a1mini' },
  { id: 'plate-h2d', name: 'H2D (350 × 320)', widthMm: 350, heightMm: 320 , kind: 'plate', plate: 'h2d' },
];

// ───────────────────────────────── parameters ─────────────────────────────────

/** Only styles we can build correctly, and every one of them now carries an ECMA
 *  code — see `StyleMeta.ecma` in geometry/styles.ts.
 *
 *  Ordered glue-free first (ECMA Group B, tray type, no long seam glue), then the
 *  three that need one glued lap (Group A, tube type — a tube has to close on itself
 *  somewhere and only a lap does that on 300 gsm), then the loose fitment.
 *
 *  The structures come from the standard; the DIMENSIONS do not. Every derived term
 *  here is re-derived in caliper and clamped against what it has to fit inside,
 *  because the standard's own constants fail at the small end of our range. */
export type StyleId =
  // Group B — glue-free
  | 'mailer'
  | 'mailer-flaps'
  | 'tray'
  | 'tray-webbed'
  | 'tray-lid'
  | 'flap-cover'
  // Group B, basic shape 15 — the single-wall tray, locked at the corners by a claw
  | 'cake-box'
  // Group A — one glued lap
  | 'tuck-top'
  | 'snap-lock'
  | 'gable'
  | 'sleeve'
  // Group F — loose fitment
  | 'divider';

export type TuckLock = 'none' | 'friction' | 'slit';
/** How this box hangs on a peg.
 *
 *  `hole`   — the euro slot punched straight through the back wall. No extra board,
 *             and the only option a sleeve can take, because a sleeve has no closure
 *             to move out of a header's way.
 *  `single` — ECMA X61: an extended back panel above the box, one ply, slot through it.
 *  `double` — ECMA X62: the same header folded back on itself, so the slot passes
 *             through two plies. One ply of 300 gsm tears off a peg under any weight
 *             worth hanging, which is the whole reason X62 exists.
 *
 *  A header takes over the wall's top edge, so on a carton it MOVES the top closure to
 *  the opposite wall — which is exactly what ECMA's closure 21 ("tuck in flap closure
 *  system with extended back panel") describes, and why turning this on changes the
 *  style's code. */
export type HangTab = 'none' | 'hole' | 'single' | 'double';

/** The shape of the hole itself, independent of what carries it.
 *
 *  Two, because a shop has two. The euro slot is a wide low slot with a round crown on
 *  it — what most European retail packaging uses. A plain round hole is what a bare peg
 *  or a J-hook wants, it is what a narrow panel can still fit, and it is the simpler
 *  thing to cut cleanly by blade. Both keep the same 4 mm keep-out above them, so the
 *  header that carries either is sized the same way. */
export type HangHole = 'euro' | 'round';

/** Which END of a mailer the hang tab goes on. Tubes do not ask: their header owns
 *  the back wall and there is nowhere else for it.
 *
 *  A mailer does ask, and the answer is the whole point of the feature. A peg is
 *  horizontal, so whatever PLANE the slot is cut in ends up parallel to the shop's
 *  board — which means a slot in an end wall hangs the box pointing AT the customer,
 *  showing a W×H end and the lid edge-on. Every tab here is therefore in the LID's
 *  plane and past a SHORT end, so the box hangs long-axis-down with the whole printed
 *  lid facing out. Left and right are the two short ends; both keeps the blank
 *  symmetric and lets the seller hang it either way up. */
export type HangEnd = 'left' | 'right' | 'both';
export type DimBasis = 'inside' | 'outside';
export type Units = 'mm' | 'in';

/** How the box gets made. It is one decision and it changes almost everything
 *  downstream — the material, the sheet, the export, and the thickness the geometry
 *  is built for — so it is one control at the top rather than a machine dropdown
 *  next to an unrelated "print it flat" drawer. */
export type MakeMode = 'cut' | 'print';
export type LogoKind = 'none' | 'text' | 'svg';

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
  /** Which panel the aperture is cut in. Empty means the style's own default.
   *  Validated against `StyleMeta.windowFaces`, so a face carried over from another
   *  style falls back rather than cutting a hole in a panel that is not there. */
  windowFace: string;
  /** Fraction of the host panel the aperture occupies, 0..1. */
  windowScale: number;
  windowRadiusMm: number;
  /** Film insert outline offset outward from the aperture. */
  filmMarginMm: number;
  filmInsert: boolean;

  dividerCols: number;
  dividerRows: number;
  hangTab: HangTab;
  /** Header height above the box, mm. 0 derives the smallest one the slot fits in. */
  hangTabHeightMm: number;
  /** Mailers only: which short end carries the tab. Ignored by the tube styles. */
  hangEnd: HangEnd;
  /** The shape of the hole cut in whatever carries it. */
  hangHole: HangHole;

  /** Add a carry handle: raised grips on a tray, standing straps on a carry box. */
  handle: boolean;
  /** How far the handle rises above the rim or the lid. */
  handleHeightMm: number;
  /** Gable roof pitch, degrees from horizontal. Everything about the roof is derived
   *  from this one angle: the rise is (W/2)·tan, the roof panel in the flat net is
   *  (W/2)/cos long, and the fold is its complement. 30 is what the trade draws. */
  roofPitchDeg: number;
  /** Mailers only: hang a wing on each short edge of the lid, folding down inside the
   *  rolled ends. ECMA cover 53 rather than 50 — and the lid has to NEST inside the rim
   *  to carry them, so turning this on changes the lid's own size. */
  lidWings: boolean;

  // ── logo ──
  /** What goes on the box: nothing, a line of text, or an SVG the user dropped in. The
   *  artwork itself is resolved by the UI (fonts load, SVGs parse) and handed to `solve`
   *  as an `Artwork`; these fields are the recipe, so a saved project can rebuild it. */
  logo: LogoKind;
  logoText: string;
  /** A face from `@vostok/fonts` — one of the handful this app bundles. */
  logoFont: string;
  /** The SVG source, verbatim, so a project file carries its own logo. */
  logoSvg: string;
  /** What the import window decided for each path in that SVG, by path index. Carried in
   *  the project because re-tracing with defaults would quietly undo the choices — a
   *  backdrop switched off would come back the next time the file was opened. */
  logoSvgModes: Record<string, 'fill' | 'outline' | 'off'>;
  /** Which panel it goes on. Empty means the style's own front face; validated against
   *  `logoFaces`, like the window, so a face carried over from another style falls back
   *  rather than landing on a panel that is not there. */
  logoFace: string;
  /** Fraction of the face's clear area the logo may fill, 0..1. */
  logoScale: number;
  /** Quarter turns on the face, so a lid whose "up" runs sideways in the net can still
   *  read the right way on the box. */
  logoRotation: 0 | 90 | 180 | 270;

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
  /** How thick anything that tucks INSIDE the finished box is built — a dust flap, a
   *  corner ear, a tuck lug — in layers. 0 derives it from the sheet, which is what every
   *  box printed before this setting existed got: one clearance under the gap, rounded
   *  down to whole layers. Raise it to build the flaps as thick as the walls. See
   *  `sandwichThicknessMm`. */
  flapLayers: number;
  /** Width of the thinned band. A 90 degree fold in a sheet of thickness t needs
   *  roughly pi·t/2 of band before the outer face has to stretch. */
  hingeWidthMm: number;

  machineId: string;
  sheetId: string;
  /** Overrides the machine's own default when the user knows better. */
  foldMode: FoldMode;
  kerfMm: number;
  /** Size each fold's dashes from its own length and the stock, rather than from the
   *  two numbers below. On by default — a 20 mm tab and a 200 mm body fold do not want
   *  the same pitch, and picking one number for both is how a fold ends up wandering. */
  perfAuto: boolean;
  perfCutMm: number;
  perfGapMm: number;
}

export const DEFAULT_PARAMS: BoxParams = {
  style: 'mailer',
  makeMode: 'cut',
  // 90 x 60 x 25 is a small shipper, and it is the largest round size whose MAILER
  // blank still fits A4 landscape — 198 x 196 against the 287 x 200 usable area.
  // Boxes eat a lot of paper: a mailer's blank is roughly L+4H by 2W+2H+2t, so an A4
  // sheet or a 12 in cutting mat tops out near a 40 mm cube in this style. Defaulting past
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
  lidWings: false,
  window: false,
  windowFace: '',
  windowScale: 0.62,
  windowRadiusMm: 4,
  filmMarginMm: 5,
  filmInsert: true,
  dividerCols: 0,
  dividerRows: 0,
  hangTab: 'none',
  hangTabHeightMm: 0,
  hangEnd: 'right',
  hangHole: 'euro',
  handleHeightMm: 45,
  roofPitchDeg: 30,
  logo: 'none',
  logoText: '',
  logoFont: 'anton',
  logoSvg: '',
  logoSvgModes: {},
  logoFace: '',
  logoScale: 0.5,
  logoRotation: 0,
  stockId: 'card300',
  caliperMm: 0.38,
  grainAlongLength: true,
  // 2 x 0.2 = 0.40 mm sheet on a 0.20 mm hinge. 300 gsm card measures 0.38, so the
  // default printed sheet lands within a fortieth of a millimetre of the default
  // card — the same box, in a material you already have on the spool.
  layerHeightMm: 0.2,
  sheetLayers: 2,
  hingeLayers: 1,
  // The full sheet, not the derived "one clearance under the gap". Ian, 2026-09-17: a
  // flap a layer thinner than the wall slides in but never grips, and a printed box that
  // opens itself is worse than one you push home. `sandwichThicknessMm` still caps a flap
  // at the sheet, so 2 here means "as thick as the sheet" on the default 2-layer sheet.
  flapLayers: 2,
  hingeWidthMm: 1.2,
  machineId: 'h2d-blade',
  sheetId: 'a4-land',
  // Agrees with `h2d-blade` above, which is the default machine — otherwise the dropdown
  // opens on a mode the chosen machine would not have picked. Print mode renders a fold as
  // a plain crease whatever this says, so the shipped print-only dieline is unaffected.
  foldMode: 'perf',
  kerfMm: 0,
  perfAuto: true,
  // Only reached when the user turns auto off. Seeds the sliders with the mid-range of
  // what `perfSpec` produces, so switching to manual is not a visible jump.
  // The validated pair from a real cut on an H2D: 2 on, 4 off is a 33% duty perforation
  // — a perf SCORE, which relieves the fold and leaves the panel attached. The old
  // 2.5/1.2 was 68%, nearer a tear-off coupon, and turning auto sizing off dropped the
  // user straight into it.
  perfCutMm: 2.0,
  perfGapMm: 4.0,
};

export interface SolveResult {
  net: Net;
  params: BoxParams;
  diagnostics: Diagnostic[];
  /** Net bounding box size, mm. */
  netSizeMm: [number, number];
  /** True when the net does not fit the chosen sheet in either orientation. */
  overflow: boolean;
  /** What the sheet actually gives you, mm: its size less the margin the fit is
   *  measured against. Carried on the result rather than re-derived in the UI —
   *  a second copy of that subtraction is a second copy that can disagree with the
   *  one the overflow test used. */
  usableMm: [number, number];
  /** Rotate the net 90 degrees to fit. */
  rotated: boolean;
  /** The largest cube this sheet could hold in the current style — the readout that
   *  answers the question every incumbent dodges. */
  largestCubeMm: number;
  cutLengthMm: number;
  /** ECMA A x B x H, the standard's own convention: measured CENTRE TO CENTRE of the
   *  crease lines (ECMA Code s.2, p.6), not inside and not outside.
   *
   *  This is the number the trade calls "manufacture dimensions" and the one a printer
   *  quotes against, so quoting it makes our output directly comparable to anyone
   *  else's. It differs from both of ours by half a caliper per wall, which sounds
   *  like nothing until you hand the file to someone who works in it. */
  ecmaDimsMm: [number, number, number];
}
