/*
  The gallery blocks in a stand-in document (support/mini-dom.ts), with the kit's stylesheets
  cascaded onto it (support/cascade.ts): the card's second picture (`galleryCard({ hover })`),
  the grid's picture shape (`galleryGrid({ aspect })`) and the whole page (`galleryPage()`).

  Without `hover` a card is built exactly as before, and without `aspect` a grid is; with them,
  each gains its one addition and nothing else.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { html, mediaQueries, miniDocument, type MiniElement } from './support/mini-dom';
import { cssValue, kitRules, type CssRule } from './support/cascade';
import { el } from '../src/dom';
import { button } from '../src/components/button';
import { galleryCard, galleryGrid, type GalleryCardOptions } from '../src/components/gallery';
import { galleryPage, type GalleryPageGroup } from '../src/components/gallery-page';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const mini = (node: unknown) => node as MiniElement;
const mount = (node: unknown) => {
  miniDocument.body.replaceChildren(mini(node));
  return mini(node);
};
const noop = () => {};
const rules = kitRules();

/** The rules as they stand while `state` holds: `:hover` is read as `[data-hover]`, and so on. */
const during = (state: 'hover' | 'focus-visible'): CssRule[] =>
  rules.map((r) => ({ ...r, selectors: r.selectors.map((s) => s.replace(new RegExp(`:${state}(?![\\w-])`, 'g'), `[data-${state}]`)) }));

/* ------------------------------------------------------------------ the card, as it was */

/* What `galleryCard` built before it had a second picture, written out: the new option must not
   have moved a byte of it. */
const IMG = (src: string) => `<img src="${src}" alt loading="lazy">`;
const LAYER = (inner: string) => `<span class="vl-gallery-card__hover" aria-hidden="true">${inner}</span>`;
const BADGE = '<span class="vl-gallery-card__badge">New</span>';
const BEFORE = {
  plain:
    '<button class="vl-gallery-card" type="button"><div class="vl-gallery-card__thumb"></div>'
    + '<div class="vl-gallery-card__body"><span class="vl-gallery-card__name">Tag</span></div></button>',
  full:
    `<button class="vl-gallery-card" type="button"><div class="vl-gallery-card__thumb">${IMG('front.png')}${BADGE}</div>`
    + '<div class="vl-gallery-card__body"><span class="vl-gallery-card__name">Tag</span>'
    + '<span class="vl-gallery-card__blurb">A tag with a name on it.</span>'
    + '<span class="vl-gallery-card__tags"><span class="vl-gallery-tag">keychain</span></span></div></button>',
  compact:
    `<button class="vl-gallery-card vl-gallery-card--compact" type="button" title="A tag with a name on it."><div class="vl-gallery-card__thumb">${IMG('front.png')}</div>`
    + '<div class="vl-gallery-card__body"><span class="vl-gallery-card__name">Tag</span>'
    + '<span class="vl-gallery-card__blurb">A tag with a name on it.</span></div></button>',
};
type Variant = keyof typeof BEFORE;
const OPTS: Record<Variant, GalleryCardOptions> = {
  plain: { name: 'Tag', onClick: noop },
  full: { name: 'Tag', blurb: 'A tag with a name on it.', thumb: 'front.png', badge: 'New', tags: ['keychain'], onClick: noop },
  compact: { name: 'Tag', blurb: 'A tag with a name on it.', thumb: 'front.png', compact: true, onClick: noop },
};

for (const variant of Object.keys(BEFORE) as Variant[]) {
  const built = html(mini(galleryCard(OPTS[variant])));
  check(`card (${variant}), no hover: the markup it always built`, built === BEFORE[variant], built);
  check(`card (${variant}), hover: undefined: the same`, html(mini(galleryCard({ ...OPTS[variant], hover: undefined }))) === BEFORE[variant]);
}

{
  const badged = galleryCard({ name: 'Tag', badge: 'New', onClick: noop });
  badged.setThumb('front.png');
  check('setThumb, no hover, no picture yet: the picture goes in front of the badge, as before', html(mini(badged)).includes(`<div class="vl-gallery-card__thumb">${IMG('front.png')}${BADGE}</div>`), html(mini(badged)));
  const old = galleryCard(OPTS.full);
  old.setThumb('front-2.png');
  check('setThumb, no hover: swaps the picture, as before', html(mini(old)) === BEFORE.full.replace(IMG('front.png'), IMG('front-2.png')), html(mini(old)));
}

