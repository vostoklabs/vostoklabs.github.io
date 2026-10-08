#!/usr/bin/env node
/*
  node scripts/render-carabiner-gallery.mjs [out-dir] [--cover | --cover-only]

  Gallery renders of the keychain carabiner: a few of the sets the app makes, assembled as the
  preview shows them, hanging over a soft floor shadow. With --cover it also lays six of them out
  as the hub card (cover.png, 800x600).

  Same code path as the app: it bundles src/geometry/harnessEntry.ts, as render-carabiner.mjs
  does, and the pictures come from scripts/product-render.mjs.
*/
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderScene, writePng } from './product-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'keychain-carabiner');
const rootRequire = createRequire(pathToFileURL(join(ROOT, 'package.json')));
const fontsRequire = createRequire(pathToFileURL(join(ROOT, 'packages', 'fonts', 'package.json')));
const MANIFOLD_JS = join(APP, 'node_modules', 'manifold-3d', 'manifold.js');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? join(ROOT, '.render-carabiner-gallery');
const cover = args.includes('--cover') || args.includes('--cover-only');
mkdirSync(outDir, { recursive: true });

const bundle = join(outDir, '_harness.mjs');
execFileSync(process.execPath, [
  rootRequire.resolve('esbuild/bin/esbuild'), join(APP, 'src', 'geometry', 'harnessEntry.ts'),
  '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning',
], { cwd: ROOT, stdio: 'inherit' });
const harness = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });
const opentype = fontsRequire('opentype.js');
const wasm = await (await import(pathToFileURL(MANIFOLD_JS).href)).default();
wasm.setup();

const font = opentype.loadSync(join(ROOT, 'packages', 'fonts', 'src', 'fonts', 'icon-fallback.ttf'));
// Material Symbols codepoints (packages/fonts/src/icons.ts), the font the app's symbol picker traces.
const GLYPH = { bolt: 0xea0b, bedtime: 0xef44, eco: 0xea35, music_note: 0xe405, favorite: 0xe87d, sunny: 0xe81a };
const contours = (id) => {
  if (!id) return [];
  if (id.startsWith('shape:')) {
    const sh = harness.BUILTIN_SHAPES.find((x) => x.id === id.slice(6));
    return sh ? [sh.ring.map(([x, y]) => [x * 100, y * 100])] : [];
  }
  const glyph = font.charToGlyph(String.fromCodePoint(GLYPH[id]));
  if (!GLYPH[id] || !glyph || glyph.index === 0) throw new Error(`no glyph for symbol ${id}`);
  return harness.pathCommandsToPolygons(glyph.getPath(0, 0, 100).commands);
};
const shape = (id) => {
  const s = harness.BUILTIN_SHAPES.find((x) => x.id === id);
  if (!s) throw new Error(`no shape ${id}`);
  return { ring: s.ring, gate: s.gate, eye: s.eye, top: s.top };
};

// Rules for the gallery (Ian, 2026-10-07): a different hook shape on each, varied symbols (no
// crown, no paw) and two with none, no charm hanging straight off the hook, and chains only as
// round or oval links or print-in-place.
const PINK = [255, 140, 170], YELLOW = [255, 205, 92], CYAN = [120, 205, 220], LILAC = [186, 160, 255], MINT = [140, 220, 170], WHITE = [250, 250, 250];
const CASES = [
  { name: 'oval-heart', s: {} },
  { name: 'carabiner-bolt-print-in-place', s: { mode: 'pip', hookShape: 'dring', icon: 'bolt', hookColor: LILAC, iconColor: YELLOW, linkColor: YELLOW } },
  { name: 'heart-star-charm', s: { hookShape: 'heart', icon: 'shape:star', charm: true, charmShape: 'star', charmIcon: 'shape:heart', hookColor: PINK, iconColor: YELLOW, linkColor: WHITE, charmColor: LILAC } },
  { name: 'pear-round-links', s: { hookShape: 'pear', icon: '', linkShape: 'circle', hookColor: CYAN, iconColor: WHITE, linkColor: PINK } },
  { name: 'star-oval-links', s: { hookShape: 'star', icon: '', linkShape: 'oval', hookColor: YELLOW, iconColor: PINK, linkColor: CYAN } },
  { name: 'teardrop-moon-flower-charm', s: { hookShape: 'teardrop', icon: 'bedtime', charm: true, charmShape: 'flower', charmIcon: 'shape:heart', hookColor: MINT, iconColor: WHITE, linkColor: LILAC, charmColor: PINK } },
];

