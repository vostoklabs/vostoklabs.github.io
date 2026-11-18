// Where things are on the picture window's preview, as plain numbers: no DOM.
//
// The Result view draws the traced rings on a square canvas, and a tap on that canvas has to land
// on the pixel of the picture the rings were traced from. The rings are normalised by the frame
// the tracer reports (`onFrame`: the artwork's centre and longest side in pixels), and drawn with
// the scale below, so one set of formulas does both: drawing (`resultScale`, `pictureToCanvas`)
// and tapping (`clientToPixel`).
import type { TraceFrame } from '@vostok/trace';
import type { RegionSet } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a `w` by `h` picture shown with `object-fit: contain` sits in a `boxW` by `boxH` box. */
export function containRect(boxW: number, boxH: number, imgW: number, imgH: number): Rect {
  if (!(boxW > 0 && boxH > 0 && imgW > 0 && imgH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const k = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Where the picture shows on a canvas drawn with `object-fit: contain`, in the coordinates of
 *  the canvas's positioned parent: the box the Original view lays the crop box over. `canvas` is
 *  the canvas's own place and size there (`offsetLeft`, `offsetTop`, `clientWidth`,
 *  `clientHeight`, none of which a zoom transform changes). */
export function pictureRect(
  canvas: { left: number; top: number; width: number; height: number },
  imgW: number,
  imgH: number,
): Rect {
  const r = containRect(canvas.width, canvas.height, imgW, imgH);
  return { x: canvas.left + r.x, y: canvas.top + r.y, w: r.w, h: r.h };
}

/** Canvas pixels per ring unit on a `w` by `h` Result canvas: the artwork's box fitted with a
 *  small margin. */
export function resultScale(set: Pick<RegionSet, 'aspect'>, w: number, h: number): number {
  const aspect = set.aspect || 1;
  const bw = aspect >= 1 ? 1 : aspect;
  const bh = aspect >= 1 ? 1 / aspect : 1;
  return 0.94 * Math.min(w / bw, h / bh);
}

/** The transform that draws the picture's own pixels under the traced rings on a `w` by `h`
 *  Result canvas: canvas = k * pixel + (dx, dy). A ring point is `((px - cx) / side,
 *  -(py - cy) / side)` and is drawn at `(w / 2 + x * scale, h / 2 - y * scale)`. */
export function pictureToCanvas(frame: Pick<TraceFrame, 'cx' | 'cy' | 'side'>, scale: number, w: number, h: number): { k: number; dx: number; dy: number } {
  const k = scale / frame.side;
  return { k, dx: w / 2 - frame.cx * k, dy: h / 2 - frame.cy * k };
}

/**
 * The picture pixel under a pointer, or null off the picture.
 *
 * `canvasRect` is the canvas's on-screen box (`getBoundingClientRect`, which already carries the
 * zoom and pan), `canvasW` by `canvasH` its own pixel size, drawn with `object-fit: contain`.
 */
export function clientToPixel(
  clientX: number,
  clientY: number,
  canvasRect: { left: number; top: number; width: number; height: number },
  canvasW: number,
  canvasH: number,
  frame: Pick<TraceFrame, 'cx' | 'cy' | 'side'>,
  scale: number,
  picture: { width: number; height: number },
): { px: number; py: number } | null {
  const shown = containRect(canvasRect.width, canvasRect.height, canvasW, canvasH);
  if (!shown.w || !shown.h) return null;
  const cx = ((clientX - canvasRect.left - shown.x) / shown.w) * canvasW;
  const cy = ((clientY - canvasRect.top - shown.y) / shown.h) * canvasH;
  // Beside the canvas is not on the picture, even where the picture runs on past its edge.
  if (cx < 0 || cy < 0 || cx >= canvasW || cy >= canvasH) return null;
  const t = pictureToCanvas(frame, scale, canvasW, canvasH);
  const px = Math.floor((cx - t.dx) / t.k);
  const py = Math.floor((cy - t.dy) / t.k);
  if (px < 0 || py < 0 || px >= picture.width || py >= picture.height) return null;
  return { px, py };
}

/** A pixel as the place an edit keeps: the fraction of the picture at its centre, 5 decimals. */
export function toFraction(px: number, py: number, w: number, h: number): { x: number; y: number } {
  const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
  return { x: round5((px + 0.5) / w), y: round5((py + 0.5) / h) };
}

/** The pixel a kept place points at: the one the tracer applies the edit to. */
export function pixelOfFraction(x: number, y: number, w: number, h: number): { px: number; py: number } {
  return {
    px: Math.min(w - 1, Math.max(0, Math.floor(x * w))),
    py: Math.min(h - 1, Math.max(0, Math.floor(y * h))),
  };
}
