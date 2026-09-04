/**
 * Render every base shape to one HTML page, so a person can look at them.
 *
 *   node scripts/shape-contact-sheet.mjs
 *   → docs/shape-review.html
 *
 * This exists because of how the shape directory went wrong. The first version generated 371
 * shapes and filtered them numerically — area fill, inscribed square, aspect ratio — and every
 * one passed a test proving it was closed, printable and not secretly a circle. It still
 * shipped brand logos and a hundred rectangles, because no number can say "this is ugly" or
 * "nobody wants a clicker shaped like a backspace key".
 *
 * Where taste is the requirement, the review step is a person. This is the page that person
 * looks at. Run it after touching `shapePaths.ts` or the directory, and LOOK before shipping.
 *
 * Shapes are drawn from the exact ring functions the geometry uses, at the aspect ratio they
 * build at, with a switch-column circle overlaid — because the question is not only "is it
 * nice" but "can a 17 mm switch live in it".
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The ring functions are TypeScript; bundle them to a temp ESM module and import that.
const ENTRY = join(ROOT, 'apps/clicker-generator/src/geometry/shapePaths.ts');
const BUNDLE = join(ROOT, 'apps/clicker-generator/.shape-sheet.mjs');
await build({
  entryPoints: [ENTRY], bundle: true, platform: 'node', format: 'esm',
  outfile: BUNDLE, logLevel: 'error',
});
const P = await import(`file://${BUNDLE.replace(/\\/g, '/')}`);

/** Every shape, plus the interesting settings of the parametric ones. A family is shown at its
 *  extremes AND its default — a polygon that looks fine at 6 sides can be silly at 24. */
const SHEET = [
  ['Basic', [
    ['Circle', P.circleRing()],
    ['Square · corner 0%', P.roundedRectRing(2, 2, 0)],
    ['Square · corner 22% (default)', P.roundedRectRing(2, 2, 0.22)],
    ['Square · corner 40%', P.roundedRectRing(2, 2, 0.4)],
    ['Rectangle', P.roundedRectRing(2.6, 1.6, 0.22)],
    ['Squircle', P.squircleRing()],
    ['Capsule', P.capsuleRing()],
  ]],
  ['Polygon (Sides 3-8)', [
    ['3', P.ngonRing(3)], ['4', P.ngonRing(4)], ['5', P.ngonRing(5)],
    ['6 (default)', P.ngonRing(6)], ['7', P.ngonRing(7)], ['8', P.ngonRing(8)],
  ]],
  ['Star (Points 3-8)', [
    ['3', P.starRing(3)], ['4', P.starRing(4)], ['5 (default)', P.starRing(5)],
    ['6', P.starRing(6)], ['7', P.starRing(7)], ['8', P.starRing(8)],
  ]],
  ['Fun', [
    ['Heart', P.heartRing()],
    ['Egg', P.eggRing()],
    ['Cross', P.crossRing()],
  ]],
  ['Badges — still to judge', [
    ['Shield', P.shieldRing()],
    ['Tag', P.tagRing()],
    ['Arch', P.archRing()],
  ]],
];

const SIZE = 150;
const PAD = 14;

/** Draw a ring into a SIZE box, keeping its real aspect ratio, plus the switch column. */
function tile(name, ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const k = (SIZE - PAD * 2) / Math.max(w, h);
  const ox = SIZE / 2 - ((minX + maxX) / 2) * k;
  const oy = SIZE / 2 + ((minY + maxY) / 2) * k;
  const d = `M${ring.map(([x, y]) => `${(x * k + ox).toFixed(1)},${(oy - y * k).toFixed(1)}`).join('L')}Z`;

  /* The switch circle goes at the RING'S ORIGIN, not at the middle of the tile.

     The first version of this sheet drew it at the tile centre while placing the shape by its
     bounding box, so the two disagreed by exactly the quantity being judged — which made the
     offsets read as drawing errors rather than as the real problem they were.

     A clicker base is ~40 mm across its longest side and the switch needs a ~17 mm clear
     column, so the same ratio here shows whether a switch actually fits where it will sit. */
  const switchR = (17 / 40) * (SIZE - PAD * 2) / 2;
  return `<figure>
  <svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
    <path d="${d}" fill="var(--ink)"/>
    <circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${switchR.toFixed(1)}"
            fill="none" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="4 3"/>
  </svg>
  <figcaption>${name}<br><small>${ring.length} pts · ${(w / h).toFixed(2)} w/h</small></figcaption>
</figure>`;
}

const body = SHEET.map(([group, items]) => `
<section>
  <h2>${group}</h2>
  <div class="grid">${items.map(([n, r]) => tile(n, r)).join('')}</div>
</section>`).join('');

const html = `<!doctype html><meta charset="utf-8">
<title>Clicker base shapes — review sheet</title>
<style>
  :root { --bg:#15171c; --panel:#1c1f26; --ink:#e8eaed; --muted:#9aa0ab; --warn:#ff9f43; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f3f4f6; --panel:#fff; --ink:#15171c; --muted:#5c6270; }
  }
  body { margin:0; padding:32px; background:var(--bg); color:var(--ink);
         font:15px/1.5 system-ui, sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; }
  .lede { color:var(--muted); max-width:70ch; margin:0 0 28px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted);
       margin:32px 0 12px; font-weight:600; }
  .grid { display:flex; flex-wrap:wrap; gap:14px; }
  figure { margin:0; background:var(--panel); border-radius:10px; padding:10px; width:${SIZE + 20}px; }
  figcaption { margin-top:8px; font-size:13px; text-align:center; }
  small { color:var(--muted); font-size:11px; }
</style>
<h1>Clicker base shapes — review sheet</h1>
<p class="lede">Every shape the picker offers, drawn from the same ring functions the geometry
uses, at the aspect ratio it builds at. The dashed circle is drawn <strong>where the switch
actually goes</strong> &mdash; at the shape's origin &mdash; and sized to the ~17&nbsp;mm clear
column an MX switch needs on a 40&nbsp;mm base.<br><br>
Every shape is now centred on its <em>pole of inaccessibility</em>: the interior point furthest
from the edge, which is the centre of the largest circle that fits inside. Bounding-box centring
is what put the switch off the middle of the triangle, the star, the heart and the shield.
Measured gain in switch room: heart&nbsp;+57%, triangle&nbsp;+33%, 3-point star&nbsp;+28%,
shield&nbsp;+19%.<br><br>
Gone: gear, ticket, flower, the letter shape, and the 371 auto-extracted icons. Polygon and star
now stop at 8.<br><br>
Tell me which of these to cut and which to redraw.</p>
${body}
`;

mkdirSync(join(ROOT, 'docs'), { recursive: true });
const out = join(ROOT, 'docs/shape-review.html');
writeFileSync(out, html, 'utf-8');
console.log(`${SHEET.reduce((n, [, i]) => n + i.length, 0)} tiles -> ${out}`);
