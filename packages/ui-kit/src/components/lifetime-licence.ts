/**
 * The lifetime commercial licence: the sales offer and the owner's certificate.
 *
 * The lifetime licence offer and certificate dialogs, generalised so each app supplies its own
 * copy, price and terms. A second call site wanting the same thing is exactly the signal
 * invariant #9 exists for: fix it in the kit, not a second hand-rolled copy.
 *
 * File is `lifetime-licence`, not `licence`: `./license` (American spelling) already exports the
 * subscription nudge modal, and a pair of file names one letter apart is exactly the trap that
 * gets the wrong one imported.
 */
import { el } from '../dom';
import { dialog } from './dialog';
import { button, type ButtonHandle } from './button';
import { toast } from './toast';

/** One thing the licence also unlocks: a bold name, and optionally what it does. */
export interface LicenceBonus {
  name: string;
  detail?: string;
}

export interface LicenceOfferOptions {
  title: string;
  /** Already formatted, currency included. Null/undefined omits the price block entirely (never shown blank). */
  price?: string | null;
  /** Default 'one payment, yours for good'. */
  priceCaption?: string;
  /** Optional paragraph before the terms list (e.g. acknowledging an existing lower tier). */
  lede?: string;
  /** Dot-bullet rights, most-exclusive first. */
  terms: string[];
  /** Heading of the bonus block. Default 'Bonus'. */
  bonusHeading?: string;
  /** What else the licence unlocks, one bullet each; the block is omitted when empty/undefined. */
  bonus?: LicenceBonus[];
  footNote?: string;
  /** Price belongs in here too. */
  buyLabel: string;
  /** Default 'Not now'. */
  notNowLabel?: string;
  /** Dialog closes BEFORE this settles, matching dialog()'s own onClick timing. */
  onBuy: () => Promise<boolean>;
  onPurchased?: () => void;
  onDismissed?: () => void;
}

/** The sales pitch: price, rights, what else it unlocks. Opens on demand and gates nothing —
 *  closing it changes no state. */
export function openLicenceOffer(opts: LicenceOfferOptions): void {
  // Set when the buy button is pressed, so the close it performs is not read as a dismissal.
  // `handle.close()` fires `onClose` SYNCHRONOUSLY, well before `onBuy()` settles, so without
  // this a completed purchase reports itself as "user closed the dialog".
  let buying = false;

  const body = el('div', { className: 'vl-licence' });
  if (opts.lede) body.append(el('p', { className: 'vl-licence__lede', text: opts.lede }));

  if (opts.price) {
    const price = el('div', { className: 'vl-licence__price' });
    const row = el('div', { className: 'vl-licence__price-row' });
    row.append(el('span', { className: 'vl-licence__amount', text: opts.price }));
    price.append(row, el('span', {
      className: 'vl-licence__once', text: opts.priceCaption ?? 'one payment, yours for good',
    }));
    body.append(price);
  }

  const terms = el('ul', { className: 'vl-licence__terms' });
  for (const term of opts.terms) {
    const li = el('li');
    li.append(el('span', { className: 'vl-licence__dot' }), el('span', { text: term }));
    terms.append(li);
  }
  body.append(terms);

  /* The bonus block: what else the licence unlocks. The
     rights above are what the licence IS; this is what comes with it, so it is set apart rather
     than appended to the same list. */
  if (opts.bonus?.length) {
    const bonus = el('div', { className: 'vl-licence__bonus' });
    bonus.append(el('p', { className: 'vl-licence__bonus-head', text: opts.bonusHeading ?? 'Bonus' }));
    const list = el('ul', { className: 'vl-licence__bonus-list' });
    for (const item of opts.bonus) {
      const text = el('span');
      text.append(el('strong', { text: item.name }));
      if (item.detail) text.append(document.createTextNode(`: ${item.detail}`));
      const li = el('li');
      li.append(text);
      list.append(li);
    }
    bonus.append(list);
    body.append(bonus);
  }

  if (opts.footNote) body.append(el('p', { className: 'vl-licence__foot', text: opts.footNote }));

  dialog({
    title: opts.title,
    content: body,
    onClose: () => { if (!buying) opts.onDismissed?.(); },
    actions: [
      { label: opts.notNowLabel ?? 'Not now' },
      {
        label: opts.buyLabel,
        emphasis: 'cta',
        onClick: (handle) => {
          // Close first: the purchase prompt is its own surface, and leaving this modal
          // behind it is how a user ends up with two things to dismiss. `buying` is what keeps
          // that close from being read as a dismissal by `onClose` above.
          buying = true;
          handle.close();
          void opts.onBuy().then((ok) => (ok ? opts.onPurchased?.() : opts.onDismissed?.()));
          return false;
        },
      },
    ],
  });
}

