import { readSymbols } from '../symbols/model';
// A place card: ONE piece of kraft card, perforated across the middle, folded back on itself so
// it stands on the table by itself. The guest's name on the front panel, a table number or a
// role under it, and a scored rule round the two of them.
//
// It is CARD, not ply: place cards are made from craft paper since they are folded, with a cut
// dashed line as the folding guide — so
// the piece declares `material: 'card'`, which is what makes the 3D view stand 0.6 mm of kraft
// up instead of 3 mm of plywood, and puts the outline in its own export group.
//
// It used to be four products behind a Style picker — a flat card, a drink marker, a tent and a
// name cut out of the sheet — with a five-way Shape picker under that. Only the tent made sense,
// so it stays, without the style and shape pickers. One template is one
// object, so the other three are gone and what is left is the tent, at the size the market
// actually prints: 90 × 50 mm folded, cut from one 90 × 100 mm piece.
//
// The run is the shared Batch switch (`TemplateDef.batch`): paste the guest list on the right
// and the editor builds this same card once per name and nests the lot on one sheet. So the
// template builds exactly one card and nothing here knows about sheets or packing.
//
// What still makes a SET look made rather than generated is the type: it is sized in capital
// heights (not ems, which move with the face) and placed by the BASELINE rather than by the ink
// box — "Harper" has no descender and "Priya" has one, and centred by ink box those two cards
// sit ~1.8 mm apart with six standing in a row.
import { bboxOf, placeShapes, roundedRectRing, type Box, type Pt, type Shapes } from '@vostok/laser';
import { glyphLayers } from '../engine/text';
import { sizeForCapHeight, textMetrics } from '../engine/metrics';
import { fitBoxInside } from '../engine/editorGeometry';
import type { BuildInput, DesignLayer, OpChoice } from '../engine/types';
import type { SymbolMap } from '../symbols/model';
import { stem } from './shared';
import { bool, lines, num, str, type TemplateDef, type Values } from './types';

/** The second line's face out of the box: a sans that still reads at 6 mm of capitals. The
 *  customer picks their own in "Second line font"; this is only the default. */
const SECOND_FONT = 'montserrat';
/** Faces for the line under the name — "Table 4", "Bridesmaid". Small, usually set in capitals,
 *  and read at arm's length across a table, so: sans that stay open at 6 mm, the two serifs the
 *  name list already offers (a card set in one family), and a true small-caps face. */
const SECOND_LINE_FACES = ['montserrat', 'cinzel', 'eb-garamond', 'alegreya-sans-sc', 'work-sans', 'inter'];
/** How far the scored rule sits inside the front panel, mm. */
const BORDER_INSET = 5;
/** Air between the lettering and the rule, mm — the rule is the edge the type respects. */
const TEXT_CLEAR = 3;
/** The fold stops this far short of each side edge, so the dashes never split the card and the
 *  corners cannot tear themselves open in a box of a hundred cards. */
const FOLD_INSET = 3;
/** The dashed fold. 3 mm cut : 1 mm bridge is the 3:1 general-purpose perforation ratio
 *  — the same rule, and the same three numbers, as the
 *  bracelet card's tear-off line. The dashes are 0.4 mm slits, so the row reads as a dashed line
 *  in the file rather than as a row of slots. */
const PERF_DASH = 3;
const PERF_GAP = 1;
const PERF_W = 0.4;
/** Engraved capitals below this may not read — the working floor for engraved text. */
const READ_FLOOR = 4;
/** What a piece of kraft is, mm. A mirror of `CARD_THICKNESS` in `src/assembled.ts`, which is
 *  the authority: a template cannot import the view layer, and this is only used to pose the
 *  card on the table. Delete it the day `assembledPieces` poses a lone card of its own accord. */
const CARD_T = 0.6;
/** The front panel's optical centre, as a fraction of its height down from the fold: 46 %, not
 *  50 % (the eye reads the middle as slightly high). */
const OPTICAL = 0.46;

/** Faces that read ENGRAVED at a place card's 16 mm capital height: four wedding scripts and two
 *  serifs for a plainer table. Nothing here is welded or cut, so the thin connecting strokes that
 *  disqualify Pinyon and Allura from a cut-out name are exactly what makes them right here. */