/* --------------------------------------------------------------- the second picture */

const withLayer = (markup: string, inner: string) => markup.replace(BADGE, `${LAYER(inner)}${BADGE}`);

{
  const card = galleryCard({ ...OPTS.full, hover: 'both.png' });
  check('card, hover: one picture more, over the first and under the badge, and nothing else', html(mini(card)) === withLayer(BEFORE.full, IMG('both.png')), html(mini(card)));
  const layers = mini(card).querySelectorAll('.vl-gallery-card__hover');
  check('card, hover: one layer, holding the one picture', layers.length === 1 && layers[0]!.children.length === 1 && layers[0]!.children[0]!.getAttribute('src') === 'both.png');
  check('card, hover: no inline style', !html(mini(card)).includes(' style="'));

  const bare = galleryCard({ ...OPTS.plain, hover: 'both.png' });
  check('card, hover, no first picture yet: the layer alone in the tile', html(mini(bare)) === BEFORE.plain.replace('__thumb"></div>', `__thumb">${LAYER(IMG('both.png'))}</div>`), html(mini(bare)));

  const canvas = el('canvas');
  const drawn = galleryCard({ ...OPTS.compact, hover: canvas });
  check('card, hover: an element is used as it is', mini(drawn).querySelector('.vl-gallery-card__hover')!.children[0] === mini(canvas));
}

{
  const card = galleryCard({ ...OPTS.full, hover: 'both.png' });
  card.setHover('other.png');
  check('setHover: swaps the second picture in its place', html(mini(card)) === withLayer(BEFORE.full, IMG('other.png')), html(mini(card)));
  check('setHover: still one layer', mini(card).querySelectorAll('.vl-gallery-card__hover').length === 1);

  const late = galleryCard(OPTS.full);
  late.setHover('both.png');
  check('setHover on a card built without one: as if it had been built with it', html(mini(late)) === html(mini(galleryCard({ ...OPTS.full, hover: 'both.png' }))));

  card.setThumb('front-2.png');
  check('setThumb: swaps the first picture and leaves the second alone', html(mini(card)) === withLayer(BEFORE.full.replace(IMG('front.png'), IMG('front-2.png')), IMG('other.png')), html(mini(card)));
  const slow = galleryCard({ ...OPTS.plain, hover: 'both.png' });
  slow.setThumb('front.png');
  check('setThumb when the first picture comes after the second: it goes first, the layer stays', html(mini(slow)).includes(`__thumb">${IMG('front.png')}${LAYER(IMG('both.png'))}</div>`), html(mini(slow)));
}

/* --------------------------------------------------------- the second picture's CSS */

for (const compact of [false, true]) {
  const kind = compact ? 'compact card' : 'card';
  const card = galleryCard({ name: 'Tag', thumb: 'front.png', hover: 'both.png', compact, onClick: noop });
  mount(galleryGrid({ cards: [card] }));
  const thumb = mini(card).querySelector('.vl-gallery-card__thumb')!;
  const layer = mini(card).querySelector('.vl-gallery-card__hover')!;
  const at = (rs: CssRule[], prop: string) => cssValue(layer, prop, rs, 1280);

  check(`${kind}: the second picture is not drawn at rest`, at(rules, 'opacity') === '0', at(rules, 'opacity'));
  mini(card).setAttribute('data-hover', '');
  check(`${kind}: hovered, it shows`, at(during('hover'), 'opacity') === '1');
  mini(card).removeAttribute('data-hover');
  check(`${kind}: and goes again`, at(during('hover'), 'opacity') === '0');
  mini(card).setAttribute('data-focus-visible', '');
  check(`${kind}: keyboard focus shows it too`, at(during('focus-visible'), 'opacity') === '1');
  mini(card).removeAttribute('data-focus-visible');

  check(`${kind}: it covers the tile`, at(rules, 'position') === 'absolute' && ['top', 'right', 'bottom', 'left'].every((s) => at(rules, s) === '0'));
  const ground = cssValue(thumb, 'background', rules, 1280);
  check(`${kind}: on the tile's own ground, so nothing of the first picture shows through`, ground !== '' && at(rules, 'background') === ground, `${at(rules, 'background')} vs ${ground}`);
  const pad = cssValue(thumb, 'padding-top', rules, 1280);
  check(`${kind}: inside the tile's padding, so the two pictures are the same size`, at(rules, 'padding-top') === pad && (!compact || pad !== ''), `${at(rules, 'padding-top')} vs ${pad}`);
}

