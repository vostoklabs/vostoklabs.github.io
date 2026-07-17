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
}

export interface DialogHandle {
  close(): void;
  root: HTMLElement;
}

/** Accessible modal dialog: Esc closes, backdrop click closes, focus is
 *  moved in on open and restored on close. */
export function dialog(opts: DialogOptions): DialogHandle {
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const body = el('div');
  body.append(typeof opts.content === 'string' ? document.createTextNode(opts.content) : opts.content);

  const box = el('div', {
    className: 'vl-dialog',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
  }, [
    el('h2', { className: 'vl-dialog__title', text: opts.title }),
    body,
  ]);

  const overlay = el('div', { className: 'vl-overlay' }, [box]);

  const handle: DialogHandle = {
    root: overlay,
    close() {
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
  const firstButton = box.querySelector<HTMLElement>('button, a[href]');
  (firstButton ?? box).focus?.();
  return handle;
}
