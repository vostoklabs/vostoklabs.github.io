// Package the MakerWorld submission: zip the built `dist/` together with `config.json`
// (the host config) into makerlab/clicker-generator-mw.zip.
//
// After unzipping, the top level is `dist/` + `config.json`, matching what MakerLab asks
// for. Run via `npm run pack:mw` (which builds first). Requires a prior `build:mw`.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const appDir = join(import.meta.dirname, '..'); // apps/clicker-generator
const distDir = join(appDir, 'dist');
const configPath = join(appDir, 'makerlab', 'config.json');
const outZip = join(appDir, 'makerlab', 'clicker-generator-mw.zip');

if (!existsSync(distDir)) {
  console.error('No dist/ found — run `npm run build:mw` first.');
  process.exit(1);
}

// Walk dist/ into a flat { 'dist/rel/path': bytes } map for fflate.
function walk(dir, files) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else files[`dist/${relative(distDir, full).replace(/\\/g, '/')}`] = new Uint8Array(readFileSync(full));
  }
}

const files = {};
walk(distDir, files);
files['config.json'] = new Uint8Array(readFileSync(configPath));

const zipped = zipSync(files, { level: 6 });
writeFileSync(outZip, zipped);
console.log(`Wrote ${relative(appDir, outZip)} (${(zipped.length / 1024 / 1024).toFixed(2)} MB, ${Object.keys(files).length} files)`);
