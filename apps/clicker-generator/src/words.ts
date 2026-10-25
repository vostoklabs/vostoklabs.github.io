/**
 * Words on a picture: the rules both the rail (ui.ts) and the build (mount.ts) need, so the two
 * cannot disagree about what colour the words are.
 */
import { relLuminance } from './frame';
import type { PaletteEntry, RGB, Ring } from './types';

/**
 * The words' filament: the one picked for them, else whichever of the design's own filaments
 * stands out most from the cap they are printed on. One the design already prints in, so the
 * words add no spool (most AMS units hold 4); the one furthest from the cap in lightness, so they
 * can be read (black words on an orange pumpkin, white ones on a black logo's cap).
 */
export function wordsColour(palette: PaletteEntry[], picked: RGB | null, cap: RGB): RGB {
  if (picked) return picked;
  const capL = relLuminance(cap);
  let best: RGB | null = null;
  let bestD = -1;
  for (const p of palette) {
    const d = Math.abs(relLuminance(p.filamentRgb) - capL);
    if (d > bestD) { bestD = d; best = p.filamentRgb; }
  }
  // Nothing on the palette reads at all (a design in one colour, on a cap of that colour): the
  // plainest ink that does.
  if (!best || bestD < 40) return capL > 128 ? [22, 22, 22] : [245, 245, 245];
  return best;
}

/** Where a level line at height `y` crosses the rings: the stretch holding x = 0, else the widest
 *  one; null where it misses them. Even-odd, so a hole in a frame is not inside it. */
export function spanAt(rings: Ring[], y: number): [number, number] | null {
  const xs: number[] = [];
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j];
      const [bx, by] = r[i];
      if ((ay > y) === (by > y)) continue;
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
  }
  xs.sort((a, b) => a - b);
  let best: [number, number] | null = null;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const s: [number, number] = [xs[k], xs[k + 1]];
    if (s[0] <= 0 && s[1] >= 0) return s;
    if (!best || s[1] - s[0] > best[1] - best[0]) best = s;
  }
  return best;
}

/** Whether a line of words `w` × `h` mm, centred across at height `y`, is inside the rings with
 *  `margin` mm to spare all round: measured across its middle, and `margin` below its foot and
 *  above its top. */
export function wordFits(rings: Ring[], y: number, w: number, h: number, margin: number): boolean {
  for (const at of [y - h / 2 - margin, y, y + h / 2 + margin]) {
    const s = spanAt(rings, at);
    if (!s || s[0] > -w / 2 - margin || s[1] < w / 2 + margin) return false;
  }
  return true;
}

/**
 * The lowest height from `from` up to `to` (a line's centre, mm) where a line `w` × `h` mm fits
 * across the frame, or null. The foot of a heart or a circle is narrower than a word, so the
 * frame's lowest point is rarely the answer; this finds the first place that is wide enough.
 */
export function lowestFit(frame: Ring[], w: number, h: number, from: number, to: number, margin = 0.8): number | null {
  for (let y = from; y <= to + 1e-9; y += 0.25) {
    if (wordFits(frame, y, w, h, margin)) return Math.round(y * 100) / 100;
  }
  return null;
}
