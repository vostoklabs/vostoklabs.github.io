// The frame every page shares: the rail down the left with the menu, and the footer.

import { BRAND } from '@vostok/brand';
import { el, navRail, supportLinks, svgEl, ICONS } from '@vostok/ui-kit';
import { TOPICS, topicPath } from './content';

// Inline so it inherits currentColor for theming.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 568.55431 524.21602" fill="none" stroke="currentColor" stroke-width="16.551" role="img" aria-label="Vostok Labs" class="hub-logo-svg" width="28" height="26">
  <path d="M385.471,8.276 h171.043 l-194.874,507.665 h-165.99 l82.995,-229.373 z"/>
  <path d="M255.292,225.733 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M208.588,104.064 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M152.519,8.276 l-73.63,203.492 l-23.352,-60.835 l51.618,-142.657 z"/>
  <path d="M61.79,8.276 l-29.606,81.823 l-23.352,-60.835 l7.594,-20.988 z"/>
</svg>`;

/** The section a path belongs to, as its rail item's address. */
function sectionOf(path: string): string | undefined {
  if (path.startsWith('/make/') || path.startsWith('/generators/')) return '/make/';
  if (path.startsWith('/licences/')) return '/licences/';
  if (path.startsWith('/faq/')) return '/faq/';
  return undefined;
}

/** The menu: the generators' left rail, with the logo and the name on top and the studio's
 *  other homes at the foot. `current` is the page's path. */
export function rail(current: string): HTMLElement {
  const logo = el('a', { className: 'hub-rail__logo', attrs: { href: '/', 'aria-label': `${BRAND.name} home` } }, [
    svgEl(LOGO_SVG),
    el('span', { className: 'hub-rail__name', text: BRAND.name, attrs: { 'aria-hidden': 'true' } }),
  ]);
  // A link whose address is still a placeholder in brand.ts is left out, as supportLinks() does.
  const away = [
    { href: BRAND.urls.makerworld, label: 'MakerWorld', icon: ICONS.zap, title: `${BRAND.name} on MakerWorld`, external: true },
    { href: BRAND.urls.buyMeACoffee, label: 'Coffee', icon: ICONS.coffee, title: 'Buy me a coffee', external: true },
  ].filter((item) => !item.href.startsWith('TODO'));
  return navRail({
    leading: [logo],
    items: [
      { href: '/make/', label: 'Generators', icon: ICONS.grid, divider: true },
      { href: '/licences/', label: 'Licences', icon: ICONS.license },
      { href: '/faq/', label: 'FAQ', icon: ICONS.help },
    ],
    trailing: away,
    current: sectionOf(current),
    size: 'large',
    className: 'hub-rail',
  });
}

function footerColumn(title: string, items: [string, string][]): HTMLElement {
  return el('div', { className: 'hub-footer__col' }, [
    el('h2', { className: 'hub-footer__heading', text: title }),
    el('ul', { className: 'hub-footer__list' }, items.map(([label, href]) =>
      el('li', {}, [el('a', { text: label, attrs: { href } })]))),
  ]);
}

export function footer(): HTMLElement {
  const year = new Date().getFullYear();
  return el('footer', { className: 'hub-footer' }, [
    el('div', { className: 'hub-container' }, [
      el('div', { className: 'hub-footer__cols' }, [
        el('div', { className: 'hub-footer__col hub-footer__about' }, [
          el('h2', { className: 'hub-footer__heading', text: BRAND.name }),
          el('p', { className: 'hub-footer__line', text: 'Generators for things you print and cut. Free for personal use.' }),
          supportLinks(),
        ]),
        footerColumn('Generators', [
          ['Web apps', '/make/#web-apps'],
          ['On MakerWorld', '/make/#makerworld'],
          ['Coming soon', '/make/#coming-soon'],
        ]),
        footerColumn('Make', TOPICS.map((t) => [t.name, topicPath(t)])),
        footerColumn('Info', [
          ['Licences', '/licences/'],
          ['Questions', '/faq/'],
        ]),
      ]),
      el('p', { className: 'hub-footer__copy', text: `© ${year} ${BRAND.name}. ${BRAND.freeTierLine}` }),
    ]),
  ]);
}
