/**
 * The numbers a generated cap is made from, and the outline they give. Shared by the builder
 * (index.js) and the switch clearance model (clearance.js), which both need the cap's outline
 * and its inside before any solid exists. Plain maths: no geometry kernel, no DOM.
 *
 * One setting shapes a cap besides its shape and key size: `sizeMM`, its width at the rim (a
 * round cap's diameter, which is also a pill's width; a square cap's width). The gap to the next
 * key follows from it, so a wide key is units x pitch less that gap. The sides always come down
 * flush with the stem's bottom: the rim and the stem both stand on z = 0.
 */
import { MX_STEM_DIAMETER_MM } from './stems.js';

// ---------------------------------------------------------------- the numbers (tune after a print)

/** One key unit, centre to centre. */
export const KEY_PITCH_MM = 19.05;
/** The rim's width when none is asked for: the owner's Standard caps', which fill an MX key's
 *  19.05 mm cell less the usual gap. */
export const DEFAULT_SIZE_MM = { round: 18.136, 'round-tapered': 18.136, square: 18.136 };
/** The widths a cap may be asked for. */
export const SIZE_RANGE_MM = { min: 15, max: 18.8 };
/** Round tapered: the wall leans in this far per mm of its height (about 11°). */
export const ROUND_TAPER_LEAN = 0.2;
/** Square caps: the corner radius seen from above. */
export const SQUARE_CORNER_R_MM = 1.5;
/** The round-over on the top edge, every shape. */
export const TOP_ROUND_OVER_MM = 0.8;
/** Wall thickness, measured square to the wall (a tapered wall is as thick as a straight one). */
export const WALL_MM = 1.4;
/**
 * Round caps only: the wall across the rim's bottom edge, and how far up it grows back to
 * `WALL_MM`. A round cap's inside is a circle, which the switch housing's square corners reach
 * long before a square cap's inside would, so every tenth of a millimetre at the rim is travel
 * (clearance.js): Ø18.136 flush presses 1.5 mm with a plain 1.4 mm wall (it never registers at
 * 2.0) and 2.7 mm with this flare. 0.6 mm is a line and a half of a 0.4 mm nozzle. Over 2 mm the
 * inside leans 0.4 mm per mm on a straight cap and 0.61 on a tapered one, less than the housing
 * narrows at its corners (0.65 per mm), so a circle meets the switch with the rim's bottom edge
 * and nothing higher. Printed open side down, that lean is a 22–32° overhang.
 */
export const RIM_WALL_MM = 0.6;
export const RIM_FLARE_MM = 2.0;
/** The top plate, from the inner ceiling to the top face. */
export const TOP_THICKNESS_MM = 1.5;
/** From the rim (and the stem's bottom) to the top face, before Cap height lowers it. */
export const CAP_HEIGHT_MM = 11.0;
/** How clear of a tapered wall a stem must stay (see `sizeRangeMM`). */
const STEM_TO_WALL_MM = 0.1;
/**
 * Stabiliser stems, either side of the switch stem, by size. The owner's positions, measured off
 * the Standard caps' stems (Thocky and Low profile agree to 0.002); a size not listed has the
 * switch stem only.
 */
const STAB_OFFSET_MM = {
  '2u-3stem': 12.0, '2_25u': 12.0, '2_75u': 12.0,
  '6u-spacebar': 49.0, '6_25u-spacebar': 50.0, '6_5u-spacebar': 52.5,
};

// ---------------------------------------------------------------- shapes and sizes

export const SHAPES = [
  { id: 'round', label: 'Round' },
  { id: 'round-tapered', label: 'Round, tapered' },
  { id: 'square', label: 'Square' },
];

/** The Standard profile's sizes in public/keycaps/index.json, ids and order kept, so switching
 *  between a loaded profile and a shape keeps the size. */
const SIZES = [
  { id: '1u', label: '1u', unit: 1 },
  { id: '1_25u', label: '1.25u', unit: 1.25 },
  { id: '1_5u', label: '1.5u', unit: 1.5 },
  { id: '1_75u', label: '1.75u', unit: 1.75 },
  { id: '2u-1stem', label: '2u (1 stem)', unit: 2 },
  { id: '2u-3stem', label: '2u (3 stems)', unit: 2 },
  { id: '2_25u', label: '2.25u', unit: 2.25 },
  { id: '2_75u', label: '2.75u', unit: 2.75 },
  { id: '6u-spacebar', label: '6u Spacebar', unit: 6 },
  { id: '6_25u-spacebar', label: '6.25u Spacebar', unit: 6.25 },
  { id: '6_5u-spacebar', label: '6.5u Spacebar', unit: 6.5 },
];

