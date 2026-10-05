/*
  The SVG reader's two readings of a filled stroke drawing, and which rings they wind as holes.

  By default a stroke drawing is read as a cut file is: lines that meet end to end are joined
  across paths and the loops filled even-odd, so a slot drawn inside a panel is a hole in it.
  The apps that read it that way re-nest the rings by containment, and they must get exactly
  the rings they always had, so the default is pinned here ring for ring.

  `asPainted` reads every path on its own, the way a browser paints it, for a caller that fills
  the rings non-zero (the clicker), where a ring's direction decides solid or hole. Read as a
  cut file there, a check mark drawn inside a circle, both filled, was wound against the circle
  and cut out of it; nested circles came out as a bullseye; and an outline that crosses itself,
  an infinity sign, came out as filled blobs.

    pnpm --filter @vostok/trace test
*/
import { DOMParser } from '@xmldom/xmldom';
import { Command, Infinity as InfinityIcon, ListChecks, type IconNode } from 'lucide';
(globalThis as any).DOMParser = DOMParser;
const { parseSvg } = await import('../src/logo');

type Ring = [number, number][];
type Options = Parameters<typeof parseSvg>[1];

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
/** Every ring in order, by its signed area: what a non-zero fill makes of the trace. */
const signature = (set: ReturnType<typeof parseSvg>): string => ringsOf(set).map((r) => signed(r).toFixed(4)).join(' ');
const alike = (set: ReturnType<typeof parseSvg>): boolean => /^(\+*|-*)$/.test(signs(set));
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;
const line = (d: string) => `<path d="${d}" fill="none" stroke="#000" stroke-width="2"/>`;
const ring = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#000" stroke-width="2"/>`;

/** A circle and a check mark inside it, both drawn as strokes: the usual icon upload. */
const checkInCircle = svg(ring(50, 50, 34) + line('M32 50 L48 66 L72 38'));
/** Three arcs inside each other, none closed and none touching. */
const arcs = svg(['M90 70 A40 40 0 0 0 10 70', 'M75 70 A25 25 0 0 0 25 70', 'M60 70 A10 10 0 0 0 40 70'].map(line).join(''));
/** Three circles inside each other. */
const target = svg(ring(50, 50, 40) + ring(50, 50, 24) + ring(50, 50, 8));
/** An outline drawn as one open path with a gap, a line through the gap and a chevron inside. */
const gap = svg(line('M10 40 V10 H90 V90 H10 V60') + line('M0 50 H50') + line('M40 65 L50 50 L40 35'));
/** A panel 80 × 60 and a 6 × 20 slot inside it, every edge its own path, the way a box generator
 *  writes a cut file; and an open V inside the panel that closes on nothing. */
const panel = svg([
  'M10 80 V20', 'M10 20 H90', 'M90 20 V80', 'M90 80 H10',
  'M30 40 H36', 'M36 40 V60', 'M36 60 H30', 'M30 60 V40',
].map(line).join('') + line('M55 35 L65 60 L75 35'));

const fill: Options = { fillStrokes: true };
const mixedChoice: Options = { overrides: { 0: { mode: 'fill' }, 1: { mode: 'outline' } } };

// ---------------------------------------------------------------- default: read as a cut file

const cut = parseSvg(panel, fill);
// Normalised by the longest side, 80.
const cutArea = (80 * 60 - 6 * 20 - (20 * 25) / 2) / (80 * 80);
check(
  'default: loose edges join into the panel and its slot, and the slot is a hole in it',
  ringsOf(cut).length === 3 && signs(cut) === '-++' && near(area(cut), cutArea),
  `ring signs ${signs(cut)}, area ${area(cut).toFixed(6)} (panel less slot less V: ${cutArea.toFixed(6)})`,
);

/* The rings the default gave before `asPainted` existed, in order, by signed area. Any change
   here changes what the apps reading SVGs as cut files make of these drawings. */
const BEFORE: [string, string, Options][] = [
  ['outlines', checkInCircle, {}],
  ['check mark in a circle, filled', checkInCircle, fill],
  ['circle filled, check mark as an outline', checkInCircle, mixedChoice],
  ['arcs inside each other, filled', arcs, fill],
  ['circles inside each other, filled', target, fill],
  ['an outline with a gap, filled', gap, fill],
  ['a panel of loose edges, filled', panel, fill],
];
const EXPECTED = [
  '-0.7841 0.6970 -0.0243',
  '-0.7804 0.0900',
  '-0.7804 -0.0257',
  '-0.3921 0.1532 -0.0245',
  '-0.7804 0.2809 -0.0312',
  '-0.0234 1.0000',
  '-0.7500 0.0187 0.0391',
];
BEFORE.forEach(([name, file, opts], i) => {
  const got = signature(parseSvg(file, opts));
  check(`default, unchanged: ${name}`, got === EXPECTED[i], got === EXPECTED[i] ? got : `${got}, was ${EXPECTED[i]}`);
});

