/*
  Flat art opens with the colours it is drawn in.

  A flat cartoon has a handful of colours, and the picture window has to open with each as its
  own filament, printing in that colour: the Christmas pack's fifteen drawings are exactly this
  kind of art (two to five colours each, black outlines, small accents such as a red nose or an
  orange carrot), so the test reads the pack's own files. What is asserted, per drawing:

   - the colour finder lists every colour the file is drawn in, and nothing else (each listed
     colour is one of the file's own, each of the file's own is listed);
   - the window opens with that many filaments, one per colour, each in its own colour, and the
     trace gives every one of them a region;
   - asking for one more finds nothing finer: "+" ends at every colour it has;
   - the rail's Colors count asking for more than there are gets every colour, the same split.

  And the filament names: a grey is never called after a brown filament.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs flat-art-colours
*/
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from './image-bench.ts';
import { defaultFilaments, findColours, processImage, srgbToOklab, type RgbaImage } from '@vostok/trace';
import { filamentCountText, finerColours, splitMapping, splitPicture, stepperTop } from '../src/ui/colourSplit.ts';
import { filamentName } from '../src/ui/filamentName.ts';
import type { RGB } from '../src/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const DIR = join(process.cwd(), 'apps/clicker-generator/public/assets/packs/christmas/designs');
/** How many colours each drawing is drawn in, counted by eye on the drawings. */
const COLOURS: Record<string, number> = {
  'santa-hat': 3, tree: 5, snowman: 5, 'candy-cane': 3, gift: 3, stocking: 3, reindeer: 5, gingerbread: 4,
  bell: 3, wreath: 3, bauble: 4, snowflake: 2, cocoa: 4, star: 2, 'elf-hat': 4,
};
/** Two colours this close in Oklab are the same colour. */
const SAME = 0.06;
/** A colour of the file's own counts from this share of its opaque pixels: the files' only
 *  other palette entries are edge leftovers under 0.1 %, and the smallest real colour (the
 *  snowman's carrot) is 0.9 %. */
const OWN_SHARE = 0.005;

const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const near = (a: RGB, b: RGB) => {
  const p = srgbToOklab(a), q = srgbToOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= SAME;
};
/** The colours a file is drawn in: its opaque pixels' own colours, by share. */
function ownColours(img: RgbaImage): RGB[] {
  const count = new Map<string, number>();
  let opaque = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue;
    opaque++;
    const k = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return [...count].filter(([, n]) => n / opaque >= OWN_SHARE).map(([k]) => k.split(',').map(Number) as RGB);
}
/** The drawing flattened onto white, as a screenshot or a JPEG of it would be. */
function onWhite(img: RgbaImage): RgbaImage {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return { data, width: img.width, height: img.height };
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
check('the Christmas pack has its fifteen drawings', files.length === 15 && files.every((f) => f.replace('.png', '') in COLOURS), files.join(', '));

for (const file of files) {
  const id = file.replace('.png', '');
  const want = COLOURS[id];
  const img = decodePng(readFileSync(join(DIR, file)));
  const own = ownColours(img);
  const found = findColours(img, true);
  const rgbs = found.map((c) => c.rgb);

  check(`${id}: every colour it is drawn in is found, and nothing else`,
    found.length === want && own.length === want && rgbs.every((c) => own.some((o) => near(c, o))) && own.every((o) => rgbs.some((c) => near(c, o))),
    `found ${rgbs.map(hex).join(' ')}; drawn in ${own.map(hex).join(' ')}`);

  const n = defaultFilaments(found);
  const m = splitMapping(found, n);
  check(`${id}: opens with one filament per colour, each in its own colour`,
    n === want && new Set(m.colors.map((c) => c.group)).size === want && m.filaments.every((f, g) => m.colors.some((c) => c.group === g && c.rgb.join() === f.join())),
    `${n} filaments: ${m.filaments.map(hex).join(' ')}`);

  const set = processImage({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }, m.filaments.length, {
    removeBg: true, smoothing: 0.1, designMm: 35,
    customColors: m.colors.map((c) => c.rgb), mergeInto: m.colors.map((c) => c.group),
  });
  check(`${id}: the trace gives every filament a part`,
    set.regions.length === want && set.regions.every((r) => r.components.length > 0),
    set.regions.map((r) => `${hex(r.quantRgb)} ${r.components.length}`).join(', '));

  const finer = finerColours(img, true, {}, { candidates: found, detail: 0 }, want + 1);
  check(`${id}: "+" past the end finds nothing finer, so it ends at every colour it has`,
    finer.exhausted && finer.candidates.length === want && finer.candidates.every((c, k) => c.rgb.join() === rgbs[k].join()),
    `${finer.candidates.length} at detail ${finer.detail}, exhausted ${finer.exhausted}`);

  const rail = splitPicture(img, true, 12);
  check(`${id}: the rail's Colors count asking for 12 gets every colour, split as the window splits it`,
    rail.filaments.length === want && JSON.stringify(rail) === JSON.stringify(m),
    `${rail.filaments.length} filaments`);

  // Flattened onto white, the background removal takes the white round the drawing. The one
  // exception is the wreath's hole: white inside the ring touches no edge, so it stays a colour
  // until the customer takes it out by hand.
  const flat = findColours(onWhite(img), true);
  const flatWant = id === 'wreath' ? want + 1 : want;
  check(`${id}: flattened onto white, the same colours${id === 'wreath' ? ' and the white of its hole' : ''}`,
    flat.length === flatWant && rgbs.every((c) => flat.some((f) => near(c, f.rgb))),
    flat.map((c) => `${hex(c.rgb)} ${(c.coverage * 100).toFixed(1)}%`).join(', '));
}

{
  // By lightness alone, greys 60 to 110 sit nearer Brown than Gray and 180 nearer Beige.
  const greys = [60, 70, 80, 90, 100, 110].map((v) => filamentName([v, v, v]));
  check('a dark grey is called Black or Gray, never Brown', greys.every((g) => g === 'Black' || g === 'Gray'), greys.join(', '));
  const light = filamentName([180, 180, 180]);
  check('a light grey is Silver, not Beige', light === 'Silver', light);
  const warm = filamentName([92, 88, 86]);
  check('a grey with a hint of warmth is still a grey', warm === 'Gray', warm);
  const leaf = filamentName([69, 137, 46]);
  check('a leaf green is Green', leaf === 'Green', leaf);
  const named = [[2, 1, 0], [250, 218, 173], [116, 62, 34], [222, 36, 35]].map((c) => filamentName(c as RGB));
  check('the reindeer\'s colours keep their names: Black, Beige, Brown, Red', named.join() === 'Black,Beige,Brown,Red', named.join(', '));
}

{
  // The Colours stepper: "+" goes up to the longest list until the picture has nothing finer.
  const tops = [stepperTop(5, false), stepperTop(5, true), stepperTop(0, true)].join();
  check('the stepper\'s top is 12 until no finer colour exists, then the colours there are', tops === '12,5,1', tops);
  const lines = [filamentCountText(5, 5, true), filamentCountText(4, 5, true), filamentCountText(5, 5, false), filamentCountText(1, 1, true), filamentCountText(0, 0, false)];
  check('the count line says "every colour it has" only at the end, with every colour its own filament',
    lines.join('|') === '5 filaments, every colour it has|4 filaments|5 filaments|1 filament, every colour it has|no colours found', lines.join(' | '));
}

console.log(failures ? `\n${failures} FAILED` : '\nflat art opens with every colour it is drawn in');
process.exit(failures ? 1 : 0);
