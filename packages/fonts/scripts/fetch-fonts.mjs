// Downloads a curated, print-friendly set of Google Fonts (Latin-subset TTF) into
// apps/name-keychain/src/fonts/, then regenerates the font registry + @font-face CSS.
// Idempotent: skips fonts already present. Re-runnable.
import { writeFile, readFile, readdir, access } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS_DIR = path.join(APP, 'src', 'fonts');

// slug: [Label, Category, curated?]  — curated=true shows as an instant front card.
// Categories used by the modal filter: Display, Comic, Script, Handwriting,
// Slab, Serif, Tech, Pixel, Mono, Spooky, Clean.
const MAP = {
  // ----- existing curated 24 (front cards) -----
  'pacifico': ['Pacifico', 'Script', true],
  'luckiest-guy': ['Luckiest Guy', 'Comic', true],
  'creepster': ['Creepster', 'Spooky', true],
  'press-start-2p': ['Press Start 2P', 'Pixel', true],
  'dancing-script': ['Dancing Script', 'Script', true],
  'bungee': ['Bungee', 'Display', true],
  'lobster': ['Lobster', 'Script', true],
  'permanent-marker': ['Permanent Marker', 'Handwriting', true],
  'vt323': ['VT323', 'Pixel', true],
  'bangers': ['Bangers', 'Comic', true],
  'sigmar-one': ['Sigmar One', 'Display', true],
  'kalam': ['Kalam', 'Handwriting', true],
  'amatic-sc': ['Amatic SC', 'Handwriting', false],
  'righteous': ['Righteous', 'Tech', true],
  'anton': ['Anton', 'Clean', true],
  'russo-one': ['Russo One', 'Tech', true],
  'bebas-neue': ['Bebas Neue', 'Clean', true],
  'oswald': ['Oswald', 'Clean', true],
  'playfair-display': ['Playfair Display', 'Serif', true],
  'audiowide': ['Audiowide', 'Tech', true],
  'orbitron': ['Orbitron', 'Tech', true],
  'chakra-petch': ['Chakra Petch', 'Tech', true],
  'arvo': ['Arvo', 'Slab', true],

  // ----- Display / bold impact -----
  'titan-one': ['Titan One', 'Display'],
  'alfa-slab-one': ['Alfa Slab One', 'Slab'],
  'lilita-one': ['Lilita One', 'Comic'],
  'fredoka': ['Fredoka', 'Comic'],
  'baloo-2': ['Baloo 2', 'Comic'],
  'paytone-one': ['Paytone One', 'Display'],
  'fugaz-one': ['Fugaz One', 'Display'],
  'passion-one': ['Passion One', 'Display'],
  'bowlby-one': ['Bowlby One', 'Display'],
  'bowlby-one-sc': ['Bowlby One SC', 'Display'],
  'ultra': ['Ultra', 'Slab'],
  'bevan': ['Bevan', 'Slab'],
  'bree-serif': ['Bree Serif', 'Serif'],
  'patua-one': ['Patua One', 'Slab'],
  'changa-one': ['Changa One', 'Display'],
  'concert-one': ['Concert One', 'Comic'],
  'squada-one': ['Squada One', 'Display'],
  'staatliches': ['Staatliches', 'Clean'],
  'teko': ['Teko', 'Clean'],
  'fjalla-one': ['Fjalla One', 'Clean'],
  'archivo-black': ['Archivo Black', 'Clean'],
  'black-ops-one': ['Black Ops One', 'Tech'],
  'racing-sans-one': ['Racing Sans One', 'Display'],
  'kanit': ['Kanit', 'Clean'],
  'rowdies': ['Rowdies', 'Display'],
  'rubik-mono-one': ['Rubik Mono One', 'Tech'],
  'bakbak-one': ['Bakbak One', 'Display'],
  'shrikhand': ['Shrikhand', 'Display'],
  'ranchers': ['Ranchers', 'Comic'],
  'modak': ['Modak', 'Comic'],
  'boogaloo': ['Boogaloo', 'Comic'],
  'chewy': ['Chewy', 'Comic'],
  'sniglet': ['Sniglet', 'Comic'],
  'grandstander': ['Grandstander', 'Comic'],

  // ----- Script -----
  'great-vibes': ['Great Vibes', 'Script'],
  'satisfy': ['Satisfy', 'Script'],
  'cookie': ['Cookie', 'Script'],
  'sacramento': ['Sacramento', 'Script'],
  'yellowtail': ['Yellowtail', 'Script'],
  'courgette': ['Courgette', 'Script'],
  'kaushan-script': ['Kaushan Script', 'Script'],
  'damion': ['Damion', 'Script'],
  'allura': ['Allura', 'Script'],
  'marck-script': ['Marck Script', 'Script'],
  'parisienne': ['Parisienne', 'Script'],
  'niconne': ['Niconne', 'Script'],
  'alex-brush': ['Alex Brush', 'Script'],
  'norican': ['Norican', 'Script'],
  'rochester': ['Rochester', 'Script'],

  // ----- Handwriting -----
  'caveat': ['Caveat', 'Handwriting'],
  'gochi-hand': ['Gochi Hand', 'Handwriting'],
  'patrick-hand': ['Patrick Hand', 'Handwriting'],
  'architects-daughter': ['Architects Daughter', 'Handwriting'],
  'gloria-hallelujah': ['Gloria Hallelujah', 'Handwriting'],
  'coming-soon': ['Coming Soon', 'Handwriting'],
  'pangolin': ['Pangolin', 'Handwriting'],
  'handlee': ['Handlee', 'Handwriting'],
  'neucha': ['Neucha', 'Handwriting'],
  'sriracha': ['Sriracha', 'Handwriting'],
  'schoolbell': ['Schoolbell', 'Handwriting'],
  'indie-flower': ['Indie Flower', 'Handwriting'],
  'gaegu': ['Gaegu', 'Handwriting'],
  'special-elite': ['Special Elite', 'Handwriting'],

  // ----- Slab / Serif -----
  'roboto-slab': ['Roboto Slab', 'Slab'],
  'zilla-slab': ['Zilla Slab', 'Slab'],
  'rokkitt': ['Rokkitt', 'Slab'],
  'josefin-slab': ['Josefin Slab', 'Slab'],
  'crete-round': ['Crete Round', 'Slab'],
  'sanchez': ['Sanchez', 'Slab'],
  'bitter': ['Bitter', 'Slab'],
  'rye': ['Rye', 'Slab'],
  'domine': ['Domine', 'Serif'],
  'lora': ['Lora', 'Serif'],
  'abril-fatface': ['Abril Fatface', 'Serif'],
  'yeseva-one': ['Yeseva One', 'Serif'],
  'cinzel': ['Cinzel', 'Serif'],
  'cinzel-decorative': ['Cinzel Decorative', 'Serif'],
  'marcellus': ['Marcellus', 'Serif'],
  'vollkorn': ['Vollkorn', 'Serif'],
  'sansita-swashed': ['Sansita Swashed', 'Serif'],

  // ----- Tech / Retro -----
  'monoton': ['Monoton', 'Tech'],
  'wallpoet': ['Wallpoet', 'Tech'],
  'faster-one': ['Faster One', 'Tech'],
  'michroma': ['Michroma', 'Tech'],
  'iceland': ['Iceland', 'Tech'],
  'turret-road': ['Turret Road', 'Tech'],
  'zen-dots': ['Zen Dots', 'Tech'],
  'syncopate': ['Syncopate', 'Tech'],
  'jura': ['Jura', 'Tech'],
  'oxanium': ['Oxanium', 'Tech'],
  'quantico': ['Quantico', 'Tech'],
  'aldrich': ['Aldrich', 'Tech'],
  'gruppo': ['Gruppo', 'Tech'],
  'nova-square': ['Nova Square', 'Tech'],
  'rajdhani': ['Rajdhani', 'Tech'],
  'electrolize': ['Electrolize', 'Tech'],

  // ----- Pixel / Mono -----
  'silkscreen': ['Silkscreen', 'Pixel'],
  'pixelify-sans': ['Pixelify Sans', 'Pixel'],
  'handjet': ['Handjet', 'Pixel'],
  'dotgothic16': ['DotGothic16', 'Pixel'],
  'major-mono-display': ['Major Mono Display', 'Mono'],
  'nova-mono': ['Nova Mono', 'Mono'],
  'cutive-mono': ['Cutive Mono', 'Mono'],
  'space-mono': ['Space Mono', 'Mono'],
  'share-tech-mono': ['Share Tech Mono', 'Mono'],

  // ----- Spooky / Themed -----
  'nosifer': ['Nosifer', 'Spooky'],
  'butcherman': ['Butcherman', 'Spooky'],
  'eater': ['Eater', 'Spooky'],
  'frijole': ['Frijole', 'Spooky'],
  'metal-mania': ['Metal Mania', 'Spooky'],
  'pirata-one': ['Pirata One', 'Spooky'],
  'ewert': ['Ewert', 'Spooky'],
  'griffy': ['Griffy', 'Spooky'],
  'henny-penny': ['Henny Penny', 'Spooky'],
  'jolly-lodger': ['Jolly Lodger', 'Spooky'],
  'new-rocker': ['New Rocker', 'Spooky'],
  'rubik-glitch': ['Rubik Glitch', 'Spooky'],

  // ----- Clean sans / rounded -----
  'montserrat': ['Montserrat', 'Clean'],
  'poppins': ['Poppins', 'Clean'],
  'nunito': ['Nunito', 'Clean'],
  'rubik': ['Rubik', 'Clean'],
  'titillium-web': ['Titillium Web', 'Clean'],
  'barlow-condensed': ['Barlow Condensed', 'Clean'],
  'josefin-sans': ['Josefin Sans', 'Clean'],
  'comfortaa': ['Comfortaa', 'Comic'],
  'quicksand': ['Quicksand', 'Comic'],
  'jua': ['Jua', 'Comic'],
  'do-hyeon': ['Do Hyeon', 'Clean'],
  'black-han-sans': ['Black Han Sans', 'Clean'],

  // ----- added 2026-09-18: 93 more faces, every one verified OFL-1.1 or
  // Apache-2.0 against its directory in the google/fonts repo (ofl/ vs apache/ IS
  // the licence). Nothing here is UFL. -----
  // Mono
  'jetbrains-mono': ['JetBrains Mono', 'Mono', true],
  'roboto-mono': ['Roboto Mono', 'Mono'],
  'ibm-plex-mono': ['IBM Plex Mono', 'Mono'],
  'inconsolata': ['Inconsolata', 'Mono'],
  'source-code-pro': ['Source Code Pro', 'Mono'],
  'fira-mono': ['Fira Mono', 'Mono'],
  'dm-mono': ['DM Mono', 'Mono'],
  'martian-mono': ['Martian Mono', 'Mono'],
  'syne-mono': ['Syne Mono', 'Mono'],
  'xanh-mono': ['Xanh Mono', 'Mono'],
  // Pixel
  'micro-5': ['Micro 5', 'Pixel'],
  'jersey-15': ['Jersey 15', 'Pixel'],
  'jersey-25': ['Jersey 25', 'Pixel'],
  'tiny5': ['Tiny5', 'Pixel'],
  'workbench': ['Workbench', 'Pixel'],
  'sixtyfour': ['Sixtyfour', 'Pixel'],
  // Serif
  'libre-baskerville': ['Libre Baskerville', 'Serif', true],
  'merriweather': ['Merriweather', 'Serif'],
  'pt-serif': ['PT Serif', 'Serif'],
  'eb-garamond': ['EB Garamond', 'Serif'],
  'spectral': ['Spectral', 'Serif'],
  'literata': ['Literata', 'Serif'],
  'petrona': ['Petrona', 'Serif'],
  'gelasio': ['Gelasio', 'Serif'],
  'faustina': ['Faustina', 'Serif'],
  // Slab
  'kreon': ['Kreon', 'Slab'],
  'aleo': ['Aleo', 'Slab'],
  'coustard': ['Coustard', 'Slab'],
  'podkova': ['Podkova', 'Slab'],
  'rufina': ['Rufina', 'Slab'],
  'alegreya-sans-sc': ['Alegreya Sans SC', 'Slab'],
  // Comic
  'comic-neue': ['Comic Neue', 'Comic', true],
  'short-stack': ['Short Stack', 'Comic'],
  'itim': ['Itim', 'Comic'],
  'mali': ['Mali', 'Comic'],
  'chicle': ['Chicle', 'Comic'],
  'sansita': ['Sansita', 'Comic'],
  'delius-swash-caps': ['Delius Swash Caps', 'Comic'],
  // Display
  'bungee-shade': ['Bungee Shade', 'Display', true],
  'bungee-inline': ['Bungee Inline', 'Display'],
  'chonburi': ['Chonburi', 'Display'],
  'gravitas-one': ['Gravitas One', 'Display'],
  'days-one': ['Days One', 'Display'],
  'secular-one': ['Secular One', 'Display'],
  'sancreek': ['Sancreek', 'Display'],
  'rammetto-one': ['Rammetto One', 'Display'],
  'dela-gothic-one': ['Dela Gothic One', 'Display', true],
  // Script
  'tangerine': ['Tangerine', 'Script'],
  'pinyon-script': ['Pinyon Script', 'Script'],
  'italianno': ['Italianno', 'Script'],
  'berkshire-swash': ['Berkshire Swash', 'Script'],
  'lobster-two': ['Lobster Two', 'Script'],
  'grand-hotel': ['Grand Hotel', 'Script'],
  'bad-script': ['Bad Script', 'Script'],
  'petit-formal-script': ['Petit Formal Script', 'Script'],
  // Handwriting
  'shadows-into-light': ['Shadows Into Light', 'Handwriting'],
  'just-another-hand': ['Just Another Hand', 'Handwriting'],
  'rock-salt': ['Rock Salt', 'Handwriting'],
  'reenie-beanie': ['Reenie Beanie', 'Handwriting'],
  'homemade-apple': ['Homemade Apple', 'Handwriting'],
  'nothing-you-could-do': ['Nothing You Could Do', 'Handwriting'],
  'cedarville-cursive': ['Cedarville Cursive', 'Handwriting'],
  'sue-ellen-francisco': ['Sue Ellen Francisco', 'Handwriting'],
  // Spooky
  'rubik-burned': ['Rubik Burned', 'Spooky'],
  'rubik-puddles': ['Rubik Puddles', 'Spooky'],
  'rubik-beastly': ['Rubik Beastly', 'Spooky'],
  'rubik-distressed': ['Rubik Distressed', 'Spooky'],
  'rubik-moonrocks': ['Rubik Moonrocks', 'Spooky', true],
  'rubik-vinyl': ['Rubik Vinyl', 'Spooky'],
  'rubik-spray-paint': ['Rubik Spray Paint', 'Spooky'],
  'rubik-storm': ['Rubik Storm', 'Spooky'],
  'flavors': ['Flavors', 'Spooky'],
  'lacquer': ['Lacquer', 'Spooky'],
  // Clean
  'inter': ['Inter', 'Clean'],
  'work-sans': ['Work Sans', 'Clean'],
  'raleway': ['Raleway', 'Clean'],
  'manrope': ['Manrope', 'Clean'],
  'outfit': ['Outfit', 'Clean'],
  'lexend': ['Lexend', 'Clean'],
  'urbanist': ['Urbanist', 'Clean'],
  'sora': ['Sora', 'Clean'],
  'figtree': ['Figtree', 'Clean'],
  'archivo': ['Archivo', 'Clean'],
  'cabin': ['Cabin', 'Clean'],
  'exo-2': ['Exo 2', 'Clean'],
  // Tech
  'unica-one': ['Unica One', 'Tech'],
  'tomorrow': ['Tomorrow', 'Tech'],
  'khand': ['Khand', 'Tech'],
  'saira-condensed': ['Saira Condensed', 'Tech'],
};

