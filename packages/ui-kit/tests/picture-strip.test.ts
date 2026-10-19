/*
  pictureStrip() in the stand-in document (support/mini-dom.ts).

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, type MiniElement } from './support/mini-dom';
import { pictureStrip, type PictureStripItem } from '../src/components/picture-strip';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const all = (root: unknown, sel: string) => (root as MiniElement).querySelectorAll(sel) as unknown as MiniElement[];
const one = (root: unknown, sel: string) => (root as MiniElement).querySelector(sel) as unknown as MiniElement | null;
const click = (node: MiniElement | null) => (node as unknown as HTMLElement | null)?.click();

const items: PictureStripItem[] = [
  { id: 'a', label: 'Photo 1 · Angled', src: 'data:image/png;base64,AA' },
  { id: 'b', label: 'Photo 2 · Front' },
];
const said: string[] = [];
const strip = pictureStrip({
  items,
  value: 'a',
  onSelect: (id) => said.push(`select ${id}`),
  onAdd: () => said.push('add'),
  addLabel: 'Add a photo of this view',
  onRemove: (id) => said.push(`remove ${id}`),
  removeLabel: (item) => `Remove ${item.label.split(' ·')[0]!.toLowerCase()}`,
  max: 3,
});

const tiles = () => all(strip.root, '.vl-picture-strip__tile');
check('one tile per item, then the add tile', tiles().length === 2 && all(strip.root, '.vl-picture-strip__add').length === 1);
check('a tile with a picture shows it; one without pulses', !!one(tiles()[0], 'img') && !!one(tiles()[1], '.vl-skeleton'));
check('the selected tile is pressed and the other is not', tiles()[0]!.getAttribute('aria-pressed') === 'true' && tiles()[1]!.getAttribute('aria-pressed') === 'false');
check('the tile is named for a screen reader', tiles()[1]!.getAttribute('aria-label') === 'Photo 2 · Front');
check('one row that does not wrap, by default', !strip.root.classList.contains('vl-picture-strip--wrap'));
check('no inline style written', !html(strip.root as unknown as MiniElement).includes(' style="'));

click(tiles()[1] ?? null);
check('clicking a tile selects it', said.join() === 'select b');
said.length = 0;
const removes = () => all(strip.root, '.vl-picture-strip__remove');
check('every tile can be removed while there are two', removes().length === 2 && removes()[0]!.getAttribute('aria-label') === 'Remove photo 1');
click(removes()[1] ?? null);
check('remove reports the id', said.join() === 'remove b');
said.length = 0;
click(one(strip.root, '.vl-picture-strip__add'));
check('the add tile reports an add', said.join() === 'add');

strip.setValue('b');
check('setValue moves the selection', tiles()[1]!.getAttribute('aria-pressed') === 'true' && tiles()[0]!.getAttribute('aria-pressed') === 'false');
strip.setImage('b', 'data:image/png;base64,BB');
check('setImage gives a waiting tile its picture', one(tiles()[1], 'img')?.getAttribute('src') === 'data:image/png;base64,BB');
strip.setImage('b', null);
check('and null takes it back to waiting', !!one(tiles()[1], '.vl-skeleton'));

strip.setItems([{ id: 'a', label: 'Photo 1 · Angled' }]);
check('with one item left there is nothing to remove', removes().length === 0 && tiles().length === 1);
strip.setItems([...items, { id: 'c', label: 'Photo 3 · Side' }]);
check('the add tile hides at max', all(strip.root, '.vl-picture-strip__add').length === 0 && tiles().length === 3);

const wrapped = pictureStrip({ items, value: 'a', onSelect: () => {}, wrap: true, heading: 'Colorways' });
check('wrap adds its class', wrapped.root.classList.contains('vl-picture-strip--wrap'));
check('a heading is a caption over the row', one(wrapped.root, '.vl-picture-strip__heading')?.textContent === 'Colorways');
check('no onAdd, no add tile; no onRemove, no remove buttons', !one(wrapped.root, '.vl-picture-strip__add') && !one(wrapped.root, '.vl-picture-strip__remove'));

console.log(`\npicture strip: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
