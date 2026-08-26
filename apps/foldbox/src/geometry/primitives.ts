// The two shapes every folding carton is made of, plus the clamps that keep them
// legal at the edges of the parameter range.
//
// Every published carton standard this was checked against fails somewhere in our
// own range — ECMA's dust flap overlaps by 10.5 mm on any square-footprint box, its
// 12 mm tuck overshoots any box shorter than 12 mm, and its 45 degree glue taper
// needs a box taller than 24 mm before the two tapers stop crossing. So nothing here
// is a constant: every derived dimension is clamped against the dimension it has to
// fit inside.

import type { HangHole, HangTab, Panel, Poly, Pt, Slit } from '../types';
import { EPS, arcPoints, at, bboxOf, rect, roundCorners, signedArea, stadium } from './poly';
import { DEFAULT_SLOT_FIT, type SlotFit } from './fit';

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
  /** Slot sizing, passed straight through to the rolled ends. */
  fit?: SlotFit;
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
      // Trapped between the outer wall and the inner ply.
      thin: true,
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
      fit: o.fit,
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
      fit: o.fit,
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

/** The retail peg slot, as ONE closed ring: a WIDE, low slot with a round crown rising
 *  from the middle of its top edge. The trade calls the shape a sombrero, and that is
 *  the most useful way to remember which way up it goes — a brim with a dome on it.
 *
 *  It is wide and short, and that is the whole correction. This used to draw a tall
 *  keyhole: a big round head with a narrow tail hanging BELOW it. Same topology, wrong
 *  proportions by a factor of two in both axes, and nothing catches it — a keyhole
 *  cuts, exports and hangs on a peg perfectly well. It simply is not the hole retail
 *  packaging has, so a pack cut with it does not look like a pack.
 *
 *  Which way round the crown goes is load-bearing: the peg sits in the CROWN, and the
 *  board between the crown and the panel's top edge is what carries the pack. Put the
 *  crown at the bottom and the pack hangs on the two thin bridges beside the brim.
 *
 *  Proportions are one family scaled off the overall width, so a narrow panel gets a
 *  smaller hole rather than a clipped one. They are read off a photographed pack, NOT
 *  from a standard document — the numbers commonly quoted for a "euro hole" vary by
 *  supplier and I could not verify one, so this is drawn to look right rather than
 *  claimed to be dimensionally conformant.
 *
 *  One ring, traced round the union's real outline: along the brim, round the end cap,
 *  back along the top to the crown, over it, and on. Two overlapping rings would send
 *  the blade round a figure of eight and cut the overlap twice, which the exporter's
 *  own rules forbid, and is not a shape at all under an even-odd fill. */
export const EURO_SLOT_W = 22;
const EURO_BRIM = 5 / EURO_SLOT_W;
const EURO_CROWN = 3.5 / EURO_SLOT_W;

/** Nominal width of each hole shape, and the width below which it stops being worth
 *  cutting — the point where the part a peg has to pass through is smaller than the
 *  peg. No hole beats a hole nothing fits in.
 *
 *  The two are the two a shop actually has. The euro slot is the one on most European
 *  retail packaging; a plain round hole is what a J-hook and a bare peg want, it is
 *  what the pack gets when the panel is too narrow for a slot, and it is the older and
 *  simpler of the two — a hole rather than a shape. */
export const HANG_HOLE_W: Record<HangHole, number> = { euro: EURO_SLOT_W, round: 10 };
export const HANG_HOLE_MIN_W: Record<HangHole, number> = { euro: 16, round: 6 };

/** The widest hole of this shape that fits across `availMm` of panel with the 4 mm
 *  keep-out on both sides, or null when that is too little. */
export function hangHoleWidth(shape: HangHole, availMm: number): number | null {
  const w = Math.min(HANG_HOLE_W[shape], availMm - 2 * HANG_EDGE_MM);
  return w >= HANG_HOLE_MIN_W[shape] ? w : null;
}

/** How tall a hole this wide comes out — which is what the header has to be tall
 *  enough to hold, on top of the keep-out at each end. */
export function hangHoleHeight(shape: HangHole, w: number): number {
  return shape === 'round' ? w : w * (EURO_BRIM + EURO_CROWN);
}

/** Either shape, drawn with its TOP edge at `topY` so both keep the same contract with
 *  the keep-out: whatever sits above `topY` is the board that carries the pack. */
export function hangHoleRing(shape: HangHole, cx: number, topY: number, w: number): Poly {
  return shape === 'round' ? roundHole(cx, topY, w) : euroSlot(cx, topY, w);
}

/** A plain circular peg hole, its top edge at `topY`. */
export function roundHole(cx: number, topY: number, d: number, segments = 20): Poly {
  const r = d / 2;
  return arcPoints(cx, topY - r, r, 0, Math.PI * 2, segments).slice(0, -1);
}

