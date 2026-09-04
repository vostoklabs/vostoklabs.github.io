/*
  The two geometry features a seller pays for: a body that is one size whatever the artwork is,
  and a maker's mark on the underside.

  Both are the kind of thing that looks right in a screenshot and is wrong on a print, so every
  assertion here is a measurement rather than a render:

   • "Fixed size" is a promise about the finished part. The way it fails is not that it looks
     odd — it is that forty names come out as forty slightly different parts and the seller
     finds out after printing them. So the test builds two designs with completely different
     aspect ratios and asserts the bodies are the SAME SIZE to a tenth of a millimetre.
   • The mark is read from BELOW, so it has to be mirrored, and nothing about looking at the
     model from above can tell you whether it was. The test reads the recess floor's X sign.

  Run from the repo root (same two-step as tests/fit-controls.test.ts, and for the same reason —
  extensionless imports and an app-local manifold-3d):

    node_modules/.bin/esbuild apps/clicker-generator/tests/seller-features.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --outfile=apps/clicker-generator/.seller-test.mjs \
      && node apps/clicker-generator/.seller-test.mjs
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { parse3MF } from '../src/geometry/threemfImport.ts';
import { buildClicker } from '../src/geometry/buildClicker.ts';
import type { BuildParams, BuildRegion, ClickerPart, Ring } from '../src/types.ts';

const asset = (p: string) =>
  readFileSync(join(process.cwd(), 'apps/clicker-generator/public/assets', p)).buffer as ArrayBuffer;

const wasm = await Module();
wasm.setup();

/** Same normalisation the worker does at init — centred in XY, socket top at Z 0. */
function prep(buf: ArrayBuffer, dropTopToZero: boolean) {
  const raw = parse3MF(buf);
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: raw.vertProperties, triVerts: raw.triVerts });
  mesh.merge();
  const solid = wasm.Manifold.ofMesh(mesh);
  const bb = solid.boundingBox();
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const cy = (bb.min[1] + bb.max[1]) / 2;
  const out = solid.translate([-cx, -cy, dropTopToZero ? -bb.max[2] : 0]);
  solid.delete();
  return out;
}

const socket = prep(asset('switch/mx/mx-socket.3mf'), true);
const stem = prep(asset('switch/mx/mx-stem.3mf'), false);

/** A ring covering a normalised box — `trace`'s output convention: longest side 1, Y-up. */
const box = (x0: number, y0: number, x1: number, y1: number): Ring =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** A plain square design, and a 4:1 wide one. Different enough that any artwork-driven sizing
 *  shows up immediately: the wide one is the exact case the outline size clamp complains about. */
const squareArt = box(-0.5, -0.5, 0.5, 0.5);
const wideArt = box(-0.5, -0.125, 0.5, 0.125);

const regionsFor = (r: Ring): BuildRegion[] => [
  { filamentRgb: [200, 30, 30], coverage: 1, rings: [r], partName: 'top-color-0-0' },
];

const base: BuildParams = {
  baseShape: 'square', capWidthMm: 35, topThickness: 1.5, imageDepth: 0.8, imageMargin: 2,
  borderWidth: 2, capProud: 1.2, tolerance: 0.4, stemFitPct: 0, socketFitPct: 0,
  imageOffset: { x: 0, y: 0 }, colorBleed: 0.05, stepHeight: 0.4, travel: 3.8,
  floorThickness: 1.2, switches: [{ x: 0, y: 0, rotation: 0 }],
  keychain: { enabled: false, style: 'loop', angleDeg: 90, holeDiameterMm: 5.2, offsetMm: 0 },
  baseFilamentRgb: [240, 240, 240], bodyColorRgb: [40, 40, 40],
  componentHeights: {}, edgeSettings: [], extrudeChamfer: false,
};

interface Measured {
  parts: ClickerPart[];
  warnings: string[];
  vol: number;
  w: number;
  h: number;
  minZ: number;
}

function run(art: Ring, params: BuildParams): Measured {
  const out = buildClicker(wasm, socket, stem, regionsFor(art), [art], params);
  const body = out.parts.find((p) => p.name === 'base-body')!;
  let vol = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  const v = body.vertProperties, t = body.triVerts, n = body.numProp;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    vol += (
      v[a] * (v[b + 1] * v[c + 2] - v[c + 1] * v[b + 2]) -
      v[a + 1] * (v[b] * v[c + 2] - v[c] * v[b + 2]) +
      v[a + 2] * (v[b] * v[c + 1] - v[c] * v[b + 1])
    ) / 6;
  }
  for (let i = 0; i < v.length; i += n) {
    if (v[i] < minX) minX = v[i];
    if (v[i] > maxX) maxX = v[i];
    if (v[i + 1] < minY) minY = v[i + 1];
    if (v[i + 1] > maxY) maxY = v[i + 1];
    if (v[i + 2] < minZ) minZ = v[i + 2];
  }
  return { parts: out.parts, warnings: out.warnings, vol, w: maxX - minX, h: maxY - minY, minZ };
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- fixed body footprint

