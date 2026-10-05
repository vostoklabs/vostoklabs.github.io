#!/usr/bin/env node
/*
  The built-in typefaces of the clicker and the keycap generator: three.js typeface JSON, made
  here from pinned TrueType files.

    node scripts/typefaces.mjs

  Each file is made from one font file, named by repository, commit and path, and checked against
  the sha256 recorded below: a re-run writes the same bytes, or stops. SOURCES.md beside the
  output lists them.

  ── why a script ─────────────────────────────────────────────────────────────────
  The typefaces used to be copies of three's example fonts, and nothing said where those came
  from. Two were under a custom licence, and the Droid files carried a font vendor's
  five-computer EULA in their own licence field, left over from the first build Android
  published. Android's later builds of the same outlines say Apache-2.0; the one tagged
  android-1.6_r1 is used here. A file made from a named source cannot lose its provenance.

  ── the conversion ────────────────────────────────────────────────────────────────
  The outlines are scaled to the format's units, 1000 to 0.72 em (100,000 / (72 × unitsPerEm) per
  font unit, the scale three's own typefaces use, so text sizes and the clicker's line pitch stay
  what they were) and rounded to whole units; only the characters in KEEP are kept. Apache-2.0
  asks that a changed file say so: each file's `conversion` field does.

  ── licences ──────────────────────────────────────────────────────────────────────
  A source is accepted as Apache-2.0 or OFL-1.1 only, as recorded here AND as its own name table
  says. A converted file is a Modified Version, which under the OFL may not carry a Reserved Font
  Name, so an OFL face is converted only when its family's OFL.txt (read at the same commit)
  reserves no name the face goes by. That OFL.txt is also where its copyright comes from when the
  name table has none (Libertinus Sans).
*/

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reservedFontNames, reservedNameIn } from '../packages/fonts/scripts/reserved-names.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opentype = createRequire(path.join(REPO, 'packages', 'fonts', 'package.json'))('opentype.js');
const CACHE = path.join(REPO, 'node_modules', '.cache', 'typefaces');

const GOOGLE_FONTS = 'google/fonts';
const ANDROID = 'aosp-mirror/platform_frameworks_base';
/** The last commit with Roboto's static Apache-2.0 files: the next one moved Roboto to its
 *  variable OFL release. */
const ROBOTO_AT = '7b64519fb0fd8b03b563b32ff55d2362db2c90bf';
/** The pin the font package fetches every other google/fonts face at. */
const FONTS_PIN = '9710da1eacb3be272583c3224dcb70f9da6eadbb';
/** Tag android-1.6_r1. Its data/fonts holds the Droid build whose name tables say Apache-2.0,
 *  beside the folder's Apache NOTICE and MODULE_LICENSE_APACHE2. */
const ANDROID_AT = '8f4b5a561813ee8c22d2b8e73c33299471d4a3f3';
/** How a commit is known, where it has a name. */
const TAGS = { [ANDROID_AT]: 'tag android-1.6_r1' };

