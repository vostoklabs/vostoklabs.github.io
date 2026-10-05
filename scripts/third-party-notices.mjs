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

/** Never distributed, so there is no copy for a notice to travel with: kit-demo is the component
 *  gallery and the template is what `pnpm new:generator` copies, and the deploy publishes neither.
 *  An app made from the template gets its own file. The hub is not here: it is the site itself,
 *  deployed at its root, and it bundles the kit's font and icons like every app does. */
const SKIP = new Set(['kit-demo', 'generator-template']);

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

/** What the font files themselves declare. Verified 2026-10-04 for all 251 faces against the
 *  directory each family lives in upstream (`ofl/` vs `apache/` in google/fonts, which IS the
 *  licence) and the licence its METADATA.pb names: 236 OFL-1.1, 15 Apache-2.0, plus the symbol
 *  font. Every family whose OFL.txt declares a Reserved Font Name ships as its original file
 *  (packages/fonts/scripts/fetch-fonts.mjs, ORIGINALS), so no modified copy carries one. */
const FONT_LICENCES = `  All bundled typefaces come from Google Fonts and are licensed under either the
  SIL Open Font License 1.1 or the Apache License 2.0. Both permit embedding and
  bundling in commercial software, and the OFL states explicitly that documents
  created with the font are not restricted by it — so anything you export from
  this generator is yours, with no attribution owed for the lettering.

  What the files are. Most are Google Fonts' own Latin builds of each family, as
  its font API serves them. A family whose licence reserves its name ships as the
  family's original file from the google/fonts repository, unmodified, because a
  modified copy may not carry a Reserved Font Name. The Korean, Japanese and
  Chinese faces were cut by Vostok Labs to the common characters of their
  alphabet, and Noto Sans SC pinned to its Black weight; those changes are ours,
  and every file stays under its original licence.

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
  const oflBody = oflParts(joinPath(dir, 'OFL.txt')).body;
  const apache = LF(readFileSync(joinPath(dir, 'LICENSE-APACHE-2.0.txt'), 'utf8')).trim();
  if (!/Apache License/.test(apache)) throw new Error('LICENSE-APACHE-2.0.txt looks wrong');
  return { oflBody, apache };
}

/** An OFL.txt in its two parts: the family's own copyright notice, and the licence from its
 *  divider down. */
function oflParts(file) {
  const ofl = readFileSync(file, 'utf8').split('\r\n').join('\n');
  const at = ofl.indexOf('SIL OPEN FONT LICENSE Version 1.1');
  if (at < 0) throw new Error(`${file}: cannot find the licence body`);
  // Back up to the divider line above the title, so the body starts cleanly.
  const start = ofl.lastIndexOf('\n', at - 2) + 1;
  return { notice: ofl.slice(0, start).split(/\n\s*This Font Software/)[0].trim(), body: ofl.slice(start).trim() };
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
    if (license) return { version: j.version, license, text: licenceFileIn(join(c, '..')) };
  }
  return null;
}

/** The licence file a package ships beside its package.json, as text. MIT, ISC and Apache all
 *  ask for the notice itself to travel, not the name of the licence. */
function licenceFileIn(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').split('\r\n').join('\n').trim() : null;
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

/** Whether an app bundles one of our packages: as its own dependency, or as a dependency of
 *  another of ours that it depends on. */
function dependsOn(pkg, name) {
  const seen = new Set();
  const reaches = (deps) => Object.keys(deps ?? {}).some((d) => {
    if (d === name) return true;
    if (!d.startsWith('@vostok/') || seen.has(d)) return false;
    seen.add(d);
    return reaches(workspacePkg(d)?.dependencies);
  });
  return reaches(pkg.dependencies);
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
  const texts = [];
  const unresolved = [];
  for (const d of deps.sort()) {
    const info = licenceOf(appDir, d, ownerDirs);
    const label = `${d}${info?.version ? ` ${info.version}` : ''}`;
    if (info?.license) out.push(`  ${label} — ${info.license}`);
    else { out.push(`  ${d} — see its package for licence terms`); unresolved.push(d); }
    if (info?.text) texts.push(`--- ${label} ---\n\n${info.text}`);
  }
  // A licence we could not read is a licence nobody has checked, and invariant #6
  // ("no GPL in a shipped bundle") is only worth anything if this file can prove it.
  if (unresolved.length) console.warn(`  ! could not read a licence for: ${unresolved.join(', ')} — run pnpm install`);
  return { lines: out, texts };
}

/** Typefaces an app vendors itself in three.js's typeface format (`src/typefaces/`), each with
 *  the copyright and licence its own file carries: a font's licence asks for its notice in
 *  every copy. */
function appTypefacesSection(appDir, number) {
  const dir = join(appDir, 'src', 'typefaces');
  if (!existsSync(dir)) return '';
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.typeface.json')) files.push(join(d, e.name));
    }
  };
  walk(dir);
  if (!files.length) return '';
  const byLicence = new Map();
  for (const f of files.sort()) {
    const info = JSON.parse(readFileSync(f, 'utf8')).original_font_information ?? {};
    const licence = (info.license_description || info.license_url || 'see the font file').split('\r\n').join('\n').trim();
    const entry = byLicence.get(licence) ?? [];
    entry.push(`  ${info.full_font_name || f.split(/[\\/]/).pop()}: ${(info.copyright || '').trim()}`);
    byLicence.set(licence, entry);
  }
  const blocks = [...byLicence].map(([licence, faces]) => `${faces.join('\n')}\n\n${licence.split('\n').map((l) => `  ${l}`.trimEnd()).join('\n')}`);
  return `

