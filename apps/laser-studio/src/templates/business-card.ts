// A business card with a pattern BAND down one side and the lettering in the column beside it —
// the first of the five card layouts (`card-shared.ts` holds what they share): a
// tumbling-blocks lattice cut through down the left third of a maple card, the lettering
// engraved in the rest.
//
// The band is `patternWidth` % of the card measured from its outer edge, the border included:
// the pattern's faces stop BORDER in from the three outer edges (the fill's own margin) and at
// the band's inner edge `xV`, because the region runs `inset` past it into the solid card. The
// column starts GUTTER past `xV`, so the lettering is 3 mm clear of the nearest cut whatever the
// pattern — the band's old clearance, kept.
//
// Old saves open as the card they were: the first version's `pattern` was
// hexagons | lattice | circles | none, and `patternSide` / `patternWidth` keep their keys here,
// so a saved band keeps its side and width (`cardPattern` maps the old names).
import type { Box, Shapes } from '@vostok/laser';
import {
  BORDER, GUTTER, cardExportNote, cardFileName, cardInput, cardLetteringFields, cardPattern, cardPatternFields,
  cardPatternLayers, cardRing, cardShapeFields, cardStatus, cardSize, cardTextFields, clipX, columnWords, fitLockup, letteringWarnings,
  mirrorBox, mirrorRings, patternInset, sideField,
} from './card-shared';
import { num, str, type TemplateDef, type Values } from './types';

/** What lettering too long for its column says — the two things that change it. */
const FIT_WORDS = columnWords('the column');

const hasPattern = (v: Values) => cardPattern(v) !== null;

export const businessCard: TemplateDef = {
  id: 'business-card',
  name: 'Business card',
  blurb: 'A cut pattern band beside your name and details.',
  tags: ['card', 'engrave + cut'],
  batch: { key: 'name', noun: 'card' },
  exportNote: cardExportNote,
  fields: [
    ...cardTextFields(),
    // Tumbling blocks at 70 %: the photo's cubes are about 7 mm across on an 85 mm card.
    ...cardPatternFields({ value: 'cubes', zoom: 70 }),
    ...cardShapeFields([
      { ...sideField('left'), visibleWhen: hasPattern },
      {
        kind: 'number', key: 'patternWidth', label: 'Pattern width', section: 'Card',
        value: 35, min: 25, max: 45, step: 1, unit: '%', visibleWhen: hasPattern,
        help: 'The text column shrinks to fill whatever is left.',
      },
    ]),
    ...cardLetteringFields({ align: 'left' }),
  ],

  async build(v) {
    const [w, h] = cardSize(v);
    const card: Shapes = [[cardRing(w, h, num(v, 'corner'))]];
    const pattern = cardPattern(v);
    const right = str(v, 'patternSide') === 'right';

    // Built on the left, then mirrored: the card is symmetric, so one construction serves both.
    const xV = -w / 2 + (w * num(v, 'patternWidth')) / 100;
    let region: Shapes = pattern ? [[clipX(card[0]![0]!, xV + patternInset(v), 'left')]] : [];
    // No pattern: the band's width goes to the column, so a card with the pattern off does not
    // read as a template with a feature missing.
    let column: Box = { minX: pattern ? xV + GUTTER : -w / 2 + BORDER, maxX: w / 2 - BORDER, minY: -h / 2 + BORDER, maxY: h / 2 - BORDER };
    if (right) {
      region = mirrorRings(region);
      column = mirrorBox(column);
    }

    const pat = await cardPatternLayers(region, v);
    const lettering = await fitLockup(v, [{ box: column, align: 'left' }]);
    return cardInput(card, [...pat.layers, ...lettering.layers], [...pat.warnings, ...letteringWarnings(v, lettering, FIT_WORDS)], cardStatus(pat.status, lettering));
  },

  fileName: cardFileName('business-card'),
};
