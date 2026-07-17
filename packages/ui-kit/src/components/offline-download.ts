import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

export interface OfflineDownloadOptions {
  /** URL of the single-file offline build (e.g. `offline/clicker.html`). */
  href: string;
  label?: string;
  /** e.g. "4 MB", shown after the label. */
  sizeHint?: string;
}

/** "Download the offline version" button: the keep-it-forever artifact. */
export function offlineDownloadButton(opts: OfflineDownloadOptions): HTMLElement {
  const label = opts.label ?? 'Download offline version';
  const btn = el('a', {
    className: 'vl-btn',
    attrs: { href: opts.href, download: '' },
  });
  btn.append(svgEl(ICONS.download), label);
  if (opts.sizeHint) {
    const size = el('small', { text: ` (${opts.sizeHint})` });
    size.style.color = 'var(--muted)';
    btn.append(size);
  }
  return btn;
}
