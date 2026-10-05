// The symbol font on its own: Material Symbols at FILL=1, the face the text engine falls back to
// for a symbol typed into the text, with the symbol library drawn from it.
//
// For an app that draws symbols without the typefaces: the front door of this package globs
// every face, so importing it puts all of them in the build, where this loads the one file.
// Both doors keep their parsed fonts in one place, so a page that uses both parses the symbol
// font once.
import * as opentype from 'opentype.js';
import { FALLBACK_FONT_ID, parsedFonts } from './cache';

const files = (import.meta as any).glob('./fonts/icon-fallback.ttf', { eager: true, import: 'default' }) as Record<string, string>;

/** The symbol font's file, as this build serves it. */
export const iconFontUrl: string | undefined = files['./fonts/icon-fallback.ttf'];

let loading: Promise<any> | null = null;

/** The parsed symbol font, fetched once per page whichever door of this package asks first. */
export async function getIconFont(): Promise<any> {
  const have = parsedFonts.get(FALLBACK_FONT_ID);
  if (have) return have;
  if (!iconFontUrl) throw new Error('The symbol font is not in this build.');
  loading ??= (async () => {
    const r = await fetch(iconFontUrl);
    if (!r.ok) throw new Error('Fetch failed for the symbol font');
    const font = opentype.parse(await r.arrayBuffer());
    parsedFonts.set(FALLBACK_FONT_ID, font);
    return font;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export { FALLBACK_FONT_ID };
export { ICONS, ICON_CATEGORIES, searchIcons, iconById, iconByChar, type IconChoice, type IconCategory } from './icons';
export { POPULAR_IDS, POPULAR, QUICK_PICKS, SYMBOL_GROUPS, searchGroup, type SymbolGroup } from './symbolGroups';
