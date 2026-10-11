/**
 * How far a generated cap can travel before it meets the switch: a model of an MX switch housing,
 * and the cap's inside against it.
 *
 * WHY. A cap rests on the switch by its stem's bottom, on the slider's shoulder, and its rim is
 * flush with that bottom (or below it, by a Stem recess). The rim comes down with the slider when
 * the key is pressed. A rim that passes outside the housing at every height (a big square cap
 * round the body) only stops on the flange; a smaller one (a round cap) has to stop wherever the
 * housing is still wider than its inside, because the housing's square corners reach further out
 * than a circle's inside. So a bigger cap travels further, and a pill further than a circle of the
 * same width, its long sides clearing what its round ends do not.
 *
 * THE HOUSING, as rounded squares at heights above the plate's top face: the flange on the plate,
 * the body straight up above it, then tapering to its top. Nothing of it is above that top. Every
 * number is an ESTIMATE of a typical MX switch housing rather than one measured on a switch: tune
 * them after a print.
 *
 * THE TEST, at each height: the housing's rounded square, centred, has to fit inside the cap's
 * inside less a side margin: its sides inside the inside's sides, and, where its corner is out
 * past the inside's corner on both axes, its corner arc inside the inside's corner arc. The
 * housing only narrows going up, so a ring of the inside stops at the highest height where the
 * housing does not fit it. The inside is not one ring: it narrows going up (a flared rim, a
 * tapered wall), so `capTravelMM` asks every height of it, and the inner ceiling, and takes the
 * first to touch.
 */
import { insideAt, RIM_FLARE_MM } from './dimensions.js';

// ---------------------------------------------------------------- the switch (estimates)

/** The flange's square, on the plate, and its corner radius and top. */
export const HOUSING_FLANGE_MM = 15.6;
export const HOUSING_FLANGE_R_MM = 0.5;
export const HOUSING_FLANGE_TOP_MM = 1.0;
/** The body's square, from the flange's top straight up to `HOUSING_TAPER_FROM_MM`. */
export const HOUSING_BODY_MM = 14.5;
export const HOUSING_TAPER_FROM_MM = 1.4;
/** The body tapers in a straight line from there to this square at `HOUSING_TOP_Z_MM`, its top. */
export const HOUSING_TOP_MM = 10.2;
export const HOUSING_TOP_Z_MM = 6.1;
/** The body's corner radius, all the way up. */
export const HOUSING_BODY_R_MM = 1.0;
/** Where the stem's bottom rests on the slider's shoulder, key up. */
export const SLIDER_REST_MM = 6.6;
/** How far the slider goes down, all the way, and where the switch actuates. */
export const FULL_TRAVEL_MM = 4.0;
export const ACTUATION_MM = 2.0;
/** Kept clear between the housing and the cap's inside, every side. */
export const SIDE_MARGIN_MM = 0.25;

/** The inside is asked at this spacing, and at the flare's top, where its lean changes. */
const SCAN_STEP_MM = 0.02;

// ---------------------------------------------------------------- the model

/**
 * How far one ring of the cap's inside can travel before it meets the housing.
 *
 * @param {{ a: number, b: number, r: number }} inner  the ring: half-length, half-width and corner
 *   radius of a rounded rectangle (a circle is a = b = r, a pill r = b)
 * @param {number} dropMM  how far the ring sits above the stem's bottom (below it: negative)
 * @returns {number} travel in mm; at least `FULL_TRAVEL_MM` and the key goes all the way down
 */
export function travelBeforeContact(inner, dropMM) {
  const { a, b, r } = inner;
  const m = SIDE_MARGIN_MM;
  const fits = (h, rc) => {
    if (h > a - m || h > b - m) return false;
    const t = h - rc; // the housing's corner centre, on the diagonal
    if (t > a - r && t > b - r) return Math.hypot(t - (a - r), t - (b - r)) + rc <= r - m;
    return true;
  };
  const taperHalf = (z) => {
    const f = (z - HOUSING_TAPER_FROM_MM) / (HOUSING_TOP_Z_MM - HOUSING_TAPER_FROM_MM);
    return (HOUSING_BODY_MM + (HOUSING_TOP_MM - HOUSING_BODY_MM) * f) / 2;
  };

  let contact;
  if (!fits(HOUSING_TOP_MM / 2, HOUSING_BODY_R_MM)) {
    contact = HOUSING_TOP_Z_MM; // not even the top goes in
  } else if (!fits(HOUSING_BODY_MM / 2, HOUSING_BODY_R_MM)) {
    // The taper goes in from some height up: find it. Below it the straight body is no smaller.
    let lo = HOUSING_TAPER_FROM_MM, hi = HOUSING_TOP_Z_MM;
    for (let i = 0; i < 40; i++) {
      const z = (lo + hi) / 2;
      if (fits(taperHalf(z), HOUSING_BODY_R_MM)) hi = z; else lo = z;
    }
    contact = hi;
  } else if (!fits(HOUSING_FLANGE_MM / 2, HOUSING_FLANGE_R_MM)) {
    contact = HOUSING_FLANGE_TOP_MM; // round the body, down onto the flange
  } else {
    contact = 0; // round the whole housing, down to the plate
  }
  return SLIDER_REST_MM + dropMM - contact;
}

/**
 * How far a cap can travel before any of its inside meets the housing: every ring of it from the
 * rim up to the inner ceiling, and the ceiling itself onto the housing's top.
 *
 * @param {object} o  the cap's outline at its rim (dimensions.js `capOutline`)
 * @param {{ ceilingMM: number, recessMM?: number, fromMM?: number }} at  the inner ceiling's
 *   height above the rim, how far the stem's bottom sits above the rim (a Stem recess), and where
 *   the walls now end above the rim (a Wall height shorter than the cap: nothing below it exists)
 * @returns {number} travel in mm
 */
export function capTravelMM(o, { ceilingMM, recessMM = 0, fromMM = 0 }) {
  const heights = [fromMM];
  if (RIM_FLARE_MM >= fromMM) heights.push(RIM_FLARE_MM);
  for (let z = 0; z < ceilingMM; z += SCAN_STEP_MM) if (z >= fromMM) heights.push(z);
  let travel = SLIDER_REST_MM + ceilingMM - recessMM - HOUSING_TOP_Z_MM;
  for (const z of heights) travel = Math.min(travel, travelBeforeContact(insideAt(o, z), z - recessMM));
  return travel;
}
