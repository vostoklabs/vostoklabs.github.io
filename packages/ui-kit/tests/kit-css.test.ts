/*
  What the kit's stylesheets do to its blocks, cascaded onto the stand-in document
  (support/cascade.ts): the values that win at a window width, in a theme and a density.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, type MiniElement } from './support/mini-dom';
import { kitRules, cssValue } from './support/cascade';
import { el } from '../src/dom';
import { ICONS } from '../src/icons';
import { appShell } from '../src/components/app-shell';
import { settingsRail } from '../src/components/settings-rail';
import { previewCard } from '../src/components/preview-card';
import { stageStatus } from '../src/components/stage';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const rules = kitRules();
const v = (e: unknown, prop: string, width: number) => cssValue(e as MiniElement, prop, rules, width);
const mount = (node: unknown) => {
  miniDocument.body.replaceChildren(node as MiniElement);
  return node as MiniElement;
};
const RAIL = () => [
  { id: 'shape', label: 'Shape', icon: ICONS.box, body: [el('p', { text: 'a' })] },
  { id: 'text', label: 'Text', icon: ICONS.text, body: [el('p', { text: 'b' })] },
];

/* ------------------------------------------------- a flush settings rail on a phone */

{
  const flush = appShell({ left: { compact: true, scroll: [settingsRail({ flush: true, items: RAIL() })] }, right: { scroll: [] } });
  const left = mount(flush.root).querySelector('.vl-panel--left')!;
  const scroll = left.querySelector('.vl-panel__scroll')!;
  check('flush rail, phone (390 px): the scroll lets the rail out', v(scroll, 'overflow-y', 390) === 'visible' && v(scroll, 'flex-grow', 390) === '0');
  check('flush rail, phone: its panel is not capped at half the screen, so nothing is cut off', v(left, 'max-height', 390) === 'none', v(left, 'max-height', 390));
  check('flush rail, desktop: the scroll does not scroll (the open category does)', v(scroll, 'overflow-y', 1280) === 'hidden');

  const plain = appShell({ left: { scroll: [el('p', { text: 'rows' })] }, right: { scroll: [] } });
  const plainLeft = mount(plain.root).querySelector('.vl-panel--left')!;
  check('a panel with no flush rail keeps the half-screen cap on a phone, as before', v(plainLeft, 'max-height', 390) === '50vh', v(plainLeft, 'max-height', 390));
}

/* ------------------------------------------------- the preview card at Laser Studio's numbers */

{
  const status = stageStatus('48.7 × 14.4 mm');
  const card = previewCard({ start: [el('div')], end: [el('div')], view: [el('div')], status: status.root });
  mount(el('div', {}, [card.root]));
  check('card: the status line 14 px in from the picture\'s corner', v(status.root, 'bottom', 1280) === '14px' && v(status.root, 'left', 1280) === '14px');
  check('card: the status line on its own ground', v(status.root, 'background', 1280).startsWith('color-mix(in srgb, #101620 78%'), v(status.root, 'background', 1280));
  check('card: a 20 px inset at every width', ['1280', '800', '390'].every((w) => v(card.root, 'top', Number(w)) === '20px'));
  check('card: the bar wraps on a phone only', v(card.bar, 'flex-wrap', 1280) === '' && v(card.bar, 'flex-wrap', 800) === '' && v(card.bar, 'flex-wrap', 390) === 'wrap');
  card.statusBelow(true);
  check('card, statusBelow: in the flow under the strips', v(status.root, 'position', 1280) === 'static' && v(status.root, 'margin-left', 1280) === '16px' && v(status.root, 'margin-bottom', 1280) === '12px');
}

console.log(`\nkit css: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
