/*
  The keycap's own modules, bundled for a node test as the app bundles them, with what only a
  browser or the app's build provides stood in for:

  - manifold-3d: npm's build, which node loads itself, and its WASM by path;
  - virtual:makerlab: the seam as the public build has it (no host) until a test calls
    `setMakerlab(true)`; then the MakerLab branch runs and each export it would hand the host is
    kept in `globalThis.__sdkExports`. The host answers "sent", or whatever
    `globalThis.__sdkAnswer(request)` returns or throws; its toasts are kept in
    `globalThis.__sdkToasts`, and `isExportCancelled` reads a stand-in code, 'CANCEL', the way the
    glue reads the SDK's (answered as `errorCode`, or thrown as `code`);
  - for src/exports.js only: the kit's toast and licence nudge kept in `globalThis.__toasts` and
    `globalThis.__nudges` instead of shown, and @vostok/export's downloadFile keeping each file in
    `globalThis.__downloads` instead of saving it;
  - in node itself: DOMParser and XMLSerializer (xmldom), localStorage, and a fetch that reads the
    app's public/ folder, as the page does.

  Shared by rebuild-loop.test.mjs and export-paths.test.mjs.
*/
import { build } from 'esbuild';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const stored = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => void stored.set(k, String(v)),
    removeItem: (k) => void stored.delete(k),
  },
});
globalThis.fetch = async (url) => {
  const file = join(APP, 'public', String(url));
  if (!existsSync(file)) return { ok: false, status: 404 };
  const buf = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(buf.toString('utf8')),
    text: async () => buf.toString('utf8'),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
};

const resolveFromApp = createRequire(join(APP, 'package.json')).resolve;
const WASM = resolveFromApp('manifold-3d/manifold.wasm');
const EXPORT_SRC = resolveFromApp('@vostok/export');
const KIT_SRC = resolveFromApp('@vostok/ui-kit');

const manifoldNode = {
  name: 'manifold-node',
  setup(b) {
    b.onResolve({ filter: /^manifold-3d\/manifold\.wasm\?url$/ }, () => ({ path: 'wasm', namespace: 'manifold-wasm-url' }));
    b.onLoad({ filter: /.*/, namespace: 'manifold-wasm-url' }, () => ({ contents: `export default ${JSON.stringify(WASM)};`, loader: 'js' }));
    b.onResolve({ filter: /^manifold-3d$/ }, () => ({ path: 'manifold-3d', external: true }));
  },
};

const edges = {
  name: 'browser-edges',
  setup(b) {
    const fromExports = (args) => args.importer.replace(/\\/g, '/').endsWith('/src/exports.js');
    b.onResolve({ filter: /^virtual:makerlab$/ }, () => ({ path: 'makerlab', namespace: 'edge' }));
    b.onResolve({ filter: /^@vostok\/ui-kit$/ }, (args) => (fromExports(args) ? { path: 'kit', namespace: 'edge' } : null));
    b.onResolve({ filter: /^@vostok\/export$/ }, (args) => (fromExports(args) ? { path: 'export', namespace: 'edge' } : null));
    b.onLoad({ filter: /^makerlab$/, namespace: 'edge' }, () => ({
      contents: [
        'export let MAKERLAB = false;',
        'export function setMakerlab(on) { MAKERLAB = on; }',
        'export const isEmbedded = () => MAKERLAB;',
        'export async function initMakerlab() { return MAKERLAB ? {} : null; }',
        'export const isReady = () => MAKERLAB;',
        'export const can = () => MAKERLAB;',
        'export const needsUpdate = () => false;',
        'export async function sdkExport(request) {',
        '  (globalThis.__sdkExports ??= []).push(request);',
        '  return globalThis.__sdkAnswer ? globalThis.__sdkAnswer(request) : { success: true };',
        '}',
        'export const isExportCancelled = (o) => !!o && typeof o === "object" && (o.code === "CANCEL" || o.errorCode === "CANCEL");',
        'export async function sdkToast(options) { (globalThis.__sdkToasts ??= []).push(options); }',
      ].join('\n'),
      loader: 'js',
    }));
    b.onLoad({ filter: /^kit$/, namespace: 'edge' }, () => ({
      contents: `export * from ${JSON.stringify(KIT_SRC)};\n`
        + 'export const toast = (message, opts) => { (globalThis.__toasts ??= []).push({ message, ...opts }); };\n'
        + 'export const licenseAfterExport = () => { globalThis.__nudges = (globalThis.__nudges ?? 0) + 1; };',
      loader: 'js',
      resolveDir: APP,
    }));
    b.onLoad({ filter: /^export$/, namespace: 'edge' }, () => ({
      contents: `export * from ${JSON.stringify(EXPORT_SRC)};\n`
        + 'export function downloadFile(data, name, mime) { (globalThis.__downloads ??= []).push({ data, name, mime, at: Date.now() }); }',
      loader: 'js',
      resolveDir: APP,
    }));
  },
};

/** Bundle these entry lines (paths relative to the app folder) and import the bundle. */
export async function bundleApp(lines, tag) {
  const cacheDir = join(APP, 'node_modules', '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const outfile = join(cacheDir, `${tag}-${process.pid}.mjs`);
  await build({
    stdin: { contents: lines.join('\n'), resolveDir: APP, sourcefile: `${tag}-entry.js`, loader: 'js' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error',
    plugins: [manifoldNode, edges],
    define: { __KEYCAP_ARTWORK__: 'false' },
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outfile, { force: true });
  return mod;
}
