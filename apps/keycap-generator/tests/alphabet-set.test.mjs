/*
  The full alphabet set (src/alphabetSet.js, and exports.js's startAlphabetSet): 26 caps on one
  plate, in one 3MF.

    node apps/keycap-generator/tests/alphabet-set.test.mjs      (part of pnpm test)

  - the plate: every profile's 1u, laid out to print, on every plate the picker offers and on the
    plain grid's fallback bed: 26 caps, one plate, a grid of seven, no two caps touching, the
    block inside the plate's margins;
  - the carver: a change of case parks the other case where it got to, a letter that cannot be
    carved stops its case and says which, and a stop hands back every cap;
  - the file, through the app's own export path: 26 slicer objects named A to Z, each the cap, its
    legend and its stem on the single cap's filament slots, every cap the golden's letter part by
    part, all of them apart and on the plate, with the provenance mark;
  - one type size: every capital in the file drawn at one cap height (the Size) on one baseline,
    W as tall as I;
  - small letters: objects a to z, each legend the carve of the small letter at the capitals'
    scale, "x" shorter than "b", on the capitals' baseline, "g" below it;
  - the size asked for: text on the cap gives the capitals its letter height, and a Size too big
    for the cap shrinks the whole set together, never one letter;
  - MakerLab: one OBJ plate of the 78 parts, its MTL, the set's picture as the cover, the licence;
  - the loop: held while the set is open, given back on close, and a set closed mid-carve says so.
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, bundleApp } from './support/app-bundle.mjs';

const app = await bundleApp([
  "export { rebuildLoop, createRebuildLock } from './src/rebuild.js';",
  "export { createExports, LICENSE_NOTE } from './src/exports.js';",
  "export { setLayout, setColumns, footprintOf, createSetCarver, setTypeSize, setTypeSizes, SET_MARGIN_MM, SET_GAP_MM } from './src/alphabetSet.js';",
  "export { textHeightOf } from './src/legendSize.js';",
  "export { parseLogo } from './src/logo.js';",
  "export { LUCIDE_ICONS, buildSvg } from './src/lucideIcons.js';",
  "export { blankParts, orientForPrint, profileTag } from './src/exportParts.js';",
  "export { buildBodies } from './src/geometry.js';",
  "export { loadKeycap } from './src/keycap.js';",
  "export { initManifold, geomToManifold, manifoldToGeom } from './src/manifold.js';",
  "export { parseLetter, loadBundledFonts } from './src/letter.js';",
  "export { PLATES, plateSize } from '@vostok/plates';",
  "export { setMakerlab } from 'virtual:makerlab';",
  "export { unzipSync, strFromU8 } from 'fflate';",
], 'alphabet-set');

let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
  if (ok) passes++; else failures++;
};
setTimeout(() => {
  console.log('FAIL  the run did not finish in 4 minutes: something waits for good');
  process.exit(1);
}, 240_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, what) => {
  for (let i = 0; i < 4000; i++) { if (cond()) return; await sleep(5); }
  throw new Error(`timed out waiting for ${what}`);
};
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = UPPER.toLowerCase();

// ------------------------------------------------------------------ the plate
check('26 caps are rows of seven (A–G … V–Z), 25 rows of five, one a row of one',
  app.setColumns(26) === 7 && app.setColumns(25) === 5 && app.setColumns(1) === 1, `${app.setColumns(26)}, ${app.setColumns(25)}, ${app.setColumns(1)}`);

/** What is wrong with a layout of `n` caps of footprint `fp` on `plate`, or nothing. */
function layoutFaults(L, n, fp, plate) {
  const faults = [];
  if (L.slots.length !== n) faults.push(`${L.slots.length} slots`);
  if (L.plates !== 1) faults.push(`${L.plates} plates`);
  for (let i = 0; i < L.slots.length; i++) {
    for (let j = i + 1; j < L.slots.length; j++) {
      const a = L.slots[i];
      const b = L.slots[j];
      const apartX = Math.max(b.x - (a.x + fp.w), a.x - (b.x + fp.w));
      const apartY = Math.max(b.y - (a.y + fp.d), a.y - (b.y + fp.d));
      if (Math.max(apartX, apartY) < app.SET_GAP_MM - 1e-6) faults.push(`caps ${i} and ${j} are ${Math.max(apartX, apartY).toFixed(2)} mm apart`);
    }
  }
  const xs = L.slots.flatMap((s) => [s.x, s.x + fp.w]);
  const ys = L.slots.flatMap((s) => [s.y, s.y + fp.d]);
  const [w, d] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  if (w > plate[0] - 2 * app.SET_MARGIN_MM + 1e-6 || d > plate[1] - 2 * app.SET_MARGIN_MM + 1e-6) faults.push(`the block is ${w.toFixed(1)} × ${d.toFixed(1)} mm`);
  // Centred on the origin, where the writers put the middle of the bed.
  if (Math.abs(Math.max(...xs) + Math.min(...xs)) > 1e-6 || Math.abs(Math.max(...ys) + Math.min(...ys)) > 1e-6) faults.push('the block is off centre');
  return faults;
}

