// Trace per-color masks into normalized 2D rings using d3-contour (robust hole
// handling), then simplify. Output is normalized: longest silhouette side = 1,
// centered, Y-up. The worker scales by capWidthMm.
import { contours } from 'd3-contour';
import type { QuantizeResult } from './quantize';
import type { RegionSet, Ring, RGB } from '../types';

export function traceRegions(
  q: QuantizeResult,
  smoothing = 0.5,
  preserveDetail = true,
  /** Longest side of the FINISHED part, mm. Sets the smallest feature worth keeping. */
  designMm = 35,
): RegionSet {
  const { indices, width, height, palette } = q;

  // Foreground bbox (pixel space) for normalization.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (indices[y * width + x] >= 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!isFinite(minX)) {
    return { regions: [], outline: [], aspect: 1 };
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const maxSide = Math.max(bw, bh);
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;

  const norm = (p: [number, number]): [number, number] => [
    (p[0] - cx) / maxSide,
    -(p[1] - cy) / maxSide, // flip Y -> Y-up
  ];

  const contourGen = contours().size([width, height]).thresholds([0.5]);
  /*
    The smallest feature worth keeping — in MILLIMETRES of the finished part.

    This was `0.0002 * maxSide²`, a fraction of the source image's own pixel count, which has
    nothing to do with whether a feature can be printed. Two things went wrong with that.

    It deleted printable detail. Anything under the threshold is not merely dropped, it is
    ABSORBED into its neighbour by the `preserveDetail` pass below, so a hatch stroke does not
    leave a hole — it fills in solid. On line art that is most of the drawing: measured on a
    hatched samurai logo, 76 of 93 features gone, while 99.4% of pixels still "agreed" with
    the source and every area-based metric read fine. That is why it was never noticed.

    And it never moved with the part. The old constant works out to ~1.4% of the artwork's
    longest side, which on a 35 mm cap is ~0.5 mm — roughly right by accident. Print the same
    design at 80 mm and those features are over a millimetre wide, comfortably printable, and
    still deleted; print at 20 mm and genuinely unprintable ones survive.

    So: one nozzle width is the physical floor for a feature that can exist in plastic at all,
    and the threshold now follows `designMm`. At the default 35 mm cap this keeps about twice
    the detail the old constant did; at 80 mm, about ten times.
  */
  const MIN_FEATURE_MM = 0.4; // one 0.4 mm nozzle — a feature thinner than this cannot print
  const pxPerMm = maxSide / Math.max(1, designMm);
  const minRingArea = (MIN_FEATURE_MM * pxPerMm) * (MIN_FEATURE_MM * pxPerMm);
  const resampleStep = Math.max(0.5, maxSide / 900); // uniform contour spacing (px) - higher resolution
  /*
    Smoothing strength → Gaussian sigma, as a FRACTION of the artwork, not a pixel count.

    It used to be an absolute number of pixels, which only looked scale-independent because
    decode.ts upscaled everything small to a fixed 900px working resolution first. With that
    upscale gone (it was inventing colours — see decode.ts), an absolute sigma would smooth a
    323px drawing 3.4x harder than a 1100px one. Normalising at 1100 keeps every image that
    was already at or above the ceiling behaving exactly as before, and gives a small one the
    same relative smoothing it used to get from being blown up.
  */
  const REF_SIDE = 1100;
  const sm = Math.max(0, Math.min(1, smoothing));
  // 0 means 0. The base of 1.0px used to apply even at the slider's minimum, so there was no
  // way to ask for an unsmoothed contour; every other value is unchanged.
  const sigmaPx = sm <= 0 ? 0 : (1.0 + sm * 14) * (maxSide / REF_SIDE);
  const sigmaPts = sigmaPx <= 0 ? 0 : Math.max(0.6, sigmaPx / resampleStep);

  // Vector-style smoothing: the staircase boundary is resampled to uniform spacing
  // and Gaussian-smoothed as a 1-D closed curve (like a vectorizer). Brushy pixel
  // noise vanishes while real features (eyes, smile, thin strokes) stay intact —
  // unlike blurring the mask, which erases small features. Shared edges between
  // colors get identical input, so the regions stay gap-free.
  const componentsFromMask = (mask: Float64Array): Ring[][] => {
    const multi = contourGen(mask as unknown as number[])[0];
    const out: Ring[][] = [];
    for (const poly of multi.coordinates) {
      const compRings: Ring[] = [];
      for (const ring of poly) {
        const r = ring as [number, number][];
        const A = Math.abs(ringArea(r));
        if (A < minRingArea) continue;
        const sampled = resampleClosed(r, resampleStep);
        // Adaptive smoothing: the large outer silhouette keeps full sigma, but small
        // rings (letter counters, eyes) get up to ~4× less so their features survive
        // the same kernel that only lightly touches the silhouette.
        const featureScale = preserveDetail
          ? Math.max(0.25, Math.min(1.0, Math.sqrt(A) / (0.15 * maxSide)))
          : 1;
        const smooth = gaussianSmoothClosed(sampled, sigmaPts * featureScale);
        const simplified = rdp(smooth, resampleStep * 0.25); // higher resolution simplification
        if (simplified.length >= 3) compRings.push(simplified.map(norm));
      }
      if (compRings.length > 0) out.push(compRings);
    }
    return out;
  };

  /* --- Re-tile colors via blurred argmax, when there is a blur to argmax over. ---

     This rounds off the label map's staircase before anything is contoured. It only does
     anything above smoothing 0.25: `blurRad` is `smoothing * 2` and the blur is skipped
     under 0.5, so at the app's default of 0.1 there is no blur — and an argmax over
     unblurred 0/1 masks returns exactly the label the pixel already had. It used to build
     K full-size Float64Arrays to compute that copy. Now it copies. */
  const K = palette.length;
  const blurRad = smoothing * 2.0;
  const label = new Int16Array(width * height).fill(-1);
  if (blurRad >= 0.5) {
    const fields: Float64Array[] = [];
    for (let k = 0; k < K; k++) {
      const m = new Float64Array(width * height);
      for (let p = 0; p < indices.length; p++) if (indices[p] === k) m[p] = 1;
      fields.push(boxBlur(m, width, height, blurRad));
    }
    for (let p = 0; p < indices.length; p++) {
      if (indices[p] < 0) continue;
      let best = 0;
      let bestV = -1;
      for (let k = 0; k < K; k++) {
        const v = fields[k][p];
        if (v > bestV) {
          bestV = v;
          best = k;
        }
      }
      label[p] = best;
    }
  } else {
    label.set(indices);
  }

  // Minimum-feature absorption: instead of tracing (and later dropping) tiny color
  // specks — which leaves backing-color holes — reassign each below-threshold label
  // component to the majority label of its neighbours, so the speck merges into its
  // surround. Runs on the label map before contouring; the outline (all foreground)
  // is untouched so the silhouette is unaffected.
  if (preserveDetail) {
    const comp = new Int32Array(width * height).fill(-1);
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let s = 0; s < label.length; s++) {
      if (label[s] < 0 || comp[s] !== -1) continue;
      const lab = label[s];
      const id = sizes.length;
      let size = 0;
      comp[s] = id;
      stack.push(s);
      while (stack.length) {
        const p = stack.pop()!;
        size++;
        const x = p % width;
        const y = (p / width) | 0;
        if (x > 0 && label[p - 1] === lab && comp[p - 1] === -1) { comp[p - 1] = id; stack.push(p - 1); }
        if (x < width - 1 && label[p + 1] === lab && comp[p + 1] === -1) { comp[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && label[p - width] === lab && comp[p - width] === -1) { comp[p - width] = id; stack.push(p - width); }
        if (y < height - 1 && label[p + width] === lab && comp[p + width] === -1) { comp[p + width] = id; stack.push(p + width); }
      }
      sizes.push(size);
    }
    // Tally the labels bordering each small component, then reassign it wholesale to
    // the dominant neighbour (majority vote). Threshold = the ring-drop area, so any
    // speck that WOULD be dropped is instead absorbed.
    const votes = new Map<number, Map<number, number>>();
    const addVote = (id: number, l: number) => {
      let m = votes.get(id);
      if (!m) { m = new Map(); votes.set(id, m); }
      m.set(l, (m.get(l) ?? 0) + 1);
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const id = comp[p];
        if (id < 0 || sizes[id] >= minRingArea) continue;
        if (x > 0 && label[p - 1] >= 0 && comp[p - 1] !== id) addVote(id, label[p - 1]);
        if (x < width - 1 && label[p + 1] >= 0 && comp[p + 1] !== id) addVote(id, label[p + 1]);
        if (y > 0 && label[p - width] >= 0 && comp[p - width] !== id) addVote(id, label[p - width]);
        if (y < height - 1 && label[p + width] >= 0 && comp[p + width] !== id) addVote(id, label[p + width]);
      }
    }
    const winner = new Map<number, number>();
    for (const [id, m] of votes) {
      let bl = -1;
      let bv = -1;
      for (const [l, v] of m) if (v > bv) { bv = v; bl = l; }
      if (bl >= 0) winner.set(id, bl);
    }
    if (winner.size > 0) {
      for (let p = 0; p < label.length; p++) {
        const id = comp[p];
        if (id >= 0 && winner.has(id)) label[p] = winner.get(id)!;
      }
    }
  }

  // Per-color regions, traced from the smooth tiling.
  const regions: RegionSet['regions'] = [];
  for (let k = 0; k < K; k++) {
    const mask = new Float64Array(width * height);
    for (let p = 0; p < label.length; p++) mask[p] = label[p] === k ? 1 : 0;
    const components = componentsFromMask(mask).map(rings => ({ rings, coverage: palette[k].coverage }));
    if (components.length === 0) continue;
    regions.push({ quantRgb: palette[k].rgb as RGB, components, coverage: palette[k].coverage });
  }

  // Outline = all foreground. It's a single region (no adjacency gaps), so blur
  // it for an extra-smooth cap edge when smoothing is requested.
  const fgMask = new Float64Array(width * height);
  for (let p = 0; p < indices.length; p++) fgMask[p] = indices[p] >= 0 ? 1 : 0;
  const outlineMask = blurRad >= 0.5 ? boxBlur(fgMask, width, height, blurRad) : fgMask;
  const outline = componentsFromMask(outlineMask).flat();

  return { regions, outline, aspect: bw / bh };
}

