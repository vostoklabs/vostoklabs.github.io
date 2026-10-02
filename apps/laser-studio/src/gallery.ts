// The front door: every template as a card, drawn from its own default build, in groups under
// plain headings — Keychains, Tags, Ornaments… — so the page reads as a catalogue rather than a
// grid of whatever was registered last.
// Click a card and the editor opens on it. main.ts keeps this one node mounted for the whole
// session, so its scroll position, search and filters survive a trip into the editor and back.
//
// The layout (2026-09-26, replacing one with a lot of empty space and no clear
// segmentation): a search box across the top, a rail of categories with their counts down the
// left, and the full width beside it given to a dense grid of compact cards whose pictures are
// cropped to the design. The theme switch is not in the topbar: it sits where the editor keeps
// it, at the foot of the left column.
import {
  button,
  el,
  emptyState,
  galleryCard,
  galleryGrid,
  generatorHeader,
  searchField,
  sideNav,
  themeToggleButton,
  topbarLinks,
  type SideNavItem,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';
import { MAKERLAB } from 'virtual:makerlab';
import { TEMPLATES, templateById, type TemplateDef } from './templates';
import { thumbSvg } from './preview';
import { thumbnailFor } from './thumbs';

/** The groups, in the order they are shown, each the customer's word for the object and the
 *  first tags it collects. A tag no group names gets a group of its own
 *  at the end, so a new category is never lost — only unsorted.
 *
 *  2026-09-29: couple keychains, business cards, gifts, QR codes and the pattern tools each get
 *  a group. "Home & office" was a muddle — business cards, the two
 *  pattern tools, photo frames and a phone stand under one heading — and the QR designs were
 *  split between Signs and Tags by how they stand rather than by what they are. A template's
 *  OTHER tags keep its old words searchable: a QR stand still answers "sign". */
const GROUPS: { key: string; title: string; tags: string[] }[] = [
  { key: 'keychain', title: 'Keychains & charms', tags: ['keychain'] },
  { key: 'couple', title: 'Couple keychains', tags: ['couple'] },
  { key: 'gift', title: 'Gifts', tags: ['gift'] },
  { key: 'card', title: 'Business cards', tags: ['card'] },
  { key: 'qr', title: 'QR codes', tags: ['qr'] },
  { key: 'pattern', title: 'Patterns', tags: ['pattern'] },
  { key: 'tag', title: 'Tags', tags: ['tag'] },
  { key: 'ornament', title: 'Ornaments', tags: ['ornament'] },
  { key: 'sign', title: 'Signs & stands', tags: ['sign'] },
  { key: 'party', title: 'Party & weddings', tags: ['party'] },
  { key: 'games', title: 'Toys & games', tags: ['kids', 'games'] },
];

const titleOf = (key: string) => GROUPS.find((g) => g.key === key)?.title ?? key.charAt(0).toUpperCase() + key.slice(1);
const groupKeyOf = (tag: string) => GROUPS.find((g) => g.tags.includes(tag))?.key ?? tag;

/* The cards' pictures, drawn at BUILD time (scripts/thumbs.mjs → `virtual:laser-thumbs`). Building
   all ~45 default designs here — every template's `build()` on the main thread, then each through
   the one geometry worker in series — put the first picture ~24 s after the cards
   (2026-09-26). Asked for at module load so the chunk is on its way before the page is; a card with
   no precomputed picture (a template newer than the build, or a dev server whose cache is still
   being drawn) builds its own, live, as before. */
const precomputed: Promise<Record<string, string>> = import('virtual:laser-thumbs')
  .then((m) => m.default)
  .catch((err) => { console.warn('[laser-studio] precomputed thumbnails unavailable; building live', err); return {}; });

/* A card with no precomputed picture builds its own — but only once it comes near the screen.
   Asked for all at once, the ~60 builds queue through the one geometry worker in REGISTRY order,
   so the cards in view waited behind every card below them, which was very slow. Asked
   for as they scroll in, the worker's queue is the order they are seen in, and a card filtered
   out or never scrolled to costs nothing. With no IntersectionObserver, it builds at once. */
const seen = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen!.unobserve(e.target);
        pendingBuilds.get(e.target)?.();
        pendingBuilds.delete(e.target);
      }
    }, { rootMargin: '300px 0px' })
  : null;
const pendingBuilds = new Map<Element, () => void>();
function buildWhenSeen(card: Element, start: () => void) {
  if (!seen) { start(); return; }
  pendingBuilds.set(card, start);
  seen.observe(card);
}

function svgFromString(markup: string): Element | null {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  return svg.nodeName === 'svg' ? document.importNode(svg, true) : null;
}

/* The pictures are drawn with 15% of air on every side (`thumbSvg(out, 0.15)` in
   scripts/thumbs.mjs) — right for the old big card, and most of what made the compact one look
   empty. The air is taken back off the viewBox rather than re-rendered, leaving a hair so a
   stroke never touches the tile's edge. A live picture is simply drawn with the hair. */
