/*
  Writes apps/<id>/public/THIRD-PARTY-NOTICES.txt for every app that bundles one.

    node scripts/third-party-notices.mjs          # write them
    node scripts/third-party-notices.mjs --check  # fail if any is missing or stale
    pnpm gen:notices
    pnpm check:notices

  ── why this exists ──────────────────────────────────────────────────────────────
  Anything whose outlines or code end up in a user's export must carry its licence
  text with the distribution. Font Awesome Free puts its ICONS under CC BY 4.0, which
  attaches to every copy and derivative, so a customer's dieline carried an obligation
  nobody had told them about. The icon font is Material Symbols (Apache-2.0) now — see
  `packages/fonts/scripts/fetch-icons.mjs` — and Apache asks only that the licence
  text travel with the bundle. This is how it travels.

  `public/` and not a build step, because `public/` is what every route already
  copies verbatim: `vite build` puts it in dist/ and deploy.yml publishes dist/.
  One file, every distribution.

  What goes in it: the things whose OUTLINES or CODE end up in what the user
  downloads. That is the bundled typefaces and the symbol font above all — a glyph
  traced into an exported SVG is the plainest case — plus the runtime libraries the
  page ships.
*/

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = process.argv.includes('--check');

/** Not generators: the hub is the site, kit-demo is the component gallery. Neither
 *  bundles a font, and neither produces a file anyone exports. */
const SKIP = new Set(['hub', 'kit-demo', 'generator-template']);

const YEAR = 2026;

// ─────────────────────────────── the font set ───────────────────────────────

/** Every bundled typeface, read from the font package's own generated registry so
 *  this cannot drift from what actually ships. */
function fontLines() {
  const credits = join(ROOT, 'packages', 'fonts', 'src', 'fonts', 'CREDITS.md');
  if (!existsSync(credits)) throw new Error('packages/fonts/src/fonts/CREDITS.md is missing — run `pnpm --filter @vostok/fonts fetch-fonts`');
  const md = readFileSync(credits, 'utf8');
  // The table rows are `| Name | Category | https://… |`.
  const names = [...md.matchAll(/^\| ([^|]+?) \| [^|]+? \| https:\/\/fonts\.google\.com/gm)].map((m) => m[1].trim());
  if (names.length < 100) throw new Error(`only ${names.length} fonts parsed out of CREDITS.md — the table shape changed`);
  return names;
}

/** What the font files themselves declare. Verified 2026-09-18 by reading nameID 13
 *  and 14 out of all 153 TTFs and cross-checking each family against the directory
 *  it lives in upstream (`ofl/` vs `apache/` in google/fonts, which IS the licence):
 *  140 OFL-1.1, 12 Apache-2.0, and the symbol font. Nothing else. */
const FONT_LICENCES = `  All bundled typefaces come from Google Fonts and are licensed under either the
  SIL Open Font License 1.1 or the Apache License 2.0. Both permit embedding and
  bundling in commercial software, and the OFL states explicitly that documents
  created with the font are not restricted by it — so anything you export from
  this generator is yours, with no attribution owed for the lettering.

  SIL Open Font License 1.1   https://openfontlicense.org
  Apache License 2.0          https://www.apache.org/licenses/LICENSE-2.0

  Each typeface remains the copyright of its respective authors. None is sold or
  redistributed on its own; they ship only as part of this generator.`;

const ICON_NOTICE = `  Material Symbols (Rounded), instanced at FILL=1 and subset to the glyphs the
  symbol picker offers.
  Copyright (c) Google LLC
  Licensed under the Apache License, Version 2.0
  https://www.apache.org/licenses/LICENSE-2.0
  https://fonts.google.com/icons

  A symbol you place is traced into the file you export. Apache-2.0 puts no
  attribution requirement on a work made WITH the icons, so the file you download
  is yours to use and to sell under this generator's own licence.`;

