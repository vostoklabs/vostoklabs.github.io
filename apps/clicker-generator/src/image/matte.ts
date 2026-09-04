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

/** Strips the background in place. Returns the colour the artwork's rim was blended against:
 *  the matte it flooded away, or for a cut-out the best estimate of the background it was cut
 *  from (see the end of the function). Null only when the image had no background at all. The
 *  quantiser wants it: a fringe pixel on the outer rim of an outline is a blend of ink and THIS
 *  colour, and it can only be read correctly as ink if the colour is known. */
export function removeBackground(img: RgbaImage, tol = 2000): RGB | null {
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

  /* Generic border flood: mark pixels reachable from any edge for which pred() holds.

     This used to carry a `maxDepth` parameter, documented as stopping the fill from leaking
     through thin strokes deep into a subject whose interior matches the background. Neither
     call site ever passed it, so the depth limit has never once executed and the protection
     described did not exist. Removed rather than switched on: turning it on would change
     background removal for every image, and there is no failing case on hand to pick a depth
     against. If a leak does turn up, that is the place to put it back. */
  const floodFromBorder = (pred: (p: number) => boolean): Uint8Array => {
    const mask = new Uint8Array(n);
    const stack: number[] = [];
    const push = (p: number) => {
      if (!mask[p] && pred(p)) {
        mask[p] = 1;
        stack.push(p);
      }
    };
    for (let x = 0; x < W; x++) {
      push(x);
      push((H - 1) * W + x);
    }
    for (let y = 0; y < H; y++) {
      push(y * W);
      push(y * W + W - 1);
    }
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p / W) | 0;
      if (x > 0) push(p - 1);
      if (x < W - 1) push(p + 1);
      if (y > 0) push(p - W);
      if (y < H - 1) push(p + W);
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

  /*
    Detect a solid matte from the whole perimeter of the opaque bbox, not from its corners.

    This used to sample exactly four pixels — the bbox corners — and require all four to be
    opaque and mutually similar. Four samples is a single-pixel failure mode in both
    directions: one JPEG-speckled corner and background removal silently does not happen,
    while a design whose bbox corners happen to sit on the artwork gets the artwork's own
    colour flooded away.

    The perimeter is a few thousand pixels instead. A matte is declared when most of them are
    opaque AND most of those agree with their median, which is the same judgement the corner
    test was trying to make, with enough samples that no single pixel decides it. The genuine
    cut-out case still falls through exactly as before: a round subject on transparency has a
    mostly-transparent bbox perimeter, so no matte is found and only the transparent ring goes.
  */
  let matte: RGB | null = null;
  if (maxX >= minX) {
    const perimeter: number[] = [];
    for (let x = minX; x <= maxX; x++) {
      perimeter.push(minY * W + x);
      perimeter.push(maxY * W + x);
    }
    for (let y = minY + 1; y < maxY; y++) {
      perimeter.push(y * W + minX);
      perimeter.push(y * W + maxX);
    }
    const opaque = perimeter.filter((p) => !isTransparent(p));
    if (opaque.length >= perimeter.length * 0.75 && opaque.length > 0) {
      const median = (ch: number) => {
        const v = opaque.map((p) => data[p * 4 + ch]).sort((a, b) => a - b);
        return v[v.length >> 1];
      };
      const med: RGB = [median(0), median(1), median(2)];
      const agree = opaque.filter((p) => dist2(colorAt(p), med) <= tol).length;
      if (agree >= opaque.length * 0.75) matte = med;
    }
  }

  // Final flood: a pixel is background if it's transparent OR (matte detected and
  // similar to the matte color), reachable from the border.
  const bg = floodFromBorder(
    (p) => isTransparent(p) || (matte !== null && dist2(colorAt(p), matte) <= tol)
  );

  /* Opaque matte goes to zero. A pixel that was ALREADY under the threshold keeps its partial
     alpha: on a cut-out that value is the anti-aliasing of the silhouette (measured on the
     pumpkin: 14, 107, 214, 248 across the edge), and the tracer reads it to place the outline
     between pixels rather than on one. It is still background — everything downstream
     thresholds alpha at 128. */
  for (let p = 0; p < n; p++) if (bg[p] && !isTransparent(p)) data[p * 4 + 3] = 0;
  if (matte) return matte;

  /*
    A cut-out has no matte to detect, but its rim was still blended with SOMETHING before the
    background was cut away — an exported PNG keeps that blend baked into the opaque pixels
    along the silhouette (measured on the potion: dark grey, alpha 255, a one-pixel ring
    outside the black outline). The best available witness to what that something was is the
    colour the file stores UNDER its transparent pixels: most tools leave the original
    background there. Zeroed RGB (the classic "0,0,0,0") says nothing, and then white — the
    background of nearly every logo ever cut out — is the default.
  */
  if (!isCutout) return null;
  const r: number[] = [], g: number[] = [], b: number[] = [];
  for (let p = 0; p < n; p += 7) { // every 7th pixel is plenty for a median
    if (!transRing[p]) continue;
    r.push(data[p * 4]); g.push(data[p * 4 + 1]); b.push(data[p * 4 + 2]);
  }
  if (r.length === 0) return [255, 255, 255];
  const med = (v: number[]) => v.sort((x, y) => x - y)[v.length >> 1];
  const under: RGB = [med(r), med(g), med(b)];
  return under[0] + under[1] + under[2] === 0 ? [255, 255, 255] : under;
}

