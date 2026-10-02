// The phone stand: two identical planks that slot together at a right angle, and a phone leaning
// in the V between them. Type a name, pick a size, cut two pieces.
//
// Everything about the stand — the arms, the slot, the lean, whether it STANDS — is
// `engine/cross-stand.ts`, which is where that arithmetic belongs and where the QR stand takes it
// from in wave 2. What is this template's own is the name on the front piece's lip: the one face
// a docked phone leaves in plain view, and the natural place for a maker's mark.
//
// 2026-09-21: a complete overhaul of the geometry. The plate
// dropped into a slotted base (`engine/stands.ts`'s `slotBase`) is gone.
import { bboxOf, placeShapes, type Box, type Shapes } from '@vostok/laser';
import { fillShape, patternById, type PatternDef, type PatternOp } from '@vostok/patterns';
import type { CutRing } from '@vostok/export';
import { crossStandGeometry, crossStandPieces } from '../engine/cross-stand';
import { fitClearance } from '../engine/slots';
import { fitBoxInside } from '../engine/editorGeometry';
import { symbolLayer, textLayer } from '../engine/text';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { fillLayers } from './pattern-shared';
import { keepOff, stem } from './shared';
import { bool, num, str, type TemplateDef, type Values } from './types';

type Pt = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A stand is free-standing: nothing here hangs from a ring. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1 });

/** Engraved caps under this break up in a thin face (the house floor). */
const MIN_CAP = 4.5;

/* ------------------------------------------------------------------------- the pattern --

   WHERE it goes is the part worth deciding rather than defaulting to, so: the BACK piece's
   panel, above the slot.

   That is the one big continuous face this object has — about 80 × 105 at the default, against
   a lip of 80 × 20 — and it is the face you look at. The back piece rises at the lean; with no
   phone docked it IS the object, and with one docked its top still shows above the screen. The
   front piece cannot take it: its long arm runs down and back underneath the phone where
   nothing is visible, and its short arm is the lip, which the phone's own bottom edge sits on
   and hides. So the pattern goes on the panel and the name stays on the lip — each where it can
   be seen.

   The region is the PIECE ITSELF — its outline, with the slot punched out of it as a hole. Not
   a box on it: a rectangle inside the content box left a wide blank border and a dead area
   below the slot, and read as a panel stuck onto the face rather than as the face. The pattern
   covers the whole front face, completely.

   Cutting is offered, not just scoring: a pierced back panel is the thing people buy these for.
   The engine's own `web` keeps every hole off the outline and off the slot, and this panel
   carries no load a pierced field threatens — it leans against the prop, it does not span. */
const DEFAULT_PATTERN = 'pm-japanese-pattern-4';
const FALLBACK_PATTERN = 'honeycomb';
/** How much material the pattern leaves round the SLOT — the one place on this piece that has to
 *  stay solid, because the other piece grips it there. */
const SLOT_KEEP = 3;
/** What an operation is called in a sentence. */
const OP_WORD: Record<PatternOp, string> = { cut: 'cut out', engrave: 'engraved', score: 'scored' };

let libraryLoaded: Promise<PatternDef[]> | null = null;
async function libraryPattern(id: string): Promise<PatternDef | undefined> {
  libraryLoaded ??= import('@vostok/patterns/library').then((m) => m.LIBRARY);
  const lib = await libraryLoaded;
  return lib.find((d) => d.id === id) ?? lib[0];
}

/**
 * The lean, in degrees from the TABLE.
 *
 * `lean` used to mean the plate's tilt from VERTICAL (10–25°, default 15) on the slotted-base
 * stand this template replaced. It means the phone's own angle from the table now, which is a
 * different number for the same key — so a project saved under the old template would open as a
 * stand lying nearly flat. Anything outside the range the form offers is therefore an old file,
 * and takes the default.
 */
const leanOf = (v: Values): number => {
  const a = num(v, 'lean');
  return a >= 60 && a <= 72 ? a : 67;
};