/** Where each face comes from. `licenceFile` is read at the same commit, for an OFL face. */
const SOURCES = {
  'roboto-regular': { repo: GOOGLE_FONTS, commit: ROBOTO_AT, file: 'apache/roboto/Roboto-Regular.ttf', licence: 'Apache-2.0',
    sha256: '79e851404657dac2106b3d22ad256d47824a9a5765458edb72c9102a45816d95' },
  'roboto-bold': { repo: GOOGLE_FONTS, commit: ROBOTO_AT, file: 'apache/roboto/Roboto-Bold.ttf', licence: 'Apache-2.0',
    sha256: '7d0b991ee3e0be7af01ad7ea8cd2beea6c00a25e679a0226b6737f079aafff86' },
  'libertinus-sans-regular': { repo: GOOGLE_FONTS, commit: FONTS_PIN, file: 'ofl/libertinussans/LibertinusSans-Regular.ttf', licence: 'OFL-1.1',
    licenceFile: 'ofl/libertinussans/OFL.txt', sha256: '2d261d21add710a08b2ffbd89072d7fd2f29a19582e872da4b8f8f6d622cd78b' },
  'libertinus-sans-bold': { repo: GOOGLE_FONTS, commit: FONTS_PIN, file: 'ofl/libertinussans/LibertinusSans-Bold.ttf', licence: 'OFL-1.1',
    licenceFile: 'ofl/libertinussans/OFL.txt', sha256: '92e1e56b0d949241c400e3bca9a772a5318d3b49de7c5f7ccff0413d1a4cc339' },
  'droid-sans-regular': { repo: ANDROID, commit: ANDROID_AT, file: 'data/fonts/DroidSans.ttf', licence: 'Apache-2.0',
    sha256: '4e2371bc0e4cf6983342e150412f140da79d674c9be0b56458401f581072ecd3' },
  'droid-sans-bold': { repo: ANDROID, commit: ANDROID_AT, file: 'data/fonts/DroidSans-Bold.ttf', licence: 'Apache-2.0',
    sha256: 'b631b677af5aa7316297a8b56a1fe3bb1da706737f8c9785d5a5fc94faae1ea9' },
  'droid-sans-mono-regular': { repo: ANDROID, commit: ANDROID_AT, file: 'data/fonts/DroidSansMono.ttf', licence: 'Apache-2.0',
    sha256: '089bdaac95caeed25a8392a6f0606328d009473119f1c7465b642d5cebe5320c' },
  'droid-serif-regular': { repo: ANDROID, commit: ANDROID_AT, file: 'data/fonts/DroidSerif-Regular.ttf', licence: 'Apache-2.0',
    sha256: '57e4e2f2bc0194e05be42b40826f0c7d2b046047e0e94b8bdddef10bc47470fb' },
  'droid-serif-bold': { repo: ANDROID, commit: ANDROID_AT, file: 'data/fonts/DroidSerif-Bold.ttf', licence: 'Apache-2.0',
    sha256: 'ed3235ab9bf3551d3739a3978ae8bb21493cf37046f3a01f557f9df7ef03219f' },
};

/** What is written where: an app's `src/typefaces/` folder, the file, and its source. */
const OUTPUTS = {
  'clicker-generator': {
    'roboto_regular.typeface.json': 'roboto-regular',
    'roboto_bold.typeface.json': 'roboto-bold',
  },
  'keycap-generator': {
    'roboto_regular.typeface.json': 'roboto-regular',
    'roboto_bold.typeface.json': 'roboto-bold',
    'libertinus_sans_regular.typeface.json': 'libertinus-sans-regular',
    'libertinus_sans_bold.typeface.json': 'libertinus-sans-bold',
    'droid/droid_sans_regular.typeface.json': 'droid-sans-regular',
    'droid/droid_sans_bold.typeface.json': 'droid-sans-bold',
    'droid/droid_sans_mono_regular.typeface.json': 'droid-sans-mono-regular',
    'droid/droid_serif_regular.typeface.json': 'droid-serif-regular',
    'droid/droid_serif_bold.typeface.json': 'droid-serif-bold',
  },
};

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The characters kept, where a face has them. The files are bundled whole, so this is what a
 *  name or a key legend types rather than everything a font has: the letters of the European
 *  languages written in Latin, Greek and Cyrillic; punctuation (with the spaces and zero-width
 *  marks pasted text brings) and currency; arrows, ⌘ ⌥ ⌫ ⏎ and shapes for key legends; and every
 *  other character the faces these replace had, so none is lost. Vietnamese and the rarer
 *  Cyrillic letters are not kept: they would add a third to every file. */
