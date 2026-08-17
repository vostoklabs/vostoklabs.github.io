// The two shapes every folding carton is made of, plus the clamps that keep them
// legal at the edges of the parameter range.
//
// Every published carton standard this was checked against fails somewhere in our
// own range — ECMA's dust flap overlaps by 10.5 mm on any square-footprint box, its
// 12 mm tuck overshoots any box shorter than 12 mm, and its 45 degree glue taper
// needs a box taller than 24 mm before the two tapers stop crossing. So nothing here
// is a constant: every derived dimension is clamped against the dimension it has to
// fit inside.

import type { Panel, Poly, Pt, Slit } from '../types';
import { arcPoints, at, bboxOf, rect, roundCorners, signedArea, stadium } from './poly';

export const HALF = Math.PI / 2;

/** Corner relief between two plies that meet at a folded corner. One caliper is the
 *  converter's rule; 0.4 mm is the floor, because below that a hand-folded box binds
 *  on its own fibres. */
export function relief(t: number): number {
  return Math.max(0.4, t);
}

/** How much a crease moves when the panel it is on has to fold OVER another ply.
 *  Measured directly off a CAD dieline as 0.63 mm on 0.31 mm board — exactly 2t —
 *  and it shows up there as a pair of parallel creases rather than one line. */
export function layerStep(t: number): number {
  return 2 * t;
}

/** Tuck depth is an ABSOLUTE BAND, not a proportion of the box.
 *
 *  This was a proportion of W, which is wrong: three independent sources give it as
 *  a constant in millimetres (InkPACKING's own bounds are 5-18 with a 14 default,
 *  and a measured CAD dieline came out at 18.07 on a 37.5 mm deep box, which is 0.48W
 *  and would have been 0.6W under the old rule). It is a constant because it is sized
 *  by what a finger and a friction fit need, not by how big the box is.
 *
 *  The clamps are what a constant cannot do for itself: it must fit inside the box's
 *  own height, and it must not be so deep it fouls the far wall. */
export const TUCK_NOMINAL_MM = 14;

export function tuckDepth(W: number, H: number, override: number): number {
  const want = override > 0 ? override : TUCK_NOMINAL_MM;
  return clamp(want, 6, Math.max(6, Math.min(0.45 * H, 0.6 * W)));
}

/** Dust flap depth. Two of these fold toward each other across the opening, so the
 *  binding constraint is the OTHER dimension, not this one — and the closure panel
 *  lands on top of both, so they give up half a caliper to it. */
export function dustDepth(L: number, W: number, tuck: number, t: number): number {
  return Math.max(4, Math.min((W + tuck) / 2 - t / 2, L / 2 - relief(t)));
}

/** Glue lap taper. Tapered so the lap slides behind the opposite panel without
 *  catching; the angle is capped so the two tapers cannot cross on a flat box. */