/** Every bundled face's own copyright line, read out of the TTF's name table (ID 0).
 *
 *  OFL 2. does not ask for "a licence": it asks that each copy carry "the above
 *  copyright notice and this license". The above copyright notice is the FONT's, not
 *  ours, and it differs per family. The subsetter strips name ID 13 (the licence
 *  description) from every file — all 242 of them — so the binaries no longer
 *  self-describe, which makes this file the only place the obligation can be met. */
function fontCopyrights() {
  const dir = joinPath(ROOT, 'packages', 'fonts', 'src', 'fonts');
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ttf')).sort()) {
    const buf = readFileSync(joinPath(dir, f));
    const tables = buf.readUInt16BE(4);
    let off = 12, nameOff = -1;
    for (let i = 0; i < tables; i++) {
      if (buf.toString('ascii', off, off + 4) === 'name') nameOff = buf.readUInt32BE(off + 8);
      off += 16;
    }
    if (nameOff < 0) continue;
    const count = buf.readUInt16BE(nameOff + 2);
    const strOff = nameOff + buf.readUInt16BE(nameOff + 4);
    let best = '';
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + i * 12;
      const pid = buf.readUInt16BE(rec);
      if (buf.readUInt16BE(rec + 6) !== 0) continue; // name ID 0 = copyright
      const len = buf.readUInt16BE(rec + 8), o = buf.readUInt16BE(rec + 10);
      const rawStr = buf.subarray(strOff + o, strOff + o + len);
      const val = pid === 3 || pid === 0
        ? Buffer.from(rawStr).swap16().toString('utf16le')
        : rawStr.toString('latin1');
      if (val.length > best.length) best = val;
    }
    if (best.trim()) out.push(`  ${f.replace('.ttf', '')}: ${best.replace(/\s+/g, ' ').trim()}`);
  }
  return out;
}

/** The licence texts themselves, so a copy of the app carries them rather than a URL
 *  a reader has to be online to follow. The OFL copy in the fonts package opens with
 *  one font's own copyright line; the licence proper starts at its divider, and the
 *  per-font notices above already carry every copyright. */
function licenceTexts() {
  const dir = joinPath(ROOT, 'packages', 'fonts', 'src', 'fonts');
  const LF = (t) => t.split('\r\n').join('\n');
  const ofl = LF(readFileSync(joinPath(dir, 'OFL.txt'), 'utf8'));
  const at = ofl.indexOf('SIL OPEN FONT LICENSE Version 1.1');
  if (at < 0) throw new Error('OFL.txt: cannot find the licence body');
  // Back up to the divider line above the title, so the body starts cleanly.
  const oflBody = ofl.slice(ofl.lastIndexOf('\n', at - 2) + 1).trim();
  const apache = LF(readFileSync(joinPath(dir, 'LICENSE-APACHE-2.0.txt'), 'utf8')).trim();
  if (!/Apache License/.test(apache)) throw new Error('LICENSE-APACHE-2.0.txt looks wrong');
  return { oflBody, apache };
}

// ─────────────────────────────── runtime libraries ───────────────────────────────

/** Licence for a package, read from its own package.json.
 *
 *  pnpm links a dependency into the APP's node_modules and keeps the real copy in
 *  the store, so the app directory is the only place that reliably resolves the
 *  version this app actually gets. Looking only in the repo root found nothing for
 *  three, lucide and manifold-3d — which are precisely the ones worth naming. */
function licenceOf(appDir, name, extraDirs = []) {
  const candidates = [
    join(appDir, 'node_modules', ...name.split('/'), 'package.json'),
    // A dependency that reaches the app through one of OUR packages is linked into THAT
    // package's node_modules, not the app's — pica sits in packages/laser/node_modules. Without
    // this the licence reads as unresolvable and the notice degrades to "see its package".
    ...extraDirs.map((d) => join(d, 'node_modules', ...name.split('/'), 'package.json')),
    join(ROOT, 'node_modules', ...name.split('/'), 'package.json'),
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const j = JSON.parse(readFileSync(c, 'utf8'));
    const license = typeof j.license === 'string' ? j.license : j.license?.type
      ?? (Array.isArray(j.licenses) ? j.licenses.map((l) => l.type ?? l).join(' OR ') : undefined);
    if (license) return { version: j.version, license };
  }
  return null;
}

