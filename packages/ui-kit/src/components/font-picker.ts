import { el, uid } from '../dom';
import { chip } from './elements';
import { textField } from './elements';

/*
  A searchable, scrolling list of fonts, each row rendered in its own face with the user's own
  word — not a grid of font NAMES, which tells you nothing about what your text will look like.

  This exists because three apps hand-rolled one: the keychain's font tiles, the magnet
  generator's, and the fold-up box's logo picker (see `sources.ts`'s `ThumbTileOptions.text`
  comment). A grid of square tiles works for a handful of curated faces but not for the full
  ~150-font library — a word needs width to read, not a square box — so this is a list, one
  row per font, with the sample on the left and the name in small type on the right.
*/

export interface FontPickerFont {
  id: string;
  label: string;
  /** CSS font-family to render the sample in, e.g. `fontFamilyFor(f.id)`. */
  family: string;
  category?: string;
  /** The alphabets the face writes: 'Latin', 'Cyrillic', 'Korean'... When the fonts name two or
   *  more between them, the picker adds an Alphabet filter under the categories. */
  scripts?: string[];
}

/** The order the Alphabet chips come in. An alphabet not listed here follows them, A to Z. */
const SCRIPT_ORDER = ['Latin', 'Cyrillic', 'Greek', 'Korean', 'Japanese', 'Chinese'];

export interface FontPickerOptions {
  /** All of them — the full library, not just a curated shortlist. */
  fonts: FontPickerFont[];
  value: string;
  /** The user's own word, shown in every face. */
  sample: string;
  onChange(id: string): void;
  /** Curated ids pinned first under "Popular". Default none. */
  featured?: string[];
  /** The heading over the pinned faces. Default "Popular"; a design that names the faces that
   *  suit it says "Recommended for this design". */
  featuredLabel?: string;
  label?: string;
  /**
   * `'list'` (default): one row per font, sample on the left, name on the right. It fits a
   * narrow panel, which is where Laser Studio keeps the whole library.
   *
   * `'cards'`: the same `.vl-font-card` the curated grid uses, as many columns as fit, with the
   * category in the corner. For the library opened in a wide dialog (`fontChooser`), where one
   * sample per row leaves most of the width empty.
   */
  layout?: 'list' | 'cards';
  /** Flags a face that lacks glyphs for the sample. Shown and marked, never hidden. */
  supports?: (font: FontPickerFont, sample: string) => boolean;
}

export type FontPickerHandle = HTMLElement & {
  setValue(id: string, notify?: boolean): void;
  setSample(text: string): void;
  getValue(): string;
};

/** Rows rendered per page, more added as the sentinel at the bottom scrolls into view. A flat
 *  list of ~150 webfont rows costs real layout time up front; most of it is below the fold. */
const CHUNK = 40;

export type FontStyleChipsHandle = HTMLElement & {
  /** Press `style` without calling `onPick`: a filter elsewhere reset it. */
  setActive(style: string): void;
  /** The styles offered, without "All". */
  styles: string[];
};

/**
 * The style chips: "All", then each category the fonts name, A to Z, one pressed at a time.
 * The library (`fontPicker`) and the panel's cards (`fontChooser`) both put this row over their
 * fonts, so the two are one row and cannot drift into two looks.
 */
export function fontStyleChips(fonts: FontPickerFont[], active: string, onPick: (style: string) => void): FontStyleChipsHandle {
  const styles = Array.from(new Set(fonts.map((f) => f.category).filter((c): c is string => !!c))).sort();
  const row = el('div', {
    className: 'vl-font-picker__cats',
    attrs: { role: 'group', 'aria-label': 'Font category' },
  }) as unknown as FontStyleChipsHandle;
  const chips = new Map<string, ReturnType<typeof chip>>();
  const press = (style: string) => {
    for (const [id, c] of chips) c.setPressed(id === style);
  };
  for (const style of ['All', ...styles]) {
    const c = chip({
      label: style,
      pressed: style === active,
      onToggle: () => {
        // A pressed chip clicked again stays pressed: there is always one style.
        press(style);
        onPick(style);
      },
    });
    chips.set(style, c);
    row.append(c);
  }
  row.setActive = press;
  row.styles = styles;
  return row;
}

