/*
  The bottom picture: a traced picture inlaid in colour into the body's underside
  (src/geometry/bottomPicture.ts), measured, never looked at.

   - **Off** builds what it always built: an empty picture gives the same bytes as none.
   - **On**: one part per colour, named as given, in the base group, in its own colour, after the
     body, so no earlier part or filament slot moves.
   - **Flush, 0.4 mm**: every colour starts on the underside and stops 0.4 mm up; the body's
     underside stays where it was, so the seat is still the face.
   - **Nothing made or lost**: colours + the new body = the old body, on a plain, a hollow, a
     looped, a holed (keyring tunnel) and a textured body, and under a maker's mark.
   - **Mirrored**: what is on the right of the picture is on the left of the underside seen from
     above, so it reads the right way round from below.
   - **Inside the face**: clear of the wall and the bottom bevel on a square and a circle.
   - **The engine's size**: a bigger base takes a bigger picture, in its own proportions; no
     room leaves it off and says so.
   - **The maker's mark** keeps its recess: no colour fills it.
   - **Thin lines** are left out and said; a picture that is nearly all thin lines blocks export.
   - **Export**: the colours go in the body's object, seated on the plate with it, unflipped; a
     colour the top uses shares its filament slot; the embedded export puts them on plate 2.
   - No build here loses an identity mark (this suite runs with the seeded tier on).

  Run from the repo root: node apps/clicker-generator/tests/suites.mjs bottom-picture
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const { default: Module } = await import('manifold-3d');
const { withScope } = await import('@vostok/manifold');
const { readModel } = await import('@vostok/export/read');
const { buildClicker } = await import('../src/geometry/buildClicker.ts');
const {
  carveBottomPicture, bottomMarginMm, mirrorPlace, largestFit,
  BOTTOM_DEPTH_MM, BOTTOM_NO_ROOM, BOTTOM_LINES_LEFT_OUT, BOTTOM_TOO_SMALL, BOTTOM_SIZED_TOO_SMALL, BOTTOM_OFF_FACE,
} = await import('../src/geometry/bottomPicture.ts');
const {
  bottomPoint, cleanBottomPlace, placeFromBox, undersideCentre, isDefaultPlace, DEFAULT_BOTTOM_PLACE,
  nudgeBottomPlace, turnBottomPlace, bottomPlaceReadout, BOTTOM_PAD,
} = await import('../src/geometry/bottomPlace.ts');
const { bottomTraceKey, placedBottomArt, cleanBottomPicture } = await import('../src/bottomArt.ts');
const { clickerThreeMF } = await import('../src/export/threemfExport.ts');
const { clickerObjPlates } = await import('../src/export/objExport.ts');
const { plateLayout, assemblyMinZ, placed } = await import('../src/export/plateLayout.ts');
type BuildParams = import('../src/types.ts').BuildParams;
type BuildRegion = import('../src/types.ts').BuildRegion;
type BottomArt = import('../src/types.ts').BottomArt;
type ClickerPart = import('../src/types.ts').ClickerPart;
type Ring = import('../src/types.ts').Ring;

const wasm: any = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;

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
  const solid = Manifold.ofMesh(mesh);
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

const RED: [number, number, number] = [200, 30, 30];
const BLUE: [number, number, number] = [30, 30, 200];
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
const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const FULL = rect(-0.5, -0.5, 0.5, 0.5);
// The top: one red square, the same red as one of the bottom's colours.
const topArt: BuildRegion = { filamentRgb: RED, coverage: 1, rings: [FULL], partName: 'top-color-0-0' };

// The bottom: red entirely on the right (+X) of the picture, blue on the left.
const PICTURE: BottomArt = {
  regions: [
    { filamentRgb: RED, coverage: 0.3, rings: [rect(0.1, -0.3, 0.5, 0.3)], partName: 'bottom-color-0-0' },
    { filamentRgb: BLUE, coverage: 0.5, rings: [rect(-0.5, -0.3, 0, 0.3)], partName: 'bottom-color-1-0' },
  ],
  outline: [rect(-0.5, -0.3, 0.5, 0.3)],
};
const build = (over: Partial<BuildParams>) =>
  buildClicker(wasm, socket, stem, [topArt], [FULL], { ...DEFAULTS, ...over });

const allWarnings: { label: string; warnings: string[] }[] = [];
const buildBoth = (label: string, over: Partial<BuildParams>) => {
  const off = build(over);
  const on = build({ ...over, bottomArt: PICTURE });
  allWarnings.push({ label: `${label}, off`, warnings: off.warnings }, { label, warnings: on.warnings });
  return { off, on };
};

/* ------------------------------------------------------------------ measuring */

