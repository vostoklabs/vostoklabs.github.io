import { pathCommandsToPolygons } from '@vostok/fonts/textLayout';
import { islandsFromContours } from '@vostok/laser/rings';
import { toSymbolFrame, type Shapes } from './outline';

/**
 * One glyph of a parsed opentype font as shapes in the symbol frame (centred, longest side 1,
 * Y up). The font's contours keep their winding, and coincident pairs cancel
 * (`islandsFromContours`), so what comes out is what the font draws. Empty for a character the
 * font does not have.
 *
 * The font is passed in, so this runs anywhere: the browser hands it the icon font from
 * `@vostok/fonts`, a node test or script one parsed from the file.
 */
export function glyphShapes(font: { charToGlyph(char: string): any }, char: string): Shapes {
  const glyph = font.charToGlyph(char);
  if (!glyph || glyph.index === 0) return [];
  const contours = pathCommandsToPolygons(glyph.getPath(0, 0, 100).commands).filter((c) => c.length >= 3);
  return toSymbolFrame(islandsFromContours(contours));
}
