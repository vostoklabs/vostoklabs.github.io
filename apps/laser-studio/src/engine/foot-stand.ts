// The foot stand: a leaning PLATE standing on two feet that cross under it. The facility a QR
// stand, a price card or a small sign is cut from — the caller brings the size and what goes on
// the plate, and everything that decides whether the thing STANDS lives here.
//
// 2026-09-22: the crossing-planks build this replaces made no sense as a shape or a structure for
// a QR stand — two planks in an X with the code on a narrow diagonal blade.
// A phone leans on crossing planks; a QR code does not. The construction it replaced is the one
// that reads as a product, and it is restored here from an earlier snapshot's `stands.ts` + the
// `style === 'stand'` branch of its `qr-stand.ts`: a plate, two wedge feet, a half-lap at
// each foot.
//
// ------------------------------------------------------------------------ the geometry --
//
// Work in the stand's cross section: y runs front(−)/back(+), z is up, the table is z = 0.
//
//   `lean` (θ) is the plate's angle from VERTICAL — 0 stands it bolt upright, 10–15° is what a
//   seated person reads across a table. The plate is `width × height`, its bottom edge on the
//   table; each foot is a low hump running FRONT TO BACK, edge-on to the reader, crossing under
//   the plate at 90° to it. Two crossings, so the plate cannot rotate about either one.
//
// THE HALF-LAP. The plate's slot opens on its BOTTOM edge and runs `lap` up it; the foot's notch
// opens on its CROWN and runs `footLap` down, cut at θ so it lies along the plate. Two boards
// crossing bottom out when the two roots meet, so the foot's depth is solved from where the
// plate's root lands rather than guessed:
//
//        jointZ  = lap · cos θ + (t/2) · sin θ            (the plate's slot root, above the table:
//                                                          the plate rests on its bottom FRONT
//                                                          corner, which lifts its mid-plane)
//        footLap = (crown + lift − jointZ) / cos θ − lift  (the foot's notch root, on the same z)
//
// so both roots meet at the SAME point and the plate's bottom edge lands on the table at the
// same moment. (The 2026-09-21 build left `footLap = lap`, which put the foot's notch root
// 5.7 mm below the plate's slot root at the shipped size: the joint bottomed out on the table
// with the feet free to ride up. One line, and the joint is determinate.)
//
// The crown is sized from the joint, never guessed: `crown = lap · cos θ + web`, where `web` is
// the material left ABOVE the notch root — the shoulders that grip the plate's two faces — and
// is never under 8 mm or 2.5 sheets, whichever is more.
//
// WHY IT STANDS. Every piece is the same sheet, so area IS mass, and the support is the two
// feet's flat undersides — a line `length` long under each one. At the shipped 100 × 140 in
// 3 mm at 12° the feet run y −29.5 … +57.3 (86.8 mm of footprint) and the centre of mass lands
// at y 14.2, z 59.0: 43.7 mm inside the front edge of the footprint and 43.1 mm inside the back,
// a 36.2° tip angle. Across, the two feet stand at x ±32 on a 100 mm plate, so a sideways tip
// needs 29.6°. A plate narrow and TALL enough is a blade whatever its feet are (60 × 320 at 25°
// comes out at 7.5°), so the facility says so rather than shipping it quietly: under 15° it
// warns, and `qr-stand.test.mjs` sweeps 81 builds to check that nothing under 15° stays quiet
// and nothing quiet is under it. `metrics.margin` and `metrics.tipAngle` carry the numbers, and
// the test re-derives them off the built rings and the poses rather than trusting them.
//
// ---------------------------------------------------------------------------- the API --
//
//   const g = footStandGeometry({ width, height, t, kerf, lean });   // rings, poses, numbers
//   ...build your layers inside `g.content` (the plate's clear rectangle)...
//   const { blank, layers, pose, parts, status } = footStandPieces(g, { face });
//
// Two calls because the content box has to exist before a caller can fit type or a QR into it.
// Nothing here touches manifold: every ring is closed-form, so a node test can hold the whole
// construction to the equations above.
import { placeShapes, roundedRectRing, type Box, type Shapes } from '@vostok/shapes';
import type { CutRing } from '@vostok/export';
import { FIT, slotRing, slotWidth } from './slots';
import type { Blank, DesignLayer, PartInput, Pose } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Air between the pieces on the sheet, mm. */
const SHEET_GAP = 8;
/** No mark sits closer than this to a cut edge, mm — the house inset. */
const EDGE = 4;
/** Air between the top of a foot slot and anything drawn on the plate, mm: the plinth the old
 *  build left, and the reason the frame rule is not cut into three pieces by the two slots. */