function build(s) {
  const settings = { ...harness.DEFAULT_SETTINGS, iconSize: 14, ...s };
  const built = harness.buildSet(wasm, {
    ...settings,
    hookGeom: shape(settings.hookShape),
    linkGeom: shape(settings.linkShape),
    charmGeom: shape(settings.charmShape),
    iconContours: contours(settings.icon),
    charmIconContours: contours(settings.charmIcon),
    plate: [256, 256],
  });
  if (built.warnings.length) console.log(`  ! ${built.warnings.join('; ')}`);
  return built.assembled;
}

/** The assembled set laid down on its back, turned across the frame, floating a little over
 *  its own soft shadow. Assembled is world (x, -z, y) of the flat frame; this undoes the stand-up
 *  and turns the hang axis `turn` degrees off the frame's vertical. */
function lay(parts, turn) {
  const c = Math.cos((turn * Math.PI) / 180), s = Math.sin((turn * Math.PI) / 180);
  return parts.map((p) => {
    const P = p.positions, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 2], z = -P[i + 1];
      Q[i] = x * c - y * s;
      Q[i + 1] = x * s + y * c;
      Q[i + 2] = z;
    }
    return { ...p, positions: Q, spec: 0.35, gloss: 50 };
  });
}
function shot(parts, w, h, extra = {}) {
  const laid = lay(parts, extra.turn ?? -38);
  let lo = Infinity;
  for (const p of laid) for (let i = 2; i < p.positions.length; i += 3) lo = Math.min(lo, p.positions[i]);
  return renderScene(laid, {
    width: w, height: h, azimuth: 0, elevation: 58, fov: 22, margin: 0.07,
    groundZ: lo - 4, light: { azimuth: -30, elevation: 60 }, crease: 40, ...extra,
  });
}

const W = 1200, H = 900;
const built = new Map();
for (const c of CASES) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(c.name)) continue;
  built.set(c.name, build(c.s));
  if (args.includes('--cover-only')) continue;
  writePng(join(outDir, `${c.name}.png`), shot(built.get(c.name), W, H), W, H);
  console.log(`wrote ${c.name}.png`);
}
if (cover) {
  // The hub card: 3 x 2 tiles with a 2 px gutter, each rendered at twice its size and halved.
  const CW = 800, CH = 600, G = 2;
  const out = new Uint8Array(CW * CH * 3).fill(255);
  const colW = [265, 266, 265], rowH = [299, 299];
  let k = 0;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++, k++) {
      const name = CASES[k].name;
      if (!built.has(name)) continue;
      const tw = colW[c], th = rowH[r];
      const img = shot(built.get(name), tw * 2, th * 2, { margin: 0.05, grid: 10, turn: -30 });
      const x0 = colW.slice(0, c).reduce((a, b) => a + b + G, 0), y0 = r * (rowH[0] + G);
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          for (let ch = 0; ch < 3; ch++) {
            let sum = 0;
            for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) sum += img[((y * 2 + j) * tw * 2 + x * 2 + i) * 3 + ch];
            out[((y0 + y) * CW + x0 + x) * 3 + ch] = Math.round(sum / 4);
          }
        }
      }
    }
  }
  writePng(join(outDir, 'cover.png'), out, CW, CH);
  console.log('wrote cover.png');
}
