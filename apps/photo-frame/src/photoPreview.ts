/*
  The sample picture in the preview: a flat card showing a photo where the print sits in the
  frame, the holder or the plaque, so the customer sees a picture rather than a blank. It is a
  viewer part like any other, drawn with the picture (`ViewerPart.uv` and `texture`), and is never
  put in an export.
*/
import type { ViewerPart } from '@vostok/viewer';

type Vec3 = [number, number, number];

/**
 * The part of a picture that covers a rectangle of aspect `rectAspect` (width / height) without
 * stretching, as CSS object-fit: cover crops it: all of the picture one way and its middle the
 * other. u runs 0 to 1 across the picture from left to right, v from bottom to top.
 */
export function coverUv(rectAspect: number, imageAspect: number): { u0: number; u1: number; v0: number; v1: number } {
  if (rectAspect < imageAspect) {
    // Narrower than the picture: its whole height, the middle of its width.
    const w = rectAspect / imageAspect;
    return { u0: 0.5 - w / 2, u1: 0.5 + w / 2, v0: 0, v1: 1 };
  }
  // Wider: its whole width, the middle of its height.
  const h = imageAspect / rectAspect;
  return { u0: 0, u1: 1, v0: 0.5 - h / 2, v1: 0.5 + h / 2 };
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * A flat quad showing `image` cropped to cover the rectangle (like CSS object-fit: cover, centred).
 * The corners go bottom-left, bottom-right, top-right, top-left as the customer sees them, looking
 * at the picture: from that side it reads upright and not mirrored, and the quad faces that way.
 * From behind it shows mirrored, as a print does through its back. `image` must be ready to draw
 * (`samplePhotoImage` resolves with one that is).
 */
export function photoPart(corners: [Vec3, Vec3, Vec3, Vec3], image: HTMLImageElement | HTMLCanvasElement, name = 'photo'): ViewerPart {
  const [c0, c1, c2, c3] = corners;
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const { u0, u1, v0, v1 } = coverUv(distance(c0, c1) / distance(c0, c3), width / height);
  return {
    name,
    positions: new Float32Array([...c0, ...c1, ...c2, ...c3]),
    // Counter-clockwise as the customer sees them, so the front face is theirs.
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    uv: new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]),
    texture: image,
    color: [255, 255, 255],
  };
}