const KEEP = new Set([
  ...range(0x20, 0x7e), ...range(0xa0, 0x17f), // Basic Latin, Latin-1, Latin Extended-A
  0x192, 0x1f0, ...range(0x1fa, 0x1ff), ...range(0x218, 0x21b), // ƒ ǰ Ǻ ǻ Ǽ ǽ Ǿ ǿ, Romanian Ș ș Ț ț
  0x2bc, ...range(0x2c6, 0x2dd), // ʼ and the spacing accents ˆ ˇ ˉ ˘ ˙ ˚ ˛ ˜ ˝
  ...range(0x384, 0x3ce), // Greek
  // Cyrillic: Russian, Ukrainian, Belarusian, Bulgarian, Serbian, Macedonian
  ...range(0x400, 0x45f), 0x490, 0x491,
  ...range(0x1e80, 0x1e85), 0x1ef2, 0x1ef3, // Welsh Ẁ ẁ Ẃ ẃ Ẅ ẅ Ỳ ỳ
  ...range(0x2000, 0x206f), ...range(0x20a0, 0x20cf), // punctuation, currency
  ...range(0x2190, 0x21ff), ...range(0x2300, 0x23ff), ...range(0x25a0, 0x25ff), // arrows, technical, shapes
  // The rest of what the old faces had. The ohm sign is a number: an editor may fold it into
  // Greek omega. Then the BOM and the object and replacement marks.
  ...Array.from('ϑϒϕϖ˳ḀḁḾḿὍⁿ℅ℓ№™℮⅛⅜⅝⅞∂∆∏∑−∙√∞∫≈≠≤≥ﬁﬂﬃﬄ', (ch) => ch.codePointAt(0)),
  0x2126, 0xfeff, 0xfffc, 0xfffd,
]);

/** What the conversion changes, as each file and SOURCES.md say it. */
const CONVERSION = 'the outlines are scaled to 1000 units per 0.72 em and rounded to whole units, and only '
  + 'Latin, Greek, Cyrillic, punctuation and common symbols are kept. The outlines are otherwise the font\'s own.';

/** Every face made here writes all of these: printable ASCII and the Latin-1 letters. */
const REQUIRED = [...range(0x20, 0x7e), ...range(0xc0, 0xff).filter((cp) => cp !== 0xd7 && cp !== 0xf7)];

// ---------------------------------------------------------------- fetching

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rawUrl = (repo, commit, file) => `https://raw.githubusercontent.com/${repo}/${commit}/${file}`;
const pageUrl = (repo, commit, file) => `https://github.com/${repo}/blob/${commit}/${file}`;