/** The dependencies of one of our own workspace packages, read from packages/<x>/package.json.
 *  `@vostok/brand` is `config/`, not `packages/`, so it is looked up both ways. */
function workspacePkg(name) {
  const stem = name.replace(/^@vostok\//, '');
  for (const dir of [join(ROOT, 'packages', stem), join(ROOT, 'config')]) {
    const p = join(dir, 'package.json');
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    if (j.name === name) return j;
  }
  return null;
}

/** Runtime deps worth naming: the ones whose code is in the shipped bundle.
 *
 *  Workspace packages carry no third-party obligation OF THEIR OWN — they are ours — but
 *  their DEPENDENCIES do, and those are bundled just as thoroughly as a direct one. This
 *  walked direct dependencies only until 2026-09-22, and the gap was real: Laser Studio ships
 *  `pica` (MIT) through `@vostok/laser`, `nodeca/pica` is in the built bundle, and this file —
 *  the one that exists to name what is bundled — did not mention it. MIT asks that the notice
 *  travel with the distribution, so an omission here is the licence not being honoured, not a
 *  cosmetic gap. So: follow `@vostok/*` transitively and collect what they bring with them.
 *
 *  Dependencies, never devDependencies: a bundler's own devDependency (esbuild, typescript) is
 *  not in the output. */
function libsFor(appDir, pkg) {
  const collected = new Set();
  const seen = new Set();
  /** Where each workspace package we walked through lives, so its node_modules can be searched
   *  for the licences of what it brought. */
  const ownerDirs = [];
  const visit = (deps) => {
    for (const d of Object.keys(deps ?? {})) {
      if (!d.startsWith('@vostok/')) { collected.add(d); continue; }
      if (seen.has(d)) continue;
      seen.add(d);
      const own = workspacePkg(d);
      if (own) ownerDirs.push(join(ROOT, 'packages', d.replace(/^@vostok\//, '')));
      visit(own?.dependencies);
    }
  };
  visit(pkg.dependencies);
  const deps = [...collected];
  const out = [];
  const unresolved = [];
  for (const d of deps.sort()) {
    const info = licenceOf(appDir, d, ownerDirs);
    if (info?.license) out.push(`  ${d}${info.version ? ` ${info.version}` : ''} — ${info.license}`);
    else { out.push(`  ${d} — see its package for licence terms`); unresolved.push(d); }
  }
  // A licence we could not read is a licence nobody has checked, and invariant #6
  // ("no GPL in a shipped bundle") is only worth anything if this file can prove it.
  if (unresolved.length) console.warn(`  ! could not read a licence for: ${unresolved.join(', ')} — run pnpm install`);
  return out;
}

// ─────────────────────────────── emit ───────────────────────────────

/** Per-font copyrights + the two licence texts in full. */
function fontAppendix() {
  const { oflBody, apache } = licenceTexts();
  return `

${'='.repeat(60)}
APPENDIX A — COPYRIGHT NOTICES FOR EACH BUNDLED FACE
${'='.repeat(60)}

${fontCopyrights().join('\n')}


${'='.repeat(60)}
APPENDIX B — SIL OPEN FONT LICENSE 1.1 (full text)
${'='.repeat(60)}

${oflBody}


${'='.repeat(60)}
APPENDIX C — APACHE LICENSE 2.0 (full text)
${'='.repeat(60)}

${apache}

`;
}

/** The pattern tile library: MIT tiles from Pattern Monster, bundled by any app that depends
 *  on @vostok/patterns (the studio's pattern picker loads them lazily). MIT asks only that its
 *  notice travel with the software — this is where it travels. */
function patternTilesSection(number) {
  const file = joinPath(ROOT, 'packages', 'patterns', 'data', 'pattern-monster.LICENSE.txt');
  if (!existsSync(file)) throw new Error('packages/patterns/data/pattern-monster.LICENSE.txt is missing — run `pnpm --filter @vostok/patterns fetch-monster`');
  const mit = readFileSync(file, 'utf8').split('\r\n').join('\n').trim().split('\n').map((l) => `  ${l}`.trimEnd()).join('\n');
  return `

${number}. PATTERN TILES
${'-'.repeat(60)}

  Pattern tiles from Pattern Monster (https://pattern.monster), bundled as the
  tile library of the pattern picker and loaded only when it is opened.
  Copyright (c) 2020 - 2023 pattern.monster
  Licensed under the MIT License
  https://github.com/catchspider2002/svelte-svg-patterns

  A pattern you fill a design with is traced into the file you export. The MIT
  licence attaches to the software, not to a work made with it, so the file you
  download is yours to use and to sell under this generator's own licence.

${mit}
`;
}

export function noticesText(appName, pkg, appDir) {
  const bundlesFonts = !!pkg.dependencies?.['@vostok/fonts'];
  const bundlesPatterns = !!pkg.dependencies?.['@vostok/patterns'];
  const fonts = bundlesFonts ? fontLines() : [];
  const libs = libsFor(appDir, pkg);
  const patternSection = bundlesPatterns ? patternTilesSection(bundlesFonts ? 3 : 1) : '';
  const fontSections = bundlesFonts
    ? `

1. TYPEFACES  (${fonts.length} families)
${'-'.repeat(60)}

${FONT_LICENCES}

${fonts.join(', ')}.


2. SYMBOL / ICON FONT
${'-'.repeat(60)}

${ICON_NOTICE}

`
    : '';
  const libHeading = `${(bundlesFonts ? 2 : 0) + (bundlesPatterns ? 1 : 0) + 1}. RUNTIME LIBRARIES`;
  return `THIRD-PARTY NOTICES
${'='.repeat(60)}

${appName}
Copyright (c) ${YEAR} Vostok Labs

This file lists the third-party material bundled into this application, and the
licences it is used under. It ships with every distribution of the app.

Nothing here restricts what you may do with a file you EXPORT from this
generator — see the application's own licence for that.

${fontSections}${patternSection}

${libHeading}
${'-'.repeat(60)}

  Every third-party library this application is built from, whether it is depended
  on directly or reached through one of the shared Vostok Labs packages. Listed in
  full rather than per build: which of them a given page actually loads depends on
  which features it uses, and an omitted notice is a licence not honoured while a
  spare one costs nobody anything.

${libs.length ? libs.join('\n') : '  (none)'}


${bundlesFonts ? fontAppendix() : ''}
${'='.repeat(60)}
Questions about any of the above: see the project's licence, or get in touch.
`;
}

const appsDir = join(ROOT, 'apps');
const stale = [];
let written = 0;

for (const id of readdirSync(appsDir)) {
  if (SKIP.has(id)) continue;
  const pkgPath = join(appsDir, id, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  // Any third-party runtime dependency is something to declare — not just the font
  // package. The clicker bundles Lucide (ISC), which wants its notice carried too.
  const thirdParty = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@vostok/'));
  if (!thirdParty.length) continue;

  const publicDir = join(appsDir, id, 'public');
  const out = join(publicDir, 'THIRD-PARTY-NOTICES.txt');
  const text = noticesText(pkg.description || id, pkg, join(appsDir, id));

  if (CHECK) {
    if (!existsSync(out)) { stale.push(`${id}: public/THIRD-PARTY-NOTICES.txt is missing`); continue; }
    if (readFileSync(out, 'utf8') !== text) stale.push(`${id}: public/THIRD-PARTY-NOTICES.txt is out of date`);
    continue;
  }
  if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
  writeFileSync(out, text);
  written++;
  console.log(`  apps/${id}/public/THIRD-PARTY-NOTICES.txt`);
}

if (CHECK) {
  if (stale.length) {
    console.error('Third-party notices are out of date:\n  - ' + stale.join('\n  - '));
    console.error('\nRun `pnpm gen:notices`.');
    process.exit(1);
  }
  console.log('Third-party notices are up to date.');
} else {
  console.log(`\nWrote ${written} notice file(s).`);
}
