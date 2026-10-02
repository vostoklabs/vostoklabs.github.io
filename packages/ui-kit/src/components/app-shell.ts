import { el } from '../dom';

/* The standard generator layout: a full-width topbar over a left settings panel,
   a center stage (3D preview), and a right panel. Pair with app-shell.css. Every
   generator builds its frame with this and only fills the panel contents. */

export interface PanelOptions {
  /** Fixed content pinned above the scroll area (e.g. a header). */
  header?: (HTMLElement | Node)[];
  /** Scrolling content (the settings sections). */
  scroll?: (HTMLElement | Node)[];
  /** Fixed content pinned below the scroll area (e.g. the export footer). */
  footer?: (HTMLElement | Node)[];
  /**
   * A `panelCredit()` strip pinned under the scroll area.
   *
   * Its own slot rather than the footer, because the footer pads its contents by 20 px a side
   * and the strip carries its own padding and border: inside the footer the byline's column
   * came out 130 px wide and "Made by Vostok Labs" wrapped onto two lines. Here it spans the
   * panel, the way the clicker and keycap generators mount it.
   */
  credit?: HTMLElement;
}

export interface AppShellOptions {
  /** The topbar element (usually `topbarLinks(...)`). */
  topbar?: HTMLElement;
  /** Left settings panel. Omit it for the two-column shell — stage | one panel — that a
   *  form-driven editor wants (Laser Studio): the picture on the left, the questions on the
   *  right, and no third column to fill. */
  left?: PanelOptions;
  /** Center stage — the 3D preview canvas mounts into the returned `stage`. */
  stage?: (HTMLElement | Node)[];
  /** Right panel (fonts / output / export). */
  right: PanelOptions;
}

export interface AppShell {
  /** The root element to append to #app. */
  root: HTMLElement;
  /** The center stage element — mount your renderer/canvas here. */
  stage: HTMLElement;
  /** The left panel's scroll container (append extra sections here if needed). With no left
   *  panel (the two-column shell) this is the right panel's scroll, so callers that append
   *  sections still have a panel to append to. */
  leftScroll: HTMLElement;
  /** The right panel's scroll container. */
  rightScroll: HTMLElement;
}

export function panel(side: 'left' | 'right', opts: PanelOptions): { panel: HTMLElement; scroll: HTMLElement } {
  const scroll = el('div', { className: 'vl-panel__scroll' }, opts.scroll ?? []);
  const children: (HTMLElement | Node)[] = [scroll];
  /* Pinned ABOVE the scroll, as the doc comment on `header` has always said — it used to be
     the first thing INSIDE it, which is a different thing entirely: it scrolled away with
     everything else. Nothing was passing `header` when this was fixed, so nothing moved; the
     first caller is the carabiner's undo/redo bar, which is useless the moment it scrolls out
     of reach (the panel is three screens tall, and undo is wanted from the bottom of it). */
  if (opts.header?.length) children.unshift(el('div', { className: 'vl-panel__header' }, opts.header));
  if (opts.credit) children.push(opts.credit);
  if (opts.footer?.length) children.push(el('div', { className: 'vl-panel__footer' }, opts.footer));
  const p = el('div', { className: `vl-panel vl-panel--${side}` }, children);
  return { panel: p, scroll };
}

/** Assemble the standard 3-column generator shell. */
export function appShell(opts: AppShellOptions): AppShell {
  const left = opts.left ? panel('left', opts.left) : null;
  const right = panel('right', opts.right);
  const stage = el('section', { className: 'vl-stage' }, opts.stage ?? []);

  /* `--no-topbar` is load-bearing, not cosmetic. `.vl-app` reserves `grid-template-rows: auto
     minmax(0, 1fr)` — the `auto` row for the bar, the `1fr` row for the panels. With no bar
     appended, auto-placement puts the panels in the `auto` row instead and leaves the `1fr` row
     empty underneath: the columns collapse to their CONTENT height and the rest of the window is
     dead space, which also means they resize every time a panel's content changes. An embedded
     build is exactly the case that omits the bar, so every MakerLab embed had it. */
  const root = el('main', {
    className: [left ? 'vl-app' : 'vl-app vl-app--2col', opts.topbar ? '' : 'vl-app--no-topbar'].filter(Boolean).join(' '),
  });
  if (opts.topbar) root.append(opts.topbar);
  if (left) root.append(left.panel);
  root.append(stage, right.panel);

  return { root, stage, leftScroll: left?.scroll ?? right.scroll, rightScroll: right.scroll };
}
