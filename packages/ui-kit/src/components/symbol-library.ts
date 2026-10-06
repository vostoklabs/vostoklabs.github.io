import { el } from '../dom';
import { button } from './button';
import { dialog } from './dialog';
import { textField } from './elements';
import { uploadCta } from './sources';
import { toast } from './toast';

/*
  The "Add symbol" browser: a search box, an import button, categories down the left and a
  grid of drawings. On a wide screen with an anchor it opens as a dropdown under that button,
  so the text the symbol is going into stays in view; otherwise it is a centred dialog.

  It owns none of the symbols. `list` and `search` say what to show, `renderTile` draws each
  one (it may be async — tracing an SVG takes a moment), and `onPick` gets the entry back. The
  library closes before `onPick` runs, so focus is already home when the app inserts the
  symbol and opens whatever comes next.

  The dropdown is still a modal underneath: the page behind is inert while it is open, Escape
  and Cancel close it, and so does a press anywhere outside it.
*/

export interface SymbolLibraryEntry {
  id: string;
  label: string;
  /** Where it comes from, shown in the tile's tooltip: "Grinning face · Fluent Emoji". */
  source?: string;
}

export interface SymbolLibraryOptions {
  /** Default 'Symbols & icons'. */
  title?: string;
  /** The category list down the left, in order. */
  categories: { id: string; label: string }[];
  /** Which category opens. Default the first. */
  initialCategory?: string;
  /** The entries in one category. */
  list(category: string): SymbolLibraryEntry[];
  /** The entries matching a query (trimmed, as typed), across every category. */
  search(query: string): SymbolLibraryEntry[];
  /** One tile's drawing. Null or a throw leaves the tile out. */
  renderTile(entry: SymbolLibraryEntry): Promise<Element | null> | Element | null;
  /** The library has closed by the time this runs. A rejection is reported as a toast. */
  onPick(entry: SymbolLibraryEntry): void | Promise<void>;
  /** An "Import your own SVG" button beside the search. `onFile` gets the file and the
   *  library's `close`, to call before opening a window of its own. The library closes when
   *  `onFile` resolves, whatever it resolves to; a rejection is reported as a toast and leaves
   *  it open. */
  upload?: { label?: string; accept?: string; onFile(file: File, close: () => void): Promise<unknown> };
  /** The button that opened it. With one, on a screen wider than 760 px, the library opens
   *  as a dropdown under it rather than in the middle of the screen. */
  anchor?: HTMLElement;
}

export interface SymbolLibraryHandle {
  close(): void;
}

/** How many tiles a category or a search draws. Past that the count line asks for a search. */
const SHOWN = 120;
const DROPDOWN_WIDTH = 640;
const DROPDOWN_MIN_VIEWPORT = 760;
const EDGE = 12;

