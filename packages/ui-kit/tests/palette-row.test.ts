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
import { FILAMENTS, filamentRow, paletteRow } from '../src/components/filament';
import { stepperRow } from '../src/components/controls';

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

// detected as a list: every picture colour that prints in this filament, as a run of dots
// straight after the label, so rows with different counts keep their labels aligned.
{
  const many = build({ detected: ['#c0392b', '#e67e22', '#f1c40f'] } as never);
  const label = many.querySelector('.vl-palette-row__label');
  const run = many.querySelector('.vl-palette-row__dots');
  check('detected list: no single dot before the label', many.firstElementChild === label);
  check('detected list: one run, straight after the label', !!run && label?.nextElementSibling === run);
  const dots = run ? [...run.children] : [];
  check('detected list: a dot per colour, in order, each through the CSSOM', dots.length === 3
    && dots.map((d) => (d as MiniElement).style.cssText).join() === '--swatch: #c0392b,--swatch: #e67e22,--swatch: #f1c40f'
    && dots.every((d) => !(d as MiniElement).hasAttribute('style')), dots.map((d) => (d as MiniElement).style.cssText).join());
  check('detected list: a sample, not a control', run?.getAttribute('aria-hidden') === 'true' && !run.hasAttribute('tabindex'));
  const empty = build({ detected: [] } as never);
  check('detected list: an empty list builds what no list builds', html(empty) === plain);
  miniDocument.body.replaceChildren(many);
  const lv = (prop: string) => cssValue(label!, prop, rules, 1280);
  check('detected list css: the label gives the free space to the dots', lv('flex-grow') === '0', lv('flex-grow'));
  miniDocument.body.replaceChildren();
}

// filamentRow.setExtra: the swatches a row offers first change after it is built (a colour the
// customer made), the shelf follows them without repeating one, and nothing else changes.
{
  const plain = filamentRow({ label: 'Card', value: '#161616' });
  // The swatch buttons only: the custom picker wears the swatch class too.
  const swatchCount = (r: unknown) => (r as MiniElement).querySelector('.vl-swatches')!.children.length;
  check('filamentRow: the shelf alone by default', swatchCount(plain) === FILAMENTS.length);
  const before = html(plain);
  plain.setExtra([]);
  check('filamentRow setExtra([]): builds what it built', html(plain) === before);
  plain.setExtra([['Your colour', '#123456']]);
  const first = (plain as unknown as MiniElement).querySelector('.vl-swatches')!.firstElementChild!;
  check('filamentRow setExtra: the new colour comes first', first.getAttribute('title') === 'Your colour' && swatchCount(plain) === FILAMENTS.length + 1);
  plain.setExtra([['Mine', '#161616']]);
  check('filamentRow setExtra: a shelf colour given again is not offered twice', swatchCount(plain) === FILAMENTS.length);
  check('filamentRow setExtra: the value is kept', plain.getValue() === '#161616');
}

// stepperRow({ swatch }): one value per colour (how far each colour is raised), the colour as
// the same sample dot before the caption. Off, the row is what it always was.
{
  const base = { label: 'Orange', min: -1, max: 5, value: 0 };
  // Each build numbers its own ids (`vl-cap-3`, `vl-val-4`); the markup is what is compared.
  const unnumbered = (m: string) => m.replace(/(vl-[a-z]+)-\d+/g, '$1');
  const stacked = unnumbered(html(mini(stepperRow(base))));
  const off = unnumbered(html(mini(stepperRow({ ...base, swatch: undefined }))));
  check('stepper swatch: off builds what the default builds', off === stacked, off);
  const row = mini(stepperRow({ ...base, swatch: '#ff8800' }));
  const label = row.querySelector('.vl-slider-head > label');
  const dot = label?.firstElementChild;
  check('stepper swatch: a dot first in the caption, before its text', !!dot && dot.className === 'vl-row-swatch' && dot.nextElementSibling?.textContent === 'Orange');
  check('stepper swatch: painted through the CSSOM, a sample not a control', dot?.style.cssText === '--swatch: #ff8800' && !dot.hasAttribute('style') && dot.getAttribute('aria-hidden') === 'true');
  check('stepper swatch: the row is still the caption over the stepper', row.className === 'vl-slider-row' && row.children.length === 2);
  miniDocument.body.replaceChildren(row);
  const r = (node: MiniElement, prop: string) => cssValue(node, prop, rules, 1280);
  check('stepper swatch css: the 10 px round sample dot', r(dot!, 'inline-size') === '10px' && r(dot!, 'border-radius') === '50%', `${r(dot!, 'inline-size')} ${r(dot!, 'border-radius')}`);
  miniDocument.body.replaceChildren();
}

console.log(`\npalette row: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
