// The crossing-pieces stand: two IDENTICAL planks that slot into each other at a right angle and
// hold a phone in the V between them. The facility a phone stand, a QR stand or a card holder is
// cut from — the caller brings the size and what goes on the front piece, and everything that
// decides whether the thing STANDS lives here.
//
// Construction: two planks crossing, the phone leaning in the V,
// 80 mm across and 130 mm tall. The old geometry (an upright plate dropped into a slotted base,
// `engine/stands.ts`'s `slotBase`) was wrong and is gone.
//
// ------------------------------------------------------------------------ the geometry --
//
// Two flat pieces can only cross cleanly on ONE line: where their planes meet. Both slots are cut
// along that line, so the line — call it ℓ — is the piece's WIDTH direction, and each plank's
// length is perpendicular to ℓ inside its own plane. Perpendicular planes then put the two
// LENGTHS at 90° to each other for free: that is the "crossing at 90°" of the design, and it
// is why a lengthwise slot could never make this joint.
//
// Work in the stand's cross section: y runs front(−)/back(+), z is up, the table is z = 0, ℓ is
// the x axis (left–right) and the crossing is at (0, 0, zc).
//
//   `lean` (θ) is the BACK piece's angle from the table — the angle a phone leaning on it takes.
//   u_back  = (0,  cos θ,  sin θ)   up and back: the rest, the long arm
//   u_front = (0, −sin θ,  cos θ)   up and front, at 90° to it: the lip, the short arm
//
// Each piece has a long arm and a short arm either side of its slot. The back piece stands on its
// SHORT arm (down-front) and reaches the top on its long one; the front piece stands on its LONG
// arm (down-back) and its short arm is the lip the phone's bottom edge sits on. Both pieces are
// the same part — the front one is drawn turned about, which is how it goes into the stand.
//
// THE THREE EQUATIONS. The two feet end square, so each one touches the table along the 80 mm
// line of its lower face corner, and the top is the back piece's upper corner. Writing `a` for
// the short arm, `b` for the long arm and asking for both feet on the table and the top at
// `height`:
//
//        a·sin θ + (t/2)·cos θ = zc          (the front foot, on the table)
//        b·cos θ + (t/2)·sin θ = zc          (the back foot, on the table)
//        zc + b·sin θ + (t/2)·cos θ = height (the top)
//
//   ⇒    zc = [height + (t/2)(sin θ·tan θ − cos θ)] / (1 + tan θ)
//
// Two line contacts 80 mm long and ~104 mm apart, not four points: the stand cannot rock.
//
// WHY IT HOLDS A PHONE. The phone lies on the back piece's front face and its bottom edge sits in
// the V, so its centre of mass is half its length up that face and half its thickness off it. At
// the default (80 × 130, t = 3, θ = 67°) the feet are at y = −15.2 (front) and y = +89.3 (back),
// and a 6.5-inch phone (160 × 75 × 8 mm, 170 g) puts its centre of mass at y = +26.8, z = 116.7 —
// 42 mm inside the front foot and 63 mm inside the back one. The stand's own 30-ish grams sit
// between the feet too, so they only help. `metrics.phone` carries those numbers and
// `cross-stand.test.mjs` re-derives them.
//
// ---------------------------------------------------------------------------- the API --
//
//   const g = crossStandGeometry({ width, height, t, kerf, lean });  // rings, poses, numbers
//   ...build your layers inside `g.content` (the front piece) or `g.backContent`...
//   const { blank, layers, pose, parts, status } = crossStandPieces(g, { front, back });
//
// Two calls because the content box has to exist before a caller can fit type or a QR into it.
// Nothing here touches manifold: every ring is closed-form, so a node test can hold the whole
// construction to the equations above.
import { filletRing, type Box, type Shapes } from '@vostok/shapes';
import type { CutRing } from '@vostok/export';
import { FIT, slotRing, slotWidth } from './slots';
import type { Blank, DesignLayer, PartInput, Pose } from './types';

type Pt = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
const turn = (ring: CutRing): CutRing => ring.map(([x, y]) => [-x, -y]);

