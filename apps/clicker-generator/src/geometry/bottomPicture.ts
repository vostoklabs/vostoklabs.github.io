// The bottom picture: a traced picture inlaid in colour into the body's underside.
//
// The underside is the first layer on the plate (only the top part is flipped for printing), so
// the picture is a pocket cut up from it and filled with one part per colour, flush with the
// face. Nothing sticks out below it, so the face stays the seat. The engine picks the size and
// the place: the largest the picture's outline can be inside the safe area (the footprint kept
// clear of the wall and the bottom bevel), a little smaller than that, centred on it.
//
// Each colour's part is its footprint carried up BOTTOM_DEPTH_MM from the underside and cut to
// the body, and the body loses exactly those parts. So a colour exists only where there is
// material: a recess already in the underside (the maker's mark) stays empty, and anything
// inside the body (internal cavities, a keyring tunnel, a hollow) is untouched, since all of it
// sits well above a 0.4 mm pocket.

import { csOf, extrude, type Keep } from '@vostok/manifold';
import type { BottomArt, Ring, RGB } from '../types';
import { bottomPoint, DEFAULT_BOTTOM_PLACE, isDefaultPlace } from './bottomPlace';

type Wasm = any;
type Solid = any;
type Section = any;

/** How deep the picture goes, mm: two 0.2 mm layers, so every colour change falls on a layer
 *  edge, and a light colour over a dark body does not show the body through, as one layer does. */
export const BOTTOM_DEPTH_MM = 0.4;
/** The picture takes this share of the largest size that fits, so it never touches the margin. */
export const BOTTOM_FILL = 0.85;
/** Below this, mm along its longest side, the picture is left off rather than printed as a smudge. */
export const BOTTOM_MIN_MM = 8;

export const BOTTOM_NO_ROOM = 'No room for a bottom picture on this base. Make the base bigger.';
export const BOTTOM_LINES_LEFT_OUT = 'Lines thinner than 0.4 mm were left out of the bottom picture.';
export const BOTTOM_TOO_SMALL = 'The bottom picture is too small to print. Make the base bigger.';
/** The customer's Size took it under BOTTOM_MIN_MM: left off, and said. */
export const BOTTOM_SIZED_TOO_SMALL = 'The bottom picture is too small to print. Make it bigger.';
/** Moved off the flat of the underside altogether: nothing of it is left to print. */
export const BOTTOM_OFF_FACE = 'The bottom picture is off the base. Move it back.';

/** How far the picture stays inside the body's footprint, mm: off the wall, and 1 mm past the
 *  bottom bevel, where the underside is no longer flat. */
export function bottomMarginMm(bottomBevelMm: number): number {
  return Math.max(1.5, bottomBevelMm + 1.0);
}

/** A normalised ring at `size` mm, mirrored in X and centred on (cx, cy). The underside is read
 *  from below, so an unmirrored picture prints backwards (the maker's mark's rule). */
export function mirrorPlace(ring: Ring, size: number, cx: number, cy: number): Ring {
  return ring.map(([x, y]) => [-x * size + cx, y * size + cy] as [number, number]);
}

/** The largest `s` in [0, hi] for which `fits(s)` holds, by bisection, to `tol`. `fits` is taken
 *  to hold below some size and not above it. */
export function largestFit(fits: (s: number) => boolean, hi: number, tol = 0.01): number {
  if (!(hi > 0)) return 0;
  if (fits(hi)) return hi;
  let lo = 0;
  let up = hi;
  while (up - lo > tol) {
    const mid = (lo + up) / 2;
    if (fits(mid)) lo = mid;
    else up = mid;
  }
  return lo;
}

/** Thresholds for lines too thin to print, the top picture's, handed in by the build so one copy
 *  of the numbers exists. */
export interface PictureLines {
  /** Each colour is opened by this, mm: every line under twice it is gone. */
  openMm: number;
  /** Losing more than this share of the picture's area that way is said. */
  lossSaid: number;
  /** Keeping less than this share refuses the export. */
  keepsMin: number;
}

export interface BottomCarveIn {
  /** The finished body: every other cut already made. */
  body: Solid;
  /** The body's footprint seen from above, before any texture. */
  footprint: Section;
  /** The underside's Z. */
  bottomZ: number;
  /** See `bottomMarginMm`. */
  marginMm: number;
  art: BottomArt;
  /** Each colour grows by this before the carve, as the top picture's do. */
  colorBleed: number;
  lines: PictureLines;
}

export interface BottomCarveOut {
  /** The body with the pocket taken out. The same solid as given when nothing was inlaid. */
  body: Solid;
  /** One part per region that printed, in carve order. */
  inlays: { name: string; rgb: RGB; solid: Solid }[];
  /** The picture's longest side as placed, mm; 0 when it was left off. */
  sizeMm: number;
  warnings: string[];
  blocking: string[];
  /** Where it could go, for the 2D view: the flat of the underside (`safe`, seen from above, a
   *  section the caller's scope frees), its middle, and the engine's size before the customer's
   *  own. Absent when there is no room at all. */
  area?: { cx: number; cy: number; autoMm: number; safe: Section };
}

const ringArea = (ring: Ring): number => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
};
const usable = (rings: Ring[]): Ring[] => rings.filter((r) => r.length >= 3 && ringArea(r) > 1e-9);

