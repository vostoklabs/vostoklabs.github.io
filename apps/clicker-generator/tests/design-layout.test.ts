/*
  What the 2D Design view sends the build, and what the build sends back for it to draw.

  The view moves, scales and turns the picture, puts words on it, and draws the clicker from the
  build's own outlines. So:

   - **Turning** (`designRotation`): 0, and a whole turn, are no turn, byte for byte. On a preset
     base the picture turns inside a base that keeps its size; on an outline base the silhouette
     turns, so the base does.
   - **Words** (`BuildRegion.mm`): rings already in cap millimetres, never scaled, moved or turned
     with the picture; carved before it, so a word cuts through the art and keeps its whole shape;
     still clipped to the frame; and on an outline base the base grows a tab round them.
   - **Thin words**: a word whose strokes are under two 0.4 mm nozzle lines is thickened once if
     that is enough (and says so), and refused otherwise, in `blocking`, which Export reads. A
     word's boldness is its own; the Text mode boldness never reaches it.
   - **Letters cut off**: with `artCutNote` (Text mode), artwork the frame cuts off says so; a
     picture cropped by Design size above 100% stays quiet.
   - **The layout**: `art` places a normalised ring exactly where the build put the picture,
     `switchBox` is the box the switches were clamped into, and with the keyring loop on,
     `silhouette` is the body seen from above, the loop's tab joined on and its hole through it.
   - **Relief on the plate**: a colour the Relief rows raise stands above the face, so the top
     prints face-up, on its skirt and stem; a flat top, or one with a colour only set deeper,
     still prints face-down.
   - A rebuild with all of it leaves nothing behind in manifold's heap.

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs design-layout
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureHeaps, heapInUse } from '../../../packages/laser/tests/heap-probe.mjs';

// Before manifold loads: the meter finds its heap as the module is made.
const heaps = captureHeaps();
const { default: Module } = await import('manifold-3d');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');
const { plateLayout, place, assemblyMinZ } = await import('../src/export/plateLayout.ts');
type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type ClickerPart = import('../src/types.ts').ClickerPart;
type DesignLayout = import('../src/types.ts').DesignLayout;
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

/** The app's own defaults, from mount.ts's store and buildParamsFor, for a picture. */
const DEFAULTS: BuildParams = {
  baseShape: 'outline', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8,
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
/** A picture that shows which way it is turned: a bar 1 wide and 0.4 tall, normalised. */
const BAR: Ring = rect(0, 0, 1, 0.4);
const art = (rings: Ring[]): BuildRegion => ({ filamentRgb: [200, 30, 30], coverage: 1, rings, partName: 'top-color-0-0' });
/** A word as the main thread sends one: rings in cap millimetres, coverage 0, its own name. */
const word = (rings: Ring[], over: Partial<BuildRegion> = {}): BuildRegion =>
  ({ filamentRgb: [20, 20, 20], coverage: 0, rings, partName: 'text-a', mm: true, ...over });
/** An H, `stroke` mm thick and 6 mm tall: two stems and a bar, at (cx, cy). */
const H = (cx: number, cy: number, stroke: number): Ring[] => [
  rect(cx - 1.8, cy, stroke, 6), rect(cx + 1.8, cy, stroke, 6), rect(cx, cy, 3.6, stroke),
];

const build = (regions: BuildRegion[], outline: Ring[], over: Partial<BuildParams> = {}) =>
  buildClicker(wasm, socket, stem, regions, outline, { ...DEFAULTS, ...over });

/* ------------------------------------------------------------------ measuring */

const partNamed = (parts: ClickerPart[], name: string) => parts.find((p) => p.name === name);
/** A part's box in x and y. */
const boxOf = (p: ClickerPart | undefined) => {
  if (!p) return null;
  const v = p.vertProperties;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < v.length; i += p.numProp) {
    minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
    minY = Math.min(minY, v[i + 1]); maxY = Math.max(maxY, v[i + 1]);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
};
const ringsBox = (rings: Ring[]) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
};
const volumeOf = (p: ClickerPart | undefined) => {
  if (!p) return 0;
  const v = p.vertProperties, t = p.triVerts, n = p.numProp;
  let vol = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    vol += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c])
      + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
  }
  return vol;
};
const sameParts = (a: ClickerPart[], b: ClickerPart[]) => a.length === b.length && a.every((p, i) =>
  p.name === b[i].name && p.vertProperties.length === b[i].vertProperties.length && p.triVerts.length === b[i].triVerts.length
    && p.vertProperties.every((x, k) => x === b[i].vertProperties[k]) && p.triVerts.every((x, k) => x === b[i].triVerts[k]));
