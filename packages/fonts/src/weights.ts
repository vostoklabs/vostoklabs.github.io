// Other weights of the library's families (Roboto Bold), for an app that draws with one by name:
// the clicker's "Standard Bold" is Roboto Bold.
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
