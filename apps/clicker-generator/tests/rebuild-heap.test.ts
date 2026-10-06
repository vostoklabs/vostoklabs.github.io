/*
  A rebuild frees everything it makes.

  manifold's objects live in its WASM heap, which only grows: an object a rebuild forgets to free
  stays for the life of the page, and a customer dragging a slider rebuilds hundreds of times.
  Each kind of rebuild below runs twice to warm up and then five times more, and the heap's bytes
  in use, counted chunk by chunk (packages/laser/tests/heap-probe.mjs), must not move. A build
  that throws part way through has to free what it made as well.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs rebuild-heap
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import Module from 'manifold-3d';
import { readModel } from '@vostok/export/read';
import { parseSvg } from '@vostok/trace';
import { captureHeaps, heapInUse } from '../../../packages/laser/tests/heap-probe.mjs';
import { buildClicker } from '../src/geometry/buildClicker';
import { buildFitStrip, FIT_TEST_STEP_MM, fitTestLadder } from '../src/geometry/fitStrip';
import { applyStemFit } from '../src/geometry/stemFit';
import type { BuildParams, BuildRegion, Ring, RGB } from '../src/types';

// Before manifold loads: the meter finds its heap as the module is made.
const heaps = captureHeaps();
(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
const wasm = await Module();
wasm.setup();
const heap = heaps[heaps.length - 1];

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
};

/** An asset solid as the worker hands it over: XY-centred, the socket's top face at Z 0. */
function asset(path: string, topAtZero: boolean) {
  const raw = readModel(readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', path)), path);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  const s = wasm.Manifold.ofMesh(mesh);
  const bb = s.boundingBox();
  const out = s.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, topAtZero ? -bb.max[2] : 0]);
  s.delete();
  return out;
}
const socket = asset('switch/mx/mx-socket.3mf', true);
const stem = asset('switch/mx/mx-stem.3mf', false);

