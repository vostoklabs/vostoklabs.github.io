import { el } from '../dom';
import { svgEl } from '../icons';
import { panel, type PanelOptions } from './app-shell';

/* The editor frame — the second house layout, beside `appShell()`.

   A generator is settings | stage | inputs: one model, a few parameters, a 3D preview. An
   editor is a different animal: a canvas you compose ON, studios you switch BETWEEN, a sheet
   of material to fit INTO. Faking that inside the three-column grid grows a fourth column
   by hand, and a hand-grown column is how `.vl-btn` got its 163 impostors. So the frame is a
   kit component, paired with editor-shell.css, and an app fills the slots.

     suiteBar       one row: title · the suite tabs · the design's name · actions
     designShell    the page: suite bar over a body that swaps, over a status bar
     designBody     the canvas view: context bar over rail | panel | canvas | objects
     studioView     a studio: the generator's settings | stage | output, without its topbar
     toolRail       the vertical switcher (Bambu's rail)
     floatingPanel  the selected object's own controls, at the canvas edge
     popover        content anchored to a control (the Sheet dropdown, a distance slider)

   The dock-shaped panels reuse `.vl-panel`, so every section, control and footer inside
   them is exactly what a generator gets. */

// ------------------------------------------------------------------ suite bar --

export interface SuiteTab<T extends string = string> {
  value: T;
  label: string;
}

export interface SuiteBarOptions<T extends string = string> {
  /** The product name, in the display face, at the leading edge. */
  title: string;
  tabs: SuiteTab<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The document's name, editable on click. */
  name: string;
  onRename?: (name: string) => void;
  /** Trailing controls: undo/redo, the sheet button, export, an overflow menu. */
  trailing?: HTMLElement[];
}

export interface SuiteBar<T extends string = string> {
  root: HTMLElement;
  setValue(value: T): void;
  setName(name: string): void;
  /** Small print beside the name — "Saved", "Editing plate on the design". */
  setNote(text: string): void;
}

/** The one top row. Tabs are deliberately large: they are the product's sections. */
export function suiteBar<T extends string = string>(opts: SuiteBarOptions<T>): SuiteBar<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const tabs = el('div', { className: 'vl-suite-tabs', attrs: { role: 'tablist' } });
  for (const t of opts.tabs) {
    const b = el('button', {
      className: 'vl-suite-tab',
      attrs: { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': t.value },
      text: t.label,
      on: {
        click: () => {
          setValue(t.value);
          opts.onChange(t.value);
        },
      },
    }) as HTMLButtonElement;
    buttons.set(t.value, b);
    tabs.append(b);
  }

  const nameBtn = el('button', {
    className: 'vl-suite-name',
    attrs: { type: 'button', title: 'Rename' },
    text: opts.name,
    on: {
      click: () => {
        if (!opts.onRename) return;
        const next = window.prompt('Design name', nameBtn.textContent ?? '');
        if (next && next.trim()) {
          nameBtn.textContent = next.trim();
          opts.onRename(next.trim());
        }
      },
    },
  });
  const note = el('span', { className: 'vl-suite-note' });

  const root = el('header', { className: 'vl-suitebar' }, [
    el('span', { className: 'vl-suite-title', text: opts.title }),
    tabs,
    el('div', { className: 'vl-suite-centre' }, [nameBtn, note]),
    el('div', { className: 'vl-suite-actions' }, opts.trailing ?? []),
  ]);

  function setValue(value: T) {
    for (const [v, b] of buttons) {
      const on = v === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    }
  }
  setValue(opts.value);

  return {
    root,
    setValue,
    setName: (n) => {
      nameBtn.textContent = n;
    },
    setNote: (t) => {
      note.textContent = t;
    },
  };
}

// --------------------------------------------------------------- design shell --

export interface DesignShellOptions {
  topbar: HTMLElement;
  statusbar?: HTMLElement;
}

