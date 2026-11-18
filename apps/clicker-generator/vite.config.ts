import { defineConfig } from 'vite';
import { readdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { leaveOutFonts } from '@vostok/fonts/vite';
import { FONTS } from '@vostok/fonts/registry';

// The faces the MakerLab build carries, as many as its package has room for; the website keeps
// the whole library. Every curated face; then each category in turn takes its next best-known face
// (by Google Fonts' popularity) until the room is spent, none over 0.2 MB in the zip; the face each
// Asian language falls back to and two or three more for each; and Source Han Sans CN for the
// Chinese characters the others lack. A face new to the library stays out until it is named here.
const MAKERLAB_FONTS = [
  // Serif (17)
  'abril-fatface', 'bree-serif', 'cinzel', 'cinzel-decorative', 'domine', 'eb-garamond',
  'faustina', 'libre-baskerville', 'literata', 'lora', 'marcellus', 'merriweather', 'noto-serif',
  'playfair-display', 'pt-serif', 'spectral', 'vollkorn',
  // Slab (15)
  'alegreya-sans-sc', 'aleo', 'alfa-slab-one', 'arvo', 'bevan', 'bitter', 'crete-round',
  'josefin-slab', 'patua-one', 'roboto-slab', 'rokkitt', 'rye', 'sanchez', 'ultra', 'zilla-slab',
  // Script (17)
  'alex-brush', 'allura', 'cookie', 'courgette', 'dancing-script', 'great-vibes', 'kaushan-script',
  'lobster', 'lobster-two', 'marck-script', 'pacifico', 'parisienne', 'pinyon-script',
  'sacramento', 'satisfy', 'tangerine', 'yellowtail',
  // Handwriting (17)
  'amatic-sc', 'architects-daughter', 'caveat', 'gloria-hallelujah', 'handlee', 'homemade-apple',
  'indie-flower', 'kalam', 'neucha', 'nothing-you-could-do', 'patrick-hand', 'permanent-marker',
  'reenie-beanie', 'rock-salt', 'shadows-into-light', 'special-elite', 'sriracha',
  // Clean (23)
  'anton', 'archivo', 'bebas-neue', 'black-han-sans', 'do-hyeon', 'figtree', 'gothic-a1', 'inter',
  'kanit', 'm-plus-1p', 'manrope', 'montserrat', 'noto-sans', 'noto-sans-sc', 'nunito', 'oswald',
  'outfit', 'poppins', 'raleway', 'roboto', 'rubik', 'source-han-sans-cn-light', 'work-sans',
  // Tech (18)
  'audiowide', 'black-ops-one', 'chakra-petch', 'gruppo', 'jura', 'khand', 'michroma', 'monoton',
  'orbitron', 'oxanium', 'quantico', 'rajdhani', 'righteous', 'rubik-mono-one', 'russo-one',
  'saira-condensed', 'syncopate', 'unica-one',
  // Comic (20)
  'baloo-2', 'bangers', 'boogaloo', 'cherry-bomb-one', 'chewy', 'comfortaa', 'comic-neue',
  'comic-relief', 'concert-one', 'fredoka', 'grandstander', 'itim', 'lilita-one', 'luckiest-guy',
  'mali', 'quicksand', 'sansita', 'short-stack', 'sniglet', 'zcool-kuaile',
  // Display (18)
  'bowlby-one-sc', 'bungee', 'bungee-shade', 'changa-one', 'dela-gothic-one', 'dela-gothic-one-jp',
  'fugaz-one', 'gravitas-one', 'passion-one', 'paytone-one', 'racing-sans-one', 'rammetto-one',
  'rowdies', 'secular-one', 'shrikhand', 'sigmar-one', 'squada-one', 'titan-one',
  // Spooky (16)
  'butcherman', 'creepster', 'eater', 'ewert', 'frijole', 'griffy', 'henny-penny', 'jolly-lodger',
  'lacquer', 'metal-mania', 'new-rocker', 'nosifer', 'pirata-one', 'rubik-glitch',
  'rubik-moonrocks', 'rubik-spray-paint',
  // Mono (14)
  'cutive-mono', 'dm-mono', 'fira-mono', 'ibm-plex-mono', 'inconsolata', 'jetbrains-mono',
  'major-mono-display', 'martian-mono', 'noto-sans-mono', 'roboto-mono', 'share-tech-mono',
  'source-code-pro', 'space-mono', 'syne-mono',
  // Pixel (11)
  'handjet', 'jersey-15', 'jersey-25', 'micro-5', 'pixelify-sans', 'press-start-2p', 'silkscreen',
  'sixtyfour', 'tiny5', 'vt323', 'workbench',
];

// Our CSP-safe manifold rebuild (see packages/manifold-noeval/README.md).
const MANIFOLD_NOEVAL = resolve(__dirname, '../../packages/manifold-noeval');

const TRADEMARKED_ICONS = new Set([
  'discord.svg', 'gmail.svg', 'google.svg', 'googlechrome.svg',
  'googledrive.svg', 'googlesheets.svg', 'instagram.svg',
  'twitch.svg', 'x.svg', 'youtube.svg'
]);

// The brand icons the embedded build omits.
function trademarkCleanPlugin(enabled: boolean) {
  return {
    name: 'trademark-clean',
    generateBundle(_options: unknown, bundle: Record<string, { fileName: string }>) {
      if (enabled) {
        for (const fileName of Object.keys(bundle)) {
          const basename = fileName.split('/').pop()?.toLowerCase();
          if (basename && TRADEMARKED_ICONS.has(basename)) {
            delete bundle[fileName];
          }
        }
      }
    },
    closeBundle() {
      if (enabled) {
        const distIconsDir = resolve(__dirname, 'dist', 'icons');
        if (existsSync(distIconsDir)) {
          for (const file of readdirSync(distIconsDir)) {
            if (TRADEMARKED_ICONS.has(file.toLowerCase())) {
              try { rmSync(join(distIconsDir, file), { force: true }); } catch {}
            }
          }
        }
      }
    },
  };
}

// `virtual:makerlab` — the MakerLab integration seam. In the MakerWorld build
// (`vite --mode makerworld`) it resolves to the gitignored host glue (src/makerlab/glue.ts).
// In every other build it resolves to an inline no-op stub, so the public site never depends
// on the host glue and builds fine without those gitignored files.
// `virtual:pro-pack` is the same seam for the paid features (src/pro/). Both the host glue and
// those sources are gitignored, so this indirection is what keeps `pnpm build` working in a
// fresh public clone: without it, mount.ts's static `./pro/panel` import is an unresolved
// module and the build dies before the MAKERLAB dead-code pass ever runs.
//
// The paid features exist ONLY in the MakerWorld build. Not locked, not hidden — absent. That
// is stronger than a client-side gate and it sidesteps the question of whether one is real.
function makerlabPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:makerlab';
  const STUB_ID = '\0virtual:makerlab-stub';
  const PRO_ID = 'virtual:pro-pack';
  const PRO_STUB_ID = String.fromCharCode(0) + 'virtual:pro-pack-stub';
  const gluePath = resolve(__dirname, 'src/makerlab/glue.ts');
  const proPath = resolve(__dirname, 'src/pro/panel.ts');
  return {
    name: 'makerlab',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? gluePath : STUB_ID;
      // Only reach for the real panel when it is actually present: the MakerWorld build runs
      // from the full working tree, and a public clone has no src/pro/ at all.
      if (id === PRO_ID) return enabled && existsSync(proPath) ? proPath : PRO_STUB_ID;
      return null;
    },
    load(id: string) {
      if (id === PRO_STUB_ID) {
        // Same module shape as the real panel so the call site needs no null checks. It is
        // never called in the public build (the branch is fenced behind MAKERLAB); this
        // exists so the module graph resolves.
        return [
          'export function mountProFeatures() {',
          '  return { refresh() {}, gateShape: async () => false, destroy() {}, paramsPatch: () => ({}) };',
          '}',
        ].join('\n');
      }
      if (id === STUB_ID) {
        return [
          'export const MAKERLAB = false;',
          'export const isEmbedded = () => false;',
          'export async function initMakerlab() { return null; }',
          'export const isReady = () => false;',
          'export const can = () => false;',
          'export const needsUpdate = () => false;',
          'export async function sdkExport() { throw new Error("Not available in this build"); }',
          'export const isExportCancelled = () => false;',
          'export async function sdkToast() {}',
          // The paid surface, hard-locked. Identical module shape so app code can import it
          // unconditionally, and a public build where every gate answers `false` and every
          // price answers `null` — the paid features are fenced behind MAKERLAB anyway, so
          // this is belt and braces rather than the only thing stopping them.
          'export const SELLER_PACK = "seller_pack";',
          'export const isUnlocked = () => false;',
          'export const paymentInfo = () => null;',
          'export const isUserCancelled = () => false;',
          'export async function ensureAccess() { return false; }',
          'export const formatPrice = () => "";',
          'export const currentPrice = () => null;',
        ].join('\n');
      }
      return null;
    },
    transformIndexHtml(html: string) {
      if (!enabled) return html;
      // The embedded build strips inline <script> blocks (those without a src). The only one
      // is the theme bootstrap; the ui-kit sidebar footer re-applies the saved/system theme on
      // mount, so nothing is lost. The external module <script src> is kept.
      let result = html.replace(/[ \t]*<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>\s*/gi, '\n');
      // Strip Google Fonts <link> tags; the embedded build loads no external fonts.
      // Chakra Petch is already bundled locally via @vostok/ui-kit styles.css @font-face.
      result = result.replace(/[ \t]*<link[^>]*fonts\.googleapis\.com[^>]*>\s*/gi, '\n');
      result = result.replace(/[ \t]*<link[^>]*fonts\.gstatic\.com[^>]*>\s*/gi, '\n');
      return result;
    },
  };
}

