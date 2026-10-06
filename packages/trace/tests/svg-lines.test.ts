/*
  The SVG reader's `outlinesAsLines`: an outline read as the line it follows.

  A laser and a pen both follow a line, so a path drawn as an outline is wanted as its centre line,
  open, and not as the strip a stroke of that width would cover. Fills are read as they always
  are. With the option left out nothing changes at all, which svg-corpus.test.ts holds over every
  icon; this file is what the option itself does.

    pnpm --filter @vostok/trace test
*/
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
const { parseSvg } = await import('../src/logo');

type Ring = [number, number][];
type Reading = ReturnType<typeof parseSvg>;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const svg = (inner: string, root = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${inner}</svg>`;
const stroke = (d: string, colour = '#000') => `<path d="${d}" fill="none" stroke="${colour}" stroke-width="2"/>`;
const lines = (set: Reading): Ring[] => set.regions.flatMap((r) => r.lines ?? []);
const rings = (set: Reading): Ring[] => set.regions.flatMap((r) => r.components.flatMap((c) => c.rings));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const asLines = { outlinesAsLines: true };

// ---------------------------------------------------------------- a stroke drawing

/** One of each: a polyline, a circle, a curve, an arc and a closed rectangle. */
const drawing = svg(
  stroke('M10 20 L90 20 L90 60')
  + '<circle cx="30" cy="70" r="10" fill="none" stroke="#000" stroke-width="2"/>'
  + stroke('M50 50 Q70 30 90 50')
  + stroke('M40 40 A10 10 0 0 1 60 40')
  + stroke('M15 85 H45 V95 H15 Z'),
);
const read = parseSvg(drawing, asLines);
const [polyline, , , , closed] = lines(read);

check(
  'a stroke drawing comes back as open lines, one per subpath, at the reader\'s density',
  same(lines(read).map((l) => l.length), [3, 65, 33, 65, 5]),
  // A straight run is its corners; a curve is 32 steps; an arc or a circle 64; a closed path
  // ends where it began.
  `points per line ${lines(read).map((l) => l.length).join(', ')} (polyline 3, circle 65, curve 33, arc 65, rectangle 5)`,
);
check(
  '…as lines, not filled: no rings, no coverage, nothing in the silhouette',
  read.regions.length === 1 && rings(read).length === 0 && read.regions[0].coverage === 0
    && same(read.regions[0].components, [{ rings: [], coverage: 0 }]) && read.outline.length === 0,
  `${read.regions.length} region, ${rings(read).length} rings, coverage ${read.regions[0].coverage}, outline ${read.outline.length}`,
);
check(
  '…a closed path comes back to its start, an open one does not',
  same(closed[0], closed[closed.length - 1]) && !same(polyline[0], polyline[polyline.length - 1]),
  `rectangle ${JSON.stringify(closed[0])} … ${JSON.stringify(closed[closed.length - 1])}`,
);

// Normalised as the rings are: centred on the drawing, the longest side 1, Y up. The drawing
// spans x 10..90 and y 20..95, so the scale is 1/80 and the middle is (50, 57.5).
check(
  'in the rings\' frame: centred, longest side 1, Y up',
  same(polyline, [[-0.5, 0.46875], [0.5, 0.46875], [0.5, -0.03125]]),
  `polyline ${JSON.stringify(polyline)}`,
);
const xs = lines(read).flat().map(([x]) => x);
const ys = lines(read).flat().map(([, y]) => y);
check(
  '…and the lines alone set the frame and the aspect',
  Math.min(...xs) === -0.5 && Math.max(...xs) === 0.5 && Math.min(...ys) === -0.46875 && Math.max(...ys) === 0.46875
    && read.aspect === 80 / 75,
  `x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}, aspect ${read.aspect.toFixed(4)}`,
);

const one = parseSvg(svg(stroke('M0 0 L10 10')), asLines);
check(
  'a drawing of nothing but one line reads, it does not throw',
  same(lines(one), [[[-0.5, 0.5], [0.5, -0.5]]]) && one.aspect === 1,
  `lines ${JSON.stringify(lines(one))}`,
);

// A line has no width of its own, so a lone straight line has no height (or no width): each side
// of the aspect is taken as at least the stroke the line is drawn with, as the strip reading has it.
for (const [name, d, want] of [['a lone horizontal line', 'M10 50 H90', 40], ['a lone vertical line', 'M50 10 V90', 1 / 40]] as const) {
  const file = svg(stroke(d));
  const asLine = parseSvg(file, asLines).aspect;
  const asStrip = parseSvg(file).aspect;
  check(
    `${name}: the aspect of the strip it is drawn as, not 1`,
    asLine === asStrip && Math.abs(asLine - want) < 1e-12,
    `as a line ${asLine}, as a strip ${asStrip}`,
  );
}
const thin = parseSvg(svg(stroke('M10 50 L50 50.5 L90 50')), asLines);
check(
  '…and a drawing thinner than its stroke is measured as that stroke, not as its hairline',
  Math.abs(thin.aspect - 40) < 1e-12,
  `aspect ${thin.aspect} for 80 along and 0.5 high, drawn 2 wide`,
);

const strips = parseSvg(drawing);
check(
  'without the option the same drawing is strips, as before',
  lines(strips).length === 0 && rings(strips).length > 0 && strips.regions.every((r) => !('lines' in r)),
  `${rings(strips).length} rings, no lines`,
);

// ---------------------------------------------------------------- fills are read as before

const filled = svg(
  '<path d="M10 10 H90 V90 H10 Z M30 30 V70 H70 V30 Z" fill="#c8102e"/>'
  + '<circle cx="50" cy="50" r="12" fill="#0a5cd5"/>',
);
check(
  'a file of fills reads the same with the option, ring for ring',
  same(parseSvg(filled, asLines), parseSvg(filled)),
  `${rings(parseSvg(filled, asLines)).length} rings either way`,
);
/** A circle and a check mark inside it, both drawn as strokes. */
const checkInCircle = svg('<circle cx="50" cy="50" r="34" fill="none" stroke="#000" stroke-width="2"/>' + stroke('M32 50 L48 66 L72 38'));
check(
  'strokes filled are fills: the option leaves them alone, in both readings',
  same(parseSvg(checkInCircle, { fillStrokes: true, ...asLines }), parseSvg(checkInCircle, { fillStrokes: true }))
    && same(parseSvg(checkInCircle, { fillStrokes: true, asPainted: true, ...asLines }), parseSvg(checkInCircle, { fillStrokes: true, asPainted: true })),
  `${rings(parseSvg(checkInCircle, { fillStrokes: true, ...asLines })).length} rings, no lines`,
);
check(
  'lines win over both readings of an outline',
  same(parseSvg(drawing, { asPainted: true, ...asLines }), read),
  'as painted or not, the same lines',
);

// ---------------------------------------------------------------- colours

const mixed = parseSvg(svg('<rect x="20" y="20" width="30" height="30" fill="#c8102e"/>' + stroke('M60 80 L90 20', '#0a5cd5')), asLines);
const [red, blue] = mixed.regions;
check(
  'a colour drawn only in lines is a region with no rings and no coverage',
  same(blue.quantRgb, [10, 92, 213]) && same(blue.components, [{ rings: [], coverage: 0 }]) && blue.coverage === 0
    && blue.lines?.length === 1 && blue.lines[0].length === 2,
  `blue: ${blue.lines?.length} line, coverage ${blue.coverage}`,
);
check(
  '…beside the filled one, which keeps all the coverage and carries no lines',
  same(red.quantRgb, [200, 16, 46]) && red.coverage === 1 && !('lines' in red),
  `red: coverage ${red.coverage}, ${red.components[0].rings.length} ring`,
);
check(
  '…and the silhouette is the filled shapes only',
  same(mixed.outline, red.components[0].rings),
  `${mixed.outline.length} ring in the outline`,
);

const choice = svg('<path d="M10 10 H90 V90 H10 Z" fill="#c8102e"/><circle cx="50" cy="50" r="20" fill="#000"/>');
const outlined = parseSvg(choice, { ...asLines, overrides: { 0: { mode: 'outline', hex: '#00ae42' } } });
const green = outlined.regions.find((r) => same(r.quantRgb, [0, 174, 66]));
check(
  'a fill set to outline in the import window comes back as its line, in the chosen colour',
  !!green && green.lines?.length === 1 && green.lines[0].length === 5 && green.components[0].rings.length === 0,
  `green: ${green?.lines?.length} line of ${green?.lines?.[0].length} points, ${green?.components[0].rings.length} rings`,
);
const ownColour = parseSvg(choice, { ...asLines, overrides: { 0: { mode: 'outline' } } });
check(
  '…in the file\'s own colour when none is chosen',
  same(ownColour.regions[0].quantRgb, [200, 16, 46]) && ownColour.regions[0].lines?.length === 1,
  `first region ${JSON.stringify(ownColour.regions[0].quantRgb)}`,
);

// ---------------------------------------------------------------- one line per subpath

/** A panel 80 × 60 and a slot inside it, every edge its own path, and an open V. */
const panel = svg([
  'M10 80 V20', 'M10 20 H90', 'M90 20 V80', 'M90 80 H10',
  'M30 40 H36', 'M36 40 V60', 'M36 60 H30', 'M30 60 V40',
].map((d) => stroke(d)).join('') + stroke('M55 35 L65 60 L75 35'));
check(
  'nothing is joined across paths: every edge stays the line the file drew',
  same(lines(parseSvg(panel, asLines)).map((l) => l.length), [2, 2, 2, 2, 2, 2, 2, 2, 3]),
  `${lines(parseSvg(panel, asLines)).length} lines`,
);

// ---------------------------------------------------------------- size and background

const cut = svg(stroke('M10 10 H90 V50 H10 Z'), 'width="100mm" height="60mm" viewBox="0 0 100 60"');
const cutLines = parseSvg(cut, asLines);
const cutStrip = parseSvg(cut);
check(
  'a cut file\'s real size is the line\'s, not the strip\'s',
  cutLines.mm === 80 && cutLines.aspect === 2 && cutStrip.mm === 82,
  `${cutLines.mm} mm and aspect ${cutLines.aspect} as a line (${cutStrip.mm} mm as a strip)`,
);

const backdrop = svg('<rect width="100" height="100" fill="#ffffff"/>' + stroke('M20 20 H80 V80 H20 Z') + stroke('M30 50 H70'));
const noBackdrop = parseSvg(backdrop, { ...asLines, removeBg: true });
check(
  'removing the background takes the backdrop and leaves the lines',
  noBackdrop.regions.length === 1 && same(noBackdrop.regions[0].quantRgb, [0, 0, 0]) && lines(noBackdrop).length === 2,
  `${noBackdrop.regions.length} region left, ${lines(noBackdrop).length} lines`,
);
const sameInk = parseSvg(svg(
  '<rect width="100" height="100" fill="#ffffff"/>' + stroke('M20 20 H80', '#ffffff') + '<circle cx="50" cy="60" r="10" fill="#000"/>',
), { ...asLines, removeBg: true });
const white = sameInk.regions.find((r) => same(r.quantRgb, [255, 255, 255]));
check(
  '…even a line in the backdrop\'s own colour: a background is a filled shape',
  !!white && white.components[0].rings.length === 0 && white.lines?.length === 1 && rings(sameInk).length === 1,
  `white: ${white?.components[0].rings.length} rings, ${white?.lines?.length} line`,
);
const reachedPast = parseSvg(svg('<rect x="40" y="40" width="20" height="20" fill="#c8102e"/>' + stroke('M0 0 L100 100', '#0a5cd5')), { ...asLines, removeBg: true });
check(
  'a filled shape the lines reach past is not a backdrop',
  reachedPast.regions.length === 2 && rings(reachedPast).length === 1,
  `${reachedPast.regions.length} regions, ${rings(reachedPast).length} ring`,
);

console.log(failures ? `\n${failures} FAILED` : '\noutlines come back as the lines they follow, and fills as they always did');
process.exit(failures ? 1 : 0);
