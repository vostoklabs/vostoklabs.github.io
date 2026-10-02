// A business card with one HALF given to one big pattern — a burst opening from the card's edge
// — and the lettering in the other half: a dahlia-like burst cut through the right half of a
// walnut card, logo, name, title and contact lines engraved on the left.
//
// The burst's edge is an ARC, not a straight divider: in the photo the petals stop along a curve,
// the way a flower does. The region is the card and a disc centred on the card's outer edge; the
// disc's radius puts the pattern's nearest cut `patternWidth` % of the card from that edge, and
// the pattern's own centre sits on that edge too, so a radial pattern opens from it. Between the
// arc and the lettering stays a solid divider GUTTER (3 mm) wide at its narrowest — at least
// 2.5 mm — and the card's border runs round the rest.
//
// The default is Dahlia (`card-dahlia.ts`), drawn for this card: rings of pointed petals opening
// from the edge, each ring turned half a petal against the last, as in the photo. Nothing in the
// library came close — Rays opening from the edge was a fan of twelve wedges, a rising sun.
import { circleRing, type Box, type Shapes } from '@vostok/laser';
import {
  BORDER, GUTTER, cardExportNote, cardFileName, cardInput, cardLetteringFields, cardPatternFields,
  cardPatternLayers, cardRing, cardShapeFields, cardStatus, cardSize, cardTextFields, clipConvex, columnWords, fitLockup,
  letteringWarnings, mirrorBox, mirrorRings, patternInset, sideField,
} from './card-shared';
import { num, str, type TemplateDef } from './types';

const FIT_WORDS = columnWords('its half');

export const businessCardHalf: TemplateDef = {
  id: 'business-card-half',
  name: 'Business card, half pattern',
  blurb: 'One half a cut burst of petals, the other your details.',
  tags: ['card', 'engrave + cut'],
  batch: { key: 'name', noun: 'card' },
  exportNote: cardExportNote,
  fields: [
    ...cardTextFields(),
    ...cardPatternFields({ value: 'dahlia', zoom: 100 }),
    ...cardShapeFields([
      sideField('right'),
      {
        kind: 'number', key: 'patternWidth', label: 'Pattern width', section: 'Card',
        value: 46, min: 40, max: 60, step: 1, unit: '%',
        help: 'How far the burst reaches across the card.',
      },
    ]),
    ...cardLetteringFields({ nameSize: 5.5, textCase: 'as-typed', align: 'centre' }),
  ],

  async build(v) {
    const [w, h] = cardSize(v);
    const outline = cardRing(w, h, num(v, 'corner'));
    const card: Shapes = [[outline]];
    const inset = patternInset(v);

    // Built with the burst on the right, then mirrored for the left.
    const reach = (w * num(v, 'patternWidth')) / 100;
    const xV = w / 2 - reach;
    // The disc: centred on the card's outer edge, its radius the burst's reach plus the inset,
    // so the faces stop exactly at `xV` on the card's centre line and curve away above and below.
    const disc = circleRing(w / 2, 0, reach + inset, 96);
    let region: Shapes = [[clipConvex(outline, disc)]];
    let column: Box = { minX: -w / 2 + BORDER, maxX: xV - GUTTER, minY: -h / 2 + BORDER, maxY: h / 2 - BORDER };
    const right = str(v, 'patternSide') !== 'left';
    if (!right) {
      region = mirrorRings(region);
      column = mirrorBox(column);
    }
    // The pattern opens from the card's edge, not from the middle of its half.
    const regionMid = (xV - inset + w / 2) / 2;
    const pat = await cardPatternLayers(region, v, (right ? 1 : -1) * (w / 2 - regionMid));

    const lettering = await fitLockup(v, [{ box: column, align: 'centre' }]);
    return cardInput(card, [...pat.layers, ...lettering.layers], [...pat.warnings, ...letteringWarnings(v, lettering, FIT_WORDS)], cardStatus(pat.status, lettering));
  },

  fileName: cardFileName('business-card-half'),
};