const named = (parts: ClickerPart[], name: string) => parts.find((p) => p.name === name);
const bodyOf = (parts: ClickerPart[]) => named(parts, 'base-body')!;
const bottoms = (parts: ClickerPart[]) => parts.filter((p) => p.name.startsWith('bottom-'));
const solidOf = (p: ClickerPart) =>
  Manifold.ofMesh(new wasm.Mesh({ numProp: p.numProp, vertProperties: p.vertProperties, triVerts: p.triVerts }));
const volumeOf = (p: ClickerPart) => {
  const s = solidOf(p);
  const v = s.volume();
  s.delete();
  return v;
};
interface Box { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
const boxOf = (ps: ClickerPart[]): Box => {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of ps) {
    const v = p.vertProperties;
    for (let i = 0; i < v.length; i += p.numProp) {
      b.minX = Math.min(b.minX, v[i]); b.maxX = Math.max(b.maxX, v[i]);
      b.minY = Math.min(b.minY, v[i + 1]); b.maxY = Math.max(b.maxY, v[i + 1]);
      b.minZ = Math.min(b.minZ, v[i + 2]); b.maxZ = Math.max(b.maxZ, v[i + 2]);
    }
  }
  return b;
};
const vertsOf = (p: ClickerPart): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < p.vertProperties.length; i += p.numProp) out.push([p.vertProperties[i], p.vertProperties[i + 1], p.vertProperties[i + 2]]);
  return out;
};
const bytesEqual = (a: ClickerPart[], b: ClickerPart[]) =>
  a.length === b.length && a.every((p, i) => {
    const q = b[i];
    return p.name === q.name && p.vertProperties.length === q.vertProperties.length
      && p.vertProperties.every((x, k) => x === q.vertProperties[k])
      && p.triVerts.length === q.triVerts.length && p.triVerts.every((x, k) => x === q.triVerts[k]);
  });
/** How much of a small sphere at (x, y, z) is inside the part. */
const shareInside = (p: ClickerPart, x: number, y: number, z: number, r = 0.1) => {
  const m = solidOf(p);
  const s = Manifold.sphere(r, 12);
  const at = s.translate([x, y, z]);
  const inter = m.intersect(at);
  const share = inter.volume() / at.volume();
  for (const o of [m, s, at, inter]) o.delete();
  return share;
};

/* ------------------------------------------------------------------ the pure helpers */

check('margin: 1.5 mm, or 1 mm past the bottom bevel when that is more',
  bottomMarginMm(0) === 1.5 && bottomMarginMm(0.5) === 1.5 && bottomMarginMm(1) === 2 && bottomMarginMm(2.5) === 3.5,
  [0, 0.5, 1, 2.5].map((b) => bottomMarginMm(b)).join(', '));
const m = mirrorPlace([[1, 2], [-0.5, 0]], 10, 3, 4);
check('mirrorPlace: X negated, scaled, then moved', m[0][0] === -7 && m[0][1] === 24 && m[1][0] === 8 && m[1][1] === 4, JSON.stringify(m));
const lf = largestFit((s) => s <= 3.3, 10);
check('largestFit finds the edge', Math.abs(lf - 3.3) < 0.01 && lf <= 3.3, lf.toFixed(4));
check('largestFit: all fits is the top, none fits is 0', largestFit(() => true, 5) === 5 && largestFit(() => false, 5) < 0.01 && largestFit(() => true, 0) === 0, 'ok');

/* ------------------------------------------------------------------ off */

{
  const plain = build({});
  const empty = build({ bottomArt: { regions: [], outline: [] } });
  check('off: an empty bottom picture builds the same bytes as none', bytesEqual(plain.parts, empty.parts) && plain.warnings.join() === empty.warnings.join(),
    `${plain.parts.length} parts, ${plain.parts.map((p) => p.name).join(', ')}`);
  check('off: no bottom parts', bottoms(plain.parts).length === 0, `${bottoms(plain.parts).length}`);
}

/* ------------------------------------------------------------------ on: parts, flush, volume */

