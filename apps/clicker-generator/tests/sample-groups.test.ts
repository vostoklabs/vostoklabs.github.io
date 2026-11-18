/*
  The Image panel's sample groups (src/ui/sampleGroups.ts), built with the kit's real sample grid
  in the stand-in document: the pack in season leads and starts open, a pack out of season starts
  folded, the stock samples always start open, and loading a design opens the group holding it.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs sample-groups
*/
import '../../../packages/ui-kit/tests/support/install-mini-dom';
import { sampleGroups } from '../src/ui/sampleGroups.ts';
import { CHRISTMAS } from '../src/packs/christmas.ts';
import { HALLOWEEN } from '../src/packs/halloween.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

type Group = HTMLElement & { setSelected(id: string | null): void };
const noop = () => {};
/** Each group as "heading:open|closed", in the order they show. */
const read = (groups: Group[]) => groups.map((g) => {
  const d = g.querySelector('details') as HTMLDetailsElement | null;
  const name = (d?.querySelector('summary')?.textContent ?? '').trim();
  return `${name}:${d ? (d.open ? 'open' : 'closed') : 'no fold'}`;
}).join(' | ');
const has = (s: string, heading: string, state: string) => s.split(' | ').some((g) => g.startsWith(heading) && g.endsWith(`:${state}`));

{
  const groups = sampleGroups(noop, new Date(2026, 10, 16)) as Group[];
  const s = read(groups);
  check('16 November: three groups, each one folds', groups.length === 3 && !s.includes('no fold'), s);
  check('16 November: Christmas leads, open, said to be in season', s.split(' | ')[0]?.startsWith(`${CHRISTMAS.name} · in season`) && has(s, CHRISTMAS.name, 'open'), s);
  check('16 November: Halloween starts folded', has(s, HALLOWEEN.name, 'closed'), s);
  check('16 November: the stock samples come last and start open', s.split(' | ')[2]?.startsWith('Choose a sample image') && has(s, 'Choose a sample image', 'open'), s);

  // What markLoadedSample does with a loaded design: every grid is told, the one holding it opens.
  const halloweenDesign = HALLOWEEN.designs[0]!.name;
  for (const g of groups) g.setSelected(halloweenDesign);
  const after = read(groups);
  check(`loading "${halloweenDesign}" opens the folded Halloween group, and only that one changes`,
    has(after, HALLOWEEN.name, 'open') && has(after, CHRISTMAS.name, 'open') && has(after, 'Choose a sample image', 'open'), after);
}
{
  const s = read(sampleGroups(noop, new Date(2026, 5, 15)) as Group[]);
  check('15 June: both packs start folded, the stock samples open', has(s, CHRISTMAS.name, 'closed') && has(s, HALLOWEEN.name, 'closed') && has(s, 'Choose a sample image', 'open'), s);
  check('15 June: no heading says in season', !s.includes('in season'), s);
}
{
  const s = read(sampleGroups(noop, new Date(2026, 9, 15)) as Group[]);
  check('15 October: Halloween leads, open; Christmas folded', s.split(' | ')[0]?.startsWith(HALLOWEEN.name) && has(s, HALLOWEEN.name, 'open') && has(s, CHRISTMAS.name, 'closed'), s);
}
{
  const picked: string[] = [];
  const groups = sampleGroups((_load, label) => picked.push(label), new Date(2026, 10, 16)) as Group[];
  const tile = groups[0]!.querySelector('button') as (HTMLElement & { click(): void }) | null;
  tile?.click();
  check('a pack tile loads that design by its name', picked.join() === CHRISTMAS.designs[0]!.name, picked.join());
}

if (failures) {
  console.error(`\nsample-groups: ${failures} failed`);
  process.exit(1);
}
console.log('\nsample-groups: all passed');
