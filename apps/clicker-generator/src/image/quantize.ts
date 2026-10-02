// Perceptual color quantization over the foreground pixels: median-cut seed refined
// by k-means in Oklab, so perceptually distinct colors stay separate (dark blue vs
// black) and identical ones don't split. See src/image/colorspace.ts.
import type { RgbaImage } from './decode';
import type { RGB } from '../types';
import { srgbToOklab, oklabToSrgb } from './colorspace';

export interface QuantizeResult {
  palette: { rgb: RGB; coverage: number }[];
  /** Per-pixel palette index, or -1 for background. Length = width*height. */
  indices: Int16Array;
  /** How much of each pixel belongs to its label, 0.5..1 (0 for background). A flat pixel is 1;
   *  an anti-aliased one is however far it leans toward its own side of the edge. The tracer
   *  contours this instead of the hard label, which is what puts the boundary at its true
   *  sub-pixel position rather than on a one-pixel staircase. Length = width*height. */
  soft: Float32Array;
  /** The palette index on the OTHER side of the edge a soft pixel sits on, or -1 (flat pixel,
   *  or an edge against the removed background). Its share is `1 - soft`, so the two fields
   *  either side of a boundary sum to one and contour to the same line. */
  other: Int16Array;
  width: number;
  height: number;
}

interface Box {
  pixels: number[]; // indices into the foreground arrays
}

// Soft anti-aliased edge pixels (alpha below this) are dropped from the model. Lowered
// from 170 to 128 now that compositeOverMatte cleans fringe colors before this runs —
// 170 eroded ~1px off anti-aliased glyphs (thin text vanished); 128 keeps the strokes
// and the composited matte removes the halo the higher cutoff used to paper over.
const ALPHA_THRESHOLD = 128;
const KMEANS_ITERS = 6;

/*
  The two numbers that stop anti-aliasing from eating the palette.

  ## The bug they fix

  k-means models every foreground pixel as a COLOUR. An anti-aliased pixel is not a colour, it
  is a mixture of the two either side of an edge — and there is one of them along every edge in
  the drawing, so there are a lot. Ask for four colours from a black-on-white line drawing and
  two of the four get fitted to the grey ramp between the black and the white. Those two then
  become filaments, and because they are a one-pixel band tracking every contour, they trace
  into thousands of slivers.

  Measured on the artwork that reported this, at colourCount 4, counting connected components
  in the label map:

    ghost.png    16,013 components  ->    509
    skull.png     4,138             ->    604
    web.png       1,810             ->    148
    pumpkin       1,521             ->    631
    dog.png       6,645             ->  3,438   (a bundled sample, for regression)
    radiation     9,723             ->    785   (ditto)

  ## EDGE_GRAD — what counts as an edge

  The largest Oklab distance from a pixel to its four neighbours. 0.04 is about a tenth of the
  black-to-white span, so it catches every real boundary while leaving the interior of a soft
  gradient alone — on the five Halloween files it marks 7.6% to 31% of the foreground, which is
  what a one-to-two-pixel band round every contour should be. Push it much lower and flat noise
  starts registering as edges, which starves the model; much higher and a low-contrast boundary
  (grey on white) stops being seen as one.

  ## MERGE_TOL — when two centres are the same colour

  k-means always returns K clusters, even when the image does not contain K distinguishable
  colours. The ghost's three centres were 0,0,0 / 254,254,254 / 255,255,255: the last two differ
  by 0.003 in Oklab, and splitting a flat white body between two filaments is exactly the blue
  speckle that was reported. Anything closer than 0.04 is merged.

  0.04 and not more: at 0.08 the bundled cheese sample loses its genuine highlight (250,202,37
  merges into 240,180,5). At 0.02 the pumpkin keeps two near-blacks it should not. The margin is
  narrow on purpose — the point is to merge what is indistinguishable, not to posterise.
*/
const EDGE_GRAD = 0.04;
const MERGE_TOL = 0.04;
/** The channel-space half of the merge test — see `mergeCentres` for why Oklab alone fails. */
const MERGE_RGB = 8;

