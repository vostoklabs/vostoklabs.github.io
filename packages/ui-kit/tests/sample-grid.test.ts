/*
  sampleGrid({ fold }) in the stand-in document (support/mini-dom.ts).

  Off by default: the heading is plain text over an always-open grid, built exactly as before.
  With a fold and a heading, the heading is the summary of a kit collapsible section holding the
  tiles. setSelected opens a closed fold when the loaded id changes to one of its own tiles, and
  never otherwise, so a group the customer folds stays folded.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html } from './support/mini-dom';
import { sampleGrid, type SampleItem } from '../src/components/sources';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const items: SampleItem[] = [
  { src: 'a.png', label: 'Apple', id: 'Apple' },
  { src: 'b.png', label: 'Bell', id: 'Bell' },
];
const noop = () => {};
const details = (g: HTMLElement) => g.querySelector('details') as HTMLDetailsElement | null;

// ---- default: unchanged
const plain = sampleGrid({ heading: 'Samples', items, onPick: noop });
check('no fold: no details element', details(plain) === null);
check(
  'no fold: heading span then the grid, as before',
  html(plain).startsWith('<div><span class="vl-samples__heading">Samples</span><div class="vl-samples">'),
  html(plain).slice(0, 120),
);
plain.setSelected('Bell');
check(
  'no fold: aria-pressed marks the loaded tile',
  plain.querySelectorAll('[aria-pressed="true"]').length === 1 &&
    plain.querySelector('[aria-pressed="true"]')?.getAttribute('title') === 'Bell',
);

// ---- fold closed
const closed = sampleGrid({ heading: 'Halloween', items, onPick: noop, fold: 'closed' });
const d = details(closed)!;
check('closed: a details element', d !== null);
check('closed: it starts closed', d?.open === false);
check('closed: its summary is the heading', d?.querySelector('summary')?.textContent === 'Halloween');
check('closed: no plain heading span besides it', closed.querySelector('.vl-samples__heading') === null);
check('closed: the tiles are inside it', d?.querySelectorAll('.vl-sample').length === 2);

// ---- fold open
const open = sampleGrid({ heading: 'Christmas', items, onPick: noop, fold: 'open' });
check('open: it starts open', details(open)?.open === true);

// ---- fold without a heading is ignored
const nameless = sampleGrid({ items, onPick: noop, fold: 'closed' });
check('fold without a heading: ignored, no details', details(nameless) === null);
check('fold without a heading: the grid is there', nameless.querySelectorAll('.vl-sample').length === 2);

// ---- setSelected and the fold
closed.setSelected(null);
check('null leaves a closed fold closed', d.open === false);
closed.setSelected('Elsewhere');
check('an id held by another grid leaves it closed', d.open === false);
closed.setSelected('Apple');
check('an id this grid holds opens it', d.open === true);
check('and marks that tile', closed.querySelector('[aria-pressed="true"]')?.getAttribute('title') === 'Apple');
d.open = false; // the customer folds it again
closed.setSelected('Apple');
check('the same id again leaves the customer\'s fold closed', d.open === false);
closed.setSelected('Bell');
check('a different id of this grid opens it again', d.open === true);
check(
  'aria-pressed is still one tile',
  closed.querySelectorAll('[aria-pressed="true"]').length === 1 &&
    closed.querySelectorAll('[aria-pressed="false"]').length === 1,
);

console.log(`\nsample-grid: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