const CASES: [string, Partial<BuildParams>][] = [
  ['plain circle', {}],
  ['hollow base', { hollowBase: true }],
  ['keyring loop', { keychain: { enabled: true, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 } }],
  ['keyring hole', { baseShape: 'rect', bodySize: { w: 40, h: 40 }, keychain: { enabled: true, style: 'hole', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 } }],
  ['textured wall', { blockTexture: 'chevron' }],
];
const plainOn = { parts: [] as ClickerPart[] };
for (const [label, over] of CASES) {
  const { off, on } = buildBoth(label, over);
  const inl = bottoms(on.parts);
  const oldBody = bodyOf(off.parts), newBody = bodyOf(on.parts);
  if (label === 'plain circle') {
    plainOn.parts = on.parts;
    const iBody = on.parts.findIndex((p) => p.name === 'base-body');
    check('on: one part per colour, named as given, after the body',
      inl.map((p) => p.name).join() === 'bottom-color-0-0,bottom-color-1-0'
        && on.parts.indexOf(inl[0]) > iBody && on.parts.indexOf(inl[1]) > iBody,
      on.parts.map((p) => p.name).join(', '));
    check('on: in the base group, a body part, in its own colour',
      inl.every((p) => p.group === 'base' && p.kind === 'body')
        && named(on.parts, 'bottom-color-0-0')!.colorRgb.join() === RED.join()
        && named(on.parts, 'bottom-color-1-0')!.colorRgb.join() === BLUE.join(),
      inl.map((p) => `${p.name} ${p.group}/${p.kind} ${p.colorRgb.join(',')}`).join('; '));
    check('on: every part before the body is unchanged', bytesEqual(off.parts.slice(0, iBody), on.parts.slice(0, iBody)), `${iBody} parts`);
  }
  if (label === 'keyring hole') {
    check('keyring hole: the tunnel is still cut with the picture on', !on.blocking.length && on.layout.tunnel !== undefined, on.blocking.join(' | ') || 'cut');
  }
  const ob = boxOf([oldBody]), nb = boxOf([newBody]);
  const flush = inl.length === 2 && inl.every((p) => {
    const b = boxOf([p]);
    return Math.abs(b.minZ - ob.minZ) < 1e-3 && Math.abs(b.maxZ - (ob.minZ + BOTTOM_DEPTH_MM)) < 1e-3;
  });
  check(`${label}: flush with the underside, ${BOTTOM_DEPTH_MM} mm deep, the body's underside where it was`,
    flush && Math.abs(nb.minZ - ob.minZ) < 1e-4,
    inl.map((p) => { const b = boxOf([p]); return `${p.name} z ${b.minZ.toFixed(3)}..${b.maxZ.toFixed(3)}`; }).join('; ') + `; body ${ob.minZ.toFixed(3)} -> ${nb.minZ.toFixed(3)}`);
  const vOld = volumeOf(oldBody), vNew = volumeOf(newBody);
  const vIn = inl.reduce((s, p) => s + volumeOf(p), 0);
  check(`${label}: colours + the new body = the old body`, Math.abs(vIn + vNew - vOld) < 0.01 && vIn > 10,
    `${vOld.toFixed(3)} = ${vNew.toFixed(3)} + ${vIn.toFixed(3)} (off by ${(vIn + vNew - vOld).toFixed(4)} mm3)`);
}

/* ------------------------------------------------------------------ mirrored */

{
  const body = boxOf([bodyOf(plainOn.parts)]);
  const cx = (body.minX + body.maxX) / 2;
  const red = boxOf([named(plainOn.parts, 'bottom-color-0-0')!]);
  const blue = boxOf([named(plainOn.parts, 'bottom-color-1-0')!]);
  check('mirrored: the picture\'s right lands on the left of the underside seen from above',
    red.maxX < cx - 0.5 && blue.minX > cx - 0.5 && blue.maxX > cx + 5,
    `centre ${cx.toFixed(2)}; red x ${red.minX.toFixed(2)}..${red.maxX.toFixed(2)}; blue x ${blue.minX.toFixed(2)}..${blue.maxX.toFixed(2)}`);
}

/* ------------------------------------------------------------------ inside the face */