/*
  Below this share of flat pixels, do not fit the palette to interiors only.

  A photograph is edges everywhere: there is no flat interior to model, and fitting to the
  little there is would produce a palette drawn from whatever happened to be smooth — a patch of
  sky, a blurred background. 25% is well under every piece of flat art measured (the worst was
  69% flat) and well over a photograph. Merging still applies in that case; merging two
  indistinguishable centres is right whatever the image is.
*/
const MIN_FLAT_FRACTION = 0.25;

/**
 * Which foreground pixels sit on a boundary.
 *
 * The largest Oklab step to a 4-neighbour. A transparent neighbour counts as maximally
 * different, because the outside of the artwork is a boundary too — that band is where the
 * coloured halo round a cut-out comes from.
 */
function edgePixels(img: RgbaImage, okL: Float32Array, okA: Float32Array, okB: Float32Array,
                    fgPixel: number[], indexOfPixel: Int32Array): Uint8Array {
  const { data, width, height } = img;
  const isEdge = new Uint8Array(fgPixel.length);
  for (let i = 0; i < fgPixel.length; i++) {
    const p = fgPixel[i];
    const x = p % width;
    const y = (p / width) | 0;
    let worst = 0;
    const test = (q: number) => {
      const j = indexOfPixel[q];
      // A background neighbour is the artwork's own outline: always a boundary.
      if (j < 0) { worst = 1; return; }
      const dl = okL[i] - okL[j];
      const da = okA[i] - okA[j];
      const db = okB[i] - okB[j];
      const d = Math.sqrt(dl * dl + da * da + db * db);
      if (d > worst) worst = d;
    };
    if (x > 0) test(p - 1);
    if (x < width - 1) test(p + 1);
    if (y > 0) test(p - width);
    if (y < height - 1) test(p + width);
    isEdge[i] = worst > EDGE_GRAD ? 1 : 0;
  }
  void data;
  return isEdge;
}

/**
 * Fold every centre into the first one it is indistinguishable from, and return the mapping.
 *
 * TWO tests, because one is not enough near black. Oklab's lightness is a cube root, so the
 * step from RGB 0 to RGB 5 is about 0.11 in L — nearly three times MERGE_TOL — while the same
 * five-step difference up at white is 0.01. On a Oklab test alone the cobweb's two blacks
 * (0,0,0 and 5,4,4) stayed apart and printed as two filaments of the same colour.
 *
 * So a channel test sits beside it: eight sRGB steps on every channel is under half a percent
 * of the range, which no filament pair can express and no eye can see on a printed part.
 */
function mergeCentres(
  cL: Float32Array, cA: Float32Array, cB: Float32Array, rgb: RGB[], K: number,
): Int16Array {
  const map = new Int16Array(K);
  const kept: number[] = [];
  for (let k = 0; k < K; k++) {
    let into = -1;
    for (const j of kept) {
      const dl = cL[k] - cL[j];
      const da = cA[k] - cA[j];
      const db = cB[k] - cB[j];
      const near = Math.sqrt(dl * dl + da * da + db * db) <= MERGE_TOL
        || (Math.abs(rgb[k][0] - rgb[j][0]) <= MERGE_RGB
          && Math.abs(rgb[k][1] - rgb[j][1]) <= MERGE_RGB
          && Math.abs(rgb[k][2] - rgb[j][2]) <= MERGE_RGB);
      if (near) { into = j; break; }
    }
    if (into >= 0) map[k] = into;
    else { map[k] = k; kept.push(k); }
  }
  return map;
}

