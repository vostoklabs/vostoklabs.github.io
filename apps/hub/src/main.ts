// Vostok Labs Hub: the browser half. Every page arrives prerendered (src/site/), with its
// stylesheet linked from index.html; this only adds what needs a script: the catalogue's search
// and filters, the gallery strip, the membership term switch and the licence finder.

import { BRAND } from '@vostok/brand';
import { el, linkButton, resolveTheme, searchField, segmentedControl } from '@vostok/ui-kit';
import { live, TOPICS } from './site/content';
import { mediaNode } from './site/blocks';

// The light/dark choice made in any generator holds here too: they share one key. Read only:
// the hub has no switch of its own, so it must not save the system default as a choice.
document.documentElement.setAttribute('data-theme', resolveTheme());

const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;

type Process = 'all' | '3d-print' | 'laser';

/** The catalogue's search, topic switch and 3D print / laser switch, all narrowing one set of
 *  cards. A shelf with nothing left in it hides. */
function catalogueFilter(): void {
  const mount = document.querySelector<HTMLElement>('[data-catalogue-filter]');
  if (!mount) return;
  const cards = [...document.querySelectorAll<HTMLElement>('[data-card]')];
  const shelves = [...document.querySelectorAll<HTMLElement>('.hub-shelf')];
  const empty = document.querySelector<HTMLElement>('[data-empty]');
  let query = (new URLSearchParams(location.search).get('q') ?? '').trim().toLowerCase();
  let topic = 'all';
  let process: Process = 'all';

  const apply = () => {
    for (const card of cards) {
      const okText = !query || (card.dataset.search ?? '').includes(query);
      // A coming-soon tool has no topic or process: it only shows under "All".
      const okTopic = topic === 'all' || (card.dataset.topics ?? '').split(' ').includes(topic);
      const okProcess = process === 'all' || card.dataset.process === process;
      card.hidden = !(okText && okTopic && okProcess);
    }
    let any = false;
    for (const shelf of shelves) {
      const shown = shelf.querySelector('[data-card]:not([hidden])') !== null;
      shelf.hidden = !shown;
      any ||= shown;
    }
    if (empty) empty.hidden = any;
  };

  document.querySelector<HTMLElement>('[data-catalogue-search]')?.append(searchField({
    label: 'Search generators',
    placeholder: 'Search generators',
    value: query,
    onInput: (v) => { query = v.trim().toLowerCase(); apply(); },
  }));

  const topics = segmentedControl<string>({
    value: 'all',
    fit: 'content',
    ariaLabel: 'Topic',
    onChange: (v) => { topic = v; apply(); },
    options: [{ value: 'all', label: 'All' }, ...TOPICS.map((t) => ({ value: t.id, label: t.name }))],
  });
  const kind = segmentedControl<Process>({
    value: 'all',
    fit: 'content',
    ariaLabel: 'Process',
    onChange: (v) => { process = v; apply(); },
    options: [
      { value: 'all', label: 'All' },
      { value: '3d-print', label: '3D print' },
      { value: 'laser', label: 'Laser' },
    ],
  });
  mount.append(el('div', { className: 'hub-filter__scroll' }, [topics]), el('div', { className: 'hub-filter__scroll' }, [kind]));
  apply();
}

type Term = 'month' | 'quarter' | 'year';

/** Month / quarter / year on the membership card, rewriting the price under it. */
function termSwitch(): void {
  const mount = document.querySelector<HTMLElement>('[data-term-switch]');
  const price = mount?.parentElement?.querySelector<HTMLElement>('.hub-plan__price');
  if (!mount || !price) return;
  const s = BRAND.pricing.subscription;
  const per: Record<Term, string> = { month: '/month', quarter: '/quarter', year: '/year' };
  const show = (t: Term) => price.replaceChildren(fmt(s[t]), el('span', { text: per[t] }));
  mount.append(segmentedControl<Term>({
    value: 'month',
    onChange: show,
    options: [
      { value: 'month', label: 'Month' },
      { value: 'quarter', label: 'Quarter' },
      { value: 'year', label: 'Year' },
    ],
  }));
}

/** Three questions to the one licence that fits. The comparison table says the same thing. */
function licenceFinder(): void {
  const mount = document.querySelector<HTMLElement>('[data-licence-finder]');
  if (!mount) return;
  const s = BRAND.pricing.subscription;
  const l = BRAND.pricing.lifetime;
  const lifetime = live.filter((g) => g.lifetimeLicence).map((g) => g.name);
  const names = `${lifetime.slice(0, -1).join(', ')} or ${lifetime.at(-1)}`;
  // Every question starts on its first answer, so what the switches show is what the result reads.
  const answers: { sell: 'no' | 'yes'; only: 'yes' | 'no'; time: 'short' | 'long' } = { sell: 'no', only: 'yes', time: 'short' };

  const result = el('div', { className: 'hub-finder__result', attrs: { 'aria-live': 'polite' } });
  const show = (title: string, text: string, action?: HTMLElement) => {
    result.replaceChildren(
      el('h3', { className: 'hub-finder__title', text: title }),
      el('p', { text }),
      ...(action ? [action] : []),
    );
  };
  const update = () => {
    rows.only.hidden = answers.sell !== 'yes';
    rows.time.hidden = answers.sell !== 'yes';
    if (answers.sell === 'no') return show('Free', 'Printing for yourself, friends and family is free, with every feature.');
    if (answers.only === 'yes' && answers.time === 'long') {
      return show('Lifetime', `Pay ${fmt(l.one)} once for each generator you sell from. It covers the digital files too.`,
        linkButton({ label: 'See lifetime licences', href: '#lifetime', emphasis: 'cta' }));
    }
    show('Membership', answers.time === 'long'
      ? `The whole catalogue for ${fmt(s.year)}/year, cheaper than paying monthly.`
      : `The whole catalogue from ${fmt(s.month)}/month. Stop when you stop selling.`,
      linkButton({ label: 'See membership', href: '#membership', emphasis: 'cta' }));
  };

  const question = <T extends string>(label: string, options: { value: T; label: string }[], set: (v: T) => void) =>
    segmentedControl<T>({ label, options, value: options[0]!.value, onChange: (v) => { set(v); update(); } });

  const rows = {
    sell: question('Do you sell what you print?', [{ value: 'no', label: 'No, it’s for me' }, { value: 'yes', label: 'Yes' }], (v) => { answers.sell = v; }),
    only: question(`Only from ${names}?`, [{ value: 'yes', label: 'Yes, only those' }, { value: 'no', label: 'Others too' }], (v) => { answers.only = v; }),
    time: question('For how long?', [{ value: 'short', label: 'Trying it out' }, { value: 'long', label: 'For years' }], (v) => { answers.time = v; }),
  };
  mount.append(rows.sell, rows.only, rows.time, result);
  update();
}

/** The product gallery: a strip item swaps the main picture instead of opening its file. */
function gallery(): void {
  const main = document.querySelector<HTMLElement>('[data-gallery-main]');
  const items = [...document.querySelectorAll<HTMLAnchorElement>('[data-gallery-item]')];
  if (!main || items.length === 0) return;
  for (const item of items) {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      main.replaceChildren(mediaNode({
        type: item.dataset.type === 'video' ? 'video' : 'image',
        src: item.getAttribute('href') ?? '',
        alt: item.getAttribute('aria-label') ?? '',
        poster: item.dataset.poster,
      }));
      for (const other of items) other.removeAttribute('aria-current');
      item.setAttribute('aria-current', 'true');
    });
  }
}

gallery();
catalogueFilter();
termSwitch();
licenceFinder();
