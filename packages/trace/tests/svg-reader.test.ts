/*
  The SVG reader's winding: which rings come out as shapes and which as holes.

  The rings are filled non-zero downstream (the clicker builds with one), so the direction a
  ring is wound IS the answer to "solid or hole". Two things went wrong in the reader's pooled
  line drawings, and this pins both:

   1. A line that stays open was filled even-odd together with the loops, so a check mark drawn
      inside a circle came out wound against the circle: filled, the mark was cut out of the disc
      instead of adding to it. It is a shape of its own now, wound like every other shape.
   2. A loop joined from loose lines went into the hole test without its last edge, so a slot
      could come out wound with its panel instead of against it.

  The cut-file case, where the even-odd fill of loops is the point (a slot drawn inside a panel
  is a hole in it), must keep working, so it is here too.

    pnpm --filter @vostok/trace test
*/
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
const { parseSvg } = await import('../src/logo');

type Ring = [number, number][];

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** Signed shoelace area: one sign for a shape, the other for a hole. */
const signed = (r: Ring): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};
const ringsOf = (set: ReturnType<typeof parseSvg>): Ring[] =>
  set.regions.flatMap((r) => r.components.flatMap((c) => c.rings));
/** The area a non-zero fill paints, when nothing overlaps: holes count against. */
const area = (set: ReturnType<typeof parseSvg>): number => Math.abs(ringsOf(set).reduce((s, r) => s + signed(r), 0));
const signs = (set: ReturnType<typeof parseSvg>): string => ringsOf(set).map((r) => (signed(r) > 0 ? '+' : '-')).join('');
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
const line = (d: string) => `<path d="${d}" fill="none" stroke="#000" stroke-width="2"/>`;

// ---------------------------------------------------------------- an outline drawing

/** A circle and a check mark inside it, both drawn as strokes: the usual icon upload. */
const checkInCircle = svg(`<circle cx="50" cy="50" r="34" fill="none" stroke="#000" stroke-width="2"/>${line('M32 50 L48 66 L72 38')}`);
const strokes = parseSvg(checkInCircle);
const filled = parseSvg(checkInCircle, { fillStrokes: true });
const mixed = parseSvg(checkInCircle, { overrides: { 0: { mode: 'fill' }, 1: { mode: 'outline' } } });

const [disc, mark] = ringsOf(filled);
check(
  'filled, the check mark is wound like the circle it sits in',
  ringsOf(filled).length === 2 && Math.sign(signed(disc)) === Math.sign(signed(mark)),
  `ring signs ${signs(filled)} (a hole would be wound the other way)`,
);
check(
  '…so it adds to the disc instead of cutting a hole in it',
  near(area(filled), Math.abs(signed(disc)) + Math.abs(signed(mark))),
  `filled area ${area(filled).toFixed(4)} = disc ${Math.abs(signed(disc)).toFixed(4)} + mark ${Math.abs(signed(mark)).toFixed(4)}`,
);
check(
  'one outline filled while another stays an outline: more than both outlines, less than both filled',
  area(strokes) * 3 < area(mixed) && area(mixed) < area(filled),
  `outlines ${area(strokes).toFixed(4)} < mixed ${area(mixed).toFixed(4)} < filled ${area(filled).toFixed(4)}`,
);
check(
  'and in the mixed file every ring is a shape: the outline sits on the disc, it is not cut out of it',
  /^(\+*|-*)$/.test(signs(mixed)),
  `ring signs ${signs(mixed)}`,
);

const ribbon = ringsOf(strokes)
  .map((r) => signed(r))
  .sort((a, b) => Math.abs(b) - Math.abs(a));
check(
  'a closed outline is a strip: its inner edge is wound against its outer one',
  ribbon.length === 3 && Math.sign(ribbon[0]) !== Math.sign(ribbon[1]),
  `outer ${ribbon[0].toFixed(4)}, inner ${ribbon[1].toFixed(4)}`,
);

// Three arcs inside each other, none closed and none touching: filled, each closes on itself.
const arcs = svg([
  'M90 70 A40 40 0 0 0 10 70', 'M75 70 A25 25 0 0 0 25 70', 'M60 70 A10 10 0 0 0 40 70',
].map(line).join(''));
const arcsFilled = parseSvg(arcs, { fillStrokes: true });
check(
  'arcs drawn inside each other fill as three shapes wound alike, not as bands',
  ringsOf(arcsFilled).length === 3 && /^(\+*|-*)$/.test(signs(arcsFilled)),
  `ring signs ${signs(arcsFilled)}`,
);

// An outline drawn as one open path with a gap, a line through the gap and a chevron inside.
// Filled even-odd together, the outline came out wound as a hole and the chevron was cut out.
const gap = svg(line('M10 40 V10 H90 V90 H10 V60') + line('M0 50 H50') + line('M40 65 L50 50 L40 35'));
const gapFilled = parseSvg(gap, { fillStrokes: true });
check(
  'an outline left open is still a shape when other lines cross its gap',
  ringsOf(gapFilled).length === 2 && /^(\+*|-*)$/.test(signs(gapFilled)),
  `${ringsOf(gapFilled).length} rings, signs ${signs(gapFilled)}`,
);

// ---------------------------------------------------------------- a cut file of loose lines

/* A panel 80 × 60 and a 6 × 20 slot inside it, every edge its own path, the way a box generator
   writes a cut file; and an open V inside the panel that closes on nothing. */
const panel = svg([
  'M10 20 H90', 'M90 20 V80', 'M90 80 H10', 'M10 80 V20',
  'M30 40 H36', 'M36 40 V60', 'M36 60 H30', 'M30 60 V40',
].map(line).join('') + line('M55 35 L65 60 L75 35'));
const cut = parseSvg(panel, { fillStrokes: true });
const [board, slot, vee] = ringsOf(cut);
// Normalised by the longest side, 80.
const expected = (80 * 60 - 6 * 20 + (20 * 25) / 2) / (80 * 80);
check(
  'a slot drawn as loose lines inside a panel of loose lines is a hole in it',
  ringsOf(cut).length === 3 && Math.sign(signed(slot)) !== Math.sign(signed(board)),
  `panel ${signed(board).toFixed(4)}, slot ${signed(slot).toFixed(5)}`,
);
check(
  'a line that stays open inside the panel is a shape of its own, wound with the panel',
  Math.sign(signed(vee)) === Math.sign(signed(board)),
  `V ${signed(vee).toFixed(5)}`,
);
check(
  'so the panel paints its area, less the slot, plus the V',
  near(area(cut), expected),
  `${area(cut).toFixed(6)} (expected ${expected.toFixed(6)})`,
);

console.log(failures ? `\n${failures} FAILED` : '\nthe SVG reader winds every shape one way and every hole the other');
process.exit(failures ? 1 : 0);