{
  const MARGIN = bottomMarginMm(0.5);
  const circle = plainOn.parts;
  const cb = boxOf([bodyOf(circle)]);
  const ccx = (cb.minX + cb.maxX) / 2, ccy = (cb.minY + cb.maxY) / 2, R = (cb.maxX - cb.minX) / 2;
  const far = Math.max(...bottoms(circle).flatMap(vertsOf).map(([x, y]) => Math.hypot(x - ccx, y - ccy)));
  check('inside the face, circle: every colour at least the margin inside the wall', far <= R - MARGIN + 1e-3,
    `furthest ${far.toFixed(2)} mm from the centre, wall at ${R.toFixed(2)}, margin ${MARGIN}`);
  const sq = build({ baseShape: 'rect', bodySize: { w: 30, h: 30 }, bottomArt: { regions: [{ ...PICTURE.regions[0], rings: [FULL] }], outline: [FULL] } });
  allWarnings.push({ label: 'square', warnings: sq.warnings });
  const sb = boxOf([bodyOf(sq.parts)]), ib = boxOf(bottoms(sq.parts));
  const gap = Math.min(ib.minX - sb.minX, sb.maxX - ib.maxX, ib.minY - sb.minY, sb.maxY - ib.maxY);
  check('inside the face, square: every colour at least the margin inside the wall', bottoms(sq.parts).length === 1 && gap >= MARGIN - 1e-3,
    `closest ${gap.toFixed(2)} mm to the wall`);
  // A 2 mm bottom bevel moves the margin to 3 mm, so the same picture on the same base is smaller.
  const bevelled = build({
    edgeSettings: [{ target: 'capTop', style: 'chamfer', radius: 0.5 }, { target: 'clickerBase', style: 'chamfer', radius: 2 }],
    bottomArt: PICTURE,
  });
  allWarnings.push({ label: 'bevelled', warnings: bevelled.warnings });
  const w0 = boxOf(bottoms(circle)), w1 = boxOf(bottoms(bevelled.parts));
  check('a wider bottom bevel keeps the picture further in', w1.maxX - w1.minX < w0.maxX - w0.minX - 1,
    `${(w0.maxX - w0.minX).toFixed(2)} mm wide at a 0.5 mm bevel, ${(w1.maxX - w1.minX).toFixed(2)} at 2 mm`);
}

/* ------------------------------------------------------------------ the engine's size */

{
  const WIDE: BottomArt = {
    regions: [{ filamentRgb: RED, coverage: 1, rings: [rect(-0.5, -0.125, 0.5, 0.125)], partName: 'bottom-color-0-0' }],
    outline: [rect(-0.5, -0.125, 0.5, 0.125)],
  };
  const at = (capWidthMm: number) => {
    const r = build({ capWidthMm, bottomArt: WIDE });
    allWarnings.push({ label: `4:1 at ${capWidthMm}`, warnings: r.warnings });
    const b = boxOf(bottoms(r.parts));
    return { w: b.maxX - b.minX, h: b.maxY - b.minY, n: bottoms(r.parts).length };
  };
  const small = at(35), big = at(60);
  const bleed = 2 * DEFAULTS.colorBleed;
  const ratio = (s: { w: number; h: number }) => (s.w - bleed) / (s.h - bleed);
  check('a 4:1 picture fits, and is wider on a 60 mm base than on a 35 mm one', small.n === 1 && big.n === 1 && big.w > small.w + 15,
    `${small.w.toFixed(1)} x ${small.h.toFixed(1)} mm against ${big.w.toFixed(1)} x ${big.h.toFixed(1)} mm`);
  check('it keeps its proportions', Math.abs(ratio(small) - 4) < 0.05 && Math.abs(ratio(big) - 4) < 0.05,
    `${ratio(small).toFixed(3)}, ${ratio(big).toFixed(3)}`);
}

/* ------------------------------------------------------------------ the maker's mark */

{
  const mark = { rings: [FULL], sizeMm: 10 };
  const { off, on } = buildBoth('maker\'s mark', { brandMark: mark });
  const plain = build({ bottomArt: PICTURE });
  const ob = boxOf([bodyOf(off.parts)]);
  const cx = (ob.minX + ob.maxX) / 2, cy = (ob.minY + ob.maxY) / 2;
  // Inside the mark's square and the blue colour's footprint, half way up the pocket.
  const [px, py, pz] = [cx + 2.5, cy, ob.minZ + BOTTOM_DEPTH_MM / 2];
  const blueOn = named(on.parts, 'bottom-color-1-0')!, bluePlain = named(plain.parts, 'bottom-color-1-0')!;
  check('maker\'s mark: its recess stays empty (without the mark, that spot is the blue colour)',
    shareInside(blueOn, px, py, pz) < 1e-6 && shareInside(bodyOf(on.parts), px, py, pz) < 1e-6 && shareInside(bluePlain, px, py, pz) > 0.98,
    `blue ${shareInside(blueOn, px, py, pz).toFixed(3)}, body ${shareInside(bodyOf(on.parts), px, py, pz).toFixed(3)}; no mark: blue ${shareInside(bluePlain, px, py, pz).toFixed(3)}`);
  const vOld = volumeOf(bodyOf(off.parts)), vNew = volumeOf(bodyOf(on.parts));
  const vIn = bottoms(on.parts).reduce((s, p) => s + volumeOf(p), 0);
  check('maker\'s mark: colours + the new body = the old body', Math.abs(vIn + vNew - vOld) < 0.01,
    `${vOld.toFixed(3)} = ${vNew.toFixed(3)} + ${vIn.toFixed(3)}`);
}