/* The sides are STRAIGHT. They used to taper from the crossing to each tip on a curve, which
   the comment here defended as reading "like a plank instead of an urn" — at the shipped
   exponent it read like an urn (2026-09-22). The design is two plain pieces with parallel
   sides: one rounded rectangle, one notched into two legs. A taper also bought nothing
   structurally — the crossing is where the bending moment peaks AND where half the width is
   slot, so thinning everything else only removes material that was not the weak point.

   What made the taper look wrong is worth keeping in mind if anyone reaches for it again: the
   two arms are different lengths, so a symmetric taper puts the widest point off-centre in the
   silhouette, and the eye reads that as a mistake rather than as a shape. */

/** The notch in the front piece's foot: what turns one 80 mm bearing edge into two legs.
 *  Shares of the piece's width and of the long arm, so it holds at any size. */
const LEG_SHARE = 0.26;
const NOTCH_DEPTH_SHARE = 0.16;
/** Air between the two pieces on the sheet, mm. */
const SHEET_GAP = 8;
/** No mark sits closer than this to a cut edge, mm — the house inset. */
const EDGE = 4;
/** Air between the slot and anything engraved on the same arm, mm. */
const SLOT_WEB = 5;

const ODD_WIDTH = 'The slot comes out an odd width — check the thickness and the kerf.';

// The corner rounding these rings use now lives in @vostok/laser (`filletRing`): the keychain
// phone stand wanted the same thing, which is this repo's rule for moving it into the package.

// ------------------------------------------------------------------ the numbers --

export interface CrossStandInput {
  /** Across the stand — the plank's width at the crossing, and the width of the V a phone sits
   *  in. The reference's 80 mm: a 6.5-inch phone is 75 mm wide. */
  width: number;
  /** How tall the assembled stand is, table to the back piece's top corner. */
  height: number;
  /** How much desk it takes, front foot to back foot. The reference's 74.5 mm.
   *
   *  An INPUT, not an outcome. It used to be neither — the two arms were both derived from the
   *  height and the lean, the two pieces came out identical, and whatever depth that implied is
   *  what you got: 104 mm at the default, against a reference measuring 74.5. Depth is the one
   *  number a desk object is actually judged on, so it is asked for. */
  depth?: number;
  t: number;
  kerf: number;
  /** Degrees from the TABLE: the angle the phone leans at. 65–70 is the touchscreen range. */
  lean?: number;
  clearance?: number;
  /** The radius on the planks' four ends, mm. */
  corner?: number;
  /** How deep the front piece's shelf has to be for what leans on it (a phone with a case is
   *  about 10 mm), mm. The facility only warns on it — the arm's length is fixed by the joint. */
  lip?: number;
}

/** Every number the construction is proved on — the test reads these and re-derives them. */
export interface CrossStandMetrics {
  /** Degrees from the table. */
  lean: number;
  /** The stand, table to the top corner, and across. */
  height: number;
  width: number;
  /** How high the two planks cross, on their mid-planes, mm. */
  crossHeight: number;
  /** The two arms either side of the slot, tip to slot centre, mm. */
  shortArm: number;
  longArm: number;
  /** The plank, tip to tip — longer than the stand is tall, because it leans. */
  length: number;
  /** The plank's width at its two ends: the short arm's (the lip and the front foot) and the long
   *  arm's (the top of the stand and the back foot). */
  tip: { short: number; long: number };
  /** Each piece's own arms, tip to slot centre, and its length. The two are DIFFERENT parts:
   *  the back one stands on its short arm and reaches the top on its long one, the front one
   *  stands on its long arm and catches the phone on its short one (the lip). */
  back: { short: number; long: number; length: number };
  front: { short: number; long: number; length: number };
  /** Where the two feet touch the table, as the world's y (front is negative), and the depth
   *  between them — the footprint everything has to stand inside. */
  foot: { front: number; back: number; depth: number };
  /** As drawn: `width` across the mating thickness, `depth` into the piece. The pair sums to the
   *  plank's width at the crossing, so the two pieces' side edges finish flush. */
  slot: { width: number; depth: number };
  /** Where the V's inner corner sits — the point a phone's bottom edge rests in. */
  crotch: { y: number; z: number };
  /** A 6.5-inch phone leaning on the V, and how far inside the feet its weight lands. */
  phone: { length: number; thickness: number; mass: number; com: { y: number; z: number }; marginFront: number; marginBack: number };
}

