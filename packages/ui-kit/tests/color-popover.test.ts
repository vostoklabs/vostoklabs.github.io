/*
  colorPopover() and closeColorPopover() in the stand-in document (support/mini-dom.ts).

  A picker closed from outside it (another picker opening, an app unmounting) closes the way a
  pick or Escape closes it: its document listeners go with it, a colour made on its wheel is
  reported, and onClose is called, once. Nothing is left listening on the document.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, type MiniElement } from './support/mini-dom';
import { closeColorPopover, colorPopover } from '../src/components/color-popover';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const root = miniDocument.documentElement as MiniElement;
/** The document's listeners of a type: what a picker left behind. */
const listening = (type: string) => root.listeners.get(type)?.length ?? 0;
const open = () => miniDocument.querySelectorAll('.vl-color-popover').length;
const escape = () => root.dispatchEvent({ type: 'keydown', key: 'Escape' });

/** A picker with its calls recorded. */
function picker(tag: string, calls: string[]) {
  return colorPopover({
    x: 10,
    y: 10,
    value: '#161616',
    onSelect: (hex) => calls.push(`${tag} select ${hex}`),
    onCustom: (hex) => calls.push(`${tag} custom ${hex}`),
    onClose: () => calls.push(`${tag} close`),
  });
}

{
  const calls: string[] = [];
  picker('a', calls);
  await wait(60); // the outside-click dismiss is armed a beat after opening
  check('a picker listens on the document while it is open', open() === 1 && listening('keydown') === 1 && listening('mousedown') === 1, `keydown ${listening('keydown')}, mousedown ${listening('mousedown')}`);
  closeColorPopover();
  check('closeColorPopover(): the picker goes, and so do its document listeners', open() === 0 && listening('keydown') === 0 && listening('mousedown') === 0, `${open()} open, keydown ${listening('keydown')}, mousedown ${listening('mousedown')}`);
  check('…and its onClose is called, as on any close', calls.join() === 'a close', calls.join());
  escape();
  check('…once: a later Escape reaches nothing', calls.join() === 'a close', calls.join());
  closeColorPopover();
  check('with nothing open it does nothing', calls.join() === 'a close' && open() === 0);
}

{
  const calls: string[] = [];
  picker('a', calls);
  closeColorPopover(); // before the dismiss is armed
  await wait(60);
  check('closed before its outside-click dismiss is armed: that listener is never added', listening('mousedown') === 0 && listening('keydown') === 0, `mousedown ${listening('mousedown')}, keydown ${listening('keydown')}`);
}

{
  const calls: string[] = [];
  picker('a', calls);
  const wheel = miniDocument.querySelector('.vl-color-popover input') as MiniElement & { value: string };
  wheel.value = '#123456';
  wheel.dispatchEvent({ type: 'input' });
  await wait(60);
  picker('b', calls); // a second picker opens over the first
  check('a second picker closes the first as its own close does: the wheel colour reported, then onClose', calls.join() === 'a select #123456,a custom #123456,a close', calls.join());
  check('…and only the second is open and listening', open() === 1 && listening('keydown') === 1, `${open()} open, keydown ${listening('keydown')}`);
  await wait(60);
  check('…its dismiss armed, the first one\'s gone', listening('mousedown') === 1, `mousedown ${listening('mousedown')}`);
  escape();
  check('Escape closes the second, and nothing is left listening', calls.at(-1) === 'b close' && open() === 0 && listening('keydown') === 0 && listening('mousedown') === 0, `${calls.join()} | keydown ${listening('keydown')}, mousedown ${listening('mousedown')}`);
}

{
  // `footer`: more choices about the same part, under the chips; without it, nothing new.
  const plain = picker('plain', []);
  check('no footer by default', !miniDocument.querySelector('.vl-color-popover__footer'));
  plain.close();
  const finish = miniDocument.createElement('div') as unknown as HTMLElement;
  finish.className = 'finish-tiles';
  const withFooter = colorPopover({ x: 10, y: 10, value: '#161616', onSelect: () => {}, footer: finish });
  const footer = miniDocument.querySelector('.vl-color-popover__footer');
  check('a footer sits in the popover, holding what it was given', !!footer && !!footer.querySelector('.finish-tiles'));
  withFooter.close();
  check('and goes with the popover', open() === 0);
}

{
  // `groups`: labelled runs of chips, and onSelect told which run a chip came from. Without
  // them nothing changes: no labels, and a chip's pick carries no group.
  const flat: unknown[][] = [];
  const plain = colorPopover({ x: 10, y: 10, value: '#161616', onSelect: (...args) => flat.push(args) });
  check('no group labels by default', miniDocument.querySelectorAll('.vl-color-popover__group').length === 0);
  (miniDocument.querySelector('.vl-color-popover__chip') as MiniElement).dispatchEvent({ type: 'click' });
  check('a flat chip pick carries no group', flat.length === 1 && flat[0][1] === undefined, JSON.stringify(flat));
  plain.close();

  const picks: [string, { group: number } | undefined][] = [];
  const grouped = colorPopover({
    x: 10,
    y: 10,
    value: '#ff8800',
    groups: [
      { label: 'In this design', options: [{ hex: '#ff8800', name: 'Orange' }, { hex: '#111111', name: 'Black' }] },
      { label: 'Nothing here', options: [] },
      { label: 'Filaments', options: [{ hex: '#ffffff', name: 'White' }, { hex: '#ff8800', name: 'Orange' }] },
    ],
    onSelect: (hex, from) => picks.push([hex, from]),
  });
  const labels = miniDocument.querySelectorAll('.vl-color-popover__group').map((n) => (n as MiniElement).textContent);
  check('each group with chips has its label, in order; an empty one has none', labels.join('|') === 'In this design|Filaments', labels.join('|'));
  const chips = miniDocument.querySelectorAll('.vl-color-popover__chip') as MiniElement[];
  check('every chip of every group is offered', chips.length === 4, String(chips.length));
  const rings = chips.filter((c) => c.className.includes('is-on')).length;
  check('a colour in two groups is ringed once, in the first', rings === 1 && chips[0].className.includes('is-on'), `${rings} rings`);
  chips[3].dispatchEvent({ type: 'click' });
  check('a pick says which group the chip came from', picks.length === 1 && picks[0][0] === '#ff8800' && picks[0][1]?.group === 2, JSON.stringify(picks));
  check('and closes the popover, as a flat pick does', open() === 0);
  grouped.close();
}

console.log(`\ncolor popover: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
