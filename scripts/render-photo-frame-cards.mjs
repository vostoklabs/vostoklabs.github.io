#!/usr/bin/env node
/*
  ALLOW_CHROME=1 node scripts/render-photo-frame-cards.mjs [--only=<design>,...]

  Photo Frames' gallery pictures, made before the page opens: every design turned portrait and
  turned landscape, written as WebP to apps/photo-frame/public/cards/, with the list the gallery
  reads them from in apps/photo-frame/src/cardFiles.ts.

  Each picture is taken in a headless Chrome by the app's own pictureOf (src/pictures.ts), from
  the Vite dev server's modules: the camera, the sample photo, the rules and the build a card
  would otherwise make while the customer waits. The list keeps, beside each file, the key of the
  settings it shows (src/cards.ts), so the app's designs test fails when a design changes and
  its pictures do not. Run this again after changing a design, or after a change to the geometry
  that shows in a picture. --only re-takes some designs and keeps the rest.

  Software WebGL is heavy: it needs ALLOW_CHROME=1, and runs one browser.
*/

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome } from './lib/headless-chrome.mjs';
import { loadSharp } from './lib/sharp.mjs';

if (!process.env.ALLOW_CHROME) {
  console.error('BLOCKED: this starts a headless Chrome with software WebGL. Run it with ALLOW_CHROME=1.');
  process.exit(3);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'photo-frame');
const OUT = join(APP, 'public', 'cards');
const LIST = join(APP, 'src', 'cardFiles.ts');
const ORIENTATIONS = ['portrait', 'landscape'];

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const sharp = loadSharp(ROOT);
const { createServer } = await import(pathToFileURL(createRequire(join(APP, 'package.json')).resolve('vite')).href);

/** The list as it stands, so --only keeps the designs it does not re-take. */
function readList() {
  try {
    const text = readFileSync(LIST, 'utf8');
    return JSON.parse(text.slice(text.indexOf('= {') + 2, text.lastIndexOf('}') + 1));
  } catch {
    return {};
  }
}

// A page with nothing on it, on the dev server's origin, so the app's modules import by path
// without the app itself starting (and making pictures of its own).
const blankPage = {
  name: 'cards-page',
  configureServer(server) {
    server.middlewares.use('/__cards', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><meta charset="utf-8"><title>cards</title>');
    });
  },
};

const server = await createServer({ root: APP, configFile: join(APP, 'vite.config.ts'), logLevel: 'warn', plugins: [blankPage], server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const chrome = await launchChrome({ width: 800, height: 600 });

try {
  await chrome.open(`${origin}/__cards`);
  const ids = await chrome.evaluate(`import('/src/designs.ts').then((m) => m.DESIGNS.map((d) => d.id))`);
  const list = only ? readList() : {};
  mkdirSync(OUT, { recursive: true });
  let bytes = 0;

  for (const id of ids) {
    if (only && !only.includes(id)) continue;
    const entry = {};
    for (const o of ORIENTATIONS) {
      const shot = JSON.parse(await chrome.evaluate(`(async () => {
        const [{ pictureOf }, { designById }, cards] = await Promise.all([import('/src/pictures.ts'), import('/src/designs.ts'), import('/src/cards.ts')]);
        const s = cards.cardSettings(designById(${JSON.stringify(id)}), ${JSON.stringify(o)});
        return JSON.stringify({ key: cards.cardKey(s), url: await pictureOf(s, cards.CARD_SHOT) });
      })()`));
      if (!shot.url) throw new Error(`${id} ${o}: no picture was made`);
      // A design that does not turn shows the same settings both ways: one file serves both.
      const same = Object.values(entry).find((e) => e.key === shot.key);
      if (same) {
        entry[o] = same;
        continue;
      }
      const webp = await sharp(Buffer.from(shot.url.split(',')[1], 'base64')).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
      const file = `${id}-${o}.webp`;
      writeFileSync(join(OUT, file), webp);
      bytes += webp.length;
      entry[o] = { file, key: shot.key };
      console.log(`${file}  ${(webp.length / 1024).toFixed(1)} KB`);
    }
    list[id] = entry;
  }

  // Only the files the list names stay.
  const named = new Set(Object.values(list).flatMap((e) => Object.values(e).map((f) => f.file)));
  for (const f of readdirSync(OUT)) if (!named.has(f)) rmSync(join(OUT, f));

  const sorted = Object.fromEntries(Object.keys(list).sort().map((k) => [k, list[k]]));
  writeFileSync(
    LIST,
    `// Written by scripts/render-photo-frame-cards.mjs: the gallery's made pictures, by design and
// orientation, each with the key of the settings it shows (cards.ts). Do not edit by hand.
export const CARD_FILES: Record<string, Partial<Record<'portrait' | 'landscape', { file: string; key: string }>>> = ${JSON.stringify(sorted, null, 2)};
`,
  );
  console.log(`\n${named.size} pictures, ${(bytes / 1024).toFixed(0)} KB written this run.`);
} finally {
  await chrome.close();
  await server.close();
}
