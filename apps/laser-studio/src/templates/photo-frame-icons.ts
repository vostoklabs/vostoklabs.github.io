// A photo frame ringed with themed icons — the Father's Day frame, and with another theme the pet
// frame, the new-baby frame, the sports frame. Landscape by default: six icon pockets break out of
// the corners and the sides, a year sits in the top border and a name in handwritten caps in the
// bottom band.
//
// The three sheets, the photo slot and the stand are `engine/photo-frame.ts`. What is this
// template's own is the icons and the two lines of lettering.
//
// THE ICONS are cut as FILLED silhouettes (an island's own counters are filled, or they would fall
// out of the bed) and the counters are engraved on the MIDDLE instead, where the pocket shows them.
// So an icon has to read as its silhouette: bold, simple, and where it has inner lines they are
// webs of front standing between separate pockets — the stencil's way, the photo's way (the paw's
// toes, the pliers' slit, the ball's seams). Each theme is picked for that from two sources:
//   · the bundled Material Symbols (Apache-2.0, no attribution in the customer's file) where one
//     reads as a silhouette — the wrench, the paw, the drill, the sun, the pine, the trophy;
//   · DRAWN here where the font has nothing that does — the photo's pliers and footprint and its
//     heart trio, a bone, a fish, a cat, a baby's bottle and a soccer ball that is not a plain disc
//     once filled. Our own drawing, from circles, rounded polygons and the frame's heart.
// The font's detailed tools (construction, home_repair_service) were muddy blobs filled, and its
// soccer and rugby balls cut as a plain disc and a plain oval, their panels only engraved dark on
// the dark middle; they are gone.
//
// ONE FAMILY. Sized by longer side alone, a thin wrench looked small beside a fat heart. Each icon
// is scaled from the theme's nominal size by (its theme's mean fill ÷ its own fill)^WEIGHT — fill
// being how much of its longer side's square it inks — so a spindly icon grows and a solid one
// shrinks towards the same weight, held to 0.8–1.25 of the nominal so none runs away.
//
// THE WEBS. Between an icon's separate pockets the front stands as a web, loose until the front is
// glued down and pre-heated by the cut on each side of it. It is held to webFloor(t) = max(1.5,
// t/2): 1.5 mm, the house floor for material that carries anything, up to 3 mm on 6 mm stock. The
// narrowest web is measured on the icon itself (islands that overlap, or sit inside another, are
// one pocket once unioned and filled); an icon whose web comes in under the floor has its pocket
// cut `inset` smaller all round, which widens every web by twice that.
//
// Every pocket's inner edge is kept GAP clear of the photo slot, so the icons hang outward, and
// RIM of front round each one is what bulges the outline.
import { bboxOf, cancelCoincidentRings, filletRing, mapShapes, placeShapes, signedArea, type Box, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { pointInRing } from '@vostok/shapes';
import { FALLBACK_FONT_ID, getFont, getHorizontalContours, iconById } from '@vostok/fonts';
import { BED, FRAME_NOTE, GAP, framePieces, holeClear, type FrameGeometry } from '../engine/photo-frame';
import { sizeForCapHeight } from '../engine/metrics';
import { textLayer } from '../engine/text';
import type { DesignLayer } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { NO_KEYRING } from './keyring';
import { borderField, frameAssemblyFields, photoFields, plumpHeart, readFrame } from './photo-frame-shared';
import { stem } from './shared';
import { str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Front left standing round every pocket, mm: ≥ 1.3 t (laser-cutting-knowledge.md §2.1). */
const RIM = 4;
/** The narrowest web of front an icon may leave between its own pockets, mm (header). */
export const webFloor = (t: number) => Math.max(1.5, 0.5 * t);
/** The nominal icon, as a share of the frame's short side and never under 24 mm — the size the
 *  theme's average icon is set at. */
const SHARE = 0.23;
const LEAST = 24;
/** How far towards equal ink each icon is scaled (0 = equal longer sides, ½ = equal areas), and the
 *  most it may move off the nominal either way. */
const WEIGHT = 0.4;
const SMALLEST = 0.8;
const LARGEST = 1.25;
/** Engraved lettering keeps this far off an icon's pocket, mm. */
const CLEAR = 4;
/** The top line's ink keeps this far off the window's cut edge and off the frame's top edge, mm. */
const EDGE = 4;
/** The house floor for engraved lettering, mm of cap height. */
const CAP_FLOOR = 3;

/**
 * The themes: six icons each, in the order top-left, middle-left, bottom-left, top-right,
 * middle-right, bottom-right. A Material Symbols id, or `drawn:` and one of DRAWN. Tools is the
 * reference photo's own six: wrench, pliers, footprint; paw, drill, hearts. Every icon must survive
 * its inset whole at 24 mm on 6 mm stock, which the suites' sweep of every theme on instant mini at
 * 6 mm is there to catch — and its separate pockets must stay within two rims (8 mm) of each
 * other at the biggest frame, or the outline round them comes apart: the font's sparkles
 * (`auto_awesome`) did at 4 × 6 once the icons grew, which the sweep on A5 now catches.
 */
export const THEMES: Record<string, { label: string; icons: string[] }> = {
  tools: { label: 'Tools', icons: ['build', 'drawn:pliers', 'drawn:foot', 'pets', 'tools_power_drill', 'drawn:hearts'] },
  pets: { label: 'Pets', icons: ['pets', 'drawn:bone', 'home', 'drawn:cat', 'drawn:fish', 'favorite'] },
  baby: { label: 'Baby', icons: ['bedtime', 'drawn:bottle', 'drawn:foot', 'star', 'child_friendly', 'favorite'] },
  love: { label: 'Love', icons: ['drawn:hearts', 'filter_vintage', 'favorite', 'volunteer_activism', 'diamond', 'spa'] },
  sport: { label: 'Sport', icons: ['drawn:soccer', 'sports_basketball', 'fitness_center', 'emoji_events', 'sports_baseball', 'military_tech'] },
  outdoors: { label: 'Outdoors', icons: ['park', 'filter_hdr', 'local_fire_department', 'wb_sunny', 'sailing', 'nature'] },
};

/** Each theme's tile in the picker: one bundled symbol that says the theme (the trees for Outdoors),
 *  traced once from the same outlines — 40 × 40, simplified to 0.2 px, holes wound the other way
 *  for the kit's non-zero fill. */
const THUMBS: Record<string, string> = {
  tools: 'M15.1 26.1L18.9 25.4L28.5 34.9L30.5 35.9L32.8 35.8L34.7 34.7L35.8 32.8L35.9 30.5L35 28.5L25.4 18.9L26.1 16.1L25.9 12.8L24.8 9.8L22.9 7.2L20.3 5.3L17.3 4.2L14.1 4L11.5 4.6L10.5 5.8L10.6 7.3L15.8 12.5L12.5 15.8L7.4 10.8L6.5 10.4L5.6 10.6L4.8 11.2L4.2 12.8L4 15.1L4.2 17.3L5.3 20.3L6.5 22.1L8 23.6L9.8 24.8L11.8 25.6Z',
  pets: 'M8 19.2L9.6 18.9L10.8 18L11.7 16.8L12 15.2L11.7 13.6L10.8 12.4L9.6 11.5L8 11.2L6.4 11.5L5.2 12.4L4.3 13.6L4 15.2L4.3 16.8L5.2 18L6.4 18.9ZM15.2 12.8L16.8 12.5L18 11.6L18.9 10.4L19.2 8.8L18.9 7.2L18 6L16.8 5.1L15.2 4.8L13.6 5.1L12.4 6L11.5 7.2L11.2 8.8L11.5 10.4L12.4 11.6L13.6 12.5ZM24.8 12.8L26.4 12.5L27.6 11.6L28.5 10.4L28.8 8.8L28.5 7.2L27.6 6L26.4 5.1L24.8 4.8L23.2 5.1L22 6L21.1 7.2L20.8 8.8L21.1 10.4L22 11.6L23.2 12.5ZM32 19.2L33.6 18.9L34.8 18L35.7 16.8L36 15.2L35.7 13.6L34.8 12.4L33.6 11.5L32 11.2L30.4 11.5L29.2 12.4L28.3 13.6L28 15.2L28.3 16.8L29.2 18L30.4 18.9ZM11.4 35.2L20 34.5L29 35.2L30.6 34.7L31.9 33.5L32.8 31L32.7 29.6L32.2 28.2L27.7 22.9L24.6 18.3L23.1 17L21.3 16.2L19.3 16L17.5 16.7L15.2 18.7L12.3 22.9L8.3 27.3L7.3 29.6L7.5 32.3L9.1 34.4L10.2 35Z',
  baby: 'M15.2 36L16.9 35.3L17.6 33.6L16.9 31.9L15.2 31.2L13.5 31.9L12.8 33.6L13.5 35.3ZM32.8 36L34.5 35.3L35.2 33.6L34.5 31.9L32.8 31.2L31.1 31.9L30.4 33.6L31.1 35.3ZM29.8 7.2L30.2 6.4L29.7 5.5L26.5 4.3L24.1 4L21.4 4.1L17 5.4L23.2 13ZM6.4 11.2L7.6 10.6L8.4 8.3L9.6 7.3L11.1 7.4L12.8 9.3L12.9 23.2L13.7 25.4L15.7 27.8L17.7 29L20 29.6L30.4 29.6L31.1 29.5L31.7 28.9L32 28L31.8 27.2L13.2 5.1L11.9 4.3L10.2 4L8.1 4.4L6.8 5.3L5.4 7L4.8 9L5.1 10.5ZM20.8 26.4L18.5 25.9L16.8 24.3L16 22.1L16 13.1L27 26.4ZM27 26.4L16 13.1L16 22.1L16.4 23.4L17.1 24.6L18.5 25.9L19.8 26.3Z',
  love: 'M20 34.1L22 33.4L28 27.9L32.6 23.1L34.1 21.1L35.2 19.1L35.8 16.9L36 14.7L35.6 12L34.6 9.7L32.1 7.3L29.8 6.2L27.2 5.9L24.6 6.2L21.9 7.5L20 9.2L18.1 7.5L15.4 6.2L12.8 5.9L10.2 6.2L7.9 7.3L5.4 9.7L4.4 12L4 14.7L4.2 16.9L4.9 19.1L6.6 22.1L11 26.9L18 33.4Z',
  sport: 'M20 36L23.2 35.7L26.2 34.7L29 33.3L31.3 31.3L33.3 29L34.7 26.2L35.7 23.2L36 20L35.7 16.8L34.7 13.8L33.3 11L31.3 8.7L29 6.7L26.2 5.3L23.2 4.3L20 4L16.8 4.3L13.8 5.3L11 6.7L8.7 8.7L6.7 11L5.3 13.8L4.3 16.8L4 20L4.3 23.2L5.3 26.2L6.7 29L8.7 31.3L11 33.3L13.8 34.7L16.8 35.7ZM21.6 11.5L21.6 9.3L23.8 7.8L27.7 9.8L30.8 13.1L30.2 15.3L28 16ZM9.8 15.3L9.2 13.1L10.6 11.3L12.7 9.5L16.2 7.8L18.4 9.3L18.4 11.5L12 16ZM10.3 28.3L8.6 25.8L7.5 22.5L7.2 19.4L8.8 18.2L11 19L13.4 26L12.2 28.2ZM20 32.8L16 32.2L14.9 29.8L15.9 28L24.1 28L25.1 29.8L24 32.2ZM14.2 18.4L20 14.3L25.8 18.4L23.6 24.8L16.4 24.8ZM27.8 28.2L26.6 26L29 19L31.2 18.3L32.8 19.4L32.4 23.1L31.4 25.8L29.7 28.3Z',
  outdoors: 'M12.8 32.3L13.1 33.2L13.8 33.7L17.8 33.6L18.6 32.5L18.6 28.1L21.4 28.1L21.4 32.5L21.7 33.3L22.7 33.8L26 33.8L26.7 33.4L27.1 32.6L27.2 28.1L35.3 27.9L36 26.9L35.9 26L31.7 19.5L32.4 19.3L32.9 18.7L32.9 17.5L25.1 6.5L24.1 6.2L23.3 6.6L20 11.3L16.7 6.6L15.9 6.2L14.9 6.5L7.1 17.5L7.1 18.7L7.6 19.3L8.3 19.5L4 26.6L4.4 27.6L5.2 28L12.8 28.1Z',
};

/** Year faces for the top line, and handwritten caps for the name (the reference's "DAD"). */
const TOP_FACES = ['bree-serif', 'arvo', 'roboto-slab', 'playfair-display', 'montserrat', 'oswald'];
const NAME_FACES = ['kalam', 'permanent-marker', 'caveat', 'patrick-hand', 'gochi-hand', 'architects-daughter', 'bebas-neue', 'pacifico'];

type Pt = [number, number];

// ------------------------------------------------------------------------ the drawn icons --
//
// Design units, y up, about 100 across. An icon is a list of rings: rings that overlap are one
// pocket (the engine unions them), and the front left standing between the rest is the icon's
// webs — each drawn at least 5 units, 1.7 mm on a 34 mm icon.

/** A corner of a polygon: where it is, and the radius it is rounded by. */
type Corner = [number, number, number?];
const poly = (pts: Corner[]): CutRing => filletRing(pts.map(([x, y]): Pt => [x, y]), pts.map((p) => p[2] ?? 0));
const disc = (cx: number, cy: number, r: number, n = 32): CutRing =>
  Array.from({ length: n }, (_, i): Pt => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
const oval = (cx: number, cy: number, rx: number, ry: number, n = 48): CutRing =>
  Array.from({ length: n }, (_, i): Pt => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)]);
const rrect = (cx: number, cy: number, w: number, h: number, r: number): CutRing =>
  poly([[cx - w / 2, cy - h / 2, r], [cx + w / 2, cy - h / 2, r], [cx + w / 2, cy + h / 2, r], [cx - w / 2, cy + h / 2, r]]);
/** A stadium: the segment (x1, y1)–(x2, y2) grown by r. */
function capsule(x1: number, y1: number, x2: number, y2: number, r: number): CutRing {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const out: CutRing = [];
  for (let i = 0; i <= 12; i++) { const t = a + Math.PI / 2 + (Math.PI * i) / 12; out.push([x1 + r * Math.cos(t), y1 + r * Math.sin(t)]); }
  for (let i = 0; i <= 12; i++) { const t = a - Math.PI / 2 + (Math.PI * i) / 12; out.push([x2 + r * Math.cos(t), y2 + r * Math.sin(t)]); }
  return out;
}
const turn = (ring: CutRing, deg: number, cx = 0, cy = 0): CutRing => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return ring.map(([x, y]): Pt => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
};
const mirror = (ring: CutRing): CutRing => ring.map(([x, y]): Pt => [-x, y]).reverse();
const heartAt = (cx: number, cy: number, w: number, rot: number): CutRing =>
  turn(plumpHeart(w, 0.9 * w).map(([x, y]): Pt => [x + cx, y + cy]), rot, cx, cy);

/** The soccer ball: a disc cut by webs into its middle pentagon and the five panels round it, the
 *  seams running out from the pentagon's corners — a stencil of the ball, where the font's filled
 *  one is a plain disc. */
function soccer(): CutRing[] {
  const R = 50;
  const Rp = 19;
  const web = 5;
  const ang = (k: number) => Math.PI / 2 + (2 * Math.PI * k) / 5;
  const V = (k: number): Pt => [Rp * Math.cos(ang(k)), Rp * Math.sin(ang(k))];
  const pin = Rp - web / 2 / Math.cos(Math.PI / 5);
  const out: CutRing[] = [poly(Array.from({ length: 5 }, (_, k): Corner => [pin * Math.cos(ang(k)), pin * Math.sin(ang(k)), 1.5]))];
  const meet = (p: Pt, d: Pt, q: Pt, e: Pt): Pt => {
    const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / (d[0] * e[1] - d[1] * e[0]);
    return [p[0] + t * d[0], p[1] + t * d[1]];
  };
  const rim = (p: Pt, d: Pt): Pt => {
    const b = p[0] * d[0] + p[1] * d[1];
    const t = -b + Math.sqrt(b * b - (p[0] * p[0] + p[1] * p[1] - R * R));
    return [p[0] + t * d[0], p[1] + t * d[1]];
  };
  for (let k = 0; k < 5; k++) {
    const d0: Pt = [Math.cos(ang(k)), Math.sin(ang(k))];
    const d1: Pt = [Math.cos(ang(k + 1)), Math.sin(ang(k + 1))];
    // Each seam, and the pentagon's edge between them, moved half a web into this panel.
    const p0: Pt = [V(k)[0] - (d0[1] * web) / 2, V(k)[1] + (d0[0] * web) / 2];
    const p1: Pt = [V(k + 1)[0] + (d1[1] * web) / 2, V(k + 1)[1] - (d1[0] * web) / 2];
    const e: Pt = [V(k + 1)[0] - V(k)[0], V(k + 1)[1] - V(k)[1]];
    const mid: Pt = [(V(k)[0] + V(k + 1)[0]) / 2, (V(k)[1] + V(k + 1)[1]) / 2];
    const m = Math.hypot(mid[0], mid[1]);
    const q: Pt = [V(k)[0] + (mid[0] / m) * (web / 2), V(k)[1] + (mid[1] / m) * (web / 2)];
    const A = meet(p0, d0, q, e);
    const D = meet(p1, d1, q, e);
    const B = rim(p0, d0);
    const C = rim(p1, d1);
    const aB = Math.atan2(B[1], B[0]);
    let aC = Math.atan2(C[1], C[0]);
    while (aC < aB) aC += 2 * Math.PI;
    const ring: Corner[] = [[A[0], A[1], 1.5], [B[0], B[1]]];
    for (let i = 1; i < 16; i++) { const t = aB + ((aC - aB) * i) / 16; ring.push([R * Math.cos(t), R * Math.sin(t)]); }
    ring.push([C[0], C[1]], [D[0], D[1], 1.5]);
    out.push(poly(ring));
  }
  return out;
}

const DRAWN: Record<string, () => CutRing[]> = {
  /** The photo's pliers: two halves split by a slit of front, a pivot disc bitten out of both. */
  pliers: () => {
    // The pivot's arc, r 7 about (0, 58), from where it leaves the slit's edge (x = 3) back to it.
    const t0 = Math.acos(3 / 7);
    const pivot = Array.from({ length: 11 }, (_, i): Corner => { const t = -t0 + (2 * t0 * i) / 10; return [7 * Math.cos(t), 58 + 7 * Math.sin(t)]; });
    const half = poly([[3, 100], [10, 95, 4], [16, 80, 12], [19, 67, 3], [24, 60, 9], [21, 48, 6], [27, 30, 18], [33, 6, 7], [22, 1, 7], [14, 26, 18], [3, 43, 5], ...pivot]);
    return [half, mirror(half)];
  },
  /** The photo's footprint: a sole, and five toes on an arc over it, tipped as a foot is. The
   *  toes sit 5.5 apart on a circle of radius 46 and the least is r 5.8 — 2.7 mm across on the
   *  smallest frame's icon, where r 4.5 had been 2.2 and all but vanished on 6 mm stock. */
  foot: () => {
    const sole = poly([[-32, 53.5, 11], [-12, 70, 24], [12, 72, 24], [31.5, 61.5, 13], [34, 37, 22], [21, 2, 15], [-1, -2, 14], [-8, 25, 17], [-31, 42, 11]]);
    const toes = ([[-28.2, 74.7, 8.6], [-9.2, 84.6, 7.3], [10.3, 85.2, 6.7], [27.4, 78.4, 6.2], [39.9, 66.1, 5.8]] as const).map(([x, y, r]) => disc(x, y, r, 24));
    return [sole, ...toes].map((r) => turn(r, 18, 0, 40));
  },
  /** The photo's hearts: a big one, a small one over its shoulder and a little one under that. */
  hearts: () => [heartAt(14, -6, 62, -10), heartAt(-27, 31, 30, 16), heartAt(-34, 4, 16, -10)],
  bone: () => [capsule(-26, 0, 26, 0, 7.5), disc(-31, 8.5, 10.5), disc(-31, -8.5, 10.5), disc(31, 8.5, 10.5), disc(31, -8.5, 10.5)].map((r) => turn(r, 35)),
  /** A fish: the body, and its tail across a web. */
  fish: () => [poly([[-44, 0, 16], [-12, 21, 30], [22, 3, 4], [22, -3, 4], [-12, -21, 30]]), poly([[28, 0, 3], [52, 21, 6], [48, 0, 6], [52, -21, 6]])],
  /** A cat's head: the face and two ears. */
  cat: () => {
    const ear = poly([[-36, 4, 4], [-30, 46, 5], [-6, 24, 4]]);
    return [oval(0, -8, 38, 32), ear, mirror(ear)];
  },
  /** A baby's bottle: the teat, the collar, and the bottle with two marks bitten into its side. */
  bottle: () => [
    rrect(0, 88, 14, 16, 7),
    rrect(0, 70, 34, 10, 3),
    poly([[-15, 0, 8], [15, 0, 8], [15, 60, 8], [-15, 60, 8], [-15, 47], [-5, 47, 1], [-5, 42, 1], [-15, 42], [-15, 33], [-5, 33, 1], [-5, 28, 1], [-15, 28]]),
  ],
  soccer,
};

// ------------------------------------------------------------------------ the icons' ink --
//
// What a glyph INKS is decided by the font's own rule, non-zero winding — and here it has to be,
// because the counters engraved on the middle are "the pocket less the ink", so a ring read the
// wrong way round is a patch burnt into the dark layer that the icon does not have. The shared
// reading (`islandsFromContours`) calls a ring a hole when it is wound against the ring that
// contains it, which is right for a letter and wrong for Material Symbols' FILLED icons: they draw
// the outline-style glyph and then its fill, so an inner shape comes twice, wound opposite ways a
// hair apart (the wrench: +135, −26.5, +26.4 units²). Read by containment, the fill copy is a hole
// in the hole, and the wrench engraved a crescent, the tree its whole canopy, the tent its body.
// So each ring asks the winding itself: just inside it and just outside it, at edges all round.

/** How many times the rings wind round `p`: ink wherever it is not 0. */
function windingAt(p: Pt, rings: CutRing[]): number {
  let w = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= p[1]) { if (b[1] > p[1] && cross > 0) w++; } else if (b[1] <= p[1] && cross < 0) w--;
    }
  }
  return w;
}

