// The blank pickers' pictures and the scalloped disc, held to what they drew before the picture
// routine became shapesSilhouette and the disc learned to turn.
//
// Run: node tests/blanks.test.mjs   (esbuild bundles the TS source under test)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}..`.split('\\').join('/');
const tmp = `${root}/tests/.tmp`;
mkdirSync(tmp, { recursive: true });

const entry = `${tmp}/blanks-entry.mjs`;
writeFileSync(entry, `export * from '${root}/src/blanks.ts';\n`);
// Paths here contain a space, and `shell: true` on Windows re-splits the argv — so quote them.
execFileSync('npx', ['esbuild', `"${entry}"`, '--bundle', '--format=esm', '--platform=node', `"--outfile=${tmp}/blanks-bundle.mjs"`, '--log-level=error'], { shell: true, stdio: 'inherit' });
const B = await import(`file://${tmp}/blanks-bundle.mjs?t=${Date.now()}`);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL ${msg}`);
  }
};
const exact = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'number' ? (Object.is(x, -0) ? '-0' : Number.isFinite(x) ? x : String(x)) : x));
const sha = (v) => createHash('sha256').update(exact(v)).digest('hex').slice(0, 16);

// Every blank's picker picture and thumbnail, as the inline routine drew them before the lift.
ok(B.BLANKS.length === 66, `${B.BLANKS.length} blanks`);
const silhouettes = sha(B.BLANKS.map((def) => B.blankSilhouette(def)));
const thumbs = sha(B.BLANKS.map((def) => B.blankThumb(def)));
ok(silhouettes === 'fe49438eb7f92a67', `every blank silhouette as before (${silhouettes})`);
ok(thumbs === 'a46fc201fe62de89', `every blank thumbnail as before (${thumbs})`);

// shapesSilhouette on shapes with no blank behind them: the routine written out longhand.
{
  const shapes = [[[[0, 0], [30, 0], [30, 12], [0, 12]], [[5, 3], [5, 9], [11, 9], [11, 3]]], [[[40, -2], [44, -2], [42, 5]]]];
  const longhand = (fit) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const isl of shapes) for (const r of isl) for (const [x, y] of r) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const k = fit / Math.max(maxX - minX, maxY - minY, 1e-6);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const n = (v) => v.toFixed(2);
    return shapes.flat().map((r) => `M ${r.map(([x, y]) => `${n(20 + (x - cx) * k)} ${n(20 - (y - cy) * k)}`).join(' L ')} Z`).join(' ');
  };
  ok(B.shapesSilhouette(shapes) === longhand(34), 'shapesSilhouette draws the longest side 34 units by default');
  ok(B.shapesSilhouette(shapes, 32) === longhand(32), 'and `fit` sets it');
  ok(B.shapesSilhouette([]) === '', 'no shapes, an empty path');
}

// The scalloped disc: unchanged by default, turned by `start`.
{
  const before = sha([B.scallopDiscRing(3), B.scallopDiscRing(2.5, 12), B.scallopDiscRing(4, 20, 6)]);
  ok(before === '2f03c43da1271c92', `the default ring as before (${before})`);
  ok(exact(B.scallopDiscRing(3, 16, 8, 0)) === exact(B.scallopDiscRing(3)), 'start 0 is the default ring, to the bit');
  // Counts with no crest at 12 o'clock of their own (16 has one at the default, so it cannot
  // tell a turned ring from an unturned one).
  const r = 3;
  const highest = (ring) => ring.reduce((a, p) => (p[1] > a[1] ? p : a));
  for (const n of [7, 10, 14]) {
    const crest = r / Math.sin(Math.PI / n) + r;
    const turned = B.scallopDiscRing(r, n, 8, Math.PI / 2);
    const top = highest(turned);
    ok(Math.abs(top[0]) < 1e-9 && Math.abs(top[1] - crest) < 1e-9, `${n} scallops, start π/2: a crest at 12 o'clock (${top[0].toFixed(6)}, ${top[1].toFixed(6)})`);
    const plain = B.scallopDiscRing(r, n);
    const plainTop = highest(plain);
    ok(Math.abs(plainTop[0]) > 1, `${n} scallops at the default: no crest at 12 o'clock (the highest point is at x ${plainTop[0].toFixed(3)})`);
    ok(turned.length === plain.length, `${n} scallops: turning keeps the point count`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
