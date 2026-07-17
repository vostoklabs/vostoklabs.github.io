import { el } from '../dom';

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** ms before auto-dismiss */
  duration?: number;
}

let container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (!container || !container.isConnected) {
    container = el('div', { className: 'vl-toasts', attrs: { 'aria-live': 'polite' } });
    document.body.append(container);
  }
  return container;
}

/** Show a small transient message. Safe to call from anywhere. */
export function toast(message: string, opts: ToastOptions = {}): void {
  const kind = opts.kind ?? 'info';
  const duration = opts.duration ?? 3500;
  const node = el('div', {
    className: `vl-toast${kind === 'info' ? '' : ` vl-toast--${kind}`}`,
    text: message,
    attrs: { role: 'status' },
  });
  getContainer().append(node);
  window.setTimeout(() => node.remove(), duration);
}