/** The same shape drawn twice, a hair apart and wound opposite ways (2 % of its area and size).
 *  Under non-zero the pair encloses only the hairline between them — a drawing artefact of the
 *  filled icons, not a counter — so it cancels, as an exact copy does (`cancelCoincidentRings`). */
function nearCopies(a: CutRing, b: CutRing): boolean {
  const A = signedArea(a);
  const B = signedArea(b);
  if (Math.sign(A) === Math.sign(B) || Math.abs(Math.abs(A) - Math.abs(B)) > 0.02 * Math.abs(A)) return false;
  const p = bboxOf([[a]]);
  const q = bboxOf([[b]]);
  const tol = 0.02 * Math.max(p.maxX - p.minX, p.maxY - p.minY);
  return Math.abs(p.minX - q.minX) <= tol && Math.abs(p.maxX - q.maxX) <= tol && Math.abs(p.minY - q.minY) <= tol && Math.abs(p.maxY - q.maxY) <= tol;
}

/**
 * A glyph's contours → islands of ink by the non-zero rule. A ring is a HOLE where, along most of
 * its edges, the winding just inside it is 0 and just outside it is not; it is INK where the
 * reverse holds, and a ring buried in ink on both sides (an overlapping stroke) adds nothing. Each
 * ink ring is an island, with every hole inside it — two overlapping strokes both carry the hole
 * they share, or their union would fill it back in.
 */
