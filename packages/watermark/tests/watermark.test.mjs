// @vostok/watermark held to the numbers it has always produced.
//
// The constellations below were taken from the apps' own copies of this code before it moved
// here, so a change to the hash, the generator or the order of the draws fails this test
// rather than silently giving every new file a different fingerprint.
//
// Run: node packages/watermark/tests/watermark.test.mjs   (esbuild bundles the TS source,
// once plain and once with a build seed defined). Part of `pnpm test`, so CI runs it.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url)).split('\\').join('/');
const tmp = `${here}.cache`;
mkdirSync(tmp, { recursive: true });

async function load(name, define = {}) {
  const outfile = `${tmp}/${name}-${process.pid}.mjs`;
  await build({ entryPoints: [`${here}../src/index.ts`], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'error', define });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}
const W = await load('plain');
const seeded = await load('seeded', { 'import.meta.env': JSON.stringify({ VITE_MARK_SEED: 'test-build-seed' }) });

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- The build seed --------------------------------------------------------------------------
check('no build seed reads as empty, so the seeded tier is off', W.markSeed() === '', JSON.stringify(W.markSeed()));
check('a defined import.meta.env reaches markSeed()', seeded.markSeed() === 'test-build-seed', JSON.stringify(seeded.markSeed()));

// --- The generator ---------------------------------------------------------------------------
const draws = (seed, n) => {
  const rng = W.prng(seed);
  return Array.from({ length: n }, () => rng());
};
const FROZEN_DRAWS = {
  'vostok-labs-pen-topper-2026': [0.6996573098003864, 0.8117003263905644, 0.3084416633937508, 0.20557987643405795, 0.18884751154109836, 0.44781856052577496],
  'vostok-labs-keychain-carabiner-2026': [0.02556803496554494, 0.31256018159911036, 0.33826223108917475, 0.5041511273011565, 0.9972711226437241, 0.3338264503981918],
  '': [0.961405191803351, 0.056985866045579314, 0.5611667260527611, 0.07893468905240297, 0.10128747974522412, 0.19294091244228184],
};
for (const [seed, want] of Object.entries(FROZEN_DRAWS)) {
  check(`prng(${JSON.stringify(seed)}) draws the numbers it always has`, same(draws(seed, want.length), want));
}
check('every draw is in [0, 1)', draws('range', 5000).every((x) => x >= 0 && x < 1));

// --- Polar constellations, frozen ------------------------------------------------------------
// The clicker's always-on tier: fixed bands round switch #0's socket.
const clickerSpec = { count: 4, minGapDeg: 30, r: [8.0, 2.0], z: [-3.5, 2.0], d: [1.0, 0.4] };
const CLICKER = [
  { r: 8.236581788398325, thetaDeg: 201.87951964326203, z: -1.6320966929197311, d: 1.3059989672154189 },
  { r: 9.961954904720187, thetaDeg: 63.10343421064317, z: -2.1517972140572965, d: 1.3995365822687744 },
  { r: 9.193212089128792, thetaDeg: 248.72193454764783, z: -1.9942049677483737, d: 1.3675723494030536 },
  { r: 9.43426554929465, thetaDeg: 6.95471802726388, z: -3.3862115587107837, d: 1.0296355014666916 },
];
check('the clicker\'s always-on constellation is unchanged', same(W.polarVoids('vostok-labs-clicker-generator-2026', clickerSpec), CLICKER));

// The magnet's always-on tier at 70 mm: bands that scale with the size.
const size = 70;
const magnetSpec = { count: 4, minGapDeg: 30, r: [Math.max(6, size * 0.42), Math.max(4, Math.min(12, size * 0.2))], z: [1.7, 1.2], d: [1.0, 0.4] };
const MAGNET = [
  { r: 39.16618478447199, thetaDeg: 139.06259816139936, z: 2.538879071827978, d: 1.235391799081117 },
  { r: 30.136121859401463, thetaDeg: 255.5637787654996, z: 2.0899137831293046, d: 1.381601061951369 },
  { r: 33.431273561529814, thetaDeg: 350.9913481492549, z: 2.564055700507015, d: 1.033557418361306 },
  { r: 34.26410053633153, thetaDeg: 68.53395947255194, z: 2.882793034054339, d: 1.309905694704503 },
];
check('the magnet\'s always-on constellation at 70 mm is unchanged', same(W.polarVoids('vostok-labs-magnet-generator-2026', magnetSpec), MAGNET));

