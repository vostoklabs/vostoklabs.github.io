// Image -> normalized RegionSet. Orchestrates matte + composite + clean + quantize + trace.
import type { RgbaImage } from './decode';
import { removeBackground, compositeOverMatte, cleanMask } from './matte';
import { quantize } from './quantize';
import { traceRegions } from './trace';
import { srgbToOklab } from './colorspace';
import type { RegionSet, RGB } from '../types';

export interface ProcessOptions {
  /** Strip a flat background by edge flood-fill (skipped if image has alpha). */
  removeBg?: boolean;
  /** Edge smoothing strength, 0..1 (higher = smoother contours). */
  smoothing?: number;
  customColors?: RGB[];
  /** Protect small features via adaptive smoothing + speck absorption (default on). */
  preserveDetail?: boolean;
  /** Longest side of the FINISHED part, mm. Decides the smallest feature worth tracing —
   *  see MIN_FEATURE_MM in trace.ts. Defaults to the app's default cap width. */
  designMm?: number;
}

/** A colour the picture is made of, as found by `discoverColours`. */
export interface ColourCandidate {
  rgb: RGB;
  /** Share of the artwork's pixels, 0..1. */
  coverage: number;
}

/*
  Two candidates closer than this are the same colour to a person looking at a print, and are
  listed once. Wider than the quantiser's own merge (0.04), on purpose: that one must not
  posterise the artwork, whereas this list exists to be READ, and two swatches of red that
  differ by a hair are a question nobody can answer. Below the coverage floor a candidate is
  anti-aliasing debris, not a colour — measured on the heart sample, the debris was 0.0-0.1%
  and the smallest real feature (the cheeks) 1.7%.
*/
const CANDIDATE_MERGE = 0.08;
const CANDIDATE_MIN_COVERAGE = 0.001;

/**
 * Every distinct colour the picture contains, biggest first.
 *
 * This is the list the wizard shows so a person can decide what to keep, because the automatic
 * split has no way to know that the 1.7% of pink on a heart's cheeks matters more than the
 * difference between two reds. Asked for two colours it folds the cheeks into red and there was
 * nothing to pull. Ticking "pink" here hands the chosen colours to `processImage` as
 * `customColors`, and the quantiser maps every pixel onto that exact set.
 *
 * Same preprocessing as `processImage`, then a generous quantise, then a merge of what is
 * indistinguishable and a drop of what is debris.
 */
export function discoverColours(img: RgbaImage, removeBg = true): ColourCandidate[] {
  const matte = removeBg ? removeBackground(img) : null;
  compositeOverMatte(img);
  cleanMask(img);
  const q = quantize(img, 12, undefined, matte);
  const found = q.palette
    .filter((p) => p.coverage >= CANDIDATE_MIN_COVERAGE)
    .sort((a, b) => b.coverage - a.coverage)
    .map((p) => ({ rgb: p.rgb, coverage: p.coverage, lab: srgbToOklab(p.rgb) }));
  const kept: typeof found = [];
  for (const c of found) {
    const twin = kept.find((k) => Math.hypot(k.lab[0] - c.lab[0], k.lab[1] - c.lab[1], k.lab[2] - c.lab[2]) <= CANDIDATE_MERGE);
    if (twin) twin.coverage += c.coverage;
    else kept.push(c);
  }
  return kept.map(({ rgb, coverage }) => ({ rgb, coverage }));
}

export function processImage(
  img: RgbaImage,
  colorCount: number,
  opts: ProcessOptions = {},
): RegionSet {
  // Background removal first so the flood fill sees the original alpha; compositing
  // afterwards uses the detected/auto matte for the remaining soft (anti-aliased)
  // pixels, killing colored halos. cleanMask then despeckles + fills pinholes.
  const matte = opts.removeBg !== false ? removeBackground(img) : null;
  compositeOverMatte(img);
  cleanMask(img);
  const q = quantize(img, colorCount, opts.customColors, matte);
  return traceRegions(q, opts.smoothing ?? 0.5, opts.preserveDetail ?? true, opts.designMm ?? 35);
}
