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

export function quantize(img: RgbaImage, colorCount: number, customColors?: RGB[]): QuantizeResult {
  const { data, width, height } = img;
  const n = width * height;

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
    return { palette: [], indices, width, height };
  }

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

  if (customColors && customColors.length > 0) {
    // Map each pixel to the nearest custom filament by Oklab distance (fixes the
    // "wrong filament chosen" complaints where a mid-blue mapped to gray in RGB).
    const cl = customColors.map((c) => srgbToOklab(c));
    const counts = new Array(customColors.length).fill(0);
    for (let i = 0; i < M; i++) {
      let bestK = 0;
      let bestD = Infinity;
      for (let k = 0; k < cl.length; k++) {
        const dl = okL[i] - cl[k][0];
        const da = okA[i] - cl[k][1];
        const db = okB[i] - cl[k][2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
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
    return { palette, indices, width, height };
  }

  // --- Median cut (RGB) to SEED the cluster centers. ---
  let boxes: Box[] = [{ pixels: fgR.map((_, i) => i) }];
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
  const assignNearest = () => {
    for (let i = 0; i < M; i++) {
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
    assignNearest();
    const sL = new Float64Array(K);
    const sA = new Float64Array(K);
    const sB = new Float64Array(K);
    const cnt = new Float64Array(K);
    for (let i = 0; i < M; i++) {
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

  // Final per-pixel assignment (nearest center in Oklab) + coverage counts.
  const counts = new Float64Array(K);
  assignNearest();
  for (let i = 0; i < M; i++) {
    const k = assign[i];
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

  return { palette, indices, width, height };
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
