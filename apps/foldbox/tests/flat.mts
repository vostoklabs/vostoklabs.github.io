// The flat dieline view's markup, pinned for a few boxes: the panels, folds, cuts, labels, sheet
// and logo the view draws, as the kit's test document serializes them, and the operations it
// hands the legend. The view is built from nodes, not from a string of markup; this holds what
// those nodes come to, so a change to how it is built cannot move a line of the drawing unseen.
//
// A line that moves is a drawing that moved. Say why in the commit, and copy the line the failure
// prints into PINNED.
//
// Run: pnpm --filter foldbox test:flat

import { createHash } from 'node:crypto';
import { installMiniDom, html } from '../../../packages/ui-kit/tests/support/mini-dom';
import { solve } from '../src/geometry/solve';
import { normalizeArtwork } from '../src/geometry/marks';
import { DEFAULT_PARAMS, type Artwork, type BoxParams, type Poly } from '../src/types';

installMiniDom();
const { createFlatView } = await import('../src/ui/flatView');

/** A square with a square counter, as a logo, both drawn clockwise: the nesting winds them. */
const square = (x: number, y: number, s: number): Poly => [[x, y], [x, y + s], [x + s, y + s], [x + s, y]];
const COUNTER: Artwork = normalizeArtwork([square(0, 0, 20), square(5, 5, 10)], []);

const CASES: { name: string; p: Partial<BoxParams>; art?: Artwork; labels: boolean; sheet: boolean }[] = [
  { name: 'tuck-top, cut, perforated folds', p: { style: 'tuck-top', makeMode: 'cut', foldMode: 'perf' }, labels: true, sheet: true },
  { name: 'tray with a window, no labels', p: { style: 'tray', makeMode: 'cut', window: true }, labels: false, sheet: true },
  { name: 'mailer, printed, a logo on its underside', p: { style: 'mailer', makeMode: 'print', sheetId: 'plate-256', logo: 'text', logoText: 'X' }, art: COUNTER, labels: true, sheet: true },
  { name: 'gable, scored, no sheet', p: { style: 'gable', makeMode: 'cut', foldMode: 'score' }, labels: true, sheet: false },
];

const PINNED: Record<string, string> = {
  'tuck-top, cut, perforated folds': 'perf cut | 20342 chars 01e40c664ad3c4e5',
  'tray with a window, no labels': 'cut perf | 19768 chars dfd2cf88e0a02025',
  'mailer, printed, a logo on its underside': 'engrave cut crease | 8256 chars 8dc97dd240bf04af',
  'gable, scored, no sheet': 'cut crease | 28298 chars 47f44aa7d68aad2c',
};

/** Markup as text, the same whichever way it was made: a self-closed element is the element
 *  with an empty body. */
const canonical = (markup: string): string => markup.replace(/<([a-zA-Z][\w:-]*)((?:\s[^<>]*?)?)\s*\/>/g, '<$1$2></$1>');
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

let failures = 0;
let checks = 0;
const view = createFlatView();
console.log('the drawings');
for (const c of CASES) {
  const params: BoxParams = { ...DEFAULT_PARAMS, ...c.p };
  const ops = view.render(solve(params, c.art ?? null), { showLabels: c.labels, showSheet: c.sheet });
  const markup = canonical(html(view.root as unknown as Parameters<typeof html>[0]));
  const line = `${[...ops].join(' ')} | ${markup.length} chars ${digest(markup)}`;
  checks++;
  if (PINNED[c.name] !== line) {
    failures++;
    console.error(`  MOVED ${c.name}\n    was ${PINNED[c.name] ?? '(not pinned)'}\n    now ${line}\n    '${c.name}': '${line}',`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
