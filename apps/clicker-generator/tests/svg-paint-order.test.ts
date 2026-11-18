/*
  An SVG prints what the file shows: what is painted on top stays on top.

  The carve used to settle every overlap by coverage, smallest colour first. A customer's mascot
  logo came out with its pink cheeks over its black eyes (the cheeks are smaller than all the black
  put together), with the thin black line round its tongue gone (the fills under it are smaller
  too), and with a step in the outline wherever a highlight stopped. Nothing warned: every colour
  was still there. The drawing here has the same layers and is ours.

    node apps/clicker-generator/tests/suites.mjs svg-paint-order
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import Module from 'manifold-3d';

(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
const { parseSvg } = await import('@vostok/trace');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');

type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type ClickerPart = import('../src/types.ts').ClickerPart;

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const wasm: any = await Module();
wasm.setup();
const asset = (p: string) => {
  const b = readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p));
  const raw = readModel(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, p);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  return wasm.Manifold.ofMesh(mesh);
};
const socketRaw = asset('switch/mx/mx-socket.3mf');
const stemRaw = asset('switch/mx/mx-stem.3mf');
const sbb = socketRaw.boundingBox();
const tbb = stemRaw.boundingBox();
const socket = socketRaw.translate([-(sbb.min[0] + sbb.max[0]) / 2, -(sbb.min[1] + sbb.max[1]) / 2, -sbb.max[2]]);
const stem = stemRaw.translate([-(tbb.min[0] + tbb.max[0]) / 2, -(tbb.min[1] + tbb.max[1]) / 2, 0]);

const PARAMS: BuildParams = {
  baseShape: 'outline', capWidthMm: 42.4, topThickness: 1.5, imageDepth: 0.8,
  imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
  designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34,
  tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
  floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [255, 255, 255], bodyColorRgb: [240, 240, 240],
  componentHeights: {},
  edgeSettings: [],
  extrudeChamfer: false,
  legendScale: 1, legendBold: 0, textBold: 0, keychainEnd: 'left', keychainSlideMm: 0, partOverrides: {},
} as BuildParams;

const CREAM = '#f0e0c0';
const SHADE = '#d8b088';
const PINK = '#ffb0d0';
const RED = '#c01020';
const TONGUE = '#ff6060';
const BLACK = '#000000';

// Spans 0..100 on both axes, so a file point maps straight to millimetres.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="${BLACK}"/>
  <circle cx="50" cy="50" r="46" fill="${CREAM}"/>
  <path d="M4 50 A46 46 0 0 1 50 4 L50 12 A38 38 0 0 0 12 50 Z" fill="${SHADE}"/>
  <path fill-rule="evenodd" fill="${BLACK}" d="M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50 Z M4 50 A46 46 0 1 0 96 50 A46 46 0 1 0 4 50 Z"/>
  <ellipse cx="30" cy="52" rx="12" ry="7" fill="${PINK}"/>
  <circle cx="30" cy="40" r="10" fill="${BLACK}"/>
  <rect x="40" y="60" width="20" height="16" fill="${RED}"/>
  <rect x="44" y="66" width="12" height="10" fill="${TONGUE}"/>
  <rect x="44" y="65" width="12" height="2" fill="${BLACK}"/>
</svg>`;

const set = parseSvg(SVG, { removeBg: false, asPainted: true });
const regions: BuildRegion[] = [];
set.regions.forEach((r, i) => {
  r.components.forEach((c, j) => {
    regions.push({ filamentRgb: r.quantRgb, coverage: r.coverage, rings: c.rings, partName: `top-color-${i}-${j}`, ...(c.layers ? { layers: c.layers } : {}) });
  });
});

check('a drawing of several colours says what order they were painted in',
  set.regions.every((r) => r.components.every((c) => (c.layers?.length ?? 0) > 0)),
  `${set.regions.length} colours`);

const black = set.regions.find((r) => r.quantRgb.join() === '0,0,0')!;
const blackPaints = black.components[0].layers!.map((l) => l.paint);
check('one colour painted at several moments keeps each of them',
  blackPaints.length >= 3 && blackPaints.every((p, i) => i === 0 || p > blackPaints[i - 1]),
  blackPaints.join(' < '));

const oneColour = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#000"/><rect x="1" y="1" width="2" height="2" fill="#000"/></svg>`, { asPainted: true });
check('a drawing of one colour has no order to keep',
  oneColour.regions[0].components[0].layers === undefined, 'no layers');

const notPainted = parseSvg(SVG, { removeBg: false });
check('other callers get what they always got',
  notPainted.regions.every((r) => r.components.every((c) => c.layers === undefined)), 'no layers without asPainted');

const { parts } = buildClicker(wasm, socket, stem, regions, set.outline, PARAMS);

/** Which colour part is on top at a point of the file. */
function colourAt(px: number, py: number): string | null {
  // The art's longest side is 40 mm at this size (42.4 less the 1.2 margin each side).
  const x = ((px - 50) / 100) * 40;
  const y = (-(py - 50) / 100) * 40;
  let best: { z: number; part: ClickerPart } | null = null;
  for (const part of parts) {
    if (part.group !== 'top') continue;
    const v = part.vertProperties, n = part.numProp, t = part.triVerts;
    for (let i = 0; i < t.length; i += 3) {
      const [ia, ib, ic] = [t[i] * n, t[i + 1] * n, t[i + 2] * n];
      const d = (v[ib + 1] - v[ic + 1]) * (v[ia] - v[ic]) + (v[ic] - v[ib]) * (v[ia + 1] - v[ic + 1]);
      if (d <= 1e-9) continue; // top-facing triangles only
      const l1 = ((v[ib + 1] - v[ic + 1]) * (x - v[ic]) + (v[ic] - v[ib]) * (y - v[ic + 1])) / d;
      const l2 = ((v[ic + 1] - v[ia + 1]) * (x - v[ic]) + (v[ia] - v[ic]) * (y - v[ic + 1])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = l1 * v[ia + 2] + l2 * v[ib + 2] + l3 * v[ic + 2];
      if (!best || z > best.z) best = { z, part };
    }
  }
  if (!best) return null;
  return '#' + best.part.colorRgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

const expectAt = (what: string, x: number, y: number, want: string) => {
  const got = colourAt(x, y);
  check(what, got === want, `(${x}, ${y}) is ${got}`);
};

expectAt('the eye is painted over the cheek, so it stays whole where they cross', 30, 47, BLACK);
expectAt('the cheek still shows below the eye', 30, 56, PINK);
expectAt('the thin line painted over the tongue is there', 50, 66, BLACK);
expectAt('the tongue shows under its line', 50, 72, TONGUE);
expectAt('the mouth shows round the tongue', 42, 72, RED);
expectAt('the body fills the middle', 62, 40, CREAM);

// Along the outline's inner edge, at the end of the highlight and past it: the ring is one width,
// and no step shows where the highlight stops.
const ringAt = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  let inner = 50;
  for (let r = 49.5; r > 40; r -= 0.05) {
    if (colourAt(50 + r * Math.cos(a), 50 - r * Math.sin(a)) !== BLACK) { inner = r; break; }
  }
  return inner;
};
const beside = ringAt(175);
const past = ringAt(185);
check('the outline is the same width where a highlight runs along it and where none does',
  Math.abs(beside - past) < 0.2,
  `inner edge at radius ${beside.toFixed(2)} beside the highlight, ${past.toFixed(2)} past it`);

console.log(failures ? `\n${failures} failed` : '\nALL SVG PAINT ORDER CHECKS PASSED');
process.exit(failures ? 1 : 0);
