import { readSymbols } from '../symbols/model';
// The layered name keychain: TWO pieces, and only ever two — not 3, and no option for it. A
// light backer with the loop grown out of its left end, and the dark name glued on top. Nothing
// else.
//
//   NAME    the glyphs welded into one body (G33) — a script at its natural advance, a block face
//           overlapped a little with the junctions scored. No loop, no hole, counters open.
//   BACKER  the primary piece, and the ONLY one that carries the ring. Its outline is the
//           customer's choice of two: the name's own union offset by Border, rounded, counters
//           filled (OUTLINE) — or a shape from the library with the name fitted inside it, Border
//           clear of its edge (SHAPE). Either way it carries an inset scored outline of the name,
//           which is the glue guide.
//
// Both pieces are built in one frame from the same glyph outlines, so they register by
// construction rather than by hand, and `assembledAt: 'built'` puts the name back in the backer's
// frame for the 3D view and the gallery card.
//
// What the shipped version got wrong and this one does not:
// three pieces behind a thumbs picker; a loop tab on EVERY piece, so the top layer wore a hook of
// its own; a backer smoothed into a blob; and score lines that were fragments of every letter's
// edge instead of the seams where one letter runs under the next.
import { bboxOf, type Shapes } from '@vostok/laser';
import { MIN_COUNTER, textLayer, type TextSpec } from '../engine/text';
import type { Blank, DesignLayer, PartInput } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import {
  WELDING_SCRIPTS, blankShapes, bridgeField, bridgeModeOf, connectSpec, connectWarning, countersTooTight, fitPlan,
  isConnectingFont, joinDots, letterScoreField, onlyWhen, shapeFields, stem, weldOverlap,
} from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

/** Cut-through lettering under this height chips in handling (a fat face wants 15–20 mm of cap
 *  before its thinnest stroke survives a cut). The name piece is cut through, so this is its
 *  floor. */
const MIN_LETTER = 15;

/** How far inside the name's edge the glue guide is scored, mm. The line has to disappear under
 *  the piece that is glued over it, so it sits half a
 *  millimetre in, which is more than the kerf on either edge and still a line you can see to
 *  register against. */
const GUIDE_INSET = 0.5;

/** The bar that holds an i's dot — or a word gap — to the rest of the name, mm. The same rule the
 *  name keychain's welded mode uses: enough to survive being lifted off the bed, never so wide it
 *  reads as part of the letter. */
const bridgeFor = (size: number) => Math.min(3, Math.max(1.5, 0.12 * size));

/** The letter size this design opens at, mm — an em, so a longer name makes a longer keychain. */
const SIZE = 24;

/** How far Boldness may fatten the strokes: the name keychain's 2.5 % of the letter height (G30),
 *  measured where the letters of a block face start to fuse, at this design's own size. */
const BOLD_MAX = +(SIZE * 0.025).toFixed(2);

/** The backer shape the Shape option opens on: the library's rounded tag, wide enough for "Noah"
 *  at the opening letter size with a border of backer showing all round. */
const SHAPE = { value: 'tag', width: 70, height: 36, corner: 9 };

/**
 * The faces this design is FOR. The welding scripts first — they write as one connected line, so
 * the name needs no overlap at all and the piece is the letters exactly as the type designer drew
 * them — then the fat rounded faces that weld cleanly at this size, for anyone who wants a block
 * name rather than a script.
 *
 * Every face here was built in "Noah" AND in "hello claude" at the defaults before it went on the
 * list (tests/node/layered-keychain.test.mjs §7): both pieces one island, no invented joining
 * bars, counters still open, nothing to warn about.
 *
 * "hello claude" is the word that decides it, because the length cap takes that name down to
 * ~14 mm letters and a face whose counters are tight at 24 mm has none left at 14. Luckiest Guy,
 * Titan One, Dela Gothic One, Sigmar One, Bowlby One SC and Alfa Slab One all weld into one clean
 * island and all seal a counter there, so none of them is here; Damion and Great Vibes pass but
 * are hairline scripts at keychain size, which is what `WELDING_SCRIPTS` already ruled on. All of
 * them are still one click away under "Browse all fonts".
 */
const RECOMMENDED = [...WELDING_SCRIPTS, 'fredoka', 'baloo-2', 'lilita-one', 'chewy'];

/** The backer's outline: the name's own, offset — or a shape from the library. */
const onShape = (v: Values) => str(v, 'backerShape') === 'shape';