// The control the whole thing exists for. Without it these two are 39 mm and 71 mm.
const freeSquare = run(squareArt, base);
const freeWide = run(wideArt, base);
check(
  'without a fixed size the artwork drives the body, which is the problem being solved',
  Math.abs(freeSquare.w - freeWide.w) > 1,
  `square ${freeSquare.w.toFixed(1)} mm vs wide ${freeWide.w.toFixed(1)} mm`,
);

const SIZE = { w: 42, h: 34 };
const fixedSquare = run(squareArt, { ...base, bodySize: SIZE });
const fixedWide = run(wideArt, { ...base, bodySize: SIZE });
check(
  'a fixed size is the size that comes out',
  Math.abs(fixedSquare.w - SIZE.w) < 0.3 && Math.abs(fixedSquare.h - SIZE.h) < 0.3,
  `asked ${SIZE.w} × ${SIZE.h}, got ${fixedSquare.w.toFixed(2)} × ${fixedSquare.h.toFixed(2)} mm`,
);
check(
  'two completely different designs come out as ONE SKU',
  Math.abs(fixedSquare.w - fixedWide.w) < 0.1 && Math.abs(fixedSquare.h - fixedWide.h) < 0.1,
  `square ${fixedSquare.w.toFixed(2)}×${fixedSquare.h.toFixed(2)}, `
  + `wide ${fixedWide.w.toFixed(2)}×${fixedWide.h.toFixed(2)} mm`,
);

// Size is the control the fixed footprint replaces, so it must stop doing anything — a slider
// that still moves something while a fixed size is set is the bug this feature is named after.
const fixedBigSlider = run(squareArt, { ...base, bodySize: SIZE, capWidthMm: 60 });
check(
  'Size no longer moves the body once a fixed size is set',
  Math.abs(fixedBigSlider.w - fixedSquare.w) < 0.05,
  `Size 35 -> ${fixedSquare.w.toFixed(2)} mm, Size 60 -> ${fixedBigSlider.w.toFixed(2)} mm`,
);
check(
  'and it says so rather than leaving the user to notice',
  fixedBigSlider.warnings.some((w) => w.includes('Size does nothing')),
  fixedBigSlider.warnings.join(' | ') || '(no warnings)',
);

// A body smaller than the switch's clear column cannot exist. Clamp and say the size used —
// silently producing a 24 mm part from a "16 mm" request is how a run goes wrong invisibly.
const tooSmall = run(squareArt, { ...base, bodySize: { w: 16, h: 16 } });
check(
  'a fixed size too small for an MX switch is raised, and named',
  tooSmall.warnings.some((w) => w.includes('Fixed base size raised')) && tooSmall.w > 16.5,
  `${tooSmall.w.toFixed(1)} mm — ` + (tooSmall.warnings.find((w) => w.includes('raised')) ?? 'no warning'),
);

// An outline base and a fixed size are contradictory. Falling back silently would leave the
// user believing the base still follows their design.
const outlineFixed = run(wideArt, { ...base, baseShape: 'outline', bodySize: SIZE });
check(
  'outline + fixed size falls back to a rectangle and explains itself',
  outlineFixed.warnings.some((w) => w.includes('cannot follow')) && Math.abs(outlineFixed.w - SIZE.w) < 0.3,
  `${outlineFixed.w.toFixed(2)} mm — ` + (outlineFixed.warnings.find((w) => w.includes('cannot follow')) ?? 'no warning'),
);

// Round shapes are the case where the switch column can push past the box. Whatever happens,
// the build must not claim a size it did not produce.
const circleFixed = run(squareArt, { ...base, baseShape: 'circle', bodySize: { w: 30, h: 30 } });
const circleHonest =
  Math.abs(circleFixed.w - 30) < 0.3 || circleFixed.warnings.some((w) => w.includes('rather than the fixed'));
check(
  'a round base either hits the fixed size or reports the size it really is',
  circleHonest,
  `${circleFixed.w.toFixed(2)} × ${circleFixed.h.toFixed(2)} mm — `
  + (circleFixed.warnings.find((w) => w.includes('rather than the fixed')) ?? 'on size'),
);

// Provenance survives the new footprint path (invariant #2).
check(
  'a fixed-size body still carries every identity mark',
  !fixedSquare.warnings.some((w) => w.startsWith('Provenance:')),
  fixedSquare.warnings.find((w) => w.startsWith('Provenance:')) ?? 'all marks buried',
);

