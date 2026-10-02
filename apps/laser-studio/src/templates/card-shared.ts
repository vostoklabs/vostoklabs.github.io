// The business-card family: five layouts of one product, sharing everything but the layout.
// 2026-09-26: one template per business-card layout, each made unique with the pattern engine.
// The five:
//
//   business-card            a pattern BAND down one side, the lettering in the column beside it
//   business-card-half       one half of the card is one big pattern, the lettering in the other
//   business-card-framed     the pattern everywhere round a solid centre PANEL that holds the text
//   business-card-tall       portrait: the pattern round a name band and a details panel
//   business-card-logo-tile  a pattern side with a solid logo TILE set into its inner edge
//
// What they share, and the numbers that hold every one of them together:
//
//   THE BORDER. A solid frame of material `BORDER` (4 mm) runs round every card, whatever the
//   pattern — the card stays one strong piece and every strut of a lattice lands on it. It is
//   the pattern's edge margin, fixed: the form's "Edge margin" slider is not offered, because on
//   a card the border is part of the layout (the column, the panel and the tile are measured off
//   it) and a margin of 0 would put cuts on the edge a hand holds.
//
//   THE PATTERN is `@vostok/patterns` through one call, `patternLayers(region, …)`
//   (plus Dahlia, the half card's petal burst, drawn in `card-dahlia.ts`): a
//   line pattern cut out is a lattice (its lines stay as struts `web` wide, the faces between
//   them go), a hole pattern punches its holes, and the fill keeps `max(BORDER, web)` off every
//   edge of the region — its OUTER edge and the edges of its holes, which are the reserves: the
//   panel, the name band, the tile. So each layout builds its REGION so that the faces stop
//   exactly where the solid parts it designed begin: a reserve is the solid part shrunk by that
//   inset, and a region's inner edge sits that far past the pattern's visible edge.
//
//   THE STRUTS are the first card's 1.5 mm `WALL` by default, 1.2–2 mm on the Web slider.
//
//   THE LETTERING is the first business card's `buildLockup`, moved here with its hierarchy and
//   numbers unchanged: `nameSize` is a cap height, title / phone / third line are 0.6 and 0.45 of
//   it floored at 2.5 mm, and the whole block is fitted by ONE factor — the floor holding while
//   the name and title give way, and saying so on the rare card where it cannot. It is split into
//   the rows (`lockupRows`) and their arrangement (`stack`, `arrange`), because a layout now
//   places them in SLOTS: the tall card sets them over two panels, the framed card sets the logo
//   beside the lines, the logo tile takes the logo out of them (`fitLockup`).
//
//   THE RUN is a team: `batch: { key: 'name' }` builds one card per name on one sheet.
import { bboxOf, placeShapes, roundedRectRing, type Box, type Pt, type Shapes } from '@vostok/laser';
import type { CutRing } from '@vostok/export';
import { readSymbols, type SymbolMap } from '../symbols/model';
import { sizeForCapHeight } from '../engine/metrics';
import { applyCase, symbolLayer, textLayer } from '../engine/text';
import type { BuildInput, DesignLayer, OpChoice } from '../engine/types';
import { patternFields, patternLayers } from './pattern-shared';
import './card-dahlia';
import { stem } from './shared';
import { bool, num, str, type Field, type Values } from './types';

// ------------------------------------------------------------------------- sizes & numbers --

/** The three real business-card dimensions, mm, landscape. The tall card turns them on end. */
const SIZES: Record<string, [number, number]> = { '85x55': [85, 55], '89x51': [89, 51], '90x50': [90, 50] };
export const DEFAULT_SIZE = '85x55';

/** The card's size, mm, in the orientation the layout reads in. */
export function cardSize(v: Values, portrait = false): [number, number] {
  const [w, h] = SIZES[str(v, 'cardSize')] ?? SIZES[DEFAULT_SIZE]!;
  return portrait ? [h, w] : [w, h];
}

/** The solid border round every card, mm — the sourced 3–5 mm safe
 *  zone at the generous end for a piece this small, and the lattice's frame: every strut lands
 *  on it. The pattern's edge margin, fixed (see the header). */
export const BORDER = 4;

/** Air between the lettering and the nearest cut of the pattern, mm. The band's old clearance
 *  from the text column, now measured from the pattern's visible edge on every layout. */
export const GUTTER = 3;

/**
 * The strut a lattice card is cut with by default, mm — the first card's `WALL`, kept.
 *
 * The assignment's floor is 1 mm; this is that plus a kerf margin. At the worst bundled kerf
 * (0.40 mm) a strut this wide still finishes ≥ 1.1 mm after both flanking cuts eat into it; at
 * 3 mm ply's 0.18 mm it finishes ≥ 1.3 mm. No strut here is isolated: every one sits inside a
 * mesh anchored to the 4 mm border.
 */
export const WALL = 1.5;
/** The thinnest strut the Web slider allows on a card, mm: 1 mm plus a 0.1 mm kerf each side. */
export const MIN_WEB = 1.2;
/** The widest, mm: every layout's default pattern still cuts at 2 mm (the band's 70 % cubes stop
 *  at 2.5, their cells eaten whole), so the slider's far end never builds a card with no cut. */
const MAX_WEB = 2;

/** The name : subtitle ladder (the sourced badge ratio). The
 *  tertiary lines left the ladder for a size of their own (`cardLetteringFields`). */
