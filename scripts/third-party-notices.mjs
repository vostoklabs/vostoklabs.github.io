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

  What an app carries is read from its source (scripts/lib/bundle.mjs), not from its
  dependency list: a set is named when the app's imports reach a file the asset
  registry (assets.json) claims for it, and a library when the app depends on it
  itself or a file its imports reach imports it. A library a shared package depends on
  for a part the app never imports is not in its bundle, and is not named.
*/

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reach } from './lib/bundle.mjs';
import { privateApps, privateFiles } from './lib/source.mjs';
import { readRegistry, rowsClaiming } from './lib/assets.mjs';
import { appTitle, generatorApps } from './licenses.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = process.argv.includes('--check');
const ROWS = readRegistry();

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
  alphabet, and Noto Sans SC pinned to its Black weight. Roboto, Noto Sans, Noto
  Serif, Noto Sans Mono and Libertinus Sans were cut by Vostok Labs to their
  Latin, Greek and Cyrillic characters at their Regular weight. Those changes are
  ours, and every file stays under its original licence.

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
function fontCopyrights({ library = true, weights = [] } = {}) {
  const dir = joinPath(ROOT, 'packages', 'fonts', 'src', 'fonts');
  const out = [];
  // The library's faces, and the other weights (fonts/weights/) the app carries, by file name.
  const base = (f) => f.replace(/^weights\//, '');
  const files = [
    ...(library ? readdirSync(dir).filter((x) => x.endsWith('.ttf')) : []),
    ...weights.map((id) => `weights/${id}.ttf`),
  ].sort((a, b) => (base(a) < base(b) ? -1 : base(a) > base(b) ? 1 : 0));
  for (const f of files) {
    let best = nameRecord(readFileSync(joinPath(dir, f)), 0); // name ID 0 = copyright
    if (best === null) continue;
    // A face whose file holds no copyright notice has its family's, recorded in the asset
    // registry from the family's OFL.txt.
    if (!best.trim()) best = ROWS.find((r) => `packages/fonts/src/fonts/${f}` in r.files)?.copyright ?? '';
    if (best.trim()) out.push(`  ${base(f).replace('.ttf', '')}: ${best.replace(/\s+/g, ' ').trim()}`);
  }
  return out;
}

/** The longest string a TTF's name table holds under `id` ('' when it has none), or null when
 *  the file has no name table at all. */
function nameRecord(buf, id) {
  const tables = buf.readUInt16BE(4);
  let off = 12, nameOff = -1;
  for (let i = 0; i < tables; i++) {
    if (buf.toString('ascii', off, off + 4) === 'name') nameOff = buf.readUInt32BE(off + 8);
    off += 16;
  }
  if (nameOff < 0) return null;
  const count = buf.readUInt16BE(nameOff + 2);
  const strOff = nameOff + buf.readUInt16BE(nameOff + 4);
  let best = '';
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const pid = buf.readUInt16BE(rec);
    if (buf.readUInt16BE(rec + 6) !== id) continue;
    const len = buf.readUInt16BE(rec + 8), o = buf.readUInt16BE(rec + 10);
    const rawStr = buf.subarray(strOff + o, strOff + o + len);
    const val = pid === 3 || pid === 0
      ? Buffer.from(rawStr).swap16().toString('utf16le')
      : rawStr.toString('latin1');
    if (val.length > best.length) best = val;
  }
  return best;
}

/** The typeface text, with a paragraph for the other weights an app carries: each is cut the
 *  way its family is, from the same original, and fixed at its own weight, where the text above
 *  says the cut faces are fixed at Regular. Unchanged for an app that carries none. */