/** What a NEW face is fetched with.
 *
 *  The API serves a handful of prebuilt subset combinations rather than cutting one
 *  to order, and anything beyond latin-ext lands you in the "everything" build: Dela
 *  Gothic One is 43 KB at `latin,latin-ext` and 2419 KB the moment you also ask for
 *  cyrillic — because that build carries its Japanese too. The decorative Rubiks were
 *  each dragging in Hebrew the same way.
 *
 *  So the 90 faces added on 2026-09-18 are latin display faces and are fetched, and
 *  REPORTED, as exactly that: `isFontSupported` will not offer them for a Cyrillic or
 *  Greek name, which is the truth about the file rather than a promise it cannot keep.
 *  The 152 older faces are untouched — many of them do carry Cyrillic, and a face
 *  already on disk keeps reporting the subsets that file really contains. */
const USEFUL_SUBSETS = ['latin', 'latin-ext'];

async function fetchTtfUrl(slug) {
  const metaResp = await fetch(`https://gwfh.mranftl.com/api/fonts/${slug}`);
  if (!metaResp.ok) throw new Error(`meta HTTP ${metaResp.status}`);
  const meta = await metaResp.json();
  const all = meta.subsets && meta.subsets.length ? meta.subsets : ['latin'];
  // Never empty: a face with no latin at all still has to come back with something.
  const wanted = all.filter((x) => USEFUL_SUBSETS.includes(x));
  const useful = wanted.length ? wanted : all;

  const r = await fetch(`https://gwfh.mranftl.com/api/fonts/${slug}?subsets=${useful.join(',')}`);
  if (!r.ok) throw new Error(`meta HTTP ${r.status}`);
  const j = await r.json();
  const variants = j.variants || [];
  const reg = variants.find((v) => v.id === 'regular') || variants.find((v) => v.id === '400') || variants[0];
  if (!reg || !reg.ttf) throw new Error('no ttf variant');
  return { url: reg.ttf, subsets: useful, fullSubsets: all };
}