export interface CrossStandGeometry {
  width: number;
  height: number;
  t: number;
  /** The part, centred on its own box: x across (the slot's line), y along its length, the long
   *  arm up. The BACK piece is cut from this ring. */
  backPlank: CutRing;
  /** The same part, drawn turned about — which is how it goes into the stand: its short arm (the
   *  lip) then points up-front and its engraved face looks down-front, at the customer. Turning a
   *  piece in its own plane is free; flipping it over would put the engraving on the back. */
  frontPlank: CutRing;
  /** The back piece's slot, opening on the left edge. Give it to an `op: 'cut'` layer. */
  backSlot: Shapes;
  /** The front piece's: the same slot on the turned-about piece, so it opens on the right. */
  frontSlot: Shapes;
  /** The clear rectangle on the FRONT piece — its lip, above the slot, the one face a phone
   *  does not cover and the customer looks straight at. */
  content: Box;
  /** The clear rectangle on the BACK piece, above the crossing: the whole face a phone leans on,
   *  for a caller with nothing leaning on it (a QR stand, a card holder). */
  backContent: Box;
  frontPose: Pose;
  backPose: Pose;
  metrics: CrossStandMetrics;
  warnings: string[];
}

/** The phone the stand is proved against: a 6.5-inch handset with a case, and 170 g is the heavy
 *  end of that class (iPhone 15 Pro Max 221 g is heavier still, and it is 77 mm wide — the
 *  margins below have room for it). */
const PHONE = { length: 160, width: 75, thickness: 8, mass: 170 };

/**
 * The stand, in rings and poses. Pure: no CSG, no fonts, no values object.
 */
