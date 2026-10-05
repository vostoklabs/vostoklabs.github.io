import { readSymbols } from '../symbols/model';
// Bracelets and card: a matching set of small engraved bars on cord, plus the kraft card that
// holds and displays the finished set.
//
// What makes it this design rather than "some bars with words on them" is that the CARD is not a
// second design the seller has to draw. The count, the bar length and what is typed on each
// bracelet are read TWICE — once at bar scale, once at card scale — so the rows, the cord
// openings and the per-bracelet caption cannot fall out of sync with the bars they hold.
//
// The card is a real display card, the way a shipped one is built: a caption over each
// bracelet, the cord passing through NOTCHES in the card's own edge, a hang hole at the top for a
// display hook, a perforated tear-off line between the sections so one bracelet-and-card comes
// away as a gift, and a caption block at the bottom.
//
// Two materials, one file: the bars come off the regular sheet, the card off kraft card, and
// the card is SCORED, never engraved — 300 gsm kraft is about 0.4 mm of loose cellulose with none
// of plywood's resin to buffer a sustained burn, so a filled engrave at plywood power chars a
// hole in it. There is no op control on the card for the same reason: score is not one option
// among several, it is the only physically sound one. The card is 0.6 mm in the 3D view too
// (`assembled.ts` `CARD_THICKNESS`), not another sheet of ply.
//
// The FORM follows the product, one section per part: one for the card (its notch/slot sizes,
// its text and other settings), then one for the bracelets. So: **Card** holds the card's size
// and corners, how the cord leaves it and how big that opening is, the tear-off and the hang
// hole; **Bracelets** holds the count, the bar and its cord holes; **Font**; **Lettering** every
// size anything is printed at, the bars' first and then the card's. Nothing about the card is in
// a category called "Size" any more, and nothing that shapes a piece is on the right — the right
// panel is the typing.
import { bboxOf, blankById, buildBlank, circleRing, placeShapes, roundedRectRing, type Pt, type Shapes } from '@vostok/laser';
import { applyCase, fitShapes, symbolLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import type { BuildInput, DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { fitText, letteringFields, opField, opOf, stackedText, stem, TOO_SMALL_WARNING } from './shared';
import { bool, num, str, type Field, type TemplateDef, type Values } from './types';

/** How many bracelets the stepper reaches. Six individual text fields rather than one `lines`
 *  textarea, because the inline symbol picker is wired onto `kind: 'text'` only — a customer has
 *  to be able to drop a heart into ONE bracelet's line. */
const BAR_COUNT = 6;

/** The card's own margins and bands, all computed — "don't ship a choice of one". */
const MARGIN = 8;
/** The band under the last row that carries the symbol and the card's caption. */
const FOOTER_H = 28;
/** Air between two rows: wider when a perforation has to run between them, so the tear-off line
 *  keeps `PERF_CLEAR` off the content on either side of it. */
const ROW_GAP = 5;
const PERF_ROW_GAP = 8;

/** The hang hole: Ø5 for a display hook, its centre one diameter in from the top edge — the
 *  hole-to-edge floor, and what a shipped kraft card does. */
const HANG_DIA = 5;
const HANG_EDGE = 5;

/** The cord NOTCH, the default: a stadium bitten out of the card's side edge, as deep into the
 *  card as it is tall along it. The cord leaves the bar, drops into the notch, and is tied off
 *  behind the card — which is why the bar sits flat.
 *
 *  ONE number sets both (`Notch size`, 2–6 mm): a notch whose depth and height disagree reads as
 *  a slot that missed. The 6 mm ceiling is the card's own 8 mm margin — the bite can never reach
 *  the captions, so there is no arrangement of the sliders that needs a warning. */
const NOTCH = 3;
const NOTCH_MAX = 6;

/** The alternative: a pair of slits in the card's face, the cord threaded front-to-back through
 *  one and back through the other. A full-radius slit is gentler on kraft fibre than a sharp
 *  corner. `SLOT_SPLAY` is how much WIDER than the bar's own holes the pair sits, centre to
 *  centre, so the cord runs slightly outward instead of a dead-straight parallel drop.
 *
 *  `Slot size` sets the slit's LENGTH (5–14 mm) — how much cord travel the customer gets when
 *  the bar is tied on. The width stays the cord's, not a knob: a slit wider than the cord is a
 *  hole the bar hangs loose in. */
const SLOT_W = 1.6;
const SLOT_H = 8;
const SLOT_SPLAY = 10;

/** The tear-off line. 3 mm cut : 1 mm bridge is the 3:1 general-purpose perforation ratio
 *  — it tears by hand and survives the post. The dashes are
 *  0.4 mm slits, so the row reads as a dashed line in the file rather than a slot. Nothing is
 *  cut within `PERF_CLEAR` of the card's edge (the corners would tear in a mailer) or of a cord
 *  opening. */
const PERF_DASH = 3;
const PERF_GAP = 1;
const PERF_W = 0.4;
const PERF_CLEAR = 3;

/** The strip at the top of a row the caption is scored into, as a MULTIPLE of the cap height the
 *  customer asked for (`Caption size`, 4–9 mm): the strip follows the lettering rather than
 *  boxing it, so turning the caption up makes room for itself. A two-line caption gets a taller
 *  strip; both are capped to a share of the row so six bracelets do not leave the bar nowhere to
 *  sit. At the 6 mm default the strips are the 9 mm and 16 mm they have always been. */
const CAPTION_BAND = 1.5;
const CAPTION_BAND_2 = 8 / 3;
const CAPTION_CAP = 6;
/** The card's bottom line, one size down from the captions above it (5 mm at the default). */
const SUBTITLE_RATIO = 5 / 6;
const CAP_FLOOR = 3;
/** Air between the footer symbol and the caption under it. */
const FOOTER_GAP = 3;
/** A row shorter than this has no room for a caption over a bracelet. */
const ROW_MIN = 16;

/** Engraved capitals below this do not read once the bar is cut. */
const READ_FLOOR = 3;
/** How far the bar's lettering keeps from its own edge. The shared default is 3–4 mm, tuned for
 *  parts several times this size; on an 8 mm bar it would leave under 2 mm to print in. */
const BAR_INSET = 1.2;

/** What the card is, in the words an operator needs before they load the sheet. It is the part's
 *  label, the name under it on the preview, and the description on its own export groups. */
const CARD_LABEL = 'Card — kraft 300 gsm, score only';

/** Faces that read as small caps at 3.6 mm and hold up in the 30 × 8 mm bar test (§6). */
const BAR_FACES = ['montserrat', 'work-sans', 'archivo', 'outfit', 'urbanist', 'raleway'];

/** The bundled Heart and Star (`favorite` / `star`, Material Symbols). */
const HEART = '\u{e87d}';
const STAR = '\u{e838}';

/** No keyring anywhere in this design: a bracelet hangs on its cord, and the card hangs on its
 *  own hole. `place-cards.ts`'s stand-in, for the same reason — `keyringFrom()` with no keyring
 *  fields reports an enabled 0 mm hole, and a hole dragged onto one bar out of six is a bug.
 *  `outside` because "Hole" is gone from the shared control; nothing reads it while
 *  `enabled` is false, but a spec that names a mode the control no longer has is a trap. */
const DISABLED_KEYRING: KeyringSpec = { enabled: false, mode: 'outside', side: 'left', along: 0.5, dia: 4, ring: 2, position: -1 };

/** What the customer typed for one bracelet, split on the `"|"`: the bar keeps only the words
 *  before it, the card prints the whole line as stacked rows. A leading or trailing empty half is
 *  legal — the missing side is simply skipped on the piece it would have gone on. */
const barTextOf = (line: string) => line.split('|')[0]!.trim();
const cardRowsOf = (line: string) => line.split('|').map((s) => s.trim()).filter(Boolean);

const countOf = (v: Values) => Math.min(BAR_COUNT, Math.max(1, Math.round(num(v, 'count'))));
const lineOf = (v: Values, i: number) => str(v, `text${i + 1}`);

/** The card's grid. Row 1's bottom edge lands exactly on the footer band's top edge, so the grid
 *  and the footer meet with no gap and no overlap; the top margin grows to hold the hang hole
 *  when there is one. */
interface Grid {
  topMargin: number;
  rowGap: number;
  rowH: number;
  rowY(i: number): number;
  /** Between row i and row i + 1 — where a tear-off line runs. */
  perfY(i: number): number;
  slotSpan: number;
  /** The footer band's own centre. */
  footerY: number;
  usableW: number;
}

/** The top margin a card needs: the plain one, or enough to hold the hang hole clear of row 1. */
const topMarginOf = (hang: boolean) => (hang ? Math.max(MARGIN, HANG_EDGE + HANG_DIA / 2 + PERF_CLEAR) : MARGIN);

function gridOf(n: number, cardW: number, cardH: number, barW: number, opts: { hang: boolean; tear: boolean }): Grid {
  const topMargin = topMarginOf(opts.hang);
  const rowGap = opts.tear && n > 1 ? PERF_ROW_GAP : ROW_GAP;
  const rowsBand = cardH - topMargin - MARGIN - FOOTER_H;
  const rowH = (rowsBand - (n - 1) * rowGap) / n;
  const rowY = (i: number) => cardH / 2 - topMargin - i * (rowH + rowGap) - rowH / 2;
  return {
    topMargin, rowGap, rowH, rowY,
    perfY: (i) => rowY(i) - rowH / 2 - rowGap / 2,
    slotSpan: barW + SLOT_SPLAY,
    footerY: cardH / 2 - topMargin - rowsBand - FOOTER_H / 2,
    usableW: cardW - 2 * MARGIN,
  };
}

/** The strip a row gives its caption: taller for a two-line one, never more than a share of the
 *  row, because what is left under it is where the bracelet sits. */
const bandOf = (rows: number, rowH: number, cap: number) =>
  Math.min(rowH * 0.45, cap * (rows > 1 ? CAPTION_BAND_2 : CAPTION_BAND));

/** The card height below which `rowH` drops under `ROW_MIN` — a caption over a bracelet stops
 *  fitting. `rowH(N) ≥ ROW_MIN` rearranged. */
const minCardH = (n: number, g: Pick<Grid, 'topMargin' | 'rowGap'>) =>
  g.topMargin + MARGIN + FOOTER_H + ROW_MIN * n + (n - 1) * g.rowGap;

/** One bar: the library's `bar` blank with its corner forced to half its height — a true stadium,
 *  always, never a slider — and the two cord holes appended as extra rings in its own island, the
 *  way `place-cards` appends its ribbon hole. A hole is just another ring in the island. */
function barPiece(barW: number, barH: number, dia: number, inset: number): { shapes: Shapes; holes: Shapes } {
  const def = blankById('bar')!;
  const body = buildBlank(def, {
    ...def.defaults,
    width: barW, height: barH, corner: barH / 2,
    holeSide: 'none', holeMargin: 0, holeDia: 0, pair: false,
  });
  const x = Math.max(dia / 2 + 0.2, barW / 2 - inset);
  const holes: Shapes = dia > 0 ? [[circleRing(-x, 0, dia / 2, 32)], [circleRing(x, 0, dia / 2, 32)]] : [];
  return { shapes: [[...(body[0] ?? []), ...holes.map((h) => h[0]!)], ...body.slice(1)], holes };
}

/** One tear-off line's dashes, centred on y: 3 mm cut, 1 mm bridge, stopping `PERF_CLEAR` short
 *  of each side edge and skipping any dash that would come within `PERF_CLEAR` of a cord opening
 *  or the hang hole. The end margins are deliberate — a perforation run into the corner tears
 *  itself open in the post, and 3 mm of kraft gives way the moment the line is started. */
function perfDashes(cardW: number, y: number, avoid: { x: number; y: number; w: number; h: number }[]): Pt[][] {
  const span = cardW - 2 * PERF_CLEAR;
  const pitch = PERF_DASH + PERF_GAP;
  if (span < PERF_DASH) return [];
  const count = Math.floor((span - PERF_DASH) / pitch) + 1;
  const total = (count - 1) * pitch + PERF_DASH;
  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const x = -total / 2 + PERF_DASH / 2 + i * pitch;
    const near = avoid.some((a) =>
      Math.abs(x - a.x) < a.w / 2 + PERF_DASH / 2 + PERF_CLEAR && Math.abs(y - a.y) < a.h / 2 + PERF_W / 2 + PERF_CLEAR);
    if (near) continue;
    out.push(...placeShapes([[roundedRectRing(PERF_DASH, PERF_W, PERF_W / 2, 4)]], x, y, 0).map((isl) => isl[0]!));
  }
  return out;
}

/** The card outline with everything that goes THROUGH it: the cord slits (when the cord passes
 *  through the face rather than the edge), the hang hole, and the tear-off dashes. All rings of
 *  the card's own island, never `cut` layers: they are structural, not content with warnings of
 *  their own. The edge notches are the exception — an opening in the outline itself — and they
 *  are a cut layer, which the engine subtracts from the plate. */
function cardPlate(
  cardW: number, cardH: number, corner: number,
  openings: Pt[][], hang: boolean, perf: Pt[][],
): Shapes {
  const ring = roundedRectRing(cardW, cardH, Math.min(corner, Math.min(cardW, cardH) / 2));
  const hole: Pt[][] = hang ? [circleRing(0, cardH / 2 - HANG_EDGE, HANG_DIA / 2, 40)] : [];
  return [[ring, ...openings, ...hole, ...perf]];
}

/** Lettering scored on the card, scaled to the box it has to live in and no smaller than
 *  `CAP_FLOOR`. Built at the asked-for cap height, measured, then rebuilt at the scale that fits:
 *  rebuilt rather than scaled, so the letter spacing (a fraction of the size) scales with it. */
async function scoredText(
  rows: string[],
  base: { font: string; letterSpacing: number; symbols: ReturnType<typeof readSymbols> },
  cap: number,
  box: { w: number; h: number; x: number; y: number },
  id: string,
  label: string,
): Promise<DesignLayer[]> {
  if (!rows.length) return [];
  const build = (c: number, x: number, y: number) =>
    sizeForCapHeight(base.font, c).then((size) => stackedText(rows.map((text) => ({ text, size })), { ...base, x, y }, 'score', id, label));
  const first = await build(cap, 0, 0);
  if (!first.length) return [];
  const b = bboxOf(first.flatMap((l) => l.shapes));
  const w = Math.max(1e-6, b.maxX - b.minX);
  const h = Math.max(1e-6, b.maxY - b.minY);
  const k = Math.max(Math.min(1, CAP_FLOOR / cap), Math.min(1, box.w / w, box.h / h));
  if (k > 0.999) return placeLayers(first, box.x, box.y);
  return placeLayers(await build(cap * k, 0, 0), box.x, box.y);
}

/** Move built layers so the block's own centre lands on (x, y). `stackedText` centres the block
 *  on the origin and then translates, but a two-row block's ink box is not symmetric about that
 *  origin once one row has a descender, so the move is measured rather than assumed. */
function placeLayers(layers: DesignLayer[], x: number, y: number): DesignLayer[] {
  const b = bboxOf(layers.flatMap((l) => l.shapes));
  const dx = x - (b.minX + b.maxX) / 2;
  const dy = y - (b.minY + b.maxY) / 2;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return layers;
  return layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));
}

