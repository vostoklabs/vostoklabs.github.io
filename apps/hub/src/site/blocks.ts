// The section blocks pages are assembled from. Each takes data and returns one element; a
// block whose data is missing returns null and the page leaves it out.

import { BRAND } from '@vostok/brand';
import { el, linkButton, supportLinks } from '@vostok/ui-kit';
import type { Generator, Media, SellerTool } from '../registry';
import {
  appHref, featured, fmtPrice, inTopic, isApp, live, mwHref, productPath, thumbPath, topicById, topicPath, TOPICS,
} from './content';
import type { Topic } from './topics';
import type { FaqGroup } from './faq';
import { NEWS } from './news';

type Child = HTMLElement | null | false | undefined;
const kids = (list: Child[]) => list.filter(Boolean) as HTMLElement[];

const s = BRAND.pricing.subscription;
const l = BRAND.pricing.lifetime;

/** A page section: an optional heading row, then the content. */
export function section(opts: {
  id?: string; title?: string; lead?: string; more?: [string, string]; className?: string; level?: 'h1' | 'h2'; aside?: HTMLElement;
}, content: Child[]): HTMLElement {
  const head = opts.title
    ? el('div', { className: 'hub-section__head' }, kids([
        el('div', {}, kids([
          el(opts.level ?? 'h2', { className: 'hub-section__title', text: opts.title }),
          opts.lead ? el('p', { className: 'hub-section__lead', text: opts.lead }) : null,
        ])),
        opts.more ? el('a', { className: 'hub-section__more', text: opts.more[0], attrs: { href: opts.more[1] } }) : null,
        opts.aside ?? null,
      ]))
    : null;
  return el('section', {
    className: `hub-section${opts.className ? ` ${opts.className}` : ''}`,
    attrs: opts.id ? { id: opts.id } : {},
  }, [el('div', { className: 'hub-container' }, kids([head, ...content]))]);
}

/** A bordered block with the generators' section label over it. */
export function panel(title: string, content: Child[], opts: { id?: string; className?: string } = {}): HTMLElement {
  return el('section', {
    className: `hub-panel${opts.className ? ` ${opts.className}` : ''}`,
    attrs: opts.id ? { id: opts.id } : {},
  }, kids([el('h2', { className: 'vl-label', text: title }), ...content]));
}

/** "3D print · Web app": what it makes and where it runs, in one quiet line. */
export function metaLine(g: Generator): string {
  return `${g.process === 'laser' ? 'Laser' : '3D print'} · ${isApp(g) ? 'Web app' : 'MakerWorld'}`;
}

function thumb(g: Generator, alt: string): HTMLElement {
  return el('img', { className: 'hub-thumb', attrs: { src: thumbPath(g), alt, loading: 'lazy', width: '800', height: '600' } });
}

/** The catalogue card: the picture and the name go to the product page; the buttons are the
 *  app, when there is one, and the details. MakerWorld is on the product page. Its data-*
 *  attributes are what the catalogue filter reads. */
export function productCard(g: Generator): HTMLElement {
  const href = productPath(g);
  const app = appHref(g);
  return el('article', {
    className: 'hub-card',
    attrs: {
      'data-card': '',
      'data-topics': g.topics.join(' '),
      'data-process': g.process,
      'data-search': `${g.name} ${g.blurb} ${g.process === 'laser' ? 'laser' : '3d print'}`.toLowerCase(),
    },
  }, [
    el('a', { className: 'hub-card__media', attrs: { href, tabindex: '-1', 'aria-hidden': 'true' } }, [thumb(g, '')]),
    el('div', { className: 'hub-card__body' }, [
      el('p', { className: 'hub-card__meta', text: metaLine(g) }),
      el('h3', { className: 'hub-card__name' }, [el('a', { text: g.name, attrs: { href } })]),
      el('p', { className: 'hub-card__blurb', text: g.blurb, attrs: { title: g.blurb } }),
      el('div', { className: 'hub-card__actions' }, kids([
        app ? linkButton({ label: 'Open app', href: app, emphasis: 'primary' }) : null,
        linkButton({ label: 'Details', href }),
      ])),
    ]),
  ]);
}

