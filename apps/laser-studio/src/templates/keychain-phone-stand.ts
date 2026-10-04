// The pocket phone stand: ONE flat bar with a slot cut up from its bottom edge, a ring hole at
// one end and a name on the face: one slab of wood with a text/logo option (2026-09-22).
//
// How it works, because the shape only makes sense once you know: the bar stands on its narrow
// edge. The slot divides the bottom into a short LEG and the long BODY, and the phone's bottom
// edge drops into the slot between them — the leg holds the phone off the table at the front, the
// body leans back behind it. So the slot's width is the phone's thickness WITH its case on, and
// its depth is how much of the phone the stand holds; everything else is a rectangle.
//
// One piece, one cut, no joint, no assembly. That is the whole product, and it is why this is a
// separate template from the crossing-pieces `phone-stand` rather than a mode of it: nothing is
// shared but the word "stand".
import { bboxOf, filletRing, circleRing, type Box, type Pt, type Shapes } from '@vostok/laser';
import { fillShape, patternById, type PatternDef, type PatternOp } from '@vostok/patterns';
import { readSymbols } from '../symbols/model';
import { symbolLayer, textLayer } from '../engine/text';
import type { DesignLayer } from '../engine/types';
import { iconById } from '@vostok/fonts';
import { NO_KEYRING } from './keyring';
import { fillLayers } from './pattern-shared';
import { keepOff, opField, opOf, stem } from './shared';
import { bool, num, str, type TemplateDef } from './types';

/** Material between the ring hole and any edge, mm — the house wall for a hole that takes a
 *  split ring and then a pocketful of keys. */
const HOLE_WALL = 3;
/** Air between the lettering and anything it must not touch, mm. */
const PAD = 2.5;
/** The slot's corners are rounded by this share of its width: a square inside corner is where a
 *  thin bar cracks, and the phone only ever touches the rounded part anyway. */
const SLOT_R = 0.18;

/** Faces that hold up engraved at 5–7 mm on a bar this size: even strokes, nothing hairline. */
const FACES = ['montserrat', 'bebas-neue', 'jost', 'poppins', 'oswald'];

/** A logo shows by default, the way the name does: the template has to LOOK like what it makes
 *  on the first screen, and an empty symbol field only says a symbol is possible. */
const DEFAULT_LOGO = iconById('star')?.char ?? iconById('favorite')?.char ?? '';

/* --------------------------------------------------------------------- the pattern --

   An EITHER/OR, not an extra layer: a pattern instead of text and logo.
   The bar's face is 60 × 20 with a slot and a ring hole in it — there is room for a name and a
   logo, or for a pattern, and not for both. So the toggle swaps what the face carries, and the
   controls for the half you are not using are hidden rather than greyed.

   It covers the WHOLE bar: the region is the outline itself, so the fill follows the rounded
   corners and wraps round the leg and the slot's mouth. The one thing it keeps off is the ring
   hole — that hole takes a split ring and then the weight of a pocketful of keys, so the
   material round it stays solid. */
const DEFAULT_PATTERN = 'pm-japanese-pattern-4';
const FALLBACK_PATTERN = 'honeycomb';
/** Material left round the ring hole when a pattern is on, mm. */
const RING_KEEP = 2.5;
const OP_WORD: Record<PatternOp, string> = { cut: 'cut out', engrave: 'engraved', score: 'scored' };

let libraryLoaded: Promise<PatternDef[]> | null = null;
async function libraryPattern(id: string): Promise<PatternDef | undefined> {
  libraryLoaded ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
  const lib = await libraryLoaded;
  return lib.find((d) => d.id === id) ?? lib[0];
}