/** Every shape comes in every size. @returns {{ id: string, label: string, unit: number }[]} */
export function shapeSizes(shapeId) {
  if (!SHAPES.some((s) => s.id === shapeId)) throw new Error(`Unknown keycap shape "${shapeId}"`);
  return SIZES.map((s) => ({ ...s }));
}

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));

/** The wall's thickness across (horizontally): WALL_MM square to a wall leaning `lean`. */
export const wallAcross = (lean) => WALL_MM * Math.hypot(1, lean);

/**
 * The widths this cap can have. `SIZE_RANGE_MM`, except on a tapered cap: its inside narrows
 * towards the ceiling, and every stem has to stay inside it there or it shows through the side.
 * That binds on a pill with stabiliser stems near its ends (a 2u with three stems needs 17.4, a
 * 6u spacebar 15.2). The narrowest is rounded up to 0.1 mm.
 */
export function sizeRangeMM(shape, sizeId) {
  const size = SIZES.find((s) => s.id === sizeId);
  if (!SHAPES.some((s) => s.id === shape) || !size) throw new Error(`No keycap shape "${shape}" in size "${sizeId}"`);
  if (shape !== 'round-tapered') return { ...SIZE_RANGE_MM };
  // The stems sit on y = 0. At the ceiling the inside is in from the rim by the wall across plus
  // the lean over the sides' height; it has to reach past the outermost stem by its radius, end
  // and sides both.
  const rho = MX_STEM_DIAMETER_MM / 2 + STEM_TO_WALL_MM;
  const reach = STAB_OFFSET_MM[sizeId] ?? 0;
  const inset = wallAcross(ROUND_TAPER_LEAN) + ROUND_TAPER_LEAN * (CAP_HEIGHT_MM - TOP_THICKNESS_MM);
  const narrowest = Math.max(2 * (reach + rho + inset) - (size.unit - 1) * KEY_PITCH_MM, 2 * (rho + inset));
  return { min: clamp(Math.ceil(narrowest * 10 - 1e-9) / 10, SIZE_RANGE_MM), max: SIZE_RANGE_MM.max };
}

// ---------------------------------------------------------------- the outline and the inside

/**
 * A cap's outline at the rim, which is its widest: length `L` along x, width `W` along y, corner
 * radius `r` (a round cap's is half its width, which makes it a stadium, and a circle at 1u), the
 * wall's `lean` (inset per mm of height), whether the rim is `flared` (round caps), and its
 * stems' centres. `sizeMM` is clamped to `sizeRangeMM`; none (or not a number) is the shape's
 * default.
 */
export function capOutline(shape, sizeId, sizeMM) {
  const shapeInfo = SHAPES.find((s) => s.id === shape);
  const size = SIZES.find((s) => s.id === sizeId);
  if (!shapeInfo || !size) throw new Error(`No keycap shape "${shape}" in size "${sizeId}"`);
  const W = clamp(Number.isFinite(sizeMM) ? sizeMM : DEFAULT_SIZE_MM[shape], sizeRangeMM(shape, sizeId));
  const stab = STAB_OFFSET_MM[size.id];
  return {
    shapeInfo,
    size,
    sizeMM: W,
    L: W + (size.unit - 1) * KEY_PITCH_MM,
    W,
    r: shape === 'square' ? SQUARE_CORNER_R_MM : W / 2,
    lean: shape === 'round-tapered' ? ROUND_TAPER_LEAN : 0,
    flared: shape !== 'square',
    centres: stab ? [[-stab, 0], [0, 0], [stab, 0]] : [[0, 0]],
  };
}

/**
 * How far the inside is in from the rim's outline, `z` mm above the rim: the wall across, plus
 * the lean that far up; on a flared rim, from `RIM_WALL_MM` at the bottom edge in a straight line
 * to that at `RIM_FLARE_MM`.
 */
export function insideInset(o, z) {
  const wall = (h) => wallAcross(o.lean) + o.lean * h;
  if (!o.flared || z >= RIM_FLARE_MM) return wall(z);
  return RIM_WALL_MM + ((wall(RIM_FLARE_MM) - RIM_WALL_MM) * Math.max(0, z)) / RIM_FLARE_MM;
}

/** The inside `z` mm above the rim as half-length, half-width and corner radius, as clearance.js
 *  reads it. */
export function insideAt(o, z) {
  const t = insideInset(o, z);
  return { a: o.L / 2 - t, b: o.W / 2 - t, r: Math.max(0, o.r - t) };
}