function glyphInk(contours: number[][][]): Shapes {
  let rings = cancelCoincidentRings(contours.filter((c) => c.length >= 3).map((c) => c.map(([x, y]) => [x!, y!] as Pt)))
    .filter((r) => Math.abs(signedArea(r)) > 1e-6);
  const gone = new Set<number>();
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length && !gone.has(i); j++) {
      if (!gone.has(j) && nearCopies(rings[i]!, rings[j]!)) { gone.add(i); gone.add(j); }
    }
  }
  rings = rings.filter((_, i) => !gone.has(i));
  const ink: CutRing[] = [];
  const holes: { ring: CutRing; probe: Pt }[] = [];
  for (const r of rings) {
    const s = Math.sign(signedArea(r));
    const step = Math.max(1, Math.floor(r.length / 32));
    let out = 0;
    let hole = 0;
    let probe: Pt | null = null;
    for (let i = 0; i < r.length; i += step) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-4) continue;
      // The inward normal: left of the edge on a counter-clockwise ring, right on a clockwise one.
      const e = 1e-3 / len;
      const n: Pt = [-(b[1] - a[1]) * s * e, (b[0] - a[0]) * s * e];
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const inner: Pt = [m[0] + n[0], m[1] + n[1]];
      const wIn = windingAt(inner, rings);
      const wOut = windingAt([m[0] - n[0], m[1] - n[1]], rings);
      if (wIn !== 0 && wOut === 0) out++;
      else if (wIn === 0 && wOut !== 0) { hole++; probe ??= inner; }
    }
    if (hole > out && probe) holes.push({ ring: r, probe });
    else if (out > 0) ink.push(r);
  }
  return ink.map((r) => [r, ...holes.filter((h) => pointInRing(h.probe, r)).map((h) => h.ring)]);
}

