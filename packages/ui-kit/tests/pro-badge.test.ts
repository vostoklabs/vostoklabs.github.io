/*
  The paid badge on an option: `segmentedControl` options in every variant and `previewBar`
  modes take `badge`, drawn as the very pill `button({ badge })` draws, in a stand-in document
  (support/mini-dom.ts) with the kit's stylesheets cascaded onto it (support/cascade.ts).

  Without `badge` every option is built exactly as before; with it, the option gains the pill
  (and, on a tab, a span round its label) and nothing else, and no inline style.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniDocument, MiniElement } from './support/mini-dom';
import { kitRules, cssValue } from './support/cascade';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { el } from '../src/dom';
import { ICONS } from '../src/icons';
import { button } from '../src/components/button';
import { segmentedControl, type SegmentedOption } from '../src/components/controls';
import { previewBar } from '../src/components/stage';
import { chip } from '../src/components/elements';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

/** Markup with the counter ids renumbered from the start, so two builds compare. */
function norm(node: unknown): string {
  const seen = new Map<string, string>();
  return html(node as MiniElement).replace(/\b(vl-[a-z]+)-(\d+)\b/g, (m, prefix: string) => {
    if (!seen.has(m)) seen.set(m, `${prefix}-#${seen.size}`);
    return seen.get(m)!;
  });
}
const mini = (node: unknown) => node as MiniElement;
const styles = (markup: string) => (markup.match(/ style="/g) ?? []).length;

/* The pill exactly as `button({ badge })` drew it before it had a function of its own: the
   refactor that lets the tabs share it must not have moved a byte of it. */
const PILL =
  '<span class="vl-btn__badge"><span class="vl-btn__badge-icon"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M12 2l2.2 6.4a2 2 0 0 0 1.4 1.4L22 12l-6.4 2.2a2 2 0 0 0-1.4 1.4L12 22l-2.2-6.4'
  + 'a2 2 0 0 0-1.4-1.4L2 12l6.4-2.2a2 2 0 0 0 1.4-1.4z"/></svg></span><span>Pro</span></span>';

{
  const b = button({ label: 'Draw your own', badge: 'Pro' });
  check('button badge: the same markup it always drew', html(mini(b)) === `<button class="vl-btn vl-btn--badged" type="button"><span class="vl-btn__text">Draw your own</span>${PILL}</button>`, html(mini(b)));
  b.setBadge('Paid');
  check('button badge: setBadge still rewrites the word', mini(b).querySelector('.vl-btn__badge')!.textContent === 'Paid');
}

/* ------------------------------------------------------------- segmented control */

const OPTS = (badge?: string): SegmentedOption[] => [
  { value: 'one', label: 'One cap' },
  { value: 'set', label: 'Full set', ...(badge === undefined ? {} : { badge }) },
];
const VARIANTS = ['tabs', 'cards', 'pictures', 'tiles'] as const;

for (const variant of VARIANTS) {
  const build = (badge?: string, icon = false) =>
    segmentedControl({
      variant,
      options: OPTS(badge).map((o) => (icon ? { ...o, icon: ICONS.box } : o)),
      value: 'one',
      ...(variant === 'cards' ? { columns: 2 } : {}),
    });
  const plain = norm(build());
  check(`${variant}: no badge builds no pill`, !plain.includes('vl-btn__badge') && !plain.includes('vl-tab--badged'));
  check(`${variant}: badge: undefined builds what the default builds`, norm(build(undefined)) === plain);
  const badged = build('Pro');
  const markup = norm(badged);
  const tab = mini(badged).querySelectorAll('.vl-tab')[1]!;
  const first = mini(badged).querySelectorAll('.vl-tab')[0]!;
  check(`${variant}: the badged option carries the button's own pill`, tab.innerHTML.includes(PILL), tab.innerHTML);
  check(`${variant}: only that option has one`, mini(badged).querySelectorAll('.vl-btn__badge').length === 1 && !first.innerHTML.includes('vl-btn__badge'));
  check(`${variant}: the other option is built as before`, html(first) === html(mini(build()).querySelectorAll('.vl-tab')[0]!));
  check(`${variant}: the badged option says so in its class`, tab.classList.contains('vl-tab--badged'));
  check(`${variant}: no inline style for it`, styles(markup) === styles(plain));
  check(`${variant}: the option's name still reads label first`, tab.textContent.startsWith('Full set'), tab.textContent);
  if (variant === 'tabs' || variant === 'cards') {
    check(`${variant}: the label sits in a span of its own before the pill`, tab.querySelector('.vl-tab__name')?.textContent === 'Full set' && tab.lastElementChild!.classList.contains('vl-btn__badge'));
    const withIcon = mini(build('Pro', true)).querySelectorAll('.vl-tab')[1]!;
    const order = withIcon.childNodes.map((c) => (c instanceof MiniElement ? c.className : html(c).startsWith('<svg') ? 'svg' : '?')).join(',');
    check(`${variant}: with an icon, icon then label then pill`, order === 'svg,vl-tab__name,vl-btn__badge', order);
  } else {
    check(`${variant}: the pill follows the name inside the label`, tab.querySelector('.vl-tab__label')!.lastElementChild!.classList.contains('vl-btn__badge'));
  }

  // Behaviour is untouched: a tap picks, the arrow keys move, a badged option is an option.
  let picked = '';
  const live = segmentedControl({ variant, options: OPTS('Pro'), value: 'one', onChange: (v) => (picked = v) });
  mini(live).querySelectorAll('.vl-tab')[1]!.click();
  check(`${variant}: a tap on the badged option picks it`, picked === 'set' && live.getValue() === 'set');
  mini(live).dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
  check(`${variant}: the arrow keys still move the choice`, live.getValue() === 'one');

  // setBadge: off, the tab is drawn as it is built without a badge; on again, as built with one.
  for (const icon of [false, true]) {
    const at = icon ? ' (with an icon)' : '';
    const flip = build('Pro', icon);
    flip.setBadge('set', null);
    check(`${variant}${at}: setBadge(null) draws the tab as built without a badge`, norm(flip) === norm(build(undefined, icon)), norm(flip));
    flip.setBadge('set', 'Pro');
    check(`${variant}${at}: setBadge back draws it as built with one`, norm(flip) === norm(build('Pro', icon)), norm(flip));
  }
  const grown = build();
  grown.setBadge('set', 'Pro');
  check(`${variant}: a badge on an option built without one draws it as built with one`, norm(grown) === norm(build('Pro')));
  grown.setBadge('nope' as never, 'Pro');
  check(`${variant}: setBadge on a value it does not have changes nothing`, norm(grown) === norm(build('Pro')));
}

/* What the stylesheet does with it: the label gives way, the pill does not. */
{
  const rules = kitRules();
  const v = (e: unknown, prop: string) => cssValue(e as MiniElement, prop, rules, 1280);
  const mount = (node: unknown) => {
    miniDocument.body.replaceChildren(node as MiniElement);
    return node as MiniElement;
  };

  const tabs = mount(segmentedControl({ options: OPTS('Pro'), value: 'one' }));
  const tab = tabs.querySelectorAll('.vl-tab')[1]!;
  const name = tab.querySelector('.vl-tab__name')!;
  const pill = tab.querySelector('.vl-btn__badge')!;
  check('tab: the badged tab lays out label and pill on one centred line', v(tab, 'display') === 'flex' && v(tab, 'justify-content').endsWith('center') && v(tab, 'align-items') === 'center');
  check('tab: a long label ellipsises in its own span', v(name, 'overflow-x') === 'hidden' && v(name, 'text-overflow') === 'ellipsis');
  check('tab: the label stays on one line', v(name, 'white-space') === 'nowrap');
  check('tab: the pill never shrinks', v(pill, 'flex-shrink') === '0' && v(pill, 'white-space') === 'nowrap');
  check('tab: the pill sits beside the label, not at the far edge', v(pill, 'margin-left') === '0');
  check('tab: the pill is sized from the tab, as on a button', v(pill, 'font-size') === '0.62em');
  const plainTab = tabs.querySelectorAll('.vl-tab')[0]!;
  check('tab: a tab with no badge keeps its own layout', v(plainTab, 'display') === '' && v(plainTab, 'text-overflow') === 'ellipsis');

  const cards = mount(segmentedControl({ variant: 'cards', columns: 2, options: OPTS('Pro'), value: 'one' }));
  const card = cards.querySelectorAll('.vl-tab')[1]!;
  check('card: keeps the card layout (left-aligned)', v(card, 'justify-content') === 'flex-start');
  check('card: the pill goes to the trailing edge, as on a button', v(card.querySelector('.vl-btn__badge'), 'margin-left') === 'auto');
  const stacked = mount(segmentedControl({ variant: 'cards', stacked: true, columns: 2, options: OPTS('Pro'), value: 'one' }));
  check('stacked card: the pill is centred under the name', v(stacked.querySelectorAll('.vl-tab')[1]!.querySelector('.vl-btn__badge'), 'margin-left') === '0');
  for (const variant of ['pictures', 'tiles'] as const) {
    const pics = mount(segmentedControl({ variant, options: OPTS('Pro'), value: 'one' }));
    const t = pics.querySelectorAll('.vl-tab')[1]!;
    check(`${variant}: keeps its grid layout`, v(t, 'display') === 'grid');
    check(`${variant}: the pill follows the name with a gap`, v(t.querySelector('.vl-btn__badge'), 'margin-left') === '6px');
    check(`${variant}: not a size container (its pill is inside the name)`, v(t, 'container-type') === 'normal');
  }
}

/* setOptionLabel: a tile renamed while on screen (the shape in use when it is none of the offered
   ones) changes its words and keeps its picture and its badge; a plain tab has no tile label, so
   asking changes nothing. */
for (const variant of ['pictures', 'tiles'] as const) {
  const row = segmentedControl({ variant, options: OPTS('Pro'), value: 'one' });
  const tile = mini(row).querySelectorAll('.vl-tab')[1]!;
  const picture = tile.querySelector('.vl-tab__picture');
  row.setOptionLabel('set', 'Pumpkin');
  const name = tile.querySelector('.vl-tab__label');
  const said = name?.textContent ?? '';
  check(`${variant} setOptionLabel: the tile says its new name`, said.startsWith('Pumpkin') && !said.includes('Full set'), said);
  check(`${variant} setOptionLabel: the badge stays after it`, name?.querySelectorAll('.vl-btn__badge').length === 1);
  check(`${variant} setOptionLabel: the picture is untouched`, tile.querySelector('.vl-tab__picture') === picture);
}
{
  const tabs = segmentedControl({ options: OPTS(), value: 'one' });
  const before = norm(tabs);
  tabs.setOptionLabel('set', 'Pumpkin');
  check('tabs setOptionLabel: a plain tab is left as built', norm(tabs) === before);
}

/* A number must never disappear. Three tabs "1 | 2 Pro | 3 Pro" in a 200 px rail leave each tab
   about 45 px inside: the label "2" once got none of it beside a full pill. Now:
   - the label keeps two characters' width, so a 1-character label is never squeezed below itself;
   - the tab is a size container, and below 5em the pill keeps its sparkle and drops its word;
   - what still does not fit is clipped at the tab's END (`safe` centring), which is the pill. */
{
  const css = readFileSync(join(process.cwd(), 'src', 'components.css'), 'utf8');
  const query = /@container\s+vl-tab\s+\(max-width:\s*([\d.]+)em\)\s*\{([\s\S]*?)\n\}/.exec(css);
  check('narrow: the tight state is a container rule on the tab', !!query, 'no @container vl-tab rule in components.css');
  const tight = kitRules(query?.[2] ?? '');
  const normal = kitRules();
  const v = (e: unknown, prop: string, rules = normal) => cssValue(e as MiniElement, prop, rules, 1280);
  miniDocument.body.replaceChildren(el('div', { className: 'vl-panel' }));
  const rail = segmentedControl({
    options: [{ value: '1', label: '1' }, { value: '2', label: '2', badge: 'Pro' }, { value: '3', label: '3', badge: 'Pro' }],
    value: '1',
  });
  miniDocument.body.firstElementChild!.append(mini(rail));
  const tab = mini(rail).querySelectorAll('.vl-tab')[1]!;
  const name = tab.querySelector('.vl-tab__name')!;
  const pill = tab.querySelector('.vl-btn__badge')!;
  const word = pill.lastElementChild!;
  const spark = pill.firstElementChild!;

  check('narrow: a 1-character label keeps its text (min-width 2ch, wider than one character)', name.textContent === '2' && v(name, 'min-width') === '2ch');
  check('narrow: the short label is centred in what it keeps', v(name, 'text-align') === 'center');
  check('narrow: the badged tab is a size container named vl-tab', v(tab, 'container-type') === 'inline-size' && v(tab, 'container-name') === 'vl-tab');
  check('narrow: overflow is clipped at the end, never the start (safe centring)', v(tab, 'justify-content') === 'safe center' && v(tab, 'overflow-x') === 'hidden');
  check('narrow: the label comes first, so the end that is clipped is the pill', tab.firstElementChild === name && tab.lastElementChild === pill);
  // The threshold has to be wider than what the whole line needs with the word, or a tab with
  // room for "2 ✦ PRO" would drop the word and one without room would keep it. The kit's own
  // numbers at the panel size (15 px): the label's 2ch (a digit is about 0.55em), the 6 px gap,
  // the pill's 12 px padding, 2 px border, its 1em sparkle, 3 px gap and three capitals with
  // their letter-spacing at 0.62em (about 47 px, as drawn).
  const em = 15;
  const pillEm = 0.62 * em;
  const needs = 2 * 0.55 * em + 6 + 12 + 2 + pillEm + 3 + 3 * (0.7 + 0.05) * pillEm;
  const at = Number(query?.[1] ?? 0) * em;
  check(`narrow: the word goes below ${at} px, above the ${needs.toFixed(0)} px label and whole pill need`, at >= needs && at <= needs + 15, `${at} vs ${needs}`);

  check('roomy: the pill shows its word', v(word, 'position') === '' && v(word, 'clip-path') === '');
  check('tight: the word is not drawn', v(word, 'position', tight) === 'absolute' && v(word, 'clip-path', tight) === 'inset(50%)' && v(word, 'width', tight) === '1px');
  check('tight: the word is still read (hidden from the eye, not from a screen reader)', v(word, 'display', tight) !== 'none' && v(word, 'visibility', tight) !== 'hidden' && tab.textContent === '2Pro');
  check('tight: the sparkle stays, in the same pill', v(spark, 'display', tight) === 'inline-flex' && v(pill, 'border', tight) === v(pill, 'border') && v(pill, 'color', tight) === v(pill, 'color'));
  check('tight: the pill tightens round its sparkle', v(pill, 'column-gap', tight) === '0' && v(pill, 'padding-left', tight) === '4px');
  check('tight: the label keeps its two characters', v(name, 'min-width', tight) === '2ch');

  const fit = mini(segmentedControl({ fit: 'content', options: OPTS('Pro'), value: 'one' }));
  miniDocument.body.replaceChildren(fit);
  check('fit content: the tab is no size container, so the row still sizes to its labels', v(fit.querySelectorAll('.vl-tab')[1]!, 'container-type') === 'normal');

  // A longer label gives the word up sooner (below 8em), so "Full set" keeps a word of its own
  // rather than "F…" beside the whole pill. Fed only the 8em rule, the tab is between 5em and 8em.
  const long = /@container\s+vl-tab\s+\(max-width:\s*8em\)\s*\{([\s\S]*?)\n\}/.exec(css);
  check('long label: its own container rule, below 8em', !!long);
  const between = kitRules(long?.[1] ?? '');
  const mixed = mini(segmentedControl({
    options: [{ value: '2', label: '2', badge: 'Pro' }, { value: 'set', label: 'Full set', badge: 'Pro' }],
    value: '2',
  }));
  miniDocument.body.replaceChildren(mixed);
  const [shortTab, longTab] = mixed.querySelectorAll('.vl-tab') as [MiniElement, MiniElement];
  check('long label: marked by the control, a number is not', longTab.classList.contains('vl-tab--badged-long') && !shortTab.classList.contains('vl-tab--badged-long'));
  check('long label: between 5em and 8em its word goes', v(longTab.querySelector('.vl-btn__badge')!.lastElementChild, 'clip-path', between) === 'inset(50%)');
  check('a number: between 5em and 8em it keeps the whole pill', v(shortTab.querySelector('.vl-btn__badge')!.lastElementChild, 'clip-path', between) === '');
  const plainLong = mini(segmentedControl({ options: [{ value: 'set', label: 'Full set' }] }));
  check('long label without a badge: no class, as before', !norm(plainLong).includes('vl-tab--badged'));
}

/* ------------------------------------------------------------------ preview bar */

{
  const MODES = (badge?: string) => [
    { value: 'cap', label: 'One cap' },
    { value: 'set', label: 'Full set', ...(badge === undefined ? {} : { badge }) },
  ];
  const build = (badge?: string) => previewBar({ modes: { options: MODES(badge), value: 'cap', onChange() {} }, label: 'View' });
  const plain = norm(build().root);
  check('previewBar: no badge builds no pill', !plain.includes('vl-btn__badge'));
  check('previewBar: badge: undefined builds what the default builds', norm(build(undefined).root) === plain);
  const badged = build('Pro');
  const btn = mini(badged.root).querySelectorAll('.vl-preview-bar__btn')[1]!;
  check('previewBar: the badged mode carries the button\'s own pill, after its label', btn.innerHTML === `Full set${PILL}`, btn.innerHTML);
  check('previewBar: the pill is the only addition', norm(badged.root).replace(PILL, '') === plain);
  let picked = '';
  const live = previewBar({ modes: { options: MODES('Pro'), value: 'cap', onChange: (v) => (picked = v) } });
  mini(live.root).querySelectorAll('.vl-preview-bar__btn')[1]!.click();
  check('previewBar: a tap on the badged mode picks it', picked === 'set' && mini(live.root).querySelectorAll('.vl-preview-bar__btn')[1]!.getAttribute('aria-pressed') === 'true');

  // setBadge: a mode bought since the build loses its pill and is built as if it never had one;
  // given back, it is the same pill; asked of a mode that does not exist, nothing happens.
  const later = build('Pro');
  later.setBadge('set', null);
  check('previewBar setBadge(null): the mode is what it is without a badge', norm(later.root) === plain, norm(later.root));
  later.setBadge('set', 'Pro');
  check('previewBar setBadge: the pill comes back as built', norm(later.root) === norm(build('Pro').root));
  later.setBadge('set', 'Pro');
  check('previewBar setBadge: twice is still one pill', mini(later.root).querySelectorAll('.vl-btn__badge').length === 1);
  later.setBadge('nope' as 'set', 'Pro');
  check('previewBar setBadge: an unknown mode changes nothing', norm(later.root) === norm(build('Pro').root));
  const unbadged = build();
  unbadged.setBadge('cap', 'New');
  check('previewBar setBadge: a mode built without one can gain one', mini(unbadged.root).querySelectorAll('.vl-preview-bar__btn')[0]!.textContent === 'One capNew');

  // setModeVisible: a mode the stage cannot show goes away rather than greying out, and comes
  // back as built; an unknown mode changes nothing. It fires nothing either way.
  let fired = 0;
  const vis = previewBar({ modes: { options: MODES(), value: 'cap', onChange: () => fired++ } });
  const before = norm(vis.root);
  vis.setModeVisible('set', false);
  const setBtn = mini(vis.root).querySelectorAll('.vl-preview-bar__btn')[1]!;
  check('previewBar setModeVisible(false): the mode is hidden', setBtn.hidden === true);
  vis.setModeVisible('set', true);
  check('previewBar setModeVisible(true): back as built', norm(vis.root) === before, norm(vis.root));
  vis.setModeVisible('nope' as 'set', false);
  check('previewBar setModeVisible: an unknown mode changes nothing, and nothing fires', norm(vis.root) === before && fired === 0);
}

/* ------------------------------------------------------------------ chip count */

{
  const plainChip = norm(chip({ label: 'Numbers' }));
  check('chip: no count builds what it always built', plainChip === '<button class="vl-chip" type="button" aria-pressed="false">Numbers</button>', plainChip);
  check('chip: count: undefined builds the same', norm(chip({ label: 'Numbers', count: undefined })) === plainChip);
  const counted = chip({ label: 'Numbers', count: 10 });
  check('chip count: a quiet span after the label', norm(counted) === '<button class="vl-chip" type="button" aria-pressed="false">Numbers<span class="vl-chip__count">10</span></button>', norm(counted));
  counted.setCount(11);
  check('chip setCount: rewrites the number', mini(counted).querySelector('.vl-chip__count')!.textContent === '11');
  counted.setCount(null);
  check('chip setCount(null): back to the plain chip', norm(counted) === plainChip);
  counted.setCount('3');
  check('chip setCount: adds one to a chip without', mini(counted).querySelectorAll('.vl-chip__count').length === 1 && mini(counted).textContent === 'Numbers3');
  check('chip count: no inline style', styles(norm(counted)) === 0);
  const rules = kitRules();
  miniDocument.body.replaceChildren(mini(counted));
  check('chip count: drawn quieter than the label', cssValue(mini(counted).querySelector('.vl-chip__count')!, 'opacity', rules, 1280) === '0.65');
}

// previewBar.setToggleVisible: a switch that does not apply goes away, the divider with the last.
{
  const bar = previewBar({
    modes: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', onChange() {} },
    toggles: [
      { id: 'one', label: 'One', pressed: true, onToggle() {} },
      { id: 'two', label: 'Two', pressed: false, onToggle() {} },
    ],
  });
  const root = mini(bar.root);
  const rule = root.querySelector('.vl-preview-bar__rule')!;
  const toggles = root.querySelectorAll('.vl-preview-bar__toggle');
  check('setToggleVisible: everything shows by default', !rule.hidden && toggles.every((t) => !t.hidden));
  bar.setToggleVisible('one', false);
  check('setToggleVisible: hides that switch only', toggles[0]!.hidden && !toggles[1]!.hidden && !rule.hidden);
  bar.setToggleVisible('two', false);
  check('setToggleVisible: the divider goes with the last switch', rule.hidden);
  bar.setToggleVisible('two', true);
  check('setToggleVisible: and comes back with one', !rule.hidden && !toggles[1]!.hidden && toggles[0]!.hidden);
  bar.setToggleVisible('nope', false);
  check('setToggleVisible: an unknown id changes nothing', !rule.hidden && !toggles[1]!.hidden);
  const rules = kitRules();
  miniDocument.body.replaceChildren(root);
  check('setToggleVisible: a hidden switch is not drawn', cssValue(toggles[0]!, 'display', rules, 1280) === 'none');
}

// Cards in one column: the last of an odd count lines up with the others (the centring is for a
// card alone under a half-empty row, which one column never has).
{
  const rules = kitRules();
  const build = (columns?: number) => segmentedControl({ variant: 'cards', columns, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] });
  const one = mini(build(1));
  miniDocument.body.replaceChildren(one);
  const lastOne = one.querySelectorAll('.vl-tab')[2]!;
  check('cards in one column: the last card is not centred', cssValue(lastOne, 'justify-content', rules, 1280) === 'flex-start', cssValue(lastOne, 'justify-content', rules, 1280));
  const two = mini(build(2));
  miniDocument.body.replaceChildren(two);
  const lastTwo = two.querySelectorAll('.vl-tab')[2]!;
  check('cards in two columns: the lone last card still spans and centres', cssValue(lastTwo, 'justify-content', rules, 1280) === 'center');
  check('cards: only one column gets the class', one.classList.contains('vl-tabs--one-column') && !two.classList.contains('vl-tabs--one-column'));
}

console.log(`\npro badge: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
