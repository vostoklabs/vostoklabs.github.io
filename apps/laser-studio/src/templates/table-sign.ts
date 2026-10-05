// The table sign: two lines on a tent that stands on a table. Type a line and a big word, pick
// a face, download four pieces — a table number, a "RESERVED", a market-stall price.
//
// Everything about the tent — the lean, the two slot levels, the brace spacing, the feet, the
// grip — is `engine/tent.ts`, which is where the arithmetic that decides whether it STANDS
// belongs and where the QR table tent takes it from too. What is this template's own is the
// type: two slots in a steep ladder (a label over a headline) solved once inside the content box
// the facility hands back, centred on that box's optical 46 % line, and printed on BOTH faces so
// the sign reads from either side of the table.
//
// The first version's tent could not stand; it is rebuilt on the tent facility (2026-09-21). The
// Wi-Fi card and the table-number mode are gone:
// a Wi-Fi password belongs on the QR table tent, and a table number is text.
//
// The facility's own header carries the arithmetic.
import { bboxOf, type Shapes } from '@vostok/laser';
import { tentGeometry, tentPieces } from '../engine/tent';
import { fitClearance } from '../engine/slots';
import type { DesignLayer, KeyringSpec } from '../engine/types';
import { readSymbols } from '../symbols/model';
import { fitPlan, stackedText, stem, type StackLine } from './shared';
import { num, str, type TemplateDef, type Values } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The two slots, as a fraction of the panel's height, so the ladder survives a resize. A
 *  steeper ratio than a badge's 0.55–0.65: the big line is read across a room, not up close. */
const TOP_SIZE = 0.08;
const BIG_SIZE = 0.26;
/** Air above the big line, as a fraction of its own size. */
const LEAD = 0.3;
/** The optical centre: a stack sitting here looks middled rather than measures middled. */
const OPTICAL = 0.46;
/** Under this an engraved line stops reading, even in the bold faces this design recommends. */
const READ_FLOOR = 5;

/**
 * The lean, in degrees from the TABLE.
 *
 * `angle` used to mean the FULL opening between the two panels (10–50°, default 30). It means
 * the panel's angle from the table now, which is a different number for the same key — so a
 * project saved under the old template would open as a tent lying almost flat. Anything outside
 * the range the form offers is therefore an old file, and takes the default.
 */
const angleOf = (v: Values): number => {
  const a = num(v, 'angle');
  return a >= 55 && a <= 88 ? a : 72;
};

/** A sign stands; it does not hang. The fit still wants to know there is no hole to dodge. */
const noRing = (): KeyringSpec => ({ enabled: false, mode: 'outside', side: 'top', along: 0.5, dia: 4, ring: 2.5, position: -1 });

/** Sign faces: four sans for a number or a shouted word, three scripts for a name, one slab.
 *  Every one was built at the default sign and at a two-word big line before it was listed. */
const SIGN_FONTS = ['bebas-neue', 'montserrat', 'fredoka', 'luckiest-guy', 'titan-one', 'great-vibes', 'yellowtail', 'parisienne'];

