// A real month calendar on a keychain tag, the chosen date marked by an engraved heart with the
// day left unburnt inside it, and a small heart charm carrying the initials beside it.
//
// The product IS the specific date, so the form is a date: Month / Day / Year / where the week
// starts. Everything that makes a calendar a calendar is computed from those four — which weekday
// the 1st falls on, whether February has 28 or 29, whether the month needs four rows or six — and
// that is the one thing a static SVG or a hand-edited template cannot do.
//
// Two decisions hold the layout together and are worth reading before changing a number:
//
//  * CELL SIZE IS A PURE FUNCTION OF WIDTH (§2.2). `cellW = (width − 2·margin) / 7`, and the digit
//    size follows from it. Row count does NOT shrink the type — it changes the tag's own HEIGHT
//    (§2.3), so February and a six-row August print the same size digits at the same Size.
//  * THE LOOP IS A TAB, GROWN OFF THE TOP-LEFT CORNER. It used to be a hole punched through that
//    corner, which is why the header and the weekday row both had to dodge a keep-off disc
//    (§2.4's gutter, and the `topPad` that replaced it). The shared Ring control is Loop tab |
//    None now, the disc is outside the body, and both are gone: the tag's face
//    is the calendar's, all of it.
//
// TWO PIECES, TWO MENUS. The file cuts a calendar TAG and a CHARM, and the left rail says so:
// "Tag & grid" is the tag's (its size, where its week starts), "Charm" is the charm's — its
// SHAPE, its mark, its size and its own font. The charm's menu carries the charm's font because
// it is truly the charm's menu, where the user changes its shape and font, and because
// `form.ts` can only spell it one way: a picker is named by
// the category it sits in, and the FIRST font field's section exiles every other left control in
// it to "More options". So the charm's font — declared second — shares its category, and the
// calendar's font, declared first, is a category on its own, called "Calendar font". The rail
// letters a button with its category's first word, so that button reads "Calendar" and its
// tooltip and panel heading read "Calendar font"; the button itself would need one change in
// `form.ts` to read both words.
import { bboxOf, blankById, buildBlank, heartRing, placeShapes, roundedRectRing, type Shapes } from '@vostok/laser';
import { textLayer } from '../engine/text';
import { sizeForCapHeight } from '../engine/metrics';
import { distanceToOutline, finalHoleCentre, fitBoxInside, insideUnion } from '../engine/editorGeometry';
import type { DesignLayer, KeyringSpec, PartInput } from '../engine/types';
import { keyringFields, keyringFrom } from './keyring';
import { fitText, opField, opOf, stem } from './shared';
import { num, str, type TemplateDef } from './types';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const LABEL = (m: number) => MONTHS[m]!.charAt(0).toUpperCase() + MONTHS[m]!.slice(1);

/** Air between the outline and anything printed on it, mm — just above the 3.2 mm floor
 *  for a piece this size. */
const MARGIN = 3.5;
/** Corner radius as a share of the short side. Fixed, not a slider: the grid already supplies
 *  "designed", and a radius control would change nothing about what makes this design itself. */
const CORNER = 0.08;
/** A capital under this stops reading once it is burnt into wood. */
const MIN_CAP = 3;
/**
 * How much of a cell's width the widest two-digit day may take.
 *
 * The design's ratio (`0.448 × cellW`) is a ceiling, not the answer: "00" in Archivo Black is
 * 1.82 × its own cap height, so at that ratio a two-digit day filled 76 % of the cell, "13" and
 * "14" came within 1.9 mm of each other and there was no room left for the heart. Fitting the
 * PAIR instead leaves 30 % of the cell as air — a face whose digits are already narrow (every
 * recommended one) keeps the design's ratio untouched, and a wide one loses size rather than the
 * grid losing its air.
 */
const DIGIT_SHARE = 0.7;
/**
 * Row pitch, as a share of the column width. The design said 0.80 — flat rows, so a six-row month
 * would not balloon. It cannot be: a heart's opening above its point is `H/2 − W/4` deep, so a
 * heart wide enough to hold a two-digit day needs to be about as TALL as it is wide, and at a 0.80
 * pitch there is no such height between one row of numbers and the next. 0.92 is the flattest
 * pitch at which the marked day's heart clears both neighbouring rows (see `heartFor`), and it
 * costs the shipped tag 4 mm of height.
 */
