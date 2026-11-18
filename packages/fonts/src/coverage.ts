// What a font file covers, read from its own cmap, and what a string needs from one.
//
// One definition serves both halves. `scripts/fetch-fonts.mjs` writes each face's `subsets`
// into registry.ts by testing the file against these sets, and `isFontSupported` checks a
// user's text against the same sets. When the two came from different places (the registry
// copied whatever subsets the font API advertised for a family) dozens of faces claimed
// Cyrillic or Greek their files do not contain, and the missing-glyph mark stayed quiet for
// text that came out as "?".
//
// Plain TypeScript with no imports, so the fetch script can load it under Node as it is.

/** Every name a face can claim, in the order registry.ts lists them. Google Fonts' subset names,
 *  plus `kana`: hiragana and katakana without the kanji, which `japanese` also needs. */
export const COVERAGE_NAMES = [
  'armenian',
  'chinese-simplified',
  'cyrillic',
  'cyrillic-ext',
  'georgian',
  'greek',
  'japanese',
  'kana',
  'korean',
  'latin',
  'latin-ext',
  'vietnamese',
] as const;
export type CoverageName = (typeof COVERAGE_NAMES)[number];

/** What a character outside every coverage set needs: no face here has it. Hangul syllables
 *  past the common set below (every Korean file in the package is cut to it), and Hangul typed
 *  as separate jamo, which a layout that sets one character at a time cannot compose. */
export const UNCOVERED = 'uncovered';

/** What a Han character past the common sets needs: that very character. The cut CJK faces hold
 *  the common sets only; a face whole enough to hold more lists the Han characters its file has
 *  (`hanOf`, `FontChoice.han`), and text is checked against them character by character. */
export const HAN = 'han';

/** Where Han characters are: CJK Unified Ideographs Extension A, the unified block, the
 *  compatibility ideographs, and planes 2 and 3 (Extension B onwards and their supplement). */
const HAN_RANGES: readonly (readonly [number, number])[] = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0x20000, 0x3ffff],
];
const isHan = (cp: number): boolean => HAN_RANGES.some(([from, to]) => cp >= from && cp <= to);

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const chars = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0)!);

/**
 * The characters in a run of rows of a two-byte CJK encoding, decoded: KS X 1001, JIS X 0208
 * and GB2312 are each defined as a grid of rows, and the platform decoder is the table, so
 * nothing has to ship one. Every cell in the rows asked for here is assigned, so each byte pair
 * is one character. Null in a runtime without the legacy decoders: `requirementOf` then takes
 * the whole block as covered, and `coverageTests` refuses to measure.
 */
function decodeRows(encoding: string, firstLead: number, lastLead: number, lastTrail: number): number[] | null {
  const bytes: number[] = [];
  for (let lead = firstLead; lead <= lastLead; lead++) {
    const end = lead === lastLead ? lastTrail : 0xfe;
    for (let trail = 0xa1; trail <= end; trail++) bytes.push(lead, trail);
  }
  try {
    const text = new TextDecoder(encoding).decode(new Uint8Array(bytes));
    return chars(text).filter((c) => c !== 0xfffd);
  } catch {
    return null;
  }
}

/** The common CJK sets, built on first use: a few thousand characters each. */
let cjk: { hangul: Set<number> | null; kanji: Set<number> | null; hanzi: Set<number> | null } | undefined;
function cjkSets() {
  if (!cjk) {
    const set = (cps: number[] | null) => (cps ? new Set(cps) : null);
    cjk = {
      // KS X 1001: the 2,350 Hangul syllables of rows 16-40.
      hangul: set(decodeRows('euc-kr', 0xb0, 0xc8, 0xfe)),
      // JIS X 0208 level 1: the 2,965 kanji of rows 16-47.
      kanji: set(decodeRows('euc-jp', 0xb0, 0xcf, 0xd3)),
      // GB2312 level 1: the 3,755 hanzi of rows 16-55.
      hanzi: set(decodeRows('gb2312', 0xb0, 0xd7, 0xf9)),
    };
  }
  return cjk;
}

const KANA = [...range(0x3041, 0x3093), ...range(0x30a1, 0x30f6), 0x30fc];

let tests: Record<CoverageName, number[]> | undefined;

