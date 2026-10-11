/*
  Every face of the shared font library (`@vostok/fonts`) as a keycap font, beside the keycap's
  own, and the fallback that moves a legend to a face that writes it.

  The keycap draws its letters with three's typefaces (letter.js), and keeps doing so: a library
  face is fetched from the library's own file and parsed by the same TTFLoader → FontLoader path
  as the keycap's bundled TTFs (`loadTtfFont`), so `parseLetter` stays synchronous and draws a
  library face exactly as it draws the rest. `ensureLetterFont` loads one; until it has,
  `parseLetter` draws in Roboto, as it does for any face it does not have.

  This module, not letter.js, imports the library: the library finds its files through Vite's
  `import.meta.glob`, which a plain node bundle of letter.js (the export and fit tests) has not
  got. letter.js stays free of it.

  The keycap's 29 faces keep their ids and their own files, even where the library has the same
  family: saved projects and the export golden name them. The library's copy of such a family is
  left off the list rather than offered twice.
*/
import {
  FONTS,
  alphabetOf,
  fallbackFaces,
  fontFamilyFor,
  fontSupportsText,
  getFontUrl,
  installFontFaces,
  lettersOnly,
  scriptsFromCmap,
  toPickerFont,
} from '@vostok/fonts';
import { BUNDLED_TTF, FONT_OPTIONS, loadBundledFont, loadTtfFont } from './letter.js';

/** The name of the alphabet a text needs beyond plain Latin ("Korean", "accented"), or null. */
export { alphabetOf };

/** Roboto, the face a new keycap opens in. A text it writes stays in it. */
const DEFAULT_FONT_ID = 'helvetiker-regular';

/** A face's family, for telling one already on offer: "Roboto Bold" is Roboto. */
const familyKey = (name) => name.toLowerCase().replace(/\b(bold|regular)\b/g, '').replace(/[^a-z0-9]/g, '');

/** The keycap's own faces as far as they have loaded: its typefaces, then its bundled TTFs as
 *  each parses, then any the user imported. */
const ownOptions = () => FONT_OPTIONS.filter((f) => !f.shelf);

/** The library faces on offer, in library order: every one with a file in this build whose
 *  family the keycap does not already have, loaded or not. */
function shelfFaces() {
  const own = new Set([...ownOptions().map((f) => f.name), ...BUNDLED_TTF.map(([, name]) => name)].map(familyKey));
  return FONTS.filter((f) => getFontUrl(f.id) && !own.has(familyKey(f.label)));
}

const scriptsCache = new WeakMap();
/** The alphabets a loaded face writes, measured from its glyphs the way the library measures
 *  its own files, so the chooser's Alphabet filter keeps the keycap's faces too. */
function scriptsOf(option) {
  let scripts = scriptsCache.get(option);
  if (!scripts) {
    const glyphs = option.font.data?.glyphs ?? {};
    scripts = scriptsFromCmap((cp) => !!glyphs[String.fromCodePoint(cp)]);
    scriptsCache.set(option, scripts);
  }
  return scripts;
}

/**
 * What a font chooser lists, as the kit's `FontPickerFont` (`{ id, label, family, category?,
 * scripts }`), ready for `fontChooser({ fonts })`: the keycap's own faces first (as far as they
 * have loaded, so call it again as `loadBundledFonts` reports each), then one entry per library
 * family the keycap does not have. `family` is the CSS family to preview each in: the keycap's
 * own register theirs as they load; the library's need `installLetterFontPreviews()` once.
 */
export function letterFontList() {
  const twins = new Map(FONTS.map((f) => [familyKey(f.label), f]));
  const own = ownOptions().map((f) => {
    const category = f.imported ? 'Custom' : twins.get(familyKey(f.name))?.category;
    return { id: f.id, label: f.name, family: f.cssFamily ?? 'sans-serif', ...(category ? { category } : {}), scripts: scriptsOf(f) };
  });
  return [...own, ...shelfFaces().map(toPickerFont)];
}

/** Declares every library face on the list to the page (lazily: a face's file is fetched the
 *  first time something is drawn in it), so a chooser shows each name in its own face. Returns
 *  the function that takes them away again. */
export function installLetterFontPreviews() {
  return installFontFaces(shelfFaces().map((f) => f.id));
}

/**
 * Load a face so `parseLetter` can draw with it synchronously: one of the keycap's own (a
 * bundled TTF still loading is waited for) or any library face, by the library's id
 * (`gothic-a1`). True once it can; false when it cannot be had (an id nothing here knows, an
 * import from another session, a file that will not load).
 */
export async function ensureLetterFont(id) {
  if (FONT_OPTIONS.some((f) => f.id === id)) return true;
  const bundled = loadBundledFont(id);
  if (bundled) return !!(await bundled);
  const face = FONTS.find((f) => f.id === id);
  const url = face && getFontUrl(id);
  if (!url) return false;
  return !!(await loadTtfFont(id, face.label, url, { cssFamily: `'${fontFamilyFor(id)}', sans-serif`, shelf: true }));
}

/** Can this face draw every letter and digit of `text`: from its glyphs once it has loaded
 *  (three draws a "?" for any it lacks), from the coverage the library measured for a library
 *  face that has not. Null when it cannot be told yet: a bundled TTF still loading, an unknown
 *  id. */
function judge(id, text) {
  const letters = lettersOnly(text);
  const option = FONT_OPTIONS.find((f) => f.id === id);
  if (option) {
    const glyphs = option.font.data?.glyphs ?? {};
    return Array.from(letters).every((ch) => !/[\p{L}\p{N}]/u.test(ch) || !!glyphs[ch]);
  }
  if (getFontUrl(id) && FONTS.some((f) => f.id === id)) return fontSupportsText(id, letters);
  return null;
}

/** Can this face draw every letter and digit of `text`? A face that cannot be judged yet (a
 *  bundled TTF still loading) is not flagged. */
export function fontWritesText(id, text) {
  return judge(id, text) ?? true;
}

/**
 * Every face on the list that writes `text`, in the order to move a legend to: Roboto when it
 * writes it, then the library's plain face for the alphabet it needs (Gothic A1 for Korean,
 * M PLUS 1p for Japanese, Noto Sans SC for Chinese, Montserrat for Cyrillic and accents), then
 * the rest of the list. Only faces known to write it: one still loading is left out.
 */
export function facesThatWrite(text) {
  const faces = [...ownOptions().map((f) => f.id), ...shelfFaces().map((f) => f.id)];
  return fallbackFaces(text, { faces, writes: (id, t) => judge(id, t) === true, first: [DEFAULT_FONT_ID] });
}
