// Regenerate `public/fonts/CREDITS.md` for every app that bundles pickable fonts, from the
// licence metadata INSIDE the shipped .ttf files — not from a hand-kept list.
//
// Why a script: the clicker's credits were hand-written for 18 fonts and stayed that way after
// ten more were dropped into the folder, and they said "all OFL" when two of the ten are
// Apache-2.0. Nothing noticed for two months. The file that answers "are these fonts cleared
// for commercial use" has to be derived from the files it describes, so it cannot drift from
// them again.
//
// It also FAILS when a font's licence cannot be established as OFL-1.1 or Apache-2.0, because
// those are the two licences the credits promise and the only two this catalogue has cleared.
// A font under anything else (Ubuntu Font Licence, a proprietary EULA, nothing at all) has to
// be looked at by a person before it ships; the build should not quietly vouch for it.
//
//   node scripts/font-credits.mjs          # rewrites apps/*/public/fonts/CREDITS.md
//
// Reads the `name` table (family, copyright, licence, licence URL, trademark) with opentype.js,
// which @vostok/fonts already depends on.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'packages/fonts/package.json'));
const opentype = require('opentype.js');

/* Fonts whose shipped file carries no licence text of its own. Each entry names where the
   licence WAS established, so the next person can re-check rather than trust. */
const KNOWN = {
  // The name table has an empty licence field and a dead vendor URL. Upstream is
  // google/fonts `ofl/arvo/OFL.txt`: "Copyright (c) 2010-2013, Anton Koovit ... with Reserved
  // Font Name 'Arvo'. This Font Software is licensed under the SIL Open Font License, 1.1."
  arvo: 'OFL-1.1',
};

const LICENCE_FILE = {
  'OFL-1.1': 'OFL.txt',
  'Apache-2.0': 'LICENSE-APACHE-2.0.txt',
};

/* The typeface JSONs each app also bundles. They are three.js example fonts, not .ttf files,
   so there is no name table to read; their attribution is stated here and the MgOpen notice is
   read from the app's own `src/typefaces/LICENSE` so it ships verbatim. The clicker is not here:
   it takes its fonts from @vostok/fonts, and its THIRD-PARTY-NOTICES.txt carries its typefaces. */
const APPS = [
  {
    id: 'keycap-generator',
    typefaces: [
      { shownAs: 'Helvetiker, Optimer, Gentilis (regular and bold)', file: 'helvetiker_*, optimer_*, gentilis_*',
        origin: 'three.js example fonts, derived from the MgOpen family', holder: 'MAGENTA Ltd, 2004',
        licence: 'MgOpen licence (below)' },
      { shownAs: 'Droid Sans, Droid Sans Bold, Droid Sans Mono, Droid Serif, Droid Serif Bold', file: 'droid/*',
        origin: 'three.js example fonts, converted from the Droid family', holder: 'Google Inc., 2008',
        licence: 'Apache-2.0 (`LICENSE-APACHE-2.0.txt`)' },
    ],
  },
];

const name = (font, key) => {
  const v = font.names[key];
  return (v?.en ?? Object.values(v ?? {})[0] ?? '').replace(/\s+/g, ' ').trim();
};

function licenceOf(slug, font) {
  const lic = name(font, 'license');
  const url = name(font, 'licenseURL');
  if (/SIL Open Font License|\bOFL\b/i.test(lic) || /scripts\.sil\.org\/OFL|openfontlicense\.org/i.test(url)) return 'OFL-1.1';
  if (/Apache License/i.test(lic) || /apache\.org\/licenses/i.test(url)) return 'Apache-2.0';
  if (KNOWN[slug]) return KNOWN[slug];
  return null;
}

/* "Reserved Font Name" is an OFL term: the name may identify the unmodified font (which is all
   a picker does) and may not be used on a modified one. Trademarks are the same idea from the
   other side. Both are listed so the credits say what the file says. */
function reservedName(font) {
  const m = name(font, 'copyright').match(/Reserved Font Names?\s*:?\s*['"“]([^'"”]+)['"”]/i);
  return m ? `Reserved Font Name "${m[1].trim()}"` : '';
}

const specimen = (label) => `https://fonts.google.com/specimen/${label.replace(/ /g, '+')}`;

