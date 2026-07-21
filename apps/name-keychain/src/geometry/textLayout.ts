// Text → 2D polygon contours for the keychain.
//
// This is pure geometry (no DOM, no manifold) so it can be exercised headless in
// Node as well as from the app. opentype.js gives us glyph outlines; we lay each
// line out glyph-by-glyph so we can honour custom letter spacing (tracking) and
// keep per-line bounding boxes for the plate/tab/connector maths downstream.

export interface LineBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface LayoutResult {
  contours: number[][][];
  box: LineBox;
  /** One entry per rendered text line (1 for vertical / single line, 2 for two lines). */
  lines: LineBox[];
}

const EMPTY_BOX: LineBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

/** Convert opentype.js path commands into polygon contours (Y flipped for Z-up). */
export function pathCommandsToPolygons(commands: any[], decimalPlaces = 3): number[][][] {
  const polygons: number[][][] = [];
  let currentPolygon: number[][] = [];

  for (const cmd of commands) {
    const c = cmd as any;
    if (c.type === 'M') {
      if (currentPolygon.length > 2) polygons.push(currentPolygon);
      currentPolygon = [[c.x, -c.y]];
    } else if (c.type === 'L') {
      currentPolygon.push([c.x, -c.y]);
    } else if (c.type === 'Q') {
      const p0 = currentPolygon[currentPolygon.length - 1];
      if (p0) {
        const segments = 8;
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const x = (1 - t) * (1 - t) * p0[0]! + 2 * (1 - t) * t * c.x1 + t * t * c.x;
          const y = (1 - t) * (1 - t) * p0[1]! + 2 * (1 - t) * t * (-c.y1) + t * t * (-c.y);
          currentPolygon.push([x, y]);
        }
      }
    } else if (c.type === 'C') {
      const p0 = currentPolygon[currentPolygon.length - 1];
      if (p0) {
        const segments = 8;
        for (let i = 1; i <= segments; i++) {
          const t = i / segments;
          const x = Math.pow(1 - t, 3) * p0[0]! + 3 * Math.pow(1 - t, 2) * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + Math.pow(t, 3) * c.x;
          const y = Math.pow(1 - t, 3) * p0[1]! + 3 * Math.pow(1 - t, 2) * t * (-c.y1) + 3 * (1 - t) * t * t * (-c.y2) + Math.pow(t, 3) * (-c.y);
          currentPolygon.push([x, y]);
        }
      }
    } else if (c.type === 'Z') {
      if (currentPolygon.length > 2) polygons.push(currentPolygon);
      currentPolygon = [];
    }
  }
  if (currentPolygon.length > 2) polygons.push(currentPolygon);

  const factor = Math.pow(10, decimalPlaces);
  return polygons.map((poly) =>
    poly.map((pt) => [Math.round(pt[0]! * factor) / factor, Math.round(pt[1]! * factor) / factor]),
  );
}

function bboxOf(contours: number[][][]): LineBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of contours) {
    for (const pt of poly) {
      if (pt[0]! < minX) minX = pt[0]!;
      if (pt[0]! > maxX) maxX = pt[0]!;
      if (pt[1]! < minY) minY = pt[1]!;
      if (pt[1]! > maxY) maxY = pt[1]!;
    }
  }
  if (!Number.isFinite(minX)) return { ...EMPTY_BOX };
  return { minX, maxX, minY, maxY };
}

/**
 * Lay out one line of text glyph-by-glyph at baseline `yBaseline`, honouring
 * kerning plus a `letterSpacing` tracking value (fraction of the em size added
 * between every pair of glyphs; negative squashes letters together). Returns the
 * line's contours and the advance width actually used.
 */
function layoutLine(
  font: any,
  text: string,
  size: number,
  xStart: number,
  yBaseline: number,
  letterSpacing: number,
): { contours: number[][][]; width: number } {
  const scale = size / font.unitsPerEm;
  const track = letterSpacing * size;
  const glyphs = font.stringToGlyphs(text);
  const contours: number[][][] = [];
  let x = xStart;

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const path = g.getPath(x, yBaseline, size);
    contours.push(...pathCommandsToPolygons(path.commands));

    let adv = (g.advanceWidth || 0) * scale;
    if (i < glyphs.length - 1) {
      // opentype's getPath doesn't apply kerning; add it ourselves for tight pairs.
      const kern = font.getKerningValue ? font.getKerningValue(g, glyphs[i + 1]) * scale : 0;
      adv += kern + track;
    }
    x += adv;
  }

  return { contours, width: x - xStart };
}

