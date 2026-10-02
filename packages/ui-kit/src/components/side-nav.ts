import { el } from '../dom';
import { listRow, type ListRowHandle } from './elements';

/* A section rail: the column down the left of a catalogue that says what is in it and how
   much — "All 44", "Keychains 11", "Tags 6" — then, under a hairline, a short list of
   shortcuts such as "Recently opened".

   Each item is a `listRow()` (label, trailing count, the active tint), so a rail row and a list
   row are one control and cannot drift apart. Below 760 px the rail lays itself out as ONE
   horizontal, scrolling row of chips, since a column of rows would push the grid it filters a
   whole screen down on a phone. */

export interface SideNavItem {
  id: string;
  label: string;
  /** Trailing number — how many things the item holds. Omit for none. */
  count?: number;
}

export interface SideNavSection {
  id: string;
  /** A small heading over the section. The first section usually has none. */
  title?: string;
  items: SideNavItem[];
  /** One muted line shown in place of the items while there are none: what will appear here. */
  empty?: string;
  /** Clicking an item makes it the current one (a filter, a page). False for shortcuts that act
   *  and leave the selection alone, such as "Recently opened". Default true. */
  selectable?: boolean;
}

export interface SideNavOptions {
  /** The landmark's accessible name — "Categories". */
  label: string;
  sections: SideNavSection[];
  /** The current item's id. */
  value?: string;
  onSelect: (id: string, section: string) => void;
  /** Placement only. */
  className?: string;
}

export type SideNavHandle = HTMLElement & {
  /** Make an item current without firing `onSelect`. */
  setValue(id: string): void;
  /** Update counts by item id. An item at 0 is drawn muted: nothing there right now, but still
   *  reachable, so the list does not reflow under the pointer while someone types. */
  setCounts(counts: Record<string, number>): void;
  /** Replace one section's items — a recent list that has grown. */
  setItems(section: string, items: SideNavItem[]): void;
};

let uid = 0;

export function sideNav(opts: SideNavOptions): SideNavHandle {
  let current = opts.value ?? '';
  const rows = new Map<string, ListRowHandle>();

  const mark = (row: ListRowHandle, on: boolean) => {
    row.setActive(on);
    if (on) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  };

  const setCount = (row: ListRowHandle, n: number) => {
    const meta = row.querySelector('.vl-list-row__meta');
    if (meta) meta.textContent = String(n);
    row.toggleAttribute('data-empty', n === 0);
  };

  const rowOf = (item: SideNavItem, section: SideNavSection) => {
    const selectable = section.selectable !== false;
    const row = listRow({
      label: item.label,
      ...(item.count !== undefined ? { meta: String(item.count) } : {}),
      className: 'vl-side-nav__item',
      onClick: () => {
        if (selectable) root.setValue(item.id);
        opts.onSelect(item.id, section.id);
      },
    });
    // The label ellipsises in a narrow rail; the tooltip keeps the whole name reachable.
    row.title = item.label;
    if (item.count !== undefined) setCount(row, item.count);
    if (selectable) {
      rows.set(item.id, row);
      mark(row, item.id === current);
    }
    return row;
  };

  type Body = { list: HTMLElement; empty: HTMLElement | null; section: SideNavSection };
  const bodies = new Map<string, Body>();

  const fill = (body: Body, items: SideNavItem[]) => {
    for (const item of body.section.items) rows.delete(item.id);
    body.section.items = items;
    body.list.replaceChildren(...items.map((item) => rowOf(item, body.section)));
    if (body.empty) body.empty.hidden = items.length > 0;
  };

  const sections = opts.sections.map((section) => {
    const titleId = `vl-side-nav-${++uid}`;
    const list = el('div', {
      className: 'vl-side-nav__items',
      attrs: { role: 'group', ...(section.title ? { 'aria-labelledby': titleId } : {}) },
    });
    const empty = section.empty ? el('p', { className: 'vl-side-nav__empty', text: section.empty }) : null;
    const body: Body = { list, empty, section: { ...section, items: [] } };
    bodies.set(section.id, body);
    fill(body, section.items);
    return el('div', { className: 'vl-side-nav__section' }, [
      ...(section.title ? [el('p', { className: 'vl-side-nav__title', text: section.title, attrs: { id: titleId } })] : []),
      list,
      ...(empty ? [empty] : []),
    ]);
  });

  const root = el('nav', {
    className: `vl-side-nav${opts.className ? ` ${opts.className}` : ''}`,
    attrs: { 'aria-label': opts.label },
  }, sections) as unknown as SideNavHandle;

  root.setValue = (id) => {
    current = id;
    for (const [rid, row] of rows) mark(row, rid === id);
  };
  root.setCounts = (counts) => {
    for (const [id, n] of Object.entries(counts)) {
      const row = rows.get(id);
      if (row) setCount(row, n);
    }
  };
  root.setItems = (sectionId, items) => {
    const body = bodies.get(sectionId);
    if (body) fill(body, items);
  };
  return root;
}
