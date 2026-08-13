// Image -> silhouette, with every decision exposed.
//
// The generic pipeline in `pipeline.ts` is built for multi-colour work: it
// quantises to N filament colours and traces each region. For this generator
// there is exactly one question — is this pixel part of the shape or not — and
// answering it with a colour clusterer means the answer moves when the image
// changes and the user has no dial to turn. So this module thresholds directly.
//
// Everything here runs on the main thread in a few tens of milliseconds at the
// working resolution, which is what makes a threshold slider feel live.

import { contours } from 'd3-contour';
import type { RgbaImage } from './decode';
import type { Ring } from '../types';

export interface SilhouetteParams {
  /** Luminance cut, 0..1. Pixels darker than this are the subject. */
  threshold: number;
  /** The subject is lighter than its background rather than darker. */
  invert: boolean;
  /** Drop any blob touching the border — that is the background, not the shape. */
  dropEdgeBlobs: boolean;
  /** Close pinholes and ragged edges, in working pixels. */
  cleanup: number;
  /** Contour smoothing, 0..1. */
  smoothing: number;
  /** Discard islands smaller than this share of the largest, 0..1. */
  despeckle: number;
  /** Ignore interior holes and cut the shape solid. */
  fillHoles: boolean;
}

export const DEFAULT_SILHOUETTE: SilhouetteParams = {
  threshold: 0.5,
  invert: false,
  dropEdgeBlobs: true,
  cleanup: 2,
  smoothing: 0.5,
  despeckle: 0.02,
  fillHoles: false,
};

export interface SilhouetteResult {
  /** Kept geometry, normalised: longest side = 1, centred, Y-up. */
  rings: Ring[];
  /** Islands the despeckle threshold threw away, same space. Drawn in the
   *  editor so a lost limb is visible rather than silently missing. */
  dropped: Ring[];
  /** Maps a source-image pixel into the normalised space, so the editor can
   *  lay the original underneath the outline it produced. */
  transform: { scale: number; cx: number; cy: number };
  /** Share of the working image that came out as subject — a cheap tell for a
   *  threshold that has swallowed the background or eaten the shape. */
  coverage: number;
}

/** Perceptual luminance, 0..1. Rec. 709 — matches how dark the eye reads a
 *  pixel, so the threshold slider moves the way the picture looks. */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Binary mask, 1 = subject. Alpha wins when the image has any: a cut-out PNG
 *  has already answered this question and no threshold should override it. */
function buildMask(img: RgbaImage, p: SilhouetteParams): Uint8Array {
  const { data, width, height } = img;
  const n = width * height;
  const mask = new Uint8Array(n);

  let transparent = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) transparent++;
  const useAlpha = transparent > n * 0.02;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let on: boolean;
    if (useAlpha) {
      on = data[o + 3] >= 128;
    } else {
      const l = luma(data[o], data[o + 1], data[o + 2]);
      on = p.invert ? l > p.threshold : l < p.threshold;
    }
    mask[i] = on ? 1 : 0;
  }
  return mask;
}

/** Separable box dilate/erode. A close (dilate then erode) seals pinholes and
 *  the speckle a JPEG leaves along an edge; an open would eat thin limbs, so
 *  only the close is offered. */
function morph(mask: Uint8Array, w: number, h: number, radius: number, grow: boolean): Uint8Array {
  if (radius <= 0) return mask;
  const want = grow ? 1 : 0;
  const pass = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    const outer = horizontal ? h : w;
    const inner = horizontal ? w : h;
    for (let a = 0; a < outer; a++) {
      for (let b = 0; b < inner; b++) {
        let hit = false;
        for (let d = -radius; d <= radius && !hit; d++) {
          const c = b + d;
          if (c < 0 || c >= inner) continue;
          const idx = horizontal ? a * w + c : c * w + a;
          if (src[idx] === want) hit = true;
        }
        const idx = horizontal ? a * w + b : b * w + a;
        out[idx] = hit ? want : 1 - want;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

/** Gaussian smoothing around a closed ring. */
function smoothRing(ring: Ring, strength: number): Ring {
  const radius = Math.round(strength * 4);
  if (radius < 1 || ring.length < 8) return ring;
  const n = ring.length;
  const weights: number[] = [];
  const sigma = Math.max(0.6, radius / 2);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const wgt = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(wgt);
    sum += wgt;
  }
  const out: Ring = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let k = -radius; k <= radius; k++) {
      const pt = ring[((i + k) % n + n) % n];
      const wgt = weights[k + radius];
      x += pt[0] * wgt;
      y += pt[1] * wgt;
    }
    out[i] = [x / sum, y / sum];
  }
  return out;
}

