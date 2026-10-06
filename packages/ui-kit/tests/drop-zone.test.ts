/*
  dropZone({ pick, bubble }) and uploadCta({ pick }) in the stand-in document
  (support/mini-dom.ts), whose events bubble until one is stopped.

  Off by default, and off the zone builds and behaves as before: a click opens the browser's file
  dialog, and a drop is the zone's alone. `pick` puts a host's own picker where the dialog was;
  `bubble` leaves a drop to the page's own handler, which sorts files by type.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniDocument, type MiniElement } from './support/mini-dom';
import { dropZone, uploadCta, type DropZoneOptions } from '../src/components/sources';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Rejections nothing handled: node stops for one, so they are collected and checked at the end. */
const escaped: unknown[] = [];
process.on('unhandledRejection', (e) => void escaped.push(e));

const body = miniDocument.body as MiniElement;
const file = (name: string) => ({ name }) as unknown as File;
const CAT = file('cat.svg');
const toasts = () => body.querySelectorAll('.vl-toast').map((t) => t.textContent);

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

{
  let asked = 0;
  const z = zone({
    pick: async () => {
      asked++;
      return null;
    },
  });
  z.root.click();
  check('pick: the picker is asked at once, inside the press, so a dialog it opens is still the person’s doing', asked === 1);
  await tick();
  z.root.dispatchEvent({ type: 'keydown', key: 'Enter' });
  for (let i = 0; i < 4; i++) z.root.dispatchEvent({ type: 'keydown', key: 'Enter', repeat: true } as never);
  await tick();
  check('pick: Enter held down opens it once, not once a repeat', asked === 2, `asked ${asked}`);
  const d = zone();
  d.root.dispatchEvent({ type: 'keydown', key: 'Enter', repeat: true } as never);
  check('a repeat of a key held down opens no dialog either', d.browsed() === 0);
}

{
  // In a browser the hidden input's click() dispatches a click that bubbles back up to the zone,
  // and a click() on the input while its own click runs does nothing.
  let asked = 0;
  const z = zone({
    pick: async (browse) => {
      asked++;
      browse();
      return null;
    },
  });
  const input = z.root.querySelector('input')!;
  let browsed = 0;
  let running = false;
  input.click = () => {
    if (running) return;
    running = true;
    browsed++;
    input.dispatchEvent({ type: 'click' });
    running = false;
  };
  z.root.click();
  await tick();
  check('pick: the input’s own click, bubbling back to the zone, does not ask the picker again', asked === 1 && browsed === 1, `asked ${asked}, browsed ${browsed}`);
}

{
  const z = zone({
    pick: async () => {
      throw new Error('The host could not open its picker.');
    },
  });
  z.root.click();
  await tick();
  check('pick: a picker that fails is said in a toast', toasts().includes('Could not open a file: The host could not open its picker.'), toasts().join(' | '));
  const t = zone({
    pick: () => {
      throw new Error('No host here.');
    },
  });
  let threw = false;
  try {
    t.root.click();
  } catch {
    threw = true;
  }
  await tick();
  check('pick: a picker that throws does not throw out of the press, and is said too', !threw && toasts().includes('Could not open a file: No host here.'), toasts().join(' | '));
  const v = zone({ pick: (() => CAT) as unknown as DropZoneOptions['pick'] });
  v.root.click();
  await tick();
  check('pick: a picker that hands back the file itself, not a promise of it, still works', v.got.length === 1 && v.got[0]![0] === CAT);
}

/* ---------------------------------------------------------------- uploadCta pick */

{
  const got: File[][] = [];
  const plain = uploadCta({ label: 'Upload SVG file(s)', accept: '.svg', multiple: true, onFiles: (f) => got.push(f) }) as unknown as MiniElement;
  const picked = uploadCta({ label: 'Upload SVG file(s)', accept: '.svg', multiple: true, onFiles: (f) => got.push(f), pick: async () => CAT }) as unknown as MiniElement;
  check('uploadCta pick: builds the same row as without it', html(plain) === html(picked));

  // Without pick, a press on the row is the label's own: nothing stops it, so the dialog opens.
  const press = (row: MiniElement, target?: MiniElement) => {
    const ev = { type: 'click', target: target ?? row } as unknown as { type: string; defaultPrevented: boolean };
    (target ?? row).dispatchEvent(ev);
    return ev;
  };
  check('uploadCta: without pick, a press is left to open the dialog', !press(plain).defaultPrevented);

  let asked = 0;
  let browsed = 0;
  let answer: File | null = CAT;
  const row = uploadCta({
    label: 'Upload SVG file(s)',
    onFiles: (f) => got.push(f),
    pick: async (browse) => {
      asked++;
      if (!answer) browse();
      return answer;
    },
  }) as unknown as MiniElement;
  const input = row.querySelector('input')!;
  input.click = () => {
    browsed++;
    press(row, input); // the input's own click, bubbling to the row
  };
  got.length = 0;
  const pressed = press(row);
  check('uploadCta pick: the picker is asked at once, inside the press', asked === 1);
  await tick();
  check('uploadCta pick: a press opens the host’s picker instead of the dialog', pressed.defaultPrevented && asked === 1 && browsed === 0);
  check('uploadCta pick: the file it gives goes to onFiles', got.length === 1 && got[0]![0] === CAT);
  answer = null;
  press(row);
  await tick();
  check('uploadCta pick: with no host the picker browses, and the input’s own click is let through', asked === 2 && browsed === 1 && got.length === 1);

  const failing = uploadCta({
    label: 'Upload SVG file(s)',
    onFiles: (f) => got.push(f),
    pick: () => {
      throw new Error('The host said no.');
    },
  }) as unknown as MiniElement;
  body.replaceChildren(failing);
  let threw = false;
  try {
    press(failing);
  } catch {
    threw = true;
  }
  await tick();
  check('uploadCta pick: a picker that throws is said in a toast, not thrown out of the press', !threw && toasts().includes('Could not open a file: The host said no.'), toasts().join(' | '));
}

check('nothing above left a rejection unhandled', escaped.length === 0, escaped.map((e) => (e as Error)?.message ?? String(e)).join(' | '));

body.replaceChildren();
body.listeners.delete('drop');
console.log(`\ndrop zone: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
