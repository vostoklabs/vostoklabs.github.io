// A contact sheet of every pattern, each in a 60 mm disc at its default op, rasterised with
// sharp (no browser). The picture is the verification: look at it.
//   node tests/sheet.mjs                 → tests/.out/sheet.png (procedural patterns)
//   node tests/sheet.mjs --library       → tests/.out/library.png (the SVG tile library)
//   node tests/sheet.mjs --ops           → every op of every pattern
//   node tests/sheet.mjs --only=dots,kikko --shape=rect
import { build as esbuild } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const root = `${here}../../..`;
const require_ = createRequire(import.meta.url);
const sharp = require_(`${root}/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp`);

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };

mkdirSync(`${here}.cache`, { recursive: true });
mkdirSync(`${here}.out`, { recursive: true });
const bundle = `${here}.cache/sheet-${process.pid}.mjs`;
await esbuild({ entryPoints: [`${here}entry.ts`], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error', loader: { '.json': 'json' } });
const P = await import(`file://${bundle}?t=${Date.now()}`);
const only = opt('only', '').split(',').filter(Boolean);

if (flag('cards')) {
  // The gallery cards, drawn exactly as Pattern Monster draws them (dark card, gold pattern,
  // scale 1, stroke 1) — to be held up against the site. `--light` for the light palette,
  // `--scale=2` for the page look, `--only=a,b` for a few.
  const tiles = only.length ? P.LIBRARY_TILES.filter((t) => only.includes(t.id) || only.includes(`pm-${t.id}`)) : P.LIBRARY_TILES;
  const cols = 6;
  const cw = 300;
  const ch = 200;
  const colours = flag('light') ? P.MONSTER_LIGHT : P.MONSTER_DARK;
  const look = { colours, scale: Number(opt('scale', 1)), stroke: Number(opt('stroke', 1)) };
  const rows = Math.ceil(tiles.length / cols);
  const composite = [];
  for (const [i, t] of tiles.entries()) {
    const svg = P.tileSvg(t, look, cw, ch);
    const png = await sharp(Buffer.from(svg), { density: 72 }).png().toBuffer();
    composite.push({ input: png, left: (i % cols) * (cw + 10), top: Math.floor(i / cols) * (ch + 34) });
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="22"><text x="4" y="15" font-family="sans-serif" font-size="12" fill="#ddd">${t.title.replace(/[<>&]/g, '')} · ${t.mode} · ${t.colors}c</text></svg>`;
    composite.push({ input: Buffer.from(label), left: (i % cols) * (cw + 10), top: Math.floor(i / cols) * (ch + 34) + ch + 4 });
  }
  const out = `${here}.out/cards${opt('tag', '') ? '-' + opt('tag', '') : only.length ? '-' + only.length : ''}.png`;
  await sharp({ create: { width: cols * (cw + 10), height: rows * (ch + 34), channels: 3, background: '#141416' } }).composite(composite).png().toFile(out);
  console.log(`wrote ${out} (${tiles.length} cards)`);
  process.exit(0);
}

if (flag('thumbs')) {
  // The picker tiles, exactly as the kit fills them: one 40-box path per pattern, currentColor.
  const defs = flag('library') ? P.LIBRARY : P.PATTERNS;
  const cols = 10;
  const cell = 96;
  const rows = Math.ceil(defs.length / cols);
  const tiles = defs.map((d, i) => {
    const { d: path } = P.thumbPath(d);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}" viewBox="-2 -2 44 44"><rect x="-2" y="-2" width="44" height="44" fill="#fff"/><path d="${path}" fill="#1f2937" fill-rule="nonzero"/><text x="0" y="41.5" font-family="sans-serif" font-size="3.2" fill="#666">${d.id.replace(/[<>&]/g, '')}</text></svg>`;
    return { input: Buffer.from(svg), left: (i % cols) * (cell + 6), top: Math.floor(i / cols) * (cell + 6) };
  });
  const out = `${here}.out/thumbs${flag('library') ? '-library' : ''}.png`;
  await sharp({ create: { width: cols * (cell + 6), height: rows * (cell + 6), channels: 3, background: '#ddd' } }).composite(tiles).png().toFile(out);
  console.log(`wrote ${out} (${defs.length} tiles)`);
  process.exit(0);
}

const shape = opt('shape', 'disc');
const region = shape === 'rect' ? [[P.roundedRect(0, 0, 70, 50, 5)]] : shape === 'ring' ? [[P.circle(0, 0, 30, 128), P.circle(0, 0, 9, 48)]] : [[P.circle(0, 0, 30, 128)]];
let defs = flag('library') ? P.LIBRARY : P.PATTERNS;
if (only.length) defs = defs.filter((d) => only.includes(d.id) || only.includes(d.id.replace(/^pm-/, '')));

const tiles = [];
for (const def of defs) {
  const ops = flag('ops') ? def.ops : [def.ops[0]];
  for (const op of ops) {
    const t0 = performance.now();
    const r = P.fillShape(region, def, { op, web: 1.5 });
    const ms = performance.now() - t0;
    const svg = P.fillSvg(region, [r], { width: 300 });
    const label = `${def.id} · ${op} · ${r.stats.holes}h ${r.stats.lines}l ${ms.toFixed(0)}ms${r.warnings.length ? ' ⚠' : ''}`;
    if (r.warnings.length) console.log(`${def.id}/${op}: ${r.warnings.join(' | ')}`);
    const png = await sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#fff' }).png().toBuffer();
    const meta = await sharp(png).metadata();
    tiles.push({ png, w: meta.width, h: meta.height, label });
  }
}
const cols = Number(opt('columns', 6));
const cell = 310;
const rowH = Math.max(...tiles.map((t) => t.h)) + 30;
const rows = Math.ceil(tiles.length / cols);
const composite = tiles.map((t, i) => ({ input: t.png, left: (i % cols) * cell + 5, top: Math.floor(i / cols) * rowH + 22 }));
const labels = tiles.map((t, i) => ({
  input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="20"><text x="4" y="14" font-family="sans-serif" font-size="11" fill="#222">${t.label.replace(/[<>&]/g, '')}</text></svg>`),
  left: (i % cols) * cell, top: Math.floor(i / cols) * rowH + 2,
}));
// `--tag=name` names the file; without it a long `--only` list would blow the path limit.
const out = `${here}.out/${flag('library') ? 'library' : 'sheet'}${opt('tag', '') ? '-' + opt('tag', '') : only.length ? '-' + (only.length > 4 ? only.length : only.join('-')) : ''}${flag('ops') ? '-ops' : ''}.png`;
await sharp({ create: { width: cols * cell, height: rows * rowH, channels: 3, background: '#e6e6e6' } }).composite([...composite, ...labels]).png().toFile(out);
console.log(`wrote ${out} (${tiles.length} tiles)`);
if (flag('svg')) for (const [i, t] of tiles.entries()) writeFileSync(`${here}.out/${i}.svg`, ''); // reserved
