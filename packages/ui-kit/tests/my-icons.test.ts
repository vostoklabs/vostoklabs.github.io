/*
  "My icons" (src/components/my-icons.ts), the symbol chooser's store of the customer's own
  icons, in the stand-in document (support/mini-dom.ts) with its stand-in localStorage.

  The store: newest first, 40 at most, nothing that is not an icon listed and nothing of that kind
  lost. Its size, and what a browser with no room, or no storage at all, is told. The weave: the
  window's options with My icons in them, everything else passed through. And the real symbol
  window over a stand-in library, from the category button to the pick and the upload. The
  symbol library itself stays out: this is what the chooser adds to it.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, miniStorage, type MiniElement } from './support/mini-dom';
import { el } from '../src/dom';
import { readMyIcons, keepMyIcon, withMyIcons, MY_ICONS_MAX, MY_ICONS_MAX_CHARS, type MyIcon } from '../src/components/my-icons';
import { openSymbolLibrary, type SymbolLibraryEntry, type SymbolLibraryOptions } from '../src/components/symbol-library';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

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
  check(
    'store: kept first, and the entries it cannot list are kept, after the icons',
    raw.length === 5 && raw[0]!.id === logo.id && raw.slice(1, 3).map((x) => x.id).join() === 'a,b' && raw[3]!.id === 'old' && raw[4] === 7,
    JSON.stringify(raw.map((x) => x?.id ?? x)),
  );
  keepMyIcon(KEY, { id: 'b', label: 'B again', shapes: SQUARE });
  check('store: an icon with an id already kept replaces that one, first', readMyIcons(KEY).map((i) => i.label).join() === 'B again,Logo,a');

  miniStorage.clear();
  for (let i = 0; i < MY_ICONS_MAX + 5; i++) keepMyIcon(KEY, { id: `n${i}`, label: `N${i}`, shapes: SQUARE });
  const all = readMyIcons(KEY);
  check(`store: ${MY_ICONS_MAX} at most, the oldest go`, all.length === MY_ICONS_MAX && all[0]!.id === `n${MY_ICONS_MAX + 4}` && all[MY_ICONS_MAX - 1]!.id === 'n5');

  // Forty kept by an app in a format of its own (rings, not shapes), then imports through the
  // kit: the cap counts icons only, so none of the forty is lost.
  miniStorage.clear();
  const theirs = Array.from({ length: MY_ICONS_MAX }, (_, i) => ({ id: `mine-${i}`, label: `Old ${i}`, source: 'My icons', rings: [[[0, 0], [1, 0], [0, 1]]] }));
  localStorage.setItem(KEY, JSON.stringify(theirs));
  keepMyIcon(KEY, { label: 'First', shapes: SQUARE });
  const once = stored() as { id: string; rings?: unknown }[];
  check('store: one import beside forty entries it cannot list keeps all forty', once.length === MY_ICONS_MAX + 1 && once.filter((x) => x.rings).length === MY_ICONS_MAX && readMyIcons(KEY).length === 1);
  for (let i = 1; i < MY_ICONS_MAX + 3; i++) keepMyIcon(KEY, { label: `New ${i}`, shapes: SQUARE });
  const kept = stored() as { id: string; rings?: unknown }[];
  check(
    `store: …and after ${MY_ICONS_MAX + 2} more, all forty are still there in their order, beside ${MY_ICONS_MAX} icons`,
    kept.filter((x) => x.rings).map((x) => x.id).join() === theirs.map((x) => x.id).join() && readMyIcons(KEY).length === MY_ICONS_MAX,
    `${kept.filter((x) => x.rings).length} of theirs, ${readMyIcons(KEY).length} icons`,
  );

  // An id must be a string with something in it: anything else gets one of its own, so two
  // icons without one never replace each other.
  miniStorage.clear();
  const empty1 = keepMyIcon(KEY, { id: '', label: 'Empty 1', shapes: SQUARE });
  const empty2 = keepMyIcon(KEY, { id: '', label: 'Empty 2', shapes: SQUARE });
  const numbered = keepMyIcon(KEY, { id: 42 as unknown as string, label: 'Numbered', shapes: SQUARE });
  check(
    'store: an empty or non-string id is replaced by one of its own',
    [empty1, empty2, numbered].every((i) => /^mine:/.test(i.id)) && readMyIcons(KEY).map((i) => i.label).join() === 'Numbered,Empty 2,Empty 1',
  );
  localStorage.setItem(KEY, JSON.stringify([icon(''), { ...icon('x'), id: 7 }, icon('ok')]));
  check('store: a stored entry whose id is empty or not a string is not listed', readMyIcons(KEY).map((i) => i.id).join() === 'ok');
}

/* ------------------------------------------------------------------ size and storage */