${number}. TYPEFACES BUNDLED WITH THIS APP
${'-'.repeat(60)}

  Converted to three.js's typeface format; the outlines are the fonts' own.

${blocks.join('\n\n')}
`;
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

/** The kit's own symbol set, `packages/ui-kit/src/symbols/catalog.json`: Fluent Emoji (High
 *  Contrast) and Tabler Icons (filled), both MIT, licence texts beside the data.
 *
 *  Every app depends on the kit, so the dependency cannot say who bundles the set; the source
 *  can. An app carries this section when a file under its `src/` names a value the catalog
 *  module exports. The names are read from that module, so an export added there is covered
 *  the day it lands. The walk is the disk, not git: a build that includes a gitignored folder
 *  bundles what that folder imports too, and a spare notice costs nothing. */
const SYMBOLS_DIR = joinPath(ROOT, 'packages', 'ui-kit', 'src', 'symbols');

function usesSymbolCatalog(appDir) {
  const catalog = joinPath(SYMBOLS_DIR, 'catalog.ts');
  if (!existsSync(catalog)) return false;
  const names = [...readFileSync(catalog, 'utf8').matchAll(/^export (?:const|let|function) (\w+)/gm)].map((m) => m[1]);
  if (!names.length) return false;
  const named = new RegExp(`\\b(?:${names.join('|')})\\b`);
  const walk = (dir) => {
    if (!existsSync(dir)) return false;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = joinPath(dir, entry.name);
      if (entry.isDirectory()) { if (walk(path)) return true; continue; }
      if (/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && named.test(readFileSync(path, 'utf8'))) return true;
    }
    return false;
  };
  return walk(joinPath(appDir, 'src'));
}

/** A licence file, indented two spaces like the rest of this file. The Fluent copy is indented
 *  upstream; its common indent comes off first, so the text reads as one block. */
function indentedLicence(name, dir = SYMBOLS_DIR) {
  const file = joinPath(dir, name);
  if (!existsSync(file)) throw new Error(`${file} is missing`);
  const lines = readFileSync(file, 'utf8').split('\r\n').join('\n').replace(/^\n+|\s+$/g, '').split('\n');
  const common = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => `  ${l.slice(common)}`.trimEnd()).join('\n');
}

function symbolArtSection(number) {
  return `

${number}. SYMBOL ARTWORK
${'-'.repeat(60)}

  Monochrome symbols bundled as the symbol library's own set.

  Fluent Emoji, High Contrast style
  Copyright (c) Microsoft Corporation.
  Licensed under the MIT License
  https://github.com/microsoft/fluentui-emoji

  Tabler Icons, filled set
  Copyright (c) 2020-2026 Paweł Kuna
  Licensed under the MIT License
  https://github.com/tabler/tabler-icons

  A symbol you place is traced into the file you export. The MIT licence attaches
  to the software, not to a work made with it, so the file you download is yours
  to use and to sell under this generator's own licence.

${indentedLicence('fluent-emoji.LICENSE.txt')}

${indentedLicence('tabler-icons.LICENSE.txt')}
`;
}

const KIT_DIR = joinPath(ROOT, 'packages', 'ui-kit', 'src');

/** The kit's own interface: the face its stylesheet sets every control in, and its icons
 *  (`icons.ts`). Every app that uses the kit bundles both, and neither comes from an npm
 *  dependency, so the walk in `libsFor` cannot see them. The OFL text is printed here unless the
 *  font appendix already carries it. */
function kitSection(number, fontAppendix) {
  const fontDir = joinPath(KIT_DIR, 'fonts');
  const files = readdirSync(fontDir).filter((f) => f.endsWith('.woff2')).sort();
  if (!files.length) throw new Error('packages/ui-kit/src/fonts holds no .woff2: the kit section needs updating');
  const { notice, body } = oflParts(joinPath(fontDir, 'OFL.txt'));
  const indent = (text) => text.split('\n').map((l) => `  ${l}`.trimEnd()).join('\n');
  return `

