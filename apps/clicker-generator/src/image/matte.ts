// Background removal for uploads. Handles three cases with one flood-fill:
//   1) Opaque photo/clipart with a flat background  -> flood the border color.
//   2) PNG already cut out (alpha)                  -> just drop the transparent ring.
//   3) PNG with a transparent ring AROUND a baked solid matte (e.g. a logo on a
//      white box) -> flood through the ring INTO the matte, stopping at the
//      subject. This was the case the old code missed.
//
// A genuine cut-out subject (e.g. a circular face on transparency) is preserved:
// its opaque bounding-box corners are empty, so no matte is detected and only
// the transparent ring is removed.
import type { RgbaImage } from './decode';

const ALPHA_THRESHOLD = 128;

type RGB = [number, number, number];

export function removeBackground(img: RgbaImage, tol = 2000): RgbaImage {
  const { data, width: W, height: H } = img;
  const n = W * H;
  const isTransparent = (p: number) => data[p * 4 + 3] < ALPHA_THRESHOLD;
  const colorAt = (p: number): RGB => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
  const dist2 = (a: RGB, b: RGB) => {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  };

  // Generic border flood: mark pixels reachable from any edge for which pred() holds.
  // `maxDepth` limits how far (in Manhattan distance from the nearest border pixel) the
  // flood can penetrate. This prevents the fill from leaking through thin strokes deep
  // into the subject when the subject's interior color matches the background. A value
  // of 0 means unlimited depth (original behavior).
  const floodFromBorder = (pred: (p: number) => boolean, maxDepth = 0): Uint8Array => {
    const mask = new Uint8Array(n);
    const depth = maxDepth > 0 ? new Uint16Array(n) : null;
    const stack: number[] = [];
    const push = (p: number, d: number) => {
      if (!mask[p] && pred(p)) {
        if (depth && d > maxDepth) return;
        mask[p] = 1;
        if (depth) depth[p] = d;
        stack.push(p);
      }
    };
    for (let x = 0; x < W; x++) {
      push(x, 1);
      push((H - 1) * W + x, 1);
    }
    for (let y = 0; y < H; y++) {
      push(y * W, 1);
      push(y * W + W - 1, 1);
    }
    while (stack.length) {
      const p = stack.pop()!;
      const d = depth ? depth[p] + 1 : 0;
      const x = p % W;
      const y = (p / W) | 0;
      if (x > 0) push(p - 1, d);
      if (x < W - 1) push(p + 1, d);
      if (y > 0) push(p - W, d);
      if (y < H - 1) push(p + W, d);
    }
    return mask;
  };

  let hadAlpha = 0;
  for (let p = 0; p < n; p++) if (isTransparent(p)) hadAlpha++;
  const isCutout = hadAlpha > n * 0.02;

  // Bounding box of the opaque content NOT connected to the border by transparency.
  const transRing = isCutout ? floodFromBorder(isTransparent) : new Uint8Array(n);
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!transRing[p] && !isTransparent(p)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Detect a solid matte: the four corners of the opaque bbox (or the whole image
  // when fully opaque) must be opaque and mutually similar.
  let matte: RGB | null = null;
  if (maxX >= minX) {
    const corners = [
      [minX, minY],
      [maxX, minY],
      [minX, maxY],
      [maxX, maxY],
    ].map(([x, y]) => y * W + x);
    if (corners.every((p) => !isTransparent(p))) {
      const cs = corners.map(colorAt);
      const uniform = cs.every((c) => dist2(c, cs[0]) <= tol * 3);
      if (uniform) {
        matte = [
          (cs[0][0] + cs[1][0] + cs[2][0] + cs[3][0]) / 4,
          (cs[0][1] + cs[1][1] + cs[2][1] + cs[3][1]) / 4,
          (cs[0][2] + cs[1][2] + cs[2][2] + cs[3][2]) / 4,
        ];
      }
    }
  }

  // Final flood: a pixel is background if it's transparent OR (matte detected and
  // similar to the matte color), reachable from the border.
  const bg = floodFromBorder(
    (p) => isTransparent(p) || (matte !== null && dist2(colorAt(p), matte) <= tol)
  );

  for (let p = 0; p < n; p++) if (bg[p]) data[p * 4 + 3] = 0;
  return img;
}

/** Composite semi-transparent pixels over a matte color so anti-aliased edges keep
 *  clean colors (kills the fringe/halo ring left by soft edges). Alpha is preserved —
 *  the foreground mask is derived separately, this only cleans the RGB. */
export function compositeOverMatte(img: RgbaImage, matte?: RGB): RgbaImage {
  const { data, width: W, height: H } = img;
  const n = W * H;

  let m = matte;
  if (!m) {
    // Auto-pick: an opaque image has no real background left after removal, so its
    // soft pixels came from JPEG-style edges → matte = the average border color.
    // A cut-out (has transparency) sits on true transparent bg → matte = white.
    let transparent = 0;
    for (let p = 0; p < n; p++) if (data[p * 4 + 3] < 255) transparent++;
    if (transparent < n * 0.01) {
      let r = 0, g = 0, b = 0, c = 0;
      const add = (p: number) => { r += data[p * 4]; g += data[p * 4 + 1]; b += data[p * 4 + 2]; c++; };
      for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); }
      for (let y = 0; y < H; y++) { add(y * W); add(y * W + W - 1); }
      m = c > 0 ? [r / c, g / c, b / c] : [255, 255, 255];
    } else {
      m = [255, 255, 255];
    }
  }
  const [mr, mg, mb] = m;
  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3];
    if (a > 0 && a < 255) {
      const f = a / 255;
      data[p * 4] = data[p * 4] * f + mr * (1 - f);
      data[p * 4 + 1] = data[p * 4 + 1] * f + mg * (1 - f);
      data[p * 4 + 2] = data[p * 4 + 2] * f + mb * (1 - f);
    }
  }
  return img;
}