{
  const card = galleryCard({ name: 'Tag', thumb: 'front.png', hover: 'both.png', onClick: noop });
  mount(galleryGrid({ cards: [card] }));
  const layer = mini(card).querySelector('.vl-gallery-card__hover')!;
  const timing = rules
    .filter((r) => r.selectors.some((s) => s.includes('.vl-gallery-card__hover')))
    .flatMap((r) => r.decls)
    .filter((d) => d.prop.startsWith('transition'));
  check('fade: timed by the motion tiers, never a typed number', timing.length === 2 && timing.every((d) => /var\(--dur-(in|out)-sm\)/.test(d.value) && !/\d(ms|s)\b/.test(d.value)), timing.map((d) => d.value).join(' | '));
  check('fade: opacity only, nothing moves', !rules.filter((r) => r.selectors.some((s) => s.includes('.vl-gallery-card__hover'))).some((r) => r.decls.some((d) => d.prop === 'transform')));

  const ms = (v: string) => parseFloat(/(\d*\.?\d+)ms/.exec(v)?.[1] ?? 'NaN');
  const hov = during('hover');
  mini(card).setAttribute('data-hover', '');
  const fadeIn = ms(cssValue(layer, 'transition-duration', hov, 1280));
  const fadeOut = ms(cssValue(layer, 'transition', rules, 1280));
  check('fade: a real fade, quicker out than in', fadeIn > fadeOut && fadeOut > 1, `${fadeIn} / ${fadeOut}`);

  miniDocument.documentElement.setAttribute('data-motion', 'reduced');
  const reducedIn = ms(cssValue(layer, 'transition-duration', hov, 1280));
  const reducedOut = ms(cssValue(layer, 'transition', rules, 1280));
  check('reduced motion: no fade, a swap', reducedIn <= 1 && reducedOut <= 1, `${reducedIn} / ${reducedOut}`);
  check('reduced motion: the second picture still shows (the feedback stays)', cssValue(layer, 'opacity', hov, 1280) === '1');
  miniDocument.documentElement.removeAttribute('data-motion');
  mini(card).removeAttribute('data-hover');
}

/* ---------------------------------------------------------------- the picture shape */

{
  const plain = galleryGrid({ cards: [] });
  check('grid, no aspect: the markup it always built', html(mini(plain)) === '<div class="vl-gallery" style="--vl-gallery-min: 220px;"></div>', html(mini(plain)));
  check('grid, aspect: undefined: the same', html(mini(galleryGrid({ cards: [], aspect: undefined }))) === html(mini(plain)));
  const dense = galleryGrid({ cards: [], minPx: 150, dense: true });
  check('grid, dense, no aspect: as before', html(mini(dense)) === '<div class="vl-gallery vl-gallery--dense" style="--vl-gallery-min: 150px;"></div>', html(mini(dense)));
  const shaped = galleryGrid({ cards: [], aspect: '6 / 5' });
  check('grid, aspect: one custom property more and nothing else', html(mini(shaped)) === '<div class="vl-gallery" style="--vl-gallery-min: 220px; --vl-gallery-aspect: 6 / 5;"></div>', html(mini(shaped)));

  const thumbOf = (aspect?: string) => {
    const card = galleryCard({ name: 'Tag', onClick: noop });
    mount(galleryGrid({ cards: [card], ...(aspect ? { aspect } : {}) }));
    return mini(card).querySelector('.vl-gallery-card__thumb')!;
  };
  check('grid, no aspect: the pictures are 4:3, as before', cssValue(thumbOf(), 'aspect-ratio', rules, 1280) === '4 / 3', cssValue(thumbOf(), 'aspect-ratio', rules, 1280));
  check('grid, aspect 6 / 5: the pictures take it', cssValue(thumbOf('6 / 5'), 'aspect-ratio', rules, 1280) === '6 / 5', cssValue(thumbOf('6 / 5'), 'aspect-ratio', rules, 1280));
}

