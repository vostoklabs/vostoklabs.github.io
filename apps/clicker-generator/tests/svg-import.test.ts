/*
  The SVG import preview.

  "SVG import doesn't work" is the most reported problem on the listing, and the cause is
  almost never a broken tracer — it is that the file has no FILLS. `parseSvg` traces fills, and
  turns a stroke into ribbon geometry: a 1-unit stroke on a 100-unit artboard becomes a sliver
  about 0.4 mm wide at print scale, which is one extrusion width. It either vanishes into the
  base colour or prints as fuzz, and the app said nothing at all about why.

  So the fix is diagnosis plus a switch, and this proves both: that `describeSvg` names the
  problem, and that `fillStrokes` actually changes the geometry rather than just the wording.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/svg-import.test.ts \
      --bundle --platform=node --format=esm --external:@xmldom/xmldom \
      --outfile=apps/clicker-generator/.svg-import-test.mjs \
      && node apps/clicker-generator/.svg-import-test.mjs
*/
import { DOMParser } from '@xmldom/xmldom';
(globalThis as any).DOMParser = DOMParser;
const { describeSvg, parseSvg } = await import('../src/image/logo.ts');

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/** The shape of file people actually upload: an outline drawing, no fills anywhere. */
const strokeOnly = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="34" fill="none" stroke="#000" stroke-width="2"/>
  <path d="M32 50 L48 66 L72 38" fill="none" stroke="#000" stroke-width="2"/>
</svg>`;

const filled = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80" fill="#c8102e"/>
  <circle cx="50" cy="50" r="20" fill="#ffffff"/>
</svg>`;

const unpainted = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80" fill="#0a5cd5"/>
  <path d="M20 20 L80 20 L80 80 Z" fill="none" stroke="none"/>
</svg>`;

// ---------------------------------------------------------------- diagnosis

const d1 = describeSvg(strokeOnly);
check(
  'a stroke-only file is recognised as having no fills',
  d1.parts.length === 2 && d1.parts.every((p) => p.kind === 'stroke'),
  `${d1.parts.length} parts, kinds: ${d1.parts.map((p) => p.kind).join(', ')}`,
);
check(
  'and the part list, not an issue line, is what says so',
  d1.issues.length === 0,
  d1.issues.join(' | ') || 'issues are reserved for what a row cannot say',
);

const d2 = describeSvg(filled);
check(
  'a properly filled file reports no problems',
  d2.issues.length === 0 && d2.parts.every((p) => p.kind === 'fill'),
  d2.issues.join(' | ') || `${d2.parts.length} filled parts, nothing to report`,
);
check(
  'parts are listed biggest first, so the list starts with what matters',
  d2.parts[0].area > d2.parts[1].area,
  `${d2.parts.map((p) => Math.round(p.area)).join(' > ')}`,
);

const d3 = describeSvg(unpainted);
check(
  'a shape with no paint at all is reported as such, so the preview can default it to Off',
  d3.parts.some((p) => p.kind === 'none'),
  d3.parts.map((p) => p.kind).join(', '),
);

check(
  'a file that is not an SVG fails with a sentence, not an exception',
  describeSvg('not an svg at all').issues.length > 0,
  describeSvg('not an svg at all').issues[0] ?? '(threw)',
);

// ---------------------------------------------------------------- the fix actually works

/** Total ring area — the honest measure of "is there anything solid here". */
const solidArea = (rs: any): number => {
  let total = 0;
  for (const r of rs.regions) {
    for (const c of r.components) {
      for (const ring of c.rings) {
        let a = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        }
        total += Math.abs(a / 2);
      }
    }
  }
  return total;
};

const asStrokes = parseSvg(strokeOnly);
const asFills = parseSvg(strokeOnly, { fillStrokes: true });
check(
  'filling the outlines produces far more solid area than tracing them as strokes',
  solidArea(asFills) > solidArea(asStrokes) * 3,
  `strokes ${solidArea(asStrokes).toFixed(3)} -> filled ${solidArea(asFills).toFixed(3)} `
  + `(${(solidArea(asFills) / Math.max(1e-9, solidArea(asStrokes))).toFixed(1)}x)`,
);
// The stroke width is reported so the preview can say "0.8 mm at your size" rather than leave
// the user to discover it on the plate.
const sw = describeSvg(strokeOnly).parts[0].strokeWidth;
check(
  'the stroke width is reported, so the preview can say how thin it will print',
  typeof sw === 'number' && sw > 0,
  `${sw} units on a 100-unit artboard = ${((sw! / 100) * 40).toFixed(2)} mm on a 40 mm clicker`,
);

// ---------------------------------------------------------------- overrides

// Colours must survive the trip as the AUTHOR wrote them. three's ColorManagement converts to
// linear on construction, and reading the raw components back turned every imported colour
// dark — #c8102e arrived as #930107. Only black and white were unaffected, which is why the
// bundled sample never showed it.
const plain = parseSvg(filled);
const plainColours = plain.regions.map((r: any) => r.quantRgb.join(','));
check(
  'an imported colour is the colour the file specified, not a linear-light version of it',
  plainColours.includes('200,16,46'),
  `#c8102e -> ${plainColours.join(' | ')} (the bug gave 147,1,7)`,
);
const recoloured = parseSvg(filled, { overrides: { 0: { mode: 'fill', hex: '#00ae42' } } });
const colours = recoloured.regions.map((r: any) => r.quantRgb.join(','));
check(
  'recolouring a part changes the colour it traces as',
  colours.includes('0,174,66'),
  colours.join(' | '),
);
const dropped = parseSvg(filled, { overrides: { 0: { mode: 'off' } } });
check(
  'skipping a part removes it entirely',
  dropped.regions.length === parseSvg(filled).regions.length - 1,
  `${parseSvg(filled).regions.length} regions -> ${dropped.regions.length}`,
);
check(
  'and skipping does not disturb the parts that remain',
  solidArea(dropped) > 0,
  `${solidArea(dropped).toFixed(3)} of solid area left`,
);