/** Morphological cleanup of the alpha mask (binarized at 128): despeckle + fill
 *  pinholes so noise never becomes tiny stray rings.
 *   - drop foreground islands smaller than `minIslandPx`
 *   - fill enclosed background holes smaller than `minHolePx`
 *   - one binary close (3×3) to seal 1px cracks in strokes
 *  Pixel thresholds scale with resolution so behavior is size-independent. */
export function cleanMask(img: RgbaImage, minIslandPx = 24, minHolePx = 24): RgbaImage {
  const { data, width: W, height: H } = img;
  const n = W * H;
  const scale = Math.max(0.25, (W * H) / 1e6);
  const minIsland = minIslandPx * scale;
  const minHole = minHolePx * scale;
  const THRESH = 128;

  const fg = new Uint8Array(n);
  for (let p = 0; p < n; p++) fg[p] = data[p * 4 + 3] >= THRESH ? 1 : 0;

  // 4-connected components over a binary field, tracking size + whether the
  // component touches the image border (border-touching bg = the true background).
  const components = (field: Uint8Array, want: number) => {
    const comp = new Int32Array(n).fill(-1);
    const sizes: number[] = [];
    const touches: boolean[] = [];
    const stack: number[] = [];
    for (let start = 0; start < n; start++) {
      if (field[start] !== want || comp[start] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      let border = false;
      comp[start] = id;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop()!;
        size++;
        const x = p % W;
        const y = (p / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        if (x > 0 && field[p - 1] === want && comp[p - 1] === -1) { comp[p - 1] = id; stack.push(p - 1); }
        if (x < W - 1 && field[p + 1] === want && comp[p + 1] === -1) { comp[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && field[p - W] === want && comp[p - W] === -1) { comp[p - W] = id; stack.push(p - W); }
        if (y < H - 1 && field[p + W] === want && comp[p + W] === -1) { comp[p + W] = id; stack.push(p + W); }
      }
      sizes.push(size);
      touches.push(border);
    }
    return { comp, sizes, touches };
  };

  // Drop small foreground islands (specks).
  const fgc = components(fg, 1);
  for (let p = 0; p < n; p++) {
    const id = fgc.comp[p];
    if (id >= 0 && fgc.sizes[id] < minIsland) fg[p] = 0;
  }
  // Fill small enclosed background holes (pinholes that don't touch the border).
  const bgc = components(fg, 0);
  for (let p = 0; p < n; p++) {
    const id = bgc.comp[p];
    if (id >= 0 && !bgc.touches[id] && bgc.sizes[id] < minHole) fg[p] = 1;
  }

  // Binary close: dilate then erode (3×3) to seal 1px cracks. Out-of-bounds is
  // treated as "no vote" so the image border is neither grown nor eaten.
  const dil = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let v = fg[p];
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1 && !v; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && fg[ny * W + nx]) v = 1;
        }
      }
      dil[p] = v;
    }
  }
  const closed = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let v = dil[p];
      for (let dy = -1; dy <= 1 && v; dy++) {
        for (let dx = -1; dx <= 1 && v; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; // border: don't erode
          if (!dil[ny * W + nx]) v = 0;
        }
      }
      closed[p] = v;
    }
  }

  for (let p = 0; p < n; p++) {
    if (closed[p]) {
      if (data[p * 4 + 3] < THRESH) data[p * 4 + 3] = 255;
    } else if (data[p * 4 + 3] >= THRESH) {
      data[p * 4 + 3] = 0;
    }
  }
  return img;
}
