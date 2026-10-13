// "Help me choose": two questions answered with pictures (where it goes, which photo), then the six
// designs that suit the answers, each drawn with the answers applied. It opens only when asked,
// from the gallery's header; every step can be skipped.
import { button, dialog, el, galleryCard, galleryGrid, skeleton, ICONS } from '@vostok/ui-kit';
import { designById, settingsOf, type Design } from './designs';
import { PHOTO_ANSWERS, PLACES, matches, photoAnswersFor, withAnswers, type Answers, type Place } from './choose';
import { CARD_SHOT, designCard } from './gallery';
import { pictureOf } from './pictures';
import { printTile } from './tiles';

export interface WalkthroughOptions {
  /** The answers standing now, to start from. */
  start: Answers;
  /** A design was picked: open it with these answers. */
  onOpen(design: Design, answers: Answers): void;
  /** "See all": the gallery, filtered by these answers. */
  onSeeAll(answers: Answers): void;
}

/** Each place's picture: one of our own designs as it would be used there. */
const PLACE_DESIGN: Record<Place, string> = { desk: 'block', fridge: 'scallop', keys: 'charm' };

/** How many matches the last step shows. */
const BEST = 6;

export function openWalkthrough(opts: WalkthroughOptions): void {
  let answers: Answers = { ...opts.start };
  const body = el('div', { className: 'pf-walk' });
  const handle = dialog({ title: 'Help me choose', content: body, size: 'wide' });

  const head = (n: number, question: string, note = '') =>
    el('div', { className: 'pf-walk__head' }, [
      el('span', { className: 'pf-walk__step', text: `${n} of 3` }),
      el('h3', { className: 'pf-walk__question', text: question }),
      el('span', { className: 'pf-walk__note', text: note }),
    ]);

  const foot = (back: HTMLElement | null, next: HTMLElement) => el('div', { className: 'pf-walk__foot' }, [back ?? el('span'), next]);

  const answer = (label: string, picture: Promise<string | null>, onClick: () => void) => {
    const card = galleryCard({ name: label, compact: true, thumb: skeleton({ width: '100%', height: '100%' }), onClick });
    void picture.then((url) => url && card.setThumb(url));
    return card;
  };

  function place() {
    const cards = PLACES.map((p) =>
      answer(p.label, pictureOf(settingsOf(designById(PLACE_DESIGN[p.id])!), { width: 300, height: 300 }), () => {
        answers = { ...answers, place: p.id };
        photo();
      }),
    );
    body.replaceChildren(
      head(1, 'Where will it go?'),
      galleryGrid({ cards, minPx: 150, dense: true, aspect: '1 / 1' }),
      foot(null, button({ label: 'Skip', emphasis: 'ghost', onClick: () => { answers = { ...answers, place: null }; photo(); } })),
    );
  }

  function photo() {
    const offered = photoAnswersFor(answers.place);
    const cards = PHOTO_ANSWERS.filter((p) => offered.includes(p.id)).map((p) =>
      answer(p.label, printTile(p.id, 'beach'), () => {
        answers = { ...answers, photo: p.id };
        pick();
      }),
    );
    body.replaceChildren(
      head(2, 'Which photo will go in?'),
      galleryGrid({ cards, minPx: 130, dense: true, aspect: '6 / 5' }),
      foot(
        button({ label: 'Back', icon: ICONS.arrowLeft, emphasis: 'ghost', onClick: place }),
        button({
          label: 'Skip',
          emphasis: 'ghost',
          onClick: () => {
            answers = { ...answers, photo: null };
            // Nothing answered: back to the gallery as it was.
            if (!answers.place) return handle.close();
            pick();
          },
        }),
      ),
    );
  }

  function pick() {
    const all = matches(answers);
    const said = [PLACES.find((p) => p.id === answers.place)?.label, PHOTO_ANSWERS.find((p) => p.id === answers.photo)?.label].filter(Boolean).join(' · ');
    const cards = all.slice(0, BEST).map((d) =>
      designCard(
        d,
        () => {
          handle.close();
          opts.onOpen(d, answers);
        },
        () => pictureOf(withAnswers(settingsOf(d), answers), CARD_SHOT),
      ),
    );
    body.replaceChildren(
      head(3, 'Pick a design', said),
      galleryGrid({ cards, minPx: 150, dense: true, aspect: '4 / 5' }),
      foot(
        button({ label: 'Back', icon: ICONS.arrowLeft, emphasis: 'ghost', onClick: photo }),
        button({
          label: `See all ${all.length} ${all.length === 1 ? 'design' : 'designs'}`,
          emphasis: 'secondary',
          onClick: () => {
            handle.close();
            opts.onSeeAll(answers);
          },
        }),
      ),
    );
  }

  place();
}