// ------------------------------------------------------------------------ an icon's measures --

/** The nearest point of segment ab to p, as a distance. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** The gap between two rings that do not meet: the nearest any vertex of one comes to the other's
 *  edges, which is exact for polygons. */
function ringGap(a: CutRing, b: CutRing): number {
  let d = Infinity;
  for (const [s, t] of [[a, b], [b, a]] as const) {
    for (const p of s) for (let i = 0; i < t.length; i++) d = Math.min(d, segDist(p, t[i]!, t[(i + 1) % t.length]!));
  }
  return d;
}

function segmentsCross(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const o = (u: Pt, v: Pt, w: Pt) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  return o(p, q, a) * o(p, q, b) < 0 && o(a, b, p) * o(a, b, q) < 0;
}

/** Do two outlines overlap, or one sit inside the other — one pocket once unioned and filled? */
function meets(a: CutRing, b: CutRing): boolean {
  if (pointInRing(a[0]!, b) || pointInRing(b[0]!, a)) return true;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
  }
  return false;
}

const near = (a: Box, b: Box, d: number) => !(a.minX - b.maxX > d || b.minX - a.maxX > d || a.minY - b.maxY > d || b.minY - a.maxY > d);

/** How many vertices of each ring lie on the other: two or more a side is a shared edge. */
function contacts(a: CutRing, b: CutRing, tol: number): number {
  const on = (p: Pt, r: CutRing) => r.some((q, i) => segDist(p, q, r[(i + 1) % r.length]!) < tol);
  return a.filter((p) => on(p, b)).length + b.filter((p) => on(p, a)).length;
}

