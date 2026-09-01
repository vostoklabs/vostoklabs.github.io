/*
  The three fit controls, measured rather than eyeballed.

  Two of them move geometry that is INSIDE the model — the cross socket in the cap's stem
  post, and the switch pocket in the body — so neither shows up in a bounding box or a
  screenshot, and the old stem control was broken for months precisely because "the number
  changed" was the only thing anyone could check. Volume is the thing that actually moves:
  a wider pocket removes more material from the body; a wider cross socket removes more from
  the cap. Both must also leave the OUTER size alone, which is the other half of each fix.

  Run from the repo root:

    node_modules/.bin/esbuild apps/clicker-generator/tests/fit-controls.test.ts \
      --bundle --platform=node --format=esm --external:manifold-3d \
      --outfile=apps/clicker-generator/.fit-test.mjs \
      && node apps/clicker-generator/.fit-test.mjs

  The bundle step is not optional and the output path is not arbitrary: the app's source uses
  extensionless imports, which Node's own type stripping will not resolve, and `manifold-3d`
  is installed in the app's `node_modules` rather than the workspace root — so the bundle has
  to sit inside the app to find it.
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { parse3MF } from '../src/geometry/threemfImport.ts';
import { buildClicker } from '../src/geometry/buildClicker.ts';
import { buildFitStrip } from '../src/geometry/fitStrip.ts';
import type { BuildParams, BuildRegion, Ring } from '../src/types.ts';

// Anchored on the repo root rather than on import.meta.url, because the bundle that actually
// runs lives somewhere else by necessity (see above).
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

/** A plain 30 mm square, as one region and as the outline. */
const square: Ring = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const regions: BuildRegion[] = [
  { filamentRgb: [200, 30, 30], coverage: 1, rings: [square], partName: 'top-color-0-0' },
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

/** Signed volume via the divergence theorem, and the XY footprint, per part group. */
function measure(params: BuildParams) {
  const { parts } = buildClicker(wasm, socket, stem, regions, [square], params);
  const acc: Record<string, { vol: number; minX: number; maxX: number }> = {};
  for (const p of parts) {
    const g = acc[p.group] ?? (acc[p.group] = { vol: 0, minX: Infinity, maxX: -Infinity });
    const v = p.vertProperties, t = p.triVerts, n = p.numProp;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
      g.vol += (
        v[a] * (v[b + 1] * v[c + 2] - v[c + 1] * v[b + 2]) -
        v[a + 1] * (v[b] * v[c + 2] - v[c] * v[b + 2]) +
        v[a + 2] * (v[b] * v[c + 1] - v[c] * v[b + 1])
      ) / 6;
    }
    for (let i = 0; i < v.length; i += n) {
      if (v[i] < g.minX) g.minX = v[i];
      if (v[i] > g.maxX) g.maxX = v[i];
    }
  }
  return acc;
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  if (!ok) failures++;
};

const zero = measure(base);

// --- Switch pocket: a bigger cutter takes more out of the body, and touches nothing else.
const pocket = measure({ ...base, socketFitPct: 5 });
check(
  'pocket fit +5% removes material from the base',
  pocket.base.vol < zero.base.vol - 1,
  `${zero.base.vol.toFixed(1)} -> ${pocket.base.vol.toFixed(1)} mm³`,
);
check(
  'pocket fit does not resize the cap',
  Math.abs(pocket.top.vol - zero.top.vol) < 0.01,
  `cap ${zero.top.vol.toFixed(2)} vs ${pocket.top.vol.toFixed(2)} mm³`,
);

// --- Cap stem: a bigger cross socket takes material out of the cap. The clip is the point:
//     the post's outer footprint must not move, or the cap stops fitting its own well.
const looser = measure({ ...base, stemFitPct: 5 });
const tighter = measure({ ...base, stemFitPct: -5 });
check(
  'stem fit +5% opens the cross socket (cap loses material)',
  looser.top.vol < zero.top.vol - 0.01,
  `${zero.top.vol.toFixed(2)} -> ${looser.top.vol.toFixed(2)} mm³`,
);
check(
  'stem fit -5% closes it (cap gains material)',
  tighter.top.vol > zero.top.vol + 0.01,
  `${zero.top.vol.toFixed(2)} -> ${tighter.top.vol.toFixed(2)} mm³`,
);
check(
  'stem fit leaves the cap footprint alone (this is what the clip buys)',
  Math.abs(looser.top.maxX - zero.top.maxX) < 1e-3 && Math.abs(tighter.top.maxX - zero.top.maxX) < 1e-3,
  `maxX ${zero.top.maxX.toFixed(4)} / ${looser.top.maxX.toFixed(4)} / ${tighter.top.maxX.toFixed(4)}`,
);

