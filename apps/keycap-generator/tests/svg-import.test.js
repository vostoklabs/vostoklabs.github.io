/*
  The keycap's SVG import: describe → choose → apply → parse.

  Part of pnpm test. By hand, from the repo root:

    node_modules/.bin/esbuild apps/keycap-generator/tests/svg-import.test.js \
      --bundle --platform=node --format=esm \
      --outfile=apps/keycap-generator/tests/.svg-import.test.mjs \
      && node apps/keycap-generator/tests/.svg-import.test.mjs
*/
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const { describeLogo, applySvgChoices, parseLogo, flattenSvgStyles } = await import('../src/logo.js');
// How the import window starts each part, from what `describeLogo` reports (the kit's own rule).
const { svgImportDefaults } = await import('@vostok/ui-kit');

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
const d = describeLogo(sdCard);
check('the sd-card file lists its two parts, biggest first',
  d.parts.length === 2 && d.parts[0].kind === 'none' && d.parts[1].kind === 'fill',
  d.parts.map((p) => `${p.index}:${p.kind}`).join(' '));
const w = describeLogo(whiteOnBlack);
check('the two things parseLogo drops on its own are reported, with the reason',
  w.parts.find((p) => p.index === 0)?.why === 'artboard' && w.parts.find((p) => p.index === 1)?.why === 'white',
  w.parts.map((p) => `${p.index}:${p.kind}/${p.why ?? '-'}`).join(' '));
check('a stroke reports its width, so the preview can say how thin it prints',
  describeLogo(strokeOnly).parts.every((p) => p.kind === 'stroke' && p.strokeWidth === 2),
  describeLogo(strokeOnly).parts.map((p) => p.strokeWidth).join(','));
check('a file that is not an SVG fails with a sentence',
  describeLogo('nope').issues.length === 1, describeLogo('nope').issues[0] ?? '(threw)');

// ---------------------------------------------------------------- untouched behaviour
const plain = parseLogo(sdCard);
check('an untouched file still parses as before: one shape, its hole and the pins as contours',
  plain.contours.length === 5 && plain.strokeGeoms.length === 0,
  `${plain.contours.length} contours, ${plain.strokeGeoms.length} ribbons`);
check('and white-on-black still drops the artboard and the white shape without being asked',
  (() => { try { parseLogo(whiteOnBlack); return false; } catch (e) { return /No drawable/.test(e.message); } })(),
  'throws "No drawable paths" — which is what the preview turns into an Off row you can flip');

// ---------------------------------------------------------------- apply
const asDrawn = parseLogo(applySvgChoices(sdCard, { 0: 'off', 1: 'fill' }));
check('the default choices reproduce the file exactly',
  Math.abs(solid(asDrawn) - solid(plain)) < 1e-6 && asDrawn.contours.length === 5,
  `solid ${solid(plain).toFixed(2)} -> ${solid(asDrawn).toFixed(2)}`);
const outlined = parseLogo(applySvgChoices(sdCard, { 0: 'off', 1: 'outline' }));
check('a filled part can be drawn as an outline instead',
  outlined.contours.length === 0 && outlined.strokeGeoms.length > 0 && triArea(outlined) < solid(plain) * 0.6,
  `${outlined.strokeGeoms.length} ribbons, area ${triArea(outlined).toFixed(2)} vs solid ${solid(plain).toFixed(2)}`);
const square = parseLogo(applySvgChoices(sdCard, { 0: 'fill', 1: 'fill' }));
check('and the artboard rect CAN be filled when the user says so — the preview shows the square',
  square.contours.length === 6 && solid(square) > solid(plain) + 500,
  `${square.contours.length} contours, solid ${solid(square).toFixed(0)}`);