export function euroSlot(cx: number, topY: number, w: number, segments = 12): Poly {
  const bh = w * EURO_BRIM;
  const r = bh / 2;
  // Centre of each end cap. The crown has to clear them or the ring self-intersects,
  // which on a narrow panel it otherwise would.
  const hx = w / 2 - r;
  const R = Math.min(w * EURO_CROWN, hx * 0.8);
  const yTop = topY - R;
  const yBot = yTop - bh;
  const cy = yTop - r;
  return [
    [cx - hx, yBot],
    [cx + hx, yBot],
    ...arcPoints(cx + hx, cy, r, -Math.PI / 2, Math.PI / 2, segments).slice(1, -1),
    [cx + hx, yTop],
    [cx + R, yTop],
    ...arcPoints(cx, yTop, R, 0, Math.PI, segments).slice(1, -1),
    [cx - R, yTop],
    [cx - hx, yTop],
    ...arcPoints(cx - hx, cy, r, Math.PI / 2, (Math.PI * 3) / 2, segments).slice(1, -1),
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
  /** Animation stage of the roll and the inner ply. */
  order: number;
  /** Stage of the OUTER WALL alone, when it may not wait for the roll. A webbed
   *  corner ties this wall to the long walls — the web is cut from both, so neither
   *  can rise without the other — so there the wall goes up on the long walls' stage
   *  and only the roll over the top follows later. Defaults to `order`. */
  wallOrder?: number;
  /** Signed fold, so a lid's roll can go down while a tray's goes up. */
  fold?: number;
  /** Nib locks — the tabs that drop through slots in the floor. ECMA's locking flaps
   *  system 01 has them; system 04 (webbed corners) does not, because there the folded
   *  web is what holds the end shut and a tab would be a second lock doing the first
   *  one's job. Default true, which is the mailer. */
  tabs?: boolean;
  /** How big the slot has to be for the ply going through it, and how close it may
   *  come to the crease. See geometry/fit.ts. */
  fit?: SlotFit;
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
  const fit = o.fit ?? DEFAULT_SLOT_FIT;

  const rollStart = H;
  const innerStart = rollStart + step;
  const innerD = Math.max(4, H - t);

  // ── the nib lock ──
  //
  // ONE ply goes through this slot: the inner wall's tab, thickness t. (The corner
  // ear is trapped between the outer wall and the inner ply — it never enters the
  // slot.) So the slot is that ply plus a clearance, and nothing else. See fit.ts for
  // why it used to be 1.8 mm and why that was four and a half times too wide.
  const slotW = fit.widthMm;

  // WHERE the slot goes, which was as wrong as how wide it was. The folded inner ply
  // stands at exactly `step` (= 2t) out from the crease, so the slot centres THERE.
  // The old floor pinned the centre at a constant 1.5 mm while the ply sat at 0.8, and
  // below t = 0.24 mm the tab's outboard face fell outside the slot entirely — on a
  // one-layer printed sheet the tab could not enter at all.
  //
  // The one thing that outranks centring is the crease: a cut may not come closer to a
  // fold than `keepOutMm`, or on card it undercuts the crease and on a printed sheet
  // it eats the hinge groove. So centre on the ply, then push outboard if the crease
  // needs the room — a slot a tenth off-centre still grips; a cut fold does not.
  const slotX0 = Math.max(fit.keepOutMm, step - slotW / 2);

  // How far the tab stands proud of the floor's far face, which is what stops the roll
  // springing back out. The inner ply stops one caliper above the floor, so the tab
  // gives up `step` before it engages anything — hence the + step. This used to be a
  // flat 2.5 mm that never scaled, and was NON-MONOTONIC: at t = 0.83 a thicker board
  // got LESS grip than a thinner one.
  const tabLen = clamp(2.5 * t, 1.2, 4) + step;

  // Along the slot, clearance is pure assembly cost — the lock works across the slot's
  // width, not its length — but every zero-kerf machine rounds an inside corner by
  // roughly its blade offset, so it cannot go to nothing either.
  const clear = Math.max(0.35, t);
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
    outline: span(X(0), X(rollStart), y0, y1),
    // Wide along the run of the wall, shallow across its height — the roll's x axis
    // is the box's HEIGHT and its y axis is the box's width, so the stadium's two
    // axes go in the opposite order to the way it reads. Swapped, a 40 mm hole ran
    // up a 50 mm wall and the wall's hole and the inner ply's hole overlapped.
    holes: hand ? [stadium(X(rollStart - hand.inset), mid, hand.h, hand.w)] : [],
    parent: o.parent,
    foldAngle: fold,
    order: o.wallOrder ?? o.order,
  };

  const roll: Panel = {
    id: `${p}roll`,
    label: 'roll',
    role: 'body',
    outline: span(X(rollStart), X(innerStart), y0 + g, y1 - g),
    holes: [],
    parent: wall.id,
    foldAngle: fold,
    order: o.order + 1,
  };
  const innerY0 = y0 + g;
  const innerY1 = y1 - g;

  // Far edge of the inner ply, with a tab standing proud of it at each centre.
  const withTabs = o.tabs ?? true;
  const A = X(innerStart);
  const B = X(innerStart + innerD);
  const T = X(innerStart + innerD + tabLen);
  const far: Poly = [[B, innerY0]];
  if (withTabs) {
    for (const c of centres) {
      far.push([B, c - tabH / 2], [T, c - tabH / 2], [T, c + tabH / 2], [B, c + tabH / 2]);
    }
  }
  far.push([B, innerY1]);

  const inner: Panel = {
    id: `${p}inner`,
    label: 'inner wall',
    role: 'flap',
    outline: [[A, innerY0], ...far, [A, innerY1]],
    holes: hand ? [stadium(X(innerStart + hand.inset), mid, hand.h, hand.w)] : [],
    parent: roll.id,
    foldAngle: fold,
    order: o.order + 2,
  };

  // The slots live in the BASE, on the far side of the crease from everything above.
  // No tabs, no slots: a slot with nothing going through it is a hole in the floor.
  const slots = withTabs
    ? centres.map((c) =>
        span(
          x - dir * slotX0,
          x - dir * (slotX0 + slotW),
          c - tabH / 2 - clear,
          c + tabH / 2 + clear,
        ),
      )
    : [];

  return { panels: [wall, roll, inner], slots };
}