/**
 * The characters each name stands for: a face claims a name when its cmap has every one.
 * Alphabets are tested on the letters their languages write today; CJK on the common sets.
 */
export function coverageTests(): Record<CoverageName, number[]> {
  if (!tests) {
    const { hangul, kanji, hanzi } = cjkSets();
    if (!hangul || !kanji || !hanzi) throw new Error('coverage: this runtime cannot decode euc-kr, euc-jp or gb2312');
    tests = {
      latin: [...range(0x41, 0x5a), ...range(0x61, 0x7a), ...range(0x30, 0x39)],
      // The Latin Extended-A letters of Polish, Czech, Slovak, Hungarian, Croatian, Slovenian,
      // Latvian, Lithuanian and Turkish, and Romanian's Ă. Left out: the rarely typed (ĸ ŉ ſ Ĳ
      // Ŀ, Esperanto, Sami) and the Maltese, Welsh and Romanian comma-below letters, which many
      // faces with every letter above lack. One of those goes unflagged; testing for them would
      // flag a Polish name in every one of those faces.
      'latin-ext': chars('ĀāĂăĄąĆćČčĎďĐđĒēĖėĘęĚěĞğĢģĪīĮįİıĶķĹĺĻļĽľŁłŃńŅņŇňŐőŔŕŘřŚśŞşŠšŤťŪūŮůŰűŲųŹźŻżŽž'),
      vietnamese: [...chars('ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯư'), ...range(0x1ea0, 0x1ef9)],
      // The Russian alphabet.
      cyrillic: [...range(0x410, 0x44f), 0x401, 0x451],
      // Russian plus the letters Kazakh, Kyrgyz, Tatar and Bashkir add.
      'cyrillic-ext': [...range(0x410, 0x44f), 0x401, 0x451, ...chars('ӘәҒғҚқҢңӨөҰұҮүҺһҖҗҘҙҠҡҪҫ')],
      // Monotonic Greek: the 49 letters with final sigma, and the accented ones.
      greek: [...range(0x391, 0x3a1), ...range(0x3a3, 0x3a9), ...range(0x3b1, 0x3c9), ...chars('ΆΈΉΊΌΎΏάέήίόύώϊϋΐΰΪΫ')],
      armenian: [...range(0x531, 0x556), ...range(0x561, 0x586)],
      // The 33 letters of modern Georgian (Mkhedruli).
      georgian: range(0x10d0, 0x10f0),
      // KS X 1001's 2,350 syllables, and the 51 modern jamo a single typed consonant or vowel is.
      korean: [...hangul, ...range(0x3131, 0x3163)],
      // JIS X 0208's hiragana and katakana, and the long-vowel mark.
      kana: KANA,
      japanese: [...KANA, ...kanji],
      'chinese-simplified': [...hanzi],
    };
  }
  return tests;
}

/** The names a face covers, given a lookup into its cmap. */
export function coverageOf(has: (codePoint: number) => boolean): CoverageName[] {
  const all = coverageTests();
  return COVERAGE_NAMES.filter((name) => all[name].every(has));
}

/** Latin Extended-B, U+0180–024F: Romanian's Ș and Ț, pinyin's tone marks, African letters,
 *  the Croatian digraphs. Faces cover it too unevenly for one name to stand for it, from none
 *  of it to all of it and rarely the same way twice, and a face with every Latin Extended-A
 *  letter can still lack ƚ or Ɂ. So each file is measured letter by letter (`latinExtBOf`),
 *  and what a letter of the block needs is that very letter. */
export const LATIN_EXT_B = 'latin-ext-b';
const EXT_B_FIRST = 0x180;
const EXT_B_LAST = 0x24f;

/** The Latin Extended-B letters a face holds, given a lookup into its cmap, as runs of
 *  characters: "ƀ-ǃǅ-ɏ" is ƀ to ǃ and ǅ to ɏ. A hyphen is not in the block, so it only joins. */
export function latinExtBOf(has: (codePoint: number) => boolean): string {
  return runsIn(has, EXT_B_FIRST, EXT_B_LAST);
}

