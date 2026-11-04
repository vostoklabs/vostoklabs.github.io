/*
  A picture on a shaped base made smaller than Design size once went (DESIGN_SCALE_CHECKED_BELOW):
  what is left of it has to print with a 0.4 mm nozzle.

   - At that old floor nothing changes: a hairline a smaller size would lose is still carved, and
     nothing is said. Just below it, the hairline is left out.
   - At the floor (DESIGN_SCALE_MIN) a bold shape prints whole, at the size asked for, and nothing
     is said.
   - Line art loses its thinner lines first and says so; with less than half of it left, at the
     floor, Export is refused (`blocking`).
   - A smaller size asked for builds at the floor.
   - Words keep their own check, and a blank has no picture to check.
   - The identity marks still land, and a rebuild leaves nothing behind in manifold's heap.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs small-picture
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureHeaps, heapInUse } from '../../../packages/laser/tests/heap-probe.mjs';

// Before manifold loads: the meter finds its heap as the module is made.
const heaps = captureHeaps();
const { default: Module } = await import('manifold-3d');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');
const { heartRing } = await import('../src/geometry/shapePaths.ts');
const { DESIGN_SCALE_CHECKED_BELOW, DESIGN_SCALE_MIN } = await import('../src/geometry/sizeLimits.ts');
type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type ClickerPart = import('../src/types.ts').ClickerPart;
type Ring = import('../src/types.ts').Ring;

const wasm: any = await Module();
wasm.setup();
const heap = heaps[heaps.length - 1];

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------------ the worker's assets */

const asset = (p: string) =>
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p)).buffer as ArrayBuffer;
function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = readModel(buf, 'asset.3mf');
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.positions, triVerts: raw.indices });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const out = solid.translate([
    -(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, dropTopToZero ? -bb.max[2] : 0,
  ]);
  solid.delete();
  return out;
}
const socket = prep(asset('switch/mx/mx-socket.3mf'), true);
const stem = prep(asset('switch/mx/mx-stem.3mf'), false);

/* ------------------------------------------------------------------ designs */

/** The app's own defaults for a picture, on a Circle base at Size 35. */
const DEFAULTS: BuildParams = {
  baseShape: 'circle', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8,
  imageMargin: 1.2, borderWidth: 2.6, capProud: 4.0, hollowBase: false,
  designScale: 1, shapeSides: 6, shapeCornerPct: 0.22, shapeArmPct: 0.34,
  tolerance: 0.4, stemFitMm: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.12, stepHeight: 0.6, travel: 4.0,
  floorThickness: 1.6, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [247, 247, 245], bodyColorRgb: [240, 240, 240],
  componentHeights: {},
  edgeSettings: [
    { target: 'capTop', style: 'chamfer', radius: 0.5 },
    { target: 'clickerBase', style: 'chamfer', radius: 0.5 },
  ],
  extrudeChamfer: false,
};
const LEFT_OUT = 'Lines thinner than 0.4 mm were left out of the picture.';
const TOO_SMALL = 'The picture is too small to print. Make it bigger.';

