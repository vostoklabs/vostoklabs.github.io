// The registry, not the `@vostok/fonts` barrel. `vite.config.ts` imports this file too, and
// vite runs a config in Node, which loads a bare import as it is: the barrel reaches every
// font file through Vite's glob, while the registry imports nothing and loads in Node by the
// package's own name.
import { FONTS } from '@vostok/fonts/registry';

/** The heaviest face this app will ship, bytes.
 *
 *  Not a taste judgement — a budget. This app goes to MakerLab as a ZIP and the
 *  developer guide asks for 10 MB or less, or the SDK handshake can miss its 10 s
 *  timeout (`makerlab/pack.mjs` warns above that figure). The whole library is
 *  256 faces / 37.1 MB of TTF, which a zip cannot carry; under 149 KB it is 190
 *  faces / 13.5 MB, about 6.8 MB compressed.
 *
 *  What the cut actually removes is the fonts that carry a script this app has no
 *  use for — Gaegu is 3.0 MB of Korean, DotGothic16 1.9 MB of Japanese — plus a
 *  handful of decorative faces whose outlines are genuinely enormous (Rubik Spray
 *  Paint is 477 KB of speckle). Every one of the eleven categories survives it.
 *
 *  The floor is whatever keeps every face this generator already shipped. Anton is
 *  127 KB and is this app's DEFAULT face: a budget that silently drops the font the
 *  box opens on is a budget that broke the app. 149 because Libre Baskerville ships as
 *  its original file (148.5 KB; its licence keeps the name off a cut copy), and a box
 *  saved with it must still load. */
const MAX_FONT_BYTES = 149 * 1024;

/** The faces the logo offers.
 *
 *  Derived, not hand-written. It was a list of eight until 2026-09-19, and the list
 *  was the reason the app still offered eight after the shared library grew to 241:
 *  nothing here tracked the package. Now the only thing this file states is the
 *  budget, and the set follows the library on its own.
 *
 *  `vite.config.ts` imports this as well as the app does — `keepOnlyFonts` narrows
 *  the package's `import.meta.glob` to exactly these, so the bundle carries these
 *  TTFs rather than all 241. That matters twice: every app's build emits its own
 *  copy of each face, and the offline build inlines them as base64.
 *
 *  `icon-fallback` is last and is not a text face: it is Material Symbols at FILL=1,
 *  and it is what makes "insert a symbol" work. `getHorizontalContours` already
 *  consults a fallback font for glyphs the chosen face is missing, so a heart typed
 *  into the text field comes out of this file with no separate code path at all. It
 *  is added explicitly because it is not in `FONTS` and is over the budget anyway. */
export const LOGO_TEXT_FONTS = FONTS.filter(
  // `bytes` is optional because a face can be injected at runtime by an app that takes
  // font uploads. This app takes none, so an unknown size here means a registry that
  // was not regenerated — exclude it rather than ship a face of unknown weight.
  (f) => typeof f.bytes === 'number' && f.bytes <= MAX_FONT_BYTES,
).map((f) => f.id);

export const LOGO_FONTS = [...LOGO_TEXT_FONTS, 'icon-fallback'];

/** The ones pinned to the top of the picker, before the rest of the library.
 *
 *  A box logo is one word, and these are the faces that read at 20 mm on card: heavy
 *  display cuts, one script, one pixel. The picker's own search and category chips
 *  cover the other 160-odd. */
export const LOGO_FEATURED = [
  'anton',
  'bebas-neue',
  'oswald',
  'playfair-display',
  'chakra-petch',
  'righteous',
  'permanent-marker',
  'press-start-2p',
  'alfa-slab-one',
  'bungee',
  'dela-gothic-one',
  'staatliches',
];
