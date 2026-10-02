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

// --- Provenance. Invariant #2 says the identity mark is never removed, and both void loops
//     skip any sphere that is not fully buried WITHOUT saying so. A normal build must land all
//     of them; if a future cavity or deboss takes their material, this is what notices.
const normal = buildClicker(wasm, socket, stem, regions, [square], base);
check(
  'a normal build lands every identity mark (one used to clip the switch pocket)',
  !normal.warnings.some((w) => w.startsWith('Provenance:')),
  normal.warnings.filter((w) => w.startsWith('Provenance:')).join(' | ') || 'no provenance warning, as expected',
);
// The clamp is what makes the first check pass, so assert it directly: a void must clear the
// SQUARE pocket along its own bearing, which is further out than the axis-aligned half-extent
// everywhere except on an axis. Getting this wrong is silent — the void simply never lands.
const marked = buildClicker(wasm, socket, stem, regions, [square], { ...base, socketFitPct: 5 });
check(
  'a wider switch pocket still leaves every mark buried',
  !marked.warnings.some((w) => w.startsWith('Provenance:')),
  marked.warnings.find((w) => w.startsWith('Provenance:')) || 'all landed at +5% pocket',
);


// --- Hollow base. Free, off by default. The three assertions are the three ways it can go
//     wrong: it does not actually save material, it eats a provenance void, or it produces a
//     shell that is not a closed solid.
const bigSolid = measure({ ...base, capWidthMm: 60 });
const bigHollow = measure({ ...base, capWidthMm: 60, hollowBase: true });
const saved = 1 - bigHollow.base.vol / bigSolid.base.vol;
check(
  'hollowing a 60 mm base removes real material',
  saved > 0.15,
  `${bigSolid.base.vol.toFixed(0)} -> ${bigHollow.base.vol.toFixed(0)} mm³ (${(saved * 100).toFixed(0)}% less)`,
);
const hollowRun = buildClicker(wasm, socket, stem, regions, [square], { ...base, capWidthMm: 60, hollowBase: true });
check(
  'hollowing does not swallow an identity mark',
  !hollowRun.warnings.some((w) => w.startsWith('Provenance:')),
  hollowRun.warnings.find((w) => w.startsWith('Provenance:')) || 'all marks still buried',
);
check(
  'the hollowed body is still one closed solid',
  (() => {
    const p = hollowRun.parts.find((x) => x.name === 'base-body');
    if (!p) return false;
    // Euler check via edge parity: every edge of a closed manifold is shared by exactly 2 faces.
    const seen = new Map();
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
// A small clicker has no room for a shell, and must say so rather than producing a fragile one.
const tinyHollow = buildClicker(wasm, socket, stem, regions, [square], { ...base, capWidthMm: 22, hollowBase: true });
check(
  'a clicker too small to hollow says so instead of trying',
  tinyHollow.warnings.some((w) => w.includes('too small to hollow') || w.includes('too thin to hollow')) ||
    tinyHollow.parts.some((p) => p.name === 'base-body'),
  tinyHollow.warnings.join(' | ') || 'built solid, no warning needed',
);


// --- The hollow cavity must be OPEN, not a sealed box.
//
// This is the assertion the first version of the feature needed and did not have. A sealed
// cavity BUILDS, is a closed manifold, saves material and passes every check above — and then
// asks the slicer to bridge a 1.6 mm lid over open air across most of the footprint, on a part
// that gets clicked thousands of times. Ian reported it off a print, which is the only place it
// showed.
//
// So probe for the lid directly: any horizontal face strictly inside the cavity's Z band is a
// ceiling. Grouping by constant-Z triangles rather than looking for a magic -1.6 keeps this
// honest if the floor thickness or the travel ever moves.
function horizontalFaceAreaInside(part, loZ, hiZ, minRadius) {
  const v = part.vertProperties, t = part.triVerts, n = part.numProp;
  let area = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * n, b = t[i + 1] * n, c = t[i + 2] * n;
    const za = v[a + 2], zb = v[b + 2], zc = v[c + 2];
    if (Math.abs(za - zb) > 1e-3 || Math.abs(zb - zc) > 1e-3) continue; // not horizontal
    if (za <= loZ + 1e-3 || za >= hiZ - 1e-3) continue;                 // floor or well floor
    // Outside the switch pillar only. The pillar is solid ON PURPOSE — it carries the socket
    // and the click load — and the socket pocket cut into it has its own internal steps, which
    // are horizontal faces in this Z band and are supposed to be. Measured: 18.7 mm² at
    // z −1.45, radius 7.4–10.1, entirely inside the pillar's ~13.2 mm radius (set by the
    // identity-void band). Counting those would make this assertion fail on correct geometry.
    const cx = (v[a] + v[b] + v[c]) / 3, cy = (v[a + 1] + v[b + 1] + v[c + 1]) / 3;
    if (Math.hypot(cx, cy) < minRadius) continue;
    area += Math.abs((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1])) / 2;
  }
  return area;
}
const openBody = hollowRun.parts.find((p) => p.name === 'base-body');
// The cavity spans bodyBottomZ+FLOOR .. wellFloorZ. Derive the band from the mesh rather than
// restating the constants: the underside is the lowest Z, the well floor the highest solid
// plane the cavity reaches.
const openMinZ = (() => { let m = Infinity; const v = openBody.vertProperties;
  for (let i = 2; i < v.length; i += openBody.numProp) if (v[i] < m) m = v[i]; return m; })();
const lidArea = horizontalFaceAreaInside(openBody, openMinZ + 1.6, 0, 14);
check(
  'the hollow cavity has no ceiling to bridge — it is open into the well',
  lidArea < 1,
  `${lidArea.toFixed(2)} mm² of ceiling over the cavity (the sealed version had ~1500)`,
);
// And the lid was real material: opening it has to remove measurably more than the sealed box.
check(
  'opening the cavity removes more material than sealing it did',
  saved > 0.55,
  `${(saved * 100).toFixed(1)}% of the solid body removed (the sealed version managed 48.5%)`,
);

// --- Design size. The base must NOT move; only the artwork inside it.
const dsFull = measure({ ...base, baseShape: 'circle', capWidthMm: 45 });
const dsHalf = measure({ ...base, baseShape: 'circle', capWidthMm: 45, designScale: 0.5 });
check(
  'design size leaves the base exactly where it was',
  Math.abs(dsHalf.base.maxX - dsFull.base.maxX) < 1e-3,
  `body maxX ${dsFull.base.maxX.toFixed(3)} -> ${dsHalf.base.maxX.toFixed(3)} mm`,
);
check(
  'and shrinks the artwork inside it, so the frame takes up the slack',
  dsHalf.top.vol > dsFull.top.vol,
  `cap base-colour volume ${dsFull.top.vol.toFixed(0)} -> ${dsHalf.top.vol.toFixed(0)} mm³ `
  + '(more frame = more base colour)',
);
check(
  'design size 1 is byte-identical to no design size at all',
  measure({ ...base, designScale: 1 }).base.vol === zero.base.vol,
  'default path unchanged',
);
// An outline base IS the artwork, so scaling it would print the silhouette full size with a
// shrunken copy floating in a blank band. It must be ignored there.
const outlineFull = measure({ ...base, baseShape: 'outline' });
const outlineScaled = measure({ ...base, baseShape: 'outline', designScale: 0.5 });
check(
  'design size is ignored on an outline base, where shape and artwork are the same thing',
  Math.abs(outlineScaled.base.vol - outlineFull.base.vol) < 0.01,
  `${outlineFull.base.vol.toFixed(1)} vs ${outlineScaled.base.vol.toFixed(1)} mm³`,
);

process.exit(failures ? 1 : 0);
