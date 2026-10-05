#!/usr/bin/env node
/*
  node apps/pen-topper/tests/pauses.test.mjs      (or: pnpm --filter pen-topper test)

  The manual-swap readout against the model it describes. For every pen path, both
  multi-colour schemes and both print modes it builds the real topper headless and
  checks two things:

    - the builder's band heights are where its parts actually are;
    - every height the readout names is where that colour's part starts, on a whole
      layer, and written precisely enough that a 0.12 or 0.28 mm layer reads exactly.

  The readout once worked its heights out from the Plate thickness slider while the
  builder held the body up to the bore, so "Inside the name" said 5.0 mm for letters
  that start at 14.4. The preview was right, the line under it was wrong, and nothing
  compared the two.

  Same code path as the app, the way scripts/render-topper.mjs does it: it bundles
  src/geometry/harnessEntry.ts, so what is measured is what the worker builds.
*/

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '..', '..');
// pnpm does not hoist, so each dependency is reached through a workspace that declares
// it — never through the store's own folder names, which differ from one install to the
// next.
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));

const cacheDir = join(APP, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const bundle = join(cacheDir, 'pauses-harness.mjs');
execFileSync(
  process.execPath,
  [
    rootRequire.resolve('esbuild/bin/esbuild'),
    join(APP, 'src', 'geometry', 'harnessEntry.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${bundle}`,
    '--log-level=warning',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
const h = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });

const opentype = fontsRequire('opentype.js');
// manifold-3d's exports map is import-only, which `require.resolve` cannot follow; this
// app's own link to it is a path every install has.
const Module = (await import(pathToFileURL(join(APP, 'node_modules', 'manifold-3d', 'manifold.js')).href)).default;
const wasm = await Module();
wasm.setup();

const fontDir = join(ROOT, 'packages', 'fonts', 'src', 'fonts');
const fonts = new Map();
const font = (id) => {
  if (!fonts.has(id)) fonts.set(id, opentype.loadSync(join(fontDir, `${id}.ttf`)));
  return fonts.get(id);
};

/** Build `s` the way the worker does, and say where each part sits in Z. */
function partHeights(s) {
  const glyphs = font(s.font);
  const fallback = font('icon-fallback');
  const laid =
    s.layout === 'vertical'
      ? h.getVerticalContours(glyphs, fallback, s.name, s.size, s.lineSpacing, s.letterSpacing)
      : h.getHorizontalContours(
          glyphs, fallback, s.name, s.secondLine, s.size, s.size * s.line2Scale, 0, s.line2Align,
          0.62 * s.lineSpacing, s.letterSpacing, { alignMode: 'block' },
        );
  const built = h.buildTopper(wasm, laid.contours, { ...s, lines: laid.lines });
  const out = {};
  for (const part of built.parts) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 2; i < part.positions.length; i += 3) {
      if (part.positions[i] < lo) lo = part.positions[i];
      if (part.positions[i] > hi) hi = part.positions[i];
    }
    out[part.name] = { lo, hi };
  }
  return out;
}

let failures = 0;
const check = (tag, cond, detail) => {
  if (cond) return;
  failures++;
  console.log(`  FAIL ${tag}: ${detail}`);
};
// The vertices are Float32, so a face lands within microns of the height it was built at.
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const onLayer = (z, lh) => Math.abs(z / lh - Math.round(z / lh)) < 1e-6;

const D = h.DEFAULT_SETTINGS;
const PATHS = [
  ['inset', 'Inside the name'],
  ['through', 'Straight through'],
  ['collar', 'Separate collar'],
];
const SCHEMES = ['plate-text', 'plate-halo-text'];
/* Everything else that moves a band: a layer height that is not a whole tenth, a plate
   slider above the bore's floor (the slider wins again), a hex hole (its own floor), and
   no plate at all (the letters grown to hold the bore). */
const VARIANTS = [
  ['defaults', {}],
  ['0.12 mm layers', { layerHeight: 0.12 }],
  ['0.28 mm layers', { layerHeight: 0.28, haloThickness: 1.1 }],
  ['plate over the floor', { pen: 'custom', barrelDia: 5, plateThickness: 9.8 }],
  ['hex pencil', { pen: 'hex-pencil', barrelDia: 8.1, holeShape: 'hex', name: 'Maya' }],
  ['no plate', { plateShape: 'none' }],
];

