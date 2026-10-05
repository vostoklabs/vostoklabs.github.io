#!/usr/bin/env node
/*
  pnpm gen:assets

  Writes the asset registry: assets.json, and assets.private.json for gitignored files. One row
  for each font, typeface, symbol set, pattern set and model the apps bundle, saying where it
  came from and the licence it ships under (scripts/lib/assets.mjs). `pnpm check:assets` holds
  every such file to a row.

  The faces of @vostok/fonts are recorded by their own fetch
  (packages/fonts/scripts/fetch-fonts.mjs), which reads each family's licence file upstream as
  it fetches; their rows are kept as they are, and a file that no longer matches its row stays a
  failure until that fetch runs. Every other asset is described by a rule below, from what the
  file says about itself and where it was taken from. A copy of a file a row already claims
  needs no row of its own.

  A file no rule describes gets a row with the licence NOASSERTION, which the check refuses:
  give it a rule here, or remove it. A gitignored one is described by hand in
  assets.private.json, with "writtenBy": "hand"; this keeps that row and re-hashes its files.

  Running this is how a new or replaced asset is accepted, so the diff of assets.json is the
  record of it.
*/

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abs, rel } from './lib/source.mjs';
import { assetKind, contradiction, embedded, fileHash, licencesNamedIn, readRegistry, writeRegistry } from './lib/assets.mjs';
import { reservedFontNames } from '../packages/fonts/scripts/reserved-names.mjs';

const SCAN = 'scripts/assets.mjs';

/** The google/fonts commit the faces below were compared at, the one
 *  packages/fonts/scripts/fetch-fonts.mjs pins. */
const PIN = '9710da1eacb3be272583c3224dcb70f9da6eadbb';
const googleFonts = (file, commit = PIN) => `https://github.com/google/fonts/blob/${commit}/${file}`;
/** The commits the symbol sets were fetched at: packages/symbols/scripts/fetch-symbols.mjs pins
 *  the same two. */
const FLUENT_EMOJI = '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc';
const TABLER_ICONS = 'bbed884d15354b5cebf2493371f20dc2d5e83eaf';
/** three.js r171, whose examples/fonts/ the vendored typefaces are byte for byte. */
const THREE = '2898f5b1ba10b1e94174c0a62d072f5f7b80442c';

/** The keycap generator's own faces, each the original file from google/fonts at the pin, byte
 *  for byte: its path there and its sha256. Rajdhani is its Medium weight. A file by the same
 *  name with other bytes is not one of them. */