const ROW_PITCH = 0.92;
/** Material between the knocked-out day and the edge of the heart it is knocked out of. */
const HEART_WEB = 0.6;
/** Air between the heart and whatever its own row does not own — the neighbouring days' numbers
 *  and the weekday initials above them. */
const HEART_AIR = 0.4;

// ------------------------------------------------------------------ the calendar --
//
// Kept here rather than in `src/engine/calendar.ts`: one template needs it today,
// and `couple-keychains` — the other candidate — is not built. Promote it when it is.

/** Days in a month, 1-based. The Gregorian leap rule written out, not inferred from a Date. */
export function daysInMonth(month: number, year: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30;
}

/** Day of the week, 0 = Sunday. Sakamoto's method: exact for any Gregorian date, and — unlike a
 *  `Date` — it has no timezone to be wrong about and no two-digit-year trap at the range's end. */
export function weekdayOf(month: number, year: number, day: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month - 1]! + day) % 7;
}

export interface MonthGrid {
  /** How many 7-column rows the month needs: 4, 5 or 6. */
  rows: number;
  /** Which column the 1st lands in, 0-based in the chosen week order. */
  firstIdx: number;
  cells: { day: number; row: number; col: number }[];
}

export function monthGrid(month: number, year: number, firstWeekday: 'monday' | 'sunday'): MonthGrid {
  const js = weekdayOf(month, year, 1);
  const firstIdx = firstWeekday === 'monday' ? (js + 6) % 7 : js;
  const last = daysInMonth(month, year);
  const cells = [];
  for (let day = 1; day <= last; day++) {
    const offset = firstIdx + day - 1;
    cells.push({ day, row: Math.floor(offset / 7), col: offset % 7 });
  }
  return { rows: Math.ceil((firstIdx + last) / 7), firstIdx, cells };
}

/** Tue/Thu share a T and Sat/Sun an S — the planner convention every printed diary uses. */
const WEEKDAYS = (first: 'monday' | 'sunday') =>
  first === 'monday' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------- the charm --

/**
 * The four charms, as library blanks at this design's own proportions.
 *
 * `aspect` is height ÷ width, and `charmSize` is always the LONGEST side, so one slider means
 * the same thing on all four. The tag is the only portrait one: a landscape tag puts the hole's
 * keep-off disc through the middle of the band the initials need (9 mm of disc out of 19 mm of
 * height), and the initials end up at half the size they get on the other three.
 *
 * `corner` is a share of the short side rather than a millimetre count — 3.6 mm on the shipped
 * 26 mm square, and still "designed" rather than a pill at the slider's 40 mm end.
 */
const CHARMS = [
  { value: 'heart', label: 'Heart', blank: 'heart', aspect: 40 / 44, corner: 0 },
  { value: 'round', label: 'Round', blank: 'round', aspect: 1, corner: 0 },
  { value: 'tag', label: 'Tag', blank: 'swing-tag', aspect: 1.3, corner: 0 },
  { value: 'square', label: 'Square', blank: 'coaster-square', aspect: 1, corner: 0.14 },
];

/**
 * The charm's outline and where it hangs from.
 *
 * The heart declares its own hanging point — inside the left lobe, which is what makes it read as
 * a charm rather than a pendant — and the other three do not, so they hang from the top centre
 * with `ring` of material above the hole: the same number `holeMargin` means everywhere else, and
 * on a circle it is exact (the nearest outline point from a hole on the vertical axis IS straight
 * up).
 */
function charmOf(shape: string, size: number, holeDia: number, holeRing: number): { shapes: Shapes; holeAt: [number, number]; label: string } {
  const c = CHARMS.find((x) => x.value === shape) ?? CHARMS[0]!;
  const def = blankById(c.blank)!;
  const w = c.aspect >= 1 ? size / c.aspect : size;
  const h = c.aspect >= 1 ? size : size * c.aspect;
  const params = {
    ...def.defaults,
    width: w, height: h, corner: c.corner * Math.min(w, h),
    holeDia, holeMargin: holeRing, holeSide: 'none' as const, pair: false,
  };
  const shapes = buildBlank(def, params);
  const top = bboxOf(shapes).maxY - (holeDia / 2 + holeRing);
  const at = def.holeAt?.(params) ?? [0, top];
  return { shapes, holeAt: [at[0]!, at[1]!], label: c.label };
}

