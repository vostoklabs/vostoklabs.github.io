// Reading a Reserved Font Name out of a licence or a font's name table. One reader for every
// script that asks, so the fetch and the credits cannot disagree about what a licence reserves.
//
// OFL 3: no Modified Version may use a Reserved Font Name. The name follows the copyright line,
// and families write it every way: `with Reserved Font Name Aldrich.`, `with Reserved Font
// Name 'Arvo'.`, `with Reserved Font Names "Abril" and "Abril Fatface"`, `"Delius" "Delius
// Unicase" "Delius Swash Caps"`, `Reserved Font Name: "Orbitron"`, curly quotes. A reader that
// took only a quoted name missed every unquoted one, and so the faces that wrote it that way.
//
// Rarer shapes, each from an OFL.txt in the google/fonts repository: a name broken over a line,
// quoted (`"Stint Ultra⏎Expanded"`) or not (`Naver⏎NanumGothic`); `Reserved Font Name is
// "Julee"`; the name before the term (`"Jomolhari" is a Reserved Font Name for this Font
// Software.`); quotes escaped (`\"Sansita One\"`) or angled (`<GFS Didot>`); and a list whose
// quotes do not pair up (`'Jeju Hallasan, 'Jeju Gothic, 'Jeju Myeongjo'`).

const KEYWORD = /\bReserved\s+Font\s+Names?\b/gi;
const QUOTE = `"'“”‘’<>`;
const Q = `[${QUOTE}]`;
const NOT_Q = `[^${QUOTE}\\n]`;
const OPENS_QUOTED = new RegExp(`^${Q}`);
const AFTER_QUOTE = new RegExp(`${Q}$`);
const HAS_QUOTE = new RegExp(Q);
const QUOTES = new RegExp(Q, 'g');
/** One quoted name, wrapped onto a second line at most. */
const QUOTED = `${Q}(${NOT_Q}*(?:\\n${NOT_Q}*)?)${Q}`;
/** The next quoted name of a list, after a comma, an "and", an "&" or a comma and either. */
const NEXT_QUOTED = new RegExp(`^\\s*(?:(?:,\\s*(?:and\\b|&)?|and\\b|&)\\s*)?${QUOTED}`, 'i');
/** `"Jomolhari" is a Reserved Font Name`: the name stated before the term. */
const NAMED_BEFORE = new RegExp(`${QUOTED}\\s+(?:is|are)\\s+(?:a\\s+|the\\s+)?$`, 'i');
/** Where a declaration ends: a full stop, a blank line, an opening parenthesis, or the
 *  licence's next sentence where a family left its own full stop out. A single line break does
 *  not end one: a long list wraps. */
const END = /\.(?=\s|$)|\n\s*\n|\s\(|\s+This Font Software\b/i;

/** Every name `text` declares reserved, in order, each once.
 *
 *  The OFL's own text uses the term without declaring anything: `"Reserved Font Name" refers
 *  to…` (a defined term, in quotes), `may use the Reserved Font Name(s) unless…`, and a family
 *  that has none says `with no Reserved Font Name`. A name table's licence field often carries
 *  that whole text, so none of the three is read as a name. */
export function reservedFontNames(text) {
  // A licence quoted inside another file can keep its quotes escaped.
  const s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\\(["'])/g, '$1');
  const names = [];
  for (const m of s.matchAll(KEYWORD)) {
    const before = s.slice(Math.max(0, m.index - 120), m.index);
    let rest = s.slice(m.index + m[0].length);
    if (AFTER_QUOTE.test(before) || /\bno\s+$/i.test(before) || rest.startsWith('(s)')) continue;
    const named = before.match(NAMED_BEFORE);
    if (named) {
      names.push(named[1]);
      continue;
    }
    // `Reserved Font Name is "Julee"`, `Reserved Font Names, 'Passion'`, `…Name: "Orbitron"`.
    rest = rest.replace(/^\s*(?:(?:is|are)\b\s*)?[:,]?\s*/, '');
    if (!OPENS_QUOTED.test(rest)) {
      names.push(...listed(rest));
      continue;
    }
    const quoted = [];
    let tail = rest;
    for (let q; (q = tail.match(NEXT_QUOTED)); tail = tail.slice(q[0].length)) quoted.push(q[1]);
    // A quote still to come before the declaration ends: the quotes did not pair up, so the
    // declaration is read as a plain list instead.
    names.push(...(HAS_QUOTE.test(tail.split(END)[0]) ? listed(rest) : quoted));
  }
  return [...new Set(names.map(tidy).filter((n) => key(n)))];
}

/** The names of a declaration read as a plain list: it runs to the end of its sentence and
 *  splits at commas, "and" and "&", with any stray quote dropped. */
const listed = (rest) => rest.split(END)[0].replace(QUOTES, ' ').split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i);

/** A name on one line, without a full stop or a comma left at either end ("News Cycle."). */
const tidy = (name) => name.replace(/\s+/g, ' ').replace(/^[\s.,;:]+|[\s.,;:]+$/g, '');

/** A name with case, spaces and punctuation taken out: NovaMono and Nova Mono are one name,
 *  and a PostScript name (LibreBaskerville-Regular) has no spaces to match on. */
const key = (name) => name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The first of `reserved` that one of `names` (a face's family, full, PostScript and
 *  typographic names) carries, or null. */
export function reservedNameIn(names, reserved) {
  const keys = names.map(key);
  return reserved.find((r) => keys.some((k) => k.includes(key(r)))) ?? null;
}
