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
  fallbackFont: any,
  text: string,
  size: number,
  xStart: number,
  yBaseline: number,
  letterSpacing: number,
): { contours: number[][][]; width: number } {
  const scale = size / font.unitsPerEm;
  const fbScale = fallbackFont ? size / fallbackFont.unitsPerEm : scale;
  const track = letterSpacing * size;
  const chars = Array.from(text);
  const contours: number[][][] = [];
  let x = xStart;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    let g = font.charToGlyph(char);
    let isFb = false;

    if ((!g || g.index === 0) && fallbackFont) {
      const fbG = fallbackFont.charToGlyph(char);
      if (fbG && fbG.index !== 0) {
        g = fbG;
        isFb = true;
      }
    }

    const activeScale = isFb ? fbScale : scale;
    const path = g.getPath(x, yBaseline, size);
    contours.push(...pathCommandsToPolygons(path.commands));

    let adv = (g.advanceWidth || 0) * activeScale;
    if (i < chars.length - 1 && !isFb) {
      const nextChar = chars[i + 1]!;
      const nextG = font.charToGlyph(nextChar);
      if (nextG && nextG.index !== 0) {
        const kern = font.getKerningValue ? font.getKerningValue(g, nextG) * scale : 0;
        adv += kern;
      }
    }
    adv += track;
    x += adv;
  }

  return { contours, width: x - xStart };
}

/** Advance width of a line under the same custom letter-spacing layout. */
export function measureLine(font: any, fallbackFont: any, text: string, size: number, letterSpacing: number): number {
  return layoutLine(font, fallbackFont, text, size, 0, 0, letterSpacing).width;
}

/** Extras for callers that need more than "put line 2 under line 1". Optional throughout,
 *  so every existing call keeps its exact behaviour. */
export interface HorizontalOptions {
  /**
   * `line2` (default) moves only the second line, which is what the keychain wants — its
   * first line is the name and must stay put against the keyring tab.
   *
   * `block` aligns **both** lines inside the block, the way a text editor does. A house
   * sign needs this: its short line is usually the number, so aligning "the second line"
   * left the number pinned and moved the street name, and the control looked broken from
   * the only seat that matters — a user watching the big number not move.
   */
  alignMode?: 'line2' | 'block';
  /**
   * Which side of line 1 line 2 goes on.
   *
   * `below` (default) and `above` stack the two lines; `left` and `right` put them on one row
   * sharing a baseline, so a door plate can read `12 MEETING ROOM` with the number and the
   * name at their own sizes. On one row `lineSpacing` means the gap between them, as a
   * fraction of the smaller size.
   *
   * `beside` is the old name for `right` and still resolves to it — name-keychain passes it,
   * and a saved project can carry it.
   */
  placement?: 'below' | 'above' | 'left' | 'right' | 'beside';
  /**
   * How the two lines sit against each other on a shared row. Ignored when stacked.
   *
   * `bottom` (default) is the shared baseline the row is laid out on, which is what "sitting
   * on the same line" means to a reader and what keeps a descender hanging where it should.
   * `top` and `middle` measure the ink instead, for a small line set against the cap height
   * of a large one.
   */
  vAlign?: 'top' | 'middle' | 'bottom';
}

/**
 * Horizontal layout: line 1, optionally with line 2 below it or beside it. `lineSpacing` is
 * the baseline-to-baseline gap as a fraction of the two sizes summed. `align` sets how the
 * lines sit against each other — see `HorizontalOptions.alignMode`.
 */
