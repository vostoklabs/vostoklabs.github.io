// A business card with the pattern everywhere round a solid centre PANEL that carries the
// lettering: a diamond interlace round a panel with the logo beside the name and contact lines,
// or the same layout with diagonal lines that turn round the panel like rays from the card's
// centre — one layout, two patterns, one template.
//
// The panel is `panelWidth` × `panelHeight` % of the card, centred. It is the region's hole —
// a reserve — shrunk by the fill's inset, so the faces stop exactly at the panel's edge and the
// panel's corners come out rounded by that inset (4 mm). Every strut lands on the panel at one
// end and on the border at the other; the panel is what anchors a radial pattern's inner ends,
// which is why Rays here reads as photo F's sunburst. The lettering sits GUTTER inside the
// panel (a little more at its rounded corners, `panelSlot`), centred, with a logo — when there
// is one — beside the lines as in both photos. The default panel is 64 × 55 %: the photo's is a
// shade smaller, but its lines are too — at 45 % the four lines only fit by giving up the
// 2.5 mm floor of the phone number, which is why Panel height stops at 50 %.
import type { Shapes } from '@vostok/laser';
import {
  boxAt, boxRing, cardExportNote, cardFileName, cardInput, cardLetteringFields, cardPatternFields,
  cardPatternLayers, cardRing, cardShapeFields, cardStatus, cardSize, cardTextFields, fitLockup, letteringWarnings,
  panelSlot, patternInset, shrinkBox, type FitWords,
} from './card-shared';
import { num, type TemplateDef } from './types';

/** The panel's two sliders are the two fixes; the axis that ran out says which one. */
/** Rays on this card: photo F's frame is fine slots, and Rays' own 24 are wide wedges here. At
 *  48 the slots' tips near the panel narrow past the 1 mm opening and stop short of it, leaving
 *  a ragged panel edge; 36 is the finest count at which every slot still lands on the panel. */
const RAYS = 36;

const FIT_WORDS: FitWords = (what, bound) => {
  const tall = bound?.axis === 'height';
  if (what === 'details') return tall ? 'Details too small to read — make the panel taller.' : 'Details too small to read — shorten them or widen the panel.';
  return tall ? 'Lettering too tall for the panel — make the panel taller.' : 'Name too long for the panel — shorten it or widen the panel.';
};

export const businessCardFramed: TemplateDef = {
  id: 'business-card-framed',
  name: 'Business card, framed',
  blurb: 'A cut lattice all round a solid panel for your details.',
  tags: ['card', 'engrave + cut'],
  batch: { key: 'name', noun: 'card' },
  exportNote: cardExportNote,
  fields: [
    ...cardTextFields(),
    ...cardPatternFields({ value: 'diamond-lattice', zoom: 85 }),
    ...cardShapeFields([
      { kind: 'number', key: 'panelWidth', label: 'Panel width', section: 'Card', value: 64, min: 50, max: 76, step: 1, unit: '%' },
      { kind: 'number', key: 'panelHeight', label: 'Panel height', section: 'Card', value: 55, min: 50, max: 66, step: 1, unit: '%' },
    ]),
    ...cardLetteringFields({ nameSize: 4.5, textCase: 'as-typed', align: 'centre' }),
  ],

  async build(v) {
    const [w, h] = cardSize(v);
    const outline = cardRing(w, h, num(v, 'corner'));
    const panel = boxAt(0, 0, (w * num(v, 'panelWidth')) / 100, (h * num(v, 'panelHeight')) / 100);
    const inset = patternInset(v);
    const region: Shapes = [[outline, boxRing(shrinkBox(panel, inset), 0)]];

    const pat = await cardPatternLayers(region, v, 0, { rays: { count: RAYS } });
    const lettering = await fitLockup(v, [{ box: panelSlot(panel, inset), align: 'centre', logo: 'beside' }]);
    return cardInput([[outline]], [...pat.layers, ...lettering.layers], [...pat.warnings, ...letteringWarnings(v, lettering, FIT_WORDS)], cardStatus(pat.status, lettering));
  },

  fileName: cardFileName('business-card-framed'),
};
