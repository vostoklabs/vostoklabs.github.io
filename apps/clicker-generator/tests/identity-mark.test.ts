/*
  The clicker's identity mark, frozen.

    pnpm test        (bundled and run with the clicker's other suites; on its own, from the root:)

    node_modules/.bin/esbuild apps/clicker-generator/tests/identity-mark.test.ts --bundle \
      --platform=node --format=esm --outfile=apps/clicker-generator/.identity-mark-test.mjs \
      && node apps/clicker-generator/.identity-mark-test.mjs

  Every clicker carries a constellation of small voids round switch #0's socket (invariant #2).
  @vostok/watermark draws it; what it draws comes from src/geometry/identityMark.ts: the seed
  string of the always-on tier, and the count, spacing and bands of both tiers. The package's
  own test pins how a constellation is drawn, not what the clicker asks for, so a changed seed
  or band passed it and gave every new file a different fingerprint. The voids show in no
  preview and on no print, so nothing else would notice.

  The always-on voids below are the ones every clicker file already carries. The seeded tier
  is pinned through `markVoids` with a test seed, which fixes its bands without the build's own
  seed. A deliberate change to the mark changes these numbers: the failure prints the new ones;
  paste them in the same commit and say in its message why the mark changed.
*/
import { hardcodedVoids, markVoids, type MarkVoid } from '../src/geometry/identityMark.ts';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `\n     now: ${detail}` : ''}`);
};
const same = (a: MarkVoid[], b: MarkVoid[]) => JSON.stringify(a) === JSON.stringify(b);

// The always-on tier: four voids from the seed written in identityMark.ts.
const ALWAYS_ON: MarkVoid[] = [
  { r: 8.236581788398325, thetaDeg: 201.87951964326203, z: -1.6320966929197311, d: 1.3059989672154189 },
  { r: 9.961954904720187, thetaDeg: 63.10343421064317, z: -2.1517972140572965, d: 1.3995365822687744 },
  { r: 9.193212089128792, thetaDeg: 248.72193454764783, z: -1.9942049677483737, d: 1.3675723494030536 },
  { r: 9.43426554929465, thetaDeg: 6.95471802726388, z: -3.3862115587107837, d: 1.0296355014666916 },
];
const always = hardcodedVoids();
check('the always-on voids are the ones every clicker file carries', same(always, ALWAYS_ON), JSON.stringify(always));

// The seeded tier, for a seed of the test's own: five voids in its own, deeper bands.
const TEST_SEED = 'clicker-pin-seed';
const SEEDED: MarkVoid[] = [
  { r: 11.417526190634817, thetaDeg: 322.3186710756272, z: -4.205187741667032, d: 1.2385068939067423 },
  { r: 12.357355747837573, thetaDeg: 217.14146378450096, z: -3.752349025569856, d: 1.4852798803709448 },
  { r: 10.665639459621161, thetaDeg: 131.9335471931845, z: -3.078996265307069, d: 1.5039953589439392 },
  { r: 12.413974777329713, thetaDeg: 352.3150812461972, z: -4.481229073833674, d: 1.360874019470066 },
  { r: 11.900518086273223, thetaDeg: 264.69402621500194, z: -4.136741627007723, d: 1.539672154840082 },
];
const seeded = markVoids(TEST_SEED);
check(`the seeded tier draws these voids for the seed ${JSON.stringify(TEST_SEED)}`, same(seeded, SEEDED), JSON.stringify(seeded));

check('a build with no seed places no seeded voids', markVoids('').length === 0);

console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} identity mark checks pass`);
process.exit(fails.length ? 1 : 0);
