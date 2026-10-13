// What the four cards adapted from Laser Studio's card designs share: the Dahlia burst, registered as
// a pattern of this app's own, the keyline where a pattern meets solid card, and the contact lines
// of a card too narrow to hold an email on one line.
import { strokeRing } from '@vostok/laser/blanks';
import { circle, num, number, registerPatterns, resolveParams, type PatternDef, type Polyline, type Pt } from '@vostok/patterns';
import type { Box, Shapes } from '@vostok/shapes';
import type { Ctx, On } from '../build';
import { boxH, boxW } from '../layout';
import { FLOORS } from '../lockup';
import type { Ink, PatternPart } from '../types';

// ---------------------------------------------------------------------------------- Dahlia --

/** How far a box reaches from the origin: the burst is drawn out to there. */
const reach = (b: { minX: number; minY: number; maxX: number; maxY: number }): number =>
  Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.maxX, b.minY), Math.hypot(b.maxX, b.maxY), Math.hypot(b.minX, b.maxY));

/** Points per edge of the tessellation: an edge is a bowed spiral arc. */
const STEPS = 10;

/**
 * Dahlia: pointed petals in rings round one point, each ring turned half a petal against the ring
 * inside it and every petal a size up. Laser Studio's half card draws it for a cut; this is the same
 * drawing set for a print.
 *
 * It is a LINE pattern: the lines are a tessellation drawn in log-polar space, (ln r, θ). A plain
 * grid of staggered diamonds there becomes petals that grow with their distance from the centre and
 * keep their shape, because a step along ln r is the same step in proportion anywhere. Every edge is
 * bowed into the petal whose inner half it is, so each petal is narrow where it starts and full
 * where it ends.
 *
 * What changed for a print: more petals to a ring (a card shows a quarter or a half of the burst, not
 * all of it), and a heart big enough that the first ring of petals holds a groove and a ridge a
 * nozzle prints (at the laser card's 4 mm heart the first petals are narrower than two lines). The
 * heart is ringed by a line of its own, so carved or in colour the petals stand on a circle rather
 * than fraying into it; cut through, the heart stays solid and every strut lands on it.
 */
export const BC_DAHLIA: PatternDef = {
  id: 'bc-dahlia',
  name: 'Dahlia',
  family: 'radial',
  tags: ['lines', 'flower', 'petals', 'burst', 'radial', 'floral'],
  blurb: 'Pointed petals ring on ring from one centre, a dahlia in bloom.',
  ops: ['score', 'engrave'],
  params: [
    number('count', 'Petals', 24, 8, 48, 1, ''),
    number('length', 'Petal length', 2.2, 1.2, 4, 0.1, '×'),
    number('bulge', 'Fullness', 0.3, 0, 0.6, 0.05, ''),
    number('inner', 'Heart', 6, 1, 50, 0.5),
  ],
  thumb: { params: { inner: 2 } },
  generate: (box, p) => {
    const n = Math.round(num(p, 'count'));
    const w = Math.PI / n;
    const h = num(p, 'length') * w;
    const bulge = num(p, 'bulge');
    const r0 = Math.max(0.5, num(p, 'inner'));
    const u0 = Math.log(r0);
    const top = Math.max(1, Math.ceil((Math.log(reach(box) + 1) - u0) / h));
    // (U, V) are the grid's own units: a diamond's centre sits on integers with U + V even, its
    // corners on the integers with U + V odd, so every line runs through corners only.
    const at = (U: number, V: number): Pt => {
      const r = Math.exp(u0 + U * h);
      return [r * Math.cos(V * w), r * Math.sin(V * w)];
    };
    const lines: Polyline[] = [];
    // Two families of lines, V = dir·(U − c) for every odd c round the circle. Each edge bows
    // `bulge` of the way toward the centre of the petal whose inner half it is, the same way on
    // every edge of a line, so a line is scalloped.
    for (const dir of [-1, 1]) {
      for (let c = 1; c < 2 * n; c += 2) {
        const run: Polyline = [];
        for (let m = 0; m < top; m++) {
          for (let s = m ? 1 : 0; s <= STEPS; s++) {
            const U = m + s / STEPS;
            const b = 0.5 * bulge * Math.sin((Math.PI * s) / STEPS);
            run.push(at(U + b, dir * (U - c - b)));
          }
        }
        lines.push(run);
      }
    }
    // The heart's ring, closed, and the heart itself as a solid for a cut to land its struts on.
    const ring = circle(0, 0, r0, 96);
    lines.push([...ring, ring[0]!]);
    return { holes: [], lines, slits: [], solids: [[circle(0, 0, r0 / Math.cos(Math.PI / 96), 96)]] };
  },
};