// ---------------------------------------------------------------- asPainted

const painted = (file: string, opts: Options = {}) => parseSvg(file, { ...opts, asPainted: true });

const strokes = painted(checkInCircle);
const filled = painted(checkInCircle, fill);
const mixed = painted(checkInCircle, mixedChoice);
const [disc, mark] = ringsOf(filled);
check(
  'painted: the check mark is wound like the circle it sits in',
  ringsOf(filled).length === 2 && alike(filled),
  `ring signs ${signs(filled)} (a hole would be wound the other way)`,
);
check(
  '…so it adds to the disc instead of cutting a hole in it',
  near(area(filled), Math.abs(signed(disc)) + Math.abs(signed(mark))),
  `filled area ${area(filled).toFixed(4)} = disc ${Math.abs(signed(disc)).toFixed(4)} + mark ${Math.abs(signed(mark)).toFixed(4)}`,
);
check(
  'painted: one outline filled while another stays an outline is more than both outlines, less than both filled',
  area(strokes) * 3 < area(mixed) && area(mixed) < area(filled),
  `outlines ${area(strokes).toFixed(4)} < mixed ${area(mixed).toFixed(4)} < filled ${area(filled).toFixed(4)}`,
);
check(
  '…and in the mixed file the outline sits on the disc, it is not cut out of it',
  alike(mixed),
  `ring signs ${signs(mixed)}`,
);
const arcsPainted = painted(arcs, fill);
check(
  'painted: arcs inside each other fill as three shapes wound alike, not as bands',
  ringsOf(arcsPainted).length === 3 && alike(arcsPainted),
  `ring signs ${signs(arcsPainted)}`,
);
const targetPainted = painted(target, fill);
check(
  'painted: circles inside each other fill as one solid disc, not a bullseye',
  ringsOf(targetPainted).length === 3 && alike(targetPainted),
  `ring signs ${signs(targetPainted)}`,
);
const gapPainted = painted(gap, fill);
check(
  'painted: an outline left open is a shape, with the chevron inside it on top',
  ringsOf(gapPainted).length === 2 && alike(gapPainted),
  `${ringsOf(gapPainted).length} rings, signs ${signs(gapPainted)}`,
);
const panelPainted = painted(panel, fill);
check(
  'painted: loose edges are not joined across paths; a straight edge on its own has no area',
  ringsOf(panelPainted).length === 1,
  `${ringsOf(panelPainted).length} ring (the V)`,
);

// ---------------------------------------------------------------- outlines

const strip = ringsOf(parseSvg(checkInCircle))
  .map((r) => signed(r))
  .sort((a, b) => Math.abs(b) - Math.abs(a));
check(
  'default: a closed outline is a strip, its inner edge wound against its outer one',
  strip.length === 3 && Math.sign(strip[0]) !== Math.sign(strip[1]),
  `outer ${strip[0].toFixed(4)}, inner ${strip[1].toFixed(4)}`,
);
check(
  'painted: an outline is three\'s stroke mesh, every triangle wound alike so they add up',
  ringsOf(strokes).length === 132 && alike(strokes) && near(area(strokes), Math.abs(strip.reduce((s, a) => s + a, 0)), 1e-3),
  `${ringsOf(strokes).length} rings, area ${area(strokes).toFixed(4)}`,
);

/* Three of the clicker's symbols as it reads them, against what its own reader drew before the
   reader was shared: ring count and signed area. Read as strips instead, the two that cross
   themselves came out as filled blobs. */
const HEADER = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const icon = (node: IconNode): string =>
  `${HEADER}${node.map(([tag, attrs]) => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}/>`).join('')}</svg>`;
const SYMBOLS: [string, IconNode, number, number][] = [
  ['Infinity', InfinityIcon, 3054, -0.233418],
  ['Command', Command, 4160, -0.522763],
  ['ListChecks', ListChecks, 162, -0.242591],
];
for (const [name, node, rings, signedArea] of SYMBOLS) {
  const set = painted(icon(node));
  const sum = ringsOf(set).reduce((s, r) => s + signed(r), 0);
  check(
    `painted: the ${name} symbol is the outline the clicker always drew`,
    ringsOf(set).length === rings && alike(set) && sum.toFixed(6) === signedArea.toFixed(6),
    `${ringsOf(set).length} rings, signed area ${sum.toFixed(6)} (was ${rings}, ${signedArea.toFixed(6)})`,
  );
}

console.log(failures ? `\n${failures} FAILED` : '\nthe cut-file reading is unchanged, and the painted one is what the clicker always drew');
process.exit(failures ? 1 : 0);
