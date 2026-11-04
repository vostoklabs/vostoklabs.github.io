// The front door: every design as a card, a real render of it with a sample photo in its window,
// under the customer's word for what it is, turned the way the Portrait | Landscape switch says.
// The pictures are made before the page opens (cards.ts), so the page opens with them. A click
// opens the editor on the design, that way up; "Help me choose" opens the walkthrough. main.ts
// keeps this one node for the whole visit, so its scroll and its category survive a trip into
// the editor and back.
//
// Laid out the way Laser Studio's gallery is (a rail of categories with their counts beside a
// dense grid under headings), adapted here for portrait pictures and the walkthrough's answers.
import {
  button,
  chip,
  el,
  emptyState,
  galleryCard,
  galleryGrid,
  generatorHeader,
  segmentedControl,
  sideNav,
  skeleton,
  themeToggleButton,
  topbarLinks,
  type GalleryCardHandle,
} from '@vostok/ui-kit';
import { CATEGORIES, DESIGNS, settingsOf, type Category, type Design } from './designs';
import { PHOTO_ANSWERS, PLACES, hasAnswers, matches, type Answers } from './choose';
import { CARD_SHOT, cardPicture, cardSettings } from './cards';
import { pictureOf } from './pictures';
import type { Orientation } from './sizes';

export { CARD_SHOT };

export interface GalleryOptions {
  /** A card was picked, with the way up the switch shows. */
  onPick(design: Design, orientation: Orientation): void;
  onHelp(): void;
  /** The walkthrough's answers that stand, shown as chips; pressing one off drops it. */
  getAnswers(): Answers;
  setAnswers(answers: Answers): void;
  /** The way up this visit: the switch, or the last one picked in the editor. */
  getOrientation(): Orientation;
  setOrientation(orientation: Orientation): void;
  /** Kept out of the header in MakerLab, where the page is the host's. */
  embedded?: boolean;
}

export interface Gallery {
  root: HTMLElement;
  /** Re-read the answers: the filter, the counts and the chips. */
  refresh(): void;
}

/* A card's picture is made once the card comes near the screen, so the cards in view are made
   first and a card filtered out costs nothing. */
const pending = new Map<Element, () => void>();
const watcher =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            watcher!.unobserve(e.target);
            pending.get(e.target)?.();
            pending.delete(e.target);
          }
        },
        { rootMargin: '300px 0px' },
      )
    : null;

function whenSeen(node: Element, start: () => void) {
  if (!watcher) return start();
  pending.set(node, start);
  watcher.observe(node);
}

/** A picture already made (a URL), or one to make. */
type Picture = string | (() => Promise<string | null>);

const placeholder = () => skeleton({ width: '100%', height: '100%' });

/** Show a picture on a card: a made one at once, one to make when the card is first seen. */
function showPicture(card: GalleryCardHandle, picture: Picture) {
  if (typeof picture === 'string') return card.setThumb(picture);
  card.setThumb(placeholder());
  whenSeen(card, () => void picture().then((url) => url && card.setThumb(url)));
}

/** A card for a design, with its picture. */
export function designCard(d: Design, onClick: () => void, picture: Picture = () => pictureOf(settingsOf(d), CARD_SHOT)): GalleryCardHandle {
  const card = galleryCard({ name: d.name, blurb: d.line, compact: true, thumb: placeholder(), onClick });
  card.dataset.design = d.id;
  showPicture(card, picture);
  return card;
}

/** A design's card picture turned one way: the one made beforehand, else one made now. */
const pictureFor = (d: Design, o: Orientation): Picture => cardPicture(d.id, o) ?? (() => pictureOf(cardSettings(d, o), CARD_SHOT));

