// Downloads a curated, print-friendly set of Google Fonts into src/fonts/, cuts the large CJK
// and variable faces down to what a model needs (see UPSTREAM), then regenerates the font
// registry, the @font-face CSS and fonts/CREDITS.md from the files on disk.
//
// Idempotent: a face already on disk, and already cut, is not fetched again. Its family's
// licence file is read on every run, from node_modules/.cache after the first. Each face's
// `subsets` is read from its own cmap with src/coverage.ts, the same sets `isFontSupported`
// checks text against. Needs Node 22.18 or later, which loads that file as TypeScript.
import { writeFile, readFile, readdir, access, mkdir } from 'node:fs/promises';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { coverageOf, coverageTests, latinExtBOf } from '../src/coverage.ts';
import { reservedFontNames, reservedNameIn } from './reserved-names.mjs';
import { recordAssets, fileHash } from '../../../scripts/lib/assets.mjs';
import { writeAssets } from '../../../scripts/assets.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS_DIR = path.join(APP, 'src', 'fonts');
const opentype = createRequire(import.meta.url)('opentype.js');

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

  // ----- other alphabets: Korean, Japanese, Chinese, Cyrillic. Fetched from google/fonts
  // and, where large, cut to size: see UPSTREAM. -----
  'bagel-fat-one': ['Bagel Fat One', 'Comic'],
  'gasoek-one': ['Gasoek One', 'Display'],
  'gothic-a1': ['Gothic A1', 'Clean'],
  'rubik-one': ['Rubik One', 'Display'],
  'comic-relief': ['Comic Relief', 'Comic'],
  'dela-gothic-one-jp': ['Dela Gothic One JP', 'Display'],
  'm-plus-1p': ['M PLUS 1p', 'Clean'],
  'cherry-bomb-one': ['Cherry Bomb One', 'Comic'],
  'zcool-kuaile': ['ZCOOL KuaiLe', 'Comic'],
  'noto-sans-sc': ['Noto Sans SC', 'Clean'],
};

/** Faces taken from the google/fonts repository instead of the font API, which serves Latin
 *  builds and does not carry every family. The directory a file sits in there IS its licence
 *  (`ofl/` is OFL-1.1, `apache/` Apache-2.0); nothing from anywhere else is accepted.
 *
 *  `for` is what the face is here for: the cut keeps it, and the run refuses a file that does
 *  not cover it. `cut` subsets the file to the characters below, without hinting (the
 *  geometry reads outlines, and hinting was most of a CJK file's bytes). Each CJK face is cut
 *  to its script's common set: KS X 1001 Hangul, JIS level 1 kanji, GB2312 level 1 hanzi. That
 *  also drops the Kangxi radical code points that share a glyph with common kanji (日 月 一),
 *  which a loader keying each glyph by its lowest code point loses the kanji to. `pin` fixes
 *  the axes of a variable file, whose default instance is often Thin, and renames it to match.
 *
 *  Pinned to one commit, so a re-run cuts the same bytes. To take upstream changes, move the
 *  commit and delete the affected .ttf files. To re-cut after changing the recipe, delete the
 *  .ttf files it affects. */
const GOOGLE_FONTS = 'https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb';
const UPSTREAM = {
  'black-han-sans': { file: 'ofl/blackhansans/BlackHanSans-Regular.ttf', cut: true, for: ['korean'] },
  'do-hyeon': { file: 'ofl/dohyeon/DoHyeon-Regular.ttf', cut: true, for: ['korean'] },
  'jua': { file: 'ofl/jua/Jua-Regular.ttf', cut: true, for: ['korean'] },
  'gaegu': { file: 'ofl/gaegu/Gaegu-Regular.ttf', cut: true, for: ['korean'] },
  'bagel-fat-one': { file: 'ofl/bagelfatone/BagelFatOne-Regular.ttf', cut: true, for: ['korean'] },
  'gasoek-one': { file: 'ofl/gasoekone/GasoekOne-Regular.ttf', cut: true, for: ['korean'] },
  'gothic-a1': { file: 'ofl/gothica1/GothicA1-Black.ttf', cut: true, for: ['korean', 'kana', 'cyrillic', 'greek'] },
  'dotgothic16': { file: 'ofl/dotgothic16/DotGothic16-Regular.ttf', cut: true, for: ['japanese', 'cyrillic'] },
  // A face of its own, with `family` for its credits link: `dela-gothic-one` stays the 43 KB
  // Latin build from the API that the shipped generators use and budget their bundles by.
  'dela-gothic-one-jp': { file: 'ofl/delagothicone/DelaGothicOne-Regular.ttf', family: 'Dela Gothic One', cut: true, for: ['japanese', 'cyrillic', 'greek'] },
  'm-plus-1p': { file: 'ofl/mplus1p/MPLUS1p-Black.ttf', cut: true, for: ['japanese', 'cyrillic', 'greek'] },
  'cherry-bomb-one': { file: 'ofl/cherrybombone/CherryBombOne-Regular.ttf', cut: true, for: ['kana'] },
  'zcool-kuaile': { file: 'ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf', cut: true, for: ['chinese-simplified'] },
  'noto-sans-sc': { file: 'ofl/notosanssc/NotoSansSC[wght].ttf', cut: true, pin: { wght: 900 }, for: ['chinese-simplified'] },
  'rubik-one': { file: 'ofl/rubikone/RubikOne-Regular.ttf', for: ['cyrillic'] },
  'comic-relief': { file: 'ofl/comicrelief/ComicRelief-Bold.ttf', for: ['cyrillic', 'greek'] },
};