/** The narrowest web of front an icon (longer side 1) leaves between its pockets: islands that
 *  overlap, sit one inside another or share an edge (the two peaks of the mountains) are one pocket
 *  once unioned; between the rest, the nearest they come — 0 where two only touch at a point (a
 *  flower's leaf on its stem), which the union keeps as a pinch. Infinity for an icon that is one
 *  pocket. For every icon still in use it agrees with the table it replaced, measured by hand on
 *  the built pockets, to 1e-4. */
function narrowestWeb(shapes: Shapes): number {
  const TOUCH = 1e-4;
  const outer = shapes.map((island) => island[0]!);
  const boxes = outer.map((r) => bboxOf([[r]]));
  const group = outer.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
  const gaps: [number, number, number][] = [];
  for (let i = 0; i < outer.length; i++) {
    for (let j = i + 1; j < outer.length; j++) {
      if (!near(boxes[i]!, boxes[j]!, 0.5)) continue;
      const a = outer[i]!;
      const b = outer[j]!;
      const d = near(boxes[i]!, boxes[j]!, 0) && meets(a, b) ? -1 : ringGap(a, b);
      if (d < 0 || (d < TOUCH && contacts(a, b, TOUCH) >= 3)) group[find(i)] = find(j);
      else gaps.push([i, j, d]);
    }
  }
  return gaps.reduce((web, [i, j, d]) => (find(i) !== find(j) ? Math.min(web, d) : web), Infinity);
}

