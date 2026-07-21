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
}

export interface AppShellOptions {
  /** The topbar element (usually `topbarLinks(...)`). */
  topbar?: HTMLElement;
  /** Left settings panel. */
  left: PanelOptions;
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
  /** The left panel's scroll container (append extra sections here if needed). */
  leftScroll: HTMLElement;
  /** The right panel's scroll container. */
  rightScroll: HTMLElement;
}

function panel(side: 'left' | 'right', opts: PanelOptions): { panel: HTMLElement; scroll: HTMLElement } {
  const scroll = el('div', { className: 'vl-panel__scroll' }, [
    ...(opts.header ?? []),
    ...(opts.scroll ?? []),
  ]);
  const children: (HTMLElement | Node)[] = [scroll];
  if (opts.footer?.length) children.push(el('div', { className: 'vl-panel__footer' }, opts.footer));
  const p = el('div', { className: `vl-panel vl-panel--${side}` }, children);
  return { panel: p, scroll };
}

/** Assemble the standard 3-column generator shell. */
export function appShell(opts: AppShellOptions): AppShell {
  const left = panel('left', opts.left);
  const right = panel('right', opts.right);
  const stage = el('section', { className: 'vl-stage' }, opts.stage ?? []);

  const root = el('main', { className: 'vl-app' });
  if (opts.topbar) root.append(opts.topbar);
  root.append(left.panel, stage, right.panel);

  return { root, stage, leftScroll: left.scroll, rightScroll: right.scroll };
}
