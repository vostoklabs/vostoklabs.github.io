import { el } from '../dom';
import { ICONS } from '../icons';
import { button } from './button';
import { drawer, type DrawerHandle } from './drawer';

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
  /**
   * Slimmer chrome round a panel that is mostly a `settingsRail({ flush: true })`, as Laser
   * Studio's left panel is: the header's padding follows the rail's rhythm and a generator header
   * in it loses its own spacing, a button in the header keeps its own width, the footer is one
   * slim row whose button keeps its width (a `buttonRow()` still spans it), and the credit strip
   * goes to the very foot, under the footer. Default false.
   */
  compact?: boolean;
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
  /** Fill the box it is placed in instead of the window: a preview inside a page, or a host's
   *  frame. Default: the window (`100dvh`), which is what an app wants. */
  contained?: boolean;
  /**
   * The narrow-screen layout, under 900 px: one column, the picture first, then the right panel
   * with its footer pinned to the bottom of the screen and the page scrolling. The left panel's
   * settings move behind a Settings button in that footer and open in a drawer (a bottom sheet on
   * a phone), going back when it closes; its header and credit strip are not shown. A
   * `sidebarFooter()` in the right footer is split: its export buttons stay pinned beside
   * Settings, and Save, Load, Help and Light mode follow the panel's content. Nothing changes on
   * a wider screen. Needs a left panel. Default false: the three panels stack on a phone.
   *
   * It watches the window's width for as long as the page lives, so it is for a shell built once
   * per page: an app that builds a new shell per screen would leave a watcher per old shell.
   */
  phone?: boolean;
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

export function panel(
  side: 'left' | 'right',
  opts: PanelOptions,
): { panel: HTMLElement; scroll: HTMLElement; footer: HTMLElement | null } {
  const scroll = el('div', { className: 'vl-panel__scroll' }, opts.scroll ?? []);
  const children: (HTMLElement | Node)[] = [scroll];
  /* Pinned ABOVE the scroll, as the doc comment on `header` has always said — it used to be
     the first thing INSIDE it, which is a different thing entirely: it scrolled away with
     everything else. Nothing was passing `header` when this was fixed, so nothing moved; the
     first caller is the carabiner's undo/redo bar, which is useless the moment it scrolls out
     of reach (the panel is three screens tall, and undo is wanted from the bottom of it). */
  if (opts.header?.length) children.unshift(el('div', { className: 'vl-panel__header' }, opts.header));
  if (opts.credit) children.push(opts.credit);
  const footer = opts.footer?.length ? el('div', { className: 'vl-panel__footer' }, opts.footer) : null;
  if (footer) children.push(footer);
  const p = el('div', { className: `vl-panel vl-panel--${side}${opts.compact ? ' vl-panel--compact' : ''}` }, children);
  return { panel: p, scroll, footer };
}

type PanelParts = ReturnType<typeof panel>;

/** The narrow screen's breakpoint: where `.vl-app--phone` in app-shell.css changes the layout. */
const NARROW = '(max-width: 900px)';

/**
 * `appShell({ phone: true })`, the half CSS cannot do: the Settings button in the right footer,
 * the drawer the left panel's settings move into, and the `sidebarFooter()` split for a narrow
 * screen and put back for a wide one.
 */
function phoneLayout(left: PanelParts, right: PanelParts): void {
  let footer = right.footer;
  if (!footer) {
    // A footer for the button alone; app-shell.css hides it on a wide screen, where it holds nothing.
    footer = el('div', { className: 'vl-panel__footer' });
    right.panel.append(footer);
  }
  // Found once: on a narrow screen they are moved out of the footer, and have to be found to go back.
  const childOf = (parent: Element | null | undefined, cls: string) =>
    ([...(parent?.children ?? [])] as HTMLElement[]).find((c) => c.classList.contains(cls)) ?? null;
  const projectFooter = childOf(footer, 'vl-sidebar-footer');
  const exportBlock = childOf(projectFooter, 'vl-export');

  let sheet: DrawerHandle | null = null;
  const openSettings = () => {
    if (sheet) return;
    const homes = [left.scroll, ...(left.footer ? [left.footer] : [])].map((home) => ({ home, nodes: [...home.childNodes] }));
    const content = el('div', { className: 'vl-app__phone-sheet' }, homes.flatMap((h) => h.nodes));
    sheet = drawer({
      title: 'Settings',
      content,
      onClose: () => {
        for (const { home, nodes } of homes) home.append(...nodes);
        sheet = null;
      },
    });
  };
  const bar = el('div', { className: 'vl-app__phone-bar' }, [
    button({ label: 'Settings', icon: ICONS.sliders, onClick: openSettings }),
  ]);
  footer.prepend(bar);

  const narrow = window.matchMedia(NARROW);
  const place = () => {
    if (narrow.matches) {
      if (exportBlock) bar.prepend(exportBlock);
      if (projectFooter) right.scroll.append(projectFooter);
    } else {
      sheet?.close();
      if (exportBlock) projectFooter?.prepend(exportBlock);
      if (projectFooter) footer!.append(projectFooter);
    }
  };
  narrow.addEventListener('change', place);
  place();
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
  const phone = !!(opts.phone && left);
  const root = el('main', {
    className: [
      left ? 'vl-app' : 'vl-app vl-app--2col',
      opts.topbar ? '' : 'vl-app--no-topbar',
      opts.contained ? 'vl-app--contained' : '',
      phone ? 'vl-app--phone' : '',
    ]
      .filter(Boolean)
      .join(' '),
  });
  if (opts.topbar) root.append(opts.topbar);
  if (left) root.append(left.panel);
  root.append(stage, right.panel);
  if (phone) phoneLayout(left!, right);

  return { root, stage, leftScroll: left?.scroll ?? right.scroll, rightScroll: right.scroll };
}
