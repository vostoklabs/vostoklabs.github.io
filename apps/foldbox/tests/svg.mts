// An SVG logo as the app reads it (src/ui/svgLogo.ts, on the shelf's SVG reader), pinned: for the
// reader's own drawings and a few Lucide icons, the parts the import window is shown, the choices
// a file opens on, and the artwork three ways (as it opens, every part filled, every part an
// outline). Each artwork is reduced to its ring and line counts and a digest of the points to a
// millionth of the logo's size, in order, so a ring wound the other way moves the digest too.
//
// The icons are ones whose rings cross or touch: a ring's first vertex cannot decide their
// nesting, so a reader that starts its rings elsewhere must still fill them the same way.
//
// A line that moves is a reading that moved. Say why in the commit, and copy the line the
// failure prints into PINNED.
//
// Run: pnpm --filter foldbox test:svg

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { LEGEND_FILES, lucideFiles } from '../../../packages/trace/tests/corpus';

// The reader and the style flattener parse XML; under node they are handed xmldom, resolved from
// the package whose tests already depend on it.
let root = resolve('.');
while (!existsSync(join(root, 'pnpm-workspace.yaml')) && resolve(root, '..') !== root) root = resolve(root, '..');
const xmldom = createRequire(join(root, 'packages/trace/package.json'))('@xmldom/xmldom') as { DOMParser: unknown; XMLSerializer: unknown };
(globalThis as Record<string, unknown>).DOMParser = xmldom.DOMParser;
(globalThis as Record<string, unknown>).XMLSerializer = xmldom.XMLSerializer;
const { defaultSvgModes, logoParts, svgArtwork } = await import('../src/ui/svgLogo');

type Mode = 'fill' | 'outline' | 'off';
type P = [number, number];

const LUCIDE = ['Mail', 'Globe', 'ChartLine', 'Bus', 'CakeSlice', 'Link', 'KeyRound', 'Tags'];

const PINNED: Record<string, string> = {
  'a square with a square hole wound against it': 'parts 0f | opens F | opened 2r 0l dbc025a588b0 | filled 2r 0l dbc025a588b0 | outlined 0r 2l 9f03fc6d86a2',
  'a square inside a square, even-odd': 'parts 0f | opens F | opened 2r 0l 89b983f7ae24 | filled 2r 0l 89b983f7ae24 | outlined 0r 2l 1d68987b17f9',
  'a white background behind a disc and a star': 'parts 0f:artboard 2f 1f | opens -FF | opened 2r 0l 4bf43bbca1d7 | filled 3r 0l 007031d2cb13 | outlined 0r 3l f7be4af26487',
  'fills, a stroke, and a path with both': 'parts 1s 0f 2f 3s | opens OFFO | opened 2r 2l ddab49dbc609 | filled 3r 0l 349b55391726 | outlined 0r 4l 97b710b4042d',
  'a cut file in millimetres: panels as coloured lines over a fill nobody sees': 'parts 0s 5s 1s 2s 3s 4s 6f | opens OOOOOOF | opened 0r 6l c41f485b39a7 | filled 2r 0l dcb9fceda63e | outlined 0r 7l f17d4eb3319d',
  'an artboard and a shape inside a scaling group': 'parts 0f:artboard 1f | opens -F | opened 2r 0l dbc025a588b0 | filled 3r 0l 2387b2c49e41 | outlined 0r 3l 06ba55f7e502',
  'rounded rectangles, a short colour, an unseen path and an inherited ink': 'parts 2n 0f 1s 3f | opens -FOF | opened 2r 1l e5539e683fe7 | filled 3r 0l 1b315e26cf07 | outlined 0r 4l 7d5183f75f3c',
  'nested outlines with sharp corners': 'parts 0s 2s 1s | opens OOO | opened 0r 3l 977696e0740c | filled 3r 0l 28d96034c429 | outlined 0r 3l 977696e0740c',
  'white parts beside black ones': 'parts 0f:white 3f 1s:white 2s | opens -F-O | opened 1r 1l 7493418b7f6e | filled 2r 0l 96fc74f49ca6 | outlined 0r 4l e9b17cf24a1a',
  'an artboard the size of the view box': 'parts 0f:artboard 1f | opens -F | opened 1r 0l 71ca518e4c9d | filled 2r 0l ea93cca4d20f | outlined 0r 2l 81b1ac7bc60f',
  'an artboard at 100%': 'parts 0f:artboard 1f | opens -F | opened 1r 0l d291dd5032b3 | filled 2r 0l 084f8d8add11 | outlined 0r 2l 2d2dae748015',
  'white parts and an artboard, in a file the import window has been through': 'parts 0f:artboard 1f:white 2s:white | opens --- | opened throws "Nothing is switched on, so there is no logo to put on the box." | filled 2r 0l b698fce360d9 | outlined 0r 3l 212c78d20996',
  'nothing but white': 'parts 0f:white | opens - | opened throws "Nothing is switched on, so there is no logo to put on the box." | filled 1r 0l 71ca518e4c9d | outlined 0r 1l da64129390da',
  'sized by width and height, no view box': 'parts 0f | opens F | opened 1r 0l 741ab309086d | filled 1r 0l 741ab309086d | outlined 0r 1l 7ffd3dcc810b',
  'no size at all': 'parts 0f | opens F | opened 1r 0l 71ca518e4c9d | filled 1r 0l 71ca518e4c9d | outlined 0r 1l da64129390da',
  'every cap and join': 'parts 0s 1s 2s 3s 4s 5s 6s 7s 8s 9s 10s | opens OOOOOOOOOOO | opened 0r 10l 1559313e45a0 | filled 9r 0l cf4a2221478f | outlined 0r 10l 1559313e45a0',
  'lucide Mail': 'parts 1s 0s | opens OO | opened 0r 2l 414c7080c288 | filled 2r 0l ea0a725bc9ed | outlined 0r 2l 414c7080c288',
  'lucide Globe': 'parts 0s 1s 2s | opens OOO | opened 0r 3l f0c432bf22c9 | filled 2r 0l 13ac83d03fc9 | outlined 0r 3l f0c432bf22c9',
  'lucide ChartLine': 'parts 0s 1s | opens OO | opened 0r 2l e59339cf2f57 | filled 2r 0l 11d820e5d682 | outlined 0r 2l e59339cf2f57',
  'lucide Bus': 'parts 3s 4s 6s 0s 1s 2s 5s | opens OOOOOOO | opened 0r 7l 984b67f117d7 | filled 3r 0l dfd7a63929e8 | outlined 0r 7l 984b67f117d7',
  'lucide CakeSlice': 'parts 2s 3s 0s 1s | opens OOOO | opened 0r 4l 6816dc205d55 | filled 2r 0l d66f5c284dbd | outlined 0r 4l 6816dc205d55',
  'lucide Link': 'parts 1s 0s | opens OO | opened 0r 2l 5568aca0fc3b | filled 2r 0l 741b772ea237 | outlined 0r 2l 5568aca0fc3b',
  'lucide KeyRound': 'parts 0s 1f | opens OF | opened 1r 1l e5a98d2338ed | filled 2r 0l c1744cd90366 | outlined 0r 2l e0714628ff01',
  'lucide Tags': 'parts 0s 1s 2f | opens OOF | opened 1r 2l 89d7e90c6caf | filled 3r 0l 432aacb0db7f | outlined 0r 3l 4328217d5224',
  'a path of one point': 'parts 0f | opens F | opened throws "What is switched on draws nothing, so there is no logo to put on the box." | filled throws "What is switched on draws nothing, so there is no logo to put on the box." | outlined throws "What is switched on draws nothing, so there is no logo to put on the box."',
};