const KEYCAP_FONTS = {
  'anton.ttf': ['ofl/anton/Anton-Regular.ttf', 'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab'],
  'arvo.ttf': ['ofl/arvo/Arvo-Regular.ttf', 'f41bd41471ec2db7140351bdde614da5341524503598ff7fe79f3c89c13b605e'],
  'audiowide.ttf': ['ofl/audiowide/Audiowide-Regular.ttf', 'c7c0f2b0f6fad8c623e31772ce79f94a4edb9321ffce9fce978ea892d20ae730'],
  'bebas-neue.ttf': ['ofl/bebasneue/BebasNeue-Regular.ttf', '08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73'],
  'bungee.ttf': ['ofl/bungee/Bungee-Regular.ttf', 'c4f5361ce120af3e6b9156d0bf379fa19cda2ea0cd18ac01fd99596c6bf66e3f'],
  'chakra-petch.ttf': ['ofl/chakrapetch/ChakraPetch-Regular.ttf', '98fcd638baa5c81ff0316b7538ce330ee3b23b1302726de3526d5933a8ecf986'],
  'lobster.ttf': ['ofl/lobster/Lobster-Regular.ttf', 'd6568e697fd50cedc0be04d8aae4127fe95add607e7bff954ca88604be80c205'],
  'michroma.ttf': ['ofl/michroma/Michroma-Regular.ttf', 'b62301163788bc5b7f8fcac0b74b184e34e1827e577b499ecb724da065098f87'],
  'orbitron.ttf': ['ofl/orbitron/Orbitron[wght].ttf', 'f42db2dd16e642258e35782916eceb1dcdbea06fb958d77ad71dc5963587e8fd'],
  'oswald.ttf': ['ofl/oswald/Oswald[wght].ttf', '5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817'],
  'pacifico.ttf': ['ofl/pacifico/Pacifico-Regular.ttf', '5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701'],
  'press-start-2p.ttf': ['ofl/pressstart2p/PressStart2P-Regular.ttf', '034c77f1f05ec89421e4a63f0e3a4ca1ecf852cc6d2bf611f126f275728e017d'],
  'rajdhani.ttf': ['ofl/rajdhani/Rajdhani-Medium.ttf', '12ff7dcfe4c206e3875ac53b1762eab57de6a2fa7f5a86c26b97b88d6591eac2'],
  'righteous.ttf': ['ofl/righteous/Righteous-Regular.ttf', '2ffb3fe5c27d7e6571210b800448c4e234e651b46c6b4426c1bb567e5341348a'],
  'russo-one.ttf': ['ofl/russoone/RussoOne-Regular.ttf', 'bc0abcc660bd8b7ad3000ecb2898a27c58a29a50f7ec81652fa12e75148d09df'],
  'share-tech-mono.ttf': ['ofl/sharetechmono/ShareTechMono-Regular.ttf', '9ceab1f87414829af259c0f537573ae03ef7dd3147c0b27a36a1a0beb6732677'],
  'titillium-web.ttf': ['ofl/titilliumweb/TitilliumWeb-Regular.ttf', '7b6b4452c65cc8b8522e92e7d4d4c2e6d7675341ceafd041bb6bd30297517ea5'],
  'vt323.ttf': ['ofl/vt323/VT323-Regular.ttf', 'cf4de751ada78ceac033dbe16a687742939995b77bc2a052ae17a4957958594d'],
};

/** Gentilis, the typeface still as three.js r171 shipped it in examples/fonts/, byte for byte
 *  (its sha256): OFL-1.1, as the licence text it carries says. A file by the same name with other
 *  bytes is not it. */
const THREE_TYPEFACES = {
  'gentilis_bold.typeface.json': 'c028fd9c4017e34f1bf46694e4c23479cd22b812d0308f5dfc7446412c41d88c',
  'gentilis_regular.typeface.json': '7ed95f2faa30f59dbe7cfb145b97c42a6ba1188cd2eec01ca61485e8c83ee9de',
};

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const appOf = (path) => path.split('/').slice(0, 2).join('/');

const sourcesMemo = new Map();
/** A typeface folder's SOURCES.md, which scripts/typefaces.mjs writes beside the files it makes:
 *  each file's source font, by repository, commit, path and sha256, and its licence. */
