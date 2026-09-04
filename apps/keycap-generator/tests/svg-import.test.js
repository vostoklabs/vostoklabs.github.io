/*
  The keycap's SVG import: describe → choose → apply → parse.

  Run from the repo root:

    node_modules/.bin/esbuild apps/keycap-generator/tests/svg-import.test.js \
      --bundle --platform=node --format=esm \
      --alias:@xmldom/xmldom=./apps/clicker-generator/node_modules/@xmldom/xmldom \
      --outfile=apps/keycap-generator/.svg-import-test.mjs \

  (xmldom is the clicker's dev dependency; the alias borrows it rather than adding a second copy.)
      && node apps/keycap-generator/.svg-import-test.mjs
*/
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const { describeSvg, applySvgChoices, parseSvg } = await import('../src/logo.js');

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
};
const solid = (legend) => legend.contours.reduce((s, c) => s + ringArea(c), 0);
const triArea = (legend) => {
  let t = 0;
  for (const g of legend.strokeGeoms) {
    const pos = g.getAttribute('position');
    for (let i = 0; i + 2 < pos.count; i += 3) {
      t += ringArea([[pos.getX(i), pos.getY(i)], [pos.getX(i + 1), pos.getY(i + 1)], [pos.getX(i + 2), pos.getY(i + 2)]]);
    }
  }
  return t;
};

// Ian's sd-card icon from svgrepo, shape for shape: an artboard rect with no paint, then one
// filled path that is a thick outline with a hole and three pins inside it.
const sdCard = `<svg width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <g>
    <path fill="none" d="M0 0h24v24H0z"/>
    <path d="M8 4v5.793a2.5 2.5 0 0 1-.73 1.765L6 12.833V20h12V4H8zM7 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8.58a1 1 0 0 1 .292-.706l1.562-1.568A.5.5 0 0 0 6 9.793V3a1 1 0 0 1 1-1zm8 3h2v4h-2V5zm-3 0h2v4h-2V5zM9 5h2v4H9V5z"/>
  </g>
</svg>`;
const strokeOnly = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="34" fill="none" stroke="#000" stroke-width="2"/>
  <path d="M32 50 L48 66 L72 38" fill="none" stroke="#000" stroke-width="2"/>
</svg>`;
const whiteOnBlack = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#000"/>
  <circle cx="50" cy="50" r="30" fill="#fff"/>
</svg>`;

// ---------------------------------------------------------------- describe
const d = describeSvg(sdCard);
check('the sd-card file lists its two parts, biggest first',
  d.parts.length === 2 && d.parts[0].kind === 'none' && d.parts[1].kind === 'fill',
  d.parts.map((p) => `${p.index}:${p.kind}`).join(' '));
const w = describeSvg(whiteOnBlack);
check('the two things parseSvg drops on its own are reported, with the reason',
  w.parts.find((p) => p.index === 0)?.why === 'artboard' && w.parts.find((p) => p.index === 1)?.why === 'white',
  w.parts.map((p) => `${p.index}:${p.kind}/${p.why ?? '-'}`).join(' '));
check('a stroke reports its width, so the preview can say how thin it prints',
  describeSvg(strokeOnly).parts.every((p) => p.kind === 'stroke' && p.strokeWidth === 2),
  describeSvg(strokeOnly).parts.map((p) => p.strokeWidth).join(','));
check('a file that is not an SVG fails with a sentence',
  describeSvg('nope').issues.length === 1, describeSvg('nope').issues[0] ?? '(threw)');

// ---------------------------------------------------------------- untouched behaviour
const plain = parseSvg(sdCard);
check('an untouched file still parses as before: one shape, its hole and the pins as contours',
  plain.contours.length === 5 && plain.strokeGeoms.length === 0,
  `${plain.contours.length} contours, ${plain.strokeGeoms.length} ribbons`);
check('and white-on-black still drops the artboard and the white shape without being asked',
  (() => { try { parseSvg(whiteOnBlack); return false; } catch (e) { return /No drawable/.test(e.message); } })(),
  'throws "No drawable paths" — which is what the preview turns into an Off row you can flip');

// ---------------------------------------------------------------- apply
const asDrawn = parseSvg(applySvgChoices(sdCard, { 0: 'off', 1: 'fill' }));
check('the default choices reproduce the file exactly',
  Math.abs(solid(asDrawn) - solid(plain)) < 1e-6 && asDrawn.contours.length === 5,
  `solid ${solid(plain).toFixed(2)} -> ${solid(asDrawn).toFixed(2)}`);
