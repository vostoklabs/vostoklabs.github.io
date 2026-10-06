// A layered photo frame that stands on a desk — the construction both photo-frame templates are
// cut from. The templates bring the decoration and the lettering; everything that decides whether
// the print fits, whether the sheets glue up into one frame and whether it STANDS lives here.
//
// A picture frame is three layers — back, the frame in the middle, and front — cut for stock
// picture sizes, preset.
//
// ------------------------------------------------------------------------ the pieces --
//
//   FRONT   outline O, the window, the decorations cut through to the dark middle      light
//   MIDDLE  O less a U: the photo pocket runs straight up through the top edge, so the
//           print drops in from above and gravity seats it on the bottom rail           dark
//   BACK    O less a finger notch in the top edge, to push the print back out           dark
//   RIB ×2  a triangle that leans the stack back θ ≥ 20°, tabbed through the back        dark
//
// O = the rectangle ∪ every decoration grown by `rim`: a heart that hangs off the edge keeps a
// rim of front round its pocket, and every sheet carries the same bump, so they register.
//
// Frame coordinates: x across (0 on the centre line), y up, the rectangle's bottom edge on y = 0
// — the edge the frame stands on. Nothing is allowed below it. All three sheets are cut from the
// one outline in these coordinates, so they glue up by construction (`assembledAt: 'built'`).
//
// ------------------------------------------------------------------------ the photo --
//
// A preset may name two prints that make one frame (4 × 6 in and 10 × 15 cm are 2–4 mm apart):
// the WINDOW is cut from the smaller and the POCKET from the larger, so both fit.
//
//   window = small − 2·ov     ov = 6, the quarter-inch framing overlap · 3 on film, whose white
//                             border is the look people frame it for
//   pocket = large + 2·c      c = 1.5, framers' ⅛ in over the print · 1 on rigid die-cut film
//   rail   = b − ov           the pocket's floor. A small print seated on it hides ov at the
//                             bottom and ov at the top; a large one hides more at the top.
//   wall   = s + window/2 − pocket/2 ≥ 8 mm (11.7 at 4 × 6 with s = 20)
//
// Sideways a print can slide in its pocket: the worst overlap is ov − (large − small)/2 − c,
// 3.7 mm at 4 × 6 and 3.0 at 5 × 7 — still no gap at the window's edge.
//
// Rule the templates must hold: every cut through the FRONT lies over solid MIDDLE, so a pocket
// shows the dark layer 3 mm down and never the print's edge, the empty slot or a rib's tab.
// `keepOut` is where that fails (the photo slot and the rib slots, each grown by GAP), and
// `holeClear()` is the test a template places its decorations with.
//
// ------------------------------------------------------------------------ the stand --
//
// Side view: y runs back, z up, the table is z = 0. The stack leans back θ from vertical and
// rests on its REAR bottom edge R (tilting the top back lowers the rear corner; the front edge
// lifts 3t·sin θ = 3.1 mm). R is the origin. A rib stands in the same plane:
//
//   A = R      B = a·(sin θ, cos θ)      C = (D, 0)       interior angle at A = 90° − θ (70° at 20°)
//   a = 0.45·H up the back              D = max(45, 0.4·H) along the table
//
// The lean lives in the rib's OUTLINE (laser-construct A1): the rib meets the back at 90°, its
// edge AB bears on the back's face under the frame's weight (A3), and a tab through a plain slot
// only locates it. Two ribs, 0.6·W apart (A4).
//
// WHERE THE TAB GOES. The research put the ribs behind the side walls with a tab at 20 % and 65 %
// of a. The icon frame's corner pockets sit exactly there, and a front cut-through over a rib slot
// shows the tab's end grain. So each rib's tab goes into the BOTTOM RAIL, which is solid middle at
// every x and has nothing cut through the front above it (the name is engraved there):
//
//   x  = ±0.3·W                         inside the pocket's width at every preset
//   u  = rail/2  up AB (= frame y)      centred in the rail
//   L  = clamp(rail − 2·web, 10, 16)    web = max(4, 1.2t) of middle above and below the slot — under
//                                       the 1.5t a free slot wants, because this one is glued between
//                                       the front and the back and carries nothing sideways
//   d  = 2t − 0.3                       through the back, 2.7 into the middle, clear of the front
//
// drawn `tabWidth(L, kerf)` long, into `slotHoleRing(slotWidth(t), slotWidth(L))` slots with crush
// nodes in the BACK and the MIDDLE (slots.ts). Glue it as well: the tab is a locator.
//
// IT STANDS. The research modelled the frame's mass at 0.48·H up it and ignored the ribs; that
// puts the small LANDSCAPE frames (H ≈ 100) just under the 15° line, because the stack's own 9 mm
// depth takes a bigger bite out of a short lever. So the centre of mass is weighed properly, from
// the sheets as cut (area × centroid of each: the rectangle less the window, the U, the notch — the
// decorations are left out, they sit either side and mostly high, which only helps) and the two
// ribs (area and centroid of the triangle, in the side view already). Each sheet's (Y, Z) goes
// into the side view as y = Y·sin θ − Z·cos θ, z = Y·cos θ + Z·sin θ, and then
//
//   forward tip = atan(y_c / z_c)          back tip = atan((D − y_c) / z_c)
//
// Weighed again in the suites from the BUILT pieces (decorations and all): 19.5° forward and
// 28–30° back at 4 × 6 portrait, 16.5° forward at instant mini landscape, the shortest frame; the
// foot-stand's warn line is 15°. At 15° of lean the small frames fall under it, which is why θ is
// never a slider. It is DERIVED instead: 20°, or the least lean past it that keeps 15.5° of
// forward tip — every preset in 3 mm stays at 20°; a deep stack on a short frame (4–6 mm sheets
// on an instant-mini landscape) leans up to a few degrees more. (Tipped past it, the frame lands
// upright on its 9 mm foot — it has to go another 5° to fall on its face.)
//
// ---------------------------------------------------------------------------- the API --
//
//   const g = frameGeometry({ photo, orientation, border, band, t, kerf, clearance });
//   ...place decorations with holeClear(g, box), lay lettering inside g.window's borders...
//   const pieces = framePieces(g, { holes, rim, windowMinus, front, middle });
//   return { ...pieces, keyring: NO_KEYRING };
import { bboxOf, filletRing, roundedRectRing, type Box, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { pointInRing } from '@vostok/shapes';
import { FIT, slotHoleRing, slotWidth, tabWidth } from './slots';
import type { Blank, DesignLayer, PartInput, Pose } from './types';

type Pt = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const shift = (ring: CutRing, dx: number, dy: number): CutRing => ring.map(([x, y]) => [x + dx, y + dy]);

/** The lean from vertical, degrees: the research's easel angle, and the least any frame gets. */
export const LEAN = 20;
/** The forward tip every frame keeps (the foot-stand warns at 15°), and the most lean that may
 *  take to find (three 6 mm sheets on an instant-mini landscape take 24–24.5°). */
const TIP_MIN = 15.5;
const MAX_LEAN = 28;
/** How far a front cut-through stays off the photo slot and the rib slots, mm — so the floor it
 *  shows is all middle, even with the print pushed against the pocket's wall. */
export const GAP = 1.5;
/** The narrowest side wall the middle may have, mm. */
export const MIN_WALL = 8;
/** The house bed. Every piece has to fit on it; a bigger frame is said, not shrunk. */
export const BED = 300;

/** One stock print size. `small`/`large` are PORTRAIT (w ≤ h) unless the print only comes one way. */
export interface PhotoPreset {
  id: string;
  label: string;
  small: Pt;
  large: Pt;
  /** Instant film: film's overlap and clearance, so its white border shows whole. */
  film?: boolean;
  /** The frame keeps the print's own orientation — a square, or film that only comes one way. */
  fixed?: boolean;
}

/**
 * The presets, most common first. Every one fits a 300 mm bed with its
 * decorations in either orientation. 8 × 10 in is left out: 248 × 305 portrait once it is
 * decorated. "Instant", never the film maker's trademark.
 */
export const PHOTO_PRESETS: PhotoPreset[] = [
  { id: '4x6', label: '4 × 6 in · 10 × 15 cm', small: [100, 148], large: [101.6, 152.4] },
  { id: '5x7', label: '5 × 7 in · 13 × 18 cm', small: [127, 177.8], large: [130, 180] },
  { id: '3.5x5', label: '3.5 × 5 in · 9 × 13 cm', small: [88.9, 127], large: [90, 130] },
  { id: 'wallet', label: 'Wallet 2.5 × 3.5 in', small: [63.5, 88.9], large: [63.5, 88.9] },
  { id: 'sq4', label: 'Square 4 × 4 in', small: [101.6, 101.6], large: [101.6, 101.6], fixed: true },
  { id: 'sq5', label: 'Square 5 × 5 in', small: [127, 127], large: [127, 127], fixed: true },
  { id: 'a6', label: 'A6', small: [105, 148], large: [105, 148] },
  { id: 'a5', label: 'A5', small: [148, 210], large: [148, 210] },
  { id: 'mini', label: 'Instant mini', small: [54, 86], large: [54, 86], film: true },
  { id: 'isq', label: 'Instant square', small: [72, 86], large: [72, 86], film: true, fixed: true },
  { id: 'iwide', label: 'Instant wide', small: [108, 86], large: [108, 86], film: true, fixed: true },
];

export const presetOf = (id: string): PhotoPreset => PHOTO_PRESETS.find((p) => p.id === id) ?? PHOTO_PRESETS[0]!;

/** The print's size as it stands in this frame. */
function oriented(p: Pt, landscape: boolean, fixed: boolean): Pt {
  if (fixed) return p;
  const [a, b] = [Math.min(p[0], p[1]), Math.max(p[0], p[1])];
  return landscape ? [b, a] : [a, b];
}

/** A slot open at the top: `w` wide, its floor at `bottom` with corners of radius `r`, its walls
 *  running straight up past `top`. For a notch cut down from an edge, where a rounded rectangle
 *  would leave its two TOP corners as bumps in the mouth. CCW. */
export function uRing(w: number, bottom: number, top: number, r: number, seg = 8): CutRing {
  const hw = w / 2;
  const rr = clamp(r, 0, Math.min(hw, (top - bottom) / 2));
  const out: CutRing = [];
  if (rr <= 1e-6) return [[-hw, bottom], [hw, bottom], [hw, top], [-hw, top]];
  const arc = (cx: number, from: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = from + (i / seg) * (Math.PI / 2);
      out.push([cx + rr * Math.cos(a), bottom + rr + rr * Math.sin(a)]);
    }
  };
  arc(-hw + rr, Math.PI);
  arc(hw - rr, -Math.PI / 2);
  out.push([hw, top], [-hw, top]);
  return out;
}