// A seeded tier's spec at 35 mm, with a test seed: five voids, 25° apart.
const small = 35;
const seededSpec = { count: 5, minGapDeg: 25, r: [Math.max(6, small * 0.32), Math.max(4, Math.min(14, small * 0.24))], z: [0.4, 1.2], d: [1.2, 0.4] };
const SEEDED = [
  { r: 17.331469354406, thetaDeg: 151.85822487808764, z: 0.8753573126159608, d: 1.4461280502378941 },
  { r: 11.857996532693507, thetaDeg: 269.75522596389055, z: 1.2699698249809444, d: 1.5595114856027066 },
  { r: 16.64202143130824, thetaDeg: 316.8422750942409, z: 1.3224091184325517, d: 1.4329105864278973 },
  { r: 14.376532455720008, thetaDeg: 32.00436984188855, z: 1.1530703322030604, d: 1.549759193882346 },
  { r: 13.805437614209952, thetaDeg: 106.35455899871886, z: 0.7791522542946041, d: 1.2951367334462702 },
];
check('a seeded constellation at 35 mm is unchanged', same(W.polarVoids('golden-build-seed', seededSpec), SEEDED));

// --- Polar constellations, the rules ---------------------------------------------------------
check('an empty seed places nothing', W.polarVoids('', seededSpec).length === 0);
check('the same seed and spec give the same voids', same(W.polarVoids('again', seededSpec), W.polarVoids('again', seededSpec)));

// With no gap to keep, nothing is rejected, so void i is draws 4i..4i+3 in the order theta, r,
// z, d. A reordered draw would still look random; only this sees it.
{
  const unit = { count: 3, minGapDeg: 0, r: [0, 1], z: [0, 1], d: [0, 1] };
  const got = W.polarVoids('order', unit);
  const raw = draws('order', 12);
  const want = [0, 1, 2].map((i) => ({ r: raw[4 * i + 1], thetaDeg: raw[4 * i] * 360, z: raw[4 * i + 2], d: raw[4 * i + 3] }));
  check('draws go theta, r, z, d, void after void', same(got, want));
}

{
  let gapOk = true;
  let bandOk = true;
  let countOk = true;
  for (let k = 0; k < 200; k++) {
    const voids = W.polarVoids(`seed-${k}`, seededSpec);
    if (voids.length !== seededSpec.count) countOk = false;
    for (const v of voids) {
      for (const f of ['r', 'z', 'd']) {
        const [base, span] = seededSpec[f];
        if (!(v[f] >= base && v[f] < base + span)) bandOk = false;
      }
    }
    for (let i = 0; i < voids.length; i++) {
      for (let j = i + 1; j < voids.length; j++) {
        const g = Math.abs((((voids[i].thetaDeg - voids[j].thetaDeg) % 360) + 360) % 360);
        if (Math.min(g, 360 - g) < seededSpec.minGapDeg) gapOk = false;
      }
    }
  }
  check('200 seeds: every constellation has its full count', countOk);
  check('200 seeds: every r, z and d is inside its band', bandOk);
  check('200 seeds: no two voids closer than the minimum angle', gapOk);
}

// More voids than the circle can space: it stops after 1000 draws with what fits.
{
  const crowded = W.polarVoids('crowded', { count: 20, minGapDeg: 30, r: [1, 1], z: [0, 1], d: [1, 0] });
  check('an impossible count returns what fits instead of looping', crowded.length > 0 && crowded.length <= 12, `${crowded.length} voids`);
}

console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} watermark checks pass`);
process.exit(fails.length ? 1 : 0);
