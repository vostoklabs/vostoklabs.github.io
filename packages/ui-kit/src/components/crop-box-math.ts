/*
  The maths of `cropBox()`, kept apart so it runs in node without a document.

  A crop is a box in fractions of the picture: x and y its top-left corner, w and h its size, all
  0..1. A drag pulls one grip (a corner, an edge, or the whole box) by a distance also in
  fractions of the picture. The box never leaves the picture, never gets smaller than the minimum
  on either side, and never turns inside out: an edge pulled past the opposite one stops at the
  minimum instead.
*/

/** A crop, in fractions of the picture: 0..1 on both axes, top-left origin. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a press can pull: a corner (`nw`…), an edge (`n`, `e`, `s`, `w`), or the whole box. */
export type CropGrip = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

/** The eight grips in reading order round the box, starting top left. */
export const CROP_GRIPS: readonly Exclude<CropGrip, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** The whole picture. */
export const FULL_CROP: Readonly<CropRect> = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A box made safe: finite, inside the picture, each side at least `min` (or the whole side when
 * `min` is more than 1). Anything that is not a number reads as the whole picture.
 */
export function clampCrop(box: CropRect, min = 0): CropRect {
  const m = clamp(min, 0, 1);
  const ok = (v: number) => typeof v === 'number' && Number.isFinite(v);
  if (![box.x, box.y, box.w, box.h].every(ok)) return { ...FULL_CROP };
  const w = clamp(box.w, m, 1);
  const h = clamp(box.h, m, 1);
  return { x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h), w, h };
}

/**
 * The box after pulling `grip` by (dx, dy), fractions of the picture, +y down. Always worked out
 * from the box the drag started with, so a drag that goes out and comes back lands where it began.
 */
export function dragCrop(box: CropRect, grip: CropGrip, dx: number, dy: number, min = 0): CropRect {
  const b = clampCrop(box, 0);
  // A box already under the minimum keeps its size rather than jumping up to it.
  const minW = Math.min(clamp(min, 0, 1), b.w);
  const minH = Math.min(clamp(min, 0, 1), b.h);
  if (grip === 'move') {
    return { x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h), w: b.w, h: b.h };
  }
  let left = b.x;
  let right = b.x + b.w;
  let top = b.y;
  let bottom = b.y + b.h;
  if (grip.includes('w')) left = clamp(left + dx, 0, right - minW);
  if (grip.includes('e')) right = clamp(right + dx, left + minW, 1);
  if (grip.includes('n')) top = clamp(top + dy, 0, bottom - minH);
  if (grip.includes('s')) bottom = clamp(bottom + dy, top + minH, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The whole box moved by (dx, dy), stopping at the picture's edges. */
export function nudgeCrop(box: CropRect, dx: number, dy: number): CropRect {
  return dragCrop(box, 'move', dx, dy);
}

/** True when two boxes are the same to within `eps` on every side. */
export function sameCrop(a: CropRect, b: CropRect, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.w - b.w) <= eps && Math.abs(a.h - b.h) <= eps;
}