// ─────────────────────────────── webbed corner tray ───────────────────────────────

export interface WebbedTrayOpts {
  prefix: string;
  labelPrefix: string;
  /** Inside dimensions. */
  L: number;
  W: number;
  H: number;
  t: number;
  x: number;
  y: number;
  rootPose?: Panel['rootPose'];
  invert?: boolean;
  /** Slot sizing, passed straight through to the rolled ends. */
  fit?: SlotFit;
}

/** ECMA B20.04.00.00 — a tray with two double walls and WEBBED corners.
 *
 *  The distinction from B20.01 (which the mailer and `tray()` use) is the corner, and
 *  it is a real structural difference rather than a styling one:
 *
 *    01  nib locks   — the corner is a separate EAR with a relief gap beside it, and
 *                      the fold-over end is held by tabs dropping through the floor.
 *    04  webbed      — the corner is CONTINUOUS with both walls, split by a 45 degree
 *                      crease, and collapsing that crease is itself the lock. No tabs,
 *                      no slots, and no gap at the corner for anything to fall through.
 *
 *  "Webbed corner" is the trade's own name for that 45 degree diagonal (ECMA Group B
 *  locking flaps systems 04 and 11). Modelling it needs one idea our tree does not
 *  give away for free: a web is NOT a rigid panel. It is two triangles hinged on the
 *  diagonal, so it is authored as two, parented one to the other —
 *
 *      long wall ──vertical hinge──▶ T1 ──diagonal hinge──▶ T2
 *
 *  which is why the animation collapses it correctly instead of tearing it off the
 *  wall. T1 swings 90 degrees into the end wall's plane; T2 folds 180 back onto T1;
 *  the doubled web lands flat on the end wall's inner face and the fold-over end then
 *  comes down over it and traps it. Fold it flat and it is a closed corner — which is
 *  the whole reason this style holds liquid-tight-ish where a nib-lock tray does not. */