const WHITE: RGB = [247, 247, 245];
const DEFAULTS = {
  baseShape: 'outline', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8,
  imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
  designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34,
  tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
  floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: WHITE, bodyColorRgb: [240, 240, 240],
  componentHeights: {},
  edgeSettings: [
    { target: 'capTop', style: 'chamfer', radius: 0.5 },
    { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
  ],
  extrudeChamfer: false,
  legendScale: 1, legendBold: 0, textBold: 0, keychainEnd: 'left', keychainSlideMm: 0, partOverrides: {},
} as unknown as BuildParams;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="46" fill="#0a5cd5"/>
  <path d="M50 78 C20 58 16 36 32 28 C42 23 48 30 50 36 C52 30 58 23 68 28 C84 36 80 58 50 78 Z" fill="#f7f7f5"/>
  <circle cx="50" cy="16" r="5" fill="#c8102e"/>
</svg>`;
const art = parseSvg(SVG, { removeBg: true, asPainted: true });
const regions: BuildRegion[] = art.regions.flatMap((r, i) =>
  r.components.map((comp, j) => ({ filamentRgb: r.quantRgb, coverage: r.coverage, rings: comp.rings, partName: `top-color-${i}-${j}` })) as BuildRegion[]);
// Each label a drawn glyph with a counter rather than a font's: the strip cuts it the same way,
// and the font registry stays out of a node test.
const GLYPH: Ring[] = [[[0, 0], [6, 0], [6, 10], [0, 10]], [[2, 2], [2, 8], [4, 8], [4, 2]]];
const labels = fitTestLadder(0, FIT_TEST_STEP_MM).map((fitMm) => ({ fitMm, rings: GLYPH }));

const clicker = (over: Partial<BuildParams>, w = wasm) => () => void buildClicker(w, socket, stem, regions, art.outline, { ...DEFAULTS, ...over });
/** Each colour part's own top edge chamfered, as Edges mode sets it. */
const INLAYS_CHAMFERED = {
  edgeSettings: [...DEFAULTS.edgeSettings, ...regions.map((r) => ({ target: r.partName, style: 'chamfer', radius: 0.4 }))],
} as Partial<BuildParams>;

/** What a kind of rebuild leaves in the heap, in bytes a rebuild, after two to warm up. */
function leftBehind(run: () => void): number {
  run();
  run();
  const before = heapInUse(heap);
  for (let i = 0; i < 5; i++) run();
  return (heapInUse(heap) - before) / 5;
}

const KINDS: [string, () => void][] = [
  ['an SVG on a circle, top and base chamfered', clicker({ baseShape: 'circle' } as Partial<BuildParams>)],
  ['an SVG on its own outline, stem fit +0.1', clicker({ stemFitMm: 0.1 })],
  ['an SVG on a star with a keychain loop', clicker({ baseShape: 'star', shapeSides: 5, shapeArmPct: 0.56, keychain: { enabled: true, style: 'loop', angleDeg: 135, holeDiameterMm: 5.2, offsetMm: 0 } } as Partial<BuildParams>)],
  ['every colour part chamfered', clicker(INLAYS_CHAMFERED)],
  ['the fit test strip', () => void buildFitStrip(wasm, stem, { labels, colorRgb: WHITE })],
  ['stem fit +0.1 on its own', () => applyStemFit(wasm, stem, 0.1).solid.delete()],
  ['stem fit -0.1 on its own', () => applyStemFit(wasm, stem, -0.1).solid.delete()],
];

// The chamfered kind really cuts: its first colour part comes out with more triangles.
const triangles = (over: Partial<BuildParams>) =>
  buildClicker(wasm, socket, stem, regions, art.outline, { ...DEFAULTS, ...over }).parts.find((p) => p.name === regions[0]?.partName)?.triVerts.length ?? 0;
const [sharp, chamfered] = [triangles({}), triangles(INLAYS_CHAMFERED)];
check('a colour part chamfered in Edges mode is cut', chamfered > sharp && sharp > 0, `${sharp / 3} triangles sharp, ${chamfered / 3} chamfered`);

const inUse = heapInUse(heap);
check('the heap can be read', Number.isFinite(inUse), Number.isFinite(inUse) ? `${inUse} B in use` : 'no allocator found to walk, so nothing below is measured');
for (const [name, run] of KINDS) {
  const left = leftBehind(run);
  check(`${name}: nothing left behind`, left === 0, `${left} B a rebuild`);
}

// A build stopped part way: the manifold it is handed throws at the middle new cross-section.
let sections = 0;
const counting = new Proxy(wasm, {
  get(target, key) {
    const value = Reflect.get(target, key);
    if (key !== 'CrossSection') return value;
    return new Proxy(value, {
      get(cls, k) {
        const fn = Reflect.get(cls, k);
        return k === 'square' || k === 'circle' ? (...args: unknown[]) => (sections++, fn.apply(cls, args)) : fn;
      },
    });
  },
});
clicker({}, counting)();
const stopAt = Math.ceil(sections / 2);
let made = 0;
let thrown = '';
const failing = new Proxy(wasm, {
  get(target, key) {
    const value = Reflect.get(target, key);
    if (key !== 'CrossSection') return value;
    return new Proxy(value, {
      get(cls, k) {
        const fn = Reflect.get(cls, k);
        if (k !== 'square' && k !== 'circle') return fn;
        return (...args: unknown[]) => {
          if (++made === stopAt) throw new Error('stopped part way');
          return fn.apply(cls, args);
        };
      },
    });
  },
});
const stopped = () => {
  made = 0;
  try {
    clicker({}, failing)();
  } catch (err) {
    thrown = (err as Error).message;
  }
};
const left = leftBehind(stopped);
check(`a build that throws at cross-section ${stopAt} of ${sections}: it throws`, thrown === 'stopped part way', thrown || 'it did not throw');
check('a build that throws part way: nothing left behind', left === 0, `${left} B a rebuild`);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
