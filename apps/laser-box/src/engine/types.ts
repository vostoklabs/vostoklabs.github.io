// The box engine's vocabulary. Pure data, millimetres, no DOM and no WASM: everything in
// ./slabs.ts, ./boxes.ts and ./frames.ts runs in node as it runs in the page.
//
// World frame: X runs left → right across the FRONT of the box, Y runs front → back, Z runs up
// from the table. The box's outside corner sits at the origin, so the box is [0, L] × [0, W] ×
// [0, H]. A piece's own 2D frame is Y up, like every other laser tool in the repo.

export type Pt = [number, number];
export type Ring = Pt[];
/** Islands of rings: each island's outer ring first, its holes after. */
export type Shapes = Ring[][];
export type V3 = [number, number, number];
/** 0 = X, 1 = Y, 2 = Z. */
export type Axis = 0 | 1 | 2;

export interface AABB {
  min: V3;
  max: V3;
}

/**
 * One flat piece where it sits in the assembled box, as the whole block of material it would
 * be before any joint is cut into it. Where two slabs overlap, a `Joint` (or, at a corner shared
 * by three, the `rank`) says which of them keeps each bit — so the fingers on one piece and the
 * notches on the other are the same decision, read from two sides, and can never disagree.
 */
export interface Slab {
  id: string;
  /** The axis the sheet's thickness runs along. */
  normal: Axis;
  box: AABB;
  /** A block shared by three slabs (a box corner) goes to the highest rank; so does a two-slab
   *  overlap no joint covers. */
  rank: number;
  /** The piece's own frame: `u` → its 2D X, `v` → its 2D Y, both signed world axes. `u × v`
   *  points out of the SHOW face — the side a pattern or an engraving goes on, which is the
   *  side that faces the laser. */
  u: V3;
  v: V3;
  /** An insert (a divider): it stands inside the box, so a face's pattern keeps off its slots
   *  rather than giving up the whole side of the face it is on. */
  insert?: boolean;
}

export type JointKind =
  /** Two pieces meeting at an edge: alternating fingers and notches. */
  | 'finger'
  /** `b`'s tabs pass THROUGH `a`: holes in `a`, away from its edge (a floor in a skirted wall,
   *  a divider in a wall). The tab's thickness meets the hole's width — raw sheet against a
   *  cut face — so the fit is also applied across it. */
  | 'slot';

/**
 * Where slabs `a` and `b` overlap, along `axis`, inside `range`: `b` keeps `intervals`, `a`
 * keeps the rest of the range. Outside the range the overlap goes by rank.
 */
export interface Joint {
  a: string;
  b: string;
  axis: Axis;
  range: [number, number];
  intervals: [number, number][];
  kind: JointKind;
  /** Interference the joint is drawn with, mm, across a finger's width: + grips, − slides.
   *  Each piece grows its own fingers by a quarter of it a side, so a finger and its notch meet
   *  `fit` apart (see slabs.ts). A `slot` joint's hole is also drawn `fit / 2` narrower across
   *  the sheet. */
  fit: number;
  /** Flex tabs: two slits cut into each of `b`'s tabs, so its arms give as it goes home — and
   *  this much more interference along the axis, mm, which they take by hand. Across the sheet
   *  (a slot's hole) the fit stays `fit`: the slits do not flex that way. */
  flex?: number;
}

/** What the laser does with a shape. Same three words as @vostok/laser. */
export type Op = 'cut' | 'score' | 'engrave';

/** A piece as the engine hands it over: its outline in its own frame, and where it goes. */
export interface Piece {
  id: string;
  label: string;
  /** Islands in the piece's own frame (mm, Y up). Normally one island: the outline with its
   *  holes — slots, a finger hole, a hinge's round. */
  shapes: Shapes;
  /** Open cuts: a flex tab's slits. Cut as single lines, never kerf-offset. */
  slits: Pt[][];
  /** The rectangle a pattern may fill, in the piece's frame, already clear of every joint. Null
   *  on a piece that takes no pattern (a rail, a lip). */
  safe: Ring | null;
  /** Holes a pattern must keep off (a finger hole, a hinge round), in the piece's frame. */
  keepOut: Ring[];
  /** The box face this piece is, for "pattern on: lid / sides / all". */
  face: FaceId | null;
  /** Where it sits assembled: the world point of the piece's (0, 0) on its MID-thickness, and
   *  its frame. */
  origin: V3;
  u: V3;
  v: V3;
  /** Sheet thickness this piece is cut from, mm. */
  thickness: number;
  /** A moving part and how it moves — a hinged lid, a drawer — for the 3D view. */
  motion?: Motion;
}

export type FaceId = 'lid' | 'front' | 'back' | 'left' | 'right' | 'bottom';

export type Motion =
  /** Turns about a world line (a hinge): `axis` through `at`, opening by `degrees`. */
  | { kind: 'hinge'; at: V3; axis: V3; degrees: number }
  /** Slides along a world direction by `distance` mm. */
  | { kind: 'slide'; dir: V3; distance: number }
  /** Lifts straight up by `distance` mm. */
  | { kind: 'lift'; distance: number };