/* ---------------------------------------------------------------------------- the page */

const cardsOf = (word: string, n: number) => Array.from({ length: n }, (_, i) => galleryCard({ name: `${word} ${i + 1}`, thumb: 'front.png', onClick: noop }));
const GROUPS = (): GalleryPageGroup[] => [
  { id: 'keychain', label: 'Keychains', cards: cardsOf('Keychain', 2) },
  { id: 'tag', label: 'Tags', cards: cardsOf('Tag', 3) },
  { id: 'ornament', label: 'Ornaments', cards: cardsOf('Ornament', 1) },
];

function parts(root: MiniElement) {
  const sections = root.querySelectorAll('.vl-gallery-page__group');
  const items = root.querySelectorAll('.vl-side-nav__item');
  const labelOf = (row: MiniElement) => row.querySelector('.vl-list-row__label')!.textContent;
  return {
    sections,
    shown: () => sections.filter((s) => !s.hidden).map((s) => s.getAttribute('aria-label')).join(),
    counts: () => sections.map((s) => s.querySelector('.vl-gallery-page__count')!.textContent).join(),
    rail: () => items.map((r) => `${labelOf(r)} ${r.querySelector('.vl-list-row__meta')!.textContent}`).join(' | '),
    current: () => items.filter((r) => r.getAttribute('aria-current') === 'true').map(labelOf).join(),
    item: (label: string) => items.find((r) => labelOf(r) === label)!,
    empty: root.querySelector('.vl-gallery-page__empty')!,
  };
}
const ALL_SIX = 'All 6 | Keychains 2 | Tags 3 | Ornaments 1';

{
  const groups = GROUPS();
  const page = galleryPage({ title: 'Name Tags', description: 'Pick a design, type a name, download it.', groups });
  const root = mount(page.root);
  const p = parts(root);
  check('page: a section per group, in order, named by its label', p.sections.map((s) => s.getAttribute('aria-label')).join() === 'Keychains,Tags,Ornaments');
  check('page: each heading is the label and its count', p.sections.map((s) => s.querySelector('.vl-gallery-page__group-title')!.textContent).join() === 'Keychains2,Tags3,Ornaments1' && p.counts() === '2,3,1');
  check('page: each group\'s cards in a grid of their own', p.sections.every((s, i) => s.querySelector('.vl-gallery')!.children.length === groups[i]!.cards.length));
  check('page: the rail lists All and each group with its count', p.rail() === ALL_SIX, p.rail());
  check('page: All is current, every group shows, no empty state', p.current() === 'All' && p.shown() === 'Keychains,Tags,Ornaments' && p.empty.hidden);
  check('page: the title and its line are the kit\'s header', root.querySelector('.vl-app-title')!.textContent === 'Name Tags' && root.querySelector('.vl-app-subtitle')!.textContent === 'Pick a design, type a name, download it.');
  check('page: no topbar unless one is given', root.children.length === 1 && root.children[0]!.classList.contains('vl-gallery-page__body'));

  page.setGroup('tag');
  check('setGroup: only that group shows', p.shown() === 'Tags', p.shown());
  check('setGroup: the rail marks it', p.current() === 'Tags', p.current());
  check('setGroup: the counts still count every group', p.rail() === ALL_SIX, p.rail());
  check('setGroup: the cards themselves are left alone (hidden is the app\'s)', groups.every((g) => g.cards.every((c) => !c.hidden)));
  page.setGroup('nope');
  check('setGroup: an unknown id changes nothing', p.shown() === 'Tags' && p.current() === 'Tags');
  page.setGroup('all');
  check('setGroup(\'all\'): every group again', p.shown() === 'Keychains,Tags,Ornaments' && p.current() === 'All');
  p.item('Ornaments').click();
  check('a pick in the rail: that group only, marked', p.shown() === 'Ornaments' && p.current() === 'Ornaments');
  p.item('All').click();
  check('All in the rail: every group', p.shown() === 'Keychains,Tags,Ornaments' && p.current() === 'All');
}