/**
 * Clean the RGB of soft (anti-aliased) pixels so the quantizer never sees a fringe colour.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WRONG.
 * It composited every soft pixel over a matte colour, and for any image with transparency
 * that matte was hardcoded WHITE. Measured across the sample set, that moved 17-19% of all
 * pixels, 100% of them toward white, by a mean of 4-5/255. On artwork whose colours are far
 * apart it is harmless; on the bat, whose outline (#000000) and body (#222224) are 34 steps
 * apart, a uniform nudge toward white is enough to flip labels back and forth along the
 * seam — 91 -> 189 components and 62 -> 160 specks, which is the ragged outline ring.
 *
 * It is also wrong in principle. A correctly authored cut-out already stores the pure ink
 * colour in RGB and keeps the softness in alpha, so compositing it over a background that
 * is not there corrupts a colour that was already right. And an OPAQUE image has no soft
 * pixels at all by this point (background removal sets alpha to exactly 0, never a partial
 * value), so the white-matte branch was the only one that ever ran.
 *
 * WHAT IT DOES NOW.
 * A soft pixel's colour is replaced by its nearest FULLY OPAQUE neighbour's — the artwork's
 * own colour at that spot. That still does the job the function exists for (a fringe pixel
 * contaminated by whatever used to sit behind it gets a clean colour) without pulling
 * anything toward a white that is not in the drawing. An explicit `matte` is still honoured
 * for callers that genuinely want a known background, and a soft pixel with no opaque
 * neighbour within `R` falls back to it.
 */
export function compositeOverMatte(img: RgbaImage, matte?: RGB): RgbaImage {
  const { data, width: W, height: H } = img;
  const n = W * H;
  const R = 4; // an anti-aliased band is 1-2px; 4 covers a soft edge on a downscaled photo

  const opaque = new Uint8Array(n);
  for (let p = 0; p < n; p++) opaque[p] = data[p * 4 + 3] === 255 ? 1 : 0;

  const fallback: RGB = matte ?? [255, 255, 255];
  const out = new Uint8ClampedArray(data.length);
  out.set(data);

  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3];
    if (a === 0 || a === 255) continue;
    const x = p % W;
    const y = (p / W) | 0;
    // Expanding square rings, so the first hit is the nearest opaque pixel.
    let found = -1;
    for (let r = 1; r <= R && found < 0; r++) {
      for (let dy = -r; dy <= r && found < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const q = ny * W + nx;
          if (opaque[q]) { found = q; break; }
        }
      }
    }
    if (found >= 0) {
      out[p * 4] = data[found * 4];
      out[p * 4 + 1] = data[found * 4 + 1];
      out[p * 4 + 2] = data[found * 4 + 2];
    } else {
      const f = a / 255;
      out[p * 4] = data[p * 4] * f + fallback[0] * (1 - f);
      out[p * 4 + 1] = data[p * 4 + 1] * f + fallback[1] * (1 - f);
      out[p * 4 + 2] = data[p * 4 + 2] * f + fallback[2] * (1 - f);
    }
  }
  data.set(out);
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