/* ------------------------------------------------------------------ the carve on its own: room, lines */

/** A 40 x 40 x 10 mm block standing on Z = 0, carved with the app's bleed and line rule. */
function carveBlock(art: BottomArt, footprintMm = 40, marginMm = 1.5) {
  return withScope((track) => {
    const footprint = track(CrossSection.square([footprintMm, footprintMm], true));
    const body = track(track(Manifold.cube([40, 40, 10], true)).translate([0, 0, 5]));
    const out = carveBottomPicture(track, wasm, {
      body, footprint, bottomZ: 0, marginMm, art, colorBleed: 0.12,
      lines: { openMm: 0.2, lossSaid: 0.05, keepsMin: 0.5 },
    });
    return {
      same: out.body === body,
      names: out.inlays.map((i) => i.name),
      volumes: out.inlays.map((i) => i.solid.volume()),
      bodyLost: body.volume() - out.body.volume(),
      sizeMm: out.sizeMm,
      warnings: out.warnings,
      blocking: out.blocking,
    };
  });
}
{
  const tiny = carveBlock(PICTURE, 6);
  check('no room (a 6 mm base): left off and said, the body untouched',
    tiny.names.length === 0 && tiny.same && tiny.warnings.join() === BOTTOM_NO_ROOM && !tiny.blocking.length,
    `${tiny.warnings.join(' | ')}; size ${tiny.sizeMm}`);
  const none = carveBlock(PICTURE, 2);
  check('no room at all (the margin eats the face): left off and said', none.names.length === 0 && none.same && none.warnings.join() === BOTTOM_NO_ROOM, none.warnings.join(' | '));

  // The size the unit square takes on this block, then lines 0.1 mm wide at that size: grown by
  // the bleed they print 0.34 mm, under the 0.4 mm a line needs.
  const square: BottomArt = { regions: [{ ...PICTURE.regions[0], rings: [FULL] }], outline: [FULL] };
  const size = carveBlock(square).sizeMm;
  const wider = carveBlock(square, 40, 5).sizeMm;
  check('size: the largest square inside the margin, times 0.85',
    Math.abs(size - (40 - 2 * 1.5) * 0.85) < 0.02 && Math.abs(wider - (40 - 2 * 5) * 0.85) < 0.02,
    `${size.toFixed(3)} mm at a 1.5 mm margin (${((40 - 3) * 0.85).toFixed(3)}), ${wider.toFixed(3)} at 5 mm (${((40 - 10) * 0.85).toFixed(3)})`);
  const thin = 0.1 / size;
  const stripes = (from: number, n: number): BuildRegion[] => Array.from({ length: n }, (_, k) => ({
    filamentRgb: BLUE, coverage: 0.01, partName: `bottom-color-1-${k}`,
    rings: [rect(from + k * 0.04, -0.4, from + k * 0.04 + thin, 0.4)],
  }));
  const mixed = carveBlock({
    regions: [{ filamentRgb: RED, coverage: 0.5, rings: [rect(-0.45, -0.4, 0, 0.4)], partName: 'bottom-color-0-0' }, ...stripes(0.1, 8)],
    outline: [FULL],
  });
  check('thin lines: left out of the print and said once',
    mixed.names.join() === 'bottom-color-0-0' && mixed.warnings.join() === BOTTOM_LINES_LEFT_OUT && !mixed.blocking.length,
    `size ${size.toFixed(2)} mm; parts ${mixed.names.join(', ')}; ${mixed.warnings.join(' | ')}`);
  check('the carve keeps the volume: the block loses what the colours take', Math.abs(mixed.bodyLost - mixed.volumes.reduce((s, v) => s + v, 0)) < 0.01,
    `${mixed.bodyLost.toFixed(3)} mm3 lost, ${mixed.volumes.reduce((s, v) => s + v, 0).toFixed(3)} in colour`);
  const allThin = carveBlock({ regions: stripes(-0.4, 20), outline: [FULL] });
  check('a picture of nothing but thin lines blocks export', allThin.blocking.join() === BOTTOM_TOO_SMALL && allThin.names.length === 0,
    `${allThin.blocking.join(' | ')}; ${allThin.names.length} parts`);
}

/* ------------------------------------------------------------------ the customer's place */