/** How much of its longer side's square an icon (longer side 1, centred) inks, sampled on a grid —
 *  pockets are cut filled, so each island's outline is what counts. */
function fillOf(shapes: Shapes): number {
  const N = 60;
  const outer = shapes.map((island) => island[0]!);
  const boxes = outer.map((r) => bboxOf([[r]]));
  let n = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p: Pt = [-0.5 + (i + 0.5) / N, -0.5 + (j + 0.5) / N];
      if (outer.some((r, k) => p[0] >= boxes[k]!.minX && p[0] <= boxes[k]!.maxX && p[1] >= boxes[k]!.minY && p[1] <= boxes[k]!.maxY && pointInRing(p, r))) n++;
    }
  }
  return n / (N * N);
}

/** An icon at unit size: its islands with the longer side 1, centred on the origin, the narrowest
 *  web between its pockets and how much of its square it inks — per id, once. */
interface UnitIcon { shapes: Shapes; web: number; fill: number }
const units = new Map<string, Promise<UnitIcon | null>>();

async function loadUnit(id: string): Promise<UnitIcon | null> {
  let islands: Shapes;
  const draw = id.startsWith('drawn:') ? DRAWN[id.slice(6)] : undefined;
  if (draw) {
    islands = draw().map((r) => [signedArea(r) < 0 ? [...r].reverse() : r]);
  } else {
    const char = iconById(id)?.char ?? '';
    if (!char) return null;
    const font = await getFont(FALLBACK_FONT_ID);
    islands = glyphInk(getHorizontalContours(font, null, char, '', 24, 24, 0, 'center', 0.55, 0).contours);
  }
  if (!islands.length) return null;
  const b = bboxOf(islands);
  const k = 1 / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const shapes = mapShapes(islands, ([x, y]) => [(x - cx) * k, (y - cy) * k]);
  return { shapes, web: narrowestWeb(shapes), fill: fillOf(shapes) };
}

