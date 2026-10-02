// A business card with the pattern down one side and a solid logo TILE set into its inner edge.
// A leaf-and-petal lattice cut through the left of a walnut card, a rounded square of
// solid wood let into the lattice at its inner edge carrying the logo, and the name, title and
// contact lines engraved flush left on the right.
//
// The tile is a NOTCH in the pattern's region: the region is the card's pattern side, less a
// rounded rectangle cut into it from its inner edge, so the faces stop on three sides of the
// tile and its fourth side merges with the solid card beside the pattern — the tile reads as
// set INTO the lattice, not laid on it. The notch is the tile shrunk by the fill's inset, so the
// tile's visible corners round to that inset plus the notch's own `NOTCH_R`.
//
// The pattern is centred on the tile, so the tile fills one of its cells and the cells round it
// stay whole or halved. The tile carries the customer's logo, or — none chosen — the name's
// initials in the card's face: a tile is never empty, and the default card is the photo's.
import type { Box, Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import {
  BORDER, GUTTER, cardExportNote, cardFileName, cardInput, cardLetteringFields, cardPatternFields,
  cardPatternLayers, cardRing, cardShapeFields, cardStatus, cardSize, cardTextFields, clipX, columnWords, fitLockup, letteringWarnings,
  mirrorBox, mirrorRings, patternInset, shrinkBox, sideField, tileMark,
} from './card-shared';
import { num, str, type TemplateDef } from './types';

const FIT_WORDS = columnWords('the column');

/** The notch's own corner radius, mm; the tile shows this plus the inset (5.5 mm at a 4 mm
 *  border) — a rounded square, as in the photo. */
const NOTCH_R = 1.5;
/** The mark fills this share of the tile each way — the photo's logo sits well inside its tile. */
const MARK = 0.6;
/** The least lattice kept above and below the tile, mm: a strip thinner than a cell reads as a
 *  mistake. */
const STRIP = 6;

/**
 * The pattern side of the card with the tile's notch cut into its inner edge at x = `xR`: the
 * card clipped to x ≤ xR, and the right-hand edge (which a counter-clockwise ring climbs) led
 * round the notch — left along its bottom, up its rounded left side, right along its top.
 */
function notchedSide(outline: CutRing, xR: number, notch: Box): CutRing {
  const side = clipX(outline, xR, 'left');
  const out: CutRing = [];
  const arc = (cx: number, cy: number, from: number, to: number) => {
    for (let i = 0; i <= 6; i++) {
      const t = from + ((to - from) * i) / 6;
      out.push([cx + NOTCH_R * Math.cos(t), cy + NOTCH_R * Math.sin(t)]);
    }
  };
  for (let i = 0; i < side.length; i++) {
    const a = side[i]!;
    const b = side[(i + 1) % side.length]!;
    out.push(a);
    const climbs = Math.abs(a[0] - xR) < 1e-9 && Math.abs(b[0] - xR) < 1e-9 && a[1] < notch.minY && b[1] > notch.maxY;
    if (!climbs) continue;
    out.push([xR, notch.minY]);
    arc(notch.minX + NOTCH_R, notch.minY + NOTCH_R, -Math.PI / 2, -Math.PI);
    arc(notch.minX + NOTCH_R, notch.maxY - NOTCH_R, Math.PI, Math.PI / 2);
    out.push([xR, notch.maxY]);
  }
  return out;
}

export const businessCardLogoTile: TemplateDef = {
  id: 'business-card-logo-tile',
  name: 'Business card, logo tile',
  blurb: 'A cut lattice with your logo on a tile set into it.',
  tags: ['card', 'engrave + cut'],
  batch: { key: 'name', noun: 'card' },
  exportNote: cardExportNote,
  fields: [
    ...cardTextFields({ logoHelp: 'Left empty, the tile carries your initials.' }),
    ...cardPatternFields({ value: 'shippo', zoom: 175 }),
    ...cardShapeFields([
      sideField('left'),
      {
        kind: 'number', key: 'patternWidth', label: 'Pattern width', section: 'Card',
        value: 42, min: 35, max: 55, step: 1, unit: '%',
        help: 'The text column shrinks to fill whatever is left.',
      },
      { kind: 'number', key: 'tileSize', label: 'Tile size', section: 'Card', value: 20, min: 14, max: 24, step: 0.5, unit: 'mm' },
    ]),
    ...cardLetteringFields({ logoSize: false, textCase: 'as-typed', align: 'left' }),
  ],

  async build(v) {
    const [w, h] = cardSize(v);
    const outline = cardRing(w, h, num(v, 'corner'));
    const inset = patternInset(v);

    // Built on the left, then mirrored. `xV` is where the pattern's faces stop; the region runs
    // `inset` past it into the solid card.
    const xV = -w / 2 + (w * num(v, 'patternWidth')) / 100;
    const latticeW = xV - (-w / 2 + BORDER);
    const s = Math.min(num(v, 'tileSize'), latticeW, h - 2 * (BORDER + STRIP));
    const tile: Box = { minX: xV - s, maxX: xV, minY: -s / 2, maxY: s / 2 };
    // The notch: the tile less the inset on its three lattice sides, run a millimetre past the
    // region's edge so the cut is clean.
    const notch: Box = { minX: tile.minX + inset, maxX: xV + inset + 1, minY: tile.minY + inset, maxY: tile.maxY - inset };
    let region: Shapes = [[notchedSide(outline, xV + inset, notch)]];
    let column: Box = { minX: xV + 2 * GUTTER, maxX: w / 2 - BORDER, minY: -h / 2 + BORDER, maxY: h / 2 - BORDER };
    // The mark keeps GUTTER off the lattice round the tile, whose corners are rounded to the
    // notch's radius plus the inset — so at a small tile the corners, not MARK, set the margin.
    const R = NOTCH_R + inset;
    let markBox = shrinkBox(tile, Math.max(((1 - MARK) * s) / 2, R - (R - GUTTER) / Math.SQRT2));
    // The pattern is centred on the TILE, not on its side of the card: the tile then sits in one
    // cell of it, and the cells round it are whole or halved, never the crescents a tile laid
    // across a cell's edge leaves (Position still nudges it from there).
    let dx = (tile.minX + tile.maxX) / 2 - (-w / 2 + xV + inset) / 2;
    if (str(v, 'patternSide') === 'right') {
      region = mirrorRings(region);
      column = mirrorBox(column);
      markBox = mirrorBox(markBox);
      dx = -dx;
    }

    const pat = await cardPatternLayers(region, v, dx);
    const [mark, lettering] = await Promise.all([tileMark(v, markBox), fitLockup(v, [{ box: column, align: 'left', roles: ['name', 'rule', 'title', 'phone', 'line4'] }])]);
    return cardInput([[outline]], [...pat.layers, ...mark, ...lettering.layers], [...pat.warnings, ...letteringWarnings(v, lettering, FIT_WORDS)], cardStatus(pat.status, lettering));
  },

  fileName: cardFileName('business-card-logo-tile'),
};

