// Input-side patterns every generator repeats: pick a source, drop a file,
// pick a sample. Each one owns its markup so the styling and alignment are the
// same in every generator instead of being re-derived per app.
import { el } from '../dom';
import { svgEl, svgPathEl } from '../icons';

// ---------------------------------------------------------------- sources --

export interface SourceOption<T extends string = string> {
  value: T;
  label: string;
  /** Inline SVG markup, e.g. `ICONS.upload`. Optional. */
  icon?: string;
}

export interface SourceCardsOptions<T extends string = string> {
  options: SourceOption<T>[];
  /** Which card starts active. Omit for none. */
  value?: T;
  onChange: (value: T) => void;
}

export interface SourceCards<T extends string = string> {
  root: HTMLElement;
  /** Reflect a choice made elsewhere. Does not fire `onChange`. */
  setValue(value: T | null): void;
}

/** The row of "Image / SVG / Text" cards at the top of an input panel. */
export function sourceCards<T extends string = string>(opts: SourceCardsOptions<T>): SourceCards<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const root = el('div', { className: 'vl-source-grid', attrs: { role: 'group' } });

  for (const o of opts.options) {
    const card = el('button', {
      className: 'vl-source-card',
      attrs: { type: 'button', 'aria-pressed': 'false' },
      on: { click: () => { setValue(o.value); opts.onChange(o.value); } },
    }) as HTMLButtonElement;
    if (o.icon) card.append(el('span', { className: 'vl-source-card__icon' }, [svgEl(o.icon)]));
    card.append(el('span', { className: 'vl-source-card__label', text: o.label }));
    buttons.set(o.value, card);
    root.append(card);
  }

  function setValue(value: T | null) {
    for (const [v, b] of buttons) {
      const on = v === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  if (opts.value !== undefined) setValue(opts.value);

  return { root, setValue };
}

// --------------------------------------------------------------- dropzone --

export interface DropZoneOptions {
  /** Big line, e.g. "Drop an image". */
  title: string;
  /** Second line, e.g. "or click to browse". */
  text?: string;
  /** Small print, e.g. "PNG, JPG or SVG". */
  note?: string;
  /** `accept` for the hidden file input, e.g. `'image/*'`. */
  accept?: string;
  multiple?: boolean;
  /** Inline SVG for the big icon; defaults to an upload arrow. */
  icon?: string;
  onFiles: (files: File[]) => void;
}

const UPLOAD_ICON =
  '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v13"/></svg>';

/** Click-or-drag file target. Handles the drag styling and the hidden input. */
export function dropZone(opts: DropZoneOptions): HTMLElement {
  const input = el('input', {
    attrs: { type: 'file', ...(opts.accept ? { accept: opts.accept } : {}), ...(opts.multiple ? { multiple: '' } : {}) },
  }) as HTMLInputElement;

  const root = el('div', {
    className: 'vl-drop',
    attrs: { role: 'button', tabindex: '0' },
  });
  root.append(el('div', { className: 'vl-drop__icon' }, [svgEl(opts.icon ?? UPLOAD_ICON)]));
  root.append(el('div', { className: 'vl-drop__title', text: opts.title }));
  if (opts.text) root.append(el('div', { className: 'vl-drop__text', text: opts.text }));
  if (opts.note) root.append(el('span', { className: 'vl-drop__note', text: opts.note }));
  root.append(input);

  const emit = (files: FileList | null) => {
    const list = files ? [...files] : [];
    if (list.length) opts.onFiles(opts.multiple ? list : list.slice(0, 1));
  };

  root.addEventListener('click', () => input.click());
  root.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    emit(input.value ? input.files : null);
    // Reset so picking the same file twice in a row still fires.
    input.value = '';
  });
  // dragover must be cancelled or the browser navigates to the dropped file.
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.classList.add('is-over');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-over'));
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('is-over');
    emit((e as DragEvent).dataTransfer?.files ?? null);
  });

  return root;
}

