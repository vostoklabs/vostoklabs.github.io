// Font metrics in millimetres, for templates that talk to the user in cap heights rather than
// em sizes, and for setting several pieces on one baseline. Read from the face's own tables
// (OS/2 cap and x heights, hhea ascender/descender); a face that lacks them falls back to
// measuring an "H" and an "x", so the numbers are always real.
import { getFont } from '@vostok/fonts';

export interface TextMetrics {
  /** Cap height, mm, at this size. */
  cap: number;
  xHeight: number;
  ascender: number;
  /** Positive: how far below the baseline the deepest descender reaches. */
  descender: number;
  /** cap / size — multiply a wanted cap height by 1/capRatio to get the `size` to ask for. */
  capRatio: number;
}

const cache = new Map<string, { cap: number; x: number; asc: number; desc: number }>();

/** Measure a glyph's extent in font units with opentype's own path bbox. */
function glyphBox(font: any, char: string): { minY: number; maxY: number } | null {
  const g = font.charToGlyph(char);
  if (!g || g.index === 0) return null;
  const b = g.getPath(0, 0, font.unitsPerEm).getBoundingBox();
  // opentype's path bbox has y down; flip to the font's y-up convention.
  return { minY: -b.y2, maxY: -b.y1 };
}

export async function textMetrics(fontId: string, size: number): Promise<TextMetrics> {
  let m = cache.get(fontId);
  if (!m) {
    const font = await getFont(fontId);
    const upm = font.unitsPerEm || 1000;
    const os2 = font.tables?.os2 ?? {};
    const H = glyphBox(font, 'H');
    const x = glyphBox(font, 'x');
    const cap = os2.sCapHeight && os2.sCapHeight > 0 ? os2.sCapHeight : H ? H.maxY : upm * 0.7;
    const xh = os2.sxHeight && os2.sxHeight > 0 ? os2.sxHeight : x ? x.maxY : cap * 0.5;
    const asc = font.ascender && font.ascender > 0 ? font.ascender : cap;
    const desc = font.descender ? Math.abs(font.descender) : upm * 0.2;
    m = { cap: cap / upm, x: xh / upm, asc: asc / upm, desc: desc / upm };
    cache.set(fontId, m);
  }
  return { cap: m.cap * size, xHeight: m.x * size, ascender: m.asc * size, descender: m.desc * size, capRatio: m.cap };
}

/** The `size` to hand `textLayer` so this face's capitals come out `capMm` tall. */
export async function sizeForCapHeight(fontId: string, capMm: number): Promise<number> {
  const m = await textMetrics(fontId, 1);
  return capMm / Math.max(0.3, m.capRatio);
}
