// Text → islands of rings, through @vostok/fonts. Live text never reaches a file: a text item
// is outlines from the moment it is placed, which is what every laser front-end wants.
import type { CutRing } from '@vostok/export';
import { curatedFonts, getFont, getHorizontalContours, FALLBACK_FONT_ID } from '@vostok/fonts';
import { centreShapes } from './rings';
// Pure geometry: it lives in rings.ts so it can be tested without a font pipeline.
export { islandsFromContours } from './rings';
import { islandsFromContours } from './rings';

export interface TextParams {
  text: string;
  line2: string;
  font: string;
  /** Letter size (cap height-ish), mm. */
  size: number;
  /** Tracking as a fraction of the size. */
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
}

export const DEFAULT_TEXT: TextParams = {
  text: 'Your text',
  line2: '',
  font: curatedFonts()[0]?.id ?? 'roboto',
  size: 12,
  letterSpacing: 0,
  align: 'center',
};

/** Lay the text out and hand back centred islands. Empty text gives an empty list. */
export async function buildText(p: TextParams): Promise<CutRing[][]> {
  if (!p.text.trim() && !p.line2.trim()) return [];
  const [font, fallback] = await Promise.all([getFont(p.font), getFont(FALLBACK_FONT_ID).catch(() => null)]);
  const layout = getHorizontalContours(font, fallback, p.text, p.line2, p.size, p.size * 0.7, 0, p.align, 0.55, p.letterSpacing, {
    alignMode: 'block',
  });
  return centreShapes(islandsFromContours(layout.contours)).shapes;
}

/** A symbol from the icon font, as islands, `size` mm tall. */
export async function buildSymbol(char: string, size: number): Promise<CutRing[][]> {
  const font = await getFont(FALLBACK_FONT_ID);
  const layout = getHorizontalContours(font, null, char, '', size, size, 0, 'center', 0.55, 0);
  return centreShapes(islandsFromContours(layout.contours)).shapes;
}
