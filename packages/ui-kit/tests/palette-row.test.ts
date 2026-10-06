/*
  paletteRow({ detected }) in the stand-in document (support/mini-dom.ts), with the kit's own
  stylesheets cascaded onto it (support/cascade.ts).

  Off by default, and off builds exactly what the row built before the option existed. On, the
  row gains one dot before its label, painted through the CSSOM as the chip beside it is, and
  nothing else in the row changes.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniDocument, type MiniElement } from './support/mini-dom';
import { kitRules, cssValue } from './support/cascade';
import { paletteRow } from '../src/components/filament';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const mini = (node: unknown) => node as MiniElement;
const build = (extra: { detected?: string } = {}) => mini(paletteRow({ label: 'Ears', value: '#F5C518', labelId: 'ears-label', ...extra }));
/** The markup with the one dot taken out. */
const withoutDot = (markup: string) => markup.replace(/<span class="vl-palette-row__detected"[^>]*><\/span>/, '');

const plain = html(build());
const off = build({ detected: undefined });
const on = build({ detected: '#c0392b' });
const dot = on.querySelector('.vl-palette-row__detected');

check('detected: off by default, no dot', !plain.includes('vl-palette-row__detected'));
check('detected: left out builds what the default builds', html(off) === plain);
check('detected: on, one dot, first in the row before the label', !!dot && on.firstElementChild === dot && dot.nextElementSibling === on.querySelector('.vl-palette-row__label'));
check('detected: on adds the dot and nothing else', withoutDot(html(on)) === plain, html(on));
check('detected: the dot carries its colour through the CSSOM, as the chip does', dot?.style.cssText === '--swatch: #c0392b' && !dot.hasAttribute('style'), dot?.style.cssText);
check('detected: a sample, not a control: no role, no tab stop, named by its tooltip only', !!dot && dot.getAttribute('title') === 'Detected colour' && dot.getAttribute('aria-hidden') === 'true' && !dot.hasAttribute('tabindex') && !dot.hasAttribute('role'));
check('detected: the label keeps its text and its id', on.querySelector('.vl-palette-row__label')?.textContent === 'Ears' && on.querySelector('.vl-palette-row__label')?.id === 'ears-label');

// Picking a filament changes the chip, never the colour the part was found in.
on.setValue('#00ae42');
check('detected: setValue paints the chip and leaves the dot', on.querySelector('.vl-color-chip')?.style.getPropertyValue('--swatch') === '#00ae42' && dot?.style.cssText === '--swatch: #c0392b');

// What the stylesheet makes of it.
const rules = kitRules();
miniDocument.body.replaceChildren(on);
const v = (prop: string) => cssValue(dot!, prop, rules, 1280);
check('detected css: a 10 px round dot, border included', v('inline-size') === '10px' && v('block-size') === '10px' && v('box-sizing') === 'border-box' && v('border-radius') === '50%', `${v('inline-size')} ${v('block-size')} ${v('box-sizing')} ${v('border-radius')}`);
check('detected css: painted in the colour it was given', v('background') === '#c0392b', v('background'));
check('detected css: never squeezed by a long label', v('flex-grow') === '0' && v('flex-shrink') === '0', `${v('flex-grow')} ${v('flex-shrink')}`);
miniDocument.body.replaceChildren();

console.log(`\npalette row: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