/*
  The colour of an edge pixel, decided from what is around it AND what it is.

  An edge pixel is one of two things: a genuine colour that happens to sit next to a different
  one (every pixel of a two-pixel stroke), or a blend of the two colours either side of a
  boundary (the anti-aliased ramp). The old rule treated every edge pixel as the second kind:
  it could only take a label its already-settled neighbours had. A stroke thinner than three
  pixels has no settled interior, so its pixels — pure black, rgb 0,0,0 — were painted with
  the colour of the white they sat in. Measured on a hatched samurai logo: the hat's entire
  hatching gone, the face a blob; on a logo with a thin tagline, the whole word IPSUM missing
  from the label map.

  So the candidates are the neighbours' labels PLUS the pixel's own nearest palette colour, and
  each is scored as an explanation of the pixel: a single colour by its distance, a pair by
  how far the pixel lies off the straight segment between them. A pure black pixel in a white
  field is explained perfectly by the (white, black) pair at t=1, so it is black. A mid-grey
  between a black outline and white glass is explained perfectly by (black, white), and not at
  all by the green liquid that merely happens to be nearest in Oklab — which is what the
  neighbour restriction was for, and it still holds. A pair that has to reach for the nearest
  colour rather than a neighbour pays a small penalty, so when two explanations are equally
  good the one the surroundings support wins.
*/
const REACH_PENALTY = 0.02;
/** Side results of the last `resolveEdge` call: the colour on the far side of the edge the
 *  pixel was read as (-1 when it was read as a plain colour, or as ink against the removed
 *  background), and how far toward that side it leans, 0..0.5. */
let edgeOther = -1;
let edgeT = 0;
/*
  How far an edge pixel looks for settled colours, in pixels.

  One pixel is not enough. The band is decided from the outside in, so the first ring of a
  ramp between black and white sees only the white it touches — and a grey explained by
  (white, nearest-grey) at t=1 scores exactly as well as one explained by (black, white), which
  it cannot see yet. That put 807 grey slivers along the cobweb's every edge. An anti-aliased
  band is one or two pixels wide, so three reaches the far side of it from the first ring.
*/
const NEAR_R = 3;
function resolveEdge(
  pL: number, pA: number, pB: number,
  near: number[],
  pool: number[],
  cL: ArrayLike<number>, cA: ArrayLike<number>, cB: ArrayLike<number>,
  /* The colour of the removed background, in Oklab, when the pixel borders it. The outer rim
     of an outline is a blend of ink and THAT — not of ink and any colour the drawing has —
     so without it a dark-grey rim pixel gets explained by whatever mid colour is nearest
     (green, on the potion: 167 slivers round the outside of the outline). A blend with the
     outside is always resolved to the ink side, because the other side is not a colour. */
  outside: [number, number, number] | null,
): number {
  const d2 = (k: number) => {
    const dl = pL - cL[k], da = pA - cA[k], db = pB - cB[k];
    return dl * dl + da * da + db * db;
  };
  let kn = pool[0];
  let knD = Infinity;
  for (const k of pool) { const d = d2(k); if (d < knD) { knD = d; kn = k; } }
  const cand = near.includes(kn) ? near : [...near, kn];
  edgeOther = -1;
  edgeT = 0;
  if (cand.length === 1) return cand[0];

  let best = kn;
  let bestScore = Infinity;
  /** How far the pixel lies off the segment from centre `a` to the point (bL,bA,bB), and
   *  where along it. */
  const offSegment = (a: number, bL: number, bA: number, bB: number): [number, number] => {
    const vl = bL - cL[a], va = bA - cA[a], vb = bB - cB[a];
    const len2 = vl * vl + va * va + vb * vb;
    if (len2 === 0) return [Infinity, 0];
    let t = ((pL - cL[a]) * vl + (pA - cA[a]) * va + (pB - cB[a]) * vb) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const rl = pL - (cL[a] + t * vl), ra = pA - (cA[a] + t * va), rb = pB - (cB[a] + t * vb);
    return [Math.sqrt(rl * rl + ra * ra + rb * rb), t];
  };
  for (let x = 0; x < cand.length; x++) {
    const a = cand[x];
    const penA = near.includes(a) ? 0 : REACH_PENALTY;
    const single = Math.sqrt(d2(a)) + penA;
    if (single < bestScore) { bestScore = single; best = a; edgeOther = -1; edgeT = 0; }
    for (let y = x + 1; y < cand.length; y++) {
      const b = cand[y];
      const [res, t] = offSegment(a, cL[b], cA[b], cB[b]);
      const score = res + penA + (near.includes(b) ? 0 : REACH_PENALTY);
      if (score < bestScore) {
        bestScore = score;
        if (t < 0.5) { best = a; edgeOther = b; edgeT = t; }
        else { best = b; edgeOther = a; edgeT = 1 - t; }
      }
    }
    if (outside) {
      const [res, t] = offSegment(a, outside[0], outside[1], outside[2]);
      if (res + penA < bestScore) { bestScore = res + penA; best = a; edgeOther = -1; edgeT = t; }
    }
  }
  return best;
}

