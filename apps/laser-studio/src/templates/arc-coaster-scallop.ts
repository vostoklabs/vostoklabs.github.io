// The scalloped rim: a ring of tangent circular bumps whose crests sit exactly on the disc's
// own radius. The ring is `@vostok/laser`'s scallopDiscRing, turned so a crest sits at 12
// o'clock; what is the coaster's own is the fit, from the disc's diameter and the bump it wants
// to a whole number of bumps. (The shelf's `scallop-disc` blank is not used: it fixes the count
// at 16 and sizes the disc from the bump alone, see arc-coaster.ts.)
import { scallopDiscRing, type Pt } from '@vostok/laser';

/**
 * A disc of `diameter` mm whose rim is `n` tangent bumps of about `bumpDia` mm, Y up, CCW,
 * centred on the origin, with a crest at 12 o'clock.
 *
 * `n` has to be a whole number or the ring closes on a half-scallop, and the bump radius is
 * what gives: solve `R = r (1 + 1/sin(π/n))` for `n`, round it, then solve the same equation
 * back for `r` — the usual "adjust the diameter slightly rather than leave a half-scallop"
 * rule, applied to the bump instead so the disc keeps the size the slider asked for.
 */
export function fitScallopRing(diameter: number, bumpDia: number): Pt[] {
  const R = Math.max(diameter, 1) / 2;
  const wanted = Math.min(Math.max(bumpDia / 2, 0.5), R * 0.45);
  const n = Math.max(8, Math.min(120, Math.round(Math.PI / Math.asin(Math.min(0.9, wanted / Math.max(R - wanted, 1e-6))))));
  const sin = Math.sin(Math.PI / n);
  const r = (sin * R) / (1 + sin);
  // A crest at 90° keeps the ribbon hole (which rests at 12 o'clock) on solid material.
  return scallopDiscRing(r, n, 10, Math.PI / 2);
}
