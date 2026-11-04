// How small and how large the picture may be on a shaped base, as a share of the room inside the
// frame: Design size, and Text size in Text mode. The sliders, the Design view's corner, the build
// and a project opening all read these, so none of them can reach a size another refuses.

/** The smallest Design size: a picture about 3 mm across on a 35 mm clicker. At half that, the
 *  sample picture keeps under half of itself once the lines too thin to print are out. */
export const DESIGN_SCALE_MIN = 0.1;

/** The largest Design size. Past 1 the frame crops the picture, which is how its middle is
 *  zoomed into; at 2 only the middle half of it still shows. */
export const DESIGN_SCALE_MAX = 2;

/** Design size below this is checked for lines too thin to print. It was the smallest size
 *  before smaller ones were allowed, so every design possible then builds exactly as it did. */
export const DESIGN_SCALE_CHECKED_BELOW = 0.3;

/** Text size's floor: the same share in Text mode, where the picture is the letters. It stops
 *  higher, and the Design view's corner stops with it there. */
export const TEXT_SCALE_MIN = 0.5;

/** A Design size held inside the range. Not a number stays as it is, for the caller to default. */
export const clampDesignScale = (v: number): number =>
  Math.min(DESIGN_SCALE_MAX, Math.max(DESIGN_SCALE_MIN, v));
