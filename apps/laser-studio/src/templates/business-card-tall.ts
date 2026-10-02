// A PORTRAIT business card: the pattern runs round a solid name band across the top and a solid
// details panel below it: a diamond lattice cut through a tall card, the name
// and title engraved on a band that crosses it, the address and phone on a panel lower down —
// two solid parts, not the one centre panel of the framed card, which is what makes this a
// layout of its own rather than the framed card turned on end.
//
// The band spans the card's whole inner width, so it meets the border on both sides and splits
// the pattern in two: a strip above it and the field round the details panel below. So the
// region is TWO islands — the card above the band's top less the inset, and the card below its
// bottom plus the inset with the panel as a hole — and the faces stop exactly on the band's and
// the panel's edges. Both islands are filled in one call, so the pattern runs on across the band
// unbroken, as if the band were laid over it.
//
// The lettering is ONE lockup over two slots (`fitLockup`): name, rule and title in the band,
// the two detail lines in the panel, scaled by one factor so the hierarchy holds across the two.
// A logo goes beside the name in the band, as photos E and F set it — photo C has none, and the
// details panel has no room for one: a web address at the 2.5 mm floor already fills most of its
// width, and a logo there, beside or above, shrank the name band with it.
import type { Box, Shapes } from '@vostok/laser';
import {
  BORDER, GUTTER, boxAt, boxRing, cardExportNote, cardFileName, cardInput, cardLetteringFields, cardPatternFields,
  cardPatternLayers, cardRing, cardShapeFields, cardStatus, cardSize, cardTextFields, clipY, fitLockup, letteringWarnings,
  panelSlot, patternInset, shrinkBox, type FitWords,
} from './card-shared';
import { num, type TemplateDef } from './types';

/** Which slot ran out of room says what to change: the band's width is the card's, so shortening
 *  is the one fix there; the details panel has its two sliders. */
const FIT_WORDS: FitWords = (what, bound) => {
  if (bound?.slot !== 1) return what === 'name' ? 'Name too long for the band — try a shorter form of it.' : 'Title too small to read — try a shorter form of it.';
  if (bound.axis === 'height') return 'Details too small to read — make their panel taller.';
  return what === 'name' ? 'Details too long for their panel — shorten them or widen it.' : 'Details too small to read — shorten them or widen their panel.';
};

/** The pattern strip above the name band, as a share of the card's height (photo: about one
 *  row of the lattice). */
const TOP_STRIP = 0.14;
/** The name band's height, share of the card's: 20 mm on an 85 mm card holds a 4.5 mm name, its
 *  rule and the title at full size, with the gutter above and below. */
const BAND = 0.24;
/** The details panel's centre, share of the card's height below its middle. */
const PANEL_Y = 0.2;

export const businessCardTall: TemplateDef = {
  id: 'business-card-tall',
  name: 'Tall business card',
  blurb: 'A portrait card, a cut lattice round your name and details.',
  tags: ['card', 'engrave + cut'],
  batch: { key: 'name', noun: 'card' },
  exportNote: cardExportNote,
  fields: [
    ...cardTextFields(),
    ...cardPatternFields({ value: 'argyle', zoom: 100 }),
    ...cardShapeFields([
      // From 60 %: narrower, the phone number and a web address stop fitting at their 2.5 mm floor.
      { kind: 'number', key: 'panelWidth', label: 'Panel width', section: 'Card', value: 70, min: 60, max: 80, step: 1, unit: '%' },
      { kind: 'number', key: 'panelHeight', label: 'Panel height', section: 'Card', value: 24, min: 18, max: 32, step: 1, unit: '%' },
    ], { portrait: true }),
    ...cardLetteringFields({ nameSize: 4.5, textCase: 'as-typed', align: 'centre' }),
  ],

  async build(v) {
    const [w, h] = cardSize(v, true);
    const outline = cardRing(w, h, num(v, 'corner'));
    const inset = patternInset(v);

    const bandTop = h / 2 - BORDER - TOP_STRIP * h;
    const bandBot = bandTop - BAND * h;
    const panel = boxAt(0, -PANEL_Y * h, (w * num(v, 'panelWidth')) / 100, (h * num(v, 'panelHeight')) / 100);
    const region: Shapes = [
      [clipY(outline, bandTop - inset, 'above')],
      [clipY(outline, bandBot + inset, 'below'), boxRing(shrinkBox(panel, inset), 0)],
    ];

    // The band meets the border, so its lettering needs only the border's margin sideways; above
    // and below, the gutter off the pattern's cuts.
    const band: Box = { minX: -w / 2 + BORDER, maxX: w / 2 - BORDER, minY: bandBot + GUTTER, maxY: bandTop - GUTTER };
    const pat = await cardPatternLayers(region, v);
    const lettering = await fitLockup(v, [
      { box: band, align: 'centre', roles: ['logo', 'name', 'rule', 'title'], logo: 'beside' },
      { box: panelSlot(panel, inset), align: 'centre', roles: ['phone', 'line4'] },
    ]);
    return cardInput([[outline]], [...pat.layers, ...lettering.layers], [...pat.warnings, ...letteringWarnings(v, lettering, FIT_WORDS)], cardStatus(pat.status, lettering));
  },

  fileName: cardFileName('business-card-tall'),
};