const boxOf = (layers: DesignLayer[]) => bboxOf(layers.flatMap((l) => l.shapes));
const centreOf = (b: Box): Pt => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
const rectShapes = (b: Box): Shapes => [[[[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] as CutRing]];


const move = (layers: DesignLayer[], dx: number, dy: number): DesignLayer[] =>
  Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? layers : layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));

/** Symbol and name scaled as ONE block about `c`, so the gap between them scales with them. */
const scaleAbout = (layers: DesignLayer[], k: number, c: Pt): DesignLayer[] =>
  layers.map((l) => ({ ...l, shapes: l.shapes.map((isl) => isl.map((r) => r.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k] as Pt))) }));

export const phoneStand: TemplateDef = {
  id: 'phone-stand',
  name: 'Phone stand',
  blurb: 'Two crossing pieces your phone leans in, cut from one sheet.',
  tags: ['sign', 'home', 'score + cut'],
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    {
      // Empty by default: the stand's decoration is the pattern now, and a
      // name is something you add rather than something you have to clear.
      kind: 'text', key: 'text', label: 'Name', panel: 'right', section: 'Text', value: '',
      placeholder: 'A name, a word…', maxLength: 18, help: 'Engraved on the front piece, under the phone.',
    },
    { kind: 'symbol', key: 'symbol', label: 'Symbol', panel: 'right', section: 'Text', value: '', help: 'Optional, above the name.' },

    // -------------------------------------------------------- LEFT: the back panel --
    { kind: 'toggle', key: 'pattern', label: 'Pattern on the panel', section: 'Pattern', value: true, help: 'Fills the big face the phone leans on.' },
    {
      kind: 'pattern', key: 'patternId', label: 'Pattern', section: 'Pattern', value: DEFAULT_PATTERN,
      visibleWhen: (v) => bool(v, 'pattern'),
    },
    { kind: 'number', key: 'patternScale', label: 'Zoom', section: 'Pattern', value: 100, min: 40, max: 300, step: 5, unit: '%', visibleWhen: (v) => bool(v, 'pattern') },
    { kind: 'number', key: 'patternAngle', label: 'Angle', section: 'Pattern', value: 0, min: 0, max: 180, step: 5, unit: '°', visibleWhen: (v) => bool(v, 'pattern') },
    {
      kind: 'select', key: 'patternOp', label: 'Make it', section: 'Pattern', value: 'score',
      options: [{ value: 'cut', label: 'Cut out' }, { value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'Line patterns cut as a lattice: the lines stay, the gaps go.',
      visibleWhen: (v) => bool(v, 'pattern'),
    },
    {
      kind: 'number', key: 'patternWeb', label: 'Web', section: 'Pattern', value: 2.5, min: 1, max: 8, step: 0.1, unit: 'mm',
      help: 'The least material left between two holes, or between a hole and an edge.',
      visibleWhen: (v) => bool(v, 'pattern') && str(v, 'patternOp') === 'cut',
    },
    {
      kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'montserrat',
      // Engraved small on the lip and read across a desk: clean sans with open counters, and two
      // scripts for a name. Every one was built at the default stand before it was listed.
      recommended: ['montserrat', 'work-sans', 'poppins', 'manrope', 'outfit', 'bebas-neue', 'great-vibes', 'yellowtail'],
    },

    // ------------------------------------------------------ LEFT: "Stand" (opens first) --
    {
      kind: 'number', key: 'width', label: 'Width', section: 'Stand', value: 80, min: 50, max: 120, step: 1, unit: 'mm',
      help: 'Across the V — a big phone is 78 mm wide.',
    },
    { kind: 'number', key: 'height', label: 'Height', section: 'Stand', value: 130, min: 90, max: 200, step: 1, unit: 'mm' },

    // -------------------------------------------------------------- LEFT: "Assembly" --
    // The sheet the joint is cut for, in its own category rather than buried under More (every
    // design with interlocking parts gets a separate Assembly section).
    {
      kind: 'number', key: 'thickness', label: 'Material thickness', section: 'Assembly', value: 3, min: 1.5, max: 9, step: 0.1, unit: 'mm',
      help: 'Measure your sheet, the slots are cut to match it.',
    },
    {
      kind: 'number', key: 'kerf', label: 'Kerf', section: 'Assembly', value: 0.18, min: 0, max: 0.5, step: 0.01, unit: 'mm',
      help: 'How much material your laser burns away per pass.',
    },
    {
      kind: 'select', key: 'fit', label: 'Fit', section: 'Assembly', value: 'snug',
      options: [{ value: 'tight', label: 'Tight' }, { value: 'snug', label: 'Snug' }, { value: 'easy', label: 'Easy' }],
      help: 'Tight knocks home, Snug takes a thumb, Easy pulls apart.',
    },
    // ------------------------------------------------------------------ LEFT: "More" --
    {
      kind: 'number', key: 'lean', label: 'Lean', section: 'Stand', value: 67, min: 60, max: 72, step: 1, unit: '°', advanced: true,
      help: 'How far back the phone leans off the table.',
    },
  ],

  async build(v) {
    const width = clamp(num(v, 'width'), 24, 300);
    const height = clamp(num(v, 'height'), 50, 400);
    const t = clamp(num(v, 'thickness'), 0.5, 20);
    const kerf = clamp(num(v, 'kerf'), 0, 2);

    // ------------------------------------------------------------------- the stand --
    const g = crossStandGeometry({ width, height, t, kerf, lean: leanOf(v), clearance: fitClearance(str(v, 'fit')) });

    // -------------------------------------------------------------------- the name --
    // Sized off the lip it sits on, never off a constant: the same stand at 50 mm and at 120 mm
    // wide gets lettering in the same proportion.
    const box = g.content;
    const boxH = Math.max(0, box.maxY - box.minY);
    const symbols = readSymbols(v);
    const font = str(v, 'font');
    const text = str(v, 'text');
    const nameSize = clamp(0.32 * boxH, 4, 14);
    const symSize = clamp(0.5 * boxH, 6, 22);

    const mark = await symbolLayer(str(v, 'symbol'), symSize, 'engrave', { symbols }, 'symbol');
    let name = await textLayer({ symbols, text, font, size: nameSize }, 'engrave', 'name', 'Name');
    // The name hangs off the symbol's MEASURED box, not off `symSize`: a wide mark and a tall one
    // do not put their name in the same place.
    if (name.length && mark.length) {
      const mb = boxOf(mark);
      const nb = boxOf(name);
      const to: Pt = [(mb.minX + mb.maxX) / 2, mb.minY - nameSize * 0.45 - (nb.maxY - nb.minY) / 2];
      const from = centreOf(nb);
      name = move(name, to[0] - from[0], to[1] - from[1]);
    }

    let block = [...mark, ...name];
    let fit = 1;
    if (block.length && boxH > 0) {
      const centre = centreOf(box);
      const c = centreOf(boxOf(block));
      block = move(block, centre[0] - c[0], centre[1] - c[1]);
      const b = boxOf(block);
      fit = fitBoxInside(rectShapes(box), centre, [(b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2], 0, null);
      if (fit < 0.999) block = scaleAbout(block, Math.max(0.05, fit), centre);
    }

    // -------------------------------------------------- the pattern, on the back panel --
    const backLayers: DesignLayer[] = [];
    const patternWarnings: string[] = [];
    let patternKeepOut: Box | null = null;
    if (bool(v, 'pattern')) {
      /* The region is the PIECE, not a box on it: the pattern covers the whole front face.

         It used to be a rectangle inside the content box, which left a wide blank border and a
         dead area below the slot — the pattern read as a panel stuck on the face rather than as
         the face. Passing the outline itself means the fill follows the rounded corners and runs
         down between the feet, and the engine clips it to the real edge for free.

         A CUT pattern is held off the slot — see below for why only a cut. */
      const slotBox = bboxOf([[g.backSlot[0]![0]!]]);
      const region: Shapes = [[g.backPlank]];
      const pb = bboxOf(region);
      const w = pb.maxX - pb.minX;
      const h = pb.maxY - pb.minY;
      if (w > 10 && h > 10) {
        const chosen = str(v, 'patternId');
        const def = (chosen.startsWith('pm-') ? await libraryPattern(chosen) : patternById(chosen)) ?? patternById(FALLBACK_PATTERN)!;
        let op = str(v, 'patternOp') as PatternOp;
        // Every pattern cuts: a line pattern as a lattice (`fillLayers`).
        if (!def.ops.includes(op) && op !== 'cut') {
          const fallback = def.ops[0]!;
          patternWarnings.push(`${def.name} cannot be ${OP_WORD[op]} — it is ${OP_WORD[fallback]} instead.`);
          op = fallback;
        }
        const web = num(v, 'patternWeb');
        /* The slot keep-out, for a CUT only (as on the keychain stand's ring hole, a scored or
           engraved pattern ignores the hole as if it were not there — the same rule applies here).

           A cut pattern puts real holes in the panel, and one landing beside the slot leaves a
           thread of wood where the other piece grips: that has to stay a web away. A score or an
           engrave removes nothing — the slot is cut out regardless, so a line crossing it is
           gone afterwards — and holding the pattern off it only left a bald band across the
           panel. */
        if (op === 'cut') {
          const keep = Math.max(web, SLOT_KEEP);
          patternKeepOut = {
            minX: slotBox.minX - keep, maxX: slotBox.maxX + keep,
            minY: slotBox.minY - keep, maxY: slotBox.maxY + keep,
          };
        }
        const fill = fillShape(region, def, {
          op,
          scale: num(v, 'patternScale') / 100,
          angle: num(v, 'patternAngle'),
          web,
          /* No inset: the pattern runs to the piece's real edge, which is the whole point of
             filling the face rather than a box on it.

             Nothing is lost by it. A score or an engrave is clipped to the outline anyway, so it
             stops exactly at the edge and the burn never leaves the material. A CUT is kept safe
             by `web` instead — the engine drops any hole that comes within a web of the edge,
             which is the rule that actually protects the outline; an inset was only ever a
             blunter way of saying the same thing.

             It also could not be used here: `insetShapes` is a mitred vertex offset and it folds
             on this outline's notch, so asking for one got a warning and ran to the edge anyway.
             Better to mean it. */
          inset: 0,
          ...(op === 'cut' ? { slitWidth: 0.25 } : {}),
          // A score of shapes is the outline of what they paint: the worker's union (`fillLayers`).
          hostOutline: true,
        });
        patternWarnings.push(...fill.warnings);
        backLayers.push(...fillLayers(fill, def, { id: 'panel-pattern', kind: 'fill' }));
      } else patternWarnings.push('The back panel is too small to pattern — a taller stand, or turn the pattern off.');
    }

    // ------------------------------------------------------------------ the pieces --
    // The slot keep-out applies to a CUT pattern only, for the same reason the keychain stand's
    // ring hole does: a cut pattern reaching the joint leaves a thread of wood where the other
    // piece grips, while a score or an engrave removes nothing — the slot is cut out regardless,
    // so a line crossing it is simply gone afterwards, and holding the pattern off it only left
    // a bald band across the panel.
    const pieces = crossStandPieces(g, {
      front: block,
      back: patternKeepOut ? keepOff(backLayers, patternKeepOut) : backLayers,
    });

    // ------------------------------------------------------------------ what to say --
    // The facility's first: whether the thing stands up outranks how the name came out.
    const warnings = [...g.warnings, ...patternWarnings];
    if (name.length && fit < 0.75) warnings.push(`The name was shrunk to ${round1(nameSize * fit)} mm to fit the lip.`);
    if (name.length && nameSize * fit < MIN_CAP) {
      warnings.push('Below about 5 mm, thin and script fonts break up when engraved. Pick a bolder face or a taller stand.');
    }

    return {
      ...pieces,
      keyring: noRing(),
      ...(warnings.length ? { warnings } : {}),
    };
  },

  fileName: (v: Values) => stem(str(v, 'text') || 'phone-stand', 'stand'),

  exportNote: 'Slide the two pieces together at a right angle, the engraved one at the front.',
};