{
  /** An icon whose stored form is a little over `chars` characters long. */
  const sized = (label: string, chars: number) => {
    const ring: [number, number][] = [];
    for (let i = 0, length = 2; length < chars; i++) {
      const point: [number, number] = [Math.cos(i) / 2, Math.sin(i) / 2];
      ring.push(point);
      length += JSON.stringify(point).length + 1;
    }
    return { label, shapes: [[ring]] as MyIcon['shapes'] };
  };
  miniStorage.clear();
  const big = sized('Big', 120_000);
  for (let i = 0; i < 12; i++) keepMyIcon(KEY, { ...big, id: `big${i}`, label: `Big ${i}` });
  const listed = readMyIcons(KEY);
  const chars = localStorage.getItem(KEY)!.length;
  check(
    `size: the icons stop at ${MY_ICONS_MAX_CHARS} characters, the oldest going first`,
    listed.length === 8 && listed[0]!.id === 'big11' && listed[7]!.id === 'big4' && chars <= MY_ICONS_MAX_CHARS + MY_ICONS_MAX + 1,
    `${listed.length} kept, ${chars} characters`,
  );

  body.replaceChildren();
  const before = localStorage.getItem(KEY);
  const huge = keepMyIcon(KEY, sized('Huge', MY_ICONS_MAX_CHARS / 5 + 1000));
  check(
    'size: an icon over a fifth of that comes back, is not kept, and the toast says why',
    huge.label === 'Huge' && localStorage.getItem(KEY) === before && toasts().length === 1 && toasts()[0]!.includes('too detailed'),
    toasts().join(' | '),
  );

  // The browser runs out of room before the list's own limit: the oldest go until the new one fits.
  miniStorage.clear();
  for (let i = 0; i < 10; i++) keepMyIcon(KEY, { id: `s${i}`, label: `S${i}`, shapes: SQUARE });
  const room = localStorage.getItem(KEY)!.length + 20;
  const setItem = miniStorage.setItem;
  const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  miniStorage.setItem = (k: string, v: string) => {
    if (v.length > room) throw quota();
    setItem(k, v);
  };
  body.replaceChildren();
  keepMyIcon(KEY, { id: 'newest', label: 'Newest', shapes: SQUARE });
  const roomy = readMyIcons(KEY).map((i) => i.id);
  check(
    'storage: with no room left, the oldest go until the newest fits, and nothing needs saying',
    roomy.length === 10 && roomy[0] === 'newest' && roomy[9] === 's1' && toasts().length === 0,
    `${roomy.join()} | ${toasts().join(' | ')}`,
  );

  miniStorage.setItem = () => {
    throw quota();
  };
  const full = keepMyIcon(KEY, { label: 'Full', shapes: SQUARE });
  check(
    'storage: with no room even for one, the icon still comes back, and the toast says storage is full',
    full.label === 'Full' && toasts().length === 1 && toasts()[0]!.includes('storage is full'),
    toasts().join(' | '),
  );

  body.replaceChildren();
  miniStorage.setItem = () => {
    throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });
  };
  keepMyIcon(KEY, { label: 'Refused', shapes: SQUARE });
  miniStorage.setItem = setItem;
  check(
    'storage: a write the browser refuses for another reason is not called full',
    toasts().length === 1 && toasts()[0]!.includes('does not let the page save') && !toasts()[0]!.includes('full'),
    toasts().join(' | '),
  );

  body.replaceChildren();
  const g = globalThis as unknown as { localStorage: unknown };
  Object.defineProperty(g, 'localStorage', {
    configurable: true,
    get() {
      throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });
    },
  });
  const blocked = keepMyIcon(KEY, { label: 'Blocked', shapes: SQUARE });
  const blockedList = readMyIcons(KEY);
  Object.defineProperty(g, 'localStorage', { configurable: true, writable: true, value: miniStorage });
  check(
    'storage: with storage blocked nothing is listed, the icon comes back, and the toast says blocked, not full',
    blocked.label === 'Blocked' && blockedList.length === 0 && toasts().length === 1 && toasts()[0]!.includes('does not let the page save'),
    toasts().join(' | '),
  );

  body.replaceChildren();
  const tangled: unknown[] = [];
  tangled.push(tangled);
  keepMyIcon(KEY, { label: 'Tangled', shapes: tangled as unknown as MyIcon['shapes'] });
  check(
    'storage: shapes that cannot be written are not called full either',
    toasts().length === 1 && toasts()[0]!.includes('cannot keep it') && !toasts()[0]!.includes('full'),
    toasts().join(' | '),
  );
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
  check('weave: asked again with nothing stored since, the same entries come back, not read again', woven.list('mine') === mine);
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
  check('weave: …and once something is stored, they are made again', woven.list('mine') !== mine && woven.list('mine')[0]!.label === 'Badge' && woven.list('mine').length === 3);
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