// ------------------------------------------------------------------------ the geometry --

export interface FrameInput {
  /** A `PHOTO_PRESETS` id. */
  photo: string;
  /** 'portrait' | 'landscape'; ignored by a preset that only comes one way. */
  orientation: string;
  /** s: the side and top border, mm. */
  border: number;
  /** b: the bottom band, where the lettering goes, mm. */
  band: number;
  t: number;
  kerf: number;
  clearance?: number;
  /** The window's corner radius, mm. */
  windowCorner?: number;
}

/** One stand rib, in its own plane: A (on the table, against the frame) at the origin, x running
 *  back from the frame, y up. Both ribs are this piece. */
export interface FrameRib {
  body: CutRing;
  tab: CutRing;
  a: number;
  D: number;
  /** Where each rib stands, ±x in frame coordinates. */
  x: number;
  /** The tab's centre, measured up the back from the table — which is frame y. */
  u: number;
  /** The tab's nominal length along the back, and how far it reaches into the stack. */
  L: number;
  depth: number;
  /** The slot the tab goes through, as drawn. */
  slot: { across: number; along: number };
  box: Box;
}

/** Every number the construction is proved on — the tests re-derive them. */
export interface FrameMetrics {
  lean: number;
  overlap: number;
  clearance: number;
  wall: number;
  rail: number;
  /** Degrees the frame must be pushed forward, or back, before it falls. */
  forwardTip: number;
  backTip: number;
  /** The weighed centre of mass in the side view: y back from the rear bottom edge, z up. */
  mass: { y: number; z: number };
}