export function crossStandGeometry(i: CrossStandInput): CrossStandGeometry {
  const width = Math.max(24, i.width);
  const height = Math.max(50, i.height);
  const t = Math.max(0.5, i.t);
  const kerf = Math.max(0, i.kerf);
  const lean = clamp(i.lean ?? 67, 45, 80);
  const clearance = i.clearance ?? FIT.snug!;
  const lipWanted = i.lip ?? 20;
  const warnings: string[] = [];

  const th = rad(lean);
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const tn = sn / cs;

  /* ------------------------------------------------------ the equations, from the design --

     Measured off the design's own SVG (2026-09-22), which settled a design that had been
     wrong twice:

       piece            width   length   slot        short arm   long arm
       back  (the rest) 69.70   155.21   34.84 deep  29.11       126.11
       front (the prop) 69.10    90.13   34.56 deep  21.51        68.62

     Both slots are half the width, so it is an ordinary 90° cross-lap — the crossing angle was
     never the problem. Solving "both feet on the table" from those two arms gives θ = 67.0°,
     which is exactly the lean this engine already defaulted to. What was wrong is that it built
     ONE part and used it twice, so both pieces got the same arms (41.6 / 96 at the default) and
     the back foot landed 89 mm behind the crossing instead of 63. Hence a 104 mm footprint for a
     stand whose reference is 74.5.

     So each piece gets its own split, and all four follow from the crossing height:

       the back piece stands on its SHORT arm, so   a1·sinθ + (t/2)·cosθ = zc
       the front piece stands on its LONG arm, so   b2·cosθ + (t/2)·sinθ = zc
       the back piece's long arm reaches the top,   zc + b1·sinθ + (t/2)·cosθ = height
       the front piece's short arm IS the lip,      a2 = lip

     and the footprint is a1·cosθ + b2·sinθ, which inverts to the closed form below. Check it
     against the table above: at depth 74.5 and θ = 67 it returns 29.1, 126.1, 68.6. */
  const wantDepth = i.depth ?? 80;
  const crossHeight = wantDepth * sn * cs + (t / 2) * (cs * cs * cs + sn * sn * sn);
  /** The back piece: its foot, and its reach to the top. */
  const backShort = Math.max(6, (crossHeight - (t / 2) * cs) / sn);
  const backLong = Math.max(6, (height - crossHeight - (t / 2) * cs) / sn);
  /** The front piece: the lip it catches the phone with, and its reach down-back to the table. */
  const frontShort = Math.max(6, lipWanted);
  const frontLong = Math.max(6, (crossHeight - (t / 2) * sn) / cs);

  // Kept under the old names for everything downstream that reasons about "the" stand: the
  // shorter foot arm and the longer reach still describe the assembly's envelope.
  const shortArm = backShort;
  const longArm = frontLong;
  const length = Math.max(backShort + backLong, frontShort + frontLong);

  // --------------------------------------------------------------------------- the plank --
  const halfW = width / 2;
  // Straight sides: both tips are the full width. Kept as names because the metrics and the
  // content boxes are written in terms of them.
  const tipShort = halfW;
  const tipLong = halfW;
  /** Each piece is drawn short tip at the bottom, long tip at the top, centred on its own box —
   *  so each has its OWN half-length and its own slot height. They are different parts now. */
  const backHalfL = (backShort + backLong) / 2;
  const frontHalfL = (frontShort + frontLong) / 2;
  const backSlotY = backShort - backHalfL;
  const frontSlotY = frontShort - frontHalfL;
  // The envelope, for the callers and the metrics that still speak of one length.
  const halfL = length / 2;
  const slotY = backSlotY;
  const cornerR = clamp(i.corner ?? Math.min(9, 0.22 * width), 0, 0.45 * width);
  /** Half the width at height `y`. Constant now — the sides are parallel — but kept as a
   *  function because the content boxes ask "how wide is the piece up there?" and should not
   *  have to know the answer never changes.  */
  const halfAt = (_y: number) => halfW;

  /* The notch: the front piece stands on its LONG arm, and cutting a bay out of that tip leaves
     two legs instead of one solid end. It is the Π in the design's flat layout, and it is
     what the eye reads as a stand rather than a slab. It costs no stability — two legs 80 mm
     apart bear on the table exactly where the solid edge did, and the contact is still two
     lines, not four points — and it takes material out of the one place carrying no load.

     The BACK piece keeps a solid tip: that is the face a phone leans on, and the design
     draws it as a plain rounded rectangle. */
  const legW = LEG_SHARE * width;
  const notchHalf = Math.max(0, halfW - legW);
  // The reference: a 22 mm bay, ~13 mm deep, in a 69.5 mm piece. Shares of the WIDTH, so the
  // feet stay feet at any size, and never deep enough to reach a slot.
  // Every arm a bay is cut into has to keep material between the bay and the slot, and the
  // binding one is the LIP — the shortest arm on either piece. Getting this wrong cuts the slot
  // open and the corner falls out of the sheet, which is exactly what it did first time.
  const armFloor = Math.min(backShort, frontShort, frontLong);
  const notchDepth = clamp(NOTCH_DEPTH_SHARE * width, 3, Math.max(3, armFloor - SLOT_WEB - slotWidth(t, kerf, clearance)));
  const notchR = clamp(Math.min(2.5, notchDepth / 4, legW / 4), 0, 4);

  /** One piece, drawn short tip at the bottom and long tip at the top, counter-clockwise.
   *  `notches` says which ends are cut into two feet — the design notches the back piece's
   *  foot, and BOTH ends of the front piece: its foot, and the lip, where the notch is the
   *  cradle the phone's bottom edge drops into. */
  const plankOf = (hl: number, notches: { short: boolean; long: boolean }): CutRing => {
    const pts: Pt[] = [];
    const radii: number[] = [];
    const push = (p: Pt, r: number) => { pts.push(p); radii.push(r); };
    const bay = (y: number, dir: 1 | -1) => {
      // Into the tip at `y`, out again: right wall down, across, left wall up.
      push([notchHalf, y], notchR);
      push([notchHalf, y - dir * notchDepth], notchR);
      push([-notchHalf, y - dir * notchDepth], notchR);
      push([-notchHalf, y], notchR);
    };
    const canNotch = notchHalf > 1 && notchDepth > 1;
    push([halfW, -hl], cornerR);
    push([halfW, hl], cornerR);
    if (notches.long && canNotch) bay(hl, 1);
    push([-halfW, hl], cornerR);
    push([-halfW, -hl], cornerR);
    if (notches.short && canNotch) {
      // Drawn right-to-left along the bottom edge, so the bay is entered from the left here.
      push([-notchHalf, -hl], notchR);
      push([-notchHalf, -hl + notchDepth], notchR);
      push([notchHalf, -hl + notchDepth], notchR);
      push([notchHalf, -hl], notchR);
    }
    return filletRing(pts, radii);
  };

  /** The back piece: solid at the top (the phone leans on it), two feet at the bottom. */
  const plank = plankOf(backHalfL, { short: true, long: false });
  /** The front piece: two feet where it reaches the table, and a cradle notch in the lip. */
  const leggedPlank = plankOf(frontHalfL, { short: true, long: true });

  // The joint. The slot is a void, so it is drawn a kerf narrow and comes off the machine on
  // `t + clearance`; its depth runs to the plank's own centreline, so the two depths sum to the
  // width at the crossing and the pieces' side edges finish flush.
  const slot = { width: slotWidth(t, kerf, clearance), depth: halfW };
  const backSlot: Shapes = [[slotRing(-halfW, backSlotY, slot.width, slot.depth, 'left', { nodes: true })]];
  const frontSlot: Shapes = [[slotRing(halfW, frontSlotY, slot.width, slot.depth, 'right', { nodes: true })]];

  // ----------------------------------------------------------------- what may be engraved --
  // Both boxes run from a web above the slot to the tip, as wide as the plank is at their
  // narrow end. On the front piece that is the lip — the one face a docked phone leaves visible.
  const boxAbove = (from: number, hl: number): Box => {
    const topY = hl - Math.max(EDGE, cornerR) - (notchDepth > 1 ? notchDepth : 0);
    return {
      minX: -(halfAt(topY) - EDGE), maxX: halfAt(topY) - EDGE,
      minY: from + slot.width / 2 + SLOT_WEB, maxY: topY,
    };
  };
  // The front piece's face is its LIP — the one part a docked phone leaves in plain view — and
  // the back piece's is everything above its slot.
  const content = boxAbove(frontSlotY, frontHalfL);
  const backContent = boxAbove(backSlotY, backHalfL);

  // ------------------------------------------------------------------------ standing up --
  // The piece's centre is `half` along its long arm from the crossing. The back piece leans by
  // the lean itself. The front piece is drawn short tip DOWN, long tip UP, like the back one, and
  // its long arm has to run DOWN-BACK to the table: that is `lean − 90`, which sends its own +y
  // to (0, sin θ, −cos θ) and its engraved face to (0, cos θ, sin θ) — the upper face, the one
  // a customer looks down on, lettering upright from the front. It was `lean + 90` until
  // 2026-09-26: the same line turned end for end, so the 3D view put the slot 40 mm from where
  // the pieces cross and the engraving on the underside. `assembly-check.mjs` found it — the
  // two solids shared 360 mm³ across the full width, where a cross-lap shares none.
  const backHalf = backHalfL - backShort;
  const frontHalf = frontHalfL - frontShort;
  const backPose: Pose = { x: 0, y: backHalf * cs, z: crossHeight + backHalf * sn, rx: lean };
  const frontPose: Pose = { x: 0, y: frontHalf * sn, z: crossHeight - frontHalf * cs, rx: lean - 90 };

  // ---------------------------------------------------------------------- does it stand --
  const foot = { front: -backShort * cs + (t / 2) * sn, back: frontLong * sn - (t / 2) * cs, depth: 0 };
  foot.depth = foot.back - foot.front;
  const crotch = { y: (t / 2) * (cs - sn), z: crossHeight + (t / 2) * (cs + sn) };
  const com = {
    y: crotch.y + (PHONE.length / 2) * cs - (PHONE.thickness / 2) * sn,
    z: crotch.z + (PHONE.length / 2) * sn + (PHONE.thickness / 2) * cs,
  };
  const marginFront = com.y - foot.front;
  const marginBack = foot.back - com.y;

  // -------------------------------------------------------------------------- what to say --
  if (lean < 60) warnings.push('Under 60° a phone lies too flat to read comfortably — 65 to 70° is the range.');
  if (lean > 72) warnings.push('Over 72° a phone stands nearly upright and tips forward off the lip easily.');
  if (Math.min(marginFront, marginBack) < 10) {
    warnings.push('A phone leaning on this lands close to the edge of the footprint — a lower lean or a shorter stand is steadier.');
  }
  if (width < PHONE.width - 5) warnings.push('Narrower than a phone: it will hold one, but a knock can tip it sideways.');
  if (frontShort < 10) warnings.push('The lip is too shallow to catch a phone in a case — 12 mm or more holds one.');
  if (backLong < PHONE.length / 2) warnings.push('A big phone leans past the top of the stand — make it taller.');
  if (slot.width <= 0.5 || slot.width >= 1.8 * t) warnings.push(ODD_WIDTH);
  if (content.maxY - content.minY < 8 || content.maxX <= content.minX) {
    warnings.push('There is no room left on the front piece to engrave anything — make the stand taller.');
  }

  return {
    width, height, t,
    // The back piece is the solid panel the phone rests on; the front piece stands on two legs.
    backPlank: plank,
    frontPlank: leggedPlank,
    backSlot,
    frontSlot,
    content,
    backContent,
    frontPose,
    backPose,
    metrics: {
      lean, height, width,
      crossHeight, shortArm, longArm, length,
      back: { short: backShort, long: backLong, length: backShort + backLong },
      front: { short: frontShort, long: frontLong, length: frontShort + frontLong },
      tip: { short: 2 * tipShort, long: 2 * tipLong },
      foot,
      slot,
      crotch,
      phone: { length: PHONE.length, thickness: PHONE.thickness, mass: PHONE.mass, com, marginFront, marginBack },
    },
    warnings,
  };
}