const TITLE_RATIO = 0.6;
/** The detail lines' floor, mm of cap: below this a phone number is decoration (§2). */
const DETAIL_FLOOR = 2.5;
/** The phone and third line's default cap, mm: the floor, which is what the old 0.45 ladder
 *  landed on at every card's defaults, so the default cards are unchanged. */
const CONTACT_SIZE = 2.5;

/**
 * The cap height at which the name warns, mm: the house's legibility floor (`fitText`'s
 * `minCap`). 4 mm is the Name height slider's own minimum and
 * the DEFAULT build must clear it (each suite asserts so) — warning there would fire on most
 * real names while the card itself is fine.
 */
export const READABLE_CAP = 3;
/** The thinnest line that survives a burn. */
const MIN_STROKE = 0.3;
/** How far above true centre a block sits, as a share of its box's height — the optical centre
 *  is 44–48 % from the top, not 50. */
const OPTICAL_LIFT = 0.04;

export const EMPTY_WARNING = 'Type a name to see it on the card.';

/**
 * Faces that hold up at this card's floors, each built at `nameSize = 4` / detail 2.5 mm and
 * looked at before it went on the list (G2). Montserrat is legible at 2.5 mm but the thinnest
 * sans tested; Inter is sturdier; Archivo Black is the most legible of all under UPPERCASE.
 * Libre Baskerville is offered for the name's character rather than the floor. Alegreya Sans SC
 * renders true small caps from lower-case input. Lora was dropped: its hairline serifs thin at
 * 4 mm.
 */
export const READS_SMALL = ['montserrat', 'inter', 'archivo-black', 'manrope', 'libre-baskerville', 'alegreya-sans-sc'];

// -------------------------------------------------------------------------------- geometry --

/** The card's outline, centred. */
export const cardRing = (w: number, h: number, corner: number): CutRing => roundedRectRing(w, h, corner, 12);

/**
 * A convex ring cut by the line `x = at`, keeping the side `keep` says — Sutherland–Hodgman
 * against one edge. The card is convex, so its left or right part is one ring, and a region
 * built this way follows the card's own rounded corners instead of poking past them.
 */