/** Signed area of a polyline ring (shoelace). */
function ringArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

/** Separable box blur over a w×h field (radius in px, fractional ok). */
function boxBlur(src: Float64Array, w: number, h: number, radius: number): Float64Array {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  const norm = 1 / (2 * r + 1);
  // Horizontal pass.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + clampI(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * norm;
      sum += src[row + clampI(x + r + 1, 0, w - 1)] - src[row + clampI(x - r, 0, w - 1)];
    }
  }
  // Vertical pass.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clampI(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum * norm;
      sum += tmp[clampI(y + r + 1, 0, h - 1) * w + x] - tmp[clampI(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Drop a duplicate closing vertex if present. */
function openRing(points: [number, number][]): [number, number][] {
  if (
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
  ) {
    return points.slice(0, -1);
  }
  return points.slice();
}

/** Resample a closed ring to roughly uniform spacing (px) so smoothing is even. */
function resampleClosed(points: [number, number][], step: number): [number, number][] {
  const pts = openRing(points);
  if (pts.length < 3) return pts;
  // Perimeter.
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const count = Math.max(8, Math.round(perim / step));
  const spacing = perim / count;
  const out: [number, number][] = [];
  let i = 0;
  let acc = 0;
  let cur = pts[0];
  out.push([cur[0], cur[1]]);
  for (let k = 1; k < count; k++) {
    let target = k * spacing;
    while (i < pts.length) {
      const a = pts[i % pts.length];
      const b = pts[(i + 1) % pts.length];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      if (acc + seg >= target) {
        const t = (target - acc) / seg;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      acc += seg;
      i++;
    }
  }
  return out;
}

/** Gaussian smoothing of a closed ring (1-D convolution along the contour).
 *  `sigma` is in points; removes high-frequency boundary noise while keeping the
 *  overall shape and coherent features. */
function gaussianSmoothClosed(points: [number, number][], sigma: number): [number, number][] {
  const n = points.length;
  if (n < 5 || sigma < 0.3) return points;
  const radius = Math.max(1, Math.min(Math.ceil(sigma * 3), Math.floor((n - 1) / 2)));
  const kernel: number[] = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  const out: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let k = -radius; k <= radius; k++) {
      const p = points[((i + k) % n + n) % n];
      const w = kernel[k + radius];
      x += p[0] * w;
      y += p[1] * w;
    }
    out[i] = [x / sum, y / sum];
  }
  return out;
}

/** Ramer–Douglas–Peucker polyline simplification (closed ring aware). */
function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 4) return points;
  // Drop duplicate closing point if present.
  const pts =
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
      ? points.slice(0, -1)
      : points.slice();

  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const result: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) result.push(pts[i]);
  return result;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
