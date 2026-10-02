import { el } from '../dom';
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
}

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
}

export type FontPickerHandle = HTMLElement & {
  setValue(id: string, notify?: boolean): void;
  setSample(text: string): void;
  getValue(): string;
};

/** Rows rendered per page, more added as the sentinel at the bottom scrolls into view. A flat
 *  list of ~150 webfont rows costs real layout time up front; most of it is below the fold. */
const CHUNK = 40;

export function fontPicker(opts: FontPickerOptions): FontPickerHandle {
  let value = opts.value;
  let sample = opts.sample || 'Aa';
  let query = '';
  let activeCat = 'All';
  let shown = CHUNK;

  const categories = Array.from(
    new Set(opts.fonts.map((f) => f.category).filter((c): c is string => !!c)),
  ).sort();

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

  const catRow = el('div', { className: 'vl-font-picker__cats', attrs: { role: 'group', 'aria-label': 'Font category' } });
  const catChips = new Map<string, ReturnType<typeof chip>>();
  function addCatChip(id: string, label: string) {
    const c = chip({
      label,
      pressed: id === activeCat,
      onToggle: () => {
        activeCat = id;
        shown = CHUNK;
        for (const [cid, cc] of catChips) cc.setPressed(cid === activeCat);
        paint({ keepScroll: false });
      },
    });
    catChips.set(id, c);
    catRow.append(c);
  }
  addCatChip('All', 'All');
  for (const c of categories) addCatChip(c, c);

  const list = el('div', {
    className: 'vl-font-picker__list',
    attrs: { role: 'listbox', 'aria-label': 'Fonts' },
  });
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

  function row(f: FontPickerFont): HTMLButtonElement {
    const sampleEl = el('span', { className: 'vl-font-row__sample', text: sample });
    sampleEl.style.fontFamily = f.family;
    const btn = el(
      'button',
      { className: 'vl-font-row', attrs: { type: 'button', role: 'option', title: f.label, 'data-font-id': f.id, 'aria-pressed': String(f.id === value) } },
      [sampleEl, el('span', { className: 'vl-font-row__name', text: f.label })],
    ) as HTMLButtonElement;
    btn.addEventListener('click', () => setValue(f.id, true));
    return btn;
  }

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
      list.append(el('p', { className: 'vl-font-picker__empty', text: `No font matches “${query.trim()}”.` }));
      list.scrollTop = 0;
      setupObserver();
      return;
    }
    const page = order.slice(0, shown);
    // Headings only make sense over the unfiltered list — once a search or category has
    // narrowed things down, "Popular" vs "All fonts" no longer means anything.
    const showHeadings = !query.trim() && activeCat === 'All' && (opts.featured?.length ?? 0) > 0;
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
    if (ke.key !== 'ArrowDown' && ke.key !== 'ArrowUp') return;
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('.vl-font-row'));
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    ke.preventDefault();
    const next = ke.key === 'ArrowDown' ? Math.min(idx + 1, buttons.length - 1) : Math.max(idx - 1, 0);
    buttons[next]?.focus();
  });

  function setValue(id: string, notify = false) {
    if (id !== value) {
      value = id;
      // In place, never repaint — the same reason `setSample` does it this way. A
      // repaint here destroyed the very button being clicked, took the focus ring
      // with it, and reset the scroll to the top of the list.
      for (const b of list.querySelectorAll<HTMLElement>('.vl-font-row')) {
        b.setAttribute('aria-pressed', String(b.dataset.fontId === value));
      }
    }
    if (notify) opts.onChange(id);
  }

  const root = el('div', { className: 'vl-font-picker' }, [search, catRow, list]) as unknown as FontPickerHandle;
  root.setValue = setValue;
  root.setSample = (text: string) => {
    // Update in place, never repaint: a caller updates this on every keystroke of the user's
    // own name, and rebuilding the list would take the focus ring and scroll position with it —
    // the same reason `thumbTile.setText` exists instead of re-rendering the grid.
    sample = text || 'Aa';
    for (const s of list.querySelectorAll<HTMLElement>('.vl-font-row__sample')) s.textContent = sample;
  };
  root.getValue = () => value;
  paint();
  return root;
}
