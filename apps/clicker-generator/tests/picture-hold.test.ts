/*
  A picture that keeps its size when the shape changes (`BuildParams.artMm`).

   - The rules on their own: a held size and the Design size it amounts to, both clamped the way
     the build clamps them, rounding to 0.01 mm, nothing claimed before a build has said what
     fits, and the tracer's size unchanged while the picture follows.
   - Absent, the picture follows the shape exactly as it always has: Size less the margins, times
     Design size, and `layout.art.fit` is the size before Design size.
   - Held, the picture is the same number of millimetres whatever the Size, on a circle, a square
     and a heart, and on a base of a fixed size; the shape still changes.
   - Held at what a Design size built, the build is that build, part for part: the only thing
     the hold changes is the picture's size.
   - An outline base ignores it; a size far past the frame stops at HOLD_SCALE_MAX of the fit.
   - A small held picture gets the thin-line check a small Design size gets.
   - Rebuilds leave nothing behind in manifold's heap.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs picture-hold
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
const { DESIGN_SCALE_MIN } = await import('../src/geometry/sizeLimits.ts');
const { HOLD_SCALE_MAX, heldArtMm, holdScale, holdMm, pictureMmOf } = await import('../src/geometry/pictureHold.ts');
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
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------ the rules on their own */

{
  check('holdScale: a held size over the size that fits', holdScale(30, 20) === 1.5 && holdScale(10, 20) === 0.5,
    `${holdScale(30, 20)}, ${holdScale(10, 20)}`);
  check('…kept between the smallest Design size and HOLD_SCALE_MAX, as the build keeps it',
    holdScale(1, 20) === DESIGN_SCALE_MIN && holdScale(1000, 20) === HOLD_SCALE_MAX,
    `${holdScale(1, 20)}, ${holdScale(1000, 20)}`);
  check('…and 1 before any build has said what fits', holdScale(30, 0) === 1 && holdScale(30, -1) === 1 && holdScale(30, NaN) === 1,
    `${holdScale(30, 0)}, ${holdScale(30, -1)}, ${holdScale(30, NaN)}`);
  check('heldArtMm: inside the range it is the size asked for, unchanged',
    heldArtMm(12.345678, 20) === 12.345678 && heldArtMm(1, 20) === 2 && heldArtMm(1000, 20) === 320,
    `${heldArtMm(12.345678, 20)}, ${heldArtMm(1, 20)}, ${heldArtMm(1000, 20)}`);
  check('holdMm: a Design size in millimetres, to 0.01', holdMm(0.6, 32.6) === 19.56 && holdMm(1 / 3, 10) === 3.33,
    `${holdMm(0.6, 32.6)}, ${holdMm(1 / 3, 10)}`);
  check('…clamped the same way', holdMm(0.01, 20) === 2 && holdMm(100, 20) === 320, `${holdMm(0.01, 20)}, ${holdMm(100, 20)}`);
  check('…and nothing before any build has said what fits', holdMm(0.6, 0) === null && holdMm(0.6, NaN) === null && holdMm(NaN, 20) === null,
    `${holdMm(0.6, 0)}, ${holdMm(0.6, NaN)}, ${holdMm(NaN, 20)}`);
  // What the tracer was always told: Size times Design size.
  const followed = { capWidthMm: 35, designScale: 0.8 };
  check('pictureMmOf: following, the tracer is told what it always was',
    pictureMmOf({ ...followed, artMm: null }) === 35 * 0.8 && pictureMmOf(followed) === 35 * 0.8 && pictureMmOf({ capWidthMm: 35 }) === 35,
    `${pictureMmOf({ ...followed, artMm: null })}, ${pictureMmOf({ capWidthMm: 35 })}`);
  check('…held, the held size', pictureMmOf({ ...followed, artMm: 20 }) === 20, `${pictureMmOf({ ...followed, artMm: 20 })}`);
}

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