{
  const groups = GROUPS();
  const page = galleryPage({ title: 'Name Tags', groups });
  const p = parts(mount(page.root));
  groups[0]!.cards[0]!.hidden = true;
  for (const c of groups[1]!.cards) c.hidden = true;
  check('an app hides cards: nothing changes until it says so', p.rail() === ALL_SIX);
  page.refresh();
  check('refresh: the rail counts the cards that show', p.rail() === 'All 2 | Keychains 1 | Tags 0 | Ornaments 1', p.rail());
  check('refresh: so do the headings', p.counts() === '1,0,1', p.counts());
  check('refresh: a group with nothing showing is not drawn under All', p.shown() === 'Keychains,Ornaments', p.shown());
  check('refresh: it stays in the rail, muted, so nothing reflows under the pointer', p.item('Tags').hasAttribute('data-empty') && !p.item('Keychains').hasAttribute('data-empty'));
  check('refresh: something shows, so no empty state', p.empty.hidden);

  p.item('Tags').click();
  check('a group with nothing showing: the empty state in place of the cards', !p.empty.hidden && p.shown() === '', p.shown());
  check('a group with nothing showing: it says so', p.empty.querySelector('.vl-empty__title')?.textContent === 'Nothing in Tags matches', p.empty.textContent);
  const showAll = p.empty.querySelector('.vl-btn');
  check('a group with nothing showing: Show all, with how many', showAll?.textContent === 'Show all 2', showAll?.textContent ?? 'no button');
  showAll?.click();
  check('Show all: back to All and the cards that show', p.current() === 'All' && p.shown() === 'Keychains,Ornaments' && p.empty.hidden);

  for (const g of groups) for (const c of g.cards) c.hidden = true;
  page.refresh();
  check('everything hidden: every group goes and the empty state comes', p.shown() === '' && !p.empty.hidden);
  check('everything hidden: All counts 0', p.rail().startsWith('All 0 |'), p.rail());
  check('everything hidden: the kit\'s words when the app gives none', p.empty.querySelector('.vl-empty__title')?.textContent === 'Nothing to show', p.empty.textContent);
  check('everything hidden: said to screen readers', p.empty.getAttribute('role') === 'status');
  for (const g of groups) for (const c of g.cards) c.hidden = false;
  page.refresh();
  check('everything back: as built', p.rail() === ALL_SIX && p.shown() === 'Keychains,Tags,Ornaments' && p.empty.hidden && p.empty.children.length === 0);
}

{
  const groups = GROUPS();
  let asked = 0;
  const clear = button({ label: 'Clear search', emphasis: 'secondary', onClick: noop });
  const page = galleryPage({ title: 'Name Tags', groups, empty: () => (asked++, clear) });
  const p = parts(mount(page.root));
  check('empty: not asked for while cards show', asked === 0);
  for (const c of groups[1]!.cards) c.hidden = true;
  page.setGroup('tag');
  check('empty: a group with nothing while others have cards is still the page\'s to say', asked === 0 && p.empty.querySelector('.vl-empty__title')?.textContent === 'Nothing in Tags matches');
  for (const g of groups) for (const c of g.cards) c.hidden = true;
  page.refresh();
  check('empty: with nothing anywhere, the app\'s own step back', asked === 1 && p.empty.children[0] === mini(clear) && p.empty.children.length === 1);
}

