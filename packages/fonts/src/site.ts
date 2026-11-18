// Where a build fetches this package's font files from. Every door of the package that globs
// them (the library, the symbol font, the other weights) asks here, so a build for the website
// points every one of them at the site's single copy, and every other build at the app's own.

/** In a build for the website, the folder (from the site's root) where the site keeps its one
 *  copy of every font file, so every app on the site fetches that copy instead of carrying its
 *  own; the site's deploy sets it and moves the copies there. Unset (dev servers, previews,
 *  MakerLab and offline builds), every face comes from the app's own files, as always. */
const SITE_FONTS: string | undefined = ((import.meta as any).env as Record<string, string | undefined> | undefined)?.VITE_SITE_FONTS;

/** The URL to fetch the font file a glob found at `path` (`./fonts/anton.ttf`,
 *  `./fonts/weights/roboto-bold.ttf`) from, given the URL the glob gave it: in a website build
 *  the site's copy, at the same path inside the site's font folder; in any other build, `url`. */
export function siteFontUrl(path: string, url: string): string {
  if (!SITE_FONTS) return url;
  // The app's own copy is built into <site>/<app>/assets/, so the site's root is two folders up.
  return new URL(`../../${SITE_FONTS}${path.replace(/^\.\/fonts\//, '')}`, url).href;
}