export function webbedTray(o: WebbedTrayOpts): {
  panels: Panel[];
  slits: Slit[];
  extent: [number, number];
} {
  const { prefix: p, labelPrefix: lp, L, W, H, t, x, y } = o;
  const g = relief(t);
  const sign = o.invert ? -1 : 1;
  const fold = sign * HALF;

  const BL = L + 5 * t;
  const BW = W + 2 * t;
  const wallH = H + t;

  const base: Panel = {
    id: `${p}base`,
    label: `${lp}base`,
    role: 'base',
    outline: rect(x, y, BL, BW),
    holes: [],
    parent: null,
    foldAngle: 0,
    rootPose: o.rootPose,
  };

  // The long walls run the FULL length of the base. That is the webbed corner's whole
  // premise: no relief inset, because the web has to be continuous with the wall it
  // grows out of. A nib-lock tray insets these by one relief and puts an ear in the gap.
  const wallS: Panel = {
    id: `${p}s`,
    label: `${lp}front`,
    role: 'body',
    outline: span(x, x + BL, y, y - wallH),
    holes: [],
    parent: base.id,
    foldAngle: fold,
    order: 1,
  };
  const wallN: Panel = {
    id: `${p}n`,
    label: `${lp}back`,
    role: 'body',
    outline: span(x, x + BL, y + BW, y + BW + wallH),
    holes: [],
    parent: base.id,
    foldAngle: fold,
    order: 1,
  };

  // How far the web reaches out from the base's end. It is H and not wallH, and the
  // difference of one caliper is not cosmetic: this edge has to COINCIDE with the
  // fold-over end's own base crease, or the two share only part of an edge and the
  // leftover runs out as a cut — a slit at the corner of every finished tray.
  // The diagonal is therefore a hair off 45 degrees — atan((H + t) / H), which on
  // 0.38 mm card at H = 25 measures 45.4, so under half a degree of lean.
  const webD = H;
  const slits: Slit[] = [];

  /** One corner. `hx` is the wall end the web hangs off, `dirX` which way it reaches,
   *  `yBase` the base edge it shares and `yRim` the wall's rim. */
  const web = (
    id: string,
    parent: string,
    hx: number,
    dirX: 1 | -1,
    yBase: number,
    yRim: number,
  ): Panel[] => {
    const corner: Pt = [hx, yBase];
    const far: Pt = [hx + dirX * webD, yRim];
    const alongWall: Pt = [hx, yRim];
    const alongBase: Pt = [hx + dirX * webD, yBase];

    // T1 keeps the edge shared with the long wall; T2 keeps the edge shared with the
    // fold-over end. They meet on corner->far, which is the 45 degree crease.
    const t1: Panel = {
      id: `${id}a`,
      label: `${lp}webbed corner`,
      role: 'flap',
      outline: [corner, alongWall, far],
      holes: [],
      parent,
      foldAngle: fold,
      // The web is cut from the long wall AND the end wall, so it cannot be folded on
      // a clock of its own — the rig drives it from the wall's live angle. `order` here
      // only stages the press flat, which happens once both walls are already up.
      web: 'a',
      order: 2,
    };
    const t2: Panel = {
      id: `${id}b`,
      label: `${lp}webbed corner`,
      role: 'flap',
      outline: [corner, far, alongBase],
      holes: [],
      parent: t1.id,
      // Right over onto its own other half. Stopping a hair short of flat keeps the
      // two plies from z-fighting down the whole diagonal.
      foldAngle: sign * Math.PI,
      undershoot: sign * 0.06,
      web: 'b',
      order: 2,
    };
    // The diagonal is a genuine crease the user has to press in, and it is the one
    // line on this blank that does not fall out of a panel boundary — both triangles
    // are real panels, so `buildNet` finds the twin and creases it on its own. Marking
    // it again here would double the line in the export.
    return [t1, t2];
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
      // The end wall is tied to the long walls by the webs and rises with them
      // (stage 1); the roll over the top and the inner ply follow at 3 and 4, after
      // the webs have been pressed flat at stage 2 for the roll to trap.
      wallOrder: 1,
      order: 2,
      fold,
      tabs: false,
      fit: o.fit,
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
      // The end wall is tied to the long walls by the webs and rises with them
      // (stage 1); the roll over the top and the inner ply follow at 3 and 4, after
      // the webs have been pressed flat at stage 2 for the roll to trap.
      wallOrder: 1,
      order: 2,
      fold,
      tabs: false,
      fit: o.fit,
    }),
  ];

  const panels: Panel[] = [
    base,
    wallS,
    wallN,
    ...rolls.flatMap((r) => r.panels),
    ...web(`${p}sw`, wallS.id, x, -1, y, y - wallH),
    ...web(`${p}se`, wallS.id, x + BL, 1, y, y - wallH),
    ...web(`${p}nw`, wallN.id, x, -1, y + BW, y + BW + wallH),
    ...web(`${p}ne`, wallN.id, x + BL, 1, y + BW, y + BW + wallH),
  ];

  const b = bboxOf(panels.map((q) => q.outline));
  return { panels, slits, extent: [b[2] - b[0], b[3] - b[1]] };
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
  /** A locking tongue standing proud of the blade's top edge. */
  tongue?: { w: number; h: number; draft: number };
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
  const k = Math.min(BLADE_TAPER, holeH > 0 ? (holeW * 0.28) / (2 * holeH) : 0);

  const Y = (v: number): number => yc + dir * v;
  // Traced right to left along the top edge, so it splices in already wound correctly.
  const tg = o.tongue;
  const top: Poly = tg
    ? [
        [cx + tg.w / 2, Y(h)],
        [cx + tg.w / 2 - tg.draft, Y(h + tg.h)],
        [cx - tg.w / 2 + tg.draft, Y(h + tg.h)],
        [cx - tg.w / 2, Y(h)],
      ]
    : [];
  const ring: Poly = [
    [L0, Y(0)],
    [L1, Y(0)],
    [L1 + k * holeH, Y(holeH)],
    [R1 - k * holeH, Y(holeH)],
    [R1, Y(0)],
    [R0, Y(0)],
    [R0 - k * h, Y(h)],
    ...top,
    [L0 + k * h, Y(h)],
  ];
  const rOuter = Math.min(10, strapW, h / 3);
  const rInner = Math.min(8, strapW, holeH / 2);
  const rTip = tg ? Math.min(1.5, tg.draft) : 0;

  return {
    id: o.id,
    label: o.label,
    role: 'flap',
    outline: roundCorners(
      ring,
      tg
        ? [0, 0, rInner, rInner, 0, 0, rOuter, 0, rTip, rTip, 0, rOuter]
        : [0, 0, rInner, rInner, 0, 0, rOuter, rOuter],
    ),
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

/** How far the blade's outer profile leans in per mm of height. */
export const BLADE_TAPER = 0.104;

/** How thick a blade of this width makes its strap. Exported because the locking
 *  wing's slot has to stop clear of the shoulders, and because both numbers have to
 *  come from the same place or the slot swallows the shoulder it is meant to catch.
 *
 *  Nominally 9 % of the width — but never more than a quarter of it, or there is no
 *  hole left, and the 6 mm floor gives way rather than eat a small blade whole. */
export function bladeShoulder(width: number): number {
  return clamp(width * 0.09, Math.min(6, width * 0.2), width * 0.25);
}

// ──────────────────────────── complete flap cover (60) ────────────────────────────

export interface FlapCoverOpts {
  prefix: string;
  /** The wall rim this lid hinges off. */
  parent: string;
  /** Left x and width of that rim, and the y it sits at. */
  x: number;
  y: number;
  w: number;
  /** How far the lid reaches across the box, and how deep its skirts hang. */
  deep: number;
  skirt: number;
  t: number;
  order: number;
}

/** ECMA cover system 60 — a complete flap cover with CLOSED corners.
 *
 *  A lid that covers the whole top and hangs a skirt down all three free sides. What
 *  makes it code 60 rather than 52 or 53 is the corner: where the front skirt meets a
 *  side skirt there is a web rather than a gap, so the finished lid has no open corner
 *  to let dust in or to catch on the tray as it closes.
 *
 *  Same two-triangle construction as `webbedTray`, for the same reason — a closed
 *  corner is a mechanism, not a rigid panel — but hinged the other way round: here the
 *  web hangs off the FRONT skirt and folds back onto the side skirt, because the front
 *  skirt is the one that has to end up outside. */
export function flapCover(o: FlapCoverOpts): { panels: Panel[] } {
  const { prefix: p, x, y, w, deep, skirt, t } = o;
  const g = relief(t);

  const deck: Panel = {
    id: `${p}deck`,
    label: 'lid',
    role: 'lid',
    outline: rect(x, y, w, deep),
    holes: [],
    parent: o.parent,
    foldAngle: HALF,
    order: o.order,
  };

  // The front skirt hangs off the deck's far edge and drops down the front wall.
  const front: Panel = {
    id: `${p}front`,
    label: 'lid front skirt',
    role: 'flap',
    outline: rect(x, y + deep, w, skirt),
    holes: [],
    parent: deck.id,
    foldAngle: HALF,
    order: o.order + 1,
  };

  // Side skirts, inset by one relief at the hinge end so they clear the wall the lid
  // is hinged to as it comes over.
  const side = (id: string, sx: number, dirX: 1 | -1): Panel => ({
    id,
    label: 'lid side skirt',
    role: 'flap',
    outline: span(sx, sx + dirX * skirt, y + g, y + deep),
    holes: [],
    parent: deck.id,
    foldAngle: HALF,
    order: o.order + 1,
  });

  // The closed corner. Each web is the square between the front skirt and a side
  // skirt, split on its diagonal: T1 stays with the front skirt, T2 folds 180 back
  // onto it, and the doubled web tucks behind the side skirt.
  const web = (id: string, cx: number, dirX: 1 | -1): Panel[] => {
    const corner: Pt = [cx, y + deep];
    const alongFront: Pt = [cx, y + deep + skirt];
    const far: Pt = [cx + dirX * skirt, y + deep + skirt];
    const alongSide: Pt = [cx + dirX * skirt, y + deep];
    return [
      {
        id: `${id}a`,
        label: 'lid closed corner',
        role: 'flap',
        outline: [corner, alongFront, far],
        holes: [],
        parent: front.id,
        foldAngle: HALF,
        // Cut from the front skirt and the side skirt both — see `web` in types.ts.
        web: 'a',
        order: o.order + 2,
      },
      {
        id: `${id}b`,
        label: 'lid closed corner',
        role: 'flap',
        outline: [corner, far, alongSide],
        holes: [],
        parent: `${id}a`,
        foldAngle: Math.PI,
        undershoot: 0.06,
        web: 'b',
        order: o.order + 2,
      },
    ];
  };

  return {
    panels: [
      deck,
      front,
      side(`${p}sl`, x, -1),
      side(`${p}sr`, x + w, 1),
      ...web(`${p}cl`, x, -1),
      ...web(`${p}cr`, x + w, 1),
    ],
  };
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
    // A dust flap is folded in first and the lid closes on top of it, so it spends
    // its life sandwiched.
    thin: true,
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

// ─────────────────────── self-locking envelope bottom (55) ───────────────────────

export interface EnvelopeBottomOpts {
  /** Panel id prefix. */
  prefix: string;
  /** The four walls in wrap order, and their spans, straight off `tube`. */
  walls: [Panel, Panel, Panel, Panel];
  spans: [Span, Span, Span, Span];
  /** Inside dimensions of the tube, and the measured caliper. */
  L: number;
  W: number;
  t: number;
  /** The crease the flaps hang off — the tube's own baseline. */
  y: number;
}

/** The snap-lock base, after Federal Specification PPP-B-566E fig. 10 (Style X,
 *  "snap lock bottom with tuck top"). Four flaps, and — this is the part that makes
 *  it a lock rather than a pile — all four are DIFFERENT:
 *
 *    back  : the main bottom panel, spanning the full depth, with a slot in it
 *    front : the closing panel, spanning the full depth, with a tongue on its edge
 *    sides : shallow angled flaps that fold in first and get trapped underneath
 *
 *  That is the 1-2-3 sequence the style is named for: big panel down, two sides in,
 *  last panel down and its tongue through the slot. An earlier version of this used
 *  four identical chamfered flaps in a pinwheel — a real closure, but a different and
 *  much more common one, and it needs a near-square footprint whereas this does not.
 *
 *  Lives here rather than in `buildSnapLock` because it is the bottom of TWO styles:
 *  ECMA numbers the closure independently of what happens at the other end, which is
 *  the whole point of a four-pair code, and A55.20 and A55.75 share this exact 55. */
export function envelopeBottom(o: EnvelopeBottomOpts): { panels: Panel[]; slits: Slit[] } {
  const { prefix: p, walls, spans: s, L, W, t, y } = o;
  const [front, , , ] = walls;
  const back = walls[2];
  const g = relief(t);
  const deep = Math.max(6, W - t);
  const shallow = Math.max(5, Math.min(W * 0.55, L / 2 - g));
  const panels: Panel[] = [];
  const slits: Slit[] = [];

  // Sides first: plain flaps with the outer corners taken off at 45 degrees so the
  // closing panel slides over them instead of catching.
  for (const i of [1, 3] as const) {
    const span = s[i];
    const ch = Math.min(shallow * 0.5, span.w * 0.3);
    panels.push({
      id: `${p}b${i}`,
      label: 'base side flap',
      role: 'flap',
      outline: [
        [span.x + g, y - shallow + ch],
        [span.x + g + ch, y - shallow],
        [span.x + span.w - g - ch, y - shallow],
        [span.x + span.w - g, y - shallow + ch],
        [span.x + span.w - g, y],
        [span.x + g, y],
      ],
      holes: [],
      parent: (walls[i] as Panel).id,
      foldAngle: HALF,
      overshoot: 0.25,
      order: 3,
    });
  }

  // The slotted panel and the tongued panel. The tongue is a shallow trapezoid so it
  // feeds into the slot; the slot is cut a caliper wider than the tongue is thick.
  const tongueW = Math.min(s[0].w * 0.35, 26);
  const tongueD = Math.max(3, Math.min(6, deep * 0.2));
  const slotW = tongueW + 2 * g;

  panels.push({
    id: `${p}bback`,
    label: 'base panel (slotted)',
    role: 'flap',
    outline: [
      [s[2].x + g, y - deep],
      [s[2].x + s[2].w - g, y - deep],
      [s[2].x + s[2].w - g, y],
      [s[2].x + g, y],
    ],
    holes: [],
    parent: back.id,
    foldAngle: HALF,
    order: 2,
  });
  // The slot itself is an interior cut, not part of the outline — it has no area to
  // remove, it is a slit the tongue passes through.
  slits.push({
    panelId: `${p}bback`,
    op: 'cut',
    points: [
      [s[2].x + s[2].w / 2 - slotW / 2, y - deep + tongueD + g],
      [s[2].x + s[2].w / 2 + slotW / 2, y - deep + tongueD + g],
    ],
  });

  // The tongue is part of this panel's REACH, not extra on top of it: panel + tongue
  // together span the same depth as the slotted panel opposite. Sized the other way,
  // the tongue hangs a finger's width out past the side of the finished box.
  const tongueBody = Math.max(4, deep - tongueD);
  const fx = s[0].x + s[0].w / 2;
  panels.push({
    id: `${p}bfront`,
    label: 'base panel (tongue)',
    role: 'flap',
    outline: [
      [s[0].x + g, y - tongueBody],
      [fx - tongueW / 2, y - tongueBody],
      [fx - tongueW / 2 + tongueD * 0.4, y - tongueBody - tongueD],
      [fx + tongueW / 2 - tongueD * 0.4, y - tongueBody - tongueD],
      [fx + tongueW / 2, y - tongueBody],
      [s[0].x + s[0].w - g, y - tongueBody],
      [s[0].x + s[0].w - g, y],
      [s[0].x + g, y],
    ],
    holes: [],
    parent: front.id,
    foldAngle: HALF,
    // Last down, and stopping a hair short so it visibly rests on the panel below.
    undershoot: 0.04,
    order: 4,
  });

  return { panels, slits };
}

// ─────────────────────── hang tab: extended panel + euroslot ───────────────────────

export interface HangHeaderOpts {
  prefix: string;
  /** The wall the header extends. Its outline comes back replaced, not added to. */
  wall: Panel;
  /** Wall span and the height of the wall itself. */
  x: number;
  w: number;
  h: number;
  /** Where the wall's top edge is — the header starts here. */
  y: number;
  t: number;
  kind: HangTab;
  shape: HangHole;
  /** Header height above the box. 0 derives one. */
  heightMm: number;
  fit: SlotFit;
}

/** A hang hole is a HOOK MOUNT, and the one number that matters is the same for both
 *  shapes: it never comes closer than 4 mm to any edge, or the card tears off the peg
 *  the first time the pack is lifted. Everything else here is derived and clamped. */
export const HANG_EDGE_MM = 4;

/** The same hole turned ninety degrees: its top edge facing OUT along net x, the rest
 *  running back toward the box.
 *
 *  A mailer's tab does not stand above a wall, it reaches past a short END, so its long
 *  axis is the net's x and its width is the net's y — the two axes swapped from
 *  everything `hangHeader` draws. Rotating the ring is the whole of it, but it has to
 *  BE a rotation rather than a re-derivation: draw the euro slot a second time in the
 *  other axis order and the crown/brim asymmetry that makes it a euro slot is one
 *  transcription away from coming out upside down, which hangs the pack on the thin
 *  bridges beside the brim instead of the 4 mm of board over the crown.
 *
 *  `tipX` is the tab's outer edge and `outward` the direction it grew in, so the top
 *  lands `dropMm` inside the tip whichever end of the box this is. */
export function hangHoleAcross(o: {
  shape: HangHole;
  tipX: number;
  outward: 1 | -1;
  cy: number;
  widthMm: number;
  dropMm: number;
}): Poly {
  const local = hangHoleRing(o.shape, 0, 0, o.widthMm);
  // (u across, v along) -> (x out from the tip, y across the tab). The map's
  // determinant is -outward, so half the time it flips the winding; `buildNet` forces
  // holes clockwise anyway, but a ring that arrives already correct is one less thing
  // reading the dieline has to take on trust.
  const ring = local.map(([u, v]): Pt => [o.tipX + o.outward * (v - o.dropMm), o.cy + u]);
  return o.outward > 0 ? ring.reverse() : ring;
}

/** The shortest header that holds this hole with its keep-out at both ends, or the
 *  height asked for if that is taller. A header is board you pay for and throw away,
 *  so the default is the smallest one that works rather than a round number. */
export function hangHeaderHeight(want: number, availW: number, shape: HangHole): number {
  const hw = hangHoleWidth(shape, availW);
  const floor = (hw === null ? 12 : hangHoleHeight(shape, hw)) + 2 * HANG_EDGE_MM;
  return clamp(want > 0 ? want : floor + 4, floor, 90);
}

/** An extended panel above a wall, with a euro hang slot through it.
 *
 *  **ECMA X61** (extended panel single walled with euroslot opening) and **X62** (the
 *  same double walled), from the group X "devices for hanging/carrying" block, p.88.
 *  `hole` is neither — it is the slot punched straight through the wall, which is what
 *  a sleeve wants, because a sleeve has no closure to move out of the header's way.
 *
 *  X62 folds the header back on itself so the slot passes through TWO plies, and that
 *  is the entire reason it exists: one ply of 300 gsm tears off a peg under any weight
 *  worth hanging. The two slots have to REGISTER, and here they do so by construction
 *  rather than by arithmetic — the inner slot is the outer one MIRRORED about the fold,
 *  so there is no second derivation to get wrong when the header height changes.
 *
 *  The header comes back as a replacement outline for the wall rather than as a panel
 *  of its own, because a single-ply header is not hinged to anything: it is the wall
 *  carrying on upward. Hanging it as a panel would draw a crease straight across the
 *  middle of it — the same mistake the note on `tray`'s carry handle warns about. */
export function hangHeader(o: HangHeaderOpts): {
  wallOutline: Poly;
  wallHoles: Poly[];
  panels: Panel[];
} {
  const { prefix: p, x, w, y, t, fit } = o;
  const wall = o.wall;
  const keep = { wallOutline: wall.outline, wallHoles: wall.holes, panels: [] as Panel[] };
  if (o.kind === 'none') return keep;

  if (o.kind === 'hole') {
    // No extension: the slot goes through the wall itself, sized to the wall rather
    // than pinned at a fixed offset. A constant offset puts the head a hair under the
    // top edge on a tall box and pushes the tail clean off the bottom of a short one,
    // leaving a closed cut ring floating outside the blank that no connectivity check
    // looks for.
    const hw = hangHoleWidth(o.shape, w);
    if (hw === null || hangHoleHeight(o.shape, hw) > o.h - 2 * HANG_EDGE_MM) return keep;
    return {
      wallOutline: wall.outline,
      wallHoles: [...wall.holes, hangHoleRing(o.shape, x + w / 2, y - HANG_EDGE_MM, hw)],
      panels: [],
    };
  }

  const hh = hangHeaderHeight(o.heightMm, w, o.shape);
  const holeW = hangHoleWidth(o.shape, w);
  if (holeW === null) return keep;
  const slotH = hangHoleHeight(o.shape, holeW);
  /** How far the hole's top edge sits below the header's own. */
  const drop = Math.max(HANG_EDGE_MM, (hh - slotH) / 2);
  const top = y + hh;
  // Corners taken off so the header does not catch on a rack. On the double-ply
  // header the chamfer also sets where the fold-over starts, so the inner ply and the
  // outline agree on one edge instead of two that nearly match.
  const ch = Math.max(relief(t), Math.min(4, w * 0.08, hh * 0.3));

  const outline: Poly = [
    ...wall.outline.filter((q) => q[1] < y - EPS),
    [x + w, top - ch],
    [x + w - ch, top],
    [x + ch, top],
    [x, top - ch],
  ];
  const slot = hangHoleRing(o.shape, x + w / 2, top - drop, holeW);

  if (o.kind === 'single') {
    return { wallOutline: outline, wallHoles: [...wall.holes, slot], panels: [] };
  }

  // Double ply. Card does not fold flat on itself, so this is not one 180° crease: it
  // is the outer ply, a roll of 2t, and the inner ply — three panels and two right
  // angles, exactly how `rollEnd` doubles a tray's rim. Model it as a single 180° fold
  // and the printed sheet gets a hinge no material can make.
  const roll = layerStep(t);
  const hx = x + ch;
  const hw = Math.max(4, w - 2 * ch);
  const inner = Math.max(4, hh - t);
  const tab = Math.max(4, Math.min(10, hh * 0.25));
  // Mirror the outer slot about the fold's centreline. Winding flips with the mirror,
  // so the ring is reversed to stay a hole.
  const axis = 2 * top + roll;
  const innerSlot: Poly = slot.map((q): Pt => [q[0], axis - q[1]]).reverse();

  const panels: Panel[] = [
    {
      id: `${p}roll`,
      label: 'header fold',
      role: 'flap',
      outline: rect(hx, top, hw, roll),
      holes: [],
      parent: wall.id,
      foldAngle: HALF,
      order: 2,
    },
    {
      id: `${p}inner`,
      label: 'header inner ply',
      role: 'flap',
      outline: rect(hx, top + roll, hw, inner),
      holes: [innerSlot],
      parent: `${p}roll`,
      foldAngle: HALF,
      order: 3,
    },
    {
      id: `${p}tab`,
      label: 'header tuck',
      role: 'tuck',
      // Narrowed by a slot fit each side so it drops inside the box rather than
      // binding on the two walls it has to pass between.
      outline: rect(
        hx + fit.widthMm,
        top + roll + inner,
        Math.max(4, hw - 2 * fit.widthMm),
        tab,
      ),
      holes: [],
      parent: `${p}inner`,
      foldAngle: HALF,
      thin: true,
      undershoot: 0.05,
      order: 4,
    },
  ];
  return { wallOutline: outline, wallHoles: [...wall.holes, slot], panels };
}
