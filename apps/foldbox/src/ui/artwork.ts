// Text in, `Artwork` out. An SVG logo is read in `svgLogo.ts`.
//
// This is the only asynchronous thing in the app, and it is deliberately fenced off
// here rather than pushed into the solve. A font is a fetch; the solve is straight-line
// 2D work that a slider drag runs sixty times a second. So the UI resolves the artwork
// ONCE, when the text or the face changes, and hands the result to `solve` as plain
// polygons — which is why a size slider still has no async flicker in it.
//
// What comes out is normalised: centred on the origin, longest side exactly 1, Y-up,
// outer rings CCW and holes CW. `placeMarks` scales it onto a face from there.

import { FALLBACK_FONT_ID, getFont, getHorizontalContours } from '@vostok/fonts';
import { normalizeArtwork } from '../geometry/marks';
import type { Artwork, Poly } from '../types';

/** Em the glyphs are laid out at. Arbitrary: everything is normalised afterwards and
 *  the face's own size decides the millimetres. */
const LAYOUT_EM = 100;

/** One line of type, as outlines.
 *
 *  The fallback font is the symbol set (Material Symbols, filled), which is what makes a symbol dropped
 *  into the text field work: `getHorizontalContours` already reaches for the fallback
 *  for any glyph the chosen face does not carry, so there is no second code path for
 *  "text with a heart in it". */
export async function textArtwork(text: string, fontId: string): Promise<Artwork> {
  const line = text.trim();
  if (!line) throw new Error('Type something to put on the box.');
  const [font, fallbackFont] = await Promise.all([
    getFont(fontId),
    getFont(FALLBACK_FONT_ID).catch(() => null),
  ]);
  const layout = getHorizontalContours(
    font,
    fallbackFont,
    line,
    '',
    LAYOUT_EM,
    LAYOUT_EM,
    0,
    'left',
    1,
    0,
  );
  const rings = (layout.contours as Poly[]).filter((r) => r.length >= 3);
  if (!rings.length) {
    throw new Error('That face has no outlines for those characters. Try another one.');
  }
  // No Y flip: `pathCommandsToPolygons` already negates the font's Y-down coordinates,
  // so these arrive Y-up like the net. (The SVG reader in svgLogo.ts DOES flip — raw
  // SVG is Y-down. Do not copy one line into the other.)
  return normalizeArtwork(rings, []);
}

/** Read a dropped file as text, so the caller keeps one `await`. */
export function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}