function sourcesOf(dir) {
  if (!sourcesMemo.has(dir)) {
    const rows = new Map();
    const file = abs(`${dir}/SOURCES.md`);
    const row = /^\| `([^`]+)` \|[^|]*\| \[[^\]]*\]\((https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([0-9a-f]{40})\/([^)\s]+))\) \|[^|]*\| `([0-9a-f]{64})` \| ([^|]+?) \|\s*$/gm;
    if (existsSync(file)) {
      for (const m of readFileSync(file, 'utf8').matchAll(row)) {
        rows.set(m[1], { url: m[2], repo: m[3], commit: m[4], path: m[5], sha256: m[6], licence: m[7].split(',')[0].trim() });
      }
    }
    sourcesMemo.set(dir, rows);
  }
  return sourcesMemo.get(dir);
}

/** What a typeface made by scripts/typefaces.mjs was made from, or null. Its own `conversion`
 *  field and its folder's SOURCES.md have to name the same font file (repository, commit and
 *  sha256), and the licence has to be borne out the way the asset check reads one: a google/fonts
 *  folder is its licence (ofl/, apache/), and the font's own name table, which the file carries,
 *  has to name that licence and nothing against it. */
function convertedFrom(path, buf) {
  const at = path.match(/^(apps\/[^/]+\/src\/typefaces)\/(.+\.typeface\.json)$/);
  if (!at) return null;
  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
  const said = typeof json.conversion === 'string' && json.conversion.match(/ from (\S+) \((\S+) at ([0-9a-f]{40}), sha256 ([0-9a-f]{64})\)/);
  const from = sourcesOf(at[1]).get(at[2]);
  if (!said || !from) return null;
  if (said[1] !== from.path.split('/').pop() || said[2] !== from.repo || said[3] !== from.commit || said[4] !== from.sha256) return null;
  if (from.repo === 'google/fonts' && from.licence !== { ofl: 'OFL-1.1', apache: 'Apache-2.0' }[from.path.split('/')[0]]) return null;
  const own = embedded(path, buf);
  if (contradiction(own.licence, from.licence) || !licencesNamedIn(own.licence).includes(from.licence)) return null;
  return { ...from, own };
}

/**
 * What each known asset is. `match` picks its files by path and sha256 (a copy of one, byte for
 * byte, is claimed with it), `id` names the row, `describe` fills it from the files' paths and
 * the first file's bytes. A file several rules match is in each of their rows.
 */
const RULES = [
  {
    match: (p) => p === 'packages/fonts/src/fonts/icon-fallback.ttf',
    id: () => 'icons/material-symbols-rounded',
    describe: () => ({
      kind: 'icons',
      licence: 'Apache-2.0',
      copyright: 'Google LLC',
      shipsAs: 'cut',
      // Instanced at FILL=1 by the font API and subset by packages/fonts/scripts/fetch-icons.mjs.
      source: { url: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:FILL@1', commit: null },
      licenceUrl: 'https://github.com/google/material-design-icons/blob/master/LICENSE',
      notice: ['packages/fonts/src/fonts/LICENSE-APACHE-2.0.txt'],
    }),
  },
  {
    match: (p) => /^packages\/ui-kit\/src\/fonts\/ChakraPetch-\w+\.woff2$/.test(p),
    id: (paths) => `ui-font/chakra-petch-${paths[0].match(/ChakraPetch-(\w+)\.woff2$/)[1].toLowerCase()}`,
    describe: (paths, buf) => ({
      kind: 'ui-font',
      licence: 'OFL-1.1',
      copyright: one(embedded(paths[0], buf).copyright),
      reservedNames: [],
      shipsAs: 'cut',
      // Google Fonts' own Latin build, as the font API served it.
      source: { url: 'https://fonts.google.com/specimen/Chakra+Petch', commit: null },
      licenceUrl: googleFonts('ofl/chakrapetch/OFL.txt'),
      notice: ['packages/ui-kit/src/fonts/OFL.txt'],
    }),
  },
  {
    match: (p) => p === 'packages/ui-kit/src/icons.ts',
    id: () => 'ui-icons/kit',
    describe: () => ({
      kind: 'ui-icons',
      licence: 'ISC AND MIT',
      copyright: 'Lucide Contributors; Cole Bemis (Feather); GitHub, Inc. (the GitHub mark, from Octicons)',
      shipsAs: 'converted',
      // Paths drawn from Lucide and Feather, and a few drawn here in their style.
      source: { url: 'https://github.com/lucide-icons/lucide', commit: null },
      licenceUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
      notice: ['packages/ui-kit/src/lucide.LICENSE.txt', 'packages/ui-kit/src/octicons.LICENSE.txt'],
    }),
  },
  {
    // The kit catalog's Fluent drawings are the SVG files at this commit, byte for byte, and
    // @vostok/symbols' outlines were made from the same files by its fetch-symbols script.
    match: (p) => p === 'packages/ui-kit/src/symbols/catalog.json' || /^packages\/symbols\/data\/fluent-emoji-high-contrast(?:\.outlines)?\.json$/.test(p),
    id: () => 'symbols/fluent-emoji-high-contrast',
    describe: () => ({
      kind: 'symbols',
      licence: 'MIT',
      copyright: 'Microsoft Corporation',
      shipsAs: 'converted',
      source: { url: 'https://github.com/microsoft/fluentui-emoji', commit: FLUENT_EMOJI },
      licenceUrl: `https://github.com/microsoft/fluentui-emoji/blob/${FLUENT_EMOJI}/LICENSE`,
      notice: ['packages/symbols/data/fluent-emoji.LICENSE.txt'],
    }),
  },
  {
    // The same for Tabler's filled drawings, at the commit of its v3.49.0 release.
    match: (p) => p === 'packages/ui-kit/src/symbols/catalog.json' || /^packages\/symbols\/data\/tabler-icons-filled(?:\.outlines)?\.json$/.test(p),
    id: () => 'symbols/tabler-icons-filled',
    describe: () => ({
      kind: 'symbols',
      licence: 'MIT',
      copyright: 'Paweł Kuna',
      shipsAs: 'converted',
      source: { url: 'https://github.com/tabler/tabler-icons', commit: TABLER_ICONS },
      licenceUrl: `https://github.com/tabler/tabler-icons/blob/${TABLER_ICONS}/LICENSE`,
      notice: ['packages/symbols/data/tabler-icons.LICENSE.txt'],
    }),
  },
  {
    match: (p) => /^packages\/patterns\/data\/pattern-monster(?:-index)?\.json$/.test(p),
    id: () => 'patterns/pattern-monster',
    describe: () => ({
      kind: 'patterns',
      licence: 'MIT',
      copyright: 'pattern.monster',
      shipsAs: 'converted',
      // Fetched from the master branch, whose head this commit was then and still is.
      source: { url: 'https://github.com/catchspider2002/svelte-svg-patterns', commit: '803e30bfde106cf094581aabfc80ced2062c5ab7' },
      licenceUrl: 'https://github.com/catchspider2002/svelte-svg-patterns/blob/803e30bfde106cf094581aabfc80ced2062c5ab7/LICENSE.md',
      notice: ['packages/patterns/data/pattern-monster.LICENSE.txt'],
    }),
  },
  {
    match: (p, hash) => /^apps\/keycap-generator\/public\/fonts\/[^/]+\.ttf$/.test(p) && KEYCAP_FONTS[p.split('/').pop()]?.[1] === hash,
    id: (paths) => `font/keycap-${paths.find((p) => p.startsWith('apps/keycap-generator/')).split('/').pop().replace(/\.ttf$/, '')}`,
    describe: (paths, buf) => {
      const [file] = KEYCAP_FONTS[paths.find((p) => p.startsWith('apps/keycap-generator/')).split('/').pop()];
      const own = embedded(paths[0], buf);
      return {
        kind: 'font',
        licence: 'OFL-1.1',
        copyright: one(own.copyright),
        reservedNames: reservedFontNames(own.licence),
        shipsAs: 'original',
        source: { url: googleFonts(file), commit: PIN },
        licenceUrl: googleFonts(`${file.split('/').slice(0, 2).join('/')}/OFL.txt`),
        notice: ['apps/keycap-generator/public/fonts/OFL.txt'],
      };
    },
  },
  {
    match: (p, hash) => /^apps\/[^/]+\/src\/typefaces\/[^/]+\.typeface\.json$/.test(p) && THREE_TYPEFACES[p.split('/').pop()] === hash,
    id: (paths) => `typeface/${paths[0].split('/').pop().replace(/\.typeface\.json$/, '').replace(/_/g, '-')}`,
    describe: (paths, buf) => {
      const own = embedded(paths[0], buf);
      return {
        kind: 'typeface',
        licence: 'OFL-1.1',
        copyright: one(own.copyright),
        reservedNames: reservedFontNames(own.licence),
        shipsAs: 'converted',
        source: { url: `https://github.com/mrdoob/three.js/blob/${THREE}/examples/fonts/${paths[0].split('/').pop()}`, commit: THREE },
        licenceUrl: 'https://openfontlicense.org',
        notice: [...new Set(paths.map((p) => `${appOf(p)}/src/typefaces/LICENSE`))],
      };
    },
  },
  {
    // A typeface scripts/typefaces.mjs made from a pinned font file (convertedFrom).
    match: (p) => /\.typeface\.json$/.test(p) && !!convertedFrom(p, readFileSync(abs(p))),
    id: (paths) => `typeface/${paths[0].split('/').pop().replace(/\.typeface\.json$/, '').replace(/_/g, '-')}`,
    describe: (paths, buf) => {
      const made = paths.filter((p) => convertedFrom(p, buf));
      const from = convertedFrom(made[0], buf);
      const google = from.repo === 'google/fonts';
      return {
        kind: 'typeface',
        licence: from.licence,
        copyright: one(from.own.copyright),
        reservedNames: from.licence === 'OFL-1.1' ? reservedFontNames(from.own.licence) : [],
        shipsAs: 'converted',
        source: { url: from.url, commit: from.commit },
        licenceUrl: google
          ? `https://github.com/google/fonts/blob/${from.commit}/${from.path.split('/').slice(0, 2).join('/')}/${from.licence === 'OFL-1.1' ? 'OFL.txt' : 'LICENSE.txt'}`
          : `https://github.com/${from.repo}/tree/${from.commit}/${from.path.split('/').slice(0, -1).join('/')}`,
        notice: [...new Set(made.map((p) => `${appOf(p)}/src/typefaces/LICENSE`))],
      };
    },
  },
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-offline', 'dist-mw', 'offline', 'tests', 'test', 'makerlab', 'vendor']);