/** A choice as one letter, in the parts' order: Fill, Outline, or off. */
const LETTER: Record<Mode, string> = { fill: 'F', outline: 'O', off: '-' };
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const micro = (list: P[][]) => list.map((r) => r.map(([x, y]) => [Math.round(x * 1e6), Math.round(y * 1e6)]));

function reading(svg: string, modes: Record<string, Mode>): string {
  try {
    const art = svgArtwork(svg, modes);
    const points = JSON.stringify([micro(art.rings as P[][]), micro(art.lines as P[][])]);
    return `${art.rings.length}r ${art.lines.length}l ${digest(points)}`;
  } catch (err) {
    return `throws "${(err as Error).message}"`;
  }
}

const icons = new Map(lucideFiles());
const files: [string, string][] = [
  ...LEGEND_FILES,
  ...LUCIDE.map((n): [string, string] => [`lucide ${n}`, icons.get(n) ?? '']),
  // On, and drawing nothing: the reader refuses it, and the app says why rather than that
  // nothing is switched on.
  ['a path of one point', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10" stroke="#000"/></svg>'],
];

let failures = 0;
let checks = 0;
const warn = console.warn;
console.warn = () => {}; // three's loader says "Unknown color currentColor" once per Lucide path
const lines = files.map(([name, svg]) => {
  const { parts, issues } = logoParts(svg);
  const opens = defaultSvgModes(parts);
  const every = (mode: Mode) => Object.fromEntries(parts.map((p) => [String(p.index), mode]));
  const listed = parts.map((p) => `${p.index}${p.kind[0]}${p.why ? `:${p.why}` : ''}`).join(' ') || '-';
  return [
    name,
    `parts ${listed}${issues.length ? ` (${issues.length} issues)` : ''} | opens ${parts.map((p) => LETTER[opens[String(p.index)] ?? 'off']).join('') || '-'}` +
      ` | opened ${reading(svg, opens)} | filled ${reading(svg, every('fill'))} | outlined ${reading(svg, every('outline'))}`,
  ] as const;
});
console.warn = warn;

console.log('the readings');
for (const [name, line] of lines) {
  checks++;
  if (PINNED[name] !== line) {
    failures++;
    console.error(`  MOVED ${name}\n    was ${PINNED[name] ?? '(not pinned)'}\n    now ${line}\n    '${name}': '${line}',`);
  }
}
const stale = Object.keys(PINNED).filter((n) => !files.some(([f]) => f === n));
checks++;
if (stale.length) {
  failures++;
  console.error(`  pinned but not read: ${stale.join(', ')}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