export function glueTaper(tabW: number, H: number): number {
  return Math.min(tabW * 0.35, Math.max(0, H / 2 - 1));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A glue lap hinged on its left edge, tapered top and bottom. */
export function glueTab(x: number, y: number, w: number, h: number): Poly {
  const c = glueTaper(w, h);
  return [
    [x, y],
    [x + w, y + c],
    [x + w, y + h - c],
    [x, y + h],
  ];
}

/** A thumb scallop bitten out of the top edge of a rectangle — the half-circle you
 *  hook a finger into to open a lid. Returned as a replacement outline, because a
 *  notch on a boundary is part of the cut path, not a hole. */
export function notchTop(r: Poly, cx: number, topY: number, radius: number): Poly {
  const out: Poly = [];
  // Which way the arc has to sweep to remove material rather than add it depends on
  // the ring's winding, and BOTH windings reach here: the closure builds its top tuck
  // counter-clockwise and mirrors the bottom one. Sweeping a fixed +y put a semicircular
  // BUMP on every up-facing tuck — the blank grew 7 mm and the "thumb notch" was a tab.
  const sweep = signedArea(r) >= 0 ? -Math.PI : Math.PI;
  for (let i = 0; i < r.length; i++) {
    const a = at(r, i);
    const b = at(r, i + 1);
    out.push(a);
    // Only the edge running right-to-left along the top gets the bite, so a rotated
    // or mirrored panel keeps its notch on the opening edge.
    const onTop = Math.abs(a[1] - topY) < 1e-3 && Math.abs(b[1] - topY) < 1e-3;
    if (onTop && a[0] > b[0]) {
      out.push([cx + radius, topY]);
      out.push(...arcPoints(cx, topY, radius, 0, sweep, 10).slice(1, -1));
      out.push([cx - radius, topY]);
    }
  }
  return out;
}

// ─────────────────────────────────── tray ───────────────────────────────────

export interface TrayOpts {
  prefix: string;
  labelPrefix: string;
  /** Inside dimensions of the tray. */
  L: number;
  W: number;
  H: number;
  t: number;
  /** Where the base's bottom-left corner sits in the net. */
  x: number;
  y: number;
  rootPose?: Panel['rootPose'];
  /** Aperture in the base panel, in base-local coordinates. */
  baseHole?: Poly;
  /** Fold the walls down instead of up — what a lid does when it comes over a tray. */
  invert?: boolean;
  /** Raise the two long walls into carry handles this far above the rim.
   *  The handle is part of the WALL, not a panel hinged to it: a basket tray's side
   *  rises straight out of its wall and there is no fold line there to draw. */
  handleRiseMm?: number;
}

/** A self-locking four-corner tray.
 *
 *  The old one was four walls and four ears, and the ears were folded in behind the
 *  short walls with NOTHING holding them there. That is not a glue-free tray, it is a
 *  tray you have to glue and a badge that says you do not — the ears spring straight
 *  back out and the walls fall flat. Every real glue-free tray solves this the same
 *  way, and it is the way the mailer already solved it here: the short wall carries
 *  on over the rim and back down INSIDE, trapping the ear between its two plies, and
 *  its tabs drop through slots in the floor so the roll cannot open either.
 *
 *          ┌──────────────────────┐
 *          │       wall N         │   long walls, single ply, with the ears
 *     ┌────┼──────────────────────┼────┐
 *     │ear │                      │ear │
 *     │roll│         BASE         │roll│  short walls roll: wall │ 2t │ inner + tabs
 *     │ear │      ▭        ▭      │ear │  (▭ = the slots the tabs drop through)
 *     └────┼──────────────────────┼────┘
 *          │       wall S         │
 *          └──────────────────────┘
 */
export function tray(o: TrayOpts): { panels: Panel[]; slits: Slit[]; extent: [number, number] } {
  const { prefix: p, labelPrefix: lp, L, W, H, t, x, y } = o;
  const g = relief(t);
  const sign = o.invert ? -1 : 1;
  const fold = sign * HALF;

  // The rolled ends are double-ply, so the floor has to be longer than the inside by
  // 2.5t at each end — the same allowance the reference mailer dieline makes.
  const BL = L + 5 * t;
  const BW = W + 2 * t;
  const wallH = H + t;

  const base: Panel = {
    id: `${p}base`,
    label: `${lp}base`,
    role: 'base',
    outline: rect(x, y, BL, BW),
    holes: o.baseHole ? [o.baseHole] : [],
    parent: null,
    foldAngle: 0,
    rootPose: o.rootPose,
  };

  // A carry handle is a raised section of the long wall itself, with a hand hole in
  // it — a basket tray, an egg-crate, a produce tray. Drawn as part of the wall
  // outline rather than as a hinged blade because there is no fold there: an extra
  // panel would put a crease line straight across the handle.
  const rise = Math.max(0, o.handleRiseMm ?? 0);
  const wx = x + g;
  const ww = BL - 2 * g;
  const handled = rise > 4 && ww > 40;
  const gripW = Math.min(ww * 0.45, 95);
  const gripH = Math.min(rise * 0.5, 24);

  /** Long-wall outline: a plain rectangle, or one with a raised handle on its rim. */
  const longWall = (yBase: number, dirY: 1 | -1): { outline: Poly; holes: Poly[] } => {
    const rim = yBase + dirY * wallH;
    if (!handled) {
      return { outline: span(wx, wx + ww, yBase, rim), holes: [] };
    }
    const top = yBase + dirY * (wallH + rise);
    const shoulder = Math.min(rise * 0.9, (ww - gripW) / 2 - 2);
    const ring: Poly = [
      [wx, yBase],
      [wx + ww, yBase],
      [wx + ww, rim],
      [wx + (ww + gripW) / 2 + shoulder, rim],
      [wx + (ww + gripW) / 2 + shoulder * 0.15, top],
      [wx + (ww - gripW) / 2 - shoulder * 0.15, top],
      [wx + (ww - gripW) / 2 - shoulder, rim],
      [wx, rim],
    ];
    return {
      outline: roundCorners(ring, [0, 0, 0, Math.min(8, shoulder), 10, 10, Math.min(8, shoulder), 0]),
      // The hole sits below the top edge by more than its own half-height: a hand
      // hole any nearer the rim tears out the first time the tray is carried.
      holes: [
        stadium(
          wx + ww / 2,
          yBase + dirY * (wallH + rise - gripH / 2 - Math.max(6, rise * 0.28)),
          gripW,
          gripH,
        ),
      ],
    };
  };

  const wallS: Panel = {
    id: `${p}s`,
    label: `${lp}front`,
    role: 'body',
    ...longWall(y, -1),
    parent: base.id,
    foldAngle: fold,
    order: 1,
  };
  const wallN: Panel = {
    id: `${p}n`,
    label: `${lp}back`,
    role: 'body',
    ...longWall(y + BW, 1),
    parent: base.id,
    foldAngle: fold,
    order: 1,
  };

  // Ears, hinged VERTICALLY one relief in from the floor's end — which is what lands
  // them flat on the inner face of the end wall instead of in the same plane as it.
  // Half the tray's depth each, so the front ear and the back ear very nearly meet
  // inside the end and the roll has something to grip along its whole length.
  const earLen = Math.max(4, Math.min(BW / 2 - g, H + 2 * t));
  const chamfer = Math.min(earLen * 0.35, (wallH - 2 * g) * 0.35);
  const ear = (
    id: string,
    parent: string,
    hx: number,
    dirX: 1 | -1,
    yBase: number,
    yRim: number,
  ): Panel => {
    const d = Math.sign(yRim - yBase);
    return {
      id,
      label: `${lp}corner ear`,
      role: 'flap',
      outline: [
        [hx, yBase],
        [hx + dirX * earLen, yBase],
        [hx + dirX * earLen, yRim - d * chamfer],
        [hx + dirX * (earLen - chamfer), yRim],
        [hx, yRim],
      ],
      holes: [],
      parent,
      foldAngle: fold,
      order: 2,
    };
  };

  const rolls = [
    rollEnd({
      prefix: `${p}l`,
      parent: base.id,
      x,
      y0: y,
      y1: y + BW,
      dir: -1,
      H,
      t,
      order: 3,
      fold,
    }),
    rollEnd({
      prefix: `${p}r`,
      parent: base.id,
      x: x + BL,
      y0: y,
      y1: y + BW,
      dir: 1,
      H,
      t,
      order: 3,
      fold,
    }),
  ];
  base.holes = [...base.holes, ...rolls.flatMap((r) => r.slots)];

  const panels: Panel[] = [
    base,
    wallS,
    wallN,
    ...rolls.flatMap((r) => r.panels),
    ear(`${p}sw`, wallS.id, x + g, -1, y - g, y - wallH + g),
    ear(`${p}se`, wallS.id, x + BL - g, 1, y - g, y - wallH + g),
    ear(`${p}nw`, wallN.id, x + g, -1, y + BW + g, y + BW + wallH - g),
    ear(`${p}ne`, wallN.id, x + BL - g, 1, y + BW + g, y + BW + wallH - g),
  ];

  const b = bboxOf(panels.map((q) => q.outline));
  return { panels, slits: [], extent: [b[2] - b[0], b[3] - b[1]] };
}


// ───────────────────────────────── euro hang slot ─────────────────────────────────

/** The ISO 15348 retail peg slot: a round head with a narrower tail under it, as ONE
 *  closed ring.
 *
 *  It used to be two overlapping stadiums. That draws the right SHAPE and the wrong
 *  PATH — two closed cut rings that cross each other send the blade round a figure of
 *  eight and cut the overlap twice, which is the one thing the exporter's own rules
 *  forbid. It is also not a shape at all under an even-odd fill rule, so the printed
 *  sheet had no way to interpret it. One ring, traced round the union's real outline:
 *  up the tail, round the head, back down, and a cap across the bottom. */
export function euroSlot(cx: number, topY: number, heightMm: number, segments = 10): Poly {
  const R = clamp(heightMm * 0.42, 3, 10);
  const w = Math.min(4.5, R * 0.55);
  const cyHead = topY - R;
  const d = Math.sqrt(Math.max(1e-6, R * R - w * w));
  const yJoin = cyHead - d;
  const yb = Math.min(yJoin - 0.5, topY - heightMm + w);
  const a0 = Math.atan2(-d, w);
  return [
    [cx + w, yb],
    [cx + w, yJoin],
    ...arcPoints(cx, cyHead, R, a0, Math.PI - a0, segments).slice(1, -1),
    [cx - w, yJoin],
    [cx - w, yb],
    ...arcPoints(cx, yb, w, Math.PI, Math.PI * 2, 6).slice(1, -1),
  ];
}

// ────────────────────────────────── roll end ──────────────────────────────────

/** An axis-aligned rectangle given as two x bounds and two y bounds, in any order.
 *  A roll end is built outward from a crease in whichever direction it faces, and
 *  writing every panel as `rect(min, …, width)` there means computing the min first
 *  at every single call. Winding is fixed by `buildNet`, so order does not matter. */
function span(xa: number, xb: number, ya: number, yb: number): Poly {
  return [
    [xa, ya],
    [xb, ya],
    [xb, yb],
    [xa, yb],
  ];
}

export interface RollEndOpts {
  prefix: string;
  /** The base panel this rolls off. */
  parent: string;
  /** x of the base edge it hinges on, and the y run of that edge. */
  x: number;
  y0: number;
  y1: number;
  /** Which way the roll goes: -1 for the net's −x, +1 for +x. */
  dir: 1 | -1;
  H: number;
  t: number;
  /** Die-cut hand hole through BOTH plies, or null. */
  hand?: { w: number; h: number } | null;
  /** Animation stage of the outer wall; the roll's two other panels follow it. */
  order: number;
  /** Signed fold, so a lid's roll can go down while a tray's goes up. */
  fold?: number;
}

/** The roll end of a mailer box — the reason a mailer needs no glue.
 *
 *  Measured off a production RETT dieline (315 × 202 × 62, 1.5 mm board) rather than
 *  invented. From the base crease outward it is three panels and a pair of tabs:
 *
 *      base │ outer wall (H) │ roll (2t) │ inner wall (H−t) │ tabs
 *
 *  The 2 mm strip in the middle is not decoration: the wall folds over its own
 *  thickness twice, so the reference dieline draws TWO parallel creases 2t apart
 *  there. Collapse them into one and the inner ply is a caliper too long and bows.
 *
 *  The inner ply stops one caliper short of the floor and the tabs carry on past it,
 *  through slots cut in the base — which is what stops the roll springing open, and
 *  what traps the ears folded in from the front and back walls on the way. */
export function rollEnd(o: RollEndOpts): { panels: Panel[]; slots: Poly[] } {
  const { prefix: p, dir, H, t, x, y0, y1 } = o;
  const g = relief(t);
  const run = y1 - y0;
  const step = layerStep(t);
  const innerD = Math.max(4, H - t);
  // The tab has to clear the floor it passes through, so it is sized against the
  // board rather than being a constant — and it never goes below what a finger can
  // actually push into a slot.
  const tabLen = Math.max(2.5, 3 * t);
  const slotW = Math.max(2.5 * t, 1.8);
  // The inner ply stands 2t out from the crease, so the slot has to contain that —
  // but on cardstock 2t is a third of a millimetre and a slot ON the crease would
  // cut the fold. Hence a floor, then centre the slot on where the ply actually is.
  const slotX0 = Math.max(0.6, 2 * t - slotW / 2);
  const clear = Math.max(0.4, t);
  const tabH = clamp(run * 0.2, 5, 30);
  const centres = [y0 + run * 0.3, y0 + run * 0.7];

  /** Distance out from the crease -> net x. */
  const X = (d: number): number => x + dir * d;
  const mid = (y0 + y1) / 2;

  const hand =
    o.hand && H >= o.hand.h + 16 && run >= o.hand.w + 20
      ? { ...o.hand, inset: o.hand.h / 2 + Math.max(7, H * 0.15) }
      : null;

  const fold = o.fold ?? HALF;

  const wall: Panel = {
    id: `${p}wall`,
    label: 'end wall',
    role: 'body',
    outline: span(X(0), X(H), y0, y1),
    // Wide along the run of the wall, shallow across its height — the roll's x axis
    // is the box's HEIGHT and its y axis is the box's width, so the stadium's two
    // axes go in the opposite order to the way it reads. Swapped, a 40 mm hole ran
    // up a 50 mm wall and the wall's hole and the inner ply's hole overlapped.
    holes: hand ? [stadium(X(H - hand.inset), mid, hand.h, hand.w)] : [],
    parent: o.parent,
    foldAngle: fold,
    order: o.order,
  };

  const roll: Panel = {
    id: `${p}roll`,
    label: 'roll',
    role: 'body',
    outline: span(X(H), X(H + step), y0 + g, y1 - g),
    holes: [],
    parent: wall.id,
    foldAngle: fold,
    order: o.order + 1,
  };

  // Far edge of the inner ply, with a tab standing proud of it at each centre.
  const A = X(H + step);
  const B = X(H + step + innerD);
  const T = X(H + step + innerD + tabLen);
  const far: Poly = [[B, y0 + g]];
  for (const c of centres) {
    far.push([B, c - tabH / 2], [T, c - tabH / 2], [T, c + tabH / 2], [B, c + tabH / 2]);
  }
  far.push([B, y1 - g]);

  const inner: Panel = {
    id: `${p}inner`,
    label: 'inner wall',
    role: 'flap',
    outline: [[A, y0 + g], ...far, [A, y1 - g]],
    holes: hand ? [stadium(X(H + step + hand.inset), mid, hand.h, hand.w)] : [],
    parent: roll.id,
    foldAngle: fold,
    order: o.order + 2,
  };

  // The slots live in the BASE, on the far side of the crease from everything above.
  const slots = centres.map((c) =>
    span(
      x - dir * slotX0,
      x - dir * (slotX0 + slotW),
      c - tabH / 2 - clear,
      c + tabH / 2 + clear,
    ),
  );

  return { panels: [wall, roll, inner], slots };
}

// ───────────────────────────────── handle blade ─────────────────────────────────

export interface HandleBladeOpts {
  id: string;
  label: string;
  parent: string;
  /** Crease the blade stands up from: the line y = yc, centred on cx. */
  cx: number;
  yc: number;
  /** +1 puts the blade above the crease in the net, −1 below. */
  dir: 1 | -1;
  /** Width at the crease, and height above it. */
  width: number;
  height: number;
  /** Signed, because the sense is NOT the same as every other flap's.
   *
   *  The blade hangs off a lid that has itself folded twice — wall up, lid over — so
   *  by the time the fold reaches the blade the parent's plane is upside down and
   *  another +90 sends the strap straight down INTO the box. It has to fold the
   *  other way. The caller knows how deep in the tree it is; this does not. */
  foldAngle: number;
  order: number;
}

/** The carry handle of a glue-free bakery box: a strap standing up from the ridge
 *  with the hand hole cut through it, open at the bottom onto the crease itself.
 *
 *  That open bottom is the whole trick, and it falls out of the derivation for free.
 *  The blade meets its parent along TWO runs — the strap's two legs — with the hand
 *  hole's mouth in between. `buildNet` sees twins under the legs and no twin under
 *  the mouth, so the legs come out creased and the mouth comes out cut, without any
 *  builder saying so. Two blades meet face to face and the hole becomes one handle. */
export function handleBlade(o: HandleBladeOpts): Panel {
  const { cx, yc, dir } = o;
  const w = o.width;
  const h = o.height;
  const strapW = bladeShoulder(w);

  const L0 = cx - w / 2;
  const R0 = cx + w / 2;
  const L1 = L0 + strapW;
  const R1 = R0 - strapW;
  const holeW = w - 2 * strapW;
  const holeH = clamp(h * 0.62, 4, Math.max(4, h - 5));

  // Both profiles lean in at the same angle, which is what keeps the strap an even
  // thickness all the way round instead of pinching at the shoulders. 6 degrees is
  // what the reference dieline draws — but a taper is a proportion of the HEIGHT and
  // the hole is only as wide as the blade, so on a small blade a fixed 6 degrees
  // closes the hole up and then crosses it over itself. Cap it on the hole instead.
  const k = Math.min(0.104, holeH > 0 ? (holeW * 0.28) / (2 * holeH) : 0);

  const Y = (v: number): number => yc + dir * v;
  const ring: Poly = [
    [L0, Y(0)],
    [L1, Y(0)],
    [L1 + k * holeH, Y(holeH)],
    [R1 - k * holeH, Y(holeH)],
    [R1, Y(0)],
    [R0, Y(0)],
    [R0 - k * h, Y(h)],
    [L0 + k * h, Y(h)],
  ];
  const rOuter = Math.min(10, strapW, h / 3);
  const rInner = Math.min(8, strapW, holeH / 2);

  return {
    id: o.id,
    label: o.label,
    role: 'flap',
    outline: roundCorners(ring, [0, 0, rInner, rInner, 0, 0, rOuter, rOuter]),
    holes: [],
    parent: o.parent,
    foldAngle: o.foldAngle,
    order: o.order,
    // Two blades that meet exactly co-planar z-fight down their whole length, so
    // each stops a hair short. Signed with the fold, or a mountain crease would
    // undershoot past square instead of stopping before it.
    undershoot: Math.sign(o.foldAngle) * 0.05,
  };
}

/** How thick a blade of this width makes its strap. Exported because the locking
 *  wing's slot has to stop clear of the shoulders, and because both numbers have to
 *  come from the same place or the slot swallows the shoulder it is meant to catch.
 *
 *  Nominally 9 % of the width — but never more than a quarter of it, or there is no
 *  hole left, and the 6 mm floor gives way rather than eat a small blade whole. */
export function bladeShoulder(width: number): number {
  return clamp(width * 0.09, Math.min(6, width * 0.2), width * 0.25);
}

// ─────────────────────────────────── tube ───────────────────────────────────

export interface TubeOpts {
  prefix: string;
  L: number;
  W: number;
  H: number;
  t: number;
  glueTabMm: number;
  x: number;
  y: number;
  rootPose?: Panel['rootPose'];
}

export interface Span {
  x: number;
  w: number;
}

export interface Tube {
  panels: Panel[];
  /** The four walls in wrap order: front (L), right (W), back (L), left (W).
   *  A tuple, not an array: there are always exactly four, and saying so is what
   *  lets every caller write  without a null check that can never fire. */
  walls: [Panel, Panel, Panel, Panel];
  /** x position and width of each wall, for hanging flaps off them. */
  spans: [Span, Span, Span, Span];
  totalWidth: number;
}

/** Four walls wrapping into a tube, plus a glue lap.
 *
 *  Each successive panel grows by one caliper, because it wraps around the plies
 *  already laid down inside it. The total girth is 2(L+W) + 4t, which is the number
 *  a box that closes flush actually needs — a tube built from bare L and W is a
 *  caliper too small on both axes and the seam gapes. */
export function tube(o: TubeOpts): Tube {
  const { prefix: p, L, W, H, t, x, y } = o;
  // Girth, measured off a CAD dieline rather than derived. The first three panels
  // sit at their nominal size and only the LAST one gives up 2t — it is the panel
  // that closes onto the glue lap, so it is the only one that has to clear plies
  // already laid down inside it. Growing every panel (which this used to do) makes
  // the tube 4t too big and the seam gapes.
  const widths = [L, W, L, Math.max(4, W - 2 * t)];
  const labels = ['front', 'right side', 'back', 'left side'];

  const spans: Span[] = [];
  let cx = x;
  for (const w of widths) {
    spans.push({ x: cx, w });
    cx += w;
  }

  const wallList: Panel[] = widths.map((w, i): Panel => ({
    id: `${p}w${i}`,
    label: labels[i] as string,
    role: 'body' as const,
    outline: rect((spans[i] as Span).x, y, w, H),
    holes: [],
    // Wall 0 is the root; each later wall hinges off the one before it, which is
    // exactly how the blank wraps and exactly the tree the animation wants.
    parent: i === 0 ? null : `${p}w${i - 1}`,
    foldAngle: i === 0 ? 0 : HALF,
    // A tube has no base panel to stand on — its root is the front WALL, which lies
    // flat in the blank. Left alone, the finished box would stand on its face. The
    // tilt brings the whole assembly upright as it closes, and the z offset puts the
    // bottom edge back on the ground once it is.
    rootPose: i === 0 ? (o.rootPose ?? { offset: [0, 0, H / 2], tilt: HALF }) : undefined,
  }));

  const walls = wallList as [Panel, Panel, Panel, Panel];

  const tab: Panel = {
    id: `${p}glue`,
    label: 'glue lap',
    role: 'glue',
    outline: glueTab(cx, y, o.glueTabMm, H),
    holes: [],
    parent: walls[3].id,
    foldAngle: HALF,
  };

  return {
    panels: [...walls, tab],
    walls,
    spans: spans as [Span, Span, Span, Span],
    totalWidth: cx + o.glueTabMm - x,
  };
}

/** A dust flap: hinged to a wall's top or bottom edge, folding into the opening.
 *  Its far corners are chamfered so it does not catch on the closure panel coming
 *  down over it. */
export function dustFlap(
  id: string,
  label: string,
  parent: string,
  x: number,
  y: number,
  w: number,
  depth: number,
  t: number,
  up: boolean,
): Panel {
  // Measured inset on the reference dieline is exactly 2t either side.
  const g = Math.max(relief(t), layerStep(t));
  const ch = Math.min(3, depth / 2, w / 4);
  const d = up ? depth : -depth;
  // Inset from the wall edges by one relief either side: two dust flaps and a
  // closure panel all meet in this corner and something has to give way.
  const outline: Poly = [
    [x + g, y],
    [x + w - g, y],
    [x + w - g - ch, y + d],
    [x + g + ch, y + d],
  ];
  return {
    id,
    label,
    role: 'flap',
    outline: up ? outline : [...outline].reverse(),
    holes: [],
    parent,
    foldAngle: HALF,
    // Past 90 so it visibly tucks under the panel closing over it — the detail that
    // makes the animation read as cardboard rather than as CAD.
    overshoot: 0.28,
    order: 2,
  };
}

/** A closure panel with a tuck flap on its far edge — the lid of a tuck carton.
 *
 *  The closure is one caliper shy of the box depth so its far crease lands on the
 *  inner face of the opposite wall, and the tuck is narrowed so it clears the two
 *  dust flaps it has to pass between. A slit lock adds the two nicks that catch
 *  under those flaps and stop the lid springing open. */
export function closure(opts: {
  prefix: string;
  parent: string;
  x: number;
  y: number;
  /** Wall width the closure hangs from. */
  w: number;
  /** Box depth the closure has to span. */
  depth: number;
  tuck: number;
  t: number;
  up: boolean;
  lock: 'none' | 'friction' | 'slit';
  thumbNotch: boolean;
  label: string;
}): { panels: Panel[]; slits: Slit[] } {
  const { prefix: p, x, y, w, t, up, tuck } = opts;
  const dir = up ? 1 : -1;
  // The closure panel is SHORTER than the box is deep, so its far crease lands on
  // the inner face of the opposite wall instead of on its edge. Two independent
  // sources agree on ~1.5 mm: EngView publishes PH = B - 1.5, and a measured CAD
  // dieline gives 35.94 on a 37.50 deep box. It only becomes caliper-driven on
  // thick board, hence the max.
  const panelH = Math.max(2, opts.depth - Math.max(1.5, layerStep(t)));
  const py = up ? y : y - panelH;

  const lid: Panel = {
    id: `${p}lid`,
    label: opts.label,
    role: 'lid',
    outline: rect(x, py, w, panelH),
    holes: [],
    parent: opts.parent,
    foldAngle: HALF,
    order: 3,
  };

  // A friction lock keeps the tuck full width and relies on the squeeze; a slit lock
  // narrows it by a caliper each side and nicks the shoulders so they catch.
  const inset = opts.lock === 'slit' ? Math.max(t, 0.5) : opts.lock === 'friction' ? t / 2 : t;
  const tw = Math.max(4, w - 2 * inset);
  const tx = x + (w - tw) / 2;
  const ty = up ? py + panelH : py - tuck;
  const r = Math.min(tuck * 0.6, tw / 2, 8);

  let tuckPoly: Poly = up
    ? [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw - r, ty + tuck],
        [tx + r, ty + tuck],
      ]
    : [
        [tx, ty + tuck],
        [tx + r, ty],
        [tx + tw - r, ty],
        [tx + tw, ty + tuck],
      ];
  if (!up) tuckPoly = [...tuckPoly];

  if (opts.thumbNotch) {
    const notchR = Math.min(7, tw / 4, tuck * 0.5);
    const cx = tx + tw / 2;
    tuckPoly = up
      ? notchTop(tuckPoly, cx, ty + tuck, notchR)
      : notchTop([...tuckPoly].reverse(), cx, ty, notchR).reverse();
  }

  const tuckPanel: Panel = {
    id: `${p}tuck`,
    label: 'tuck flap',
    role: 'tuck',
    outline: tuckPoly,
    holes: [],
    parent: lid.id,
    foldAngle: HALF,
    // The last flap stops just short of square so it never z-fights with the wall it
    // slides down behind.
    undershoot: 0.03,
    order: 4,
  };

  const slits: Slit[] = [];
  if (opts.lock === 'slit') {
    // Two nicks at the tuck's shoulders, cut back into the closure panel. These are
    // what catch under the dust flaps; without them a tuck carton springs open.
    const d = Math.max(1.5, 2 * t + 1);
    const sy = up ? py + panelH : py;
    slits.push({
      panelId: lid.id,
      op: 'cut',
      points: [
        [tx, sy],
        [tx, sy - dir * d],
      ],
    });
    slits.push({
      panelId: lid.id,
      op: 'cut',
      points: [
        [tx + tw, sy],
        [tx + tw, sy - dir * d],
      ],
    });
  }

  return { panels: [lid, tuckPanel], slits };
}
