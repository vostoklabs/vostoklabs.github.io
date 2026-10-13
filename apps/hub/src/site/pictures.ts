// Where a page finds its pictures. Not the files in public/, which are whatever a camera or a
// render wrote, but a WebP of each at the size the page shows it, which the build makes and the
// dev server makes on request (images-plugin.ts). A new picture dropped into public/ needs no step.

/** A card's picture is drawn at most 800 x 600. */
export const THUMB_WIDTH = 800;
/** The same picture as a product page's main one, as wide as the gallery pictures beside it. */
export const LARGE_WIDTH = 1200;
/** A gallery strip tile is about a tenth of the main picture: 320 covers it on a sharp screen. */
export const STRIP_WIDTH = 320;

const stem = (file: string) => file.replace(/\.[a-z0-9]+$/i, '');

/** A card's picture, for its file in public/thumbs/. */
export const thumbFor = (file: string) => `/thumbs/${stem(file)}.webp`;

/** The same, large: a product page's main picture. */
export const largeFor = (file: string) => `/thumbs/${stem(file)}.large.webp`;

/** A gallery strip tile for a picture in public/media/. Anything else is shown as it is. */
export const stripFor = (src: string) => (/^\/media\/.+\.(jpe?g|png|webp)$/i.test(src) ? `${stem(src)}.strip.webp` : src);
