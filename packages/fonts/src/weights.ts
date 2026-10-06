// Other weights of the library's families, for an app that draws with one by name: Roboto Bold,
// cut from the same Roboto 3 original as the library's Roboto, and flagged bold. It is not the
// face the clicker's "Standard Bold" typeface was converted from: that is Roboto 2.137, under
// Apache-2.0, and its letters advance up to about 0.4 % differently. Declare it to the page with
// `installFontFaces(['roboto-bold'], { weight: '700' })`.
//
// Each file sits in fonts/weights/, outside the glob the library's faces come through, so no
// font picker offers one and an app's build carries their files only once it imports this
// module. Importing it is what lets `getFont`, `getFontUrl` and `installFontFaces` find them by
// id; the faces themselves are cut, checked and recorded by scripts/fetch-fonts.mjs like every
// other.
import { addedFontUrls } from './cache';
import { WEIGHTS, type FontChoice } from './registry';

const files = (import.meta as any).glob('./fonts/weights/*.ttf', { eager: true, import: 'default' }) as Record<string, string>;
for (const [path, url] of Object.entries(files)) addedFontUrls.set(path.replace('./fonts/weights/', '').replace('.ttf', ''), url);

export { WEIGHTS, type FontChoice };