function fontLicences(weights) {
  if (!weights.length) return FONT_LICENCES;
  const dir = joinPath(ROOT, 'packages', 'fonts', 'src', 'fonts', 'weights');
  const faces = weights.map((id) => {
    const buf = readFileSync(joinPath(dir, `${id}.ttf`));
    return { name: nameRecord(buf, 4) || id, style: nameRecord(buf, 2) || '' };
  });
  const sentence = faces.length === 1
    ? `${faces[0].name} was cut by Vostok Labs the same way from the same original, fixed at its ${faces[0].style ? `${faces[0].style} ` : 'own '}weight.`
    : `${faces.map((f) => f.name).join(', ')} were cut by Vostok Labs the same way from the same originals, each fixed at its own weight.`;
  const words = sentence.split(' ');
  const lines = [''];
  for (const w of words) {
    const last = lines.length - 1;
    if (lines[last] && `  ${lines[last]} ${w}`.length > 80) lines.push(w);
    else lines[last] = lines[last] ? `${lines[last]} ${w}` : w;
  }
  const paragraph = lines.map((l) => `  ${l}`).join('\n');
  const after = '  ours, and every file stays under its original licence.';
  if (!FONT_LICENCES.includes(after)) throw new Error('FONT_LICENCES changed: place the other weights again');
  return FONT_LICENCES.replace(after, `${after}\n\n${paragraph}`);
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

/** Runtime libraries worth naming: the ones whose code can be in the shipped bundle.
 *
 *  Workspace packages carry no third-party obligation OF THEIR OWN — they are ours — but the
 *  libraries their code imports do, and those are bundled just as thoroughly as a direct one:
 *  Laser Studio ships `pica` (MIT) through `@vostok/laser`, and an omission here is a licence
 *  not honoured, not a cosmetic gap. So this names the app's own dependencies, and every
 *  library a file its imports reach imports (scripts/lib/bundle.mjs), through any number of our
 *  packages. A library one of our packages depends on only for a part the app never imports
 *  cannot be in its bundle, and is not named.
 *
 *  Dependencies, never devDependencies: a bundler's own devDependency (esbuild, typescript) is
 *  not in the output. */
function libsFor(appId, appDir, pkg) {
  const { libs } = reach(appId);
  const own = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@vostok/'));
  const out = [];
  const texts = [];
  const unresolved = [];
  for (const d of [...new Set([...own, ...libs.keys()])].sort()) {
    // The folders whose files import it, so their node_modules can be searched for its licence.
    const info = licenceOf(appDir, d, [...(libs.get(d) ?? [])].map((dir) => join(ROOT, dir)));
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
function fontAppendix(has) {
  const { oflBody, apache } = licenceTexts();
  return `

${'='.repeat(60)}
APPENDIX A — COPYRIGHT NOTICES FOR EACH BUNDLED FACE
${'='.repeat(60)}

${fontCopyrights({ library: has.fonts, weights: has.weights }).join('\n')}


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

/** The drawn symbol sets: Fluent Emoji (High Contrast) and Tabler Icons (filled), both MIT, in
 *  @vostok/symbols and in the kit's older catalog. Every app depends on the kit, so the
 *  dependency cannot say who bundles them; an app carries this section when its imports reach
 *  their data (the asset registry's `symbols` rows), or a copy of it. The licence texts are the
 *  ones the symbols fetch read upstream at its pinned commits. */
const SYMBOLS_DIR = joinPath(ROOT, 'packages', 'symbols', 'data');

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
 *  dependency, so `libsFor` cannot see them. The OFL text is printed here unless the font
 *  appendix already carries it. A page that exports nothing (the hub) does not say what an
 *  export holds. */
function kitSection(number, fontAppendix, exportsFiles) {
  const fontDir = joinPath(KIT_DIR, 'fonts');
  const files = readdirSync(fontDir).filter((f) => f.endsWith('.woff2')).sort();
  if (!files.length) throw new Error('packages/ui-kit/src/fonts holds no .woff2: the kit section needs updating');
  const { notice, body } = oflParts(joinPath(fontDir, 'OFL.txt'));
  const indent = (text) => text.split('\n').map((l) => `  ${l}`.trimEnd()).join('\n');
  return `

${number}. INTERFACE FONT AND ICONS
${'-'.repeat(60)}

${exportsFiles ? `  The typeface and the icons of the app's own controls. Neither is part of a
  file you export.` : `  The typeface and the icons of the site's own controls.`}

  Chakra Petch, Google Fonts' build of its Latin characters
  (${files.join(', ')})
${indent(notice)}
  Licensed under the SIL Open Font License 1.1${fontAppendix ? ' (full text in Appendix B)' : ' (full text below)'}

  Interface icons, drawn from Lucide and from Feather, the set Lucide grew out
  of: Lucide under the ISC licence and Feather under the MIT licence, both in
  full below as Lucide ships them. The GitHub mark is GitHub's own, from its
  Octicons, under the MIT licence below them, and is used under GitHub's logo
  guidelines (https://github.com/logos).
  https://lucide.dev
  https://feathericons.com
  https://github.com/primer/octicons

${indentedLicence('lucide.LICENSE.txt', KIT_DIR)}

${indentedLicence('octicons.LICENSE.txt', KIT_DIR)}
${fontAppendix ? '' : `\n${indent(body)}\n`}`;
}

/** What an app's build can carry, read from its source (scripts/lib/bundle.mjs): the asset
 *  registry's rows its imports reach, whether it reaches the faces of @vostok/fonts, and its
 *  libraries. `withPrivate` reads a published app's gitignored files too, for a comparison only:
 *  a published notices file has to come out the same on a public clone. */
function carriedBy(appId, withPrivate = false) {
  const { files, libs } = reach(appId, { withPrivate });
  const rows = rowsClaiming(files, ROWS);
  const kinds = new Set(ROWS.filter((r) => rows.has(r.id)).map((r) => r.kind));
  return {
    rows,
    libs,
    fonts: [...files].some((f) => /^packages\/fonts\/src\/fonts\/[^/]+\.ttf$/.test(f)),
    // The other weights, outside the library: carried only by an app that imports them.
    weights: [...files].map((f) => /^packages\/fonts\/src\/fonts\/weights\/([^/]+)\.ttf$/.exec(f)?.[1]).filter(Boolean).sort(),
    patterns: kinds.has('patterns'),
    symbols: kinds.has('symbols'),
    kit: kinds.has('ui-icons') || kinds.has('ui-font'),
  };
}

/**
 * The notices of one app. `exportsFiles` is false for a page that makes nothing to download
 * (the hub): its notices speak of a site, and say nothing about what an export holds.
 */
export function noticesText(appId, appName, pkg, appDir, exportsFiles = true) {
  const has = carriedBy(appId);
  const bundlesFonts = has.fonts || has.weights.length > 0;
  const bundlesPatterns = has.patterns;
  const bundlesSymbols = has.symbols;
  const bundlesKit = has.kit;
  // The library's families; an app carrying only other weights names those.
  const fonts = has.fonts ? fontLines() : has.weights;
  const { lines: libs, texts: libTexts } = libsFor(appId, appDir, pkg);
  const patternSection = bundlesPatterns ? patternTilesSection(bundlesFonts ? 3 : 1) : '';
  const symbolNumber = (bundlesFonts ? 2 : 0) + (bundlesPatterns ? 1 : 0) + 1;
  const symbolSection = bundlesSymbols ? symbolArtSection(symbolNumber) : '';
  const fontSections = bundlesFonts
    ? `

1. TYPEFACES  (${fonts.length} families)
${'-'.repeat(60)}

${fontLicences(has.weights)}

${fonts.join(', ')}.


2. SYMBOL / ICON FONT
${'-'.repeat(60)}

${ICON_NOTICE}

`
    : '';
  const facesNumber = symbolNumber + (bundlesSymbols ? 1 : 0);
  const appFaces = appTypefacesSection(appDir, facesNumber);
  const kitNumber = facesNumber + (appFaces ? 1 : 0);
  const kit = bundlesKit ? kitSection(kitNumber, bundlesFonts, exportsFiles) : '';
  const libHeading = `${kitNumber + (kit ? 1 : 0)}. RUNTIME LIBRARIES`;
  const intro = exportsFiles
    ? `This file lists the third-party material bundled into this application, and the
licences it is used under. It ships with every distribution of the app.

Nothing here restricts what you may do with a file you EXPORT from this
generator — see the application's own licence for that.`
    : `This file lists the third-party material bundled into this site, and the
licences it is used under. It ships with every copy of the site.`;
  const libSection = libs.length
    ? `${libHeading}
${'-'.repeat(60)}

  Every third-party library this application is built from, whether it is depended
  on directly or reached through one of the shared Vostok Labs packages. Listed in
  full rather than per build: which of them a given page actually loads depends on
  which features it uses, and an omitted notice is a licence not honoured while a
  spare one costs nobody anything.

${libs.join('\n')}


`
    : '';
  return `THIRD-PARTY NOTICES
${'='.repeat(60)}

${appName}
Copyright (c) ${YEAR} Vostok Labs

${intro}

${fontSections}${patternSection}${symbolSection}${appFaces}${kit}

${libSection}${bundlesFonts ? fontAppendix(has) : ''}${libTexts.length ? `
${'='.repeat(60)}
LIBRARY LICENCES (full text)
${'='.repeat(60)}

${libTexts.join('\n\n\n')}

` : ''}
${'='.repeat(60)}
Questions about any of the above: ${exportsFiles ? "see the project's licence, or get in touch" : 'get in touch'}.
`;
}

/** The title an app's page gives itself: what the hub is called, and what an app without a
 *  description in its package.json is called. */
function pageTitle(appDir) {
  const index = join(appDir, 'index.html');
  const m = existsSync(index) ? readFileSync(index, 'utf8').match(/<title>([^<]*)<\/title>/i) : null;
  return m?.[1].trim() || null;
}

const appsDir = join(ROOT, 'apps');
const stale = [];
let written = 0;
const generators = new Set(generatorApps());
const hidden = privateFiles();

for (const id of readdirSync(appsDir)) {
  if (SKIP.has(id)) continue;
  const pkgPath = join(appsDir, id, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  // Any third-party runtime dependency is something to declare — not just the font
  // package. The clicker bundles Lucide (ISC), which wants its notice carried too. The kit's own
  // font and icons count as well: an app with no third-party dependency still bundles them.
  const thirdParty = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@vostok/'));
  const has = carriedBy(id);
  if (!thirdParty.length && !has.libs.size && !has.rows.size) continue;

  // A published app's gitignored files can reach more than its published ones, and its notices
  // file, which has to be the same on a public clone, cannot name what only they reach.
  if (!privateApps().has(id) && hidden.some((f) => f.startsWith(`apps/${id}/`))) {
    const all = carriedBy(id, true);
    const more = [...[...all.libs.keys()].filter((l) => !has.libs.has(l) && !thirdParty.includes(l)), ...[...all.rows].filter((r) => !has.rows.has(r))];
    if (more.length) console.warn(`  ! apps/${id}: its gitignored files reach ${more.join(', ')}, which its notices cannot name. Declare the library in the app's package.json, or reach the set from a published file.`);
  }

  const publicDir = join(appsDir, id, 'public');
  const out = join(publicDir, 'THIRD-PARTY-NOTICES.txt');
  const exportsFiles = generators.has(id);
  const appDir = join(appsDir, id);
  const name = pkg.description || (exportsFiles ? appTitle(appDir) : pageTitle(appDir)) || id;
  const text = noticesText(id, name, pkg, appDir, exportsFiles);

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