registerPatterns([BC_DAHLIA]);

/**
 * The Dahlia's own parameters for a burst whose petals stop `reach` from its centre, when the Dahlia
 * is the pattern chosen. Every line of it runs through the grid's corners, and the corners of one
 * ring all lie on one circle, so a burst whose edge is that circle ends in a row of whole petal tips
 * rather than lines stopping wherever the edge cuts them: the heart is set so a ring lands on
 * `reach`, near the `heart` the template would like (zoom makes the petals, so the heart, bigger)
 * and with at least `rings` rings out to the edge.
 */
export function dahliaFit(ctx: Ctx, heart: number, reach: number, rings: number): Record<string, number> | undefined {
  if (ctx.s.pattern !== BC_DAHLIA.id) return undefined;
  const p = resolveParams(BC_DAHLIA, {});
  const step = (num(p, 'length') * Math.PI) / Math.round(num(p, 'count'));
  const scale = ctx.s.patternZoom / 100;
  const k = Math.max(rings, Math.round(Math.log(reach / (heart * scale)) / step));
  return { inner: reach / Math.exp(k * step) / scale };
}

// -------------------------------------------------------------------------------- keylines --

/** A keyline's width, mm: a printed stroke's. */
export const KEY = 0.8;

/**
 * A line along the edges where a pattern meets solid card inside the card. There the pattern's lines
 * stop wherever the edge cuts them; on the line they end on something, as a cut lattice's struts end
 * on the solid card, and the solid part reads as a shape rather than a clearing. A run of two points
 * (a straight edge) is carried half a line past both ends, so two runs meeting at a corner close it
 * square; a longer run (round a curve) is stroked as it is.
 */
export function keyline(runs: Pt[][]): Shapes {
  const half = KEY / 2;
  return runs.map((r) => {
    if (r.length !== 2) return [strokeRing(r, KEY)];
    const [a, b] = r as [Pt, Pt];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / d;
    const uy = (b[1] - a[1]) / d;
    return [strokeRing([[a[0] - ux * half, a[1] - uy * half], [b[0] + ux * half, b[1] + uy * half]], KEY)];
  });
}

/** How a keyline is made on this side: as the pattern is, in its colour or carved with it, and not at
 *  all where the pattern is cut through, as the card's own solid edge is the line there. A back's
 *  pattern is always in colour. */
export function keylineOn(ctx: Ctx, pattern: PatternPart | null, shapes: Shapes): { ink: Ink[]; carved: Shapes } {
  if (!pattern || !shapes.length || pattern.mode === 'cut') return { ink: [], carved: [] };
  if (pattern.mode === 'carved') return { ink: [], carved: shapes };
  return { ink: [{ role: 'pattern', colour: ctx.colour('pattern'), shapes }], carved: [] };
}

// ---------------------------------------------------------------------------- plain lines --

/** Baseline to baseline: between two lines, and between the two halves of a broken email, as a
 *  share of the cap. The halves sit closer, so they read as one line carried over. */
const LINE_PITCH = 1.9;
const CARRY_PITCH = 1.45;
/** How far a line reaches under its baseline, a share of the cap (descenders). */
const DESCENT = 0.3;

/** What the lettering engine calls each line when it is too long. */
const TOO_LONG: Record<string, string> = { company: 'company name', phone: 'phone number', email: 'email', web: 'website' };

type PlainLine = { role: string; text: string };
type PlainRow = PlainLine & { carried: boolean };

/** The smallest capitals plain lines are set at on a side: the raised floor only on a raised card's
 *  front. */
const plainFloor = (ctx: Ctx, side: 'front' | 'back') => FLOORS[side === 'front' && ctx.s.raise > 1e-6 ? 'raised' : 'flush'].detail;