/** Faces whose licence reserves their name. OFL 3 lets no Modified Version use a Reserved Font
 *  Name, and the font API serves Google's own Latin cut of each family, which is a Modified
 *  Version. So these ship as the family's original file from google/fonts, byte for byte
 *  (`upstream()` checks the file on disk against it). A family google/fonts now carries only as a
 *  variable font comes from the commit at which its own static Regular was last there.
 *
 *  The list is every face from the API whose licence file (OFL.txt in its google/fonts folder)
 *  declares a Reserved Font Name. A face added from the API later gets the same check on every
 *  run: `download` reads its family's licence file and refuses a face named with a reserved name. */
const ORIGINALS = {
  'abril-fatface': 'ofl/abrilfatface/AbrilFatface-Regular.ttf',
  'aldrich': 'ofl/aldrich/Aldrich-Regular.ttf',
  'alfa-slab-one': 'ofl/alfaslabone/AlfaSlabOne-Regular.ttf',
  'arvo': 'ofl/arvo/Arvo-Regular.ttf',
  'audiowide': 'ofl/audiowide/Audiowide-Regular.ttf',
  'berkshire-swash': 'ofl/berkshireswash/BerkshireSwash-Regular.ttf',
  'bitter': ['ofl/bitter/static/Bitter-Regular.ttf', 'e57fc4e6dc99bf9b6e0c32e4fe952e02c46361e9'],
  'boogaloo': 'ofl/boogaloo/Boogaloo-Regular.ttf',
  'bowlby-one': 'ofl/bowlbyone/BowlbyOne-Regular.ttf',
  'bowlby-one-sc': 'ofl/bowlbyonesc/BowlbyOneSC-Regular.ttf',
  'bree-serif': 'ofl/breeserif/BreeSerif-Regular.ttf',
  'butcherman': 'ofl/butcherman/Butcherman-Regular.ttf',
  'changa-one': 'ofl/changaone/ChangaOne-Regular.ttf',
  'chicle': 'ofl/chicle/Chicle-Regular.ttf',
  'cinzel-decorative': 'ofl/cinzeldecorative/CinzelDecorative-Regular.ttf',
  'comfortaa': ['ofl/comfortaa/static/Comfortaa-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'concert-one': 'ofl/concertone/ConcertOne-Regular.ttf',
  'cookie': 'ofl/cookie/Cookie-Regular.ttf',
  'courgette': 'ofl/courgette/Courgette-Regular.ttf',
  'creepster': 'ofl/creepster/Creepster-Regular.ttf',
  'crete-round': 'ofl/creteround/CreteRound-Regular.ttf',
  'dancing-script': ['ofl/dancingscript/static/DancingScript-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'days-one': 'ofl/daysone/DaysOne-Regular.ttf',
  'delius-swash-caps': 'ofl/deliusswashcaps/DeliusSwashCaps-Regular.ttf',
  'domine': ['ofl/domine/static/Domine-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'eater': 'ofl/eater/Eater-Regular.ttf',
  'electrolize': 'ofl/electrolize/Electrolize-Regular.ttf',
  'ewert': 'ofl/ewert/Ewert-Regular.ttf',
  'faster-one': 'ofl/fasterone/FasterOne-Regular.ttf',
  'flavors': 'ofl/flavors/Flavors-Regular.ttf',
  'frijole': 'ofl/frijole/Frijole-Regular.ttf',
  'fugaz-one': 'ofl/fugazone/FugazOne-Regular.ttf',
  'gochi-hand': 'ofl/gochihand/GochiHand-Regular.ttf',
  'grand-hotel': 'ofl/grandhotel/GrandHotel-Regular.ttf',
  'gravitas-one': 'ofl/gravitasone/GravitasOne.ttf',
  'griffy': 'ofl/griffy/Griffy-Regular.ttf',
  'handlee': 'ofl/handlee/Handlee-Regular.ttf',
  'henny-penny': 'ofl/hennypenny/HennyPenny-Regular.ttf',
  'ibm-plex-mono': 'ofl/ibmplexmono/IBMPlexMono-Regular.ttf',
  'iceland': 'ofl/iceland/Iceland-Regular.ttf',
  'jolly-lodger': 'ofl/jollylodger/JollyLodger-Regular.ttf',
  'josefin-sans': ['ofl/josefinsans/static/JosefinSans-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'josefin-slab': ['ofl/josefinslab/static/JosefinSlab-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'kaushan-script': 'ofl/kaushanscript/KaushanScript-Regular.ttf',
  'kreon': ['ofl/kreon/static/Kreon-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'lexend': ['ofl/lexend/Lexend-Regular.ttf', '2ef72759514b9399d24adab6cf21143c3036a23b'],
  'libre-baskerville': ['ofl/librebaskerville/LibreBaskerville-Regular.ttf', '93b0f9ed116d44348bae0e12537e00f9502cc47e'],
  'lilita-one': 'ofl/lilitaone/LilitaOne-Regular.ttf',
  'lobster': 'ofl/lobster/Lobster-Regular.ttf',
  'lobster-two': 'ofl/lobstertwo/LobsterTwo-Regular.ttf',
  'lora': ['ofl/lora/static/Lora-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'marcellus': 'ofl/marcellus/Marcellus-Regular.ttf',
  'marck-script': 'ofl/marckscript/MarckScript-Regular.ttf',
  'merriweather': ['ofl/merriweather/Merriweather-Regular.ttf', 'e9263a54d43d89ddcf351c5ae8ab2179f1aebc89'],
  'monoton': 'ofl/monoton/Monoton-Regular.ttf',
  'new-rocker': 'ofl/newrocker/NewRocker-Regular.ttf',
  'niconne': 'ofl/niconne/Niconne-Regular.ttf',
  'nosifer': 'ofl/nosifer/Nosifer-Regular.ttf',
  'nova-mono': 'ofl/novamono/NovaMono.ttf',
  'nova-square': 'ofl/novasquare/NovaSquare.ttf',
  'orbitron': ['ofl/orbitron/static/Orbitron-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'parisienne': 'ofl/parisienne/Parisienne-Regular.ttf',
  'passion-one': 'ofl/passionone/PassionOne-Regular.ttf',
  'patua-one': 'ofl/patuaone/PatuaOne-Regular.ttf',
  'paytone-one': 'ofl/paytoneone/PaytoneOne-Regular.ttf',
  'petit-formal-script': 'ofl/petitformalscript/PetitFormalScript-Regular.ttf',
  'pirata-one': 'ofl/pirataone/PirataOne-Regular.ttf',
  'playfair-display': ['ofl/playfairdisplay/static/PlayfairDisplay-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'press-start-2p': 'ofl/pressstart2p/PressStart2P-Regular.ttf',
  'pt-serif': 'ofl/ptserif/PT_Serif-Web-Regular.ttf',
  'quantico': 'ofl/quantico/Quantico-Regular.ttf',
  'quicksand': ['ofl/quicksand/static/Quicksand-Regular.ttf', '76e64ff83360759b52135bc07393310509497386'],
  'racing-sans-one': 'ofl/racingsansone/RacingSansOne-Regular.ttf',
  'raleway': ['ofl/raleway/static/Raleway-Regular.ttf', '10a708073179c32928eb894e53465fca8106772f'],
  'rammetto-one': 'ofl/rammettoone/RammettoOne-Regular.ttf',
  'ranchers': 'ofl/ranchers/Ranchers-Regular.ttf',
  'righteous': 'ofl/righteous/Righteous-Regular.ttf',
  'rufina': 'ofl/rufina/Rufina-Regular.ttf',
  'russo-one': 'ofl/russoone/RussoOne-Regular.ttf',
  'rye': 'ofl/rye/Rye-Regular.ttf',
  'sacramento': 'ofl/sacramento/Sacramento-Regular.ttf',
  'saira-condensed': 'ofl/sairacondensed/SairaCondensed-Regular.ttf',
  'sanchez': 'ofl/sanchez/Sanchez-Regular.ttf',
  'sancreek': 'ofl/sancreek/Sancreek-Regular.ttf',
  'share-tech-mono': 'ofl/sharetechmono/ShareTechMono-Regular.ttf',
  'short-stack': 'ofl/shortstack/ShortStack-Regular.ttf',
  'sniglet': 'ofl/sniglet/Sniglet-Regular.ttf',
  'source-code-pro': ['ofl/sourcecodepro/SourceCodePro-Regular.ttf', '85c7f10bdbca85b4bcbc2c2b3761ec60513d7a57'],
  'squada-one': 'ofl/squadaone/SquadaOne-Regular.ttf',
  'titan-one': 'ofl/titanone/TitanOne-Regular.ttf',
  'wallpoet': 'ofl/wallpoet/Wallpoet-Regular.ttf',
  'yeseva-one': 'ofl/yesevaone/YesevaOne-Regular.ttf',
};
for (const [slug, src] of Object.entries(ORIGINALS)) {
  const [file, commit] = Array.isArray(src) ? src : [src];
  UPSTREAM[slug] = { file, ...(commit ? { commit } : {}), for: ['latin'] };
}

/** What a NEW face is fetched from the font API with.
 *
 *  The API serves a handful of prebuilt subset combinations rather than cutting one
 *  to order, and anything beyond latin-ext lands you in the "everything" build: Dela
 *  Gothic One is 43 KB at `latin,latin-ext` and 2419 KB the moment you also ask for
 *  cyrillic — because that build carries its Japanese too. The decorative Rubiks were
 *  each dragging in Hebrew the same way.
 *
 *  So a face from the API is a Latin face. One wanted for another alphabet comes from
 *  UPSTREAM instead and is cut to what that alphabet needs. Either way the registry
 *  reports what the file holds, read from its cmap, never what the API says the family has. */
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
  return reg.ttf;
}

/** A face from the API, fetched only when it is not on disk, and checked against its family's
 *  licence on every run, on disk or not.
 *
 *  The API serves Google's own Latin build of a family, which is a Modified Version under the
 *  OFL and may not carry a Reserved Font Name. Its name table holds no declaration to read (the
 *  API builds leave it out), so the family's licence file in google/fonts is read instead, at
 *  the pinned commit. A family with neither an ofl/ nor an apache/ folder is refused too: its
 *  licence is not established. */
async function download(slug) {
  const dest = path.join(FONTS_DIR, `${slug}.ttf`);
  try {
    const dir = MAP[slug][0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const family = await familyLicence([`ofl/${dir}`, `apache/${dir}`]);
    const have = existsSync(dest);
    let buf;
    if (have) {
      buf = readFileSync(dest);
    } else {
      const r = await fetch(await fetchTtfUrl(slug));
      if (!r.ok) throw new Error(`ttf HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000) throw new Error(`too small (${buf.length}b)`);
    }
    const clash = reservedNameIn(FACE_NAMES.map((k) => nameOf(parse(buf), k)), family.reserved);
    if (clash) throw new Error(`the API build is a Modified Version and ${family.file} reserves "${clash}": take the original from ORIGINALS instead`);
    if (have) return { slug, status: 'exists', family };
    await writeFile(dest, buf);
    return { slug, status: 'ok', note: kb(buf.length), family };
  } catch (e) {
    return { slug, status: 'FAIL', error: e.message };
  }
}

// ---------------------------------------------------------------- cutting to size

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString('en')} KB`;
const TESTS = coverageTests();

/** Kept in every cut face that has them: Latin with its extensions and Vietnamese, Greek,
 *  Cyrillic, and everyday punctuation. A CJK face is not here for its Latin, but that is a
 *  few hundred glyphs against thousands, and a Latin name set in it has to keep working. */
const ALPHABETS = [
  ...range(0x20, 0x7e), ...range(0xa0, 0x24f), ...range(0x1e00, 0x1eff),
  ...range(0x384, 0x3ce), ...range(0x400, 0x52f),
  ...range(0x2010, 0x2027), 0x2030, 0x2032, 0x2033, 0x2039, 0x203a, 0x20ac, 0x2116, 0x2122,
];
/** CJK punctuation, and the full-width forms a Japanese or Chinese keyboard types. */
const CJK_PUNCTUATION = [...range(0x3000, 0x303f), ...range(0xff01, 0xff5e)];
const KANA_BLOCK = [...range(0x3041, 0x3096), ...range(0x3099, 0x30ff)];
/** What each coverage name a face is here `for` adds to its cut. */
const LINES = {
  korean: [...TESTS.korean, ...range(0x3131, 0x318e)],
  kana: [...KANA_BLOCK, ...CJK_PUNCTUATION],
  japanese: [...TESTS.japanese, ...KANA_BLOCK, ...CJK_PUNCTUATION],
  'chinese-simplified': [...TESTS['chinese-simplified'], ...CJK_PUNCTUATION],
};
const cutText = (spec) => new Set([...ALPHABETS, ...spec.for.flatMap((name) => LINES[name] ?? [])]);
/** How CREDITS.md words what a cut keeps. */
const KEPT = {
  korean: 'the 2,350 Hangul syllables of KS X 1001',
  kana: 'hiragana and katakana',
  japanese: 'kana and the 2,965 kanji of JIS X 0208 level 1',
  'chinese-simplified': 'the 3,755 hanzi of GB2312 level 1',
  cyrillic: 'Cyrillic',
  greek: 'Greek',
};

/** The table directory of a TrueType file, by tag. */
function tablesOf(buf) {
  const out = {};
  for (let i = 0, n = buf.readUInt16BE(4); i < n; i++) {
    const r = 12 + i * 16;
    out[buf.toString('latin1', r, r + 4)] = { offset: buf.readUInt32BE(r + 8), length: buf.readUInt32BE(r + 12) };
  }
  return out;
}

const parse = (buf) => opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
/** The code points a file maps to a real glyph. */
function codePointsOf(font) {
  const map = font.tables.cmap.glyphIndexMap;
  return Object.keys(map).map(Number).filter((cp) => map[cp] > 0);
}
const nameOf = (font, key) => font.names[key]?.en ?? '';
/** The names a face is called by: family, full, PostScript and typographic family. */
const FACE_NAMES = ['fontFamily', 'fullName', 'postScriptName', 'preferredFamily'];

/** What is wrong with `buf` as the file UPSTREAM describes for `spec`, or null when it is that
 *  file: covering everything it is here for and, for a cut face, holding nothing past the cut,
 *  without hinting, static, and not named with a Reserved Font Name its licence declares
 *  (`familyReserved`, from the family's OFL.txt, or the declaration in the file itself). */
function problemWith(buf, spec, familyReserved = []) {
  const font = parse(buf);
  const cps = codePointsOf(font);
  const has = new Set(cps);
  const lacks = spec.for.filter((name) => !TESTS[name].every((cp) => has.has(cp)));
  if (lacks.length) return `lacks ${lacks.join(', ')}`;
  if (!spec.cut) return null;
  const text = cutText(spec);
  if (cps.some((cp) => !text.has(cp))) return 'holds characters past the cut';
  const tables = tablesOf(buf);
  if (tables.fpgm || tables.prep || tables['cvt ']) return 'is hinted';
  if (tables.fvar) return 'is variable';
  // A cut is a Modified Version under the OFL, which may not carry a Reserved Font Name. The
  // name follows the copyright line, which some files keep in the licence field instead.
  const reserved = [...familyReserved, ...reservedFontNames(`${nameOf(font, 'copyright')}\n${nameOf(font, 'license')}`)];
  const clash = reservedNameIn(FACE_NAMES.map((k) => nameOf(font, k)), reserved);
  if (clash) return `is named with the Reserved Font Name "${clash}"`;
  return null;
}

const PINNED = GOOGLE_FONTS.split('/').pop();

/** The original file from google/fonts at `commit` (the pinned one unless a spec names its own),
 *  downloaded once into node_modules/.cache. A file the commit does not have is remembered as
 *  missing too, since a commit never changes; the error carries the HTTP status. */
async function fetchUpstream(file, commit = PINNED) {
  if (!/^(ofl|apache)\//.test(file)) throw new Error(`${file}: only ofl/ and apache/ are cleared for bundling`);
  const cached = path.join(APP, 'node_modules', '.cache', 'google-fonts', commit, file.replace(/\//g, '__'));
  const missing = (status) => Object.assign(new Error(`${file}: HTTP ${status}`), { status });
  if (existsSync(cached)) return readFileSync(cached);
  if (existsSync(`${cached}.missing`)) throw missing(404);
  const base = GOOGLE_FONTS.replace(PINNED, commit);
  const r = await fetch(`${base}/${file.split('/').map(encodeURIComponent).join('/')}`);
  await mkdir(path.dirname(cached), { recursive: true });
  if (r.status === 404) await writeFile(`${cached}.missing`, '');
  if (!r.ok) throw missing(r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(cached, buf);
  return buf;
}

/** A family's licence at `commit`, from the first of `folders` that google/fonts has: OFL-1.1
 *  under ofl/, with the names its OFL.txt reserves and the copyright notice it opens with, or
 *  Apache-2.0 under apache/. */
async function familyLicence(folders, commit = PINNED) {
  for (const folder of folders) {
    const ofl = folder.startsWith('ofl/');
    const file = `${folder}/${ofl ? 'OFL.txt' : 'LICENSE.txt'}`;
    let text;
    try {
      text = (await fetchUpstream(file, commit)).toString('utf8');
    } catch (e) {
      if (e.status === 404) continue;
      throw e;
    }
    const copyright = ofl ? text.replace(/\r\n?/g, '\n').split(/\n\s*This Font Software/)[0].trim() : '';
    return { licence: ofl ? 'OFL-1.1' : 'Apache-2.0', file, commit, reserved: ofl ? reservedFontNames(text) : [], copyright };
  }
  throw new Error(`google/fonts has no ${folders.join(' or ')} at ${commit.slice(0, 7)}: the licence is not established`);
}

const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

/** A TrueType checksum: the sum of the big-endian uint32s, over a 4-byte-padded buffer. */
function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) sum = (sum + buf.readUInt32BE(i)) >>> 0;
  return sum;
}

/** `buf` with some tables replaced; every other byte kept, offsets and checksums redone. */
function withTables(buf, replace) {
  const n = buf.readUInt16BE(4);
  const head = Buffer.alloc(12 + n * 16);
  buf.copy(head, 0, 0, 12);
  const parts = [];
  let offset = head.length;
  let headAt = -1;
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const tag = buf.toString('latin1', r, r + 4);
    let data = replace[tag] ?? buf.subarray(buf.readUInt32BE(r + 8), buf.readUInt32BE(r + 8) + buf.readUInt32BE(r + 12));
    if (tag === 'head') {
      // checkSumAdjustment is zero while the checksums are taken, then set over the whole file.
      data = Buffer.from(data);
      data.writeUInt32BE(0, 8);
      headAt = offset;
    }
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    head.write(tag, r, 'latin1');
    head.writeUInt32BE(checksum(padded), r + 4);
    head.writeUInt32BE(offset, r + 8);
    head.writeUInt32BE(data.length, r + 12);
    parts.push(padded);
    offset += padded.length;
  }
  const out = Buffer.concat([head, ...parts]);
  out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headAt + 8);
  return out;
}

/** Renames a pinned face to the weight it was pinned at. Pinning keeps the default instance's
 *  names, so Noto Sans SC fixed at 900 still called itself "Noto Sans SC Thin". The style word
 *  is replaced in the family, style, unique, full, PostScript and typographic names. */
function renameStyle(buf, to) {
  const font = parse(buf);
  const from = nameOf(font, 'preferredSubfamily') || nameOf(font, 'fontSubfamily');
  if (!from || from === to) return buf;
  const word = new RegExp(`\\b${from}\\b`, 'g');
  const { offset, length } = tablesOf(buf).name;
  const name = buf.subarray(offset, offset + length);
  if (name.readUInt16BE(0) !== 0) throw new Error('name table format 1: not handled');
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  const records = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const at = storage + name.readUInt16BE(r + 10);
    let str = name.subarray(at, at + name.readUInt16BE(r + 8));
    if ([1, 2, 3, 4, 6, 16, 17].includes(name.readUInt16BE(r + 6))) {
      const wide = name.readUInt16BE(r) !== 1; // platform 1 is Macintosh, single-byte
      const text = wide ? Buffer.from(str).swap16().toString('utf16le') : str.toString('latin1');
      const renamed = text.replace(word, to);
      if (renamed !== text) str = wide ? Buffer.from(renamed, 'utf16le').swap16() : Buffer.from(renamed, 'latin1');
    }
    records.push({ header: name.subarray(r, r + 8), str });
  }
  const table = Buffer.alloc(6 + count * 12);
  table.writeUInt16BE(0, 0);
  table.writeUInt16BE(count, 2);
  table.writeUInt16BE(6 + count * 12, 4);
  let at = 0;
  records.forEach(({ header, str }, i) => {
    header.copy(table, 6 + i * 12);
    table.writeUInt16BE(str.length, 6 + i * 12 + 8);
    table.writeUInt16BE(at, 6 + i * 12 + 10);
    at += str.length;
  });
  return withTables(buf, { name: Buffer.concat([table, ...records.map((x) => x.str)]) });
}

let subsetFont;
/** The file UPSTREAM describes: the original, or the original cut, pinned and renamed. */
async function makeFace(spec) {
  const source = await fetchUpstream(spec.file, spec.commit);
  if (!spec.cut) return source;
  subsetFont ??= (await import('subset-font')).default;
  const cut = await subsetFont(source, Array.from(cutText(spec), (cp) => String.fromCodePoint(cp)).join(''), {
    targetFormat: 'sfnt',
    noHinting: true,
    // The kerning, for the opentype layout; nothing else in GSUB/GPOS is read.
    keepFeatures: ['kern'],
    // On top of harfbuzz's default 0-6: trademark, manufacturer, designer, licence and licence
    // URL, so the copyright and the licence stay inside the file, and the typographic names.
    preserveNameIds: [7, 8, 9, 13, 14, 16, 17],
    ...(spec.pin ? { variationAxes: spec.pin } : {}),
  });
  return spec.pin?.wght ? renameStyle(Buffer.from(cut), WEIGHT_NAMES[spec.pin.wght]) : Buffer.from(cut);
}

/** A face from UPSTREAM: made again only when the file on disk is missing or not the one the
 *  recipe makes, and written only once it passes. Its family's licence file is read first, at
 *  the face's own commit, so a cut is checked against the names that file reserves. */
async function upstream(slug) {
  const spec = UPSTREAM[slug];
  const dest = path.join(FONTS_DIR, `${slug}.ttf`);
  let family;
  try {
    family = await familyLicence([spec.file.split('/').slice(0, 2).join('/')], spec.commit);
  } catch (e) {
    return { slug, status: 'FAIL', error: e.message };
  }
  const before = existsSync(dest) ? readFileSync(dest) : null;
  let why = 'not on disk';
  try {
    if (before) why = problemWith(before, spec, family.reserved);
    // A face shipped whole has to be the very file: a copy cut elsewhere is a Modified Version.
    if (before && !why && !spec.cut && !before.equals(await fetchUpstream(spec.file, spec.commit))) why = 'not the original file';
  } catch {
    why = 'unreadable';
  }
  if (!why) return { slug, status: 'exists', family };
  try {
    const buf = await makeFace(spec);
    const still = problemWith(buf, spec, family.reserved);
    if (still) throw new Error(`the new file ${still}`);
    await writeFile(dest, buf);
    return { slug, status: 'ok', note: `${why}: ${before ? kb(before.length) : 'none'} -> ${kb(buf.length)}`, family };
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
console.log(`Checking ${slugs.length} fonts (fetching only what is missing)...`);
// One at a time from UPSTREAM: a cut holds a whole CJK file in memory, twice.
const results = await pool(slugs.filter((s) => !UPSTREAM[s]), download, 6);
for (const slug of slugs.filter((s) => UPSTREAM[s])) results.push(await upstream(slug));

const ok = results.filter((r) => r.status === 'ok');
const exists = results.filter((r) => r.status === 'exists');
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\nFetched: ${ok.length} new, ${exists.length} already present, ${failed.length} failed.`);
for (const r of ok) console.log(`  ${r.slug}: ${r.note}`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => `${f.slug} (${f.error})`).join(', '));
  process.exitCode = 1;
}

// Fallback is now handled manually (icon-fallback.ttf)

// Regenerate registry + CSS from files actually present.
const files = (await readdir(FONTS_DIR)).filter((f) => f.endsWith('.ttf') && f !== 'icon-fallback.ttf');
const present = new Set(files.map((f) => f.replace('.ttf', '')));

/** Bytes on disk, so an app can budget its own bundle instead of hardcoding a list.
 *
 *  All 241 faces are ~33 MB of TTF, too heavy to ship, so the fold-up box picks a subset.
 *  Before this it shipped a hand-written list of eight. With the size on the record it can say
 *  "every face under 120 KB" in one line and keep up with the library on its own. */
const bytesOf = (slug) => statSync(path.join(FONTS_DIR, `${slug}.ttf`)).size;
/** What the file covers, from its own cmap: the coverage names in src/coverage.ts, and the
 *  Latin Extended-B letters it holds, which no coverage name stands for. */
const coverageOfFace = (slug) => {
  const has = new Set(codePointsOf(parse(readFileSync(path.join(FONTS_DIR, `${slug}.ttf`)))));
  return { subsets: coverageOf((cp) => has.has(cp)), latinExtB: latinExtBOf((cp) => has.has(cp)) };
};

const rows = Object.entries(MAP)
  .filter(([slug]) => present.has(slug))
  .map(([slug, [label, category, curated]]) => ({ id: slug, label, category, curated: !!curated, ...coverageOfFace(slug), bytes: bytesOf(slug) }));

// Any ttf on disk not in MAP: include with a guessed label + 'Display'.
for (const slug of present) {
  if (!MAP[slug]) {
    const label = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    rows.push({ id: slug, label, category: 'Display', curated: false, ...coverageOfFace(slug), bytes: bytesOf(slug) });
  }
}
rows.sort((a, b) => a.label.localeCompare(b.label));

const ts = `// AUTO-GENERATED by scripts/fetch-fonts.mjs — do not edit by hand.
export interface FontChoice { id: string; label: string; category: string; curated: boolean; /** What the file covers, read from its cmap: names from coverage.ts (Google Fonts' subset names, and \`kana\`). */ subsets: string[]; /** The Latin Extended-B letters (U+0180–024F) the file holds, as runs ("ƀ-ǃǅ-ɏ"): faces cover that block too unevenly for a name, so text is checked against it letter by letter. Absent for a face injected at runtime, which answers from its own cmap. */ latinExtB?: string; /** TTF size on disk, bytes. Absent for a face injected at RUNTIME — the keychain and the pen topper both let someone drop their own font in, and that one never came from this registry. */ bytes?: number; }
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
${rows.map((r) => `| ${r.label} | ${r.category} | ${specimen(UPSTREAM[r.id]?.family ?? r.label)} |`).join('\n')}

## Cut to size

These files are cut down from the originals in the google/fonts repository, which the OFL
permits (a cut is a Modified Version): only the characters below are kept, along with the
Latin, Greek and Cyrillic each file has, hinting is removed, and a variable font is fixed at
one weight. Each keeps its copyright and licence entries in its name table, and none is named
with a Reserved Font Name.

| Font | Kept | Original (google/fonts) |
| --- | --- | --- |
${Object.entries(UPSTREAM)
  .filter(([slug, spec]) => spec.cut && present.has(slug))
  .map(([slug, spec]) => `| ${MAP[slug][0]} | ${[...spec.for.map((n) => KEPT[n] ?? n), ...(spec.pin ? [`fixed at ${Object.entries(spec.pin).map(([a, v]) => `${a} ${v}`).join(', ')}`] : [])].join('; ')} | \`${spec.file}\` |`)
  .join('\n')}

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

// The asset registry's rows for these faces (assets.json), with each family's licence as read
// above and how the face ships, then every other asset row (scripts/assets.mjs). Only after a
// clean run: a face that failed keeps the row it had, and the asset check names it.
if (failed.length) {
  console.log('\nassets.json is not updated while a face fails.');
} else {
  const blob = (file, commit) => `https://github.com/google/fonts/blob/${commit}/${file}`;
  recordAssets('packages/fonts/scripts/fetch-fonts.mjs', results.map(({ slug, family }) => {
    const buf = readFileSync(path.join(FONTS_DIR, `${slug}.ttf`));
    const spec = UPSTREAM[slug];
    return {
      id: `font/${slug}`,
      kind: 'font',
      files: { [`packages/fonts/src/fonts/${slug}.ttf`]: fileHash(`packages/fonts/src/fonts/${slug}.ttf`, buf) },
      licence: family.licence,
      // A file whose name table holds no copyright takes the notice its family's OFL.txt opens with.
      copyright: (nameOf(parse(buf), 'copyright') || family.copyright).replace(/\s+/g, ' ').trim(),
      reservedNames: family.reserved,
      shipsAs: spec && !spec.cut ? 'original' : 'cut',
      source: spec
        ? { url: blob(spec.file, spec.commit ?? PINNED), commit: spec.commit ?? PINNED }
        : { url: specimen(MAP[slug][0]), commit: null },
      licenceUrl: blob(family.file, family.commit),
      notice: [`packages/fonts/src/fonts/${family.licence === 'OFL-1.1' ? 'OFL.txt' : 'LICENSE-APACHE-2.0.txt'}`],
    };
  }));
  const { unknown } = writeAssets();
  console.log(`Wrote assets.json${unknown.length ? ` (${unknown.length} file(s) no rule describes: see pnpm gen:assets)` : ''}`);
}