export const layeredKeychain: TemplateDef = {
  id: 'layered-keychain',
  name: 'Layered keychain',
  blurb: 'A name cut from one colour, glued on a backer that follows its outline.',
  // Job order, which is the order the laser runs them in: the glue guide and the letter seams are
  // scored, then both outlines are cut. Nothing here is ever engraved.
  tags: ['keychain', 'score + cut'],
  batch: { key: 'text', noun: 'keychain' },
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Text',
      value: 'Noah', placeholder: 'A name', maxLength: 20, symbols: true,
    },
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'pacifico', recommended: RECOMMENDED },

    // --------------------------------------------------- LEFT: "Backer" (opens first) --
    {
      kind: 'select', key: 'backerShape', label: 'Backer shape', section: 'Backer', value: 'outline',
      options: [{ value: 'outline', label: 'Outline' }, { value: 'shape', label: 'Shape' }],
      help: 'Outline follows the name, Shape is a tag from the library.',
    },
    // The shape's own picker and sizes, on the Shape option only. A shape's drawn marks (a
    // football's laces) are not offered: the name is glued over the middle of the backer, and a
    // backer is a silhouette, not a picture.
    ...onlyWhen(
      shapeFields({ ...SHAPE, categories: ['keychains', 'tags', 'shapes', 'silhouettes'], section: 'Backer' })
        .filter((f) => f.key !== 'shapeDetails'),
      onShape,
    ),
    // The one knob that makes this design this design: how much of the second colour shows round
    // the letters. 3 mm is the shadow-line proportion at keychain scale
    // (2–4 mm at 30–70 mm, 5–8 mm at ornament scale). On a shape it is the clear margin the name
    // keeps from the shape's edge.
    {
      kind: 'number', key: 'border', label: 'Border', section: 'Backer',
      value: 3, min: 1.5, max: 8, step: 0.1, unit: 'mm',
      help: 'How much backer shows around the letters.',
    },
    {
      kind: 'toggle', key: 'guide', label: 'Glue guide', section: 'Backer', value: true,
      help: 'Scores where the name goes; hidden once it is glued.',
    },

    // --------------------------------------------------------------- LEFT: "Lettering" --
    {
      kind: 'number', key: 'size', label: 'Letter size', section: 'Lettering',
      value: SIZE, min: 10, max: 40, step: 0.5, unit: 'mm',
      help: 'The em size, so a longer name makes a longer keychain.',
    },
    // The length cap is the OUTLINE backer's: a shape has its own width, and the name is fitted
    // inside that instead.
    {
      kind: 'number', key: 'fit', label: 'Maximum length', section: 'Lettering',
      value: 95, min: 40, max: 200, step: 1, unit: 'mm', visibleWhen: (v) => !onShape(v),
      help: 'The backer, loop included, stays under this — letters shrink to fit.',
    },
    // Both pieces follow it: the backer is the same letters offset, so a bolder name grows a
    // bigger backer and the glue guide moves with it.
    {
      kind: 'number', key: 'boldness', label: 'Boldness', section: 'Lettering',
      value: 0, min: -0.3, max: BOLD_MAX, step: 0.05, unit: 'mm',
      help: 'Fattens or thins the letters, and the backer follows.',
    },
    {
      kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering',
      value: 0, min: -0.1, max: 0.3, step: 0.02, format: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`,
      help: 'Air between the letters, as a share of their height.',
    },
    // On by default: the name piece is weld-and-score, so a block face still reads letter by
    // letter. A connecting script overlaps nothing and has no buried edge to score, so the
    // control is not there at all — hidden, never greyed.
    { ...letterScoreField('Lettering'), visibleWhen: (v) => !isConnectingFont(str(v, 'font')) },
    // Off by default, like every other welded design, and switchable. This template shipped with
    // the engine's `bridges: 'all'` default and no control, so a script that leaves one gap got
    // a slab welded across its baseline — visible in the piece, and traced into the backer's glue
    // guide.
    //
    // It is the LEAST defensible here of anywhere: the name is glued onto a backer that carries an
    // inset score of its own outline, so two loose letters are placed by the guide, not lost. The
    // bars bought one piece off the bed and cost the letterform, which `bridgeField`'s own note
    // already settled for the name keychain and connected text.
    bridgeField('Lettering'),

    // ------------------------------------------------------------------ LEFT: "Keyring" --
    // Grown from the BACKER, at the name's start: the left end, half way up. The top layer never
    // carries a loop (the backer is the one continuous
    // silhouette in the stack, and a hole through the name lands in a letter or in the gap
    // between two). `nudge` is half the default keychain's own length (G25).
    ...keyringFields('outside', {
      side: 'left', along: 50, dia: 5, ring: 2.5, nudge: 40, maxDia: 8, maxRing: 5,
      ringNote: 'Grows a loop off the backer; the name never carries one.',
    }),
  ],

  async build(v) {
    const border = Math.max(0.5, num(v, 'border'));
    const font = str(v, 'font');
    const size = num(v, 'size');
    const keyring = keyringFrom(v);
    const shaped = onShape(v);
    const warnings: string[] = [];

    // The backer when it follows the name: the letters in a jacket — hug them at the Border, round
    // what the offset leaves as a notch between two letters, and fill every counter, because a
    // backer is a silhouette, not lettering. The rounding is 0.35 × Border, the same proportion
    // the framed ornaments round a rim's inner corners by; it is the design, not a control.
    const jacket = (margin: number): Blank =>
      ({ kind: 'hug', margin, smoothing: 0.35 * margin, counters: 'filled', bridge: Math.max(bridgeFor(size), margin) });
    const shapes: Shapes = shaped ? blankShapes(v, SHAPE.value) : [];
    const backer: Blank = shaped ? { kind: 'shape', shapes } : jacket(border);

    // Weld and score, exactly as G33 says: `connectSpec` picks the overlap by face — nothing at
    // all for a script that already writes as one line, a little for anything else — and caps the
    // hairline of bold at what the narrowest counter can spare. Boldness rides on top of that
    // hairline, on both pieces.
    const specAt = (s: number, x = 0, y = 0): TextSpec => ({
      symbols: readSymbols(v),
      text: str(v, 'text'),
      font,
      size: s,
      x,
      y,
      letterSpacing: num(v, 'letterSpacing'),
      boldness: num(v, 'boldness'),
      connect: connectSpec(font, s),
    });
    let drawn = await textLayer(specAt(size), 'off');
    if (!drawn[0]) {
      // Nothing typed: the engine's empty plate holds the stage, and one sentence says what to do.
      return { blank: backer, keyring, layers: [], warnings: ['Type a name to build the keychain.'] };
    }

    let ink = bboxOf(drawn[0].shapes);
    let shrunk = false;
    if (shaped) {
      // On a shape the name is FITTED: shrunk, and moved if it has to be, until it sits inside the
      // shape with Border of backer clear all round — the same fit every name-on-a-shape design
      // uses. The welded run is rebuilt at the fitted size rather than scaled, so the overlap and
      // the hairline stay what that size asks for.
      const plan = fitPlan(shapes, ink, keyring, { inset: border });
      if (plan.k < 0.999 || plan.moved) {
        const s = Math.max(3, size * plan.k);
        const centre = [(ink.minX + ink.maxX) / 2 + plan.dx, (ink.minY + ink.maxY) / 2 + plan.dy] as const;
        const refit = await textLayer(specAt(s, centre[0], centre[1]), 'off');
        if (refit[0]) {
          drawn = refit;
          ink = bboxOf(refit[0].shapes);
          shrunk = plan.k < 0.999;
        }
      }
    } else {
      // A keychain has no outline to shrink into, so the fit is a length cap. The border and the
      // loop's tab are fixed millimetres; only the lettering can give, and it gives once.
      const tab = keyring.enabled ? keyring.dia + 1.5 * keyring.ring : 0;
      const maxInk = num(v, 'fit') - 2 * border - tab;
      if (maxInk > 5 && ink.maxX - ink.minX > maxInk) {
        const s = Math.max(3, (size * maxInk) / (ink.maxX - ink.minX));
        const refit = await textLayer(specAt(s), 'off');
        if (refit[0]) {
          drawn = refit;
          ink = bboxOf(refit[0].shapes);
          shrunk = true;
        }
      }
    }

    // Every i's dot dropped onto its stem, so the name comes off the bed in ONE piece with no
    // joining bar. Before this a
    // "Cindy" or a "Kylie" was a name plus a loose dot to find on the bed and glue by eye.
    drawn = joinDots(drawn, weldOverlap(size));
    // The letters are MATERIAL on both pieces — they shape each outline and are never lasered
    // themselves. One set of layers, two offsets: that is what makes the pieces register.
    const letters: DesignLayer[] = drawn.map((l) => ({ ...l, op: 'off' as const, hugOnly: true }));
    // The seams: a second copy of the same per-glyph islands, scored only where one letter meets
    // the next. Never on the backer — what is under the name is the name.
    //
    // And only on a face the overlap walk had to WELD. A connecting script's letters were joined
    // by the type designer, so a line burnt at every join is a line drawn across a stroke that is
    // meant to read as one — which is why a script carries none. Same rule
    // as connected-text; the control is hidden rather than greyed when the face connects.
    const overlap = connectSpec(font, size).overlap ?? 0;
    const seams: DesignLayer[] = str(v, 'letterLines') === 'score' && overlap > 0
      ? drawn.map((l) => ({ ...l, id: `${l.id}-seam`, label: 'Letter seams', op: 'score' as const, seams: true }))
      : [];
    // The glue guide: the name's own outline, inset, on the backer. `grow` carries the layer's
    // thicken with it, so the line lands GUIDE_INSET inside the edge the name is really cut on
    // rather than inside the letters before the weld fattened them. `kind: 'guide'` keeps it out
    // of the engine's "the ring sits on the lettering" net — it is a registration mark, not a word.
    const guide: DesignLayer[] = bool(v, 'guide')
      ? drawn.map((l) => ({
        ...l, id: `${l.id}-guide`, label: 'Glue guide', op: 'score' as const, kind: 'guide' as const,
        grow: (l.grow ?? 0) - GUIDE_INSET,
      }))
      : [];

    const parts: PartInput[] = [{
      id: 'name',
      label: 'Name · colour 2',
      // G33: the piece IS the letters. Margin 0, no smoothing pass, counters open — the backer
      // shows through the hole in an "o", which is the whole point of a layered keychain.
      // `bridges` from the toggle, which opens OFF: a name that comes off the bed in two pieces is
      // glued down in two pieces, against a scored guide that says exactly where each goes.
      blank: { kind: 'hug', margin: 0, smoothing: 0, counters: 'open', bridge: bridgeFor(size), minHole: MIN_COUNTER, bridges: bridgeModeOf(v) },
      layers: [...letters, ...seams],
      // Never. The loop is the backer's (feedback: "second layer shouldnt have a hook").
      keyring: 'none',
      // Both pieces are built in one frame and only the sheet layout pulls them apart, so gluing
      // up is undoing that. A point cannot be named here: the backer's box centre is offset from
      // the name's by the lug on its left, and by half the border everywhere else.
      assembledAt: 'built',
      // The dark raised script. `z` and the tone are two different
      // questions (P5): the tone says walnut, the `z` says it rests ON the backer's tier rather
      // than beside it — without it a dark piece is drawn UNDER the light one and the 3D view
      // sinks the name into the backer instead of standing it proud.
      material: 'dark',
      z: 2,
    }];

    const inkH = ink.maxY - ink.minY;
    // Name the knob that will actually change it: once the length cap or the shape has shrunk the
    // name, Letter size is a slider the refit undoes on the next build.
    if (inkH < MIN_LETTER) {
      const fix = !shrunk ? 'Raise Letter size.' : shaped ? 'Pick a bigger shape, or shorten the name.' : 'Raise Maximum length, or shorten the name.';
      warnings.push(`Letters are ${inkH.toFixed(1)} mm tall — cut-out lettering under 15 mm chips in handling. ${fix}`);
    }
    warnings.push(...connectWarning(font), ...countersTooTight(drawn.flatMap((l) => l.shapes)));
    // The finished BACKER, not the slider: "Noah" at the cap's maximum builds the same keychain it
    // builds at the default, and used to be told it was bag-tag length while the customer was
    // looking at a keychain.
    const tab = keyring.enabled ? keyring.dia + 1.5 * keyring.ring : 0;
    const shapeBox = shaped && shapes.length ? bboxOf(shapes) : null;
    const builtWidth = shapeBox ? shapeBox.maxX - shapeBox.minX + tab : ink.maxX - ink.minX + 2 * border + tab;
    if (builtWidth > 120) warnings.push('That is bag-tag length, not keychain length.');

    return {
      label: 'Backer · colour 1',
      // The light sheet: the backer is the piece the name is glued to, and the
      // one the loop is grown from.
      material: 'light',
      keyring,
      blank: backer,
      layers: [...letters, ...guide],
      parts,
      // Two different colours of sheet, so nesting them buys nothing: the reading order is the
      // exploded stack, the backer above the piece that lands on it.
      layout: { flow: 'column', gap: 5 },
      // The letter height actually cut, because "Letter size" is an em and the length cap can back
      // it off without saying so.
      status: `2 pieces · ${inkH.toFixed(1)} mm letters · cut each from its own colour`,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  exportNote: 'Cut the two pieces from different colours, then glue the name onto the backer.',

  fileName: (v) => stem(str(v, 'text') || 'name', 'layered'),
};
