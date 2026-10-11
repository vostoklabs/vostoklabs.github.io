/**
 * The switch stems a generated cap stands on: the MX stem every generated shape uses, and the
 * low-profile `mx-lp` stem that replaces it on a Low profile cap.
 *
 * Both carry the SAME cross socket, cut as a through-hole of constant section over the stem's
 * whole height. That is what `applyStemClearance` (src/stemClearance.js) recognises as a socket
 * and widens in one offset, so the fit stepper moves a generated stem exactly as it moves the
 * owner's shipped ones. The socket outline is not drawn from nominal numbers: it is the owner's
 * own, sliced out of a shipped cap, so a generated cap grips a switch exactly as tightly.
 *
 * A stem is extruded from z = 0 and moved to its place; the caller decides where its bottom sits
 * (on the rim, or above it on a recessed one) and how tall it is.
 */
import { circleRing, roundedRectRing } from '@vostok/laser/rings';
import { csOf, extrude, withScope } from '@vostok/manifold';

/**
 * The MX cross socket, centred on the stem's axis. Sliced from the owner's Standard 1u stem
 * (public/keycaps/standard-profile/1u.json, its `stem` mesh) at z = 5, mid-height, with facets
 * under 0.02 mm simplified away: a plus 4.0386 x 4.0386 mm with bars 1.1938 mm wide (0.159 in by
 * 0.047 in), 8.217 mm² — the same 12 corners at every height of that stem, a through-hole.
 */
const MX_SOCKET_RING = [
  [-0.5969, -0.5969], [-2.0193, -0.5969], [-2.0193, 0.5969], [-0.5969, 0.5969],
  [-0.5969, 2.0193], [0.5969, 2.0193], [0.5969, 0.5969], [2.0193, 0.5969],
  [2.0193, -0.5969], [0.5969, -0.5969], [0.5969, -2.0193], [-0.5969, -2.0193],
];
/** The MX stem's round boss. Measured Ø5.512 (0.217 in) on the same stem; its vertices sit on
 *  r = 2.7559 at every height below the fillet where it meets the ceiling. */
export const MX_STEM_DIAMETER_MM = 5.512;
/** How far a stem runs on past the inner ceiling into the top plate, so stem and shell print as
 *  one part instead of two that merely touch. */
export const STEM_FUSE_MM = 0.3;
/**
 * The low-profile stem's boss is a plus, not a circle. Low-profile MX-cross switches (Gateron
 * KS-33 Low Profile 2.0, Kailh Choc v2) sit their cross inside a round cup that a Ø5.51
 * cylinder does not enter; a plus whose arm ends lie on a smaller circle can, and still
 * wraps every arm of the socket. The arm ends are arcs of that circle, not flat: flat ends would
 * leave 0.2 mm of wall past the socket's arm, the arcs leave 0.63 mm.
 */
export const LP_STEM_SPAN_MM = 5.3;
/** Width of each arm of the low-profile plus; the socket's 1.19 mm bar leaves 0.85 mm a side. */
export const LP_ARM_WIDTH_MM = 2.9;

/** Facets on a stem's round edge: on r = 2.76 a chord sags 0.003 mm, well under a nozzle. */
const STEM_SEGMENTS = 64;

/** One stem's cross-section at the origin. The caller owns it. */
function stemSection(api, kind, keep) {
  const socket = keep(csOf(api, [MX_SOCKET_RING], 'EvenOdd'));
  if (kind === 'mx') {
    return keep(csOf(api, [circleRing(0, 0, MX_STEM_DIAMETER_MM / 2, STEM_SEGMENTS)])).subtract(socket);
  }
  // Two bars, long enough to run past the circle, cut back to it: the plus with arc ends.
  const bar = LP_STEM_SPAN_MM + 1;
  const plus = keep(csOf(api, [roundedRectRing(bar, LP_ARM_WIDTH_MM, 0), roundedRectRing(LP_ARM_WIDTH_MM, bar, 0)], 'NonZero'));
  const reach = keep(csOf(api, [circleRing(0, 0, LP_STEM_SPAN_MM / 2, STEM_SEGMENTS)]));
  return keep(plus.intersect(reach)).subtract(socket);
}

/**
 * Stems of one kind at each centre, as one solid with a body per stem. The caller owns it.
 *
 * @param {object} api  the initialised Manifold module
 * @param {'mx'|'mx-lp'} kind
 * @param {[number, number][]} centres  stem axes in XY
 * @param {number} bottomZ  where the stems' bottoms sit
 * @param {number} height  how tall each stem is, socket included
 */
export function buildStems(api, kind, centres, bottomZ, height) {
  return withScope((keep) => {
    const one = keep(extrude(api, keep(stemSection(api, kind, keep)), height));
    return api.Manifold.union(centres.map(([x, y]) => keep(one.translate([x, y, bottomZ]))));
  });
}
