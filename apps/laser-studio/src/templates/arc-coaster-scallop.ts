// The scalloped rim: a ring of tangent circular bumps whose crests sit exactly on the disc's
// own radius — centres on a hinge circle `R_c = r / sin(π/n)`, each bump an arc of radius
// `r` swept between its two tangency points with its neighbours.
//
// It lives here rather than in `packages/laser`'s BLANKS because that package is shared
// territory; `arc-coaster.ts` prefers `blankById('scallop-disc')` the moment the shared blank
// lands and falls back to this. Lifting it is a copy of one function.
import type { Pt } from '@vostok/laser';

/**
 * A disc of `diameter` mm whose rim is `n` tangent bumps of about `bumpDia` mm, Y up, CCW,
 * centred on the origin, with a crest at 12 o'clock.
 *
 * `n` has to be a whole number or the ring closes on a half-scallop, and the bump radius is
 * what gives: solve `R = r (1 + 1/sin(π/n))` for `n`, round it, then solve the same equation
 * back for `r` — the usual "adjust the diameter slightly rather than leave a half-scallop"
 * rule, applied to the bump instead so the disc keeps the size the slider asked for.
 */
export function scallopDiscRing(diameter: number, bumpDia: number): Pt[] {
  const R = Math.max(diameter, 1) / 2;
  const wanted = Math.min(Math.max(bumpDia / 2, 0.5), R * 0.45);
  const n = Math.max(8, Math.min(120, Math.round(Math.PI / Math.asin(Math.min(0.9, wanted / Math.max(R - wanted, 1e-6))))));
  const sin = Math.sin(Math.PI / n);
  const r = (sin * R) / (1 + sin);
  const hinge = r / sin;
  const ring: Pt[] = [];
  const steps = 10;
  for (let k = 0; k < n; k++) {
    // A crest at 90° keeps the ribbon hole (which rests at 12 o'clock) on solid material.
    const theta = Math.PI / 2 + (2 * Math.PI * k) / n;
    const cx = hinge * Math.cos(theta);
    const cy = hinge * Math.sin(theta);
    // The tangency points with the neighbouring bumps are a quarter turn plus half a bump
    // either side of the outward direction, so each visible arc is a little over a semicircle.
    const from = theta - Math.PI / 2 - Math.PI / n;
    const sweep = Math.PI + (2 * Math.PI) / n;
    for (let i = 0; i < steps; i++) {
      const a = from + (sweep * i) / steps;
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return ring;
}