/** A file from a repository at a commit, downloaded once into node_modules/.cache. */
async function fetchAt(repo, commit, file) {
  const cached = path.join(CACHE, repo.replace('/', '__'), commit, file.replace(/\//g, '__'));
  if (existsSync(cached)) return readFileSync(cached);
  const r = await fetch(rawUrl(repo, commit, file));
  if (!r.ok) throw new Error(`${repo} ${file}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(path.dirname(cached), { recursive: true });
  writeFileSync(cached, buf);
  return buf;
}

// ---------------------------------------------------------------- converting

const nameOf = (font, key) => {
  const v = font.names[key];
  return (v?.en ?? Object.values(v ?? {})[0] ?? '').trim();
};

/** The name table under the keys three's typefaces have always used for it. */
const NAME_KEYS = {
  copyright: 'copyright', fontFamily: 'font_family_name', fontSubfamily: 'font_sub_family_name',
  uniqueID: 'unique_font_identifier', fullName: 'full_font_name', version: 'version_string',
  postScriptName: 'postscript_name', trademark: 'trademark', manufacturer: 'manufacturer_name',
  designer: 'designer', description: 'description', manufacturerURL: 'vendor_url',
  designerURL: 'designer_url', license: 'license_description', licenseURL: 'license_url',
};

/** The licence a name table declares, or null for any other. */
function declaredLicence(font) {
  const text = `${nameOf(font, 'license')} ${nameOf(font, 'licenseURL')}`;
  if (/Apache License|apache\.org\/licenses/i.test(text)) return 'Apache-2.0';
  if (/SIL Open Font License|openfontlicense\.org|scripts\.sil\.org\/OFL/i.test(text)) return 'OFL-1.1';
  return null;
}

/** One glyph's outline in the format's command string: `m x y`, `l x y`, `q x y cx cy` (end point
 *  first), `b x y c1x c1y c2x c2y`. Font units are y-up, as the format is. A line to where the pen
 *  already is draws nothing and is left out. */
function outlineOf(commands, scale) {
  const r = (v) => Math.round(v * scale);
  let out = '';
  let at = null;
  for (const c of commands) {
    if (c.type === 'Z') continue;
    const x = r(c.x), y = r(c.y);
    if (c.type === 'M') out += `m ${x} ${y} `;
    else if (c.type === 'L') { if (at && at[0] === x && at[1] === y) continue; out += `l ${x} ${y} `; }
    else if (c.type === 'Q') out += `q ${x} ${y} ${r(c.x1)} ${r(c.y1)} `;
    else if (c.type === 'C') out += `b ${x} ${y} ${r(c.x1)} ${r(c.y1)} ${r(c.x2)} ${r(c.y2)} `;
    else throw new Error(`unknown path command ${c.type}`);
    at = [x, y];
  }
  return out;
}

/** The extent of a path's points, control points included (as a TrueType glyph's own box is). */
function extent(commands) {
  const b = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
  for (const c of commands) {
    for (const [x, y] of [[c.x, c.y], [c.x1, c.y1], [c.x2, c.y2]]) {
      if (x === undefined) continue;
      b.xMin = Math.min(b.xMin, x); b.xMax = Math.max(b.xMax, x);
      b.yMin = Math.min(b.yMin, y); b.yMax = Math.max(b.yMax, y);
    }
  }
  return b;
}

function typeface(font, source, copyright) {
  const scale = 100000 / (72 * font.unitsPerEm);
  const r = (v) => Math.round(v * scale);
  const glyphs = {};
  const box = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
  const map = font.tables.cmap.glyphIndexMap;
  for (const cp of Object.keys(map).map(Number).filter((c) => KEEP.has(c) && map[c] > 0).sort((a, b) => a - b)) {
    const glyph = font.glyphs.get(map[cp]);
    const commands = glyph.path.commands;
    const e = extent(commands);
    const drawn = Number.isFinite(e.xMin);
    if (drawn) {
      box.xMin = Math.min(box.xMin, e.xMin); box.xMax = Math.max(box.xMax, e.xMax);
      box.yMin = Math.min(box.yMin, e.yMin); box.yMax = Math.max(box.yMax, e.yMax);
    }
    glyphs[String.fromCodePoint(cp)] = {
      x_min: drawn ? r(e.xMin) : 0,
      x_max: drawn ? r(e.xMax) : 0,
      ha: r(glyph.advanceWidth),
      o: outlineOf(commands, scale),
    };
  }
  const missing = REQUIRED.filter((cp) => !glyphs[String.fromCodePoint(cp)]);
  if (missing.length) throw new Error(`${source.file} lacks ${String.fromCodePoint(...missing)}`);

  const style = nameOf(font, 'fontSubfamily');
  const info = {};
  for (const [key, as] of Object.entries(NAME_KEYS)) info[as] = nameOf(font, key);
  if (!info.copyright) info.copyright = copyright;
  const { hhea, post } = font.tables;
  return {
    glyphs,
    familyName: nameOf(font, 'fontFamily'),
    ascender: r(hhea.ascender),
    descender: r(hhea.descender),
    underlinePosition: r(post.underlinePosition),
    underlineThickness: r(post.underlineThickness),
    boundingBox: { yMin: r(box.yMin), xMin: r(box.xMin), yMax: r(box.yMax), xMax: r(box.xMax) },
    resolution: 1000,
    lineHeight: r(hhea.ascender - hhea.descender + hhea.lineGap),
    cssFontWeight: /bold/i.test(style) ? 'bold' : 'normal',
    cssFontStyle: /italic/i.test(style) ? 'italic' : 'normal',
    original_font_information: info,
    conversion: `Converted by Vostok Labs to three.js typeface JSON from ${path.posix.basename(source.file)} `
      + `(${source.repo} at ${source.commit}, sha256 ${source.sha256}): ${CONVERSION}`,
  };
}

// ---------------------------------------------------------------- the run

/** Every source, fetched, checked and parsed once. */
async function load(id) {
  const source = SOURCES[id];
  const buf = await fetchAt(source.repo, source.commit, source.file);
  const hash = sha256(buf);
  if (hash !== source.sha256) throw new Error(`${source.file}: sha256 is ${hash}, recorded ${source.sha256}`);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const declared = declaredLicence(font);
  if (declared !== source.licence) throw new Error(`${source.file}: recorded ${source.licence}, its name table says ${declared ?? 'neither licence'}`);
  let copyright = '';
  if (source.licence === 'OFL-1.1') {
    const ofl = (await fetchAt(source.repo, source.commit, source.licenceFile)).toString('utf8').split('\r\n').join('\n');
    if (!/SIL OPEN FONT LICENSE Version 1\.1/.test(ofl)) throw new Error(`${source.licenceFile}: not the OFL 1.1`);
    const names = ['fontFamily', 'fullName', 'postScriptName', 'preferredFamily'].map((k) => nameOf(font, k));
    const clash = reservedNameIn(names, reservedFontNames(ofl));
    if (clash) throw new Error(`${source.file}: "${clash}" is a Reserved Font Name, so a converted copy may not use it`);
    copyright = ofl.split(/\n\s*This Font Software/)[0].trim();
  }
  return { source, font, copyright };
}

const loaded = new Map();
for (const id of new Set(Object.values(OUTPUTS).flatMap((files) => Object.values(files)))) loaded.set(id, await load(id));

for (const [app, files] of Object.entries(OUTPUTS)) {
  const dir = path.join(REPO, 'apps', app, 'src', 'typefaces');
  const rows = [];
  for (const [file, id] of Object.entries(files)) {
    const { source, font, copyright } = loaded.get(id);
    const data = typeface(font, source, copyright);
    const text = `${JSON.stringify(data)}\n`;
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
    const info = data.original_font_information;
    const face = `${info.full_font_name} ${info.version_string.replace(/^Version\s*/i, '').split(';')[0].trim()}`;
    const commit = `\`${source.commit.slice(0, 7)}\`${TAGS[source.commit] ? ` (${TAGS[source.commit]})` : ''}`;
    const licence = source.licence === 'OFL-1.1' ? 'OFL-1.1, no Reserved Font Name' : source.licence;
    const link = `[${source.repo} \`${source.file}\`](${pageUrl(source.repo, source.commit, source.file)})`;
    rows.push(`| \`${file}\` | ${face} | ${link} | ${commit} | \`${source.sha256}\` | ${licence} |`);
    console.log(`  apps/${app}/src/typefaces/${file}  ${Object.keys(data.glyphs).length} characters, ${Math.round(Buffer.byteLength(text) / 1000)} KB`);
  }
  writeFileSync(path.join(dir, 'SOURCES.md'), `# Where these typefaces come from

Written by \`scripts/typefaces.mjs\`, which makes each file below from the font file named, at the
commit named, and stops if that file's sha256 has changed. Change the script and run it again
rather than editing these files.

| File | Face | Source | Commit | sha256 of the source | Licence |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

What the conversion changes: ${CONVERSION}

Each file says so in its \`conversion\` field, and carries the font's own name table, with its
copyright and licence, in \`original_font_information\`.
`);
}