function unitIcon(id: string): Promise<UnitIcon | null> {
  let p = units.get(id);
  if (!p) {
    units.set(id, (p = loadUnit(id)));
    // A font that failed to load is asked again next build, not remembered as missing.
    p.catch(() => units.delete(id));
  }
  return p;
}

interface Placed { holes: Shapes; inset: number[]; boxes: Box[] }

/**
 * The six icons, in frame coordinates: two columns, each icon's inner edge on the photo slot's
 * keep-out, the top pair hung on the corners, the bottom pair standing just clear of the table,
 * the middle pair half way. `holeClear` is the rule; the formulas are only its first guess.
 */
async function placeIcons(g: FrameGeometry, ids: string[]): Promise<Placed> {
  const inner = g.pocket.w / 2 + GAP;
  const nominal = Math.max(LEAST, SHARE * Math.min(g.W, g.H));
  const icons: UnitIcon[] = [];
  for (let k = 0; k < 6; k++) {
    const u = (await unitIcon(ids[k] ?? 'favorite')) ?? (await unitIcon('favorite'));
    if (u) icons.push(u);
  }
  // The theme's mean fill, geometric: each icon is scaled towards it (header, ONE FAMILY).
  const mean = Math.exp(icons.reduce((s, u) => s + Math.log(Math.max(1e-3, u.fill)), 0) / Math.max(1, icons.length));
  // Aim 0.1 over the floor, for the arcs the offset is drawn with.
  const floor = webFloor(g.t) + 0.1;
  const out: Placed = { holes: [], inset: [], boxes: [] };
  icons.forEach((u, k) => {
    const side = k < 3 ? -1 : 1;
    const row = k % 3;
    const ub = bboxOf(u.shapes);
    // An icon hangs outward from the slot by its width and the top pair ride 0.35 of their height
    // over the top edge, so both are capped to keep the outline on the bed (A5 landscape with a
    // 30 mm border would reach 303 mm) — the heart frame caps its hearts the same way.
    const L = Math.min(
      nominal * clamp((mean / Math.max(1e-3, u.fill)) ** WEIGHT, SMALLEST, LARGEST),
      (BED / 2 - inner - RIM - 2) / (ub.maxX - ub.minX),
      row === 0 ? (BED - 2 - RIM - g.H) / (0.35 * (ub.maxY - ub.minY)) : Infinity,
    );
    const shapes = mapShapes(u.shapes, ([x, y]) => [x * L, y * L]);
    const web = u.web * L;
    const b = bboxOf(shapes);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const top = g.H - 0.15 * h;
    const bottom = RIM + 1 + h / 2;
    const y = row === 0 ? top : row === 2 ? bottom : (top + bottom) / 2;
    let x = inner + w / 2;
    let placed = placeShapes(shapes, side * x, y, 0);
    for (let n = 0; n < 200 && !holeClear(g, placed); n++) placed = placeShapes(shapes, side * (x += 0.25), y, 0);
    out.holes.push(...placed);
    out.inset.push(...placed.map(() => (web < floor ? (floor - web) / 2 : 0)));
    out.boxes.push(bboxOf(placed));
  });
  return out;
}

// ------------------------------------------------------------------------ the lettering --

/** One line, its ink centred on (0, y), its caps `cap` tall unless that is wider than `maxW` — or
 *  its ink, descenders and all, taller than `maxH`. */