{
  const topbar = el('div');
  const help = button({ label: 'Help', emphasis: 'secondary', onClick: noop });
  const note = el('span', { text: 'New' });
  const theme = button({ label: 'Light mode', emphasis: 'secondary', onClick: noop });
  const page = galleryPage({
    title: 'Name Tags',
    groups: GROUPS(),
    topbar,
    tools: [help],
    headSlot: [note],
    railFoot: [theme],
    allLabel: 'Every design',
    grid: { minPx: 150, dense: true, aspect: '6 / 5' },
    hostOwnsLinks: true,
  });
  const root = mount(page.root);
  const headSlot = root.querySelector('.vl-gallery-page__head-slot')!;
  const railFoot = root.querySelector('.vl-gallery-page__rail-foot')!;
  check('topbar: first, over the page', root.children[0] === mini(topbar) && root.children[1]!.classList.contains('vl-gallery-page__body'));
  check('tools: at the right of the header', root.querySelector('.vl-gallery-page__tools')!.children[0] === mini(help));
  check('headSlot: beside the title', headSlot.children.length === 1 && headSlot.children[0] === mini(note) && headSlot.parentNode!.firstElementChild!.classList.contains('vl-app-header'));
  check('railFoot: at the foot of the rail, under the groups', railFoot.children[0] === mini(theme) && railFoot.previousElementSibling!.classList.contains('vl-side-nav'));
  check('allLabel: the rail\'s first item', parts(root).rail().startsWith('Every design 6 |'), parts(root).rail());
  check('grid: every group\'s grid takes it', root.querySelectorAll('.vl-gallery').every((g) => g.classList.contains('vl-gallery--dense') && g.style.getPropertyValue('--vl-gallery-min') === '150px' && g.style.getPropertyValue('--vl-gallery-aspect') === '6 / 5'));
  check('hostOwnsLinks: the credit is text, not a link', !!root.querySelector('.vl-credit-link--text') && !root.querySelector('a'));

  const phone = mediaQueries.get('(max-width: 760px)');
  check('railFoot: the page watches for a phone', !!phone);
  phone?.set(true);
  check('phone: the rail foot moves beside the title, after what is there', headSlot.children.length === 2 && headSlot.children[1] === mini(theme) && railFoot.children.length === 0);
  check('phone: moved, never copied', root.querySelectorAll('.vl-btn').filter((b) => b.textContent === 'Light mode').length === 1);
  phone?.set(false);
  check('wide again: back at the foot of the rail', railFoot.children[0] === mini(theme) && headSlot.children.length === 1);
}

/* ----------------------------------------------------------------- the page's CSS */