await app.initManifold();
await app.loadBundledFonts();
const index = JSON.parse(readFileSync(join(APP, 'public', 'keycaps', 'index.json'), 'utf8'));
const beds = [...app.PLATES.map((p) => p.id), 'grid'];
for (const profile of index.profiles) {
  const entry = profile.keycaps.find((k) => k.id === '1u');
  if (!entry) continue;
  const kc = await app.loadKeycap(entry.file);
  const fp = app.footprintOf(app.orientForPrint(app.blankParts(kc.shellGeometry, kc.stemGeometry, '#161616'), profile, kc.meta));
  for (const bed of beds) {
    const plate = app.plateSize(bed);
    const L = app.setLayout(26, fp, plate);
    const faults = layoutFaults(L, 26, fp, plate);
    if (L.columns !== 7 || L.rows !== 4) faults.push(`${L.columns} × ${L.rows}`);
    check(`${profile.id} 1u (${fp.w.toFixed(1)} × ${fp.d.toFixed(1)} mm) on ${bed} (${plate.join(' × ')} mm): 7 × 4 on one plate, apart, inside the margins`, !faults.length, faults.slice(0, 3).join('; '));
  }
  kc.shellGeometry.dispose();
  kc.stemGeometry?.dispose();
}
{
  // A bed too narrow for seven takes as many a row as it holds; one too small says so.
  const fp = { w: 18.2, d: 18.2 };
  const narrow = app.setLayout(26, fp, [100, 300]);
  check('a bed too narrow for seven a row takes four, and still fits', narrow.columns === 4 && !layoutFaults(narrow, 26, fp, [100, 300]).length, `${narrow.columns} × ${narrow.rows}, ${narrow.plates} plate(s)`);
  const tiny = app.setLayout(26, fp, [60, 60]);
  check('a bed that cannot hold the set says it needs more than one plate', tiny.plates > 1, `${tiny.plates} plates`);
}

// ------------------------------------------------------------------ the carver
{
  const carved = [];
  const carver = app.createSetCarver({
    letters: (c) => (c === 'lower' ? 'abcd' : 'ABCD'),
    carve: async (letter) => { carved.push(letter); await sleep(2); return [letter]; },
  });
  carver.want('upper');
  await until(() => carver.progress('upper').done >= 1, 'a capital');
  carver.want('lower');
  const lower = await carver.whenReady('lower');
  const parked = carver.progress('upper').done;
  check('a change of case carves the other case, and parks the first where it got to',
    lower.map((c) => c.letter).join('') === 'abcd' && parked >= 1 && parked < 4, `small letters ${lower.map((c) => c.letter).join('')}, capitals parked at ${parked}`);
  carver.want('upper');
  const upper = await carver.whenReady('upper');
  check('…and changing back carries on from there, carving no letter twice',
    upper.map((c) => c.letter).join('') === 'ABCD' && carved.length === 8 && new Set(carved).size === 8, carved.join(''));
  const all = await carver.stop();
  check('a stop hands back every cap of either case', all.length === 8);

  const failing = app.createSetCarver({
    letters: () => 'ABC',
    carve: async (letter) => { if (letter === 'B') throw new Error('no B'); return [letter]; },
  });
  failing.want('upper');
  const failed = await failing.whenReady('upper').then(() => null, (e) => e);
  const p = failing.progress('upper');
  check('a letter that cannot be carved stops its case and says which', failed?.message === 'no B' && p.done === 1 && p.next === 'B' && !failing.busy, `${failed?.message}, ${p.done} carved, next ${p.next}`);
  await failing.stop();

  const stopped = app.createSetCarver({ letters: () => 'ABCDEFGH', carve: async (letter) => { await sleep(5); return [letter]; } });
  stopped.want('upper');
  const waiting = stopped.whenReady('upper');
  await until(() => stopped.progress('upper').done >= 2, 'two letters');
  const kept = await stopped.stop();
  check('a stop mid-case ends the wait with nothing, and hands back what was carved', (await waiting) === null && kept.length >= 2 && kept.length < 8, `${kept.length} carved`);
}