/** A coming-soon tool: the same card with no picture and nothing to press. */
export function toolCard(t: SellerTool): HTMLElement {
  return el('article', { className: 'hub-card hub-card--soon', attrs: { 'data-card': '', 'data-search': `${t.name} ${t.blurb}`.toLowerCase() } }, [
    el('div', { className: 'hub-card__body' }, [
      el('p', { className: 'hub-card__meta', text: 'Coming soon' }),
      el('h3', { className: 'hub-card__name', text: t.name }),
      el('p', { className: 'hub-card__blurb', text: t.blurb }),
    ]),
  ]);
}

export function cardGrid(cards: HTMLElement[], className = ''): HTMLElement {
  return el('div', { className: `hub-grid${className ? ` ${className}` : ''}` }, cards);
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export function hero(): HTMLElement {
  return el('section', { className: 'hub-hero' }, [
    el('div', { className: 'hub-container hub-hero__inner' }, [
      el('h1', { className: 'hub-hero__title', text: 'Make it yours, then print it.' }),
      el('p', {
        className: 'hub-hero__sub',
        text: 'Generators for keychains, boxes, signs, fidgets and laser cuts. Customise in your browser, download, print.',
      }),
      el('div', { className: 'hub-actions' }, [
        linkButton({ label: 'Browse generators', href: '/make/', emphasis: 'primary' }),
        linkButton({ label: 'Selling prints?', href: '/licences/' }),
      ]),
      el('p', { className: 'hub-hero__note', text: 'Free for personal use · No account · No watermark' }),
    ]),
  ]);
}

export function featuredGrid(): HTMLElement {
  return cardGrid(featured.map(productCard));
}

export function topicTiles(topics: Topic[] = TOPICS): HTMLElement {
  // Each tile shows a generator no earlier tile has used, so two topics never share a picture.
  const used = new Set<string>();
  return el('div', { className: 'hub-topics' }, topics.map((t) => {
    const items = inTopic(t);
    const cover = items.find((g) => !used.has(g.id)) ?? items[0];
    if (cover) used.add(cover.id);
    return el('a', { className: 'hub-topic', attrs: { href: topicPath(t) } }, kids([
      cover ? el('div', { className: 'hub-topic__media' }, [thumb(cover, '')]) : null,
      el('div', { className: 'hub-topic__body' }, [
        el('h3', { className: 'hub-topic__name', text: t.name }),
        el('span', { className: 'hub-topic__count', text: String(items.length) }),
      ]),
    ]));
  }));
}

/** Free for yourself, a licence to sell: the one decision a visitor has to make, side by side. */
export function licenceBand(): HTMLElement {
  const side = (label: string, big: (string | HTMLElement)[], line: string, action?: HTMLElement) =>
    el('div', { className: 'hub-band__side' }, kids([
      el('h3', { className: 'vl-label', text: label }),
      el('p', { className: 'hub-band__big' }, big),
      el('p', { className: 'hub-band__line', text: line }),
      action ?? null,
    ]));
  return el('div', { className: 'hub-band' }, [
    side('For yourself', ['Free'], 'Every feature of every generator. No account, no watermark, print as many as you like.',
      el('div', { className: 'hub-actions' }, [linkButton({ label: 'Browse generators', href: '/make/' })])),
    side('Selling prints', ['From ', fmtPrice(s.month), el('small', { text: '/month' })],
      `A membership covers the whole catalogue; a lifetime licence is ${fmtPrice(l.one)} once for one generator.`,
      el('div', { className: 'hub-actions' }, [linkButton({ label: 'Compare licences', href: '/licences/' })])),
  ]);
}

/** "New this month": the latest three items of news.ts, as rows. */
export function whatsNew(): HTMLElement | null {
  const rows = NEWS.slice(0, 3).flatMap((n) => {
    const g = live.find((x) => x.id === n.generator);
    if (!g) return [];
    return [el('li', {}, [el('a', { className: 'hub-news', attrs: { href: productPath(g) } }, [
      el('img', { className: 'hub-news__thumb', attrs: { src: thumbPath(g), alt: '', loading: 'lazy', width: '800', height: '600' } }),
      el('span', { className: 'hub-news__body' }, [
        el('span', { className: 'hub-news__name' }, [g.name, el('span', { className: 'hub-news__kind', text: n.kind })]),
        el('span', { className: 'hub-news__text', text: n.text }),
      ]),
    ])])];
  });
  return rows.length ? el('ul', { className: 'hub-news-list' }, rows) : null;
}

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------

export function breadcrumb(trail: [string, string?][]): HTMLElement {
  const ol = el('ol', { className: 'hub-crumbs' });
  for (const [label, href] of trail) {
    ol.append(el('li', {}, [href ? el('a', { text: label, attrs: { href } }) : el('span', { text: label, attrs: { 'aria-current': 'page' } })]));
  }
  return el('nav', { attrs: { 'aria-label': 'Breadcrumb' } }, [ol]);
}

/** The main picture and, when there is more than one, a strip to switch it. A strip item is a
 *  link to its file, so it works before the script; the script swaps the main picture instead. */
export function gallery(g: Generator): HTMLElement {
  const items: Media[] = [{ type: 'image', src: thumbPath(g), alt: g.name }, ...(g.media ?? [])];
  const main = el('div', { className: 'hub-gallery__main', attrs: { 'data-gallery-main': '' } }, [mediaNode(items[0]!)]);
  if (items.length < 2) return el('div', { className: 'hub-gallery' }, [main]);
  const strip = el('div', { className: 'hub-gallery__strip' }, items.map((m, i) => {
    const link = el('a', {
      className: 'hub-gallery__item',
      attrs: {
        href: m.src,
        'data-gallery-item': '',
        'data-type': m.type,
        'aria-label': m.alt,
        ...(m.poster ? { 'data-poster': m.poster } : {}),
        ...(i === 0 ? { 'aria-current': 'true' } : {}),
      },
    }, [el('img', { attrs: { src: m.type === 'video' ? m.poster ?? thumbPath(g) : m.src, alt: '', loading: 'lazy' } })]);
    if (m.type === 'video') link.append(el('span', { className: 'hub-gallery__play', text: '▶' }));
    return link;
  }));
  return el('div', { className: 'hub-gallery' }, [main, strip]);
}

export function mediaNode(m: Media): HTMLElement {
  if (m.type === 'video') {
    return el('video', { attrs: { src: m.src, controls: '', preload: 'none', ...(m.poster ? { poster: m.poster } : {}) } });
  }
  return el('img', { attrs: { src: m.src, alt: m.alt, width: '800', height: '600' } });
}

/** The name, the one-line pitch, and a quiet line of what it makes and where it belongs. */
export function productTitle(g: Generator): HTMLElement {
  const topics = g.topics.map((id) => topicById(id)).filter((t): t is Topic => Boolean(t));
  const meta = el('p', { className: 'hub-title__meta' }, [metaLine(g)]);
  for (const t of topics) meta.append(' · ', el('a', { text: t.name, attrs: { href: topicPath(t) } }));
  return el('div', { className: 'hub-title' }, [
    el('h1', { className: 'hub-title__name', text: g.name }),
    el('p', { className: 'hub-title__pitch', text: g.blurb }),
    meta,
  ]);
}

/** Getting it, then selling what it makes: two parts, one main button. */
export function buyBox(g: Generator): HTMLElement {
  const app = appHref(g);
  const mw = mwHref(g);
  const formats = g.process === 'laser' ? 'SVG cut file' : '3MF';
  const lifetimeUrl = g.lifetimeLicence ? BRAND.urls[g.lifetimeLicence] : null;
  const tile = (name: string, price: string, per: string, what: string, go: string, href: string) =>
    el('a', { className: 'hub-plan-tile', attrs: { href } }, [
      el('span', { className: 'hub-plan-tile__name', text: name }),
      el('span', { className: 'hub-plan-tile__price' }, [price, el('small', { text: per })]),
      el('span', { className: 'hub-plan-tile__what', text: what }),
      el('span', { className: 'hub-plan-tile__go', text: go }),
    ]);
  return el('aside', { className: 'hub-buy', attrs: { 'aria-label': `Get ${g.name}` } }, [
    el('div', { className: 'hub-buy__part' }, kids([
      el('h2', { className: 'vl-label', text: 'Free for personal use' }),
      app ? linkButton({ label: 'Open web app', href: app, emphasis: 'primary', block: true }) : null,
      mw ? linkButton({ label: app ? 'Get it on MakerWorld' : 'Open on MakerWorld', href: mw, emphasis: app ? 'plain' : 'primary', block: true, external: true }) : null,
      el('p', { className: 'hub-buy__note', text: app ? `${formats} · Runs in your browser` : `${formats} · Customise on MakerWorld` }),
      g.offlineUrl ? el('a', { className: 'hub-buy__link', text: 'Download the offline version', attrs: { href: g.offlineUrl } }) : null,
    ])),
    el('div', { className: 'hub-buy__part' }, [
      el('h2', { className: 'vl-label', text: 'Selling prints?' }),
      el('div', { className: 'hub-buy__plans' }, kids([
        tile('Membership', fmtPrice(s.month), '/mo', lifetimeUrl ? 'Every generator' : 'Every generator, this one included', 'See membership', '/licences/#membership'),
        lifetimeUrl ? tile('Lifetime', fmtPrice(l.one), ' once', 'Just this one, forever', 'Buy lifetime', lifetimeUrl) : null,
      ])),
      el('a', { className: 'hub-buy__link', text: 'Compare licences', attrs: { href: '/licences/' } }),
    ]),
  ]);
}

/** The longer explanation. Paragraphs are separated by a blank line in the registry. */
export function aboutPanel(g: Generator): HTMLElement | null {
  const paras = (g.intro ?? '').split(/\n\s*\n/).filter(Boolean);
  if (!paras.length) return null;
  return panel('About', [el('div', { className: 'hub-prose' }, paras.map((p) => el('p', { text: p })))]);
}

/** The features as a plain list: the name on the left, what it does beside it. */
export function featureList(g: Generator): HTMLElement | null {
  if (!g.features?.length) return null;
  return panel('Features', [el('dl', { className: 'hub-specs' }, g.features.map((f) => {
    const [title, line] = typeof f === 'string' ? [f, ''] : f;
    return el('div', { className: 'hub-specs__row' }, [el('dt', { text: title }), el('dd', { text: line })]);
  }))]);
}

/** "Can I sell what I print?" in words, with the way to the licences. */
export function licenceBox(g: Generator): HTMLElement {
  const lifetime = g.lifetimeLicence
    ? ` A lifetime licence for ${g.name} covers this one forever, digital files included.`
    : '';
  return panel('Selling what you print', [
    el('p', { className: 'hub-panel__text', text: `Personal use is free and fully functional. To sell prints you need a commercial licence: the membership covers this and every other generator.${lifetime}` }),
    el('p', { className: 'hub-panel__note' }, [
      'Every export carries an invisible provenance mark. It does not show on the print and never locks a feature. ',
      el('a', { text: 'What is this?', attrs: { href: '/faq/#licences' } }),
    ]),
    el('div', { className: 'hub-actions' }, [linkButton({ label: 'Compare licences', href: '/licences/' })]),
  ], { id: 'licence' });
}

/** This generator's lines from news.ts. */
export function changelog(g: Generator): HTMLElement | null {
  const items = NEWS.filter((n) => n.generator === g.id);
  if (!items.length) return null;
  return panel('What’s new', [el('ul', { className: 'hub-changelog' }, items.map((n) =>
    el('li', {}, [el('span', { className: 'hub-changelog__date', text: n.date }), el('span', { text: n.text })])))]);
}

/** "More generators" down the side, as a video site lists what to watch next. */
export function relatedList(items: Generator[]): HTMLElement | null {
  if (!items.length) return null;
  return el('section', { className: 'hub-related', attrs: { 'aria-label': 'More generators' } }, [
    el('h2', { className: 'vl-label', text: 'More generators' }),
    el('ul', { className: 'hub-related__list' }, items.map((o) => el('li', {}, [
      el('a', { className: 'hub-related__item', attrs: { href: productPath(o) } }, [
        el('img', { className: 'hub-related__thumb', attrs: { src: thumbPath(o), alt: '', loading: 'lazy', width: '800', height: '600' } }),
        el('span', { className: 'hub-related__body' }, [
          el('span', { className: 'hub-related__name', text: o.name }),
          el('span', { className: 'hub-related__blurb', text: o.blurb }),
          el('span', { className: 'hub-related__meta', text: metaLine(o) }),
        ]),
      ]),
    ]))),
  ]);
}

/** The product page body: the picture and the story on the left; getting it and what to look at
 *  next on the right. On a narrow screen the box comes straight after the title. */
export function productLayout(g: Generator, related: Generator[]): HTMLElement {
  return el('div', { className: 'hub-pdp' }, [
    el('div', { className: 'hub-pdp__main' }, [
      el('div', { className: 'hub-pdp__top' }, [gallery(g), productTitle(g)]),
      el('div', { className: 'hub-pdp__rest' }, kids([aboutPanel(g), featureList(g), licenceBox(g), changelog(g)])),
    ]),
    el('div', { className: 'hub-pdp__aside' }, kids([buyBox(g), relatedList(related)])),
  ]);
}

export function homeTopicOf(g: Generator): Topic | undefined {
  const first = g.topics[0];
  return first ? topicById(first) : undefined;
}

// ---------------------------------------------------------------------------
// Shared bands
// ---------------------------------------------------------------------------

/** Questions as native disclosures: they open without a script and are found by search engines. */
export function faqList(groups: FaqGroup[], headings = true): HTMLElement {
  return el('div', { className: 'hub-faq' }, groups.flatMap((g) => [
    ...(headings ? [el('h2', { className: 'hub-faq__group', text: g.title, attrs: { id: g.id } })] : []),
    ...g.items.map(([q, a]) => el('details', { className: 'hub-faq__item' }, [
      el('summary', { className: 'hub-faq__q', text: q }),
      el('p', { className: 'hub-faq__a', text: a }),
    ])),
  ]));
}

export function supportStrip(): HTMLElement {
  return el('div', { className: 'hub-support' }, [
    el('div', {}, [
      el('h3', { className: 'hub-support__title', text: 'Like the free tools?' }),
      el('p', { className: 'hub-support__text', text: 'Buy me a coffee or boost the models on MakerWorld. It keeps the generators free.' }),
    ]),
    supportLinks(),
  ]);
}

/** On a phone the box scrolls away, so the main action and the licence stay pinned. */
export function mobileActionBar(g: Generator): HTMLElement {
  const app = appHref(g);
  const mw = mwHref(g);
  return el('div', { className: 'hub-mobile-bar' }, kids([
    app ? linkButton({ label: 'Open app', href: app, emphasis: 'primary' })
      : mw ? linkButton({ label: 'MakerWorld', href: mw, emphasis: 'primary', external: true }) : null,
    linkButton({ label: 'Licence', href: '/licences/' }),
  ]));
}