/** The starting `soft` field: every pixel's alpha as a fraction. Foreground pixels are then
 *  overwritten with their colour-derived membership (capped by that alpha); the pixels just
 *  OUTSIDE the silhouette keep theirs, which is the cut-out's own anti-aliasing and lets the
 *  outline contour cross between a 0.84 pixel and a 0.42 one instead of stopping at the last
 *  whole pixel. */
function softField(data: Uint8ClampedArray, n: number): Float32Array {
  const soft = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3];
    if (a > 0 && a < ALPHA_THRESHOLD) soft[p] = a / 255;
  }
  return soft;
}

export function quantize(
  img: RgbaImage,
  colorCount: number,
  customColors?: RGB[],
  /** The background colour `removeBackground` stripped, if it found one — see `resolveEdge`. */
  outside?: RGB | null,
): QuantizeResult {
  const { data, width, height } = img;
  const n = width * height;
  const outLab: [number, number, number] | null = outside ? srgbToOklab(outside) : null;

  // Collect foreground pixels.
  const fgR: number[] = [];
  const fgG: number[] = [];
  const fgB: number[] = [];
  const fgPixel: number[] = []; // pixel index in full image
  for (let p = 0; p < n; p++) {
    const a = data[p * 4 + 3];
    if (a < ALPHA_THRESHOLD) continue;
    fgR.push(data[p * 4]);
    fgG.push(data[p * 4 + 1]);
    fgB.push(data[p * 4 + 2]);
    fgPixel.push(p);
  }

  const indices = new Int16Array(n).fill(-1);
  const M = fgR.length;
  if (M === 0) {
    return { palette: [], indices, soft: softField(data, n), other: new Int16Array(n).fill(-1), width, height };
  }
  // Pixel index -> foreground index, so a pixel's neighbours can be compared without a search.
  const indexOfPixel = new Int32Array(n).fill(-1);
  for (let i = 0; i < M; i++) indexOfPixel[fgPixel[i]] = i;

  // Oklab coordinates for every foreground pixel (clustering + mapping happen here).
  const okL = new Float32Array(M);
  const okA = new Float32Array(M);
  const okB = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const lab = srgbToOklab([fgR[i], fgG[i], fgB[i]]);
    okL[i] = lab[0];
    okA[i] = lab[1];
    okB[i] = lab[2];
  }

  /* Which pixels sit on a boundary. Computed once, before either branch, because both need
     it — see `edgePixels` and the EDGE_GRAD note for what goes wrong without it. */
  const isEdge = edgePixels(img, okL, okA, okB, fgPixel, indexOfPixel);

  if (customColors && customColors.length > 0) {
    /*
      A chosen palette, and the same anti-aliasing problem in its sharpest form.

      Mapping every pixel to the nearest filament is right for a pixel that is a colour and
      badly wrong for one that is a blend, because Oklab distance is not kind to the extremes:
      black sits at L=0 and white at L=1, so a mid-grey edge pixel is 0.4 to 0.6 away from BOTH
      of the colours it is actually made of, while any mid-lightness filament in the list is
      within about 0.2 of it on lightness alone. Measured against this app's own filament table
      for a 50% grey: Green 0.17, Pink 0.18, Orange 0.20, Red 0.22 — against White 0.40 and
      Black 0.60. Every one of the saturated ones wins.

      That is the whole mechanism behind a red fringe on a drawing containing no red. It is
      worse here than in the automatic mode, because there a cluster centre is always a mean of
      pixels that exist in the image, so a drawing with no red cannot produce a red centre. A
      fixed list can, and does.

      So the edge band does not get to choose from the whole list. It gets to choose between
      the colours its own neighbours already settled on.
    */
    const cl = customColors.map((c) => srgbToOklab(c));
    const clL = Float32Array.from(cl, (c) => c[0]);
    const clA = Float32Array.from(cl, (c) => c[1]);
    const clB = Float32Array.from(cl, (c) => c[2]);
    const allK = cl.map((_, k) => k);
    const counts = new Array(customColors.length).fill(0);
    const nearestOf = (i: number, from: number[] | null) => {
      let bestK = -1;
      let bestD = Infinity;
      const pool = from ?? cl.map((_, k) => k);
      for (const k of pool) {
        const dl = okL[i] - cl[k][0];
        const da = okA[i] - cl[k][1];
        const db = okB[i] - cl[k][2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) { bestD = d; bestK = k; }
      }
      return bestK;
    };

    // Pass one: the flat interior, nearest of the whole palette. Unchanged behaviour — a real
    // fill with no close match in the user's spools is their choice to make, not a bug.
    const label = new Int16Array(M).fill(-1);
    const softM = new Float32Array(M).fill(1);
    const otherM = new Int16Array(M).fill(-1);
    for (let i = 0; i < M; i++) if (!isEdge[i]) label[i] = nearestOf(i, null);

    /* Pass two: the edges, restricted to what their settled neighbours chose.

       One or two distinct neighbouring labels is a boundary between two colours, and the pixel
       belongs to whichever of those two it is nearer — never to a third the drawing does not
       have there. Zero (the middle of a band thicker than one pixel) or three or more (a real
       corner where three colours meet) are cases this model does not describe, so they fall
       back to the old behaviour: never worse than before, only better where the answer is
       actually knowable. */
    for (let i = 0; i < M; i++) {
      if (!isEdge[i]) continue;
      const p = fgPixel[i];
      const x = p % width;
      const y = (p / width) | 0;
      const near: number[] = [];
      let rim = false;
      for (let dy = -NEAR_R; dy <= NEAR_R; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -NEAR_R; dx <= NEAR_R; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = indexOfPixel[ny * width + nx];
          if (j < 0) { rim = true; continue; }
          if (label[j] < 0) continue;
          if (!near.includes(label[j])) near.push(label[j]);
        }
      }
      label[i] = resolveEdge(okL[i], okA[i], okB[i], near, allK, clL, clA, clB, rim ? outLab : null);
      softM[i] = 1 - edgeT;
      otherM[i] = edgeOther;
    }

    for (let i = 0; i < M; i++) {
      const bestK = label[i] >= 0 ? label[i] : nearestOf(i, null);
      indices[fgPixel[i]] = bestK;
      counts[bestK]++;
    }

    const palette: { rgb: RGB; coverage: number }[] = [];
    const oldToNewIdx = new Map<number, number>();
    for (let k = 0; k < customColors.length; k++) {
      if (counts[k] > 0) {
        oldToNewIdx.set(k, palette.length);
        palette.push({ rgb: customColors[k], coverage: counts[k] / M });
      }
    }
    for (let i = 0; i < n; i++) {
      const idx = indices[i];
      if (idx !== -1) indices[i] = oldToNewIdx.has(idx) ? oldToNewIdx.get(idx)! : -1;
    }
    const soft = softField(data, n);
    const other = new Int16Array(n).fill(-1);
    for (let i = 0; i < M; i++) {
      soft[fgPixel[i]] = Math.min(softM[i], data[fgPixel[i] * 4 + 3] / 255);
      const o = otherM[i];
      other[fgPixel[i]] = o >= 0 && oldToNewIdx.has(o) ? oldToNewIdx.get(o)! : -1;
    }
    return { palette, indices, soft, other, width, height };
  }

  /*
    The palette is fitted to the FLAT INTERIOR, not to every pixel.

    An anti-aliased pixel is a mixture of the two colours either side of an edge, not a colour
    of its own, and there is a band of them along every contour in the drawing. Left in the
    model they capture clusters — and a cluster that tracks every contour at one pixel wide
    traces into thousands of slivers, each of which becomes its own filament region. That is
    the fringe and the speckle both. See EDGE_GRAD above for the measurements.

    Every pixel still gets a label at the end; only the FITTING ignores the edges. So the
    colours come from the drawing's flat areas and the anti-aliased band falls to whichever of
    them it is nearest, which puts it on one side of the boundary instead of between them.
  */
  let flat: number[] = [];
  for (let i = 0; i < M; i++) if (!isEdge[i]) flat.push(i);
  // A photograph is edges everywhere: there is no flat interior to model, and fitting to the
  // little there is would draw the palette from whatever happened to be smooth. Fall back to
  // modelling everything, exactly as before.
  if (flat.length < M * MIN_FLAT_FRACTION) flat = fgR.map((_, i) => i);

  // --- Median cut (RGB) to SEED the cluster centers. ---
  let boxes: Box[] = [{ pixels: flat.slice() }];
  const target = Math.max(1, Math.min(colorCount, 16));
  while (boxes.length < target) {
    // Pick the box with the largest channel range to split.
    let best = -1;
    let bestRange = -1;
    let bestChannel = 0;
    for (let b = 0; b < boxes.length; b++) {
      const { range, channel } = boxStats(boxes[b], fgR, fgG, fgB);
      if (range > bestRange && boxes[b].pixels.length > 1) {
        bestRange = range;
        best = b;
        bestChannel = channel;
      }
    }
    if (best < 0 || bestRange <= 0) break;

    const box = boxes[best];
    const ch = bestChannel === 0 ? fgR : bestChannel === 1 ? fgG : fgB;
    box.pixels.sort((i, j) => ch[i] - ch[j]);
    const mid = box.pixels.length >> 1;
    const a: Box = { pixels: box.pixels.slice(0, mid) };
    const c: Box = { pixels: box.pixels.slice(mid) };
    boxes.splice(best, 1, a, c);
  }

  // Seed cluster centers = each box's mean in Oklab.
  const K = boxes.length;
  const cL = new Float32Array(K);
  const cA = new Float32Array(K);
  const cB = new Float32Array(K);
  for (let b = 0; b < K; b++) {
    let l = 0, a = 0, bb = 0;
    for (const i of boxes[b].pixels) {
      l += okL[i];
      a += okA[i];
      bb += okB[i];
    }
    const k = boxes[b].pixels.length || 1;
    cL[b] = l / k;
    cA[b] = a / k;
    cB[b] = bb / k;
  }

  // --- k-means refinement in Oklab (assign → recompute means). Oklab is already
  //     perceptually uniform, so all three channels are weighted equally. ---
  const assign = new Int16Array(M);
  const softM = new Float32Array(M).fill(1);
  const otherM = new Int16Array(M).fill(-1);
  /** Nearest centre, over `over` — the model set while fitting, every pixel at the end. */
  const assignNearest = (over: ArrayLike<number>) => {
    for (let x = 0; x < over.length; x++) {
      const i = over[x];
      let bestK = 0;
      let bestD = Infinity;
      for (let k = 0; k < K; k++) {
        const dl = okL[i] - cL[k];
        const da = okA[i] - cA[k];
        const db = okB[i] - cB[k];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      assign[i] = bestK;
    }
  };
  for (let iter = 0; iter < KMEANS_ITERS; iter++) {
    assignNearest(flat);
    const sL = new Float64Array(K);
    const sA = new Float64Array(K);
    const sB = new Float64Array(K);
    const cnt = new Float64Array(K);
    for (const i of flat) {
      const k = assign[i];
      sL[k] += okL[i];
      sA[k] += okA[i];
      sB[k] += okB[i];
      cnt[k]++;
    }
    for (let k = 0; k < K; k++) {
      if (cnt[k] > 0) {
        cL[k] = sL[k] / cnt[k];
        cA[k] = sA[k] / cnt[k];
        cB[k] = sB[k] / cnt[k];
      }
    }
  }

  /*
    Collapse centres that are the same colour.

    k-means returns K clusters whether or not the image contains K distinguishable ones, so a
    two-colour drawing asked for four gets its white split across two filaments — which prints
    as a flat area speckled with the other colour. Done AFTER the fit rather than by lowering K
    up front, because how many colours an image really has is not knowable until they have been
    found.
  */
  const centreRgb: RGB[] = [];
  for (let k = 0; k < K; k++) centreRgb.push(oklabToSrgb([cL[k], cA[k], cB[k]]));
  const merged = mergeCentres(cL, cA, cB, centreRgb, K);

  /*
    Final per-pixel assignment — and the edge band does NOT get to pick from the whole palette.

    Fitting the palette to flat interiors stops the anti-aliased band from CAPTURING a cluster.
    It does not tell the band where to go afterwards, and "nearest centre over the whole
    palette" is the wrong answer for a pixel that is a blend, in a way that is worst exactly
    where the artwork is cleanest. Oklab lightness puts black at 0 and white at 1, so the grey
    halfway down a black outline is ~0.5 from BOTH of the colours it is actually made of —
    while any mid-lightness third colour in the drawing is nearer than either. Measured on the
    potion, at colourCount 4:

      129 slivers of the light-green bubble colour, every one of them lying between the green
          liquid and the white glass — the blend of those two IS light green
      107 slivers of the green liquid colour, every one lying between the black outline and
          the white glass — mid-grey is nearer green (0.55 L) than black or white

    None of that is despeckling's job. The pixels are not noise: they are a one-pixel band
    tracking every contour in the drawing, and they are wrong before anything counts them. A
    black outline came out with a green thread down the middle of it, which survives every
    downstream filter because it is a legitimate, connected, correctly-traced region of a
    colour the drawing really does contain — somewhere else.

    So an edge pixel chooses only between the colours ADJACENT to it, growing inward from the
    settled interiors one ring at a time. A band of any thickness resolves in as many rounds as
    it is pixels wide, and a third colour that is merely near in Oklab is never a candidate,
    because it is not there. This is the same rule the chosen-palette branch above already
    uses; the automatic branch never got it.
  */
  assignNearest(flat); // the flat interiors settle first, on the final centres
  const settled = new Uint8Array(M);
  for (const i of flat) settled[i] = 1;

  const allCentres: number[] = [];
  for (let k = 0; k < K; k++) allCentres.push(k);
  // Labels are compared and chosen among the SURVIVING centres, so two merged duplicates of
  // one colour never read as two candidates.
  const keptCentres = allCentres.filter((k) => merged[k] === k);
  /** Nearest centre restricted to `pool` — squared Oklab distance, same metric as the fit. */
  const nearestAmong = (i: number, pool: number[]) => {
    let bestK = pool[0];
    let bestD = Infinity;
    for (const k of pool) {
      const dl = okL[i] - cL[k];
      const da = okA[i] - cA[k];
      const db = okB[i] - cB[k];
      const d = dl * dl + da * da + db * db;
      if (d < bestD) { bestD = d; bestK = k; }
    }
    return bestK;
  };

  let pending: number[] = [];
  for (let i = 0; i < M; i++) if (!settled[i]) pending.push(i);
  while (pending.length) {
    const stalled: number[] = [];
    const chosen: [number, number][] = [];
    for (const i of pending) {
      const p = fgPixel[i];
      const x = p % width;
      const y = (p / width) | 0;
      const near: number[] = [];
      let rim = false;
      for (let dy = -NEAR_R; dy <= NEAR_R; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -NEAR_R; dx <= NEAR_R; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = indexOfPixel[ny * width + nx];
          if (j < 0) { rim = true; continue; }
          if (!settled[j]) continue;
          const k = merged[assign[j]];
          if (!near.includes(k)) near.push(k);
        }
      }
      if (near.length) {
        chosen.push([i, resolveEdge(okL[i], okA[i], okB[i], near, keptCentres, cL, cA, cB, rim ? outLab : null)]);
        softM[i] = 1 - edgeT;
        otherM[i] = edgeOther;
      }
      else stalled.push(i);
    }
    // A run with nothing to grow from is an island every pixel of which is an edge pixel —
    // there is no adjacent colour to restrict it to, so it keeps the old global answer.
    if (chosen.length === 0) {
      for (const i of stalled) assign[i] = nearestAmong(i, allCentres);
      break;
    }
    for (const [i, k] of chosen) {
      assign[i] = k;
      settled[i] = 1;
    }
    pending = stalled;
  }

  /*
    NOT dissolved here: a cluster that looks like a band rather than a colour.

    The obvious rule — "almost every pixel in this cluster is an edge pixel, so it is a ramp,
    not a colour" — was written, measured and removed. It is not separable: the skull is line
    art, so its black outline IS almost entirely edge pixels, and at any threshold that caught
    the cobweb's mid grey the skull came out as a single white blob with no outline at all.

    What is left of the band problem is a handful of clusters with many tiny components, and
    `traceRegions` already absorbs those — after this change the pumpkin's leftover green
    traces to one component, not 438. The place to tighten it further is there, where component
    areas are already computed, not here where they would have to be computed again.
  */
  const counts = new Float64Array(K);
  for (let i = 0; i < M; i++) {
    const k = merged[assign[i]];
    counts[k]++;
    indices[fgPixel[i]] = k;
  }

  // Drop empty clusters, remap indices, and convert each center back to sRGB.
  const remap = new Int16Array(K).fill(-1);
  const palette: { rgb: RGB; coverage: number }[] = [];
  for (let k = 0; k < K; k++) {
    if (counts[k] > 0) {
      remap[k] = palette.length;
      palette.push({ rgb: oklabToSrgb([cL[k], cA[k], cB[k]]), coverage: counts[k] / M });
    }
  }
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    if (idx !== -1) indices[i] = remap[idx];
  }
  const soft = softField(data, n);
  const other = new Int16Array(n).fill(-1);
  for (let i = 0; i < M; i++) {
    soft[fgPixel[i]] = Math.min(softM[i], data[fgPixel[i] * 4 + 3] / 255);
    const o = otherM[i];
    other[fgPixel[i]] = o >= 0 ? remap[merged[o]] : -1;
  }

  return { palette, indices, soft, other, width, height };
}

function boxStats(box: Box, R: number[], G: number[], B: number[]) {
  let rmin = 255;
  let rmax = 0;
  let gmin = 255;
  let gmax = 0;
  let bmin = 255;
  let bmax = 0;
  for (const i of box.pixels) {
    rmin = Math.min(rmin, R[i]);
    rmax = Math.max(rmax, R[i]);
    gmin = Math.min(gmin, G[i]);
    gmax = Math.max(gmax, G[i]);
    bmin = Math.min(bmin, B[i]);
    bmax = Math.max(bmax, B[i]);
  }
  // Weight green slightly (perceptual), like classic median cut.
  const rr = rmax - rmin;
  const gr = (gmax - gmin) * 1.2;
  const br = bmax - bmin;
  const range = Math.max(rr, gr, br);
  const channel = range === rr ? 0 : range === gr ? 1 : 2;
  return { range, channel };
}