export const tableSign: TemplateDef = {
  id: 'table-sign',
  name: 'Table sign',
  blurb: 'A tent that stands on the table and reads from both sides.',
  tags: ['sign', 'engrave + cut'],
  batch: { key: 'line2', noun: 'sign' },
  fields: [
    // ---------------------------------------------------------- RIGHT: what you type --
    { kind: 'text', key: 'line1', label: 'Line 1', panel: 'right', section: 'Text', value: 'TABLE', placeholder: 'A short line above', maxLength: 16 },
    {
      kind: 'text', key: 'line2', label: 'Line 2', panel: 'right', section: 'Text', value: 'SEVEN', placeholder: 'SEVEN, 12, OPEN…', maxLength: 12,
      help: 'The big line, read across the room.',
    },
    { kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'bebas-neue', recommended: SIGN_FONTS },

    // ------------------------------------------------------ LEFT: "Sign" (opens first) --
    { kind: 'number', key: 'width', label: 'Width', section: 'Sign', value: 90, min: 60, max: 180, step: 1, unit: 'mm' },
    {
      kind: 'number', key: 'height', label: 'Height', section: 'Sign', value: 100, min: 70, max: 200, step: 1, unit: 'mm',
      help: 'It leans, so the sign stands a little lower.',
    },

    // -------------------------------------------------------------- LEFT: "Assembly" --
    // A design with a joint says what it is cut from, in its own category (every design with
    // interlocking parts gets a separate Assembly section with kerf, fit and so on).
    {
      kind: 'number', key: 'thickness', label: 'Material thickness', section: 'Assembly', value: 3, min: 1.5, max: 9, step: 0.1, unit: 'mm',
      help: 'Measure your sheet, the joints are cut to match it.',
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
    // ----------------------------------------------------------- LEFT: "Sign", last row --
    {
      kind: 'number', key: 'angle', label: 'Angle', section: 'Sign', value: 72, min: 60, max: 82, step: 1, unit: '°',
      help: 'How steeply each panel leans off the table.',
    },
  ],

  async build(v) {
    const font = str(v, 'font');
    const panelW = clamp(num(v, 'width'), 40, 400);
    const panelH = clamp(num(v, 'height'), 40, 400);
    const t = clamp(num(v, 'thickness'), 0.5, 20);
    const kerf = clamp(num(v, 'kerf'), 0, 2);

    // ------------------------------------------------------------------ the tent --
    const g = tentGeometry({ panelW, panelH, t, kerf, angle: angleOf(v), clearance: fitClearance(str(v, 'fit')) });
    const panelShapes: Shapes = [[g.panel]];
    const margin = Math.max(4, 0.06 * panelW);

    // ------------------------------------------------------------------ the type --
    const base = { symbols: readSymbols(v), font };
    const rows: StackLine[] = [
      { text: str(v, 'line1'), size: TOP_SIZE * panelH },
      { text: str(v, 'line2'), size: BIG_SIZE * panelH, gap: LEAD },
    ];
    const centreY = g.content.maxY - OPTICAL * (g.content.maxY - g.content.minY);

    // No readable floor under the shrink, deliberately: on a sign the thing that must not happen
    // is a line crossing a slot or running into the margin, and a floor is exactly what makes the
    // fit stop short and let that happen. A line too small to read is a sentence the customer
    // gets to read, not a shape the laser gets to cut wrong.
    let layers: DesignLayer[] = await stackedText(rows, { ...base, x: 0, y: centreY }, 'engrave', 'design', 'Text');
    let k = 1;
    if (layers[0]) {
      const plan = fitPlan(panelShapes, bboxOf(layers.flatMap((l) => l.shapes)), noRing(), {
        inset: margin,
        home: g.content,
        avoid: g.panelCuts,
      });
      if (plan.k < 0.999 || plan.moved) {
        k = plan.k;
        layers = await stackedText(
          rows.map((l) => ({ ...l, size: l.size * plan.k })),
          { ...base, x: plan.dx, y: centreY + plan.dy },
          'engrave', 'design', 'Text',
        );
      }
    }

    // ------------------------------------------------------------------ the pieces --
    // Both faces carry the same two lines: a tent read from the wrong side of the table is a
    // sign that does not work, and there is nothing else a table number could say back there.
    const pieces = tentPieces(g, { front: layers, batched: v.__batch === true });

    // ------------------------------------------------------------------ what to say --
    // The facility's own sentences first — a tent that will not stand outranks the type on it.
    const warnings = [...g.warnings];
    const big = str(v, 'line2').trim();
    if (k < 0.75 && big) warnings.push(`“${big}” was shrunk to fit — a shorter word or a bigger panel keeps it bold.`);
    if (k * TOP_SIZE * panelH < READ_FLOOR) warnings.push('Some text engraves under 5 mm and may not read.');
    if (!big && !str(v, 'line1').trim()) warnings.push('Both lines are empty — the panels engrave nothing.');

    return {
      ...pieces,
      keyring: noRing(),
      ...(warnings.length ? { warnings } : {}),
    };
  },

  fileName: (v) => stem('table-sign', str(v, 'line2') || str(v, 'line1') || 'sign'),

  exportNote: 'Push each panel onto the braces’ four tabs, engraved face outward.',
};