{
  // The arithmetic the build, the rail and the 2D view share.
  const pts: [number, number][] = [[0.3, -0.2], [-0.5, 0.5], [0, 0], [0.123456, -0.98765]];
  check('place: the engine\'s own place is the old placement to the bit',
    pts.every(([x, y]) => { const a = bottomPoint(x, y, 31.45, 1.25, -2.5); const b = mirrorPlace([[x, y]], 31.45, 1.25, -2.5)[0]!; return a[0] === b[0] && a[1] === b[1]; }), 'four points');
  const moved = bottomPoint(0.5, 0, 10, 0, 0, { x: 2, y: 3, rotation: 0, scale: 1 });
  const turned = bottomPoint(0.5, 0, 10, 0, 0, { x: 0, y: 0, rotation: 90, scale: 2 });
  check('place: moved right seen from below is moved left seen from above; up is up; a turn is counter-clockwise from below',
    Math.abs(moved[0] - -7) < 1e-9 && Math.abs(moved[1] - 3) < 1e-9 && Math.abs(turned[0]) < 1e-9 && Math.abs(turned[1] - 10) < 1e-9,
    `${moved.map((v) => v.toFixed(3))} / ${turned.map((v) => v.toFixed(3))}`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  check('place: a missing or broken one is the engine\'s; numbers are held to their ranges and turns wrap',
    same(cleanBottomPlace(undefined), DEFAULT_BOTTOM_PLACE) && same(cleanBottomPlace('junk'), DEFAULT_BOTTOM_PLACE)
      && same(cleanBottomPlace({ x: 99, y: -99, rotation: 270, scale: 9 }), { x: 25, y: -25, rotation: -90, scale: 2 })
      && same(cleanBottomPlace({ x: Number.NaN, scale: 0.01, rotation: '5' }), { x: 0, y: 0, rotation: 0, scale: 0.3 }),
    JSON.stringify(cleanBottomPlace({ x: 99, y: -99, rotation: 270, scale: 9 })));
  const area = { cx: 4, cy: -3, autoMm: 20 };
  const p = { x: 2.5, y: -1.5, rotation: 30, scale: 1.25 };
  const [vx, vy] = undersideCentre(area.cx, area.cy, p);
  const back = placeFromBox({ cx: vx, cy: vy, w: 0.8 * area.autoMm * p.scale, rotation: p.rotation }, area, 0.8);
  check('place: a box drawn from a place on the underside view reads back as that place', same(back, p), JSON.stringify(back));
  // The Bottom category's pad: a step a press, seen from below, held to the range; a turn corner wraps.
  const padded = nudgeBottomPlace(nudgeBottomPlace({ x: 24.8, y: 0, rotation: 30, scale: 1.5 }, 'right'), 'up');
  check('pad: an arrow moves the picture one step, held to the range, its size and turn kept',
    same(padded, { x: 25, y: BOTTOM_PAD.stepMm, rotation: 30, scale: 1.5 }) && same(nudgeBottomPlace(DEFAULT_BOTTOM_PLACE, 'left'), { x: -BOTTOM_PAD.stepMm, y: 0, rotation: 0, scale: 1 }),
    JSON.stringify(padded));
  check('pad: a turn corner turns it by one step, left positive, wrapping past a half turn',
    turnBottomPlace(DEFAULT_BOTTOM_PLACE, BOTTOM_PAD.turnDeg).rotation === BOTTOM_PAD.turnDeg
      && turnBottomPlace({ x: 0, y: 0, rotation: 178, scale: 1 }, BOTTOM_PAD.turnDeg).rotation === -177,
    String(turnBottomPlace({ x: 0, y: 0, rotation: 178, scale: 1 }, BOTTOM_PAD.turnDeg).rotation));
  check('pad: the readout says where it is in words, and the middle when it has not moved',
    bottomPlaceReadout(DEFAULT_BOTTOM_PLACE) === 'In the middle'
      && bottomPlaceReadout({ x: 6, y: -4, rotation: 45, scale: 1 }) === '6.0 mm right · 4.0 mm down · turned 45°',
    bottomPlaceReadout({ x: 6, y: -4, rotation: 45, scale: 1 }));
  // The trace does not depend on the place, and the build is only told one that is not the engine's.
  const bp = cleanBottomPicture({ smoothing: 0.2 })!;
  check('place: moving it leaves the trace key alone; the engine\'s place adds nothing to the build',
    bottomTraceKey(bp) === bottomTraceKey({ ...bp, place: p }) && placedBottomArt(PICTURE, DEFAULT_BOTTOM_PLACE) === PICTURE
      && same(placedBottomArt(PICTURE, p).place, p) && isDefaultPlace(bp.place),
    bottomTraceKey(bp));

  // On the 40 mm block: where each colour lands, seen from above.
  const carvePlaced = (place: unknown, footprintMm = 40) => withScope((track) => {
    const footprint = track(CrossSection.square([footprintMm, footprintMm], true));
    const body = track(track(Manifold.cube([40, 40, 10], true)).translate([0, 0, 5]));
    const out = carveBottomPicture(track, wasm, {
      body, footprint, bottomZ: 0, marginMm: 1.5, art: place ? { ...PICTURE, place: place as any } : PICTURE, colorBleed: 0.12,
      lines: { openMm: 0.2, lossSaid: 0.05, keepsMin: 0.5 },
    });
    const box = (n: string) => {
      const i = out.inlays.find((q) => q.name === n);
      if (!i) return null;
      const b = i.solid.boundingBox();
      return { minX: b.min[0], maxX: b.max[0], minY: b.min[1], maxY: b.max[1] };
    };
    return {
      same: out.body === body, red: box('bottom-color-0-0'), blue: box('bottom-color-1-0'), names: out.inlays.map((q) => q.name),
      lost: body.volume() - out.body.volume(), inColour: out.inlays.reduce((v, q) => v + q.solid.volume(), 0),
      warnings: out.warnings, sizeMm: out.sizeMm, area: out.area ? { cx: out.area.cx, cy: out.area.cy, autoMm: out.area.autoMm } : null,
    };
  });
  const at = carvePlaced(null);
  const atDefault = carvePlaced({ ...DEFAULT_BOTTOM_PLACE });
  check('place: the engine\'s place, given, carves what no place carves',
    same(at.red, atDefault.red) && same(at.blue, atDefault.blue) && at.lost === atDefault.lost, JSON.stringify(at.red));
  check('place: the carve says where it could go: the middle of the flat and the engine\'s size',
    !!at.area && Math.abs(at.area.cx) < 1e-6 && Math.abs(at.area.cy) < 1e-6 && Math.abs(at.area.autoMm - (40 - 3) * 0.85) < 0.02,
    JSON.stringify(at.area));
  const shifted = carvePlaced({ x: 2, y: 3, rotation: 0, scale: 1 });
  const d = (a: any, b: any, k: string) => b[k] - a[k];
  const want: [string, number][] = [['minX', -2], ['maxX', -2], ['minY', 3], ['maxY', 3]];
  check('place: moved 2 mm right and 3 mm up seen from below, every colour lands 2 mm left and 3 mm up seen from above',
    !!shifted.red && !!at.red && want.every(([k, v]) => Math.abs(d(at.red, shifted.red, k) - v) < 0.05)
      && Math.abs(shifted.lost - shifted.inColour) < 0.01,
    `red moved ${want.map(([k]) => d(at.red, shifted.red, k).toFixed(3)).join(', ')}`);
  const quarter = carvePlaced({ x: 0, y: 0, rotation: 90, scale: 1 });
  check('place: a quarter turn counter-clockwise from below puts the red right-hand side at the top',
    !!quarter.red && quarter.red.minY > 2.5 && quarter.red.maxY > 15 && Math.abs(quarter.red.minX + quarter.red.maxX) < 0.1,
    JSON.stringify(quarter.red));
  const half = carvePlaced({ x: 0, y: 0, rotation: 0, scale: 0.5 });
  const w = (b: any) => b.maxX - b.minX;
  check('place: Size 50 % halves it', !!half.red && !!at.red && Math.abs(w(half.red) - w(at.red) / 2) < 0.2 && Math.abs(half.sizeMm - at.sizeMm / 2) < 1e-9,
    `${w(at.red).toFixed(2)} -> ${w(half.red).toFixed(2)} mm`);
  const big = carvePlaced({ x: 0, y: 0, rotation: 0, scale: 2 });
  check('place: Size 200 % runs past the flat and is cut off at it, and the block still loses only what the colours take',
    !!big.red && big.red.minX > -18.5 - 0.05 && big.red.minX < -18 && Math.abs(big.lost - big.inColour) < 0.01,
    `red from ${big.red?.minX.toFixed(3)}; lost ${big.lost.toFixed(3)}, colour ${big.inColour.toFixed(3)}`);
  const off = carvePlaced({ x: 25, y: 0, rotation: 0, scale: 0.3 });
  check('place: moved clean off the flat: nothing carved, and said', off.names.length === 0 && off.same && off.warnings.join() === BOTTOM_OFF_FACE,
    off.warnings.join(' | '));
  const tiny = carvePlaced({ x: 0, y: 0, rotation: 0, scale: 0.3 }, 20);
  check('place: sized under 8 mm: left off, and said', tiny.names.length === 0 && tiny.same && tiny.warnings.join() === BOTTOM_SIZED_TOO_SMALL,
    tiny.warnings.join(' | '));

  // The clicker's build: the default place builds the same bytes; the layout carries the flat.
  const plain = build({ bottomArt: PICTURE });
  const given = build({ bottomArt: { ...PICTURE, place: { ...DEFAULT_BOTTOM_PLACE } } });
  const none = build({});
  check('place: on the clicker, the engine\'s place given builds the same bytes as none given',
    bytesEqual(plain.parts, given.parts), `${plain.parts.length} parts`);
  const lb = plain.layout.bottom;
  check('layout: a bottom picture sends back its flat, middle and size; none sends nothing',
    !!lb && lb.autoMm > 8 && lb.safe.length > 0 && !('bottom' in none.layout),
    JSON.stringify(lb ? { cx: lb.cx, cy: lb.cy, autoMm: lb.autoMm, rings: lb.safe.length } : null));
}

/* ------------------------------------------------------------------ export */

{
  const parts = plainOn.parts;
  const minZ = assemblyMinZ(parts);
  const layout = plateLayout(parts, minZ, { plate: 'a1' });
  const pl = layout.placementFor('base');
  const zs = (p: ClickerPart) => { const v = placed(p, minZ, pl); const z: number[] = []; for (let i = 2; i < v.length; i += 3) z.push(v[i]); return z; };
  const red = zs(named(parts, 'bottom-color-0-0')!), body = zs(bodyOf(parts));
  check('export: the body is not flipped, and it and its colours sit on the plate',
    !pl.flip && Math.abs(Math.min(...body)) < 1e-6 && Math.abs(Math.min(...red)) < 1e-6 && Math.abs(Math.max(...red) - BOTTOM_DEPTH_MM) < 1e-3,
    `flip ${pl.flip}; body from ${Math.min(...body).toFixed(4)}, red ${Math.min(...red).toFixed(4)}..${Math.max(...red).toFixed(4)}`);

  const cfg = strFromU8(unzipSync(clickerThreeMF(parts, { plate: 'a1' }))['Metadata/model_settings.config']!);
  const objects = [...cfg.matchAll(/<object id="\d+"><metadata key="name" value="([^"]*)"\/>((?:(?!<\/object>)[\s\S])*)/g)]
    .map(([, name, inner]) => ({
      name: name!,
      parts: [...inner!.matchAll(/<part [^>]*><metadata key="name" value="([^"]*)"\/><metadata key="extruder" value="(\d+)"\/>/g)]
        .map(([, n, e]) => ({ name: n!, extruder: Number(e) })),
    }));
  const base = objects.find((o) => o.parts.some((p) => p.name === 'base-body'));
  const slot = (n: string) => objects.flatMap((o) => o.parts).find((p) => p.name === n)?.extruder;
  check('3MF: the colours are parts of the body\'s object',
    !!base && ['bottom-color-0-0', 'bottom-color-1-0'].every((n) => base.parts.some((p) => p.name === n)),
    objects.map((o) => `${o.name}: ${o.parts.map((p) => p.name).join(', ')}`).join(' / '));
  check('3MF: a colour the top uses shares its filament slot; a new colour takes a new one',
    slot('bottom-color-0-0') === slot('top-color-0-0') && slot('bottom-color-1-0') !== slot('bottom-color-0-0')
      && slot('bottom-color-1-0') === Math.max(...objects.flatMap((o) => o.parts.map((p) => p.extruder))),
    objects.flatMap((o) => o.parts.map((p) => `${p.name} ${p.extruder}`)).join(', '));

  const { objs } = clickerObjPlates(parts);
  const names = (obj: string) => obj.split('\n').filter((l) => l.startsWith('o ')).map((l) => l.slice(2));
  check('embedded export: the colours go on plate 2 with the body',
    objs.length === 2 && names(objs[1]!).some((n) => n.endsWith('bottom-color-0-0')) && !names(objs[0]!).some((n) => n.includes('bottom-')),
    objs.map((o, i) => `plate ${i + 1}: ${names(o).join(', ')}`).join(' / '));
}

/* ------------------------------------------------------------------ identity marks */

const lost = allWarnings.filter((b) => b.warnings.some((w) => w.startsWith('Provenance')));
check('every build keeps all its identity marks', lost.length === 0,
  lost.length ? lost.map((b) => b.label).join(', ') : `${allWarnings.length} builds`);

socket.delete();
stem.delete();
console.log(failures ? `\n${failures} FAILED` : '\nbottom picture: all passed');
process.exit(failures ? 1 : 0);
