import { BRAND } from '@vostok/brand';
import { el } from '../dom';
import { ICONS, svgEl } from '../icons';

/** Ko-fi / MakerWorld / GitHub links as one styled row, URLs from @vostok/brand.
 *  Entries whose URL is still a TODO placeholder are skipped automatically. */
export function supportLinks(): HTMLElement {
  const entries: [icon: string, label: string, url: string][] = [
    [ICONS.coffee, 'Ko-fi', BRAND.urls.kofi],
    [ICONS.zap, 'MakerWorld', BRAND.urls.makerworld],
    [ICONS.github, 'GitHub', BRAND.urls.github],
  ];
  const root = el('div', { className: 'vl-support' });
  for (const [icon, label, url] of entries) {
    if (url.startsWith('TODO')) continue;
    const a = el('a', { attrs: { href: url, target: '_blank', rel: 'noopener' } });
    a.append(svgEl(icon), label);
    root.append(a);
  }
  return root;
}
