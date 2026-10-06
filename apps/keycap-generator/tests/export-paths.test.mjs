/*
  The keycap's export paths, end to end through src/exports.js: what each button writes is what the
  export golden pins.

    node apps/keycap-generator/tests/export-paths.test.mjs      (part of pnpm test)

  The golden builds its files from the part builders (src/exportParts.js) with arguments of its
  own. This runs the functions the buttons call instead (Export, Export blank keycap, the fit
  test's Export, Get full alphabet set) on the rebuild loop and the lock the app uses, with the
  panel stood in, and compares every file they write with the golden's hashes for the same
  settings, and the names they are saved under. So what exports.js hands the part builders (the
  stem, shine-through, the profile a cap is laid out for, the names, the zip) is pinned too.

  Both deliveries are run: the browser's download (a 3MF, the alphabet set as a zip of them), and
  the MakerLab export (the OBJ, its MTL and the cover handed to the host). Only the browser's and
  the host's edges are stood in for (support/app-bundle.mjs).
*/
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, bundleApp } from './support/app-bundle.mjs';

const app = await bundleApp([
  "export { rebuildLoop, createRebuildLock } from './src/rebuild.js';",
  "export { createExports } from './src/exports.js';",
  "export { profileTag } from './src/exportParts.js';",
  "export { parseLogo } from './src/logo.js';",
  "export { LUCIDE_ICONS, buildSvg } from './src/lucideIcons.js';",
  "export { loadKeycap } from './src/keycap.js';",
  "export { initManifold, getManifoldApi, geomToManifold, manifoldToGeom } from './src/manifold.js';",
  "export { parseLetter, loadBundledFonts } from './src/letter.js';",
  "export { buildFitTestRow, computeFitTestLadder, FIT_TEST_STEP_MM, FIT_TEST_FONT_ID } from './src/fitTest.js';",
  "export { setMakerlab } from 'virtual:makerlab';",
  "export { unzipSync, strFromU8 } from 'fflate';",
], 'export-paths');

let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (ok) passes++; else failures++;
};
setTimeout(() => {
  console.log('FAIL  the run did not finish in 3 minutes: something waits for good');
  process.exit(1);
}, 180_000);