/** Every asset file the apps can carry, published or not: under each app's src/ and public/ and
 *  each package's src/ and data/. */
export function assetFiles() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (assetKind(rel(p))) out.push(rel(p));
    }
  };
  for (const [group, parts] of [['apps', ['src', 'public']], ['packages', ['src', 'data']]]) {
    const g = abs(group);
    if (!existsSync(g)) continue;
    for (const d of readdirSync(g).sort()) for (const part of parts) walk(join(g, d, part));
  }
  return out.sort();
}

/** Every file a rule describes though its name does not make it an asset (the kit's icons). */
const RULE_FILES = ['packages/ui-kit/src/icons.ts'];

/** Writes the registry from the files on disk. */
export function writeAssets() {
  const kept = readRegistry().filter((r) => r.writtenBy !== SCAN);
  for (const row of kept) {
    // A hand-described row is accepted again as its files now are; a fetched one is not.
    if (row.writtenBy === 'hand') for (const p of Object.keys(row.files)) if (existsSync(abs(p))) row.files[p] = fileHash(p);
  }
  // A fetched row whose files are all gone goes with them; a hand-written one stays, for the
  // check to name until its file is back or the row is removed by hand.
  const live = kept.filter((r) => r.writtenBy === 'hand' || Object.keys(r.files).some((p) => existsSync(abs(p))));
  const claimed = new Set(live.flatMap((r) => Object.values(r.files)));
  const groups = new Map();
  for (const p of [...assetFiles(), ...RULE_FILES.filter((f) => existsSync(abs(f)))]) {
    const h = fileHash(p);
    if (claimed.has(h)) continue;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(p);
  }
  const rows = new Map();
  for (const [h, paths] of groups) {
    const buf = readFileSync(abs(paths[0]));
    const rules = RULES.filter((rule) => paths.some((p) => rule.match(p, h)));
    if (!rules.length) {
      rows.set(`unknown/${paths[0]}`, {
        id: `unknown/${paths[0]}`,
        kind: assetKind(paths[0]),
        files: Object.fromEntries(paths.map((p) => [p, h])),
        licence: 'NOASSERTION',
        copyright: one(embedded(paths[0], buf).copyright),
        shipsAs: 'original',
        source: { url: null, commit: null },
        notice: [],
      });
      continue;
    }
    for (const rule of rules) {
      const id = rule.id(paths);
      const row = rows.get(id) ?? { id, ...rule.describe(paths, buf), files: {} };
      for (const p of paths) row.files[p] = h;
      rows.set(id, row);
    }
  }
  const scanned = [...rows.values()].map((r) => ({ ...r, writtenBy: SCAN }));
  writeRegistry([...live, ...scanned]);
  return { kept: live.length, scanned: scanned.length, unknown: scanned.filter((r) => r.licence === 'NOASSERTION').map((r) => r.id) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { kept, scanned, unknown } = writeAssets();
  console.log(`assets.json: ${kept} rows kept from the fetch scripts and by hand, ${scanned} described here.`);
  if (unknown.length) {
    console.log(`\n${unknown.length} file(s) no rule describes, written as NOASSERTION (pnpm check:assets refuses them):`);
    for (const id of unknown) console.log(`  ${id}`);
  }
}