// ---------------------------------------------------------------- brand mark (underside deboss)

/** Deliberately lopsided and entirely on the +X side, so the mirror is measurable. */
const markRings: Ring[] = [box(0.1, -0.2, 0.5, 0.2)];
const MARK_SIZE = 10;

const plain = run(squareArt, { ...base, bodySize: SIZE });
const marked = run(squareArt, { ...base, bodySize: SIZE, brandMark: { rings: markRings, sizeMm: MARK_SIZE } });

check(
  'the mark actually cuts material out of the body',
  marked.vol < plain.vol - 1,
  `${plain.vol.toFixed(1)} -> ${marked.vol.toFixed(1)} mm³ (${(plain.vol - marked.vol).toFixed(1)} mm³ removed)`,
);
check(
  'it is a deboss, not an emboss: nothing hangs below the seating face',
  Math.abs(marked.minZ - plain.minZ) < 1e-3,
  `underside Z ${plain.minZ.toFixed(3)} -> ${marked.minZ.toFixed(3)}`,
);
check(
  'and it does not change the part size, so a marked SKU is the same SKU',
  Math.abs(marked.w - plain.w) < 1e-3 && Math.abs(marked.h - plain.h) < 1e-3,
  `${plain.w.toFixed(2)}×${plain.h.toFixed(2)} -> ${marked.w.toFixed(2)}×${marked.h.toFixed(2)} mm`,
);

/* The mirror, which is the one thing no view of the model can tell you.

   The rings sit entirely at +X. The underside is read from below, so the recess has to be cut
   at −X for the mark to read the right way round on the printed part. Probe it by looking at
   the recess FLOOR — the vertices sitting exactly MARK_DEPTH above the underside — and asking
   which side of the body they are on. Unmirrored, every one of them is positive. */
const body = marked.parts.find((p) => p.name === 'base-body')!;
const floorZ = marked.minZ + 0.6;
let floorMinX = Infinity;
let floorMaxX = -Infinity;
for (let i = 0; i < body.vertProperties.length; i += body.numProp) {
  if (Math.abs(body.vertProperties[i + 2] - floorZ) < 1e-3) {
    const x = body.vertProperties[i];
    if (x < floorMinX) floorMinX = x;
    if (x > floorMaxX) floorMaxX = x;
  }
}
check(
  'the mark is mirrored in X, so it reads correctly on the printed underside',
  isFinite(floorMinX) && floorMaxX < 0,
  isFinite(floorMinX)
    ? `recess floor spans X ${floorMinX.toFixed(2)} … ${floorMaxX.toFixed(2)} (must be negative)`
    : 'no recess floor found at the expected depth',
);

check(
  'cutting the mark does not swallow an identity void',
  !marked.warnings.some((w) => w.startsWith('Provenance:')),
  marked.warnings.find((w) => w.startsWith('Provenance:')) ?? 'all marks still buried',
);

// A mark bigger than the base has to shrink, not overhang the wall and cut the outline open.
const oversized = run(squareArt, { ...base, bodySize: SIZE, brandMark: { rings: markRings, sizeMm: 200 } });
check(
  'an oversized mark is clamped to the base and says so',
  oversized.warnings.some((w) => w.includes('Brand mark shrunk')) && Math.abs(oversized.w - SIZE.w) < 0.3,
  oversized.warnings.find((w) => w.includes('Brand mark')) ?? 'not clamped',
);

// Hollow + mark together: both take material from the same face, in that order.
const hollowMarked = run(squareArt, {
  ...base, bodySize: { w: 60, h: 60 }, hollowBase: true,
  brandMark: { rings: markRings, sizeMm: MARK_SIZE },
});
check(
  'hollow base and brand mark coexist without losing a mark',
  !hollowMarked.warnings.some((w) => w.startsWith('Provenance:')),
  hollowMarked.warnings.find((w) => w.startsWith('Provenance:')) ?? 'all marks buried',
);
check(
  'and the result is still one closed solid',
  (() => {
    const p = hollowMarked.parts.find((x) => x.name === 'base-body');
    if (!p) return false;
    const seen = new Map<string, number>();
    for (let i = 0; i < p.triVerts.length; i += 3) {
      const t = [p.triVerts[i], p.triVerts[i + 1], p.triVerts[i + 2]];
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    return [...seen.values()].every((n) => n === 2);
  })(),
  'every edge shared by exactly two faces',
);

console.log(failures ? `\n${failures} FAILED` : '\nfixed footprint holds its size; the mark reads the right way round');
process.exit(failures ? 1 : 0);