export interface FrameGeometry {
  preset: PhotoPreset;
  landscape: boolean;
  t: number;
  kerf: number;
  clearance: number;
  border: number;
  band: number;
  /** The rectangle, x ∈ ±W/2, y ∈ [0, H]. */
  W: number;
  H: number;
  rect: CutRing;
  window: Box;
  windowRing: CutRing;
  /** The two prints as they stand in this frame, and where each sits once seated on the rail. */
  small: Pt;
  large: Pt;
  photos: { small: Box; large: Box };
  /** The middle's U: x ∈ ±w/2, from `bottom` straight up through the top edge. */
  pocket: { w: number; bottom: number };
  /** The back's finger notch: x ∈ ±w/2, from `bottom` up through the top edge. */
  notch: { w: number; bottom: number };
  rib: FrameRib;
  /** The two rib slots, in the BACK and the MIDDLE alike. */
  slots: CutRing[];
  /** Where no cut through the front may go. */
  keepOut: Box[];
  metrics: FrameMetrics;
  warnings: string[];
}

/** Far enough above any frame to stand for "up through the top edge" in a keep-out box. */
const SKY = 1e4;

export function frameGeometry(i: FrameInput): FrameGeometry {
  const preset = presetOf(i.photo);
  const landscape = preset.fixed ? preset.small[0] > preset.small[1] : i.orientation === 'landscape';
  const t = clamp(i.t, 0.5, 12);
  const kerf = clamp(i.kerf, 0, 1);
  const clearance = i.clearance ?? FIT.snug!;
  const s = Math.max(5, i.border);
  const b = Math.max(10, i.band);
  const warnings: string[] = [];

  // ---------------------------------------------------------------------- the photo --
  const ov = preset.film ? 3 : 6;
  const c = preset.film ? 1 : 1.5;
  const small = oriented(preset.small, landscape, !!preset.fixed);
  const large = oriented(preset.large, landscape, !!preset.fixed);
  const wW = small[0] - 2 * ov;
  const wH = small[1] - 2 * ov;
  const W = wW + 2 * s;
  const H = wH + s + b;
  const rect: CutRing = [[-W / 2, 0], [W / 2, 0], [W / 2, H], [-W / 2, H]];
  const window: Box = { minX: -wW / 2, maxX: wW / 2, minY: b, maxY: b + wH };
  const corner = clamp(i.windowCorner ?? 0, 0, Math.min(wW, wH) / 4);
  const windowRing = shift(roundedRectRing(wW, wH, corner), 0, b + wH / 2);

  const pocketW = large[0] + 2 * c;
  const rail = b - ov;
  const wall = W / 2 - pocketW / 2;
  const seat = (p: Pt): Box => ({ minX: -p[0] / 2, maxX: p[0] / 2, minY: rail, maxY: rail + p[1] });
  const photos = { small: seat(small), large: seat(large) };

  // The notch: down to 1 mm above the window, where the top border still hides it — an empty
  // frame shows the back through the window, and a notch there reads as a hole. That leaves ov − 1
  // of the small print showing in it to push up (5 mm, film 2), and a print can always be slid up
  // from the front as well, by a thumb on its face through the window.
  const notch = { w: clamp(0.3 * wW, 14, 26), bottom: window.maxY + 1 };

  // ---------------------------------------------------------------------- the stand --
  const a = 0.45 * H;
  const D = Math.max(45, 0.4 * H);

  // The centre of mass, weighed (header), for a lean θ: each sheet as [area, Y up it, Z through
  // the stack], each rib its triangle A-B-C, already in the side view.
  const whole = W * H;
  const slit = pocketW * (H - rail);
  const sheets: [number, number, number][] = [
    [whole - wW * wH, (whole * H / 2 - wW * wH * (b + wH / 2)) / (whole - wW * wH), 2.5 * t],
    [whole - slit, (whole * H / 2 - slit * (rail + (H - rail) / 2)) / (whole - slit), 1.5 * t],
    [whole, H / 2, 0.5 * t],
  ];
  const weigh = (th: number) => {
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    let m = 0;
    let y = 0;
    let z = 0;
    for (const [area, Y, Z] of sheets) {
      m += area;
      y += area * (Y * sn - Z * cs);
      z += area * (Y * cs + Z * sn);
    }
    const rib = 0.5 * D * a * cs;
    m += 2 * rib;
    y += 2 * rib * ((a * sn + D) / 3);
    z += 2 * rib * ((a * cs) / 3);
    y /= m;
    z /= m;
    return { y, z, forward: deg(Math.atan2(y, z)), back: deg(Math.atan2(D - y, z)) };
  };
  // θ is the research's 20°, or the least lean past it that keeps TIP_MIN of forward tip: a deep
  // stack on a short frame (three 5 mm sheets on an instant-mini landscape) wants a few degrees
  // more, because the stack's own depth is a bigger bite out of a short lever. Derived, never a
  // slider; every preset at 3 mm stays at 20°.
  let lean = LEAN;
  while (weigh(rad(lean)).forward < TIP_MIN && lean < MAX_LEAN) lean += 0.5;
  const weighed = weigh(rad(lean));
  const theta = rad(lean);
  const sn = Math.sin(theta);
  const cs = Math.cos(theta);

  const web = Math.max(4, 1.2 * t);
  const L = clamp(rail - 2 * web, 10, 16);
  const u = rail / 2;
  const depth = 2 * t - 0.3;
  const ribX = 0.3 * W;
  const slot = { across: slotWidth(t, kerf, clearance), along: slotWidth(L, kerf, clearance) };

  // The rib: A → C → B is counter-clockwise. B is rounded (it is the corner a hand meets), C a
  // little; A stays sharp because it sits in the corner between the table and the frame.
  const B: Pt = [a * sn, a * cs];
  const body = filletRing([[0, 0], [D, 0], B], [0, 3, 4]);
  // The tab, in (along AB, out of AB towards the front) and then into the rib's plane. The two
  // axes are right-handed, so a counter-clockwise walk stays counter-clockwise.
  const e: Pt = [sn, cs];
  const n: Pt = [-cs, sn];
  const at = (along: number, out: number): Pt => [along * e[0] + out * n[0], along * e[1] + out * n[1]];
  const Ld = tabWidth(L, kerf);
  const s0 = u - Ld / 2;
  const s1 = u + Ld / 2;
  const ch = 0.4;
  const tab: CutRing = [at(s0, -0.5), at(s1, -0.5), at(s1, depth - ch), at(s1 - ch, depth), at(s0 + ch, depth), at(s0, depth - ch)];
  const rib: FrameRib = { body, tab, a, D, x: ribX, u, L, depth, slot, box: bboxOf([[body], [tab]]) };
  const slots = [-1, 1].map((side) => slotHoleRing(side * ribX, u, slot.across, slot.along, 'y'));

  // ---------------------------------------------------------------------- the rules --
  const keepOut: Box[] = [
    { minX: -pocketW / 2 - GAP, maxX: pocketW / 2 + GAP, minY: rail - GAP, maxY: SKY },
    ...[-1, 1].map((side) => ({
      minX: side * ribX - slot.across / 2 - GAP, maxX: side * ribX + slot.across / 2 + GAP,
      minY: u - slot.along / 2 - GAP, maxY: u + slot.along / 2 + GAP,
    })),
  ];

  const metrics: FrameMetrics = {
    lean,
    overlap: ov,
    clearance: c,
    wall,
    rail,
    forwardTip: weighed.forward,
    backTip: weighed.back,
    mass: { y: weighed.y, z: weighed.z },
  };

  if (wall < MIN_WALL - 1e-9) warnings.push(`The side walls come out ${wall.toFixed(1)} mm — a wider border keeps them over ${MIN_WALL}.`);
  if (L > rail - 2 * web + 1e-9) warnings.push('The bottom band is too narrow for the stand’s tabs — a wider border fixes it.');
  if (metrics.forwardTip < 15) warnings.push('At this size the frame tips forward easily.');

  return {
    preset, landscape, t, kerf, clearance, border: s, band: b,
    W, H, rect, window, windowRing, small, large, photos,
    pocket: { w: pocketW, bottom: rail },
    notch, rib, slots, keepOut, metrics, warnings,
  };
}

