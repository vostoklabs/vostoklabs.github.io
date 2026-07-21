import { BRAND } from '@vostok/brand';
import { el } from '../dom';
import { ICONS, svgEl } from '../icons';
import { themeToggleButton } from './theme';

export interface TopbarLinksOptions {
  /** This app's GitHub repo (defaults to the org). */
  githubUrl?: string;
  /** This generator's own MakerWorld listing for the green Boost button.
   *  Omit to fall back to the profile. */
  boostUrl?: string;
  /** Add a light/dark theme toggle button. It flips <html data-theme> and
   *  persists the choice; observe data-theme in the app to re-theme the viewer. */
  themeToggle?: boolean;
  /** localStorage key used by the theme toggle (default 'vl-theme'). */
  themeStorageKey?: string;
}

function linkBtn(
  variant: '' | 'license' | 'mw' | 'kofi',
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


/** The standard Vostok topbar: GitHub + red commercial license on the left,
 *  "Donate:" + green MakerWorld boost + red Ko-fi on the right.
 *  Same structure and colors as the shipped clicker app. */
export function topbarLinks(opts: TopbarLinksOptions = {}): HTMLElement {
  const rightGroup = el('div', { className: 'vl-topbar-group' }, [
    el('span', { className: 'vl-donate-label', text: 'Donate:' }),
    linkBtn('mw', ICONS.zap, 'Boost on MakerWorld', opts.boostUrl ?? BRAND.urls.makerworld),
    linkBtn('kofi', ICONS.coffee, 'Ko-fi', BRAND.urls.kofi),
  ]);

  if (opts.themeToggle) {
    rightGroup.append(themeToggleButton({
      storageKey: opts.themeStorageKey ?? 'vl-theme',
      className: 'vl-topbar-btn vl-topbar-btn--theme',
    }));
  }

  return el('header', { className: 'vl-topbar' }, [
    el('div', { className: 'vl-topbar-group' }, [
      linkBtn('', ICONS.github, 'View on GitHub', opts.githubUrl ?? BRAND.urls.github),
      linkBtn('license', ICONS.license, 'Get commercial license', BRAND.urls.mwCommercial),
    ]),
    rightGroup,
  ]);
}