// `virtual:shape-editor` — the 2-D shape editor, a paid feature fenced in src/pro/ (gitignored).
// The real module only when its source is on disk AND the mode ships it; otherwise (a public
// clone, or the plain public build) an inline stub with the same export, never called.
const SHAPE_EDITOR_ENTRY = resolve(__dirname, 'src/pro/shape-editor/shapeEditor.ts');
const SHAPE_EDITOR_MODES = new Set(['development', 'internal', 'makerworld']);
const hasShapeEditor = (mode: string): boolean =>
  SHAPE_EDITOR_MODES.has(mode) && existsSync(SHAPE_EDITOR_ENTRY);

function shapeEditorPlugin(enabled: boolean) {
  const VIRTUAL_ID = 'virtual:shape-editor';
  const STUB_ID = '\0virtual:shape-editor-stub';
  return {
    name: 'shape-editor',
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return enabled ? SHAPE_EDITOR_ENTRY : STUB_ID;
      return null;
    },
    load(id: string) {
      if (id === STUB_ID) return 'export async function openShapeEditor() { return null; }';
      return null;
    },
  };
}

/** The bundled pictures (samples, pack designs) as lossless WebP in a build. Each one decoded from
 *  the PNG and from its WebP must give the pixels the app reads, or the build fails; then the PNG
 *  leaves the build. The app reads a picture through a canvas (@vostok/trace `loadUrlToImage`),
 *  which keeps colour premultiplied by alpha, so a fully transparent pixel reads 0,0,0,0 whatever
 *  colour the file stores there: those match on alpha alone, every other pixel on all four
 *  channels. (libwebp drops the colour under alpha 0 even with `exact` in some PNGs.)
 *  `shippedPicture` (src/assets.ts) asks for the .webp. public/ keeps the PNGs: the dev server
 *  and the tests read those. */