const rect = (cx: number, cy: number, w: number, h: number): Ring =>
  [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
/** Centred, longest side 1: how the tracer hands a picture over. */
function normalised(rings: Ring[]): Ring[] {
  const b = ringsBox(rings);
  const k = 1 / Math.max(b.w, b.h);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return rings.map((r) => r.map(([x, y]) => [(x - cx) * k, (y - cy) * k] as [number, number]));
}
/** Each ring its own shape of one colour, as a traced picture's components arrive. */
const shapes = (rings: Ring[], colour = 0): BuildRegion[] =>
  rings.map((ring, j) => ({ filamentRgb: [200, 30, 30], coverage: 0.5, rings: [ring], partName: `top-color-${colour}-${j}` }));
/** A word as the main thread sends one: rings in cap millimetres. */
const word = (rings: Ring[]): BuildRegion => ({ filamentRgb: [20, 20, 20], coverage: 0, rings, partName: 'text-a', mm: true });
/** An H, `stroke` mm thick and 6 mm tall, at (cx, cy). */
const H = (cx: number, cy: number, stroke: number): Ring[] => [
  rect(cx - 1.8, cy, stroke, 6), rect(cx + 1.8, cy, stroke, 6), rect(cx, cy, 3.6, stroke),
];

/** A bold shape: the heart, filled. */
const HEART = normalised([heartRing()]);
/** Line art: three lines 4 % of the picture thick, and between them two at 2 %. */
const LINES = [0.04, 0.02, 0.04, 0.02, 0.04].map((w, i) => rect(0, -0.3 + 0.15 * i, 1, w));
/** A bold block, and a hairline above it 0.4 % of the picture thick (its own colour). */
const BLOCK = rect(0, -0.15, 1, 0.7);
const HAIRLINE = rect(0, 0.4, 1, 0.004);

const build = (regions: BuildRegion[], outline: Ring[], over: Partial<BuildParams> = {}) =>
  buildClicker(wasm, socket, stem, regions, outline, { ...DEFAULTS, ...over });

/* ------------------------------------------------------------------ measuring */

function ringsBox(rings: Ring[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
const has = (parts: ClickerPart[], name: string) => parts.some((p) => p.name === name);
/** A part's width and depth, mm. */
const sizeOf = (p: ClickerPart | undefined) => {
  if (!p) return null;
  const v = p.vertProperties;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < v.length; i += p.numProp) {
    minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
    minY = Math.min(minY, v[i + 1]); maxY = Math.max(maxY, v[i + 1]);
  }
  return { w: maxX - minX, h: maxY - minY };
};
const sameParts = (a: ClickerPart[], b: ClickerPart[]) => a.length === b.length && a.every((p, i) =>
  p.name === b[i].name && p.vertProperties.length === b[i].vertProperties.length && p.triVerts.length === b[i].triVerts.length
    && p.vertProperties.every((x, k) => x === b[i].vertProperties[k]) && p.triVerts.every((x, k) => x === b[i].triVerts[k]));
type Built = ReturnType<typeof build>;
const said = (b: Built) => [...b.blocking, ...b.warnings].join(' | ') || 'nothing said';
const aboutPicture = (b: Built) => b.blocking.includes(TOO_SMALL) || b.warnings.includes(LEFT_OUT);
const provenance = (b: Built) => b.warnings.find((w) => w.startsWith('Provenance:'));
/** A line's width as it prints: drawn at the build's scale, and the colour bleed on both sides. */
const printedMm = (frac: number, b: Built) => frac * b.layout.art.scale + 2 * DEFAULTS.colorBleed;

/* ------------------------------------------------------------------ the old floor */

{
  const at = DESIGN_SCALE_CHECKED_BELOW;
  const old = build([...shapes([BLOCK]), ...shapes([HAIRLINE], 1)], [BLOCK, HAIRLINE], { designScale: at });
  check(`at ${at * 100} %, the size the slider stopped at, the hairline is carved and nothing is said`,
    has(old.parts, 'top-color-1-0') && old.warnings.length === 0 && old.blocking.length === 0,
    `${printedMm(0.004, old).toFixed(2)} mm as printed; ${said(old)}`);
  const below = build([...shapes([BLOCK]), ...shapes([HAIRLINE], 1)], [BLOCK, HAIRLINE], { designScale: at - 0.01 });
  check(`…at ${Math.round((at - 0.01) * 100)} % it is left out, and the block is not`,
    !has(below.parts, 'top-color-1-0') && has(below.parts, 'top-color-0-0') && below.blocking.length === 0,
    `${printedMm(0.004, below).toFixed(2)} mm as printed; ${said(below)}`);
}

/* ------------------------------------------------------------------ a bold shape at the floor */

const floor = DESIGN_SCALE_MIN;
{
  const b = build(shapes(HEART), HEART, { designScale: floor });
  const box = ringsBox(HEART);
  const got = sizeOf(b.parts.find((p) => p.name === 'top-color-0-0'));
  const want = { w: box.w * b.layout.art.scale + 2 * DEFAULTS.colorBleed, h: box.h * b.layout.art.scale + 2 * DEFAULTS.colorBleed };
  check(`a bold heart at the floor (${floor * 100} %) prints whole, at the size asked for`,
    !!got && Math.abs(got.w - want.w) < 0.05 && Math.abs(got.h - want.h) < 0.05,
    got ? `${got.w.toFixed(2)} × ${got.h.toFixed(2)} mm, ${want.w.toFixed(2)} × ${want.h.toFixed(2)} drawn` : 'no part');
  check('…and nothing is said about it', b.blocking.length === 0 && !aboutPicture(b), said(b));
  check('…and the identity marks land', !provenance(b), provenance(b) ?? 'all landed');
}

/* ------------------------------------------------------------------ line art */

{
  const at20 = build(shapes(LINES), LINES, { designScale: 0.2 });
  const kept = LINES.map((_, j) => has(at20.parts, `top-color-0-${j}`));
  check('line art at 20 %: the thin lines are left out, the thicker ones kept',
    JSON.stringify(kept) === JSON.stringify([true, false, true, false, true]),
    `thin ${printedMm(0.02, at20).toFixed(2)} mm, thick ${printedMm(0.04, at20).toFixed(2)} mm as printed; kept ${kept.join(', ')}`);
  check('…and it says so, without refusing Export', at20.warnings.includes(LEFT_OUT) && at20.blocking.length === 0, said(at20));

  const atFloor = build(shapes(LINES), LINES, { designScale: floor });
  check(`line art at the floor: nothing is left, and Export is refused`,
    !LINES.some((_, j) => has(atFloor.parts, `top-color-0-${j}`)) && atFloor.blocking.includes(TOO_SMALL),
    `thick ${printedMm(0.04, atFloor).toFixed(2)} mm as printed; ${said(atFloor)}`);
  check('…said once, as the picture\'s, not as colours too small', !atFloor.warnings.includes(LEFT_OUT) && !atFloor.warnings.some((w) => w.includes('too small to print and')),
    said(atFloor));
  check('…and the identity marks land', !provenance(atFloor), provenance(atFloor) ?? 'all landed');
}

/* ------------------------------------------------------------------ below the floor */

{
  const asked = build(shapes(LINES.slice(0, 1)), LINES.slice(0, 1), { designScale: 0.01 });
  const atFloor = build(shapes(LINES.slice(0, 1)), LINES.slice(0, 1), { designScale: floor });
  check('a Design size of 1 % builds at the floor, part for part',
    asked.layout.art.scale === atFloor.layout.art.scale && sameParts(asked.parts, atFloor.parts),
    `scale ${asked.layout.art.scale.toFixed(3)} and ${atFloor.layout.art.scale.toFixed(3)}`);
}

/* ------------------------------------------------------------------ words, and a blank */

{
  const alone = build([word(H(0, 0, 1))], [], { designScale: floor });
  check('a word alone at the floor: its own check, nothing said about a picture',
    has(alone.parts, 'text-a') && !aboutPicture(alone) && alone.blocking.length === 0, said(alone));
  const thin = build([...shapes(HEART), word(H(0, 6, 0.2))], HEART, { designScale: floor });
  check('…and a word too thin still refuses in its own words',
    thin.blocking.some((m) => m.startsWith('Words too thin')) && !thin.blocking.includes(TOO_SMALL), said(thin));
  const blank = build([], HEART, { designScale: floor, blank: true });
  check('a blank at the floor has no picture to check', !aboutPicture(blank) && blank.blocking.length === 0, said(blank));
}

/* ------------------------------------------------------------------ nothing left behind */

{
  const leftBehind = (run: () => void) => {
    run();
    run();
    const before = heapInUse(heap);
    for (let i = 0; i < 4; i++) run();
    return Number.isFinite(before) ? (heapInUse(heap) - before) / 4 : NaN;
  };
  const lines = leftBehind(() => void build(shapes(LINES), LINES, { designScale: 0.2 }));
  check('line art losing lines leaves nothing behind', lines === 0, `${lines} B a rebuild`);
  const gone = leftBehind(() => void build(shapes(LINES), LINES, { designScale: floor }));
  check('…nor line art losing all of them', gone === 0, `${gone} B a rebuild`);
  const heart = leftBehind(() => void build([...shapes(HEART), word(H(0, 6, 1))], HEART, { designScale: floor }));
  check('…nor a heart with a word on it', heart === 0, `${heart} B a rebuild`);
}

console.log(failures ? `\n${failures} FAILED` : '\na small picture prints what a nozzle can draw');
process.exit(failures ? 1 : 0);