// ------------------------------------------------------------------ the set, through the app's exports
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
const tag = app.profileTag(S1.profile, index.profiles.length);
// The panel export-paths.test.mjs stands in, which is the golden's alphabet case; `size` is the
// Size slider, half the top's short side unless a check moves it.
const DEFAULT_SIZE = Math.round(Math.min(S1.meta.topExtent[0], S1.meta.topExtent[1]) * 0.5 * 10) / 10;
const optsOf = (cap, size = DEFAULT_SIZE) => ({
  widthMM: size,
  depth: 0.5, centerX: cap.meta.center[0], centerY: cap.meta.center[1], rotationDeg: 0,
  mirror: false, through: false, singleColor: false, homingBump: false, homingBumpGeom: null,
});
const panel = { legend: { ...app.parseLogo(app.buildSvg(app.LUCIDE_ICONS.find((ic) => ic.name === 'copy').node)), name: 'copy' }, size: DEFAULT_SIZE };
const loop = app.rebuildLoop({
  // An icon on the cap, as the golden's alphabet cases assume: the Size is then the capitals' height.
  settings: () => ({ shell: S1.shell, meta: S1.meta, profile: S1.profile, profileTag: tag, legend: panel.legend, opts: optsOf(S1, panel.size), extras: [] }),
  onShow: () => {},
  onFail: (e) => console.error(e),
});
const lock = app.createRebuildLock(loop, () => loop.request());
const button = { disabled: false, hidden: false, title: '', addEventListener() {} };
const statuses = [];
const COVER = `data:image/png;base64,${'P'.repeat(200)}`;
const exportsApi = app.createExports({
  $: (id) => (id === 'alphabetSet' ? button : null),
  host: undefined,
  setStatus: (msg, kind = '') => statuses.push(`${kind}:${msg}`),
  setBusy: () => {},
  busyText: () => {},
  cover: () => 'the stage',
  pro: () => null,
  begin: lock.begin,
  end: lock.end,
  busy: lock.held,
  settled: () => loop.settled(),
  flushStem: () => {},
  state: () => ({
    capColor: '#161616', logoColor: '#f7f7f5', through: false, extraColors: [], stem: S1.stem,
    shell: S1.shell, meta: S1.meta, profile: S1.profile, profileTag: tag,
    unit: 1, unitId: '1u', fontId: 'helvetiker-regular', opts: optsOf(S1, panel.size),
    fitTestActive: false, fitTestPieces: null, wallGenerator: 'arachne',
  }),
});
globalThis.__downloads = [];
globalThis.__sdkExports = [];

