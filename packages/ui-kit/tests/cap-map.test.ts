/*
  The cap map, in a stand-in document (support/mini-dom.ts) with the kit's stylesheets cascaded
  onto it (support/cascade.ts): a keycap's top with a numbered spot per legend and an "All"
  choice, as one radio group. Taps, the arrow keys, the value accessors, swapping spots and
  shape, and the contrast of every state in both themes.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniDocument, type MiniElement } from './support/mini-dom';
import { kitRules, cssValue } from './support/cascade';
import { contrastRatio } from '../src/components/filament';
import { capMap, type CapMapSpot } from '../src/components/cap-map';
import { syncControls } from '../src/components/controls';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const mini = (node: unknown) => node as MiniElement;

type Legend = 'l1' | 'l2' | 'l3' | 'all';
const THREE: CapMapSpot<Legend>[] = [
  { value: 'l1', label: 'Legend 1', x: 0.25, y: 0.3 },
  { value: 'l2', label: 'Legend 2', x: 0.75, y: 0.3 },
  { value: 'l3', label: 'Legend 3', x: 0.5, y: 0.75 },
];
const ALL = { value: 'all' as const, label: 'All legends' };

const spotsOf = (root: unknown) => mini(root).querySelectorAll('.vl-cap-map__spot');
const allOf = (root: unknown) => mini(root).querySelector('.vl-cap-map__all')!;
const checked = (root: unknown) =>
  mini(root).querySelectorAll('[role="radio"]').filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent);

/* ------------------------------------------------------------------ the markup */