const PLINTH = 3.5;

const ODD_WIDTH = 'The slot comes out an odd width — check the thickness and the kerf.';

// ------------------------------------------------------------------ the foot's outline --

/** A quarter circle from `fromDeg` to `fromDeg + 90`, both ends included. */
function quarter(cx: number, cy: number, r: number, fromDeg: number, seg = 8): CutRing {
  const out: CutRing = [];
  for (let i = 0; i <= seg; i++) {
    const t = rad(fromDeg + (i / seg) * 90);
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/**
 * The hump's top profile, in the foot's own frame: `e` at both ends, a FLAT crown `2·flat` wide
 * centred on the notch (which sits `at` back from the FRONT end), and a raised cosine between —
 * zero slope at all four joins, so there is no cusp anywhere for a rotated slot mouth to catch on.
 *
 * The flat is what makes the crown a real shoulder: the notch is cut out of the middle of it, so
 * the material either side of the joint is a flat face bearing on the plate, and the foot's own
 * bounding box is EXACTLY `P` tall however wide the notch gets. That second part is not cosmetic
 * — a pose places the centre of a piece's BOX, so a crown the notch had bitten the peak off left
 * the foot hovering 0.2 mm above the table in 9 mm stock.
 */
const humpAt = (x: number, L: number, P: number, e: number, at: number, flat: number): number => {
  const d = Math.abs(x + L / 2 - at);
  if (d <= flat) return P / 2;
  const reach = Math.max(1e-6, (x + L / 2 < at ? at : L - at) - flat);
  return -P / 2 + e + (P - e) * 0.5 * (1 + Math.cos((Math.PI * (d - flat)) / reach));
};

/**
 * The foot, in its own frame: bbox `L × P` centred on the origin, +x the BACK of the stand.
 * The profile above over two filleted bottom corners, sampled about every millimetre.
 */
function footRing(L: number, P: number, e: number, at: number, flat: number, corner: number): CutRing {
  const hl = L / 2;
  const hp = P / 2;
  const c = clamp(corner, 0, Math.min(hl, e * 0.6));
  const ring: CutRing = [];
  if (c > 0.01) {
    ring.push(...quarter(-hl + c, -hp + c, c, 180));
    ring.push(...quarter(hl - c, -hp + c, c, 270));
  } else {
    ring.push([-hl, -hp], [hl, -hp]);
  }
  ring.push([hl, -hp + e]);
  const steps = Math.max(8, Math.round(L));
  // The flat's own two ends are always sampled, so the shoulder is exactly as wide as it says.
  const xs = [...Array(steps - 1).keys()].map((i) => ((i + 1) / steps) * L - hl);
  for (const edge of [at - flat - hl, at + flat - hl]) if (edge > -hl && edge < hl) xs.push(edge);
  xs.sort((a, b) => b - a);
  for (const x of xs) ring.push([x, humpAt(x, L, P, e, at, flat)]);
  ring.push([-hl, -hp + e]);
  return ring;
}

/** Signed area of a closed ring and its centroid — the balance below weighs the REAL outline,
 *  hump, fillets and all, not its bounding box. */
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

// ------------------------------------------------------------------ the numbers --

export interface FootStandInput {
  /** The plate, across. */
  width: number;
  /** The plate, along its own lean — what the customer looks at. */
  height: number;
  t: number;
  kerf: number;
  /** Degrees from VERTICAL: 0 stands it bolt upright, 10–15 is the angle a seated person reads. */
  lean?: number;
  clearance?: number;
  /** The plate's corner radius, mm. */
  corner?: number;
  /** How far each foot stands in from the plate's own side edge, mm. Default 18 % of the width,
   *  capped at 30 — the "face" the two slots leave clear at each end of the bottom edge. */
  inFromEdge?: number;
}

/** Every number the construction is proved on — the test reads these and re-derives them. */
export interface FootStandMetrics {
  /** Degrees from vertical. */
  lean: number;
  width: number;
  height: number;
  /** How high the plate's top edge stands above the table. */
  standHeight: number;
  /** The half-lap, along the plate: the plate's own slot and the foot's notch, and the one
   *  height above the table their two roots meet at. */
  lap: number;
  footLap: number;
  jointZ: number;
  /** As drawn: `t − kerf + clearance`, both halves of the joint. */
  slot: { width: number; depth: number };
  /** The foot: tip to tip, its crown, its ends, the flat shoulder either side of the notch,
   *  where the notch sits back from the FRONT end, and the material left above the notch root —
   *  the horns that grip the plate. */
  foot: { length: number; crown: number; ends: number; flat: number; notchAt: number; web: number };
  /** Where each foot crosses, as ±x on the plate, and the half-width of the sideways footprint. */
  cross: { x: number; halfWidth: number };
  /** The two feet's undersides, as the world's y (front is negative), and the depth between. */
  footprint: { front: number; back: number; depth: number };
  /** The assembled stand's centre of mass, world mm. */
  com: { y: number; z: number };
  /** How far the centre of mass sits inside the footprint's front and back edges, and inside
   *  either side, mm. */
  margin: { front: number; back: number; side: number };
  /** How far the table can be tilted before the stand goes over, degrees — the smaller of the
   *  fore-and-aft and the sideways answer. */
  tipAngle: number;
}

export interface FootStandGeometry {
  width: number;
  height: number;
  t: number;
  /** The plate, centred on its own box. */
  plate: CutRing;
  /** Its two foot slots, open on the bottom edge. Give them to an `op: 'cut'` layer. */
  plateSlots: Shapes;
  /** The foot, centred on its own box — one part, cut twice. */
  foot: CutRing;
  /** The foot's half-lap, already rotated to the lean and placed in the foot's own frame. */
  footSlot: Shapes;
  /** The clear rectangle on the plate's face, in the plate's own frame: clear of the edges and
   *  of the plinth the two slots need under it. */
  content: Box;
  platePose: Pose;
  /** Where the foot at `x` on the plate stands in three dimensions. */
  footPose(x: number): Pose;
  /** Where each foot is drawn on the flat Assembled card: a ghost at the plate's own foot, so
   *  the card is the standing plate rather than a plate beside two humps. */
  footAt: { x: number; y: number };
  metrics: FootStandMetrics;
  warnings: string[];
}

/**
 * The stand, in rings and poses. Pure: no CSG, no fonts, no values object.
 */
export function footStandGeometry(i: FootStandInput): FootStandGeometry {
  const width = Math.max(30, i.width);
  const height = Math.max(50, i.height);
  const t = Math.max(0.5, i.t);
  const kerf = Math.max(0, i.kerf);
  const lean = clamp(i.lean ?? 12, 0, 30);
  const clearance = i.clearance ?? FIT.snug!;
  const warnings: string[] = [];

  const th = rad(lean);
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const corner = clamp(i.corner ?? Math.min(9, 0.08 * height), 0, Math.min(width, height) / 2);

  // ------------------------------------------------------------------------ the joint --
  // A void either side, so both halves are drawn a kerf narrow and land `clearance` apart.
  const drawn = slotWidth(t, kerf, clearance);
  const slot = clamp(drawn, 0.2, 2 * t);
  // The plate's slot, along the plate. 12 % of the height is the old build's proportion, and it
  // is what keeps a tall sign's feet deep enough to matter without eating its lettering.
  const lap = Math.round(clamp(0.12 * height, 9, 22));
  // The crown: the half-lap's own depth plus the web above it, and never so low that the feet
  // look like slivers under a big plate.
  const web = Math.max(8, 2.5 * t);
  const crown = Math.max(lap * cs + web, 0.13 * height);
  // Long enough that the notch is a dip in a hump rather than a gap between two horns.
  const ends = clamp(Math.max(5, 0.3 * crown), 1, crown - 1);
  // The footprint scales with the plate's height — a taller sign needs a deeper one — but never
  // past the plate's own width: a foot longer than the sign is wide is a sign on skis, and it is
  // also what would push the Assembled card's box out past the plate it is a picture of. The
  // floor is the hump's own proportion, so a short plate in thick stock keeps a foot rather than
  // a ball.
  const length = Math.max(crown / 0.45, Math.min(clamp(0.62 * height, 48, 150), Math.max(width, 48)));
  const notchAt = clamp(0.4 * length, 1, length - 1);
  // The shoulder either side of the notch, on the crown: half the slot (which the notch takes)
  // plus real material to bear on. The tilted mouth reaches at most `(slot/2)·cos θ + 0.5·sin θ`
  // across, which is under `slot/2 + 2` at every lean this form allows.
  const flat = Math.min(slot / 2 + Math.max(2, 0.6 * t), 0.2 * length);

  // The mouth of the rotated slot has to clear the foot's own surface at every point across it,
  // not just at its centre: on thick stock at a steep lean it would otherwise exit through the
  // front slope as well as the crown and cut each foot with TWO notches. Lift the mouth (and
  // deepen the slot by the same amount, so its closed end does not move) until the whole mouth
  // line is outside the material.
  let clear = 0;
  for (let k = 0; k <= 8; k++) {
    const along = (k / 8 - 0.5) * slot;
    const mx = notchAt - length / 2 + along * cs + 0.5 * sn;
    const my = crown / 2 - along * sn + 0.5 * cs;
    clear = Math.max(clear, humpAt(mx, length, crown, ends, notchAt, flat) - my);
  }
  const lift = Math.max(0, clear + 0.25);

  // The foot's half-lap, so the two roots meet at exactly one height — `jointZ`. The plate's own
  // slot root sits `lap` up a plate whose bottom FRONT corner is the bit that touches the table,
  // which lifts the mid-plane by (t/2)·sin θ; the lift the mouth took has to come back off the
  // depth the same way. The clamp is the old build's one safety: the deepest corner of the
  // rotated slot never breaks through the foot's underside.
  const jointZ = lap * cs + (t / 2) * sn;
  const footLap = clamp((crown + lift - jointZ) / cs - lift, 2, Math.max(2, (crown - 1.5 - (slot / 2) * sn) / cs));

  const foot = footRing(length, crown, ends, notchAt, flat, clamp(0.08 * crown, 1.5, 5));
  const footSlot: Shapes = placeShapes(
    [[slotRing(0, 0, slot, footLap + lift, 'top', { nodes: true })]],
    notchAt - length / 2, crown / 2 + lift, -lean,
  );

  // ---------------------------------------------------------------------- the plate --
  const halfW = width / 2;
  const face = clamp(i.inFromEdge ?? 0.18 * width, 10, 30);
  const crossX = Math.max(slot / 2 + 2, halfW - face);
  const plate = roundedRectRing(width, height, corner);
  const plateSlots: Shapes = [
    [slotRing(-crossX, -height / 2, slot, lap, 'bottom', { nodes: true })],
    [slotRing(crossX, -height / 2, slot, lap, 'bottom', { nodes: true })],
  ];

  const margin = Math.max(EDGE, 0.06 * width);
  const content: Box = {
    minX: -(halfW - margin),
    maxX: halfW - margin,
    minY: -height / 2 + lap + PLINTH,
    maxY: height / 2 - Math.max(margin, corner * 0.8),
  };

  // ------------------------------------------------------------------------ standing up --
  // `rx: 90 − lean` leans the plate back off the reader: its own +y runs up and back, and its
  // own +z — the engraved face's normal — runs forward and up, at the customer. The centre goes
  // where the plate's lower FRONT corner lands on the table.
  const platePose: Pose = { x: 0, y: (height / 2) * sn, z: (height / 2) * cs + (t / 2) * sn, rx: 90 - lean };
  /** The y of the plate's mid-plane at height z — where both feet's notches have to meet it. */
  const midPlaneY = (z: number) => (z - (t / 2) * sn) * (sn / cs);
  // Each foot stands on the table (`rx: 90`) and runs front-to-back (`rz: 90`), set so the mouth
  // of its own half-lap — `notchAt` back from its front end, `lift` above its crown — sits
  // exactly on that mid-plane. (A pose places the centre of the piece's BOX, which for the foot
  // is `crown/2` above the table.)
  const footY = midPlaneY(crown + lift) - (notchAt - length / 2);
  const footPose = (x: number): Pose => ({ x, y: footY, z: crown / 2, rx: 90, rz: 90 });

  // ------------------------------------------------------------------------ does it stand --
  // Every piece is the same sheet, so area IS mass. Both cut-outs are taken off the piece they
  // are cut from, centroid and all — a 17 mm slot in a 140 mm plate is under a per cent, but
  // measuring it is cheaper than arguing about it.
  const less = (body: { area: number; cx: number; cy: number }, holes: Shapes) => {
    let { area, cx, cy } = body;
    for (const island of holes) {
      const hole = areaCentroid(island[0]!);
      const next = Math.max(1e-6, area - hole.area);
      cx = (area * cx - hole.area * hole.cx) / next;
      cy = (area * cy - hole.area * hole.cy) / next;
      area = next;
    }
    return { area, cx, cy };
  };
  const p = less(areaCentroid(plate), plateSlots);
  const f = less(areaCentroid(foot), footSlot);
  const mass = p.area + 2 * f.area;
  const com = {
    y: (p.area * (platePose.y + p.cy * sn) + 2 * f.area * (footY + f.cx)) / Math.max(1e-6, mass),
    z: (p.area * (platePose.z + p.cy * cs) + 2 * f.area * (crown / 2 + f.cy)) / Math.max(1e-6, mass),
  };
  // The support is the two feet's flat undersides. The plate's own bottom edge rests on the
  // table too, at y = (t/2)·cos θ, but it lands inside this span and is not counted.
  const footprint = { front: footY - length / 2, back: footY + length / 2, depth: length };
  const halfWidth = crossX + t / 2;
  const marginOut = { front: com.y - footprint.front, back: footprint.back - com.y, side: halfWidth };
  const tipAngle = (Math.atan2(Math.max(0, Math.min(marginOut.front, marginOut.back, marginOut.side)), Math.max(1e-6, com.z)) * 180) / Math.PI;

  // -------------------------------------------------------------------------- what to say --
  if (lean < 6) warnings.push('Under 6° the sign is held by the joint alone. 10–15° is the angle a seated person reads.');
  if (crown - lap * cs < Math.max(4, 1.5 * t)) warnings.push('The feet are too short for this lean — reduce the lean or the thickness.');
  if (drawn <= 0.5 || drawn >= 1.8 * t) warnings.push(ODD_WIDTH);
  if (tipAngle < 15) warnings.push('This stand goes over easily — shorter, or wider feet, is steadier.');
  if (height > 250 && t <= 3) warnings.push('A plate this tall bows in 3 mm. Use 6 mm.');
  if (content.maxY - content.minY < 20 || content.maxX <= content.minX) {
    warnings.push('There is no room left on the plate to engrave anything — make it bigger.');
  }

  return {
    width, height, t,
    plate,
    plateSlots,
    foot,
    footSlot,
    content,
    platePose,
    footPose,
    footAt: { x: 0, y: -height / 2 + crown / 2 },
    metrics: {
      lean, width, height,
      standHeight: height * cs + t * sn,
      lap, footLap, jointZ,
      slot: { width: slot, depth: lap },
      foot: { length, crown, ends, flat, notchAt, web: crown - lap * cs },
      cross: { x: crossX, halfWidth },
      footprint,
      com,
      margin: marginOut,
      tipAngle,
    },
    warnings,
  };
}

// ------------------------------------------------------------------ the pieces --

export interface FootStandContent {
  /** What the PLATE carries, in its own frame — `g.content` is the room it has. */
  face: DesignLayer[];
  /** In a run the sheet nests every copy, so the explicit placements come off. */
  batched?: boolean;
}

export interface FootStandPieces {
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  material: 'light';
  pose: Pose;
  parts: PartInput[];
  status: string;
}

/**
 * The three pieces, ready to spread into a `BuildInput`: the PLATE is the primary — it is the
 * product, and the feet are invisible from the front — and the two feet follow it. The caller
 * adds its own keyring (a stand hangs from nothing), warnings and file name.
 */
export function footStandPieces(g: FootStandGeometry, content: FootStandContent): FootStandPieces {
  const m = g.metrics;
  const gapX = g.width / 2 + SHEET_GAP + m.foot.length / 2;
  const foot = (id: string, x: number, y: number): PartInput => ({
    id,
    label: 'Foot',
    blank: { kind: 'shape', shapes: [[g.foot]] },
    layers: [{ id: 'lap', label: 'Half-lap', op: 'cut', shapes: g.footSlot }],
    keyring: 'none',
    material: 'light',
    ...(content.batched ? {} : { at: { x: gapX, y } }),
    // A ghost at the plate's own foot, both of them: a stand seen from the front IS its plate,
    // and the feet run away from the reader where nothing of them shows.
    assembledAt: g.footAt,
    previewStyle: 'dashed',
    z: 0,
    pose: g.footPose(x),
  });

  return {
    label: 'Plate',
    blank: { kind: 'shape', shapes: [[g.plate]] },
    layers: [...content.face, { id: 'foot-slots', label: 'Foot slots', op: 'cut', shapes: g.plateSlots }],
    material: 'light',
    pose: g.platePose,
    parts: [
      foot('foot-a', -m.cross.x, (m.foot.crown + 6) / 2),
      foot('foot-b', m.cross.x, -(m.foot.crown + 6) / 2),
    ],
    status: '3 pieces',
  };
}
