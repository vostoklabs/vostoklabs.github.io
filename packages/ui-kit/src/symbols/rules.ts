/*
  The rules behind a text that carries symbols, with no DOM in them.

  A symbol is ONE code point from the supplementary private-use planes (U+F0000–U+10FFFD).
  No font draws those and no keyboard types them, so a single string holds plain text and
  symbols side by side with nothing to escape, and the app keeps a map from each code point
  to what it draws. Two units are in play and they are kept apart on purpose:

    offsets  string indices (UTF-16 code units) — what `selectionStart`, a DOM Range and
             `slice` count, so an offset can go straight from the browser to the string;
    lengths  code points — what a person counts. A symbol is one character, never two, so a
             `maxLength` of 3 holds three symbols.

  Every edit the symbol field makes is one of these functions, so a node test can hold each
  rule, and an app editing the same value (the inspector's Before / After / Both sides)
  makes exactly the edit the field would.

  This file imports nothing, and stays that way: `@vostok/ui-kit/symbol-rules` is this file
  alone, so geometry code and node tests that ask which characters are symbols load no DOM
  and none of the rest of the kit (tests/symbol-rules.test.mjs holds it).
*/

/** The first code point a symbol may use. */
export const SYMBOL_FIRST = 0xf0000;
/** The last code point a symbol may use. */
export const SYMBOL_LAST = 0x10fffd;

/** True for exactly one code point in the symbol range. */
export function isSymbolChar(ch: string): boolean {
  const cp = ch.codePointAt(0);
  return cp !== undefined && cp >= SYMBOL_FIRST && cp <= SYMBOL_LAST && ch.length === 2;
}

/** Whether a text holds any symbol at all. */
export function hasSymbol(text: string): boolean {
  for (const ch of text) if (isSymbolChar(ch)) return true;
  return false;
}

/** Length in code points: a symbol, an emoji or a letter each count once. */
export function codePointCount(text: string): number {
  return Array.from(text).length;
}

/** The lowest symbol code point `taken` says is free. */
export function nextSymbolChar(taken: (ch: string) => boolean): string {
  for (let cp = SYMBOL_FIRST; cp <= SYMBOL_LAST; cp++) {
    const ch = String.fromCodePoint(cp);
    if (!taken(ch)) return ch;
  }
  throw new Error('Every symbol code point is in use.');
}

/** An offset clamped into the text and moved off the middle of a surrogate pair (back to the
 *  pair's start), so slicing at it never splits a symbol in half. */
export function snapOffset(text: string, offset: number): number {
  const at = Math.max(0, Math.min(text.length, Math.round(offset)));
  if (at > 0 && at < text.length) {
    const hi = text.charCodeAt(at - 1);
    const lo = text.charCodeAt(at);
    if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) return at - 1;
  }
  return at;
}

const unlimited = (max: number | undefined): max is undefined => max === undefined || !Number.isFinite(max);

/** An edited text and where the caret belongs in it afterwards. */
export interface TextEdit {
  value: string;
  caret: number;
}

/**
 * `text` with the span [start, end) replaced by `insert`, cut down to the first code points
 * that fit within `max`. The caret lands after what went in.
 *
 * Null when `insert` is not empty and none of it fits: the edit is refused whole rather than
 * deleting the selection and putting nothing in its place.
 */
export function insertText(text: string, start: number, end: number, insert: string, max?: number): TextEdit | null {
  const a = snapOffset(text, Math.min(start, end));
  const b = snapOffset(text, Math.max(start, end));
  const head = text.slice(0, a);
  const tail = text.slice(b);
  let piece = insert;
  if (!unlimited(max)) {
    const room = max - codePointCount(head + tail);
    const points = Array.from(insert);
    if (room < points.length) piece = points.slice(0, Math.max(0, room)).join('');
  }
  if (insert && !piece) return null;
  return { value: head + piece + tail, caret: head.length + piece.length };
}

/**
 * Hold a native edit — typing, a paste the browser handled, an IME commit — to `max` code points.
 *
 * `prev` is the text before the edit and `next` the text the browser produced. `caret`, where
 * the browser's caret ended up, pins down where the new text went in — a guess from the text
 * alone cannot tell which "a" was typed into "aa". Without it the longest unchanged ending is
 * assumed, which never counts untouched text as replaced. Only what the edit ADDED is trimmed;
 * whatever it replaced stays replaced.
 *
 * Null when `next` is acceptable as it is — within the limit, or no longer than before, so a
 * text left over a lowered limit can still be edited down.
 */
export function clampEdit(prev: string, next: string, max: number | undefined, caret?: number): TextEdit | null {
  if (unlimited(max)) return null;
  const p = Array.from(prev);
  const n = Array.from(next);
  if (n.length <= max || n.length <= p.length) return null;

  const shortest = Math.min(p.length, n.length);
  let common = 0;
  while (common < shortest && p[p.length - 1 - common] === n[n.length - 1 - common]) common++;
  // What follows the caret was left alone — when the old text does end with it.
  let tail = common;
  if (caret !== undefined) {
    const after = n.length - codePointCount(next.slice(0, snapOffset(next, caret)));
    if (after <= common) tail = after;
  }
  let head = 0;
  const limit = shortest - tail;
  while (head < limit && p[head] === n[head]) head++;

  const replaced = p.length - head - tail;
  const room = Math.max(0, max - (p.length - replaced));
  const before = n.slice(0, head).join('') + n.slice(head, n.length - tail).slice(0, room).join('');
  return { value: before + n.slice(n.length - tail).join(''), caret: before.length };
}

