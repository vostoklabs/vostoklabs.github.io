import { readSymbols } from '../symbols/model';
// A symbol with an outline around it — a paw, a heart, a star — with a loop for the ring.
//
// The outline is the engine's hugging blank, so the charm is whatever shape the symbol is; the
// two things that decide whether it survives the laser are both here:
//
// · OUTLINE is the border, and in Cut out it is also how far the symbol's own gaps sit from the
//   edge. Under a millimetre those gaps are scrap, so the slider stops at 1 (G25) and the note
//   says what the number really decides.
// · HOLE mode grows a small round top for the hole. Without it the hole rests on the outline
//   wherever the silhouette happens to be widest — on the shipped paw, straight through two of
//   its five pads — because a hug leaves no band of bare material anywhere else.
import { bboxOf, circleRing, mirrorX, placeShapes, type Shapes } from '@vostok/laser';
import { iconByChar, iconById } from '@vostok/fonts';
import { symbolLayer } from '../engine/text';
import type { DesignLayer } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import { opField, opOf, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** The library's paw. Written as an id rather than the private-use character it resolves to:
 *  the literal renders as nothing in an editor, a diff or a review tool, so a default that
 *  changed by accident would look like no change at all. */
const DEFAULT_SYMBOL = iconById('pets')?.char ?? '';

/** Material a cut leaves standing between two pieces of a symbol: under this it burns away
 *  (never under 1 mm, and never under the material's thickness). */
const MIN_WEB = 1;
/** Above this many points the gap measurement is skipped: an imported drawing that detailed is
 *  already caught by its own island count, and the check is O(n²) across islands. */
const GAP_BUDGET = 4000;

/** The narrowest gap between two separate pieces of the symbol, mm. Islands whose boxes are
 *  further apart than `limit` are never compared, so an ordinary icon costs a few thousand
 *  distance tests and a complicated one costs nothing at all. */
function minWeb(shapes: Shapes, limit: number): number {
  const points = shapes.reduce((a, isl) => a + isl.reduce((b, r) => b + r.length, 0), 0);
  if (shapes.length < 2 || points > GAP_BUDGET) return Infinity;
  const boxes = shapes.map((isl) => bboxOf([isl]));
  let best = Infinity;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.minX - b.maxX > limit || b.minX - a.maxX > limit || a.minY - b.maxY > limit || b.minY - a.maxY > limit) continue;
      for (const p of shapes[i]!.flat()) {
        for (const q of shapes[j]!.flat()) {
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d < best) best = d;
        }
      }
    }
  }
  return best;
}

/** What the customer called this charm — the icon's own name, or the name the import wizard
 *  saved the drawing under. */
const symbolName = (v: Values): string => {
  const char = str(v, 'symbol');
  return readSymbols(v)[char]?.label || iconByChar(char)?.label || 'charm';
};

export const symbolCharm: TemplateDef = {
  id: 'symbol-charm',
  name: 'Symbol charm',
  blurb: 'One symbol from the library, outlined, with a loop. A paw, a star, a heart.',
  tags: ['keychain', 'engrave + cut'],
  fields: [
    { kind: 'symbol', key: 'symbol', label: 'Symbol', panel: 'right', section: 'Symbol', value: DEFAULT_SYMBOL },
    {
      kind: 'number', key: 'size', label: 'Size', section: 'Size & outline', value: 24, min: 8, max: 80, step: 1, unit: 'mm',
      help: 'Height of the symbol alone, the outline and loop add to it.',
    },
    {
      kind: 'number', key: 'outline', label: 'Outline', section: 'Size & outline', value: 3, min: 1, max: 12, step: 0.5, unit: 'mm',
      help: 'Border around the symbol, in Cut out keep 2 mm or more.',
    },
    {
      kind: 'number', key: 'smoothing', label: 'Rounded corners', section: 'Size & outline', value: 2, min: 0, max: 8, step: 0.5, unit: 'mm',
      help: 'Rounds corners and closes tiny gaps in the outline.',
    },
    opField('Size & outline', 'engrave', 'Symbol is', {
      help: 'Cut out keeps islands on stencil bridges, so nothing falls out.',
    }),
    {
      kind: 'number', key: 'rotation', label: 'Rotation', section: 'Size & outline', value: 0, min: -180, max: 180, step: 1, unit: '°', advanced: true,
      help: 'Turns the symbol and its outline together.',
    },
    {
      kind: 'toggle', key: 'flip', label: 'Flip', section: 'Size & outline', value: false, advanced: true,
      help: 'Mirrors the symbol so it can face the other way.',
    },
    ...keyringFields('outside', {
      nudge: 50,
      // The shared control is Loop tab | None since 2026-09-21; the old Hole mode's
      // round boss at the top is gone, and the tab rests off the paw's left as the gallery shows.
      ringNote: 'A loop tab off the edge, clear of the artwork.',
    }),
  ],
  async build(v) {
    const op = opOf(v);
    const size = num(v, 'size');
    const outline = num(v, 'outline');
    const keyring = keyringFrom(v);
    const rotation = num(v, 'rotation');

    // Mirrored before it is turned, so Flip reads as the symbol facing the other way rather than
    // as the rotation running backwards — the same order `withSymbols` uses for inline symbols.
    const flat = await symbolLayer(str(v, 'symbol'), size, op, { symbols: readSymbols(v) });
    const layers: DesignLayer[] = flat.map((l) => {
      const shapes = bool(v, 'flip') ? mirrorX(l.shapes) : l.shapes;
      return { ...l, shapes: rotation ? placeShapes(shapes, 0, 0, rotation) : shapes };
    });

    // The hole's own top. A hug has no bare band anywhere — the outline IS the artwork plus the
    // border — so Hole mode adds one: a disc the body wraps, never lasered itself, big enough
    // that the hole keeps its full border even at the thinnest outline.
    const drawn = layers.flatMap((l) => l.shapes);
    const dragged = keyring.position >= 0;
    let rest: [number, number] | null = null;
    if (keyring.enabled && keyring.mode === 'inside' && drawn.length) {
      const b = bboxOf(drawn);
      // Clear of the ink by the whole keep-off disc the engine measures (`dia/2 + ring`) plus a
      // little air: a hole that merely misses the artwork still has its border ON it.
      const air = Math.max(1, outline / 2);
      const centre: [number, number] = [(b.minX + b.maxX) / 2, b.maxY + air + keyring.dia / 2 + keyring.ring];
      const boss = Math.max(keyring.dia / 2, keyring.dia / 2 + keyring.ring - outline);
      layers.push({ id: 'loop-top', label: 'Loop', shapes: [[circleRing(centre[0], centre[1], boss, 48)]], op: 'off', hugOnly: true });
      rest = centre;
    }

    const warnings: string[] = [];
    if (op === 'cut') {
      const web = minWeb(drawn, MIN_WEB * 2);
      if (web < MIN_WEB) {
        warnings.push(`At this size the gaps inside ${symbolName(v)} come out ${web.toFixed(2)} mm wide — under a millimetre they burn away. Make it bigger, or engrave it instead.`);
      }
    }

    return {
      blank: { kind: 'hug', margin: outline, smoothing: num(v, 'smoothing') },
      keyring: rest && !dragged ? { ...keyring, rest } : keyring,
      layers,
      ...(warnings.length ? { warnings } : {}),
    };
  },
  fileName: (v) => stem(symbolName(v)),
};
