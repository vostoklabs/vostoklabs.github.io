// Contours drawn twice, read the way a font fills them.
//
// Fonts fill by the non-zero rule: where a contour is drawn twice the SAME way round, the region
// inside it winds twice, and what that leaves as ink depends on what is around it. Material
// Symbols' "biotech" draws its microscope's eyepiece twice, inside the counter of the body: the
// font fills it, and dropping both copies (as even-odd would) cut it out of the engraving.
// Drawn twice inside the ink instead ("eco"), the copies add nothing, and dropping both is right.
// Drawn twice the OPPOSITE way round (the smileys, the filled heart), the pair encloses nothing.
//
// Each case below is checked against the fill itself: points on a grid over the shape, ink by
// the contours' non-zero winding, against ink by the islands (inside some island's outer ring
// and none of its holes, the union a build cuts).
//   node tests/font-fill.test.mjs
import { build as esbuild } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
// Bundled in memory: nothing is written next to the test.
const bundle = await esbuild({
  stdin: { contents: `export * from '../src/index.ts';`, resolveDir: here, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', logLevel: 'error', write: false,
});
const S = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`);
};

/** Grid points where the islands and the font's fill disagree. */
function disagreements(contours, n = 80) {
  const islands = S.islandsFromContours(contours);
  const rings = contours.filter((c) => c.length >= 3);
  const b = S.bboxOf([rings]);
  let off = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Offset by an odd fraction, so no sample sits on an edge drawn on round numbers.
      const p = [b.minX + (b.maxX - b.minX) * ((i + 0.5137) / n), b.minY + (b.maxY - b.minY) * ((j + 0.5291) / n)];
      if ((S.windingNumber(p, rings) !== 0) !== S.insideUnion(islands, p)) off++;
    }
  }
  return off;
}

const square = (cx, cy, s, ccw = true) => {
  const h = s / 2;
  const r = [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
  return ccw ? r : r.reverse();
};

// ---- 1. the four ways a contour comes twice, built by hand

{
  // biotech's construction: a body (clockwise, as a TrueType outer is), a counter in it, and in
  // the counter a contour drawn twice the body's other way round. The font fills the twice-drawn
  // one: it is an island of its own, sitting in the counter.
  const contours = [square(0, 0, 20, false), square(0, 0, 12), square(0, 0, 4), square(0, 0, 4)];
  check('drawn twice inside a counter: filled, as the font fills it', disagreements(contours) === 0, `${disagreements(contours)} samples off`);
  const islands = S.islandsFromContours(contours);
  check('...an island of its own, the body keeping its counter', islands.length === 2 && islands.some((isl) => isl.length === 2) && islands.some((isl) => isl.length === 1), JSON.stringify(islands.map((isl) => isl.length)));
}
{
  // eco's: drawn twice inside the ink. Winding -1 + 2 is still ink: the copies add nothing.
  const contours = [square(0, 0, 20, false), square(0, 0, 4), square(0, 0, 4)];
  check('drawn twice inside the ink: adds nothing', disagreements(contours) === 0, `${disagreements(contours)} samples off`);
  check('...one island, no hole', S.islandsFromContours(contours).map((isl) => isl.length).join() === '1');
}
{
  const contours = [square(0, 0, 6), square(0, 0, 6)];
  check('drawn twice on its own: one island', S.islandsFromContours(contours).length === 1 && disagreements(contours) === 0);
}
{
  const contours = [square(0, 0, 20, false), square(0, 0, 6), square(0, 0, 6, false)];
  check('drawn twice the opposite way round: the pair encloses nothing', disagreements(contours) === 0 && S.islandsFromContours(contours).map((isl) => isl.length).join() === '1');
}
{
  // cancelCoincidentRings on its own keeps the even-odd rule it always had: any two copies cancel.
  const pair = [square(0, 0, 6), square(0, 0, 6)];
  check('cancelCoincidentRings alone: two copies cancel, as even-odd fills them', S.cancelCoincidentRings(pair).length === 0);
  check('...and with fill: "nonzero" a lone pair the same way round keeps one copy', S.cancelCoincidentRings(pair, { fill: 'nonzero' }).length === 1);
  const opposite = [square(0, 0, 6), square(0, 0, 6, false)];
  check('...while an opposite pair cancels under either rule', S.cancelCoincidentRings(opposite).length === 0 && S.cancelCoincidentRings(opposite, { fill: 'nonzero' }).length === 0);
}

// ---- 2. the Material Symbols that draw a contour twice, from the icon font itself

const require_ = createRequire(fileURLToPath(new URL('../../fonts/package.json', import.meta.url)));
const opentype = require_('opentype.js');
/** One of the bundled faces, by its file name. */
const fontNamed = (file) => {
  const buf = readFileSync(fileURLToPath(new URL(`../../fonts/src/fonts/${file}`, import.meta.url)));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const font = fontNamed('icon-fallback.ttf');

/** A glyph's contours, Y up, curves flattened to 8 steps. */
function contoursOf(char, from = font) {
  const out = [];
  let cur = [];
  for (const c of from.getPath(char, 0, 0, 100).commands) {
    if (c.type === 'M') { if (cur.length > 2) out.push(cur); cur = [[c.x, -c.y]]; }
    else if (c.type === 'L') cur.push([c.x, -c.y]);
    else if (c.type === 'Q' || c.type === 'C') {
      const p0 = cur[cur.length - 1];
      if (!p0) continue;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        if (c.type === 'Q') cur.push([(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c.x1 + t * t * c.x, (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * -c.y1 + t * t * -c.y]);
        else cur.push([(1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * c.x1 + 3 * (1 - t) * t * t * c.x2 + t ** 3 * c.x, (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * -c.y1 + 3 * (1 - t) * t * t * -c.y2 + t ** 3 * -c.y]);
      }
    } else if (c.type === 'Z') { if (cur.length > 2) out.push(cur); cur = []; }
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

// biotech: the eyepiece drawn twice inside the body's counter, which the font fills. The rest of
// these draw a contour twice too, where it adds nothing (eco, engineering, hotel_class,
// person_play, phone_enabled), or the opposite way round (favorite, mood): all as the font fills
// them. A sample can land on an edge the flattening moved a hair, so a few are allowed.
const GLYPHS = { biotech: '\u{ea3a}', eco: '\u{ea35}', engineering: '\u{ea3d}', hotel_class: '\u{e743}', person_play: '\u{f7fd}', phone_enabled: '\u{e9cd}', favorite: '\u{e87d}', mood: '\u{e7f2}' };
for (const [id, char] of Object.entries(GLYPHS)) {
  const contours = contoursOf(char);
  const off = disagreements(contours, 100);
  check(`${id}: the islands fill as the font does`, contours.length > 0 && off <= 10, `${off} of 10000 samples off`);
}

// ---- 3. letters that draw a contour twice
//
// Ordinary text meets the same rule. Wallpoet's Ä draws each dot of its umlaut twice the same way
// round, and Jura's ị its dot below: each pair stands on its own, so the font fills it. Read as
// even-odd, the two copies cancelled and the letters lost their dots.
for (const [file, char] of [['wallpoet.ttf', 'Ä'], ['jura.ttf', 'ị']]) {
  const contours = contoursOf(char, fontNamed(file));
  const off = disagreements(contours, 100);
  check(`${file.replace('.ttf', '')} ${char}: the islands fill as the font does, dots and all`, contours.length > 0 && off <= 10, `${off} of 10000 samples off`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  · ${f}`);
  process.exit(1);
}