const DRAWN_PAD = 0.15;
const KEEP_PAD = 0.03;
function cropToDesign(svg: Element): Element {
  const vb = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return svg;
  const [x, y, w, h] = vb as [number, number, number, number];
  // w = inner + 2p with p = DRAWN_PAD × the longer inner side, so p is a fixed share of max(w, h).
  const p = (Math.max(w, h) * DRAWN_PAD) / (1 + 2 * DRAWN_PAD);
  const iw = w - 2 * p;
  const ih = h - 2 * p;
  if (iw <= 0 || ih <= 0) return svg;
  const k = Math.max(iw, ih) * KEEP_PAD;
  svg.setAttribute('viewBox', `${x + p - k} ${y + p - k} ${iw + 2 * k} ${ih + 2 * k}`);
  return svg;
}

/* "Recently opened": the last few templates the editor was opened on, newest first. main.ts
   reports every open (a card, the rail, a shared link, the editor's own switcher), so the list
   is what was actually opened, not only what was clicked here. Storage can be missing, full or
   refused (a private window, for one) — every touch is guarded, and the rail simply
   stays empty without it. */
const RECENT_KEY = 'laser-studio-recent';
const RECENT_MAX = 6;
let onRecentChange: (() => void) | null = null;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && !!templateById(id)) : [];
  } catch {
    return [];
  }
}

export function rememberOpened(id: string): void {
  const next = [id, ...readRecent().filter((r) => r !== id)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* not stored: the rail stays as it was */ }
  onRecentChange?.();
}