export interface UploadCtaOptions {
  label: string;
  accept?: string;
  multiple?: boolean;
  icon?: string;
  onFiles: (files: File[]) => void;
}

/** The slim "replace this file" row shown once something is already loaded. */
export function uploadCta(opts: UploadCtaOptions): HTMLElement {
  const input = el('input', {
    attrs: { type: 'file', ...(opts.accept ? { accept: opts.accept } : {}), ...(opts.multiple ? { multiple: '' } : {}) },
  }) as HTMLInputElement;
  const root = el('label', { className: 'vl-upload-cta' });
  if (opts.icon) root.append(svgEl(opts.icon));
  root.append(el('span', { text: opts.label }), input);
  input.addEventListener('change', () => {
    if (input.files?.length) opts.onFiles([...input.files]);
    input.value = '';
  });
  return root;
}

// ---------------------------------------------------------------- samples --

export interface SampleItem {
  /** Thumbnail URL — an import, a data URI, anything an <img> takes. */
  src: string;
  label: string;
  /** Passed back on pick; use it to load the full-size asset. */
  id?: string;
}

export interface SampleGridOptions {
  /** Optional heading above the grid, e.g. "Or try a sample". */
  heading?: string;
  items: SampleItem[];
  onPick: (item: SampleItem, index: number) => void;
}

export type SampleGridHandle = HTMLDivElement & {
  /** Mark one tile (by its `SampleItem.id`) as the loaded one, or clear the mark with null.
   *  Only items given an `id` can be marked — a grid whose items have none simply has nothing
   *  for this to select, the same opt-in `thumbTile()` uses for `aria-pressed`. */
  setSelected(id: string | null): void;
};

export interface ThumbTileOptions {
  /** Thumbnail URL — an import, a data URI, a blob URL. Omit when `svgPath` is given. */
  src?: string;
  /**
   * An SVG path `d` in a 40x40 box, drawn INSTEAD of an image.
   *
   * A path rather than a data-URI image, for the same reason the symbol picker's tiles are:
   * it inherits `currentColor`, so a generated silhouette follows the theme instead of being
   * a fixed-colour bitmap that goes invisible in dark mode. The clicker's base shapes have no
   * image files at all — they are ring generators — so `src` cannot express them.
   */
  svgPath?: string;
  /** The tile's whole accessible name; also its tooltip. */
  label: string;
  /** Renders as the current choice, and reports it as `aria-pressed`. */
  selected?: boolean;
  /** Extra class for placement or app-specific sizing. Never a restyle. */
  className?: string;
  onClick?: (tile: ThumbTileHandle) => void;
}

export type ThumbTileHandle = HTMLButtonElement & { setSelected(on: boolean): void };

/**
 * One focusable image tile.
 *
 * `sampleGrid` above builds a fixed handful of these from a list. A gallery cannot: the clicker
 * renders ~1,500 Lucide icons, adds uploaded SVGs one at a time, and filters them as you type,
 * so it needs the tile without the grid around it. Lacking one, it hand-rolled a `<div class=
 * "icon">` with a click listener — which is not focusable, announces as nothing, and does not
 * respond to Enter or Space. About fifteen hundred of them, and they were the only route to the
 * icon library.
 *
 * Lazy loading here, unlike `sampleGrid`: a gallery is long and most of it is below the fold.
 */