const rect = (cx: number, cy: number, w: number, h: number): Ring =>
  [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
/** A picture 1 wide and 0.6 tall, centred: how the tracer hands one over. */
const BAR: Ring = rect(0, 0, 1, 0.6);
const art = (rings: Ring[]): BuildRegion => ({ filamentRgb: [200, 30, 30], coverage: 1, rings, partName: 'top-color-0-0' });
/** Line art: three lines 4 % of the picture thick, and between them two at 2 % (as small-picture). */
const LINES = [0.04, 0.02, 0.04, 0.02, 0.04].map((w, i) => rect(0, -0.3 + 0.15 * i, 1, w));
const lineShapes = LINES.map((ring, j): BuildRegion =>
  ({ filamentRgb: [200, 30, 30], coverage: 0.5, rings: [ring], partName: `top-color-0-${j}` }));
const LEFT_OUT = 'Lines thinner than 0.4 mm were left out of the picture.';

const build = (over: Partial<BuildParams> = {}, regions: BuildRegion[] = [art([BAR])], outline: Ring[] = [BAR]) =>
  buildClicker(wasm, socket, stem, regions, outline, { ...DEFAULTS, ...over });

/* ------------------------------------------------------------------ measuring */

const sameParts = (a: ClickerPart[], b: ClickerPart[]) => a.length === b.length && a.every((p, i) =>
  p.name === b[i].name && p.vertProperties.length === b[i].vertProperties.length && p.triVerts.length === b[i].triVerts.length
    && p.vertProperties.every((x, k) => x === b[i].vertProperties[k]) && p.triVerts.every((x, k) => x === b[i].triVerts[k]));
const capWidth = (b: ReturnType<typeof build>) => {
  let minX = Infinity, maxX = -Infinity;
  for (const r of b.layout.cap) for (const [x] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  return maxX - minX;
};

/* ------------------------------------------------------------------ absent: the picture follows */

{
  const rows: [number, number, number][] = [[35, 1, 32.6], [25, 1, 22.6], [35, 0.5, 16.3]];
  for (const [size, scale, want] of rows) {
    const b = build({ capWidthMm: size, designScale: scale });
    const a = b.layout.art;
    check(`following at Size ${size}, Design size ${scale * 100} %: the picture is Size less the margins, times Design size`,
      near(a.scale, want, 1e-9), `${a.scale.toFixed(3)} mm (want ${want})`);
    check('…and layout.art.fit is the size before Design size', a.fit * scale === a.scale && near(a.fit, size - 2.4, 1e-9),
      `fit ${a.fit.toFixed(3)} mm`);
  }
}

/* ------------------------------------------------------------------ held: Size changes the shape only */

for (const baseShape of ['circle', 'square', 'heart'] as const) {
  const got = [20, 35, 70].map((size) => {
    const b = build({ baseShape, capWidthMm: size, artMm: 32.6 });
    return { size, scale: b.layout.art.scale, fit: b.layout.art.fit, cap: capWidth(b) };
  });
  check(`held at 32.6 mm on a ${baseShape}: the same size at Size 20, 35 and 70`,
    got.every((g) => near(g.scale, 32.6, 1e-6)),
    got.map((g) => `${g.size}: ${g.scale.toFixed(4)}`).join(', '));
  check('…while the shape changes with Size',
    got[0].cap < got[1].cap && got[1].cap < got[2].cap && got.every((g, i) => i === 0 || g.fit > got[i - 1].fit),
    got.map((g) => `cap ${g.cap.toFixed(1)}, fit ${g.fit.toFixed(1)}`).join('; '));
}

for (const baseShape of ['circle', 'heart'] as const) {
  const got = [24, 30, 40].map((side) => {
    const b = build({ baseShape, bodySize: { w: side, h: side }, artMm: 20 });
    return { side, scale: b.layout.art.scale, fit: b.layout.art.fit };
  });
  check(`held at 20 mm on a ${baseShape} of a fixed size: 20 mm at 24, 30 and 40`,
    got.every((g) => near(g.scale, 20, 1e-6)),
    got.map((g) => `${g.side}: ${g.scale.toFixed(4)} (fits ${g.fit.toFixed(1)})`).join(', '));
}

/* ------------------------------------------------------------------ the hold changes the size only */

for (const [label, over] of [
  ['a circle at Size 35', { baseShape: 'circle' }],
  ['a square of a fixed size', { baseShape: 'square', bodySize: { w: 30, h: 30 } }],
] as [string, Partial<BuildParams>][]) {
  const at60 = build({ ...over, designScale: 0.6 });
  const held = build({ ...over, artMm: at60.layout.art.scale });
  check(`held at what Design size 60 % built on ${label}: the same build, part for part`,
    sameParts(at60.parts, held.parts) && held.layout.art.scale === at60.layout.art.scale,
    `${at60.layout.art.scale.toFixed(4)} mm; ${held.parts.length} parts`);
}

/* ------------------------------------------------------------------ where it does not apply */

{
  const outline = build({ baseShape: 'outline', capWidthMm: 40 });
  const outlineHeld = build({ baseShape: 'outline', capWidthMm: 40, artMm: 10 });
  check('an outline base ignores a held size: the picture is the shape',
    sameParts(outline.parts, outlineHeld.parts) && outlineHeld.layout.art.scale === outline.layout.art.scale,
    `${outlineHeld.layout.art.scale.toFixed(3)} mm`);
  const huge = build({ capWidthMm: 20, artMm: 5000 });
  check(`a held size far past the frame stops at ${HOLD_SCALE_MAX} times the size that fits`,
    huge.layout.art.scale === HOLD_SCALE_MAX * huge.layout.art.fit, `${huge.layout.art.scale.toFixed(2)} mm, fit ${huge.layout.art.fit.toFixed(2)}`);
  const tiny = build({ capWidthMm: 35, artMm: 0.01 });
  check('…and a tiny one at the smallest Design size',
    near(tiny.layout.art.scale, DESIGN_SCALE_MIN * tiny.layout.art.fit, 1e-9), `${tiny.layout.art.scale.toFixed(3)} mm`);
}

/* ------------------------------------------------------------------ thin lines */

{
  const fit = build({}, lineShapes, LINES).layout.art.fit;
  const at20 = build({ designScale: 0.2 }, lineShapes, LINES);
  const held = build({ artMm: 0.2 * fit }, lineShapes, LINES);
  check('a picture held at a fifth of what fits is checked for thin lines, as Design size 20 % is',
    held.warnings.includes(LEFT_OUT) && sameParts(held.parts, at20.parts),
    `${held.layout.art.scale.toFixed(2)} mm; ${held.warnings.join(' | ') || 'nothing said'}`);
}

/* ------------------------------------------------------------------ nothing left behind */

{
  const run = () => {
    build({ capWidthMm: 20, artMm: 32.6 });
    build({ baseShape: 'heart', bodySize: { w: 24, h: 24 }, artMm: 20 });
    build({ artMm: 2 }, lineShapes, LINES);
  };
  run();
  run();
  const before = heapInUse(heap);
  for (let i = 0; i < 4; i++) run();
  const left = (heapInUse(heap) - before) / 4;
  check('held builds leave nothing behind', Number.isFinite(before) && left === 0, `${left} B a round of three`);
}

// ---- the rail: Design size and "Picture follows size" (src/ui/designSizeRows.ts, what update() shows)
{
  const { designSizeRows } = await import('../src/ui/designSizeRows.ts');
  type RowState = Parameters<typeof designSizeRows>[0];
  const at = (patch: Partial<RowState>, blank = false) =>
    designSizeRows({ importMode: 'image', baseShape: 'circle', designScale: 0.8, artMm: null, artFitMm: 30, ...patch } as RowState, blank);
  const shown = (r: ReturnType<typeof at>) => `size ${r.designSizeHidden ? 'hidden' : `${r.designSizePct} %`}, switch ${r.followHidden ? 'hidden' : r.follows ? 'on' : 'off'}`;

  for (const mode of ['image', 'svg', 'icon'] as const) {
    const r = at({ importMode: mode });
    check(`rail, ${mode}: Design size shows at its own value and the switch shows, on`,
      !r.designSizeHidden && r.designSizePct === 80 && !r.followHidden && r.follows, shown(r));
  }
  const text = at({ importMode: 'text', artMm: 20 });
  check('rail, Text mode: both go (Text size is the knob there)', text.designSizeHidden && text.followHidden, shown(text));
  const outline = at({ baseShape: 'outline', artMm: 20 });
  check('rail, Outline base: both go (the picture is the shape)', outline.designSizeHidden && outline.followHidden, shown(outline));
  const outlineIcon = at({ importMode: 'icon', baseShape: 'outline' });
  check('rail, an icon on "outline" is a solid shape: both show', !outlineIcon.designSizeHidden && !outlineIcon.followHidden, shown(outlineIcon));
  const blank = at({ artMm: 20 }, true);
  check('rail, blank: both go (no picture to size)', blank.designSizeHidden && blank.followHidden, shown(blank));
  for (const mode of ['blocks', 'model'] as const) {
    const r = at({ importMode: mode, artMm: 20 });
    check(`rail, ${mode}: the switch goes (only a picture keeps its size)`, r.followHidden, shown(r));
  }
  const held = at({ artMm: 24, artFitMm: 30 });
  check('rail, held: the switch is off and the slider shows the share the held size fills now (24 of 30 mm)',
    !held.follows && !held.followHidden && held.designSizePct === 80, shown(held));
  const grown = at({ artMm: 24, artFitMm: 20 });
  check('rail, held on a smaller shape: the share grows (24 of 20 mm)', grown.designSizePct === 120, shown(grown));
  const past = at({ artMm: 90, artFitMm: 20 });
  check('rail, held past the slider\'s top: the slider sits at 200 %', past.designSizePct === 200, shown(past));
  const unbuilt = at({ artMm: 90, artFitMm: null });
  check('rail, held before a build says what fits: the slider shows Design size', unbuilt.designSizePct === 80 && !unbuilt.follows, shown(unbuilt));
}

console.log(failures ? `\n${failures} FAILED` : '\na held picture keeps its size');
process.exit(failures ? 1 : 0);