export function createGallery(onPick: (t: TemplateDef) => void): HTMLElement {
  const keys = [...GROUPS.map((g) => g.key), ...new Set(TEMPLATES.map((t) => groupKeyOf(t.tags[0] ?? '')))].filter((k, i, all) => k && all.indexOf(k) === i);

  // A card is the picture, the name and one line; the heading above it says what it is.
  const entries = TEMPLATES.map((t) => {
    const group = groupKeyOf(t.tags[0] ?? '');
    const card = galleryCard({ name: t.name, blurb: t.blurb, compact: true, onClick: () => onPick(t) });
    card.setAttribute('data-template', t.id);
    card.setAttribute('data-category', t.tags[0] ?? '');
    void precomputed.then((thumbs) => {
      const svg = thumbs[t.id] ? svgFromString(thumbs[t.id]!) : null;
      if (svg) { card.setThumb(cropToDesign(svg)); return; }
      buildWhenSeen(card, () => void thumbnailFor(t).then((out) => { if (out) card.setThumb(thumbSvg(out, KEEP_PAD)); }));
    });
    // What a search looks through: the name, the line, the tags and the heading it sits under —
    // so "wedding" finds the Party & weddings designs whose own words never say it.
    const haystack = [t.name, t.blurb, ...t.tags, titleOf(group)].join(' ').toLowerCase();
    return { t, group, card, haystack };
  });
  type Entry = (typeof entries)[number];

  const groups = keys
    .map((key) => ({ key, entries: entries.filter((e) => e.group === key) }))
    .filter((g) => g.entries.length)
    .map(({ key, entries: members }) => {
      const count = el('span', { className: 'ls-gallery__count', text: String(members.length) });
      const node = el('section', { className: 'ls-gallery__group', attrs: { 'aria-label': titleOf(key) } }, [
        el('h2', { className: 'ls-gallery__group-title' }, [document.createTextNode(titleOf(key)), count]),
        galleryGrid({ cards: members.map((e) => e.card), minPx: 168, dense: true }),
      ]);
      node.setAttribute('data-group', key);
      return { key, node, count, entries: members };
    });

  // ---- what is being asked for
  let query = '';
  let category = 'all';

  const search = searchField({
    label: 'Search designs',
    placeholder: `Search ${TEMPLATES.length} designs — keychain, wedding, QR`,
    onInput: (v) => { query = v; apply(); },
  });
  search.classList.add('ls-gallery__search');
  search.setAttribute('role', 'search');

  const recentItems = (): SideNavItem[] =>
    readRecent().map((id) => ({ id, label: templateById(id)!.name }));

  /* The rail FILTERS rather than scrolls. It narrows the same cards the search does, and a
     scroll-to rail would be the odd one out: a search for "wedding" narrowed to Tags could not
     say "nothing in Tags" if Tags were only a place on the page. Filtering also answers each
     click with a short page instead of a long one, and it is what the counts beside each name
     already promise. */
  const nav = sideNav({
    label: 'Categories',
    value: 'all',
    sections: [
      {
        id: 'categories',
        items: [
          { id: 'all', label: 'All', count: TEMPLATES.length },
          ...groups.map((g) => ({ id: g.key, label: titleOf(g.key), count: g.entries.length })),
        ],
      },
      {
        id: 'recent',
        title: 'Recently opened',
        items: recentItems(),
        empty: 'The designs you open will be listed here.',
        selectable: false,
      },
    ],
    onSelect: (id, section) => {
      if (section === 'recent') {
        const t = templateById(id);
        if (t) onPick(t);
        return;
      }
      setCategory(id);
    },
  });
  onRecentChange = () => nav.setItems('recent', recentItems());

  const empty = el('div', { className: 'ls-gallery__empty hidden', attrs: { role: 'status' } });
  const main = el('main', { className: 'ls-gallery__main' }, [...groups.map((g) => g.node), empty]);

  function setCategory(key: string) {
    category = key;
    nav.setValue(key);
    apply();
    // Coming from deep in a long list, land at the top of the shorter one, not in the middle of
    // whatever is now below it. Never scroll DOWN to it — the header stays where it was.
    const top = main.getBoundingClientRect().top + window.scrollY - 16;
    if (window.scrollY > top) window.scrollTo(0, top);
  }

  function resetFilters() {
    query = '';
    search.setValue('');
    category = 'all';
    nav.setValue('all');
    apply();
    search.field.focus();
  }

  function apply() {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (e: Entry) => words.every((w) => e.haystack.includes(w));

    const counts: Record<string, number> = {};
    let total = 0;
    let shown = 0;
    for (const g of groups) {
      const inView = category === 'all' || category === g.key;
      let n = 0;
      for (const e of g.entries) {
        const hit = matches(e);
        if (hit) n++;
        e.card.classList.toggle('hidden', !hit || !inView);
      }
      counts[g.key] = n;
      total += n;
      if (inView) shown += n;
      g.node.classList.toggle('hidden', !inView || n === 0);
      g.count.textContent = String(n);
    }
    counts.all = total;
    nav.setCounts(counts);

    empty.classList.toggle('hidden', shown > 0);
    if (shown > 0) { empty.replaceChildren(); return; }
    // Nothing to show: say why, and offer the one step that gets something back.
    empty.replaceChildren(
      category !== 'all' && total > 0
        ? emptyState({
            title: `Nothing in ${titleOf(category)} matches`,
            body: `${total} ${total === 1 ? 'design' : 'designs'} in other categories ${total === 1 ? 'does' : 'do'}.`,
            action: button({ label: `Show all ${total}`, emphasis: 'secondary', onClick: () => setCategory('all') }),
          })
        : emptyState({
            title: 'No designs match',
            body: `Nothing matches “${query.trim()}”. Try fewer or shorter words.`,
            action: button({ label: 'Clear search', emphasis: 'secondary', onClick: resetFilters }),
          }),
    );
  }

  // The kit's generator header: the name, the line, and "Made by Vostok Labs" under them — the
  // same byline the editor's credit strip carries. In the embedded build it is text, not a
  // link: the embedded build has no outbound links; the host owns navigation (invariant #7).
  const heading = generatorHeader({
    title: 'Laser Studio',
    description: MAKERLAB
      ? 'Pick a design, type your text, send the cut file to MakerLab.'
      : 'Pick a design, type your text, download the cut file.',
    hostOwnsLinks: MAKERLAB,
  });

  /* The theme switch, where the editor keeps it — the secondary action button at the foot of the
     left column, never the topbar. ONE node, moved rather than duplicated: on a phone the rail is
     a row of chips with no foot, so the switch goes to the end of the header row instead. Two
     copies would each only relabel themselves when pressed, and one would say "Light mode" while
     the page was already light. */
  const theme = themeToggleButton({ storageKey: 'laser-studio-theme', variant: 'action' });
  const railFoot = el('div', { className: 'ls-gallery__rail-foot' });
  const headSlot = el('div', { className: 'ls-gallery__head-slot' });
  const phone = window.matchMedia('(max-width: 760px)');
  const placeTheme = () => (phone.matches ? headSlot : railFoot).append(theme);
  placeTheme();
  phone.addEventListener('change', placeTheme);

  const header = el('header', { className: 'ls-gallery__header' }, [
    el('div', { className: 'ls-gallery__heading' }, [heading, headSlot]),
    el('div', { className: 'ls-gallery__tools' }, [search]),
  ]);

  // The embedded build has no outbound links; the host owns navigation and draws its own
  // chrome. The topbar's four buttons (GitHub, the commercial licence, Boost, Ko-fi) are all
  // outbound links, and with the theme switch gone from it too there is nothing left, so
  // there is no bar.
  return el('div', { className: 'ls-gallery' }, [
    ...(MAKERLAB ? [] : [topbarLinks({ githubUrl: BRAND.urls.github })]),
    el('div', { className: 'ls-gallery__page' }, [
      header,
      el('aside', { className: 'ls-gallery__rail' }, [nav, railFoot]),
      main,
    ]),
  ]);
}
