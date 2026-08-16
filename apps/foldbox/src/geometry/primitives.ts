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
import { arcPoints, at, rect, signedArea } from './poly';

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
}

/** A four-corner tray: a base, four walls, and an ear at each end of the two long
 *  walls that folds in behind the short wall.
 *
 *  This is the shape in the reference photos, and it is the only tray worth building
 *  first — it needs no glue if the ears are tucked, and it folds as a clean tree.
 *
 *          ┌────────────┐
 *          │   wall N   │
 *     ┌────┼────────────┼────┐
 *     │ear │            │ear │
 *     │ W  │    BASE    │  E │
 *     │ear │            │ear │
 *     └────┼────────────┼────┘
 *          │   wall S   │
 *          └────────────┘
 */
export function tray(o: TrayOpts): { panels: Panel[]; slits: Slit[] } {
  const { prefix: p, labelPrefix: lp, L, W, H, t, x, y } = o;
  const g = relief(t);
  const sign = o.invert ? -1 : 1;
  const fold = sign * HALF;

  const base: Panel = {
    id: `${p}base`,
    label: `${lp}base`,
    role: 'base',
    outline: rect(x, y, L, W),
    holes: o.baseHole ? [o.baseHole] : [],
    parent: null,
    foldAngle: 0,
    rootPose: o.rootPose,
  };

  // The two long walls fold first; the short walls come up over the ears last, which
  // is why they carry an explicit later `order` rather than relying on tree depth.
  const wallS: Panel = {
    id: `${p}s`,
    label: `${lp}front`,
    role: 'body',
    outline: rect(x, y - H, L, H),
    holes: [],
    parent: base.id,
    foldAngle: fold,
    order: 1,
  };
  const wallN: Panel = {
    id: `${p}n`,
    label: `${lp}back`,
    role: 'body',
    outline: rect(x, y + W, L, H),
    holes: [],
    parent: base.id,
    foldAngle: fold,
    order: 1,
  };
  const wallE: Panel = {
    id: `${p}e`,
    label: `${lp}right side`,
    role: 'body',
    outline: rect(x + L, y, H, W),
    holes: [],
    parent: base.id,
    foldAngle: fold,
    order: 3,
  };
  const wallW: Panel = {
    id: `${p}w`,
    label: `${lp}left side`,
    role: 'body',
    outline: rect(x - H, y, H, W),
    holes: [],
    parent: base.id,
    foldAngle: fold,
    order: 3,
  };

  // Ears. Each is a caliper shorter than its wall so it cannot peek over the rim, and
  // its free edge runs back at 45 degrees.
  //
  // The taper is not decoration. Federal Specification PPP-B-566E draws every
  // Brightwood tray corner this way (fig. 3, Style III): a square ear jams against
  // the wall folding over it and bows the corner out, and it also leaves a visible
  // tongue poking above the rim on any tray whose walls are not exactly equal.
  const ear = (
    id: string,
    label: string,
    parent: string,
    hx: number,
    hy: number,
    dirX: 1 | -1,
    dirY: 1 | -1,
  ): Panel => {
    const w = H - g;
    const taper = Math.min(w * 0.45, H * 0.45);
    const x0 = hx;
    const y1 = hy + dirY * (H - g);
    const poly: Poly = [
      [x0, hy],
      [x0 + dirX * w, hy + dirY * (g + taper)],
      [x0 + dirX * w, y1],
      [x0, y1],
    ];
    return {
      id,
      label,
      role: 'flap',
      outline: dirX * dirY > 0 ? poly : [...poly].reverse(),
      holes: [],
      parent,
      foldAngle: fold,
      order: 2,
    };
  };

  const panels = [
    base,
    wallS,
    wallN,
    wallE,
    wallW,
    ear(`${p}sw`, `${lp}corner`, wallS.id, x, y, -1, -1),
    ear(`${p}se`, `${lp}corner`, wallS.id, x + L, y, 1, -1),
    ear(`${p}nw`, `${lp}corner`, wallN.id, x, y + W, -1, 1),
    ear(`${p}ne`, `${lp}corner`, wallN.id, x + L, y + W, 1, 1),
  ];

  return { panels, slits: [] };
}

/** Outer footprint a tray occupies in the net, so callers can place the next one. */
export function trayExtent(L: number, W: number, H: number): [number, number] {
  return [L + 2 * H, W + 2 * H];
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
