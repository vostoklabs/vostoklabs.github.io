import { el } from '../dom';

/*
  A panel that slides in at the edge of the screen instead of over the middle of it.

  The difference from `dialog()` is not styling, it is what stays usable. A modal
  takes the viewport and dims what is behind it, which is right for "are you sure?"
  and wrong for "pick one of these and watch the model change" — you end up choosing
  a symbol from a grid while the thing it goes on is hidden behind the grid.

  So: no backdrop, nothing inert, the stage stays live and keeps rebuilding while
  the drawer is open. On a narrow screen it becomes a bottom sheet rather than
  swallowing the width, for the same reason.
*/

export interface DrawerOptions {
  title: string;
  content: Node | string;
  /** Called after it closes, however it was closed. */
  onClose?: () => void;
  /**
   * Stay under a drawer that opens over it, rather than close: the new one goes on top, Escape
   * closes the top one first, and this one is still there when it goes. For a sheet whose own
   * controls open drawers (the phone layout's Settings sheet, where Insert symbol opens a
   * picker). `closeAllDrawers()` still closes it. Default false: opening a drawer closes every
   * other. (Not the symbol picker's `stayOpen`, which keeps a picker open after a pick.)
   */
  staysUnder?: boolean;
  /**
   * Take the keyboard focus as it opens: the first control in the content that is showing, or
   * the close button when there is none. For a drawer someone opened in order to use it (the
   * phone layout's Settings sheet). Default false: the focus stays where it was.
   */
  focusFirst?: boolean;
}

export interface DrawerHandle {
  close(): void;
  root: HTMLElement;
}

const openDrawers = new Set<DrawerHandle>();
/** The open drawers that asked to stay when another opens. */
const staying = new WeakSet<DrawerHandle>();
/** An Escape the top drawer has already answered: the ones under it ignore it. */
const answered = new WeakSet<Event>();

/** What can take the focus, in document order. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Closes every open drawer. Call it from a generator's teardown — a drawer lives
 *  on `<body>`, outside the container a host clears. */
export function closeAllDrawers(): void {
  for (const handle of [...openDrawers]) {
    try {
      handle.close();
    } catch {
      openDrawers.delete(handle);
    }
  }
}

export function drawer(opts: DrawerOptions): DrawerHandle {
  // One at a time. Two drawers would stack on the same edge and the lower one
  // would be unreachable. A drawer that asked to stay is the exception: it is meant to be
  // under the one its controls opened, and back when that one goes.
  for (const open of [...openDrawers]) {
    if (staying.has(open)) continue;
    try {
      open.close();
    } catch {
      openDrawers.delete(open);
    }
  }

  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const close = el('button', {
    className: 'vl-drawer__close',
    text: '×',
    attrs: { type: 'button', 'aria-label': 'Close' },
  });

  const body = el('div', { className: 'vl-drawer__body' }, [
    typeof opts.content === 'string' ? document.createTextNode(opts.content) : opts.content,
  ]);

  const root = el('aside', {
    className: 'vl-drawer',
    attrs: { role: 'dialog', 'aria-label': opts.title },
  }, [
    el('header', { className: 'vl-drawer__head' }, [
      el('h2', { className: 'vl-drawer__title', text: opts.title }),
      close,
    ]),
    body,
  ]);

  // Escape closes the drawer on top, and only that one.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || answered.has(e) || [...openDrawers].pop() !== handle) return;
    answered.add(e);
    handle.close();
  };

  let closed = false;
  const handle: DrawerHandle = {
    root,
    close() {
      if (closed) return;
      closed = true;
      openDrawers.delete(handle);
      document.removeEventListener('keydown', onKey);
      root.remove();
      previouslyFocused?.focus?.();
      opts.onClose?.();
    },
  };

  close.addEventListener('click', () => handle.close());
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  openDrawers.add(handle);
  if (opts.staysUnder) staying.add(handle);
  if (opts.focusFirst) {
    const first = [...body.querySelectorAll<HTMLElement>(FOCUSABLE)].find((n) => !n.closest('[hidden]'));
    (first ?? close).focus();
  }
  return handle;
}