${number}. INTERFACE FONT AND ICONS
${'-'.repeat(60)}

  The typeface and the icons of the app's own controls. Neither is part of a
  file you export.

  Chakra Petch, Google Fonts' build of its Latin characters
  (${files.join(', ')})
${indent(notice)}
  Licensed under the SIL Open Font License 1.1${fontAppendix ? ' (full text in Appendix B)' : ' (full text below)'}

  Interface icons, drawn from Lucide and from Feather, the set Lucide grew out
  of: Lucide under the ISC licence and Feather under the MIT licence, both in
  full below as Lucide ships them. The GitHub mark is GitHub's own, from its
  Octicons, under the MIT licence below them.
  https://lucide.dev
  https://feathericons.com
  https://github.com/primer/octicons

${indentedLicence('lucide.LICENSE.txt', KIT_DIR)}

${indentedLicence('octicons.LICENSE.txt', KIT_DIR)}
${fontAppendix ? '' : `\n${indent(body)}\n`}`;
}

export function noticesText(appName, pkg, appDir) {
  const bundlesFonts = !!pkg.dependencies?.['@vostok/fonts'];
  const bundlesPatterns = !!pkg.dependencies?.['@vostok/patterns'];
  const bundlesSymbols = usesSymbolCatalog(appDir);
  const bundlesKit = dependsOn(pkg, '@vostok/ui-kit');
  const fonts = bundlesFonts ? fontLines() : [];
  const { lines: libs, texts: libTexts } = libsFor(appDir, pkg);
  const patternSection = bundlesPatterns ? patternTilesSection(bundlesFonts ? 3 : 1) : '';
  const symbolNumber = (bundlesFonts ? 2 : 0) + (bundlesPatterns ? 1 : 0) + 1;
  const symbolSection = bundlesSymbols ? symbolArtSection(symbolNumber) : '';
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
  const facesNumber = symbolNumber + (bundlesSymbols ? 1 : 0);
  const appFaces = appTypefacesSection(appDir, facesNumber);
  const kitNumber = facesNumber + (appFaces ? 1 : 0);
  const kit = bundlesKit ? kitSection(kitNumber, bundlesFonts) : '';
  const libHeading = `${kitNumber + (kit ? 1 : 0)}. RUNTIME LIBRARIES`;
  return `THIRD-PARTY NOTICES
${'='.repeat(60)}

${appName}
Copyright (c) ${YEAR} Vostok Labs

This file lists the third-party material bundled into this application, and the
licences it is used under. It ships with every distribution of the app.

Nothing here restricts what you may do with a file you EXPORT from this
generator — see the application's own licence for that.

${fontSections}${patternSection}${symbolSection}${appFaces}${kit}

${libHeading}
${'-'.repeat(60)}

  Every third-party library this application is built from, whether it is depended
  on directly or reached through one of the shared Vostok Labs packages. Listed in
  full rather than per build: which of them a given page actually loads depends on
  which features it uses, and an omitted notice is a licence not honoured while a
  spare one costs nobody anything.

${libs.length ? libs.join('\n') : '  (none)'}


${bundlesFonts ? fontAppendix() : ''}${libTexts.length ? `
${'='.repeat(60)}
LIBRARY LICENCES (full text)
${'='.repeat(60)}

${libTexts.join('\n\n\n')}

` : ''}
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
  // package. The clicker bundles Lucide (ISC), which wants its notice carried too. The kit's own
  // font and icons count as well: an app with no third-party dependency still bundles them.
  const thirdParty = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@vostok/'));
  if (!thirdParty.length && !dependsOn(pkg, '@vostok/ui-kit')) continue;

  const publicDir = join(appsDir, id, 'public');
  const out = join(publicDir, 'THIRD-PARTY-NOTICES.txt');
  const text = noticesText(pkg.description || id, pkg, join(appsDir, id));

  if (CHECK) {
    if (!existsSync(out)) { stale.push(`${id}: public/THIRD-PARTY-NOTICES.txt is missing`); continue; }
    // Line endings aside: a Windows checkout turns every LF into CRLF, which is not staleness.
    if (readFileSync(out, 'utf8').split('\r\n').join('\n') !== text) stale.push(`${id}: public/THIRD-PARTY-NOTICES.txt is out of date`);
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
