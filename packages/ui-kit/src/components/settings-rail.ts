import { el } from '../dom';
import { section } from './section';
import { toolRail } from './editor-shell';

/*
  Settings in categories, one open at a time: a rail of icons down the panel's edge and the open
  category beside it, scrolling on its own so the rail stays put.

  Laser Studio's editor is the shape — its form assembles the same thing out of `toolRail()` and
  one `section()` per category. The clicker is the second app to want it, so it is a component
  now rather than a second assembly with its own CSS.

  A category with nothing to set hides itself from the rail: when every row in it is hidden (the
  app hid them for the current mode), its button goes, and if it was the open one the first
  category that has something takes its place. `refresh()` re-reads that after the app shows or
  hides rows.
*/

export interface SettingsRailItem {
  id: string;
  /** One word under the icon. */
  label: string;
  /** Icon markup, an `ICONS` entry. */
  icon: string;
  /** The heading over the open category. Default: the label. Empty for none. */
  title?: string;
  /** The category's rows. */
  body: (Node | string)[];
  /** Take the panel's whole height (`section({ fill: true })`): for a category whose content
   *  scrolls itself, such as a `fontChooser({ fill: true })` card grid. */
  fill?: boolean;
  /** A hairline above this category's button: the start of a group set apart from the ones
   *  before it. It goes when either side of it has nothing showing. */
  divider?: boolean;
}

export interface SettingsRailOptions {
  items: SettingsRailItem[];
  /** The category open at first. Default: the first one with something in it. */
  value?: string;
  /** The rail's accessible name. Default 'Settings'. */
  label?: string;
  /** A category was opened, by a click or by `open()`. */
  onChange?(id: string): void;
  /**
   * The rail fills the panel's scroll from edge to edge and the open category does the scrolling:
   * the scroll it is placed in loses its padding and, on a desktop, its own scrollbar. For a
   * panel that is the rail and nothing else (Laser Studio's left panel; pair it with
   * `PanelOptions.compact`). Default false: the rail sits in a padded scroll beside other rows,
   * as the clicker's does.
   */
  flush?: boolean;
}

export type SettingsRailHandle = HTMLElement & {
  /** Open a category. A hidden one falls back to the first that is shown. */
  open(id: string): void;
  getValue(): string | null;
  /** Take a category off the rail (or put it back) whatever its rows say. */
  setVisible(id: string, visible: boolean): void;
  /** Re-read which categories have anything shown in them. */
  refresh(): void;
  /** The open-category element for `id`, to append to later. */
  panel(id: string): HTMLElement | undefined;
};

let uid = 0;

/** Is this row hidden by any of the three ways an app hides one? */
function isHidden(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return node.hidden || node.classList.contains('hidden') || node.style.display === 'none';
}

export function settingsRail(opts: SettingsRailOptions): SettingsRailHandle {
  const id = ++uid;
  const panels = el('div', { className: 'vl-settings-rail__panels' });
  const forced = new Map<string, boolean>();
  const entries = opts.items.map((item, i) => {
    const panel = section({ title: item.title ?? item.label, body: item.body, ...(item.fill ? { fill: true } : {}) });
    panel.classList.add('vl-settings-rail__panel');
    panel.id = `vl-settings-${id}-${i}`;
    panel.hidden = true;
    panels.append(panel);
    return { item, panel, body: panel.querySelector('.vl-section__body') as HTMLElement };
  });

  const rail = toolRail<string>({
    items: entries.map(({ item }) => ({
      value: item.id,
      label: item.label,
      title: item.title || item.label,
      icon: item.icon,
      ...(item.divider ? { divider: true } : {}),
    })),
    value: null,
    onChange: (next) => open(next),
  });
  rail.root.classList.add('vl-settings-rail__rail');
  rail.root.setAttribute('aria-label', opts.label ?? 'Settings');
  for (const e of entries) rail.button(e.item.id)?.setAttribute('aria-controls', e.panel.id);

  const root = el('div', { className: opts.flush ? 'vl-settings-rail vl-settings-rail--flush' : 'vl-settings-rail' }, [rail.root, panels]) as unknown as SettingsRailHandle;
  let current: string | null = null;

  const shown = (e: (typeof entries)[number]) =>
    forced.get(e.item.id) !== false && [...e.body.children].some((n) => !isHidden(n));

  function open(next: string) {
    const target = entries.find((e) => e.item.id === next && shown(e)) ?? entries.find(shown);
    const changed = (target?.item.id ?? null) !== current;
    current = target?.item.id ?? null;
    for (const e of entries) {
      const on = e === target;
      e.panel.hidden = !on;
      rail.button(e.item.id)?.setAttribute('aria-expanded', String(on));
    }
    rail.setValue(current);
    if (changed && current) opts.onChange?.(current);
  }

  function refresh() {
    for (const e of entries) {
      const b = rail.button(e.item.id);
      if (b) b.hidden = !shown(e);
    }
    // A hairline between two groups, with one of them empty, would be a line under nothing.
    const kids = [...rail.root.children] as HTMLElement[];
    const live = (n: HTMLElement) => n.classList.contains('vl-tool-rail__btn') && !n.hidden;
    kids.forEach((k, i) => {
      if (k.classList.contains('vl-tool-rail__rule')) k.hidden = !(kids.slice(0, i).some(live) && kids.slice(i + 1).some(live));
    });
    const open_ = entries.find((e) => e.item.id === current);
    if (!open_ || !shown(open_)) open(current ?? '');
  }

  root.open = open;
  root.getValue = () => current;
  root.setVisible = (key, visible) => {
    forced.set(key, visible);
    refresh();
  };
  root.refresh = refresh;
  root.panel = (key) => entries.find((e) => e.item.id === key)?.panel;

  refresh();
  open(opts.value ?? entries[0]?.item.id ?? '');
  return root;
}
