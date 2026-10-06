/*
  dropZone({ pick, bubble }) in the stand-in document (support/mini-dom.ts), whose events bubble
  until one is stopped.

  Off by default, and off the zone builds and behaves as before: a click opens the browser's file
  dialog, and a drop is the zone's alone. `pick` puts a host's own picker where the dialog was;
  `bubble` leaves a drop to the page's own handler, which sorts files by type.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniDocument, type MiniElement } from './support/mini-dom';
import { dropZone, type DropZoneOptions } from '../src/components/sources';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const body = miniDocument.body as MiniElement;
const file = (name: string) => ({ name }) as unknown as File;
const CAT = file('cat.svg');

/** A zone in the page, with what reached it and what got past it recorded. */
function zone(extra: Partial<DropZoneOptions> = {}) {
  const got: File[][] = [];
  const root = dropZone({ title: 'Drop an image', accept: 'image/*', onFiles: (f) => got.push(f), ...extra }) as unknown as MiniElement;
  const input = root.querySelector('input')!;
  let browsed = 0;
  // The browser opens its dialog for this. The stand-in has no dialog, and its click() would
  // bubble back to the zone, so it is counted instead.
  input.click = () => void browsed++;
  body.replaceChildren(root);
  const past: unknown[] = [];
  const router = (e: { dataTransfer?: { files: File[] } }) => past.push(e.dataTransfer?.files);
  body.listeners.set('drop', [router as never]);
  const drop = (files: File[]) => {
    const ev = { type: 'drop', dataTransfer: { files } } as unknown as { type: string; defaultPrevented: boolean };
    root.dispatchEvent(ev);
    return ev;
  };
  return { root, got, past, drop, browsed: () => browsed };
}

/* ------------------------------------------------------------------- as before */

{
  const plain = html(dropZone({ title: 'Drop an image', accept: 'image/*', onFiles() {} }) as unknown as MiniElement);
  const both = html(dropZone({ title: 'Drop an image', accept: 'image/*', onFiles() {}, pick: async () => null, bubble: true }) as unknown as MiniElement);
  check('pick and bubble build the same zone as without them', plain === both);

  const z = zone();
  z.root.click();
  check('by default a click opens the browser’s file dialog', z.browsed() === 1);
  z.root.dispatchEvent({ type: 'keydown', key: 'Enter' });
  check('by default Enter opens it too', z.browsed() === 2);
  z.root.classList.add('is-over');
  const ev = z.drop([CAT]);
  check('by default the zone takes a drop', z.got.length === 1 && z.got[0]![0] === CAT);
  check('by default the drop stops at the zone, so a page-wide handler never takes it twice', z.past.length === 0);
  check('by default the browser does not open the dropped file, and the highlight goes', ev.defaultPrevented && !z.root.classList.contains('is-over'));
}

/* ----------------------------------------------------------------------- bubble */

{
  const z = zone({ bubble: true });
  z.root.classList.add('is-over');
  const ev = z.drop([CAT]);
  check('bubble: the zone does not take the drop', z.got.length === 0);
  check('bubble: the page’s own handler gets it, files and all', z.past.length === 1 && (z.past[0] as File[])[0] === CAT);
  check('bubble: the browser still does not open the file, and the highlight goes', ev.defaultPrevented && !z.root.classList.contains('is-over'));
  z.root.click();
  check('bubble: a click still opens the dialog', z.browsed() === 1);
}

/* ------------------------------------------------------------------------- pick */

{
  let asked = 0;
  let answer: File | null = CAT;
  let handed: (() => void) | null = null;
  const z = zone({
    pick: async (browse) => {
      asked++;
      handed = browse;
      return answer;
    },
  });
  z.root.click();
  await tick();
  check('pick: a click opens the host’s picker, not the browser’s dialog', asked === 1 && z.browsed() === 0);
  check('pick: the file it gives goes to onFiles', z.got.length === 1 && z.got[0]!.length === 1 && z.got[0]![0] === CAT);
  answer = null;
  z.root.dispatchEvent({ type: 'keydown', key: ' ' });
  await tick();
  check('pick: the keyboard opens it too, and backing out of it does nothing', asked === 2 && z.got.length === 1);
  handed!();
  check('pick: it is handed the browser’s dialog, for when there is no host', z.browsed() === 1);
  z.drop([CAT]);
  check('pick: a drop is still the zone’s', z.got.length === 2 && z.past.length === 0);
}

body.replaceChildren();
body.listeners.delete('drop');
console.log(`\ndrop zone: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
