// Bracelets and card, with a SYMBOL on each bar instead of a word.
//
// Another template, with an emoji/symbol/SVG instead of text. It is the same product — the same
// card, the same notches, the same tear-off line, the same bars to the millimetre — so it is the
// same build with one parameter flipped rather than a
// second copy of it (`bracelet-set.ts` `makeBraceletSet`). Only what goes on the bar differs.
//
// SVG import comes free: the symbol picker's "Import your own SVG" traces the file, stores it
// under a private-use character in `values.__symbols` and hands that character back as the
// field's value — the same route `svg-keychain.ts` takes. One `symbol` field per bracelet is
// therefore an icon library AND the customer's own artwork, with nothing here to write for it.
import { makeBraceletSet } from './bracelet-set';

export const braceletSetSymbol = makeBraceletSet({
  id: 'bracelet-set-symbol',
  name: 'Bracelets and card — symbols',
  blurb: 'The same set with an icon or your own SVG on each bar instead of a word.',
  symbolBars: true,
});
