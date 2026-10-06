/*
  "My icons" (src/components/my-icons.ts), the symbol chooser's store of the customer's own
  icons, in the stand-in document (support/mini-dom.ts) with its stand-in localStorage.

  The store: newest first, 40 at most, nothing that is not an icon listed and nothing lost. The
  weave: the window's options with My icons in them, everything else passed through. And the real
  symbol window over a stand-in library, from the category button to the pick and the upload.
  The symbol library itself stays out: this is what the chooser adds to it.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, miniStorage, type MiniElement } from './support/mini-dom';
import { el } from '../src/dom';
import { readMyIcons, keepMyIcon, withMyIcons, MY_ICONS_MAX, type MyIcon } from '../src/components/my-icons';
import { openSymbolLibrary, type SymbolLibraryEntry, type SymbolLibraryOptions } from '../src/components/symbol-library';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// A toast takes itself away on a timer of the window's; the stand-in window keeps them, to read.
(globalThis as unknown as { window: Record<string, unknown> }).window.setTimeout = () => 0;

const body = miniDocument.body as MiniElement;
const KEY = 'test-my-icons';
const SQUARE = [[[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]]] as MyIcon['shapes'];
const icon = (id: string, label = id): MyIcon => ({ id, label, shapes: SQUARE });
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
const toasts = () => body.querySelectorAll('.vl-toast').map((t) => t.textContent);

/* ------------------------------------------------------------------------ the store */

{
  miniStorage.clear();
  check('store: nothing kept, nothing listed', readMyIcons(KEY).length === 0);
  localStorage.setItem(KEY, '{not json');
  check('store: a list that cannot be read lists nothing, and does not throw', readMyIcons(KEY).length === 0);
  localStorage.setItem(KEY, JSON.stringify([icon('a'), { id: 'old', label: 'Old', rings: [] }, 7, icon('b')]));
  check('store: only icons of this shape are listed, in order', readMyIcons(KEY).map((i) => i.id).join() === 'a,b');

  const logo = keepMyIcon(KEY, { label: 'Logo', shapes: SQUARE });
  check('store: an icon with no id of its own is named mine:…', /^mine:[a-z0-9]+$/.test(logo.id), logo.id);
  const raw = stored() as { id?: string }[];
  check('store: kept first, and the entries it cannot list are not lost', raw.length === 5 && raw[0]!.id === logo.id && raw[2]!.id === 'old' && raw[3] === 7);
  keepMyIcon(KEY, { id: 'b', label: 'B again', shapes: SQUARE });
  check('store: an icon with an id already kept replaces that one, first', readMyIcons(KEY).map((i) => i.label).join() === 'B again,Logo,a');

  miniStorage.clear();
  for (let i = 0; i < MY_ICONS_MAX + 5; i++) keepMyIcon(KEY, { id: `n${i}`, label: `N${i}`, shapes: SQUARE });
  const all = readMyIcons(KEY);
  check(`store: ${MY_ICONS_MAX} at most, the oldest go`, all.length === MY_ICONS_MAX && all[0]!.id === `n${MY_ICONS_MAX + 4}` && all[MY_ICONS_MAX - 1]!.id === 'n5');

  const setItem = miniStorage.setItem;
  miniStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  const big = keepMyIcon(KEY, { label: 'Big', shapes: SQUARE });
  miniStorage.setItem = setItem;
  check('store: with storage full the icon still comes back, and a warning says it is not kept', big.label === 'Big' && toasts().some((t) => t.includes('storage is full')), toasts().join(' | '));
  body.replaceChildren();
}

/* ------------------------------------------------------------------------- the weave */

const PAW: SymbolLibraryEntry = { id: 'tabler:paw', label: 'Paw', source: 'Tabler Icons' };
const uploads: string[] = [];
const libraryPicks: string[] = [];
let nextUpload: unknown = null;
const base: SymbolLibraryOptions = {
  title: 'Symbols & icons',
  categories: [{ id: 'popular', label: 'Popular' }, { id: 'animals', label: 'Animals' }],
  initialCategory: 'popular',
  list: (c) => (c === 'popular' ? [PAW] : []),
  search: (q) => [PAW].filter((e) => e.label.toLowerCase().includes(q.toLowerCase())),
  renderTile: () => el('span', { attrs: { 'data-art': 'library' } }),
  onPick: (e) => void libraryPicks.push(e.id),
  upload: {
    label: 'Import your own SVG',
    onFile: async (file) => {
      uploads.push(file.name);
      return nextUpload;
    },
  },
};
const minePicks: MyIcon[] = [];
const woven = withMyIcons(base, { key: KEY, draw: () => el('span', { attrs: { 'data-art': 'mine' } }), onPick: (i) => void minePicks.push(i) });