export interface LicenceCertificateOptions {
  title: string;
  lede: string;
  bodyText: string;
  /** Default 'Select all text'. */
  selectLabel?: string;
  /** Default 'Close'. */
  closeLabel?: string;
}

/** The owner's certificate: a summary lede, the full licence text, and a way to get it out of
 *  the app: select + copy, which works in every build. */
export function openLicenceCertificate(opts: LicenceCertificateOptions): void {
  const body = el('div', { className: 'vl-licence-cert' });
  body.append(el('p', { className: 'vl-licence-cert__lede', text: opts.lede }));

  // `tabindex=-1`: a <pre> is not focusable without it, and the Select button below focuses it
  // so the selection it makes is the one a Ctrl+C acts on.
  const doc = el('pre', { className: 'vl-licence-cert__text', text: opts.bodyText, attrs: { tabindex: '-1' } });
  body.append(doc);

  body.append(button({
    label: opts.selectLabel ?? 'Select all text',
    emphasis: 'primary',
    block: true,
    onClick: () => {
      const range = document.createRange();
      range.selectNodeContents(doc);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      doc.focus({ preventScroll: true });
      toast('Licence selected. Press Ctrl+C (or Cmd+C) to copy it.', { kind: 'ok' });
    },
  }));

  dialog({
    title: opts.title,
    content: body,
    actions: [{ label: opts.closeLabel ?? 'Close', primary: true }],
  });
}

export interface LicenceButtonOptions {
  /** Whether the licence is held: the host's `isUnlocked`, presentation only. It picks the label
   *  and which window opens, read on every click and every `refresh()`. */
  owned: () => boolean;
  /** The offer, built when the button is pressed, so the price is the host's latest. Its
   *  `onBuy` is the purchase itself (the host's access gate). */
  offer: () => Omit<LicenceOfferOptions, 'onPurchased' | 'onDismissed'>;
  /** The owner's certificate, opened instead of the offer once the licence is held. */
  certificate: LicenceCertificateOptions;
  /** After a completed purchase; the button has already turned into the certificate's. */
  onPurchased?: () => void;
  /** Default 'Unlock lifetime commercial licence'. */
  label?: string;
  /** Default 'Show licence terms'. */
  ownedLabel?: string;
  /** Native tooltip while it sells. */
  title?: string;
}

/** The licence button, with `refresh()` for when ownership may have changed outside it. */
export type LicenceButtonHandle = ButtonHandle & { refresh(): void };

/**
 * The licence's call to action: the kit's `cta` rung, full width, opening the offer and nothing
 * else. It is not a gate, and ignoring it changes nothing. Once the licence is held it stops
 * selling and becomes a plain secondary that opens the certificate: same place, same job, no
 * urgency.
 *
 * One offer at a time, from the click until the purchase settles either way: a second click
 * while the first window is mounting, or while the host's payment flow is open, does nothing.
 */
export function lifetimeLicenceButton(opts: LicenceButtonOptions): LicenceButtonHandle {
  const label = opts.label ?? 'Unlock lifetime commercial licence';
  const ownedLabel = opts.ownedLabel ?? 'Show licence terms';
  let open = false;

  const btn = button({
    label,
    title: opts.title,
    emphasis: 'cta',
    block: true,
    onClick: () => {
      if (opts.owned()) {
        openLicenceCertificate(opts.certificate);
        return;
      }
      if (open) return;
      open = true;
      const offer = opts.offer();
      openLicenceOffer({
        ...offer,
        // A purchase that throws is one that did not happen, and must not leave the button dead.
        onBuy: () => offer.onBuy().catch(() => false),
        onPurchased: () => {
          open = false;
          refresh();
          opts.onPurchased?.();
        },
        onDismissed: () => { open = false; },
      });
    },
  }) as LicenceButtonHandle;

  function refresh() {
    const held = opts.owned();
    btn.setLabel(held ? ownedLabel : label);
    if (opts.title && !held) btn.setAttribute('title', opts.title);
    else btn.removeAttribute('title');
    btn.classList.toggle('vl-btn--cta', !held);
    btn.classList.toggle('vl-btn--primary', !held);
    btn.classList.toggle('vl-btn--secondary', held);
  }
  btn.refresh = refresh;
  refresh();
  return btn;
}