/** A 3MF read back: its slicer objects with their parts, each part's mesh measured, the build. */
function read3mf(bytes) {
  const zip = app.unzipSync(bytes);
  const model = app.strFromU8(zip['3D/3dmodel.model']);
  const settings = app.strFromU8(zip['Metadata/model_settings.config']);
  const meshes = new Map();
  for (const m of model.matchAll(/<object id="(\d+)" type="model" pid="1" pindex="\d+"><mesh><vertices>(.*?)<\/vertices><triangles>(.*?)<\/triangles><\/mesh><\/object>/gs)) {
    const v = [...m[2].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((x) => [+x[1], +x[2], +x[3]]);
    const t = [...m[3].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((x) => [+x[1], +x[2], +x[3]]);
    let volume = 0;
    for (const [a, b, c] of t) {
      const [p, q, r] = [v[a], v[b], v[c]];
      volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    }
    const xs = v.map((p) => p[0]);
    const ys = v.map((p) => p[1]);
    meshes.set(m[1], { tris: t.length, volume, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  const objects = [...settings.matchAll(/<object id="(\d+)"><metadata key="name" value="([^"]*)"\/><metadata key="extruder" value="\d+"\/>(.*?)<\/object>/gs)]
    .map((o) => ({
      id: o[1],
      name: o[2],
      parts: [...o[3].matchAll(/<part id="(\d+)" subtype="normal_part"><metadata key="name" value="([^"]*)"\/><metadata key="extruder" value="(\d+)"\/><\/part>/g)]
        .map((p) => ({ name: p[2], extruder: +p[3], ...meshes.get(p[1]) })),
    }));
  const transforms = [...model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"/g)].map((m) => m[2]);
  const project = JSON.parse(app.strFromU8(zip['Metadata/project_settings.config']));
  return { zip, model, objects, transforms, project };
}
/** Each object's footprint on the bed (its parts' boxes, moved by the build transform). */
const bedBoxes = (file) => {
  const [tx, ty] = file.transforms[0].split(' ').slice(9, 11).map(Number);
  return file.objects.map((o) => {
    const b = o.parts.map((p) => p.box);
    return [Math.min(...b.map((x) => x[0])) + tx, Math.min(...b.map((x) => x[1])) + ty, Math.max(...b.map((x) => x[2])) + tx, Math.max(...b.map((x) => x[3])) + ty];
  });
};
const overlapping = (boxes) => {
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) out.push(`${i}/${j}`);
    }
  }
  return out;
};
const near = (a, b) => Math.abs(a - b) <= Math.max(1e-3, Math.abs(b) * 2e-4);

// ------------------------------------------------------------------ capitals
loop.request();
await loop.settled();
const set = await exportsApi.startAlphabetSet();
check('the set holds the loop while its window is open, and its button is disabled', !!set && lock.held() && button.disabled === true);
check('…on a plate seven caps wide and four deep', set?.layout.columns === 7 && set?.layout.rows === 4, `${set?.layout.columns} × ${set?.layout.rows}`);
set.want('upper');
const sentUpper = await set.deliver('upper');
const file = globalThis.__downloads.at(-1);
check('Generate saves one 3MF, keycap-alphabet-roboto-standard-profile.3mf',
  sentUpper === true && globalThis.__downloads.length === 1 && file?.name === 'keycap-alphabet-roboto-standard-profile.3mf' && file?.mime === 'model/3mf', `${file?.name} (${file?.mime})`);
const upper = read3mf(new Uint8Array(await file.data.arrayBuffer()));
check('…of 26 slicer objects, named A to Z', upper.objects.map((o) => o.name).join('') === UPPER, upper.objects.map((o) => o.name).join(''));
const slotFaults = upper.objects.filter((o) => o.parts.map((p) => `${p.name}:${p.extruder}`).join(',') !== `Keycap ${o.name}:1,Legend ${o.name}:2,Stem ${o.name}:1`);
check('…each the cap and the stem on filament 1 and the legend on filament 2, named for its letter', !slotFaults.length, slotFaults.slice(0, 2).map((o) => o.parts.map((p) => `${p.name}:${p.extruder}`).join(',')).join(' | '));
check('…two filaments declared, the cap colour and the legend colour', JSON.stringify(upper.project.filament_colour) === JSON.stringify(['#161616FF', '#F7F7F5FF']), JSON.stringify(upper.project.filament_colour));
const golden = JSON.parse(readFileSync(join(APP, 'tests', 'golden', 'export-golden.json'), 'utf8')).cases;
const offGolden = upper.objects.filter((o) => {
  const want = golden[`AZ-S-1u-roboto-${o.name}`]?.parts ?? [];
  return want.length !== o.parts.length || want.some((g, i) => g.tris !== o.parts[i].tris || !near(o.parts[i].volume, g.volume));
});
check('…every cap the golden\'s letter, part by part (triangles and volume)', !offGolden.length, offGolden.length ? `moved: ${offGolden.map((o) => o.name).join(' ')}` : '26 of 26');
const boxes = bedBoxes(upper);
const offBed = boxes.filter((b) => b[0] < 0 || b[1] < 0 || b[2] > 256 || b[3] > 256);
check('…all on the default 256 mm plate, no two caps overlapping', !offBed.length && !overlapping(boxes).length && new Set(upper.transforms).size === 1,
  `${offBed.length} off the plate, ${overlapping(boxes).length} overlaps, x ${Math.min(...boxes.map((b) => b[0])).toFixed(1)}–${Math.max(...boxes.map((b) => b[2])).toFixed(1)}`);
check('…with the provenance mark', !!upper.zip['Metadata/vostok_labs.txt'] && upper.model.includes('<metadata name="vl:generator">keycap-generator</metadata>'));

// ------------------------------------------------------------------ one type size
/** Each letter of a file as measured: its legend's height and width, and its bottom above its own
 *  cap's front edge (every cap is the same shell, so a shared baseline is a shared bottom). */
const lettersOf = (file) => new Map(file.objects.map((o) => {
  const legend = o.parts.find((p) => p.name === `Legend ${o.name}`).box;
  const cap = o.parts.find((p) => p.name === `Keycap ${o.name}`).box;
  return [o.name, { h: legend[3] - legend[1], w: legend[2] - legend[0], bottom: legend[1] - cap[1] }];
}));
const spread = (values) => Math.max(...values) - Math.min(...values);
const FONT = 'helvetiker-regular';
const capH = app.parseLetter('H', FONT, 1).metrics.capHeight;
const U = lettersOf(upper);
// The cap height each capital is drawn at: its ink height over its own height in font units,
// times the font's cap height. One size for the set means one number here.
const drawnAt = [...UPPER].map((ch) => {
  const box = app.parseLetter(ch, FONT, 1).box;
  return (U.get(ch).h / (box.max.y - box.min.y)) * capH;
});
check(`every capital in the 3MF is drawn at one cap height, ${DEFAULT_SIZE} mm (the Size), to 0.01 mm`,
  spread(drawnAt) <= 0.01 && Math.abs(drawnAt[0] - DEFAULT_SIZE) <= 0.01,
  `${Math.min(...drawnAt).toFixed(3)}–${Math.max(...drawnAt).toFixed(3)} mm`);
const FLAT_CAPS = [...'EFHIKLMNTXZ'];
check('…so the capitals without overshoot (E F H I K L M N T X Z) are one height to 0.01 mm',
  spread(FLAT_CAPS.map((ch) => U.get(ch).h)) <= 0.01, FLAT_CAPS.map((ch) => `${ch} ${U.get(ch).h.toFixed(3)}`).join(', '));
check('…and W is no longer shorter than I: as tall, and wider than tall',
  Math.abs(U.get('W').h - U.get('I').h) <= 0.01 && U.get('W').w > U.get('W').h, `W ${U.get('W').w.toFixed(2)} × ${U.get('W').h.toFixed(2)}, I ${U.get('I').h.toFixed(2)} tall`);
check('…on one baseline', spread(FLAT_CAPS.map((ch) => U.get(ch).bottom)) <= 0.01, FLAT_CAPS.map((ch) => U.get(ch).bottom.toFixed(3)).join(' '));

// ------------------------------------------------------------------ small letters
set.want('lower');
const sentLower = await set.deliver('lower');
const lowerFile = globalThis.__downloads.at(-1);
check('small letters save keycap-alphabet-lowercase-roboto-standard-profile.3mf', sentLower === true && lowerFile?.name === 'keycap-alphabet-lowercase-roboto-standard-profile.3mf', lowerFile?.name);
const lower = read3mf(new Uint8Array(await lowerFile.data.arrayBuffer()));
check('…of 26 slicer objects, named a to z', lower.objects.map((o) => o.name).join('') === LOWER, lower.objects.map((o) => o.name).join(''));
// The carve each small letter should be: at the capitals' type size, its band on the middle.
const caseLetters = (s) => [...s].map((ch) => [ch, app.parseLetter(ch, FONT, 1)]);
const types = app.setTypeSizes({ upper: caseLetters(UPPER), lower: caseLetters(LOWER) }, S1.meta, DEFAULT_SIZE, 0);
const notSmall = [];
for (const o of lower.objects) {
  const place = types.lower.places.get(o.name);
  const opts = optsOf(S1);
  const bodies = await app.buildBodies(S1.shell, S1.meta, app.parseLetter(o.name, FONT, 1),
    { ...opts, widthMM: place.widthMM, centerX: opts.centerX + place.dx, centerY: opts.centerY + place.dy });
  const tris = bodies.logoGeometry.index.count / 3;
  const legend = o.parts.find((p) => p.name === `Legend ${o.name}`);
  if (legend?.tris !== tris) notSmall.push(`${o.name} ${legend?.tris}/${tris}`);
  bodies.keycapGeometry.dispose();
  bodies.logoGeometry.dispose();
}
check('…each legend the carve of its small letter at the set\'s type size', !notSmall.length, notSmall.slice(0, 4).join(', '));
const L = lettersOf(lower);
check('…at the capitals\' scale: no capital is shrunk for them, so the small letters share it',
  types.upper.fit === 1 && types.lower.fit === 1 && Math.abs(types.lower.capHeightMM - DEFAULT_SIZE) < 1e-9);
check('…so "x" is shorter than "b"', L.get('x').h < L.get('b').h - 1, `x ${L.get('x').h.toFixed(2)} mm, b ${L.get('b').h.toFixed(2)} mm`);
const FLAT_SMALL = [...'hiklmnrxz'];
const baseline = U.get('H').bottom;
check('…sitting on the capitals\' baseline (h i k l m n r x z, to 0.01 mm)',
  FLAT_SMALL.every((ch) => Math.abs(L.get(ch).bottom - baseline) <= 0.01), FLAT_SMALL.map((ch) => `${ch} ${L.get(ch).bottom.toFixed(3)}`).join(', ') + ` | H ${baseline.toFixed(3)}`);
const desc = ['g', 'j', 'p', 'q', 'y'];
check('…and "g" (and j p q y) reaches below it', desc.every((ch) => L.get(ch).bottom < baseline - 1),
  desc.map((ch) => `${ch} ${(L.get(ch).bottom - baseline).toFixed(2)} mm`).join(', '));
const capitalA = upper.objects[0].parts.find((p) => p.name === 'Legend A');
const smallA = lower.objects[0].parts.find((p) => p.name === 'Legend a');
check('…and not the capital: a is not A', !!capitalA && !!smallA && (capitalA.tris !== smallA.tris || !near(capitalA.volume, smallA.volume)),
  `A ${capitalA?.tris} triangles ${capitalA?.volume.toFixed(2)} mm³, a ${smallA?.tris} triangles ${smallA?.volume.toFixed(2)} mm³`);

// ------------------------------------------------------------------ MakerLab
app.setMakerlab(true);
const sentHost = await set.deliver('upper', { cover: COVER });
app.setMakerlab(false);
const artifact = globalThis.__sdkExports.at(-1)?.artifacts?.[0];
const obj = artifact ? new TextDecoder().decode(artifact.buffer) : '';
const objects = [...obj.matchAll(/^o (.+)$/gm)].map((m) => m[1]);
check('MakerLab gets one OBJ plate, keycap-alphabet-roboto-standard-profile.obj, with its MTL',
  sentHost === true && artifact?.format === 'obj' && artifact.fileName === 'keycap-alphabet-roboto-standard-profile.obj' && artifact.buffer instanceof ArrayBuffer && /newmtl/.test(artifact.mtl ?? ''),
  `${artifact?.fileName}, ${artifact?.buffer instanceof ArrayBuffer ? 'one plate' : 'not one plate'}`);
// The OBJ writer spells a space in a name as "_".
check('…the 78 parts, three a letter, named for it', objects.length === 78 && objects[0] === 'Keycap_A' && objects.at(-1) === 'Stem_Z', `${objects.length}: ${objects.slice(0, 3).join(', ')} … ${objects.at(-1)}`);
{
  // Each letter's footprint in the OBJ: its three parts' vertices, as the plate holds them.
  const byLetter = new Map();
  let letter = null;
  for (const line of obj.split('\n')) {
    if (line.startsWith('o ')) letter = line.slice(2).split('_').at(-1);
    else if (line.startsWith('v ') && letter) {
      const [x, y] = line.slice(2).split(' ').map(Number);
      const b = byLetter.get(letter) ?? [Infinity, Infinity, -Infinity, -Infinity];
      byLetter.set(letter, [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]);
    }
  }
  const objBoxes = [...byLetter.values()];
  const spanX = [Math.min(...objBoxes.map((b) => b[0])), Math.max(...objBoxes.map((b) => b[2]))];
  check('…the caps laid out as in the 3MF: apart, the block centred on the plate\'s middle',
    objBoxes.length === 26 && !overlapping(objBoxes).length && Math.abs(spanX[0] + spanX[1]) < 1,
    `${objBoxes.length} letters, ${overlapping(objBoxes).length} overlaps, x ${spanX.map((n) => n.toFixed(1)).join(' to ')}`);
}
check('…with the set\'s picture as its cover, and the licence in its description',
  artifact?.coverImage === COVER && artifact.description.includes('26 keycaps') && artifact.description.includes(app.LICENSE_NOTE), artifact?.description);

// ------------------------------------------------------------------ the loop
await set.close();
check('closing the set gives the loop and the button back', !lock.held() && button.disabled === false);
check('…and a set that was exported says nothing about a cancel', !statuses.some((s) => s.startsWith('warn:Alphabet set cancelled')));
await loop.settled().catch(() => {});

statuses.length = 0;
const before = globalThis.__downloads.length;
const cancelled = await exportsApi.startAlphabetSet();
cancelled.want('upper');
await until(() => cancelled.progress('upper').done >= 2, 'two letters');
const pending = cancelled.deliver('upper');
await cancelled.close();
check('a set closed mid-carve says so, exports nothing, and gives the loop back',
  statuses.some((s) => s.startsWith('warn:Alphabet set cancelled')) && (await pending) === false && globalThis.__downloads.length === before && !lock.held(),
  statuses.at(-1));

// ------------------------------------------------------------------ the size the set is asked for
/** Open a set on the panel as it is now, read its type sizes, and close it. */
async function typeSizesNow() {
  loop.request();
  await loop.settled();
  const s = await exportsApi.startAlphabetSet();
  const out = { upper: s.typeSize('upper'), lower: s.typeSize('lower') };
  await s.close();
  return out;
}
// Text on the cap: the capitals take its letter height, read off the Size the way the single cap
// reads it (legendSize.js textHeightOf), so the set's "A" is as tall as the "A" on the cap.
panel.legend = app.parseLetter('A', FONT, 1);
panel.size = 9;
const fromText = await typeSizesNow();
const aOnCap = app.textHeightOf(panel.legend.box, 9);
check('text on the cap: the capitals are as tall as its letters (an "A" at Size 9)',
  Math.abs(fromText.upper.capHeightMM - aOnCap) < 1e-9 && fromText.upper.shrunkFor === null, `${fromText.upper.capHeightMM.toFixed(3)} mm, the cap's A ${aOnCap.toFixed(3)} mm`);
// A Size too big for the cap: the whole set shrinks together until its roomiest letter fits.
panel.legend = { ...app.parseLogo(app.buildSvg(app.LUCIDE_ICONS.find((ic) => ic.name === 'copy').node)), name: 'copy' };
panel.size = 16;
const tooBig = await typeSizesNow();
check('a Size too big for the cap: the capitals shrink together, and the window names the letter that set it',
  tooBig.upper.capHeightMM < 16 && /^[A-Z]$/.test(tooBig.upper.shrunkFor ?? ''), `${tooBig.upper.capHeightMM.toFixed(2)} mm, for ${tooBig.upper.shrunkFor}`);
check('…and the small letters never come out bigger than the capitals\' scale',
  tooBig.lower.capHeightMM <= tooBig.upper.capHeightMM + 1e-9, `${tooBig.lower.capHeightMM.toFixed(2)} mm, for ${tooBig.lower.shrunkFor}`);
{
  // At that size, every letter of each case fits the Size slider's share of the top, and none is
  // shrunk on its own: one scale (millimetres per font unit) for the whole case.
  const big = app.setTypeSizes({ upper: caseLetters(UPPER), lower: caseLetters(LOWER) }, S1.meta, 16, 0);
  for (const [name, t, letters] of [['capitals', big.upper, UPPER], ['small letters', big.lower, LOWER]]) {
    const room = Math.min(...S1.meta.topExtent) * 0.95;
    const scales = [...letters].map((ch) => {
      const b = app.parseLetter(ch, FONT, 1).box;
      return t.places.get(ch).widthMM / Math.max(b.max.x - b.min.x, b.max.y - b.min.y);
    });
    const widest = Math.max(...[...letters].map((ch) => t.places.get(ch).w));
    check(`…${name} at Size 16: one scale for every letter, the widest inside the top`,
      spread(scales) < 1e-9 && widest <= room + 1e-9 && (t !== big.upper || t.fit < 1), `${widest.toFixed(2)} of ${room.toFixed(2)} mm, limited by ${t.limit ?? 'the capitals'}`);
  }
}

loop.dispose();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nall ${passes} alphabet set checks pass: 26 caps on one plate, in one 3MF`);
process.exit(failures ? 1 : 0);
