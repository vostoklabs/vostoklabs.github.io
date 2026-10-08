/*
  navRail(): the tool rail as a site's menu, in the stand-in document (support/mini-dom.ts).

  Every item is a link, so a page rendered ahead of time navigates with no script; the page
  being shown is marked current, and only that one. It wears the tool rail's own classes, so the
  hub's menu and a generator's rail cannot drift apart. An item for another site opens in a new
  tab; nothing else does.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { navRail } from '../src/components/editor-shell';
import { ICONS } from '../src/icons';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const logo = document.createElement('a');
logo.setAttribute('href', '/');
const rail = navRail({
  leading: [logo],
  items: [
    { href: '/make/', label: 'Generators', icon: ICONS.grid },
    { href: '/licences/', label: 'Licences', icon: ICONS.license },
    { href: '/faq/', label: 'FAQ', icon: ICONS.help, divider: true },
  ],
  trailing: [{ href: '/licences/#finder', label: 'Sell', icon: ICONS.license, title: 'Selling prints?' }],
  current: '/licences/',
  className: 'hub-rail',
});

const kids = [...rail.children] as HTMLElement[];
const links = kids.filter((k) => k.classList.contains('vl-tool-rail__btn'));

check('is a nav landmark', rail.tagName === 'NAV', rail.tagName);
check('named Main by default', rail.getAttribute('aria-label') === 'Main', rail.getAttribute('aria-label') ?? '');
check('wears the tool rail look', rail.classList.contains('vl-tool-rail') && rail.classList.contains('vl-tool-rail--nav'), rail.className);
check('placement class kept', rail.classList.contains('hub-rail'), rail.className);
check('the logo comes first', kids[0] === logo);
check('every item is a link', links.length === 4 && links.every((a) => a.tagName === 'A'), links.map((a) => a.tagName).join(','));
check('each goes to its page', links.map((a) => a.getAttribute('href')).join(' ') === '/make/ /licences/ /faq/ /licences/#finder');
check('icon over label', links.every((a) => {
  const html = a.outerHTML;
  return html.includes('<svg') && html.indexOf('<svg') < html.indexOf('vl-tool-rail__label');
}));
check('reads its label', links[0]!.textContent === 'Generators', links[0]!.textContent ?? '');

const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
check('one page is current', current.length === 1, String(current.length));
check('the current one is the page shown', current[0]?.getAttribute('href') === '/licences/');
check('the current one is lit', current[0]?.classList.contains('is-active') === true);
check('the others are not lit', links.filter((a) => a.classList.contains('is-active')).length === 1);

check('a divider sits above its item', kids[kids.indexOf(links[2]!) - 1]?.classList.contains('vl-tool-rail__rule') === true);
check('trailing items sit after the gap', kids[kids.indexOf(links[3]!) - 1]?.classList.contains('vl-tool-rail__gap') === true);
check('no tooltip unless asked', !links[0]!.hasAttribute('title') && links[3]!.getAttribute('title') === 'Selling prints?');

const bare = navRail({ items: [{ href: '/', label: 'Home', icon: ICONS.grid }], label: 'Site' });
check('names itself when asked', bare.getAttribute('aria-label') === 'Site');
check('nothing current when no page matches', !bare.querySelector('[aria-current]'));

check('the usual size by default', !rail.classList.contains('vl-tool-rail--large'));
check('same tab by default', links.every((a) => !a.hasAttribute('target') && !a.hasAttribute('rel')));

const site = navRail({
  items: [{ href: '/make/', label: 'Generators', icon: ICONS.grid }],
  trailing: [{ href: 'https://example.com/', label: 'Elsewhere', icon: ICONS.coffee, external: true }],
  size: 'large',
});
const siteLinks = [...site.children].filter((k) => k.tagName === 'A');
const out = siteLinks.find((a) => a.getAttribute('href') === 'https://example.com/');
const inside = siteLinks.find((a) => a.getAttribute('href') === '/make/');
check('large when asked', site.classList.contains('vl-tool-rail--large'), site.className);
check('external opens a new tab', out?.getAttribute('target') === '_blank');
check('external never hands over the opener', out?.getAttribute('rel') === 'noopener noreferrer', out?.getAttribute('rel') ?? '');
check('an inside link stays in the tab', inside !== undefined && !inside.hasAttribute('target'));

console.log(`\nnav-rail: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
