// The section blocks pages are assembled from. Each takes data and returns one element; a
// block whose data is missing returns null and the page leaves it out.

import { BRAND } from '@vostok/brand';
import { el, linkButton, supportLinks, svgEl, ICONS } from '@vostok/ui-kit';
import type { Generator, Media, SellerTool } from '../registry';
import {
  appHref, featured, fmtPrice, inTopic, isApp, isMw, live, mwHref, mwOnly, productPath, thumbPath,
  topicById, topicPath, TOPICS, webApps,
} from './content';
import type { Topic } from './topics';
import type { FaqGroup } from './faq';
import { NEWS } from './news';

type Child = HTMLElement | null | false | undefined;
const kids = (list: Child[]) => list.filter(Boolean) as HTMLElement[];

/** A page section: the rail, an optional heading row, the content. */
export function section(opts: {
  id?: string; title?: string; lead?: string; more?: [string, string]; className?: string; level?: 'h1' | 'h2';
}, content: Child[]): HTMLElement {
  const head = opts.title
    ? el('div', { className: 'hub-section__head' }, kids([
        el('div', {}, kids([
          el(opts.level ?? 'h2', { className: 'hub-section__title', text: opts.title }),
          opts.lead ? el('p', { className: 'hub-section__lead', text: opts.lead }) : null,
        ])),
        opts.more ? el('a', { className: 'hub-section__more', text: opts.more[0], attrs: { href: opts.more[1] } }) : null,
      ]))
    : null;
  return el('section', {
    className: `hub-section${opts.className ? ` ${opts.className}` : ''}`,
    attrs: opts.id ? { id: opts.id } : {},
  }, [el('div', { className: 'hub-container' }, kids([head, ...content]))]);
}

function badge(text: string, tone?: 'accent'): HTMLElement {
  return el('span', { className: `hub-badge${tone ? ` hub-badge--${tone}` : ''}`, text });
}

export function routeBadges(g: Generator): HTMLElement {
  return el('div', { className: 'hub-badges' }, kids([
    isApp(g) ? badge('Web app', 'accent') : null,
    isMw(g) ? badge('MakerWorld', 'accent') : null,
    badge(g.process === 'laser' ? 'Laser' : '3D print'),
  ]));
}

function thumb(g: Generator, alt: string): HTMLElement {
  return el('img', { className: 'hub-thumb', attrs: { src: thumbPath(g), alt, loading: 'lazy', width: '800', height: '600' } });
}

/** The catalogue card. Its data-* attributes are what the catalogue filter reads. */
export function productCard(g: Generator): HTMLElement {
  const href = productPath(g);
  const actions = el('div', { className: 'hub-card__actions' }, kids([
    appHref(g) ? linkButton({ label: 'Open app', href: appHref(g)!, emphasis: 'primary' }) : null,
    mwHref(g) ? linkButton({ label: 'MakerWorld ↗', href: mwHref(g)!, emphasis: isApp(g) ? 'plain' : 'primary', external: true }) : null,
    linkButton({ label: 'Details', href, emphasis: 'ghost' }),
  ]));
  return el('article', {
    className: 'hub-card',
    attrs: {
      'data-card': '',
      'data-topics': g.topics.join(' '),
      'data-process': g.process,
      'data-search': `${g.name} ${g.blurb}`.toLowerCase(),
    },
  }, [
    el('a', { className: 'hub-card__media', attrs: { href, tabindex: '-1', 'aria-hidden': 'true' } }, [thumb(g, '')]),
    el('div', { className: 'hub-card__body' }, [
      routeBadges(g),
      el('h3', { className: 'hub-card__name' }, [el('a', { text: g.name, attrs: { href } })]),
      el('p', { className: 'hub-card__blurb', text: g.blurb }),
      actions,
    ]),
  ]);
}

/** A coming-soon tool: same shape as a card, no actions to press. */
export function toolCard(t: SellerTool): HTMLElement {
  return el('article', { className: 'hub-card hub-card--soon', attrs: { 'data-card': '', 'data-search': `${t.name} ${t.blurb}`.toLowerCase() } }, [
    el('div', { className: 'hub-card__body' }, [
      el('div', { className: 'hub-badges' }, [badge('Coming soon')]),
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

export function heroProducts(): HTMLElement {
  const tiles = featured.slice(0, 4).map((g) =>
    el('a', { className: 'hub-hero__tile', attrs: { href: productPath(g) } }, [thumb(g, g.name)]));
  return el('section', { className: 'hub-hero' }, [
    el('div', { className: 'hub-container hub-hero__inner' }, [
      el('div', { className: 'hub-hero__copy' }, [
        el('p', { className: 'hub-eyebrow', text: 'Free for makers · Licence for sellers' }),
        el('h1', { className: 'hub-hero__title', text: 'Make it yours, then print it.' }),
        el('p', {
          className: 'hub-hero__sub',
          text: 'Browser generators and MakerWorld models for keychains, boxes, signs, fidgets and laser cuts. Customise, download, print. No account needed.',
        }),
        el('div', { className: 'hub-actions' }, [
          linkButton({ label: 'Browse generators', href: '/make/', emphasis: 'primary' }),
          linkButton({ label: 'I sell prints', href: '/licences/', emphasis: 'secondary', icon: ICONS.arrowRight }),
        ]),
        el('p', { className: 'hub-hero__note', text: 'Runs in your browser · Personal use is free and fully functional · No watermark' }),
      ]),
      el('div', { className: 'hub-hero__tiles' }, tiles),
    ]),
  ]);
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
        el('p', { className: 'hub-topic__count', text: `${items.length} generator${items.length === 1 ? '' : 's'}` }),
      ]),
    ]));
  }));
}