/** Advance width of a line under the same custom letter-spacing layout. */
export function measureLine(font: any, text: string, size: number, letterSpacing: number): number {
  return layoutLine(font, text, size, 0, 0, letterSpacing).width;
}

/**
 * Horizontal layout: line 1 (optionally line 2 below it). `lineSpacing` is the
 * baseline-to-baseline gap as a fraction of the two sizes summed. `align` sets how
 * the (usually shorter) second line sits under the first.
 */
export function getHorizontalContours(
  font: any,
  text: string,
  text2: string,
  textSize: number,
  line2Size: number,
  gap: number,
  align: 'left' | 'center' | 'right',
  lineSpacing: number,
  letterSpacing: number,
): LayoutResult {
  const line2On = text2 !== '';
  const dy = (textSize + line2Size) * lineSpacing;

  // Line 1
  const y1 = line2On ? -dy / 2 : 0;
  const l1 = layoutLine(font, text, textSize, gap, y1, letterSpacing);
  const line1Contours = l1.contours;

  // Line 2, aligned under line 1.
  let line2Contours: number[][][] = [];
  if (line2On) {
    const y2 = dy / 2;
    let x2 = gap;
    if (align !== 'left') {
      const delta = l1.width - l2Width(font, text2, line2Size, letterSpacing);
      x2 = gap + (align === 'center' ? delta / 2 : delta);
    }
    line2Contours = layoutLine(font, text2, line2Size, x2, y2, letterSpacing).contours;
  }

  const contours = [...line1Contours, ...line2Contours];

  // Measure lines BEFORE mutating (they share array refs with `contours`).
  const box0 = bboxOf(contours);
  const line1Box = bboxOf(line1Contours);
  const line2Box = line2On ? bboxOf(line2Contours) : null;

  // Vertically centre the whole block around Y=0, and keep it clear of the keyring:
  // a longer/centre/right aligned 2nd line can otherwise reach left past x=gap and
  // collide with the loop tab.
  const cy = (box0.minY + box0.maxY) / 2;
  const dx = box0.minX < gap ? gap - box0.minX : 0;
  for (const poly of contours) for (const pt of poly) { pt[0] = pt[0]! + dx; pt[1] = pt[1]! - cy; }

  const shift = (b: LineBox): LineBox => ({ minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY - cy, maxY: b.maxY - cy });
  const lines: LineBox[] = [shift(line1Box)];
  if (line2Box) lines.push(shift(line2Box));

  return { contours, box: shift(box0), lines };
}

function l2Width(font: any, text: string, size: number, letterSpacing: number): number {
  return measureLine(font, text, size, letterSpacing);
}

/**
 * Vertical layout: characters stacked top-to-bottom, each centred horizontally.
 * `lineSpacing` scales the step between characters (1 = default tight stack).
 */
export function getVerticalContours(
  font: any,
  text: string,
  textSize: number,
  lineSpacing: number,
  letterSpacing: number,
): LayoutResult {
  const chars = Array.from(text);

  let capRatio = 0.70;
  if (font && font.unitsPerEm) {
    if (font.tables?.os2?.sCapHeight) {
      capRatio = font.tables.os2.sCapHeight / font.unitsPerEm;
    } else if (font.ascender) {
      capRatio = (font.ascender / font.unitsPerEm) * 0.85;
    }
  }
  capRatio = Math.max(0.55, Math.min(0.85, capRatio));

  const baseVStep = capRatio * 1.02 * textSize;
  const vstep = baseVStep * lineSpacing + letterSpacing * textSize;
  const contours: number[][][] = [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const glyphPoly = pathCommandsToPolygons(font.getPath(char, 0, 0, textSize).commands);

    // Centre this character on X, drop it by i steps on Y.
    const cb = bboxOf(glyphPoly);
    const cx = (cb.minX + cb.maxX) / 2 || 0;
    const cy = -i * vstep;
    for (const p of glyphPoly) for (const pt of p) { pt[0] = pt[0]! - cx; pt[1] = pt[1]! + cy; }
    contours.push(...glyphPoly);
  }

  const box0 = bboxOf(contours);
  const cy = (box0.minY + box0.maxY) / 2;
  for (const poly of contours) for (const pt of poly) pt[1] = pt[1]! - cy;

  const box = { ...box0, minY: box0.minY - cy, maxY: box0.maxY - cy };
  return { contours, box, lines: [box] };
}
