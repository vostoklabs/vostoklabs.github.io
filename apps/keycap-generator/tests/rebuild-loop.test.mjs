/*
  The keycap's rebuild loop (src/rebuild.js), with real carves: an Export gets the cap the panel
  describes, whenever it is pressed.

    node apps/keycap-generator/tests/rebuild-loop.test.mjs      (part of pnpm test)

  The app's Export awaits `loop.settled()`; before the loop it read the last carve that had
  finished, so a press inside the 200 ms wait, or inside the carve itself, exported the cap from
  before the change, under the new legend's name. Each check below changes the settings the way
  the panel does, presses "Export" at once, and compares what comes back with a direct carve of
  the new settings, and with what the old read would have handed over.

  The second half runs the app's own exports (src/exports.js) on the same loop: the alphabet set
  holds it, an Export pressed during the set waits for the set and then sends the new cap, and a
  set that throws still lets go. Only the browser's edges are stood in for: the MakerLab seam
  (absent, as on the web), the kit's toast and licence nudge, and the download, which records the
  file instead.

  manifold-3d stays external, so node loads the npm build itself, as the export golden does.
*/
import { build } from 'esbuild';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
globalThis.fetch = async (url) => {
  const file = join(APP, 'public', String(url));
  if (!existsSync(file)) return { ok: false, status: 404 };
  const buf = readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const WASM = createRequire(join(APP, 'package.json')).resolve('manifold-3d/manifold.wasm');
const manifoldNode = {
  name: 'manifold-node',
  setup(b) {
    b.onResolve({ filter: /^manifold-3d\/manifold\.wasm\?url$/ }, () => ({ path: 'wasm', namespace: 'manifold-wasm-url' }));
    b.onLoad({ filter: /.*/, namespace: 'manifold-wasm-url' }, () => ({ contents: `export default ${JSON.stringify(WASM)};`, loader: 'js' }));
    b.onResolve({ filter: /^manifold-3d$/ }, () => ({ path: 'manifold-3d', external: true }));
  },
};
/* The browser's edges, for exports.js: the MakerLab seam as the public build has it, the kit's
   toast and licence nudge as no-ops, and a download that records the file. */
const EXPORT_SRC = createRequire(join(APP, 'package.json')).resolve('@vostok/export');
const KIT_SRC = createRequire(join(APP, 'package.json')).resolve('@vostok/ui-kit');
const edges = {
  name: 'browser-edges',
  setup(b) {
    const fromExports = (args) => args.importer.replace(/\\/g, '/').endsWith('/src/exports.js');
    b.onResolve({ filter: /^virtual:makerlab$/ }, () => ({ path: 'makerlab', namespace: 'edge' }));
    b.onResolve({ filter: /^@vostok\/ui-kit$/ }, (args) => (fromExports(args) ? { path: 'kit', namespace: 'edge' } : null));
    b.onResolve({ filter: /^@vostok\/export$/ }, (args) => (fromExports(args) ? { path: 'export', namespace: 'edge' } : null));
    b.onLoad({ filter: /^makerlab$/, namespace: 'edge' }, () => ({
      contents: 'export const MAKERLAB = false; export const isReady = () => false; export const can = () => false;'
        + ' export async function sdkExport() { throw new Error("no host"); } export async function sdkToast() {}',
      loader: 'js',
    }));
    b.onLoad({ filter: /^kit$/, namespace: 'edge' }, () => ({
      contents: `export * from ${JSON.stringify(KIT_SRC)};\nexport const toast = () => {};\nexport const licenseAfterExport = () => {};`,
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

const cacheDir = join(APP, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, `rebuild-loop-${process.pid}.mjs`);
await build({
  stdin: {
    contents: [
      "export { rebuildLoop, carveCap, carveReport, CarveDeclined } from './src/rebuild.js';",
      "export { createExports, stageCover } from './src/exports.js';",
      "export { BLANK_COVER } from '@vostok/export/makerlab';",
      "export { capParts, orientForPrint } from './src/exportParts.js';",
      "export { keycapThreeMF } from './src/export3mf.js';",
      "export { parseLogo } from './src/logo.js';",
      "export { LUCIDE_ICONS, buildSvg } from './src/lucideIcons.js';",
      "export { loadKeycap } from './src/keycap.js';",
      "export { initManifold } from './src/manifold.js';",
      "export { loadBundledFonts } from './src/letter.js';",
      "export { BufferGeometry, Float32BufferAttribute } from 'three';",
      "export { unzipSync, strFromU8 } from 'fflate';",
    ].join('\n'),
    resolveDir: APP,
    sourcefile: 'rebuild-loop-entry.js',
    loader: 'js',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  plugins: [manifoldNode, edges],
  define: { __KEYCAP_ARTWORK__: 'false' },
});
const app = await import(pathToFileURL(outfile).href);
rmSync(outfile, { force: true });

let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (ok) passes++; else failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ a Standard 1u, as the app opens
await app.initManifold();
const index = JSON.parse(readFileSync(join(APP, 'public', 'keycaps', 'index.json'), 'utf8'));
const profile = index.profiles.find((p) => p.id === 'standard-profile');
const kc = await app.loadKeycap(profile.keycaps.find((k) => k.id === '1u').file);
const meta = kc.meta;
const icon = (name) => ({ ...app.parseLogo(app.buildSvg(app.LUCIDE_ICONS.find((ic) => ic.name === name).node)), name });
const room = Math.min(meta.topExtent[0], meta.topExtent[1]);
const optsAt = (rotationDeg) => ({
  widthMM: Math.round(room * 0.5 * 10) / 10, depth: 0.5, centerX: meta.center[0], centerY: meta.center[1],
  rotationDeg, mirror: false, through: false, singleColor: false, homingBump: false, homingBumpGeom: null,
});
/** What the panel says, as mount.js's carveSettings() hands it over. */
const panel = { legend: icon('copy'), rot: 0, off: false };
const settings = () => (panel.off ? null : {
  shell: kc.shellGeometry, meta, profile, profileTag: 'standard-profile', legend: panel.legend, opts: optsAt(panel.rot), extras: [],
});

/** A carve as bytes: the cap's and the legend's vertices and triangles. */
const digest = (bodies) => {
  const h = createHash('sha256');
  for (const g of [bodies.keycapGeometry, bodies.logoGeometry]) {
    h.update(Buffer.from(g.getAttribute('position').array.buffer));
    h.update(Buffer.from(g.getIndex().array.buffer));
  }
  return h.digest('hex').slice(0, 16);
};
const direct = async (legend, rot) => digest(await app.carveCap(kc.shellGeometry, meta, legend, optsAt(rot), []));

let starts = 0;
const failed = [];
const loop = app.rebuildLoop({
  settings,
  onStart: () => { starts++; },
  onShow: () => {},
  onFail: (e) => failed.push(e),
});

// The cap as the app opens: the copy icon, carved.
loop.request();
const opening = await loop.settled();
const copy0 = await direct(icon('copy'), 0);
check('the cap as it opens is carved and handed over', opening.legend.name === 'copy' && digest(opening.bodies) === copy0, `${opening.legend.name}, ${digest(opening.bodies)}`);

// ------------------------------------------------------------------ Export inside the 200 ms wait
// A new legend picked and Export pressed at once, before the debounce has run a carve.
panel.legend = icon('heart');
loop.request();
const beforeWait = loop.latest; // what the old Export read: the last carve that had finished
const inWait = await loop.settled();
const heart0 = await direct(icon('heart'), 0);
check('Export inside the 200 ms wait gets the new legend', inWait.legend.name === 'heart' && digest(inWait.bodies) === heart0, `${inWait.legend.name}, ${digest(inWait.bodies)} (a direct carve: ${heart0})`);
check('…where the old read would have sent the cap from before the change', beforeWait.legend.name === 'copy' && digest(beforeWait.bodies) === copy0, `the last finished carve was ${beforeWait.legend.name}`);

// ------------------------------------------------------------------ Export inside the carve
// A change, its carve running (0.2-0.7 s in the app), then another change and Export at once.
panel.legend = icon('arrow-up');
const startsBefore = starts;
loop.request();
loop.flush(); // the carve starts now, as a picked icon does in the app
while (starts === startsBefore) await sleep(1); // the carve is running
panel.legend = icon('heart');
panel.rot = 45;
loop.request();
const duringCarve = loop.latest;
const inCarve = await loop.settled();
const heart45 = await direct(icon('heart'), 45);
check('Export inside a running carve gets the cap carved after it, from the newest settings', inCarve.legend.name === 'heart' && inCarve.opts.rotationDeg === 45 && digest(inCarve.bodies) === heart45, `${inCarve.legend.name} at ${inCarve.opts.rotationDeg}°, ${digest(inCarve.bodies)} (a direct carve: ${heart45})`);
check('…where the old read would have sent the heart at 0°', duringCarve.legend.name === 'heart' && duringCarve.opts.rotationDeg === 0 && digest(duringCarve.bodies) === heart0, `the last finished carve was ${duringCarve.legend.name} at ${duringCarve.opts.rotationDeg}°`);

// ------------------------------------------------------------------ a batch holds the loop
const release = loop.hold();
check('a batch can take the loop while nothing runs', typeof release === 'function');
check('…and a second batch cannot', loop.hold() === null);
const startsHeld = starts;
panel.legend = icon('copy');
panel.rot = 0;
loop.request();
let settledEarly = false;
const waiting = loop.settled().then((c) => { settledEarly = true; return c; });
await sleep(400); // twice the debounce
check('while it holds, no carve starts and an export waits', starts === startsHeld && !settledEarly, `${starts - startsHeld} carves started`);
release();
const afterBatch = await waiting;
check('let go, the change made during the batch is carved and handed over', afterBatch.legend.name === 'copy' && digest(afterBatch.bodies) === copy0, afterBatch.legend.name);

// ------------------------------------------------------------------ a carve that fails
// A stroke with no area: buildBodies throws half way. The export must not get the cap before it.
const dead = new app.BufferGeometry();
dead.setAttribute('position', new app.Float32BufferAttribute([1, 1, 0, 1, 1, 0, 1, 1, 0], 3));
panel.legend = { contours: [[[0, 0], [10, 0], [10, 10], [0, 10]]], strokeGeoms: [dead], box: icon('copy').box, name: 'broken' };
loop.request();
const refused = await loop.settled().then(() => null, (e) => e);
check('a legend that cannot be carved refuses the export instead of sending the last good cap', refused instanceof Error && !(refused instanceof app.CarveDeclined) && failed.length === 1, refused?.message ?? 'resolved');

// ------------------------------------------------------------------ nothing to carve
// Fit test open or a paid mode on the stage: a carve asked for declines, quietly.
panel.legend = icon('copy');
panel.off = true;
loop.request();
const declined = await loop.settled().then(() => null, (e) => e);
check('a carve with nothing to carve declines, and says nothing', declined instanceof app.CarveDeclined && failed.length === 1, declined?.message ?? 'resolved');
panel.off = false;
loop.request();
const back = await loop.settled();
check('…and the next change carves again', back.legend.name === 'copy' && digest(back.bodies) === copy0, back.legend.name);

// ------------------------------------------------------------------ what the status line says
const okReport = app.carveReport({ footprints: [{ w: 7.6, h: 7.6 }], room: 15.2, surfaceVariation: 0.1, through: false, single: false, depth: 0.5 });
check('a carve that fits says Ready, with no warning', okReport.diagnostics.length === 0 && okReport.ok === 'Ready · legend 7.6×7.6 mm · 0.5 mm deep.', okReport.ok);
const both = app.carveReport({ footprints: [{ w: 16, h: 8 }], room: 15.2, surfaceVariation: 0.6, through: false, single: false, depth: 0.5 });
check('a legend too big for the top and a curved top are both warnings, the size first', both.diagnostics.map((d) => `${d.level}:${d.code}`).join(' ') === 'warning:legend-too-big warning:curved-top', both.diagnostics.map((d) => d.code).join(', '));

// ================================================================== the app's exports on the loop
await app.loadBundledFonts();
// mount.js's rebuild lock, as it hands it to exports.js and to a paid set.
let releaseBatch = null;
const lock = {
  begin() { const r = loop.hold(); if (!r) return false; releaseBatch = r; return true; },
  end() { if (!releaseBatch) return; const r = releaseBatch; releaseBatch = null; r(); loop.request(); },
  held: () => !!releaseBatch,
};
const button = { disabled: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
const elements = { alphabetSet: button, alphabetHelp: { textContent: '' } };
const statuses = [];
let chip = null;
let chipTexts = 0;
let breakChipAt = 0; // the chip's Nth relabel throws, for a batch that fails half way
const exportsApi = app.createExports({
  $: (id) => elements[id],
  host: undefined,
  setStatus: (msg, kind = '') => statuses.push(`${kind}:${msg}`),
  setBusy: (text, cancel) => { chip = text == null ? null : { text, cancel }; },
  busyText: () => { chipTexts++; if (chipTexts === breakChipAt) throw new Error('the chip broke'); },
  cover: () => '',
  pro: () => null,
  begin: lock.begin,
  end: lock.end,
  busy: lock.held,
  settled: () => loop.settled(),
  flushStem: () => {},
  state: () => ({
    capColor: '#161616', logoColor: '#f7f7f5', through: false, extraColors: [], stem: null,
    shell: kc.shellGeometry, meta, profile, profileTag: 'standard-profile', unit: 1, unitId: '1u',
    fontId: 'helvetiker-regular', opts: optsAt(panel.rot), fitTestActive: false, fitTestPieces: null,
    wallGenerator: 'arachne',
  }),
});
globalThis.__downloads = [];
const steadyModel = async (blobOrBytes) => {
  const bytes = blobOrBytes instanceof Uint8Array ? blobOrBytes : new Uint8Array(await blobOrBytes.arrayBuffer());
  return createHash('sha256').update(app.strFromU8(app.unzipSync(bytes)['3D/3dmodel.model'])
    .replace(/<metadata name="(vl:build|CreationDate)">[^<]*<\/metadata>/g, '')).digest('hex').slice(0, 16);
};
/** The 3MF Export should write for these settings: a direct carve through the same parts. */
const expected3mf = async (legend, rot) => {
  const bodies = await app.carveCap(kc.shellGeometry, meta, legend, optsAt(rot), []);
  const parts = app.orientForPrint(app.capParts(bodies, { capColor: '#161616', logoColor: '#f7f7f5', through: false, stem: null }), profile, meta);
  return steadyModel(app.keycapThreeMF(parts, { process: { wall_generator: 'arachne' } }));
};
const until = async (cond, what) => {
  for (let i = 0; i < 2000; i++) { if (cond()) return; await sleep(5); }
  throw new Error(`timed out waiting for ${what}`);
};

// ------------------------------------------------------------------ Export during the A-Z batch
panel.legend = icon('copy');
panel.rot = 0;
loop.request();
await loop.settled();
const az = button.listeners.click(); // "Get full alphabet set (A–Z)"
await until(() => lock.held() && chipTexts >= 1, 'the set to hold the loop');
check('the alphabet set holds the loop, and its own button is disabled while it runs', lock.held() && button.disabled === true);
// A new legend picked during the set, and Export pressed at once.
panel.legend = icon('heart');
loop.request();
let exportDone = 0;
let batchDone = 0;
const exported = exportsApi.runPrimaryExport().then(() => { exportDone = Date.now(); });
await until(() => chipTexts >= 3, 'three letters');
check('an Export pressed during the set waits for it', exportDone === 0 && globalThis.__downloads.length === 0, `${chipTexts} letters carved, nothing exported yet`);
chip.cancel(); // the set's own Cancel, to keep this short
await az.then(() => { batchDone = Date.now(); });
await exported;
const sent = globalThis.__downloads.at(-1);
const heartAt0 = await expected3mf(icon('heart'), 0);
check('…then sends the cap the panel describes, under its name', sent?.name === 'keycap-heart-standard-profile.3mf' && (await steadyModel(sent.data)) === heartAt0, `${sent?.name}, model ${sent ? await steadyModel(sent.data) : '-'} (expected ${heartAt0})`);
check('…after the set let go of the loop', !lock.held() && exportDone >= batchDone, `the set ended ${batchDone ? 'first' : 'never'}`);
check('the cancelled set said so, exported nothing, and gave its button back', statuses.some((s) => s.startsWith('warn:Alphabet set cancelled')) && globalThis.__downloads.length === 1 && button.disabled === false);

// ------------------------------------------------------------------ a set that throws
statuses.length = 0;
breakChipAt = chipTexts + 2; // the second letter's relabel throws
const logError = console.error;
console.error = () => {}; // the set logs the error it catches; expected here
const broken = button.listeners.click();
await broken;
console.error = logError;
check('a set that throws half way says so', statuses.some((s) => s.startsWith('err:Could not generate the alphabet set')), statuses.at(-1));
check('…and still lets go of the loop', !lock.held());
const again = loop.hold();
check('…so the next batch can hold it', typeof again === 'function');
again?.();
panel.legend = icon('copy');
loop.request();
await exportsApi.runPrimaryExport();
check('…and the next Export is sent', globalThis.__downloads.at(-1)?.name === 'keycap-copy-standard-profile.3mf');

// ------------------------------------------------------------------ the set waits for a carve
// A set pressed while a carve runs used to be dropped without a word; it now starts after it.
panel.legend = icon('arrow-up');
const startsBeforeSet = starts;
loop.request();
loop.flush();
await until(() => starts > startsBeforeSet, 'the carve to start');
const chipsBefore = chipTexts;
const late = button.listeners.click();
await until(() => chipTexts > chipsBefore, 'the set to start after the carve');
check('the set pressed during a carve runs once the carve is done', lock.held());
chip.cancel();
await late;

// ------------------------------------------------------------------ the MakerLab cover
// The stage as the export's cover, or the shelf's blank picture when the canvas cannot be read.
const stage = (render, url) => ({ render, domElement: { toDataURL: () => url } });
const picture = `data:image/png;base64,${'A'.repeat(200)}`;
const coverOf = (r) => { const log = console.error; console.error = () => {}; try { return app.stageCover(r, {}, {}); } finally { console.error = log; } };
check('the MakerLab cover is the stage when it can be read', coverOf(stage(() => {}, picture)) === picture);
check('…and the blank cover when the context is lost', coverOf(stage(() => { throw new Error('context lost'); }, picture)) === app.BLANK_COVER);
check('…or when the canvas reads back empty', coverOf(stage(() => {}, 'data:,')) === app.BLANK_COVER);

loop.dispose();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nall ${passes} rebuild loop checks pass: an Export gets the cap the panel describes`);
process.exit(failures ? 1 : 0);
