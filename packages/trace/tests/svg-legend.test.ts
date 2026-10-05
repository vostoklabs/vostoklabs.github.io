/*
  The keycap's one-colour reading, `parseSvgLegend`: each filled path as its shapes and each
  stroke-only path as three's stroke mesh, in the file's own units, with the white parts and the
  artboard left out unless the file has been through the import window.

  svg-corpus.test.ts pins it against the keycap's own reader over every Lucide icon. These are the
  rules it reads by, one at a time, on files small enough to check by hand.

    pnpm --filter @vostok/trace test
*/
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
const { parseSvgLegend } = await import('../src/logo');

type Ring = [number, number][];
type Legend = ReturnType<typeof parseSvgLegend>;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const svg = (inner: string, root = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${inner}</svg>`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Signed shoelace area in the file's own axes. */
const signed = (r: Ring): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};
const signs = (l: Legend) => l.contours.map((r) => (signed(r) > 0 ? '+' : '-')).join('');
/** Everything but the strokes' values, for comparing two readings. */
const shape = (l: Legend) => JSON.stringify([l.contours, l.strokes.map((s) => s.length), l.box, l.view]);
const throws = (read: () => unknown): string => {
  try {
    read();
    return '';
  } catch (err) {
    return (err as Error).message;
  }
};

// ---------------------------------------------------------------- a file small enough to check

/** A 10 × 8 rectangle, and a line 16 long and 4 wide across from it. */
const small = parseSvgLegend(svg(
  '<rect x="2" y="4" width="10" height="8" fill="#000"/><path d="M20 10 H36" fill="none" stroke="#000" stroke-width="4"/>',
  'viewBox="0 0 40 20"',
));
check(
  'a filled shape is its contour, in the file\'s own units, Y down',
  same(small.contours, [[[2, 4], [12, 4], [12, 12], [2, 12], [2, 4]]]),
  JSON.stringify(small.contours),
);
const [mesh] = small.strokes;
const corners = Array.from({ length: mesh.length / 3 }, (_, i) => [mesh[3 * i], mesh[3 * i + 1], mesh[3 * i + 2]]);
check(
  'a stroke is three\'s mesh as a plain Float32Array: two triangles for a straight line',
  small.strokes.length === 1 && mesh instanceof Float32Array && mesh.length === 18
    && corners.every(([x, y, z]) => (x === 20 || x === 36) && (y === 8 || y === 12) && z === 0),
  `${small.strokes.length} stroke, ${mesh.length} values, corners at x 20 or 36, y 8 or 12, z 0`,
);
check(
  'the box covers the contours and the stroke\'s width',
  same(small.box, { minX: 2, minY: 4, maxX: 36, maxY: 12 }),
  JSON.stringify(small.box),
);
check(
  'the view is the view box\'s size',
  same(small.view, { w: 40, h: 20 }),
  JSON.stringify(small.view),
);
check(
  'the result is plain data, with no three.js object in it',
  Object.getPrototypeOf(small.box) === Object.prototype && Object.getPrototypeOf(small.view) === Object.prototype
    && small.contours.every((r) => Array.isArray(r) && r.every((p) => Array.isArray(p) && p.every((v) => typeof v === 'number'))),
  'contours are arrays of numbers, box and view are plain objects',
);

check(
  'a file with only a width and height takes its view from them, a file with neither has none',
  same(parseSvgLegend(svg('<circle cx="10" cy="10" r="5" fill="#000"/>', 'width="32" height="24"')).view, { w: 32, h: 24 })
    && parseSvgLegend(svg('<circle cx="10" cy="10" r="5" fill="#000"/>', '')).view === null,
  'width and height: 32 × 24; no size: null',
);

// ---------------------------------------------------------------- winding

const holes = parseSvgLegend(svg(
  '<path d="M10 10 H90 V90 H10 Z M30 30 V70 H70 V30 Z" fill="#000"/>'
  + '<path fill-rule="evenodd" d="M10 10 V90 H90 V10 Z M30 30 V70 H70 V30 Z" fill="#000"/>',
));
check(
  'outlines are wound one way and holes the other, however the file drew them',
  signs(holes) === '+-+-' && signed(holes.contours[0]) === 6400 && signed(holes.contours[1]) === -1600,
  `ring signs ${signs(holes)} (non-zero hole, then the same square drawn the other way round, even-odd)`,
);

// ---------------------------------------------------------------- what is left out, and when

const whites = svg(
  '<circle cx="30" cy="30" r="20" fill="#fff"/>'
  + '<path d="M10 80 H90" fill="none" stroke="white" stroke-width="4"/>'
  + '<path d="M50 10 V60" fill="none" stroke="#000" stroke-width="4"/>'
  + '<rect x="60" y="60" width="30" height="30" fill="#000"/>',
);
const guessed = parseSvgLegend(whites);
const taken = parseSvgLegend(whites, { chosen: true });
check(
  'white is left out: a white fill is not filled and a white stroke not stroked',
  guessed.contours.length === 1 && guessed.strokes.length === 1 && guessed.box.minY === 10 && guessed.box.minX === 48,
  `${guessed.contours.length} contour, ${guessed.strokes.length} stroke`,
);
check(
  '…unless the file has been chosen: then it is drawn as it says',
  taken.contours.length === 2 && taken.strokes.length === 2,
  `${taken.contours.length} contours, ${taken.strokes.length} strokes`,
);

const artboards: [string, string][] = [
  ['the size of the view box', '<rect x="0" y="0" width="100" height="100" fill="#000"/>'],
  ['at 100%', '<rect width="100%" height="100%" fill="#222"/>'],
  ['drawn by a transform round it', '<g transform="matrix(0.5 0 0 0.5 0 0)"><rect width="200" height="200" fill="#000"/></g>'],
];
for (const [name, rect] of artboards) {
  const file = svg(rect + '<circle cx="50" cy="50" r="20" fill="#000"/>');
  const left = parseSvgLegend(file);
  check(
    `an artboard ${name} is left out, and kept in a chosen file`,
    left.contours.length === 1 && left.box.minX === 30 && left.box.maxX === 70
      && parseSvgLegend(file, { chosen: true }).contours.length === 2,
    `${left.contours.length} contour (the disc) unless chosen`,
  );
}

const stamped = whites.replace('viewBox="0 0 100 100"', 'viewBox="0 0 100 100" data-vl-chosen="1"');
check(
  'a file stamped by the import window is chosen without being told',
  shape(parseSvgLegend(stamped)) === shape(taken),
  `${parseSvgLegend(stamped).contours.length} contours, ${parseSvgLegend(stamped).strokes.length} strokes`,
);
check(
  '…and being told otherwise wins over the stamp',
  shape(parseSvgLegend(stamped, { chosen: false })) === shape(guessed),
  `${parseSvgLegend(stamped, { chosen: false }).contours.length} contour, ${parseSvgLegend(stamped, { chosen: false }).strokes.length} stroke`,
);

const onlyWhite = svg('<circle cx="50" cy="50" r="40" fill="#ffffff"/>');
check(
  'a file with nothing left to draw says so',
  throws(() => parseSvgLegend(onlyWhite)) === 'No drawable paths found in this SVG.'
    && parseSvgLegend(onlyWhite, { chosen: true }).contours.length === 1,
  `"${throws(() => parseSvgLegend(onlyWhite))}", and one contour once chosen`,
);

// ---------------------------------------------------------------- paint

const unseen = parseSvgLegend(svg(
  '<circle cx="20" cy="20" r="10" fill="#000" fill-opacity="0" stroke="#000" stroke-width="2"/>'
  + '<path d="M40 10 H60 V30 H40 Z" fill="#000" opacity="0"/>'
  + '<path d="M10 90 H90" fill="none" stroke="#000" stroke-opacity="0" stroke-width="3"/>'
  + '<rect x="70" y="70" width="20" height="20" fill="#000" stroke="#000" stroke-width="6"/>',
));
check(
  'what paints nothing is not drawn: a zero opacity, on the fill, the stroke or the whole path',
  unseen.contours.length === 1 && unseen.strokes.length === 1 && unseen.box.minX < 10 && unseen.box.minX > 8.9,
  `${unseen.contours.length} contour (the square), ${unseen.strokes.length} stroke (the circle's outline, out to x ${unseen.box.minX.toFixed(4)})`,
);
check(
  '…and a path both filled and stroked is drawn by its fill alone',
  unseen.box.maxX === 90 && unseen.box.maxY === 90,
  `box reaches ${unseen.box.maxX}, ${unseen.box.maxY}: the square's edge, not its 6-wide stroke or the unseen line`,
);

console.log(failures ? `\n${failures} FAILED` : '\nthe legend reads by the keycap\'s rules');
process.exit(failures ? 1 : 0);
