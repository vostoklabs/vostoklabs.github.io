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
}

export interface DrawerHandle {
  close(): void;
  root: HTMLElement;
}

const openDrawers = new Set<DrawerHandle>();

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
  // would be unreachable.
  closeAllDrawers();

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

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handle.close();
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
  return handle;
}
