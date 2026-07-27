import { resolve } from 'path';
import opentype from 'opentype.js';

const appDir = 'c:/Users/ianku/Desktop/cursor projects/vostok-labs-tools/apps/name-keychain';
const font = opentype.loadSync(resolve(appDir, 'src/fonts/luckiest-guy.ttf'));

const text = "Привет";
const glyphs = font.stringToGlyphs(text);
console.log(glyphs.length, "glyphs");
for (const g of glyphs) {
  const path = g.getPath(0, 0, 18);
  console.log("Commands length:", path.commands.length);
}
