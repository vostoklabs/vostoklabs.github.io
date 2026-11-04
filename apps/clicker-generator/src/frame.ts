/**
 * The cap's backing ("frame") colour, derived from the design when nobody has picked one: the
 * rule the build, the rail and the words' default colour all read, so they cannot disagree.
 * Moved here out of mount.ts unchanged when the rail first needed it.
 */
import type { PaletteEntry, RGB } from './types';

export const LIGHT_FRAME: RGB = [240, 240, 240];
export const DARK_FRAME: RGB = [38, 38, 42];

export function relLuminance(rgb: RGB): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

// A light or dark backing chosen to contrast the given ink, so a single-color design
// is always visible against it.
export function contrastingFrame(ink: RGB): RGB {
  return relLuminance(ink) > 150 ? DARK_FRAME : LIGHT_FRAME;
}

export interface FrameSource {
  importMode: string;
  palette: PaletteEntry[];
  baseColorOverride: RGB | null;
  /** Blank: the top prints in one colour, with no picture on it. Absent = false. A cut model has
   *  no picture, so there it means nothing. */
  blank?: boolean;
  /** The body's filament: what a blank's button is set against. Read only for a blank. */
  bodyColorRgb?: RGB;
}

/** Whether the design prints blank: asked, and in a mode that has a picture to leave off. */
export const isBlank = (s: Pick<FrameSource, 'importMode' | 'blank'>): boolean =>
  s.blank === true && s.importMode !== 'model';

/** How far apart a blank's button and its body have to be, as RGB distance, to read as two
 *  colours. A quarter of one channel's range: white against light grey, or beige, is too close. */
export const TWO_TONE_MIN = 64;

const rgbDistance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A blank's button: the design's own ink, which it already prints in, unless that is too close
 *  to the body to tell apart, when a light or dark one that contrasts the body. */
export function twoToneButton(ink: RGB, body: RGB): RGB {
  return rgbDistance(ink, body) < TWO_TONE_MIN ? contrastingFrame(body) : ink;
}

export function dominantInk(s: FrameSource): RGB {
  if (s.palette.length === 0) return [180, 180, 185];
  let domIdx = 0;
  for (let i = 1; i < s.palette.length; i++) {
    if (s.palette[i].coverage > s.palette[domIdx].coverage) domIdx = i;
  }
  return s.palette[domIdx]?.filamentRgb ?? [180, 180, 185];
}

// The cap backing/frame color. A photographic IMAGE tiles the whole cap, so the frame
// mirrors its dominant region and blends in naturally. Line-art modes (icon/svg/text)
// are typically a single ink — mirroring that ink would make the design vanish into
// its own backing (the "svg comes out one color" bug), so we pick a contrasting frame
// instead. The design then reads clearly without any manual recolor.
export function deriveFrameColor(s: FrameSource): RGB {
  // A blank has no picture to frame: the button, or every keycap, is the second of two colours.
  if (isBlank(s)) return s.baseColorOverride ?? twoToneButton(dominantInk(s), s.bodyColorRgb ?? LIGHT_FRAME);
  // Blocks: the keycap is its own filament the user picks, not a backing derived from the
  // artwork — deriving it would flip the caps light/dark every time the legend changed.
  if (s.importMode === 'blocks') return s.baseColorOverride ?? LIGHT_FRAME;
  const ink = dominantInk(s);
  return s.importMode === 'image' ? ink : contrastingFrame(ink);
}

/** The frame as built: the one picked by clicking the cap, else the derived one. */
export const capColourOf = (s: FrameSource): RGB => s.baseColorOverride ?? deriveFrameColor(s);
