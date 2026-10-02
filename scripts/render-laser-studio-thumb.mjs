// The hub card's picture for Laser Studio: six of its designs, built for real and laid out
// three across.
//
//   node scripts/render-laser-studio-thumb.mjs            → apps/hub/public/thumbs/laser-studio.png
//   node scripts/render-laser-studio-thumb.mjs --ids=a,b  → pick your own six
//
// A product shot would be better and should replace this the day there is one — but a letter
// placeholder is what the card shows otherwise, and this app's whole pitch is "there are a lot
// of designs", which one photo could not say anyway.
//
// No browser: the designs are built through the studio's own node harness (the same geometry
// the worker makes, minus the DOM) and rasterised with sharp/librsvg, as `tests/node/
// rasterize.mjs` does. Run it after the library changes enough that the six are no longer
// representative — nothing regenerates this automatically.
//
// Needs the studio's tests/, which .gitignore fences out of the repo, so this runs in the main
// checkout and not in a fresh clone. The PNG it writes is the deliverable and is tracked.
//
// Needs the studio's tests/, which .gitignore fences out of the repo, so this runs in the main
// checkout and not in a fresh clone. The PNG it writes is the deliverable and is tracked.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require_ = createRequire(import.meta.url);
// sharp is in the pnpm store as a transitive dependency, not linked into any workspace package:
// load it by path, the way tests/node/rasterize.mjs does.
const sharp = require_(`${ROOT}node_modules/.pnpm/sharp@0.34.5/node_modules/sharp`);

const { loadHarness, previewSvg } = await import(
  new URL('../apps/laser-studio/tests/node/harness.mjs', import.meta.url).href
);

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/** Six that between them say what the library is: a name keychain, a pet tag, a luggage tag,
 *  a monogram sign, a cake topper and a pattern fill — one-piece and multi-piece, engraved and
 *  scored, script and block. Chosen for the picture, not for coverage. */
const IDS = arg('ids', 'name-keychain,pet-id-tag,luggage-tag,split-monogram,cake-topper,pattern-fill')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const W = Number(arg('width', 800));
const H = Number(arg('height', 500));
const COLS = Number(arg('columns', 3));
const ROWS = Math.ceil(IDS.length / COLS);
const PAD = 18;
// The studio preview plate's own off-white, so the six cells read as one sheet rather than as
// six cards floating on a different grey.
const GROUND = arg('bg', '#f4f1ea');

const cellW = Math.floor((W - PAD * (COLS + 1)) / COLS);
const cellH = Math.floor((H - PAD * (ROWS + 1)) / ROWS);

/** Give a viewBox-only SVG a pixel size librsvg will rasterise at, fitted inside the cell so a
 *  long name tag stays long and a square coaster stays square. density 72 = one SVG px per
 *  output px; sharp's default 96 would render everything 4/3 too wide. */
function fitted(svgText) {
  const open = /<svg[^>]*>/.exec(svgText)[0];
  const vb = /viewBox="([^"]+)"/.exec(svgText)?.[1].trim().split(/[\s,]+/).map(Number);
  const ratio = vb && vb[2] > 0 ? vb[3] / vb[2] : 1;
  let w = cellW;
  let h = Math.round(w * ratio);
  if (h > cellH) { h = cellH; w = Math.round(h / ratio); }
  const sized = open.replace(/\s(width|height)="[^"]*"/g, '').replace('<svg', `<svg width="${w}" height="${h}"`);
  return { text: svgText.replace(open, sized), w, h };
}

const harness = await loadHarness();
const layers = [];
for (const [i, id] of IDS.entries()) {
  const built = await harness.buildTemplate(id);
  const { text, w, h } = fitted(previewSvg(built.output));
  const png = await sharp(Buffer.from(text), { density: 72 }).png().toBuffer();
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  layers.push({
    input: png,
    left: PAD + col * (cellW + PAD) + Math.round((cellW - w) / 2),
    top: PAD + row * (cellH + PAD) + Math.round((cellH - h) / 2),
  });
  console.log(`  ${id} — ${w}x${h}`);
}

const out = `${ROOT}apps/hub/public/thumbs/laser-studio.png`;
mkdirSync(`${ROOT}apps/hub/public/thumbs`, { recursive: true });
writeFileSync(
  out,
  await sharp({ create: { width: W, height: H, channels: 3, background: GROUND } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
console.log(`Wrote apps/hub/public/thumbs/laser-studio.png (${W}x${H}, ${IDS.length} designs)`);