// ------------------------------------------------------------------------ the rules --

const inBox = ([x, y]: Pt, b: Box) => x > b.minX && x < b.maxX && y > b.minY && y < b.maxY;

function crosses(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const o = (u: Pt, v: Pt, w: Pt) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  return o(p, q, a) * o(p, q, b) < 0 && o(a, b, p) * o(a, b, q) < 0;
}

/** Does this ring reach into this box: a vertex inside it, a corner of it inside the ring, or an
 *  edge of each crossing? Exact for polygons, so a template can place a heart to the millimetre. */
export function ringHitsBox(ring: CutRing, b: Box): boolean {
  if (ring.some((p) => inBox(p, b))) return true;
  const corners: Pt[] = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
  if (corners.some((p) => pointInRing(p, ring))) return true;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    for (let k = 0; k < 4; k++) if (crosses(p, q, corners[k]!, corners[(k + 1) % 4]!)) return true;
  }
  return false;
}

/** True when nothing in `shapes` — pockets a template means to cut through the front — reaches
 *  the photo slot or a rib slot. Outer rings are enough: anything else is inside them. */
export function holeClear(g: FrameGeometry, shapes: Shapes): boolean {
  return shapes.every((island) => !island[0] || g.keepOut.every((b) => !ringHitsBox(island[0]!, b)));
}