export interface CrossStandContent {
  /** What the FRONT piece carries, in its own frame — `g.content` is the room it has. */
  front: DesignLayer[];
  /** What the BACK piece carries (`g.backContent`): the whole face a phone leans on, so only a
   *  caller with nothing leaning on it — a QR stand, a card holder — should fill it. */
  back?: DesignLayer[];
  /** In a run the sheet nests every copy, so the explicit placements come off. */
  batched?: boolean;
}

export interface CrossStandPieces {
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  material: 'light';
  pose: Pose;
  parts: PartInput[];
  status: string;
}

/**
 * The two pieces, ready to spread into a `BuildInput`: the FRONT piece is the primary — it is
 * what the customer looks at and what carries the name — and the back piece is the part. The
 * caller adds its own keyring (a stand hangs from nothing), warnings and file name.
 */
export function crossStandPieces(g: CrossStandGeometry, content: CrossStandContent): CrossStandPieces {
  const cut = (id: string, shapes: Shapes): DesignLayer => ({ id, label: 'Slot', op: 'cut', shapes });

  const parts: PartInput[] = [{
    id: 'back',
    label: 'Back piece',
    blank: { kind: 'shape', shapes: [[g.backPlank]] },
    layers: [...(content.back ?? []), cut('back-slot', g.backSlot)],
    keyring: 'none',
    material: 'light',
    ...(content.batched ? {} : { at: { x: g.width + SHEET_GAP, y: 0 } }),
    // Straight behind the front piece on the flat card: a stand seen from the front IS its front
    // piece, with the rest of it showing past the edges.
    assembledAt: { x: 0, y: 0 },
    previewStyle: 'dashed',
    z: 0,
    pose: g.backPose,
  }];

  return {
    label: 'Front piece',
    blank: { kind: 'shape', shapes: [[g.frontPlank]] },
    layers: [...content.front, cut('front-slot', g.frontSlot)],
    material: 'light',
    pose: g.frontPose,
    parts,
    status: '2 pieces',
  };
}