const filledStrokes = parseLogo(applySvgChoices(strokeOnly, { 0: 'fill', 1: 'fill' }));
const ribbonStrokes = parseLogo(strokeOnly);
check('filling an outline drawing produces solid shapes rather than ribbons',
  filledStrokes.strokeGeoms.length === 0 && solid(filledStrokes) > triArea(ribbonStrokes) * 3,
  `ribbons ${triArea(ribbonStrokes).toFixed(0)} -> solid ${solid(filledStrokes).toFixed(0)}`);
const mixed = parseLogo(applySvgChoices(strokeOnly, { 0: 'fill', 1: 'outline' }));
check('one outline can be filled while another stays an outline',
  mixed.contours.length > 0 && mixed.strokeGeoms.length > 0, `${mixed.contours.length} contours + ${mixed.strokeGeoms.length} ribbons`);
const whiteKept = parseLogo(applySvgChoices(whiteOnBlack, { 0: 'off', 1: 'fill' }));
check('a white shape the user set to Fill is kept — the heuristic stands down for a chosen file',
  whiteKept.contours.length === 1 && solid(whiteKept) > 2000,
  `${whiteKept.contours.length} contour, solid ${solid(whiteKept).toFixed(0)}`);
const rewritten = applySvgChoices(sdCard, { 0: 'off', 1: 'outline' });
check('an off part stays in the file, hidden, so indices do not shift',
  describeLogo(rewritten).parts.length === 2 && /visibility="hidden"/.test(rewritten),
  `${describeLogo(rewritten).parts.length} parts after rewrite`);
check('the rewritten file is stamped, and the choice is written as attributes with no inline style left',
  /data-vl-chosen="1"/.test(rewritten) && /stroke="#000"/.test(rewritten) && !/style=/.test(rewritten),
  rewritten.slice(0, 120).replace(/\n/g, ' '));