// ------------------------------------------------------------------ what a file is, as the golden says
const golden = JSON.parse(readFileSync(join(APP, 'tests', 'golden', 'export-golden.json'), 'utf8')).cases;
const hash = (data) => createHash('sha256').update(data).digest('hex').slice(0, 16);
/** The build id and today's date written over, as the golden writes them. */
const steady = (text) => text
  .replace(/<metadata name="vl:build">[^<]*<\/metadata>/g, '<metadata name="vl:build">BUILD</metadata>')
  .replace(/<metadata name="CreationDate">[^<]*<\/metadata>/g, '<metadata name="CreationDate">DATE</metadata>')
  .replace(/^(#? ?Build: ).*$/gm, '$1BUILD')
  .replace(/^(#? ?Created: ).*$/gm, '$1DATE');
/** A 3MF's entries as the golden hashes them. */
const entriesOf = (bytes) => {
  const zip = app.unzipSync(bytes);
  const out = {};
  for (const name of Object.keys(zip).sort()) {
    const text = /\.(model|config|txt|xml|rels)$/i.test(name) ? app.strFromU8(zip[name]) : null;
    out[name] = hash(text == null ? zip[name] : steady(text));
  }
  return out;
};
const bytesOf = async (data) => (data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()));
/** The golden entries a file does not match, or none. */
const movedFrom = (files, id) => {
  const want = golden[id].files;
  return [...new Set([...Object.keys(want), ...Object.keys(files)])].filter((n) => want[n] !== files[n]);
};
/** Each entry of a zip as stored: its name and its compression method (0 = stored). */
function zipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let i = 0; i + 30 <= bytes.length && view.getUint32(i, true) === 0x04034b50;) {
    const method = view.getUint16(i + 8, true);
    const size = view.getUint32(i + 18, true);
    const nameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    out.push({ name: app.strFromU8(bytes.subarray(i + 30, i + 30 + nameLength)), method });
    i += 30 + nameLength + extraLength + size;
  }
  return out;
}

// ------------------------------------------------------------------ the caps, as mount.js's setKeycap() leaves them
await app.initManifold();
await app.loadBundledFonts();
const index = JSON.parse(readFileSync(join(APP, 'public', 'keycaps', 'index.json'), 'utf8'));
async function capOf(profileId, sizeId) {
  const profile = index.profiles.find((p) => p.id === profileId);
  const entry = profile.keycaps.find((k) => k.id === sizeId);
  const kc = await app.loadKeycap(entry.file);
  const m = app.geomToManifold(kc.stemGeometry);
  const stem = app.manifoldToGeom(m); // the stem at a fit of 0: the authored one, cleaned
  m.delete();
  return { profile, entry, shell: kc.shellGeometry, meta: kc.meta, stem };
}
const S1 = await capOf('standard-profile', '1u');
const C1 = await capOf('choc-v1', '1u');
const icon = (name) => ({ ...app.parseLogo(app.buildSvg(app.LUCIDE_ICONS.find((ic) => ic.name === name).node)), name });
const tagOf = (profile) => app.profileTag(profile, index.profiles.length);

/**
 * The panel: what mount.js's carveSettings() and exportState() read. `cap` is the cap loaded;
 * `profileShown` is what the profile control says, which runs ahead of the cap while a new one
 * loads.
 */
const panel = { cap: S1, profileShown: S1.profile, legend: icon('copy'), through: false, fitTest: null };
const optsOf = (cap) => ({
  widthMM: Math.round(Math.min(cap.meta.topExtent[0], cap.meta.topExtent[1]) * 0.5 * 10) / 10,
  depth: 0.5, centerX: cap.meta.center[0], centerY: cap.meta.center[1], rotationDeg: 0,
  mirror: false, through: panel.through, singleColor: false, homingBump: false, homingBumpGeom: null,
});
const loop = app.rebuildLoop({
  settings: () => ({
    shell: panel.cap.shell, meta: panel.cap.meta, profile: panel.cap.profile, profileTag: tagOf(panel.cap.profile),
    legend: panel.legend, opts: optsOf(panel.cap), extras: [],
  }),
  onShow: () => {},
  onFail: (e) => console.error(e),
});
const lock = app.createRebuildLock(loop, () => loop.request());
const alphabetButton = { disabled: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
const elements = { alphabetSet: alphabetButton, alphabetHelp: { textContent: '' } };
const statuses = [];
const COVER = `data:image/png;base64,${'C'.repeat(200)}`;
const exportsApi = app.createExports({
  $: (id) => elements[id],
  host: undefined,
  setStatus: (msg, kind = '') => statuses.push(`${kind}:${msg}`),
  setBusy: () => {},
  busyText: () => {},
  cover: () => COVER,
  pro: () => null,
  begin: lock.begin,
  end: lock.end,
  busy: lock.held,
  settled: () => loop.settled(),
  flushStem: () => {},
  state: () => ({
    capColor: '#161616', logoColor: '#f7f7f5', through: panel.through, extraColors: [], stem: panel.cap.stem,
    shell: panel.cap.shell, meta: panel.cap.meta, profile: panel.profileShown, profileTag: tagOf(panel.profileShown),
    unit: panel.cap.entry.unit, unitId: panel.cap.entry.id, fontId: 'helvetiker-regular', opts: optsOf(panel.cap),
    fitTestActive: !!panel.fitTest, fitTestPieces: panel.fitTest, wallGenerator: 'arachne',
  }),
});
globalThis.__downloads = [];
globalThis.__sdkExports = [];

/** Run one export on the web and through MakerLab, and compare both with the golden case. */
async function bothWays(label, press, id, name) {
  // The browser's download: a 3MF.
  app.setMakerlab(false);
  await press();
  const download = globalThis.__downloads.at(-1);
  const moved = download ? movedFrom(entriesOf(await bytesOf(download.data)), id) : ['nothing written'];
  check(`${label}: the 3MF is the golden's ${id}, entry by entry`, !moved.length, moved.length ? `moved: ${moved.join(', ')}` : `${Object.keys(golden[id].files).length} entries`);
  check(`${label}: saved as ${name}.3mf`, download?.name === `${name}.3mf` && download?.mime === 'model/3mf', `${download?.name} (${download?.mime})`);
  // MakerLab: the OBJ, its MTL and the cover, handed to the host.
  app.setMakerlab(true);
  await press();
  app.setMakerlab(false);
  const artifact = globalThis.__sdkExports.at(-1)?.artifacts?.[0];
  const obj = artifact ? steady(new TextDecoder().decode(artifact.buffer)) : '';
  check(`${label}: MakerLab gets the golden's OBJ and MTL, named ${name}.obj, with the stage as its cover`,
    artifact?.format === 'obj' && artifact.fileName === `${name}.obj` && hash(obj) === golden[id].obj && hash(artifact.mtl) === golden[id].mtl
      && artifact.coverImage === COVER && artifact.printConfig?.wallGenerator === 'arachne',
    artifact ? `${artifact.fileName}, OBJ ${hash(obj) === golden[id].obj ? 'as the golden' : 'moved'}, MTL ${hash(artifact.mtl) === golden[id].mtl ? 'as the golden' : 'moved'}` : 'nothing handed over');
}

// ------------------------------------------------------------------ Export: a cap in shine-through
// The stem goes with the cap, on the legend's filament.
panel.through = true;
loop.request();
await bothWays('Export, a Standard 1u in shine-through', () => exportsApi.runPrimaryExport(), 'S-1u-copy-through', 'keycap-copy-standard-profile');
panel.through = false;

// ------------------------------------------------------------------ Export: a Choc cap, while the profile changes
// A Choc cap is carved; then the profile control is turned to Standard, and Export is pressed
// before the Standard cap has loaded. The file is the Choc cap on screen, laid out as a Choc cap
// prints (on its side) and named for it, whatever the control says by then.
panel.cap = C1;
panel.profileShown = C1.profile;
loop.request();
await loop.settled();
panel.profileShown = S1.profile;
await bothWays('Export, a Choc cap while the profile control already says Standard', () => exportsApi.runPrimaryExport(), 'C-1u-copy', 'keycap-copy-choc-v1');
panel.profileShown = C1.profile;

// ------------------------------------------------------------------ Export blank keycap
panel.cap = S1;
panel.profileShown = S1.profile;
await bothWays('Export blank keycap, a Standard 1u', () => exportsApi.exportBlank(), 'S-1u-blank', 'keycap-blank-standard-profile-1u');
panel.cap = C1;
panel.profileShown = C1.profile;
await bothWays('Export blank keycap, a Choc 1u (as loaded, not turned)', () => exportsApi.exportBlank(), 'C-1u-blank', 'keycap-blank-choc-v1-1u');

// ------------------------------------------------------------------ the fit test's Export
panel.cap = S1;
panel.profileShown = S1.profile;
panel.fitTest = app.buildFitTestRow(
  { api: app.getManifoldApi(), baseStemGeometry: S1.stem, meta: S1.meta, letterContour: (text) => app.parseLetter(text, app.FIT_TEST_FONT_ID, 6) },
  app.computeFitTestLadder(0, app.FIT_TEST_STEP_MM, -0.4, 0.4),
);
await bothWays('Fit test, a Standard 1u', () => exportsApi.runPrimaryExport(), 'S-1u-fit-test', 'keycap-fit-test-standard-profile');
panel.fitTest = null;

// ------------------------------------------------------------------ Get full alphabet set (A–Z)
// Twenty-six letters, each its golden case, in one zip of stored 3MFs named for their letters.
loop.request();
await loop.settled();
const downloadsBefore = globalThis.__downloads.length;
await alphabetButton.listeners.click();
const zip = globalThis.__downloads.length > downloadsBefore ? globalThis.__downloads.at(-1) : null;
check('the alphabet set is saved as keycap-alphabet-roboto-standard-profile.zip',
  zip?.name === 'keycap-alphabet-roboto-standard-profile.zip' && zip?.mime === 'application/zip', `${zip?.name} (${zip?.mime})`);
const zipBytes = zip ? await bytesOf(zip.data) : new Uint8Array();
const directory = zipDirectory(zipBytes);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
check('…holds 26 3MFs named for their letters, A to Z',
  directory.map((e) => e.name).join(',') === [...LETTERS].map((ch) => `keycap-${ch}.3mf`).join(','), `${directory.length} entries: ${directory.slice(0, 2).map((e) => e.name).join(', ')} …`);
check('…stored as they are, not deflated again', directory.length === 26 && directory.every((e) => e.method === 0), directory.map((e) => e.method).join(''));
const letters = zipBytes.length ? app.unzipSync(zipBytes) : {};
const off = [...LETTERS].filter((ch) => !letters[`keycap-${ch}.3mf`] || movedFrom(entriesOf(letters[`keycap-${ch}.3mf`]), `AZ-S-1u-roboto-${ch}`).length);
check('…and every letter\'s 3MF is the golden\'s, entry by entry', !off.length, off.length ? `moved: ${off.join(' ')}` : '26 of 26');
check('the set gave the loop back', !lock.held() && alphabetButton.disabled === false);

loop.dispose();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nall ${passes} export path checks pass: every button writes the golden's files, under their names`);
process.exit(failures ? 1 : 0);
