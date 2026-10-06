// The slot stand: one upright leaning back in a flat base, and nothing else. The facility a QR
// stand, a photo holder or a price card is cut from — the caller brings the size and what goes on
// the face, and everything that decides whether the thing STANDS lives here.
//
// Construction: an upright with rounded top corners, the code on its own square plate mounted on
// the front, a line of text under it, and a flat base it leans back out of. The old geometry
// (`slotBase` in ./stands.ts: a base with a slot plus a separate glued-on front lip) did not
// stand and is gone.
//
// ------------------------------------------------------------------------ the geometry --
//
// Work in the stand's cross section: y runs front(−)/back(+), z is up, the table is z = 0.
//
//   `lean` (λ) is the upright's angle from VERTICAL — about 10°, the angle a code is
//   read at across a counter. The upright is a plate `width × height` with a TONGUE below its
//   bottom edge; the base is a flat plate with a through-slot the tongue drops into, extending
//   in FRONT of and BEHIND the upright.
//
// THE JOINT. A board `t` thick crossing a base `t` thick at λ from vertical needs an opening
//
//        span = t/cos λ + t·tan λ            (front face at the top surface, back face at the
//                                             bottom one — the two lines the board bears on)
//
// and those two bearing lines are what HOLD the lean: a board in a slot of that span can only
// sit at ±λ, and gravity picks the one it is already leaning into. Cut the span any wider and
// the upright rocks between the two; that is the one number this joint turns on.
//
// The tongue is `t / cos λ` long, so its tip finishes flush with the base's underside while the
// upright's shoulders — the bottom edge either side of the tongue — bear on the base's TOP face.
// A flat base cannot reach a slot part-way up the upright without becoming a ramp, which is why
// the joint is at the table and not 15 mm up the plate.
//
// WHY IT STANDS. Everything above the table hangs off the slot: the upright leans BACK, so its
// weight (and a plate glued to its face) lands behind the joint. Put the slot that far FORWARD of
// the base's middle and the whole stand's centre of mass lands on the base's mid-depth line:
//
//        Y·(A_upright + A_plate) = A_plate·d·cos λ − (A_upright·ȳ_u + A_plate·y_p)·sin λ
//
// which leaves `baseDepth / 2` of margin in FRONT and the same BEHIND, at any lean, any height
// and any size of plate — the reason this facility solves for the slot's position instead of
// taking it as a number. `metrics.margin` and `metrics.tipAngle` carry it out, and
// `slot-stand.test.mjs` re-derives them from the built rings.
//
// ---------------------------------------------------------------------------- the API --
//
//   const g = slotStandGeometry({ width, height, t, kerf, lean, load });  // rings, poses, numbers
//   ...build your layers inside `g.content`, and a raised piece at `g.facePose(x, y, t)`...
//   const { blank, layers, pose, parts, status } = slotStandPieces(g, { face, base });
//
// Two calls because the content box has to exist before a caller can fit type or a QR into it.
// Nothing here touches manifold: every ring is closed-form, so a node test can hold the whole
// construction to the equations above.
import { roundedRectRing, type Box, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { FIT, slotHoleRing, slotWidth, tabWidth } from './slots';
import type { Blank, DesignLayer, PartInput, Pose } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
const shift = (ring: CutRing, dx: number, dy: number): CutRing => ring.map(([x, y]) => [x + dx, y + dy]);

/** Air between the two pieces on the sheet, mm. */
const SHEET_GAP = 8;
/** No mark sits closer than this to a cut edge, mm — the house inset. */
const EDGE = 4;
/** The narrowest web this construction ever leaves: round a slot, beside a tongue. */
const webMinFor = (t: number) => Math.max(6, 2 * t);
/** The lead-in chamfer on the tongue's free end, mm. */
const CHAMFER = 0.5;

const ODD_WIDTH = 'The slot comes out an odd width — check the thickness and the kerf.';

// ------------------------------------------------------------------ polygon arithmetic --

/** Signed area of a closed ring (positive CCW) and its centroid — the load the CoM solve
 *  balances is the REAL outline, tongue, rounded corners and all, not its bounding box. */
function areaCentroid(ring: CutRing): { area: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { area: 0, cx: 0, cy: 0 };
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

/** A quarter circle from `fromDeg` to `fromDeg + 90`, both ends included. */
function quarter(cx: number, cy: number, r: number, fromDeg: number, seg = 8): CutRing {
  const out: CutRing = [];
  for (let i = 0; i <= seg; i++) {
    const t = rad(fromDeg + (i / seg) * 90);
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

// ------------------------------------------------------------------ the numbers --

export interface SlotStandInput {
  /** The upright, across. */
  width: number;
  /** The upright's plate, along its own lean — what the customer sees, tongue not counted. */
  height: number;
  t: number;
  kerf: number;
  /** Degrees from VERTICAL: 0 stands bolt upright, the default leans about 10. */
  lean?: number;
  clearance?: number;
  /** The radius on the upright's two TOP corners, mm. */
  corner?: number;
  /** Front to back on the table. Default: deep enough for the joint and half the upright. */
  baseDepth?: number;
  /** Across. Default: the upright's own width. */
  baseWidth?: number;
  /** Anything glued to the upright's FRONT face — a raised code plate — as its area in mm² and
   *  the height of its centre in the upright's own frame. It leans back with the upright, so the
   *  slot's position has to carry it; `null` is a face with nothing but engraving on it. */
  load?: { area: number; y: number; t?: number } | null;
}

/** Every number the construction is proved on — the test reads these and re-derives them. */
export interface SlotStandMetrics {
  /** Degrees from vertical. */
  lean: number;
  width: number;
  height: number;
  /** How high the upright's top corner stands above the table. */
  standHeight: number;
  /** The tongue, as drawn: `width` across (a kerf wide, both flanks being cut), `length` down. */
  tongue: { width: number; length: number };
  /** The base's slot: the opening the board sees measured PERPENDICULAR to it, the y-extent that
   *  opening becomes on a base of the same thickness, and the x-extent across the tongue. */
  slot: { width: number; span: number; length: number; y: number };
  /** The bearing shoulder each side of the tongue, mm. */
  shoulder: number;
  base: { width: number; depth: number };
  /** The assembled stand's centre of mass, world mm — on the base's mid-depth line by
   *  construction, so `y` is 0 to within a rounding. */
  com: { y: number; z: number };
  /** How far the centre of mass sits inside the base's front and back edges, mm. */
  margin: { front: number; back: number };
  /** How far the table can be tilted before the stand goes over, degrees. */
  tipAngle: number;
}

export interface SlotStandGeometry {
  width: number;
  height: number;
  t: number;
  /** The upright — the plate and its tongue — centred on its own box. */
  upright: CutRing;
  /** The base, centred on its own box. */
  base: CutRing;
  /** The base's through-slot. Give it to an `op: 'cut'` layer. */
  baseCuts: Shapes;
  /** The clear rectangle on the upright's face, in the upright's own frame. */
  content: Box;
  uprightPose: Pose;
  basePose: Pose;
  /** Where a piece `pt` thick, glued to the upright's FRONT face with its centre at (x, y) in the
   *  upright's frame, stands in three dimensions. */
  facePose(x: number, y: number, pt: number): Pose;
  metrics: SlotStandMetrics;
  warnings: string[];
}

/**
 * The stand, in rings and poses. Pure: no CSG, no fonts, no values object.
 */
export function slotStandGeometry(i: SlotStandInput): SlotStandGeometry {
  const width = Math.max(24, i.width);
  const height = Math.max(40, i.height);
  const t = Math.max(0.5, i.t);
  const kerf = Math.max(0, i.kerf);
  const lean = clamp(i.lean ?? 10, 0, 30);
  const clearance = i.clearance ?? FIT.snug!;
  const warnings: string[] = [];

  const la = rad(lean);
  const sn = Math.sin(la);
  const cs = Math.cos(la);
  const web = webMinFor(t);
  const corner = clamp(i.corner ?? Math.min(10, 0.12 * height), 0, Math.min(width / 2, height / 2));

  // ------------------------------------------------------------------------ the joint --
  // The tongue's flanks are both cut lines, so it is drawn a kerf WIDE and the slot they drop
  // into a kerf NARROW: the physical pair lands `clearance` apart (see ./slots.ts).
  const shoulder = Math.max(web, 0.12 * width);
  const tongueNominal = Math.max(12, width - 2 * shoulder);
  const tongue = { width: tabWidth(tongueNominal, kerf), length: t / cs };
  // Perpendicular to the board, the opening is the plain slot width; along the base it opens out
  // by the lean, and the base's own thickness carries the far face further back again. The beam
  // widens the span by a kerf rather than a kerf/cos λ — a hundredth of a millimetre at any lean
  // this form allows, and the perpendicular width above is the number the joint is drawn on.
  const slotW = slotWidth(t, kerf, clearance);
  const span = slotW / cs + t * (sn / cs);

  // ---------------------------------------------------------------------- the upright --
  // The plate with its two top corners rounded, and the tongue hung below its bottom edge.
  const H = height + tongue.length;
  const halfW = width / 2;
  const top = H / 2;
  const foot = -H / 2 + tongue.length;
  // A lead-in on the tongue's free end only — chamfering its whole length would halve what the
  // slot actually bears on, and the tongue is only a sheet long.
  const ch = Math.min(CHAMFER, tongue.width / 4, tongue.length / 3);
  const uprightRing: CutRing = [
    [-halfW, foot],
    [-tongue.width / 2, foot],
    [-tongue.width / 2, -H / 2 + ch],
    [-tongue.width / 2 + ch, -H / 2],
    [tongue.width / 2 - ch, -H / 2],
    [tongue.width / 2, -H / 2 + ch],
    [tongue.width / 2, foot],
    [halfW, foot],
    ...quarter(halfW - corner, top - corner, corner, 0),
    ...quarter(-halfW + corner, top - corner, corner, 90),
  ];

  // ------------------------------------------------------------------- what may be engraved --
  const margin = Math.max(EDGE, 0.06 * width);
  const content: Box = {
    minX: -(halfW - margin),
    maxX: halfW - margin,
    // Clear of the shoulders, so nothing is engraved where the base hides it.
    minY: foot + Math.max(margin, 0.06 * height),
    maxY: top - Math.max(margin, corner * 0.8),
  };

  // ------------------------------------------------------------------------ standing up --
  // `rx: 90 − lean` leans the board back off the reader: its own +y runs up and back, and its own
  // +z — the engraved face's normal — runs forward and up, at the customer.
  const Z = (H / 2) * cs + (t / 2) * sn;
  const load = i.load ?? null;
  const loadT = load?.t ?? t;
  const body = areaCentroid(uprightRing);
  const A = body.area + (load?.area ?? 0);
  const d = (t + loadT) / 2;
  // The balance: put the box centre HERE and everything above the table weighs down the middle
  // of the base. (A load glued on the front face pulls its own thickness forward, which is the
  // `+ A_plate·d·cos λ` term — small, and the only reason the solve is not just the upright's.)
  const Y = A > 0 ? ((load ? load.area * d * cs : 0) - (body.area * body.cy + (load ? load.area * load.y : 0)) * sn) / A : 0;
  const slotY = Y - (sn / cs) * (Z - t / 2);

  const uprightPose: Pose = { x: 0, y: Y, z: Z, rx: 90 - lean };
  const basePose: Pose = { x: 0, y: 0, z: t / 2 };
  const facePose = (x: number, y: number, pt: number): Pose => ({
    x,
    y: Y + y * sn - ((t + pt) / 2) * cs,
    z: Z + y * cs + ((t + pt) / 2) * sn,
    rx: 90 - lean,
  });

  // ---------------------------------------------------------------------------- the base --
  const baseWidth = Math.max(i.baseWidth ?? width, tongue.width + 2 * web);
  const wanted = Math.max(60, 0.5 * height, 2 * (Math.abs(slotY) + span / 2 + web));
  const baseDepth = Math.max(i.baseDepth ?? wanted, 2 * (Math.abs(slotY) + span / 2 + web));
  const base = roundedRectRing(baseWidth, baseDepth, clamp(0.08 * baseDepth, 2, 6));
  // Nodes on the two walls the tongue's faces bear on: they sit on the same two bearing lines
  // the lean is held by, a node's height further in, so they crush rather than tilt the board.
  const baseCuts: Shapes = [[slotHoleRing(0, slotY, span, slotWidth(tongueNominal, kerf, clearance), 'x')]];

  // ------------------------------------------------------------------------ does it stand --
  // Every piece is the same sheet, so area IS mass. The upright's centroid rides up its own lean;
  // a raised plate rides that plus its own half-thickness off the face; the base lies at t/2.
  const baseArea = baseWidth * baseDepth;
  const mass = body.area + (load?.area ?? 0) + baseArea;
  const comZ = (
    body.area * (Z + body.cy * cs)
    + (load ? load.area * (Z + load.y * cs + d * sn) : 0)
    + baseArea * (t / 2)
  ) / Math.max(1e-6, mass);
  // Zero by construction — the solve above is what put it there — and the test measures it back
  // off the rings rather than taking this word for it.
  const comY = 0;
  const margins = { front: baseDepth / 2 + comY, back: baseDepth / 2 - comY };
  const tipAngle = (Math.atan2(Math.min(margins.front, margins.back), Math.max(1e-6, comZ)) * 180) / Math.PI;
  const standHeight = Z + (H / 2) * cs + (t / 2) * sn;

  // -------------------------------------------------------------------------- what to say --
  if (lean < 5) warnings.push('Under 5° the stand is nearly upright and a knock from behind puts it over.');
  if (lean > 20) warnings.push('Over 20° the code lies back far enough that a phone above it struggles.');
  if (slotW <= 0.5 || slotW >= 1.8 * t) warnings.push(ODD_WIDTH);
  if (Y + top * sn > baseDepth / 2) warnings.push('The upright leans out past the back of the base — make the base deeper.');
  if (width - 2 * shoulder < 12) warnings.push('The upright is too narrow for a tongue and two shoulders — make it wider.');
  if (content.maxY - content.minY < 20 || content.maxX <= content.minX) {
    warnings.push('There is no room left on the upright to engrave anything — make it bigger.');
  }

  return {
    width, height, t,
    upright: uprightRing,
    base,
    baseCuts,
    content,
    uprightPose,
    basePose,
    facePose,
    metrics: {
      lean, width, height, standHeight,
      tongue,
      slot: { width: slotW, span, length: slotWidth(tongueNominal, kerf, clearance), y: slotY },
      shoulder,
      base: { width: baseWidth, depth: baseDepth },
      com: { y: comY, z: comZ },
      margin: margins,
      tipAngle,
    },
    warnings,
  };
}

// ------------------------------------------------------------------ the pieces --

export interface SlotStandContent {
  /** What the UPRIGHT carries, in its own frame — `g.content` is the room it has. */
  face: DesignLayer[];
  /** What the BASE carries. Usually nothing: it is under the stand. */
  base?: DesignLayer[];
  /** Extra pieces glued to the upright's face — a raised code plate, already posed with
   *  `g.facePose`. They are cut beside the base on the sheet. */
  raised?: PartInput[];
  /** In a run the sheet nests every copy, so the explicit placements come off. */
  batched?: boolean;
}

export interface SlotStandPieces {
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  material: 'light';
  pose: Pose;
  parts: PartInput[];
  status: string;
}

/**
 * The pieces, ready to spread into a `BuildInput`: the UPRIGHT is the primary — it is what the
 * customer looks at and what carries the code — and the base (plus anything raised) follows. The
 * caller adds its own keyring (a stand hangs from nothing), warnings and file name.
 */
export function slotStandPieces(g: SlotStandGeometry, content: SlotStandContent): SlotStandPieces {
  const place = (at: { x: number; y: number }) => (content.batched ? {} : { at });
  /** The upright's own box is the plate PLUS its tongue, so both of these hang off that. */
  const halfH = (g.height + g.metrics.tongue.length) / 2;
  const depth = g.metrics.base.depth;
  const parts: PartInput[] = [{
    id: 'base',
    label: 'Base',
    blank: { kind: 'shape', shapes: [[g.base]] },
    layers: [
      ...(content.base ?? []),
      { id: 'base-slot', label: 'Slot', op: 'cut', shapes: g.baseCuts },
    ],
    keyring: 'none',
    material: 'light',
    ...place({ x: 0, y: -(halfH + SHEET_GAP + depth / 2) }),
    // Straight under the upright's bottom edge on the flat card — a stand seen from the front is
    // its face, with the base a ghost under it rather than a second object beside it.
    assembledAt: { x: 0, y: -g.height / 2 + g.metrics.tongue.length / 2 - depth / 2 },
    previewStyle: 'dashed',
    z: 0,
    pose: g.basePose,
  }, ...(content.raised ?? [])];

  return {
    label: 'Upright',
    blank: { kind: 'shape', shapes: [[g.upright]] },
    layers: content.face,
    material: 'light',
    pose: g.uprightPose,
    parts,
    status: `${parts.length + 1} pieces`,
  };
}