export function getHorizontalContours(
  font: any,
  fallbackFont: any,
  text: string,
  text2: string,
  textSize: number,
  line2Size: number,
  gap: number,
  align: 'left' | 'center' | 'right',
  lineSpacing: number,
  letterSpacing: number,
  opts: HorizontalOptions = {},
): LayoutResult {
  const line2On = text2 !== '';
  const alignMode = opts.alignMode ?? 'line2';
  const placement = opts.placement === 'beside' ? 'right' : (opts.placement ?? 'below');
  const side = line2On && (placement === 'left' || placement === 'right');
  const dy = (textSize + line2Size) * lineSpacing;

  let line1Contours: number[][][];
  let line2Contours: number[][][] = [];

  if (side) {
    // One row. Both sit on the same baseline so the caps line up along the bottom, which is
    // how a number and a room name read as one label rather than two stacked things; the
    // gap between them scales with the smaller type, not with the whole block.
    const sep = line2Size * Math.max(0.2, Math.abs(lineSpacing));
    const w1 = measureLine(font, fallbackFont, text, textSize, letterSpacing);
    const w2 = measureLine(font, fallbackFont, text2, line2Size, letterSpacing);
    const leftFirst = placement === 'left';
    line1Contours = layoutLine(
      font, fallbackFont, text, textSize, leftFirst ? gap + w2 + sep : gap, 0, letterSpacing,
    ).contours;
    line2Contours = layoutLine(
      font, fallbackFont, text2, line2Size, leftFirst ? gap : gap + w1 + sep, 0, letterSpacing,
    ).contours;

    /*
     * The cross-axis alignment, and it only exists on this branch.
     *
     * Stacked, "align" means left/centre/right and `align` already does it. On one row that
     * control has nothing to move — both lines are placed by their own advance widths — and
     * the question becomes the other one: does the small line sit on the big one's baseline,
     * against its cap height, or halfway up. There was no answer to that at all, so a room
     * name beside a 45 mm numeral could only ever sit on the floor.
     */
    const vAlign = opts.vAlign ?? 'bottom';
    if (vAlign !== 'bottom') {
      const b1 = bboxOf(line1Contours);
      const b2 = bboxOf(line2Contours);
      const shiftY = vAlign === 'top'
        ? b1.maxY - b2.maxY
        : (b1.minY + b1.maxY) / 2 - (b2.minY + b2.maxY) / 2;
      if (shiftY !== 0) for (const poly of line2Contours) for (const pt of poly) pt[1] = pt[1]! + shiftY;
    }
  } else {
    /*
     * Stacked, and the two directions get there differently on purpose.
     *
     * `below` places each line straight at its own baseline, exactly as it always has. That
     * matters more than the symmetry would suggest: `pathCommandsToPolygons` rounds to three
     * decimals, so laying a line out flat and shifting it afterwards rounds *before* the shift
     * and lands a micron off where laying it out at its final baseline does. A micron is
     * nothing to a printer and everything to "did this change any existing sign" — measured
     * across 1620 layouts, this is the difference between a worst-case delta of 0.001 mm and
     * of exactly zero.
     *
     * `above` cannot do that, because its separation is not known until both lines exist.
     * `lineSpacing` is a BASELINE separation, and a baseline separation only reads the same
     * from both sides when the taller line is the one on top: with a 60 mm number over an
     * 18 mm street name it leaves a 30 mm gap, and the same two lines the other way up let the
     * number's own 43 mm of cap height eat the whole separation — measured at 0.89 mm, with
     * the divider that belongs between them welded to both. So `above` lays both out flat,
     * measures the ink, and solves for the separation that reproduces `below`'s gap.
     */
    const stackedAbove = line2On && placement === 'above';
    const y1 = line2On && !stackedAbove ? -dy / 2 : 0;
    const l1 = layoutLine(font, fallbackFont, text, textSize, gap, y1, letterSpacing);
    line1Contours = l1.contours;

    if (line2On) {
      const w2 = l2Width(font, fallbackFont, text2, line2Size, letterSpacing);
      let x2 = gap;

      if (alignMode === 'block') {
        // Both lines placed inside a block as wide as the wider of them, so whichever line
        // is short is the one that visibly moves.
        const blockW = Math.max(l1.width, w2);
        const offset = (w: number) =>
          align === 'left' ? 0 : align === 'center' ? (blockW - w) / 2 : blockW - w;
        const shiftBy = offset(l1.width);
        if (shiftBy !== 0) for (const poly of line1Contours) for (const pt of poly) pt[0] = pt[0]! + shiftBy;
        x2 = gap + offset(w2);
      } else if (align !== 'left') {
        const delta = l1.width - w2;
        x2 = gap + (align === 'center' ? delta / 2 : delta);
      }
      const y2 = stackedAbove ? 0 : dy / 2;
      line2Contours = layoutLine(font, fallbackFont, text2, line2Size, x2, y2, letterSpacing).contours;

      if (stackedAbove) {
        const b1 = bboxOf(line1Contours);
        const b2 = bboxOf(line2Contours);
        // Solved so that `gapAbove === gapBelow`; see the note above for the derivation.
        const sep = dy + (b1.minY + b1.maxY) - (b2.minY + b2.maxY);
        for (const poly of line1Contours) for (const pt of poly) pt[1] = pt[1]! - sep / 2;
        for (const poly of line2Contours) for (const pt of poly) pt[1] = pt[1]! + sep / 2;
      }
    }
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

function l2Width(font: any, fallbackFont: any, text: string, size: number, letterSpacing: number): number {
  return measureLine(font, fallbackFont, text, size, letterSpacing);
}

/**
 * Vertical layout: characters stacked top-to-bottom, each centred horizontally.
 * `lineSpacing` scales the step between characters (1 = default tight stack).
 */
export function getVerticalContours(
  font: any,
  fallbackFont: any,
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
    let g = font.charToGlyph(char);
    if ((!g || g.index === 0) && fallbackFont) {
      const fbG = fallbackFont.charToGlyph(char);
      if (fbG && fbG.index !== 0) g = fbG;
    }
    const glyphPoly = pathCommandsToPolygons(g.getPath(0, 0, textSize).commands);

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