/** The characters from `first` to `last` that `has` holds, as runs. */
function runsIn(has: (codePoint: number) => boolean, first: number, last: number): string {
  let out = '';
  for (let cp = first; cp <= last; cp++) {
    if (!has(cp)) continue;
    let end = cp;
    while (end < last && has(end + 1)) end++;
    out += String.fromCodePoint(cp);
    if (end === cp + 1) out += String.fromCodePoint(end);
    else if (end > cp + 1) out += `-${String.fromCodePoint(end)}`;
    cp = end;
  }
  return out;
}

/** The Han characters a face holds, as runs written the way `latinExtBOf` writes them, or ''
 *  for a face that holds none past the common sets (every cut CJK face): its `subsets` already
 *  say all it has, and the runs of a cut set would be thousands long. */
export function hanOf(has: (codePoint: number) => boolean): string {
  let past = false;
  for (const [from, to] of HAN_RANGES) {
    for (let cp = from; cp <= to && !past; cp++) if (has(cp) && requirementOf(cp) === HAN) past = true;
  }
  return past ? HAN_RANGES.map(([from, to]) => runsIn(has, from, to)).join('') : '';
}

/** Whether runs written by `latinExtBOf` hold `cp`. */
export function runsHold(runs: string, cp: number): boolean {
  const chars = Array.from(runs, (c) => c.codePointAt(0)!);
  for (let i = 0; i < chars.length; i++) {
    const from = chars[i]!;
    const to = chars[i + 1] === 0x2d ? chars[(i += 2)]! : from;
    if (cp >= from && cp <= to) return true;
  }
  return false;
}

/**
 * What one character needs from a face, or undefined for one that every face is taken to have
 * (Basic Latin, Latin-1, punctuation). A Han character either the Japanese or the Chinese set
 * holds needs `japanese|chinese-simplified`: either one will do.
 *
 * The alphabets are tested by block: a face that has the alphabet is taken to have the rest of
 * its block. Latin Extended-B is the exception (`LATIN_EXT_B`), and so is CJK, tested character
 * by character because most files are cut to the common set: a rarer Han character needs `HAN`,
 * which only a face listing it in its own `han` runs has, and a rarer Hangul syllable no face has.
 */
export function requirementOf(cp: number): string | undefined {
  if (cp < 0x100) return undefined;
  if (cp < EXT_B_FIRST) return 'latin-ext';
  if (cp <= EXT_B_LAST) return LATIN_EXT_B;
  if (cp >= 0x370 && cp <= 0x3ff) return 'greek';
  if ((cp >= 0x400 && cp <= 0x45f) || cp === 0x490 || cp === 0x491) return 'cyrillic';
  if (cp >= 0x460 && cp <= 0x52f) return 'cyrillic-ext';
  if (cp >= 0x530 && cp <= 0x58f) return 'armenian';
  if (cp >= 0x10a0 && cp <= 0x10ff) return 'georgian';
  if (cp >= 0x1100 && cp <= 0x11ff) return UNCOVERED;
  if (cp >= 0x3040 && cp <= 0x30ff) return 'kana';
  if (cp >= 0x3130 && cp <= 0x318f) return 'korean';
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    const { hangul } = cjkSets();
    return !hangul || hangul.has(cp) ? 'korean' : UNCOVERED;
  }
  if (cp >= 0x4e00 && cp <= 0x9fff) {
    const { kanji, hanzi } = cjkSets();
    const ja = !kanji || kanji.has(cp);
    const zh = !hanzi || hanzi.has(cp);
    if (ja && zh) return 'japanese|chinese-simplified';
    if (ja) return 'japanese';
    if (zh) return 'chinese-simplified';
    return HAN;
  }
  if (isHan(cp)) return HAN;
  return undefined;
}

/** The alphabets a person picks from, in the order a list shows them, and the names that give
 *  each one. A face with kana and no kanji still writes Japanese, in kana. Armenian and Georgian
 *  are measured and checked but not offered: no face here is picked for them, so their text is
 *  flagged rather than filtered for. */
export const SCRIPTS: readonly (readonly [string, readonly CoverageName[]])[] = [
  ['Latin', ['latin']],
  ['Cyrillic', ['cyrillic']],
  ['Greek', ['greek']],
  ['Korean', ['korean']],
  ['Japanese', ['japanese', 'kana']],
  ['Chinese', ['chinese-simplified']],
];