/** The outline's box: the rectangle, and every decoration grown by its rim. A Minkowski sum with
 *  a disc moves every extreme point by exactly the radius, so this is the box manifold will cut
 *  to within its arc tolerance — which is what places each sheet's pose. */
export function outlineBox(g: FrameGeometry, holes: Shapes, rim: number): Box {
  const box: Box = { minX: -g.W / 2, maxX: g.W / 2, minY: 0, maxY: g.H };
  if (!holes.length) return box;
  const d = bboxOf(holes);
  return {
    minX: Math.min(box.minX, d.minX - rim), maxX: Math.max(box.maxX, d.maxX + rim),
    minY: Math.min(box.minY, d.minY - rim), maxY: Math.max(box.maxY, d.maxY + rim),
  };
}

// ------------------------------------------------------------------------ the pieces --

export interface FrameContent {
  /** Every decoration cut through the front (a heart, an icon's silhouette). Each also bulges the
   *  outline by `rim`, on every sheet. Solid: an island's own holes are filled, never loose. */
  holes: Shapes;
  /** How far inside its outline each island of `holes` is cut, mm (absent = 0). A decoration made
   *  of islands that stand too close (a paw's toes) is cut that much smaller, which widens the web
   *  of front between them by twice as much. The outline and the keep-out rule still read the full
   *  `holes`, so a smaller pocket only ever sits further inside both. */
  inset?: number[];
  /** Front left standing round each pocket, mm (≥ 4). */
  rim: number;
  /** Front left standing inside the window — a plaque the name sits on. */
  windowMinus?: Shapes;
  /** Engraved on the front. */
  front: DesignLayer[];
  /** Marked on the middle's face, which the pockets show. */
  middle?: DesignLayer[];
}