const f2 = (b: { w: number; h: number } | null) => (b ? `${b.w.toFixed(2)} × ${b.h.toFixed(2)}` : 'none');
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** Where `layout.art` puts a normalised ring. */
const placed = (ring: Ring, a: DesignLayout['art']): Ring => {
  const r = (a.rotation * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return ring.map(([x, y]) => [(x * c - y * s) * a.scale + a.offX, (x * s + y * c) * a.scale + a.offY]);
};

/* ------------------------------------------------------------------ turning: 0 is no turn */

for (const baseShape of ['circle', 'outline'] as const) {
  const none = build([art([BAR])], [BAR], { baseShape });
  for (const turn of [0, -0, 360, -720]) {
    const got = build([art([BAR])], [BAR], { baseShape, designRotation: turn });
    check(`${baseShape}: a turn of ${Object.is(turn, -0) ? '-0' : turn}° is no turn, part for part`,
      sameParts(got.parts, none.parts) && JSON.stringify(got.layout) === JSON.stringify(none.layout),
      `${got.parts.length} parts`);
  }
}

/* ------------------------------------------------------------------ turning a preset base */

{
  const at0 = build([art([BAR])], [BAR], { baseShape: 'circle', capWidthMm: 40 });
  const at90 = build([art([BAR])], [BAR], { baseShape: 'circle', capWidthMm: 40, designRotation: 90 });
  const a0 = boxOf(partNamed(at0.parts, 'top-color-0-0'));
  const a90 = boxOf(partNamed(at90.parts, 'top-color-0-0'));
  check('90° on a preset base: the base keeps its size and shape',
    JSON.stringify(at90.layout.cap) === JSON.stringify(at0.layout.cap)
      && JSON.stringify(at90.layout.body) === JSON.stringify(at0.layout.body)
      && sameParts(at90.parts.filter((p) => p.kind === 'body'), at0.parts.filter((p) => p.kind === 'body')),
    `cap ${f2(ringsBox(at90.layout.cap))} mm both ways`);
  check('…and the picture turns inside it', !!a0 && !!a90 && a0.w > 2 * a0.h && near(a90.w, a0.h, 0.05) && near(a90.h, a0.w, 0.05),
    `bar ${f2(a0)} mm at 0°, ${f2(a90)} mm at 90°`);
  check('…about its own centre', !!a90 && near((a90.minX + a90.maxX) / 2, 0, 0.05) && near((a90.minY + a90.maxY) / 2, 0, 0.05),
    a90 ? `centre ${((a90.minX + a90.maxX) / 2).toFixed(3)}, ${((a90.minY + a90.maxY) / 2).toFixed(3)}` : 'no part');
  check('…and the layout says so', at90.layout.art.rotation === 90 && at0.layout.art.rotation === 0,
    `rotation ${at0.layout.art.rotation}° and ${at90.layout.art.rotation}°`);
}

/* ------------------------------------------------------------------ turning an outline base */

{
  const at0 = build([art([BAR])], [BAR], { capWidthMm: 50 });
  const at90 = build([art([BAR])], [BAR], { capWidthMm: 50, designRotation: 90 });
  const c0 = ringsBox(at0.layout.cap);
  const c90 = ringsBox(at90.layout.cap);
  check('90° on an outline base: the silhouette turns, so the base does',
    c0.w > c0.h * 1.5 && near(c90.w, c0.h, 0.1) && near(c90.h, c0.w, 0.1),
    `cap ${f2(c0)} mm at 0°, ${f2(c90)} mm at 90°`);
  const a90 = boxOf(partNamed(at90.parts, 'top-color-0-0'));
  check('…with the picture on it', !!a90 && a90.h > 2 * a90.w, `bar ${f2(a90)} mm`);
}

/* ------------------------------------------------------------------ words, carved first */

const FULL: Ring = rect(0, 0, 1, 1);
{
  const NO_BLEED = { baseShape: 'circle' as const, capWidthMm: 40, colorBleed: 0 };
  const bare = build([art([FULL])], [FULL], NO_BLEED);
  const block = rect(0, -4, 12, 3);
  const out = build([art([FULL]), word([block])], [FULL], NO_BLEED);
  const w = boxOf(partNamed(out.parts, 'text-a'));
  const ia = ringsBox(out.layout.imageArea);
  check('a word is carved whole, in millimetres, though the picture under it covers more',
    !!w && near(w.w, 12, 0.02) && near(w.h, 3, 0.02) && near(w.minY, -5.5, 0.02),
    `word ${f2(w)} mm from y ${w?.minY.toFixed(2)}, inside the frame ${f2(ia)} mm`);
  const cutOut = volumeOf(partNamed(bare.parts, 'top-color-0-0')) - volumeOf(partNamed(out.parts, 'top-color-0-0'));
  check('…and the picture gives way round it', near(cutOut, 12 * 3 * DEFAULTS.imageDepth, 0.5),
    `${cutOut.toFixed(2)} mm³ taken out of the picture, the word is ${(12 * 3 * DEFAULTS.imageDepth).toFixed(2)}`);
  check('…with nothing to say about it', out.warnings.length === 0 && out.blocking.length === 0,
    out.warnings.concat(out.blocking).join(' | ') || 'no warnings');

  // Never scaled, moved or turned with the picture.
  const moved = build([art([FULL]), word([block])], [FULL], { ...NO_BLEED, designScale: 0.5, imageOffset: { x: 3, y: 2 }, designRotation: 30 });
  check('a word stays where it was put while the picture is scaled, moved and turned',
    JSON.stringify(boxOf(partNamed(moved.parts, 'text-a'))) === JSON.stringify(w),
    `word ${f2(boxOf(partNamed(moved.parts, 'text-a')))} mm`);

  // Clipped to the frame, and said.
  const over = build([art([FULL]), word([rect(26, 0, 10, 3)])], [FULL], NO_BLEED);
  const ow = boxOf(partNamed(over.parts, 'text-a'));
  check('a word past the frame is cut off at it, and the status line says so',
    !!ow && ow.maxX <= ringsBox(over.layout.imageArea).maxX + 0.01 && over.warnings.includes('Words past the edge are cut off.')
      && !over.warnings.some((x) => x.includes('too small to print')),
    `${ow ? `reaches x ${ow.maxX.toFixed(2)}` : 'gone'}; ${over.warnings.join(' | ')}`);
}

/* ------------------------------------------------------------------ thin words */

{
  const P = { baseShape: 'circle' as const, capWidthMm: 40 };
  const thick = build([art([FULL]), word(H(0, -6, 1.2))], [FULL], P);
  check('a word in 1.2 mm strokes prints as typed', thick.warnings.length === 0 && thick.blocking.length === 0,
    thick.warnings.concat(thick.blocking).join(' | ') || 'no warnings');

  const hair = build([art([FULL]), word(H(0, -6, 0.2))], [FULL], P);
  check('a word in 0.2 mm hairlines is refused, in blocking, and not repeated in the warnings',
    hair.blocking.length === 1 && hair.blocking[0] === 'Words too thin to print — make them bigger or bolder.'
      && !hair.warnings.some((x) => x.includes('too thin')) && !!partNamed(hair.parts, 'text-a'),
    `blocking: ${hair.blocking.join(' | ') || 'none'}; the word still shows: ${!!partNamed(hair.parts, 'text-a')}`);

  const typed = boxOf(partNamed(build([art([FULL]), word(H(0, -6, 0.45))], [FULL], { ...P, colorBleed: 0 }).parts, 'text-a'));
  const border = build([art([FULL]), word(H(0, -6, 0.45))], [FULL], P);
  const bw = boxOf(partNamed(border.parts, 'text-a'));
  check('a word in 0.45 mm strokes is thickened to print, and says so',
    border.blocking.length === 0 && border.warnings.includes('Letters thickened to print.') && !!bw && !!typed
      && near(bw.w - typed.w, 2 * (0.15 + DEFAULTS.colorBleed), 0.03),
    `${border.warnings.join(' | ')}; ${typed?.w.toFixed(2)} → ${bw?.w.toFixed(2)} mm across`);

  const bolder = build([art([FULL]), word(H(0, -6, 0.2), { boldMm: 0.35 })], [FULL], P);
  check('a word\'s own boldness is what is checked', bolder.blocking.length === 0 && !bolder.warnings.includes('Letters thickened to print.'),
    bolder.warnings.concat(bolder.blocking).join(' | ') || 'no warnings');
  const textBold = build([art([FULL]), word(H(0, -6, 0.2))], [FULL], { ...P, textBold: 0.5 });
  check('…and the Text mode boldness never reaches a word', textBold.blocking.length === 1,
    textBold.blocking.join(' | ') || 'not refused');
}

/* ------------------------------------------------------------------ letters the frame cuts off */

{
  // Text mode asks to be told (`artCutNote`); a picture past the frame is Design size above 100%,
  // cropped on purpose, and says nothing.
  const NOTE = 'Letters past the edge are cut off.';
  const P = { baseShape: 'square' as const, capWidthMm: 40, colorBleed: 0, artCutNote: NOTE };
  const inside = build([art([FULL])], [FULL], { ...P, designScale: 0.6 });
  const past = build([art([FULL])], [FULL], { ...P, designScale: 1.5 });
  const quiet = build([art([FULL])], [FULL], { baseShape: 'square', capWidthMm: 40, colorBleed: 0, designScale: 1.5 });
  check('letters the frame cuts off are said, when the app asks; inside it, or a picture, say nothing',
    !inside.warnings.includes(NOTE) && past.warnings.includes(NOTE) && !quiet.warnings.some((w) => w.includes('cut off')),
    `inside: ${inside.warnings.join(' | ') || 'nothing'}; past: ${past.warnings.join(' | ') || 'nothing'}; a picture: ${quiet.warnings.join(' | ') || 'nothing'}`);
}

/* ------------------------------------------------------------------ an outline base grows round words */

{
  const DISC: Ring = Array.from({ length: 64 }, (_, i) => [0.5 * Math.cos((i / 64) * 2 * Math.PI), 0.5 * Math.sin((i / 64) * 2 * Math.PI)]);
  const bare = build([art([DISC])], [DISC]);
  const under = rect(0, -22, 14, 4);
  const out = build([art([DISC]), word([under])], [DISC]);
  const cap = ringsBox(out.layout.cap);
  const w = boxOf(partNamed(out.parts, 'text-a'));
  check('words under the picture give an outline base a tab, frame and all',
    cap.minY <= -24 - DEFAULTS.imageMargin && ringsBox(bare.layout.cap).minY > -19
      && out.layout.cap.length === 1 && !!w && near(w.w, 14 + 2 * DEFAULTS.colorBleed, 0.01) && near(w.h, 4 + 2 * DEFAULTS.colorBleed, 0.01),
    `cap reaches y ${cap.minY.toFixed(2)} (${ringsBox(bare.layout.cap).minY.toFixed(2)} without the words), `
      + `${out.layout.cap.length} outline; the word ${f2(w)} mm`);
  const turned = build([art([DISC]), word([under])], [DISC], { designRotation: 90 });
  check('…and the words do not turn when the silhouette does',
    JSON.stringify(boxOf(partNamed(turned.parts, 'text-a'))) === JSON.stringify(w), `word ${f2(boxOf(partNamed(turned.parts, 'text-a')))} mm`);
}

/* ------------------------------------------------------------------ the layout */

{
  // `art` places a normalised ring where the build put the picture. No bleed, so the part is
  // the ring itself, to the build's own simplification.
  for (const [label, over] of [
    ['a preset base, scaled, moved and turned', { baseShape: 'circle', capWidthMm: 40, designScale: 0.8, imageOffset: { x: 2, y: -1.5 }, designRotation: 30 }],
    ['an outline base, turned', { capWidthMm: 40, designRotation: 45 }],
    ['a fixed size', { baseShape: 'square', bodySize: { w: 45, h: 45 }, designScale: 0.6, designRotation: 15 }],
  ] as [string, Partial<BuildParams>][]) {
    const out = build([art([BAR])], [BAR], { ...over, colorBleed: 0 });
    const want = ringsBox([placed(BAR, out.layout.art)]);
    const got = boxOf(partNamed(out.parts, 'top-color-0-0'));
    // On an outline base the picture fills the frame to its edge, which the frame's own rounding
    // shaves by a hair at the corners, so it is held to a tenth rather than a twentieth.
    const tol = over.baseShape ? 0.05 : 0.1;
    check(`layout.art on ${label}: puts the picture where the build did`,
      !!got && near(got.minX, want.minX, tol) && near(got.maxX, want.maxX, tol) && near(got.minY, want.minY, tol) && near(got.maxY, want.maxY, tol),
      `placed ${want.minX.toFixed(2)}..${want.maxX.toFixed(2)} × ${want.minY.toFixed(2)}..${want.maxY.toFixed(2)}, `
        + `built ${got?.minX.toFixed(2)}..${got?.maxX.toFixed(2)} × ${got?.minY.toFixed(2)}..${got?.maxY.toFixed(2)}`);
  }

  // `switchBox` is the clamp: a switch asked for far away lands on its edges, one inside stays.
  const far = build([art([BAR])], [BAR], { baseShape: 'circle', capWidthMm: 50, switches: [{ x: 100, y: -100, rotation: 0 }] });
  const sb = far.layout.switchBox;
  check('layout.switchBox is the box the switches were clamped into',
    far.switchPlacements[0].x === sb.hiX && far.switchPlacements[0].y === sb.loY && sb.loX < 0 && sb.hiX > 0,
    `asked 100, -100; placed ${far.switchPlacements[0].x.toFixed(2)}, ${far.switchPlacements[0].y.toFixed(2)}; `
      + `box x ${sb.loX.toFixed(2)}..${sb.hiX.toFixed(2)}, y ${sb.loY.toFixed(2)}..${sb.hiY.toFixed(2)}`);
  const inside = build([art([BAR])], [BAR], { baseShape: 'circle', capWidthMm: 50, switches: [{ x: sb.hiX - 1, y: sb.loY + 1, rotation: 0 }] });
  check('…and a switch inside it stays where it was asked to be',
    inside.switchPlacements[0].x === sb.hiX - 1 && inside.switchPlacements[0].y === sb.loY + 1, `${inside.switchPlacements[0].x}, ${inside.switchPlacements[0].y}`);

  // The outlines the view draws, and the loop.
  const kc = { enabled: true, style: 'loop' as const, angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 };
  const looped = build([art([BAR])], [BAR], { baseShape: 'circle', capWidthMm: 40, keychain: kc });
  const L = looped.layout;
  const cap = ringsBox(L.cap), well = ringsBox(L.well), body = ringsBox(L.body), ia = ringsBox(L.imageArea);
  check('the outlines nest: frame inside the cap, the cap inside the well, the well inside the body',
    ia.w < cap.w && near(well.w - cap.w, 2 * DEFAULTS.tolerance, 0.03) && near(body.w - well.w, 2 * DEFAULTS.borderWidth, 0.05) && L.textureMm === 0,
    `image ${ia.w.toFixed(2)}, cap ${cap.w.toFixed(2)}, well ${well.w.toFixed(2)}, body ${body.w.toFixed(2)} mm across`);
  check('the keyring loop is where its hole was cut, beyond the body', !!L.loop && near(L.loop.x, 0, 0.01)
      && L.loop.y > body.maxY && near(L.loop.holeR, 2.6, 1e-9) && L.loop.outerR > L.loop.holeR && !build([art([BAR])], [BAR]).layout.loop,
    L.loop ? `hole at ${L.loop.x.toFixed(2)}, ${L.loop.y.toFixed(2)}, r ${L.loop.holeR} in a loop of r ${L.loop.outerR}` : 'no loop');
  // One outline with one hole: two would mean the tab drawn apart from the body it is welded to.
  const sil = L.silhouette ? ringsBox(L.silhouette) : null;
  check('…and the silhouette from above is the body with the tab joined on and the hole through it',
    !!L.silhouette && L.silhouette.length === 2 && !!sil && !!L.loop && near(sil.maxY, L.loop.y + L.loop.outerR, 0.05)
      && near(sil.minY, body.minY, 0.01) && near(sil.w, body.w, 0.01) && !build([art([BAR])], [BAR]).layout.silhouette,
    sil && L.loop ? `${L.silhouette!.length} rings, up to y ${sil.maxY.toFixed(2)} (the loop's top ${(L.loop.y + L.loop.outerR).toFixed(2)})` : 'none');
  const knurled = build([art([BAR])], [BAR], { baseShape: 'circle', capWidthMm: 40, blockTexture: 'knurl' });
  check('textureMm is the crests\' height when the wall is textured', knurled.layout.textureMm === 0.6
      && JSON.stringify(knurled.layout.body) === JSON.stringify(build([art([BAR])], [BAR], { baseShape: 'circle', capWidthMm: 40 }).layout.body),
    `${knurled.layout.textureMm} mm outside the same body outline`);
}

/* ------------------------------------------------------------------ relief on the plate */

{
  /** Whether the top is flipped, and how high each part reaches, laid out as the 3MF writes it. */
  const onPlate = (parts: ClickerPart[]) => {
    const minZ = assemblyMinZ(parts);
    const layout = plateLayout(parts, minZ, { plate: 'a1' });
    const z = new Map<string, { lo: number; hi: number }>();
    for (const p of parts) {
      const pl = layout.placementFor(p.objectKey ?? p.group);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < p.vertProperties.length; i += p.numProp) {
        const pz = place(p.vertProperties[i], p.vertProperties[i + 1], p.vertProperties[i + 2] - minZ, pl)[2];
        lo = Math.min(lo, pz); hi = Math.max(hi, pz);
      }
      z.set(p.name, { lo, hi });
    }
    return { flipped: layout.placementFor('top').flip, z };
  };
  const P = { baseShape: 'circle' as const, capWidthMm: 40 };

  const flat = build([art([FULL])], [FULL], P);
  const f = onPlate(flat.parts);
  check('a flat top prints face-down, picture on the plate',
    f.flipped && !flat.parts.some((p) => p.printUpright) && near(f.z.get('top-color-0-0')!.lo, 0, 1e-3),
    `flipped: ${f.flipped}; the picture from z ${f.z.get('top-color-0-0')?.lo.toFixed(2)}`);

  const up = build([art([FULL])], [FULL], { ...P, componentHeights: { 'top-color-0-0': 1 } });
  const u = onPlate(up.parts);
  const top = up.parts.filter((p) => p.group === 'top');
  const topHi = Math.max(...top.map((p) => u.z.get(p.name)!.hi));
  check('a raised colour prints the top face-up, standing on its skirt and stem, the raised shape highest',
    !u.flipped && top.every((p) => p.printUpright) && !up.parts.some((p) => p.group !== 'top' && p.printUpright)
      && near(u.z.get('top-base')!.lo, 0, 1e-3) && near(u.z.get('top-color-0-0')!.hi, topHi, 1e-3)
      && near(topHi - u.z.get('top-base')!.hi, DEFAULTS.stepHeight, 0.01),
    `flipped: ${u.flipped}; the raised shape reaches ${u.z.get('top-color-0-0')?.hi.toFixed(2)}, `
      + `${(topHi - (u.z.get('top-base')?.hi ?? 0)).toFixed(2)} mm above the face`);

  const deep = build([art([FULL])], [FULL], { ...P, componentHeights: { 'top-color-0-0': -1 } });
  check('…and a colour only set deeper leaves the top face-down',
    onPlate(deep.parts).flipped && !deep.parts.some((p) => p.printUpright), `flipped: ${onPlate(deep.parts).flipped}`);

  // Relief's Bevelled edges has a size; the toggle it replaced was a fixed 0.5 mm.
  const RAISED = { ...P, componentHeights: { 'top-color-0-0': 2 } };
  const raisedVol = (over: Partial<BuildParams>) => volumeOf(partNamed(build([art([FULL])], [FULL], { ...RAISED, ...over }).parts, 'top-color-0-0'));
  const sharp = raisedVol({});
  const half = raisedVol({ extrudeChamferMm: 0.5 });
  const full = raisedVol({ extrudeChamferMm: 1 });
  check('Bevelled edges takes a size: more of it takes more off a raised colour', full < half && half < sharp,
    `${sharp.toFixed(1)} mm³ sharp, ${half.toFixed(1)} at 0.5 mm, ${full.toFixed(1)} at 1 mm`);
  check('…and 0.5 mm builds what the old toggle built, part for part',
    sameParts(build([art([FULL])], [FULL], { ...RAISED, extrudeChamferMm: 0.5 }).parts, build([art([FULL])], [FULL], { ...RAISED, extrudeChamfer: true }).parts),
    'extrudeChamferMm 0.5 against extrudeChamfer: true');
}

/* ------------------------------------------------------------------ nothing left behind */

{
  const run = () => void build([art([BAR]), word(H(0, -6, 0.45)), word(H(6, 6, 0.2), { partName: 'text-b' })], [BAR],
    { capWidthMm: 40, designRotation: 30, keychain: { enabled: true, style: 'loop', angleDeg: 45, holeDiameterMm: 5.2, offsetMm: 0 } });
  run();
  run();
  const before = heapInUse(heap);
  for (let i = 0; i < 4; i++) run();
  const left = (heapInUse(heap) - before) / 4;
  check('a turned build with words and a loop leaves nothing behind', Number.isFinite(before) && left === 0, `${left} B a rebuild`);
}

console.log(failures ? `\n${failures} FAILED` : '\nthe design layout holds');
process.exit(failures ? 1 : 0);
