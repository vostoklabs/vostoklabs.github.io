import { el } from '../dom';
import type { FontPickerFont } from './font-picker';

/*
  The curated font grid: the user's own word set in each face, two cards to a row.

  `.vl-font-grid` / `.vl-font-card` have been in patterns.css since the name keychain's
  `.nk-font-*` was promoted — with no function behind them, which is the exact "class ladder is
  not a component" trap: the keychain kept its hand-rolled `<button class="nk-font-card">`, and
  the next generator to want a font grid had nothing to call. This is that function. The full
  library with search and categories is `fontPicker()`; this is the short list that sits in a
  panel and opens it.
*/

export interface FontCardsOptions {
  /** The fonts to show as cards — a curated handful, not the whole library. */
  fonts: FontPickerFont[];
  value: string;
  /** The user's own text, shown in every face. */
  sample: string;
  onChange(id: string): void;
  /** Resolves a font that is not one of `fonts` (chosen from the full picker), so it can be
   *  pinned first and the grid always shows the selection. */
  lookup?: (id: string) => FontPickerFont | undefined;
  /** Flags a face that lacks glyphs for the sample. Shown and marked, never hidden. */
  supports?: (font: FontPickerFont, sample: string) => boolean;
  /** Accessible name of the grid. Default "Fonts" (or the caption, when there is one). */
  label?: string;
  /**
   * A heading over the grid, in the section-header voice (`.vl-label`).
   *
   * One grid needs no caption — it is "the fonts". TWO do: a design that recommends the faces
   * that actually work for it ("Recommended for this design") shows them above the rest of the
   * curated list ("More fonts"), and without a word over each block the split reads as a
   * rendering bug. Given, the component returns a wrapper holding the caption and the grid;
   * omitted, it returns exactly the grid it always did.
   */
  caption?: string;
}

export type FontCardsHandle = HTMLElement & {
  setValue(id: string, notify?: boolean): void;
  setSample(text: string): void;
  getValue(): string;
};

export function fontCards(opts: FontCardsOptions): FontCardsHandle {
  const grid = el('div', {
    className: 'vl-font-grid',
    attrs: { role: 'listbox', 'aria-label': opts.label ?? opts.caption ?? 'Fonts' },
  });
  // The handle is the outermost node either way, so a caller appends what it is given and the
  // captioned and bare shapes are interchangeable at the call site.
  const root = (opts.caption
    ? el('div', { className: 'vl-font-cards' }, [el('p', { className: 'vl-label', text: opts.caption }), grid])
    : grid) as unknown as FontCardsHandle;
  let value = opts.value;
  let sample = opts.sample || 'Aa';
  const cards = new Map<string, { btn: HTMLButtonElement; sampleEl: HTMLElement; font: FontPickerFont }>();

  function card(font: FontPickerFont): HTMLButtonElement {
    const sampleEl = el('span', { className: 'vl-font-card__sample', text: sample });
    // Through the CSSOM rather than a `style` attribute, which a strict CSP can forbid.
    sampleEl.style.fontFamily = font.family;
    const btn = el(
      'button',
      {
        className: 'vl-font-card',
        attrs: { type: 'button', role: 'option', 'aria-selected': String(font.id === value) },
      },
      [sampleEl, el('span', { className: 'vl-font-card__name', text: font.label })],
    ) as HTMLButtonElement;
    btn.classList.toggle('is-on', font.id === value);
    btn.addEventListener('click', () => setValue(font.id, true));
    cards.set(font.id, { btn, sampleEl, font });
    return btn;
  }

  function mark() {
    for (const [id, c] of cards) {
      const on = id === value;
      c.btn.classList.toggle('is-on', on);
      c.btn.setAttribute('aria-selected', String(on));
      const ok = opts.supports ? opts.supports(c.font, sample) : true;
      const warn = c.btn.querySelector('.vl-font-card__warn');
      if (!ok && !warn) c.btn.append(el('span', { className: 'vl-font-card__warn', text: '⚠', attrs: { title: 'Characters missing' } }));
      else if (ok && warn) warn.remove();
    }
  }

  function paint() {
    grid.replaceChildren();
    cards.clear();
    const list = [...opts.fonts];
    if (!list.some((f) => f.id === value)) {
      const current = opts.lookup?.(value);
      if (current) list.unshift(current);
    }
    for (const f of list) grid.append(card(f));
    mark();
  }

  function setValue(id: string, notify = false) {
    value = id;
    if (!cards.has(id)) paint();
    else mark();
    if (notify) opts.onChange(id);
  }

  root.setValue = setValue;
  root.getValue = () => value;
  root.setSample = (text) => {
    sample = text || 'Aa';
    for (const c of cards.values()) c.sampleEl.textContent = sample;
    mark();
  };

  paint();
  return root;
}
