/*
  The cap's colour when nobody picked one (src/frame.ts), and the words' on it (src/words.ts).

  - **As before**: a design with its picture gets the frame it always got (an image its biggest
    colour, line art a light or dark one that contrasts it, blocks a light cap), whether `blank`
    is false or not there at all, and whatever the body is.
  - **Blank, two-tone**: the button is the design's own ink, unless that is too close to the body
    to tell apart, when it is a light or dark one that contrasts the body. A colour picked for it
    wins. Blocks' caps follow the same rule against the body. A cut model has no picture and
    ignores it.
  - **The words on a blank** take the body's filament where it reads on the button, so the
    clicker stays in two colours, and a plain ink that does where it does not.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs frame
*/
import {
  DARK_FRAME, LIGHT_FRAME, TWO_TONE_MIN, capColourOf, contrastingFrame, deriveFrameColor, isBlank, type FrameSource,
} from '../src/frame.ts';
import { wordsColour, wordsColourOf } from '../src/words.ts';
type PaletteEntry = import('../src/types.ts').PaletteEntry;
type RGB = import('../src/types.ts').RGB;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const show = (c: RGB) => JSON.stringify(c);

const entry = (rgb: RGB, coverage: number): PaletteEntry => ({ quantRgb: rgb, filamentRgb: rgb, coverage });
const NAVY: RGB = [20, 40, 110];
const ORANGE: RGB = [240, 120, 20];
const WHITE: RGB = [250, 250, 250];
const BODY_LIGHT: RGB = [240, 240, 240];
const BODY_DARK: RGB = [38, 38, 42];
/** A picture of mostly navy with a little orange. */
const palette = [entry(ORANGE, 0.2), entry(NAVY, 0.7)];
const MODES = ['image', 'svg', 'icon', 'text', 'blocks', 'model'] as const;

/* ------------------------------------------------------------------ as before */

for (const importMode of MODES) {
  const before = deriveFrameColor({ importMode, palette, baseColorOverride: null });
  const off = deriveFrameColor({ importMode, palette, baseColorOverride: null, blank: false, bodyColorRgb: NAVY });
  check(`${importMode}: Blank off gives the frame it always gave, whatever the body`, same(before, off), `${show(before)} and ${show(off)}`);
}
check('…an image\'s frame is its biggest colour', same(deriveFrameColor({ importMode: 'image', palette, baseColorOverride: null }), NAVY), 'navy');
check('…line art\'s contrasts its ink', same(deriveFrameColor({ importMode: 'svg', palette, baseColorOverride: null }), contrastingFrame(NAVY)), show(contrastingFrame(NAVY)));
check('…blocks\' caps are light', same(deriveFrameColor({ importMode: 'blocks', palette, baseColorOverride: null }), LIGHT_FRAME), show(LIGHT_FRAME));

/* ------------------------------------------------------------------ blank: two-tone */

for (const importMode of ['image', 'svg', 'icon', 'text', 'blocks'] as const) {
  const s: FrameSource = { importMode, palette, baseColorOverride: null, blank: true, bodyColorRgb: BODY_LIGHT };
  check(`${importMode}, blank on a light body: the button is the design's own ink`, isBlank(s) && same(deriveFrameColor(s), NAVY), show(deriveFrameColor(s)));
  const close: FrameSource = { ...s, bodyColorRgb: [30, 45, 120] };
  check(`…on a body too close to that ink to tell apart: one that contrasts the body`, same(deriveFrameColor(close), LIGHT_FRAME), show(deriveFrameColor(close)));
  const picked: FrameSource = { ...s, baseColorOverride: ORANGE };
  check('…and a colour picked for it wins', same(capColourOf(picked), ORANGE) && same(deriveFrameColor(picked), ORANGE), show(capColourOf(picked)));
}

{
  const white = { importMode: 'icon', palette: [entry(WHITE, 1)], baseColorOverride: null, blank: true };
  check('a white icon blank on a white body: the button goes dark', same(deriveFrameColor({ ...white, bodyColorRgb: [255, 255, 255] }), DARK_FRAME), 'dark');
  check('…on a dark body it stays white', same(deriveFrameColor({ ...white, bodyColorRgb: BODY_DARK }), WHITE), 'white');
  // TWO_TONE_MIN is a distance: just inside it is too close, just outside is not.
  const ink: RGB = [100, 100, 100];
  const at = (d: number): RGB => [100 + d, 100, 100];
  const near = deriveFrameColor({ importMode: 'svg', palette: [entry(ink, 1)], baseColorOverride: null, blank: true, bodyColorRgb: at(TWO_TONE_MIN - 1) });
  const far = deriveFrameColor({ importMode: 'svg', palette: [entry(ink, 1)], baseColorOverride: null, blank: true, bodyColorRgb: at(TWO_TONE_MIN + 1) });
  check(`the line is ${TWO_TONE_MIN} apart in RGB`, !same(near, ink) && same(far, ink), `${show(near)} at ${TWO_TONE_MIN - 1}, ${show(far)} at ${TWO_TONE_MIN + 1}`);
}

{
  const model: FrameSource = { importMode: 'model', palette, baseColorOverride: null, blank: true, bodyColorRgb: BODY_LIGHT };
  check('a cut model ignores Blank', !isBlank(model) && same(deriveFrameColor(model), deriveFrameColor({ importMode: 'model', palette, baseColorOverride: null })), show(deriveFrameColor(model)));
}

/* ------------------------------------------------------------------ the words on it */

{
  const base = { importMode: 'image', palette, baseColorOverride: null, wordsColorRgb: null as RGB | null, bodyColorRgb: BODY_LIGHT };
  check('words with the picture: as before, the picture\'s filament that stands out most',
    same(wordsColourOf(base), wordsColour(palette, null, capColourOf(base))) && same(wordsColourOf({ ...base, blank: false }), wordsColourOf(base)),
    show(wordsColourOf(base)));
  const blank = { ...base, blank: true };
  check('words on a blank: the body\'s filament, which reads on the navy button', same(wordsColourOf(blank), BODY_LIGHT), show(wordsColourOf(blank)));
  const grey: RGB = [120, 120, 120];
  const flat = { ...blank, palette: [entry(grey, 1)], bodyColorRgb: [200, 120, 40] as RGB };
  check('…and where the body does not read on the button, a plain ink that does',
    same(wordsColourOf(flat), [245, 245, 245]) || same(wordsColourOf(flat), [22, 22, 22]), `${show(wordsColourOf(flat))} on ${show(capColourOf(flat))}`);
  check('…a colour picked for them still wins', same(wordsColourOf({ ...blank, wordsColorRgb: ORANGE }), ORANGE), 'orange');
}

console.log(failures ? `\n${failures} FAILED` : '\nthe frame, and a blank in two colours');
process.exit(failures ? 1 : 0);