/** The picker tile: the charm as it will actually cut, in a 40 × 40 box — `blankSilhouette`
 *  draws each blank at ITS defaults, which would show the rounded tag as a 60 × 25 bar and not
 *  as the portrait charm this design builds. */
function charmThumb(shape: string): string {
  const { shapes } = charmOf(shape, 40, 4, 2.5);
  const b = bboxOf(shapes);
  const k = 34 / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const n = (val: number) => val.toFixed(2);
  return shapes.flat().map((r) => `M ${r.map(([x, y]) => `${n(20 + (x - cx) * k)} ${n(20 - (y - cy) * k)}`).join(' L ')} Z`).join(' ');
}

// ------------------------------------------------------------ the mark on the day --

/**
 * The heart the chosen day is knocked out of: the smallest one that holds that day's own ink with
 * `HEART_WEB` of burn all round it, capped by the neighbouring days' numbers.
 *
 * The design asked for a double contour — a heart OUTLINE round the number (§2.5). It cannot be
 * built at this scale, and the arithmetic says so plainly. A heart of width W and height H opens
 * only `H/2 − W/4` above its own centre before the cleft cuts in, and narrows to a 48° wedge below
 * it; to enclose the 3.6 × 3.5 mm box of a two-digit day it has to be about 1.6 × the cell in both
 * directions — wider than the gap to the next day's numbers. An outline that small crosses the
 * digits instead of ringing them, which is exactly what it did: the "1" and the "4" of the shipped
 * default hung out of both sides of it.
 *
 * Filled, with the day reversed out, the constraint is the day's INK rather than its bounding box
 * — a "1" is a stem, not a rectangle — and it fits at about 1.35 × the cell, which the row pitch
 * and the column gaps both allow. It is also the stronger mark: a solid heart with the date left
 * unburnt inside it is what the product is FOR.
 */
function heartFor(ink: Shapes, cellW: number, cellH: number): { w: number; h: number } {
  const b = ink.length ? bboxOf(ink) : { minX: -0.2 * cellW, maxX: 0.2 * cellW, minY: -0.2 * cellH, maxY: 0.2 * cellH };
  const halfW = Math.max(Math.abs(b.minX), Math.abs(b.maxX));
  const halfH = Math.max(Math.abs(b.minY), Math.abs(b.maxY));
  // Stop before the neighbours' own numbers, in both directions.
  const capW = Math.max(cellW, 2 * (cellW - halfW - HEART_AIR));
  const capH = Math.max(cellH, 2 * (cellH - halfH - HEART_AIR));
  const points = ink.flatMap((island) => island.flatMap((ring) => ring));
  let out = { w: Math.min(capW, cellW), h: Math.min(capH, 0.92 * cellW) };
  for (let i = 0; i <= 24; i++) {
    const w = Math.min(capW, (1 + 0.025 * i) * cellW);
    const h = Math.min(capH, 0.92 * w);
    out = { w, h };
    const ring: Shapes = [[heartRing(w, h)]];
    if (points.every((p) => insideUnion(ring, p) && distanceToOutline(ring, p) >= HEART_WEB)) break;
    if (w >= capW && h >= capH) break;
  }
  return out;
}

/** The mark between two initials. The heart is our own `heartRing`, not an icon: the divider is
 *  one filled shape and a parametric one costs nothing, carries no licence and matches the heart
 *  round the day exactly (a Tabler glyph was the first idea; a template cannot reach the curated
 *  SVG catalogue at build time — only an inline symbol the customer inserted resolves there). */
async function dividerToken(kind: string, cap: number, font: string): Promise<Shapes> {
  if (kind === 'heart') return [[heartRing(0.66 * cap, 0.6 * cap)]];
  const built = await textLayer({ text: kind === '+' ? '+' : '&', font, size: await sizeForCapHeight(font, 0.7 * cap) }, 'off');
  return built[0]?.shapes ?? [];
}