// --- Top/base gap: the one control that was always wired correctly, kept honest.
//
// Volume is the wrong probe here and the first draft of this test got it backwards. The
// header of buildClicker sets out why: well = plate + tolerance, body outer = plate +
// tolerance + border. The gap widens the well AND pushes the bezel wall out with it, so the
// body ends up with MORE material, not less. What the control actually promises is that the
// cap gets `tolerance` of room per side, and that shows up as the body footprint growing by
// exactly the change — which is the thing a user measures with callipers.
const gap = measure({ ...base, tolerance: 0.8 });
const grew = gap.base.maxX - zero.base.maxX;
check(
  'top/base gap +0.4 mm moves the body wall out by 0.4 mm',
  Math.abs(grew - 0.4) < 0.02,
  `body maxX ${zero.base.maxX.toFixed(3)} -> ${gap.base.maxX.toFixed(3)} (+${grew.toFixed(3)} mm)`,
);
check(
  'top/base gap leaves the cap alone',
  Math.abs(gap.top.vol - zero.top.vol) < 0.01,
  `cap ${zero.top.vol.toFixed(2)} vs ${gap.top.vol.toFixed(2)} mm³`,
);

// --- The bulge warnings. A cap narrower than the switch's clear column gets a rounded lobe
//     welded onto it that is nowhere in the artwork — reported on the listing as "it adds this
//     oval, even with the keychain toggle off". The keychain is off in `base`, which is the
//     point: the warning has to fire anyway, because the loop was never the cause.
//     The trigger is a switch pushed toward an edge, which is what the people who reported it
//     were doing: "it adds some extra material for the switch — is there any way to move the
//     switch box". Shrinking the cap does NOT trigger it, and a concave design does not either,
//     because the plate closes concavities before the column is unioned in. Worth knowing before
//     someone tries to reproduce it the obvious way and concludes the warning is broken.
const offCentre = buildClicker(wasm, socket, stem, regions, [square], {
  ...base,
  switches: [{ x: 12, y: 12, rotation: 0 }],
});
const big = buildClicker(wasm, socket, stem, regions, [square], base);
check(
  'a switch near the edge warns about the widened base',
  offCentre.warnings.some((w) => w.includes('base was widened')),
  offCentre.warnings.length ? offCentre.warnings.join(' | ') : '(no warnings)',
);
check(
  'a cap with room does not cry wolf',
  !big.warnings.some((w) => w.includes('widened')),
  big.warnings.length ? big.warnings.join(' | ') : '(no warnings, as expected)',
);


// --- The printable fit test. Its whole job is to answer "what number do I type", so the tiles
//     have to differ from one another: five identical tiles would be a confident-looking lie.
const strip = buildFitStrip(wasm, stem, {
  labels: [-4, -2, 0, 2, 4].map((pct) => ({ pct, rings: [] })),
  colorRgb: [240, 240, 240],
});
const tileVols = strip.parts.map((p) => {
  const v = p.vertProperties, t = p.triVerts, n = p.numProp;
  let vol = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    vol += (
      v[a] * (v[b + 1] * v[c + 2] - v[c + 1] * v[b + 2]) -
      v[a + 1] * (v[b] * v[c + 2] - v[c] * v[b + 2]) +
      v[a + 2] * (v[b] * v[c + 1] - v[c] * v[b + 1])
    ) / 6;
  }
  return vol;
});
check(
  'the fit strip has one tile per setting',
  strip.parts.length === 5,
  strip.parts.length + ' tiles: ' + strip.parts.map((p) => p.name).join(', '),
);
check(
  'each tile really is a different size, in order',
  tileVols.every((v, i) => i === 0 || v < tileVols[i - 1]),
  tileVols.map((v) => v.toFixed(1)).join(' > '),
);
check(
  'tiles print in the cap group, so the plate flips them like a cap',
  strip.parts.every((p) => p.group === 'top'),
  strip.parts.map((p) => p.group).join(','),
);

console.log(failures ? `\n${failures} FAILED` : '\nall fit controls move the geometry they name');
process.exit(failures ? 1 : 0);