/** The rows lines are set in, in a box `width` wide: each as typed, the blank ones left out, and an
 *  email that cannot fit at `floor` broken before its "@". */
function plainRows(ctx: Ctx, lines: PlainLine[], width: number, floor: number): PlainRow[] {
  const fitsAt = (text: string) => width / Math.max(1e-9, ctx.measure(text)) >= floor - 1e-6;
  return lines.filter((l) => l.text.trim()).flatMap((l) => {
    const r: PlainRow = { role: l.role, text: l.text.trim(), carried: false };
    const at = r.role === 'email' ? r.text.lastIndexOf('@') : -1;
    if (at <= 0 || fitsAt(r.text)) return [r];
    // Before the "@" only: the second half then reads as the address carried on. Broken after it,
    // the domain stands alone and reads as a second website over the real one.
    return [{ ...r, text: r.text.slice(0, at) }, { ...r, text: r.text.slice(at), carried: true }];
  });
}

/** How wide `plainLines` needs its box to set these lines at the floor of `side`, where it would be
 *  given `width`: its widest row, once an email too long for `width` is broken. */
export function plainNeed(ctx: Ctx, lines: PlainLine[], width: number, side: 'front' | 'back' = ctx.side): number {
  const floor = plainFloor(ctx, side);
  return Math.max(0, ...plainRows(ctx, lines, width, floor).map((r) => ctx.measure(r.text) * floor));
}

/**
 * Lines set one under another as plain lines, for a card too narrow for the lettering engine's
 * contact block: a portrait card is 50 to 55 mm across, and an email of twenty letters is 53 mm at
 * the raised floor even without its icon, so it cannot stand on one line anywhere on it.
 *
 * All the lines take one size, the details' size or less where the box's width or height needs it,
 * never under the face's floor; an email still too wide is broken before its "@", the second half
 * kept close under the first. A line that cannot fit even so is left out and says so in the
 * lettering's own words. No icons: the engine's icons belong to its lockup.
 */
export function plainLines(ctx: Ctx, box: Box, lines: PlainLine[], o: { align?: 'left' | 'centre' | 'right'; on?: On } = {}): Ink[] {
  const floor = plainFloor(ctx, ctx.side);
  const asked = Math.max(floor, ctx.s.detailSize);
  const width = boxW(box);
  let rows = plainRows(ctx, lines, width, floor);
  const capFor = (r: PlainRow[]) => Math.min(asked, ...r.map((x) => width / Math.max(1e-9, ctx.measure(x.text))));
  const fitsAt = (text: string) => width / Math.max(1e-9, ctx.measure(text)) >= floor - 1e-6;
  // What still cannot fit at the floor says so, and is left out.
  for (const role of new Set(rows.filter((r) => !fitsAt(r.text)).map((r) => r.role))) {
    ctx.warn(`The ${TOO_LONG[role] ?? role} is too long to print readably here. Shorten it, or try another template.`);
    rows = rows.filter((r) => r.role !== role);
  }
  if (!rows.length) return [];
  // The block's height from the first cap line to the last line's descenders, a share of the cap:
  // the lines give way to the box's height as they do to its width, down to the floor.
  const tall = 1 + rows.slice(1).reduce((a, r) => a + (r.carried ? CARRY_PITCH : LINE_PITCH), 0) + DESCENT;
  const cap = Math.max(floor, Math.min(capFor(rows), boxH(box) / tall));
  const pitches = rows.slice(1).map((r) => (r.carried ? CARRY_PITCH : LINE_PITCH) * cap);
  const height = cap * tall;
  if (height > boxH(box) + 1e-6) ctx.warn('Too many lines to print readably here. Leave one out, or try another template.');
  let base = (box.minY + box.maxY) / 2 + height / 2 - cap;
  const ink: Ink[] = [];
  rows.forEach((r, i) => {
    if (i) base -= pitches[i - 1]!;
    // `label` centres the capitals in its box: a box round this baseline puts them on it.
    const line = ctx.label(r.text, { minX: box.minX, maxX: box.maxX, minY: base - 1, maxY: base + cap + 1 }, { cap, align: o.align ?? 'centre', ...(o.on ? { on: o.on } : {}) });
    if (line) ink.push(line);
  });
  return ink;
}