/**
 * The initials laid left to right with the divider between every FILLED pair, centred on the
 * origin as one block: "E & J", "E & J & T" with a third, just "E" on its own.
 *
 * The gap is `0.18 × cap` rather than the design's flat 1.6 mm — the same 1.62 mm at the shipped
 * cap of 9, and still air rather than a chasm once the fit has shrunk the row to clear the hole.
 */
async function initialsRow(inits: string[], cap: number, font: string, divider: string): Promise<Shapes> {
  if (!inits.length) return [];
  const size = await sizeForCapHeight(font, cap);
  const gap = 0.18 * cap;
  const tokens: Shapes[] = [];
  for (let i = 0; i < inits.length; i++) {
    if (i) tokens.push(await dividerToken(divider, cap, font));
    const built = await textLayer({ text: inits[i]!, font, size }, 'off');
    tokens.push(built[0]?.shapes ?? []);
  }
  const drawn = tokens.filter((t) => t.length);
  if (!drawn.length) return [];
  const boxes = drawn.map((t) => bboxOf(t));
  const widths = boxes.map((b) => b.maxX - b.minX);
  const total = widths.reduce((a, w) => a + w, 0) + gap * (drawn.length - 1);
  const out: Shapes = [];
  let cursor = -total / 2;
  drawn.forEach((t, i) => {
    const b = boxes[i]!;
    out.push(...placeShapes(t, cursor + widths[i]! / 2 - (b.minX + b.maxX) / 2, -(b.minY + b.maxY) / 2, 0));
    cursor += widths[i]! + gap;
  });
  return out;
}