/** Does the finished lettering reach a cord hole? `fitText`'s dodge is cheap-only — it never
 *  shrinks past half the shape's own fit — and there is no real `KeyringSpec` here for the
 *  engine's ring-on-the-lettering net to read, so the check is made here. */
function crossesHole(text: Shapes, holes: Shapes, dia: number): boolean {
  if (!text.length || !holes.length) return false;
  const b = bboxOf(text);
  const r = dia / 2;
  return holes.some((island) => {
    const hb = bboxOf([island]);
    const cx = (hb.minX + hb.maxX) / 2;
    const cy = (hb.minY + hb.maxY) / 2;
    const nx = Math.min(Math.max(cx, b.minX), b.maxX);
    const ny = Math.min(Math.max(cy, b.minY), b.maxY);
    return Math.hypot(cx - nx, cy - ny) < r;
  });
}

/** What one bracelet carries: a word, or a symbol from the picker. Two templates, one build —
 *  the bars are the only thing that differs, and the card, the notches, the tear-off and the
 *  caption block are shared to the millimetre. */
export interface BraceletVariant {
  id: string;
  name: string;
  blurb: string;
  /** The bar carries a SYMBOL (or an imported SVG — the picker does both) instead of a word. */
  symbolBars: boolean;
}

export function makeBraceletSet(variant: BraceletVariant): TemplateDef {
  const { symbolBars } = variant;
  const defaultBarSymbol = (i: number) => (i === 0 ? HEART : i === 1 ? STAR : '');
  const symbolOf = (v: Values, i: number) => str(v, `symbol${i + 1}`);

  return {
    id: variant.id,
    name: variant.name,
    blurb: variant.blurb,
    // 'keychain' is the closest existing category rather than a one-off 'jewelry' shelf for a
    // single design — the vocabulary stays small.
    tags: ['gift', 'bracelet', 'engrave + score + cut'],
    fields: [
      // -------------------------------------------------------------- RIGHT: "Bracelets" --
      //
      // The right panel is what the customer TYPES, in the order it appears on the card: the
      // bracelets' own words first, then the card's symbol and its bottom line. Nothing that
      // shapes a piece is here any more — the bracelet COUNT went left with the rest of the bar
      // (one section for the card, then one for the bracelets), because
      // how many bars there are is a setting, not something you type.
      ...Array.from({ length: BAR_COUNT }, (_, i): Field[] => [
        ...(symbolBars
          ? [{
            kind: 'symbol' as const, key: `symbol${i + 1}`, label: `Bracelet ${i + 1}`,
            panel: 'right' as const, section: 'Bracelets', value: defaultBarSymbol(i),
            visibleWhen: (v: Values) => countOf(v) >= i + 1,
            ...(i === 0 ? { help: 'Pick an icon or import your own SVG.' } : {}),
          }]
          : []),
        {
          kind: 'text' as const, key: `text${i + 1}`, label: symbolBars ? `Card line ${i + 1}` : `Bracelet ${i + 1}`,
          panel: 'right' as const, section: 'Bracelets',
          value: i === 0 ? 'Sisters' : i === 1 ? 'Besties' : '', maxLength: 22,
          ...(i < 2 ? {} : { placeholder: 'Optional' }),
          visibleWhen: (v: Values) => countOf(v) >= i + 1,
          ...(i === 0 && !symbolBars
            ? { help: 'Add a "|" for a second card line, the bar skips it.' }
            : {}),
        },
      ]).flat(),
      { kind: 'symbol', key: 'cardSymbol', label: 'Card symbol', panel: 'right', section: 'Card', value: HEART },
      {
        kind: 'text', key: 'subtitle', label: 'Card caption', panel: 'right', section: 'Card',
        value: 'Better together', maxLength: 28, placeholder: 'A line for the bottom (optional)',
        help: 'Scored once, under the symbol at the card’s bottom.',
      },

      // ------------------------------------------------------ LEFT: "Card" (opens first) --
      //
      // One section per PART of the product: everything that shapes the CARD is
      // here — how big it is, how round, how the cord leaves it and how big that opening is,
      // whether it tears in two, whether it hangs. Its words are on the right with the rest of the
      // typing, and the size they are printed at is under Lettering with every other type size.
      // Nothing about the card hides in a category called "Size".
      { kind: 'number', key: 'cardW', label: 'Card width', section: 'Card', value: 90, min: 70, max: 120, step: 1, unit: 'mm' },
      {
        kind: 'number', key: 'cardH', label: 'Card height', section: 'Card', value: 130, min: 90, max: 200, step: 1, unit: 'mm',
        help: 'More bracelets need a taller card to stay comfortable.',
      },
      {
        kind: 'number', key: 'cardCorner', label: 'Rounded corners', section: 'Card',
        value: 5.4, min: 2, max: 14, step: 0.1, unit: 'mm',
      },
      {
        kind: 'select', key: 'cord', label: 'Cord openings', section: 'Card', value: 'notch',
        options: [{ value: 'notch', label: 'Notches' }, { value: 'slot', label: 'Slots' }],
        help: 'Notches let the cord wrap the card’s edge.',
      },
      // The size of whichever opening is chosen, in the same place the choice is made, and only
      // ever one of the two on screen: a slider for a slit nobody is cutting is a control that
      // does nothing, which is worse than a control that is missing.
      {
        kind: 'number', key: 'notchSize', label: 'Notch size', section: 'Card',
        value: NOTCH, min: 2, max: NOTCH_MAX, step: 0.5, unit: 'mm',
        visibleWhen: (v) => str(v, 'cord') !== 'slot',
        help: 'How deep the notch bites into the card’s edge.',
      },
      {
        kind: 'number', key: 'slotSize', label: 'Slot size', section: 'Card',
        value: SLOT_H, min: 5, max: 14, step: 0.5, unit: 'mm',
        visibleWhen: (v) => str(v, 'cord') === 'slot',
        help: 'The length of each slit through the card.',
      },
      {
        kind: 'toggle', key: 'tearOff', label: 'Tear-off line', section: 'Card', value: true,
        help: 'Perforated, so one bracelet tears off as a gift.',
      },
      {
        kind: 'toggle', key: 'hangHole', label: 'Hang hole', section: 'Card', value: true,
        help: 'A 5 mm hole at the top for a display hook.',
      },

      // -------------------------------------------------------------- LEFT: "Bracelets" --
      //
      // The other part, and everything that shapes it: how many, how big the bar is, and where its
      // cord holes go. The count leads, because it is the knob that makes this a SET.
      {
        kind: 'stepper', key: 'count', label: 'Bracelets', section: 'Bracelets',
        value: 2, min: 1, max: BAR_COUNT,
        help: 'Each bracelet gets its own bar and its own card row.',
      },
      { kind: 'number', key: 'width', label: 'Bar length', section: 'Bracelets', value: 30, min: 22, max: 42, step: 1, unit: 'mm' },
      { kind: 'number', key: 'height', label: 'Bar height', section: 'Bracelets', value: 8, min: 6, max: 11, step: 0.5, unit: 'mm' },
      {
        kind: 'number', key: 'cordHole', label: 'Cord hole', section: 'Bracelets',
        value: 1.6, min: 1.2, max: 2.2, step: 0.1, unit: 'mm',
        help: '1.6 mm passes 1 mm cord with room to spare.',
      },
      {
        kind: 'number', key: 'cordInset', label: 'Hole inset', section: 'Bracelets',
        value: 3, min: 2, max: 5, step: 0.5, unit: 'mm',
        help: 'Too small and the rim around the hole gets fragile.',
      },

      // ------------------------------------------------------------------- LEFT: "Font" --
      { kind: 'font', key: 'font', label: 'Font', section: 'Font', value: 'montserrat', recommended: BAR_FACES },

      // -------------------------------------------------------------- LEFT: "Lettering" --
      // The bars' type first, then the card's: every size anything is printed at, in one place.
      {
        kind: 'number', key: 'letterHeight', label: symbolBars ? 'Symbol height' : 'Text height', section: 'Lettering',
        value: symbolBars ? 5.5 : 3.6, min: 2.5, max: symbolBars ? 9 : 5, step: 0.1, unit: 'mm',
        help: symbolBars ? 'The bar’s own height is the ceiling.' : 'Below 3 mm, engraved text stops reading clearly.',
      },
      opField('Lettering', 'engrave', symbolBars ? 'Symbol' : 'Letters'),
      ...letteringFields('Lettering', { textCase: 'upper' }),
      {
        kind: 'number', key: 'captionSize', label: 'Caption size', section: 'Lettering',
        value: CAPTION_CAP, min: 4, max: 9, step: 0.5, unit: 'mm',
        help: 'Sets every caption on the card, and its bottom line.',
      },
      {
        kind: 'number', key: 'symbolSize', label: 'Card symbol size', section: 'Lettering', value: 16, min: 8, max: 28, step: 1, unit: 'mm',
        help: 'Stays inside the footer band, leaving room for the caption.',
      },
    ],

    async build(v): Promise<BuildInput> {
      const n = countOf(v);
      const barW = Math.max(10, num(v, 'width'));
      const barH = Math.max(3, num(v, 'height'));
      const cordHole = Math.max(0, num(v, 'cordHole'));
      const cordInset = Math.max(cordHole / 2 + 0.2, num(v, 'cordInset'));
      const cardW = Math.max(40, num(v, 'cardW'));
      const cardH = Math.max(60, num(v, 'cardH'));
      const font = str(v, 'font') || 'montserrat';
      const textCase = str(v, 'textCase');
      const letterSpacing = num(v, 'letterSpacing') / 100;
      const symbols = readSymbols(v);
      const op = opOf(v);
      const base = { font, letterSpacing, symbols };
      const notched = str(v, 'cord') !== 'slot';
      const hang = bool(v, 'hangHole');
      const tear = bool(v, 'tearOff') && n > 1;
      // The cord opening, at the size the Card section asked for. The notch is held under the
      // card's own margin so the bite can never reach a caption; the slit is held inside the row
      // it belongs to, so a long one on a crowded card cannot wander into the next bracelet's.
      const notch = Math.min(NOTCH_MAX, Math.max(1, num(v, 'notchSize')));
      const cap = Math.max(CAP_FLOOR, num(v, 'captionSize'));

      const g = gridOf(n, cardW, cardH, barW, { hang, tear });
      const slotH = Math.max(4, Math.min(num(v, 'slotSize'), g.rowH - bandOf(1, g.rowH, cap) - 2));
      const lines = Array.from({ length: n }, (_, i) => applyCase(lineOf(v, i), textCase));

      // Only warnings[0] reaches the status line, so they are pushed in priority order:
      // a bar nobody can read first, then a bar whose text reaches a cord hole, then the card's own
      // squeeze, then the cord hole's rim.
      const tooSmall: string[] = [];
      const overHole: string[] = [];
      const layout: string[] = [];

      // ------------------------------------------------------------------------ the bars --

      const { shapes: barBody, holes } = barPiece(barW, barH, cordHole, cordInset);
      const barSize = await sizeForCapHeight(font, Math.max(1, num(v, 'letterHeight')));
      // A symbol is fitted, not typed: the bar's own height is one ceiling and the clear middle
      // between the two cord holes is the other, so it never crowds a knot. The ASK and the ROOM
      // are kept apart on purpose — a customer who drags the slider to its own minimum has not
      // made a mistake (`readableScale` in shared.ts makes the same distinction for text), but a
      // bar too small to hold the floor has.
      const symbolAsk = Math.max(1, num(v, 'letterHeight'));
      const symbolRoom = Math.min(barH - 2 * BAR_INSET, barW - 2 * (cordInset + cordHole / 2 + 1));
      const symbolSizeMm = Math.max(0.5, Math.min(symbolAsk, symbolRoom));
      const bars: DesignLayer[][] = [];
      for (let i = 0; i < n; i++) {
        if (symbolBars) {
          const char = symbolOf(v, i);
          if (!char) { bars.push([]); continue; }
          if (symbolRoom < Math.min(symbolAsk, READ_FLOOR)) {
            tooSmall.push(`Bracelet ${i + 1}'s symbol is too small to read once it is cut — use a taller or longer bar.`);
          }
          const drawn = await symbolLayer(char, symbolSizeMm, op, { symbols }, 'text');
          const shapes = drawn[0]?.shapes.length ? fitShapes(drawn[0].shapes, symbolSizeMm) : [];
          if (!shapes.length) { bars.push([]); continue; }
          if (crossesHole(shapes, holes, cordHole)) {
            overHole.push(`Bracelet ${i + 1}'s symbol crosses a cord hole — shrink it or lengthen the bar.`);
          }
          bars.push([{ id: 'text', label: `Bracelet ${i + 1}`, kind: 'symbol', shapes, op }]);
          continue;
        }
        const text = barTextOf(lines[i]!);
        if (!text) { bars.push([]); continue; }
        // One fit per bar, never one size for the set: two bracelets in a pair can carry very
        // different lengths, and matching them would shrink "Sisters" to fit "Anniversary".
        const mine: string[] = [];
        const layers = await fitText(
          { text, font, size: barSize, letterSpacing, symbols },
          op, barBody, DISABLED_KEYRING, 'text', `Bracelet ${i + 1}`,
          { inset: BAR_INSET, avoid: holes, minCap: READ_FLOOR, warnings: mine },
        );
        if (mine.includes(TOO_SMALL_WARNING)) {
          tooSmall.push(`Bracelet ${i + 1}'s text is too small to read once it is engraved — shorten it, drop the symbol, or lengthen the bar.`);
        } else if (crossesHole(layers.flatMap((l) => l.shapes), holes, cordHole)) {
          overHole.push(`Bracelet ${i + 1}'s text crosses a cord hole — shorten it or lengthen the bar.`);
        }
        bars.push(layers);
      }

      // ------------------------------------------------------------------------ the card --
      //
      // Each row is a caption OVER a bracelet: the caption is
      // scored into a strip at the top of the row and the cord line sits in what is left.

      const cardLayers: DesignLayer[] = [];
      const barYs: number[] = [];
      for (let i = 0; i < n; i++) {
        const rows = cardRowsOf(lines[i]!);
        const band = bandOf(rows.length, g.rowH, cap);
        barYs.push(g.rowY(i) - band / 2);
        cardLayers.push(...await scoredText(
          rows, base, cap,
          { w: g.usableW, h: band, x: 0, y: g.rowY(i) + g.rowH / 2 - band / 2 },
          `caption${i + 1}`, `Bracelet ${i + 1} caption`,
        ));
      }

      // The cord: a notch bitten out of each side edge (the default — a cut layer, because an
      // opening in the outline is a subtraction), or a pair of slits through the face.
      const openings: Pt[][] = [];
      const cordBoxes: { x: number; y: number; w: number; h: number }[] = [];
      const notches: Shapes = [];
      for (const y of barYs) {
        if (notched) {
          for (const side of [-1, 1]) {
            notches.push(...placeShapes([[roundedRectRing(2 * notch, notch, notch / 2, 6)]], (side * cardW) / 2, y, 0));
            cordBoxes.push({ x: (side * cardW) / 2, y, w: 2 * notch, h: notch });
          }
        } else {
          for (const side of [-1, 1]) {
            openings.push(...placeShapes([[roundedRectRing(SLOT_W, slotH, SLOT_W / 2)]], (side * g.slotSpan) / 2, y, 0).map((isl) => isl[0]!));
            cordBoxes.push({ x: (side * g.slotSpan) / 2, y, w: SLOT_W, h: slotH });
          }
        }
      }
      if (notches.length) {
        cardLayers.push({ id: 'notches', label: 'Cord notches', shapes: notches, op: 'cut', stencil: false });
      }
      if (hang) cordBoxes.push({ x: 0, y: cardH / 2 - HANG_EDGE, w: HANG_DIA, h: HANG_DIA });

      const perf: Pt[][] = [];
      if (tear) for (let i = 0; i < n - 1; i++) perf.push(...perfDashes(cardW, g.perfY(i), cordBoxes));

      // The footer: the symbol, and the caption under it when there is one. The symbol is held
      // inside the band rather than allowed to run into the rows above or the margin below — the
      // slider reaches the band's full height, and a 28 mm heart over a caption would not fit.
      const subtitle = applyCase(str(v, 'subtitle'), textCase).trim();
      const sub = subtitle
        ? await scoredText([subtitle], base, cap * SUBTITLE_RATIO, { w: g.usableW, h: FOOTER_H / 2, x: 0, y: 0 }, 'subtitle', 'Card caption')
        : [];
      const subH = sub.length ? bboxOf(sub.flatMap((l) => l.shapes)).maxY - bboxOf(sub.flatMap((l) => l.shapes)).minY : 0;
      const symMax = Math.max(4, FOOTER_H - 4 - (sub.length ? FOOTER_GAP + subH : 0));
      const symSize = Math.min(Math.max(1, num(v, 'symbolSize')), symMax);
      const symbolChar = str(v, 'cardSymbol');
      const rawSymbol = symbolChar ? await symbolLayer(symbolChar, symSize, 'score', { symbols }, 'symbol') : [];
      const symShapes = rawSymbol[0]?.shapes.length ? fitShapes(rawSymbol[0].shapes, symSize) : [];
      const symH = symShapes.length ? bboxOf(symShapes).maxY - bboxOf(symShapes).minY : 0;
      const stackH = symH + (sub.length ? FOOTER_GAP + subH : 0);
      const top = g.footerY + stackH / 2;
      if (symShapes.length) {
        cardLayers.push({ id: 'symbol', label: 'Card symbol', shapes: placeShapes(symShapes, 0, top - symH / 2, 0), op: 'score' });
      }
      if (sub.length) cardLayers.push(...placeLayers(sub, 0, top - symH - FOOTER_GAP - subH / 2));

      // ------------------------------------------------------------ what the build has to say --

      if (cardH < minCardH(n, g)) {
        layout.push(`${n} bracelet${n === 1 ? '' : 's'} is tight on a ${Math.round(cardH)} mm card — try ${Math.ceil(minCardH(n, g))} mm or taller, or use fewer bracelets.`);
      }
      // Nothing warns about the slits crowding the card's edge: the longest bar the slider reaches
      // splays to 52 mm and the narrowest card leaves 54 mm between its margins, so the pair always
      // lands at least 8 mm inside the edge. A warning that can never fire is a lie about a rule.
      if (cordInset - cordHole / 2 < 1) layout.push('The cord hole sits too close to the end — increase the inset or shrink the hole.');
      const warnings = [...tooSmall, ...overHole, ...layout];

      // ----------------------------------------------------------- the pieces, and the glue-up --

      // Bar 1 is the primary and is built on its own origin; every other piece says where it sits
      // in that frame once the set is on the card. The card goes FIRST in `parts` so the 3D view
      // lays it under the bars rather than over them — and it is 0.6 mm of kraft there, not a
      // second sheet of ply (`assembled.ts` `CARD_THICKNESS`).
      const row0 = barYs[0]!;
      const parts: PartInput[] = [
        {
          id: 'card', label: CARD_LABEL,
          blank: { kind: 'shape', shapes: cardPlate(cardW, cardH, num(v, 'cardCorner'), openings, hang, perf) },
          layers: cardLayers,
          keyring: 'none', material: 'card',
          assembledAt: { x: 0, y: -row0 },
        },
        ...bars.slice(1).map((layers, i): PartInput => ({
          id: `bar${i + 2}`, label: `Bracelet ${i + 2}`,
          blank: { kind: 'shape', shapes: barBody },
          layers,
          keyring: 'none', material: 'light',
          assembledAt: { x: 0, y: barYs[i + 1]! - row0 },
        })),
      ];

      return {
        label: 'Bracelet 1',
        blank: { kind: 'shape', shapes: barBody },
        layers: bars[0] ?? [],
        keyring: DISABLED_KEYRING,
        material: 'light',
        parts,
        layout: { flow: 'row', gap: 8 },
        status: `${n} bracelet${n === 1 ? '' : 's'}`,
        ...(warnings.length ? { warnings } : {}),
      };
    },

    exportNote: 'Cut the bracelets from 3 mm wood and the card from kraft card, then thread the cords.',
    fileName: (v) => stem(variant.id, barTextOf(str(v, 'text1')) || 'set', String(countOf(v))),
  };
}

export const braceletSet = makeBraceletSet({
  id: 'bracelet-set',
  name: 'Bracelets and card',
  blurb: 'A matching set of cord bracelets, plus the kraft card that holds and displays them.',
  symbolBars: false,
});
