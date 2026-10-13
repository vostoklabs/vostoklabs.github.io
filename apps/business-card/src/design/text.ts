// Lettering as shapes, set by its capital height, and kept printable.
//
// The text comes off the shelf ("Text to outlines", "Font metrics"); what is this product's own is
// the rule a 0.4 mm nozzle sets. A line is laid out ONCE with capitals 1 mm tall and scaled from
// there: letters, tracking and kerning all scale with the size, so the fit (lockup.ts) is
// arithmetic on boxes, never another layout per try.
import { getHorizontalContours } from '@vostok/fonts/textLayout';
import { faceMetrics } from '@vostok/fonts/metrics';
import { bboxOf, islandsFromContours, mapShapes, type Box, type Shapes } from '@vostok/shapes';

/** A parsed face, as `getFont()` hands it over. Parsed in main.ts: nothing here loads fonts. */
export type Face = Parameters<typeof getHorizontalContours>[0];

export interface Faces {
  main: Face;
  /** Drawn where the main face has no glyph (an "@" in a display face), or null. */
  fallback: Face | null;
}

export type TextCase = 'as-typed' | 'upper' | 'lower' | 'title';

export function applyCase(text: string, mode: TextCase): string {
  if (mode === 'upper') return text.toLocaleUpperCase();
  if (mode === 'lower') return text.toLocaleLowerCase();
  if (mode === 'title') return text.toLocaleLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
  return text;
}

/** A line of text with capitals 1 mm tall: its islands and its ink box. */
export interface UnitLine {
  shapes: Shapes;
  box: Box;
}

/** One line at a 1 mm cap height, its ink starting at x = 0, its baseline on y = 0 (so the
 *  capitals run from 0 to 1 whatever the line holds); null when blank. */
export function unitLine(faces: Faces, text: string, tracking: number): UnitLine | null {
  if (!text.trim()) return null;
  const size = 1 / faceMetrics(faces.main).cap;
  const layout = getHorizontalContours(faces.main, faces.fallback, text, '', size, 0, 0, 'left', 0, tracking, { baseline: true });
  const shapes = islandsFromContours(layout.contours);
  return shapes.length ? { shapes, box: bboxOf(shapes) } : null;
}

/** Shapes scaled by `k` about the origin, then moved by (dx, dy). */
export const scaleMove = (shapes: Shapes, k: number, dx: number, dy: number): Shapes =>
  mapShapes(shapes, ([x, y]) => [x * k + dx, y * k + dy]);

/**
 * The narrowest stroke the card's ink may have, mm. The bundled process lays 0.42 mm lines (0.5 on
 * the first layer), and its walls are Arachne's in our file (see export in main.ts), which prints a
 * single bead down to about this width. A flush card's ink is the first layer, laid wider and
 * squashed, so it gets a little more.
 */
export const MIN_STROKE = { raised: 0.5, flush: 0.55 } as const;

/** The most an outline is pushed out, mm a side. Past this a face is too thin for its size: the
 *  letters would fill in, and a bolder face or a bigger size is the honest fix. */
export const MAX_GROW = 0.15;

/**
 * How far to push lettering's outline out, mm a side, so its thinnest stroke reaches `minStroke`
 * at capitals `cap` mm tall. Most regular-weight faces draw strokes of about a tenth of their cap
 * height, under 0.3 mm at the card's detail size: thickened, every face in the library prints.
 */
export function growFor(face: Face, cap: number, minStroke: number): number {
  const stroke = faceMetrics(face).stroke * cap;
  return Math.max(0, Math.min(MAX_GROW, (minStroke - stroke) / 2));
}

/** True when even the most growth leaves the face's thinnest stroke under the floor at this size. */
export function tooThin(face: Face, cap: number, minStroke: number): boolean {
  return faceMetrics(face).stroke * cap + 2 * MAX_GROW < minStroke - 1e-6;
}
