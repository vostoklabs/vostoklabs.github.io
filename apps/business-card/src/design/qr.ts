// The QR code on a card: the shelf's "QR code" engine, sized for a 0.4 mm nozzle and drawn in the
// polarity a phone reads best.
import { qrModules, qrShapes, type QrLevel, type QrStyle } from '@vostok/qr';
import type { Box, Ring, Shapes } from '@vostok/shapes';
import { roundedRectRing } from '@vostok/shapes';
import type { Ink } from './types';

/**
 * The smallest module a card's QR is drawn with, mm, by how it is made: laid flat into a face (on
 * the plate's side, or inlaid into the top layers), or standing up as raised towers, whose light
 * gaps ooze shut first. Dots are islands with no neighbour to hold them, and want more.
 */
export const QR_MIN_MODULE = { flat: 1.0, raised: 1.2 } as const;
const DOT_MIN_MODULE = 1.5;
/** Clear modules round the code, the standard's four, where a side has room for them. */
export const QR_QUIET = 4;

/** "northwind.studio" opens as a web address; anything else is encoded as typed. */
export function qrContent(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t; // already has a scheme: https:, mailto:, tel:
  if (/^[^\s@]+\.[^\s@]{2,}(\/\S*)?$/.test(t)) return `https://${t}`;
  return t;
}

/** The smallest module a code of this style is drawn with on this face, mm. */
export const qrFloor = (face: 'flat' | 'raised', style: QrStyle): number => (style === 'dots' ? Math.max(DOT_MIN_MODULE, QR_MIN_MODULE[face]) : QR_MIN_MODULE[face]);

/** The square a code needs at its floor, quiet zone included, mm; 0 when there is nothing to say.
 *  A logo in the middle takes level H, which needs more modules for the same content. */
export function qrNeed(content: string, face: 'flat' | 'raised', style: QrStyle, quiet = QR_QUIET, logo = false): number {
  if (!content) return 0;
  const floor = qrFloor(face, style);
  try {
    return (qrModules(content, logo ? 'H' : 'M') + 2 * quiet) * floor;
  } catch {
    return Infinity;
  }
}

/** A logo in the middle of a code: its side as a share of the code's (the engine's own maximum). */
const QR_LOGO = 0.2;

export interface PlacedQr {
  ink: Ink;
  /** The code's square including its quiet zone, as placed. */
  box: Box;
  module: number;
}

export interface QrRequest {
  content: string;
  /** The square it may take, quiet zone included. Centred in the box given. */
  box: Box;
  style: QrStyle;
  /** How it is made: laid flat into a face, or raised. */
  face: 'flat' | 'raised';
  /** Clear modules round the code inside the box. Default `QR_QUIET`. */
  quiet?: number;
  /** The code's colour is lighter than what it sits on (white letters on a black card): the light
   *  parts are inked as a tile with the modules left open, so it still reads dark on light. */
  lighter: boolean;
  colour: string;
  /** A mark for the middle (the logo, or the initials) in its own frame, centred, longest side 1:
   *  the code clears a square for it and takes error correction H to pay for the loss. */
  logo?: Shapes | null;
}

/**
 * The code, as big as the box allows, at error correction M, or L when M's extra modules would push
 * them under the floor. Null and a sentence when even L cannot keep the floor in this box.
 */
/** Why no code was placed: no room for even the smallest code, or too much to say for the room. */
export type QrMiss = 'room' | 'long';

export function placeQr(r: QrRequest): { qr: PlacedQr | null; warning?: string; miss?: QrMiss } {
  if (!r.content) return { qr: null };
  const side = Math.min(r.box.maxX - r.box.minX, r.box.maxY - r.box.minY);
  const floor = r.style === 'dots' ? Math.max(DOT_MIN_MODULE, QR_MIN_MODULE[r.face]) : QR_MIN_MODULE[r.face];
  const quiet = r.quiet ?? QR_QUIET;
  let chosen: { level: QrLevel; n: number; module: number } | null = null;
  // With a logo in the middle only H will do: it is the level that recovers what the logo covers.
  const levels: QrLevel[] = r.logo?.length ? ['H'] : ['M', 'L'];
  for (const level of levels) {
    let n: number;
    try {
      n = qrModules(r.content, level);
    } catch {
      return { qr: null, warning: 'The QR link is too long for a QR code. Shorten it.', miss: 'long' };
    }
    const module = side / (n + 2 * quiet);
    if (module >= floor - 1e-9) {
      chosen = { level, n, module };
      break;
    }
  }
  if (!chosen) {
    // The smallest code there is (version 1, 21 modules) does not fit either: the room is the
    // problem, not the link.
    const room = side / (21 + 2 * quiet) < floor;
    return {
      qr: null,
      miss: room ? 'room' : 'long',
      warning: room
        ? 'There is no room for a QR code that scans on this side. Print the back too, or try another template.'
        : 'The QR link is too long for the room on this side. Shorten it, or print the back too.',
    };
  }

  const { level, n, module } = chosen;
  const size = n * module;
  const cx = (r.box.minX + r.box.maxX) / 2;
  const cy = (r.box.minY + r.box.maxY) / 2;
  const code = qrShapes(r.content, size, level, { style: r.style, ...(r.logo?.length ? { logo: QR_LOGO } : {}) });
  const modules: Shapes = code.shapes.map((island) => island.map((ring) => ring.map(([x, y]): [number, number] => [x + cx, y + cy])));
  // The logo, fitted to the cleared square less its quiet ring, centred: dark like the modules.
  const mark: Shapes = r.logo?.length && code.logoMm > 0 ? fitMark(r.logo, code.logoMm * 0.92, cx, cy) : [];
  const full = size + 2 * quiet * module;
  const box: Box = { minX: cx - full / 2, maxX: cx + full / 2, minY: cy - full / 2, maxY: cy + full / 2 };
  if (!r.lighter) return { qr: { ink: { role: 'qr', colour: r.colour, shapes: [...modules, ...mark] }, box, module } };
  // The tile: the code's square and its quiet zone, rounded a module at the corners, with the dark
  // modules (and the logo) left open so the card shows through them.
  const tile: Ring = roundedRectRing(full, full, module, 6, [cx, cy]);
  return { qr: { ink: { role: 'qr', colour: r.colour, shapes: [[tile]], minus: [...modules, ...mark] }, box, module } };
}

/** Shapes in the symbol frame scaled so their longer side is `side`, centred on (cx, cy). */
function fitMark(shapes: Shapes, side: number, cx: number, cy: number): Shapes {
  const pts = shapes.flat(2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const k = side / Math.max(maxX - minX, maxY - minY, 1e-9);
  const ox = cx - ((minX + maxX) / 2) * k;
  const oy = cy - ((minY + maxY) / 2) * k;
  return shapes.map((island) => island.map((ring) => ring.map(([x, y]): [number, number] => [x * k + ox, y * k + oy])));
}