{
  const seen: Legend[] = [];
  const map = capMap<Legend>({ label: 'Legend', help: 'Tap a legend to edit it.', width: 14, height: 14, spots: THREE, value: 'l3', all: ALL, onChange: (v) => seen.push(v) });
  const root = mini(map);
  const group = root.querySelector('.vl-cap-map')!;
  const spots = spotsOf(map);
  check('captioned: a caption line over the map, the group named by it', root.classList.contains('vl-control') && group.getAttribute('aria-labelledby') === root.querySelector('.vl-control-label > span')!.id && !!root.querySelector('.vl-help'));
  check('a radio group of the spots and All', group.getAttribute('role') === 'radiogroup' && group.querySelectorAll('[role="radio"]').length === 4);
  check('the spots are numbered from 1, in order', spots.map((s) => s.textContent).join() === '1,2,3');
  check('each spot is named for a screen reader and the tooltip', spots.map((s) => `${s.getAttribute('aria-label')}|${s.title}`).join() === 'Legend 1|Legend 1,Legend 2|Legend 2,Legend 3|Legend 3');
  check('every choice is a real button', group.querySelectorAll('[role="radio"]').every((b) => b.localName === 'button' && b.getAttribute('type') === 'button'));
  check('the chosen spot is checked and marked', checked(map).join() === '3' && spots[2]!.classList.contains('is-active') && !spots[0]!.classList.contains('is-active'));
  check('one Tab stop, on the choice', group.querySelectorAll('[role="radio"]').map((b) => b.tabIndex).join() === '-1,-1,0,-1');
  check('All is under the picture, last in the group', group.lastElementChild === allOf(map) && allOf(map).textContent === 'All legends');
  const art = root.querySelector('.vl-cap-map__art')!;
  check('the picture is decoration to a screen reader', art.getAttribute('aria-hidden') === 'true' && art.namespaceURI === 'http://www.w3.org/2000/svg');
  check('the picture is drawn without a style attribute', !html(art).includes('style='));

  // 14 x 14 mm top, a rim of 14% of 14 = 1.96 mm all round: 17.92 mm overall.
  check('the picture is the top plus its rim', art.getAttribute('viewBox') === '0 0 17.92 17.92', art.getAttribute('viewBox')!);
  const top = root.querySelector('.vl-cap-map__top')!;
  check('the top is inset by its rim', top.getAttribute('x') === '1.96' && top.getAttribute('width') === '14', `${top.getAttribute('x')} ${top.getAttribute('width')}`);
  const face = root.querySelector('.vl-cap-map__face')!;
  check('a square cap: the face is square', face.style.getPropertyValue('--cap-ratio') === '1', face.style.getPropertyValue('--cap-ratio'));
  // Spot 1 at x 0.25: (1.96 + 0.25 * 14) / 17.92 = 30.469%.
  check('a spot sits where it says on the top, measured on the face', spots[0]!.style.getPropertyValue('left') === '30.469%' && spots[0]!.style.getPropertyValue('top') === '34.375%', `${spots[0]!.style.cssText}`);
  check('spots are placed through the CSSOM: left and top only', spots.every((s) => /^left: [\d.]+%; top: [\d.]+%;$/.test(s.style.cssText)), spots[0]!.style.cssText);

  /* --------------------------------------------------------------- choosing -- */

  spots[0]!.click();
  check('a tap picks that legend', map.getValue() === 'l1' && seen.join() === 'l1' && checked(map).join() === '1');
  spots[0]!.click();
  check('a tap on the chosen spot fires nothing', seen.length === 1);
  allOf(map).click();
  check('All picks every legend at once', map.getValue() === 'all' && seen.join() === 'l1,all' && checked(map).join() === 'All legends');
  check('with All chosen, every spot is marked as part of it and none is filled', spots.every((s) => s.classList.contains('is-included') && !s.classList.contains('is-active')));
  spots[1]!.click();
  check('a spot after All: the marks go', spots.every((s) => !s.classList.contains('is-included')) && map.getValue() === 'l2');

  // The radio-group keys, as `segmentedControl` has them.
  const key = (k: string) => {
    const ev = { type: 'keydown', key: k, defaultPrevented: false };
    group.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  key('ArrowRight');
  check('ArrowRight steps to the next spot and focuses it', map.getValue() === 'l3' && miniDocument.activeElement === spots[2]);
  key('ArrowDown');
  check('after the last spot comes All', map.getValue() === 'all' && miniDocument.activeElement === allOf(map));
  key('ArrowRight');
  check('and after All, back round to the first', map.getValue() === 'l1');
  key('ArrowLeft');
  check('ArrowLeft wraps the other way, to All', map.getValue() === 'all');
  key('Home');
  check('Home: the first spot', map.getValue() === 'l1');
  key('End');
  check('End: the last choice (All)', map.getValue() === 'all');
  check('the arrow keys are taken from the page (no scroll)', key('ArrowUp') === true);
  check('other keys are left alone', key('a') === false && map.getValue() === 'l3');
  check('the Tab stop follows the choice', group.querySelectorAll('[role="radio"]').map((b) => b.tabIndex).join() === '-1,-1,0,-1');

  /* ---------------------------------------------------------- the accessors -- */

  const before = seen.length;
  map.setValue('l2');
  check('setValue shows a choice and fires nothing', map.getValue() === 'l2' && checked(map).join() === '2' && seen.length === before);
  map.setValue('l9' as Legend);
  check('setValue ignores a choice it does not offer', map.getValue() === 'l2');
  map.setValue('l1', true);
  check('setValue(…, true) fires onChange', seen[seen.length - 1] === 'l1');
  const state: { legend: Legend } = { legend: 'l3' };
  syncControls(state, { legend: map });
  check('syncControls takes it like any control', map.getValue() === 'l3');

  map.setDisabled(true);
  check('setDisabled greys it and stops every choice', root.classList.contains('vl-control--disabled') && root.getAttribute('aria-disabled') === 'true' && group.querySelectorAll('[role="radio"]').every((b) => b.disabled));
  spots[0]!.click();
  check('disabled, a tap does nothing', map.getValue() === 'l3');
  check('disabled, the keys do nothing', key('ArrowRight') === false && map.getValue() === 'l3');
  map.setDisabled(false);
  check('enabled again', !root.classList.contains('vl-control--disabled') && group.querySelectorAll('[role="radio"]').every((b) => !b.disabled));

  /* --------------------------------------------------- new spots, new shape -- */

  const n = seen.length;
  map.setSpots(THREE.slice(0, 2));
  check('setSpots: two legends now, numbered 1 and 2, All still last', spotsOf(map).map((s) => s.textContent).join() === '1,2' && group.lastElementChild === allOf(map));
  check('setSpots: legend 3 was chosen and is gone, so the first is chosen and the app told', map.getValue() === 'l1' && seen.length === n + 1 && seen[n] === 'l1' && checked(map).join() === '1');
  map.setSpots(THREE);
  check('setSpots: a choice still offered stays, and nothing fires', map.getValue() === 'l1' && seen.length === n + 1 && spotsOf(map).length === 3);
  map.setValue('all');
  map.setSpots(THREE.slice(0, 1));
  check('setSpots with All chosen: All stays, the spot is marked as part of it', map.getValue() === 'all' && spotsOf(map)[0]!.classList.contains('is-included'));

  map.setSpots(THREE);
  map.setShape(32.5, 14);
  // A 2u top: 32.5 x 14 mm, a rim of 1.96 mm: 36.42 x 17.92.
  check('setShape: the picture takes the new proportions', root.querySelector('.vl-cap-map__art')!.getAttribute('viewBox') === '0 0 36.42 17.92' && face.style.getPropertyValue('--cap-ratio') === '2.0324', `${face.style.getPropertyValue('--cap-ratio')}`);
  // Spot 2 at x 0.75: (1.96 + 0.75 * 32.5) / 36.42 = 72.309%.
  check('setShape: the spots keep their places on the top', spotsOf(map)[1]!.style.getPropertyValue('left') === '72.309%', spotsOf(map)[1]!.style.getPropertyValue('left'));
  map.setShape(0, -3);
  check('setShape: a nonsense size draws a square rather than nothing', root.querySelector('.vl-cap-map__art')!.getAttribute('viewBox') === '0 0 1.28 1.28');
}

{
  // Without a caption or All: the group alone, every choice a spot.
  const bare = capMap({ width: 18, height: 18, spots: [{ value: 'a', label: 'Legend 1', x: 2, y: -1 }], value: 'a', onChange() {} });
  check('uncaptioned: the radio group is the element', mini(bare).getAttribute('role') === 'radiogroup' && !mini(bare).querySelector('.vl-control-label'));
  check('without all: no All choice', !allOf(bare));
  check('a spot off the top is held on its edge', spotsOf(bare)[0]!.style.getPropertyValue('left') === `${Number((((18 * 0.14) + 18) / (18 * 1.28) * 100).toFixed(3))}%` && spotsOf(bare)[0]!.style.getPropertyValue('top') === `${Number(((18 * 0.14) / (18 * 1.28) * 100).toFixed(3))}%`, spotsOf(bare)[0]!.style.cssText);
  const none = capMap({ width: 18, height: 18, spots: [], value: 'x', onChange() {} });
  check('no spots at all: built, and the keys do nothing', spotsOf(none).length === 0 && (mini(none).dispatchEvent({ type: 'keydown', key: 'ArrowRight' }), none.getValue() === 'x'));
}

/* ------------------------------------------- what the stylesheet does, in both themes */

{
  const rules = kitRules();
  const v = (e: unknown, prop: string) => cssValue(e as MiniElement, prop, rules, 1280);
  const mount = (node: unknown) => {
    miniDocument.body.replaceChildren(node as MiniElement);
    return node as MiniElement;
  };
  const hex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);
  const ratio = (a: string, b: string) => (hex(a) && hex(b) ? contrastRatio(a, b) : 0);

  for (const theme of ['dark', 'light'] as const) {
    miniDocument.documentElement.setAttribute('data-theme', theme);
    const map = capMap<Legend>({ width: 14, height: 14, spots: THREE, value: 'l2', all: ALL, onChange() {} });
    mount(map);
    const [off, on] = spotsOf(map) as [MiniElement, MiniElement];
    const top = v(mini(map).querySelector('.vl-cap-map__top'), 'fill');
    const say = (what: string, a: string, b: string, min: number) =>
      check(`${theme}: ${what}, ${ratio(a, b).toFixed(2)}:1 (>= ${min})`, ratio(a, b) >= min, `${a} on ${b}`);

    say('a spot\'s number on its disc', v(off, 'color'), v(off, 'background'), 4.5);
    say('a spot\'s edge against the top it sits on', v(off, 'border-top-color') || v(off, 'border').split(' ').pop()!, top, 3);
    say('the chosen spot\'s number on its accent disc', v(on, 'color'), v(on, 'background'), 4.5);
    const ring = v(on, 'box-shadow');
    const ringColour = ring.split(',').pop()!.trim().split(' ').pop()!;
    say('the chosen spot\'s accent ring against the top', ringColour, top, 3);
    check(`${theme}: the ring stands off the disc by the top's own colour`, ring.startsWith(`0 0 0 2px ${top}`), ring);
    check(`${theme}: chosen and not chosen differ in fill, not only in colour of text`, v(on, 'background') !== v(off, 'background'));

    mini(allOf(map)).click();
    const included = spotsOf(map)[0]!;
    say('with All chosen, a marked spot\'s number', v(included, 'color'), v(included, 'background'), 4.5);
    const allButton = allOf(map);
    say('All, chosen: its words on the accent', v(allButton, 'color'), v(allButton, 'background'), 4.5);
    spotsOf(map)[0]!.click();
    say('All, not chosen: its words on its ground', v(allButton, 'color'), v(allButton, 'background'), 4.5);
  }
  miniDocument.documentElement.removeAttribute('data-theme');

  const map = mount(capMap({ width: 14, height: 14, spots: THREE, value: 'l1', onChange() {} }));
  const spot = spotsOf(map)[0]!;
  check('a spot is centred on its place', v(spot, 'transform') === 'translate(-50%, -50%)' && v(spot, 'position') === 'absolute');
  check('a spot is a 24 px disc', v(spot, 'width') === '24px' && v(spot, 'height') === '24px' && v(spot, 'border-radius') === '50%');
  check('the face is sized from the cap\'s proportions', v(map.querySelector('.vl-cap-map__face'), 'aspect-ratio') === '1');
  check('the state changes on the hover tier, never a hand-typed time', /110ms/.test(v(spot, 'transition')) && !/\b0?\.\d+s\b/.test(v(spot, 'transition')), v(spot, 'transition'));
}

console.log(`\ncap map: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
