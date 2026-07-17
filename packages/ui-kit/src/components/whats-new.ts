import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

export interface WhatsNewItem {
  /** Bold lead-in, e.g. 'Sharper image tracing'. */
  lead: string;
  /** Rest of the sentence. */
  text: string;
}

export interface WhatsNewOptions {
  items: WhatsNewItem[];
  title?: string;
  intro?: string;
  /** Called when dismissed; `dontShowAgain` reflects the checkbox. */
  onClose?: (dontShowAgain: boolean) => void;
}

/** "What's new" card, blue pill badge, checkmark list, don't-show-again +
 *  full-width "Got it →". Same structure as the shipped clicker. */
export function showWhatsNew(opts: WhatsNewOptions): { close(): void } {
  const list = el('ul', { className: 'vl-whatsnew-list' });
  for (const item of opts.items) {
    const span = el('span');
    span.append(el('strong', { text: item.lead }), `: ${item.text}`);
    list.append(el('li', {}, [svgEl(ICONS.check), span]));
  }

  const checkbox = el('input', { attrs: { type: 'checkbox' } });
  const dismiss = el('label', { className: 'vl-dismiss' }, [checkbox, "Don't show again"]);

  const overlay = el('div', { className: 'vl-overlay' });
  const handle = {
    close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      opts.onClose?.(checkbox.checked);
    },
  };

  const card = el('div', { className: 'vl-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': "What's new" } }, [
    el('div', { className: 'vl-badge vl-badge--accent', text: "What's new" }),
    el('h2', { text: opts.title ?? 'Latest updates ✨' }),
    el('p', { text: opts.intro ?? 'A few improvements landed since your last visit:' }),
    list,
    el('div', { className: 'vl-whatsnew-foot' }, [
      dismiss,
      el('button', {
        className: 'vl-btn vl-btn--primary',
        text: 'Got it →',
        on: { click: () => handle.close() },
      }),
    ]),
  ]);
  overlay.append(card);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handle.close();
  };
  document.addEventListener('keydown', onKey);

  document.body.append(overlay);
  card.querySelector<HTMLElement>('button.vl-btn--primary')?.focus();
  return handle;
}

/** Show the card only if this `version` hasn't been dismissed before.
 *  Checking "don't show again" stores the version in localStorage. */
export function maybeShowWhatsNew(
  opts: WhatsNewOptions & { version: string; storageKey?: string },
): { close(): void } | null {
  const key = opts.storageKey ?? 'vl-whatsnew-dismissed';
  try {
    if (localStorage.getItem(key) === opts.version) return null;
  } catch {
    /* storage unavailable, just show */
  }
  return showWhatsNew({
    ...opts,
    onClose: (dontShowAgain) => {
      if (dontShowAgain) {
        try {
          localStorage.setItem(key, opts.version);
        } catch {
          /* ignore */
        }
      }
      opts.onClose?.(dontShowAgain);
    },
  });
}
