// Downloads a curated, print-friendly set of Google Fonts (Latin-subset TTF) into
// apps/name-keychain/src/fonts/, then regenerates the font registry + @font-face CSS.
// Idempotent: skips fonts already present. Re-runnable.
import { writeFile, readFile, readdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
};

async function fetchTtfUrl(slug) {
  const r = await fetch(`https://gwfh.mranftl.com/api/fonts/${slug}?subsets=latin`);
  if (!r.ok) throw new Error(`meta HTTP ${r.status}`);
  const j = await r.json();
  const variants = j.variants || [];
  const reg = variants.find((v) => v.id === 'regular') || variants.find((v) => v.id === '400') || variants[0];
  if (!reg || !reg.ttf) throw new Error('no ttf variant');
  return reg.ttf;
}

async function download(slug) {
  const dest = path.join(FONTS_DIR, `${slug}.ttf`);
  if (existsSync(dest)) return { slug, status: 'exists' };
  try {
    const url = await fetchTtfUrl(slug);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ttf HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000) throw new Error(`too small (${buf.length}b)`);
    await writeFile(dest, buf);
    return { slug, status: 'ok', bytes: buf.length };
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

// Regenerate registry + CSS from files actually present.
const files = (await readdir(FONTS_DIR)).filter((f) => f.endsWith('.ttf'));
const present = new Set(files.map((f) => f.replace('.ttf', '')));

const rows = Object.entries(MAP)
  .filter(([slug]) => present.has(slug))
  .map(([slug, [label, category, curated]]) => ({ id: slug, label, category, curated: !!curated }));

// Any ttf on disk not in MAP: include with a guessed label + 'Display'.
for (const slug of present) {
  if (!MAP[slug]) {
    const label = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    rows.push({ id: slug, label, category: 'Display', curated: false });
  }
}
rows.sort((a, b) => a.label.localeCompare(b.label));

const ts = `// AUTO-GENERATED by scripts/fetch-fonts.mjs — do not edit by hand.
export interface FontChoice { id: string; label: string; category: string; curated: boolean; }
export const FONTS: FontChoice[] = ${JSON.stringify(rows, null, 2)};
`;
await writeFile(path.join(APP, 'src', 'generated-fonts.ts'), ts);

const css = `/* AUTO-GENERATED by scripts/fetch-fonts.mjs — do not edit by hand. */\n` +
  rows.map((r) => `@font-face { font-family: NK-${r.id}; src: url('./fonts/${r.id}.ttf'); font-display: swap; }`).join('\n') + '\n';
await writeFile(path.join(APP, 'src', 'generated-fonts.css'), css);

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
`;
await writeFile(path.join(FONTS_DIR, 'CREDITS.md'), credits);

console.log(`\nRegistry: ${rows.length} fonts (${rows.filter((r) => r.curated).length} curated front cards).`);
console.log('Wrote src/generated-fonts.ts, src/generated-fonts.css, src/fonts/CREDITS.md');