export function fontPicker(opts: FontPickerOptions): FontPickerHandle {
  let value = opts.value;
  let sample = opts.sample || 'Aa';
  let query = '';
  let activeCat = 'All';
  let activeScript = 'All';
  let shown = CHUNK;

  const search = textField({
    label: opts.label ?? 'Search fonts',
    type: 'search',
    placeholder: `Search ${opts.fonts.length} fonts…`,
    onInput: (v) => {
      query = v;
      shown = CHUNK;
      paint({ keepScroll: false });
    },
  });

  const catRow = fontStyleChips(opts.fonts, activeCat, (style) => {
    activeCat = style;
    shown = CHUNK;
    paint({ keepScroll: false });
  });

  // Alphabet: a second row of the same chips, labelled, since a bare second row would read as
  // more categories. It narrows the list together with the category and the search.
  const named = new Set(opts.fonts.flatMap((f) => f.scripts ?? []));
  const scripts = [...SCRIPT_ORDER.filter((s) => named.has(s)), ...[...named].filter((s) => !SCRIPT_ORDER.includes(s)).sort()];
  const scriptLabel = el('span', { className: 'vl-font-picker__row-label', text: 'Alphabet', attrs: { id: uid('vl-font-alphabet') } });
  const scriptRow = el('div', { className: 'vl-font-picker__cats', attrs: { role: 'group', 'aria-labelledby': scriptLabel.id } }, [scriptLabel]);
  const scriptChips = new Map<string, ReturnType<typeof chip>>();
  for (const s of ['All', ...scripts]) {
    const c = chip({
      label: s,
      pressed: s === activeScript,
      onToggle: () => {
        activeScript = s;
        // Few faces write each alphabet, so picking one shows all of them: the style goes back to
        // All rather than leaving, say, Comic and Korean together with next to nothing in it.
        if (s !== 'All' && activeCat !== 'All') {
          activeCat = 'All';
          catRow.setActive(activeCat);
        }
        shown = CHUNK;
        for (const [sid, sc] of scriptChips) sc.setPressed(sid === activeScript);
        paint({ keepScroll: false });
      },
    });
    scriptChips.set(s, c);
    scriptRow.append(c);
  }

  const cards = opts.layout === 'cards';
  const list = el('div', {
    className: `vl-font-picker__list${cards ? ' vl-font-picker__list--cards' : ''}`,
    attrs: { role: 'listbox', 'aria-label': 'Fonts' },
  });
  /** Which font each rendered button stands for, so a new sample can re-check its glyphs. */
  const fontOf = new WeakMap<HTMLElement, FontPickerFont>();
  const sentinel = el('div', { className: 'vl-font-picker__sentinel' });
  let observer: IntersectionObserver | null = null;

  /** The font the picker opened on. Pinning follows THIS and not the live `value`:
   *  pinning the live value put the row you just clicked at the top of the list, so
   *  every other row shifted under the cursor the instant you chose one — pick a font
   *  near the bottom and the whole library moved. The order a person is reading stays
   *  put while they click along it; it re-pins next time the picker is built. */
  const pinned = opts.value;

  /** The opening font first (pinned), then the featured ids in their given order, then everything
   *  else that matches the search/category filter. */
  function computeOrder(): FontPickerFont[] {
    const q = query.trim().toLowerCase();
    const filtered = opts.fonts.filter((f) => {
      if (activeCat !== 'All' && f.category !== activeCat) return false;
      if (activeScript !== 'All' && !f.scripts?.includes(activeScript)) return false;
      if (!q) return true;
      return f.label.toLowerCase().includes(q) || f.id.toLowerCase().includes(q);
    });
    const byId = new Map(filtered.map((f) => [f.id, f]));
    const ordered: FontPickerFont[] = [];
    const seen = new Set<string>();
    const current = byId.get(pinned);
    if (current) {
      ordered.push(current);
      seen.add(current.id);
    }
    for (const id of opts.featured ?? []) {
      const f = byId.get(id);
      if (f && !seen.has(f.id)) {
        ordered.push(f);
        seen.add(f.id);
      }
    }
    for (const f of filtered) {
      if (!seen.has(f.id)) {
        ordered.push(f);
        seen.add(f.id);
      }
    }
    return ordered;
  }

  /** Mark a face that cannot set the sample, and unmark it once it can. */
  function markSupport(btn: HTMLElement, f: FontPickerFont) {
    const ok = opts.supports ? opts.supports(f, sample) : true;
    const warn = btn.querySelector(':scope > .vl-font-card__warn');
    if (!ok && !warn) btn.append(el('span', { className: 'vl-font-card__warn', text: '⚠', attrs: { 'aria-hidden': 'true' } }));
    else if (ok && warn) warn.remove();
    btn.title = ok ? f.label : `${f.label} (characters missing)`;
  }

  function row(f: FontPickerFont): HTMLButtonElement {
    const on = f.id === value;
    const sampleEl = el('span', { className: cards ? 'vl-font-card__sample' : 'vl-font-row__sample', text: sample });
    sampleEl.style.fontFamily = f.family;
    const parts: HTMLElement[] = cards
      ? [
          sampleEl,
          el('span', { className: 'vl-font-card__meta' }, [
            el('span', { className: 'vl-font-card__name', text: f.label }),
            ...(f.category ? [el('span', { className: 'vl-font-card__cat', text: f.category })] : []),
          ]),
        ]
      : [sampleEl, el('span', { className: 'vl-font-row__name', text: f.label })];
    const btn = el(
      'button',
      {
        className: cards ? `vl-font-card${on ? ' is-on' : ''}` : 'vl-font-row',
        attrs: { type: 'button', role: 'option', 'data-font-id': f.id, 'aria-pressed': String(on) },
      },
      parts,
    ) as HTMLButtonElement;
    fontOf.set(btn, f);
    markSupport(btn, f);
    btn.addEventListener('click', () => setValue(f.id, true));
    return btn;
  }

  const buttons = () => Array.from(list.querySelectorAll<HTMLButtonElement>('.vl-font-row, .vl-font-card'));

  function setupObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (!list.contains(sentinel)) return;
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          shown += CHUNK;
          paint();
        }
      },
      { root: list, rootMargin: '200px' },
    );
    observer.observe(sentinel);
  }

  function paint({ keepScroll = true } = {}) {
    // `replaceChildren` collapses the list's scrollHeight, and the browser clamps
    // scrollTop to 0 with it. Loading the next chunk therefore bounced the reader back
    // to the top of the library. A search or a category change SHOULD go to the top —
    // it is a different list — so those ask for it.
    const top = list.scrollTop;
    const order = computeOrder();
    list.replaceChildren();
    if (order.length === 0) {
      // With no search, it is the category and the alphabet together that came up empty.
      const empty = !query.trim() && activeScript !== 'All'
        ? `No ${activeCat === 'All' ? '' : `${activeCat} `}font covers ${activeScript}.`
        : `No font matches “${query.trim()}”.`;
      list.append(el('p', { className: 'vl-font-picker__empty', text: empty }));
      list.scrollTop = 0;
      setupObserver();
      return;
    }
    const page = order.slice(0, shown);
    // Headings only make sense over the unfiltered list — once a search or category has
    // narrowed things down, "Popular" vs "All fonts" no longer means anything.
    const showHeadings = !query.trim() && activeCat === 'All' && activeScript === 'All' && (opts.featured?.length ?? 0) > 0;
    const featuredSet = new Set(opts.featured ?? []);
    let printedPopular = false;
    let printedAll = false;
    for (const f of page) {
      if (showHeadings) {
        const isFeatured = f.id === pinned || featuredSet.has(f.id);
        if (isFeatured && !printedPopular) {
          list.append(el('div', { className: 'vl-font-picker__heading', text: opts.featuredLabel ?? 'Popular' }));
          printedPopular = true;
        } else if (!isFeatured && !printedAll) {
          list.append(el('div', { className: 'vl-font-picker__heading', text: 'All fonts' }));
          printedAll = true;
        }
      }
      list.append(row(f));
    }
    if (order.length > page.length) list.append(sentinel);
    list.scrollTop = keepScroll ? top : 0;
    setupObserver();
  }

  list.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    // Cards sit in a grid, so left and right move too; a list only goes up and down.
    const back = ke.key === 'ArrowUp' || (cards && ke.key === 'ArrowLeft');
    const fwd = ke.key === 'ArrowDown' || (cards && ke.key === 'ArrowRight');
    if (!back && !fwd) return;
    const all = buttons();
    const idx = all.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    ke.preventDefault();
    const next = fwd ? Math.min(idx + 1, all.length - 1) : Math.max(idx - 1, 0);
    all[next]?.focus();
  });

  function setValue(id: string, notify = false) {
    if (id !== value) {
      value = id;
      // In place, never repaint — the same reason `setSample` does it this way. A
      // repaint here destroyed the very button being clicked, took the focus ring
      // with it, and reset the scroll to the top of the list.
      for (const b of buttons()) {
        const on = b.dataset.fontId === value;
        b.setAttribute('aria-pressed', String(on));
        if (cards) b.classList.toggle('is-on', on);
      }
    }
    if (notify) opts.onChange(id);
  }

  const root = el('div', { className: 'vl-font-picker' }, [
    search,
    catRow,
    ...(scripts.length > 1 ? [scriptRow] : []),
    list,
  ]) as unknown as FontPickerHandle;
  root.setValue = setValue;
  root.setSample = (text: string) => {
    // Update in place, never repaint: a caller updates this on every keystroke of the user's
    // own name, and rebuilding the list would take the focus ring and scroll position with it —
    // the same reason `thumbTile.setText` exists instead of re-rendering the grid.
    sample = text || 'Aa';
    for (const s of list.querySelectorAll<HTMLElement>('.vl-font-row__sample, .vl-font-card__sample')) s.textContent = sample;
    // A face that could set the old word may lack a letter of the new one, and the other way round.
    for (const b of buttons()) {
      const f = fontOf.get(b);
      if (f) markSupport(b, f);
    }
  };
  root.getValue = () => value;
  paint();
  return root;
}