export const keychainPhoneStand: TemplateDef = {
  id: 'keychain-phone-stand',
  name: 'Keychain phone stand',
  blurb: 'A flat bar that lives on your keys and props your phone up — one piece, one cut, your name on the face.',
  tags: ['keychain', 'engrave + cut'],
  batch: { key: 'text', noun: 'stand' },
  fields: [
    // ------------------------------------------------------- RIGHT: what you type --
    // Everything you type disappears when the pattern takes the face: hidden, never greyed.
    { kind: 'text', key: 'text', label: 'Your name', panel: 'right', section: 'Text', value: 'Your name', placeholder: 'A name, or leave it blank', maxLength: 22, symbols: true, visibleWhen: (v) => !bool(v, 'usePattern') },
    // The logo is its OWN thing, not a character inside the name: it has its own size, its own
    // place on the bar and its own operation, so it can sit under the name, beside it, or
    // anywhere else the face allows. That is the whole point of separating them.
    { kind: 'symbol', key: 'logo', label: 'Your logo', panel: 'right', section: 'Logo', value: DEFAULT_LOGO, visibleWhen: (v) => !bool(v, 'usePattern') },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'montserrat', recommended: FACES, visibleWhen: (v) => !bool(v, 'usePattern') },

    // ------------------------------------------------------------- LEFT: the pattern --
    {
      kind: 'toggle', key: 'usePattern', label: 'Use a pattern instead of the name and logo', section: 'Pattern', value: false,
      help: 'Fills the whole bar. The name and logo controls go away while it is on.',
    },
    { kind: 'pattern', key: 'patternId', label: 'Pattern', section: 'Pattern', value: DEFAULT_PATTERN, visibleWhen: (v) => bool(v, 'usePattern') },
    { kind: 'number', key: 'patternScale', label: 'Zoom', section: 'Pattern', value: 100, min: 40, max: 300, step: 5, unit: '%', visibleWhen: (v) => bool(v, 'usePattern') },
    { kind: 'number', key: 'patternAngle', label: 'Angle', section: 'Pattern', value: 0, min: 0, max: 180, step: 5, unit: '°', visibleWhen: (v) => bool(v, 'usePattern') },
    {
      kind: 'select', key: 'patternOp', label: 'Make it', section: 'Pattern', value: 'engrave',
      options: [{ value: 'cut', label: 'Cut out' }, { value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'Line patterns cut as a lattice: the lines stay, the gaps go.',
      visibleWhen: (v) => bool(v, 'usePattern'),
    },
    {
      kind: 'number', key: 'patternWeb', label: 'Web', section: 'Pattern', value: 1, min: 1, max: 8, step: 0.1, unit: 'mm',
      help: 'The least material left between two holes, or between a hole and an edge.',
      visibleWhen: (v) => bool(v, 'usePattern') && str(v, 'patternOp') === 'cut',
    },

    // --------------------------------------------------------------- LEFT: the bar --
    { kind: 'number', key: 'length', label: 'Length', section: 'Size', value: 60, min: 40, max: 110, step: 1, unit: 'mm' },
    { kind: 'number', key: 'height', label: 'Height', section: 'Size', value: 20, min: 12, max: 40, step: 0.5, unit: 'mm' },
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Size', value: 3, min: 0, max: 10, step: 0.5, unit: 'mm' },

    // ------------------------------------------------------------- LEFT: the stand --
    // The one measurement that decides whether it works. A bare phone is 7–9 mm; in a case,
    // 10–13. Too narrow and it will not go in, too wide and the phone slumps.
    {
      kind: 'number', key: 'slotWidth', label: 'Phone slot', section: 'Stand', value: 11, min: 6, max: 20, step: 0.5, unit: 'mm',
      help: 'Your phone WITH its case — measure it, 10 to 13 mm is usual.',
    },
    {
      kind: 'number', key: 'slotDepth', label: 'Slot depth', section: 'Stand', value: 11, min: 4, max: 30, step: 0.5, unit: 'mm',
      help: 'How deep the phone sits. Deeper holds harder and leans less.',
    },
    {
      kind: 'number', key: 'leg', label: 'Front leg', section: 'Stand', value: 8, min: 3, max: 30, step: 0.5, unit: 'mm',
      help: 'The stub in front of the phone that stops it sliding out.',
    },

    // ------------------------------------------------------------- LEFT: the keyring --
    { kind: 'toggle', key: 'hole', label: 'Keyring hole', section: 'Keyring', value: true },
    {
      kind: 'number', key: 'holeDia', label: 'Hole diameter', section: 'Keyring', value: 5, min: 2.5, max: 8, step: 0.5, unit: 'mm',
      help: '5 mm takes a split ring.', visibleWhen: (v) => bool(v, 'hole'),
    },

    // --------------------------------------------------------------- LEFT: placing them --
    // Two pads, because two things. Each is an offset from where that mark sits by default —
    // the name centred on the face, the logo under it — so zero is always the sensible answer
    // and nobody has to dial in a position to get a good one.
    { kind: 'number', key: 'size', label: 'Name size', section: 'Name & logo', value: 6, min: 3, max: 14, step: 0.5, unit: 'mm', visibleWhen: (v) => !bool(v, 'usePattern') },
    {
      kind: 'position', key: 'textX', keyY: 'textY', label: 'Move the name', section: 'Name & logo',
      value: 0, valueY: 0, max: 40, step: 0.5, unit: 'mm', visibleWhen: (v) => !bool(v, 'usePattern'),
    },
    {
      kind: 'number', key: 'logoSize', label: 'Logo size', section: 'Name & logo', value: 7, min: 3, max: 18, step: 0.5, unit: 'mm',
      visibleWhen: (v) => !bool(v, 'usePattern') && str(v, 'logo') !== '',
    },
    {
      kind: 'position', key: 'logoX', keyY: 'logoY', label: 'Move the logo', section: 'Name & logo',
      value: 0, valueY: 0, max: 40, step: 0.5, unit: 'mm',
      visibleWhen: (v) => str(v, 'logo') !== '',
    },

    // ----------------------------------------------------------------- More options --
    { ...opField('More options', 'engrave', 'Name and logo'), advanced: true },
  ],

  async build(v) {
    const L = num(v, 'length');
    const H = num(v, 'height');
    const warnings: string[] = [];

    const slotW = num(v, 'slotWidth');
    // The slot cannot eat the whole bar: it leaves the leg in front of it and a spine above it.
    const slotD = Math.min(num(v, 'slotDepth'), H - 4);
    if (slotD < num(v, 'slotDepth') - 1e-6) warnings.push('The slot was made shallower to leave a spine above it — raise Height for a deeper one.');
    const leg = num(v, 'leg');

    const halfL = L / 2;
    const halfH = H / 2;
    const legX = -halfL + leg;
    const slotRight = legX + slotW;
    if (slotRight > halfL - 8) {
      warnings.push('The leg and the slot fill the bar — shorten one, or make the bar longer.');
    }

    const cornerR = Math.min(num(v, 'corner'), halfH - 0.5, leg / 2);
    const slotR = Math.min(SLOT_R * slotW, slotD / 3, leg / 3);

    /* The outline, counter-clockwise from the bottom-left: along the bottom to the leg, up and
       over the slot, on to the right end, up and back along the top. The slot is part of the
       OUTLINE, not a hole punched in it — it is open to the bottom edge, which is what lets the
       phone drop in. */
    const pts: Pt[] = [
      [-halfL, -halfH],
      [legX, -halfH],
      [legX, -halfH + slotD],
      [slotRight, -halfH + slotD],
      [slotRight, -halfH],
      [halfL, -halfH],
      [halfL, halfH],
      [-halfL, halfH],
    ];
    const radii = [cornerR, slotR, slotR, slotR, slotR, cornerR, cornerR, cornerR];
    const outline = filletRing(pts, radii);

    const layers: DesignLayer[] = [];

    // The ring hole, at the far end from the slot — the end you hold.
    const holeDia = num(v, 'holeDia');
    let holeLeft = halfL;
    if (bool(v, 'hole')) {
      const cx = halfL - (holeDia / 2 + HOLE_WALL);
      holeLeft = cx - holeDia / 2;
      layers.push({ id: 'ring', label: 'Keyring hole', op: 'cut', shapes: [[circleRing(cx, 0, holeDia / 2, 48)]] });
      if (holeDia + 2 * HOLE_WALL > H) warnings.push('The ring hole is too big for this bar — a smaller hole, or a taller bar.');
    }

    /* The face: what is left of the bar between the slot and the ring hole. Both marks are
       placed inside it, each from its own anchor — the name on the upper half, the logo on the
       lower — and then moved by its own pad. Nothing is centred on the BAR, because the bar's
       centre is over the slot. */
    const faceLeft = slotRight + PAD;
    const faceRight = holeLeft - PAD;
    const faceCx = (faceLeft + faceRight) / 2;
    const faceW = faceRight - faceLeft;
    const op = opOf(v);
    const logo = str(v, 'logo');
    const text = str(v, 'text').trim();
    /** With both a name and a logo the face is shared: the name takes the upper half, the logo
     *  the lower. With only one of them, that one has the middle. */
    const both = !!text && !!logo;

    const shift = (ls: DesignLayer[], dx: number, dy: number): DesignLayer[] =>
      ls.map((l) => ({ ...l, shapes: l.shapes.map((island) => island.map((ring) => ring.map(([x, y]): Pt => [x + dx, y + dy]))) }));
    const widthOf = (ls: DesignLayer[]): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const l of ls) for (const island of l.shapes) for (const ring of island) for (const [x] of ring) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      return hi > lo ? hi - lo : 0;
    };

    if (bool(v, 'usePattern')) {
      /* The pattern takes the whole bar, so the region is the OUTLINE — not the face between
         the slot and the hole. It runs round the leg, up to the slot's mouth and out to the
         rounded ends, because that is what "all over" means; the fill is clipped to the outline,
         so it can never leave the material.

         Only the ring hole is kept clear. It carries a split ring and then everything else on
         the keyring, so the material round it has to stay whole — a cut pattern reaching it
         would tear out in a pocket. */
      const chosen = str(v, 'patternId');
      const def = (chosen.startsWith('pm-') ? await libraryPattern(chosen) : patternById(chosen)) ?? patternById(FALLBACK_PATTERN)!;
      let pop = str(v, 'patternOp') as PatternOp;
      // Every pattern cuts: a line pattern as a lattice (`fillLayers`).
      if (!def.ops.includes(pop) && pop !== 'cut') {
        const fallback = def.ops[0]!;
        warnings.push(`${def.name} cannot be ${OP_WORD[pop]} — it is ${OP_WORD[fallback]} instead.`);
        pop = fallback;
      }
      const web = num(v, 'patternWeb');
      const fill = fillShape([[outline]], def, {
        op: pop,
        scale: num(v, 'patternScale') / 100,
        angle: num(v, 'patternAngle'),
        web,
        // The outline is the limit; `web` is what keeps a cut hole off it. No inset, so the
        // pattern really does reach the edge.
        inset: 0,
        // An ENGRAVE island that crosses the edge cannot be clipped without a boolean, and there
        // is none on this thread — the engine keeps it WHOLE and it escapes the outline. Measured
        // on this bar: the engrave group ran to y 53.8 on a 22 mm piece. `pattern-fill` never sees
        // it because its region is a smooth disc and the general clipper copes; this outline has a
        // concave notch, which defeats it. So a crossing island is DROPPED here instead. Scores and
        // cuts are exact either way — a line is clipped as a line, and a hole is judged by `web`.
        ...(pop === 'engrave' ? { partial: 'drop' as const } : {}),
        ...(pop === 'cut' ? { slitWidth: 0.25 } : {}),
        // A score of shapes is the outline of what they paint: the worker's union (`fillLayers`).
        hostOutline: true,
      });
      warnings.push(...fill.warnings);
      const made: DesignLayer[] = fillLayers(fill, def, { kind: 'fill' });
      /* The ring hole is kept clear only when the pattern is CUT: a scored or engraved pattern
         ignores the hole, as if it were not there.

         The difference is what the operation does to the material. A cut pattern puts real holes
         in the bar, and one landing beside the ring hole leaves a thread of wood that tears out
         in a pocket — so those have to stay a web away. A score or an engrave removes nothing:
         the ring hole is cut out regardless, so a line crossing it is simply not there
         afterwards. The build clips every layer to the finished plate, hole included, so the
         pattern comes out continuous and interrupted by the hole exactly as the eye expects —
         which is what keeping it out was spoiling, by leaving a bald patch round the hole. */
      if (pop === 'cut' && bool(v, 'hole')) {
        const r = holeDia / 2 + Math.max(web, RING_KEEP);
        const cx = halfL - (holeDia / 2 + HOLE_WALL);
        const ringKeep: Box = { minX: cx - r, maxX: cx + r, minY: -r, maxY: r };
        layers.push(...keepOff(made, ringKeep));
      } else layers.push(...made);
    } else if (faceW < 4 || H - 2 * PAD < 2) {
      if (text || logo) warnings.push('There is no face left to engrave — a longer bar, or a narrower slot.');
    } else {
      if (text) {
        let size = Math.min(num(v, 'size'), both ? (H - 2 * PAD) * 0.55 : H - 2 * PAD);
        let drawn = await textLayer({ text, font: str(v, 'font'), size, symbols: readSymbols(v) }, op, 'text', 'Name');
        const w = widthOf(drawn);
        if (w > faceW && w > 1e-6) {
          size = Math.max(2, (size * faceW) / w);
          drawn = await textLayer({ text, font: str(v, 'font'), size, symbols: readSymbols(v) }, op, 'text', 'Name');
          warnings.push(`The name was set at ${Math.round(size * 10) / 10} mm to fit the bar.`);
        }
        layers.push(...shift(drawn, faceCx + num(v, 'textX'), (both ? H * 0.16 : 0) + num(v, 'textY')));
      }
      if (logo) {
        const size = Math.min(num(v, 'logoSize'), both ? (H - 2 * PAD) * 0.5 : H - 2 * PAD);
        const drawn = await symbolLayer(logo, size, op, { symbols: readSymbols(v) }, 'logo');
        if (drawn.length) {
          const w = widthOf(drawn);
          if (w > faceW) warnings.push('The logo is wider than the face — make it smaller, or the bar longer.');
          layers.push(...shift(drawn, faceCx + num(v, 'logoX'), (both ? -H * 0.18 : 0) + num(v, 'logoY')));
        }
      }
    }

    const blank: Shapes = [[outline]];
    return {
      blank: { kind: 'shape', shapes: blank },
      keyring: NO_KEYRING,
      layers,
      warnings,
      status: `${L} × ${H} mm · ${slotW} mm slot`,
    };
  },

  exportNote: 'One piece. Stand it on its edge and drop your phone into the slot.',
  fileName: (v) => stem(str(v, 'text') || 'phone-stand', 'keychain'),
};