export interface DesignShell {
  root: HTMLElement;
  /** Swap the whole body: the Design view, or a studio. */
  setBody(node: HTMLElement): void;
}

export function designShell(opts: DesignShellOptions): DesignShell {
  const body = el('div', { className: 'vl-editor__body' });
  const root = el('main', { className: 'vl-editor' }, [opts.topbar, body]);
  if (opts.statusbar) root.append(opts.statusbar);
  return {
    root,
    setBody(node) {
      body.replaceChildren(node);
    },
  };
}

// ---------------------------------------------------------------- design body --

export interface DesignBodyOptions {
  contextbar: HTMLElement;
  rail: HTMLElement;
  /** The workspace and its overlays. The 2D surface mounts into the returned `canvas`. */
  canvas?: (HTMLElement | Node)[];
  /** The Objects column. */
  objects: PanelOptions;
}

export interface DesignBody {
  root: HTMLElement;
  canvas: HTMLElement;
  objectsScroll: HTMLElement;
  /** Show a panel beside the rail (the Library), or close it with null. */
  setPanel(node: HTMLElement | null): void;
  /** Show a panel between the canvas and Objects (the selection's Properties), or close it.
   *  A slot of its own, so it never pushes the Objects list down. */
  setRightPanel(node: HTMLElement | null): void;
}

export function designBody(opts: DesignBodyOptions): DesignBody {
  const slot = el('div', { className: 'vl-design__panel vl-design__panel--closed' });
  const right = el('div', { className: 'vl-design__panel vl-design__panel--right vl-design__panel--closed' });
  const canvas = el('section', { className: 'vl-canvas' }, opts.canvas ?? []);
  const objects = panel('right', opts.objects);
  objects.panel.classList.add('vl-panel--objects');
  const root = el('div', { className: 'vl-design' }, [opts.contextbar, opts.rail, slot, canvas, right, objects.panel]);
  const fill = (host: HTMLElement, node: HTMLElement | null) => {
    host.replaceChildren(...(node ? [node] : []));
    // A class, not `hidden`: the kit hides `[hidden]` with !important, and a closed slot has
    // to stay in the grid at zero width or the canvas slides into its column.
    host.classList.toggle('vl-design__panel--closed', !node);
  };
  return {
    root,
    canvas,
    objectsScroll: objects.scroll,
    setPanel: (node) => fill(slot, node),
    setRightPanel: (node) => fill(right, node),
  };
}

// ---------------------------------------------------------------- studio view --

export interface StudioViewOptions {
  left: PanelOptions;
  stage?: (HTMLElement | Node)[];
  right: PanelOptions;
}

export interface StudioView {
  root: HTMLElement;
  stage: HTMLElement;
  leftScroll: HTMLElement;
  rightScroll: HTMLElement;
}

/** A generator's three columns, without its topbar — the suite bar is above already. */
export function studioView(opts: StudioViewOptions): StudioView {
  const left = panel('left', opts.left);
  const right = panel('right', opts.right);
  const stage = el('section', { className: 'vl-stage' }, opts.stage ?? []);
  const root = el('div', { className: 'vl-studio' }, [left.panel, stage, right.panel]);
  return { root, stage, leftScroll: left.scroll, rightScroll: right.scroll };
}

// ------------------------------------------------------------------ tool rail --

export interface ToolRailItem<T extends string = string> {
  value: T;
  /** Short — it sits under a 20 px icon in a 64 px column. One word. */
  label: string;
  /** Inline SVG markup, a member of `ICONS`. */
  icon: string;
  /** Native tooltip. Defaults to the label. */
  title?: string;
  /** A hairline above this item — the rail's groups. */
  divider?: boolean;
}

export interface ToolRailOptions<T extends string = string> {
  items: ToolRailItem<T>[];
  /** The pressed item, or null when the rail is a row of actions rather than a switcher. */
  value: T | null;
  onChange: (value: T) => void;
  /** Items pinned to the far end of the rail (settings, help). */
  trailing?: ToolRailItem<T>[];
}

