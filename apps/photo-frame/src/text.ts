// What is typed, as outlines in millimetres, fitted into the band the geometry leaves for it.
// Runs on the screen's side, where the fonts are; the worker gets rings and never a font.
//
// Symbols are Material symbols drawn by the text's fallback face, so a symbol is a letter to
// the layout. In the field they sit as tokens: the field treats U+F0000 and up as symbols, and
// the Material characters live at U+E000 to U+F8FF, so each one is shifted up by a fixed amount
// in the field and back down for the layout. A handful already sit higher (U+FFEB0 and up) and
// stay where they are. Nothing else needs storing.
import { getHorizontalContours } from '@vostok/fonts/textLayout';
import { islandsFromContours } from '@vostok/shapes';
import type { Box } from './geometry/layout';
import { ccw, cw, type Ring } from './geometry/outline';

export type Face = Parameters<typeof getHorizontalContours>[0];

const PUA0 = 0xe000;
const PUA1 = 0xf8ff;
const TOKEN0 = 0xf0000;

/** A Material symbol's character as the field holds it. */
export function tokenOf(materialChar: string): string {
  const cp = materialChar.codePointAt(0) ?? 0;
  return cp >= PUA0 && cp <= PUA1 ? String.fromCodePoint(TOKEN0 + (cp - PUA0)) : materialChar;
}

/** The field's text with its tokens turned back into Material characters. */
export function fromTokens(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += cp >= TOKEN0 && cp <= TOKEN0 + (PUA1 - PUA0) ? String.fromCodePoint(PUA0 + (cp - TOKEN0)) : ch;
  }
  return out;
}

/** Whether one character of the field is a symbol. */
export function isSymbol(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= TOKEN0 || (cp >= PUA0 && cp <= PUA1);
}

/** A song line split into its title and the symbol at its end (the player's like button), when it
 *  ends in one. */
export function splitLike(text: string): { title: string; like: string | null } {
  const chars = [...text.trimEnd()];
  const last = chars[chars.length - 1];
  if (!last || !isSymbol(last)) return { title: text, like: null };
  return { title: chars.slice(0, -1).join(''), like: last };
}

export interface FittedText {
  /** Islands as rings: outlines counter-clockwise, holes clockwise. Fill non-zero. */
  rings: Ring[];
  /** The letter size it ended at, mm. */
  em: number;
  /** Made smaller than asked to fit. */
  shrunk: boolean;
}

/**
 * Lay the text out at `em`, then make it smaller (never larger) until its ink fits `box`, and
 * centre it there (or start it at the box's left edge, or end it at its right).
 */
export function fitText(face: Face, symbols: Face | null, text: string, box: Box, em: number, align: 'center' | 'left' | 'right' = 'center'): FittedText | null {
  const plain = fromTokens(text).trim();
  if (!plain) return null;
  const layout = getHorizontalContours(face, symbols, plain, '', em, 0, 0, 'center', 0, 0);
  const b = layout.box;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (!(w > 0 && h > 0)) return null;
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const scale = Math.min(1, bw / w, bh / h);
  const cx = align === 'left' ? box.x0 + (w * scale) / 2 : align === 'right' ? box.x1 - (w * scale) / 2 : (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const mx = (b.minX + b.maxX) / 2;
  const my = (b.minY + b.maxY) / 2;
  const placed = layout.contours.map((ring) => ring.map(([x, y]) => [cx + (x! - mx) * scale, cy + (y! - my) * scale]));
  const rings: Ring[] = [];
  for (const island of islandsFromContours(placed)) {
    const [outer, ...holes] = island as Ring[];
    if (!outer || outer.length < 3) continue;
    rings.push(ccw(outer), ...holes.filter((r) => r.length >= 3).map(cw));
  }
  return { rings, em: em * scale, shrunk: scale < 0.999 };
}