export function clipX(ring: CutRing, at: number, keep: 'left' | 'right'): CutRing {
  const inside = (p: Pt) => (keep === 'left' ? p[0] <= at : p[0] >= at);
  const out: CutRing = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (at - a[0]) / (b[0] - a[0]);
      out.push([at, a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** The same cut along `y = at`, keeping the part above or below it. */
export function clipY(ring: CutRing, at: number, keep: 'above' | 'below'): CutRing {
  const swap = (r: CutRing): CutRing => r.map(([x, y]): Pt => [y, x]);
  // Swapping the axes mirrors the ring; the clip does not care which way round it runs, and the
  // swap back restores the winding.
  return swap(clipX(swap(ring), at, keep === 'above' ? 'right' : 'left'));
}

/** A convex ring clipped by another convex ring (counter-clockwise): what the two share. The
 *  half card's burst is the card and a disc, and both are convex. */
export function clipConvex(subject: CutRing, clip: CutRing): CutRing {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i]!;
    const [bx, by] = clip[(i + 1) % clip.length]!;
    const side = ([x, y]: Pt) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const next: CutRing = [];
    for (let j = 0; j < out.length; j++) {
      const p = out[j]!;
      const q = out[(j + 1) % out.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    out = next;
  }
  return out;
}

/** Rings mirrored left ↔ right, winding kept (a mirror reverses it, so the order is too). */
export const mirrorRings = (shapes: Shapes): Shapes => shapes.map((island) => island.map((r) => r.map(([x, y]): Pt => [-x, y]).reverse()));
export const mirrorBox = (b: Box): Box => ({ minX: -b.maxX, maxX: -b.minX, minY: b.minY, maxY: b.maxY });

/** A rectangle as a box, from its centre and size. */
export const boxAt = (cx: number, cy: number, w: number, h: number): Box => ({ minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 });
/** A box shrunk by `d` on every side. */
export const shrinkBox = (b: Box, d: number): Box => ({ minX: b.minX + d, maxX: b.maxX - d, minY: b.minY + d, maxY: b.maxY - d });
/** A box as a rounded-rectangle ring, `r` clamped to fit. */
export const boxRing = (b: Box, r: number): CutRing => {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return roundedRectRing(w, h, Math.max(0, Math.min(r, w / 2, h / 2)), 8).map(([x, y]): Pt => [x + (b.minX + b.maxX) / 2, y + (b.minY + b.maxY) / 2]);
};

/**
 * The lettering's box inside a solid panel `P` whose faces stop `inset` off a sharp-cornered
 * reserve — so the panel's visible corners are rounded by `inset`. GUTTER in along the sides is
 * not enough at a corner: the box's corner sits √2 × (inset − d) from the arc's centre, and stays
 * GUTTER clear of the arc only from d = inset − (inset − GUTTER) / √2 (3.29 mm at a 4 mm inset).
 */
export const panelSlot = (P: Box, inset: number): Box => shrinkBox(P, Math.max(GUTTER, inset - (inset - GUTTER) / Math.SQRT2));

const move = (layers: DesignLayer[], dx: number, dy: number): DesignLayer[] =>
  layers.map((l) => ({ ...l, shapes: placeShapes(l.shapes, dx, dy, 0) }));

// ---------------------------------------------------------------------------------- fields --

/** What the customer types, on the right, in the order it appears on the card. `logoHelp` is the
 *  logo's tooltip where a layout has more to say (the logo tile fills an empty logo with the
 *  initials). */
export function cardTextFields(o: { logoHelp?: string } = {}): Field[] {
  return [
    { kind: 'text', key: 'name', label: 'Name', panel: 'right', section: 'Text', value: 'John Smith', placeholder: 'Your name', maxLength: 30 },
    { kind: 'text', key: 'title', label: 'Title', panel: 'right', section: 'Text', value: 'Senior Designer', placeholder: 'Job title', maxLength: 28 },
    // No symbol button on a phone number or a web address: an inline icon has no use there, and
    // the button is one more thing to read past.
    { kind: 'text', key: 'phone', label: 'Phone', panel: 'right', section: 'Text', value: '+1 555 0142', placeholder: 'Phone number', maxLength: 24, symbols: false },
    { kind: 'text', key: 'line4', label: 'Third line', panel: 'right', section: 'Text', value: 'website.com', placeholder: 'Email, site or address', maxLength: 32, symbols: false },
    { kind: 'symbol', key: 'logo', label: 'Logo', panel: 'right', section: 'Logo', value: '', help: o.logoHelp ?? 'Optional, many cards work well with just the name.' },
  ];
}

/** The card itself: its size and corners, then whatever the layout adds (`extra`). */
export function cardShapeFields(extra: Field[] = [], o: { portrait?: boolean } = {}): Field[] {
  const label = (w: number, h: number, us = false) => (o.portrait ? `${h} × ${w} mm` : `${w} × ${h} mm`) + (us ? ' (US)' : '');
  return [
    {
      kind: 'select', key: 'cardSize', label: 'Card size', section: 'Card', value: DEFAULT_SIZE,
      options: [{ value: '85x55', label: label(85, 55) }, { value: '89x51', label: label(89, 51, true) }, { value: '90x50', label: label(90, 50) }],
    },
    { kind: 'number', key: 'corner', label: 'Corner radius', section: 'Card', value: 3, min: 1, max: 6, step: 0.5, unit: 'mm' },
    ...extra,
  ];
}

/** The side a one-sided pattern sits on — the band, the half, the tile's side. */
export const sideField = (value: 'left' | 'right'): Field => ({
  kind: 'select', key: 'patternSide', label: 'Pattern side', section: 'Card', value,
  options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
});

/**
 * The pattern picker and its knobs, from `patternFields`, set for a card:
 *   · "Make it" opens on Cut out — every card photo is cut through;
 *   · Web opens at the 1.5 mm `WALL` and never goes under 1.2 or past 2;
 *   · no Edge margin — the border is fixed (see the header);
 *   · Angle and Position go under More: the layout has already placed the pattern, and the
 *     first screen keeps to the picker, Zoom, Make it and Web.
 * `zoom` is the layout's own default: a card is small, and each pattern's cell is sized by eye
 * against its photo.
 */
export function cardPatternFields(o: { value: string; zoom?: number }): Field[] {
  return patternFields({ section: 'Pattern', value: o.value, op: 'cut', margin: BORDER })
    .filter((f) => f.key !== 'margin')
    .map((f): Field => {
      if (f.key === 'patternScale' && f.kind === 'number') return { ...f, value: o.zoom ?? 100 };
      if (f.key === 'web' && f.kind === 'number') return { ...f, value: WALL, min: MIN_WEB, max: MAX_WEB };
      if (f.key === 'patternAngle' || f.key === 'patternX') return { ...f, advanced: true };
      return f;
    });
}

/** How the lines of the lockup line up with each other and sit in their space. */
export type Align = 'left' | 'centre' | 'right';
const ALIGNS: Align[] = ['left', 'centre', 'right'];
/** How far "Move the text" reaches each way, mm. The move is held inside the space the layout
 *  keeps clear of the pattern (`fitLockup`), so this only has to be generous, never exact. */
const MOVE_REACH = 25;

/** The lettering knobs and the font. `logoSize: false` where the layout sizes the logo itself;
 *  `textCase` is how the name is set by default — capitals on the band card (its photo's "YOUR
 *  LOGO"), as typed on the rest, whose photos all set "Michael Williams" in upper and lower case;
 *  `align` is the layout's own line-up (flush left beside a band, centred on a panel).
 *
 *  Align, Move the text, the three sizes and Line spacing came in 2026-09-29: lettering settings
 *  (alignment, size, position), where before there was no way to adjust or move the text at
 *  all. "Letters are" and the Rule went under More to keep
 *  the category at six controls.
 *
 *  The phone and third line have a size of their OWN, in mm (the same evening). The first cut
 *  scaled them with the title by one
 *  percentage on the name's ladder, and they never moved: 0.45 of a fitted name is under the
 *  2.5 mm floor on every card, so 75 % and 100 % both built 2.5, and 150 % grew the title so much
 *  that the fit shrank the whole block and the phone came out 2.6. A millimetre the customer
 *  types is a millimetre they get, unless the space cannot hold it. */
export function cardLetteringFields(o: { nameSize?: number; logoSize?: boolean; textCase?: 'upper' | 'as-typed'; align?: Align } = {}): Field[] {
  return [
    {
      kind: 'number', key: 'nameSize', label: 'Name height', section: 'Lettering',
      value: o.nameSize ?? 6, min: 4, max: 10, step: 0.5, unit: 'mm',
      help: 'The title scales together with it.',
    },
    {
      kind: 'number', key: 'titleSize', label: 'Title size', section: 'Lettering',
      value: 100, min: 75, max: 150, step: 5, unit: '%',
      help: 'The title against the name.',
    },
    {
      kind: 'number', key: 'contactSize', label: 'Phone & third line', section: 'Lettering',
      value: CONTACT_SIZE, min: DETAIL_FLOOR, max: 5, step: 0.25, unit: 'mm',
      help: 'Letter height of the phone number and the third line.',
    },
    {
      kind: 'select', key: 'textAlign', label: 'Align', section: 'Lettering', value: o.align ?? 'left',
      options: [{ value: 'left', label: 'Left' }, { value: 'centre', label: 'Centre' }, { value: 'right', label: 'Right' }],
    },
    {
      kind: 'position', key: 'textX', keyY: 'textY', label: 'Move the text', section: 'Lettering',
      value: 0, valueY: 0, max: MOVE_REACH, step: 0.5, unit: 'mm',
      help: 'Moves it within the space the pattern leaves clear.',
    },
    { kind: 'toggle', key: 'rule', label: 'Rule between name and details', section: 'Lettering', value: true, advanced: true },
    ...(o.logoSize === false ? [] : [{
      kind: 'number', key: 'logoSize', label: 'Logo size', section: 'Lettering',
      value: 14, min: 12, max: 18, step: 0.5, unit: 'mm', visibleWhen: (v: Values) => str(v, 'logo') !== '',
    } satisfies Field]),
    { kind: 'font', key: 'font', label: 'Font', panel: 'right', section: 'Font', value: 'montserrat', recommended: READS_SMALL },
    {
      kind: 'select', key: 'op', label: 'Letters are', section: 'Lettering', value: 'engrave', advanced: true,
      options: [{ value: 'engrave', label: 'Engrave' }, { value: 'score', label: 'Score' }],
      help: 'No cut option, letters this small would drop out as scrap.',
    },
    {
      kind: 'select', key: 'textCase', label: 'Capitalise the name', section: 'Lettering', value: o.textCase ?? 'upper', advanced: true,
      options: [
        { value: 'as-typed', label: 'As typed' }, { value: 'upper', label: 'UPPERCASE' },
        { value: 'lower', label: 'lowercase' }, { value: 'title', label: 'Title case' },
      ],
    },
    {
      kind: 'number', key: 'letterSpacing', label: 'Letter spacing', section: 'Lettering',
      value: 0, min: -10, max: 30, step: 1, unit: '%', advanced: true,
      help: 'Applies to every line, not just the name.',
    },
    {
      kind: 'number', key: 'lineSpacing', label: 'Line spacing', section: 'Lettering',
      value: 100, min: 60, max: 200, step: 5, unit: '%', advanced: true,
      help: 'The space between the lines.',
    },
  ];
}

/** The line-up the customer chose, or null (an old save, a layout without the control). */
const alignOf = (v: Values): Align | null => (ALIGNS as string[]).includes(str(v, 'textAlign')) ? (str(v, 'textAlign') as Align) : null;
/** A percentage field as a factor; a missing or zero value (an old save) is 1. */
const factorOf = (v: Values, key: string): number => (num(v, key) > 0 ? num(v, key) / 100 : 1);

// ------------------------------------------------------------------------------ the lockup --

/** One line of the lockup, by what it says. */
export type Role = 'logo' | 'name' | 'rule' | 'title' | 'phone' | 'line4';

interface Row {
  role: Role;
  layers: DesignLayer[];
  box: Box;
  /** The space above this row when another row sits over it, mm. */
  gap: number;
}

/**
 * Logo, name, rule, title, phone and the third line at scale `k`, each built and MEASURED rather
 * than trusted to its slider: cap height, a descender on a "g" and an empty row all move a block
 * that assumes. The gap above a row is `stackedText`'s own convention, 0.45 × that row's size.
 */
async function lockupRows(v: Values, k: number, op: OpChoice, symbols: SymbolMap, floors: boolean): Promise<{ rows: Row[]; nameCap: number; smallest: number; contactCap: number }> {
  const font = str(v, 'font');
  const track = num(v, 'letterSpacing') / 100;
  const asked = num(v, 'nameSize');
  // The 2.5 mm clamp applies to the ratio AND to the shrink: a phone number is the one line a
  // stranger has to read, and the design's own floor is not a floor if `k` may walk it under.
  // But a floor that outgrows the line above it turns the ladder upside down — a 29-character
  // name shrunk to 1.7 mm under a title held at 2.5 — so each floor is capped by the line above:
  // the hierarchy survives every scale even where legibility cannot. (`floors: false` drops
  // both — see `fitLockup`, where a floored detail line is what overflows its box.)
  const nameCap = asked * k;
  // The floor is capped by the line above. What the customer asked for is capped by the NAME
  // only: a phone set bigger than the title is theirs to set, but a phone number bigger than the
  // name is the ladder upside down (a long name fitted to 1.7 mm over a phone held at 2.5).
  const floorUnder = (above: number) => Math.min(DETAIL_FLOOR, above);
  // "Title size" moves the title against the name; at its 150 % top the title is still 0.9 of
  // the name, so the name stays the biggest line.
  const titleAsked = TITLE_RATIO * factorOf(v, 'titleSize') * asked * k;
  const titleCap = floors ? Math.max(floorUnder(nameCap), titleAsked) : titleAsked;
  // The phone and third line are HELD at their size while the fit shrinks the name and title,
  // exactly as the floor was — the size the customer typed is the size they get. Only when that
  // line is itself too long for its space (the fit's `floors: false` pass) does it give way too.
  const contact = num(v, 'contactSize') > 0 ? num(v, 'contactSize') : CONTACT_SIZE;
  const detailCap = Math.min(nameCap, floors ? Math.max(floorUnder(titleCap), contact) : contact * k);
  const [nameEm, titleEm, detailEm] = await Promise.all([
    sizeForCapHeight(font, nameCap), sizeForCapHeight(font, titleCap), sizeForCapHeight(font, detailCap),
  ]);

  const rows: Row[] = [];
  const spacing = factorOf(v, 'lineSpacing');
  const push = (role: Role, layers: DesignLayer[], gap: number) => {
    const shapes = layers.flatMap((l) => l.shapes);
    if (shapes.length) rows.push({ role, layers, box: bboxOf(shapes), gap: gap * spacing });
  };
  const line = (text: string, size: number, id: string, label: string) =>
    text.trim() ? textLayer({ text, font, size, letterSpacing: track, symbols }, op, id, label) : Promise.resolve([]);

  const logo = str(v, 'logo');
  if (logo) push('logo', await symbolLayer(logo, num(v, 'logoSize') * k, op, { symbols }, 'logo'), 0.45 * nameEm);

  const name = await line(applyCase(str(v, 'name'), str(v, 'textCase')), nameEm, 'name', 'Name');
  push('name', name, 0.45 * nameEm);

  // The rule is measured off the name it divides, never off the slider: 45 % of the name's
  // width but never under 3 name-capitals (45 % of "AL" is an underscore typed by mistake), a
  // stroke a tenth of the title's cap, a gap 0.6 of it above and below (§5.1). At hairline
  // thickness a filled bar and a scored outline read alike, so it takes the letters' op.
  let ruled = false;
  if (bool(v, 'rule') && name.length) {
    const nb = bboxOf(name.flatMap((l) => l.shapes));
    const width = Math.max(0.45 * (nb.maxX - nb.minX), 3 * nameCap);
    const stroke = Math.max(MIN_STROKE, 0.1 * titleCap);
    if (width > stroke) {
      push('rule', [{ id: 'rule', label: 'Rule', shapes: [[roundedRectRing(width, stroke, stroke / 2, 4)]], op }], 0.6 * titleCap);
      ruled = true;
    }
  }

  push('title', await line(str(v, 'title'), titleEm, 'title', 'Title'), ruled ? 0.6 * titleCap : 0.45 * titleEm);
  push('phone', await line(str(v, 'phone'), detailEm, 'phone', 'Phone'), 0.45 * detailEm);
  push('line4', await line(str(v, 'line4'), detailEm, 'line4', 'Third line'), 0.45 * detailEm);
  // The cap of the smallest line drawn: the one the 2.5 mm floor is for.
  const has = (role: Role) => rows.some((r) => r.role === role);
  const contactCap = has('phone') || has('line4') ? detailCap : 0;
  const smallest = contactCap || (has('title') ? titleCap : name.length ? nameCap : 0);
  return { rows, nameCap: name.length ? nameCap : 0, smallest, contactCap };
}

/** A block of layers: left edge at x = 0, vertical centre at y = 0. */
interface Block {
  layers: DesignLayer[];
  width: number;
  height: number;
  /** The line that sets the width. */
  widest?: Role;
}

/**
 * Rows stacked top to bottom, flush LEFT (a detail block centred reads ragged on both edges)
 * or centred on one axis where the layout is symmetric — the
 * framed and tall cards' panels — or flush right where the customer asks for it. The first
 * row's gap is dropped: a slot starts at its ink.
 */
function stack(rows: Row[], align: Align): Block {
  if (!rows.length) return { layers: [], width: 0, height: 0 };
  const heights = rows.map((r) => r.box.maxY - r.box.minY);
  const gaps = rows.map((r, i) => (i ? r.gap : 0));
  const height = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const widths = rows.map((r) => r.box.maxX - r.box.minX);
  const width = Math.max(...widths);
  const layers: DesignLayer[] = [];
  let top = height / 2;
  rows.forEach((r, i) => {
    top -= gaps[i]!;
    const h = heights[i]!;
    const w = r.box.maxX - r.box.minX;
    const x = align === 'left' ? -r.box.minX : align === 'right' ? width - w - r.box.minX : (width - w) / 2 - r.box.minX;
    layers.push(...move(r.layers, x, top - h / 2 - (r.box.minY + r.box.maxY) / 2));
    top -= h;
  });
  return { layers, width, height, widest: rows[widths.indexOf(width)]!.role };
}

/** Where a slot's share of the lockup goes. */
export interface Slot {
  /** The box the lines must stay inside — already clear of every cut by `GUTTER`. */
  box: Box;
  /** Which lines go here. Default: all of them. */
  roles?: Role[];
  /** The layout's own line-up; the customer's Align wins over it. */
  align?: Align;
  /** A logo on top of the lines (default), or beside them, vertically centred on them — the
   *  framed card's panel, where a logo above the name would leave no room for the name. Beside,
   *  it is never taller than the lines it stands by: a logo towering over two lines reads as
   *  the card's subject, and its width comes out of theirs. */
  logo?: 'above' | 'beside';
}

/** Layers scaled by `f` about the origin. */
const scaled = (layers: DesignLayer[], f: number): DesignLayer[] =>
  layers.map((l) => ({ ...l, shapes: l.shapes.map((island) => island.map((r) => r.map(([x, y]): Pt => [x * f, y * f]))) }));

/** A slot's rows arranged. Beside a logo the lines stay flush with each other on the logo's far
 *  side; aligned right, the logo moves to the right of them, so it is always on the outside. */
function arrange(rows: Row[], slot: Slot, align: Align): Block {
  const mine = rows.filter((r) => !slot.roles || slot.roles.includes(r.role));
  const found = mine.find((r) => r.role === 'logo');
  const lines = mine.filter((r) => r.role !== 'logo');
  if (slot.logo !== 'beside' || !found || !lines.length) return stack(mine, align);
  const right = align === 'right';
  const text = stack(lines, right ? 'right' : 'left');
  const f = Math.min(1, text.height / (found.box.maxY - found.box.minY));
  const logo = f < 1 ? { ...found, layers: scaled(found.layers, f), box: { minX: found.box.minX * f, maxX: found.box.maxX * f, minY: found.box.minY * f, maxY: found.box.maxY * f } } : found;
  const lw = logo.box.maxX - logo.box.minX;
  const lh = logo.box.maxY - logo.box.minY;
  // A logo's own width of air would push the name off the panel; its gap above the name in the
  // stacked lockup (0.45 of the name's size) is too tight sideways. A quarter of its height,
  // never under the gutter.
  const gap = Math.max(GUTTER, 0.25 * lh);
  return {
    layers: [
      ...move(logo.layers, (right ? text.width + gap : 0) - logo.box.minX, -(logo.box.minY + logo.box.maxY) / 2),
      ...move(text.layers, right ? 0 : lw + gap, 0),
    ],
    width: lw + gap + text.width,
    height: Math.max(lh, text.height),
    widest: text.widest,
  };
}

/** Which slot, and which way, the fit ran out of room — what a warning names as the fix. */
export interface Bound {
  slot: number;
  axis: 'width' | 'height';
  /** The line that set the width, when the width bound. */
  role?: Role;
}

/** The lockup, fitted to its slots and placed in them. */
export interface Lettering {
  layers: DesignLayer[];
  /** The name's cap height as built, mm — 0 when there is no name. */
  nameCap: number;
  /** The smallest line's cap as built, mm (the phone and third line when there are any). */
  smallest: number;
  /** The details' 2.5 mm floor gave way: a line at the floor was too long for its slot. */
  floorsDropped: boolean;
  /** Where the room ran out, when the lockup had to shrink at all. */
  bound: Bound | null;
  /** "Move the text" asked to go past the edge of a slot, and was held at it. */
  held: boolean;
  /** The phone and third line are under the size asked for: their space could not hold it. */
  contactShort: boolean;
}

/**
 * The whole lockup scaled by ONE factor so every slot's share fits its box, then placed: flush
 * left on the box's left edge, centred on it or flush right (the customer's Align, else the
 * layout's), lifted to the optical centre (never out of the box), and moved by "Move the text"
 * within the box. One factor across slots too, so the tall card's name band and details panel keep one
 * hierarchy rather than each shrinking on its own.
 *
 * The details' 2.5 mm floor holds while the fit shrinks: only the name and title give way. So the
 * fit is not proportional — a floored line keeps its size as `k` falls — and one pass at the
 * proportional `k` still overflows. It is solved instead: the overflow (block ÷ box, the worst
 * slot) is convex and piecewise linear in `k`, so a secant from above lands on the fit in a step
 * or two and never below it. Only when shrinking stops helping — a line AT the floor is itself
 * too long, 32 characters of web address in a 28 mm column — or holding the floor would cost the
 * name more than dropping it, does the floor give way; then the block is proportional and one
 * pass lands it, never above k = 1, and `letteringWarnings` says so.
 *
 * The doc's "stop shrinking below k = 0.6" is NOT done: stopping there puts a 107 mm name on an
 * 85 mm card and lets the plate clip it, the exact failure the one-factor fit exists to prevent.
 * The name landing under `READABLE_CAP` is what warns (`letteringWarnings`).
 */
export async function fitLockup(v: Values, slots: Slot[]): Promise<Lettering> {
  const op = (str(v, 'op') || 'engrave') as OpChoice;
  const symbols = readSymbols(v);
  // A phone or third line asked for wider than its space is held at the most that fits, so the
  // name keeps its size rather than every line shrinking together (the tall card's details
  // panel holds a 3.6 mm phone number; asked for 5, the name used to fall to 3.2 with it).
  let lv = v;
  const askedContact = num(v, 'contactSize') > 0 ? num(v, 'contactSize') : CONTACT_SIZE;
  if (askedContact > CONTACT_SIZE) {
    const probe = await lockupRows(v, 1, op, symbols, true);
    const contactRows = probe.rows.filter((r) => r.role === 'phone' || r.role === 'line4');
    const room = Math.min(...slots.filter((s) => !s.roles || s.roles.includes('phone') || s.roles.includes('line4')).map((s) => s.box.maxX - s.box.minX));
    const widest = Math.max(0, ...contactRows.map((r) => r.box.maxX - r.box.minX));
    if (widest > room) lv = { ...v, contactSize: Math.max(CONTACT_SIZE, (probe.contactCap * room) / widest - 0.01) };
  }
  const build = async (k: number, floors: boolean) => {
    const { rows, nameCap, smallest, contactCap } = await lockupRows(lv, k, op, symbols, floors);
    const blocks = slots.map((s) => arrange(rows, s, alignOf(v) ?? s.align ?? 'left'));
    // The overflow: the worst of every slot's block over its box, each way; ≤ 1 fits.
    let over = 0;
    let bound: Bound | null = null;
    blocks.forEach((b, i) => {
      const box = slots[i]!.box;
      if (!(b.width > 0 && b.height > 0)) return;
      for (const [axis, r] of [['width', b.width / (box.maxX - box.minX)], ['height', b.height / (box.maxY - box.minY)]] as const) {
        if (r > over) [over, bound] = [r, { slot: i, axis, ...(axis === 'width' && b.widest ? { role: b.widest } : {}) }];
      }
    });
    return { k, blocks, nameCap, smallest, contactCap, over, bound };
  };
  const FITS = 1.001;

  let made = await build(1, true);
  const shrank = made.over > FITS;
  let floorsDropped = false;
  if (shrank) {
    let floored: typeof made | null = null;
    let prev = made;
    let k = 1 / made.over;
    for (let i = 0; i < 6 && k > 0; i++) {
      const next = await build(k, true);
      if (next.over <= FITS) {
        floored = next;
        break;
      }
      const slope = (prev.over - next.over) / (prev.k - next.k);
      if (!(slope > 1e-3)) break;
      prev = next;
      k = next.k - (next.over - 1) / slope;
    }
    // Holding the floors is worth it while the name stays readable, or no smaller than it would
    // be without them (a long NAME caps every line under it either way). Past that — a floored
    // line too long for its slot, which only the name's collapse would make room for — the
    // floors give way and the block is proportional. Nor is holding the phone worth a name no
    // bigger than the phone: a 4 mm phone held in a small panel took the framed card's name down
    // to meet it. Proportional keeps the customer's own ratio between the two.
    //
    // Proportional is only NEARLY linear, so one pass can land a hair over (0.1 mm on the framed
    // card with a 5 mm phone); another pass from there closes it.
    if (!floored || floored.nameCap < READABLE_CAP || floored.nameCap < floored.contactCap + 0.05) {
      let flat = await build(1, false);
      for (let i = 0; i < 3 && flat.over > FITS; i++) flat = await build(flat.k / flat.over, false);
      if (!floored || flat.nameCap > floored.nameCap + 0.05) {
        floored = flat;
        floorsDropped = true;
      }
    }
    made = floored;
  }

  // Placed by the line-up, then moved by "Move the text" — and HELD inside the slot, which is
  // exactly the room the layout keeps clear of every cut: text moved into the pattern would be
  // engraved over holes. Where the block already fills its slot one way, it moves only the other.
  const dx = num(v, 'textX');
  const dy = num(v, 'textY');
  let held = false;
  const hold = (want: number, lo: number, hi: number) => {
    const got = Math.max(lo, Math.min(hi, want));
    if (Math.abs(got - want) > 0.05) held = true;
    return got;
  };
  const layers = made.blocks.flatMap((b, i) => {
    const box = slots[i]!.box;
    const boxH = box.maxY - box.minY;
    const align = alignOf(v) ?? slots[i]!.align ?? 'left';
    const x0 = align === 'centre' ? (box.minX + box.maxX) / 2 - b.width / 2 : align === 'right' ? box.maxX - b.width : box.minX;
    const mid = (box.minY + box.maxY) / 2 + OPTICAL_LIFT * boxH;
    const y0 = Math.max(box.minY + b.height / 2, Math.min(box.maxY - b.height / 2, mid));
    const x = dx ? hold(x0 + dx, box.minX, Math.max(box.minX, box.maxX - b.width)) : x0;
    const y = dy ? hold(y0 + dy, box.minY + b.height / 2, Math.max(box.minY + b.height / 2, box.maxY - b.height / 2)) : y0;
    return move(b.layers, x, y);
  });
  // What binds at the size it landed on — the slot and axis whose block now fills its box.
  // The phone and third line came out under the size asked for, yet still readable — under the
  // floor, `letteringWarnings` speaks instead.
  const contactShort = made.contactCap > 0 && made.contactCap < askedContact - 0.1 && made.contactCap >= DETAIL_FLOOR - 1e-6;
  return { layers, nameCap: made.nameCap, smallest: made.smallest, floorsDropped, bound: shrank ? made.bound : null, held, contactShort };
}

/** The status line a card shows: the pattern's own, and — when "Move the text" asked for more
 *  than the clear space has — that the text stopped at its edge. */
export const cardStatus = (pattern: string | undefined, lettering: Lettering): string | undefined =>
  [pattern, lettering.held ? 'Text moved as far as the clear space allows' : '', lettering.contactShort ? 'Phone & third line shrunk to fit' : ''].filter(Boolean).join(' · ') || undefined;

/** A layout's words for a fit that ran out of room: the name shrunk past its floor, or the
 *  details past theirs — each with the fix THIS layout offers for the slot and axis that bound. */
export type FitWords = (what: 'name' | 'details', bound: Bound | null) => string;

/** The words of a layout whose lettering has one column beside the pattern: narrowing the
 *  pattern is the fix either way. */
export const columnWords = (place: string): FitWords => (what) => (what === 'name'
  ? `Name too long for ${place} — shorten it or narrow the pattern.`
  : 'Details too small to read — shorten them or narrow the pattern.');

/** What the lettering says about itself: an empty name asks for one; a name the fit shrank past
 *  the legibility floor says so, and so do details that had to go under 2.5 mm. One sentence,
 *  about whichever line ran out of room: the details, when their floor gave way and shrank the
 *  name with it — unless the name is itself the line too wide for its slot. */
export function letteringWarnings(v: Values, lettering: Lettering, words: FitWords): string[] {
  if (!str(v, 'name').trim()) return [EMPTY_WARNING];
  const { nameCap, smallest, floorsDropped, bound } = lettering;
  const nameShort = nameCap < READABLE_CAP - 1e-6;
  if (floorsDropped && smallest < DETAIL_FLOOR - 1e-6 && !(nameShort && bound?.role === 'name')) return [words('details', bound)];
  return nameShort ? [words('name', bound)] : [];
}

/** The mark a logo TILE carries: the logo, or — none chosen — the name's initials, in the card's
 *  face. The largest that fits `box`, centred in it. */
export async function tileMark(v: Values, box: Box): Promise<DesignLayer[]> {
  const op = (str(v, 'op') || 'engrave') as OpChoice;
  const symbols = readSymbols(v);
  const logo = str(v, 'logo');
  const initials = str(v, 'name').split(/\s+/).map((w) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '').filter(Boolean);
  const mark = initials.length > 1 ? initials[0]! + initials[initials.length - 1]! : initials[0] ?? '';
  const make = (size: number) => (logo
    ? symbolLayer(logo, size, op, { symbols }, 'logo')
    : mark ? textLayer({ text: mark.toUpperCase(), font: str(v, 'font'), size, symbols }, op, 'logo', 'Initials') : Promise.resolve([]));
  const bw = box.maxX - box.minX;
  const bh = box.maxY - box.minY;
  const first = await make(bh);
  const ink = first.flatMap((l) => l.shapes);
  if (!ink.length) return [];
  const b = bboxOf(ink);
  const f = Math.min(bw / (b.maxX - b.minX), bh / (b.maxY - b.minY));
  const layers = Math.abs(f - 1) < 1e-3 ? first : await make(bh * f);
  const fb = bboxOf(layers.flatMap((l) => l.shapes));
  return move(layers, (box.minX + box.maxX) / 2 - (fb.minX + fb.maxX) / 2, (box.minY + box.maxY) / 2 - (fb.minY + fb.maxY) / 2);
}

// ----------------------------------------------------------------------------- the pattern --

/**
 * The first business card's own patterns, from before the picker: an old save still opens as
 * the card it was. `none` switched the band off; the rest are their nearest procedural twins.
 */
const LEGACY_PATTERN: Record<string, string> = { hexagons: 'honeycomb', lattice: 'diamond-lattice', circles: 'dots' };

/** The pattern the card is built with, or null when it has none (an old save's `none`). */
export function cardPattern(v: Values): string | null {
  const id = str(v, 'pattern');
  if (id === 'none') return null;
  return LEGACY_PATTERN[id] ?? id;
}

/** The pattern step, through one call: the region filled for the form's op, with the
 *  card's border as the edge margin and the web held to the card's floor. `own` are the chosen
 *  pattern's own parameters where a layout fixes them (keyed by pattern id, so another pattern
 *  that happens to share a parameter's name is never touched). */
export async function cardPatternLayers(
  region: Shapes, v: Values, dx = 0, own: Record<string, Record<string, number>> = {},
): Promise<{ layers: DesignLayer[]; warnings: string[]; status?: string }> {
  const pattern = cardPattern(v);
  if (!pattern || !region.length) return { layers: [], warnings: [] };
  const web = Math.max(MIN_WEB, num(v, 'web') || WALL);
  const values = { ...v, pattern, margin: BORDER, web, patternX: num(v, 'patternX') + dx };
  const o = { id: 'pattern', kind: 'fill' as const, ...(own[pattern] ? { params: own[pattern] } : {}) };
  const pat = await patternLayers(region, values, o);
  return { layers: pat.layers, warnings: pat.warnings, status: pat.status };
}

/** How far in from the region's edge the pattern's faces stop, mm — see the header. */
export const patternInset = (v: Values): number => Math.max(BORDER, Math.max(MIN_WEB, num(v, 'web') || WALL));

// ------------------------------------------------------------------------------- the build --

/** The card as the engine takes it. A business card is never hung from anything, and
 *  `keyringFrom(v)` with no keyring fields on the form reports an ENABLED 0 mm hole — so the ring
 *  is switched off here, as place-cards does for the same reason. */
export function cardInput(card: Shapes, layers: DesignLayer[], warnings: string[], status?: string): BuildInput {
  return {
    blank: { kind: 'shape', shapes: card },
    keyring: { enabled: false, mode: 'inside', side: 'left', along: 0.5, dia: 4, ring: 2, position: -1 },
    layers,
    ...(warnings.length ? { warnings } : {}),
    ...(status ? { status } : {}),
  };
}

/** The one thing the cut file needs said: a cut pattern's cells fall out of the bed. */
export const cardExportNote = (v: Values): string => (cardPattern(v) && (str(v, 'patternOp') || 'cut') === 'cut'
  ? 'The pattern’s cells cut right through and drop out of the bed, lift the card clear before moving the sheet.'
  : '');

/** The download's name: the customer's, then "card"; the template's id when there is no name. */
export const cardFileName = (id: string) => (v: Values): string => stem(str(v, 'name') || id, 'card');