function samePixels(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== b[i + 3]) return false;
    if (a[i + 3] === 0) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
  }
  return true;
}
const PICTURE_DIRS = /^assets[\\/](media[\\/]images|packs[\\/][^\\/]+[\\/]designs)$/;
function picturesAsWebp(enabled: boolean) {
  let outDir = '';
  return {
    name: 'pictures-as-webp',
    apply: 'build' as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      if (!enabled) return;
      // Loaded only here: a native module the dev server and the website build never need.
      const { default: sharp } = await import('sharp');
      const pictures: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, name.name);
          if (name.isDirectory()) walk(full);
          else if (/\.png$/i.test(name.name) && PICTURE_DIRS.test(relative(outDir, dir))) pictures.push(full);
        }
      };
      walk(outDir);
      if (!pictures.length) throw new Error('pictures-as-webp: no pictures found under ' + outDir);
      let before = 0;
      let after = 0;
      for (const png of pictures) {
        const source = readFileSync(png);
        const webp = await sharp(source).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
        const pixels = (buf: Buffer) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const a = await pixels(source);
        const b = await pixels(webp);
        if (a.info.width !== b.info.width || a.info.height !== b.info.height || !samePixels(a.data, b.data)) {
          throw new Error(`pictures-as-webp: ${relative(outDir, png)} decodes differently as WebP`);
        }
        writeFileSync(png.replace(/\.png$/i, '.webp'), webp);
        rmSync(png);
        before += source.length;
        after += webp.length;
      }
      console.log(`pictures-as-webp: ${pictures.length} pictures, ${(before / 1e6).toFixed(2)} MB of PNG → ${(after / 1e6).toFixed(2)} MB of WebP, same pixels`);
    },
  };
}

