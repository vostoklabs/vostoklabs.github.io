// A picture that keeps its size when the shape changes. Normally the picture is a share of the
// room inside the frame (Design size), so it follows the shape's size. Held, it is a length in
// millimetres instead, and the frame crops it where it runs past. The build, the Design view and
// the controls all read these, so none of them can reach a size another refuses.

import { DESIGN_SCALE_MIN } from './sizeLimits';

/** How far past the frame a held picture may run, as a share of the room it would fill. A 70 mm
 *  picture on a shape shrunk to an 8 mm fit is 8.75; 16 stays well under the plate's limits. */
export const HOLD_SCALE_MAX = 16;

/** The size a held picture builds at, mm: `artMm`, kept between the smallest Design size and
 *  HOLD_SCALE_MAX of `fitMm` (what the picture would be at Design size 100 %). Inside that range
 *  it is `artMm` itself, unchanged, so a held size builds exactly the picture it was taken from. */
export const heldArtMm = (artMm: number, fitMm: number): number =>
  Math.min(HOLD_SCALE_MAX * fitMm, Math.max(DESIGN_SCALE_MIN * fitMm, artMm));

/** The Design size a held picture amounts to on a shape whose picture would be `fitMm` at 100 %.
 *  1 while no build has said what fits (`fitMm` not above 0). */
export const holdScale = (artMm: number, fitMm: number): number =>
  fitMm > 0 ? heldArtMm(artMm, fitMm) / fitMm : 1;

/** A Design size as the Design view hands one back after a drag or a nudge: to 0.01. A move or
 *  a turn of a held picture returns exactly `roundShare(holdScale(..))`, which is how the app
 *  tells it apart from a resize and keeps the held millimetres from creeping. */
export const roundShare = (k: number): number => Math.round(k * 100) / 100;

/** The held size for a Design size, mm, to 0.01. `null` while no build has said what fits:
 *  keep the size already held. */
export function holdMm(scale: number, fitMm: number): number | null {
  if (!(fitMm > 0) || !Number.isFinite(scale)) return null;
  const k = Math.min(HOLD_SCALE_MAX, Math.max(DESIGN_SCALE_MIN, scale));
  return Math.round(k * fitMm * 100) / 100;
}

/** The size the tracer is told the picture prints at, mm. Following, it is what it always was,
 *  Size times Design size, so a project traces as it did; held, it is the held size. */
export const pictureMmOf = (s: { artMm?: number | null; capWidthMm: number; designScale?: number }): number =>
  s.artMm != null && s.artMm > 0 ? s.artMm : s.capWidthMm * (s.designScale ?? 1);