export const dateKeychain: TemplateDef = {
  id: 'date-keychain',
  name: 'Date keychain',
  blurb: 'A month calendar tag with your date marked, and a charm.',
  tags: ['keychain', 'engrave + cut'],
  // Not a batch design. `batch` promotes ONE text field to a one-per-line list and clones every
  // other setting; here the month, the year, the day and the initials would all have to vary
  // together per line — a different design each time, not this one N times with a name swapped.
  fields: [
    // ------------------------------------------------------------ RIGHT: "Date" --
    {
      kind: 'select', key: 'month', label: 'Month', panel: 'right', section: 'Date', value: 'june',
      options: MONTHS.map((m, i) => ({ value: m, label: LABEL(i) })),
    },
    {
      kind: 'stepper', key: 'day', label: 'Day', panel: 'right', section: 'Date', value: 14, min: 1, max: 31,
      help: 'Clamps to the real last day, so Feb 30 becomes 28.',
    },
    { kind: 'stepper', key: 'year', label: 'Year', panel: 'right', section: 'Date', value: 2026, min: 1950, max: 2099 },

    // ---------------------------------------------- LEFT: "Tag & grid" (opens first) --
    // The tag's own two knobs: how big the month prints, and which column the week starts in.
    // "Week starts on" is a SETTING, not something the customer types, so it belongs here beside
    // the size rather than under the date — and both of them change how
    // the month lays itself out, which is what the category is called after.
    //
    // It was "Calendar grid" until 2026-09-22. The rail letters a button with its category's
    // FIRST WORD (`railLabel`, form.ts), so "Calendar grid" beside the renamed "Calendar font"
    // would have put two buttons reading "Calendar" on one rail. This category is the TAG's, the
    // other is the font's, and now they letter as Tag · Calendar.
    {
      kind: 'number', key: 'size', label: 'Tag size', section: 'Tag & grid', value: 62, min: 45, max: 110, step: 1, unit: 'mm',
      help: 'Sets the width, height follows the month’s own row count.',
    },
    {
      kind: 'select', key: 'firstWeekday', label: 'Week starts on', section: 'Tag & grid', value: 'monday',
      options: [{ value: 'monday', label: 'Monday' }, { value: 'sunday', label: 'Sunday' }],
      help: 'Most of the world starts on Monday, the US on Sunday.',
    },

    // ------------------------------------------------------ LEFT: "Calendar font" --
    {
      // Measured, not guessed. A seven-column grid is 7.9 mm wide a cell at the shipped size, and
      // a two-digit day has to leave room for the heart inside it, so what a face is judged on
      // here is the width of "00" against its own cap height. Every face below is CONDENSED and
      // prints its days at the full 3.5 mm; the design's Archivo Black (1.82 × its cap) and Rubik
      // Mono One (2.17 ×) are both off the list for that — measured in
      // tests/node/date-keychain.test.mjs §6, which fails if a listed face stops fitting.
      //
      // Its own category, and the FIRST font field: `form.ts` folds every other left-panel
      // control declared in the first font field's section into "More options", so this section
      // holds the picker and nothing else.
      //
      // The CATEGORY is the name the customer reads — on the rail, and as the panel's heading —
      // so "Calendar font" is the section, not the label (the button used to read "Font", which
      // is this section's old name). The label stays the generic "Font" precisely so the picker
      // prints nothing above the list: `form.ts` silences that one word, and the heading has
      // already said it.
      // The charm's picker keeps ITS label, because its category is called after the charm.
      kind: 'font', key: 'font', label: 'Font', section: 'Calendar font', value: 'fjalla-one',
      recommended: ['fjalla-one', 'oswald', 'bebas-neue', 'anton', 'khand', 'barlow-condensed'],
      help: 'Day numbers print about 3.5 mm tall, so these faces stay readable.',
      // …and the cards are lettered with the MONTH this tag is about to print. They read "E" —
      // the charm's initial, the first text field on the form — which tells you nothing about a
      // face that has to set "SEPTEMBER 2026" and thirty numbers. The month is
      // a select, so no `previewFrom` can name it: the sample is stated outright, and follows
      // the choice.
      previewText: (v) => LABEL(Math.max(0, MONTHS.indexOf(str(v, 'month')))),
    },

    // ----------------------------------------------------------- RIGHT: "Charm" --
    { kind: 'text', key: 'init1', label: 'Initial 1', panel: 'right', section: 'Charm', value: 'E', maxLength: 1, symbols: false },
    { kind: 'text', key: 'init2', label: 'Initial 2', panel: 'right', section: 'Charm', value: 'J', maxLength: 1, symbols: false },
    {
      kind: 'text', key: 'init3', label: 'Extra initial', panel: 'right', section: 'Charm', value: '', maxLength: 1, symbols: false,
      placeholder: 'Optional', help: 'Leave it blank for two initials.',
    },

    // ------------------------------------------------------------ LEFT: "Charm" --
    // The Charm menu was just the font; now it is truly the charm's menu, where the user changes
    // its shape and font. So: the shape it cuts, the mark between
    // the initials, how big it is, and the face it wears — the whole charm, in one place.
    {
      kind: 'thumbs', key: 'charmShape', label: 'Shape', section: 'Charm', value: 'heart', columns: 4,
      options: CHARMS.map((c) => ({ value: c.value, label: c.label, svgPath: charmThumb(c.value) })),
    },
    {
      kind: 'number', key: 'charmSize', label: 'Charm size', section: 'Charm', value: 26, min: 24, max: 40, step: 1, unit: 'mm',
      help: '24 mm fits two initials, about 30 mm fits three.',
    },
    {
      // A picked mark, not typed text, so it is a setting — and it is the charm's, so it is here
      // rather than on the right between the two letters it sits between.
      kind: 'select', key: 'divider', label: 'Between', section: 'Charm', value: '&',
      options: [{ value: '+', label: '+' }, { value: '&', label: '&' }, { value: 'heart', label: 'Heart' }],
      help: 'Sits between every initial, as in “E & J”.',
    },
    {
      kind: 'font', key: 'charmFont', label: 'Charm font', section: 'Charm', value: 'playfair-display',
      recommended: ['playfair-display', 'libre-baskerville', 'dela-gothic-one', 'archivo-black', 'dancing-script', 'pacifico'],
      help: 'The charm can wear its own face, a serif or script.',
    },

    // -------------------------------------------------------- LEFT: "Keyring" --
    // Loop tab or nothing. The border stops at 4 mm rather than the shared 8: the charm wears
    // this same hole punched through it, and at 8 mm the disc it keeps clear is 20 mm across —
    // most of a 26 mm charm (G25).
    ...keyringFields('outside', {
      dia: 4, ring: 2.5, side: 'top', along: 9, nudge: 31, maxDia: 6, maxRing: 4,
      ringNote: 'Grows a tab, and sets the charm’s own hole to match.',
    }),

    // --------------------------------------------------- LEFT: "More options" --
    // Engrave is what nineteen customers in twenty want on a calendar, so neither of these earns
    // a category of its own on a rail that should read Calendar · Font · Charm · Keyring · More.
    { ...opField('Finish', 'engrave', 'Calendar letters', { help: 'The heart behind the chosen day always engraves, whatever this says.' }), advanced: true },
    { ...opField('Finish', 'engrave', 'Charm letters', { key: 'charmOp' }), advanced: true },
  ],

  async build(v) {
    const warnings: string[] = [];
    const monthIdx = Math.max(0, MONTHS.indexOf(str(v, 'month')));
    const month = monthIdx + 1;
    const year = Math.round(num(v, 'year'));
    const last = daysInMonth(month, year);
    const asked = Math.round(num(v, 'day'));
    const day = clamp(asked, 1, last);
    if (day !== asked) warnings.push(`${LABEL(monthIdx)} ${year} has no ${asked} — showing ${day} instead.`);

    const first = str(v, 'firstWeekday') === 'sunday' ? 'sunday' : 'monday';
    const grid = monthGrid(month, year, first);
    const op = opOf(v);
    const font = str(v, 'font');
    const keyring = keyringFrom(v);
    const holeDia = num(v, 'holeDia');
    const holeRing = num(v, 'holeRing');

    // ------------------------------------------------------- the tag's proportions (§2.2/§2.3) --
    const width = num(v, 'size');
    const cellW = (width - 2 * MARGIN) / 7;
    const cellH = ROW_PITCH * cellW;
    // The design's ratio is the ceiling; what this face's own two-digit days need is the answer
    // (DIGIT_SHARE). The header and the weekday row keep the design's ratio either way, so the
    // tag's HEIGHT — the thing the customer sees change with the month — is untouched by it.
    const ratioCap = 0.448 * cellW;
    const pairWidth = bboxOf((await textLayer({ text: '00', font, size: await sizeForCapHeight(font, 1) }, 'off'))[0]?.shapes ?? [[[[0, 0], [1.7, 0], [1.7, 1]]]]);
    const dayCap = Math.min(ratioCap, (DIGIT_SHARE * cellW) / Math.max(0.8, pairWidth.maxX - pairWidth.minX));
    const weekdayCap = 0.7 * ratioCap;
    const headerCap = 1.2 * ratioCap;
    const headerBox = 1.05 * headerCap;
    const weekdayBox = 1.05 * weekdayCap;
    const gap1 = 0.25 * cellH;

    // Every number built once, centred on the origin, and placed into its cell below: the heart's
    // size comes from the chosen day's own ink, and the weekday row's clearance comes from the
    // heart, so both have to be known before the tag's height can be.
    const daySize = await sizeForCapHeight(font, dayCap);
    const built = await Promise.all(grid.cells.map((cell) => textLayer({ text: String(cell.day), font, size: daySize }, op)));
    if (dayCap < MIN_CAP) {
      warnings.push(`Day numbers are only ${dayCap.toFixed(1)} mm tall — under ${MIN_CAP} mm stops reading once engraved. Raise Size.`);
    }

    // ------------------------------------------------------- the heart behind the day (§2.5) --
    const chosen = grid.cells.findIndex((c) => c.day === day);
    const dayInk = built[chosen]?.[0]?.shapes ?? [];
    const heart = heartFor(dayInk, cellW, cellH);
    // The heart reaches above its own row, so the weekday letters step back by whatever it takes
    // to stay off it. At the shipped size that is the design's own 0.15 × cellH; a face with tall
    // digits buys a fraction of a millimetre more.
    const gap2 = Math.max(0.15 * cellH, heart.h / 2 - cellH / 2 + HEART_AIR);

    // The loop is a TAB now, so its hole is outside the body and the grid owes
    // it nothing: the `topPad` that used to push the weekday row clear of a punched hole's
    // keep-off disc is gone with the hole, and the tag is the sum of its own bands again.
    const height = 2 * MARGIN + headerBox + gap1 + weekdayBox + gap2 + grid.rows * cellH;
    const tag: Shapes = [[roundedRectRing(width, height, CORNER * Math.min(width, height), 12)]];

    const gridLeft = -(width - 2 * MARGIN) / 2;
    const gridTop = height / 2 - MARGIN - headerBox - gap1 - weekdayBox - gap2;
    const colX = (col: number) => gridLeft + (col + 0.5) * cellW;
    const rowY = (row: number) => gridTop - (row + 0.5) * cellH;

    // ------------------------------------------------------------------ the header (§2.4) --
    // Centred over the grid, and fitted: at the shipped Size "JUNE 2026" and "SEPTEMBER 2026"
    // both sit at full size, and a narrower tag shrinks the longest months until they clear the
    // edge. The design asked for a 13 mm top-left gutter instead — that centres every header
    // 4.8 mm right of the grid it heads, which reads as a mistake on the months that did not
    // need it, and with the loop a tab there is nothing on the face to dodge anyway.
    const headerLayers = await fitText(
      { text: `${LABEL(monthIdx).toUpperCase()} ${year}`, font, size: await sizeForCapHeight(font, headerCap), y: height / 2 - MARGIN - headerBox / 2 },
      op, tag, keyring, 'header', 'Month and year', { inset: 3, minCap: 2 },
    );
    const headerInk = headerLayers.length ? bboxOf(headerLayers.flatMap((l) => l.shapes)) : null;
    if (headerInk && headerInk.maxY - headerInk.minY < 2) {
      warnings.push(`“${LABEL(monthIdx).toUpperCase()} ${year}” only fits at ${(headerInk.maxY - headerInk.minY).toFixed(1)} mm tall here — raise Size.`);
    }

    // ------------------------------------------------------------ the weekday row (§2.4) --
    const weekdaySize = await sizeForCapHeight(font, weekdayCap);
    const weekdayY = gridTop + gap2 + weekdayBox / 2;
    const weekdayShapes = (
      await Promise.all(WEEKDAYS(first).map((letter, col) => textLayer({ text: letter, font, size: weekdaySize, x: colX(col), y: weekdayY }, op)))
    ).flatMap((b) => b[0]?.shapes ?? []);

    // --------------------------------------------------------------- the day grid (§2.4) --
    // The chosen day is left OUT of this layer: it is knocked out of the heart instead, so it
    // reads light on the burn rather than being engraved twice over.
    const dayShapes = built.flatMap((b, i) =>
      i === chosen ? [] : placeShapes(b[0]?.shapes ?? [], colX(grid.cells[i]!.col), rowY(grid.cells[i]!.row), 0));

    const layers: DesignLayer[] = [
      ...headerLayers,
      ...(weekdayShapes.length ? [{ id: 'weekdays', label: 'Weekday row', shapes: weekdayShapes, op }] : []),
      ...(dayShapes.length ? [{ id: 'days', label: 'Day numbers', shapes: dayShapes, op }] : []),
    ];
    if (chosen >= 0) {
      const cx = colX(grid.cells[chosen]!.col);
      const cy = rowY(grid.cells[chosen]!.row);
      layers.push({
        id: 'day-heart', label: 'Heart', op: 'engrave',
        shapes: placeShapes([[heartRing(heart.w, heart.h)]], cx, cy, 0),
        minus: placeShapes(dayInk, cx, cy, 0),
      });
    }

    // ------------------------------------------------------------------ the charm (§2.7) --
    // Four shapes, one size slider, one font — the Charm category is the charm.
    const charm = charmOf(str(v, 'charmShape'), num(v, 'charmSize'), holeDia, holeRing);
    const charmShapes = charm.shapes;
    const charmBody = bboxOf(charmShapes);
    const charmW = charmBody.maxX - charmBody.minX;
    const charmH = charmBody.maxY - charmBody.minY;
    // The shape's own hanging point — the heart's left lobe, the top centre of the other three.
    // The charm's hole is never gated by the tag's Ring control and never drags: its only job is
    // to dangle (§9). `mode: 'inside'` below is the ENGINE's word for a hole punched through a
    // part, which is exactly what this is — the design's own hanging point, decided by the shape.
    // It is not the Ring control's withdrawn "Hole": nothing the customer touches writes it.
    const charmHoleAt = charm.holeAt;
    const charmRing: KeyringSpec = {
      enabled: true, mode: 'inside', side: 'top', along: 0.25, dia: holeDia, ring: holeRing,
      position: -1, dx: 0, dy: 0, rest: [charmHoleAt[0], charmHoleAt[1]],
    };

    const charmOp = opOf(v, 'charmOp');
    const charmFont = str(v, 'charmFont');
    const inits = ['init1', 'init2', 'init3'].map((k) => Array.from(str(v, k).trim())[0] ?? '').filter(Boolean);
    const charmLayers: DesignLayer[] = [];
    if (inits.length) {
      const cap0 = Math.min(9, 0.42 * charmH);
      const row0 = await initialsRow(inits, cap0, charmFont, str(v, 'divider'));
      const box = bboxOf(row0);
      const half: [number, number] = [(box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2];
      const disc = { centre: [charmHoleAt[0], charmHoleAt[1]] as [number, number], radius: holeDia / 2 + holeRing };
      // The shared `fitPlan` is the wrong instrument here: its last resort is to keep the size the
      // OUTLINE allows and let the engine warn that the ring sits on the lettering, which on a
      // heart with a hole in one lobe is most of the time. The row must clear the hole, so the
      // search is over places it can go — high first, because a heart carries its weight in the
      // lobes and a row sitting on the point reads as falling out of it. The same sweep serves
      // the other three: on a round, tag or square charm the hole is at the top centre, so the
      // band that clears it is the lower two-thirds, which these candidates cover. 2.4 mm of
      // edge, not the house 4: the heart's point is a 48° wedge and three millimetres measured
      // off it costs more of the face than the lettering it protects (the pet tag's bone-waist
      // exemption, same argument).
      let best = { k: 0, x: 0, y: 0 };
      for (let iy = 0; iy <= 8; iy++) {
        for (let ix = 0; ix <= 8; ix++) {
          const at: [number, number] = [(-0.24 + 0.06 * ix) * charmW, (0.14 - 0.055 * iy) * charmH];
          const k = fitBoxInside(charmShapes, at, half, 2.4, disc);
          if (k > best.k + 0.015) best = { k, x: at[0], y: at[1] };
        }
      }
      const cap = cap0 * best.k;
      const shapes = placeShapes(await initialsRow(inits, cap, charmFont, str(v, 'divider')), best.x, best.y, 0);
      if (shapes.length) charmLayers.push({ id: 'initials', label: 'Initials', shapes, op: charmOp });
      if (cap < MIN_CAP - 0.05) {
        warnings.push(`The initials only fit at ${cap.toFixed(1)} mm on this charm — under ${MIN_CAP} mm they stop reading once engraved. Raise Charm size, or drop one.`);
      }
    } else {
      warnings.push('No initials typed — the charm cuts plain.');
    }

    // Where the pair sits once it is off the bed: side by side on one ring, the charm's own hole
    // level with the tag's, rather than the 6 mm apart the sheet cuts them. Two flat pieces are
    // never a glued stack, so this is the photograph rather than an assembly (§2.8, G23).
    const tagHole = keyring.enabled ? finalHoleCentre(tag, keyring).centre : ([gridLeft, height / 2 - MARGIN] as [number, number]);
    const charmPart: PartInput = {
      id: 'charm',
      label: `${charm.label} charm`,
      blank: { kind: 'shape', shapes: charmShapes },
      layers: charmLayers,
      keyring: charmRing,
      assembledAt: {
        x: -width / 2 - 2 - charmW / 2,
        y: tagHole[1] - charmHoleAt[1],
      },
      material: 'light',
    };

    return {
      label: 'Calendar tag',
      blank: { kind: 'shape', shapes: tag },
      keyring,
      layers,
      parts: [charmPart],
      layout: { flow: 'row', gap: 6 },
      ...(warnings.length ? { warnings } : {}),
    };
  },

  exportNote: (v) => `A ${num(v, 'holeDia')} mm jump ring links the tag and charm, then add your own split ring.`,
  fileName: (v) => stem('date', str(v, 'month'), String(Math.round(num(v, 'day'))), String(Math.round(num(v, 'year')))),
};
