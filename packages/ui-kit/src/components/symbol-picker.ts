import { el } from '../dom';
import { dialog, type DialogHandle } from './dialog';
import { drawer } from './drawer';

/*
  A browser for a large set of single-glyph symbols.

  It takes its data rather than importing it, so the kit stays free of a font
  dependency: `@vostok/fonts` owns the 1392-glyph Font Awesome registry, and this
  owns what a person does with it. Any other glyph set with the same three fields
  works here unchanged.

  The list is rendered in pages. A flat grid of 1392 buttons costs about a second of
  layout on a phone and drops every one of them into the accessibility tree, which is
  a worse experience than the sixty hardcoded ones it replaces.
*/

export interface SymbolItem {
  id: string;
  label: string;
  /** The character to insert. */
  char: string;
  /** Category ids; used for the filter chips. */
  cats?: string[];
}

export interface SymbolCategory {
  id: string;
  label: string;
  count?: number;
}

export interface SymbolPickerOptions {
  items: SymbolItem[];
  categories?: SymbolCategory[];
  /** CSS font-family the glyphs render in. */
  fontFamily: string;
  /** Ranked search. Falls back to a plain label/id substring match. */
  search?: (query: string, cat?: string) => SymbolItem[];
  onPick: (item: SymbolItem) => void;
  onClose?: () => void;
  title?: string;
  /** Shown above the grid before the user types. */
  hint?: string;
  /** Keep the dialog open after a pick, so several symbols can go in at once. */
  stayOpen?: boolean;
  /**
   * Which category to open on. Without it the picker opens on "All", and for a
   * large set sorted by id that means the first screen is whatever sorts first —
   * which for Font Awesome is the digits. Open on the good stuff.
   */
  defaultCategory?: string;
  /**
   * 'drawer' (default) opens at the edge of the screen with nothing dimmed, so
   * whatever the symbol is going ON stays visible and keeps updating as you click
   * through the grid. 'modal' is the old centred dialog.
   */
  placement?: 'drawer' | 'modal';
}

const PAGE = 240;

export function openSymbolPicker(opts: SymbolPickerOptions): DialogHandle {
  const categories = opts.categories ?? [];
  const searchFn =
    opts.search ??
    ((q: string, cat?: string) => {
      const pool = cat ? opts.items.filter((i) => i.cats?.includes(cat)) : opts.items;
      const needle = q.trim().toLowerCase();
      if (!needle) return pool;
      return pool.filter((i) => i.label.toLowerCase().includes(needle) || i.id.includes(needle));
    });

  let query = '';
  let cat: string | undefined = opts.defaultCategory;
  let shown = PAGE;
  let matches: SymbolItem[] = opts.items;

  const searchInput = el('input', {
    className: 'vl-sym__search',
    attrs: {
      type: 'search',
      placeholder: `Search ${opts.items.length} symbols…`,
      'aria-label': 'Search symbols',
    },
  }) as HTMLInputElement;

  const grid = el('div', { className: 'vl-sym__grid' });
  const count = el('p', { className: 'vl-sym__count' });
  const more = el('button', {
    className: 'vl-btn vl-btn--secondary vl-sym__more',
    text: 'Show more',
    attrs: { type: 'button' },
  });
  more.addEventListener('click', () => {
    shown += PAGE;
    paint();
  });

  function tile(item: SymbolItem): HTMLButtonElement {
    const btn = el('button', {
      className: 'vl-sym__tile',
      attrs: { type: 'button', title: item.label, 'aria-label': item.label },
    }, [
      el('span', { className: 'vl-sym__glyph', text: item.char, attrs: { style: `font-family: ${opts.fontFamily}` } }),
      el('span', { className: 'vl-sym__name', text: item.label }),
    ]) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      opts.onPick(item);
      if (!opts.stayOpen) handle.close();
    });
    return btn;
  }

  function paint() {
    grid.replaceChildren();
    const page = matches.slice(0, shown);
    for (const item of page) grid.append(tile(item));

    if (matches.length === 0) {
      grid.append(el('p', { className: 'vl-sym__empty', text: `No symbol matches “${query.trim()}”.` }));
      count.textContent = '';
      more.classList.add('hidden');
      return;
    }
    count.textContent =
      matches.length > page.length
        ? `Showing ${page.length} of ${matches.length}`
        : `${matches.length} symbol${matches.length === 1 ? '' : 's'}`;
    more.classList.toggle('hidden', matches.length <= page.length);
  }

  function refilter() {
    matches = searchFn(query, cat);
    shown = PAGE;
    paint();
  }

  /*
    Categories as a dropdown, not a row of chips.

    Chips look friendlier and are wrong here: fourteen of them do not fit across a
    400 px panel, so they either wrap to four rows and eat the grid, or scroll — and
    a category list you have to scroll to read is a category list that hides half its
    options behind a gesture nobody knows is available. A select shows all fourteen
    on one tap and costs one row.
  */
  const catSelect = el('select', {
    className: 'vl-sym__cats',
    attrs: { 'aria-label': 'Symbol category' },
  }) as HTMLSelectElement;
  for (const c of categories) {
    const opt = el('option', { text: c.count ? `${c.label} (${c.count})` : c.label, attrs: { value: c.id } });
    if (c.id === cat) (opt as HTMLOptionElement).selected = true;
    catSelect.append(opt);
  }
  catSelect.addEventListener('change', () => {
    cat = catSelect.value;
    // Picking a category is a request to browse it, so a stale search term must not
    // keep overriding the choice.
    query = '';
    searchInput.value = '';
    refilter();
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    refilter();
  });

  const asDrawer = (opts.placement ?? 'drawer') === 'drawer';

  const content = el('div', { className: `vl-sym${asDrawer ? ' vl-sym--drawer' : ''}` }, [
    searchInput,
    ...(categories.length ? [catSelect] : []),
    count,
    grid,
    more,
    ...(opts.hint ? [el('p', { className: 'vl-sym__hint', text: opts.hint })] : []),
  ]);

  const title = opts.title ?? 'Insert a symbol';
  const handle = asDrawer
    ? drawer({ title, content, onClose: opts.onClose })
    : dialog({ title, content, wide: true, onClose: opts.onClose });
  refilter();
  searchInput.focus();
  return handle;
}

/** The button that opens the picker. */
export function symbolPickerButton(
  opts: SymbolPickerOptions & { label?: string; className?: string },
): HTMLButtonElement {
  const btn = el('button', {
    className: opts.className ?? 'vl-btn vl-btn--secondary',
    text: opts.label ?? 'Insert symbol',
    attrs: { type: 'button' },
  }) as HTMLButtonElement;
  btn.addEventListener('click', () => openSymbolPicker(opts));
  return btn;
}