// Relative base so the static build works on ANY GitHub Pages URL
// (user/org page at '/', or a project page at '/<repo>/') with no reconfig.
export default defineConfig(({ mode, command }) => ({
  base: './',
  plugins: [
    picturesAsWebp(mode === 'makerworld'),
    trademarkCleanPlugin(mode === 'makerworld'),
    makerlabPlugin(mode === 'makerworld'),
    shapeEditorPlugin(hasShapeEditor(mode)),
    // The MakerLab build ships as one package, and the whole library alone would be ~22 MB of it.
    ...(mode === 'makerworld'
      ? [leaveOutFonts(FONTS.map((f) => f.id).filter((id) => !MAKERLAB_FONTS.includes(id)))]
      : []),
  ],
  define: {
    // True only in a build that contains the shape editor (see `shapeEditorPlugin` above);
    // false folds its button and its dynamic import out of the bundle.
    __SHAPE_EDITOR__: JSON.stringify(hasShapeEditor(mode)),
    // The MakerLab build's pictures are WebP (`picturesAsWebp` above); its dev server serves public/.
    __PICTURES_WEBP__: JSON.stringify(mode === 'makerworld' && command === 'build'),
  },
  worker: {
    format: 'es' as const,
  },
  build: {
    target: 'es2022',
  },
  server: { open: true },
  // manifold-3d ships its own WASM; keep esbuild from trying to pre-bundle it.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  // Swap manifold's RUNTIME for our -sDYNAMIC_EXECUTION=0 rebuild. The npm package stays
  // installed (it still provides the TypeScript types), but its glue calls `new Function()`
  // via Embind, which needs 'unsafe-eval'; the rebuild lets the app run under a strict CSP.
  // See packages/manifold-noeval/README.md. Subpath rule must come first so
  // `manifold-3d/manifold.wasm?url` resolves to the vendored .wasm.
  resolve: {
    alias: [
      { find: /^manifold-3d\//, replacement: MANIFOLD_NOEVAL + '/' },
      { find: /^manifold-3d$/, replacement: MANIFOLD_NOEVAL + '/manifold.js' },
    ],
  },
}));