export interface ToolRail<T extends string = string> {
  root: HTMLElement;
  /** Reflect a choice made elsewhere, or clear the pressed state with null. Does not fire `onChange`. */
  setValue(value: T | null): void;
  /** The button for an item — a menu or a popover anchors to it. */
  button(value: T): HTMLButtonElement | undefined;
}

/** The vertical rail: icon over a one-word label. Bambu's Image · Library · Shape · Text ·
 *  QR is the shape; what an item does is the app's business — a panel, a flyout, a studio. */
export function toolRail<T extends string = string>(opts: ToolRailOptions<T>): ToolRail<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const root = el('nav', { className: 'vl-tool-rail', attrs: { 'aria-label': 'Tools' } });

  const make = (item: ToolRailItem<T>) => {
    if (item.divider) root.append(el('span', { className: 'vl-tool-rail__rule', attrs: { 'aria-hidden': 'true' } }));
    const b = el('button', {
      className: 'vl-tool-rail__btn',
      attrs: { type: 'button', 'aria-pressed': 'false', title: item.title ?? item.label, 'data-tool': item.value },
      on: { click: () => opts.onChange(item.value) },
    }) as HTMLButtonElement;
    b.append(svgEl(item.icon), el('span', { className: 'vl-tool-rail__label', text: item.label }));
    buttons.set(item.value, b);
    return b;
  };

  for (const item of opts.items) root.append(make(item));
  if (opts.trailing?.length) {
    root.append(el('span', { className: 'vl-tool-rail__gap', attrs: { 'aria-hidden': 'true' } }));
    for (const item of opts.trailing) root.append(make(item));
  }

  function setValue(value: T | null) {
    for (const [v, b] of buttons) {
      const on = v === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  setValue(opts.value);
  return { root, setValue, button: (v) => buttons.get(v) };
}

// -------------------------------------------------------------------- toolbar --

export interface ToolbarOptions {
  /** Shown at the leading edge in the display face. */
  title?: string;
  /** Groups of controls, separated by a hairline. An empty group is skipped. */
  groups: HTMLElement[][];
  /** Pinned to the trailing edge. */
  trailing?: HTMLElement[];
  /** `context`: the quieter second row that describes a selection. */
  variant?: 'context';
}

export interface ToolbarHandle {
  root: HTMLElement;
  /** Replace every group — the context bar does this on every selection change. */
  setGroups(groups: HTMLElement[][], trailing?: HTMLElement[]): void;
}

/** A row of controls. */
export function toolbar(opts: ToolbarOptions): ToolbarHandle {
  const root = el('div', { className: `vl-toolbar${opts.variant ? ` vl-toolbar--${opts.variant}` : ''}`, attrs: { role: 'toolbar' } });
  const fill = (groups: HTMLElement[][], trailing?: HTMLElement[]) => {
    root.replaceChildren();
    if (opts.title) root.append(el('span', { className: 'vl-toolbar__title', text: opts.title }));
    let first = true;
    for (const group of groups) {
      if (group.length === 0) continue;
      if (!first) root.append(el('span', { className: 'vl-toolbar__sep', attrs: { 'aria-hidden': 'true' } }));
      first = false;
      root.append(el('div', { className: 'vl-toolbar__group' }, group));
    }
    if (trailing?.length) {
      root.append(el('span', { className: 'vl-toolbar__spacer' }));
      root.append(el('div', { className: 'vl-toolbar__group' }, trailing));
    }
  };
  fill(opts.groups, opts.trailing);
  return { root, setGroups: fill };
}

// ------------------------------------------------------------------ statusbar --

export interface StatusBarOptions {
  /** Item ids in display order. `'spacer'` pushes what follows to the right. */
  items: string[];
}

export interface StatusBar {
  root: HTMLElement;
  /** Set an item's text. A `<b>` in `html` renders in the text colour, for the value. */
  set(id: string, html: string): void;
}

/** The strip along the bottom: zoom, cursor, sheet, selection. Mono, muted, one line. */
export function statusBar(opts: StatusBarOptions): StatusBar {
  const root = el('footer', { className: 'vl-statusbar' });
  const items = new Map<string, HTMLElement>();
  for (const id of opts.items) {
    if (id === 'spacer') {
      root.append(el('span', { className: 'vl-statusbar__spacer' }));
      continue;
    }
    const item = el('span', { className: 'vl-statusbar__item', attrs: { 'data-status': id } });
    items.set(id, item);
    root.append(item);
  }
  return {
    root,
    set(id, html) {
      const item = items.get(id);
      if (item) item.innerHTML = html;
    },
  };
}

// ------------------------------------------------------------- floating panel --

export interface FloatingPanelOptions {
  title: string;
  /** Muted text beside the title — a file name, a size. */
  subtitle?: string;
  body: (HTMLElement | Node)[];
  onClose?: () => void;
}

export interface FloatingPanel {
  root: HTMLElement;
  setSubtitle(text: string): void;
}

/** Bambu Suite's Image panel, generalised: the selected object's own controls, floating at
 *  the canvas edge. Append it INSIDE `.vl-canvas`; it positions itself. */
export function floatingPanel(opts: FloatingPanelOptions): FloatingPanel {
  const subtitle = el('span', { className: 'vl-fpanel__sub', text: opts.subtitle ?? '' });
  const close = el('button', {
    className: 'vl-fpanel__close',
    text: '×',
    attrs: { type: 'button', 'aria-label': 'Close' },
    on: { click: () => opts.onClose?.() },
  });
  const root = el('aside', { className: 'vl-fpanel' }, [
    el('div', { className: 'vl-fpanel__head' }, [el('span', { className: 'vl-fpanel__title', text: opts.title }), subtitle, close]),
    el('div', { className: 'vl-fpanel__body' }, opts.body),
  ]);
  return {
    root,
    setSubtitle: (t) => {
      subtitle.textContent = t;
    },
  };
}

// -------------------------------------------------------------------- popover --

export interface PopoverOptions {
  anchor: HTMLElement;
  content: HTMLElement;
  /** Horizontal alignment against the anchor. Default `end`, which is where a top-bar
   *  button's popover wants to hang. */
  align?: 'start' | 'end';
  width?: number;
  onClose?: () => void;
}

export interface PopoverHandle {
  root: HTMLElement;
  close(): void;
}

let openPopover: (() => void) | null = null;

export function closeAllPopovers(): void {
  openPopover?.();
}

/** Content hanging off a control. `openMenu` is a list of commands and `helpTip` is a
 *  sentence; this is the third shape — a small form, like the Sheet dropdown. Fixed, so a
 *  panel's overflow cannot clip it; closes on outside pointer-down, Escape and resize. */
export function popover(opts: PopoverOptions): PopoverHandle {
  closeAllPopovers();
  const root = el('div', { className: 'vl-popover', attrs: { role: 'dialog' } }, [opts.content]);
  if (opts.width) root.style.width = `${opts.width}px`;
  document.body.append(root);

  const a = opts.anchor.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  const gap = 8;
  let top = a.bottom + gap;
  if (top + box.height > window.innerHeight - gap) top = Math.max(gap, a.top - box.height - gap);
  let left = (opts.align ?? 'end') === 'end' ? a.right - box.width : a.left;
  left = Math.max(gap, Math.min(left, window.innerWidth - box.width - gap));
  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;
  const raise = setTimeout(() => root.setAttribute('data-open', ''), 0);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(raise);
    if (openPopover === close) openPopover = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    root.removeAttribute('data-open');
    setTimeout(() => root.remove(), 120);
    opts.onClose?.();
  }
  function onOutside(e: PointerEvent) {
    const t = e.target as Node;
    if (!root.contains(t) && !opts.anchor.contains(t)) close();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  openPopover = close;
  return { root, close };
}
