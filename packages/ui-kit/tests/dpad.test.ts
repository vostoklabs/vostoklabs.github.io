/*
  dpad(): the centre button's words, in the stand-in document (support/mini-dom.ts).

  By default the centre says "Back to the middle" (tooltip) and "Reset to center" (its name), as
  every pad has said so far. `centreLabel` replaces both, for a pad whose centre sends the thing
  to a place of its own. `rotate: false` leaves out the two turn corners.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { dpad } from '../src/components/dpad';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const plain = dpad();
const centre = plain.root.querySelector('.vl-dpad-center');
check('the centre is there', !!centre);
check('default tooltip unchanged', centre?.getAttribute('title') === 'Back to the middle', centre?.getAttribute('title') ?? '');
check('default name unchanged', centre?.getAttribute('aria-label') === 'Reset to center', centre?.getAttribute('aria-label') ?? '');
check('turn corners by default', plain.root.querySelectorAll('.vl-dpad-btn--rot').length === 2);

const chevrons = dpad({ glyphs: 'chevrons' });
check('chevron pad keeps the default centre tooltip',
  chevrons.root.querySelector('.vl-dpad-center')?.getAttribute('title') === 'Back to the middle');

let resets = 0;
const own = dpad({ rotate: false, centreLabel: 'Back to its place', onReset: () => resets++ });
const ownCentre = own.root.querySelector('.vl-dpad-center');
check('centreLabel is the tooltip', ownCentre?.getAttribute('title') === 'Back to its place', ownCentre?.getAttribute('title') ?? '');
check('centreLabel is the name', ownCentre?.getAttribute('aria-label') === 'Back to its place', ownCentre?.getAttribute('aria-label') ?? '');
check('the arrows keep their own names', own.root.querySelector('.vl-dpad-right')?.getAttribute('aria-label') === 'Move right');
check('rotate: false leaves out the turn corners', own.root.querySelectorAll('.vl-dpad-btn--rot').length === 0);
ownCentre?.dispatchEvent({ type: 'click', detail: 0 } as never);
check('the centre still resets', resets === 1, String(resets));

console.log(`\ndpad: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