const outlined = parseSvg(applySvgChoices(sdCard, { 0: 'off', 1: 'outline' }));
check('a filled part can be drawn as an outline instead',
  outlined.contours.length === 0 && outlined.strokeGeoms.length > 0 && triArea(outlined) < solid(plain) * 0.6,
  `${outlined.strokeGeoms.length} ribbons, area ${triArea(outlined).toFixed(2)} vs solid ${solid(plain).toFixed(2)}`);
const square = parseSvg(applySvgChoices(sdCard, { 0: 'fill', 1: 'fill' }));
check('and the artboard rect CAN be filled when the user says so — the preview shows the square',
  square.contours.length === 6 && solid(square) > solid(plain) + 500,
  `${square.contours.length} contours, solid ${solid(square).toFixed(0)}`);
const filledStrokes = parseSvg(applySvgChoices(strokeOnly, { 0: 'fill', 1: 'fill' }));
const ribbonStrokes = parseSvg(strokeOnly);
check('filling an outline drawing produces solid shapes rather than ribbons',
  filledStrokes.strokeGeoms.length === 0 && solid(filledStrokes) > triArea(ribbonStrokes) * 3,
  `ribbons ${triArea(ribbonStrokes).toFixed(0)} -> solid ${solid(filledStrokes).toFixed(0)}`);
const mixed = parseSvg(applySvgChoices(strokeOnly, { 0: 'fill', 1: 'outline' }));
check('one outline can be filled while another stays an outline',
  mixed.contours.length > 0 && mixed.strokeGeoms.length > 0, `${mixed.contours.length} contours + ${mixed.strokeGeoms.length} ribbons`);
const whiteKept = parseSvg(applySvgChoices(whiteOnBlack, { 0: 'off', 1: 'fill' }));
check('a white shape the user set to Fill is kept — the heuristic stands down for a chosen file',
  whiteKept.contours.length === 1 && solid(whiteKept) > 2000,
  `${whiteKept.contours.length} contour, solid ${solid(whiteKept).toFixed(0)}`);
const rewritten = applySvgChoices(sdCard, { 0: 'off', 1: 'outline' });
check('an off part stays in the file, hidden, so indices do not shift',
  describeSvg(rewritten).parts.length === 2 && /visibility="hidden"/.test(rewritten),
  `${describeSvg(rewritten).parts.length} parts after rewrite`);
check('the rewritten file is stamped, and an inline style carries the choice past any class',
  /data-vl-chosen="1"/.test(rewritten) && /style="[^"]*stroke:#000/.test(rewritten),
  rewritten.slice(0, 120).replace(/\n/g, ' '));


// --- the artboard rect, under a transform -----------------------------------------------
// A background rect wrapped in a scaled <g> is what Figma and Illustrator export. Judged on
// its width/height attributes it does not look full-bleed, so it was offered as "Fill" and
// carved as a slab over the icon.
const scaledArtboard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <g transform="scale(2)"><rect width="24" height="24" fill="#cccccc"/></g>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
const scaledParts = describeSvg(scaledArtboard).parts;
check('a full-bleed rect inside a scaled group is recognised as the artboard',
  scaledParts[0].why === 'artboard',
  `biggest part: area ${scaledParts[0].area}, why ${scaledParts[0].why}`);

const translatedArtboard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <g transform="translate(-10,-10)"><rect width="70" height="70" fill="#eeeeee"/></g>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
check('so is one that is larger than the artboard and offset over it',
  describeSvg(translatedArtboard).parts[0].why === 'artboard',
  JSON.stringify(describeSvg(translatedArtboard).parts[0]));

const smallScaledRect = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <g transform="scale(2)"><rect width="6" height="6" fill="#cccccc"/></g>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
check('a small rect under the same transform is NOT the artboard',
  describeSvg(smallScaledRect).parts.every((p) => p.why !== 'artboard'),
  JSON.stringify(describeSvg(smallScaledRect).parts));

const plainArtboard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="#ffffff"/>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
check('and an untransformed full-bleed rect still is',
  describeSvg(plainArtboard).parts[0].why === 'artboard',
  JSON.stringify(describeSvg(plainArtboard).parts[0]));

// The whole point of flagging it: the carve drops it, so the legend is the icon alone.
const carvedScaled = parseSvg(scaledArtboard);
check('and the carve drops it, leaving just the icon',
  carvedScaled.contours.length === 1,
  `${carvedScaled.contours.length} contours`);

console.log(failures ? `\n${failures} FAILED` : '\nthe keycap importer describes, the choice is written into the file, and every reader gets it');
process.exit(failures ? 1 : 0);
