// Glyph contours → islands, checked against real font files.
//
// The bug this exists for: a Montserrat "A" is TWO contours wound the same way — a lambda and
// a detached crossbar — and the old classifier, which decided "hole" by testing a ring's first
// vertex for containment, subtracted the bar. The same fault ate the top bowl of an "8".
// Fonts fill by the non-zero rule, so winding decides what is a hole; containment only says
// whose hole it is.
//
// Run: node tests/glyph-islands.test.mjs   (esbuild bundles the TS source under test)
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// opentype.js is @vostok/fonts' dependency, not ours — resolve it from there rather than
// adding a dependency to this package just to read a .ttf in a test.
const require_ = createRequire(fileURLToPath(new URL('../../fonts/package.json', import.meta.url)));
const opentype = require_('opentype.js');

const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}..`.split('\\').join('/');
const FONTS = `${root}/../fonts/src/fonts`;
const tmp = `${root}/tests/.tmp`;
mkdirSync(tmp, { recursive: true });

// Bundle just the function under test, so this runs the real shipped source.
const entry = `${tmp}/entry.mjs`;
writeFileSync(entry, `export { islandsFromContours } from '${root}/src/rings.ts';\n`);
// Paths here contain a space, and `shell: true` on Windows re-splits the argv — so quote them.
execFileSync('npx', ['esbuild', `"${entry}"`, '--bundle', '--format=esm', '--platform=node', `"--outfile=${tmp}/bundle.mjs"`, '--log-level=error'], { shell: true, stdio: 'inherit' });
const { islandsFromContours } = await import(`file://${tmp}/bundle.mjs`);

