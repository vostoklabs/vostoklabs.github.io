import { BRAND } from '@vostok/brand';
import { el } from '../dom';
import { isDesktop, noopHandle, renderNothing } from '../host-env';

const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;

export interface LicenseModalOptions {
  /** Green pill text at the top, e.g. 'Download started'. Pass null to hide. */
  badge?: string | null;
  onClose?: () => void;
}

/** The post-download license modal: green badge → "Free for personal use" → CC
 *  line → red commercial focal box (subscription CTA) → blue full-width "Got it".
 *
 *  Deliberately emoji-free — this is the screen that asks people for money, and
 *  it reads as more serious without them. */
export function openLicenseModal(opts: LicenseModalOptions = {}): { close(): void } {
  if (isDesktop()) return noopHandle();
  const s = BRAND.pricing.subscription;
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const ccLine = el('p');
  ccLine.append(
    'Free for personal use. Print as many as you like for yourself; selling prints requires a commercial license (below).',
  );

  const commercialTitle = el('div', { className: 'vl-commercial-title' });
  commercialTitle.append(
    'Want to ',
    el('span', { className: 'vl-sell', text: 'sell' }),
    ' your prints?',
  );

  const commercialBody = el('p');
  commercialBody.append(
    'If you plan to sell these as 3D-printed products, you need a ',
    el('strong', { text: 'commercial license membership' }),
    ', just ',
    el('span', { className: 'vl-price', text: `${fmt(s.month)} / month` }),
    ` (or ${fmt(s.quarter)}/quarter, ${fmt(s.year)}/year), and it unlocks full commercial rights to ${s.covers}.`,
  );

  // The lifetime option used to sit here behind a "get in touch" link. It is gone:
  // one commercial CTA converts better than two, and the membership page covers it.
  const card = el('div', { className: 'vl-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'License' } }, [
    ...(opts.badge === null ? [] : [el('div', { className: 'vl-badge', text: opts.badge ?? 'Download started' })]),
    el('h2', { text: 'Free for personal use' }),
    ccLine,
    el('div', { className: 'vl-commercial' }, [
      commercialTitle,
      commercialBody,
      el('a', {
        className: 'vl-commercial-cta',
        text: 'Get the commercial license →',
        attrs: { href: BRAND.urls.mwCommercial, target: '_blank', rel: 'noopener noreferrer' },
      }),
    ]),
  ]);

  const overlay = el('div', { className: 'vl-overlay' }, [card]);
  const handle = {
    close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      opts.onClose?.();
      previouslyFocused?.focus();
    },
  };

  card.append(
    el('button', {
      className: 'vl-btn vl-btn--primary vl-btn--block',
      text: 'Got it',
      on: { click: () => handle.close() },
    }),
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') handle.close();
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) handle.close();
  });

  document.body.append(overlay);
  card.querySelector<HTMLElement>('a, button')?.focus();
  return handle;
}

/** Corner reminder for subsequent downloads (red-bordered card, top right),
 *  the clicker's lighter-touch nudge after the first full modal. */
export function licenseReminderToast(): { close(): void } {
  if (isDesktop()) return noopHandle();
  const s = BRAND.pricing.subscription;

  const body = el('p');
  body.append(
    'Selling these prints requires a ',
    el('strong', { text: 'commercial license' }),
    `. ${fmt(s.month)}/month covers ${s.covers}.`,
  );

  const closeBtn = el('button', {
    className: 'vl-license-toast-x',
    text: '×',
    attrs: { 'aria-label': 'Dismiss' },
  });

  const toastCard = el('div', { className: 'vl-license-toast', attrs: { role: 'status' } }, [
    closeBtn,
    el('div', { className: 'vl-license-toast-title', text: 'Download started' }),
    body,
    el('a', {
      className: 'vl-commercial-cta',
      text: 'Get the license →',
      attrs: { href: BRAND.urls.mwCommercial, target: '_blank', rel: 'noopener noreferrer' },
    }),
  ]);

  const handle = { close: () => toastCard.remove() };
  closeBtn.addEventListener('click', handle.close);
  document.body.append(toastCard);
  requestAnimationFrame(() => toastCard.classList.add('show'));
  return handle;
}

export interface LicenseNudgeOptions {
  /** Shown in the hint, e.g. 'The Clicker Generator'. */
  generatorName?: string;
}

/** Inline hint for export paths: free-tier line + a direct link to the MakerWorld
 *  commercial licence.
 *
 *  This is a sidebar aside, not a call to action — interrupting someone mid-edit
 *  with a full modal to say the same thing the page already says is a worse trade
 *  than just letting them open the licence page in a new tab. The modal still
 *  fires on the export path, where it is actually earned. */
export function licenseNudge(opts: LicenseNudgeOptions = {}): HTMLElement {
  // The desktop tier the user bought already answers this.
  if (isDesktop()) return renderNothing();
  const name = opts.generatorName ?? 'This generator';
  const hint = el('p', { className: 'vl-hint' });
  const link = el('a', {
    className: 'vl-link',
    text: 'Get a commercial license',
    attrs: { href: BRAND.urls.mwCommercial, target: '_blank', rel: 'noopener noreferrer' },
  });
  hint.append(`${name} is free for personal use. Selling prints? `, link, '.');
  return hint;
}

/** Open the license modal without the green download badge (topbar / manual trigger). */
export function openCommercialModal(opts: Omit<LicenseModalOptions, 'badge'> = {}): { close(): void } {
  return openLicenseModal({ ...opts, badge: null });
}
