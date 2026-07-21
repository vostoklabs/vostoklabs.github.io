// Vostok Labs Hub — main entry point.
// Renders the full landing page: nav, hero, generators, seller tools, license, footer.

import '@vostok/ui-kit/styles.css';
import './hub.css';

import { BRAND } from '@vostok/brand';
import { el, openCommercialModal, segmentedControl, supportLinks, ICONS, svgEl } from '@vostok/ui-kit';
import registryData from '../../../generators.json';
import type { Registry } from './registry';
import { generatorCard, sellerToolCard } from './cards';

const registry = registryData as unknown as Registry;

// Inline the logo SVG so it inherits currentColor for theming.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 568.55431 524.21602" fill="none" stroke="currentColor" stroke-width="16.551" role="img" aria-label="Vostok Labs" class="hub-logo-svg">
  <path d="M385.471,8.276 h171.043 l-194.874,507.665 h-165.99 l82.995,-229.373 z"/>
  <path d="M255.292,225.733 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M208.588,104.064 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M152.519,8.276 l-73.63,203.492 l-23.352,-60.835 l51.618,-142.657 z"/>
  <path d="M61.79,8.276 l-29.606,81.823 l-23.352,-60.835 l7.594,-20.988 z"/>
</svg>`;

function parseSvg(raw: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = raw.trim();
  return tpl.content.firstElementChild!;
}

const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;

// ---------------------------------------------------------------------------
// NAV
// ---------------------------------------------------------------------------
function buildNav(): HTMLElement {
  const logoLink = el('a', {
    className: 'hub-nav__logo',
    attrs: { href: '/', 'aria-label': 'Vostok Labs home' },
  });
  logoLink.append(parseSvg(LOGO_SVG));
  logoLink.append(el('span', { className: 'hub-nav__logo-text', text: 'Vostok Labs' }));

  const links = el('nav', { className: 'hub-nav__links' }, [
    el('a', { className: 'hub-nav__link', text: 'Generators', attrs: { href: '#generators', 'data-filter': 'all' } }),
    // Seller tools live inside the combined catalog; this jumps there and flips
    // the category filter to Tools (handled by the anchor click delegate).
    el('a', { className: 'hub-nav__link', text: 'Seller Tools', attrs: { href: '#generators', 'data-filter': 'tools' } }),
    el('a', { className: 'hub-nav__link', text: 'Pricing', attrs: { href: '#licensing' } }),
  ]);

  // Same behavior as the app topbar's commercial button: open the kit's
  // two-lane license modal rather than jumping straight off-site.
  const cta = el('button', {
    className: 'hub-nav__cta',
    text: 'Get Commercial License',
    attrs: { type: 'button' },
    on: { click: () => openCommercialModal() },
  });

  const inner = el('div', { className: 'hub-nav__inner hub-container' }, [logoLink, links, cta]);
  return el('header', { className: 'hub-nav' }, [inner]);
}

// ---------------------------------------------------------------------------
// HERO
// ---------------------------------------------------------------------------
function buildHero(): HTMLElement {
  const eyebrow = el('p', {
    className: 'hub-hero__eyebrow',
    text: 'Free for makers · License for sellers',
  });

  const title = el('h1', { className: 'hub-hero__title' });
  title.innerHTML = 'Free 3D Print <em>Generators</em>';

  const sub = el('p', {
    className: 'hub-hero__sub',
    text: 'Parametric model generators for makers and sellers. Customize, download, print. No account needed.',
  });

  const licenseLink = el('a', {
    className: 'vl-btn vl-btn--secondary hub-hero__license-btn',
    text: 'See commercial licensing',
    attrs: { href: '#licensing' },
  });

  const actions = el('div', { className: 'hub-hero__actions' }, [
    el('a', {
      className: 'vl-btn vl-btn--primary',
      text: 'Browse generators ↓',
      attrs: { href: '#generators' },
    }),
    licenseLink,
  ]);

  return el('section', { className: 'hub-hero' }, [
    el('div', { className: 'hub-container' }, [
      el('div', { className: 'hub-hero__inner' }, [eyebrow, title, sub, actions]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// CATALOG — generators + seller tools in one grid, filtered by category.
// The category switch is a per-item axis, distinct from the header's page-nav.
// ---------------------------------------------------------------------------
type Category = 'all' | 'app' | 'mw' | 'tools';

function buildCatalog(): HTMLElement {
  // Seller tools from the registry, with upcoming ones as a fallback.
  const tools = registry.sellerTools.length > 0
    ? registry.sellerTools
    : [
        { id: 'profit-calc', name: 'Profit Calculator', status: 'coming-soon' as const, blurb: '3D print pricing: material, time, margin, all in one.' },
        { id: 'photo-render', name: 'Product Photo Tool', status: 'coming-soon' as const, blurb: 'Upload your model, get store-ready product shots.' },
        { id: 'listing-copy', name: 'Listing Copy Helper', status: 'coming-soon' as const, blurb: 'Generate Etsy & MakerWorld titles, tags, and descriptions.' },
        { id: 'review-qr', name: 'Review QR Cards', status: 'coming-soon' as const, blurb: '"Scan to leave a review" cards to include with shipments.' },
      ];

  const grid = el('div', { className: 'hub-grid' });

  // Current filter state: category (segmented control) + free-text search.
  let activeCat: Category = 'all';
  let query = '';

  const matches = (...fields: (string | undefined)[]) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return fields.some((f) => f && f.toLowerCase().includes(q));
  };

  // Empty-state shown when a search matches nothing.
  const emptyState = el('p', {
    className: 'hub-grid__empty',
    text: 'No generators or tools match your search.',
  });

  // Re-render the grid for the chosen category + search query.
  const render = () => {
    grid.replaceChildren();
    let count = 0;
    if (activeCat !== 'tools') {
      for (const gen of registry.generators) {
        const isApp = gen.route === 'app' || gen.route === 'both';
        const isMw = gen.route === 'mw' || gen.route === 'both';
        const inCat = activeCat === 'all' || (activeCat === 'app' && isApp) || (activeCat === 'mw' && isMw);
        if (inCat && matches(gen.name, gen.blurb)) {
          grid.append(generatorCard(gen));
          count++;
        }
      }
    }
    if (activeCat === 'all' || activeCat === 'tools') {
      for (const tool of tools) {
        if (matches(tool.name, tool.blurb)) {
          grid.append(sellerToolCard(tool));
          count++;
        }
      }
    }
    if (count === 0) grid.append(emptyState);
  };

  const filter = el('div', { className: 'hub-catalog__filter', attrs: { id: 'catalog-filter' } }, [
    segmentedControl<Category>({
      value: 'all',
      onChange: (cat) => { activeCat = cat; render(); },
      options: [
        { value: 'all', label: 'All' },
        { value: 'app', label: 'Web App' },
        { value: 'mw', label: 'MakerWorld' },
        { value: 'tools', label: 'Tools' },
      ],
    }),
  ]);

  // Search box: filters visible cards by name/blurb, live as you type.
  const searchInput = el('input', {
    className: 'hub-search__input',
    attrs: {
      type: 'search',
      placeholder: 'Search generators & tools…',
      'aria-label': 'Search generators and tools',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  }) as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim();
    render();
  });
  const search = el('div', { className: 'hub-search' }, [
    svgEl(ICONS.search),
    searchInput,
  ]);

  render();

  return el('section', {
    className: 'hub-section',
    attrs: { id: 'generators' },
  }, [
    el('div', { className: 'hub-container' }, [
      el('div', { className: 'hub-catalog__head' }, [
        el('div', { className: 'hub-catalog__headings' }, [
          el('h2', { className: 'hub-section__title', text: 'Generators' }),
          el('p', {
            className: 'hub-section__desc',
            text: 'Free for personal use. Filter by where each one runs.',
          }),
        ]),
        el('div', { className: 'hub-catalog__controls' }, [search, filter]),
      ]),
      grid,
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// LICENSE / PRICING
// ---------------------------------------------------------------------------
function pricingFeature(text: string): HTMLElement {
  const li = el('li');
  li.append(svgEl(ICONS.check), text);
  return li;
}

// A single lifetime-license price tier: bold "$X for N designs" on one line.
function lifetimeTier(price: string, count: string): HTMLElement {
  return el('li', { className: 'hub-pricing__tier' }, [
    el('span', { className: 'hub-pricing__tier-price', text: price }),
    el('span', { className: 'hub-pricing__tier-count', text: `for ${count}` }),
  ]);
}

function buildLicensing(): HTMLElement {
  const s = BRAND.pricing.subscription;
  const l = BRAND.pricing.lifetime;

  const subCard = el('div', { className: 'hub-pricing__card hub-pricing__card--featured' }, [
    el('span', { className: 'hub-pricing__label', text: 'Subscription' }),
    el('div', { className: 'hub-pricing__price', text: `${fmt(s.month)}/mo` }),
    el('p', { className: 'hub-pricing__desc', text: `Or ${fmt(s.quarter)}/quarter · ${fmt(s.year)}/year` }),
    el('ul', { className: 'hub-pricing__features' }, [
      pricingFeature(`Covers ${s.covers}`),
      pricingFeature('Sell prints on Etsy, fairs, your own shop'),
      pricingFeature('Valid while membership is active'),
      pricingFeature('Cancel anytime'),
    ]),
    el('a', {
      className: 'vl-btn vl-btn--primary vl-btn--block hub-pricing__cta',
      text: 'Get Commercial License →',
      attrs: { href: BRAND.urls.mwCommercial, target: '_blank', rel: 'noopener noreferrer' },
    }),
  ]);

  // Inner lifetime card: just the header + features + CTA.
  const lifeCard = el('div', { className: 'hub-pricing__card' }, [
    el('span', { className: 'hub-pricing__label', text: 'Lifetime License' }),
    el('div', { className: 'hub-pricing__price', text: `From ${fmt(l.one)}` }),
    el('ul', { className: 'hub-pricing__features' }, [
      pricingFeature('One-time payment, yours forever'),
      pricingFeature('Sell prints with no recurring fees'),
      pricingFeature('Flexible scope, set at purchase'),
    ]),
    el('a', {
      className: 'vl-btn vl-btn--secondary vl-btn--block hub-pricing__cta',
      text: 'Get License →',
      attrs: { href: BRAND.urls.mwCommercial, target: '_blank', rel: 'noopener noreferrer' },
    }),
  ]);

  // One big block that wraps the lifetime card + tiers/info side-by-side
  // into a single visual unit beside the subscription card.
  const lifetimeInfo = el('div', { className: 'hub-pricing__lifetime-info' }, [
    el('ul', { className: 'hub-pricing__tiers' }, [
      lifetimeTier(fmt(l.one), '1 design'),
      lifetimeTier(fmt(l.three), '3 designs'),
      lifetimeTier(fmt(l.twelve), '12 designs'),
    ]),
    el('h3', { className: 'hub-pricing__explain-title', text: 'How lifetime licensing works' }),
    el('p', {
      className: 'hub-pricing__explain-text',
      text: 'Own specific designs outright with a single payment, no subscription. A "design" is any one generator, model, app, or seller tool of your choice.',
    }),
  ]);

  const lifetimeGroup = el('div', { className: 'hub-pricing__lifetime-group' }, [
    lifeCard,
    lifetimeInfo,
  ]);

  const freeLine = el('p', { className: 'hub-pricing__free' });
  freeLine.append(
    el('strong', { text: 'Personal use is free.' }),
    ' You can download and print as many models as you like. A commercial license is only required if you sell the physical prints.',
  );

  return el('section', {
    className: 'hub-section',
    attrs: { id: 'licensing' },
  }, [
    el('div', { className: 'hub-container' }, [
      el('div', { className: 'hub-section__header' }, [
        el('h2', { className: 'hub-section__title', text: 'Commercial Licensing' }),
        el('p', {
          className: 'hub-section__desc',
          text: 'Sell what you print. Two paths: rent the catalog or own it outright.',
        }),
      ]),
      el('div', { className: 'hub-pricing__wrap' }, [
        subCard,
        lifetimeGroup,
      ]),
      freeLine,
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// FOOTER
// ---------------------------------------------------------------------------
function buildFooter(): HTMLElement {
  const year = new Date().getFullYear();

  const supportBanner = el('div', { className: 'hub-footer__support' }, [
    el('h3', { className: 'hub-footer__support-title', text: 'Support the Designer' }),
    el('p', {
      className: 'hub-footer__support-desc',
      text: 'Vostok Labs provides free parametric models for the maker community. If you find these tools useful, please consider supporting the project by donating on Ko-fi or boosting our models on MakerWorld.',
    }),
    supportLinks(),
  ]);

  const copy = el('p', {
    className: 'hub-footer__copy',
    text: `© ${year} Vostok Labs. Free for personal use (CC BY-NC-ND 4.0).`,
  });

  return el('footer', { className: 'hub-footer' }, [
    el('div', { className: 'hub-footer__inner hub-container' }, [
      supportBanner,
      el('hr', { className: 'hub-footer__divider' }),
      copy,
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
function init() {
  const app = document.getElementById('app')!;
  app.className = 'hub-page';

  app.append(
    buildNav(),
    buildHero(),
    buildCatalog(),
    buildLicensing(),
    buildFooter(),
  );

  // Smooth scroll for anchor links
  app.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      e.preventDefault();
      const id = anchor.getAttribute('href')!.slice(1);
      // A link may also flip the catalog category filter (e.g. "Seller Tools"
      // → Tools). Click the matching segmented-control tab so its state stays
      // in sync with the grid.
      const filter = anchor.getAttribute('data-filter');
      if (filter) {
        const label = filter === 'tools' ? 'Tools' : filter;
        const tab = Array.from(
          document.querySelectorAll<HTMLButtonElement>('#catalog-filter .vl-tab'),
        ).find((b) => b.textContent?.trim().toLowerCase() === label.toLowerCase());
        tab?.click();
      }
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

init();