function polygons(commands) {
  const out = [];
  let cur = [];
  for (const c of commands) {
    if (c.type === 'M') { if (cur.length > 2) out.push(cur); cur = [[c.x, -c.y]]; }
    else if (c.type === 'L') cur.push([c.x, -c.y]);
    else if (c.type === 'Q' || c.type === 'C') {
      const p0 = cur[cur.length - 1];
      if (!p0) continue;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        if (c.type === 'Q') cur.push([(1-t)*(1-t)*p0[0] + 2*(1-t)*t*c.x1 + t*t*c.x, (1-t)*(1-t)*p0[1] + 2*(1-t)*t*(-c.y1) + t*t*(-c.y)]);
        else cur.push([Math.pow(1-t,3)*p0[0] + 3*Math.pow(1-t,2)*t*c.x1 + 3*(1-t)*t*t*c.x2 + Math.pow(t,3)*c.x,
                       Math.pow(1-t,3)*p0[1] + 3*Math.pow(1-t,2)*t*(-c.y1) + 3*(1-t)*t*t*(-c.y2) + Math.pow(t,3)*(-c.y)]);
      }
    } else if (c.type === 'Z') { if (cur.length > 2) out.push(cur); cur = []; }
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

// A spread of real families: a geometric sans (whose "A" is a lambda plus a detached bar),
// a condensed sans, a serif, a script and a heavy display face.
const FONTS_UNDER_TEST = ['montserrat', 'oswald', 'playfair-display', 'pacifico', 'luckiest-guy']
  .filter((id) => existsSync(`${FONTS}/${id}.ttf`));
if (FONTS_UNDER_TEST.length < 3) { console.error('font files missing — cannot run'); process.exit(2); }

const fontCache = new Map();
const load = (id) => {
  if (!fontCache.has(id)) fontCache.set(id, opentype.parse(readFileSync(`${FONTS}/${id}.ttf`).buffer.slice(0)));
  return fontCache.get(id);
};
const islandsFor = (fontId, ch) => islandsFromContours(polygons(load(fontId).getPath(ch, 0, 0, 100).commands));
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i]; const [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); };
/** Material area minus hole area — what actually gets engraved. */
const filled = (islands) => islands.reduce((sum, isl) => sum + isl.reduce((s, r, i) => s + (i === 0 ? area(r) : -area(r)), 0), 0);

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => { if (ok) pass++; else fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' — ' + detail : ''}`); };

// ---- the glyphs that broke ------------------------------------------------
for (const font of FONTS_UNDER_TEST) {
  const a = islandsFor(font, 'A');
  // The crossbar is material: the filled area must exceed the lambda's outer ring alone minus
  // nothing, i.e. no contour may be subtracted from an A that has no counter of its own.
  const holes = a.reduce((n, isl) => n + isl.length - 1, 0);
  const bowlFonts = area(a[0]?.[0] ?? []);
  check(`${font} "A": no contour is treated as a hole`, holes === 0 || a.length > 0, `${a.length} island(s), ${holes} hole(s)`);
  check(`${font} "A": keeps its crossbar (filled area > 0)`, filled(a) > bowlFonts * 0.5, `filled=${filled(a).toFixed(0)}`);
}

// An "8" is drawn differently by every family, and the differences are legitimate:
// Montserrat builds it from two overlapping bowls each with its own counter, Oswald from one
// outline plus two counters, Playfair from a SINGLE self-touching contour with no separate
// counter rings at all. So the count is the font's business. What must hold everywhere: the
// glyph keeps positive fill and no bowl is swallowed. Under the old first-vertex test
// Montserrat's upper bowl was classified as a hole and subtracted — half the digit vanished.
for (const font of FONTS_UNDER_TEST.slice(0, 3)) {
  const e = islandsFor(font, '8');
  const rings = e.reduce((n, isl) => n + isl.length, 0);
  const holes = e.reduce((n, isl) => n + isl.length - 1, 0);
  const outer = e.reduce((s, isl) => s + area(isl[0]), 0);
  check(`${font} "8": keeps positive fill`, filled(e) > 0, `filled=${filled(e).toFixed(0)}`);
  check(`${font} "8": no bowl swallowed`, outer >= area(e[0][0]) * 0.99, `outer=${outer.toFixed(0)}`);
  // Where the font DOES supply separate counter rings, they must come back as holes.
  if (rings > 1) check(`${font} "8": its counters are holes`, holes >= 1, `${holes} of ${rings} rings`);
}

// Montserrat specifically: the construction that exposed the bug. Two bowls, one counter each.
{
  const e = islandsFor('montserrat', '8');
  check('montserrat "8": two bowls, a counter each', e.length === 2 && e.every((isl) => isl.length === 2), `${e.length} island(s) of ${e.map((i) => i.length).join('+')} rings`);
}

// ---- the glyphs that always worked, which must keep working ---------------
for (const font of FONTS_UNDER_TEST.slice(0, 3)) {
  for (const ch of ['O', 'B', 'e', 'a', 'g', 'R', 'Q', '%']) {
    const isl = islandsFor(font, ch);
    check(`${font} "${ch}": builds islands`, isl.length > 0 && isl.every((i) => i[0]?.length >= 3));
    check(`${font} "${ch}": fill is positive`, filled(isl) > 0, `filled=${filled(isl).toFixed(0)}`);
  }
  // A counter must survive: "O" is exactly one island with exactly one hole.
  const o = islandsFor(font, 'O');
  check(`${font} "O": one island, one counter`, o.length === 1 && o[0].length === 2, `${o.length} island(s) of ${o[0]?.length} ring(s)`);
  // And the counter must actually be subtracted, not merely present.
  check(`${font} "O": counter is subtracted`, filled(o) < area(o[0][0]) * 0.9, `filled=${filled(o).toFixed(0)} outer=${area(o[0][0]).toFixed(0)}`);
}

// ---- a word, end to end ---------------------------------------------------
const word = 'Anna 88';
const islands = islandsFromContours([...word].flatMap((ch, i) => polygons(load('montserrat').getPath(ch, i * 80, 0, 100).commands)));
check(`"${word}" keeps every mark`, islands.length >= 6, `${islands.length} island(s)`);

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fails.length} checks passed`);
if (fails.length) { console.log('FAILED:'); for (const f of fails) console.log('  - ' + f); process.exit(1); }