const PLACE_CARD_FACES = ['great-vibes', 'parisienne', 'pinyon-script', 'allura', 'cinzel', 'eb-garamond'];

// ------------------------------------------------------------------- the card --

/**
 * The fold as a dashed cut: 3 mm slits 0.4 mm wide on y = 0, 1 mm of card between them, the row
 * centred and stopping `FOLD_INSET` short of each side edge.
 *
 * Kraft folds better on a perforation than on a score — a score crushes fibre and the crease
 * wanders; a dashed cut gives the fold a line to hinge on and the 1 mm bridges hold the two
 * panels together. The bridges are what stop it being a cut-in-two, which is why the ratio is
 * 3:1 ("tears with moderate effort") and not the 5:1 an actual tear-off wants.
 */
function foldPerfShapes(w: number): Shapes {
  const span = w - 2 * FOLD_INSET;
  const pitch = PERF_DASH + PERF_GAP;
  if (span < PERF_DASH) return [];
  const count = Math.floor((span - PERF_DASH) / pitch) + 1;
  const total = (count - 1) * pitch + PERF_DASH;
  const out: Shapes = [];
  for (let i = 0; i < count; i++) {
    out.push(...placeShapes([[roundedRectRing(PERF_DASH, PERF_W, PERF_W / 2, 4)]], -total / 2 + PERF_DASH / 2 + i * pitch, 0, 0));
  }
  return out;
}

/** The fold, scored: ONE open line across the midline. An open path rather than a hairline closed
 *  ring, so the laser makes one pass along it instead of two 0.12 mm apart. */
const foldScorePath = (w: number): Pt[] => {
  const half = Math.max(PERF_DASH, w - 2 * FOLD_INSET) / 2;
  return [[-half, 0], [half, 0]];
};

// ------------------------------------------------------------------ the type --

interface Line { shapes: Shapes; box: Box; baseline: number }

/**
 * One line of lettering, and where its baseline is.
 *
 * `textLayer` hands back a single centred layer, which is all a one-off design needs; a set needs
 * to know where the pen ran, so the glyphs come back one at a time and the baseline is the MEDIAN
 * of their lowest points. The median rather than the minimum because one descender ("Priya") must
 * not drag the whole card down, and rather than the mean because two would.
 */
async function lineShapes(text: string, font: string, size: number, letterSpacing: number, symbols: SymbolMap): Promise<Line | null> {
  if (!text.trim() || size <= 0) return null;
  const glyphs = await glyphLayers({ text, font, size, letterSpacing, symbols });
  const inked = glyphs.filter((g) => g.shapes.length > 0);
  if (!inked.length) return null;
  const shapes = inked.flatMap((g) => g.shapes);
  const mins = inked.map((g) => g.box.minY).sort((a, b) => a - b);
  const half = mins.length / 2;
  const baseline = mins.length % 2 ? mins[(mins.length - 1) / 2]! : (mins[half - 1]! + mins[half]!) / 2;
  return { shapes, box: bboxOf(shapes), baseline };
}

interface TypeSpec {
  font: string; nameSize: number;
  secondFont: string; secondSize: number;
  tracking: number; secondTracking: number;
  caps: boolean; symbols: SymbolMap;
}

/** The lettering as one block, with the point on it that lands on the panel's optical centre: the
 *  middle of the block's cap band — the top of the name's capitals down to the baseline of its
 *  last line. With no second line that is exactly `baseline + cap/2`. */
interface Block { shapes: Shapes; box: Box; anchor: number }

