/*
  collapsibleSection({ detail }) in the stand-in document (support/mini-dom.ts).

  Off by default, and off the heading is the bare title, built exactly as before. With a detail,
  the value sits at the end of the heading, and setDetail changes it or takes it away.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html } from './support/mini-dom';
import { collapsibleSection } from '../src/components/section';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const plain = collapsibleSection({ title: 'Your time', body: [], open: false });
check('no detail: the heading is the title alone, as before', html(plain.querySelector('summary')!) === '<summary>Your time</summary>', html(plain.querySelector('summary')!));
check('and it starts closed when asked', plain.open === false);

const priced = collapsibleSection({ title: 'Your time', body: [], open: false, detail: '3 parts' });
const value = () => priced.querySelector('.vl-section__detail');
check('a detail sits at the end of the heading', value()?.textContent === '3 parts' && html(priced.querySelector('summary')!).endsWith('3 parts</span></summary>'), html(priced.querySelector('summary')!));
priced.setDetail('4 parts');
check('setDetail changes it in place', value()?.textContent === '4 parts' && priced.querySelectorAll('.vl-section__detail').length === 1);
priced.setDetail('');
check("'' takes it away", value() === null && html(priced.querySelector('summary')!) === '<summary>Your time</summary>');
plain.setDetail('10%');
check('a section built without one can be given one later', plain.querySelector('.vl-section__detail')?.textContent === '10%');

console.log(`\nsection: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
