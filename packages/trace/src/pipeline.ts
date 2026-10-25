// Image -> normalized RegionSet. Orchestrates matte + composite + clean + quantize + trace.
import type { RgbaImage } from './decode';
import { removeBackground, compositeOverMatte, cleanMask } from './matte';
import { quantize } from './quantize';
import { traceRegions } from './trace';
import { srgbToOklab } from './colorspace';
import type { RegionSet, RGB } from './types';

export interface ProcessOptions {
  /** Strip a flat background by edge flood-fill (skipped if image has alpha). */
  removeBg?: boolean;
  /** Edge smoothing strength, 0..1 (higher = smoother contours). */
  smoothing?: number;
  customColors?: RGB[];
  /** With `customColors`: the group each of those colours prints in, one entry per colour, the
   *  groups numbered 0..m-1 with none left out (anything else throws). The colours of one group
   *  trace as ONE region, with no seam between them, in the colour of its biggest member; the
   *  regions come in group order. `closestPairMapping` makes the default one. Ignored without
   *  `customColors`; absent, every colour is its own region, as it always was. */
  mergeInto?: number[];
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

/*
  How unalike two of a picture's colours are, for deciding which two share a filament: the HyAB
  distance in Oklab, the lightness difference plus the straight-line distance in colour (a, b).

  Not the straight line through all three axes the quantiser measures with. That one answers
  "can these two be told apart", a question about colours a hair apart. Every candidate here is
  already plainly its own colour (`discoverColours` folds anything closer than 0.08), so the
  question is which two are MOST alike, and at that size the straight line undercounts a pair
  that differs in lightness and in colour at once against one that differs mostly in one of the
  two. HyAB was put forward for exactly that range (Abasi et al., "Distance metrics for very
  large color differences", 2020).

  Measured on a cartoon cat, orange [240,140,40], black, white, brown stripes [140,80,40], pink
  [245,150,160] and green eyes [40,160,60], four filaments: in a straight line the brown is 0.240
  from the green and 0.247 from the orange, so the green eyes were merged into the stripes and
  printed brown. By HyAB it is 0.330 from the green and 0.303 from the orange (brown is orange,
  darker, which is what a person sees), and the eyes stay green.
*/
const unalike = (a: [number, number, number], b: [number, number, number]) =>
  Math.abs(a[0] - b[0]) + Math.hypot(a[1] - b[1], a[2] - b[2]);

/**
 * Which of a picture's colours share a filament when it has more colours than `budget`: the
 * `mergeInto` that `processImage` traces them with.
 *
 * The two most alike merge, again and again, until `budget` are left. A colour that looks like
 * nothing else in the picture survives however small it is, which is the point: keeping the
 * biggest colours and folding the rest into the nearest printed a cat's green eyes (4% of it)
 * orange, while its brown stripes, which are orange darker, kept a filament.
 *
 * A group is represented by its biggest member's colour, because that is the colour it prints
 * in (`processImage` gives a merged region its biggest member's colour), so two groups are as
 * far apart as what they will print as. A group's average would be a colour nothing prints in,
 * dragged a little further from its main colour by every small one folded in.
 *
 * `candidates` in `discoverColours`' order, biggest first. Groups are numbered by what they cover,
 * biggest first, so with `budget` colours or fewer this is [0, 1, 2, …]: nothing merges.
 */
export function closestPairMapping(candidates: ColourCandidate[], budget = 4): number[] {
  const lab = candidates.map((c) => srgbToOklab(c.rgb));
  const groups = candidates.map((c, i) => ({ members: [i], lead: i, coverage: c.coverage }));
  while (groups.length > Math.max(1, budget)) {
    let a = 0, b = 1, best = Infinity;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const d = unalike(lab[groups[i].lead], lab[groups[j].lead]);
        if (d < best) { best = d; a = i; b = j; }
      }
    }
    const into = groups[a], from = groups[b];
    into.members.push(...from.members);
    into.coverage += from.coverage;
    if (candidates[from.lead].coverage > candidates[into.lead].coverage) into.lead = from.lead;
    groups.splice(b, 1);
  }
  // Biggest first; on a tie the group listed first, so a list already in order keeps it.
  const order = groups.map((_, i) => i).sort((x, y) => groups[y].coverage - groups[x].coverage || x - y);
  const mergeInto = new Array<number>(candidates.length);
  order.forEach((g, rank) => { for (const m of groups[g].members) mergeInto[m] = rank; });
  return mergeInto;
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
  const q = quantize(img, colorCount, opts.customColors, matte, opts.mergeInto);
  return traceRegions(q, opts.smoothing ?? 0.5, opts.preserveDetail ?? true, opts.designMm ?? 35);
}