/** `text` without the one code point that starts at `offset`. The caret lands where it was. */
export function removeSymbolAt(text: string, offset: number): TextEdit {
  const at = snapOffset(text, offset);
  const cp = text.codePointAt(at);
  if (cp === undefined) return { value: text, caret: text.length };
  const width = cp > 0xffff ? 2 : 1;
  return { value: text.slice(0, at) + text.slice(at + width), caret: at };
}

/**
 * Move the code point at `from` into the gap at `to`, where `to` is an offset into the text as
 * it stands BEFORE the move — which is what a drop position is. Dropping a symbol beside itself
 * leaves the text unchanged. The caret lands just after the moved symbol.
 */
export function moveSymbol(text: string, from: number, to: number): TextEdit {
  const at = snapOffset(text, from);
  const cp = text.codePointAt(at);
  if (cp === undefined) return { value: text, caret: snapOffset(text, to) };
  const ch = String.fromCodePoint(cp);
  const rest = text.slice(0, at) + text.slice(at + ch.length);
  let gap = Math.max(0, Math.min(text.length, Math.round(to)));
  if (gap > at) gap = Math.max(at, gap - ch.length);
  gap = snapOffset(rest, gap);
  return { value: rest.slice(0, gap) + ch + rest.slice(gap), caret: gap + ch.length };
}

/** Move a symbol one character left (-1) or right (+1). Acts on its first occurrence; a symbol
 *  already at that end stays put. */
export function shiftSymbol(text: string, ch: string, dir: -1 | 1): string {
  const points = Array.from(text);
  const i = points.indexOf(ch);
  if (i < 0) return text;
  points.splice(i, 1);
  points.splice(Math.max(0, Math.min(points.length, i + dir)), 0, ch);
  return points.join('');
}

/** Where the inspector's position buttons put a symbol. */
export type SymbolPlacement = 'before' | 'after' | 'both';

/**
 * Put a symbol at the start of the text, at its end, or at both ends.
 *
 * `group` is the symbol first, then any twin it already has at the other end: every one of
 * them is taken out of the text before the symbol goes back in, so pressing Before after Both
 * sides leaves one symbol, not two. `both` needs the code point to use for the second copy,
 * `twin`, which the app allocates (`nextSymbolChar`) and links to the first so they can be
 * edited together. Null when `both` has no `twin`, or would not fit within `max`.
 */
export function placeSymbol(
  text: string,
  group: readonly string[],
  where: SymbolPlacement,
  twin?: string,
  max?: number,
): string | null {
  const ch = group[0];
  if (ch === undefined) return text;
  const rest = Array.from(text).filter((c) => !group.includes(c));
  if (where === 'before') return ch + rest.join('');
  if (where === 'after') return rest.join('') + ch;
  if (!twin || (!unlimited(max) && rest.length + 2 > max)) return null;
  return ch + rest.join('') + twin;
}

/* ------------------------------------------------------------------ inspector */

/** How one placed symbol is drawn relative to where its character sits in the line. */
export interface SymbolTransform {
  /** 1 = the size of a letter. */
  scale: number;
  /** Offset as a fraction of the symbol's size, −1…1. +x is right. */
  dx: number;
  /** Offset as a fraction of the symbol's size, −1…1. +y is UP. */
  dy: number;
  /** Degrees, −180…180. Positive is anticlockwise, the pad's rotate-left corner. */
  rotation: number;
  /** Mirrored left to right, before it is rotated. */
  flip: boolean;
}

/** One press of the offset pad, as a fraction of the symbol's size. */
export const SYMBOL_NUDGE_STEP = 0.02;
/** One press of a rotate corner, in degrees. */
export const SYMBOL_ROTATE_STEP = 5;

/** The offset after one press of the pad: one axis moves a step, rounded to whole percent and
 *  held inside −1…1. Returns only the axis that moved. */
export function nudgeSymbol(
  t: Pick<SymbolTransform, 'dx' | 'dy'>,
  dir: 'up' | 'down' | 'left' | 'right',
): Partial<Pick<SymbolTransform, 'dx' | 'dy'>> {
  const axis = dir === 'left' || dir === 'right' ? 'dx' : 'dy';
  const delta = dir === 'right' || dir === 'up' ? SYMBOL_NUDGE_STEP : -SYMBOL_NUDGE_STEP;
  const moved = Math.round((t[axis] + delta) * 100) / 100;
  return { [axis]: Math.max(-1, Math.min(1, moved)) };
}

/** An angle turned by `delta` degrees and wrapped into −180…180 (180 itself reads as −180). */
export function turnSymbol(rotation: number, delta: number): number {
  return ((((rotation + delta + 180) % 360) + 360) % 360) - 180;
}

/** The line under "Offset & rotation": `X 4% · Y -2% · 15°`. */
export function symbolReadout(t: Pick<SymbolTransform, 'dx' | 'dy' | 'rotation'>, withAngle = true): string {
  const xy = `X ${Math.round(t.dx * 100)}% · Y ${Math.round(t.dy * 100)}%`;
  return withAngle ? `${xy} · ${Math.round(t.rotation)}°` : xy;
}
