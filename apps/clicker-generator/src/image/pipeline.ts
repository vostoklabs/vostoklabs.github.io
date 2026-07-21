// Image -> normalized RegionSet. Orchestrates matte + composite + clean + quantize + trace.
import type { RgbaImage } from './decode';
import { removeBackground, compositeOverMatte, cleanMask } from './matte';
import { quantize } from './quantize';
import { traceRegions } from './trace';
import type { RegionSet, RGB } from '../types';

export interface ProcessOptions {
  /** Strip a flat background by edge flood-fill (skipped if image has alpha). */
  removeBg?: boolean;
  /** Edge smoothing strength, 0..1 (higher = smoother contours). */
  smoothing?: number;
  customColors?: RGB[];
  /** Protect small features via adaptive smoothing + speck absorption (default on). */
  preserveDetail?: boolean;
}

export function processImage(
  img: RgbaImage,
  colorCount: number,
  opts: ProcessOptions = {},
): RegionSet {
  // Background removal first so the flood fill sees the original alpha; compositing
  // afterwards uses the detected/auto matte for the remaining soft (anti-aliased)
  // pixels, killing colored halos. cleanMask then despeckles + fills pinholes.
  if (opts.removeBg !== false) removeBackground(img);
  compositeOverMatte(img);
  cleanMask(img);
  const q = quantize(img, colorCount, opts.customColors);
  return traceRegions(q, opts.smoothing ?? 0.5, opts.preserveDetail ?? true);
}
