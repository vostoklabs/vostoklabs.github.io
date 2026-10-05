// What every door of this package shares within one page, so a face is fetched and parsed once
// whichever door asked for it: the fonts parsed so far, the files a subpath adds to the
// library's own, and the symbol font's id.

/** Parsed opentype fonts by id: the library's faces as they load, and the ones a person imported. */
export const parsedFonts = new Map<string, any>();

/** Font files by id that the library's glob does not hold, added by a module of this package
 *  when an app imports it (the other weights, `@vostok/fonts/weights`). */
export const addedFontUrls = new Map<string, string>();

/** The icon fallback font, used when a glyph is missing from the chosen face. */
export const FALLBACK_FONT_ID = 'icon-fallback';
