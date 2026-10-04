#!/usr/bin/env node
/*
  pnpm check:manifold

  Fails the build when app or package code calls one of manifold-3d's leaking conveniences
  directly, instead of its twin in @vostok/manifold.

  ## Why this exists

  manifold-3d 3.5.1's JS glue leaks WASM memory on three calls, every time, and the WASM heap
  never gives memory back. `new CrossSection(rings)` and `cs.toPolygons()` each lose 16 bytes a
  vertex; `cs.extrude(…)` loses the same again, and a centred extrude drops a whole solid. A
  generator rebuilds on every slider step, so the tab grows until it is reloaded.

  The laser engine was fixed first (commit 3454355) — and the eight 3D generators went on making
  the same calls on every rebuild, because the fix lived in one package and the rule in a commit
  message. `packages/manifold/src/index.ts` explains the leaks and holds the twins; this is what
  keeps the next generator from bringing them back:

    new CrossSection(rings, rule)          csOf(wasm, rings, rule)
    CrossSection.ofPolygons(rings, rule)   csOf(wasm, rings, rule)
    cs.toPolygons()                        ringsOf(cs)
    cs.extrude(h, …)                       extrude(wasm, cs, h, …)
    Manifold.extrude(cs, h, …)             extrude(wasm, cs, h, …)

  `cs.revolve(…)` and `triangulate(…)` leak the same way and have no twin yet, because nothing
  calls them. Add one to @vostok/manifold on the day something needs it.

  ## What it cannot see

  A chain whose middle is never deleted — `a.extrude(h).translate(t)`, `circle(r).translate(p)`
  — leaks just as surely, and so does a boolean handed raw rings (`cs.add(rings)` builds a
  CrossSection through the glue and never frees it). Neither has a spelling a pattern can catch
  reliably. What catches them is measuring: `packages/laser/tests/heap-probe.mjs` counts the
  allocator's bytes in use, to the byte, before and after a rebuild.

  A hard failure, not a ratchet: the count was brought to zero in the commit that added this.

  Run by CI (`.github/workflows/check.yml`) and on its own with `pnpm check:manifold`.
*/

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The same file set check:ui reads — tracked, plus new files not yet committed — narrowed to
   shipped source. `packages/manifold` is where the twins live and the one place the glue is
   called on purpose, as their fallback. */
const tracked = (dir) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', dir], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

const FILES = [...tracked('apps'), ...tracked('packages')].filter(
  (f) => /^(apps|packages)\/[^/]+\/src\//.test(f) && /\.(ts|tsx|js|mjs|cjs|mts)$/.test(f) && !f.endsWith('.d.ts') && !f.startsWith('packages/manifold/'),
);

const RULES = [
  { re: /(?<![\w$])CrossSection\s*\(/g, call: 'CrossSection(rings)', use: 'csOf(wasm, rings, rule)' },
  { re: /CrossSection\s*\.\s*ofPolygons\s*\(/g, call: 'CrossSection.ofPolygons(rings)', use: 'csOf(wasm, rings, rule)' },
  { re: /\.\s*toPolygons\s*\(/g, call: '.toPolygons()', use: 'ringsOf(cs)' },
  { re: /\.\s*extrude\s*\(/g, call: '.extrude(…)', use: 'extrude(wasm, cs, h, …)' },
  { re: /\.\s*revolve\s*\(/g, call: '.revolve(…)', use: 'a twin in @vostok/manifold (none yet)' },
  { re: /\.\s*triangulate\s*\(/g, call: 'triangulate(…)', use: 'a twin in @vostok/manifold (none yet)' },
];

/*
  Comments are prose: this file's own table would otherwise fail it, and so would the clicker's
  notes on its fill rule. They are blanked rather than removed so every reported line number is
  the file's real one. The boundary rules are check:ui's, and the reasons are written there: a
  block comment must open at a boundary (an `image/[star]` attribute is not a comment), and a
  `//` after a colon is a URL.
*/
const blank = (s) => s.replace(/[^\n]/g, ' ');
const stripComments = (src) =>
  src
    .replace(/(^|[\s(,;={])(\/\*[\s\S]*?\*\/)/gm, (_, pre, body) => pre + blank(body))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre, body) => pre + blank(body));

const hits = [];
for (const file of FILES) {
  const src = stripComments(readFileSync(join(ROOT, file), 'utf8'));
  for (const rule of RULES) {
    for (const m of src.matchAll(rule.re)) {
      const line = src.slice(0, m.index).split('\n').length;
      hits.push({ file, line, ...rule });
    }
  }
}

if (hits.length) {
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  console.error('\ncheck:manifold: manifold-3d\'s glue called directly. It leaks WASM memory on every call,');
  console.error('and the heap never gives it back. Use the twin from @vostok/manifold:\n');
  for (const h of hits) console.error(`  ${`${h.file}:${h.line}`.padEnd(64)} ${h.call.padEnd(32)} -> ${h.use}`);
  console.error(`\n${hits.length} call${hits.length === 1 ? '' : 's'}. Why, and what each twin does: packages/manifold/src/index.ts\n`);
  process.exit(1);
}

console.log(`check:manifold: no direct calls to manifold's leaking glue in ${FILES.length} source files.`);