/** Ramer-Douglas-Peucker, epsilon in working pixels. */
function simplify(ring: Ring, epsilon: number): Ring {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    const [ax, ay] = ring[s];
    const [bx, by] = ring[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((ring[i][0] - ax) * dy - (ring[i][1] - ay) * dx) / len;
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
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

export function traceSilhouette(img: RgbaImage, p: SilhouetteParams): SilhouetteResult {
  const { width, height } = img;
  let mask = buildMask(img, p);

  const radius = Math.round(p.cleanup);
  if (radius > 0) {
    mask = morph(mask, width, height, radius, true);
    mask = morph(mask, width, height, radius, false);
  }

  let subject = 0;
  for (let i = 0; i < mask.length; i++) subject += mask[i];
  const coverage = subject / mask.length;

  const values = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) values[i] = mask[i];

  const geo = contours().size([width, height]).thresholds([0.5])(values as unknown as number[])[0];

  // d3-contour hands back a MultiPolygon: one entry per island, each of which
  // is [outer, ...holes]. That split is exactly the island/hole distinction we
  // need, so it never has to be re-derived by containment testing.
  interface Island { outer: Ring; holes: Ring[]; area: number }
  const islands: Island[] = (geo?.coordinates ?? []).map((poly) => {
    const rings = poly.map((r) => r.map(([x, y]) => [x, y] as [number, number]));
    return { outer: rings[0], holes: rings.slice(1), area: ringArea(rings[0]) };
  });

  const touchesEdge = (ring: Ring): boolean =>
    ring.some(([x, y]) => x <= 1 || y <= 1 || x >= width - 1 || y >= height - 1);

  let usable = islands;
  if (p.dropEdgeBlobs) {
    const inner = usable.filter((i) => !touchesEdge(i.outer));
    // Only honour it if something survives — on a full-bleed subject every blob
    // touches the border, and silently returning nothing is worse than
    // returning the shape.
    if (inner.length) usable = inner;
  }
  if (!usable.length) {
    return { rings: [], dropped: [], transform: { scale: 1, cx: 0, cy: 0 }, coverage };
  }

  const biggest = Math.max(...usable.map((i) => i.area));
  const kept = usable.filter((i) => i.area >= biggest * p.despeckle);
  const cut = usable.filter((i) => i.area < biggest * p.despeckle);

  // Normalise on what we are KEEPING, so tightening despeckle does not shift
  // the model sideways under the user.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const island of kept) {
    for (const [x, y] of island.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const maxSide = Math.max(maxX - minX, maxY - minY) || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 1 / maxSide;

  // Image space is Y-down, the solver's is Y-up.
  const norm = (ring: Ring): Ring =>
    ring.map(([x, y]) => [(x - cx) * scale, -(y - cy) * scale] as [number, number]);

  const epsilon = 0.35 + p.smoothing * 0.9;
  const finish = (ring: Ring): Ring => norm(simplify(smoothRing(ring, p.smoothing), epsilon));

  const rings: Ring[] = [];
  for (const island of kept) {
    rings.push(finish(island.outer));
    if (!p.fillHoles) for (const hole of island.holes) rings.push(finish(hole));
  }

  return {
    rings: rings.filter((r) => r.length >= 3),
    dropped: cut.map((i) => finish(i.outer)).filter((r) => r.length >= 3),
    transform: { scale, cx, cy },
    coverage,
  };
}