async function letterBlock(name: string, second: string, t: TypeSpec, k: number): Promise<Block | null> {
  const nameSize = t.nameSize * k;
  const secondSize = t.secondSize * k;
  const top = await lineShapes(name, t.font, nameSize, t.tracking, t.symbols);
  const under = await lineShapes(t.caps ? second.toLocaleUpperCase() : second, t.secondFont, secondSize, t.secondTracking, t.symbols);
  if (!top && !under) return null;

  let shapes: Shapes = [];
  let capTop = 0;
  let lastBaseline = 0;
  if (top) {
    shapes = top.shapes;
    capTop = top.baseline + (await textMetrics(t.font, nameSize)).cap;
    lastBaseline = top.baseline;
  }
  if (under) {
    // Stacked the way `stackedText` stacks: the gap is 0.45 of the lower line's own size.
    const dy = top ? top.box.minY - 0.45 * secondSize - under.box.maxY : 0;
    shapes = [...shapes, ...(dy ? placeShapes(under.shapes, 0, dy, 0) : under.shapes)];
    lastBaseline = under.baseline + dy;
    if (!top) capTop = lastBaseline + (await textMetrics(t.secondFont, secondSize)).cap;
  }
  return { shapes, box: bboxOf(shapes), anchor: (capTop + lastBaseline) / 2 };
}

/** The block's box padded to sit symmetrically about its anchor — what the fit has to clear.
 *  Scaling the type scales the block about that anchor (it is where the block is pinned), so a
 *  box measured about the same point is the one whose scale can be trusted. */
function fitHalf(b: Block): [number, number] {
  return [(b.box.maxX - b.box.minX) / 2, Math.max(b.anchor - b.box.minY, b.box.maxY - b.anchor)];
}

/** `line2` rather than the old `second`: that key used to hold a MODE (none / same on every card
 *  / after a "|"), and `coerceValues` keeps any saved key whose type still matches — so a project
 *  saved before tonight would have opened with the word "none" engraved on the card. */
const hasSecond = (v: Values) => str(v, 'line2').trim() !== '';