// The cascade SVGLoader would resolve through the CSSOM — which a strict style-src policy
// blocks — is resolved into attributes first, so a class-styled outline drawing reads as an
// outline everywhere, and the block and the style attribute are gone from what comes out.
const classOutline = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>.a{fill:none;stroke:#000;stroke-width:3} .b { fill : #fff }</style>
  <g class="a"><circle cx="50" cy="50" r="30"/></g>
  <rect class="b" style="stroke:#000" x="10" y="10" width="20" height="20"/>
</svg>`;
const flat = flattenSvgStyles(classOutline);
check('a class rule on a group, and a style attribute, become presentation attributes',
  /<g[^>]*fill="none"[^>]*stroke="#000"[^>]*stroke-width="3"/.test(flat) && /<rect[^>]*fill="#fff"[^>]*stroke="#000"/.test(flat),
  flat.replace(/\s+/g, ' ').slice(0, 220));
check('and the style block and the style attribute are gone',
  !/<style/.test(flat) && !/style=/.test(flat), flat.replace(/\s+/g, ' ').slice(0, 120));
check('so the class-styled outline is described as an outline, 3 wide',
  describeLogo(classOutline).parts.some((p) => p.kind === 'stroke' && p.strokeWidth === 3),
  describeLogo(classOutline).parts.map((p) => `${p.kind}/${p.strokeWidth ?? '-'}/${p.why ?? '-'}`).join(' '));
check('a file with no styles to resolve comes back byte-for-byte',
  flattenSvgStyles(strokeOnly) === strokeOnly, 'untouched');


// --- the artboard rect, under a transform -----------------------------------------------
// A background rect wrapped in a scaled <g> is what Figma and Illustrator export. Judged on
// its width/height attributes it does not look full-bleed, so it was offered as "Fill" and
// carved as a slab over the icon.
const scaledArtboard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <g transform="scale(2)"><rect width="24" height="24" fill="#cccccc"/></g>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
const scaledParts = describeLogo(scaledArtboard).parts;
check('a full-bleed rect inside a scaled group is recognised as the artboard',
  scaledParts[0].why === 'artboard',
  `biggest part: area ${scaledParts[0].area}, why ${scaledParts[0].why}`);

const translatedArtboard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <g transform="translate(-10,-10)"><rect width="70" height="70" fill="#eeeeee"/></g>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
check('so is one that is larger than the artboard and offset over it',
  describeLogo(translatedArtboard).parts[0].why === 'artboard',
  JSON.stringify(describeLogo(translatedArtboard).parts[0]));

const smallScaledRect = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <g transform="scale(2)"><rect width="6" height="6" fill="#cccccc"/></g>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
check('a small rect under the same transform is NOT the artboard',
  describeLogo(smallScaledRect).parts.every((p) => p.why !== 'artboard'),
  JSON.stringify(describeLogo(smallScaledRect).parts));

const plainArtboard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="#ffffff"/>
  <path fill="#000" d="M4 4h8v8H4z"/>
</svg>`;
check('and an untransformed full-bleed rect still is',
  describeLogo(plainArtboard).parts[0].why === 'artboard',
  JSON.stringify(describeLogo(plainArtboard).parts[0]));

// The whole point of flagging it: the carve drops it, so the legend is the icon alone.
const carvedScaled = parseLogo(scaledArtboard);
check('and the carve drops it, leaving just the icon',
  carvedScaled.contours.length === 1,
  `${carvedScaled.contours.length} contours`);

// --- opacity: a legend is drawn by its paint ----------------------------------------------
// The legend is one colour, and the keycap reads a file without its opacities, as it always has:
// a part the file hides at zero opacity is still one of its shapes, listed and carved like any
// other. (The shared reader alone would call it invisible.)
const hidden = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="30" height="30" fill="#000" fill-opacity="0"/>
  <path d="M60 90 L90 60" fill="none" stroke="#000" stroke-width="4" opacity="0"/>
  <circle cx="70" cy="30" r="15" fill="#000"/>
</svg>`;
check('a part a file hides at zero opacity is described by its paint',
  describeLogo(hidden).parts.map((p) => `${p.index}:${p.kind}`).sort().join(' ') === '0:fill 1:stroke 2:fill',
  describeLogo(hidden).parts.map((p) => `${p.index}:${p.kind}`).join(' '));
const hiddenAsFiled = parseLogo(hidden);
check('and carved by its paint: the square, the line and the disc',
  hiddenAsFiled.contours.length === 2 && hiddenAsFiled.strokeGeoms.length === 1,
  `${hiddenAsFiled.contours.length} contours, ${hiddenAsFiled.strokeGeoms.length} ribbon`);
const hiddenOff = parseLogo(applySvgChoices(hidden, { 0: 'off', 1: 'off', 2: 'fill' }));
check('turned off in the window, it is left out: the disc alone',
  hiddenOff.contours.length === 1 && hiddenOff.strokeGeoms.length === 0,
  `${hiddenOff.contours.length} contour, ${hiddenOff.strokeGeoms.length} ribbons`);

// A board saved before the window wrote opacities: its file keeps the zero opacity under a part
// that was on, and that part must still carve.
const savedEarlier = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" data-vl-chosen="1">
  <rect x="10" y="10" width="30" height="30" fill="#000" fill-opacity="0" stroke="none" visibility="visible"/>
  <circle cx="70" cy="30" r="15" fill="#000" stroke="none" visibility="visible"/>
</svg>`;
check('a part a board saved earlier had on still carves, zero opacity and all',
  parseLogo(savedEarlier).contours.length === 2, `${parseLogo(savedEarlier).contours.length} contours`);

// The written choice: a part turned on is painted at full strength in the file too, so the file,
// and the tile's picture of it, show the shape that will carve.
const turnedOn = applySvgChoices(hidden, { 0: 'fill', 1: 'outline', 2: 'fill' });
check('Fill on a part hidden at zero opacity writes it at full opacity',
  /<rect[^>]*fill-opacity="1"[^>]*opacity="1"/.test(turnedOn) || /<rect[^>]*opacity="1"[^>]*fill-opacity="1"/.test(turnedOn),
  (turnedOn.match(/<rect[^>]*>/) ?? [''])[0]);
const strokeHidden = applySvgChoices(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M10 90 L90 10" fill="none" stroke="#000" stroke-width="4" stroke-opacity="0"/>
</svg>`, { 0: 'outline' });
check('and Outline on a line hidden by its stroke opacity writes the stroke at full opacity',
  /stroke-opacity="1"/.test(strokeHidden) && /\sopacity="1"/.test(strokeHidden),
  (strokeHidden.match(/<path[^>]*>/) ?? [''])[0]);

// --- how the window starts each part, as before ---------------------------------------------
// A box maker's cut file: each panel a red line over a white fill nobody sees. Every row starts
// as "White in the file", Off, as it always has, rather than filled into solid slabs.
const boxMaker = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">
  <path style="stroke: rgb(255,0,0); stroke-width: 0.2; fill: rgb(255,255,255); fill-opacity: 0; opacity: 1;" d="M10 10 H50 V50 H10 Z"/>
  <path style="stroke: rgb(255,0,0); stroke-width: 0.2; fill: rgb(255,255,255); fill-opacity: 0; opacity: 1;" d="M20 20 H40 V30 H20 Z"/>
  <path style="stroke: rgb(255,0,0); stroke-width: 0.2; fill: rgb(255,255,255); fill-opacity: 0; opacity: 1;" d="M60 10 H90 V50 H60 Z"/>
</svg>`;
const boxParts = describeLogo(boxMaker).parts;
const boxStart = svgImportDefaults(boxParts);
check('a box maker\'s cut file starts with every panel "White in the file", Off',
  boxParts.length === 3 && boxParts.every((p) => p.kind === 'fill' && p.why === 'white' && boxStart[p.index].mode === 'off'),
  boxParts.map((p) => `${p.kind}/${p.why ?? '-'}->${boxStart[p.index].mode}`).join(' '));
// A visible line beside a filled shape the file hides: the line still starts as an Outline.
const lineAndHidden = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="30" height="30" fill="#000" opacity="0"/>
  <path d="M40 90 L90 40" fill="none" stroke="#000" stroke-width="4"/>
</svg>`;
const lineStart = svgImportDefaults(describeLogo(lineAndHidden).parts);
check('a line beside a shape the file hides starts as an Outline, the shape as a Fill',
  lineStart[0].mode === 'fill' && lineStart[1].mode === 'outline',
  `shape ${lineStart[0].mode}, line ${lineStart[1].mode}`);

// --- what the keycap's own reading adds to the shared reader --------------------------------
check('the legend keeps the file\'s view box as its em',
  JSON.stringify(parseLogo(sdCard).view) === '{"w":24,"h":24}', JSON.stringify(parseLogo(sdCard).view));
check('…and has none when the file gives no size',
  parseLogo('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5" fill="#000"/></svg>').view === null, 'null');
check('the window\'s parts carry no colour, so no row shows a swatch',
  describeLogo(sdCard).parts.every((p) => !('hex' in p)), JSON.stringify(describeLogo(sdCard).parts[0]));
const nineColours = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 10">${
  ['#c00', '#0c0', '#00c', '#cc0', '#0cc', '#c0c', '#600', '#060', '#006'].map((c, i) => `<rect x="${i * 10}" y="0" width="8" height="8" fill="${c}"/>`).join('')}</svg>`;
check('and a file of many colours raises no issue: the legend is one colour',
  describeLogo(nineColours).issues.length === 0 && describeLogo(nineColours).parts.length === 9,
  JSON.stringify(describeLogo(nineColours).issues));

console.log(failures ? `\n${failures} FAILED` : '\nthe keycap importer describes, the choice is written into the file, and every reader gets it');
process.exit(failures ? 1 : 0);