export function thumbTile(opts: ThumbTileOptions): ThumbTileHandle {
  const btn = el('button', {
    className: `vl-thumb${opts.className ? ` ${opts.className}` : ''}`,
    attrs: { type: 'button', title: opts.label, 'aria-label': opts.label },
  }) as ThumbTileHandle;
  // `aria-pressed` ONLY when the caller is using selection. Setting it unconditionally would
  // turn every tile into a toggle button as far as a screen reader is concerned — including
  // the clicker's 1,500-icon gallery, where each tile inserts a symbol and none of them are
  // "pressed". A tile that reports a state it does not have is worse than one that reports
  // nothing.
  if (opts.selected !== undefined) btn.setAttribute('aria-pressed', String(opts.selected));
  if (opts.svgPath) btn.append(svgPathEl(opts.svgPath));
  else if (opts.src) {
    btn.append(el('img', { attrs: { src: opts.src, alt: '', decoding: 'async', loading: 'lazy' } }));
  }
  // `aria-pressed` is both the announcement and what the stylesheet keys the chosen look off,
  // so the two cannot disagree — the same arrangement `chip()` uses.
  btn.setSelected = (on) => btn.setAttribute('aria-pressed', String(on));
  if (opts.onClick) btn.addEventListener('click', () => opts.onClick!(btn));
  return btn;
}

export interface ThumbGridOptions {
  /** Optional heading above the grid. */
  heading?: string;
  tiles: HTMLElement[];
  /** Smallest tile width before the grid drops a column, in px. Default 64. */
  minPx?: number;
}

/**
 * A grid of `thumbTile`s.
 *
 * `.vl-thumb` carries the button reset and the focus ring and nothing else, on purpose —
 * a 1,500-item icon gallery and a six-item sample row want different sizes. That left the
 * GRID to every caller, and by the third one (the clicker's icon gallery, its shape
 * editor's rail, and now its base-shape picker) the three had drifted into three different
 * column counts, paddings and hover treatments for the same picture-in-a-box.
 *
 * So the grid is here and the size is a number, not a class: `minPx` moves the column
 * count without anybody writing a new rule. The tile look — square, bordered, filled on
 * hover — comes with it, scoped to children of the grid so the bare `thumbTile` callers
 * that predate this are untouched.
 */
export function thumbGrid(opts: ThumbGridOptions): HTMLElement {
  const wrap = el('div');
  if (opts.heading) wrap.append(el('span', { className: 'vl-samples__heading', text: opts.heading }));
  const grid = el('div', { className: 'vl-thumb-grid' }, opts.tiles);
  if (opts.minPx) grid.style.setProperty('--thumb-min', `${opts.minPx}px`);
  wrap.append(grid);
  return wrap;
}

/** Square sample thumbnails. Returns a fragment holder, heading included. */
export function sampleGrid(opts: SampleGridOptions): SampleGridHandle {
  const wrap = el('div') as SampleGridHandle;
  if (opts.heading) wrap.append(el('span', { className: 'vl-samples__heading', text: opts.heading }));
  const grid = el('div', { className: 'vl-samples' });
  // Keyed by id rather than index: items across several grids (one per pack, plus the
  // bundled-sample grid) share nothing but their ids, and `setSelected` is called once with
  // whatever is loaded — each grid has to work out on its own whether that is one of its tiles.
  const byId = new Map<string, HTMLElement>();
  opts.items.forEach((item, i) => {
    const btn = el('button', {
      className: 'vl-sample',
      attrs: {
        type: 'button',
        title: item.label,
        // `aria-pressed` ONLY when the item carries an id — see `thumbTile`'s own version of
        // this guard. An id-less tile has no state `setSelected` could ever put it in, so
        // announcing "not pressed" forever would be reporting a fact that does not apply.
        ...(item.id !== undefined ? { 'aria-pressed': 'false' } : {}),
      },
      on: { click: () => opts.onPick(item, i) },
    });
    // Not lazy: a sample grid is a handful of small thumbnails sitting at the
    // top of a panel, and lazy ones stay blank until the panel is scrolled.
    const img = el('img', { attrs: { src: item.src, alt: item.label, decoding: 'async' } });
    btn.append(img, el('span', { text: item.label }));
    grid.append(btn);
    if (item.id !== undefined) byId.set(item.id, btn);
  });
  wrap.append(grid);
  wrap.setSelected = (id) => {
    for (const [itemId, btn] of byId) btn.setAttribute('aria-pressed', String(itemId === id));
  };
  return wrap;
}
