import { el } from '../dom';
import { button } from './button';
import { emptyState } from './elements';
import { galleryGrid, type GalleryGridOptions } from './gallery';
import { generatorHeader } from './generator-chrome';
import { sideNav } from './side-nav';

/* The front door of a generator with many designs: every design as a picture card, the groups
   under their headings, and beside them a rail of the groups with their counts that narrows the
   page to one group. Laser Studio's gallery laid this page out for itself first; this is the same
   page, once, for every generator that opens on a choice of designs.

   The cards are the app's (`galleryCard()`), and so is any filter of its own (a search, say):
   it hides a card with `card.hidden` and calls `refresh()`, and the counts, the headings and
   the empty state follow. The rail's group is the page's own and never touches `hidden`, so the
   two cannot undo each other.

   A page, not an app frame: it scrolls (root.css lets it when an app keeps `body` still). On a
   phone it is one column and the rail is `sideNav`'s row of chips, pinned under the top of the
   window. Build it once per page: it watches the window's width for as long as the page lives. */

/** Where the page goes to one column: the width at which `sideNav` becomes a row of chips
 *  (elements.css), so the rail and the page change together. */
const PHONE = '(max-width: 760px)';

export interface GalleryPageGroup {
  /** For `setGroup`. Never 'all', which is the rail's own first item. */
  id: string;
  /** The customer's word for what is in it: the heading over its cards and its item in the rail. */
  label: string;
  /** Its cards, usually `galleryCard()`s. An app hides one with `card.hidden`, then `refresh()`. */
  cards: HTMLElement[];
}

export interface GalleryPageOptions {
  /** The generator's name: the page's one big line. */
  title: string;
  /** One line under it. */
  description?: string;
  /** The bar across the top of the window, usually `topbarLinks()`. */
  topbar?: HTMLElement;
  /** At the right of the header: a button, a search field. */
  tools?: HTMLElement[];
  /** Beside the title. */
  headSlot?: HTMLElement[];
  /**
   * At the foot of the rail, under a hairline: the theme switch. On a phone the rail is a row of
   * chips with no foot, so these move beside the title, the same nodes and never copies (a second
   * theme switch would relabel only itself when pressed).
   */
  railFoot?: HTMLElement[];
  /** The groups, in the order they are shown. */
  groups: GalleryPageGroup[];
  /** Every group's grid, as `galleryGrid()` takes it. */
  grid?: Omit<GalleryGridOptions, 'cards'>;
  /** The rail's first item, every group at once. Default 'All'. */
  allLabel?: string;
  /**
   * What to say when no card shows in any group: the step back from the app's own filter (a
   * Clear search button). Default: "Nothing to show". A group with nothing while others have
   * cards is the page's to explain, with a Show all button.
   */
  empty?: () => HTMLElement;
  /** The credit under the title is text, not a link: the host owns navigation (`generatorHeader`). */
  hostOwnsLinks?: boolean;
}

export interface GalleryPage {
  root: HTMLElement;
  /** Show one group, or 'all'. From below the top of the list it goes back up to it, never down. */
  setGroup(id: string): void;
  /** Re-read which cards are hidden: the counts, the headings and the empty state follow. */
  refresh(): void;
}

/** The box the page scrolls in: the nearest ancestor that scrolls, or the window. */
function scrollerOf(node: HTMLElement): { scrollBy(x: number, y: number): void } {
  for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return window;
}

/** A gallery's whole page: header, a rail of groups with their counts, the cards in groups. */
export function galleryPage(opts: GalleryPageOptions): GalleryPage {
  const allLabel = opts.allLabel ?? 'All';
  let current = 'all';

  const groups = opts.groups.map((g) => {
    const count = el('span', { className: 'vl-gallery-page__count' });
    const node = el('section', { className: 'vl-gallery-page__group', attrs: { 'aria-label': g.label } }, [
      el('h2', { className: 'vl-gallery-page__group-title' }, [g.label, count]),
      galleryGrid({ ...opts.grid, cards: g.cards }),
    ]);
    return { ...g, count, node };
  });

  const nav = sideNav({
    label: 'Categories',
    value: current,
    sections: [{ id: 'groups', items: [{ id: 'all', label: allLabel, count: 0 }, ...groups.map((g) => ({ id: g.id, label: g.label, count: 0 }))] }],
    onSelect: (id) => setGroup(id),
  });

  const empty = el('div', { className: 'vl-gallery-page__empty', attrs: { role: 'status' } });
  const main = el('main', { className: 'vl-gallery-page__main' }, [...groups.map((g) => g.node), empty]);
  const headSlot = el('div', { className: 'vl-gallery-page__head-slot' }, opts.headSlot ?? []);
  const railFoot = el('div', { className: 'vl-gallery-page__rail-foot' });
  const rail = el('aside', { className: 'vl-gallery-page__rail' }, [nav, railFoot]);
  const body = el('div', { className: 'vl-gallery-page__body' }, [
    el('header', { className: 'vl-gallery-page__header' }, [
      el('div', { className: 'vl-gallery-page__heading' }, [
        generatorHeader({ title: opts.title, description: opts.description, hostOwnsLinks: opts.hostOwnsLinks }),
        headSlot,
      ]),
      el('div', { className: 'vl-gallery-page__tools' }, opts.tools ?? []),
    ]),
    rail,
    main,
  ]);
  const root = el('div', { className: 'vl-gallery-page' }, opts.topbar ? [opts.topbar, body] : [body]);

  const foot = opts.railFoot ?? [];
  if (foot.length) {
    const phone = window.matchMedia(PHONE);
    const place = () => (phone.matches ? headSlot : railFoot).append(...foot);
    place();
    phone.addEventListener('change', place);
  }

  function refresh() {
    const counts: Record<string, number> = {};
    let total = 0;
    let shown = 0;
    for (const g of groups) {
      const n = g.cards.filter((c) => !c.hidden).length;
      const inView = current === 'all' || current === g.id;
      counts[g.id] = n;
      total += n;
      if (inView) shown += n;
      g.count.textContent = String(n);
      g.node.hidden = !inView || n === 0;
    }
    counts.all = total;
    nav.setCounts(counts);

    empty.hidden = shown > 0;
    if (shown > 0) {
      empty.replaceChildren();
      return;
    }
    // Nothing here but something elsewhere is the page's to say; nothing anywhere is the app's.
    const group = groups.find((g) => g.id === current);
    empty.replaceChildren(
      group && total > 0
        ? emptyState({
            title: `Nothing in ${group.label} matches`,
            action: button({ label: `Show all ${total}`, emphasis: 'secondary', onClick: () => setGroup('all') }),
          })
        : (opts.empty?.() ?? emptyState({ title: 'Nothing to show' })),
    );
  }

  /* From below the top of the list, back up to it, so a shorter list is read from its start;
     never down to it, so the header stays where it was. The list's top comes to rest where the
     rail rests: beside the list (a wide screen) at the rail's own top, above it (a phone) just
     under the chips. */
  function backToList() {
    const r = rail.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    const rest = r.right <= m.left ? r.top : r.bottom + (parseFloat(getComputedStyle(body).rowGap) || 0);
    if (m.top < rest) scrollerOf(root).scrollBy(0, m.top - rest);
  }

  function setGroup(id: string) {
    if (id !== 'all' && !groups.some((g) => g.id === id)) return;
    current = id;
    nav.setValue(id);
    refresh();
    backToList();
  }

  refresh();
  return { root, setGroup, refresh };
}