export interface FramePieces {
  label: string;
  blank: Blank;
  layers: DesignLayer[];
  material: 'light';
  pose: Pose;
  parts: PartInput[];
  status: string;
  warnings: string[];
  /** The outline's box in frame coordinates — what every sheet's pose is placed from. */
  box: Box;
}

/** Air between the pieces on the sheet, mm. */
const SHEET_GAP = 8;

/**
 * The five pieces, ready to spread into a `BuildInput`: the front is the primary; the middle, the
 * back and the two ribs are parts. The caller adds `keyring: NO_KEYRING` and its own file name.
 */
export function framePieces(g: FrameGeometry, c: FrameContent): FramePieces {
  const O = outlineBox(g, c.holes, c.rim);
  // A slot that opens through the top edge has to clear the tallest point of the outline in its
  // own column; clearing the tallest point anywhere does that and costs nothing.
  const top = O.maxY + 0.5;

  // The outline, built the same way on every sheet: the hug unions the rectangle with the
  // decorations grown by the rim and fills whatever the union encloses. No margin and no
  // smoothing, so the rectangle's corners stay square and its bottom edge stays on y = 0.
  const outline: DesignLayer[] = [
    { id: 'outline', label: 'Outline', op: 'off', hugOnly: true, shapes: [[g.rect]] },
    ...(c.holes.length ? [{ id: 'outline-rims', label: 'Outline', op: 'off' as const, hugOnly: true, solid: true, grow: c.rim, shapes: c.holes }] : []),
  ];
  const blank: Blank = { kind: 'hug', margin: 0, smoothing: 0, bridges: 'none', counters: 'filled' };
  const cut = (id: string, label: string, shapes: Shapes, extra: Partial<DesignLayer> = {}): DesignLayer =>
    ({ id, label, op: 'cut', stencil: false, shapes, ...extra });
  const slotLayer = cut('rib-slots', 'Stand slots', g.slots.map((r) => [r]));
  // One pocket layer per inset: `solid` unions a layer's islands and fills them before `grow`
  // shrinks the lot, so all of one decoration's islands — which share an inset — go in together.
  const byInset = new Map<number, Shapes>();
  c.holes.forEach((island, i) => {
    const d = Math.max(0, c.inset?.[i] ?? 0);
    byInset.set(d, [...(byInset.get(d) ?? []), island]);
  });
  const pockets = [...byInset].map(([d, shapes], k) =>
    cut(k ? `pockets-${k + 1}` : 'pockets', 'Pockets', shapes, { solid: true, ...(d > 1e-3 ? { grow: -d } : {}) }));

  const frontLayers: DesignLayer[] = [
    ...outline,
    cut('window', 'Window', [[g.windowRing]], c.windowMinus?.length ? { minus: c.windowMinus } : {}),
    ...pockets,
    ...c.front,
  ];
  const middleLayers: DesignLayer[] = [
    ...outline,
    cut('photo-slot', 'Photo slot', [[uRing(g.pocket.w, g.pocket.bottom, top, 1)]]),
    slotLayer,
    ...(c.middle ?? []),
  ];
  const backLayers: DesignLayer[] = [
    ...outline,
    cut('notch', 'Finger notch', [[uRing(g.notch.w, g.notch.bottom, top, Math.min(8, g.notch.w / 2))]]),
    slotLayer,
  ];

  // ---------------------------------------------------------------------- standing up --
  // A sheet's box centre, k sheets up the stack from the back's rear face (mid-thickness at
  // Z = (k + ½)·t), leant back θ about the rear bottom edge R — the origin, on the table:
  //   world y = Y·sin θ − Z·cos θ     world z = Y·cos θ + Z·sin θ      rx = 90 − θ
  // (`rx: α` sends the sheet's +y to (0, cos α, sin α) and its engraved +z to (0, −sin α, cos α),
  // towards the reader and up.)
  const th = rad(g.metrics.lean);
  const cx = (O.minX + O.maxX) / 2;
  const cy = (O.minY + O.maxY) / 2;
  const sheetPose = (k: number): Pose => {
    const Z = (k + 0.5) * g.t;
    return { x: cx, y: cy * Math.sin(th) - Z * Math.cos(th), z: cy * Math.cos(th) + Z * Math.sin(th), rx: 90 - g.metrics.lean };
  };
  // A rib stands on edge (`rx: 90`) turned to run front-to-back (`rz: 90`): its own x is the
  // world's y (back from R) and its own y is up — exactly the plane it was drawn in.
  const rb = g.rib.box;
  const ribPose = (side: number): Pose => ({ x: side * g.rib.x, y: (rb.minX + rb.maxX) / 2, z: (rb.minY + rb.maxY) / 2, rx: 90, rz: 90 });

  // ---------------------------------------------------------------------- on the sheet --
  // Front, middle and back in a row, the ribs under the MIDDLE: they are dark wood like it, so the
  // light sheet is the front's column alone and a cut down the file splits the two woods. Nothing
  // nests inside another piece's box: the preview finds each piece's islands by box.
  const w = O.maxX - O.minX;
  const h = O.maxY - O.minY;
  const ribW = rb.maxX - rb.minX;
  const ribH = rb.maxY - rb.minY;
  const parts: PartInput[] = [
    {
      id: 'middle', label: 'Middle · dark wood', blank, layers: middleLayers, keyring: 'none', material: 'dark',
      at: { x: cx + w + SHEET_GAP, y: cy }, assembledAt: 'built', z: 0, pose: sheetPose(1),
    },
    {
      id: 'back', label: 'Back · dark wood', blank, layers: backLayers, keyring: 'none', material: 'dark',
      at: { x: cx + 2 * (w + SHEET_GAP), y: cy }, assembledAt: 'built', z: -1, pose: sheetPose(0),
    },
    ...[-1, 1].map((side, k): PartInput => ({
      id: k === 0 ? 'rib-a' : 'rib-b', label: 'Stand rib · dark wood',
      blank: { kind: 'shape', shapes: [[g.rib.body], [g.rib.tab]], oneIsland: true }, layers: [], keyring: 'none', material: 'dark',
      at: { x: O.maxX + SHEET_GAP + ribW / 2 + k * (ribW + SHEET_GAP), y: O.minY - SHEET_GAP - ribH / 2 },
      // Behind the back on the flat card, which is a view from the front: out of sight.
      assembledAt: { x: 0, y: g.H / 2 }, z: -2, pose: ribPose(side),
    })),
  ];

  // ---------------------------------------------------------------------- what to say --
  const warnings = [...g.warnings];
  if (w > BED + 1e-6 || h > BED + 1e-6) warnings.push(`This frame is ${Math.round(w)} × ${Math.round(h)} mm — bigger than a ${BED} mm bed.`);
  if (!holeClear(g, c.holes)) warnings.push('A decoration sits over the photo slot or a stand slot — it would show through.');
  if (O.minY < -1e-6) warnings.push('A decoration hangs below the edge the frame stands on.');

  return {
    label: 'Front · light wood', blank, layers: frontLayers, material: 'light', pose: sheetPose(2),
    parts, status: `${parts.length + 1} pieces`, warnings, box: O,
  };
}

/** One sentence for the export legend: which wood, then the glue order. */
export const FRAME_NOTE = 'Cut the front from light wood and the rest from dark; glue the middle onto the back and the front on top, keeping glue 3 mm off the photo slot; press the ribs into the back and slide the photo in from the top.';
