import { el } from '../dom';

export interface DialogAction {
  label: string;
  primary?: boolean;
  /** Called on click; the dialog closes afterwards unless the handler returns false. */
  onClick?: (dialog: DialogHandle) => boolean | void;
}

export interface DialogOptions {
  title: string;
  content: Node | string;
  actions?: DialogAction[];
  onClose?: () => void;
  /**
   * Roughly doubles the width, for content that is a grid rather than a paragraph.
   *
   * The default 440 px is sized for prose and a couple of buttons. Content wider than that
   * does not widen the box — it overflows it, which is what a font grid inside a help-sized
   * dialog looked like. A modifier rather than a free width, so there are two dialog sizes
   * in the catalogue instead of one per call site.
   */
  wide?: boolean;
}

export interface DialogHandle {
  close(): void;
  root: HTMLElement;
}

/**
 * Every dialog currently on screen.
 *
 * A dialog appends its overlay to `<body>`, which is the right place for a modal and the
 * wrong place for anything a desktop host has to clean up: the host clears the container it
 * gave the generator, and the overlay is not in it. Leaving one behind is not a cosmetic
 * problem either — the magnet wizard's steps carry their own WebGL preview, so a stranded
 * one holds a context that never comes back.
 *
 * A module-level set is enough because a modal is by definition global to the page.
 */
const openDialogs = new Set<DialogHandle>();

/**
 * Closes every open dialog. Call it from a generator's teardown.
 *
 * Safe to call when none are open, and safe to call twice — `close()` is idempotent in
 * effect, and each handle removes itself from the set as it goes.
 */
export function closeAllDialogs(): void {
  for (const handle of [...openDialogs]) {
    try {
      handle.close();
    } catch {
      // One dialog refusing to close must not strand the others.
      openDialogs.delete(handle);
    }
  }
}

/** Accessible modal dialog: Esc closes, backdrop click closes, focus is
 *  moved in on open and restored on close. */
export function dialog(opts: DialogOptions): DialogHandle {
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const body = el('div');
  body.append(typeof opts.content === 'string' ? document.createTextNode(opts.content) : opts.content);

  const box = el('div', {
    className: `vl-dialog${opts.wide ? ' vl-dialog--wide' : ''}`,
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
  }, [
    el('h2', { className: 'vl-dialog__title', text: opts.title }),
    body,
  ]);

  const overlay = el('div', { className: 'vl-overlay' }, [box]);

  const handle: DialogHandle = {
    root: overlay,
    close() {
      openDialogs.delete(handle);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      opts.onClose?.();
      previouslyFocused?.focus();
    },
  };

  if (opts.actions?.length) {
    const row = el('div', { className: 'vl-dialog__actions' });
    for (const action of opts.actions) {
      row.append(
        el('button', {
          className: `vl-btn${action.primary ? ' vl-btn--primary' : ''}`,
          text: action.label,
          on: {
            click: () => {
              if (action.onClick?.(handle) === false) return;
              handle.close();
            },
          },
        }),
      );
    }
    box.append(row);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handle.close();
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) handle.close();
  });

  document.body.append(overlay);
  openDialogs.add(handle);
  const firstButton = box.querySelector<HTMLElement>('button, a[href]');
  (firstButton ?? box).focus?.();
  return handle;
}