export function createGallery(opts: GalleryOptions): Gallery {
  let orientation = opts.getOrientation();
  const entries = DESIGNS.map((d) => ({ d, card: designCard(d, () => opts.onPick(d, orientation), pictureFor(d, orientation)) }));

  /** Turn every card the new way. */
  function turn(o: Orientation) {
    if (o === orientation) return;
    orientation = o;
    for (const e of entries) showPicture(e.card, pictureFor(e.d, o));
  }

  const turnSwitch = segmentedControl<Orientation>({
    ariaLabel: 'Orientation',
    size: 'compact',
    options: [
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
    value: orientation,
    onChange: (v) => {
      turn(v);
      opts.setOrientation(v);
    },
  });

  const groups = CATEGORIES.map(({ id, label }) => {
    const members = entries.filter((e) => e.d.category === id);
    const count = el('span', { className: 'pf-gallery__count', text: String(members.length) });
    const node = el('section', { className: 'pf-gallery__group', attrs: { 'aria-label': label } }, [
      el('h2', { className: 'pf-gallery__group-title' }, [document.createTextNode(label), count]),
      galleryGrid({ cards: members.map((e) => e.card), minPx: 160, dense: true, aspect: '4 / 5' }),
    ]);
    return { id, label, node, count, members };
  });

  let category: Category | 'all' = 'all';

  const nav = sideNav({
    label: 'Categories',
    value: 'all',
    sections: [
      {
        id: 'categories',
        items: [{ id: 'all', label: 'All', count: DESIGNS.length }, ...groups.map((g) => ({ id: g.id, label: g.label, count: g.members.length }))],
      },
    ],
    onSelect: (id) => {
      category = id as Category | 'all';
      apply();
      // From deep in the page, land at the top of the shorter list; never scroll down to it.
      const top = main.getBoundingClientRect().top + window.scrollY - 16;
      if (window.scrollY > top) window.scrollTo(0, top);
    },
  });

  // The walkthrough's answers over the cards, each a pressed chip that drops its answer.
  const answersRow = el('div', { className: 'pf-gallery__answers', attrs: { role: 'status' } });
  const empty = el('div', { className: 'pf-gallery__empty' });
  answersRow.hidden = true;
  empty.hidden = true;
  const main = el('main', { className: 'pf-gallery__main' }, [answersRow, ...groups.map((g) => g.node), empty]);

  function showAnswers(a: Answers, shown: number) {
    answersRow.hidden = !hasAnswers(a);
    if (!hasAnswers(a)) return answersRow.replaceChildren();
    const chips: HTMLElement[] = [];
    if (a.place) {
      const label = PLACES.find((p) => p.id === a.place)!.label;
      chips.push(chip({ label, pressed: true, onToggle: () => opts.setAnswers({ ...a, place: null }) }));
    }
    if (a.photo) {
      const label = PHOTO_ANSWERS.find((p) => p.id === a.photo)!.label;
      chips.push(chip({ label, pressed: true, onToggle: () => opts.setAnswers({ ...a, photo: null }) }));
    }
    answersRow.replaceChildren(
      ...chips,
      el('span', { className: 'pf-gallery__found', text: `${shown} ${shown === 1 ? 'design' : 'designs'}` }),
      button({ label: 'Clear', emphasis: 'ghost', onClick: () => opts.setAnswers({ place: null, photo: null }) }),
    );
  }

  function apply() {
    // The editor may have turned the print since the gallery was last on screen.
    const o = opts.getOrientation();
    if (o !== orientation) {
      turn(o);
      turnSwitch.setValue(o);
    }
    const a = opts.getAnswers();
    const kept = new Set(matches(a).map((d) => d.id));
    const counts: Record<string, number> = {};
    let total = 0;
    let shown = 0;
    for (const g of groups) {
      const inView = category === 'all' || category === g.id;
      let n = 0;
      for (const e of g.members) {
        const hit = kept.has(e.d.id);
        if (hit) n++;
        e.card.hidden = !hit || !inView;
      }
      counts[g.id] = n;
      total += n;
      if (inView) shown += n;
      g.node.hidden = !inView || n === 0;
      g.count.textContent = String(n);
    }
    counts.all = total;
    nav.setCounts(counts);
    showAnswers(a, total);
    empty.hidden = shown > 0;
    empty.replaceChildren(
      ...(shown > 0
        ? []
        : [
            category !== 'all' && total > 0
              ? emptyState({
                  title: 'Nothing here for your answers',
                  body: `${total} ${total === 1 ? 'design' : 'designs'} in other categories ${total === 1 ? 'is' : 'are'}.`,
                  action: button({ label: `Show all ${total}`, emphasis: 'secondary', onClick: () => { category = 'all'; nav.setValue('all'); apply(); } }),
                })
              : emptyState({
                  title: 'No designs match',
                  body: 'Drop an answer to see more.',
                  action: button({ label: 'Clear', emphasis: 'secondary', onClick: () => opts.setAnswers({ place: null, photo: null }) }),
                }),
          ]),
    );
  }

  const heading = generatorHeader({ title: 'Photo Frames Studio', description: 'Pick a design, type your words, download a 3MF.' });
  const help = button({ label: 'Help me choose', emphasis: 'secondary', onClick: () => opts.onHelp() });

  // The theme switch sits at the foot of the categories, as in the editor; on a phone, where the
  // categories are a row of chips, it moves up beside the title. One node, moved.
  const theme = themeToggleButton({ storageKey: 'photo-frame-theme', variant: 'action' });
  const railFoot = el('div', { className: 'pf-gallery__rail-foot' });
  const headSlot = el('div', { className: 'pf-gallery__head-slot' });
  const phone = window.matchMedia('(max-width: 760px)');
  const placeTheme = () => (phone.matches ? headSlot : railFoot).append(theme);
  placeTheme();
  phone.addEventListener('change', placeTheme);

  const root = el('div', { className: 'pf-gallery' }, [
    ...(opts.embedded ? [] : [topbarLinks({ themeToggle: false })]),
    el('div', { className: 'pf-gallery__page' }, [
      el('header', { className: 'pf-gallery__header' }, [el('div', { className: 'pf-gallery__heading' }, [heading, headSlot]), el('div', { className: 'pf-gallery__tools' }, [turnSwitch, help])]),
      el('aside', { className: 'pf-gallery__rail' }, [nav, railFoot]),
      main,
    ]),
  ]);

  apply();
  return { root, refresh: apply };
}
