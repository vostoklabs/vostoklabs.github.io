// The front door: every design as a card, a real render of it with a sample photo in its window,
// under the customer's word for what it is. A click opens the editor on it; "Help me choose"
// opens the walkthrough. main.ts keeps this one node for the whole visit, so its scroll, its
// category and the pictures it has drawn survive a trip into the editor and back.
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
  sideNav,
  skeleton,
  themeToggleButton,
  topbarLinks,
  type GalleryCardHandle,
} from '@vostok/ui-kit';
import { CATEGORIES, DESIGNS, settingsOf, type Category, type Design } from './designs';
import { PHOTO_ANSWERS, PLACES, hasAnswers, matches, type Answers } from './choose';
import { pictureOf } from './pictures';

/** A card's picture: portrait, 4 by 5, drawn at about twice the size it shows. */
export const CARD_SHOT = { width: 360, height: 450 };

export interface GalleryOptions {
  onPick(design: Design): void;
  onHelp(): void;
  /** The walkthrough's answers that stand, shown as chips; pressing one off drops it. */
  getAnswers(): Answers;
  setAnswers(answers: Answers): void;
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

/** A card for a design, its picture drawn when it is first seen. */
export function designCard(d: Design, onClick: () => void, picture: () => Promise<string | null> = () => pictureOf(settingsOf(d), CARD_SHOT)): GalleryCardHandle {
  const card = galleryCard({ name: d.name, blurb: d.line, compact: true, thumb: skeleton({ width: '100%', height: '100%' }), onClick });
  card.dataset.design = d.id;
  whenSeen(card, () => void picture().then((url) => url && card.setThumb(url)));
  return card;
}

export function createGallery(opts: GalleryOptions): Gallery {
  const entries = DESIGNS.map((d) => ({ d, card: designCard(d, () => opts.onPick(d)) }));

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
    topbarLinks({ themeToggle: false }),
    el('div', { className: 'pf-gallery__page' }, [
      el('header', { className: 'pf-gallery__header' }, [el('div', { className: 'pf-gallery__heading' }, [heading, headSlot]), el('div', { className: 'pf-gallery__tools' }, [help])]),
      el('aside', { className: 'pf-gallery__rail' }, [nav, railFoot]),
      main,
    ]),
  ]);

  apply();
  return { root, refresh: apply };
}