/** Inlay the picture into the body's underside. Everything made on the way is given to `track`. */
export function carveBottomPicture(track: Keep, wasm: Wasm, a: BottomCarveIn): BottomCarveOut {
  const warnings: string[] = [];
  const blocking: string[] = [];
  let area: BottomCarveOut['area'];
  const none = (): BottomCarveOut => ({ body: a.body, inlays: [], sizeMm: 0, warnings, blocking, ...(area ? { area } : {}) });

  const regions = a.art.regions.filter((r) => usable(r.rings).length > 0);
  if (!regions.length) return none();
  // The picture's outline sets its size; without one, everything it draws does.
  let outline = usable(a.art.outline);
  if (!outline.length) outline = regions.flatMap((r) => usable(r.rings));

  const safe: Section = track(a.footprint.offset(-a.marginMm, 'Round', 2.0, 32));
  if (safe.isEmpty()) {
    warnings.push(BOTTOM_NO_ROOM);
    return none();
  }
  const sb = safe.bounds();
  const cx = (sb.min[0] + sb.max[0]) / 2;
  const cy = (sb.min[1] + sb.max[1]) / 2;

  // The outline mirrored once at unit size; each try only scales and moves it.
  const unit: Section = track(csOf(wasm, outline.map((r) => mirrorPlace(r, 1, 0, 0)), 'NonZero'));
  const fits = (s: number): boolean => {
    const placed = track(track(unit.scale([s, s])).translate([cx, cy]));
    return track(placed.subtract(safe)).area() <= 0.01;
  };
  const hi = Math.hypot(sb.max[0] - sb.min[0], sb.max[1] - sb.min[1]);
  // The engine's size, always found with the picture unturned in the middle, so the customer's
  // Size is a share of one number that does not move when the picture does.
  const autoMm = largestFit(fits, hi) * BOTTOM_FILL;
  if (autoMm < BOTTOM_MIN_MM) {
    warnings.push(BOTTOM_NO_ROOM);
    return none();
  }
  area = { cx, cy, autoMm, safe };
  const place = a.art.place ?? DEFAULT_BOTTOM_PLACE;
  const sizeMm = autoMm * place.scale;
  if (sizeMm < BOTTOM_MIN_MM) {
    warnings.push(BOTTOM_SIZED_TOO_SMALL);
    return none();
  }

  // Each colour, smallest coverage first so detail wins where two meet, each clear of what is
  // already placed: the top picture's rule.
  const ordered = [...regions].sort((p, q) => (p.coverage ?? 1) - (q.coverage ?? 1));
  const open = (cs: Section, r: number): Section =>
    track(track(cs.offset(-r, 'Round', 2.0, 24)).offset(r, 'Round', 2.0, 24));
  let placed: Section | null = null;
  let drawnMm2 = 0;
  let keptMm2 = 0;
  const footprints: { name: string; rgb: RGB; fp: Section }[] = [];
  for (const r of ordered) {
    let cs: Section = track(csOf(wasm, usable(r.rings).map((ring) => ring.map(([x, y]) => bottomPoint(x, y, autoMm, cx, cy, place))), 'NonZero'));
    cs = track(cs.simplify(0.03));
    if (a.colorBleed > 0.001) cs = track(cs.offset(a.colorBleed, 'Round', 2.0, 32));
    const drawn = cs.area();
    cs = open(cs, a.lines.openMm);
    drawnMm2 += drawn;
    keptMm2 += cs.area();
    let fp: Section = track(cs.intersect(safe));
    if (placed) fp = track(fp.subtract(placed));
    if (fp.isEmpty()) continue;
    placed = placed ? track(placed.add(fp)) : fp;
    footprints.push({ name: r.partName, rgb: r.filamentRgb, fp });
  }
  if (drawnMm2 > 0) {
    const kept = keptMm2 / drawnMm2;
    if (kept < a.lines.keepsMin) blocking.push(BOTTOM_TOO_SMALL);
    else if (kept < 1 - a.lines.lossSaid) warnings.push(BOTTOM_LINES_LEFT_OUT);
  }
  if (!placed || !footprints.length) {
    // Moved clean off the flat: say so, rather than print nothing without a word.
    if (!isDefaultPlace(place) && drawnMm2 > 0) warnings.push(BOTTOM_OFF_FACE);
    return { ...none(), sizeMm };
  }

  // From just below the underside (a clean cut, not a coplanar one) to the pocket's top.
  const OVER = 0.3;
  const slab = (cs: Section): Solid =>
    track(track(extrude(wasm, cs, BOTTOM_DEPTH_MM + OVER)).translate([0, 0, a.bottomZ - OVER]));
  // The body's skin under the safe area, once; each colour is a piece of it.
  const under: Solid = track(a.body.intersect(slab(safe)));
  const inlays: BottomCarveOut['inlays'] = [];
  for (const f of footprints) {
    const solid = track(under.intersect(slab(f.fp)));
    if (!solid.isEmpty()) inlays.push({ name: f.name, rgb: f.rgb, solid });
  }
  if (!inlays.length) return { ...none(), sizeMm };
  const body = track(a.body.subtract(slab(placed)));
  return { body, inlays, sizeMm, warnings, blocking, area };
}
