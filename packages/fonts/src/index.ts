// The shared font set: one registry, one loader, one text-to-contours path for
// every generator that puts type on a model.
//
// Offline bundles: the .ttf files are referenced through `import.meta.glob` as
// asset URLs, so each app's own `vite build` emits its own copy into its own
// dist/. Sharing the source here dedupes the repo without coupling the outputs —
// shipping one generator offline is still a straight copy of its dist/.
/// <reference path="./declarations.d.ts" />
import * as opentype from 'opentype.js';

export { FONTS, type FontChoice } from './registry';
export * from './textLayout';

import { FONTS, type FontChoice } from './registry';

/** CSS font-family prefix for the @font-face rules in `@vostok/fonts/fonts.css`.
 *  Used for HTML previews only — the 3D geometry comes from opentype. */
export const FONT_FAMILY_PREFIX = 'VL-';

/** The CSS family name to preview `fontId` with. */
export const fontFamilyFor = (fontId: string): string => `${FONT_FAMILY_PREFIX}${fontId}`;


// Vite resolves this glob relative to THIS file, so it works from any app that
// consumes the package as source. `import: 'default'` yields URLs, not bytes —
// the fonts stay out of the JS bundle and are fetched only when used.
const fontUrls = (import.meta as any).glob('./fonts/*.ttf', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const fontUrlById: Record<string, string> = Object.entries(fontUrls).reduce(
  (acc, [path, url]) => {
    acc[path.replace('./fonts/', '').replace('.ttf', '')] = url;
    return acc;
  },
  {} as Record<string, string>,
);

/** Get the URL for a given font ID so the app can inject its own @font-face or use it directly. */
export const getFontUrl = (fontId: string): string | undefined => fontUrlById[fontId];

/** Fonts imported by the user at runtime, parsed and held in memory. */
const customFonts = new Map<string, any>();
const fontCache = new Map<string, any>();

/** Parse a .ttf/.otf the user supplied. Kept here so apps never need to depend
 *  on opentype directly — the package owns the one copy. */
export function parseFont(buffer: ArrayBuffer): any {
  return opentype.parse(buffer);
}

/** Register a font the user imported from a .ttf/.otf, so `getFont` can find it. */
export function registerCustomFont(fontId: string, parsed: any): void {
  customFonts.set(fontId, parsed);
  fontCache.set(fontId, parsed);
}

async function loadFont(fontId: string): Promise<any> {
  const custom = customFonts.get(fontId);
  if (custom) return custom;
  const url = fontUrlById[fontId];
  if (!url) {
    if (fontId.startsWith('custom-')) {
      throw new Error('Custom font is missing. Please import the .ttf/.otf file again.');
    }
    throw new Error(`Font url not resolved for ${fontId}`);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed for font ${fontId}`);
  return opentype.parse(await r.arrayBuffer());
}

/** Parsed opentype font for `fontId`, cached for the session. */
export async function getFont(fontId: string): Promise<any> {
  let f = fontCache.get(fontId);
  if (!f) {
    f = await loadFont(fontId);
    fontCache.set(fontId, f);
  }
  return f;
}

/** Fonts shown as instant cards; the rest live behind "Browse all fonts". */
export const curatedFonts = (): FontChoice[] => FONTS.filter((f) => f.curated);

/** Which Google-font subsets a string needs, so we can warn before the glyphs
 *  come out as empty boxes. */
export function getRequiredSubsets(text: string): string[] {
  const subsets = new Set<string>();
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code >= 0x0400 && code <= 0x04ff) || (code >= 0x0500 && code <= 0x052f)) subsets.add('cyrillic');
    else if (code >= 0x0370 && code <= 0x03ff) subsets.add('greek');
    else if (code >= 0x0100 && code <= 0x024f) subsets.add('latin-ext');
  }
  return Array.from(subsets);
}

/** Whether `font` covers every character in `text`. */
export function isFontSupported(font: FontChoice, text: string): boolean {
  if (!font.subsets) return true;
  return getRequiredSubsets(text).every(
    (req) => font.subsets.includes(req) || font.subsets.includes(`${req}-ext`),
  );
}

/** The icon fallback font, used when a glyph is missing from the chosen face. */
export const FALLBACK_FONT_ID = 'icon-fallback';