// ---------------------------------------------------------------- per-part mode
// "I want to change what is filled and what is not" — per part, in both directions.
const outlined = parseSvg(filled, { overrides: { 0: { mode: 'outline' }, 1: { mode: 'fill' } } });
check(
  'a filled part can be drawn as an outline instead',
  solidArea(outlined) < solidArea(parseSvg(filled)) * 0.6 && outlined.regions.length === 2,
  `solid ${solidArea(parseSvg(filled)).toFixed(3)} -> ${solidArea(outlined).toFixed(3)} with the square as an outline`,
);
const oneFilled = parseSvg(strokeOnly, { overrides: { 0: { mode: 'fill' }, 1: { mode: 'outline' } } });
check(
  'and one outline can be filled while another stays an outline',
  solidArea(oneFilled) > solidArea(asStrokes) * 3 && solidArea(oneFilled) < solidArea(asFills),
  `strokes ${solidArea(asStrokes).toFixed(3)} < mixed ${solidArea(oneFilled).toFixed(3)} < all filled ${solidArea(asFills).toFixed(3)}`,
);
// The invisible artboard rectangle icon sites wrap their art in must NOT be filled by the
// outlines switch: that is a solid square over the whole design.
const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="none" d="M0 0h24v24H0z"/>
  <circle cx="12" cy="12" r="8" fill="none" stroke="#000" stroke-width="2"/>
</svg>`;
const wrappedFilled = parseSvg(wrapped, { fillStrokes: true });
check(
  '"fill the outlines" leaves an unpainted artboard rectangle alone',
  wrappedFilled.regions.length === 1 && solidArea(wrappedFilled) < 0.9,
  `${wrappedFilled.regions.length} region(s), solid area ${solidArea(wrappedFilled).toFixed(3)} (a filled artboard would be 1.0)`,
);

console.log(failures ? `\n${failures} FAILED` : '\nthe importer says why an SVG will not print, and the fix changes the geometry');
process.exit(failures ? 1 : 0);
