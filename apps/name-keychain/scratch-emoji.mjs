import fs from 'fs/promises';
import { resolve } from 'path';
import opentype from 'opentype.js';

const appDir = 'c:/Users/ianku/Desktop/cursor projects/vostok-labs-tools/apps/name-keychain';
const fontPath = resolve(appDir, 'scratch-noto-emoji.ttf');

async function run() {
  console.log('Downloading NotoEmoji-Regular.ttf...');
  const r = await fetch('https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/NotoEmoji-Regular.ttf');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(fontPath, buf);
  console.log('Downloaded.', buf.length, 'bytes');

  console.log('Loading with opentype.js...');
  const font = opentype.loadSync(fontPath);
  console.log('Loaded font:', font.names.fontFamily.en);

  const testString = '❤️🚀⭐';
  const glyphs = font.stringToGlyphs(testString);
  console.log('Glyphs:', glyphs.map(g => g.name || g.unicode));
  
  const path = glyphs[1].getPath(0, 0, 72);
  console.log('Path commands for rocket:', path.commands.length);
}

run().catch(console.error);