/** Open the symbol library. */
export function openSymbolLibrary(opts: SymbolLibraryOptions): SymbolLibraryHandle {
  let category = opts.initialCategory ?? opts.categories[0]?.id ?? '';
  let query = '';
  /* Bumped by every repaint and by closing. A tile whose drawing arrives after either belongs
     to a grid that is no longer there, and must not land in the one that replaced it. */
  let generation = 0;
  let closed = false;

  const grid = el('div', { className: 'vl-symbol-library__grid', attrs: { role: 'group', 'aria-label': 'Symbols' } });
  const count = el('p', { className: 'vl-hint vl-symbol-library__count', attrs: { 'aria-live': 'polite' } });
  const nav = el('nav', { className: 'vl-symbol-library__nav', attrs: { 'aria-label': 'Symbol categories' } });
  const search = textField({
    label: 'Search symbols',
    placeholder: 'Try paw, smile, heart…',
    value: '',
    onInput: (q) => {
      query = q;
      void paint();
    },
  });

  const categories = opts.categories.map((c) => {
    const b = button({
      label: c.label,
      emphasis: 'ghost',
      onClick: () => {
        // Picking a category is a request to browse it, so a leftover search must not keep
        // overriding the choice.
        category = c.id;
        query = '';
        search.setValue('');
        void paint();
      },
    });
    nav.append(b);
    return { id: c.id, b };
  });

  const close = () => {
    if (!closed) handle.close();
  };

  const upload = opts.upload;
  const uploadButton = upload
    ? uploadCta({
        label: upload.label ?? 'Import your own SVG',
        accept: upload.accept ?? '.svg,image/svg+xml',
        onFiles: async ([file]) => {
          if (!file) return;
          try {
            await upload.onFile(file, close);
            close();
          } catch (err) {
            // Left open, so another file or a symbol from the grid is one click away.
            toast(`Could not import ${file.name}: ${(err as Error).message}`, { kind: 'error' });
          }
        },
      })
    : null;

  const content = el('div', { className: 'vl-symbol-library' }, [
    el('div', { className: 'vl-symbol-library__search' }, [search, ...(uploadButton ? [uploadButton] : [])]),
    el('div', { className: 'vl-symbol-library__body' }, [
      nav,
      el('div', { className: 'vl-symbol-library__results' }, [count, grid]),
    ]),
  ]);

  let detach = () => {};
  const handle = dialog({
    title: opts.title ?? 'Symbols & icons',
    content,
    size: 'wide',
    actions: [{ label: 'Cancel' }],
    onClose: () => {
      closed = true;
      generation++;
      detach();
    },
  });

  const anchor = opts.anchor;
  if (anchor && window.innerWidth > DROPDOWN_MIN_VIEWPORT) {
    handle.root.classList.add('vl-symbol-library--dropdown');
    const box = handle.root.querySelector<HTMLElement>('[role="dialog"]')!;
    box.setAttribute('aria-modal', 'false');
    // Right edge under the anchor's right edge, just below it; kept on screen both ways.
    const position = () => {
      const r = anchor.getBoundingClientRect();
      const width = Math.min(DROPDOWN_WIDTH, window.innerWidth - 2 * EDGE);
      box.style.width = `${width}px`;
      const height = box.getBoundingClientRect().height;
      box.style.left = `${Math.max(EDGE, Math.min(r.right - width, window.innerWidth - width - EDGE))}px`;
      box.style.top = `${Math.max(EDGE, Math.min(r.bottom + 8, window.innerHeight - height - EDGE))}px`;
    };
    position();
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.contains(target) && !anchor.contains(target)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', position);
    detach = () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', position);
    };
  }
  search.field.focus();

  const pick = (entry: SymbolLibraryEntry) => {
    if (closed) return;
    close();
    Promise.resolve()
      .then(() => opts.onPick(entry))
      .catch(() => toast('Could not load this symbol.', { kind: 'error' }));
  };

  async function paint() {
    const mine = ++generation;
    for (const { id, b } of categories) b.setAttribute('aria-pressed', String(id === category));
    const q = query.trim();
    const entries = q ? opts.search(q) : opts.list(category);
    grid.replaceChildren();
    const n = entries.length;
    count.textContent = n
      ? `${n} symbol${n === 1 ? '' : 's'}${n > SHOWN ? ` · showing first ${SHOWN}, search to narrow` : ''}`
      : `No symbols found. Try another name${upload ? ' or import an SVG' : ''}.`;
    for (const entry of entries.slice(0, SHOWN)) {
      const tile = button({
        label: '',
        emphasis: 'ghost',
        title: entry.source ? `${entry.label} · ${entry.source}` : entry.label,
        className: 'vl-symbol-library__tile',
        onClick: () => pick(entry),
      });
      tile.setAttribute('aria-label', entry.label);
      grid.append(tile);
      let art: Element | null = null;
      try {
        art = await opts.renderTile(entry);
      } catch {
        art = null;
      }
      if (mine !== generation) return;
      if (art) tile.append(art);
      else tile.remove();
    }
  }
  void paint();

  return { close };
}