async function line(v: Values, key: string, fontKey: string, cap: number, maxW: number, y: number, id: string, label: string, maxH = Infinity): Promise<{ layer: DesignLayer | null; cap: number }> {
  const text = str(v, key).trim();
  if (!text) return { layer: null, cap };
  const font = str(v, fontKey);
  const spec = { text, font, symbols: readSymbols(v), y };
  let [l] = await textLayer({ ...spec, size: await sizeForCapHeight(font, cap) }, 'engrave', id, label);
  if (!l) return { layer: null, cap };
  const b = bboxOf(l.shapes);
  const k = Math.min(1, maxW / Math.max(1e-6, b.maxX - b.minX), maxH / Math.max(1e-6, b.maxY - b.minY));
  if (k < 0.999) [l] = await textLayer({ ...spec, size: await sizeForCapHeight(font, cap * k) }, 'engrave', id, label);
  return { layer: l ?? null, cap: cap * k };
}

// ------------------------------------------------------------------------ the template --

export const photoFrameIcons: TemplateDef = {
  id: 'photo-frame-icons',
  name: 'Icon photo frame',
  blurb: 'A standing frame ringed with icons, a year and a name.',
  tags: ['gift', 'home', 'engrave + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    { kind: 'text', key: 'topLine', label: 'Top line', panel: 'right', section: 'Text', value: '2026', placeholder: 'A year, a date…', maxLength: 16 },
    { kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text', value: 'DAD', placeholder: 'DAD, GRANDPA, BUDDY…', maxLength: 14 },
    // ---------------------------------------------------------- LEFT --
    ...photoFields('landscape'),
    {
      kind: 'thumbs', key: 'theme', label: 'Icons', section: 'Frame', value: 'tools', columns: 3,
      options: Object.entries(THEMES).map(([value, t]) => ({ value, label: t.label, svgPath: THUMBS[value] })),
    },
    { kind: 'font', key: 'font', label: 'Name font', section: 'Font', value: 'kalam', recommended: NAME_FACES, previewFrom: 'name' },
    { kind: 'font', key: 'topFont', label: 'Top line font', section: 'Font', value: 'bree-serif', recommended: TOP_FACES, previewFrom: 'topLine' },
    ...frameAssemblyFields(),
    borderField(),
  ],

  async build(v) {
    // The bottom band holds one line of big handwriting: the border plus 12 mm (the reference's 30).
    const g = readFrame(v, { band: (s) => s + 12, windowCorner: 3 });
    const theme = THEMES[str(v, 'theme')] ?? THEMES.tools!;
    const icons = await placeIcons(g, theme.icons);
    // Lettering runs between the two columns of pockets, CLEAR off the nearer one.
    const reach = Math.min(...icons.boxes.map((b) => Math.min(Math.abs(b.minX), Math.abs(b.maxX)))) - CLEAR;
    const maxW = 2 * Math.min(reach, g.W / 2 - CLEAR);
    // The top line is sized by its cap, then fitted by its INK: a date's descenders ("July") make
    // its ink 1.4 caps tall, which at an 18 mm border came 2.7 mm off the window and the top edge.
    // The year alone has none, so it keeps its cap.
    const top = await line(v, 'topLine', 'topFont', clamp(0.5 * g.border, 6, 14), maxW, g.H - g.border / 2, 'top-line', 'Top line', g.border - 2 * EDGE);
    const name = await line(v, 'name', 'font', clamp(0.45 * g.band, 8, 20), maxW, g.band / 2, 'name', 'Name');
    // The counters: the pockets as the front cuts them (unioned, filled) less the glyphs' own ink —
    // exactly what a pocket shows of the middle and the glyph leaves bare. A dot in a ring is ink
    // and stays unmarked; a gap between two islands (the hammer's head and handle) is front, never
    // filled, so it is never marked under the web either. The inset never reaches a counter: it
    // is under 1 mm and every counter sits a whole stroke (≥ 2 mm) inside its outline. A theme of
    // plain silhouettes has no counters, and no layer to say so.
    const details: DesignLayer[] = icons.holes.some((island) => island.length > 1)
      ? [{ id: 'details', label: 'Icon details', op: 'engrave', shapes: icons.holes, solid: true, minus: icons.holes }]
      : [];
    const pieces = framePieces(g, {
      holes: icons.holes, inset: icons.inset, rim: RIM,
      front: [top.layer, name.layer].filter((l): l is DesignLayer => !!l),
      middle: details,
    });
    const warnings = [...pieces.warnings];
    if ((top.layer && top.cap < CAP_FLOOR) || (name.layer && name.cap < CAP_FLOOR)) {
      warnings.push('Some lettering is engraved under 3 mm tall to fit — a shorter line reads better.');
    }
    const { box: _box, warnings: _w, ...rest } = pieces;
    return { ...rest, keyring: NO_KEYRING, ...(warnings.length ? { warnings } : {}) };
  },

  fileName: (v) => stem('icon-frame', str(v, 'name') || 'frame'),

  exportNote: FRAME_NOTE,
};
