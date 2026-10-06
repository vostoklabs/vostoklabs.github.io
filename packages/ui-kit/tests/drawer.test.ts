/*
  drawer() in the stand-in document: one at a time, Escape, a drawer that stays under the one
  its controls open, and one that takes the focus as it opens.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { miniDocument, type MiniElement } from './support/mini-dom';
import { el } from '../src/dom';
import { drawer, closeAllDrawers } from '../src/components/drawer';
import { button } from '../src/components/button';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const body = miniDocument.body as MiniElement;
const open = () => body.querySelectorAll('.vl-drawer').map((d) => d.getAttribute('aria-label')).join();
const escape = () => miniDocument.documentElement.dispatchEvent({ type: 'keydown', key: 'Escape' });

/* ---------------------------------------------------------------- the default */

{
  const outside = button({ label: 'Outside' }) as unknown as MiniElement;
  body.append(outside);
  outside.focus();
  drawer({ title: 'A', content: el('div', {}, [button({ label: 'In A' })]) });
  check('by default a drawer leaves the focus where it was', miniDocument.activeElement === outside);
  drawer({ title: 'B', content: 'Words' });
  check('opening a drawer closes the one already open', open() === 'B');
  escape();
  check('Escape closes it', open() === '');
}

/* ---------------------------------------------------------------- stayOpen */

{
  drawer({ title: 'Settings', content: el('div', {}, [button({ label: 'Shape' })]), stayOpen: true });
  drawer({ title: 'Symbols', content: 'A grid' });
  check('stayOpen: still open under a drawer its controls opened', open() === 'Settings,Symbols');
  escape();
  check('stayOpen: Escape closes the drawer on top, and only that one', open() === 'Settings');
  drawer({ title: 'Fonts', content: 'Cards' });
  drawer({ title: 'Colours', content: 'Swatches' });
  check('stayOpen: a drawer that does not stay still gives way to the next one over the sheet', open() === 'Settings,Colours');
  escape();
  escape();
  check('stayOpen: then Escape closes the sheet itself', open() === '');
  drawer({ title: 'Settings', content: 'Rows', stayOpen: true });
  closeAllDrawers();
  check('stayOpen: closeAllDrawers() still closes it', open() === '');
}

/* ---------------------------------------------------------------- focusFirst */

{
  const hidden = button({ label: 'Hidden' }) as unknown as MiniElement;
  hidden.hidden = true;
  const first = button({ label: 'First' }) as unknown as MiniElement;
  const f = drawer({ title: 'F', content: el('div', {}, [hidden as never, first as never, button({ label: 'Second' })]), focusFirst: true });
  check('focusFirst: the first control that is showing takes the focus', miniDocument.activeElement === first);
  f.close();
  const g = drawer({ title: 'G', content: 'Nothing to press', focusFirst: true });
  check('focusFirst with nothing to press: the close button takes it', miniDocument.activeElement === (g.root as unknown as MiniElement).querySelector('.vl-drawer__close'));
  g.close();
}

console.log(`\ndrawer: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
