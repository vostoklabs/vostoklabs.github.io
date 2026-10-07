import { BRAND } from '@vostok/brand';
import { el } from '../dom';
import { ICONS, svgEl } from '../icons';
import { themeToggleButton } from './theme';
import { isDesktop, renderNothing } from '../host-env';
import { button } from './button';
import { openLicenceOffer } from './lifetime-licence';

/** A lifetime commercial licence sold off-site, offered from the middle of the topbar. */
export interface TopbarLifetimeLicence {
  /** The generator's display name, e.g. 'Clicker Generator'. */
  product: string;
  /** The store page the licence is bought on, from @vostok/brand. */
  href: string;
  /** Short rights, most-exclusive first, as `openLicenceOffer()` takes them. */
  terms: string[];
}

export interface TopbarLinksOptions {
  /** @deprecated Ignored: the GitHub button became "See all generators". */
  githubUrl?: string;
  /** This generator's own MakerWorld listing for the green Boost button.
   *  Omit to fall back to the profile. */
  boostUrl?: string;
  /** Add a light/dark theme toggle button. It flips <html data-theme> and
   *  persists the choice; observe data-theme in the app to re-theme the viewer. */
  themeToggle?: boolean;
  /** localStorage key used by the theme toggle (default 'vl-theme'). */
  themeStorageKey?: string;
  /** Put a "Get Lifetime Commercial License" button in the middle of the bar. Omit for
   *  none: the bar stays two groups, exactly as before. */
  lifetimeLicence?: TopbarLifetimeLicence;
}

function linkBtn(
  variant: '' | 'license' | 'mw' | 'coffee',
  icon: string,
  label: string,
  href: string,
): HTMLAnchorElement {
  const a = el('a', {
    className: `vl-topbar-btn${variant ? ` vl-topbar-btn--${variant}` : ''}`,
    attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
  });
  a.append(svgEl(icon), label);
  return a;
}

/** The offer behind the centre button. The licence is bought and delivered on the store, so
 *  "buy" only opens it; nothing in the app changes after a purchase. */
function openStoreOffer(l: TopbarLifetimeLicence): void {
  openLicenceOffer({
    title: `${l.product} lifetime commercial license`,
    terms: l.terms,
    footNote: 'Bought on Buy Me a Coffee. The license document comes with your purchase: '
      + 'keep it with your receipt.',
    buyLabel: 'Buy on Buy Me a Coffee',
    onBuy: () => {
      // Inside the click that closed the dialog, so the browser treats it as user-initiated.
      window.open(l.href, '_blank', 'noopener,noreferrer');
      return Promise.resolve(false);
    },
  });
}

/** The standard Vostok topbar: "See all generators" + red commercial license on the left,
 *  "Donate:" + green MakerWorld boost + red Buy me a coffee on the right, and optionally a
 *  lifetime licence offer in the middle. */
export function topbarLinks(opts: TopbarLinksOptions = {}): HTMLElement {
  // The host app owns its own chrome; a second nav bar inside it is noise.
  if (isDesktop()) return renderNothing();
  const rightGroup = el('div', { className: 'vl-topbar-group vl-topbar-group--end' }, [
    el('span', { className: 'vl-donate-label', text: 'Donate:' }),
    linkBtn('mw', ICONS.zap, 'Boost on MakerWorld', opts.boostUrl ?? BRAND.urls.makerworld),
    linkBtn('coffee', ICONS.coffee, 'Buy me a coffee', BRAND.urls.buyMeACoffee),
  ]);

  if (opts.themeToggle) {
    rightGroup.append(themeToggleButton({
      storageKey: opts.themeStorageKey ?? 'vl-theme',
      className: 'vl-topbar-btn vl-topbar-btn--theme',
    }));
  }

  const leftGroup = el('div', { className: 'vl-topbar-group' }, [
    linkBtn('', ICONS.grid, 'See all generators', BRAND.urls.hub),
    linkBtn('license', ICONS.license, 'Get commercial license', BRAND.urls.mwCommercial),
  ]);

  const licence = opts.lifetimeLicence;
  if (!licence) return el('header', { className: 'vl-topbar' }, [leftGroup, rightGroup]);

  const centre = el('div', { className: 'vl-topbar-group vl-topbar-group--centre' }, [
    button({
      label: 'Get Lifetime Commercial License',
      emphasis: 'cta',
      icon: ICONS.license,
      title: `${licence.product}: sell what you make, one payment`,
      onClick: () => openStoreOffer(licence),
    }),
  ]);
  return el('header', { className: 'vl-topbar vl-topbar--centred' }, [leftGroup, centre, rightGroup]);
}