export const placeCards: TemplateDef = {
  id: 'place-cards',
  name: 'Place cards',
  blurb: 'A folded card that stands on the table by itself.',
  tags: ['party', 'engrave + score + cut'],
  batch: { key: 'name', noun: 'card' },
  // One sentence, and the only one this design needs: what to cut it from, and where it folds.
  // The editor adds its own "set the blue lines to Score" whenever the build scores.
  exportNote: (v) => (str(v, 'fold') === 'score'
    ? 'Cut it from kraft card, not ply, and fold it back on itself along the scored line.'
    : 'Cut it from kraft card, not ply, and fold it back on itself along the dashed line.'),
  fields: [
    // --------------------------------------------------------- RIGHT: what you type --
    // The Single | Batch switch, the list of names and the sheet are the form's own, added at the
    // top of this section because `batch.key` names a field in it.
    {
      kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text',
      value: 'Harper', placeholder: 'A guest name', maxLength: 24, symbols: true,
    },
    {
      kind: 'text', key: 'line2', label: 'Second line', panel: 'right', section: 'Text',
      value: 'Table 4', placeholder: 'Optional', maxLength: 24,
      help: 'A table number or a role, under the name.',
    },

    // --------------------------------------------------------------- LEFT: "Font" --
    // Two pickers in the one category, each printing its own role above its list — the
    // luggage-tag idiom, and the only way a second face is choosable at all (for a second line,
    // e.g. "Table X"). The name's
    // picker loses the generic label "Font" in the same move: `form.ts` prints a font field's
    // label only when it is not "Font", so an unnamed list beside a named one reads as a bug.
    {
      kind: 'font', key: 'font', label: 'Name font', panel: 'right', section: 'Font',
      value: 'great-vibes', recommended: PLACE_CARD_FACES,
    },
    {
      kind: 'font', key: 'line2Font', label: 'Second line font', panel: 'right', section: 'Font',
      value: SECOND_FONT, recommended: SECOND_LINE_FACES,
      // This picker letters its cards with the SECOND line, not the name: each font field takes
      // its own sample since 2026-09-22, so the two lists read as the two lines they set.
      previewFrom: 'line2',
      visibleWhen: hasSecond,
    },

    // ---------------------------------------------- LEFT: "Card" (opens first) --
    {
      kind: 'number', key: 'width', label: 'Width', section: 'Card',
      value: 90, min: 50, max: 150, step: 1, unit: 'mm',
    },
    {
      kind: 'number', key: 'height', label: 'Height', section: 'Card',
      value: 50, min: 30, max: 120, step: 1, unit: 'mm',
      help: 'The height it stands, folded — the sheet is twice this.',
    },
    {
      kind: 'number', key: 'corner', label: 'Corner radius', section: 'Card',
      value: 3, min: 0, max: 10, step: 0.5, unit: 'mm',
    },
    {
      // TWO options, not three. The old "Perforate" was this same operation sized for 3 mm ply
      // (6 mm slots, a ligament one sheet thick); on kraft there is nothing for that rule to
      // measure itself against, and a second perforation differing only in its numbers is a
      // choice nobody can make. So the dashed cut IS the perforation, and `'perf'` keeps its
      // value so a saved project opens on the line it was saved with.
      kind: 'select', key: 'fold', label: 'Fold', section: 'Card', value: 'perf',
      options: [{ value: 'perf', label: 'Dashed cut' }, { value: 'score', label: 'Score' }],
      help: 'Dashes cut through, so kraft folds on a straight crease.',
    },
    {
      kind: 'toggle', key: 'border', label: 'Border', section: 'Card', value: true,
      help: 'A scored rule inside the front of the card.',
    },

    // ---------------------------------------------------------- LEFT: "Lettering" --
    {
      kind: 'number', key: 'nameHeight', label: 'Name height', section: 'Lettering',
      value: 16, min: 5, max: 40, step: 0.5, unit: 'mm',
      help: 'Measured on the capitals, so changing font keeps the height.',
    },
    {
      kind: 'number', key: 'secondScale', label: 'Second line size', section: 'Lettering',
      value: 0.38, min: 0.2, max: 0.7, step: 0.05,
      format: (x) => `${Math.round(x * 100)}% of the name`,
      visibleWhen: hasSecond,
    },

    // "Material thickness" went with the ply: it only ever set the ligament between the old
    // slots, and the dashed fold's 1 mm bridge is fixed by the 3:1 ratio. A knob that moves
    // nothing is worse than no knob.
    {
      kind: 'select', key: 'op', label: 'Letters', section: 'Lettering',
      value: 'engrave',
      options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'Score outlines the letters instead of filling them.',
    },
    {
      // The face is the picker's now, so this is what is left of the old "Script (same font) |
      // Small caps": the CASE. Both values are kept, so a project saved with either opens
      // lettered the way it was saved.
      kind: 'select', key: 'secondStyle', label: 'Second line style', section: 'Lettering',
      value: 'caps',
      options: [{ value: 'caps', label: 'Small caps' }, { value: 'script', label: 'As typed' }],
      help: 'Small caps set it in spaced capitals.',
      visibleWhen: hasSecond,
    },
    {
      kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering',
      value: 0, min: -0.10, max: 0.30, step: 0.02,
      format: (x) => `${x > 0 ? '+' : ''}${x.toFixed(2)}`,
    },
    {
      kind: 'number', key: 'textY', label: 'Move text up/down', section: 'Lettering',
      value: 0, min: -10, max: 10, step: 0.5, unit: 'mm',
    },
  ],

  async build(v): Promise<BuildInput> {
    const w = Math.max(30, num(v, 'width'));
    const h = Math.max(20, num(v, 'height'));
    const corner = Math.max(0, Math.min(num(v, 'corner'), Math.min(w, h) / 2));
    const op: OpChoice = str(v, 'op') === 'score' ? 'score' : 'engrave';
    const textY = num(v, 'textY');
    const warnings: string[] = [];

    // The piece: W × 2H, the crease on y = 0 by construction. Folded back about it, the lower
    // half stands as the front with the crease at its top and the upper half is the back leg —
    // so the name reads upright flat on the sheet AND upright on the table, and nothing rotates.
    const outline: Shapes = [[roundedRectRing(w, 2 * h, corner)]];
    const fold: DesignLayer = str(v, 'fold') === 'score'
      ? { id: 'fold', label: 'Fold', shapes: [], op: 'score', kind: 'rule', paths: [foldScorePath(w)] }
      : { id: 'fold', label: 'Fold', shapes: foldPerfShapes(w), op: 'cut' };

    // The front panel, and the rule inside it. The rule is a true parallel offset of the card's
    // own outline, so its corners follow the card's rather than inventing a second radius.
    const panelY = -h / 2;
    const ruleW = w - 2 * BORDER_INSET;
    const ruleH = h - 2 * BORDER_INSET;
    const rule = bool(v, 'border') && ruleW > 12 && ruleH > 12
      ? placeShapes([[roundedRectRing(ruleW, ruleH, Math.max(0, corner - BORDER_INSET))]], 0, panelY, 0)
      : [];

    const layers: DesignLayer[] = [fold];
    if (rule.length) layers.push({ id: 'rule', label: 'Border', shapes: rule, op: 'score', kind: 'rule' });

    // Where the lettering may go: inside the rule when there is one — the rule is the edge a
    // reader sees — otherwise inside the panel at the house margin.
    const fitRegion: Shapes = rule.length ? rule : placeShapes([[roundedRectRing(w, h, corner)]], 0, panelY, 0);
    const clearance = rule.length ? TEXT_CLEAR : Math.max(4, 0.06 * Math.min(w, h));
    const yOpt = -OPTICAL * h;

    const name = str(v, 'name').trim();
    const second = str(v, 'line2').trim();
    const font = str(v, 'font') || 'great-vibes';
    const caps = str(v, 'secondStyle') !== 'script';
    // The second line's face is its own field now — never the name's, and never inferred from
    // the case. Setting the name to a script no longer silently drags "TABLE 4" with it.
    const secondFont = str(v, 'line2Font') || SECOND_FONT;
    const tracking = num(v, 'letterSpacing');
    const nameHeight = Math.max(1, num(v, 'nameHeight'));
    const type: TypeSpec = {
      font, nameSize: await sizeForCapHeight(font, nameHeight),
      secondFont,
      // The second face is only loaded when the card actually carries a second line.
      secondSize: second ? await sizeForCapHeight(secondFont, nameHeight * num(v, 'secondScale')) : 0,
      tracking, secondTracking: caps ? 0.12 : tracking,
      caps, symbols: readSymbols(v),
    };

    // The name is the one thing this design needs typed; a caption on its own still cuts, and
    // still says what is missing.
    if (!name) warnings.push('Type a name.');
    const measured = await letterBlock(name, second, type, 1);
    if (measured) {
      const k = fitBoxInside(fitRegion, [0, yOpt + textY], fitHalf(measured), clearance, null);
      const block = k < 0.999 ? await letterBlock(name, second, type, k) : measured;
      if (block) {
        layers.push({
          id: 'name', label: 'Name', kind: 'text', op,
          shapes: placeShapes(block.shapes, -(block.box.minX + block.box.maxX) / 2, yOpt + textY - block.anchor, 0),
        });
      }
      if (name && nameHeight * k < READ_FLOOR) warnings.push('The name is under 4 mm — shorten it or widen the card.');
    }

    return {
      blank: { kind: 'shape', shapes: outline },
      // Kraft, 0.6 mm: the preview draws it in card rather than ply, the 3D view gives it a
      // card's thickness, and the outline leaves the export in its own "Card" group for the
      // operator's sheet change.
      material: 'card',
      // …and this is what makes the 3D view honour it. `assembledPieces` returns null for a
      // design that is ONE flat piece with nowhere to go, and the flat render then draws the
      // sheet at the thickness slider's 3 mm in wood — a slab. A pose
      // is the one thing a template can say that the view cannot work out for itself, and this
      // one says exactly what the engine would have: the card lying on the table, half its own
      // thickness up. A batched run needs none of it — the copies already put every card in the
      // view, each at its own place on the sheet, and a fixed pose would pile card 1 on top.
      ...(v.__batch === true ? {} : { pose: { x: 0, y: 0, z: CARD_T / 2 } }),
      // Never `keyringFrom(v)`: with no keyring fields on the form it reports an ENABLED 0 mm
      // hole. A place card hangs from nothing, so the ring is off and there is no hole to drag.
      keyring: { enabled: false, mode: 'outside', side: 'left', along: 0.5, dia: 4, ring: 2, position: -1 },
      layers,
      ...(warnings.length ? { warnings } : {}),
    };
  },

  // A run says how many names are in it; one card says whose it is.
  fileName: (v) => {
    const run = v.__batch === true ? lines(v, '__batchLines').length : 0;
    return run ? stem('place-cards', run, 'names') : stem('place-cards', str(v, 'name'));
  },
};