{
  const page = galleryPage({ title: 'Name Tags', groups: GROUPS() });
  const root = mount(page.root);
  const v = (e: MiniElement, prop: string, width: number) => cssValue(e, prop, rules, width);
  const body = root.querySelector('.vl-gallery-page__body')!;
  const header = root.querySelector('.vl-gallery-page__header')!;
  const rail = root.querySelector('.vl-gallery-page__rail')!;
  const nav = root.querySelector('.vl-side-nav')!;
  const tools = root.querySelector('.vl-gallery-page__tools')!;
  check('wide: the rail beside the cards, the header across both', v(body, 'grid-template-columns', 1280) === '200px minmax(0, 1fr)' && v(header, 'grid-column', 1280) === '1 / -1');
  check('wide: the rail stays in reach down the page', v(rail, 'position', 1280) === 'sticky' && v(rail, 'top', 1280) !== '' && v(rail, 'overflow-y', 1280) === 'auto');
  check('wide: the header is ruled off from the cards', v(header, 'border-bottom', 1280).startsWith('1px solid'));
  check('an empty slot takes no room', v(tools, 'display', 1280) === 'none' && v(root.querySelector('.vl-gallery-page__rail-foot')!, 'display', 1280) === 'none');
  check('phone (390 px): one column', v(body, 'grid-template-columns', 390) === 'minmax(0, 1fr)', v(body, 'grid-template-columns', 390));
  check('phone: the rail is pinned to the top, on the page\'s own ground, over the cards', v(rail, 'position', 390) === 'sticky' && v(rail, 'top', 390) === '0' && v(rail, 'z-index', 390) === '2' && v(rail, 'background', 390) === v(miniDocument.body, 'background', 390));
  check('phone: the chips start in line with the page', v(nav, 'padding-left', 390) === v(body, 'padding-left', 390) && v(nav, 'margin-left', 390) === '0');
  check('phone: the header stacks and loses its rule', v(header, 'flex-direction', 390) === 'column' && v(header, 'border-bottom', 390) === '0');
  check('the page has no ground of its own: the page frame is root.css\'s', v(root, 'background', 1280) === '' && v(body, 'background', 1280) === '');

  const css = readFileSync(join(process.cwd(), 'src', 'gallery-page.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'));
  check('its stylesheet never restates the page frame (no body, html or :root rule)', selectors.length > 0 && !selectors.some((s) => /(^|[\s,>+~(])(body|html)\b|:root\b/.test(s)));
}

{
  // A generator keeps the page still (`body { overflow: hidden }` in its own stylesheet, after the kit's).
  const app = kitRules('body { overflow: hidden; }');
  const page = galleryPage({ title: 'Name Tags', groups: GROUPS() });
  miniDocument.body.replaceChildren(el('div', {}, [page.root]));
  check('in a generator that keeps body still, the page scrolls', cssValue(miniDocument.body, 'overflow-y', app, 1280) === 'visible');
  page.root.hidden = true;
  check('hidden behind the editor, body is still again', cssValue(miniDocument.body, 'overflow-y', app, 1280) === 'hidden');
  miniDocument.body.replaceChildren();
  check('without the page, the generator\'s rule stands', cssValue(miniDocument.body, 'overflow-y', app, 1280) === 'hidden');
}

/* --------------------------------------------- back up to the list, never down to it */

{
  type Rect = { top: number; left: number; right: number; bottom: number };
  const g = globalThis as unknown as { getComputedStyle: unknown; window: Record<string, unknown> };
  const realStyle = g.getComputedStyle;
  const scrolled: number[] = [];
  let scroller: MiniElement | null = null;
  g.getComputedStyle = (e: MiniElement) => ({ rowGap: '12px', overflowY: e === scroller ? 'auto' : 'visible', getPropertyValue: () => '' });
  g.window.scrollBy = (_x: number, y: number) => scrolled.push(y);
  const place = (e: MiniElement, r: Rect) => Object.assign(e, { getBoundingClientRect: () => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }) });

  const page = galleryPage({ title: 'Name Tags', groups: GROUPS() });
  const root = mount(page.root);
  const rail = root.querySelector('.vl-gallery-page__rail')!;
  const main = root.querySelector('.vl-gallery-page__main')!;

  // Wide: the rail beside the list, stuck 16 px from the top while the page is 900 px into it.
  place(rail, { top: 16, left: 16, right: 216, bottom: 600 });
  place(main, { top: -900, left: 240, right: 1264, bottom: 3000 });
  page.setGroup('tag');
  check('wide, from deep in the list: back up to its top, level with the rail', scrolled.join() === '-916', scrolled.join());
  scrolled.length = 0;
  place(rail, { top: 140, left: 16, right: 216, bottom: 600 });
  place(main, { top: 140, left: 240, right: 1264, bottom: 3000 });
  page.setGroup('all');
  check('wide, above the list: nothing moves', scrolled.length === 0, scrolled.join());
  place(main, { top: 300, left: 240, right: 1264, bottom: 3000 });
  page.setGroup('tag');
  check('wide, the list further down than where it would rest: never scrolled down to it', scrolled.length === 0, scrolled.join());

  // A phone: the chips over the list, stuck at the top; the list comes to rest just under them.
  place(rail, { top: 0, left: 0, right: 390, bottom: 53 });
  place(main, { top: -400, left: 16, right: 374, bottom: 3000 });
  page.setGroup('tag');
  check('phone, from deep in the list: its top comes to rest under the chips', scrolled.join() === String(-400 - (53 + 12)), scrolled.join());
  scrolled.length = 0;
  place(main, { top: 65, left: 16, right: 374, bottom: 3000 });
  page.setGroup('all');
  check('phone, at the top of the list: nothing moves', scrolled.length === 0, scrolled.join());

  // In a box that scrolls (a preview inside a page): the box goes back up, not the window.
  const frame = el('div') as unknown as MiniElement;
  const boxScrolled: number[] = [];
  Object.assign(frame, { scrollHeight: 2000, scrollBy: (_x: number, y: number) => boxScrolled.push(y) });
  Object.defineProperty(frame, 'clientHeight', { value: 500 });
  scroller = frame;
  frame.append(root);
  mount(frame);
  place(rail, { top: 16, left: 16, right: 216, bottom: 600 });
  place(main, { top: -300, left: 240, right: 1264, bottom: 3000 });
  page.setGroup('ornament');
  check('in a scrolling box: the box goes back up, the window stays', boxScrolled.join() === '-316' && scrolled.length === 0, `${boxScrolled.join()} / ${scrolled.join()}`);

  g.getComputedStyle = realStyle;
  delete g.window.scrollBy;
  miniDocument.body.replaceChildren();
}

console.log(`\ngallery: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
