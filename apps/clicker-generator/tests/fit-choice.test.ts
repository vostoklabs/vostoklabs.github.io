/*
  The Fit category's simple choices (src/ui/fitChoice.ts): Looser, Standard and Snugger are
  numbers the steppers under "By hand" can show, they point the way their names say, and a
  number that is none of them reads as Custom rather than as the nearest choice.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs fit-choice
*/
// The stand-in document first, before any kit module loads: the choice row below is the kit's.
import '../../../packages/ui-kit/tests/support/install-mini-dom';
import { FIT_TEST_LIVE, fitChoiceOf, POCKET_FIT_PCT, TOP_FIT_MM, type FitTable } from '../src/ui/fitChoice.ts';
import { fitChoiceRow } from '../src/ui/fitChoiceRow.ts';
import { STEM_FIT_MAX_MM, STEM_FIT_MIN_MM, STEM_FIT_STEP_MM } from '../src/geometry/stemFit.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// The pocket stepper's range and step are written in the stepper itself (ui.ts), and
// `onSocketFit` clamps to the same -5..5, so they are stated here.
const POCKET_MIN = -5, POCKET_MAX = 5, POCKET_STEP = 0.5;

const tables: [string, FitTable, number, number, number][] = [
  ['top part (mm)', TOP_FIT_MM, STEM_FIT_MIN_MM, STEM_FIT_MAX_MM, STEM_FIT_STEP_MM],
  ['switch cut-out (%)', POCKET_FIT_PCT, POCKET_MIN, POCKET_MAX, POCKET_STEP],
];
const keys = ['looser', 'standard', 'snugger'] as const;

{
  const got = [0.2, 0, -0.2].map((v) => fitChoiceOf(v, TOP_FIT_MM)).join(',');
  check('top part: +0.20, 0 and -0.20 mm are Looser, Standard and Snugger', got === 'looser,standard,snugger', got);
  const pocket = [2, 0, -2].map((v) => fitChoiceOf(v, POCKET_FIT_PCT)).join(',');
  check('switch cut-out: +2, 0 and -2 % are Looser, Standard and Snugger', pocket === 'looser,standard,snugger', pocket);
}

{
  // The stepper rounds to its grid, so a value a hair off a choice is that choice; a value a
  // stepper press away from one is not.
  const near = fitChoiceOf(0.2000001, TOP_FIT_MM);
  check('a rounding hair off +0.20 is still Looser', near === 'looser', near);
  const custom = [0.05, 0.1, -0.1, 0.15].map((v) => fitChoiceOf(v, TOP_FIT_MM));
  check('top part: +0.05, +0.10, -0.10 and +0.15 mm are Custom', custom.every((c) => c === 'custom'), custom.join(','));
  const pocket = [1, 0.5, -2.5, 5].map((v) => fitChoiceOf(v, POCKET_FIT_PCT));
  check('switch cut-out: +1, +0.5, -2.5 and +5 % are Custom', pocket.every((c) => c === 'custom'), pocket.join(','));
}

for (const [name, table, min, max, step] of tables) {
  const back = keys.map((k) => fitChoiceOf(table[k], table));
  check(`${name}: each choice's number reads back as that choice`, back.join(',') === keys.join(','), back.join(','));
  const onGrid = keys.every((k) => {
    const v = table[k];
    return v >= min && v <= max && Math.abs(v / step - Math.round(v / step)) < 1e-9;
  });
  check(`${name}: every choice is a number its stepper can show`, onGrid, keys.map((k) => table[k]).join(', '));
  check(
    `${name}: Looser is above Standard, which is 0, above Snugger`,
    table.looser > table.standard && table.standard === 0 && table.standard > table.snugger,
    `${table.looser} > ${table.standard} > ${table.snugger}`,
  );
}

// ---- the row itself: the kit's segmented control as one card per choice, as update() drives it
// (src/ui/fitChoiceRow.ts). Each choice says what it does in the words it is given.
{
  const written: number[] = [];
  const row = fitChoiceRow('1 · Top part on the switch', 'How tightly.', TOP_FIT_MM, { looser: 'Looser', standard: 'Standard', snugger: 'Snugger' }, (v) => written.push(v));
  type Tab = HTMLElement & { click(): void };
  const tabs = () => [...row.querySelectorAll('.vl-tab')] as Tab[];
  const tab = (name: string) => tabs().find((t) => t.textContent === name)!;
  const picked = () => tabs().filter((t) => t.getAttribute('aria-checked') === 'true').map((t) => t.textContent).join(',');
  const showing = () => tabs().filter((t) => t.style.display !== 'none').map((t) => t.textContent).join(',');
  check('built: Standard picked, Custom not offered', picked() === 'Standard' && showing() === 'Looser,Standard,Snugger', `${picked()} of ${showing()}`);
  row.show(0.15);
  check('a number none of the three is (0.15 mm): Custom appears, picked', picked() === 'Custom' && showing() === 'Looser,Standard,Snugger,Custom', `${picked()} of ${showing()}`);
  tab('Custom').click();
  check('pressing Custom writes nothing', written.length === 0, written.join(','));
  tab('Snugger').click();
  check('pressing Snugger from Custom writes its number through the stepper\'s callback', written.join(',') === '-0.2', written.join(','));
  row.show(0.2);
  check('the number 0.20 mm: Looser picked, Custom gone again', picked() === 'Looser' && showing() === 'Looser,Standard,Snugger', `${picked()} of ${showing()}`);
  tab('Standard').click();
  check('pressing Standard writes 0', written.join(',') === '-0.2,0', written.join(','));
}
{
  const live = new Set<string>(FIT_TEST_LIVE);
  const kept = ['topFitMount', 'fitHandLabel', 'stemFitMount', 'stemOuterMount', 'fitTestBlock'];
  const locked = ['pocketFitMount', 'gapTolMount', 'socketFitMount'];
  check('during the fit test: the top part\'s choice, its steppers, "By hand" and the test stay live',
    kept.every((id) => live.has(id)), [...live].join(', '));
  check('...and the cut-out choice, Top / base gap and the pocket stepper lock', locked.every((id) => !live.has(id)), locked.join(', '));
}

console.log(failures ? `\n${failures} FAILED` : '\nthe simple fit choices are the steppers\' own numbers');
process.exit(failures ? 1 : 0);
