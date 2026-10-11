// Which face to move a text to when the chosen one cannot write it.
//
// A name typed in Korean, Japanese, Chinese, Cyrillic or Greek into a face that has only Latin
// comes out as a "?" per letter. The generators that set type move the text instead, to the
// plainest face of this library that writes all of it, and say so. The order they try is one
// rule, kept here so every app falls back the same way: the app's own default faces, then the
// plain face for each alphabet the text needs, then every other face that writes it.
import { getRequiredSubsets } from './index';

/** The letters of a text, without its symbols: the private-use characters of the symbol font
 *  (U+F0000 and up), which no typeface has and no fallback should count as missing. */
export const lettersOnly = (text: string): string =>
  Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) < 0xf0000).join('');

const ALPHABETS: Record<string, string> = {
  cyrillic: 'Cyrillic', greek: 'Greek', korean: 'Korean', kana: 'Japanese', japanese: 'Japanese',
  'chinese-simplified': 'Chinese', 'latin-ext': 'accented',
};

/** What `text` needs beyond plain Latin, as the library names it ('cyrillic', 'kana'…). */
const needsOf = (text: string) => new Set(getRequiredSubsets(lettersOnly(text)).flatMap((need) => need.split('|')));

/** The first alphabet `text` needs beyond plain Latin, by name ("Cyrillic"), for a message. An
 *  accented Latin letter needs no subset but can still be missing from a face: "accented". Null
 *  for plain Latin. */
export function alphabetOf(text: string): string | null {
  for (const name of needsOf(text)) if (ALPHABETS[name]) return ALPHABETS[name];
  return /[^\x00-\x7f]/.test(Array.from(lettersOnly(text)).filter((ch) => /\p{L}/u.test(ch)).join('')) ? 'accented' : null;
}

/** The plain face for each alphabet, most telling first: a text with kana in it is Japanese
 *  whatever else it holds, Hangul is Korean, a Han character with neither is Chinese. Gothic A1
 *  also writes Cyrillic and Greek, so a Korean name mixed with Russian still lands on one face. */
const PLAIN_FACES: [need: string, face: string][] = [
  ['kana', 'm-plus-1p'],
  ['korean', 'gothic-a1'],
  ['chinese-simplified', 'noto-sans-sc'],
  ['greek', 'gothic-a1'],
  ['cyrillic', 'montserrat'],
  ['latin-ext', 'montserrat'],
];
/** The plain faces, for a text that needs none of them by alphabet (accented Latin, say). */
const PLAIN_ORDER = ['montserrat', 'gothic-a1', 'm-plus-1p', 'noto-sans-sc'];

/** The plain face ids for the alphabets `text` needs, most telling first, then the rest of the
 *  plain faces, each once. Not checked against the text: a caller keeps the ones that write it. */
export function plainFacesFor(text: string): string[] {
  const needs = needsOf(text);
  return [...new Set([...PLAIN_FACES.filter(([need]) => needs.has(need)).map(([, face]) => face), ...PLAIN_ORDER])];
}

/**
 * Every face of `faces` that writes `text`, in the order to fall back through: `first` (the app's
 * own default faces, which win whenever they can), then the plain faces for the alphabets the text
 * needs, then the rest of `faces` in their own order. Text in an alphabet the default lacks
 * therefore starts on a face that suits it, rather than on whichever display face comes first
 * alphabetically. `writes` is the app's own answer to "can this face draw this text".
 */
export function fallbackFaces(
  text: string,
  opts: { faces: readonly string[]; writes: (id: string, text: string) => boolean; first?: readonly string[] },
): string[] {
  const lead = [...new Set([...(opts.first ?? []), ...plainFacesFor(text)])].filter((id) => opts.writes(id, text));
  return [...lead, ...opts.faces.filter((id) => !lead.includes(id) && opts.writes(id, text))];
}