async function download(slug) {
  const dest = path.join(FONTS_DIR, `${slug}.ttf`);
  let cachedSubsets = ['latin'];
  try {
    const { url, subsets, fullSubsets } = await fetchTtfUrl(slug);
    cachedSubsets = subsets;
    // An existing file was fetched under whatever policy was in force then, so it
    // reports what it actually holds — not what we would ask for today.
    if (existsSync(dest)) return { slug, status: 'exists', subsets: fullSubsets };
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ttf HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000) throw new Error(`too small (${buf.length}b)`);
    await writeFile(dest, buf);
    return { slug, status: 'ok', bytes: buf.length, subsets };
  } catch (e) {
    return { slug, status: 'FAIL', error: e.message };
  }
}

async function pool(items, worker, concurrency = 6) {
  const results = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

const slugs = Object.keys(MAP);
console.log(`Downloading ${slugs.length} fonts (skipping existing)...`);
const results = await pool(slugs, download, 6);

const ok = results.filter((r) => r.status === 'ok');
const exists = results.filter((r) => r.status === 'exists');
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\nDownloaded: ${ok.length} new, ${exists.length} already present, ${failed.length} failed.`);
if (failed.length) console.log('FAILED:', failed.map((f) => `${f.slug} (${f.error})`).join(', '));

// Fallback is now handled manually (icon-fallback.ttf)

// Map subsets back to MAP for all successful results
for (const r of results) {
  if (r.status === 'ok' || r.status === 'exists') {
    if (MAP[r.slug]) MAP[r.slug][3] = r.subsets;
  }
}

// Regenerate registry + CSS from files actually present.
const files = (await readdir(FONTS_DIR)).filter((f) => f.endsWith('.ttf') && f !== 'icon-fallback.ttf');
const present = new Set(files.map((f) => f.replace('.ttf', '')));

/** Bytes on disk, so an app can budget its own bundle instead of hardcoding a list.
 *
 *  All 241 faces are ~33 MB of TTF, too heavy to ship, so the fold-up box picks a subset.
 *  Before this it shipped a hand-written list of eight. With the size on the record it can say
 *  "every face under 120 KB" in one line and keep up with the library on its own. */
const bytesOf = (slug) => statSync(path.join(FONTS_DIR, `${slug}.ttf`)).size;

const rows = Object.entries(MAP)
  .filter(([slug]) => present.has(slug))
  .map(([slug, [label, category, curated, subsets]]) => ({ id: slug, label, category, curated: !!curated, subsets: subsets || ['latin'], bytes: bytesOf(slug) }));

// Any ttf on disk not in MAP: include with a guessed label + 'Display'.
for (const slug of present) {
  if (!MAP[slug]) {
    const label = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    rows.push({ id: slug, label, category: 'Display', curated: false, subsets: ['latin'], bytes: bytesOf(slug) });
  }
}
rows.sort((a, b) => a.label.localeCompare(b.label));

const ts = `// AUTO-GENERATED by scripts/fetch-fonts.mjs — do not edit by hand.
export interface FontChoice { id: string; label: string; category: string; curated: boolean; subsets: string[]; /** TTF size on disk, bytes. Absent for a face injected at RUNTIME — the keychain and the pen topper both let someone drop their own font in, and that one never came from this registry. */ bytes?: number; }
export const FONTS: FontChoice[] = ${JSON.stringify(rows, null, 2)};
`;
await writeFile(path.join(APP, 'src', 'registry.ts'), ts);

// icon-fallback is deliberately absent from `rows` — it must never show up as a
// pickable font. It still needs its @font-face rule, though: the symbol pickers
// render their glyphs with it, and without the rule every symbol is a tofu box.
const css = `/* AUTO-GENERATED by scripts/fetch-fonts.mjs — do not edit by hand. */\n` +
  `@font-face { font-family: VL-icon-fallback; src: url('./fonts/icon-fallback.ttf'); font-display: block; }\n` +
  rows.map((r) => `@font-face { font-family: VL-${r.id}; src: url('./fonts/${r.id}.ttf'); font-display: swap; }`).join('\n') + '\n';
await writeFile(path.join(APP, 'src', 'fonts.css'), css);

// Regenerate attribution/CREDITS for the full set. Google Fonts are each licensed
// under OFL-1.1 or Apache-2.0 (shown on the linked specimen page); both permit
// bundling/embedding in commercial products as long as the license text is retained.
const specimen = (label) => `https://fonts.google.com/specimen/${label.replace(/ /g, '+')}`;
const credits = `# Bundled fonts

All ${rows.length} fonts in this folder are from [Google Fonts](https://fonts.google.com). Each is
licensed under the **SIL Open Font License 1.1** ([\`OFL.txt\`](OFL.txt)) or the
**Apache License 2.0** (https://www.apache.org/licenses/LICENSE-2.0), as stated on its
Google Fonts specimen page linked below. Both licenses permit embedding and bundling in
commercial software. Each font remains © its respective authors; no font is sold or
redistributed on its own — they ship only as part of this generator.

| Font | Category | Google Fonts page (license) |
| --- | --- | --- |
${rows.map((r) => `| ${r.label} | ${r.category} | ${specimen(r.label)} |`).join('\n')}

## Icon fallback

\`icon-fallback.ttf\` is **Material Symbols Rounded**, instanced at \`FILL=1\` and subset to the
glyphs the picker offers — https://fonts.google.com/icons. It is not a pickable typeface: it
stands in for glyphs the chosen font is missing, and it is the source of the symbol library in
\`src/icons.ts\` (generated by \`scripts/fetch-icons.mjs\`).

- Icons and font: **Apache License 2.0** ([\`LICENSE-APACHE-2.0.txt\`](LICENSE-APACHE-2.0.txt))
- © Google LLC

Apache-2.0 places no attribution requirement on a work made WITH the icons, which is the whole
reason this is not Font Awesome any more. Font Awesome Free licenses its icons **CC BY 4.0**, and
CC BY attaches to every copy and derivative — so every dieline, keychain and cut file a user
exported carried an attribution obligation they had never been told about. Apache asks only
that the licence text travel with the bundle, which is what the file above is for.
`;
await writeFile(path.join(FONTS_DIR, 'CREDITS.md'), credits);

console.log(`\nRegistry: ${rows.length} fonts (${rows.filter((r) => r.curated).length} curated front cards).`);
console.log('Wrote src/registry.ts, src/fonts.css, src/fonts/CREDITS.md');