let failed = false;
for (const app of APPS) {
  const dir = path.join(REPO, 'apps', app.id, 'public', 'fonts');
  if (!existsSync(dir)) continue;
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ttf')).sort()) {
    const slug = f.replace(/\.ttf$/, '');
    const buf = readFileSync(path.join(dir, f));
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const licence = licenceOf(slug, font);
    if (!licence) {
      console.error(`${app.id}: ${f} — licence not established (name table says: "${name(font, 'license').slice(0, 80)}")`);
      failed = true;
      continue;
    }
    if (!existsSync(path.join(dir, LICENCE_FILE[licence]))) {
      console.error(`${app.id}: ${f} is ${licence} but ${LICENCE_FILE[licence]} is not in ${path.relative(REPO, dir)}`);
      failed = true;
    }
    const family = name(font, 'fontFamily').replace(/ (Regular|Medium)$/, '');
    const holder = name(font, 'copyright')
      .replace(/^Copyright\s*(\(c\)|©)?\s*/i, '')
      .replace(/,?\s*with Reserved Font Names?.*$/i, '')
      .replace(/\.\s*(All rights reserved\.?)?\s*(Available under.*)?$/i, '')
      .trim();
    const marks = [reservedName(font), name(font, 'trademark')].filter(Boolean).join('; ');
    rows.push({ family, licence, holder, marks, page: specimen(family) });
  }

  const mgopen = readFileSync(path.join(REPO, 'apps', app.id, 'src', 'typefaces', 'LICENSE'), 'utf8').trim();
  const ofl = rows.filter((r) => r.licence === 'OFL-1.1').length;
  const apache = rows.filter((r) => r.licence === 'Apache-2.0').length;

  const md = `# Bundled fonts

Generated by \`scripts/font-credits.mjs\` from the licence metadata inside each font file.
Do not edit by hand — re-run the script after adding or removing a font.

## Pickable fonts (\`.ttf\`)

The ${rows.length} fonts in this folder are from [Google Fonts](https://fonts.google.com):
${ofl} under the **SIL Open Font License 1.1** ([\`OFL.txt\`](OFL.txt)) and ${apache} under the
**Apache License 2.0** ([\`LICENSE-APACHE-2.0.txt\`](LICENSE-APACHE-2.0.txt)). Both permit
bundling in commercial software and place no restriction on what is made with the fonts, so
text set in them and sold as a print or a model file is the user's to sell. The files ship
unmodified. No font is sold or redistributed on its own: they ship only as part of this
generator, and the generator's licence forbids repackaging them.

Names in the *Reserved name / trademark* column belong to their foundries. They appear here and
in the app's font picker to identify the unmodified font, which the OFL permits; no modified
version is distributed under any of them.

| Font | Licence | Copyright | Reserved name / trademark | Google Fonts page |
| --- | --- | --- | --- | --- |
${rows.map((r) => `| ${r.family} | ${r.licence} | ${r.holder} | ${r.marks || '—'} | ${r.page} |`).join('\n')}

## Built-in typefaces (\`src/typefaces/*.typeface.json\`)

Outline fonts the app draws with three.js. They are not in this folder because they are
bundled into the script, and their attribution is here because the licence requires the
notice to accompany every copy.

| Shown in the app as | Files | Origin | Copyright | Licence |
| --- | --- | --- | --- | --- |
${app.typefaces.map((t) => `| ${t.shownAs} | \`${t.file}\` | ${t.origin} | ${t.holder} | ${t.licence} |`).join('\n')}

### MgOpen licence

\`\`\`
${mgopen}
\`\`\`

## Fonts you import yourself

The app can load a \`.ttf\`, \`.otf\` or three.js \`.json\` font from your computer. Nothing
above applies to those: the licence of a font you bring is between you and its foundry, and
some commercial fonts do not permit their outlines to be turned into models. Check before you
sell.
`;
  writeFileSync(path.join(dir, 'CREDITS.md'), md);
  console.log(`${app.id}: ${rows.length} fonts (${ofl} OFL-1.1, ${apache} Apache-2.0) → ${path.relative(REPO, path.join(dir, 'CREDITS.md'))}`);
}

if (failed) process.exit(1);
