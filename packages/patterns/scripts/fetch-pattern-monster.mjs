// Regenerates data/pattern-monster.json from Pattern Monster's open-source repository
// (MIT, © 2020–2023 pattern.monster). Run `pnpm --filter @vostok/patterns fetch-monster`
// (optionally with a local checkout/folder holding _index.js and LICENSE.md as the argument).
//
// The repo's src/routes/_index.js holds every free tile as `<path d='…'/>` markup joined by
// `~` (one entry per colour layer) with the ranges its own sliders use (maxStroke, maxScale,
// maxSpacing). ALL 330 are kept, with their names and ranges verbatim, so the studio's gallery
// is the same gallery; nothing is redrawn, so the MIT notice is the whole obligation.
//
// Two files: pattern-monster.json (everything, ~700 KB, loaded lazily) and
// pattern-monster-index.json (everything but the path data, ~40 KB, for a picker to list and
// filter the tiles without loading the geometry).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');

// The path flattener, bundled from the package source, to measure each tile's detail.
mkdirSync(`${here}../tests/.cache`, { recursive: true });
const flattenBundle = `${here}../tests/.cache/svgpath-${process.pid}.mjs`;
await esbuild({ entryPoints: [`${here}../src/svgpath.ts`], outfile: flattenBundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const { flattenPathData } = await import(`file://${flattenBundle}`);

/**
 * The period in mm a tile reads at on a coaster. Not a fixed factor on its width: Scales 3 is
 * 25 units wide and packs concentric arcs half a unit apart, Hexagon 1 is 29 wide and draws
 * one hexagon. So the tile's own line density decides — the average spacing between its lines
 * (cell area over total line length) is put at ~0.8 mm for stroke tiles (a hairline score
 * takes that; an engraved band at stroke 1 is narrower still) and ~1.2 mm for fill tiles'
 * outlines (so no island falls under a millimetre), then clamped to 8–45 mm.
 */
function measureSize(p, paths) {
  let length = 0;
  for (const d of paths) {
    const flat = flattenPathData(d, 0.05);
    for (const line of [...flat.rings.map((r) => [...r, r[0]]), ...flat.polylines]) {
      for (let i = 1; i < line.length; i++) length += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
  }
  const area = p.width * p.height;
  // The site's look, scaled to a coaster: about a third of a millimetre per tile unit (0.45
  // gave a 90 mm coaster one ring of a dozen asanoha stars; 0.33 gives it three rings).
  const base = p.width * 0.33;
  if (!(length > 0) || !(area > 0) || p.mode === 'fill') return Math.round(Math.max(8, Math.min(45, base)) * 2) / 2;
  // A stroke tile is enlarged when its lines would otherwise crowd under 0.55 mm apart — Scales 3
  // packs concentric arcs half a unit apart and needs to be three times the base. (0.8 made
  // asanoha a 34 mm star, one ring of twelve on a coaster; 0.55 gives the site's density.)
  const spacingUnits = area / length;
  const dense = (0.55 / spacingUnits) * p.width;
  return Math.round(Math.max(8, Math.min(45, Math.max(base, dense))) * 2) / 2;
}
const RAW = 'https://raw.githubusercontent.com/catchspider2002/svelte-svg-patterns/master/';
const local = process.argv[2];

async function text(name) {
  if (local && existsSync(`${local}/${name}`)) return readFileSync(`${local}/${name}`, 'utf8');
  const res = await fetch(RAW + (name === 'LICENSE.md' ? name : `src/routes/${name}`));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

const src = await text('_index.js');
const body = src.slice(src.indexOf('['));
const index = JSON.parse(body.slice(0, body.lastIndexOf(']') + 1));
const licence = await text('LICENSE.md');

const tiles = [];
for (const p of index) {
  const paths = p.path.split('~').map((el) => /d='([^']*)'/.exec(el)?.[1]).filter(Boolean);
  if (!paths.length) continue;
  tiles.push({
    id: p.slug,
    title: p.title,
    mode: p.mode,
    colors: p.colors,
    maxStroke: p.maxStroke,
    maxScale: p.maxScale,
    maxSpacing: p.maxSpacing ?? [0, 0],
    vHeight: p.vHeight ?? 0,
    width: p.width,
    height: p.height,
    tags: (p.tags ?? []).filter((t) => t !== 'new pattern').map((t) => t.trim()),
    created: (p.creationDate ?? '').slice(0, 10),
    size: measureSize(p, paths),
    paths,
  });
}
const meta = { source: 'https://github.com/catchspider2002/svelte-svg-patterns', licence: 'MIT', fetched: new Date().toISOString().slice(0, 10) };
mkdirSync(`${here}../data`, { recursive: true });
writeFileSync(`${here}../data/pattern-monster.json`, JSON.stringify({ ...meta, tiles }));
writeFileSync(`${here}../data/pattern-monster.LICENSE.txt`, licence);
writeFileSync(`${here}../data/pattern-monster-index.json`, JSON.stringify({ ...meta, tiles: tiles.map(({ paths, ...rest }) => ({ ...rest, layers: paths.length })) }));
const modes = {};
for (const t of tiles) modes[t.mode] = (modes[t.mode] ?? 0) + 1;
console.log(`kept ${tiles.length} of ${index.length} tiles (${JSON.stringify(modes)}), data ${Math.round(JSON.stringify(tiles).length / 1024)} KB, index ${Math.round(JSON.stringify(tiles.map(({ paths, ...r }) => r)).length / 1024)} KB`);
