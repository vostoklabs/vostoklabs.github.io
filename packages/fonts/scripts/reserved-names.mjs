// Reading a Reserved Font Name out of a licence or a font's name table. One reader for every
// script that asks, so the fetch and the credits cannot disagree about what a licence reserves.
//
// OFL 3: no Modified Version may use a Reserved Font Name. The name follows the copyright line,
// and families write it every way: `with Reserved Font Name Aldrich.`, `with Reserved Font
// Name 'Arvo'.`, `with Reserved Font Names "Abril" and "Abril Fatface"`, `"Delius" "Delius
// Unicase" "Delius Swash Caps"`, `Reserved Font Name: "Orbitron"`, curly quotes. A reader that
// took only a quoted name missed every unquoted one, and so the faces that wrote it that way.

const KEYWORD = /\bReserved\s+Font\s+Names?\b/gi;
const QUOTE = `"'“”‘’`;
const OPENS_QUOTED = new RegExp(`^[${QUOTE}]`);
const AFTER_QUOTE = new RegExp(`[${QUOTE}]$`);
/** The next quoted name of a list, after a comma, an "and" or an "&". */
const NEXT_QUOTED = new RegExp(`^\\s*(?:(?:,|and\\b|&)\\s*)?[${QUOTE}]([^${QUOTE}\\n]*)[${QUOTE}]`, 'i');

/** Every name `text` declares reserved, in order, each once.
 *
 *  The OFL's own text uses the term without declaring anything: `"Reserved Font Name" refers
 *  to…` (a defined term, in quotes), `may use the Reserved Font Name(s) unless…`, and a family
 *  that has none says `with no Reserved Font Name`. A name table's licence field often carries
 *  that whole text, so none of the three is read as a name. */
export function reservedFontNames(text) {
  const s = String(text ?? '');
  const names = [];
  for (const m of s.matchAll(KEYWORD)) {
    const before = s.slice(Math.max(0, m.index - 4), m.index);
    let rest = s.slice(m.index + m[0].length);
    if (AFTER_QUOTE.test(before) || /\bno\s+$/i.test(before) || rest.startsWith('(s)')) continue;
    rest = rest.replace(/^\s*[:,]?\s*/, '');
    if (OPENS_QUOTED.test(rest)) {
      for (let q; (q = rest.match(NEXT_QUOTED)); rest = rest.slice(q[0].length)) names.push(q[1]);
    } else {
      // Unquoted, the name runs to the end of its sentence: a period before a space, a line
      // break, an opening parenthesis, or the licence's next sentence where a family left its
      // own period out.
      const clause = rest.split(/\.(?=\s|$)|\n|\s\(|\s+This Font Software\b/i)[0];
      names.push(...clause.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i));
    }
  }
  return [...new Set(names.map((n) => n.replace(/\s+/g, ' ').trim()).filter((n) => key(n)))];
}

/** A name with case, spaces and punctuation taken out: NovaMono and Nova Mono are one name,
 *  and a PostScript name (LibreBaskerville-Regular) has no spaces to match on. */
const key = (name) => name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The first of `reserved` that one of `names` (a face's family, full, PostScript and
 *  typographic names) carries, or null. */
export function reservedNameIn(names, reserved) {
  const keys = names.map(key);
  return reserved.find((r) => keys.some((k) => k.includes(key(r)))) ?? null;
}
