// The frame every page shares: the header with its menu, and the footer.

import { BRAND } from '@vostok/brand';
import { el, iconButton, linkButton, supportLinks, svgEl, textField, ICONS } from '@vostok/ui-kit';
import { TOPICS, topicPath } from './content';

// Inline so it inherits currentColor for theming.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 568.55431 524.21602" fill="none" stroke="currentColor" stroke-width="16.551" role="img" aria-label="Vostok Labs" class="hub-logo-svg" width="28" height="26">
  <path d="M385.471,8.276 h171.043 l-194.874,507.665 h-165.99 l82.995,-229.373 z"/>
  <path d="M255.292,225.733 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M208.588,104.064 l-82.995,229.373 l-23.352,-60.835 l82.995,-229.373 z"/>
  <path d="M152.519,8.276 l-73.63,203.492 l-23.352,-60.835 l51.618,-142.657 z"/>
  <path d="M61.79,8.276 l-29.606,81.823 l-23.352,-60.835 l7.594,-20.988 z"/>
</svg>`;

const NAV: [label: string, href: string][] = [
  ['Generators', '/make/'],
  ['Licences', '/licences/'],
];
const NAV_QUIET: [label: string, href: string][] = [
  ['FAQ', '/faq/'],
];

/** `current` is the page's path, so its section is marked in the nav. */
export function header(current: string): HTMLElement {
  const logo = el('a', { className: 'hub-nav__logo', attrs: { href: '/', 'aria-label': 'Vostok Labs home' } }, [
    svgEl(LOGO_SVG),
    el('span', { className: 'hub-nav__logo-text', text: BRAND.name }),
  ]);

  const link = ([label, href]: [string, string], quiet = false) => {
    const a = el('a', { className: `hub-nav__link${quiet ? ' hub-nav__link--quiet' : ''}`, text: label, attrs: { href } });
    const here = href === '/make/' ? current.startsWith('/make/') || current.startsWith('/generators/') : current.startsWith(href);
    if (here) a.setAttribute('aria-current', 'page');
    return a;
  };
  const links = el('nav', { className: 'hub-nav__links', attrs: { 'aria-label': 'Main' } }, [
    ...NAV.map((item) => link(item)),
    el('span', { className: 'hub-nav__sep', attrs: { 'aria-hidden': 'true' } }),
    ...NAV_QUIET.map((item) => link(item, true)),
  ]);
  // Enter takes the words to the catalogue (the script does that); the catalogue filters by them.
  const search = textField({ label: 'Search generators', type: 'search', placeholder: 'Search generators…' });
  search.classList.add('hub-nav__search');
  search.setAttribute('data-nav-search', '');

  const cta = linkButton({ label: 'Selling prints?', href: '/licences/', emphasis: 'cta' });
  // The script opens and closes the menu; without it the links still sit in the page.
  const toggle = iconButton({ icon: ICONS.menu, label: 'Menu', className: 'hub-nav__toggle' });
  toggle.setAttribute('data-nav-toggle', '');
  toggle.setAttribute('aria-expanded', 'false');

  const inner = el('div', { className: 'hub-nav__inner hub-container' }, [
    logo,
    el('div', { className: 'hub-nav__menu' }, [links, el('div', { className: 'hub-nav__end' }, [search, cta])]),
    toggle,
  ]);
  return el('header', { className: 'hub-nav' }, [inner]);
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