{
  miniStorage.clear();
  localStorage.setItem(KEY, JSON.stringify([icon('mine:logo', 'Logo'), icon('mine:cat', 'Cat outline')]));
  check('weave: My icons is the second category, the rest in their order', woven.categories.map((c) => `${c.id}:${c.label}`).join() === 'popular:Popular,mine:My icons,animals:Animals');
  const mine = woven.list('mine');
  check('weave: the My icons category lists the kept icons', mine.map((e) => `${e.id} ${e.label} ${e.source}`).join() === 'mine:logo Logo My icons,mine:cat Cat outline My icons');
  check('weave: every other category is the library’s', woven.list('popular')[0] === PAW && woven.list('animals').length === 0);
  check('weave: a search finds the customer’s icons first, then the library’s', woven.search('A').map((e) => e.id).join() === 'mine:cat,tabler:paw' && woven.search('logo').map((e) => e.id).join() === 'mine:logo');
  check('weave: an icon’s tile is drawn from its shapes, a symbol’s by the library', (woven.renderTile(mine[0]!) as unknown as MiniElement).getAttribute('data-art') === 'mine' && (woven.renderTile(PAW) as unknown as MiniElement).getAttribute('data-art') === 'library');
  void woven.onPick(mine[1]!);
  void woven.onPick(PAW);
  check('weave: picking an icon hands back the icon, picking a symbol goes to the library', minePicks.length === 1 && minePicks[0]!.id === 'mine:cat' && minePicks[0]!.shapes.length === 1 && libraryPicks.join() === 'tabler:paw');
  check('weave: everything else passes through', woven.title === base.title && woven.initialCategory === 'popular' && woven.upload?.label === 'Import your own SVG');
  check('weave: the options handed in are left as they were', base.categories.length === 2 && base.list('mine').length === 0);
  check('weave: no upload, no upload', withMyIcons({ ...base, upload: undefined }, { key: KEY, draw: () => el('span'), onPick() {} }).upload === undefined);

  nextUpload = { label: 'Badge', shapes: SQUARE };
  await woven.upload!.onFile({ name: 'badge.svg' } as File, () => {});
  check('weave: an upload runs as it did, and the icon it hands back is kept first', uploads.join() === 'badge.svg' && readMyIcons(KEY)[0]!.label === 'Badge' && readMyIcons(KEY).length === 3);
  nextUpload = null;
  await woven.upload!.onFile({ name: 'cancelled.svg' } as File, () => {});
  nextUpload = undefined;
  await woven.upload!.onFile({ name: 'app-did-it.svg' } as File, () => {});
  check('weave: an upload that hands nothing back keeps nothing', readMyIcons(KEY).length === 3);
}

/* -------------------------------------------- the real symbol window, over a stand-in library */

{
  miniStorage.clear();
  localStorage.setItem(KEY, JSON.stringify([icon('mine:logo', 'Logo'), icon('mine:cat', 'Cat outline')]));
  minePicks.length = 0;
  openSymbolLibrary(woven);
  await tick();
  const nav = body.querySelector('.vl-symbol-library__nav')!;
  const named = (label: string) => nav.querySelectorAll('button').find((b) => b.textContent === label);
  check('window: a My icons button after Popular', nav.querySelectorAll('button').map((b) => b.textContent).join() === 'Popular,My icons,Animals');
  named('My icons')!.click();
  await tick();
  const tiles = body.querySelectorAll('.vl-symbol-library__tile');
  check('window: My icons shows the kept icons, drawn from their shapes', tiles.length === 2 && tiles.every((t) => t.querySelector('span[data-art]')?.getAttribute('data-art') === 'mine') && tiles[0]!.getAttribute('aria-label') === 'Logo');
  check('window: each says where it comes from', tiles[1]!.getAttribute('title') === 'Cat outline · My icons');
  tiles[1]!.click();
  await tick();
  check('window: a pick closes the window and hands back the icon', !body.querySelector('.vl-symbol-library') && minePicks.length === 1 && minePicks[0]!.id === 'mine:cat');

  uploads.length = 0;
  nextUpload = { label: 'Star', shapes: SQUARE };
  openSymbolLibrary(woven);
  const input = body.querySelector('.vl-upload-cta')!.querySelector('input')! as MiniElement & { files: unknown };
  input.files = [{ name: 'star.svg' }];
  input.dispatchEvent({ type: 'change' });
  await tick();
  check('window: an upload goes to the app as before, and its icon is kept first', uploads.join() === 'star.svg' && readMyIcons(KEY)[0]!.label === 'Star');
  check('window: and the window closes when the upload is done', !body.querySelector('.vl-symbol-library'));
}

body.replaceChildren();
miniStorage.clear();
console.log(`\nmy icons: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