// The variants have to land on both sides of the floor, or half of this proves nothing.
check('variants', h.minPlateThickness({ ...D, penPath: 'inset' }) > D.plateThickness, 'the defaults no longer sit under the floor');
check('variants', h.minPlateThickness({ ...D, penPath: 'inset', barrelDia: 5 }) < 9.8, 'the 5 mm barrel no longer clears the floor');

for (const [penPath, pathLabel] of PATHS) {
  for (const colorScheme of SCHEMES) {
    const halo = colorScheme === 'plate-halo-text';
    for (const [variant, extra] of VARIANTS) {
      for (const printMode of ['noams', 'ams']) {
        const s = { ...D, penPath, colorScheme, printMode, ...extra };
        const tag = `${pathLabel} / ${halo ? '3' : '2'} colours / ${printMode === 'noams' ? 'manual' : 'AMS'} / ${variant}`;
        const z = partHeights(s);

        // The builder: its parts stand on its own bands.
        const bands = h.bandHeights(s);
        check(tag, near(z.text.lo, bands.letterZ), `letters start at ${z.text.lo}, bands say ${bands.letterZ}`);
        if (halo) {
          check(tag, near(z.halo.lo, bands.plateT) && near(z.halo.hi, bands.plateT + bands.haloT),
            `outline spans ${z.halo.lo}-${z.halo.hi}, bands say ${bands.plateT} + ${bands.haloT}`);
        }
        // 0.01, not 1e-3: the top bevel overlaps the face by 0.005 so the letters fuse to it.
        if (penPath !== 'collar') {
          check(tag, near(z.plate.hi, bands.plateT, 0.01), `body top at ${z.plate.hi}, bands say ${bands.plateT}`);
        }

        const text = h.pauseText(s);
        if (printMode === 'ams') {
          check(tag, !/\d/.test(text), `the AMS readout names a height: "${text}"`);
          continue;
        }

        // The readout: each height it names is where that colour starts, on a whole layer.
        const named = [...text.matchAll(/(\d+(?:\.\d+)?) mm → ([a-z]+ colour)/g)].map((m) => ({ z: Number(m[1]), label: m[2] }));
        const starts = halo
          ? [{ z: z.halo.lo, label: 'halo colour' }, { z: z.text.lo, label: 'text colour' }]
          : [{ z: z.text.lo, label: 'text colour' }];
        check(tag, named.length === starts.length, `"${text}" names ${named.length} swaps; the model has ${starts.length}`);
        starts.forEach((want, i) => {
          const got = named[i];
          if (!got) return;
          check(tag, got.label === want.label, `swap ${i + 1} is to ${got.label}, the part above it is ${want.label}`);
          check(tag, near(got.z, want.z), `swap ${i + 1} at ${got.z} mm, but ${want.label} starts at ${want.z.toFixed(3)} mm`);
          check(tag, onLayer(got.z, s.layerHeight), `swap ${i + 1} at ${got.z} mm is not on a ${s.layerHeight} mm layer`);
        });
        // Inside the name or straight through, nothing of the body stands above the first
        // swap, so the body prints in one colour. A collar stands above it by design.
        if (penPath !== 'collar') {
          check(tag, z.plate.hi <= starts[0].z + 0.01, `the body reaches ${z.plate.hi}, above the swap at ${starts[0].z}`);
        }
        console.log(`  ${tag.padEnd(62)} ${text.replace('Pause and swap filament at: ', '')}`);
      }
    }
  }
}

// No swaps to name: one colour, or letters set flush, whose colours share layers with
// the plate and so cannot be split by a pause.
for (const [penPath, pathLabel] of PATHS) {
  for (const extra of [{ colorScheme: 'single' }, { style: 'engraved' }, { style: 'engraved', colorScheme: 'plate-halo-text' }]) {
    const s = { ...D, penPath, printMode: 'noams', ...extra };
    const text = h.pauseText(s);
    check(`${pathLabel} / ${JSON.stringify(extra)}`, h.noAmsPauses(s).length === 0 && !/\d/.test(text), `names a swap: "${text}"`);
  }
}

if (failures) {
  console.log(`\n${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nEvery swap the readout names is where that colour starts, on a whole layer.');