const s = BRAND.pricing.subscription;
const l = BRAND.pricing.lifetime;

function checkList(items: string[]): HTMLElement {
  return el('ul', { className: 'hub-checks' }, items.map((text) =>
    el('li', {}, [svgEl(ICONS.check), text])));
}

/** "Printing for yourself or selling?": the one decision a visitor has to make. */
export function licenceDecision(): HTMLElement {
  return el('div', { className: 'hub-decision' }, [
    el('div', { className: 'hub-decision__side' }, [
      el('h3', { className: 'hub-decision__title', text: 'For yourself: free' }),
      checkList(['Every feature, every generator', 'No watermark, no account', 'Print as many as you like']),
      el('div', { className: 'hub-actions' }, [linkButton({ label: 'Start making', href: '/make/', emphasis: 'secondary' })]),
    ]),
    el('div', { className: 'hub-decision__side hub-decision__side--sell' }, [
      el('h3', { className: 'hub-decision__title', text: 'Selling the prints: licence' }),
      checkList([
        `Membership: the whole catalogue, from ${fmtPrice(s.month)}/month`,
        `Lifetime: one generator forever, ${fmtPrice(l.one)} once`,
        'Buy on MakerWorld or Buy Me a Coffee',
      ]),
      el('div', { className: 'hub-actions' }, [
        linkButton({ label: 'Compare licences', href: '/licences/', emphasis: 'cta' }),
        linkButton({ label: 'Which one do I need?', href: '/licences/#finder', emphasis: 'secondary' }),
      ]),
    ]),
  ]);
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

/** Name, badges, the one-line pitch and the longer explanation. */
export function productIntro(g: Generator): HTMLElement {
  const topics = g.topics.map((id) => topicById(id)).filter((t): t is Topic => Boolean(t));
  return el('div', { className: 'hub-intro' }, kids([
    el('div', { className: 'hub-badges' }, kids([
      isApp(g) ? badge('Web app', 'accent') : null,
      isMw(g) ? badge('On MakerWorld', 'accent') : null,
      ...topics.map((t) => el('a', { className: 'hub-badge hub-badge--link', text: t.name, attrs: { href: topicPath(t) } })),
      badge(g.process === 'laser' ? 'Laser' : '3D print'),
    ])),
    el('h1', { className: 'hub-intro__title', text: g.name }),
    el('p', { className: 'hub-intro__pitch', text: g.blurb }),
    // Paragraphs are separated by a blank line in the registry.
    ...(g.intro ?? '').split(/\n\s*\n/).filter(Boolean).map((p) => el('p', { className: 'hub-intro__text', text: p })),
  ]));
}

/** Everything about getting this design and selling what it makes, in one box beside the page. */
export function actionBox(g: Generator): HTMLElement {
  const app = appHref(g);
  const mw = mwHref(g);
  const lane = (label: string, price: string, href: string, external = false) =>
    el('a', { className: 'hub-lane', attrs: { href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) } }, [
      el('span', { text: label }),
      el('strong', { text: price }),
    ]);
  const lifetimeUrl = g.lifetimeLicence ? BRAND.urls[g.lifetimeLicence] : null;
  const formats = g.process === 'laser' ? 'SVG cut file' : '3MF';
  return el('aside', { className: 'hub-action-box' }, kids([
    el('div', { className: 'hub-badges' }, [badge('Free for personal use', 'accent')]),
    el('h2', { className: 'hub-action-box__title', text: g.name }),
    el('div', { className: 'hub-action-box__buttons' }, kids([
      app ? linkButton({ label: 'Open web app', href: app, emphasis: 'primary', block: true }) : null,
      mw ? linkButton({ label: 'Get it on MakerWorld ↗', href: mw, emphasis: app ? 'secondary' : 'primary', block: true, external: true }) : null,
      g.offlineUrl ? linkButton({ label: 'Download offline version', href: g.offlineUrl, emphasis: 'ghost', icon: ICONS.download, block: true }) : null,
    ])),
    el('hr', { className: 'hub-action-box__rule' }),
    el('h3', { className: 'hub-action-box__sub', text: 'Selling prints?' }),
    lane('Membership · all generators', `${fmtPrice(s.month)}/mo`, '/licences/#membership'),
    lifetimeUrl ? lane(`Lifetime · ${g.name} only`, fmtPrice(l.one), lifetimeUrl, true) : null,
    linkButton({ label: 'Get a commercial licence', href: '/licences/', emphasis: 'cta', block: true }),
    el('hr', { className: 'hub-action-box__rule' }),
    el('p', { className: 'hub-action-box__meta', text: app ? `${formats} · Runs in your browser` : `${formats} · Customise on MakerWorld` }),
  ]));
}

function block(title: string, content: Child[], id?: string): HTMLElement {
  return el('div', { className: 'hub-block', attrs: id ? { id } : {} }, kids([el('h2', { className: 'hub-block__title', text: title }), ...content]));
}

export function featureList(g: Generator): HTMLElement | null {
  if (!g.features?.length) return null;
  return block('Features', [el('ul', { className: 'hub-features' }, g.features.map((f) => {
    const [title, line] = typeof f === 'string' ? [f, ''] : f;
    return el('li', { className: 'hub-feature' }, [
      svgEl(ICONS.check),
      el('div', {}, kids([el('strong', { text: title }), line ? el('span', { text: line }) : null])),
    ]);
  }))]);
}

/** "Can I sell what I print?" in words, with the way to the licences. */
export function licenceBox(g: Generator): HTMLElement {
  const lifetime = g.lifetimeLicence
    ? `; a lifetime licence for ${g.name} covers this one forever, digital files included`
    : '';
  return block('Can I sell what I print?', [
    el('p', { className: 'hub-block__text', text: `Personal use is free and fully functional. To sell prints you need a commercial licence: the membership covers this and every other generator${lifetime}.` }),
    el('div', { className: 'hub-actions' }, [linkButton({ label: 'Compare licences', href: '/licences/', emphasis: 'secondary' })]),
    el('p', { className: 'hub-block__note' }, [
      'Every export carries an invisible provenance mark. It does not show on the print and never locks a feature. ',
      el('a', { text: 'What is this?', attrs: { href: '/faq/#licences' } }),
    ]),
  ], 'licence');
}

/** This generator's lines from news.ts. */
export function changelog(g: Generator): HTMLElement | null {
  const items = NEWS.filter((n) => n.generator === g.id);
  if (!items.length) return null;
  return block('What’s new', [el('ul', { className: 'hub-changelog' }, items.map((n) =>
    el('li', {}, [el('span', { className: 'hub-changelog__date', text: n.date }), el('span', { text: n.text })])))]);
}

/** The whole product page body: content on the left, the action box beside it. */
export function productLayout(g: Generator, related: HTMLElement | null): HTMLElement {
  return el('div', { className: 'hub-pdp' }, [
    el('div', { className: 'hub-pdp__top' }, [gallery(g), productIntro(g)]),
    actionBox(g),
    el('div', { className: 'hub-pdp__rest' }, kids([
      featureList(g),
      licenceBox(g),
      changelog(g),
      related ? block('You might also like', [related]) : null,
    ])),
  ]);
}

export function homeTopicOf(g: Generator): Topic | undefined {
  const first = g.topics[0];
  return first ? topicById(first) : undefined;
}

// ---------------------------------------------------------------------------
// Shared bands
// ---------------------------------------------------------------------------

/** Counts that come from the registry, so they are never out of date. */
export function statsStrip(): HTMLElement {
  const laser = live.filter((g) => g.process === 'laser').length;
  const stat = (n: number, label: string) =>
    el('div', { className: 'hub-stat' }, [el('strong', { text: String(n) }), el('span', { text: label })]);
  return el('div', { className: 'hub-stats' }, [
    stat(live.length, 'generators live'),
    stat(webApps.length, 'run in your browser'),
    stat(mwOnly.length + webApps.filter(isMw).length, 'on MakerWorld'),
    stat(laser, 'for laser cutting'),
  ]);
}

/** "New this month": the latest three items of news.ts. */
export function whatsNew(): HTMLElement | null {
  const items = NEWS.slice(0, 3).flatMap((n) => {
    const g = live.find((x) => x.id === n.generator);
    if (!g) return [];
    return [el('a', { className: 'hub-news', attrs: { href: productPath(g) } }, [
      el('span', { className: `hub-badge${n.kind === 'New' ? ' hub-badge--accent' : ''}`, text: n.kind }),
      el('h3', { className: 'hub-news__title', text: g.name }),
      el('p', { className: 'hub-news__text', text: n.text }),
    ])];
  });
  return items.length ? el('div', { className: 'hub-news-grid' }, items) : null;
}

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

/** On a phone the action box scrolls away, so the main action and the licence stay pinned. */
export function mobileActionBar(g: Generator): HTMLElement {
  const app = appHref(g);
  const mw = mwHref(g);
  return el('div', { className: 'hub-mobile-bar' }, kids([
    app ? linkButton({ label: 'Open app', href: app, emphasis: 'primary' })
      : mw ? linkButton({ label: 'MakerWorld ↗', href: mw, emphasis: 'primary', external: true }) : null,
    linkButton({ label: 'Licence', href: '/licences/', emphasis: 'secondary' }),
  ]));
}
